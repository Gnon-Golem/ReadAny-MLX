import { citeAgentAnswer } from "@/lib/agents/agent-citations";
import {
  type AntigravityContextUsage,
  clearAntigravityContextUsage,
  readAntigravityContextUsage,
  saveAntigravityContextUsage,
} from "@/lib/agents/antigravity-context-usage";
import {
  ANTIGRAVITY_PERMISSION_PREFERENCE,
  type AntigravityPermissionMode,
  isAntigravityPermissionMode,
} from "@/lib/agents/antigravity-permissions";
import { AntigravityRuntime, type AntigravitySelection } from "@/lib/agents/antigravity-runtime";
import { CodexRuntime } from "@/lib/agents/codex-runtime";
import type {
  AgentConfigOption,
  DesktopAgentRuntime,
  ExternalAgent,
} from "@/lib/agents/desktop-runtime";
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

export interface AgentChat {
  id: string;
  bookId?: string;
  title: string;
  updatedAt?: number;
  session?: AgentRuntimeSession;
  permissionMode?: AntigravityPermissionMode;
  thoughtLevel?: string;
  messages: Message[];
}

const antigravitySelectionKey = "readany-antigravity-last-config";

function lastAntigravitySelection(history: AgentChat[]): AntigravitySelection | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(antigravitySelectionKey) ?? "null");
    if (typeof saved?.model === "string" && saved.model) {
      return {
        model: saved.model,
        thoughtLevel: typeof saved.thoughtLevel === "string" ? saved.thoughtLevel : undefined,
      };
    }
  } catch {
    // Older or invalid preferences can be recovered from the latest conversation.
  }
  const previous = history.find((chat) => chat.session?.model);
  return previous
    ? { model: previous.session?.model, thoughtLevel: previous.thoughtLevel }
    : undefined;
}

type ApprovalRequest = Extract<AgentRuntimeEvent, { type: "approvalRequested" }>;
type Step = "thinking" | "tool_calling" | "responding" | "idle";
const writes: Record<ExternalAgent, Promise<void>> = {
  codex: Promise.resolve(),
  antigravity: Promise.resolve(),
};
const namespace = { codex: "readany_codex", antigravity: "readany_acp" } as const;

function saveHistory(agent: ExternalAgent, history: AgentChat[]): Promise<void> {
  const write = writes[agent].then(() =>
    invoke<void>(`${namespace[agent]}_history_save`, { history }),
  );
  writes[agent] = write.catch(() => undefined);
  return write;
}

async function loadHistory(agent: ExternalAgent): Promise<AgentChat[]> {
  await writes[agent];
  const decoded: unknown = await invoke(`${namespace[agent]}_history_load`);
  const runtimeId = agent === "codex" ? "codex-app-server" : "antigravity-acp";
  if (
    !Array.isArray(decoded) ||
    !decoded.every(
      (record: AgentChat | null) =>
        record &&
        typeof record.id === "string" &&
        typeof record.title === "string" &&
        Array.isArray(record.messages) &&
        (!record.session || record.session.runtimeId === runtimeId),
    )
  ) {
    throw new Error("Invalid saved agent history.");
  }
  return decoded;
}

function useAgentController(
  enabled: boolean,
  agent: ExternalAgent,
  requestHome: (runtime: ExternalAgent) => void,
) {
  const [homeBook, setHomeBook] = useState<string>();
  const [lastPermissionMode, setLastPermissionMode] = useState<AntigravityPermissionMode>(() => {
    const stored = localStorage.getItem(ANTIGRAVITY_PERMISSION_PREFERENCE);
    return isAntigravityPermissionMode(stored) ? stored : "default";
  });
  const [configuration, setConfiguration] = useState<{
    chatId: string;
    options: AgentConfigOption[];
  }>();
  const [contextUsage, setContextUsage] = useState<{
    chatId: string;
    model: string;
    usage: AntigravityContextUsage;
  }>();
  const [configuring, setConfiguring] = useState(false);
  const configLock = useRef(false);
  const [history, setHistory] = useState<AgentChat[]>([]);
  const historyRef = useRef<AgentChat[]>([]);
  const [selections, setSelections] = useState<Record<string, string | null>>(() => {
    if (agent !== "antigravity") return {};
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem("readany-antigravity-selected-chats") || "{}",
      );
      return value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).filter(([, id]) => id === null || typeof id === "string"),
          )
        : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (agent === "antigravity")
      localStorage.setItem("readany-antigravity-selected-chats", JSON.stringify(selections));
  }, [agent, selections]);
  const [operation, setOperation] = useState<{ chatId: string; bookId?: string }>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [partial, setPartial] = useState<Message | null>(null);
  const [error, setError] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const runtime = useRef<{
    client: DesktopAgentRuntime;
    chatId: string;
    permissionMode: AntigravityPermissionMode;
    session?: AgentRuntimeSession;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    let active = true;
    void loadHistory(agent)
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
  }, [enabled, agent]);

  async function persist(chat: AgentChat) {
    const next = [chat, ...historyRef.current.filter((record) => record.id !== chat.id)];
    await saveHistory(agent, next);
    historyRef.current = next;
    if (mounted.current) setHistory(next);
  }

  function select(bookId: string | undefined, chatId: string | null) {
    setSelections((current) => ({ ...current, [bookId ?? ""]: chatId }));
  }

  function findChat(bookId: string | undefined, chatId: string | null) {
    return historyRef.current.find((record) => record.id === chatId && record.bookId === bookId);
  }

  function getChat(bookId: string | undefined, chatId: string | null, title: string): AgentChat {
    return (
      findChat(bookId, chatId) ?? {
        id: crypto.randomUUID(),
        bookId,
        title,
        updatedAt: Date.now(),
        permissionMode: agent === "antigravity" ? lastPermissionMode : undefined,
        messages: [],
      }
    );
  }

  async function setPermission(
    bookId: string | undefined,
    chatId: string | null,
    permissionMode: AntigravityPermissionMode,
    title: string,
  ) {
    if (agent !== "antigravity" || !ready || controller.current || configLock.current) return;
    configLock.current = true;
    setConfiguring(true);
    setError("");
    const active = findChat(bookId, chatId);
    try {
      if (active || permissionMode === "full") {
        const chat = active ?? getChat(bookId, chatId, title);
        setOperation({ chatId: chat.id, bookId });
        const running = runtime.current;
        if (running?.chatId === chat.id && running.permissionMode !== permissionMode) {
          await running.client.close(running.session);
          runtime.current = null;
          setConfiguration(undefined);
          setContextUsage(undefined);
        }
        const next = [
          { ...chat, permissionMode },
          ...historyRef.current.filter((record) => record.id !== chat.id),
        ];
        await saveHistory(agent, next);
        historyRef.current = next;
        if (mounted.current) {
          setHistory(next);
          select(bookId, chat.id);
        }
      }
      localStorage.setItem(ANTIGRAVITY_PERMISSION_PREFERENCE, permissionMode);
      if (mounted.current) setLastPermissionMode(permissionMode);
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setConfiguring(false);
      configLock.current = false;
    }
  }

  async function removeChat(bookId: string | undefined, chatId: string) {
    if (
      agent !== "antigravity" ||
      !ready ||
      controller.current ||
      configLock.current ||
      !findChat(bookId, chatId)
    )
      return;
    configLock.current = true;
    setConfiguring(true);
    setOperation({ chatId, bookId });
    setError("");
    try {
      const running = runtime.current;
      if (running?.chatId === chatId) {
        await running.client.close(running.session);
        runtime.current = null;
        setConfiguration(undefined);
        setContextUsage(undefined);
      }
      const next = historyRef.current.filter((record) => record.id !== chatId);
      await saveHistory(agent, next);
      clearAntigravityContextUsage(chatId);
      historyRef.current = next;
      if (mounted.current) {
        setHistory(next);
        setSelections((current) => {
          const key = bookId ?? "";
          if (current[key] !== chatId) return current;
          const updated = { ...current };
          delete updated[key];
          return updated;
        });
      }
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setConfiguring(false);
      configLock.current = false;
    }
  }

  async function connect(chat: AgentChat, signal: AbortSignal) {
    await startDesktopReadingMcp();
    signal.throwIfAborted();
    const permissionMode = isAntigravityPermissionMode(chat.permissionMode)
      ? chat.permissionMode
      : "default";
    let running = runtime.current;
    if (
      !running ||
      running.chatId !== chat.id ||
      !running.client.connected ||
      running.permissionMode !== permissionMode
    ) {
      setConfiguration(undefined);
      setContextUsage(undefined);
      if (running) await running.client.close(running.session);
      signal.throwIfAborted();
      const client: DesktopAgentRuntime =
        agent === "codex"
          ? new CodexRuntime()
          : new AntigravityRuntime(
              permissionMode,
              (options) => {
                if (mounted.current && runtime.current?.client === client)
                  setConfiguration(options ? { chatId: chat.id, options } : undefined);
              },
              (usage) => {
                if (
                  !mounted.current ||
                  runtime.current?.client !== client ||
                  !(client instanceof AntigravityRuntime)
                )
                  return;
                const { model } = client.selection;
                if (!model) return;
                setContextUsage({ chatId: chat.id, model, usage });
                saveAntigravityContextUsage(chat.id, model, usage);
              },
              chat.session
                ? { model: chat.session.model, thoughtLevel: chat.thoughtLevel }
                : lastAntigravitySelection(historyRef.current),
            );
      running = { client, chatId: chat.id, permissionMode };
      runtime.current = running;
      const options = { readingSessionId: chat.id, bookId: chat.bookId };
      try {
        if (chat.session) {
          await client.resume(chat.session, options);
          running.session = chat.session;
        } else {
          running.session = await client.start(options);
        }
        signal.throwIfAborted();
        if (client instanceof AntigravityRuntime) {
          const selection = client.selection;
          if (
            chat.session?.model &&
            chat.session.model !== selection.model &&
            readAntigravityContextUsage(chat.id, chat.session.model)
          ) {
            clearAntigravityContextUsage(chat.id);
          }
          running.session = { ...running.session, model: selection.model };
          if (
            !chat.session ||
            selection.model !== chat.session.model ||
            selection.thoughtLevel !== chat.thoughtLevel
          ) {
            await persist({
              ...chat,
              session: running.session,
              thoughtLevel: selection.thoughtLevel,
            });
          }
          if (selection.model)
            localStorage.setItem(antigravitySelectionKey, JSON.stringify(selection));
        } else if (!chat.session) {
          await persist({ ...chat, session: running.session });
        }
      } catch (error) {
        await client.close(running.session);
        if (runtime.current === running) {
          runtime.current = null;
          setConfiguration(undefined);
          setContextUsage(undefined);
        }
        throw error;
      }
    }
    signal.throwIfAborted();
    if (!running.session) throw new Error("Could not initialize the agent conversation.");
    return {
      client: running.client,
      session: running.session,
      thoughtLevel:
        running.client instanceof AntigravityRuntime
          ? running.client.selection.thoughtLevel
          : undefined,
    };
  }

  async function prepare(bookId: string | undefined, chatId: string | null, title: string) {
    if (controller.current || configLock.current || !ready) return;
    const abort = new AbortController();
    controller.current = abort;
    const chat = getChat(bookId, chatId, title);
    setOperation({ chatId: chat.id, bookId });
    setError("");
    setBusy(true);
    try {
      if (agent === "antigravity" && !chatId) {
        // Record the inherited permission before the native host validates this chat and book.
        await persist(chat);
        const key = bookId ?? "";
        if (!abort.signal.aborted) {
          setSelections((current) =>
            current[key] === selections[key] ? { ...current, [key]: chat.id } : current,
          );
        }
      }
      await connect(chat, abort.signal);
      if (agent === "codex") select(bookId, chat.id);
    } catch (error) {
      if (!abort.signal.aborted && mounted.current) setError(String(error));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setStopping(false);
      }
      if (controller.current === abort) controller.current = null;
    }
  }

  async function setConfig(chatId: string, id: string, value: string) {
    const running = runtime.current;
    if (
      configLock.current ||
      controller.current ||
      running?.chatId !== chatId ||
      !running?.session ||
      !running.client.setConfigOption
    )
      return;
    configLock.current = true;
    setConfiguring(true);
    const chat = historyRef.current.find((record) => record.id === chatId);
    setOperation({ chatId, bookId: chat?.bookId });
    setError("");
    try {
      await running.client.setConfigOption(running.session, id, value);
      if (chat && running.client instanceof AntigravityRuntime) {
        if (id === "model") {
          const previousModel = running.session.model;
          if (previousModel && readAntigravityContextUsage(chatId, previousModel))
            clearAntigravityContextUsage(chatId);
          setContextUsage((current) =>
            current?.chatId === chatId && current.model === previousModel ? undefined : current,
          );
        }
        const selection = running.client.selection;
        running.session = { ...running.session, model: selection.model };
        await persist({ ...chat, session: running.session, thoughtLevel: selection.thoughtLevel });
        if (selection.model)
          localStorage.setItem(antigravitySelectionKey, JSON.stringify(selection));
      }
    } catch (error) {
      setError(String(error));
    } finally {
      if (mounted.current) setConfiguring(false);
      configLock.current = false;
    }
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
    if ((!text.trim() && quotes.length === 0) || controller.current || configLock.current || !ready)
      return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setStep("thinking");
    setError("");
    setApprovals([]);

    let chat = getChat(bookId, chatId, (text.trim() || quotes[0]?.text || "").slice(0, 70));
    if (chat.messages.length === 0)
      chat = { ...chat, title: (text.trim() || quotes[0]?.text || chat.title).slice(0, 70) };
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
      chat = { ...chat, updatedAt: user.createdAt, messages: [...chat.messages, user] };
      await persist(chat);
      const running = await connect(chat, abort.signal);
      chat = { ...chat, session: running.session, thoughtLevel: running.thoughtLevel };
      const request =
        agent === "antigravity" && chat.bookId
          ? `For this ReadAny chat, use the authorized ReadAny MCP for book passages. Cite only exact evidence IDs from ReadAny using [[book-1]] marks. Use Antigravity's own tools for public web searches. Keep private book excerpts and notes out of web queries unless I explicitly request it.\n\n${prompt}`
          : prompt;
      for await (const event of running.client.runTurn(running.session, request, abort.signal)) {
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
          const completed = await citeAgentAnswer(
            assistant,
            (id) => {
              if (!active) return Promise.reject(new Error("No Codex client."));
              return active.resolveEvidence(id);
            },
            chat.bookId,
          );
          await persist({
            ...chat,
            updatedAt: Date.now(),
            messages: [...chat.messages, completed],
          });
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
    showAtHome(bookId: string | undefined) {
      setHomeBook(bookId ?? "");
      requestHome(agent);
    },
    history,
    selections,
    operation,
    select,
    removeChat,
    send,
    prepare,
    configuration,
    contextUsage,
    configuring,
    setConfig,
    lastPermissionMode,
    setPermission,
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

const AgentChatContext = createContext<{
  runtimes: Record<ExternalAgent, ReturnType<typeof useAgentController>>;
  homeRequest: { runtime: ExternalAgent } | null;
} | null>(null);

export function AgentChatProvider({ children }: { children: ReactNode }) {
  const enabled = useMlxDevelopmentBuild();
  const [homeRequest, setHomeRequest] = useState<{ runtime: ExternalAgent } | null>(null);
  const requestHome = (runtime: ExternalAgent) => setHomeRequest({ runtime });
  const codex = useAgentController(enabled, "codex", requestHome);
  const antigravity = useAgentController(enabled, "antigravity", requestHome);
  return createElement(
    AgentChatContext.Provider,
    {
      value: { runtimes: { codex, antigravity }, homeRequest },
    },
    children,
  );
}

export function useAgentChats() {
  const controller = useContext(AgentChatContext);
  if (!controller) throw new Error("Agent chat requires its application provider.");
  return controller;
}
