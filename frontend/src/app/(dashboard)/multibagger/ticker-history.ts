// zzz1277 — pure helpers for Multibagger "Recently added" (this browser's own daily copy of each list).
export type TickerHistory = Record<string, string[]>;   // 'YYYY-MM-DD' → tickers
export function recordTickerDay(hist: TickerHistory, day: string, tickers: string[], keepDays = 10): TickerHistory {
  const out: TickerHistory = { ...hist };
  if (tickers.length) out[day] = Array.from(new Set(tickers)).sort();
  const days = Object.keys(out).sort();
  while (days.length > keepDays) delete out[days.shift() as string];
  return out;
}
/** The list to compare with: the newest day at least `minAgeDays` old; else the oldest earlier day; null when only today exists. */
export function baselineDay(hist: TickerHistory, today: string, minAgeDays = 2): string | null {
  const t0 = Date.parse(today + 'T00:00:00Z');
  const earlier = Object.keys(hist).filter((d) => d < today && (hist[d] || []).length).sort();
  if (!earlier.length) return null;
  const old = earlier.filter((d) => (t0 - Date.parse(d + 'T00:00:00Z')) / 86_400_000 >= minAgeDays);
  return old.length ? old[old.length - 1] : earlier[0];
}
