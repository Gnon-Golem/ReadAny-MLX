import type { AgentRuntimeEvent } from "@readany/core/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AntigravityRuntime, antigravityOptions } from "./antigravity-runtime";

const mock = vi.hoisted(() => ({
  receive: undefined as ((data: { payload: unknown }) => void) | undefined,
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event, handler) => {
    mock.receive = handler;
    return Promise.resolve(() => {
      mock.receive = undefined;
    });
  }),
}));

const config = [
  {
    id: "mode",
    type: "select",
    currentValue: "default",
    name: "Mode",
    options: [
      { value: "default", name: "Default" },
      { value: "auto", name: "Auto" },
      { value: "accept-edits", name: "Accept edits" },
      { value: "plan", name: "Plan" },
    ],
  },
  {
    id: "model",
    type: "select",
    currentValue: "gemini-fixture",
    name: "Model",
    options: [
      {
        group: "Examples",
        options: [
          { value: "gemini-fixture", name: "Fixture" },
          { value: "other", name: "Other" },
        ],
      },
    ],
  },
];
const init = {
  protocolVersion: 1,
  agentCapabilities: {
    mcpCapabilities: { http: true },
    loadSession: true,
    sessionCapabilities: { resume: {} },
  },
};

function packet(data: unknown) {
  mock.receive?.({ payload: { processId: "process", packet: data } });
}

describe("AntigravityRuntime", () => {
  let promptId: number;
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (command, payload) => {
      if (command === "readany_acp_open") return { processId: "process" };
      if (command !== "readany_acp_send") return;
      const { id, method, params } = payload.packet;
      const respond = (result: unknown) => packet({ id, result });
      if (method === "initialize") respond(init);
      if (method === "session/new" || method === "session/load") {
        respond({ sessionId: "s", configOptions: config });
      }
      if (method === "session/set_config_option") {
        respond({
          configOptions: config.map((option) =>
            option.id === params.configId ? { ...option, currentValue: params.value } : option,
          ),
        });
      }
      if (method === "session/resume")
        packet({ id, error: { code: -32601, message: "Unsupported" } });
      if (method === "session/prompt") {
        promptId = id;
        expect(params.sessionId).toBe("s");
        packet({
          method: "session/update",
          params: {
            sessionId: "s",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "live" },
            },
          },
        });
        packet({
          id: "approve",
          method: "session/request_permission",
          params: { sessionId: "s", toolCall: { title: "Run fixture" } },
        });
        packet({
          method: "session/update",
          params: {
            sessionId: "foreign",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "ignore" },
            },
          },
        });
      }
      if (method === "session/cancel") {
        expect(id).toBeUndefined();
        packet({ id: promptId, result: { stopReason: "cancelled" } });
      }
    });
  });

  it("streams ACP updates before the reply, scopes them, approves, and cancels with a notification", async () => {
    const runtime = new AntigravityRuntime();
    const session = await runtime.start({ readingSessionId: "local", bookId: "book" });
    const cancel = new AbortController();
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.runTurn(session, "test", cancel.signal)) {
      events.push(event);
      if (event.type === "approvalRequested") {
        await runtime.respondToApproval(session, event.requestId, "deny");
        cancel.abort();
      }
    }
    expect(events.map((event) => event.type)).toEqual([
      "turnStarted",
      "textDelta",
      "approvalRequested",
      "turnFinished",
    ]);
    expect(events[1]).toMatchObject({ text: "live" });
    expect(events[events.length - 1]).toMatchObject({ outcome: "cancelled" });
    expect(mock.invoke).toHaveBeenCalledWith("readany_acp_approve", {
      processId: "process",
      requestId: "approve",
      decision: "deny",
    });
    await runtime.close();
  });

  it("falls back to load only for an unimplemented resume method", async () => {
    const runtime = new AntigravityRuntime();
    await runtime.resume(
      {
        runtimeId: "antigravity-acp",
        conversationId: "s",
        readingSessionId: "local",
      },
      { bookId: "book", readingSessionId: "local" },
    );
    expect(
      mock.invoke.mock.calls
        .filter(([, payload]) => payload?.packet)
        .map(([, payload]) => payload.packet.method),
    ).toEqual(["initialize", "session/resume", "session/load"]);
    await runtime.close();
  });

  it("uses discovered model choices and leaves execution modes out of the config UI", () => {
    expect(
      antigravityOptions(config).flatMap(({ options }) => options.map(({ value }) => value)),
    ).toEqual(["gemini-fixture"]);
  });
  it("launches the selected Full Access profile and restores its execution mode instead of Plan", async () => {
    const runtime = new AntigravityRuntime("full");
    await runtime.resume(
      {
        runtimeId: "antigravity-acp",
        conversationId: "s",
        readingSessionId: "local",
      },
      { bookId: "book", readingSessionId: "local" },
    );
    expect(mock.invoke).toHaveBeenCalledWith("readany_acp_open", {
      launch: expect.objectContaining({ permissionMode: "full" }),
    });
    expect(mock.invoke).toHaveBeenCalledWith("readany_acp_send", {
      processId: "process",
      packet: expect.objectContaining({
        method: "session/set_config_option",
        params: { sessionId: "s", configId: "mode", value: "accept-edits" },
      }),
    });
    await runtime.close();
  });
});
