// zzz848 — GUIDANCE UNIVERSE (Layer A) vs GUIDANCE EVENTS (Layer B). Types only.
// Layer A = persistent, currently valid management guidance (independent of event recency).
// Layer B = time-windowed events (24H/3D/7D/14D/30D/120D) — the existing guidance-upgrades feed.
// Summary numbers are always computed from the records, never hard-coded.
import type { GgCompany, GgMetric, GgMarket } from './growth-guidance-types';

export type GuRegressionStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NOT_FOUND' | 'REJECTED' | 'SUPERSEDED' | 'EXPIRED';
/** zzz857: COMPANY_DOC = a row the AI extractor read from the company's own document (transcript / presentation / release) and quote-checked. */
export type GuUniverseRecordOrigin = 'LIVE' | 'LEDGER' | 'RESEARCHED_SEED' | 'COMPANY_DOC';

/** One active guidance record as shown in the universe; wraps GgCompany so every Growth Guidance field stays available. */
export interface GuUniverseRecord {
  record: GgCompany;
  origin: GuUniverseRecordOrigin;
  /** how it is displayed: '+60%' or '+35–40%' or '+80%+' (range preserved, never midpoint) */
  display: string;
  metric: GgMetric;
  /** all other metrics for the same company, e.g. PAT next to revenue */
  alsoDisplay: Array<{ metric: GgMetric; display: string; verification: string }>;
  mediaOnly: boolean;                   // primary source not found yet
  revision: 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'WITHDRAWN' | 'INITIAL' | 'NONE';
  atRisk: boolean;
  /** additive (optional): backend flag - the period is missing or has no year ('Q2 (year not stated)'). The UI also checks the period text itself. */
  periodUnclear?: boolean;
  /** additive (optional): true when the primary document itself was read (not just found). Absent = UI falls back to verification. */
  primarySourceRead?: boolean | null;
}

export interface GuUniverseBucket { companies: number; revenueGte30: number; patGte30: number; revenueAndPatGte30: number; highestRevenue: { company: string; display: string } | null }
/** additive (optional): compact row of summary.highGrowth, the backend's own active high-growth list. */
export interface GuHighGrowthRow {
  id?: string; company: string; ticker?: string | null; market?: GgMarket;
  /** ready text such as '+60% Revenue / +70% PAT'; when absent the UI builds it from display/metric/alsoDisplay */
  guidance?: string;
  display?: string; metric?: GgMetric; alsoDisplay?: Array<{ metric: GgMetric; display: string; verification?: string }>;
  period?: string | null; periodUnclear?: boolean;
  verification?: string; mediaOnly?: boolean;
}
export interface GuUniverseMarketCounts { companies: number; revenueGe30: number; patGe30: number; multiMetric: number }
export interface GuUniverseSummary {
  asOf: string;
  india: GuUniverseBucket;
  usa: GuUniverseBucket;
  all: { active: number; raised: number; maintained: number; cut: number; atRisk: number; mediaOnly: number };
  threshold: number;
  /** additive (optional) */
  byMarket?: { IN: GuUniverseMarketCounts; US: GuUniverseMarketCounts; ALL: GuUniverseMarketCounts };
  highGrowth?: GuHighGrowthRow[];
  expiredCount?: number; unknownPeriodCount?: number; awaitingVerificationCount?: number;
}

export interface GuUniverseResponse {
  summary: GuUniverseSummary;
  records: GuUniverseRecord[];          // active guidance, NOT filtered by event window
  scan: { note: string; complete: boolean };
  /** additive (optional): the backend's own error text, shown as-is with a Retry button */
  error?: string;
  /** zzz854 (optional): every header number with its equation (same object as summary.countEquations) */
  countEquations?: GuCountEquations;
  /** zzz854 (optional): how many event statuses the universe was reconciled against and where they came from */
  eventReconciliation?: { statuses: number; source: string; error?: string };
  /** zzz857 (optional): every input the universe was built from (live scan, ledger, stored, researched seed, company documents read by the AI extractor) */
  sources?: GuUniverseSourceInfo[];
  /** zzz857 (optional): how much of the collected company documents the AI extractor has read */
  extractCoverage?: GuExtractCoverage;
}
/** zzz857: one input of the universe build and how many guidance rows it gave. */
export interface GuUniverseSourceInfo { id: 'LIVE' | 'LEDGER' | 'STORED' | 'RESEARCHED_SEED' | 'COMPANY_DOC'; label: string; rows: number; note?: string | null }
/** zzz857: documents collected, documents with an extract result, extracted rows, newest extraction (ISO) */
export interface GuExtractCoverage { docs: number; extracted: number; rows: number; lastExtractAt: string | null; error?: string; /** zzz860 */ quality?: import('./guidance-pipeline-coverage').GuDataQuality }

export interface GuRegressionRow {
  ownerText: string;                    // exactly what the owner listed
  company: string; ticker: string | null; market: GgMarket;
  expected: string;                     // e.g. '60% revenue'
  found: string;                        // e.g. '+40% revenue (FY27)' or '—'
  source: string | null; sourceDate: string | null; period: string | null; metric: string | null;
  status: GuRegressionStatus;
  reason: string;
}
export interface GuRegressionResponse { asOf: string; rows: GuRegressionRow[]; counts: Record<GuRegressionStatus, number> }

// ── zzz849 (additive): high-growth rule, period status, implied-growth provenance ──
export type GuPeriodStatus = 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
export type GuHighGrowthHorizon = 'SINGLE_YEAR' | 'MULTI_YEAR_CAGR';
export interface GuHighGrowthMetric { display: string; compareValue: number; period: string; verification: string; implied: boolean; impliedBase: string | null }
/** One company in the high-growth list (extends the UI's compact row). Built by the same function that produces every high-growth count. */
export interface GuHighGrowthRowX extends GuHighGrowthRow {
  rank: number; entityKey: string; company: string; ticker: string | null; market: GgMarket;
  horizon: GuHighGrowthHorizon;
  /** 'CAGR, multi-year' for a multi-year CAGR row, else null. CAGR rows are listed after, and never mixed with, single-year rows. */
  horizonLabel: string | null;
  metric: GgMetric; display: string; compareValue: number; period: string; verification: string; implied: boolean; impliedBase: string | null;
  revenue: GuHighGrowthMetric | null; pat: GuHighGrowthMetric | null;
  revision: string; sourceName: string; sourceDate: string | null; sourceUrl: string | null;
  /** Always 'Highest verified guidance' (a ranking by guided growth among verified records, not a quality or buy ranking). */
  label: 'Highest verified guidance';
  /** zzz853 (additive): the trust state and the growth basis of the headline metric (see summary.highGrowthGroups for the grouped lists) */
  verificationState?: string; growthType?: string; basisLabel?: string; revisionVsPriorGuidance?: string | null; periodNormalized?: string; cohort?: string | null;
}
export interface GuMarketSummary extends GuUniverseMarketCounts { cagrMultiYear: number }
export interface GuSummaryAdditions {
  byMarket: { IN: GuMarketSummary; US: GuMarketSummary; ALL: GuMarketSummary };
  highGrowth: GuHighGrowthRowX[];
  highGrowthLabel: 'Highest verified guidance';
  highGrowthRule: string;
  expiredCount: number; unknownPeriodCount: number; awaitingVerificationCount: number; needsReviewCount: number;
}

// ── zzz853 (additive): data-integrity model ──────────────────────────────────────────────────
import type { SourceTier, SourceTierLabel } from './guidance-config';
export type GuGrowthType = 'EXPLICIT' | 'DERIVED' | 'IMPLIED' | 'UNKNOWN';
export type GuGuidanceType = 'ABSOLUTE_TARGET' | 'GROWTH_RATE' | 'RANGE_TARGET' | 'CAGR';
export type GuVerificationState = 'VERIFIED' | 'DERIVED' | 'PARTIAL' | 'UNVERIFIED' | 'PERIOD_UNCLEAR';
/** periodStatus (zzz853): is the period itself established by the source? (The earlier running/expired state is now `periodRunState`.) */
export type GuPeriodConfirm = 'CONFIRMED' | 'UNCLEAR' | 'UNKNOWN';
export type GuDurationType = 'QUARTER' | 'HALF_YEAR' | 'ANNUAL' | 'MULTI_YEAR' | 'CAGR' | 'UNKNOWN';
export type GuClaimType = 'MANAGEMENT_GUIDANCE' | 'ANALYST_ESTIMATE' | 'CONSENSUS' | 'MEDIA_CLAIM' | 'SYSTEM_DERIVED';
export type GuMetricFamily = 'REVENUE' | 'NET_PROFIT' | 'EBITDA' | 'EPS' | 'FCF';
export type GuLifecycle = 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED' | 'WITHDRAWN';
export type GuCohort = 'ANNUAL' | 'MULTI_YEAR_CAGR' | 'QUARTERLY';
export type GuTrust = 'verified' | 'derived' | 'partial' | 'claimsAwaiting';
export type GuReviewCode = 'PERIOD_UNCLEAR' | 'PERIOD_UNKNOWN' | 'SECONDARY_ONLY' | 'PRIMARY_MISSING' | 'SOURCE_CONFLICT' | 'EXPIRED' | 'POTENTIAL_DUPLICATE' | 'NEEDS_REVIEW' | 'COMPANY_UNRESOLVED' | 'METRIC_LABEL_MISMATCH'
  /** zzz854 */ | 'AWAITING_VERIFICATION' | 'EVENT_CONFLICT' | 'NEWER_PERIOD_GUIDANCE' | 'STALE_VERIFICATION' | 'INVARIANT_FAILED';
export interface GuVersionSnapshot { date: string | null; low: number | null; high: number | null; absoluteLow: number | null; absoluteHigh: number | null; unit: string | null; display: string; source: string }
export interface GuHistoryStep {
  step: number; date: string | null;
  /** null for the first version */ from: GuVersionSnapshot | null; to: GuVersionSnapshot;
  revision: 'INITIAL' | 'RAISED' | 'LOWERED' | 'MAINTAINED' | 'UNKNOWN';
  changeMidPct: number | null; changePp: number | null;
  /** status of the `to` version: the newest is the record's own status, every earlier one is SUPERSEDED (never deleted, never current) */
  status: GuLifecycle; source: string;
}
/** Revision against the PRIOR GUIDANCE (labelled apart from growth vs the prior-year actual). */
export interface GuRevisionVsPrior {
  basis: 'absolute_vs_prior_guidance' | 'percent_vs_prior_guidance'; direction: 'RAISED' | 'LOWERED' | 'MAINTAINED';
  previous: GuVersionSnapshot; current: GuVersionSnapshot;
  previousValue: number | null; previousValueLow: number | null; currentLow: number | null; currentHigh: number | null;
  changeLowPct: number | null; changeMidPct: number | null; changeHighPct: number | null; changePp: number | null;
  display: string;
}
/** Growth against the PRIOR-YEAR ACTUAL (labelled apart from the revision vs prior guidance). */
export interface GuGrowthVsPriorYear { type: GuGrowthType; low: number; mid: number; high: number; display: string; baseLabel: string | null; basis: string | null }
export interface GuGrowthDerivation {
  previousValue: number; currentLow: number; currentHigh: number; unit: string; basePeriod: string;
  growthLow: number; growthMid: number; growthHigh: number;
  basis: 'absolute_vs_prior_guidance' | 'absolute_vs_prior_year_actual';
}
export interface GuSourceEntry { name: string; type: string; url: string | null; date: string | null; tier: SourceTier; tierLabel: SourceTierLabel; value: string; low: number | null; high: number | null; absolute: { value: number; unit: string; valueLow?: number } | null; role: 'PRIMARY' | 'MEDIA_CLAIM' | 'OTHER' }
export interface GuReviewReasonX { code: GuReviewCode; text: string; /** true = this reason alone keeps the record out of the default view */ blocks: boolean }
export interface GuHgMetricX {
  metric: GgMetric; metricFamily: GuMetricFamily; sourceMetricLabel: string | null; display: string; /** short text such as '+60%' or '+60% (derived)' */ short: string; compareValue: number; period: string; periodNormalized: string;
  verificationState: GuVerificationState; growthType: GuGrowthType; guidanceType: GuGuidanceType; basisLabel: string; headlineBasis: 'GROWTH_VS_PRIOR_YEAR' | 'ABSOLUTE_TARGET_ONLY';
  revisionVsPriorGuidance: string | null; sourceConflict: boolean;
  /** zzz860 (additive): calculation type and verification status kept apart, the wording rule, one freshness rule */
  calculationType?: import('./guidance-semantics').GuCalculationType; verificationStatus?: import('./guidance-semantics').GuVerificationStatus; wording?: string; freshness?: import('./guidance-semantics').GuFreshnessTier; lastVerifiedDaysAgo?: number | null;
  /** zzz925 (additive): for a worked-out growth, the amounts it came from (target and base), so a reader can check it against reported revenue */
  derivation?: GuGrowthDerivation | null;
}
export interface GuHgGroupRow {
  id: string; rank: number; entityKey: string; company: string; ticker: string | null; market: GgMarket; cohort: GuCohort; trust: GuTrust;
  /** every qualifying metric, kept apart: Revenue / PAT / EBITDA are never merged */ metrics: GuHgMetricX[];
  /** 'Revenue +30% · PAT +60%' */ text: string; headline: GuHgMetricX; sourceName: string; sourceDate: string | null; sourceUrl: string | null;
}
export interface GuHighGrowthGroups {
  threshold: number; label: string; rule: string;
  /** every row of the default view, split by cohort and sorted within it (never one mixed ranking) */
  cohorts: Record<GuCohort, GuHgGroupRow[]>;
  /** the same rows split by trust, then by cohort. verified = strict: VERIFIED + CONFIRMED period + active. */
  trust: Record<GuTrust, Record<GuCohort, GuHgGroupRow[]>>;
  counts: { rows: number; verified: number; derived: number; partial: number; claimsAwaiting: number; ANNUAL: number; MULTI_YEAR_CAGR: number; QUARTERLY: number; /** zzz854: distinct companies in the ranked Active rows */ companies?: number };
  /** zzz1115 (G02): growth figures kept out of the ranking because they are most likely one business, not the company (still shown) */
  scopeHeld?: Array<{ entityKey: string; company: string; ticker: string | null; market: string; metric: string; text: string; reason: string }>;
  /** zzz1116 (G04): guidance points kept out of every ranking because a data check failed for them (one snapshot) */
  quarantined?: Array<{ entityKey: string; company: string | null; metric: string | null; checks: string[] }>;
}
export interface GuStateCounts { activeRecords: number; verified: number; partial: number; derived: number; unverified: number; periodUnclear: number }
export interface GuExpirySummary { expired: number; superseded: number; withdrawn: number; total: number; reasons: Array<{ reason: string; count: number }> }
export interface GuViewCounts { default: number; review: number; expired: number; superseded: number; withdrawn: number; excluded: number; /** zzz854: unverified claims, never in Active */ claimsAwaiting?: number }
export interface GuInvariantViolation { code: string; entityKey: string | null; company: string | null; metric: string | null; message: string }
export type GuServedFrom = 'live' | 'last_good' | 'seed';

// ── zzz854 (additive): cross-tab reconciliation with the EVENTS layer, list buckets, count equations ──────────────
/** Which list a point / record belongs to. ACTIVE = verified, derived or partial-with-document-read; REVIEW = something does not add up;
 *  CLAIMS = not verified by the company's own document yet (media / social / not read / last verified unknown). CLAIMS is never ranked in Active. */
export type GuListBucket = 'ACTIVE' | 'REVIEW' | 'CLAIMS';
/** What the newest event (Layer B) says about a company + metric + period. */
export type GuEventStatusKind = 'RAISED' | 'REITERATED' | 'LOWERED' | 'MIXED' | 'INVALID' | 'NO_NUMBERS';
export interface GuEventStatus {
  market: 'IN' | 'US'; ticker: string; company: string; metric: GgMetric;
  /** normalised period ('FY27', 'Q2 FY27'); 'UNSTATED' when the event gave none */ period: string;
  /** the company's announcement date (YYYY-MM-DD) */ date: string;
  status: GuEventStatusKind;
  /** true = the event was confirmed by a primary document (only these override a universe record) */ verified: boolean;
  /** plain label, e.g. 'GUIDANCE REITERATED' */ label: string;
  /** 'before → after' as the event shows it, or null */ display: string | null;
  sourceName: string | null; sourceUrl: string | null; eventId: string | null;
  /** why an event is INVALID (e.g. 'the narrative describes a capital raise, not guidance') */ reason?: string | null;
  /** zzz860: what the change IS (GUIDANCE_RAISED / GUIDANCE_LOWERED / RANGE_RESTRUCTURE / REITERATION / CAPITAL_RAISE / NOT_GUIDANCE / UNRESOLVED), apart from how big it is */ eventType?: import('./guidance-semantics').GuEventType;
}
/** Set on a point when a newer primary-source event disagrees with it. The event wins; the point leaves the Active list. */
export interface GuEventOverride {
  code: 'EVENT_CONFLICT' | 'NEWER_PERIOD_GUIDANCE';
  eventStatus: GuEventStatusKind; eventDate: string; eventPeriod: string; eventLabel: string; eventDisplay: string | null;
  /** what the universe record said before the override ('RAISED') */ previousRevision: string;
  /** e.g. 'Latest filing (2026-08-14) says GUIDANCE REITERATED; this record said RAISED.' */ text: string;
  sourceName: string | null; sourceUrl: string | null;
}
export interface GuCountEquation { value: number; text: string; holds: boolean; parts?: Record<string, number> }
/** Every header number and the equation it comes from. All computed from the same filtered sets as the lists. */
export interface GuCountEquations {
  /** Active = verified + derived + partial (records in the Active list, by the headline metric's trust state) */ active: GuCountEquation;
  /** Highest active guidance = Active rows (one per company per period type) with Revenue / PAT / EBITDA guided growth >= threshold */ highestActive: GuCountEquation & { companies: number; threshold: number };
  needsReview: GuCountEquation; claimsAwaiting: GuCountEquation;
  /** active + needs review + claims awaiting = all rows shown across the three lists */ rows: GuCountEquation;
}
