// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0424 — Economic Translation Layer
//
// Institutional review item 4.1 (highest ROI):
//   "Convert every tag into Revenue sensitivity, Margin sensitivity,
//    Cycle sensitivity"
//
// Without this layer the engine produced categorized summaries
// ('Order Book +', 'Margin -', 'Capacity +') but no aggregate read on
// whether the filing implies REVENUE UP / DOWN / NEUTRAL or MARGIN
// EXPANSION / COMPRESSION / NEUTRAL or HIGH / MED / LOW cycle exposure.
// That's the missing transformation from "transcript language" to
// "earnings-impact probabilities".
//
// Architecture:
//   1. TAG_SENSITIVITIES — static mapping from concall tags + warrant
//      details + bottleneck components to {revenue, margin, cycle}
//      sensitivity vectors.
//   2. NOISE_PATTERNS — phrases that look like signal but carry no
//      directional information (review item 4.2 — de-noising filter).
//   3. timeWeightStatement() — apply FY-recency decay (review item 4.3).
//   4. predictEarningsDelta() — aggregate per-filing components +
//      sensitivities into a directional read (review item 4.4).
//
// Output of predictEarningsDelta is consumed by:
//   - live-feed scoring pipeline (annotates each filing payload)
//   - cross-company theme aggregator (filter clusters by direction)
//   - UI card (renders 2-axis Narrative-vs-Financial scoreboard)
// ═══════════════════════════════════════════════════════════════════════════

export type Direction = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type Magnitude = 'HIGH' | 'MEDIUM' | 'LOW';
export type CycleRisk = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TagSensitivity {
  revenue: number;           // -3 .. +3 effect on revenue trajectory
  margin: number;            // -3 .. +3 effect on margin trajectory
  cycle: number;             // 0 .. 3 — how cyclical / earnings-volatility-inducing
  note?: string;             // human-readable rationale
}

// ─── Tag → Economic Sensitivity Matrix ─────────────────────────────────────
// Each concall tag mapped to its INSTITUTIONAL economic translation.
// Numbers are unit-less weights; signed so positive raises revenue/margin,
// negative depresses. Cycle is unsigned magnitude (high cycle = higher
// earnings volatility regardless of direction).
//
// Direction conventions:
//   revenue >0 = top-line up        margin >0 = profitability up
//   revenue <0 = top-line down      margin <0 = profitability down
//   cycle is always ≥0 — 0 = secular, 3 = pure cycle (sugar, shipping)
export const TAG_SENSITIVITIES: Record<string, TagSensitivity> = {
  // ── Demand signals
  'Demand':              { revenue: +2, margin:  0, cycle: 1, note: 'Top-line driver' },
  'Order Book':          { revenue: +3, margin: +1, cycle: 1, note: 'Forward revenue visibility' },
  'Order book':          { revenue: +3, margin: +1, cycle: 1, note: 'Forward revenue visibility' },
  'Export':              { revenue: +2, margin: +1, cycle: 2, note: 'Geographic diversification + FX exposure' },
  'Premiumization':      { revenue: +1, margin: +2, cycle: 0, note: 'Mix-shift to higher margin SKUs' },
  'Market Share':        { revenue: +2, margin: 0,  cycle: 1, note: 'Volume share gains' },
  'Market share gain':   { revenue: +2, margin: 0,  cycle: 1, note: 'Volume share gains' },

  // ── Margin signals
  'Margin':              { revenue: 0,  margin: +2, cycle: 1, note: 'Direct margin tailwind' },
  'Margin expansion':    { revenue: 0,  margin: +3, cycle: 1, note: 'Confirmed margin expansion' },
  'Cash Flow':           { revenue: 0,  margin: +2, cycle: 1, note: 'Quality of earnings improvement' },
  'Deleveraging':        { revenue: 0,  margin: +1, cycle: 1, note: 'Reduced interest cost → margin' },

  // ── Capacity / Capex
  'Capacity':            { revenue: +2, margin: -1, cycle: 1, note: 'Future revenue but short-term ROCE dilution' },
  'Capex':               { revenue: +1, margin: -1, cycle: 1, note: 'Future revenue but short-term ROCE dilution' },
  'Capacity expansion':  { revenue: +2, margin: -1, cycle: 1, note: 'Future revenue but short-term ROCE dilution' },

  // ── Guidance / forward signals
  'Guidance':            { revenue: +1, margin: +1, cycle: 1, note: 'Management forward signal' },
  'BOTTLENECK':          { revenue: +2, margin: +2, cycle: 1, note: 'Sympathy beneficiary if upstream constrained' },

  // ── Regulatory / Pipeline (pharma)
  'ANDA / DMF':          { revenue: +2, margin: +1, cycle: 0, note: 'Pharma pipeline → regulated-market revenue' },
  'USFDA':               { revenue: +1, margin: +1, cycle: 0, note: 'US regulatory milestone' },

  // ── Sectoral
  'AI':                  { revenue: +1, margin: +1, cycle: 0, note: 'Cost leverage / new revenue line' },
  'Data center / AI compute': { revenue: +2, margin: +1, cycle: 0, note: 'Hyperscaler capex tailwind' },
  'Renewable / Solar':   { revenue: +2, margin: 0,  cycle: 2, note: 'Policy + capex driven' },
  'Semiconductor':       { revenue: +2, margin: +1, cycle: 2, note: 'Cyclical demand' },
  'EV / Electric Vehicle': { revenue: +2, margin: 0, cycle: 2, note: 'Structural shift' },
  'NIM (banks)':         { revenue: +1, margin: +2, cycle: 1, note: 'Rate-cycle dependent' },

  // ── Risks (NEGATIVE polarity)
  'Slowdown':            { revenue: -2, margin: -1, cycle: 2, note: 'Demand deceleration' },
  'Delay':               { revenue: -1, margin: -1, cycle: 1, note: 'Execution slip / revenue push-out' },
  'Cancellation':        { revenue: -2, margin: -1, cycle: 1, note: 'Lost order' },
  'One-off gain':        { revenue: 0,  margin: -1, cycle: 0, note: 'Non-recurring; base inflation' },
  'Pricing pressure':    { revenue: 0,  margin: -2, cycle: 1, note: 'Margin compression risk' },
  'GNPA / slippage':     { revenue: -1, margin: -2, cycle: 2, note: 'Bank credit deterioration' },
  'Lower utilization':   { revenue: -1, margin: -2, cycle: 1, note: 'Operating deleverage' },
  'Near-term headwind':  { revenue: -1, margin: -1, cycle: 1, note: 'Acknowledged near-term softness' },
  'Cautious outlook':    { revenue: -1, margin: -1, cycle: 1, note: 'Management hedging guidance' },

  // ── Macro signals (high noise — see NOISE_PATTERNS below)
  'Tariff / Duty':       { revenue: 0,  margin: -1, cycle: 1, note: 'Mostly margin pressure unless export player' },
  'China':               { revenue: 0,  margin: 0,  cycle: 1, note: 'Context only' },
};

// ─── Noise filter — review item 4.2 ────────────────────────────────────────
// Phrases that appear in ~80% of transcripts and carry zero directional
// information. The bullish/bearish scorer should down-weight or skip
// evidence sentences that match ONLY these patterns. They become signal
// only when paired with a directional verb in the same sentence.
export const NOISE_PATTERNS: RegExp[] = [
  /\bsupply[\s-]chain\s+disruption\b/i,
  /\bgeopolitical\s+(?:uncertainty|tension|environment)/i,
  /\bmiddle[\s-]east\s+(?:crisis|conflict|tension)/i,
  /\bmacro[\s-]?(?:economic\s+)?(?:headwind|uncertainty|environment)/i,
  /\bevolving\s+(?:regulatory|environment|landscape)/i,
  /\bglobal\s+(?:headwind|uncertainty|environment)/i,
  /\bchallenging\s+(?:environment|macro|backdrop)/i,
  /\bunpredictable\s+(?:environment|times|conditions)/i,
  /\bcautiously\s+(?:optimistic|confident)/i,        // hedged guidance noise
  /\b(?:russia[\s-]?ukraine|red\s+sea)\s+(?:war|crisis|conflict|disruption)/i,
  /\b(?:strait\s+of\s+hormuz|suez)\s+(?:closure|disruption)/i,
  /\bcrude\s+oil\s+price\s+(?:rise|volatility)\b/i,  // generic when not company-specific
];

/**
 * Returns true if the sentence is dominated by noise phrases (no
 * directional verb in proximity). Caller should drop or down-weight
 * such sentences from scoring + evidence display.
 */
export function isNoiseDominated(sentence: string): boolean {
  const noiseHits = NOISE_PATTERNS.filter(re => re.test(sentence)).length;
  if (noiseHits === 0) return false;
  // Does the sentence have a directional verb / quantifier that lifts it
  // from noise to signal?
  const hasDirection = /\b(?:grew|grew\s+by|grew\s+\d|increased|up\s+\d|down\s+\d|decreased|declined|expanded|compressed|improved\s+to|recovered\s+to|fell\s+by|gained|lost|outpaced|missed|beat|guidance\s+of|target\s+of|expect(?:ed)?\s+to|will\s+grow)\b/i.test(sentence);
  return !hasDirection;
}

// ─── Time-weighted scoring helper — review item 4.3 ────────────────────────
// Concall statements often reference different fiscal years. A "FY28
// capacity coming online" carries less near-term earnings impact than
// "Q4 FY26 results". Apply a recency decay so long-range narrative
// doesn't dominate near-term reality.
//
// Decay schedule:
//   Q4 FY26 / FY26 actuals               → 1.00
//   FY27 / next year                     → 0.60
//   FY28 / FY29 / 'multi-year'           → 0.30
//   FY30+ / 'long term' / 'five years'   → 0.15
//
// Caller passes the current fiscal-year baseline (default FY26) and the
// statement text; helper returns a weight 0.15-1.00.

export function timeWeightStatement(statement: string, currentFY: number = 26): number {
  const lower = statement.toLowerCase();

  // Direct FY references
  const fyMatch = lower.match(/\bfy[\s-]?(\d{2,4})\b/);
  if (fyMatch) {
    let fy = parseInt(fyMatch[1], 10);
    if (fy >= 100) fy = fy % 100;       // FY2026 → 26
    const delta = fy - currentFY;
    if (delta <= 0) return 1.00;
    if (delta === 1) return 0.60;
    if (delta === 2) return 0.30;
    if (delta >= 3) return 0.15;
  }

  // Qualitative time markers
  if (/\b(?:long[\s-]?term|five[\s-]?year|5[\s-]?year|next\s+decade)/i.test(statement)) return 0.20;
  if (/\b(?:medium[\s-]?term|mid[\s-]?term|3[\s-]?year|three[\s-]?year)/i.test(statement)) return 0.40;
  if (/\b(?:next\s+year|coming\s+year|FY?27|fiscal\s+2027)/i.test(statement)) return 0.60;
  if (/\b(?:quarter|this\s+year|current\s+year|near[\s-]?term)/i.test(statement)) return 1.00;

  // Default — no temporal anchor → assume mid-term
  return 0.75;
}

// ─── Earnings Delta Predictor — review item 4.4 ────────────────────────────
// Per-filing aggregate: which way does this filing move our earnings
// expectations? Combines positive tags + risk tags + cycle exposure into
// a directional read.

export interface EarningsDelta {
  revenue_direction: Direction;
  revenue_magnitude: Magnitude;
  margin_direction: Direction;
  margin_magnitude: Magnitude;
  cycle_risk: CycleRisk;
  narrative_strength: number;       // 0-10 — story quality
  financial_strength: number;       // 0-10 — actual margin/cash/growth math
  net_read: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL';
  rationale: string;                // one-line institutional summary
  scores: {
    revenue_score: number;          // signed sum
    margin_score: number;           // signed sum
    cycle_score: number;            // unsigned
  };
}

export interface DeltaInputs {
  positive_tags: string[];          // tag names that fired bullish
  negative_tags: string[];          // tag names that fired bearish
  has_numeric_anchor: boolean;      // ≥ 1 financial number in body
  has_concrete_guidance: boolean;   // explicit forward guidance number
  narrative_score_raw: number;      // 0-10 from concall-bullish scorer
  composite_score: number;          // 0-10 final composite
  bottleneck_detected: boolean;
  bottleneck_critical: boolean;
}

export function predictEarningsDelta(inputs: DeltaInputs): EarningsDelta {
  let revenue_score = 0;
  let margin_score = 0;
  let cycle_score = 0;

  for (const tag of inputs.positive_tags) {
    const s = TAG_SENSITIVITIES[tag];
    if (!s) continue;
    revenue_score += s.revenue;
    margin_score  += s.margin;
    cycle_score   += s.cycle;
  }
  for (const tag of inputs.negative_tags) {
    const s = TAG_SENSITIVITIES[tag];
    if (!s) continue;
    // Risk tags already encode negative polarity in the table; don't double-flip
    revenue_score += s.revenue;
    margin_score  += s.margin;
    cycle_score   += s.cycle;
  }

  // Bottleneck adds upstream-tightening bias (good for sympathy plays)
  if (inputs.bottleneck_detected) {
    revenue_score += inputs.bottleneck_critical ? 2 : 1;
    margin_score  += inputs.bottleneck_critical ? 2 : 1;
  }

  // Discretize direction with conservative thresholds
  const revenue_direction: Direction = revenue_score >= 2 ? 'POSITIVE'
                                     : revenue_score <= -2 ? 'NEGATIVE'
                                     : 'NEUTRAL';
  const margin_direction:  Direction = margin_score  >= 2 ? 'POSITIVE'
                                     : margin_score  <= -2 ? 'NEGATIVE'
                                     : 'NEUTRAL';
  const revenue_magnitude: Magnitude = Math.abs(revenue_score) >= 5 ? 'HIGH'
                                     : Math.abs(revenue_score) >= 3 ? 'MEDIUM' : 'LOW';
  const margin_magnitude:  Magnitude = Math.abs(margin_score)  >= 5 ? 'HIGH'
                                     : Math.abs(margin_score)  >= 3 ? 'MEDIUM' : 'LOW';
  const cycle_risk: CycleRisk = cycle_score >= 6 ? 'HIGH' : cycle_score >= 3 ? 'MEDIUM' : 'LOW';

  // Narrative vs Financial split — review item 4.5.
  // Narrative = story quality (tag count, forward language, bullish raw)
  // Financial = actual numbers (numeric anchor + concrete guidance + composite)
  const tag_density = Math.min(1, (inputs.positive_tags.length + inputs.negative_tags.length) / 6);
  const narrative_strength = Math.min(10,
    inputs.narrative_score_raw * 0.6 +           // base from text scoring
    tag_density * 3 +                            // story breadth
    (inputs.positive_tags.length > 4 ? 1 : 0)    // many positive themes
  );
  const financial_strength = Math.min(10,
    inputs.composite_score * 0.8 +
    (inputs.has_numeric_anchor ? 1.5 : 0) +
    (inputs.has_concrete_guidance ? 1.5 : 0)
  );

  // Net read combines the two
  let net_read: EarningsDelta['net_read'];
  if (revenue_direction === 'POSITIVE' && margin_direction === 'POSITIVE') net_read = 'BULLISH';
  else if (revenue_direction === 'NEGATIVE' && margin_direction === 'NEGATIVE') net_read = 'BEARISH';
  else if (revenue_direction === 'NEUTRAL' && margin_direction === 'NEUTRAL') net_read = 'NEUTRAL';
  else net_read = 'MIXED';

  const rationale = buildRationale({
    revenue_direction, revenue_magnitude, margin_direction, margin_magnitude,
    cycle_risk, narrative_strength, financial_strength,
  });

  return {
    revenue_direction,
    revenue_magnitude,
    margin_direction,
    margin_magnitude,
    cycle_risk,
    narrative_strength: Math.round(narrative_strength * 10) / 10,
    financial_strength: Math.round(financial_strength * 10) / 10,
    net_read,
    rationale,
    scores: {
      revenue_score: Math.round(revenue_score * 10) / 10,
      margin_score:  Math.round(margin_score  * 10) / 10,
      cycle_score:   Math.round(cycle_score   * 10) / 10,
    },
  };
}

function buildRationale(d: {
  revenue_direction: Direction; revenue_magnitude: Magnitude;
  margin_direction: Direction;  margin_magnitude: Magnitude;
  cycle_risk: CycleRisk;
  narrative_strength: number; financial_strength: number;
}): string {
  const revDir = d.revenue_direction === 'POSITIVE' ? '↑' : d.revenue_direction === 'NEGATIVE' ? '↓' : '→';
  const mgnDir = d.margin_direction  === 'POSITIVE' ? '↑' : d.margin_direction  === 'NEGATIVE' ? '↓' : '→';
  const split = Math.abs(d.narrative_strength - d.financial_strength);
  let splitNote = '';
  if (split >= 3) {
    splitNote = d.narrative_strength > d.financial_strength
      ? ` · story-ahead-of-numbers (N${d.narrative_strength.toFixed(0)}/F${d.financial_strength.toFixed(0)})`
      : ` · numbers-ahead-of-story (F${d.financial_strength.toFixed(0)}/N${d.narrative_strength.toFixed(0)})`;
  }
  return `Revenue ${revDir} ${d.revenue_magnitude.toLowerCase()} · Margin ${mgnDir} ${d.margin_magnitude.toLowerCase()} · Cycle ${d.cycle_risk.toLowerCase()}${splitNote}`;
}
