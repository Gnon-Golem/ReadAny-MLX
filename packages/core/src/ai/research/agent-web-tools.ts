import type { ToolDefinition } from "../tools/tool-types";
import { record } from "./parallel-transport";
import type { ResearchCache } from "./research-cache";
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
  cache?: ResearchCache,
) {
  const allowedUrls = new Set(explicitWebUrls(question));
  const tools = createWebTools(
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
  if (!cache) return tools;

  const keyFor = (name: string, args: Record<string, unknown>) => {
    if (name === "webSearch") {
      const query =
        typeof args.query === "string" ? publicSearchQuery(args.query, privateTexts) : undefined;
      return query && JSON.stringify([provider.id, name, query, 5]);
    }
    const url = typeof args.url === "string" ? publicWebUrl(args.url) : undefined;
    return url && allowedUrls.has(url) ? JSON.stringify([provider.id, name, url]) : undefined;
  };
  return tools.map<ToolDefinition>((tool) => ({
    ...tool,
    getCachedResult(args) {
      const key = keyFor(tool.name, args);
      const result = key ? record(cache.read(key)) : undefined;
      if (!result) return;
      if (Array.isArray(result.result)) {
        for (const source of result.result) {
          const candidate = record(source);
          const url = typeof candidate?.url === "string" ? publicWebUrl(candidate.url) : undefined;
          if (url) allowedUrls.add(url);
        }
      }
      return { ...result, cached: true };
    },
    async execute(args) {
      const response = await tool.execute(args);
      const key = keyFor(tool.name, args);
      if (key && record(response)?.ok === true) {
        const result = record(response)?.result;
        const empty = !result || (Array.isArray(result) && result.length === 0);
        const ttl = empty ? 20_000 : tool.name === "webSearch" ? 90_000 : 240_000;
        cache.write(key, response, ttl);
      }
      return response;
    },
  }));
}

export function summarizeWebToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return {};
  const result = value as Record<string, unknown>;
  if (typeof result.error === "string") {
    return { error: result.error, code: result.code, retryAfter: result.retryAfter };
  }
  return {
    count:
      typeof result.total === "number"
        ? result.total
        : Array.isArray(result.result)
          ? result.result.length
          : result.result
            ? 1
            : 0,
    ...(result.cached === true ? { cached: true } : {}),
    ...(typeof result.reason === "string" ? { notice: result.reason } : {}),
  };
}
