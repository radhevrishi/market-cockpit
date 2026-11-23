// zzz1300 — moving-average entries for the Daily Action Cockpit, from the stock-screener snapshot (India + USA):
// a stock in an uptrend sitting just above its 21-day EMA, 50-day average or 200-day average. Pure.
export type MaKind = 'ema21' | 'sma50' | 'sma200';
export interface MaEntry { kind: MaKind; pct: number; note: string }
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const pctTxt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export const MA_LABEL: Record<MaKind, string> = {
  ema21: 'At the 21-day EMA (short pullback in an uptrend)',
  sma50: 'At the 50-day average (deeper pullback, trend intact)',
  sma200: 'At the 200-day average (long-term support test)',
};

/** One row of the screener: px, ema21, sma50, sma200, twSt (weekly stage). */
export function maEntry(r: { px?: number; ema21?: number; sma50?: number; sma200?: number; twSt?: number; stage?: number } | null | undefined): MaEntry | null {
  if (!r || !fin(r.px)) return null;
  const st = typeof r.twSt === 'number' ? r.twSt : typeof r.stage === 'number' ? r.stage : null;
  if (st === 4) return null;   // downtrend: a moving average is not support
  const px = r.px;
  const p = (ma: unknown) => (fin(ma) ? ((px - ma) / ma) * 100 : null);
  const p21 = p(r.ema21), p50 = p(r.sma50), p200 = p(r.sma200);
  const up = p200 != null && p200 > 0;   // above the 200-day = uptrend
  const c: MaEntry[] = [];
  if (up && p21 != null && p21 >= -1.5 && p21 <= 4 && (p50 == null || p50 >= -1)) c.push({ kind: 'ema21', pct: p21, note: `${pctTxt(p21)} from the 21-day EMA` });
  if (up && p50 != null && p50 >= -2 && p50 <= 4) c.push({ kind: 'sma50', pct: p50, note: `${pctTxt(p50)} from the 50-day average` });
  // 200-day test: price within −3% / +4% of it while the 50-day is still near or above it (not a broken trend)
  if (p200 != null && p200 >= -3 && p200 <= 4 && fin(r.sma50) && fin(r.sma200) && r.sma50 >= r.sma200 * 0.97) c.push({ kind: 'sma200', pct: p200, note: `${pctTxt(p200)} from the 200-day average` });
  if (!c.length) return null;
  // the line the price sits closest to
  c.sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct));
  return c[0];
}
