import { describe, expect, it, vi } from "vitest";
import { ParallelWebProvider } from "./parallel-provider";
import type { ParallelFetch } from "./parallel-transport";
import { WebResearchError, publicWebUrl } from "./web-provider";
import { createWebTools } from "./web-tools";

const URL = "https://developer.apple.com/documentation/metal";
const SOURCE = {
  url: URL,
  title: "Metal · 文档",
  publish_date: null,
  excerpts: ["Use the GPU to render graphics."],
};

function mockParallel(result: unknown, { sse = true, tools = ["web_search", "web_fetch"] } = {}) {
  return vi.fn<ParallelFetch>(async (_url, init) => {
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    const { method, id } = JSON.parse(init.body ?? "");
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    const data =
      method === "initialize"
        ? { protocolVersion: "2025-11-25" }
        : method === "tools/list"
          ? { tools: tools.map((name) => ({ name })) }
          : result;
    const json = JSON.stringify({ jsonrpc: "2.0", id, result: data });
    if (!sse) {
      return new Response(json, {
        headers: { "content-type": "application/json", "mcp-session-id": "test-session" },
      });
    }
    // Split the delimiter and split a multi-byte character across chunks.
    const bytes = new TextEncoder().encode(
      `: keepalive\r\n\r\nevent: message\r\ndata: ${json}\r\n\r\n`,
    );
    return new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream", "mcp-session-id": "test-session" } },
    );
  });
}

describe("Parallel provider", () => {
  it("negotiates and sends only anonymous allowlisted requests then normalizes sources", async () => {
    const http = mockParallel({
      structuredContent: {
        results: [
          { ...SOURCE, url: "https://127.0.0.1/" },
          { ...SOURCE, url: `${URL}#gpu` },
          SOURCE,
          { ...SOURCE, url: "https://developer.apple.com/metal", publish_date: "2025-11-21" },
        ],
      },
    });
    const sources = await new ParallelWebProvider(http).search({ query: " Metal  GPU ", limit: 2 });
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      provider: "parallel",
      url: URL,
      title: SOURCE.title,
      excerpt: SOURCE.excerpts[0],
      retrievedAt: expect.any(String),
      retrievalMethod: "search",
    });
    expect(sources[0]?.publishedAt).toBeUndefined();
    expect(sources[1]?.publishedAt).toBe("2025-11-21");
    const posts = http.mock.calls.filter(([, init]) => init.method === "POST");
    expect(posts.map(([, x]) => JSON.parse(x.body ?? "").method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    for (const [url, init] of posts) {
      expect(url).toBe("https://mcp.parallel.ai/mcp?tools=web_search,web_fetch");
      expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
      expect(init.headers).not.toHaveProperty("Authorization");
    }
    expect(posts[3]?.[1].headers).toMatchObject({
      "Mcp-Session-Id": "test-session",
      "MCP-Protocol-Version": "2025-11-25",
    });
    expect(JSON.parse(posts[3]?.[1].body ?? "").params).toEqual({
      name: "web_search",
      arguments: { objective: "Metal GPU", search_queries: ["Metal GPU"] },
    });
  });

  it("reads an excerpt from a legacy content envelope over JSON", async () => {
    const http = mockParallel(
      { content: [{ type: "text", text: JSON.stringify({ results: [SOURCE] }) }] },
      { sse: false },
    );
    expect(await new ParallelWebProvider(http).fetchPage(URL)).toMatchObject({
      url: URL,
      retrievalMethod: "fetch",
    });
    const call = http.mock.calls[3]?.[1];
    expect(JSON.parse(call?.body ?? "").params.arguments).toEqual({
      urls: [URL],
      full_content: false,
    });
  });

  it("ignores a fetch result substituted with a redirect destination", async () => {
    const http = mockParallel({
      structuredContent: { results: [{ ...SOURCE, url: "https://example.com/other" }] },
    });
    expect(await new ParallelWebProvider(http).fetchPage(URL)).toBeUndefined();
  });

  it("rejects redirects of the MCP connection", async () => {
    const response = new Response("{}");
    Object.defineProperty(response, "redirected", { value: true });
    const provider = new ParallelWebProvider(async () => response);
    await expect(provider.search({ query: "Metal" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("reports an empty result separately from a missing tool or malformed output", async () => {
    const query = { query: "no results" };
    const response = { structuredContent: { results: [] } };
    expect(await new ParallelWebProvider(mockParallel(response)).search(query)).toEqual([]);
    const noTools = mockParallel(response, { tools: [] });
    await expect(new ParallelWebProvider(noTools).search(query)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(noTools.mock.calls.some(([, init]) => init.body?.includes("tools/call"))).toBe(false);
    await expect(new ParallelWebProvider(mockParallel({})).search(query)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("bounds response bytes while streaming", async () => {
    const http = mockParallel(
      { structuredContent: { results: [{ ...SOURCE, excerpts: ["x".repeat(270_000)] }] } },
      { sse: false },
    );
    await expect(new ParallelWebProvider(http).search({ query: "Metal" })).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("reports rate limit and network failure without exposing raw server responses", async () => {
    const rated = new ParallelWebProvider(
      async () =>
        new Response("raw error", {
          status: 429,
          headers: { "retry-after": "20" },
        }),
    );
    const [search] = createWebTools(rated);
    await expect(search?.execute({ query: "Metal" })).resolves.toMatchObject({
      ok: false,
      code: "rate_limited",
      retryAfter: "20",
    });
    const offline = new ParallelWebProvider(async () => {
      throw new Error("private transport detail");
    });
    await expect(offline.search({ query: "Metal" })).rejects.toMatchObject({
      code: "unavailable",
      message: "Could not connect to Parallel.",
    });
  });

  it("aborts transport on timeout or cancellation and can restart", async () => {
    const hanging = vi.fn<ParallelFetch>(async (_url, init) => {
      throw await new Promise((resolve) =>
        init.signal.addEventListener("abort", resolve, { once: true }),
      );
    });
    const provider = new ParallelWebProvider(hanging);
    await expect(provider.search({ query: "Metal" }, { timeoutMs: 10 })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(hanging.mock.calls[0]?.[1].signal.aborted).toBe(true);

    const controller = new AbortController();
    const active = provider.fetchPage(URL, { signal: controller.signal });
    controller.abort();
    await expect(active).rejects.toMatchObject({ code: "cancelled" });
    const n = hanging.mock.calls.length;
    await expect(provider.fetchPage(URL, { signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(hanging).toHaveBeenCalledTimes(n);

    const fresh = new ParallelWebProvider(
      mockParallel({ structuredContent: { results: [SOURCE] } }),
    );
    await expect(fresh.fetchPage(URL)).resolves.toMatchObject({ url: URL });
  });

  it("makes no request for unsafe URLs or blank and oversized queries", async () => {
    const http = mockParallel({ structuredContent: { results: [] } });
    const provider = new ParallelWebProvider(http);
    const forbidden = [
      "https://localhost/",
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://0x7f000001/",
      "https://[::1]/",
      "https://network.internal/",
      "https://device.local/",
      "https://home.home.arpa/",
      "https://a.com:8181/",
      "https://a.com@127.0.0.1/",
      "https://%6cocalhost/",
      "file:///etc/hosts",
      "javascript:alert(1)",
      "http://example.com/",
      "https://example.com\\@127.0.0.1/",
    ];
    for (const url of forbidden) {
      expect(publicWebUrl(url)).toBeUndefined();
      await expect(provider.fetchPage(url)).rejects.toMatchObject({ code: "unsafe_url" });
    }
    for (const query of ["  ", "q".repeat(281)]) {
      await expect(provider.search({ query })).rejects.toMatchObject({ code: "invalid_query" });
    }
    expect(http).not.toHaveBeenCalled();
  });
});

describe.runIf(process.env.READANY_TEST_LIVE_PARALLEL === "1")("live anonymous Parallel", () => {
  it("discovers both tools, searches and reads public Apple Metal documentation", async () => {
    const provider = new ParallelWebProvider();
    const sources = await provider.search({
      query: "Apple developer Metal framework GPU documentation",
      limit: 3,
    });
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.length).toBeLessThanOrEqual(3);
    try {
      const source = await provider.fetchPage(URL);
      expect(source?.url).toBe(URL);
      expect(source?.excerpt).toMatch(/Metal/i);
    } catch (error) {
      if (error instanceof WebResearchError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  }, 45_000);
});
