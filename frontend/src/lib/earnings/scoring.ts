// ─────────────────────────────────────────────────────────────────────────────
// Deterministic scoring engine
// ─────────────────────────────────────────────────────────────────────────────
// Reaction Score   = weighted surprises + guidance + tone + theme
// Accounting Quality = composite of CFO/PAT, AR/Inventory growth, SBC, leverage
// Narrative Score  = from theme exposure
// JAT Score        = forward-looking signals (revisions, margin trajectory, etc.)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  EarningsSnapshot,
  MetricLine,
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

// Surprise % → 0-100 component score (linear; ±10% saturates)
function surprisePctScore(pct: number | null): number {
  if (pct === null) return 50;
  return clamp(50 + pct * 5, 0, 100);
}

// Surprise bps → 0-100 (200 bps saturates)
function surpriseBpsScore(bps: number | null): number {
  if (bps === null) return 50;
  return clamp(50 + bps / 4, 0, 100);
}

// Tone → 0-100
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

// Guidance direction → 0-100
function guidanceScore(direction: 'raised' | 'maintained' | 'lowered' | 'introduced' | 'na'): number {
  switch (direction) {
    case 'raised': return 85;
    case 'introduced': return 70;
    case 'maintained': return 55;
    case 'lowered': return 25;
    case 'na': return 50;
  }
}

// ── Reaction Score ───────────────────────────────────────────────────────
export function computeReactionScore(snap: Pick<EarningsSnapshot, 'metrics' | 'qualitative' | 'guidance'>): {
  score: number;
  grade: string;
  breakdown: Record<string, { score: number; weight: number }>;
} {
  const m = snap.metrics;
  const breakdown: Record<string, { score: number; weight: number }> = {
    revenue_surprise: { score: surprisePctScore(m.revenue.surprisePct), weight: 0.25 },
    eps_surprise: { score: surprisePctScore(m.eps.surprisePct), weight: 0.25 },
    ebitda_margin_surprise: { score: surpriseBpsScore(m.ebitdaMargin.surpriseBps), weight: 0.15 },
    guidance: { score: guidanceScore(snap.guidance.direction), weight: 0.20 },
    mgmt_tone: { score: toneScore(snap.qualitative.mgmtTone), weight: 0.10 },
    narrative: {
      score: narrativeScoreFromThemes(snap.qualitative.themes),
      weight: 0.05,
    },
  };

  const total = Object.values(breakdown).reduce((s, b) => s + b.score * b.weight, 0);
  const score = clamp(Math.round(total));
  return { score, grade: letter(score), breakdown };
}

// ── Accounting Quality ───────────────────────────────────────────────────
export function computeAccountingQuality(opts: {
  cfoOverPat: number | null;
  arGrowthVsRevenuePct: number | null;
  inventoryGrowthVsRevenuePct: number | null;
  sbcIntensity: number | null;          // SBC / Revenue ratio
  debtToEbitda: number | null;
  fcfMargin: number | null;             // FCF / Revenue
  grossMarginStability: number | null;  // stddev of last 4Q gross margins (lower = better)
}): { score: number; grade: string; flags: string[] } {
  const flags: string[] = [];
  let score = 100;

  // CFO/PAT — institutional benchmark: ≥0.85 healthy, <0.5 red flag, negative = severe
  if (opts.cfoOverPat !== null) {
    if (opts.cfoOverPat < 0) { score -= 30; flags.push(`CFO/PAT negative (${opts.cfoOverPat.toFixed(2)}) — earnings not converting to cash`); }
    else if (opts.cfoOverPat < 0.5) { score -= 20; flags.push(`CFO/PAT low (${opts.cfoOverPat.toFixed(2)}) — weak cash conversion`); }
    else if (opts.cfoOverPat < 0.85) { score -= 10; flags.push(`CFO/PAT below 0.85 (${opts.cfoOverPat.toFixed(2)})`); }
  } else { score -= 5; }

  // AR growth vs revenue growth — receivables outpacing sales = collection risk
  if (opts.arGrowthVsRevenuePct !== null) {
    if (opts.arGrowthVsRevenuePct > 25) { score -= 20; flags.push(`Receivables growing ${opts.arGrowthVsRevenuePct.toFixed(0)}pp faster than revenue — collection risk`); }
    else if (opts.arGrowthVsRevenuePct > 10) { score -= 10; flags.push(`Receivables outpacing revenue by ${opts.arGrowthVsRevenuePct.toFixed(0)}pp`); }
  }

  // Inventory growth vs revenue
  if (opts.inventoryGrowthVsRevenuePct !== null) {
    if (opts.inventoryGrowthVsRevenuePct > 30) { score -= 15; flags.push(`Inventory build of ${opts.inventoryGrowthVsRevenuePct.toFixed(0)}pp above revenue — demand softness or write-down risk`); }
    else if (opts.inventoryGrowthVsRevenuePct > 15) { score -= 7; flags.push(`Inventory rising faster than revenue`); }
  }

  // SBC intensity — institutional benchmark: <5% healthy, 5-15% high, >15% extreme dilution
  if (opts.sbcIntensity !== null) {
    if (opts.sbcIntensity > 0.20) { score -= 20; flags.push(`SBC intensity ${(opts.sbcIntensity * 100).toFixed(1)}% — extreme dilution`); }
    else if (opts.sbcIntensity > 0.10) { score -= 10; flags.push(`SBC intensity ${(opts.sbcIntensity * 100).toFixed(1)}% — elevated`); }
  }

  // Leverage — Net Debt / EBITDA: <2 healthy, 3-5 stretched, >5 distressed
  if (opts.debtToEbitda !== null) {
    if (opts.debtToEbitda > 5) { score -= 15; flags.push(`Net Debt/EBITDA ${opts.debtToEbitda.toFixed(1)}x — over-levered`); }
    else if (opts.debtToEbitda > 3) { score -= 7; flags.push(`Net Debt/EBITDA ${opts.debtToEbitda.toFixed(1)}x — stretched`); }
    else if (opts.debtToEbitda < 0) { score += 5; }
  }

  // FCF margin — adds confidence
  if (opts.fcfMargin !== null) {
    if (opts.fcfMargin < -0.10) { score -= 15; flags.push(`FCF margin ${(opts.fcfMargin * 100).toFixed(1)}% — cash burn`); }
    else if (opts.fcfMargin < 0) { score -= 8; flags.push(`Negative FCF margin`); }
    else if (opts.fcfMargin > 0.20) { score += 8; }
    else if (opts.fcfMargin > 0.10) { score += 4; }
  }

  // Gross margin stability — high volatility hurts
  if (opts.grossMarginStability !== null && opts.grossMarginStability > 5) {
    score -= 10; flags.push(`Gross margin volatile (σ ${opts.grossMarginStability.toFixed(1)}pp over 4Q)`);
  }

  score = clamp(score);
  return { score, grade: letter(score), flags };
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
} {
  if (signals.length === 0) {
    return { score: 50, grade: letter(50), direction: 'stable', confidence: 'low', signals };
  }
  const dirVal: Record<Direction, number> = { improving: 100, stable: 50, deteriorating: 0 };
  const totalWeight = signals.reduce((s, sg) => s + sg.weight, 0);
  if (totalWeight === 0) {
    return { score: 50, grade: letter(50), direction: 'stable', confidence: 'low', signals };
  }
  const weighted = signals.reduce((s, sg) => s + dirVal[sg.direction] * sg.weight, 0);
  const score = clamp(Math.round(weighted / totalWeight));
  const direction: Direction = score >= 60 ? 'improving' : score <= 40 ? 'deteriorating' : 'stable';
  const confidence: 'low' | 'medium' | 'high' =
    signals.length >= 5 ? 'high' : signals.length >= 3 ? 'medium' : 'low';
  return { score, grade: letter(score), direction, confidence, signals };
}

// ── Reaction probability (deterministic, from reaction score) ─────────────
export function computeReactionProbability(reactionScore: number, hasEstimates: boolean): {
  expected: '+10%' | '+5%' | 'flat' | '-5%' | '-10%';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
} {
  let expected: '+10%' | '+5%' | 'flat' | '-5%' | '-10%';
  let summary: string;
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
  const confidence: 'low' | 'medium' | 'high' = !hasEstimates
    ? 'low'
    : reactionScore >= 75 || reactionScore <= 25
    ? 'high'
    : 'medium';
  return { expected, confidence, summary };
}

// ── Narrative score wrapper ──────────────────────────────────────────────
export function computeNarrativeScore(themes: ThemeExposure[]): { score: number; grade: string; themes: string[] } {
  const score = narrativeScoreFromThemes(themes);
  return {
    score,
    grade: letter(score),
    themes: themes.map((t) => `${t.theme} (${t.strength})`),
  };
}

export const _internal = { letter, clamp, surprisePctScore, surpriseBpsScore, toneScore };
