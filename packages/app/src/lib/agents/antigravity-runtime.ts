import type { AgentRuntimeEvent, AgentRuntimeOptions, AgentRuntimeSession } from "@readany/core/ai";
import { READANY_MCP_TOOLS } from "@readany/core/ai/tools/readany-tool-gateway";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import type { AgentConfigOption, DesktopAgentRuntime } from "./desktop-runtime";

type Obj = Record<string, unknown>;
type Decision = "allow" | "deny" | "cancel";
type Reply = { resolve(value: Obj): void; reject(error: Error): void };
type WireEvent = { processId: string; packet?: unknown; closed?: boolean };

interface Turn {
  id: string;
  sessionId: string;
  events: AgentRuntimeEvent[];
  wake?: () => void;
  done: boolean;
  stopping: boolean;
  approvals: Set<string>;
  tools: Map<string, string>;
}

function object(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function description(tool: Obj): string {
  return JSON.stringify(
    {
      title: tool.title,
      kind: tool.kind,
      input: tool.rawInput,
      locations: tool.locations,
      content: tool.content,
    },
    null,
    2,
  );
}

/** Render negotiated choices within the safe modes and model family of a direct ACP client. */
export function antigravityOptions(value: unknown): AgentConfigOption[] {
  return list(value).flatMap((raw) => {
    const option = object(raw);
    const id = str(option.id);
    if (option.type !== "select" || !["model", "thought_level", "mode"].includes(id)) return [];
    const allowed = (value: string) =>
      value &&
      (id !== "mode" || ["default", "plan"].includes(value)) &&
      (id !== "model" || value.toLowerCase().startsWith("gemini-"));
    const options = list(option.options)
      .flatMap((entry) => {
        const item = object(entry);
        return Array.isArray(item.options) ? item.options.map(object) : [item];
      })
      .flatMap((item) =>
        allowed(str(item.value))
          ? [{ value: str(item.value), label: str(item.name) || str(item.value) }]
          : [],
      );
    return options.length
      ? [{ id, label: str(option.name) || id, currentValue: str(option.currentValue), options }]
      : [];
  });
}

class AcpError extends Error {
  constructor(
    readonly code: unknown,
    message: string,
  ) {
    super(message);
  }
}

export class AntigravityRuntime implements DesktopAgentRuntime {
  private processId?: string;
  private unlisten?: UnlistenFn;
  private requestId = 0;
  private pending = new Map<number, Reply>();
  private capabilities: Obj = {};
  private options: AgentConfigOption[] = [];
  private sessionId?: string;
  private turn?: Turn;
  private closed = false;
  private closing?: Promise<void>;

  constructor(private readonly configChanged: (options: AgentConfigOption[]) => void = () => {}) {}

  get connected(): boolean {
    return Boolean(this.processId && !this.closed);
  }

  private async open(options: AgentRuntimeOptions) {
    const unlisten = await listen<WireEvent>("readany-acp-ipc", ({ payload }) =>
      this.receive(payload),
    );
    if (this.closed) {
      unlisten();
      throw new Error("Antigravity startup cancelled.");
    }
    this.unlisten = unlisten;
    const { processId } = await invoke<{ processId: string }>("readany_acp_open", {
      launch: {
        readingSessionId: options.readingSessionId,
        bookId: options.bookId,
        tools: READANY_MCP_TOOLS,
      },
    });
    if (this.closed) {
      await invoke("readany_acp_close", { processId });
      throw new Error("Antigravity startup cancelled.");
    }
    this.processId = processId;
    const init = await this.rpc("initialize", {});
    if (init.protocolVersion !== 1) throw new Error("Antigravity did not negotiate ACP version 1.");
    this.capabilities = object(init.agentCapabilities);
    if (options.bookId && object(this.capabilities.mcpCapabilities).http !== true)
      throw new Error("The installed Antigravity ACP server does not support HTTP MCP.");
  }

  async start(options: AgentRuntimeOptions): Promise<AgentRuntimeSession> {
    try {
      await this.open(options);
      const response = await this.rpc("session/new", {});
      await this.acceptSession(response);
      if (!this.sessionId) throw new Error("Antigravity did not return an ACP session ID.");
      return {
        runtimeId: "antigravity-acp",
        conversationId: this.sessionId,
        readingSessionId: options.readingSessionId,
        model: this.options.find((option) => option.id === "model")?.currentValue,
      };
    } catch (error) {
      await this.closeHost();
      throw error;
    }
  }

  async resume(session: AgentRuntimeSession, options: AgentRuntimeOptions): Promise<void> {
    if (
      session.runtimeId !== "antigravity-acp" ||
      session.readingSessionId !== options.readingSessionId
    ) {
      throw new Error("This Antigravity session belongs to another ReadAny chat.");
    }
    try {
      await this.open(options);
      const capabilities = object(this.capabilities.sessionCapabilities);
      const canLoad = this.capabilities.loadSession === true || Boolean(capabilities.load);
      const params = { sessionId: session.conversationId };
      let result: Obj | undefined;
      if (capabilities.resume) {
        try {
          result = await this.rpc("session/resume", params);
        } catch (error) {
          if (!(canLoad && error instanceof AcpError && error.code === -32601)) throw error;
        }
      }
      if (!result && canLoad) result = await this.rpc("session/load", params);
      if (!result) throw new Error("This Antigravity server cannot reopen ACP sessions.");
      await this.acceptSession(result, session.conversationId);
    } catch (error) {
      await this.closeHost();
      throw error;
    }
  }

  private async acceptSession(result: Obj, expected?: string) {
    const actual = str(result.sessionId);
    if (expected && actual && actual !== expected)
      throw new Error("Antigravity returned the wrong ACP session.");
    this.sessionId = actual || expected;
    this.updateOptions(result.configOptions);
    const mode = this.options.find((option) => option.id === "mode")?.currentValue;
    if (mode && !["default", "plan"].includes(mode) && this.sessionId)
      await this.applyConfiguration(this.sessionId, "mode", "default");
    const model = this.options.find((option) => option.id === "model");
    if (model && !model.options.some(({ value }) => value === model.currentValue) && this.sessionId)
      await this.applyConfiguration(this.sessionId, "model", model.options[0].value);
  }

  private updateOptions(value: unknown) {
    if (!Array.isArray(value)) return;
    this.options = antigravityOptions(value);
    this.configChanged(this.options);
  }

  private async applyConfiguration(sessionId: string, id: string, value: string) {
    const response = await this.rpc("session/set_config_option", {
      sessionId,
      configId: id,
      value,
    });
    this.updateOptions(response.configOptions);
    if (!this.options.some((option) => option.id === id && option.currentValue === value)) {
      throw new Error("Antigravity did not apply the selected option.");
    }
  }

  async setConfigOption(session: AgentRuntimeSession, id: string, value: string): Promise<void> {
    if (
      session.conversationId !== this.sessionId ||
      this.turn ||
      !this.options.some(
        (option) => option.id === id && option.options.some((choice) => choice.value === value),
      )
    )
      throw new Error("The Antigravity option is unavailable.");
    await this.applyConfiguration(session.conversationId, id, value);
  }

  async *runTurn(
    session: AgentRuntimeSession,
    text: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentRuntimeEvent> {
    if (this.turn || this.sessionId !== session.conversationId)
      throw new Error("The Antigravity session cannot start this turn.");
    signal.throwIfAborted();
    const turn: Turn = {
      id: crypto.randomUUID(),
      sessionId: session.conversationId,
      events: [],
      done: false,
      stopping: false,
      approvals: new Set(),
      tools: new Map(),
    };
    this.turn = turn;
    this.push({ type: "turnStarted", turnId: turn.id });
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      if (turn.done || turn.stopping) return;
      turn.stopping = true;
      for (const id of turn.approvals)
        void this.respondToApproval(session, id, "cancel").catch(() => {});
      void invoke("readany_acp_send", {
        processId: this.host(),
        packet: { method: "session/cancel", params: { sessionId: turn.sessionId } },
      }).catch(() => this.closeHost());
      stopTimer = setTimeout(() => void this.closeHost(), 8_000);
    };
    signal.addEventListener("abort", cancel);
    try {
      void this.rpc(
        "session/prompt",
        {
          sessionId: turn.sessionId,
          prompt: [{ type: "text", text }],
        },
        600_000,
      ).then(
        (result) => {
          const reason = str(result.stopReason);
          this.finish(
            turn,
            turn.stopping || reason === "cancelled"
              ? "cancelled"
              : reason === "end_turn"
                ? "completed"
                : "failed",
            reason && reason !== "end_turn" ? `Antigravity stopped (${reason}).` : undefined,
          );
        },
        (error) => {
          this.finish(
            turn,
            turn.stopping ? "cancelled" : "failed",
            error instanceof Error ? error.message : String(error),
          );
          if (error instanceof AcpError && error.code === "timeout") void this.closeHost();
        },
      );
      while (true) {
        const event = turn.events.shift();
        if (event) {
          yield event;
          if (event.type === "turnFinished") return;
        } else {
          await new Promise<void>((resolve) => {
            turn.wake = resolve;
          });
        }
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      clearTimeout(stopTimer);
      if (this.turn === turn) this.turn = undefined;
    }
  }

  async respondToApproval(
    session: AgentRuntimeSession,
    requestId: string,
    decision: Decision,
  ): Promise<void> {
    const turn = this.turn;
    if (turn?.sessionId !== session.conversationId || !turn.approvals.delete(requestId))
      throw new Error("The Antigravity approval is no longer pending.");
    await invoke("readany_acp_approve", {
      processId: this.host(),
      requestId: JSON.parse(requestId),
      decision,
    });
  }

  async resolveEvidence(evidenceId: string): Promise<Obj> {
    return invoke("readany_acp_evidence", { processId: this.host(), evidenceId });
  }

  async close(session?: AgentRuntimeSession) {
    if (
      session &&
      object(this.capabilities.sessionCapabilities).close &&
      this.connected &&
      !this.turn
    )
      await this.rpc("session/close", { sessionId: session.conversationId }, 1500).catch(() => {});
    await this.closeHost();
  }

  private host(): string {
    if (!this.processId || this.closed) throw new Error("Antigravity is disconnected.");
    return this.processId;
  }

  private rpc(method: string, params: Obj, timeout = 45_000): Promise<Obj> {
    const processId = this.host();
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.pending.delete(id);
      };
      const fail = (error: Error) => {
        finish();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new AcpError("timeout", `Antigravity ${method} timed out.`)),
        timeout,
      );
      this.pending.set(id, {
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: fail,
      });
      void invoke("readany_acp_send", { processId, packet: { id, method, params } }).catch(
        (error) => fail(new Error(String(error))),
      );
    });
  }

  private push(event: AgentRuntimeEvent) {
    const turn = this.turn;
    if (!turn || turn.done) return;
    turn.events.push(event);
    if (event.type === "turnFinished") turn.done = true;
    turn.wake?.();
    turn.wake = undefined;
  }

  private finish(turn: Turn, outcome: "completed" | "cancelled" | "failed", message?: string) {
    if (turn === this.turn) this.push({ type: "turnFinished", turnId: turn.id, outcome, message });
  }

  private receive(event: WireEvent) {
    if (!this.processId || event.processId !== this.processId) return;
    if (event.closed) {
      void this.closeHost();
      return;
    }
    const packet = object(event.packet);
    if (!packet.method && typeof packet.id === "number") {
      const pending = this.pending.get(packet.id);
      const error = object(packet.error);
      if (packet.error)
        pending?.reject(new AcpError(error.code, str(error.message) || "ACP request failed."));
      else pending?.resolve(object(packet.result));
      return;
    }

    const params = object(packet.params);
    if (params.sessionId !== this.sessionId) return;
    const update = object(params.update);
    if (packet.method === "session/update" && update.sessionUpdate === "config_option_update") {
      this.updateOptions(update.configOptions);
      return;
    }
    const turn = this.turn;
    if (!turn || turn.done || params.sessionId !== turn.sessionId) return;
    if (
      packet.method === "session/request_permission" &&
      (typeof packet.id === "number" || typeof packet.id === "string")
    ) {
      const requestId = JSON.stringify(packet.id);
      turn.approvals.add(requestId);
      if (turn.stopping) {
        const session = {
          conversationId: turn.sessionId,
          runtimeId: "antigravity-acp",
          readingSessionId: "",
        };
        void this.respondToApproval(session, requestId, "cancel").catch(() => {});
      } else {
        this.push({
          type: "approvalRequested",
          turnId: turn.id,
          requestId,
          description: description(object(params.toolCall)),
        });
      }
      return;
    }
    if (packet.method !== "session/update") return;
    if (update.sessionUpdate === "agent_message_chunk" && object(update.content).type === "text") {
      this.push({
        type: "textDelta",
        turnId: turn.id,
        itemId: turn.id,
        text: str(object(update.content).text),
      });
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const itemId = str(update.toolCallId);
      if (!itemId) return;
      const name =
        str(update.title) || turn.tools.get(itemId) || str(update.kind) || "Antigravity tool";
      turn.tools.set(itemId, name);
      const status =
        update.status === "completed"
          ? "completed"
          : update.status === "failed"
            ? "failed"
            : "started";
      this.push({ type: "toolStatus", turnId: turn.id, itemId, name, status });
    }
  }

  private closeHost(): Promise<void> {
    if (this.closing) return this.closing;
    const processId = this.processId;
    this.closed = true;
    this.processId = undefined;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const request of this.pending.values())
      request.reject(new Error("Antigravity disconnected."));
    const turn = this.turn;
    if (turn)
      this.finish(turn, turn.stopping ? "cancelled" : "failed", "Antigravity disconnected.");
    this.closing = processId
      ? invoke<void>("readany_acp_close", { processId }).catch(() => {})
      : Promise.resolve();
    return this.closing;
  }
}
