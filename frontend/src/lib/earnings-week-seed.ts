// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS CALENDAR — KV-backed, self-updating (PATCH 0181)
//
// Earlier (0180) used a hardcoded seed for May 12-18, 2026. User pushback:
// "I want to use this for next 10 years not 10 days. so all must work
// automatically." Replaced with KV-backed reader.
//
// Source of truth: KV keys `earnings-cal:auto:YYYY-MM-DD` → string[] of tickers.
// Populated daily by /api/v1/cron/refresh-earnings-calendar (Vercel Cron).
// /api/market/earnings reads this and merges into the universe.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, isRedisAvailable } from './kv';
import { daysBetween } from './calendar-dates';

const KV_KEY_PREFIX = 'earnings-cal:auto:';

/** Get tickers scheduled to file on a specific date (from KV) */
export async function getCalendarTickersForDate(date: string): Promise<string[]> {
  if (!isRedisAvailable()) return [];
  try {
    const data = await kvGet<string[]>(`${KV_KEY_PREFIX}${date}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Get all calendar entries for a date range (from KV) */
export async function getCalendarEntriesInRange(
  fromIso: string,
  toIso: string,
): Promise<Array<{ ticker: string; date: string }>> {
  if (!isRedisAvailable()) return [];
  const out: Array<{ ticker: string; date: string }> = [];
  // Iterate day-by-day across the range — KV doesn't support range scans efficiently
  // but we typically query 6-week ranges max (28 days back + 14 forward).
  // zzz897 — pure YYYY-MM-DD stepping (was `new Date(iso)` UTC parse + local setDate, which repeats or skips a
  // day across a DST change on a non-UTC host), and keys read in parallel.
  const days = daysBetween(fromIso, toIso, 120);
  const lists = await Promise.all(days.map((iso) => getCalendarTickersForDate(iso)));
  days.forEach((iso, i) => { for (const t of lists[i]) out.push({ ticker: t, date: iso }); });
  return out;
}
