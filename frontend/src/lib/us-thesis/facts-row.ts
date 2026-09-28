// ═══════════════════════════════════════════════════════════════════════════
// ONE US COMPANY'S SEC FIGURES → THE GRADER ROW + ITS SEC PROFILE.   (zzz793)
//
// Pure. Input: EDGAR companyfacts + the submissions profile (SIC, forms).
// Output:
//   row      the deterministic grader row the shared engine reads — ONLY when
//            the company files QUARTERS (10-Q, or quarterly 6-K XBRL); a
//            half-year or annual figure is never handed to the engine as a
//            quarter;
//   profile  what the company is and files (SIC, 10-Q vs 20-F / 40-F), its
//            fiscal calendar, and — for a foreign filer — its latest half-year
//            or annual figures, labelled as such. The profile is what a
//            provisional thesis type is fitted from when no quarter exists.
// No price, no model, no fetch.
// ═══════════════════════════════════════════════════════════════════════════

import { usGradedRow } from './adapter';
import { strictFigures, roceFromFacts, rpoReadings, instantYoY, moneyShort, type FiscalCalendar, type StrictFigures, type UsRpo, type UsInstantYoY } from './xbrl';

export interface UsSecPeriod {
  basis: 'quarterly' | 'semiannual' | 'annual';
  label: string | null;
  currency: string | null;
  revenue: number | null; revenue_prev: number | null;
  net_income: number | null; net_income_prev: number | null;
  operating_income: number | null; operating_income_prev: number | null;
  cfo: number | null;
  sales_growth_pct: number | null; earnings_growth_pct: number | null;
  opm_pct: number | null; opm_prev_pct: number | null;
  cfo_to_pat: number | null;
  derived: string | null;
}

export interface UsSecProfile {
  cik: number | null;
  company: string | null;
  sic: string | null;
  sic_description: string | null;
  /** 'domestic' files 10-Q / 10-K; 'foreign' files 20-F / 40-F / 6-K. */
  filer: 'domestic' | 'foreign' | 'unknown';
  forms_line: string;
  calendar: FiscalCalendar | null;
  /** The newest period the SEC XBRL carries, whatever its length. */
  period: UsSecPeriod | null;
  roce: { pct: number; fiscal: string | null } | null;
  rpo_growth_pct: number | null;
  /** zzz793: the filed order backlog (RPO) readings, current only. */
  rpo?: UsRpo | null;
  /** zzz815: inventories filed at the latest quarter end vs a year earlier. */
  inventory?: UsInstantYoY | null;
  /** Plain words for the card when there is no quarterly row. */
  note: string | null;
}

const pct = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? Math.round(((a / b) - 1) * 1000) / 10 : null);
const pctPos = (a: number | null, b: number | null) => (a != null && b != null && a > 0 && b > 0 ? pct(a, b) : null);

export function filerKind(forms: string[]): { filer: UsSecProfile['filer']; line: string } {
  const f = new Set(forms.map((x) => String(x).toUpperCase()));
  if (f.has('10-Q') || f.has('10-K')) return { filer: 'domestic', line: 'files 10-Q / 10-K' };
  const foreign = ['20-F', '40-F', '6-K'].filter((x) => f.has(x));
  if (foreign.length) return { filer: 'foreign', line: `files ${foreign.join(' / ')} (foreign filer)` };
  return { filer: 'unknown', line: 'no 10-Q, 10-K, 20-F or 40-F in the recent SEC filings' };
}

function periodOf(s: StrictFigures): UsSecPeriod | null {
  if (!s.basis) return null;
  const opm = s.revenue.cur && s.revenue.cur > 0 && s.operating_income.cur != null ? Math.round((s.operating_income.cur / s.revenue.cur) * 1000) / 10 : null;
  const opmP = s.revenue.prev && s.revenue.prev > 0 && s.operating_income.prev != null ? Math.round((s.operating_income.prev / s.revenue.prev) * 1000) / 10 : null;
  return {
    basis: s.basis, label: s.period_label, currency: s.currency,
    revenue: s.revenue.cur, revenue_prev: s.revenue.prev,
    net_income: s.net_income.cur, net_income_prev: s.net_income.prev,
    operating_income: s.operating_income.cur, operating_income_prev: s.operating_income.prev,
    cfo: s.cfo.cur,
    sales_growth_pct: pct(s.revenue.cur, s.revenue.prev),
    earnings_growth_pct: pctPos(s.net_income.cur, s.net_income.prev),
    opm_pct: opm, opm_prev_pct: opmP,
    cfo_to_pat: s.cfo.cur != null && s.net_income.cur != null && s.net_income.cur > 0 ? Math.round((s.cfo.cur / s.net_income.cur) * 100) / 100 : null,
    derived: [s.revenue.derived && `revenue: ${s.revenue.derived}`, s.net_income.derived && `net income: ${s.net_income.derived}`].filter(Boolean).join(' · ') || null,
  };
}

/** A one-line, plain description of a non-quarterly period's figures. */
export function periodLine(p: UsSecPeriod): string {
  const m = (v: number | null) => moneyShort(v, p.currency);
  const bits: string[] = [];
  if (p.revenue != null) bits.push(`revenue ${m(p.revenue)}${p.sales_growth_pct != null ? ` (${p.sales_growth_pct >= 0 ? '+' : ''}${p.sales_growth_pct}% on the same period a year earlier)` : ''}`);
  if (p.net_income != null) bits.push(`${p.net_income < 0 ? 'net loss' : 'net income'} ${m(p.net_income)}${p.net_income_prev != null ? ` (a year earlier ${m(p.net_income_prev)})` : ''}`);
  const span = p.basis === 'annual' ? 'annual' : p.basis === 'semiannual' ? 'half-year' : 'quarterly';
  return `${p.label || 'latest period'} — ${span} figures: ${bits.join(' · ') || 'no revenue or profit line tagged'}`;
}

export interface UsFactsResult { row: Record<string, any> | null; why: string | null; profile: UsSecProfile }

/**
 * The grader row (quarters only) and the SEC profile of one company.
 * `forms` is the list of form types in its recent submissions.
 */
export function usFactsResult(ticker: string, facts: any | null, meta: { cik?: number | null; company?: string | null; sic?: string | null; sicDescription?: string | null; forms?: string[] }): UsFactsResult {
  const fk = filerKind(meta.forms || []);
  const s = facts ? strictFigures(facts) : null;
  const period = s ? periodOf(s) : null;
  const roce0 = facts && s?.basis === 'quarterly' ? roceFromFacts(facts, s.q_end) : null;
  // RPO is read against the company's latest reported period (quarter or year).
  const rpo = facts ? rpoReadings(facts, s?.q_end || null) : null;
  // zzz815: inventories at the quarter end vs a year earlier (working capital, no model).
  const inventory = facts && s?.basis === 'quarterly' ? instantYoY(facts, ['InventoryNet'], s.q_end) : null;
  const profile: UsSecProfile = {
    cik: meta.cik ?? null, company: meta.company || facts?.entityName || null,
    sic: meta.sic || null, sic_description: meta.sicDescription || null,
    filer: fk.filer, forms_line: fk.line, calendar: s?.calendar || null,
    period, roce: roce0 ? { pct: roce0.pct, fiscal: roce0.fiscal } : null,
    rpo_growth_pct: rpo ? rpo.pct : null, rpo, inventory, note: null,
  };
  if (!s || !s.basis) {
    const why = fk.filer === 'foreign'
      ? `Foreign filer — ${fk.line.replace(/ \(foreign filer\)$/, '')}; its financial statements are not in SEC XBRL, so there are no SEC figures to read.`
      : s?.why || 'EDGAR XBRL facts could not be read for this company.';
    profile.note = why;
    return { row: null, why, profile };
  }
  if (s.basis !== 'quarterly') {
    const why = `Foreign filer — ${fk.filer === 'foreign' ? fk.line.replace(/ \(foreign filer\)$/, '') : 'no 10-Q filed'}; quarterly figures are not in SEC XBRL. ${periodLine(period!)}.`;
    profile.note = why;
    return { row: null, why, profile };
  }
  const usd = s.currency === 'USD';
  const row = usGradedRow(ticker, {
    q_end: s.q_end, q_end_prev: s.q_end_prev, q_filed: s.q_filed,
    revenue: s.revenue.cur, revenue_prev: s.revenue.prev,
    operating_income: s.operating_income.cur, operating_income_prev: s.operating_income.prev,
    net_income: s.net_income.cur, net_income_prev: s.net_income.prev,
    eps: s.eps.cur, eps_prev: s.eps.prev, cfo: s.cfo.cur, capex: s.capex.cur,
  }, { company: profile.company, cik: meta.cik ?? null, fiscalLabel: s.fiscal_name });
  if (!row) {
    const why = s.why || 'no quarterly revenue or net income in the SEC XBRL facts';
    profile.note = why;
    return { row: null, why, profile };
  }
  // The period, in the company's own words, never an India key.
  row.period = s.period_label;
  row.fiscal_label = s.fiscal_name;
  row.period_basis = 'quarterly';
  row.currency = s.currency;
  row.xbrl_derived = period?.derived || null;
  row.revenue_tag = s.revenue.tag; row.net_income_tag = s.net_income.tag;
  row.industry = meta.sicDescription || null;
  row.sic = meta.sic || null;
  row.fiscal_calendar = s.calendar;
  // The money lines are USD millions ONLY when the company reports in USD.
  if (!usd) for (const k of Object.keys(row)) if (/_musd$/.test(k)) row[k] = null;
  // ROCE is not a US disclosure. Computed only where it is clean (see
  // roceFromFacts), labelled; otherwise absent — never "not disclosed".
  if (roce0 && usd) { row.roce_pct = roce0.pct; row.roce_basis = 'sec-ttm'; row.roce_period = roce0.fiscal; }
  if (rpo) { row.rpo_growth_pct = rpo.pct; row.rpo = rpo; }
  if (inventory && usd) row.inventory = inventory;
  return { row, why: null, profile };
}
