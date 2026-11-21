/** An application-local cache for normalized public web results only. */
export class ResearchCache {
  private entries = new Map<string, { result: unknown; expiry: number }>();

  constructor(
    private readonly capacity = 32,
    private readonly now = Date.now,
  ) {}

  read(key: string): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (this.now() >= entry.expiry) return;
    this.entries.set(key, entry);
    return entry.result;
  }

  write(key: string, result: unknown, ttl: number): void {
    if (this.capacity <= 0 || ttl <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { result, expiry: this.now() + ttl });
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}
