import { z } from "zod";
import { getBook, getVectorIndexProvenance } from "../../db/database";
import { readingContextService } from "../reading-context-service";
import {
  type BookEvidence,
  EvidenceRegistry,
  registerToolEvidence,
} from "../research/evidence-registry";
import { createBookReadingTools } from "./book-reading-tools";

const query = z.string().trim().min(1).max(500);
const chapterIndex = z.number().int().min(0).max(100_000);
const tools = {
  readany_get_context: {
    description: "Get metadata, current reading location and index status for the authorized book.",
    schema: z.strictObject({}),
  },
  readany_search_book: {
    description:
      "Search the authorized book for passages, returning source locations and evidence IDs. An unindexed book uses keyword search.",
    schema: z.strictObject({
      query,
      mode: z.enum(["bm25", "vector", "hybrid"]).optional(),
      topK: z.number().int().min(1).max(10).optional(),
    }),
  },
  readany_read_chapter: {
    description: "Read bounded chapter context with real source locations and evidence IDs.",
    schema: z.strictObject({ chapterIndex, range: z.number().int().min(1).max(5).optional() }),
  },
  readany_get_toc: {
    description: "List or search chapters of the authorized book.",
    schema: z.strictObject({
      query: query.optional(),
      aroundChapter: chapterIndex.optional(),
      offset: chapterIndex.optional(),
      limit: z.number().int().min(1).max(40).optional(),
    }),
  },
  readany_get_evidence: {
    description: "Retrieve a previously registered book citation by its evidence ID.",
    schema: z.strictObject({ evidenceId: z.string().regex(/^book-[1-9][0-9]{0,4}$/) }),
  },
};

type GatewayName = keyof typeof tools;
export const READANY_MCP_TOOLS = Object.entries(tools).map(([name, definition]) => ({
  name,
  description: definition.description,
  inputSchema: z.toJSONSchema(definition.schema, { io: "input" }),
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}));

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReadAnyToolError("Reading tool returned an invalid object.");
  }
  return value as Record<string, unknown>;
}

const MAX_EVIDENCE_ENTRIES = 512;

export class ReadAnyToolError extends Error {}

/** A book grant is a host decision, independent of the external agent's arguments. */
export class ReadAnyToolGateway {
  private readonly evidence: EvidenceRegistry;

  constructor(
    private readonly bookId: string,
    snapshot: readonly BookEvidence[] = [],
  ) {
    if (
      snapshot.length > MAX_EVIDENCE_ENTRIES ||
      snapshot.some((evidence) => evidence.type !== "book" || evidence.bookId !== bookId)
    ) {
      throw new ReadAnyToolError(
        "The evidence belongs to another book or exceeds the session limit.",
      );
    }
    this.evidence = EvidenceRegistry.restore(snapshot);
  }

  snapshot(): BookEvidence[] {
    return this.evidence.snapshot().filter((item): item is BookEvidence => item.type === "book");
  }

  async call(name: string, args: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!Object.prototype.hasOwnProperty.call(tools, name))
      throw new ReadAnyToolError("Unknown reading tool.");
    const tool = name as GatewayName;
    const parsed = tools[tool].schema.safeParse(args === undefined ? {} : args);
    if (!parsed.success)
      throw new ReadAnyToolError("Invalid arguments for the requested reading tool.");
    signal.throwIfAborted();
    const book = await getBook(this.bookId);
    signal.throwIfAborted();
    if (!book || book.syncStatus === "remote" || book.syncStatus === "downloading") {
      throw new ReadAnyToolError("The authorized book is unavailable locally.");
    }

    if (tool === "readany_get_context") {
      const live = readingContextService.getContext();
      const current = live?.bookId === this.bookId ? live : null;
      const index = book.isVectorized ? await getVectorIndexProvenance(this.bookId) : null;
      signal.throwIfAborted();
      return {
        bookId: this.bookId,
        title: book.meta.title,
        author: book.meta.author,
        format: book.format,
        indexed: book.isVectorized,
        index: index && { modelId: index.modelId, kind: index.kind, dimensions: index.dimensions },
        chapter: current && {
          index: current.currentChapter.index,
          title: current.currentChapter.title,
        },
        cfi: current?.currentPosition.cfi || book.currentCfi || null,
      };
    }

    if (tool === "readany_get_evidence") {
      const id = String(asObject(parsed.data).evidenceId);
      const entry = this.evidence.get(id);
      if (!entry || entry.type !== "book")
        throw new ReadAnyToolError("Evidence ID was not issued in this session.");
      const { type: _type, ...citation } = entry;
      return { id, evidenceId: id, type: "citation", ...citation };
    }

    const reading = createBookReadingTools(this.bookId, book.isVectorized);
    const selected =
      tool === "readany_search_book"
        ? reading.search
        : tool === "readany_read_chapter"
          ? reading.chapter
          : reading.toc;
    let data: Record<string, unknown>;
    try {
      data = asObject(await selected.execute(asObject(parsed.data)));
    } catch {
      signal.throwIfAborted();
      throw new ReadAnyToolError(
        "Reading failed. Check the book file and the active embedding model in ReadAny.",
      );
    }
    signal.throwIfAborted();
    if (typeof data.error === "string")
      throw new ReadAnyToolError("The requested book content is unavailable.");
    if (typeof data.vectorError === "string") {
      data = {
        ...data,
        vectorError:
          "Vector retrieval failed. Check the active model and the book index in ReadAny.",
      };
    }
    if (tool === "readany_get_toc") {
      const { debug: _debug, ...visible } = data;
      data = visible;
    }
    const result = asObject(registerToolEvidence(this.evidence, selected.name, data, this.bookId));
    if (this.evidence.snapshot().length > MAX_EVIDENCE_ENTRIES) {
      throw new ReadAnyToolError("This session has reached its evidence limit.");
    }
    return {
      ...result,
      bookId: this.bookId,
      source: result.source ?? (book.isVectorized ? "index" : "original-file"),
      ...(tool === "readany_search_book" && !book.isVectorized
        ? {
            searchMode: "keyword-fallback",
            vectorStatus: "unavailable",
          }
        : {}),
    };
  }
}
