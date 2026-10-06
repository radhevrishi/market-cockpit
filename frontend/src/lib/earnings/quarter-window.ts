// ═══════════════════════════════════════════════════════════════════════════
// RESULTS-QUARTER WINDOW (zzz800) — which reporting quarter a filing in a given
// month may legitimately be for. Pure; shared by the India universe builder
// (/api/market/earnings) and its tests.
//
// Every source in the builder used to require quarter === expectedQuarter (one
// quarter per calendar month). A NEW LISTING files the quarter preceding its
// listing within 21 days of listing (SEBI LODR), and late filers get
// extensions — both file the PREVIOUS quarter, and both were silently dropped.
// The previous quarter is accepted while the filing is within 120 days of that
// quarter's end, and no older, so a restated or re-submitted old result still
// cannot pass as this season's filing.
// ═══════════════════════════════════════════════════════════════════════════

import { parseQuarterLabel, fiscalQuarterEnd, fy2 } from '@/lib/calendar-dates';

/** zzz897 — the two-digit FY is resolved to the century nearest `ref` (was `2000 + yy`, so FY00 in 2100 meant 2000). */
export function quarterEndDate(q: string, ref: Date = new Date()): Date | null {
  const p = parseQuarterLabel(q, ref);
  return p ? fiscalQuarterEnd(p.q, p.fy) : null;
}

/** zzz897 — Q1 FY00 → Q4 FY99 (was "Q4 FY-1"). */
export function previousQuarter(q: string): string | null {
  const m = String(q || '').match(/Q([1-4])\s*FY\s?(\d{2})/i);
  if (!m) return null;
  const qn = +m[1], fy = +m[2];
  return qn === 1 ? `Q4 FY${fy2(fy - 1)}` : `Q${qn - 1} FY${fy2(fy)}`;
}

export function isAcceptableQuarter(quarter: string, expected: string, filingDate: Date | null): boolean {
  if (quarter === expected) return true;
  if (!filingDate || quarter !== previousQuarter(expected)) return false;
  const qEnd = quarterEndDate(quarter, filingDate);
  if (!qEnd) return false;
  const days = (filingDate.getTime() - qEnd.getTime()) / 86_400_000;
  return days >= 0 && days <= 120;
}

