// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0732 — NSE resilient-fetch primitives.
//
// Two orthogonal mechanisms that any NSE/BSE upstream caller can opt into:
//
//   1) dedupedCall(key, fn)
//      In-flight Map<key, Promise>. When N parallel callers ask for the same
//      key, the first kicks off the upstream fetch and the rest await the
//      shared promise. Removes the thundering herd that drove the 50%
//      NSE failure rate visible in Vercel observability — e.g. /api/market/
//      quotes fans out to 11 NIFTY index variants on every page load, the
//      watchlist alert cron fires 1000+ per-symbol quote calls in parallel.
//
//   2) negCacheCheck / negCacheSet / negCacheClear
//      Short-lived (60-120s) in-memory failure cache. Once a key hits
//      timeout / 5xx / network error we suppress retries for the window
//      and let callers return null immediately. Prevents the "every
//      refresh re-hammers a down upstream" pattern that burnt the most
//      CPU during NSE outages.
//
// **In-memory by design — not KV.** Writing to Upstash on every NSE failure
// during an outage burst would burn budget at exactly the worst moment.
// In-memory entries survive within a warm Vercel instance (enough to absorb
// burst retries within a user's session and across the warm pool) and
// reset on cold start (which is desirable — NSE may have recovered).
//
// No external imports. No telemetry side effects. Pure primitives.
// ═══════════════════════════════════════════════════════════════════════════

// ─── In-flight dedup ─────────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Runs `fn()` under a per-key in-flight lock. Concurrent callers with the
 * same key share the same upstream promise.
 *
 * Always cleans up the entry after the promise settles (success or failure),
 * so the next caller after settlement gets a fresh fetch.
 *
 * Use the cache key your call site is already using (e.g. `nse:${path}`).
 * Caller is responsible for cache lookup before calling; this only dedupes
 * the upstream miss path.
 */
export async function dedupedCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    _bumpStat('dedups');
    return existing as Promise<T>;
  }
  const p = (async () => {
    try {
      return await fn();
    } finally {
      // Remove from the map AFTER the promise settles, regardless of
      // outcome. Late awaiters joined via `existing` above still get
      // the resolved value because they hold a reference to the promise.
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p as Promise<T>;
}

// ─── Negative cache ──────────────────────────────────────────────────────────

interface NegEntry {
  until: number;       // Date.now() epoch ms after which the entry expires
  reason: string;      // 'timeout' | 'network' | 'HTTP 503' etc — for debugging
}

const negCache = new Map<string, NegEntry>();
const NEG_CACHE_MAX = 1000;
const NEG_CACHE_EVICT_BATCH = 100;

/**
 * Returns the negative-cache entry for `key` if one exists and has not
 * expired. Returns null if absent or expired (expired entries are
 * lazily cleaned up on read).
 */
export function negCacheCheck(key: string): NegEntry | null {
  const e = negCache.get(key);
  if (!e) return null;
  if (Date.now() >= e.until) {
    negCache.delete(key);
    return null;
  }
  _bumpStat('negHits');
  return e;
}

/**
 * Marks `key` as failed for `ttlMs` ms. Subsequent `negCacheCheck` calls
 * within the TTL window will return the entry; downstream callers
 * should short-circuit and return null/empty without hitting upstream.
 *
 * Default TTL is 90s — short enough not to mask upstream recovery, long
 * enough to absorb a burst of retries within a single function instance.
 */
export function negCacheSet(key: string, ttlMs = 90_000, reason = 'unknown'): void {
  // Best-effort size cap with batch eviction (avoid O(N log N) sort
  // on every set — happens only when we cross the cap).
  if (negCache.size >= NEG_CACHE_MAX) {
    const entries = [...negCache.entries()];
    entries.sort((a, b) => a[1].until - b[1].until);
    for (let i = 0; i < NEG_CACHE_EVICT_BATCH && i < entries.length; i++) {
      negCache.delete(entries[i][0]);
    }
  }
  negCache.set(key, { until: Date.now() + ttlMs, reason });
  _bumpStat('negSets');
}

/**
 * Force-removes a negative-cache entry. Use sparingly — primarily for
 * tests and for manual cache-bust endpoints. Production code should let
 * entries expire naturally.
 */
export function negCacheClear(key: string): void {
  negCache.delete(key);
}

// ─── Telemetry (opt-in, observability-only) ─────────────────────────────────

interface ResilienceStats {
  dedups: number;     // count of callers that joined an existing in-flight promise
  negHits: number;    // count of short-circuits via negative cache
  negSets: number;    // count of failures written to negative cache
  inFlightSize: number;
  negCacheSize: number;
}

const stats = {
  dedups: 0,
  negHits: 0,
  negSets: 0,
};

function _bumpStat(k: keyof typeof stats): void {
  stats[k]++;
}

/**
 * Returns a snapshot of resilience counters + current map sizes. Useful
 * for /api/v1/health/nse style probes and for confirming the patch is
 * actually firing in production logs.
 */
export function getResilienceStats(): ResilienceStats {
  return {
    dedups: stats.dedups,
    negHits: stats.negHits,
    negSets: stats.negSets,
    inFlightSize: inFlight.size,
    negCacheSize: negCache.size,
  };
}

/**
 * Test/debug helper — resets all counters and clears both maps. Not
 * exported for general use; only use this from tests or explicit
 * cache-bust admin endpoints.
 */
export function _resetResilienceState(): void {
  inFlight.clear();
  negCache.clear();
  stats.dedups = 0;
  stats.negHits = 0;
  stats.negSets = 0;
}
