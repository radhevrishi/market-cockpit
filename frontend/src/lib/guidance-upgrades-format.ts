// zzz843 — Guidance Upgrades: plain-English formatters. Client-safe, pure, no imports beyond types.
// Rule: a relative change is "+x%", a change between two rates (growth, margin) is "+x pp".
// The two are never mixed. A missing number prints DATA UNAVAILABLE, never zero.
import type { GuWindow, GuChange, GuGuidancePoint, GuNumber, GuDecision, GuMetric, GuThesis, GuGap, GuDuration, GuMateriality, GuPortfolioImpact, GuFlag, GuidanceEvent, GuRangeClass, GuDurabilityLevel, GuStage, GuScoreItem, GuMetricBasis, GuScanStatus, GuScanSource, GuSummary, GuRangeMath } from './guidance-upgrades-types';

export const UNAVAILABLE = 'DATA UNAVAILABLE';

const nf = (v: number, dp = 1) => {
  const a = Math.abs(v);
  const d = a >= 1000 ? 0 : a >= 100 ? 1 : dp;
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
};

/** Money amounts: a per-share amount keeps its cents ($4.20 stays $4.20, never $4.2 or $4); a scaled amount ($1.205B) keeps the
 *  digits the company gave; big amounts drop decimals. */
const nfMoney = (v: number, scaled: boolean) => {
  const a = Math.abs(v);
  if (!scaled) return v.toLocaleString('en-US', a >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3 });
};
/** The scale suffix as the engine writes it: 'B','M','K' attach to the number; 'Cr','L Cr' take a space. Currency symbol comes from the point. */
const scaleText = (u: string | undefined): string => (!u || u === '%' ? '' : u.length > 1 ? ` ${u}` : u);

/** '$10.8B', '$4.75', '₹5,000 Cr', '8%' (a growth rate). Range: '$10.7B to $10.9B'. Works for India and the USA. */
export function fmtPoint(p: GuGuidancePoint | null | undefined): string {
  if (!p) return UNAVAILABLE;
  const cur = p.currency || '';
  const sc = scaleText(p.unit);
  const one = (v: number) => (p.isGrowthRate ? `${nf(v)}%` : `${v < 0 ? '-' : ''}${cur}${nfMoney(Math.abs(v), !!sc)}${sc}`);
  if (p.low != null && p.high != null && p.low !== p.high) return `${one(p.low)} to ${one(p.high)}`;
  const v = p.midpoint ?? p.low ?? p.high;
  return v == null ? UNAVAILABLE : one(v);
}

/** '+12.5%' for a relative change, '+1.5 pp' for a change between rates. Null when neither exists. */
export function fmtDelta(c: GuChange): string | null {
  if (c.after.isGrowthRate) {
    const pp = c.percentagePointChange;
    if (pp == null) return null;
    return `${pp >= 0 ? '+' : '-'}${nf(Math.abs(pp))} pp`;
  }
  const pc = c.percentageChange;
  if (pc == null) return null;
  return `${pc >= 0 ? '+' : '-'}${nf(Math.abs(pc))}%`;
}

export function fmtBeforeAfter(c: GuChange): { before: string; after: string; delta: string | null } {
  return { before: c.before ? fmtPoint(c.before) : UNAVAILABLE, after: fmtPoint(c.after), delta: fmtDelta(c) };
}

export const METRIC_LABEL: Record<GuMetric, string> = {
  REVENUE: 'Revenue', REVENUE_GROWTH: 'Revenue growth', EBITDA: 'EBITDA', EBIT: 'Operating profit', OP_MARGIN: 'Operating margin',
  EPS: 'EPS', ADJ_EPS: 'Adjusted EPS', FCF: 'Free cash flow', FCF_CONVERSION: 'Cash conversion', ORGANIC_GROWTH: 'Organic growth',
  ORDER_INTAKE: 'Order intake', BACKLOG: 'Order backlog', VOLUME: 'Volume', PRODUCTION: 'Production', CAPACITY_UTIL: 'Capacity use', NET_PROFIT: 'Net profit', OTHER: 'Other',
};

export const DECISION_LABEL: Record<GuDecision, string> = {
  IMMEDIATE_BUY: 'IMMEDIATE BUY', WATCHLIST: 'WATCHLIST', DELAYED_EP: 'DELAYED EP', REJECT: 'REJECT', UNVERIFIED: 'UNVERIFIED',
};
export const THESIS_LABEL: Record<Exclude<GuThesis, null>, string> = {
  A: 'A Operating Inflection', B: 'B Demand Explosion', F: 'F Profit Jump', G: 'G Silent Quality',
};
export const GAP_LABEL: Record<GuGap, string> = {
  LARGE_POSITIVE: 'Large positive', POSITIVE: 'Positive', SMALL_POSITIVE: 'Small positive', INLINE: 'In line', NEGATIVE: 'Negative', UNKNOWN: UNAVAILABLE,
};
export const DURATION_LABEL: Record<GuDuration, string> = { ONE_OFF: 'One-off', MULTI_QUARTER: 'Several quarters', MULTI_YEAR: 'Several years', UNKNOWN: 'Unknown' };
export const MATERIALITY_LABEL: Record<GuMateriality, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', UNKNOWN: 'Unknown' };
export const IMPACT_LABEL: Record<GuPortfolioImpact, string> = { SUPPORTS: 'Supports', NEUTRAL: 'Neutral', WEAKENS: 'Weakens', BROKEN: 'Broken' };
export const FLAG_LABEL: Record<GuFlag, string> = {
  REPEATED_UPGRADER: 'REPEATED UPGRADER', GUIDANCE_PLUS_GAP: 'GUIDANCE + EXPECTATION GAP',
  GUIDANCE_PLUS_BOTTLENECK: 'GUIDANCE + STRUCTURAL BOTTLENECK', SECOND_UPGRADE_IN_WINDOW: 'SECOND UPGRADE', SMALL_MID_CAP_INFLECTION: 'SMALL/MID-CAP INFLECTION',
};

/** A GuNumber in plain words. Currency units the engine writes ('$B', '$M', '$', '₹ Cr', '₹ L Cr') print as '$10.3B', '$4.75', '₹5,000 Cr'.
 *  'pp' prints as points, '%' as percent, 'x' as a multiple. Missing prints DATA UNAVAILABLE, never zero. */
export function fmtNumber(n: GuNumber | null | undefined): string {
  if (!n || n.value == null) return UNAVAILABLE;
  const u = n.unit || '';
  if (u === '%') return `${nf(n.value)}%`;
  if (u === 'pp') return `${nf(n.value)} pp`;
  if (u === 'x') return `${nf(n.value)}x`;
  const m = /^(US\$|\$|₹|€|£)(.*)$/.exec(u);
  if (m) return `${n.value < 0 ? '-' : ''}${m[1] === 'US$' ? '$' : m[1]}${nfMoney(Math.abs(n.value), !!m[2])}${m[2]}`;
  return u ? `${nf(n.value)} ${u}` : nf(n.value);
}

export const LABEL_WORD: Record<GuNumber['label'], string> = {
  COMPANY_GUIDANCE: 'COMPANY GUIDANCE', CONSENSUS: 'CONSENSUS', REPORTED: 'REPORTED', MODEL_ESTIMATE: 'MODEL ESTIMATE', UNAVAILABLE: UNAVAILABLE,
};

export function ageDays(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}
export function agoText(iso: string | null | undefined, now: Date = new Date()): string {
  const d = ageDays(iso, now);
  return d == null ? 'date unknown' : d === 0 ? 'today' : `${d}d ago`;
}

/** 'Guidance up · Expectation gap: Negative' style note. Never says a missing consensus is negative. */
export function gapNote(gap: GuGap): string {
  return `Guidance up · Expectation gap: ${GAP_LABEL[gap]}`;
}

export function secondUpgradeText(e: GuidanceEvent): string | null {
  if (!e.flags.includes('SECOND_UPGRADE_IN_WINDOW')) return null;
  const raised = e.history.filter((h) => h.change === 'RAISED' || h.change === 'NARROWED_UP').map((h) => Date.parse(h.date)).filter(Number.isFinite).sort((a, b) => b - a);
  if (raised.length >= 2) return `Second upgrade in ${Math.max(0, Math.round((raised[0] - raised[1]) / 86_400_000))} days`;
  return 'Second upgrade in this window';
}

/** Unverified events carry no decision. This is the single place the UI asks. */
export function showsDecision(e: Pick<GuidanceEvent, 'verification' | 'primaryAvailable' | 'decision'>): boolean {
  return e.verification === 'VERIFIED' && e.primaryAvailable && e.decision !== 'UNVERIFIED';
}

export function metricFamilies(e: GuidanceEvent): string[] {
  const out = new Set<string>();
  for (const c of e.changes) {
    const m = c.after.metric;
    if (m === 'REVENUE' || m === 'REVENUE_GROWTH' || m === 'ORGANIC_GROWTH') out.add('REVENUE');
    if (m === 'EBITDA' || m === 'EBIT' || m === 'OP_MARGIN') out.add('EBITDA');
    if (m === 'EPS' || m === 'ADJ_EPS') out.add('EPS');
    if (m === 'FCF' || m === 'FCF_CONVERSION') out.add('FCF');
    if (m === 'NET_PROFIT') out.add('NET_PROFIT');
  }
  for (const n of e.v2?.statedMetrics || []) if (/net profit/i.test(n)) out.add('NET_PROFIT');
  if (e.changes.length > 1) out.add('MULTI_METRIC');
  const periods = new Set(e.changes.map((c) => c.after.period));
  if (periods.size > 1 || e.duration === 'MULTI_YEAR') out.add('MULTI_YEAR');
  return Array.from(out);
}

// ── Page filters (pure) ─────────────────────────────────────────────────
export type ScopeFilter = 'ALL' | 'INDIA' | 'USA' | 'MY_BOOK' | 'HIGH';
export type MetricFilter = 'ALL' | 'REVENUE' | 'EBITDA' | 'EPS' | 'FCF' | 'NET_PROFIT' | 'MULTI_METRIC' | 'MULTI_YEAR';

export function applyFilters(events: GuidanceEvent[], scope: ScopeFilter, metric: MetricFilter): GuidanceEvent[] {
  return events.filter((e) => {
    if (scope === 'INDIA' && e.market !== 'IN') return false;
    if (scope === 'USA' && e.market !== 'US') return false;
    if (scope === 'MY_BOOK' && !e.links.inBook) return false;
    if (scope === 'HIGH' && e.materiality !== 'HIGH') return false;
    if (metric !== 'ALL' && !metricFamilies(e).includes(metric)) return false;
    return true;
  });
}


// ── zzz844 V2 labels and helpers (plain English, pure) ──────────────────
export const RANGE_CLASS_LABEL: Record<GuRangeClass, string> = {
  CLEAN_RAISE: 'Clean raise', MIDPOINT_RAISE_RANGE_NARROWING: 'Midpoint up but range narrowed', RANGE_SHIFT_UP: 'Range shifted up',
  RANGE_WIDENING: 'Range widened', REITERATION: 'Reiteration', DOWNGRADE: 'Downgrade', FIRST_GUIDANCE: 'First guidance', UNKNOWN: UNAVAILABLE,
};
export const DURABILITY_LEVEL_LABEL: Record<GuDurabilityLevel, string> = {
  ONE_OFF: 'One-off', '1_2_QUARTERS': 'One to two quarters', MULTI_QUARTER: 'Several quarters', MULTI_YEAR: 'Several years',
  STRUCTURAL: 'Structural (long lasting)', UNKNOWN_INSUFFICIENT_EVIDENCE: 'Unknown, not enough evidence',
};
export const STAGE_ORDER: GuStage[] = ['CANDIDATE', 'PRIMARY_SOURCE_FOUND', 'PRIOR_GUIDANCE_FOUND', 'CALCULATED', 'VERIFIED', 'MATERIALITY_CHECKED', 'DECISION'];
export const STAGE_LABEL: Record<GuStage, string> = {
  CANDIDATE: 'CANDIDATE', PRIMARY_SOURCE_FOUND: 'PRIMARY SOURCE', PRIOR_GUIDANCE_FOUND: 'PRIOR GUIDANCE', CALCULATED: 'CALCULATED',
  VERIFIED: 'VERIFIED', MATERIALITY_CHECKED: 'MATERIALITY', DECISION: 'DECISION',
};
export const RATING_LABEL: Record<GuScoreItem['rating'], string> = { STRONG: 'STRONG', OK: 'OK', WEAK: 'WEAK', UNKNOWN: 'UNKNOWN' };
export const BASIS_LABEL: Record<GuMetricBasis, string> = {
  GAAP: 'GAAP', ADJUSTED: 'Adjusted', ORGANIC: 'Organic', REPORTED: 'Reported', CONSTANT_CURRENCY: 'Constant currency', UNSTATED: 'Basis not stated',
};
export const SCAN_STATE_LABEL: Record<string, string> = { COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', FAILED: 'FAILED', NOT_RUN: 'NOT RUN', NOT_AVAILABLE: 'NOT AVAILABLE' };
export const MARKET_NAME = { IN: 'India', US: 'USA' } as const;

export const WHY_NOW_UNRESOLVED = 'Driver unresolved after primary-source + recent-event research';
export const CONSENSUS_ABSENT = `${UNAVAILABLE} — not needed to detect this upgrade`;
export const AWAITING_PRIMARY = 'Awaiting primary source';
export const SCAN_INCOMPLETE = 'SCAN INCOMPLETE';
export const SCAN_COMPLETE = 'SCAN COMPLETE';
export const SCAN_INCOMPLETE_EMPTY = 'Scan incomplete — no events shown does NOT mean no upgrades. Some sources were not fully read. Check the coverage panel above.';

/** Stage of an event. News-only (no primary source) is always CANDIDATE, whatever the engine said. */
export function stageOf(e: Pick<GuidanceEvent, 'v2' | 'primaryAvailable' | 'verification'> & { changes?: GuidanceEvent['changes'] }): GuStage {
  if (!e.primaryAvailable) return 'CANDIDATE';
  if (e.v2?.statedDirection === 'RAISED' && !(e.changes || []).some((c) => c.direction === 'UP' && !!c.before)) return 'CANDIDATE';
  if (e.v2?.stage) return e.v2.stage;
  return e.verification === 'VERIFIED' ? 'VERIFIED' : 'PRIMARY_SOURCE_FOUND';
}
export function stageNote(e: Pick<GuidanceEvent, 'v2' | 'primaryAvailable' | 'verification'> & { changes?: GuidanceEvent['changes'] }): string | null {
  return stageOf(e) === 'CANDIDATE' ? AWAITING_PRIMARY : null;
}
export function stageIndex(st: GuStage): number { return STAGE_ORDER.indexOf(st); }

/** 'India 3 | USA 2' under a headline count. Null when the split is unknown. */
export function fmtMarketCounts(byMarket: GuSummary['byMarket'] | undefined, key: 'detected' | 'verified' | 'material' | 'expectationPositive'): string | null {
  if (!byMarket) return null;
  return `India ${byMarket.IN?.[key] ?? 0} | USA ${byMarket.US?.[key] ?? 0}`;
}
/** 'Consensus available 3/5'. Informational only: consensus is never needed to detect an upgrade. */
export function fmtConsensusAvail(c: GuSummary['consensusAvailable'] | undefined): string | null {
  return c ? `Consensus available ${c.have}/${c.of}` : null;
}
export function fmtRangeBound(n: number | null | undefined, unit = ''): string { return n == null ? UNAVAILABLE : `${nf(n)}${unit}`; }
/** 'low 10 / mid 11 / high 12' for one side of a range. */
export function fmtRangeSide(low: number | null, mid: number | null, high: number | null, unit = ''): string {
  if (low == null && mid == null && high == null) return UNAVAILABLE;
  return `low ${fmtRangeBound(low, unit)} / mid ${fmtRangeBound(mid, unit)} / high ${fmtRangeBound(high, unit)}`;
}
export function fmtRangeLine(r: GuRangeMath, unit = ''): string {
  return `${fmtRangeSide(r.beforeLow, r.beforeMid, r.beforeHigh, unit)} → ${fmtRangeSide(r.afterLow, r.afterMid, r.afterHigh, unit)}`;
}

export function isToday(e: Pick<GuidanceEvent, 'announcement_date' | 'announcement_timestamp'>, now: Date = new Date()): boolean {
  const iso = (e.announcement_date || e.announcement_timestamp || '').slice(0, 10);
  return iso !== '' && iso === now.toISOString().slice(0, 10);
}
/** Events announced today first, then the rest. Order inside each group is kept. */
export function splitToday<T extends Pick<GuidanceEvent, 'announcement_date' | 'announcement_timestamp'>>(list: T[], now: Date = new Date()): { today: T[]; rest: T[] } {
  const today: T[] = []; const rest: T[] = [];
  for (const e of list) (isToday(e, now) ? today : rest).push(e);
  return { today, rest };
}

export function scanHeadline(s: GuScanStatus): string { return s.complete ? SCAN_COMPLETE : SCAN_INCOMPLETE; }
export function scanIncompleteWords(s: GuScanStatus): string {
  const bad = s.sources.filter((x) => x.state !== 'COMPLETE').map((x) => `${x.name} (${SCAN_STATE_LABEL[x.state].toLowerCase()})`);
  return bad.length ? `Some sources were not fully read: ${bad.join(', ')}. Results may be missing upgrades.` : 'Not every day or source was fully read. Results may be missing upgrades.';
}
export function fmtDaysCovered(s: GuScanStatus): string { return `${s.daysCovered}/${s.daysRequested}`; }
export function fmtScanFunnel(s: GuScanStatus): string {
  return `${s.candidatesFound} found · ${s.processed} processed · ${s.awaitingGrading} awaiting grading · ${s.verified} verified`;
}
export function freshnessText(iso: string | null | undefined, now: Date = new Date()): string {
  const d = ageDays(iso, now);
  return d == null ? UNAVAILABLE : d === 0 ? 'newest item today' : `newest item ${d}d old`;
}
/** True when every market that has a scan is complete (or no scan at all). */
export function anyScanIncomplete(scan: Partial<Record<'IN' | 'US', GuScanStatus>> | undefined): boolean {
  return !!scan && Object.values(scan).some((s) => s && !s.complete);
}


// ── zzz847 range wording, neutral markers, headline-only cards (pure) ───────
export const FLOOR_ABOVE_OLD_CEILING = 'Floor above old ceiling';
export const TOP_END_CUT = 'Top end cut';
export const HEADLINE_ONLY_BANNER = 'DETECTED — raise stated by source; old and new numbers not read yet';
export const HEADLINE_ONLY_DECISION = 'UNVERIFIED — no decision yet';
export const TICKER_NOT_RESOLVED = 'ticker not resolved';
const REAL_RAISE_CLASSES: GuRangeClass[] = ['CLEAN_RAISE', 'RANGE_SHIFT_UP'];

/** Plain words for how a range moved. A new floor above the old ceiling is the strongest kind of raise and says so. */
export function rangeClassLabel(r: Pick<GuRangeMath, 'klass'> & { floorAboveOldCeiling?: boolean }): string {
  if (r.floorAboveOldCeiling && REAL_RAISE_CLASSES.includes(r.klass)) return FLOOR_ABOVE_OLD_CEILING;
  return RANGE_CLASS_LABEL[r.klass];
}
export function isRealRaiseClass(k: GuRangeClass): boolean { return REAL_RAISE_CLASSES.includes(k); }

/** Headline-only: the source says guidance was raised but no usable before/after numbers were read. */
export function isHeadlineOnly(e: Pick<GuidanceEvent, 'v2' | 'changes'>): boolean {
  return e.v2?.statedDirection === 'RAISED' && !e.changes.some((c) => c.direction === 'UP' && !!c.before);
}

/** The marker next to a change line. Only a real raise gets an up arrow. Narrowed/widened/same get a neutral marker; unknown gets none. */
export function changeMarker(e: Pick<GuidanceEvent, 'v2' | 'changes'>, i: number): { glyph: string; kind: 'UP' | 'DOWN' | 'NEUTRAL' | 'NONE' } {
  const c = e.changes[i]; const r = e.v2?.ranges?.[i];
  if (!c || !c.before) return { glyph: '', kind: 'NONE' };
  if (r) {
    if (r.klass === 'UNKNOWN') return { glyph: '', kind: 'NONE' };
    if (isRealRaiseClass(r.klass)) return { glyph: '↑', kind: 'UP' };
    if (r.klass === 'DOWNGRADE') return { glyph: '↓', kind: 'DOWN' };
    return { glyph: '↔', kind: 'NEUTRAL' };
  }
  return c.direction === 'UP' ? { glyph: '↑', kind: 'UP' } : c.direction === 'DOWN' ? { glyph: '↓', kind: 'DOWN' } : { glyph: '↔', kind: 'NEUTRAL' };
}
/** True when at least one change is a real raise (used for the card-level arrow). */
export function hasRealRaise(e: Pick<GuidanceEvent, 'v2' | 'changes'>): boolean {
  return e.changes.some((_, i) => changeMarker(e, i).kind === 'UP');
}
export function hasTopEndCut(e: Pick<GuidanceEvent, 'v2'>): boolean {
  return !!e.v2?.ranges?.some((r) => r.klass === 'MIDPOINT_RAISE_RANGE_NARROWING');
}
/** Card-level label in the expectation-gap chip: an arrow only for a real raise. */
export function guidanceMarkerWord(e: Pick<GuidanceEvent, 'v2' | 'changes'>): string {
  if (isHeadlineOnly(e)) return 'Guidance';
  if (hasRealRaise(e)) return 'Guidance ↑';
  return e.changes.length ? 'Guidance ↔' : 'Guidance';
}
export function decisionChipText(e: Pick<GuidanceEvent, 'verification' | 'primaryAvailable' | 'decision' | 'v2' | 'changes'>): string {
  if (showsDecision(e)) return DECISION_LABEL[e.decision];
  return isHeadlineOnly(e) ? HEADLINE_ONLY_DECISION : 'UNVERIFIED';
}
/** Ticker text: India names without a ticker show the company and say so. */
export function tickerText(e: Pick<GuidanceEvent, 'ticker'>): string { return e.ticker && e.ticker.trim() ? e.ticker : TICKER_NOT_RESOLVED; }

/** Plain per-source count lines for the coverage panel, from freshness.byMarket and scan.sources. */
export function coverageCounts(m: { candidates?: { graded: number; filings: number; news: number }; events?: number } | undefined, s: GuScanStatus | undefined): string[] {
  const out: string[] = [];
  if (m?.candidates) out.push(`${m.candidates.news} news scanned`, `${m.candidates.filings} filings scanned`, `${m.candidates.graded} graded rows`);
  if (s) out.push(`${s.candidatesFound} candidates found`);
  return out;
}
export function emptySources(s: GuScanStatus | undefined): string[] {
  return (s?.sources || []).filter((x) => x.state !== 'COMPLETE' || x.scanned === 0).map((x) => x.name);
}
/** India shows 0 events while a source is incomplete or empty: say so plainly. Null when nothing to warn about. */
export function marketIncompleteNote(market: 'IN' | 'US', events: number, s: GuScanStatus | undefined): string | null {
  if (events > 0 || !s) return null;
  const bad = emptySources(s);
  if (s.complete && !bad.length) return null;
  return `${MARKET_NAME[market]}: scan incomplete${bad.length ? ` — ${bad.join(', ')} empty` : ''}. Not a confirmation of no upgrades.`;
}


// ═══ zzz848 — universe (Layer A) vs events (Layer B): pure helpers ═══════════════════════════════════════════════
import type { GuUniverseRecord, GuUniverseResponse } from './guidance-universe-types';
import type { GgCompany, GgGuidancePoint, GgMetric } from './growth-guidance-types';

/** Window chips for the EVENTS section only. The universe never takes a window. */
export const GU_WINDOWS: GuWindow[] = ['24H', '3D', '7D', '14D', '30D', '120D'];

export type UniverseScope = 'ALL' | 'INDIA' | 'USA' | 'MY_BOOK';
export type UniverseMetric = 'ALL' | 'REVENUE' | 'EBITDA' | 'NET_PROFIT' | 'EPS' | 'FCF' | 'MULTI_METRIC' | 'MULTI_YEAR';
export type UniverseView = 'active' | 'all';
export const UNIVERSE_SCOPES: Array<[UniverseScope, string]> = [['ALL', 'All'], ['INDIA', 'India'], ['USA', 'USA'], ['MY_BOOK', 'My Book']];
export const UNIVERSE_METRICS: Array<[UniverseMetric, string]> = [['ALL', 'All'], ['REVENUE', 'Revenue'], ['EBITDA', 'EBITDA'], ['NET_PROFIT', 'Net profit'], ['EPS', 'EPS'], ['FCF', 'FCF'], ['MULTI_METRIC', 'Multi-metric'], ['MULTI_YEAR', 'Multi-year']];
export const UNIVERSE_UNAVAILABLE = 'The guidance universe could not be read';
export const UNIVERSE_HEADER = 'Highest verified guidance';

/** Builds the universe request. There is NO window parameter by design: the universe ignores event recency. */
export function universeUrl(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; threshold?: number; view?: UniverseView } = {}): string {
  const q = new URLSearchParams();
  q.set('market', o.market || 'ALL');
  if (o.metric) q.set('metric', o.metric);
  q.set('threshold', String(o.threshold ?? 30));
  q.set('view', o.view || 'active');
  return `/api/v1/guidance-universe?${q.toString()}`;
}
export const REGRESSION_URL = '/api/v1/guidance-universe/regression';

const API_METRIC: Record<UniverseMetric, string> = { ALL: '', REVENUE: 'REVENUE', EBITDA: 'EBITDA', NET_PROFIT: 'PAT', EPS: 'EPS', FCF: 'FCF', MULTI_METRIC: 'MULTI_METRIC', MULTI_YEAR: 'MULTI_YEAR' };
export function universeApiMetric(m: UniverseMetric): string { return API_METRIC[m]; }
export function universeApiMarket(s: UniverseScope): 'IN' | 'US' | 'ALL' { return s === 'INDIA' ? 'IN' : s === 'USA' ? 'US' : 'ALL'; }

/** 'India 20 | USA 14' */
export function fmtUniverseCounts(india: number | null | undefined, usa: number | null | undefined): string { return `India ${india ?? 0} | USA ${usa ?? 0}`; }

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const r0 = (n: number) => String(Math.round(n));
/** '3-yr CAGR' from a period like 'FY26–29' or '3 years'; 'multi-year CAGR' when the length is unknown. */
export function cagrLabel(period: string | null | undefined): string {
  const t = period || '';
  const y = /(\d+)\s*-?\s*(?:yr|year)/i.exec(t)?.[1];
  if (y) return `${y}-yr CAGR`;
  const m = /FY?(\d{2})\s*[–-]\s*(?:FY)?(\d{2})/i.exec(t);
  if (m && Number(m[2]) > Number(m[1])) return `${Number(m[2]) - Number(m[1])}-yr CAGR`;
  return 'multi-year CAGR';
}
/** '+60%', '+35–40%', '+80%+' (open-ended), never a midpoint. Implied growth says so; a multi-year figure says '3-yr CAGR'. */
export function fmtGrowthDisplay(p: Pick<GgGuidancePoint, 'growthLow' | 'growthHigh' | 'growthOrigin' | 'periodKind' | 'approx' | 'cumulativeYears' | 'period'> | null | undefined): string {
  if (!p) return '—';
  const lo = p.growthLow, hi = p.growthHigh;
  if (!num(lo) && !num(hi)) return '—';
  let body: string;
  if (num(lo) && num(hi) && Math.round(lo) !== Math.round(hi)) body = `+${r0(Math.min(lo, hi))}–${r0(Math.max(lo, hi))}%`;
  else if (num(lo) && !num(hi)) body = `+${r0(lo)}%+`;
  else body = `+${r0((num(lo) ? lo : hi) as number)}%`;
  if (p.growthOrigin === 'IMPLIED') body += ' (implied)';
  if (p.periodKind === 'MULTI_YEAR_CAGR') body += ` ${cagrLabel(p.period)}`;
  return body;
}
export const METRIC_SHORT: Record<string, string> = { REVENUE: 'Revenue', PAT: 'PAT', EPS: 'EPS', EBITDA: 'EBITDA', FCF: 'FCF' };
export function metricShort(m: string | null | undefined): string { return (m && METRIC_SHORT[m]) || (m ? String(m) : ''); }

const pointOf = (c: Pick<GgCompany, 'primary' | 'others'>, m: GgMetric): GgGuidancePoint | null => (c.primary?.metric === m ? c.primary : (c.others || []).find((o) => o.metric === m) || null);

/** The display string for the primary point: the server's `display` when present (range preserved), else built from the point. */
export function primaryDisplay(r: GuUniverseRecord): string {
  const d = (r.display || '').trim();
  let out = d || fmtGrowthDisplay(r.record?.primary);
  if (d && r.record?.primary?.growthOrigin === 'IMPLIED' && !/implied/i.test(d)) out += ' (implied)';
  if (d && r.record?.primary?.periodKind === 'MULTI_YEAR_CAGR' && !/CAGR/i.test(d)) out += ` ${cagrLabel(r.record.primary.period)}`;
  return out;
}
/** 'MTAR — +80%+ Revenue' or 'Cupid — +60% Revenue / +70% PAT' */
export function universeRowText(r: GuUniverseRecord): string {
  const parts = [`${primaryDisplay(r)} ${metricShort(r.metric || r.record?.primary?.metric)}`.trim()];
  for (const a of r.alsoDisplay || []) parts.push(`${a.display} ${metricShort(a.metric)}`.trim());
  return `${r.record?.company || 'Unknown company'} — ${parts.join(' / ')}`;
}
export function numberedRows(list: GuUniverseRecord[]): string[] { return list.map((r, i) => `${i + 1}. ${universeRowText(r)}`); }

/** ✓ verified, ◐ partial, ○ media-only (primary source not found yet). */
export function verificationMark(r: Pick<GuUniverseRecord, 'mediaOnly'> & { record?: Pick<GgCompany, 'verification'> }): { glyph: string; label: string } {
  const v = r.record?.verification;
  if (r.mediaOnly || v === 'SECONDARY_ONLY' || v === 'UNVERIFIED') return { glyph: '○', label: 'media-only' };
  if (v === 'PARTIALLY_VERIFIED') return { glyph: '◐', label: 'partial' };
  return v === 'VERIFIED' ? { glyph: '✓', label: 'verified' } : { glyph: '○', label: 'media-only' };
}
export function verificationTooltip(r: GuUniverseRecord): string {
  const m = verificationMark(r);
  const src = (r.record?.sources || []).find((x) => x.primary) || (r.record?.sources || [])[0];
  const from = src ? `${src.name}${src.date ? `, ${src.date.slice(0, 10)}` : ''}` : 'no source listed';
  return m.label === 'media-only' ? `Media only. Primary source not found yet. ${from}` : `${m.label === 'verified' ? 'Verified' : 'Partly verified'}: ${from}`;
}

const QUALITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const revPoint = (r: GuUniverseRecord) => pointOf(r.record, 'REVENUE');
const floorOf = (p: GgGuidancePoint | null) => (p ? (num(p.growthLow) ? p.growthLow : num(p.growthHigh) ? p.growthHigh : null) : null);
const ceilOf = (p: GgGuidancePoint | null) => (p ? (num(p.growthHigh) ? p.growthHigh : num(p.growthLow) ? p.growthLow : null) : null);
/** Sort rule: (1) highest VERIFIED revenue guidance (its floor; non-verified sink), (2) then the range (higher ceiling), (3) then evidence quality,
 *  (4) then any revenue floor, (5) company name. Stable and pure. */
export function sortUniverse(list: GuUniverseRecord[]): GuUniverseRecord[] {
  const key = (r: GuUniverseRecord) => {
    const p = revPoint(r); const ver = r.record?.verification === 'VERIFIED' && !r.mediaOnly;
    const f = floorOf(p);
    return [ver && f != null ? f : -Infinity, ceilOf(p) ?? -Infinity, (QUALITY_RANK[r.record?.quality] || 0) * 10 + Math.min(9, r.record?.evidence?.independentSources || 0), f ?? -Infinity] as const;
  };
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return kb[i] > ka[i] ? 1 : -1;
    return (a.record?.company || '').localeCompare(b.record?.company || '');
  });
}

export function universeMatchesMetric(r: GuUniverseRecord, m: UniverseMetric): boolean {
  if (m === 'ALL') return true;
  const c = r.record; if (!c) return false;
  const metrics = new Set<string>([c.primary?.metric, ...(c.others || []).map((o) => o.metric), r.metric, ...(r.alsoDisplay || []).map((a) => a.metric)].filter(Boolean) as string[]);
  if (m === 'MULTI_METRIC') return metrics.size > 1;
  if (m === 'MULTI_YEAR') return [c.primary, ...(c.others || [])].some((p) => p && (p.periodKind === 'MULTI_YEAR_CAGR' || (p.cumulativeYears ?? 0) > 1));
  return metrics.has(API_METRIC[m]);
}
export function filterUniverse(list: GuUniverseRecord[], scope: UniverseScope, metric: UniverseMetric, heldNorm?: (t: string) => boolean): GuUniverseRecord[] {
  return list.filter((r) => {
    const mk = r.record?.market;
    if (scope === 'INDIA' && mk !== 'IN') return false;
    if (scope === 'USA' && mk !== 'US') return false;
    if (scope === 'MY_BOOK' && !(heldNorm && r.record?.ticker && heldNorm(r.record.ticker))) return false;
    return universeMatchesMetric(r, metric);
  });
}
/** Defensive: anything that is not a usable universe answer is treated as 'not available', never as an empty success. */
export function isUniverseUsable(j: unknown): j is GuUniverseResponse {
  const x = j as GuUniverseResponse | null;
  return !!x && Array.isArray(x.records) && !!x.summary && !!x.summary.india && !!x.summary.usa && !!x.summary.all;
}

export interface UniverseSummaryLine { label: string; value: string }
/** Summary lines from GuUniverseSummary only. Nothing is hard-coded. */
export function universeSummaryLines(s: GuUniverseResponse['summary'], market: 'IN' | 'US' | 'ALL'): UniverseSummaryLine[] {
  const t = s.threshold ?? 30;
  if (market === 'ALL') {
    return [
      { label: 'Active high-growth guidance companies', value: fmtUniverseCounts(s.india.companies, s.usa.companies) + ` (${s.all.active} total)` },
      { label: 'Guidance raised', value: String(s.all.raised) }, { label: 'Maintained', value: String(s.all.maintained) },
      { label: 'Cut', value: String(s.all.cut) }, { label: 'At risk', value: String(s.all.atRisk) },
      { label: 'Media-only, primary pending', value: String(s.all.mediaOnly) },
    ];
  }
  const b = market === 'IN' ? s.india : s.usa;
  const hr = b.highestRevenue;
  return [
    { label: `${b.companies} companies currently identified`, value: '' },
    { label: `Revenue ≥${t}%`, value: String(b.revenueGte30) }, { label: `PAT ≥${t}%`, value: String(b.patGte30) },
    { label: `Revenue + PAT ≥${t}%`, value: String(b.revenueAndPatGte30) },
    { label: 'Highest revenue guidance', value: hr ? `${hr.company} ${hr.display}` : '—' },
  ];
}

// ── zero-event wording and 120D coverage ────────────────────────────────────────────────────────────────────────
export const NOT_A_CONFIRMATION = 'Zero events shown is NOT a confirmation of no upgrades.';
/** Wording for an empty event list. Uses scan.complete and never claims a clean negative. */
export function zeroEventWording(window: GuWindow, scan: Partial<Record<'IN' | 'US', GuScanStatus>> | undefined): string {
  const list = Object.values(scan || {}).filter((x): x is GuScanStatus => !!x);
  if (!list.length) return `No additional verified upgrades found in currently processed sources. Scan coverage is not available. ${NOT_A_CONFIRMATION}`;
  const incomplete = list.some((s) => !s.complete);
  if (incomplete) {
    const n = list.reduce((a, s) => a + (s.awaitingGrading || 0), 0);
    return `No additional verified upgrades found in currently processed sources. ${n} filings remain awaiting grading. ${NOT_A_CONFIRMATION}`;
  }
  return `No verified upgrades found in the fully processed ${window} source universe.`;
}

export type CoverageState = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NOT_AVAILABLE';
export function coverageState(s: GuScanStatus | undefined): CoverageState {
  const src = (s?.sources || []).map((x) => String(x.state));
  if (!s || !src.length) return 'NOT_AVAILABLE';
  if (src.every((x) => x === 'NOT_AVAILABLE' || x === 'NOT_RUN')) return 'NOT_AVAILABLE';
  if (src.every((x) => x === 'FAILED')) return 'FAILED';
  if (s.complete && src.every((x) => x === 'COMPLETE')) return 'COMPLETE';
  return 'PARTIAL';
}
export interface Coverage120 { market: 'IN' | 'US'; state: CoverageState; days: string; sources: number; unprocessed: number; missing: number; incomplete: boolean }
export const COVERAGE_120_INCOMPLETE = '120D coverage incomplete';
export function coverage120(s: GuScanStatus): Coverage120 {
  const req = 120;
  const covered = Math.max(0, s.daysCovered || 0);
  return {
    market: s.market, state: coverageState(s), days: `${covered}/${req}`, sources: (s.sources || []).length,
    unprocessed: s.awaitingGrading || Math.max(0, (s.candidatesFound || 0) - (s.processed || 0)), missing: Math.max(0, req - covered),
    incomplete: covered < req || !s.complete,
  };
}

// ── regression table (diagnostics) ──────────────────────────────────────────────────────────────────────────────
export const REGRESSION_STATUS_LABEL: Record<string, string> = {
  VERIFIED: 'VERIFIED', PARTIALLY_VERIFIED: 'PARTIALLY VERIFIED', NOT_FOUND: 'NOT FOUND', REJECTED: 'REJECTED', SUPERSEDED: 'SUPERSEDED', EXPIRED: 'EXPIRED',
};
export function investigatedCount(counts: Record<string, number> | undefined, rows: number, total = 20): string {
  const n = counts ? Object.values(counts).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) : rows;
  return `${n || rows}/${total} investigated`;
}

// ── zzz849: high-growth list, legend, period-unclear, event tags, notices ───────────────────────────────────────
import type { GuHighGrowthRow } from './guidance-universe-types';
import type { GgLedgerRow } from './growth-guidance-types';

export const VERIFICATION_LEGEND = '✓ verified from the company\'s own document · ◐ partly verified (media or one source) · ○ claim found, not verified';
export const PERIOD_UNCLEAR_LABEL = 'period unclear';
export const PERIOD_UNCLEAR_HINT = 'The source does not give a clear year. Open the filing to check.';
export const ZERO_RECORDS_TEXT = '0 verified active guidance records.';
const PROXY_KINDS = new Set(['ANALYST_CONSENSUS', 'ANALYST_ESTIMATE', 'HISTORICAL_TRAJECTORY', 'INFERENCE']);

/** True when the period text has no usable year ('Q2 (year not stated)', 'Period not stated', a bare 'Q2'). */
export function isPeriodUnclear(period: string | null | undefined, flag?: boolean): boolean {
  if (flag) return true;
  const t = (period || '').trim();
  if (!t) return true;
  if (/not stated|unclear|unknown|n\/a|unspecified/i.test(t)) return true;
  if (/^(Q[1-4]|H[12])$/i.test(t)) return true;
  return false;
}
export function recordPeriodUnclear(r: GuUniverseRecord): boolean {
  return isPeriodUnclear(r.record?.primary?.period, r.periodUnclear) || r.record?.primary?.periodKind === 'UNKNOWN';
}

const statedPct = (p: GgGuidancePoint | null | undefined, t: number): boolean => {
  if (!p || p.qualitative || PROXY_KINDS.has(p.kind)) return false;
  const g = num(p.growthLow) ? p.growthLow : p.growthHigh;
  if (!num(g)) return false;                                // '₹1,500 Cr target (no % stated)' has no growth number
  if (p.growthOrigin === 'IMPLIED' && !p.base) return false; // derived % needs its base
  return g >= t;
};
/** Active high-growth: still in force, revenue OR PAT growth floor >= threshold, and a % that is stated or derived (never a proxy metric). */
export function qualifiesHighGrowth(r: GuUniverseRecord, threshold = 30): boolean {
  const c = r.record; if (!c) return false;
  if (c.validity && c.validity !== 'ACTIVE') return false;
  return statedPct(pointOf(c, 'REVENUE'), threshold) || statedPct(pointOf(c, 'PAT'), threshold);
}

export interface HighGrowthRow {
  key: string; company: string; market: string; guidance: string; period: string; periodUnclear: boolean;
  glyph: string; markLabel: string; rec: GuUniverseRecord | null; revGe: boolean; patGe: boolean;
}
const mkName = (m: string | undefined) => (m === 'IN' ? 'India' : m === 'US' ? 'USA' : '');
export function rowGuidance(r: GuUniverseRecord): string {
  const parts = [`${primaryDisplay(r)} ${metricShort(r.metric || r.record?.primary?.metric)}`.trim()];
  for (const a of r.alsoDisplay || []) parts.push(`${a.display} ${metricShort(a.metric)}`.trim());
  return parts.join(' / ');
}
function fromRecord(r: GuUniverseRecord, t: number): HighGrowthRow {
  const m = verificationMark(r);
  return {
    key: r.record.id, company: r.record.company, market: r.record.market, guidance: rowGuidance(r), period: r.record.primary?.period || '',
    periodUnclear: recordPeriodUnclear(r), glyph: m.glyph, markLabel: m.label, rec: r,
    revGe: statedPct(pointOf(r.record, 'REVENUE'), t), patGe: statedPct(pointOf(r.record, 'PAT'), t),
  };
}
export interface HighGrowthView { rows: HighGrowthRow[]; activeInMarket: number; from: 'backend' | 'records' }
/** One set for the headline number AND the list. Uses summary.highGrowth when the backend sends it, else filters the records client-side. */
export function buildHighGrowth(data: Pick<GuUniverseResponse, 'records' | 'summary'>, mk: 'IN' | 'US' | 'ALL'): HighGrowthView {
  const t = data.summary?.threshold ?? 30;
  const recs = (data.records || []).filter((r) => r.record && (mk === 'ALL' || r.record.market === mk));
  const byId = new Map<string, GuUniverseRecord>();
  for (const r of data.records || []) if (r.record?.id) byId.set(r.record.id, r);
  const hg = data.summary?.highGrowth;
  if (Array.isArray(hg)) {
    const rows: HighGrowthRow[] = [];
    for (const h of hg as GuHighGrowthRow[]) {
      if (mk !== 'ALL' && h.market && h.market !== mk) continue;
      const rec = (h.id && byId.get(h.id)) || null;
      if (rec) { if (!qualifiesHighGrowth(rec, t)) continue; rows.push(fromRecord(rec, t)); continue; }
      const mark = verificationMark({ mediaOnly: !!h.mediaOnly, record: h.verification ? { verification: h.verification as GgCompany['verification'] } : undefined });
      const guidance = h.guidance || [`${h.display || ''} ${metricShort(h.metric)}`.trim(), ...(h.alsoDisplay || []).map((a) => `${a.display} ${metricShort(a.metric)}`.trim())].filter(Boolean).join(' / ');
      if (!guidance) continue;
      rows.push({ key: h.id || `${h.company}-${rows.length}`, company: h.company, market: h.market || '', guidance, period: h.period || '', periodUnclear: isPeriodUnclear(h.period, h.periodUnclear), glyph: mark.glyph, markLabel: mark.label, rec: null, revGe: false, patGe: false });
    }
    return { rows, activeInMarket: Math.max(recs.length, rows.length), from: 'backend' };
  }
  const rows = sortUniverse(recs.filter((r) => qualifiesHighGrowth(r, t))).map((r) => fromRecord(r, t));
  return { rows, activeInMarket: recs.length, from: 'records' };
}
/** Summary lines for the list that is actually shown. The headline is the list length. */
export function highGrowthLines(v: HighGrowthView, mk: 'IN' | 'US' | 'ALL', threshold = 30): UniverseSummaryLine[] {
  const n = v.rows.length;
  const head = mk === 'ALL' ? `${n} companies currently identified (${fmtUniverseCounts(v.rows.filter((r) => r.market === 'IN').length, v.rows.filter((r) => r.market === 'US').length)})` : `${n} companies currently identified`;
  const out: UniverseSummaryLine[] = [{ label: head, value: '' }];
  if (v.rows.some((r) => !r.rec)) return out;   // compact rows carry no point detail: do not guess a split
  const rev = v.rows.filter((r) => r.revGe), pat = v.rows.filter((r) => r.patGe);
  out.push({ label: `Revenue ≥${threshold}%`, value: String(rev.length) }, { label: `PAT ≥${threshold}%`, value: String(pat.length) },
    { label: `Revenue + PAT ≥${threshold}%`, value: String(v.rows.filter((r) => r.revGe && r.patGe).length) });
  const top = sortUniverse(rev.map((r) => r.rec as GuUniverseRecord))[0];
  out.push({ label: 'Highest revenue guidance', value: top ? `${top.record.company} ${primaryDisplay(top)}` : '—' });
  return out;
}
/** Quiet line for active records that are not in the high-growth list. Null when there are none. */
export function unlistedActiveLine(v: HighGrowthView): string | null {
  const n = v.activeInMarket - v.rows.length;
  return n > 0 ? `${n} more active record${n === 1 ? '' : 's'} below 30% or without a % ${n === 1 ? 'is' : 'are'} in the universe below.` : null;
}
/** 'X expired and hidden, Y with unclear period' from the backend summary only. Null when the backend sent neither. */
export function universeNoticeLine(s: GuUniverseResponse['summary'] | undefined): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (num(s.expiredCount)) parts.push(`${s.expiredCount} expired and hidden`);
  if (num(s.unknownPeriodCount)) parts.push(`${s.unknownPeriodCount} with unclear period`);
  if (num(s.awaitingVerificationCount)) parts.push(`${s.awaitingVerificationCount} awaiting verification`);
  return parts.length ? parts.join(', ') : null;
}

export interface EventTag { label: 'RAISED' | 'CUT' | 'AT RISK'; tone: 'green' | 'red' | 'amber'; tip: string }
const fmtPrior = (p: { low: number; high: number; unit: string }) => `${p.low === p.high ? r0(p.low) : `${r0(p.low)}–${r0(p.high)}`}${p.unit === '%' ? '%' : ` ${p.unit}`}`;
/** The earlier and current figure for the latest revision, or null when no prior value is stored. */
export function priorAfter(r: GuUniverseRecord): { before: string; after: string; period: string } | null {
  const c = r.record; if (!c) return null;
  const rows = [...(c.history || [])].filter((h: GgLedgerRow) => h.old && h.old.trim() && h.next).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const h = rows.find((x) => x.revision === 'RAISED' || x.revision === 'LOWERED') || rows[0];
  if (h) return { before: h.old as string, after: h.next, period: h.period };
  const pr = c.primary?.prior;
  if (pr && num(pr.low) && num(pr.high)) return { before: fmtPrior(pr), after: primaryDisplay(r), period: c.primary.period };
  return null;
}
/** RAISED / CUT only when a prior value exists. AT RISK is a status and keeps showing. Tooltip shows before and after. */
export function eventTags(r: GuUniverseRecord): EventTag[] {
  const out: EventTag[] = [];
  const pa = priorAfter(r);
  const tip = pa ? `Before: ${pa.before}. After: ${pa.after}${pa.period ? ` (${pa.period})` : ''}.` : '';
  if (pa && r.revision === 'RAISED') out.push({ label: 'RAISED', tone: 'green', tip });
  if (pa && r.revision === 'LOWERED') out.push({ label: 'CUT', tone: 'red', tip });
  if (r.atRisk) out.push({ label: 'AT RISK', tone: 'amber', tip: r.record?.reality?.trackingWhy || 'Tracking looks behind what the guidance needs.' });
  return out;
}

/** An event whose range class says it only repeated earlier guidance (never shown as raised). */
export function isReiteration(e: Pick<GuidanceEvent, 'v2' | 'changes'>): boolean {
  const rs = e.v2?.ranges || [];
  if (rs.length) return rs.every((x) => x.klass === 'REITERATION');
  return false;
}
export function unresolvedCount(u: number | unknown[] | undefined | null): number { return Array.isArray(u) ? u.length : num(u) ? u : 0; }
export function unresolvedLine(n: number): string { return `${n} unresolved discover${n === 1 ? 'y' : 'ies'} held back - not shown as events`; }
export function sourceFailedText(x: { state: string; detail?: string }): string | null {
  return String(x.state) === 'FAILED' ? ((x.detail || '').trim() || 'No reason was given by the source.') : null;
}

// ═══ zzz853: text builders (no components) ═══════════════════════════════════════════════════════════════════════════
/** '+22.9% raise vs previous guidance' / '+1.5 pp raise vs previous guidance'; null when there is no previous guidance or the measure did not move up. */
export function raiseVsPreviousText(c: GuChange): string | null {
  if (!c.before || c.direction !== 'UP') return null;
  const d = fmtDelta(c);
  return d ? `${d} raise vs previous guidance` : null;
}
/** 'Primary source: <what the company says>; Media claim: <what the outlet says>' (both kept, never averaged). */
export function sourceConflictLine(e: Pick<GuidanceEvent, 'sourceConflict'>): string | null {
  const s = e.sourceConflict;
  return s ? `Primary source: ${s.primary}; Media claim: ${s.media}` : null;
}
/** One line per event about where its primary source stands. 'Awaiting primary source' only when no link is known. */
export function primaryStateLine(e: Pick<GuidanceEvent, 'primaryState' | 'primaryStateText' | 'primarySourceUrl' | 'primarySourceDate'>): string | null {
  if (!e.primaryState) return null;
  const when = e.primarySourceDate ? ` (${e.primarySourceDate})` : '';
  if (e.primaryState === 'SECONDARY_SOURCE_CLAIM') return `${e.primaryStateText}. Primary source: not found in the filings read so far`;
  if (e.primaryState === 'AWAITING_PRIMARY_SOURCE') return e.primaryStateText ?? 'Awaiting primary source';
  return `${e.primaryStateText}${when}`;
}
/** The label the page shows on an event, from the engine's own classification (never from a headline verb). */
export function eventLabelText(e: Pick<GuidanceEvent, 'displayLabel' | 'auditOnly' | 'auditNote'>): { label: string; note: string | null } {
  return { label: e.displayLabel ?? 'UNVERIFIED CLAIM', note: e.auditOnly ? (e.auditNote ?? null) : null };
}
/** 'Verified 3 of 12 discovered; 5 awaiting grading' from the canonical counts. */
export function countsLine(c: { discovered: number; processed: number; verified: number; documentsAwaitingGrading: number; documentsUnavailable: number }): string {
  return `${c.discovered} discovered, ${c.processed} processed, ${c.verified} verified; ${c.documentsAwaitingGrading} awaiting grading (not counted as verified)${c.documentsUnavailable ? `; ${c.documentsUnavailable} source${c.documentsUnavailable === 1 ? '' : 's'} unavailable` : ''}`;
}
