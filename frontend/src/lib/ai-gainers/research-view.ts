// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE RESEARCH VIEW MODEL.                        (zzz770)
//
// One pure function turns what the pipeline already produced (the day's
// catalyst findings, the scanned board, the filed-result rows and the owner's
// book) into what the page shows: a research queue ranked by research value,
// with every claim traced to a source and every unknown stated as unknown.
//
//   PRICE MOVE → EVENT → EVIDENCE → ECONOMIC TRANSMISSION → EXPECTATION GAP
//   → RESEARCH ACTION
//
// CONTRACT: the page renders ONLY from ResearchView. The shapes below are the
// contract between the pipeline and the UI; change them only together.
// Nothing here reads a price as an exit or buy signal, and nothing here may
// invent a figure the evidence does not state — a missing value is null and
// is printed as "Not disclosed".
//
// PURE AND DETERMINISTIC: no clock, no network, no server import. The same
// input always yields the same view (the page may call it client-side).
// Price is context: the size of the move is never a ranking input — it only
// enters through the expectation GAP (move vs fundamental change).
// ═══════════════════════════════════════════════════════════════════════════

import type { Finding } from './catalyst-research';
import { presentErrorLines, marketRunOf, exchangeDateOf } from './research-present';
import { contractTermYears, debtActionOf, isStrategicStakeKind, resolveIssuer, type CatalystConfirmation, type CatalystRecord, type EventKind, type EventStage, type StructuredFacts, type ValueStatus } from './structured-facts';
import { buildCatalystRecords, evidenceBreadthOf, storedView, evidenceGapOf, factsForFinding, legacyFactMapOf, structuredFactsOf, threadTimeline, KIND_WORD, STATE_WORD, stateWordFor, type CatalystView, type EvidenceBreadth, type EvidenceGap, type TimelineEntry } from './catalyst-timeline';
import { persistenceTestOf, type PersistenceTestView } from './persistence-test';
// zzz798: the US card is a type-only reference (inline import type below) —
// this module keeps its client-safe import list.
type UsCard = import('./us-card').UsCard;
type InCard = import('./in-event-taxonomy').InCard;
type ClinicalFacts = import('./us-event-taxonomy').ClinicalFacts;
type LitigationRead = import('./us-event-taxonomy').LitigationRead;
type UsAcquisitionEconomics = import('./us-card').UsAcquisitionEconomics;
/** Same sentence as LITIGATION_CASH_NOTE in us-event-taxonomy.ts (kept literal so this file stays client-safe). */
const LITIGATION_CASH_NOTE = 'Gross award is not expected cash proceeds.';
type InCatalyst = import('./in-event-taxonomy').InCatalyst;

/** The six states every gainer ends in (spec §4), plus data states. */
export type EventClass =
  | 'CONFIRMED_MATERIAL'          // A — verified, economically meaningful
  | 'CONFIRMED_LOW_MATERIALITY'   // B — real, too small to explain the move
  | 'POTENTIAL_UNVERIFIED'        // C — something exists, not verified
  | 'NEGATIVE'                    // D — negative / contrary / denied
  | 'NO_CATALYST'                 // E — no credible event found
  | 'MARKET_MOVE_ONLY'            // F — band print / technical, no event
  | 'LISTING'                     // recent listing — excluded from comparison
  | 'DATA_UNAVAILABLE';           // sources failed — NOT "no catalyst"

/** Standard event taxonomy (spec §18). */
export type EventType =
  | 'Earnings' | 'Order win' | 'Order cancellation' | 'Capacity expansion' | 'Production ramp'
  | 'New product' | 'Customer win' | 'Pricing' | 'Acquisition' | 'Divestment' | 'JV'
  | 'Regulatory approval' | 'Contract' | 'Partnership' | 'Buyback' | 'Fundraising'
  | 'Debt / refinancing' | 'Management change' | 'Governance' | 'Guidance' | 'Rating action'
  | 'Litigation / regulatory' | 'Accident / disruption' | 'Denial' | 'No identified catalyst'
  | 'Market/technical move'
  // zzz787 — ownership / corporate events no longer forced into 'Acquisition':
  | 'Merger' | 'Strategic expansion' | 'Strategic investment' | 'Promoter buying' | 'Capital allocation';

/** zzz787: event types that are capital-allocation research, never a
 *  portfolio action and never an operating catalyst. */
export const CAPITAL_ALLOCATION_TYPES = new Set<EventType>(['Strategic investment', 'Promoter buying', 'Capital allocation', 'Buyback']);

/** Strict stage ladder (spec §19). */
export type Stage = 'RUMOUR' | 'PROPOSED' | 'ENABLING' | 'SIGNED' | 'AWARDED' | 'EXECUTED' | 'OPERATIONAL' | 'MONETIZING' | 'UNKNOWN';

/** Source confidence (spec §20). */
export type SourceConfidence = 'VERIFIED_DOCUMENT' | 'VERIFIED_FILING' | 'SECONDARY_SUMMARY' | 'UNVERIFIED';

/** How the event reaches the income statement (spec §9). */
export type Transmission = 'DIRECT' | 'NEAR_TERM' | 'LONG_TERM' | 'WEAK' | 'NONE';

export type Persistence = 'DAYS' | 'QUARTER' | 'YEARS' | 'UNKNOWN';
export type GapLevel = 'LARGE' | 'MODERATE' | 'SMALL' | 'UNKNOWN';
export type PortfolioRelevance = 'HOLDING' | 'WATCHLIST' | 'SAME_THEME' | 'UNRELATED';
/** The only actions this view ever names — never a trade instruction. */
export type ResearchAction = 'Review' | 'Investigate' | 'Monitor' | 'Thesis evidence' | 'No catalyst' | 'Negative evidence';

export interface MaterialityRatio {
  /** What the event value is divided by. */
  basis: 'market_cap' | 'ttm_revenue' | 'annual_revenue' | 'order_book' | 'current_capacity' | 'ebitda' | 'assets';
  pct: number;
  /** e.g. "₹488 Cr ÷ ₹1,020 Cr TTM revenue = 47.8%" — the arithmetic, shown. */
  text: string;
}

export interface Materiality {
  label: 'SIGNIFICANT' | 'MODERATE' | 'SMALL' | 'UNKNOWN';
  ratios: MaterialityRatio[];
  /** One line: why this label. "Not disclosed" when no value exists. */
  explanation: string;
  /** zzz787: whether the figure behind the ratio was verified in a READ
   *  document. PENDING = a figure is stated (summary / subject / filing
   *  metadata) but the document has not confirmed it — no ratio is computed
   *  and materiality stays UNKNOWN until it is. */
  verification?: 'DOCUMENT_VERIFIED' | 'PENDING' | null;
  /** zzz787: evidence confidence of the ratio (1 = document-verified, 0 = none). */
  confidence?: number;
  /** zzz787: the figure as stated, when one was stated (verified or not). */
  statedValue?: number | null;
}

export interface EarningsMini {
  revenueYoY: number | null; revenueQoQ: number | null;
  ebitdaYoY: number | null; marginNow: number | null; marginPrior: number | null;
  patYoY: number | null; cfoToPat: number | null;
  guidance: 'RAISED' | 'MAINTAINED' | 'CUT' | 'NOT_STATED';
  orderBook: 'UP' | 'DOWN' | 'UNCHANGED' | 'NOT_STATED';
  keyChange: string | null;
  filedDaysAgo: number | null;
  /** Optional detail (zzz770 AG-A): the grader's tier, quarter and filing date. */
  tier?: string | null;
  quarter?: string | null;
  filedDate?: string | null;
  /** Filed more than CATALYST_WINDOWS.recent (14) days ago: context for the
   *  move, never its catalyst (zzz771 — was 20d). */
  stale?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CATALYST WINDOWS (zzz771) — the ONE table that says how old an event can be
// and still be this session's catalyst. India boards carry a 1-day move, so a
// filing more than 3 days old cannot be its trigger; US boards carry a 1-week
// move, so the window is a week. Between the window and 14 days a delayed
// reaction is possible (RECENT). Beyond 14 days the event is real but it is
// older CONTEXT: PASUPTAC's Q1 result filed 47 days before a +7.3% session
// was ranked #5 as "CONFIRMED MATERIAL EVENT" — the class was right, the
// attribution was not.
// ═══════════════════════════════════════════════════════════════════════════

export const CATALYST_WINDOWS: Record<'IN' | 'US', { thisMove: number; recent: number }> = {
  IN: { thisMove: 3, recent: 14 },
  US: { thisMove: 7, recent: 14 },
};

export function catalystForOf(market: 'IN' | 'US', ageDays: number | null | undefined): NonNullable<ResearchItem['catalystFor']> {
  if (ageDays == null || !Number.isFinite(ageDays)) return 'RECENT';   // unknown age: neither claimed nor dismissed
  const w = CATALYST_WINDOWS[market];
  return ageDays <= w.thisMove ? 'THIS_MOVE' : ageDays <= w.recent ? 'RECENT' : 'CONTEXT';
}

/** A usable company name: not empty, not the ticker itself, not a bare scrip code. (zzz835) */
export function isRealName(name: string | null | undefined, ticker: string): boolean {
  const n = String(name ?? '').trim();
  if (!n || /^(-|—|n\/a|null|undefined|nan)$/i.test(n)) return false;
  if (/^\d+$/.test(n)) return false;
  return n.toLowerCase() !== String(ticker || '').trim().toLowerCase();
}

/** The name to print for a row: the company name if any is known, else the
 *  displayed name, else the ticker — never blank, never '-'. (zzz835) */
export function companyNameOf(ticker: string, company: string | null | undefined, displayTicker?: string | null): { name: string; from: 'company' | 'display' | 'ticker' } {
  if (isRealName(company, ticker)) return { name: String(company).trim(), from: 'company' };
  const d = String(displayTicker ?? '').trim();
  if (d && isRealName(d, ticker)) return { name: d, from: 'display' };
  return { name: String(ticker || '').trim(), from: 'ticker' };
}

/** A bare BSE scrip code ("544501") is not a name anyone recognises: the
 *  company is shown first and the code small. (zzz771) */
export function displayNameOf(ticker: string, company: string | null): { displayTicker: string; displayCode: string | null } {
  const t = String(ticker || '').trim();
  const name = company ? String(company).replace(/\s*\((india|ltd|limited)\)\s*$/i, '').replace(/[\s,]*\b(limited|ltd|pvt|private|inc|corp|corporation|plc)\b\.?\s*$/i, '').replace(/[\s,.-]+$/, '').trim() : '';
  if (/^\d+$/.test(t) && name) return { displayTicker: name, displayCode: t };
  return { displayTicker: t, displayCode: null };
}

export interface ResearchItem {
  /** zzz775: the pricing assessment from the finding (reaction since the
   *  filing vs the event's size) — shown as PRICED instead of "UNKNOWN". */
  pricing?: { state: string; label: string; text: string } | null;
  /** Press coverage for the name — secondary, never scored. (zzz773) */
  news?: { narrative: { label: string; days: number; firstDate: string; lastDate: string; lead: string } | null; items: Array<{ title: string; url: string; date: string; source: string }> } | null;
  ticker: string;
  company: string | null;
  market: 'IN' | 'US';
  /** The one-session move. US boards carry a 1-WEEK move, so this is null
   *  there and the move sits in `returns.w1` (see `move`). */
  move1d: number | null;
  returns: { w1: number | null; m1: number | null; m3: number | null };
  marketCap: number | null;
  eventClass: EventClass;
  eventType: EventType;
  /** One line: what happened, in the filing's own proper nouns. */
  headline: string;
  /** Concrete change with numbers when verified; null when not established. */
  whatChanged: string | null;
  before: string | null;
  after: string | null;
  filedDate: string | null;
  stage: Stage;
  sourceConfidence: SourceConfidence;
  sourceUrl: string | null;
  quote: string | null;
  materiality: Materiality;
  transmission: Transmission;
  /** EVENT → DRIVER → REVENUE → MARGIN → EPS/FCF → VALUATION; unsupported steps say "TBD" / "Not disclosed". */
  transmissionChain: string[];
  persistence: Persistence;
  /** zzz782: evidence that it WILL persist — separate from the potential duration above. */
  persistenceEvidence?: { level: PersistEvidenceLevel; text: string };
  /** zzz787: the potential duration's plain sentence and its basis — FACTS
   *  (a stated term, programme, capacity or execution period) or TYPE (only
   *  the kind of event). Either way it is NOT evidence. */
  potentialDuration?: PotentialDuration;
  /** zzz787: the four duration concepts kept apart (contractual / potential /
   *  evidence-supported / catalyst state) — see DurationView. */
  durations?: DurationView | null;
  /** zzz782: a tax / penalty demand under 0.25% of market cap. */
  immaterialNegative?: boolean;
  /** zzz780: persistent-catalyst test of the event (never price). */
  persistentCatalyst?: import('@/lib/catalyst/persistence').PersistSummary | null;
  expectationGap: { level: GapLevel; text: string; direction?: 'EXPECTATION_HEAVY' | 'UNDER_REFLECTED' | 'ALIGNED' | null };
  /** Named unknowns: "Order margin: Not disclosed", "Revenue timing: Not disclosed". */
  unknowns: string[];
  /** 3–5 concrete questions for the event type. */
  researchNext: string[];
  /** The one-sentence reason this deserves research time (spec §41). */
  whyResearch: string;
  /** zzz789: the event's IMPACT — kept apart from WHAT CHANGED (the stated fact).
   *  "Not established — margin, execution period still open". Null when not an event. */
  impact?: string | null;
  /** zzz789: plain "Why #N" line — the structured rank dimensions in words
   *  ("verified event + identifiable mechanism + multi-period runway +
   *  unresolved economic significance"). No number is shown. */
  whyRank?: string;
  /** zzz789: the ONE canonical event id behind this card, and every section it
   *  is surfaced in (the same event, referenced — never a second card). */
  canonicalId?: string;
  surfacedIn?: string[];
  portfolio: { relevance: PortfolioRelevance; thesisVariable: string | null; note: string | null };
  earnings: EarningsMini | null;
  flags: { band: number | null; listing: boolean; dilution: boolean; denial: boolean; turnover: number | null };
  /** 0–100 research priority; never the size of the move. */
  priority: number;
  /** Human reasons behind the priority ("Fresh event", "Material vs revenue", …). */
  priorityReasons: string[];
  /** Raw numeric components for the collapsible "Score details". */
  scoreDetails: Record<string, number> | null;
  // ── optional additions (zzz770 AG-A) ──
  /** Display label finer than the taxonomy: "Letter of intent (not an order)". */
  eventLabel?: string;
  /** Review / Investigate / Monitor / Thesis evidence / No catalyst / Negative evidence. */
  action?: ResearchAction;
  /** The move as measured, with its window: '1D' (India session) or '1W' (US export). */
  move?: { pct: number | null; window: '1D' | '1W' };
  /** The pipeline's own finding status (catalyst / denied / none …) for audit. */
  findingStatus?: string | null;
  /** The finding's caveat notes, decoded. */
  notes?: string[];
  /** Days since the event's source was filed. */
  ageDays?: number | null;
  /** ── zzz771 CONTRACT (AG-1 fills, AG-2 renders) ─────────────────────────
   *  Whether this event can be the catalyst for THIS session's move.
   *  THIS_MOVE: filed within the move window (IN ≤3d, US ≤7d).
   *  RECENT: 4–14d — a delayed reaction is possible; stays in the queue with a freshness penalty.
   *  CONTEXT: >14d — a real event, but older context; never the catalyst, never in the queue/top3/confirmed counts. */
  catalystFor?: 'THIS_MOVE' | 'RECENT' | 'CONTEXT';
  /** Company name first when the ticker is a bare BSE scrip code ("544501"). */
  displayTicker?: string;
  /** Secondary code shown small when displayTicker is the name. */
  displayCode?: string | null;
  /** For NO_CATALYST rows: what was actually scanned, so "no catalyst" is never read as "nothing happened". */
  scanNote?: string | null;
  // ── zzz785 C — timeline / dedup / persistence (all optional) ──
  /** The catalyst records behind this card (primary first): one per UNDERLYING
   *  catalyst, repeated headlines / press / filings merged, with its state. */
  catalysts?: CatalystCard[];
  /** The primary catalyst's thread timeline (related filings, oldest → newest). */
  timeline?: TimelineEntry[];
  /** Explicit persistence test (mechanism, runway, evidence, repeatability,
   *  disclosed duration, milestone, invalidation → grade + why). */
  persistenceTest?: PersistenceTestView | null;
  /** Three distinct gap labels: No catalyst / Evidence incomplete / Unclassified. */
  evidenceGap?: { code: EvidenceGap; label: string; text: string } | null;
  /** Independent evidence dimensions — never a raw item count. */
  evidenceBreadth?: EvidenceBreadth | null;
  /** Economics unknown: stays visible, labelled, never silently sorted away. */
  economicsUnknown?: { label: string; missing: string[] } | null;
  /** 'Official filing' / 'Secondary · verification required' / … */
  verification?: string | null;
  /** Links to the thesis ledger and Special Focus — separate views, linked by ticker.
   *  zzz787: plus the ONE underlying catalyst id (event record) and the
   *  persistent-mechanism id, so the same event is cross-linked, never listed
   *  again as a separate item in another view. */
  links?: { thesis: string | null; specialFocus: string | null; note: string; catalystId?: string | null; persistentId?: string | null; persistent?: string | null } | null;
  /** zzz798 (US only): the card read from the SEC documents without a model —
   *  source label, the extra stated lines (outlook, earn-out, funding …), the
   *  materiality arithmetic. Absent on India items. */
  usCard?: UsCard | null;
  /** zzz803 (India only): the India catalyst card — events from the exchange
   *  filings and press headlines (filed vs "reported, not confirmed by the
   *  company"), the latest quarterly result as the backdrop, the price /
   *  volume clarification, the routine list. Absent on US items. */
  inCard?: InCard | null;
  // ── zzz835 (all optional) ──
  /** A company name for every row: the finding / scan row / screener / BSE-map
   *  name, else the displayed name, else the ticker. Never empty — the PDF and
   *  the tables print this instead of '-'. */
  companyName?: string;
  /** Where the name came from: 'finding' | 'scan' | 'filed' | 'lookup' | 'display' | 'ticker'. */
  companyNameFrom?: string;
  /** One short line built from the rank components (evidence, mechanism,
   *  persistence, materiality, recency, penalties). Price is never in it. */
  rankReason?: string;
  /** The same components as numbers: evidence 0-3, mechanism 0-2, persistence
   *  0-2, materiality 0-2, recency 0-1 (freshness factor), penalties (words). */
  rankParts?: { evidence: number; mechanism: number; persistence: number; materiality: number; recency: number; penalties: string[] };
  /** The exchange date of the move this event is measured against. */
  moveDate?: string | null;
  /** inside_window / outside_window / unknown — by the exchange calendar (catalystFor is the 3-way badge). */
  windowStatus?: 'inside_window' | 'outside_window' | 'unknown';
  // ── zzz835 card facts (both markets; all optional; absent on items whose card predates them) ──
  /** Value conflicts (headline / press value vs the filed value), plainly worded, both values named. Empty / absent = none flagged. */
  conflicts?: string[];
  /** The values behind a conflict, each with where it came from. */
  conflictValues?: Array<{ text: string; source: string }>;
  /** verified | reported | conflicting | not_disclosed. 'conflicting' means the impact is unknown. */
  valueStatus?: ValueStatus;
  /** PROPOSED / SIGNED / AWARDED / EXECUTED / COMPLETED, from the event's own words; null when unclear. */
  stageBadge?: EventStage | null;
  /** One earnings filing = one cluster with child facts. */
  clusters?: Array<{ clusterId: string; label: string; sentence: string; source: string; independentSources: number; children: Array<{ label: string; sentence: string; figures: string[] }> }>;
  /** Clinical-trial facts (endpoint, effect size, p-value, safety ...); each missing one is named in `notStated`. */
  clinical?: ClinicalFacts | null;
  /** Acquisition economics (price, upfront cash, contingent, liabilities, financing, contribution). */
  acquisition?: UsAcquisitionEconomics | null;
  /** The litigation read (gross award, appeal, collectability ...). */
  litigation?: LitigationRead | null;
  /** 'Gross award is not expected cash proceeds.' on any litigation award. */
  litigationNote?: string | null;
  /** True when the item's causal window says it is context only (older than the move window). Never shown as the move catalyst. */
  contextOnly?: boolean;
  /** e.g. "Filed 5 days before the move - outside the 3-day window: context only". */
  causalLabel?: string | null;
  /** One sentence on what was found / searched. Never "no catalyst" when an event exists. */
  catalystStatusSentence?: string | null;
  /** What was searched: sources and how far back. */
  searched?: { sources: string[]; lookbackDays: number | null; filings?: number; press?: number } | null;
  /** Does an official filing that was read contain the event? */
  catalystConfirmation?: CatalystConfirmation;
  catalystConfirmationLabel?: string;
  /** Who the issuer is: a numeric BSE code is shown as "BSE 544434" with the company name kept apart. */
  issuer?: { code: string | null; ticker: string | null; name: string | null; display: string };
}

/** One catalyst record as a card shows it. */
export interface CatalystCard {
  id: string; kind: EventKind; kindWord: string; title: string;
  state: CatalystRecord['state']; stateWord: string; previousState: CatalystRecord['previousState'];
  latestEvidence: string | null; nextMilestone: string | null; invalidation: string | null;
  polarity: 'positive' | 'negative' | 'neutral'; verification: string;
  /** Size against market cap when an amount is stated; else "amount not stated". */
  materialityText: string | null;
  firstSeen: string; lastSeen: string; duplicatesMerged: number; documents: number;
}

export const GAP_LABEL: Record<EvidenceGap, { label: string; text: string }> = {
  NO_CATALYST: { label: 'No catalyst', text: 'Filings in the window were checked; none explains the move.' },
  EVIDENCE_INCOMPLETE: { label: 'Evidence incomplete', text: 'An event was found, but its documents were not fully read — the size and terms are not established yet.' },
  UNCLASSIFIED: { label: 'Unclassified', text: 'A filing exists but its subject says nothing classifiable — open it before concluding anything.' },
};
export const UNKNOWN_NEEDS_READING = 'Unknown — needs reading';

export interface ResearchView {
  session: {
    date: string | null; scanAt: string | null; status: string; cached: boolean;
    /** Optional (zzz770 AG-A): human label and whether the move is today's. */
    label?: string | null; isToday?: boolean | null; note?: string | null;
    // ── zzz835: the market run, kept apart (see marketRunOf) ──
    /** The trading date the moves belong to (exchange date). */
    sessionDate?: string | null;
    /** When the scan was generated / the prices were read (ISO instants). */
    generatedAt?: string | null; dataAsOf?: string | null;
    /** Exchange time zone of every time shown. */
    timezone?: string | null;
    sessionStatus?: 'pre_market' | 'live' | 'closed' | 'stale';
    /** True only when the session has closed AND the data was read at/after the close. */
    isFinal?: boolean;
    marketCloseAt?: string | null;
    /** One sentence: why the run is final or PROVISIONAL. */
    runReason?: string | null;
  };
  summary: {
    scanned: number; confirmed: number; potential: number; negative: number;
    noCatalyst: number; queue: number; portfolioMatches: number; dataUnavailable: number;
    /** Optional detail (zzz770 AG-A). */
    lowMateriality?: number; marketMoveOnly?: number; listings?: number; unresearched?: number; watch?: number;
    /** zzz771: older filings behind names on the board — context, not this move's catalyst. */
    context?: number;
    /** zzz801 (US only): names with at least one catalyst found by the event
     *  taxonomy (filing or press), names with none, and the names per
     *  category (SEC-verified vs press only). Absent on India views. */
    usCatalysts?: {
      found: number; none: number;
      byCategory: Array<{ category: string; names: number; sec: number; press: number; tickers: string[] }>;
    };
    /** zzz835 (BOTH markets): catalysts found by category. `sec` = names with an
     *  official-filing catalyst in the category, `press` = press only. Same shape
     *  as usCatalysts; India categories come from the India taxonomy. */
    catalysts?: {
      market: 'IN' | 'US'; found: number; none: number;
      byCategory: Array<{ category: string; names: number; sec: number; press: number; tickers: string[] }>;
    };
    /** zzz835: tile detail so a tile and its lists agree. `noCatalystFound` +
     *  `marketMoveOnly` + `context` = `noCatalyst`. `negativeImmaterial` of the
     *  `negative` count are immaterial tax / penalty items, listed apart from the
     *  material negative list (`view.negative`). */
    noCatalystFound?: number; negativeImmaterial?: number;
    /** zzz835: items whose card lists a value conflict (impact unknown). */
    conflicts?: number;
  };
  top3: ResearchItem[];
  /** Full research queue, 10–15, ranked by priority. */
  queue: ResearchItem[];
  /** Watch / investigate, 10–20. */
  watch: ResearchItem[];
  negative: ResearchItem[];
  /** zzz782: tax / penalty items under 0.25% of market cap — shown, not ranked as negative evidence. */
  immaterialNegative?: ResearchItem[];
  noCatalyst: ResearchItem[];
  /** Recent listings and other data-quality exclusions. */
  dataQuality: ResearchItem[];
  sourceFailures: Array<{ ticker: string; text: string; full: string; news?: ResearchItem['news'] }>;
  /** Filings WERE checked; only a secondary input (price history) failed.
   *  Kept apart so "not checked" means exactly that. (zzz773) */
  partialFailures?: Array<{ ticker: string; text: string; full: string }>;
  portfolio: ResearchItem[];
  /** zzz771: items whose only event is older than the move window (catalystFor === 'CONTEXT'),
   *  ranked by their own priority. Rendered collapsed under "Older filings — context, not the catalyst". */
  context?: ResearchItem[];
  /** zzz785: live events whose economics are Unknown — every one, ranked, labelled
   *  "Unknown — needs reading" (never dropped by the queue / watch caps). */
  needsReading?: ResearchItem[];
  // ── zzz835 (all optional; both markets) ──
  /** The top-of-page counts (spec §7). `conflicts` is read defensively from an
   *  optional `conflicts` array on each item (added by the classification code). */
  banner?: ViewBanner;
  /** One line: the criteria the board was read with (US: TradingView filters; India: the screener.in screen + cut-offs). */
  scanCriteria?: string | null;
  /** The OLDER FILINGS (CONTEXT) table, as rows — same shape for India and the US. */
  olderFilings?: OlderFilingRow[];
  /** Data-quality / large-move rows derivable from the scan without inventing:
   *  new listings with no comparable prior close, SPAC / ADR flags, moves at or
   *  above EXTREME_MOVE_PCT. */
  dataNotes?: DataNoteRow[];
  /** What the book check saw: how many held / watched names were supplied. Zero
   *  means "no match is possible", not "no gainer matched". */
  bookChecked?: { held: number; watch: number } | null;
}

/** Spec §7 — the top-of-report counts. */
export interface ViewBanner {
  market: 'IN' | 'US'; scanned: number;
  /** Verified events: filed / read, size judged (material or small). */
  verified: number;
  /** Events found but the impact or the source is unverified. */
  unverified: number;
  /** Items whose `conflicts` array is non-empty (headline value vs filed value etc.). */
  conflicts: number;
  /** Names with no material catalyst (no catalyst found + price-band only + older context only). */
  noMaterialCatalyst: number;
  negative: number;
  provisional: boolean;
}
export interface OlderFilingRow {
  ticker: string; name: string; company: string; movePct: number | null; filedDate: string | null; ageDays: number | null;
  event: string; eventLabel: string; material: string; url: string | null; moveDate: string | null;
}
export interface DataNoteRow {
  ticker: string; name: string; company: string; movePct: number | null;
  kind: 'new_listing' | 'spac' | 'adr' | 'extreme_move' | 'band_move';
  text: string;
}
/** A move at or above this % is flagged for a second look (a display rule, not a claim about cause). */
export const EXTREME_MOVE_PCT = 25;

export interface ResearchViewInput {
  /** zzz786 — US board window: live 1-day scan ('1D', default) or weekly export ('1W'). India is always '1D'. */
  moveWindow?: '1D' | '1W';
  market: 'IN' | 'US';
  findings: Record<string, Finding>;
  /** Today's scanned board (ticker, company, move, market cap, perf …). */
  board: Array<{ ticker: string; company: string | null; move_pct: number | null; market_cap?: number | null; perf?: any; turnover?: number | null; flags?: string[] | null }>;
  /** Filed-result rows from the graded funnel (the scan's queue rows). */
  filedResults: any[];
  /** Held tickers (upper-case) and watchlist tickers. */
  holdings: string[];
  watchlist?: string[];
  /** Optional per-holding thesis variable hints: ticker → variable keys. */
  thesisVariables?: Record<string, string[]>;
  errors?: string[];
  session?: ResearchView['session'];
  /** Optional (zzz770 AG-A): tickers sharing a theme with the book. */
  sameTheme?: string[];
  /** Optional ISO instant used to age a filed result that carries only a
   *  date. Never read from the clock: the builder stays deterministic. */
  now?: string | null;
  /** zzz785: catalyst records stored on earlier days (persistence-store
   *  loadCatalystRecords), keyed by id — a later gainer sees the prior state. */
  priorCatalysts?: Record<string, CatalystRecord> | null;
  // ── zzz835 (all optional) ──
  /** The moment the page is being looked at (ISO). Finality needs it: a scan
   *  taken at 15:43 ET is still provisional at 17:00 ET. Defaults to the scan instant. */
  viewedAt?: string | null;
  /** Company names looked up elsewhere (screener.in page / BSE map), keyed by ticker or scrip code. */
  companyNames?: Record<string, string> | null;
  /** The scan-criteria line for this board (shown under the header). */
  scanCriteria?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// small helpers
// ═══════════════════════════════════════════════════════════════════════════

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const r1 = (v: number) => Math.round(v * 10) / 10;
const pctS = (v: number | null | undefined) => (v == null ? 'Not disclosed' : `${v >= 0 ? '+' : ''}${r1(v).toFixed(1)}%`);
const money = (v: number, m: 'IN' | 'US') => (m === 'IN'
  ? `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : r1(v).toString()} Cr`
  : v >= 1000 ? `$${r1(v / 1000)}B` : `$${v >= 100 ? Math.round(v) : r1(v)}M`);
const up = (s: any) => String(s || '').trim().toUpperCase();
/** zzz787: a stated event value as stated — "₹153.76 Cr", never rounded to "₹154 Cr". */
const moneyExact = (v: number, m: 'IN' | 'US') => (m === 'IN'
  ? `₹${(Math.round(v * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`
  : money(v, m));

/** Source text keeps its words, but a shouted rating token is never passed
 *  through as if it were this page's instruction. */
function clean(s: any): string {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\b(BUY|SELL|EXIT|STOP)\b/g, (w) => w.toLowerCase())
    .replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// FILED RESULTS → EarningsMini
// Accepts a raw graded row, the scan's `filed_results` row, or a scan queue
// row carrying `filed: {...}`.
// ═══════════════════════════════════════════════════════════════════════════

interface FiledRow {
  ticker: string; company: string | null; tier: string | null; quarter: string | null;
  filingDate: string | null; ageDays: number | null; url: string | null;
  salesCurr: number | null; salesPrev: number | null; salesYoY: number | null;
  patCurr: number | null; patPrev: number | null; patYoY: number | null; epsYoY: number | null;
  ebitdaYoY: number | null; opm: number | null; opmPrev: number | null; cfoToPat: number | null;
  quartersSales: number[] | null; ttmRevenue: number | null; annualRevenue: number | null;
  guidanceRaised: boolean | null; guidanceLowered: boolean | null; concreteGuidance: boolean | null;
  orderBook: 'UP' | 'DOWN' | 'UNCHANGED' | 'NOT_STATED'; marketCap: number | null;
}

/** Whole calendar days between a filing and the reference midday. With a market,
 *  a timestamped filing is first put on that EXCHANGE's calendar date (an 8-K
 *  accepted 16:05 ET is that ET day, whatever its UTC date) — zzz835. */
function ageFrom(dateIso: string | null, now: string | null | undefined, market?: 'IN' | 'US'): number | null {
  if (!dateIso || !now) return null;
  let a: number;
  if (market && dateIso.length > 10) {
    const t = Date.parse(dateIso);
    a = Number.isFinite(t) ? Date.parse(`${exchangeDateOf(market, new Date(t))}T00:00:00Z`) : NaN;
  } else a = Date.parse(dateIso.length === 10 ? `${dateIso}T00:00:00Z` : dateIso);
  const b = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export function normaliseFiledRow(raw: any, now?: string | null, market?: 'IN' | 'US'): FiledRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw.filed && typeof raw.filed === 'object' ? { ...raw, ...raw.filed } : raw;
  const ticker = up(r.ticker || r.symbol);
  if (!ticker) return null;
  const qs = Array.isArray(r.quarters_sales) ? r.quarters_sales.map(num) : null;
  const q4 = qs && qs.length >= 4 ? qs.slice(-4) : null;
  const ttm = num(r.ttm_revenue_cr ?? r.ttm_revenue ?? r.revenue_ttm)
    ?? (q4 && q4.every((x: number | null) => x != null && x > 0) ? (q4 as number[]).reduce((s, x) => s + x, 0) : null);
  const filingDate = (r.filing_date || r.filed_date || r.filedDate || null) ? String(r.filing_date || r.filed_date || r.filedDate).slice(0, 10) : null;
  const age = num(r._ageDays ?? r.filed_days_ago ?? r.age_days) ?? ageFrom(filingDate, now, market);
  const ob = String(r.order_book_trend || r.order_book || '').toUpperCase();
  return {
    ticker, company: r.company ? clean(r.company) : null, tier: r.tier ? String(r.tier) : null, quarter: r.quarter ? String(r.quarter) : null,
    filingDate, ageDays: age, url: r.filing_url || r.release_url || r.source_url || null,
    salesCurr: num(r.sales_curr_cr), salesPrev: num(r.sales_prev_cr), salesYoY: num(r.sales_yoy_pct ?? r.revenue_yoy_pct),
    patCurr: num(r.pat_curr_cr), patPrev: num(r.pat_prev_cr), patYoY: num(r.pat_yoy_pct ?? r.net_profit_yoy_pct), epsYoY: num(r.eps_yoy_pct),
    ebitdaYoY: num(r.op_profit_yoy_pct ?? r.ebitda_yoy_pct), opm: num(r.opm_pct), opmPrev: num(r.opm_prev_pct),
    cfoToPat: num(r.ocf_to_pat_ratio ?? r.cfo_to_pat_ratio),
    quartersSales: qs && qs.every((x: number | null) => x != null) ? qs as number[] : null,
    ttmRevenue: ttm, annualRevenue: num(r.sales_annual_cr ?? r.annual_revenue_cr),
    guidanceRaised: typeof r.guidance_raised === 'boolean' ? r.guidance_raised : null,
    guidanceLowered: typeof r.guidance_lowered === 'boolean' ? r.guidance_lowered : null,
    concreteGuidance: typeof r.has_concrete_guidance === 'boolean' ? r.has_concrete_guidance : null,
    orderBook: ob === 'UP' || ob === 'DOWN' || ob === 'UNCHANGED' ? ob as any : 'NOT_STATED',
    marketCap: num(r.market_cap_cr ?? r.market_cap),
  };
}

/** A graded row trimmed to what the view reads — the scan response carries
 *  these as `filed_results` so the research route can rebuild the view from
 *  the cached scan without calling the grader again. */
export function compactFiledRow(r: any): Record<string, any> {
  const pick = ['ticker', 'company', 'tier', 'quarter', 'filing_date', '_ageDays', 'filing_url', 'release_url', 'market_cap_cr',
    'sales_curr_cr', 'sales_prev_cr', 'sales_yoy_pct', 'pat_curr_cr', 'pat_prev_cr', 'pat_yoy_pct', 'net_profit_yoy_pct', 'eps_yoy_pct',
    'op_profit_yoy_pct', 'opm_pct', 'opm_prev_pct', 'ocf_to_pat_ratio', 'cfo_to_pat_ratio', 'quarters_sales', 'sales_annual_cr',
    'guidance_raised', 'guidance_lowered', 'has_concrete_guidance'];
  const out: Record<string, any> = {};
  for (const k of pick) if (r && r[k] !== undefined && r[k] !== null) out[k] = r[k];
  return out;
}

export function earningsMiniOf(f: FiledRow): EarningsMini {
  const qs = f.quartersSales;
  const qoq = qs && qs.length >= 2 && qs[qs.length - 2] > 0 ? ((qs[qs.length - 1] / qs[qs.length - 2]) - 1) * 100 : null;
  const guidance: EarningsMini['guidance'] = f.guidanceRaised ? 'RAISED' : f.guidanceLowered ? 'CUT' : f.concreteGuidance ? 'MAINTAINED' : 'NOT_STATED';
  let keyChange: string | null = null;
  if (f.opm != null && f.opmPrev != null && Math.abs(f.opm - f.opmPrev) >= 3) keyChange = `Operating margin ${r1(f.opmPrev)}% → ${r1(f.opm)}% (${f.opm >= f.opmPrev ? '+' : ''}${r1(f.opm - f.opmPrev)}pp)`;
  else if (f.patYoY != null && f.salesYoY != null) keyChange = `PAT ${pctS(f.patYoY)} YoY on revenue ${pctS(f.salesYoY)} YoY`;
  else if (f.salesYoY != null) keyChange = `Revenue ${pctS(f.salesYoY)} YoY`;
  else if (f.patYoY != null) keyChange = `PAT ${pctS(f.patYoY)} YoY`;
  return {
    revenueYoY: f.salesYoY == null ? null : r1(f.salesYoY), revenueQoQ: qoq == null ? null : r1(qoq),
    ebitdaYoY: f.ebitdaYoY == null ? null : r1(f.ebitdaYoY), marginNow: f.opm, marginPrior: f.opmPrev,
    patYoY: f.patYoY == null ? null : r1(f.patYoY), cfoToPat: f.cfoToPat,
    guidance, orderBook: f.orderBook, keyChange, filedDaysAgo: f.ageDays,
    tier: f.tier, quarter: f.quarter, filedDate: f.filingDate, stale: f.ageDays != null && f.ageDays > CATALYST_WINDOWS.IN.recent,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TYPE + STAGE — at the data-model level.
// An LoI / MoU / board approval / proposal is never an order and never
// executed; an LoA received is AWARDED; an announcement is not revenue.
// ═══════════════════════════════════════════════════════════════════════════

const RX_ENABLING = /letter of intent|\bloi\b|memorandum of understanding|\bmou\b|term sheet|non-binding|in-principle|\bl1\b|lowest bidder|subject to (the )?(shareholder|regulatory|statutory|customer|lender|court|nclt|cci|sebi|stock exchange|final)? ?approvals?|board (has )?approv|approved by the board|approval of the board|board of directors (has )?approv|enabling resolution/i;
const RX_PROPOSED = /to consider|proposal|proposed|intends? to|plans? to|exploring|evaluat(e|ing)|intimation of board meeting/i;
const RX_RUMOUR = /reportedly|media report|news (report|item|article)|rumou?r|sources said|according to sources/i;
const RX_AWARDED = /letter of award|\bloa\b|work order|purchase order|receipt of (an? )?order|received (an? )?(order|contract|loa|work order|purchase order)|bag(s|ged|ging)|award(ed|s)?\b|secured|won\b|wins\b|order (worth|valued|of)/i;
const RX_SIGNED = /signed|signing|definitive agreement|share purchase agreement|\bspa\b|executed (an? )?agreement|entered into (an? )?(agreement|contract)/i;
const RX_OPERATIONAL = /commission(ed|ing)|commenced (commercial )?(production|operations)|started (commercial )?(production|operations)|inaugurat|ready for (commercial|operation)|capacity (rises|rose|increased|enhanced|augmented)|expansion completed|operational/i;
const RX_MONETIZING = /first (dispatch|supply|supplies|shipment|batch)|commercial (sales|supplies) (commenced|started|began)|began commercial sales|revenue (recogni[sz]ed|booked)/i;
const RX_EXECUTED = /completion of (the )?acquisition|completed (the )?acquisition|acquisition (completed|consummated)|allot(ted|ment)|consummat|closed the (deal|transaction)|approval (granted|received)|received (an? )?approval|granted/i;

function eventTypeOf(category: string | null, hay: string, negative: boolean): { type: EventType; label: string | null } {
  const c = String(category || '');
  if (negative) {
    if (c === 'order_cancellation' || c === 'customer_loss') return { type: 'Order cancellation', label: null };
    if (c === 'dilution') return { type: 'Fundraising', label: 'Offering / dilution' };
    if (c === 'auditor_resignation') return { type: 'Governance', label: 'Auditor change' };
    if (c === 'regulatory_investigation') return { type: 'Litigation / regulatory', label: null };
    if (c === 'tax_litigation') return { type: 'Litigation / regulatory', label: 'Tax demand / notice' };
    if (c === 'debt_stress') return { type: 'Debt / refinancing', label: 'Debt stress' };
    if (c === 'guidance_reduction') return { type: 'Guidance', label: 'Guidance cut' };
    if (c === 'project_delay') return { type: 'Accident / disruption', label: 'Project delay' };
    if (/fire|explosion|blast|accident|damage|shut ?down|suspen|strike|lock-?out|flood|force majeure|disruption|cyber/i.test(hay)) return { type: 'Accident / disruption', label: null };
    if (/resign|cessation|ceased|steps? down|stepped down|departure/i.test(hay)) return { type: 'Management change', label: 'Management departure' };
    if (/default|insolvency|nclt|cirp|winding up|accelerat/i.test(hay)) return { type: 'Debt / refinancing', label: 'Debt stress' };
    if (/delist|non-?compliance|going concern|restatement|non-reliance|qualified opinion|auditor/i.test(hay)) return { type: 'Governance', label: null };
    if (/cancel|terminat|loss of/i.test(hay)) return { type: 'Order cancellation', label: null };
    return { type: 'Litigation / regulatory', label: null };
  }
  switch (c) {
    case 'order_win': case 'backlog_increase': {
      if (/letter of intent|\bloi\b/i.test(hay)) return { type: 'Contract', label: 'Letter of intent (not an order)' };
      if (/memorandum of understanding|\bmou\b|term sheet|non-binding/i.test(hay)) return { type: 'Partnership', label: 'MoU / non-binding (not an order)' };
      if (/\bl1\b|lowest bidder/i.test(hay)) return { type: 'Contract', label: 'L1 bidder (award pending)' };
      if (/framework agreement|empanel/i.test(hay)) return { type: 'Contract', label: 'Framework / empanelment (no committed volume)' };
      // zzz787: a services / supply agreement is a contract — its term is a runway, not revenue (RNIT).
      if (/\b(services?|master services|supply|service level|outsourcing|maintenance|long[- ]term) (agreement|contract)\b/i.test(hay) && !/purchase order|work order|letter of award|\bloa\b/i.test(hay)) return { type: 'Contract', label: 'Services / supply agreement (contract, value not stated)' };
      return { type: 'Order win', label: /letter of award|\bloa\b/i.test(hay) ? 'Letter of award received' : null };
    }
    case 'quarterly_result': case 'margin_expansion': return { type: 'Earnings', label: null };
    case 'capacity_expansion': return { type: 'Capacity expansion', label: null };
    case 'production_ramp': case 'utilization_increase': return { type: 'Production ramp', label: null };
    case 'revenue_guidance_increase': return { type: 'Guidance', label: null };
    case 'regulatory_approval': case 'export_approval': return { type: 'Regulatory approval', label: null };
    case 'product_qualification': return { type: 'Regulatory approval', label: 'Qualification / certification' };
    case 'new_customer': case 'customer_ramp': return { type: 'Customer win', label: null };
    // zzz787: a new subsidiary / geography is a strategic expansion, never an acquisition or a customer win (ZIMLAB Chile).
    case 'new_geography': return { type: 'Strategic expansion', label: /subsidiar/i.test(hay) ? 'Strategic expansion — new subsidiary / geography' : 'Strategic expansion — new geography' };
    case 'new_product': return { type: 'New product', label: null };
    case 'acquisition': case 'open_offer':
      // zzz787: a merger / amalgamation combines businesses; an acquisition buys one.
      if (c === 'acquisition' && /amalgamat|\bmerger\b|merge with|scheme of amalgamation/i.test(hay) && !/demerger/i.test(hay)) return { type: 'Merger', label: 'Merger / amalgamation' };
      return { type: 'Acquisition', label: c === 'open_offer' ? 'Open offer / tender' : null };
    case 'strategic_investor': return { type: 'Strategic investment', label: 'Strategic investment — an outside strategic takes a stake' };
    case 'joint_venture': return /memorandum|\bmou\b|partnership|alliance/i.test(hay) ? { type: 'Partnership', label: null } : { type: 'JV', label: null };
    case 'demerger': case 'divestiture': return { type: 'Divestment', label: c === 'demerger' ? 'Demerger / scheme' : null };
    case 'fundraising': return { type: 'Fundraising', label: 'Financing (supply, not demand)' };
    case 'buyback': return { type: 'Capital allocation', label: 'Capital allocation — buyback' };
    case 'promoter_purchase': return { type: 'Promoter buying', label: 'Promoter stake purchase (insider buying)' };
    case 'management_change': return { type: 'Management change', label: null };
    case 'rating_action': return { type: 'Rating action', label: null };
    case 'pricing_increase': case 'cost_reduction': return { type: 'Pricing', label: null };
    case 'debt_reduction': return { type: 'Debt / refinancing', label: null };
    case 'restructuring': return { type: 'Governance', label: 'Restructuring' };
    default: return { type: 'No identified catalyst', label: null };
  }
}

function stageOf(type: EventType, findingStage: string | null, hay: string): Stage {
  if (type === 'Earnings') return 'MONETIZING';
  if (RX_RUMOUR.test(hay) && !RX_AWARDED.test(hay)) return 'RUMOUR';
  // Enabling language wins over any "received" in the same sentence: a
  // received LoI is still an LoI.
  if (findingStage === 'enabling' || RX_ENABLING.test(hay)) return RX_PROPOSED.test(hay) && !RX_ENABLING.test(hay) ? 'PROPOSED' : 'ENABLING';
  if (RX_PROPOSED.test(hay) && !RX_AWARDED.test(hay) && !RX_OPERATIONAL.test(hay)) return 'PROPOSED';
  if (RX_MONETIZING.test(hay)) return 'MONETIZING';
  if (type === 'Capacity expansion' || type === 'Production ramp') {
    if (findingStage === 'scheduled' && !RX_OPERATIONAL.test(hay)) return 'ENABLING';
    return RX_OPERATIONAL.test(hay) || type === 'Production ramp' || findingStage === 'executed' ? 'OPERATIONAL' : 'UNKNOWN';
  }
  if (type === 'Order win' || type === 'Customer win' || type === 'Contract') {
    if (RX_AWARDED.test(hay)) return 'AWARDED';
    if (RX_SIGNED.test(hay)) return 'SIGNED';
    return findingStage === 'executed' || findingStage === 'scheduled' ? 'AWARDED' : 'UNKNOWN';
  }
  if (type === 'Strategic expansion') return RX_EXECUTED.test(hay) || /incorporated|has been set up|commenced operations/i.test(hay) ? 'EXECUTED' : findingStage === 'executed' ? 'EXECUTED' : 'ENABLING';
  if (type === 'Promoter buying') return /propos|intend|will acquire/i.test(hay) ? 'PROPOSED' : 'EXECUTED';
  if (type === 'Acquisition' || type === 'Merger' || type === 'Divestment' || type === 'JV' || type === 'Partnership') {
    if (RX_EXECUTED.test(hay)) return 'EXECUTED';
    if (RX_SIGNED.test(hay)) return 'SIGNED';
    return findingStage === 'executed' ? 'SIGNED' : 'UNKNOWN';
  }
  if (type === 'Regulatory approval') return /granted|received|obtained|approv(ed|al)|certif|accredit/i.test(hay) ? 'EXECUTED' : 'UNKNOWN';
  if (type === 'Fundraising' || type === 'Buyback' || type === 'Capital allocation') return RX_EXECUTED.test(hay) ? 'EXECUTED' : 'ENABLING';
  if (RX_OPERATIONAL.test(hay)) return 'OPERATIONAL';
  if (RX_EXECUTED.test(hay) || findingStage === 'executed') return 'EXECUTED';
  return 'UNKNOWN';
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPACITY "from X to Y" — the only before/after a filing states in a line.
// ═══════════════════════════════════════════════════════════════════════════

const SCALE: Record<string, { mult: number; short: string }> = {
  million: { mult: 1e6, short: 'M' }, mn: { mult: 1e6, short: 'M' }, m: { mult: 1e6, short: 'M' },
  lakh: { mult: 1e5, short: ' lakh' }, lakhs: { mult: 1e5, short: ' lakh' }, crore: { mult: 1e7, short: ' Cr' },
  thousand: { mult: 1e3, short: 'K' }, k: { mult: 1e3, short: 'K' }, billion: { mult: 1e9, short: 'B' }, bn: { mult: 1e9, short: 'B' },
};

export function parseCapacityChange(text: string): { before: string; after: string; delta: string; pct: number; unit: string } | null {
  const sentences = String(text || '').split(/(?<=[.;])\s+/).filter((s) => /capacit/i.test(s));
  for (const s of sentences) {
    const m = /from\s+(~|about |approx\.? |approximately )?\s*([\d][\d,]*(?:\.\d+)?)\s*(million|mn|m|lakhs?|crore|thousand|k|billion|bn)?\b([^\d]{0,40}?)\bto\s+(~|about |approx\.? |approximately )?\s*([\d][\d,]*(?:\.\d+)?)\s*(million|mn|m|lakhs?|crore|thousand|k|billion|bn)?\b\s*([a-z][a-z ./%-]{0,30})?/i.exec(s);
    if (!m) continue;
    const a = parseFloat(m[2].replace(/,/g, '')), b = parseFloat(m[6].replace(/,/g, ''));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= a) continue;
    const sa = (m[3] || m[7] || '').toLowerCase(), sb = (m[7] || m[3] || '').toLowerCase();
    const ka = SCALE[sa] || { mult: 1, short: '' }, kb = SCALE[sb] || { mult: 1, short: '' };
    const A = a * ka.mult, B = b * kb.mult;
    if (B <= A) continue;
    const unit = String(m[8] || m[4] || '').replace(/\s*(\bper annum\b|\bper year\b|\ba year\b|\bannually\b|\bp\.a\.?|\/year\b|\/annum\b)/i, '/yr').replace(/\s+/g, ' ').replace(/[ .,;-]+$/, '').trim();
    const cleanUnit = unit.split(/\s+(with|and|at|in|by|from|which|through|for)\b/i)[0].trim();
    const approx = m[1] || m[5] ? '~' : '';
    const d = (B - A) / kb.mult;
    const dShort = `${r1(d).toLocaleString('en-US')}${kb.short}${!kb.short && cleanUnit ? ` ${cleanUnit}` : ''}`;
    return {
      before: `${approx}${m[2]}${ka.short}${cleanUnit ? ` ${cleanUnit}` : ''}`,
      after: `${approx}${m[6]}${kb.short}${cleanUnit ? ` ${cleanUnit}` : ''}`,
      delta: `+${dShort}`, pct: r1(((B - A) / A) * 100), unit: cleanUnit,
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MATERIALITY — strongest denominator first; the arithmetic is shown.
// ═══════════════════════════════════════════════════════════════════════════

type Band = [number, number];   // [significant ≥, moderate ≥]
const BANDS: Record<string, { revenue: Band; mcap: Band }> = {
  order: { revenue: [25, 10], mcap: [15, 5] },
  acquisition: { revenue: [30, 10], mcap: [20, 5] },
  capex: { revenue: [30, 10], mcap: [10, 3] },
  buyback: { revenue: [100, 100], mcap: [5, 2] },
  // zzz771: a raise is sized against market cap only (issue ÷ market cap).
  fundraise: { revenue: [100, 100], mcap: [10, 3] },
  generic: { revenue: [25, 10], mcap: [15, 5] },
};

function labelFor(pct: number, band: Band): Materiality['label'] {
  return pct >= band[0] ? 'SIGNIFICANT' : pct >= band[1] ? 'MODERATE' : 'SMALL';
}

/** zzz787 — a figure stated in a summary / subject / filing metadata but not
 *  verified in a READ document. No ratio is computed from it: "Stated order
 *  value: ₹153.76 Cr · Source: filing metadata/summary · Document
 *  verification: pending" and materiality UNKNOWN until it is read. */
export function pendingMateriality(value: number, market: 'IN' | 'US', what = 'value'): Materiality {
  return {
    label: 'UNKNOWN', ratios: [], verification: 'PENDING', confidence: 0, statedValue: value,
    explanation: `UNKNOWN — pending document verification. Stated ${what}: ${moneyExact(value, market)} · Source: filing metadata/summary · Document verification: pending. No ratio is computed from a figure the document has not confirmed.`,
  };
}

function valueMateriality(value: number | null, mcap: number | null, revenue: { v: number; basis: 'ttm_revenue' | 'annual_revenue' } | null, market: 'IN' | 'US', kind: keyof typeof BANDS, verifiedValue: boolean, renewal: boolean): Materiality {
  if (value == null || !(value > 0)) return { label: 'UNKNOWN', ratios: [], explanation: 'Event value: Not disclosed — materiality cannot be measured.' };
  // zzz787: NEVER a ratio from a figure the read document has not confirmed.
  if (!verifiedValue) return pendingMateriality(value, market, kind === 'order' ? 'order value' : kind === 'fundraise' ? 'issue size' : kind === 'capex' ? 'capex' : kind === 'acquisition' ? 'deal value' : 'value');
  const ratios: MaterialityRatio[] = [];
  const b = BANDS[kind];
  let label: Materiality['label'] = 'UNKNOWN';
  if (revenue && revenue.v > 0 && kind !== 'buyback') {
    const p = (value / revenue.v) * 100;
    ratios.push({ basis: revenue.basis, pct: r1(p), text: `${moneyExact(value, market)} ÷ ${money(revenue.v, market)} ${revenue.basis === 'ttm_revenue' ? 'TTM' : 'annual'} revenue = ${r1(p)}%` });
    label = labelFor(p, b.revenue);
  }
  if (mcap && mcap > 0) {
    const p = (value / mcap) * 100;
    ratios.push({ basis: 'market_cap', pct: r1(p), text: `${moneyExact(value, market)} ÷ ${money(mcap, market)} market cap = ${r1(p)}%` });
    if (label === 'UNKNOWN') label = labelFor(p, b.mcap);
  }
  if (!ratios.length) return { label: 'UNKNOWN', ratios: [], explanation: `Value ${moneyExact(value, market)} stated (document-verified); market cap and revenue Not disclosed — no denominator.`, verification: 'DOCUMENT_VERIFIED', confidence: 1, statedValue: value };
  const order: Materiality['label'][] = ['SMALL', 'MODERATE', 'SIGNIFICANT'];
  if (renewal && label !== 'UNKNOWN') label = order[Math.max(0, order.indexOf(label) - 1)];
  const basisTxt = ratios[0].basis === 'market_cap' ? 'market cap (no revenue figure on the row)' : 'revenue';
  const explanation = `${label === 'SIGNIFICANT' ? 'Large' : label === 'MODERATE' ? 'Meaningful' : 'Small'} relative to ${basisTxt}: ${ratios[0].text}.`
    + (renewal ? ' Reads as a renewal / re-announcement — one level lower.' : '')
    + ' Figure verified in the read document (evidence confidence 1.0).';
  return { label, ratios, explanation, verification: 'DOCUMENT_VERIFIED', confidence: 1, statedValue: value };
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNDRAISING (zzz771) — a preferential allotment to a named fund or the
// promoter is a potential catalyst with a dilution flag, not a negative event
// by default (ROSSTECH: preferential issue to SBI Mutual Fund at ₹1,166 was
// NEGATIVE, priority 3). It turns NEGATIVE only on distress markers, and a US
// resale / shelf registration is a supply overhang that raises nothing new.
// ═══════════════════════════════════════════════════════════════════════════

const RX_DISTRESS = /\bdefault(ed|s)?\b|\blenders?\b|one[- ]time settlement|\bots\b|working capital (shortfall|gap|stress|crunch)|going concern|restructuring of (the )?(debt|loans?|borrowings?|facilit)|debt restructuring|resolution plan|stressed asset|\bnpa\b/i;
// Matches the zzz771 reason text from classifyUsFiling, not the pre-zzz771
// "supply, dilution or resale overhang" wording that every registration carried.
const RX_RESALE = /resale \/ shelf|resale (registration|prospectus)|shelf registration|selling (stock|share)holders?/i;
// Named allottees: an entity phrase after "to" / "in favour of", ending in
// a corporate suffix, or the promoter group.
const RX_ALLOTTEE = /(?:\bto|in favou?r of|allottees?:?|subscribed by|by)\s+((?:(?:[A-Z][\w&'.-]*|of|and|&|de|the)\s+){0,7}(?:Mutual Fund|Fund|Trust|Capital|LLP|Limited|Ltd\.?|Pvt\.?|Private Limited|Investments?|Holdings?|AIF|Insurance|Bank|Partners|Ventures|Advisors|Advisers|Management|Securities|Corporation|Inc\.?|Group|Company|Co\.?))(?![\w-])/g;

export function allotteesOf(text: string): string[] {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out: string[] = [];
  for (const m of t.matchAll(RX_ALLOTTEE)) {
    const name = m[1].replace(/[\s,.]+$/, '').trim();
    if (!name || /^(the )?(company|board|issuer|exchange|bse|nse)\b/i.test(name) || name.split(' ').length < 2 && !/Fund|Trust|Bank/.test(name)) continue;
    if (!out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  if (/\bpromoter/i.test(t) && !out.some((x) => /promoter/i.test(x))) out.push(/promoter group/i.test(t) ? 'promoter group' : 'promoters');
  return out.slice(0, 4);
}

interface FundraiseRead { cls: EventClass; label: string; mat: Materiality; allottees: string[]; distress: boolean; resale: boolean; named: boolean; missing: string[] }

/** zzz785: a raise's materiality is Unknown until amount, issue price,
 *  allottees AND dilution are known — this names the missing ones. */
export function fundraiseMissing(hay: string, value: number | null, named: boolean, sf: StructuredFacts | null): string[] {
  const e = sf?.economics;
  const miss: string[] = [];
  if (value == null && e?.valueNative == null) miss.push('amount');
  if (e?.issuePrice == null && !/(?:at|price of|issue price|@)\s*(?:₹|rs\.?|inr|\$)\s*[\d,.]+|(?:₹|rs\.?|inr|\$)\s*[\d,.]+\s*(?:per|each|a) (?:equity )?(?:share|warrant|unit)/i.test(hay)) miss.push('issue price');
  if (!named && !(e?.allottees && e.allottees.length)) miss.push('allottees');
  if (e?.dilutionPct == null && !/\d+(?:\.\d+)?\s*%\s*(?:dilution|of (?:the )?(?:post[- ]issue|paid[- ]up|expanded|share capital|equity))/i.test(hay)) miss.push('dilution');
  return miss;
}

function fundraisingOf(hay: string, stage: Stage, value: number | null, mcap: number | null, market: 'IN' | 'US', verifiedValue: boolean, usRegistration: boolean, sf: StructuredFacts | null = null): FundraiseRead {
  const resale = usRegistration && RX_RESALE.test(hay);
  const distress = RX_DISTRESS.test(hay);
  const allottees = allotteesOf(hay);
  const named = allottees.length > 0;
  if (resale) return { cls: 'NO_CATALYST', label: 'Resale registration (supply overhang) — not a new raise', mat: { label: 'UNKNOWN', ratios: [], explanation: 'No new proceeds: existing or future stock registered for sale — nothing to size against market cap. A resale overhang does not by itself mean the price must fall.' }, allottees, distress, resale, named, missing: [] };
  const mat0 = valueMateriality(value ?? sf?.economics.valueNative ?? null, mcap, null, market, 'fundraise', verifiedValue, false);
  if (mat0.ratios.length) mat0.explanation = mat0.explanation.replace(/^(Large|Meaningful|Small) relative to market cap \(no revenue figure on the row\)/, '$1 issue relative to market cap');
  const missing = fundraiseMissing(hay, value, named, sf);
  // The issue ÷ market cap ratio is kept as SCALE; the label says Unknown
  // while any of amount / price / allottees / dilution is missing. (zzz785)
  const mat: Materiality = missing.length
    ? { label: 'UNKNOWN', ratios: mat0.ratios, verification: mat0.verification ?? null, confidence: mat0.confidence, statedValue: mat0.statedValue ?? null,
      explanation: `Materiality: Unknown — missing: ${missing.join(', ')}.${mat0.ratios.length ? ` Scale only: ${mat0.ratios[0].text}.` : mat0.verification === 'PENDING' && mat0.statedValue != null ? ` Stated issue size ${moneyExact(mat0.statedValue, market)} — document verification pending, so no ratio.` : ''}` }
    : mat0;
  const label = `Fundraising — ${named ? allottees.join(', ') : 'allottees not stated'}`;
  if (distress) return { cls: 'NEGATIVE', label: `${label} (distress markers)`, mat, allottees, distress, resale, named, missing };
  const cls: EventClass = stage === 'EXECUTED' && mat0.label === 'SMALL' ? 'CONFIRMED_LOW_MATERIALITY' : 'POTENTIAL_UNVERIFIED';
  return { cls, label, mat, allottees, distress, resale, named, missing };
}

function earningsMateriality(e: EarningsMini | null, f: FiledRow | null, market: 'IN' | 'US'): Materiality {
  if (!e || (e.revenueYoY == null && e.patYoY == null)) return { label: 'UNKNOWN', ratios: [], explanation: 'Result filed; revenue and PAT change Not disclosed on the row.' };
  const rv = Math.abs(e.revenueYoY ?? 0), pt = Math.abs(e.patYoY ?? 0);
  const label: Materiality['label'] = rv >= 25 || pt >= 50 ? 'SIGNIFICANT' : rv >= 10 || pt >= 20 ? 'MODERATE' : 'SMALL';
  const parts: string[] = [];
  if (e.revenueYoY != null) parts.push(`revenue ${f && f.salesPrev != null && f.salesCurr != null ? `${money(f.salesPrev, market)} → ${money(f.salesCurr, market)} = ` : ''}${pctS(e.revenueYoY)} YoY`);
  if (e.patYoY != null) parts.push(`PAT ${f && f.patPrev != null && f.patCurr != null ? `${money(f.patPrev, market)} → ${money(f.patCurr, market)} = ` : ''}${pctS(e.patYoY)} YoY`);
  return { label, ratios: [], explanation: `Versus the prior-year quarter: ${parts.join('; ')}.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// per-type research content
// ═══════════════════════════════════════════════════════════════════════════

const NEXT: Record<string, string[]> = {
  // zzz782: research questions per EVENT TYPE — what the owner needs to know
  // next for that kind of event, not one generic list.
  // zzz785: specific, checkable questions — each names what to look for and where.
  order: ['Order value stated? What % of last full-year revenue is it?', 'Execution period and when billing starts — stated in the filing?', 'Customer named? A repeat customer (earlier orders in the catalyst timeline)?', 'Order book after this order ÷ trailing revenue — from the latest investor presentation', 'Margin on this order versus the company average — ask at the next concall', 'Is capacity in place to execute it, or is new capex needed?', 'Advance received / payment milestones (working capital need)?', 'Client concentration: share of revenue from this customer?'],
  order_recurring: ['Is the stated annual value recurring for the full programme life — how many years does the programme run?', 'Are these fixed contracts, or initial awards that scale up or down with the customer\'s build rate?', 'What % of FY revenue does the annual value add?', 'What margin do the programmes carry versus the company average?', 'What capacity is needed, and is it already in place?', 'When does production start, and when does it reach the full annual run-rate?', 'Are further programmes being qualified with the same customer or new ones?', 'What working capital or advances does it need?'],
  enabling: ['Chain: MoU / LoI → definitive agreement → approvals → binding order → supply start → revenue — which step is next?', 'What has to happen before this becomes a binding order (definitive agreement, approvals)?', 'Is a value, volume or price disclosed anywhere?', 'Who is the counterparty and how firm is its commitment?', 'By when is conversion to an order expected?'],
  enabling_realestate: ['Chain: MoU / JDA → definitive agreement → approvals → execution → launch → bookings → collections → revenue → profit — which step is next?', 'What is the company\'s own share of revenue or profit (the project GDV is not the company\'s revenue)?', 'Which approvals are needed before a definitive agreement or launch, and by when?', 'When is the project launch expected?', 'What bookings and collections are expected in the first year after launch?', 'Who is the land owner / partner, and how firm is the commitment?'],
  capacity: ['Capacity before → after, in units — stated?', 'Capex amount and how it is funded (debt / internal accruals / raise)?', 'Commissioning date — already done, or expected when?', 'Current utilisation of the existing capacity (last concall / annual report)?', 'Demand for the new capacity: orders, offtake or a named customer?', 'Revenue at full utilisation (asset turn) — stated or guided?', 'How long is the ramp to full utilisation?', 'Approvals still pending (environment, customer audit)?'],
  qualification: ['Which customer and which product / programme — named in the filing?', 'Stage: sample, pilot, approved vendor or commercial supply?', 'Is there a commercial purchase order yet — value and quantity?', 'When do commercial supplies start?', 'Does it cover future orders (programme life) or one lot?', 'How many customers is the company now qualified with?', 'Is capacity in place to serve it?'],
  acquisition: ['What price was paid, and at what valuation (EV / sales, EV / EBITDA)?', 'Target\'s last-year revenue and profit — stated?', 'How is it funded — cash, debt or new shares (dilution if shares)?', 'Stake acquired, completion date and conditions still pending?', 'When does it start adding to consolidated revenue and profit?', 'Why this target: capability, customers or geography?', 'Integration risks: key people, customer overlap, approvals?', 'Is the contribution recurring, or a one-off gain?'],
  earnings: ['Did management raise, hold or cut guidance?', 'What is the order book / pipeline after this quarter?', 'Does CFO track PAT (cash conversion)?', 'Which drivers explain the change — volume, price, mix or one-offs?', 'Is the margin change repeatable next quarter?'],
  approval: ['What products or markets does it open, and how large are they?', 'When do commercial supplies start?', 'Which competitors already hold the same approval?', 'What revenue has management attached to it?'],
  customer: ['How large is the customer\'s annual spend with the company?', 'What margin and payment terms apply?', 'When does supply start, and at what run-rate?', 'Does it raise customer concentration?'],
  product: ['Target market and its size — stated by the company?', 'Launched and commercially available, or announced only?', 'Named customers or orders so far?', 'Pricing and expected gross margin?', 'When does revenue start, and at what scale?', 'Repeat revenue (consumables, subscriptions) or a one-time sale?', 'Approvals or certifications still needed?'],
  fundraising: ['Amount raised — stated?', 'Issue price and discount / premium to the market — stated?', 'Allottees named (promoter, fund, strategic investor, public)?', 'Dilution: new shares ÷ existing shares — stated, or computable from stated share counts?', 'Use of proceeds — capex, debt repayment, acquisition or working capital?', 'Lock-in on the allotted shares?', 'Warrants: conversion price, timeline and upfront amount paid?'],
  strategic: ['Who is the investor — an industry (strategic) or a financial holder?', 'Stake size and price — in an official filing (SAST / 13D / exchange disclosure)?', 'Is the stake confirmed by an official filing, or press only?', 'Any board seat, supply or technology agreement with the investor?', 'Primary shares (money to the company) or bought from existing holders?'],
  resale: ['How many shares are registered for resale versus shares outstanding?', 'Who are the selling holders, and are any shares locked up?', 'At what price did the holders get the shares (incentive to sell)?', 'Form 4 / 144 filings — are holders actually selling?', 'A resale overhang does not by itself mean the price must fall — check volume against sales.'],
  buyback: ['Buyback size versus market cap and free float?', 'Price versus the current market?', 'Tender or open market?', 'Is the promoter participating?'],
  // zzz787 — questions for the new event types.
  contract_term: ['Contract value stated — total, or per year? (not yet quantified)', 'Is the revenue recurring across the stated term (fees each year), or billed on milestones?', 'Renewal / extension terms after the stated term?', 'When does execution and billing start, and at what run-rate?', 'Customer named — and a repeat customer?', 'Margin on the contract versus the company average — ask at the next concall'],
  licence_capacity: ['Demand: orders, offtake agreements or named customers for the licensed / installed volume?', 'Current utilisation of the existing capacity — would the new volume be sold?', 'When does commercial production start?', 'Revenue at full volume — stated or guided?', 'Capex needed to use it, and how it is funded?', 'Conditions attached (renewal, quotas, approvals)?'],
  merger: ['Swap ratio / consideration and the resulting dilution per share?', 'Combined revenue and profit — stated?', 'Approvals pending (board, shareholders, NCLT, CCI) and the effective date?', 'Why merge: simplification, synergies, or a change in promoter holding?', 'Are minority shareholders better or worse off per share?'],
  strategic_expansion: ['What will the new entity / geography sell, and to whom?', 'Investment committed and how it is funded?', 'When is the first revenue, order or licence expected?', 'Any customer, partner or distributor named?', 'Regulatory approvals needed in the new market?'],
  promoter_buying: ['Shares bought and price paid — stated in the SAST / insider-trading disclosure?', 'Promoter holding before and after the purchase?', 'Open-market purchase, or conversion of warrants / a preferential allotment?', 'Is the buying repeated across disclosures, or one-off?', 'Any pledge on the promoter\'s shares?'],
  capital_allocation: ['Size versus market cap and free float?', 'Funded from free cash flow or from borrowing?', 'Price versus the current market (for a buyback)?', 'Payout as a share of free cash flow (for a dividend)?', 'Is the promoter participating?'],
  guidance: ['What exactly changed versus prior guidance?', 'What drives the new guidance?', 'How has management tracked against past guidance?'],
  management: ['Who joined or left, and from where?', 'Planned succession or abrupt?', 'Does it affect execution of stated plans?'],
  rating: ['Which agency, from what to what?', 'What drove the change — leverage, cash flow, scale?', 'Does it change borrowing cost?'],
  pricing: ['Price change versus input cost?', 'Is it sticky across the industry?', 'Margin effect next quarter?'],
  denial: ['Check turnover and delivery % behind the move.', 'Check bulk/block deals and shareholding changes.', 'Check sector and peer moves in the same session.', 'Watch for a later filing that explains the move.'],
  negative: ['Size the impact on revenue and EBITDA.', 'Is it one-off or recurring?', 'Does it change the thesis or the balance sheet?', 'Is insurance, a penalty cap or a reversal possible?'],
  none: ['Check liquidity and turnover versus the 1-week average.', 'Check technical drivers (breakout, band, circuit).', 'Check sector and peer moves in the same session.', 'Check bulk/block deals and news flow.'],
  band: ['Check how many shares actually traded at the band.', 'Check whether the price band was revised.', 'Check sector moves in the same session.'],
  listing: ['Wait for comparable price history.', 'Compare with the issue price.', 'Read the offer document for use of proceeds.'],
  unavailable: ['Re-run research when the source is reachable.', 'Open the exchange filing page directly.', 'Do not treat the name as "no catalyst" until checked.'],
  unclassified: ['Open the unclassified filing — the subject line was generic.', 'Check whether it states a value, counterparty or date.', 'Check sector and peer moves in the same session.'],
  generic: ['What exactly changed, with numbers?', 'How does it reach revenue or margin?', 'Is it repeatable?'],
};

// ═══════════════════════════════════════════════════════════════════════════
// zzz789 — EVENT-SPECIFIC LABELS AND ORDERED RESEARCH CHECKLISTS.
// A stated figure is labelled for what it IS (MILKYMIST ₹40 Cr is capex, not
// an "order value"). Research Next is an ordered checklist per event kind;
// a step the documents already answer is marked answered WITH the fact and is
// never re-asked. Unknown is not negative.
// ═══════════════════════════════════════════════════════════════════════════

const DEBT_INSTRUMENT = (h: string): string => (/\bncds?\b|non[- ]convertible debentures?/i.test(h) ? 'NCDs' : /debentures?/i.test(h) ? 'debentures' : /\bbonds?\b/i.test(h) ? 'bonds' : /\bnotes?\b/i.test(h) ? 'notes' : /term loan/i.test(h) ? 'term loan' : /\bloans?\b/i.test(h) ? 'loan' : /facilit/i.test(h) ? 'facility' : 'debt');

/** What a stated figure is, by event type: short noun + lower-case label. */
export function valueLabelOf(type: EventType, hay: string): { short: string; label: string } {
  switch (type) {
    case 'Order win': case 'Customer win': return { short: 'Order', label: 'order value' };
    case 'Contract': return /\b(services?|master services|supply|service level|outsourcing|maintenance)\s+(agreement|contract)\b/i.test(hay) && !/purchase order|work order|letter of award|\bloa\b/i.test(hay) ? { short: 'Contract', label: 'contract value' } : { short: 'Order', label: 'order value' };
    case 'Order cancellation': return { short: 'Order cancelled', label: 'cancelled order value' };
    case 'Capacity expansion': case 'Production ramp': return { short: 'Capex', label: 'capex' };
    case 'Acquisition': return { short: 'Purchase consideration', label: 'purchase consideration' };
    case 'Merger': return { short: 'Deal consideration', label: 'deal consideration' };
    case 'Divestment': return { short: 'Sale consideration', label: 'sale consideration' };
    case 'JV': case 'Partnership': return /\binvest/i.test(hay) ? { short: 'Investment', label: 'investment' } : { short: 'Stated value', label: 'stated value' };
    case 'Fundraising': return { short: 'Issue size', label: 'issue size' };
    case 'Debt / refinancing': { const a = debtActionOf(hay) || 'raised'; return { short: `Amount ${a}`, label: `amount ${a}` }; }
    case 'Strategic investment': case 'Promoter buying': return { short: 'Stake value', label: 'stake value' };
    case 'Buyback': case 'Capital allocation': return /dividend/i.test(hay) ? { short: 'Payout', label: 'payout' } : { short: 'Buyback size', label: 'buyback size' };
    case 'Strategic expansion': return { short: 'Investment', label: 'investment' };
    case 'Regulatory approval': case 'New product': return /\b(capex|capital expenditure|invest\w*|plant|facility|capacity)\b/i.test(hay) ? { short: 'Capex', label: 'capex' } : { short: 'Stated value', label: 'stated value' };
    case 'Litigation / regulatory': return { short: 'Amount demanded', label: 'amount demanded' };
    default: return { short: 'Stated value', label: 'stated value' };
  }
}

interface CheckCtx {
  facts: StructuredFacts[]; legacy: Record<string, string>; hay: string; read: boolean;
  value: number | null; valueVerified: boolean; statedPotential: number | null; market: 'IN' | 'US';
  revenue: number | null; marketCap: number | null; contractYears: number | null; officialFilings: number; type: EventType;
  /** Secondary-only (press / unverified): nothing is marked answered — press is not a verified fact. */
  secondary?: boolean;
}
type Ans = (c: CheckCtx) => string | null;
interface Step { label: string; q: string; ans?: Ans }
const firstFact = <T,>(c: CheckCtx, f: (x: StructuredFacts) => T | null | undefined): T | null => { for (const x of [...c.facts].reverse()) { const v = f(x); if (v != null && v !== '') return v as T; } return null; };
const grab = (rx: RegExp, max = 80): Ans => (c) => { const m = rx.exec(c.hay); return m ? m[0].replace(/\s+/g, ' ').trim().slice(0, max) : null; };
const pctOf = (v: number, base: number) => Math.round((v / base) * 1000) / 10;
const A = {
  size: ((c) => {
    // A stated "potential" is not an answer: the step stays open (RAYMOND ~₹33 Cr a year).
    if (c.value == null) return c.statedPotential != null ? null : (c.legacy.value ? `${c.legacy.value} (as stated)` : null);
    if (!c.valueVerified) return `${moneyExact(c.value, c.market)} stated · document verification pending (no % computed)`;
    const parts = [moneyExact(c.value, c.market)];
    if (c.revenue) parts.push(`≈ ${pctOf(c.value, c.revenue)}% of TTM revenue`);
    else if (c.marketCap) parts.push(`≈ ${pctOf(c.value, c.marketCap)}% of market cap`);
    return parts.join(' · ');
  }) as Ans,
  margin: ((c) => c.legacy.margin || grab(/\b\d+(?:\.\d+)?\s*%\s*(?:ebitda |operating |gross |pat )?margin\b|\bmargin of \d+(?:\.\d+)?\s*%/i)(c)) as Ans,
  period: ((c) => firstFact(c, (x) => x.time.executionPeriod) || c.legacy.execution_period || (c.contractYears != null ? `${c.contractYears}-year term (contract runway, as stated)` : null)
    || grab(/\b(?:execut\w*|complet\w*|deliver\w*|suppl\w*)\s+(?:with)?(?:in|over)\s+(?:a period of\s+)?\d{1,3}\s*months?/i)(c)) as Ans,
  customer: ((c) => firstFact(c, (x) => x.event.counterparty) || c.legacy.counterparty || null) as Ans,
  workingCapital: ((c) => c.legacy.working_capital || grab(/\b(?:mobili[sz]ation )?advance (?:of|payment|received)[^.;]{0,50}|\bpayment terms?[^.;]{0,50}|milestone[- ]based payments?[^.;]{0,40}/i)(c)) as Ans,
  repeat: ((c) => (c.officialFilings >= 2 ? `${c.officialFilings} official filings on this catalyst` : grab(/\brepeat order[^.;]{0,50}/i)(c))) as Ans,
  capex: ((c) => { const v = firstFact(c, (x) => x.economics.capex); if (v != null) return `${moneyExact(v, c.market)} (as stated)`; return (c.type === 'Capacity expansion' || c.type === 'Production ramp' || /capex|invest/i.test(c.hay)) ? A.size(c) : null; }) as Ans,
  commissioning: ((c) => firstFact(c, (x) => (x.event.stage === 'COMMISSIONED' ? 'commissioned (as stated)' : x.time.expectedCompletion ? `expected ${x.time.expectedCompletion} (as stated)` : null))
    || grab(/\b(?:has been |was |successfully )?commissioned\b[^.;]{0,40}|\bcommenced commercial (?:production|operations)[^.;]{0,30}|\bfirst power\b[^.;]{0,40}/i)(c)) as Ans,
  utilisation: grab(/\butili[sz]ation[^.;]{0,30}?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*utili[sz]ation/i),
  demand: ((c) => (DEMAND_WORDS.test(c.hay) ? grab(DEMAND_WORDS, 60)(c) : null)) as Ans,
  revenue: grab(/\brevenue (?:of|from|contribution of)\s*(?:about |approximately |~)?(?:₹|rs\.?|inr|\$|usd)\s*[\d,.]+\s*(?:crores?|cr\b|lakhs?|million|mn\b|billion|bn\b)?/i),
  ebitda: grab(/\bebitda (?:of|margin of)\s*(?:about |~)?(?:(?:₹|rs\.?|inr|\$|usd)\s*[\d,.]+\s*(?:crores?|cr\b|million|mn\b|billion)?|\d+(?:\.\d+)?\s*%)/i),
  price: ((c) => { const v = firstFact(c, (x) => x.economics.considerationNative); return v != null ? `${moneyExact(v, c.market)} (as stated)` : A.size(c); }) as Ans,
  targetEcon: ((c) => { const r = firstFact(c, (x) => x.economics.targetRevenueNative), p = firstFact(c, (x) => x.economics.targetProfitNative); const bits = [r != null ? `revenue ${moneyExact(r, c.market)}` : null, p != null ? `EBITDA / profit ${moneyExact(p, c.market)}` : null].filter(Boolean); return bits.length ? bits.join(', ') : grab(/\b(?:revenue|turnover|ebitda)\s+of\s+(?:₹|rs\.?|inr|\$|usd)\s*[\d,.]+\s*(?:crores?|cr\b|million|mn\b|billion|bn\b)?/i)(c); }) as Ans,
  funding: ((c) => c.legacy.funding || firstFact(c, (x) => ((x as any).terms || []).find((t: any) => /financ|fund/i.test(t.label))?.value) || grab(/\b(?:funded|financed) (?:through|by|from|with)[^.;]{0,60}|\binternal accruals\b|\ball[- ]cash\b[^.;]{0,30}/i)(c)) as Ans,
  contribution: grab(/\b(?:earnings[- ]accretive|accretive to (?:eps|earnings)|eps[- ]accretive)[^.;]{0,40}/i),
  stake: ((c) => { const v = firstFact(c, (x) => x.economics.stakePct); return v != null ? `${v}%` : grab(/\b\d+(?:\.\d+)?\s*%\s*(?:stake|of the (?:paid[- ]up|share capital|equity))/i)(c); }) as Ans,
  issuePrice: ((c) => { const v = firstFact(c, (x) => x.economics.issuePrice); return v != null ? `${c.market === 'US' ? '$' : '₹'}${v} per share (as stated)` : grab(/(?:issue price|at a price) of\s*(?:₹|rs\.?|inr|\$)\s*[\d,.]+/i)(c); }) as Ans,
  dilution: ((c) => { const v = firstFact(c, (x) => x.economics.dilutionPct); return v != null ? `${v}% (as stated)` : null; }) as Ans,
  proceeds: grab(/\buse of proceeds[^.;]{0,60}|\bproceeds (?:will be |shall be )?used (?:for|to)[^.;]{0,60}|\bto fund\b[^.;]{0,50}/i),
  rate: ((c) => firstFact(c, (x) => ((x as any).terms || []).find((t: any) => /rate/i.test(t.label))?.value) || grab(/\b\d+(?:\.\d+)?\s?%\s*(?:senior |secured |unsecured |convertible )*(?:notes|debentures|ncds?|bonds|coupon)|\binterest (?:rate )?of \d+(?:\.\d+)?\s?%/i)(c)) as Ans,
  maturity: ((c) => firstFact(c, (x) => ((x as any).terms || []).find((t: any) => /maturity/i.test(t.label))?.value) || grab(/\bdue (?:in )?\d{4}\b|\bmatur\w* (?:on |in )?[A-Z]?[a-z]* ?\d{0,2},? ?\d{4}/i)(c)) as Ans,
  interestSaved: grab(/\b(?:interest (?:cost |expense )?sav\w*|reduce (?:its )?interest (?:cost|expense))[^.;]{0,50}/i),
  leverage: grab(/\b(?:net debt|leverage|debt[- ]to[- ]equity)[^.;]{0,50}\d[^.;]{0,20}/i),
  qualifiedCap: ((c) => firstFact(c, (x) => x.economics.capacityAfter) || grab(/~?\s*\d[\d,.]*\s*(?:million|mn|lakh)?\s*(?:bl\b|bulk lit(?:re|er)s?|tpa|mtpa|ktpa|mw|mwh|units|tonnes|pieces)(?:\s*(?:per annum|a year|p\.a\.))?/i)(c)) as Ans,
  commercialOrder: grab(/\bpurchase order[^.;]{0,50}|\bcommercial (?:order|supply|supplies)[^.;]{0,40}|\bsupply order[^.;]{0,40}/i),
  production: grab(/\bcommercial (?:production|supplies) (?:start|commenc)\w*[^.;]{0,40}|\bproduction (?:starts|will start|commences)[^.;]{0,40}|\bfrom (?:fy|q[1-4])\s?\d{2,4}[^.;]{0,20}/i),
  buyer: ((c) => firstFact(c, (x) => x.event.counterparty) || c.legacy.counterparty || null) as Ans,
  swap: grab(/\b(?:swap ratio|share exchange ratio|exchange ratio)[^.;]{0,50}|\b\d+\s+(?:equity )?shares? (?:of|in) [^.;]{0,40}for (?:every )?\d+/i),
  ownership: grab(/\b(?:post[- ](?:merger|scheme|issue)|promoter) (?:shareholding|holding)[^.;]{0,40}\d[^.;]{0,10}%?/i),
  synergy: grab(/\bsynerg\w*[^.;]{0,60}/i),
  launch: grab(/\b(?:launched|commercially available|available (?:in|across|from))[^.;]{0,50}/i),
  pricing: grab(/\bpriced at[^.;]{0,40}|\bprice of (?:₹|rs\.?|\$)\s*[\d,.]+[^.;]{0,20}/i),
  setup: grab(/\b(?:incorporated|registered|licen[cs]e (?:granted|received)|commenced operations)[^.;]{0,60}/i),
  investment: ((c) => A.size(c) || grab(/\binvest\w*\s+(?:of\s+)?(?:up to\s+)?(?:₹|rs\.?|inr|\$|usd)\s*[\d,.]+\s*(?:crores?|cr\b|million|mn\b|billion)?/i)(c)) as Ans,
  rationale: grab(/\b(?:rationale|strategic (?:rationale|fit)|to (?:strengthen|expand|access|enter))[^.;]{0,60}/i),
  governance: grab(/\b(?:board seat|nominee director|right to nominate|supply agreement|technology agreement|commercial agreement)[^.;]{0,40}/i),
};

const ORDER_STEPS = (repeatQ: string, what = 'Order value'): Step[] => [
  { label: what, q: `is the ${what.toLowerCase()} stated, and what % of last full-year revenue is it?`, ans: A.size },
  { label: 'Margin', q: 'margin on this order versus the company average — ask at the next concall', ans: A.margin },
  { label: 'Execution period', q: 'over what period is it executed, and when does billing start?', ans: A.period },
  { label: 'Customer', q: 'is the customer named — a repeat customer (earlier orders in the catalyst timeline)?', ans: A.customer },
  { label: 'Working capital', q: 'advance received / payment milestones — what working capital does it need?', ans: A.workingCapital },
  { label: 'Repeatability', q: repeatQ, ans: A.repeat },
];
const CHECKLISTS: Record<string, Step[]> = {
  order: ORDER_STEPS('repeat orders from this customer or programme — any on file, or is this a one-off?'),
  customer: ORDER_STEPS('repeat orders from this customer — any on file, or is this a one-off?'),
  contract_term: ORDER_STEPS('is the revenue recurring across the stated term (fees each year), or billed on milestones — and what are the renewal terms?', 'Contract value'),
  order_recurring: ORDER_STEPS('is the stated annual value recurring for the full programme life — fixed contracts, or initial awards that scale with the customer\'s build rate?'),
  acquisition: [
    { label: 'Purchase price', q: 'what price was paid, and at what valuation (EV / sales, EV / EBITDA)?', ans: A.price },
    { label: 'Target revenue / EBITDA', q: 'the target\'s last-year revenue and EBITDA — stated?', ans: A.targetEcon },
    { label: 'Funding', q: 'how is it funded — cash, debt or new shares (dilution if shares)?', ans: A.funding },
    { label: 'Contribution', q: 'when does it start adding to consolidated revenue and profit, and is it accretive?', ans: A.contribution },
    { label: 'Integration', q: 'integration risks — key people, customer overlap, approvals still pending?' },
  ],
  capacity: [
    { label: 'Capex', q: 'capex amount and how it is funded (debt / internal accruals / raise)?', ans: A.capex },
    { label: 'Commissioning', q: 'commissioned already, or expected when?', ans: A.commissioning },
    { label: 'Utilisation', q: 'current utilisation of the existing and the new capacity (last concall / annual report)?', ans: A.utilisation },
    { label: 'Demand / offtake', q: 'orders, offtake or a named customer for the new capacity?', ans: A.demand },
    { label: 'Revenue', q: 'revenue at full utilisation (asset turn) — stated or guided?', ans: A.revenue },
    { label: 'EBITDA', q: 'EBITDA / margin expected from the new capacity?', ans: A.ebitda },
  ],
  product: [
    { label: 'Customers', q: 'named customers or orders so far?', ans: A.customer },
    { label: 'Commercial availability', q: 'launched and commercially available, or announced only?', ans: A.launch },
    { label: 'Pricing', q: 'pricing and expected gross margin?', ans: A.pricing },
    { label: 'Revenue', q: 'when does revenue start, and at what scale?', ans: A.revenue },
    { label: 'Repeatability', q: 'repeat revenue (consumables, subscriptions) or a one-time sale?' },
  ],
  strategic_expansion: [
    { label: 'Investment', q: 'investment committed and how it is funded?', ans: A.investment },
    { label: 'Regulatory / commercial setup', q: 'approvals, licences and commercial set-up needed in the new market?', ans: A.setup },
    { label: 'Customers', q: 'what will the new entity / geography sell, and to whom — any customer, partner or distributor named?', ans: A.customer },
    { label: 'Revenue', q: 'when is the first revenue, order or licence expected?', ans: A.revenue },
  ],
  approval: [
    { label: 'Qualified capacity', q: 'what products, markets or volume does the approval cover?', ans: A.qualifiedCap },
    { label: 'Customer', q: 'which customer or market will purchase under it?', ans: A.customer },
    { label: 'Commercial order', q: 'is there a commercial purchase order yet — value and quantity?', ans: A.commercialOrder },
    { label: 'Production', q: 'when do commercial supplies / production start, and at what run-rate?', ans: A.production },
  ],
  qualification: [
    { label: 'Qualified capacity', q: 'which product / programme is qualified, and for what volume?', ans: A.qualifiedCap },
    { label: 'Customer', q: 'which customer and which programme — named in the filing?', ans: A.customer },
    { label: 'Commercial order', q: 'is there a commercial purchase order yet — value and quantity?', ans: A.commercialOrder },
    { label: 'Production', q: 'when do commercial supplies start, and at what run-rate?', ans: A.production },
  ],
  licence_capacity: [
    { label: 'Qualified capacity', q: 'what volume does the licence / capacity cover?', ans: A.qualifiedCap },
    // zzz787 kept: the demand question — a licence is capability, not demand (ABDL).
    { label: 'Customer', q: 'Demand: orders, offtake agreements or named customers for the licensed / installed volume?', ans: A.demand },
    { label: 'Commercial order', q: 'is there a commercial order yet — value and quantity?', ans: A.commercialOrder },
    { label: 'Production', q: 'when does commercial production start, and what utilisation / revenue at full volume?', ans: A.production },
  ],
  strategic: [
    { label: 'Buyer', q: 'who is the investor — an industry (strategic) or a financial holder?', ans: A.buyer },
    { label: 'Stake', q: 'stake size — confirmed in an official filing (SAST / 13D / exchange disclosure), or press only?', ans: A.stake },
    { label: 'Price', q: 'price paid — primary shares (money to the company) or bought from existing holders?', ans: A.issuePrice },
    { label: 'Rationale', q: 'why this investor — capability, customers or capital?', ans: A.rationale },
    { label: 'Governance / strategic relationship', q: 'any board seat, supply or technology agreement with the investor?', ans: A.governance },
  ],
  debt: [
    { label: 'Amount', q: 'amount redeemed / raised — stated?', ans: A.size },
    { label: 'Rate', q: 'interest rate on the debt redeemed or raised?', ans: A.rate },
    { label: 'Maturity', q: 'maturity of the debt redeemed or raised?', ans: A.maturity },
    { label: 'Cash-flow effect', q: 'interest saved (or added) a year — stated?', ans: A.interestSaved },
    { label: 'Leverage', q: 'net debt / leverage after it?', ans: A.leverage },
  ],
  fundraising: [
    { label: 'Size', q: 'amount raised — stated?', ans: A.size },
    { label: 'Price', q: 'issue price and discount / premium to the market — stated?', ans: A.issuePrice },
    { label: 'Dilution', q: 'new shares ÷ existing shares — stated, or computable from stated share counts?', ans: A.dilution },
    { label: 'Use of proceeds', q: 'capex, debt repayment, acquisition or working capital?', ans: A.proceeds },
    { label: 'Funding gap', q: 'does it fully fund the plan, or is more money needed (warrants, debt)?' },
  ],
  merger: [
    { label: 'Consideration', q: 'swap ratio / consideration — stated?', ans: A.swap },
    { label: 'Ownership', q: 'promoter and minority holding after the scheme — dilution per share?', ans: A.ownership },
    { label: 'Financial contribution', q: 'combined revenue and profit — stated?', ans: A.targetEcon },
    { label: 'Synergies / integration', q: 'why merge — synergies, simplification or a change in promoter holding; approvals and effective date?', ans: A.synergy },
  ],
};

/** zzz789: the ordered checklist for an event kind, answered steps marked. Null → the key has no checklist. */
export function researchChecklist(key: string, c: CheckCtx): string[] | null {
  const steps = CHECKLISTS[key];
  if (!steps) return null;
  return steps.map((st, i) => {
    const a = st.ans && !c.secondary ? st.ans(c) : null;
    return a ? `${i + 1}. ${st.label}: ✓ ${a}${c.read ? ' (per the filing)' : ' (as stated in the filing summary; document not read yet)'}` : `${i + 1}. ${st.label}: ${st.q}`;
  });
}

function nextKey(type: EventType, cls: EventClass, stage: Stage, finding: Finding | null, clarification = false): string {
  if (cls === 'DATA_UNAVAILABLE') return 'unavailable';
  if (cls === 'LISTING') return 'listing';
  if (cls === 'MARKET_MOVE_ONLY') return 'band';
  if (type === 'Denial' || clarification) return 'denial';
  const hay0 = `${finding?.headline || ''} ${finding?.evidenceQuote || ''} ${(finding?.notes || []).join(' ')}`;
  if (cls === 'NO_CATALYST') return type === 'Fundraising' ? (RX_RESALE.test(hay0) ? 'resale' : 'fundraising') : /not classifiable/i.test(String(finding?.headline || '')) ? 'unclassified' : 'none';
  if (type === 'Fundraising') return 'fundraising';
  if (finding?.category === 'strategic_investor' || type === 'Strategic investment') return 'strategic';
  if (type === 'Promoter buying') return 'promoter_buying';
  if (type === 'Capital allocation' || type === 'Buyback') return cls === 'NEGATIVE' ? 'negative' : 'capital_allocation';
  if (cls === 'NEGATIVE' && type !== 'Earnings') return 'negative';
  const hayK = `${finding?.headline || ''} ${finding?.evidenceQuote || ''}`;
  if ((type === 'Order win' || type === 'Contract' || type === 'Partnership' || type === 'JV') && (stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR'))
    return /\bjda\b|joint development|\bgdv\b|gross development|acres?|residential|township|real estate|housing/i.test(hayK) ? 'enabling_realestate' : 'enabling';
  // zzz782: a qualification is not a licence — its questions are about conversion to commercial supply.
  if (type === 'Regulatory approval' && (finding?.category === 'product_qualification' || /qualif|approved (vendor|supplier)|vendor (registration|approval)|\bfai\b|first article|sampl/i.test(hayK))) return 'qualification';
  // zzz787: a licence / capacity to produce is capability, not demand (ABDL ~4.4 million BL licence).
  if (type === 'Regulatory approval' && CAPACITY_WORDS.test(hayK) && !DEMAND_WORDS.test(hayK)) return 'licence_capacity';
  switch (type) {
    case 'Order win': case 'Contract':
      // zzz787: a stated contract TERM (RNIT "five-year services agreement") is a runway, not revenue.
      if (contractTermYears(hayK) != null && !/\bannual(ly)?\b|per annum|\bprogramm?e?s?\b/i.test(hayK)) return 'contract_term';
      // RAYMOND "multi-programme orders worth about ₹33 crore annually": recurring-programme questions.
      return /\bannual(ly)?\b|per annum|\bp\.?\s?a\.?\b|\bprogramm?e?s?\b|multi-?year|framework|rate contract/i.test(hayK) ? 'order_recurring' : 'order';
    case 'Merger': return 'merger';
    case 'Strategic expansion': return 'strategic_expansion';
    case 'Customer win': return 'customer';
    case 'Capacity expansion': case 'Production ramp': return 'capacity';
    case 'Acquisition': case 'JV': case 'Divestment': return 'acquisition';
    case 'Earnings': return 'earnings';
    case 'Regulatory approval': return 'approval';
    case 'New product': return 'product';
    case 'Guidance': return 'guidance';
    case 'Management change': return 'management';
    case 'Rating action': return 'rating';
    case 'Pricing': return 'pricing';
    case 'Debt / refinancing': return 'debt';
    default: return 'generic';
  }
}

function unknownsFor(key: string, hay: string, hasValue: boolean, e: EarningsMini | null): string[] {
  const u: string[] = [];
  const say = (k: string, known: boolean, word = 'Not disclosed') => { if (!known) u.push(`${k}: ${word}`); };
  switch (key) {
    case 'order': case 'order_recurring': case 'customer': case 'contract_term':
      say('Order value', hasValue);
      say('Order margin', /margin/i.test(hay));
      say('Revenue timing / execution period', /\b(months?|years?|by (fy|q[1-4]|march|june|september|december)|\d{4})\b/i.test(hay));
      say('Customer concentration', false, 'Unknown');
      say('Working capital terms', /advance|payment terms|working capital/i.test(hay));
      break;
    case 'enabling': case 'enabling_realestate':
      say('Binding order', false, 'Not yet — enabling stage');
      say('Company economics (value / revenue share)', hasValue && !/\bgdv\b|gross development value|potential|may unlock/i.test(hay));
      say('Conversion timing', false, 'Unknown');
      break;
    case 'capacity':
      say('Capex invested', hasValue || /capex|invest/i.test(hay));
      say('Current utilisation', /utili[sz]ation/i.test(hay));
      say('Demand secured / offtake', false, 'Unknown');
      say('Revenue contribution', false);
      break;
    case 'acquisition':
      say('Price', hasValue);
      say('Funding', /funded|cash|debt|internal accruals|share swap/i.test(hay));
      say('Target revenue / EBITDA', /revenue|ebitda|turnover/i.test(hay));
      say('Earnings contribution', /accretive|eps|earnings contribution/i.test(hay));
      say('Dilution', false, 'Unknown');
      break;
    case 'earnings':
      if (!e || e.guidance === 'NOT_STATED') u.push('Guidance: Not stated');
      if (!e || e.orderBook === 'NOT_STATED') u.push('Order book: Not stated');
      if (!e || e.cfoToPat == null) u.push('CFO/PAT: Not disclosed');
      if (!e || e.marginNow == null) u.push('Operating margin: Not disclosed');
      break;
    case 'licence_capacity':
      u.push('Demand for the new volume (orders, offtake, utilisation, revenue): Absent — not on file');
      say('Commercial start date', /commercial (production|start)|from (fy|q[1-4]|\w+ \d{4})/i.test(hay));
      say('Revenue at full volume', false);
      break;
    case 'merger':
      say('Swap ratio / consideration', /swap ratio|share exchange ratio|consideration/i.test(hay));
      say('Combined revenue / profit', /revenue|turnover|ebitda|profit/i.test(hay));
      say('Effective date / approvals', /effective date|nclt|approved by/i.test(hay), 'Unknown');
      break;
    case 'strategic_expansion':
      u.push('Revenue, orders or investment in the new entity / geography: Not stated — a step, not business yet');
      say('Funding committed', /invest|capital of|funded/i.test(hay));
      break;
    case 'promoter_buying':
      say('Shares bought / price paid', /[\d,]+ (equity )?shares|at (an average )?price|₹\s*[\d,.]+ per share/i.test(hay));
      say('Holding after the purchase', /post[- ]acquisition|after the (acquisition|purchase)|holding (of|at|to) \d/i.test(hay));
      break;
    case 'capital_allocation': case 'buyback':
      say('Size versus market cap', hasValue);
      say('Funding source', /cash|free cash|internal accruals|borrow/i.test(hay));
      break;
    case 'fundraising':
      say('Issue price / discount', /price|premium|discount/i.test(hay));
      say('Use of proceeds', /use of proceeds|to fund|for (capex|expansion|acquisition)/i.test(hay));
      say('Dilution', false, 'Unknown');
      break;
    case 'debt':
      say('Amount', hasValue);
      say('Interest saved / cash-flow effect', /interest (cost |expense )?sav|reduce (its )?interest/i.test(hay));
      say('Leverage after it', /net debt|leverage|debt[- ]to[- ]equity/i.test(hay));
      break;
    case 'none': case 'band': case 'unclassified':
      u.push('Cause of the move: Unknown');
      u.push('Turnover versus average: Unknown');
      break;
    case 'unavailable':
      u.push('Filings in window: Unknown (source unavailable)');
      break;
    case 'negative': case 'denial':
      // zzz777: a negative event is sized by exposure, cash and recurrence.
      say('Financial exposure', hasValue);
      say('Cash impact (paid / deposited / provided)', /paid|deposit|provision|pre-?deposit/i.test(hay));
      say('Recurrence (one-off or repeating)', /one[- ]off|one[- ]time|recurring|similar (notice|demand)s?/i.test(hay), 'Unknown');
      break;
    case 'qualification':
      say('Commercial order', /purchase order|commercial (order|supply)|supply order/i.test(hay), 'Not yet on file');
      say('Commercial start date', /commercial|supplies|launch|from (fy|q[1-4]|\w+ \d{4})/i.test(hay));
      say('Number of qualified customers', false, 'Unknown');
      break;
    case 'approval':
      // zzz777: a licence / approval opens a market; the unknown is its size.
      say('Addressable commercial impact', hasValue);
      say('Commercial start date', /commercial|supplies|launch|from (fy|q[1-4]|\w+ \d{4})/i.test(hay));
      say('Competitors holding the same approval', false, 'Unknown');
      break;
    case 'product':
      say('Commercial impact', hasValue);
      say('Revenue start and scale', /revenue|order|customer/i.test(hay));
      say('Pricing / margin', /pric|margin/i.test(hay));
      break;
    default:
      // zzz776: a product launch or a licence has no "event value" — what is
      // unknown is its commercial impact.
      say('Commercial impact', hasValue);
      u.push('Revenue impact: Not disclosed');
  }
  u.push('Consensus expectations: Unknown');
  return u;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSMISSION + PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

function transmissionOf(type: EventType, cls: EventClass, stage: Stage, mat: Materiality['label']): Transmission {
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY' || cls === 'LISTING' || cls === 'DATA_UNAVAILABLE') return 'NONE';
  // zzz771: a raise reaches the P&L only through what the money funds — WEAK,
  // not NONE — unless it is a distress raise (NEGATIVE).
  if (type === 'Fundraising') return cls === 'NEGATIVE' ? 'NONE' : 'WEAK';
  if (type === 'Denial' || type === 'Management change' || type === 'Governance' || type === 'No identified catalyst' || type === 'Market/technical move') return 'NONE';
  // zzz787: capital allocation (stake, promoter buying, buyback) changes who owns the shares, not the business.
  if (type === 'Strategic investment' || type === 'Promoter buying' || type === 'Capital allocation') return 'WEAK';
  const early = stage === 'RUMOUR' || stage === 'PROPOSED' || stage === 'ENABLING';
  switch (type) {
    case 'Earnings': return 'DIRECT';
    case 'Order win': case 'Contract': case 'Customer win': return early ? 'WEAK' : mat === 'SIGNIFICANT' || mat === 'MODERATE' ? 'DIRECT' : 'NEAR_TERM';
    case 'Order cancellation': return 'DIRECT';
    case 'Capacity expansion': return early ? 'LONG_TERM' : 'NEAR_TERM';
    case 'Production ramp': return 'NEAR_TERM';
    case 'Acquisition': case 'Merger': return stage === 'EXECUTED' ? 'NEAR_TERM' : early ? 'WEAK' : 'LONG_TERM';
    case 'Strategic expansion': return early ? 'WEAK' : 'LONG_TERM';
    case 'Pricing': case 'Guidance': case 'Accident / disruption': return 'NEAR_TERM';
    case 'Regulatory approval': case 'New product': case 'JV': case 'Divestment': return early ? 'WEAK' : 'LONG_TERM';
    case 'Partnership': case 'Buyback': case 'Rating action': case 'Debt / refinancing': case 'Litigation / regulatory': return 'WEAK';
    default: return 'WEAK';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz787 — FOUR DURATION CONCEPTS, KEPT APART.
//   1. Contractual duration      only when a contract term / execution period is STATED
//   2. Potential economic duration  what the nature of the event COULD support —
//                                   derived from the facts first (term, programme,
//                                   capacity, execution period), the type only as a
//                                   fallback; always labelled NOT evidence
//   3. Evidence-supported runway    what the filings PROVE (persistenceEvidenceOf)
//   4. Catalyst state               where the catalyst is now (record state)
// A consistency guard stops (2) being shorter than what (1) or (3) claims.
// ═══════════════════════════════════════════════════════════════════════════

/** A licence / capacity / plant to produce — capability, not demand. */
export const CAPACITY_WORDS = /licen[cs]e (to|for) (the )?manufactur|permit(s|ted)? the company to manufacture|\bcapacity\b|\b(mtpa|ktpa|tpa|tpd|klpd|mw|mwh|gw)\b|\bbl\b|bulk lit(re|er)s?|million (bl|litres|tonnes|units)|per annum|commission(ed|ing)|new (plant|facility|unit|line)|distillery|manufacturing facility/i;
/** Demand evidence: orders, offtake, utilisation, revenue — never "an order FROM the Commissioner granting a licence". */
export const DEMAND_WORDS = /purchase orders?|order book|order backlog|orders? (worth|valued|of (rs|₹|inr))|orders? in hand|offtake|off-take|supply agreement|customer orders?|\butili[sz]ation\b\s*(of|at|rose|stood|is|was|\d)|revenue (from|of|contribution)|sales (of|grew|rose|increased)|sold out|fully booked|contracted (volume|capacity)/i;
const PROGRAMME_WORDS = /multi[- ]programme|\bprogramm?es?\b|fighter|aircraft (programme|platform)|\bannual(ly)?\b|per annum|recurring|framework agreement|rate contract|multi-?year|long[- ]term (agreement|contract|supply)/i;

export interface PotentialDuration {
  value: Persistence;
  /** Plain sentence: "Multi-year programme (…)". */
  text: string;
  /** FACTS = from a stated term / programme / capacity / period; TYPE = only the kind of event. */
  basis: 'FACTS' | 'TYPE' | 'NONE';
}

const TYPE_POT_WORD: Record<Persistence, string> = { YEARS: 'Could last years', QUARTER: 'About a quarter / one execution period', DAYS: 'Days — a one-time event', UNKNOWN: 'Not established' };

/** The text every fact about this catalyst states (titles, quotes, milestones, periods). */
function factText(facts: StructuredFacts[]): string {
  return facts.map((x) => [x.source.title, ...x.quotes, ...(x.time?.milestones || []), x.time?.executionPeriod || '', x.event.product || '', (x as any).statedPotentialNative != null ? 'annual business potential' : ''].join(' ')).join(' ');
}

/** zzz787: POTENTIAL economic duration from the FACTS.
 *  zzz789: the event TYPE alone never sets a duration any more (CRML / CDNA:
 *  "an acquisition → years"). A duration needs a stated term, programme,
 *  execution period, plant / licensed capacity in an official document, or —
 *  for a deal — the target's stated revenue / profit. A secondary-only event
 *  (FRVO "first power" in the press) is potential wording only, verification
 *  required. Otherwise: "Not established". Never evidence, never price. */
const SECONDARY_NEEDS: Partial<Record<EventType, string>> = {
  'Capacity expansion': 'plant operation, utilisation, offtake / revenue and economics', 'Production ramp': 'plant operation, utilisation, offtake / revenue and economics',
  'Order win': 'the order, its value and execution', 'Contract': 'the contract, its value and term', 'Customer win': 'the customer, its orders and value',
  'Acquisition': 'the deal terms and the target\'s revenue / profit', 'Merger': 'the scheme terms and combined economics',
  'Strategic investment': 'the stake in an official filing and any commercial link', 'Regulatory approval': 'the approval, the customer and a commercial order',
  'New product': 'customers, pricing and revenue', 'Strategic expansion': 'investment, customers and revenue in the new geography',
};
export const NOT_ESTABLISHED = 'Not established';
export function potentialDurationOf(type: EventType, cls: EventClass, hay: string, facts: StructuredFacts[] = [], opts: { secondaryOnly?: boolean } = {}): PotentialDuration {
  if (cls === 'MARKET_MOVE_ONLY') return { value: 'DAYS', text: 'Days — a price-band / technical move', basis: 'NONE' };
  if (cls === 'NO_CATALYST' || cls === 'LISTING' || cls === 'DATA_UNAVAILABLE') return { value: 'UNKNOWN', text: 'Unknown — no event', basis: 'NONE' };
  if (opts.secondaryOnly && cls !== 'NEGATIVE') {
    const need = SECONDARY_NEEDS[type] || 'the event and its economics';
    return { value: 'UNKNOWN', text: `${NOT_ESTABLISHED} — secondary source only. A multi-period effect is only a potential until ${need} are verified in an official filing (verification required).`, basis: 'NONE' };
  }
  const ft = `${hay} ${factText(facts)}`;
  const orderLike = type === 'Order win' || type === 'Contract' || type === 'Customer win';
  if (cls !== 'NEGATIVE' && !CAPITAL_ALLOCATION_TYPES.has(type) && type !== 'Fundraising') {
    const term = contractTermYears(ft);
    if (term != null && term >= 1) return { value: 'YEARS', text: `Multi-year — contract term ${term} year${term === 1 ? '' : 's'} as stated`, basis: 'FACTS' };
    if (orderLike && PROGRAMME_WORDS.test(ft)) return { value: 'YEARS', text: 'Multi-year programme — programme / annual business stated in the filing', basis: 'FACTS' };
    const capFact = facts.some((x) => !!x.economics?.capacityAfter) || ((type === 'Capacity expansion' || type === 'Production ramp' || type === 'Regulatory approval') && CAPACITY_WORDS.test(ft));
    if (capFact && (type === 'Capacity expansion' || type === 'Production ramp' || type === 'Regulatory approval')) return { value: 'YEARS', text: 'Multi-year — a plant / licensed capacity runs for years if demand fills it', basis: 'FACTS' };
    const per = facts.map((x) => x.time?.executionPeriod).find(Boolean) || (/(?:execut\w*|complet\w*|deliver\w*|suppl\w*)\s+(?:with)?(?:in|over)\s+(?:a period of\s+)?(\d{1,3})\s*months?/i.exec(ft)?.[0] ?? null);
    const months = per ? Number((/(\d{1,3})\s*months?/i.exec(per) || [])[1]) : NaN;
    if (orderLike && Number.isFinite(months) && months > 0) return months >= 12
      ? { value: 'YEARS', text: `One execution period — ${months} months as stated`, basis: 'FACTS' }
      : { value: 'QUARTER', text: `One execution period — ${months} months as stated`, basis: 'FACTS' };
    // zzz789: a deal adds something lasting only when the TARGET's economics are stated.
    if (type === 'Acquisition' || type === 'Merger') {
      const tgt = facts.some((x) => x.source.kind !== 'PRESS' && x.source.access === 'DOCUMENT_READ' && (x.economics.targetRevenueNative != null || x.economics.targetProfitNative != null))
        || /\b(?:target|acquired (?:company|business|entity)|it|which)\b[^.]{0,60}\b(?:revenue|turnover|sales|ebitda|profit)\b[^.]{0,30}(?:₹|rs\.?|inr|\$|usd)\s*[\d,]/i.test(ft)
        || /\b(?:revenue|turnover|ebitda)\s+of\s+(?:₹|rs\.?|inr|\$|usd)\s*[\d,]/i.test(ft);
      if (tgt) return { value: 'YEARS', text: 'Multi-year — the acquired business\'s revenue / profit is stated; it contributes from completion (if it holds)', basis: 'FACTS' };
      return { value: 'UNKNOWN', text: `${NOT_ESTABLISHED} — the documents state no target revenue / profit, so how long the deal adds anything is unknown`, basis: 'NONE' };
    }
  }
  if (type === 'Earnings') return { value: 'QUARTER', text: 'One reported quarter — it repeats only if the next quarter does', basis: 'FACTS' };
  return { value: 'UNKNOWN', text: `${NOT_ESTABLISHED} — no term, programme, execution period or economics in the documents set a duration`, basis: 'NONE' };
}

/** zzz787: distinct official evidence PERIODS behind the operating facts — two
 *  filings 12 days apart are one period; ≥60 days apart (or different
 *  reporting quarters) are two. Press never counts. */
export function officialEvidencePeriods(facts: StructuredFacts[]): number {
  const dates = Array.from(new Set(facts
    .filter((x) => x.source.kind !== 'PRESS' && x.source.date && (x as any).polarity !== 'negative' && !['tax_litigation', 'regulatory_negative', 'fundraising', 'resale_registration', 'debt', 'governance'].includes(x.event.kind))
    .map((x) => String(x.source.date).slice(0, 10)))).sort();
  let periods = 0, last = -Infinity;
  for (const d of dates) { const t = Date.parse(d); if (!Number.isFinite(t)) continue; if (t - last >= 60 * 86_400_000) { periods++; last = t; } }
  return periods;
}

// ── EVIDENCE-SUPPORTED PERSISTENCE (zzz782, facts-only since zzz787).
// What the FILINGS prove — never the event type alone, never the potential
// duration, never price. STRONG needs ≥2 independent official evidence
// periods (or a ledger mechanism filed across ≥2 periods). A contract term, a
// programme or capacity stated once is MEDIUM at best ("EVIDENCE"); capacity,
// a licence or commissioning without demand evidence is UNPROVEN.
export type PersistEvidenceLevel = 'NOT_PERSISTENT' | 'UNPROVEN' | 'EARLY' | 'EVIDENCE' | 'STRONG' | 'NONE';
export const PERSIST_EVIDENCE_WORD: Record<PersistEvidenceLevel, string> = { STRONG: 'Strong', EVIDENCE: 'Medium', EARLY: 'Early', UNPROVEN: 'Unproven', NOT_PERSISTENT: 'Not persistent', NONE: 'None' };
export interface PersistEvidenceCtx {
  /** officialEvidencePeriods() of the catalyst's facts. */
  officialPeriods?: number;
  /** contractTermYears() of the filing text. */
  contractYears?: number | null;
  /** zzz789: the economics are quantified in a READ official document (a firm
   *  value, capex, consideration or target revenue — never a stated potential).
   *  Omitted → a stated money / volume figure in the text counts. */
  quantified?: boolean;
  /** zzz789: distinct dated official filings on this catalyst (repeat filings in one period). */
  officialFilings?: number;
}
/** zzz789 GENERAL RULE: a grade above Early needs QUANTIFIED economics AND
 *  repeat / continuation evidence in official documents. A contract term, a
 *  programme or an "annual" word is a claim about the future — the contractual
 *  runway is shown on its own line, never as persistence evidence (RNIT,
 *  RAYMOND). */
export function persistenceEvidenceOf(type: EventType, cls: EventClass, stage: Stage, key: string, hay: string,
  pc: { confidence: string; specialFocus: boolean; label: string; kind?: string; periods?: number } | null | undefined,
  ctx: PersistEvidenceCtx = {}): { level: PersistEvidenceLevel; text: string } {
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY' || cls === 'LISTING' || cls === 'DATA_UNAVAILABLE') return { level: 'NONE', text: 'No event — nothing to persist.' };
  if (cls === 'NEGATIVE') {
    return /\b(gst|tax|penalt\w*|demand|show[- ]cause|\bscn\b|notice|interest|fine|levy|assessment)\b/i.test(hay)
      ? { level: 'NOT_PERSISTENT', text: 'One-off tax / penalty item — not persistent unless similar demands recur.' }
      : { level: 'UNPROVEN', text: 'Negative development — whether it recurs is not established.' };
  }
  if (CAPITAL_ALLOCATION_TYPES.has(type) || type === 'Fundraising' || type === 'Rating action' || type === 'Management change' || type === 'Divestment' || type === 'Denial')
    return type === 'Strategic investment'
      ? { level: 'UNPROVEN', text: 'A strategic holder\'s stake — a capital-allocation signal; any commercial link to the business is not on file.' }
      // zzz789: not an operating mechanism — but not shown to be one-off either: unproven, never "not persistent".
      : { level: 'UNPROVEN', text: 'Capital allocation / financing — not an operating mechanism; whether its effect lasts is not established.' };
  if (type === 'Debt / refinancing') return { level: 'UNPROVEN', text: 'Debt redeemed / raised — the lasting effect on interest cost, cash flow and leverage is not established yet.' };
  const periods = ctx.officialPeriods ?? 0;
  const filings = Math.max(ctx.officialFilings ?? 0, periods);
  const quantified = ctx.quantified ?? /(?:₹|rs\.?|inr|\$|usd)\s*[\d,]+(?:\.\d+)?|\b\d[\d,.]*\s*(?:crores?|cr\b|lakhs?|million|mn\b|billion|mtpa|ktpa|tpa|tpd|mw|mwh|gw|units|pieces|tonnes|bl\b)|\butili[sz]ation\s*(?:of|at|rose to|stood at|is|was)?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*utili[sz]ation/i.test(hay);
  if (pc && pc.kind !== 'PROJECT_PIPELINE' && (pc.specialFocus || pc.confidence === 'HIGH'))
    return (pc.periods ?? 0) >= 2 || periods >= 2
      ? { level: 'STRONG', text: `Filed mechanism evidence across ${Math.max(pc.periods ?? 0, periods)} evidence periods (${pc.label}).` }
      : { level: 'EVIDENCE', text: `Filed mechanism evidence (${pc.label}) — one evidence period so far; strong needs a second.` };
  if (pc && pc.kind !== 'PROJECT_PIPELINE' && pc.confidence === 'MEDIUM') return { level: 'EVIDENCE', text: `Mechanism evidence on file (${pc.label}), not yet across periods.` };
  if (stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR') return { level: 'UNPROVEN', text: 'Enabling step — nothing booked yet; tracked until a definitive step is filed.' };
  const operating = type !== 'Earnings' && type !== 'Guidance' && type !== 'Pricing';
  if (operating && periods >= 2) return quantified
    ? { level: 'STRONG', text: `${periods} independent official evidence periods on file for this catalyst, with quantified economics.` }
    : { level: 'EARLY', text: `${periods} official filings in separate periods, but the economics are not quantified — early until value / billing is stated.` };
  const demand = DEMAND_WORDS.test(hay);
  switch (type) {
    case 'New product':
      return /\b(orders?|revenue|sales|customers? (signed|onboarded)|subscribers?)\b/i.test(hay) && /\d/.test(hay)
        ? { level: 'EARLY', text: 'Commercial traction stated with the launch — one period; persistence needs repeat orders / revenue in a later filing.' }
        : { level: 'UNPROVEN', text: 'Long-term possible, unproven — no orders or revenue on file yet.' };
    case 'Regulatory approval':
      if (/purchase order|commercial (order|supply|supplies)|supply order/i.test(hay) || (key === 'licence_capacity' && demand))
        return quantified ? { level: 'EVIDENCE', text: 'Approval with a quantified commercial order on file.' } : { level: 'EARLY', text: 'Approval with a commercial order mentioned — its value is not quantified yet.' };
      if (key === 'licence_capacity' || CAPACITY_WORDS.test(hay)) return { level: 'UNPROVEN', text: 'Licence / capacity to produce — regulatory and production capability, not demand. Demand evidence absent: commercial persistence unproven.' };
      return { level: 'EARLY', text: key === 'qualification' ? 'Qualification — early; no commercial order on file yet.' : 'Licence / approval — opens a market; no commercial order on file yet.' };
    case 'Order win': case 'Contract': case 'Customer win': {
      const yrs = ctx.contractYears ?? contractTermYears(hay);
      if (quantified && filings >= 2) return { level: 'EVIDENCE', text: `Quantified order with ${filings} official filings on the same catalyst — medium (one period); strong needs a second period.` };
      if (yrs != null) return { level: 'EARLY', text: `Contract runway ${yrs} year${yrs === 1 ? '' : 's'} (as stated) is contractual, not persistence evidence — value, billing, renewal and customer economics are not on file. Early / unproven.` };
      if (PROGRAMME_WORDS.test(hay)) return { level: 'EARLY', text: 'Programme / recurring business is stated in one filing — a claim, not evidence: the firm value, programme duration and build rate are not established. Early / unproven.' };
      return { level: 'EARLY', text: `One order on file${quantified ? '' : ' (value not quantified in a read document)'} — covers one execution period; persistence needs repeat orders or billing across periods.` };
    }
    case 'Capacity expansion': case 'Production ramp':
      if (demand) return quantified
        ? { level: 'EVIDENCE', text: 'Capacity with quantified demand / utilisation evidence — one period so far.' }
        : { level: 'EARLY', text: 'Demand / utilisation is mentioned but not quantified — early.' };
      return stage === 'EXECUTED' || stage === 'OPERATIONAL' || /commission|operational|commercial production|started production|production (start|commenc)/i.test(hay)
        ? { level: 'UNPROVEN', text: 'Capacity commissioned — demand (orders, offtake, utilisation, revenue) not evidenced: commercial persistence unproven.' }
        : { level: 'UNPROVEN', text: 'Capacity planned — nothing commissioned, no demand evidenced: commercial persistence unproven.' };
    case 'Acquisition': case 'JV': case 'Merger':
      return stage === 'EXECUTED' && /\b(revenue|ebitda|turnover)\b[^.]{0,40}\d/i.test(hay)
        ? { level: 'EVIDENCE', text: 'Completed, with the target\'s revenue / profit stated — an existing business with a track record.' }
        : { level: 'EARLY', text: 'Deal on file — target economics and integration not yet evidenced.' };
    case 'Strategic expansion': return { level: 'UNPROVEN', text: 'A new subsidiary / geography — no revenue, orders or investment on file yet.' };
    case 'Earnings': return { level: 'EARLY', text: 'One quarter\'s result — persistence needs the next quarter.' };
    case 'Guidance': return { level: 'EARLY', text: 'Management guidance — a target, not evidence.' };
    case 'Pricing': return { level: 'EARLY', text: 'Price change — persistence depends on the industry holding it.' };
    default: return { level: 'UNPROVEN', text: 'Persistence not established.' };
  }
}

const PERSIST_RANK: Record<Persistence, number> = { UNKNOWN: -1, DAYS: 0, QUARTER: 1, YEARS: 2 };
/** zzz787 — CONSISTENCY GUARD. The potential duration can never be shorter
 *  than what the contract term or the evidence already claims, and "strong
 *  evidence" never sits beside a one-quarter potential without a sentence
 *  saying why the potential was raised. */
export function guardPotential(pot: PotentialDuration, ev: { level: PersistEvidenceLevel; text: string }, contractYears: number | null): { pot: PotentialDuration; note: string | null } {
  const need: { v: Persistence; why: string } | null = contractYears != null && contractYears >= 1 ? { v: 'YEARS', why: `the stated contract term (${contractYears} year${contractYears === 1 ? '' : 's'})` }
    : ev.level === 'STRONG' ? { v: 'YEARS', why: 'evidence across two or more periods' } : null;
  if (!need || PERSIST_RANK[pot.value] >= PERSIST_RANK[need.v]) return { pot, note: null };
  return {
    pot: { value: need.v, text: `Multi-year — raised to match ${need.why}`, basis: 'FACTS' },
    note: `Potential duration raised from "${pot.text}" to multi-year: ${need.why} already claims more than ${pot.value === 'QUARTER' ? 'one quarter' : 'a few days'}.`,
  };
}

/** zzz782: all rupee amounts in a negative-event text, in ₹ crore — "₹3.53 crore
 *  … ₹46.58 lakh" = 4.00; a bare "₹40,036" is rupees. Null when none. */
export function negativeAmountCr(text: string): number | null {
  const t = String(text || '');
  let sum = 0, any = false;
  const rx = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|million|mn\b)?/gi;
  for (const m of t.matchAll(rx)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const u = (m[2] || '').toLowerCase();
    sum += /^cr/.test(u) ? n : /^la|^lac/.test(u) ? n / 100 : /^m/.test(u) ? n / 10 : n / 1e7;
    any = true;
  }
  return any ? Math.round(sum * 10000) / 10000 : null;
}

function chainOf(type: EventType, trans: Transmission, stage: Stage, it: { headline: string; value: number | null; market: 'IN' | 'US'; mat: Materiality; e: EarningsMini | null; f: FiledRow | null; cap: ReturnType<typeof parseCapacityChange> }): string[] {
  const ev = `EVENT: ${it.headline.slice(0, 90)} (${stage})`;
  if (trans === 'NONE') return [ev, 'DRIVER: none identified', 'REVENUE: TBD', 'MARGIN: TBD', 'EPS/FCF: TBD', 'VALUATION: TBD — no fundamental change to value'];
  const ratio = it.mat.ratios[0]?.text || null;
  if (type === 'Earnings') {
    const e = it.e, f = it.f;
    return [ev,
      `DRIVER: ${e?.keyChange || 'Not disclosed'}`,
      `REVENUE: ${e?.revenueYoY != null ? `${pctS(e.revenueYoY)} YoY${f?.salesPrev != null && f?.salesCurr != null ? ` (${money(f.salesPrev, it.market)} → ${money(f.salesCurr, it.market)})` : ''}` : 'Not disclosed'}`,
      `MARGIN: ${e?.marginNow != null ? `${e.marginPrior != null ? `${r1(e.marginPrior)}% → ` : ''}${r1(e.marginNow)}% operating margin` : 'Not disclosed'}`,
      `EPS/FCF: ${e?.patYoY != null ? `PAT ${pctS(e.patYoY)} YoY` : 'PAT Not disclosed'}${e?.cfoToPat != null ? `; CFO/PAT ${e.cfoToPat}` : '; CFO/PAT Not disclosed'}`,
      'VALUATION: TBD — consensus Unknown'];
  }
  const early = stage === 'RUMOUR' || stage === 'PROPOSED' || stage === 'ENABLING';
  const driver = (() => {
    switch (type) {
      case 'Order win': case 'Contract': case 'Customer win': return early ? 'order book: nothing booked yet (enabling stage)' : it.value != null ? `order book +${moneyExact(it.value, it.market)}${it.mat.verification === 'PENDING' ? ' (stated; document verification pending)' : ''}` : 'order book up — value Not disclosed';
      case 'Capacity expansion': case 'Production ramp': return it.cap ? `capacity ${it.cap.before} → ${it.cap.after} (${it.cap.delta}, +${it.cap.pct}%)` : 'installed capacity up — size Not disclosed';
      case 'Acquisition': return it.value != null ? `acquired business for ${moneyExact(it.value, it.market)}${it.mat.verification === 'PENDING' ? ' (stated; document verification pending)' : ''}` : 'acquired business — price Not disclosed';
      case 'Regulatory approval': return 'market access — permits work, books none';
      case 'Order cancellation': return it.value != null ? `order book −${money(it.value, it.market)}` : 'order book down — value Not disclosed';
      case 'Accident / disruption': return 'lost output — size Not disclosed';
      case 'Buyback': case 'Capital allocation': return 'share count / cash change (mechanical per-share effect, not the business)';
      case 'Strategic investment': return 'a strategic holder takes a stake — no revenue link stated';
      case 'Promoter buying': return 'promoter holding up — ownership change, not the business';
      case 'Merger': return 'combined business — terms and dilution per share decide the effect';
      case 'Strategic expansion': return 'new subsidiary / geography — nothing sold there yet';
      case 'Pricing': return 'realisation change — size Not disclosed';
      default: return 'TBD';
    }
  })();
  const revenue = early ? 'REVENUE: none until converted — TBD'
    : type === 'Order win' || type === 'Contract' || type === 'Customer win'
      ? `REVENUE: ${it.value != null ? `${moneyExact(it.value, it.market)} over the execution period${it.mat.verification === 'PENDING' ? ' (stated; document verification pending)' : ''} — timing Not disclosed` : 'Not disclosed'}${ratio ? ` (${ratio})` : ''}`
      : type === 'Capacity expansion' || type === 'Production ramp' ? 'REVENUE: depends on utilisation and demand — Not disclosed'
        : ratio ? `REVENUE: TBD (${ratio})` : 'REVENUE: TBD';
  return [ev, `DRIVER: ${driver}`, revenue, 'MARGIN: Not disclosed', 'EPS/FCF: TBD', `VALUATION: TBD${ratio ? ` — event = ${it.mat.ratios[0].pct}% of ${it.mat.ratios[0].basis === 'market_cap' ? 'market cap' : 'revenue'}` : ''}`];
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPECTATION GAP — the move against the fundamental change, never alone.
// ═══════════════════════════════════════════════════════════════════════════

function gapOf(cls: EventClass, move: { pct: number | null; window: '1D' | '1W' }, returns: { w1: number | null; m1: number | null; m3: number | null }, fc: { pct: number; text: string } | null): ResearchItem['expectationGap'] {
  const moveParts = [move.pct != null ? `${pctS(move.pct)} (${move.window})` : null, returns.m1 != null ? `${pctS(returns.m1)} (1M)` : null, returns.m3 != null ? `${pctS(returns.m3)} (3M)` : null].filter(Boolean);
  const moveTxt = moveParts.length ? `Stock ${moveParts.join(', ')}` : 'Move Not disclosed';
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY') return { level: 'UNKNOWN', text: `${moveTxt}; no fundamental change identified — the move is not measured against anything.`, direction: null };
  if (cls === 'LISTING') return { level: 'UNKNOWN', text: `${moveTxt}; recent listing — no comparable prior close.`, direction: null };
  if (cls === 'DATA_UNAVAILABLE') return { level: 'UNKNOWN', text: `${moveTxt}; sources unavailable — gap cannot be assessed.`, direction: null };
  if (cls === 'NEGATIVE') return { level: 'UNKNOWN', text: `${moveTxt}; the event is negative — the move is not explained by it.`, direction: null };
  if (!fc) return { level: 'UNKNOWN', text: `${moveTxt}; fundamental change Not disclosed — gap cannot be measured.`, direction: null };
  const mv = Math.max(move.pct ?? -Infinity, returns.m1 ?? -Infinity);
  if (!Number.isFinite(mv)) return { level: 'UNKNOWN', text: `Move Not disclosed; ${fc.text}.`, direction: null };
  // zzz773: a stock that is not up is the market's RESPONSE, never proof the
  // change is unpriced. With no positive move there is nothing to compare.
  if (mv <= 0) return { level: 'UNKNOWN', text: `${moveTxt}; ${fc.text} → the market has not rewarded the change. That is a response, not evidence it is unpriced.`, direction: null };
  const r = fc.pct / Math.max(mv, 1);
  if (r >= 3) return { level: 'LARGE', text: `${moveTxt}; ${fc.text} → the move is small against the change (ratio ${r.toFixed(1)}×).`, direction: 'UNDER_REFLECTED' };
  if (r >= 1.5) return { level: 'MODERATE', text: `${moveTxt}; ${fc.text} → the move is modest against the change (ratio ${r.toFixed(1)}×).`, direction: 'UNDER_REFLECTED' };
  if (r >= 0.5) return { level: 'SMALL', text: `${moveTxt}; ${fc.text} → move and change broadly in proportion.`, direction: 'ALIGNED' };
  if (r >= 0.2) return { level: 'MODERATE', text: `${moveTxt}; ${fc.text} → expectation-heavy.`, direction: 'EXPECTATION_HEAVY' };
  return { level: 'LARGE', text: `${moveTxt}; ${fc.text} → expectation-heavy: the move is far larger than the change.`, direction: 'EXPECTATION_HEAVY' };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIORITY — research value, never the move.
// ═══════════════════════════════════════════════════════════════════════════

const F_CLASS: Record<EventClass, number> = { CONFIRMED_MATERIAL: 1, CONFIRMED_LOW_MATERIALITY: 0.55, POTENTIAL_UNVERIFIED: 0.5, NEGATIVE: 0.6, NO_CATALYST: 0.15, MARKET_MOVE_ONLY: 0.1, LISTING: 0.08, DATA_UNAVAILABLE: 0.1 };
const F_MAT: Record<Materiality['label'], number> = { SIGNIFICANT: 1, MODERATE: 0.75, SMALL: 0.35, UNKNOWN: 0.5 };
const F_TRANS: Record<Transmission, number> = { DIRECT: 1, NEAR_TERM: 0.85, LONG_TERM: 0.6, WEAK: 0.4, NONE: 0.1 };
const F_EVID: Record<SourceConfidence, number> = { VERIFIED_DOCUMENT: 1, VERIFIED_FILING: 0.85, SECONDARY_SUMMARY: 0.55, UNVERIFIED: 0.35 };
const F_PERS: Record<Persistence, number> = { YEARS: 1, QUARTER: 0.8, DAYS: 0.55, UNKNOWN: 0.7 };
// zzz771: the 0.7 step ends at the RECENT window (14d), not 20d, so freshness
// and catalystFor agree on where "recent" stops.
const freshF = (age: number | null) => (age == null ? 0.6 : age <= 1 ? 1 : age <= 3 ? 0.95 : age <= 7 ? 0.85 : age <= CATALYST_WINDOWS.IN.recent ? 0.7 : age <= 60 ? 0.45 : 0.2);
const gapF = (g: ResearchItem['expectationGap']) => (g.direction === 'UNDER_REFLECTED' ? (g.level === 'LARGE' ? 1 : 0.9)
  : g.direction === 'ALIGNED' ? 0.75 : g.direction === 'EXPECTATION_HEAVY' ? (g.level === 'LARGE' ? 0.4 : 0.55) : 0.7);

/** zzz789 — THE RANK DIMENSIONS, small structured rules (never a count of
 *  missing fields, never price):
 *    evidence strength        verified document / filing / secondary / none
 *    economic mechanism       quantified mechanism / identifiable / none
 *    potential persistence    multi-period (facts) / one period / not established
 *    materiality potential    material / unresolved (unknown) / small
 *    researchability          a live event with a document to read, or not
 *  Their product (with freshness, the expectation gap and the existing
 *  penalties) orders the queue. Only the words are shown ("Why #N"). */
export interface RankDims { evidence: 0 | 1 | 2 | 3; mechanism: 0 | 1 | 2; persistence: 0 | 1 | 2; materiality: 0 | 1 | 2; researchable: boolean; words: string[] }
const OPERATING_TYPES = new Set<EventType>(['Earnings', 'Order win', 'Contract', 'Customer win', 'Capacity expansion', 'Production ramp', 'New product', 'Acquisition', 'Merger', 'JV', 'Partnership', 'Regulatory approval', 'Pricing', 'Strategic expansion', 'Guidance', 'Order cancellation', 'Accident / disruption', 'Divestment']);
export function rankDimsOf(it: ResearchItem, quantified: boolean): RankDims {
  const cls = it.eventClass;
  const event = cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || cls === 'NEGATIVE';
  const evidence: RankDims['evidence'] = !event ? 0 : it.sourceConfidence === 'VERIFIED_DOCUMENT' ? 3 : it.sourceConfidence === 'VERIFIED_FILING' ? 2 : it.sourceConfidence === 'SECONDARY_SUMMARY' ? 1 : 0;
  const identifiable = event && (OPERATING_TYPES.has(it.eventType) || it.eventType === 'Debt / refinancing' || it.eventType === 'Fundraising');
  const econ = quantified || (it.eventType === 'Earnings' && !!it.earnings && (it.earnings.revenueYoY != null || it.earnings.patYoY != null));
  const mechanism: RankDims['mechanism'] = !identifiable ? 0 : econ ? 2 : 1;
  const pd = it.potentialDuration;
  const persistence: RankDims['persistence'] = !event ? 0 : it.persistenceEvidence?.level === 'STRONG' || (pd?.basis === 'FACTS' && pd.value === 'YEARS') ? 2 : pd?.basis === 'FACTS' && pd.value === 'QUARTER' ? 1 : 0;
  const ml = it.materiality.label;
  const materiality: RankDims['materiality'] = !event ? 0 : ml === 'SIGNIFICANT' || ml === 'MODERATE' ? 2 : ml === 'UNKNOWN' ? 1 : 0;
  const researchable = event && it.catalystFor !== 'CONTEXT' && !!(it.sourceUrl || (it.catalysts && it.catalysts.length) || it.earnings);
  const words: string[] = [];
  words.push(evidence === 3 ? 'verified event (document read)' : evidence === 2 ? 'verified event (official filing)' : evidence === 1 ? 'secondary source — verification required' : event ? 'source not verified' : 'no event on file');
  if (event) {
    words.push(mechanism === 2 ? 'quantified economic mechanism' : mechanism === 1 ? 'identifiable mechanism' : 'no operating mechanism');
    words.push(persistence === 2 ? 'multi-period runway' : persistence === 1 ? 'one execution period' : 'runway not established');
    words.push(materiality === 2 ? `material vs size (${it.materiality.ratios[0]?.pct ?? '—'}%)` : materiality === 1 ? 'unresolved economic significance' : 'small vs company size');
    words.push(researchable ? 'documents to read now' : it.catalystFor === 'CONTEXT' ? 'older context' : 'little to research');
  }
  return { evidence, mechanism, persistence, materiality, researchable, words };
}
const F_MECH = [0.6, 0.85, 1] as const;
const F_PDIM = [0.75, 0.85, 1] as const;

function priorityOf(it: ResearchItem, ctx: { routine: boolean; pricingState: string | null; staleEarnings: boolean; veryStale: boolean; namedAllottee: boolean; clarification: boolean; quantified?: boolean }): { score: number; reasons: string[]; details: Record<string, number>; dims: RankDims } {
  const dims = rankDimsOf(it, !!ctx.quantified);
  const d: Record<string, number> = {
    eventQuality: F_CLASS[it.eventClass], materiality: F_MAT[it.materiality.label], transmission: F_TRANS[it.transmission],
    // zzz787: a potential duration from the event TYPE alone is wording, never a
    // ranking input — only a potential the filing's own facts support counts.
    // zzz789: persistence is the potential-persistence DIMENSION (facts only),
    // plus the mechanism and researchability dimensions. A missing field is
    // never a ranking input by itself.
    evidence: F_EVID[it.sourceConfidence], freshness: freshF(it.ageDays ?? null), persistence: F_PDIM[dims.persistence],
    mechanism: F_MECH[dims.mechanism], researchability: dims.researchable ? 1 : 0.85,
  };
  const reasons: string[] = [];
  const cls = it.eventClass;
  if (cls === 'CONFIRMED_MATERIAL') reasons.push('Confirmed, economically material event');
  else if (cls === 'CONFIRMED_LOW_MATERIALITY') reasons.push('Real event, low materiality');
  else if (cls === 'POTENTIAL_UNVERIFIED') reasons.push(/ENABLING|PROPOSED|RUMOUR/.test(it.stage) ? `Not executed (${it.stage})` : it.sourceConfidence === 'VERIFIED_DOCUMENT' || it.sourceConfidence === 'VERIFIED_FILING' ? 'Event on file; financial impact not established' : 'Source not verified');
  else if (cls === 'NEGATIVE') reasons.push('Negative evidence');
  else if (cls === 'NO_CATALYST') reasons.push('No identified catalyst');
  else if (cls === 'MARKET_MOVE_ONLY') reasons.push('Technical / band move only');
  else if (cls === 'LISTING') reasons.push('Listing artifact');
  else reasons.push('Source unavailable');
  if (it.materiality.ratios[0] && it.materiality.label !== 'UNKNOWN') reasons.push(`${it.materiality.label === 'SIGNIFICANT' ? 'Material' : it.materiality.label === 'MODERATE' ? 'Moderate' : 'Small'} vs ${it.materiality.ratios[0].basis === 'market_cap' ? 'market cap' : 'revenue'} (${it.materiality.ratios[0].pct}%)`);
  else if (it.eventType === 'Earnings' && it.materiality.label !== 'UNKNOWN') reasons.push(`${it.materiality.label === 'SIGNIFICANT' ? 'Large' : it.materiality.label === 'MODERATE' ? 'Moderate' : 'Small'} change versus the prior year`);
  // zzz771: the source reason says what was actually read. A graded result's
  // figures ARE read from the filed statement (by the grader), and a
  // clarification is the company's own filing; "document not parsed" is only
  // true for a subject-line classification.
  if (it.sourceConfidence === 'VERIFIED_DOCUMENT') reasons.push('Quote verified in the document');
  else if (it.sourceConfidence === 'VERIFIED_FILING') {
    if (it.eventType === 'Earnings' && it.earnings) reasons.push('Figures from the filed result (grader-read)');
    else if (ctx.clarification) reasons.push('Exchange clarification on file (company-confirmed)');
    else reasons.push(`${it.market === 'US' ? 'SEC' : 'Exchange'} filing (document not parsed)`);
  }
  if (it.transmission === 'DIRECT') reasons.push('Direct P&L transmission');
  if (it.transmission === 'NONE') reasons.push('No transmission to earnings');
  if (it.ageDays != null && it.ageDays <= 3 && cls !== 'NO_CATALYST') reasons.push(`Fresh (${it.ageDays === 0 ? 'today' : `${it.ageDays}d`})`);
  if (it.persistence === 'YEARS' && (!it.potentialDuration || it.potentialDuration.basis === 'FACTS')) reasons.push('Multi-year potential stated in the filing (not evidence)');
  let pen = 1;
  const penal = (k: string, f: number, why: string) => { d[`penalty_${k}`] = f; pen *= f; reasons.push(why); };
  // zzz771: dilution is a flag on a potential catalyst, not a rejection —
  // 0.75 with a named allottee (the buyer is known), 0.6 without one.
  if (it.flags.dilution) penal('dilution', ctx.namedAllottee ? 0.75 : 0.6, ctx.namedAllottee ? 'Penalty: dilution (named allottee)' : 'Penalty: dilution / financing');
  // A true denial penalises; a clarification is already NO_CATALYST and is
  // priced by its class, not punished twice.
  if (it.flags.denial && cls === 'NEGATIVE') penal('denial', 0.5, 'Penalty: company denial');
  if (it.flags.denial && ctx.clarification) reasons.push('Company-confirmed: no undisclosed information');
  if (it.eventClass === 'CONFIRMED_LOW_MATERIALITY') penal('lowMateriality', 0.8, 'Penalty: too small to explain the move');
  // zzz789: PRICE IS NEVER A RANKING INPUT. The expectation gap (move vs
  // fundamental change) and the pricing assessment stay on the card as
  // context ("MOVE VS CHANGE", "PRICED"); they no longer scale the rank.
  void ctx.pricingState; void gapF;
  // A no-catalyst row is UNVERIFIED because nothing was found to verify; it
  // is not an unverified source and is not penalised as one. (zzz771)
  const noEvent = cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY';
  if (!noEvent && (it.sourceConfidence === 'SECONDARY_SUMMARY' || it.sourceConfidence === 'UNVERIFIED')) penal('unverified', 0.85, 'Penalty: unverified source');
  if (it.flags.listing) penal('listing', 0.3, 'Penalty: listing artifact');
  if (ctx.routine) penal('routine', 0.5, 'Penalty: routine filings only');
  if (it.eventClass === 'MARKET_MOVE_ONLY') penal('technical', 0.5, 'Penalty: technical-only move');
  if (ctx.staleEarnings) penal('staleResult', ctx.veryStale ? 0.4 : 0.7, `Penalty: result filed ${it.earnings?.filedDaysAgo}d ago — context, not this move's trigger`);
  // zzz771: the attribution reason. The class stays (it IS a real event); the
  // reason says why it is not in the queue.
  if (it.catalystFor === 'CONTEXT') reasons.push(`Context, not this move's catalyst (${it.ageDays}d)`);
  else if (it.catalystFor === 'RECENT' && it.ageDays != null) reasons.push(`Recent (${it.ageDays}d) — delayed reaction possible`);
  const product = d.eventQuality * d.materiality * d.transmission * d.evidence * d.freshness * d.persistence * d.mechanism * d.researchability;
  d.product = Math.round(product * 10000) / 10000;
  d.penaltyMultiplier = Math.round(pen * 1000) / 1000;
  const score = Math.max(0, Math.min(100, Math.round(100 * Math.pow(product, 0.6) * pen)));
  d.priority = score;
  return { score, reasons, details: d, dims };
}

// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO
// ═══════════════════════════════════════════════════════════════════════════

const VAR_OF: Partial<Record<EventType, string>> = {
  'Order win': 'order growth', 'Contract': 'order growth', 'Order cancellation': 'order growth', 'Customer win': 'customer',
  'Capacity expansion': 'capacity/utilisation', 'Production ramp': 'capacity/utilisation', 'Accident / disruption': 'capacity/utilisation',
  'Earnings': 'margin', 'Guidance': 'guidance', 'Pricing': 'margin', 'Acquisition': 'capital allocation', 'Buyback': 'capital allocation',
  'Fundraising': 'capital allocation', 'Regulatory approval': 'market access', 'New product': 'market access',
  'Merger': 'capital allocation', 'Strategic investment': 'capital allocation', 'Promoter buying': 'capital allocation', 'Capital allocation': 'capital allocation',
  'Strategic expansion': 'market access',
};
const NEXT_CHECK: Record<string, string> = {
  'order growth': 'order book ÷ TTM revenue at the next update', 'customer': 'customer concentration in the next disclosure',
  'capacity/utilisation': 'utilisation guidance in the next concall', 'margin': 'operating margin next quarter', 'guidance': 'next quarter against guidance',
  'capital allocation': 'funding, dilution and return on the capital deployed', 'market access': 'first commercial revenue from it',
};

function portfolioOf(ticker: string, type: EventType, cls: EventClass, e: EarningsMini | null, ctx: { held: Set<string>; watch: Set<string>; theme: Set<string>; vars: Record<string, string[]> | undefined; findingHeld: boolean }): ResearchItem['portfolio'] {
  const rel: PortfolioRelevance = ctx.held.has(ticker) || ctx.findingHeld ? 'HOLDING' : ctx.watch.has(ticker) ? 'WATCHLIST' : ctx.theme.has(ticker) ? 'SAME_THEME' : 'UNRELATED';
  if (rel === 'UNRELATED' || rel === 'SAME_THEME') return { relevance: rel, thesisVariable: null, note: rel === 'SAME_THEME' ? 'Shares a theme with the book — context for held names.' : null };
  let v = VAR_OF[type] || null;
  if (type === 'Earnings' && e) v = e.guidance !== 'NOT_STATED' ? 'guidance' : (e.marginNow != null && e.marginPrior != null) ? 'margin' : 'revenue growth';
  const hints = ctx.vars?.[ticker] || [];
  if (hints.length) {
    const hit = hints.find((h) => v && (h.toLowerCase().includes(v.split('/')[0]) || v.includes(h.toLowerCase())));
    v = hit || v;
  }
  const next = v ? (NEXT_CHECK[v] || `the next disclosure on ${v}`) : 'turnover, sector moves and the next filing';
  if (cls === 'NEGATIVE') return { relevance: rel, thesisVariable: v, note: `Challenges thesis variable ${v || 'Not mapped'} — next check ${next}.` };
  if (!v || cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY' || cls === 'DATA_UNAVAILABLE' || cls === 'LISTING') return { relevance: rel, thesisVariable: null, note: `No thesis-relevant event — next check ${next}.` };
  // zzz787: a stake, a promoter purchase or a buyback is capital-allocation research — never a portfolio action, never a thesis change.
  if (CAPITAL_ALLOCATION_TYPES.has(type)) return { relevance: rel, thesisVariable: v, note: `Capital-allocation research, not a portfolio action — the thesis status is unchanged; next check ${next}.` };
  return { relevance: rel, thesisVariable: v, note: `${cls === 'POTENTIAL_UNVERIFIED' ? 'May support' : 'Supports'} thesis variable ${v} — next check ${next}.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE NAME → ONE ITEM
// ═══════════════════════════════════════════════════════════════════════════

interface BoardRow { ticker: string; company: string | null; move_pct: number | null; market_cap?: number | null; perf?: any; turnover?: number | null; flags?: string[] | null }

/** zzz789 — the open question for THIS kind of event, in plain words (never
 *  the generic "size not disclosed" when the real unknown is something else). */
function openWhy(key: string, type: EventType, o: { open: string[]; secondary: boolean; value: number | null; valueVerified: boolean; hay: string }): string {
  const lc = (xs: string[]) => xs.map((x) => x.toLowerCase());
  const miss = (want: string[]) => { const m = lc(o.open).filter((x) => want.some((w) => x.startsWith(w))); return m.length ? ` (not yet stated: ${m.join(', ')})` : ''; };
  const pre = o.secondary ? 'Only a secondary source so far — confirm it in an official filing. ' : '';
  switch (key) {
    case 'order': case 'customer': case 'order_recurring':
      return pre + (o.value == null
        ? `Order on file, but its value is not disclosed — establish value, margin and execution period before judging it${miss(['margin', 'execution', 'customer'])}.`
        : !o.valueVerified ? 'Order value is stated but not yet verified in the document — confirm it, then margin and execution period.'
          : `Order sized in the filing — what is open is margin, execution and repeatability${miss(['margin', 'execution', 'working', 'repeat'])}.`);
    case 'capacity': return `${pre}Capex / capacity on file — the open question is utilisation: will orders or offtake fill it, and what revenue and EBITDA follow${miss(['utilisation', 'demand', 'revenue', 'ebitda'])}?`;
    case 'acquisition': return `${pre}Acquisition on file — what matters is the target's economics: price paid, revenue / EBITDA and funding${miss(['purchase', 'target', 'funding'])}.`;
    case 'approval': case 'qualification': return `${pre}Approval on file — the open question is demand: which customer buys under it, and is there a commercial order${miss(['customer', 'commercial', 'production'])}?`;
    case 'product': return `${pre}New product on file — the open question is customers: is it commercially available, at what price, and who has ordered${miss(['customers', 'commercial', 'pricing'])}?`;
    case 'debt': { const a = debtActionOf(o.hay) || 'raised / redeemed'; return `${pre}Debt ${a} — the open question is the balance-sheet effect: interest saved, maturity and leverage after it${miss(['rate', 'maturity', 'cash', 'leverage'])}.`; }
    case 'strategic_expansion': return `${pre}A new subsidiary / geography — an enabling step; the open questions are the investment, the set-up and the first customers${miss(['investment', 'regulatory', 'customers'])}.`;
    default: return `${pre}${type} on file — its economic effect is not established yet${o.open.length ? ` (open: ${lc(o.open).slice(0, 3).join(', ')})` : ''}.`;
  }
}

function whyOf(cls: EventClass, type: EventType, stage: Stage, mat: Materiality, key: string, gap: ResearchItem['expectationGap'], e: EarningsMini | null, fr: FundraiseRead | null = null, clarification = false,
  o: { open: string[]; secondary: boolean; value: number | null; valueVerified: boolean; hay: string } = { open: [], secondary: false, value: null, valueVerified: false, hay: '' }): string {
  if (cls === 'DATA_UNAVAILABLE') return 'Sources could not be reached — this is missing data, not an absence of news.';
  if (cls === 'LISTING') return 'Recent listing — no comparable prior close, so the move is excluded from comparison.';
  if (cls === 'MARKET_MOVE_ONLY') return 'Band print on thin turnover — the move measures the price band, not demand.';
  // zzz771: a clarification is the company confirming there is nothing filed
  // behind the move — company-confirmed absence, not a negative event.
  if (clarification) return 'The company told the exchange it has no undisclosed information — company-confirmed absence of a filed catalyst; only liquidity, sector or technical checks remain.';
  if (fr?.resale) return 'A resale / shelf registration releases existing stock for sale — a supply overhang with no new proceeds; it does not explain the move. A resale overhang does not by itself mean the price must fall.';
  if (cls === 'NO_CATALYST') return key === 'unclassified' ? 'A filing exists but its subject says nothing classifiable — open it before concluding there is no catalyst.' : 'No filing explains the move; only liquidity, sector or technical checks remain.';
  if (type === 'Denial') return 'The company contradicted a specific report while the stock moved — negative evidence for that story, not a catalyst.';
  if (type === 'Fundraising') {
    if (fr?.distress) return 'A raise beside distress markers (default, lenders, settlement) is supply into a stressed balance sheet — not a catalyst.';
    return fr?.named
      ? `A named allottee (${fr.allottees.join(', ')}) taking stock at a stated price can be the catalyst; it also adds supply — check the price against market, size against market cap and use of proceeds.`
      : 'A raise with no named allottee adds supply — check pricing, allottees and use of proceeds before treating it as a catalyst.';
  }
  // zzz787 — the new event types say what they are.
  if (key === 'strategic') return 'An outside strategic investor\'s stake — capital-allocation research, not a portfolio action. Confirm it in an official filing and look for any commercial agreement; the stake itself books no revenue.';
  if (key === 'promoter_buying') return 'The promoter is buying shares — insider buying is a capital-allocation signal, not revenue. Check the size, the price and whether the buying repeats.';
  if (key === 'capital_allocation') return 'Capital allocation (buyback / payout) — it changes the share count or the cash, not the business.';
  if (key === 'merger') return 'A merger / scheme — the swap terms, dilution per share and approvals decide what it means.';
  if (key === 'strategic_expansion') return 'A new subsidiary / geography — an enabling step; nothing is sold there yet.';
  if (key === 'licence_capacity') return 'A licence / capacity to produce — capability, not demand. Commercial persistence is unproven until orders, offtake, utilisation or revenue are on file.';
  if (key === 'contract_term' && cls !== 'NEGATIVE') return 'A contract with a stated term — a runway, not proven revenue; its value and billing are not yet quantified.';
  // zzz789: debt — the open question is the balance-sheet effect, whatever its size.
  if (key === 'debt' && cls !== 'NEGATIVE') return openWhy(key, type, o);
  if (cls === 'NEGATIVE') return type === 'Earnings' ? 'Results weakened; the move is not explained by fundamentals.' : type === 'Accident / disruption' ? 'Operational disruption — size the lost output and the insurance cover.' : 'Negative development in the window — check whether it changes the thesis.';
  if (key === 'enabling') return `${stage === 'PROPOSED' ? 'A proposal' : 'An enabling step (LoI / MoU / board approval)'}, not an executed order — nothing is booked yet.`;
  if (cls === 'CONFIRMED_LOW_MATERIALITY') return type === 'Earnings' ? 'Real result, but the change is modest — unlikely to explain the move alone.' : 'Real event, but too small relative to company scale to explain the move.';
  // zzz789: event-aware — the open question for THIS kind of event (ABDL → demand, acquisition → target economics, capex → utilisation, debt → balance sheet).
  if (cls === 'POTENTIAL_UNVERIFIED') return mat.label === 'UNKNOWN' || o.secondary ? openWhy(key, type, o) : 'Reported in a summary only — verify it in the filing before spending time on it.';
  const under = gap.direction === 'UNDER_REFLECTED' ? ' and the move looks small against it' : gap.direction === 'EXPECTATION_HEAVY' ? ', though the move already runs ahead of it' : '';
  const openTxt = (want: string[]) => { const m = o.open.map((x) => x.toLowerCase()).filter((x) => want.some((w) => x.startsWith(w))); return m.length ? ` (not yet stated: ${m.join(', ')})` : ''; };
  switch (key) {
    case 'order': case 'customer': return `Large order relative to company scale${under}, but execution and margin economics remain unknown${openTxt(['margin', 'execution', 'working', 'repeat'])}.`;
    case 'capacity': return `Verified capacity change${under}; the open question is utilisation — demand, revenue and EBITDA for the new capacity are not yet disclosed${openTxt(['utilisation', 'demand', 'revenue', 'ebitda'])}.`;
    // zzz789: the open question for a deal is the TARGET's economics.
    case 'acquisition': return `Acquisition sized against the company${under} — what matters is the target's economics: revenue / EBITDA, funding and contribution${openTxt(['target', 'funding', 'contribution'])}.`;
    case 'earnings': return `Reported growth large enough to move earnings power${under}; check whether it repeats and whether cash follows profit${e?.stale ? ' (result is older context, not this move\'s trigger)' : ''}.`;
    case 'approval': return 'Approval opens a market; the revenue it books is not yet disclosed.';
    default: return `Confirmed event with a stated economic size${under}; the path to earnings still needs checking.`;
  }
}

function actionOf(cls: EventClass, rel: PortfolioRelevance, type?: EventType): ResearchAction {
  if (cls === 'NEGATIVE') return 'Negative evidence';
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY') return 'No catalyst';
  // zzz787: capital-allocation research is never "thesis evidence" / a portfolio action.
  if (type && CAPITAL_ALLOCATION_TYPES.has(type)) return cls === 'POTENTIAL_UNVERIFIED' ? 'Investigate' : 'Monitor';
  if ((rel === 'HOLDING' || rel === 'WATCHLIST') && (cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED')) return 'Thesis evidence';
  if (cls === 'CONFIRMED_MATERIAL') return 'Review';
  if (cls === 'POTENTIAL_UNVERIFIED' || cls === 'DATA_UNAVAILABLE') return 'Investigate';
  return 'Monitor';
}


const PRICING_LABEL: Record<string, string> = {
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT EVIDENCE', RAN_UP_BEFORE_FILING: 'RAN UP BEFORE FILING', REACTION_SMALL_VS_SIZE: 'SMALL VS SIZE',
  REACTION_IN_LINE: 'IN LINE WITH SIZE', REACTION_EXCEEDS_SIZE: 'EXCEEDS SIZE', FELL_AFTER_FILING: 'FELL AFTER FILING',
};
function pricingOfFinding(f: Finding | null): ResearchItem['pricing'] {
  const p = (f?.components as any)?.pricing;
  if (!p || !p.state) return null;
  return { state: String(p.state), label: PRICING_LABEL[String(p.state)] || String(p.state), text: String(p.text || '') };
}

/** zzz775: answer each research question from what the filing states. */
export function answerQuestions(qs: string[], ctx: { facts: Record<string, string> | null; read: boolean; value: number | null; marketCap: number | null; market: 'IN' | 'US'; revenue: number | null; headline: string; quote: string | null }): string[] {
  const f: Record<string, string> = ctx.facts && !Array.isArray(ctx.facts) ? ctx.facts : {};
  const pctOf = (v: number, base: number) => Math.round((v / base) * 1000) / 10;
  const sizeAns = (): string | null => {
    if (ctx.value == null) return f.value ? `${f.value} (as stated)` : null;
    // zzz787: an unread figure is stated, never turned into a % of anything.
    if (!ctx.read) return `${moneyExact(ctx.value, ctx.market)} stated · document verification pending (no % computed)`;
    const parts = [moneyExact(ctx.value, ctx.market)];
    if (ctx.revenue) parts.push(`≈ ${pctOf(ctx.value, ctx.revenue)}% of TTM revenue`);
    if (ctx.marketCap) parts.push(`≈ ${pctOf(ctx.value, ctx.marketCap)}% of market cap`);
    return parts.join(' · ');
  };
  const pick = (q: string): string | null => {
    const l = q.toLowerCase();
    if (/% of fy revenue|% of last full-year revenue|price was paid|capex was invested|capex amount|amount raised|what exactly changed|issue size|how much.*invest/.test(l)) return sizeAns() || f.price_terms || null;
    if (/over what period|execution period|billing starts|when does revenue start|when do commercial|revenue timing|by when|conversion to an order|commissioning date/.test(l)) return [f.execution_period, f.revenue_start].filter(Boolean).join(' · ') || null;
    if (/margin|pricing/.test(l)) return f.margin || null;
    if (/funded|funding/.test(l)) return f.funding || null;
    if (/counterparty|who is the|customer|repeat customer|which competitors|allottees named/.test(l)) return f.counterparty || null;
    if (/approval|binding|definitive agreement|conditions/.test(l)) return f.conditions || null;
    if (/utilisation|capacity/.test(l)) return f.capacity || null;
    if (/target's revenue|ebitda|dilution/.test(l)) return f.price_terms || null;
    return null;
  };
  return qs.map((q) => {
    const a = pick(q);
    if (a) return `${q} — ✓ ${a}${ctx.read ? ' (per the filing)' : ' (as stated in the filing summary; document not read yet)'}`;
    return ctx.read ? `${q} — not stated in the filing (ask management / next concall)` : q;
  });
}

const EVIDENCE_WORD = ['no event on file', 'secondary source', 'official filing', 'document read'];
const MECH_WORD = ['no mechanism', 'mechanism identified', 'mechanism quantified'];
const PERS_WORD = ['runway not established', 'one period', 'multi-period'];
const MAT_WORD = ['small vs size', 'size unresolved', 'material vs size'];

/** The rank of one item as a short line built ONLY from its rank components
 *  (evidence, mechanism, persistence, materiality, recency, penalties). The
 *  size of the move is never a component. (zzz835) */
export function rankReasonOf(it: Pick<ResearchItem, 'rankParts' | 'ageDays'>): string {
  const r = it.rankParts;
  if (!r) return '';
  const age = typeof it.ageDays === 'number' && Number.isFinite(it.ageDays) ? (it.ageDays <= 0 ? 'filed today' : `filed ${Math.round(it.ageDays)}d ago`) : 'filing age unknown';
  const bits = [
    `evidence ${r.evidence}/3 (${EVIDENCE_WORD[r.evidence] || '—'})`,
    `mechanism ${r.mechanism}/2 (${MECH_WORD[r.mechanism] || '—'})`,
    `persistence ${r.persistence}/2 (${PERS_WORD[r.persistence] || '—'})`,
    `materiality ${r.materiality}/2 (${MAT_WORD[r.materiality] || '—'})`,
    `recency ${r.recency.toFixed(2)} (${age})`,
  ];
  if (r.penalties.length) bits.push(`penalty: ${r.penalties.join(', ')}`);
  return `${bits.join(' · ')} · price not used`;
}

export function buildResearchItem(ticker: string, f: Finding | null, b: BoardRow | null, filed: FiledRow | null, input: ResearchViewInput, sets: { held: Set<string>; watch: Set<string>; theme: Set<string> }): ResearchItem {
  const market = input.market;
  const perf = (b?.perf && typeof b.perf === 'object') ? b.perf : {};
  const moveRaw = num(f?.movePct) ?? num(b?.move_pct);
  const usWeekly = market === 'US' && input.moveWindow === '1W';
  const mv = { pct: moveRaw == null ? null : r1(moveRaw), window: (usWeekly ? '1W' : '1D') as '1D' | '1W' };
  const returns = {
    w1: usWeekly ? mv.pct : num(f?.returns?.w1) != null ? r1(f!.returns!.w1 as number) : num(perf.w1 ?? perf.week),
    m1: num(f?.returns?.m1) != null ? r1(f!.returns!.m1 as number) : num(perf.m1) != null ? r1(num(perf.m1)!) : null,
    m3: num(f?.returns?.m3) != null ? r1(f!.returns!.m3 as number) : num(perf.m3) != null ? r1(num(perf.m3)!) : null,
  };
  const marketCap = num(f?.marketCap) ?? num(b?.market_cap) ?? filed?.marketCap ?? null;
  // zzz835: a name for every row. The finding / scan row / filed row can carry the
  // ticker itself ("544434") where the screen had no visible name; that is not a
  // name. Order: finding → scan row → filed row → looked-up name (screener.in /
  // BSE map) → nothing (companyName then falls back to the displayed name).
  const nameCands: Array<[string, string | null | undefined]> = [['finding', f?.company], ['scan', b?.company], ['filed', filed?.company], ['lookup', input.companyNames?.[ticker] ?? input.companyNames?.[up(ticker)] ?? null]];
  const picked = nameCands.map(([from, v]) => [from, v ? clean(v) : ''] as const).find(([, v]) => isRealName(v, ticker));
  const company = picked ? picked[1] : null;
  const e = filed ? earningsMiniOf(filed) : null;
  const status = f?.status || null;
  const notes = (f?.notes || []).map(clean);
  const headline0 = clean(f?.headline || '');
  const quote = f?.evidenceQuote ? clean(f.evidenceQuote) : null;
  const evHay = `${headline0} ${quote || ''}`;
  const hay = `${evHay} ${notes.join(' ')}`;
  // zzz782: a sentence copied verbatim from the filed document (US press
  // release, no model) is as verified as a model-read quote.
  const verifiedDoc = !!(f && (f.modelRead || f.docExtract) && quote);
  const revenue = filed?.ttmRevenue ? { v: filed.ttmRevenue, basis: 'ttm_revenue' as const } : filed?.annualRevenue ? { v: filed.annualRevenue, basis: 'annual_revenue' as const } : null;
  // zzz785: workstream A/B structured facts, when the finding carries them.
  const sfacts = structuredFactsOf(f);
  const sfFund = sfacts.filter((x) => x.event.kind === 'fundraising').slice(-1)[0] || null;
  // zzz787 — a figure counts as VERIFIED only when a READ official document
  // states it: a model-read / verbatim-extracted quote on the finding, or a
  // DOCUMENT_READ structured fact carrying the same value. A summary, subject
  // line or filing metadata figure is "stated", never a materiality ratio.
  const docStates = (v: number | null): boolean => v != null && sfacts.some((x) => x.source.access === 'DOCUMENT_READ' && x.source.kind !== 'PRESS'
    && [x.economics.valueNative, x.economics.considerationNative, x.economics.capex].some((n) => n != null && Math.abs(n - v) <= Math.max(0.01, v * 0.01)));
  const isVerifiedValue = (v: number | null): boolean => v != null && (verifiedDoc || docStates(v));

  // ── which event does this name carry? ──
  const earningsLead = !!e && (!f || status === 'none' || status === 'source_failed' || status === 'routine_only' || status === 'unresearched' || (status === 'catalyst' && f.category === 'quarterly_result'));
  let cls: EventClass; let type: EventType; let label: string | null = null; let stage: Stage = 'UNKNOWN';
  let conf: SourceConfidence = 'UNVERIFIED';
  let mat: Materiality = { label: 'UNKNOWN', ratios: [], explanation: 'Not disclosed.' };
  let headline = headline0;
  let dilution = false, denial = false, routine = false;
  const listing = status === 'listing_artifact';
  const bandLevel = f?.bandPrint ? (f.bandLevel ?? null) : null;
  let cap: ReturnType<typeof parseCapacityChange> = null;
  let value: number | null = num(f?.valueStated);
  let sourceUrl = f?.sourceUrl || null;
  let filedDate = f?.sourceDate ? String(f.sourceDate).slice(0, 10) : null;
  // The finding's own age when it has one; otherwise aged from its filing
  // date against the scan instant (input.now) — never the clock. (zzz771)
  let ageDays: number | null = ageFrom(f?.sourceDate ? String(f.sourceDate) : null, input.now, market) ?? num(f?.ageDays);   // zzz835: exchange-calendar age first; the pipeline's UTC-day age only when no date
  const windowDays = num(f?.windowDays) ?? 21;
  const scanScope = market === 'US' ? 'SEC' : 'exchange';
  const notScanned = 'news, broker actions and sector moves are not scanned';
  let scanNote: string | null = null;
  let clarification = false;
  let favourableOutcome = false;
  let fr: FundraiseRead | null = null;

  if (status === 'source_failed' && !e) {
    cls = 'DATA_UNAVAILABLE'; type = 'No identified catalyst'; label = 'Source unavailable'; headline = 'Filing source could not be reached — not "no catalyst"';
    // zzz782: say WHICH failure — a ticker EDGAR does not list is not an
    // outage, and neither is "checked, nothing filed".
    if (market === 'US' && notes.some((n) => /not in the SEC company list/i.test(n))) { label = 'Not in SEC EDGAR'; headline = 'Ticker not found in the SEC company list (CIK not found) — filings not checked, not "no catalyst"'; }
    else if (market === 'US') headline = 'SEC EDGAR could not be reached for this name — filings not checked, not "no catalyst"';
  } else if (listing) {
    cls = 'LISTING'; type = 'No identified catalyst'; label = 'Recent listing'; conf = f?.sourceTier === 'primary' ? 'VERIFIED_FILING' : 'UNVERIFIED';
  } else if (status === 'denied') {
    // zzz771: "no undisclosed information" is the company confirming there is
    // NO catalyst — evidence of absence, not a negative event. Only a reply
    // that contradicts a specific reported story is a denial. Findings stored
    // before zzz771 carry no denialKind; their headline says which it was.
    const kind = f!.denialKind || (/denied the reported|denies|baseless|no such/i.test(headline0) ? 'denial' : 'clarification');
    denial = true; conf = 'VERIFIED_FILING';
    if (kind === 'denial') { cls = 'NEGATIVE'; type = 'Denial'; stage = 'EXECUTED'; }
    else {
      clarification = true; cls = 'NO_CATALYST'; type = 'No identified catalyst';
      label = `Company confirmed no undisclosed information (exchange clarification, ${filedDate || 'undated'})`;
      scanNote = `Company confirmed no undisclosed information to the ${scanScope}${filedDate ? ` on ${filedDate}` : ''} — ${notScanned}`;
    }
  } else if (status === 'negative' && f!.category === 'dilution') {
    // zzz771 (US): a registration is a raise (potential, dilution flag), a
    // resale / shelf (supply overhang, NO_CATALYST) or distress (NEGATIVE).
    type = 'Fundraising'; dilution = true;
    conf = verifiedDoc ? 'VERIFIED_DOCUMENT' : f!.sourceTier === 'primary' ? 'VERIFIED_FILING' : f!.sourceTier === 'secondary' ? 'SECONDARY_SUMMARY' : 'UNVERIFIED';
    stage = stageOf(type, f!.stage, evHay);
    fr = fundraisingOf(evHay, stage, value, marketCap, market, isVerifiedValue(value ?? sfFund?.economics.valueNative ?? null), true, sfFund);
    cls = fr.cls; label = fr.label; mat = fr.mat;
    if (fr.resale) scanNote = `Only a resale / shelf registration in the last ${windowDays} days — ${notScanned}`;
  } else if (status === 'negative') {
    const t = eventTypeOf(f!.category, evHay, true); type = t.type; label = t.label; cls = 'NEGATIVE';
    dilution = type === 'Fundraising';
    conf = verifiedDoc ? 'VERIFIED_DOCUMENT' : f!.sourceTier === 'primary' ? 'VERIFIED_FILING' : f!.sourceTier === 'secondary' ? 'SECONDARY_SUMMARY' : 'UNVERIFIED';
    stage = stageOf(type, f!.stage, evHay);
    if (type === 'Order cancellation') mat = valueMateriality(value, marketCap, revenue, market, 'order', isVerifiedValue(value), false);
  } else if (status === 'catalyst' && !earningsLead) {
    const t = eventTypeOf(f!.category, evHay, false); type = t.type; label = t.label;
    stage = stageOf(type, f!.stage, evHay);
    if (notes.some((n) => /Offering filed in the window/i.test(n))) dilution = true;
    conf = verifiedDoc ? 'VERIFIED_DOCUMENT' : f!.sourceTier === 'primary' ? 'VERIFIED_FILING' : f!.sourceTier === 'secondary' ? 'SECONDARY_SUMMARY' : 'UNVERIFIED';
    const renewal = notes.some((n) => /renewal or re-announcement/i.test(n));
    if (type === 'Capacity expansion' || type === 'Production ramp') {
      cap = parseCapacityChange(`${quote || ''} ${headline0}`);
      // zzz787: a capacity change read only from a summary headline is stated, not verified — no % from it.
      if (cap && !verifiedDoc) mat = { label: 'UNKNOWN', ratios: [], verification: 'PENDING', confidence: 0, statedValue: null, explanation: `UNKNOWN — pending document verification. Stated capacity ${cap.before} → ${cap.after} · Source: filing metadata/summary · Document verification: pending.` };
      else if (cap) {
        const lab: Materiality['label'] = cap.pct >= 25 ? 'SIGNIFICANT' : cap.pct >= 10 ? 'MODERATE' : 'SMALL';
        mat = { label: lab, ratios: [{ basis: 'current_capacity', pct: cap.pct, text: `${cap.delta} ÷ ${cap.before} current capacity = ${cap.pct}%` }], explanation: `Capacity increment ${cap.before} → ${cap.after} = +${cap.pct}% of current capacity.` };
        mat.verification = 'DOCUMENT_VERIFIED'; mat.confidence = 1;
        if (value != null) mat.ratios.push(...valueMateriality(value, marketCap, revenue, market, 'capex', isVerifiedValue(value), renewal).ratios);
      } else mat = valueMateriality(value, marketCap, revenue, market, 'capex', isVerifiedValue(value), renewal);
    } else {
      const k: keyof typeof BANDS = type === 'Acquisition' || type === 'Merger' || type === 'JV' || type === 'Divestment' ? 'acquisition' : type === 'Buyback' || type === 'Capital allocation' ? 'buyback' : type === 'Order win' || type === 'Contract' || type === 'Customer win' ? 'order' : 'generic';
      mat = valueMateriality(value, marketCap, revenue, market, k, isVerifiedValue(value), renewal);
    }
    const early = stage === 'RUMOUR' || stage === 'PROPOSED' || stage === 'ENABLING';
    if (early && mat.label !== 'UNKNOWN') {
      // A number attached to an LoI / MoU / proposal / board approval is scale,
      // not an economic commitment: nothing is booked or spent yet.
      const nonBinding = type === 'Partnership' || type === 'Contract' || type === 'Order win' || stage === 'RUMOUR';
      const ladder: Materiality['label'][] = ['SMALL', 'MODERATE', 'SIGNIFICANT'];
      mat = { ...mat, label: nonBinding ? 'UNKNOWN' : ladder[Math.max(0, ladder.indexOf(mat.label) - 1)],
        explanation: `${mat.explanation} ${nonBinding ? 'Non-binding / not awarded — the ratio shows scale only, not a commitment.' : `Not executed (${stage}) — one level lower until it is.`}` };
    }
    if (early && !label) label = type === 'Capacity expansion' ? 'Capex plan (not executed)' : `${type} (${stage.toLowerCase()}, not executed)`;
    if (type === 'Fundraising') {
      // zzz771: preferential / QIP / warrants / rights / private placement is
      // a potential catalyst with a dilution flag; NEGATIVE only on distress.
      dilution = true;
      fr = fundraisingOf(evHay, stage, value, marketCap, market, isVerifiedValue(value ?? sfFund?.economics.valueNative ?? null), false, sfFund);
      cls = fr.cls; label = early ? `${fr.label} (${stage.toLowerCase()}, not allotted)` : fr.label; mat = fr.mat;
    }
    else if (type === 'Management change' && /resign|cessation|steps? down|stepped down|departure/i.test(evHay)) { cls = 'NEGATIVE'; label = 'Management departure'; }
    else if (type === 'Management change' || type === 'Governance' || type === 'Rating action' || type === 'Promoter buying') cls = 'CONFIRMED_LOW_MATERIALITY';
    else if (early || conf === 'SECONDARY_SUMMARY' || conf === 'UNVERIFIED') cls = 'POTENTIAL_UNVERIFIED';
    else if (mat.label === 'SMALL') cls = 'CONFIRMED_LOW_MATERIALITY';
    else if (mat.label === 'SIGNIFICANT' || mat.label === 'MODERATE') cls = 'CONFIRMED_MATERIAL';
    else cls = verifiedDoc && (type === 'Regulatory approval' || type === 'Production ramp') ? 'CONFIRMED_MATERIAL' : 'POTENTIAL_UNVERIFIED';
    if (early && (type === 'Order win')) { type = 'Contract'; label = label || 'Enabling stage (not an order)'; }     // belt and braces: an early-stage "order" is never an order win
  } else if (earningsLead && e) {
    type = 'Earnings'; stage = 'MONETIZING'; conf = 'VERIFIED_FILING';
    mat = earningsMateriality(e, filed, market);
    const weak = String(filed!.tier || '').toUpperCase() === 'AVOID' || (e.revenueYoY != null && e.revenueYoY < 0 && (e.patYoY == null || e.patYoY < 0)) || (e.patYoY != null && e.patYoY <= -20);
    const strong = /BLOCKBUSTER|STRONG/i.test(String(filed!.tier || '')) || ((e.revenueYoY ?? -1) >= 15 && (e.patYoY ?? -1) >= 20);
    cls = e.revenueYoY == null && e.patYoY == null ? 'POTENTIAL_UNVERIFIED' : weak ? 'NEGATIVE' : strong && mat.label !== 'SMALL' ? 'CONFIRMED_MATERIAL' : 'CONFIRMED_LOW_MATERIALITY';
    label = weak ? 'Weak result' : null;
    headline = `${filed!.quarter ? `${filed!.quarter} result` : 'Quarterly result'} filed${filed!.filingDate ? ` ${filed!.filingDate}` : ''}${e.keyChange ? ` — ${e.keyChange}` : ''}`;
    sourceUrl = filed!.url || sourceUrl; filedDate = filed!.filingDate || filedDate; ageDays = filed!.ageDays ?? ageDays; value = null;
  } else if (status === 'routine_only') {
    routine = true;
    const unclassified = /not classifiable/i.test(headline0);
    cls = bandLevel != null && !unclassified ? 'MARKET_MOVE_ONLY' : 'NO_CATALYST';
    type = /debt financing/i.test(headline0) ? 'Debt / refinancing' : cls === 'MARKET_MOVE_ONLY' ? 'Market/technical move' : 'No identified catalyst';
    // zzz789: a favourable tax / legal outcome (appeal allowed, demand reduced) is resolved — said so, never negative.
    favourableOutcome = notes.some((n) => /in the company'?s favour|favourable (regulatory|tax|legal)/i.test(n)) || /favourable regulatory \/ legal outcome/i.test(notes.join(' '));
    label = unclassified ? 'Unclassified filing — open it' : favourableOutcome ? 'Favourable tax / legal outcome — resolved (not negative)' : /debt financing/i.test(headline0) ? 'Debt financing (not a catalyst)' : 'Routine filings only';
    // zzz771: nothing here was verified as an event — the confidence is
    // UNVERIFIED, and the note says what WAS scanned so "no catalyst" is
    // never read as "nothing happened".
    conf = 'UNVERIFIED';
    const n = num(f?.filingsInWindow);
    scanNote = `${n != null && n > 0 ? `${n} ${scanScope} filing${n === 1 ? '' : 's'}` : `${scanScope === 'SEC' ? 'SEC' : 'Exchange'} filings`} in the last ${windowDays} days, ${unclassified ? 'none classifiable as an event' : 'all routine paperwork'} — ${notScanned}`;
  } else {
    // none / unresearched without a result
    cls = bandLevel != null ? 'MARKET_MOVE_ONLY' : 'NO_CATALYST';
    type = cls === 'MARKET_MOVE_ONLY' ? 'Market/technical move' : 'No identified catalyst';
    conf = 'UNVERIFIED';
    if (f) {
      // zzz782 (US): "EDGAR checked, only insider Form 4s" is said as such.
      const insider = market === 'US' ? /SEC EDGAR checked[^:]*: (\d+) insider ownership report/.exec(notes.join(' ')) : null;
      const checked = insider ? ` (EDGAR checked; ${insider[1]} insider Form 3/4/5/144 report${insider[1] === '1' ? '' : 's'} not counted as events)` : '';
      scanNote = `No ${scanScope} filing in the last ${windowDays} days${checked} — ${notScanned}`;
      if (!headline) headline = `No ${scanScope} filing in the last ${windowDays} days`;
      // "No filing in the last 21 days" reads as "nothing happened": it names
      // what was scanned instead. (zzz771)
      headline = headline.replace(/No filing in the last (\d+) days/, `No ${scanScope} filing in the last $1 days (${notScanned})`);
    } else if (!headline) headline = 'Not researched yet';
  }
  if (!headline) headline = label || type;

  // zzz785 (BETA): a positive event that only press — or an unread document —
  // carries is POTENTIAL · verification required, never "no catalyst".
  let keyOverride: string | null = null;
  const posFacts = sfacts.filter((x) => POSITIVE_KIND_TYPE[x.event.kind]);
  if ((cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY') && !clarification && !fr?.resale && posFacts.length && status !== 'source_failed' && !listing) {
    const x = posFacts[posFacts.length - 1];
    const officialRead = (x.source.kind === 'EXCHANGE_FILING' || x.source.kind === 'SEC_FILING' || x.source.kind === 'SUBSIDIARY_FILING' || x.source.kind === 'COMPANY_IR') && x.source.access === 'DOCUMENT_READ';
    cls = 'POTENTIAL_UNVERIFIED'; type = POSITIVE_KIND_TYPE[x.event.kind]!;
    conf = officialRead ? 'VERIFIED_FILING' : 'SECONDARY_SUMMARY';
    label = officialRead ? `${KIND_WORD[x.event.kind]} — potential (on file, size not established)` : `${KIND_WORD[x.event.kind]} — Potential · verification required`;
    headline = clean(x.source.title) || label;
    sourceUrl = x.source.url || sourceUrl; filedDate = x.source.date || filedDate; ageDays = ageFrom(x.source.date, input.now, market) ?? ageDays;
    stage = x.event.stage === 'PROPOSED' || x.event.stage === 'ANNOUNCED' ? 'PROPOSED' : x.event.stage === 'AWARDED' ? 'AWARDED' : x.event.stage === 'SIGNED' ? 'SIGNED' : 'UNKNOWN';
    scanNote = null; routine = false;
    if (x.economics.valueNative != null) { value = x.economics.valueNative; mat = valueMateriality(value, marketCap, revenue, market, x.event.kind === 'order' ? 'order' : x.event.kind === 'acquisition' || x.event.kind === 'merger' ? 'acquisition' : 'generic', officialRead, false); }
    if (isStrategicStakeKind(x.event.kind)) keyOverride = 'strategic';
  }

  // zzz771: can this event be THIS session's catalyst? Only classes that
  // carry a dated event get an answer; no-catalyst / listing / unavailable
  // rows have nothing to date.
  const dated = cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || cls === 'NEGATIVE';
  const catalystFor = dated ? catalystForOf(market, ageDays) : undefined;
  const isContext = catalystFor === 'CONTEXT';

  const trans = transmissionOf(type, cls, stage, mat.label);
  // zzz787 — potential (facts first, type as labelled fallback), evidence
  // (facts only), and the consistency guard between them. The facts read are
  // this catalyst's family (an order thread for an order) — never another
  // event of the same company.
  const fam = FAMILY_OF[type] || [];
  const famFacts = (sfacts.length ? sfacts : factsForFinding(f)).filter((x) => fam.includes(x.event.kind) && (x as any).polarity !== 'negative');
  const famHay = `${evHay} ${factText(famFacts)}`;
  const orderLikeT = type === 'Order win' || type === 'Contract' || type === 'Customer win';
  const contractYears = orderLikeT && cls !== 'NEGATIVE' ? contractTermYears(famHay) : null;
  const secondaryOnly = (conf === 'SECONDARY_SUMMARY' || conf === 'UNVERIFIED') && !famFacts.some((x) => x.source.kind !== 'PRESS' && x.source.access === 'DOCUMENT_READ');
  const potRaw = potentialDurationOf(type, cls, evHay, famFacts, { secondaryOnly });
  // zzz789: economics QUANTIFIED in a read official document — a firm value /
  // capex / consideration / target revenue (a stated "potential" never counts).
  const officialFilings = new Set(famFacts.filter((x) => x.source.kind !== 'PRESS' && x.source.date).map((x) => String(x.source.date).slice(0, 10))).size;
  const quantified = (value != null && isVerifiedValue(value))
    || famFacts.some((x) => x.source.kind !== 'PRESS' && x.source.access === 'DOCUMENT_READ' && [x.economics.valueNative, x.economics.considerationNative, x.economics.capex, x.economics.targetRevenueNative, x.economics.targetProfitNative].some((n) => n != null))
    || (!!cap && verifiedDoc)
    || (verifiedDoc && /\butili[sz]ation[^.]{0,20}?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*utili[sz]ation/i.test(evHay));
  // zzz787: the thread's facts can say what the headline does not — a programme
  // (RAYMOND "fighter aircraft programme", "multi-programme … annually") or a term.
  const refineKey = (k: string): string => (k === 'order' && contractTermYears(famHay) != null && !PROGRAMME_WORDS.test(famHay) ? 'contract_term' : k === 'order' && PROGRAMME_WORDS.test(famHay) ? 'order_recurring' : k);
  const key0 = refineKey(keyOverride || nextKey(type, cls, stage, f, clarification));
  const pcSum = (f as any)?.persistence ?? null;
  const persEv = persistenceEvidenceOf(type, cls, stage, key0, famHay, pcSum, { officialPeriods: officialEvidencePeriods(famFacts), contractYears, quantified, officialFilings });
  const guard = guardPotential(potRaw, persEv, contractYears);
  const pers: Persistence = guard.pot.value;
  // zzz782: a tax / penalty demand that is a rounding error against the
  // company's size (SEDEMAC ₹40,036; JAMNAAUTO ₹4 Cr) is shown, but as an
  // IMMATERIAL negative — not ranked with real negative evidence.
  let immaterialNegative = false;
  if (cls === 'NEGATIVE' && market === 'IN' && /\b(gst|tax|penalt\w*|demand|show[- ]cause|\bscn\b|notice|interest|fine)\b/i.test(evHay)) {
    const amt = negativeAmountCr(evHay);
    if (amt != null && marketCap && marketCap > 0) {
      const p = (amt / marketCap) * 100;
      if (p < 0.25) {
        immaterialNegative = true;
        mat = { label: 'SMALL', ratios: [{ basis: 'market_cap', pct: Math.round(p * 1000) / 1000, text: `${money(amt, market)} ÷ ${money(marketCap, market)} market cap = ${p < 0.01 ? '<0.01' : r1(p)}%` }],
          explanation: `Immaterial: the stated amounts total ${money(amt, market)}, ${p < 0.01 ? 'under 0.01' : r1(p)}% of market cap — a one-off tax / penalty item, recorded but not treated as negative evidence.` };
      }
    }
  }
  const fc = (() => {
    if (type === 'Earnings' && e?.revenueYoY != null) return { pct: Math.abs(e.revenueYoY), text: `revenue ${pctS(e.revenueYoY)} YoY` };
    const r0 = mat.ratios[0];
    if (!r0 || stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR') return null;
    const what = type === 'Capacity expansion' || type === 'Production ramp' ? 'capacity' : type === 'Acquisition' ? 'deal' : type === 'Buyback' ? 'buyback' : 'order';
    return { pct: r0.pct, text: `${what} = ${r0.pct}% of ${r0.basis === 'market_cap' ? 'market cap' : r0.basis === 'current_capacity' ? 'current capacity' : 'revenue'}` };
  })();
  const gap = gapOf(cls, mv, returns, fc);

  let whatChanged: string | null = null, before: string | null = null, after: string | null = null;
  if (cap) { whatChanged = `Capacity ${cap.before} → ${cap.after} (${cap.delta}, +${cap.pct}%)`; before = cap.before; after = cap.after; }
  else if (type === 'Earnings' && e && filed) {
    const parts: string[] = [];
    if (filed.salesPrev != null && filed.salesCurr != null) { parts.push(`Revenue ${money(filed.salesPrev, market)} → ${money(filed.salesCurr, market)} (${pctS(e.revenueYoY)} YoY)`); }
    else if (e.revenueYoY != null) parts.push(`Revenue ${pctS(e.revenueYoY)} YoY`);
    if (filed.patPrev != null && filed.patCurr != null) parts.push(`PAT ${money(filed.patPrev, market)} → ${money(filed.patCurr, market)} (${pctS(e.patYoY)} YoY)`);
    else if (e.patYoY != null) parts.push(`PAT ${pctS(e.patYoY)} YoY`);
    whatChanged = parts.length ? parts.join('; ') : null;
    if (filed.salesPrev != null || filed.patPrev != null) before = [filed.salesPrev != null ? `Revenue ${money(filed.salesPrev, market)}` : null, filed.patPrev != null ? `PAT ${money(filed.patPrev, market)}` : null].filter(Boolean).join(', ') + ' (year-ago quarter)';
    if (filed.salesCurr != null || filed.patCurr != null) after = [filed.salesCurr != null ? `Revenue ${money(filed.salesCurr, market)}` : null, filed.patCurr != null ? `PAT ${money(filed.patCurr, market)}` : null].filter(Boolean).join(', ') + ' (this quarter)';
  } else if (value != null && (cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || type === 'Order cancellation')) {
    const earlyW = stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR';
    // zzz789: the figure is labelled for what it IS — capex, consideration, issue size, amount redeemed … (MILKYMIST ₹40 Cr is capex, not an order value).
    const vl = valueLabelOf(type, evHay);
    const ratioTxt = mat.ratios[0] ? ` = ${mat.ratios[0].pct}% of ${mat.ratios[0].basis === 'market_cap' ? 'market cap' : 'revenue'}` : '';
    // zzz787: a figure the read document has not confirmed is STATED only —
    // never "= X% of market cap" beside "not verified".
    const pendingV = mat.verification === 'PENDING' || !isVerifiedValue(value);
    whatChanged = earlyW
      ? `${label || type}: ${moneyExact(value, market)} stated, nothing booked yet (${stage})${ratioTxt && !pendingV ? ` — scale${ratioTxt}` : pendingV ? ' — document verification pending' : ''}`
      : pendingV
        ? `Stated ${vl.label}: ${moneyExact(value, market)} · Source: filing metadata/summary · Document verification: pending`
        // zzz789: debt — the verified FACT ("$25M notes redeemed"); its impact is a separate unknown (KOS).
        : type === 'Debt / refinancing' ? `${moneyExact(value, market)} ${DEBT_INSTRUMENT(evHay)} ${debtActionOf(evHay) || 'raised'} (document-verified)`
          : `${vl.short} ${mat.ratios[0] ? mat.ratios[0].text : moneyExact(value, market)} (document-verified)`;
  }

  // zzz776: a GDV / "may unlock" figure is headline SCALE, not the company's
  // financial impact — shown as such rather than "not established".
  // (the same test as catalyst-research's isPotentialValue — kept local: this module stays client-safe)
  const isPotentialValue = (h: string): boolean => /\bgdv\b|gross development value|revenue potential|top ?line potential|sales potential|peak (revenue|sales) potential|may unlock|potential (revenue|value|topline)|market (size|opportunity) of/i.test(h);
  if (!whatChanged && isPotentialValue(`${headline0 || ''} ${(f?.notes || []).join(' ')}`)) {
    const m = /((?:inr|₹|rs\.?)\s*[\d,.]+(?:\s*[-–]\s*[\d,.]+)?\s*(?:crores?|cr\b|lakh crore|million|billion|bn|mn))[^.;]{0,30}/i.exec(String(headline0 || ''));
    whatChanged = `Headline scale${m ? `: ${m[0].trim()}` : ''} — project / potential scale, not the company's revenue or share; company financial impact not established`;
  }
  const key = key0;
  // zzz775: a research question the filing already answers is shown WITH its
  // answer; one the model-read filing is silent on says so. Only a filing
  // that was not read keeps the bare question.
  // zzz789: an ORDERED checklist per event kind (order / acquisition / capex /
  // product / expansion / licence / stake / debt / fundraising / merger); a
  // step the documents already answer is marked ✓ with the fact, never re-asked.
  const eventish = cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED';
  const checkCtx: CheckCtx = {
    facts: famFacts, legacy: legacyFactMapOf(f) || {}, hay: `${hay} ${factText(famFacts)}`, read: verifiedDoc || famFacts.some((x) => x.source.kind !== 'PRESS' && x.source.access === 'DOCUMENT_READ'),
    value, valueVerified: value != null && isVerifiedValue(value), statedPotential: (famFacts.map((x) => (x as any).statedPotentialNative).find((v) => typeof v === 'number') as number | undefined) ?? null,
    market, revenue: revenue ? revenue.v : null, marketCap, contractYears, officialFilings, type, secondary: secondaryOnly,
  };
  const checklist = eventish && !clarification ? researchChecklist(key, checkCtx) : null;
  const researchNext = checklist || answerQuestions((NEXT[key] || NEXT.generic).slice(0, 8), {
    facts: legacyFactMapOf(f), read: verifiedDoc, value, marketCap, market,
    revenue: revenue ? revenue.v : null, headline: headline0, quote,
  });
  // zzz789: what is still open, in the checklist's own order (drives IMPACT and WHY RESEARCH).
  const openSteps = (checklist || []).filter((l) => !/: ✓ /.test(l)).map((l) => l.replace(/^\d+\. /, '').split(':')[0]);
  // zzz789: WHAT CHANGED is the stated FACT; the IMPACT is a separate unknown (KOS).
  const datedEvent = cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || cls === 'NEGATIVE';
  if (!whatChanged && datedEvent && (quote || headline0)) {
    // The stated fact, not the headline again: the read quote, or the event's stated particulars.
    const stake = famFacts.map((x) => x.economics.stakePct).find((v) => v != null) ?? (/\b(\d+(?:\.\d+)?)\s*%\s*(?:stake|of the (?:paid[- ]up|share capital|equity))/i.exec(evHay)?.[1] ?? null);
    const who = famFacts.map((x) => x.event.counterparty).find(Boolean) || legacyFactMapOf(f)?.counterparty || null;
    const bits = [stake != null ? `${stake}% stake` : null, who, contractYears != null ? `${contractYears}-year term` : null, famFacts.map((x) => x.economics.capacityAfter).find(Boolean) || null].filter(Boolean);
    whatChanged = quote && verifiedDoc ? `As filed: “${quote.length > 220 ? `${quote.slice(0, 217)}…` : quote}”`
      : `${label || type}${bits.length ? ` — ${bits.join(' · ')}` : ''} (as stated in the filing)`;
  }
  const impact: string | null = !datedEvent ? null
    : type === 'Earnings' ? null
      : openSteps.length ? `Not established — ${openSteps.slice(0, 4).map((x) => x.toLowerCase()).join(', ')} still open`
        : checklist ? 'The documents state the main economics — see Research next' : mat.label !== 'UNKNOWN' ? null : 'Not established from the documents';
  // A clarification's unknowns are a no-catalyst row's (cause of the move), not a negative event's impact. (zzz771)
  const unknowns = unknownsFor(clarification ? 'none' : key, hay, value != null, e);
  const portfolio = portfolioOf(ticker, type, cls, e, { ...sets, vars: input.thesisVariables, findingHeld: !!f?.holding });
  // zzz771: an older event keeps its class but is labelled as context, its
  // EarningsMini is kept (stale), and its action is to monitor, not review.
  const earnings = e && isContext ? { ...e, stale: true } : e;
  const shownHeadline = isContext ? `Older context (${ageDays}d): ${headline}` : headline;
  const item: ResearchItem = {
    // zzz782: the US export carries 1W only; the 1D is the last daily bar
    // against the close before it, from the dated closes the sweep fetched.
    ticker, company, market, move1d: usWeekly ? (num((f?.returns as any)?.d1) != null ? r1(num((f?.returns as any)?.d1)!) : null) : mv.pct, returns, marketCap,
    eventClass: cls, eventType: type, headline: clean(shownHeadline), whatChanged, before, after, filedDate, stage,
    sourceConfidence: conf, sourceUrl, quote, materiality: mat, transmission: trans,
    transmissionChain: chainOf(type, trans, stage, { headline: clean(headline), value, market, mat, e, f: filed, cap }),
    persistence: pers, persistenceEvidence: persEv, potentialDuration: guard.pot, immaterialNegative, expectationGap: gap, unknowns, researchNext, pricing: pricingOfFinding(f),
    whyResearch: whyOf(cls, type, stage, mat, key, gap, e, fr, clarification, { open: openSteps, secondary: secondaryOnly, value, valueVerified: value != null && isVerifiedValue(value), hay: evHay }),
    impact,
    portfolio, earnings,
    flags: { band: bandLevel, listing, dilution, denial, turnover: num(f?.turnover) ?? num(b?.turnover) },
    priority: 0, priorityReasons: [], scoreDetails: null,
    eventLabel: label || type, action: isContext ? 'Monitor' : actionOf(cls, portfolio.relevance, type), move: mv, findingStatus: status, notes, ageDays,
    catalystFor, ...displayNameOf(ticker, company), scanNote,
    companyName: companyNameOf(ticker, company, displayNameOf(ticker, company).displayTicker).name,
    companyNameFrom: picked ? picked[0] : companyNameOf(ticker, company, displayNameOf(ticker, company).displayTicker).from,
    persistentCatalyst: f?.persistence ?? null,
    news: f?.news ? { narrative: f.news.narrative ? { label: f.news.narrative.label, days: f.news.narrative.days, firstDate: f.news.narrative.firstDate, lastDate: f.news.narrative.lastDate, lead: f.news.narrative.lead } : null, items: f.news.items.slice(0, 3).map((x) => ({ title: x.title, url: x.url, date: x.date, source: x.source })) } : null,
  };
  // zzz789: a favourable legal outcome is resolved — said so, never negative, never "nothing happened".
  if (favourableOutcome) item.whyResearch = 'A favourable tax / legal outcome (appeal allowed / demand reduced) is on file — a resolved matter, not negative evidence; it does not by itself explain the move.';
  // ── zzz785: catalyst records, timeline, persistence test, gaps, links ──
  Object.assign(item, catalystLayer(item, f, { ticker, market, cls, key, stage, evHay, pers, persEv, mat, fr, conf, verifiedDoc, marketCap, revenue, input, unknowns, potentialText: guard.pot.text, quantified }));
  // zzz787: the four duration concepts, kept apart, derived from the facts.
  item.durations = durationsOf(item, { key, famFacts, famHay, contractYears, guardNote: guard.note, valueVerified: isVerifiedValue(value), value });
  // zzz798 (US only): the SEC-document card replaces the subject-line reading.
  const usc = market === 'US' && f?.usCard ? applyUsCard(item, f.usCard, { mv, returns, now: input.now ?? null }) : null;
  // zzz803 (India only): the India card names the event a no-catalyst row missed.
  const inc = market === 'IN' && f?.inCard ? applyInCard(item, f.inCard, { status, hasEarnings: !!e, clarification, favourable: favourableOutcome, mv, returns, now: input.now ?? null }) : null;
  attachCardFacts(item);
  const staleEarnings = !usc && type === 'Earnings' && e?.filedDaysAgo != null && e.filedDaysAgo > CATALYST_WINDOWS[market].recent;
  const p = priorityOf(item, { routine: usc || inc?.presented ? false : routine, pricingState: (f?.components as any)?.pricing?.state ?? null, staleEarnings, veryStale: staleEarnings && (e!.filedDaysAgo as number) > 60, namedAllottee: !!fr?.named, clarification: clarification && !inc?.presented, quantified: usc ? usc.quantified || quantified : quantified });
  item.priority = p.score; item.priorityReasons = p.reasons; item.scoreDetails = p.details;
  const penaltyWords = Object.keys(p.details).filter((k) => k.startsWith('penalty_')).map((k) => ({ dilution: 'dilution flag', denial: 'company denial', lowMateriality: 'too small to explain the move', pricing: 'move already ahead of the change', unverified: 'unverified source', listing: 'listing artifact', routine: 'routine filings only', technical: 'technical move only', staleResult: 'older result' } as Record<string, string>)[k.slice(8)] || k.slice(8));
  item.whyRank = [...p.dims.words, ...penaltyWords.map((w) => `penalty: ${w}`)].join(' + ');
  // zzz835: the rank in one short, reproducible line — the same components, no price term.
  item.rankParts = { evidence: p.dims.evidence, mechanism: p.dims.mechanism, persistence: p.dims.persistence, materiality: p.dims.materiality, recency: Math.round((p.details.freshness ?? 0) * 100) / 100, penalties: penaltyWords };
  item.rankReason = rankReasonOf(item);
  if (usc?.earnings) item.whyRank = item.whyRank.replace(/material vs size \([^)]*\)/, `material change (${[usc.earnings.revenueGrowthPct != null ? `revenue ${pctS(usc.earnings.revenueGrowthPct)}` : null, usc.earnings.profitChange ? `net income ${usc.earnings.profitChange}` : null].filter(Boolean).join(', ')})`);
  // zzz785: unknown economics are said, not silently ranked low.
  if (item.economicsUnknown) item.priorityReasons.push(`${UNKNOWN_NEEDS_READING}${item.economicsUnknown.missing.length ? ` (${item.economicsUnknown.missing.join(', ')})` : ''}`);
  return item;
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz798 — THE US CARD ON THE ITEM (US only; India never reaches this).
// The card (us-card.ts) was read from the SEC documents without a model:
// the figures, the materiality arithmetic, the source label. It sets the
// item's WHAT CHANGED / MATERIAL / SOURCE / WHY RESEARCH and the class those
// imply; one source label per card (a VERIFIED SEC document never also
// carries "secondary · verification required").
// ═══════════════════════════════════════════════════════════════════════════

const US_EVENT_TYPES = new Set<string>(['Earnings', 'Order win', 'Contract', 'Acquisition', 'Merger', 'Divestment', 'Regulatory approval', 'Fundraising', 'Buyback', 'Guidance', 'Rating action', 'Strategic investment', 'Litigation / regulatory', 'Capacity expansion', 'No identified catalyst',
  // zzz801: the event taxonomy's wider types
  'New product', 'Customer win', 'Pricing', 'JV', 'Partnership', 'Production ramp', 'Strategic expansion', 'Debt / refinancing', 'Management change', 'Governance', 'Capital allocation', 'Promoter buying']);

// ═══════════════════════════════════════════════════════════════════════════
// zzz835 — CARD FACTS ON THE ITEM (both markets).
// Copies what the US card / India card already computed onto the item so the
// page and the PDF print the same facts: conflicts (=> impact unknown), the
// stage badge, clusters, clinical / acquisition / litigation reads, the
// causal-window verdict, what was searched, and whether an official filing
// that was read holds the event. Nothing is invented here.
// ═══════════════════════════════════════════════════════════════════════════

const STAGE_OF_US: Record<string, EventStage | null> = { PROPOSED: 'PROPOSED', SIGNED: 'SIGNED', AWARDED: 'AWARDED', EXECUTED: 'EXECUTED', MONETIZING: 'EXECUTED', RUMOUR: null, UNKNOWN: null };

/** Was the event confirmed in an official filing that was read? Derived from the card only. */
export function confirmationOf(it: Pick<ResearchItem, 'market' | 'usCard' | 'inCard'>): CatalystConfirmation | null {
  const us = it.market === 'US' ? it.usCard : null;
  if (us) {
    if (us.catalystConfirmation) return us.catalystConfirmation;
    return us.source.tier === 'SEC' ? (us.quantified ? 'confirmed_in_official_filing' : 'filed_document_unread') : us.source.tier === 'PRESS' ? 'press_unconfirmed' : 'not_found';
  }
  const inc = it.market === 'IN' ? it.inCard : null;
  const lead = inc?.lead || inc?.catalysts?.[0] || null;
  if (!lead) return inc ? 'not_found' : null;
  if (lead.source === 'FILING') return /document read/i.test(lead.sourceLabel) ? 'confirmed_in_official_filing' : 'filed_document_unread';
  return lead.confirmedByFiling ? 'filed_document_unread' : 'press_unconfirmed';
}
const CC_LABEL: Record<CatalystConfirmation, string> = {
  confirmed_in_official_filing: 'Confirmed in an official filing', filed_document_unread: 'Filed - the document itself was not read',
  press_unconfirmed: 'Reported in the press - not yet in an official filing', not_found: 'No source found',
};
function attachCardFacts(item: ResearchItem): void {
  const us = item.market === 'US' ? item.usCard : null;
  const inc = item.market === 'IN' ? item.inCard : null;
  const lead = inc ? (inc.lead || inc.catalysts?.[0] || null) : null;
  // issuer: a numeric BSE code is "BSE 544434", the company name stays apart
  item.issuer = resolveIssuer({ ticker: item.ticker, company: item.companyName || item.company });
  // conflicts
  const conflicts = new Set<string>();
  const vals: Array<{ text: string; source: string }> = [];
  for (const c of (us?.conflicts || [])) conflicts.add(c);
  for (const c of (inc?.conflicts || [])) conflicts.add(c);
  for (const c of (inc?.catalysts || [])) {
    for (const x of (c.conflicts || [])) conflicts.add(x);
    if (c.valueStatus === 'conflicting') for (const v of (c.values || [])) if (!vals.some((y) => y.text === v.text && y.source === v.source)) vals.push({ text: v.text, source: v.source });
  }
  const conflicting = conflicts.size > 0 || us?.valueStatus === 'conflicting' || lead?.valueStatus === 'conflicting';
  if (conflicting && !conflicts.size) conflicts.add('The stated values conflict; impact unknown until confirmed.');
  if (conflicts.size) item.conflicts = Array.from(conflicts);
  if (vals.length) item.conflictValues = vals;
  item.valueStatus = conflicting ? 'conflicting' : us?.valueStatus ?? lead?.valueStatus ?? undefined;
  if (conflicting) {
    // impact unknown: the size is not used until the values are reconciled; unknown is not negative
    item.materiality = { ...item.materiality, label: 'UNKNOWN', ratios: [], verification: null, confidence: 0, explanation: `Values conflict - impact unknown until confirmed. ${item.materiality?.explanation || ''}`.trim() };
    if (item.eventClass === 'CONFIRMED_MATERIAL' || item.eventClass === 'CONFIRMED_LOW_MATERIALITY') item.eventClass = 'POTENTIAL_UNVERIFIED';
    item.impact = 'Impact unknown - the stated values conflict';
  }
  // stage badge
  item.stageBadge = us ? (us.deal?.stage === 'completed' ? 'COMPLETED' : STAGE_OF_US[us.stage] ?? null) : (lead?.stage ?? null);
  // clusters: one earnings filing = one cluster with child facts
  if (us?.clusters?.length) {
    item.clusters = us.clusters.map((k) => ({
      clusterId: k.clusterId, label: k.primary.label, sentence: k.primary.sentence, source: k.primary.sourceLabel, independentSources: k.independentConfirmationCount,
      children: k.facts.filter((f) => f !== k.primary).map((f) => ({ label: f.label, sentence: f.sentence, figures: f.figures })),
    }));
  } else if (inc) {
    const res = (inc.catalysts || []).filter((c) => c.category === 'Results');
    if (res.length > 1) item.clusters = [{ clusterId: `results:${res[0].url || res[0].date || item.ticker}`, label: res[0].label, sentence: res[0].sentence, source: res[0].sourceLabel, independentSources: new Set(res.map((c) => c.url || c.title)).size, children: res.slice(1).map((f) => ({ label: f.label, sentence: f.sentence, figures: f.figures })) }];
  }
  if (us?.clinical) item.clinical = us.clinical;
  if (us?.acquisition) item.acquisition = us.acquisition;
  if (us?.litigation) item.litigation = us.litigation;
  const litigationAward = !!us?.litigation || (item.eventType === 'Litigation / regulatory' && !!lead && lead.figures.length > 0 && /award|damages|verdict|decree|compensation/i.test(`${lead.sentence} ${lead.label}`));
  if (litigationAward) item.litigationNote = LITIGATION_CASH_NOTE;
  // context only = older than the per-market move window (CATALYST_WINDOWS: India 3, US 7 calendar days, up to 14 = recent).
  // The card's own 3-day flag is not used, so the legend and the badge agree for carded items too.
  const w = CATALYST_WINDOWS[item.market];
  const age = item.ageDays;
  const ctxOnly = item.catalystFor === 'CONTEXT';
  if (age != null && item.filedDate) {
    item.causalLabel = `Filed ${age} day${age === 1 ? '' : 's'} before the move - ${age <= w.thisMove ? `inside the ${w.thisMove}-day window` : age <= w.recent ? `after the ${w.thisMove}-day window but within ${w.recent} days (recent)` : `older than ${w.recent} days: context only`}`;
  }
  if (ctxOnly) { item.contextOnly = true; item.action = 'Monitor'; }
  // what was searched / found
  if (us?.catalystStatus) { item.catalystStatusSentence = us.catalystStatus.sentence; item.searched = { sources: us.catalystStatus.sources, lookbackDays: us.catalystStatus.lookbackDays }; }
  else if (inc) {
    item.catalystStatusSentence = inc.summary || null;
    if (inc.searched) item.searched = { sources: inc.searched.sources, lookbackDays: inc.searched.lookbackDays, filings: inc.searched.filings, press: inc.searched.press };
  }
  // official filing vs state label
  const cc = confirmationOf(item);
  if (cc) { item.catalystConfirmation = cc; item.catalystConfirmationLabel = us?.catalystConfirmationLabel || CC_LABEL[cc]; }
  if (item.catalysts?.length) item.catalysts = item.catalysts.map((c, i) => (i === 0 ? { ...c, stateWord: stateWordFor(c.stateWord, cc) } : c));
  if (item.durations?.catalystState) item.durations = { ...item.durations, catalystState: stateWordFor(item.durations.catalystState, cc) };
}

/** zzz801 (US only): catalysts found per category, over the names on the board. */
function usCatalystSummary(items: ResearchItem[]): NonNullable<ResearchView['summary']['usCatalysts']> {
  const cats = ['Earnings', 'Product & segment', 'Capital & capacity', 'Corporate action', 'Deals & customers', 'Regulatory & clinical', 'Capital structure', 'Market & ownership'];
  const by = new Map<string, { names: Set<string>; sec: Set<string>; press: Set<string> }>(cats.map((c) => [c, { names: new Set(), sec: new Set(), press: new Set() }]));
  let found = 0, none = 0;
  for (const it of items) {
    const cs = it.usCard?.catalysts;
    if (!it.usCard) continue;
    if (!cs || !cs.length) { none++; continue; }
    found++;
    for (const c of cs) {
      const b = by.get(c.category);
      if (!b) continue;
      b.names.add(it.ticker);
      (c.source === 'SEC' ? b.sec : b.press).add(it.ticker);
    }
  }
  return { found, none, byCategory: cats.map((c) => { const b = by.get(c)!; return { category: c, names: b.names.size, sec: b.sec.size, press: Array.from(b.press).filter((t) => !b.sec.has(t)).length, tickers: Array.from(b.names).slice(0, 12) }; }).filter((x) => x.names > 0) };
}
const US_TRANSMIT: Partial<Record<UsCard['kind'], Transmission>> = { earnings: 'DIRECT', order: 'NEAR_TERM', acquisition: 'NEAR_TERM', merger: 'NEAR_TERM', divestiture: 'NEAR_TERM', fda: 'LONG_TERM', clinical: 'LONG_TERM', buyback: 'WEAK', offering: 'WEAK', guidance: 'NEAR_TERM', index: 'NONE', analyst: 'NONE' };

function applyUsCard(item: ResearchItem, c: UsCard, ctx: { mv: { pct: number | null; window: '1D' | '1W' }; returns: { w1: number | null; m1: number | null; m3: number | null }; now: string | null }): UsCard {
  const sec = c.source.tier === 'SEC';
  const keepClass = item.eventClass === 'DATA_UNAVAILABLE' || item.eventClass === 'LISTING';
  if (!sec && keepClass) { item.usCard = c; return c; }
  const mat = c.material.label;
  let cls: EventClass;
  if (sec) {
    if (c.kind === 'other' && c.eventType === 'No identified catalyst' && /no new (?:operating )?event/i.test(c.kindWord)) cls = 'NO_CATALYST';
    else if (c.polarity === 'negative' && c.kind !== 'offering') cls = 'NEGATIVE';
    else if (c.kind === 'offering' || c.stage === 'PROPOSED' || c.stage === 'RUMOUR') cls = 'POTENTIAL_UNVERIFIED';
    else cls = mat === 'SIGNIFICANT' || mat === 'MODERATE' ? 'CONFIRMED_MATERIAL' : mat === 'SMALL' ? 'CONFIRMED_LOW_MATERIALITY' : 'POTENTIAL_UNVERIFIED';
  } else {
    // press only: an analyst opinion, commentary or an old results write-up is
    // not a company event; a reported deal / order / approval / opening is a
    // potential one, to verify.
    const fresh = (ageFrom(c.source.date, ctx.now, 'US') ?? 99) <= 3;
    cls = c.kind === 'other' || c.kind === 'analyst' || (c.kind === 'earnings' && !fresh) ? 'NO_CATALYST' : 'POTENTIAL_UNVERIFIED';
  }
  item.eventClass = cls;
  if (US_EVENT_TYPES.has(c.eventType)) item.eventType = c.eventType as EventType;
  item.eventLabel = c.kindWord;
  item.stage = c.stage as Stage;
  item.headline = clean(c.headline) || item.headline;
  item.whatChanged = c.whatChanged; item.before = null; item.after = null;
  item.impact = c.kind === 'earnings' || !sec ? null
    : c.unknowns.length ? `Not established — ${c.unknowns.filter((u) => !/^Official filing|^Figure:/i.test(u)).map((u) => u.split(':')[0].toLowerCase()).join(', ') || 'the economics'} still open` : null;
  item.materiality = {
    label: mat, ratios: c.material.ratios.map((r) => ({ basis: r.basis, pct: r.pct, text: r.text })), explanation: c.material.how,
    verification: sec && c.quantified ? 'DOCUMENT_VERIFIED' : null, confidence: sec && c.quantified ? 1 : 0,
  };
  item.sourceConfidence = sec ? 'VERIFIED_DOCUMENT' : 'SECONDARY_SUMMARY';
  item.verification = sec ? `Official filing read — ${c.source.label.replace(/^VERIFIED DOCUMENT \(/, '').replace(/\)(?= \+|$)/, '')}` : 'Press only — no SEC filing found yet';
  if (c.source.url) item.sourceUrl = c.source.url;
  if (c.source.date) {
    item.filedDate = c.source.date;
    const a = ageFrom(c.source.date, ctx.now, 'US');
    if (a != null) item.ageDays = a;
    const dated = cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || cls === 'NEGATIVE';
    item.catalystFor = dated ? catalystForOf('US', item.ageDays ?? null) : undefined;
  }
  item.quote = c.quote ? clean(c.quote) : item.quote;
  item.whyResearch = c.whyResearch;
  item.unknowns = c.unknowns;
  if (sec && c.quantified) { item.evidenceGap = null; item.economicsUnknown = null; }
  else if (sec) item.economicsUnknown = { label: UNKNOWN_NEEDS_READING, missing: c.unknowns.map((u) => u.split(':')[0].toLowerCase()).slice(0, 4) };
  else { item.economicsUnknown = null; item.evidenceGap = null; }
  if (cls === 'NO_CATALYST') { item.catalystFor = undefined; item.scanNote = c.extra[0] || null; }
  if (c.kind === 'earnings') item.earnings = null;
  if (c.kind === 'offering') item.flags = { ...item.flags, dilution: true };
  item.transmission = (sec ? US_TRANSMIT[c.kind] : null) ?? (sec ? item.transmission : 'WEAK');
  const fc = c.earnings?.revenueGrowthPct != null ? { pct: Math.abs(c.earnings.revenueGrowthPct), text: `revenue ${pctS(c.earnings.revenueGrowthPct)} YoY` }
    : c.material.ratios[0] && sec && c.stage !== 'PROPOSED' ? { pct: c.material.ratios[0].pct, text: `${c.kind === 'order' ? 'order' : c.kind === 'buyback' ? 'buyback' : 'deal'} = ${c.material.ratios[0].pct}% of market cap` } : null;
  item.expectationGap = gapOf(cls, ctx.mv, ctx.returns, fc);
  item.action = item.catalystFor === 'CONTEXT' ? 'Monitor' : actionOf(cls, item.portfolio.relevance, item.eventType);
  item.usCard = c;
  return c;
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz803 — THE INDIA CARD ON THE ITEM (India only; the US never reaches this).
// A row the filing classifier left as "no catalyst" / "routine only" is given
// the event the India taxonomy found — the filing or the press headline that
// names it, labelled filed vs "reported, not confirmed by the company"; with
// no fresher event, the latest quarterly result (≤ 60 days, dated) is the
// fundamental backdrop; a price / volume clarification is shown as the event
// ("company says no undisclosed information"). Nothing found is said plainly:
// "No catalyst found in filings or news". No figure is added that the source
// sentence does not state; no materiality % is computed here.
// ═══════════════════════════════════════════════════════════════════════════

const IN_TYPE_OF: Record<string, EventType> = {
  turnaround_profit: 'Earnings', revenue_growth: 'Earnings', profit_growth: 'Earnings', record_results: 'Earnings', revenue_decline: 'Earnings', profit_decline: 'Earnings',
  net_loss: 'Earnings', margin_expansion: 'Earnings', margin_compression: 'Earnings', results_filed: 'Earnings', restatement: 'Governance', guidance: 'Guidance', order_book: 'Guidance',
  open_offer: 'Acquisition', promoter_selling: 'Governance', promoter_stake_sale: 'Strategic investment', promoter_buying: 'Promoter buying', pledge: 'Governance', block_deal: 'Governance',
  strategic_investor: 'Strategic investment', stake_disclosure: 'Governance', order_win: 'Order win', order_cancellation: 'Order cancellation', partnership: 'Partnership', new_product: 'New product',
  price_hike: 'Pricing', vendor_approval: 'Customer win', capacity_commissioned: 'Production ramp', capacity_expansion: 'Capacity expansion', acquisition: 'Acquisition', merger: 'Merger',
  demerger: 'Divestment', divestment: 'Divestment', joint_venture: 'JV', buyback: 'Buyback', delisting: 'Capital allocation', bonus_split: 'Capital allocation', special_dividend: 'Capital allocation',
  equity_raise: 'Fundraising', debt_raise: 'Debt / refinancing', rating_upgrade: 'Rating action', rating_downgrade: 'Rating action', auditor_resignation: 'Governance', kmp_resignation: 'Management change',
  independent_director_exit: 'Governance', kmp_appointment: 'Management change', regulatory_approval: 'Regulatory approval', regulatory_setback: 'Litigation / regulatory', tax_demand: 'Litigation / regulatory',
  legal_win: 'Litigation / regulatory', insolvency_default: 'Litigation / regulatory', operations_disruption: 'Accident / disruption', price_clarification: 'No identified catalyst',
  media_clarification: 'Governance', exchange_query: 'No identified catalyst',
};
/** Low-materiality kinds: real, but they do not by themselves explain a move. */
const IN_LOW_KINDS = new Set(['stake_disclosure', 'kmp_appointment', 'debt_raise', 'bonus_split', 'special_dividend', 'block_deal', 'media_clarification', 'restatement', 'pledge', 'vendor_approval']);
const IN_TRANSMIT: Record<string, Transmission> = { 'Order win': 'NEAR_TERM', 'Production ramp': 'NEAR_TERM', 'Capacity expansion': 'LONG_TERM', Earnings: 'DIRECT', Acquisition: 'NEAR_TERM', 'Regulatory approval': 'LONG_TERM' };

const inFigs = (c: InCatalyst | null | undefined) => (c && c.figures.length ? ` · stated: ${c.figures.join(', ')}` : '');
const inQuote = (c: InCatalyst) => `“${c.sentence.length > 220 ? `${c.sentence.slice(0, 217)}…` : c.sentence}”`;

function applyInCard(item: ResearchItem, card: InCard, ctx: { status: string | null; hasEarnings: boolean; clarification: boolean; favourable: boolean; mv: { pct: number | null; window: '1D' | '1W' }; returns: { w1: number | null; m1: number | null; m3: number | null }; now: string | null }): { presented: boolean } {
  item.inCard = card;
  const keep = item.eventClass === 'DATA_UNAVAILABLE' || item.eventClass === 'LISTING' || ctx.hasEarnings || ctx.favourable;
  // Only a row the classifier left without an event is re-read; a filed catalyst / negative keeps its own reading (the card lists the rest).
  const lead = card.lead;
  const bd = card.backdrop;
  // A filed officer change (capped: it moves no revenue) does not hide a stated result or a stronger event (Allied Digital: Q1 +19% leads, the resignation is noted).
  const weakFiled = ctx.status === 'catalyst' && item.eventType === 'Management change' && ((!!bd && bd.tone !== 'filed') || (!!lead && lead.category !== 'Results' && !IN_LOW_KINDS.has(lead.id) && lead.id !== 'kmp_resignation' && lead.id !== 'kmp_appointment'));
  const open = !keep && (weakFiled || ctx.status === 'none' || ctx.status === 'routine_only' || ctx.status === 'unresearched' || (ctx.status === 'denied' && ctx.clarification) || ((item.eventClass === 'NO_CATALYST' || item.eventClass === 'MARKET_MOVE_ONLY') && ctx.status !== 'denied' && ctx.status !== 'catalyst' && ctx.status !== 'negative'));
  if (!open) return { presented: false };
  const presentedFlags = () => { item.flags = { ...item.flags, denial: false }; };
  const setDated = (date: string | null, url: string | null) => {
    if (url) item.sourceUrl = url;
    if (date) { item.filedDate = date; const a = ageFrom(date, ctx.now, 'IN'); if (a != null) item.ageDays = a; }
  };
  const finish = (cls: EventClass) => {
    item.eventClass = cls;
    const dated = cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || cls === 'NEGATIVE';
    item.catalystFor = dated ? catalystForOf('IN', item.ageDays ?? null) : undefined;
    if (item.catalystFor === 'CONTEXT' && !/^Older context/.test(item.headline)) item.headline = `Older context (${item.ageDays}d): ${item.headline}`;
    item.action = item.catalystFor === 'CONTEXT' ? 'Monitor' : actionOf(cls, item.portfolio.relevance, item.eventType);
    item.transmission = IN_TRANSMIT[item.eventType] ?? (cls === 'NO_CATALYST' ? 'NONE' : 'WEAK');
    item.expectationGap = gapOf(cls, ctx.mv, ctx.returns, null);
    item.materiality = { label: 'UNKNOWN', ratios: [], explanation: 'Not measured — the figures are shown as stated in the source sentence; no ratio is computed from them.', verification: null, confidence: 0 };
    item.flags = { ...item.flags, dilution: item.flags.dilution || item.eventType === 'Fundraising' };
  };

  // A fresh but low-weight item (a SAST / PIT disclosure, a pledge note, an
  // appointment …) does not displace an informative result backdrop — it is
  // listed beside it (Shanti Gold: Q1 growth leads, the stake disclosure is noted).
  const bdInformative = !!bd && bd.tone !== 'filed';
  const lowLead = !!lead && (IN_LOW_KINDS.has(lead.id) || lead.direction === 'neutral');
  const alsoFresh = card.catalysts.filter((c) => c.category !== 'Results' && c.id !== 'price_clarification' && c.id !== 'exchange_query' && (c.ageDays == null || c.ageDays <= 21)).slice(0, 3);
  const alsoLine = (skip: InCatalyst | null) => { const xs = alsoFresh.filter((c) => c !== skip); return xs.length ? `; also in the window: ${xs.map((c) => `${c.label.toLowerCase()} (${c.source === 'FILING' ? 'filed' : c.confirmedByFiling ? 'press, also filed' : 'reported, not confirmed'}${c.date ? `, ${c.date}` : ''})`).join('; ')}` : ''; };

  // 1. a fresh, non-results event (filing in the window, or press dated in it)
  if (lead && lead.category !== 'Results' && !(lowLead && bdInformative)) {
    const type = IN_TYPE_OF[lead.id] || 'No identified catalyst';
    const press = lead.source === 'PRESS';
    item.eventType = type;
    item.eventLabel = `${lead.label}${lead.planned ? (press ? ' — reported plan' : ' (proposed / not executed)') : ''}${press && !lead.confirmedByFiling ? ' · reported, not confirmed by the company' : press ? ' · press (also filed)' : ' · exchange filing'}`;
    item.headline = clean(press ? lead.title : `${lead.title}${lead.sentence && !lead.title.includes(lead.sentence.slice(0, 40)) ? ` — ${lead.sentence}` : ''}`).slice(0, 400);
    item.whatChanged = `${press ? 'Reported' : 'As filed'}: ${inQuote(lead)}${inFigs(lead)}${lead.note ? ` (${lead.note})` : ''}${alsoLine(lead)}`;
    item.before = null; item.after = null;
    item.stage = lead.planned ? (press ? 'RUMOUR' : 'PROPOSED') : lead.id === 'capacity_commissioned' ? 'OPERATIONAL' : 'EXECUTED';
    item.sourceConfidence = press ? (lead.confirmedByFiling ? 'VERIFIED_FILING' : 'SECONDARY_SUMMARY') : lead.sourceLabel.includes('document read') ? 'VERIFIED_DOCUMENT' : 'VERIFIED_FILING';
    item.verification = press ? (lead.confirmedByFiling ? 'Press; an exchange filing states the same event' : 'Reported, not confirmed by the company — secondary · verification required') : `Exchange filing — ${lead.sourceLabel.replace(/^exchange filing /, '').replace(/[()]/g, '')}`;
    item.quote = press ? null : lead.sentence;
    setDated(lead.date, lead.url);
    item.scanNote = null;
    item.evidenceGap = press && !lead.confirmedByFiling ? { code: 'EVIDENCE_INCOMPLETE', ...GAP_LABEL.EVIDENCE_INCOMPLETE } : null;
    const neg = lead.direction === 'negative' && !lead.planned;
    const cls: EventClass = neg && !press ? 'NEGATIVE' : press || lead.planned || lead.direction === 'mixed' ? 'POTENTIAL_UNVERIFIED' : IN_LOW_KINDS.has(lead.id) || type === 'Management change' ? 'CONFIRMED_LOW_MATERIALITY' : 'POTENTIAL_UNVERIFIED';
    if (type === 'Management change' && neg && !press) item.eventLabel = `Management departure — ${lead.label.toLowerCase()} · exchange filing`;
    item.whyResearch = press && !lead.confirmedByFiling
      ? `${lead.label} is reported in the press, not confirmed by the company in an exchange filing — verify with the company / exchange before treating it as the catalyst${lead.id === 'promoter_stake_sale' ? ' (watch for a buyer, the price and whether an open offer is triggered)' : ''}.`
      : neg ? `${lead.label} filed with the exchange — negative evidence for this move; read the filing for the reason given.`
        : `${lead.label} is on file with the exchange; its size against the company is not established here — read the filing.`;
    if (bd) item.unknowns = [...(item.unknowns || []).slice(0, 4), `Backdrop: ${bd.label}`];
    finish(cls);
    // A change of control (a promoter / parent exit, an open offer, a delisting offer) reaches shareholders through
    // the offer / the new owner, near-term — not through the P&L; it is ranked as a near-term mechanism, never as material.
    if (lead.id === 'promoter_stake_sale' || lead.id === 'open_offer' || lead.id === 'delisting') item.transmission = 'NEAR_TERM';
    presentedFlags();
    if (type === 'Management change' && cls === 'NEGATIVE') item.action = item.catalystFor === 'CONTEXT' ? 'Monitor' : 'Negative evidence';
    return { presented: true };
  }

  // 2. a price / volume clarification is the event (no fundamental catalyst) — the result, if any, is the backdrop beside it
  const cl = card.clarification;
  if (cl || (ctx.status === 'denied' && ctx.clarification)) {
    item.eventType = 'No identified catalyst';
    item.eventLabel = 'Exchange clarification on price / volume movement — no fundamental catalyst';
    const marketDriven = cl ? /market[- ]driven|market conditions|market forces/i.test(cl.sentence) : false;
    item.headline = clean(`Exchange clarification${cl?.date ? ` (${cl.date})` : item.filedDate ? ` (${item.filedDate})` : ''}: company says no undisclosed information${marketDriven ? '; says the movement is market-driven' : ''}`);
    item.whatChanged = `${cl ? `As filed: ${inQuote(cl)}` : 'Company told the exchange it has no undisclosed information.'}${bd ? `; backdrop: ${bd.label}${bd.lead ? ` — ${inQuote(bd.lead)}${inFigs(bd.lead)}` : ''}` : ''}${alsoLine(null)}`;
    if (cl) setDated(cl.date, cl.url);
    item.sourceConfidence = 'VERIFIED_FILING';
    item.scanNote = `Company confirmed no undisclosed information to the exchange${cl?.date ? ` on ${cl.date}` : ''}; ${card.pressChecked} press headline${card.pressChecked === 1 ? '' : 's'} checked — no fundamental catalyst found.`;
    item.eventClass = 'NO_CATALYST'; item.catalystFor = undefined; item.action = 'No catalyst';
    return { presented: false };
  }

  // 3. the latest quarterly result (≤ 60 days) — the fundamental backdrop
  if (bd) {
    const r = bd.lead;
    const pressOnly = !bd.filing || (r?.source === 'PRESS');
    item.eventType = 'Earnings';
    item.eventLabel = bd.tone === 'turnaround_small' ? 'Turnaround, small' : bd.tone === 'turnaround' ? 'Turnaround to profit' : bd.tone === 'weak' ? 'Weak result' : bd.tone === 'growth' ? 'Quarterly result — growth' : 'Quarterly result filed';
    item.eventLabel += ctx.clarification || card.clarification ? ' · backdrop (plus exchange clarification)' : ' · fundamental backdrop';
    const whenFiled = bd.filing ? `filed ${bd.filing.date || 'undated'}${bd.filing.ageDays != null ? ` (${bd.filing.ageDays}d ago)` : ''}` : 'results filing not in the fetched list';
    item.headline = clean(`${bd.label}${r ? ` — ${r.sentence}` : ''}`).slice(0, 400);
    item.whatChanged = r
      ? `${r.source === 'PRESS' ? 'Reported in the press (the result itself is ' + whenFiled + ')' : `As filed (${whenFiled})`}: ${inQuote(r)}${inFigs(r)}${r.note ? ` (${r.note})` : ''}${bd.also.length ? `; also: ${bd.also.map((x) => `${x.label.toLowerCase()}${x.note ? ` (${x.note})` : ''}`).join('; ')}` : ''}`
      : `Quarterly result ${whenFiled} — revenue / profit figures are not stated in the filing text read; open the result.`;
    item.whatChanged += alsoLine(null);
    item.before = null; item.after = null;
    item.stage = 'MONETIZING';
    item.sourceConfidence = bd.filing ? 'VERIFIED_FILING' : 'SECONDARY_SUMMARY';
    item.verification = bd.filing ? `Exchange filing (result ${whenFiled})${r?.source === 'PRESS' ? '; figures from a press report of it' : ''}` : 'Reported in the press; the results filing was not in the fetched list — verification required';
    item.quote = r && r.source === 'FILING' ? r.sentence : null;
    setDated(bd.filing?.date ?? r?.date ?? null, bd.filing?.url ?? r?.url ?? null);
    item.evidenceGap = null;
    item.scanNote = card.clarification ? `Exchange clarification on file (${card.clarification.date || 'undated'}): company says no undisclosed information.` : card.routine.length ? `Routine filings in the window: ${Array.from(new Set(card.routine.map((x) => x.label.toLowerCase()))).slice(0, 3).join(', ')} — no fresher event.` : null;
    const freshNote = alsoFresh.length ? ` Also in the window: ${alsoFresh.map((c) => `${c.label.toLowerCase()} (${c.source === 'FILING' ? 'filed' : 'reported, not confirmed'}${c.date ? ` ${c.date}` : ''})`).join('; ')} — read ${alsoFresh.length === 1 ? 'it' : 'them'}.` : '';
    item.whyResearch = `${alsoFresh.length ? 'No fresher fundamental event' : 'No fresher event in the filings or news'} — the latest quarterly result (${whenFiled}) is the fundamental backdrop${bd.tone === 'turnaround_small' ? '; the turnaround is small' : bd.tone === 'weak' ? '; the result reads weak' : ''}. It is older context, not proof it caused this move.${freshNote}`;
    const cls: EventClass = bd.tone === 'weak' ? 'NEGATIVE' : pressOnly && !bd.filing ? 'POTENTIAL_UNVERIFIED' : 'CONFIRMED_LOW_MATERIALITY';
    finish(cls);
    return { presented: true };
  }

  // 4. nothing: said plainly
  item.whatChanged = 'No catalyst found in filings or news';
  const routineWords = Array.from(new Set(card.routine.map((x) => x.label.toLowerCase()))).slice(0, 3);
  if (item.eventClass === 'NO_CATALYST' && !/unclassified|favourable|debt financing/i.test(item.eventLabel || '')) {
    const q = card.catalysts.find((c) => c.id === 'exchange_query');
    item.headline = `No catalyst found in filings or news${q ? ` — the exchange asked about the price / volume movement${q.date ? ` (${q.date})` : ''}; the company's reply was not read` : routineWords.length ? ` — routine filings only (${routineWords.join(', ')}), no fresh catalyst` : ''}`;
    if (routineWords.length) item.eventLabel = 'Routine filings only — no fresh catalyst';
  }
  item.scanNote = `${card.filingsChecked ? `${card.filingsChecked} exchange filing${card.filingsChecked === 1 ? '' : 's'} in the window${routineWords.length ? ` (routine: ${routineWords.join(', ')})` : ''}` : 'No exchange filing in the window'} and ${card.pressChecked} press headline${card.pressChecked === 1 ? '' : 's'} checked — no catalyst found in filings or news.`;
  return { presented: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz785 C — the catalyst layer on one item: records (dedup by catalyst id,
// press merged into the filing), the thread timeline, the persistence test,
// the three gap labels, evidence breadth, unknown-economics label, links.
// ═══════════════════════════════════════════════════════════════════════════

/** zzz787: the fact kinds that belong to one event type's catalyst thread. */
const FAMILY_OF: Partial<Record<EventType, EventKind[]>> = {
  'Order win': ['order', 'qualification'], 'Contract': ['order', 'qualification', 'partnership'], 'Customer win': ['order', 'qualification'],
  'Capacity expansion': ['capacity'], 'Production ramp': ['capacity'], 'Regulatory approval': ['qualification', 'order', 'capacity'],
  'Acquisition': ['acquisition'], 'Merger': ['merger', 'acquisition'], 'New product': ['new_product'], 'Partnership': ['partnership'], 'JV': ['partnership'],
  'Strategic expansion': ['strategic_expansion'], 'Strategic investment': ['stake_by_strategic', 'strategic_investment'], 'Promoter buying': ['promoter_buying'],
  // zzz789: debt and fundraising read their own facts for the checklist.
  'Debt / refinancing': ['debt'], 'Fundraising': ['fundraising'],
};

/** zzz787 — the four duration concepts on one card, never merged:
 *   contractual      only a STATED term / execution period ("Contract runway: 5 years")
 *   potential        what the nature of the event could support — NOT evidence
 *   evidence         what the filings prove (Strong needs ≥2 evidence periods)
 *   catalystState    where the catalyst is now (Identified → validating …)
 *  plus revenue visibility, the current evidence, the next evidence and what
 *  is missing — in plain words. A contract term is never phrased as revenue. */
export interface DurationView {
  contractual: string | null;
  potential: { text: string; basis: 'FACTS' | 'TYPE' | 'NONE'; note: string };
  evidence: { level: PersistEvidenceLevel; word: string; text: string };
  catalystState: string | null;
  revenueVisibility: string | null;
  currentEvidence: string | null;
  nextEvidence: string[];
  missing: string[];
  /** Capacity / licence / commissioning: capability is not demand (ABDL). */
  capacity: { potential: string; demand: 'present' | 'absent'; commercial: 'supported' | 'unproven'; text: string } | null;
  /** Consistency guard note, when the potential had to be raised to match a term / the evidence. */
  guard: string | null;
}

const STATE_FLOW: Record<CatalystRecord['state'], string> = {
  IDENTIFIED: 'Identified — not yet in an official filing', DOCUMENTED: 'Identified → validating (one official filing; nothing delivered yet)',
  EXECUTING: 'Validating → executing (follow-up official filings on file)', CONFIRMED: 'Confirmed — completed / delivering',
  WEAKENING: 'Weakening — a delay or cut is on file', DISPROVED: 'Disproved — cancelled or denied',
};

function durationsOf(it: ResearchItem, c: { key: string; famFacts: StructuredFacts[]; famHay: string; contractYears: number | null; guardNote: string | null; valueVerified: boolean; value: number | null }): DurationView | null {
  const cls = it.eventClass;
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY' || cls === 'LISTING' || cls === 'DATA_UNAVAILABLE') return null;
  const ev = it.persistenceEvidence || { level: 'NONE' as PersistEvidenceLevel, text: 'Not established.' };
  const pot = it.potentialDuration || { value: it.persistence, text: TYPE_POT_WORD[it.persistence], basis: 'TYPE' as const };
  const orderLike = it.eventType === 'Order win' || it.eventType === 'Contract' || it.eventType === 'Customer win';
  const period = c.famFacts.map((x) => x.time?.executionPeriod).find(Boolean) || null;
  const contractual = c.contractYears != null
    ? `Contract runway: ${c.contractYears} year${c.contractYears === 1 ? '' : 's'} (as stated). Economic contribution still unquantified.`
    : orderLike && period ? `Execution period: ${period} (as stated) — a delivery schedule, not proof of revenue.` : null;
  const statedPotential = c.famFacts.map((x) => (x as any).statedPotentialNative).find((v) => typeof v === 'number') as number | undefined;
  const revenueVisibility = !orderLike ? null
    : c.value != null && c.valueVerified ? `${moneyExact(c.value, it.market)} stated in the read document${period ? ` over ${period}` : ''} — billing timing not disclosed`
      : c.value != null ? `Stated ${moneyExact(c.value, it.market)} — document verification pending`
        : statedPotential != null ? `Not yet quantified — ~${moneyExact(statedPotential, it.market)} a year is stated only as a POTENTIAL, not a firm value`
          : 'Revenue visibility not yet quantified';
  const primary = it.catalysts?.[0];
  const catalystState = primary ? STATE_FLOW[primary.state] : null;
  const officialDocs = primary ? (it.timeline || []).filter((t) => t.status === 'official' || t.status === 'official · subject line only').length : 0;
  const currentEvidence = c.key === 'contract_term' ? `One contract${officialDocs ? ` (${officialDocs} official filing${officialDocs === 1 ? '' : 's'})` : ''}`
    : primary ? (officialDocs ? `${officialDocs} official filing${officialDocs === 1 ? '' : 's'} on this catalyst` : 'Press / summary only — no official document read') : null;
  const NEXT_EV: Record<string, string[]> = {
    contract_term: ['order value', 'recurring revenue', 'renewal', 'execution'],
    order_recurring: ['a firm annual value (not a potential)', 'programme duration', 'production-rate linkage', 'first deliveries / billing in results'],
    order: ['execution / billing in the next results', 'repeat order from the same customer', 'order book after this order'],
    customer: ['first supply / billing', 'repeat order', 'share of revenue from the customer'],
    capacity: ['orders / offtake for the new capacity', 'first utilisation figure', 'revenue from the new capacity'],
    licence_capacity: ['orders / offtake for the licensed volume', 'commercial production start', 'utilisation', 'revenue from it'],
    qualification: ['first commercial purchase order', 'supply start', 'repeat order'],
    approval: ['first commercial order / supplies', 'revenue attached to the approval'],
    enabling: ['definitive agreement', 'approvals', 'binding order', 'supply / production start'],
    enabling_realestate: ['definitive agreement', 'approvals', 'launch', 'bookings', 'collections'],
    acquisition: ['completion', 'first consolidated quarter with the target', 'target revenue / profit'],
    merger: ['approvals and the effective date', 'combined revenue / profit', 'swap ratio / dilution'],
    strategic_expansion: ['first revenue, order or investment in the new entity', 'named customer / partner'],
    strategic: ['official filing confirming the stake', 'any commercial agreement with the investor'],
    promoter_buying: ['next shareholding disclosure', 'repeated purchases'],
    capital_allocation: ['completion', 'share count after it'],
    product: ['first named customer order', 'revenue from the product'],
    earnings: ['next quarter repeating the change', 'guidance', 'cash conversion'],
  };
  const missing: string[] = [];
  if (c.key === 'order_recurring') {
    if (!(c.value != null && c.valueVerified)) missing.push('disclosed annual value (firm, not a potential)');
    if (!c.contractYears && !period) missing.push('programme duration');
    missing.push('production-rate linkage (does the value scale with the customer\'s build rate?)');
  } else if (c.key === 'contract_term') {
    if (c.value == null) missing.push('contract value');
    missing.push('recurring revenue per year', 'renewal terms');
  } else if (orderLike) {
    if (c.value == null) missing.push('order value');
    if (!period) missing.push('execution period');
  }
  const capLike = it.eventType === 'Capacity expansion' || it.eventType === 'Production ramp' || c.key === 'licence_capacity';
  let capacity: DurationView['capacity'] = null;
  if (capLike) {
    const demand = DEMAND_WORDS.test(c.famHay);
    // zzz789: a secondary-only capacity event (FRVO "first power") carries no multi-year potential until verified.
    const capPot = pot.value === 'YEARS' ? 'multi-year' : 'not established (verification required)';
    capacity = { potential: capPot, demand: demand ? 'present' : 'absent', commercial: demand ? 'supported' : 'unproven',
      text: `Capacity potential: ${capPot} · Demand evidence: ${demand ? 'present (orders / offtake / utilisation / revenue on file)' : 'absent'} · Commercial persistence: ${demand ? 'supported in one period' : 'unproven'}` };
    if (!demand) missing.push('demand evidence (orders, offtake, utilisation or revenue)');
  }
  return {
    contractual,
    potential: { text: pot.text, basis: pot.basis, note: 'Potential economic duration — the nature of the event, NOT evidence that it will last.' },
    evidence: { level: ev.level, word: PERSIST_EVIDENCE_WORD[ev.level], text: ev.text },
    catalystState, revenueVisibility, currentEvidence,
    nextEvidence: NEXT_EV[c.key] || [], missing: Array.from(new Set(missing)), capacity, guard: c.guardNote,
  };
}

const POSITIVE_KIND_TYPE: Partial<Record<EventKind, EventType>> = {
  order: 'Order win', capacity: 'Capacity expansion', qualification: 'Regulatory approval', acquisition: 'Acquisition',
  new_product: 'New product', partnership: 'Partnership',
  // zzz787: a strategic's stake is a strategic INVESTMENT, not an acquisition.
  stake_by_strategic: 'Strategic investment', strategic_investment: 'Strategic investment', strategic_expansion: 'Strategic expansion',
  merger: 'Merger', promoter_buying: 'Promoter buying',
};

function catalystLayer(item: ResearchItem, f: Finding | null, c: {
  ticker: string; market: 'IN' | 'US'; cls: EventClass; key: string; stage: Stage; evHay: string; pers: Persistence;
  persEv: { level: PersistEvidenceLevel; text: string }; mat: Materiality; fr: FundraiseRead | null; conf: SourceConfidence; verifiedDoc: boolean;
  marketCap: number | null; revenue: { v: number; basis: 'ttm_revenue' | 'annual_revenue' } | null; input: ResearchViewInput; unknowns: string[];
  potentialText?: string | null; quantified?: boolean;
}): Partial<ResearchItem> {
  const out: Partial<ResearchItem> = {};
  const T = up(c.ticker);
  const eventClass = c.cls === 'CONFIRMED_MATERIAL' || c.cls === 'CONFIRMED_LOW_MATERIALITY' || c.cls === 'POTENTIAL_UNVERIFIED' || c.cls === 'NEGATIVE';
  const today = c.input.now ? String(c.input.now).slice(0, 10) : null;
  const prior = c.input.priorCatalysts || null;
  const views: CatalystView[] = f ? buildCatalystRecords(T, c.market, factsForFinding(f), { prior, today }) : [];
  // Stored records for this company that today's evidence did not touch.
  if (prior) {
    const have = new Set(views.map((v) => v.id));
    for (const r of Object.values(prior)) if (r && up(r.ticker) === T && !have.has(r.id)) views.push(storedView(r));
  }
  let primary: CatalystView | null = null;
  if (views.length && eventClass) {
    primary = (f?.sourceUrl ? views.find((v) => v.sources.some((s) => s.url === f.sourceUrl)) : null)
      || views.find((v) => (c.cls === 'NEGATIVE') === (v.polarity === 'negative') && v.facts.length)
      || views.find((v) => v.facts.length) || views[0];
  }
  const sizeText = (v: CatalystView): string | null => {
    const x = v.facts[v.facts.length - 1];
    const amt = x?.economics.valueNative ?? (v.polarity === 'negative' ? negativeAmountCr(`${x?.source.title || ''} ${(x?.quotes || []).join(' ')}`) : null);
    if (amt == null || !(amt > 0)) return v.polarity === 'negative' ? 'Amount not stated — size against market cap unknown' : null;
    // zzz787: only a figure a READ official document states is sized.
    if (!x || x.source.access !== 'DOCUMENT_READ' || x.source.kind === 'PRESS') return `${moneyExact(amt, c.market)} stated · document verification pending (no ratio)`;
    if (!c.marketCap || !(c.marketCap > 0)) return `${moneyExact(amt, c.market)} stated; market cap not available`;
    const p = (amt / c.marketCap) * 100;
    return `${moneyExact(amt, c.market)} ÷ ${money(c.marketCap, c.market)} market cap = ${p < 0.01 ? '<0.01' : p < 1 ? (Math.round(p * 100) / 100).toString() : r1(p)}%`;
  };
  const card = (v: CatalystView): CatalystCard => ({
    id: v.id, kind: v.kind, kindWord: v.polarity === 'positive' && (v.kind === 'tax_litigation' || v.kind === 'regulatory_negative') ? 'Tax / legal outcome (favourable — resolved)' : KIND_WORD[v.kind], title: clean(v.title), state: v.state, stateWord: STATE_WORD[v.state], previousState: v.previousState,
    latestEvidence: v.latestEvidence ? clean(v.latestEvidence) : null, nextMilestone: v.nextMilestone, invalidation: v.invalidation,
    polarity: v.polarity, verification: v.verification, materialityText: sizeText(v),
    firstSeen: v.firstSeen, lastSeen: v.lastSeen, duplicatesMerged: v.duplicatesMerged, documents: v.sources.length,
  });
  if (views.length && eventClass) {
    const ordered = primary ? [primary, ...views.filter((v) => v !== primary)] : views;
    out.catalysts = ordered.map(card);
    if (primary) out.timeline = threadTimeline(views, primary).map((t) => ({ ...t, title: clean(t.title) }));
  }
  // Persistence test — reconciled with persistenceOf / persistenceEvidenceOf.
  if (eventClass && c.cls !== 'NEGATIVE' || (c.cls === 'NEGATIVE' && primary)) {
    out.persistenceTest = persistenceTestOf({
      kind: primary?.kind ?? (c.fr ? 'fundraising' : null), facts: primary?.facts || [], record: primary,
      potential: c.pers, potentialText: c.potentialText ?? null, evidenceLevel: c.persEv.level, evidenceText: c.persEv.text, hay: c.evHay, market: c.market,
      quantified: c.quantified,
    });
  }
  // Three distinct gap labels.
  const given = evidenceGapOf(f);
  const code: EvidenceGap | null = given && !(given === 'NO_CATALYST' && eventClass)
    ? given
    : c.cls === 'NO_CATALYST' && !c.fr?.resale ? (c.key === 'unclassified' ? 'UNCLASSIFIED' : 'NO_CATALYST')
      : c.cls === 'POTENTIAL_UNVERIFIED' && c.mat.label === 'UNKNOWN' && !c.verifiedDoc ? 'EVIDENCE_INCOMPLETE' : null;
  out.evidenceGap = code ? { code, ...GAP_LABEL[code] } : null;
  out.evidenceBreadth = evidenceBreadthOf(f, views);
  if ((c.cls === 'CONFIRMED_MATERIAL' || c.cls === 'CONFIRMED_LOW_MATERIALITY' || c.cls === 'POTENTIAL_UNVERIFIED') && c.mat.label === 'UNKNOWN') {
    const missing = c.fr?.missing?.length ? c.fr.missing
      : c.unknowns.filter((u) => !/^Consensus/i.test(u) && /Not disclosed|Unknown|Not yet/i.test(u)).map((u) => u.split(':')[0].toLowerCase()).slice(0, 4);
    out.economicsUnknown = { label: UNKNOWN_NEEDS_READING, missing };
  } else out.economicsUnknown = null;
  out.verification = !eventClass ? null
    : c.conf === 'SECONDARY_SUMMARY' || c.conf === 'UNVERIFIED' ? (primary && primary.sources.some((s) => s.kind !== 'PRESS') ? primary.verification : 'Secondary · verification required')
      : primary ? primary.verification : 'Official filing';
  const rel = item.portfolio?.relevance;
  const pc = item.persistentCatalyst;
  const thesis = rel === 'HOLDING' || rel === 'WATCHLIST' ? `/portfolio-catalysts#pc-${encodeURIComponent(T)}` : null;
  // zzz787 — ONE underlying catalyst, three separate views, cross-linked (never
  // listed again as separate items): Research Priority = what to investigate
  // now (this card); Persistent Catalyst = could the mechanism continue;
  // Special Focus = deserves sustained attention. Never merged into one score.
  const sf = pc && pc.specialFocus ? `/portfolio-catalysts#sf-${encodeURIComponent(pc.id)}` : null;
  const persistentLink = pc && !pc.specialFocus && (pc.kind === 'PROJECT_PIPELINE' || pc.confidence === 'HIGH' || pc.confidence === 'MEDIUM') ? `/portfolio-catalysts#special-focus` : null;
  out.links = thesis || sf || persistentLink || primary || pc ? {
    thesis, specialFocus: sf, persistent: persistentLink, catalystId: primary?.id ?? null, persistentId: pc?.id ?? null,
    note: 'Same catalyst, separate views — linked, not repeated: this card is what to investigate now; the thesis ledger holds why you own it (its status is never changed by this); the persistent-catalyst memory asks whether the mechanism can continue; Special Focus is only for mechanisms that deserve sustained attention.',
  } : null;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE VIEW
// ═══════════════════════════════════════════════════════════════════════════

const CLASS_RANK: Record<EventClass, number> = { CONFIRMED_MATERIAL: 0, POTENTIAL_UNVERIFIED: 1, CONFIRMED_LOW_MATERIALITY: 2, NEGATIVE: 3, NO_CATALYST: 4, MARKET_MOVE_ONLY: 5, LISTING: 6, DATA_UNAVAILABLE: 7 };
const byPriority = (a: ResearchItem, b: ResearchItem) => (b.priority - a.priority) || (CLASS_RANK[a.eventClass] - CLASS_RANK[b.eventClass]) || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);

/** The conflicts recorded on an item (headline value vs filed value, etc.), read
 *  defensively: an optional `conflicts` array on the item, else on its US / India
 *  card. Entries may be strings or objects with text/message. Never throws. (zzz835) */
export function conflictsOf(it: unknown): string[] {
  try {
    const o: any = it;
    const raw = o?.conflicts ?? o?.usCard?.conflicts ?? o?.inCard?.conflicts;
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String(x.text ?? x.message ?? x.field ?? '') : '')).map((x: string) => x.trim()).filter(Boolean);
  } catch { return []; }
}

const IN_CAT_ORDER = ['Results', 'Orders & business', 'Capacity & capex', 'Corporate action', 'Capital raising', 'Ownership & control', 'Management & governance', 'Regulatory & legal', 'Exchange disclosure'];

/** Catalysts found per category over the board — BOTH markets. A name counts once per
 *  category; `sec` = an official-filing catalyst in the category, `press` = press only. */
export function catalystSummaryOf(items: ResearchItem[], market: 'IN' | 'US'): NonNullable<ResearchView['summary']['catalysts']> {
  const by = new Map<string, { names: Set<string>; sec: Set<string>; press: Set<string> }>();
  const slot = (c: string) => { let b = by.get(c); if (!b) { b = { names: new Set(), sec: new Set(), press: new Set() }; by.set(c, b); } return b; };
  let found = 0, none = 0;
  for (const it of items) {
    const list: Array<{ category: string; official: boolean }> | null = market === 'US'
      ? (it.usCard ? (it.usCard.catalysts || []).map((c) => ({ category: c.category, official: c.source === 'SEC' })) : null)
      : (it.inCard ? (it.inCard.catalysts || []).filter((c) => c.category !== 'Routine').map((c) => ({ category: c.category, official: c.source === 'FILING' })) : null);
    if (!list) continue;
    if (!list.length) { none++; continue; }
    found++;
    for (const c of list) { const b = slot(c.category); b.names.add(it.ticker); (c.official ? b.sec : b.press).add(it.ticker); }
  }
  const order = market === 'US' ? ['Earnings', 'Product & segment', 'Capital & capacity', 'Corporate action', 'Deals & customers', 'Regulatory & clinical', 'Capital structure', 'Market & ownership'] : IN_CAT_ORDER;
  const cats = [...order, ...Array.from(by.keys()).filter((c) => !order.includes(c))];
  return {
    market, found, none,
    byCategory: cats.filter((c) => by.has(c) && by.get(c)!.names.size > 0).map((c) => { const b = by.get(c)!; return { category: c, names: b.names.size, sec: b.sec.size, press: Array.from(b.press).filter((t) => !b.sec.has(t)).length, tickers: Array.from(b.names).slice(0, 12) }; }),
  };
}

const rowName = (it: ResearchItem) => (it.displayTicker && it.displayTicker.trim()) || it.ticker;

export function buildResearchView(input: ResearchViewInput): ResearchView {
  const market = input.market === 'US' ? 'US' : 'IN';
  // zzz835: ages are measured on the EXCHANGE calendar — the exchange's own date at
  // the scan instant (New York for the US, India time for India), never the UTC day. The scan instant stays in
  // `scanNow`; `inp.now` is the reference midday of that exchange date, so
  // every whole-day age below is a calendar-day difference of two exchange dates.
  const scanNow = input.now ?? null;
  const sessDate = input.session?.date && /^\d{4}-\d{2}-\d{2}/.test(String(input.session.date)) ? String(input.session.date).slice(0, 10) : null;
  const scanT = scanNow ? Date.parse(scanNow) : NaN;
  const refDate = Number.isFinite(scanT) ? exchangeDateOf(market, new Date(scanT)) : sessDate;
  const inp: ResearchViewInput = { ...input, market, now: refDate ? `${refDate}T12:00:00Z` : input.now };
  const board = new Map<string, BoardRow>();
  for (const r of input.board || []) { const t = up(r?.ticker); if (t && !board.has(t)) board.set(t, r); }
  const findings = new Map<string, Finding>();
  for (const [k, f] of Object.entries(input.findings || {})) if (f) findings.set(up(k || f.ticker), f);
  const filed = new Map<string, FiledRow>();
  for (const raw of input.filedResults || []) { const r = normaliseFiledRow(raw, inp.now, market); if (r && !filed.has(r.ticker)) filed.set(r.ticker, r); }
  const sets = { held: new Set((input.holdings || []).map(up)), watch: new Set((input.watchlist || []).map(up)), theme: new Set((input.sameTheme || []).map(up)) };

  // The universe: the board when there is one; otherwise whatever was researched or filed.
  const tickers = board.size ? Array.from(board.keys()) : Array.from(new Set([...Array.from(findings.keys()), ...Array.from(filed.keys())]));
  tickers.sort();
  const items: ResearchItem[] = [];
  let unresearched = 0;
  for (const t of tickers) {
    const f = findings.get(t) || null;
    const fr = filed.get(t) || null;
    if ((!f || f.status === 'unresearched') && !fr) { unresearched++; continue; }
    items.push(buildResearchItem(t, f, board.get(t) || null, fr, inp, sets));
  }
  items.sort(byPriority);

  // zzz771: an event older than the move window is CONTEXT — real, kept with
  // its class, but never this move's catalyst. It leaves every ranked section
  // (queue / watch / negative / no-catalyst) for its own list, and the summary
  // counts it as "no fresh catalyst for this move". INVARIANTS the tests hold:
  //   queue ∪ watch ⊆ eligible ∖ context;  context ∩ (queue ∪ watch ∪ negative
  //   ∪ noCatalyst) = ∅;  summary.confirmed / potential / negative exclude
  //   context;  summary.noCatalyst includes it;  the class totals still add
  //   up to `scanned`.
  const context = items.filter((i) => i.catalystFor === 'CONTEXT');
  const live = items.filter((i) => i.catalystFor !== 'CONTEXT');
  const eligible = live.filter((i) => i.eventClass === 'CONFIRMED_MATERIAL' || i.eventClass === 'CONFIRMED_LOW_MATERIALITY' || i.eventClass === 'POTENTIAL_UNVERIFIED');
  const queue = eligible.filter((i) => i.priority >= 12).slice(0, 15);
  const inQ = new Set(queue.map((i) => i.ticker));
  // zzz798 (US): every US event card stays visible — the 20-card cap dropped
  // names from the page entirely once the SEC reader found more events.
  // zzz835: no cap in either market — a name dropped by a cap appeared in NO section
  // while still counted in the tiles (India capped at 20).
  const watch = eligible.filter((i) => !inQ.has(i.ticker));
  const top3 = queue.filter((i) => i.priority >= 25).slice(0, 3);
  const negative = live.filter((i) => i.eventClass === 'NEGATIVE' && !i.immaterialNegative);
  const immaterialNegative = live.filter((i) => i.eventClass === 'NEGATIVE' && i.immaterialNegative);
  const noCatalyst = live.filter((i) => i.eventClass === 'NO_CATALYST' || i.eventClass === 'MARKET_MOVE_ONLY');
  const dataQuality = items.filter((i) => i.eventClass === 'LISTING' || i.eventClass === 'DATA_UNAVAILABLE');
  const portfolio = items.filter((i) => i.portfolio.relevance === 'HOLDING' || i.portfolio.relevance === 'WATCHLIST');
  // zzz785: every live event with unknown economics, ranked — never dropped by the caps above.
  const needsReading = eligible.filter((i) => !!i.economicsUnknown);
  // zzz789 — ONE canonical event per card. A name surfaced in several sections
  // (GNA: Watch AND Unknown — needs reading) is the SAME item object, carrying
  // its canonical event id and every section it appears in; the page renders
  // one card / row and says "also in: …" — never a second item, never a
  // double count.
  const surf = new Map<string, string[]>();
  const mark = (list: ResearchItem[], name: string) => { for (const i of list) surf.set(i.ticker, [...(surf.get(i.ticker) || []), name]); };
  mark(queue, 'Research queue'); mark(watch, 'Watch / investigate'); mark(needsReading, 'Unknown — needs reading');
  mark(items.filter((i) => i.portfolio.relevance === 'HOLDING' || i.portfolio.relevance === 'WATCHLIST'), 'Your book');
  for (const i of items) {
    i.canonicalId = i.links?.catalystId || i.catalysts?.[0]?.id || `${i.ticker}:${i.eventType}`;
    i.surfacedIn = surf.get(i.ticker) || [];
  }

  const universe = tickers.map((ticker) => ({ ticker }));
  const lines = presentErrorLines(input.errors || [], universe, 60);
  // zzz773: the error log is cumulative across calls. A name whose filings
  // were read (any status but source_failed) was CHECKED, whatever an earlier
  // call logged; only its missing price history is a partial failure, and
  // only while the price history is still missing.
  const byTicker = new Map(items.map((i) => [i.ticker, i] as const));
  const lastLine = new Map<string, { short: string; full: string }>();
  for (const l of lines) if (l.ticker) lastLine.set(l.ticker, { short: l.short, full: l.full });
  const sourceFailures: ResearchView['sourceFailures'] = [];
  const partialFailures: NonNullable<ResearchView['partialFailures']> = [];
  for (const i of items) {
    if (i.eventClass !== 'DATA_UNAVAILABLE') continue;
    const l = lastLine.get(i.ticker);
    sourceFailures.push({ ticker: i.ticker, text: l?.short || `${i.ticker}: filing source unavailable — not "no catalyst"`, full: l?.full || (i.notes || []).join(' ') || 'The filing source could not be reached.', news: i.news ?? null });
  }
  for (const [t, l] of Array.from(lastLine.entries())) {
    const it = byTicker.get(t);
    if (!it || it.eventClass === 'DATA_UNAVAILABLE') continue;
    const noPrice = it.returns.m1 == null && it.returns.m3 == null;
    if (noPrice && /chart|price/i.test(l.full)) partialFailures.push({ ticker: t, text: `${t}: filings checked; price history unavailable — market response not measured`, full: l.full });
  }
  // Class counts over the LIVE items; context is counted once, under noCatalyst. (zzz771)
  const count = (c: EventClass) => live.filter((i) => i.eventClass === c).length;
  const s0 = input.session || { date: null, scanAt: null, status: 'unknown', cached: false };
  const session: ResearchView['session'] = { ...s0 };
  if (session.note == null) {
    session.note = market === 'US' && input.moveWindow === '1W'
      ? 'US moves are 1-week performance from the export, not a one-day move.'
      : session.isToday === false ? `Moves are from the last completed session${session.date ? ` (${session.date})` : ''}, not today.` : null;
  }
  // zzz835: the market run — session date, generated, data-as-of, status, final/provisional.
  const weekly = market === 'US' && input.moveWindow === '1W';
  const run = marketRunOf({ market, sessionDate: sessDate, scanAt: s0.scanAt || scanNow, now: input.viewedAt || scanNow });
  if (!weekly) {
    session.sessionDate = run.sessionDate; session.generatedAt = run.generatedAt; session.dataAsOf = run.dataAsOf; session.timezone = run.exchangeTimezone;
    session.sessionStatus = run.sessionStatus; session.isFinal = run.isFinal; session.marketCloseAt = run.marketCloseAt; session.runReason = run.reason;
  } else {
    session.isFinal = false; session.runReason = 'PROVISIONAL — the US move is the weekly export (1-week performance), not a closed one-day session.';
  }
  // zzz835: every item says which exchange date its move is measured on and whether its event is inside the window.
  for (const i of items) {
    i.moveDate = sessDate;
    i.windowStatus = i.catalystFor == null || i.ageDays == null ? 'unknown' : i.catalystFor === 'THIS_MOVE' ? 'inside_window' : 'outside_window';
  }
  const negativeImmaterial = immaterialNegative.length;
  const noCatalystFound = count('NO_CATALYST');
  const summary: ResearchView['summary'] = {
    scanned: tickers.length, confirmed: count('CONFIRMED_MATERIAL') + count('CONFIRMED_LOW_MATERIALITY'), potential: count('POTENTIAL_UNVERIFIED'),
    // all live negative items (the class totals add to `scanned`); `negativeImmaterial` of them are listed apart
    negative: count('NEGATIVE'), noCatalyst: count('NO_CATALYST') + count('MARKET_MOVE_ONLY') + context.length, queue: queue.length,
    portfolioMatches: portfolio.length, dataUnavailable: count('DATA_UNAVAILABLE'),
    lowMateriality: count('CONFIRMED_LOW_MATERIALITY'), marketMoveOnly: count('MARKET_MOVE_ONLY'), listings: count('LISTING'), unresearched, watch: watch.length,
    context: context.length, noCatalystFound, negativeImmaterial, conflicts: items.filter((i) => conflictsOf(i).length > 0).length,
    catalysts: catalystSummaryOf(items, market),
    ...(market === 'US' ? { usCatalysts: usCatalystSummary(items) } : {}),
  };
  const banner: ViewBanner = {
    market, scanned: summary.scanned, verified: summary.confirmed, unverified: summary.potential,
    conflicts: items.filter((i) => conflictsOf(i).length > 0).length,
    noMaterialCatalyst: summary.noCatalyst, negative: summary.negative, provisional: weekly ? true : run.provisional,
  };
  // OLDER FILINGS (CONTEXT) as table rows — same shape in both markets.
  const olderFilings: OlderFilingRow[] = context.map((i) => ({
    ticker: i.ticker, name: rowName(i), company: i.companyName || rowName(i), movePct: i.move1d ?? i.move?.pct ?? null,
    filedDate: i.filedDate ? i.filedDate.slice(0, 10) : null, ageDays: i.ageDays ?? null, event: i.headline, eventLabel: i.eventLabel || i.eventType,
    material: i.materiality?.label || 'UNKNOWN', url: i.sourceUrl, moveDate: i.moveDate ?? null,
  }));
  // Data-quality / large-move rows derivable from the scan (nothing invented).
  const dataNotes: DataNoteRow[] = [];
  const noteBase = (i: ResearchItem) => ({ ticker: i.ticker, name: rowName(i), company: i.companyName || rowName(i), movePct: i.move1d ?? i.move?.pct ?? null });
  for (const i of items) {
    const b = board.get(i.ticker);
    const mv = i.move1d ?? i.move?.pct ?? null;
    const perfKnown = !!(b && b.perf && typeof b.perf === 'object');
    if (market === 'US' && perfKnown && i.returns.m1 == null && i.returns.m3 == null) {
      dataNotes.push({ ...noteBase(i), kind: 'new_listing', text: 'No 1-month or 3-month performance on the scan — a new listing or thin history: no comparable prior close, so the trend context is not measured.' });
    }
    for (const f of (b?.flags || [])) if (f === 'SPAC' || f === 'ADR') dataNotes.push({ ...noteBase(i), kind: f === 'SPAC' ? 'spac' : 'adr', text: f === 'SPAC' ? 'Blank-check / acquisition-corp name — its price follows the deal, not operations.' : 'Depositary receipt — SEC filings may be foreign-issuer forms.' });
    if (market === 'US' && mv != null && Math.abs(mv) >= EXTREME_MOVE_PCT) dataNotes.push({ ...noteBase(i), kind: 'extreme_move', text: `Move of ${mv >= 0 ? '+' : ''}${mv.toFixed(1)}% is at or above the ${EXTREME_MOVE_PCT}% second-look flag (a display rule, not a cause).` });
  }
  return {
    session, summary, top3, queue, watch, negative, immaterialNegative, noCatalyst, dataQuality, sourceFailures, partialFailures, portfolio, context, needsReading,
    banner, scanCriteria: input.scanCriteria ?? null, olderFilings, dataNotes,
    bookChecked: { held: sets.held.size, watch: sets.watch.size },
  };
}
