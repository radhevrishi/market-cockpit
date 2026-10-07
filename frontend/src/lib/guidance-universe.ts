// zzz848 — GUIDANCE UNIVERSE (Layer A): persistent, currently valid management guidance, independent of event recency.
// Pure module (no I/O). Inputs: live Growth Guidance companies, ledger entries, researched records (data file rows).
// Rules: never invent a number; unknown is not negative; no BUY/SELL; no composite score; every summary number is computed from the
// records (never hard-coded); a company is never named in logic; a range is shown as a range, never a midpoint.
//
// COUNTING RULE (documented choice): a revenue/PAT point counts toward the "30%+" numbers when
//   - it is VERIFIED or PARTIALLY_VERIFIED (media-only rows are listed and counted separately, never in the headline),
//   - it is an annual-style period (FY / CY / rolling 12 months). Multi-year CAGRs, quarters and half-years never count as "FY27 guidance",
//   - it is not a proxy for another measure (e.g. presales instead of revenue),
//   - its comparison value is >= threshold, where the comparison value is: the stated figure for a point, the MIDPOINT for a closed range
//     (the range itself is still displayed), and the LOWER BOUND for an open-ended "80%+" figure (no invented midpoint).
import { growthQuoteIssue } from './guidance-growth-quote';   // zzz895
import { growthScopeIssue } from './guidance-prior-match';
import type { GgCompany, GgGrowthOrigin, GgGuidancePoint, GgKind, GgLedgerRow, GgMetric, GgOrganic, GgPeriodKind, GgRevision, GgSourceRef, GgVerification } from './growth-guidance-types';
import type { GuHighGrowthHorizon, GuHighGrowthMetric, GuHighGrowthRowX, GuMarketSummary, GuPeriodStatus, GuRegressionResponse, GuRegressionRow, GuRegressionStatus, GuSummaryAdditions, GuUniverseBucket, GuUniverseRecord, GuUniverseRecordOrigin, GuUniverseSummary } from './guidance-universe-types';
import type {
  GuClaimType, GuCohort, GuDurationType, GuExpirySummary, GuGrowthDerivation, GuGrowthType, GuGrowthVsPriorYear, GuGuidanceType, GuHgGroupRow, GuHgMetricX, GuHighGrowthGroups, GuHistoryStep, GuLifecycle,
  GuMetricFamily, GuPeriodConfirm, GuReviewReasonX, GuRevisionVsPrior, GuSourceEntry, GuStateCounts, GuTrust, GuVerificationState,
  GuCountEquations, GuEventOverride, GuEventStatus, GuEventStatusKind, GuListBucket,
} from './guidance-universe-types';
import { activePointViolations } from './guidance-invariants';
import {
  HIGH_GROWTH_THRESHOLD, PLAUSIBLE_REVENUE_GROWTH_PCT, REPORTING_LAG_DAYS, REGRESSION_TOLERANCE_PP, PRIOR_NEIGHBOURHOOD_PP, SOURCE_CONFLICT_WINDOW_DAYS, STALE_VERIFICATION_DAYS, STALE_DEMOTE_DAYS, classifySourceTier, TIER_LABEL, type SourceTier,
} from './guidance-config';
import {
  FAMILY_OF, amountText, buildHistory, claimTypeOf, daysBetween, deriveGrowth, derivedDp, extractMetricLabel, familyOfLabel, fnum, isCapitalRaise, isReiteration, isStale, nonGuidanceReason, normPeriod, parseUnit,
  pctText, periodFacts, r0, r1, revisionVsPriorOf, sameMoneyBasis, sameValue, sg, textSaysGuidanceRaised, verificationStateOf, type GuVersionIn,
} from './guidance-universe-integrity';
export { normPeriod, amountText, pctText, PLAUSIBLE_REVENUE_GROWTH_PCT, REPORTING_LAG_DAYS, REGRESSION_TOLERANCE_PP, PRIOR_NEIGHBOURHOOD_PP };
import { buildCompanyIndex, normCompanyName } from './guidance-upgrades-candidates';
import { freshnessCounts, FRESHNESS_RULE, calculationTypeOf, verificationStatusOf, guidanceWording, freshnessOf, classifyGuidanceChange, type GuCalculationType, type GuVerificationStatus, type GuFreshnessTier, type GuEventType } from './guidance-semantics';
import { NSE_TICKER_NAMES } from './nse-ticker-names';
import { endOfPeriodLabel, qualityOf, revisionOf, type GgStoredEntry } from './growth-guidance';
import type { ExtractedGuidance, GuidanceExtractResult, GuidanceMetricX } from './guidance-docs-types';
import { actualKey, priorPeriodOf, universeUnitOf, baseFyFor, type PriorActual } from './guidance-extract-reader';
import { cagrPct, isLowBoundOnly, isOpenHorizonLabel, multipleOf, nextYearsOf, perYearStated, scopeIssueOf, metricFromQuote, fcfIssueOf, LONG_TERM_LABEL, totalToAnnual, lastCompletedFy, spacIssueOf, fiscalYearNamedIn } from './guidance-horizon';   // zzz916 · zzz931

export const GU_VERSION = 'zzz849-gu-v2';
const DAY = 86_400_000;
const METRICS: GgMetric[] = ['REVENUE', 'PAT', 'EPS', 'EBITDA', 'FCF'];
const METRIC_WORD: Record<GgMetric, string> = { REVENUE: 'revenue', PAT: 'PAT', EPS: 'EPS', EBITDA: 'EBITDA', FCF: 'FCF' };
const PKINDS: GgPeriodKind[] = ['FY', 'CY', 'QUARTER', 'HALF', 'ROLLING_12M', 'MULTI_YEAR_CAGR', 'UNKNOWN'];
const VERIFS: GgVerification[] = ['VERIFIED', 'PARTIALLY_VERIFIED', 'SECONDARY_ONLY', 'UNVERIFIED'];
const KINDS: GgKind[] = ['MANAGEMENT_GUIDANCE', 'MANAGEMENT_TARGET', 'MANAGEMENT_COMMENTARY', 'ANALYST_CONSENSUS', 'ANALYST_ESTIMATE', 'HISTORICAL_TRAJECTORY', 'INFERENCE'];
const ORGANICS: GgOrganic[] = ['ORGANIC', 'ACQUISITION_LED', 'MIXED', 'UNKNOWN'];
const isMgmt = (k: GgKind) => k.startsWith('MANAGEMENT_');
const hash = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

// ═══ seed rows (researched records held as data) ═══════════════════════════════════════════════
export interface GuSeedPrior { date: string; growthLow: number | null; growthHigh: number | null; note: string; /** zzz853: the earlier guidance AMOUNT when it was stated (enables the revision vs prior guidance) */ absoluteTarget?: { value: number; unit: string; valueLow?: number } | null }
export interface GuSeedRow {
  company: string; ticker: string | null; market: 'IN' | 'US'; metric: GgMetric;
  growthLow: number | null; growthHigh: number | null; growthOrigin: GgGrowthOrigin; absoluteTarget: { value: number; unit: string; valueLow?: number } | null;
  period: string; periodKind: GgPeriodKind; kind: GgKind; organic: GgOrganic; statement: string; driver: string | null; mechanisms: string[];
  sourceName: string; sourceType: string; sourceUrl: string | null; sourceDate: string | null; sourceRank: number; verification: GgVerification;
  priorGuidance: GuSeedPrior[]; supersededBy: string | null; notes: string; ownerListText: string | null;
  /** zzz849: the SOURCED base an implied growth % was divided by, e.g. { value: 357.71, unit: '₹ Cr', period: 'FY26' }. Absent = base not sourced. */
  impliedBase?: { value: number; unit: string; period: string; /** zzz853: what the base is (default PRIOR_YEAR_ACTUAL) */ kind?: 'PRIOR_YEAR_ACTUAL' | 'PRIOR_GUIDANCE' } | null;
  /** zzz853: the source record's own fiscal-year context for a year-less quarter ('FY27'): filing period / period of report / explicit text. Never taken from today's date. */
  periodContext?: string | null;
  /** zzz853: the text of the primary document was actually read (not only found). Absent = true only for a TIER1/2 source the researcher marked VERIFIED. */
  primarySourceRead?: boolean | null;
  /** zzz853: the metric word the source used ('Net sales', 'Turnover', 'PAT') */
  sourceMetricLabel?: string | null;
  /** zzz853: date a person or the system last confirmed this record (defaults to the source date) */
  lastVerified?: string | null;
  /** zzz849: why a researcher flagged this row (ambiguous base, conflicting sources). Flagged rows stay listed but are never counted as high-growth. */
  needsReview?: string | null;
}
const numOrNull = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isoDay = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
/** Validates researched rows. Malformed rows are dropped (with a reason), never thrown. Accepts an array or `{ rows: [...] }`. */
export function loadSeedRows(raw: unknown): { rows: GuSeedRow[]; dropped: Array<{ index: number; reason: string }> } {
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.rows) ? (raw as any).rows : [];
  const rows: GuSeedRow[] = []; const dropped: Array<{ index: number; reason: string }> = [];
  list.forEach((x: any, index) => {
    const bad = (reason: string) => { dropped.push({ index, reason }); };
    if (!x || typeof x !== 'object') return bad('not an object');
    if (typeof x.company !== 'string' || !x.company.trim()) return bad('no company');
    if (x.market !== 'IN' && x.market !== 'US') return bad('market must be IN or US');
    if (!METRICS.includes(x.metric)) return bad('unknown metric');
    if (typeof x.period !== 'string' || !x.period.trim()) return bad('no period');
    const pk = x.periodKind === undefined ? 'UNKNOWN' : x.periodKind; if (!PKINDS.includes(pk)) return bad('unknown periodKind');
    if (!VERIFS.includes(x.verification)) return bad('unknown verification');
    if (!KINDS.includes(x.kind)) return bad('unknown kind');
    const lo = numOrNull(x.growthLow), hi = numOrNull(x.growthHigh); if (lo === undefined || hi === undefined) return bad('growth is not a number');
    if (lo != null && hi != null && lo > hi) return bad('growthLow above growthHigh');
    const abs = x.absoluteTarget && typeof x.absoluteTarget === 'object' && typeof x.absoluteTarget.value === 'number' && Number.isFinite(x.absoluteTarget.value)
      ? { value: x.absoluteTarget.value, unit: String(x.absoluteTarget.unit || ''), ...(typeof x.absoluteTarget.valueLow === 'number' && Number.isFinite(x.absoluteTarget.valueLow) && x.absoluteTarget.valueLow < x.absoluteTarget.value ? { valueLow: x.absoluteTarget.valueLow } : {}) } : null;
    if (lo == null && hi == null && !abs) return bad('no number at all');
    if (hi != null && lo == null) return bad('growthHigh without growthLow');
    const rank = x.sourceRank; if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > 12) return bad('sourceRank must be 1..12');
    const sd = isoDay(x.sourceDate); if (sd === undefined) return bad('bad sourceDate');
    const ib = x.impliedBase && typeof x.impliedBase === 'object' && typeof x.impliedBase.value === 'number' && Number.isFinite(x.impliedBase.value) && x.impliedBase.value > 0 && typeof x.impliedBase.period === 'string' && x.impliedBase.period.trim()
      ? { value: x.impliedBase.value as number, unit: String(x.impliedBase.unit || ''), period: String(x.impliedBase.period).trim(), ...(x.impliedBase.kind === 'PRIOR_GUIDANCE' ? { kind: 'PRIOR_GUIDANCE' as const } : {}) } : null;
    const url = typeof x.sourceUrl === 'string' && /^https?:\/\//i.test(x.sourceUrl) ? x.sourceUrl : null;
    const absOf = (a: any) => (a && typeof a === 'object' && typeof a.value === 'number' && Number.isFinite(a.value) ? { value: a.value as number, unit: String(a.unit || ''), ...(typeof a.valueLow === 'number' && Number.isFinite(a.valueLow) && a.valueLow < a.value ? { valueLow: a.valueLow as number } : {}) } : null);
    const priors: GuSeedPrior[] = (Array.isArray(x.priorGuidance) ? x.priorGuidance : []).map((p: any) => ({ date: isoDay(p?.date) || '', growthLow: numOrNull(p?.growthLow) ?? null, growthHigh: numOrNull(p?.growthHigh) ?? null, note: String(p?.note || ''), absoluteTarget: absOf(p?.absoluteTarget) })).filter((p: GuSeedPrior) => p.date);
    rows.push({
      company: x.company.trim(), ticker: typeof x.ticker === 'string' && x.ticker.trim() ? x.ticker.trim().toUpperCase().replace(/\.(NS|BO)$/, '') : null, market: x.market, metric: x.metric,
      growthLow: lo ?? null, growthHigh: hi ?? null, growthOrigin: x.growthOrigin === 'IMPLIED' ? 'IMPLIED' : 'STATED', absoluteTarget: abs,
      period: x.period.trim(), periodKind: pk, kind: x.kind, organic: ORGANICS.includes(x.organic) ? x.organic : 'UNKNOWN', statement: String(x.statement || ''), driver: typeof x.driver === 'string' && x.driver ? x.driver : null,
      mechanisms: Array.isArray(x.mechanisms) ? x.mechanisms.filter((m: unknown) => typeof m === 'string') : [], sourceName: String(x.sourceName || 'Source not named'), sourceType: String(x.sourceType || 'Media'),
      sourceUrl: url, sourceDate: sd ?? null, sourceRank: rank, verification: x.verification, priorGuidance: priors, supersededBy: typeof x.supersededBy === 'string' ? x.supersededBy : null,
      notes: String(x.notes || ''), ownerListText: typeof x.ownerListText === 'string' && x.ownerListText.trim() ? x.ownerListText.trim() : null,
      impliedBase: ib, needsReview: typeof x.needsReview === 'string' && x.needsReview.trim() ? x.needsReview.trim() : null,
      periodContext: typeof x.periodContext === 'string' && x.periodContext.trim() ? x.periodContext.trim() : null,
      primarySourceRead: typeof x.primarySourceRead === 'boolean' ? x.primarySourceRead : null,
      sourceMetricLabel: typeof x.sourceMetricLabel === 'string' && x.sourceMetricLabel.trim() ? x.sourceMetricLabel.trim() : null,
      lastVerified: isoDay(x.lastVerified) ?? null,
    });
  });
  return { rows, dropped };
}

// ═══ periods ═══════════════════════════════════════════════════════════════════════════════════
/** End of a guidance period. Indian FY ends 31 Mar. US FY: the company's fiscal year end is not known here, so it is treated as 31 Dec of the named year and noted. Unknown -> null (active, noted). */
export function periodEnd(period: string, market: 'IN' | 'US', announced?: string | null): { end: Date | null; note: string | null } {
  const p = normPeriod(period);
  const end = endOfPeriodLabel(p, announced || new Date().toISOString(), market);
  if (!end) return { end: null, note: `Period end not known for "${period}", so it is kept active.` };
  return { end, note: market === 'US' && /^FY/.test(p) ? 'Fiscal year end not known, treated as 31 December of that year.' : null };
}

// ═══ period status (zzz849): ACTIVE / EXPIRED / UNKNOWN from the period text and the issue date ═════
export interface GuPeriodInfo { status: GuPeriodStatus; end: Date | null; /** the year was not in the text and was inferred from the issue date */ inferred: boolean; note: string | null; reason: string }
const utcD = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
/** Calendar end of quarter q (1-4) or half h (1-2) for a market: India reports on an April-March fiscal year, the US on calendar quarters unless the text says otherwise. */
const SHORT_END: Record<'IN' | 'US', { Q: Array<[number, number]>; H: Array<[number, number]> }> = {
  IN: { Q: [[5, 30], [8, 30], [11, 31], [2, 31]], H: [[8, 30], [2, 31]] },
  US: { Q: [[2, 31], [5, 30], [8, 30], [11, 31]], H: [[5, 30], [11, 31]] },
};
/**
 * Whether a guided period is still running, from the period text and the date the guidance was issued. Never invents a company fiscal calendar:
 *  - 'Q2 (year not stated)': the year is inferred as the first such quarter end on or after the issue date (calendar reading for the US, April-March for India), flagged `inferred`.
 *    No issue date -> UNKNOWN.
 *  - quarters and halves expire REPORTING_LAG_DAYS after they end; a US quarter labelled with a fiscal year gets a further quarter of tolerance because its fiscal calendar is not known.
 *  - India FY ends 31 March. A US 'FY2026' could end anywhere from mid-2026 to early 2027, so it is treated as running until 1 March of the next year (+lag) and noted.
 *  - anything that cannot be placed in time -> UNKNOWN (kept in the universe, never in the high-growth list).
 */
export function periodStatusOf(period: string, pkind: GgPeriodKind, market: 'IN' | 'US', issued: string | null | undefined, now: Date): GuPeriodInfo {
  const p = normPeriod(period); const t = now.getTime();
  const unknown = (reason: string, note = 'Period year not stated: the period end is not known, so it is kept in the universe but out of the high-growth list.'): GuPeriodInfo => ({ status: 'UNKNOWN', end: null, inferred: false, note, reason });
  const issuedMs = issued ? Date.parse(issued) : NaN;
  const yl = /^([QH])([1-4]) \(year not stated\)$/i.exec(p) || /^([QH])([1-4])$/i.exec(p);
  if (yl) {
    const kind = yl[1].toUpperCase() as 'Q' | 'H'; const n = parseInt(yl[2], 10);
    if (kind === 'H' && n > 2) return unknown(`${p} is not a half-year.`);
    if (!Number.isFinite(issuedMs)) return unknown(`${p}: no issue date, so the year cannot be inferred.`);
    const [m, d] = SHORT_END[market][kind][n - 1]; const iy = new Date(issuedMs).getUTCFullYear();
    let end: Date | null = null;
    for (const y of [iy - 1, iy, iy + 1]) { const c = utcD(y, m, d); if (c.getTime() >= issuedMs - DAY + 1 && (!end || c.getTime() < end.getTime())) end = c; }
    if (!end) return unknown('Quarter end could not be inferred.');
    const note = 'Year not stated; the quarter end is inferred from the issue date.';
    if (end.getTime() + REPORTING_LAG_DAYS * DAY < t) return { status: 'EXPIRED', end, inferred: true, note, reason: `The guided ${p.replace(/ \(year not stated\)/, '')} (year not stated, inferred to end ${end.toISOString().slice(0, 10)} from the ${new Date(issuedMs).toISOString().slice(0, 10)} issue date) has ended.` };
    return { status: 'ACTIVE', end, inferred: true, note, reason: '' };
  }
  if (pkind === 'UNKNOWN' || /^Period not stated$/i.test(p) || /not stated/i.test(p)) return unknown(`Period "${period}" is not stated.`);
  const end = endOfPeriodLabel(p, Number.isFinite(issuedMs) ? new Date(issuedMs).toISOString() : now.toISOString(), market);
  if (!end) return unknown(`Period "${period}" could not be placed in time.`);
  const isShort = pkind === 'QUARTER' || pkind === 'HALF' || /^[QH][1-4] /.test(p);
  let lag = isShort ? REPORTING_LAG_DAYS : 0; let note: string | null = null; let endAdj = end;
  if (market === 'US' && /^FY\d{2}/.test(p)) {
    endAdj = utcD(end.getUTCFullYear() + 1, 2, 1); lag = REPORTING_LAG_DAYS; note = 'US fiscal year end not known; treated as running until March of the following year.';
  } else if (market === 'US' && /^[QH][1-4] FY/.test(p)) { lag += /^H/.test(p) ? 183 : 92; note = 'US fiscal quarter end not known; calendar quarters assumed with a quarter of tolerance.'; }
  if (endAdj.getTime() + lag * DAY < t) return { status: 'EXPIRED', end: endAdj, inferred: false, note, reason: `The guided period (${p}) has ended.` };
  return { status: 'ACTIVE', end: endAdj, inferred: false, note, reason: '' };
}
const multiYears = (period: string, cumulativeYears?: number | null): number | null => {
  const nx = nextYearsOf(period); if (nx && nx > 1) return nx;   // zzz916: "Next 3 years"
  const m = /^FY(\d{2})-(\d{2})$/.exec(normPeriod(period)); if (m) { const n = parseInt(m[2], 10) - parseInt(m[1], 10) + 1; if (n > 1) return n; }
  return cumulativeYears && cumulativeYears > 1 ? cumulativeYears : null;
};

// ═══ display ═══════════════════════════════════════════════════════════════════════════════════
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Open-ended = only a lower bound is known: no upper number, or the source says 'at least / over / more than 60%' or '80%+'. */
export function isOpenEnded(low: number | null, high: number | null, statement: string): boolean {
  if (low == null) return false;
  if (high == null) return true;
  if (low !== high) return false;
  const n = esc(String(low));
  return new RegExp(`(?:at least|over|more than|above|in excess of|minimum of|upwards of)\\s+(?:about\\s+|around\\s+|roughly\\s+|~)?${n}\\s*%`, 'i').test(statement)
    || new RegExp(`\\b${n}\\s*%\\s*(?:\\+|plus(?! or minus)\\b|or more|and above)`, 'i').test(statement);
}
export interface GuDisplayIn { metric: GgMetric; low: number | null; high: number | null; open: boolean; origin: GgGrowthOrigin; periodKind: GgPeriodKind; period: string; abs: { value: number; unit: string; valueLow?: number } | null; cumulativeYears?: number | null; proxy?: string | null }
export function displayOf(i: GuDisplayIn): string {
  let core: string;
  if (i.low == null) {
    if (!i.abs) return '—';
    return `${amountText(i.abs)} target (no % stated)`;
  }
  const pct = pctText(i.low, i.high, i.open);
  if (i.periodKind === 'MULTI_YEAR_CAGR' && isOpenHorizonLabel(i.period)) {
    // zzz916: a standing rate with no year: "Long-term revenue growth +30%+ a year (no fixed year)"
    core = `${i.period === LONG_TERM_LABEL ? 'Long-term' : 'Medium-term'} ${METRIC_WORD[i.metric]} growth ${pct} a year (no fixed year)`;
  } else if (i.periodKind === 'MULTI_YEAR_CAGR') {
    const y = multiYears(i.period, i.cumulativeYears);
    core = `${y ? `${y}-yr` : 'Multi-year'} ${METRIC_WORD[i.metric]} CAGR ${pct}`;
  } else core = pct;
  if (i.proxy) core += ` (${i.proxy})`;
  if (i.origin === 'IMPLIED') core += ' (implied)';
  return core;
}
/** Value used for the threshold test. See COUNTING RULE at the top. */
export function compareValue(low: number | null, high: number | null, open: boolean): number | null {
  if (low == null) return null;
  if (open || high == null) return low;
  return r1((low + high) / 2);
}
const proxyOf = (metric: GgMetric, statement: string): string | null => {
  if (metric !== 'REVENUE') return null;
  if (/\b(revenue|top[- ]?line)\b/i.test(statement)) return null;
  if (/pre-?sales/i.test(statement)) return 'presales';
  if (/\bbookings\b/i.test(statement)) return 'bookings';
  return null;
};

// ═══ items (one guidance statement, whatever its origin) ═══════════════════════════════════════
type Inactive = 'EXPIRED' | 'SUPERSEDED' | 'WITHDRAWN';
interface Prior { date: string; low: number | null; high: number | null; note: string; abs?: { value: number; unit: string; valueLow?: number } | null }
interface ItemBase { value: number; unit: string; period: string; kind?: 'PRIOR_YEAR_ACTUAL' | 'PRIOR_GUIDANCE' }
/** zzz880: words that tie a figure to one part of the company (a business, unit, plant, geography or subsidiary), not the whole. */
export const SEGMENT_RE = /\b(segment|division|vertical|subsidiar(?:y|ies)|this business|the \w+ business|business unit|plant|facility|domestic|exports?\b|india (?:would|will|should|is)|saudi|middle east|us business|europe(?:an)? business|standalone|stand-alone|geograph)/i;
/** zzz880: an implied single-year change no company guides (revenue below −60% or above +400%; profit lines below −95% or above +1000%). Pure. */
export function implausibleImplied(g: { gOrigin?: string; low: number | null; high: number | null; metric: string; pkind?: string; base?: { value: number; unit: string; period: string } | null; abs?: { value: number; unit: string; valueLow?: number } | null }): string | null {
  if (g.gOrigin !== 'IMPLIED' || g.pkind === 'MULTI_YEAR_CAGR' || g.low == null) return null;
  const hi = g.high ?? g.low;
  const [min, max] = g.metric === 'REVENUE' ? [-60, 400] : [-95, 1000];
  if (g.low >= min && hi <= max) return null;
  const amt = g.abs ? `${g.abs.valueLow != null && g.abs.valueLow !== g.abs.value ? `${g.abs.valueLow}–` : ''}${g.abs.value} ${g.abs.unit}` : 'the guided amount';
  const base = g.base ? ` against last year's ${g.base.value} ${g.base.unit}` : '';
  return `Implausible against last year's actual: ${amt}${base} would be ${Math.round(g.low)}%; most likely a segment, one-off or partial figure, so it is not used as company guidance.`;
}
interface Item {
  origin: GuUniverseRecordOrigin; market: 'IN' | 'US'; ticker: string | null; company: string; metric: GgMetric;
  low: number | null; high: number | null; open: boolean; gOrigin: GgGrowthOrigin; abs: { value: number; unit: string; valueLow?: number } | null; cumulativeYears?: number | null;
  /** sourced base behind an IMPLIED growth % (null = no base recorded) */ base?: ItemBase | null; needsReview?: string | null; /** a same-day IMPLIED item merged under a STATED winner */ compImplied?: Item | null;
  period: string; pkind: GgPeriodKind; kind: GgKind; organic: GgOrganic; statement: string; driver: string | null; mechanisms: string[];
  src: { name: string; type: string; url: string | null; date: string | null; rank: number };
  verification: GgVerification; priors: Prior[]; notes: string | null; withdrawn?: boolean; forced?: Inactive; gc?: GgCompany; gp?: GgGuidancePoint; isPrimary?: boolean; owner?: string | null;
  /** zzz853 */ periodContext?: string | null; primarySourceRead?: boolean | null; sourceMetricLabel?: string | null; lastVerified?: string | null;
  tier?: SourceTier; claimType?: GuClaimType;
  /** zzz853: other sources for the same slot whose value differs (a conflict, not a revision) */ conflicts?: Item[];
  /** zzz857 (COMPANY_DOC): the revision the company's own document states (NEW -> INITIAL, REITERATED -> MAINTAINED ...); wins over text heuristics */ extRevision?: GuUniverseRecord['revision'];
  /** zzz857: why there is no growth % (e.g. 'growth not established: no FY26 actual available') */ growthNote?: string | null;
  /** zzz916: the % is a yearly rate (CAGR) worked out from a target amount several years out and an earlier base (document / results / "doubling") */
  /** zzz931: how 'total' = a total change over a span stated in words ("double in 3 years"), turned into the yearly rate; no amount or base */
  cagrFromBase?: { years: number; targetPeriod: string; how: 'document' | 'results' | 'multiple' | 'total'; baseText: string; yearsMin?: number } | null;
  /** zzz916: the base of an implied growth is quoted from the same company document ("₹220 Cr from FY26 base of ₹106 Cr"): the company itself states the jump */
  baseStatedByCompany?: boolean;
  /** zzz857: later company documents that reiterated this guidance (listed as extra primary sources) */ confirmedBy?: Array<{ name: string; type: string; url: string | null; date: string | null }>;
}
const srcPrimary = (rank: number, type: string) => rank <= 7 && !/media|news/i.test(type);
const tk = (t: unknown): string | null => { const s = String(t ?? '').trim().toUpperCase().replace(/\.(NS|BO)$/, ''); return s || null; };
const hasNumber = (low: number | null, abs: unknown) => low != null || !!abs;

function itemFromSeed(r: GuSeedRow): Item {
  return {
    origin: 'RESEARCHED_SEED', market: r.market, ticker: r.ticker, company: r.company, metric: r.metric, low: r.growthLow, high: r.growthHigh ?? r.growthLow, open: isOpenEnded(r.growthLow, r.growthHigh, r.statement), gOrigin: r.growthOrigin,
    abs: r.absoluteTarget, base: r.impliedBase ?? null, needsReview: r.needsReview ?? null, period: r.period, pkind: r.periodKind, kind: r.kind, organic: r.organic, statement: r.statement, driver: r.driver, mechanisms: r.mechanisms,
    src: { name: r.sourceName, type: r.sourceType, url: r.sourceUrl, date: r.sourceDate, rank: r.sourceRank }, verification: r.verification,
    priors: r.priorGuidance.map((p) => ({ date: p.date, low: p.growthLow, high: p.growthHigh, note: p.note, abs: p.absoluteTarget ?? null })), notes: r.notes || null, owner: r.ownerListText,
    periodContext: r.periodContext ?? null, primarySourceRead: r.primarySourceRead ?? null, sourceMetricLabel: r.sourceMetricLabel ?? null, lastVerified: r.lastVerified ?? null,
  };
}
const inactiveOfValidity = (v: GgCompany['validity']): Inactive | undefined => (v === 'ACTIVE' ? undefined : v === 'SUPERSEDED' ? 'SUPERSEDED' : v === 'WITHDRAWN' ? 'WITHDRAWN' : 'EXPIRED');
function itemsFromLive(c: GgCompany): Item[] {
  if (c.market !== 'IN' && c.market !== 'US') return [];
  const s0: GgSourceRef | undefined = c.sources?.[0];
  const pts = [c.primary, ...(c.others || [])].filter(Boolean);
  const out: Item[] = [];
  pts.forEach((p, idx) => {
    if (p.growthLow == null && !p.absoluteTarget) return;
    const lo = p.growthLow, hi = p.growthHigh ?? p.growthLow;
    out.push({
      origin: 'LIVE', market: c.market as 'IN' | 'US', ticker: tk(c.ticker), company: c.company, metric: p.metric, low: lo, high: hi, open: isOpenEnded(lo, hi, p.originalStatement || ''), gOrigin: p.growthOrigin,
      abs: p.absoluteTarget ? { value: p.absoluteTarget.value, unit: p.absoluteTarget.unit, ...((p as any).absoluteHigh != null && (p as any).absoluteHigh !== p.absoluteTarget.value ? { valueLow: Math.min(p.absoluteTarget.value, (p as any).absoluteHigh), value: Math.max(p.absoluteTarget.value, (p as any).absoluteHigh) } : {}) } : null,
      base: p.base ? { value: p.base.value, unit: p.absoluteTarget?.unit || '', period: p.base.period } : null, cumulativeYears: p.cumulativeYears, period: p.period, pkind: p.periodKind, kind: p.kind, organic: p.organic,
      statement: p.originalStatement || '', driver: c.driverText || null, mechanisms: c.mechanisms || [], src: { name: s0?.name || 'Live scan', type: s0?.type || 'Media', url: s0?.url || null, date: s0?.date || c.announcedAt || null, rank: s0?.rank ?? 10 },
      verification: c.verification, priors: [], notes: null, forced: inactiveOfValidity(c.validity), withdrawn: c.validity === 'WITHDRAWN', gc: c, gp: p, isPrimary: idx === 0,
    });
  });
  return out;
}
function itemsFromLedger(rows: Array<{ market: 'IN' | 'US'; ticker: string; company?: string; entries: GgStoredEntry[] }>): Item[] {
  const out: Item[] = [];
  for (const row of rows || []) {
    const groups = new Map<string, GgStoredEntry[]>();
    for (const e of row.entries || []) {
      if (!e || e.verification === 'UNVERIFIED') continue;
      const k = `${e.metric}|${normPeriod(e.period)}`; (groups.get(k) || groups.set(k, []).get(k)!).push(e);
    }
    for (const list of Array.from(groups.values())) {
      list.sort((a, b) => a.date.localeCompare(b.date));
      const e = list[list.length - 1];
      if (e.low == null && e.absLow == null) continue;
      out.push({
        origin: 'LEDGER', market: row.market, ticker: tk(row.ticker), company: row.company || (NSE_TICKER_NAMES as Record<string, string>)[row.ticker.toUpperCase()] || row.ticker, metric: e.metric, low: e.low, high: e.high ?? e.low, open: isOpenEnded(e.low, e.high ?? e.low, e.statement || ''), gOrigin: e.growthOrigin,
        abs: e.absLow != null ? { value: e.absLow, unit: e.absUnit || '' } : null, period: e.period, pkind: e.periodKind, kind: e.kind, organic: 'UNKNOWN', statement: e.statement || '', driver: null, mechanisms: [],
        src: { name: e.source, type: e.sourceRank <= 6 ? 'Filing' : e.sourceRank <= 9 ? 'Company voice' : 'Media', url: e.sourceUrl || null, date: e.date, rank: e.sourceRank }, verification: e.verification,
        priors: list.slice(0, -1).map((x) => ({ date: x.date, low: x.low, high: x.high, note: x.source })), notes: null, withdrawn: !!e.withdrawn, forced: e.withdrawn ? 'WITHDRAWN' : undefined,
      });
    }
  }
  return out;
}

// ═══ stored universe (what the route persists) ═════════════════════════════════════════════════
export interface GuStoredPoint {
  key: string; slot: string; market: 'IN' | 'US'; ticker: string | null; company: string; metric: GgMetric; low: number | null; high: number | null; open: boolean; gOrigin: GgGrowthOrigin;
  abs: { value: number; unit: string; valueLow?: number } | null; base?: ItemBase | null; needsReview?: string | null; period: string; pkind: GgPeriodKind; kind: GgKind; organic: GgOrganic; verification: GgVerification; statement: string;
  src: { name: string; type: string; url: string | null; date: string | null; rank: number }; priors: Prior[]; origin: GuUniverseRecordOrigin; display: string;
  /** zzz853 */ periodContext?: string | null; primarySourceRead?: boolean | null; sourceMetricLabel?: string | null; lastVerified?: string | null;
}
export interface GuStoredDoc { v: 1; asOf: string; hash: string; rows: GuStoredPoint[] }
export const GU_MAX_STORED = 600;
function itemsFromStored(rows: GuStoredPoint[] | null | undefined): Item[] {
  const out: Item[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.origin === 'RESEARCHED_SEED') continue;           // researched rows are re-read from their data file every time, never from a stale copy
    if (!METRICS.includes(r.metric) || !r.company || (r.low == null && !r.abs) || !isMgmt(r.kind) || r.verification === 'UNVERIFIED') continue;
    out.push({ origin: 'LEDGER', market: r.market, ticker: r.ticker, company: r.company, metric: r.metric, low: r.low, high: r.high, open: !!r.open, gOrigin: r.gOrigin, abs: r.abs, base: r.base ?? null, needsReview: r.needsReview ?? null, period: r.period, pkind: r.pkind, kind: r.kind,
      organic: r.organic, statement: r.statement || '', driver: null, mechanisms: [], src: r.src, verification: r.verification, priors: Array.isArray(r.priors) ? r.priors : [], notes: null,
      periodContext: r.periodContext ?? null, primarySourceRead: r.primarySourceRead ?? null, sourceMetricLabel: r.sourceMetricLabel ?? null, lastVerified: r.lastVerified ?? null });
  }
  return out;
}
// ═══ zzz857: company documents read by the AI extractor (quote-checked rows) ═════════════════════════
// Each ExtractedGuidance row (NEW / RAISED / REITERATED / NARROWED / LOWERED) for an ANNUAL or MULTI_YEAR period becomes a COMPANY_DOC item: the source is
// the company's own document (TIER1, read), quote = statement, lastVerified = the newest document that confirmed it. Per company + metric + period the
// documents are applied oldest -> newest: a new figure replaces the current one (the old one becomes a prior); a REITERATED figure inside the current
// range keeps the range and only moves lastVerified (with a note); WITHDRAWN withdraws. Growth: the company's stated % ('stated'), else derived vs the
// prior fiscal year's ACTUAL when one is available ('(derived)'), else the absolute target with 'growth not established'. Never a guess.
const X_METRIC: Partial<Record<GuidanceMetricX, GgMetric>> = { REVENUE: 'REVENUE', REVENUE_GROWTH: 'REVENUE', PAT: 'PAT', EPS: 'EPS', ADJ_EPS: 'EPS', EBITDA: 'EBITDA', FCF: 'FCF' };
const DOC_NAME: Record<string, { name: string; type: string }> = {
  TRANSCRIPT: { name: 'Earnings call transcript', type: 'Transcript' }, PRESENTATION: { name: 'Investor presentation', type: 'Investor presentation' },
  RESULTS_RELEASE: { name: 'Results press release', type: 'Earnings release' }, AGM_SPEECH: { name: 'AGM / chairman speech', type: 'Annual report' }, OTHER_COMPANY_DOC: { name: 'Company document', type: 'Filing' },
};
const xPeriod = (p: string): string => normPeriod(String(p || '').trim().replace(/^(FY|CY)\s?(\d{2,4})\s*[-–]\s*(?:FY|CY)?\s?(\d{2,4})$/i, (_m, a: string, x: string, y: string) => `${a.toUpperCase()}${x.slice(-2)}-${y.slice(-2)}`));
const crText = (v: number, unit: string): string => (unit === '₹ Cr' ? `₹${v.toLocaleString('en-US')} crore` : amountText({ value: v, unit }));
interface XCand { r: GuidanceExtractResult; row: ExtractedGuidance; growth: ExtractedGuidance | null; metric: GgMetric; period: string; date: string; notes: string[] }
export function itemsFromExtracted(results: GuidanceExtractResult[] | null | undefined, actuals: Map<string, PriorActual> | null, now: Date): Item[] {
  void now;
  const chains = new Map<string, XCand[]>();
  const rowImplausible = (r: GuidanceExtractResult, row: ExtractedGuidance, metric: GgMetric, period: string): boolean => {
    const u = universeUnitOf(row.currency, row.unit); if (!u || row.unit === '%' || row.metric === 'REVENUE_GROWTH') return false;
    const lo = row.low ?? row.high, hi = row.high ?? row.low; if (lo == null || hi == null) return false;
    const pp = priorPeriodOf(period); const tkr = (r.ticker || '').toUpperCase();
    const act = pp && tkr && (metric === 'REVENUE' || metric === 'PAT') ? actuals?.get(actualKey(r.market, tkr, metric, pp)) ?? null : null;
    if (!act || act.unit !== u || !(act.value > 0)) return false;
    return !!implausibleImplied({ gOrigin: 'IMPLIED', metric, low: (Math.min(lo, hi) / act.value - 1) * 100, high: (Math.max(lo, hi) / act.value - 1) * 100 });
  };
  for (const r of results || []) {
    if (!r || (r.market !== 'IN' && r.market !== 'US') || r.status !== 'ok' || !Array.isArray(r.rows)) continue;
    const date = String(r.filedAt || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rows = r.rows.filter((x) => x && (x.periodKind === 'ANNUAL' || x.periodKind === 'MULTI_YEAR') && x.status !== 'UNCLEAR');
    const hasAdj = new Set(rows.filter((x) => x.metric === 'ADJ_EPS').map((x) => xPeriod(x.period)));
    const per = new Map<string, XCand>();   // one candidate per metric + period in this document
    for (const row of rows) {
      let metric = X_METRIC[row.metric]; if (!metric) continue;
      // zzz920: a sentence about PAT / EBITDA / EPS filed as revenue moves to that metric; a "free cash flow" row about capex / debt / working capital is not guidance for it
      const reclass = metricFromQuote(row.metric, row.quote, row.metricLabel); if (reclass) metric = reclass;
      if (metric === 'FCF' && fcfIssueOf(row.quote, row.metricLabel)) continue;
      const period = xPeriod(row.period); if (!period) continue;
      if (row.metric === 'EPS' && hasAdj.has(period)) continue;   // GAAP and adjusted are never mixed: the adjusted line is the headline
      const k = `${metric}|${period}`; const cur = per.get(k);
      if (row.metric === 'REVENUE_GROWTH') {
        // zzz920: several growth rows for one period in a document — a named part (segment / plant) gives way to the company-wide one
        const rank = (x: ExtractedGuidance): number => scopeIssueOf(x.quote, { metric, market: r.market, currency: x.currency, metricLabel: x.metricLabel, company: r.company }) ? 2 : /\b(?:consolidated|overall|total|group|company[- ]level|blended)\b/i.test(`${x.metricLabel || ''} ${x.quote || ''}`) ? 0 : 1;
        if (cur) { if (cur.growth && rank(row) < rank(cur.growth)) cur.growth = row; else cur.growth = cur.growth ?? row; } else per.set(k, { r, row, growth: row, metric, period, date, notes: [] });
        continue;
      }
      if (cur && cur.row.metric === 'REVENUE_GROWTH') { cur.row = row; continue; }
      // zzz880: two rows for the same metric and period in one document — a figure that is implausible against last year's actual (a segment
      // line) gives way to a sensible one (Man Industries Aug: "₹35–50 Cr" and "about ₹5,000 crore" in the same call)
      if (cur && rowImplausible(r, cur.row, metric, period) && !rowImplausible(r, row, metric, period)) { cur.row = row; continue; }
      if (!cur) per.set(k, { r, row, growth: null, metric, period, date, notes: [] });
    }
    // companion figures that are not universe metrics (EBITDA margin) travel as a note on the same period's EBITDA, else revenue, point
    for (const row of rows.filter((x) => x.metric === 'EBITDA_MARGIN' && x.low != null)) {
      const period = xPeriod(row.period); const host = per.get(`EBITDA|${period}`) || per.get(`REVENUE|${period}`); if (!host) continue;
      const hi = row.high ?? row.low!; host.notes.push(`EBITDA margin ${row.low === hi ? `${fnum(row.low!)}%` : `${fnum(row.low!)}–${fnum(hi)}%`} (${period}, ${row.status === 'NEW' ? 'first stated' : row.status.toLowerCase()} in the same document)`);
    }
    const who = (r.ticker || '').trim().toUpperCase().replace(/\.(NS|BO)$/, '') || `~${normCompanyName(r.company)}`;
    for (const c of Array.from(per.values())) { const k = `${r.market}|${who}|${c.metric}|${c.period}`; (chains.get(k) || chains.set(k, []).get(k)!).push(c); }
  }
  const out: Item[] = [];
  for (let list of Array.from(chains.values())) {
    list.sort((a, b) => a.date.localeCompare(b.date) || String(a.r.extractedAt || '').localeCompare(String(b.r.extractedAt || '')));
    let cur: XCand | null = null; let priors: Prior[] = []; let lastVerified: string | null = null; let notes: string[] = []; let rev: GuUniverseRecord['revision'] | undefined;
    let withdrawn = false; let confirmed: NonNullable<Item['confirmedBy']> = [];
    const unitOf = (c: XCand) => universeUnitOf(c.row.currency, c.row.unit);
    const absOf = (c: XCand): { value: number; unit: string; valueLow?: number } | null => {
      const u = unitOf(c); if (!u || c.row.metric === 'REVENUE_GROWTH' || c.row.unit === '%') return null;
      const lo = c.row.low, hi = c.row.high ?? c.row.low; if (lo == null || hi == null) return null;
      return { value: Math.max(lo, hi), unit: u, ...(Math.min(lo, hi) < Math.max(lo, hi) ? { valueLow: Math.min(lo, hi) } : {}) };
    };
    // zzz880: a document whose amount implies an impossible change against last year's actual (a segment / partial figure) does not take
    // over the chain — the latest SENSIBLE figure stays current (Man Industries: Aug "₹35–50 Cr" vs May "₹5,000–5,500 Cr" for FY27).
    const implausibleCand = (c: XCand): boolean => {
      const a = absOf(c); if (!a) return false;
      const pp = priorPeriodOf(c.period); const tkr = (c.r.ticker || '').toUpperCase();
      const act = pp && tkr && (c.metric === 'REVENUE' || c.metric === 'PAT') ? actuals?.get(actualKey(c.r.market, tkr, c.metric, pp)) ?? null : null;
      if (!act || act.unit !== a.unit || !(act.value > 0)) return false;
      return !!implausibleImplied({ gOrigin: 'IMPLIED', metric: c.metric, low: ((a.valueLow ?? a.value) / act.value - 1) * 100, high: (a.value / act.value - 1) * 100 });
    };
    const sane = list.filter((c) => !implausibleCand(c));
    if (sane.length && sane.length < list.length) list = sane;
    const priorOf = (c: XCand): Prior => { const g = c.growth; const gl = g ? (g.growthPctLow ?? g.low ?? null) : (c.row.growthPctLow ?? null); const gh = g ? (g.growthPctHigh ?? g.high ?? gl) : (c.row.growthPctHigh ?? gl);
      return { date: c.date, low: gl, high: gh, note: `${DOC_NAME[c.r.docKind]?.name || 'Company document'} (${c.date})`, abs: absOf(c) }; };
    for (const c of list) {
      const st = c.row.status;
      if (st === 'WITHDRAWN') { if (cur) { withdrawn = true; lastVerified = c.date; notes.push(`withdrawn on ${c.date}`); } continue; }
      const abs = absOf(c); const ca = cur ? absOf(cur) : null;
      const inside = !!(abs && ca && abs.unit === ca.unit && (abs.valueLow ?? abs.value) >= (ca.valueLow ?? ca.value) - 1e-9 && abs.value <= ca.value + 1e-9);
      if (st === 'REITERATED' && cur && !withdrawn && (inside || (!abs && !ca))) {
        lastVerified = c.date; rev = 'MAINTAINED';
        if (abs && ca) {
          const single = (abs.valueLow ?? abs.value) === abs.value; const lo = ca.valueLow ?? ca.value;
          const where = ca.valueLow == null ? '' : single && abs.value === lo ? ' (lower end)' : single && abs.value === ca.value ? ' (upper end)' : single ? ' (within the range)' : abs.value === ca.value && (abs.valueLow ?? abs.value) === lo ? '' : ' (within the range)';
          notes.push(`reiterated ${single ? '~' : ''}${single ? crText(abs.value, abs.unit) : (abs.unit === '₹ Cr' ? `₹${(abs.valueLow as number).toLocaleString('en-US')}–${abs.value.toLocaleString('en-US')} crore` : amountText(abs))}${where} on ${c.date}`);
        } else notes.push(`reiterated on ${c.date}`);
        const dn = DOC_NAME[c.r.docKind] || DOC_NAME.OTHER_COMPANY_DOC; confirmed.push({ name: `${dn.name} (${c.r.company})`, type: dn.type, url: c.r.docUrl || null, date: c.date });
        continue;
      }
      // zzz880: a SEGMENT / geography figure is not the company's guide. A later figure below the current company guide (under 95% of its
      // low end) whose sentence talks about one business, unit or country is noted and skipped (Man Industries Aug: "with Saudi … around
      // ₹1,200 crores … India would be around ₹3,800 crores" — the two parts of the ₹5,000 Cr guide, not a cut to ₹3,800 Cr).
      if (cur && !withdrawn && abs && ca && abs.unit === ca.unit && abs.value < 0.95 * (ca.valueLow ?? ca.value) && SEGMENT_RE.test(String(c.row.quote || ''))) {
        notes.push(`a segment figure (${amountText(abs)}) in the ${c.date} document was not read as the company guide`);
        continue;
      }
      // a new figure (or a 'reiterated' figure outside the current range, read on its numbers)
      const hadCur = !!cur;
      if (cur) priors.push(priorOf(cur));
      else if (c.row.prior && (c.row.prior.low != null || c.row.prior.high != null) && (st === 'RAISED' || st === 'LOWERED' || st === 'NARROWED')) {
        const u = unitOf(c); const lo = c.row.prior.low ?? c.row.prior.high!, hi = c.row.prior.high ?? lo;
        priors.push({ date: c.date, low: null, high: null, note: `earlier guidance as stated in the ${DOC_NAME[c.r.docKind]?.name.toLowerCase() || 'company document'}${c.row.prior.statedIn ? ` (${c.row.prior.statedIn})` : ''}`, abs: u && c.row.unit !== '%' ? { value: Math.max(lo, hi), unit: u, ...(lo < hi ? { valueLow: lo } : {}) } : null });
      }
      cur = c; lastVerified = c.date; notes = []; withdrawn = false; confirmed = [];
      rev = st === 'NEW' ? (priors.length ? undefined : 'INITIAL') : st === 'RAISED' ? 'RAISED' : st === 'LOWERED' ? 'LOWERED' : st === 'REITERATED' ? (hadCur ? undefined : 'MAINTAINED') : undefined;
    }
    if (!cur) continue;
    const c = cur; const r = c.r; const row = c.row; const abs = absOf(c);
    const g = c.growth; const sLo = g ? (g.growthPctLow ?? (g.unit === '%' || g.metric === 'REVENUE_GROWTH' ? g.low : null)) : (row.growthPctLow ?? null);
    const sHi = g ? (g.growthPctHigh ?? (g.unit === '%' || g.metric === 'REVENUE_GROWTH' ? g.high ?? sLo : null)) : (row.growthPctHigh ?? sLo);
    let low: number | null = null, high: number | null = null; let gOrigin: GgGrowthOrigin = 'STATED'; let base: ItemBase | null = null; let growthNote: string | null = null;
    // zzz916: a horizon with no year named ("Next 2 years", "Long term (no fixed year)") is a multi-year RATE, like "FY25-29"
    const horizonPeriod = row.periodKind === 'MULTI_YEAR' && (nextYearsOf(c.period) != null || isOpenHorizonLabel(c.period));
    let pkind: GgPeriodKind = row.periodKind === 'ANNUAL' ? (/^CY/.test(c.period) ? 'CY' : 'FY') : (/^(FY|CY)\d{2}-\d{2}$/.test(c.period) || horizonPeriod) ? 'MULTI_YEAR_CAGR' : /^CY/.test(c.period) ? 'CY' : 'FY';
    let period = c.period;
    // zzz932: a one-year row takes its fiscal year from the sentence when the sentence names exactly one ("Increased FY27 revenue guidance … growth of 48% compared to FY26" was filed as FY26)
    if (pkind === 'FY' && /^FY\d{2}$/.test(c.period)) { const fy = fiscalYearNamedIn(String((g && g !== row ? g.quote : null) || row.quote || '')); if (fy && fy !== c.period) period = fy; }
    const ny = /^(?:FY|CY)(\d{2})-(\d{2})$/.exec(c.period); const years = ny ? parseInt(ny[2], 10) - parseInt(ny[1], 10) + 1 : (nextYearsOf(c.period) ?? null);
    const gq = String((g && g !== row ? g.quote : null) || row.quote || '');
    const statementQuote = String((sLo != null && g && g !== row && g.quote ? g.quote : row.quote) || '');
    let needsReview: string | null = null;
    let cagrFromBase: Item['cagrFromBase'] = null; let baseStatedByCompany = false;
    let open = false;
    if (sLo != null) {
      low = sLo; high = sHi ?? sLo;
      // zzz916: "30%+", "at least 30%", "minimum 35%" — a floor, shown as "+30%+" and compared on its lower bound
      const rawHi = g ? (g.growthPctHigh ?? (g.unit === '%' || g.metric === 'REVENUE_GROWTH' ? g.high : null)) : row.growthPctHigh;
      open = (rawHi == null || rawHi === sLo) && isLowBoundOnly(gq, sLo);
      if (open) high = sLo;
    }
    else if (abs && pkind !== 'MULTI_YEAR_CAGR') {
      const pp = priorPeriodOf(c.period); const tkr = (r.ticker || '').toUpperCase();
      const act = pp && tkr && (c.metric === 'REVENUE' || c.metric === 'PAT') ? actuals?.get(actualKey(r.market, tkr, c.metric, pp)) ?? null : null;
      // zzz916: a target two or more years out ("₹2,000 Cr by FY29") is not one year's growth: set it against an earlier stated base and
      // work out the yearly rate (CAGR), labelled "worked out from company numbers". Base, in order: the document's own figure for an earlier
      // year; the last completed year's reported actual; "doubling / tripling" from the last completed year.
      const lc = !act && r.market === 'IN' ? baseFyFor(c.period, r.filedAt) : null;
      const yT = /^FY(\d{2})$/.exec(c.period);
      if (act && act.unit === abs.unit && act.value > 0) {
        gOrigin = 'IMPLIED'; base = { value: act.value, unit: act.unit, period: act.period, kind: 'PRIOR_YEAR_ACTUAL' }; baseStatedByCompany = !!act.quote;   // zzz916: both figures in the company's own words
        low = ((abs.valueLow ?? abs.value) / act.value - 1) * 100; high = (abs.value / act.value - 1) * 100;
        notes.unshift(`${act.period} actual ${amountText({ value: act.value, unit: act.unit })} from ${act.source}${act.quote ? `: "${act.quote.slice(0, 160)}"` : ''}`);
      } else if (lc && yT && (c.metric === 'REVENUE' || c.metric === 'PAT')) {
        const yTarget = parseInt(yT[1], 10);
        const own = row.priorActual && universeUnitOf(row.currency, row.unit) === abs.unit && /^FY\s?(?:20)?\d{2}$/i.test(row.priorActual.period) ? row.priorActual : null;
        const ownY = own ? parseInt(own.period.replace(/\D/g, '').slice(-2), 10) : null;
        const tkr = (r.ticker || '').toUpperCase();
        const res = tkr ? actuals?.get(actualKey(r.market, tkr, c.metric, lc)) ?? null : null;
        const k = multipleOf(row.quote);
        let b: { value: number; year: number; how: 'document' | 'results' | 'multiple'; text: string } | null = null;
        if (own && ownY != null && ownY < yTarget && own.value > 0) b = { value: own.value, year: ownY, how: 'document', text: `FY${String(ownY).padStart(2, '0')} ${amountText({ value: own.value, unit: abs.unit })} stated in the same document` };
        else if (res && res.unit === abs.unit && res.value > 0) b = { value: res.value, year: parseInt(lc.slice(2), 10), how: 'results', text: `${lc} actual ${amountText({ value: res.value, unit: res.unit })} (${res.source})` };
        else if (k && k > 1) b = { value: abs.value / k, year: parseInt(lc.slice(2), 10), how: 'multiple', text: `${k === 2 ? 'doubling' : `${k}x`} from the ${lc} level (about ${amountText({ value: Math.round(abs.value / k), unit: abs.unit })})` };
        const n = b ? yTarget - b.year : 0;
        const lo = b ? cagrPct(abs.valueLow ?? abs.value, b.value, n) : null; const hi = b ? cagrPct(abs.value, b.value, n) : null;
        if (b && lo != null && hi != null && n >= 2) {
          gOrigin = 'IMPLIED'; low = lo; high = hi; pkind = 'MULTI_YEAR_CAGR';
          period = `FY${String(b.year).padStart(2, '0')}-${String(yTarget).padStart(2, '0')}`;
          base = { value: b.value, unit: abs.unit, period: `FY${String(b.year).padStart(2, '0')}`, kind: 'PRIOR_YEAR_ACTUAL' };
          cagrFromBase = { years: n, targetPeriod: c.period, how: b.how, baseText: b.text };
          notes.unshift(`worked out from company numbers: ${amountText(abs)} by ${c.period} against ${b.text} is about ${fnum(lo)}${lo !== hi ? `–${fnum(hi)}` : ''}% a year over ${n} years`);
        } else growthNote = `growth not established: no ${pp || 'prior-year'} actual available`;
      } else growthNote = `growth not established: no ${pp || 'prior-year'} actual available`;
    } else if (!abs) continue;   // neither a % nor an amount the universe can place (unit not recognised)
    else growthNote = 'growth not established';
    // zzz931: a single-year row whose sentence states a CAGR to a year two or more years out ("₹1,000 Cr+ by FY32, implying a 30–35% CAGR")
    // is a multi-year yearly rate, not one year's growth (Hardwyn showed "+30–35% FY32" as a one-year figure)
    if (sLo != null && (pkind === 'FY' || pkind === 'CY') && /\bcagr\b/i.test(gq)) {
      const yT = /^FY(\d{2})$/.exec(period); const lc = lastCompletedFy(c.date);
      if (yT && lc != null && parseInt(yT[1], 10) - lc >= 2) { pkind = 'MULTI_YEAR_CAGR'; period = `FY${String(lc + 1).padStart(2, '0')}-${yT[1]}`; }   // the page's convention: FY27-32 = six growth years FY27…FY32
    }
    // zzz931: a TOTAL change over several years ("double in next 3 years", "doubling over the next four to five years", "grow 50% over 3
    // years") was shown as that total a year (+100% a year). It becomes the yearly rate, labelled as worked out from the company's words.
    if (sLo != null && pkind === 'MULTI_YEAR_CAGR') {
      const t = totalToAnnual(gq, sLo, sHi ?? sLo, period);
      if (t) {
        gOrigin = 'IMPLIED'; low = t.low; high = t.high; open = false;
        cagrFromBase = { years: t.years, yearsMin: t.yearsMin, targetPeriod: period, how: 'total', baseText: t.phrase };
        notes.unshift(`worked out from the company's words: "${t.phrase}" is ${t.kind === 'multiple' ? `${t.factor}x` : `+${fnum(sLo)}${sHi != null && sHi !== sLo ? `–${fnum(sHi)}` : ''}%`} in total over ${t.yearsMin !== t.years ? `${t.yearsMin}–${t.years}` : t.years} years, about ${fnum(t.low)}${t.low !== t.high ? `–${fnum(t.high)}` : ''}% a year`);
      }
    }
    // zzz895: a STATED growth must be in the quoted sentence, be one year's growth, and be about the metric it is filed under
    if (sLo != null) {
      // the number test applies when the row IS the growth figure (a % row); a growth % attached to an amount row is checked for period and metric only
      // zzz916: "double" / "triple" stand for +100% / +200%
      const isPctRow = !!g && (g.unit === '%' || g.metric === 'REVENUE_GROWTH');
      const k = multipleOf(gq); const byMultiple = k != null && Math.abs(sLo - (k - 1) * 100) < 1e-6;
      if (growthQuoteIssue(gq, sLo, sHi ?? sLo, c.metric, { annual: pkind !== 'MULTI_YEAR_CAGR', numberCheck: isPctRow && !byMultiple, rateCheck: isPctRow })) continue;
      // zzz916: "30-35% over the next 2 years" with no "a year / CAGR / annually" — yearly rate or total? kept, labelled, never ranked
      if (horizonPeriod && !perYearStated(gq) && !byMultiple && cagrFromBase?.how !== 'total') needsReview = `The company gives ${fnum(sLo)}${sHi != null && sHi !== sLo ? `–${fnum(sHi)}` : ''}% ${isOpenHorizonLabel(c.period) ? `over the ${c.period.replace(/ \(no fixed year\)$/, '').toLowerCase()}` : `over the ${c.period.toLowerCase()}`} without saying whether that is a yearly rate or the total, so it is kept for review and not ranked.`;
    }
    // zzz916: a segment / subsidiary / brand / geography figure, or a foreign-currency figure from an Indian company, is not the company's own
    // guidance: kept for review with the reason, never shown or ranked as company revenue / profit. A figure for another measure (AUM, volume,
    // stores, bookings, advances) or a quarter-on-quarter rate filed as revenue / profit is not company guidance at all: dropped.
    const scope = scopeIssueOf(statementQuote, { metric: c.metric, market: r.market, currency: row.currency, metricLabel: row.metricLabel, company: r.company });
    // zzz931: a blank-cheque company (SPAC) projects the TARGET it plans to merge with; that is not its own guidance (Hall Chadwick Acquisition Corp)
    const spac = spacIssueOf(r.company, statementQuote);
    if (spac) needsReview = `Not the company's own guidance: ${spac}.`;
    if (scope) {
      if (/^one part of the company|figure from an Indian company/.test(scope)) needsReview = `Not the company-wide figure: ${scope}.`;
      else continue;
    }
    const dn = DOC_NAME[r.docKind] || DOC_NAME.OTHER_COMPANY_DOC;
    const ticker = (r.ticker || '').trim().toUpperCase().replace(/\.(NS|BO)$/, '') || null;
    const statement = statementQuote.slice(0, 300);
    out.push({
      origin: 'COMPANY_DOC', market: r.market, ticker, company: r.company || ticker || 'Unknown company', metric: c.metric, low, high, open, gOrigin, abs, base, needsReview,
      cumulativeYears: pkind === 'MULTI_YEAR_CAGR' && sLo == null && !cagrFromBase ? years : cagrFromBase ? cagrFromBase.years : null,
      period, pkind, kind: 'MANAGEMENT_GUIDANCE', organic: 'UNKNOWN', statement, driver: null, mechanisms: [],
      src: { name: `${dn.name} (${r.company})`, type: dn.type, url: r.docUrl || null, date: c.date, rank: 4 }, verification: 'VERIFIED', priors,
      notes: [...c.notes, ...notes].join('; ') || null, withdrawn, forced: withdrawn ? 'WITHDRAWN' : undefined,
      primarySourceRead: true, sourceMetricLabel: row.metric === 'REVENUE_GROWTH' ? null : row.metricLabel || null, lastVerified, extRevision: rev, growthNote, confirmedBy: confirmed,
      periodContext: null, cagrFromBase, baseStatedByCompany,
    });
  }
  return out;
}

/** Pure: the next stored document. Same slot (market|entity|metric|period) is replaced by the fresh point; expired slots are dropped; bounded; newest first. Returns changed=false when nothing differs (idempotent write). */
export function mergeStored(existing: GuStoredDoc | null | undefined, fresh: GuStoredPoint[], now: Date, asOf = now.toISOString()): { doc: GuStoredDoc; changed: boolean } {
  const bySlot = new Map<string, GuStoredPoint>();
  for (const r of existing?.rows || []) {
    if (!r?.slot) continue;
    const e = periodEnd(r.period, r.market, r.src?.date).end; if (e && e.getTime() < now.getTime()) continue;
    bySlot.set(r.slot, r);
  }
  for (const r of fresh) bySlot.set(r.slot, r);
  const rows = Array.from(bySlot.values()).sort((a, b) => (b.src.date || '').localeCompare(a.src.date || '') || a.key.localeCompare(b.key)).slice(0, GU_MAX_STORED);
  const h = hash(rows.map((r) => r.key).sort().join(','));
  return { doc: { v: 1, asOf, hash: h, rows }, changed: h !== existing?.hash };
}

// ═══ entity resolution ═════════════════════════════════════════════════════════════════════════
const GENERIC = new Set(['india', 'indian', 'bank', 'group', 'global', 'power', 'steel', 'gold', 'energy', 'capital', 'finance', 'industries', 'international', 'technologies', 'company', 'holdings', 'infra', 'enterprises', 'foods', 'oil', 'gas', 'green', 'new', 'first', 'national', 'united']);
class Entities {
  private parent = new Map<string, string>(); private ticker = new Map<string, string | null>();
  private find(x: string): string { let r = x; while (this.parent.get(r) !== r) r = this.parent.get(r)!; let c = x; while (this.parent.get(c) !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; } return r; }
  add(x: string) { if (!this.parent.has(x)) { this.parent.set(x, x); this.ticker.set(x, x.startsWith('T|') ? x.split('|')[2] : null); } }
  union(a: string, b: string): boolean {
    this.add(a); this.add(b); const ra = this.find(a), rb = this.find(b); if (ra === rb) return true;
    const ta = this.ticker.get(ra), tb = this.ticker.get(rb); if (ta && tb && ta !== tb) return false;   // two different tickers are never merged
    this.parent.set(rb, ra); this.ticker.set(ra, ta || tb || null); return true;
  }
  root(x: string): string { this.add(x); return this.find(x); }
  tickerOf(root: string): string | null { return this.ticker.get(root) ?? null; }
}
const nKey = (m: string, name: string) => `N|${m}|${normCompanyName(name)}`;
const tKey = (m: string, t: string) => `T|${m}|${t}`;
/** true when a and b differ by at most one inserted, deleted or substituted letter (and are not equal) */
function editDistanceLe1(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
function resolveEntities(items: Item[]): Map<Item, string> {
  const E = new Entities();
  const names = NSE_TICKER_NAMES as Record<string, string>;
  const idx = buildCompanyIndex([...Object.entries(names).map(([symbol, name]) => ({ symbol, name })), ...items.filter((i) => i.market === 'IN' && i.ticker).map((i) => ({ symbol: i.ticker, name: i.company }))]);
  for (const it of items) { E.add(nKey(it.market, it.company)); if (it.ticker) E.add(tKey(it.market, it.ticker)); }
  // 1. ticker <-> name from the item itself, and from the curated ticker map
  for (const it of items) {
    if (it.ticker) { E.union(tKey(it.market, it.ticker), nKey(it.market, it.company)); const cn = names[it.ticker]; if (it.market === 'IN' && cn) E.union(tKey(it.market, it.ticker), nKey(it.market, cn)); }
  }
  // 2. a name that is itself a known ticker ('KRN'), or a name the company index knows
  for (const it of items) {
    if (it.ticker || it.market !== 'IN') continue;
    const k = normCompanyName(it.company); const up = it.company.trim().toUpperCase();
    if (idx.known.has(up)) { E.union(nKey(it.market, it.company), tKey(it.market, up)); continue; }
    const sym = idx.names.get(k); if (sym) E.union(nKey(it.market, it.company), tKey(it.market, sym));
  }
  // 2b. '(KMEW)' in the name, or a spaced short name ('Ross Tech' -> ROSSTECH): the token is a known ticker
  for (const it of items) {
    if (it.market !== 'IN') continue;
    const par = /\(([A-Za-z0-9&-]{2,15})\)/.exec(it.company); const tokens = [par ? par[1].toUpperCase() : '', it.company.replace(/\(.*?\)/g, '').replace(/[^A-Za-z0-9&]/g, '').toUpperCase()].filter(Boolean);
    for (const tkn of tokens) if (idx.known.has(tkn) && (!it.ticker || it.ticker === tkn)) { E.union(nKey(it.market, it.company), tKey(it.market, tkn)); break; }
  }
  // 3. word-prefix aliases ('syrma sgs' / 'syrma sgs technology'): only when the short name prefixes exactly one longer name
  for (const m of ['IN', 'US']) {
    const ns = Array.from(new Set(items.filter((i) => i.market === m).map((i) => normCompanyName(i.company)).filter(Boolean)));
    for (const s of ns) {
      if (s.length < 4 || (!s.includes(' ') && GENERIC.has(s))) continue;
      const longer = ns.filter((l) => l !== s && l.startsWith(`${s} `));
      if (longer.length === 1) E.union(`N|${m}|${s}`, `N|${m}|${longer[0]}`);
    }
  }
  // 4. one-letter spelling variants of a long name ('krishana phoschem' / 'krishna phoschem'): same market, never across two different tickers
  for (const m of ['IN', 'US']) {
    const ns = Array.from(new Set(items.filter((i) => i.market === m).map((i) => normCompanyName(i.company)).filter((n) => n.length >= 10)));
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (Math.abs(ns[i].length - ns[j].length) <= 1 && editDistanceLe1(ns[i], ns[j])) E.union(`N|${m}|${ns[i]}`, `N|${m}|${ns[j]}`);
  }
  const out = new Map<Item, string>();
  for (const it of items) { const r = E.root(it.ticker ? tKey(it.market, it.ticker) : nKey(it.market, it.company)); const t = E.tickerOf(r); out.set(it, `${it.market}:${t || r.replace(/^N\|[A-Z]+\|/, '~')}`); }
  return out;
}

// ═══ record shapes ═════════════════════════════════════════════════════════════════════════════
export interface GuPoint {
  metric: GgMetric; period: string; periodKind: GgPeriodKind; display: string; low: number | null; high: number | null; open: boolean; implied: boolean; compareValue: number | null; counted: boolean;
  verification: GgVerification; origin: GuUniverseRecordOrigin; sourceName: string; sourceType: string; sourceUrl: string | null; sourceDate: string | null; sourceRank: number; primarySource: boolean;
  revision: GuUniverseRecord['revision']; proxy: string | null; statement: string; notes: string | null;
  priors: Prior[]; absolute: { value: number; unit: string; valueLow?: number } | null;
  // ── zzz849 (additive) ──
  /** RUN STATE of the guided period (zzz853: renamed from `periodStatus`): ACTIVE = still running, EXPIRED, UNKNOWN = cannot be placed in time. Expiry may use the issue date; it never confirms a period. */
  periodRunState: GuPeriodStatus; periodInferred: boolean; periodNote: string | null; periodEnd: string | null;
  /** growth as management stated it (null when only a target amount was stated) */
  statedGrowth: { low: number; high: number | null; open: boolean; display: string } | null;
  /** growth worked out from a target amount and a sourced base. Secondary when statedGrowth exists; primary (and labelled '(implied)') otherwise. */
  impliedGrowth: { low: number; high: number | null; display: string; base: { value: number; unit: string; period: string } | null; baseLabel: string | null } | null;
  /** display of the implied figure including its base, e.g. '+102.7–109.7% (implied, base FY26 revenue ₹357.71 Cr)' */
  impliedDisplay: string | null;
  /** when management stated a % AND an implied figure exists, the implied one as a secondary line */
  secondaryDisplay: string | null;
  /** why an implied % was dropped (quarter target vs full-year base, no target amount ...); the display then shows the amount only */
  impliedRejected: string | null;
  /** why the point is flagged 'needs review' (implausible growth, unsourced base, researcher flag). Flagged points are never counted. */
  needsReview: string | null;
  /** high-growth class when every rule except the threshold passes: single-year, or explicit multi-year CAGR */
  hg: GuHighGrowthHorizon | null;
  /** passes every high-growth rule except verification (only media backs it) */
  awaitingVerification: boolean;
  // ── zzz853 (additive): growth basis ──
  /** EXPLICIT = company stated the %. DERIVED = company stated amounts and the system computed the growth from a sourced base. IMPLIED = inferred, no sourced base. UNKNOWN = no usable growth. */
  growthType: GuGrowthType;
  guidanceType: GuGuidanceType;
  /** the target is a range (a % range or an amount range) */ isRange: boolean;
  /** 'stated_by_company' | 'absolute_vs_prior_year_actual' | 'absolute_vs_prior_guidance' | 'inferred_no_sourced_base' | null */ growthBasis: string | null;
  /** ready text for the basis, e.g. 'vs FY26 actual (derived: ₹210–225 Cr vs ₹108.23 Cr)' */ basisLabel: string;
  /** every number behind a DERIVED growth (previous value, current low/high, growth low/mid/high, basis) */ growthDerivation: GuGrowthDerivation | null;
  /** exact (unrounded) growth kept internally; the display rounds by rule */ growthExact: { low: number; mid: number; high: number } | null;
  /** growth against the PRIOR-YEAR ACTUAL (separate fact from the revision vs prior guidance) */ growthVsPriorYear: GuGrowthVsPriorYear | null;
  /** the move against the PRIOR GUIDANCE, when an earlier guidance value exists (never overwrites growthVsPriorYear) */ revisionVsPriorGuidance: GuRevisionVsPrior | null;
  /** false when currency / unit scale / period basis differ: growth is not computed ('GROWTH NOT COMPARABLE') */ growthComparable: boolean; growthNotComparable: string | null;
  headlineBasis: 'GROWTH_VS_PRIOR_YEAR' | 'ABSOLUTE_TARGET_ONLY';
  // verification
  verificationState: GuVerificationState; verificationReason: string; claimType: GuClaimType;
  sourceTier: SourceTier; sourceTierLabel: string; primarySourceFound: boolean; primarySourceRead: boolean; primarySourceText: 'PRIMARY SOURCE FOUND' | 'primary source not found'; primarySourceReadText: 'primary source read' | 'primary source not yet read';
  // period
  periodLabelSource: string; periodNormalized: string; fiscalYear: number | null; fiscalYearStart: number | null; fiscalQuarter: number | null;
  /** CONFIRMED | UNCLEAR | UNKNOWN: is the period itself established by the source record? */ periodStatus: GuPeriodConfirm;
  durationType: GuDurationType; cohort: GuCohort | null;
  // metric
  metricFamily: GuMetricFamily; sourceMetricLabel: string | null; currency: string | null; unit: string | null; scale: string | null;
  // lifecycle, history, freshness
  status: GuLifecycle; current: boolean; expiryReason: string | null; history: GuHistoryStep[];
  lastVerified: string | null; lastVerifiedDaysAgo: number | null; staleVerification: boolean;
  // sources
  sources: GuSourceEntry[]; sourceConflict: boolean; primaryValue: GuSourceEntry | null; mediaClaim: GuSourceEntry | null;
  /** per-point review reasons (blocking ones keep the point out of the default view) */ reviewReasons: GuReviewReasonX[];
  inDefaultView: boolean;
  // ── zzz854 (additive) ──
  /** ACTIVE (verified / derived / partial with the company document read) | REVIEW | CLAIMS (awaiting verification; never ranked in Active) */ listBucket: GuListBucket;
  /** why the point is a claim awaiting verification (secondary source only, document not read, last verified unknown ...), else null */ awaitingVerificationReason: string | null;
  /** zzz860: HOW the number was got (explicit / derived / implied / amount_only / range), kept apart from verificationStatus */ calculationType: GuCalculationType;
  /** zzz860: HOW SURE we are (unverified / secondary_only / primary_verified / partly_verified / contradicted / stale) */ verificationStatus: GuVerificationStatus;
  /** zzz860: one freshness rule for every badge, count and list */ freshness: GuFreshnessTier;
  /** zzz860: the sentence that says where the figure comes from ('Company stated' only when the company's own document was read) */ wording: string;
  /** zzz860: what a change is (set only when an earlier figure for the same company + metric + period + basis exists) */ eventType: GuEventType | null;
  /** set when a newer primary-source event disagrees with this point (the event wins) */ eventOverride: GuEventOverride | null;
  /** the newest event (Layer B) for the same company + metric + period, verified or not */ latestEvent: GuEventStatus | null;
}
export interface GuUniverseRecordX extends GuUniverseRecord {
  entityKey: string; tickers: string[]; names: string[]; period: string;
  /** ANNUAL (FY/CY/12M), MULTI_YEAR (CAGR), SHORT_PERIOD (quarter/half), UNKNOWN_PERIOD */
  classification: 'ANNUAL' | 'MULTI_YEAR' | 'SHORT_PERIOD' | 'UNKNOWN_PERIOD';
  points: GuPoint[];
  sourceName: string; sourceType: string; sourceUrl: string | null; sourceDate: string | null; sourceRank: number; primarySource: boolean;
  statement: string; notes: string | null; activeNote: string | null;
  /** zzz849: status of the headline point's period, why it is flagged, and the secondary (implied) figure when management also stated a % */
  /** zzz853: CONFIRMED | UNCLEAR | UNKNOWN (the earlier running state is `periodRunState`) */ periodStatus: GuPeriodConfirm; periodRunState: GuPeriodStatus;
  needsReview: string | null; secondaryDisplay: string | null; impliedDisplay: string | null;
  // ── zzz853 (additive), all taken from the headline point ──
  /** stable id of the resolved company (market:TICKER); null when the company is not resolved */ companyId: string | null; tickerResolved: boolean;
  status: GuLifecycle; current: boolean;
  verificationState: GuVerificationState; growthType: GuGrowthType; guidanceType: GuGuidanceType; claimType: GuClaimType; metricFamily: GuMetricFamily;
  sourceTier: SourceTier; primarySourceFound: boolean; primarySourceRead: boolean; primarySourceText: string;
  basisLabel: string; growthVsPriorYear: GuGrowthVsPriorYear | null; revisionVsPriorGuidance: GuRevisionVsPrior | null;
  fiscalYear: number | null; fiscalQuarter: number | null; periodLabelSource: string; periodNormalized: string; durationType: GuDurationType; cohort: GuCohort | null;
  history: GuHistoryStep[]; lastVerified: string | null; lastVerifiedDaysAgo: number | null; staleVerification: boolean;
  sources: GuSourceEntry[]; sourceConflict: boolean; primaryValue: GuSourceEntry | null; mediaClaim: GuSourceEntry | null;
  /** empty for a default-view record; for a review-queue record the reasons it is there (plus the informational ones) */ reviewReasons: string[]; reviewReasonCodes: string[]; inReviewQueue: boolean;
  /** informational notes that do NOT keep a record out of the default view (secondary-only, primary not found, stale verification ...) */ caveats: string[];
  /** zzz854: which list this record object belongs to (a company with points in two lists has one record object per list) */ listBucket: GuListBucket;
  /** zzz860: from the headline point */ calculationType: GuCalculationType; verificationStatus: GuVerificationStatus; freshness: GuFreshnessTier; wording: string;
  /** zzz854: headline point's event override / newest matching event (see GuPoint) */ eventOverride: GuEventOverride | null; latestEvent: GuEventStatus | null;
}
export interface GuInactiveRecord {
  entityKey: string; company: string; ticker: string | null; market: 'IN' | 'US'; metric: GgMetric; period: string; status: Inactive; reason: string; display: string; verification: GgVerification; sourceName: string; sourceDate: string | null; origin: GuUniverseRecordOrigin;
  /** zzz853: auditable expiry: 'period completed' | 'superseded' | 'withdrawn' */ expiryReason: string; lifecycle: GuLifecycle; current: false; periodEnd: string | null; supersededBy: string | null;
}
export interface GuExcluded { company: string; ticker: string | null; market: 'IN' | 'US'; metric: GgMetric; period: string; reason: string; /** zzz853 */ claimType?: GuClaimType }
export interface GuUniverseBuild {
  /** every active record (legacy shape: one per company with all its points) */ records: GuUniverseRecordX[]; inactive: GuInactiveRecord[]; excluded: GuExcluded[]; stored: GuStoredPoint[];
  /** zzz853: the DEFAULT VIEW: active + company resolved + period CONFIRMED + not needsReview (per point) */ defaultRecords: GuUniverseRecordX[];
  /** zzz853: everything else that is active, each with reviewReasons[] */ reviewQueue: GuUniverseRecordX[];
  /** zzz854: claims awaiting verification (media / social / document not read / last verified unknown). Never in the Active list or its counts. Absent in older stored builds. */
  claimsAwaiting?: GuUniverseRecordX[];
}
/** `eventWindow` is accepted and IGNORED: the universe never depends on an event window (24H/3D/7D...). */
export interface GuBuildOpts { threshold?: number; eventWindow?: string | null; /** zzz854: what the events layer says per company + metric + period (newest wins) */ eventStatuses?: GuEventStatus[] | null;
  /** zzz857: AI-extracted, quote-checked rows from the companies' own documents, plus the prior-year actuals a derived growth is divided by */
  extracted?: { results: GuidanceExtractResult[]; actuals?: Map<string, PriorActual> | null } | null }

const dateOf = (i: Item) => i.src.date || '';
const ORIGIN_ORDER: Record<GuUniverseRecordOrigin, number> = { COMPANY_DOC: 0, LIVE: 1, LEDGER: 2, RESEARCHED_SEED: 3 };
/** >0 when a should win over b (a is the current guidance). Live/ledger beat a researched row when newer-or-equal OR from a higher-ranked source. Otherwise newest wins, then rank. */
function better(a: Item, b: Item): number {
  // zzz857: the company's own document (AI-read, quote-checked) always beats a media / secondary (TIER3-4) source for the same slot
  const aDoc = a.origin === 'COMPANY_DOC', bDoc = b.origin === 'COMPANY_DOC';
  if (aDoc !== bDoc) { const other = aDoc ? b : a; if (tierOf(other) >= 3) return aDoc ? 1 : -1; }
  const aSeed = a.origin === 'RESEARCHED_SEED', bSeed = b.origin === 'RESEARCHED_SEED';
  if (aSeed !== bSeed) {
    const nonSeed = aSeed ? b : a, seed = aSeed ? a : b;
    const nsWins = dateOf(nonSeed) >= dateOf(seed) || nonSeed.src.rank < seed.src.rank;
    return (nsWins ? nonSeed : seed) === a ? 1 : -1;
  }
  if (dateOf(a) !== dateOf(b)) return dateOf(a) > dateOf(b) ? 1 : -1;
  const aS = a.gOrigin === 'STATED' && a.low != null, bS = b.gOrigin === 'STATED' && b.low != null;
  if (aS !== bS) return aS ? 1 : -1;   // the same day: a stated % beats a worked-out one
  if (a.src.rank !== b.src.rank) return a.src.rank < b.src.rank ? 1 : -1;
  if (a.origin !== b.origin) return ORIGIN_ORDER[a.origin] < ORIGIN_ORDER[b.origin] ? 1 : -1;
  return 0;
}
const mid = (low: number | null, high: number | null): number | null => (low == null ? null : high == null ? low : (low + high) / 2);
const REVISION_UP = /\b(raised|upgraded|hiked|lifted|increased)\b/i, REVISION_DOWN = /\b(lowered|cut|trimmed|reduced|slashed|downgraded)\b/i, REVISION_SAME = /\b(reiterat\w*|maintain\w*|unchanged|reaffirm\w*)\b/i, GUIDE_CTX = /\b(guid\w*|target\w*|outlook|forecast\w*|expect\w*)\b/i;
function revisionFor(it: Item, history: Prior[]): GuUniverseRecord['revision'] {
  if (it.extRevision) return it.extRevision;   // zzz857: the company document's own status (NEW / RAISED / REITERATED / LOWERED / WITHDRAWN)
  const stmt = it.statement || '';
  /** A reiteration or a capital raise is never a RAISE of guidance (unless the numbers themselves moved up). */
  const noRaiseWords = (isCapitalRaise(stmt) || (isReiteration(stmt))) && !textSaysGuidanceRaised(stmt);
  const cur = mid(it.low, it.high);
  const priors = history.filter((p) => p.low != null).sort((a, b) => a.date.localeCompare(b.date));
  const last = priors[priors.length - 1];
  const numeric = cur != null && last ? revisionOf(mid(last.low, last.high), cur, false) : null;
  if (it.gc && it.isPrimary) {
    const r = it.gc.revision;
    if (r === 'RAISED' && noRaiseWords && numeric !== 'RAISED') return isCapitalRaise(stmt) && !isReiteration(stmt) ? 'NONE' : 'MAINTAINED';
    if (r === 'RAISED' || r === 'MAINTAINED' || r === 'LOWERED' || r === 'WITHDRAWN' || r === 'INITIAL') return r;
  }
  if (numeric === 'RAISED' || numeric === 'LOWERED' || numeric === 'MAINTAINED') return numeric;
  if (GUIDE_CTX.test(stmt)) {
    if (REVISION_DOWN.test(stmt)) return 'LOWERED';
    if (isReiteration(stmt) && !textSaysGuidanceRaised(stmt)) return 'MAINTAINED';
    if (REVISION_UP.test(stmt) && !isCapitalRaise(stmt)) return 'RAISED';
    if (textSaysGuidanceRaised(stmt)) return 'RAISED';
    if (REVISION_SAME.test(stmt)) return 'MAINTAINED';
  }
  return it.gc && it.isPrimary && it.gc.revision === 'INITIAL' ? 'INITIAL' : 'NONE';
}
const classOf = (k: GgPeriodKind): GuUniverseRecordX['classification'] => (k === 'MULTI_YEAR_CAGR' ? 'MULTI_YEAR' : k === 'QUARTER' || k === 'HALF' ? 'SHORT_PERIOD' : k === 'UNKNOWN' ? 'UNKNOWN_PERIOD' : 'ANNUAL');
const ANNUAL_COUNTABLE: GgPeriodKind[] = ['FY', 'CY', 'ROLLING_12M'];
const srcRefOf = (it: Item): GgSourceRef => ({ name: it.src.name, rank: it.src.rank, type: it.src.type, date: it.src.date, url: it.src.url || undefined, primary: srcPrimary(it.src.rank, it.src.type) });

const lenOfKind = (k: GgPeriodKind): number | null => (k === 'FY' || k === 'CY' || k === 'ROLLING_12M' ? 12 : k === 'QUARTER' ? 3 : k === 'HALF' ? 6 : null);
const lenOfPeriod = (p: string): number | null => { const n = normPeriod(p); return /^Q[1-4]\b/.test(n) ? 3 : /^H[12]\b/.test(n) ? 6 : /^(FY|CY)\d{2}$/.test(n) || /^(prior|previous|last) year$/i.test(n) || /^(19|20)\d{2}$/.test(n) ? 12 : null; };
const baseText = (b: { value: number; unit: string; period: string }, metric: GgMetric) => `${b.period} ${METRIC_WORD[metric]} ${amountText({ value: b.value, unit: b.unit })}`;
const figureIn = (statement: string, n: number): boolean => new RegExp(`(?:^|[^0-9.])${esc(String(Math.abs(n)))}(?:\\.0)?\\s*(?:%|per ?cent|percent|-|–|to\\b|\\+)`, 'i').test(statement);

/** Like-for-like check for an implied growth %. reject = drop the % and show the amount only; review = keep it but flag it and never count it. */
function impliedCheck(it: Item): { reject?: string; review?: string } {
  if (it.cagrFromBase && ((it.abs && it.base) || it.cagrFromBase.how === 'total')) return {};   // zzz916 / zzz931: a yearly rate worked out over several years (checked where it was built)
  const tl = lenOfKind(it.pkind);
  if (tl == null) return { reject: `Implied growth dropped: the target period (${it.period}) is not a single year, half or quarter, so it cannot be set against a one-period base.` };
  if (!it.abs) return { reject: 'Implied growth dropped: there is no stated target amount to work it out from.' };
  const b = it.base;
  if (!b) return { review: 'Implied growth has no sourced base (base amount and period were not recorded), so it is not counted.' };
  const bl = lenOfPeriod(b.period);
  if (bl != null && bl !== tl) return { reject: `Implied growth dropped: a ${tl}-month ${it.period} target cannot be divided by a ${bl}-month base (${b.period}).` };
  if (b.unit && it.abs.unit && b.unit !== it.abs.unit) return { reject: `Implied growth dropped: the target is in ${it.abs.unit} but the base is in ${b.unit}.` };
  if (it.low != null && it.low === it.high && it.abs.valueLow == null) {
    const calc = (it.abs.value / b.value - 1) * 100;
    if (Math.abs(calc - it.low) > 0.6) return { review: `Stored growth (${fnum(it.low)}%) does not match the target amount divided by the base (${fnum(calc)}%).` };
  } else if (it.low != null && it.abs.valueLow != null) {
    const lo = (it.abs.valueLow / b.value - 1) * 100, hi = (it.abs.value / b.value - 1) * 100;
    if (Math.abs(lo - it.low) > 0.6 || Math.abs(hi - (it.high ?? it.low)) > 0.6) return { review: `Stored growth range does not match the target range divided by the base (${fnum(lo)}–${fnum(hi)}%).` };
  }
  return {};
}

/** zzz925: amounts printed in a sentence, in `unit` ('$B', '$M', '₹ Cr'); other units are skipped. Pure. */
export function amountsIn(text: string | null | undefined, unit: string, opts: { skipFrom?: boolean } = {}): number[] {
  const t = String(text || '').replace(/(\d),(?=\d{2,3}\b)/g, '$1');
  const out: number[] = [];
  // "raised to ₹725–750 Cr from ₹600 Cr": the figure after "from" is the earlier GUIDANCE, not a reported year (skipFrom)
  const fromBefore = (i: number) => !!opts.skipFrom && /\bfrom\s*(?:₹|rs\.?|inr|\$)?\s*$/i.test(t.slice(Math.max(0, i - 12), i));
  const u = unit.replace(/\s+/g, '');
  // a range names its unit once ("$5.56 - $5.66 billion", "₹550–600 Cr"): both ends are read
  if (u === '₹Cr') {
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(?:₹|rs\.?|inr)?\s?(\d+(?:\.\d+)?))?\s*(?:cr\b|crores?\b)/gi)) { if (fromBefore(m.index ?? 0)) continue; out.push(Number(m[1])); if (m[2]) out.push(Number(m[2])); }
    return out;
  }
  if (u !== '$B' && u !== '$M') return out;
  for (const m of t.matchAll(/\$\s?(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\$?\s?(\d+(?:\.\d+)?))?\s*(billion|bn|b|million|mn|m)\b/gi)) {
    if (fromBefore(m.index ?? 0)) continue;
    const bil = /^b/i.test(m[3]);
    for (const raw of [m[1], m[2]]) { if (!raw) continue; const v = Number(raw); out.push(u === '$B' ? (bil ? v : v / 1000) : (bil ? v * 1000 : v)); }
  }
  return out;
}
/** zzz925: why the base of a worked-out growth is doubtful: the same sentence prints a figure for the measure that is well above the base and
 *  below the target (the company's own prior-year figure, or a run-rate) — the base was a part of the year or another line. Null = fine. Pure. */
export function derivedBaseDoubt(statement: string | null | undefined, d: Pick<GuGrowthDerivation, 'previousValue' | 'currentLow' | 'unit' | 'basePeriod'>): string | null {
  if (!(d.previousValue > 0)) return null;
  const bigger = amountsIn(statement, d.unit, { skipFrom: true }).filter((a) => a >= 1.5 * d.previousValue && a < d.currentLow * 0.999);
  if (!bigger.length) return null;
  const a = Math.max(...bigger);
  return `The growth was worked out against a ${d.basePeriod} base of ${amountText({ value: d.previousValue, unit: d.unit })}, but the same sentence prints ${amountText({ value: a, unit: d.unit })} for the measure — the base looks like a part of the year, so the worked-out growth needs review.`;
}

/** Context a point needs that lives outside its own item: the version chain, lifecycle, sources of the slot. */
interface PointCtx { now: Date; versions: GuVersionIn[]; lifecycle: GuLifecycle; expiryReason: string | null; sources: GuSourceEntry[]; conflict: boolean; primaryValue: GuSourceEntry | null; mediaClaim: GuSourceEntry | null; pf: ReturnType<typeof periodFacts>; resolved: boolean; dupOf: string | null; /** zzz854: event statuses for this company + metric (any period) */ events?: GuEventStatus[] }

// ═══ zzz854: the EVENTS layer overrides the universe ════════════════════════════════════════════
// RULE: the newest PRIMARY-SOURCE (verified) event for the same company + metric + period, dated on or after the record's own source date, wins.
// When it disagrees with the record (record RAISED but the filing says REITERATED / LOWERED / MIXED / not guidance; or the filing is newer and
// moved the numbers), the record leaves the Active list for "Needs review" with the reason 'Latest filing (date) says <status>', its revision is
// set to what the filing says and its 'vs prior guidance' text is dropped. A verified event for a LATER fiscal year of the same metric moves an
// annual record to review too (the company already guides the next year). Unverified events never override; they are kept as `latestEvent` only.
const EVENT_REVISION: Record<GuEventStatusKind, GuUniverseRecord['revision'] | null> = { RAISED: 'RAISED', REITERATED: 'MAINTAINED', LOWERED: 'LOWERED', MIXED: 'NONE', INVALID: 'NONE', NO_NUMBERS: null };
const EVENT_WORD: Record<GuEventStatusKind, string> = { RAISED: 'guidance RAISED', REITERATED: 'guidance REITERATED (unchanged)', LOWERED: 'guidance LOWERED', MIXED: 'a MIXED / range change (not a clean raise)', INVALID: 'NOT guidance', NO_NUMBERS: 'no numbers' };
const dayDiff = (a: string, b: string): number => (Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / DAY;
const fyOf = (p: string): number | null => { const m = /^(?:FY|CY)(\d{2})$/.exec(normPeriod(p)); return m ? 2000 + parseInt(m[1], 10) : null; };
export function eventOverrideFor(i: { period: string; revision: GuUniverseRecord['revision']; sourceDate: string | null; durationType: GuDurationType; events: GuEventStatus[] }): { override: GuEventOverride | null; latest: GuEventStatus | null } {
  const per = normPeriod(i.period);
  const same = i.events.filter((e) => e.period === per && e.status !== 'NO_NUMBERS').sort((a, b) => b.date.localeCompare(a.date) || Number(b.verified) - Number(a.verified));
  const latest = same[0] ?? null;
  const onOrAfter = (e: GuEventStatus) => !i.sourceDate || dayDiff(e.date, i.sourceDate) >= -1;
  const ev = same.find((e) => e.verified && onOrAfter(e)) ?? null;
  const mk = (code: GuEventOverride['code'], e: GuEventStatus, text: string): GuEventOverride => ({ code, eventStatus: e.status, eventDate: e.date, eventPeriod: e.period, eventLabel: e.label, eventDisplay: e.display, previousRevision: i.revision, text, sourceName: e.sourceName, sourceUrl: e.sourceUrl });
  if (ev) {
    const newer = !!i.sourceDate && dayDiff(ev.date, i.sourceDate) > SOURCE_CONFLICT_WINDOW_DAYS;
    const r = i.revision; let clash = false;
    switch (ev.status) {
      case 'RAISED': clash = r === 'LOWERED' || r === 'MAINTAINED' || r === 'WITHDRAWN' || newer; break;
      case 'REITERATED': clash = r === 'RAISED' || r === 'LOWERED'; break;
      case 'LOWERED': clash = r !== 'LOWERED' || newer; break;
      case 'MIXED': clash = r === 'RAISED' || newer; break;
      case 'INVALID': clash = r === 'RAISED'; break;
      default: clash = false;
    }
    if (clash) {
      const said = r === 'NONE' || r === 'INITIAL' ? 'an earlier figure' : r;
      const why = ev.status === 'INVALID' && ev.reason ? ` (${ev.reason})` : '';
      return { override: mk('EVENT_CONFLICT', ev, `Latest filing (${ev.date}) says ${EVENT_WORD[ev.status]}${ev.display ? `: ${ev.display}` : ''}${why}; this record${i.sourceDate ? ` (${i.sourceDate})` : ''} said ${said}. The filing wins until the record is re-checked.`), latest };
    }
  }
  // a newer verified ANNUAL event for a later fiscal year of the same metric: the company already guides the next year
  const fy = fyOf(per);
  if (fy != null && i.durationType === 'ANNUAL') {
    const later = i.events.filter((e) => e.verified && e.status !== 'NO_NUMBERS' && e.status !== 'INVALID' && (fyOf(e.period) ?? 0) > fy && (!i.sourceDate || dayDiff(e.date, i.sourceDate) > 0)).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (later) return { override: mk('NEWER_PERIOD_GUIDANCE', later, `Latest filing (${later.date}) already guides ${later.period}${later.display ? ` (${later.display})` : ''}; this ${per} record may be for a year that has ended or been replaced (the fiscal year end is not known here).`), latest };
  }
  return { override: null, latest };
}
const versionOfItem = (it: Item): GuVersionIn => ({ date: it.src.date, low: it.low, high: it.high, absLow: it.abs ? (it.abs.valueLow ?? it.abs.value) : null, absHigh: it.abs ? it.abs.value : null, unit: it.abs?.unit ?? null, source: it.src.name,
  display: displayOf({ metric: it.metric, low: it.low, high: it.high, open: it.open, origin: 'STATED', periodKind: it.pkind, period: it.period, abs: it.abs, cumulativeYears: it.cumulativeYears }) });
const versionOfPrior = (p: Prior, unit: string | null): GuVersionIn => ({ date: p.date, low: p.low, high: p.high, absLow: p.abs ? (p.abs.valueLow ?? p.abs.value) : null, absHigh: p.abs ? p.abs.value : null, unit: p.abs?.unit ?? unit, source: p.note || 'Earlier guidance',
  display: p.abs ? amountText(p.abs) : p.low == null ? 'no %' : pctText(p.low, p.high === p.low ? null : p.high, false) });
const toVersionIn = (s: GuHistoryStep['to']): GuVersionIn => ({ date: s.date, low: s.low, high: s.high, absLow: s.absoluteLow, absHigh: s.absoluteHigh, unit: s.unit, source: s.source, display: s.display });
const srcEntry = (it: Item, role: GuSourceEntry['role']): GuSourceEntry => {
  const t = it.tier ?? classifySourceTier({ rank: it.src.rank, type: it.src.type, name: it.src.name, url: it.src.url }).tier;
  return { name: it.src.name, type: it.src.type, url: it.src.url, date: it.src.date, tier: t, tierLabel: TIER_LABEL[t], low: it.low, high: it.high, absolute: it.abs,
    value: displayOf({ metric: it.metric, low: it.low, high: it.high, open: it.open, origin: 'STATED', periodKind: it.pkind, period: it.period, abs: it.abs, cumulativeYears: it.cumulativeYears }), role };
};

function pointOf(it: Item, history: Prior[], ps: GuPeriodInfo, x: PointCtx): GuPoint {
  const proxy = proxyOf(it.metric, it.statement);
  const tier = it.tier ?? classifySourceTier({ rank: it.src.rank, type: it.src.type, name: it.src.name, url: it.src.url }).tier;
  const claimType = it.claimType ?? claimTypeOf(it.kind, tier, it.statement);
  const pf = x.pf;
  let low = it.low, high = it.high, open = it.open; const origin = it.gOrigin;
  let impliedRejected: string | null = null; const flags: string[] = [];
  let growthType: GuGrowthType = it.low == null ? 'UNKNOWN' : origin === 'STATED' ? 'EXPLICIT' : 'IMPLIED';
  let derivation: GuGrowthDerivation | null = null; let notComparable: string | null = null; let growthBasis: string | null = growthType === 'EXPLICIT' ? 'stated_by_company' : null;
  if (origin === 'IMPLIED' && low != null) {
    const chk = impliedCheck(it);
    if (chk.reject) { impliedRejected = chk.reject; low = null; high = null; open = false; growthType = 'UNKNOWN'; if (!/no stated target amount/.test(chk.reject)) notComparable = chk.reject.replace(/^Implied growth dropped:\s*/i, ''); }
    else if (chk.review) { flags.push(chk.review); growthBasis = 'inferred_no_sourced_base'; }
    else if (it.cagrFromBase && ((it.abs && it.base) || it.cagrFromBase.how === 'total')) { growthType = 'DERIVED'; growthBasis = 'cagr_worked_out_from_company_numbers'; }
    else if (it.abs && it.base) {
      const d = deriveGrowth({ target: it.abs, base: it.base, storedLow: it.low, storedHigh: it.high });
      if (d.ok && d.consistent) { growthType = 'DERIVED'; growthBasis = d.basis; derivation = { previousValue: d.previousValue, currentLow: d.currentLow, currentHigh: d.currentHigh, unit: d.unit, basePeriod: d.basePeriod, growthLow: d.growthLow, growthMid: d.growthMid, growthHigh: d.growthHigh, basis: d.basis }; }
      else if (d.ok) { flags.push(`Stored growth (${it.high != null && it.high !== it.low ? `${fnum(it.low!)}–${fnum(it.high)}` : fnum(it.low!)}%) cannot be reproduced from the target amount and base (${fnum(d.growthLow)}–${fnum(d.growthHigh)}%).`); growthBasis = 'inferred_no_sourced_base'; }
      else { notComparable = d.reason; low = null; high = null; open = false; growthType = 'UNKNOWN'; impliedRejected = `Implied growth dropped: ${d.reason}.`; }
    }
  }
  if (it.needsReview) flags.push(it.needsReview);
  // zzz925: a worked-out growth whose own sentence prints a bigger figure for the measure than the base it was divided by (Pinnacle West:
  // "2025 Actual … Operating revenues $5.34 billion; 2026 Guidance $5.56 - $5.66 billion" was divided by a $1.94B "FY25 actual" = +189%)
  if (derivation && it.abs) { const dbt = derivedBaseDoubt(it.statement, derivation); if (dbt) flags.push(dbt); }
  const cv = compareValue(low, high, open);
  if (it.metric === 'REVENUE' && cv != null && cv >= PLAUSIBLE_REVENUE_GROWTH_PCT && !(origin === 'STATED' && low != null && (figureIn(it.statement, low) || multipleOf(it.statement) === 1 + low / 100)) && !(origin === 'IMPLIED' && it.baseStatedByCompany && derivation))
    flags.push(`Revenue growth of about ${fnum(cv)}% is at or above ${PLAUSIBLE_REVENUE_GROWTH_PCT}%, which is implausible for an established company unless management clearly stated it as a percent. The source text does not show that, so it needs review.`);
  const needsReview = flags.length ? flags.join(' ') : null;
  // ── display with its basis ──
  const exact = derivation ? { low: derivation.growthLow, mid: derivation.growthMid, high: derivation.growthHigh } : null;
  const dRange = derivation ? derivation.currentLow !== derivation.currentHigh : (high != null && low != null && high !== low);
  const dp = growthType === 'DERIVED' || growthType === 'IMPLIED' ? derivedDp(exact ? exact.low : (low as number), dRange ? (exact ? exact.high : high) : null) : 1;
  const pctShown = low == null ? null : exact ? pctText(exact.low, dRange ? exact.high : null, false, dp) : pctText(low, open ? null : high === low ? null : high, open, dp);
  const tgtText = it.abs ? amountText(it.abs) : null;
  let basisLabel: string;
  if (growthType === 'EXPLICIT') basisLabel = 'stated by company';
  else if (growthType === 'DERIVED' && it.cagrFromBase?.how === 'total') basisLabel = `a year, worked out from the company's total: "${it.cagrFromBase.baseText}" over ${it.cagrFromBase.yearsMin && it.cagrFromBase.yearsMin !== it.cagrFromBase.years ? `${it.cagrFromBase.yearsMin}–${it.cagrFromBase.years}` : it.cagrFromBase.years} years`;
  else if (growthType === 'DERIVED' && it.cagrFromBase) basisLabel = `a year, worked out from company numbers: ${tgtText} by ${it.cagrFromBase.targetPeriod} vs ${it.cagrFromBase.baseText}, over ${it.cagrFromBase.years} years`;
  else if (growthType === 'DERIVED' && derivation) {
    const bt = amountText({ value: derivation.previousValue, unit: derivation.unit });
    basisLabel = derivation.basis === 'absolute_vs_prior_guidance' ? `vs prior guidance (derived: ${tgtText} vs ${bt})` : `vs ${it.base!.period} actual (derived: ${tgtText} vs ${bt})`;
  } else if (growthType === 'IMPLIED') basisLabel = tgtText ? `implied from the ${tgtText} target; base not sourced` : 'implied; no stated % and no sourced base';
  else basisLabel = notComparable ? `GROWTH NOT COMPARABLE: ${notComparable}` : it.growthNote || 'no % stated';
  let core: string;
  if (growthType === 'EXPLICIT') core = displayOf({ metric: it.metric, low, high, open, origin: 'STATED', periodKind: it.pkind, period: it.period, abs: it.abs, cumulativeYears: it.cumulativeYears, proxy });
  else if (growthType === 'DERIVED' && it.cagrFromBase) core = `${it.cagrFromBase.years}-yr ${METRIC_WORD[it.metric]} CAGR ${pctShown}${proxy ? ` (${proxy})` : ''} (${basisLabel})`;
  else if (growthType === 'DERIVED' || growthType === 'IMPLIED') core = `${pctShown}${proxy ? ` (${proxy})` : ''} ${growthType === 'DERIVED' ? basisLabel : `(${basisLabel})`}`;
  else core = tgtText ? `${tgtText} target (${notComparable ? basisLabel : it.growthNote || 'no % stated'})` : '—';
  const tails: string[] = [];
  if (needsReview) tails.push('needs review');
  if (pf.periodStatus !== 'CONFIRMED') tails.push('period year not stated');
  const display = tails.length ? `${core} (${tails.join('; ')})` : core;
  const baseLabel = it.base ? baseText(it.base, it.metric) : null;
  // stated vs implied: both are kept when both exist; stated is always primary
  const statedGrowth = origin === 'STATED' && low != null ? { low, high: open ? null : high === low ? null : high, open, display: pctText(low, open ? null : high === low ? null : high, open) } : null;
  let impliedGrowth: GuPoint['impliedGrowth'] = null;
  if (origin === 'IMPLIED' && low != null) impliedGrowth = { low, high: high === low ? null : high, display: pctText(low, high === low ? null : high, false), base: it.base ?? null, baseLabel };
  else if (statedGrowth && it.compImplied && it.compImplied.low != null && !impliedCheck(it.compImplied).reject && !impliedCheck(it.compImplied).review) {
    const c = it.compImplied; const cb = c.base ? baseText(c.base, c.metric) : null;
    impliedGrowth = { low: c.low!, high: c.high === c.low ? null : c.high, display: pctText(c.low!, c.high === c.low ? null : c.high, false), base: c.base ?? null, baseLabel: cb };
  }
  const impliedDisplay = impliedGrowth ? `${impliedGrowth.display} (implied${impliedGrowth.baseLabel ? `, base ${impliedGrowth.baseLabel}` : ''})` : null;
  const secondaryDisplay = statedGrowth && impliedGrowth ? impliedDisplay : null;
  // ── legacy counting rules (unchanged) ──
  const mgmtVerified = it.verification === 'VERIFIED' || it.verification === 'PARTIALLY_VERIFIED';
  const horizon: GuHighGrowthHorizon | null = ANNUAL_COUNTABLE.includes(it.pkind) ? 'SINGLE_YEAR' : it.pkind === 'MULTI_YEAR_CAGR' ? 'MULTI_YEAR_CAGR' : null;
  const runOk = ps.status === 'ACTIVE' && !ps.inferred;
  const base = isMgmt(it.kind) && (it.metric === 'REVENUE' || it.metric === 'PAT') && horizon && !proxy && cv != null && !needsReview && runOk;
  const hg = base && mgmtVerified ? horizon : null;
  const awaitingVerification = !!base && it.verification === 'SECONDARY_ONLY';
  const counted = isMgmt(it.kind) && mgmtVerified && horizon === 'SINGLE_YEAR' && !proxy && cv != null && !needsReview && runOk;
  // ── zzz853: source, verification state ──
  const read = it.primarySourceRead != null ? !!it.primarySourceRead && tier <= 2 : tier <= 2 && (it.origin !== 'RESEARCHED_SEED' || it.verification === 'VERIFIED');
  const found = tier <= 2 && (!!it.src.url || read);
  const evidence = !!(it.statement || '').trim();
  const vs = verificationStateOf({ claimType, tier, primarySourceFound: found, primarySourceRead: read, growthType, periodStatus: pf.periodStatus, needsReview: !!needsReview, hasEvidence: evidence });
  const legacyVerification: GgVerification = it.verification === 'VERIFIED' && vs.state !== 'VERIFIED' ? 'PARTIALLY_VERIFIED' : it.verification;
  // ── metric family, units ──
  const family = FAMILY_OF[it.metric]; const srcLabel = it.sourceMetricLabel ?? extractMetricLabel(it.statement, it.metric);
  const labelFam = familyOfLabel(it.sourceMetricLabel);
  const mu = parseUnit(it.abs?.unit);
  const rflags: GuReviewReasonX[] = [];
  const rf = (code: GuReviewReasonX['code'], text: string, blocks: boolean) => rflags.push({ code, text, blocks });
  if (!x.resolved) rf('COMPANY_UNRESOLVED', 'The company is not resolved to a ticker.', true);
  if (pf.periodStatus === 'UNCLEAR') rf('PERIOD_UNCLEAR', 'The period year is not stated in the source, so the period is unclear.', true);
  else if (pf.periodStatus === 'UNKNOWN') rf('PERIOD_UNKNOWN', 'The period is not stated.', true);
  if (needsReview) rf('NEEDS_REVIEW', needsReview, true);
  if (x.conflict) rf('SOURCE_CONFLICT', 'Two sources give different values for this company, metric and period.', true);
  if (x.dupOf) rf('POTENTIAL_DUPLICATE', `May be the same company as ${x.dupOf}.`, true);
  if (ps.status === 'ACTIVE' && ps.end && ps.end.getTime() < x.now.getTime()) rf('EXPIRED', `The guided period ended ${ps.end.toISOString().slice(0, 10)}; results are due within the reporting lag.`, true);
  if (labelFam && labelFam !== family) rf('METRIC_LABEL_MISMATCH', `The source calls this "${it.sourceMetricLabel}" (${labelFam}) but it is recorded as ${family}.`, true);
  if (tier >= 3) rf('SECONDARY_ONLY', 'Only media or another secondary source backs this.', false);
  if (!found) rf('PRIMARY_MISSING', 'primary source not found', false);
  const lastVerified = it.lastVerified ?? it.src.date ?? null; const ago = daysBetween(lastVerified, x.now);
  // ── zzz854: the events layer wins over the record; stale verification; the verification gate (Active = verified / derived / document read) ──
  const baseRevision = revisionFor(it, history);
  const evx = eventOverrideFor({ period: it.period, revision: baseRevision, sourceDate: it.src.date, durationType: pf.durationType, events: x.events ?? [] });
  let revision = baseRevision;
  if (evx.override) {
    rf(evx.override.code, evx.override.text, true);
    if (evx.override.code === 'EVENT_CONFLICT') { const nr = EVENT_REVISION[evx.override.eventStatus]; if (nr) revision = nr; }
  }
  if (ago != null && ago > STALE_DEMOTE_DAYS) rf('STALE_VERIFICATION', `Last verified ${ago} days ago (more than ${STALE_DEMOTE_DAYS}). A newer filing may have changed it, so it must be re-checked before it is shown as active.`, true);
  const gate = tier >= 3 ? `Only a secondary source backs this (${TIER_LABEL[tier]}: ${it.src.name}); the company's own document has not confirmed it.`
    : it.verification === 'SECONDARY_ONLY' ? 'Marked media-only by the researcher; the company\'s own document has not confirmed it.'
    : !found ? 'The company\'s own document was not found.'
    : !read ? 'The company\'s own document was found but has not been read yet.'
    : !lastVerified ? 'Last verified date unknown, so it cannot be shown as verified.'
    : null;
  if (gate) rf('AWAITING_VERIFICATION', gate, true);
  const listBucket: GuListBucket = gate ? 'CLAIMS' : rflags.some((r) => r.blocks) ? 'REVIEW' : 'ACTIVE';
  // ── zzz860: calculation type apart from verification status; wording; event type of the change against the earlier version ──
  const calcType = calculationTypeOf({ growthType, isRange: (low != null && high != null && low !== high) || open, hasPercent: low != null });
  const verStatus = verificationStatusOf({ primaryRead: read && !gate, tier, state: vs.state, contradicted: evx.override?.code === 'EVENT_CONFLICT', ageDays: ago, legacy: it.verification });
  const prevVer = x.versions.length > 1 ? x.versions[x.versions.length - 2] : null;
  const changeType: GuEventType | null = prevVer && (prevVer.low != null || prevVer.high != null) && low != null
    ? classifyGuidanceChange({ text: it.statement, company: it.company, metric: it.metric, period: it.period, curr: { low, high: open ? null : (high ?? low) }, prev: { low: prevVer.low ?? null, high: prevVer.high ?? prevVer.low ?? null, metric: it.metric, period: it.period } }).type : null;
  const ver: GuVersionIn[] = x.versions.length ? x.versions : [versionOfItem(it)];
  const hist = buildHistory(ver, x.lifecycle);
  const lastStep = hist[hist.length - 1];
  const revPrior = lastStep && lastStep.from ? revisionVsPriorOf(toVersionIn(lastStep.from), toVersionIn(lastStep.to)) : null;
  const gvp: GuGrowthVsPriorYear | null = growthType === 'EXPLICIT' && low != null ? { type: 'EXPLICIT', low, mid: (low + (high ?? low)) / 2, high: high ?? low, display: pctText(low, open ? null : high === low ? null : high, open), baseLabel: null, basis: 'stated_by_company' }
    : growthType === 'DERIVED' && derivation && derivation.basis === 'absolute_vs_prior_year_actual' ? { type: 'DERIVED', low: derivation.growthLow, mid: derivation.growthMid, high: derivation.growthHigh, display: `${pctShown} ${basisLabel}`, baseLabel, basis: derivation.basis }
    : growthType === 'IMPLIED' && low != null ? { type: 'IMPLIED', low, mid: (low + (high ?? low)) / 2, high: high ?? low, display: `${pctShown} (${basisLabel})`, baseLabel, basis: growthBasis } : null;
  const gType: GuGuidanceType = it.pkind === 'MULTI_YEAR_CAGR' && low != null ? 'CAGR' : (it.abs && (growthType !== 'EXPLICIT' || low == null)) ? 'ABSOLUTE_TARGET' : (low != null && high != null && low !== high) || open || (it.abs?.valueLow != null) ? 'RANGE_TARGET' : 'GROWTH_RATE';
  return {
    metric: it.metric, period: it.period, periodKind: it.pkind, display,
    low, high, open, implied: origin === 'IMPLIED', compareValue: cv, counted, verification: legacyVerification, origin: it.origin, sourceName: it.src.name, sourceType: it.src.type, sourceUrl: it.src.url,
    sourceDate: it.src.date, sourceRank: it.src.rank, primarySource: srcPrimary(it.src.rank, it.src.type), revision, proxy, statement: it.statement, notes: it.notes, priors: history, absolute: it.abs,
    periodRunState: ps.status, periodInferred: ps.inferred, periodNote: ps.note, periodEnd: ps.end ? ps.end.toISOString().slice(0, 10) : null,
    statedGrowth, impliedGrowth, impliedDisplay, secondaryDisplay, impliedRejected, needsReview, hg, awaitingVerification,
    growthType, guidanceType: gType, isRange: (low != null && high != null && low !== high) || it.abs?.valueLow != null, growthBasis, basisLabel, growthDerivation: derivation, growthExact: exact, growthVsPriorYear: gvp, revisionVsPriorGuidance: evx.override?.code === 'EVENT_CONFLICT' ? null : revPrior,
    growthComparable: !notComparable, growthNotComparable: notComparable, headlineBasis: low != null ? 'GROWTH_VS_PRIOR_YEAR' : 'ABSOLUTE_TARGET_ONLY',
    verificationState: gate ? 'UNVERIFIED' : vs.state, verificationReason: gate ? `Awaiting verification: ${gate}` : vs.reason, claimType, sourceTier: tier, sourceTierLabel: TIER_LABEL[tier], primarySourceFound: found, primarySourceRead: read,
    primarySourceText: found ? 'PRIMARY SOURCE FOUND' : 'primary source not found', primarySourceReadText: read ? 'primary source read' : 'primary source not yet read',
    periodLabelSource: pf.periodLabelSource, periodNormalized: pf.periodNormalized, fiscalYear: pf.fiscalYear, fiscalYearStart: pf.fiscalYearStart, fiscalQuarter: pf.fiscalQuarter, periodStatus: pf.periodStatus, durationType: pf.durationType, cohort: pf.cohort,
    metricFamily: family, sourceMetricLabel: srcLabel, currency: mu.currency, unit: it.abs?.unit ?? null, scale: mu.scale,
    status: x.lifecycle, current: x.lifecycle === 'ACTIVE', expiryReason: x.expiryReason, history: hist,
    lastVerified, lastVerifiedDaysAgo: ago, staleVerification: isStale(ago),
    sources: x.sources, sourceConflict: x.conflict, primaryValue: x.primaryValue, mediaClaim: x.mediaClaim, reviewReasons: rflags, inDefaultView: listBucket === 'ACTIVE',
    listBucket, awaitingVerificationReason: gate, eventOverride: evx.override, latestEvent: evx.latest,
    calculationType: calcType, verificationStatus: verStatus, freshness: freshnessOf(ago).tier, wording: guidanceWording(verStatus, calcType), eventType: changeType,
  };
}
const fmtPrior = (p: Prior) => { const pc = p.low == null ? null : pctText(p.low, p.high === p.low ? null : p.high, false); return p.abs ? `${amountText(p.abs)}${pc ? ` (about ${pc})` : ''}` : pc ?? 'no %'; };

function companyOf(base: Item, all: Item[], pt: GuPoint, key: string): GgCompany {
  const primaryPoint: GgGuidancePoint = base.gp || {
    metric: base.metric, kind: base.kind, growthLow: base.low, growthHigh: base.high, growthOrigin: base.gOrigin, absoluteTarget: base.abs ? { value: base.abs.value, unit: base.abs.unit } : null, base: null,
    period: base.period, periodKind: base.pkind, organic: base.organic, basis: 'UNSTATED', originalStatement: base.statement, unit: base.pkind === 'MULTI_YEAR_CAGR' ? '% CAGR' : '%', prior: null,
  };
  const others: GgGuidancePoint[] = all.filter((x) => x !== base).map((x) => x.gp || ({
    metric: x.metric, kind: x.kind, growthLow: x.low, growthHigh: x.high, growthOrigin: x.gOrigin, absoluteTarget: x.abs ? { value: x.abs.value, unit: x.abs.unit } : null, base: null,
    period: x.period, periodKind: x.pkind, organic: x.organic, basis: 'UNSTATED', originalStatement: x.statement, unit: '%',
  } as GgGuidancePoint));
  const history: GgLedgerRow[] = [...pt.priors.map((p): GgLedgerRow => ({ date: p.date, period: base.period, metric: base.metric, old: null, next: fmtPrior(p), revision: 'INITIAL', source: p.note || 'Earlier guidance', reason: p.note || '', status: 'SUPERSEDED' })),
    { date: base.src.date || '', period: base.period, metric: base.metric, old: pt.priors.length ? fmtPrior(pt.priors[pt.priors.length - 1]) : null, next: pt.display, revision: pt.revision === 'NONE' ? 'INITIAL' : (pt.revision as GgRevision), source: base.src.name, reason: '', status: 'ACTIVE' }];
  const src = srcRefOf(base);
  const organicWord = base.organic === 'ORGANIC' ? 'Organic' : base.organic === 'ACQUISITION_LED' ? 'Acquisition-led' : base.organic === 'MIXED' ? 'Organic + acquisition' : 'Organic mix unknown';
  return {
    id: hash(`${key}|${base.metric}|${normPeriod(base.period)}`), ticker: base.ticker || '', company: base.company, market: base.market, tickerResolved: !!base.ticker, capBand: 'UNKNOWN', marketCap: null,
    primary: primaryPoint, others, verification: base.verification, quality: qualityOf(primaryPoint, src), validity: 'ACTIVE', sources: [src], conflict: null,
    driverText: base.driver || 'Management has not stated the driver in the source found', mechanisms: base.mechanisms, catalysts: [], chain: [], guidanceDuration: base.period, structuralDuration: base.pkind === 'MULTI_YEAR_CAGR' ? 'Multi-year' : 'Not established',
    history, revision: pt.revision === 'NONE' ? 'INITIAL' : (pt.revision as GgRevision), trend: 'NONE', trendText: null, credibility: null, surprise: null, reality: null, earnings: null, map2x2: 'FORWARD_LOOKING_EARLY',
    expectations: 'UNKNOWN', expectationsWhy: 'DATA UNAVAILABLE', valuation: null, nextProof: `Next results: compare reported ${METRIC_WORD[base.metric]} growth with the guided ${pt.display} for ${base.period}.`, breakers: [],
    links: { radarEligible: false, radarWhy: 'Not assessed for this record' }, organicNote: `${base.period} ${pt.display} ${METRIC_WORD[base.metric]}: ${organicWord}`, corporateActionGrowth: base.organic === 'ACQUISITION_LED', portfolio: { held: false },
    announcedAt: base.src.date, lastEvidenceAt: base.src.date, isNewToday: false, alert: null,
  };
}

const METRIC_ORDER: Record<GgMetric, number> = { REVENUE: 0, PAT: 1, EPS: 2, EBITDA: 3, FCF: 4 };
const PERIOD_CLASS_ORDER: Record<GuUniverseRecordX['classification'], number> = { ANNUAL: 0, UNKNOWN_PERIOD: 1, SHORT_PERIOD: 2, MULTI_YEAR: 3 };

const daysApart = (a: string | null, b: string | null): number => { if (!a && !b) return 0; if (!a || !b) return Infinity; const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / DAY : Infinity; };
const sameSource = (a: Item, b: Item) => a.src.name === b.src.name && (a.src.url || '') === (b.src.url || '');
const tierOf = (it: Item): SourceTier => it.tier ?? classifySourceTier({ rank: it.src.rank, type: it.src.type, name: it.src.name, url: it.src.url }).tier;
const isUnresolved = (entityKey: string) => entityKey.includes(':~');

/** The universe: currently valid guidance, merged per company. No time window. ACTIVE = not expired (period end vs now), not superseded by a later record for the same company+metric+period, not withdrawn. */
export function buildUniverse(live: GgCompany[], ledgerRows: Array<{ market: 'IN' | 'US'; ticker: string; company?: string; entries: GgStoredEntry[] }> | null | undefined, seedRows: GuSeedRow[], now: Date, opts: GuBuildOpts & { stored?: GuStoredPoint[] | null } = {}): GuUniverseBuild {
  void opts.threshold; void opts.eventWindow;   // the universe never depends on an event window
  const items: Item[] = [];
  if (opts.extracted) items.push(...itemsFromExtracted(opts.extracted.results, opts.extracted.actuals ?? null, now));
  for (const c of live || []) items.push(...itemsFromLive(c));
  items.push(...itemsFromLedger(ledgerRows || []));
  items.push(...itemsFromStored(opts.stored));
  for (const r of seedRows || []) items.push(itemFromSeed(r));
  const excluded: GuExcluded[] = [];
  const usable = items.filter((it) => {
    const t = classifySourceTier({ rank: it.src.rank, type: it.src.type, name: it.src.name, url: it.src.url });
    it.tier = t.tier; it.claimType = claimTypeOf(it.kind, t.tier, it.statement);
    if (it.verification === 'UNVERIFIED') { excluded.push({ company: it.company, ticker: it.ticker, market: it.market, metric: it.metric, period: it.period, reason: 'UNVERIFIED: no source supports this number, so it is not shown as guidance.', claimType: it.claimType }); return false; }
    if (!hasNumber(it.low, it.abs)) return false;
    const ng = nonGuidanceReason(it.kind, it.claimType, it.statement);
    if (ng) { excluded.push({ company: it.company, ticker: it.ticker, market: it.market, metric: it.metric, period: it.period, reason: ng, claimType: it.claimType }); return false; }
    if (it.primarySourceRead == null && it.origin !== 'RESEARCHED_SEED') it.primarySourceRead = t.tier <= 2;   // live / ledger text came from the document itself
    return true;
  });
  const entityOf = resolveEntities(usable);
  // group per entity + metric + period
  const slots = new Map<string, Item[]>();
  for (const it of usable) { const k = `${entityOf.get(it)}|${it.metric}|${normPeriod(it.period)}`; (slots.get(k) || slots.set(k, []).get(k)!).push(it); }
  const inactive: GuInactiveRecord[] = [];
  interface ActiveSlot { it: Item; history: Prior[]; note: string | null; ps: GuPeriodInfo; versions: GuVersionIn[]; sources: GuSourceEntry[]; conflict: boolean; primaryValue: GuSourceEntry | null; mediaClaim: GuSourceEntry | null; pf: ReturnType<typeof periodFacts> }
  const activeByEntity = new Map<string, ActiveSlot[]>();
  const nameSets = new Map<string, Set<string>>(); const tickerSets = new Map<string, Set<string>>();
  for (const it of usable) { const e = entityOf.get(it)!; (nameSets.get(e) || nameSets.set(e, new Set()).get(e)!).add(normCompanyName(it.company)); if (it.ticker) (tickerSets.get(e) || tickerSets.set(e, new Set()).get(e)!).add(it.ticker); }
  const pushInactive = (e: string, it: Item, status: Inactive, reason: string, extra: { periodEnd?: string | null; supersededBy?: string | null } = {}) => inactive.push({
    entityKey: e, company: it.company, ticker: it.ticker, market: it.market, metric: it.metric, period: it.period, status, reason,
    display: displayOf({ metric: it.metric, low: it.low, high: it.high, open: it.open, origin: it.gOrigin, periodKind: it.pkind, period: it.period, abs: it.abs, cumulativeYears: it.cumulativeYears }), verification: it.verification, sourceName: it.src.name, sourceDate: it.src.date, origin: it.origin,
    expiryReason: status === 'EXPIRED' ? 'period completed' : status === 'SUPERSEDED' ? 'superseded' : 'withdrawn', lifecycle: status, current: false, periodEnd: extra.periodEnd ?? null, supersededBy: extra.supersededBy ?? null,
  });
  for (const group of Array.from(slots.values())) {
    const e = entityOf.get(group[0])!;
    let eligible = group.filter((g) => !g.forced);
    // zzz880: an amount that implies an impossible one-year change against last year's ACTUAL is a segment / partial / misread figure, not
    // company guidance (Man Industries: "₹35–50 Cr" FY27 revenue against ₹3,592 Cr actual = −99% replaced the real ₹5,000–5,500 Cr guide).
    // It never wins a slot — and it is removed BEFORE the company-document rule, so it can never supersede the sensible figure; it is listed under excluded with the reason, and the sensible figure stays current.
    eligible = eligible.filter((g) => {
      const why = implausibleImplied(g);
      if (why) excluded.push({ company: g.company, ticker: g.ticker, market: g.market, metric: g.metric, period: g.period, reason: why, claimType: g.claimType });
      return !why;
    });
    // zzz857: a media / secondary claim (TIER3-4) for a slot the company's own document covers is SUPERSEDED by that document (never a 'conflict', never a claim awaiting verification)
    const doc = eligible.filter((g) => g.origin === 'COMPANY_DOC').sort((a, b) => -better(a, b))[0];
    if (doc) {
      const media = eligible.filter((g) => g.origin !== 'COMPANY_DOC' && tierOf(g) >= 3);
      for (const m of media) pushInactive(e, m, 'SUPERSEDED', `Superseded by the company's own document (${doc.src.date || 'undated'}, ${doc.src.name}).`, { supersededBy: `${doc.src.date || 'undated'}, ${doc.src.name}` });
      eligible = eligible.filter((g) => !media.includes(g));
    }
    for (const g of group.filter((x) => x.forced)) pushInactive(e, g, g.forced!, g.forced === 'WITHDRAWN' ? 'Management withdrew this guidance.' : g.forced === 'SUPERSEDED' ? 'Replaced by a later statement.' : 'The guided period has ended.');
    if (!eligible.length) continue;
    eligible.sort((a, b) => -better(a, b));
    let win = eligible[0];
    // zzz849: a stated % is never replaced by an implied one. A same-day implied statement for the same slot rides along as the secondary figure; the same
    // statement from the same day never beats a stated one.
    const comp = win.gOrigin === 'STATED' && win.low != null ? eligible.slice(1).find((x) => x.gOrigin === 'IMPLIED' && x.low != null && dateOf(x) === dateOf(win)) : undefined;
    // zzz853: SOURCE CONFLICT: other sources, within a few days, that give a DIFFERENT value. Both are stored; the primary-tier value wins; nothing is averaged or merged.
    const conflicts = eligible.filter((x) => x !== win && x !== comp && !sameSource(x, win) && daysApart(dateOf(x) || null, dateOf(win) || null) <= SOURCE_CONFLICT_WINDOW_DAYS && !sameValue(x, win));
    let losers: Item[] = [];
    if (conflicts.length) {
      const cluster = [win, ...conflicts].sort((a, b) => tierOf(a) - tierOf(b) || -better(a, b));
      win = cluster[0];
      losers = cluster.slice(1).filter((x) => !sameSource(x, win) && !sameValue(x, win));
    }
    const rest = eligible.filter((x) => x !== win && x !== comp && !losers.includes(x));
    if (comp && win.gOrigin === 'STATED' && win.low != null) win.compImplied = comp;
    const supersededBy = `${win.src.date || 'undated'}, ${win.src.name}`;
    for (const l of eligible.filter((x) => x !== win && x !== comp && !losers.includes(x))) pushInactive(e, l, 'SUPERSEDED', `A later or higher-ranked record for the same company, metric and period (${win.src.date || 'undated'}, ${win.src.name}) replaces this one.`, { supersededBy });
    if (win.withdrawn) { pushInactive(e, win, 'WITHDRAWN', 'Management withdrew this guidance.'); continue; }
    const pf = periodFacts(win.period, win.pkind, { context: win.periodContext, statement: win.statement, cumulativeYears: win.cumulativeYears });
    const ps = periodStatusOf(pf.contextApplied ? pf.effectivePeriod : win.period, win.pkind, win.market, win.src.date || (win.gc?.announcedAt ?? null), now);
    if (ps.status === 'EXPIRED') { pushInactive(e, win, 'EXPIRED', ps.reason, { periodEnd: ps.end ? ps.end.toISOString().slice(0, 10) : null }); continue; }
    const history: Prior[] = [...win.priors, ...rest.map((l) => ({ date: l.src.date || '', low: l.low, high: l.high, note: l.src.name, abs: l.abs })).filter((p) => p.date)].filter((p) => p.date);
    const versions: GuVersionIn[] = [...win.priors.map((p) => versionOfPrior(p, win.abs?.unit ?? null)), ...rest.map(versionOfItem), versionOfItem(win)];
    const conflict = losers.length > 0;
    const sources: GuSourceEntry[] = [srcEntry(win, tierOf(win) <= 2 ? 'PRIMARY' : 'OTHER'), ...losers.map((l) => srcEntry(l, tierOf(l) >= 3 ? 'MEDIA_CLAIM' : 'OTHER'))];
    for (const c of win.confirmedBy || []) { const t = classifySourceTier({ rank: win.src.rank, type: c.type, name: c.name, url: c.url }).tier; sources.push({ name: c.name, type: c.type, url: c.url, date: c.date, tier: t, tierLabel: TIER_LABEL[t], value: 'reiterated', low: null, high: null, absolute: null, role: t <= 2 ? 'PRIMARY' : 'OTHER' }); }
    const primaryValue = conflict && tierOf(win) <= 2 ? sources[0] : null;
    const mediaClaim = conflict && tierOf(win) <= 2 ? sources.slice(1).find((s) => s.tier >= 3) || null : null;
    (activeByEntity.get(e) || activeByEntity.set(e, []).get(e)!).push({ it: win, history, note: ps.note, ps, versions, sources, conflict, primaryValue, mediaClaim, pf });
  }
  // potential duplicates: an unresolved name that closely matches another company's name in the same market
  const dupOf = new Map<string, string>(); const dupEntity = new Map<string, string>();
  const entityList = Array.from(activeByEntity.keys());
  for (const a of entityList) {
    if (!isUnresolved(a)) continue;
    const an = Array.from(nameSets.get(a) || [])[0] || '';
    for (const b of entityList) {
      if (b === a || b.split(':')[0] !== a.split(':')[0]) continue;
      for (const bn of Array.from(nameSets.get(b) || [])) {
        if (!an || !bn || an === bn) continue;
        if (bn.startsWith(`${an} `) || an.startsWith(`${bn} `) || (Math.min(an.length, bn.length) >= 8 && editDistanceLe1(an, bn))) { dupOf.set(a, Array.from(activeByEntity.get(b)!)[0].it.company); dupEntity.set(a, b); break; }
      }
      if (dupOf.has(a)) break;
    }
  }
  // zzz854: ONE canonical row per company + metric + period. An unresolved duplicate of a resolved company that holds the SAME metric + period
  // slot is not shown twice: it leaves the active universe as SUPERSEDED ('duplicate of ...'). Slots the canonical company does not hold stay
  // (flagged POTENTIAL_DUPLICATE) so no number is lost.
  for (const [a, b] of Array.from(dupEntity.entries())) {
    const canon = activeByEntity.get(b) || []; const mine = activeByEntity.get(a) || [];
    const has = new Set(canon.map((x) => `${x.it.metric}|${normPeriod(x.it.period)}`));
    const keep = mine.filter((x) => !has.has(`${x.it.metric}|${normPeriod(x.it.period)}`));
    for (const x of mine) if (!keep.includes(x)) pushInactive(a, x.it, 'SUPERSEDED', `Duplicate of ${canon[0].it.company} (same company, metric and period); the canonical record is kept.`, { supersededBy: `${canon[0].it.company}` });
    if (keep.length) activeByEntity.set(a, keep); else { activeByEntity.delete(a); dupOf.delete(a); }
  }
  // zzz854: event statuses per company + metric (any period), matched by market + ticker
  const evIdx = new Map<string, GuEventStatus[]>();
  for (const ev of opts.eventStatuses || []) { if (!ev || !ev.ticker || !ev.metric || !ev.date) continue; const k = `${ev.market}:${String(ev.ticker).toUpperCase()}|${ev.metric}`; (evIdx.get(k) || evIdx.set(k, []).get(k)!).push(ev); }
  const eventsFor = (e: string, it: Item): GuEventStatus[] => {
    if (!evIdx.size) return [];
    const tks = new Set<string>([...(tickerSets.get(e) || []), ...(it.ticker ? [it.ticker] : [])].map((t) => t.toUpperCase()));
    const out: GuEventStatus[] = []; for (const t of Array.from(tks)) out.push(...(evIdx.get(`${it.market}:${t}|${it.metric}`) || []));
    return out;
  };
  const mkRecord = (e: string, act: Array<{ a: ActiveSlot; pt: GuPoint; cls: GuUniverseRecordX['classification'] }>): GuUniverseRecordX => {
    const pts = act.slice().sort((a, b) => METRIC_ORDER[a.a.it.metric] - METRIC_ORDER[b.a.it.metric] || PERIOD_CLASS_ORDER[a.cls] - PERIOD_CLASS_ORDER[b.cls]
      || (periodEnd(a.a.it.period, a.a.it.market, a.a.it.src.date).end?.getTime() ?? 9e15) - (periodEnd(b.a.it.period, b.a.it.market, b.a.it.src.date).end?.getTime() ?? 9e15));
    // headline = the best revenue point (annual before multi-year), else the next metric in order
    const head = pts[0]; const rest = pts.slice(1);
    const base = head.a.it;
    const gc0 = base.gc ? { ...base.gc } : companyOf(base, pts.map((p) => p.a.it), head.pt, e);
    const gc: GgCompany = { ...gc0, verification: head.pt.verification };
    const tracking = pts.map((p) => p.a.it.gc?.reality?.tracking).find((t) => t === 'AT_RISK' || t === 'BROKEN');
    const resolved = !isUnresolved(e);
    const blockingAll = pts.every((p) => p.pt.inDefaultView);
    const allReasons: GuReviewReasonX[] = [];
    for (const p of pts) for (const r of p.pt.reviewReasons) if (!allReasons.some((x) => x.code === r.code && x.text === r.text)) allReasons.push(r);
    allReasons.sort((x, y) => Number(y.blocks) - Number(x.blocks));
    const caveats = [...allReasons.filter((r) => !r.blocks).map((r) => r.text), ...(pts.some((p) => p.pt.staleVerification) ? [`Last verified more than ${STALE_VERIFICATION_DAYS} days ago; the record stays active until its period ends or it is replaced.`] : [])];
    const hp = head.pt;
    return {
      record: gc, origin: base.origin, display: hp.display, metric: base.metric,
      alsoDisplay: rest.map((r) => ({ metric: r.a.it.metric, display: r.pt.display, verification: r.pt.verification, period: r.a.it.period, sourceDate: r.a.it.src.date, sourceName: r.a.it.src.name, implied: r.pt.implied,
        secondaryDisplay: r.pt.secondaryDisplay, impliedDisplay: r.pt.impliedDisplay, periodStatus: r.pt.periodStatus, periodRunState: r.pt.periodRunState, needsReview: r.pt.needsReview,
        verificationState: r.pt.verificationState, growthType: r.pt.growthType, metricFamily: r.pt.metricFamily, basisLabel: r.pt.basisLabel })) as GuUniverseRecord['alsoDisplay'],
      mediaOnly: base.verification === 'SECONDARY_ONLY', revision: hp.revision, atRisk: !!tracking,
      entityKey: e, tickers: Array.from(tickerSets.get(e) || []), names: Array.from(nameSets.get(e) || []), period: base.period, classification: head.cls, points: pts.map((p) => p.pt),
      sourceName: base.src.name, sourceType: base.src.type, sourceUrl: base.src.url, sourceDate: base.src.date, sourceRank: base.src.rank, primarySource: hp.primarySource,
      statement: base.statement, notes: base.notes, activeNote: head.a.note,
      periodUnclear: hp.periodStatus !== 'CONFIRMED', periodStatus: hp.periodStatus, periodRunState: hp.periodRunState, needsReview: hp.needsReview, secondaryDisplay: hp.secondaryDisplay, impliedDisplay: hp.impliedDisplay,
      companyId: resolved ? e : null, tickerResolved: resolved, status: hp.status, current: hp.current,
      verificationState: hp.verificationState, growthType: hp.growthType, guidanceType: hp.guidanceType, claimType: hp.claimType, metricFamily: hp.metricFamily,
      sourceTier: hp.sourceTier, primarySourceFound: hp.primarySourceFound, primarySourceRead: hp.primarySourceRead, primarySourceText: hp.primarySourceText,
      basisLabel: hp.basisLabel, growthVsPriorYear: hp.growthVsPriorYear, revisionVsPriorGuidance: hp.revisionVsPriorGuidance,
      fiscalYear: hp.fiscalYear, fiscalQuarter: hp.fiscalQuarter, periodLabelSource: hp.periodLabelSource, periodNormalized: hp.periodNormalized, durationType: hp.durationType, cohort: hp.cohort,
      history: hp.history, lastVerified: hp.lastVerified, lastVerifiedDaysAgo: hp.lastVerifiedDaysAgo, staleVerification: hp.staleVerification,
      sources: hp.sources, sourceConflict: hp.sourceConflict, primaryValue: hp.primaryValue, mediaClaim: hp.mediaClaim,
      reviewReasons: blockingAll ? [] : allReasons.map((r) => r.text), reviewReasonCodes: blockingAll ? [] : allReasons.map((r) => r.code), inReviewQueue: !blockingAll, caveats,
      listBucket: pts.every((p) => p.pt.listBucket === 'ACTIVE') ? 'ACTIVE' : pts.every((p) => p.pt.listBucket === 'CLAIMS') ? 'CLAIMS' : 'REVIEW',
      eventOverride: hp.eventOverride, latestEvent: hp.latestEvent,
      calculationType: hp.calculationType, verificationStatus: hp.verificationStatus, freshness: hp.freshness, wording: hp.wording,
    };
  };
  const cmpRec = (a: GuUniverseRecordX, b: GuUniverseRecordX) => (a.record.market === b.record.market ? 0 : a.record.market === 'IN' ? -1 : 1) || (b.points[0].compareValue ?? -1) - (a.points[0].compareValue ?? -1) || a.record.company.localeCompare(b.record.company);
  const records: GuUniverseRecordX[] = []; const defaultRecords: GuUniverseRecordX[] = []; const reviewQueue: GuUniverseRecordX[] = []; const claimsAwaiting: GuUniverseRecordX[] = [];
  for (const [e, actRaw] of Array.from(activeByEntity.entries())) {
    const act = actRaw.map((a) => {
      const pt = pointOf(a.it, a.history, a.ps, { now, versions: a.versions, lifecycle: 'ACTIVE', expiryReason: null, sources: a.sources, conflict: a.conflict, primaryValue: a.primaryValue, mediaClaim: a.mediaClaim, pf: a.pf, resolved: !isUnresolved(e), dupOf: dupOf.get(e) || null, events: eventsFor(e, a.it) });
      return { a, pt, cls: classOf(a.it.pkind) };
    });
    // zzz854: invariants are ENFORCED, not just reported: an Active point that breaks a rule is demoted to "Needs review" with the rule as its reason
    const resolved = !isUnresolved(e);
    for (const x of act) {
      if (x.pt.listBucket !== 'ACTIVE') continue;
      const bad = activePointViolations({ companyId: resolved ? e : null, ticker: x.a.it.ticker || Array.from(tickerSets.get(e) || [])[0] || null, market: x.a.it.market }, x.pt);
      if (bad.length) { x.pt.reviewReasons.push({ code: 'INVARIANT_FAILED', text: `Data check failed, so it is kept out of Active: ${bad.map((b: { message: string }) => b.message).join(' ')}`, blocks: true }); x.pt.listBucket = 'REVIEW'; x.pt.inDefaultView = false; }
    }
    const full = mkRecord(e, act); records.push(full);
    const elig = act.filter((x) => x.pt.listBucket === 'ACTIVE'), rev = act.filter((x) => x.pt.listBucket === 'REVIEW'), clm = act.filter((x) => x.pt.listBucket === 'CLAIMS');
    if (elig.length === act.length) defaultRecords.push(full);
    else {
      if (elig.length) defaultRecords.push(mkRecord(e, elig));
      if (rev.length) reviewQueue.push(mkRecord(e, rev));
      if (clm.length) claimsAwaiting.push(mkRecord(e, clm));
    }
  }
  records.sort(cmpRec); defaultRecords.sort(cmpRec); reviewQueue.sort(cmpRec); claimsAwaiting.sort(cmpRec);
  const stored: GuStoredPoint[] = [];
  for (const r of records) for (const p of r.points) {
    const it = activeByEntity.get(r.entityKey)!.find((a) => a.it.metric === p.metric && a.it.period === p.period)!.it;
    if (it.origin === 'RESEARCHED_SEED' || it.origin === 'COMPANY_DOC') continue;   // zzz857: company-document rows are re-read from their extract results every time. Never frozen into the store: the data file is authoritative and re-read each time
    const slot = `${it.market}|${r.entityKey}|${it.metric}|${normPeriod(it.period)}`;
    stored.push({ key: `${slot}|${hash(`${it.src.url || it.src.name}|${it.src.date}|${p.display}`)}`, slot, market: it.market, ticker: it.ticker, company: it.company, metric: it.metric, low: it.low, high: it.high, open: it.open, gOrigin: it.gOrigin, abs: it.abs, base: it.base ?? null, needsReview: it.needsReview ?? null,
      period: it.period, pkind: it.pkind, kind: it.kind, organic: it.organic, verification: it.verification, statement: it.statement.slice(0, 300), src: it.src, priors: r.points.find((x) => x === p)!.priors.slice(-3), origin: it.origin, display: p.display,
      periodContext: it.periodContext ?? null, primarySourceRead: it.primarySourceRead ?? null, sourceMetricLabel: it.sourceMetricLabel ?? null, lastVerified: it.lastVerified ?? null });
  }
  return { records, inactive, excluded, stored, defaultRecords, reviewQueue, claimsAwaiting };
}

/** What the page shows in a metric column: the figure, or '—' with 'not verified' when no such statement exists. Never infers PAT from revenue. */
export function metricCell(rec: GuUniverseRecordX, metric: GgMetric): { text: string; note: string | null; verification: GgVerification | null; period: string | null } {
  const p = rec.points.find((x) => x.metric === metric && x.periodKind !== 'MULTI_YEAR_CAGR') || rec.points.find((x) => x.metric === metric);
  if (!p) return { text: '—', note: 'not verified', verification: null, period: null };
  return { text: p.display, note: p.verification === 'VERIFIED' ? null : p.verification === 'PARTIALLY_VERIFIED' ? 'partly verified' : 'media only', verification: p.verification, period: p.period };
}

// ═══ summary ═══════════════════════════════════════════════════════════════════════════════════
/**
 * HIGH-GROWTH RULE (owner's spec, one function). Every high-growth list and count is computed from the rows returned here, never recomputed elsewhere.
 * A company is in when an ACTIVE record has a revenue (and, separately, a PAT) point that
 *  - has a % (a target amount with no % is never high-growth) whose comparison value is >= threshold (stated figure / midpoint of a closed range / lower bound of an open '80%+'),
 *  - is for a FY / CY / rolling-12M period (SINGLE_YEAR) or an explicit multi-year CAGR (MULTI_YEAR_CAGR, flagged 'CAGR, multi-year', listed after and counted apart from single-year),
 *  - is not a proxy (presales, bookings), is VERIFIED or PARTIALLY_VERIFIED, is not flagged 'needs review', and has a period that is ACTIVE with a stated year.
 * Order: single-year before CAGR, then highest comparison value first ('highest verified guidance', not 'best').
 */
export const HIGH_GROWTH_LABEL = 'Highest verified guidance' as const;
export const HIGH_GROWTH_RULE = 'Revenue or PAT growth at or above the threshold on the comparison value (stated figure, midpoint of a closed range, lower bound of an open range); active FY/CY/rolling-12M guidance, or an explicit multi-year CAGR listed separately; proxy metrics (presales, bookings), target amounts with no % stated, flagged and unverified-media records excluded.';
const hgMetric = (p: GuPoint): GuHighGrowthMetric => ({ display: p.display, compareValue: p.compareValue as number, period: p.period, verification: p.verification, implied: p.implied, impliedBase: p.implied ? p.impliedGrowth?.baseLabel ?? null : null });
export function selectHighGrowth(records: GuUniverseRecordX[], thr = HIGH_GROWTH_THRESHOLD): GuHighGrowthRowX[] {
  const rows: Array<Omit<GuHighGrowthRowX, 'rank'>> = [];
  for (const r of records) {
    for (const horizon of ['SINGLE_YEAR', 'MULTI_YEAR_CAGR'] as GuHighGrowthHorizon[]) {
      const q = (m: GgMetric) => r.points.filter((p) => p.metric === m && p.hg === horizon && p.compareValue != null && p.compareValue >= thr && !growthScopeIssue(p.statement, p.metricFamily, r.record.company)).sort((a, b) => (b.compareValue as number) - (a.compareValue as number))[0] || null;
      const rev = q('REVENUE'), pat = q('PAT'); if (!rev && !pat) continue;
      const head = !pat || (rev && (rev.compareValue as number) >= (pat.compareValue as number)) ? rev! : pat;
      rows.push({
        entityKey: r.entityKey, company: r.record.company, ticker: r.record.ticker || r.tickers[0] || null, market: r.record.market, horizon, horizonLabel: horizon === 'MULTI_YEAR_CAGR' ? 'CAGR, multi-year' : null,
        metric: head.metric, display: head.display, compareValue: head.compareValue as number, period: head.period, verification: head.verification, implied: head.implied, impliedBase: head.implied ? head.impliedGrowth?.baseLabel ?? null : null,
        id: `${r.entityKey}|${horizon}`, guidance: [rev ? `${rev.display} Revenue` : '', pat ? `${pat.display} PAT` : ''].filter(Boolean).join(' / '),
        alsoDisplay: head === rev && pat ? [{ metric: 'PAT', display: pat.display, verification: pat.verification }] : head === pat && rev ? [{ metric: 'REVENUE', display: rev.display, verification: rev.verification }] : [],
        periodUnclear: false, mediaOnly: false,
        revenue: rev ? hgMetric(rev) : null, pat: pat ? hgMetric(pat) : null, revision: head.revision,
        verificationState: head.verificationState, growthType: head.growthType, basisLabel: head.basisLabel, revisionVsPriorGuidance: head.revisionVsPriorGuidance?.display ?? null, periodNormalized: head.periodNormalized, cohort: head.cohort, sourceName: head.sourceName, sourceDate: head.sourceDate, sourceUrl: head.sourceUrl, label: HIGH_GROWTH_LABEL,
      });
    }
  }
  rows.sort((a, b) => (a.horizon === b.horizon ? 0 : a.horizon === 'SINGLE_YEAR' ? -1 : 1) || b.compareValue - a.compareValue || (a.verification === b.verification ? 0 : a.verification === 'VERIFIED' ? -1 : b.verification === 'VERIFIED' ? 1 : 0) || a.company.localeCompare(b.company));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
function marketSummary(rs: GuUniverseRecordX[], hg: GuHighGrowthRowX[]): GuMarketSummary {
  const keys = new Set(rs.map((r) => r.entityKey)); const mine = hg.filter((h) => keys.has(h.entityKey)); const single = mine.filter((h) => h.horizon === 'SINGLE_YEAR');
  return { companies: rs.length, revenueGe30: single.filter((h) => h.revenue).length, patGe30: single.filter((h) => h.pat).length, multiMetric: single.filter((h) => h.revenue && h.pat).length, cagrMultiYear: mine.filter((h) => h.horizon === 'MULTI_YEAR_CAGR').length };
}
function bucketOf(rs: GuUniverseRecordX[], hg: GuHighGrowthRowX[]): GuUniverseBucket {
  const keys = new Set(rs.map((r) => r.entityKey)); const rev = hg.filter((h) => keys.has(h.entityKey) && h.horizon === 'SINGLE_YEAR' && h.revenue);
  const best = rev.slice().sort((a, b) => (b.revenue!.compareValue - a.revenue!.compareValue))[0];
  const m = marketSummary(rs, hg);
  return { companies: m.companies, revenueGte30: m.revenueGe30, patGte30: m.patGe30, revenueAndPatGte30: m.multiMetric, highestRevenue: best ? { company: best.company, display: best.revenue!.display } : null };
}
const FAMILY_WORD: Record<GuMetricFamily, string> = { REVENUE: 'Revenue', NET_PROFIT: 'PAT', EBITDA: 'EBITDA', EPS: 'EPS', FCF: 'FCF' };
const FAMILY_ORDER: Record<GuMetricFamily, number> = { REVENUE: 0, NET_PROFIT: 1, EBITDA: 2, EPS: 3, FCF: 4 };
const TRUST_ORDER: GuTrust[] = ['verified', 'derived', 'partial', 'claimsAwaiting'];
const COHORTS: GuCohort[] = ['ANNUAL', 'MULTI_YEAR_CAGR', 'QUARTERLY'];
const trustOf = (s: GuVerificationState): GuTrust | null => (s === 'VERIFIED' ? 'verified' : s === 'DERIVED' ? 'derived' : s === 'PARTIAL' ? 'partial' : s === 'UNVERIFIED' ? 'claimsAwaiting' : null);
/** Short growth text for a group row: '+60%', '+94–108% (derived)', '+43% (implied)', with ' CAGR' for a multi-year rate. Full text with its basis is in `display`. */
function shortGrowth(p: GuPoint): string {
  if (p.low == null) return p.display;
  let t: string;
  if (p.growthType === 'DERIVED' && p.growthExact && p.growthDerivation) { const rg = p.growthDerivation.currentLow !== p.growthDerivation.currentHigh; t = `${pctText(p.growthExact.low, rg ? p.growthExact.high : null, false, derivedDp(p.growthExact.low, rg ? p.growthExact.high : null))} (derived)`; }
  else if (p.growthType === 'IMPLIED') t = `${pctText(p.low, p.open ? null : p.high === p.low ? null : p.high, p.open, derivedDp(p.low, p.high === p.low ? null : p.high))} (implied)`;
  else t = pctText(p.low, p.open ? null : p.high === p.low ? null : p.high, p.open);
  return p.cohort === 'MULTI_YEAR_CAGR' ? t.replace(/^([^ ]+)/, '$1 CAGR') : t;
}
const hgMetricX = (p: GuPoint): GuHgMetricX => ({
  metric: p.metric, metricFamily: p.metricFamily, sourceMetricLabel: p.sourceMetricLabel, display: p.display, short: shortGrowth(p), compareValue: p.compareValue as number, period: p.period, periodNormalized: p.periodNormalized,
  verificationState: p.verificationState, growthType: p.growthType, guidanceType: p.guidanceType, basisLabel: p.basisLabel, headlineBasis: p.headlineBasis, revisionVsPriorGuidance: p.revisionVsPriorGuidance?.display ?? null, sourceConflict: p.sourceConflict,
  calculationType: p.calculationType, verificationStatus: p.verificationStatus, wording: p.wording, freshness: p.freshness, lastVerifiedDaysAgo: p.lastVerifiedDaysAgo,
  derivation: p.growthDerivation ?? null,
});
/**
 * zzz853: the high-growth rows GROUPED, never one mixed ranking. A point qualifies when it is management guidance, ACTIVE, has a CONFIRMED period, is not flagged / proxy,
 * has a % at or above the threshold, and belongs to a cohort: ANNUAL (single FY/CY/12M), MULTI_YEAR_CAGR (multi-year, never counted as single-year) or QUARTERLY.
 * Revenue, PAT (net profit) and EBITDA are kept as separate metrics inside a row (Revenue +30% · PAT +60%); one metric is never counted as another.
 * Trust sections: verified (strict: VERIFIED + CONFIRMED + active), derived, partial, claimsAwaiting (media / secondary only). Each section is split by cohort and sorted within the cohort.
 */
export function selectHighGrowthGroups(records: GuUniverseRecordX[], thr = HIGH_GROWTH_THRESHOLD, claims: GuUniverseRecordX[] = []): GuHighGrowthGroups {
  const FAM = new Set<GuMetricFamily>(['REVENUE', 'NET_PROFIT', 'EBITDA']);
  const base = (p: GuPoint, company?: string | null) => FAM.has(p.metricFamily) && !!p.cohort && p.compareValue != null && p.low != null && p.compareValue >= thr && p.claimType === 'MANAGEMENT_GUIDANCE' && p.status === 'ACTIVE' && p.periodRunState === 'ACTIVE' && !p.proxy && !p.needsReview
    // zzz881: a segment / plant / channel figure, a share of revenue, a reported result or a volume is never ranked as company growth
    && !growthScopeIssue(p.statement, p.metricFamily, company);
  type Acc = { r: GuUniverseRecordX; cohort: GuCohort; trust: GuTrust; pts: GuPoint[] };
  const byTrust = new Map<string, Acc>(); const byCohort = new Map<string, Acc>();
  const add = (m: Map<string, Acc>, k: string, r: GuUniverseRecordX, cohort: GuCohort, trust: GuTrust, p: GuPoint) => { const cur = m.get(k) || { r, cohort, trust, pts: [] }; cur.pts.push(p); m.set(k, cur); };
  for (const r of records) for (const p of r.points) {
    if (!base(p, r.record.company) || p.periodStatus !== 'CONFIRMED' || !p.inDefaultView || (p.listBucket && p.listBucket !== 'ACTIVE')) continue;
    const trust = trustOf(p.verificationState); if (!trust || trust === 'claimsAwaiting') continue;   // zzz854: an unverified claim is never in the ranked Active list
    // zzz862: a verification older than the freshness limit (60 days) is not "strictly verified" any more: it stays in Active (with its re-check tag) but leaves the strict list
    if (!(trust === 'verified' && p.freshness === 'STALE')) add(byTrust, `${r.entityKey}|${p.cohort}|${trust}`, r, p.cohort!, trust, p);
    add(byCohort, `${r.entityKey}|${p.cohort}`, r, p.cohort!, trust, p);
  }
  // zzz854: claims awaiting verification come from their OWN list, never from the Active records
  for (const r of claims) for (const p of r.points) {
    if (!base(p, r.record.company) || (p.listBucket && p.listBucket !== 'CLAIMS')) continue;
    add(byTrust, `${r.entityKey}|${p.cohort}|claimsAwaiting`, r, p.cohort!, 'claimsAwaiting', p);
  }
  const rowOf = (a: Acc, id: string): Omit<GuHgGroupRow, 'rank'> => {
    // one point per family: the highest comparison value
    const byFam = new Map<GuMetricFamily, GuPoint>();
    for (const p of a.pts) { const c = byFam.get(p.metricFamily); if (!c || (p.compareValue as number) > (c.compareValue as number)) byFam.set(p.metricFamily, p); }
    const ms = Array.from(byFam.values()).sort((x, y) => FAMILY_ORDER[x.metricFamily] - FAMILY_ORDER[y.metricFamily]);
    const head = ms.slice().sort((x, y) => (y.compareValue as number) - (x.compareValue as number) || FAMILY_ORDER[x.metricFamily] - FAMILY_ORDER[y.metricFamily])[0];
    const metrics = ms.map(hgMetricX);
    const trust = a.trust === 'claimsAwaiting' ? 'claimsAwaiting' : trustOf(head.verificationState) ?? a.trust;
    return { id, entityKey: a.r.entityKey, company: a.r.record.company, ticker: a.r.record.ticker || a.r.tickers[0] || null, market: a.r.record.market, cohort: a.cohort, trust, metrics,
      text: metrics.map((m) => `${FAMILY_WORD[m.metricFamily]} ${m.short}`).join(' · '), headline: hgMetricX(head), sourceName: head.sourceName, sourceDate: head.sourceDate, sourceUrl: head.sourceUrl };
  };
  const trustRows = Array.from(byTrust.entries()).map(([k, a]) => rowOf(a, k));
  // the ranked Active list: ONE row per company per cohort (a company whose revenue is verified and whose PAT is derived is one row, each metric keeps its own badge)
  const activeRows = Array.from(byCohort.entries()).map(([k, a]) => rowOf(a, k));
  const cmp = (a: Omit<GuHgGroupRow, 'rank'>, b: Omit<GuHgGroupRow, 'rank'>) => b.headline.compareValue - a.headline.compareValue || a.company.localeCompare(b.company);
  const rank = (list: Array<Omit<GuHgGroupRow, 'rank'>>): GuHgGroupRow[] => list.map((r, i) => ({ ...r, rank: i + 1 }));
  const cohorts = {} as Record<GuCohort, GuHgGroupRow[]>; const trust = {} as Record<GuTrust, Record<GuCohort, GuHgGroupRow[]>>;
  for (const c of COHORTS) cohorts[c] = rank(activeRows.filter((r) => r.cohort === c).sort(cmp));
  for (const t of TRUST_ORDER) { trust[t] = {} as Record<GuCohort, GuHgGroupRow[]>; for (const c of COHORTS) trust[t][c] = rank(trustRows.filter((r) => r.trust === t && r.cohort === c).sort(cmp)); }
  const n = (l: Array<Omit<GuHgGroupRow, 'rank'>>, f: (r: Omit<GuHgGroupRow, 'rank'>) => boolean) => l.filter(f).length;
  return { threshold: thr, label: HIGH_GROWTH_LABEL, rule: HIGH_GROWTH_GROUPS_RULE, cohorts, trust,
    counts: { rows: activeRows.length, verified: n(trustRows, (r) => r.trust === 'verified'), derived: n(trustRows, (r) => r.trust === 'derived'), partial: n(trustRows, (r) => r.trust === 'partial'), claimsAwaiting: n(trustRows, (r) => r.trust === 'claimsAwaiting'),
      ANNUAL: n(activeRows, (r) => r.cohort === 'ANNUAL'), MULTI_YEAR_CAGR: n(activeRows, (r) => r.cohort === 'MULTI_YEAR_CAGR'), QUARTERLY: n(activeRows, (r) => r.cohort === 'QUARTERLY'),
      companies: new Set(activeRows.map((r) => r.entityKey)).size } };
}
export const HIGH_GROWTH_GROUPS_RULE = 'Grouped, never one mixed ranking. Cohorts: ANNUAL (single FY/CY), MULTI_YEAR_CAGR, QUARTERLY. The ranked Active list has ONE row per company per cohort, built only from the Active list (verified, derived, or partial with the company document read). Trust sections: verified (primary source read, growth stated, period confirmed), derived (growth calculated from the primary source amounts), partial; claimsAwaiting comes from the separate Claims awaiting verification list (media / not read) and is never ranked with Active. Revenue, PAT and EBITDA are separate metrics.';

export interface GuSummaryIntegrity {
  /** zzz853: grouped high-growth rows (cohort x trust). The flat `highGrowth` list above is kept as it was. */ highGrowthGroups: GuHighGrowthGroups;
  /** zzz853: record counts by verification state, computed from the SAME records as every other number here */ counts: GuStateCounts;
  /** the same split by point (one record can carry several metrics) */ pointCounts: GuStateCounts;
  reviewQueueCount: number; reviewReasonCounts: Record<string, number>; /** zzz860: the one freshness rule: counts of the Active records by tier */ freshness: Record<GuFreshnessTier, number>; freshnessRule: string; staleVerificationCount: number; sourceConflictCount: number;
  /** auditable expiry: how many records left the active universe and why */ expiry: GuExpirySummary;
  /** zzz854: claims awaiting verification (never counted in Active) */ claimsAwaitingCount: number;
  /** zzz854: every header number with the equation it comes from (one filtered set per list) */ countEquations: GuCountEquations;
}
export interface GuSummaryX extends Omit<GuUniverseSummary, keyof GuSummaryAdditions>, GuSummaryAdditions, GuSummaryIntegrity { all: GuUniverseSummary['all'] & { pendingPrimary: number } }
const stateCounts = (states: GuVerificationState[]): GuStateCounts => ({
  activeRecords: states.length, verified: states.filter((s) => s === 'VERIFIED').length, partial: states.filter((s) => s === 'PARTIAL').length, derived: states.filter((s) => s === 'DERIVED').length,
  unverified: states.filter((s) => s === 'UNVERIFIED').length, periodUnclear: states.filter((s) => s === 'PERIOD_UNCLEAR').length,
});
/** zzz854: the header equations. Active = verified + derived + partial; highest active = Active rows at or above the threshold; nothing else is mixed in. */
export function countEquationsOf(active: GuUniverseRecordX[], groups: GuHighGrowthGroups, reviewQueue: GuUniverseRecordX[], claims: GuUniverseRecordX[]): GuCountEquations {
  const st = stateCounts(active.map((r) => r.verificationState));
  const other = st.activeRecords - st.verified - st.derived - st.partial;
  const companies = groups.counts.companies ?? new Set(Object.values(groups.cohorts).flat().map((r) => r.entityKey)).size;
  const activeKeys = new Set(active.map((r) => r.entityKey));
  const hgRows = Object.values(groups.cohorts).flat();
  const a = active.length, r = reviewQueue.length, c = claims.length;
  return {
    active: { value: a, holds: other === 0, parts: { verified: st.verified, derived: st.derived, partial: st.partial, other },
      text: `Active ${a} = ${st.verified} verified + ${st.derived} derived + ${st.partial} partial (company document read, growth % not stated by the company)${other ? ` + ${other} OTHER (data check failed)` : ''}` },
    highestActive: { value: groups.counts.rows, companies, threshold: groups.threshold, holds: hgRows.every((x) => activeKeys.has(x.entityKey)) && companies <= a,
      text: `Highest active guidance ${groups.counts.rows} = Active rows with Revenue, PAT or EBITDA guided growth of ${groups.threshold}% or more (${companies} of the ${a} active companies; one row per company per period type: ${groups.counts.ANNUAL} annual, ${groups.counts.MULTI_YEAR_CAGR} multi-year CAGR, ${groups.counts.QUARTERLY} quarterly)` },
    needsReview: { value: r, holds: true, text: `Needs review ${r} = active guidance kept out of Active because something does not add up (reason on each row)` },
    claimsAwaiting: { value: c, holds: true, text: `Claims awaiting verification ${c} = found in media or not yet confirmed by the company's own document; never ranked or counted in Active` },
    rows: { value: a + r + c, holds: true, parts: { active: a, review: r, claimsAwaiting: c }, text: `${a} active + ${r} need review + ${c} awaiting verification = ${a + r + c} rows (a company with metrics in two lists has a row in each)` },
  };
}
export function summarize(records: GuUniverseRecordX[], now: Date, threshold = HIGH_GROWTH_THRESHOLD, inactive: GuInactiveRecord[] = [], reviewQueue: GuUniverseRecordX[] = [], claims: GuUniverseRecordX[] = []): GuSummaryX {
  const groups = selectHighGrowthGroups(records, threshold, claims);
  const hg = selectHighGrowth(records, threshold); const inM = (m: 'IN' | 'US') => records.filter((r) => r.record.market === m);
  const allPoints = records.flatMap((r) => r.points);
  const reasonCounts: Record<string, number> = {};
  for (const r of reviewQueue) for (const c of r.reviewReasonCodes) reasonCounts[c] = (reasonCounts[c] || 0) + 1;
  const reasonsOf = (st: string) => inactive.filter((x) => x.status === st).length;
  const reasonList = [{ reason: 'period completed', count: reasonsOf('EXPIRED') }, { reason: 'superseded', count: reasonsOf('SUPERSEDED') }, { reason: 'withdrawn', count: reasonsOf('WITHDRAWN') }].filter((x) => x.count > 0);
  return {
    asOf: now.toISOString(), threshold,
    india: bucketOf(inM('IN'), hg), usa: bucketOf(inM('US'), hg),
    all: {
      active: records.length, raised: records.filter((r) => r.revision === 'RAISED').length, maintained: records.filter((r) => r.revision === 'MAINTAINED').length, cut: records.filter((r) => r.revision === 'LOWERED').length,
      atRisk: records.filter((r) => r.atRisk).length, mediaOnly: records.filter((r) => r.mediaOnly).length, pendingPrimary: records.filter((r) => !r.points.some((p) => p.primarySource)).length,
    },
    byMarket: { IN: marketSummary(inM('IN'), hg), US: marketSummary(inM('US'), hg), ALL: marketSummary(records, hg) },
    highGrowth: hg, highGrowthLabel: HIGH_GROWTH_LABEL, highGrowthRule: HIGH_GROWTH_RULE,
    expiredCount: inactive.filter((x) => x.status === 'EXPIRED').length,
    unknownPeriodCount: allPoints.filter((p) => p.periodRunState === 'UNKNOWN').length,
    awaitingVerificationCount: [...records, ...claims].filter((r) => r.points.some((p) => (p.awaitingVerification || p.listBucket === 'CLAIMS') && p.compareValue != null && p.compareValue >= threshold)).length,
    needsReviewCount: allPoints.filter((p) => p.needsReview).length,
    highGrowthGroups: groups, claimsAwaitingCount: claims.length, countEquations: countEquationsOf(records, groups, reviewQueue, claims),
    counts: stateCounts(records.map((r) => r.verificationState)), pointCounts: stateCounts(allPoints.map((p) => p.verificationState)),
    reviewQueueCount: reviewQueue.length, reviewReasonCounts: reasonCounts,
    freshness: freshnessCounts(records.map((r) => r.lastVerifiedDaysAgo)), freshnessRule: FRESHNESS_RULE,
    staleVerificationCount: records.filter((r) => r.staleVerification).length, sourceConflictCount: records.filter((r) => r.sourceConflict).length,
    expiry: { expired: reasonsOf('EXPIRED'), superseded: reasonsOf('SUPERSEDED'), withdrawn: reasonsOf('WITHDRAWN'), total: inactive.length, reasons: reasonList },
  };
}

// ═══ regression: the owner's list vs what the sources say ═══════════════════════════════════════
export interface GuOwnerClaim { low: number; high: number | null; text: string }
/** Reads '35-40% Top line', '80%+revenue', '60% revenue and 70% PAT', '40% Growth topline and Bottomline' into per-metric claims. A figure with no metric word is read as revenue. */
export function parseOwnerText(text: string): Partial<Record<GgMetric, GuOwnerClaim>> {
  const out: Partial<Record<GgMetric, GuOwnerClaim>> = {};
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*%(\+)?/gi;
  const hits: Array<{ m: RegExpExecArray; end: number }> = []; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) hits.push({ m, end: m.index + m[0].length });
  hits.forEach((h, i) => {
    const after = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].m.index : text.length);
    const rev = /\b(revenue|top[- ]?line|sales)\b/i.test(after), pat = /\b(pat|profit|bottom[- ]?line)\b/i.test(after);
    const ms: GgMetric[] = rev || pat ? [...(rev ? (['REVENUE'] as GgMetric[]) : []), ...(pat ? (['PAT'] as GgMetric[]) : [])] : ['REVENUE'];
    const lo = parseFloat(h.m[1]), hi = h.m[2] ? parseFloat(h.m[2]) : null;
    const claim: GuOwnerClaim = h.m[3] ? { low: lo, high: null, text: `${fnum(lo)}%+` } : hi != null ? { low: lo, high: hi, text: `${fnum(lo)}–${fnum(hi)}%` } : { low: lo, high: lo, text: `${fnum(lo)}%` };
    for (const mm of ms) if (!out[mm]) out[mm] = claim;
  });
  return out;
}
const overlaps = (o: GuOwnerClaim, fLow: number, fHigh: number | null, tol: number) => o.low - tol <= (fHigh ?? Infinity) && (o.high ?? Infinity) + tol >= fLow;
const emptyCounts = (): Record<GuRegressionStatus, number> => ({ VERIFIED: 0, PARTIALLY_VERIFIED: 0, NOT_FOUND: 0, REJECTED: 0, SUPERSEDED: 0, EXPIRED: 0 });
export interface GuRegressionRowX extends GuRegressionRow {
  sourceUrl: string | null; verification: GgVerification | null; foundOrigin: GuUniverseRecordOrigin | null;
  // ── zzz853: the owner's regression columns (every one of the listed claims appears; nothing is forced to pass) ──
  /** the company resolved to a ticker */ resolved: boolean;
  /** a guidance statement for this company + metric was found */ guidanceFound: boolean;
  /** any source (primary or media) was found for it */ sourceFound: boolean;
  /** 'PRIMARY SOURCE FOUND' | 'primary source not found' */ primarySource: string; primarySourceRead: boolean | null;
  growthType: 'explicit' | 'derived' | 'implied' | 'unknown' | null;
  currentGuidance: string | null; previousGuidance: string | null;
  /** still current (not expired / superseded) */ active: boolean; inDefaultView: boolean | null;
  verificationState: GuVerificationState | null;
  /** why guidance or its primary source is missing (null when both were found) */ reasonIfMissing: string | null;
  /** growth against the prior-year actual and the revision against the prior guidance, kept as two separate labelled facts */
  growthVsPriorYear: GuGrowthVsPriorYear | null; revisionVsPriorGuidance: GuRevisionVsPrior | null;
  /** one plain sentence: what was found, on which basis, and what is still missing */ finding: string;
  reviewReasons: string[];
}
export interface GuRegressionResponseX extends GuRegressionResponse { rows: GuRegressionRowX[]; /** distinct companies in the table */ companies: number; columns: string[] }
export interface GuOwnerRow { ownerText: string; company?: string; ticker?: string | null; market?: 'IN' | 'US'; metric?: GgMetric }

/** Pure. One row per owner statement (per metric). `ownerRows` default: every researched row that carries the owner's original text. */
export const REGRESSION_COLUMNS = ['company', 'resolved', 'guidanceFound', 'sourceFound', 'primarySource', 'period', 'metric', 'growthType', 'currentGuidance', 'previousGuidance', 'active', 'verificationState', 'reasonIfMissing'];
/** Adds the owner's regression columns to a row. Pure; every value comes from the found point (or the inactive record), never invented. */
function withRegressionExtras(r: GuRegressionRowX, pt: GuPoint | null, rec: GuUniverseRecordX | undefined, inact: GuInactiveRecord | undefined, resolved: boolean): GuRegressionRowX {
  const found = !!pt || !!inact && (r.status === 'EXPIRED' || r.status === 'SUPERSEDED');
  const prev = pt?.revisionVsPriorGuidance?.previous ?? (pt && pt.priors.length ? null : null);
  const lastPrior = pt && pt.priors.length ? pt.priors.filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date))[pt.priors.length - 1] : null;
  const previousGuidance = prev ? `${prev.display}${prev.date ? ` (${prev.date})` : ''}` : lastPrior ? `${fmtPrior(lastPrior)} (${lastPrior.date})` : null;
  const gt = pt ? (pt.growthType === 'EXPLICIT' ? 'explicit' : pt.growthType === 'DERIVED' ? 'derived' : pt.growthType === 'IMPLIED' ? 'implied' : 'unknown') : null;
  const primary = pt ? pt.primarySourceText : 'primary source not found';
  const parts: string[] = [];
  if (pt) {
    parts.push(`${pt.display} ${METRIC_WORD[pt.metric]} (${pt.period})`);
    if (pt.growthVsPriorYear) parts.push(`growth vs prior-year actual: ${pt.growthVsPriorYear.display}`);
    if (pt.revisionVsPriorGuidance) parts.push(`revision vs prior guidance: ${pt.revisionVsPriorGuidance.display}`);
    parts.push(pt.primarySourceFound ? (pt.primarySourceRead ? 'primary source read' : 'primary source found, not yet read') : 'primary source not found (media only)');
  }
  return {
    ...r, resolved, guidanceFound: !!pt, sourceFound: !!pt || (found && !!inact), primarySource: primary, primarySourceRead: pt ? pt.primarySourceRead : null, growthType: gt,
    currentGuidance: pt ? pt.display : inact ? inact.display : null, previousGuidance, active: !!pt && pt.status === 'ACTIVE', inDefaultView: pt ? pt.inDefaultView : null, verificationState: pt ? pt.verificationState : null,
    reasonIfMissing: !pt ? r.reason : pt.primarySourceFound ? null : 'Primary source not found: only media or another secondary source backs this, and the company filing has not been read yet.',
    growthVsPriorYear: pt?.growthVsPriorYear ?? null, revisionVsPriorGuidance: pt?.revisionVsPriorGuidance ?? null,
    finding: pt ? parts.join('; ') : r.reason, reviewReasons: rec && pt ? pt.reviewReasons.map((x) => x.text) : [],
  };
}
export function buildRegression(seedRows: GuSeedRow[], universe: Pick<GuUniverseBuild, 'records'> & Partial<Pick<GuUniverseBuild, 'inactive'>>, now: Date, ownerRows?: GuOwnerRow[]): GuRegressionResponseX {
  const owners: Array<{ o: GuOwnerRow; seed: GuSeedRow | null; metric: GgMetric }> = [];
  if (ownerRows) {
    for (const o of ownerRows) {
      const claims = parseOwnerText(o.ownerText); const wanted = o.metric ? [o.metric] : (Object.keys(claims) as GgMetric[]);
      for (const metric of wanted.length ? wanted : (['REVENUE'] as GgMetric[])) {
        const seed = seedRows.find((s) => s.metric === metric && ((o.ticker && s.ticker === o.ticker) || (o.company && normCompanyName(s.company) === normCompanyName(o.company)))) || null;
        owners.push({ o, seed, metric });
      }
    }
  } else for (const s of seedRows) if (s.ownerListText) owners.push({ o: { ownerText: s.ownerListText, company: s.company, ticker: s.ticker, market: s.market, metric: s.metric }, seed: s, metric: s.metric });
  const rows: GuRegressionRowX[] = [];
  for (const { o, seed, metric } of owners) {
    const company = seed?.company || o.company || 'Unknown company'; const ticker = seed?.ticker ?? o.ticker ?? null; const market = seed?.market || o.market || 'IN';
    const claim = parseOwnerText(o.ownerText)[metric] || null;
    const expected = claim ? `${claim.text} ${METRIC_WORD[metric]}` : o.ownerText;
    const nm = normCompanyName(company);
    const rec = universe.records.find((r) => r.record.market === market && ((ticker && r.tickers.includes(ticker)) || r.names.includes(nm)));
    const pts = rec ? rec.points.filter((p) => p.metric === metric) : [];
    const pt = pts.find((p) => seed && normPeriod(p.period) === normPeriod(seed.period)) || pts[0] || null;
    const base = { ownerText: o.ownerText, company, ticker, market, expected };
    let inactF: GuInactiveRecord | undefined;
    const push = (r: GuRegressionRowX) => { rows.push(withRegressionExtras(r, pt, rec, inactF, !!ticker || !!rec?.tickerResolved)); };
    const row = (status: GuRegressionStatus, reason: string, found = '—', p: GuPoint | null = null): GuRegressionRowX => ({
      ...base, found, source: p?.sourceName ?? null, sourceDate: p?.sourceDate ?? null, period: p?.period ?? null, metric: p ? metric : null, status, reason, sourceUrl: p?.sourceUrl ?? null, verification: p?.verification ?? null, foundOrigin: p?.origin ?? null,
    }) as GuRegressionRowX;
    if (!pt) {
      const inact = (universe.inactive || []).find((x) => x.market === market && x.metric === metric && (x.ticker === ticker || normCompanyName(x.company) === nm) && (!seed || normPeriod(x.period) === normPeriod(seed.period)));
      inactF = inact;
      if (inact && inact.status === 'EXPIRED') { push({ ...row('EXPIRED', `The guidance found was for ${inact.period}, which has ended. No newer guidance was found.`, `${inact.display} ${METRIC_WORD[metric]} (${inact.period})`), source: inact.sourceName, sourceDate: inact.sourceDate, period: inact.period, metric }); continue; }
      if (inact && inact.status === 'SUPERSEDED') { push({ ...row('SUPERSEDED', 'A later record replaced this guidance.', `${inact.display} ${METRIC_WORD[metric]} (${inact.period})`), source: inact.sourceName, sourceDate: inact.sourceDate, period: inact.period, metric }); continue; }
      const why = seed && seed.verification === 'UNVERIFIED' ? `No source we could read says this. ${seed.notes.replace(/^CONFLICT:\s*/i, '').slice(0, 240)}` : 'No source found for this company and metric.';
      push({ ...row('NOT_FOUND', why), period: seed?.period ?? null, metric });
      continue;
    }
    const found = `${pt.display} ${METRIC_WORD[metric]} (${pt.period})`;
    if (pt.sourceRank >= 11) { push(row('NOT_FOUND', `Only a ${pt.sourceRank === 12 ? 'social-media post' : 'blog or forum post'} gives a figure (${pt.display}). That is not a usable source, so the claim is not confirmed.`, found, pt)); continue; }
    if (pt.low == null) { push(row('PARTIALLY_VERIFIED', `The source gives a rupee or dollar target but no growth percent, so your ${expected} cannot be checked against it.`, found, pt)); continue; }
    if (!claim) { push(row('PARTIALLY_VERIFIED', 'The list text gives no figure that can be compared.', found, pt)); continue; }
    const matches = overlaps(claim, pt.low, pt.open ? null : pt.high, REGRESSION_TOLERANCE_PP);
    const who = pt.primarySource ? `The company's own ${pt.sourceType.toLowerCase()}` : 'Media or commentary';
    if (matches) {
      const caveats: string[] = [];
      if (pt.periodKind === 'MULTI_YEAR_CAGR') caveats.push('The source gives a multi-year growth rate, not a single-year figure, so the period does not match.');
      if (pt.proxy) caveats.push(`The figure is for ${pt.proxy}, not reported revenue.`);
      if (pt.implied) caveats.push('The growth is worked out from a target amount, not stated as a percent by management.');
      if (pt.needsReview) caveats.push(`Flagged for review: ${pt.needsReview}`);
      const full = pt.verification === 'VERIFIED' && !pt.needsReview && !caveats.some((c) => !/worked out/.test(c));
      if (full) push(row('VERIFIED', `${who} (${pt.sourceDate || 'undated'}) says ${pt.display}. The list figure ${claim.text} is within ${REGRESSION_TOLERANCE_PP} points.${caveats.length ? ` ${caveats.join(' ')}` : ''}`, found, pt));
      else push(row('PARTIALLY_VERIFIED', `${pt.primarySource ? `${who} (${pt.sourceDate || 'undated'}) says ${pt.display}.` : `Only media or commentary backs this. It says ${pt.display}.`} The list figure ${claim.text} is within ${REGRESSION_TOLERANCE_PP} points.${pt.primarySource ? '' : " The company's own filing or transcript has not been read yet."}${caveats.length ? ` ${caveats.join(' ')}` : ''}`, found, pt));
      continue;
    }
    // number does not match: is the owner quoting an earlier target that management has since raised?
    const prior = pt.priors.filter((p) => p.low != null).find((p) => claim.low <= (p.high ?? p.low!) + PRIOR_NEIGHBOURHOOD_PP && claim.low >= (p.low as number) - PRIOR_NEIGHBOURHOOD_PP - REGRESSION_TOLERANCE_PP && pt.low! > (claim.high ?? claim.low));
    if (prior) { push(row('SUPERSEDED', `The list figure ${claim.text} is close to the earlier target (${fmtPrior(prior)}, ${prior.date}). Management has since raised guidance to ${pt.display}.${pt.needsReview ? ` Flagged for review: ${pt.needsReview}` : ''}`, found, pt)); continue; }
    const soft = pt.verification !== 'VERIFIED' || !pt.primarySource ? ` This rests on ${pt.primarySource ? 'a partly verified' : 'a media or secondary'} source and the company's own transcript has not been read, so it is the best figure found so far, not a final answer.` : '';
    const note = seed?.notes ? ` Researcher note: ${seed.notes.replace(/^CONFLICT:\s*/i, '').slice(0, 260)}` : '';
    push(row('REJECTED', `${who} says ${pt.display}. The list says ${claim.text}. The gap is more than ${REGRESSION_TOLERANCE_PP} points.${pt.implied ? ' The source figure is worked out from a target amount.' : ''}${pt.needsReview ? ` Flagged for review: ${pt.needsReview}` : ''}${soft}${note}`, found, pt));
  }
  const counts = emptyCounts(); for (const r of rows) counts[r.status]++;
  return { asOf: now.toISOString(), rows, counts, companies: new Set(rows.map((r) => `${r.market}|${normCompanyName(r.company)}`)).size, columns: REGRESSION_COLUMNS };
}
