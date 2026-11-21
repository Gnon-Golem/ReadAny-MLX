import { describe, expect, it } from "vitest";
import { convertToMessageV2 } from "../../utils/chat-utils";
import { EvidenceRegistry, registerToolEvidence } from "./evidence-registry";
import { ResearchToolBudget } from "./tool-budget";

const BOOK = {
  chapterTitle: "Metal",
  chapterIndex: 0,
  cfi: "epubcfi(/6/6!/4/2/2)",
  content: "A passage from the book.",
  chunkId: "chunk-a",
};
const WEB = {
  provider: "parallel",
  url: "https://developer.apple.com/documentation/metal",
  title: "Metal",
  excerpt: "A real search excerpt.",
  retrievalMethod: "search" as const,
  retrievedAt: "2026-11-21T00:00:00Z",
};

describe("per-turn evidence", () => {
  it("validates book and web results, deduplicates locations and upgrades fetches", () => {
    const registry = new EvidenceRegistry();
    const input = { results: [BOOK, { ...BOOK, cfi: "" }] };
    const result = registerToolEvidence(registry, "ragSearch", input, "book-a");
    expect(result).toMatchObject({ results: [{ evidenceId: "book-1" }, {}] });
    expect(registerToolEvidence(registry, "ragSearch", input, "book-a")).toEqual(result);
    expect(registerToolEvidence(registry, "getSelection", BOOK, "book-a", "another-book")).toBe(
      BOOK,
    );
    const raw = { ok: true, result: [WEB, { ...WEB, url: "https://device.local/" }] };
    expect(registerToolEvidence(registry, "webSearch", raw, "book-a")).toMatchObject({
      result: [{ evidenceId: "web-2" }, {}],
    });
    expect(
      registerToolEvidence(
        registry,
        "webFetch",
        {
          ok: true,
          result: { ...WEB, retrievalMethod: "fetch", excerpt: "Verified page excerpt." },
        },
        "book-a",
      ),
    ).toMatchObject({ result: { evidenceId: "web-2" } });
    const marked = registry.formatAnswer(
      "Web[[web-2]] book[[book-1]] bogus[[web-3]][99] repeat[[web-2]].",
    );
    expect(marked.text).toBe("Web[1] book[2] bogus repeat[1].");
    expect(marked.citations).toMatchObject([
      { type: "web", url: WEB.url, retrievalMethod: "fetch", citationIndex: 1 },
      { type: "book", bookId: "book-a", cfi: BOOK.cfi, text: BOOK.content, citationIndex: 2 },
    ]);
  });

  it("keeps verified sources usable after tool exhaustion and displays at most 12", () => {
    const registry = new EvidenceRegistry();
    const budget = new ResearchToolBudget();
    for (let i = 0; i < 24; i += 1) budget.reserve("other");
    expect(budget.reserve("other")).toBe("total");
    const ids = Array.from({ length: 13 }, (_, i) =>
      registry.register({
        ...WEB,
        type: "web",
        url: `https://example.com/papers/${i}`,
      }),
    );
    const answer = registry.formatAnswer(ids.map((id) => `[[${id}]]`).join(" "));
    expect(answer.citations).toHaveLength(12);
    expect(answer.text).not.toContain("[13]");
    expect(answer.citations.map(({ citationIndex }) => citationIndex)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  it("preserves legacy CFI citations and restores safe web citations from JSON", () => {
    const partsOrder = JSON.parse(
      JSON.stringify([
        { type: "text", id: "text-1", text: "Evidence [1] and [2]." },
        {
          type: "citation",
          id: "old-book",
          bookId: "book-a",
          chapterTitle: BOOK.chapterTitle,
          chapterIndex: 0,
          cfi: BOOK.cfi,
          text: BOOK.content,
          citationIndex: 1,
        },
        { type: "web_citation", id: "web-2", webSource: { ...WEB, citationIndex: 2 } },
        {
          type: "web_citation",
          id: "blocked",
          webSource: { ...WEB, citationIndex: 3, url: "javascript:bad()" },
        },
      ]),
    );
    const [message] = convertToMessageV2([
      { id: "msg", threadId: "thread", role: "assistant", partsOrder, createdAt: 100 },
    ]);
    expect(message?.parts).toHaveLength(3);
    expect(message?.parts[1]).toMatchObject({ type: "citation", cfi: BOOK.cfi });
    expect(message?.parts[2]).toMatchObject({
      type: "web_citation",
      url: WEB.url,
      citationIndex: 2,
    });
  });
});
