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
  | 'other'
  // zzz787 — ownership / corporate events are no longer forced into
  // 'acquisition'. The older values stay valid (stored records use them):
  //   acquisition          buying a business or control of one (M&A)
  //   merger               two businesses combined (amalgamation / scheme)
  //   strategic_expansion  a new subsidiary, geography or entity of its own (ZIMLAB Chile)
  //   strategic_investment an outside strategic buys a stake in the company
  //                        (stake_by_strategic is the older name — same meaning)
  //   promoter_buying      the promoter / an insider buys shares (GNA 1.16%)
  //   capital_allocation   buyback, dividend, use of money already raised
  | 'merger' | 'strategic_expansion' | 'strategic_investment' | 'promoter_buying' | 'capital_allocation';

/** zzz787: the two names for an outside strategic's stake are one kind. */
export const isStrategicStakeKind = (k: EventKind | string | null | undefined): boolean => k === 'stake_by_strategic' || k === 'strategic_investment';

/** zzz787: a contract TERM stated in words or digits ("five-year services
 *  agreement", "for a period of 3 years", "a term of 60 months"). Returns the
 *  term in years, or null. A term is a contract runway — never revenue. */
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
export function contractTermYears(text: string | null | undefined): number | null {
  const t = String(text || '');
  const n = (s: string) => (WORD_NUM[s.toLowerCase()] ?? Number(s));
  const y = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)[- ](?:year|yr)s?\b[^.;]{0,40}?\b(agreement|contract|services?|supply|arrangement|term|licen[cs]e|order|engagement|deal|partnership|mandate|lease|concession)\b/i.exec(t)
    || /\b(?:term|tenure|period|duration) of (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s*(?:\(\d+\)\s*)?(?:year|yr)s?\b/i.exec(t)
    || (/\b(agreement|contract|mandate|engagement)\b/i.test(t) ? /\bfor (?:a period of |a term of )?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s*(?:\(\d+\)\s*)?(?:year|yr)s?\b/i.exec(t) : null);
  if (y) { const v = n(y[1]); return Number.isFinite(v) && v > 0 && v <= 30 ? v : null; }
  const m = /\b(?:term|tenure|period|duration) of (\d{2,3})\s*months?\b/i.exec(t) || /\b(\d{2,3})[- ]month\s+(?:agreement|contract|services?|supply|term|engagement)\b/i.exec(t);
  if (m) { const v = Number(m[1]) / 12; return v >= 1 && v <= 30 ? Math.round(v * 10) / 10 : null; }
  return null;
}

/** zzz789 — a FAVOURABLE regulatory / legal outcome: an appeal allowed (fully
 *  or partly), a demand reduced / quashed / set aside / deleted / dropped, or
 *  relief granted. It is a resolved (or improving) matter — never negative
 *  evidence (PRIORITY: an appeal that REDUCED a tax demand was listed under
 *  NEGATIVE EVIDENCE). Shared by the India + US classifiers and the press
 *  reader. A dismissed appeal or an upheld demand with no reduction is not
 *  favourable. */
const FAV_OUTCOME = /\b(?:(?:partly|partially|fully)\s+)?allowed the (?:company'?s |its )?appeal|appeals? (?:has been |have been |was |were |is )?(?:partly |partially |fully )?allowed|(?:reduc\w+|scal\w+ down|brought down|lower\w*)\s+(?:the |its |a )?(?:tax |gst |penalty |total )?(?:demand|penalty|liability|assessment|addition)|(?:demand|penalty|liability|addition)s?\s+(?:\w+\s+){0,6}?(?:has been |have been |was |were |is |stands )?(?:reduced|quashed|set aside|deleted|dropped|withdrawn|annulled|vacated|waived)|\b(?:quash\w*|set aside|deleted|dropped|annulled|vacated|waived)\s+(?:the\s+)?(?:[^;]{0,40}?\s)?(?:demand|penalty|order|addition|proceedings|notice|assessment|fine)|relief (?:has been |was )?granted|granted (?:full |partial )?relief|in favou?r of the company|in (?:the |its |our )?company'?s favou?r|decided in (?:its|our|the company'?s) favou?r|ruled in favou?r/i;
const UNFAV_OUTCOME = /appeals? (?:has been |was |were )?(?:dismissed|rejected)|(?:dismissed|rejected) the (?:company'?s |its )?appeal|upheld the (?:demand|penalty|order|assessment)|confirmed the demand/i;
const REDUCED = /reduc\w+|quash\w*|set aside|deleted|dropped|waived|partly allowed|partially allowed/i;
export function favourableLegalOutcome(text: string | null | undefined): boolean {
  const t = String(text || '');
  if (!FAV_OUTCOME.test(t)) return false;
  return !(UNFAV_OUTCOME.test(t) && !REDUCED.test(t));
}

/** zzz789: what was done with the debt, as stated — redeemed / repaid / raised … */
export function debtActionOf(s: string): 'redeemed' | 'repaid' | 'prepaid' | 'refinanced' | 'repurchased' | 'raised' | null {
  if (/\bredeem(?:ed|s|ing)?\b|\bredemption\b/i.test(s)) return 'redeemed';
  if (/\brefinanc/i.test(s)) return 'refinanced';
  if (/\bprepa(?:id|y|yment)\b/i.test(s)) return 'prepaid';
  if (/\brepa(?:id|y|yment)\b/i.test(s)) return 'repaid';
  if (/\brepurchas/i.test(s)) return 'repurchased';
  if (/\b(issued|priced|closed|entered into|borrow\w*|sold|raised)\b/i.test(s)) return 'raised';
  return null;
}

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
export function catalystIdOf(ticker: string, kind0: EventKind, counterparty: string | null, product: string | null): string {
  // zzz787: one id for one strategic stake, whichever name the producer used.
  const kind: EventKind = kind0 === 'strategic_investment' ? 'stake_by_strategic' : kind0;
  const norm = (s: string | null) => (s || '').toLowerCase().replace(/\b(limited|ltd|inc|corp|corporation|pvt|private|plc|llc|co)\b\.?/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const anchor = norm(counterparty) || norm(product) || 'general';
  return `${ticker.toUpperCase()}:${kind}:${anchor}`;
}
