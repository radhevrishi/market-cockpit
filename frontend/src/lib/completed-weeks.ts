// zzz1044a — COMPLETED EXCHANGE WEEKS. One pure rule for "is this week finished?", shared by the weekly Stage Analysis
// (lib/stage-analysis), the weekly trader setups (lib/setups: 3 weeks tight, weekly Donchian) and the chart wrappers.
// No network, no React; client-safe.
//
// A week = an ISO week (Monday key, YYYY-MM-DD, UTC dates as everywhere in the screener). It is COMPLETE at the observation time
// `now` when either
//   • a daily bar from a LATER week exists in the input (no more sessions of it can come), or
//   • `now` is at or after the regular-session close of that week's FRIDAY: US 16:00 New York time (20:00 UTC in summer time,
//     21:00 UTC in winter), India (NSE) 15:30 IST (10:00 UTC).
// Holidays need no calendar: a week whose Friday is a holiday ends with its Thursday bar and is complete once the Friday close
// time has passed (no session can follow it). Stale input ending midweek is complete once that Friday close has passed too
// (the observation is in a later week). Before the Friday close, Monday–Friday bars of the current week are an UNFINISHED week.
// An unknown market uses the later of the two closes (US), so it never calls a week complete too early.

export type WeekMarket = 'US' | 'IN';
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** New York daylight saving time on a UTC day (second Sunday of March to the first Sunday of November). Exact for weekdays
 *  (the switch happens on a Sunday). */
export function usSummerTime(dayStart: number): boolean {
  const d = new Date(dayStart), y = d.getUTCFullYear();
  const nthSunday = (month: number, n: number) => { const first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return Date.UTC(y, month, 1 + ((7 - first) % 7) + 7 * (n - 1)); };
  return dayStart >= nthSunday(2, 2) && dayStart < nthSunday(10, 1);
}
/** The instant (UTC ms) the regular session of the UTC day starting `dayStart` closes: India 10:00 UTC; US 20:00 / 21:00 UTC. */
export function sessionCloseMs(dayStart: number, market?: WeekMarket | string | null): number {
  const d0 = Math.floor(dayStart / DAY) * DAY;
  if (market === 'IN') return d0 + 10 * HOUR;
  return d0 + (usSummerTime(d0) ? 20 : 21) * HOUR;
}
const toMs = (now: Date | number | undefined): number => (now == null ? Date.now() : typeof now === 'number' ? now : now.getTime());
/** Monday (UTC ms) of the ISO week holding the instant `t`. */
export function weekMondayMs(t: number): number {
  const day = Math.floor(t / DAY);
  return (Math.floor((day + 3) / 7) * 7 - 3) * DAY;
}
/** Monday key (YYYY-MM-DD) or any instant in the week → the close of that week's Friday session (UTC ms). */
export function weekCloseMs(week: string | number, market?: WeekMarket | string | null): number {
  const t = typeof week === 'number' ? week : Date.parse(`${week.slice(0, 10)}T00:00:00Z`);
  return sessionCloseMs(weekMondayMs(t) + 4 * DAY, market);
}
/** Is the week complete at `now`? `laterData` = a bar from a later week exists in the input. */
export function weekComplete(week: string | number, market: WeekMarket | string | null | undefined, now?: Date | number, laterData = false): boolean {
  if (laterData) return true;
  return toMs(now) >= weekCloseMs(week, market);
}
/** How many leading weeks of an ascending weekly series are complete at `now`: every week but the last has later data, so the
 *  answer is the length, or the length − 1 when the last week is still open. `keyOf` gives a week's Monday key / instant. */
export function completedWeekCount<T>(weeks: readonly T[], keyOf: (w: T) => string | number, market: WeekMarket | string | null | undefined, now?: Date | number): number {
  const n = weeks.length;
  if (!n) return 0;
  return weekComplete(keyOf(weeks[n - 1]), market, now) ? n : n - 1;
}
/** The completed weeks of an ascending weekly series (a prefix; the same array contents when nothing is cut). */
export function completedWeeks<T extends { wk: string }>(weeks: readonly T[], market: WeekMarket | string | null | undefined, now?: Date | number): T[] {
  return weeks.slice(0, completedWeekCount(weeks, (w) => w.wk, market, now));
}
/** The Monday key of the last COMPLETED week at `now` given the date of the latest daily bar (null with no bar). */
export function lastCompletedWeekKey(lastBarDate: string | null | undefined, market: WeekMarket | string | null | undefined, now?: Date | number): string | null {
  if (!lastBarDate) return null;
  const mon = weekMondayMs(Date.parse(`${lastBarDate.slice(0, 10)}T00:00:00Z`));
  const k = weekComplete(mon, market, now) ? mon : mon - 7 * DAY;
  return new Date(k).toISOString().slice(0, 10);
}
/** A benchmark's weekly closes by Monday key without its still-open last week (the stock's open week is left out too, so the
 *  benchmark's partial week can never stand in for a completed one). */
export function completedWeekMap(m: ReadonlyMap<string, number> | null | undefined, market: WeekMarket | string | null | undefined, now?: Date | number): Map<string, number> | null {
  if (!m) return null;
  let last: string | null = null;
  for (const k of m.keys()) if (last == null || k > last) last = k;
  const out = new Map(m);
  if (last != null && !weekComplete(last, market, now)) out.delete(last);
  return out;
}
