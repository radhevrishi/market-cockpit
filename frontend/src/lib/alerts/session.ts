// zzz1054 — trading sessions for price alerts (pure; `now` is a parameter everywhere).
//
// India (NSE): regular 09:15–15:30 IST, extended 09:00–16:00 IST (pre-open + closing session). Holidays: the collected
// NSE list via lib/market-hours isNseHolidayDate (2026 constant as fallback).
// USA (NYSE/Nasdaq): regular 09:30–16:00 New York time, extended 04:00–20:00. Holidays worked out from the NYSE rules for
// any year (New Year, MLK, Presidents, Good Friday, Memorial, Juneteenth, Independence, Labor, Thanksgiving, Christmas),
// so the calendar never runs out the way a hard-coded list does.
import { isNseHolidayDate } from '@/lib/market-hours';
import type { AlertMarket, SessionMode, AlertInterval } from './types';

const IST_MS = 5.5 * 3600_000;
const ymd = (y: number, m0: number, d: number) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Easter Sunday (Gregorian, anonymous computus) as [month0, day]. */
function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month - 1, day];
}
const dow = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).getUTCDay();
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
/** NYSE full-day holidays of one year. */
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
  // a Saturday 1 Jan next year is never moved back into this year (handled in observed())
  nyseMemo.set(y, out);
  return out;
}
export function isNyseHoliday(dateYmd: string): boolean { return nyseHolidays(Number(dateYmd.slice(0, 4))).has(dateYmd); }

/** Wall-clock parts in New York (DST handled by Intl). */
function nyParts(now: Date): { date: string; minutes: number; wd: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10), wd };
}
function istParts(now: Date): { date: string; minutes: number; wd: number } {
  const t = new Date(now.getTime() + IST_MS);
  return { date: ymd(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), wd: t.getUTCDay() };
}

/** The market's local calendar date (YYYY-MM-DD). */
export function marketDate(market: AlertMarket, now: Date): string { return (market === 'IN' ? istParts(now) : nyParts(now)).date; }

/** Is `date` a trading day in that market (weekday, not a holiday)? */
export function isTradingDay(market: AlertMarket, date: string, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const w = dow(y, m - 1, d);
  if (w === 0 || w === 6) return false;
  return market === 'IN' ? !isNseHoliday(date) : !isNyseHoliday(date);
}

export const SESSION_WINDOWS: Record<AlertMarket, Record<SessionMode, [number, number]>> = {
  IN: { regular: [9 * 60 + 15, 15 * 60 + 30], extended: [9 * 60, 16 * 60] },
  US: { regular: [9 * 60 + 30, 16 * 60], extended: [4 * 60, 20 * 60] },
};

/** Is that market's session (regular or extended) open now? Weekends and exchange holidays are closed. */
export function sessionOpen(market: AlertMarket, mode: SessionMode, now: Date, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  const p = market === 'IN' ? istParts(now) : nyParts(now);
  if (!isTradingDay(market, p.date, isNseHoliday)) return false;
  const [a, b] = SESSION_WINDOWS[market][mode];
  return market === 'IN' ? p.minutes >= a && p.minutes <= b : p.minutes >= a && p.minutes < b;
}
/** Has today's regular session started (≥ open time on a trading day)? Used to decide whether "today's open" can exist. */
export function regularStarted(market: AlertMarket, now: Date, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  const p = market === 'IN' ? istParts(now) : nyParts(now);
  return isTradingDay(market, p.date, isNseHoliday) && p.minutes >= SESSION_WINDOWS[market].regular[0];
}
/** Is any session (in its widest, extended form) open in either market? The checker does nothing when false. */
export function anySessionOpen(now: Date, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  return sessionOpen('IN', 'extended', now, isNseHoliday) || sessionOpen('US', 'extended', now, isNseHoliday);
}

/** The bar a moment belongs to: the market date (D) or the Monday of that week (W). */
export function barKey(market: AlertMarket, interval: AlertInterval, now: Date): string {
  const d = marketDate(market, now);
  if (interval === 'D') return d;
  const [y, m, dd] = d.split('-').map(Number);
  const w = dow(y, m - 1, dd);
  const mon = new Date(Date.UTC(y, m - 1, dd - ((w + 6) % 7)));
  return `W${ymd(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate())}`;
}
