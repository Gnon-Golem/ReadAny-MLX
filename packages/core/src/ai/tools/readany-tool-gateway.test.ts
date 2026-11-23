import { beforeEach, describe, expect, it, vi } from "vitest";
import { READANY_MCP_TOOLS, ReadAnyToolGateway } from "./readany-tool-gateway";

const mocks = vi.hoisted(() => ({
  getBook: vi.fn(),
  provenance: vi.fn(),
  context: vi.fn(),
  search: vi.fn(),
  chapter: vi.fn(),
  toc: vi.fn(),
  factory: vi.fn(),
}));

vi.mock("../../db/database", () => ({
  getBook: mocks.getBook,
  getVectorIndexProvenance: mocks.provenance,
}));
vi.mock("../reading-context-service", () => ({
  readingContextService: { getContext: mocks.context },
}));
vi.mock("./book-reading-tools", () => ({ createBookReadingTools: mocks.factory }));

const id = "fixture";
const cfi = "epubcfi(/6/4!/4/2,/1:0,/1:5)";
const source = {
  chapter: "Working memory",
  chapterIndex: 1,
  content: "A real passage.",
  cfi,
  chunkId: "fixture-1-0",
};
const args = { query: "working memory" };

function book(isVectorized: boolean) {
  return {
    id,
    isVectorized,
    format: "epub",
    syncStatus: "local",
    meta: { title: "Fixture", author: "Test" },
  };
}

describe("ReadAnyToolGateway", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getBook.mockResolvedValue(book(true));
    mocks.provenance.mockResolvedValue({ modelId: "qwen", kind: "builtin", dimensions: 2560 });
    mocks.factory.mockImplementation((_, indexed) => ({
      search: { name: indexed ? "ragSearch" : "fallbackSearch", execute: mocks.search },
      chapter: { name: indexed ? "ragContext" : "fallbackChapterContext", execute: mocks.chapter },
      toc: { name: indexed ? "ragToc" : "fallbackToc", execute: mocks.toc },
    }));
    mocks.search.mockResolvedValue({ results: [source] });
  });

  it("exposes five read-only schemas and restricts calls to the granted book", async () => {
    expect(READANY_MCP_TOOLS).toHaveLength(5);
    expect(READANY_MCP_TOOLS.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    const gateway = new ReadAnyToolGateway(id);
    const signal = new AbortController().signal;
    await expect(
      gateway.call("readany_search_book", { ...args, bookId: "private" }, signal),
    ).rejects.toThrow("Invalid arguments");
    await expect(gateway.call("webSearch", args, signal)).rejects.toThrow("Unknown");
    expect(mocks.getBook).not.toHaveBeenCalled();

    mocks.context.mockReturnValue({ bookId: "private", currentPosition: { cfi: "private" } });
    const context = await gateway.call("readany_get_context", {}, signal);
    expect(context).toMatchObject({ bookId: id, cfi: null, index: { dimensions: 2560 } });
    expect(mocks.getBook).toHaveBeenCalledWith(id);
  });

  it("restores the same evidence ID and rejects invented or cross-book evidence", async () => {
    const gateway = new ReadAnyToolGateway(id);
    const signal = new AbortController().signal;
    const first = await gateway.call("readany_search_book", args, signal);
    expect(first).toMatchObject({ bookId: id, results: [{ ...source, evidenceId: "book-1" }] });
    const next = new ReadAnyToolGateway(id, gateway.snapshot());
    expect(await next.call("readany_search_book", args, signal)).toEqual(first);
    expect(await next.call("readany_get_evidence", { evidenceId: "book-1" }, signal)).toMatchObject(
      { type: "citation", bookId: id, cfi, chunkId: source.chunkId },
    );
    await expect(
      next.call("readany_get_evidence", { evidenceId: "book-2" }, signal),
    ).rejects.toThrow("was not issued");
    expect(() => new ReadAnyToolGateway("other", gateway.snapshot())).toThrow("another book");
  });

  it("uses original-file tools when an index does not exist", async () => {
    mocks.getBook.mockResolvedValue(book(false));
    mocks.chapter.mockResolvedValue({
      chapterIndex: 1,
      chapterTitle: source.chapter,
      sourceRefs: [{ id: "1-0", excerpt: source.content, cfi }],
    });
    const gateway = new ReadAnyToolGateway(id);
    const signal = new AbortController().signal;
    expect(
      await gateway.call("readany_search_book", { ...args, mode: "vector" }, signal),
    ).toMatchObject({ searchMode: "keyword-fallback", vectorStatus: "unavailable" });
    expect(await gateway.call("readany_read_chapter", { chapterIndex: 1 }, signal)).toMatchObject({
      source: "original-file",
      sourceRefs: [{ evidenceId: "book-1", cfi }],
    });
    expect(mocks.factory).toHaveBeenCalledWith(id, false);
    expect(mocks.provenance).not.toHaveBeenCalled();
  });

  it("drops evidence from a cancelled call", async () => {
    const controller = new AbortController();
    mocks.search.mockImplementation(async () => {
      controller.abort();
      return { results: [source] };
    });
    const gateway = new ReadAnyToolGateway(id);
    await expect(
      gateway.call("readany_search_book", args, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(gateway.snapshot()).toEqual([]);
  });
});
