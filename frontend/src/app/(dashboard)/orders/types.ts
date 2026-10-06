// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// ── Types ──
export type ActionFlag = 'BUY' | 'ADD' | 'HOLD' | 'WATCH' | 'TRIM' | 'EXIT' | 'AVOID' | 'MONITOR';
export type ScoreClassification = 'HIGH_CONVICTION' | 'STRONG' | 'BUILDING' | 'WEAK' | 'NOISE';
export type FreshnessLabel = 'FRESH' | 'RECENT' | 'AGING' | 'STALE';
export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export interface Signal {
  symbol: string;
  company: string;
  date: string;
  source: 'order' | 'deal';
  eventType: string;
  headline: string;
  valueCr: number;               // NEVER null — always populated
  valueUsd: string | null;
  mcapCr: number | null;
  revenueCr: number | null;
  impactPct: number;             // Core metric: (valueCr / revenueCr) * 100
  pctRevenue: number | null;     // Legacy alias for impactPct
  pctMcap: number | null;
  inferenceUsed: boolean;        // True if value was inferred
  client: string | null;
  segment: string | null;
  timeline: string | null;
  buyerSeller: string | null;
  premiumDiscount: number | null;
  impactLevel: ImpactLevel;
  impactConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore?: number;        // 90=ACTUAL / 70=INFERRED / 50=HEURISTIC
  confidenceType?: 'ACTUAL' | 'INFERRED' | 'HEURISTIC';
  dataConfidence?: 'VERIFIED' | 'ESTIMATED' | 'LOW';  // Data quality indicator
  action: ActionFlag;
  score: number;
  timeWeight: number;
  weightedScore: number;
  sentiment: 'Bullish' | 'Neutral' | 'Bearish';
  whyItMatters: string;
  isNegative: boolean;
  earningsBoost: boolean;
  isWatchlist: boolean;
  isPortfolio: boolean;
  isExcel?: boolean;          // from Multibagger Excel Score & Rank engine
  isConviction?: boolean;     // PATCH 0251 — from Conviction Beats (lib/conviction-beats.ts)
  lastPrice?: number | null;       // Current stock price for performance tracking
  dataSource?: string;             // 'NSE' | 'Moneycontrol' | 'Google News' | 'Block Deal' | 'Bulk Deal'
  signalStackCount?: number;
  signalStackLevel?: 'STRONG' | 'BUILDING' | 'WEAK';
  portfolioImpactScore?: number;   // Score for portfolio impact ranking
  scoreDelta?: number;
  scoreClassification?: ScoreClassification;
  freshness?: FreshnessLabel;
  sectorScore?: number;
  sectorTrend?: 'Bullish' | 'Neutral' | 'Bearish';
  decision?: ActionFlag;
  decisionReason?: string;
  tag?: string;

  // 3-Axis Normalized Scores (0-100 each)
  fundamentalScore?: number;     // 0-100 Fundamental Delta
  signalStrengthScore?: number;  // 0-100 Signal Strength
  dataConfidenceScore?: number;  // 0-100 Data Confidence

  // Institutional-grade fields
  signalTier?: 'TIER1_VERIFIED' | 'TIER2_INFERRED';
  contradictions?: string[];
  whyAction?: string;
  anomalyFlags?: string[];
  sourceUrl?: string;
  revenueGrowth?: number | null;
  marginChange?: number | null;
  catalystStrength?: 'WEAK' | 'MODERATE' | 'STRONG';
  conflictResolution?: string;
  sectorCyclical?: boolean;
  priceReactionNote?: string;
  evidenceTier?: 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';
  timeHorizon?: 'SHORT' | 'MEDIUM' | 'LONG';
  watchSubtype?: 'ACTIVE' | 'PASSIVE';
  eventNovelty?: 'NEW' | 'REPEAT' | 'STALE';
  heuristicSuppressed?: boolean;
  extremeValueFlag?: string;
  // v3 fields
  templatePattern?: string;
  identicalPctFlag?: boolean;
  sourceMismatch?: string;
  guidanceAnomalyFlag?: string;
  visibility?: 'VISIBLE' | 'DIMMED' | 'HIDDEN';
  netSignalScore?: number;
  conflictBadge?: string;
  riskFactors?: string[];
  sourceExtract?: string;
  // v4 fields
  sourceTier?: 'VERIFIED' | 'HEURISTIC' | 'INFERRED';
  dataQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | 'BROKEN';
  guidanceScope?: 'COMPANY' | 'SEGMENT' | 'PRODUCT' | 'REGION' | 'UNKNOWN';
  guidancePeriod?: 'FY' | 'Q' | 'RUN_RATE' | 'UNKNOWN';
  actionScore?: number;
  guidanceRangeLow?: number;
  guidanceRangeHigh?: number;
  guidanceRangeConfPenalty?: number;

  // v5 fields
  srcVerified?: boolean;
  numValidated?: boolean;
  scopeValidated?: boolean;
  verified?: boolean;
  confidenceLayer?: number;
  signalCategory?: 'ACTIONABLE' | 'OBSERVATION';
  observationReason?: string;

  // Decision engine fields
  signalClass?: 'ECONOMIC' | 'STRATEGIC' | 'GOVERNANCE' | 'COMPLIANCE';
  materialityScore?: number;
  managementRole?: string;

  // v7 fields
  portfolioCritical?: boolean;
  v7RankScore?: number;
  signalTierV7?: 'ACTIONABLE' | 'NOTABLE' | 'MONITOR';

  // v9: Signal quality model
  dataType?: 'FACT' | 'INFERENCE';
  monitorScore?: number;
  monitorTier?: 'HIGH' | 'MEDIUM' | 'LOW';
  priceChange?: number;
  volumeRatio?: number;
  corroborationCount?: number;

  // v8: Thematic alpha
  alphaTheme?: {
    tag: string;
    label: string;
    score: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    narrative: string;
  };

  // v9: Event taxonomy + signal card format
  eventTaxonomyTier?: 'TIER_1' | 'TIER_2' | 'TIER_3';
  signalScoreBreakdown?: {
    materiality: number;
    confidence: number;
    freshness: number;
    investability: number;
  };
  conflictRange?: { min: number; max: number; sources: string[] };
  whatHappened?: string;
  economicImpact?: string;
  evidence?: string;
  risks?: string[];
  nextConfirmation?: string;
  _speculative?: boolean;
  _stackIndependent?: boolean;
  _stackRawCount?: number;
}
// ── v8: Thematic Idea for always-present alpha section ──
export interface ThematicIdea {
  symbol: string;
  company: string;
  theme: {
    tag: string;
    label: string;
    score: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    narrative: string;
  };
  signals: number;
  isPortfolio: boolean;
  isWatchlist: boolean;
  isConviction?: boolean;  // PATCH 0251
  lastPrice?: number | null;
  segment?: string | null;
}
export interface TrendSignalDetail {
  headline: string;
  eventType: string;
  date: string;
  sentiment: string;
  action: string;
  impactLevel: string;
  weightedScore: number;
  confidenceScore: number;
  valueCr: number;
  whyItMatters: string;
  dataSource?: string;
}
export interface CompanyTrend {
  symbol: string;
  company: string;
  signalCount: number;
  stackLevel: 'STRONG' | 'BUILDING' | 'WEAK';
  topAction: ActionFlag;
  topImpact: ImpactLevel;
  netSentiment: 'Bullish' | 'Neutral' | 'Bearish';
  avgScore: number;
  maxScore?: number;
  signals?: TrendSignalDetail[];
  isExcel?: boolean;   // tagged client-side from Multibagger engine
  isPortfolio?: boolean;
  isWatchlist?: boolean;
  isConviction?: boolean;  // PATCH 0251
}
export interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyCount: number;
  addCount?: number;
  holdCount: number;
  watchCount?: number;
  trimExitCount?: number;
  totalSignals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
  portfolioAlerts: number;
  negativeSignals: number;
  summary: string;
  // Legacy fields for backwards compatibility
  buyWatchCount?: number;
  trackCount?: number;
}
export type FilterType = 'ALL' | 'BUY' | 'ADD' | 'HOLD' | 'WATCH' | 'TRIM' | 'ORDERS' | 'CAPEX' | 'DEALS' | 'STRATEGIC' | 'NEGATIVE' | 'HIGH_IMPACT' | 'NOTABLE';
export type UniverseFilter = 'ALL' | 'PORTFOLIO' | 'WATCHLIST' | 'EXCEL' | 'CONVICTION';
// ══════════════════════════════════════════════════════════════════════════════
// 🧠 CONCALL INTELLIGENCE ENGINE v2 — institutional-grade management signal extractor
// Belongs in CONCALL tab: management intent, order/capex/margin guidance, MRI
// News-feed signals (analyst capitulation, sector tailwind) routed separately
// ══════════════════════════════════════════════════════════════════════════════

export type ConcallSignalType =
  // CONCALL SIGNALS — from management statements (earnings calls, investor presentations)
  'ORDER'|'LTA'|'DEMAND_CONSTRAINT'|'CAPEX'|'CAPEX_DELAY'|'MARGIN'|'MARGIN_PRESSURE'|
  'PRICING'|'GUIDANCE_UP'|'GUIDANCE_DOWN'|'CONSERVATIVE_GUIDANCE'|'VISIBILITY_CONFIDENCE'|
  'EXPORT_DEMAND'|'ORDER_EXECUTION_DELAY'|'DEBT_REDUCTION'|'EQUITY_DILUTION'|
  'REGULATORY_RISK'|'CUSTOMER_DELAY'|'WORKING_CAPITAL_STRESS'|'SECTOR_TAILWIND'|
  // NEWS SIGNALS — routed to news feed
  'ANALYST_CAP'|'SUPPLY_CHAIN';
export type SignalHorizon = '0-3M'|'3-6M'|'6-12M'|'12M+';
export type SignalCategory = 'DEMAND'|'MARGIN'|'CAPEX'|'PRICING'|'GUIDANCE'|'SUPPLY_CHAIN'|'RISK'|'MGMT_STYLE';
export type SignalTemporality = 'FORWARD'|'CURRENT'|'HISTORICAL';
 // forward = highest value

export interface NumericalExtract { value?: number; unit?: string; currency?: string; timing?: string }
export type SignalOrigin = 'COMPANY' | 'SECTOR' | 'DERIVED';
 // COMPANY = article matched this ticker; SECTOR = cross-stock; DERIVED = inferred

export interface ExtractedSignal {
  type: ConcallSignalType; category: SignalCategory;
  text: string;           // extracted sentence — MANDATORY, empty = invalid signal
  positive: boolean;
  strength: 1|2|3|4|5;
  horizon: SignalHorizon;
  isAlpha: boolean;
  temporality: SignalTemporality;
  numerical?: NumericalExtract;
  isForConcall: boolean;
  source: string;
  date: string;
  ageWeight: number;
  // NEW: subject + origin — the two fields that fix "DEMAND_CONSTRAINT everywhere"
  subject: string;        // WHAT: "Insulators", "₹300Cr Order", "Q4 FY26 Capacity"
  origin: SignalOrigin;   // WHO: company-specific vs sector-wide vs derived
  dupCount?: number;      // how many duplicate signals were merged into this one
}
export interface CompositeSignal {
  category: SignalCategory;
  label: string;
  direction: 'UP'|'DOWN'|'STABLE';
  strength: number;       // 1-5 composite
  evidence: string[];     // supporting quotes
  count: number;          // articles supporting this
}
export interface CompanyConcallSummary {
  symbol: string; company: string; sector: string;
  grade?: string; score?: number; source?: string;
  signals: ExtractedSignal[];
  composite: CompositeSignal[]; // stacked multi-article composite
  signalScore: number;
  mriScore: number;
  expectationShift: number; // 0-100: how much did this change forward expectations
  trend: 'IMPROVING'|'STABLE'|'DETERIORATING'|'UNKNOWN';
  tone: string;
  missedByMarket: boolean; // strong signals + low article coverage
  surprisePotential: 'HIGH'|'MEDIUM'|'LOW';
  freshness: 'FRESH'|'ACTIVE'|'STALE';
  lastDate?: string;
  articleCount: number;
  alphaCount: number;
  noiseCount: number;
  whyItMatters: string; // auto-generated "why this matters" statement
  // Article headlines for display even when no signals extracted
  recentHeadlines: { title: string; source: string; date: string; url?: string }[];
  // ─── PATCH 0065: Fidelity tier — what KIND of evidence drives this card ───
  // HIGH_MANUAL       → user pasted a real concall transcript (best fidelity)
  // MEDIUM_NEWS_ALPHA → news headlines with ≥3 articles AND ≥1 alpha signal
  // LOW_NEWS_ONLY     → news headlines but no alpha signals (low fidelity)
  // NONE              → no coverage at all
  fidelity_tier?: 'HIGH_MANUAL' | 'MEDIUM_NEWS_ALPHA' | 'LOW_NEWS_ONLY' | 'NONE';
  manual_signals_count?: number;
  manual_paste_iso?: string;            // when the manual paste was added
}
// ── Cross-Stock Sector Signal Library ────────────────────────────────────────
// When an article mentions a sector-wide shortage, auto-apply to relevant tracked stocks
// ── Rich Sector Signal Library — subject + driver + relevance scoring ─────────
// Each sector signal specifies: WHAT (subject), WHY (driver), WHO benefits (products+sectors)
// relevanceThreshold: company must score >= this to receive the signal
export interface SectorSignalDef {
  id: string; label: string;
  signalType: 'DEMAND_SURGE'|'SUPPLY_CONSTRAINT'|'INFRASTRUCTURE_BOTTLENECK'|'CAPACITY_SHORTAGE'|'INPUT_SHORTAGE';
  subject: string;    // WHAT: "Insulator Supply", "Grid Infrastructure"
  driver: string;     // WHY: "T&D capex cycle", "Data center demand"
  impact: string;     // WHAT IT MEANS for beneficiaries
  keywords: string[]; // at least one must appear in article
  // Multi-condition: both product AND state keyword must co-occur in same sentence
  compoundRequired?: { product: string[]; state: string[] };
  beneficiaryProducts: string[]; // company names/sectors matching these get relevance bonus
  targetSectors: string[];       // high-relevance sectors (score 0.85)
  excludeSectors: string[];      // zero relevance — don't propagate
  relevanceThreshold: number;    // 0.0-1.0: min relevance to inject signal
}
