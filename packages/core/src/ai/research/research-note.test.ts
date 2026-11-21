import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHighlights, insertHighlight, updateHighlight } from "../../db/database";
import type { Highlight, MessageV2, WebCitationPart } from "../../types";
import {
  exportChatAsJSON,
  exportChatAsMarkdown,
  formatChatForClipboard,
} from "../../utils/chat-export";
import { saveWebSourceAtBookCitation } from "./research-note";

vi.mock("../../db/database", () => ({
  getHighlights: vi.fn(),
  insertHighlight: vi.fn(),
  updateHighlight: vi.fn(),
}));

const SOURCE: WebCitationPart = {
  type: "web_citation",
  id: "web-1",
  status: "completed",
  createdAt: 100,
  provider: "parallel",
  url: "https://example.org/article",
  title: "Research [page]",
  excerpt: "Short evidence excerpt.",
  retrievedAt: "2026-11-21T00:00:00Z",
  retrievalMethod: "search",
  citationIndex: 2,
};
const BOOK = {
  bookId: "book-1",
  chapterTitle: "Chapter 1",
  cfi: "epubcfi(/6/4!/4/2)",
  text: "A real book excerpt.",
};
const CHAT = { threadId: "thread-1", messageId: "message-1" };

describe("research source note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHighlights).mockResolvedValue([]);
  });

  it("creates a regular highlight note with the real book position and source URL", async () => {
    await saveWebSourceAtBookCitation(SOURCE, BOOK, CHAT);
    expect(insertHighlight).toHaveBeenCalledWith(expect.objectContaining(BOOK));
    const annotation = vi.mocked(insertHighlight).mock.calls[0]?.[0];
    expect(annotation?.note).toContain("https://example.org/article");
    expect(annotation?.note).toContain("readany-chat:thread-1/message-1");
    expect(annotation?.note).toContain(SOURCE.excerpt);
  });

  it("preserves an existing note and avoids adding the same source twice", async () => {
    const old: Highlight = {
      ...BOOK,
      id: "anchor",
      note: "My existing note",
      color: "yellow",
      createdAt: 100,
      updatedAt: 100,
    };
    vi.mocked(getHighlights).mockResolvedValue([old]);
    await saveWebSourceAtBookCitation(SOURCE, BOOK, CHAT);
    const changes = vi.mocked(updateHighlight).mock.calls[0]?.[1];
    expect(changes?.note).toMatch(/^My existing note\n\n/);
    vi.mocked(getHighlights).mockResolvedValue([{ ...old, note: changes?.note }]);
    await saveWebSourceAtBookCitation(SOURCE, BOOK, CHAT);
    expect(updateHighlight).toHaveBeenCalledTimes(1);
    expect(insertHighlight).not.toHaveBeenCalled();
  });

  it("serializes two saves to the same annotation", async () => {
    const initial: Highlight = {
      ...BOOK,
      id: "anchor",
      color: "yellow",
      createdAt: 100,
      updatedAt: 100,
    };
    let stored = initial;
    vi.mocked(getHighlights).mockImplementation(async () => [stored]);
    vi.mocked(updateHighlight).mockImplementation(async (_id, changes) => {
      await Promise.resolve();
      stored = { ...stored, ...changes };
    });
    const other = { ...SOURCE, url: "https://example.org/other" };
    await Promise.all([
      saveWebSourceAtBookCitation(SOURCE, BOOK, CHAT),
      saveWebSourceAtBookCitation(other, BOOK, CHAT),
    ]);
    expect(stored.note).toContain(SOURCE.url);
    expect(stored.note).toContain(other.url);
  });

  it("rejects fabricated links and missing book positions", async () => {
    await expect(
      saveWebSourceAtBookCitation({ ...SOURCE, url: "https://internal.local/" }, BOOK, CHAT),
    ).rejects.toThrow();
    await expect(saveWebSourceAtBookCitation(SOURCE, { ...BOOK, cfi: "" }, CHAT)).rejects.toThrow();
    expect(insertHighlight).not.toHaveBeenCalled();
  });

  it("exports a usable link in all formats and respects source omission", () => {
    const message: MessageV2 = {
      id: CHAT.messageId,
      threadId: CHAT.threadId,
      role: "assistant",
      createdAt: 100,
      parts: [SOURCE],
    };
    expect(exportChatAsMarkdown([message])).toContain(
      "[Research \\[page\\]](<https://example.org/article>)",
    );
    expect(JSON.parse(exportChatAsJSON([message])).messages[0].parts[0]).toMatchObject({
      type: "web_citation",
      url: SOURCE.url,
      retrievedAt: SOURCE.retrievedAt,
    });
    expect(formatChatForClipboard([message])).toContain(SOURCE.url);
    for (const exportChat of [exportChatAsMarkdown, exportChatAsJSON, formatChatForClipboard]) {
      expect(exportChat([message], { includeCitations: false })).not.toContain(SOURCE.url);
    }
  });
});
