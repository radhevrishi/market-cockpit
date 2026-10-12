// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA PER-QUARTER GRADER — ONE COPY.  (zzz669)
//
// WHY THIS FILE EXISTS.
//
// This function used to exist TWICE: once in the route handler that serves a
// graded session, and once again, pasted, inside the Earnings Opportunities
// page. The shared-constants module next door opens with the reason that was a
// problem — three separate drift bugs (zzz384 → zzz386 → zzz387), each one a
// real over-grading, each caused by a rule being changed in one copy and not
// the other. zzz395 moved the caveat table and the tier ladder here to stop it
// happening again, and the rest of the grader stayed duplicated.
//
// It kept happening. By the time this was extracted the two copies had drifted
// to 721 lines and 421 — three hundred lines apart. And the same disease had
// spread WITHIN the route: `close_30d` was added to one of that file's two row
// builders and not the other, so a volatility fix shipped, reported success,
// and never ran on the main path.
//
// So the grader now lives in exactly one place and both callers import it.
// This file is PURE — no fetch, no KV, no NextResponse, no process.env, no
// React — which is what made the extraction safe: the function only ever read
// its argument and returned an object. Keep it that way. Anything that needs
// I/O belongs in the caller, not here.
// ═══════════════════════════════════════════════════════════════════════════

import {
  caveatPenaltyFor, countingCaveats, marginQualityDelta, decideTier,
  marketReactionDelta, typicalDailyMovePct, quadrantForIndiaRow,
  fundamentalComposite, setupGrade,
  profitTrajectory, MARKET_REACTION_CAVEATS,
  type EarningsTier,
} from '@/lib/earnings-grade-shared';
import { peadScore } from '@/lib/pead-score';
import { financialKind, realAdtv, type FinancialKind } from '@/lib/india-eo-card-data';

/** The graded card this produces. Deliberately loose: the two callers have
 *  historically disagreed about optional fields, and narrowing it here would
 *  be a second source of truth about the same shape. */
export type IndiaGradedRow = any;

export function deriveQuarterLabel(filingDate?: string | null): string {
  try {
    const iso = filingDate && filingDate.length === 10 ? filingDate + 'T00:00:00Z' : (filingDate || '');
    const d = iso ? new Date(iso) : new Date();
    const m = (Number.isFinite(d.getTime()) ? d.getUTCMonth() : new Date().getUTCMonth()) + 1;
    if (m >= 1 && m <= 3) return 'Q3';
    if (m >= 4 && m <= 6) return 'Q4';
    if (m >= 7 && m <= 9) return 'Q1';
    return 'Q2';
  } catch { return 'Q4'; }
}

function parseTrendlynePeriodEnd(s: string): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})/);
  if (!m) return null;
  const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const mm = months[m[2].toUpperCase().slice(0, 3)];
  if (mm === undefined) return null;
  return new Date(Date.UTC(+m[3], mm, +m[1])).toISOString().slice(0, 10);
}

/**
 * zzz800 — NO SILENT DROPS. Same grader, but when it declines to produce a
 * card it says WHY. The graded route records these reasons in its payload
 * (`_dropped`), so a company that filed and does not appear — a recent listing
 * like INDOMIM — can be diagnosed from the response instead of by bisecting
 * five `return null` gates by hand.
 */
export function gradeIndiaRowExplained(row: any): { card: IndiaGradedRow | null; dropReason: string | null } {
  let reason: string | null = null;
  const card = _gradeIndiaRow(row, (r) => { reason = r; return null; });
  if (card) attachGradeInput(card, row);
  return { card, dropReason: card ? null : (reason ?? 'unknown') };
}

export function gradeIndiaRow(row: any): IndiaGradedRow | null {
  const card = _gradeIndiaRow(row, () => null);
  if (card) attachGradeInput(card, row);
  return card;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE GRADE'S OWN INPUT, STORED ON THE CARD.                        (zzz819)
//
// Until now an India day stored the grader's OUTPUT only, so a rules change
// could not be applied to a stored day without re-enriching every company
// from Screener — the whole 60-day window re-queued, one day at a time. The
// US engine solved this in zzz807 by keeping the exact input on the row.
// India now does the same: every field the grader reads, and nothing else.
// A regrade (lib/india-regrade.ts) feeds this straight back in.
// ═══════════════════════════════════════════════════════════════════════════
export const INDIA_GRADE_INPUT_V = 1;
const GRADE_INPUT_FIELDS = [
  'hub_quality', 'symbol', 'company', 'filing_date', 'quarter', 'sector', 'market_cap_bucket',
  'market_cap_cr', 'marketCapCr', 'adtv_cr', 'close_30d', 'vol_ratio_20d', 'rvol',
  'exceptional_pct_pbt', 'pledged_pct', 'guidance_raised', 'guidance_lowered',
  'source_url', 'sales_curr_cr', 'sales_prev_cr', 'sales_yoy_pct', 'pat_curr_cr', 'pat_prev_cr',
  'pat_yoy_pct', 'eps_curr', 'eps_prev', 'eps_yoy_pct', 'newly_listed', 'num_quarters',
  'quarters_sales', 'quarters_eps', 'quarters_pat', 'op_profit_yoy_pct', 'opm_pct', 'opm_prev_pct',
  'pe', 'stockPE', 'current_price', 'gap_pct', 'd1_pct', 'move_pct', 'pct_from_52w_high',
  'rs_rating', 'stage', 'trend_template_passes', 'ocf_annual_cr', 'pat_annual_cr',
  'ocf_to_pat_ratio', 'roce', 'latest_quarter_end_iso', 'financials_source',
  // zzz821 — the fiscal year of the cash figures, and the industry chain.
  'cash_fy', 'cash_basis', 'industry', 'broad_industry', 'broad_sector', 'sector_name',
  // zzz826 — days the liquidity average covers, the one-day turnover kept
  // apart from it, and the cash / year-ago rule versions of the figures.
  'adtv_days', 'turnover_1d_cr', 'cash_rule_v', 'yoy_rule_v',
] as const;
const GRADE_INPUT_TEXT_FIELDS = ['guidance_text', 'narrative_text', 'announcement_text', 'attachment', 'headline', 'title'] as const;

/** The subset of an enriched row the grader reads. Pure. */
export function pickIndiaGradeInput(row: any): Record<string, any> {
  const out: Record<string, any> = { v: INDIA_GRADE_INPUT_V };
  for (const k of GRADE_INPUT_FIELDS) if (row?.[k] !== undefined && row?.[k] !== null) out[k] = row[k];
  for (const k of GRADE_INPUT_TEXT_FIELDS) {
    const v = row?.[k];
    // Only the guidance scan reads these, and it lower-cases and pattern-
    // matches; a long announcement is capped so one day cannot balloon.
    if (typeof v === 'string' && v) out[k] = v.slice(0, 3000);
  }
  // A card-basis regrade (lib/india-regrade.ts) carries filing flags the card
  // could not re-derive; they must survive into the next regrade too.
  if (Array.isArray(row?._carried_caveats) && row._carried_caveats.length) out._carried_caveats = row._carried_caveats.slice();
  if (row?._carried_oneoff_cap) out._carried_oneoff_cap = row._carried_oneoff_cap;
  if (row?._guidance_prior_tier) out._guidance_prior_tier = row._guidance_prior_tier;
  return out;
}

function attachGradeInput(card: any, row: any): void {
  // A regrade passes the stored input back in; keep it exactly as it was.
  if (row?._regrade === true && row?._stored_input) { card.grade_input = row._stored_input; return; }
  card.grade_input = pickIndiaGradeInput(row);
}

// ═══════════════════════════════════════════════════════════════════════════
// CASH, READ HONESTLY.                                              (zzz821)
//
// Indian companies publish no quarterly cash flow. The only cash figure that
// means anything is last fiscal year's operating cash flow against the SAME
// year's profit — and the live page was dividing annual CFO by ONE QUARTER's
// profit (PAKKA: FY26 CFO ₹75 Cr ÷ Jun-26 quarter PAT ₹5.89 Cr = "12.7x"),
// which made "earnings are cash-backed" pass almost everywhere. Enrichment
// now builds the ratio only from the two columns carrying the same fiscal-
// year label and sends that label as `cash_fy`. Here: no label → unknown. A
// ratio that disagrees with its own two figures → unknown. A CFO of exactly
// zero is Screener's "no figure" → unknown. For a bank, NBFC or insurer the
// test is not meaningful at all (loan growth and premiums ARE operating cash
// flows), so it is skipped and says so.
// ═══════════════════════════════════════════════════════════════════════════
export interface IndiaCashView {
  /** Same-FY annual operating cash flow, ₹ Cr, or null. */
  ocf: number | null;
  /** Same-FY annual PAT, ₹ Cr, or null. */
  pat: number | null;
  /** ocf ÷ pat when meaningful, else null. */
  ratio: number | null;
  /** "FY26 full year" — the period the figures are for, or null. */
  basis: string | null;
  fy: string | null;
  /** Why there is no ratio, when there is a reason worth saying. */
  note: string | null;
}

/** Everything the engine and the card need to tell a financial company apart. */
export function indiaFinancialKind(row: any): FinancialKind | null {
  return financialKind({
    sector: row?.sector, industry: row?.industry,
    // Screener's "Broad Industry" (e.g. "Finance", "Insurance").
    sub_sector: row?.broad_industry ?? row?.sub_sector,
    company: row?.company,
  });
}

export function indiaCashView(row: any): IndiaCashView {
  const n = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  const none = (note: string | null, fy: string | null = null): IndiaCashView =>
    ({ ocf: null, pat: null, ratio: null, basis: null, fy, note });
  if (indiaFinancialKind(row)) return none('not meaningful for lenders');
  const fy = typeof row?.cash_fy === 'string' && row.cash_fy.trim() ? row.cash_fy.trim() : null;
  if (!fy) return none(null);   // a ratio with no fiscal year may be annual CFO ÷ one quarter (zzz821) — the year must travel with it (zzz965)
  let ocf = n(row?.ocf_annual_cr);
  const pat = n(row?.pat_annual_cr);
  if (ocf === 0) ocf = null;
  if (ocf == null || pat == null || pat === 0) return none(null, fy);
  let ratio = n(row?.ocf_to_pat_ratio);
  if (ratio === 0) ratio = null;
  if (ratio != null && pat > 0 && Math.abs(ratio - ocf / pat) > Math.max(0.05, Math.abs(ocf / pat) * 0.05)) ratio = null;
  const basis = typeof row?.cash_basis === 'string' && row.cash_basis ? row.cash_basis
    : (/^mar\s/i.test(fy) ? `FY${fy.slice(-2)} full year` : `year to ${fy}`);
  return { ocf, pat, ratio, basis, fy, note: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKET-DRIVEN EARNINGS.                                          (zzz821)
//
// An investment holding company, a proprietary / algorithmic trader or a
// stockbroker reports profit that moves with the market: a year of investment
// gains or trading volumes is not an operating business compounding. Such a
// company can have a very good quarter, but not a BLOCKBUSTER one. Detected
// from Screener's industry text first (Investment Company, Holding Company,
// Stockbroking), then from the company's registered name (an "Investments"
// company that is not a finance/bank/insurer, or an "Algo…" trading house).
// Never from a ticker list.
// ═══════════════════════════════════════════════════════════════════════════
export function marketDrivenKind(row: any): string | null {
  const ind = [row?.industry, row?.broad_industry, row?.sector, row?.sub_sector].filter(Boolean).map(String).join(' | ');
  if (/\binvestment\s+compan/i.test(ind)) return 'investment company';
  if (/\bholding\s+compan/i.test(ind)) return 'holding company';
  if (/\bstock\s*-?\s*broking|\bproprietary\s+trading/i.test(ind)) return 'broking / trading';
  const name = String(row?.company || '');
  if (/\balgo[a-z]*/i.test(name)) return 'algorithmic trading';
  if (/\binvestments?\b|\binvestment\s+(corporation|company|trust)\b/i.test(name)
      && !/\b(financ\w*|bank\w*|insurance|housing|credit|lending)\b/i.test(name)) return 'investment company';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE F ("PROFIT JUMP · FORENSICS") CHECK, FOR INDIA.               (zzz821)
//
// The card's pattern badge fires F when EPS grew more than 3× revenue growth
// and more than 100%: a profit jump that the top line does not explain. On
// the India side it could never clear — the US check needs free cash flow,
// which India does not have — so BLOCKBUSTER cards sat under an unresolved
// forensics badge. The check now runs HERE, on India's own evidence, and the
// result travels on the row (`forensic_check`) so the badge can say which:
//   · explained by operations — revenue growth × the operating-margin step
//     (5+ pts of slack for interest and tax) covers the EPS growth;
//   · backed by cash — same-year CFO ÷ PAT of at least 0.8.
// Both → 'passed'. Either one contradicted by a reported figure →
// 'not_passed'. Either one not measurable → 'unverified' (unknown, not
// negative). BLOCKBUSTER requires 'passed'; 'not_passed' also counts as a
// growth-quality problem for the tier.
// ═══════════════════════════════════════════════════════════════════════════
export interface IndiaForensicCheck {
  status: 'passed' | 'not_passed' | 'unverified';
  reason: string;
}
export function indiaForensicCheck(i: {
  salesY: number | null; epsY: number | null; patY: number | null;
  opmPct: number | null; opmPrevPct: number | null;
  cfoToPat: number | null; isFinancial: boolean;
}): IndiaForensicCheck | null {
  const g = i.epsY ?? i.patY;
  if (i.salesY == null || g == null || i.salesY < 1) return null;
  if (!(g > 100 && g / i.salesY > 3)) return null;
  let explained: boolean | null = null;
  if (!i.isFinancial && i.opmPct != null && i.opmPrevPct != null && i.opmPct > 0 && i.opmPrevPct > 0) {
    const opG = ((1 + i.salesY / 100) * (i.opmPct / i.opmPrevPct) - 1) * 100;
    explained = i.opmPct - i.opmPrevPct >= 0.5 && g <= opG * 1.25 + 10;
  } else if (!i.isFinancial && i.opmPct != null && i.opmPrevPct != null && i.opmPct <= i.opmPrevPct) {
    explained = false;   // margin did not rise, so operations cannot explain the jump
  }
  let cash: boolean | null = null;
  if (!i.isFinancial && i.cfoToPat != null) cash = i.cfoToPat >= 0.8;
  if (explained === false || cash === false) {
    return { status: 'not_passed', reason: explained === false
      ? 'profit grew far faster than revenue and the operating margin does not explain it'
      : 'profit grew far faster than revenue and the cash flow does not back it' };
  }
  if (explained === true && cash === true) {
    return { status: 'passed', reason: 'the profit jump is explained by the operating margin and backed by same-year cash flow' };
  }
  return { status: 'unverified', reason: explained == null
    ? 'profit grew far faster than revenue; the operating figures needed to explain it are not on file'
    : 'profit grew far faster than revenue; explained by the margin, but same-year cash flow is not on file' };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA BLOCKBUSTER CONFIRMATION GATE, AND THE STRONG FLOOR.
//                                                     (zzz819, zzz821)
//
// Every BLOCKBUSTER path in `decideTier` is a PERCENTAGE test, and a
// percentage off a tiny base clears any of them. A row the magnitude paths
// call BLOCKBUSTER must ALSO show, from the filing (price never counts):
//   1. revenue growth of at least 15%;
//   2. profit growth that is real — not a first profit after a loss (that
//      needs another quarter to confirm), not a jump off a small year-ago
//      profit (under ₹2 Cr or under 2% of sales) unless revenue +25% and a
//      3-pt margin gain carry it, not flagged 'optical eps', and — when the F
//      pattern fires — a forensic check that PASSED;
//   3. a healthy margin: operating 12%+ (or a large step-up) for a company,
//      net 10%+ for a bank / NBFC / insurer;
//   4. cash backing when same-year figures exist (CFO ≥ 0.6× PAT, never
//      negative against a profit) — skipped for financial companies;
//   5. no other open quality flag;
//   6. not a market-driven earner (investment / trading company).
//
// PROBLEMS ARE COUNTED BY KIND, not by line: growth quality (small base,
// optical EPS, first profit, an unexplained jump), thin margin, weak or
// negative cash, other quality flags. Revenue below the 15% floor and data we
// do not have are reasons, not problems. One problem → STRONG. Two or more
// distinct problems → MIXED. Weak growth itself (revenue under +5%, or under
// +15% with only small-base profit growth) → MIXED.
// ═══════════════════════════════════════════════════════════════════════════
/** zzz826 — shell-company flags (context only, never the tier). */
export const IN_VERY_SMALL_MCAP_CR = 100;
export const IN_BARELY_TRADES_MCAP_CR = 500;
export const IN_BARELY_TRADES_ADTV_CR = 0.10;
export const IN_BB_MIN_REVENUE_GROWTH = 15;
export const IN_BB_WEAK_REVENUE_GROWTH = 5;
export const IN_BB_SMALL_BASE_PAT_CR = 2;
export const IN_BB_SMALL_BASE_MARGIN_PCT = 2;
export const IN_BB_HEALTHY_OPM_PCT = 12;
export const IN_BB_LENDER_NET_MARGIN_PCT = 10;
export const IN_BB_MIN_CASH_CONVERSION = 0.6;
/** STRONG floor (zzz821). */
export const IN_STRONG_MIN_OPM_PCT = 5;
export const IN_STRONG_SLOW_REVENUE_PCT = 10;
export const IN_STRONG_SLOW_REVENUE_MIN_OPM = 10;
export const IN_STRONG_SLOW_REVENUE_MIN_STEP = 2;
export const IN_STRONG_MAX_LOSS_TO_REVENUE = 0.25;

const CASH_FLAGS = ['ocf divergence', 'profit without operating cash', 'earnings outrun both revenue and cash'];
const OTHER_FLAGS = ['low quality', 'tax distortion', 'exceptional item', 'headline leans on a one-off', 'multiple quality flags'];
/** Flags that say the engine found something wrong in the filing. */
export const IN_BB_BLOCKING_FLAGS: readonly string[] = ['optical eps', ...CASH_FLAGS, ...OTHER_FLAGS];

export type IndiaProblemKind = 'growth quality' | 'thin margin' | 'cash' | 'quality flag';

export interface IndiaBlockbusterGateInput {
  salesY: number | null;
  patY: number | null;
  opmPct: number | null; opmPrevPct: number | null;
  salesCurCr: number | null; salesPrevCr: number | null;
  patCurCr: number | null; patPrevCr: number | null;
  epsPrev: number | null;
  /** Same-year CFO ÷ PAT (see indiaCashView); null when unknown. */
  cfoToPat: number | null;
  ocfAnnualCr: number | null; patAnnualCr: number | null;
  isLender: boolean;
  caveatTags: readonly string[];
  /** zzz821 — see indiaForensicCheck. Undefined/null when F did not fire. */
  forensic?: IndiaForensicCheck | null;
  /** zzz821 — see marketDrivenKind. */
  marketDriven?: string | null;
}
export interface IndiaBlockbusterGateResult {
  tier: 'BLOCKBUSTER' | 'STRONG' | 'MIXED';
  misses: string[];
  /** The distinct problem kinds found (reasons like "revenue below 15%" are not problems). */
  problems: IndiaProblemKind[];
  /** One plain line, e.g. "Capped at STRONG: revenue grew only 5%". Null when passed. */
  reason: string | null;
}

const _pct = (v: number): string => {
  const r = Math.round(v);
  return r === 0 ? '0' : `${r}`;
};
const _cr = (v: number): string => `₹${Math.abs(v) >= 100 ? Math.round(Math.abs(v)) : Math.round(Math.abs(v) * 100) / 100} Cr`;
const _one = (v: number): string => `${Math.round(v * 10) / 10}`;

/** The problems a quarter carries, by kind — shared by the gate and the STRONG floor. */
function indiaProblems(i: IndiaBlockbusterGateInput): { items: Array<{ kind: IndiaProblemKind; text: string }>; smallBase: boolean; firstProfit: boolean } {
  const items: Array<{ kind: IndiaProblemKind; text: string }> = [];
  const opmExp = i.opmPct != null && i.opmPrevPct != null ? i.opmPct - i.opmPrevPct : null;
  const revKnown = i.salesY != null && Number.isFinite(i.salesY);

  // Growth quality.
  const firstProfit = i.patPrevCr != null && i.patPrevCr <= 0 && i.patCurCr != null && i.patCurCr > 0;
  if (firstProfit) items.push({ kind: 'growth quality', text: 'first profit after a loss — needs another quarter to confirm' });
  const priorMargin = (i.patPrevCr != null && i.salesPrevCr != null && i.salesPrevCr > 0)
    ? (i.patPrevCr / i.salesPrevCr) * 100 : null;
  const smallBase = !firstProfit && (
    (i.patPrevCr != null && i.patPrevCr > 0 && (i.patPrevCr < IN_BB_SMALL_BASE_PAT_CR
      || (priorMargin != null && priorMargin < IN_BB_SMALL_BASE_MARGIN_PCT)))
    || (i.patPrevCr == null && i.epsPrev != null && Math.abs(i.epsPrev) < 0.5));
  let smallBaseProblem = false;
  if (smallBase) {
    const growthOk = revKnown && (i.salesY as number) >= 25;
    const marginOk = i.isLender || (opmExp != null && opmExp >= 3);
    if (!growthOk || !marginOk) {
      smallBaseProblem = true;
      const base = i.patPrevCr != null
        ? `small year-ago profit (${_cr(i.patPrevCr)}${priorMargin != null ? `, ${_one(priorMargin)}% of sales` : ''})`
        : 'small year-ago EPS';
      items.push({ kind: 'growth quality', text: `profit rose from a ${base}, so the growth rate overstates the change` });
    }
  }
  if (i.caveatTags.includes('optical eps')) items.push({ kind: 'growth quality', text: 'EPS grew far faster than the business explains (optical EPS)' });
  if (i.forensic?.status === 'not_passed') items.push({ kind: 'growth quality', text: `forensic check not passed: ${i.forensic.reason}` });

  // Margin.
  if (i.isLender) {
    const nm = (i.patCurCr != null && i.salesCurCr != null && i.salesCurCr > 0) ? (i.patCurCr / i.salesCurCr) * 100 : null;
    if (nm != null && nm < IN_BB_LENDER_NET_MARGIN_PCT) items.push({ kind: 'thin margin', text: `thin net margin for a lender (${_one(nm)}%)` });
  } else if (i.opmPct != null) {
    const bigStep = opmExp != null && opmExp >= 5 && i.opmPrevPct != null && i.opmPrevPct > 0 && opmExp / i.opmPrevPct >= 0.5;
    if (i.opmPct < IN_BB_HEALTHY_OPM_PCT && !bigStep) items.push({ kind: 'thin margin', text: `thin operating margin (${_one(i.opmPct)}%)` });
  }

  // Cash (companies only; figures are same-year or absent).
  if (!i.isLender) {
    if (i.ocfAnnualCr != null && i.ocfAnnualCr < 0 && i.patAnnualCr != null && i.patAnnualCr > 0) {
      items.push({ kind: 'cash', text: 'operating cash flow was negative against a reported profit' });
    } else if (i.cfoToPat != null && i.cfoToPat < IN_BB_MIN_CASH_CONVERSION) {
      items.push({ kind: 'cash', text: i.cfoToPat < 0
        ? 'operating cash flow was negative against a reported profit'
        : `cash does not back the profit (operating cash ${Math.round(i.cfoToPat * 100) / 100}× profit)` });
    }
    const cf = CASH_FLAGS.filter((t) => i.caveatTags.includes(t));
    if (cf.length && !items.some((x) => x.kind === 'cash')) items.push({ kind: 'cash', text: `open flag${cf.length > 1 ? 's' : ''}: ${cf.join(', ')}` });
  }

  // Other open quality flags.
  const of = OTHER_FLAGS.filter((t) => i.caveatTags.includes(t));
  if (of.length) items.push({ kind: 'quality flag', text: `open flag${of.length > 1 ? 's' : ''}: ${of.join(', ')}` });

  return { items, smallBase: smallBaseProblem, firstProfit };
}

const _distinct = (items: Array<{ kind: IndiaProblemKind }>): IndiaProblemKind[] => Array.from(new Set(items.map((x) => x.kind)));

export function indiaBlockbusterGate(i: IndiaBlockbusterGateInput): IndiaBlockbusterGateResult {
  const misses: string[] = [];
  const revKnown = i.salesY != null && Number.isFinite(i.salesY);
  // Reasons that are not problems: revenue below the floor, data not on file,
  // a market-driven business.
  if (!revKnown) misses.push('revenue growth not reported, so the top tier cannot be confirmed');
  else if ((i.salesY as number) < IN_BB_MIN_REVENUE_GROWTH) {
    const y = i.salesY as number;
    misses.push(Math.round(y) === 0 ? 'revenue was flat'
      : y < 0 ? `revenue fell ${_pct(Math.abs(y))}%`
      : `revenue grew only ${_pct(y)}%`);
  }
  if (i.isLender && !(i.patCurCr != null && i.salesCurCr != null && i.salesCurCr > 0)) misses.push('net margin not measurable from the figures on file');
  if (!i.isLender && i.opmPct == null) misses.push('operating margin not reported, so the top tier cannot be confirmed');
  if (i.forensic?.status === 'unverified') misses.push(`forensic check not yet possible — ${i.forensic.reason}`);
  if (i.marketDriven) misses.push(`market-driven earnings (${i.marketDriven}) — profit moves with investment gains and markets`);

  const pr = indiaProblems(i);
  for (const x of pr.items) misses.push(x.text);
  const problems = _distinct(pr.items);
  if (misses.length === 0) return { tier: 'BLOCKBUSTER', misses, problems, reason: null };
  const weakGrowth = (revKnown && (i.salesY as number) < IN_BB_WEAK_REVENUE_GROWTH)
    || (pr.smallBase && revKnown && (i.salesY as number) < IN_BB_MIN_REVENUE_GROWTH);
  const tier = (weakGrowth || problems.length >= 2) ? 'MIXED' : 'STRONG';
  return { tier, misses, problems, reason: `Capped at ${tier}: ${misses.join('; ')}` };
}

export interface IndiaStrongFloorInput extends IndiaBlockbusterGateInput {
  epsY: number | null;
}
/**
 * zzz821 — what a STRONG quarter may not be. Applied to every row the ladder
 * (or the BLOCKBUSTER gate) left at STRONG. Unknown figures never demote.
 */
export function indiaStrongFloor(i: IndiaStrongFloorInput): { tier: 'STRONG' | 'MIXED'; misses: string[]; problems: IndiaProblemKind[] } {
  const misses: string[] = [];
  const opmExp = i.opmPct != null && i.opmPrevPct != null ? i.opmPct - i.opmPrevPct : null;
  // (a) an operating loss.
  if (!i.isLender && i.opmPct != null && i.opmPct < 0) misses.push(`operating margin is negative (${_one(i.opmPct)}%)`);
  // (e) a margin too thin to carry a strong grade.
  else if (!i.isLender && i.opmPct != null && i.opmPct < IN_STRONG_MIN_OPM_PCT) misses.push(`very thin operating margin (${_one(i.opmPct)}%)`);
  // (b) profit fell.
  if (i.patY != null && i.patY < 0) misses.push(`profit fell ${_pct(Math.abs(i.patY))}% year on year`);
  // (c) a loss that is large against the business.
  if (i.patCurCr != null && i.patCurCr < 0 && i.salesCurCr != null && i.salesCurCr > 0
      && -i.patCurCr > IN_STRONG_MAX_LOSS_TO_REVENUE * i.salesCurCr) {
    misses.push(`still loss-making — a loss of ${_cr(i.patCurCr)} on ${_cr(i.salesCurCr)} of revenue`);
  }
  // (f) slow revenue needs a real margin, and a real margin step-up.
  if (!i.isLender && i.salesY != null && i.salesY < IN_STRONG_SLOW_REVENUE_PCT && i.opmPct != null
      && (i.opmPct < IN_STRONG_SLOW_REVENUE_MIN_OPM || (opmExp != null && opmExp < IN_STRONG_SLOW_REVENUE_MIN_STEP))) {
    misses.push(`revenue grew only ${_pct(i.salesY)}% without a strong margin to carry it (operating margin ${_one(i.opmPct)}%${opmExp != null ? `, ${opmExp >= 0 ? '+' : '−'}${_one(Math.abs(opmExp))} pts` : ''})`);
  }
  const pr = indiaProblems(i);
  const problems = _distinct(pr.items);
  if (problems.length >= 2) misses.push(`${problems.length} separate problems: ${pr.items.map((x) => x.text).join('; ')}`);
  return { tier: misses.length ? 'MIXED' : 'STRONG', misses, problems };
}

/** IST calendar date (YYYY-MM-DD). Pure — no Intl, no env. */
function istTodayIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

function _gradeIndiaRow(rowIn: any, drop: (reason: string) => null): IndiaGradedRow | null {
  // zzz821 — every rule below reads cash through these three fields, so they
  // are replaced ONCE, here, by the same-fiscal-year view (or nulls). No rule
  // can see an annual-CFO ÷ quarterly-PAT ratio again.
  const _cashView = indiaCashView(rowIn);
  const _finKind = indiaFinancialKind(rowIn);
  const row: any = {
    ...rowIn,
    ocf_annual_cr: _cashView.ocf, pat_annual_cr: _cashView.pat, ocf_to_pat_ratio: _cashView.ratio,
  };
  const salesY = row?.sales_yoy_pct ?? null;
  // ═══════════════════════════════════════════════════════════════════════
  // NO GROWTH RATE OFF A LOSS.                                     (zzz800)
  //
  // Enrichment computes PAT/EPS YoY as (curr − prev) / |prev|, so a loss that
  // narrowed from ₹7.61 Cr to ₹1.74 Cr arrives here as "+77%". That number
  // then opened megaMag / Path C, earned SEPA / CANSLIM / Bonde EP (all of
  // which mean EPS GROWTH), and was printed on the card as profit growth —
  // KABRAEXTRU Q1 FY27. When the year-ago figure is a loss the percentage is
  // refused here, at the one place every India verdict passes through, and
  // the move is described by `profitTrajectory` instead ("loss narrowed
  // ₹7.61 Cr → ₹1.74 Cr"). The US engine has refused it for a long time.
  // ═══════════════════════════════════════════════════════════════════════
  const _numA = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  const _patCurA = _numA(row?.pat_curr_cr), _patPrevA = _numA(row?.pat_prev_cr);
  const _epsCurA = _numA(row?.eps_curr), _epsPrevA = _numA(row?.eps_prev);
  const _patNegBase = (_patPrevA != null && _patPrevA < 0) || (_patPrevA == null && _epsPrevA != null && _epsPrevA < 0);
  const _epsNegBase = (_epsPrevA != null && _epsPrevA < 0) || (_epsPrevA == null && _patPrevA != null && _patPrevA < 0);
  const patYRaw: number | null = _patNegBase ? null : _numA(row?.pat_yoy_pct);
  const epsYRaw: number | null = _epsNegBase ? null : _numA(row?.eps_yoy_pct);
  // ═══════════════════════════════════════════════════════════════════════
  // PROFIT AND EPS MUST TELL THE SAME STORY.                       (zzz821)
  //
  // PAT +274% with EPS +64% (or PAT +21% with EPS +111%) means the share
  // count, a minority interest or a mis-read line moved one of them. The
  // quarter is graded on the LOWER of the two and the card says so. When they
  // point in OPPOSITE directions the figures themselves are in doubt: the row
  // is held (see `figures_conflict` below) rather than graded on either.
  // ═══════════════════════════════════════════════════════════════════════
  let growth_basis_note: string | null = null;
  let figures_conflict: string | null = null;
  let patY: number | null = patYRaw, epsY: number | null = epsYRaw;
  if (patYRaw != null && epsYRaw != null) {
    const sgn = (v: number) => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);
    if (sgn(patYRaw) * sgn(epsYRaw) < 0) {
      figures_conflict = `profit and EPS moved in opposite directions (PAT ${patYRaw >= 0 ? '+' : ''}${Math.round(patYRaw)}%, EPS ${epsYRaw >= 0 ? '+' : ''}${Math.round(epsYRaw)}%) — held until the figures are re-checked`;
    } else if (patYRaw > 0 && epsYRaw > 0 && Math.max(patYRaw, epsYRaw) > 1.5 * Math.min(patYRaw, epsYRaw)) {
      const lo = Math.min(patYRaw, epsYRaw);
      patY = lo; epsY = lo;
      growth_basis_note = `graded on the lower of PAT (+${Math.round(patYRaw)}%) and EPS (+${Math.round(epsYRaw)}%) growth — the two disagree`;
    }
  }
  const opmExp = row?.opm_pct != null && row?.opm_prev_pct != null ? row.opm_pct - row.opm_prev_pct : null;
  // Financials are PRESENT even when the percentage was refused — a turnaround
  // with a negative base must not fall into the no-financials preview path.
  const hasFin = salesY != null || patY != null || epsY != null
    || ((_patNegBase || _epsNegBase) && (_patCurA != null || _epsCurA != null));
  const hubQuality = row?.hub_quality;

  // No-financials preview path
  if (!hasFin) {
    // zzz800 — a hub-'Upcoming' row whose Screener table already shows a
    // quarter ending 0–95 days before the filing date HAS filed (Screener only
    // renders the quarter after the results exist) — the same corroboration the
    // main path accepts below (zzz414). Recent listings reach this preview path
    // precisely because they have no year-ago column, so without this escape a
    // newly-listed filer scheduled via a board meeting was dropped here.
    const _hasAbs = row?.sales_curr_cr != null || row?.pat_curr_cr != null || row?.eps_curr != null;
    let _upcomingCorroborated = false;
    if (hubQuality === 'Upcoming' && _hasAbs && row?.latest_quarter_end_iso && row?.filing_date) {
      const qe = new Date(row.latest_quarter_end_iso).getTime();
      const fd = new Date(row.filing_date).getTime();
      if (!isNaN(qe) && !isNaN(fd)) {
        const d = (fd - qe) / 86_400_000;
        _upcomingCorroborated = d >= 0 && d <= 95;
      }
    }
    if (!hubQuality) return drop('no financials and no hub confirmation');
    if (hubQuality === 'Upcoming' && !_upcomingCorroborated) return drop('scheduled (Upcoming) — no filing confirmed and no fresh quarter on Screener');
    // zzz800 — 'Confirmed' is what the live NSE/BSE feed (and a prior grade)
    // stamps on a REAL filing whose quality is unknown. It fell through to
    // AVOID / 22 — "fails the bar" — for every absolute-only card, which is
    // where a newly-listed company lands (no year-ago quarter), so a recent
    // IPO that filed a perfectly good first quarter was published as AVOID and
    // could never reach Opportunities or the bench. Unknown quality is MIXED.
    const _hq = _upcomingCorroborated || hubQuality === 'Confirmed' || hubQuality === 'Preview' ? 'Good' : hubQuality;
    const tier: EarningsTier =
      _hq === 'Excellent' ? 'BLOCKBUSTER' :
      _hq === 'Great'     ? 'STRONG' :
      _hq === 'Good'      ? 'MIXED' :
      _hq === 'OK'        ? 'MIXED' :
                                   'AVOID';
    const score = _hq === 'Excellent' ? 88 : _hq === 'Great' ? 76 : _hq === 'Good' ? 58 : _hq === 'OK' ? 42 : 22;
    const move = row?.move_pct ?? null;
    const moveLabel = move != null ? ` (${move >= 0 ? '+' : ''}${move.toFixed(1)}% on the day)` : '';
    // zzz187: preserve absolute-quarter values + PE + market cap from enrichment.
    // Prior fix blanked everything just because YoY couldn't be computed. Show
    // whatever came in from /enrich so the card is informative even without YoY.
    const hasAnyAbsolute = row?.sales_curr_cr != null || row?.pat_curr_cr != null || row?.eps_curr != null || row?.pe != null || row?.marketCapCr != null;
    const absoluteBits: string[] = [];
    if (row?.sales_curr_cr != null) absoluteBits.push(`Rev \u20B9${row.sales_curr_cr}Cr`);
    if (row?.pat_curr_cr != null) absoluteBits.push(`PAT \u20B9${row.pat_curr_cr}Cr`);
    if (row?.eps_curr != null) absoluteBits.push(`EPS \u20B9${row.eps_curr}`);
    const absStr = absoluteBits.length ? ' \u00b7 ' + absoluteBits.join(' \u00b7 ') : '';
    // zzz503 \u2014 honest labelling of the no-YoY case. The previous copy
    // ("YoY comparison unavailable (prior-period data missing)") read like a
    // pipeline bug. In practice a company reaches this branch \u2014 full current
    // absolutes but zero prior-period and zero YoY \u2014 almost only when it is
    // NEWLY LISTED (Screener has no year-ago column because it wasn't trading a
    // year ago). We now say so plainly, and enrich a richer one-liner (net
    // margin + price/PE) so the card is genuinely informative, not a stub.
    const _isNew = row?.newly_listed === true
      || (row?.num_quarters != null && row.num_quarters <= 5)
      || (hasAnyAbsolute && row?.sales_prev_cr == null && row?.pat_prev_cr == null && row?.eps_prev == null);
    const _netMargin = (row?.pat_curr_cr != null && row?.sales_curr_cr != null && row.sales_curr_cr > 0)
      ? Math.round((row.pat_curr_cr / row.sales_curr_cr) * 1000) / 10 : null;
    const _marginBit = _netMargin != null ? ` (${_netMargin}% net margin)` : '';
    const _priceBits: string[] = [];
    if (row?.current_price != null) _priceBits.push(`\u20b9${row.current_price}`);
    if ((row?.pe ?? row?.stockPE) != null) _priceBits.push(`P/E ${Math.round(row.pe ?? row.stockPE)}`);
    const _priceStr = _priceBits.length ? ` \u00b7 trades at ${_priceBits.join(', ')}` : '';
    // zzz505 \u2014 a newly-listed company HAS no year-ago quarter, but Screener
    // does carry its short sequential history (JNPR: sales 161\u2192213\u2192291,
    // EPS 0.44\u21920.44\u21920.68). YoY is impossible; the QoQ trend is the correct
    // comparison and we already have it in quarters_sales/quarters_eps. Surface
    // it so the card shows real momentum instead of three "\u2014" tiles.
    const _seqStr = (() => {
      const qs: number[] = Array.isArray(row?.quarters_sales) ? row.quarters_sales.filter((x: any) => typeof x === 'number') : [];
      const qe: number[] = Array.isArray(row?.quarters_eps) ? row.quarters_eps.filter((x: any) => typeof x === 'number') : [];
      const bits: string[] = [];
      if (qs.length >= 2) {
        const a = qs[qs.length - 2], b = qs[qs.length - 1];
        const g = a > 0 ? Math.round((b / a - 1) * 100) : null;
        bits.push(`revenue \u20b9${a}\u2192${b}Cr QoQ${g != null ? ` (${g >= 0 ? '+' : ''}${g}%)` : ''}`);
      }
      if (qe.length >= 2) {
        const a = qe[qe.length - 2], b = qe[qe.length - 1];
        bits.push(`EPS \u20b9${a}\u2192\u20b9${b}`);
      }
      return bits.length ? ` Sequential trend: ${bits.join(', ')}.` : '';
    })();
    const _opmBit = (row?.opm_pct != null) ? ` OPM ${Math.round(row.opm_pct)}%.` : '';
    // Re-word absStr to attach the net-margin note to PAT for the newly-listed line.
    const _absNew = (() => {
      const bits: string[] = [];
      if (row?.sales_curr_cr != null) bits.push(`Rev \u20b9${row.sales_curr_cr}Cr`);
      if (row?.pat_curr_cr != null) bits.push(`PAT \u20b9${row.pat_curr_cr}Cr${_marginBit}`);
      if (row?.eps_curr != null) bits.push(`EPS \u20b9${row.eps_curr}`);
      return bits.length ? ' \u00b7 ' + bits.join(' \u00b7 ') : '';
    })();
    const narrative = hasAnyAbsolute
      ? (_isNew
          ? `${row.company || row.symbol} ${deriveQuarterLabel(row.filing_date)} results${moveLabel}${_absNew}.${_opmBit}${_priceBits.length ? ' Trades at ' + _priceBits.join(', ') + '.' : ''} Newly listed \u2014 no year-ago comparable yet, so judge it on the sequential trend.${_seqStr}`
          : `${row.company || row.symbol} ${deriveQuarterLabel(row.filing_date)} results${moveLabel}${absStr}. Absolute figures shown; year-ago quarter not yet in source.${_seqStr}`)
      : `${row.company || row.symbol} reported ${deriveQuarterLabel(row.filing_date)} results${moveLabel}. Financial detail awaiting enrichment.`;
    return {
      ticker: row.symbol, company: row.company || row.symbol, sector: row.sector, filing_date: row.filing_date,
      quarter: row.quarter || deriveQuarterLabel(row.filing_date), market_cap_bucket: row.market_cap_bucket,
      market_cap_cr: row.marketCapCr ?? row.market_cap_cr ?? null,
      pe: row.pe ?? row.stockPE ?? null,
      price: row.current_price ?? null,
      sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
      sales_curr_cr: row.sales_curr_cr ?? null, sales_prev_cr: null,
      pat_curr_cr: row.pat_curr_cr ?? null, pat_prev_cr: null,
      eps_curr: row.eps_curr ?? null, eps_prev: null,
      gap_pct: row.gap_pct ?? null, d1_pct: row.d1_pct ?? null, move_pct: move,
      rs_rating: row.rs_rating ?? null, stage: row.stage ?? null, pct_from_52w_high: row.pct_from_52w_high ?? null,
      opm_pct: row.opm_pct ?? null, opm_prev_pct: null,  // zzz505 — surface OPM on newly-listed cards (we had it, were dropping it)
      quarters_sales: row.quarters_sales ?? null, quarters_eps: row.quarters_eps ?? null,
      // zzz507 — quarterly PAT. Screener's DIRECT path gives a real Net-Profit
      // row; the WORKER path (JNPR) only carries sales/EPS. Derive PAT from the
      // EPS series when the real row is absent: shares = latest PAT / latest EPS
      // (exact for the latest quarter), then PATᵢ ≈ EPSᵢ × shares. For a recent
      // IPO with post-listing dilution this is conservative (understates growth),
      // never overstated — a safe fill for the NET PROFIT QoQ tile.
      quarters_pat: (() => {
        if (Array.isArray(row.quarters_pat) && row.quarters_pat.length >= 2) return row.quarters_pat;
        const qe: number[] = Array.isArray(row.quarters_eps) ? row.quarters_eps.filter((x: any) => typeof x === 'number') : [];
        if (qe.length >= 2 && row.pat_curr_cr != null && row.eps_curr && row.eps_curr !== 0) {
          const shares = row.pat_curr_cr / row.eps_curr;
          return qe.map((e: number) => Math.round(e * shares * 10) / 10);
        }
        return null;
      })(),
      composite_score: score, tier,
      methodology_tags: [],
      caveat_tags: hasAnyAbsolute ? [_isNew ? 'newly listed' : 'no YoY yet'] : [],
      narrative,
      filing_url: row.source_url,
      source: hasAnyAbsolute ? (row.financials_source || 'screener-worker') : 'NSE+BSE',
      // ── zzz670 — A NEWLY-LISTED COMPANY IS NOT AN UNMEASURABLE ONE ───────
      //
      // This early return is the preview path for a filer with no year-ago
      // comparable, and it skipped the Quality × Inflection axes entirely — so
      // Shiprocket showed no Q and no I despite the feed carrying ROCE −2.7%,
      // operating margin −1.8% against −2.2% and a sequential revenue trend.
      // Those are exactly the inputs the quadrant is built from, and NONE of
      // them needs a year-ago quarter.
      //
      // `quadrantScore` already refuses to judge on too little evidence — it
      // returns a null quadrant below 25 assessable points — so letting it look
      // can only produce an honest answer or an honest absence. Hard-coding the
      // absence was the one option that could be wrong.
      //
      // PEAD is deliberately still omitted here: post-earnings drift is built
      // on a surprise and a reaction, and a first-ever print has neither. A
      // number computed from zeros would look like a reading.
      ...(() => {
        try {
          const _pq = quadrantForIndiaRow(row, {
            salesY: row?.sales_yoy_pct ?? null,
            opmExp: (row?.opm_pct != null && row?.opm_prev_pct != null)
              ? row.opm_pct - row.opm_prev_pct : null,
          });
          return {
            quality_score: _pq.quality,
            inflection_score: _pq.inflection,
            quadrant: _pq.quadrant,
            quadrant_parts: { quality: _pq.quality_parts, inflection: _pq.inflection_parts },
          };
        } catch { return {}; }
      })(),
    };
  }

  // Future date guard
  // zzz800 — IST, not UTC. Between 00:00 and 05:30 IST the UTC date is still
  // yesterday, so every filing dated today-IST was dropped as "future" until
  // 05:30 — exactly when late-night result filings land.
  // zzz819 — a REGRADE re-applies the rules to a card that already passed
  // every attribution guard when it was first graded. The guards below read
  // fields (announce date, Screener quarter end) that a stored card does not
  // carry, and the calendar has moved on since, so on a regrade they would
  // drop real filings for reasons that have nothing to do with the rules.
  const _regrade = row?._regrade === true;
  const todayIso = istTodayIso();
  if (!_regrade && row?.filing_date && row.filing_date > todayIso) return drop(`filing date ${row.filing_date} is in the future`);

  // PATCH 0182 — STRICT announce-date attribution guard.
  // The previous data flow attributed Screener's LATEST Q4 financials to whatever
  // date /api/market/earnings reported as the resultDate. This produced wrong
  // dates when a company's actual filing was weeks earlier (JTLIND/GARUDA/SATIN
  // appearing on May 12 when they filed in April).
  // Now: if /enrich returned an announce_date_iso (NSE re_broadcastDt — the
  // authoritative filing timestamp), it MUST match the page's filing_date
  // within ±3 days. Outside that window = wrong attribution, drop the row.
  if (!_regrade && row?.announce_date_iso && row?.filing_date) {
    const announceD = new Date(row.announce_date_iso);
    const filingD = new Date(row.filing_date);
    if (!isNaN(announceD.getTime()) && !isNaN(filingD.getTime())) {
      const diffDays = Math.abs((announceD.getTime() - filingD.getTime()) / 86_400_000);
      if (diffDays > 3) return drop(`NSE announce date ${String(row.announce_date_iso).slice(0, 10)} is ${Math.round(diffDays)}d from filing date (wrong-date attribution guard)`);
    }
  }
  // zzz72 — require recent announce_date for past dates to prevent stale Screener data pollution.
  // PATCH 0182 only fires when announce_date_iso is present. On Screener-only rows it's null,
  // so the guard silently passes — Screener returns the LATEST quarter's financials, which
  // can be months old. Without announce_date_iso to verify the filing actually happened on
  // row.filing_date, we have no way to confirm this row is a real filing for that date.
  // Rule: if announce_date_iso is missing AND filing_date is in the past by more than 7 days
  // (i.e. user is querying a stale past date), skip — Screener's latest-quarter data is not a
  // safe substitute for an actual filing event on that historic date.
  // zzz190: the 7-day guard is meant to reject rows where Screener's latest-quarter
  // data cannot confirm the historic filing actually happened. But if hub_quality is
  // set to anything other than 'Upcoming' (Good/OK/Great/Excellent/Weak), the Earnings
  // Hub has already confirmed the filing. Keep those rows for historical browsing.
  if (!_regrade && !row?.announce_date_iso && row?.filing_date) {
    const filingD = new Date(row.filing_date);
    const todayD = new Date();
    if (!isNaN(filingD.getTime())) {
      const ageDays = (todayD.getTime() - filingD.getTime()) / 86_400_000;
      const hubConfirmed = row?.hub_quality && row.hub_quality !== 'Upcoming';
      // zzz414 — quarter-corroborated escape for hub-'Upcoming' rows.
      // The hub scheduled a RESULTS board meeting for exactly this date
      // (that's what an 'Upcoming' row IS), and Screener's quarterly table
      // now shows a quarter-end 0–95 days before the filing date — i.e. the
      // company's expected new quarter has appeared, which Screener only
      // renders after the results are actually filed. Together those two
      // signals confirm the filing happened as scheduled (DIVGIITTS Aug-11:
      // Jun-2026 quarter, 42 days). The GARUDA-class ghosts this guard
      // exists for serve a months-old quarter and still fail the window.
      let quarterCorroborated = false;
      if (row?.hub_quality === 'Upcoming' && row?.latest_quarter_end_iso) {
        const qe = new Date(row.latest_quarter_end_iso).getTime();
        if (!isNaN(qe)) {
          const qDays = (filingD.getTime() - qe) / 86_400_000;
          quarterCorroborated = qDays >= 0 && qDays <= 95;
        }
      }
      if (ageDays > 7 && !hubConfirmed && !quarterCorroborated) return drop('no announce date, older than 7d, not hub-confirmed, no fresh quarter (stale-data guard)');
    }
  }

  // PATCH 0178 — RELAXED quarter alignment.
  // Only drop on screener-only source with extreme mismatch (>95 days).
  // NSE/BSE-structured financials are authoritative — trust them even when
  // Screener latest_quarter_end_iso still shows the prior quarter.
  if (!_regrade && row?.period_ended && row?.latest_quarter_end_iso) {
    const promised = parseTrendlynePeriodEnd(row.period_ended);
    if (promised && promised !== row.latest_quarter_end_iso) {
      const diffDays = Math.abs((new Date(promised).getTime() - new Date(row.latest_quarter_end_iso).getTime()) / 86_400_000);
      const src = (row?.financials_source || '').toLowerCase();
      const isScreenerOnly = src === 'screener' || src === '';
      if (isScreenerOnly && diffDays > 95) return drop(`period ${row.period_ended} vs Screener quarter ${row.latest_quarter_end_iso} (quarter-mismatch guard)`);
    }
  }

  const methodology_tags: string[] = [];
  let caveat_tags: string[] = [];   // zzz665c — reassigned by the dedupe below
  const rs = row?.rs_rating ?? null;
  const stage = row?.stage ?? null;
  const ttPass = !!row?.trend_template_passes;
  const pct52 = row?.pct_from_52w_high ?? null;

  if (ttPass && rs != null && rs >= 70) methodology_tags.push('trend template');
  if (stage === 2 && rs != null && rs >= 80 && epsY != null && epsY >= 25 && pct52 != null && pct52 >= -15) methodology_tags.push('sepa');
  if (epsY != null && epsY >= 25 && (salesY ?? 0) >= 20 && rs != null && rs >= 70) methodology_tags.push('canslim');
  if (epsY != null && epsY >= 20 && (salesY == null || salesY >= 5)) methodology_tags.push('bonde ep');

  // ═══════════════════════════════════════════════════════════════════════
  // 'OPTICAL EPS' WAS FLAGGING OPERATING LEVERAGE.                (zzz691)
  //
  // The label means one thing: the per-share number is an ILLUSION — flattered
  // by a share count, a near-zero base, or something below the operating line.
  // The old tests did not look for any of that. They fired on SIZE alone:
  //
  //     epsY >= salesY * 3 && epsY >= 50      // EPS grew 3x faster than sales
  //     epsY >= 200                           // EPS grew a lot
  //
  // Which is the arithmetic of every genuine margin expansion. Morepen grew
  // revenue 34% and took operating margin from 6.0% to 14.0% — so operating
  // profit rose about 213%, and EPS rising 415% is what that looks like. The
  // engine called the most real thing on the card an optical illusion, and
  // then ceiling 2 below (`CFO/PAT < 1 AND optical eps`) capped the whole
  // quarter at MIXED on the strength of it. Same story for Bharat Dynamics
  // (margin −18% → +15%), PTCIL (9% → 25%), KMEW (41% → 64%).
  //
  // Measured over the 276-row session of 2026-08-14: 42 rows carried the tag,
  // and 20 of them carried it only because their margins expanded.
  //
  // So the tests now ask what the label claims to ask, in order:
  //
  //   (a) a base too small for a percentage to mean anything — always optical;
  //   (b) EPS outran PAT — then the share count or the capital structure did
  //       the work, not the business. This is the textbook meaning of the term
  //       and it was the one test missing entirely;
  //   (c) still losing money at the operating line — whatever produced that
  //       EPS, operations did not;
  //   (d) margin crossed from loss to profit — that IS the leverage, not an
  //       illusion, and Path F exists precisely to reward it;
  //   (e) both margins positive — measure EPS against what sales AND margin
  //       together explain, and flag only what goes well beyond it;
  //   (f) no usable margin figures — the old blunt test still stands, because
  //       without margins there is no way to tell leverage from optics.
  //
  // What this does NOT excuse: cash. 'ocf divergence' is a separate tag and
  // still fires, so a quarter whose profit is not converting is still marked —
  // by the flag that actually measures it.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const _opmNow = typeof row?.opm_pct === 'number' ? row.opm_pct : null;
    const _opmPrev = typeof row?.opm_prev_pct === 'number' ? row.opm_prev_pct : null;
    /** Growth in operating profit implied by sales growth and the margin move. */
    const _impliedOp = (salesY != null && _opmNow != null && _opmPrev != null && _opmNow > 0 && _opmPrev > 0)
      ? ((1 + salesY / 100) * (_opmNow / _opmPrev) - 1) * 100
      : null;
    const _optical = (): boolean => {
      // (a) the prior base was too small for the percentage to carry meaning
      if (row?.eps_prev != null && row?.eps_curr != null
          && Math.abs(row.eps_prev) < 0.5 && Math.abs(row.eps_curr) > 2) return true;
      // (b) EPS outran PAT — per-share arithmetic, not the business
      if (epsY != null && patY != null && patY > 0 && epsY >= patY * 1.5 && (epsY - patY) >= 25) return true;
      // (c) operations are still loss-making, so the EPS came from elsewhere
      //     zzz800: only when there IS an EPS growth figure — a refused (loss-
      //     base) or missing EPS % makes no claim for this label to doubt.
      if (epsY != null && _opmNow != null && _opmNow <= 0) return true;
      // (d) loss-making margin turned positive — the leverage is the story
      if (_opmNow != null && _opmPrev != null && _opmPrev <= 0 && _opmNow > 0) return false;
      // (e) both margins positive — beyond twice what sales x margin explains
      if (_impliedOp != null && epsY != null) return epsY >= _impliedOp * 2 && epsY >= 100;
      // (f) no margin figures to reason with — keep the old test
      if (epsY != null && salesY != null && salesY > 0 && epsY >= salesY * 3 && epsY >= 50) return true;
      if (epsY != null && epsY >= 200) return true;
      return false;
    };
    if (_optical()) caveat_tags.push('optical eps');
  }
  if (patY != null && row?.op_profit_yoy_pct != null && patY >= 100 && row.op_profit_yoy_pct < 30) caveat_tags.push('tax distortion');
  // PATCH 1001 — Still loss-making gate, amended by zzz800.
  //
  // Being loss-making is a risk. But a loss that is SHRINKING is the opposite
  // of low quality — it is the improvement the second axis exists to reward —
  // and stamping it 'low quality' (25 points, and a critical flag) is what
  // turned KABRAEXTRU's turnaround into a "mixed print". So:
  //   · still a loss, and the loss narrowed        → 'still loss-making' (10)
  //   · still a loss, widened / flat / no history  → 'low quality' (25)
  //   · a profit that swung to a loss              → 'low quality' (25)
  const stillLossPat = _patCurA != null && _patCurA <= 0;
  const stillLossEps = _epsCurA != null && _epsCurA <= 0;
  const stillLossMaking = stillLossPat || stillLossEps;
  const patTraj = profitTrajectory(_patCurA, _patPrevA, 'cr');
  const epsTraj = profitTrajectory(_epsCurA, _epsPrevA, 'eps');
  // PAT is the primary evidence; EPS stands in only when PAT is unavailable.
  const _profitTraj = patTraj ?? (_patCurA == null || _patPrevA == null ? epsTraj : null);
  const lossNarrowing = stillLossMaking && _profitTraj?.kind === 'loss narrowed';
  if (stillLossMaking) caveat_tags.push(lossNarrowing ? 'still loss-making' : 'low quality');
  // PATCH 1008 — Turnaround base: YoY% is mathematically meaningless when
  // prior was negative (now refused outright above, zzz800).
  const turnaroundBase = (_patPrevA != null && _patPrevA < 0)
                      || (_epsPrevA != null && _epsPrevA < 0);
  // ═══════════════════════════════════════════════════════════════════════
  // A NEGATIVE YEAR-AGO BASE IS NOT A QUALITY PROBLEM ONCE THE COMPANY IS
  // MAKING MONEY.  (zzz668 — porting the US rule)
  //
  // `turnaroundBase` exists because a growth rate measured off a loss is
  // meaningless, and that remains true. But India was ALSO stamping "low
  // quality" on the print, which is the opposite of what a completed
  // turnaround is. With Path F now reaching India, the contradiction became
  // visible on the card: MOLBIO printed revenue +320%, net profit −₹13cr →
  // +₹53cr, operating margin −10% → +25%, Quality 87 and Inflection 100 — and
  // was published BLOCKBUSTER carrying a "low quality" flag.
  //
  // The percentage is still refused. The company is simply no longer slandered
  // for having recovered, and the recovery is recorded as what it is.
  // ═══════════════════════════════════════════════════════════════════════
  const _patCurCr = _patCurA;
  const _cfoRatio = typeof row?.ocf_to_pat_ratio === 'number' ? row.ocf_to_pat_ratio : null;
  const turnaroundCompleted = turnaroundBase
    && _patCurCr != null && _patCurCr > 0
    && (_cfoRatio == null || _cfoRatio > 0);
  // zzz800 — a still-loss-making row was already judged just above (narrowing
  // or not); only a PROFITABLE-now recovery that the cash contradicts is left.
  if (turnaroundBase && !turnaroundCompleted && !stillLossMaking) caveat_tags.push('low quality');
  else if (turnaroundCompleted && !methodology_tags.includes('returned to profit')) {
    methodology_tags.push('returned to profit');
  }
  if (opmExp != null && opmExp < -1.5) caveat_tags.push('segment mix shift');
  // PATCH 1000 — Margin contraction caveat. Any drop below flat (≤ -0.5 pp)
  // for a stock the grader is otherwise about to call BLOCKBUSTER is a
  // yellow flag — true expansion stories show OPM widening, not narrowing.
  if (opmExp != null && opmExp <= -0.5 && !caveat_tags.includes('segment mix shift')) {
    caveat_tags.push('segment mix shift');
  }
  // zzz821 — ONE detection for engine and card (lib/india-eo-card-data
  // `financialKind`, fed Screener's industry chain when enrichment has it).
  const _isLender = _finKind != null;
  if (row?.ocf_to_pat_ratio != null && !_isLender) {
    if (row.ocf_to_pat_ratio < 0.6 && (row.pat_annual_cr ?? 0) > 0) caveat_tags.push('ocf divergence');
    if (row.ocf_annual_cr != null && row.ocf_annual_cr < 0 && (row.pat_annual_cr ?? 0) > 0 && !caveat_tags.includes('ocf divergence')) caveat_tags.push('ocf divergence');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // THE PROFIT DID NOT REACH THE BOTTOM LINE.                     (zzz694)
  //
  // `optical eps` above catches earnings that outran operations. This catches
  // the mirror image, which nothing tested: OPERATIONS THAT OUTRAN EARNINGS.
  //
  // Bliss GVS, Q1 FY27, is the case. Sales +38% and OPM 20% -> 27% imply
  // operating profit of Rs 41.4 -> 77.2 cr, up 87%. Reported PAT rose 16%. The
  // engine scored that +16% as ordinary magnitude and returned MIXED with an
  // EMPTY caveat list - quality 100, cash conversion 20/20, CFO/PAT 2.73 - so
  // the card gave its owner no reason to look at a business whose operating
  // profit had nearly doubled. The tell was sitting in the prior year: PAT of
  // Rs 44 cr EXCEEDED operating profit of Rs 41.4 cr, meaning the base was
  // lifted by something below the operating line, so the +16% is measured
  // against an inflated comparator.
  //
  // WHY IT COSTS NOTHING (penalty 0 in CAVEAT_PENALTY, and absent from both
  // `_criticals` lists, so it can neither demote a tier nor dock a point): the
  // flag is not a verdict. A leak below the operating line resolves either
  // way, and both readings are worth having. A high prior-year base or a tax
  // normalisation means next quarter re-rates against a clean comparator;
  // interest on rising debt means the growth is being bought. An informational
  // tag that quietly subtracted 8 points would repeat the composite-floor
  // mistake that demoted FPS on a technicality.
  //
  // TWO GUARDS, both added because the first version was measured across the
  // season before it shipped and got 206 hits, most of them worthless:
  //
  //  1. PAT MUST HAVE GROWN. The ratio test `opGrowth >= patY * 1.6` inverts
  //     when patY is negative - a more negative number is a LOWER bar, so
  //     Raymond (PAT -99%, implied OP +50%) and Bosch (PAT -37%) sailed
  //     through. For a company whose profit collapsed, "leaked below the
  //     operating line" is arithmetically true and analytically useless: that
  //     profit is not understated, it is damaged, and the tier already says
  //     so. The flag exists for the UNDERSTATED case, so PAT has to be up.
  //
  //  2. THE PRIOR MARGIN MUST BE BIG ENOUGH TO DIVIDE BY. opm_prev_pct
  //     arrives as a whole number. At a reported 20% the true value is
  //     19.5-20.4 and implied operating profit is accurate to about 2.5%; at
  //     a reported 2% it is 1.5-2.4 and the error is 25%, which is why GNFC
  //     showed implied operating growth of +1,224% against PAT +276%. That
  //     figure is rounding, not performance. A 5% floor keeps the implied
  //     growth error inside roughly 10%.
  //
  // After both guards the flag fires on names whose operating profit really
  // did outrun a genuinely positive earnings number - which is the only
  // population it was built to describe.
  const _sPrev = typeof row?.sales_prev_cr === 'number' ? row.sales_prev_cr : null;
  const _sCur = typeof row?.sales_curr_cr === 'number' ? row.sales_curr_cr : null;
  const _opmNow = typeof row?.opm_pct === 'number' ? row.opm_pct : null;
  const _opmPre = typeof row?.opm_prev_pct === 'number' ? row.opm_prev_pct : null;
  if (_sPrev != null && _sCur != null && _opmNow != null && _opmPre != null
      && patY != null && patY > 0 && _sPrev > 0 && _opmPre >= 5) {
    const _opPrev = _sPrev * (_opmPre / 100);
    const _opCur = _sCur * (_opmNow / 100);
    if (_opPrev > 0 && _opCur > _opPrev) {
      const _opGrowth = (_opCur / _opPrev - 1) * 100;
      if (_opGrowth - patY >= 35 && _opGrowth >= patY * 1.6) {
        caveat_tags.push('profit leaked below the operating line');
      }
    }
  }
  // zzz668 — A PENALTY WITH NO EMITTER IS NOT A RULE.
  //
  // `exceptional item` has carried a 10-point penalty in the shared table since
  // it was written, is listed to you in the app's methodology panel as though
  // it were live, and NOTHING in the India grader has ever pushed it. Seven
  // tags were in that state; this is the one the data supports, because
  // enrichment already scrapes the exceptional line and its share of pre-tax
  // profit — and, until today, the row builder threw both away.
  //
  // A fifth of pre-tax profit arriving from something that will not repeat is
  // the difference between a quarter and an event.
  {
    const _excPct = typeof row?.exceptional_pct_pbt === 'number' ? Math.abs(row.exceptional_pct_pbt) : null;
    if (_excPct != null && _excPct >= 20) caveat_tags.push('exceptional item');
  }
  // ═══════════════════════════════════════════════════════════════════════
  // PRICE IS CONTEXT, NOT A CAVEAT.                                (zzz819)
  //
  // A Stage-4 chart or a price more than 25% off the 52-week high used to
  // push 'low quality' — the same tag, and the same 25 quality points, as a
  // company still losing money. That is the tape grading the filing. The US
  // engine stopped doing it in zzz804; India now matches. The facts are still
  // stated, in `market_context`, beside the grade and never inside it.
  // ═══════════════════════════════════════════════════════════════════════
  const market_context: string[] = [];
  if (stage === 4) market_context.push('stage 4 downtrend');
  else if (pct52 != null && pct52 < -25) market_context.push(`${Math.round(Math.abs(pct52))}% below its 52-week high`);

  // zzz819 — CARRIED FILING FLAGS (regrade of a card stored before zzz819
  // only). A stored card does not hold the annual cash figures, the
  // exceptional-item share or operating-profit growth, so those flags cannot
  // be re-derived from it. They were derived from the FILING when the card
  // was first graded, so they are carried forward as they were — never
  // invented, never dropped.
  const _carried: string[] = Array.isArray(row?._carried_caveats) ? row._carried_caveats.map(String) : [];
  for (const t of ['ocf divergence', 'exceptional item', 'tax distortion']) {
    // zzz821 — cash flags never apply to a bank / NBFC / insurer.
    if (t === 'ocf divergence' && _finKind) continue;
    if (_carried.includes(t) && !caveat_tags.includes(t)) caveat_tags.push(t);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DEDUPE BEFORE ANYTHING COUNTS THEM.  (zzz665c)
  //
  // THREE separate conditions push the identical string 'low quality': still
  // loss-making, growth measured off a negative base, and a broken chart
  // (Stage 4, or more than 25% off the 52-week high). A company in all three
  // states carried the tag three times, and the array was only de-duplicated
  // at the very end, on its way to the card. Everything in between counted
  // the duplicates:
  //
  //   · `quality` subtracts a penalty PER ENTRY, so 'low quality' cost 75
  //     points instead of 25 — on a score that starts at 100, that alone is
  //     three quarters of the axis for one flag.
  //   · `caveatCount` feeds every `<= 1` / `<= 2` / `<= 3` gate in the tier
  //     ladder. One tag consumed the entire caveat budget, so a Blockbuster
  //     path that allows three caveats was closed by a single fact.
  //
  // The card showed the tag once, which is why this was invisible: the screen
  // and the arithmetic disagreed and only the screen was ever read.
  //
  // De-duplicating here, before quality and before the ladder, makes one fact
  // cost one penalty. The three conditions remain three conditions — a company
  // that is loss-making AND in a downtrend is still worse than one that is
  // only loss-making, because each pushes other tags and moves other inputs.
  // It is the double-charging for the SAME label that was never intended.
  // ═══════════════════════════════════════════════════════════════════════
  caveat_tags = [...new Set(caveat_tags)];

  const scoreYoy = (y: number) =>
    y >= 100 ? 100 : y >= 50 ? 90 : y >= 25 ? 75 : y >= 15 ? 60 : y >= 5 ? 40 : y >= 0 ? 25 : Math.max(0, 25 + y);
  let magW = 0, magS = 0;
  if (salesY != null) { magS += scoreYoy(salesY) * 0.35; magW += 0.35; }
  if (patY   != null) { magS += scoreYoy(patY)   * 0.30; magW += 0.30; }
  if (epsY   != null) { magS += scoreYoy(epsY)   * 0.35; magW += 0.35; }
  const magnitude = magW > 0 ? magS / magW : 30;

  // zzz390 — caveat-penalty table + margin ladder now live in the shared module
  // @/lib/earnings-grade-shared, imported by both this route and the client
  // gradeRow so the two copies can't drift (they repeatedly did: zzz384/386/387).
  let quality = 100;
  for (const tag of caveat_tags) quality -= caveatPenaltyFor(tag);   // zzz698
  quality += marginQualityDelta(opmExp);   // PATCH 1000 + zzz387 ordering
  quality = Math.max(0, Math.min(100, quality));

  const stageBase = stage === 2 ? 70 : stage === 1 ? 45 : stage === 3 ? 30 : stage === 4 ? 10 : 50;
  let technical = stageBase + (rs != null ? rs / 3 : 0);
  if (pct52 != null) technical += pct52 >= -5 ? 15 : pct52 >= -15 ? 8 : pct52 >= -25 ? 0 : -15;
  if (ttPass) technical += 10;
  technical = Math.max(0, Math.min(100, technical));

  const mCount = methodology_tags.length;
  const _t1MethodCount =
    (methodology_tags.includes('trend template') ? 1 : 0) +
    (methodology_tags.includes('sepa') ? 1 : 0) +
    (methodology_tags.includes('canslim') ? 1 : 0);
  let methodology = mCount === 4 ? 100 : mCount === 3 ? 80 : mCount === 2 ? 60 : mCount === 1 ? 35 : 10;
  if (_t1MethodCount >= 1) methodology = Math.max(methodology, 55);
  if (methodology_tags.includes('sepa')) methodology = Math.min(100, methodology + 5);
  // PATCH 0172/0173 — magnitude-aware methodology floors
  const _megaMagFloor = salesY != null && salesY >= 40 && patY != null && patY >= 75 && epsY != null && epsY >= 75;
  if (_megaMagFloor) methodology = Math.max(methodology, 75);
  const _exceptMagFloor = salesY != null && salesY >= 40 && patY != null && patY >= 50 && epsY != null && epsY >= 50;
  if (_exceptMagFloor) methodology = Math.max(methodology, 65);

  const composite = Math.max(0, Math.min(100, magnitude * 0.35 + quality * 0.25 + technical * 0.25 + methodology * 0.15));

  // zzz673 — the same quarter scored with the chart taken out, and the chart
  // graded separately as an ENTRY. Both are COMPUTED AND RETURNED ONLY; nothing
  // below reads them, and `decideTier` still receives `composite`. See the long
  // note on `fundamentalComposite` in earnings-grade-shared for why the switch
  // is deliberately a second, separate change.
  //
  // zzz819 — …and now the switch is made. THE TIER IS DECIDED WITHOUT THE
  // CHART, as the US engine has been since zzz804. `composite` still blends
  // 25% technical and counts trend template / SEPA / CANSLIM (all three read
  // off stage, RS and the 52-week high), so it moved with the price. The tier
  // reads `tierComposite`: magnitude, quality and FUNDAMENTAL methodology only,
  // renormalised to 0-100 so every threshold in `decideTier` keeps its
  // meaning. The blended number is still returned for ordering within a tier.
  const PRICE_METHODS = new Set(['trend template', 'sepa', 'canslim']);
  const fundMCount = methodology_tags.filter((t) => !PRICE_METHODS.has(t)).length;
  let methodologyFund = fundMCount >= 4 ? 100 : fundMCount === 3 ? 80 : fundMCount === 2 ? 60 : fundMCount === 1 ? 35 : 10;
  if (_megaMagFloor) methodologyFund = Math.max(methodologyFund, 75);
  if (_exceptMagFloor) methodologyFund = Math.max(methodologyFund, 65);
  const tierComposite = fundamentalComposite(magnitude, quality, methodologyFund);
  const _fund_composite = tierComposite;
  // "Has technical evidence" is stage OR relative strength actually arriving
  // from the scraper. Both null means a newly listed or uncovered symbol, whose
  // setup is UNKNOWN — never 'D'.
  const _setup_grade = setupGrade(technical, stage != null || rs != null);

  // Tier rules — PATCH 0173 BLOCKBUSTER v3 (EarningsPulse-matched).
  // Ignore RS, Stage 2, bonde ep as hard gates. Use Magnitude + Quality +
  // Tier-1 method count + Guidance + chart-not-broken.
  let tier: EarningsTier;
  // ═══════════════════════════════════════════════════════════════════════
  // WHAT "BROKEN" IS ALLOWED TO MEAN.  (zzz668 — matching the US engine)
  //
  // This flag routes a row straight to AVOID, the worst grade the engine
  // gives, and it used to fire on two unrelated things: a chart in a stage-4
  // downtrend, and earnings that actually fell. Those are not the same
  // evidence and must not carry the same power.
  //
  // The US removed the chart half after Synopsys — revenue +42%, a 6% beat, a
  // raised guide and a 13.7% rise on the day — was published AVOID purely
  // because its chart sat 35% off its high. The note left behind reads: "That
  // is the tape overruling the filing, which the owner has already ruled
  // against once." India never got the same fix, and until today India had no
  // stage at all, so the rule has been dormant rather than correct. Now that
  // stage is real, it would have started firing.
  //
  // zzz819 — and since zzz819 the chart costs the row nothing at all: a
  // stage-4 downtrend is stated in `market_context`, beside the grade.
  // ═══════════════════════════════════════════════════════════════════════
  const broken = (epsY != null && epsY < 0 && patY != null && patY < -10);
  const cleanMag = salesY != null && salesY >= 25 && patY != null && patY >= 25 && epsY != null && epsY >= 25;
  const exceptMag = salesY != null && salesY >= 40 && patY != null && patY >= 50 && epsY != null && epsY >= 50;
  const megaMag = salesY != null && salesY >= 40 && patY != null && patY >= 75 && epsY != null && epsY >= 75;
  // PATCH 0837 + 0838 — Margin Inflection / Operating Leverage path.
  // Tier A (extreme): PAT >= 100 + EPS >= 100 + sales not collapsing.
  //   Catches GLOSTERLTD (PAT+454/EPS+454), SHIVAUM (PAT+8120/EPS+7450).
  // Tier B (strong, P0838): PAT >= 75 + EPS >= 75 + sales >= 0 + stage != 4.
  //   Catches near-mega stories like Investment & Precision Castings
  //   (PAT+98/EPS+98/sales+20/comp 68) that failed the Tier A 100% gate.
  const marginInflection = patY != null && patY >= 100 && epsY != null && epsY >= 100 && salesY != null && salesY >= -5;
  // zzz819 — `stage !== 4` removed: the chart does not grade the quarter.
  const marginInflectionLoose = patY != null && patY >= 75 && epsY != null && epsY >= 75 && salesY != null && salesY >= 0;

  // Guidance signal — scan available text
  const guidanceText = [
    (row as any)?.guidance_text, (row as any)?.narrative_text, (row as any)?.announcement_text,
    (row as any)?.attachment, (row as any)?.headline, (row as any)?.title,
  ].filter(Boolean).join(' ').toLowerCase();
  const _guidancePatterns = [
    /capacity expansion/, /order book/, /record (?:quarter|order|revenue|book)/,
    /margin expansion/, /operating leverage/, /commission(?:ed|ing)?/,
    /capex/, /demand recovery/, /broad[- ]based/, /tailwind/, /confident/,
    /guidance rais/, /upgrade(?:d)? guidance/, /outlook strong/,
    /(?:vadod|new plant|new line|brownfield|greenfield)/,
  ];
  const _guidanceMatches = _guidancePatterns.filter((p) => p.test(guidanceText)).length;
  // ═══════════════════════════════════════════════════════════════════════
  // AN EXPLICIT SIGNAL BEATS A REGEX OVER PROSE.  (zzz669)
  //
  // The pattern list below it is the original, and it is the reason guidance
  // was dead: it reads six fields that nothing populated, so it always scored
  // zero. It also counts "confident" and "tailwind" — tone, not a commitment —
  // which is the wrong thing to measure even when there IS text.
  //
  // /api/v1/cron/refresh-guidance now writes a per-symbol overlay from the
  // concall-intelligence pipeline that was already running in this codebase
  // and had simply never been connected to the grader. When it has an opinion
  // about this company, that opinion is used. The text scan stays as the
  // fallback for a symbol the overlay has not seen — it costs nothing and, now
  // that `guidance_text` is actually populated, it can finally fire.
  //
  // A CUT IS NOT A NON-RAISE. If the overlay says the company guided DOWN,
  // `positiveGuidance` is false regardless of how many hopeful words the same
  // filing contains, which the pattern list on its own could never express.
  // ═══════════════════════════════════════════════════════════════════════
  const _gRaised = (row as any)?.guidance_raised;
  const _gCut = (row as any)?.guidance_lowered;
  const positiveGuidance = _gCut === true ? false
    : _gRaised === true ? true
    : _guidanceMatches >= 2;
  // zzz826 — WHAT WE KNOW ABOUT GUIDANCE, SAID PLAINLY. "Not raised" needs
  // evidence: an explicit overlay answer, or filing text that was read and
  // holds no raise. With neither (a card-figure regrade, a company the
  // overlay has not seen and no text) guidance is UNKNOWN — it can hold back
  // the one top-tier path that needs a confirmation, but it is never a
  // reason for a lower grade and is never written as "not raised".
  const guidance_status: 'raised' | 'cut' | 'positive outlook' | 'not raised' | 'unknown' =
    _gCut === true ? 'cut'
    : _gRaised === true ? 'raised'
    : _guidanceMatches >= 2 ? 'positive outlook'
    : (_gRaised === false || _gCut === false || guidanceText.trim().length > 0) ? 'not raised'
    : 'unknown';

  // zzz800 — the loss-narrowing operating turnaround (see decideTier). Every
  // input is a reported figure: the prior loss at least halved, revenue up
  // >= 25%, operating margin up >= 5pp and positive now, and the annual cash
  // flow — when it exists — not negative. A still-loss company that meets all
  // of that had a strong quarter; one that does not stays where it was.
  const _ocfAnnualForTurn = _numA(row?.ocf_annual_cr);
  const lossTurnaround = lossNarrowing
    && _profitTraj != null && _profitTraj.lossReductionPct != null && _profitTraj.lossReductionPct >= 50
    && salesY != null && salesY >= 25
    && opmExp != null && opmExp >= 5
    && _opmNow != null && _opmNow > 0
    && (_ocfAnnualForTurn == null || _ocfAnnualForTurn > 0);
  // zzz395 — tier-decision chain (BLOCKBUSTER gate Paths A–E + graduated margin
  // gate + loss-maker/turnaround/quality-STRONG rules) now lives in the shared
  // module so this server copy and the client gradeRow can never re-drift.
  // zzz819 — no price input reaches the decision: the composite is the
  // price-free one, the chart is always "ok", the stage is unknown to it, the
  // method count is the fundamental one, and the Tier-1 methods (which are
  // chart methods) count for nothing. India has no street consensus, so the
  // only Path-A confirmation left is guidance — as it should be.
  const _decideIn = {
    composite: tierComposite,
    broken,
    stillLossMaking,
    turnaroundBase,
    marginContracting: opmExp != null && opmExp <= -0.5,        // PATCH 1000
    marginSevereContraction: opmExp != null && opmExp <= -1.5,  // PATCH 1020
    caveatCount: countingCaveats(caveat_tags),   // zzz694 — informational tags must not gate a tier
    mCount: fundMCount,
    stage: null,
    salesY, patY, epsY, opmExp,
    cleanMag, exceptMag, megaMag,
    marginInflection, marginInflectionLoose,
    // zzz668 — PATH F ON THE INDIA SIDE TOO.
    //
    // Path F shipped for the US this morning: a company that recovered from a
    // loss could never clear any magnitude gate, because `yoyPct` correctly
    // refuses a percentage off a negative base and every gate requires both
    // patY and epsY. India's grader has exactly the same shape and exactly the
    // same hole — MIXED for ever, however complete the recovery.
    //
    // The evidence that survives a negative base is the same in both markets:
    // the company earns money now, the cash agrees, the top line grew and the
    // margin expanded. India's cash figure is ANNUAL rather than quarterly, so
    // it is treated as a veto when negative and ignored when absent, never as
    // a reason to promote on its own.
    //
    // The safety valve is the shared one: an UNFINISHED recovery still sets
    // `turnaroundBase` and is still capped at MIXED a line above.
    swingMag: (() => {
      const patC = typeof row?.pat_curr_cr === 'number' ? row.pat_curr_cr : null;
      const patP = typeof row?.pat_prev_cr === 'number' ? row.pat_prev_cr : null;
      const ocfA = typeof row?.ocf_annual_cr === 'number' ? row.ocf_annual_cr : null;
      return patP != null && patP < 0 && patC != null && patC > 0
        && (ocfA == null || ocfA > 0)
        && salesY != null && salesY >= 25
        && opmExp != null && opmExp >= 5;
    })(),
    lossTurnaround,
    tier1MethodCount: 0,
    positiveGuidance,
    chartOk: true,
  };
  tier = decideTier(_decideIn).tier;
  // zzz826 — unknown guidance BLOCKS, never DEMOTES. If the only thing
  // between this quarter and a higher tier is a guidance confirmation we do
  // not have, a fresh grade stays at the lower tier (the confirmation is
  // missing — that is a block, stated in `guidance_note`). A REGRADE of a
  // stored card whose original grade HAD the guidance evidence (and reached
  // the higher tier with it) keeps that tier: losing a figure in storage is
  // not new information about the company.
  let guidance_note: string | null = null;
  if (guidance_status === 'unknown') {
    const _withG = decideTier({ ..._decideIn, positiveGuidance: true }).tier;
    if (_withG !== tier) {
      const _prior = typeof rowIn?._guidance_prior_tier === 'string' ? rowIn._guidance_prior_tier : null;
      if (_prior === _withG) {
        tier = _withG;
        guidance_note = 'not on file for this regrade; the original grade had it, so its tier is kept';
      } else {
        guidance_note = `so it could not confirm ${_withG}; it does not lower the grade`;
      }
    }
  }
  if (lossTurnaround && tier === 'STRONG' && !methodology_tags.includes('operating turnaround')) {
    // Pushed AFTER composite, so it describes the verdict without scoring it.
    methodology_tags.push('operating turnaround');
  }
  // ═══════════════════════════════════════════════════════════════════════
  // THE TAPE IS CONTEXT.                                            (zzz819)
  //
  // PATCH 0938 let a Day-1 sell-off demote the tier; zzz800 floored that at
  // STRONG, so the price could still "cost the top tier". The owner's rule is
  // that price does not grade a filing at all, and the US engine has worked
  // that way since zzz804. The reaction ladder still runs — scaled by the
  // stock's own typical daily move (zzz665c) — but only to NAME what the
  // market did, in `market_reaction` and `market_context`. It never touches
  // the tier and never enters the caveat list.
  // ═══════════════════════════════════════════════════════════════════════
  const _reactionTags: string[] = [];
  {
    const _mr = marketReactionDelta(
      tier, row?.d1_pct, row?.gap_pct,
      typicalDailyMovePct((row as any)?.close_30d ?? null),
    );
    for (const c of _mr.addCaveats) if (!_reactionTags.includes(c)) _reactionTags.push(c);
  }

  // PATCH 1034 — liquidity. zzz819: a thin float is a fact about TRADING the
  // stock, not about the quarter, so it is market context (as on the US side
  // since zzz804) and no longer demotes the tier. Missing ADTV says nothing.
  // zzz826 — only a REAL multi-day average counts (realAdtv: `adtv_cr` with
  // the days it covers). A stored one-day turnover, or nothing, is unknown,
  // and unknown liquidity never says "thin float" or "barely trades".
  const _adtv = realAdtv(row).cr;
  const _thinFloat = _adtv != null && _adtv < 1;  // < ₹1 Cr/day median traded value = thin float
  if (_thinFloat) market_context.push('thin float');

  // ═══════════════════════════════════════════════════════════════════════
  // HARD CEILINGS — INDIA HAD NONE.  (zzz666)
  //
  // The US engine can REFUSE a quarter on fourteen separate grounds. India
  // could only ever subtract points, and a high composite absorbs a penalty:
  // an Indian company with negative operating cash flow against a reported
  // profit could still publish BLOCKBUSTER, because −25 off a quality score
  // that starts at 100 is survivable when magnitude and technical are strong.
  //
  // A ceiling is different from a penalty. It says "whatever else is true,
  // this is not a top-tier quarter" — and that is the engine's own stated
  // philosophy about cash, applied on the side of the world where it was
  // never implemented.
  //
  // ONLY THREE, AND ONLY WHERE INDIA'S DATA MEANS WHAT THE TEST NEEDS.
  // The US ceilings for guidance, one-off items and adjusted-EPS reconciliation
  // are deliberately NOT ported: India ingests no guidance and no adjusted
  // figures, so those tests would be reading fields that do not exist — which
  // is exactly the failure mode (`positiveGuidance`, `row.promoter`) this
  // codebase already has too much of.
  //
  // NOTE ON BASIS: India's cash-flow figures are ANNUAL, not quarterly —
  // Screener publishes no quarterly capex or CFO. An annual cash test against
  // a quarterly grade is a coarser instrument than the US equivalent, so the
  // thresholds below are the unambiguous ones only. Negative cash against a
  // positive profit is wrong at any frequency.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const TIER_ORDER = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
    const capTier = (max: string, why: string) => {
      if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(max)) {
        tier = max as typeof tier;
        if (!caveat_tags.includes(why)) caveat_tags.push(why);
      }
    };

    // ── A LENDER'S NEGATIVE OPERATING CASH FLOW IS ITS BUSINESS. (zzz710)
    //
    // For a bank or an NBFC, growing the loan book IS an operating outflow:
    // disbursements sit in operating activities, so a lender that is growing
    // reports negative OCF by construction. Judging one on cash conversion is
    // like judging a manufacturer on deposit growth.
    //
    // Measured on the season: 76 of the 499 India rows carrying a cash caveat
    // are lenders by name — Indostar at -89.9x, Poonawalla at -70.7x,
    // Manappuram at -34.6x, all of them structural rather than alarming. The
    // US engine has always exempted them (`!e.is_financial` in the conviction
    // scorer); India could not, because NO SECTOR DATA REACHES THIS GRADER —
    // the `sector` field is empty or "Other" on all 2,604 rows.
    //
    // So the test is the company NAME, which is the only signal available.
    // That is a weaker instrument than a sector field and it is used in the
    // one direction where being wrong is cheap: it SUPPRESSES a penalty. A
    // missed lender keeps today's behaviour; a misfire spares one industrial
    // a cash caveat it may have deserved. The reverse — inventing a penalty
    // from a name — is never done here.
    //
    // `\bfin\b` and friends are word-bounded deliberately: "Infinite
    // Computer Solutions" and "Fincorp" must not both match on a substring.
    const _looksLikeLender = _isLender;   // zzz821 — the shared detection

    const _ocfAnnual = typeof row?.ocf_annual_cr === 'number' ? row.ocf_annual_cr : null;
    const _patAnnual = typeof row?.pat_annual_cr === 'number' ? row.pat_annual_cr : null;
    const _cfoPat = typeof row?.ocf_to_pat_ratio === 'number' ? row.ocf_to_pat_ratio : null;

    // 1. CASH WENT THE OTHER WAY. The company reports a profit for the year and
    //    its operations consumed cash. The US caps this at MIXED and calls it
    //    "profit without operating cash"; there is no reading of it that
    //    belongs in a top tier.
    // MEASURED, AND THE HAMMER WAS DOING TWO OPPOSITE JOBS.         (zzz695)
    //
    // This was an unconditional cap to MIXED, and on 2,604 graded India
    // results across the season it split cleanly in two by composite - in
    // BOTH months independently, which is why the change is here and not
    // filed as a hunch:
    //
    //                              Jul 2026            Aug 2026
    //   negative OCF, comp >= 78   +11.0% (n=6)        +8.8%  (n=36)
    //   negative OCF, comp  < 78    -2.1% (n=82)       -5.3%  (n=235)
    //   BLOCKBUSTER, actual         +9.1%              +8.1%
    //   STRONG, actual              +1.3%              +0.8%
    //   MIXED, actual               -1.1%              -3.2%
    //
    // Below 78 the cap is right and then some: those names underperform the
    // MIXED bucket they are dropped into. At or above 78 it was taking names
    // that behave like BLOCKBUSTER and burying them in a bucket whose whole
    // population is negative - KRN at composite 94, PTC Industries at 88 with
    // a perfect 100/100 inflection, Marine Electricals at 87, all three
    // reading "mixed print" while running +12%, +18% and +1%.
    //
    // WHY STRONG AND NOT BLOCKBUSTER, even though the returns match
    // BLOCKBUSTER. The study horizon is four to eight weeks of post-print
    // drift, and that CANNOT test the risk this rule exists for: a company
    // funding hypergrowth from outside the business fails when the funding
    // tightens, not in the month after the result. The win rate is also lower
    // than BLOCKBUSTER's (58% vs 68%) - same returns, more variance. So the
    // cash burn still costs the top tier, and STRONG is where the evidence
    // actually reaches.
    //
    // Honest confound: composite carries 25% technical, so `>= 78` partly
    // selects for names already moving, and some of that +8.8% is momentum
    // rather than the quarter. The gate is left on composite anyway, because
    // composite is what was measured - swapping in fund_composite here would
    // be implementing something the study never tested, which is the mistake
    // the FPS demotion was made of.
    //
    // zzz819 — …but the owner's rule outranks the study: no price in the
    // grade. The split now reads the PRICE-FREE composite (`tierComposite`),
    // so a name the market happens to like no longer escapes the MIXED cap on
    // momentum. The 78 line keeps its meaning because the price-free composite
    // is renormalised to the same 0-100 scale.
    const _cashCapTrigger = (_ocfAnnual != null && _ocfAnnual < 0 && _patAnnual != null && _patAnnual > 0)
      || _carried.includes('profit without operating cash');
    if (_cashCapTrigger) {
      if (_looksLikeLender) {
        // Named, not silently skipped: the reader should see WHY the usual
        // cash ceiling did not apply, and should be able to disagree.
        if (!caveat_tags.includes('lender — operating cash flow is loan growth')) {
          caveat_tags.push('lender — operating cash flow is loan growth');
        }
      } else {
        capTier(tierComposite >= 78 ? 'STRONG' : 'MIXED', 'profit without operating cash');
      }
    }

    // 2. EARNINGS OUTRAN BOTH THE REVENUE AND THE CASH. This is the rule that
    //    caught Optical Cable on the US side: EPS growing a multiple of the top
    //    line ('optical eps') while conversion is under 1. Either alone is
    //    survivable — real operating leverage converts cash, and a
    //    working-capital quarter still grows revenue. Both together is a
    //    quarter to look at twice, which is what MIXED means.
    if (_cfoPat != null && _cfoPat < 1 && caveat_tags.includes('optical eps')) {
      capTier('MIXED', 'earnings outrun both revenue and cash');
    }

    // 3. TWO OR MORE CRITICAL FLAGS. Any one of these is a caveat the tier
    //    ladder already prices. Two at once is a pattern, and the US caps it at
    //    STRONG rather than letting a strong composite carry it to the top.
    const _criticals = ['low quality', 'ocf divergence', 'optical eps', 'tax distortion']
      .filter((t) => caveat_tags.includes(t)).length;
    if (_criticals >= 2) capTier('STRONG', 'multiple quality flags');

    // 4. THE HEADLINE LEANS ON SOMETHING THAT WILL NOT REPEAT.  (zzz668)
    //    The US caps a quarter whose beat disappears without its one-off. India
    //    has no consensus to test a beat against, but it does have the size of
    //    the exceptional item relative to pre-tax profit — and half of PBT
    //    arriving from a one-off is not a quarter the business produced.
    const _excShare = typeof row?.exceptional_pct_pbt === 'number' ? Math.abs(row.exceptional_pct_pbt) : null;
    if (_excShare != null && _excShare >= 50) capTier('MIXED', 'headline leans on a one-off');
    else if (_excShare != null && _excShare >= 25) capTier('STRONG', 'headline leans on a one-off');
    else if (_excShare == null && _carried.includes('headline leans on a one-off')) {
      // zzz819 — carried from a stored card (see `_carried`): the level the
      // original filing set, recovered conservatively by the caller.
      capTier(row?._carried_oneoff_cap === 'STRONG' ? 'STRONG' : 'MIXED', 'headline leans on a one-off');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. YOU CANNOT BUY IT.  (zzz674)
    //
    // This ceiling exists because of something the chart was doing by accident.
    //
    // Measuring the fundamentals-only composite against the live one across
    // 2026-08-14 (276 rows) turned up eleven names whose FILINGS clear the
    // BLOCKBUSTER threshold while the blended composite does not — the chart
    // holding a good quarter down, which is the defect zzz673 exists to fix.
    // Eight of those eleven were shells:
    //
    //   ICSA ₹0.96 Cr · BHARATIDIL ₹9.8 Cr · GLOBALE ₹11.1 Cr · RADAAN ₹15.2 Cr
    //   SUVIDHAA ₹47.6 Cr · EROSMEDIA ₹74.9 Cr — every one at ~zero daily value.
    //
    // A company that small has no stage and no relative strength, so it scores
    // near the floor on the technical axis, and THAT is what has been keeping
    // it out of the top tier. The chart term was moonlighting as a junk filter.
    // Take the chart out of the tier — which is the whole point of the V2 split
    // — and the junk walks straight in, promoted by the very change meant to
    // surface Bharat Dynamics.
    //
    // So the filter becomes explicit, and states its own reason: below this
    // size you cannot take a position worth taking, and the reported numbers
    // are the least scrutinised in the market. That is a statement about
    // TRADEABILITY, not about the quarter — which is why it caps the tier and
    // leaves every score and caveat untouched.
    //
    // MARKET CAP IS THE PRIMARY TEST, NOT LIQUIDITY. `adtv_cr` is missing or
    // zero for 17 of 276 rows, and three of those are large: Bharat Dynamics
    // (₹41,587 Cr), Indo Tech (₹4,150 Cr), MBECL (₹1,157 Cr). Gating on volume
    // alone would have thrown away the exact name this work set out to rescue.
    // So ADTV only ever speaks about a company ALREADY known to be small, and
    // a null ADTV never counts against anyone.
    //
    // Calibrated to demote NOTHING currently above MIXED (verified: 0 of 276 on
    // 2026-08-14) while blocking six of the eight shells. Puravankara ₹4,873 Cr,
    // Pakka ₹357 Cr and Aartech ₹162 Cr all pass — genuine microcaps are the
    // hunting ground, and this is not a smallcap filter.
    // ═══════════════════════════════════════════════════════════════════════
    if (_looksLikeLender && _carried.includes('lender — operating cash flow is loan growth')
        && !caveat_tags.includes('lender — operating cash flow is loan growth')) {
      caveat_tags.push('lender — operating cash flow is loan growth');
    }
    // zzz826 — MOVED OUT OF THE TIER. Market cap and traded value are both
    // share-price figures, and the India tier is price-free. The shell filter
    // survives as two plain flags beside the grade (`size_flags`, below); the
    // page's Mkt Cap filter is what hides small companies.
  }
  const size_flags: string[] = [];
  {
    const _mcap = typeof row?.market_cap_cr === 'number' && Number.isFinite(row.market_cap_cr) && row.market_cap_cr > 0 ? row.market_cap_cr : null;
    if (_mcap != null && _mcap < IN_VERY_SMALL_MCAP_CR) size_flags.push('very small company');
    else if (_mcap != null && _mcap < IN_BARELY_TRADES_MCAP_CR && _adtv != null && _adtv < IN_BARELY_TRADES_ADTV_CR) size_flags.push('barely trades');
  }

  // ── zzz819 / zzz821 — THE BLOCKBUSTER GATE, THE STRONG FLOOR, THE HOLD ──
  const _forensic = indiaForensicCheck({
    salesY, epsY: epsYRaw, patY: patYRaw, opmPct: _opmNow, opmPrevPct: _opmPre,
    cfoToPat: _cashView.ratio, isFinancial: _isLender,
  });
  const _marketDriven = marketDrivenKind(rowIn);
  const _gateInput: IndiaStrongFloorInput = {
    salesY, patY, epsY, opmPct: _opmNow, opmPrevPct: _opmPre,
    salesCurCr: _sCur, salesPrevCr: _sPrev,
    patCurCr: _patCurA, patPrevCr: _patPrevA, epsPrev: _epsPrevA,
    cfoToPat: _cashView.ratio,
    ocfAnnualCr: _cashView.ocf, patAnnualCr: _cashView.pat,
    isLender: _isLender,
    caveatTags: caveat_tags,
    forensic: _forensic,
    marketDriven: _marketDriven,
  };
  let _bbGate: IndiaBlockbusterGateResult | null = null;
  const _capMisses: string[] = [];
  let _problemKinds: IndiaProblemKind[] = [];
  const _tierBeforeChecks: EarningsTier = tier;
  if (tier === 'BLOCKBUSTER') {
    _bbGate = indiaBlockbusterGate(_gateInput);
    _problemKinds = _bbGate.problems;
    if (_bbGate.tier !== 'BLOCKBUSTER') {
      tier = _bbGate.tier;
      _capMisses.push(..._bbGate.misses);
    }
  }
  if (tier === 'STRONG') {
    const fl = indiaStrongFloor(_gateInput);
    if (!_problemKinds.length) _problemKinds = fl.problems;
    if (fl.tier === 'MIXED') {
      tier = 'MIXED';
      for (const m of fl.misses) if (!_capMisses.includes(m)) _capMisses.push(m);
    }
  }
  // One line, stated once (zzz821 — never repeated in the caveats or summary).
  const tier_cap_reason: string | null = (_capMisses.length && tier !== _tierBeforeChecks)
    ? `Capped at ${tier}: ${_capMisses.join('; ')}` : null;
  // PAT and EPS in opposite directions: the figures are in doubt, so a top
  // tier is HELD — the display's UNCONFIRMED treatment (`_tier_unconfirmed`)
  // — until they are re-checked. The stored tier is kept beside it.
  let _tierUnconfirmed: string | null = null;
  if (figures_conflict && (tier === 'BLOCKBUSTER' || tier === 'STRONG')) {
    _tierUnconfirmed = tier;
    tier = 'MIXED';
  }

  // Narrative
  const co = row.company || row.symbol;
  const q = row.quarter || deriveQuarterLabel(row.filing_date);
  // zzz383 — clamp base-effect blow-ups: a near-zero/negative prior base makes YoY %
  // explode (e.g. +5000% on a ₹0.5 Cr → ₹50 Cr PAT). Exact precision is meaningless
  // and reads as fabricated, so show '>500% (low base)' above the threshold.
  const fmtP = (lbl: string, v: number | null) => v == null ? '' : (v >= 500 ? `${lbl} >500% YoY (low base)` : `${lbl} ${v >= 0 ? '+' : ''}${Math.round(v)}% YoY`);
  const isTurnaroundVerdict = lossTurnaround && tier === 'STRONG';
  const head = tier === 'BLOCKBUSTER' ? `${co} prints a blockbuster ${q}` :
               isTurnaroundVerdict ? `${co} ${q} is a strong operating turnaround` :
               tier === 'STRONG' ? `${co} delivers strong ${q}` :
               tier === 'MIXED' ? `${co} ${q} is a mixed print` : `${co} ${q} fails the bar`;
  // zzz800 — whenever either quarter is a loss, the profit line is a DIRECTION
  // with both absolutes, never a percentage.
  const _patBit = patTraj ? patTraj.label : fmtP('PAT', patYRaw);
  const _epsBit = patTraj ? '' : (epsTraj ? epsTraj.label.replace(/^loss per share/, 'EPS loss').replace(/^turned profitable/, 'EPS turned positive').replace(/^swung to a loss per share/, 'EPS swung to a loss') : fmtP('EPS', epsYRaw));
  // zzz821 — a lender's summary speaks of NET margin (profit ÷ income); an
  // operating margin means nothing for a bank, NBFC or insurer.
  const _netM = (pc: number | null, sc: number | null) => (pc != null && sc != null && sc > 0) ? Math.round((pc / sc) * 1000) / 10 : null;
  const _nmNow = _netM(_patCurA, _sCur), _nmPrev = _netM(_patPrevA, _sPrev);
  const _opmBit = !(patTraj || epsTraj) ? ''
    : _isLender
      ? ((_nmNow != null && _nmPrev != null && Math.abs(_nmNow - _nmPrev) >= 3) ? `net margin ${_nmPrev}% → ${_nmNow}%` : '')
      : ((typeof row?.opm_pct === 'number' && typeof row?.opm_prev_pct === 'number' && opmExp != null && Math.abs(opmExp) >= 3)
        ? `operating margin ${row.opm_prev_pct}% → ${row.opm_pct}%` : '');
  const metrics = [fmtP('revenue', salesY), _patBit, _epsBit, _opmBit].filter(Boolean).join(', ');
  // Price-reaction tags are NOT fundamental caveats: they go in their own
  // clearly labelled sentence so "with caveats" only ever describes the filing.
  const _fundCaveats = [...new Set(caveat_tags)].filter((t) => !MARKET_REACTION_CAVEATS.has(t));
  const flavor =
    _fundCaveats.length > 0 ? ` with caveat${_fundCaveats.length > 1 ? 's' : ''}: ${_fundCaveats.slice(0, 3).join(' + ')}.` :
    methodology_tags.length >= 2 ? ` and ${[...new Set(methodology_tags)].join('/')} all passing.` : '.';
  const _d1 = typeof row?.d1_pct === 'number' && Number.isFinite(row.d1_pct) ? row.d1_pct : null;
  const market_reaction = _reactionTags.length > 0 ? {
    d1_pct: _d1,
    gap_pct: typeof row?.gap_pct === 'number' ? row.gap_pct : null,
    tags: _reactionTags,
    // zzz819 — the price no longer changes the tier, so nothing is ever
    // demoted by it. Kept (always null) so older readers of the field work.
    demoted_from: null,
    note: `Market reaction: ${_d1 != null ? `D1 ${_d1 >= 0 ? '+' : ''}${Math.round(_d1 * 10) / 10}% after the print` : 'sold after the print'} — a price move, not a verdict on the filing; it does not change the grade.`,
  } : null;
  for (const t of _reactionTags) if (!market_context.includes(t)) market_context.push(t);
  // Chart / liquidity facts other than the Day-1 reaction, stated AFTER the
  // verdict and labelled as not part of it.
  const _ctxOther = market_context.filter((t) => !MARKET_REACTION_CAVEATS.has(t));
  const _ctxNote = (_ctxOther.length ? ` Price context (not part of the grade): ${_ctxOther.join(', ')}.` : '')
    + (size_flags.length ? ` Size context (not part of the grade): ${size_flags.join(', ')}.` : '');
  const _basisNote = growth_basis_note ? ` Growth ${growth_basis_note}.` : '';
  const narrative = `${head} (${metrics})${flavor}${_basisNote}${market_reaction ? ' ' + market_reaction.note : ''}${_ctxNote}`;

  // PATCH 1006 — compute ELITE / PEAD / MULTIBAGGER flags from available data
  const _stillLoss = (row?.pat_curr_cr != null && row.pat_curr_cr <= 0) || (row?.eps_curr != null && row.eps_curr <= 0);
  const _criticalsOrStruct = caveat_tags.filter((t: any) => t === 'low quality' || t === 'ocf divergence' || t === 'optical eps').length;
  // PATCH 1010 — STRICT ELITE gate. All criteria required; null fails.
  const _is_elite = !!(
    !_stillLoss && !turnaroundBase
    && row?.pat_curr_cr != null && row.pat_curr_cr > 0
    && row?.eps_curr != null && row.eps_curr > 0
    && salesY != null && salesY >= 25
    && patY != null && patY >= 30
    && opmExp != null && opmExp >= 1
    && row?.d1_pct != null && row.d1_pct >= 2
    && row?.gap_pct != null && row.gap_pct >= 0
    && _criticalsOrStruct === 0
    && stage !== 4
    && (rs == null || rs >= 60)
    && !(row?.pat_prev_cr != null && row.pat_prev_cr < 0)  // PATCH 1008 — no turnaround base in ELITE
    && !_thinFloat  // PATCH 1034 — thin float can't be ELITE
  );
  const _sc = (v: number | null | undefined, ranges: [number, number][]): number => {
    if (v == null || !Number.isFinite(v)) return 0;
    for (const [thr, pts] of ranges) if (v >= thr) return pts;
    return 0;
  };
  // PATCH 1009 — when d1/gap null, redistribute their weight to surprise.
  // The Bernard-Thomas drift model trusts the price signal most, but without
  // it we shouldn't tank to 0 — we should fall back to fundamentals (surprise).
  const _d1Known = row?.d1_pct != null;
  const _gapKnown = row?.gap_pct != null;
  const _d1S = _sc(row?.d1_pct, [[8,100],[5,85],[3,70],[1,50],[0,30],[-2,15]]);
  const _gapS = _sc(row?.gap_pct, [[3,100],[1,75],[0,55],[-1,30]]);
  const _surS = _sc(patY, [[100,100],[50,80],[25,60],[10,40],[0,25]]);
  const _salesS = _sc(salesY, [[50,100],[25,80],[15,60],[5,40],[0,25]]);
  // zzz668 — THE REAL VOLUME RATIO, NOT THE CONSTANT.
  //
  // This was 50, with the US engine's comment naming it as a known India
  // limitation: "the India engine has to hardcode it to 50 because Screener
  // does not expose the series". Enrichment computes `vol_ratio_20d` and the
  // row builder was dropping it, so the limitation was in the plumbing, not
  // the data. A quarter of the PEAD score is now measured.
  //
  // Post-earnings drift needs CONVICTION behind the move: the same 5% rise on
  // triple normal volume and on half normal volume are not the same event. 50
  // remains the reading when the ratio is genuinely unknown, which is the only
  // honest value for "no opinion".
  const _vr = (typeof (row as any)?.vol_ratio_20d === 'number' && Number.isFinite((row as any).vol_ratio_20d))
    ? (row as any).vol_ratio_20d
    : ((typeof (row as any)?.rvol === 'number' && Number.isFinite((row as any).rvol)) ? (row as any).rvol : null);
  const _volS = _vr == null ? 50
    : _vr >= 3 ? 100 : _vr >= 2 ? 88 : _vr >= 1.5 ? 75 : _vr >= 1 ? 60 : _vr >= 0.7 ? 40 : 20;
  // ═══════════════════════════════════════════════════════════════════════
  // ONE PEAD SCORE, NOT TWO.  (zzz669)
  //
  // Two incompatible PEAD formulas have been shipping side by side: this one,
  // shown on the card, and a later one in lib/pead-score.ts that the Conviction
  // bench recomputes with. They disagree about the same company, which means at
  // least one of the two numbers you read is wrong, and nothing on either screen
  // says which.
  //
  // The bench formula is the better one and its own header explains why: the
  // earlier construction "measured the wrong quantity" — a weighted sum of YoY
  // growth answers how big the numbers were, not how much drift is left — and
  // "its scale made its own green band unreachable", a sales +25 / profit +40 /
  // EPS +38 quarter scoring about 49. It also carries the time decay that post-
  // earnings drift is defined by: reaction, drift, saturation, exhaustion.
  //
  // So the card adopts the bench's function rather than the bench adopting the
  // card's. Both screens now read the same number for the same company, and the
  // decay is computed from the filing date on both, so a card seen the morning
  // after the print and the same name on the bench six weeks later differ for
  // the reason they should.
  //
  // The measured volume ratio above is not wasted: it is the conviction filter
  // the reaction leg lacked, applied as a modest tilt rather than a quarter of
  // the score, because the bench formula already weights the reaction at 50%.
  const _peadBase = peadScore({
    ticker: row?.symbol || '',
    sales_yoy_pct: salesY,
    net_profit_yoy_pct: patY,
    eps_yoy_pct: epsY,
    composite_score: composite,
    fund_composite: Math.round(_fund_composite), setup_grade: _setup_grade,  // zzz673 — display only
    d1_pct: row?.d1_pct ?? null,
    gap_pct: row?.gap_pct ?? null,
    tier,
    filing_date: row?.filing_date,
  } as any).score;
  // Volume tilt: ±6 points at the extremes, nothing when the ratio is unknown.
  const _volTilt = _vr == null ? 0
    : _vr >= 3 ? 6 : _vr >= 2 ? 4 : _vr >= 1.5 ? 2 : _vr >= 1 ? 0 : _vr >= 0.7 ? -3 : -6;
  const _pead_score = Math.max(0, Math.min(100, Math.round(_peadBase + _volTilt)));
  const _roce = (row as any)?.roce;
  const _opm = row?.opm_pct;
  const _prom = (row as any)?.promoter;
  // MULTIBAGGER  (PATCH 1009, corrected zzz668)
  //
  // The fourth signal read `row.promoter` — promoter holding — and NOTHING in
  // the pipeline has ever set that field. Enrichment returns `pledged_pct`; it
  // does not return promoter holding, and a repo-wide search finds no producer.
  // So the badge has always been a THREE-signal test needing two, while its
  // tooltip described a "6-criterion SQGLP compounder filter".
  //
  // The dead leg is removed rather than left to look like a rule. Pledge is
  // used in its place, which is the governance figure that IS scraped: a
  // promoter who has pledged a quarter of the company is the risk the promoter
  // leg was gesturing at, and unlike the original it can actually fire.
  const _pledge = typeof (row as any)?.pledged_pct === 'number' ? (row as any).pledged_pct : null;
  const _mbSignals = ((typeof _roce === 'number' && _roce >= 25) ? 1 : 0)
                   + ((typeof _opm === 'number' && _opm >= 18) ? 1 : 0)
                   + ((opmExp != null && opmExp >= 1) ? 1 : 0)
                   + ((_pledge != null && _pledge <= 5) ? 1 : 0);
  const _multibagger = !!(_mbSignals >= 2 && !_stillLoss);

  // ── QUALITY × INFLECTION (the second axis) ────────────────────────────────
  // Purely ADDITIVE: computed AFTER `tier` is final and never fed back into it.
  // A company that has not yet proved it can earn a return does not become
  // BLOCKBUSTER because it is improving quickly, so the quadrant sits BESIDE
  // the tier rather than adjusting it. The input mapping lives in the shared
  // module so this server copy and the client gradeRow cannot disagree about
  // what quadrant a given row is in.
  const _q = quadrantForIndiaRow(row, { salesY, opmExp });
  return {
    ticker: row.symbol,
    company: row.company || row.symbol,
    sector: row.sector,
    filing_date: row.filing_date,
    quarter: row.quarter || deriveQuarterLabel(row.filing_date),
    market_cap_bucket: row.market_cap_bucket,
    market_cap_cr: row.market_cap_cr ?? null,
    adtv_cr: _adtv,  // PATCH 1034 — liquidity (median ₹Cr/day)
    pe: row.pe ?? null,
    price: row.current_price ?? null,
    sales_yoy_pct: salesY, net_profit_yoy_pct: patYRaw, eps_yoy_pct: epsYRaw,
    sales_curr_cr: row.sales_curr_cr ?? null, sales_prev_cr: row.sales_prev_cr ?? null,
    pat_curr_cr: row.pat_curr_cr ?? null, pat_prev_cr: row.pat_prev_cr ?? null,
    eps_curr: row.eps_curr ?? null, eps_prev: row.eps_prev ?? null,
    gap_pct: row.gap_pct ?? null, d1_pct: row.d1_pct ?? null, move_pct: row.move_pct ?? null,
    rs_rating: rs, stage, pct_from_52w_high: pct52,
    composite_score: Math.round(composite), tier,
    fund_composite: Math.round(_fund_composite), setup_grade: _setup_grade,  // zzz673 — display only
    methodology_tags: [...new Set(methodology_tags)], caveat_tags: [...new Set(caveat_tags)],
    narrative, filing_url: row.source_url, source: row.financials_source || 'NSE+BSE',
    // zzz800 — the profit move stated honestly when either quarter is a loss
    // (null when both are profits and the YoY % above is meaningful), and the
    // Day-1 price reaction kept apart from the fundamental verdict.
    pat_trajectory: patTraj ? patTraj.label : null,
    eps_trajectory: epsTraj ? epsTraj.label : null,
    market_reaction,
    // zzz819 — price facts shown beside the grade, never part of it.
    market_context: Array.from(new Set(market_context)),
    // zzz826 — shell-company flags (market-cap / traded-value based, so they
    // are price context too): 'very small company' | 'barely trades'.
    size_flags: size_flags.length ? size_flags : null,
    // zzz826 — liquidity: the real multi-day average only, with its days; the
    // one-day turnover kept apart and never used as the average.
    adtv_days: _adtv != null ? (realAdtv(row).days ?? null) : null,
    turnover_1d_cr: (typeof row?.turnover_1d_cr === 'number' && Number.isFinite(row.turnover_1d_cr)) ? row.turnover_1d_cr : null,
    // zzz826 — 'raised' | 'cut' | 'positive outlook' | 'not raised' | 'unknown'.
    guidance_status,
    guidance_note,
    // zzz826 — rule versions of the figures (for the prewarm re-fetch).
    cash_rule_v: typeof row?.cash_rule_v === 'number' ? row.cash_rule_v : null,
    yoy_rule_v: typeof row?.yoy_rule_v === 'number' ? row.yoy_rule_v : null,
    ocf_annual_cr: _cashView.ocf, pat_annual_cr: _cashView.pat,
    // zzz819 — why a BLOCKBUSTER-on-the-numbers quarter was held lower, in one
    // plain line ("Capped at STRONG: revenue grew only 5%"). Null otherwise.
    tier_cap_reason,
    bb_gate_misses: _capMisses.length && tier_cap_reason ? _capMisses : null,
    // zzz821 — distinct problem kinds found (growth quality / thin margin /
    // cash / quality flag); 2+ means MIXED.
    problem_kinds: _problemKinds.length ? _problemKinds : null,
    // zzz821 — the India F-pattern forensic check (null when F does not fire):
    // { status: 'passed' | 'not_passed' | 'unverified', reason }.
    forensic_check: _forensic,
    // zzz821 — an investment / trading company whose profit moves with markets.
    market_driven: _marketDriven,
    // zzz821 — PAT and EPS disagree: the lower one graded, stated here.
    growth_basis_note,
    // zzz821 — PAT and EPS moved in opposite directions: top tier held.
    figures_conflict,
    ...(_tierUnconfirmed ? { _tier_unconfirmed: _tierUnconfirmed } : {}),
    // zzz821 — 'lender' | 'insurer' | null, from the shared detection.
    fin_kind: _finKind,
    industry: rowIn?.industry ?? null,
    broad_industry: rowIn?.broad_industry ?? null,
    // PATCH 1006
    is_elite: _is_elite,
    pead_score: _pead_score,
    multibagger_setup: _multibagger,
    // PATCH 1015 — the actual root cause: gradeRow built the return object
    // by listing fields explicitly and OMITTED opm_pct / opm_prev_pct. The
    // row going in HAD these populated from enrich; gradeRow stripped them.
    // Every previous OPM patch was correct in principle but invisible because
    // this final return shape never included the field. Fix: include them.
    opm_pct: row.opm_pct ?? null,
    opm_prev_pct: row.opm_prev_pct ?? null,
    // zzz314 — SAME class of bug as PATCH 1015: enrichment provides
    // ocf_to_pat_ratio (used above for the 'ocf divergence' caveat), but
    // gradeRow was dropping it from the response so downstream CB cards
    // couldn't render a CFO/PAT chip. Expose it here under two aliases:
    // ocf_to_pat_ratio (matches the internal field name) and
    // cfo_to_pat_ratio (matches downstream sync + display code).
    // zzz821 — same-fiscal-year CFO ÷ PAT only (null = unknown or not
    // meaningful); `cash_basis` names the year, `cash_note` says why not.
    ocf_to_pat_ratio: _cashView.ratio,
    cfo_to_pat_ratio: _cashView.ratio,
    cash_basis: _cashView.basis,
    cash_fy: _cashView.fy,
    cash_note: _cashView.note,
    // QUALITY × INFLECTION — second axis, alongside (never instead of) the tier.
    quality_score: _q.quality,
    inflection_score: _q.inflection,
    quadrant: _q.quadrant,
    quadrant_parts: { quality: _q.quality_parts, inflection: _q.inflection_parts },
    // ROCE is a quality input the card should be able to show its work on; the
    // grader already reads it (multibagger flag) but was dropping it from the
    // response — the same class of omission as PATCH 1015 / zzz314.
    roce: (typeof _roce === 'number' && Number.isFinite(_roce)) ? _roce : null,
  } as any;
}
