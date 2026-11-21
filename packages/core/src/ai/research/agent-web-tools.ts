import { explicitWebUrls, publicSearchQuery } from "./research-planner";
import { WebResearchError, type WebSearchProvider, publicWebUrl } from "./web-provider";
import { createWebTools } from "./web-tools";

export function isWebTool(name: string): boolean {
  return name === "webSearch" || name === "webFetch";
}

export function createScopedWebTools(
  provider: WebSearchProvider,
  question: string,
  privateTexts: string[],
  signal?: AbortSignal,
) {
  const allowedUrls = new Set(explicitWebUrls(question));
  return createWebTools(
    {
      id: provider.id,
      async search(request, options) {
        const query = publicSearchQuery(request.query, privateTexts);
        if (!query) {
          throw new WebResearchError(
            "invalid_query",
            "Use concise public terms rather than private text.",
          );
        }
        const sources = await provider.search({ ...request, query }, options);
        for (const source of sources) {
          const url = publicWebUrl(source.url);
          if (url) allowedUrls.add(url);
        }
        return sources;
      },
      async fetchPage(url, options) {
        const canonical = publicWebUrl(url);
        if (!canonical || !allowedUrls.has(canonical)) {
          throw new WebResearchError(
            "unsafe_url",
            "Use a URL returned by search or provided by the user.",
          );
        }
        return provider.fetchPage(canonical, options);
      },
    },
    { signal },
  );
}

export function summarizeWebToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return {};
  const result = value as Record<string, unknown>;
  if (typeof result.error === "string") {
    return { error: result.error, code: result.code, retryAfter: result.retryAfter };
  }
  return {
    count: Array.isArray(result.result) ? result.result.length : result.result ? 1 : 0,
    ...(typeof result.reason === "string" ? { notice: result.reason } : {}),
  };
}
