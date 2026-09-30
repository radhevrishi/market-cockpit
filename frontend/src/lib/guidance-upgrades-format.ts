// zzz843 — Guidance Upgrades: plain-English formatters. Client-safe, pure, no imports beyond types.
// Rule: a relative change is "+x%", a change between two rates (growth, margin) is "+x pp".
// The two are never mixed. A missing number prints DATA UNAVAILABLE, never zero.
import type { GuChange, GuGuidancePoint, GuNumber, GuDecision, GuMetric, GuThesis, GuGap, GuDuration, GuMateriality, GuPortfolioImpact, GuFlag, GuidanceEvent } from './guidance-upgrades-types';

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
  ORDER_INTAKE: 'Order intake', BACKLOG: 'Order backlog', VOLUME: 'Volume', PRODUCTION: 'Production', CAPACITY_UTIL: 'Capacity use', OTHER: 'Other',
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
  GUIDANCE_PLUS_BOTTLENECK: 'GUIDANCE + STRUCTURAL BOTTLENECK', SECOND_UPGRADE_IN_WINDOW: 'SECOND UPGRADE',
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
  }
  if (e.changes.length > 1) out.add('MULTI_METRIC');
  const periods = new Set(e.changes.map((c) => c.after.period));
  if (periods.size > 1 || e.duration === 'MULTI_YEAR') out.add('MULTI_YEAR');
  return Array.from(out);
}

// ── Page filters (pure) ─────────────────────────────────────────────────
export type ScopeFilter = 'ALL' | 'INDIA' | 'USA' | 'MY_BOOK' | 'HIGH';
export type MetricFilter = 'ALL' | 'REVENUE' | 'EBITDA' | 'EPS' | 'FCF' | 'MULTI_METRIC' | 'MULTI_YEAR';

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
