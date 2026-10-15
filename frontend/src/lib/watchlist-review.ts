// zzz1045d — /watchlists: quote time per row, names with no quote, traded value, and "changes since last review".
// Pure helpers (storage reads/writes are wrapped and never throw).

// ── quote time (when the price is from) vs last refreshed (when this page read it) ──
export type QuoteTimeKind = 'time' | 'last-close' | 'unknown' | 'none';
export interface QuoteTime { kind: QuoteTimeKind; at: number | null; label: string; title: string }
export interface QuoteProvenance { price: number | null; quoteTime?: string | null; priceSource?: string | null; staleEOD?: boolean | null }

/** What the row's price is: a timed quote, the last NSE close, a quote whose time the source did not give, or no quote. */
export function quoteTimeOf(q: QuoteProvenance, fmt: (ms: number) => string): QuoteTime {
  if (q.price == null || !(q.price > 0)) return { kind: 'none', at: null, label: 'no quote', title: 'The quote source returned no price for this symbol' };
  const ms = q.quoteTime ? Date.parse(q.quoteTime) : NaN;
  if (Number.isFinite(ms)) return { kind: 'time', at: ms, label: fmt(ms), title: `Price is from ${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC (${q.priceSource || 'quote source'})` };
  if (q.staleEOD || q.priceSource === 'nse-bhavcopy') return { kind: 'last-close', at: null, label: 'last close', title: 'Price is the last NSE closing price (end-of-day file), not a live quote' };
  return { kind: 'unknown', at: null, label: 'time not given', title: 'The quote source gave a price but not the time it is from' };
}

/** One line for the whole table: the oldest and newest timed quotes, and how many rows are last close / untimed / missing. */
export function quoteTimeSummary(times: QuoteTime[], fmt: (ms: number) => string): string {
  const timed = times.filter((t) => t.kind === 'time' && t.at != null).map((t) => t.at as number);
  const close = times.filter((t) => t.kind === 'last-close').length;
  const untimed = times.filter((t) => t.kind === 'unknown').length;
  const none = times.filter((t) => t.kind === 'none').length;
  const parts: string[] = [];
  if (timed.length) {
    const lo = Math.min(...timed), hi = Math.max(...timed);
    parts.push(lo === hi || fmt(lo) === fmt(hi) ? `quotes from ${fmt(hi)}` : `quotes from ${fmt(lo)} to ${fmt(hi)}`);
  }
  if (close) parts.push(`${close} at last close`);
  if (untimed) parts.push(`${untimed} without a time`);
  if (none) parts.push(`${none} with no quote`);
  return parts.length ? `Quote time: ${parts.join(', ')}` : 'Quote time: —';
}

/** Symbols with no price, in list order. Shown for a manual check (an old or demerged symbol); never remapped. */
export function unresolvedSymbols(items: Array<{ ticker: string; price: number | null }>): string[] {
  return items.filter((i) => i.price == null || !(i.price > 0)).map((i) => i.ticker);
}

// ── traded value ──────────────────────────────────────────────────────────────
/** Price × volume of the same quote (same session). Null when either is missing. */
export function tradedValue(price: number | null | undefined, volume: number | null | undefined): number | null {
  if (price == null || volume == null || !Number.isFinite(price) || !Number.isFinite(volume) || price <= 0 || volume <= 0) return null;
  return price * volume;
}
export function formatTradedValue(v: number | null | undefined, market?: 'IN' | 'US'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (market === 'US') return v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`;
  const cr = v / 1e7;
  return cr >= 100 ? `₹${cr.toFixed(0)} Cr` : `₹${cr.toFixed(2)} Cr`;
}

// ── changes since last review ─────────────────────────────────────────────────
export const REVIEW_KEY = 'mc:watchlist-review:v1';
export const DEFAULT_REVIEW_THRESHOLD = 5;
export interface ReviewSnapshot { at: number; prices: Record<string, number> }

export function parseReview(raw: unknown): ReviewSnapshot | null {
  let j: any = raw;
  if (typeof raw === 'string') { try { j = JSON.parse(raw); } catch { return null; } }
  if (!j || typeof j !== 'object' || !Number.isFinite(j.at) || !j.prices || typeof j.prices !== 'object') return null;
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(j.prices)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) prices[k] = v;
  return { at: j.at, prices };
}

/** "Mark reviewed": the price of every row that has one, now. Rows with no quote are left out (no fake 0). */
export function buildReview(items: Array<{ ticker: string; price: number | null }>, now: number): ReviewSnapshot {
  const prices: Record<string, number> = {};
  for (const i of items) if (i.price != null && i.price > 0) prices[i.ticker] = i.price;
  return { at: now, prices };
}

export interface ReviewChange { pct: number; from: number; to: number }
export interface ReviewDiff { changed: Record<string, ReviewChange>; notReviewed: string[]; noQuote: string[] }

/** Rows whose price moved by at least `thresholdPct` (either way) since the review. Rows added since the review, or with
 *  no quote now, are listed apart and never counted as moved. */
export function changesSinceReview(items: Array<{ ticker: string; price: number | null }>, snap: ReviewSnapshot | null, thresholdPct = DEFAULT_REVIEW_THRESHOLD): ReviewDiff {
  const out: ReviewDiff = { changed: {}, notReviewed: [], noQuote: [] };
  if (!snap) return out;
  const th = Number.isFinite(thresholdPct) && thresholdPct > 0 ? thresholdPct : DEFAULT_REVIEW_THRESHOLD;
  for (const i of items) {
    const from = snap.prices[i.ticker];
    if (from == null) { out.notReviewed.push(i.ticker); continue; }
    if (i.price == null || !(i.price > 0)) { out.noQuote.push(i.ticker); continue; }
    const pct = ((i.price - from) / from) * 100;
    if (Math.abs(pct) >= th - 1e-9) out.changed[i.ticker] = { pct, from, to: i.price };
  }
  return out;
}

export function loadReview(): ReviewSnapshot | null {
  try { return typeof window === 'undefined' ? null : parseReview(window.localStorage.getItem(REVIEW_KEY)); } catch { return null; }
}
export function saveReview(s: ReviewSnapshot): boolean {
  try { if (typeof window === 'undefined') return false; window.localStorage.setItem(REVIEW_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
