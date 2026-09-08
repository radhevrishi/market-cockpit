// ═══════════════════════════════════════════════════════════════════════════
// US EARNINGS CORE — SEC EDGAR XBRL → quarterly fundamentals → grade.
//
// This is the US mirror of the India engine (api/v1/earnings/graded +
// lib/earnings-grade-shared). It is PURE: no fetch, no server-only APIs, no
// browser globals — so both the route handler and the client pages can import
// it. All network I/O lives in `us-edgar.ts` / `us-prices.ts`.
//
// WHY EDGAR AND NOT AN AGGREGATOR
// ────────────────────────────────
// EDGAR companyfacts is the primary source — the numbers the company itself
// tagged in its 10-Q/10-K. During the Phase-0 validation of this module against
// stockanalysis.com across 10 tickers, EDGAR was right and the aggregator was
// wrong TWICE:
//   • MP Materials Q2-26 revenue: aggregator 126.07 (it double-counts an
//     "Other revenue" line) vs the filed 108.490. The aggregator's number
//     produces a spurious +119.7% YoY instead of the true +89.0%.
//   • "Operating income" on aggregators is a NORMALIZED figure (gross profit
//     less SG&A/R&D, excluding intangible amortization / one-offs). It differs
//     from GAAP `OperatingIncomeLoss` for 7 of the 10 test names — CELH by
//     $80.9m (a distributor-termination fee) and ONTO by ~$15m/qtr of
//     intangible amortization. We deliberately use the GAAP tag, so our OPM
//     will NOT match a stockanalysis screenshot for those names. That is
//     correct, not a bug.
//
// THE TRAPS THIS MODULE HANDLES (all verified on real filings)
// ─────────────────────────────────────────────────────────────────
//  1. CASH FLOW IS YEAR-TO-DATE. A 10-Q's cash-flow statement is cumulative
//     from the fiscal-year start, not for the quarter. Q3 CFO must be derived
//     as YTD(Q3) − YTD(Q2). Verified: AAPL 9M FY26 CFO 116,996 − (53,925 +
//     28,702) = 34,369 = the discrete Q3 figure. See `quarterize(cumulative)`.
//  2. Q4 IS NEVER FILED AS A QUARTER. Companies file a 10-K with ANNUAL
//     figures, so the fourth quarter only exists as FY − (Q1+Q2+Q3).
//  3. TAG DRIFT. The same concept is tagged differently by different filers:
//     NVDA puts revenue under `Revenues`, most others under
//     `RevenueFromContractWithCustomerExcludingAssessedTax`; AEIS reports net
//     income only as `ProfitLoss`, never `NetIncomeLoss`. We do not guess —
//     `pickConcept` scores every candidate tag by actual quarterly coverage
//     over the last ~3 years and takes the best.
//  4. FISCAL CALENDARS ARE NOT CALENDARS. AAPL/NVDA/POWL have non-calendar
//     fiscal years; KTOS uses a 52/53-week calendar; ONTO SWITCHED from
//     52/53-week (year-ago quarter ended 2025-06-28) to calendar (current
//     quarter ends 2026-06-30). Year-ago matching is therefore a ±25-day
//     nearest-neighbour search around T−365, never an exact date lookup.
//  5. A TAG CAN BE A SUBSET OF THE LINE IT LOOKS LIKE. Affirm tags both an
//     ASC-606 revenue ($387.5m for its June-2026 quarter) and `Revenues`
//     ($1,166.0m); American Express tags fee income and revenue-net-of-
//     interest-expense. The ASC-606 element is a COMPONENT for those filers.
//     `chooseRevenue` therefore ends with a floor: a chosen revenue more than
//     a tenth short of another total-revenue element for the SAME quarter is
//     re-picked. The exception, and the reason the floor has a filter in front
//     of it, is Brown-Forman: "including assessed tax" is not a bigger revenue
//     line, it is net sales with excise tax added back.
//  6. A PRE-TAX INCOME LINE IS NOT AN OPERATING MARGIN. It is struck after
//     interest and other income. It used to be this module's fallback when a
//     filer tagged no `OperatingIncomeLoss`, and it published REX's October
//     quarter as $35.5m of operating income against a true $27.9m. See
//     `deriveOperatingIncome` and `OperatingIncomeBasis`.
//  7. AVERAGES DO NOT DE-CUMULATE BY SUBTRACTION, AND NEITHER DOES EPS. Both
//     traps live in the same place: the fourth quarter's diluted share count.
//     See `quarterizeAverage` and `dilutedByQuarter`.
//  8. A FOUR-ELEMENT ARRAY WITH NO DATES CANNOT BE CHECKED BY ANYONE. Four
//     period ends 365 days apart look exactly like four consecutive quarters
//     once the dates are dropped. See `consecutiveTail` and `quarters_ends`.
//  9. A STOCK SPLIT MAKES TWO PER-SHARE FIGURES INCOMPARABLE, and EDGAR
//     restates only the periods a later filing re-presents, so both bases sit
//     in the same document. See `splitFactorSince`.
// ═══════════════════════════════════════════════════════════════════════════

import {
  CAVEAT_PENALTY,
  CAVEAT_PENALTY_DEFAULT,
  marginQualityDelta,
  decideTier,
  marketReactionDelta,
  type EarningsTier,
} from './earnings-grade-shared';

export type { EarningsTier };
export const US_TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

// ─── XBRL tag maps ─────────────────────────────────────────────────────────
// Priority order matters only as a tie-break; `pickConcept` weights actual
// coverage far more heavily, because a filer that tags BOTH `Revenues` and
// `RevenueFromContractWithCustomer...` usually populates only one of them
// consistently across quarters.
export const US_TAGS: Record<string, string[]> = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'RevenuesNetOfInterestExpense',          // banks / financials
    'SalesRevenueNet',                        // pre-ASC606 filers
    'SalesRevenueGoodsNet',
    'SalesRevenueServicesNet',
    'TotalRevenuesAndOtherIncome',            // energy majors
  ],
  // ONE tag, because there is only one element that means "operating income".
  // A pre-tax income line is NOT an operating margin — it is struck after
  // interest and other income — and it used to sit in this ladder as a
  // fallback. REX tags no `OperatingIncomeLoss`, so its October-2025 quarter
  // was published as $35.46m of "operating income" when the true figure is
  // $27.92m (36,132 gross profit − 8,214 SG&A); the $7.5m difference is
  // interest income. Deere's 14.93% "operating margin" came from the same
  // substitution and is only close to its 14.4% segment operating profit by
  // luck. What replaces the fallback is `deriveOperatingIncome` below: the
  // filer's own gross profit less its own operating expenses, published only
  // when that arithmetic RECONCILES to the pre-tax line the filer also tags.
  operating_income: [
    'OperatingIncomeLoss',
  ],
  net_income: [
    'NetIncomeLoss',                                        // attributable to the parent (ex-NCI)
    'NetIncomeLossAvailableToCommonStockholdersBasic',      // ex-NCI and ex-preferred
    'ProfitLoss',                                           // INCLUDES noncontrolling interests — last resort only.
                                                            // REX tags only this + the "available to common" line;
                                                            // taking ProfitLoss overstated its PAT by 16%.
  ],
  eps: [
    'EarningsPerShareDiluted',
    'EarningsPerShareBasicAndDiluted',
    'IncomeLossFromContinuingOperationsPerDilutedShare',    // KIM and peers tag only the continuing-ops line
    'EarningsPerShareBasic',
    'IncomeLossFromContinuingOperationsPerBasicShare',
  ],
  diluted_shares: [
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
    'WeightedAverageNumberOfSharesOutstandingBasic',
  ],
  cfo: [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  ],
  // Capital expenditure, so the card can show FREE cash flow — the number a
  // capital-intensive print lives or dies on, and the one every earnings feed
  // prints next to revenue. Tag names vary by filer; coverage picks the one
  // this company actually uses.
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
    'PaymentsToAcquirePropertyAndEquipment',
    'PaymentsForCapitalImprovements',
    'PaymentsToAcquireMachineryAndEquipment',
    'PaymentsToAcquireOtherPropertyPlantAndEquipment',
  ],
  // Gross profit for the margin ladder. Most filers tag it outright; the rest
  // are derived as revenue − cost of revenue, which is why the cost ladder is
  // here too (see `quarterSeries`). Never mix the two: the subtraction only
  // means anything against the SAME revenue series `chooseRevenue` picked.
  gross_profit: [
    'GrossProfit',
  ],
  cost_of_revenue: [
    'CostOfRevenue',
    'CostOfGoodsAndServicesSold',
    'CostOfGoodsSold',
    'CostOfServices',
  ],
  // Cash-flow-statement context lines. All three are YEAR-TO-DATE in a 10-Q,
  // exactly like CFO, and must be de-cumulated the same way.
  sbc: [
    'ShareBasedCompensation',                       // the cash-flow add-back
    'AllocatedShareBasedCompensationExpense',       // the income-statement line
  ],
  buyback: [
    'PaymentsForRepurchaseOfCommonStock',
    'PaymentsForRepurchaseOfEquity',
    'TreasuryStockValueAcquiredCostMethod',
  ],
  dividends: [
    'PaymentsOfDividendsCommonStock',
    'PaymentsOfDividends',
  ],
};

export type UsFactKind =
  | 'revenue' | 'operating_income' | 'net_income' | 'eps' | 'cfo' | 'diluted_shares' | 'capex'
  | 'gross_profit' | 'cost_of_revenue' | 'sbc' | 'buyback' | 'dividends';

// ─── operating income, when the filer never tags the subtotal ──────────────
// Two spellings of the pre-tax line. It is NEVER an operating margin; it is
// kept only as the reconciliation target for a derived operating income and,
// for the one issuer class whose revenue is itself struck after financing cost
// (see `PRETAX_IS_OPERATING_REVENUE_TAGS`), as a marked last resort.
const PRETAX_INCOME_TAGS = [
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
];
/**
 * The revenue lines that are ALREADY net of financing cost. For a bank, a
 * thrift or a BDC, interest expense is a cost of revenue rather than a
 * below-the-line item, there is no operating subtotal on the face of the
 * statement, and pre-tax income is the nearest honest equivalent — the margin
 * a bank analyst actually quotes. For an industrial such as REX or Deere,
 * whose revenue is gross and whose interest sits below the operating line, it
 * is not, which is why the fallback is tied to the revenue line rather than
 * offered to everybody.
 */
const PRETAX_IS_OPERATING_REVENUE_TAGS = new Set([
  'RevenuesNetOfInterestExpense',
  'InterestIncomeExpenseNet',
  'GrossInvestmentIncomeOperating',
  'InvestmentIncomeOperating',
  'InterestAndDividendIncomeOperating',
  'InvestmentIncomeInterest',
  'InterestIncomeOperating',
]);

// Operating expense components for the derivation ladder. Three DISJOINT
// slots — selling/administrative, research, other operating — because the
// income statement itself is built that way, and because a ladder may only
// contain totals: `GeneralAndAdministrativeExpense` is a component of
// `SellingGeneralAndAdministrativeExpense`, so the roll-up is taken alone
// wherever the filer tags it and the components only when it does not.
//
// DELIBERATELY ABSENT: `OperatingExpenses`. Some filers mean by it the total
// of everything below gross profit and others the total INCLUDING cost of
// revenue; an element whose meaning depends on the filer cannot be subtracted
// from anything. Same reason `CostsAndExpenses` is absent: for Chevron and
// Burlington `Revenues − CostsAndExpenses` is exactly the pre-tax line,
// because it swallows interest expense too.
const OPEX_SGA_TOTAL = ['SellingGeneralAndAdministrativeExpense'];
const OPEX_SGA_PARTS: string[][] = [
  ['GeneralAndAdministrativeExpense'],
  ['SellingAndMarketingExpense', 'SellingExpense', 'MarketingExpense'],
];
const OPEX_OTHER_SLOTS: string[][] = [
  ['ResearchAndDevelopmentExpense'],
  ['OtherCostAndExpenseOperating'],
];
/**
 * Depreciation and amortisation shown as its OWN line below gross profit —
 * Burlington's and Gold.com's is, and leaving it out is exactly why their
 * derived operating income overshot. It is NOT part of the slots above,
 * because the same elements are what a filer whose depreciation sits inside
 * cost of sales uses for its cash-flow add-back, and there is nothing in
 * companyfacts that tells the two apart. It is therefore a separate rung,
 * offered only to a filer whose statement proves an operating expense is
 * missing without it — see `deriveOperatingIncome`.
 */
const OPEX_DNA_SLOT = [
  'DepreciationNonproduction',
  'DepreciationDepletionAndAmortization',
  'DepreciationAndAmortization',
  'DepreciationAmortizationAndAccretionNet',
];
/** Non-operating items, used ONLY to bound how far a derived operating income
 *  may sit ABOVE the filer's pre-tax line. `NonoperatingIncomeExpense` is the
 *  roll-up of the rest; the interest elements are alternative spellings of one
 *  charge, so the largest is taken rather than their sum. */
const NONOPERATING_NET_TAG = 'NonoperatingIncomeExpense';
const NONOPERATING_EXPENSE_TAGS = [
  'InterestExpense', 'InterestExpenseNonoperating', 'InterestAndDebtExpense',
  'InterestExpenseDebt', 'InterestExpenseBorrowings',
];
const NONOPERATING_INCOME_TAGS = [
  'InvestmentIncomeInterest', 'InterestAndOtherIncome', 'OtherNonoperatingIncomeExpense',
  'OtherNonoperatingIncome', 'InvestmentIncomeNonoperating', 'IncomeLossFromEquityMethodInvestments',
];
/** Interest presented as ONE net line, negative for a net charge. Burlington
 *  tags its interest expense as `InterestExpenseNonoperating` in some quarters
 *  and only as this element in others (its July-2024 quarter has −16,582 here
 *  and nothing in the gross element), so a bound built from the gross tags
 *  alone silently drops the whole charge for those quarters. Read with its
 *  sign, never through `Math.abs`: for the filer running net interest INCOME
 *  this element widens nothing. */
const NONOPERATING_NET_INTEREST_TAGS = [
  'InterestIncomeExpenseNonoperatingNet',
];
/** A lender's fee and commission income. Net interest income is only half of
 *  a thrift's or a bank's top line — Provident Financial's June quarter is
 *  $9,311k of net interest income PLUS $1,283k of noninterest income. This is
 *  the total element only; the fee-by-fee components are never summed. */
const NONINTEREST_INCOME_TAGS = ['NoninterestIncome'];

// ─── archetype ladders (LAST RESORT ONLY) ──────────────────────────────────
// These are never consulted for a filer whose ordinary revenue ladder above
// produced a usable quarterly series, so nothing that grades today can change.
// They exist because two whole classes of issuer have no `Revenues`-family tag
// at all and were coming back with a blank revenue tile:
//
//  • INVESTMENT COMPANIES (BDCs, RICs). Their income statement is "total
//    investment income", tagged `GrossInvestmentIncomeOperating`. Verified as
//    the top line for 16 of the 17 BDCs sampled (ARCC, MAIN, HTGC, OBDC, FSK,
//    GBDC, PSEC, GAIN, TSLX, NMFC, BXSL, CSWC, OCSL, PFLT, SLRC, RWAY); TRIN
//    is the seventeenth and uses `InterestAndDividendIncomeOperating`.
//  • INTEREST-SPREAD LENDERS (mortgage REITs). Gross interest income is not
//    revenue for a 7x-levered balance sheet — AGNC's June quarter was $1,014m
//    gross against $305m of net interest income. We take the NET line, for the
//    same reason the bank ladder above prefers `RevenuesNetOfInterestExpense`.
//
// `InvestmentIncomeInterest` / `InterestIncomeOperating` / `InterestIncome-
// ExpenseNet` are deliberately NOT in the general ladder: for an ordinary
// company they are interest earned on the cash pile, and promoting them would
// have invented $1.07m of "revenue" for Anavex, a pre-revenue biotech.
const INVESTMENT_COMPANY_REVENUE = [
  'GrossInvestmentIncomeOperating',
  'InvestmentIncomeOperating',
  'InterestAndDividendIncomeOperating',
  'InvestmentIncomeInterest',
  'InterestIncomeOperating',
];
/** A BDC's "operating profit" is net investment income — total investment
 *  income less expenses, before realised and unrealised gains. */
const INVESTMENT_COMPANY_OPERATING_INCOME = [
  'NetInvestmentIncome',
  'InvestmentIncomeOperatingAfterExpenseAndTax',
  'InvestmentIncomeNet',
];
const INTEREST_SPREAD_REVENUE = [
  'InterestIncomeExpenseNet',
  'InterestIncomeOperating',
  'InterestAndDividendIncomeOperating',
];
const INTEREST_INCOME_TOTALS = ['InterestIncomeOperating', 'InterestAndDividendIncomeOperating'];
const INTEREST_EXPENSE_TOTALS = ['InterestExpenseOperating', 'InterestExpense', 'InterestExpenseBorrowings', 'InterestExpenseDebt'];

/** Forms whose facts we trust. Excludes 8-K exhibits (untagged/preliminary). */
const TRUSTED_FORMS = new Set(['10-Q', '10-K', '10-Q/A', '10-K/A', '20-F', '40-F']);

interface DurFact {
  start: string; end: string; days: number; val: number;
  form?: string; filed?: string; accn?: string;
}

const dayMs = 86_400_000;
const dnum = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const diffDays = (a: string, b: string) => Math.round((dnum(a) - dnum(b)) / dayMs);

/**
 * All de-duplicated DURATION facts for one us-gaap concept.
 * Duplicates arise because every later filing restates prior periods; we keep
 * the most recently FILED value for each (start,end) window so restatements win.
 */
export function conceptSeries(facts: any, concept: string): DurFact[] {
  const node = facts?.facts?.['us-gaap']?.[concept];
  if (!node?.units) return [];
  const unitKeys = Object.keys(node.units);
  const uk = unitKeys.includes('USD') ? 'USD'
    : unitKeys.includes('USD/shares') ? 'USD/shares'
    : unitKeys.includes('shares') ? 'shares'
    : unitKeys[0];
  if (!uk) return [];
  const best = new Map<string, any>();
  for (const e of node.units[uk] as any[]) {
    if (!e?.start || !e?.end) continue;              // skip instant (balance-sheet) facts
    if (!TRUSTED_FORMS.has(e.form)) continue;
    if (typeof e.val !== 'number' || !Number.isFinite(e.val)) continue;
    const key = e.start + '|' + e.end;
    const prev = best.get(key);
    if (!prev || String(e.filed || '') > String(prev.filed || '')) best.set(key, e);
  }
  const out: DurFact[] = [];
  best.forEach((e) => {
    out.push({
      start: e.start, end: e.end, days: diffDays(e.end, e.start), val: e.val,
      form: e.form, filed: e.filed, accn: e.accn,
    });
  });
  out.sort((a, b) => a.end.localeCompare(b.end));
  return out;
}

/** How far back a tag still counts as "in use" — ~3.3 years. */
const RECENT_MS = 1200 * dayMs;

/**
 * Cheap "does this concept carry recent QUARTERLY durations" probe, without
 * building and de-duplicating a whole series. Used only by the archetype
 * detectors below, which have to scan a filer's entire concept list.
 */
function hasRecentQuarterly(facts: any, concept: string, min = 1): boolean {
  const node = facts?.facts?.['us-gaap']?.[concept];
  if (!node?.units) return false;
  const cutoff = Date.now() - RECENT_MS;
  let n = 0;
  for (const uk of Object.keys(node.units)) {
    for (const e of node.units[uk] as any[]) {
      if (!e?.start || !e?.end) continue;
      if (!TRUSTED_FORMS.has(e.form)) continue;
      if (typeof e.val !== 'number' || !Number.isFinite(e.val)) continue;
      if (dnum(String(e.end)) < cutoff) continue;
      const d = diffDays(String(e.end), String(e.start));
      if (d >= 80 && d <= 100 && ++n >= min) return true;
    }
  }
  return false;
}

/**
 * A registered investment company / BDC, detected from the taxonomy the filer
 * itself uses — the `InvestmentCompany…` elements exist for no one else. This
 * is a structural test, not a list of names: any BDC that lists in 2040 will
 * tag the same elements, and any operating company that never does keeps the
 * ordinary ladder. (Insurers tag `NetInvestmentIncome` too, which is why that
 * element alone is NOT the test.)
 */
function looksLikeInvestmentCompany(facts: any): boolean {
  const gaap = facts?.facts?.['us-gaap'];
  if (!gaap) return false;
  if (hasRecentQuarterly(facts, 'GrossInvestmentIncomeOperating')) return true;
  for (const c of Object.keys(gaap)) {
    if (!c.startsWith('InvestmentCompany')) continue;
    if (hasRecentQuarterly(facts, c)) return true;
  }
  return false;
}

/**
 * A filer whose business IS the interest spread — it tags both a total
 * interest-income line and a total interest-expense line, quarter after
 * quarter. Mortgage REITs and thrifts look like this; a biotech earning
 * interest on its cash does not (it has no interest expense to speak of).
 */
function looksLikeInterestSpreadLender(facts: any): boolean {
  const inc = INTEREST_INCOME_TOTALS.some((c) => hasRecentQuarterly(facts, c, 4));
  if (!inc) return false;
  return INTEREST_EXPENSE_TOTALS.some((c) => hasRecentQuarterly(facts, c, 4));
}

/**
 * A bank, thrift, insurer, BDC or mortgage REIT — an issuer whose income
 * statement has NO operating subtotal because interest expense is a cost of
 * its revenue rather than a below-the-line item. Detected from the elements the
 * filer itself uses, never from a list of names, so any bank that lists in 2040
 * is covered and no industrial ever is.
 */
function looksLikeFinancialIssuer(facts: any): boolean {
  if (looksLikeInvestmentCompany(facts) || looksLikeInterestSpreadLender(facts)) return true;
  for (const c of ['RevenuesNetOfInterestExpense', 'NoninterestIncome', 'NoninterestExpense',
    'InterestIncomeExpenseNet', 'InterestIncomeExpenseAfterProvisionForLoanLoss',
    'PremiumsEarnedNet', 'PolicyholderBenefitsAndClaimsIncurredNet']) {
    if (hasRecentQuarterly(facts, c, 4)) return true;
  }
  return false;
}

/**
 * Choose the tag that this filer actually uses, by coverage — not by hoping the
 * first name in the list exists. Scores quarterly windows 10x, annual 3x, with
 * a small nudge for priority order. Restricted to the last ~3.3 years so a tag
 * a company abandoned in 2015 can't win.
 */
export function pickConcept(facts: any, kind: UsFactKind): string | null {
  // Revenue has its own chooser (coverage + a sanity check against profit +
  // the archetype fall-back). Delegating rather than duplicating is the only
  // way `pickConcept(facts,'revenue')` and `extractFundamentals` can never
  // disagree about which line a company's revenue is.
  if (kind === 'revenue') return chooseRevenue(facts).concept;
  const cutoffMs = Date.now() - RECENT_MS;
  const list = US_TAGS[kind] || [];
  // For net income and EPS the ORDER is the meaning: `NetIncomeLoss` is
  // attributable to the parent, `ProfitLoss` includes noncontrolling
  // interests. A coverage contest between them is how REX's PAT came out 16%
  // too high — `ProfitLoss` simply had more quarters tagged. So for these
  // kinds take the first tag with adequate recent coverage, in order.
  const priorityFirst = kind === 'net_income' || kind === 'eps' || kind === 'diluted_shares';
  let best: string | null = null;
  let bestScore = -1;
  const info: Array<{ c: string; latest: string; nq: number }> = [];
  for (let i = 0; i < list.length; i++) {
    const rows = conceptSeries(facts, list[i]).filter((r) => dnum(r.end) >= cutoffMs);
    if (!rows.length) continue;
    const qrows = rows.filter((r) => r.days >= 80 && r.days <= 100);
    const nq = qrows.length;
    const na = rows.filter((r) => r.days >= 330 && r.days <= 380).length;
    const latest = (qrows.length ? qrows : rows).reduce((m, r) => (r.end > m ? r.end : m), '');
    info.push({ c: list[i], latest, nq });
    const score = nq * 10 + na * 3 + (list.length - i);
    if (score > bestScore) { best = list[i]; bestScore = score; }
  }
  if (priorityFirst && info.length) {
    // The first tag, in priority order, that is actually populated for the
    // newest quarter any candidate has. REX tags `NetIncomeLoss` only in old
    // annual contexts and the current quarter only as "available to common";
    // a pure coverage contest picked the former and returned null.
    const newest = info.reduce((m, x) => (x.latest > m ? x.latest : m), '');
    for (const c of list) {
      const x = info.find((y) => y.c === c);
      if (x && x.nq > 0 && Math.abs(diffDays(x.latest, newest)) <= 4) return c;
    }
  }
  // Archetype fall-back, reached ONLY when the ordinary ladder is empty, so a
  // filer that resolves today cannot be re-pointed by it. A BDC tags no
  // `OperatingIncomeLoss` and no pre-tax line; net investment income is its
  // operating profit, and without this its margin column is blank for ever.
  if (!best && kind === 'operating_income' && looksLikeInvestmentCompany(facts)) {
    for (const c of INVESTMENT_COMPANY_OPERATING_INCOME) if (hasRecentQuarterly(facts, c)) return c;
  }
  return best;
}

/**
 * Duration facts → a map of {quarter-end-date: DISCRETE quarterly value}.
 *
 * cumulative=false (income statement): take the ~90-day windows directly, then
 *   synthesize the missing Q4 from the annual window minus its three quarters
 *   (trap #2).
 * cumulative=true (cash flow): the facts are YTD, so de-cumulate consecutive
 *   period-ends that share a fiscal-year start (trap #1).
 */
export function quarterize(rows: DurFact[], cumulative: boolean, additive = true): Record<string, number> {
  const q: Record<string, number> = {};
  if (!cumulative) {
    for (const r of rows) if (r.days >= 80 && r.days <= 100) q[r.end] = r.val;
    // Q4 = FY − (Q1+Q2+Q3) is only valid for ADDITIVE quantities (dollars).
    // EPS and share counts are ratios/averages: subtracting quarterly EPS from
    // annual EPS gave SMCI $1.68 against a reported $1.62, because the diluted
    // count moved 692m → 705m across the year. For those the caller derives
    // Q4 from net income ÷ shares instead.
    if (!additive) return q;
    for (const r of rows) {
      if (!(r.days >= 330 && r.days <= 380)) continue;
      if (q[r.end] !== undefined) continue;
      const inner = rows.filter((x) =>
        x.days >= 80 && x.days <= 100 &&
        dnum(x.start) >= dnum(r.start) - 5 * dayMs &&
        dnum(x.end) <= dnum(r.end) + 5 * dayMs);
      const seen = new Set<string>();
      const keep: DurFact[] = [];
      for (const x of inner.sort((a, b) => a.end.localeCompare(b.end))) {
        if (seen.has(x.end)) continue;
        seen.add(x.end); keep.push(x);
      }
      if (keep.length === 3) q[r.end] = r.val - keep.reduce((s, x) => s + x.val, 0);
    }
    // LAST RESORT: de-cumulate the year-to-date windows. A 10-Q's income
    // statement carries BOTH a three-month and a year-to-date column, and
    // plenty of small filers tag only the second — iBio's March quarter exists
    // solely as a 273-day fact, and Hyperliquid's June quarter solely as the
    // 364-day one. Both then failed the Q4 = FY − 3Q rule too, because that
    // needs three tagged quarters and there were only two. Fills gaps ONLY:
    // anything the discrete or FY − 3Q pass already produced is left alone, so
    // no filer that resolves today can change. Additive quantities only —
    // subtracting one year-to-date EPS from another is not the quarter's EPS.
    if (additive) {
      const ytd = quarterize(rows, true, true);
      for (const e of Object.keys(ytd)) if (q[e] === undefined) q[e] = ytd[e];
    }
    return q;
  }
  const byStart = new Map<string, DurFact[]>();
  for (const r of rows) {
    if (!byStart.has(r.start)) byStart.set(r.start, []);
    byStart.get(r.start)!.push(r);
  }
  byStart.forEach((rs) => {
    const dedup = new Map<string, DurFact>();
    for (const x of rs) dedup.set(x.end, x);
    const ordered = Array.from(dedup.values()).sort((a, b) => a.end.localeCompare(b.end));
    let prev: DurFact | null = null;
    for (const x of ordered) {
      if (x.days < 60) continue;                       // ignore odd stub periods
      if (!prev) {
        if (x.days >= 80 && x.days <= 100) q[x.end] = x.val;
      } else {
        const gap = diffDays(x.end, prev.end);
        if (gap >= 80 && gap <= 100) q[x.end] = x.val - prev.val;
      }
      prev = x;
    }
  });
  return q;
}

/**
 * Duration facts that are a TIME-WEIGHTED AVERAGE — the weighted-average share
 * count — → discrete quarterly values.
 *
 * Dollars de-cumulate by subtraction; an average does not. What is additive is
 * the average times its own length, so the quarter that a longer window adds to
 * a shorter one is
 *
 *     Qn = (avg(long) × days(long) − avg(short) × days(short)) ÷ (days difference)
 *
 * which is exact for a time-weighted mean and handles 52/53-week quarters
 * without special-casing them. It matters because Q4 is never filed as a
 * quarter (trap #2) and the Q4 share count is what a Q4 EPS must be divided by:
 * ScanSource's FY26 count is 21,692k and its nine-month count 22,013k, so the
 * fourth quarter averaged (21,692×364 − 22,013×273)/91 = 20,729k. Dividing the
 * quarter's $25.6m of net income by that gives $1.24 — the figure ScanSource
 * filed. Dividing by the third quarter's 21,578k instead gives $1.19.
 *
 * TWO GUARDS, because the identity assumes the DILUTIVE securities counted in
 * the long window were counted in the short one too:
 *  • ASC 260 excludes them from any period with a LOSS. Regis had a loss
 *    quarter inside a profitable FY25, so its annual count (2,680k) includes
 *    equivalents that its nine-month count (2,350k) does not, and the identity
 *    returns 3,670k against a filed 2,736k. A sign change between any quarter
 *    of the year and the year itself therefore disqualifies the derivation —
 *    which is why `signCheck` is passed in.
 *  • The answer must sit inside the range of counts the filer actually tagged
 *    for that same year, widened 10%. A count outside the year's own range is
 *    not a share count, it is the residue of a broken assumption.
 * Both are conservative: they leave the value missing, never wrong.
 */
export function quarterizeAverage(
  rows: DurFact[],
  signCheck?: (start: string, end: string) => boolean,
): Record<string, number> {
  const q: Record<string, number> = {};
  // A tagged quarter is 80–100 days, the same definition the rest of the module
  // uses. The GAPS below are allowed out to 130 because a 52/53-week filer's
  // fourth quarter can be 16 or 17 weeks long (Bridgford Foods' is 112 days)
  // even though its tagged quarters are 84.
  const discrete = rows.filter((r) => r.days >= 80 && r.days <= 100);
  for (const r of discrete) q[r.end] = r.val;

  const plausible = (v: number, within: DurFact[]): boolean => {
    if (!(v > 0) || !Number.isFinite(v)) return false;
    const vals = within.map((x) => x.val).filter((x) => x > 0);
    if (!vals.length) return false;
    return v >= Math.min(...vals) * 0.9 && v <= Math.max(...vals) * 1.1;
  };

  // (a) consecutive year-to-date windows sharing a fiscal-year start.
  const byStart = new Map<string, DurFact[]>();
  for (const r of rows) {
    if (!byStart.has(r.start)) byStart.set(r.start, []);
    byStart.get(r.start)!.push(r);
  }
  byStart.forEach((rs) => {
    const dedup = new Map<string, DurFact>();
    for (const x of rs) dedup.set(x.end, x);
    const ordered = Array.from(dedup.values()).sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i];
      const gap = b.days - a.days;
      if (gap < 80 || gap > 130) continue;
      if (q[b.end] !== undefined) continue;
      if (signCheck && !signCheck(b.start, b.end)) continue;
      const v = (b.val * b.days - a.val * a.days) / gap;
      const peers = rows.filter((x) =>
        dnum(x.start) >= dnum(b.start) - 5 * dayMs && dnum(x.end) <= dnum(b.end) + 5 * dayMs);
      if (plausible(v, peers)) q[b.end] = v;
    }
  });

  // (b) an annual window whose three discrete quarters are tagged but whose
  //     nine-month window is not.
  for (const r of rows) {
    if (!(r.days >= 330 && r.days <= 380)) continue;
    if (q[r.end] !== undefined) continue;
    if (signCheck && !signCheck(r.start, r.end)) continue;
    const inner = discrete.filter((x) =>
      dnum(x.start) >= dnum(r.start) - 5 * dayMs && dnum(x.end) <= dnum(r.end) + 5 * dayMs);
    const seen = new Set<string>();
    const keep: DurFact[] = [];
    for (const x of inner.sort((a, b) => a.end.localeCompare(b.end))) {
      if (seen.has(x.end)) continue;
      seen.add(x.end); keep.push(x);
    }
    if (keep.length !== 3) continue;
    const d3 = keep.reduce((s, x) => s + x.days, 0);
    const gap = r.days - d3;
    if (gap < 80 || gap > 130) continue;
    const v = (r.val * r.days - keep.reduce((s, x) => s + x.val * x.days, 0)) / gap;
    if (plausible(v, [...keep, r])) q[r.end] = v;
  }
  return q;
}

const BASIC_SHARE_TAGS = ['WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'];

/**
 * WEIGHTED-AVERAGE DILUTED SHARES, BY QUARTER — the denominator every derived
 * EPS depends on, and the reason ScanSource's Q4 read $1.19 against a filed
 * $1.24.
 *
 * A quarter the filer tags is used as tagged. For the quarter it never tags —
 * Q4, which exists only inside the 10-K — the count is BUILT rather than
 * borrowed from the quarter before, in two pieces, because only one of them is
 * additive over time:
 *
 *   • BASIC shares are a plain time-weighted mean of the shares outstanding, so
 *     the fourth quarter's is exactly (FY × FY days − 9M × 9M days) ÷ the days
 *     between. No approximation.
 *   • The DILUTIVE increment is not: ASC 260 computes it with the treasury
 *     stock method against the AVERAGE SHARE PRICE OF THE PERIOD, so a year in
 *     which the price fell carries a smaller increment than any of its
 *     quarters. Veeva's FY26 diluted count (166,995k) sits BELOW its nine-month
 *     count (167,953k) for exactly that reason, and de-cumulating the diluted
 *     line directly returns 164,162k against a real ~168,400k — an EPS of $1.49
 *     against the $1.45 Veeva filed. So the increment is carried from the
 *     nearest quarter the filer did tag, where it is a few per cent of the
 *     count rather than the whole of it.
 *
 * Measured against the eight filed Q4 figures used to design this (ScanSource,
 * Strattec, Regis, Veeva, Microsoft, Ulta, Abercrombie, Dell) the sum of
 * absolute error is 3 cents, against 6 for de-cumulating the diluted line and
 * 28 for borrowing the previous quarter's count.
 */
/**
 * THE FILER TAGGED ITS SHARE COUNTS IN THOUSANDS.
 *
 * `shares` is an absolute unit in XBRL, but an issuer whose income statement is
 * printed "(in thousands, except per share data)" sometimes tags the weighted-
 * average share row at the PRINTED scale. Nutanix does: its July-2026 diluted
 * count is filed as 297,456 against ~297.5 MILLION shares. Nothing downstream
 * notices while the filer's own EPS is on file — but Q4 is never tagged as a
 * quarter (trap #2), so it is derived as net income ÷ shares, and Nutanix's
 * July-2025 quarter came out at $129.74 of EPS against a filed $0.13. That
 * figure is also the year-ago number the press-release reader validates a
 * PRELIM card's EPS against, so the release EPS was refused and the card said
 * "EPS not tagged" for a company that states it twice in its own exhibit.
 *
 * The filer's own arithmetic is the detector, so nothing is assumed: in every
 * quarter where it tagged EPS, net income AND a share count, net income ÷
 * shares ÷ EPS must be 1. Where it is a thousand instead, the counts for that
 * stretch of the filing history are in thousands. A single quarter never
 * decides it, and a ratio that is not a clean power of ten is left alone —
 * that is a filer whose EPS numerator is something other than this net-income
 * line (preferred dividends, a per-class numerator), not a scale error.
 *
 * The answer is a function of the quarter rather than one number for the
 * filer, because the scale MOVES: Nutanix tagged real share counts through its
 * FY2023 and thousands from FY2024 on, so a single verdict for the whole
 * history would either leave the recent quarters wrong or corrupt the old
 * ones. Only the observations within a year either side of the quarter being
 * corrected are consulted, and they must agree unanimously — across the
 * changeover they do not, and that quarter is then left exactly as filed.
 */
const SHARE_COUNT_SCALES = [1e3, 1e6];
function shareCountScale(
  qShares: Record<string, number>,
  qEps: Record<string, number>,
  qNet: Record<string, number>,
): (end: string) => number {
  const obs: Array<{ end: string; ratio: number }> = [];
  for (const e of Object.keys(qShares)) {
    const sh = qShares[e];
    const ni = atMap(qNet, e);
    const eps = atMap(qEps, e);
    // EPS is filed rounded to the cent; a small one cannot pin a ratio at all.
    if (!(sh > 0) || ni == null || eps == null || Math.abs(eps) < 0.05) continue;
    obs.push({ end: e, ratio: Math.abs(ni / sh / eps) });
  }
  if (obs.length < 2) return () => 1;
  return (end: string): number => {
    const near = obs.filter((o) => Math.abs(dnum(o.end) - dnum(end)) <= 400 * dayMs);
    if (near.length < 2) return 1;
    for (const k of SHARE_COUNT_SCALES) {
      if (near.every((o) => o.ratio >= k * 0.85 && o.ratio <= k * 1.18)) return k;
    }
    return 1;
  };
}

function dilutedByQuarter(
  ser: (c: string) => DurFact[],
  concept: string,
  qNet: Record<string, number>,
): Record<string, number> {
  // ASC 260 also drops antidilutive securities from any period with a LOSS, so
  // a year containing a loss quarter has no consistent increment at all. Regis
  // is that case, and both constructions below are refused for it — the EPS
  // ladder then falls back to the fiscal-year average, which is 2% from the
  // filed figure where the previous quarter's count was 9% away.
  const signCheck = (start: string, end: string): boolean => {
    const inner = Object.keys(qNet).filter((e) => dnum(e) > dnum(start) && dnum(e) <= dnum(end) + 4 * dayMs);
    if (inner.length < 2) return true;                     // nothing to contradict
    const total = inner.reduce((s, e) => s + qNet[e], 0);
    return inner.every((e) => (qNet[e] >= 0) === (total >= 0));
  };

  const dilRows = ser(concept);
  const out: Record<string, number> = quarterizeAverage(dilRows, signCheck);

  const basicC = BASIC_SHARE_TAGS.find((b) => b !== concept && ser(b).length > 0);
  if (basicC) {
    const basRows = ser(basicC);
    const decumBas = quarterizeAverage(basRows, signCheck);
    const discDil: Record<string, number> = {};
    for (const r of dilRows) if (r.days >= 80 && r.days <= 100) discDil[r.end] = r.val;
    const discBas: Record<string, number> = {};
    for (const r of basRows) if (r.days >= 80 && r.days <= 100) discBas[r.end] = r.val;
    // A filer whose diluted count EQUALS its basic count over the year has no
    // dilutive securities in the numbers at all — the usual case for a company
    // running losses, where ASC 260 excludes every one of them. MongoDB tags
    // only an annual diluted count and a quarterly basic one, and its FY2023
    // figures are the same 68,628,267 to the share; its October-2022 quarter is
    // then simply the basic count it tagged, 68,916,813, and $1.23 of loss per
    // share rather than the $1.24 the annual average gives.
    const annualInc = (e: string): number | null => {
      const fyD = dilRows.find((r) => r.days >= 330 && r.days <= 380
        && dnum(r.start) <= dnum(e) + 4 * dayMs && dnum(r.end) >= dnum(e) - 4 * dayMs);
      const fyB = fyD ? basRows.find((r) => r.start === fyD.start && r.end === fyD.end) : null;
      if (!fyD || !fyB || !(fyB.val > 0)) return null;
      return Math.abs(fyD.val / fyB.val - 1) <= 0.005 ? 0 : null;
    };
    for (const e of Object.keys(decumBas)) {
      if (discDil[e] !== undefined) continue;              // the filer tagged it; nothing to build
      // The increment from the nearest EARLIER quarter that has both lines.
      const src = Object.keys(discDil).filter((k) => k < e && discBas[k] !== undefined).sort().pop();
      let inc: number | null = src ? discDil[src] - discBas[src] : annualInc(e);
      if (inc == null || !(inc >= 0)) continue;
      if (src && inc > discBas[src] * 0.5) continue;
      out[e] = decumBas[e] + inc;
    }
  }
  // A tagged quarter always wins over anything built.
  for (const r of dilRows) if (r.days >= 80 && r.days <= 100) out[r.end] = r.val;
  return out;
}

/** A value out of a quarter map, tolerating the 1–3 day drift between the
 *  period ends different statements inside one filing are tagged to. */
function atMap(m: Record<string, number>, end: string | null | undefined): number | null {
  if (!end) return null;
  if (m[end] !== undefined) return m[end];
  for (const k of Object.keys(m)) if (Math.abs(diffDays(k, end)) <= 4) return m[k];
  return null;
}

/**
 * The first element of a ladder that is actually populated with a recent
 * quarter. PRIORITY order, not coverage — every ladder that uses this is
 * ordered by MEANING (a roll-up before its components, a total before a part),
 * so "whichever has more quarters tagged" is the wrong question.
 */
function firstPopulated(
  ser: (c: string) => DurFact[],
  list: string[],
): { c: string; q: Record<string, number> } | null {
  const cutoffMs = Date.now() - RECENT_MS;
  for (const c of list) {
    const q = quarterize(ser(c), false);
    if (Object.keys(q).some((e) => dnum(e) >= cutoffMs)) return { c, q };
  }
  return null;
}

/**
 * WHICH LINE IS THIS COMPANY'S REVENUE.
 *
 * Phase 1 — the ordinary ladder, by coverage, sanity-checked against profit.
 * For a bank the ASC-606 tag captures only fee income and drops all net
 * interest income: CFG came out at $451m against a true $2,283m, ESS (a REIT,
 * rent is ASC 842 not 606) at $2.3m against $489m, AXP at $11.2bn against
 * $19.6bn. A revenue line SMALLER THAN THE QUARTER'S PROFIT is the wrong line.
 *
 * The word PROFIT is load-bearing and is the fix for a whole family of filers
 * that were coming back a quarter or a year stale. The original test compared
 * |net income|, so a company whose loss exceeds its revenue — which is the
 * normal condition of every early-commercial business — had its correct
 * revenue line rejected: Streamex's June quarter ($0.146m of revenue against a
 * $15.1m loss) fell back to a $0.012m line from March, and Vyome's June
 * quarter fell all the way back to June a year earlier. A loss can be
 * arbitrarily larger than revenue; a PROFIT cannot.
 *
 * Phase 2 — the archetype ladders, consulted only when phase 1 yields no
 * quarters at all, in strict priority order (these ladders are ordered by
 * meaning: the total-income line first, never "whichever number is biggest").
 */
function chooseRevenue(
  facts: any,
  serIn?: (c: string) => DurFact[],
  qNetIn?: Record<string, number>,
  qOpIn?: Record<string, number>,
): { concept: string | null; q: Record<string, number> } {
  const cache = new Map<string, DurFact[]>();
  const ser = serIn || ((c: string) => {
    if (!cache.has(c)) cache.set(c, conceptSeries(facts, c));
    return cache.get(c)!;
  });
  const qNet = qNetIn || (() => { const c = pickConcept(facts, 'net_income'); return c ? quarterize(ser(c), false) : {}; })();
  const qOp = qOpIn || (() => { const c = pickConcept(facts, 'operating_income'); return c ? quarterize(ser(c), false) : {}; })();

  const cutoffMs = Date.now() - RECENT_MS;
  const list = US_TAGS.revenue;
  const cands: Array<{ c: string; score: number; q: Record<string, number> }> = [];
  for (let i = 0; i < list.length; i++) {
    const rows = ser(list[i]).filter((r) => dnum(r.end) >= cutoffMs);
    if (!rows.length) continue;
    const nq = rows.filter((r) => r.days >= 80 && r.days <= 100).length;
    const na = rows.filter((r) => r.days >= 330 && r.days <= 380).length;
    cands.push({ c: list[i], score: nq * 10 + na * 3 + (list.length - i), q: quarterize(ser(list[i]), false) });
  }
  cands.sort((a, b) => b.score - a.score);
  const sane = (q: Record<string, number>): boolean => {
    const ends = Object.keys(q).sort();
    if (!ends.length) return false;
    const e = ends[ends.length - 1];
    const rev = q[e];
    // Zero is a legitimate revenue for a pre-commercial filer (iBio tags the
    // line at 0). Negative is not a revenue line at all.
    if (!(rev >= 0)) return false;
    const ni = atMap(qNet, e), oi = atMap(qOp, e);
    if (ni != null && ni > 0 && ni > rev * 1.05) return false;
    if (oi != null && oi > 0 && oi > rev * 2) return false;
    return true;
  };
  let chosen = cands.find((x) => sane(x.q)) || cands[0] || null;
  if (chosen) {
    const saneOnes = cands.filter((x) => sane(x.q) && x.score >= chosen!.score * 0.5);
    if (saneOnes.length > 1) {
      const latestEnd = (q: Record<string, number>) => { const k = Object.keys(q).sort(); return k[k.length - 1]; };
      const latestVal = (q: Record<string, number>) => q[latestEnd(q)];
      // FRESHNESS BEFORE ANYTHING ELSE. Filers migrate between tags: Alphabet
      // stopped tagging `RevenueFromContractWithCustomerExcludingAssessedTax`
      // after Q1-2025 and moved to `Revenues`, and GE Aerospace did the same
      // after 2024. Preferring a tag on any other ground than "it covers the
      // quarter being reported" pinned both of them to a year-old quarter.
      // Comparing the SIZE of two candidates only means anything when both are
      // quoting the same period anyway.
      const newest = saneOnes.reduce((m, x) => (latestEnd(x.q) > m ? latestEnd(x.q) : m), '');
      const fresh = saneOnes.filter((x) => Math.abs(diffDays(latestEnd(x.q), newest)) <= 4);
      // Among candidates covering that same quarter, the LARGEST figure is the
      // total-revenue line (fee income is a subset of total revenue) — EXCEPT
      // that "including assessed tax" is not a bigger revenue line, it is the
      // same revenue with excise tax added back. Brown-Forman's gross figure is
      // $1,181m against net sales of $911m, and grading the gross line put its
      // margin and growth 30% out. Net revenue is what the company reports.
      const excl = fresh.filter((x) => /ExcludingAssessedTax/.test(x.c));
      const pool = excl.length ? excl : fresh;
      pool.sort((a, b) => latestVal(b.q) - latestVal(a.q));
      if (pool.length) chosen = pool[0];
    }
  }

  // THE CHOSEN LINE MUST BE THE WHOLE TOP LINE.
  //
  // The rule above only ran when at least two candidates passed the sanity
  // test, and that is exactly the case a filer whose profit exceeds its revenue
  // fails. Affirm's June-2026 quarter carried $1.62bn of net income — a
  // deferred-tax valuation-allowance release — against any revenue line, so
  // every candidate was "insane", the re-pick never ran, and the ASC-606 line
  // ($387.5m, 34% of the total) won on tag priority while the filer's own
  // `Revenues` element said $1,166.0m. American Express failed the same way in
  // the other direction: its $11.2bn of fee income beat its $19.6bn of
  // revenue-net-of-interest-expense purely because "excluding assessed tax"
  // sorted first.
  //
  // So the size test is applied unconditionally, as a floor rather than a
  // preference: a revenue that is more than a tenth short of another
  // total-revenue element covering THE SAME QUARTER is a component of that
  // element, not the top line. A profit larger than revenue stays what it
  // always was — a tripwire that the line is a subset — but it now re-picks
  // instead of disabling the choice.
  //
  // THE ONE ELEMENT THAT MAY NEVER WIN THIS TEST is the gross "including
  // assessed tax" spelling. It is not a broader aggregation of revenue, it is
  // the SAME revenue with excise or sales tax added back — Brown-Forman's
  // $1,181m against the $911m of net sales it reports — so a bigger number
  // there is not evidence of anything. (It can still be the chosen line for a
  // filer that tags nothing else; it simply cannot displace one.)
  if (chosen) {
    const curEnd = Object.keys(chosen.q).sort().pop();
    const mine = curEnd ? chosen.q[curEnd] : null;
    if (curEnd && mine != null) {
      let alt: typeof chosen | null = null;
      let altVal = mine;
      for (const x of cands.filter((y) => !/IncludingAssessedTax/.test(y.c))) {
        if (x.c === chosen.c) continue;
        const v = atMap(x.q, curEnd);                  // same quarter, or not comparable at all
        if (v == null || !(v > altVal)) continue;
        alt = x; altVal = v;
      }
      if (alt && mine < altVal * 0.9) chosen = alt;
    }
  }
  if (chosen && Object.keys(chosen.q).length) {
    // TAG MIGRATION. A filer that renames its revenue element leaves a hole:
    // Streamex tagged its March quarter `Revenues` and its June quarter
    // `RevenueFromContractWithCustomerExcludingAssessedTax`, Alphabet moved the
    // other way in mid-2025, so whichever element wins covers only part of the
    // history. Two elements that are the same line under two names AGREE
    // EXACTLY on every quarter they share — that is the test, and it is what
    // separates a rename (fill the gaps) from two genuinely different lines
    // (GE Aerospace's contract revenue is $0.9bn below its total revenue, Vyome
    // changed businesses entirely; neither gets merged). Gaps only: a value the
    // winning element already has is never overwritten.
    const merged: Record<string, number> = { ...chosen.q };
    for (const x of cands) {
      if (x.c === chosen.c) continue;
      const shared = Object.keys(x.q).filter((e) => merged[e] !== undefined);
      if (!shared.length) continue;
      let identical = true;
      for (const e of shared) {
        const a = merged[e], b = x.q[e];
        if (a === b) continue;
        const s = Math.max(Math.abs(a), Math.abs(b));
        if (s === 0 || Math.abs(a - b) > s * 0.01) { identical = false; break; }
      }
      if (!identical) continue;
      for (const e of Object.keys(x.q)) if (merged[e] === undefined) merged[e] = x.q[e];
    }
    return { concept: chosen.c, q: merged };
  }

  const tiers: string[][] = [];
  if (looksLikeInvestmentCompany(facts)) tiers.push(INVESTMENT_COMPANY_REVENUE);
  if (looksLikeInterestSpreadLender(facts)) tiers.push(INTEREST_SPREAD_REVENUE);
  for (const tier of tiers) {
    for (const c of tier) {
      const q = quarterize(ser(c), false);
      if (Object.keys(q).some((e) => dnum(e) >= cutoffMs)) {
        // A LENDER'S REVENUE IS NEVER ONE COMPONENT. Net interest income is
        // half of a bank's or a thrift's top line; the other half is the fee
        // and commission income it tags as `NoninterestIncome`. Provident
        // Financial's June quarter is $9,311k of net interest income and
        // $1,283k of noninterest income — $10,594k of revenue, which is what
        // its own income statement totals. Added only where the filer tags the
        // TOTAL element and only for the quarters it covers, so an issuer that
        // has no fee income (an agency mortgage REIT tags none) is unchanged.
        const fee = firstPopulated(ser, NONINTEREST_INCOME_TAGS);
        if (fee) {
          const merged: Record<string, number> = {};
          for (const e of Object.keys(q)) {
            const f = atMap(fee.q, e);
            merged[e] = f == null ? q[e] : q[e] + f;
          }
          return { concept: `${c} + ${fee.c}`, q: merged };
        }
        return { concept: c, q };
      }
    }
  }
  return { concept: chosen ? chosen.c : null, q: chosen ? chosen.q : {} };
}

/** How the operating income on a row was arrived at. `derived` and `pretax`
 *  exist so a caller can LABEL the number instead of pretending it is the
 *  filer's own subtotal — the whole point of removing the silent pre-tax
 *  fallback. */
export type OperatingIncomeBasis = 'reported' | 'derived' | 'pretax';

/**
 * OPERATING INCOME WHEN THE FILER NEVER TAGS THE SUBTOTAL.
 *
 * The ladder, in order:
 *   1. `OperatingIncomeLoss` — the filer's own line (handled by the caller).
 *   2. gross profit − operating expenses, where gross profit is `GrossProfit`.
 *   3. the same, with gross profit as revenue − cost of revenue. The revenue in
 *      that subtraction is the SAME series `chooseRevenue` picked, never a
 *      different tag.
 *   4. nothing.
 *
 * WHY 2 AND 3 ARE VERIFIED RATHER THAN TRUSTED. A subtraction is only an
 * operating income if the expenses subtracted are ALL of them, and XBRL gives
 * no way to know that a priori — Burlington's gross profit less SG&A is $369m,
 * against a true ~$256m, because its depreciation and amortisation is a
 * separate line on the face of the statement.
 *
 * The check is ONE-SIDED, and that asymmetry is the whole trick. Missing an
 * operating expense can only push the answer UP, so a derived operating income
 * is refused when it sits ABOVE the pre-tax line by more than the filer's own
 * tagged non-operating charges can account for. Sitting BELOW is normal and
 * carries no information: interest and other income are struck between the two
 * lines and are routinely tagged annually or not at all — REX's October-2025
 * quarter derives to $27,918k against a $35,457k pre-tax line, and the $7,539k
 * of interest income that explains the gap appears in its 10-K and nowhere
 * else. A two-sided test would have thrown REX away, which is the defect this
 * whole ladder exists to fix.
 *
 * Chevron fails by $13.6bn against nothing tagged and is refused outright.
 *
 * WHY THERE IS A SECOND RUNG. Burlington and Gold.com fail rung 1 for one
 * specific, common and identifiable reason: depreciation and amortisation is
 * its own line on the face of the statement, below gross profit, and is
 * therefore missing from the subtraction. Burlington's July-2026 quarter
 * derives to $364.6m against a $242.1m pre-tax line — a $122.5m overshoot
 * against $114.0m of tagged D&A — and its margin has been blank ever since the
 * pre-tax fallback was removed, on both the current quarter and the year-ago
 * one, which is what "OPM — no prior margin" on the card was.
 *
 * Subtracting D&A UNCONDITIONALLY is what must not happen: for the filer whose
 * depreciation sits inside cost of sales, the only D&A on file is the
 * cash-flow add-back, and subtracting it double-counts. That error pushes the
 * answer DOWN, where the one-sided bound is blind to it. So rung 2 is reached
 * ONLY when rung 1 is PROVED wrong by the filer's own pre-tax line — a filer
 * whose D&A is already inside cost of sales has no reason to fail rung 1, and
 * is never offered rung 2 at all. The rung that is used must then satisfy the
 * same bound itself.
 *
 * RECONCILIATION IS PER QUARTER, NOT ALL-OR-NOTHING. It used to be that one
 * unreconciled quarter anywhere in the three-year window discarded the filer
 * entirely, and that is too brittle to survive a real filing history:
 * Burlington's May-2026 quarter carries ~$16m of debt-amendment cost that it
 * tags under no standard element at all, so that ONE quarter cannot reconcile
 * however the operating expenses are assembled. A quarter that does not
 * reconcile now publishes nothing and the rest are unaffected — but the rung
 * as a whole is still refused unless it reconciles in at least two quarters
 * and in at least three quarters out of every four it could check, so a
 * derivation that is systematically wrong (Chevron) can never be rescued by a
 * lucky quarter.
 *
 * Realty Income, W. P. Carey, Deere, GE and Exxon never reach the test — they
 * tag no gross profit and no cost of revenue, so there is nothing to derive
 * from, and their margin is simply blank. That is the right answer for them:
 * none of the five strikes an operating subtotal on the face of its own
 * consolidated statement either.
 */
function deriveOperatingIncome(
  ser: (c: string) => DurFact[],
  qRev: Record<string, number>,
  gpQ: Record<string, number>,
): Record<string, number> {
  if (!Object.keys(gpQ).length) return {};

  // ── operating expenses: one figure per disjoint slot ──
  const slots: Array<{ c: string; q: Record<string, number> }> = [];
  const sga = firstPopulated(ser, OPEX_SGA_TOTAL);
  if (sga) slots.push(sga);
  else for (const g of OPEX_SGA_PARTS) { const p = firstPopulated(ser, g); if (p) slots.push(p); }
  for (const g of OPEX_OTHER_SLOTS) { const p = firstPopulated(ser, g); if (p) slots.push(p); }
  if (!slots.length) return {};
  const opexQ: Record<string, number> = {};
  for (const e of Object.keys(gpQ)) {
    let sum: number | null = null;
    for (const p of slots) { const v = atMap(p.q, e); if (v != null) sum = (sum ?? 0) + v; }
    if (sum != null) opexQ[e] = sum;
  }

  const rung1: Record<string, number> = {};
  for (const e of Object.keys(opexQ)) rung1[e] = gpQ[e] - opexQ[e];
  if (!Object.keys(rung1).length) return {};

  // Rung 2: the same, less a depreciation-and-amortisation line the filer shows
  // for itself. Built here, but only ever consulted when rung 1 fails — see
  // the header note.
  const dna = firstPopulated(ser, OPEX_DNA_SLOT);
  const rung2: Record<string, number> = {};
  if (dna) for (const e of Object.keys(rung1)) {
    const d = atMap(dna.q, e);
    if (d != null) rung2[e] = rung1[e] - Math.abs(d);
  }

  // ── the one-sided check against the filer's own pre-tax line ──
  // Both spellings of the pre-tax line are merged rather than the first
  // populated one taken: Dillard's tags the "…ExtraordinaryItems…" element up
  // to its November-2025 quarter and the "…MinorityInterest…" one after it, so
  // a ladder that stops at the first hit leaves every CURRENT quarter with no
  // reconciliation target at all — and an unchecked quarter is exactly the one
  // that must not be published on the strength of quarters three years old.
  const pretaxQ: Record<string, number> = {};
  for (const c of PRETAX_INCOME_TAGS) {
    const q = quarterize(ser(c), false);
    for (const e of Object.keys(q)) if (pretaxQ[e] === undefined) pretaxQ[e] = q[e];
  }
  if (!Object.keys(pretaxQ).length) return {};      // nothing to check it against
  const nonOpNetQ = quarterize(ser(NONOPERATING_NET_TAG), false);
  const nonOpExpQ = NONOPERATING_EXPENSE_TAGS.map((c) => quarterize(ser(c), false));
  const nonOpIncQ = NONOPERATING_INCOME_TAGS.map((c) => quarterize(ser(c), false));
  const nonOpNetIntQ = NONOPERATING_NET_INTEREST_TAGS.map((c) => quarterize(ser(c), false));
  const cutoffMs = Date.now() - RECENT_MS;
  /** true / false when the quarter can be checked at all, null when it cannot.
   *  `twoSided` pins the candidate from BELOW as well — see the rung-2 note. */
  const reconciles = (e: string, cand: number, twoSided: boolean): boolean | null => {
    if (dnum(e) < cutoffMs) return null;
    const px = atMap(pretaxQ, e);
    if (px == null) return null;
    // Operating income sits above the pre-tax line by exactly (charges below
    // it − income below it). `NonoperatingIncomeExpense` is the roll-up of
    // both; failing that, the interest elements are alternative spellings of
    // ONE charge so the largest stands in for them, while the income elements
    // are genuinely different lines and are summed.
    let charge = 0, income = 0;
    const net = atMap(nonOpNetQ, e);
    if (net != null) { if (net < 0) charge = -net; else income = net; }
    else {
      for (const m of nonOpExpQ) { const v = atMap(m, e); if (v != null) charge = Math.max(charge, Math.abs(v)); }
      for (const m of nonOpNetIntQ) { const v = atMap(m, e); if (v == null) continue; if (v < 0) charge = Math.max(charge, -v); }
      for (const m of nonOpIncQ) { const v = atMap(m, e); if (v != null) income += v; }
    }
    const tol = Math.max(Math.abs(cand) * 0.02, Math.abs(px) * 0.02, 1);
    // Clamped at zero: where the filer's tagged non-operating items net to
    // INCOME rather than a charge, operating income has no licence to exceed
    // the pre-tax line at all. It is a one-sided bound either way — a charge
    // the filer never tagged quarterly (REX's is annual-only) leaves the bound
    // at zero and the derivation, which sits BELOW the pre-tax line, unharmed.
    const gap = cand - px;
    if (gap > Math.max(0, charge - income) + tol) return false;
    // The lower bound, for rung 2 only. Subtracting a D&A line that is in fact
    // already inside cost of sales pushes the answer DOWN, exactly where the
    // one-sided rule is blind, so a rung that subtracts one must land ON the
    // pre-tax line once the filer's own tagged non-operating items are put
    // back, not merely below it. Emerson is what this catches: its June-2026
    // quarter derives to $1,312m at rung 1 against a $916m pre-tax line, and
    // subtracting its $377m of cash-flow D&A gives $935m — inside the upper
    // bound, but $45m short of the $980m the pre-tax line plus $85m of net
    // interest less $21m of other income implies, because most of that $377m
    // is the depreciation already sitting in its cost of sales. Refused, and
    // Emerson's margin stays blank, which is right: it strikes no operating
    // subtotal of its own either.
    //
    // The lower bound carries a half-a-per-cent-of-revenue floor on top of the
    // ordinary tolerance, because the derivation is struck on the revenue
    // series `chooseRevenue` picked and a filer that shows a small separate
    // "other revenue" line strikes its own operating income on a slightly
    // wider one — Burlington's is $4.5m a quarter, which is a fifth of a per
    // cent of its revenue and around twice the 2% band. A depreciation line
    // attributed to the wrong side of gross profit is worth whole per cent of
    // revenue (Emerson's is 0.9%), so the floor separates the two rather than
    // blurring them.
    if (!twoSided) return true;
    const floor = Math.max(tol, Math.abs(atMap(qRev, e) ?? 0) * 0.005);
    return (px + charge - income) - cand <= floor;
  };

  const rungs: Array<{ q: Record<string, number>; twoSided: boolean }> = [{ q: rung1, twoSided: false }];
  if (Object.keys(rung2).length) rungs.push({ q: rung2, twoSided: true });
  for (const { q: cand, twoSided } of rungs) {
    const out: Record<string, number> = {};
    let pass = 0, fail = 0;
    for (const e of Object.keys(cand).sort()) {
      const ok = reconciles(e, cand[e], twoSided);
      // A quarter older than the check window, or one the filer tagged no
      // pre-tax line for, is carried on the same basis the checkable quarters
      // established. A quarter that fails is simply not published.
      if (ok === null) { out[e] = cand[e]; continue; }
      if (ok) { out[e] = cand[e]; pass++; } else fail++;
    }
    if (pass >= 2 && pass > fail) return out;
  }
  return {};
}

/**
 * The year-ago quarter end for `target` — nearest end within ±25 days of
 * T−365. Trap #4: an exact 364/365-day lookup breaks on 52/53-week filers and
 * on ONTO, which changed calendars between the two comparison quarters.
 */
export function yoyPartner(ends: string[], target: string): string | null {
  const want = dnum(target) - 365 * dayMs;
  let best: string | null = null;
  let bestGap = Infinity;
  for (const e of ends) {
    if (e >= target) continue;
    const gap = Math.abs(dnum(e) - want) / dayMs;
    if (gap <= 25 && gap < bestGap) { best = e; bestGap = gap; }
  }
  return best;
}

export interface UsFundamentals {
  q_end: string | null;
  q_end_prev: string | null;
  /** Latest `filed` date among the facts that make up the current quarter —
   *  i.e. when these numbers first became public on EDGAR. */
  q_filed: string | null;
  revenue: number | null; revenue_prev: number | null;
  operating_income: number | null; operating_income_prev: number | null;
  net_income: number | null; net_income_prev: number | null;
  eps: number | null; eps_prev: number | null;
  /** True when the current quarter's EPS was computed as net income ÷ diluted
   *  shares rather than read from the filing (Q4 of a 10-K, or a dual-class
   *  filer whose per-class EPS the aggregate API hides). Within a few percent
   *  of the reported figure; shown with ≈ in the UI. */
  eps_derived?: boolean;
  cfo: number | null; cfo_prev: number | null;
  /** Capital expenditure for the quarter (a positive outflow), de-cumulated
   *  from the year-to-date cash-flow statement like CFO. */
  capex: number | null; capex_prev: number | null;
  tags: Partial<Record<UsFactKind, string | null>>;
  /** How `operating_income` was arrived at. `reported` is the filer's own
   *  `OperatingIncomeLoss`; `derived` is gross profit less operating expenses,
   *  reconciled to the filer's pre-tax line; `pretax` is the pre-tax line
   *  itself, which happens only for issuers whose revenue is already net of
   *  financing cost (banks, thrifts, BDCs) and MUST be labelled as such — it is
   *  a pre-tax margin, not an operating one. */
  operating_income_basis?: OperatingIncomeBasis;
  /** Last ≤4 CONSECUTIVE quarters, oldest → newest. Never spans a gap: see
   *  `consecutiveTail`. Pair each value with `quarters_ends`. */
  quarters_revenue: number[] | null;
  quarters_eps: number[] | null;
  quarters_opm: number[] | null;
  /** The period end of every point in the arrays above, same order and same
   *  length. Three lists because a metric missing in the middle of the window
   *  truncates its own strip and not the others. A caller that reads a strip
   *  without its ends is pairing numbers by position across filers whose
   *  calendars do not line up. */
  quarters_ends?: {
    revenue: string[] | null;
    eps: string[] | null;
    opm: string[] | null;
  };
  error?: string;
}

/**
 * THE SHARED QUARTERLY GRID.
 *
 * Every quarterly consumer in this module — `extractFundamentals`,
 * `quarterSeries`, `balanceContext` — resolves its concepts, de-cumulates its
 * series and picks its "current quarter" here, so the multi-period table in
 * the UI can never disagree with the tile above it about which quarter is
 * being reported or what revenue was.
 */
interface UsQuarterGrid {
  tags: Partial<Record<UsFactKind, string | null>>;
  qs: Record<string, Record<string, number>>;
  ser: (c: string) => DurFact[];
  /** Period ends carrying a revenue OR a net-income value, ascending. */
  ends: string[];
  /** The quarter being reported. */
  cur: string;
  /** Its year-ago partner on the grid (for display / labelling). */
  prev: string | null;
  at: (kind: UsFactKind, end: string | null) => number | null;
  /** The same metric one year before `end`, resolved inside that metric's OWN
   *  grid. The cash-flow statement and the P&L are not always tagged to the
   *  same day, and a 52/53-week filer's year-ago quarter is never exactly 365
   *  days back; searching each series independently is what stops one
   *  statement's calendar quirk from blanking another's comparison. */
  atYoy: (kind: UsFactKind, end: string | null) => number | null;
  epsAt: (end: string | null) => { v: number | null; derived: boolean };
  /** EPS for the year-ago quarter of `end`. */
  epsYoy: (end: string | null) => number | null;
  /** How `operating_income` was arrived at — see `OperatingIncomeBasis`. */
  oiBasis: OperatingIncomeBasis;
  /** Up to `n` period ends ending at `cur` that are genuinely CONSECUTIVE
   *  quarters of this filer's own calendar. See `consecutiveTail`. */
  window: (n: number) => string[];
}

/**
 * THE LAST `n` CONSECUTIVE QUARTERS, ending at `cur`.
 *
 * A four-element array carrying no dates cannot be checked by anyone
 * downstream, so it must be right here. Walking the newest `n` ends is not
 * enough: Sanctuary Cognitive's `quarters_eps` came out as [−4.08, −7.14,
 * −2.62] for June-2025, March-2026 and June-2026 — a 274-day step presented as
 * one quarter — and Prospect Bancshares' and Qumulus's four-element arrays
 * stepped a full 365 days between neighbours. Each of those had a quarter the
 * filer simply had not tagged, and the array silently closed the hole.
 *
 * So the window is built by walking BACK from the current quarter and stopping
 * at the first gap that is not a quarter. The band is deliberately wide enough
 * for a real fiscal calendar and no wider: 13-week quarters are 91 days,
 * 52/53-week filers run 84 to 98, and Bridgford Foods' 12/12/12/16-week year
 * gives a legitimate 112 (119 in a 53-week year). A missing quarter is 180+ and
 * is never inside the band, so the array stops rather than lying.
 */
const Q_GAP_MIN = 75;
const Q_GAP_MAX = 130;
function consecutiveTail(ends: string[], cur: string, n: number): string[] {
  const asc = ends.filter((e) => e <= cur).sort();
  if (!asc.length) return [];
  const out = [asc[asc.length - 1]];
  for (let i = asc.length - 2; i >= 0 && out.length < n; i--) {
    const gap = diffDays(out[0], asc[i]);
    if (gap < Q_GAP_MIN || gap > Q_GAP_MAX) break;
    out.unshift(asc[i]);
  }
  return out;
}

function buildGrid(facts: any, asOfPeriodEnd?: string | null): UsQuarterGrid | null {
  if (!facts?.facts?.['us-gaap']) return null;

  const tags: Partial<Record<UsFactKind, string | null>> = {};
  const qs: Record<string, Record<string, number>> = {};
  let oiBasis: OperatingIncomeBasis = 'reported';
  const seriesCache = new Map<string, DurFact[]>();
  const ser = (c: string) => {
    if (!seriesCache.has(c)) seriesCache.set(c, conceptSeries(facts, c));
    return seriesCache.get(c)!;
  };

  // Dollar lines first, in the plain way.
  for (const kind of ['operating_income', 'net_income', 'cfo', 'capex'] as UsFactKind[]) {
    const c = pickConcept(facts, kind);
    tags[kind] = c;
    // Cash-flow lines are year-to-date in every filing; de-cumulate them.
    qs[kind] = c ? quarterize(ser(c), kind === 'cfo' || kind === 'capex') : {};
  }
  // EPS is a ratio: never synthesize Q4 by subtracting one per-share figure
  // from another. The share count is a time-weighted AVERAGE and de-cumulates
  // by its own arithmetic — see `quarterizeAverage`.
  {
    const c = pickConcept(facts, 'eps');
    tags.eps = c;
    qs.eps = c ? quarterize(ser(c), false, false) : {};
  }
  // Share counts, and the scale correction for a filer that tagged them in
  // thousands — see `shareCountScale`. It is applied to the quarterly map AND
  // to the annual count `annualShares` reads below, because both feed the same
  // division.
  let shareScaleAt: (end: string) => number = () => 1;
  {
    const c = pickConcept(facts, 'diluted_shares');
    tags.diluted_shares = c;
    qs.diluted_shares = c ? dilutedByQuarter(ser, c, qs.net_income || {}) : {};
    shareScaleAt = shareCountScale(qs.diluted_shares, qs.eps || {}, qs.net_income || {});
    for (const e of Object.keys(qs.diluted_shares)) {
      const k = shareScaleAt(e);
      if (k !== 1) qs.diluted_shares[e] *= k;
    }
  }
  {
    // The profit proxy the revenue chooser sanity-tests against. `pickConcept`
    // no longer offers a pre-tax line as operating income, but the pre-tax line
    // is still the best evidence that a candidate revenue is too small for the
    // profit the filer reported, so it fills the gaps here.
    const px = firstPopulated(ser, PRETAX_INCOME_TAGS);
    const qOpProxy: Record<string, number> = { ...(px ? px.q : {}), ...qs.operating_income };
    const r = chooseRevenue(facts, ser, qs.net_income, qOpProxy);
    tags.revenue = r.concept;
    qs.revenue = r.q;
  }
  // Gross profit lives on the grid so the margin ladder, the derived operating
  // income and the multi-period table can never quote three different ones.
  {
    const gp: Record<string, number> = { ...quarterize(ser('GrossProfit'), false) };
    const cost = firstPopulated(ser, US_TAGS.cost_of_revenue);
    tags.gross_profit = Object.keys(gp).length ? 'GrossProfit' : (cost ? `${tags.revenue} − ${cost.c}` : null);
    if (cost) for (const e of Object.keys(qs.revenue)) {
      if (gp[e] !== undefined) continue;
      const c = atMap(cost.q, e);
      if (c != null) gp[e] = qs.revenue[e] - c;
    }
    qs.gross_profit = gp;
    tags.cost_of_revenue = cost ? cost.c : null;
  }
  // ── operating income: reported → derived-and-reconciled → marked pre-tax ──
  {
    const reported = qs.operating_income;
    const derived = deriveOperatingIncome(ser, qs.revenue, qs.gross_profit);
    const merged: Record<string, number> = { ...derived, ...reported };   // reported always wins
    const cutoffMs = Date.now() - RECENT_MS;
    const live = Object.keys(merged).some((e) => dnum(e) >= cutoffMs);
    if (live) {
      qs.operating_income = merged;
      if (!Object.keys(reported).length && Object.keys(derived).length) {
        tags.operating_income = 'derived: gross profit − operating expenses';
        oiBasis = 'derived';
      }
    } else {
      // NOTHING left. Pre-tax income is an operating margin for exactly one
      // class of issuer — the one whose revenue line is already struck after
      // financing cost — and is marked even there.
      const px = firstPopulated(ser, PRETAX_INCOME_TAGS);
      const allowed = px && (looksLikeFinancialIssuer(facts)
        || (tags.revenue != null && PRETAX_IS_OPERATING_REVENUE_TAGS.has(String(tags.revenue).split(' ')[0])));
      if (allowed && px) {
        qs.operating_income = px.q;
        tags.operating_income = px.c;
        oiBasis = 'pretax';
      } else {
        qs.operating_income = merged;
      }
    }
  }

  // The quarter universe is every period end that carries a revenue OR a
  // net-income figure. Revenue alone was the rule, and it left a pre-revenue
  // biotech — Anavex, Sana — with no gradeable quarter at all rather than a
  // quarter whose revenue happens to be blank.
  const ends = Array.from(new Set([...Object.keys(qs.revenue), ...Object.keys(qs.net_income)])).sort();
  if (!ends.length) return null;

  // Pin to the quarter the filing reports, when we know it; else newest.
  let cur = ends[ends.length - 1];
  if (asOfPeriodEnd) {
    let bestGap = Infinity;
    for (const e of ends) {
      const gap = Math.abs(diffDays(e, asOfPeriodEnd));
      if (gap <= 45 && gap < bestGap) { cur = e; bestGap = gap; }
    }
  }
  const prev = yoyPartner(ends, cur);

  const at = (kind: UsFactKind, end: string | null): number | null => atMap(qs[kind] || {}, end);
  const atYoy = (kind: UsFactKind, end: string | null): number | null => {
    if (!end) return null;
    const m = qs[kind] || {};
    const p = yoyPartner(Object.keys(m), end);
    return p ? m[p] : null;
  };

  // EPS for a quarter, with a fallback of net income ÷ diluted shares. Needed in
  // two real cases: (a) Q4, which is never tagged as a quarter and must not be
  // derived by subtraction; (b) dual-class filers (BRC, TLYS) who tag EPS only
  // per share class, which the aggregate API hides — they were coming back
  // blank against real $0.96 / $0.27.
  //
  // THE DENOMINATOR IS THE WHOLE PROBLEM. EPS is not additive across quarters
  // because the share count moves, so an FY-minus-nine-months EPS drifts and
  // must never be taken; but dividing by the WRONG quarter's count drifts just
  // as far. ScanSource's fourth quarter came out at $1.19 against a filed
  // $1.24, and Regis's at $38.81 against $42.58, purely from borrowing the
  // previous quarter's count. So the ladder is, strictly:
  //   1. the quarter's own weighted-average diluted count, tagged;
  //   2. that count de-cumulated from the year-to-date one — exact for a
  //      time-weighted mean, and guarded (see `quarterizeAverage`); both of
  //      those arrive already merged in `qs.diluted_shares`;
  //   3. the fiscal-year average for the year the quarter belongs to, from the
  //      tagged annual count, else FY net income ÷ FY EPS;
  //   4. the nearest earlier quarterly count — the old behaviour, kept as the
  //      last resort for a filer that tags nothing annual either.
  // Rung 3 is where Regis lands: 2,680k gives $43.47 against the filed $42.58,
  // two per cent out rather than nine, and the row still carries its ≈ flag.
  const annualShares = (end: string): number | null => {
    const shC = tags.diluted_shares ? ser(tags.diluted_shares) : [];
    const fyRows = shC.filter((r) => r.days >= 330 && r.days <= 380
      && dnum(r.end) >= dnum(end) - 4 * dayMs && dnum(r.start) <= dnum(end) + 4 * dayMs);
    if (fyRows.length) return fyRows[0].val * shareScaleAt(end);
    // No annual share count tagged: FY net income ÷ FY EPS is the count the
    // filing itself implies.
    const niC = tags.net_income ? ser(tags.net_income) : [];
    const epC = tags.eps ? ser(tags.eps) : [];
    const fy = niC.filter((r) => r.days >= 330 && r.days <= 380
      && dnum(r.end) >= dnum(end) - 4 * dayMs && dnum(r.start) <= dnum(end) + 4 * dayMs)[0]
      || niC.filter((r) => r.days >= 330 && r.days <= 380).sort((a, b) => b.end.localeCompare(a.end))[0];
    if (!fy) return null;
    const fe = epC.find((r) => r.days >= 330 && r.days <= 380 && Math.abs(diffDays(r.end, fy.end)) <= 4);
    if (!fe || !fe.val) return null;
    return fy.val / fe.val;
  };
  // THE NUMERATOR IS INCOME AVAILABLE TO COMMON SHAREHOLDERS, not net income.
  // ASC 260 strikes preferred dividends before the division, and for a filer
  // with preferred stock the difference is not small: JPMorgan's December-2025
  // quarter is $14.4bn of net income and $13.4bn available to common, which is
  // 8 cents a share. The P&L line `net_income` stays what it is — attributable
  // to the parent — and only the EPS denominator's partner changes.
  const availQ = quarterize(ser('NetIncomeLossAvailableToCommonStockholdersBasic'), false);
  const deriveEps = (end: string, niIn: number | null): { v: number | null; derived: boolean } => {
    const ni = atMap(availQ, end) ?? niIn;
    if (ni == null) return { v: null, derived: false };
    let sh = at('diluted_shares', end);
    if (sh == null) sh = annualShares(end);
    if (sh == null) {
      const es = Object.keys(qs.diluted_shares).filter((e) => e <= end).sort();
      if (es.length) sh = qs.diluted_shares[es[es.length - 1]];
    }
    if (!sh || sh <= 0) return { v: null, derived: false };
    return { v: Math.round((ni / sh) * 100) / 100, derived: true };
  };
  const epsAt = (end: string | null): { v: number | null; derived: boolean } => {
    if (!end) return { v: null, derived: false };
    const direct = at('eps', end);
    if (direct != null) return { v: direct, derived: false };
    return deriveEps(end, at('net_income', end));
  };
  const epsYoy = (end: string | null): number | null => {
    if (!end) return null;
    const direct = atYoy('eps', end);
    if (direct != null) return direct;
    const p = yoyPartner(ends, end);
    return p ? epsAt(p).v : null;
  };

  const window = (n: number) => consecutiveTail(ends, cur, n);

  return { tags, qs, ser, ends, cur, prev, at, atYoy, epsAt, epsYoy, oiBasis, window };
}

/**
 * companyfacts JSON → the current + year-ago quarter for every metric we grade.
 * `asOfPeriodEnd` pins the comparison to a specific quarter (used when the
 * filing we are grading is not the newest one on file).
 */
export function extractFundamentals(facts: any, asOfPeriodEnd?: string | null): UsFundamentals {
  const empty: UsFundamentals = {
    q_end: null, q_end_prev: null, q_filed: null,
    revenue: null, revenue_prev: null,
    operating_income: null, operating_income_prev: null,
    net_income: null, net_income_prev: null,
    eps: null, eps_prev: null, cfo: null, cfo_prev: null, capex: null, capex_prev: null,
    tags: {}, quarters_revenue: null, quarters_eps: null, quarters_opm: null,
  };
  if (!facts?.facts?.['us-gaap']) return { ...empty, error: 'no us-gaap facts' };
  const g = buildGrid(facts, asOfPeriodEnd);
  if (!g) return { ...empty, error: 'no quarterly revenue or net income' };
  const { tags, qs, ser, ends, cur, prev, at, atYoy } = g;

  // THE FOUR-QUARTER STRIPS. Built on ONE window of genuinely consecutive
  // quarter ends (see `consecutiveTail`) and returned with those ends attached,
  // so a caller can never pair a value with the wrong period. A metric missing
  // in the middle of the window TRUNCATES the strip rather than closing the
  // hole: an array that silently drops a quarter is the same lie as an array
  // that spans a year, only harder to see.
  const win = g.window(4);
  const strip = (val: (e: string) => number | null): { v: number[]; ends: string[] } => {
    const v: number[] = []; const es: string[] = [];
    for (let i = win.length - 1; i >= 0; i--) {
      const x = val(win[i]);
      if (x == null || !Number.isFinite(x)) break;      // contiguous suffix only
      v.unshift(x); es.unshift(win[i]);
    }
    return { v, ends: es };
  };
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const sRev = strip((e) => { const r = at('revenue', e); return r == null ? null : round2(r / 1e6); });
  const sEps = strip((e) => g.epsAt(e).v);
  const sOpm = strip((e) => {
    const r = at('revenue', e); const o = at('operating_income', e);
    return (r && o != null) ? Math.round((o / r) * 1000) / 10 : null;
  });
  const keep = (s: { v: number[]; ends: string[] }) => (s.v.length >= 2 ? s : null);

  // When did the current quarter's numbers first hit EDGAR? Earliest `filed`
  // among the revenue / net-income facts for that period end.
  const qFiled = (): string | null => {
    let best: string | null = null;
    for (const c of [tags.revenue, tags.net_income]) {
      if (!c) continue;
      for (const r of ser(c)) {
        if (Math.abs(diffDays(r.end, cur)) > 4) continue;
        if (r.days < 80) continue;
        if (r.filed && (!best || r.filed < best)) best = r.filed;   // EARLIEST filing that carried it
      }
    }
    return best;
  };

  const epsCur = g.epsAt(cur);
  return {
    q_end: cur, q_end_prev: prev, q_filed: qFiled(), tags,
    revenue: at('revenue', cur), revenue_prev: atYoy('revenue', cur),
    operating_income: at('operating_income', cur), operating_income_prev: atYoy('operating_income', cur),
    net_income: at('net_income', cur), net_income_prev: atYoy('net_income', cur),
    eps: epsCur.v, eps_prev: g.epsYoy(cur),
    eps_derived: epsCur.derived,
    cfo: at('cfo', cur), cfo_prev: atYoy('cfo', cur),
    capex: at('capex', cur), capex_prev: atYoy('capex', cur),
    // Only meaningful when there IS an operating income to describe.
    operating_income_basis: at('operating_income', cur) != null ? g.oiBasis : undefined,
    quarters_revenue: keep(sRev)?.v ?? null,
    quarters_eps: keep(sEps)?.v ?? null,
    quarters_opm: keep(sOpm)?.v ?? null,
    quarters_ends: {
      revenue: keep(sRev)?.ends ?? null,
      eps: keep(sEps)?.ends ?? null,
      opm: keep(sOpm)?.ends ?? null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LONG QUARTERLY HISTORY — the multi-period table
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A dated, aligned quarterly history. Every array is the same length as `ends`
 * and index i belongs to the quarter `ends[i]` — `null` where the filer did not
 * tag that line. Nothing is ever shifted or padded to make a column line up:
 * fiscal calendars drift (52/53-week filers, calendar switches mid-comparison),
 * so the caller must match periods BY DATE, never by counting back three or
 * twelve positions.
 */
export interface UsQuarterSeries {
  ends: string[];                       // period-end ISO dates, oldest → newest
  revenue: (number | null)[];           // $M
  gross_profit: (number | null)[];      // $M
  operating_income: (number | null)[];  // $M
  net_income: (number | null)[];        // $M
  /** $/share, diluted GAAP.
   *  SPLITS: EDGAR restates only the periods a later filing re-presents, so a
   *  quarter more than ~5 quarters back may still carry a PRE-split figure
   *  while recent quarters are post-split (NVIDIA's July-2023 quarter is tagged
   *  0.25 on the post-split basis, its April-2023 quarter 0.82 on the pre-split
   *  one — no filing after the June-2024 split ever re-presented April-2023).
   *  Dollar lines are immune. For a 3-year EARNINGS growth rate use
   *  `net_income`, never the ends of this array. */
  eps: (number | null)[];
  cfo: (number | null)[];               // $M
  fcf: (number | null)[];               // $M (cfo − capex)
}

const musd = (v: number | null): number | null => (v == null ? null : Math.round(v / 1e4) / 100);

/**
 * `maxQuarters` quarters ending at (and including) the quarter `asOfPeriodEnd`
 * selects — the same selection `extractFundamentals` makes, from the same grid.
 * 16 by default: enough for the quarter three years back and a 3-year CAGR.
 */
export function quarterSeries(facts: any, asOfPeriodEnd?: string | null, maxQuarters = 16): UsQuarterSeries | null {
  const g = buildGrid(facts, asOfPeriodEnd);
  if (!g) return null;
  const ends = g.ends.filter((e) => e <= g.cur).slice(-Math.max(1, maxQuarters));
  if (!ends.length) return null;

  // GROSS PROFIT. Preferred straight from `GrossProfit`; otherwise revenue
  // less cost of revenue — and the revenue in that subtraction is the SAME
  // series the grid chose, never a different tag. Mixing a gross ("including
  // assessed tax") revenue line with a net cost line, or an ASC-606 fee line
  // with total cost of sales, produces a margin that is simply invented.
  // Resolved ON the grid, so the gross profit shown here is the same one the
  // derived operating income was struck from.
  const out: UsQuarterSeries = {
    ends, revenue: [], gross_profit: [], operating_income: [], net_income: [], eps: [], cfo: [], fcf: [],
  };
  for (const e of ends) {
    const rev = g.at('revenue', e);
    const gp = g.at('gross_profit', e);
    const cfo = g.at('cfo', e);
    const capex = g.at('capex', e);
    out.revenue.push(musd(rev));
    out.gross_profit.push(musd(gp));
    out.operating_income.push(musd(g.at('operating_income', e)));
    out.net_income.push(musd(g.at('net_income', e)));
    out.eps.push(g.epsAt(e).v);
    out.cfo.push(musd(cfo));
    out.fcf.push(cfo != null && capex != null ? musd(cfo - Math.abs(capex)) : null);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// KEY CONTEXT — balance sheet + capital returns
// ═══════════════════════════════════════════════════════════════════════════

interface InstFact { end: string; val: number; form?: string; filed?: string }

/**
 * All de-duplicated INSTANT facts for one concept. `conceptSeries` deliberately
 * skips these (it wants durations); a balance sheet has no start date, only an
 * "as at". Restatements win the same way: latest `filed` for each instant.
 */
export function instantSeries(facts: any, concept: string): InstFact[] {
  const node = facts?.facts?.['us-gaap']?.[concept];
  if (!node?.units) return [];
  const uk = Object.keys(node.units).includes('USD') ? 'USD' : Object.keys(node.units)[0];
  if (!uk) return [];
  const best = new Map<string, any>();
  for (const e of node.units[uk] as any[]) {
    if (!e?.end || e.start) continue;                 // instants only
    if (!TRUSTED_FORMS.has(e.form)) continue;
    if (typeof e.val !== 'number' || !Number.isFinite(e.val)) continue;
    const prev = best.get(e.end);
    if (!prev || String(e.filed || '') > String(prev.filed || '')) best.set(e.end, e);
  }
  const out: InstFact[] = [];
  best.forEach((e) => out.push({ end: e.end, val: e.val, form: e.form, filed: e.filed }));
  out.sort((a, b) => a.end.localeCompare(b.end));
  return out;
}

export interface UsBalanceContext {
  cash_musd: number | null;             // cash + equivalents (+ short-term investments if separately tagged, summed)
  cash_incl_st_inv: boolean;            // true when short-term investments were included
  /** Total debt: short-term/current + long-term, from the roll-up elements the
   *  filer tags. Null when an issuer discloses debt only instrument-by-
   *  instrument (several REITs) or only inside dimensional contexts (a bank's
   *  long-term debt), which the aggregate companyfacts API does not expose. */
  debt_musd: number | null;
  sbc_musd: number | null;              // share-based compensation, THIS quarter (de-cumulated)
  buyback_musd: number | null;          // common-stock repurchases, THIS quarter (de-cumulated)
  dividends_musd: number | null;        // dividends paid, THIS quarter (de-cumulated)
  diluted_shares_m: number | null;      // weighted-average diluted shares this quarter, millions
  diluted_shares_yoy_pct: number | null;// negative = net buyback shrinking the count
  as_of: string | null;                 // the instant date the balance-sheet figures came from
  /** Total assets and total current liabilities — the two halves of capital
   *  employed, which is what ROCE is measured against. Null when the filer does
   *  not present a classified balance sheet (banks and many REITs do not, and
   *  ROCE has no accepted meaning for them anyway). */
  total_assets_musd: number | null;
  current_liabilities_musd: number | null;
}

// Ladders. Cash first, because the "restricted cash" roll-up is a superset and
// only the right answer when the plain tag is absent (Buckle tags only the
// roll-up; its plain cash fact stopped in 2020 and taking it would have
// reported a six-year-old balance).
const CASH_TAGS = [
  'CashAndCashEquivalentsAtCarryingValue',
  'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  'CashAndDueFromBanks',
];
const ST_INVESTMENT_TAGS = [
  'ShortTermInvestments',
  'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
  'MarketableSecuritiesCurrent',
];
/** `DebtCurrent` is the TOTAL of current debt; the others are its components,
 *  so it is used alone when present and never added to them. */
const DEBT_CURRENT_TOTAL = 'DebtCurrent';
const DEBT_CURRENT_PARTS = ['LongTermDebtCurrent'];
const DEBT_SHORT_TERM_BORROWINGS = ['ShortTermBorrowings', 'OtherShortTermBorrowings'];
// `NotesPayable` last: a REIT's unclassified balance sheet has no "non-current"
// anything, and Realty Income's entire $25.1bn of bonds sits under that one
// element. Only ever reached when the classified tags are absent.
//
// DELIBERATELY NOT HERE: `SeniorNotes`, `UnsecuredDebt`, `SecuredDebt`,
// `LineOfCredit`. Each is ONE instrument class of several (W. P. Carey tags
// four of them, Digital Realty three), so using one alone understates and
// adding them up double-counts against the roll-ups filers also tag. A ladder
// may only contain elements that are TOTALS. Filers that disclose debt purely
// instrument-by-instrument therefore return null — see the note on `debt_musd`.
const DEBT_NONCURRENT_TAGS = ['LongTermDebtNoncurrent', 'ConvertibleDebtNoncurrent', 'SeniorNotesNoncurrent', 'NotesPayable'];
/** `LongTermDebt` is usually the TOTAL including current maturities — adding
 *  the current portion to it double-counts (NVIDIA: 33,366 total = 1,000
 *  current + 32,366 non-current, so 34,366 would be wrong by a billion). */
const DEBT_TOTAL_TAG = 'LongTermDebt';

/**
 * The bullets a serious earnings write-up carries: cash, debt, stock-based
 * compensation, buybacks, dividends, and whether the share count is rising or
 * falling.
 *
 * Balance-sheet figures are INSTANTS and are all read at ONE date — the instant
 * this filer's own balance sheet is dated, chosen as the one most of these
 * concepts agree on within ±10 days of the quarter end. Borrowing a cash
 * balance from a different quarter would be worse than showing nothing, so a
 * tag whose newest instant is stale (Dollar Tree still tags `LongTermDebt` at
 * the January year-end six months on) is simply not used.
 *
 * The flow figures are year-to-date in every 10-Q and are de-cumulated exactly
 * as CFO is.
 */
export function balanceContext(facts: any, periodEnd: string | null | undefined): UsBalanceContext | null {
  if (!facts?.facts?.['us-gaap']) return null;
  const out: UsBalanceContext = {
    cash_musd: null, cash_incl_st_inv: false, debt_musd: null,
    sbc_musd: null, buyback_musd: null, dividends_musd: null,
    diluted_shares_m: null, diluted_shares_yoy_pct: null, as_of: null,
    total_assets_musd: null, current_liabilities_musd: null,
  };

  const instCache = new Map<string, InstFact[]>();
  const inst = (c: string) => {
    if (!instCache.has(c)) instCache.set(c, instantSeries(facts, c));
    return instCache.get(c)!;
  };
  const balanceTags = [...CASH_TAGS, ...ST_INVESTMENT_TAGS, DEBT_CURRENT_TOTAL,
    ...DEBT_CURRENT_PARTS, ...DEBT_SHORT_TERM_BORROWINGS, ...DEBT_NONCURRENT_TAGS, DEBT_TOTAL_TAG,
    'Assets', 'LiabilitiesCurrent'];

  // ── the balance-sheet date this filer used for this quarter ──
  // With no quarter named, "the balance sheet" means the LATEST one on file —
  // never the date that happens to be tagged most often. Dell has tagged its
  // 2018 fiscal year end more times than any recent quarter, so the vote alone
  // returned an eight-year-old balance sheet ($51.9bn of debt, correct for
  // 2018, absurd for now). The anchor is always a date; only the tie-break is
  // a vote.
  let anchor = periodEnd || null;
  if (!anchor) {
    for (const c of balanceTags) for (const f of inst(c)) if (!anchor || f.end > anchor) anchor = f.end;
    if (!anchor) return out;
  }
  const votes = new Map<string, number>();
  for (const c of balanceTags) {
    for (const f of inst(c)) {
      if (Math.abs(diffDays(f.end, anchor)) > 10) continue;
      votes.set(f.end, (votes.get(f.end) || 0) + 1);
    }
  }
  const periodAnchor: string = anchor;
  let asOf: string | null = null;
  votes.forEach((n, e) => {
    if (!asOf) { asOf = e; return; }
    const best = votes.get(asOf) || 0;
    const gapE = Math.abs(diffDays(e, periodAnchor));
    const gapB = Math.abs(diffDays(asOf, periodAnchor));
    // most-used instant wins; then the one closest to the quarter end; then the newest
    if (n > best || (n === best && (gapE < gapB || (gapE === gapB && e > asOf!)))) asOf = e;
  });
  out.as_of = asOf;

  const atInstant = (c: string): number | null => {
    if (!asOf) return null;
    for (const f of inst(c)) if (f.end === asOf) return f.val;
    return null;
  };

  // ── cash (+ short-term investments when separately tagged at the same date) ──
  let cash: number | null = null;
  for (const c of CASH_TAGS) { const v = atInstant(c); if (v != null) { cash = v; break; } }
  if (cash != null) {
    for (const c of ST_INVESTMENT_TAGS) {
      const v = atInstant(c);
      if (v != null && v > 0) { cash += v; out.cash_incl_st_inv = true; break; }
    }
    out.cash_musd = Math.round(cash / 1e4) / 100;
  }

  // ── debt ──
  {
    let current: number | null = atInstant(DEBT_CURRENT_TOTAL);
    if (current == null) {
      let sum: number | null = null;
      for (const c of DEBT_CURRENT_PARTS) { const v = atInstant(c); if (v != null) sum = (sum ?? 0) + v; }
      // Short-term borrowings sit alongside current maturities of long-term
      // debt, not inside them (Brown-Forman: $0 current LTD, $358m of
      // commercial paper) — but `OtherShortTermBorrowings` is a component of
      // `ShortTermBorrowings`, so only the first that exists is added.
      for (const c of DEBT_SHORT_TERM_BORROWINGS) { const v = atInstant(c); if (v != null) { sum = (sum ?? 0) + v; break; } }
      current = sum;
    }
    let nonCurrent: number | null = null;
    for (const c of DEBT_NONCURRENT_TAGS) { const v = atInstant(c); if (v != null) { nonCurrent = v; break; } }
    const total = atInstant(DEBT_TOTAL_TAG);
    // TOTAL DEBT MUST BE A TOTAL. When the long-term side is missing at this
    // balance-sheet date, the current portion on its own is not it — GE
    // Aerospace would have read $2.0bn, Medtronic $2.5bn and JPMorgan $72bn,
    // each an order of magnitude light, because those issuers tag their
    // long-term debt only inside dimensional contexts (or only at fiscal year
    // ends) that the aggregate companyfacts API does not carry. A filer that
    // has NEVER tagged a long-term-debt element is different: it has no
    // long-term debt to miss, and its current portion really is the total.
    const everLongTerm = [...DEBT_NONCURRENT_TAGS, DEBT_TOTAL_TAG].some((c) => inst(c).length > 0);
    if (nonCurrent == null && total == null && everLongTerm) {
      out.debt_musd = null;
    } else {
      const parts = (current == null && nonCurrent == null) ? null : (current ?? 0) + (nonCurrent ?? 0);
      // `LongTermDebt` normally already includes the current maturities.
      const debt = (total != null && (parts == null || total >= parts)) ? total : parts;
      if (debt != null) out.debt_musd = Math.round(debt / 1e4) / 100;
    }
  }

  // The duration end the quarter's flow lines are keyed on. With no quarter
  // named this is the balance-sheet date that was just resolved — the two are
  // the same date for every filer, and using it means a caller that says only
  // "the latest" still gets that quarter's stock comp and buybacks instead of
  // nulls.
  const flowEnd: string | null = asOf || periodAnchor || null;

  // ── capital employed: total assets less current liabilities ──
  {
    const ta = atInstant('Assets');
    const cl = atInstant('LiabilitiesCurrent');
    if (ta != null) out.total_assets_musd = Math.round(ta / 1e4) / 100;
    if (cl != null) out.current_liabilities_musd = Math.round(cl / 1e4) / 100;
  }

  // ── flows: SBC, buybacks, dividends (year-to-date → this quarter) ──
  const serCache = new Map<string, DurFact[]>();
  const ser = (c: string) => {
    if (!serCache.has(c)) serCache.set(c, conceptSeries(facts, c));
    return serCache.get(c)!;
  };
  // Walk the ladder in PRIORITY order and take the first element that actually
  // covers the quarter being asked about — coverage over all history is the
  // wrong question here. NetApp tags stock-based compensation twice, and the
  // element with the longer history (`AllocatedShareBasedCompensationExpense`)
  // stops at the previous fiscal year end, so scoring by coverage reported no
  // SBC at all for a quarter the filing states as $98m.
  const flow = (kind: UsFactKind): number | null => {
    for (const c of US_TAGS[kind] || []) {
      const v = atMap(quarterize(ser(c), true), flowEnd);
      if (v != null) return Math.round(Math.abs(v) / 1e4) / 100;
    }
    return null;
  };
  out.sbc_musd = flow('sbc');
  out.buyback_musd = flow('buyback');
  out.dividends_musd = flow('dividends');

  // ── diluted share count and its year-on-year direction ──
  {
    const c = pickConcept(facts, 'diluted_shares');
    if (c) {
      const niC = pickConcept(facts, 'net_income');
      const epsC = pickConcept(facts, 'eps');
      const qNi = niC ? quarterize(ser(niC), false) : {};
      const qEps = epsC ? quarterize(ser(epsC), false, false) : {};
      // The SAME construction the EPS denominator uses, so a Q4 row's share
      // count and its EPS can never come from two different arithmetics.
      const q = dilutedByQuarter(ser, c, qNi);
      // A filer can simply get the SCALE wrong: Anavex's own 10-Q tags its June
      // quarter's weighted-average diluted count as 92,899,536,000 against a
      // real 92.9m — a decimals slip, the same class of error that already
      // forces the market-cap cross-check in `gradeUsRow`. Net income ÷ EPS is
      // the count the filing itself implies, and a decimals slip always shows
      // up as a clean POWER OF TEN against it, so that is the only discrepancy
      // corrected, by dividing the slip out rather than by substituting the
      // imprecise implied figure.
      //
      // The power-of-ten test is doing real work, not being fussy. Net income
      // and EPS often have different numerators — Annaly's `NetIncomeLoss`
      // includes preferred dividends its EPS excludes, and at $0.03 of EPS that
      // put the implied count 3x above the true 621m. Any looser rule threw
      // away a share count that was right.
      const checked = (end: string | null): number | null => {
        const sh = atMap(q, end);
        if (sh == null || !(sh > 0)) return null;
        const ni = atMap(qNi, end), eps = atMap(qEps, end);
        if (ni == null || eps == null || eps === 0) return sh;
        const implied = ni / eps;
        if (!(implied > 0)) return sh;
        const ratio = sh / implied;
        if (ratio < 5 && ratio > 0.2) return sh;
        const pow = Math.pow(10, Math.round(Math.log10(ratio)));
        if (Math.abs(pow) < 1e-12) return sh;
        return Math.abs(ratio / pow - 1) <= 0.25 ? sh / pow : sh;
      };
      const now = checked(flowEnd);
      if (now != null) {
        out.diluted_shares_m = Math.round(now / 1e4) / 100;
        // ±25 days around T−365, so a 52/53-week filer still finds its partner.
        const p = flowEnd ? yoyPartner(Object.keys(q), flowEnd) : null;
        const then = checked(p);
        // NOTE: EDGAR only restates the periods a later filing re-presents, so
        // across a stock split — or a reverse recapitalisation, where the
        // year-ago count is the accounting acquirer's tiny predecessor share
        // base — this ratio is a capital-structure artefact, not a buyback. It
        // is reported exactly as filed; a consumer should treat a triple-digit
        // move as "restructured", never as issuance.
        if (then != null && then > 0) out.diluted_shares_yoy_pct = ((now - then) / then) * 100;
      }
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// STOCK SPLITS — the one thing that makes two per-share figures incomparable
// ═══════════════════════════════════════════════════════════════════════════

/** Within 1% of a whole number 2–20, or of its reciprocal. Anything else is
 *  not a split ratio and the answer is "don't know". */
function asSplitRatio(x: number): number | null {
  if (!Number.isFinite(x) || x <= 0) return null;
  const forward = x >= 1 ? x : 1 / x;
  const n = Math.round(forward);
  if (n < 2 || n > 20) return null;
  if (Math.abs(forward / n - 1) > 0.01) return null;
  return x >= 1 ? n : 1 / n;
}

/**
 * Ratio by which per-share figures published before `sinceISO` must be
 * restated to compare with today's, or null when no split is evidenced.
 *
 * The number returned is the SHARE-COUNT multiplier: 4 for a four-for-one
 * forward split, 1/10 for a one-for-ten reverse. An old EPS is therefore
 * divided by it and an old share count multiplied by it. Two consecutive
 * splits multiply.
 *
 * WHY THIS EXISTS. CrowdStrike split four-for-one on 3 June 2026, between two
 * releases. Every per-share comparison across that date — EPS growth, a
 * year-ago EPS column, a P/E built from four quarters — is nonsense unless one
 * side is restated, and EDGAR only restates the periods a later filing
 * re-presents, so the two bases sit side by side in the same companyfacts
 * document.
 *
 * TWO INDEPENDENT SIGNALS, both taken from the filer's own tagging:
 *  • `StockholdersEquityNoteStockSplitConversionRatio1`, whose fact DATE is the
 *    split's effective date — CrowdStrike tags 4 at 2026-06-03. Its weakness is
 *    direction: a one-for-ten reverse split is tagged "10" by some filers and
 *    "0.1" by others, and the element alone cannot tell them apart.
 *  • The same prior period's weighted-average diluted share count, restated by
 *    the filing that followed the split: CrowdStrike's May–July 2025 quarter is
 *    249,909,000 as filed on 2025-08-28 and 999,634,000 as re-presented on
 *    2026-08-27 — exactly 4.00×. This one carries the direction unambiguously.
 *
 * So the conversion-ratio tag is used where present, the restated share count
 * otherwise, and where BOTH exist they must agree: on magnitude and direction,
 * or on magnitude with the tag stating the ratio the other way round (in which
 * case the share counts settle the direction). A genuine disagreement returns
 * null — the caller refuses the comparison rather than rescaling on a guess.
 * REX is that case over a long horizon: it tags only its 2025 two-for-one, but
 * its FY2022 share count was also restated 3× by a filing in 2024, so asking
 * about a two-year window gets "don't know" rather than either half-answer.
 *
 * KNOWN LIMIT. Over a horizon of several years the answer can only be as good
 * as the tagging: a filer that used the conversion-ratio element for something
 * that is not a common-stock split (Citizens Financial carries a 6 at
 * 2021-12-31 and has never split) is caught only when a period straddling that
 * date was re-presented unchanged. Across two adjacent releases — which is what
 * this is for — a split is always carried by both signals at once.
 */
export function splitFactorSince(facts: any, sinceISO: string): number | null {
  const gaap = facts?.facts?.['us-gaap'];
  if (!gaap || !sinceISO) return null;

  // ── signal 1: the conversion-ratio element, one entry per split date ──
  let tagRatio: number | null = null;
  let splitFirst: string | null = null, splitLast: string | null = null;
  {
    const byDate = new Map<string, number>();
    for (const c of ['StockholdersEquityNoteStockSplitConversionRatio1', 'StockholdersEquityNoteStockSplitConversionRatio']) {
      const node = gaap[c];
      if (!node?.units) continue;
      for (const uk of Object.keys(node.units)) {
        for (const e of node.units[uk] as any[]) {
          if (typeof e?.val !== 'number' || !Number.isFinite(e.val)) continue;
          const when = String(e.end || '');
          if (!when || when < sinceISO) continue;      // the split predates the comparison
          const r = asSplitRatio(e.val);
          if (r == null) continue;
          byDate.set(when, r);
        }
      }
    }
    // ONE SPLIT, TWO DATES. REX tags its 2-for-1 at both 2025-08-26 and
    // 2025-09-15 — the record date and the distribution date — and multiplying
    // them would report a 4-for-1 that never happened. Dates within six months
    // of each other are the same event; two genuine splits that close together
    // do not happen, and if they ever did, under-reporting is the safe error.
    const dates = Array.from(byDate.keys()).sort();
    let p = 1;
    let clusterStart: string | null = null;
    for (const d of dates) {
      if (clusterStart && diffDays(d, clusterStart) <= 180) continue;
      clusterStart = d;
      p *= byDate.get(d)!;
    }
    if (dates.length) { tagRatio = p; splitFirst = dates[0]; splitLast = dates[dates.length - 1]; }
  }

  // ── signal 2: a share count for one period, restated across `sinceISO` ──
  let shareRatio: number | null = null;
  let pairs = 0, flat = 0;
  {
    const votes = new Map<number, number>();
    for (const c of US_TAGS.diluted_shares) {
      const node = gaap[c];
      if (!node?.units) continue;
      for (const uk of Object.keys(node.units)) {
        const byWindow = new Map<string, { before: any | null; after: any | null }>();
        for (const e of node.units[uk] as any[]) {
          if (!e?.start || !e?.end) continue;
          if (!TRUSTED_FORMS.has(e.form)) continue;
          if (typeof e.val !== 'number' || !(e.val > 0)) continue;
          const key = e.start + '|' + e.end;
          if (!byWindow.has(key)) byWindow.set(key, { before: null, after: null });
          const slot = byWindow.get(key)!;
          const filed = String(e.filed || '');
          if (filed < sinceISO) { if (!slot.before || filed > String(slot.before.filed)) slot.before = e; }
          else if (!slot.after || filed > String(slot.after.filed)) slot.after = e;
        }
        byWindow.forEach((s) => {
          if (!s.before || !s.after) return;
          const raw = s.after.val / s.before.val;
          // Only a period re-presented in a filing made AFTER the split, from
          // one made before it, can say anything about that split.
          if (splitFirst && splitLast
            && String(s.before.filed || '') < splitFirst && String(s.after.filed || '') > splitLast) {
            pairs++;
            if (Math.abs(raw - 1) <= 0.01) flat++;
          }
          if (Math.abs(raw - 1) <= 0.01) return;
          const r = asSplitRatio(raw);
          if (r == null) return;
          votes.set(r, (votes.get(r) || 0) + 1);
        });
      }
    }
    if (votes.size) {
      // One split leaves the SAME ratio on every period it restated; two
      // different ratios in one document is not evidence of anything.
      const entries = Array.from(votes.entries()).sort((a, b) => b[1] - a[1]);
      if (entries.length === 1) shareRatio = entries[0][0];
    }
  }

  if (tagRatio != null && shareRatio != null) {
    if (Math.abs(tagRatio / shareRatio - 1) <= 0.01) return shareRatio;
    if (Math.abs(tagRatio * shareRatio - 1) <= 0.01) return shareRatio;   // tag stated it inverted
    return null;                                                          // genuine disagreement
  }
  // SHARE COUNTS THAT DID NOT MOVE ARE EVIDENCE OF NO SPLIT. Citizens
  // Financial tags `…StockSplitConversionRatio1` as 6 at 2021-12-31 and has
  // never split its common stock — the element is being used for something
  // else, as filers periodically do. Where several periods that were filed
  // before the split date and re-presented after it came back UNCHANGED, that
  // is a direct contradiction of the tag and the answer is "don't know". A
  // period the filer simply never re-presented says nothing either way, which
  // is why the window has to straddle the split to be counted at all.
  if (tagRatio != null && shareRatio == null && pairs >= 3 && flat >= pairs * 0.9) return null;
  return tagRatio ?? shareRatio;
}

/**
 * YoY %. Returns null (n/m) when the base is zero or NEGATIVE — a loss
 * narrowing from −43.9 to −32.0 is not "+27% growth", and India's engine has a
 * separate `turnaroundBase` caveat for exactly this. Never fabricate a number
 * out of an absolute-value division.
 */
export function yoyPct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev <= 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/**
 * What `yoyPct` refuses to say, said in words.
 *
 * Refusing to divide by a negative base is right — a loss of $0.31 becoming a
 * profit of $1.59 is not "+613% growth" — but a card that then prints a bare
 * dash throws away the single most important fact about the quarter. Semtech
 * swung from a loss to $1.59 of GAAP EPS and the tile read "—".
 *
 * So every metric that can go negative carries a swing descriptor alongside its
 * percentage. The percentage stays null; the tile prints the swing instead. The
 * two are never both shown, and neither is ever invented: both current and
 * prior must exist for a swing to be named at all.
 */
export type SwingKind =
  | 'loss-to-profit'      // prev ≤ 0, cur > 0  — the turnaround
  | 'profit-to-loss'      // prev > 0, cur ≤ 0
  | 'loss-narrowed'       // both ≤ 0, |cur| < |prev|
  | 'loss-widened'        // both ≤ 0, |cur| ≥ |prev|
  | null;

export function swingKind(cur: number | null, prev: number | null): SwingKind {
  if (cur == null || prev == null) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev > 0) return cur > 0 ? null : 'profit-to-loss';   // prev > 0 → yoyPct handles the growth case
  if (cur > 0) return 'loss-to-profit';
  return Math.abs(cur) < Math.abs(prev) ? 'loss-narrowed' : 'loss-widened';
}

/** Short label for a swing, for a tile that has no room for a sentence. */
export const SWING_LABEL: Record<Exclude<SwingKind, null>, string> = {
  'loss-to-profit': 'Loss → Profit',
  'profit-to-loss': 'Profit → Loss',
  'loss-narrowed': 'Loss narrowed',
  'loss-widened': 'Loss widened',
};
/** Whether a swing is good news — drives the tile colour, nothing else. */
export const SWING_GOOD: Record<Exclude<SwingKind, null>, boolean> = {
  'loss-to-profit': true, 'profit-to-loss': false,
  'loss-narrowed': true, 'loss-widened': false,
};

// ─── US market-cap buckets (the India ₹Cr ladder has no meaning here) ───────
export type UsCapBucket = 'mega' | 'large' | 'mid' | 'small' | 'micro';
export function usCapBucket(musd: number | null | undefined): UsCapBucket | null {
  if (musd == null || !Number.isFinite(musd)) return null;
  if (musd >= 200_000) return 'mega';
  if (musd >= 10_000) return 'large';
  if (musd >= 2_000) return 'mid';
  if (musd >= 300) return 'small';
  return 'micro';
}
export function usCapInRange(musd: number | null | undefined, filter: string | null | undefined): boolean {
  if (!filter || filter === 'all') return true;
  const b = usCapBucket(musd);
  if (!b) return false;
  if (filter === 'smid') return b === 'small' || b === 'mid';   // Rishi's default lens
  return b === filter;
}

// ─── formatting ────────────────────────────────────────────────────────────
export function fmtUsd(musd: number | null | undefined): string {
  if (musd == null || !Number.isFinite(musd)) return '—';
  const a = Math.abs(musd);
  if (a >= 1_000_000) return `$${(musd / 1_000_000).toFixed(2)}T`;
  if (a >= 1_000) return `$${(musd / 1_000).toFixed(a >= 10_000 ? 0 : 1)}B`;
  if (a >= 1) return `$${musd.toFixed(a >= 100 ? 0 : 1)}M`;
  return `$${(musd * 1000).toFixed(0)}K`;
}
export function fmtPx(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${v.toFixed(2)}`;
}
export function fmtPct(p: number | null | undefined, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return '—';
  if (Math.abs(p) < 0.05) return 'flat';
  return `${p >= 0 ? '+' : ''}${p.toFixed(digits)}%`;
}

// ─── the graded row ────────────────────────────────────────────────────────
export interface UsGradedRow {
  ticker: string;
  company: string;
  sector?: string | null;
  filing_date: string;
  period_end: string | null;
  quarter: string;                 // e.g. "Q2 CY26" / "FQ3 2026"
  fiscal_year: number | null;
  form: string;
  items?: string[];

  market_cap_musd: number | null;
  market_cap_bucket: UsCapBucket | null;
  price: number | null;
  pe: number | null;

  revenue_curr_musd: number | null;
  revenue_prev_musd: number | null;
  net_income_curr_musd: number | null;
  net_income_prev_musd: number | null;
  eps_curr: number | null;
  eps_prev: number | null;
  eps_derived?: boolean;
  cfo_curr_musd: number | null;
  /** Free cash flow = CFO − capex, both from the filing's own cash-flow
   *  statement. Null when the filer does not tag capital expenditure. */
  fcf_curr_musd: number | null;
  fcf_prev_musd: number | null;
  fcf_yoy_pct: number | null;

  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  opm_pct: number | null;
  opm_prev_pct: number | null;
  cfo_to_pat_ratio: number | null;

  /** Set when the YoY percentage is null because the base was a loss — the
   *  tile prints this instead of a dash. See `swingKind`. */
  eps_swing: SwingKind;
  net_income_swing: SwingKind;
  fcf_swing: SwingKind;

  /** GAAP EPS growth ONLY. `eps_yoy_pct` is the grading axis and silently
   *  falls back to the adjusted basis when GAAP has a loss base; a tile
   *  labelled "EPS · GAAP" must never print an adjusted growth rate, so it
   *  reads this. */
  eps_gaap_yoy_pct: number | null;

  /** The street (adjusted) basis, carried as first-class row fields so the
   *  main tile row can always show an EPS: a company whose GAAP line swung out
   *  of a loss has no GAAP growth rate, but its adjusted EPS almost always
   *  has one, and that is the number the market traded. Never mixed with the
   *  GAAP tile — they are two tiles, always labelled. */
  eps_adj_curr: number | null;
  eps_adj_prev: number | null;
  eps_adj_yoy_pct: number | null;
  eps_adj_swing: SwingKind;
  /** Which basis the grade's growth axis actually used. */
  eps_basis_used: 'gaap' | 'adjusted' | null;

  gap_pct: number | null;
  d1_pct: number | null;
  move_pct: number | null;
  rs_rating: number | null;
  stage: 1 | 2 | 3 | 4 | null;
  pct_from_52w_high: number | null;
  addv_musd: number | null;         // 20-day median dollar volume, $M
  vol_ratio_20d: number | null;

  /** Last ≤4 CONSECUTIVE quarters, oldest → newest, each paired with its own
   *  period end in `quarters_ends`. */
  quarters_revenue: number[] | null;
  quarters_eps: number[] | null;
  quarters_opm: number[] | null;
  quarters_ends?: { revenue: string[] | null; eps: string[] | null; opm: string[] | null };
  /** How `opm_pct` was struck. `pretax` means the filer tags no operating line
   *  at all and this is a PRE-TAX margin — label it, never print it as an
   *  operating margin. */
  opm_basis?: OperatingIncomeBasis;

  composite_score: number;
  tier: EarningsTier;
  methodology_tags: string[];
  caveat_tags: string[];
  narrative: string;
  is_elite: boolean;
  pead_score: number;
  multibagger_setup: boolean;
  filing_url?: string;
  source: string;
  tags_used?: Partial<Record<UsFactKind, string | null>>;
}

export interface UsGradeInput {
  ticker: string; company: string; sector?: string | null;
  filing_date: string; form: string; items?: string[]; filing_url?: string;
  fundamentals: UsFundamentals;
  price?: {
    price: number | null; d1_pct: number | null; gap_pct: number | null;
    move_pct: number | null; pct_from_52w_high: number | null;
    stage: 1 | 2 | 3 | 4 | null; rs_rating: number | null;
    addv_musd: number | null; vol_ratio_20d: number | null;
  } | null;
  shares_outstanding?: number | null;
  /** True when the press release RAISED guidance — feeds Path A of the
   *  BLOCKBUSTER gate exactly as India's guidance-text scan does. */
  positive_guidance?: boolean;
  /** The street (adjusted) EPS for this quarter and the year-ago quarter, when
   *  the consensus feed carries both. A US software name is priced on this
   *  basis: Snowflake's GAAP line is a loss while adjusted EPS grew ~50% on
   *  +35% revenue, and grading only the GAAP line called that "mixed". */
  adj_eps?: number | null;
  adj_eps_prev?: number | null;
  /** PRELIM mode: the street-basis EPS surprise (%) for a print whose XBRL has
   *  not posted. Stands in for the growth axis so the reaction + surprise can be
   *  graded now; the full YoY grade replaces it when the 10-Q lands. */
  prelim_surprise_pct?: number | null;
  /** The filer's own fiscal quarter ("Q2 FY27"), from companyfacts fy/fp. */
  fiscal_label?: string | null;
  fiscal_year_own?: number | null;
}

/**
 * The company's OWN fiscal quarter for a period end, straight from the fy/fp
 * fields companyfacts carries on every fact.
 *
 * Why this matters: Dell's quarter ending 31 Jul 2026 is "Q2 FY27" to Dell, to
 * the street and to every earnings site — calling it "Q3 CY26" (which is what a
 * calendar-quarter label does with an 8-K filed on 1 Sep) is wrong in a way a
 * user notices immediately. Snowflake's July quarter is Q2 FY27, Zscaler's is
 * Q4 FY26, Campbell's is Q4 FY26. Only the filer knows; the filer tells us.
 *
 * In a 10-K a quarterly-length fact is tagged fp="FY" (there is no Q4 context),
 * so a ~90-day duration with fp=FY is Q4 of that fiscal year.
 */
export interface FiscalPeriod { fy: number | null; q: 1 | 2 | 3 | 4 | null; }
export function fiscalPeriodFromFacts(facts: any, periodEnd: string | null | undefined): FiscalPeriod {
  const none: FiscalPeriod = { fy: null, q: null };
  const gaap = facts?.facts?.['us-gaap'];
  if (!gaap || !periodEnd) return none;
  const votes = new Map<string, number>();
  const concepts = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'NetIncomeLoss',
    'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'OperatingIncomeLoss', 'ProfitLoss'];
  for (const c of concepts) {
    const node = gaap[c];
    if (!node?.units) continue;
    for (const uk of Object.keys(node.units)) {
      for (const e of node.units[uk] as any[]) {
        if (!e?.start || !e?.end) continue;
        if (Math.abs(diffDays(String(e.end), periodEnd)) > 4) continue;
        const days = diffDays(String(e.end), String(e.start));
        if (days < 80 || days > 100) continue;
        const fy = Number(e.fy);
        const fpRaw = String(e.fp || '');
        if (!Number.isFinite(fy)) continue;
        let q: number | null = null;
        if (/^Q[1-4]$/.test(fpRaw)) q = Number(fpRaw.slice(1));
        else if (fpRaw === 'FY') q = 4;
        if (!q) continue;
        const key = `${fy}|${q}`;
        votes.set(key, (votes.get(key) || 0) + 1);
      }
    }
  }
  if (!votes.size) return none;
  const [best] = Array.from(votes.entries()).sort((a, b) => b[1] - a[1]);
  const [fyS, qS] = best[0].split('|');
  return { fy: Number(fyS), q: Number(qS) as 1 | 2 | 3 | 4 };
}
/**
 * For a filer whose only disclosure is the 10-K, the quarter being reported is
 * Q4 of the fiscal year that just ended — Ethan Allen's June quarter is Q4 FY26,
 * not "Q2 CY26". The annual fact whose period END matches the quarter's end
 * names that fiscal year.
 */
export function fiscalYearEndingAt(facts: any, periodEnd: string | null | undefined): number | null {
  const gaap = facts?.facts?.['us-gaap'];
  if (!gaap || !periodEnd) return null;
  for (const c of ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'NetIncomeLoss', 'ProfitLoss']) {
    const node = gaap[c];
    if (!node?.units) continue;
    for (const uk of Object.keys(node.units)) {
      for (const e of node.units[uk] as any[]) {
        if (!e?.start || !e?.end) continue;
        if (Math.abs(diffDays(String(e.end), periodEnd)) > 4) continue;
        const days = diffDays(String(e.end), String(e.start));
        if (days < 330 || days > 380) continue;       // an ANNUAL window
        const fy = Number(e.fy);
        if (Number.isFinite(fy)) return fy;
      }
    }
  }
  return null;
}

/** "Q2 FY27" from a fiscal period; empty string when we don't know it. */
export function usFiscalLabel(fp: FiscalPeriod | null | undefined): string {
  if (!fp || !fp.q || !fp.fy) return '';
  return `Q${fp.q} FY${String(fp.fy).slice(2)}`;
}
/** Same fiscal quarter, one year on — used for a PRELIM row, whose own quarter
 *  has no XBRL yet but whose year-ago quarter does. */
export function nextFiscalYear(fp: FiscalPeriod | null | undefined): FiscalPeriod {
  if (!fp || !fp.q || !fp.fy) return { fy: null, q: null };
  return { fy: fp.fy + 1, q: fp.q };
}

/** Calendar-quarter label from a period end, e.g. 2026-06-30 → "Q2 CY26". */
export function usQuarterLabel(periodEnd?: string | null, filingDate?: string | null): { label: string; q: 1 | 2 | 3 | 4 | null; fy: number | null } {
  const iso = periodEnd || filingDate;
  if (!iso) return { label: '—', q: null, fy: null };
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return { label: '—', q: null, fy: null };
  const m = d.getUTCMonth();                 // 0-11
  const q = (Math.floor(m / 3) + 1) as 1 | 2 | 3 | 4;
  const y = d.getUTCFullYear();
  return { label: `Q${q} CY${String(y).slice(2)}`, q, fy: y };
}

/**
 * The US grader. Mirrors the India `gradeRow`: the same magnitude/quality/
 * technical/methodology composite and the SAME shared `decideTier` +
 * `marketReactionDelta` chain, so a US BLOCKBUSTER means what an India
 * BLOCKBUSTER means.
 *
 * Deliberate US-specific differences, each with a reason:
 *  • NO promoter-pledge gate — the concept does not exist in US markets.
 *  • Thin-float gate is measured in 20-day median DOLLAR volume ($2M/day),
 *    not ₹1 Cr/day, and is applied here rather than via `thinFloatGate`
 *    (whose threshold is denominated in ₹Cr).
 *  • The PEAD volume leg is a REAL measured volume ratio; the India engine has
 *    to hardcode it to 50 because Screener does not expose the series.
 *  • RS rating is supplied by the caller as a cohort percentile (see
 *    `assignRsRatings`) because there is no free US RS-rating feed.
 */
export function gradeUsRow(input: UsGradeInput): UsGradedRow | null {
  const f = input.fundamentals;
  const p = input.price || null;

  const revC = f.revenue, revP = f.revenue_prev;
  const niC = f.net_income, niP = f.net_income_prev;
  const salesY = yoyPct(revC, revP);
  const patY = yoyPct(niC, niP);
  const epsYGaap = yoyPct(f.eps, f.eps_prev);
  // When the GAAP line gives no usable growth rate — a loss last year, a loss
  // this year — fall back to the basis the market actually trades: adjusted
  // EPS, year over year, from the consensus feed. The GAAP figures stay on the
  // card untouched; only the GROWTH used for grading changes, and the row is
  // tagged so the reason is visible.
  const epsYAdj = yoyPct(input.adj_eps ?? null, input.adj_eps_prev ?? null);
  const usedAdjEps = epsYGaap == null && epsYAdj != null;
  const epsY = epsYGaap ?? epsYAdj;
  const opm = (f.operating_income != null && revC) ? (f.operating_income / revC) * 100 : null;
  const opmPrev = (f.operating_income_prev != null && revP) ? (f.operating_income_prev / revP) * 100 : null;
  const opmExp = (opm != null && opmPrev != null) ? opm - opmPrev : null;

  const prelimS = input.prelim_surprise_pct ?? null;
  const hasFin = salesY != null || patY != null || epsY != null;
  if (!hasFin && prelimS == null) return null; // no gradeable quarter → not a candidate

  const rs = p?.rs_rating ?? null;
  const stage = p?.stage ?? null;
  const pct52 = p?.pct_from_52w_high ?? null;
  // CFO ÷ net income, but only where net income is big enough to divide by.
  // CrowdStrike earned $5.3m on $1.47bn of revenue and the tile read "99.94",
  // which is arithmetically true and tells a reader nothing about cash
  // conversion. Below 1% of revenue the denominator is noise, so the ratio is
  // refused rather than printed.
  const niMeaningful = niC != null && niC > 0
    && (revC == null || revC <= 0 || niC >= revC * 0.01);
  const cfoPat = (f.cfo != null && niMeaningful) ? (f.cfo as number) / (niC as number) : null;
  const fcfC = (f.cfo != null && f.capex != null) ? f.cfo - Math.abs(f.capex) : null;
  const fcfP = (f.cfo_prev != null && f.capex_prev != null) ? f.cfo_prev - Math.abs(f.capex_prev) : null;

  const methodology_tags: string[] = [];
  const caveat_tags: string[] = [];

  // Methodology overlays — same thresholds as India.
  const ttPass = stage === 2 && rs != null && rs >= 70 && pct52 != null && pct52 >= -15;
  if (ttPass) methodology_tags.push('trend template');
  if (stage === 2 && rs != null && rs >= 80 && epsY != null && epsY >= 25 && pct52 != null && pct52 >= -15) methodology_tags.push('sepa');
  if (epsY != null && epsY >= 25 && (salesY ?? 0) >= 20 && rs != null && rs >= 70) methodology_tags.push('canslim');
  if (epsY != null && epsY >= 20 && (salesY == null || salesY >= 5)) methodology_tags.push('bonde ep');
  // Beating the street by ≥5% is a methodology in its own right for a US
  // print; for a PRELIM row it is the only growth evidence we have.
  if (prelimS != null && prelimS >= 5) methodology_tags.push('consensus beat');

  // Caveats.
  // "OPTICAL EPS" NAMED, NOT JUST FLAGGED.
  //
  // The tag was right — EPS running three times revenue growth is rarely
  // operating leverage — but "optical eps" told a reader nothing about WHY.
  // Where the company published an adjusted EPS, the gap between the two IS
  // the one-off, per share, stated by the company itself: Abercrombie's GAAP
  // $4.17 against an adjusted $4.17 is clean, while Dollar Tree's GAAP $2.70
  // carries $1.31 of tariff refunds. So the caveat carries the number when the
  // number is knowable, and stays generic only when it is not.
  const adjNowV = (input.adj_eps ?? null);
  const gaapVsAdj = (f.eps != null && adjNowV != null) ? f.eps - adjNowV : null;
  const oneOffTag = (gaapVsAdj != null && Math.abs(gaapVsAdj) >= 0.02 && f.eps != null && Math.abs(f.eps) > 0.05
      && Math.abs(gaapVsAdj) >= Math.abs(f.eps) * 0.15)
    ? `gaap ${gaapVsAdj > 0 ? 'above' : 'below'} adjusted by $${Math.abs(gaapVsAdj).toFixed(2)}/sh`
    : 'optical eps';
  if (epsY != null && salesY != null && salesY > 0 && epsY >= salesY * 3 && epsY >= 50) caveat_tags.push(oneOffTag);
  if (epsY != null && epsY >= 200 && !caveat_tags.includes(oneOffTag)) caveat_tags.push(oneOffTag);
  if (f.eps_prev != null && f.eps != null && Math.abs(f.eps_prev) < 0.05 && Math.abs(f.eps) > 0.2
      && !caveat_tags.includes(oneOffTag)) caveat_tags.push('low base · prior-year EPS near zero');
  // A PAT that doubles while operating profit barely moves is below-the-line
  // (tax / other income), not operating performance.
  if (patY != null && patY >= 100 && f.operating_income != null && f.operating_income_prev != null && f.operating_income_prev > 0) {
    const opY = ((f.operating_income - f.operating_income_prev) / Math.abs(f.operating_income_prev)) * 100;
    if (opY < 30) caveat_tags.push('tax distortion');
  }
  // A GAAP loss that is profitable on the street's basis is a different animal
  // from a company that loses money on every measure — stock-based
  // compensation and acquisition amortisation are the usual gap. Both are
  // flagged; only the second is treated as a quality failure.
  const gaapLoss = (niC != null && niC <= 0) || (f.eps != null && f.eps <= 0);
  const adjProfitable = (input.adj_eps ?? null) != null && (input.adj_eps as number) > 0;
  const stillLossMaking = gaapLoss && !adjProfitable;
  if (stillLossMaking) caveat_tags.push('low quality');
  else if (gaapLoss && adjProfitable) caveat_tags.push('gaap loss · adj. profitable');
  if (usedAdjEps) methodology_tags.push('adjusted eps basis');
  const turnaroundBase = ((niP != null && niP < 0) || (f.eps_prev != null && f.eps_prev < 0)) && !adjProfitable;
  if (turnaroundBase) caveat_tags.push('low quality');
  if (opmExp != null && opmExp < -1.5) caveat_tags.push('segment mix shift');
  else if (opmExp != null && opmExp <= -0.5) caveat_tags.push('segment mix shift');
  // Earnings not backed by cash.
  if (cfoPat != null && cfoPat < 0.6) caveat_tags.push('ocf divergence');
  if (f.cfo != null && f.cfo < 0 && niC != null && niC > 0 && !caveat_tags.includes('ocf divergence')) caveat_tags.push('ocf divergence');
  // These two are TREND problems, not accounting ones. Filing them under
  // "low quality" put an identical chip on a company with a downtrend and on
  // one whose profits are an illusion — Argan's +62% revenue quarter carried
  // "low quality" purely because the stock sat 25% off its high.
  if (stage === 4) caveat_tags.push('stage 4 downtrend');
  else if (pct52 != null && pct52 < -25) caveat_tags.push('well off its highs');

  // ── composite (identical weights + ladders to the India engine) ──
  const scoreYoy = (y: number) =>
    y >= 100 ? 100 : y >= 50 ? 90 : y >= 25 ? 75 : y >= 15 ? 60 : y >= 5 ? 40 : y >= 0 ? 25 : Math.max(0, 25 + y);
  let magW = 0, magS = 0;
  if (salesY != null) { magS += scoreYoy(salesY) * 0.35; magW += 0.35; }
  if (patY != null) { magS += scoreYoy(patY) * 0.30; magW += 0.30; }
  if (epsY != null) { magS += scoreYoy(epsY) * 0.35; magW += 0.35; }
  const scoreSurprise = (s: number) =>
    s >= 30 ? 100 : s >= 15 ? 90 : s >= 8 ? 75 : s >= 3 ? 60 : s >= 0 ? 45 : s >= -5 ? 25 : Math.max(0, 25 + s);
  const magnitude = magW > 0 ? magS / magW : (prelimS != null ? scoreSurprise(prelimS) : 30);

  let quality = 100;
  for (const tag of caveat_tags) quality -= (CAVEAT_PENALTY[tag] ?? CAVEAT_PENALTY_DEFAULT);
  quality += marginQualityDelta(opmExp);
  quality = Math.max(0, Math.min(100, quality));

  const stageBase = stage === 2 ? 70 : stage === 1 ? 45 : stage === 3 ? 30 : stage === 4 ? 10 : 50;
  let technical = stageBase + (rs != null ? rs / 3 : 0);
  if (pct52 != null) technical += pct52 >= -5 ? 15 : pct52 >= -15 ? 8 : pct52 >= -25 ? 0 : -15;
  if (ttPass) technical += 10;
  technical = Math.max(0, Math.min(100, technical));

  const mCount = methodology_tags.length;
  const t1 = (methodology_tags.includes('trend template') ? 1 : 0)
    + (methodology_tags.includes('sepa') ? 1 : 0)
    + (methodology_tags.includes('canslim') ? 1 : 0);
  let methodology = mCount === 4 ? 100 : mCount === 3 ? 80 : mCount === 2 ? 60 : mCount === 1 ? 35 : 10;
  if (t1 >= 1) methodology = Math.max(methodology, 55);
  if (methodology_tags.includes('sepa')) methodology = Math.min(100, methodology + 5);
  const megaMagFloor = salesY != null && salesY >= 40 && patY != null && patY >= 75 && epsY != null && epsY >= 75;
  if (megaMagFloor) methodology = Math.max(methodology, 75);
  const exceptMagFloor = salesY != null && salesY >= 40 && patY != null && patY >= 50 && epsY != null && epsY >= 50;
  if (exceptMagFloor) methodology = Math.max(methodology, 65);

  const composite = Math.max(0, Math.min(100, magnitude * 0.35 + quality * 0.25 + technical * 0.25 + methodology * 0.15));

  const broken = (stage === 4 && (rs == null || rs < 40)) || (epsY != null && epsY < 0 && patY != null && patY < -10);
  const cleanMag = salesY != null && salesY >= 25 && patY != null && patY >= 25 && epsY != null && epsY >= 25;
  const exceptMag = salesY != null && salesY >= 40 && patY != null && patY >= 50 && epsY != null && epsY >= 50;
  const megaMag = megaMagFloor;
  const marginInflection = patY != null && patY >= 100 && epsY != null && epsY >= 100 && salesY != null && salesY >= -5;
  const marginInflectionLoose = patY != null && patY >= 75 && epsY != null && epsY >= 75 && salesY != null && salesY >= 0 && stage !== 4;
  const chartOk = stage !== 4 && (pct52 == null || pct52 >= -25);

  let tier = decideTier({
    composite, broken, stillLossMaking, turnaroundBase,
    marginContracting: opmExp != null && opmExp <= -0.5,
    marginSevereContraction: opmExp != null && opmExp <= -1.5,
    caveatCount: caveat_tags.length, mCount, stage,
    salesY, patY, epsY, opmExp,
    cleanMag, exceptMag, megaMag,
    marginInflection, marginInflectionLoose,
    tier1MethodCount: t1,
    positiveGuidance: !!input.positive_guidance,   // from the 8-K press release (lib/us-guidance)
    chartOk,
  }).tier;

  const TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
  const worseOf = (a: EarningsTier, b: EarningsTier) =>
    TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;

  // What the FUNDAMENTALS alone said, before the tape got a vote. Kept so the
  // floor below can tell a bad quarter from a good quarter the market disliked.
  const tierOnFundamentals = tier;
  {
    const mr = marketReactionDelta(tier, p?.d1_pct, p?.gap_pct);
    tier = mr.tier;
    for (const c of mr.addCaveats) if (!caveat_tags.includes(c)) caveat_tags.push(c);
  }
  const reactionDemoted = TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(tierOnFundamentals);

  // ═══════════════════════════════════════════════════════════════════════
  // HARD QUALITY CAPS — the caveats have to cost something.
  //
  // Every warning below this engine raises was, until now, narrative only: it
  // printed a red chip and the composite score carried on regardless. So
  // Movado reached BLOCKBUSTER — the tier the page defines as "explosive
  // growth, CLEAN QUALITY, MARKET CONFIRMING" — on a quarter with NEGATIVE
  // operating cash flow, negative free cash flow and a negative price
  // reaction. Everpure reached STRONG on −$136m of operating cash flow against
  // $74m of reported profit. A grade that a reader cannot rely on to mean what
  // it says is worse than no grade.
  //
  // These are ceilings, never promotions: a row can always be graded lower on
  // its own merits, and none of them invents a number. Each is a fact the
  // filing itself establishes.
  const criticals = caveat_tags.filter((t) =>
    t === 'low quality' || t === 'ocf divergence' || t === 'optical eps' || t.startsWith('gaap ')).length;
  // Caps raised by the FILING (cash, trend, quality flags) are remembered
  // separately from the cap raised by the TAPE, because the floor below has to
  // know which of the two is holding a row down.
  let filingCap: EarningsTier = 'BLOCKBUSTER';
  const capTier = (max: EarningsTier, why: string, fromFiling = true) => {
    if (fromFiling) filingCap = worseOf(filingCap, max);
    if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(max)) {
      tier = max;
      if (!caveat_tags.includes(why)) caveat_tags.push(why);
    }
  };

  // 1. Profit the business did not collect. Reported earnings with cash going
  //    the other way is the oldest warning in accounting, and it is not a
  //    footnote on a "clean quality" print.
  if (f.cfo != null && f.cfo < 0 && niC != null && niC > 0) {
    capTier('MIXED', 'profit without operating cash');
  } else if (fcfC != null && fcfC < 0 && niC != null && niC > 0) {
    // Free cash flow can be negative for a genuinely investing business, so
    // this is one step, not two.
    capTier('STRONG', 'free cash flow negative on a reported profit');
  }

  // 2. "Market confirming" has to mean the market confirmed it. A print the
  //    tape rejected on the day cannot be the top tier by definition.
  if (p?.d1_pct != null && p.d1_pct <= -5) capTier('STRONG', 'market rejected the print', false);

  // 3. A stage-4 downtrend is not a setup, whatever the quarter looked like.
  if (stage === 4) capTier('MIXED', 'stage 4 downtrend');

  // 4. Two or more critical quality flags at once — a one-off-driven EPS AND
  //    cash that does not back it, say — is not one caveat, it is a pattern.
  if (criticals >= 2) capTier('STRONG', 'multiple quality flags');

  // ═══════════════════════════════════════════════════════════════════════
  // THE TAPE IS NOT THE FUNDAMENTALS — a floor under the price reaction.
  //
  // Keysight grew revenue 37%, beat by 24% on EPS, and fell 11.6% on the day.
  // The reaction demotion and the reaction caveat's score penalty compounded
  // and the card read MIXED — the same grade as a company whose margins are
  // collapsing. That is the wrong reading of a sell-off: a clean print the
  // market did not pay for is precisely the setup that gets paid later
  // (post-earnings drift is built on exactly this population), and the PEAD
  // score below already measures it.
  //
  // So the tape may cost a row the TOP tier — "market confirming" has to mean
  // the market confirmed it — but on its own it can never push a row below
  // STRONG. Anything the FILING establishes still can, without limit: if the
  // cash flow, the trend or two quality flags say MIXED, MIXED it is, and the
  // floor never lifts a row above what those allow. This only undoes a
  // demotion the price alone caused.
  if (reactionDemoted) {
    const floor = worseOf(worseOf(tierOnFundamentals, filingCap), 'STRONG');
    if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(floor)) {
      tier = floor;
      if (!caveat_tags.includes('sold off — fundamentals intact')) {
        caveat_tags.push('sold off — fundamentals intact');
      }
    }
  }

  // US thin-float gate — dollar volume, not ₹Cr. Missing ADDV is NOT punished.
  const addv = p?.addv_musd ?? null;
  const thinFloat = addv != null && addv < 2;      // < $2M traded/day
  if (thinFloat) {
    if (tier === 'BLOCKBUSTER' || tier === 'STRONG') tier = 'MIXED';
    if (!caveat_tags.includes('thin float')) caveat_tags.push('thin float');
  }

  // ── PEAD (Bernard–Thomas drift proxy) ──
  const sc = (v: number | null | undefined, ranges: [number, number][]): number => {
    if (v == null || !Number.isFinite(v)) return 0;
    for (const [thr, pts] of ranges) if (v >= thr) return pts;
    return 0;
  };
  const d1Known = p?.d1_pct != null, gapKnown = p?.gap_pct != null;
  const d1S = sc(p?.d1_pct, [[8, 100], [5, 85], [3, 70], [1, 50], [0, 30], [-2, 15]]);
  const gapS = sc(p?.gap_pct, [[3, 100], [1, 75], [0, 55], [-1, 30]]);
  const surS = sc(patY, [[100, 100], [50, 80], [25, 60], [10, 40], [0, 25]]);
  const salesS = sc(salesY, [[50, 100], [25, 80], [15, 60], [5, 40], [0, 25]]);
  // Real volume confirmation (India has to hardcode this at 50).
  const volS = p?.vol_ratio_20d != null
    ? sc(p.vol_ratio_20d, [[3, 100], [2, 85], [1.5, 70], [1, 50], [0.5, 30]])
    : 50;
  const peadRaw = (d1Known || gapKnown)
    ? Math.round(d1S * 0.35 + gapS * 0.15 + volS * 0.25 + surS * 0.25)
    : Math.round(salesS * 0.25 + surS * 0.50 + volS * 0.25);
  const pead_score = Math.max(0, Math.min(100, peadRaw));

  const is_elite = !!(
    !stillLossMaking && !turnaroundBase
    && niC != null && niC > 0 && f.eps != null && f.eps > 0
    && salesY != null && salesY >= 25
    && patY != null && patY >= 30
    && opmExp != null && opmExp >= 1
    && p?.d1_pct != null && p.d1_pct >= 2
    && p?.gap_pct != null && p.gap_pct >= 0
    && criticals === 0 && stage !== 4
    && (rs == null || rs >= 60)
    && !thinFloat
  );
  const mbSignals = ((opm != null && opm >= 18) ? 1 : 0)
    + ((opmExp != null && opmExp >= 1) ? 1 : 0)
    + ((cfoPat != null && cfoPat >= 1) ? 1 : 0)
    + ((salesY != null && salesY >= 25) ? 1 : 0);
  const multibagger_setup = mbSignals >= 2 && !stillLossMaking;

  const qlCal = usQuarterLabel(f.q_end, input.filing_date);
  // The filer's own label wins when we have it — "Q2 FY27", not "Q3 CY26".
  const ql = input.fiscal_label
    ? { label: input.fiscal_label, q: qlCal.q, fy: input.fiscal_year_own ?? qlCal.fy }
    : qlCal;
  const co = input.company || input.ticker;
  const fmtP = (lbl: string, v: number | null) => v == null ? '' : (v >= 500 ? `${lbl} >500% YoY (low base)` : `${lbl} ${v >= 0 ? '+' : ''}${Math.round(v)}% YoY`);
  const head = tier === 'BLOCKBUSTER' ? `${co} prints a blockbuster ${ql.label}`
    : tier === 'STRONG' ? `${co} delivers strong ${ql.label}`
    : tier === 'MIXED' ? `${co} ${ql.label} is a mixed print`
    : `${co} ${ql.label} fails the bar`;
  const metrics = [fmtP('revenue', salesY), fmtP('net income', patY), fmtP('EPS', epsY)].filter(Boolean).join(', ');
  const uniqCav = Array.from(new Set(caveat_tags));
  const uniqMeth = Array.from(new Set(methodology_tags));
  const flavor = uniqCav.length > 0
    ? ` with caveat${uniqCav.length > 1 ? 's' : ''}: ${uniqCav.slice(0, 3).join(' + ')}.`
    : uniqMeth.length >= 2 ? ` and ${uniqMeth.join('/')} all passing.` : '.';
  const narrative = `${head} (${metrics || 'figures pending'})${flavor}`;

  // Share count cross-check. The cover-page count can be stale (see
  // sharesOutstandingFromFacts); the count implied by net income ÷ EPS is
  // always current for the quarter. If the two disagree by more than 25%,
  // trust the implied figure. Verified to fire on exactly CME, NKE, MA and
  // BRK-B across an 80-name test, and on nothing that was already right.
  let shares = input.shares_outstanding ?? null;
  if (niC != null && f.eps != null && f.eps !== 0 && niC / f.eps > 0) {
    const implied = niC / f.eps;
    if (shares == null || shares / implied < 0.8 || shares / implied > 1.25) shares = implied;
  }
  const mcap = (shares != null && p?.price != null) ? (shares * p.price) / 1e6 : null;
  const ttmEps = null; // trailing EPS needs 4 clean quarters; P/E below uses them when available
  const pe = (() => {
    // Four quarters, and — since `quarters_eps` is now built on a consecutive
    // window — four CONSECUTIVE quarters, which is what makes the sum trailing
    // twelve months rather than four quarters that happen to be on file.
    const qe = f.quarters_eps;
    if (!qe || qe.length < 4 || p?.price == null) return null;
    const sum = qe.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
    if (!(sum > 0)) return null;
    const v = p.price / sum;
    // A P/E off near-zero trailing earnings is arithmetic, not a valuation.
    // CrowdStrike earned $0.01 of GAAP EPS in the quarter and the card read
    // "P/E 1,299.5", a number no one can act on and which crowds out the
    // measures that do work for a company like that (EV/revenue, FCF yield,
    // ARR growth). Above 300x it is reported as not meaningful.
    if (!Number.isFinite(v) || v > 300) return null;
    return Math.round(v * 10) / 10;
  })();
  void ttmEps;

  return {
    ticker: input.ticker, company: co, sector: input.sector ?? null,
    filing_date: input.filing_date, period_end: f.q_end,
    quarter: ql.label, fiscal_year: ql.fy,
    form: input.form, items: input.items,
    market_cap_musd: mcap, market_cap_bucket: usCapBucket(mcap),
    price: p?.price ?? null, pe,
    revenue_curr_musd: revC != null ? Math.round(revC / 1e4) / 100 : null,
    revenue_prev_musd: revP != null ? Math.round(revP / 1e4) / 100 : null,
    net_income_curr_musd: niC != null ? Math.round(niC / 1e4) / 100 : null,
    net_income_prev_musd: niP != null ? Math.round(niP / 1e4) / 100 : null,
    eps_curr: f.eps, eps_prev: f.eps_prev, eps_derived: !!f.eps_derived,
    cfo_curr_musd: f.cfo != null ? Math.round(f.cfo / 1e4) / 100 : null,
    fcf_curr_musd: fcfC != null ? Math.round(fcfC / 1e4) / 100 : null,
    fcf_prev_musd: fcfP != null ? Math.round(fcfP / 1e4) / 100 : null,
    fcf_yoy_pct: yoyPct(fcfC, fcfP),
    sales_yoy_pct: salesY, net_profit_yoy_pct: patY, eps_yoy_pct: epsY,
    opm_pct: opm != null ? Math.round(opm * 100) / 100 : null,
    opm_prev_pct: opmPrev != null ? Math.round(opmPrev * 100) / 100 : null,
    cfo_to_pat_ratio: cfoPat != null ? Math.round(cfoPat * 100) / 100 : null,
    // The swings that a percentage cannot express. `eps_yoy_pct` above may
    // carry the ADJUSTED growth rate when the GAAP line had a loss base
    // (`usedAdjEps`), so the GAAP swing is computed from the GAAP figures
    // directly and is what the GAAP tile shows.
    eps_swing: swingKind(f.eps, f.eps_prev),
    eps_gaap_yoy_pct: epsYGaap,
    net_income_swing: swingKind(niC, niP),
    fcf_swing: swingKind(fcfC, fcfP),
    eps_adj_curr: input.adj_eps ?? null,
    eps_adj_prev: input.adj_eps_prev ?? null,
    eps_adj_yoy_pct: epsYAdj,
    eps_adj_swing: swingKind(input.adj_eps ?? null, input.adj_eps_prev ?? null),
    eps_basis_used: epsYGaap != null ? 'gaap' : epsYAdj != null ? 'adjusted' : null,
    gap_pct: p?.gap_pct ?? null, d1_pct: p?.d1_pct ?? null, move_pct: p?.move_pct ?? null,
    rs_rating: rs, stage, pct_from_52w_high: pct52,
    addv_musd: addv, vol_ratio_20d: p?.vol_ratio_20d ?? null,
    quarters_revenue: f.quarters_revenue, quarters_eps: f.quarters_eps, quarters_opm: f.quarters_opm,
    quarters_ends: f.quarters_ends, opm_basis: f.operating_income_basis,
    composite_score: Math.round(composite), tier,
    methodology_tags: uniqMeth, caveat_tags: uniqCav,
    narrative, is_elite, pead_score, multibagger_setup,
    filing_url: input.filing_url, source: 'SEC EDGAR XBRL',
    tags_used: f.tags,
  };
}

/**
 * RS rating (1–99) as a COHORT PERCENTILE.
 *
 * There is no free US equivalent of an IBD RS rating, so we build one: an
 * IBD-style weighted return (12m 40%, 6m 20%, 3m 20%, 1m 20%) percentile-ranked
 * across the day's filer cohort, then blended 50/50 with an absolute score of
 * the stock's 12-month return relative to SPY. The blend matters — a percentile
 * alone would hand a rating of 99 to the best name on a day when every filer is
 * falling. Mutates `rows` in place.
 */
// ═══════════════════════════════════════════════════════════════════════════
// POST-EARNINGS SETUP SCORE — why some great prints compound and others don't
//
// A grade answers "was this a good quarter". It does not answer the question
// the owner actually cares about, which his own post-mortem of ~42 beats put
// like this: half compounded 30–100%, half went nowhere, and *the difference is
// never the beat itself — it's what surrounds the beat*. The separators his
// framework ranks, in its own order of importance:
//
//   1  earnings surprise vs EXPECTATIONS (not vs last year)
//   2  guidance upgrade / forward commentary
//   3  institutional accumulation                    ← not available free (US)
//   4  breakout from a multi-month base
//   5  volume expansion (the institutional footprint)
//   6  operating cash-flow improvement
//   7  order book / forward visibility
//   8  valuation vs sector — "at or above the median and the beat is priced in"
//   9  margin trajectory: *the market ignores the level and prices the SLOPE*
//
// Two disciplines make this honest rather than decorative:
//
//   • Every factor shows the input it scored, so the number can be argued with.
//   • A factor we cannot source is UNAVAILABLE, never a proxy and never a
//     neutral 50 quietly averaged in. Institutional ownership and promoter
//     behaviour have no free US equivalent, so they are reported as missing and
//     the composite says how many factors it actually had. Substituting
//     something "close" for them is how a framework stops meaning anything.
// ═══════════════════════════════════════════════════════════════════════════

export type SetupFactorId =
  | 'surprise' | 'guidance' | 'breakout' | 'volume'
  | 'margin_slope' | 'cash_quality' | 'visibility' | 'valuation' | 'ownership';

export interface SetupFactor {
  id: SetupFactorId;
  label: string;
  /** 0–100, or null when the input does not exist for this filer. */
  score: number | null;
  weight: number;
  /** The input, in words — "beat consensus by 16%", "OPM +2.1pp, accelerating". */
  input: string;
  /** Why it is null. Only set when `score` is null. */
  unavailable?: string;
}

export interface SetupScore {
  score: number | null;               // 0–100, weighted over the factors we had
  factors: SetupFactor[];
  factors_scored: number;
  factors_total: number;
  /** One line: what this setup is, in the framework's vocabulary. */
  verdict: 'compounder setup' | 'needs a pullback' | 'beat already priced' | 'thin evidence' | null;
}

const SETUP_WEIGHTS: Record<SetupFactorId, number> = {
  surprise: 0.18, guidance: 0.18, breakout: 0.14, volume: 0.10,
  margin_slope: 0.12, cash_quality: 0.10, visibility: 0.10, valuation: 0.08,
  ownership: 0,   // carried so the card can say it is missing, never weighted
};

/** Linear 0–100 between `lo` (=0) and `hi` (=100), clamped. */
const band = (v: number, lo: number, hi: number) =>
  Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

/**
 * Is a percentage change off THIS base worth reading?
 *
 * MongoDB guided $0.08–$0.12 of GAAP EPS and delivered $0.50. That is a 455%
 * beat and it is a meaningless number: the base is a rounding error, and the
 * same arithmetic makes a one-cent move look like a landslide. The company's
 * revenue beat over the same quarter was 5.5%, which is the fact worth scoring.
 *
 * So a percentage is trusted only where its base is big enough to carry one:
 * a quarter of a dollar for a per-share figure, a million dollars for a dollar
 * figure. Percentage-unit guides (margins, comps) move in points and are never
 * read as a percentage OF a percentage at all.
 */
function pctIsMeaningful(unit: string | null | undefined, midpoint: number | null): boolean {
  if (midpoint == null || !Number.isFinite(midpoint)) return false;
  const m = Math.abs(midpoint);
  if (unit === 'usd_share') return m >= 0.25;
  if (unit === 'pct') return false;
  return m >= 1e6;
}
/** Rank of a guided metric as evidence of a beat — the top line first. */
const GUIDE_METRIC_RANK: Record<string, number> = {
  revenue: 0, product_revenue: 1, subscription_revenue: 1,
  operating_income: 2, ebitda: 2, net_income: 2, free_cash_flow: 3, eps: 4,
};
/**
 * The best trustworthy percentage among a set of guided lines, with the metric
 * it came from. Revenue wins ties: it is the least distortable line on the
 * statement and the one a reader can check in a second.
 */
function bestGuidePct(
  items: Array<{ metric?: string; unit?: string | null; mid: number | null; pct: number | null }>,
): { pct: number; metric: string } | null {
  const ok = items
    .filter((x) => x.pct != null && Number.isFinite(x.pct) && pctIsMeaningful(x.unit, x.mid))
    .sort((a, b) =>
      (GUIDE_METRIC_RANK[a.metric || ''] ?? 9) - (GUIDE_METRIC_RANK[b.metric || ''] ?? 9)
      || (b.pct as number) - (a.pct as number));
  if (!ok.length) return null;
  const topRank = GUIDE_METRIC_RANK[ok[0].metric || ''] ?? 9;
  const sameRank = ok.filter((x) => (GUIDE_METRIC_RANK[x.metric || ''] ?? 9) === topRank);
  const best = sameRank.reduce((a, b) => ((b.pct as number) > (a.pct as number) ? b : a));
  return { pct: best.pct as number, metric: best.metric || 'guided line' };
}

/**
 * Score one row. `peerMedianPe` comes from the cohort — see `assignSetupScores`.
 * Everything else is on the row itself, so this is pure and testable.
 */
export function setupScore(r: any, peerMedianPe: number | null): SetupScore {
  const f: SetupFactor[] = [];
  const push = (id: SetupFactorId, label: string, score: number | null, input: string, unavailable?: string) =>
    f.push({ id, label, score, weight: SETUP_WEIGHTS[id], input, ...(unavailable ? { unavailable } : {}) });
  const fin = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // 1 — SURPRISE VS EXPECTATIONS. The street's estimate first; a beat against
  // the company's OWN guide counts as much, and often more, because it is the
  // number management put its name to.
  {
    const sp = fin(r.eps_surprise_pct);
    const vg = r.vs_guide;
    const bg = bestGuidePct(((vg?.for_quarter || []) as any[]).map((it) => ({
      metric: it?.metric, unit: it?.unit, mid: fin(it?.guide_mid), pct: fin(it?.compare?.delta_pct),
    })));
    const bestGuide = bg?.pct ?? null;
    // A percentage surprise off a near-zero estimate is arithmetic noise: a
    // $0.01 estimate met by $0.52 is "+5,100%", which says nothing about how
    // big the beat was. Below a dime of estimate the beat is scored — and
    // stated — in cents, the same rule the surprise chip already uses.
    const est = fin(r.eps_estimate);
    const act = fin(r.eps_adj ?? r.eps_adj_curr);
    const pennyBase = est != null && Math.abs(est) < 0.10;
    const cents = (pennyBase && act != null && est != null) ? (act - est) : null;
    const parts: number[] = [];
    if (cents != null) parts.push(band(cents, -0.05, 0.25));
    else if (sp != null) parts.push(band(sp, -10, 25));
    if (bestGuide != null) parts.push(band(bestGuide, -5, 12));
    const desc = [
      cents != null
        ? `${cents >= 0 ? '+' : '−'}$${Math.abs(cents).toFixed(2)} vs a $${est!.toFixed(2)} consensus`
        : sp != null ? `${sp >= 0 ? '+' : ''}${sp.toFixed(0)}% vs consensus` : null,
      bestGuide != null ? `${bestGuide >= 0 ? '+' : ''}${bestGuide.toFixed(1)}% vs its own ${String(bg!.metric).replace(/_/g, ' ')} guide` : null,
    ].filter(Boolean).join(' · ');
    if (parts.length) push('surprise', 'Surprise vs expectations', parts.reduce((a, b) => a + b, 0) / parts.length, desc);
    else push('surprise', 'Surprise vs expectations', null, '—', 'no consensus and no prior guide to measure against');
  }

  // 2 — GUIDANCE DIRECTION. A raised FY outlook is the framework's second
  // separator; the size of the raise matters, not just its sign.
  {
    const chg = (r.guide_change || []) as any[];
    const bc = bestGuidePct(chg.map((c) => ({
      metric: c.metric, unit: c.unit,
      mid: (fin(c.new_low) != null && fin(c.new_high) != null) ? (c.new_low + c.new_high) / 2 : fin(c.new_low ?? c.new_high),
      pct: fin(c.delta_pct),
    })));
    const best = bc?.pct ?? null;
    const anyRaised = chg.some((x) => x.direction === 'raised');
    const anyCut = chg.some((x) => x.direction === 'lowered');
    const label = String(r.guidance || '');
    if (best != null) {
      push('guidance', 'Guidance direction', band(best, -6, 8),
        `FY ${String(bc!.metric).replace(/_/g, ' ')} outlook ${anyCut && !anyRaised ? 'cut' : anyRaised ? 'raised' : 'reiterated'} by ${best >= 0 ? '+' : ''}${best.toFixed(1)}%`);
    } else if (chg.length) {
      push('guidance', 'Guidance direction', anyRaised ? 75 : anyCut ? 15 : 50,
        `FY outlook ${anyRaised ? 'raised' : anyCut ? 'cut' : 'reiterated'} (no comparable size)`);
    } else if (label) {
      push('guidance', 'Guidance direction',
        label === 'RAISED' ? 80 : label === 'MAINTAINED' ? 50 : (label === 'LOWERED' || label === 'WITHDRAWN') ? 10 : 45,
        `release guidance ${label.toLowerCase()}`);
    } else {
      push('guidance', 'Guidance direction', null, '—', 'the release gives no outlook and there is no prior guide to compare');
    }
  }

  // 3 — BREAKOUT STRUCTURE. Stage-2 trend near the highs is the framework's
  // "earnings became the breakout trigger"; a downtrend is its "earnings
  // couldn't fight the trend".
  {
    const st = fin(r.stage), p52 = fin(r.pct_from_52w_high), rs = fin(r.rs_rating);
    if (st == null && p52 == null && rs == null) {
      push('breakout', 'Breakout structure', null, '—', 'no usable price history');
    } else {
      const parts: number[] = [];
      if (st != null) parts.push(st === 2 ? 100 : st === 1 ? 55 : st === 3 ? 30 : 5);
      if (p52 != null) parts.push(band(p52, -35, -2));
      if (rs != null) parts.push(band(rs, 30, 90));
      push('breakout', 'Breakout structure', parts.reduce((a, b) => a + b, 0) / parts.length,
        [st != null ? `stage ${st}` : null, p52 != null ? `${p52.toFixed(0)}% from 52w high` : null,
         rs != null ? `RS ${rs}` : null].filter(Boolean).join(' · '));
    }
  }

  // 4 — VOLUME EXPANSION: the institutional footprint.
  {
    const vr = fin(r.vol_ratio_20d);
    if (vr == null) push('volume', 'Volume expansion', null, '—', 'no volume history');
    else push('volume', 'Volume expansion', band(vr, 0.8, 3.5), `${vr.toFixed(1)}× the 20-day average`);
  }

  // 5 — MARGIN SLOPE, NOT LEVEL. The framework is explicit: "Market ignores
  // absolute margin levels; it prices the slope." So this scores the CHANGE in
  // the operating margin and whether that change is accelerating across the
  // last four quarters — a good margin that stopped improving scores poorly on
  // purpose.
  {
    const s = r.series;
    const opm: Array<number | null> = [];
    if (s && Array.isArray(s.revenue) && Array.isArray(s.operating_income)) {
      for (let i = 0; i < s.revenue.length; i++) {
        const rev = fin(s.revenue[i]), oi = fin(s.operating_income[i]);
        opm.push(rev != null && rev > 0 && oi != null ? (oi / rev) * 100 : null);
      }
    }
    const tail = opm.slice(-4).filter((v): v is number => v != null);
    const yoy = fin(r.opm_pct) != null && fin(r.opm_prev_pct) != null
      ? (r.opm_pct as number) - (r.opm_prev_pct as number) : null;
    if (yoy == null && tail.length < 3) {
      push('margin_slope', 'Margin slope', null, '—', 'not enough margin history');
    } else {
      const parts: number[] = [];
      if (yoy != null) parts.push(band(yoy, -3, 4));
      let accel: number | null = null;
      if (tail.length >= 3) {
        // Is the improvement itself getting bigger? Last step vs the average of
        // the earlier steps.
        const steps: number[] = [];
        for (let i = 1; i < tail.length; i++) steps.push(tail[i] - tail[i - 1]);
        const last = steps[steps.length - 1];
        const earlier = steps.slice(0, -1);
        const avgEarlier = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0;
        accel = last - avgEarlier;
        parts.push(band(accel, -2, 2));
      }
      push('margin_slope', 'Margin slope', parts.reduce((a, b) => a + b, 0) / parts.length,
        [yoy != null ? `OPM ${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}pp YoY` : null,
         accel != null ? (accel >= 0.1 ? 'expansion accelerating' : accel <= -0.1 ? 'expansion slowing' : 'expansion steady') : null,
        ].filter(Boolean).join(' · '));
    }
  }

  // 6 — CASH-FLOW QUALITY. "The market rewards quality of earnings, not
  // accounting profit."
  {
    const c2p = fin(r.cfo_to_pat_ratio);
    const s = r.series;
    let fcfTrend: number | null = null;
    if (s && Array.isArray(s.fcf)) {
      const v = (s.fcf as Array<number | null>).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      if (v.length >= 5) {
        const last4 = v.slice(-4).reduce((a, b) => a + b, 0);
        const prev4 = v.slice(-8, -4);
        if (prev4.length === 4) {
          const p = prev4.reduce((a, b) => a + b, 0);
          if (p > 0) fcfTrend = ((last4 - p) / Math.abs(p)) * 100;
        }
      }
    }
    if (c2p == null && fcfTrend == null) {
      push('cash_quality', 'Cash-flow quality', null, '—', 'cash-flow statement not on EDGAR yet');
    } else {
      const parts: number[] = [];
      if (c2p != null) parts.push(band(c2p, 0.3, 1.4));
      if (fcfTrend != null) parts.push(band(fcfTrend, -20, 40));
      push('cash_quality', 'Cash-flow quality', parts.reduce((a, b) => a + b, 0) / parts.length,
        [c2p != null ? `CFO/NI ${c2p.toFixed(2)}` : null,
         fcfTrend != null ? `TTM FCF ${fcfTrend >= 0 ? '+' : ''}${fcfTrend.toFixed(0)}% YoY` : null].filter(Boolean).join(' · '));
    }
  }

  // 7 — FORWARD VISIBILITY. The India losers "reported quarterly beats without
  // a credible multi-year forward guide". The US equivalent of an order book is
  // RPO / cRPO / backlog / ARR — contracted revenue the filer states itself.
  {
    const km = (r.key_metrics || []) as any[];
    const wanted = new Set(['rpo', 'crpo', 'backlog', 'arr', 'net_new_arr', 'nrr']);
    const hits = km.filter((m) => wanted.has(String(m?.id)));
    const growths = hits.map((m) => fin(m?.yoy_pct)).filter((v): v is number => v != null);
    if (!hits.length) {
      const nFigs = (r.guidance_figures || []).length;
      if (nFigs > 0) push('visibility', 'Forward visibility', Math.min(60, 30 + nFigs * 6),
        `${nFigs} guided line${nFigs > 1 ? 's' : ''}, no contracted-revenue metric disclosed`);
      else push('visibility', 'Forward visibility', null, '—', 'no backlog, RPO or ARR disclosed and no guided figures');
    } else if (growths.length) {
      const best = Math.max(...growths);
      push('visibility', 'Forward visibility', band(best, 0, 35),
        hits.map((m) => `${String(m.id).toUpperCase().replace(/_/g, ' ')}${fin(m.yoy_pct) != null ? ` ${m.yoy_pct >= 0 ? '+' : ''}${Number(m.yoy_pct).toFixed(0)}%` : ''}`).join(' · '));
    } else {
      push('visibility', 'Forward visibility', 55,
        `${hits.map((m) => String(m.id).toUpperCase().replace(/_/g, ' ')).join(' · ')} disclosed, no growth rate stated`);
    }
  }

  // 8 — VALUATION VS THE COHORT. "Is trailing P/E below the sector median? If
  // P/E > sector median at earnings, the beat is already priced." The median is
  // computed across the day's own filer cohort, so it moves with the market
  // rather than being a number typed in once.
  {
    const pe = fin(r.pe);
    if (pe == null || pe <= 0) {
      // Don't guess WHY it is missing. A loss makes P/E meaningless; so does a
      // PRELIM row whose trailing earnings are not yet complete, and the two
      // are indistinguishable from here.
      push('valuation', 'Valuation vs cohort', null, '—',
        pe == null ? 'no P/E on this row — trailing earnings incomplete or the company is loss-making'
                   : 'negative earnings — P/E is not meaningful');
    } else if (peerMedianPe == null || peerMedianPe <= 0) {
      push('valuation', 'Valuation vs cohort', null, '—', 'too few priced peers in this window to form a median');
    } else {
      const rel = pe / peerMedianPe;                 // <1 = cheaper than the cohort
      push('valuation', 'Valuation vs cohort', band(2 - rel, 0.4, 1.4),
        `P/E ${pe.toFixed(0)} vs cohort median ${peerMedianPe.toFixed(0)} (${rel < 1 ? `${((1 - rel) * 100).toFixed(0)}% below` : `${((rel - 1) * 100).toFixed(0)}% above`})`);
    }
  }

  // 9 — INSTITUTIONAL CROWDING. The framework's third-ranked separator and its
  // single clearest loser signal ("no marginal buyer left"). There is no free
  // US feed for it — 13F data is quarterly, lagged 45 days and covers only
  // institutions above $100m, which is not the same question. Reported as
  // missing rather than approximated by float or liquidity, which measure
  // something else entirely.
  push('ownership', 'Institutional crowding', null, '—',
    'no free US source — 13F is quarterly and lagged, and float or liquidity is not a substitute');

  const scored = f.filter((x) => x.score != null && x.weight > 0);
  const wsum = scored.reduce((a, x) => a + x.weight, 0);
  const score = wsum >= 0.45 && scored.length >= 4
    ? Math.round(scored.reduce((a, x) => a + (x.score as number) * x.weight, 0) / wsum)
    : null;

  const by = (id: SetupFactorId) => f.find((x) => x.id === id)?.score ?? null;
  let verdict: SetupScore['verdict'] = null;
  if (score == null) verdict = 'thin evidence';
  else if (score >= 70 && (by('breakout') ?? 0) >= 55) verdict = 'compounder setup';
  // The framework's loser archetype: the numbers were fine, the price already
  // holds them — rich against the cohort with the trend no longer working.
  else if ((by('valuation') ?? 100) < 35 && (by('breakout') ?? 100) < 50) verdict = 'beat already priced';
  else if (score >= 55) verdict = 'needs a pullback';
  else verdict = 'beat already priced';

  return { score, factors: f, factors_scored: scored.length, factors_total: f.length - 1, verdict };
}

/**
 * Score every row against the cohort it reported with. Mutates in place, like
 * `assignRsRatings` — the cohort median P/E is the piece no single row can
 * know, and recomputing it per row would be both slower and inconsistent.
 */
export function assignSetupScores(rows: any[]): void {
  const pes = rows.map((r) => (typeof r?.pe === 'number' && Number.isFinite(r.pe) && r.pe > 0 ? r.pe : null))
    .filter((v): v is number => v != null).sort((a, b) => a - b);
  // Fewer than five priced names is not a cohort; the factor reports itself
  // unavailable rather than measuring a stock against two others.
  const median = pes.length >= 5
    ? (pes.length % 2 ? pes[(pes.length - 1) / 2] : (pes[pes.length / 2 - 1] + pes[pes.length / 2]) / 2)
    : null;
  for (const r of rows) r.setup = setupScore(r, median);
}


// ═══════════════════════════════════════════════════════════════════════════
// RULE OF 40 AND ROCE
//
// The Rule of 40 is the owner's own screen: revenue growth % + free-cash-flow
// margin %. A company at 10% growth and 70% FCF margin scores 80; so does one
// at 70% growth burning 30%. Forty is the line.
//
// Both halves are measured on a TRAILING TWELVE MONTHS basis, not on one
// quarter. A single quarter's FCF margin swings on the timing of a tax payment
// or an inventory build — Dollar Tree's quarterly FCF grew 4,228% against a
// near-zero base — and a rule read off that number would rank companies by
// their working-capital calendar. Four quarters cancels the seasonality out.
// The quarter's own YoY growth is used only when there is not yet a full year
// of history, and the row says which basis it used.
//
// ROCE is EBIT ÷ capital employed (total assets − current liabilities), with
// EBIT on the same trailing-twelve-month basis. It is deliberately NOT computed
// for a filer with no classified balance sheet: a bank's "current liabilities"
// are its deposits, and the ratio that comes out of that arithmetic is not a
// return on capital employed by any definition.
// ═══════════════════════════════════════════════════════════════════════════

export interface Rule40 {
  score: number | null;          // growth% + fcf margin%
  growth_pct: number | null;
  fcf_margin_pct: number | null;
  basis: 'ttm' | 'quarter';
  passes: boolean | null;        // score >= 40
}

/** Sum the last `n` finite values of a series, or null if fewer than n exist. */
function tailSum(arr: Array<number | null> | null | undefined, n: number): number | null {
  if (!Array.isArray(arr)) return null;
  const v = arr.slice(-n);
  if (v.length < n) return null;
  let s = 0;
  for (const x of v) { if (typeof x !== 'number' || !Number.isFinite(x)) return null; s += x; }
  return s;
}

export function rule40From(
  series: UsQuarterSeries | null | undefined,
  quarterGrowthPct: number | null,
  quarterRevenueMusd: number | null,
  quarterFcfMusd: number | null,
): Rule40 {
  const none: Rule40 = { score: null, growth_pct: null, fcf_margin_pct: null, basis: 'quarter', passes: null };
  if (series) {
    const rev4 = tailSum(series.revenue, 4);
    const fcf4 = tailSum(series.fcf, 4);
    // The prior four quarters, for a like-for-like growth rate.
    const prior = series.revenue.length >= 8
      ? tailSum(series.revenue.slice(0, -4), 4) : null;
    if (rev4 != null && rev4 > 0 && fcf4 != null) {
      const margin = (fcf4 / rev4) * 100;
      const growth = (prior != null && prior > 0) ? ((rev4 - prior) / prior) * 100 : quarterGrowthPct;
      if (growth != null && Number.isFinite(growth)) {
        const score = growth + margin;
        return {
          score: Math.round(score * 10) / 10,
          growth_pct: Math.round(growth * 10) / 10,
          fcf_margin_pct: Math.round(margin * 10) / 10,
          basis: 'ttm', passes: score >= 40,
        };
      }
    }
  }
  // Fall back to the quarter, and say so.
  if (quarterGrowthPct != null && quarterRevenueMusd != null && quarterRevenueMusd > 0 && quarterFcfMusd != null) {
    const margin = (quarterFcfMusd / quarterRevenueMusd) * 100;
    const score = quarterGrowthPct + margin;
    return {
      score: Math.round(score * 10) / 10,
      growth_pct: Math.round(quarterGrowthPct * 10) / 10,
      fcf_margin_pct: Math.round(margin * 10) / 10,
      basis: 'quarter', passes: score >= 40,
    };
  }
  return none;
}

export interface Roce {
  pct: number | null;
  ebit_ttm_musd: number | null;
  capital_employed_musd: number | null;
  basis: 'ttm' | null;
  /** Why it is null, when it is. */
  unavailable?: string;
}

export function roceFrom(series: UsQuarterSeries | null | undefined, ctx: UsBalanceContext | null | undefined): Roce {
  if (!series || !ctx) return { pct: null, ebit_ttm_musd: null, capital_employed_musd: null, basis: null, unavailable: 'no history or balance sheet' };
  const ebit = tailSum(series.operating_income, 4);
  if (ebit == null) return { pct: null, ebit_ttm_musd: null, capital_employed_musd: null, basis: null, unavailable: 'no four full quarters of operating income' };
  const ta = ctx.total_assets_musd, cl = ctx.current_liabilities_musd;
  if (ta == null || cl == null) {
    return { pct: null, ebit_ttm_musd: Math.round(ebit * 100) / 100, capital_employed_musd: null, basis: null,
      unavailable: 'the filer does not present a classified balance sheet' };
  }
  const cap = ta - cl;
  if (!(cap > 0)) {
    return { pct: null, ebit_ttm_musd: Math.round(ebit * 100) / 100, capital_employed_musd: Math.round(cap * 100) / 100, basis: null,
      unavailable: 'capital employed is zero or negative' };
  }
  return {
    pct: Math.round((ebit / cap) * 1000) / 10,
    ebit_ttm_musd: Math.round(ebit * 100) / 100,
    capital_employed_musd: Math.round(cap * 100) / 100,
    basis: 'ttm',
  };
}

export function assignRsRatings(
  rows: Array<{ ret1m: number | null; ret3m: number | null; ret6m: number | null; ret12m: number | null; rs_rating: number | null }>,
  spyRet12m: number | null,
): void {
  const blended = rows.map((r) => {
    const parts: Array<[number | null, number]> = [[r.ret12m, 0.4], [r.ret6m, 0.2], [r.ret3m, 0.2], [r.ret1m, 0.2]];
    let s = 0, w = 0;
    for (const [v, wt] of parts) if (v != null && Number.isFinite(v)) { s += v * wt; w += wt; }
    return w > 0 ? s / w : null;
  });
  const known = blended.filter((x): x is number => x != null).slice().sort((a, b) => a - b);
  for (let i = 0; i < rows.length; i++) {
    const b = blended[i];
    if (b == null) { rows[i].rs_rating = null; continue; }
    // percentile within cohort
    let lo = 0;
    while (lo < known.length && known[lo] < b) lo++;
    const pct = known.length > 1 ? (lo / (known.length - 1)) * 100 : 50;
    // absolute leg: 12m return vs SPY, mapped onto 1-99
    const rel = (rows[i].ret12m != null && spyRet12m != null) ? rows[i].ret12m! - spyRet12m : null;
    const abs = rel == null ? 50
      : rel >= 60 ? 95 : rel >= 40 ? 88 : rel >= 25 ? 80 : rel >= 12 ? 70
      : rel >= 0 ? 58 : rel >= -10 ? 45 : rel >= -25 ? 32 : rel >= -40 ? 20 : 8;
    rows[i].rs_rating = Math.max(1, Math.min(99, Math.round(pct * 0.5 + abs * 0.5)));
  }
}
