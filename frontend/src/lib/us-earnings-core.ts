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
// THE FOUR TRAPS THIS MODULE HANDLES (all verified on real filings)
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
  operating_income: [
    'OperatingIncomeLoss',
    // Banks and insurers do not report an operating line at all; pre-tax
    // income is the nearest honest equivalent (two spellings in the wild).
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
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

/** A value out of a quarter map, tolerating the 1–3 day drift between the
 *  period ends different statements inside one filing are tagged to. */
function atMap(m: Record<string, number>, end: string | null | undefined): number | null {
  if (!end) return null;
  if (m[end] !== undefined) return m[end];
  for (const k of Object.keys(m)) if (Math.abs(diffDays(k, end)) <= 4) return m[k];
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
      if (Object.keys(q).some((e) => dnum(e) >= cutoffMs)) return { concept: c, q };
    }
  }
  return { concept: chosen ? chosen.c : null, q: chosen ? chosen.q : {} };
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
  quarters_revenue: number[] | null;   // last 4 discrete quarters, oldest → newest
  quarters_eps: number[] | null;
  quarters_opm: number[] | null;
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
}

function buildGrid(facts: any, asOfPeriodEnd?: string | null): UsQuarterGrid | null {
  if (!facts?.facts?.['us-gaap']) return null;

  const tags: Partial<Record<UsFactKind, string | null>> = {};
  const qs: Record<string, Record<string, number>> = {};
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
  // Ratios / averages: never synthesize Q4 by subtraction.
  for (const kind of ['eps', 'diluted_shares'] as UsFactKind[]) {
    const c = pickConcept(facts, kind);
    tags[kind] = c;
    qs[kind] = c ? quarterize(ser(c), false, false) : {};
  }
  {
    const r = chooseRevenue(facts, ser, qs.net_income, qs.operating_income);
    tags.revenue = r.concept;
    qs.revenue = r.q;
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
  // blank against real $0.96 / $0.27. For Q4 the share count is the fiscal
  // year's average, taken as FY net income ÷ FY EPS (both are always tagged).
  const fyShares = (): number | null => {
    const niC = tags.net_income ? ser(tags.net_income) : [];
    const epC = tags.eps ? ser(tags.eps) : [];
    const fy = niC.filter((r) => r.days >= 330 && r.days <= 380).sort((a, b) => b.end.localeCompare(a.end))[0];
    if (!fy) return null;
    const fe = epC.find((r) => r.days >= 330 && r.days <= 380 && Math.abs(diffDays(r.end, fy.end)) <= 4);
    if (!fe || !fe.val) return null;
    return fy.val / fe.val;
  };
  const deriveEps = (end: string, ni: number | null): { v: number | null; derived: boolean } => {
    if (ni == null) return { v: null, derived: false };
    // Prefer the quarter's own diluted count; else the latest quarterly count
    // on file (share counts drift slowly); else the fiscal-year average.
    let sh = at('diluted_shares', end);
    if (sh == null) {
      const es = Object.keys(qs.diluted_shares).filter((e) => e <= end).sort();
      if (es.length) sh = qs.diluted_shares[es[es.length - 1]];
    }
    if (sh == null) sh = fyShares();
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

  return { tags, qs, ser, ends, cur, prev, at, atYoy, epsAt, epsYoy };
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

  const last4 = (kind: UsFactKind, scale: number): number[] | null => {
    const es = Object.keys(qs[kind]).filter((e) => e <= cur).sort().slice(-4);
    if (es.length < 2) return null;
    return es.map((e) => Math.round(qs[kind][e] / scale * 100) / 100);
  };
  const last4Eps = (): number[] | null => {
    const es = ends.filter((e) => e <= cur).slice(-4);
    const out: number[] = [];
    for (const e of es) { const v = g.epsAt(e).v; if (v != null) out.push(v); }
    return out.length >= 2 ? out : null;
  };
  const opmSeries = (): number[] | null => {
    // Margin needs revenue, so this walks the REVENUE quarters, not the wider
    // revenue-or-net-income universe — otherwise a filer whose net income is
    // tagged for more quarters than its revenue loses the series entirely.
    const revEnds = Object.keys(qs.revenue).sort();
    const es = (revEnds.length ? revEnds : ends).filter((e) => e <= cur).slice(-4);
    const out: number[] = [];
    for (const e of es) {
      const r = at('revenue', e); const o = at('operating_income', e);
      if (!r || o == null) continue;
      out.push(Math.round((o / r) * 1000) / 10);
    }
    return out.length >= 2 ? out : null;
  };

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
    quarters_revenue: last4('revenue', 1e6), quarters_eps: last4Eps(), quarters_opm: opmSeries(),
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
  const gpC = pickConcept(facts, 'gross_profit');
  const gpQ = gpC ? quarterize(g.ser(gpC), false) : {};
  const costC = pickConcept(facts, 'cost_of_revenue');
  const costQ = costC ? quarterize(g.ser(costC), false) : {};

  const out: UsQuarterSeries = {
    ends, revenue: [], gross_profit: [], operating_income: [], net_income: [], eps: [], cfo: [], fcf: [],
  };
  for (const e of ends) {
    const rev = g.at('revenue', e);
    let gp = atMap(gpQ, e);
    if (gp == null) {
      const cost = atMap(costQ, e);
      if (rev != null && cost != null) gp = rev - cost;
    }
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
  };

  const instCache = new Map<string, InstFact[]>();
  const inst = (c: string) => {
    if (!instCache.has(c)) instCache.set(c, instantSeries(facts, c));
    return instCache.get(c)!;
  };
  const balanceTags = [...CASH_TAGS, ...ST_INVESTMENT_TAGS, DEBT_CURRENT_TOTAL,
    ...DEBT_CURRENT_PARTS, ...DEBT_SHORT_TERM_BORROWINGS, ...DEBT_NONCURRENT_TAGS, DEBT_TOTAL_TAG];

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
      const q = quarterize(ser(c), false, false);
      const niC = pickConcept(facts, 'net_income');
      const epsC = pickConcept(facts, 'eps');
      const qNi = niC ? quarterize(ser(niC), false) : {};
      const qEps = epsC ? quarterize(ser(epsC), false, false) : {};
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

  quarters_revenue: number[] | null;
  quarters_eps: number[] | null;
  quarters_opm: number[] | null;

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
  const cfoPat = (f.cfo != null && niC != null && niC > 0) ? f.cfo / niC : null;
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
  if (epsY != null && salesY != null && salesY > 0 && epsY >= salesY * 3 && epsY >= 50) caveat_tags.push('optical eps');
  if (epsY != null && epsY >= 200 && !caveat_tags.includes('optical eps')) caveat_tags.push('optical eps');
  if (f.eps_prev != null && f.eps != null && Math.abs(f.eps_prev) < 0.05 && Math.abs(f.eps) > 0.2
      && !caveat_tags.includes('optical eps')) caveat_tags.push('optical eps');
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
  if (stage === 4) caveat_tags.push('low quality');
  else if (pct52 != null && pct52 < -25) caveat_tags.push('low quality');

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

  {
    const mr = marketReactionDelta(tier, p?.d1_pct, p?.gap_pct);
    tier = mr.tier;
    for (const c of mr.addCaveats) if (!caveat_tags.includes(c)) caveat_tags.push(c);
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

  const criticals = caveat_tags.filter((t) => t === 'low quality' || t === 'ocf divergence' || t === 'optical eps').length;
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
    const qe = f.quarters_eps;
    if (!qe || qe.length < 4 || p?.price == null) return null;
    const sum = qe.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
    if (!(sum > 0)) return null;
    return Math.round((p.price / sum) * 10) / 10;
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
