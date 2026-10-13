// Origin-aware chart review: the stock screener opens /charts?symbol=<SYM>&exchange=<EX>&review=screener and leaves its result
// list in sessionStorage. While that review is on, the chart's previous / next symbol controls step through the screener results
// instead of the active watchlist. Pure functions; every storage access is wrapped so a blocked storage just means "no review".
import { cleanTicker, type Market } from './chart-math';

export const CHART_REVIEW_QUEUE_KEY = 'mc:chart-review-queue:v1';
export const REVIEW_ORIGIN_SCREENER = 'screener';
const MAX_ITEMS = 5000;

export interface ReviewItem { symbol: string; exchange: string; name?: string }
/** `source` says who wrote the queue (the stock / Pine screener, or the standalone Watchlist page — zzz1000); `listId` names that
 *  list. Older queues have neither and are screener queues. The URL flag stays `review=screener` for every source. */
export type ReviewSource = 'screener' | 'watchlist';
export interface ReviewQueue { origin: 'screener'; label: string; returnUrl: string; items: ReviewItem[]; at: number; source?: ReviewSource; listId?: string }
/** What the chart needs to open one queue entry. */
export interface ReviewTarget { market: Market; ticker: string; exchange?: 'NSE' | 'BSE'; name?: string }

/** NSE / BSE (also "NSE:" style or .NS / .BO hints) → India; anything else is a US listing. */
export function marketOfExchange(exchange: string | null | undefined): Market {
  return /^(NSE|BSE)$/i.test(String(exchange || '').trim()) ? 'IN' : 'US';
}

/** Only same-site paths go back; anything else (another host, javascript:, "//evil") falls back to the screener. */
export function safeReturnUrl(url: unknown): string {
  const u = typeof url === 'string' ? url.trim() : '';
  return u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/\\') ? u : '/stock-screener';
}

export function parseQueue(raw: unknown): ReviewQueue | null {
  let v: any = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return null; } }
  if (!v || typeof v !== 'object' || v.origin !== REVIEW_ORIGIN_SCREENER || !Array.isArray(v.items)) return null;
  const items: ReviewItem[] = [];
  for (const it of v.items.slice(0, MAX_ITEMS)) {
    if (!it || typeof it.symbol !== 'string') continue;
    const symbol = cleanTicker(it.symbol);
    if (!symbol) continue;
    items.push({ symbol, exchange: typeof it.exchange === 'string' ? it.exchange.trim().toUpperCase() : '', ...(typeof it.name === 'string' && it.name ? { name: it.name } : {}) });
  }
  if (!items.length) return null;
  return {
    origin: 'screener',
    label: typeof v.label === 'string' && v.label.trim() ? v.label.trim().slice(0, 120) : 'Screen',
    returnUrl: safeReturnUrl(v.returnUrl),
    items,
    at: Number.isFinite(Number(v.at)) ? Number(v.at) : 0,
    ...(v.source === 'watchlist' || v.source === 'screener' ? { source: v.source as ReviewSource } : {}),
    ...(typeof v.listId === 'string' && v.listId.trim() ? { listId: v.listId.trim().slice(0, 120) } : {}),
  };
}

export function readQueue(storage: Pick<Storage, 'getItem'> | null | undefined): ReviewQueue | null {
  try { return storage ? parseQueue(storage.getItem(CHART_REVIEW_QUEUE_KEY)) : null; } catch { return null; }
}

export function targetOf(item: ReviewItem): ReviewTarget {
  const market = marketOfExchange(item.exchange);
  const ex = market === 'IN' ? (item.exchange === 'BSE' ? 'BSE' : 'NSE') : undefined;
  return { market, ticker: item.symbol, ...(ex ? { exchange: ex } : {}), ...(item.name ? { name: item.name } : {}) };
}

/** Index of the chart's current symbol in the queue, or -1. The exchange decides only when both sides name NSE / BSE. */
export function queueIndex(queue: ReviewQueue | null, symbol: string, exchange?: string | null, market?: Market): number {
  if (!queue) return -1;
  const sym = cleanTicker(symbol || '');
  const ex = String(exchange || '').trim().toUpperCase();
  let loose = -1;
  for (let i = 0; i < queue.items.length; i++) {
    const t = targetOf(queue.items[i]);
    if (t.ticker !== sym) continue;
    if (market && t.market !== market) continue;
    if (!ex || (ex !== 'NSE' && ex !== 'BSE') || t.market !== 'IN' || !queue.items[i].exchange) { if (loose < 0) loose = i; continue; }
    if (t.exchange === ex) return i;
  }
  return loose;
}

/** The next (dir = 1) or previous (dir = -1) queue entry from the current symbol. When the current symbol is not in the queue
 *  (picked by hand mid-review), `fromIndex` (the last reviewed position) is the starting point. No wrap-around. */
export function stepQueue(queue: ReviewQueue | null, symbol: string, exchange: string | null | undefined, dir: 1 | -1, fromIndex = -1, market?: Market): { index: number; target: ReviewTarget } | null {
  if (!queue) return null;
  const at = queueIndex(queue, symbol, exchange, market);
  const base = at >= 0 ? at : fromIndex;
  const next = base < 0 ? (dir === 1 ? 0 : -1) : base + dir;
  if (next < 0 || next >= queue.items.length) return null;
  return { index: next, target: targetOf(queue.items[next]) };
}

/** "3 / 23" for the strip (1-based); position null when the current symbol is not in the queue. */
export function reviewPosition(queue: ReviewQueue | null, symbol: string, exchange?: string | null, market?: Market): { position: number | null; total: number } {
  if (!queue) return { position: null, total: 0 };
  const i = queueIndex(queue, symbol, exchange, market);
  return { position: i >= 0 ? i + 1 : null, total: queue.items.length };
}

/** The review is on only with the URL flag AND a stored screener queue that contains the symbol the chart was opened on. */
export function reviewFromUrl(flag: string | null | undefined, storage: Pick<Storage, 'getItem'> | null | undefined, symbol: string, exchange?: string | null, market?: Market): ReviewQueue | null {
  if (flag !== REVIEW_ORIGIN_SCREENER) return null;
  const q = readQueue(storage);
  return q && queueIndex(q, symbol, exchange, market) >= 0 ? q : null;
}

/** Words for the review strip: "screener result" / "watchlist row", and where "Back" goes. */
export function reviewWords(queue: ReviewQueue | null): { noun: string; heading: string; back: string } {
  return queue?.source === 'watchlist'
    ? { noun: 'watchlist row', heading: 'Reviewing watchlist', back: 'Back to Watchlist' }
    : { noun: 'screener result', heading: 'Reviewing screener results', back: 'Back to screen' };
}
