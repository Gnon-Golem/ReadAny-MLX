import type { AgentRuntimeEvent } from "@readany/core/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexRuntime, citeCodexAnswer } from "./codex-runtime";

const mock = vi.hoisted(() => ({
  receive: undefined as ((event: { payload: unknown }) => void) | undefined,
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

function wire(packet: unknown) {
  mock.receive?.({ payload: { processId: "process", packet } });
}

const options = { readingSessionId: "local-session", bookId: "local-book" };
const threadId = "external-thread";
const turnId = "external-turn";

describe("CodexRuntime", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (command, args) => {
      if (command === "readany_codex_open") return { processId: "process" };
      if (command !== "readany_codex_send") return;
      const { id, method, params } = args.packet;
      if (method === "initialized") return;
      if (method === "model/list") {
        wire({ id, result: { data: [{ model: "native", isDefault: true, hidden: false }] } });
      } else if (method === "thread/start" || method === "thread/resume") {
        wire({ id, result: { thread: { id: threadId }, model: "native" } });
      } else if (method === "turn/start") {
        wire({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
        wire({
          method: "item/agentMessage/delta",
          params: { threadId, turnId, itemId: "item", delta: "partial" },
        });
        wire({
          method: "item/agentMessage/delta",
          params: { threadId: "other", turnId, itemId: "other", delta: "foreign" },
        });
        wire({
          method: "item/commandExecution/requestApproval",
          id: 42,
          params: { threadId, turnId, itemId: "command", command: "printf fixture" },
        });
        wire({ id, result: { turn: { id: turnId } } });
      } else if (method === "turn/interrupt") {
        expect(params.turnId).toBe(turnId);
        wire({ id, result: {} });
        wire({
          method: "turn/completed",
          params: { threadId, turn: { id: turnId, status: "interrupted" } },
        });
      } else {
        wire({ id, result: {} });
      }
    });
  });

  it("correlates early deltas and approvals, interrupts, and resumes the same thread", async () => {
    const runtime = new CodexRuntime();
    const session = await runtime.start(options);
    const controller = new AbortController();
    const results: AgentRuntimeEvent[] = [];
    for await (const event of runtime.runTurn(session, "fixture", controller.signal)) {
      results.push(event);
      if (event.type === "approvalRequested") {
        await runtime.respondToApproval(session, event.requestId, "deny");
        controller.abort();
      }
    }
    expect(results.map((event) => event.type)).toEqual([
      "turnStarted",
      "textDelta",
      "approvalRequested",
      "turnFinished",
    ]);
    expect(results[1]).toMatchObject({ text: "partial" });
    expect(results[results.length - 1]).toMatchObject({ outcome: "cancelled" });
    expect(mock.invoke).toHaveBeenCalledWith("readany_codex_approve", {
      processId: "process",
      requestId: 42,
      decision: "deny",
    });
    await runtime.close(session);
    const reopened = new CodexRuntime();
    await reopened.resume(session, options);
    expect(mock.invoke).toHaveBeenCalledWith(
      "readany_codex_send",
      expect.objectContaining({
        packet: expect.objectContaining({
          method: "thread/resume",
          params: { threadId, model: "native", excludeTurns: true },
        }),
      }),
    );
    await reopened.close(session);
  });
});

it("links only exact evidence issued for the authorized book", async () => {
  const message = {
    id: "m",
    threadId: "t",
    role: "assistant" as const,
    content: "a [[book-1]] b [[book-2]] c [[book-999]]",
    createdAt: 0,
  };
  const result = await citeCodexAnswer(
    message,
    async (id) => ({
      evidenceId: id,
      bookId: id === "book-1" ? "local-book" : "other",
      cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
      chapterIndex: 1,
      chapterTitle: "Fixture",
      text: "Passage",
    }),
    "local-book",
  );
  expect(result.content).toBe("a [1] b  c ");
  expect(result.partsOrder?.filter((part) => part.type === "citation")).toEqual([
    expect.objectContaining({ id: "book-1", bookId: "local-book", citationIndex: 1 }),
  ]);
});
