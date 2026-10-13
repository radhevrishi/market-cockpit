import type { Quote } from './chart-watchlist';

export interface CachedChart<T> { at: number; data: T }
export function freshChart<T>(cache: Map<string, CachedChart<T>>, key: string, ttl: number, now = Date.now()): T | null {
  const hit = cache.get(key);
  return hit && now - hit.at >= 0 && now - hit.at < ttl ? hit.data : null;
}
export function cacheChart<T>(cache: Map<string, CachedChart<T>>, key: string, data: T, now = Date.now(), limit = 60): void {   // zzz1010: 60 (one cache shared by the chart, its indicators and prefetches)
  cache.delete(key);
  while (cache.size >= limit) { const oldest = cache.keys().next().value; if (oldest == null) break; cache.delete(oldest); }
  cache.set(key, { at: now, data });
}

/** A failed refresh keeps the last known value, explicitly marked as stale; inactive symbols are released. */
export function refreshedQuotes(previous: Record<string, Quote>, next: Record<string, Quote>, keys: string[], now = Date.now()): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const key of keys) {
    if (next[key]?.last != null && Number.isFinite(next[key].last)) out[key] = { ...next[key], at: next[key].at ?? now, stale: false };
    else if (previous[key]) out[key] = { ...previous[key], stale: true };
  }
  return out;
}
