// zzz865 — DERIVED GUIDANCE AUDIT. A derived growth is one the system calculated from a stated target amount and a sourced base. Every one is listed with
// target, base, base period, growth, formula, source, date and status, and the growth is RE-CALCULATED here from the stored numbers: a row whose stored growth does
// not match its own numbers is marked, never silently kept. Pure; nothing is changed, nothing is hidden. The system never prefers a media figure over the
// calculation: when another figure exists for the same company and period it is shown next to this one so the difference can be traced to its base.
export interface DerivedAuditRow {
  company: string; ticker: string | null; market: string; metric: string; period: string;
  target: string; base: string; basePeriod: string; growth: string; formula: string;
  source: string; sourceUrl: string | null; date: string | null; status: string;
  basisKind: 'prior-year actual' | 'prior guidance';
  recalculated: boolean; issues: string[];
  /** another figure for the same company, metric and period, shown for comparison (not used in this row) */ otherFigure: string | null;
}
export interface DerivedAudit { rows: DerivedAuditRow[]; total: number; recalcOk: number; withIssues: number }
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const num = (n: number, unit: string) => `${unit === '%' ? '' : unit ? `${unit} ` : ''}${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 100) / 100)}${unit === '%' ? '%' : ''}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(Math.round(n * 10) / 10).toFixed(1)}%`;

export function auditDerived(records: ReadonlyArray<{ record?: { company?: string; ticker?: string; market?: string }; tickers?: string[]; points?: any[] }>): DerivedAudit {
  const rows: DerivedAuditRow[] = [];
  for (const r of records) {
    for (const p of r.points || []) {
      const d = p?.growthDerivation; if (p?.growthType !== 'DERIVED' || !d) continue;
      const issues: string[] = [];
      const ok = fin(d.previousValue) && d.previousValue > 0 && fin(d.currentLow) && fin(d.currentHigh);
      let gl = NaN, gh = NaN;
      if (ok) { gl = (d.currentLow / d.previousValue - 1) * 100; gh = (d.currentHigh / d.previousValue - 1) * 100; }
      else issues.push('The stored numbers cannot be used to recalculate the growth.');
      const stored = p.growthExact as { low: number; high: number } | null;
      if (ok && stored && (Math.abs(stored.low - gl) > 0.15 || Math.abs(stored.high - gh) > 0.15)) issues.push(`Stored growth (${pct(stored.low)} to ${pct(stored.high)}) does not match the recalculation (${pct(gl)} to ${pct(gh)}).`);
      if (String(d.basePeriod || '').toUpperCase().replace(/\s+/g, '') === String(p.period || '').toUpperCase().replace(/\s+/g, '')) issues.push('The base period is the same as the target period.');
      if (!p.primarySource && !p.primarySourceRead) issues.push('No company document has been read for this figure.');
      const same = d.currentLow === d.currentHigh;
      rows.push({
        company: r.record?.company || '', ticker: r.record?.ticker || r.tickers?.[0] || null, market: r.record?.market || '', metric: String(p.metric), period: String(p.period),
        target: same ? num(d.currentLow, d.unit) : `${num(d.currentLow, d.unit)} to ${num(d.currentHigh, d.unit)}`,
        base: fin(d.previousValue) ? num(d.previousValue, d.unit) : 'n/a', basePeriod: String(d.basePeriod || 'n/a'),
        growth: ok ? (same ? pct(gl) : `${pct(gl)} to ${pct(gh)}`) : 'n/a',
        formula: ok ? (same ? `${num(d.currentLow, d.unit)} ÷ ${num(d.previousValue, d.unit)} − 1` : `(${num(d.currentLow, d.unit)} ÷ ${num(d.previousValue, d.unit)} − 1) to (${num(d.currentHigh, d.unit)} ÷ ${num(d.previousValue, d.unit)} − 1)`) : 'not calculable',
        source: String(p.sourceName || ''), sourceUrl: p.sourceUrl ?? null, date: p.sourceDate ?? null, status: String(p.verificationState || p.verification || ''),
        basisKind: d.basis === 'absolute_vs_prior_guidance' ? 'prior guidance' : 'prior-year actual',
        recalculated: ok && issues.every((x) => !/does not match|cannot be used/.test(x)), issues,
        otherFigure: p.secondaryDisplay || (p.impliedDisplay && p.growthType === 'DERIVED' ? null : null) || null,
      });
    }
  }
  rows.sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0) || a.company.localeCompare(b.company));
  return { rows, total: rows.length, recalcOk: rows.filter((x) => x.recalculated).length, withIssues: rows.filter((x) => x.issues.length).length };
}
