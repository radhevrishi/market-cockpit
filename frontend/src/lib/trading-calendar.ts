// ═══════════════════════════════════════════════════════════════════════════
// TRADING CALENDAR ENGINE (PATCH 0768)
//
// Per user blueprint:
//   "Top Movers module must ALWAYS show the latest valid trading-session
//    data. NEVER depend solely on current-day live API responses."
//
// Provides:
//   • getEffectiveTradingDate(exchange, now) — walks back from `now` through
//     weekends + holidays + pre-market hours to land on the most recent
//     completed trading session
//   • NSE_HOLIDAYS / NYSE_HOLIDAYS — list of known closed days
//   • previousTradingDay(exchange, dateIso) — step back by one trading day
//   • isMarketOpenNow(exchange) — quick live-check
//
// Holiday lists are best-effort; real fix is a daily refresh from the
// exchange holiday calendar. Hardcoded list covers 2025 + 2026.
// ═══════════════════════════════════════════════════════════════════════════

import { istNow } from '@/lib/market-hours';

export type Exchange = 'NSE' | 'NYSE';

// ─── NSE Holidays (calendar 2025-2026) ─────────────────────────────────
// Source: nseindia.com/resources/exchange-communication-holidays
export const NSE_HOLIDAYS: Set<string> = new Set([
  // 2025
  '2025-02-26', // Mahashivratri
  '2025-03-14', // Holi
  '2025-03-31', // Eid-Ul-Fitr
  '2025-04-10', // Mahavir Jayanti
  '2025-04-14', // Ambedkar Jayanti
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day
  '2025-08-15', // Independence Day
  '2025-08-27', // Ganesh Chaturthi
  '2025-10-02', // Mahatma Gandhi Jayanti / Dussehra
  '2025-10-21', // Diwali
  '2025-10-22', // Diwali Balipratipada
  '2025-11-05', // Guru Nanak Jayanti
  '2025-12-25', // Christmas
  // 2026
  '2026-01-26', // Republic Day
  '2026-02-17', // Mahashivratri
  '2026-03-03', // Holi
  '2026-03-20', // Eid-Ul-Fitr
  '2026-04-01', // Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-27', // Eid-Ul-Adha
  '2026-08-15', // Independence Day (Sat — already weekend)
  '2026-08-22', // Ganesh Chaturthi
  '2026-10-02', // Gandhi Jayanti
  '2026-11-09', // Diwali
  '2026-11-10', // Diwali
  '2026-12-25', // Christmas
]);

// ─── NYSE Holidays (calendar 2025-2026) ────────────────────────────────
// Source: nyse.com/markets/hours-calendars
export const NYSE_HOLIDAYS: Set<string> = new Set([
  // 2025
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

// ─── Market open/close hours (IST for NSE, ET for NYSE) ────────────────

const NSE_OPEN_IST  = { h: 9,  m: 15 };
const NSE_CLOSE_IST = { h: 15, m: 30 };
const NYSE_OPEN_ET   = { h: 9,  m: 30 };
const NYSE_CLOSE_ET  = { h: 16, m: 0  };

// ─── Helpers ───────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function isHoliday(d: Date, exchange: Exchange): boolean {
  const iso = isoDate(d);
  return exchange === 'NSE' ? NSE_HOLIDAYS.has(iso) : NYSE_HOLIDAYS.has(iso);
}

function isClosedDay(d: Date, exchange: Exchange): boolean {
  return isWeekend(d) || isHoliday(d, exchange);
}

/** True if the given exchange has live trading happening right now. */
export function isMarketOpenNow(exchange: Exchange, now?: Date): boolean {
  const base = now ?? new Date();
  if (exchange === 'NSE') {
    const t = istNow(base);
    if (isClosedDay(t, 'NSE')) return false;
    const h = t.getUTCHours(); const m = t.getUTCMinutes();
    const cur = h * 60 + m;
    const open = NSE_OPEN_IST.h * 60 + NSE_OPEN_IST.m;
    const close = NSE_CLOSE_IST.h * 60 + NSE_CLOSE_IST.m;
    return cur >= open && cur < close;
  }
  // NYSE — approximate ET via UTC-4 (we don't track DST precisely)
  const t = new Date(base.getTime() - 4 * 3600_000);
  if (isClosedDay(t, 'NYSE')) return false;
  const h = t.getUTCHours(); const m = t.getUTCMinutes();
  const cur = h * 60 + m;
  const open = NYSE_OPEN_ET.h * 60 + NYSE_OPEN_ET.m;
  const close = NYSE_CLOSE_ET.h * 60 + NYSE_CLOSE_ET.m;
  return cur >= open && cur < close;
}

/**
 * Walk back from `now` to land on the most recent COMPLETED trading session
 * for the given exchange. Honors weekends, holidays, and pre-market hours
 * (e.g. Monday 7am IST → returns previous Friday).
 *
 * Returns ISO date 'YYYY-MM-DD'.
 */
export function getEffectiveTradingDate(exchange: Exchange, now?: Date): string {
  const base = now ?? new Date();
  // Convert to exchange timezone
  const t = exchange === 'NSE'
    ? istNow(base)
    : new Date(base.getTime() - 4 * 3600_000);
  let cursor = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));

  // If today is a closed day, walk back until we hit a trading day
  while (isClosedDay(cursor, exchange)) {
    cursor = new Date(cursor.getTime() - 86400_000);
  }

  // If today IS a trading day BUT we're pre-market open, the previous
  // completed session is yesterday-trading-day. (Otherwise today's
  // session is in progress / completed and counts.)
  const openMinute = (exchange === 'NSE' ? NSE_OPEN_IST.h : NYSE_OPEN_ET.h) * 60
                   + (exchange === 'NSE' ? NSE_OPEN_IST.m : NYSE_OPEN_ET.m);
  const curMinute = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (isoDate(cursor) === isoDate(t) && curMinute < openMinute) {
    // Pre-market: roll back to previous trading day
    cursor = new Date(cursor.getTime() - 86400_000);
    while (isClosedDay(cursor, exchange)) {
      cursor = new Date(cursor.getTime() - 86400_000);
    }
  }

  return isoDate(cursor);
}

/**
 * One trading day before `dateIso`. Steps over weekends + holidays.
 */
export function previousTradingDay(exchange: Exchange, dateIso: string): string {
  let cursor = new Date(dateIso + 'T00:00:00Z');
  cursor = new Date(cursor.getTime() - 86400_000);
  while (isClosedDay(cursor, exchange)) {
    cursor = new Date(cursor.getTime() - 86400_000);
  }
  return isoDate(cursor);
}

/**
 * Human-readable label of how far back the effective date is from today.
 * "today" / "yesterday" / "Fri close" / "2 days ago" etc.
 */
export function effectiveDateLabel(effectiveIso: string, exchange: Exchange = 'NSE', now?: Date): string {
  const t = exchange === 'NSE' ? istNow(now) : new Date((now ?? new Date()).getTime() - 4 * 3600_000);
  const todayIso = isoDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())));
  if (effectiveIso === todayIso) return 'today';
  const dt = new Date(effectiveIso + 'T00:00:00Z');
  const today = new Date(todayIso + 'T00:00:00Z');
  const daysBack = Math.round((today.getTime() - dt.getTime()) / 86400_000);
  if (daysBack === 1) return 'yesterday';
  if (daysBack >= 2 && daysBack <= 7) {
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()];
    return `${weekday} close`;
  }
  return effectiveIso;
}
