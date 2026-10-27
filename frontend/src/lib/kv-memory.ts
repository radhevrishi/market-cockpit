/** Process-local fallback only: values and locks obey their requested TTL.
 * This is not durable storage and never proves that a Redis write succeeded.
 *
 * zzz1196 — every Redis write was ALSO kept here until its expiry (often days), with no size limit, so the process grew by the
 * size of everything it had written (8–11 MB feeds, graded days, guidance stores…) — the largest share of the Railway memory bill.
 * With `maxBytes` set, entries that can be rebuilt (market data) are kept up to that many bytes, oldest write evicted first.
 * `pinned` keys (personal state, locks, once-markers) are never evicted and do not count toward the limit.
 * Without `maxBytes` (no Redis configured: this is then the only store) nothing is evicted.
 */
export interface MemoryKvOpts { maxBytes?: number; pinned?: (key: string) => boolean }
export class MemoryKvStore {
  private entries = new Map<string, { value: string; expiresAt: number | null; bytes: number }>();
  private writes = 0;
  private now: () => number;
  private maxBytes: number;
  private pinned: (key: string) => boolean;
  /** bytes held by evictable (non-pinned) entries */
  bytes = 0;
  evictions = 0;

  constructor(now: () => number = Date.now, opts: MemoryKvOpts = {}) {
    this.now = now;
    this.maxBytes = opts.maxBytes && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : Infinity;
    this.pinned = opts.pinned || (() => false);
  }

  private drop(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    this.bytes -= e.bytes;
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && this.now() >= entry.expiresAt) {
      this.drop(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean { return this.get(key) !== undefined; }

  set(key: string, value: string, ttlSeconds?: number): void {
    this.drop(key);   // re-inserted at the end: the newest write is evicted last
    const pin = this.pinned(key);
    const bytes = pin ? 0 : value.length * 2;
    if (!pin && bytes > this.maxBytes) return;   // larger than the whole budget: not kept (Redis holds it)
    this.entries.set(key, {
      value, bytes,
      expiresAt: ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? this.now() + ttlSeconds * 1000 : null,
    });
    this.bytes += bytes;
    if (this.bytes > this.maxBytes) {
      for (const [k, e] of this.entries) {
        if (this.bytes <= this.maxBytes) break;
        if (e.bytes === 0) continue;   // pinned
        this.entries.delete(k); this.bytes -= e.bytes; this.evictions++;
      }
    }
    // Expired entries that are never read should not accumulate indefinitely.
    if (++this.writes % 64 === 0) {
      const now = this.now();
      for (const [k, entry] of this.entries) {
        if (entry.expiresAt !== null && now >= entry.expiresAt) this.drop(k);
      }
    }
  }

  delete(key: string): boolean { const had = this.entries.has(key); this.drop(key); return had; }

  size(): { entries: number; bytes: number; evictions: number } { return { entries: this.entries.size, bytes: this.bytes, evictions: this.evictions }; }
}
