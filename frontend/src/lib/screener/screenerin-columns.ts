// ═══════════════════════════════════════════════════════════════════════════
// zzz1234 — SCREENER.IN EXPORT COLUMNS FROM OUR OWN DATA. Pure.
//
// The owner (7 Nov 2026): "like the TradingView replacement, bring the
// screener.in screens into our portal so the Sync Screener.in CSVs job is not
// needed; Multibagger and the others must read our screener."
//
// The Multibagger India analyser, Fundamentals, Turnarounds, Volume Pockets …
// read screener.in's export (63 named columns). This module writes the same
// columns for one company from what our Stock Screener already holds: the
// boiled-down screener.in page (InRaw — quarters, years, balance sheet, cash
// flow, ratios, shareholding) and the snapshot row (price, returns, averages).
// A column we cannot work out honestly is left EMPTY (the analysers treat an
// empty cell as "not known"); none is guessed. Empty today: ROIC, pledged %,
// historical P/E 5 years, GPM latest quarter when no expense split is filed.
// ═══════════════════════════════════════════════════════════════════════════
import type { InRaw } from './in-assemble';

export const SCREENERIN_COLUMNS = [
  'Name', 'BSE Code', 'NSE Code', 'ISIN Code', 'Industry Group', 'Industry', 'Current Price', 'Market Capitalization',
  'YOY Quarterly profit growth', 'YOY Quarterly sales growth', 'Return over 3months', 'Price to Earning', 'Return over 1year',
  'Debt to equity', 'CFO to PAT', 'PEG Ratio', 'Sales growth', 'Profit growth', 'Promoter holding', 'Return on invested capital',
  'Return on capital employed', 'OPM', 'Free cash flow last year', 'Debt', 'EPS', 'DII holding', 'FII holding', 'Sales growth 3Years',
  'Average return on capital employed 3Years', 'Pledged percentage', 'EVEBITDA', 'From 52w high', 'GPM latest quarter', 'Industry PE',
  'Price to book value', 'Working Capital Days', 'Average Working Capital Days 3years', 'Interest Coverage Ratio',
  'Change in FII holding 3Years', 'Change in DII holding 3Years', 'Sales preceding quarter', 'Sales latest quarter',
  'Profit after tax latest quarter', 'Profit growth 3Years', 'Sales 2quarters back', 'Sales 3quarters back', 'OPM latest quarter',
  'Net profit 2quarters back', 'Net profit 3quarters back', 'Profit after tax preceding quarter', 'Change in promoter holding 3Years',
  'Debt 3Years back', 'Historical PE 5Years', 'OPM last year', 'OPM preceding year', 'OPM 5Year', 'OPM preceding quarter',
  'Book value', 'EBIT', 'Enterprise Value', 'DMA 200', 'DMA 50', 'Change in FII holding',
] as const;
export type ScreenerInColumn = typeof SCREENERIN_COLUMNS[number];
export type ScreenerInRow = Partial<Record<ScreenerInColumn, number | string | null>>;

type Table = { headers: string[]; rows: Record<string, (number | null)[]> } | null | undefined;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;
function row(t: Table, ...labels: string[]): (number | null)[] {
  if (!t) return [];
  for (const l of labels) { const k = Object.keys(t.rows).find((x) => x.replace(/\s+/g, ' ').toLowerCase() === l); if (k) return t.rows[k]; }
  return [];
}
/** Annual tables end with a 'TTM' column on screener.in; the fiscal years are the columns before it. */
function yearCols(t: Table): number[] {
  if (!t) return [];
  return t.headers.map((h, i) => ({ h, i })).filter((x) => /^[A-Z][a-z]{2} \d{4}$/.test(x.h.trim())).map((x) => x.i);
}
const last = (a: (number | null)[], idx: number[], back = 0): number | null => { const i = idx[idx.length - 1 - back]; return i == null ? null : fin(a[i]) ? (a[i] as number) : null; };
const growth = (now: number | null, before: number | null) => (fin(now) && fin(before) && before > 0 ? r2(((now - before) / before) * 100) : fin(now) && fin(before) && before < 0 && now < 0 ? r2(((now - before) / Math.abs(before)) * 100) : null);
const cagr = (now: number | null, before: number | null, yrs: number) => (fin(now) && fin(before) && now > 0 && before > 0 ? r2((Math.pow(now / before, 1 / yrs) - 1) * 100) : null);
const lastN = (a: (number | null)[] | undefined, n = 0): number | null => { if (!a) return null; const f = a.map((v, i) => ({ v, i })).filter((x) => fin(x.v)); const x = f[f.length - 1 - n]; return x ? (x.v as number) : null; };

/** The screener.in columns for one company. `row` = the stock-screener snapshot row; `industryPe` = median P/E of its industry. */
export function screenerInColumns(raw: InRaw | null | undefined, r: any, industryPe: number | null = null): ScreenerInRow {
  const o: ScreenerInRow = {};
  const t = String(r?.t || '');
  o['Name'] = r?.n ?? raw?.name ?? t;
  o['NSE Code'] = /^\d+$/.test(t) ? '' : t;
  o['BSE Code'] = /^\d{6}$/.test(t) ? t : '';
  o['ISIN Code'] = '';
  o['Industry Group'] = r?.sec ?? raw?.sector ?? '';
  o['Industry'] = r?.ind ?? raw?.industry ?? '';
  const px = fin(r?.px) ? r.px : raw?.price ?? null;
  o['Current Price'] = px;
  o['Market Capitalization'] = fin(r?.mc) ? r.mc : raw?.mcapCr ?? null;
  o['YOY Quarterly sales growth'] = fin(r?.revQYoY) ? r.revQYoY : null;
  o['Return over 3months'] = fin(r?.perf3M) ? r.perf3M : null;
  o['Return over 1year'] = fin(r?.perf1Y) ? r.perf1Y : null;
  o['Price to Earning'] = fin(r?.pe) ? r.pe : null;
  o['Debt to equity'] = fin(r?.de) ? r.de : fin(r?.deFY) ? r.deFY : null;
  o['Sales growth'] = fin(r?.revAYoY) ? r.revAYoY : null;
  o['Return on capital employed'] = fin(r?.roceFY) ? r.roceFY : null;
  o['OPM'] = fin(r?.opmTTM) ? r.opmTTM : fin(r?.opmFY) ? r.opmFY : null;
  o['From 52w high'] = fin(px) && fin(r?.hi52) && r.hi52 > 0 ? r2(px / r.hi52) : null;
  o['DMA 200'] = fin(r?.sma200) ? r2(r.sma200) : null;
  o['DMA 50'] = fin(r?.sma50) ? r2(r.sma50) : null;
  o['Promoter holding'] = fin(r?.prom) ? r.prom : raw?.shp?.prom ?? null;
  o['Industry PE'] = fin(industryPe) ? r2(industryPe) : null;
  if (!raw) return o;

  const { q: Q, a: A, bs: BS, cf: CF, r: R } = raw.T;
  // quarters (oldest → newest)
  const qs = row(Q, 'sales', 'revenue'), qp = row(Q, 'net profit'), qop = row(Q, 'operating profit', 'financing profit');
  const qi = Q ? Q.headers.map((_h, i) => i).filter((i) => fin(qs[i]) || fin(qp[i])) : [];
  const qv = (a: (number | null)[], back: number) => { const i = qi[qi.length - 1 - back]; return i != null && fin(a[i]) ? (a[i] as number) : null; };
  o['Sales latest quarter'] = qv(qs, 0); o['Sales preceding quarter'] = qv(qs, 1); o['Sales 2quarters back'] = qv(qs, 2); o['Sales 3quarters back'] = qv(qs, 3);
  o['Profit after tax latest quarter'] = qv(qp, 0); o['Profit after tax preceding quarter'] = qv(qp, 1); o['Net profit 2quarters back'] = qv(qp, 2); o['Net profit 3quarters back'] = qv(qp, 3);
  o['YOY Quarterly profit growth'] = growth(qv(qp, 0), qv(qp, 4));
  const qopm = (back: number) => { const s = qv(qs, back), p = qv(qop, back); return fin(s) && s > 0 && fin(p) ? r2((p / s) * 100) : null; };
  o['OPM latest quarter'] = qopm(0); o['OPM preceding quarter'] = qopm(1);
  const lastQ = Q && qi.length ? Q.headers[qi[qi.length - 1]] : null;
  const cq = lastQ ? raw.cogsQ?.[lastQ] : undefined;
  o['GPM latest quarter'] = fin(cq) && cq >= 1 && cq < 100 ? r2(100 - cq) : null;
  const qeps = row(Q, 'eps in rs');
  const e4 = [0, 1, 2, 3].map((b) => qv(qeps, b));
  o['EPS'] = e4.every(fin) ? r2((e4 as number[]).reduce((s, v) => s + v, 0)) : null;

  // years
  const yi = yearCols(A);
  const as = row(A, 'sales', 'revenue'), ap = row(A, 'net profit'), aop = row(A, 'operating profit', 'financing profit');
  const aint = row(A, 'interest'), adep = row(A, 'depreciation'), apbt = row(A, 'profit before tax');
  o['Profit growth'] = growth(last(ap, yi), last(ap, yi, 1));
  o['Sales growth 3Years'] = cagr(last(as, yi), last(as, yi, 3), 3);
  o['Profit growth 3Years'] = cagr(last(ap, yi), last(ap, yi, 3), 3);
  const opmY = (back: number) => { const s = last(as, yi, back), p = last(aop, yi, back); return fin(s) && s > 0 && fin(p) ? r2((p / s) * 100) : null; };
  o['OPM last year'] = opmY(0); o['OPM preceding year'] = opmY(1);
  const op5 = [0, 1, 2, 3, 4].map(opmY).filter(fin);
  o['OPM 5Year'] = op5.length >= 3 ? r2(op5.reduce((s, v) => s + v, 0) / op5.length) : null;
  const pbtY = last(apbt, yi), intY = last(aint, yi);
  const ebit = fin(pbtY) && fin(intY) ? pbtY + intY : null;
  o['EBIT'] = fin(ebit) ? r2(ebit) : null;
  o['Interest Coverage Ratio'] = fin(ebit) && fin(intY) && intY > 0 ? r2(ebit / intY) : null;
  const pg3 = o['Profit growth 3Years'];
  o['PEG Ratio'] = fin(o['Price to Earning']) && fin(pg3) && pg3 > 0 ? r2((o['Price to Earning'] as number) / pg3) : null;

  // balance sheet
  const bi = yearCols(BS).length ? yearCols(BS) : (BS ? BS.headers.map((_h, i) => i) : []);
  const borrow = row(BS, 'borrowings', 'borrowing'), eqc = row(BS, 'equity capital'), res = row(BS, 'reserves');
  const debt = last(borrow, bi);
  o['Debt'] = debt; o['Debt 3Years back'] = last(borrow, bi, 3);
  const equity = fin(last(eqc, bi)) && fin(last(res, bi)) ? (last(eqc, bi) as number) + (last(res, bi) as number) : null;
  const shares = fin(raw.mcapCr) && fin(raw.price) && raw.price > 0 ? raw.mcapCr / raw.price : null;   // crore shares
  const bv = fin(equity) && fin(shares) && shares > 0 ? equity / shares : null;
  o['Book value'] = fin(bv) ? r2(bv) : null;
  o['Price to book value'] = fin(bv) && bv > 0 && fin(px) ? r2(px / bv) : null;
  const mc = o['Market Capitalization'];
  const cashNow = fin(r?.cash) ? r.cash : null;
  const ev = fin(mc) ? mc + (fin(debt) ? debt : 0) - (fin(cashNow) ? cashNow : 0) : null;
  o['Enterprise Value'] = fin(ev) ? r2(ev) : null;
  const ebitda = fin(last(aop, yi)) ? (last(aop, yi) as number) : null;
  o['EVEBITDA'] = fin(ev) && fin(ebitda) && ebitda > 0 ? r2(ev / ebitda) : null;

  // cash flow
  const ci = yearCols(CF).length ? yearCols(CF) : (CF ? CF.headers.map((_h, i) => i) : []);
  const cfo = last(row(CF, 'cash from operating activity'), ci), cfi = last(row(CF, 'cash from investing activity'), ci);
  const patY = last(ap, yi);
  o['CFO to PAT'] = fin(cfo) && fin(patY) && patY > 0 ? r2(cfo / patY) : null;
  o['Free cash flow last year'] = fin(cfo) && fin(cfi) ? r2(cfo + cfi) : null;   // ≈ — screener.in's own FCF uses capex only; the page has no capex line

  // ratios
  const ri = R ? R.headers.map((_h, i) => i) : [];
  const roce = row(R, 'roce %'), wcd = row(R, 'working capital days');
  const roce3 = [0, 1, 2].map((b) => last(roce, ri, b)).filter(fin);
  o['Average return on capital employed 3Years'] = roce3.length === 3 ? r2(roce3.reduce((s, v) => s + v, 0) / 3) : null;
  o['Working Capital Days'] = last(wcd, ri);
  const w3 = [0, 1, 2].map((b) => last(wcd, ri, b)).filter(fin);
  o['Average Working Capital Days 3years'] = w3.length === 3 ? r2(w3.reduce((s, v) => s + v, 0) / 3) : null;

  // shareholding
  const sh = raw.shpQ;
  if (sh) {
    const chg = (a: (number | null)[], back: number) => { const now = lastN(a), was = lastN(a, back); return fin(now) && fin(was) ? r2(now - was) : null; };
    o['FII holding'] = lastN(sh.fii); o['DII holding'] = lastN(sh.dii);
    if (o['Promoter holding'] == null) o['Promoter holding'] = lastN(sh.prom);
    o['Change in promoter holding 3Years'] = chg(sh.prom, 12); o['Change in FII holding 3Years'] = chg(sh.fii, 12); o['Change in DII holding 3Years'] = chg(sh.dii, 12);
    o['Change in FII holding'] = chg(sh.fii, 1);
  } else if (raw.shp) { o['FII holding'] = raw.shp.fii; o['DII holding'] = raw.shp.dii; }
  void adep;
  return o;
}

/** CSV text (screener.in's column order, numbers with 2 decimals, empty = not known). */
export function screenerInCsv(rows: ScreenerInRow[]): string {
  const esc = (v: unknown) => { if (v == null || v === '') return ''; if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [SCREENERIN_COLUMNS.join(','), ...rows.map((r) => SCREENERIN_COLUMNS.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

/** Median P/E per industry (positive P/E only), from the snapshot rows. */
export function industryPeMap(rows: ReadonlyArray<any>): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of rows) if (r?.ind && fin(r.pe) && r.pe > 0 && r.pe < 500) by.set(r.ind, [...(by.get(r.ind) || []), r.pe]);
  const out = new Map<string, number>();
  for (const [k, v] of by) if (v.length >= 3) { const s = v.slice().sort((a, b) => a - b); out.set(k, s[Math.floor(s.length / 2)]); }
  return out;
}
