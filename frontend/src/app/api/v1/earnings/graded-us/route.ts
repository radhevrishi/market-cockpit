// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/earnings/graded-us?date=YYYY-MM-DD&days=N
//
// The US mirror of /api/v1/earnings/graded. Same payload contract, same tier
// vocabulary, same shared decideTier — fed entirely by FREE data:
//   SEC EDGAR full-text search  →  who filed an earnings 8-K (Item 2.02)
//   SEC EDGAR companyfacts XBRL →  revenue / operating income / net income /
//                                  EPS / cash flow, current + year-ago quarter
//   Yahoo chart v8              →  price, reaction, volume, 52w, moving averages
//
// WHY `days` EXISTS (this is the important design note)
// ──────────────────────────────────────────────────────
// A company announces results in an 8-K on day D, but the XBRL numbers only
// reach EDGAR when the 10-Q is filed — sometimes the same day, often days or
// weeks later. So a strict single-day view would only ever grade the subset
// that files both together, and would look broken on every other day. The
// endpoint therefore grades a ROLLING WINDOW ending on `date` (default 5
// sessions), de-duplicated per ticker with the newest filing winning. Filers
// whose XBRL has not landed yet are counted and reported in
// `pending_xbrl_total` rather than silently dropped, so the UI can say exactly
// how many names are still waiting on their numbers.
//
// STALE-QUARTER GUARD — the US analogue of India's PATCH 0182 attribution
// guard. If companyfacts still holds only the PREVIOUS quarter when the 8-K
// lands, grading it would attribute three-month-old numbers to today's filing.
// Any candidate whose newest quarter ends more than MAX_QUARTER_LAG_DAYS
// before the filing date is treated as "XBRL pending", never graded.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import {
  earningsFilersOn, companyFacts, cikTickerMap, tickerToCik, submissions, announcementDateFor,
  sharesOutstandingFromFacts, sectorFromSic, isFinancialSic,
  type EdgarFiling,
} from '@/lib/us-edgar';
import { usTechnicals, spyReturn12m, pooled, yahooLastError, yahooEarningsHistory, yahooForwardEstimates, type UsTechnicals, type EpsHistoryRow, type ForwardEstimate } from '@/lib/us-prices';
import { nasdaqEarningsOn, type ExpectedReporter } from '@/lib/us-nasdaq';
import { guidanceFromFiling, releaseDocument, type Guidance } from '@/lib/us-guidance';
import { financialsFromReleaseHtml, periodEndFromReleaseHtml } from '@/lib/us-pr-financials';
import { balanceSheetFromReleaseHtml } from '@/lib/us-pr-balance';
import { adjustedEpsFromReleaseHtml, epsEstimateBasisConflict, vendorSurpriseUsable, type AdjustedEps, type VendorEpsRow } from '@/lib/us-pr-adjusted';
import { type GuidanceFigure } from '@/lib/us-guidance-figures';
import { type KeyMetric } from '@/lib/us-key-metrics';
import {
  extractFundamentals, gradeUsRow, assignRsRatings,
  fiscalPeriodFromFacts, usFiscalLabel, nextFiscalYear, fiscalYearEndingAt,
  quarterSeries, balanceContext, assignSetupScores, rule40From, roceFrom, splitFactorSince,
  US_TIER_ORDER, type UsGradedRow, type EarningsTier, type UsBalanceContext,
} from '@/lib/us-earnings-core';
import { priorGuidanceFor, compareToGuide, type GuideVsActual } from '@/lib/us-prior-guidance';
import { quadrantScore } from '@/lib/earnings-grade-shared';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Hard cap on companyfacts fetches per request (peak season can exceed 400 filers/day). */
const MAX_CANDIDATES = 240;
/** A quarter older than this relative to the filing date means XBRL hasn't caught up. */
const MAX_QUARTER_LAG_DAYS = 110;
const DEFAULT_WINDOW_DAYS = 5;

/** A company that announced in the window but could not be graded yet. Listed
 *  rather than silently dropped — "nothing was lost, the numbers just aren't
 *  on EDGAR yet" is very different information from "no results today". */
interface PendingFiler {
  ticker: string;
  company: string;
  form: string;
  filed: string;
  filing_url: string;
  reason: 'xbrl-not-posted' | 'quarter-stale' | 'no-price' | 'reported-earlier';
}

interface UsGradedPayload {
  filing_date: string | null;
  window_days: number;
  window_start: string | null;
  candidates_total: number;
  raw_items_total: number;
  pending_xbrl_total: number;
  no_price_total: number;
  by_tier: Record<EarningsTier, UsGradedRow[]>;
  pending: PendingFiler[];
  /** Names Nasdaq expects to report on `filing_date` that have not filed yet —
   *  the India "scheduled today · results pending" list. Empties as 8-Ks land. */
  scheduled: ExpectedReporter[];
  generated_at: string;
  sources_polled: number;
  truncated: boolean;
  notes: string[];
}

// ─── server-side cache ─────────────────────────────────────────────────────
// A completed past window never changes → hold it long. Windows that include
// today keep moving as prices tick and late 10-Qs land → 15 minutes, matching
// the India route.
const _cache = new Map<string, { at: number; ttl: number; data: UsGradedPayload }>();
const CACHE_MAX = 60;

function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}
const dayMs = 86_400_000;
const isoAddDays = (iso: string, n: number) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / dayMs);

/**
 * Pair each of the consensus feed's EARLIER quarters with the filer's own GAAP
 * diluted EPS for that same quarter, from XBRL.
 *
 * This is the witness list `epsEstimateBasisConflict` uses to establish which
 * basis a feed publishes for a given company. SentinelOne's feed returns
 * −0.18 / −0.33 / −0.23 as its "actuals" for three prior quarters and the
 * filer's XBRL says −0.18 / −0.33 / −0.23 — that feed is quoting and settling
 * on GAAP, which is why its estimate for the graded quarter is a GAAP estimate
 * and not the adjusted one the card was pairing it with.
 *
 * The vendor keys a row by fiscal-quarter END and a 52/53-week filer's quarter
 * ends drift, so a row is matched to the nearest series quarter within 45 days
 * — the same tolerance the current quarter is matched on — and left unpaired
 * when nothing is that close. An unpaired row is simply not a witness.
 */
function vendorRowsWithGaap(
  rows: EpsHistoryRow[],
  exclude: EpsHistoryRow | null,
  series: { ends: string[]; eps: (number | null)[] } | null,
): VendorEpsRow[] {
  if (!series) return [];
  const out: VendorEpsRow[] = [];
  for (const r of rows) {
    if (r === exclude || !r.quarter) continue;
    let gaap: number | null = null;
    let best = 46;
    for (let i = 0; i < series.ends.length; i++) {
      const d = Math.abs(daysBetween(series.ends[i], r.quarter));
      if (d < best && series.eps[i] != null) { best = d; gaap = series.eps[i]; }
    }
    out.push({ estimate: r.eps_estimate, actual: r.eps_actual, gaapEps: gaap });
  }
  return out;
}

function fmtYoy(cur: number, prev: number): string {
  if (prev <= 0) return 'n/m';
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return `${p >= 0 ? '+' : ''}${Math.round(p)}%`;
}

/**
 * Attach the street estimate to each guidance figure — matched by WHEN the
 * guided period ends, never by how close the numbers look.
 *
 * Why this is the only safe rule. Yahoo's estimate feed labels its entries
 * "0q / +1q / 0y / +1y", and those labels do not mean the same thing for every
 * filer: for Palo Alto, "0q" is the quarter it just REPORTED, and "0y" and
 * "+1y" both carry an end date of 2027-07-31 while holding $11.4B and $16.2B of
 * revenue — two different fiscal years, one date. A matcher that picks the
 * closest number to the guidance (which is what this did first) quietly chose
 * $16.19B as the consensus for a $14.1–14.2B guide, and a reader has no way to
 * see that it is the wrong year.
 *
 * So the period is computed from the filer's OWN calendar instead: we know the
 * quarter it just reported (its fiscal number and the date it ended), and each
 * guidance figure names the period it guides, so the number of quarters between
 * them is arithmetic. The estimate must sit on that date (±20 days) or no
 * estimate is shown. When two entries land on the same date with materially
 * different values, the feed is contradicting itself and nothing is shown.
 * Nothing here depends on a particular company, a particular year, or Yahoo's
 * labelling staying the way it is today.
 */
/**
 * WHY EVERY FIGURE NOW CARRIES A REASON WHEN IT CARRIES NO ESTIMATE.
 *
 * SentinelOne's Q2 FY27 card showed six guided lines and exactly one street
 * comparison ("Revenue $309.0M–$311.0M (Est. $310M) ≈ in line"). The other five
 * rows were bare, and a bare row is ambiguous in the worst possible direction:
 * a reader cannot tell "the street had nothing for this" from "nobody checked",
 * and next to a green "Guidance raised" chip the silence reads as agreement.
 * It was not — SentinelOne guided FY27 adjusted EPS BELOW the street.
 *
 * So the absence is now a value, not a gap. Nothing is invented: where the feed
 * has no number for a metric, the card says so and shows no verdict.
 */
type EstAbsentReason =
  | 'metric-not-covered'    // the consensus feed carries revenue and EPS only
  | 'basis-mismatch'        // a published EPS consensus may only meet an adjusted guide
  | 'period-unmatched'      // no estimate lands on the guided period's end date
  | 'ambiguous-feed'        // two different numbers for the same date
  | 'implausible';          // the only candidate is not the same quantity (see the 3x gate)

// NOT EXPORTED, DELIBERATELY. A Next.js route module may only export the HTTP
// handlers and the route config; anything else makes the generated route type
// fail to satisfy its constraint, which is one of the errors `tsc` reports for
// this file. Nothing outside this module has ever imported it — the two
// references to it elsewhere are prose in comments — so file-local is what it
// always meant to be.
function withEstimates(
  figs: GuidanceFigure[],
  fwd: ForwardEstimate[],
  reported: { period_end: string | null; fiscal_q: number | null; fiscal_fy: number | null },
): Array<GuidanceFigure & { est?: number | null; est_absent?: EstAbsentReason | null }> {
  const bare = (f: GuidanceFigure, why: EstAbsentReason) => ({ ...f, est: null, est_absent: why });
  // The feed itself carries only the two series below; a guide to operating
  // income, EBITDA, margins or free cash flow has no consensus here to meet,
  // and inventing one would be the worst defect this file could ship.
  const covered = (f: GuidanceFigure) =>
    (f.metric === 'revenue' || f.metric === 'eps') && f.unit !== 'pct' && f.low != null && f.high != null;
  if (!figs.length || !fwd.length) return figs.map((f) => bare(f, covered(f) ? 'period-unmatched' : 'metric-not-covered'));
  const { period_end, fiscal_q, fiscal_fy } = reported;
  if (!period_end || !fiscal_q || !fiscal_fy) {
    return figs.map((f) => bare(f, covered(f) ? 'period-unmatched' : 'metric-not-covered'));
  }

  const QUARTER_DAYS = 91.31;
  /** How many quarters after the reported one does this figure's period end? */
  const quartersAhead = (f: GuidanceFigure): number | null => {
    const m = /^Q([1-4])(?:\s+FY(\d{2}))?$/.exec(f.period_label);
    const y = /^FY(\d{2})$/.exec(f.period_label);
    if (m) {
      const q = Number(m[1]);
      const fy = m[2] ? 2000 + Number(m[2]) : null;
      if (fy == null) return q > fiscal_q ? q - fiscal_q : q - fiscal_q + 4;   // unlabelled: the next one round
      return (fy - fiscal_fy) * 4 + (q - fiscal_q);
    }
    if (y) {
      const fy = 2000 + Number(y[1]);
      // A fiscal year ends with its Q4.
      return (fy - fiscal_fy) * 4 + (4 - fiscal_q);
    }
    if (f.period_label === 'full year') return fiscal_q < 4 ? 4 - fiscal_q : 4;
    return null;
  };

  const endMs = Date.parse(period_end + 'T00:00:00Z');
  return figs.map((f) => {
    if (!covered(f)) return bare(f, 'metric-not-covered');
    // A published EPS consensus is a NON-GAAP number by convention, so it may
    // only sit beside the adjusted line. NetApp guides both ($9.73–10.03
    // adjusted, $7.35–7.65 GAAP); printing the same $10.01 estimate against the
    // GAAP range invents a miss that nobody is forecasting.
    if (f.metric === 'eps' && f.basis !== 'adjusted') return bare(f, 'basis-mismatch');
    const qa = quartersAhead(f);
    if (qa == null || qa < 1 || qa > 8) return bare(f, 'period-unmatched');
    const wantMs = endMs + qa * QUARTER_DAYS * 86_400_000;
    // A QUARTER AND A YEAR CAN END ON THE SAME DAY, AND USUALLY DO.
    //
    // The feed's period token says which of the two an entry is ("+1q" vs
    // "0y"), and a fiscal year always ends on the last day of its fourth
    // quarter — so for any January filer the Q4 estimate and the FY estimate
    // carry the identical end date. Matching on the date alone made those two
    // entries look like the feed contradicting itself, and the whole comparison
    // was refused: SentinelOne's FY27 revenue guide of $1.202–$1.207B found
    // "+1q" ($325.8M) and "0y" ($1.2049B) both sitting on 2027-01-31, 73% apart,
    // and came back with no estimate at all — which is why the card carried a
    // street verdict on the quarter's revenue and on nothing else. A figure that
    // guides a quarter may only meet a quarterly estimate, and a figure that
    // guides a year may only meet an annual one. The ambiguity test below still
    // stands for the case it was written for — Palo Alto's "0y" and "+1y" BOTH
    // ending 2027-07-31 with $11.4B and $16.2B, two years on one date, which no
    // rule can separate and which is therefore still refused.
    const wantKind = f.period === 'year' ? 'y' : 'q';
    const near = fwd.filter((e) => {
      if (!e.end_date) return false;
      if (!String(e.period || '').endsWith(wantKind)) return false;
      const v = f.metric === 'revenue' ? e.revenue : e.eps;
      if (v == null || !Number.isFinite(v)) return false;
      return Math.abs(Date.parse(e.end_date + 'T00:00:00Z') - wantMs) <= 20 * 86_400_000;
    });
    if (near.length !== 1) {
      // Either nothing lands on that date, or the feed offers two different
      // numbers for it — in both cases the honest answer is no estimate.
      if (near.length < 2) return bare(f, 'period-unmatched');
      const vals = near.map((e) => (f.metric === 'revenue' ? e.revenue! : e.eps!));
      const spread = (Math.max(...vals) - Math.min(...vals)) / Math.max(1e-9, Math.abs(Math.max(...vals)));
      if (spread > 0.02) return bare(f, 'ambiguous-feed');
    }
    const v = f.metric === 'revenue' ? near[0].revenue! : near[0].eps!;
    // A last sanity gate: a consensus more than 3x away from the guide is not
    // the same quantity however the dates line up. It is not always a period
    // error: for SentinelOne (ticker S) the feed's per-share series is GAAP —
    // its "actual" for the July 2026 quarter is −$0.27, the release's GAAP EPS,
    // not the $0.08 non-GAAP figure the company guides on — so a −$0.79 FY27
    // estimate arrives against a $0.30–$0.32 adjusted guide. The two numbers
    // are on different bases and no verdict may be drawn between them. The
    // ratio catches every sign flip and every order-of-magnitude mismatch this
    // produces, and refusing is the only correct answer: the real non-GAAP
    // consensus is not in any source this engine holds.
    const mid = ((f.low as number) + (f.high as number)) / 2;
    if (mid !== 0 && (v / mid > 3 || v / mid < 0.33)) return bare(f, 'implausible');
    return { ...f, est: v, est_absent: null };
  });
}

function isWeekend(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6;
}

/**
 * The actual figure to measure a guidance item against — from the FILING, on
 * the SAME basis the guide was given on, or nothing at all.
 *
 * The temptation is to reach for whatever number is nearest to hand. That is
 * how a wrong sentence gets printed: Yahoo's "adjusted actual" is not always
 * the filer's own adjusted EPS (for Burlington it returns the GAAP figure),
 * and pairing it with an adjusted guide manufactures a beat that did not
 * happen. So each metric is paired only where the pairing is provable, and the
 * adjusted-EPS pairing additionally requires the street figure to actually
 * DIFFER from the GAAP figure — if they are the same number, the feed is
 * carrying GAAP under an adjusted name and the comparison is refused.
 */
function actualForGuide(
  g: GuideVsActual,
  f: { revenue: number | null; operating_income: number | null; net_income: number | null; eps: number | null },
  extra: { adj_eps: number | null; fcf: number | null; gross_profit: number | null },
): number | null {
  // A FULL-YEAR guide cannot be scored against one quarter. Dell guided
  // $165–169B for FY27 and delivered $46.97B in Q2 — a true statement about
  // the quarter and an absurd one about the guide ("missed by 71.9%"). What a
  // full-year outlook did is captured by `guideChange` — whether the company
  // raised it, cut it or left it alone — and that is the only honest reading
  // until the fourth quarter closes the year.
  if (g.period !== 'quarter') return null;
  const fin = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const rev = fin(f.revenue);
  switch (g.metric) {
    // Revenue is revenue: a filer that reports a non-GAAP revenue line is rare
    // enough that the GAAP top line is the honest comparison either way, and
    // the basis is carried on the row so the reader can see which was guided.
    case 'revenue': return rev;
    case 'operating_income': return g.basis === 'gaap' ? fin(f.operating_income) : null;
    case 'net_income': return g.basis === 'gaap' ? fin(f.net_income) : null;
    case 'free_cash_flow': return fin(extra.fcf);
    case 'eps': {
      if (g.basis === 'gaap') return fin(f.eps);
      const adj = fin(extra.adj_eps), gaap = fin(f.eps);
      if (adj == null) return null;
      // Same number as GAAP → the feed is not carrying an adjusted figure.
      if (gaap != null && Math.abs(adj - gaap) <= 0.011) return null;
      return adj;
    }
    case 'operating_margin': {
      const oi = fin(f.operating_income);
      return (g.basis === 'gaap' && oi != null && rev && rev > 0) ? (oi / rev) * 100 : null;
    }
    case 'gross_margin': {
      const gp = fin(extra.gross_profit);
      return (g.basis === 'gaap' && gp != null && rev && rev > 0) ? (gp / rev) * 100 : null;
    }
    // EBITDA, comparable sales and the revenue subsets are press-release
    // constructs with no GAAP equivalent to check them against. No comparison
    // is better than one built on a proxy.
    default: return null;
  }
}

/**
 * Did the shares split between the two releases?
 *
 * CrowdStrike split 4-for-1 in July 2026. Its previous release guided FY27
 * non-GAAP EPS of $4.88–$4.96 on the old share count; this release guides
 * $1.25–$1.26 on the new one. Both statements are true and the comparison
 * between them is nonsense — the card said "lowered the FY27 adj. EPS guide by
 * 74.5%" about a company that raised it, and "missed its guide by $0.85" about
 * a quarter it beat.
 *
 * The proof does not need a corporate-actions feed. Two consecutive guides for
 * the SAME metric, basis and period that differ by a clean whole-number factor
 * are the same guide expressed on two share counts: no company revises an
 * outlook by exactly 4.000×. So the factor is detected from the filer's own two
 * statements, and every per-share comparison drawn from that prior release is
 * then refused rather than rescaled — a guide restated by us is no longer the
 * company's guide.
 */
/**
 * FISCAL-YEAR LABELS ARE NOT WRITTEN THE SAME TWICE. The same year appears as
 * "FY27", "FY2027", "fiscal 2027", "fiscal year 2027" and "FY '27" across two
 * consecutive releases from one filer, so requiring the two strings to match
 * exactly was silently disabling the split guard — CrowdStrike's card kept
 * saying it "lowered the FY27 adj. EPS guide by 74.5%" about a 4-for-1 split.
 * Reduce every spelling to the last two digits of the year and compare that.
 */
function fyKey(s: string | null | undefined): string {
  const m = String(s || '').toUpperCase().match(/(?:FY|FISCAL(?:\s+YEAR)?)?\s*'?\s*(\d{4}|\d{2})\b/);
  if (!m) return '';
  return 'FY' + (m[1].length === 4 ? m[1].slice(2) : m[1]);
}

function perShareSplitFactor(current: GuidanceFigure[], prior: GuideVsActual[]): number | null {
  const mid = (lo: number | null | undefined, hi: number | null | undefined) =>
    lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi ?? null);
  for (const c of current) {
    if (c.unit !== 'usd_share') continue;
    const same = prior.filter((x) => x.unit === 'usd_share' && x.metric === c.metric && x.basis === c.basis);
    // Prefer the entry whose fiscal year matches; where neither side spells a
    // year out, one unambiguous candidate for the metric is enough.
    const ck = fyKey(c.period_label);
    const p = same.find((x) => ck !== '' && fyKey(x.guided_for_label) === ck)
      ?? (same.length === 1 ? same[0] : undefined);
    if (!p) continue;
    const nm = mid(c.low, c.high), pm = mid(p.guide_low, p.guide_high);
    if (nm == null || pm == null || !(nm > 0) || !(pm > 0)) continue;
    for (const [a, b] of [[pm, nm], [nm, pm]] as Array<[number, number]>) {
      const r = a / b;
      const k = Math.round(r);
      // 2:1 through 20:1 covers every split a US issuer actually does, forward
      // or reverse; 1% is far tighter than any real guidance revision is round.
      if (k >= 2 && k <= 20 && Math.abs(r / k - 1) <= 0.01) return k;
    }
  }
  return null;
}

/**
 * THE SPLIT GUARD, WITH THE FILER'S OWN RECORD AS THE FIRST WITNESS.
 *
 * Inferring a split from two guidance ranges is a last resort: it only works
 * when both releases guided the same per-share metric for the same period and
 * both were parsed. The filer states the split itself, in XBRL — the
 * conversion-ratio element, and every share count it re-presented afterwards —
 * and `splitFactorSince` reads it. So ask EDGAR first, and only fall back to
 * the ratio between two guides when EDGAR is silent (a filer that tags neither
 * signal, or a split announced but not yet restated).
 *
 * Either way the consequence is the same and deliberate: per-share comparisons
 * drawn from the pre-split release are REFUSED, never rescaled. A guide we
 * restated is no longer the company's guide.
 */
function splitSincePriorRelease(
  facts: any,
  priorFilingDate: string | null | undefined,
  current: GuidanceFigure[],
  prior: GuideVsActual[],
): number | null {
  if (priorFilingDate) {
    const k = splitFactorSince(facts, String(priorFilingDate));
    if (k != null && Number.isFinite(k) && Math.abs(k - 1) > 0.01) return k;
  }
  return perShareSplitFactor(current, prior);
}

/**
 * The benchmark to print beside a tile: what the number was expected to be.
 *
 * An earnings feed writes "Adj Gross Margin: 75.0% (Est. 75%)". That estimate is
 * bought from a consensus vendor, and no free source carries a consensus gross
 * margin, EBITDA or free cash flow — only revenue and EPS, and even those only
 * until the feed rolls to the next quarter (Yahoo still holds NetApp's July
 * quarter and has already dropped NVIDIA's).
 *
 * What IS always available, for every metric a company chose to guide, is the
 * range the company itself put its name to a quarter ago. That is a better
 * benchmark than consensus, not a worse one: it is the number management was
 * measured against. So each tile gets whichever exists — the street's estimate
 * where the feed still points at the reported quarter, the filer's own guide
 * otherwise — and is explicit about which of the two it is showing.
 */
interface TileRef {
  low: number | null; high: number | null; unit: string;
  basis: 'gaap' | 'adjusted' | null;
  source: 'guide' | 'estimate';
  /** in-line when the actual lands inside the range; a point range gets ±0.5%. */
  verdict: 'above' | 'below' | 'in-line' | null;
  actual: number | null;
}
/**
 * Signed, never sized. Every guided metric this is used for — revenue, EPS,
 * EBITDA, margin, free cash flow — is one where HIGHER IS BETTER whatever the
 * sign, so the comparison is a position on the number line and nothing here
 * takes an absolute value except the point-guide tolerance, which is a width.
 * Titan Machinery's −$1.75 to −$1.25 adjusted-EPS range is the case that makes
 * the distinction visible: a −$1.40 actual lands inside it and is IN-LINE, a
 * −$1.10 actual is above it (a smaller loss, so a beat), and a magnitude
 * comparison would have inverted both.
 */
function tileVerdict(low: number | null, high: number | null, actual: number | null): TileRef['verdict'] {
  if (actual == null || low == null && high == null) return null;
  const lo = Math.min(low ?? high!, high ?? low!);
  const hi = Math.max(low ?? high!, high ?? low!);
  if (lo === hi) {
    const tol = Math.abs(lo) * 0.005;
    return actual > hi + tol ? 'above' : actual < lo - tol ? 'below' : 'in-line';
  }
  return actual > hi ? 'above' : actual < lo ? 'below' : 'in-line';
}


/**
 * Build the per-tile benchmarks. Keyed by the metric the tile shows, so the
 * card can look one up without knowing where it came from.
 */
function tileRefs(
  forQuarter: Array<GuideVsActual & { actual: number | null }>,
  streetRevenue: { est: number | null; actual: number | null },
): Record<string, TileRef> {
  const out: Record<string, TileRef> = {};
  for (const g of forQuarter) {
    // One entry per metric; a GAAP guide is the honest benchmark for a GAAP
    // tile and an adjusted guide for an adjusted one, so both are kept under
    // distinct keys rather than one overwriting the other.
    const key = g.basis === 'adjusted' ? `${g.metric}:adjusted` : g.metric;
    if (out[key]) continue;
    out[key] = {
      low: round6(g.guide_low), high: round6(g.guide_high), unit: g.unit,
      basis: g.basis, source: 'guide',
      actual: round6(g.actual), verdict: tileVerdict(g.guide_low, g.guide_high, g.actual),
    };
  }
  // The street's revenue number, but only while the feed still points at the
  // quarter that was reported. It is a point estimate, so the same ±0.5% band
  // a point guide gets applies.
  if (streetRevenue.est != null && streetRevenue.actual != null) {
    out['revenue:street'] = {
      low: round6(streetRevenue.est), high: round6(streetRevenue.est), unit: 'usd',
      basis: null, source: 'estimate',
      actual: round6(streetRevenue.actual),
      verdict: tileVerdict(streetRevenue.est, streetRevenue.est, streetRevenue.actual),
    };
  }
  return out;
}

/**
 * The street's revenue estimate for the quarter just reported — matched by the
 * date the estimate's period ends, never by which slot the feed calls "0q".
 * After a company reports, the feed rolls that slot forward to the NEXT quarter;
 * taking it regardless would print next quarter's consensus beside this
 * quarter's revenue. So it is used only when its end date really is this
 * quarter's, and is simply absent for every filer whose feed has moved on.
 */
function streetRevenueFor(fwd: ForwardEstimate[], periodEnd: string | null): number | null {
  if (!periodEnd || !fwd.length) return null;
  const hits = fwd.filter((f) => f.end_date && f.revenue != null
    && Math.abs(daysBetween(periodEnd, f.end_date)) <= 20);
  if (hits.length !== 1) return null;              // ambiguous or absent → nothing
  return hits[0].revenue;
}

/** A guidance item plus the verdict, ready for the card. */
function withActual(
  items: GuideVsActual[],
  f: { revenue: number | null; operating_income: number | null; net_income: number | null; eps: number | null },
  extra: { adj_eps: number | null; fcf: number | null; gross_profit: number | null },
  splitBetween = false,
) {
  return items.map((g) => {
    // A per-share guide given before a split cannot be measured against a
    // post-split actual, and restating it would put our arithmetic in the
    // company's mouth. Say nothing instead.
    if (splitBetween && g.unit === 'usd_share') {
      return { ...g, actual: null, compare: null, refused: 'shares split since this guide was given' };
    }
    const actual = actualForGuide(g, f, extra);
    const withA = { ...g, actual };
    return { ...withA, compare: actual == null ? null : compareToGuide(withA, actual) };
  });
}

/**
 * How this quarter's outlook moved against the one given a quarter ago.
 *
 * "Raised FY27 revenue guidance by 1.3%" is a different fact from "beat the
 * quarter", and it is often the one that moves the stock. Both sides come from
 * the filers' own releases — this release's figures against the previous
 * release's figures for the SAME metric, basis and period label — so nothing is
 * inferred and a company that simply repeated itself reads "reiterated".
 */
/** Kill float artefacts before publishing: 2075000000.0000002 is $2.075B. */
const round6 = (v: number | null | undefined): number | null =>
  (typeof v === 'number' && Number.isFinite(v))
    ? (Math.abs(v) >= 1 ? Math.round(v * 1e4) / 1e4 : Math.round(v * 1e6) / 1e6)
    : null;

function guideChange(
  current: GuidanceFigure[],
  priorYear: GuideVsActual[],
  knownSplit?: number | null,
): Array<{
  metric: string; basis: string | null; period_label: string | null;
  prev_low: number | null; prev_high: number | null;
  new_low: number | null; new_high: number | null;
  direction: 'raised' | 'lowered' | 'reiterated' | 'narrowed' | 'widened';
  delta_pct: number | null; unit: string;
}> {
  const out: ReturnType<typeof guideChange> = [];
  const mid = (lo: number | null, hi: number | null) =>
    lo != null && hi != null ? (lo + hi) / 2 : lo ?? hi ?? null;
  // The caller has already asked EDGAR whether the shares split; only fall back
  // to inferring it from the two ranges when it has not.
  const split = (knownSplit != null && Math.abs(knownSplit - 1) > 0.01)
    ? knownSplit : perShareSplitFactor(current, priorYear);
  for (const c of current) {
    if (c.period !== 'year') continue;                 // only the FY guide is comparable across releases
    if (split && c.unit === 'usd_share') continue;     // two share counts, not a revision — see above
    const p = priorYear.find((x) => x.metric === c.metric && x.basis === c.basis
      && fyKey(x.guided_for_label) === fyKey(c.period_label));
    if (!p) continue;
    const nm = mid(c.low, c.high), pm = mid(p.guide_low, p.guide_high);
    if (nm == null || pm == null) continue;
    const span = (lo: number | null, hi: number | null) =>
      lo != null && hi != null ? Math.abs(hi - lo) : null;
    const ns = span(c.low, c.high), ps = span(p.guide_low, p.guide_high);
    // "Unchanged" has to have a tolerance: a filer that rounds $14.06–$14.12 to
    // $14.05–$14.15 has not raised anything.
    const rel = Math.abs(pm) > 1e-9 ? (nm - pm) / Math.abs(pm) : null;
    const same = rel != null ? Math.abs(rel) < 0.002 : nm === pm;
    let direction: 'raised' | 'lowered' | 'reiterated' | 'narrowed' | 'widened';
    // A range that moved out at BOTH ends widened; calling that "lowered"
    // because its midpoint slipped 0.5% (Autodesk: $8.07-8.63 to $7.89-8.72)
    // describes the arithmetic and misses what the company did.
    const widened = c.low != null && c.high != null && p.guide_low != null && p.guide_high != null
      && c.low < p.guide_low && c.high > p.guide_high;
    const narrowed = c.low != null && c.high != null && p.guide_low != null && p.guide_high != null
      && c.low > p.guide_low && c.high < p.guide_high;
    if (widened) direction = 'widened';
    else if (narrowed && same) direction = 'narrowed';
    else if (!same) direction = nm > pm ? 'raised' : 'lowered';
    else if (narrowed) direction = 'narrowed';
    else direction = 'reiterated';
    out.push({
      metric: c.metric, basis: c.basis, period_label: c.period_label,
      prev_low: round6(p.guide_low), prev_high: round6(p.guide_high),
      new_low: round6(c.low), new_high: round6(c.high),
      direction,
      // A percentage change in a percentage guide is meaningless — margins and
      // comps move in points, so the delta stays absolute for them.
      delta_pct: c.unit === 'pct' ? null : rel != null ? rel * 100 : null,
      unit: c.unit,
    });
  }
  return out;
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === '1';
  const explicit = (searchParams.get('tickers') || '').trim();

  const today = etToday();
  let date = (searchParams.get('date') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
  if (date > today) date = today;                      // never grade the future

  let days = parseInt(searchParams.get('days') || '', 10);
  if (!Number.isFinite(days) || days < 1) days = DEFAULT_WINDOW_DAYS;
  days = Math.min(days, 15);

  const cacheKey = explicit ? `T:${explicit}` : `${date}|${days}`;
  if (!force) {
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() - hit.at < hit.ttl) {
      return NextResponse.json(hit.data, {
        headers: { 'x-mc-cache': 'hit', 'Cache-Control': 'private, max-age=60' },
      });
    }
  }

  const notes: string[] = [];
  let truncated = false;

  try {
    // ── 1. gather the filer set ──────────────────────────────────────────
    let filings: EdgarFiling[] = [];
    let windowStart: string | null = null;
    let reportedEarlier: EdgarFiling[] = [];

    if (explicit) {
      // Debug / verification path: grade an explicit ticker list off each
      // company's most recent filing. Used to eyeball the engine against a
      // known source without waiting for a filing day.
      const wanted = explicit.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
      const resolved = await pooled(wanted, 6, async (t) => ({ t, cik: await tickerToCik(t) }));
      const unresolved: string[] = [];
      const subs = await pooled(resolved.filter((r) => r?.cik), 5, async (r) => ({ r, s: await submissions(r!.cik!) }));
      for (const r of resolved) if (r && !r.cik) unresolved.push(r.t);
      for (const x of subs) {
        if (!x?.r?.cik) continue;
        // Use the company's most recent earnings 8-K as the event so the
        // reaction window is real, not today's date.
        let filed = date;
        const last202 = x.s?.recent.find((f) => f.form === '8-K' && f.items.includes('2.02'));
        if (last202?.filingDate) filed = last202.filingDate;
        filings.push({
          cik: String(x.r.cik).padStart(10, '0'), cikNum: x.r.cik!,
          ticker: x.r.t, company: x.s?.name || x.r.t, form: last202 ? '8-K' : '10-Q',
          items: last202?.items || [], accession: last202?.accession || '',
          filed, period: null, sic: x.s?.sic || null,
          filing_url: last202
            ? `https://www.sec.gov/Archives/edgar/data/${x.r.cik}/${last202.accession.replace(/-/g, '')}/${last202.accession}-index.htm`
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${x.r.t}&type=8-K`,
        });
      }
      if (unresolved.length) notes.push(`unresolved tickers (no SEC match): ${unresolved.join(', ')}`);
      notes.push('explicit-ticker mode: each name is graded off its most recent earnings 8-K');
    } else {
      const dates: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = isoAddDays(date, -i);
        if (!isWeekend(d)) dates.push(d);               // EDGAR generates nothing on weekends
      }
      windowStart = dates.length ? dates[dates.length - 1] : date;
      const perDay = await pooled(dates, 3, (d) => earningsFilersOn(d));
      const byCik = new Map<number, EdgarFiling>();
      for (const list of perDay) {
        for (const f of (list || [])) {
          const prev = byCik.get(f.cikNum);
          // An 8-K in the window beats a 10-Q in the window for the same company.
          if (!prev) { byCik.set(f.cikNum, f); continue; }
          const prevIs8K = prev.form === '8-K', curIs8K = f.form === '8-K';
          if (curIs8K && !prevIs8K) byCik.set(f.cikNum, f);
          else if (curIs8K === prevIs8K && f.filed > prev.filed) byCik.set(f.cikNum, f);
        }
      }
      filings = Array.from(byCik.values());

      // A 10-Q/10-K is usually NOT the announcement — the press release (8-K
      // Item 2.02) came days or weeks earlier. HD, CSCO and KEYS were showing
      // up 1–3 weeks after the market had traded their prints because their
      // 10-Q landed in the window. Re-date each periodic filer to its real
      // announcement; if that falls before the window, it was reported earlier
      // and is listed as such rather than graded as fresh.
      const periodic = filings.filter((f) => f.form !== '8-K');
      const redated = await pooled(periodic, 5, async (f) => ({ f, a: await announcementDateFor(f.cikNum, f.filed) }));
      const dropEarlier = new Set<number>();
      for (const x of redated) {
        if (!x) continue;
        if (x.a.via === '8-K') {
          if (x.a.date < windowStart!) { dropEarlier.add(x.f.cikNum); x.f.filed = x.a.date; }
          else { x.f.filed = x.a.date; x.f.form = '8-K'; x.f.items = ['2.02']; }
        }
      }
      reportedEarlier = filings.filter((f) => dropEarlier.has(f.cikNum));
      filings = filings.filter((f) => !dropEarlier.has(f.cikNum));
    }

    const rawTotal = filings.length;

    // Resolve any ticker the display name did not carry, then drop unlisted
    // filers (funds, trusts, private filers) — nothing to price or grade.
    const cikMap = await cikTickerMap();
    for (const f of filings) if (!f.ticker) f.ticker = cikMap.get(f.cikNum) || null;
    let listed = filings.filter((f) => !!f.ticker);
    listed.sort((a, b) => (b.filed.localeCompare(a.filed)) || a.company.localeCompare(b.company));
    if (listed.length > MAX_CANDIDATES) {
      listed = listed.slice(0, MAX_CANDIDATES);
      truncated = true;
      notes.push(`filer set truncated to the ${MAX_CANDIDATES} most recent listed filings`);
    }

    // ── 2. prices + technicals (cheap, parallel) ─────────────────────────
    const spy12 = await spyReturn12m();
    const techs = await pooled(listed, 8, (f) => usTechnicals(f.ticker!, f.filed));

    const pending: PendingFiler[] = [];
    const addPending = (f: EdgarFiling, reason: PendingFiler['reason']) => {
      pending.push({
        ticker: f.ticker || '', company: f.company, form: f.form,
        filed: f.filed, filing_url: f.filing_url, reason,
      });
    };
    for (const f of reportedEarlier) addPending(f, 'reported-earlier');

    const withPrice: Array<{ f: EdgarFiling; t: UsTechnicals }> = [];
    let noPrice = 0;
    for (let i = 0; i < listed.length; i++) {
      const t = techs[i];
      if (!t) { noPrice++; addPending(listed[i], 'no-price'); continue; }
      withPrice.push({ f: listed[i], t });
    }

    // ── 3. fundamentals from companyfacts ────────────────────────────────
    const facts = await pooled(withPrice, 5, (x) => companyFacts(x.f.cikNum));

    interface Prepared {
      f: EdgarFiling; t: UsTechnicals; shares: number | null; facts: any;
      fundamentals: ReturnType<typeof extractFundamentals>;
    }
    const prepared: Prepared[] = [];
    const awaitingXbrl: Array<{ f: EdgarFiling; t: UsTechnicals; facts: any }> = [];   // candidates for a PRELIM grade
    let pendingXbrl = 0;
    for (let i = 0; i < withPrice.length; i++) {
      const fx = facts[i];
      const { f, t } = withPrice[i];
      if (!fx) { pendingXbrl++; addPending(f, 'xbrl-not-posted'); awaitingXbrl.push({ f, t, facts: null }); continue; }
      // For a 10-Q/10-K the reported period IS the fiscal period; for an 8-K,
      // `period_ending` is the event date, so let the extractor take the newest.
      const asOf = /^10-/.test(f.form) && f.period ? f.period : null;
      const fund = extractFundamentals(fx, asOf);
      if (!fund.q_end) { pendingXbrl++; addPending(f, 'xbrl-not-posted'); awaitingXbrl.push({ f, t, facts: fx }); continue; }
      // Stale-quarter guard — see header note. The 8-K is real but the XBRL on
      // file is last quarter's: a PRELIM candidate too.
      if (daysBetween(f.filed, fund.q_end) > MAX_QUARTER_LAG_DAYS) {
        pendingXbrl++; addPending(f, 'quarter-stale'); awaitingXbrl.push({ f, t, facts: fx }); continue;
      }
      // Already-public guard. If the quarter's figures reached EDGAR more than
      // 7 days BEFORE the filing we are crediting, this filing is not the
      // announcement. AIN's 1 Sep 8-K carried an Item 2.02 header for a
      // strategic-review update; its Q2 numbers had been on EDGAR since the
      // 4 Aug 10-Q, and the market had traded the print four weeks earlier.
      if (!explicit && fund.q_filed && daysBetween(f.filed, fund.q_filed) > 7) {
        addPending(f, 'reported-earlier'); continue;
      }
      prepared.push({ f, t, facts: fx, shares: sharesOutstandingFromFacts(fx, fund.q_end), fundamentals: fund });
    }

    // ── 4. cohort RS, consensus, then grade ──────────────────────────────
    assignRsRatings(prepared.map((p) => p.t), spy12);
    // Surprise must be like-for-like: Nasdaq's ADJUSTED actual vs ADJUSTED
    // consensus. Comparing the filing's GAAP EPS to a street estimate made
    // Toro look like a 38% miss on a quarter it beat on the basis analysts
    // actually use. The GAAP figure stays in the YoY tile; the surprise chip
    // is street vs street.
    const [surprises, guidances, forwards, prAdj] = await Promise.all([
      pooled(prepared, 6, (p) => yahooEarningsHistory(p.f.ticker!)),
      // Guidance lives in the 8-K's press-release exhibit; a 10-Q-only filer
      // has no release to read.
      pooled(prepared, 4, (p) => (p.f.form === '8-K' && p.f.accession)
        ? guidanceFromFiling(p.f.cikNum, p.f.accession, p.f.filing_url)
        : Promise.resolve<Guidance>({ label: null, score: 0, snippets: [], source_url: null, fiscal_label: null, fiscal_q: null, fiscal_fy: null, figures: [], metrics: [], absent_reason: null, absent_doc_url: null, absent_doc_label: null })),
      // The street's number for the period being guided — the "(Est. $5.54B)"
      // an earnings feed prints beside a raised outlook.
      pooled(prepared, 6, (p) => yahooForwardEstimates(p.f.ticker!)),
      // THE FILER'S OWN ADJUSTED EPS, read from the release it published.
      //
      // The consensus feed's "actual" is not reliably the company's adjusted
      // figure. For Gap it returns the GAAP $1.38 against an adjusted estimate,
      // manufacturing a +181% beat where the truth is $0.52 and about +6%; for
      // SentinelOne it returns GAAP \u2212$0.27 where the company reported
      // +$0.08, inverting the sign of the verdict and the caveat tag it drives;
      // and for six filers it returned a modelled number that appears nowhere
      // in any filing at all. A number narrated as "the company's adjusted EPS"
      // has to come from the company.
      pooled(prepared, 4, async (p): Promise<{ read: boolean; adj: AdjustedEps | null }> => {
        if (p.f.form !== '8-K' || !p.f.accession) return { read: false, adj: null };
        try {
          const doc = await releaseDocument(p.f.cikNum, p.f.accession, p.f.filing_url);
          if (!doc.html) return { read: false, adj: null };
          return {
            read: true,
            adj: adjustedEpsFromReleaseHtml(doc.html, {
              gaapEps: p.fundamentals.eps ?? null,
              periodEndISO: p.fundamentals.q_end ?? null,
            }),
          };
        } catch { return { read: false, adj: null }; }
      }),
    ]);

    // The prior release's guidance is bound to the reported quarter by the
    // FILER'S OWN fiscal label, which is why this runs after the guidance
    // fetch rather than beside it. NetApp's July quarter is "Q1 FY27" to
    // NetApp and to every figure in both releases, and "fy 2026 Q1" to SEC's
    // fy/fp fields — binding on the SEC label silently matched nothing, and
    // NetApp's card showed no own-guide comparison at all despite both
    // releases carrying one. The press-release headline is the authority; the
    // XBRL fields are the fallback.
    const priors = await pooled(prepared.map((p, i) => ({ p, i })), 4, async ({ p, i }) => {
      if (p.f.form !== '8-K' || !p.f.accession || !p.fundamentals.q_end) return null;
      const g0 = guidances[i];
      const fq0 = fiscalPeriodFromFacts(p.facts, p.fundamentals.q_end);
      const q = g0?.fiscal_q ?? fq0.q ?? null;
      const fy = g0?.fiscal_fy ?? fq0.fy ?? null;
      try {
        return await priorGuidanceFor({
          cikNum: p.f.cikNum, currentAccession: p.f.accession, currentFilingDate: p.f.filed,
          reportedPeriodEnd: p.fundamentals.q_end,
          reportedFiscalQ: q, reportedFiscalFy: fy,
        });
      } catch { return null; }
    });

    const graded: UsGradedRow[] = [];
    for (let pi = 0; pi < prepared.length; pi++) {
      const p = prepared[pi];
      const sRows: EpsHistoryRow[] = surprises[pi] || [];
      const g = guidances[pi] || { label: null, score: 0, snippets: [], source_url: null, fiscal_label: null, fiscal_q: null, fiscal_fy: null, figures: [], metrics: [] };
      // Yahoo keys the row by fiscal-quarter END; take the row whose quarter is
      // within 45 days of the quarter we graded (52/53-week calendars shift it).
      const sLatest = sRows.find((r) => r.quarter && p.fundamentals.q_end && Math.abs(daysBetween(r.quarter, p.fundamentals.q_end)) <= 45 && r.eps_actual != null) || null;
      // The year-ago row from the same consensus history — the adjusted basis
      // needs both ends to produce a growth rate.
      const sYearAgo = (sLatest && sLatest.quarter)
        ? (sRows.find((r) => r.quarter && r.eps_actual != null
            && Math.abs(daysBetween(sLatest.quarter!, r.quarter) - 365) <= 30) || null)
        : null;
      // Resolve the adjusted basis ONCE: the filing first, the vendor only as a
      // labelled fallback, and never a vendor number that simply repeats the
      // GAAP figure — that is the feed carrying GAAP under an adjusted name,
      // and pairing it with an adjusted estimate invents a beat.
      const prRead = prAdj[pi] || { read: false, adj: null };
      const pa = prRead.adj;
      const vendorAdj = sLatest?.eps_actual ?? null;
      const gaapNow = p.fundamentals.eps ?? null;
      const vendorLooksGaap = vendorAdj != null && gaapNow != null && Math.abs(vendorAdj - gaapNow) <= 0.011;
      // WE READ THE RELEASE AND IT STATES NO ADJUSTED EPS. That is an answer,
      // not a gap: ChargePoint, Petco, nCino, Phreesia and Gold.com publish
      // adjusted EBITDA or non-GAAP operating income and no per-share measure
      // at all, yet the vendor shipped 0.2568, 4.9651, 0.8199 — figures that
      // appear in no filing, which the card then narrated as the company's own.
      // Once the release has been read, the vendor cannot overrule it.
      const vendorUsable = !vendorLooksGaap && !prRead.read;
      const adjNow = pa ? pa.value : (vendorUsable ? vendorAdj : null);
      const adjPrev = pa ? (pa.prior ?? null) : (vendorUsable ? (sYearAgo?.eps_actual ?? null) : null);
      const adjProvenance: 'filing' | 'vendor' | null = pa ? 'filing' : (adjNow != null ? 'vendor' : null);
      // ── THE OTHER HALF OF THE SAME RULE ────────────────────────────────
      // `vendorLooksGaap` above refuses a vendor ACTUAL that is really the GAAP
      // figure. Nothing refused a vendor ESTIMATE that is really the GAAP
      // consensus, and that asymmetry is what put "adj. EPS $0.08 vs est
      // $-0.23 … beat by $0.31" on SentinelOne's card: the actual was resolved
      // correctly from the release (+$0.08 non-GAAP) and then measured against
      // a feed whose estimate for that quarter, and whose actual, and whose
      // three prior quarters, are all the GAAP line (−$0.27). The real adjusted
      // street number was about $0.07 — a penny beat. See
      // `epsEstimateBasisConflict` for how the two bases are told apart on
      // evidence rather than on how far apart the numbers happen to be.
      //
      // The verdict is computed HERE, before `gradeUsRow`, because the beat
      // does not only decorate the card: it feeds `consensus_beat_pct`, which
      // feeds `decideTier`'s beat-and-raise STRONG path. A fabricated beat that
      // is suppressed on the card but still promotes the tier is not suppressed.
      const gaapSeries = quarterSeries(p.facts, p.fundamentals.q_end);
      const estBasis = epsEstimateBasisConflict({
        estimate: sLatest?.eps_estimate ?? null,
        actual: adjNow,
        gaapEps: gaapNow,
        vendorActual: vendorAdj,
        history: vendorRowsWithGaap(sRows, sLatest, gaapSeries),
      });
      // The estimate is still SHOWN when the bases conflict — a reader is
      // entitled to know a consensus exists — but nothing may be computed from
      // it, here or anywhere downstream.
      const estUsable = !estBasis.conflict;
      const estForSurprise = estUsable ? (sLatest?.eps_estimate ?? null) : null;
      const fq = fiscalPeriodFromFacts(p.facts, p.fundamentals.q_end);
      const fyEnding = fiscalYearEndingAt(p.facts, p.fundamentals.q_end);
      const row = gradeUsRow({
        ticker: p.f.ticker!,
        company: p.f.company,
        sector: sectorFromSic(p.f.sic, p.f.company, { facts: p.facts }),
        filing_date: p.f.filed,
        form: p.f.form,
        items: p.f.items,
        filing_url: p.f.filing_url,
        fundamentals: p.fundamentals,
        price: {
          price: p.t.price, d1_pct: p.t.d1_pct, gap_pct: p.t.gap_pct,
          move_pct: p.t.move_pct, pct_from_52w_high: p.t.pct_from_52w_high,
          stage: p.t.stage, rs_rating: p.t.rs_rating,
          addv_musd: p.t.addv_musd, vol_ratio_20d: p.t.vol_ratio_20d,
        },
        shares_outstanding: p.shares,
        adj_eps: adjNow,
        adj_eps_prev: adjPrev,
        positive_guidance: g.label === 'RAISED',
        // The beat has to reach the GRADE, not just the chip beside it. It used
        // to be computed after gradeUsRow returned, which is why BJ's Wholesale
        // — a 17% beat with a raised guide — was graded as though neither had
        // happened. Same arithmetic as the display path below, and it refuses a
        // percentage off a base under a dime for the same reason.
        consensus_beat_pct: (adjNow != null && estForSurprise != null && estForSurprise >= 0.10)
          ? ((adjNow - estForSurprise) / estForSurprise) * 100
          : null,
        // The cents beat reads `estForSurprise`, NOT the raw vendor estimate —
        // an estimate refused for a basis conflict must be refused here too, or
        // the fabricated beat the guard just removed walks straight back into
        // the grade through the cents door.
        consensus_beat_abs: (adjNow != null && estForSurprise != null)
          ? adjNow - estForSurprise : null,
        close_30d: p.t.close_30d,
        // The filer's own words first (press-release headline), then SEC's
        // fy/fp — they disagree often enough to matter (NetApp's July quarter
        // is Q1 FY27 to NetApp and "fy 2026 Q1" to the API).
        // Press-release label first, then SEC's fy/fp, then — for a filer whose
        // only disclosure is the 10-K — Q4 of the fiscal year that just ended.
        // The quarter is the FILER'S word wherever it said one; the fiscal
        // YEAR falls back to SEC's fy, which is dependable (it is SEC's fiscal
        // PERIOD that disagrees with filers). Dick's "Reports Second Quarter
        // Results" was being labelled Q4 purely because the year sat in a
        // different sentence.
        fiscal_label: g.fiscal_label
          || ((g.fiscal_q && (fq.fy ?? fyEnding) != null)
              ? `Q${g.fiscal_q} FY${String(fq.fy ?? fyEnding).slice(2)}` : null)
          || usFiscalLabel(fq)
          || (fyEnding != null ? `Q4 FY${String(fyEnding).slice(2)}` : null),
        fiscal_year_own: g.fiscal_fy ?? fq.fy ?? fyEnding,
      });
      if (!row) { pendingXbrl++; addPending(p.f, 'xbrl-not-posted'); continue; }
      // A PROVIDED label with no figures and no numeric snippet is a false
      // positive off narrative wording ("we remain focused on capturing the
      // right projects") — Argan and Daktronics both carried it while their
      // releases give no outlook at all. Say nothing rather than imply one.
      const emptyProvided = g.label === 'PROVIDED' && (g.figures?.length ?? 0) === 0
        && !(g.snippets || []).some((sn) => /\$\s?\d|\d+(?:\.\d+)?\s?%/.test(sn));
      (row as any).guidance = emptyProvided ? null : g.label;
      (row as any).guidance_score = emptyProvided ? 0 : g.score;
      (row as any).guidance_snippets = g.snippets;
      (row as any).guidance_url = g.source_url;
      // WHY there is no outlook, when there is none. A company that publishes
      // its guidance in an image-only shareholder letter and a company that
      // gave no guidance at all used to look identical on the card — a blank.
      // See `GuidanceAbsentReason` in lib/us-guidance.ts.
      if (emptyProvided || !g.label) {
        (row as any).guidance_absent_reason = g.absent_reason ?? (emptyProvided ? 'none-given' : null);
        (row as any).guidance_absent_doc_url = g.absent_doc_url;
        (row as any).guidance_absent_doc_label = g.absent_doc_label;
      }
      (row as any).guidance_figures = withEstimates(g.figures, forwards[pi] || [], {
        period_end: p.fundamentals.q_end,
        fiscal_q: g.fiscal_q ?? fq.q ?? null,
        fiscal_fy: g.fiscal_fy ?? fq.fy ?? null,
      });
      // A company-reported free-cash-flow figure that EXCEEDS the same quarter's
      // operating cash flow cannot be that quarter's free cash flow — free cash
      // flow is CFO less capex, so it is bounded above by CFO. Analog Devices'
      // card carried $4.94B beside a CFO of $1.6B: the release's figure is a
      // trailing-twelve-month or year-to-date number, and printing it under a
      // quarterly label is simply wrong. Drop it and let our own CFO − capex
      // stand.
      (row as any).key_metrics = (g.metrics || []).filter((m: KeyMetric) => {
        if (m.id !== 'free_cash_flow') return true;
        const cfo = p.fundamentals.cfo;
        if (cfo == null || !Number.isFinite(m.value)) return true;
        // Free cash flow is operating cash flow less capital expenditure, so it
        // is bounded above by operating cash flow — whatever the sign of the
        // latter. GitLab's release states an ADJUSTED free cash flow of $9.8m
        // against a quarter whose operating cash flow was negative; that is a
        // non-GAAP construction, not this quarter's free cash flow, and putting
        // it under a "FREE CASH FLOW" tile makes the company look cash-positive
        // when it was not.
        return !(m.value > cfo + Math.abs(cfo) * 0.05);
      });
      if (g.label === 'RAISED' && !row.methodology_tags.includes('guidance raised')) row.methodology_tags.push('guidance raised');
      if ((g.label === 'LOWERED' || g.label === 'WITHDRAWN') && !row.caveat_tags.includes('guidance cut')) row.caveat_tags.push('guidance cut');

      // ── the expand panel's data: history, balance sheet, own-guide ────────
      // All three are additive and independently optional — a filer with a
      // short history, no tagged debt or no prior outlook simply carries fewer
      // of them, and the card renders what is there.
      // Already built above for the EPS-basis witnesses — same grid, same
      // quarter selection, so it is reused rather than rebuilt.
      const ser = gaapSeries;
      if (ser) (row as any).series = ser;
      const ctx = balanceContext(p.facts, p.fundamentals.q_end);
      if (ctx) (row as any).context = ctx;
      // The owner's Rule of 40 (revenue growth % + FCF margin %) and ROCE, both
      // on a trailing-twelve-month basis so neither is decided by one quarter's
      // working-capital timing.
      (row as any).rule40 = rule40From(ser, row.sales_yoy_pct, row.revenue_curr_musd, row.fcf_curr_musd);
      (row as any).roce = roceFrom(ser, ctx);
      // The quadrant was computed at grade time without ROCE, because ROCE needs
      // the balance sheet and the balance sheet is attached here. Recompute it
      // now that the strongest quality input exists — same function, one more
      // fact — so the badge on the card reflects everything known about the row.
      {
        const q = quadrantScore({
          roce_pct: (row as any).roce?.unavailable ? null : ((row as any).roce?.pct ?? null),
          fcf_margin_pct: (row.fcf_curr_musd != null && row.revenue_curr_musd)
            ? (row.fcf_curr_musd / row.revenue_curr_musd) * 100 : null,
          cfo_to_ni: row.cfo_to_pat_ratio ?? null,
          opm_pct: row.opm_pct ?? null,
          profitable: row.net_income_curr_musd != null ? row.net_income_curr_musd > 0 : null,
          sales_yoy_pct: row.sales_yoy_pct,
          opm_delta_pp: (row.opm_pct != null && row.opm_prev_pct != null) ? row.opm_pct - row.opm_prev_pct : null,
          eps_improving: row.eps_yoy_pct != null ? row.eps_yoy_pct > 0
            : (row.eps_swing === 'loss-to-profit' || row.eps_swing === 'loss-narrowed'),
          guidance_raised: g.label === 'RAISED',
          guidance_lowered: g.label === 'LOWERED' || g.label === 'WITHDRAWN',
          loss_narrowing: row.eps_swing === 'loss-narrowed',
        });
        (row as any).quality_score = q.quality;
        (row as any).inflection_score = q.inflection;
        (row as any).quadrant = q.quadrant;
        (row as any).quadrant_parts = { quality: q.quality_parts, inflection: q.inflection_parts };
      }
      const pg = priors[pi] || null;
      if (pg && (pg.for_quarter.length || pg.for_year.length)) {
        const gpNow = ser ? ser.gross_profit[ser.gross_profit.length - 1] : null;
        const extra = {
          adj_eps: adjNow,
          fcf: (p.fundamentals.cfo != null && p.fundamentals.capex != null)
            ? p.fundamentals.cfo - Math.abs(p.fundamentals.capex) : null,
          // `series` carries gross profit in $M; the guidance side is in dollars.
          gross_profit: gpNow != null ? gpNow * 1e6 : null,
        };
        const splitK = splitSincePriorRelease(p.facts, pg.prior_filing_date, g.figures || [], pg.for_year);
        (row as any).vs_guide = {
          prior_filing_date: pg.prior_filing_date,
          prior_filing_url: pg.prior_filing_url,
          split_factor: splitK,
          for_quarter: withActual(pg.for_quarter, p.fundamentals, extra, !!splitK),
          for_year: withActual(pg.for_year, p.fundamentals, extra, !!splitK),
        };
        (row as any).tile_refs = tileRefs(
          (row as any).vs_guide.for_quarter,
          { est: streetRevenueFor(forwards[pi] || [], p.fundamentals.q_end), actual: p.fundamentals.revenue },
        );
        const chg = guideChange(g.figures || [], pg.for_year, splitK);
        if (chg.length) (row as any).guide_change = chg;
        // A guidance LABEL is read from prose ("we now expect…"); a guidance
        // CHANGE is arithmetic on two stated ranges. When they disagree, the
        // arithmetic wins: Okta's release reads as a cut and every FY line in
        // it went up, and the card said both at once.
        if (chg.length) {
          const ups = chg.filter((x) => x.direction === 'raised').length;
          const downs = chg.filter((x) => x.direction === 'lowered').length;
          if (ups > downs && (row as any).guidance !== 'RAISED') {
            (row as any).guidance = 'RAISED';
            (row as any).guidance_basis = 'computed from the two releases\u2019 own ranges';
            const i = row.caveat_tags.indexOf('guidance cut');
            if (i >= 0) row.caveat_tags.splice(i, 1);
            if (!row.methodology_tags.includes('guidance raised')) row.methodology_tags.push('guidance raised');
          } else if (downs > ups && (row as any).guidance !== 'LOWERED') {
            (row as any).guidance = 'LOWERED';
            (row as any).guidance_basis = 'computed from the two releases\u2019 own ranges';
            const i = row.methodology_tags.indexOf('guidance raised');
            if (i >= 0) row.methodology_tags.splice(i, 1);
            if (!row.caveat_tags.includes('guidance cut')) row.caveat_tags.push('guidance cut');
          }
        }
      }
      // CFO/PAT is a funding artefact for banks, insurers and REITs — flag the
      // sector so the client preset can skip that gate, exactly as India does
      // for NBFCs.
      (row as any).is_financial = isFinancialSic(p.f.sic);
      (row as any).close_30d = p.t.close_30d;
      (row as any).reaction_date = p.t.reaction_date;
      // Consensus surprise (street basis, both sides) — tagged so it shows up
      // beside the methodology / caveat chips like every other signal.
      if (adjNow != null) {
        const est = estForSurprise;
        (row as any).eps_adj = adjNow;
        (row as any).eps_adj_source = adjProvenance;
        (row as any).eps_adj_label = pa?.label ?? null;
        (row as any).eps_adj_quote = pa?.source ?? null;
        (row as any).eps_estimate = est;
        (row as any).eps_basis = adjProvenance === 'filing'
          ? `adjusted (${pa!.label})` : 'adjusted (street)';
        // Recomputed against the actual we resolved, not the one the feed
        // shipped with its own estimate — and refused entirely when the
        // estimate is within a dime of zero, because a percentage off $0.00 is
        // arithmetic noise (Domo "+5,888%"). The cents delta is kept instead.
        if (est != null) {
          const cents = adjNow - est;
          (row as any).eps_surprise_abs = Math.round(cents * 1000) / 1000;
          // A surprise percentage needs a POSITIVE base. SentinelOne's
          // consensus was −$0.23 and its actual +$0.08 — a real and important
          // swing, but "+134%" off a negative estimate is not a number.
          const pct = est >= 0.10 ? (cents / est) * 100 : null;
          (row as any).eps_surprise_pct = pct != null ? Math.round(pct * 10) / 10 : null;
          const beat = pct != null ? pct >= 5 : cents >= 0.03;
          const miss = pct != null ? pct <= -5 : cents <= -0.03;
          if (beat && !row.methodology_tags.includes('consensus beat')) row.methodology_tags.push('consensus beat');
          if (miss && !row.caveat_tags.includes('missed consensus')) row.caveat_tags.push('missed consensus');
        } else if (estBasis.conflict && sLatest?.eps_estimate != null) {
          // THE ESTIMATE IS SHOWN, THE SURPRISE IS NOT. The mirror of the
          // branch below: there we have a street estimate and no adjusted
          // actual, here we have an adjusted actual and a street estimate that
          // is not on its basis. Either way the honest output is the estimate
          // plus the reason no surprise accompanies it — never a subtraction
          // across two books.
          (row as any).eps_estimate = sLatest.eps_estimate;
          (row as any).eps_basis_note = estBasis.note;
          (row as any).eps_basis_evidence = estBasis.evidence;
          // A METHODOLOGY tag, not a caveat: nothing is wrong with the company
          // or with this print — the feed's estimate is simply not measurable
          // against it. Filing it as a caveat would silently demote the row in
          // every preset that counts caveats, which is a second wrong answer.
          if (!row.methodology_tags.includes('consensus not on a comparable basis')) {
            row.methodology_tags.push('consensus not on a comparable basis');
          }
        }
      } else if (sLatest && sLatest.eps_actual != null && vendorLooksGaap) {
        // The feed's "adjusted actual" is the GAAP figure. Show the estimate so
        // the reader knows one exists, but never a surprise computed across two
        // different bases.
        (row as any).eps_estimate = sLatest.eps_estimate;
        (row as any).eps_basis_note = 'no adjusted EPS in the release; the consensus estimate is on an adjusted basis, so no surprise is shown';
      }
      graded.push(row);
    }

    // ── 5. PRELIMINARY grades for fresh prints whose XBRL hasn't posted ───
    // DELL, AVGO, PANW report on day D; the 10-Q with the GAAP numbers can be
    // a week or more behind. Nasdaq's surprise table carries the street-basis
    // EPS the same evening, so we grade on EPS growth + surprise + reaction,
    // mark the row PRELIM, and let the full grade replace it when the filing
    // lands. Only for 8-K filers whose surprise row matches the filing date.
    if (!explicit && awaitingXbrl.length) {
      const sur = await pooled(awaitingXbrl, 6, (x) => yahooEarningsHistory(x.f.ticker!));
      const prelimCiks = new Set<number>();
      let dbgRows = 0, dbgMatch = 0, dbgEps = 0, dbgRow = 0;
      for (let i = 0; i < awaitingXbrl.length; i++) {
        const { f, t, facts: facts0 } = awaitingXbrl[i];
        const rows = sur[i] || [];
        if (rows.length) dbgRows++;
        if (f.form !== '8-K') continue;
        // The freshest row whose quarter ended in the ~110 days before the
        // filing and that already carries an actual — i.e. this print.
        const latest = rows.slice().reverse().find((r) => r.quarter && r.eps_actual != null
          && daysBetween(f.filed, r.quarter) >= 0 && daysBetween(f.filed, r.quarter) <= 110) || null;
        if (latest) { dbgMatch++; dbgEps++; }

        // ── the GAAP numbers, read from the press release ──────────────────
        // The 10-Q is days away, but the statement of operations is in the
        // 8-K's Exhibit 99.1 right now — and its PRIOR-YEAR column is a figure
        // we already hold from last year's XBRL. Every value is accepted only
        // when that prior-year column reproduces the XBRL year-ago number, so a
        // PRELIM card shows revenue, margin and GAAP EPS that have been checked
        // against a filing, or shows nothing at all.
        //
        // NO CONSENSUS FEED IS REQUIRED. This used to bail out whenever Yahoo
        // had no earnings history for the ticker, which is the normal state for
        // micro-caps and recent listings — and those are exactly the names the
        // owner saw sitting in "numbers not on EDGAR yet" with nothing on the
        // card. The consensus row was only ever supplying the quarter END, and
        // the release states that itself, on every US income statement, in the
        // period header. So: use the consensus quarter when there is one, and
        // otherwise read the date the filer wrote.
        let doc: { url: string | null; html: string | null } | null = null;
        if (f.accession) {
          try { doc = await releaseDocument(f.cikNum, f.accession, f.filing_url); } catch { doc = null; }
        }
        const relUrl: string | null = doc?.url ?? null;
        const qEnd = latest?.quarter
          ?? (doc?.html ? periodEndFromReleaseHtml(doc.html, f.filed) : null);
        if (!qEnd) continue;                       // no quarter to attribute the print to
        const qEndFromRelease = !latest?.quarter;

        const yaEnd = isoAddDays(qEnd, -365);
        const ya = facts0 ? extractFundamentals(facts0, yaEnd) : null;
        // A year-ago quarter that is not actually a year ago cannot validate
        // anything — 52/53-week calendars shift by up to a week, no more.
        const yaUsable = !!ya && !!ya.q_end && Math.abs(Math.abs(daysBetween(qEnd, ya.q_end)) - 365) <= 25;
        let pr: ReturnType<typeof financialsFromReleaseHtml> | null = null;
        if (yaUsable && ya && (ya.revenue != null || ya.net_income != null) && doc?.html) {
          try {
            pr = financialsFromReleaseHtml(doc.html, {
              revenue: ya.revenue, operating_income: ya.operating_income,
              net_income: ya.net_income, eps: ya.eps,
            }, { reportedPeriodEnd: qEnd });
          } catch { pr = null; }
        }
        // Nothing to say: no validated figures AND no consensus. Leave it in
        // the pending list, where it honestly belongs.
        // The filer's own adjusted EPS, from the same release — see the note on
        // the full-graded path. The vendor figure stands in only when the
        // release states none, and never when it merely repeats GAAP.
        const paP = doc?.html
          ? adjustedEpsFromReleaseHtml(doc.html, { gaapEps: pr?.eps ?? null, periodEndISO: qEnd })
          : null;
        const vendorAdjP = latest?.eps_actual ?? null;
        const vendorLooksGaapP = vendorAdjP != null && pr?.eps != null && Math.abs(vendorAdjP - pr.eps) <= 0.011;
        const vendorUsableP = !vendorLooksGaapP && !doc?.html;
        const adjNowP = paP ? paP.value : (vendorUsableP ? vendorAdjP : null);
        const adjPrevP = paP ? (paP.prior ?? null) : (!vendorUsableP ? null
          : ((latest?.quarter ? rows.find((r) => r.quarter && r.eps_actual != null
              && Math.abs(daysBetween(latest.quarter!, r.quarter) - 365) <= 30)?.eps_actual : null) ?? null));
        if ((!pr || !pr.matched.length) && adjNowP == null) continue;
        // Same basis guard as the full path, on the evidence a PRELIM row has:
        // the GAAP EPS comes from the release's own statement of operations
        // (validated against last year's XBRL) rather than from this quarter's
        // 10-Q, which has not posted — and the prior quarters' GAAP EPS still
        // comes from XBRL, because those quarters have long since been filed.
        // A PRELIM card is the FIRST thing the owner sees on the evening of a
        // print, so it is exactly where a fabricated beat does the most damage.
        const estBasisP = epsEstimateBasisConflict({
          estimate: latest?.eps_estimate ?? null,
          actual: adjNowP,
          gaapEps: pr?.eps ?? null,
          vendorActual: vendorAdjP,
          history: vendorRowsWithGaap(rows, latest, facts0 ? quarterSeries(facts0, null) : null),
        });
        const estUsableP = !estBasisP.conflict;
        // The feed's OWN surprise percentage is what a PRELIM row forwards, so
        // it is judged on the same rule — see `vendorSurpriseUsable`. Gap's
        // +180.9% is an adjusted estimate paired with a GAAP actual, by the
        // feed itself.
        const vendorSurpP = vendorSurpriseUsable({
          estimate: latest?.eps_estimate ?? null,
          vendorActual: vendorAdjP,
          gaapEps: pr?.eps ?? null,
          adjustedEps: paP ? paP.value : null,
        });
        // OUR OWN ARITHMETIC FIRST, the feed's percentage only as a fallback.
        // When we hold both a release-read adjusted EPS and a usable estimate,
        // the surprise is ours to compute and is on one stated basis; the feed's
        // number is a black box that has been caught pairing two books. This
        // also means refusing the feed's figure costs nothing where we can do
        // the sum ourselves — TJX keeps its real +$0.03 while losing the feed's
        // +14.5%, which was struck against the GAAP actual.
        const ownSurprisePct = (adjNowP != null && estUsableP && (latest?.eps_estimate ?? null) != null
          && (latest!.eps_estimate as number) >= 0.10)
          ? ((adjNowP - (latest!.eps_estimate as number)) / (latest!.eps_estimate as number)) * 100
          : null;
        const vendorSurprisePct = ownSurprisePct ?? (vendorSurpP.usable ? (latest?.surprise_pct ?? null) : null);
        // Guidance first: it also carries the filer's own name for the quarter
        // ("Q2 FY27"), read from the release headline.
        let gPre: Guidance | null = null;
        try { gPre = f.accession ? await guidanceFromFiling(f.cikNum, f.accession, f.filing_url) : null; } catch { gPre = null; }
        const fiscalPrev = facts0 ? fiscalPeriodFromFacts(facts0, ya?.q_end || yaEnd) : { fy: null, q: null };
        const fiscalNow = nextFiscalYear(fiscalPrev);
        const fund = {
          q_end: qEnd, q_end_prev: ya?.q_end ?? null, q_filed: null,
          revenue: pr?.revenue ?? null, revenue_prev: pr?.revenue_prev ?? null,
          operating_income: pr?.operating_income ?? null, operating_income_prev: pr?.operating_income_prev ?? null,
          net_income: pr?.net_income ?? null, net_income_prev: pr?.net_income_prev ?? null,
          // GAAP diluted EPS from the release when it validated; the street
          // (adjusted) figure stays on `eps_adj`, never mixed into the YoY tile.
          eps: pr?.eps ?? null, eps_prev: pr?.eps_prev ?? null, eps_derived: false,
          cfo: null, cfo_prev: null, capex: null, capex_prev: null, tags: {},
          quarters_revenue: null, quarters_eps: null, quarters_opm: null,
        };
        const row = gradeUsRow({
          ticker: f.ticker!, company: f.company, sector: sectorFromSic(f.sic, f.company, { facts: facts0 }),
          filing_date: f.filed, form: f.form, items: f.items, filing_url: f.filing_url,
          fundamentals: fund,
          price: {
            price: t.price, d1_pct: t.d1_pct, gap_pct: t.gap_pct, move_pct: t.move_pct,
            pct_from_52w_high: t.pct_from_52w_high, stage: t.stage, rs_rating: t.rs_rating,
            addv_musd: t.addv_musd, vol_ratio_20d: t.vol_ratio_20d,
          },
          // Cover-page share count — filed with every 10-Q/10-K/8-K wrapper, so
          // it is current even before this quarter's numbers land. Gives the
          // PRELIM card a real market cap instead of a blank.
          shares_outstanding: facts0 ? sharesOutstandingFromFacts(facts0, null) : null,
          adj_eps: adjNowP,
          adj_eps_prev: adjPrevP,
          prelim_surprise_pct: vendorSurprisePct,
          consensus_beat_pct: vendorSurprisePct,
          // Same rule as the full path: only an estimate that survived the
          // basis guard may produce a cents beat.
          consensus_beat_abs: (adjNowP != null && estUsableP && (latest?.eps_estimate ?? null) != null)
            ? adjNowP - (latest!.eps_estimate as number) : null,
          positive_guidance: gPre?.label === 'RAISED',
          close_30d: t.close_30d,
          fiscal_label: gPre?.fiscal_label || usFiscalLabel(fiscalNow) || null,
          fiscal_year_own: gPre?.fiscal_fy ?? fiscalNow.fy,
        });
        if (!row) continue;
        if (pr && pr.matched.length) {
          (row as any).prelim_source = 'press release (EX-99), validated against the year-ago XBRL';
          (row as any).prelim_matched = pr.matched;
          (row as any).release_url = relUrl;
        }
        dbgRow++;
        // PRELIM never outranks a full GAAP grade.
        if (row.tier === 'BLOCKBUSTER') row.tier = 'STRONG';
        {
          const g = gPre;
          if (!g) (row as any).guidance_absent_reason = 'release-unavailable';
          if (g) {
            (row as any).guidance = g.label; (row as any).guidance_score = g.score;
            (row as any).guidance_snippets = g.snippets; (row as any).guidance_url = g.source_url;
            if (!g.label) {
              (row as any).guidance_absent_reason = g.absent_reason;
              (row as any).guidance_absent_doc_url = g.absent_doc_url;
              (row as any).guidance_absent_doc_label = g.absent_doc_label;
            }
            (row as any).guidance_figures = withEstimates(g.figures, await yahooForwardEstimates(f.ticker!).catch(() => []), {
              period_end: qEnd,
              fiscal_q: g.fiscal_q ?? fiscalNow.q ?? null,
              fiscal_fy: g.fiscal_fy ?? fiscalNow.fy ?? null,
            });
            (row as any).key_metrics = g.metrics;
            if (g.label === 'RAISED' && !row.methodology_tags.includes('guidance raised')) row.methodology_tags.push('guidance raised');
            if ((g.label === 'LOWERED' || g.label === 'WITHDRAWN') && !row.caveat_tags.includes('guidance cut')) row.caveat_tags.push('guidance cut');
          }
        }
        // ── history + context for a PRELIM row ─────────────────────────────
        // The quarter just announced is not on EDGAR yet, so the XBRL series
        // stops one quarter short. Rather than show a table whose newest column
        // is last quarter — which would read as this quarter and be wrong — the
        // release's own validated figures are appended as the final column, and
        // the lines the release does not carry (cash flow) stay null.
        if (facts0) {
          const ser0 = quarterSeries(facts0, null);
          if (ser0 && (ser0.ends[ser0.ends.length - 1] || '') < qEnd) {
            if (pr && pr.matched.length) {
              ser0.ends.push(qEnd);
              ser0.revenue.push(pr.revenue != null ? Math.round(pr.revenue / 1e4) / 100 : null);
              ser0.gross_profit.push(null);
              ser0.operating_income.push(pr.operating_income != null ? Math.round(pr.operating_income / 1e4) / 100 : null);
              ser0.net_income.push(pr.net_income != null ? Math.round(pr.net_income / 1e4) / 100 : null);
              ser0.eps.push(pr.eps ?? null);
              ser0.cfo.push(null);
              ser0.fcf.push(null);
              (row as any).series = ser0;
            }
            // No validated release figures → the series would end on the wrong
            // quarter, so none is sent. Nothing is better than misaligned.
          } else if (ser0) {
            (row as any).series = ser0;
          }
          // ── the balance sheet ────────────────────────────────────────────
          // The announced quarter's is not on EDGAR yet. The PREVIOUS quarter's
          // XBRL — resolved from the newest date on file and stamped with
          // `as_of` so the card says which quarter it is showing — is the
          // floor, and it is what this used to be, full stop.
          //
          // But most 8-K releases print the condensed consolidated balance
          // sheet in full, so the CURRENT cash, debt and total assets are
          // sitting in the exhibit we have already fetched. `us-pr-balance`
          // reads it, binding the columns by their headers (two instants, one
          // of which must name the announced period end) and proving every line
          // against the comparative column, whose own XBRL we hold. When that
          // comes back with something, it is strictly better — the announced
          // quarter instead of the one before it — and when it comes back null
          // nothing changes.
          const ctx0 = balanceContext(facts0, null);
          let ctxUse: UsBalanceContext | null = (ctx0 && ctx0.as_of) ? { ...ctx0, source: 'xbrl' as const } : null;
          if (doc?.html) {
            try {
              const relBs = balanceSheetFromReleaseHtml(doc.html, {
                periodEndISO: qEnd,
                xbrlAt: (iso) => balanceContext(facts0, iso),
                prior: ctx0,
              });
              if (relBs) {
                // A release's cash-flow statement is year-to-date, exactly as
                // the 10-Q's is, and the release carries nothing to de-cumulate
                // it against — so the reader only publishes flows when the
                // filer prints a three-month column. Where it did not, the
                // stock comp / buybacks / dividends / share count stay on the
                // previous quarter's XBRL and `flows_as_of` says so, rather
                // than the card losing those bullets entirely.
                const gotGroup = relBs.sbc_musd != null || relBs.buyback_musd != null
                  || relBs.dividends_musd != null || relBs.diluted_shares_m != null;
                if (!gotGroup && ctx0?.as_of) {
                  relBs.sbc_musd = ctx0.sbc_musd;
                  relBs.buyback_musd = ctx0.buyback_musd;
                  relBs.dividends_musd = ctx0.dividends_musd;
                  relBs.diluted_shares_m = ctx0.diluted_shares_m;
                  relBs.diluted_shares_yoy_pct = ctx0.diluted_shares_yoy_pct;
                  relBs.flows_as_of = ctx0.as_of;
                } else if (!relBs.flows_as_of) {
                  relBs.flows_as_of = relBs.as_of;
                }
                ctxUse = relBs;
                (row as any).balance_source = 'release';
                if (!row.methodology_tags.includes('balance sheet from the release')) {
                  row.methodology_tags.push('balance sheet from the release');
                }
              }
            } catch { /* a release we cannot read is not an error — keep the XBRL one */ }
          }
          if (ctxUse) (row as any).context = ctxUse;
          (row as any).rule40 = rule40From((row as any).series ?? null, row.sales_yoy_pct, row.revenue_curr_musd, row.fcf_curr_musd);
          (row as any).roce = roceFrom((row as any).series ?? null, ctxUse);
        }
        // Own-guide comparison works on a PRELIM row too: the guide came from
        // last quarter's release and the actuals came from this quarter's.
        if (f.accession) {
          try {
            const pg = await priorGuidanceFor({
              cikNum: f.cikNum, currentAccession: f.accession, currentFilingDate: f.filed,
              reportedPeriodEnd: qEnd,
              reportedFiscalQ: gPre?.fiscal_q ?? fiscalNow.q ?? null,
              reportedFiscalFy: gPre?.fiscal_fy ?? fiscalNow.fy ?? null,
            });
            if (pg && (pg.for_quarter.length || pg.for_year.length)) {
              const extra = { adj_eps: adjNowP, fcf: null, gross_profit: null };
              const splitK = splitSincePriorRelease(facts0, pg.prior_filing_date, gPre?.figures || [], pg.for_year);
              (row as any).vs_guide = {
                prior_filing_date: pg.prior_filing_date,
                prior_filing_url: pg.prior_filing_url,
                split_factor: splitK,
                for_quarter: withActual(pg.for_quarter, fund, extra, !!splitK),
                for_year: withActual(pg.for_year, fund, extra, !!splitK),
              };
              (row as any).tile_refs = tileRefs(
                (row as any).vs_guide.for_quarter,
                { est: streetRevenueFor(await yahooForwardEstimates(f.ticker!).catch(() => []), qEnd),
                  actual: pr?.revenue ?? null },
              );
              const chg = guideChange(gPre?.figures || [], pg.for_year, splitK);
              if (chg.length) (row as any).guide_change = chg;
            }
          } catch { /* a missing prior release is not an error */ }
        }
        (row as any).prelim = true;
        (row as any).is_financial = isFinancialSic(f.sic);
        (row as any).close_30d = t.close_30d;
        (row as any).reaction_date = t.reaction_date;
        if (adjNowP != null) {
          // Same rule as the full path: an estimate that is not on this
          // actual's basis is shown, never subtracted from it.
          const estP = estUsableP ? (latest?.eps_estimate ?? null) : null;
          (row as any).eps_basis = paP ? `adjusted (${paP.label})` : 'adjusted (street)';
          (row as any).eps_adj = adjNowP;
          (row as any).eps_adj_source = paP ? 'filing' : 'vendor';
          (row as any).eps_adj_label = paP?.label ?? null;
          (row as any).eps_adj_quote = paP?.source ?? null;
          (row as any).eps_estimate = estP;
          if (estP != null) {
            const cents = adjNowP - estP;
            (row as any).eps_surprise_abs = Math.round(cents * 1000) / 1000;
            const pct = estP >= 0.10 ? (cents / estP) * 100 : null;
            (row as any).eps_surprise_pct = pct != null ? Math.round(pct * 10) / 10 : null;
            const beat = pct != null ? pct >= 5 : cents >= 0.03;
            const miss = pct != null ? pct <= -5 : cents <= -0.03;
            if (beat && !row.methodology_tags.includes('consensus beat')) row.methodology_tags.push('consensus beat');
            if (miss && !row.caveat_tags.includes('missed consensus')) row.caveat_tags.push('missed consensus');
          } else if (estBasisP.conflict && latest?.eps_estimate != null) {
            (row as any).eps_estimate = latest.eps_estimate;
            (row as any).eps_basis_note = estBasisP.note;
            (row as any).eps_basis_evidence = estBasisP.evidence;
            if (!row.methodology_tags.includes('consensus not on a comparable basis')) {
              row.methodology_tags.push('consensus not on a comparable basis');
            }
          }
        } else if (!row.methodology_tags.includes('no analyst coverage')) {
          // Not a defect — most listed US companies have no consensus at all.
          // Saying so is more useful than a blank where a surprise would be.
          row.methodology_tags.push('no analyst coverage');
        }
        if (!row.caveat_tags.includes('prelim · 10-Q pending')) row.caveat_tags.push('prelim · 10-Q pending');
        if (qEndFromRelease && !row.methodology_tags.includes('quarter read from the release')) {
          row.methodology_tags.push('quarter read from the release');
        }
        const surpP = (row as any).eps_surprise_pct as number | null | undefined;
        // The sentence must not pair the two figures either. Writing "adjusted
        // EPS $0.08 vs $-0.23 consensus" invites the reader to do the
        // subtraction the engine just refused to do, so when the bases differ
        // the narrative states the adjusted figure alone and says why the
        // consensus is missing from it.
        const consensusLine = (latest?.eps_estimate != null && estUsableP)
          ? ` vs $${latest.eps_estimate.toFixed(2)} consensus${surpP != null ? ` (${surpP >= 0 ? '+' : ''}${surpP.toFixed(0)}%)` : ''}`
          : (estBasisP.conflict ? ' (the consensus on file is struck on the GAAP basis, so no surprise is shown)' : '');
        const adjLine = adjNowP != null
          ? `${paP ? paP.label.toLowerCase() : 'adjusted EPS'} $${adjNowP.toFixed(2)}${consensusLine}`
          : null;
        row.narrative = (pr && pr.matched.length)
          // We have the release's own GAAP statement — keep the normal
          // narrative and add the street line plus what is still missing.
          ? `${row.narrative} Read from the earnings release and checked against last year's filing${adjLine ? `; ${adjLine}` : ' (no analyst consensus covers this name)'}. Cash flow arrives with the 10-Q.`
          : `${f.company} reported ${row.quarter}: ${adjLine ?? 'no GAAP statement could be verified'}. Revenue, margins and cash flow will fill in when the 10-Q posts to EDGAR.`;
        graded.push(row);
        prelimCiks.add(f.cikNum);
      }
      // A name with a PRELIM grade is no longer "pending".
      if (prelimCiks.size) {
        const prelimTickers = new Set(awaitingXbrl.filter((x) => prelimCiks.has(x.f.cikNum)).map((x) => x.f.ticker));
        for (let i = pending.length - 1; i >= 0; i--) {
          if (prelimTickers.has(pending[i].ticker) && (pending[i].reason === 'xbrl-not-posted' || pending[i].reason === 'quarter-stale')) {
            pending.splice(i, 1); pendingXbrl = Math.max(0, pendingXbrl - 1);
          }
        }
        notes.push(`${prelimCiks.size} fresh print(s) graded PRELIM — revenue, margin and GAAP EPS read from the earnings release and validated against the year-ago XBRL; the full grade follows when the 10-Q posts`);
      } else if (awaitingXbrl.length) {
        notes.push(`prelim: ${awaitingXbrl.length} awaiting XBRL, ${dbgRows} had a Nasdaq surprise history, ${dbgMatch} matched the filing date, ${dbgEps} with EPS, ${dbgRow} graded`);
      }
    }

    // Scheduled on `date` but not yet filed — the "results pending" list.
    let scheduled: ExpectedReporter[] = [];
    if (!explicit) {
      try {
        const filedSet = new Set(filings.map((f) => f.ticker).filter(Boolean) as string[]);
        const exp = await nasdaqEarningsOn(date);
        scheduled = exp.filter((e) => !filedSet.has(e.ticker));
        // A foreign private issuer (Grifols, NIO, Canaan…) reports on a 6-K, not
        // an 8-K, and files 20-F/40-F annually — it will NEVER move into a tier
        // off an 8-K, and leaving it sitting in "results pending" for ever looks
        // like the engine missed it. Mark them so the card can say why. Checked
        // for the largest names only; `submissions` is cached 6h.
        const probe = scheduled.slice()
          .sort((a, b) => (b.market_cap_musd ?? 0) - (a.market_cap_musd ?? 0)).slice(0, 20);
        const marks = await pooled(probe, 5, async (e) => {
          const cik = await tickerToCik(e.ticker);
          if (!cik) return { t: e.ticker, foreign: false };
          const s = await submissions(cik);
          if (!s) return { t: e.ticker, foreign: false };
          const recent = s.recent.slice(0, 250);
          const foreign = recent.some((r) => /^(6-K|20-F|40-F)/.test(r.form))
            && !recent.some((r) => r.form === '8-K' && r.items.includes('2.02'));
          return { t: e.ticker, foreign };
        });
        const foreignSet = new Set(marks.filter((m) => m?.foreign).map((m) => m!.t));
        if (foreignSet.size) {
          scheduled = scheduled.map((e) => foreignSet.has(e.ticker) ? { ...e, foreign_filer: true } as ExpectedReporter : e);
        }
      } catch { scheduled = []; }
    }

    // The post-earnings setup score needs the whole cohort (its valuation
    // factor is measured against the day's own median P/E), so it runs once
    // over every graded row — full and PRELIM alike — after grading is done.
    assignSetupScores(graded as any[]);

    const by_tier: Record<EarningsTier, UsGradedRow[]> = {
      BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [],
    };
    for (const r of graded) by_tier[r.tier].push(r);
    for (const t of US_TIER_ORDER) {
      by_tier[t].sort((a, b) =>
        (b.composite_score - a.composite_score) ||
        ((b.pead_score ?? 0) - (a.pead_score ?? 0)) ||
        b.filing_date.localeCompare(a.filing_date));
    }

    if (pendingXbrl > 0) {
      notes.push(`${pendingXbrl} filer${pendingXbrl > 1 ? 's' : ''} announced but XBRL not yet posted (the 10-Q usually follows the 8-K by days to weeks)`);
    }
    const earlierN = pending.filter((p) => p.reason === 'reported-earlier').length;
    if (earlierN > 0) notes.push(`${earlierN} filing(s) in the window were 10-Qs or follow-up 8-Ks for results already announced before the window — not re-graded as fresh`);
    if (noPrice > 0) {
      // Name the actual upstream failure. Without this, a Yahoo-side block from
      // the deploy host is indistinguishable from "these are all OTC tickers",
      // and diagnosing it costs a redeploy.
      const reasons = new Map<string, number>();
      for (let i = 0; i < listed.length; i++) {
        if (techs[i]) continue;
        const r = yahooLastError.get(listed[i].ticker!) || 'insufficient history';
        reasons.set(r, (reasons.get(r) || 0) + 1);
      }
      const top = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([r, n]) => `${r} ×${n}`).join(', ');
      notes.push(`${noPrice} filer(s) had no usable price history — ${top || 'OTC / newly listed / delisted'}`);
    }

    const payload: UsGradedPayload = {
      filing_date: date,
      window_days: days,
      window_start: windowStart,
      candidates_total: graded.length,
      raw_items_total: rawTotal,
      pending_xbrl_total: pendingXbrl,
      no_price_total: noPrice,
      by_tier,
      pending: pending
        .filter((p) => p.ticker)
        .sort((a, b) => b.filed.localeCompare(a.filed) || a.ticker.localeCompare(b.ticker)),
      scheduled: scheduled.sort((a, b) => (b.market_cap_musd ?? 0) - (a.market_cap_musd ?? 0)),
      generated_at: new Date().toISOString(),
      sources_polled: 3,
      truncated,
      notes,
    };

    const includesToday = date >= today;
    const ttl = explicit ? 15 * 60_000 : includesToday ? 15 * 60_000 : 90 * 24 * 3600_000;
    if (_cache.size >= CACHE_MAX) {
      const oldest = Array.from(_cache.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 15);
      for (const [k] of oldest) _cache.delete(k);
    }
    _cache.set(cacheKey, { at: Date.now(), ttl, data: payload });

    return NextResponse.json(payload, {
      headers: {
        'x-mc-cache': 'miss',
        'x-mc-ms': String(Date.now() - t0),
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err: any) {
    return NextResponse.json({
      filing_date: date,
      window_days: days,
      window_start: null,
      candidates_total: 0,
      raw_items_total: 0,
      pending_xbrl_total: 0,
      no_price_total: 0,
      by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
      pending: [],
      scheduled: [],
      generated_at: new Date().toISOString(),
      sources_polled: 0,
      truncated: false,
      notes: [`error: ${String(err?.message || err)}`],
      error: String(err?.message || err),
    }, { status: 502 });
  }
}
