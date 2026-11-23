import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCodexChat } from "@/hooks/use-codex-chat";
import { useDesktopCitationNavigation } from "@/hooks/use-desktop-citation-navigation";
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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

interface Props {
  reader?: ReaderChatContext;
  quote?: ReaderQuote;
  onConsumeQuote?: () => void;
  onCitationClick?: (part: CitationPart) => void;
}

export function CodexChatPanel({ reader, quote, onConsumeQuote, onCitationClick }: Props) {
  const { t } = useTranslation();
  const books = useLibraryStore((state) => state.books);
  const [scope, setScope] = useState<ReaderChatScope>("book");
  const [attached, setAttached] = useState<ReaderQuote>();
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const chat = useCodexChat();
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
  const viewingOperation = Boolean(active && active.id === chat.operation?.chatId);
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
    setIncludeAnnotations(false);
    if (scope === "selection") {
      setAttached(undefined);
      setScope("book");
    }
  }

  const preview =
    scope === "selection"
      ? readerTurnContext({ reader, scope, question: "", quote: activeQuote }).quotes
      : [];

  return (
    <section className="flex min-h-0 flex-1 flex-col">
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
          aria-label={t("chat.codexConversation")}
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
            onClick={() => {
              chat.showAtHome(bookId);
              useAppStore.getState().addTab({ id: "chat", type: "chat", title: t("sidebar.chat") });
            }}
          >
            {t("chat.codexContinueAtHome")}
          </button>
        )}
        {active?.session?.model && (
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
          {t(bookId ? "chat.codexBookSharing" : "chat.codexNativeWeb")}
        </p>
      </div>

      {chat.busy && !viewingOperation && (
        <output className="flex flex-wrap items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
          {t("chat.codexOtherChatRunning")}
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

      <div className="min-h-0 flex-1 overflow-hidden">
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
          <p className="text-sm font-medium">{t("chat.codexApproval")}</p>
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
            <DialogTitle>{t("chat.codexConfirmApproval")}</DialogTitle>
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

      {chat.error && (!chat.ready || viewingOperation) && (
        <p role="alert" className="px-4 py-1 text-sm text-destructive">
          {chat.error}
        </p>
      )}
      {isStreaming && chat.stopping && (
        <output className="px-4 py-1 text-xs text-muted-foreground">
          {t("chat.codexStopping")}
        </output>
      )}
      <div className="shrink-0 px-4 pb-3 pt-2">
        <ChatInput
          onSend={send}
          onStop={chat.stop}
          isStreaming={isStreaming}
          disabled={!chat.ready || (chat.busy && !viewingOperation) || missingSelection}
          quotes={preview}
          onRemoveQuote={() => {
            setAttached(undefined);
            setScope("book");
          }}
          showDeepThinking={false}
          placeholder={t("chat.codexAsk")}
        />
      </div>
    </section>
  );
}
