// zzz888 — WHAT A CATALYST IS WORTH: a rough, stated-assumption estimate of how an order book, an order win, a capex
// programme or a capacity addition changes yearly revenue, profit (and so EPS) and free cash flow.
//
// It is arithmetic on the company's own figures, never a forecast from nowhere:
//   • the base is the company's last four quarters (sales, profit, margin) from the graded / screener row;
//   • the catalyst value is the figure the filing states (₹ crore order book, capex, % capacity added);
//   • every assumption (execution years, asset turnover, working-capital days, margin used) is printed with the result.
// When a needed figure is missing, the line says what is missing and gives no number. Pure, unit-tested.

export type CatalystKind = 'ORDER_BOOK' | 'ORDER_WIN' | 'CAPEX' | 'CAPACITY_ADD';
export interface ImpactBase { salesCr: number | null; patCr: number | null; opmPct: number | null }
export interface CatalystInput { kind: CatalystKind; valueCr?: number | null; pct?: number | null; label: string; period?: string | null; source?: string | null }
export interface CatalystImpact {
  kind: CatalystKind; label: string; period: string | null; source: string | null;
  /** extra revenue per year once running, ₹ Cr */ revenueCr: number | null;
  /** extra profit after tax per year, ₹ Cr */ patCr: number | null;
  /** change in EPS vs the last four quarters, % (share count assumed unchanged) */ epsPct: number | null;
  /** free cash flow in the first year, ₹ Cr (negative = cash goes out: capex, working capital) */ fcfYear1Cr: number | null;
  assumptions: string[]; missing: string[]; line: string;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const cr = (v: number) => `₹${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-IN') : r1(v)} Cr`;
const sgn = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(r1(v))}`;

/** Defaults stated with every result. Conservative on purpose. */
export const IMPACT_DEFAULTS = { orderWinYears: 2, assetTurnover: 1.5, wcDays: 90, minYears: 1, maxYears: 4 } as const;

/** The base from a graded / screener / Conviction Beats row: last four quarters where available, else the latest quarter × 4. */
export function impactBaseOf(g: any): ImpactBase {
  if (!g || typeof g !== 'object') return { salesCr: null, patCr: null, opmPct: null };
  const qs: number[] = Array.isArray(g.quarters_sales) ? g.quarters_sales.filter(num) : [];
  const qp: number[] = Array.isArray(g.quarters_pat) ? g.quarters_pat.filter(num) : [];
  const salesCr = qs.length >= 4 ? qs.slice(-4).reduce((a, b) => a + b, 0) : num(g.sales_curr_cr) ? g.sales_curr_cr * 4 : null;
  // the thesis engine reads no price or market value (owner's rule): profit comes from the reported figures only
  const patCr = qp.length >= 4 ? qp.slice(-4).reduce((a, b) => a + b, 0) : num(g.pat_annual_cr) ? g.pat_annual_cr : num(g.pat_curr_cr) ? g.pat_curr_cr * 4 : null;
  return { salesCr: salesCr != null && salesCr > 0 ? salesCr : null, patCr, opmPct: num(g.opm_pct) ? g.opm_pct : null };
}

export function catalystImpact(base: ImpactBase, c: CatalystInput): CatalystImpact {
  const assumptions: string[] = []; const missing: string[] = [];
  const out: CatalystImpact = { kind: c.kind, label: c.label, period: c.period ?? null, source: c.source ?? null, revenueCr: null, patCr: null, epsPct: null, fcfYear1Cr: null, assumptions, missing, line: '' };
  if (base.salesCr == null) missing.push('annual sales');
  const margin = base.salesCr && base.patCr != null && base.salesCr > 0 ? base.patCr / base.salesCr : null;
  if (margin == null) missing.push('profit margin');
  let rev: number | null = null; let fcf1: number | null = null;
  const D = IMPACT_DEFAULTS;
  if (c.kind === 'ORDER_BOOK' || c.kind === 'ORDER_WIN') {
    if (!num(c.valueCr) || c.valueCr <= 0) missing.push('order value in ₹ crore');
    else if (base.salesCr != null) {
      if (c.kind === 'ORDER_WIN') {
        rev = c.valueCr / D.orderWinYears;
        assumptions.push(`executed evenly over ${D.orderWinYears} years`);
      } else {
        // an order book is mostly existing business: only the part above today's yearly sales is new revenue
        const years = Math.max(D.minYears, Math.min(D.maxYears, c.valueCr / base.salesCr));
        const perYear = c.valueCr / years;
        rev = Math.max(0, perYear - base.salesCr);
        assumptions.push(`book executed over ${r1(years)} years (book ÷ sales, kept between ${D.minYears} and ${D.maxYears}); only revenue above today's ${cr(base.salesCr)}/yr counts as new`);
      }
      fcf1 = -(rev * D.wcDays) / 365;
      assumptions.push(`working capital ${D.wcDays} days of the extra revenue (first-year cash out)`);
    }
  } else if (c.kind === 'CAPEX') {
    if (!num(c.valueCr) || c.valueCr <= 0) missing.push('capex in ₹ crore');
    else {
      rev = c.valueCr * D.assetTurnover;
      fcf1 = -c.valueCr;
      assumptions.push(`asset turnover ${D.assetTurnover}× at full ramp (industry figure not known — check the company's own)`, 'first-year cash = the capex itself (spent before it earns)');
    }
  } else if (c.kind === 'CAPACITY_ADD') {
    if (!num(c.pct) || c.pct <= 0) missing.push('capacity added as %');
    else if (base.salesCr != null) {
      rev = base.salesCr * (c.pct / 100);
      fcf1 = -(rev * D.wcDays) / 365;
      assumptions.push(`new capacity sells at today's revenue per unit of capacity, fully used`, `working capital ${D.wcDays} days of the extra revenue`);
    }
  }
  if (rev != null) {
    out.revenueCr = r1(rev);
    if (margin != null) {
      const pat = rev * margin;
      out.patCr = r1(pat);
      assumptions.push(`profit margin ${r1(margin * 100)}% (today's, last four quarters; no operating leverage assumed)`);
      if (base.patCr && base.patCr > 0) out.epsPct = r1((pat / base.patCr) * 100);
      else missing.push('positive current profit (EPS change not meaningful)');
    }
  }
  if (fcf1 != null) out.fcfYear1Cr = r1(fcf1);
  out.line = missing.length && out.revenueCr == null
    ? `${c.label}: no estimate — missing ${missing.join(', ')}.`
    : `${c.label}: about ${cr(out.revenueCr ?? 0)} revenue/yr${out.patCr != null ? `, ${cr(out.patCr)} profit/yr` : ''}${out.epsPct != null ? ` (EPS ${sgn(out.epsPct)}%)` : ''}${out.fcfYear1Cr != null ? `; first-year cash ${sgn(out.fcfYear1Cr)} Cr` : ''}.`;
  return out;
}

const isCrore = (unit: string | null | undefined, value: string | null | undefined) => /cr(ore)?s?\b|₹|inr|rs\.?/i.test(`${unit || ''} ${value || ''}`) && !/lakh|mn|million|bn|billion|usd|\$/i.test(`${unit || ''} ${value || ''}`);

/** Catalysts from the ledger's latest period snapshot (FOUND figures only; a target or commentary is never used as a value). */
export function catalystsFromLedger(ledger: any): CatalystInput[] {
  const p = ledger?.latest_period ? ledger?.periods?.[ledger.latest_period] : null;
  const vars: Record<string, any> = p?.variables || {};
  const out: CatalystInput[] = [];
  const found = (k: string) => { const v = vars[k]; return v && v.state === 'FOUND' && num(v.numeric) ? v : null; };
  const ob = found('order_book');
  if (ob && isCrore(ob.unit, ob.value)) out.push({ kind: 'ORDER_BOOK', valueCr: ob.numeric, label: `Order book ${ob.value}`, period: ledger.latest_period, source: ob.source_name ?? null });
  const oi = found('order_intake');
  if (oi && isCrore(oi.unit, oi.value)) out.push({ kind: 'ORDER_WIN', valueCr: oi.numeric, label: `Order intake ${oi.value}`, period: ledger.latest_period, source: oi.source_name ?? null });
  const cx = found('capex');
  if (cx && isCrore(cx.unit, cx.value)) out.push({ kind: 'CAPEX', valueCr: cx.numeric, label: `Capex ${cx.value}`, period: ledger.latest_period, source: cx.source_name ?? null });
  const ca = found('capacity_addition');
  if (ca && /%/.test(`${ca.unit || ''} ${ca.value || ''}`)) out.push({ kind: 'CAPACITY_ADD', pct: ca.numeric, label: `Capacity added ${ca.value}`, period: ledger.latest_period, source: ca.source_name ?? null });
  return out;
}
