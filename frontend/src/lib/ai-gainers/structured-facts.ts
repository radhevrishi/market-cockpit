// zzz785 — shared contract for the AI Daily Gainers audit.
//
// Three workstreams write to / read from these shapes:
//   A. India document reading + extraction   → produces StructuredFacts
//   B. US SEC routing + document reading      → produces StructuredFacts
//   C. Timeline / dedup / persistence / UI    → consumes them
//
// Rules that every producer must keep:
//   • never invent a number — a field the document does not state stays null
//   • null means UNKNOWN, never negative
//   • price is never an input to any field here
//   • a press/news item is SECONDARY until an official filing confirms it

export type SourceKind =
  | 'EXCHANGE_FILING'      // NSE/BSE announcement or attachment
  | 'SEC_FILING'           // 8-K / 10-Q / 10-K / 424B / S-1 / S-3 / 6-K
  | 'COMPANY_IR'           // company press release on its own IR site / wire
  | 'PRESS'                // third-party press / news (secondary, unverified)
  | 'SUBSIDIARY_FILING';   // filing by a listed/unlisted subsidiary or parent

export type SourceAccess =
  | 'DOCUMENT_READ'        // body/attachment text actually read
  | 'SUMMARY_ONLY'         // only the exchange subject / headline seen
  | 'SECONDARY_UNAVAILABLE'// a secondary source (Screener, news) failed — primary still OK
  | 'SOURCE_UNAVAILABLE';  // the primary source itself failed

export interface SourceRef {
  kind: SourceKind;
  access: SourceAccess;
  issuer: string;               // ticker / CIK of the filer
  date: string | null;          // ISO date of the filing / article
  accession?: string | null;    // SEC accession or exchange seq id
  url?: string | null;
  title: string;
  hash?: string | null;         // content hash for dedup (sha1 of normalised text)
  secItems?: string[];          // SEC item numbers seen ('1.01', '2.03' …) — routing hints only
}

export type EventKind =
  | 'order' | 'capacity' | 'qualification' | 'acquisition' | 'new_product'
  | 'fundraising' | 'partnership' | 'stake_by_strategic' | 'guidance' | 'results'
  | 'regulatory_negative' | 'tax_litigation' | 'debt' | 'governance' | 'resale_registration'
  | 'other';

export interface EventFacts {
  kind: EventKind;
  counterparty: string | null;      // customer / target / investor / allottee
  product: string | null;
  geography: string | null;
  stage: 'ANNOUNCED' | 'SIGNED' | 'AWARDED' | 'APPROVED' | 'COMMISSIONED' | 'COMPLETED' | 'PROPOSED' | null;
}

export interface EconomicFacts {
  valueNative: number | null;       // ₹ Cr for IN, $M for US — only when stated
  currency: 'INR_CR' | 'USD_M' | null;
  // fundraising
  sharesIssued: number | null;
  issuePrice: number | null;
  dilutionPct: number | null;       // only when stated OR computable from stated shares + stated share count
  allottees: string[];
  // acquisitions
  considerationNative: number | null;
  targetRevenueNative: number | null;
  targetProfitNative: number | null;
  stakePct: number | null;
  // capacity
  capacityBefore: string | null;
  capacityAfter: string | null;
  capex: number | null;
  // ratios — computed only from stated numbers, with the formula shown
  ratios: Array<{ label: string; value: number; formula: string }>;
}

export interface TimeFacts {
  executionPeriod: string | null;   // e.g. "24 months" — only when disclosed
  expectedCompletion: string | null;
  milestones: string[];
}

export interface StructuredFacts {
  source: SourceRef;
  event: EventFacts;
  economics: EconomicFacts;
  time: TimeFacts;
  quotes: string[];                 // verbatim, each verified present in the document
  unknowns: string[];               // plain-English list of what the document does not say
  verificationRequired: boolean;    // true for PRESS / SUMMARY_ONLY facts
}

export const emptyEconomics = (): EconomicFacts => ({
  valueNative: null, currency: null, sharesIssued: null, issuePrice: null, dilutionPct: null, allottees: [],
  considerationNative: null, targetRevenueNative: null, targetProfitNative: null, stakePct: null,
  capacityBefore: null, capacityAfter: null, capex: null, ratios: [],
});

export const emptyTime = (): TimeFacts => ({ executionPeriod: null, expectedCompletion: null, milestones: [] });

// ── catalyst identity + state ───────────────────────────────────────────

export type CatalystState =
  | 'IDENTIFIED' | 'DOCUMENTED' | 'EXECUTING' | 'CONFIRMED' | 'WEAKENING' | 'DISPROVED';

export interface CatalystRecord {
  id: string;                       // underlying catalyst id (see catalystIdOf)
  ticker: string;
  market: 'IN' | 'US';
  kind: EventKind;
  title: string;
  state: CatalystState;
  previousState: CatalystState | null;
  latestEvidence: string | null;
  nextMilestone: string | null;
  invalidation: string | null;
  sources: SourceRef[];             // every filing / article about THIS catalyst, oldest first
  firstSeen: string;
  lastSeen: string;
}

export type PersistenceGrade = 'HIGH' | 'MEDIUM' | 'EARLY' | 'TEMPORARY';

export interface PersistenceTest {
  mechanism: string | null;         // how the event turns into revenue/profit
  runway: string | null;            // disclosed execution period / capacity runway
  evidence: string | null;          // what has already been proven
  repeatability: string | null;     // repeat orders / recurring customer
  duration: string | null;          // ONLY when disclosed
  milestone: string | null;         // next checkable event
  invalidation: string | null;
  grade: PersistenceGrade;
  why: string;                      // one plain-English sentence
}

/** Stable id for the underlying catalyst so repeat headlines/press/filings
 *  about the same thing merge. Built from ticker + kind + the most specific
 *  counterparty/product token available. Never includes a date or price. */
export function catalystIdOf(ticker: string, kind: EventKind, counterparty: string | null, product: string | null): string {
  const norm = (s: string | null) => (s || '').toLowerCase().replace(/\b(limited|ltd|inc|corp|corporation|pvt|private|plc|llc|co)\b\.?/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const anchor = norm(counterparty) || norm(product) || 'general';
  return `${ticker.toUpperCase()}:${kind}:${anchor}`;
}
