import { getHighlights, insertHighlight, updateHighlight } from "../../db/database";
import type { CitationPart, WebCitationSource } from "../../types/message";
import { generateId } from "../../utils/generate-id";
import { formatSourceExcerpt, formatWebSourceLink } from "../../utils/web-source-format";
import { publicWebUrl } from "./web-provider";

type BookAnchor = Pick<CitationPart, "bookId" | "cfi" | "chapterTitle" | "text">;
const saves = new Map<string, Promise<void>>();

export async function saveWebSourceAtBookCitation(
  source: WebCitationSource,
  anchor: BookAnchor,
  chat: { threadId: string; messageId: string },
): Promise<void> {
  const url = publicWebUrl(source.url);
  const link = formatWebSourceLink(source);
  if (
    !url ||
    !link ||
    !anchor.bookId ||
    !anchor.cfi.startsWith("epubcfi(") ||
    !anchor.cfi.endsWith(")") ||
    !anchor.text.trim()
  ) {
    throw new Error("A verified web source and a concrete EPUB citation are required.");
  }
  const excerpt = formatSourceExcerpt(source.excerpt.slice(0, 320));
  const relation = [chat.threadId, chat.messageId].map(encodeURIComponent).join("/");
  const entry = [link, excerpt && `> ${excerpt}`, `<!-- readany-chat:${relation} -->`]
    .filter(Boolean)
    .join("\n\n");
  const key = JSON.stringify([anchor.bookId, anchor.cfi]);
  const previous = saves.get(key) ?? Promise.resolve();
  const save = previous
    .catch(() => undefined)
    .then(async () => {
      const existing = (await getHighlights(anchor.bookId)).find((h) => h.cfi === anchor.cfi);
      if (existing) {
        if (existing.note?.includes(`<${url}>`)) return;
        await updateHighlight(existing.id, {
          note: [existing.note, entry].filter(Boolean).join("\n\n"),
        });
        return;
      }
      const now = Date.now();
      await insertHighlight({
        id: generateId(),
        bookId: anchor.bookId,
        cfi: anchor.cfi,
        chapterTitle: anchor.chapterTitle,
        text: anchor.text,
        color: "yellow",
        note: entry,
        createdAt: now,
        updatedAt: now,
      });
    });
  saves.set(key, save);
  try {
    await save;
  } finally {
    if (saves.get(key) === save) saves.delete(key);
  }
}
