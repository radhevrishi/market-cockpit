// ═══════════════════════════════════════════════════════════════════════════
// COMPANY LAB — quarterly read (zzz1291). Pure.
//   • Rule of 40 = latest quarter's revenue growth vs the same quarter a year earlier + free-cash-flow margin
//     (last four quarters; the latest full year when quarters are not available — said on the card).
//   • Growth acceleration: the last quarters' year-on-year revenue growth, oldest → newest.
//   • Gross and operating margin by quarter.
//   • Working-capital squeeze check (six figures, three ratios): cash, capex, operating cash, free cash flow, debt,
//     receivables vs revenue. Three or more warnings together = look closer; rising capex + worsening FCF + falling cash is
//     the combination named first. USA: quarterly filings. India: screener.in prints cash flow and balance sheet only per
//     year, so the India read is yearly (and receivables are not available).
//   • Dilution (share count change), cash conversion (operating cash ÷ profit), debt ÷ equity.
// A figure that cannot be worked out is "not known" — never a pass, never a fail.
// ═══════════════════════════════════════════════════════════════════════════
import { quartersFromFacts, ttmSum, type CfQuarter, type SecFact } from '../screener/fcf-ttm';
import type { AnnualRow } from './core';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const DAY = 86_400_000;
const dt = (s: string) => Date.parse(s);

export interface QPoint { e: string; label: string; rev: number | null; revYoY: number | null; gm: number | null; om: number | null }
export type Flag = 'warn' | 'ok' | 'unknown';
export interface SqueezeItem { id: string; label: string; state: Flag; value: string; why: string }
export interface QuarterReport {
  basis: 'quarterly' | 'yearly';
  points: QPoint[];                         // last 8 quarters, oldest first
  r40: { value: number | null; revYoY: number | null; fcfMargin: number | null; fcfFrom: string; quarter: string | null };
  accel: { state: 'accelerating' | 'decelerating' | 'steady' | 'unknown'; text: string; last: Array<number | null> };
  gm: { now: number | null; yearAgo: number | null; trend: 'up' | 'down' | 'flat' | 'unknown'; label: string };
  om: { now: number | null; yearAgo: number | null; trend: 'up' | 'down' | 'flat' | 'unknown'; label: string };
  squeeze: { items: SqueezeItem[]; warns: number; known: number; level: 'Low' | 'Watch' | 'High' | 'Unknown'; keyCombo: boolean;
    ratios: { capexToOcf: number | null; runwayQ: number | null; recvG: number | null; revG: number | null }; period: string };
  dilution: { pct: number | null; years: number; perYear: number | null; text: string };
  cfoPat: { latest: number | null; three: number | null; text: string };
  de: { value: number | null; text: string };
}

// ── inputs ─────────────────────────────────────────────────────────────────
export interface QIn {
  basis: 'quarterly' | 'yearly';
  rev: CfQuarter[]; gp: CfQuarter[]; op: CfQuarter[]; cfo: CfQuarter[]; capex: CfQuarter[];
  cash: Map<string, number>; debt: Map<string, number>; recv: Map<string, number>;
  /** India yearly read: period labels for the four flow series (same end dates) */
  yearly?: { ends: string[]; labels: string[]; cfo: (number | null)[]; inv: (number | null)[]; fcf: (number | null)[]; cash: (number | null)[]; debt: (number | null)[]; rev: (number | null)[] };
}

const QTAGS = {
  rev: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense'],
  gp: ['GrossProfit'],
  cost: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'],
  op: ['OperatingIncomeLoss'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquirePropertyAndEquipment'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'],
  recv: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent', 'AccountsAndOtherReceivablesNetCurrent'],
  debt: ['LongTermDebt', 'DebtLongtermAndShorttermCombinedAmount', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities', 'ConvertibleNotesPayable', 'SeniorNotes'],
  debtN: ['LongTermDebtNoncurrent', 'ConvertibleDebtNoncurrent', 'ConvertibleNotesPayableNoncurrent', 'SeniorNotesNoncurrent', 'LongTermLineOfCredit', 'LongTermNotesPayable'], debtC: ['LongTermDebtCurrent', 'DebtCurrent', 'ConvertibleNotesPayableCurrent', 'LineOfCredit', 'ShortTermBorrowings'],
};
const FORMS = /^(10-Q|10-K|10-KT|10-QT)(\/A)?$/;
function facts(f: any, tag: string, unit = 'USD'): SecFact[] {
  const arr: any[] = f?.facts?.['us-gaap']?.[tag]?.units?.[unit] || [];
  return arr.filter((x) => fin(x?.val) && typeof x?.end === 'string').map((x) => ({ start: x.start, end: x.end, val: x.val, filed: x.filed, form: x.form, fy: x.fy, fp: x.fp }));
}
/** The quarters of the first tag whose newest quarter is the newest of all (companies switch revenue tags over time). */
function bestQuarters(f: any, tags: string[]): CfQuarter[] {
  let best: CfQuarter[] = [];
  for (const t of tags) {
    const q = quartersFromFacts(facts(f, t));
    if (q.length && (!best.length || q[q.length - 1].e > best[best.length - 1].e || (q[q.length - 1].e === best[best.length - 1].e && q.length > best.length))) best = q;
  }
  return best;
}
function instants(f: any, tags: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tags) {
    const best = new Map<string, { v: number; filed: string }>();
    for (const x of facts(f, t)) {
      if (x.start || (x.form && !FORMS.test(x.form))) continue;
      const cur = best.get(x.end);
      if (!cur || String(x.filed || '') > cur.filed) best.set(x.end, { v: x.val, filed: String(x.filed || '') });
    }
    for (const [e, v] of best) if (!out.has(e)) out.set(e, v.v);
  }
  return out;
}
/** USA: the quarterly inputs from SEC company facts (10-Q / 10-K; a foreign 20-F filer has no quarters → empty). */
export function usQuarterInputs(f: any): QIn {
  const rev = bestQuarters(f, QTAGS.rev);
  let gp = bestQuarters(f, QTAGS.gp);
  if (!gp.length) {
    const cost = bestQuarters(f, QTAGS.cost);
    gp = rev.map((q) => { const c = cost.find((x) => Math.abs(dt(x.e) - dt(q.e)) <= 5 * DAY); return c ? { s: q.s, e: q.e, v: q.v - c.v, d: 1 as const } : null; }).filter(Boolean) as CfQuarter[];
  }
  const d = instants(f, QTAGS.debt), dn = instants(f, QTAGS.debtN), dc = instants(f, QTAGS.debtC);
  const debt = new Map<string, number>(d);
  for (const [e, v] of dn) if (!debt.has(e)) debt.set(e, v + (dc.get(e) ?? 0));
  for (const [e, v] of dc) if (!debt.has(e)) debt.set(e, v);
  return { basis: 'quarterly', rev, gp, op: bestQuarters(f, QTAGS.op), cfo: bestQuarters(f, QTAGS.cfo), capex: bestQuarters(f, QTAGS.capex), cash: instants(f, QTAGS.cash), debt, recv: instants(f, QTAGS.recv) };
}

const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const endOf = (h: string): string | null => { const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(String(h).trim()); return m && MON[m[1]] ? `${m[2]}-${MON[m[1]]}-28` : null; };
type Table = { headers: string[]; rows: Record<string, (number | null)[]> };
const rowOf = (t: Table | null | undefined, ...labels: string[]): (number | null)[] | null => {
  if (!t) return null;
  for (const l of labels) { const k = Object.keys(t.rows || {}).find((x) => x.replace(/\s+/g, ' ').toLowerCase() === l.toLowerCase()); if (k) return t.rows[k]; }
  return null;
};
/** India: quarterly sales / operating profit / cost of sales from the kept screener.in page; cash flow and debt per year. */
export function inQuarterInputs(raw: any): QIn {
  const Q: Table | null = raw?.T?.q ?? null;
  const rev: CfQuarter[] = [], gp: CfQuarter[] = [], op: CfQuarter[] = [];
  if (Q?.headers?.length) {
    const s = rowOf(Q, 'Sales', 'Revenue'), o = rowOf(Q, 'Operating Profit', 'Financing Profit');
    Q.headers.forEach((h, i) => {
      const e = endOf(h); if (!e) return;
      const st = new Date(dt(e) - 90 * DAY).toISOString().slice(0, 10);
      const sv = s && fin(s[i]) ? s[i]! : null;
      if (sv != null) rev.push({ s: st, e, v: sv, d: 0 });
      if (o && fin(o[i])) op.push({ s: st, e, v: o[i]!, d: 0 });
      const cogs = raw?.cogsQ?.[h];
      if (sv != null && fin(cogs) && cogs >= 1) gp.push({ s: st, e, v: (sv * (100 - cogs)) / 100, d: 1 });
    });
  }
  const A: Table | null = raw?.T?.a ?? null, CF: Table | null = raw?.T?.cf ?? null, BS: Table | null = raw?.T?.bs ?? null;
  const yearly: QIn['yearly'] = { ends: [], labels: [], cfo: [], inv: [], fcf: [], cash: [], debt: [], rev: [] };
  if (A?.headers?.length) {
    const sales = rowOf(A, 'Sales', 'Revenue'), cfo = rowOf(CF, 'Cash from Operating Activity'), cfi = rowOf(CF, 'Cash from Investing Activity'), bor = rowOf(BS, 'Borrowings', 'Borrowing');
    const at = (t: Table | null, r: (number | null)[] | null, h: string) => { if (!t || !r) return null; const i = t.headers.indexOf(h); return i >= 0 && fin(r[i]) ? r[i] : null; };
    A.headers.forEach((h, i) => {
      const e = endOf(h); if (!e) return;
      const c = at(CF, cfo, h), v = at(CF, cfi, h);
      yearly.ends.push(e); yearly.labels.push(h);
      yearly.cfo.push(c); yearly.inv.push(v); yearly.fcf.push(fin(c) && fin(v) ? c + v : null);
      yearly.cash.push(fin(raw?.cash?.[h]) ? raw.cash[h] : null); yearly.debt.push(at(BS, bor, h)); yearly.rev.push(sales && fin(sales[i]) ? sales[i] : null);
    });
  }
  return { basis: 'yearly', rev, gp, op, cfo: [], capex: [], cash: new Map(), debt: new Map(), recv: new Map(), yearly };
}

// ── report ─────────────────────────────────────────────────────────────────
const near = (qs: CfQuarter[], e: string, tolDays = 20) => qs.find((q) => Math.abs(dt(q.e) - dt(e)) <= tolDays * DAY) ?? null;
const yearBefore = (qs: CfQuarter[], e: string) => near(qs, new Date(dt(e) - 365 * DAY).toISOString().slice(0, 10), 25);
const g = (a: number | null | undefined, b: number | null | undefined) => (fin(a) && fin(b) && b > 0 ? r1((a / b - 1) * 100) : null);
const instAt = (m: Map<string, number>, e: string, tol = 20): number | null => {
  let best: number | null = null, bd = Infinity;
  for (const [k, v] of m) { const d = Math.abs(dt(k) - dt(e)); if (d <= tol * DAY && d < bd) { bd = d; best = v; } }
  return best;
};
const pctTxt = (v: number | null) => (v == null ? 'not known' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
const trendOf = (now: number | null, then: number | null): 'up' | 'down' | 'flat' | 'unknown' => (now == null || then == null ? 'unknown' : now - then >= 1 ? 'up' : then - now >= 1 ? 'down' : 'flat');

export function quarterReport(q: QIn, rows: AnnualRow[]): QuarterReport {
  // quarters: revenue YoY + margins
  const last = q.rev.slice(-8);
  const points: QPoint[] = last.map((x) => {
    const yb = yearBefore(q.rev, x.e);
    const gpq = near(q.gp, x.e, 5), opq = near(q.op, x.e, 5);
    return {
      e: x.e, label: qLabel(x.e, q.basis), rev: r1(x.v), revYoY: yb ? g(x.v, yb.v) : null,
      gm: gpq && x.v > 0 ? r1((gpq.v / x.v) * 100) : null, om: opq && x.v > 0 ? r1((opq.v / x.v) * 100) : null,
    };
  });
  const yoy = points.map((p) => p.revYoY);
  const lastYoY = [...yoy].reverse().find(fin) ?? null;
  const known = yoy.filter(fin) as number[];
  let accel: QuarterReport['accel'];
  if (known.length < 2) accel = { state: 'unknown', text: 'needs two quarters with a year-earlier quarter', last: yoy.slice(-4) };
  else {
    const a = known[known.length - 1], b = known[known.length - 2], c = known.length >= 3 ? known[known.length - 3] : null;
    const state = a - b >= 2 && (c == null || b >= c - 2) ? 'accelerating' : b - a >= 2 && (c == null || c >= b - 2) ? 'decelerating' : 'steady';
    accel = { state, text: `${known.slice(-4).map((v) => pctTxt(v)).join(' → ')} (quarter vs same quarter a year earlier)`, last: yoy.slice(-4) };
  }
  // FCF margin: last four quarters, else the latest full year
  let fcfMargin: number | null = null, fcfFrom = 'not known';
  if (q.basis === 'quarterly') {
    const c = ttmSum(q.cfo), x = c ? ttmSum(q.capex, c.e) : null, r = c ? ttmSum(q.rev, c.e) : null;
    if (c && x && r && r.v > 0 && !x.parts.some((p) => p.v < 0)) { fcfMargin = r1(((c.v - x.v) / r.v) * 100); fcfFrom = `last 4 quarters to ${c.e}`; }
  }
  if (fcfMargin == null) {
    const L = [...rows].reverse().find((r) => fin(r.fcf) && fin(r.revenue) && r.revenue! > 0);
    if (L) { fcfMargin = r1((L.fcf! / L.revenue!) * 100); fcfFrom = `full year ${L.label}${L.fcfApprox ? ' (≈ operating cash)' : ''}${q.basis === 'yearly' ? ' — operating + investing cash' : ''}`; }
  }
  const r40 = { value: lastYoY != null && fcfMargin != null ? r1(lastYoY + fcfMargin) : null, revYoY: lastYoY, fcfMargin, fcfFrom, quarter: [...points].reverse().find((p) => p.revYoY != null)?.label ?? null };
  // margins: now vs the same quarter a year earlier
  const marg = (k: 'gm' | 'om') => {
    const p = [...points].reverse().find((x) => fin(x[k]));
    const prev = p ? points.find((x) => Math.abs(dt(x.e) - (dt(p.e) - 365 * DAY)) <= 25 * DAY) : null;
    const now = p ? p[k] : null, ya = prev ? prev[k] : null;
    return { now, yearAgo: ya ?? null, trend: trendOf(now, ya ?? null), label: p?.label ?? '—' };
  };
  return { basis: q.basis, points, r40, accel, gm: marg('gm'), om: marg('om'), squeeze: squeeze(q), dilution: dilution(rows), cfoPat: cfoPat(rows), de: deOf(rows) };
}

function qLabel(e: string, basis: string): string {
  const d = new Date(dt(e));
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}${basis === 'yearly' ? '' : ''}`;
}

/** The six-figure working-capital squeeze check + three ratios. */
export function squeeze(q: QIn): QuarterReport['squeeze'] {
  const items: SqueezeItem[] = [];
  const add = (id: string, label: string, warn: boolean | null, value: string, why: string) => items.push({ id, label, state: warn == null ? 'unknown' : warn ? 'warn' : 'ok', value, why });
  let capexToOcf: number | null = null, runwayQ: number | null = null, recvG: number | null = null, revG: number | null = null, period = '';
  if (q.basis === 'quarterly') {
    const c = ttmSum(q.cfo), c0 = c ? ttmSum(q.cfo, new Date(dt(c.e) - 365 * DAY).toISOString().slice(0, 10)) : null;
    const x = c ? ttmSum(q.capex, c.e) : null, x0 = c0 ? ttmSum(q.capex, c0.e) : null;
    const f = c && x ? c.v - x.v : null, f0 = c0 && x0 ? c0.v - x0.v : null;
    const lastE = c?.e ?? [...q.cash.keys()].sort().pop() ?? null;
    period = lastE ? `last 4 quarters to ${lastE} vs the 4 before` : 'quarterly filings';
    const cashNow = lastE ? instAt(q.cash, lastE) : null, cashYa = lastE ? instAt(q.cash, new Date(dt(lastE) - 365 * DAY).toISOString().slice(0, 10), 25) : null;
    const cg = g(cashNow, cashYa);
    add('cash', 'Cash balance', cg == null ? null : cg <= -25, cg == null ? 'not known' : `${pctTxt(cg)} in a year`, 'Cash and equivalents now vs a year earlier; a fall of a quarter or more is a warning.');
    const xg = x && x0 && x0.v > 0 ? r1((x.v / x0.v - 1) * 100) : null, cgx = c && c0 && c0.v > 0 ? r1((c.v / c0.v - 1) * 100) : null;
    add('capex', 'Capex', xg == null ? null : xg >= 50 && (cgx == null || cgx < xg / 2 || (f ?? 0) < 0), xg == null ? 'not known' : `capex ${pctTxt(xg)}${cgx != null ? `, operating cash ${pctTxt(cgx)}` : ''}`, 'Capital spending up 50%+ while operating cash grows far less (or free cash flow is negative).');
    add('ocf', 'Operating cash flow', c && c0 ? c.v < c0.v * 0.95 || c.v < 0 : null, c && c0 ? `${fmt(c.v)} vs ${fmt(c0.v)} a year before` : 'not known', 'Cash from operations over the last four quarters vs the four before.');
    add('fcf', 'Free cash flow', f != null && f0 != null ? f < f0 && (f < 0 || f < f0 * 0.8) : null, f != null && f0 != null ? `${fmt(f)} vs ${fmt(f0)} a year before` : 'not known', 'Operating cash − capex over four quarters; a deeper burn or a fall of 20%+ is a warning.');
    const dNow = lastE ? instAt(q.debt, lastE) : null, dYa = lastE ? instAt(q.debt, new Date(dt(lastE) - 365 * DAY).toISOString().slice(0, 10), 25) : null;
    const dg = dYa != null && dNow != null ? (dYa > 0 ? r1((dNow / dYa - 1) * 100) : dNow > 0 ? 100 : 0) : null;
    add('debt', 'Debt', dg == null ? null : dg >= 30 && (dNow ?? 0) > 0, dg == null ? 'not known' : `${pctTxt(dg)} in a year`, 'Total debt now vs a year earlier; 30%+ more borrowing is a warning (more so alongside cash burn).');
    // receivables vs revenue, latest quarter vs the same quarter a year earlier
    const rq = q.rev[q.rev.length - 1], rq0 = rq ? yearBefore(q.rev, rq.e) : null;
    revG = rq && rq0 ? g(rq.v, rq0.v) : null;
    const rcN = rq ? instAt(q.recv, rq.e) : null, rcY = rq ? instAt(q.recv, new Date(dt(rq.e) - 365 * DAY).toISOString().slice(0, 10), 25) : null;
    recvG = g(rcN, rcY);
    add('recv', 'Receivables vs revenue', recvG == null || revG == null ? null : recvG - revG >= 20, recvG == null ? 'not known' : `receivables ${pctTxt(recvG)} vs revenue ${pctTxt(revG)}`, 'Customers paying more slowly: receivables growing 20+ points faster than sales.');
    capexToOcf = c && x && c.v > 0 ? r1((x.v / c.v) * 100) : null;
    runwayQ = f != null && f < 0 && cashNow != null ? r1(cashNow / (-f / 4)) : null;
  } else if (q.yearly && q.yearly.ends.length >= 2) {
    const Y = q.yearly, n = Y.ends.length - 1, p = n - 1;
    period = `full years ${Y.labels[p]} → ${Y.labels[n]} (India: cash flow and balance sheet are yearly)`;
    const cg = g(Y.cash[n], Y.cash[p]);
    add('cash', 'Cash balance', cg == null ? null : cg <= -25, cg == null ? 'not known' : `${pctTxt(cg)} in a year`, 'Cash and equivalents at the year end vs the year before.');
    const inv = Y.inv[n], inv0 = Y.inv[p];
    const ig = fin(inv) && fin(inv0) && inv0 < 0 ? r1((inv / inv0 - 1) * 100) : null;
    add('capex', 'Investing spend', ig == null ? null : ig >= 50 && (Y.fcf[n] ?? 0) < 0, ig == null ? 'not known' : `investing outflow ${ig >= 0 ? 'up' : 'down'} ${Math.abs(ig).toFixed(0)}%`, 'screener.in prints no capex line, so the whole investing outflow is used (it includes acquisitions and investments).');
    add('ocf', 'Operating cash flow', fin(Y.cfo[n]) && fin(Y.cfo[p]) ? Y.cfo[n]! < Y.cfo[p]! * 0.95 || Y.cfo[n]! < 0 : null, fin(Y.cfo[n]) && fin(Y.cfo[p]) ? `${fmt(Y.cfo[n]!)} vs ${fmt(Y.cfo[p]!)}` : 'not known', 'Cash from operations this year vs last.');
    add('fcf', 'Free cash flow', fin(Y.fcf[n]) && fin(Y.fcf[p]) ? Y.fcf[n]! < Y.fcf[p]! && (Y.fcf[n]! < 0 || Y.fcf[n]! < Y.fcf[p]! * 0.8) : null, fin(Y.fcf[n]) && fin(Y.fcf[p]) ? `${fmt(Y.fcf[n]!)} vs ${fmt(Y.fcf[p]!)}` : 'not known', 'Operating + investing cash (approximation).');
    const dg = fin(Y.debt[n]) && fin(Y.debt[p]) ? (Y.debt[p]! > 0 ? r1((Y.debt[n]! / Y.debt[p]! - 1) * 100) : Y.debt[n]! > 0 ? 100 : 0) : null;
    add('debt', 'Debt', dg == null ? null : dg >= 30 && (Y.debt[n] ?? 0) > 0, dg == null ? 'not known' : `${pctTxt(dg)} in a year`, 'Borrowings at the year end vs the year before.');
    revG = g(Y.rev[n], Y.rev[p]);
    add('recv', 'Receivables vs revenue', null, 'not on screener.in', 'Receivables are not kept for India companies.');
    capexToOcf = fin(Y.cfo[n]) && Y.cfo[n]! > 0 && fin(inv) && inv < 0 ? r1((-inv / Y.cfo[n]!) * 100) : null;
    runwayQ = fin(Y.fcf[n]) && Y.fcf[n]! < 0 && fin(Y.cash[n]) ? r1(Y.cash[n]! / (-Y.fcf[n]! / 4)) : null;
  }
  const warns = items.filter((i) => i.state === 'warn').length, knownN = items.filter((i) => i.state !== 'unknown').length;
  const keyCombo = ['capex', 'fcf', 'cash'].every((id) => items.find((i) => i.id === id)?.state === 'warn');
  const level = knownN < 3 ? 'Unknown' : warns >= 3 || keyCombo ? 'High' : warns === 2 ? 'Watch' : 'Low';
  return { items, warns, known: knownN, level, keyCombo, ratios: { capexToOcf, runwayQ, recvG, revG }, period };
}

function fmt(v: number): string { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1000 ? `${s}${(a / 1000).toFixed(1)}k` : `${s}${a.toFixed(a >= 100 ? 0 : 1)}`; }

/** Share count change over (up to) three years: diluted shares (USA) or profit ÷ EPS (India, an estimate). */
export function dilution(rows: AnnualRow[]): QuarterReport['dilution'] {
  const sh = rows.map((r) => ({ l: r.label, v: fin(r.shares) && r.shares! > 0 ? r.shares! : fin(r.sharesEst) && r.sharesEst! > 0 ? r.sharesEst! : null })).filter((x) => x.v != null) as Array<{ l: string; v: number }>;
  if (sh.length < 2) return { pct: null, years: 0, perYear: null, text: 'share counts not known' };
  const last = sh[sh.length - 1], first = sh[Math.max(0, sh.length - 4)];
  const yrs = Math.min(3, sh.length - 1);
  const pct = r1((last.v / first.v - 1) * 100);
  const perYear = r1((Math.pow(last.v / first.v, 1 / yrs) - 1) * 100);
  const est = rows.some((r) => r.shares == null && r.sharesEst != null);
  // profit ÷ EPS breaks on a bonus issue / split / listing (screener.in does not restate old EPS): a jump of 60%+ is not read as dilution
  if (est && Math.abs(pct) >= 60) return { pct: null, years: yrs, perYear: null, text: `share count estimate jumped ${pct > 0 ? '+' : ''}${pct}% ${first.l} → ${last.l} — likely a bonus issue, split or listing (profit ÷ EPS), not read as dilution` };
  return { pct, years: yrs, perYear, text: `${pct > 0 ? '+' : ''}${pct}% shares ${first.l} → ${last.l} (${perYear > 0 ? '+' : ''}${perYear}% a year)${est ? ' — estimated from profit ÷ EPS' : ''}${pct >= 10 ? ' · diluting' : pct <= -3 ? ' · buying back' : ''}` };
}
export function cfoPat(rows: AnnualRow[]): QuarterReport['cfoPat'] {
  const ok = rows.filter((r) => fin(r.cfo) && fin(r.netIncome));
  const L = ok[ok.length - 1];
  const latest = L && L.netIncome! > 0 ? Math.round((L.cfo! / L.netIncome!) * 100) / 100 : null;
  const t3 = ok.slice(-3), sp = t3.reduce((a, r) => a + r.netIncome!, 0), sc = t3.reduce((a, r) => a + r.cfo!, 0);
  const three = t3.length === 3 && sp > 0 ? Math.round((sc / sp) * 100) / 100 : null;
  return { latest, three, text: L ? (L.netIncome! <= 0 ? `loss in ${L.label} — ratio not meaningful` : `${latest}× in ${L.label}${three != null ? `, ${three}× over 3 years` : ''}`) : 'not known' };
}
export function deOf(rows: AnnualRow[]): QuarterReport['de'] {
  const L = [...rows].reverse().find((r) => fin(r.equity) || fin(r.debt));
  if (!L || !fin(L.equity)) return { value: null, text: 'equity not reported' };
  if (L.equity! <= 0) return { value: null, text: `negative equity (${L.label})` };
  if (!fin(L.debt)) return { value: null, text: `no debt line found in the ${L.label} filing (debt may be tagged under another name — check the balance sheet)` };
  const v = Math.round((L.debt! / L.equity!) * 100) / 100;
  return { value: v, text: `${v}× (${L.label})` };
}

/**
 * zzz1291 — "cash up, price flat": free cash flow per share up 30%+ over (up to) three full years while the share price
 * (today vs the start year's year-end) moved less than +10%. A research lead, never a buy reading — the market may be
 * expecting weaker economics ahead.
 */
export function fcfPriceGap(years: Array<{ label: string; fcfPs: number | null; priceAtEnd: number | null }>, priceNow: number | null): { fcfPsG: number | null; priceG: number | null; from: string | null; flag: boolean; short: string; why: string } {
  const ys = years.filter((y) => fin(y.fcfPs));
  if (ys.length < 2) return { fcfPsG: null, priceG: null, from: null, flag: false, short: 'too few years', why: 'needs at least two years with free cash flow per share' };
  const l = ys[ys.length - 1], f = ys[Math.max(0, ys.length - 4)];
  if (!(l.fcfPs! > 0) || !(f.fcfPs! > 0)) return { fcfPsG: null, priceG: null, from: f.label, flag: false, short: l.fcfPs! <= 0 ? 'FCF negative' : 'FCF was negative', why: `free cash flow per share ${f.label} ${f.fcfPs} → ${l.label} ${l.fcfPs}: a change from or to a negative figure is not a growth rate` };
  const last = ys[ys.length - 1], first = ys[Math.max(0, ys.length - 4)];
  const fcfPsG = first.fcfPs! > 0 && last.fcfPs! > 0 ? r1((last.fcfPs! / first.fcfPs! - 1) * 100) : null;
  const p0 = first.priceAtEnd, p1 = fin(priceNow) ? priceNow : last.priceAtEnd;
  const priceG = fin(p0) && fin(p1) && p0 > 0 ? r1((p1 / p0 - 1) * 100) : null;
  return { fcfPsG, priceG, from: first.label, flag: fcfPsG != null && priceG != null && fcfPsG >= 30 && priceG <= 10, short: '—', why: priceG == null ? `no share price at the ${first.label} year end (listed later)` : '' };
}
