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
  const from = new Date(fromIso);
  const to = new Date(toIso);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const tickers = await getCalendarTickersForDate(iso);
    for (const t of tickers) out.push({ ticker: t, date: iso });
  }
  return out;
}
