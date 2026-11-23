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
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic',
    // zzz1291 — partnerships (Sunoco LP …) report per unit
    'NetIncomeLossPerOutstandingLimitedPartnershipUnitDilutedNetOfTax', 'NetIncomeLossPerOutstandingLimitedPartnershipUnitBasicAndDilutedNetOfTax', 'NetIncomeLossPerOutstandingLimitedPartnershipUnitBasicNetOfTax'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquirePropertyAndEquipment', 'PaymentsForCapitalImprovements'],
  sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  shares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
    'WeightedAverageLimitedPartnershipUnitsOutstandingDiluted', 'WeightedAverageLimitedPartnershipUnitsOutstanding'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'PartnersCapital', 'MembersEquity', 'PartnersCapitalIncludingPortionAttributableToNoncontrollingInterest'],
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
  equity: ['EquityAttributableToOwnersOfParent', 'Equity'],
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
  const sh = repairShares(factYears(facts, T.shares, 'shares', false, tax));
  const eq = factYears(facts, T.equity, cur, true, tax);
  const debt = factYears(facts, T.debt, cur, true, tax);
  const debtC = factYears(facts, T.debtCur, cur, true, tax);
  const debtN = factYears(facts, T.debtNonCur, cur, true, tax);
  // the year ends come from revenue (else operating cash): a year with neither is not a fiscal year we can describe
  const ends = Array.from(new Set([...rev.keys(), ...cfo.keys()])).sort();
  // the same fiscal year can be tagged with an end a few days apart (52/53-week years): keep one end per ~year
  const kept: string[] = [];
  for (const e of ends) { if (kept.length && days(kept[kept.length - 1], e) < 300) kept[kept.length - 1] = e; else kept.push(e); }
  const out: AnnualRow[] = kept.slice(-n).map((end) => {
    const c = cfo.get(end), x = cap.get(end);
    const d = debt.get(end), dn = debtN.get(end), dc = debtC.get(end);
    const totalDebt = fin(d) ? d : fin(dn) ? dn + (fin(dc) ? dc : 0) : null;
    return {
      end, label: `FY${end.slice(0, 4)}`,
      revenue: M(rev.get(end)), netIncome: M(ni.get(end)), eps: fin(eps.get(end)) ? Math.round(eps.get(end)! * fx * 100) / 100 : null,
      cfo: M(c), capex: M(x), fcf: fin(c) ? M(c - (fin(x) ? Math.abs(x) : 0)) : null,
      debt: totalDebt == null ? null : M(totalDebt),
      shares: fin(sh.get(end)) ? Math.round((sh.get(end)! / 1e6) * 100) / 100 : null,
      sbc: M(sbc.get(end)), equity: M(eq.get(end)),
    };
  });
  return capexGapFcf(out);
}

/**
 * zzz1291 — share counts tagged in the wrong scale. Some filers tag a year's weighted shares in thousands (INOD FY2022 0.03 M,
 * SWBI 2023–26 0.05 M, IMAX 2016 0.07 M) — FCF per share became −257 / +2,260 / 894. Against the median of the company's own
 * years: a value 300×+ smaller (or larger) is rescaled by 1,000 when that lands within 3× of the median, else dropped (unknown).
 */
export function repairShares(sh: Map<string, number>): Map<string, number> {
  const vals = [...sh.values()].filter((v) => fin(v) && v > 0).sort((a, b) => a - b);
  if (vals.length < 2) return sh;
  // the median of the values that agree with each other in scale (the bigger group decides)
  const big = vals.filter((v) => v >= vals[vals.length - 1] / 300), small = vals.filter((v) => v < vals[vals.length - 1] / 300);
  const ref = (big.length >= small.length ? big : small)[Math.floor((big.length >= small.length ? big : small).length / 2)];
  const out = new Map<string, number>();
  for (const [k, v] of sh) {
    if (!fin(v) || v <= 0) continue;
    if (v >= ref / 300 && v <= ref * 300) { out.set(k, v); continue; }
    const fixed = v < ref ? v * 1000 : v / 1000;
    if (fixed >= ref / 3 && fixed <= ref * 3) out.set(k, fixed);
  }
  return out;
}

/** zzz1291 — a company that stops tagging capex (CLMB after 2019) while its capex had been tiny: FCF ≈ operating cash, marked. */
export function capexGapFcf(rows: AnnualRow[]): AnnualRow[] {
  const tiny = rows.filter((r) => fin(r.capex) && fin(r.revenue) && r.revenue > 0).map((r) => Math.abs(r.capex!) / r.revenue!);
  const lastWithCapex = rows.reduce((k, r, i) => (fin(r.capex) ? i : k), -1);
  const small = tiny.length >= 2 && tiny.sort((a, b) => a - b)[Math.floor(tiny.length / 2)] < 0.01;
  return rows.map((r, i) => {
    if (r.capex == null && fin(r.cfo) && small && lastWithCapex >= 0 && i > lastWithCapex) return { ...r, fcf: r.cfo, fcfApprox: true };
    return r.fcf != null && r.capex == null ? { ...r, fcf: null } : r;   // no capex line → FCF not known (never CFO passed off as FCF)
  });
}

/**
 * zzz1291 — a business that is no longer the same company (NBIS: Yandex until 2023, revenue −99% after the sale). Years before
 * a revenue collapse of 85%+ that does not recover within a year describe the old business; they are cut, and the cut is said.
 */
export function businessBreak(rows: AnnualRow[]): { rows: AnnualRow[]; note: string | null } {
  for (let i = rows.length - 1; i >= 1; i--) {
    const a = rows[i - 1].revenue, b = rows[i].revenue;
    if (!fin(a) || !fin(b) || a <= 0) continue;
    if (b < a * 0.15) {
      const later = rows.slice(i + 1).map((r) => r.revenue).filter(fin);
      if (later.some((v) => v >= a * 0.5)) continue;   // a one-year dip, not a different company
      return { rows: rows.slice(i), note: `years before ${rows[i].label} left out: revenue fell ${Math.round((1 - b / a) * 100)}% that year (a sale or split of the business), so the earlier figures describe a different company` };
    }
  }
  return { rows, note: null };
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
  const eqc = rowOf(BS, 'Equity Capital'), res = rowOf(BS, 'Reserves');
  const out: AnnualRow[] = [];
  A.headers.forEach((h, i) => {
    const end = endOf(h);
    if (!end) return;   // TTM and blank columns
    const c = at(CF, cfo, h), v = at(CF, cfi, h);
    out.push({
      end, label: h, revenue: sales && fin(sales[i]) ? sales[i] : null, netIncome: np && fin(np[i]) ? np[i] : null, eps: eps && fin(eps[i]) ? eps[i] : null,
      cfo: c, capex: null, fcf: fin(c) && fin(v) ? Math.round((c + v) * 10) / 10 : null, debt: at(BS, bor, h), sbc: null,
      shares: null,
      // zzz1291 — crore shares ≈ net profit ÷ EPS (screener.in prints no share count; for the dilution read only); equity = capital + reserves
      sharesEst: (() => { const p = np && fin(np[i]) ? np[i] : null, e = eps && fin(eps[i]) ? eps[i] : null; return p != null && e != null && Math.abs(e) > 0.05 && Math.abs(p) > 0.5 && p * e > 0 ? Math.round((p / e) * 1000) / 1000 : null; })(),
      equity: (() => { const a = at(BS, eqc, h), b = at(BS, res, h); return a != null || b != null ? Math.round(((a ?? 0) + (b ?? 0)) * 10) / 10 : null; })(),
    });
  });
  return out.slice(-n);
}
