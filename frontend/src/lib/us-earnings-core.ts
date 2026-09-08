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
};

export type UsFactKind = 'revenue' | 'operating_income' | 'net_income' | 'eps' | 'cfo' | 'diluted_shares' | 'capex';

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

/**
 * Choose the tag that this filer actually uses, by coverage — not by hoping the
 * first name in the list exists. Scores quarterly windows 10x, annual 3x, with
 * a small nudge for priority order. Restricted to the last ~3.3 years so a tag
 * a company abandoned in 2015 can't win.
 */
export function pickConcept(facts: any, kind: UsFactKind): string | null {
  const cutoffMs = Date.now() - 1200 * dayMs;
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

  // REVENUE — pick by coverage, then SANITY-CHECK the winner against net
  // income and operating income for the latest quarter. For a bank the
  // ASC-606 tag (`RevenueFromContractWithCustomer…`) captures only fee income
  // and drops all net interest income: CFG came out at $451m against a true
  // $2,283m, ESS (a REIT, rent is ASC 842 not 606) at $2.3m against $489m,
  // AXP at $11.2bn against $19.6bn. A revenue line that is smaller than the
  // quarter's net income, or that implies a >200% operating margin, is the
  // wrong line — fall through to the next candidate.
  {
    const cutoffMs = Date.now() - 1200 * dayMs;
    const cands: Array<{ c: string; score: number; q: Record<string, number> }> = [];
    const list = US_TAGS.revenue;
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
      if (!(rev > 0)) return false;
      const near = (m: Record<string, number>) => {
        if (m[e] !== undefined) return m[e];
        for (const k of Object.keys(m)) if (Math.abs(diffDays(k, e)) <= 4) return m[k];
        return undefined;
      };
      const ni = near(qs.net_income), oi = near(qs.operating_income);
      if (ni !== undefined && Math.abs(ni) > rev * 1.05) return false;
      if (oi !== undefined && Math.abs(oi) > rev * 2) return false;
      return true;
    };
    let chosen = cands.find((x) => sane(x.q)) || cands[0] || null;
    // When several candidates are sane, the LARGEST latest-quarter figure is
    // the total-revenue line (fee income is a subset of total revenue).
    if (chosen) {
      const saneOnes = cands.filter((x) => sane(x.q) && x.score >= chosen!.score * 0.5);
      if (saneOnes.length > 1) {
        const latestVal = (q: Record<string, number>) => { const k = Object.keys(q).sort(); return q[k[k.length - 1]]; };
        saneOnes.sort((a, b) => latestVal(b.q) - latestVal(a.q));
        chosen = saneOnes[0];
      }
    }
    tags.revenue = chosen ? chosen.c : null;
    qs.revenue = chosen ? chosen.q : {};
  }

  const revEnds = Object.keys(qs.revenue).sort();
  if (!revEnds.length) return { ...empty, tags, error: 'no quarterly revenue' };

  // Pin to the quarter the filing reports, when we know it; else newest.
  let cur = revEnds[revEnds.length - 1];
  if (asOfPeriodEnd) {
    let bestGap = Infinity;
    for (const e of revEnds) {
      const gap = Math.abs(diffDays(e, asOfPeriodEnd));
      if (gap <= 45 && gap < bestGap) { cur = e; bestGap = gap; }
    }
  }
  const prev = yoyPartner(revEnds, cur);

  // Period ends can differ by a day or two between statements within one filing
  // (e.g. cash-flow tagged to the fiscal month-end, P&L to the 52/53-week end).
  const at = (kind: UsFactKind, end: string | null): number | null => {
    if (!end) return null;
    const m = qs[kind];
    if (m[end] !== undefined) return m[end];
    for (const k of Object.keys(m)) if (Math.abs(diffDays(k, end)) <= 4) return m[k];
    return null;
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
  let epsDerived = false;
  const epsAt = (end: string | null, isCur = false): number | null => {
    if (!end) return null;
    const direct = at('eps', end);
    if (direct != null) return direct;
    const ni = at('net_income', end);
    if (ni == null) return null;
    // Prefer the quarter's own diluted count; else the latest quarterly count
    // on file (share counts drift slowly); else the fiscal-year average.
    let sh = at('diluted_shares', end);
    if (sh == null) {
      const ends = Object.keys(qs.diluted_shares).filter((e) => e <= end).sort();
      if (ends.length) sh = qs.diluted_shares[ends[ends.length - 1]];
    }
    if (sh == null) sh = fyShares();
    if (!sh || sh <= 0) return null;
    if (isCur) epsDerived = true;
    return Math.round((ni / sh) * 100) / 100;
  };

  const last4 = (kind: UsFactKind, scale: number): number[] | null => {
    const ends = Object.keys(qs[kind]).filter((e) => e <= cur).sort().slice(-4);
    if (ends.length < 2) return null;
    return ends.map((e) => Math.round(qs[kind][e] / scale * 100) / 100);
  };
  const last4Eps = (): number[] | null => {
    const ends = Object.keys(qs.revenue).filter((e) => e <= cur).sort().slice(-4);
    const out: number[] = [];
    for (const e of ends) { const v = epsAt(e); if (v != null) out.push(v); }
    return out.length >= 2 ? out : null;
  };
  const opmSeries = (): number[] | null => {
    const ends = Object.keys(qs.revenue).filter((e) => e <= cur).sort().slice(-4);
    const out: number[] = [];
    for (const e of ends) {
      const r = qs.revenue[e]; const o = at('operating_income', e);
      if (!r || o == null) continue;
      out.push(Math.round((o / r) * 1000) / 10);
    }
    return out.length >= 2 ? out : null;
  };

  // When did the current quarter's numbers first hit EDGAR? Latest `filed`
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

  return {
    q_end: cur, q_end_prev: prev, q_filed: qFiled(), tags,
    revenue: at('revenue', cur), revenue_prev: at('revenue', prev),
    operating_income: at('operating_income', cur), operating_income_prev: at('operating_income', prev),
    net_income: at('net_income', cur), net_income_prev: at('net_income', prev),
    eps: epsAt(cur, true), eps_prev: epsAt(prev),
    eps_derived: epsDerived,
    cfo: at('cfo', cur), cfo_prev: at('cfo', prev),
    capex: at('capex', cur), capex_prev: at('capex', prev),
    quarters_revenue: last4('revenue', 1e6), quarters_eps: last4Eps(), quarters_opm: opmSeries(),
  };
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
