import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgentChats } from "@/hooks/use-agent-chat";
import { useDesktopCitationNavigation } from "@/hooks/use-desktop-citation-navigation";
import { readAntigravityContextUsage } from "@/lib/agents/antigravity-context-usage";
import {
  ANTIGRAVITY_PERMISSIONS,
  type AntigravityPermissionMode,
  isAntigravityPermissionMode,
} from "@/lib/agents/antigravity-permissions";
import type { ExternalAgent } from "@/lib/agents/desktop-runtime";
import {
  type ReaderChatContext,
  type ReaderChatScope,
  type ReaderQuote,
  readerTurnContext,
} from "@/lib/agents/reader-chat-context";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import type { CitationPart } from "@readany/core/types";
import { convertToMessageV2 } from "@readany/core/utils";
import { Eye, Lock, MessageCirclePlus, Shield, ShieldAlert } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AntigravityContextControl,
  AntigravityModelControl,
  chatPill,
} from "./AntigravityComposer";
import { ChatExportButton } from "./ChatExportButton";
import { ChatInput } from "./ChatInput";
import { ChatOptionPicker } from "./ChatOptionPicker";
import { MessageList } from "./MessageList";
import { SidebarChatHistory } from "./SidebarChatHistory";

interface Props {
  runtime: ExternalAgent;
  tabId?: string;
  reader?: ReaderChatContext;
  quote?: ReaderQuote;
  onConsumeQuote?: () => void;
  onCitationClick?: (part: CitationPart) => void;
  modelSelector?: ReactNode;
  readerHeader?: (continueAtHome?: () => void) => ReactNode;
}

export function ExternalAgentChatPanel({
  runtime,
  tabId = "chat",
  reader,
  quote,
  onConsumeQuote,
  onCitationClick,
  modelSelector,
  readerHeader,
}: Props) {
  const { t } = useTranslation();
  const books = useLibraryStore((state) => state.books);
  const [scope, setScope] = useState<ReaderChatScope>("book");
  const [attached, setAttached] = useState<ReaderQuote>();
  const [includeAnnotations, setIncludeAnnotations] = useState(runtime === "antigravity");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const redesigned = runtime === "antigravity";
  const chat = useAgentChats().runtimes[runtime];
  const agent = runtime === "codex" ? "Codex" : "Antigravity";
  const openCitation = useDesktopCitationNavigation();
  const bookId = reader
    ? scope === "global"
      ? undefined
      : reader.bookId
    : (chat.homeBook ?? chat.history[0]?.bookId ?? "") || undefined;
  const history = chat.history.filter((record) => record.bookId === bookId);
  const selection = chat.selections[bookId ?? ""];
  const active =
    selection === null
      ? undefined
      : (history.find((record) => record.id === selection) ?? history[0]);
  const storedPermission = active?.permissionMode;
  const permissionMode = active
    ? isAntigravityPermissionMode(storedPermission)
      ? storedPermission
      : "default"
    : chat.lastPermissionMode;
  const config =
    chat.configuration?.chatId === active?.id ? chat.configuration?.options : undefined;
  const model =
    config?.find((option) => option.id === "model")?.currentValue ?? active?.session?.model;
  const liveContextUsage =
    chat.contextUsage?.chatId === active?.id && chat.contextUsage?.model === model
      ? chat.contextUsage?.usage
      : undefined;
  const savedContextUsage =
    redesigned && !liveContextUsage && active && model
      ? readAntigravityContextUsage(active.id, model)
      : undefined;
  const visibleConversation = useMemo(
    () => ({
      messages: active?.messages.length ?? 0,
      characters:
        active?.messages.reduce(
          (total, message) => total + Array.from(message.content ?? "").length,
          0,
        ) ?? 0,
    }),
    [active?.messages],
  );
  const viewingOperation = chat.operation
    ? active
      ? active.id === chat.operation.chatId
      : chat.busy && chat.operation.bookId === bookId
    : false;
  const isStreaming = chat.busy && viewingOperation;
  const approvals = isStreaming ? chat.approvals : [];
  const pendingConfirmation = approvals.find((item) => item.requestId === confirmId);
  const messages = convertToMessageV2([
    ...(active?.messages ?? []),
    ...(viewingOperation && chat.partial ? [chat.partial] : []),
  ]);
  const activeQuote = attached?.bookId === reader?.bookId ? attached : undefined;
  const canSelect = Boolean(activeQuote?.text || reader?.selectedText.trim());
  const missingSelection = scope === "selection" && !canSelect;

  useEffect(() => {
    if (quote && quote.bookId === reader?.bookId) {
      setAttached(quote);
      setScope("selection");
      onConsumeQuote?.();
    }
  }, [quote, reader?.bookId, onConsumeQuote]);

  const foreground = useAppStore((state) => state.activeTabId === tabId);
  const attempted = useRef<string | undefined>(undefined);
  const activeId = active?.id ?? null;
  const target = JSON.stringify([bookId, activeId, permissionMode]);
  useEffect(() => {
    if (!foreground || !redesigned) {
      attempted.current = undefined;
      return;
    }
    if (!chat.ready || chat.busy || chat.configuring) return;
    if (config) {
      attempted.current = target;
      return;
    }
    if (attempted.current === target) return;
    attempted.current = target;
    if (chat.error && chat.operation?.chatId === activeId) return;
    void chat.prepare(bookId, activeId, t("chat.newChat"));
  }, [
    activeId,
    bookId,
    chat.ready,
    chat.busy,
    chat.configuring,
    chat.error,
    chat.operation,
    chat.prepare,
    config,
    foreground,
    redesigned,
    t,
    target,
  ]);

  function send(text: string) {
    const annotationState = useAnnotationStore.getState();
    const { prompt, quotes } = readerTurnContext({
      reader,
      scope,
      question: text,
      quote: activeQuote,
      annotations: includeAnnotations ? annotationState : undefined,
    });
    void chat.send({ text, prompt, bookId, chatId: active?.id ?? null, quotes });
    if (!redesigned) setIncludeAnnotations(false);
    if (scope === "selection") {
      setAttached(undefined);
      setScope("book");
    }
  }

  function continueAtHome() {
    chat.showAtHome(bookId);
    useAppStore.getState().addTab({ id: "chat", type: "chat", title: t("sidebar.chat") });
  }

  const preview =
    scope === "selection"
      ? readerTurnContext({ reader, scope, question: "", quote: activeQuote }).quotes
      : [];

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {redesigned && readerHeader?.(reader && active ? continueAtHome : undefined)}
      {redesigned ? (
        <div className="relative flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/50 px-3 py-1.5">
          <SidebarChatHistory
            threads={history.map((record) => ({
              ...record,
              updatedAt:
                record.updatedAt ??
                record.messages[record.messages.length - 1]?.createdAt ??
                Date.now(),
            }))}
            activeId={active?.id}
            onSelect={(id) => chat.select(bookId, id)}
            onDelete={setDeleting}
            disabled={!chat.ready}
            deleteDisabled={chat.busy || chat.configuring}
          />
          {reader && scope !== "global" && (
            <label className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeAnnotations}
                onChange={(event) => setIncludeAnnotations(event.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="grid size-3.5 shrink-0 place-items-center rounded-full border border-current before:size-1.5 before:rounded-full before:bg-current before:opacity-0 peer-checked:text-primary peer-checked:before:opacity-100 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
              />
              {t("chat.readerIncludeAnnotations")}
            </label>
          )}
          <div className="ml-auto flex min-w-0 max-w-full items-center gap-1">
            {reader ? (
              <ChatOptionPicker
                label={t("chat.readerScope")}
                triggerClassName="max-w-[45%] shrink"
                value={scope}
                choices={[
                  { value: "book", label: t("chat.readerScopeBook") },
                  { value: "chapter", label: t("chat.readerScopeChapter") },
                  {
                    value: "selection",
                    label: t("chat.readerScopeSelection"),
                    disabled: !canSelect,
                  },
                  { value: "global", label: t("chat.readerScopeGlobal") },
                ]}
                onChange={setScope}
              />
            ) : (
              <select
                aria-label={t("chat.codexBook")}
                className={`${chatPill} max-w-32 truncate`}
                value={bookId ?? ""}
                onChange={(event) => chat.setHomeBook(event.target.value)}
              >
                <option value="">{t("chat.codexNoBook")}</option>
                {books
                  .filter((book) => book.syncStatus === "local")
                  .map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.meta.title}
                    </option>
                  ))}
                {bookId &&
                  !books.some((book) => book.id === bookId && book.syncStatus === "local") && (
                    <option value={bookId}>{t("chat.codexUnavailableBook")}</option>
                  )}
              </select>
            )}
            {modelSelector}
            <ChatExportButton messages={messages} title={active?.title || t("chat.aiAssistant")} />
            <button
              type="button"
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("chat.newChat")}
              title={t("chat.newChat")}
              disabled={!chat.ready || chat.busy || chat.configuring}
              onClick={() => chat.select(bookId, null)}
            >
              <MessageCirclePlus className="size-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          {!reader && (
            <label className="flex min-w-0 items-center gap-2 text-sm">
              <span>{t("chat.codexBook")}</span>
              <select
                className="min-w-0 max-w-xs rounded-md border border-border bg-background px-2 py-1.5"
                value={bookId ?? ""}
                onChange={(event) => chat.setHomeBook(event.target.value)}
              >
                <option value="">{t("chat.codexNoBook")}</option>
                {books
                  .filter((book) => book.syncStatus === "local")
                  .map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.meta.title}
                    </option>
                  ))}
                {bookId &&
                  !books.some((book) => book.id === bookId && book.syncStatus === "local") && (
                    <option value={bookId}>{t("chat.codexUnavailableBook")}</option>
                  )}
              </select>
            </label>
          )}

          {reader && (
            <select
              aria-label={t("chat.readerScope")}
              className="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={scope}
              onChange={(event) => setScope(event.target.value as ReaderChatScope)}
            >
              <option value="book">{t("chat.readerScopeBook")}</option>
              <option value="chapter">{t("chat.readerScopeChapter")}</option>
              <option value="selection" disabled={!canSelect}>
                {t("chat.readerScopeSelection")}
              </option>
              <option value="global">{t("chat.readerScopeGlobal")}</option>
            </select>
          )}

          <select
            aria-label={t("chat.codexConversation", { agent })}
            className="min-w-0 max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={active?.id ?? ""}
            disabled={!chat.ready}
            onChange={(event) => chat.select(bookId, event.target.value || null)}
          >
            <option value="">{t("chat.newChat")}</option>
            {history.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
          {reader && active && (
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={continueAtHome}
            >
              {t("chat.codexContinueAtHome")}
            </button>
          )}
          {runtime === "codex" && active?.session?.model && (
            <span className="truncate text-xs text-muted-foreground">{active.session.model}</span>
          )}
          {reader && scope !== "global" && (
            <label className="flex basis-full items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeAnnotations}
                onChange={(event) => setIncludeAnnotations(event.target.checked)}
              />
              {t("chat.readerIncludeAnnotations")}
            </label>
          )}
          <p className="basis-full text-xs text-muted-foreground">
            {t(bookId ? "chat.codexBookSharing" : "chat.codexNativeWeb", { agent })}
          </p>
        </div>
      )}

      {redesigned && (
        <Dialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("chat.deleteThread")}</DialogTitle>
              <DialogDescription>{t("chat.deleteThreadConfirm")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={chat.busy || chat.configuring}
                onClick={() => {
                  if (deleting) void chat.removeChat(bookId, deleting);
                  setDeleting(null);
                }}
              >
                {t("chat.deleteThread")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {chat.busy && !viewingOperation && (
        <output className="flex flex-wrap items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
          {t("chat.codexOtherChatRunning", { agent })}
          {chat.operation && (!reader || chat.operation.bookId === bookId) && (
            <button
              type="button"
              className="text-primary underline"
              onClick={() => {
                if (!chat.operation) return;
                if (!reader) chat.setHomeBook(chat.operation.bookId ?? "");
                chat.select(chat.operation.bookId, chat.operation.chatId);
              }}
            >
              {t("chat.codexViewRunningChat")}
            </button>
          )}
        </output>
      )}

      <div
        className={`min-h-0 min-w-0 flex-1 overflow-hidden ${redesigned ? "[overflow-wrap:anywhere] [&_td]:min-w-24 [&_th]:min-w-24" : ""}`}
      >
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          currentStep={viewingOperation ? chat.step : "idle"}
          onCitationClick={(part) => {
            if (part.bookId === reader?.bookId && onCitationClick) onCitationClick(part);
            else void openCitation(part);
          }}
        />
      </div>

      {approvals.map((request) => (
        <div
          key={request.requestId}
          role="alert"
          className="mx-4 my-1 rounded-lg border border-border bg-muted/60 p-3"
        >
          <p className="text-sm font-medium">{t("chat.codexApproval", { agent })}</p>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">
            {request.description}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setConfirmId(request.requestId)}>
              {t("chat.codexAllowOnce")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void chat.approve(request.requestId, "deny")}
            >
              {t("chat.codexDeny")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void chat.approve(request.requestId, "cancel")}
            >
              {t("chat.codexCancelTurn")}
            </Button>
          </div>
        </div>
      ))}

      <Dialog
        open={Boolean(pendingConfirmation)}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chat.codexConfirmApproval", { agent })}</DialogTitle>
            <DialogDescription>{t("chat.codexAllowOnce")}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
            {pendingConfirmation?.description}
          </pre>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmId(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pendingConfirmation) void chat.approve(pendingConfirmation.requestId, "allow");
                setConfirmId(null);
              }}
            >
              {t("chat.codexConfirmAllow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {chat.error &&
        (!chat.ready ||
          viewingOperation ||
          ((redesigned || !active) && chat.operation?.bookId === bookId)) && (
          <p role="alert" className="px-4 py-1 text-sm text-destructive">
            {chat.error}
          </p>
        )}
      {isStreaming && chat.stopping && (
        <output className="px-4 py-1 text-xs text-muted-foreground">
          {t("chat.codexStopping", { agent })}
        </output>
      )}
      <div className="shrink-0 px-4 pb-3 pt-2">
        <ChatInput
          onSend={send}
          onStop={chat.stop}
          isStreaming={isStreaming}
          disabled={
            !chat.ready || (chat.busy && !viewingOperation) || missingSelection || chat.configuring
          }
          quotes={preview}
          onRemoveQuote={() => {
            setAttached(undefined);
            setScope("book");
          }}
          showDeepThinking={false}
          controls={
            redesigned
              ? {
                  leading: (
                    <AntigravityPermissionsControl
                      key={active?.id ?? bookId ?? "global"}
                      mode={permissionMode}
                      disabled={!chat.ready || chat.busy || chat.configuring}
                      onSelect={(mode) =>
                        void chat.setPermission(bookId, active?.id ?? null, mode, t("chat.newChat"))
                      }
                    />
                  ),
                  trailing: (
                    <>
                      <AntigravityContextControl
                        usage={liveContextUsage ?? savedContextUsage}
                        cached={Boolean(savedContextUsage)}
                        visibleConversation={visibleConversation}
                      />
                      <AntigravityModelControl
                        options={config}
                        connecting={foreground && chat.busy && chat.step === "idle"}
                        disabled={!chat.ready || chat.busy || chat.configuring}
                        onConnect={() =>
                          void chat.prepare(bookId, active?.id ?? null, t("chat.newChat"))
                        }
                        onChange={(id, value) => {
                          if (active) void chat.setConfig(active.id, id, value);
                        }}
                      />
                    </>
                  ),
                }
              : undefined
          }
          placeholder={t("chat.codexAsk", { agent })}
        />
      </div>
    </section>
  );
}

const permissionIcons = {
  review: Eye,
  default: Lock,
  auto: Shield,
  full: ShieldAlert,
} as const;

function AntigravityPermissionsControl({
  mode,
  disabled,
  onSelect,
}: {
  mode: AntigravityPermissionMode;
  disabled: boolean;
  onSelect: (mode: AntigravityPermissionMode) => void;
}) {
  const { t } = useTranslation();
  const [confirmFull, setConfirmFull] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <ChatOptionPicker
        label={t("chat.antigravityPermissions.label")}
        value={mode}
        side="top"
        disabled={disabled}
        choices={ANTIGRAVITY_PERMISSIONS.map((permission) => ({
          value: permission,
          label: t(`chat.antigravityPermissions.modes.${permission}`),
          icon: permissionIcons[permission],
          destructive: permission === "full",
        }))}
        onChange={(value) => {
          if (value === mode) return;
          if (value === "full") setConfirmFull(true);
          else onSelect(value);
        }}
      />
      <Dialog open={confirmFull} onOpenChange={setConfirmFull}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chat.antigravityPermissions.enableFull")}</DialogTitle>
            <DialogDescription>
              {t("chat.antigravityPermissions.fullDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmFull(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                onSelect("full");
                setConfirmFull(false);
              }}
            >
              {t("chat.antigravityPermissions.confirmFull")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
