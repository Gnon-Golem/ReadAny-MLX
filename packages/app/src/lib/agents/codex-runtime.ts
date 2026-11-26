import type {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeOptions,
  AgentRuntimeSession,
} from "@readany/core/ai";
import { READANY_MCP_TOOLS } from "@readany/core/ai/tools/readany-tool-gateway";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";

type ObjectValue = Record<string, unknown>;
type Decision = "allow" | "deny" | "cancel";

interface Host {
  processId: string;
}

interface WireEvent {
  processId: string;
  packet?: unknown;
  closed?: boolean;
}

function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ActiveTurn {
  threadId: string;
  id: string;
  events: AgentRuntimeEvent[];
  wake?: () => void;
  interrupted: boolean;
  completed: boolean;
  items: Map<string, ObjectValue>;
}

const APPROVAL_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
];

function approvalDescription(method: string, params: ObjectValue, previous: ObjectValue): string {
  const detail =
    method === APPROVAL_METHODS[0]
      ? {
          command: params.command,
          cwd: params.cwd,
          reason: params.reason,
          network: params.networkApprovalContext,
        }
      : method === APPROVAL_METHODS[1]
        ? {
            changes: previous.changes,
            reason: params.reason,
            grantRoot: params.grantRoot,
          }
        : { permissions: params.permissions, cwd: params.cwd, reason: params.reason };
  return JSON.stringify(detail, null, 2);
}

export class CodexRuntime implements AgentRuntime {
  private host: Host | undefined;
  private unlisten: UnlistenFn | undefined;
  private counter = 0;
  private requests = new Map<
    number,
    { resolve: (value: ObjectValue) => void; reject: (error: Error) => void }
  >();
  private turn: ActiveTurn | undefined;
  private closed = false;

  private async open(options: AgentRuntimeOptions) {
    this.closed = false;
    const unlisten = await listen<WireEvent>("readany-codex-ipc", ({ payload }) =>
      this.receive(payload),
    );
    if (this.closed) {
      unlisten();
      throw new Error("Codex startup cancelled.");
    }
    this.unlisten = unlisten;
    try {
      const host = await invoke<Host>("readany_codex_open", {
        launch: {
          readingSessionId: options.readingSessionId,
          bookId: options.bookId,
          tools: READANY_MCP_TOOLS,
        },
      });
      if (this.closed) {
        await invoke("readany_codex_close", { processId: host.processId });
        throw new Error("Codex startup cancelled.");
      }
      this.host = host;
    } catch (error) {
      await this.closeHost();
      throw error;
    }
  }

  private async defaultModel(): Promise<string | undefined> {
    const { data } = await this.rpc("model/list", { limit: 50 });
    if (!Array.isArray(data)) return undefined;
    const available = data.map(object).filter((model) => !model.hidden && string(model.model));
    return string((available.find((model) => model.isDefault) ?? available[0])?.model) || undefined;
  }

  async start(options: AgentRuntimeOptions): Promise<AgentRuntimeSession> {
    await this.open(options);
    try {
      const model = await this.defaultModel();
      const response = await this.rpc("thread/start", { model, ephemeral: false });
      const conversationId = string(object(response.thread).id);
      if (!conversationId) throw new Error("Codex did not return a thread ID.");
      return {
        runtimeId: "codex-app-server",
        conversationId,
        model: string(response.model) || model,
        readingSessionId: options.readingSessionId,
      };
    } catch (error) {
      await this.closeHost();
      throw error;
    }
  }

  async resume(session: AgentRuntimeSession, options: AgentRuntimeOptions): Promise<void> {
    if (session.readingSessionId !== options.readingSessionId) {
      throw new Error("This Codex thread belongs to another ReadAny session.");
    }
    await this.open(options);
    try {
      const model = session.model ?? (await this.defaultModel());
      const response = await this.rpc("thread/resume", {
        threadId: session.conversationId,
        excludeTurns: true,
        model,
      });
      if (object(response.thread).id !== session.conversationId) {
        throw new Error("Codex returned a different thread while resuming.");
      }
    } catch (error) {
      await this.closeHost();
      throw error;
    }
  }

  async *runTurn(
    session: AgentRuntimeSession,
    prompt: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentRuntimeEvent> {
    if (this.turn) throw new Error("A Codex turn is already active.");
    signal.throwIfAborted();
    const turn: ActiveTurn = {
      threadId: session.conversationId,
      id: "",
      events: [],
      interrupted: false,
      completed: false,
      items: new Map(),
    };
    this.turn = turn;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const interrupt = () => {
      if (!turn.id || turn.completed || turn.interrupted) return;
      turn.interrupted = true;
      stopTimer = setTimeout(() => void this.closeHost(), 8_000);
      void this.rpc("turn/interrupt", { threadId: turn.threadId, turnId: turn.id }).catch(() =>
        this.closeHost(),
      );
    };
    signal.addEventListener("abort", interrupt);
    try {
      const response = await this.rpc("turn/start", {
        threadId: session.conversationId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
      });
      turn.id = string(object(response.turn).id) || turn.id;
      if (!turn.id && !turn.completed) throw new Error("Codex did not return a turn ID.");
      if (signal.aborted) interrupt();
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
      signal.removeEventListener("abort", interrupt);
      clearTimeout(stopTimer);
      if (this.turn === turn) this.turn = undefined;
    }
  }

  async respondToApproval(
    _session: AgentRuntimeSession,
    requestId: string,
    decision: Decision,
  ): Promise<void> {
    await invoke("readany_codex_approve", {
      processId: this.requireHost().processId,
      requestId: JSON.parse(requestId),
      decision,
    });
  }

  async close(_session?: AgentRuntimeSession): Promise<void> {
    await this.closeHost();
  }

  async resolveEvidence(evidenceId: string): Promise<ObjectValue> {
    return invoke<ObjectValue>("readany_codex_evidence", {
      processId: this.requireHost().processId,
      evidenceId,
    });
  }

  get connected(): boolean {
    return this.host !== undefined && !this.closed;
  }

  private requireHost(): Host {
    if (!this.host || this.closed) throw new Error("Codex App Server is disconnected.");
    return this.host;
  }

  private rpc(method: string, params: ObjectValue): Promise<ObjectValue> {
    const processId = this.requireHost().processId;
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.requests.delete(id);
      };
      const fail = (error: unknown) => {
        finish();
        reject(new Error(errorMessage(error)));
      };
      const timer = setTimeout(() => fail(`Codex ${method} timed out.`), 45_000);
      this.requests.set(id, {
        resolve: (result) => {
          finish();
          resolve(result);
        },
        reject: fail,
      });
      void invoke("readany_codex_send", { processId, packet: { id, method, params } }).catch(fail);
    });
  }

  private push(event: AgentRuntimeEvent) {
    const turn = this.turn;
    if (!turn || turn.completed) return;
    if (event.type === "turnFinished") turn.completed = true;
    turn.events.push(event);
    turn.wake?.();
    turn.wake = undefined;
  }

  private receive(event: WireEvent): void {
    if (event.processId !== this.host?.processId) return;
    if (event.closed) {
      void this.closeHost();
      return;
    }
    const packet = object(event.packet);
    const method = string(packet.method);
    if (!method) {
      const pending = typeof packet.id === "number" ? this.requests.get(packet.id) : undefined;
      if (packet.error)
        pending?.reject(new Error(string(object(packet.error).message) || "Codex request failed."));
      else pending?.resolve(object(packet.result));
      return;
    }
    const params = object(packet.params);
    const turn = this.turn;
    if (!turn || params.threadId !== turn.threadId) return;
    const turnData = object(params.turn);
    const turnId = string(params.turnId) || string(turnData.id) || turn.id;
    if (turn.id && turnId !== turn.id) return;
    if (turnId) turn.id = turnId;
    if (method === "turn/started") {
      this.push({ type: "turnStarted", turnId });
    } else if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
      this.push({ type: "textDelta", turnId, itemId: string(params.itemId), text: params.delta });
    } else if (method === "item/started" || method === "item/completed") {
      const item = object(params.item);
      const itemId = string(item.id);
      if (method === "item/started" && itemId) turn.items.set(itemId, item);
      if (
        method === "item/completed" &&
        item.type === "agentMessage" &&
        typeof item.text === "string"
      ) {
        this.push({ type: "textItemCompleted", turnId, itemId, text: item.text });
      } else if (
        item.type === "mcpToolCall" ||
        item.type === "webSearch" ||
        item.type === "commandExecution"
      ) {
        const name = item.type === "mcpToolCall" ? string(item.tool) : item.type;
        const status =
          method === "item/started" ? "started" : item.status === "failed" ? "failed" : "completed";
        this.push({ type: "toolStatus", turnId, itemId, name, status });
      }
    } else if (
      APPROVAL_METHODS.includes(method) &&
      (typeof packet.id === "number" || typeof packet.id === "string")
    ) {
      this.push({
        type: "approvalRequested",
        turnId,
        requestId: JSON.stringify(packet.id),
        description: approvalDescription(
          method,
          params,
          turn.items.get(string(params.itemId)) ?? {},
        ),
      });
    } else if (method === "serverRequest/resolved" && params.requestId !== undefined) {
      this.push({ type: "approvalResolved", turnId, requestId: JSON.stringify(params.requestId) });
    } else if (method === "turn/completed") {
      const status = turnData.status;
      this.push({
        type: "turnFinished",
        turnId,
        outcome:
          status === "completed" ? "completed" : status === "interrupted" ? "cancelled" : "failed",
        message: string(object(turnData.error).message) || undefined,
      });
    }
  }

  private async closeHost() {
    const processId = this.host?.processId;
    this.host = undefined;
    this.closed = true;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const pending of this.requests.values())
      pending.reject(new Error("Codex App Server disconnected."));
    const turn = this.turn;
    if (turn) {
      this.push({
        type: "turnFinished",
        turnId: turn.id,
        outcome: turn.interrupted ? "cancelled" : "failed",
        message: turn.interrupted ? undefined : "Codex App Server disconnected.",
      });
    }
    if (processId) await invoke("readany_codex_close", { processId }).catch(() => undefined);
  }
}
