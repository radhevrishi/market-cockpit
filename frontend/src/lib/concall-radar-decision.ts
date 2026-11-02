// Decision triage for the Concall Transformation Radar.
// This is a REVIEW PRIORITY, never a buy recommendation or price target.
// A single transcript cannot certify the latest guidance, valuation or trend.
export type RadarQueue = 'RESEARCH' | 'WAIT' | 'RISK' | 'UNVERIFIED';
export interface RadarTriageInput {
  bullish_tier?: string;
  scored_from?: 'PDF' | 'SUBJECT';
  caution_level?: number;
  caution_flags?: string[];
  evidence_score?: number;
  stage?: number;
  stage_sweet_spot?: boolean;
  transformation_score?: number;
  triple?: { industry?: boolean; company?: boolean; financial?: boolean; count?: number };
  filing_datetime?: string;
}

export interface RadarDecision {
  queue: RadarQueue;
  label: string;
  reason: string;
  nextCheck: string;
  blockers: string[];
}

const HARD_NEGATIVES = new Set([
  'guidance reduced', 'profit down', 'margin down', 'revenue down',
  'volume down', 'pricing pressure', 'de-growth', 'weak demand', 'slowdown',
  'cautious tone', 'forex drag',
]);

export function radarDecision(item: RadarTriageInput): RadarDecision {
  const flags = (item.caution_flags || []).map((x) => x.toLowerCase().trim());
  const cut = flags.some((x) => /guidance reduced|guidance cut|outlook lowered|forecast cut/.test(x));
  const negative = flags.filter((x) => HARD_NEGATIVES.has(x));
  const bearish = ['BEARISH', 'MIXED_NEGATIVE'].includes((item.bullish_tier || '').toUpperCase());
  const level = item.caution_level ?? 0;
  const evidence = item.evidence_score ?? 0;
  const stage = item.stage ?? 0;
  const financial = item.triple?.financial === true;

  const alwaysCheck = ['Current guidance not reconciled across filings', 'Current valuation and price setup not checked'];
  if (item.scored_from !== 'PDF') return {
    queue: 'UNVERIFIED', label: 'VERIFY DOCUMENT',
    reason: 'Only the announcement subject was scored, not the full filing.',
    nextCheck: 'Open the primary filing, extract guidance and financial evidence, then re-score.',
    blockers: [...alwaysCheck, 'Full transcript unavailable'],
  };
  if (cut || bearish || level >= 2 || negative.length >= 1) {
    const why = cut ? 'Guidance reduction detected' : negative.length ? 'Adverse operating signals: ' + negative.slice(0, 3).join(', ') : bearish ? 'Bearish filing sentiment' : 'Multiple caution signals';
    return {
      queue: 'RISK', label: 'PAUSE / VERIFY',
      reason: why,
      nextCheck: 'Compare the latest two guidance statements, actual sales/margin/PAT and management explanations before considering a new position.',
      blockers: [...alwaysCheck, ...flags.slice(0, 6)],
    };
  }
  if (stage >= 8) return {
    queue: 'WAIT', label: 'LATE / REVIEW',
    reason: 'The disclosed transformation appears relatively mature (stage 8–10); early-J-curve advantage is unproven.',
    nextCheck: 'Quantify incremental ROIC and residual earnings runway; test valuation against normalized forward EPS.',
    blockers: alwaysCheck,
  };
  if (evidence < 6 || stage < 3 || !financial) return {
    queue: 'WAIT', label: 'WAIT FOR PROOF',
    reason: evidence < 6 ? 'No confirmed commercial order or higher-level proof.' : !financial ? 'Operating or financial inflection not established.' : 'Very early-stage transformation claim.',
    nextCheck: 'Look for order execution, booked revenue, EBITDA/PAT growth and operating cash-flow confirmation in the next result.',
    blockers: [...alwaysCheck, 'Earnings conversion not yet established'],
  };
  return {
    queue: 'RESEARCH', label: 'RESEARCH FIRST',
    reason: 'Commercial evidence and a reported financial signal warrant a deeper review; this is not a buy trigger.',
    nextCheck: 'Verify latest management guidance, actual diluted EPS growth, CFO/PAT, capital needs, valuation and technical entry.',
    blockers: alwaysCheck,
  };
}

const ORDER: Record<RadarQueue, number> = { RESEARCH: 0, WAIT: 1, RISK: 2, UNVERIFIED: 3 };
export function rankForDecision<T extends RadarTriageInput>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const qa = ORDER[radarDecision(a).queue], qb = ORDER[radarDecision(b).queue];
    if (qa !== qb) return qa - qb;
    const sa = a.transformation_score ?? 0, sb = b.transformation_score ?? 0;
    if (sa !== sb) return sb - sa;
    return (b.filing_datetime ?? '').localeCompare(a.filing_datetime ?? '');
  });
}
