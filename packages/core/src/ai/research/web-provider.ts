export interface WebSource {
  provider: string;
  url: string;
  title: string;
  excerpt: string;
  publishedAt?: string;
  retrievedAt: string;
  retrievalMethod: "search" | "fetch";
}

export interface WebRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface WebSearchRequest {
  query: string;
  limit?: number;
}

export interface WebSearchProvider {
  readonly id: string;
  search(request: WebSearchRequest, options?: WebRequestOptions): Promise<WebSource[]>;
  fetchPage(url: string, options?: WebRequestOptions): Promise<WebSource | undefined>;
}

export type WebErrorCode =
  | "cancelled"
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "too_large"
  | "unsafe_url"
  | "invalid_query";

export class WebResearchError extends Error {
  constructor(
    readonly code: WebErrorCode,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "WebResearchError";
  }
}

const RESERVED_SUFFIX =
  /\.(?:localhost|local|internal|lan|home|corp|test|example|invalid|onion|arpa)$/i;

export function publicWebUrl(value: string): string | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters before URL normalization.
  if (value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return;
  // Disallow numeric and escaped authorities before platform URL normalization.
  const authority = /^https:\/\/([a-z\d.-]+)(?::443)?(?:[/?#]|$)/i.exec(value);
  const host = authority?.[1]?.toLowerCase();
  if (!host || !host.includes(".") || RESERVED_SUFFIX.test(host)) return;
  if (!/\.[a-z](?:[a-z\d-]*[a-z\d])?$/.test(host)) return;
  if (host.split(".").some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) {
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password) return;
    url.hash = "";
    return url.toString();
  } catch {
    return;
  }
}
