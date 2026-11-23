import type { Highlight, Note } from "@readany/core/types";
import { describe, expect, it } from "vitest";
import { type ReaderChatContext, readerTurnContext } from "./reader-chat-context";

const book = "book-a";
const reader: ReaderChatContext = {
  bookId: book,
  chapterIndex: 3,
  chapterTitle: "Same chapter title",
  currentCfi: "epubcfi(/6/8!/4/2)",
  selectedText: "private selection",
  selectionCfi: "epubcfi(/6/8!/4/2,/1:0,/1:5)",
};
const question = "Explain this";
const highlights: Highlight[] = [
  {
    id: "a",
    bookId: book,
    text: "current highlight",
    chapterTitle: reader.chapterTitle,
    cfi: "epubcfi(/6/8!/4/8)",
    color: "yellow",
    createdAt: 0,
    updatedAt: 0,
  },
];
const notes: Note[] = [
  {
    id: "b",
    bookId: book,
    title: "current note",
    content: "current note body",
    chapterTitle: reader.chapterTitle,
    cfi: "epubcfi(/6/8!/4/8)",
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

describe("readerTurnContext", () => {
  it("keeps the global prompt plain, even with an attached selection and annotations", () => {
    expect(
      readerTurnContext({
        reader,
        scope: "global",
        question,
        quote: { id: "selection", bookId: book, text: "explicit selection" },
        annotations: { highlights, notes },
      }),
    ).toEqual({ prompt: question, quotes: [] });
  });

  it("adds only the requested location or selection and snapshots the explicit quote", () => {
    const bookTurn = readerTurnContext({ reader, scope: "book", question });
    expect(bookTurn.prompt).toContain(book);
    expect(bookTurn.prompt).not.toContain(reader.currentCfi);
    expect(bookTurn.prompt).not.toContain(reader.selectedText);
    const chapterTurn = readerTurnContext({ reader, scope: "chapter", question });
    expect(chapterTurn.prompt).toContain(reader.currentCfi);
    expect(chapterTurn.prompt).not.toContain(reader.selectedText);
    const selectionTurn = readerTurnContext({
      reader,
      scope: "selection",
      question,
      quote: {
        id: "selection",
        bookId: book,
        text: "captured excerpt",
        source: "Different chapter",
        cfi: "epubcfi(/6/6!/4/2,/1:0,/1:4)",
      },
    });
    expect(selectionTurn.quotes[0]).toMatchObject({ text: "captured excerpt" });
    expect(selectionTurn.prompt).toContain("epubcfi(/6/6!");
    expect(selectionTurn.prompt).not.toContain(reader.selectedText);
  });

  it("includes opt-in notes and highlights only for this book and current chapter", () => {
    const result = readerTurnContext({
      reader,
      scope: "chapter",
      question,
      annotations: {
        highlights: [...highlights, { ...highlights[0], bookId: "other", text: "other book" }],
        notes: [...notes, { ...notes[0], cfi: "epubcfi(/6/10!/4/8)", content: "other chapter" }],
      },
    });
    expect(result.prompt).toContain("current highlight");
    expect(result.prompt).toContain("current note body");
    expect(result.prompt).not.toContain("other book");
    expect(result.prompt).not.toContain("other chapter");
    expect(result.prompt).not.toContain(reader.selectedText);
  });
});
