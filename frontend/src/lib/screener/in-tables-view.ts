// zzz1277 — the yearly tables of a screener.in company page in the shape /api/earnings/india-screener has always returned.
//   Used by the live page read AND by the stored path (?stored=1), which reads the page our own stock-screener build keeps
//   (screener_store, kind 'fund') instead of fetching screener.in at request time. Pure.
export interface ScreenerTable { headers: string[]; rows: Record<string, (number | null)[]> }

/** A row by label, ignoring case and extra spaces (stored pages keep the label as printed). */
function rowOf(t: ScreenerTable, ...labels: string[]): (number | null)[] | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const l of labels) {
    const k = Object.keys(t.rows).find((x) => norm(x) === norm(l));
    if (k) return t.rows[k];
  }
  return null;
}
const at = (row: (number | null)[] | null, i: number): number | null => (row && typeof row[i] === 'number' && Number.isFinite(row[i] as number) ? (row[i] as number) : null);

export function annualView(t: ScreenerTable | null) {
  if (!t) return [];
  const sales = rowOf(t, 'Sales', 'Revenue'), op = rowOf(t, 'Operating Profit', 'Financing Profit'), opm = rowOf(t, 'OPM %', 'Financing Margin %');
  const np = rowOf(t, 'Net Profit', 'Net profit'), eps = rowOf(t, 'EPS in Rs');
  return t.headers.map((period, i) => ({ period, sales: at(sales, i), operatingProfit: at(op, i), opmPct: at(opm, i), netProfit: at(np, i), eps: at(eps, i) }));
}
export function balanceSheetView(t: ScreenerTable | null) {
  if (!t) return [];
  const r = (...l: string[]) => rowOf(t, ...l);
  const eq = r('Equity Capital'), res = r('Reserves'), bor = r('Borrowings', 'Borrowing'), ol = r('Other Liabilities'), tl = r('Total Liabilities');
  const fa = r('Fixed Assets', 'Net Block'), inv = r('Investments'), oa = r('Other Assets'), ta = r('Total Assets');
  return t.headers.map((period, i) => ({
    period, equityCapital: at(eq, i), reserves: at(res, i), borrowings: at(bor, i), otherLiabilities: at(ol, i), totalLiabilities: at(tl, i),
    fixedAssets: at(fa, i), investments: at(inv, i), otherAssets: at(oa, i), totalAssets: at(ta, i),
  }));
}
export function cashFlowView(t: ScreenerTable | null) {
  if (!t) return [];
  const o = rowOf(t, 'Cash from Operating Activity'), v = rowOf(t, 'Cash from Investing Activity'), f = rowOf(t, 'Cash from Financing Activity'), n = rowOf(t, 'Net Cash Flow');
  return t.headers.map((period, i) => ({ period, fromOperating: at(o, i), fromInvesting: at(v, i), fromFinancing: at(f, i), netChange: at(n, i) }));
}
export function ratiosView(t: ScreenerTable | null) {
  if (!t) return [];
  const d = rowOf(t, 'Debtor Days'), inv = rowOf(t, 'Inventory Days'), p = rowOf(t, 'Days Payable'), c = rowOf(t, 'Cash Conversion Cycle');
  const w = rowOf(t, 'Working Capital Days'), roce = rowOf(t, 'ROCE %');
  return t.headers.map((period, i) => ({ period, debtorDays: at(d, i), inventoryDays: at(inv, i), daysPayable: at(p, i), cashConversionCycle: at(c, i), workingCapitalDays: at(w, i), roce: at(roce, i) }));
}

/** The stored-page answer: same keys as the live answer for the yearly tables; quarterly / top metrics the stored page does not keep are left out. */
export function storedTablesAnswer(symbol: string, raw: any, storedAt: string | null) {
  const T = raw?.T || {};
  return {
    ok: true, ticker: symbol, source: 'stored', unit: 'INR_Cr',
    sourceNote: `Our stock-screener copy of the screener.in page${storedAt ? ` (read ${storedAt.slice(0, 10)})` : ''} — no live screener.in request`,
    company: raw?.name ?? null, sector: raw?.sector ?? null, industry: raw?.industry ?? null,
    topMetrics: { marketCap: raw?.mcapCr ?? null, currentPrice: raw?.price ?? null, roce: raw?.roce ?? null, dividendYieldPct: null, peRatio: null },
    annual: annualView(T.a ?? null), balanceSheet: balanceSheetView(T.bs ?? null), cashFlow: cashFlowView(T.cf ?? null), ratios: ratiosView(T.r ?? null),
  };
}
