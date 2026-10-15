// zzz1049 — Upstash is billed per COMMAND (pay-as-you-go ≈ $0.20 per 100k). 1–15 Oct 2026: 3 million commands, 97 GB read.
// The app runs as ONE long-lived Node process on Railway, so a short in-process cache in front of KV reads is safe:
//   • every write this process makes goes through lib/kv.ts, which updates or drops the cached copy at once;
//   • keys written from outside (GitHub scrapers, the Cloudflare movers worker) are at most `hitTtlMs` stale.
// What is NEVER cached (always read from the store): personal data (user-state, books, watchlists, portfolio, alert rules,
// evidence), locks / once-markers, rate counters, and any key this process has ever used with SET NX.
// Also here: per-hour command counters by key family, kept in memory only (counting Redis commands must not cost Redis commands).

/** Personal data + coordination keys: always read from the durable store, never from this cache. */
const NEVER_CACHE_PREFIXES = [
  'user-state:', 'us-book:', 'us-book-profile:', 'book:', 'book-watch:', 'portfolio:', 'watchlist:', 'watchlist-meta:',
  'evidence:', 'user-alerts:', 'decisions:', 'rate:', 'personal',
];
const NEVER_CACHE_RE = /(^|[:_-])(lock|locks|once|nx|lease|mutex)([:_-]|$)/i;

export function isCacheableKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const k = key.toLowerCase();
  if (NEVER_CACHE_PREFIXES.some((p) => k.startsWith(p))) return false;
  if (NEVER_CACHE_RE.test(k)) return false;
  return true;
}

export interface ReadCacheOpts {
  /** total bytes (UTF-16 length of the stored JSON text) kept */
  maxBytes: number;
  /** a single value larger than this is never kept */
  maxEntryBytes: number;
  /** how long a value read from (or written to) the store is reused */
  hitTtlMs: number;
  /** how long "key is missing" is reused */
  missTtlMs: number;
  now?: () => number;
}

interface Entry { v: string | null; exp: number; bytes: number }
export type CacheLookup = { found: true; text: string | null } | { found: false };

/** LRU, byte-bounded, TTL'd store of JSON text (null = known missing). Values are kept as text so every reader gets its own copy. */
export class KvReadCache {
  private m = new Map<string, Entry>();
  private bytes = 0;
  private uncacheable = new Set<string>();
  readonly opts: Required<ReadCacheOpts>;
  hits = 0; missHits = 0; loads = 0; evictions = 0;

  constructor(opts: ReadCacheOpts) { this.opts = { now: Date.now, ...opts }; }

  canCache(key: string): boolean { return isCacheableKey(key) && !this.uncacheable.has(key); }
  /** a key used for SET NX (a lock / once-marker) is never cached from then on */
  markUncacheable(key: string): void { if (this.uncacheable.size > 5000) this.uncacheable.clear(); this.uncacheable.add(key); this.invalidate(key); }

  get(key: string): CacheLookup {
    const e = this.m.get(key);
    if (!e) return { found: false };
    if (this.opts.now() >= e.exp) { this.drop(key, e); return { found: false }; }
    this.m.delete(key); this.m.set(key, e);   // LRU: most recently used last
    if (e.v === null) this.missHits++; else this.hits++;
    return { found: true, text: e.v };
  }

  /** remember a value (JSON text) or a known miss (null). `ttlSec` = the store's own TTL, which caps ours. */
  put(key: string, text: string | null, ttlSec?: number): void {
    if (!this.canCache(key)) return;
    const bytes = text === null ? 32 : text.length + 32;
    if (bytes > this.opts.maxEntryBytes) { this.invalidate(key); return; }
    let ttl = text === null ? this.opts.missTtlMs : this.opts.hitTtlMs;
    if (ttlSec && Number.isFinite(ttlSec) && ttlSec > 0) ttl = Math.min(ttl, ttlSec * 1000);
    if (ttl <= 0) { this.invalidate(key); return; }
    const old = this.m.get(key);
    if (old) this.drop(key, old);
    this.m.set(key, { v: text, exp: this.opts.now() + ttl, bytes });
    this.bytes += bytes;
    while (this.bytes > this.opts.maxBytes && this.m.size) {
      const [k0, e0] = this.m.entries().next().value as [string, Entry];
      this.drop(k0, e0); this.evictions++;
    }
  }

  invalidate(key: string): void { const e = this.m.get(key); if (e) this.drop(key, e); }
  clear(): void { this.m.clear(); this.bytes = 0; }
  size(): { entries: number; bytes: number } { return { entries: this.m.size, bytes: this.bytes }; }
  private drop(key: string, e: Entry) { this.m.delete(key); this.bytes -= e.bytes; }
}

/**
 * Read through the cache with single flight: concurrent readers of one key share ONE store read.
 * `load` returns the value (or null) and whether the read failed; a failed read is never remembered as "missing".
 */
export async function readThrough<T>(
  cache: KvReadCache, inflight: Map<string, Promise<string | null>>, key: string,
  load: () => Promise<{ value: any; failed: boolean }>,
): Promise<T | null> {
  const hit = cache.get(key);
  if (hit.found) return hit.text === null ? null : (JSON.parse(hit.text) as T);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      cache.loads++;
      const { value, failed } = await load();
      let text: string | null = null;
      if (value !== null && value !== undefined) { try { text = JSON.stringify(value); } catch { text = null; } }
      if (!failed || text !== null) cache.put(key, text);
      return text;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  const text = await p;
  return text === null ? null : (JSON.parse(text) as T);
}

// ── command counters (memory only) ────────────────────────────────────────────

/** A key's family for the counters: first segment, plus the second when it is a word (not a version/date/ticker). */
export function keyFamily(key: string): string {
  const parts = String(key || '').split(':');
  const a = (parts[0] || '?').slice(0, 40);
  const b = parts[1];
  if (b && /^[a-z][a-z-]{1,15}$/.test(b) && !/^v\d+$/.test(b)) return `${a}:${b}`;
  return a;
}

const HOURS_KEPT = 48;
export class KvUsage {
  private hours = new Map<string, Map<string, { commands: number; bytes: number }>>();
  private startedAt: number;
  private now: () => number;
  commands = 0; bytes = 0; cacheServed = 0; writesSkipped = 0;
  constructor(now: () => number = Date.now) { this.now = now; this.startedAt = now(); }

  record(op: string, key: string, commands = 1, bytes = 0): void {
    if (commands <= 0 && bytes <= 0) return;
    const h = new Date(this.now()).toISOString().slice(0, 13);
    let m = this.hours.get(h);
    if (!m) {
      m = new Map(); this.hours.set(h, m);
      if (this.hours.size > HOURS_KEPT) this.hours.delete(this.hours.keys().next().value as string);
    }
    const id = `${keyFamily(key)} ${op}`;
    const c = m.get(id) || { commands: 0, bytes: 0 };
    c.commands += commands; c.bytes += bytes; m.set(id, c);
    this.commands += commands; this.bytes += bytes;
  }

  snapshot(usdPer100k = 0.2) {
    const since = this.now() - this.startedAt;
    const hours = [...this.hours.entries()].map(([hour, m]) => ({
      hour, commands: [...m.values()].reduce((s, x) => s + x.commands, 0),
    }));
    const lastFull = hours.length >= 2 ? hours[hours.length - 2] : null;
    const agg = new Map<string, { commands: number; bytes: number }>();
    for (const m of this.hours.values()) for (const [id, c] of m) {
      const a = agg.get(id) || { commands: 0, bytes: 0 }; a.commands += c.commands; a.bytes += c.bytes; agg.set(id, a);
    }
    const top = [...agg.entries()].sort((x, y) => y[1].commands - x[1].commands).slice(0, 25)
      .map(([id, c]) => ({ source: id, commands: c.commands, mb: Math.round(c.bytes / 1e4) / 100 }));
    const perDay = since > 0 ? Math.round(this.commands / (since / 86_400_000)) : 0;
    return {
      note: 'Upstash commands sent by THIS server process (memory counter; resets on restart). GitHub scrapers and the Cloudflare movers worker write to Upstash directly and are not counted here.',
      since: new Date(this.startedAt).toISOString(),
      commands: this.commands, mbTransferredApprox: Math.round(this.bytes / 1e4) / 100,
      servedFromMemory: this.cacheServed, writesSkippedUnchanged: this.writesSkipped,
      perDayAtThisRate: perDay, usdPerMonthAtThisRate: Math.round(perDay * 30 / 100_000 * usdPer100k * 100) / 100,
      lastFullHour: lastFull, hours: hours.slice(-24), topSources48h: top,
    };
  }
}
