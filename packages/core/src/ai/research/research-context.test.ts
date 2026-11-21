import { describe, expect, it, vi } from "vitest";
import { createScopedWebTools } from "./agent-web-tools";
import {
  RESEARCH_CONTEXT_BUDGET,
  ResearchEvidenceBudget,
  compactResearchHistory,
  estimateResearchTokens,
} from "./evidence-budget";
import { ResearchCache } from "./research-cache";
import type { WebSource } from "./web-provider";

const SOURCE: WebSource = {
  provider: "test",
  url: "https://example.com/papers",
  title: "Research",
  excerpt: "This is a useful research source.",
  retrievedAt: "2026-11-21T00:00:00Z",
  retrievalMethod: "search",
};

describe("research model context", () => {
  it("retains ranked evidence with bounded excerpt size and removes tracking duplicates", () => {
    const budget = new ResearchEvidenceBudget();
    const result = budget.pack("webSearch", {
      ok: true,
      result: [
        SOURCE,
        { ...SOURCE, url: "https://example.com/papers/?utm_source=search", title: "duplicate" },
        ...Array.from({ length: 10 }, (_, i) => ({
          ...SOURCE,
          url: `https://source-${i}.com/papers`,
          excerpt: "研究结果".repeat(400),
        })),
      ],
    }) as { total: number; result: WebSource[] };
    expect(result.total).toBe(12);
    expect(result.result[0]).toMatchObject(SOURCE);
    expect(result.result.some((source) => source.title === "duplicate")).toBe(false);
    expect(result.result.length).toBeLessThanOrEqual(6);
    expect(
      result.result.reduce((sum, source) => sum + estimateResearchTokens(source.excerpt), 0),
    ).toBeLessThanOrEqual(RESEARCH_CONTEXT_BUDGET.webPerCall);
    expect(
      budget.pack("webFetch", {
        ok: true,
        result: { ...SOURCE, retrievalMethod: "fetch", excerpt: "Page body excerpt." },
      }),
    ).toMatchObject({ result: { url: SOURCE.url, retrievalMethod: "fetch" } });
  });

  it("preserves book text capacity independently of exhausted web evidence", () => {
    const budget = new ResearchEvidenceBudget();
    for (let start = 0; start < 6; start += 1) {
      budget.pack("webSearch", {
        ok: true,
        result: Array.from({ length: 4 }, (_, i) => ({
          ...SOURCE,
          url: `https://domain-${i}.com/${start}`,
          excerpt: "研究结果".repeat(400),
        })),
      });
    }
    const local = budget.pack("ragSearch", {
      results: [{ chapterIndex: 0, cfi: "epubcfi(/6/4!/4)", content: "书籍原文段落", score: 0.7 }],
    });
    expect(local).toMatchObject({
      results: [{ score: 0.7, content: "书籍原文段落", cfi: "epubcfi(/6/4!/4)" }],
    });
    expect(
      compactResearchHistory([{ content: "研".repeat(10000) }, { content: "Recent short turn" }]),
    ).toEqual([{ content: "Recent short turn" }]);
  });
});

describe("short-lived public web cache", () => {
  it("reuses public search hits across turns and preserves their original age", async () => {
    let time = 30;
    const cache = new ResearchCache(3, () => time);
    const search = vi.fn(async () => [SOURCE]);
    const fetchPage = vi.fn(async () => SOURCE);
    const provider = { id: "test", search, fetchPage };
    const args = { query: "recent apple research" };
    const [first] = createScopedWebTools(provider, "public question", [], undefined, cache);
    await first?.execute(args);
    const [later, fetch] = createScopedWebTools(
      provider,
      "another public question",
      [],
      undefined,
      cache,
    );
    expect(later?.getCachedResult?.(args)).toMatchObject({
      cached: true,
      result: [{ ...SOURCE }],
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(await fetch?.execute({ url: SOURCE.url })).toMatchObject({ ok: true });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    time += 90_001;
    expect(later?.getCachedResult?.(args)).toBeUndefined();
    expect(later?.getCachedResult?.({ query: "API key" })).toBeUndefined();
  });

  it("bounds size and separates providers and actual query arguments", async () => {
    const cache = new ResearchCache(1, () => 10);
    const provider = { id: "one", search: vi.fn(async () => [SOURCE]), fetchPage: vi.fn() };
    const other = { ...provider, id: "two" };
    const [source] = createScopedWebTools(provider, "", [], undefined, cache);
    const [different] = createScopedWebTools(other, "", [], undefined, cache);
    await source?.execute({ query: "Metal 2025" });
    expect(source?.getCachedResult?.({ query: "Metal 2026" })).toBeUndefined();
    expect(different?.getCachedResult?.({ query: "Metal 2025" })).toBeUndefined();
    await different?.execute({ query: "Metal 2025" });
    expect(source?.getCachedResult?.({ query: "Metal 2025" })).toBeUndefined();
    expect(different?.getCachedResult?.({ query: "Metal 2025" })).toMatchObject({ cached: true });
  });
});
