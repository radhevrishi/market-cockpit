// ─────────────────────────────────────────────────────────────────────────────
// Deterministic scoring engine
// ─────────────────────────────────────────────────────────────────────────────
// Reaction Score:    weighted surprises + guidance + tone + theme — with
//                    DYNAMIC WEIGHT RENORMALIZATION when components are missing
//                    (no fake-neutral 50 placeholders).
// Accounting Quality: thresholded indicators with explicit flags + denominator
//                    sanity guards (no absurd ratios when EBITDA tiny/negative).
// Narrative Score:   from theme exposure with premium multipliers.
// JAT Score:         forward-looking signals (revisions, margin trajectory).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  EarningsSnapshot,
  MgmtTone,
  ThemeExposure,
  Direction,
} from './snapshot';
import { narrativeScoreFromThemes } from './themes';

// ── Helpers ──────────────────────────────────────────────────────────────
function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function letter(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  if (score >= 55) return 'C';
  if (score >= 50) return 'C-';
  if (score >= 45) return 'D+';
  if (score >= 40) return 'D';
  return 'F';
}

function surprisePctScore(pct: number): number {
  return clamp(50 + pct * 5, 0, 100);
}
function surpriseBpsScore(bps: number): number {
  return clamp(50 + bps / 4, 0, 100);
}
function toneScore(tone: MgmtTone): number {
  switch (tone) {
    case 'very_bullish': return 90;
    case 'constructive': return 75;
    case 'neutral': return 50;
    case 'cautious': return 35;
    case 'defensive': return 20;
    case 'distressed': return 5;
  }
}
function guidanceScore(direction: 'raised' | 'maintained' | 'lowered' | 'introduced' | 'na'): number | null {
  switch (direction) {
    case 'raised': return 85;
    case 'introduced': return 70;
    case 'maintained': return 55;
    case 'lowered': return 25;
    case 'na': return null; // explicitly missing → drop from weighted average
  }
}

// ── Reaction Score with weight renormalization ───────────────────────────
export interface ReactionBreakdownEntry {
  score: number | null;
  weight: number;
  reason?: string;
}

export function computeReactionScore(snap: Pick<EarningsSnapshot, 'metrics' | 'qualitative' | 'guidance'>): {
  score: number;
  grade: string;
  confidence: number;
  breakdown: Record<string, ReactionBreakdownEntry>;
  unavailableReason: string | null;
} {
  const m = snap.metrics;
  const guidanceScoreVal = guidanceScore(snap.guidance.direction);

  const breakdown: Record<string, ReactionBreakdownEntry> = {
    revenue_surprise: m.revenue.surprisePct !== null
      ? { score: surprisePctScore(m.revenue.surprisePct), weight: 0.25 }
      : { score: null, weight: 0.25, reason: 'Revenue consensus unavailable' },
    eps_surprise: m.eps.surprisePct !== null
      ? { score: surprisePctScore(m.eps.surprisePct), weight: 0.25 }
      : { score: null, weight: 0.25, reason: 'EPS consensus unavailable' },
    ebitda_margin_surprise: m.ebitdaMargin.surpriseBps !== null
      ? { score: surpriseBpsScore(m.ebitdaMargin.surpriseBps), weight: 0.15 }
      : { score: null, weight: 0.15, reason: 'EBITDA margin consensus unavailable' },
    guidance: guidanceScoreVal !== null
      ? { score: guidanceScoreVal, weight: 0.20 }
      : { score: null, weight: 0.20, reason: 'No explicit guidance signal' },
    mgmt_tone: snap.qualitative.toneConfidence >= 30
      ? { score: toneScore(snap.qualitative.mgmtTone), weight: 0.10 }
      : { score: null, weight: 0.10, reason: 'No filing prose for tone classification' },
    narrative: { score: narrativeScoreFromThemes(snap.qualitative.themes), weight: 0.05 },
  };

  // ── Renormalize: drop missing components, redistribute their weight ───
  const present = Object.values(breakdown).filter((b) => b.score !== null);
  const totalPresentWeight = present.reduce((s, b) => s + b.weight, 0);

  if (present.length === 0 || totalPresentWeight === 0) {
    return {
      score: 50,
      grade: letter(50),
      confidence: 0,
      breakdown,
      unavailableReason: 'No reaction inputs available — cannot score',
    };
  }

  const weighted = present.reduce((s, b) => s + (b.score! * b.weight), 0);
  const score = clamp(Math.round(weighted / totalPresentWeight));

  // Confidence proportional to coverage
  const totalDeclaredWeight = Object.values(breakdown).reduce((s, b) => s + b.weight, 0);
  const coverage = totalPresentWeight / totalDeclaredWeight;
  const confidence = Math.round(Math.min(95, 30 + coverage * 65));

  return {
    score,
    grade: letter(score),
    confidence,
    breakdown,
    unavailableReason: present.length < 3 ? `Limited inputs: ${present.length} of ${Object.keys(breakdown).length} components` : null,
  };
}

// ── Accounting Quality with denominator sanity guards ────────────────────
export function computeAccountingQuality(opts: {
  cfoOverPat: number | null;
  arGrowthVsRevenuePct: number | null;
  inventoryGrowthVsRevenuePct: number | null;
  sbcIntensity: number | null;
  debtToEbitda: number | null;        // already gated upstream
  ebitda: number | null;              // raw EBITDA for sanity
  revenue: number | null;             // raw revenue for ratio sanity
  fcfMargin: number | null;
  grossMarginStability: number | null;
}): { score: number; grade: string; confidence: number; flags: string[] } {
  const flags: string[] = [];
  let score = 100;
  let inputs = 0;

  if (opts.cfoOverPat !== null) {
    inputs++;
    if (opts.cfoOverPat < 0) { score -= 30; flags.push(`CFO/PAT negative (${opts.cfoOverPat.toFixed(2)}) — earnings not converting to cash`); }
    else if (opts.cfoOverPat < 0.5) { score -= 20; flags.push(`CFO/PAT low (${opts.cfoOverPat.toFixed(2)}) — weak cash conversion`); }
    else if (opts.cfoOverPat < 0.85) { score -= 10; flags.push(`CFO/PAT below 0.85 (${opts.cfoOverPat.toFixed(2)})`); }
  } else { score -= 5; }

  if (opts.arGrowthVsRevenuePct !== null) {
    inputs++;
    if (opts.arGrowthVsRevenuePct > 25) { score -= 20; flags.push(`Receivables growing ${opts.arGrowthVsRevenuePct.toFixed(0)}pp faster than revenue — collection risk`); }
    else if (opts.arGrowthVsRevenuePct > 10) { score -= 10; flags.push(`Receivables outpacing revenue by ${opts.arGrowthVsRevenuePct.toFixed(0)}pp`); }
  }

  if (opts.inventoryGrowthVsRevenuePct !== null) {
    inputs++;
    if (opts.inventoryGrowthVsRevenuePct > 30) { score -= 15; flags.push(`Inventory build of ${opts.inventoryGrowthVsRevenuePct.toFixed(0)}pp above revenue — demand softness or write-down risk`); }
    else if (opts.inventoryGrowthVsRevenuePct > 15) { score -= 7; flags.push(`Inventory rising faster than revenue`); }
  }

  if (opts.sbcIntensity !== null) {
    inputs++;
    if (opts.sbcIntensity > 0.20) { score -= 20; flags.push(`SBC intensity ${(opts.sbcIntensity * 100).toFixed(1)}% — extreme dilution`); }
    else if (opts.sbcIntensity > 0.10) { score -= 10; flags.push(`SBC intensity ${(opts.sbcIntensity * 100).toFixed(1)}% — elevated`); }
  }

  // ── Debt/EBITDA with sanity gate ───────────────────────────────────────
  // Only score this when EBITDA is meaningful: ≥3% of revenue OR ≥$5M absolute.
  // Tiny or negative EBITDA produces absurd ratios that mean nothing.
  const ebitdaIsMeaningful =
    opts.ebitda !== null && opts.revenue !== null && opts.revenue > 0
      ? Math.abs(opts.ebitda) >= 5_000_000 || Math.abs(opts.ebitda / opts.revenue) >= 0.03
      : opts.ebitda !== null && Math.abs(opts.ebitda) >= 5_000_000;

  if (opts.debtToEbitda !== null && ebitdaIsMeaningful) {
    inputs++;
    if (opts.debtToEbitda > 5) { score -= 15; flags.push(`Net Debt/EBITDA ${opts.debtToEbitda.toFixed(1)}x — over-levered`); }
    else if (opts.debtToEbitda > 3) { score -= 7; flags.push(`Net Debt/EBITDA ${opts.debtToEbitda.toFixed(1)}x — stretched`); }
    else if (opts.debtToEbitda < 0) { score += 5; }
  } else if (opts.debtToEbitda !== null && !ebitdaIsMeaningful) {
    flags.push('Net Debt/EBITDA not scored: EBITDA too small for meaningful ratio');
  }

  if (opts.fcfMargin !== null) {
    inputs++;
    if (opts.fcfMargin < -0.10) { score -= 15; flags.push(`FCF margin ${(opts.fcfMargin * 100).toFixed(1)}% — cash burn`); }
    else if (opts.fcfMargin < 0) { score -= 8; flags.push(`Negative FCF margin`); }
    else if (opts.fcfMargin > 0.20) { score += 8; }
    else if (opts.fcfMargin > 0.10) { score += 4; }
  }

  if (opts.grossMarginStability !== null && opts.grossMarginStability > 5) {
    inputs++;
    score -= 10;
    flags.push(`Gross margin volatile (σ ${opts.grossMarginStability.toFixed(1)}pp over 4Q)`);
  }

  score = clamp(score);
  // Confidence based on # of inputs — at minimum 20, at most 95
  const confidence = clamp(20 + inputs * 12, 20, 95);
  return { score, grade: letter(score), confidence, flags };
}

// ── JAT Score (Just-Ahead Trajectory) ────────────────────────────────────
export interface JatSignal {
  name: string;
  direction: Direction;
  weight: number;
}

export function computeJatScore(signals: JatSignal[]): {
  score: number;
  grade: string;
  direction: Direction;
  confidence: 'low' | 'medium' | 'high';
  signals: JatSignal[];
  unavailableReason: string | null;
} {
  if (signals.length === 0) {
    return {
      score: 50,
      grade: letter(50),
      direction: 'stable',
      confidence: 'low',
      signals,
      unavailableReason: 'No forward signals available (no estimate revisions, no margin history, no rating actions)',
    };
  }
  const dirVal: Record<Direction, number> = { improving: 100, stable: 50, deteriorating: 0 };
  const totalWeight = signals.reduce((s, sg) => s + sg.weight, 0);
  if (totalWeight === 0) {
    return {
      score: 50,
      grade: letter(50),
      direction: 'stable',
      confidence: 'low',
      signals,
      unavailableReason: 'All forward signals had zero weight',
    };
  }
  const weighted = signals.reduce((s, sg) => s + dirVal[sg.direction] * sg.weight, 0);
  const score = clamp(Math.round(weighted / totalWeight));
  const direction: Direction = score >= 60 ? 'improving' : score <= 40 ? 'deteriorating' : 'stable';
  const confidence: 'low' | 'medium' | 'high' =
    signals.length >= 5 ? 'high' : signals.length >= 3 ? 'medium' : 'low';
  return { score, grade: letter(score), direction, confidence, signals, unavailableReason: null };
}

// ── Reaction probability (deterministic, from reaction score + confidence) ─
export function computeReactionProbability(reactionScore: number, reactionConfidence: number): {
  expected: '+10%' | '+5%' | 'flat' | '-5%' | '-10%';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
} {
  let expected: '+10%' | '+5%' | 'flat' | '-5%' | '-10%';
  let summary: string;
  // If reaction confidence is low (insufficient inputs), force flat regardless of score
  if (reactionConfidence < 35) {
    return {
      expected: 'flat',
      confidence: 'low',
      summary: 'Insufficient inputs to project reaction direction with confidence',
    };
  }
  if (reactionScore >= 80) {
    expected = '+10%';
    summary = 'Strong positive setup — beat-and-raise narrative likely to drive significant rally';
  } else if (reactionScore >= 65) {
    expected = '+5%';
    summary = 'Positive setup — modest beat with constructive guidance, expect outperformance';
  } else if (reactionScore >= 45) {
    expected = 'flat';
    summary = 'Mixed setup — limited surprise magnitude, reaction muted';
  } else if (reactionScore >= 30) {
    expected = '-5%';
    summary = 'Negative setup — miss or weak guidance, expect underperformance';
  } else {
    expected = '-10%';
    summary = 'Severely negative setup — material miss with negative forward indicators';
  }
  const confidence: 'low' | 'medium' | 'high' =
    reactionConfidence >= 75 ? 'high' : reactionConfidence >= 50 ? 'medium' : 'low';
  return { expected, confidence, summary };
}

// ── Narrative score wrapper ──────────────────────────────────────────────
export function computeNarrativeScore(themes: ThemeExposure[], confidence: number): { score: number; grade: string; themes: string[]; confidence: number } {
  const score = narrativeScoreFromThemes(themes);
  return {
    score,
    grade: letter(score),
    themes: themes.map((t) => `${t.theme} (${t.strength})`),
    confidence,
  };
}

export const _internal = { letter, clamp, surprisePctScore, surpriseBpsScore, toneScore };
