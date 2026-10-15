// zzz1044b (F05) — the ONE Average True Range used by the chart (/charts ATR indicator, Supertrend), the Stock Screener's
// "ATR % (14 days)" (lib/screener/tech.ts atrPctOf) and the trader setups (lib/setups.ts). Before this the screener started its
// true ranges at bar 1 while the chart and the setups started at bar 0, so the same company showed two different ATR figures
// (15 bars of close 100, first bar 130 / 70, the rest 101 / 99: chart ATR 14 = 5.85, screener ATR % = 2).
//
// Policy = TradingView's ta.atr(length) = ta.rma(ta.tr(true), length):
//   • true range of bar i = max(high − low, |high − previous close|, |low − previous close|); on the FIRST bar there is no
//     previous close and ta.tr(true) returns high − low (ta.tr(false) would return na — ta.atr uses the `true` form);
//   • ta.rma (Wilder's smoothing) is seeded with the simple average of the first `length` true ranges, so the first value sits
//     on bar length − 1 (bar 13 for ATR 14), then rma = (previous × (length − 1) + tr) ÷ length.
// Chosen because it is what TradingView shows and what the owner compares against; it also means an ATR exists as soon as there
// are `length` bars (the old screener rule needed length + 1).
// Data handling: leading bars with a non-finite true range are skipped (the seed starts at the first usable bar); a non-finite true
// range later on leaves the value unchanged for that bar (held), never pulls it towards 0.

/** Wilder / TradingView ATR series over high, low, close arrays. NaN until `period` usable true ranges exist. */
export function atrSeries(h: readonly number[], l: readonly number[], c: readonly number[], period = 14): number[] {
  const len = Math.min(h.length, l.length, c.length);
  const out = new Array<number>(len).fill(NaN);
  if (!(period >= 1) || !Number.isFinite(period)) return out;
  const tr = (i: number): number => {
    const range = h[i] - l[i];
    if (i === 0 || !Number.isFinite(c[i - 1])) return range;
    return Math.max(range, Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  };
  let f = 0;
  while (f < len && !Number.isFinite(tr(f))) f++;
  if (len - f < period) return out;
  let sum = 0, used = 0, i = f;
  // seed: the first `period` usable true ranges (a non-finite one inside the seed window is skipped, not counted as 0)
  for (; i < len && used < period; i++) { const t = tr(i); if (Number.isFinite(t)) { sum += t; used++; } }
  if (used < period) return out;
  let prev = sum / period;
  out[i - 1] = prev;
  for (; i < len; i++) {
    const t = tr(i);
    if (Number.isFinite(t)) prev = (prev * (period - 1) + t) / period;
    out[i] = prev;
  }
  return out;
}

/** The latest ATR value (NaN when there is too little history). */
export function atrLast(h: readonly number[], l: readonly number[], c: readonly number[], period = 14): number {
  const s = atrSeries(h, l, c, period);
  return s.length ? s[s.length - 1] : NaN;
}
