import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChunks, getVectorIndexProvenance } from "../db/database";
import type { Chunk } from "../types";
import {
  clearChunkCache,
  clearSearchConfiguration,
  configureSearch,
  search,
  searchWithDiagnostics,
} from "./search";

vi.mock("../db/database", () => ({
  getChunks: vi.fn(),
  getVectorIndexProvenance: vi.fn(),
}));

const chunk: Chunk = {
  id: "chunk-1",
  bookId: "book-1",
  chapterIndex: 0,
  chapterTitle: "Chapter 1",
  content: "A semantic search result about astronomy.",
  tokenCount: 7,
  startCfi: "",
  endCfi: "",
  embedding: [0.1, 0.2],
};

describe("RAG index provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChunkCache();
    clearSearchConfiguration();
    vi.mocked(getChunks).mockResolvedValue([chunk]);
  });

  it("rejects vector search when the active query model differs from the book index", async () => {
    vi.mocked(getVectorIndexProvenance).mockResolvedValue({
      bookId: "book-1",
      kind: "builtin",
      modelId: "all-MiniLM-L6-v2",
      dimensions: 384,
      createdAt: 1,
    });
    configureSearch({
      provenance: { kind: "builtin", modelId: "bge-small-zh-v1.5", dimensions: 512 },
      embed: vi.fn(),
    });

    await expect(
      search({ query: "astronomy", bookId: "book-1", mode: "vector", topK: 5, threshold: 0 }),
    ).rejects.toThrow("Vector index model mismatch");
  });

  it("marks hybrid results when vector retrieval is unavailable instead of silently returning BM25", async () => {
    vi.mocked(getVectorIndexProvenance).mockResolvedValue(null);
    configureSearch({
      provenance: { kind: "builtin", modelId: "all-MiniLM-L6-v2", dimensions: 384 },
      embed: vi.fn(),
    });

    const results = await search({
      query: "astronomy",
      bookId: "book-1",
      mode: "hybrid",
      topK: 5,
      threshold: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      matchType: "bm25",
      vectorStatus: "unavailable",
      vectorError: expect.stringContaining("no embedding provenance"),
    });
  });

  it("distinguishes a successful vector search below the cutoff from a vector failure", async () => {
    const provenance = { kind: "builtin", modelId: "test-model", dimensions: 2 } as const;
    vi.mocked(getVectorIndexProvenance).mockResolvedValue({
      ...provenance,
      bookId: "book-1",
      createdAt: 1,
    });
    const embed = vi.fn().mockResolvedValueOnce([0.2, -0.1]).mockResolvedValueOnce([0.1, 0.2]);
    configureSearch({ provenance, embed });
    const query = {
      query: "astronomy",
      bookId: "book-1",
      mode: "hybrid",
      topK: 5,
      threshold: 0.3,
    } as const;
    await expect(searchWithDiagnostics(query)).resolves.toMatchObject({
      results: [{ matchType: "bm25" }],
      vectorStatus: "no_matches",
    });
    await expect(searchWithDiagnostics(query)).resolves.toMatchObject({
      results: [{ matchType: "hybrid" }],
      vectorStatus: "matched",
    });
    expect(embed).toHaveBeenCalledTimes(2);
    await expect(searchWithDiagnostics({ ...query, mode: "bm25" })).resolves.toMatchObject({
      vectorStatus: "not_requested",
    });

    clearSearchConfiguration();
    await expect(searchWithDiagnostics({ ...query, query: "nonexistent" })).resolves.toMatchObject({
      results: [],
      vectorStatus: "unavailable",
    });
  });

  it("accepts remote endpoints that differ only by a trailing slash", async () => {
    vi.mocked(getVectorIndexProvenance).mockResolvedValue({
      bookId: "book-1",
      kind: "remote",
      modelId: "text-embedding-v3",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      dimensions: 2,
      createdAt: 1,
    });
    configureSearch({
      provenance: {
        kind: "remote",
        modelId: "text-embedding-v3",
        endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
        dimensions: 2,
      },
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    });

    await expect(
      search({ query: "astronomy", bookId: "book-1", mode: "vector", topK: 5, threshold: 0 }),
    ).resolves.toHaveLength(1);
  });
});
