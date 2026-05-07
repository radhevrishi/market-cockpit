// ─────────────────────────────────────────────────────────────────────────────
// EarningsSnapshot — institutional data model
// ─────────────────────────────────────────────────────────────────────────────
// A deterministic, schema-first representation of one earnings event.
// Built from: SEC EDGAR XBRL (or FMP/NSE/BSE) + FMP consensus + 8Q history.
// The institutional UI renders ONLY from this object — no ad-hoc inference.
// ─────────────────────────────────────────────────────────────────────────────

export type SurpriseClass =
  | 'blowout'      // ≥10% beat (or ≥150 bps for margins)
  | 'strong_beat'  // 5–10%
  | 'modest_beat'  // 2–5%
  | 'inline'       // ±2%
  | 'modest_miss'  // -2% to -5%
  | 'strong_miss'  // -5% to -10%
  | 'severe_miss'  // ≤ -10%
  | 'na';

export type GuidanceDirection = 'raised' | 'maintained' | 'lowered' | 'introduced' | 'na';

export type MgmtTone =
  | 'very_bullish'
  | 'constructive'
  | 'neutral'
  | 'cautious'
  | 'defensive'
  | 'distressed';

export type ThemeStrength = 'high' | 'medium' | 'low' | 'none';

export type ReactionExpectation = '+10%' | '+5%' | 'flat' | '-5%' | '-10%';

export type Direction = 'improving' | 'deteriorating' | 'stable';

export interface MetricLine {
  metric: string;
  unit: 'currency' | 'percent' | 'count';
  actual: number | null;
  estimate: number | null;
  prior: number | null;       // YoY same quarter
  qoqPrior: number | null;    // QoQ prior quarter
  surprisePct: number | null; // for currency/count metrics
  surpriseBps: number | null; // for percent metrics (margins)
  yoyPct: number | null;
  yoyBps: number | null;
  qoqPct: number | null;
  qoqBps: number | null;
  surpriseClass: SurpriseClass;
}

export interface ThemeExposure {
  theme: string;
  strength: ThemeStrength;
  evidence: string[]; // matched keywords/phrases
}

export interface AnalystRatings {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  consensusTargetPrice: number | null;
  currentPrice: number | null;
  upsidePct: number | null;
  recentUpgrades30d: number;
  recentDowngrades30d: number;
}

export interface QuarterRow {
  date: string;
  period: string;
  revenue: number | null;
  revenueEstimate: number | null;
  revenueSurprisePct: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  ebitdaMargin: number | null;
  netMargin: number | null;
  eps: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  fcf: number | null;
}

export interface EarningsSnapshot {
  // Header
  ticker: string;
  company: string;
  quarter: string;
  filingType: string;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;          // in raw currency units
  enterpriseValue: number | null;
  reportTime: 'pre_market' | 'post_market' | 'unknown';
  currency: 'USD' | 'INR' | 'EUR' | 'unknown';
  scaleLabel: string;

  // Section B — Earnings Scorecard (the headline)
  metrics: {
    revenue: MetricLine;
    eps: MetricLine;
    ebitda: MetricLine;
    grossMargin: MetricLine;
    ebitdaMargin: MetricLine;
    operatingMargin: MetricLine;
    netIncome: MetricLine;
    fcf: MetricLine;
  };

  // Section D — Guidance
  guidance: {
    direction: GuidanceDirection;
    revenue: { newGuide: string | null; street: number | null; deltaPct: number | null } | null;
    eps: { newGuide: string | null; street: number | null; deltaPct: number | null } | null;
    ebitda: { newGuide: string | null; street: number | null; deltaPct: number | null } | null;
    commentary: string[];
  };

  // Section E — Management Commentary
  qualitative: {
    mgmtTone: MgmtTone;
    toneConfidence: number;
    themes: ThemeExposure[];
    keyTakeaways: string[];
  };

  // Section F — Beat Streak / Trend (last 8Q)
  history: QuarterRow[];
  streak: {
    revenueBeats: number;
    revenueAttempts: number;
    epsBeats: number;
    epsAttempts: number;
    avgRevenueSurprise: number | null;
    avgEpsSurprise: number | null;
  };

  // Section G — Sell-Side Sentiment
  sellSide: AnalystRatings | null;

  // Section H — Accounting Quality (deterministic indicators)
  accountingQuality: {
    cfoOverPat: number | null;
    arGrowthVsRevenuePct: number | null;
    inventoryGrowthVsRevenuePct: number | null;
    sbcIntensity: number | null;
    debtToEbitda: number | null;
    fcfMargin: number | null;
    flags: string[];
  };

  // Scores (deterministic, 0–100, with breakdown)
  scores: {
    reaction: { score: number; grade: string; breakdown: Record<string, { score: number; weight: number }>; };
    accounting: { score: number; grade: string; flags: string[] };
    narrative: { score: number; grade: string; themes: string[] };
    jat: { score: number; grade: string; direction: Direction; confidence: 'low' | 'medium' | 'high'; signals: Array<{ name: string; direction: Direction; weight: number }> };
  };

  // Reaction probability (deterministic)
  reactionProbability: {
    expected: ReactionExpectation;
    confidence: 'low' | 'medium' | 'high';
    summary: string;
  };

  // Provenance
  sources: {
    financials: string;
    estimates: string;
    history: string;
  };
  validationWarnings: string[];
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Surprise classification — deterministic rules
// ─────────────────────────────────────────────────────────────────────────────
export function classifySurprisePct(pct: number | null): SurpriseClass {
  if (pct === null || !Number.isFinite(pct)) return 'na';
  if (pct >= 10) return 'blowout';
  if (pct >= 5) return 'strong_beat';
  if (pct >= 2) return 'modest_beat';
  if (pct >= -2) return 'inline';
  if (pct >= -5) return 'modest_miss';
  if (pct >= -10) return 'strong_miss';
  return 'severe_miss';
}

export function classifySurpriseBps(bps: number | null): SurpriseClass {
  if (bps === null || !Number.isFinite(bps)) return 'na';
  if (bps >= 200) return 'blowout';
  if (bps >= 100) return 'strong_beat';
  if (bps >= 30) return 'modest_beat';
  if (bps >= -30) return 'inline';
  if (bps >= -100) return 'modest_miss';
  if (bps >= -200) return 'strong_miss';
  return 'severe_miss';
}

export function surpriseClassColor(c: SurpriseClass): string {
  switch (c) {
    case 'blowout': return '#10b981';
    case 'strong_beat': return '#10b981';
    case 'modest_beat': return '#34d399';
    case 'inline': return '#94a3b8';
    case 'modest_miss': return '#f59e0b';
    case 'strong_miss': return '#f97316';
    case 'severe_miss': return '#ef4444';
    case 'na': return '#475569';
  }
}

export function surpriseClassLabel(c: SurpriseClass): string {
  switch (c) {
    case 'blowout': return 'Blowout';
    case 'strong_beat': return 'Strong Beat';
    case 'modest_beat': return 'Modest Beat';
    case 'inline': return 'Inline';
    case 'modest_miss': return 'Modest Miss';
    case 'strong_miss': return 'Strong Miss';
    case 'severe_miss': return 'Severe Miss';
    case 'na': return '—';
  }
}

// Helper: build a MetricLine from raw numbers
export function buildMetric(opts: {
  metric: string;
  unit: 'currency' | 'percent' | 'count';
  actual: number | null;
  estimate?: number | null;
  prior?: number | null;
  qoqPrior?: number | null;
}): MetricLine {
  const { metric, unit, actual } = opts;
  const estimate = opts.estimate ?? null;
  const prior = opts.prior ?? null;
  const qoqPrior = opts.qoqPrior ?? null;

  let surprisePct: number | null = null;
  let surpriseBps: number | null = null;
  let yoyPct: number | null = null;
  let yoyBps: number | null = null;
  let qoqPct: number | null = null;
  let qoqBps: number | null = null;

  if (unit === 'percent') {
    if (actual !== null && estimate !== null) surpriseBps = Math.round((actual - estimate) * 100);
    if (actual !== null && prior !== null) yoyBps = Math.round((actual - prior) * 100);
    if (actual !== null && qoqPrior !== null) qoqBps = Math.round((actual - qoqPrior) * 100);
  } else {
    if (actual !== null && estimate !== null && estimate !== 0) {
      surprisePct = Math.round(((actual - estimate) / Math.abs(estimate)) * 10000) / 100;
    }
    if (actual !== null && prior !== null && prior !== 0) {
      yoyPct = Math.round(((actual - prior) / Math.abs(prior)) * 10000) / 100;
    }
    if (actual !== null && qoqPrior !== null && qoqPrior !== 0) {
      qoqPct = Math.round(((actual - qoqPrior) / Math.abs(qoqPrior)) * 10000) / 100;
    }
  }

  const surpriseClass = unit === 'percent'
    ? classifySurpriseBps(surpriseBps)
    : classifySurprisePct(surprisePct);

  return {
    metric,
    unit,
    actual,
    estimate,
    prior,
    qoqPrior,
    surprisePct,
    surpriseBps,
    yoyPct,
    yoyBps,
    qoqPct,
    qoqBps,
    surpriseClass,
  };
}
