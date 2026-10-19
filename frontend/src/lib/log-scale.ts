// zzz1101 (deep audit N01) — the price chart's log scale. The old inverse decided the sign of the PRICE from the sign of its
// LOGARITHM, so every positive price under 1 (log < 0) came back negative: a $0.10 stock showed axis labels like −2.0000.
// Prices are positive: forward = log10(price), inverse = 10^y — one exact pair. A value that is not positive (a Bollinger lower
// band below zero, a bad bar) is clamped to a tiny positive floor so it cannot corrupt the axis; the range's bottom is taken
// from the positive part of the data. Pure.
export const LOG_FLOOR = 1e-12;
export const logFwd = (v: number): number => Math.log10(Number.isFinite(v) && v > LOG_FLOOR ? v : LOG_FLOOR);
export const logInv = (y: number): number => 10 ** y;

/** Bottom / top for a log axis. A non-positive bottom (a study band under zero) becomes a positive one below the top, so the
 *  axis still spans the prices: the smallest positive value given, else top ÷ 1000. */
export function logBounds(min: number, max: number, positiveMin?: number | null): { min: number; max: number } {
  let hi = Number.isFinite(max) && max > 0 ? max : 1;
  let lo = Number.isFinite(min) && min > 0 ? min : (positiveMin != null && positiveMin > 0 && positiveMin < hi ? positiveMin : hi / 1000);
  if (!(lo < hi)) { lo = hi / 1.01; hi = hi * 1.01; }
  return { min: lo, max: hi };
}
