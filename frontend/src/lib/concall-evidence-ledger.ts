// Transformation Radar: source-level evidence metadata, not a financial fact checker.
// Never infer a speaker, claim period, or quantitative result from a filing date.
import { assessRadarQuote, type QuoteQuality } from './concall-radar-decision';

export type EvidenceAttribution = 'MANAGEMENT' | 'ANALYST' | 'UNKNOWN';
export type EvidenceVerification = 'REJECTED' | 'NEEDS_ATTRIBUTION' | 'NEEDS_PERIOD_AND_ATTRIBUTION';
export interface RadarEvidenceRecord {
  source_url: string;
  attachment_url: string | null;
  filing_datetime: string;
  symbol: string;
  quote: string;
  quote_quality: QuoteQuality;
  attribution: EvidenceAttribution;
  fiscal_period: string | null;
  segment: string | null;
  verification: EvidenceVerification;
  missing: string[];
}

/** A fiscal period may be displayed only when it occurs IN the actual selected excerpt. */
export function periodInQuote(quote: string): string | null {
  const q = quote.replace(/\s+/g, ' ');
  const m = q.match(/\bQ([1-4])\s*(?:FY|[-/]?\s*FY)\s*['’]?(20)?(\d{2})\b/i)
    || q.match(/\b(?:FY)\s*['’]?(20)?(\d{2})\b/i);
  if (!m) return null;
  // zzz1212 — "margin expanded to 9.6% from 6.4% in Q2 FY'26": the only period named is the COMPARISON base, not the
  // period the claim is about. A period introduced by from / versus / compared with / against / over is not the claim's.
  const before = q.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
  if (/\b(?:from|vs\.?|versus|compared (?:to|with)|against|over|as against|relative to|last year'?s?|previous|prior)\b(?:[^.;]|\.(?=\d)){0,30}$/i.test(before)) return null;
  if (/^Q/i.test(m[0])) return `Q${m[1]} FY${m[3]}`;
  return `FY${m[2]}`;
}

/** Explicitly UNKNOWN unless a separate speaker-aware transcript parser supplies attribution. */
export function buildRadarEvidenceRecord(input: {
  symbol: string; source_url: string; attachment_url: string | null;
  filing_datetime: string; evidence_quote: string; scored_from: 'PDF' | 'SUBJECT';
}): RadarEvidenceRecord {
  const quote = input.evidence_quote || '';
  const quality = input.scored_from === 'PDF' ? assessRadarQuote(quote).quality : 'MISSING';
  const period = quality === 'USABLE' ? periodInQuote(quote) : null;
  const missing = [
    ...(input.scored_from !== 'PDF' ? ['Primary document not extracted'] : []),
    ...(quality !== 'USABLE' ? ['Coherent quote not established'] : []),
    'Speaker not attributed',
    ...(period ? [] : ['Fiscal period not established in quoted evidence']),
    'Business segment not independently attributed',
    'Latest superseding guidance not reconciled',
  ];
  return {
    symbol: input.symbol,
    source_url: input.source_url,
    attachment_url: input.attachment_url,
    filing_datetime: input.filing_datetime,
    quote,
    quote_quality: quality,
    attribution: 'UNKNOWN',
    fiscal_period: period,
    segment: null,
    verification: quality !== 'USABLE' ? 'REJECTED' : period ? 'NEEDS_ATTRIBUTION' : 'NEEDS_PERIOD_AND_ATTRIBUTION',
    missing,
  };
}

// Match actual measurements only across identical metric + period + segment + units.
// A guidance number and a reported actual must NEVER be silently compared.
export type LedgerMeasure = {
  symbol: string; metric: string; fiscal_period: string; segment: string;
  basis: 'ACTUAL' | 'GUIDANCE'; unit: string; value: number;
  filing_datetime: string; source_url: string;
};
export function reconcileLedgerMeasurements(items: readonly LedgerMeasure[]) {
  const groups = new Map<string, LedgerMeasure[]>();
  for (const i of items) {
    if (!Number.isFinite(i.value) || !i.fiscal_period || !i.metric || !i.source_url) continue;
    const key = [i.symbol.toUpperCase(), i.metric.toUpperCase(), i.fiscal_period.toUpperCase(),
      i.segment.toUpperCase(), i.basis, i.unit.toUpperCase()].join('|');
    groups.set(key, [...(groups.get(key) || []), i]);
  }
  return [...groups.entries()].map(([key, matches]) => {
    const chronological = [...matches].sort((a, b) => a.filing_datetime.localeCompare(b.filing_datetime));
    const distinct = new Set(chronological.map(m => m.value));
    return {
      key, status: distinct.size > 1 ? 'CONFLICT_REVIEW' as const : 'CONSISTENT' as const,
      records: chronological,
      latest: chronological[chronological.length - 1],
      // "latest" is a disclosure date, NOT a confirmation of supersession.
    };
  });
}
