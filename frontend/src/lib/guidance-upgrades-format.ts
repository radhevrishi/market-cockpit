// zzz843 — Guidance Upgrades: plain-English formatters. Client-safe, pure, no imports beyond types.
// Rule: a relative change is "+x%", a change between two rates (growth, margin) is "+x pp".
// The two are never mixed. A missing number prints DATA UNAVAILABLE, never zero.
import type { GuChange, GuGuidancePoint, GuNumber, GuDecision, GuMetric, GuThesis, GuGap, GuDuration, GuMateriality, GuPortfolioImpact, GuFlag, GuidanceEvent, GuRangeClass, GuDurabilityLevel, GuStage, GuScoreItem, GuMetricBasis, GuScanStatus, GuScanSource, GuSummary, GuRangeMath } from './guidance-upgrades-types';

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
export const SCAN_STATE_LABEL: Record<GuScanSource['state'], string> = { COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', FAILED: 'FAILED', NOT_RUN: 'NOT RUN' };
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
