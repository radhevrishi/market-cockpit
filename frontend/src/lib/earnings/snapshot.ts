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
  // When 'consensus', estimate is a real analyst consensus (FMP / NASDAQ).
  // When 'prior_quarter_proxy', estimate equals last quarter's actual —
  // used as a fallback for ultra-thin small caps with NO sell-side
  // coverage anywhere. UI must surface this so the user doesn't
  // mistake QoQ growth for a real beat/miss vs street.
  estimateSource?: 'consensus' | 'prior_quarter_proxy';
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

  // Scores (deterministic, 0–100, with breakdown + confidence).
  // reaction.score and jat.score are nullable: when input coverage is too
  // thin (e.g. small caps with no consensus + minimal forward signals),
  // we emit null + grade 'N/A' rather than fabricate an A+ score off
  // narrative themes alone. UI should render '—' when score === null.
  scores: {
    reaction: {
      score: number | null;
      grade: string;
      confidence: number;
      breakdown: Record<string, { score: number | null; weight: number; reason?: string }>;
      unavailableReason: string | null;
    };
    accounting: { score: number; grade: string; confidence: number; flags: string[] };
    narrative: { score: number; grade: string; confidence: number; themes: string[] };
    jat: {
      score: number | null;
      grade: string;
      direction: Direction;
      confidence: 'low' | 'medium' | 'high';
      signals: Array<{ name: string; direction: Direction; weight: number }>;
      unavailableReason: string | null;
    };
  };

  // Section-level confidence + unavailable reasons for empty-state UX
  sectionStatus: {
    estimates: { available: boolean; confidence: number; reason: string | null };
    sellSide: { available: boolean; confidence: number; reason: string | null };
    history: { available: boolean; confidence: number; reason: string | null };
    themes: { available: boolean; confidence: number; reason: string | null };
    guidance: { available: boolean; confidence: number; reason: string | null };
  };

  // Debug provenance (for the expandable debug panel)
  debug: {
    endpointsHit: string[];
    endpointsFailed: string[];
    fallbacksUsed: string[];
    corpusChars: number;
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

  // ── India-specific institutional extras (only populated when currency==='INR') ─
  // The dedicated IndiaInstitutionalReport component reads from this. The US
  // InstitutionalReport ignores it.
  indiaExtras?: IndiaExtras;

  // Mode flag — drives which report component renders
  // 'us_full_consensus' | 'india_fundamental_only' | 'india_full_consensus'
  analysisMode?: AnalysisMode;
}

export type AnalysisMode = 'us_full_consensus' | 'india_fundamental_only' | 'india_full_consensus';

export interface IndiaExtras {
  // Top-level metrics from Screener
  topMetrics: {
    marketCapCr: number | null;
    cmp: number | null;
    peRatio: number | null;
    bookValue: number | null;
    dividendYieldPct: number | null;
    roce: number | null;
    roe: number | null;
    promoterHoldingPct: number | null;
    debtToEquity: number | null;
  };

  // Working capital cycle (days)
  workingCapital: {
    debtorDays: number | null;
    inventoryDays: number | null;
    daysPayable: number | null;
    cashConversionCycle: number | null;
    workingCapitalDays: number | null;
    cfoOverPat: number | null;
    interestCoverage: number | null;
    asOfPeriod: string | null;
    // Sector-aware tone thresholds. Tuple format [good_max, mid_max, bad_floor]
    // for "lower-is-better" metrics; reverse semantics for daysPayable.
    // Calibrated per IndiaSector (see WC_BENCHMARKS in india-sectors.ts) so
    // 122 inventory days reads green for capital goods but red for FMCG.
    benchmarks?: {
      debtorDays: [number, number, number];
      inventoryDays: [number, number, number];
      daysPayable: [number, number, number];
      cashConvCycle: [number, number, number];
      workingCapitalDays: [number, number, number];
      cfoOverPat: { good: number; mid: number };
      sectorLabel: string;   // human-readable benchmark source ("Industrials / Capital Goods", etc.)
    };
  };

  // Promoter & governance
  governance: {
    promoterHoldingPct: number | null;
    promoterChangeQoQ: number | null;     // pp difference latest vs previous
    promoterChangeYoY: number | null;     // pp difference latest vs 4Q ago
    fiiHoldingPct: number | null;
    fiiChangeQoQ: number | null;
    diiHoldingPct: number | null;
    diiChangeQoQ: number | null;
    publicHoldingPct: number | null;
    pledgePct: number | null;             // null if not reported
    flags: string[];                       // institutional commentary
    // Promoter Trust Score — composite governance signal (0-100)
    // Inputs: stability 40%, pledge 30%, consistency 15%, institutional confirmation 15%
    trustScore?: {
      score: number;                       // 0-100
      grade: 'A' | 'B' | 'C' | 'D' | 'F';
      verdict: string;                     // human-readable interpretation
      breakdown: {
        stability: { score: number; reason: string };
        pledge: { score: number; reason: string };
        consistency: { score: number; reason: string };
        institutional: { score: number; reason: string };
      };
    };
  };

  // Quarterly breakdown (last 8Q) — values in ₹ Cr
  quarterlyTrend: Array<{
    period: string;
    revenue: number | null;
    operatingProfit: number | null;
    opmPct: number | null;
    netProfit: number | null;
    netMarginPct: number | null;
    eps: number | null;
    qoqRevenuePct: number | null;
    qoqProfitPct: number | null;
    yoyRevenuePct: number | null;
    yoyProfitPct: number | null;
    yoyOpmBps: number | null;
    // Additional deltas surfaced in the Latest Quarter summary table
    qoqOpProfitPct: number | null;
    yoyOpProfitPct: number | null;
    qoqOpmBps: number | null;
    qoqEpsPct: number | null;
    yoyEpsPct: number | null;
    qoqNetMarginBps: number | null;
    yoyNetMarginBps: number | null;
  }>;

  // Sector intelligence
  sector: {
    slug: string;
    displayName: string;
    sectorString: string | null;       // "Fast Moving Consumer Goods"
    industryString: string | null;     // "Personal Products"
    subIndustryString: string | null;
    kpis: Array<{
      label: string;
      description: string;
      importance: 'critical' | 'high' | 'medium';
      tracked: boolean;                // populated when we have data
      value?: string;
    }>;
    macroThemes: string[];
    redFlags: string[];
  };

  // Fundamental composite (replaces "reaction score" for India)
  fundamentalScore: {
    overall: number;                   // 0-100
    grade: string;
    components: {
      growth: { score: number; label: string };
      margin: { score: number; label: string };
      working_capital: { score: number; label: string };
      promoter: { score: number; label: string };
      cash_conversion: { score: number; label: string };
      // Sixth component — populated only when a concall transcript is
      // available. Pulls from concall tone signals + guidance direction
      // and feeds into the overall composite with full weight.
      forward?: { score: number; label: string };
    };
    direction: 'improving' | 'stable' | 'deteriorating';
    confidence: 'high' | 'medium' | 'low';
  };

  // One-line institutional verdict — synthesised from FundamentalScore +
  // direction signals. Renders prominently below the company name so the
  // user knows at a glance "what to do with this company".
  topLine?: {
    headline: string;        // e.g. "Q4 rebound but margins still under YoY pressure"
    // WATCHLIST = high-quality fundamentals + stretched/bubble valuation.
    // Sits between HOLD and AVOID in tier ordering. Used when the
    // business is improving but the multiple is rich enough that an
    // institutional reader should wait for entry rather than enter
    // immediately. AVOID stays reserved for actual fundamental
    // deterioration / governance breaks / accounting flags.
    verdict: 'BUY' | 'ACCUMULATE' | 'HOLD' | 'NEUTRAL' | 'WATCHLIST' | 'AVOID' | 'SELL';
    rationale: string;        // one short clause explaining the verdict
    watchPoints: string[];    // 2-3 KPIs / signals to monitor
    // Forward-looking signal — derived from guidance.direction + concall
    // tone counts + key mentions. Renders as a second pill next to VERDICT.
    forwardLook?: {
      grade: 'very_positive' | 'positive' | 'mixed' | 'cautious' | 'weak' | 'not_provided';
      label: string;          // human-readable: "STRONG", "POSITIVE", "MIXED", etc.
      evidence: string;       // short clause: "capacity expansion + new product roadmap"
    };
  };

  // Source-data staleness flag — set when latest reported period is more
  // than 9 months old. UI surfaces this as a red banner so users don't
  // mistake archived data for current.
  staleness?: {
    monthsOld: number | null;
    isStale: boolean;
    latestPeriod: string | null;
  };

  // Concall extraction — populated when the user pastes a transcript
  concall?: {
    topQuotes: string[];
    toneSignals: Array<{
      phrase: string;
      context: string;
      sentiment: 'positive' | 'cautious' | 'negative';
    }>;
    keyMentions: Array<{
      topic:
        | 'operating_leverage'
        | 'capex'
        | 'margins'
        | 'eps'
        | 'launches'
        | 'demand'
        | 'guidance'
        | 'inflation'
        | 'pricing'
        | 'dividend'
        | 'subsidiary'
        | 'geographic_mix'
        | 'capacity'
        | 'rd_pipeline'
        | 'customer_wins'
        // Expanded coverage based on common Indian midcap concall patterns:
        | 'order_book'
        | 'utilization'
        | 'volume_value'
        | 'segment_mix'
        | 'net_debt'
        | 'pli_rodtep'
        | 'pricing_action'
        | 'mna'
        | 'esg';
      quote: string;
    }>;
    sectorKpiHits: Array<{ label: string; value: string; quote: string }>;
    concallScore: number;
    concallGrade: string;
    positiveCount: number;
    negativeCount: number;
    cautiousCount: number;
    charsAnalyzed: number;
    // Concall-mined risk profile — populated by extractIndiaConcallInsights.
    // Each metric is null/false when no signal is found in the transcript.
    riskProfile?: {
      customerConcentrationPct: number | null;
      customerConcentrationQuote: string | null;
      exportConcentrationPct: number | null;
      exportConcentrationQuote: string | null;
      fxHedgePct: number | null;
      fxHedgeQuote: string | null;
      debtRefinancingFlag: boolean;
      debtRefinancingQuote: string | null;
      commoditySensitivityFlag: boolean;
      commoditySensitivityQuote: string | null;
      workingCapitalStressFlag: boolean;
      workingCapitalStressQuote: string | null;
    };
  };

  // Valuation discipline — sector-aware fair-P/E assessment that gates
  // verdict tone. Populated by buildIndiaSnapshot from
  // assessValuation(topMetrics.peRatio, sector).
  valuation?: {
    tier: 'fair' | 'premium' | 'stretched' | 'bubble' | 'na';
    pe: number | null;
    fairLow: number;
    fairHigh: number;
    stretched: number;
    bubble: number;
    label: string;
    vsSectorMidX: number | null;  // multiple of sector mid (1.0 = at mid)
  };
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
  // 'consensus' = real analyst estimate (FMP/NASDAQ/etc.).
  // 'prior_quarter_proxy' = no consensus available anywhere → prior
  // quarter actual was substituted as the comparison anchor. UI must
  // surface this so QoQ growth isn't read as a real surprise vs street.
  estimateSource?: 'consensus' | 'prior_quarter_proxy';
}): MetricLine {
  const { metric, unit, actual } = opts;
  const estimate = opts.estimate ?? null;
  const prior = opts.prior ?? null;
  const qoqPrior = opts.qoqPrior ?? null;
  const estimateSource = opts.estimateSource ?? 'consensus';

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

  // SANITY GUARD: if absolute surprise > 50% the data is almost certainly
  // a period-mismatch bug (forward estimate vs prior actual), not a real
  // beat/miss. Earnings rarely surprise more than 30%; 50%+ in the wild
  // is an FMP data alignment quirk. Drop to '—' rather than render a
  // misleading 'Severe Miss / Blowout Beat' verdict.
  if (surprisePct !== null && Math.abs(surprisePct) > 50) {
    surprisePct = null;
  }
  if (surpriseBps !== null && Math.abs(surpriseBps) > 5000) {
    surpriseBps = null;
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
    estimateSource,
  };
}
