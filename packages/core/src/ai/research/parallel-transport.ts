import { type WebRequestOptions, WebResearchError } from "./web-provider";

const ENDPOINT = "https://mcp.parallel.ai/mcp?tools=web_search,web_fetch";
const VERSION = "2025-11-25";
const SUPPORTED_VERSIONS = [VERSION, "2025-06-18", "2025-03-26"];
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT = 20_000;

export type ParallelFetch = (
  url: string,
  init: {
    method: "POST" | "DELETE";
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    credentials: "omit";
    redirect: "error";
  },
) => Promise<Response>;
export type ParallelTool = "web_search" | "web_fetch";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function invalidResponse() {
  return new WebResearchError("invalid_response", "Parallel returned an unexpected response.");
}

function parseMessage(text: string, id: number) {
  const message = record(JSON.parse(text));
  if (message?.jsonrpc !== "2.0" || message.id !== id) return;
  if (message.error || !Object.prototype.hasOwnProperty.call(message, "result"))
    throw invalidResponse();
  return message;
}

async function readMessage(response: Response, id: number): Promise<unknown> {
  const type = response.headers.get("content-type")?.split(";")[0]?.trim();
  if ((type !== "application/json" && type !== "text/event-stream") || !response.body) {
    throw invalidResponse();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        buffer += decoder.decode();
        break;
      }
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new WebResearchError("too_large", "Parallel response exceeded the size limit.");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (type !== "text/event-stream") continue;
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const text = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        const message = text ? parseMessage(text, id) : undefined;
        if (message) return message.result;
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
    if (type === "application/json") {
      const message = parseMessage(buffer, id);
      if (message) return message.result;
    }
    throw invalidResponse();
  } catch (error) {
    if (error instanceof SyntaxError) throw invalidResponse();
    throw error;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export async function callParallelTool(
  http: ParallelFetch,
  name: ParallelTool,
  args: Record<string, unknown>,
  options: WebRequestOptions = {},
): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) {
    throw new WebResearchError("cancelled", "Web research was cancelled.");
  }
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const deadline = setTimeout(cancel, timeoutMs);
  let session: string | undefined;
  let version: string | undefined;
  let id = 0;

  const headers = () => ({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...(session ? { "Mcp-Session-Id": session } : {}),
    ...(version ? { "MCP-Protocol-Version": version } : {}),
  });

  async function post(method: string, params: Record<string, unknown> = {}, notification = false) {
    const messageId = notification ? undefined : ++id;
    const response = await http(ENDPOINT, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: messageId, method, params }),
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
    });
    if (response.redirected) throw invalidResponse();
    if (response.status === 429) {
      void response.body?.cancel().catch(() => undefined);
      throw new WebResearchError(
        "rate_limited",
        "Parallel is rate limited. Try again later.",
        response.headers.get("retry-after") ?? undefined,
      );
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new WebResearchError(
        "unavailable",
        `Parallel request failed (HTTP ${response.status}).`,
      );
    }
    if (messageId === undefined) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status !== 202) throw invalidResponse();
      return;
    }
    if (method === "initialize") session = response.headers.get("mcp-session-id") || undefined;
    return readMessage(response, messageId);
  }

  try {
    const initialized = record(
      await post("initialize", {
        protocolVersion: VERSION,
        capabilities: {},
        clientInfo: { name: "ReadAny MLX", version: "1.3.7" },
      }),
    );
    const negotiated = initialized?.protocolVersion;
    if (typeof negotiated !== "string" || !SUPPORTED_VERSIONS.includes(negotiated)) {
      throw invalidResponse();
    }
    version = negotiated;
    await post("notifications/initialized", {}, true);

    // Check the actual allowlisted capability before sending search terms or URLs.
    const tools = record(await post("tools/list"))?.tools;
    if (!Array.isArray(tools) || !tools.some((tool) => record(tool)?.name === name)) {
      throw invalidResponse();
    }
    const result = record(await post("tools/call", { name, arguments: args }));
    if (!result) throw invalidResponse();
    if (result.isError === true) {
      throw new WebResearchError("unavailable", "Parallel could not complete this request.");
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      if (options.signal?.aborted)
        throw new WebResearchError("cancelled", "Web research was cancelled.");
      throw new WebResearchError("timeout", "Parallel did not respond in time.");
    }
    if (error instanceof WebResearchError) throw error;
    throw new WebResearchError("unavailable", "Could not connect to Parallel.");
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", cancel);
    if (session && !controller.signal.aborted) {
      const cleanup = new AbortController();
      const timer = setTimeout(() => cleanup.abort(), 2000);
      void http(ENDPOINT, {
        method: "DELETE",
        headers: headers(),
        credentials: "omit",
        redirect: "error",
        signal: cleanup.signal,
      })
        .then((response) => response.body?.cancel())
        .catch(() => undefined)
        .finally(() => clearTimeout(timer));
    }
  }
}
