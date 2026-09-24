// ═══════════════════════════════════════════════════════════════════════════
// US REPORTING CALENDAR OVER THE SHARED PERIOD KEYS.                 (zzz790)
//
// The shared ledger keys every period by the CALENDAR quarter that ended
// before the document's date ("Q1 FY27" = quarter ended 30 Jun 2026) — that
// is what lets freshness, ordering and the thesis engine run unchanged. The
// company's OWN fiscal quarter ("Q2 FY2026, quarter ended 28 Jun 2026") is
// stored beside it and printed on the US page.
//
// Deadlines differ from SEBI's in one place that matters: the December
// quarter. SEBI wants it in 45 days; a US 10-K is due 60–90 days after year
// end. Fed the India calendar, every US name would read STALE from mid-Feb
// to the end of March. So the shared freshness functions are given a "now"
// that has not yet passed the December quarter until 90 days after it.
// (10-Qs are due in 40–45 days, inside the shared 45/60-day windows.)
// ═══════════════════════════════════════════════════════════════════════════

import { latestExpectedPeriod, freshnessOf, type CompanyLedger, type FreshnessView } from '@/lib/thesis/evidence-ledger';

const DAY = 86_400_000;
const US_ANNUAL_LAG_DAYS = 90;

/** Pure: the instant to feed the shared calendar functions for a US ledger. */
export function usCalendarNow(now: Date | string = new Date()): Date {
  const t = typeof now === 'string' ? new Date(now) : now;
  const exp = latestExpectedPeriod(t);
  if (exp.period_end && /-12-31$/.test(exp.period_end)) {
    const end = Date.parse(`${exp.period_end}T00:00:00Z`);
    if (t.getTime() < end + US_ANNUAL_LAG_DAYS * DAY) return new Date(end + 44 * DAY);
  }
  return t;
}

/** Pure: the latest period every US filer must have reported by `now`. */
export function usExpectedPeriod(now: Date | string = new Date()): ReturnType<typeof latestExpectedPeriod> {
  return latestExpectedPeriod(usCalendarNow(now));
}

/** Pure: shared freshness, read against the US calendar. */
export function usFreshness(ledger: CompanyLedger | null, now: Date | string = new Date()): FreshnessView {
  return freshnessOf(ledger, usCalendarNow(now));
}
