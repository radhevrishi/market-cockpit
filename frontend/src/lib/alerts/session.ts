// zzz1054 — trading sessions for price alerts (pure; `now` is a parameter everywhere).
// zzz1063 — the calendar itself now lives in lib/exchange-calendar.ts (ONE calendar: NSE holidays, NYSE holidays by rule,
// 13:00 ET early closes, DST through Intl). This file keeps the names the alert code and its tests import.
import {
  nyseHolidays, isNyseHoliday, isTradingDay as calTradingDay, marketDate as calMarketDate, sessionOpen as calSessionOpen,
  regularStarted as calRegularStarted, phaseAt, prevTradingDay, dayWindows,
} from '@/lib/exchange-calendar';
import { isNseHolidayDate } from '@/lib/market-hours';
import type { AlertMarket, SessionMode, AlertInterval } from './types';

export { nyseHolidays, isNyseHoliday, phaseAt, prevTradingDay, dayWindows };

const ymd = (y: number, m0: number, d: number) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The market's local calendar date (YYYY-MM-DD). */
export function marketDate(market: AlertMarket, now: Date): string { return calMarketDate(market, now); }

/** Is `date` a trading day in that market (weekday, not a holiday)? */
export function isTradingDay(market: AlertMarket, date: string, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  return calTradingDay(market, date, isNseHoliday);
}

/** Ordinary-day windows (local minutes). Early closes come from lib/exchange-calendar dayWindows — never from this table. */
export const SESSION_WINDOWS: Record<AlertMarket, Record<SessionMode, [number, number]>> = {
  IN: { regular: [9 * 60 + 15, 15 * 60 + 30], extended: [9 * 60, 16 * 60] },
  US: { regular: [9 * 60 + 30, 16 * 60], extended: [4 * 60, 20 * 60] },
};

/** Is that market's session (regular or extended) open now? Weekends, exchange holidays and time after an early close are closed. */
export function sessionOpen(market: AlertMarket, mode: SessionMode, now: Date, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  return calSessionOpen(market, mode, now, isNseHoliday);
}
/** Has today's regular session started (≥ open time on a trading day)? Used to decide whether "today's open" can exist. */
export function regularStarted(market: AlertMarket, now: Date, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  return calRegularStarted(market, now, isNseHoliday);
}
/** Is any session (in its widest, extended form) open in either market? The checker does nothing when false. */
export function anySessionOpen(now: Date, isNseHoliday: (d: string) => boolean = isNseHolidayDate): boolean {
  return sessionOpen('IN', 'extended', now, isNseHoliday) || sessionOpen('US', 'extended', now, isNseHoliday);
}

/** zzz1063 — the date of the last COMPLETED daily bar the checker should have while `today`'s session is on: the trading day
 *  before today (today's own bar is never in the completed set — conditions use the live price as the current bar). */
export function expectedDailyAsOf(market: AlertMarket, today: string, isNseHoliday: (d: string) => boolean = isNseHolidayDate): string {
  return prevTradingDay(market, today, isNseHoliday);
}

/** The bar a moment belongs to: the market date (D) or the Monday of that week (W). */
export function barKey(market: AlertMarket, interval: AlertInterval, now: Date): string {
  const d = marketDate(market, now);
  if (interval === 'D') return d;
  const [y, m, dd] = d.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  const mon = new Date(Date.UTC(y, m - 1, dd - ((w + 6) % 7)));
  return `W${ymd(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate())}`;
}
