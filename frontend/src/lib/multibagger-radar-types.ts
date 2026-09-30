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
  | 'NOISE'               // nothing that changes earnings power
  | 'CORPORATE_ACTION';   // dividend / split / bonus / record date: low-signal quarantine, never a thesis candidate

export const BUCKET_LABEL: Record<RadarBucket, string> = {
  MULTIBAGGER: 'Multibagger / structural', EARNINGS_INFLECTION: 'Earnings inflection', BOTTLENECK: 'Bottleneck',
  SPECIAL_SITUATION: 'Special situations', EVENT_DRIVEN: 'Event-driven', TECHNICAL: 'Technical confirmation', NOISE: 'No earnings link',
  CORPORATE_ACTION: 'Corporate actions (low signal)',
};
/** Buckets are never merged into one leaderboard. This is the display order. */
export const BUCKET_ORDER: RadarBucket[] = ['MULTIBAGGER', 'EARNINGS_INFLECTION', 'BOTTLENECK', 'SPECIAL_SITUATION', 'EVENT_DRIVEN', 'TECHNICAL', 'NOISE', 'CORPORATE_ACTION'];

export type CatalystKind =
  // structural / operating
  | 'OPERATING_INFLECTION' | 'DEMAND_EXPLOSION' | 'BOTTLENECK' | 'CAPACITY_INFLECTION' | 'CUSTOMER_QUALIFICATION'
  | 'NEW_PRODUCT_MARKET' | 'SUPPLY_DEMAND_INFLECTION' | 'SPECIAL_SITUATION' | 'EARNINGS_RESULT' | 'OTHER'
  | 'MARGIN_INFLECTION' | 'FCF_INFLECTION' | 'MARKET_SHARE_INFLECTION' | 'REGULATORY_DEMAND_INFLECTION' | 'PRICING_POWER_INFLECTION'
  // special-situation subtypes (used as RadarItem.subKind / secondaryKind; the primary kind stays SPECIAL_SITUATION)
  | 'SPIN_DEMERGER' | 'MERGER' | 'ACQUISITION' | 'DIVESTITURE' | 'GOING_PRIVATE' | 'TENDER_OFFER' | 'BUYBACK' | 'RIGHTS_ISSUE'
  | 'RESTRUCTURING' | 'ASSET_SALE' | 'CAPITAL_REORG'
  // event-driven
  | 'CONTRACT_ORDER' | 'REGULATORY_DECISION' | 'LEGAL_DECISION' | 'FINANCING' | 'CAPITAL_RAISE' | 'MANAGEMENT_CHANGE' | 'OTHER_MATERIAL_EVENT'
  // non-investment signals (quarantined: never a thesis candidate)
  | 'CORPORATE_ACTION' | 'PRICE_MOVE' | 'ANALYST_CHANGE' | 'MEDIA_NARRATIVE' | 'SECTOR_COMMENTARY' | 'DISPROVED_RUMOUR';

export const KIND_LABEL: Record<CatalystKind, string> = {
  OPERATING_INFLECTION: 'Operating inflection', DEMAND_EXPLOSION: 'Demand explosion', BOTTLENECK: 'Structural bottleneck',
  CAPACITY_INFLECTION: 'Capacity / utilisation inflection', CUSTOMER_QUALIFICATION: 'Customer qualification / design win',
  NEW_PRODUCT_MARKET: 'New product / new market', SUPPLY_DEMAND_INFLECTION: 'Supply-demand inflection',
  SPECIAL_SITUATION: 'Special situation', EARNINGS_RESULT: 'Earnings result', OTHER: 'Other event',
  MARGIN_INFLECTION: 'Margin inflection', FCF_INFLECTION: 'Free cash flow inflection', MARKET_SHARE_INFLECTION: 'Market share inflection',
  REGULATORY_DEMAND_INFLECTION: 'Regulation-driven demand', PRICING_POWER_INFLECTION: 'Pricing power inflection',
  SPIN_DEMERGER: 'Spin-off / demerger', MERGER: 'Merger', ACQUISITION: 'Acquisition', DIVESTITURE: 'Divestiture', GOING_PRIVATE: 'Going private / delisting',
  TENDER_OFFER: 'Tender / open offer', BUYBACK: 'Buyback', RIGHTS_ISSUE: 'Rights issue', RESTRUCTURING: 'Restructuring', ASSET_SALE: 'Asset sale', CAPITAL_REORG: 'Capital reorganisation',
  CONTRACT_ORDER: 'Contract / order', REGULATORY_DECISION: 'Regulatory decision', LEGAL_DECISION: 'Legal decision', FINANCING: 'Financing (debt)',
  CAPITAL_RAISE: 'Capital raise / funding', MANAGEMENT_CHANGE: 'Management change', OTHER_MATERIAL_EVENT: 'Other material event',
  CORPORATE_ACTION: 'Corporate action (dividend / split / bonus)', PRICE_MOVE: 'Price response', ANALYST_CHANGE: 'Analyst rating change',
  MEDIA_NARRATIVE: 'Media narrative', SECTOR_COMMENTARY: 'Sector commentary', DISPROVED_RUMOUR: 'Disproved rumour',
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
  /** Where the term comes from. Never 'inferred from event type': no evidence means code null + 'unknown'. */
  duration_source?: DurationSource;
  durationConfidence?: Confidence;
  /** True only for historical / structural inference (never a bare event type). */
  inferred?: boolean;
  /** Half-life class, set only when a duration is established by evidence. */
  halfLife?: HalfLife | null;
}
export type DurationSource = 'company-stated' | 'contract-stated' | 'filing-stated' | 'project-timeline' | 'historical-inference' | 'structural-inference' | 'unknown';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
/** SHORT (<2q) / MEDIUM (2-4q) / LONG (4-8q) / STRUCTURAL (2-5y) / TRANSFORMATIONAL. */
export type HalfLife = 'SHORT' | 'MEDIUM' | 'LONG' | 'STRUCTURAL' | 'TRANSFORMATIONAL';

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
  /** Number of DISTINCT sources behind it after syndicated / near-identical copies are removed. */
  independentSources: number;
  /** Raw article / filing count before de-duplication (a count is not independence). */
  sourceCount?: number;
  /** Quality of the best source, separate from how many there are. */
  sourceQuality?: SourceQuality;
  /** Which kinds of source back it. */
  sourceDiversity?: SourceDiversity[];
  /** Syndicated or near-identical copies that were removed from the count. */
  duplicatesRemoved?: number;
}
export type SourceQuality = 'PRIMARY' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type SourceDiversity = 'PRIMARY' | 'COMPANY' | 'CUSTOMER' | 'GOVERNMENT' | 'INDEPENDENT_INDUSTRY' | 'FINANCIAL_MEDIA' | 'SYNDICATED' | 'ANALYST' | 'SOCIAL';

export type LinkStrength = 'DIRECT' | 'NEAR_DIRECT' | 'INDIRECT' | 'NARRATIVE_ONLY' | 'NOT_ESTABLISHED';
export const LINK_LABEL: Record<LinkStrength, string> = {
  DIRECT: 'Direct - affects revenue / profit', NEAR_DIRECT: 'Near-direct - one clear step', INDIRECT: 'Indirect - several assumptions', NARRATIVE_ONLY: 'Narrative only - no measurable transmission yet',
  NOT_ESTABLISHED: 'Not established - no earnings link shown',
};

export type InflectionState = 'NO_INFLECTION' | 'EARLY_INFLECTION' | 'CONFIRMED_INFLECTION' | 'ACCELERATING_INFLECTION' | 'STRUCTURAL_INFLECTION' | 'NOT_ASSESSED';
export const INFLECTION_LABEL: Record<InflectionState, string> = {
  NO_INFLECTION: 'No inflection', EARLY_INFLECTION: 'Early inflection', CONFIRMED_INFLECTION: 'Confirmed inflection',
  ACCELERATING_INFLECTION: 'Accelerating inflection', STRUCTURAL_INFLECTION: 'Structural inflection', NOT_ASSESSED: 'Not assessed (no result data)',
};

/** EXCLUDE = no company-specific mechanism at all (quarantined signal, never a candidate). */
export type ResearchPriority = 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'EXCLUDE';
export const PRIORITY_LABEL: Record<ResearchPriority, string> = { VERY_HIGH: 'Very high', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', EXCLUDE: 'Exclude (no company mechanism)' };

export type ChainStatus = 'proven' | 'assumed' | 'unknown';
export interface ChainStep {
  step: string; status: ChainStatus; text: string;
  /** Added fields (optional): who says so, when, how sure. */
  source?: string | null; date?: string | null; confidence?: Confidence;
}

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
  /** Plain label pairing fundamentals with expectations; only when both sides have data. */
  label?: ExpectationsLabel;
}
export type ExpectationsLabel = 'LOW EXPECTATION/DEVELOPING FUNDAMENTALS' | 'IMPROVING FUNDAMENTALS/HIGH EXPECTATION' | 'STRONG FUNDAMENTALS/ALREADY REFLECTED' | 'EXPECTATION DATA INSUFFICIENT';

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

  // ── additive intelligence fields (all optional so older consumers keep compiling) ──
  /** Parsed class of the event, decided before the kind. */
  eventClass?: EventClass;
  /** Special-situation subtype (MERGER, BUYBACK, ...) when kind is SPECIAL_SITUATION. */
  subKind?: CatalystKind | null;
  secondaryKind?: CatalystKind | null;
  /** True only when evidence shows earnings power / capital efficiency / TAM / competitive position / asset quality / cash generation changes. */
  structuralBridge?: { created: boolean; basis: string | null };
  /** Catalyst chain with link-level status (13 links). The older `chain` stays for compatibility. */
  catalystChain?: CatalystLink[];
  /** Three separate confirmations - never one 'Confirmed' badge. */
  eventConfirmation?: EventConfirmation;
  mechanismStatus?: MechanismStatus;
  earningsImpactStatus?: EarningsImpactStatus;
  /** One plain headline that says what is and is not confirmed. */
  confirmationLabel?: string;
  evidenceScope?: { confirmed: string[]; notConfirmed: string[] };
  /** Strict transmission class (same scale as `link`, recomputed with the strict definitions). */
  financialTransmission?: LinkStrength;
  quantificationStatus?: QuantificationStatus;
  /** Per-variable impact: a stated value, 'Not quantified' (link exists, no number) or 'Not established' (no link). */
  impacts?: ImpactMap;
  catalystMaturity?: CatalystMaturity | null;
  /** 0 (broken) to 7 (mature); a position on the maturity ladder, not a score of quality. */
  catalystProgression?: number;
  evidenceDelta?: EvidenceDelta;
  indicator?: { type: IndicatorType | null; label: string };
  catalystMateriality?: Materiality;
  materialityNote?: string;
  counterfactual?: { without: string; withSuccess: string } | null;
  whyNotHigher?: string[];
  upgradeTrigger?: string | null;
  downgradeTrigger?: string | null;
  /** 'If X happens, Y should change because Z' - null when it cannot be made specific. */
  oneSentenceMechanism?: string | null;
  mechanismSpecific?: boolean;
  thesisIntegrity?: ThesisIntegrity;
  falsePositiveReason?: FalsePositiveReason | null;
  /** zzz847: why the item was quarantined (kept out of every thesis bucket), or null/absent when it is a normal item. */
  quarantineReason?: QuarantineReason | null;
  ledgerEligible?: boolean;
  ledgerBlockers?: string[];
  /** The weakest link of the catalyst chain that is still unproven (drives the next proof). */
  weakestUnprovenLink?: string | null;
  firstDiscovered?: string | null;
  firstPrimaryConfirmation?: string | null;
  firstFinancialConfirmation?: string | null;
  firstMaterialEarningsImpact?: string | null;
  /** Share-price reaction. Kept apart from every fundamental field: price can never populate a fundamental-impact field. */
  priceResponse?: PriceResponse | null;
  /** Optional, only when supplied by the caller. Context, never a prediction. */
  historicalAnalogue?: HistoricalAnalogue | null;
}

export type EventClass =
  | 'OPERATING' | 'RESULT' | 'ORDER' | 'CAPITAL_STRUCTURE_FUNDING' | 'REGULATORY_LEGAL' | 'CORPORATE_TRANSACTION'
  | 'CORPORATE_ACTION' | 'DISPROVED_RUMOUR' | 'PRICE_RESPONSE' | 'ANALYST' | 'NARRATIVE' | 'SECTOR_COMMENTARY' | 'TECHNICAL' | 'UNCLASSIFIED';

export type LinkStatus = 'PROVEN' | 'PARTIALLY_PROVEN' | 'ASSUMED' | 'CONTRADICTED' | 'NOT_APPLICABLE';
export type CatalystLinkKey =
  | 'EVENT' | 'DRIVER' | 'BOTTLENECK' | 'COMPANY_ADVANTAGE' | 'CAPACITY' | 'VOLUME' | 'REVENUE' | 'MARGIN' | 'EBITDA' | 'FCF' | 'EARNINGS' | 'EXPECTATIONS' | 'VALUATION';
export interface CatalystLink {
  link: CatalystLinkKey;
  status: LinkStatus;
  evidence: string | null;
  source: string | null;
  date: string | null;
  confidence: Confidence;
}
export type EventConfirmation = 'CONFIRMED' | 'REPORTED' | 'PLANNED' | 'DISPROVED' | 'NOT_APPLICABLE';
export type MechanismStatus = 'STATED' | 'PARTIALLY_STATED' | 'ASSUMED' | 'NOT_ESTABLISHED' | 'CONTRADICTED';
export type EarningsImpactStatus = 'CONFIRMED' | 'PARTIALLY_PROVEN' | 'UNPROVEN' | 'NOT_ESTABLISHED' | 'CONTRADICTED';
export type QuantificationStatus = 'QUANTIFIED' | 'PARTIALLY_QUANTIFIED' | 'NOT_QUANTIFIED' | 'NO_FINANCIAL_LINK';
export interface ImpactMap { revenue: string; volume: string; asp: string; margin: string; ebitda: string; fcf: string; roce: string; marketShare: string }
export type CatalystMaturity = 'DISCOVERY' | 'VALIDATED' | 'DEVELOPING' | 'FINANCIALLY_VISIBLE' | 'CONFIRMED' | 'ACCELERATING' | 'MATURE' | 'BROKEN';
export type EvidenceDelta =
  | 'NEW_EVIDENCE' | 'STRENGTHENED' | 'UNCHANGED' | 'WEAKENED' | 'CONTRADICTED' | 'RESOLVED'
  | 'FIRST_FINANCIAL_CONFIRMATION' | 'FIRST_COMMERCIAL_CONFIRMATION' | 'DEVELOPING';
export type IndicatorType = 'LEADING' | 'INTERMEDIATE' | 'LAGGING';
export type Materiality = 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';
export type QuarantineReason = 'REGISTRATION' | 'PRICE_ARTICLE' | 'PREVIEW' | 'ANALYST_TARGET' | 'OPINION' | 'NON_CORPORATE' | 'UNIDENTIFIED';
export type FalsePositiveReason =
  | 'PRICE_ONLY' | 'CORPORATE_ACTION_ONLY' | 'NARRATIVE_ONLY' | 'INSUFFICIENT_EVIDENCE' | 'WRONG_CLASSIFICATION'
  | 'NO_EARNINGS_TRANSMISSION' | 'DURATION_UNSUPPORTED' | 'IMMATERIAL' | 'DUPLICATED_SOURCE' | 'THESIS_CONTRADICTED';
export type IntegrityCode =
  | 'PRICE_USED_AS_EARNINGS_EVIDENCE' | 'DURATION_INFERRED_WITHOUT_DISCLOSURE' | 'KIND_MISMATCHED_TO_EVENT' | 'LINK_CONTRADICTS_MECHANISM'
  | 'MEDIA_ONLY_WHEN_PRIMARY_EXISTS' | 'SOURCE_COUNT_MISTAKEN_FOR_INDEPENDENCE' | 'NO_COMPANY_SPECIFIC_MECHANISM' | 'NO_NEXT_PROOF'
  | 'NO_BREAK_CONDITION' | 'MATERIALITY_UNKNOWN_SHOWN_HIGH' | 'EVENT_CONFIRMATION_CONFUSED_WITH_THESIS';
export interface ThesisIntegrity {
  passed: boolean;
  failedChecks: Array<{ code: IntegrityCode; why: string }>;
  /** NONE = no change; DOWNGRADED = priority lowered; REJECTED = forced to the lowest level and kept out of the ledger. */
  action: 'NONE' | 'DOWNGRADED' | 'REJECTED';
}
export interface PriceResponse { text: string; pct: number | null; direction: 'UP' | 'DOWN' | null; note: string }
export interface HistoricalAnalogue { label: 'HISTORICAL ANALOGUE'; text: string; note: string }

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

  // ── additive (Phase 3). Optional so older constructors compile; validateEntry always fills them on read. ──
  /** Append-only thesis versions: v1 initial, v2 evidence update, v3 financial confirmation ... Never edited in place. */
  versions?: ThesisVersion[];
  /** ISO dates; null = not yet / unknown. */
  firstDiscovered?: string | null;
  firstPrimaryConfirmation?: string | null;
  firstFinancialConfirmation?: string | null;
  firstMaterialEarningsImpact?: string | null;
  upgradeCondition?: string;
  downgradeCondition?: string;
  /** Filled when status becomes BROKEN. */
  postMortem?: PostMortem | null;
}

export interface ThesisVersion {
  version: number;
  date: string;
  thesis: string;
  catalystMaturity: CatalystMaturity | null;
  evidenceStatus: EvidenceStatus | null;
  whatChanged: string;
  statusChange: { from: ThesisStatus | null; to: ThesisStatus };
  reason: string;
  evidenceRefs: string[];
}

export interface PostMortem {
  originalCatalyst: string;
  evidenceLevel: string;
  expectedMechanism: string;
  failurePoint: string;
  actualOutcome: string;
  detectionFailureWhy: string;
  misclassified?: boolean;
  durationOverstated?: boolean;
  transmissionAssumed?: boolean;
  expectationsMisread?: boolean;
  falsePositiveReason?: FalsePositiveReason | null;
  date?: string;
}

export interface ChangeLogRow { date: string; change: string; evidence: string; impact: string }

/** Portfolio monitor read against the ORIGINAL thesis. Status comes from evidence delta / maturity only, never from price. */
export interface ThesisMonitor {
  status: ThesisStatus;
  statusReason: string;
  originalThesis: string;
  originalCatalystProgressed: string;
  leadingIndicators: string;
  financialConversion: string;
  managementExecution: string;
  customerAdoption: string;
  capacity: string;
  margin: string;
  fcf: string;
  valuation: string;
  failureConditions: string;
  nextProofPoint: string;
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
