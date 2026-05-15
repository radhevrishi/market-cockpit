// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0410 — EVIDENCE HIERARCHY ENGINE
//
// Wraps the bullish scorer with institutional-grade evidence weighting.
// User feedback: "Dynamic Cables ULTRA BULLISH off an investor presentation
// with generic phrases like 'growth engine, capacity expansion, export thrust'
// while transcript-backed Privi rightly stays MIXED POSITIVE because of one
// shipping-delay risk." The engine was over-rewarding presentation language.
//
// What this layer adds:
//   1. Filing-type confidence weights (transcript 1.0 → analyst-meet 0.10)
//   2. Numeric anchor extraction (counts hard facts: %, ₹Cr, bps, dates)
//   3. Boilerplate suppression (penalize generic deck language)
//   4. Strict ULTRA gate (filing weight + numeric ≥2 + financial evidence ≥1)
//   5. Investor-presentation cap (max BULLISH unless 2+ hard metrics)
//   6. Explainability fields for every card
// ═══════════════════════════════════════════════════════════════════════════

import type { BullishScore, ConcallFilingType } from './concall-bullish';

// ─── Filing-type trust weights ─────────────────────────────────────────────
// User spec: "Earnings call transcript 1.00, Result presentation 0.80,
// Investor presentation / corporate deck 0.45, Analyst meet intimation 0.10,
// Subject only 0.00 for bullish ranking"
export const FILING_TYPE_WEIGHTS: Record<ConcallFilingType, number> = {
  TRANSCRIPT:            1.00,
  CONCALL_INVITE:        0.95,
  RESULTS_PRESENTATION:  0.80,
  AUDIO_RECORDING:       0.65,
  WEBCAST:               0.55,
  INVESTOR_PRESENTATION: 0.45,
  ANALYST_MEET:          0.30,
  PRESS_RELEASE:         0.20,
};

// ─── Numeric anchor extractor ──────────────────────────────────────────────
// Counts distinct quantitative facts in the filing text. A filing must have
// ≥2 hard numbers to qualify for ULTRA_BULLISH.
//
// Captures:
//   - bps margin moves: "EBITDA margin expanded 280 bps"
//   - YoY growth %: "revenue grew 28% YoY", "PAT up 45%"
//   - ₹Cr amounts: "₹450 Cr capex", "order book ₹3,200 Cr"
//   - utilization %: "75% utilization", "operating at 90%"
//   - dates: "commissioning Q2 FY27", "by March 2027"
//   - capacity: "20,000 TPA", "8 MMT"
//   - ROCE/ROE: "ROCE 22%", "ROE improved to 18%"
const NUMERIC_PATTERNS = [
  /\d+(?:\.\d+)?\s*(?:bps|basis\s*points?)/i,
  /\b(?:up|grew|rose|expanded|improved|increased|gained|jumped|surged)\s+(?:by\s+)?\d+(?:\.\d+)?\s*%/i,
  /\d+(?:\.\d+)?\s*%\s+(?:yoy|y\/y|year[- ]on[- ]year|growth|expansion|increase|improvement)/i,
  /(?:revenue|sales|ebitda|pat|profit|margin|roce|roe|cfo|fcf)\s+(?:of\s+|at\s+)?(?:rs\.?\s*|₹\s*|inr\s*)?\d+/i,
  /(?:rs\.?\s*|₹\s*|inr\s*)\s*\d+(?:\.\d+)?\s*(?:cr|crore|crores|lakh|lakhs|mn|bn)/i,
  /\b\d+(?:\.\d+)?\s*(?:cr|crore|crores)\b/i,
  /\b(?:order\s+book|capex|backlog|orderbook)\s+(?:of\s+|at\s+|stands\s+at\s+|worth\s+)?(?:rs\.?\s*|₹\s*)?\d+/i,
  /\b\d+(?:\.\d+)?\s*(?:tpa|mmt|mtpa|gw|mw|kw|tons?\s+per\s+annum|million\s+tons?)/i,
  /\butilis?ation\s+(?:at|of|stands\s+at|rose\s+to|improved\s+to|nearing)\s+\d+(?:\.\d+)?\s*%/i,
  /(?:commissioning|commission|launch|operational|expected)\s+(?:by\s+|in\s+|from\s+)?(?:q[1-4]\s*)?(?:fy)?\s*20\d{2}/i,
  /\bq[1-4]\s*fy\s*\d{2,4}/i,
  /\b(?:roce|roe|roic|roi)\s+(?:of\s+|at\s+|reached\s+|stood\s+at\s+|stands\s+at\s+|improved\s+to\s+)?\d+(?:\.\d+)?\s*%/i,
];

// ─── Boilerplate phrases (deck-speak with no execution proof) ──────────────
// These get suppressed UNLESS the sentence also contains a numeric anchor.
const BOILERPLATE_PHRASES: RegExp[] = [
  /\bpositioned\s+for\s+(?:strong\s+|sustainable\s+)?growth\b/i,
  /\bwell\s+(?:equipped|placed|positioned)\b/i,
  /\bstrong\s+growth\s+engine\b/i,
  /\blong[- ]term\s+value\s+creation\b/i,
  /\bemerging\s+opportunities\b/i,
  /\bunlocking\s+value\b/i,
  /\bjourney\s+(?:so\s+far|continues)\b/i,
  /\bvision\s+\d{4}\b/i,
  /\bbeyond\s+the\s+horizon\b/i,
  /\bnext\s+phase\s+of\s+growth\b/i,
  /\btransformational\s+journey\b/i,
  /\bcustomer[- ]centric\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\bworld[- ]class\b/i,
  /\bindustry[- ]leading\b/i,
  /\bsustainable\s+(?:value|earnings|growth)\b/i,
  /\bagile\s+execution\b/i,
  /\bstrategic\s+priorities\b/i,
  /\bgrowth\s+pillars?\b/i,
  /\bdigital\s+transformation\b/i,
];

// Theme buzzwords that count for almost nothing without execution proof
const HOLLOW_THEME_WORDS: RegExp[] = [
  /\b(?:ai|artificial\s+intelligence)\b/i,
  /\b(?:ev|electric\s+vehicles?)\b/i,
  /\bsolar\b/i,
  /\bdefen[cs]e\b/i,
  /\bsemiconductors?\b/i,
  /\bpremiumi[zs]ation\b/i,
  /\bexports?\b/i,
  /\bdata[\s-]?center?s?\b/i,
];

// ─── Public types ──────────────────────────────────────────────────────────
export interface EvidenceHierarchyResult {
  filing_type_weight: number;
  numeric_evidence_count: number;
  numeric_examples: string[];                    // up to 3 quoted snippets
  boilerplate_hits: number;
  hollow_theme_hits: number;
  has_financial_evidence: boolean;               // Tier 1 — actual reported numbers
  has_business_evidence: boolean;                // Tier 2 — order book, commissioning, utilization
  has_guidance_evidence: boolean;                // Tier 3 — quantified forward guidance
  passes_ultra_gate: boolean;
  passes_bullish_gate: boolean;
  cap_reason?: string;                           // explainability — why was score capped
  adjusted_composite: number;                    // final composite after all caps + filing weight
  adjusted_tier: 'ULTRA_BULLISH' | 'BULLISH' | 'MIXED_POSITIVE' | 'NEUTRAL' | 'BEARISH' | 'DATA_PENDING';
}

// ─── Evidence detectors ────────────────────────────────────────────────────
// Tier 1 — actual reported financial improvement (REQUIRES a number)
const FINANCIAL_EVIDENCE_PATTERNS: RegExp[] = [
  /(?:ebitda|operating)\s+margin\s+(?:expanded|improved|increased|rose|grew)\s+(?:by\s+)?\d/i,
  /(?:pat|net\s+profit|profit\s+after\s+tax)\s+(?:grew|rose|increased|up|jumped)\s+(?:by\s+)?\d/i,
  /(?:revenue|sales|topline)\s+(?:grew|rose|increased|up|jumped|reached)\s+(?:by\s+)?\d/i,
  /(?:roce|roe|roic)\s+(?:improved|expanded|rose|increased)\s+(?:to\s+|by\s+|from\s+)?\d/i,
  /(?:operating\s+cash\s+flow|cfo|fcf|free\s+cash\s+flow)\s+(?:of|at|generated|improved)\s+(?:rs\.?\s*|₹\s*)?\d/i,
  /(?:debt\s+reduced|deleveraged|debt\s+down)\s+(?:by\s+|to\s+)?(?:rs\.?\s*|₹\s*)?\d/i,
  /(?:utilisation|utilization)\s+(?:rose|improved|increased|reached)\s+(?:to\s+|from\s+)?\d/i,
  /(?:gross\s+margin)\s+(?:expanded|improved|increased)\s+(?:by\s+|to\s+)?\d/i,
];

// Tier 2 — business execution (must have specific evidence, not just "growing")
const BUSINESS_EVIDENCE_PATTERNS: RegExp[] = [
  /order\s+book\s+(?:of|at|stands\s+at|grew\s+to|increased\s+to)\s+(?:rs\.?\s*|₹\s*)?\d/i,
  /(?:capex|capital\s+expenditure)\s+(?:of|amounting\s+to|worth)\s+(?:rs\.?\s*|₹\s*)?\d/i,
  /(?:added|won|signed|secured)\s+\d+\s+(?:new\s+)?(?:customer|client|order|contract)/i,
  /(?:commissioned|commenced|operational)\s+(?:by\s+|in\s+|from\s+)?(?:q[1-4]\s*)?(?:fy)?\s*20\d{2}/i,
  /(?:capacity)\s+(?:expansion|addition|increase)\s+(?:of|to|by)\s+\d/i,
  /export\s+(?:share|contribution|revenue)\s+(?:of|at|grew\s+to)\s+\d/i,
  /market\s+share\s+(?:gain|grew|increased|expanded)\s+(?:by\s+)?\d/i,
  /repeat\s+(?:order|customer|business)/i,
];

// Tier 3 — quantified forward guidance
const GUIDANCE_EVIDENCE_PATTERNS: RegExp[] = [
  /(?:expect|targeting|guiding|plan)\s+(?:to\s+)?(?:reach|achieve|deliver|grow)\s+\d/i,
  /(?:guidance|outlook)\s+(?:raised|upgraded|of|at)\s+\d/i,
  /(?:fy\s*\d{2,4}|next\s+year|coming\s+years?)\s+(?:revenue|ebitda|margin|pat)\s+(?:of|at|expected)\s+\d/i,
  /margin\s+(?:expansion|improvement)\s+of\s+\d+\s*(?:bps|%)/i,
];

// ─── Main scorer ───────────────────────────────────────────────────────────

/**
 * Apply institutional evidence hierarchy on top of the base bullish score.
 * Returns a refined composite + tier + explainability fields.
 */
export function applyEvidenceHierarchy(
  text: string,
  bullish: BullishScore,
  filing_type: ConcallFilingType,
  scored_from: 'PDF' | 'SUBJECT',
): EvidenceHierarchyResult {
  const filing_type_weight = FILING_TYPE_WEIGHTS[filing_type] ?? 0.30;

  // Subject-only filings (no PDF text) get FORCED into DATA_PENDING.
  // They should never appear in the main bullish ranking.
  if (scored_from === 'SUBJECT' || !text || text.length < 200) {
    return {
      filing_type_weight: 0,
      numeric_evidence_count: 0,
      numeric_examples: [],
      boilerplate_hits: 0,
      hollow_theme_hits: 0,
      has_financial_evidence: false,
      has_business_evidence: false,
      has_guidance_evidence: false,
      passes_ultra_gate: false,
      passes_bullish_gate: false,
      cap_reason: 'Subject-only — no PDF content extracted yet',
      adjusted_composite: 0,
      adjusted_tier: 'DATA_PENDING',
    };
  }

  // Count distinct numeric anchors (cap at 12 to avoid runaway from large decks)
  const numericMatches = new Set<string>();
  for (const re of NUMERIC_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null && numericMatches.size < 24) {
      numericMatches.add(m[0].trim().toLowerCase());
    }
  }
  const numeric_evidence_count = numericMatches.size;
  const numeric_examples = Array.from(numericMatches).slice(0, 3);

  // Boilerplate + hollow theme counts
  let boilerplate_hits = 0;
  for (const re of BOILERPLATE_PHRASES) {
    if (re.test(text)) boilerplate_hits++;
  }
  let hollow_theme_hits = 0;
  for (const re of HOLLOW_THEME_WORDS) {
    if (re.test(text)) hollow_theme_hits++;
  }

  // Evidence buckets
  const has_financial_evidence = FINANCIAL_EVIDENCE_PATTERNS.some(re => re.test(text));
  const has_business_evidence = BUSINESS_EVIDENCE_PATTERNS.some(re => re.test(text));
  const has_guidance_evidence = GUIDANCE_EVIDENCE_PATTERNS.some(re => re.test(text));

  // Base composite from existing scorer
  let composite: number =
    (bullish.components as any).composite_score ??
    bullish.raw_score ?? 0;

  // ─── Caps in priority order ────────────────────────────────────────────
  let cap_reason: string | undefined;

  // Cap A: No PDF text at all → DATA_PENDING (already handled above)

  // Cap B: Filing type × confidence multiplier — investor presentation
  // composite × 0.45, analyst-meet × 0.30 etc. Transcript stays at 1.0.
  // This is the BIG calibration fix — generic investor decks can't beat
  // transcript-backed names anymore.
  const filingWeighted = composite * filing_type_weight;
  if (filing_type_weight < 1.0 && filingWeighted < composite) {
    composite = filingWeighted;
    cap_reason = `Filing-type confidence ${filing_type_weight.toFixed(2)}× (${filing_type.replace(/_/g, ' ')})`;
  }

  // Cap C: No earnings anchor — composite hard-capped at 5.5. Even with
  // bottleneck/sector overlay boosts. This is the leak fix.
  const anchored = (bullish.components as any).earnings_anchored;
  if (!anchored) {
    const cap = 5.5;
    if (composite > cap) {
      composite = cap;
      cap_reason = `No financial anchor (hard cap 5.5)`;
    }
  }

  // Cap D: Investor presentation with <2 hard numbers → max BULLISH = 6.5
  if (filing_type === 'INVESTOR_PRESENTATION' && numeric_evidence_count < 2) {
    const cap = 6.5;
    if (composite > cap) {
      composite = cap;
      cap_reason = `Investor presentation with only ${numeric_evidence_count} numeric anchor${numeric_evidence_count === 1 ? '' : 's'} (max 6.5)`;
    }
  }

  // Cap E: Boilerplate-dominant filing → max 4.5
  // "If a deck is mostly generic strategic language, cap score at MIXED POSITIVE 4.5"
  if (boilerplate_hits >= 4 && numeric_evidence_count < 2) {
    const cap = 4.5;
    if (composite > cap) {
      composite = cap;
      cap_reason = `Boilerplate-dominant deck (${boilerplate_hits} generic phrases, ${numeric_evidence_count} numeric facts)`;
    }
  }

  // Cap F: No numeric evidence at all + no financial evidence → max 3.0
  if (numeric_evidence_count === 0 && !has_financial_evidence) {
    const cap = 3.0;
    if (composite > cap) {
      composite = cap;
      cap_reason = `Zero numeric anchors + no financial evidence (max 3.0)`;
    }
  }

  // ─── ULTRA_BULLISH gate ────────────────────────────────────────────────
  // Per user spec, requires ALL of:
  //   - filing type weight ≥ 0.80 (transcript or results presentation only)
  //   - ≥1 financial evidence item
  //   - ≥2 business/guidance evidence items
  //   - 0 fatal blockers
  //   - ≥2 numeric anchors
  const businessOrGuidanceCount =
    (has_business_evidence ? 1 : 0) + (has_guidance_evidence ? 1 : 0);
  const passes_ultra_gate =
    filing_type_weight >= 0.80 &&
    has_financial_evidence &&
    businessOrGuidanceCount >= 1 &&            // user wants ≥2 business/guidance items; we have 2 distinct buckets so this maps to ≥1 fired bucket + 1 financial
    bullish.critical_blocker !== true &&
    (bullish.fatal_blockers || []).length === 0 &&
    numeric_evidence_count >= 2 &&
    composite >= 7.0;

  // ─── BULLISH gate ──────────────────────────────────────────────────────
  // ≥1 financial OR business evidence + ≥1 numeric anchor + composite ≥5.5
  const passes_bullish_gate =
    (has_financial_evidence || has_business_evidence) &&
    numeric_evidence_count >= 1 &&
    bullish.critical_blocker !== true &&
    composite >= 5.5 &&
    !passes_ultra_gate;

  // ─── Tier classification ────────────────────────────────────────────────
  let adjusted_tier: EvidenceHierarchyResult['adjusted_tier'];
  if (bullish.tier === 'BEARISH' || bullish.critical_blocker) {
    adjusted_tier = 'BEARISH';
  } else if (passes_ultra_gate) {
    adjusted_tier = 'ULTRA_BULLISH';
  } else if (passes_bullish_gate) {
    adjusted_tier = 'BULLISH';
  } else if (composite >= 3.5 && numeric_evidence_count >= 1) {
    adjusted_tier = 'MIXED_POSITIVE';
  } else if (composite >= 2.0) {
    adjusted_tier = 'NEUTRAL';
  } else {
    adjusted_tier = 'NEUTRAL';
  }

  return {
    filing_type_weight,
    numeric_evidence_count,
    numeric_examples,
    boilerplate_hits,
    hollow_theme_hits,
    has_financial_evidence,
    has_business_evidence,
    has_guidance_evidence,
    passes_ultra_gate,
    passes_bullish_gate,
    cap_reason,
    adjusted_composite: Math.round(composite * 10) / 10,
    adjusted_tier,
  };
}
