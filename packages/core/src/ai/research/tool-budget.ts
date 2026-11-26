export const RESEARCH_TOOL_LIMITS = {
  total: 24,
  local: 14,
  chapter: 12,
  reference: 4,
  webSearch: 4,
  webFetch: 6,
  repeated: 3,
  soft: 16,
  recursion: 64,
} as const;

type Category = "other" | "local" | "chapter" | "reference" | "webSearch" | "webFetch";
type Counter = Exclude<Category, "other"> | "total";

const COUNTERS: Record<Category, readonly Counter[]> = {
  other: ["total"],
  local: ["total", "local"],
  chapter: ["total", "local", "chapter"],
  reference: ["total", "local", "chapter", "reference"],
  webSearch: ["total", "webSearch"],
  webFetch: ["total", "webFetch"],
};

export class ResearchToolBudget {
  readonly executions: Record<Counter, number> = {
    total: 0,
    local: 0,
    chapter: 0,
    reference: 0,
    webSearch: 0,
    webFetch: 0,
  };
  private readonly requests = new Map<string, number>();
  private blockedInARow = 0;

  request(key: string): boolean {
    const attempts = (this.requests.get(key) ?? 0) + 1;
    this.requests.set(key, attempts);
    if (attempts <= RESEARCH_TOOL_LIMITS.repeated) return true;
    this.blockedInARow += 1;
    return false;
  }

  // Read and increment synchronously before awaiting any tool work.
  reserve(category: Category): Counter | undefined {
    const counters = COUNTERS[category];
    const exhausted = counters.find((key) => this.executions[key] >= RESEARCH_TOOL_LIMITS[key]);
    if (exhausted) {
      this.blockedInARow += 1;
      return exhausted;
    }
    this.blockedInARow = 0;
    for (const key of counters) this.executions[key] += 1;
  }

  get summarizeOnly(): boolean {
    return this.executions.total >= RESEARCH_TOOL_LIMITS.total || this.blockedInARow >= 3;
  }

  get nearLimit(): boolean {
    return this.executions.total >= RESEARCH_TOOL_LIMITS.soft;
  }
}
