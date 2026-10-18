// zzz1063 — ONE exchange calendar for India (NSE) and the USA (NYSE / Nasdaq). Pure: `now` / dates are parameters everywhere.
//
// India (NSE equity):   regular 09:15–15:30 IST; extended 09:00–16:00 IST (pre-open + closing session). No DST.
//                       Holidays: the collected NSE list via lib/market-hours isNseHolidayDate (server warms it from
//                       lib/nse-holidays-server; the 2026 constant is the fallback).
// USA (NYSE / Nasdaq):  regular 09:30–16:00 New York time (DST through Intl, never a fixed UTC offset); extended 04:00–20:00.
//                       Full holidays worked out by the NYSE rules for any year + one-off closures (NYSE_SPECIAL_CLOSURES).
//                       EARLY CLOSES (13:00 ET): the day after Thanksgiving, Christmas Eve when it is a weekday trading day,
//                       and 3 July when Independence Day falls Tuesday–Friday — plus the published list (NYSE_EARLY_CLOSES_LISTED).
//                       Checked against nyse.com/trade/hours-calendars and nasdaq.com's 2026 schedule: 27 Nov and 24 Dec 2026.
//                       On an early-close day the after-hours session ends at 17:00 ET (NYSE Arca and Nasdaq both publish
//                       13:00–17:00 for those days); other venues can differ, so this is the widest window this app watches,
//                       not a promise about every venue.
//
// Used by: lib/alerts/session.ts (price alerts). lib/ai-gainers/us-gainers.ts closeMinutes() also reads its early closes here.
import { isNseHolidayDate } from '@/lib/market-hours';

export type Market = 'IN' | 'US';
export type SessionMode = 'regular' | 'extended';
export type Phase = 'pre' | 'regular' | 'post' | 'closed';
export type HolidayFn = (ymd: string) => boolean;

const IST_MS = 5.5 * 3600_000;
const ymd = (y: number, m0: number, d: number) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dow = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).getUTCDay();
const splitYmd = (s: string): [number, number, number] => { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d]; };
export const addDays = (s: string, n: number): string => new Date(Date.parse(`${s}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Easter Sunday (Gregorian, anonymous computus) as [month0, day]. */
function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month - 1, day];
}
/** n-th weekday (0=Sun) of a month; n = -1 → last. */
function nthWeekday(y: number, m0: number, wd: number, n: number): number {
  if (n > 0) { const first = dow(y, m0, 1); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; }
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  return last - ((dow(y, m0, last) - wd + 7) % 7);
}
/** Fixed-date holiday moved to Friday (Saturday) or Monday (Sunday). */
function observed(y: number, m0: number, d: number): string | null {
  const w = dow(y, m0, d);
  if (w === 6) return m0 === 0 && d === 1 ? null : ymd(y, m0, d - 1);   // NYSE does not close on Fri 31 Dec for a Saturday New Year
  if (w === 0) return ymd(y, m0, d + 1);
  return ymd(y, m0, d);
}

const nyseMemo = new Map<number, Set<string>>();
/** NYSE full-day holidays of one year, by rule (no one-off closures — see NYSE_SPECIAL_CLOSURES). */
export function nyseHolidays(y: number): Set<string> {
  const hit = nyseMemo.get(y);
  if (hit) return hit;
  const out = new Set<string>();
  const add = (s: string | null) => { if (s) out.add(s); };
  add(observed(y, 0, 1));
  add(ymd(y, 0, nthWeekday(y, 0, 1, 3)));    // Martin Luther King Jr. Day
  add(ymd(y, 1, nthWeekday(y, 1, 1, 3)));    // Washington's Birthday
  const [em, ed] = easter(y);
  const gf = new Date(Date.UTC(y, em, ed - 2));
  add(ymd(gf.getUTCFullYear(), gf.getUTCMonth(), gf.getUTCDate()));   // Good Friday
  add(ymd(y, 4, nthWeekday(y, 4, 1, -1)));   // Memorial Day
  if (y >= 2022) add(observed(y, 5, 19));    // Juneteenth
  add(observed(y, 6, 4));                    // Independence Day
  add(ymd(y, 8, nthWeekday(y, 8, 1, 1)));    // Labor Day
  add(ymd(y, 10, nthWeekday(y, 10, 4, 4)));  // Thanksgiving
  add(observed(y, 11, 25));                  // Christmas
  nyseMemo.set(y, out);
  return out;
}
/** One-off full closures the rules cannot know (national days of mourning). */
export const NYSE_SPECIAL_CLOSURES: ReadonlySet<string> = new Set(['2025-01-09']);
/** Published 13:00 ET closes (the rules below produce the same days; the list is kept as a cross-check). */
export const NYSE_EARLY_CLOSES_LISTED: ReadonlySet<string> = new Set(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);

export function isNyseHoliday(date: string): boolean {
  return NYSE_SPECIAL_CLOSURES.has(date) || nyseHolidays(Number(date.slice(0, 4))).has(date);
}
const isWeekend = (date: string) => { const [y, m, d] = splitYmd(date); const w = dow(y, m, d); return w === 0 || w === 6; };

/** Is `date` a trading day in that market (weekday, not a holiday)? */
export function isTradingDay(market: Market, date: string, isNseHoliday: HolidayFn = isNseHolidayDate): boolean {
  if (isWeekend(date)) return false;
  return market === 'IN' ? !isNseHoliday(date) : !isNyseHoliday(date);
}

/** NYSE 13:00 ET close on this date? (only meaningful on a trading day) */
export function isNyseEarlyClose(date: string): boolean {
  if (!isTradingDay('US', date)) return false;
  if (NYSE_EARLY_CLOSES_LISTED.has(date)) return true;
  const [y, m0, d] = splitYmd(date);
  if (m0 === 10) {   // the day after Thanksgiving
    const tg = nthWeekday(y, 10, 4, 4);
    if (d === tg + 1) return true;
  }
  if (m0 === 11 && d === 24) return true;                                   // Christmas Eve on a trading day
  if (m0 === 6 && d === 3) { const w4 = dow(y, 6, 4); if (w4 >= 2 && w4 <= 5) return true; }   // 3 July before a Tue–Fri 4th
  return false;
}

/** Session windows of one trading day, in that market's local minutes after midnight; null when the market is closed all day. */
export interface DayWindows { regular: [number, number]; extended: [number, number]; earlyClose: boolean }
export function dayWindows(market: Market, date: string, isNseHoliday: HolidayFn = isNseHolidayDate): DayWindows | null {
  if (!isTradingDay(market, date, isNseHoliday)) return null;
  if (market === 'IN') return { regular: [9 * 60 + 15, 15 * 60 + 30], extended: [9 * 60, 16 * 60], earlyClose: false };
  if (isNyseEarlyClose(date)) return { regular: [9 * 60 + 30, 13 * 60], extended: [4 * 60, 17 * 60], earlyClose: true };
  return { regular: [9 * 60 + 30, 16 * 60], extended: [4 * 60, 20 * 60], earlyClose: false };
}

/** Wall-clock parts in the market's own time zone. */
export function marketParts(market: Market, now: Date): { date: string; minutes: number } {
  if (market === 'IN') {
    const t = new Date(now.getTime() + IST_MS);
    return { date: ymd(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
  }
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10) };
}
/** The market's local calendar date (YYYY-MM-DD). */
export function marketDate(market: Market, now: Date): string { return marketParts(market, now).date; }

/**
 * Where the market is right now. India counts the regular close minute (15:30) as regular (NSE prints the close at 15:30);
 * the US regular session is [open, close) — at 16:00:00 (13:00 on an early close) it is after-hours.
 */
export function phaseAt(market: Market, now: Date, isNseHoliday: HolidayFn = isNseHolidayDate): Phase {
  const p = marketParts(market, now);
  const w = dayWindows(market, p.date, isNseHoliday);
  if (!w) return 'closed';
  const [ro, rc] = w.regular, [eo, ec] = w.extended;
  const inReg = market === 'IN' ? p.minutes >= ro && p.minutes <= rc : p.minutes >= ro && p.minutes < rc;
  if (inReg) return 'regular';
  const inExt = market === 'IN' ? p.minutes >= eo && p.minutes <= ec : p.minutes >= eo && p.minutes < ec;
  if (!inExt) return 'closed';
  return p.minutes < ro ? 'pre' : 'post';
}

/** Is that market's session (regular, or extended = pre + regular + post) open now? */
export function sessionOpen(market: Market, mode: SessionMode, now: Date, isNseHoliday: HolidayFn = isNseHolidayDate): boolean {
  const ph = phaseAt(market, now, isNseHoliday);
  return mode === 'regular' ? ph === 'regular' : ph !== 'closed';
}

/** Has today's regular session started (≥ open time on a trading day)? */
export function regularStarted(market: Market, now: Date, isNseHoliday: HolidayFn = isNseHolidayDate): boolean {
  const p = marketParts(market, now);
  const w = dayWindows(market, p.date, isNseHoliday);
  return !!w && p.minutes >= w.regular[0];
}

/** The trading day before `date` (skipping weekends and holidays). */
export function prevTradingDay(market: Market, date: string, isNseHoliday: HolidayFn = isNseHolidayDate): string {
  let d = addDays(date, -1);
  for (let i = 0; i < 20 && !isTradingDay(market, d, isNseHoliday); i++) d = addDays(d, -1);
  return d;
}
/** The most recent session whose regular CLOSE has happened by `now` (early closes respected). */
export function lastCompletedSession(market: Market, now: Date, isNseHoliday: HolidayFn = isNseHolidayDate): string {
  const p = marketParts(market, now);
  const w = dayWindows(market, p.date, isNseHoliday);
  if (w && (market === 'IN' ? p.minutes > w.regular[1] : p.minutes >= w.regular[1])) return p.date;
  return prevTradingDay(market, p.date, isNseHoliday);
}
/** The trading session `now` belongs to: today when today is a trading day, else the last one. */
export function currentOrLastTradingDay(market: Market, now: Date, isNseHoliday: HolidayFn = isNseHolidayDate): string {
  const d = marketDate(market, now);
  return isTradingDay(market, d, isNseHoliday) ? d : prevTradingDay(market, d, isNseHoliday);
}

// ── zzz1079 (retest B04) — ONE completion clock for charts, patterns, stage and setups ─────────────────────────────────────
/** New York summer time on a calendar date (second Sunday of March → first Sunday of November; the switch is on a Sunday). */
function nyDst(date: string): boolean {
  const [y, m0, d] = splitYmd(date);
  const startD = nthWeekday(y, 2, 0, 2), endD = nthWeekday(y, 10, 0, 1);
  const t = Date.UTC(y, m0, d);
  return t >= Date.UTC(y, 2, startD) && t < Date.UTC(y, 10, endD);
}
/** The instant (UTC ms) the REGULAR session of `date` closed — 15:30 IST; 16:00 New York, 13:00 on an early close — or null
 *  when the exchange had no session that day (weekend / holiday). */
export function sessionCloseUtc(market: Market, date: string, isNseHoliday: HolidayFn = isNseHolidayDate): number | null {
  const w = dayWindows(market, date, isNseHoliday);
  if (!w) return null;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (market === 'IN') return midnight + w.regular[1] * 60_000 - IST_MS;
  return midnight + (w.regular[1] + (nyDst(date) ? 4 : 5) * 60) * 60_000;
}
/** The last trading day in [from, to] (inclusive), or null when the exchange did not trade in that range. */
export function lastTradingDayIn(market: Market, from: string, to: string, isNseHoliday: HolidayFn = isNseHolidayDate): string | null {
  for (let d = to, i = 0; d >= from && i < 40; d = addDays(d, -1), i++) if (isTradingDay(market, d, isNseHoliday)) return d;
  return null;
}
/** When a period (any range of calendar dates) is complete on the exchange: the close of its last trading day; a range with no
 *  trading day is complete from its first day (nothing can be added to it). */
export function rangeCloseUtc(market: Market, from: string, to: string, isNseHoliday: HolidayFn = isNseHolidayDate): number {
  const last = lastTradingDayIn(market, from, to, isNseHoliday);
  return last ? (sessionCloseUtc(market, last, isNseHoliday) as number) : Date.parse(`${from}T00:00:00Z`);
}
