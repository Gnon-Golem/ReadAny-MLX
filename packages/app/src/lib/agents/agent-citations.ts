import type { Message, PartsOrderEntry } from "@readany/core/types";

/** Render only IDs issued by the scoped reading gateway as clickable citations. */
export async function citeAgentAnswer(
  message: Message,
  resolve: (id: string) => Promise<Record<string, unknown>>,
  bookId?: string,
): Promise<Message> {
  const ids = [
    ...new Set(
      [...message.content.matchAll(/\[\[(book-[1-9][0-9]{0,4})\]\]/g)].map((match) => match[1]),
    ),
  ].slice(0, 12);
  const parts: PartsOrderEntry[] = [];
  const indices = new Map<string, number>();
  if (bookId) {
    await Promise.all(ids.map((id) => resolve(id).catch(() => null))).then((sources) => {
      sources.forEach((value, index) => {
        const id = ids[index];
        if (
          !value ||
          value.bookId !== bookId ||
          value.evidenceId !== id ||
          typeof value.cfi !== "string" ||
          !/^epubcfi\(.+\)$/.test(value.cfi) ||
          typeof value.chapterIndex !== "number" ||
          !Number.isInteger(value.chapterIndex) ||
          value.chapterIndex < 0 ||
          typeof value.chapterTitle !== "string" ||
          typeof value.text !== "string"
        )
          return;
        const citationIndex = indices.size + 1;
        indices.set(id, citationIndex);
        parts.push({
          type: "citation",
          id,
          bookId,
          chapterIndex: value.chapterIndex,
          chapterTitle: value.chapterTitle,
          cfi: value.cfi,
          text: value.text,
          citationIndex,
        });
      });
    });
  }
  const content = message.content.replace(/\[\[(book-[^\]\n]{1,64})\]\]/g, (_, id: string) => {
    const index = indices.get(id);
    return index ? `[${index}]` : "";
  });
  return parts.length
    ? {
        ...message,
        content,
        partsOrder: [{ type: "text", id: `${message.id}-text`, text: content }, ...parts],
      }
    : { ...message, content };
}
