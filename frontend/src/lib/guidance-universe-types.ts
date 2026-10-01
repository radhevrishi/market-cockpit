// zzz848 — GUIDANCE UNIVERSE (Layer A) vs GUIDANCE EVENTS (Layer B). Types only.
// Layer A = persistent, currently valid management guidance (independent of event recency).
// Layer B = time-windowed events (24H/3D/7D/14D/30D/120D) — the existing guidance-upgrades feed.
// Summary numbers are always computed from the records, never hard-coded.
import type { GgCompany, GgMetric, GgMarket } from './growth-guidance-types';

export type GuRegressionStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NOT_FOUND' | 'REJECTED' | 'SUPERSEDED' | 'EXPIRED';
export type GuUniverseRecordOrigin = 'LIVE' | 'LEDGER' | 'RESEARCHED_SEED';

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
}

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
}
export interface GuMarketSummary extends GuUniverseMarketCounts { cagrMultiYear: number }
export interface GuSummaryAdditions {
  byMarket: { IN: GuMarketSummary; US: GuMarketSummary; ALL: GuMarketSummary };
  highGrowth: GuHighGrowthRowX[];
  highGrowthLabel: 'Highest verified guidance';
  highGrowthRule: string;
  expiredCount: number; unknownPeriodCount: number; awaitingVerificationCount: number; needsReviewCount: number;
}
