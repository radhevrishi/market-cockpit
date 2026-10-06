// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// ── Types matching earnings-scan API ──

export interface QuarterFinancials {
  period: string;
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
}
export interface EarningsScanCard {
  symbol: string;
  company: string;
  period: string;
  resultDate: string;
  reportType: 'Consolidated' | 'Standalone';
  quarters: QuarterFinancials[];
  revenueYoY: number | null;
  revenueQoQ: number | null;
  opProfitYoY: number | null;
  opProfitQoQ: number | null;
  patYoY: number | null;
  patQoQ: number | null;
  epsYoY: number | null;
  epsQoQ: number | null;
  fundamentalsScore: number;
  priceScore: number;
  totalScore: number;
  grade: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  dataQuality: 'FULL' | 'PARTIAL' | 'PRICE_ONLY';
  mcap: number | null;
  pe: number | null;
  cmp: number | null;
  isBanking: boolean;
  // Guidance & Sentiment
  guidance?: 'Positive' | 'Neutral' | 'Negative';
  sentimentScore?: number;
  revenueOutlook?: 'Up' | 'Flat' | 'Down' | 'Unknown';
  marginOutlook?: 'Expanding' | 'Stable' | 'Contracting' | 'Unknown';
  capexSignal?: 'Expanding' | 'Stable' | 'Reducing' | 'Unknown';
  demandSignal?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
  keyPhrasesPositive?: string[];
  keyPhrasesNegative?: string[];
  divergence?: 'StrongEarnings_WeakGuidance' | 'WeakEarnings_StrongGuidance' | 'None';
  // Source attribution
  source?: 'nse' | 'screener.in' | 'trendlyne' | 'moneycontrol' | 'none';
  sourceConfidence?: number;
  dataStatus?: 'FULL' | 'PARTIAL' | 'ESTIMATED' | 'MISSING';
  dataAge?: 'fresh' | 'stale' | 'missing';
  failureReasons?: string[];
  screenerUrl: string;
  nseUrl: string;
  // Extended: which universe the stock belongs to
  universeTag?: 'portfolio' | 'watchlist' | 'both' | 'screener' | 'conviction';
  // PATCH 0186 — orthogonal flag: ticker is on the Conviction Beats list
  isConviction?: boolean;
}
export interface ScanResponse {
  cards: EarningsScanCard[];
  summary: {
    total: number;
    withData?: number;
    missing?: number;
    excellent: number;
    strong: number;
    good: number;
    ok: number;
    bad: number;
    avgScore: number;
    sourceBreakdown?: { nse: number; moneycontrol: number; screener: number; trendlyne: number; none: number };
    avgConfidence?: number;
    guidanceCoverage?: number;
    guidancePositive?: number;
    guidanceNeutral?: number;
    guidanceNegative?: number;
    avgSentiment?: number;
    divergences?: number;
    dataQualityBreakdown: { full: number; partial: number; priceOnly: number };
    dataStatusBreakdown?: { full: number; partial: number; estimated: number; missing: number };
    dataAgeBreakdown?: { fresh: number; stale: number; missing: number };
  };
  source: string;
  updatedAt: string;
  failed?: string[];
  requestedSymbols?: string[];
}
export type ViewMode = 'portfolio' | 'watchlist' | 'both' | 'screener' | 'conviction';
// ── Aggregation Types ──

export interface UniverseAggregation {
  label: string;
  count: number;
  avgRevenueYoY: number | null;
  avgPatYoY: number | null;
  avgEpsYoY: number | null;
  avgOpmChange: number | null;
  risingEarningsPct: number;
  marginExpansionPct: number;
  riskFlags: number; // high D/E + negative growth
  avgScore: number;
}
// PATCH 0948/0951 — AI Forward Guidance interface shared with the server endpoint.
// P0951 added: 'NoGuidance' label (honest "PDF has nothing forward" signal),
// numbers/catalysts arrays (institutional-grade specifics), source_filename
// (audit trail so the user can verify which PDF was read).
export interface AIForwardGuidance {
  label: 'Positive' | 'Neutral' | 'Negative' | 'NoGuidance';
  score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
  quotes: string[];
  numbers?: Array<{ metric: string; value: string; period?: string }>;
  catalysts?: Array<{ event: string; timing?: string }>;
  source: 'concall-transcript' | 'investor-presentation' | 'press-release';
  source_url?: string;
  source_filename?: string;
  period: string;
  extracted_at: string;
  // PATCH 0962 — provenance + telemetry (ISSUE #5/#9/#11). Optional on hydrate
  // because pre-v3 entries don't have them; the validator + version check
  // decides whether to trust them.
  schema_version?: number;
  prompt_version?: string;
  parser_version?: string;
  source_fetched_at?: string;
  source_provider?: 'nse' | 'screener-in';
  source_period_hint?: string;
  pdf_chars?: number;
  pdf_pages?: number;
  pdf_quality?: 'good' | 'pdf-empty' | 'pdf-image-only' | 'pdf-too-short' | 'pdf-corrupt' | 'no-pdf' | 'intimation-only';
  extraction_ms?: number;
  retry_count?: number;
  stop_reason?: string;
}
   // PATCH 0962 — bumped to invalidate old v2 schema entries

// PATCH 0949 — AI tier classifier. The LLM returns label ∈ {Positive,Neutral,Negative}
// which is too coarse to differentiate quality. Use the signed score in [-1, +1]
// to bucket into 5 tiers so the user can read a card and instantly tell whether
// the AI verdict is strong, mild, or marginal. Tier governs colour/icon/label;
// confidence === 'LOW' overrides border to dashed + appends "(low conf)" so we
// never make a confident-looking badge from a shaky read.
export type AITier = 'EXCELLENT' | 'POSITIVE' | 'NEUTRAL' | 'CAUTIOUS' | 'NEGATIVE' | 'NOGUIDANCE';
// ══════════════════════════════════════════════
// EARNINGS COMMENTARY — one-line institutional insight
// Generated from financial data: revenue, PAT, EPS, OPM trends.
// Signal: 🟢 POSITIVE / 🟡 MIXED / 🔴 RED FLAG
// ══════════════════════════════════════════════

export type CommentarySignal = 'POSITIVE' | 'MIXED' | 'RED_FLAG';
export interface PostGap {
  gap_pct: number | null;
  close_move_pct: number | null;
  live_move_pct: number | null;
  is_live: boolean;
  target_date: string | null;
  filing_date?: string;                                                  // PATCH 0205
  filing_date_source?: 'explicit' | 'kv-calendar' | 'detected';          // PATCH 0205/0206
}
// PATCH 0207 — Day-1 close threshold filter. Multi-select with OR semantics;
// a card passes if its close_move_pct satisfies ANY selected threshold.
// Cards without resolved gap data are excluded when any filter is active.
export type DayOneFilter = 'GE2' | 'GE4' | 'GE7' | 'GE10' | 'NEG2' | 'NEG5';
