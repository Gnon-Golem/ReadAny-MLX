import {
  createFallbackChapterContextTool,
  createFallbackResolveChapterReferenceTool,
  createFallbackSearchTool,
  createFallbackTocTool,
} from "./fallback-content-tools";
import {
  createRagContextTool,
  createRagSearchTool,
  createRagTocTool,
  createResolveChapterReferenceTool,
} from "./rag-tools";

/** Use the same reading implementation in native and externally scoped tools. */
export function createBookReadingTools(bookId: string, isVectorized: boolean) {
  return isVectorized
    ? {
        resolveChapter: createResolveChapterReferenceTool(bookId),
        search: createRagSearchTool(bookId),
        toc: createRagTocTool(bookId),
        chapter: createRagContextTool(bookId),
      }
    : {
        resolveChapter: createFallbackResolveChapterReferenceTool(bookId),
        search: createFallbackSearchTool(bookId),
        toc: createFallbackTocTool(bookId),
        chapter: createFallbackChapterContextTool(bookId),
      };
}
