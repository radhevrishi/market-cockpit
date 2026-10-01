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
}

export interface GuUniverseBucket { companies: number; revenueGte30: number; patGte30: number; revenueAndPatGte30: number; highestRevenue: { company: string; display: string } | null }
export interface GuUniverseSummary {
  asOf: string;
  india: GuUniverseBucket;
  usa: GuUniverseBucket;
  all: { active: number; raised: number; maintained: number; cut: number; atRisk: number; mediaOnly: number };
  threshold: number;
}

export interface GuUniverseResponse {
  summary: GuUniverseSummary;
  records: GuUniverseRecord[];          // active guidance, NOT filtered by event window
  scan: { note: string; complete: boolean };
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
