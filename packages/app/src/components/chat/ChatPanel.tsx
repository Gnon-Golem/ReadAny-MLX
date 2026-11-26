/**
 * ChatPanel — book-scoped sidebar chat panel.
 */
import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
import { useDesktopResearchOptions } from "@/hooks/use-desktop-research-options";
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { Book, CitationPart } from "@readany/core/types";
import {
  convertToMessageV2,
  mergeMessagesWithStreaming,
  providerRequiresApiKey,
} from "@readany/core/utils";
import { MessageCirclePlus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatExportButton } from "./ChatExportButton";
import { type AttachedQuote, ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";
import { SidebarChatHistory } from "./SidebarChatHistory";

interface ChatPanelProps {
  book?: Book | null;
  quote?: AttachedQuote;
  modelSelector?: ReactNode;
  onConsumeQuote?: () => void;
  onNavigateToCitation?: (citation: CitationPart) => void;
}

export function ChatPanel({
  book,
  quote,
  modelSelector,
  onConsumeQuote,
  onNavigateToCitation,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const bookId = book?.id;

  const threads = useChatStore((s) => s.threads);
  const loadThreads = useChatStore((s) => s.loadThreads);
  const createThread = useChatStore((s) => s.createThread);
  const removeThread = useChatStore((s) => s.removeThread);
  const setBookActiveThread = useChatStore((s) => s.setBookActiveThread);
  const getActiveThreadId = useChatStore((s) => s.getActiveThreadId);
  const getThreadsForContext = useChatStore((s) => s.getThreadsForContext);

  // Use streaming chat hook with book context
  const research = useDesktopResearchOptions();
  const { isStreaming, currentMessage, currentStep, sendMessage, stopStream } = useStreamingChat({
    book: book || null,
    bookId,
    research,
  });

  // Load book threads on mount
  useEffect(() => {
    if (bookId) {
      loadThreads(bookId);
    }
  }, [bookId, loadThreads]);

  const activeThreadId = bookId ? getActiveThreadId(bookId) : null;
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const bookThreads = bookId ? getThreadsForContext(bookId) : [];
  const firstBookThreadId = bookThreads[0]?.id;

  useEffect(() => {
    if (bookId && !activeThreadId && firstBookThreadId) {
      setBookActiveThread(bookId, firstBookThreadId);
    }
  }, [activeThreadId, bookId, firstBookThreadId, setBookActiveThread]);

  const [attachedQuotes, setAttachedQuotes] = useState<AttachedQuote[]>([]);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);

  const handleSend = useCallback(
    (content: string, deepThinking = false, spoilerFree = false, quotes?: AttachedQuote[]) => {
      const { aiConfig } = useSettingsStore.getState();
      const endpoint = aiConfig.endpoints.find((e) => e.id === aiConfig.activeEndpointId);
      const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
      if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) {
        setConfigGuide("ai");
        return;
      }

      sendMessage(content, bookId, deepThinking, spoilerFree, quotes);
      setAttachedQuotes([]);
    },
    [sendMessage, bookId],
  );

  const handleRemoveQuote = useCallback((id: string) => {
    setAttachedQuotes((prev) => prev.filter((q) => q.id !== id));
  }, []);

  useEffect(() => {
    if (!quote) return;
    setAttachedQuotes((prev) =>
      prev.some((item) => item.text === quote.text) ? prev : [...prev, quote],
    );
    onConsumeQuote?.();
  }, [quote, onConsumeQuote]);

  const handleNewThread = useCallback(async () => {
    if (!bookId) return;
    // If current thread is already empty (new conversation), don't create another
    if (activeThread && activeThread.messages.length === 0) return;
    await createThread(bookId);
  }, [bookId, activeThread, createThread]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      if (bookId) {
        setBookActiveThread(bookId, threadId);
      }
    },
    [bookId, setBookActiveThread],
  );

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      await removeThread(threadId);
    },
    [removeThread],
  );

  const displayMessages = activeThread?.messages || [];

  // Build message list with streaming message
  const storeMessages = convertToMessageV2(displayMessages);
  const activeCurrentMessage =
    activeThread?.id === currentMessage?.threadId ? currentMessage : null;
  const allMessages = mergeMessagesWithStreaming(storeMessages, activeCurrentMessage, isStreaming);

  const exportTitle = activeThread?.title || book?.meta?.title || t("chat.aiAssistant");

  const SUGGESTIONS = [
    t("chat.suggestions.summarizeChapter"),
    t("chat.suggestions.explainConcepts"),
    t("chat.suggestions.analyzeAuthor"),
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header with thread controls */}
      <div className="relative flex h-8 shrink-0 items-center justify-between px-3">
        <SidebarChatHistory
          threads={bookThreads}
          activeId={activeThreadId}
          onSelect={handleSelectThread}
          onDelete={handleDeleteThread}
        />
        <div className="flex items-center gap-1">
          {modelSelector || <ModelSelector />}
          <ChatExportButton messages={allMessages} title={exportTitle} />
          <button
            type="button"
            onClick={handleNewThread}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t("chat.newChat")}
          >
            <MessageCirclePlus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Messages or empty state */}
      <div className="flex-1 overflow-hidden">
        {allMessages.length > 0 ? (
          <MessageList
            messages={allMessages}
            isStreaming={isStreaming}
            currentStep={currentStep}
            onStop={stopStream}
            onCitationClick={onNavigateToCitation}
          />
        ) : (
          <div className="flex h-full flex-col items-start justify-end gap-3 overflow-y-auto p-4 pb-6">
            <div className="flex flex-col items-start gap-3 pl-1">
              <img src="/think.svg" alt="" className="h-28 w-28 shrink-0 dark:invert" />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-foreground">{t("chat.aiAssistant")}</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {t("chat.aiAssistantDesc")}
                </p>
              </div>
            </div>
            <div className="w-full space-y-0.5">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => handleSend(text)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted/70"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-2 pb-2 pt-1">
        <ChatInput
          onSend={handleSend}
          onStop={stopStream}
          isStreaming={isStreaming}
          placeholder={t("chat.askBookPlaceholder")}
          quotes={attachedQuotes}
          onRemoveQuote={handleRemoveQuote}
        />
      </div>

      <ConfigGuideDialog type={configGuide} onClose={() => setConfigGuide(null)} />
    </div>
  );
}
