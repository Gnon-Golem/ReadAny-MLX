/** A provider-owned conversation associated with a ReadAny reading grant. */
export interface AgentRuntimeSession {
  readonly runtimeId: string;
  readonly conversationId: string;
  readonly readingSessionId: string;
}

export interface AgentRuntimeOptions {
  readonly readingSessionId: string;
  readonly bookId?: string;
  readonly workingDirectory: string;
}

export type AgentRuntimeEvent =
  | { type: "turnStarted"; turnId: string }
  | { type: "textDelta"; turnId: string; itemId: string; text: string }
  | {
      type: "toolStatus";
      turnId: string;
      itemId: string;
      name: string;
      status: "started" | "completed" | "failed";
    }
  | { type: "bookEvidence"; turnId: string; evidenceId: string }
  | { type: "approvalRequested"; turnId: string; requestId: string; description: string }
  | {
      type: "turnFinished";
      turnId: string;
      outcome: "completed" | "cancelled" | "failed";
      message?: string;
    };

/** Contract for future Codex App Server and other supported runtimes. */
export interface AgentRuntime {
  start(options: AgentRuntimeOptions): Promise<AgentRuntimeSession>;
  resume(session: AgentRuntimeSession, options: AgentRuntimeOptions): Promise<void>;
  runTurn(
    session: AgentRuntimeSession,
    prompt: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentRuntimeEvent>;
  respondToApproval(
    session: AgentRuntimeSession,
    requestId: string,
    decision: "allow" | "deny" | "cancel",
  ): Promise<void>;
  close(session: AgentRuntimeSession): Promise<void>;
}
