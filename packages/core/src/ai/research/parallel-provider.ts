import { type ParallelFetch, createParallelTransport, record } from "./parallel-transport";
import {
  type WebRequestOptions,
  WebResearchError,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSource,
  publicWebUrl,
} from "./web-provider";

const MAX_RESULTS = 8;
const MAX_QUERY = 280;
const MAX_EXCERPT = 1600;

function unpackResults(value: unknown): unknown[] {
  const payload = record(value);
  const structured = record(payload?.structuredContent);
  if (Array.isArray(structured?.results)) return structured.results;
  const content = payload?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const entry = record(item);
      if (entry?.type !== "text" || typeof entry.text !== "string") continue;
      try {
        const parsed = record(JSON.parse(entry.text));
        if (Array.isArray(parsed?.results)) return parsed.results;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  throw new WebResearchError("invalid_response", "Parallel returned no recognizable sources.");
}

function normalize(
  value: unknown,
  method: WebSource["retrievalMethod"],
  limit: number,
): WebSource[] {
  const retrievedAt = new Date().toISOString();
  const sources = new Map<string, WebSource>();
  for (const item of unpackResults(value)) {
    const row = record(item);
    const url = typeof row?.url === "string" ? publicWebUrl(row.url) : undefined;
    if (!url || sources.has(url)) continue;

    const excerpts = Array.isArray(row?.excerpts)
      ? row.excerpts.filter((excerpt): excerpt is string => typeof excerpt === "string")
      : [];
    const excerpt = excerpts.join("\n").trim().slice(0, MAX_EXCERPT);
    if (!excerpt) continue;
    const rawDate = row?.publish_date;
    const publishedAt =
      typeof rawDate === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(rawDate) &&
      Number.isFinite(Date.parse(rawDate))
        ? rawDate
        : undefined;
    sources.set(url, {
      provider: "parallel",
      url,
      title:
        (typeof row?.title === "string" && row.title.trim().slice(0, 240)) || new URL(url).hostname,
      excerpt,
      publishedAt,
      retrievedAt,
      retrievalMethod: method,
    });
    if (sources.size >= limit) break;
  }
  return [...sources.values()];
}

export class ParallelWebProvider implements WebSearchProvider {
  readonly id = "parallel";

  private readonly transport;
  private correlationId?: string;

  /** One provider per research scope. Parallel associates web calls from this instance. */
  constructor(http: ParallelFetch = (url, init) => fetch(url, init)) {
    this.transport = createParallelTransport(http);
  }

  private async call(
    name: "web_search" | "web_fetch",
    args: Record<string, unknown>,
    options?: WebRequestOptions,
  ) {
    const result = await this.transport(
      name,
      { ...args, ...(this.correlationId ? { session_id: this.correlationId } : {}) },
      options,
    );
    const correlationId = record(result.structuredContent)?.session_id;
    if (
      typeof correlationId === "string" &&
      correlationId.length > 0 &&
      correlationId.length <= 1000
    ) {
      this.correlationId ??= correlationId;
    }
    return result;
  }

  async search({ query, limit = 5 }: WebSearchRequest, options?: WebRequestOptions) {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > MAX_QUERY) {
      throw new WebResearchError("invalid_query", "Enter a concise query of up to 280 characters.");
    }
    const result = await this.call(
      "web_search",
      { objective: normalized, search_queries: [normalized] },
      options,
    );
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(MAX_RESULTS, Math.floor(limit)))
      : 5;
    return normalize(result, "search", boundedLimit);
  }

  async fetchPage(url: string, options?: WebRequestOptions) {
    const allowed = publicWebUrl(url);
    if (!allowed) {
      throw new WebResearchError("unsafe_url", "Only public HTTPS page addresses are supported.");
    }
    const result = await this.call("web_fetch", { urls: [allowed], full_content: false }, options);
    // Preserve identity. Unexpected redirect destinations cannot become citations.
    return normalize(result, "fetch", MAX_RESULTS).find((source) => source.url === allowed);
  }
}
