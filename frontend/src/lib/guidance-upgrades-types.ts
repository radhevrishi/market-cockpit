// zzz843 — GUIDANCE UPGRADES: shared contract. Types only, no logic.
// Rules: never invent numbers (missing = null + 'DATA UNAVAILABLE'), unknown ≠ negative,
// silence never passes, price is context never the thesis, no BUY/SELL wording except the
// four Cockpit decisions below, no visible 0–100 scores.

export type GuMarket = 'IN' | 'US' | 'GLOBAL';
export type GuSourceTier = 'PRIMARY' | 'SECONDARY' | 'DISCOVERY';   // filing/release/deck/transcript · Reuters etc · Yahoo/blogs/social
export type GuMetric =
  | 'REVENUE' | 'REVENUE_GROWTH' | 'EBITDA' | 'EBIT' | 'OP_MARGIN' | 'EPS' | 'ADJ_EPS' | 'FCF' | 'FCF_CONVERSION'
  | 'ORGANIC_GROWTH' | 'ORDER_INTAKE' | 'BACKLOG' | 'VOLUME' | 'PRODUCTION' | 'CAPACITY_UTIL' | 'NET_PROFIT' | 'OTHER';
export type GuType = 'A_REVENUE' | 'B_PROFIT' | 'C_MARGIN' | 'D_CASHFLOW' | 'E_VOLUME' | 'F_ORDER_BACKLOG' | 'G_MULTI_METRIC';
export type GuQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type GuEvidence = 'DIRECT' | 'INDIRECT' | 'STATIC' | 'UNPROVEN' | 'INCOMPLETE';
export type GuGap = 'LARGE_POSITIVE' | 'POSITIVE' | 'INLINE' | 'SMALL_POSITIVE' | 'NEGATIVE' | 'UNKNOWN'; // UNKNOWN = no consensus (never negative)
export type GuDuration = 'ONE_OFF' | 'MULTI_QUARTER' | 'MULTI_YEAR' | 'UNKNOWN';
export type GuMateriality = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type GuThesis = 'A' | 'B' | 'F' | 'G' | null;            // existing labels only: A Operating Inflection, B Demand Explosion, F Profit Jump, G Silent Quality
export type GuDecision = 'IMMEDIATE_BUY' | 'WATCHLIST' | 'DELAYED_EP' | 'REJECT' | 'UNVERIFIED'; // UNVERIFIED = no primary source: no final decision
export type GuVerification = 'VERIFIED' | 'UNVERIFIED';
export type GuPortfolioImpact = 'SUPPORTS' | 'NEUTRAL' | 'WEAKENS' | 'BROKEN';
export type GuWindow = '24H' | '3D' | '7D' | '14D' | '30D' | '120D';
export type GuFlag = 'REPEATED_UPGRADER' | 'GUIDANCE_PLUS_GAP' | 'GUIDANCE_PLUS_BOTTLENECK' | 'SECOND_UPGRADE_IN_WINDOW' | 'SMALL_MID_CAP_INFLECTION';

// ── zzz844 V2 additions (all additive) ──────────────────────────────────────
/** How a guided RANGE moved. Midpoint-only comparison is never used alone. */
export type GuRangeClass = 'CLEAN_RAISE' | 'MIDPOINT_RAISE_RANGE_NARROWING' | 'RANGE_SHIFT_UP' | 'RANGE_WIDENING' | 'REITERATION' | 'DOWNGRADE' | 'FIRST_GUIDANCE' | 'UNKNOWN';
export interface GuRangeMath {
  beforeLow: number | null; beforeMid: number | null; beforeHigh: number | null;
  afterLow: number | null; afterMid: number | null; afterHigh: number | null;
  widthBefore: number | null; widthAfter: number | null;
  lowChangePct: number | null; midChangePct: number | null; highChangePct: number | null;
  klass: GuRangeClass;
  /** zzz847: the new low end is above the OLD high end (strongest raise class). */
  floorAboveOldCeiling?: boolean;
}
/** Metric semantics so EPS / GAAP / adjusted / organic are never mixed up. */
export type GuMetricBasis = 'GAAP' | 'ADJUSTED' | 'ORGANIC' | 'REPORTED' | 'CONSTANT_CURRENCY' | 'UNSTATED';
export type GuDurabilityLevel = 'ONE_OFF' | '1_2_QUARTERS' | 'MULTI_QUARTER' | 'MULTI_YEAR' | 'STRUCTURAL' | 'UNKNOWN_INSUFFICIENT_EVIDENCE';
/** Pipeline stage of one claim: news-only claims stay CANDIDATE until a primary source is found. */
export type GuStage = 'CANDIDATE' | 'PRIMARY_SOURCE_FOUND' | 'PRIOR_GUIDANCE_FOUND' | 'CALCULATED' | 'VERIFIED' | 'MATERIALITY_CHECKED' | 'DECISION';
export interface GuScoreItem { label: string; rating: 'STRONG' | 'OK' | 'WEAK' | 'UNKNOWN'; detail: string }  // plain words, never 0–100
export interface GuEventV2 {
  stage: GuStage;
  ranges: GuRangeMath[];                // one per changed metric, same order as changes
  metricBasis: GuMetricBasis;
  operatingVariable: string | null;     // volume / price / mix / utilisation / margin / FX / new capacity … only when stated or directly evidenced
  durabilityLevel: GuDurabilityLevel;
  durabilityWhy: string;
  whyNowResolved: boolean;              // false → text says 'Driver unresolved after primary-source + recent-event research'
  scorecard: GuScoreItem[];
  smallMidCapInflection: boolean;
  detectedVia: string[];                // 'exchange filing' | 'SEC 8-K' | 'graded results' | 'news' | 'concall' …
  consensusAvailable: boolean;
  unitWarnings: string[];               // e.g. 'EPS shown per share; revenue in millions'
  /** zzz847: source says guidance was RAISED but gave no usable before/after numbers (headline-only). Never a number. */
  statedDirection?: 'RAISED';
  /** zzz847: measures the source names as raised (plain words), e.g. ['revenue','net profit']. */
  statedMetrics?: string[];
  /** zzz848: who CONFIRMED the raise (primary document owner), when one was read. Absent = nobody yet; `detectedVia` says who first saw it. */
  verifiedBy?: string;
  /** zzz848: stable short hash per source (url, else name+date), so the same outlet is never stored or counted twice. */
  sourceHashes?: string[];
  /** zzz848: where the event came from on this read: live sources, the persisted event store, or both. */
  origin?: 'LIVE' | 'STORE' | 'LIVE+STORE';
  /** zzz849: what the computed numbers say. UPGRADE | REITERATION | DOWNGRADE | NO_RAISE | DETECTED (no before and after numbers). Wording follows this, never the headline verb. */
  eventClass?: 'UPGRADE' | 'REITERATION' | 'DOWNGRADE' | 'NO_RAISE' | 'DETECTED';
  /** zzz849: display label for eventClass, e.g. 'GUIDANCE REITERATED'. */
  eventLabel?: string;
  /** zzz849: set when before/after numbers came from the persistent guidance universe record, not from the event's own sources. */
  numbersFrom?: { origin: 'UNIVERSE_RECORD'; note: string; sourceName: string; sourceDate: string | null; sourceUrl: string | null; verification: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'SECONDARY_ONLY' | 'UNVERIFIED'; metric: string; period: string; display: string };
}
/** zzz848: NOT_AVAILABLE = the source cannot serve this window at all (e.g. no history that far back). It is never COMPLETE. */
export type GuScanState = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NOT_RUN' | 'NOT_AVAILABLE';
export interface GuScanSource {
  name: string; state: GuScanState; scanned: number; detail: string;
  /** zzz853 (additive): PRIMARY = exchange / SEC feeds read per day; SECONDARY = media or derived caches; FALLBACK = scraped copies used only when a primary or primary cache is missing */
  tier?: 'PRIMARY' | 'SECONDARY' | 'FALLBACK';
  /** zzz853: the days this source was asked about, and the days it answered (a failed query is never a zero). Newest first. */
  daysTried?: string[]; daysOk?: string[];
  /** zzz853: why the failed days failed (first few distinct reasons) */
  failReasons?: string[];
}
export interface GuScanStatus {
  market: 'IN' | 'US';
  windowFrom: string; windowTo: string;
  complete: boolean;                    // false → UI says SCAN INCOMPLETE, never '0 events'
  lastScanAt: string;
  sources: GuScanSource[];              // exchange filings / company IR / SEC / news discovery / graded cache
  daysCovered: number; daysRequested: number;
  candidatesFound: number; processed: number; awaitingGrading: number; verified: number;
  newestItemAt: string | null;
  note: string;
  /** zzz848 (all additive): honest coverage for long windows. */
  windowDays?: number;                  // the N of the window (120 for 120D)
  status?: GuScanState;                 // overall: COMPLETE | PARTIAL | FAILED | NOT_AVAILABLE
  sourcesCount?: number;                // sources that actually ran
  unprocessed?: number;                 // filings seen but not graded / text not read
  missingDays?: string[];               // newest first, capped at 60 (missingDaysCount is the real number)
  missingDaysCount?: number;
  storeDays?: number;                   // days counted as covered because an earlier run already processed them (persisted store)
  coverageLabel?: string;               // 'Coverage: 74/120 days — 120D coverage incomplete'
  /** zzz849: India: how the covered days were read. exchange = days NSE+BSE both answered; blob = days the optional scraped filings blob covers; blobOnly = covered by the blob while an exchange feed failed (PARTIAL, never full coverage). */
  coveredBy?: { exchange: number; blob: number; blobOnly: number };
}

/** A number that either exists with its provenance, or is honestly unavailable. */
export interface GuNumber {
  value: number | null;            // null = DATA UNAVAILABLE
  unit?: string;                   // '$B', '₹ Cr', '%', 'x', ...
  label: 'COMPANY_GUIDANCE' | 'CONSENSUS' | 'REPORTED' | 'MODEL_ESTIMATE' | 'UNAVAILABLE';
  source?: string;                 // where it came from
  formula?: string;                // required when label = MODEL_ESTIMATE
  assumptions?: string[];          // required when label = MODEL_ESTIMATE
}

export interface GuGuidancePoint {
  metric: GuMetric;
  period: string;                  // 'FY27', 'Q2 FY27', 'FY2026'
  low: number | null;
  high: number | null;
  midpoint: number | null;         // (low+high)/2, or the single point value
  isGrowthRate: boolean;           // true when low/high are growth % or margin %, false for absolute amounts
  currency?: string;
  basis?: 'GAAP' | 'NON_GAAP' | 'ORGANIC' | 'REPORTED' | 'UNSTATED';
  raw?: string;                    // the verbatim phrase it was extracted from
  /** zzz853: MULTI_YEAR_CAGR when the figure is a growth target over several years ('30-35% over FY27-FY29'); never read as a single-year figure. periodYears is the span when stated. */
  periodKind?: 'MULTI_YEAR_CAGR'; periodYears?: number;
  unit?: string;                   // additive: scale label of low/high — 'B' | 'M' | 'K' | 'Cr' | 'L Cr' | '%' | '' (currency symbol is in `currency`)
}

export interface GuChange {
  metric: GuMetric;
  before: GuGuidancePoint | null;  // null when previous guidance not found → cannot be called an upgrade
  after: GuGuidancePoint;
  absoluteChange: number | null;   // after.mid − before.mid
  percentageChange: number | null; // relative % (absolute-amount metrics only)
  percentagePointChange: number | null; // for growth/margin metrics: pp, never confused with relative %
  direction: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
}

export interface GuSourceRef {
  url?: string;
  name: string;
  tier: GuSourceTier;
  type: string;                    // 'SEC filing' | 'Exchange filing' | 'Earnings release' | 'Transcript' | 'Reuters' | ...
  date?: string;                   // ISO
  /** zzz853: what THIS source says (its own numbers), so a primary / media disagreement is stored side by side and never averaged */
  claims?: GuSourceClaim[];
}
export interface GuSourceClaim { metric: GuMetric; period: string; display: string; low: number | null; high: number | null; before?: string | null }
/** zzz853: primary and media (or two sources) disagree on the guided value for the same metric and period. Both are kept. */
export interface GuSourceConflict { metric: GuMetric; period: string; primary: string; media: string; primarySource: string; mediaSource: string; text: string }
/** zzz853: what the numbers say, independent of any headline verb. */
export type GuClassification = 'RAISE' | 'REITERATION' | 'MIXED' | 'DOWNGRADE' | 'DETECTED';
export type GuPrimaryState = 'PRIMARY_SOURCE_READ' | 'PRIMARY_SOURCE_FOUND' | 'AWAITING_PRIMARY_SOURCE' | 'SECONDARY_SOURCE_CLAIM';

export interface GuLedgerRow {
  date: string;
  metric: GuMetric;
  period: string;
  text: string;                    // '+5–7%' etc
  change: 'INITIAL' | 'RAISED' | 'CUT' | 'REITERATED' | 'NARROWED_UP' | 'NARROWED_DOWN';
  result?: 'BEAT' | 'INLINE' | 'MISS' | 'PENDING' | 'UNKNOWN';
  revisionPct?: number | null;     // additive: size of this revision in % (or pp for growth/margin metrics); null/absent = unknown
}

export interface GuHistoryStats {
  upgrades: number; downgrades: number; reiterations: number;
  avgRevisionPct: number | null;
  beatRateAfterUpgrades: number | null;   // 0..1, null when < 2 resolved results
  resolved: number;
}

export interface GuValuation {
  epsBefore: GuNumber; epsAfter: GuNumber;
  currentPE: GuNumber;
  earningsEffectPct: GuNumber;      // at UNCHANGED multiple = eps change %
  multipleSensitivityPct: GuNumber; // separate, never assumed
  marketCap?: GuNumber; enterpriseValue?: GuNumber; evEbitda?: GuNumber; fcfYield?: GuNumber;
  priorRerating?: string;           // e.g. 'stock +18% since event — context only, not the thesis'
}

export interface GuChain {
  event: string; evidence: string; driver: string; earnings: string; gap: string;
  valuation: string; durability: string; risk: string; action: string;
}

export interface GuLinks {
  newsIds?: string[];              // existing News & Signals objects (no duplicate stories)
  bottleneckThemes?: string[];
  structuralAlignment?: string;    // plain sentence only when the economic link is stated
  inBook?: boolean;
  bookThesisLabel?: GuThesis;
  portfolioImpact?: GuPortfolioImpact;
}

/** One canonical event: company + metric + period + announcement date. */
export interface GuidanceEvent {
  guidance_event_id: string;       // stable hash of canonical key
  canonical_key: string;
  ticker: string;
  company: string;
  market: GuMarket;
  announcement_date: string;       // ISO date
  announcement_timestamp?: string; // ISO datetime when known
  verification: GuVerification;
  primaryAvailable: boolean;
  sources: GuSourceRef[];          // >1 sources strengthen, never duplicate
  changes: GuChange[];             // every metric raised (multi-metric = >1)
  type: GuType;
  guidance_quality: GuQuality;
  guidance_driver: string;         // what caused it — economic driver, not management's wording
  driverEvidence: GuEvidence;
  history: GuLedgerRow[];
  historyStats: GuHistoryStats | null;
  consensus: GuNumber;
  expectationGap: GuGap;
  gapPct: number | null;           // guidance midpoint vs consensus, %
  revenueImpact: GuNumber; ebitdaImpact: GuNumber; epsImpact: GuNumber; fcfImpact: GuNumber;
  valuation: GuValuation | null;
  duration: GuDuration;
  thesis: GuThesis;
  materiality: GuMateriality;
  materialityBasis: string;        // the numbers it was computed from
  evidence: GuEvidence;
  links: GuLinks;
  risks: string[];                 // 2–4, specific
  evidenceGaps: string[];          // things that are DATA UNAVAILABLE
  nextEvidence: string[];          // 1–2 measurable
  whyNow: string;                  // one sentence naming the economic driver
  whatItMeans: string;             // only claims the numbers support
  marketMissing: string;
  chain: GuChain;
  decision: GuDecision;
  decisionReason: string[];        // ordered: changed, earnings, gap, valuation, duration, risk
  flags: GuFlag[];
  v2?: GuEventV2;                  // zzz844
  /** zzz853 (all additive). Classification follows the NUMBERS only; the headline verb never decides it. */
  classification?: GuClassification;
  /** 'GUIDANCE UPGRADE' only for a VERIFIED clean raise; 'REITERATION'; 'MIXED / RANGE CHANGE'; 'GUIDANCE LOWERED'; 'UNVERIFIED CLAIM' */
  displayLabel?: string;
  /** true for an event that is NOT a clean verified-or-claimed raise on the numbers (reiteration, mixed, lowered). Never counted as an upgrade; show under the audit group. */
  auditOnly?: boolean;
  auditNote?: string;
  /** counts as an upgrade: clean RAISE on the numbers (and VERIFIED for the verified-upgrade count) */
  isUpgrade?: boolean;
  /** the media / feed date(s) of the coverage, kept apart from announcement_date (the company's own date) */
  media_date?: string;
  dateBasis?: 'ANNOUNCEMENT' | 'MEDIA';
  /** zzz853: a primary document for this claim: its link (null = none known), the state wording, and the date it was filed */
  primarySourceUrl?: string | null;
  primaryState?: GuPrimaryState;
  primaryStateText?: string;
  primarySourceDate?: string | null;
  sourceConflict?: GuSourceConflict | null;
  /** zzz853: the company's own sentence that explains the change, or 'Driver not stated' */
  whyNowDriver?: string;
  rankKey: number;                 // internal sort only, never displayed
  created_at: string; updated_at: string;
}

/** zzz853: one definition per count, enforced by checkEventInvariants. verified <= processed <= discovered; material <= verified; expectationPositive <= verified. */
export interface GuCounts {
  discovered: number;        // events found + documents still awaiting grading + documents whose source is unavailable
  processed: number;         // events whose numbers (or primary document) were read
  verified: number;          // events confirmed by a primary document
  material: number;          // verified, clean-raise events with HIGH / MEDIUM materiality
  upgrade: number;           // verified clean raises (never an audit-only event)
  reiteration: number; mixed: number; lowered: number;
  expectationPositive: number;   // verified and above consensus; needs a consensus number
  unverifiedClaims: number;  // detected from media / feeds, no primary document read yet
  documentsAwaitingGrading: number;   // reported separately; never mixed into verified
  documentsUnavailable: number;
}
export interface GuSummary {
  window: GuWindow; asOf: string;
  /** zzz853: the canonical counts (see GuCounts). The older fields above stay for the current UI. */
  counts?: GuCounts;
  countsByMarket?: { IN: GuCounts; US: GuCounts };
  detected: number; verified: number; material: number; expectationPositive: number; inBook: number;
  /** zzz844 additive */
  byMarket?: { IN: { detected: number; verified: number; material: number; expectationPositive: number }; US: { detected: number; verified: number; material: number; expectationPositive: number } };
  consensusAvailable?: { have: number; of: number };
  today?: number;                   // verified events announced today
}

/** zzz849: a discovery whose headline names no real company (no NSE symbol or company-name match). Held back: NEVER an event; shown only in coverage diagnostics. */
export interface GuUnresolvedDiscovery { company: string | null; title: string; sourceName: string; date: string; url?: string; market: GuMarket; reason: string }
export interface GuidanceUpgradesResponse {
  summary: GuSummary;
  /** zzz853: ONE coverage card per market from one model (see guidance-upgrades-coverage.ts). The older `scan` / `freshness` fields stay until the page switches. */
  coverage?: GuCoverageBlock;
  /** zzz853: broken count rules, empty when every invariant holds */
  invariantViolations?: string[];
  /** zzz853: processing queue state after this run */
  queue?: GuQueueReport;
  events: GuidanceEvent[];
  /** zzz849: number of unresolved discoveries held back from `events` (the list is `unresolved`, an array of GuUnresolvedDiscovery, coverage diagnostics only) */
  unresolvedCount?: number;
  scan?: Partial<Record<'IN' | 'US', GuScanStatus>>;   // zzz844
  /** additive (optional): discoveries held back because they could not be resolved; the route sends GuUnresolvedDiscovery[]. Never shown as events. */
  unresolved?: number | unknown[];
  freshness: {
    newestAnnouncement: string | null; feedCheckedAt: string; note?: string;
    /** additive: per-market coverage, so India and USA are each described honestly */
    byMarket?: Partial<Record<'IN' | 'US', {
      newestAnnouncement: string | null; events: number; withConsensus: number;
      candidates: { graded: number; filings: number; news: number };
      sessions?: { warm: number; total: number; olderEngine: number };
      cold: boolean; note: string;
    }>>;
  };
}

/** Raw candidate handed to the engine by the API route from existing feeds. */
export interface GuCandidate {
  id: string;
  ticker?: string; company?: string;
  market: GuMarket;
  title: string; text: string;      // headline + body/summary/transcript excerpt
  url?: string; sourceName: string;
  publishedAt: string;              // ISO
  kind?: 'FILING' | 'RELEASE' | 'TRANSCRIPT' | 'DECK' | 'NEWS' | 'OTHER';
  /** zzz853: the COMPANY's announcement date when it is known and differs from `publishedAt` (the media / feed date). Windows filter on this, never on a republish date. */
  eventDate?: string;
}

/** Optional context the route may supply; every field may be absent → DATA UNAVAILABLE. */
export interface GuContext {
  consensus?: { metric: GuMetric; period: string; value: number; unit?: string; source: string };
  priceContext?: { pe?: number; marketCap?: number; ev?: number; evEbitda?: number; fcfYield?: number; move7dPct?: number };
  inBook?: boolean; bookThesis?: GuThesis;
  newsIds?: string[]; bottleneckThemes?: string[];
  priorGuidance?: GuGuidancePoint[];  // from ledger store, same ticker
  ledger?: GuLedgerRow[];
  structuralAlignment?: string;       // additive: plain sentence, supplied only when the economic link is stated
  reportedMargin?: { value: number; source: string; period?: string }; // additive: stated/reported operating margin in %, used only for a labelled MODEL_ESTIMATE
}


// ═══ zzz853: canonical coverage model ═══════════════════════════════════════════════════════════════════════════════
export type CoverageSourceTier = 'PRIMARY' | 'SECONDARY' | 'FALLBACK';
export type CoverageQueryStatus = 'SUCCESS' | 'FAILED' | 'NOT_AVAILABLE';
/** ZERO_RESULTS only when the query succeeded and returned zero. A failed query is UNKNOWN, never zero. */
export type CoverageDataStatus = 'DATA_FOUND' | 'ZERO_RESULTS' | 'UNKNOWN';
/** EMPTY (query worked, zero rows) is never COMPLETE. */
export type CoverageSourceStatus = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'EMPTY';
export type CoverageOverall = 'COMPLETE' | 'PARTIAL' | 'FAILED';
export interface CoverageSourceRow {
  name: string; tier: CoverageSourceTier;
  queryStatus: CoverageQueryStatus; dataStatus: CoverageDataStatus; status: CoverageSourceStatus;
  recordsRead: number; reason: string;
  daysAttempted: number; daysSucceeded: number;
}
/** CACHE_MISS = the cache key is absent (needs a refresh; says nothing about investment data). SOURCE_EMPTY = the feed ran and returned zero items. FETCH_FAILED = the read failed or timed out. */
export type GuCacheState = 'HIT' | 'CACHE_MISS' | 'SOURCE_EMPTY' | 'FETCH_FAILED';
export interface GuCacheRow {
  name: string; key: string; state: GuCacheState;
  /** which copy supplied the data actually used */
  servedBy: 'LIVE' | 'LASTGOOD' | 'SHARED_LASTGOOD' | 'FALLBACK_FEED' | 'NONE';
  items: number; text: string;
}
export interface CoverageCard {
  market: 'IN' | 'US';
  requestedWindow: GuWindow;
  /** the same requested window for every market: N calendar days ending today */
  windowDays: number;
  calendarDays: number;
  /** weekdays inside the window (the days an exchange can publish); weekends are not owed coverage */
  tradingDays: number;
  /** trading days a PRIMARY exchange feed was asked about in this run */
  daysAttempted: number;
  /** trading days where EVERY primary exchange feed answered (PRIMARY feeds only; a blob or cache never makes a day covered) */
  daysSuccessfullyRead: number;
  /** trading days where some, not all, primary feeds answered, plus days only an optional fallback copy covered. Labelled, never counted as covered. */
  daysPartialCoverage: number;
  daysPrimaryPartial: number; daysFallbackOnly: number;
  /** trading days of the window the live read did not ask about (bounded live scan) */
  daysNotAttempted: number;
  /** of those, days an earlier run already processed (persisted store); labelled, never counted as read now */
  daysFromEarlierRuns: number;
  /** trading days nobody answered for */
  daysFailed: number;
  coveredLabel: string;
  partialLabel: string | null;
  sources: CoverageSourceRow[];
  cache: GuCacheRow[];
  /** 'Primary news cache unavailable; fallback scraped feed active.' and similar, naming the source that really supplied data */
  fallbackNote: string | null;
  documentsAwaitingGrading: number;
  documentsUnavailable: number;
  candidatesDiscovered: number; processed: number; verified: number;
  overall: CoverageOverall; overallReason: string;
  /** plain one-line state for the page header */
  headline: string;
}
export interface GuCoverageBlock {
  window: GuWindow; windowDays: number;
  cards: CoverageCard[];
  /** why India and US show the same window; also lists any producer still using another window */
  windowNote: string;
  generatedAt: string;
}

// ═══ zzz853: processing queue ═══════════════════════════════════════════════════════════════════════════════════════
export type GuQueuePriority = 'P0' | 'P1' | 'P2';
export type GuQueueStatus = 'QUEUED' | 'READING' | 'DONE' | 'FAILED' | 'SOURCE_UNAVAILABLE';
export interface GuQueueItem {
  id: string;
  discovered_at: string; priority: GuQueuePriority;
  company_id: string | null; ticker: string | null; company: string | null; market: 'IN' | 'US';
  source_url: string | null; source_type: string; subject: string; event_date: string;
  processing_status: GuQueueStatus; attempt_count: number; last_error: string | null; next_attempt: string | null;
  /** set when DONE: the candidate the document produced (trimmed text), and whether company + metric + period + value were all read */
  result?: { complete: boolean; metrics: number; candidate: GuCandidate | null; readAt: string } | null;
}
export interface GuQueueReport {
  total: number; queued: number; reading: number; done: number; failed: number; sourceUnavailable: number;
  byPriority: Record<GuQueuePriority, number>;
  processedThisRun: number; verifiedThisRun: number; failedThisRun: number;
  backlogByMarket: { IN: number; US: number };
  note: string;
}
