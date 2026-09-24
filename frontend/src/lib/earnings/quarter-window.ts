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

export function quarterEndDate(q: string): Date | null {
  const m = String(q || '').match(/Q([1-4])\s*FY\s?(\d{2})/i);
  if (!m) return null;
  const qn = +m[1];
  const fy = 2000 + +m[2];           // FY27 ends 31-Mar-2027
  if (qn === 1) return new Date(Date.UTC(fy - 1, 5, 30));
  if (qn === 2) return new Date(Date.UTC(fy - 1, 8, 30));
  if (qn === 3) return new Date(Date.UTC(fy - 1, 11, 31));
  return new Date(Date.UTC(fy, 2, 31));
}

export function previousQuarter(q: string): string | null {
  const m = String(q || '').match(/Q([1-4])\s*FY\s?(\d{2})/i);
  if (!m) return null;
  const qn = +m[1], fy = +m[2];
  return qn === 1 ? `Q4 FY${String(fy - 1).padStart(2, '0')}` : `Q${qn - 1} FY${String(fy).padStart(2, '0')}`;
}

export function isAcceptableQuarter(quarter: string, expected: string, filingDate: Date | null): boolean {
  if (quarter === expected) return true;
  if (!filingDate || quarter !== previousQuarter(expected)) return false;
  const qEnd = quarterEndDate(quarter);
  if (!qEnd) return false;
  const days = (filingDate.getTime() - qEnd.getTime()) / 86_400_000;
  return days >= 0 && days <= 120;
}

