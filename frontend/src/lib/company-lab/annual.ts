// zzz1208 — yearly figures for Company Lab, worked out from what the portal already keeps. Pure.
//   USA: SEC company facts (the company's own XBRL): full fiscal years from the 10-K / 20-F (a fact covering 350–380 days),
//        the latest filed value per year end; a ladder of tags per figure, the first tag that has the year wins. $ million.
//   India: the screener.in company page kept by the stock-screener build (profit & loss, cash flow, balance sheet). ₹ crore.
//        screener.in prints no capex line, so FCF = operating cash + investing cash (an approximation, said on the page).
import type { AnnualRow } from './core';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const TAGS: Record<string, string[]> = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquirePropertyAndEquipment', 'PaymentsForCapitalImprovements'],
  sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  shares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'],
  debt: ['LongTermDebt', 'DebtLongtermAndShorttermCombinedAmount', 'LongTermDebtAndCapitalLeaseObligations'],   // these include the current part
  debtNonCur: ['LongTermDebtNoncurrent'],
  debtCur: ['LongTermDebtCurrent', 'DebtCurrent'],
};
// zzz1210 — foreign filers (20-F, IFRS: Spotify, ASML …) tag ifrs-full in their own currency
const IFRS: Record<string, string[]> = {
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
  netIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
  eps: ['DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare', 'BasicAndDilutedEarningsLossPerShare'],
  cfo: ['CashFlowsFromUsedInOperatingActivities'],
  capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PurchaseOfPropertyPlantAndEquipment'],
  sbc: ['ExpenseFromSharebasedPaymentTransactionsWithEmployees', 'AdjustmentsForSharebasedPayments', 'ExpenseFromSharebasedPaymentTransactions'],
  shares: ['AdjustedWeightedAverageShares', 'WeightedAverageShares'],
  debt: ['Borrowings', 'LongtermBorrowings'],
  debtNonCur: ['NoncurrentPortionOfNoncurrentBorrowings', 'NoncurrentBorrowings'],
  debtCur: ['CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings', 'CurrentBorrowings'],
};
/** 'us-gaap' with USD when the company tags US GAAP revenue, else 'ifrs-full' with the currency its revenue is tagged in. */
export function reportingBasis(facts: any): { tax: 'us-gaap' | 'ifrs-full'; cur: string } {
  const g = facts?.facts?.['us-gaap'] || {};
  if (TAGS.revenue.some((t) => g?.[t]?.units?.USD?.length) || TAGS.cfo.some((t) => g?.[t]?.units?.USD?.length)) return { tax: 'us-gaap', cur: 'USD' };
  const f = facts?.facts?.['ifrs-full'] || {};
  for (const t of [...IFRS.revenue, ...IFRS.cfo]) { const u = Object.keys(f?.[t]?.units || {})[0]; if (u) return { tax: 'ifrs-full', cur: u }; }
  return { tax: 'us-gaap', cur: 'USD' };
}
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const ANNUAL_FORMS = /^(10-K|10-K\/A|20-F|20-F\/A|40-F)$/;

/** end date → value for one figure, full fiscal years only (duration) or year-end values (instant). */
export function factYears(facts: any, tags: string[], unit: string, instant: boolean, tax: 'us-gaap' | 'ifrs-full' = 'us-gaap'): Map<string, number> {
  const out = new Map<string, number>();
  const gaap = facts?.facts?.[tax] || {};
  for (const tag of tags) {
    const items: any[] = gaap?.[tag]?.units?.[unit] || [];
    const best = new Map<string, { v: number; filed: string }>();
    for (const it of items) {
      if (!fin(it?.val) || typeof it?.end !== 'string' || !ANNUAL_FORMS.test(String(it?.form || ''))) continue;
      if (!instant) { if (typeof it.start !== 'string') continue; const d = days(it.start, it.end); if (d < 350 || d > 380) continue; }
      else if (it.fp && it.fp !== 'FY') continue;
      const cur = best.get(it.end);
      if (!cur || String(it.filed || '') > cur.filed) best.set(it.end, { v: it.val, filed: String(it.filed || '') });
    }
    for (const [end, x] of best) if (!out.has(end)) out.set(end, x.v);
  }
  return out;
}

/**
 * USA: the last `n` fiscal years, oldest first, $ million (EPS in $, shares in millions). A foreign filer's figures are in its
 * own currency (IFRS) and multiplied by `toUsd` (that currency → USD today; 1 when it already reports USD).
 */
export function usAnnualRows(facts: any, n = 10, toUsd = 1): AnnualRow[] {
  const { tax, cur } = reportingBasis(facts);
  const T = tax === 'us-gaap' ? TAGS : IFRS;
  const fx = Number.isFinite(toUsd) && toUsd > 0 ? toUsd : 1;
  const M = (v: number | undefined) => (fin(v) ? Math.round(((v * fx) / 1e6) * 10) / 10 : null);
  const rev = factYears(facts, T.revenue, cur, false, tax);
  const ni = factYears(facts, T.netIncome, cur, false, tax);
  const eps = factYears(facts, T.eps, `${cur}/shares`, false, tax);
  const cfo = factYears(facts, T.cfo, cur, false, tax);
  const cap = factYears(facts, T.capex, cur, false, tax);
  const sbc = factYears(facts, T.sbc, cur, false, tax);
  const sh = factYears(facts, T.shares, 'shares', false, tax);
  const debt = factYears(facts, T.debt, cur, true, tax);
  const debtC = factYears(facts, T.debtCur, cur, true, tax);
  const debtN = factYears(facts, T.debtNonCur, cur, true, tax);
  // the year ends come from revenue (else operating cash): a year with neither is not a fiscal year we can describe
  const ends = Array.from(new Set([...rev.keys(), ...cfo.keys()])).sort();
  // the same fiscal year can be tagged with an end a few days apart (52/53-week years): keep one end per ~year
  const kept: string[] = [];
  for (const e of ends) { if (kept.length && days(kept[kept.length - 1], e) < 300) kept[kept.length - 1] = e; else kept.push(e); }
  return kept.slice(-n).map((end) => {
    const c = cfo.get(end), x = cap.get(end);
    const d = debt.get(end), dn = debtN.get(end), dc = debtC.get(end);
    const totalDebt = fin(d) ? d : fin(dn) ? dn + (fin(dc) ? dc : 0) : null;
    return {
      end, label: `FY${end.slice(0, 4)}`,
      revenue: M(rev.get(end)), netIncome: M(ni.get(end)), eps: fin(eps.get(end)) ? Math.round(eps.get(end)! * fx * 100) / 100 : null,
      cfo: M(c), capex: M(x), fcf: fin(c) ? M(c - (fin(x) ? Math.abs(x) : 0)) : null,
      debt: totalDebt == null ? null : M(totalDebt),
      shares: fin(sh.get(end)) ? Math.round((sh.get(end)! / 1e6) * 100) / 100 : null,
      sbc: M(sbc.get(end)),
    };
  }).map((r) => (r.fcf != null && r.capex == null ? { ...r, fcf: null } : r));   // no capex line → FCF not known (never CFO passed off as FCF)
}

type Table = { headers: string[]; rows: Record<string, (number | null)[]> };
const rowOf = (t: Table | null | undefined, ...labels: string[]): (number | null)[] | null => {
  if (!t) return null;
  for (const l of labels) { const k = Object.keys(t.rows).find((x) => x.replace(/\s+/g, ' ').toLowerCase() === l.toLowerCase()); if (k) return t.rows[k]; }
  return null;
};
const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const endOf = (h: string): string | null => { const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(h.trim()); return m && MON[m[1]] ? `${m[2]}-${MON[m[1]]}-28` : null; };

/** India: the last `n` fiscal years from the kept screener.in page (₹ crore; EPS in ₹; no TTM column). */
export function inAnnualRows(raw: any, n = 10): AnnualRow[] {
  const A: Table | null = raw?.T?.a ?? null, CF: Table | null = raw?.T?.cf ?? null, BS: Table | null = raw?.T?.bs ?? null;
  if (!A?.headers?.length) return [];
  const sales = rowOf(A, 'Sales', 'Revenue'), np = rowOf(A, 'Net Profit'), eps = rowOf(A, 'EPS in Rs');
  const at = (t: Table | null, row: (number | null)[] | null, h: string): number | null => { if (!t || !row) return null; const i = t.headers.indexOf(h); return i >= 0 && fin(row[i]) ? row[i] : null; };
  const cfo = rowOf(CF, 'Cash from Operating Activity'), cfi = rowOf(CF, 'Cash from Investing Activity'), bor = rowOf(BS, 'Borrowings', 'Borrowing');
  const out: AnnualRow[] = [];
  A.headers.forEach((h, i) => {
    const end = endOf(h);
    if (!end) return;   // TTM and blank columns
    const c = at(CF, cfo, h), v = at(CF, cfi, h);
    out.push({
      end, label: h, revenue: sales && fin(sales[i]) ? sales[i] : null, netIncome: np && fin(np[i]) ? np[i] : null, eps: eps && fin(eps[i]) ? eps[i] : null,
      cfo: c, capex: null, fcf: fin(c) && fin(v) ? Math.round((c + v) * 10) / 10 : null, debt: at(BS, bor, h), shares: null, sbc: null,
    });
  });
  return out.slice(-n);
}
