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
import { useLibraryStore } from "@/stores/library-store";
import { convertToMessageV2 } from "@readany/core/utils";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

export function CodexChatPanel({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const books = useLibraryStore((state) => state.books);
  const [bookId, setBookId] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const chat = useCodexChat();
  const openCitation = useDesktopCitationNavigation();
  const pendingConfirmation = chat.approvals.find((item) => item.requestId === confirmId);
  const active = chat.history.find(({ id }) => id === chat.selected);
  const messages = convertToMessageV2([
    ...(active?.messages ?? []),
    ...(chat.partial ? [chat.partial] : []),
  ]);

  useEffect(() => {
    onBusy(chat.busy);
  }, [chat.busy, onBusy]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <select
          aria-label={t("chat.codexConversation")}
          className="min-w-0 max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={chat.selected ?? ""}
          disabled={chat.busy || !chat.ready}
          onChange={(event) => chat.select(event.target.value || null)}
        >
          <option value="">{t("chat.newChat")}</option>
          {chat.history.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.title}
            </option>
          ))}
        </select>

        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span>{t("chat.codexBook")}</span>
          <select
            className="min-w-0 max-w-xs rounded-md border border-border bg-background px-2 py-1.5"
            value={active ? (active.bookId ?? "") : bookId}
            disabled={Boolean(active) || chat.busy}
            onChange={(event) => setBookId(event.target.value)}
          >
            <option value="">{t("chat.codexNoBook")}</option>
            {books
              .filter((book) => book.syncStatus === "local")
              .map((book) => (
                <option key={book.id} value={book.id}>
                  {book.meta.title}
                </option>
              ))}
            {active?.bookId &&
              !books.some((book) => book.id === active.bookId && book.syncStatus === "local") && (
                <option value={active.bookId}>{t("chat.codexUnavailableBook")}</option>
              )}
          </select>
        </label>
        <p className="basis-full text-xs text-muted-foreground">
          {t((active ? active.bookId : bookId) ? "chat.codexBookSharing" : "chat.codexNativeWeb")}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          isStreaming={chat.busy}
          currentStep={chat.step}
          onCitationClick={openCitation}
        />
      </div>

      {chat.approvals.map((request) => (
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

      {chat.error && (
        <p role="alert" className="px-4 py-1 text-sm text-destructive">
          {chat.error}
        </p>
      )}
      {chat.stopping && (
        <output className="px-4 py-1 text-xs text-muted-foreground">
          {t("chat.codexStopping")}
        </output>
      )}
      <div className="shrink-0 px-4 pb-3 pt-2">
        <ChatInput
          onSend={(prompt) => void chat.send(prompt, bookId || undefined)}
          onStop={chat.stop}
          isStreaming={chat.busy}
          disabled={!chat.ready}
          showDeepThinking={false}
          placeholder={t("chat.codexAsk")}
        />
      </div>
    </section>
  );
}
