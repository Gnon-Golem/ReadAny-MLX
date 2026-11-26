import type { Message } from "@readany/core/types";
import {
  formatRelativeTimeShort,
  groupThreadsByMonth,
  groupThreadsByTime,
} from "@readany/core/utils";
import { History, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

/** Place inside the relative, full-width chat toolbar. */
export function SidebarChatHistory({
  threads,
  activeId,
  onSelect,
  onDelete,
  disabled,
  deleteDisabled,
}: {
  threads: ThreadSummary[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
  deleteDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !list.current?.contains(event.target)
      )
        setOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        (trigger.current === document.activeElement ||
          list.current?.contains(document.activeElement))
      ) {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  const groups = groupThreadsByTime(threads);
  const sections = [
    ...(["today", "yesterday", "last7Days", "last30Days"] as const).map(
      (key) => [t(`chat.${key}`), groups[key]] as const,
    ),
    ...groupThreadsByMonth(groups.older),
  ];
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={t("chat.history")}
        title={t("chat.history")}
        className={`flex items-center gap-1 rounded-full p-1 transition-colors ${open ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
      >
        <History className="size-3.5" />
        {threads.length > 1 && <span className="text-[10px]">{threads.length}</span>}
      </button>
      {open && (
        <div
          ref={list}
          className="absolute left-1 right-1 top-full z-50 rounded-lg border border-border/60 bg-background shadow-lg"
        >
          <div className="max-h-56 space-y-1 overflow-y-auto p-1.5">
            {!threads.length && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {t("chat.noConversations")}
              </p>
            )}
            {sections.map(
              ([label, rows]) =>
                rows.length > 0 && (
                  <div key={label}>
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      {label}
                    </div>
                    {rows.map((thread) => {
                      const preview = thread.messages[thread.messages.length - 1]?.content.slice(
                        0,
                        60,
                      );
                      return (
                        <div
                          key={thread.id}
                          className={`group flex items-start gap-2 rounded-md px-2.5 py-2 transition-colors ${thread.id === activeId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
                        >
                          <button
                            type="button"
                            aria-current={thread.id === activeId || undefined}
                            onClick={() => {
                              onSelect(thread.id);
                              setOpen(false);
                              trigger.current?.focus();
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium">
                                {thread.title || t("chat.newChat")}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground/50">
                                {formatRelativeTimeShort(thread.updatedAt, t)}
                              </span>
                            </span>
                            {preview && (
                              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                {preview}
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={deleteDisabled}
                            aria-label={`${t("chat.deleteThread")} · ${thread.title}`}
                            onClick={() => onDelete(thread.id)}
                            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100 disabled:hidden"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
