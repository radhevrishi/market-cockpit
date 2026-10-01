// zzz846 — Growth Guidance: pure helpers, label maps, sort labels, formatting. No React, no network, no prices.
// Rules carried here: plain simple English; no single ranking number; no broker actions; unknown is never negative;
// analyst numbers are always marked apart from management numbers.
import type {
  GgAlertKind, GgAlertLevel, GgCapBand, GgCatalyst, GgChainStep, GgCompany, GgExpectations, GgGrowthOrigin, GgGuidancePoint, GgInflection, GgKind,
  GgLeverage, GgMap2x2, GgMarket, GgMetric, GgOrganic, GgOutcome, GgPeriodKind, GgQuality, GgRerating, GgRevision, GgScanSource, GgSort, GgTracking, GgValidity, GgVerification,
} from './growth-guidance-types';
import { HIGH_GROWTH_THRESHOLD } from './guidance-config';
import { CATALYST_LABEL, KIND_LABEL, THRESHOLDS, TRACKING_LABEL, VERIFICATION_LABEL } from './growth-guidance-types';

export { CATALYST_LABEL, KIND_LABEL, THRESHOLDS, TRACKING_LABEL, VERIFICATION_LABEL };

export const UNAVAILABLE = 'DATA UNAVAILABLE';
export const NOT_ESTABLISHED = 'Not yet established';
export const DEFAULT_THRESHOLD = HIGH_GROWTH_THRESHOLD;
export const SCAN_INCOMPLETE_NOTE = 'SCAN INCOMPLETE. An empty list does not mean there is no guidance. Some sources were not fully read.';
export const DISCLAIMER = 'Company data only. Research, not investment advice. A guided number is what management said, not a promise.';

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type MarketFilter = 'IN' | 'US' | 'ALL';
export type CapFilter = 'SMALL_MICRO' | 'ALL';
export type KindFilter = 'MANAGEMENT' | 'ALL';
export interface GgFilters { threshold: number; metric: GgMetric; market: MarketFilter; cap: CapFilter; kind: KindFilter; sort: GgSort }
export const DEFAULT_FILTERS: GgFilters = { threshold: DEFAULT_THRESHOLD, metric: 'REVENUE', market: 'ALL', cap: 'SMALL_MICRO', kind: 'MANAGEMENT', sort: 'DEFAULT' };

export const METRIC_TABS: Array<{ value: GgMetric; label: string }> = [
  { value: 'REVENUE', label: 'Revenue' }, { value: 'PAT', label: 'PAT' }, { value: 'EPS', label: 'EPS' }, { value: 'EBITDA', label: 'EBITDA' }, { value: 'FCF', label: 'FCF' },
];
export const METRIC_LABEL: Record<GgMetric, string> = { REVENUE: 'Revenue', PAT: 'PAT (profit after tax)', EPS: 'EPS (earnings per share)', EBITDA: 'EBITDA (operating profit)', FCF: 'FCF (free cash flow)' };
export const METRIC_SHORT: Record<GgMetric, string> = { REVENUE: 'Revenue', PAT: 'PAT', EPS: 'EPS', EBITDA: 'EBITDA', FCF: 'FCF' };
export const MARKET_OPTIONS: Array<{ value: MarketFilter; label: string }> = [{ value: 'IN', label: '🇮🇳 India' }, { value: 'US', label: '🇺🇸 US' }, { value: 'ALL', label: 'All' }];
export const CAP_OPTIONS: Array<{ value: CapFilter; label: string }> = [{ value: 'SMALL_MICRO', label: 'Small + Micro' }, { value: 'ALL', label: 'All caps' }];
export const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [{ value: 'MANAGEMENT', label: 'Management only' }, { value: 'ALL', label: 'Include analyst' }];

/** The 10 lenses the owner asked for, then the default order. */
export const SORT_LENSES: Array<{ value: Exclude<GgSort, 'DEFAULT'>; label: string }> = [
  { value: 'HIGHEST_REVENUE', label: 'Highest revenue guidance' },
  { value: 'HIGHEST_PAT', label: 'Highest PAT guidance' },
  { value: 'HIGHEST_COMBINED', label: 'Highest combined growth' },
  { value: 'BIGGEST_INCREASE', label: 'Biggest guidance increase' },
  { value: 'STRONGEST_EARNINGS', label: 'Strongest earnings confirmation' },
  { value: 'LONGEST_DURATION', label: 'Longest catalyst duration' },
  { value: 'STRONGEST_EVIDENCE', label: 'Strongest guidance evidence' },
  { value: 'EARLIEST_INFLECTION', label: 'Earliest inflection' },
  { value: 'LARGEST_EXPECTATIONS_GAP', label: 'Largest expectations gap' },
  { value: 'PORTFOLIO_CHANGE', label: 'Portfolio catalyst change' },
];
export const SORT_OPTIONS: Array<{ value: GgSort; label: string }> = [{ value: 'DEFAULT', label: 'Default order' }, ...SORT_LENSES];

/** Query string for GET /api/v1/growth-guidance. Filters map one to one; the server owns filtering and sorting. */
export function buildQuery(f: GgFilters): string {
  const p = new URLSearchParams();
  p.set('threshold', String(f.threshold));
  p.set('metric', f.metric);
  p.set('market', f.market);
  p.set('cap', f.cap);
  p.set('kind', f.kind);
  p.set('sort', f.sort);
  return p.toString();
}

// ── label maps: one per enum in the types file ───────────────────────────────────────────────────────────────────
export const MARKET_LABEL: Record<GgMarket, string> = { IN: 'India', US: 'USA', GLOBAL: 'Global' };
export const PERIOD_KIND_LABEL: Record<GgPeriodKind, string> = {
  FY: 'Financial year', CY: 'Calendar year', QUARTER: 'One quarter', HALF: 'Half year', ROLLING_12M: 'Next 12 months', MULTI_YEAR_CAGR: 'Multi-year yearly growth (CAGR)', UNKNOWN: 'Period not clear',
};
export const GROWTH_ORIGIN_LABEL: Record<GgGrowthOrigin, string> = { STATED: 'Growth stated by management', IMPLIED: 'Growth worked out from a target (not stated as a % by management)' };
export const ORGANIC_LABEL: Record<GgOrganic, string> = { ORGANIC: 'Organic', ACQUISITION_LED: 'Acquisition-led', MIXED: 'Organic + acquisition', UNKNOWN: 'Organic mix unknown' };
export const QUALITY_LABEL: Record<GgQuality, string> = { HIGH: 'Strong evidence', MEDIUM: 'Fair evidence', LOW: 'Thin evidence' };
export const VALIDITY_LABEL: Record<GgValidity, string> = { ACTIVE: 'ACTIVE', SUPERSEDED: 'SUPERSEDED', ACHIEVED: 'ACHIEVED', MISSED: 'MISSED', WITHDRAWN: 'WITHDRAWN', EXPIRED: 'EXPIRED' };
export const REVISION_LABEL: Record<GgRevision, string> = { RAISED: 'Raised', MAINTAINED: 'Maintained', LOWERED: 'Lowered', WITHDRAWN: 'Withdrawn', EXCEEDED: 'Exceeded', MISSED: 'Missed', INITIAL: 'First guidance' };
export const OUTCOME_LABEL: Record<GgOutcome, string> = { EXCEEDED: 'Exceeded', ACHIEVED: 'Achieved', MISSED: 'Missed', WITHDRAWN: 'Withdrawn', NOT_COMPARABLE: 'Not comparable', PENDING: 'Pending' };
export const EXPECTATIONS_LABEL: Record<GgExpectations, string> = { LOW: 'LOW', MODERATE: 'MODERATE', HIGH: 'HIGH', UNKNOWN: 'UNKNOWN' };
export const EXPECTATIONS_PLAIN: Record<GgExpectations, string> = {
  LOW: 'The market does not seem to expect much yet.', MODERATE: 'The market expects a fair amount.', HIGH: 'The market already expects a lot. Less room for a pleasant surprise.', UNKNOWN: 'Not enough evidence to say. Unknown is not bad.',
};
export const INFLECTION_LABEL: Record<GgInflection, string> = {
  EARLY_INFLECTION: 'Early inflection', CONFIRMED_INFLECTION: 'Confirmed inflection', ACCELERATING_INFLECTION: 'Accelerating inflection', NO_EVIDENCE_YET: 'No evidence yet',
};
export const MAP2X2_LABEL: Record<GgMap2x2, string> = {
  CONFIRMED_GROWTH: 'Confirmed growth (guided and already showing)', FORWARD_LOOKING_EARLY: 'Forward-looking, early (guided, not yet showing)',
  POTENTIAL_UPSIDE_TO_GUIDANCE: 'Already growing fast, guidance may be low', LOW_PRIORITY: 'Low priority for now',
};
export const CAP_LABEL: Record<GgCapBand, string> = { MICRO: 'Micro cap', SMALL: 'Small cap', MID: 'Mid cap', LARGE: 'Large cap', UNKNOWN: 'Size unknown' };
export const LEVERAGE_LABEL: Record<GgLeverage, string> = {
  OPERATING_LEVERAGE: 'Operating leverage (profit growing faster than sales)', MARGIN_DILUTION: 'Margin dilution (profit growing slower than sales)', PROPORTIONAL: 'Profit growing in line with sales', UNKNOWN: 'Not enough data',
};
export const RERATING_LABEL: Record<GgRerating, string> = {
  EARNINGS_GROWTH_ONLY: 'Only earnings growth', EARNINGS_PLUS_MARGIN: 'Earnings growth plus better margins', EARNINGS_PLUS_DURATION: 'Earnings growth plus a longer growth runway',
  EARNINGS_PLUS_EXPECTATIONS_RESET: 'Earnings growth plus lower expectations today', EARNINGS_PLUS_MARKET_EXPANSION: 'Earnings growth plus a bigger market', UNKNOWN: 'Not established',
};
export const ALERT_KIND_LABEL: Record<GgAlertKind, string> = {
  NEW_GUIDANCE: 'New guidance', GUIDANCE_RAISED: 'Raised', GUIDANCE_CUT: 'Cut', GUIDANCE_ACHIEVED: 'Achieved', GUIDANCE_BROKEN: 'At risk or broken',
  EARNINGS_CONFIRMATION: 'Confirmed by earnings', CATALYST_CONFIRMATION: 'Catalyst confirmed', SUPPORTING_EVIDENCE: 'New supporting evidence',
};
export const ALERT_LEVEL_LABEL: Record<GgAlertLevel, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const CHAIN_STEP_LABEL: Record<GgChainStep['step'], string> = {
  DRIVER: 'Driver', COMPANY_RESPONSE: 'Company response', CAPACITY_DEMAND: 'Capacity / demand', REVENUE: 'Revenue', MARGIN: 'Margin', PAT_EPS: 'PAT / EPS', FCF: 'Free cash flow',
};
export const CHAIN_STATUS_LABEL: Record<GgChainStep['status'], string> = { PROVEN: 'Proven', PARTIALLY_PROVEN: 'Partly proven', ASSUMED: 'Assumed', UNKNOWN: 'Unknown' };
export const TREND_LABEL: Record<GgCompany['trend'], string> = { ACCELERATION: 'GUIDANCE ACCELERATION', DETERIORATION: 'GUIDANCE DETERIORATION', FLAT: 'Guidance steady', NONE: 'No trend yet' };
export const SCAN_STATE_LABEL: Record<GgScanSource['state'], string> = { COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', FAILED: 'FAILED', NOT_RUN: 'NOT RUN' };
export const BASIS_LABEL: Record<NonNullable<GgGuidancePoint['basis']>, string> = { CONSOLIDATED: 'Consolidated', STANDALONE: 'Standalone', UNSTATED: 'Basis not stated' };
export const SOURCE_RANK_NOTE = 'Rank 1 is the strongest source (a regulatory filing). Higher numbers are weaker.';

// ── kind helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
const ANALYST_KINDS: readonly GgKind[] = ['ANALYST_CONSENSUS', 'ANALYST_ESTIMATE'];
export function isAnalyst(kind: GgKind | null | undefined): boolean { return !!kind && ANALYST_KINDS.includes(kind); }
export function isManagementKind(kind: GgKind | null | undefined): boolean { return !!kind && kind.startsWith('MANAGEMENT_'); }
export const ANALYST_MARKER = 'ANALYST NUMBER. Not management guidance.';
export function kindLabel(kind: GgKind): string { return KIND_LABEL[kind] ?? String(kind); }

// ── status dot: verification + tracking, always with a text label for print ──────────────────────────────────────
export interface StatusDot { key: GgTracking; dot: string; label: string; colorKey: 'green' | 'cyan' | 'amber' | 'orange' | 'red' | 'grey' }
const DOT: Record<GgTracking, { dot: string; label: string; colorKey: StatusDot['colorKey'] }> = {
  ON_TRACK: { dot: '🟢', label: 'ON TRACK', colorKey: 'green' },
  EARLY: { dot: '🔵', label: 'EARLY', colorKey: 'cyan' },
  ACCELERATION_REQUIRED: { dot: '🟡', label: 'ACCELERATION REQUIRED', colorKey: 'amber' },
  AT_RISK: { dot: '🟠', label: 'AT RISK', colorKey: 'orange' },
  BROKEN: { dot: '🔴', label: 'BROKEN', colorKey: 'red' },
  NOT_ASSESSED: { dot: '⚪', label: 'NOT ASSESSED', colorKey: 'grey' },
};
export function statusOf(c: Pick<GgCompany, 'reality' | 'verification'>): StatusDot {
  const t: GgTracking = c.reality?.tracking ?? 'NOT_ASSESSED';
  const d = DOT[t] ?? DOT.NOT_ASSESSED;
  return { key: t, ...d };
}
export const STATUS_LEGEND: StatusDot[] = (['ON_TRACK', 'EARLY', 'ACCELERATION_REQUIRED', 'AT_RISK', 'BROKEN'] as GgTracking[]).map((k) => ({ key: k, ...DOT[k] }));
export function verificationText(v: GgVerification): string { return VERIFICATION_LABEL[v] ?? String(v); }

// ── validity ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function isMuted(v: GgValidity | null | undefined): boolean { return !!v && v !== 'ACTIVE'; }

// ── numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}
export function fmtSignedPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}
export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return UNAVAILABLE;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
export function fmtMult(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return UNAVAILABLE;
  return `${n.toFixed(1)}x`;
}
/** Growth of one statement: '50%' or '40–60%'. Null when only an absolute target exists. */
export function fmtGrowth(p: Pick<GgGuidancePoint, 'growthLow' | 'growthHigh' | 'growthOrigin'> | null | undefined): string {
  if (!p) return '—';
  const lo = p.growthLow, hi = p.growthHigh;
  const a = lo ?? hi, b = hi ?? lo;
  if (a == null || b == null) return '—';
  const body = Math.round(a) === Math.round(b) ? `${Math.round(a)}%` : `${Math.round(Math.min(a, b))}–${Math.round(Math.max(a, b))}%`;
  return p.growthOrigin === 'IMPLIED' ? `~${body} (worked out)` : body;
}
export function growthMid(p: Pick<GgGuidancePoint, 'growthLow' | 'growthHigh'> | null | undefined): number | null {
  if (!p) return null;
  const lo = p.growthLow, hi = p.growthHigh;
  if (lo == null && hi == null) return null;
  const a = (lo ?? hi) as number, b = (hi ?? lo) as number;
  return (a + b) / 2;
}
/** Growth for one metric, looking at the headline point and the others. */
export function pointFor(c: Pick<GgCompany, 'primary' | 'others'>, metric: GgMetric): GgGuidancePoint | null {
  if (c.primary?.metric === metric) return c.primary;
  return (c.others || []).find((o) => o.metric === metric) || null;
}
export function absoluteTargetText(p: GgGuidancePoint | null | undefined): string | null {
  const a = p?.absoluteTarget;
  if (!a || a.value == null) return null;
  return `${a.currency ? a.currency + ' ' : ''}${a.value.toLocaleString('en-US')} ${a.unit || ''}`.trim();
}

// ── headline title and counts ────────────────────────────────────────────────────────────────────────────────────
export function mainPeriod(companies: ReadonlyArray<Pick<GgCompany, 'primary'>>): string | null {
  const tally = new Map<string, number>();
  for (const c of companies) { const p = c.primary?.period; if (p) tally.set(p, (tally.get(p) || 0) + 1); }
  let best: string | null = null, n = 0;
  tally.forEach((v, k) => { if (v > n) { best = k; n = v; } });
  return best;
}
/** 'FY27 30%+ growth guidance — verified management guidance / targets' */
export function thresholdTitle(threshold: number, metric: GgMetric = 'REVENUE', period?: string | null): string {
  const metricWord = metric === 'REVENUE' ? '' : `${METRIC_SHORT[metric]} `;
  return `${period ? period + ' ' : ''}${metricWord}${threshold}%+ growth guidance — verified management guidance / targets`;
}
export function universeHeading(threshold: number): string { return `${threshold}%+ UNIVERSE`; }
export const DISCOVER_HEADING = 'DISCOVER';
export const DISCOVER_NOTE = 'NOT VERIFIED. These came from secondary sources only (news, data sites, or unconfirmed mentions). Nothing here is confirmed by a company filing, release or call. Check the source yourself before relying on it.';

// ── sections of the detail view: only populated ones, numbered in the order shown ────────────────────────────────
export type GgSectionKey = 'snapshot' | 'why' | 'evidence' | 'history' | 'earnings' | 'reality' | 'expectations' | 'valuation' | 'duration' | 'next' | 'breakers' | 'links';
export const SECTION_TITLE: Record<GgSectionKey, string> = {
  snapshot: 'Snapshot', why: 'Why growth?', evidence: 'Guidance evidence', history: 'Guidance history', earnings: 'Earnings evidence', reality: 'Reality check',
  expectations: 'Expectations', valuation: 'Valuation', duration: 'Catalyst duration', next: 'Next proof point', breakers: '⚠️ Thesis breakers', links: 'Links',
};
export const SECTION_ORDER: readonly GgSectionKey[] = ['snapshot', 'why', 'evidence', 'history', 'earnings', 'reality', 'expectations', 'valuation', 'duration', 'next', 'breakers', 'links'];

const hasText = (s: string | null | undefined): boolean => !!s && s.trim().length > 0 && s.trim().toLowerCase() !== NOT_ESTABLISHED.toLowerCase();
const anyNum = (o: object | null | undefined): boolean => !!o && Object.values(o).some((v) => typeof v === 'number' && Number.isFinite(v));

export function hasSection(key: GgSectionKey, c: GgCompany): boolean {
  switch (key) {
    case 'snapshot': return true;
    case 'why': return hasText(c.driverText) || (c.chain || []).length > 0 || (c.mechanisms || []).length > 0;
    case 'evidence': return (c.sources || []).length > 0 || hasText(c.primary?.originalStatement) || !!c.conflict;
    case 'history': return (c.history || []).length > 0 || c.trend === 'ACCELERATION' || c.trend === 'DETERIORATION' || !!c.credibility;
    case 'earnings': return !!c.earnings && (anyNum(c.earnings) || c.earnings.inflection !== 'NO_EVIDENCE_YET' || hasText(c.earnings.leverageNote)) || (!!c.surprise && anyNum(c.surprise));
    case 'reality': return !!c.reality && (anyNum(c.reality) || c.reality.tracking !== 'NOT_ASSESSED');
    case 'expectations': return c.expectations !== 'UNKNOWN' || hasText(c.expectationsWhy);
    case 'valuation': return !!c.valuation && (anyNum(c.valuation) || hasText(c.valuation.embeddedGrowthNote) || hasText(c.valuation.ifAchievedNote) || c.valuation.rerating !== 'UNKNOWN');
    case 'duration': return hasText(c.guidanceDuration) || hasText(c.structuralDuration);
    case 'next': return hasText(c.nextProof);
    case 'breakers': return (c.breakers || []).length > 0;
    case 'links': return true;
    default: return false;
  }
}
/** Sections to draw, in spec order, numbered 1..n with no gaps. */
export function visibleSections(c: GgCompany): Array<{ n: number; key: GgSectionKey; title: string }> {
  return SECTION_ORDER.filter((k) => hasSection(k, c)).map((key, i) => ({ n: i + 1, key, title: SECTION_TITLE[key] }));
}

// ── cross links ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface GgLink { key: string; label: string; href: string; note?: string }
export function linksFor(c: GgCompany): GgLink[] {
  const out: GgLink[] = [];
  const t = encodeURIComponent(c.ticker);
  if (c.links?.bottleneck) out.push({ key: 'bottleneck', label: '🔗 BOTTLENECK DETECTED', href: '/bottleneck-intel', note: (c.links.bottleneckThemes || []).join(', ') || undefined });
  if (c.links?.specialSituation) out.push({ key: 'special', label: '🔗 SPECIAL SITUATION', href: '/special-situations' });
  if (c.links?.concall) out.push({ key: 'concall', label: 'Concall', href: '/concall-intel' });
  out.push({ key: 'radar', label: c.links?.radarEligible ? 'Multibagger Radar: eligible' : 'Multibagger Radar: not eligible', href: '/special-situations', note: hasText(c.links?.radarWhy) ? c.links.radarWhy : undefined });
  out.push({ key: 'upgrades', label: 'Guidance Upgrades', href: '/guidance-upgrades' });
  out.push({ key: 'news', label: 'News', href: `/news?search=${t}` });
  return out;
}

// ── portfolio overlay (client side only) ─────────────────────────────────────────────────────────────────────────
export function normTicker(t: string): string { return String(t || '').trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE):/, '').replace(/\.(NS|BO)$/, ''); }
export function overlayHeld(cs: GgCompany[], held: ReadonlyArray<string>): GgCompany[] {
  const set = new Set(held.map(normTicker));
  return cs.map((c) => (set.has(normTicker(c.ticker)) ? { ...c, portfolio: { ...(c.portfolio || { held: false }), held: true } } : c));
}

// ── scan panel ───────────────────────────────────────────────────────────────────────────────────────────────────
export function scanHeadline(scan: { complete: boolean } | null | undefined): string {
  if (!scan) return 'SCAN STATUS UNKNOWN';
  return scan.complete ? 'SCAN COMPLETE' : 'SCAN INCOMPLETE — not a confirmation of no guidance';
}
export function lastScanText(iso: string | null | undefined): string {
  if (!iso) return 'Last scan: unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Last scan: unknown';
  return `Last scan: ${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// ── print / copy list: the plain simple table ────────────────────────────────────────────────────────────────────
export function listRows(cs: GgCompany[]): string[][] {
  return cs.map((c, i) => {
    const st = statusOf(c);
    return [String(i + 1), c.company, fmtGrowth(pointFor(c, 'REVENUE')), fmtGrowth(pointFor(c, 'PAT')), c.primary?.period || '—', st.label];
  });
}
export const LIST_HEADERS = ['#', 'Company', 'Revenue growth', 'PAT growth', 'Guidance period', 'Status'] as const;
export function listAsText(cs: GgCompany[], title: string): string {
  return [title, LIST_HEADERS.join('\t'), ...listRows(cs).map((r) => r.join('\t'))].join('\n');
}

// ── defensive reads for a response that may miss optional fields ─────────────────────────────────────────────────
export function safeList<T>(x: T[] | null | undefined): T[] { return Array.isArray(x) ? x : []; }
export function isGgResponseLike(j: unknown): boolean {
  const o = j as { companies?: unknown } | null;
  return !!o && typeof o === 'object' && Array.isArray(o.companies);
}

// ── small memory of filters, per viewer ──────────────────────────────────────────────────────────────────────────
const FILTER_KEY = 'mc.growthGuidance.filters.v1';
export function loadFilters(): GgFilters {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(FILTER_KEY) : null;
    if (!raw) return DEFAULT_FILTERS;
    const j = JSON.parse(raw);
    const okT = (THRESHOLDS as readonly number[]).includes(j?.threshold);
    return {
      threshold: okT ? j.threshold : DEFAULT_FILTERS.threshold,
      metric: METRIC_TABS.some((m) => m.value === j?.metric) ? j.metric : DEFAULT_FILTERS.metric,
      market: MARKET_OPTIONS.some((m) => m.value === j?.market) ? j.market : DEFAULT_FILTERS.market,
      cap: CAP_OPTIONS.some((m) => m.value === j?.cap) ? j.cap : DEFAULT_FILTERS.cap,
      kind: KIND_OPTIONS.some((m) => m.value === j?.kind) ? j.kind : DEFAULT_FILTERS.kind,
      sort: SORT_OPTIONS.some((m) => m.value === j?.sort) ? j.sort : DEFAULT_FILTERS.sort,
    };
  } catch { return DEFAULT_FILTERS; }
}
export function saveFilters(f: GgFilters): void {
  try { window.localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* per-viewer convenience only */ }
}
