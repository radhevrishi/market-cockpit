// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0387 — Concall Intelligence: Bullish Scoring Engine
//
// Multi-layer filter per the institutional blueprint:
//   1. RELEVANCE — subject contains transcript / concall / investor
//      presentation / results presentation / analyst meet / audio recording
//      / webcast keywords.
//   2. BULLISH EVIDENCE — KEYWORD COMBINATIONS (not single words).
//      Management confidence phrase + business evidence phrase + zero
//      critical negative blockers.
//   3. SCORING — weighted phrase groups; score >= 6 surfaces in feed.
//
// Used by both:
//   - /api/v1/concall-intel/live-feed (NSE/BSE auto-poll)
//   - /api/v1/concall/analyze (existing manual analyser, future enrichment)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Layer 1: Relevance check ───────────────────────────────────────────────
// Returns the filing TYPE if relevant; null otherwise.

export type ConcallFilingType =
  | 'TRANSCRIPT'
  | 'INVESTOR_PRESENTATION'
  | 'CONCALL_INVITE'
  | 'ANALYST_MEET'
  | 'AUDIO_RECORDING'
  | 'RESULTS_PRESENTATION'
  | 'PRESS_RELEASE'
  | 'WEBCAST';

const RELEVANCE_PATTERNS: Array<{ type: ConcallFilingType; re: RegExp }> = [
  { type: 'TRANSCRIPT',            re: /transcript|earnings\s+call\s+transcript|conference\s+call\s+transcript/i },
  { type: 'INVESTOR_PRESENTATION', re: /investor\s+presentation|investor\s+meet\s+presentation/i },
  { type: 'RESULTS_PRESENTATION',  re: /results\s+presentation|results\s+update|quarterly\s+update|earnings\s+presentation/i },
  { type: 'CONCALL_INVITE',        re: /\b(?:con\s*call|conference\s+call|earnings\s+call)\b/i },
  { type: 'ANALYST_MEET',          re: /\banalyst\s+meet\b|\banalyst\s+day\b|institutional\s+investor\s+meet|investor\s+meet\b/i },
  { type: 'AUDIO_RECORDING',       re: /audio\s+recording|audio\s+file\s+of|recording\s+of\s+the\s+(?:earnings|investor|analyst|conference)/i },
  { type: 'WEBCAST',               re: /webcast|live\s+stream\s+of/i },
  { type: 'PRESS_RELEASE',         re: /press\s+release.*(?:result|earnings|guidance|outlook)/i },
];

export function classifyFiling(subject: string): ConcallFilingType | null {
  const s = subject || '';
  for (const { type, re } of RELEVANCE_PATTERNS) {
    if (re.test(s)) return type;
  }
  return null;
}

// ─── Layer 2: Bullish keyword combinations ─────────────────────────────────
// Per user spec: NOT single keywords. Each combination = anchor + supporting
// term + (optional) numeric/timeline qualifier. A filing scores points for
// each combination it matches.

interface BullishCombo {
  tag: string;                    // user-facing label
  weight: number;                 // points if combo fires
  anchors: RegExp[];              // at least one must match
  supports: RegExp[];             // at least one must match
  qualifiers?: RegExp[];          // optional — adds +1 bonus if matched
  reason: string;                 // narrative for UI
}

export const BULLISH_COMBOS: BullishCombo[] = [
  // Guidance combo
  {
    tag: 'Guidance',
    weight: 3,
    anchors: [/\bguidance\b/i, /\boutlook\b/i, /\bforecast\b/i],
    supports: [/\b(?:raise|raised|raising|upgrade|upgraded|upgrading|maintain(?:ed|ing)?|reiterate)\b/i, /better\s+than\s+expected/i, /confidence\s+in\s+(?:growth|outlook)/i],
    qualifiers: [/\d+(?:\.\d+)?\s*%/, /\bFY2[5-9]\b/i, /next\s+quarter/i],
    reason: 'Guidance / outlook raised or reiterated',
  },
  // Order book combo
  {
    tag: 'Order Book',
    weight: 3,
    anchors: [/order\s+book/i, /order\s+inflow/i, /order\s+pipeline/i, /order\s+backlog/i],
    supports: [/\b(?:strong|robust|healthy|record|all[-\s]?time\s+high|multi[-\s]?(?:quarter|year))\b/i, /grew/i, /increased?/i, /expanded?/i],
    qualifiers: [/\d+(?:\.\d+)?\s*%/, /multi[-\s]?year\s+visibility/i],
    reason: 'Order book / pipeline strength',
  },
  // Capacity combo
  {
    tag: 'Capacity',
    weight: 2.5,
    anchors: [/\bcapacity\b/i, /\butilization\b/i, /\butilisation\b/i, /commissioning/i],
    supports: [/\b(?:ramp(?:[-\s]?up)?|expand(?:ed|ing)?|improve[ds]?|commercial\s+production|commission(?:ed|ing)?)\b/i],
    qualifiers: [/\d+(?:\.\d+)?\s*%/, /new\s+(?:plant|facility|line)/i],
    reason: 'Capacity expansion / utilization improving',
  },
  // Demand combo
  {
    tag: 'Demand',
    weight: 2.5,
    anchors: [/\bdemand\b/i, /\binquir(?:y|ies)\b/i, /\bpipeline\b/i, /sales\s+inquir/i],
    supports: [/\b(?:strong|robust|healthy|accelerat|surge|pickup|acceleration)\b/i],
    qualifiers: [/double[-\s]?digit/i, /\d+(?:\.\d+)?\s*%/],
    reason: 'Demand acceleration',
  },
  // Margin combo
  {
    tag: 'Margin',
    weight: 3,
    anchors: [/EBITDA\s+margin/i, /operating\s+(?:margin|leverage)/i, /gross\s+margin/i],
    supports: [/\b(?:improved?|expand(?:ed|ing)?|expansion|normaliz|step[-\s]?up|recover)/i],
    qualifiers: [/\d+\s*(?:bps|basis\s+points|pp|percentage\s+points|%)/i],
    reason: 'Margin expansion / operating leverage',
  },
  // Export combo
  {
    tag: 'Export',
    weight: 2,
    anchors: [/\bexport\b/i, /\binternational\b/i, /overseas/i],
    supports: [/\b(?:growth|new\s+customer|market\s+share|traction|inroad|win)\b/i],
    reason: 'Export traction',
  },
  // Customer-win combo
  {
    tag: 'New Customer',
    weight: 2.5,
    anchors: [/new\s+customer/i, /approved\s+vendor/i, /repeat\s+order/i, /qualif(?:y|ied)/i, /onboard(?:ed)?/i, /tier[-\s]?1\s+customer/i],
    supports: [/\b(?:ramp(?:[-\s]?up)?|scale[-\s]?up|multi[-\s]?year|long[-\s]?term|won)\b/i, /major\s+(?:OEM|client|customer)/i],
    reason: 'New customer / repeat order',
  },
  // Market share combo
  {
    tag: 'Market Share',
    weight: 2,
    anchors: [/market\s+share/i, /share\s+gain/i, /share\s+of\s+wallet/i],
    supports: [/\b(?:gain(?:ed|ing)?|increased?|expanded?|grew)\b/i],
    reason: 'Market share gain',
  },
  // Cash flow combo
  {
    tag: 'Cash Flow',
    weight: 2,
    anchors: [/free\s+cash\s+flow/i, /operating\s+cash\s+flow/i, /\bFCF\b/, /\bCFO\b/],
    supports: [/\b(?:strong|improved?|turned\s+positive|generated|cash[-\s]?accretive)\b/i],
    reason: 'Cash generation',
  },
  // Deleveraging combo
  {
    tag: 'Deleveraging',
    weight: 2.5,
    anchors: [/deleverag(?:e|ing)/i, /\bdebt\s+reduc/i, /debt[-\s]?free/i, /net\s+cash/i, /balance\s+sheet/i],
    supports: [/\b(?:improved?|strengthen|reduced?|fall|fell|repaid|prepay)\b/i],
    qualifiers: [/₹\s*\d+\s*(?:cr|crore)/i, /\d+(?:\.\d+)?\s*%/],
    reason: 'Balance sheet repair',
  },
  // Premiumization
  {
    tag: 'Premiumization',
    weight: 2,
    anchors: [/premium(?:isation|ization|ize|ise)/i, /better\s+mix/i, /value[-\s]?added/i, /higher[-\s]?margin\s+segment/i],
    supports: [/\b(?:shift|growth|increased?|expand|trend)\b/i],
    reason: 'Premiumization / mix improvement',
  },
  // Capex / growth investment
  {
    tag: 'Capex',
    weight: 1.5,
    anchors: [/\bcapex\b/i, /capital\s+expenditure/i, /\bgreenfield\b/i, /\bbrownfield\b/i],
    supports: [/\b(?:announced?|planned?|approved?|commission|on\s+track)\b/i],
    qualifiers: [/₹\s*\d+\s*(?:cr|crore)/i],
    reason: 'Capacity expansion capex',
  },
];

// ─── Layer 3: Negative blockers ────────────────────────────────────────────
// If any of these fire, the score is heavily penalized regardless of positive
// signals. Filing is excluded from "high bullish" if a critical blocker hits.

interface NegBlocker {
  re: RegExp;
  weight: number;       // points subtracted
  critical: boolean;    // if true, kills the bullish tag even if score >=6
  tag: string;
}

export const NEG_BLOCKERS: NegBlocker[] = [
  { re: /one[-\s]?off|exceptional\s+(?:gain|item)/i,           weight: 4, critical: true,  tag: 'One-off gain' },
  { re: /weak\s+demand|demand\s+softness|muted\s+demand/i,     weight: 4, critical: true,  tag: 'Weak demand' },
  { re: /margin\s+pressure|margin\s+compression|margin\s+contraction/i, weight: 4, critical: true, tag: 'Margin pressure' },
  { re: /pricing\s+pressure|price\s+erosion|pricing\s+decline/i, weight: 3, critical: true, tag: 'Pricing pressure' },
  { re: /inventory\s+correction|destocking|inventory\s+(?:overhang|build[-\s]?up)/i, weight: 3, critical: false, tag: 'Inventory correction' },
  { re: /\b(?:delay(?:ed|s)?|postpone(?:d|ment)?|deferred?|deferment)\b/i, weight: 2, critical: false, tag: 'Delay' },
  { re: /\bcancel(?:l(?:ed|ation))?\b/i,                       weight: 3, critical: true,  tag: 'Cancellation' },
  { re: /shutdown|plant\s+closure|production\s+halt/i,         weight: 3, critical: true,  tag: 'Shutdown' },
  { re: /cost\s+inflation|raw[-\s]?material\s+pressure/i,      weight: 2, critical: false, tag: 'Cost inflation' },
  { re: /muted\s+outlook|cautious\s+outlook|uncertain\s+outlook/i, weight: 3, critical: true, tag: 'Cautious outlook' },
  { re: /lower\s+utilization|lower\s+utilisation|under[-\s]?utiliz/i, weight: 2, critical: false, tag: 'Lower utilization' },
  { re: /receivable\s+stress|working\s+capital\s+stretch/i,    weight: 2, critical: false, tag: 'Receivable stress' },
  { re: /slowdown|deceleration|sluggish/i,                     weight: 2, critical: false, tag: 'Slowdown' },
  { re: /geopolitical\s+headwind|adverse\s+macro/i,            weight: 1.5, critical: false, tag: 'Macro headwind' },
];

// ─── Scoring engine ────────────────────────────────────────────────────────

export interface BullishScore {
  score: number;                         // 0-10 normalized
  raw_score: number;                     // raw points (pre-clamp)
  sentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'INSUFFICIENT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  tags: string[];                        // matched combo tags (Guidance, Order Book, etc.)
  bullish_phrases: string[];             // narrative reasons
  red_flags: string[];                   // matched negative tags
  critical_blocker: boolean;             // any critical blocker?
  components: {
    management_confidence: number;       // sum of weights for Guidance/Demand/Margin/Outlook
    business_evidence: number;           // sum of weights for Order Book / Capacity / New Customer / Market Share
    blockers: number;                    // total negative weight
  };
}

const MGMT_CONFIDENCE_TAGS = new Set(['Guidance', 'Demand', 'Margin', 'Premiumization']);
const BUSINESS_EVIDENCE_TAGS = new Set(['Order Book', 'Capacity', 'New Customer', 'Market Share', 'Export', 'Cash Flow', 'Deleveraging', 'Capex']);

export function scoreBullish(text: string): BullishScore {
  const t = text || '';
  if (t.length < 40) {
    return {
      score: 0, raw_score: 0,
      sentiment: 'INSUFFICIENT',
      confidence: 'LOW',
      tags: [], bullish_phrases: [], red_flags: [],
      critical_blocker: false,
      components: { management_confidence: 0, business_evidence: 0, blockers: 0 },
    };
  }

  let raw = 0;
  const tags: string[] = [];
  const phrases: string[] = [];
  let mgmtConfidence = 0;
  let businessEvidence = 0;

  // Bullish combos — anchor + support must both match
  for (const combo of BULLISH_COMBOS) {
    const anchorHit = combo.anchors.some(re => re.test(t));
    const supportHit = combo.supports.some(re => re.test(t));
    if (!anchorHit || !supportHit) continue;
    let pts = combo.weight;
    if (combo.qualifiers && combo.qualifiers.some(re => re.test(t))) pts += 1;
    raw += pts;
    tags.push(combo.tag);
    phrases.push(combo.reason);
    if (MGMT_CONFIDENCE_TAGS.has(combo.tag)) mgmtConfidence += pts;
    if (BUSINESS_EVIDENCE_TAGS.has(combo.tag)) businessEvidence += pts;
  }

  // Negative blockers
  const redFlags: string[] = [];
  let blockerWeight = 0;
  let criticalBlocker = false;
  for (const b of NEG_BLOCKERS) {
    if (b.re.test(t)) {
      raw -= b.weight;
      blockerWeight += b.weight;
      redFlags.push(b.tag);
      if (b.critical) criticalBlocker = true;
    }
  }

  // Normalize to 0-10
  const score = Math.max(0, Math.min(10, raw / 2));

  // Sentiment classification
  let sentiment: BullishScore['sentiment'];
  if (raw < -2) sentiment = 'BEARISH';
  else if (criticalBlocker && raw < 6) sentiment = 'NEUTRAL';
  else if (mgmtConfidence >= 2.5 && businessEvidence >= 2 && !criticalBlocker) sentiment = 'BULLISH';
  else if (raw >= 4) sentiment = 'BULLISH';
  else sentiment = 'NEUTRAL';

  // Confidence
  let confidence: BullishScore['confidence'];
  if (mgmtConfidence >= 4 && businessEvidence >= 4 && !criticalBlocker) confidence = 'HIGH';
  else if (mgmtConfidence >= 2 && businessEvidence >= 2) confidence = 'MEDIUM';
  else confidence = 'LOW';

  return {
    score: Math.round(score * 10) / 10,
    raw_score: Math.round(raw * 10) / 10,
    sentiment, confidence,
    tags: Array.from(new Set(tags)),
    bullish_phrases: Array.from(new Set(phrases)),
    red_flags: Array.from(new Set(redFlags)),
    critical_blocker: criticalBlocker,
    components: {
      management_confidence: Math.round(mgmtConfidence * 10) / 10,
      business_evidence: Math.round(businessEvidence * 10) / 10,
      blockers: Math.round(blockerWeight * 10) / 10,
    },
  };
}

// ─── Helper: "high bullish" gate per blueprint ─────────────────────────────
// Per spec: ≥1 management confidence phrase + ≥1 business evidence phrase +
// no critical negative blocker + score >= threshold.

export function isHighBullish(s: BullishScore, threshold = 6): boolean {
  return (
    s.sentiment === 'BULLISH' &&
    s.components.management_confidence > 0 &&
    s.components.business_evidence > 0 &&
    !s.critical_blocker &&
    s.score >= threshold / 2  // raw 6 → normalized 3 on the 0-10 scale; but we want >= 6 raw normalized... use raw_score for true 6
  );
}

// Stricter version that operates on raw score so users can configure threshold 6 = raw 6 directly
export function isHighBullishRaw(s: BullishScore, rawThreshold = 6): boolean {
  return (
    s.sentiment === 'BULLISH' &&
    s.components.management_confidence > 0 &&
    s.components.business_evidence > 0 &&
    !s.critical_blocker &&
    s.raw_score >= rawThreshold
  );
}
