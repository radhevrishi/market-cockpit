// zzz1000 (improvement 2) — "Open this list in Charts" from the standalone /watchlists page. The rows on screen (search applied,
// table order) become the chart's review queue (lib/chart-review-queue), so ↑ / ↓ on /charts step through exactly those rows.
// The standalone list is the tracking universe synced with the Telegram bot; it is NOT merged into the chart page's own lists.
import { cleanTicker } from './chart-math';

/** The standalone list has one id: its storage key (lib/watchlists constants STORAGE_KEY). */
export const STANDALONE_WATCHLIST_ID = 'mc_watchlist_tickers';

export interface HandoffRow { ticker: string; company?: string | null; market?: 'IN' | 'US' }
export interface HandoffItem { symbol: string; exchange: string; name?: string }

/** One queue entry per row, duplicates dropped. India rows open on NSE (as the table's ticker link does); US rows by market. */
export function watchlistReviewItems(rows: HandoffRow[]): HandoffItem[] {
  const seen = new Set<string>();
  const out: HandoffItem[] = [];
  for (const r of rows) {
    const symbol = cleanTicker(String(r.ticker || '').replace(/^(NSE|BSE|BOM):/i, ''));
    if (!symbol) continue;
    const exchange = r.market === 'US' ? 'US' : 'NSE';
    const k = `${exchange}:${symbol}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const name = r.company && r.company !== r.ticker ? r.company : undefined;
    out.push({ symbol, exchange, ...(name ? { name } : {}) });
  }
  return out;
}

/** The chart URL for the first queue entry, with the review flag the chart page reads. */
export function chartReviewUrl(first: HandoffItem, tf: 'D' | 'W' | 'M' = 'D'): string {
  const m = first.exchange === 'NSE' || first.exchange === 'BSE' ? 'IN' : 'US';
  return `/charts?symbol=${encodeURIComponent(first.symbol)}&exchange=${encodeURIComponent(first.exchange)}&t=${encodeURIComponent(first.symbol)}&m=${m}&tf=${tf}&review=screener`;
}
