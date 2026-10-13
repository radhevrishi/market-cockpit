// zzz1000 (CW-03 / improvement 6) — the candles, legend values and info on /charts belong to ONE loaded identity: ticker, market,
// exchange, timeframe and price basis. The render path compares that identity with what is being asked for and shows blanks
// while they differ, so company B's title never sits above company A's EMA values (the old effect-only clear left one render
// where they could). A refresh of the same identity keeps its values. Pure helpers, shared by the chart page and its tests.

export interface ChartIdentity { ticker: string; market: string; exchange?: string | null; tf: string; basis: string }
export interface LoadedBars<B> { id: string; bars: B[] }

/** Exchange counts only for India (NSE vs BSE are different prices); US symbols are one listing. */
export function chartIdentityKey(i: ChartIdentity): string {
  const ex = i.market === 'IN' ? String(i.exchange || '').toUpperCase() : '';
  return `${i.market}|${ex}|${String(i.ticker || '').toUpperCase()}|${i.tf}|${i.basis}`;
}

const NONE: never[] = [];
export const NO_BARS: LoadedBars<never> = { id: '', bars: NONE };

/** The bars to draw values from: the loaded ones when they are for `id`, else none (stable empty array). */
export function barsForIdentity<B>(loaded: LoadedBars<B> | null | undefined, id: string): B[] {
  return loaded && loaded.id === id ? loaded.bars : (NONE as B[]);
}

/** A failed load says what is on screen: nothing yet (first load of this symbol / view) or the last successful load (refresh). */
export function chartLoadError(message: string, kind: 'first' | 'refresh'): string {
  const m = String(message || 'The chart could not be loaded.').trim();
  return kind === 'refresh'
    ? `${m} — refresh failed; the chart still shows the last successful load.`
    : `${m} — nothing loaded for this symbol yet.`;
}
