// zzz1010 — chart load speed (browser side). Switching watchlist symbols was one full round trip per chart, then a SECOND
// round trip for the daily history the pattern / stage indicators need, with the pattern and stage indicators each asking
// for the same 5-year series at the same time, and nothing kept once the page was left.
//
//   • one cache for every chart answer, kept for the whole browser visit (not per mounted page), keyed by the exact URL
//     (ticker, market, exchange, interval, history, price basis all sit in the URL — an answer is only ever reused for
//     the identity it was asked for)
//   • requests for the same URL share one network call (the chart, the pattern indicator, the stage indicator and a
//     prefetch never ask twice); a caller that is no longer interested (symbol changed) only detaches, the shared call
//     goes on and fills the cache
//   • the neighbours of the open symbol (next / previous rows of the watchlist or of the screener review list) are
//     fetched in the background once the open chart has its answer, two at a time, so ↓ shows candles from memory
//   • a stale copy (older than the refresh time, younger than STALE_MAX_MS) is shown at once while the fresh answer loads
import { cacheChart, freshChart, type CachedChart } from './chart-refresh';
import type { Market, Timeframe } from './chart-math';

/** Entries kept (an answer is 10–40 KB of JSON; 60 is ≈ 2–3 MB in memory). */
export const CHART_CACHE_LIMIT = 60;
/** A stale answer older than this is not shown while the fresh one loads (it would be a different trading day). */
export const STALE_MAX_MS = 6 * 3600_000;
/** Give up on a shared chart request after this long. */
export const CHART_FETCH_TIMEOUT_MS = 20_000;

const _cache = new Map<string, CachedChart<any>>();
/** The one chart cache of this browser tab (survives leaving and reopening /charts). */
export function sharedChartCache(): Map<string, CachedChart<any>> { return _cache; }

/** The daily chart history the load asks for: at least 5 years when a daily-bar indicator (chart patterns, stage
 *  analysis) is on, so their data is the chart's own answer instead of a second request. */
export function loadDataRange(base: '2y' | '5y' | '10y' | 'max', tf: Timeframe, needsLongDaily: boolean): '2y' | '5y' | '10y' | 'max' {
  return tf === 'D' && needsLongDaily && base === '2y' ? '5y' : base;
}

const TF_INTERVAL: Record<Timeframe, string> = { D: '1d', W: '1wk', M: '1mo' };
/** The chart API URL — character for character the one the chart page's load builds (so prefetches land in its cache). */
export function chartApiUrl(ticker: string, market: Market, exchange: string | undefined, tf: Timeframe, dataRange: string, basis: 'price' | 'tr'): string {
  return `/api/v1/chart/${encodeURIComponent(ticker)}?market=${market}&interval=${TF_INTERVAL[tf]}&range=${dataRange}${market === 'IN' && exchange ? `&exchange=${exchange}` : ''}${basis === 'tr' ? '&basis=tr&adj=2' : ''}`;
}

// ── shared requests ─────────────────────────────────────────────────────────────
interface Answer { ok: boolean; status: number; body: any }
type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
const _inflight = new Map<string, Promise<Answer>>();
let _primary = 0;   // chart loads the owner is waiting for (prefetches wait for these)
let _fetcher: Fetcher = (url, init) => fetch(url, init);

function shared(url: string): Promise<Answer> {
  let p = _inflight.get(url);
  if (p) return p;
  p = (async () => {
    try {
      const r = await _fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(CHART_FETCH_TIMEOUT_MS) });
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
    } finally { _inflight.delete(url); }
  })();
  _inflight.set(url, p);
  return p;
}

/**
 * fetch()-shaped: one network call per URL however many callers ask; `signal` detaches only this caller (rejects with an
 * AbortError), the shared call goes on. A successful answer is also put in the shared cache.
 */
export function chartFetch(url: string, init?: { signal?: AbortSignal; cache?: RequestCache }): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  const signal = init?.signal;
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  _primary++;
  const p = shared(url).then((a) => {
    if (a.ok && a.body?.ok) cacheChart(_cache, url, a.body, Date.now(), CHART_CACHE_LIMIT);
    return { ok: a.ok, status: a.status, json: async () => a.body };
  });
  const done = () => { _primary = Math.max(0, _primary - 1); pump(); };
  p.then(done, done);
  if (!signal) return p;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); }, (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
  });
}

// ── prefetch ────────────────────────────────────────────────────────────────────
const _queue: string[] = [];
let _prefetching = 0;
const PREFETCH_PARALLEL = 2;
const PREFETCH_QUEUE_MAX = 8;

function saveData(): boolean {
  try { return !!(globalThis as any).navigator?.connection?.saveData; } catch { return false; }
}
function pump(): void {
  while (_primary === 0 && _prefetching < PREFETCH_PARALLEL && _queue.length) {
    const url = _queue.shift()!;
    if (freshChart(_cache, url, 300_000) || _inflight.has(url)) continue;
    _prefetching++;
    shared(url)
      .then((a) => { if (a.ok && a.body?.ok) cacheChart(_cache, url, a.body, Date.now(), CHART_CACHE_LIMIT); })
      .catch(() => { /* a prefetch failure is silent: the real load reports its own error */ })
      .finally(() => { _prefetching--; pump(); });
  }
}

/**
 * Queue background loads (most important first). Skipped for URLs already fresh or on their way; waits while a chart
 * the owner is looking at is loading; at most two at a time; nothing when the browser asks to save data.
 * Returns the URLs actually queued.
 */
export function prefetchCharts(urls: string[], freshMs = 300_000): string[] {
  if (saveData()) return [];
  const added: string[] = [];
  for (const url of urls) {
    if (!url || freshChart(_cache, url, freshMs) || _inflight.has(url) || _queue.includes(url)) continue;
    _queue.push(url); added.push(url);
  }
  // newest wishes first; drop the oldest beyond the cap (the owner moved on)
  if (added.length) { const keep = [...added, ..._queue.filter((u) => !added.includes(u))].slice(0, PREFETCH_QUEUE_MAX); _queue.length = 0; _queue.push(...keep); }
  pump();
  return added;
}

/** Tests only. */
export function _resetChartLoadCache(fetcher?: Fetcher): void {
  _cache.clear(); _inflight.clear(); _queue.length = 0; _primary = 0; _prefetching = 0;
  _fetcher = fetcher || ((url, init) => fetch(url, init));
}
export function _chartLoadState() { return { cached: _cache.size, inflight: _inflight.size, queued: _queue.length, primary: _primary, prefetching: _prefetching }; }

/**
 * The rows to fetch ahead of the open one, most likely next first: +1, −1, +2, −2 (… up to `depth`). `step(cursor, dir)`
 * moves one row from a cursor (`null` = the open row) and returns the new cursor, or null at the end of the list.
 */
export function neighbourOrder<C>(step: (from: C | null, dir: 1 | -1) => C | null, depth = 2): C[] {
  const fwd: C[] = [], back: C[] = [];
  for (const [dir, out] of [[1, fwd], [-1, back]] as const) {
    let cur: C | null = null;
    for (let k = 0; k < depth; k++) { const n = step(cur, dir); if (n == null) break; out.push(n); cur = n; }
  }
  const order: C[] = [];
  for (let k = 0; k < depth; k++) { if (fwd[k] != null) order.push(fwd[k]); if (back[k] != null) order.push(back[k]); }
  return order;
}
