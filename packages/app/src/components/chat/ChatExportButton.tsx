import { getPlatformService } from "@readany/core/services";
import type { MessageV2 } from "@readany/core/types";
import {
  exportChatAsJSON,
  exportChatAsMarkdown,
  formatChatForClipboard,
  getExportFilename,
} from "@readany/core/utils";
import { ClipboardCopy, Download, FileJson, FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function ChatExportButton({
  messages: allMessages,
  title: exportTitle,
}: { messages: MessageV2[]; title: string }) {
  const { t } = useTranslation();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExportMenu]);

  const exportOpts = useMemo(
    () => ({
      title: exportTitle,
      userLabel: t("chat.roleUser"),
      aiLabel: t("chat.roleAI"),
    }),
    [exportTitle, t],
  );

  const handleExportMarkdown = useCallback(async () => {
    setShowExportMenu(false);
    const md = exportChatAsMarkdown(allMessages, exportOpts);
    const filename = getExportFilename("md");
    const platform = getPlatformService();
    await platform.shareOrDownloadFile(md, filename, "text/markdown");
    toast.success(t("chat.exportSuccess"));
  }, [allMessages, exportOpts, t]);

  const handleExportJSON = useCallback(async () => {
    setShowExportMenu(false);
    const json = exportChatAsJSON(allMessages, exportOpts);
    const filename = getExportFilename("json");
    const platform = getPlatformService();
    await platform.shareOrDownloadFile(json, filename, "application/json");
    toast.success(t("chat.exportSuccess"));
  }, [allMessages, exportOpts, t]);

  const handleCopyAll = useCallback(async () => {
    setShowExportMenu(false);
    const text = formatChatForClipboard(allMessages, exportOpts);
    const platform = getPlatformService();
    await platform.copyToClipboard(text);
    toast.success(t("chat.copiedSuccess"));
  }, [allMessages, exportOpts, t]);

  if (!allMessages.length) return null;
  return (
    <div className="relative" ref={exportMenuRef}>
      <button
        type="button"
        onClick={() => setShowExportMenu(!showExportMenu)}
        className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title={t("chat.export")}
        aria-label={t("chat.export")}
      >
        <Download className="size-3.5" />
      </button>
      {showExportMenu && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-48 animate-in fade-in slide-in-from-top-1 rounded-lg border bg-popover p-1.5 shadow-lg">
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 whitespace-nowrap text-left">{t("chat.exportMarkdown")}</span>
          </button>
          <button
            type="button"
            onClick={handleExportJSON}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            <FileJson className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 whitespace-nowrap text-left">{t("chat.exportJSON")}</span>
          </button>
          <div className="mx-2 my-1 border-t" />
          <button
            type="button"
            onClick={handleCopyAll}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            <ClipboardCopy className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 whitespace-nowrap text-left">{t("chat.copyAll")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
