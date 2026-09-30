// zzz846 — GROWTH GUIDANCE: shared contract. Types + label maps only, no logic.
// Purpose: discover, verify, track companies where MANAGEMENT has communicated unusually high future growth.
// Rules: never invent a number (unverified stays UNVERIFIED); management guidance/target/commentary are never mixed
// with analyst numbers; no composite score (transparent fields only); research-only (no broker actions);
// unknown ≠ negative; price never decides guidance quality; India and US share one engine.

export type GgMarket = 'IN' | 'US' | 'GLOBAL';
export type GgMetric = 'REVENUE' | 'PAT' | 'EPS' | 'EBITDA' | 'FCF';
export type GgKind =
  | 'MANAGEMENT_GUIDANCE' | 'MANAGEMENT_TARGET' | 'MANAGEMENT_COMMENTARY'
  | 'ANALYST_CONSENSUS' | 'ANALYST_ESTIMATE' | 'HISTORICAL_TRAJECTORY' | 'INFERENCE';
export type GgVerification = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'SECONDARY_ONLY' | 'UNVERIFIED';
export type GgPeriodKind = 'FY' | 'CY' | 'QUARTER' | 'HALF' | 'ROLLING_12M' | 'MULTI_YEAR_CAGR' | 'UNKNOWN';
export type GgGrowthOrigin = 'STATED' | 'IMPLIED';              // IMPLIED = derived from an absolute target vs a base; never shown as management's %
export type GgOrganic = 'ORGANIC' | 'ACQUISITION_LED' | 'MIXED' | 'UNKNOWN';
export type GgQuality = 'HIGH' | 'MEDIUM' | 'LOW';               // quality of the EVIDENCE, not a stock score
export type GgValidity = 'ACTIVE' | 'SUPERSEDED' | 'ACHIEVED' | 'MISSED' | 'WITHDRAWN' | 'EXPIRED';
export type GgTracking = 'ON_TRACK' | 'EARLY' | 'ACCELERATION_REQUIRED' | 'AT_RISK' | 'BROKEN' | 'NOT_ASSESSED';
export type GgRevision = 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'WITHDRAWN' | 'EXCEEDED' | 'MISSED' | 'INITIAL';
export type GgOutcome = 'EXCEEDED' | 'ACHIEVED' | 'MISSED' | 'WITHDRAWN' | 'NOT_COMPARABLE' | 'PENDING';
export type GgExpectations = 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
export type GgInflection = 'EARLY_INFLECTION' | 'CONFIRMED_INFLECTION' | 'ACCELERATING_INFLECTION' | 'NO_EVIDENCE_YET';
export type GgMap2x2 = 'CONFIRMED_GROWTH' | 'FORWARD_LOOKING_EARLY' | 'POTENTIAL_UPSIDE_TO_GUIDANCE' | 'LOW_PRIORITY';
export type GgCapBand = 'MICRO' | 'SMALL' | 'MID' | 'LARGE' | 'UNKNOWN';
/** A–M catalyst types from the spec. */
export type GgCatalyst = 'A_DEMAND_EXPLOSION' | 'B_CAPACITY_EXPANSION' | 'C_CUSTOMER_RAMP' | 'D_MARKET_SHARE' | 'E_NEW_PRODUCT' | 'F_NEW_GEOGRAPHY'
  | 'G_PRICING_MIX' | 'H_OPERATING_LEVERAGE' | 'I_ACQUISITION' | 'J_BOTTLENECK' | 'K_REGULATORY_POLICY' | 'L_SPECIAL_SITUATION' | 'M_OTHER';
export type GgLeverage = 'OPERATING_LEVERAGE' | 'MARGIN_DILUTION' | 'PROPORTIONAL' | 'UNKNOWN';
export type GgRerating = 'EARNINGS_GROWTH_ONLY' | 'EARNINGS_PLUS_MARGIN' | 'EARNINGS_PLUS_DURATION' | 'EARNINGS_PLUS_EXPECTATIONS_RESET' | 'EARNINGS_PLUS_MARKET_EXPANSION' | 'UNKNOWN';
export type GgAlertLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type GgAlertKind = 'NEW_GUIDANCE' | 'GUIDANCE_RAISED' | 'GUIDANCE_CUT' | 'GUIDANCE_ACHIEVED' | 'GUIDANCE_BROKEN' | 'EARNINGS_CONFIRMATION' | 'CATALYST_CONFIRMATION' | 'SUPPORTING_EVIDENCE';
export type GgSort =
  | 'HIGHEST_REVENUE' | 'HIGHEST_PAT' | 'HIGHEST_COMBINED' | 'BIGGEST_INCREASE' | 'STRONGEST_EARNINGS' | 'LONGEST_DURATION'
  | 'STRONGEST_EVIDENCE' | 'EARLIEST_INFLECTION' | 'LARGEST_EXPECTATIONS_GAP' | 'PORTFOLIO_CHANGE' | 'DEFAULT';

export interface GgSourceRef {
  name: string;
  /** hierarchy rank: 1 regulatory filing … 12 social media (lower = stronger) */
  rank: number;
  type: string;                 // 'Exchange filing' | 'Earnings release' | 'Investor presentation' | 'Concall' | 'Annual report' | 'Media' | …
  date: string | null;
  url?: string;
  primary: boolean;
}

/** One normalised growth statement. */
export interface GgGuidancePoint {
  metric: GgMetric;
  kind: GgKind;
  /** growth %, range allowed (low===high for a point). Null when only an absolute target exists and no base is known. */
  growthLow: number | null;
  growthHigh: number | null;
  growthOrigin: GgGrowthOrigin;
  absoluteTarget?: { value: number; unit: string; currency?: string } | null;   // e.g. ₹10,000 Cr
  base?: { value: number; period: string } | null;                                // base used for IMPLIED growth
  period: string;               // 'FY27', 'CY27', 'Next 12 months', 'FY27–29'
  periodKind: GgPeriodKind;
  organic: GgOrganic;
  basis?: 'CONSOLIDATED' | 'STANDALONE' | 'UNSTATED';
  constantCurrency?: boolean;
  originalStatement: string;    // verbatim
  unit: string;                 // '%', '₹ Cr', '$M' …
  // ── additive (engine) ──
  /** The same statement's earlier figure when it gives one ('from 30%' / 'vs ₹600 crore earlier'). Used for revision, never as a base year. */
  prior?: { low: number; high: number; unit: string } | null;
  /** True when a multi-year 'double by FY29' style statement is a cumulative figure, not a yearly one. */
  cumulativeYears?: number | null;
  /** Wording such as 'around', 'at least', 'over', 'up to' — direction/range needs interpretation. */
  approx?: boolean;
  /** True when the source gives direction only ('strong growth'): growth is null, never translated to a number. */
  qualitative?: boolean;
}

export interface GgLedgerRow {
  date: string; period: string; metric: GgMetric;
  old: string | null; next: string; revision: GgRevision;
  source: string; reason: string; status: GgValidity;
  outcome?: GgOutcome;
}
export interface GgCredibility {
  cycles: number; raised: number; maintained: number; cut: number; achieved: number; exceeded: number; missed: number;
  avgBeatPct: number | null; avgMissPct: number | null;
  line: string;                 // factual sentence e.g. 'Last 6 guidance cycles: 4 achieved/exceeded, 1 maintained, 1 reduced'
}

export interface GgChainStep { step: 'DRIVER' | 'COMPANY_RESPONSE' | 'CAPACITY_DEMAND' | 'REVENUE' | 'MARGIN' | 'PAT_EPS' | 'FCF'; status: 'PROVEN' | 'PARTIALLY_PROVEN' | 'ASSUMED' | 'UNKNOWN'; text: string }

export interface GgReality {
  fyActualRevenue: number | null; guidedGrowthPct: number | null; impliedRevenue: number | null;
  latestQuarterGrowthPct: number | null; latestAnnualGrowthPct: number | null; ttmRevenue: number | null;
  requiredGrowthFromRunRate: number | null;
  unit?: string;
  tracking: GgTracking; trackingWhy: string;
  quarterlyTimingNote: string;  // 'Quarterly timing cannot be reliably inferred from available evidence.' unless inferable
}
export interface GgEarnings {
  revenueGrowthPct: number | null; patGrowthPct: number | null; epsGrowthPct: number | null; ebitdaGrowthPct: number | null;
  opmFrom: number | null; opmTo: number | null; cfoToPat: number | null; fcf: number | null;
  inflection: GgInflection; leverage: GgLeverage; leverageNote: string;
}
export interface GgValuation {
  marketCap: number | null; pe: number | null; evEbitda: number | null; priceToSales: number | null; fcfYield: number | null; peg: number | null;
  embeddedGrowthNote: string; ifAchievedNote: string; rerating: GgRerating;
}
export interface GgSurprise { guidancePct: number | null; actualPct: number | null; consensusPct: number | null }
export interface GgConflict { primary: string; other: string; note: string }

export interface GgCompany {
  id: string;                   // stable hash(market+ticker+metric+period)
  ticker: string; company: string; market: GgMarket;
  /** false when the company has no resolved ticker (ticker is ''). Show the company name and 'ticker not resolved'. */
  tickerResolved?: boolean;
  capBand: GgCapBand; marketCap: number | null;
  primary: GgGuidancePoint;     // the headline point (revenue preferred)
  others: GgGuidancePoint[];    // PAT / EPS / EBITDA / FCF points when stated
  verification: GgVerification;
  quality: GgQuality;
  validity: GgValidity;
  sources: GgSourceRef[];
  conflict: GgConflict | null;
  driverText: string;           // WHY is management guiding this growth (mechanism, not 'management expects 60%')
  mechanisms: string[];         // 'capacity expansion', 'order book', …
  catalysts: GgCatalyst[];      // primary first
  chain: GgChainStep[];
  guidanceDuration: string;     // 'FY27' | 'FY27–28' | '2–3 years' …
  structuralDuration: string;   // 'Multi-year' | 'Not established' …
  history: GgLedgerRow[];
  revision: GgRevision;
  trend: 'ACCELERATION' | 'DETERIORATION' | 'FLAT' | 'NONE';   // e.g. 40→50→60 = ACCELERATION
  trendText: string | null;
  credibility: GgCredibility | null;
  surprise: GgSurprise | null;
  reality: GgReality | null;
  earnings: GgEarnings | null;
  map2x2: GgMap2x2;
  expectations: GgExpectations; expectationsWhy: string;
  valuation: GgValuation | null;
  nextProof: string;            // never generic 'monitor'
  breakers: string[];
  links: { bottleneck?: boolean; bottleneckThemes?: string[]; specialSituation?: boolean; radarEligible: boolean; radarWhy: string; concall?: boolean; newsIds?: string[] };
  organicNote: string;          // 'FY27 +50% revenue — Organic component: unknown'
  corporateActionGrowth: boolean;
  portfolio: { held: boolean } ;
  announcedAt: string | null;
  lastEvidenceAt: string | null;
  isNewToday: boolean;
  /** Additive: how much independent evidence sits behind the headline point. Syndicated copies are not corroboration. */
  evidence?: { independentSources: number; syndicatedCopies: number; primaryCount: number; note: string };
  /** Additive: size of the latest revision in percentage points (or % for absolute targets); null when INITIAL/unknown. */
  revisionPp?: number | null;
  /** Additive: supporting order/capacity evidence seen for this ticker without a growth number. */
  supporting?: string[];
  alert: { level: GgAlertLevel; kind: GgAlertKind; text: string } | null;
}

export interface GgScanSource { name: string; state: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NOT_RUN'; scanned: number; detail: string }
export interface GgResponse {
  asOf: string;
  threshold: number;            // % revenue growth
  metric: GgMetric;
  companies: GgCompany[];       // verified + partially verified, ≥ threshold, per filters
  discovery: GgCompany[];       // SECONDARY_ONLY / UNVERIFIED candidates (separate bucket)
  newToday: Array<{ id: string; ticker: string; company: string; text: string; kind: GgAlertKind; level: GgAlertLevel }>;
  counts: { universe: number; verified: number; partially: number; discovery: number; newToday: number; byMarket: { IN: number; US: number } };
  scan: { complete: boolean; note: string; sources: GgScanSource[]; lastScanAt: string };
  note?: string;
}

export const KIND_LABEL: Record<GgKind, string> = {
  MANAGEMENT_GUIDANCE: 'Management guidance', MANAGEMENT_TARGET: 'Management target', MANAGEMENT_COMMENTARY: 'Management commentary',
  ANALYST_CONSENSUS: 'Analyst consensus', ANALYST_ESTIMATE: 'Analyst estimate', HISTORICAL_TRAJECTORY: 'Company historical trajectory', INFERENCE: 'Inference (system-derived)',
};
export const VERIFICATION_LABEL: Record<GgVerification, string> = { VERIFIED: 'Verified', PARTIALLY_VERIFIED: 'Partially verified', SECONDARY_ONLY: 'Secondary only', UNVERIFIED: 'Unverified' };
export const TRACKING_LABEL: Record<GgTracking, string> = {
  ON_TRACK: 'On track', EARLY: 'Early', ACCELERATION_REQUIRED: 'Acceleration required', AT_RISK: 'At risk', BROKEN: 'Broken', NOT_ASSESSED: 'Not assessed',
};
export const CATALYST_LABEL: Record<GgCatalyst, string> = {
  A_DEMAND_EXPLOSION: 'Demand explosion', B_CAPACITY_EXPANSION: 'Capacity expansion', C_CUSTOMER_RAMP: 'Customer ramp', D_MARKET_SHARE: 'Market share gain',
  E_NEW_PRODUCT: 'New product', F_NEW_GEOGRAPHY: 'New geography', G_PRICING_MIX: 'Pricing / mix', H_OPERATING_LEVERAGE: 'Operating leverage',
  I_ACQUISITION: 'Acquisition', J_BOTTLENECK: 'Bottleneck / supply constraint', K_REGULATORY_POLICY: 'Regulatory / policy', L_SPECIAL_SITUATION: 'Special situation', M_OTHER: 'Other',
};
export const THRESHOLDS = [20, 25, 30, 40, 50, 75, 100] as const;
