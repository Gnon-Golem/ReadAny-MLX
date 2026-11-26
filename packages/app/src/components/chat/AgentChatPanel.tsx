import { useAgentChats } from "@/hooks/use-agent-chat";
import type { ReaderChatContext, ReaderQuote } from "@/lib/agents/reader-chat-context";
import { isMlxDevelopmentBuild } from "@/lib/macos-mlx-build";
import type { CitationPart } from "@readany/core/types";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalAgentChatPanel } from "./ExternalAgentChatPanel";

type DesktopRuntime = "native" | "codex" | "antigravity";

type Props = {
  reader?: ReaderChatContext;
  quote?: ReaderQuote;
  onConsumeQuote?: () => void;
  onCitationClick?: (part: CitationPart) => void;
  renderNative: (quote?: ReaderQuote) => ReactNode;
};

export function AgentChatPanel({
  reader,
  quote,
  onConsumeQuote,
  onCitationClick,
  renderNative,
}: Props) {
  const { t } = useTranslation();
  const [supported, setSupported] = useState<boolean>();
  useEffect(() => {
    void isMlxDevelopmentBuild().then(setSupported);
  }, []);
  const { homeRequest } = useAgentChats();
  const insideReader = Boolean(reader);
  const modeKey = insideReader ? "readany-reader-chat-mode" : "readany-chat-mode";
  const [runtime, setRuntime] = useState<DesktopRuntime>(() => {
    const mode = localStorage.getItem(modeKey);
    return mode === "codex" || mode === "antigravity" ? mode : "native";
  });
  useEffect(() => {
    if (!insideReader && homeRequest) {
      setRuntime(homeRequest.runtime);
      localStorage.setItem("readany-chat-mode", homeRequest.runtime);
    }
  }, [insideReader, homeRequest]);
  const showAgent = supported && runtime !== "native";
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {supported && (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <select
            aria-label={t("chat.agentRuntime")}
            value={runtime}
            className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1 text-sm"
            onChange={(event) => {
              const next = event.target.value;
              if (next !== "native" && next !== "codex" && next !== "antigravity") return;
              setRuntime(next);
              localStorage.setItem(modeKey, next);
            }}
          >
            <option value="native">{t("chat.nativeAiMode")}</option>
            <option value="codex">{t("chat.codexMode")}</option>
            <option value="antigravity">Antigravity</option>
          </select>
        </div>
      )}
      <div className={showAgent ? "hidden" : "min-h-0 flex-1 overflow-hidden"}>
        {renderNative(runtime === "native" || supported === false ? quote : undefined)}
      </div>
      {showAgent && (
        <ExternalAgentChatPanel
          key={runtime}
          runtime={runtime}
          reader={reader}
          quote={quote}
          onConsumeQuote={onConsumeQuote}
          onCitationClick={onCitationClick}
        />
      )}
    </div>
  );
}
