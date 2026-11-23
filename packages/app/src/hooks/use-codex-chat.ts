import { CodexRuntime, citeCodexAnswer } from "@/lib/agents/codex-runtime";
import { startDesktopReadingMcp } from "@/lib/agents/reading-mcp";
import { useMlxDevelopmentBuild } from "@/lib/macos-mlx-build";
import type { AgentRuntimeEvent, AgentRuntimeSession } from "@readany/core/ai";
import type { AttachedQuote, Message, ToolCall } from "@readany/core/types";
import { invoke } from "@tauri-apps/api/core";
import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface CodexChat {
  id: string;
  bookId?: string;
  title: string;
  session?: AgentRuntimeSession;
  messages: Message[];
}

type ApprovalRequest = Extract<AgentRuntimeEvent, { type: "approvalRequested" }>;
type Step = "thinking" | "tool_calling" | "responding" | "idle";
let writeQueue = Promise.resolve();

function saveHistory(history: CodexChat[]): Promise<void> {
  const write = writeQueue.then(() => invoke<void>("readany_codex_history_save", { history }));
  writeQueue = write.catch(() => undefined);
  return write;
}

async function loadHistory(): Promise<CodexChat[]> {
  await writeQueue;
  const decoded: unknown = await invoke("readany_codex_history_load");
  if (
    !Array.isArray(decoded) ||
    !decoded.every(
      (record: CodexChat | null) =>
        record &&
        typeof record.id === "string" &&
        typeof record.title === "string" &&
        Array.isArray(record.messages),
    )
  ) {
    throw new Error("Invalid saved Codex history.");
  }
  return decoded;
}

function useCodexController(enabled: boolean) {
  const [homeBook, setHomeBook] = useState<string>();
  const [homeRequest, setHomeRequest] = useState(0);
  const [history, setHistory] = useState<CodexChat[]>([]);
  const historyRef = useRef<CodexChat[]>([]);
  const [selections, setSelections] = useState<Record<string, string | null>>({});
  const [operation, setOperation] = useState<{ chatId: string; bookId?: string }>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [partial, setPartial] = useState<Message | null>(null);
  const [error, setError] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const runtime = useRef<{
    client: CodexRuntime;
    chatId: string;
    session?: AgentRuntimeSession;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    let active = true;
    void loadHistory()
      .then((items) => {
        if (active) {
          historyRef.current = items;
          setHistory(items);
          setReady(true);
        }
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
      mounted.current = false;
      controller.current?.abort();
      const host = runtime.current;
      runtime.current = null;
      void host?.client.close(host.session);
    };
  }, [enabled]);

  async function persist(chat: CodexChat) {
    const next = [chat, ...historyRef.current.filter((record) => record.id !== chat.id)];
    historyRef.current = next;
    if (mounted.current) setHistory(next);
    await saveHistory(next);
  }

  function select(bookId: string | undefined, chatId: string | null) {
    setSelections((current) => ({ ...current, [bookId ?? ""]: chatId }));
  }

  async function send({
    text,
    prompt,
    bookId,
    chatId,
    quotes = [],
  }: {
    text: string;
    prompt: string;
    bookId?: string;
    chatId: string | null;
    quotes?: AttachedQuote[];
  }): Promise<void> {
    if ((!text.trim() && quotes.length === 0) || controller.current || !ready) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setStep("thinking");
    setError("");
    setApprovals([]);

    let chat = historyRef.current.find(
      (record) => record.id === chatId && record.bookId === bookId,
    ) ?? {
      id: crypto.randomUUID(),
      bookId,
      title: (text.trim() || quotes[0]?.text || "").slice(0, 70),
      messages: [],
    };
    setOperation({ chatId: chat.id, bookId });
    const user: Message = {
      id: crypto.randomUUID(),
      threadId: chat.id,
      role: "user",
      content: text.trim(),
      createdAt: Date.now(),
      partsOrder: quotes.length
        ? [
            ...quotes.map((quote) => ({ ...quote, type: "quote" as const })),
            ...(text.trim()
              ? [{ type: "text" as const, id: crypto.randomUUID(), text: text.trim() }]
              : []),
          ]
        : undefined,
    };
    const assistant: Message = {
      id: crypto.randomUUID(),
      threadId: chat.id,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    const texts = new Map<string, string>();
    const calls = new Map<string, ToolCall>();
    const updatePartial = () => {
      assistant.content = [...texts.values()].filter(Boolean).join("\n\n");
      assistant.toolCalls = [...calls.values()];
      if (mounted.current) setPartial({ ...assistant });
    };

    try {
      select(bookId, chat.id);
      chat = { ...chat, messages: [...chat.messages, user] };
      await persist(chat);
      await startDesktopReadingMcp();
      abort.signal.throwIfAborted();

      let running = runtime.current;
      if (!running || running.chatId !== chat.id || !running.client.connected) {
        if (running) await running.client.close(running.session);
        abort.signal.throwIfAborted();
        const client = new CodexRuntime();
        running = { client, chatId: chat.id };
        runtime.current = running;
        const options = { readingSessionId: chat.id, bookId: chat.bookId };
        if (chat.session) {
          await client.resume(chat.session, options);
          running.session = chat.session;
        } else {
          running.session = await client.start(options);
          chat = { ...chat, session: running.session };
          await persist(chat);
        }
      }

      abort.signal.throwIfAborted();
      if (!running.session) throw new Error("Could not initialize the Codex conversation.");
      for await (const event of running.client.runTurn(running.session, prompt, abort.signal)) {
        switch (event.type) {
          case "textDelta":
          case "textItemCompleted":
            texts.set(
              event.itemId,
              event.type === "textDelta"
                ? (texts.get(event.itemId) ?? "") + event.text
                : event.text,
            );
            if (mounted.current) setStep("responding");
            updatePartial();
            break;
          case "toolStatus":
            calls.set(event.itemId, {
              id: event.itemId,
              name: event.name,
              args: {},
              status:
                event.status === "started"
                  ? "running"
                  : event.status === "failed"
                    ? "error"
                    : "completed",
            });
            if (mounted.current) setStep("tool_calling");
            updatePartial();
            break;
          case "approvalRequested":
            if (mounted.current && !abort.signal.aborted) {
              setApprovals((items) => [
                ...items.filter((item) => item.requestId !== event.requestId),
                event,
              ]);
            }
            break;
          case "approvalResolved":
            if (mounted.current)
              setApprovals((items) => items.filter((item) => item.requestId !== event.requestId));
            break;
          case "turnFinished":
            if (event.outcome === "failed") throw new Error(event.message || "Codex turn failed.");
            break;
        }
      }
    } catch (err) {
      if (!abort.signal.aborted && mounted.current)
        setError(err instanceof Error ? err.message : String(err));
      if (runtime.current?.client && !runtime.current.client.connected) {
        runtime.current = null;
      }
    } finally {
      try {
        if (mounted.current && (assistant.content || calls.size)) {
          const active = runtime.current?.client;
          const completed = await citeCodexAnswer(
            assistant,
            (id) => {
              if (!active) return Promise.reject(new Error("No Codex client."));
              return active.resolveEvidence(id);
            },
            chat.bookId,
          );
          await persist({ ...chat, messages: [...chat.messages, completed] });
        }
      } catch (err) {
        if (mounted.current) setError(String(err));
      }
      if (mounted.current) {
        setPartial(null);
        setApprovals([]);
        setBusy(false);
        setStopping(false);
        setStep("idle");
      }
      if (controller.current === abort) controller.current = null;
    }
  }

  function stop() {
    if (!controller.current) return;
    setStopping(true);
    setApprovals([]);
    controller.current.abort();
    const starting = runtime.current;
    if (starting && !starting.session) void starting.client.close();
  }

  async function approve(id: string, decision: "allow" | "deny" | "cancel") {
    const current = runtime.current;
    if (!current?.session) return;
    setApprovals((items) => items.filter((item) => item.requestId !== id));
    try {
      await current.client.respondToApproval(current.session, id, decision);
      if (decision === "cancel") stop();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    homeBook,
    setHomeBook,
    homeRequest,
    showAtHome(bookId: string | undefined) {
      setHomeBook(bookId ?? "");
      setHomeRequest((value) => value + 1);
    },
    history,
    selections,
    operation,
    select,
    send,
    stop,
    approve,
    busy,
    ready,
    stopping,
    step,
    partial,
    error,
    approvals,
  };
}

const CodexChatContext = createContext<ReturnType<typeof useCodexController> | null>(null);

export function CodexChatProvider({ children }: { children: ReactNode }) {
  const enabled = useMlxDevelopmentBuild();
  const controller = useCodexController(enabled);
  return createElement(CodexChatContext.Provider, { value: controller }, children);
}

export function useCodexChat() {
  const controller = useContext(CodexChatContext);
  if (!controller) throw new Error("Codex chat requires its application provider.");
  return controller;
}
