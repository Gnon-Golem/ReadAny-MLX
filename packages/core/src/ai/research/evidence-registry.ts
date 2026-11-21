import { record } from "./parallel-transport";
import { type WebSource, publicWebUrl } from "./web-provider";

export interface BookEvidence {
  type: "book";
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  cfi: string;
  chunkId?: string;
  text: string;
  retrievalMethod: string;
}

export interface WebEvidence extends WebSource {
  type: "web";
}

type Evidence = BookEvidence | WebEvidence;
export type CitedEvidence = Evidence & { id: string; citationIndex: number };

export const MAX_CITATION_SOURCES = 12;

export class EvidenceRegistry {
  private entries = new Map<string, Evidence>();
  private ids = new Map<string, string>();
  private citations = new Map<string, number>();

  register(evidence: Evidence): string {
    const key =
      evidence.type === "web"
        ? `web:${evidence.url}`
        : JSON.stringify([evidence.bookId, evidence.chapterIndex, evidence.cfi, evidence.text]);
    const existing = this.ids.get(key);
    if (existing) {
      const previous = this.entries.get(existing);
      if (
        evidence.type === "web" &&
        evidence.retrievalMethod === "fetch" &&
        previous?.type === "web" &&
        previous.retrievalMethod !== "fetch"
      ) {
        this.entries.set(existing, evidence);
      }
      return existing;
    }
    const id = `${evidence.type}-${this.entries.size + 1}`;
    this.ids.set(key, id);
    this.entries.set(id, evidence);
    return id;
  }

  formatAnswer(answer: string): { text: string; citations: CitedEvidence[] } {
    const citations: CitedEvidence[] = [];
    const text = answer
      // Numeric source markers are assigned here, not by the model.
      .replace(/\[\[([^\]\n]{1,64})\]\]|\[\d+\](?!\()/g, (_match, id: string | undefined) => {
        if (!id) return "";
        const evidence = this.entries.get(id);
        if (!evidence) return "";
        const existing = this.citations.get(id);
        if (existing) return `[${existing}]`;
        if (this.citations.size >= MAX_CITATION_SOURCES) return "";
        const citationIndex = this.citations.size + 1;
        this.citations.set(id, citationIndex);
        citations.push({ ...evidence, id, citationIndex });
        return `[${citationIndex}]`;
      });
    return { text, citations };
  }
}

function annotateBook(
  registry: EvidenceRegistry,
  item: unknown,
  bookId: string,
  retrievalMethod: string,
  chapter?: Record<string, unknown>,
): unknown {
  const value = record(item);
  if (!value) return item;
  const chapterIndex = value.chapterIndex ?? chapter?.chapterIndex;
  const chapterTitle = value.chapterTitle ?? value.chapter ?? chapter?.chapterTitle;
  const cfi = value.cfi;
  const text = value.content ?? value.selectedText ?? value.excerpt ?? value.text;
  if (
    typeof chapterIndex !== "number" ||
    !Number.isInteger(chapterIndex) ||
    chapterIndex < 0 ||
    typeof chapterTitle !== "string" ||
    typeof cfi !== "string" ||
    !cfi.startsWith("epubcfi(") ||
    !cfi.endsWith(")") ||
    typeof text !== "string" ||
    !text.trim()
  ) {
    return item;
  }
  const evidenceId = registry.register({
    type: "book",
    bookId,
    chapterIndex,
    chapterTitle,
    cfi,
    chunkId:
      typeof value.chunkId === "string"
        ? value.chunkId
        : typeof value.id === "string"
          ? value.id
          : undefined,
    text: text.trim().slice(0, 220),
    retrievalMethod,
  });
  return { ...value, evidenceId };
}

function annotateWeb(registry: EvidenceRegistry, item: unknown): unknown {
  const value = record(item);
  const url = typeof value?.url === "string" ? publicWebUrl(value.url) : undefined;
  if (
    !url ||
    typeof value?.title !== "string" ||
    typeof value?.excerpt !== "string" ||
    typeof value?.provider !== "string" ||
    typeof value?.retrievedAt !== "string" ||
    (value.retrievalMethod !== "search" && value.retrievalMethod !== "fetch")
  ) {
    return item;
  }
  const evidenceId = registry.register({
    type: "web",
    provider: value.provider,
    url,
    title: value.title.slice(0, 240),
    excerpt: value.excerpt.slice(0, 320),
    retrievedAt: value.retrievedAt,
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : undefined,
    retrievalMethod: value.retrievalMethod,
  });
  return { ...value, evidenceId };
}

export function registerToolEvidence(
  registry: EvidenceRegistry,
  toolName: string,
  result: unknown,
  bookId: string | null,
  readingBookId?: string,
): unknown {
  const value = record(result);
  if (!value) return result;
  switch (toolName) {
    case "webSearch":
      return value.ok === true && Array.isArray(value.result)
        ? { ...value, result: value.result.map((source) => annotateWeb(registry, source)) }
        : result;
    case "webFetch":
      return value.ok === true ? { ...value, result: annotateWeb(registry, value.result) } : result;
    case "addCitation":
      return bookId && value.type === "citation" && value.bookId === bookId
        ? annotateBook(registry, value, bookId, toolName)
        : result;
    case "getSelection":
      return bookId && bookId === readingBookId
        ? annotateBook(registry, value, bookId, toolName)
        : result;
    case "ragSearch":
    case "fallbackSearch":
      return bookId && Array.isArray(value.results)
        ? {
            ...value,
            results: value.results.map((item) => annotateBook(registry, item, bookId, toolName)),
          }
        : result;
    case "ragContext":
    case "fallbackChapterContext":
      return bookId && Array.isArray(value.sourceRefs)
        ? {
            ...value,
            sourceRefs: value.sourceRefs.map((item) =>
              annotateBook(registry, item, bookId, toolName, value),
            ),
          }
        : result;
    default:
      return result;
  }
}
