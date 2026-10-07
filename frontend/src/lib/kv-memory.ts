/** Process-local fallback only: values and locks obey their requested TTL.
 * This is not durable storage and never proves that a Redis write succeeded.
 */
export class MemoryKvStore {
  private entries = new Map<string, { value: string; expiresAt: number | null }>();
  private writes = 0;
  private now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean { return this.get(key) !== undefined; }

  set(key: string, value: string, ttlSeconds?: number): void {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? this.now() + ttlSeconds * 1000 : null,
    });
    // Expired entries that are never read should not accumulate indefinitely.
    if (++this.writes % 64 === 0) {
      const now = this.now();
      for (const [k, entry] of this.entries) {
        if (entry.expiresAt !== null && now >= entry.expiresAt) this.entries.delete(k);
      }
    }
  }

  delete(key: string): boolean { return this.entries.delete(key); }
}
