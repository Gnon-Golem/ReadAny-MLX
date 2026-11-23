import { isMlxDevelopmentBuild } from "@/lib/macos-mlx-build";
import type { BookEvidence } from "@readany/core/ai/research";
import {
  READANY_MCP_TOOLS,
  ReadAnyToolError,
  ReadAnyToolGateway,
} from "@readany/core/ai/tools/readany-tool-gateway";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ToolRequest {
  requestId: string;
  bookId: string;
  name: string;
  arguments: unknown;
  evidence: BookEvidence[];
}

let startup: Promise<void> | undefined;
export function startDesktopReadingMcp(): Promise<void> {
  startup ??= registerDesktopReadingMcp();
  return startup;
}

async function registerDesktopReadingMcp(): Promise<void> {
  if (!(await isMlxDevelopmentBuild())) return;
  const controllers = new Map<string, AbortController>();
  await Promise.all([
    listen<string>("readany-mcp-cancel", ({ payload }) => controllers.get(payload)?.abort()),
    listen<ToolRequest>("readany-mcp-tool", ({ payload }) => {
      const controller = new AbortController();
      controllers.set(payload.requestId, controller);
      void (async () => {
        let reply:
          | { result: Record<string, unknown>; evidence: BookEvidence[] }
          | { error: string };
        try {
          const gateway = new ReadAnyToolGateway(payload.bookId, payload.evidence);
          const result = await gateway.call(payload.name, payload.arguments, controller.signal);
          reply = { result, evidence: gateway.snapshot() };
        } catch (error) {
          reply = {
            error: error instanceof ReadAnyToolError ? error.message : "Reading tool failed.",
          };
        }
        if (!controller.signal.aborted) {
          await invoke("readany_mcp_reply", { requestId: payload.requestId, reply });
        }
      })()
        .catch(console.error)
        .finally(() => controllers.delete(payload.requestId));
    }),
  ]);
  await invoke("readany_mcp_start", { tools: READANY_MCP_TOOLS });
}
