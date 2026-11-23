import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchWithDiagnostics } from "@readany/core/rag/search";
import type { SearchQuery } from "@readany/core/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const MODES = ["bm25", "vector", "hybrid"] as const;

interface VectorTestDialogProps {
  bookId: string;
  bookTitle: string;
  onClose: () => void;
  onOpenLocation: (cfi: string) => Promise<boolean>;
}

export function VectorTestDialog({
  bookId,
  bookTitle,
  onClose,
  onOpenLocation,
}: VectorTestDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SearchQuery["mode"]>("hybrid");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<Awaited<ReturnType<typeof searchWithDiagnostics>>>();

  async function runSearch() {
    if (busy || !query.trim()) return;
    setBusy(true);
    setError("");
    setResponse(undefined);
    try {
      setResponse(
        await searchWithDiagnostics({
          bookId,
          mode,
          query: query.trim(),
          topK: 10,
          threshold: 0.3,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openLocation(cfi: string) {
    setBusy(true);
    try {
      if (await onOpenLocation(cfi)) onClose();
      else setError(t("chat.citationOpenFailed", "Could not open this location."));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex h-[min(75vh,720px)] max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{t("vectorize.testSearch", "Search this book")}</DialogTitle>
          <DialogDescription>{bookTitle}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {MODES.map((id) => (
            <Button
              key={id}
              size="sm"
              variant={mode === id ? "default" : "outline"}
              aria-pressed={mode === id}
              disabled={busy}
              onClick={() => {
                setMode(id);
                setResponse(undefined);
                setError("");
              }}
            >
              {t(`vectorize.${id}`)}
            </Button>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <Input
            aria-label={t("vectorize.search")}
            placeholder={t("vectorize.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" disabled={busy || !query.trim()}>
            {t("vectorize.search")}
          </Button>
        </form>

        {(error || response?.vectorError) && (
          <p role="alert" className="text-sm text-destructive">
            {error || response?.vectorError}
          </p>
        )}
        <div
          aria-live="polite"
          aria-busy={busy}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto"
        >
          {response?.results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("vectorize.noMatches", "No matching passages.")}
            </p>
          )}
          {response?.results.map(({ chunk, score }) => (
            <button
              key={chunk.id}
              type="button"
              className="block w-full rounded-md border p-3 text-left hover:bg-muted"
              disabled={busy}
              onClick={() => void openLocation(chunk.startCfi || `chapter:${chunk.chapterIndex}`)}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{chunk.chapterTitle}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {score.toFixed(3)}
                </span>
              </span>
              <span className="mt-1 block whitespace-pre-wrap text-sm text-muted-foreground">
                {chunk.content}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
