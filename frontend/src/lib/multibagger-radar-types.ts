// zzz841 — Multibagger / Structural Inflection Radar: the shared contract.
// Pure types + small constants. The engine (multibagger-radar.ts) produces
// these; the Special Situations "Multibagger Radar" tab, the thesis ledger and
// the portfolio catalyst monitor consume them.
//
// RULES (all of them apply to every file that touches this contract):
//  * PRICE IS NEVER AN INPUT to bucket, priority, duration, evidence or link.
//    (A one-day move, volume spike, analyst target or social buzz never creates
//    a candidate. Technical context is separate and only says WHEN, never WHY.)
//  * UNKNOWN != NEGATIVE. A missing fact is 'unknown' / 'NOT_ASSESSED', never 0.
//  * A HYPOTHESIS never looks like a CONFIRMED (different label AND colour).
//  * No BUY / SELL / TARGET language. Research priority is not a recommendation.
//  * No visible 0-100 score anywhere. Categories and reasons only.
//  * Nothing is invented: every chain step is 'proven' (a source states it),
//    'assumed' (mechanism reasoning, no source yet) or 'unknown'.

export type RadarBucket =
  | 'MULTIBAGGER'          // long-duration structural opportunities
  | 'EARNINGS_INFLECTION'  // 12-24 month earnings acceleration
  | 'BOTTLENECK'           // supply-constrained opportunities
  | 'SPECIAL_SITUATION'    // corporate actions (spin-off, M&A, buyback, open offer...)
  | 'EVENT_DRIVEN'         // shorter-duration events
  | 'TECHNICAL'            // timing information only
  | 'NOISE';               // nothing that changes earnings power

export const BUCKET_LABEL: Record<RadarBucket, string> = {
  MULTIBAGGER: 'Multibagger / structural', EARNINGS_INFLECTION: 'Earnings inflection', BOTTLENECK: 'Bottleneck',
  SPECIAL_SITUATION: 'Special situations', EVENT_DRIVEN: 'Event-driven', TECHNICAL: 'Technical confirmation', NOISE: 'No earnings link',
};
/** Buckets are never merged into one leaderboard. This is the display order. */
export const BUCKET_ORDER: RadarBucket[] = ['MULTIBAGGER', 'EARNINGS_INFLECTION', 'BOTTLENECK', 'SPECIAL_SITUATION', 'EVENT_DRIVEN', 'TECHNICAL', 'NOISE'];

export type CatalystKind =
  | 'OPERATING_INFLECTION' | 'DEMAND_EXPLOSION' | 'BOTTLENECK' | 'CAPACITY_INFLECTION' | 'CUSTOMER_QUALIFICATION'
  | 'NEW_PRODUCT_MARKET' | 'SUPPLY_DEMAND_INFLECTION' | 'SPECIAL_SITUATION' | 'EARNINGS_RESULT' | 'OTHER';

export const KIND_LABEL: Record<CatalystKind, string> = {
  OPERATING_INFLECTION: 'Operating inflection', DEMAND_EXPLOSION: 'Demand explosion', BOTTLENECK: 'Structural bottleneck',
  CAPACITY_INFLECTION: 'Capacity / utilisation inflection', CUSTOMER_QUALIFICATION: 'Customer qualification / design win',
  NEW_PRODUCT_MARKET: 'New product / new market', SUPPLY_DEMAND_INFLECTION: 'Supply-demand inflection',
  SPECIAL_SITUATION: 'Special situation', EARNINGS_RESULT: 'Earnings result', OTHER: 'Other event',
};

/** 0 one-time · 1 one quarter · 2 two-three quarters · 3 four-eight quarters · 4 two-five years · 5 potentially transformational. */
export type DurationCode = 0 | 1 | 2 | 3 | 4 | 5;
export const DURATION_LABEL: Record<DurationCode, string> = {
  0: 'One-time', 1: 'About 1 quarter', 2: '2-3 quarters', 3: '4-8 quarters', 4: '2-5 years (structural)', 5: 'Potentially transformational',
};
export interface DurationRead {
  /** Null = not established (never guessed to be 0). */
  code: DurationCode | null;
  label: string;
  /** 'stated' = a term / programme / capacity period in the source; 'type' = only the kind of event; 'none'. */
  basis: 'stated' | 'type' | 'none';
  /** The underlying evidence, in words. */
  evidence: string;
}

export type EvidenceStatus = 'CONFIRMED' | 'STRONG' | 'DEVELOPING' | 'HYPOTHESIS' | 'DISPROVED';
export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  CONFIRMED: 'Confirmed', STRONG: 'Strong', DEVELOPING: 'Developing', HYPOTHESIS: 'Hypothesis', DISPROVED: 'Disproved',
};
export interface EvidenceRead {
  status: EvidenceStatus;
  /** Best source in the spec hierarchy: 1 SEC/exchange filing ... 13 social media (lower number = better). */
  sourceRank: number | null;
  sourceLabel: string;
  /** Why this status, in words (what proves it, what link is still unproven). */
  why: string;
  /** Number of independent sources behind it. */
  independentSources: number;
}

export type LinkStrength = 'DIRECT' | 'NEAR_DIRECT' | 'INDIRECT' | 'NARRATIVE_ONLY';
export const LINK_LABEL: Record<LinkStrength, string> = {
  DIRECT: 'Direct - affects revenue / profit', NEAR_DIRECT: 'Near-direct - one clear step', INDIRECT: 'Indirect - several assumptions', NARRATIVE_ONLY: 'Narrative only - no measurable transmission yet',
};

export type InflectionState = 'NO_INFLECTION' | 'EARLY_INFLECTION' | 'CONFIRMED_INFLECTION' | 'ACCELERATING_INFLECTION' | 'STRUCTURAL_INFLECTION' | 'NOT_ASSESSED';
export const INFLECTION_LABEL: Record<InflectionState, string> = {
  NO_INFLECTION: 'No inflection', EARLY_INFLECTION: 'Early inflection', CONFIRMED_INFLECTION: 'Confirmed inflection',
  ACCELERATING_INFLECTION: 'Accelerating inflection', STRUCTURAL_INFLECTION: 'Structural inflection', NOT_ASSESSED: 'Not assessed (no result data)',
};

export type ResearchPriority = 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
export const PRIORITY_LABEL: Record<ResearchPriority, string> = { VERY_HIGH: 'Very high', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

export type ChainStatus = 'proven' | 'assumed' | 'unknown';
export interface ChainStep { step: string; status: ChainStatus; text: string }

export interface ProofPoint {
  /** Specific future evidence to look for, never just "monitor". */
  what: string;
  /** When it should show up, in words ("next quarterly result", "first shipments"), or null when not stated. */
  when: string | null;
  kind: 'result' | 'production' | 'utilisation' | 'shipment' | 'qualification' | 'backlog' | 'margin' | 'order' | 'commissioning' | 'approval' | 'contract' | 'closing' | 'filing';
}

export type GovernanceStatus = 'CLEAR' | 'FLAGGED' | 'NOT_CHECKED';
export interface GovernanceRead {
  /** NOT_CHECKED when no governance data exists for the name: unknown, never "clear". */
  status: GovernanceStatus;
  flags: string[];
  note: string;
}

export interface ExpectationsRead {
  /** Fundamentals vs what the market already expects. NOT_ASSESSED unless both sides have data. */
  state: 'ALREADY_EXPECTED' | 'LOW_EXPECTATIONS' | 'EARLY_STAGE' | 'NOT_ASSESSED';
  note: string;
}

export interface TechnicalContext {
  /** Timing only. Never used to rank. Null when no technical data was supplied. */
  note: string | null;
}

export interface RadarItem {
  id: string;
  ticker: string | null;
  company: string;
  region: 'IN' | 'US' | 'GLOBAL';
  bucket: RadarBucket;
  kind: CatalystKind;
  /** QUESTION A - what happened, in the source's own words. */
  event: string;
  /** QUESTION B - why it matters: which financial variables it can change. */
  whyItMatters: string;
  /** The financial variables it can move (revenue, volume, ASP, mix, margin, utilisation, FCF, ROCE, share, TAM ...). */
  changes: string[];
  mechanism: string;
  financialImpact: string;
  duration: DurationRead;
  evidence: EvidenceRead;
  link: LinkStrength;
  inflection: InflectionState;
  /** Good quarter vs new earnings regime, in words (optional, added by the engine). */
  regimeNote?: string;
  chain: ChainStep[];
  /** The step number (0-based) up to which the chain is proven; -1 = nothing proven. */
  provenThrough: number;
  bottleneckQuestion: string | null;   // "Why can't competitors immediately supply this demand?" - only for bottleneck-type
  proof: ProofPoint;
  breakConditions: string[];
  expectations: ExpectationsRead;
  valuationContext: string;            // what has to happen for the current valuation to make sense - or 'not assessed'
  technical: TechnicalContext;
  governance: GovernanceRead;
  /** Shared-driver tags (e.g. 'AI infrastructure', 'Defence', 'Grid / power'), used for concentration and correlation. */
  drivers: string[];
  priority: ResearchPriority;
  /** Why this priority - the sentence the owner reads. */
  priorityReason: string;
  /** True when the rules found not enough for a serious candidate (shown greyed, in NOISE / low). */
  lowSignal: boolean;
  sourceUrl: string | null;
  publishedAt: string | null;
  /** The raw feed event id this came from, for cross-links to the existing Special Situations card. */
  feedEventId: string | null;
}

// ── Thesis ledger ──────────────────────────────────────────────────────
export type ThesisStatus = 'INTACT' | 'STRENGTHENING' | 'EARLY' | 'WEAKENING' | 'BROKEN' | 'NO_MATERIAL_CHANGE';
export const THESIS_STATUS_LABEL: Record<ThesisStatus, string> = {
  INTACT: 'Intact', STRENGTHENING: 'Strengthening', EARLY: 'Early', WEAKENING: 'Weakening', BROKEN: 'Broken', NO_MATERIAL_CHANGE: 'No material change',
};
export interface LedgerEntry {
  id: string;                 // ticker + catalyst key
  ticker: string;
  company: string;
  thesis: string;
  dateIdentified: string;     // ISO date
  catalyst: string;
  whyNow: string;
  mechanism: string;
  evidence: string;
  assumptions: string;
  whatMustHappen: string;
  nextProofPoint: string;
  whatWouldConfirm: string;
  whatWouldWeaken: string;
  whatWouldBreak: string;
  catalystDuration: string;
  earningsLink: string;
  managementCommentary: string;
  valuationContext: string;
  technicalContext: string;
  lastReview: string | null;
  status: ThesisStatus;
  /** Free-text log of status changes: {date, from, to, reason}. Price movement alone never changes status. */
  history: Array<{ date: string; from: ThesisStatus; to: ThesisStatus; reason: string }>;
  /** Snapshot of the radar item when the owner approved it (human approval before it enters the ledger). */
  fromRadarId: string | null;
}

export type PortfolioTag = 'CORE' | 'SATELLITE' | 'WATCH' | 'THESIS_AT_RISK' | 'CATALYST_DEVELOPING' | 'CATALYST_CONFIRMED';
export const PORTFOLIO_TAG_LABEL: Record<PortfolioTag, string> = {
  CORE: 'Core', SATELLITE: 'Satellite', WATCH: 'Watch', THESIS_AT_RISK: 'Thesis at risk', CATALYST_DEVELOPING: 'Catalyst developing', CATALYST_CONFIRMED: 'Catalyst confirmed',
};

/** The ten portfolio-monitor questions. Each answer is a sentence or 'Not established'. Never "did the stock go up". */
export interface MonitorAnswers {
  originalCatalystProgressed: string; evidenceStrengthened: string; earningsConversionBegun: string; opportunityIncreased: string;
  bottleneckStrengthened: string; managementExecuted: string; customerAdoptionIncreased: string; thesisWeakened: string;
  valuationAheadOfFundamentals: string; nextProofPoint: string;
}

export interface SharedDriverGroup { driver: string; tickers: string[]; note: string }
