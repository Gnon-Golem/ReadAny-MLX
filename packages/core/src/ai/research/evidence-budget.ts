import { record } from "./parallel-transport";
import { publicWebUrl } from "./web-provider";

export const RESEARCH_CONTEXT_BUDGET = {
  book: 3_600,
  web: 2_400,
  intermediate: 1_200,
  history: 3_000,
  bookPerCall: 1_200,
  webPerCall: 800,
} as const;

// Keep the existing RAG estimate intact. Research caps are conservative for
// Chinese text and mixed-language excerpts that use more tokens per character.
export function estimateResearchTokens(text: string): number {
  const nonAscii = text.match(/[^ -~]/gu)?.length ?? 0;
  return nonAscii + Math.ceil((text.length - nonAscii) / 4);
}

export function summarizeToTokens(text: string, limit: number): string {
  if (limit <= 0) return "";
  if (estimateResearchTokens(text) <= limit) return text;
  let low = 0;
  let high = text.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (estimateResearchTokens(text.slice(0, middle)) <= limit) low = middle;
    else high = middle;
  }
  return text.slice(0, low).trimEnd();
}

export function compactResearchHistory<T extends { content: string; reasoning?: string }>(
  history: T[],
): T[] {
  const selected: T[] = [];
  let remaining: number = RESEARCH_CONTEXT_BUDGET.history;
  for (let i = history.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const input = history[i];
    if (!input) continue;
    const total =
      estimateResearchTokens(input.content) + estimateResearchTokens(input.reasoning ?? "");
    if (total > remaining) break;
    selected.push(input);
    remaining -= total;
  }
  return selected.reverse();
}

function evidenceKey(value: Record<string, unknown>): string | undefined {
  if (typeof value.url === "string") {
    const address = publicWebUrl(value.url);
    if (!address) return;
    const url = new URL(address);
    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
    ]) {
      url.searchParams.delete(key);
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  }
  if (typeof value.cfi === "string" && value.cfi) {
    return JSON.stringify([value.chapterIndex, value.cfi, value.content ?? value.excerpt]);
  }
  return;
}

export class ResearchEvidenceBudget {
  private remainder = {
    book: RESEARCH_CONTEXT_BUDGET.book as number,
    web: RESEARCH_CONTEXT_BUDGET.web as number,
    intermediate: RESEARCH_CONTEXT_BUDGET.intermediate as number,
  };
  private seen = new Set<string>();

  pack(name: string, result: unknown): unknown {
    const value = record(result);
    if (!value || value.error || value.ok === false) return result;

    if (name === "webSearch" || name === "webFetch") {
      const rows = Array.isArray(value.result) ? value.result : value.result ? [value.result] : [];
      const packed = this.select(rows, "web", ["excerpt"], 6);
      return {
        ...value,
        result: Array.isArray(value.result) ? packed : (packed[0] ?? null),
        total: rows.length,
      };
    }
    if (name === "ragSearch" || name === "fallbackSearch") {
      const rows = Array.isArray(value.results) ? value.results : [];
      const results = this.select(rows, "book", ["content", "snippet"], 6);
      return {
        results,
        totalResults: value.totalResults,
        returnedResults: results.length,
        instruction: value.instruction,
        vectorStatus: value.vectorStatus,
        vectorError: value.vectorError,
      };
    }
    if (name === "ragContext" || name === "fallbackChapterContext") {
      const refs = Array.isArray(value.sourceRefs) ? value.sourceRefs : [];
      const sourceRefs = this.select(refs, "book", ["excerpt"], 6);
      const body = this.trim(value.context ?? value.content, "book", 520);
      return {
        chapterTitle: value.chapterTitle,
        chapterIndex: value.chapterIndex,
        context: body,
        sourceRefs,
        truncated: true,
      };
    }
    if (name === "getSelection") {
      return {
        ...value,
        selectedText: this.trim(value.selectedText, "book", 600),
        surroundingContext: this.trim(value.surroundingContext, "book", 220),
      };
    }
    if (name === "addCitation") return result;
    // Other local analysis tools keep their best short result without letting
    // a full chapter or annotation list occupy the entire model context.
    const raw = JSON.stringify(value);
    const allowance = Math.min(this.remainder.intermediate, 320);
    if (estimateResearchTokens(raw) <= allowance) {
      this.remainder.intermediate -= estimateResearchTokens(raw);
      return value;
    }
    return {
      excerpt: this.trim(raw, "intermediate", 320),
      truncated: true,
      notice: "Use the existing focused evidence or a narrower tool input.",
    };
  }

  private select(
    rows: unknown[],
    lane: "book" | "web",
    textKeys: string[],
    limit: number,
  ): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    const perCall =
      lane === "book" ? RESEARCH_CONTEXT_BUDGET.bookPerCall : RESEARCH_CONTEXT_BUDGET.webPerCall;
    const initial = this.remainder[lane];
    const kindSeen = new Map<string, number>();
    // Provider and RAG order carry their own relevance. Limit repeated domains
    // or chapters within one result without combining uncalibrated scores.
    for (const row of rows) {
      if (result.length >= limit || initial - this.remainder[lane] >= perCall) break;
      const item = record(row);
      if (!item) continue;
      const key = evidenceKey(item);
      if (lane === "web" && !key) continue;
      const group = lane === "web" && key ? new URL(key).hostname : String(item.chapterIndex ?? "");
      const groupCount = kindSeen.get(group) ?? 0;
      if (groupCount >= 3) continue;
      const duplicate = key && this.seen.has(key);
      if (duplicate && item.retrievalMethod !== "fetch") continue;
      const entry = { ...item };
      for (const textKey of textKeys) {
        entry[textKey] = this.trim(
          item[textKey],
          lane,
          Math.min(240, perCall - (initial - this.remainder[lane])),
        );
      }
      if (!textKeys.some((textKey) => entry[textKey])) continue;
      entry.highlights = undefined;
      if (key) this.seen.add(key);
      kindSeen.set(group, groupCount + 1);
      result.push(entry);
    }
    return result;
  }

  private trim(
    value: unknown,
    lane: keyof ResearchEvidenceBudget["remainder"],
    limit: number,
  ): string {
    if (typeof value !== "string") return "";
    const excerpt = summarizeToTokens(value, Math.min(limit, this.remainder[lane]));
    this.remainder[lane] -= estimateResearchTokens(excerpt);
    return excerpt;
  }
}
