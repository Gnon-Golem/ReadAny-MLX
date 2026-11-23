import { getBook } from "@/lib/db/database";
import { openDesktopBook } from "@/lib/library/open-book";
import { useLibraryStore } from "@/stores/library-store";
import type { CitationPart } from "@readany/core/types";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function useDesktopCitationNavigation() {
  const { t } = useTranslation();
  return useCallback(
    async (citation: CitationPart) => {
      const book =
        useLibraryStore.getState().books.find((item) => item.id === citation.bookId) ??
        (await getBook(citation.bookId, { includeDeleted: true }).catch((err) => {
          console.warn("[ChatPage] Failed to get cited book record:", err);
          return null;
        }));
      if (!book) {
        toast.error(t("chat.citationBookNotFound", "Could not find the cited book."));
        return;
      }
      const initialCfi =
        citation.cfi?.trim() || `chapter:${Math.max(0, Number(citation.chapterIndex) || 0)}`;
      if (!(await openDesktopBook({ book, t, initialCfi }))) {
        toast.error(t("chat.citationOpenFailed", "Could not open this citation."));
      }
    },
    [t],
  );
}
