// ═══════════════════════════════════════════════════════════════════════════
// zzz1068 — LAST FULL FISCAL YEAR CASH CONVERSION, FOR A US CARD WITH NO QUARTER CASH YET.
//
// An 8-K results release rarely carries a tagged cash-flow statement, so on the day
// of the print `cfo_curr_musd` is null until the 10-Q lands weeks later (JBHT, EMR,
// JNJ, AA, ACI on 16 Oct 2026) and the card showed no cash figure at all. The last
// 10-K's operating cash flow and net income — the SAME fiscal year, from the filer's
// own XBRL — are shown instead, labelled with that year. Never mixed with the
// quarter: the ratio is the year ÷ the same year. Display only; the grade does not
// read it. Null when either figure is missing.
// ═══════════════════════════════════════════════════════════════════════════
import { conceptSeries, pickConcept } from '@/lib/us-earnings-core';

export interface UsAnnualCash { cfo_musd: number; ni_musd: number; ratio: number | null; fy_end: string; basis: string }

type Dur = { start: string; end: string; days: number; val: number };

/** Pure over two series (tested without SEC data). */
export function annualCashFromSeries(cfo: Dur[], ni: Dur[], notAfterIso?: string | null): UsAnnualCash | null {
  const annual = (rows: Dur[]) => rows.filter((r) => r.days >= 350 && r.days <= 380 && (!notAfterIso || r.end <= notAfterIso)).sort((a, b) => a.end.localeCompare(b.end));
  const cfoY = annual(cfo), niY = annual(ni);
  for (let i = cfoY.length - 1; i >= 0; i--) {
    const c = cfoY[i];
    const n = niY.find((x) => x.end === c.end && x.start === c.start);
    if (!n || !Number.isFinite(c.val) || !Number.isFinite(n.val) || c.val === 0 || n.val === 0) continue;
    const raw = n.val > 0 ? c.val / n.val : null;
    const ratio = raw != null && Math.abs(raw) <= 50 ? Math.round(raw * 100) / 100 : null;
    const d = new Date(`${c.end}T00:00:00Z`);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return { cfo_musd: Math.round(c.val / 1e4) / 100, ni_musd: Math.round(n.val / 1e4) / 100, ratio, fy_end: c.end, basis: `fiscal year to ${mon} ${d.getUTCFullYear()} (10-K)` };
  }
  return null;
}

export function annualCashFromFacts(facts: any, notAfterIso?: string | null): UsAnnualCash | null {
  try {
    const cfoC = pickConcept(facts, 'cfo');
    const niC = pickConcept(facts, 'net_income');
    if (!cfoC || !niC) return null;
    return annualCashFromSeries(conceptSeries(facts, cfoC), conceptSeries(facts, niC), notAfterIso);
  } catch { return null; }
}
