// Decision triage for the Concall Transformation Radar.
// This is a REVIEW PRIORITY, never a buy recommendation or price target.
// A single transcript cannot certify the latest guidance, valuation or trend.
export type RadarQueue = 'RESEARCH' | 'RECONCILE' | 'WAIT' | 'RISK' | 'UNVERIFIED';
export interface RadarTriageInput {
  bullish_tier?: string;
  scored_from?: 'PDF' | 'SUBJECT';
  caution_level?: number;
  caution_flags?: string[];
  evidence_score?: number;
  evidence_quote?: string;
  evidence_breadth?: number;
  patterns?: Array<{ key: string; hits?: number }>; 
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


// USABLE is only a text-quality test, NOT independent confirmation of a fact.
export type QuoteQuality = 'USABLE' | 'QUESTION' | 'BOILERPLATE' | 'BROKEN' | 'MISSING';
export function assessRadarQuote(raw: string | null | undefined): { quality: QuoteQuality; reason: string } {
  const q = String(raw || '').replace(/\s+/g, ' ').trim();
  if (q.length < 35) return { quality: 'MISSING', reason: 'Missing or incomplete extracted quote.' };
  if (/\?$|\bmy (?:first|second|third|last) question\b|\bcan you (?:share|comment|explain|tell)\b|\bcould you (?:share|comment|explain|tell)\b|\bhow do we look\b/i.test(q))
    return { quality: 'QUESTION', reason: 'An analyst question is not management-confirmed financial evidence.' };
  if (/\b(?:qualified institutional buyers|rule 144a|forward-looking statements|not guarantees of future|safe harbor|our philosophy mission vision|key milestones|as defined in|primarily responsible for overseeing|risk factors)\b/i.test(q))
    return { quality: 'BOILERPLATE', reason: 'Legal, historical or biography text is not evidence of operating progress.' };
  if (/[a-z]{4,}[A-Z][a-z]{3,}|(?:Q[1-4]FY\d{2}){3,}/.test(q) || q.split(/\s+/).filter(x => /[A-Za-z]{3,}/.test(x)).length < 6)
    return { quality: 'BROKEN', reason: 'Fragmented or concatenated PDF text must be checked against the original.' };
  // zzz1214 — a slide table pasted into one line ("QoQ 89.0% YoY Rs 2.5 Cr 100.8% QoQ …") or a sentence cut mid-way is not a statement
  const toks = q.split(/\s+/);
  const numeric = toks.filter((x) => /\d/.test(x)).length;
  if (toks.length >= 8 && numeric / toks.length > 0.35)
    return { quality: 'BROKEN', reason: 'Slide table text (mostly numbers), not a sentence; read the slide itself.' };
  if (/^[a-z]/.test(q) && !/^(?:we|our|the|this|in|on|for|during|with|and|so|but)\b/.test(q))
    return { quality: 'BROKEN', reason: 'The excerpt starts in the middle of a sentence; check the full sentence in the filing.' };
  return { quality: 'USABLE', reason: 'Coherent excerpt; attribution, period and accounting remain unverified.' };
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
  const proofBreadth = item.evidence_breadth ?? 0; // distinct matched rungs, NOT independent filings
  const structuralKeys = new Set(['customer', 'capacity', 'cdmo', 'export', 'recurring', 'acqui', 'mix', 'debt', 'parent']);
  const structuralCount = (item.patterns ?? []).filter(p => structuralKeys.has(p.key)).length;
  const sentiment = (item.bullish_tier || '').toUpperCase();
  const stage = item.stage ?? 0;
  const financial = item.triple?.financial === true;
  const quote = assessRadarQuote(item.evidence_quote);

  const alwaysCheck = ['Current guidance not reconciled across filings', 'Current valuation and price setup not checked'];
  if (item.scored_from !== 'PDF') return {
    queue: 'UNVERIFIED', label: 'VERIFY DOCUMENT',
    reason: 'Only the announcement subject was scored, not the full filing.',
    nextCheck: 'Open the primary filing, extract guidance and financial evidence, then re-score.',
    blockers: [...alwaysCheck, 'Full transcript unavailable'],
  };
  if (cut || bearish || level >= 2 || negative.length >= 1) {
    // Both "margin improved" and "margin down" can appear across different
    // subsidiaries/periods. Do not treat a document-wide negative keyword as
    // a verified current-period deterioration.
    const conflict = !cut && !bearish && quote.quality === 'USABLE' && evidence >= 6 && negative.length > 0;
    const why = cut ? 'Guidance reduction detected; verify the fiscal period and superseding guidance' :
      conflict ? 'Positive results conflict with negative phrases: ' + negative.slice(0, 3).join(', ') :
      negative.length ? 'Negative transcript phrases requiring period validation: ' + negative.slice(0, 3).join(', ') :
      bearish ? 'Bearish filing sentiment' : 'Multiple caution signals';
    return {
      queue: conflict ? 'RECONCILE' : 'RISK',
      label: conflict ? 'RECONCILE RESULTS' : 'PAUSE / VERIFY',
      reason: why,
      nextCheck: conflict ? 'Compare the actual positive and negative passages for the SAME quarter and segment before acting.' :
        'Compare the latest two guidance statements and corresponding actual results before considering a new position.',
      blockers: [...alwaysCheck, ...flags.slice(0, 6)],
    };
  }
  // Evidence stage 8/9/10 is NOT proof of a late business cycle. Realised
  // margin/FCF improvements may be the first earnings inflection.
  if (evidence >= 5 && quote.quality !== 'USABLE') return {
    queue: 'WAIT', label: 'SOURCE PROOF UNRELIABLE',
    reason: quote.reason,
    nextCheck: 'Open the primary PDF and verify an actual management statement, current customer order or reported number.',
    blockers: [...alwaysCheck, 'Primary excerpt failed text-quality gate'],
  };
  // A strong margin line is not itself a transformation. Financial keyword
  // matching in the analyzer is permissive: do not label an unchanged/neutral
  // operating business "Underwrite" on one good sentence.
  const positiveOutlook = sentiment === 'BULLISH' || sentiment === 'ULTRA_BULLISH';
  const layeredEvidence = evidence >= 8 && proofBreadth >= 3 && structuralCount >= 2;
  if (!positiveOutlook || !financial || !layeredEvidence) {
    const why = !positiveOutlook
      ? (sentiment === 'MIXED_POSITIVE' ? 'Mixed-positive tone: materiality and forward outlook not established.' : 'Neutral or unconfirmed outlook; a positive margin quarter alone is insufficient.')
      : !financial ? 'Financial improvement has not been verified from the extracted filing.'
      : evidence < 8 ? 'Orders or plans alone have not been shown to contribute reported revenue or earnings.'
      : proofBreadth < 3 ? 'One or two isolated proof signals cannot establish an earnings J-curve.'
      : 'Too few distinct structural business-change drivers; this may be ordinary quarterly margin variation.';
    return {
      queue: 'WAIT', label: 'VALIDATE EARNINGS INFLECTION',
      reason: why,
      nextCheck: 'Compare the latest two quarters of sales, EBIT/PAT, margins and cash flow; quantify order-to-revenue conversion, forward guidance and the stock valuation.',
      blockers: [...alwaysCheck, 'At least three distinct proof rungs and two structural drivers required', 'Cross-quarter acceleration unverified'],
    };
  }
  return {
    queue: 'RESEARCH', label: 'RESEARCH FIRST',
    reason: 'Multiple different operating milestones, a positive filing tone and a realised earnings excerpt justify underwriting, not buying.',
    nextCheck: 'Independently verify latest guidance, diluted EPS growth for two quarters, CFO/PAT, incremental ROIC, current valuation and technical entry.',
    blockers: [...alwaysCheck, 'Separate filings and subsequent earnings still require confirmation'],
  };
}

const ORDER: Record<RadarQueue, number> = { RESEARCH: 0, RECONCILE: 1, RISK: 2, WAIT: 3, UNVERIFIED: 4 };
export function rankForDecision<T extends RadarTriageInput>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const qa = ORDER[radarDecision(a).queue], qb = ORDER[radarDecision(b).queue];
    if (qa !== qb) return qa - qb;
    const sa = a.transformation_score ?? 0, sb = b.transformation_score ?? 0;
    if (sa !== sb) return sb - sa;
    return (b.filing_datetime ?? '').localeCompare(a.filing_datetime ?? '');
  });
}
