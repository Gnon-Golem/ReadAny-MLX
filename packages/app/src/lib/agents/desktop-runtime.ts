import type { AgentRuntime, AgentRuntimeSession } from "@readany/core/ai";

export type ExternalAgent = "codex" | "antigravity";

export interface AgentConfigOption {
  id: string;
  label: string;
  currentValue: string;
  options: Array<{ value: string; label: string }>;
}

export interface DesktopAgentRuntime extends AgentRuntime {
  readonly connected: boolean;
  close(session?: AgentRuntimeSession): Promise<void>;
  resolveEvidence(id: string): Promise<Record<string, unknown>>;
  setConfigOption?(session: AgentRuntimeSession, id: string, value: string): Promise<void>;
}
