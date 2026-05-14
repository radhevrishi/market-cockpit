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
// PATCH 0389 — Sentence-level scoring with negation/contradiction detection
// and evidence quotes. Per user feedback: "strong demand last quarter but
// current slowdown expected" must NOT score bullish.

export interface EvidenceSentence {
  text: string;               // truncated to 250 chars
  tag: string;                // which combo it matched
  polarity: 'BULL' | 'BEAR';
  negated: boolean;           // was this overridden by a contradiction connector?
}

export interface BullishScore {
  score: number;                         // 0-10 normalized
  raw_score: number;                     // raw points (post-cap, post-negation)
  sentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'INSUFFICIENT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  tags: string[];                        // matched combo tags
  bullish_phrases: string[];
  red_flags: string[];
  critical_blocker: boolean;
  components: {
    management_confidence: number;
    business_evidence: number;
    blockers: number;
  };
  // PATCH 0389 — evidence sentences extracted from the source text
  evidence: EvidenceSentence[];
}

const MGMT_CONFIDENCE_TAGS = new Set(['Guidance', 'Demand', 'Margin', 'Premiumization']);
const BUSINESS_EVIDENCE_TAGS = new Set(['Order Book', 'Capacity', 'New Customer', 'Market Share', 'Export', 'Cash Flow', 'Deleveraging', 'Capex']);

// Contradiction connectors — when a sentence contains these, the polarity of
// content AFTER the connector is what counts (often a "but X is bad" reversal)
const CONTRADICTION_CONNECTORS = /\b(but|however|yet|though|although|while|despite|notwithstanding|whereas)\b/i;

// Forward-looking softeners that weaken bullish phrases when present
const SOFTENERS = /\b(temporary|transitory|short[- ]term|near[- ]term|cautious|uncertain|may\s+improve|hope\s+to|expect\s+to\s+recover)\b/i;

function splitSentences(text: string): string[] {
  // Split on sentence terminators, keep reasonable length
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 25 && s.length <= 1000);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

export function scoreBullish(text: string): BullishScore {
  const t = text || '';
  if (t.length < 40) {
    return {
      score: 0, raw_score: 0,
      sentiment: 'INSUFFICIENT', confidence: 'LOW',
      tags: [], bullish_phrases: [], red_flags: [],
      critical_blocker: false,
      components: { management_confidence: 0, business_evidence: 0, blockers: 0 },
      evidence: [],
    };
  }

  let raw = 0;
  const tagSet = new Set<string>();
  const phraseSet = new Set<string>();
  const evidence: EvidenceSentence[] = [];
  let mgmtConfidence = 0;
  let businessEvidence = 0;

  // PATCH 0389 — sentence-level scan
  const sentences = splitSentences(t);
  const useSentences = sentences.length >= 3;

  if (useSentences) {
    // Score each sentence independently. Track which combos fire per sentence
    // so we can pull representative evidence quotes.
    for (const sent of sentences) {
      const hasContradiction = CONTRADICTION_CONNECTORS.test(sent);
      const hasSoftener = SOFTENERS.test(sent);
      // If the sentence contains a contradiction connector, the polarity is
      // determined by the SECOND half (after the connector) per the user's
      // example: "strong demand last quarter BUT current slowdown expected"
      let effectiveText = sent;
      if (hasContradiction) {
        const parts = sent.split(CONTRADICTION_CONNECTORS);
        if (parts.length >= 3) {
          effectiveText = parts.slice(2).join(' ').trim() || sent;
        }
      }

      // Bullish combos — anchor + support must match in effective text
      for (const combo of BULLISH_COMBOS) {
        const anchorHit = combo.anchors.some(re => re.test(effectiveText));
        const supportHit = combo.supports.some(re => re.test(effectiveText));
        if (!anchorHit || !supportHit) continue;
        // Skip if sentence contains a critical blocker — contradiction
        const sentBlocker = NEG_BLOCKERS.find(b => b.critical && b.re.test(sent));
        if (sentBlocker) {
          // Bullish phrase NEGATED — record as bear-flipped evidence
          evidence.push({
            text: truncate(sent, 250),
            tag: combo.tag,
            polarity: 'BEAR',
            negated: true,
          });
          continue;
        }
        let pts = combo.weight;
        if (combo.qualifiers && combo.qualifiers.some(re => re.test(effectiveText))) pts += 1;
        if (hasSoftener) pts *= 0.5;  // soften vague positivity
        raw += pts;
        tagSet.add(combo.tag);
        phraseSet.add(combo.reason);
        if (MGMT_CONFIDENCE_TAGS.has(combo.tag)) mgmtConfidence += pts;
        if (BUSINESS_EVIDENCE_TAGS.has(combo.tag)) businessEvidence += pts;
        if (evidence.length < 12) {
          evidence.push({
            text: truncate(sent, 250),
            tag: combo.tag,
            polarity: 'BULL',
            negated: false,
          });
        }
      }
    }

    // Negative blockers — sentence-level so we can pull the actual bearish quote
    const blockerEvidence: EvidenceSentence[] = [];
    let blockerWeight = 0;
    let criticalBlocker = false;
    const redFlagSet = new Set<string>();
    for (const sent of sentences) {
      for (const b of NEG_BLOCKERS) {
        if (b.re.test(sent)) {
          raw -= b.weight;
          blockerWeight += b.weight;
          redFlagSet.add(b.tag);
          if (b.critical) criticalBlocker = true;
          if (blockerEvidence.length < 6) {
            blockerEvidence.push({
              text: truncate(sent, 250),
              tag: b.tag,
              polarity: 'BEAR',
              negated: false,
            });
          }
        }
      }
    }
    evidence.push(...blockerEvidence);

    // PATCH 0389 — Score-inflation cap based on blocker presence
    // Per user feedback: 25.0 score with delay+slowdown blockers is nonsense.
    if (criticalBlocker) {
      raw = Math.min(raw, 4);  // cap at low-bullish; blockers dominate
    } else if (redFlagSet.size >= 2) {
      raw = raw * 0.6;  // discount when multiple non-critical blockers
    } else if (redFlagSet.size === 1) {
      raw = raw * 0.85;
    }

    // Diminishing returns — at most one credit per tag (already deduped via tagSet)
    // Now we cap the raw score based on tag diversity
    const tagDiversity = tagSet.size;
    if (tagDiversity <= 1) raw = Math.min(raw, 4);
    else if (tagDiversity === 2) raw = Math.min(raw, 8);
    else raw = Math.min(raw, 14);  // hard cap regardless of keyword density

    const score = Math.max(0, Math.min(10, raw / 1.4));

    let sentiment: BullishScore['sentiment'];
    if (raw < -2) sentiment = 'BEARISH';
    else if (criticalBlocker) sentiment = 'NEUTRAL';
    else if (mgmtConfidence >= 2 && businessEvidence >= 2 && raw >= 4) sentiment = 'BULLISH';
    else if (raw >= 5) sentiment = 'BULLISH';
    else sentiment = 'NEUTRAL';

    let confidence: BullishScore['confidence'];
    if (mgmtConfidence >= 3 && businessEvidence >= 3 && !criticalBlocker && tagDiversity >= 3) confidence = 'HIGH';
    else if (mgmtConfidence >= 1.5 && businessEvidence >= 1.5) confidence = 'MEDIUM';
    else confidence = 'LOW';

    return {
      score: Math.round(score * 10) / 10,
      raw_score: Math.round(raw * 10) / 10,
      sentiment, confidence,
      tags: Array.from(tagSet),
      bullish_phrases: Array.from(phraseSet),
      red_flags: Array.from(redFlagSet),
      critical_blocker: criticalBlocker,
      components: {
        management_confidence: Math.round(mgmtConfidence * 10) / 10,
        business_evidence: Math.round(businessEvidence * 10) / 10,
        blockers: Math.round(blockerWeight * 10) / 10,
      },
      evidence: evidence.slice(0, 12),
    };
  }

  // ─── Short-text fallback (subject-only): preserve original behavior ─────
  for (const combo of BULLISH_COMBOS) {
    const anchorHit = combo.anchors.some(re => re.test(t));
    const supportHit = combo.supports.some(re => re.test(t));
    if (!anchorHit || !supportHit) continue;
    let pts = combo.weight;
    if (combo.qualifiers && combo.qualifiers.some(re => re.test(t))) pts += 1;
    raw += pts;
    tagSet.add(combo.tag);
    phraseSet.add(combo.reason);
    if (MGMT_CONFIDENCE_TAGS.has(combo.tag)) mgmtConfidence += pts;
    if (BUSINESS_EVIDENCE_TAGS.has(combo.tag)) businessEvidence += pts;
  }
  const redFlagSet = new Set<string>();
  let blockerWeight = 0;
  let criticalBlocker = false;
  for (const b of NEG_BLOCKERS) {
    if (b.re.test(t)) {
      raw -= b.weight;
      blockerWeight += b.weight;
      redFlagSet.add(b.tag);
      if (b.critical) criticalBlocker = true;
    }
  }
  if (criticalBlocker) raw = Math.min(raw, 3);
  raw = Math.min(raw, 8);  // hard cap for short text
  const score = Math.max(0, Math.min(10, raw / 1.4));
  let sentiment: BullishScore['sentiment'];
  if (raw < -2) sentiment = 'BEARISH';
  else if (criticalBlocker) sentiment = 'NEUTRAL';
  else if (mgmtConfidence > 0 && businessEvidence > 0 && raw >= 4) sentiment = 'BULLISH';
  else if (raw >= 5) sentiment = 'BULLISH';
  else sentiment = 'NEUTRAL';
  return {
    score: Math.round(score * 10) / 10,
    raw_score: Math.round(raw * 10) / 10,
    sentiment, confidence: 'LOW',
    tags: Array.from(tagSet),
    bullish_phrases: Array.from(phraseSet),
    red_flags: Array.from(redFlagSet),
    critical_blocker: criticalBlocker,
    components: {
      management_confidence: Math.round(mgmtConfidence * 10) / 10,
      business_evidence: Math.round(businessEvidence * 10) / 10,
      blockers: Math.round(blockerWeight * 10) / 10,
    },
    evidence: [],
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
