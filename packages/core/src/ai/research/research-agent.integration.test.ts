import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { describe, expect, it, vi } from "vitest";
import type { AIConfig } from "../../types";
import { type ReadingAgentOptions, streamReadingAgent } from "../agents/reading-agent";
import { createChatModel } from "../llm-provider";
import type { ToolDefinition } from "../tools";
import { WebResearchError, type WebSearchProvider } from "./web-provider";

vi.mock("../llm-provider", () => ({ createChatModel: vi.fn() }));

class ScriptedModel extends BaseChatModel {
  bindCount = 0;
  prompts: BaseMessage[][] = [];

  constructor(private readonly script: (messages: BaseMessage[]) => AIMessage) {
    super({});
  }

  _llmType() {
    return "research-test";
  }

  bindTools() {
    this.bindCount += 1;
    return this;
  }

  async _generate(messages: BaseMessage[]) {
    this.prompts.push(messages);
    const message = this.script(messages);
    return { generations: [{ text: String(message.content), message }] };
  }

  async *_streamResponseChunks(messages: BaseMessage[]) {
    this.prompts.push(messages);
    const message = this.script(messages);
    yield new ChatGenerationChunk({
      text: String(message.content),
      message: new AIMessageChunk({
        content: message.content,
        tool_call_chunks: message.tool_calls?.map((call, index) => ({
          name: call.name,
          args: JSON.stringify(call.args),
          id: call.id,
          index,
          type: "tool_call_chunk",
        })),
      }),
    });
  }
}

const AI_CONFIG: AIConfig = {
  endpoints: [],
  activeEndpointId: "",
  activeModel: "mock",
  slidingWindowSize: 8,
  temperature: 0,
  maxTokens: 1000,
};
const SOURCE = {
  provider: "mock",
  url: "https://developer.apple.com/documentation/metal",
  title: "Metal",
  excerpt: "Untrusted web result for Model only",
  retrievalMethod: "search" as const,
  retrievedAt: "2026-11-21T00:00:00Z",
};
const localTool = {
  name: "fallbackSearch",
  description: "Find a passage",
  parameters: { query: { type: "string", description: "search text", required: true } },
  execute: async () => ({ results: ["Book source"] }),
} satisfies ToolDefinition;

async function run(
  question: string,
  research: ReadingAgentOptions["research"],
  model: ScriptedModel,
  tools: ToolDefinition[] = [localTool],
  bookId: string | null = "book-1",
) {
  vi.mocked(createChatModel).mockResolvedValue(model);
  const events = [];
  for await (const event of streamReadingAgent(
    {
      aiConfig: AI_CONFIG,
      book: null,
      bookId,
      enabledSkills: [],
      isVectorized: false,
      semanticContext: null,
      getAvailableTools: () => tools,
      research,
    },
    question,
  ))
    events.push(event);
  return events;
}

function hasToolResult(messages: BaseMessage[]) {
  return messages.some((message) => message.getType() === "tool");
}

function call(name: string, args: Record<string, unknown>, id: string) {
  return { name, args, id, type: "tool_call" as const };
}

describe("research with the real ReAct graph", () => {
  it("runs both fallback and web tools in one turn without persisting web excerpts", async () => {
    const search = vi.fn(async () => [SOURCE]);
    const provider: WebSearchProvider = { id: "mock", search, fetchPage: vi.fn() };
    const model = new ScriptedModel((messages) =>
      hasToolResult(messages)
        ? new AIMessage("Combined answer.")
        : new AIMessage({
            content: "",
            tool_calls: [
              call("fallbackSearch", { query: "Metal" }, "local"),
              call("webSearch", { query: "Metal framework" }, "web"),
            ],
          }),
    );
    const events = await run("比较书中理论和近期论文", { mode: "auto", provider }, model);
    expect(events).toContainEqual({ type: "tool_result", name: "webSearch", result: { count: 1 } });
    expect(
      events.some((event) => event.type === "tool_result" && event.name === "fallbackSearch"),
    ).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      events.some((event) => event.type === "token" && event.content.includes("Combined answer")),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain(SOURCE.excerpt);
    expect(
      model.prompts.some((prompt) =>
        prompt.some((message) => String(message.content).includes(SOURCE.excerpt)),
      ),
    ).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("guarantees an ordinary public Always request attempts the web and surfaces failures", async () => {
    const search = vi.fn(async () => {
      throw new WebResearchError("rate_limited", "Parallel rate limited the turn.");
    });
    const provider: WebSearchProvider = { id: "mock", search, fetchPage: vi.fn() };
    const model = new ScriptedModel(() => new AIMessage("No live results were available."));
    const events = await run(
      "What is Metal GPU scheduling?",
      { mode: "always", provider },
      model,
      [localTool],
      null,
    );
    expect(search).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        name: "webSearch",
        result: expect.objectContaining({ code: "rate_limited" }),
      }),
    );
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("can finish a hybrid answer from local evidence when the web fails", async () => {
    const provider: WebSearchProvider = {
      id: "mock",
      search: vi.fn(async () => {
        throw new WebResearchError("unavailable", "Web is unavailable.");
      }),
      fetchPage: vi.fn(),
    };
    const model = new ScriptedModel((messages) =>
      hasToolResult(messages)
        ? new AIMessage("Book evidence is available. The web search failed.")
        : new AIMessage({
            content: "",
            tool_calls: [
              call("webSearch", { query: "Metal framework research" }, "web"),
              call("fallbackSearch", { query: "Metal" }, "local"),
            ],
          }),
    );
    const events = await run("比较书中理论和近期论文", { mode: "auto", provider }, model);
    expect(
      events.some((event) => event.type === "tool_result" && event.name === "fallbackSearch"),
    ).toBe(true);
    expect(
      events.some((event) => event.type === "token" && event.content.includes("web search failed")),
    ).toBe(true);
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it("sends zero web requests in Off and in Auto for a simple explanation", async () => {
    const search = vi.fn(async () => [SOURCE]);
    const provider: WebSearchProvider = { id: "mock", search, fetchPage: vi.fn() };
    for (const mode of ["off", "auto"] as const) {
      const model = new ScriptedModel(() => new AIMessage("Local answer."));
      const events = await run("解释这一段", { mode, provider }, model);
      expect(events.some((event) => event.type === "error")).toBe(false);
    }
    expect(search).not.toHaveBeenCalled();
  });

  it("executes at most 24 real parallel tools and reaches an unbound synthesis call", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const tool = { ...localTool, name: "getCustomData", execute };
    const model = new ScriptedModel((messages) =>
      hasToolResult(messages)
        ? new AIMessage("Synthesis complete.")
        : new AIMessage({
            content: "",
            tool_calls: Array.from({ length: 28 }, (_, i) =>
              call(tool.name, { query: `topic ${i}` }, `tool-${i}`),
            ),
          }),
    );
    const events = await run("比较这本书的理论", { mode: "off" }, model, [tool]);
    expect(execute).toHaveBeenCalledTimes(24);
    expect(model.bindCount).toBe(1);
    expect(model.prompts).toHaveLength(2);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      events.some(
        (event) => event.type === "token" && event.content.includes("Synthesis complete"),
      ),
    ).toBe(true);
  });

  it("starts synthesis before a long sequence reaches the normal graph recursion limit", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const tool = { ...localTool, name: "getCustomData", execute };
    const model = new ScriptedModel((messages) => {
      if (String(messages[0]?.content).includes("Prefer answering from available evidence")) {
        return new AIMessage("Finished before recursion limit.");
      }
      const index = messages.filter((message) => message.getType() === "tool").length;
      return new AIMessage({
        content: "",
        tool_calls: [call(tool.name, { query: `topic ${index}` }, `tool-${index}`)],
      });
    });
    const events = await run("比较这本书的理论", { mode: "off" }, model, [tool]);
    expect(execute.mock.calls.length).toBeGreaterThan(1);
    expect(execute.mock.calls.length).toBeLessThan(12);
    expect(
      events.some(
        (event) =>
          event.type === "token" && event.content.includes("Finished before recursion limit"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
});
