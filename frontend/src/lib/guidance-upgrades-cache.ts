// zzz853 — news cache read side for Guidance Upgrades: stale-while-revalidate / last-good, and honest cache wording.
//
// ROOT CAUSE of "news:articles:v39 missing or empty; it expires after 5 minutes and is refreshed hourly":
//   writer  : app/api/v1/news/route.ts   CACHE_TTL = 300 s   (kvSet(CACHE_KEY, articles, CACHE_TTL), cache-aside on a GET)
//   refresh : .github/workflows/refresh-news-feed.yml  cron '0 * * * *' = ONCE PER HOUR; step 1 POSTs /api/v1/news/refresh which DELETES the key,
//             step 2 GETs /api/v1/news?market=all which re-scrapes and writes it again (TTL 5 min).
//   So the key exists for 5 minutes in every 60 (55 minutes of every hour it is absent) unless a person happens to open the News page and
//   the cache-aside GET refills it. Guidance Upgrades only READS the key, so it saw a CACHE MISS for ~92% of the hour. A miss is a cache
//   state ("needs a refresh"), not a statement about investment data.
//   The writer lives in the shared news module, which this feature must not change. The guidance side therefore keeps its OWN last-good copy
//   (`guidance-upgrades:news-lastgood:v1`, 24 h TTL, written after every successful live read) and also accepts a shared
//   `news:articles:v39:lastgood` key if the news module ever writes one. Owner fix (outside this feature): set the writer TTL to ~70 minutes
//   (longer than the hourly refresh) or write a `:lastgood` copy with a 24 h TTL next to the 5-minute key.
//
// Pure: all KV access goes through the injected `io`, so tests never touch a network.
import type { GuCacheRow, GuCacheState } from './guidance-upgrades-types';

export const NEWS_KEY = 'news:articles:v39';
export const NEWS_SHARED_LASTGOOD_KEY = 'news:articles:v39:lastgood';
export const NEWS_LASTGOOD_KEY = 'guidance-upgrades:news-lastgood:v1';
export const NEWS_LASTGOOD_TTL_S = 24 * 3600;
/** zzz854: the news route itself now writes `news:articles:v39:lastgood` on every successful refresh; at least 26 h so one missed hourly
 *  refresh (or a quiet night) never leaves readers with nothing. */
export const NEWS_SHARED_LASTGOOD_TTL_S = 30 * 3600;
/** fewer real articles than this in a fresh scrape = the scrape failed (the live feed collapsed to placeholders); the last-good copy serves */
export const NEWS_MIN_REAL_ARTICLES = 8;
const isPlaceholder = (a: any): boolean => /^\[STRUCTURAL ALERT\]/.test(String(a?.title || ''));
export const realArticleCount = (articles: readonly any[] | null | undefined): number => (Array.isArray(articles) ? articles.filter((a) => a && (a.title || a.headline) && !isPlaceholder(a)).length : 0);
/** The value written to the shared last-good key: trimmed to the fields readers use, stamped with its save time. */
export function sharedLastGoodValue(articles: readonly any[], nowMs: number = Date.now()): { savedAt: string; articles: any[]; trimmed: boolean } {
  // the full list when it fits one KV value (the news page can serve it as-is), else the trimmed reader fields
  const full = articles.filter((x) => x && (x.title || x.headline));
  let fits = false; try { fits = JSON.stringify(full).length <= LASTGOOD_MAX_CHARS; } catch { fits = false; }
  return { savedAt: new Date(nowMs).toISOString(), articles: fits ? full : trimNewsForLastGood(articles), trimmed: !fits };
}
/**
 * Writer side (used by app/api/v1/news): after a successful refresh write the durable copy; when a fresh scrape collapsed (fewer than
 * NEWS_MIN_REAL_ARTICLES real items) serve the last-good copy instead, labelled stale with its age. Never throws.
 */
export async function refreshNewsLastGood(io: NewsIo, fresh: readonly any[] | null | undefined): Promise<{ articles: any[] | null; servedFromLastGood: boolean; lastGoodAt: string | null; ageMinutes: number | null; label: string | null }> {
  const nowMs = (io.now ?? Date.now)();
  const n = realArticleCount(fresh);
  if (fresh && n >= NEWS_MIN_REAL_ARTICLES) {
    await io.set(NEWS_SHARED_LASTGOOD_KEY, sharedLastGoodValue(fresh, nowMs), NEWS_SHARED_LASTGOOD_TTL_S).catch(() => undefined);
    return { articles: fresh as any[], servedFromLastGood: false, lastGoodAt: null, ageMinutes: null, label: null };
  }
  const lg = await io.get(NEWS_SHARED_LASTGOOD_KEY).catch((): KvRead => ({ value: null, failed: true }));
  const la = arr(lg.value);
  if (la && realArticleCount(la) > n) {
    const at = typeof lg.value?.savedAt === 'string' ? lg.value.savedAt : null;
    const age = at ? Math.max(0, Math.round((nowMs - Date.parse(at)) / 60_000)) : null;
    return { articles: la, servedFromLastGood: true, lastGoodAt: at, ageMinutes: age, label: `STALE: live news refresh returned ${n} real items; serving the last good copy saved ${ageText(at, nowMs)} (${la.length} items).` };
  }
  return { articles: (fresh as any[]) ?? null, servedFromLastGood: false, lastGoodAt: null, ageMinutes: null, label: n < NEWS_MIN_REAL_ARTICLES ? `Live news refresh returned only ${n} real items and no last-good copy is available.` : null };
}
const LASTGOOD_MAX_ITEMS = 1500;
const LASTGOOD_MAX_CHARS = 800_000;      // one KV value must stay well under the 1 MiB limit
const WRITE_THROTTLE_MS = 5 * 60_000;    // never write the copy more than once per 5 minutes per instance

export interface KvRead { value: any; timedOut?: boolean; failed?: boolean }
export interface NewsIo {
  get(key: string): Promise<KvRead>;
  set(key: string, value: any, ttlSeconds: number): Promise<void>;
  now?(): number;
}
export interface NewsRead {
  /** articles the page may use; null when neither the live key nor any last-good copy holds any */
  articles: any[] | null;
  servedBy: GuCacheRow['servedBy'];
  /** the state of the LIVE key (CACHE_MISS is not an investment-data statement) */
  liveState: GuCacheState;
  row: GuCacheRow;
  /** ISO time of the last-good copy that was used, when one was */
  lastGoodAt: string | null;
  /** resolves when the last-good copy was refreshed (the route awaits it inside its bounded write batch) */
  wrote: Promise<void>;
}

let lastWriteAt = 0;
/** test helper */
export function _resetNewsCacheThrottle(): void { lastWriteAt = 0; }

/** The fields the guidance pipeline reads from a news article (candidates, ticker links, bottleneck links), and nothing else. */
export function trimNewsForLastGood(articles: readonly any[]): any[] {
  const slim = (a: any) => ({
    id: a?.id, title: a?.title, headline: a?.headline, summary: typeof a?.summary === 'string' ? a.summary.slice(0, 600) : a?.summary,
    source_name: a?.source_name, source_url: a?.source_url, url: a?.url, published_at: a?.published_at ?? a?.publishedAt ?? a?.pubDate,
    region: a?.region, ticker_symbols: Array.isArray(a?.ticker_symbols) ? a.ticker_symbols.slice(0, 8) : undefined,
    tickers: Array.isArray(a?.tickers) ? a.tickers.slice(0, 8) : undefined, primary_ticker: a?.primary_ticker,
    article_type: a?.article_type, bottleneck_sub_tag: a?.bottleneck_sub_tag, bottleneck_child: a?.bottleneck_child,
  });
  let list = articles.filter((a) => a && (a.title || a.headline)).map(slim)
    .sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? ''))).slice(0, LASTGOOD_MAX_ITEMS);
  while (list.length > 1 && JSON.stringify(list).length > LASTGOOD_MAX_CHARS) list = list.slice(0, Math.ceil(list.length * 0.85));
  return list;
}

const arr = (v: any): any[] | null => (Array.isArray(v) ? v : Array.isArray(v?.articles) ? v.articles : null);
const stateOf = (r: KvRead): { state: GuCacheState; items: any[] | null } => {
  if (r.failed || r.timedOut) return { state: 'FETCH_FAILED', items: null };
  const a = arr(r.value);
  if (r.value == null) return { state: 'CACHE_MISS', items: null };
  if (!a || a.length === 0) return { state: 'SOURCE_EMPTY', items: [] };
  return { state: 'HIT', items: a };
};
const ageText = (iso: string | null, nowMs: number): string => {
  if (!iso) return 'an unknown time ago';
  const m = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  return m < 90 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
};

/** The one wording per cache state. A cache miss is never an investment-data statement. */
export function cacheStateText(state: GuCacheState, key: string, opts: { servedBy?: GuCacheRow['servedBy']; lastGoodAt?: string | null; items?: number; nowMs?: number; reason?: string } = {}): string {
  const served = opts.servedBy ?? 'NONE';
  const tail = served === 'LASTGOOD' || served === 'SHARED_LASTGOOD' ? ` Serving the last good copy saved ${ageText(opts.lastGoodAt ?? null, opts.nowMs ?? Date.now())} (${opts.items ?? 0} items).`
    : served === 'FALLBACK_FEED' ? ' Primary news cache unavailable; fallback scraped feed active.' : '';
  switch (state) {
    case 'HIT': return `${key}: read ${opts.items ?? 0} items.`;
    case 'CACHE_MISS': return `${key}: CACHE MISS (the cache key is absent and needs a refresh; this says nothing about investment data).${tail}`;
    case 'SOURCE_EMPTY': return `${key}: SOURCE EMPTY (the feed ran and returned zero items).${tail}`;
    case 'FETCH_FAILED': return `${key}: FETCH FAILED (${opts.reason || 'the read failed or timed out'}; unknown, not zero).${tail}`;
  }
}

export async function readNewsWithLastGood(io: NewsIo): Promise<NewsRead> {
  const nowMs = (io.now ?? Date.now)();
  const live = await io.get(NEWS_KEY).catch((): KvRead => ({ value: null, failed: true }));
  const ls = stateOf(live);
  if (ls.state === 'HIT' && ls.items) {
    let wrote: Promise<void> = Promise.resolve();
    if (nowMs - lastWriteAt >= WRITE_THROTTLE_MS) {
      lastWriteAt = nowMs;
      wrote = io.set(NEWS_LASTGOOD_KEY, { savedAt: new Date(nowMs).toISOString(), articles: trimNewsForLastGood(ls.items) }, NEWS_LASTGOOD_TTL_S).catch(() => undefined);
    }
    return { articles: ls.items, servedBy: 'LIVE', liveState: 'HIT', lastGoodAt: null, wrote,
      row: { name: 'News cache', key: NEWS_KEY, state: 'HIT', servedBy: 'LIVE', items: ls.items.length, text: cacheStateText('HIT', NEWS_KEY, { items: ls.items.length }) } };
  }
  // live key missing / empty / failed: shared last-good (if the news module ever writes one), then the guidance-side copy
  const shared = await io.get(NEWS_SHARED_LASTGOOD_KEY).catch((): KvRead => ({ value: null, failed: true }));
  const sa = arr(shared.value);
  if (sa && sa.length) {
    const at = typeof shared.value?.savedAt === 'string' ? shared.value.savedAt : null;
    return { articles: sa, servedBy: 'SHARED_LASTGOOD', liveState: ls.state, lastGoodAt: at, wrote: Promise.resolve(),
      row: { name: 'News cache', key: NEWS_KEY, state: ls.state, servedBy: 'SHARED_LASTGOOD', items: sa.length, text: cacheStateText(ls.state, NEWS_KEY, { servedBy: 'SHARED_LASTGOOD', lastGoodAt: at, items: sa.length, nowMs }) } };
  }
  const own = await io.get(NEWS_LASTGOOD_KEY).catch((): KvRead => ({ value: null, failed: true }));
  const oa = arr(own.value);
  if (oa && oa.length) {
    const at = typeof own.value?.savedAt === 'string' ? own.value.savedAt : null;
    return { articles: oa, servedBy: 'LASTGOOD', liveState: ls.state, lastGoodAt: at, wrote: Promise.resolve(),
      row: { name: 'News cache', key: NEWS_KEY, state: ls.state, servedBy: 'LASTGOOD', items: oa.length, text: cacheStateText(ls.state, NEWS_KEY, { servedBy: 'LASTGOOD', lastGoodAt: at, items: oa.length, nowMs }) } };
  }
  return { articles: null, servedBy: 'NONE', liveState: ls.state, lastGoodAt: null, wrote: Promise.resolve(),
    row: { name: 'News cache', key: NEWS_KEY, state: ls.state, servedBy: 'NONE', items: 0, text: cacheStateText(ls.state, NEWS_KEY, { reason: live.timedOut ? 'timed out' : undefined }) } };
}

/** 'Primary news cache unavailable; fallback scraped feed active.' only when it is true, and it names the source that really supplied data. */
export const FALLBACK_NEWS_TEXT = 'Primary news cache unavailable; fallback scraped feed active.';
export function newsFallbackNote(news: Pick<NewsRead, 'servedBy' | 'liveState'>, scrapedItems: number, retainedItems = 0): { note: string | null; suppliedBy: string } {
  if (news.servedBy === 'LIVE') return { note: null, suppliedBy: 'News cache (live)' };
  if (news.servedBy === 'LASTGOOD' || news.servedBy === 'SHARED_LASTGOOD') {
    return { note: `News cache key is not live (${news.liveState.replace('_', ' ').toLowerCase()}); last good copy of the news cache is serving.`, suppliedBy: 'News cache (last good copy)' };
  }
  if (scrapedItems > 0) return { note: FALLBACK_NEWS_TEXT, suppliedBy: 'Scraped India news (fallback feed)' };
  if (retainedItems > 0) return { note: 'Primary news cache unavailable and no scraped feed; only raise-worded items kept from earlier runs are in use.', suppliedBy: 'Retained earlier items' };
  return { note: 'No news source supplied data in this run (news cache and scraped feed both unavailable). Exchange filings were still read.', suppliedBy: 'none' };
}

/** Production wiring over the shared KV helpers (imported lazily so tests that never call it need no KV). */
export function makeKvNewsIo(timeoutMs: number): NewsIo {
  const get = async (key: string): Promise<KvRead> => {
    const { kvGet } = await import('./kv');
    let timer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
    try {
      const v = await Promise.race([kvGet<any>(key), new Promise<null>((r) => { timer = setTimeout(() => { timedOut = true; r(null); }, timeoutMs); })]);
      return { value: v, timedOut };
    } catch { return { value: null, failed: true }; } finally { if (timer) clearTimeout(timer); }
  };
  const set = async (key: string, value: any, ttl: number): Promise<void> => { const { kvSet } = await import('./kv'); await kvSet(key, value, ttl); };
  return { get, set };
}
