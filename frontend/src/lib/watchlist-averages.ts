// zzz1045 — % distance from the 50-day / 200-day average for the /watchlists columns. The averages come from the stock screener
// snapshot (daily bars, last completed close); the price from the row's own quote. Pure.
export interface AvgRow { t: string; sma50?: number | null; sma200?: number | null; scanAt?: string | null }
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** (price ÷ average − 1) × 100, one decimal; null when either is unknown. */
export function pctFrom(price: number | null | undefined, avg: number | null | undefined): number | null {
  return fin(price) && price > 0 && fin(avg) && avg > 0 ? Math.round((price / avg - 1) * 1000) / 10 : null;
}
/** Screener tickers for watchlist symbols of one market ('NSE:ABC' / 'ABC.NS' → 'ABC'; a BSE number code is kept as is). */
export function screenerKey(t: string): string {
  return String(t || '').trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
}
export function indexAverages(rows: readonly AvgRow[]): Record<string, AvgRow> {
  const out: Record<string, AvgRow> = {};
  for (const r of rows) if (r && typeof r.t === 'string') out[r.t.toUpperCase()] = r;
  return out;
}
