// ═══════════════════════════════════════════════════════════════════════════
// CATALYST RESEARCH — "what caused this move, is it real, is it fresh, is it
// already priced, can it produce another leg?"                      (zzz741)
//
// The owner's brief does this by hand every evening for ~120 names and the
// tab did not: it matched gainers to filed results and read six exchange
// announcements, so a board of 122 came back as eight quarterly results
// "filed 40 days ago". Everything the brief actually finds — a ₹126 Cr
// contract, a sixth plant commissioned, an AS9100D certification, a company
// DENYING any undisclosed information while the stock doubles, three names
// pinned at the 20% band on ₹5 Cr of turnover, an IPO back at issue price,
// a broker note, a governance dispute — lived outside the tab.
//
// This module is the brief's method, as code, PURE: every function takes
// data in and returns findings out, so it is tested against captured pages
// without a network. The sweep that feeds it (screener company page +
// announcement list + price history for India; EDGAR submissions + the
// TradingView export for the US) lives in the research route.
//
// THE RULES THAT MATTER, carried over verbatim in spirit:
//   · A name that was checked and has nothing is an explicit `none`, never a
//     silence. Coverage is a fraction and it is printed.
//   · REJECT FIRST. denied / negative / routine_only / listing_artifact /
//     stale are findings in their own right and are printed.
//   · A band print measures the band, not demand.
//   · An announcement with no disclosed value is capped; under 1% of market
//     cap it cannot rank above THIN whatever the rest of the row says.
//   · A stock that is down has not priced its catalyst.
//   · ENABLING (board to consider) ≠ SCHEDULED (dated in the future) ≠
//     EXECUTED (money in, plant running).
//   · Every third-party story is dated before it is believed.
// ═══════════════════════════════════════════════════════════════════════════

import { NEGATIVE_CATALYSTS, type CatalystType } from './events';
import { classifyUsFiling, fmtUsdM, usPlainSubject } from './us-gainers';

/** The version of the classification + scoring rules a finding was built
 *  under. BUMP IT whenever classifyAnnouncement / parseStatedValue /
 *  scoreCatalyst / buildFinding change what a finding says: a stored day
 *  whose findings carry an older version is re-scored automatically on the
 *  next page open, from filings already fetched and model reads already
 *  cached — never a new model read. (zzz769)
 *  zzz771: clarification vs true denial split, fundraising no longer negative
 *  by default, US resale/shelf registrations told apart from a new raise. */
import type { NewsContext } from './news-context';
import { pressFacts } from './news-context';
import type { StructuredFacts, SourceRef } from './structured-facts';
import { catalystTypeOf, factValueCr, flatFacts, evidenceBreadthOf, type DocRead, type IndiaFacts } from './india-extract';
import { isGenericSubject, docSeqOf } from './announcement-reader';

export const RULES_VERSION = '2026-09-24.zzz785';
// zzz785: India filings are read from the attached document (deterministic
// extraction, no model): generic / unclassified subjects are classified from
// the body; a soft negative (tax notice, exchange fine) no longer hides a
// positive event filed in the same window; structured facts, source refs,
// evidence gap and evidence breadth are attached to every finding.
// zzz782: US 8-K subjects in plain words; 1D from the daily closes; the
// press release read without a model (document_extract).

export type ResearchStatus =
  | 'catalyst'          // a dated, sourced event survived the reject gates
  | 'denied'            // the company told the exchange it has nothing to disclose
  | 'negative'          // the only in-window filing is bad news
  | 'routine_only'      // AGM / BRSR / newspaper / ESOP paperwork only
  | 'none'              // checked: no filing in the window at all
  | 'listing_artifact'  // too little price history for the move to mean anything
  | 'source_failed'     // the sources could not be reached — NOT "none"
  | 'unresearched';     // not yet swept

export type Stage = 'enabling' | 'scheduled' | 'executed';
export type Verdict = 'FIRE' | 'ROOM' | 'PRICED' | 'WEAK' | 'NONE' | 'THIN';

export interface AnnouncementLite {
  subject: string;
  /** The source's one-line summary of the filing when it carries one. Third
   *  party text: used to classify and to find a value, never quoted as fact. */
  summary: string | null;
  url: string;
  dateIso: string | null;     // publication datetime, ISO
  ageDays: number | null;
}

export interface ClassifiedAnnouncement extends AnnouncementLite {
  kind: 'catalyst' | 'denial' | 'negative' | 'routine' | 'exchange_query' | 'unclassified';
  category: CatalystType | 'rating_action' | 'open_offer' | null;
  stage: Stage | null;
  /** ₹ Cr (India) or $ M (US) when a value is stated in subject/summary. */
  valueStated: number | null;
  /** True when the item re-announces or renews something rather than adds. */
  incremental: boolean;
  routineReason: string | null;
}

export interface Returns {
  /** zzz782: the last daily bar against the close before it (%), and that
   *  bar's date — the 1D a US row lacked (the export carries 1W only). */
  d1?: number | null;
  d1Date?: string | null;
  /** zzz775: 5-session return. */
  w1?: number | null;
  m1: number | null; m3: number | null; m6: number | null; y1: number | null; history: number;
  /** zzz772: the last ~140 dated closes, so the reaction to a DATED event can
   *  be measured against the close before it. Absent on inputs stored before
   *  zzz772 — the pricing assessment then says INSUFFICIENT EVIDENCE. */
  tail?: Array<[string, number]>;
}

/** ── zzz772: EVIDENCE, MARKET RESPONSE AND PRICING, KEPT APART. ─────────────
 *  The old score read "stock up 1M → priced, stock down → not priced". The
 *  owner's rule: a price move is evidence about the market's response, never
 *  proof of whether a catalyst is priced. Pricing is assessed only against a
 *  defined comparison — the reaction since the close before the filing versus
 *  the event's size — and says INSUFFICIENT EVIDENCE whenever that cannot be
 *  built. */
export type EvidenceState = 'DOCUMENT_VERIFIED' | 'SUMMARY_ONLY' | 'UNVERIFIED' | 'SOURCE_UNAVAILABLE' | 'NO_RELEVANT_FILING';
export type PricingState = 'INSUFFICIENT_EVIDENCE' | 'RAN_UP_BEFORE_FILING' | 'REACTION_SMALL_VS_SIZE' | 'REACTION_IN_LINE' | 'REACTION_EXCEEDS_SIZE' | 'FELL_AFTER_FILING';
export interface MarketResponse {
  d1: number | null; m1: number | null; m3: number | null;
  /** % from the last close BEFORE the filing date to the latest close. */
  sinceFiling: number | null;
  /** % over the 20 sessions that ended at the close before the filing. */
  preFiling20: number | null;
  sessionsSinceFiling: number | null;
}
export interface Pricing { state: PricingState; text: string; adj: number }
export interface ScoreComponents {
  freshness: number;
  /** Materiality after the evidence-confidence haircut — the value the NET uses. */
  materiality: number;
  materialityRaw?: number;
  /** 1.0 when the value was read in the document; 0.6 for a summary-only value. */
  materialityConfidence?: number;
  transmission: number;
  persistence: number;
  sourceMult: number;
  /** Kept for stored findings: (1 − pricingAdj) × 100. */
  pricedIn: number;
  pricingAdj?: number;
  /** (0.30F + 0.30M + 0.25T + 0.15P), before the multipliers. */
  base?: number;
  /** base × source × pricing, before any cap — the number a reader can recompute. */
  netUncapped?: number;
  /** Every cap applied, in words, with its level. */
  caps?: string[];
  evidence?: EvidenceState;
  pricing?: Pricing;
  response?: MarketResponse;
}

export interface Finding {
  /** zzz780: persistence test of this event (+ the ledger, when the company has one). Never price. */
  persistence?: import('@/lib/catalyst/persistence').PersistSummary | null;
  ticker: string;
  company: string | null;
  market: 'IN' | 'US';
  movePct: number | null;
  marketCap: number | null;        // ₹ Cr or $ M
  turnover: number | null;         // ₹ Cr or $ M traded in the session
  status: ResearchStatus;
  category: ClassifiedAnnouncement['category'];
  stage: Stage | null;
  headline: string | null;         // the specific fact in ≤ 14 words, or the finding
  evidenceQuote: string | null;    // verbatim from the document, model-verified
  sourceUrl: string | null;
  sourceDate: string | null;
  sourceTier: 'primary' | 'secondary' | 'tertiary' | 'unsourced';
  ageDays: number | null;
  valueStated: number | null;
  valuePctMcap: number | null;
  net: number | null;
  components: ScoreComponents | null;
  verdict: Verdict | null;
  returns: Returns | null;
  bandPrint: boolean;
  bandLevel: number | null;
  listingDays: number | null;
  routine: string[];               // subjects of routine filings in the window
  filingsInWindow: number;
  windowDays: number;
  holding: boolean;
  notes: string[];
  modelRead: boolean;
  researchedAt: string;
  sources: string[];               // which sources answered
  /** RULES_VERSION the finding was built under (absent = before zzz769). */
  rulesVersion?: string;
  /** zzz771 — for status `denied`: a price-movement CLARIFICATION ("no
   *  undisclosed information") is company-confirmed absence of a catalyst,
   *  not a negative event; a true DENIAL contradicts a specific reported deal
   *  or story and is negative evidence. Absent on findings built before
   *  zzz771 (the view then reads the headline). */
  denialKind?: 'clarification' | 'denial';
  /** Dated press coverage — secondary, never the catalyst, never a number in NET. (zzz773) */
  news?: NewsContext | null;
  /** zzz775: what the model-read filing states, keyed by fact (value, counterparty, execution period, …). */
  facts?: Record<string, string> | null;
  /** zzz782: the quote and figures were extracted VERBATIM from the filed
   *  document (US press release) without a model. */
  docExtract?: boolean;
  /** zzz785: every event found in the documents read for this name — positive
   *  AND negative, current AND older related filings — in the shared contract
   *  (structured-facts.ts). India entries are IndiaFacts (polarity, headline,
   *  attribution, relation, continues). Named `structuredFacts` because `facts`
   *  already carries the model reader's flat map. */
  structuredFacts?: StructuredFacts[];
  /** zzz785: every source consulted, with how it was accessed. Named
   *  `sourceRefs` because `sources` already carries the source names. */
  sourceRefs?: SourceRef[];
  /** zzz785: NO_CATALYST = read, nothing relevant; EVIDENCE_INCOMPLETE =
   *  something relevant but its document unread; UNCLASSIFIED = a filing
   *  exists and could not be classified even after reading it. */
  evidenceGap?: 'NO_CATALYST' | 'EVIDENCE_INCOMPLETE' | 'UNCLASSIFIED' | null;
  /** zzz785: independent dimensions, not a raw item count. */
  evidenceBreadth?: { documents: number; sourceKinds: number; eventKinds: number };
}

// ── denial vs clarification (zzz771) ──────────────────────────────────────
// ASTEC, GABRIEL, STLNETWORK, WEL all replied to an exchange query with "no
// undisclosed information": that is the company confirming there is NO
// catalyst — evidence, not bad news. Only a reply that contradicts a specific
// report ("the company denies the reported acquisition", "baseless", "no such
// proposal") is a denial in the negative sense.
const RX_TRUE_DENIAL = /\b(den(y|ies|ied)|baseless|not true|untrue|factually incorrect|incorrect and misleading|speculative and incorrect|refut(e|es|ed)|no truth)\b/i;
const RX_REPORTED_THING = /\b(news (item|article|report)s?|media (report|article)s?|press report|report(ed|s)? (in|by|that)|article|rumou?rs?|speculation|social media)\b/i;
const RX_NO_SUCH = /\bno such (proposal|plan|deal|agreement|discussion|negotiation|transaction|talks?)\b/i;

/** Whether a denial-kind filing contradicts a reported story (true denial)
 *  or merely says nothing is pending (clarification). */
export function denialKindOf(text: string): NonNullable<Finding['denialKind']> {
  const t = String(text || '');
  return (RX_TRUE_DENIAL.test(t) && RX_REPORTED_THING.test(t)) || RX_NO_SUCH.test(t) ? 'denial' : 'clarification';
}

/** zzz775: a tax demand / notice / appellate order — never an order win. */
// zzz785: "₹153.76 Cr exclusive of GST" is an order's value, not a tax matter.
const stripTaxQualifiers = (h: string) => h.replace(/\b(exclusive|inclusive) of (applicable )?(gst|taxes|tax|duties)\b|\b(excluding|including|plus|\+)\s*(applicable )?gst\b|\bincl\.? taxes\b/gi, ' ');
export const isTaxMatter = (hay0: string): boolean => { const hay = stripTaxQualifiers(hay0); return isTaxMatterRaw(hay); };
const isTaxMatterRaw = (hay: string): boolean =>
  /\b(gst|cgst|sgst|igst|goods and services tax|income[- ]tax|service tax|customs duty|excise|tax demand|demand notice|show[- ]cause|\bscn\b|assessment order|itat|cestat|appellate (authority|tribunal)|commissioner \(appeals\)|tax (order|notice|authorit)|penalty order|dgg?i)\b/i.test(hay)
  && /\b(order|notice|demand|penalt|appeal|hearing|assessment|levied|imposed|confirmed)\w*/i.test(hay);
export const taxFavourable = (hay: string): boolean => /\b(quashed|dropped (entirely|fully)|set aside|in (our|its|the company'?s) favou?r|allowed the appeal|deleted the (demand|addition)|no (tax )?demand)\b/i.test(hay) && !/confirmed|upheld|levied|imposed/i.test(hay);
/** zzz775: a developer's gross development value, a "potential" or an
 *  "up to unlock" figure is not the company's revenue or consideration. */
export const isPotentialValue = (hay: string): boolean => /(business|revenue|annual) potential|\bgdv\b|gross development value|revenue potential|top ?line potential|sales potential|peak (revenue|sales) potential|may unlock|potential (revenue|value|topline)|market (size|opportunity) of/i.test(hay);

// ── 1. CLASSIFY A FILING BY ITS SUBJECT (+ the source's summary) ──────────

const RX = {
  // zzz766 — `[^.]` could not cross the dots in "Query Dated 18.09.2026", so a
  // same-week reply to a volume query read as an exchange query and the
  // finding fell back to an older denial. `replies` and "no undisclosed
  // developments" are how the aggregator summarises these.
  denial: /(clarification|reply|replies|response)\b.{0,120}?(price movement|movement in (the )?(price|volume)|spurt in (price|volume)|volume (movement|increase|rise|inquiry|query|surge)|\bvolume\b|news (item|article)|rumou?r)|no (undisclosed|unpublished) (price sensitive )?(information|developments?|events?)|not aware of any (information|event|development)|nothing (to|that needs to be) disclose/i,
  exchangeQuery: /(exchange|nse|bse)[^.]{0,40}(query|clarification sought|seeks clarification|has sought clarification|sought clarification)|clarification sought from|query (from|by) (nse|bse|the exchange)/i,
  // The exchange ASKING is not the company ANSWERING. Checked before the
  // denial rule so "Exchange has sought clarification … movement in volume"
  // is never read as the company's own denial. (zzz766)
  exchangeAsk: /clarification sought|sought clarification|seeks clarification|seeking clarification/i,
  companyReply: /\b(reply|replies|replied|response|responds|responded|confirms?|clarifies|clarified)\b/i,
  // Operational damage is news, and bad news — a turbine failure is not "not
  // classifiable". (zzz766, REGAAL 10 Sep 2026)
  opsNegative: /disruption of (operations|production|supply)|(damage|damaged) (to|at|of)|\bdamage\b[^.]{0,40}(plant|unit|turbine|boiler|facility|factory)|(turbine|boiler|plant|unit|facility|factory)[^.]{0,40}\bdamage|major fire|\bfire (at|in|broke|incident|accident)|explosion|\bblast\b|accident at|(temporar(y|ily)|partial(ly)?) (shut|suspend|halt|clos)|suspension of (operations|production|manufacturing)|plant shut ?down|\block-?out\b|\bstrike\b at|force majeure|flood(ing|ed)? (at|in|damage)/i,
  // Borrowing is financing, not a catalyst — and a debt raise dilutes no one.
  debtOnly: /\bncds?\b|non[- ]convertible debenture|debentures?\b|commercial paper|term loan|borrowing|bank facilit|working capital (facility|limit|loan)|credit facilit/i,
  equityWords: /\bequity\b|preferential|\bqip\b|qualified institution|warrant|rights (issue|shares)|\bfccb\b|convertible (warrant|equity|preference)/i,
  newProduct: /product launch|\blaunch(ed|es|ing)?\b[^.]{0,60}(product|brand|range|variant|model|drug|molecule|platform|service)|began commercial sales|commenced commercial sales|commercial launch/i,
  negative: /against-vote|vote(s|d)? against|voting against|\biias\b|\bsesqi\b|proxy advis(or|er|ory)[^.]{0,60}against|ceased (as|to be) (an )?independent director|independent director[^.]{0,30}(ceased|resign|stepped down)|notice of delisting|item 3\.01|non-?compliance with (a )?(continued )?listing|going concern|non-reliance|restatement|item 4\.02|changes in registrant's certifying accountant|item 4\.01|resignation of (statutory |joint )?auditor|auditor.{0,20}resign|resignation.{0,40}independent director|independent director.{0,40}resign|(recommend|advis)[^.]{0,40}(vote )?against|sebi[^.]{0,30}(order|show cause|penalt|adjudicat)|penalty|default|insolvency|nclt|cirp|search (and|&) seizure|raid|fraud|forensic audit|winding up|delist|suspension of trading|gst evasion|income tax (search|survey)|qualified opinion|disclaimer of opinion|loss of (a )?(major|key) (customer|order)|order (cancell|terminat)|cancellation of order/i,
  routine: /non-deal road ?show|road ?show|\bndr\b|board meeting intimation|prior intimation|annual general meeting|\bagm\b|\begm\b|notice of (the )?(\d+\w* )?(annual|extraordinary)|newspaper|publication|brsr|business responsibility|annual report|trading window|esop|esos|espp|record date|dividend|book closure|investor (meet|presentation|conference|call)|analyst|con\.? ?call|earnings call|shareholders? meeting|postal ballot|voting result|scrutini[sz]er|compliance certificate|share transfer|loss of share|duplicate|reconciliation of share capital|shareholding pattern|corporate governance report|related party|secretarial|change in director|appointment of (company secretary|compliance officer)|cessation|retirement|intimation of (board|meeting)|outcome of board meeting[^.]{0,20}(unaudited|financial results)|closure of trading|letter to (non-email )?shareholders|kyc|website|change in (registered )?office|disclosure under regulation (29|31)|sast|xbrl|monitoring agency|statement of deviation|investor grievance|redressal|listing obligation|reg\.? ?7\(3\)|regulation 74|depository|certificate under|\bn-px\b|\bdef 14a\b|\bdefa14a\b|\bsc 13g\b|\b11-k\b|\bs-8\b|\barS\b|special window|re-?lodgement|physical share|esg (score|rating)|reaffirm|affirmed|conference participation|earnings? release date|date of (board|agm)|reconstitut|committee|policy|code of conduct|familiari[sz]ation|nomination|remuneration/i,
  // "Material definitive agreement" / Item 1.01 is the SEC's name for ANY
  // contract — a finance facility, a lease, a merger. It is never by itself
  // an order win (PRTH, NUAI printed "order win" from the item title). (zzz768)
  order: /award[^.]{0,20}order|receipt of order|bagging|letter of award|\bloa\b|\bloi\b|letter of intent|work order|purchase order|contract (award|win|from|worth|value)|(won|wins|secured|bags|bagged|awarded|receives?|received)[^.]{0,80}(order|contract|project|tender|₹|rs\.?|inr|crore|lakh|usd|\$)|order (worth|valued|of)|supply (agreement|order)|framework agreement|l1 bidder|empanel|\b(epc|epcm|pmc)\b[^.]{0,20}contract|signed[^.]{0,40}\bcontract\b/i,
  capacity: /enhancement of [^.]{0,40}capacity|capacity (rises|rose|increased|enhanced|augment)|expansion (completed|commissioned)|augmentation of [^.]{0,30}capacity|commission(ed|ing)|inaugurat|starting operations|commenced operations|completion of (the )?(project|construction|expansion|plant|facility)|ready for (leasing|commercial|operation)|commence(ment|d|s)? (of )?(commercial )?(production|operations)|capacity (expansion|addition|enhancement)|new (plant|facility|unit|line)|expansion of|greenfield|brownfield|plant (start|commenc)|trial (run|production)|start of (commercial )?production|first (batch|dispatch)/i,
  certification: /certif|accredit|iso ?\d|as9100|nadcap|(regulatory|product|drug|usfda|fda|dcgi|cdsco|who|epa|ema|mhra) approval|\busfda\b|\bus fda\b|\beir\b|form 483|who[- ]gmp|\bgmp\b|(product|drug|manufacturing|import|export) licen[cs]e|licen[cs]e (granted|received|obtained)|registration (of|granted|received)|marketing authori[sz]ation|\bcep\b|ce mark|\banda\b|\bdmf\b|patent (grant|approv)|qualified (as|by) [^.]{0,40}(supplier|vendor)|(vendor|supplier) (approval|qualification)/i,
  mna: /acquisition consideration|consideration (for|of) (the )?acquisition|share swap|consideration other than cash|completion of acquisition|item 2\.01|\bsc 13d\b|acquisition of|acquire|acquires|acquired|takeover|merger|amalgamation|scheme of arrangement|demerger|joint venture|\bjv\b|memorandum of understanding|\bmou\b|strategic (partnership|alliance|investment|investor)|stake (purchase|sale)|slump sale|divest|open offer|share purchase agreement|\bspa\b/i,
  fundraise: /rights shares|allotted [\d,.]+ (crore|lakh|equity|shares)|raising (₹|rs|inr)|unregistered sales|item 3\.02|424b|prospectus|registration statement|at-the-market|preferential|qualified institutions? placement|\bqip\b|warrant|fund ?rais|rights issue|allotment of (equity|securities|shares)|issue of (equity|shares|securities)|private placement|conversion of|\bncd\b|debenture|borrowing|term loan/i,
  buyback: /buy[- ]?back/i,
  promoterBuy: /promoter[^.]{0,40}(acqui|purchas|bought|buy)|acquisition of shares[^.]{0,40}promoter|creeping acquisition/i,
  rating: /credit rating|rating (action|upgrade|downgrade|reaffirm|assign|revis)|(care|crisil|icra|india ratings|ind-ra|brickwork|acuite|infomerics)[^.]{0,40}(upgrad|downgrad|reaffirm|assign)/i,
  guidance: /guidance|outlook (raised|revised|upgrade)|revenue target|order book (of|at|stands)/i,
  newCustomer: /new (customer|client)|onboard|empanelled with|added .{0,30} as (a )?(customer|client)/i,
  results: /^10-[qk]\b|results of operations|item 2\.02|financial results|unaudited (financial )?results|audited results|quarterly results|results for the (quarter|period)|press release[^.]{0,20}(result|q[1-4])/i,
  enabling: /to consider|\bconsider(ing|ation of)?\b|proposal|proposed|in-principle|approval of the board (for|to)|authori[sz](e|ation) to|intimation of board meeting|enabling resolution|subject to (shareholder|regulatory) approval/i,
  scheduled: /(expected|likely|scheduled|slated|will be|to be) (commission|complet|operational|commenc)|by (q[1-4]|fy ?\d|h[12] |end of|march|june|september|december|\d{4})|target(ed)? (date|for completion)/i,
  executed: /inaugurat|commenced|started operations|has (been )?(commissioned|received|secured|completed|commenced|won|bagged|signed|executed|allotted|acquired)|commenced commercial|received (an? )?(order|loa|approval)|successfully/i,
  // An allotment made AS CONSIDERATION executes a deal announced earlier; it
  // is follow-through, not fresh news. (zzz766 — GABRIEL's 11 Sep allotment
  // for an earlier-approved acquisition scored FIRE as if it were new.)
  renewal: /allot[\s\S]{0,140}?consideration|pursuant to (the )?(scheme|share purchase agreement|acquisition agreement)|renew|extension of (the )?(existing|earlier)|re-?award|repeat order|same (customer|counterparty)|already (announced|disclosed)|earlier (announced|disclosed)|in continuation/i,
  // Officer changes worded as sentences ("resigns as CHRO", "Board appointed
  // seven senior leaders") were left "not classifiable". (zzz768) An honorific
  // or an initial ("appoints Mr. R. Kumar as CFO") is not a sentence end, and
  // "Change in Senior Management Personnel" names no verb at all. (zzz769)
  mgmtChange: /departure of (directors|certain officers)|change(s)? in (the )?(senior management|key managerial|kmps?\b|management personnel|smp\b)|item 5\.02|appointment of (chief|ceo|cfo|managing director)|resignation of (chief|ceo|cfo|managing director)|(resign(ed|s|ation)?|appoint(ed|s|ment)?|designated|re-?designat\w*|steps? down|stepped down)\b(?:[^.]|(?<=\b(?:mr|ms|mrs|dr|shri|smt|[a-z]))\.){0,80}\b(chief|ceo|cfo|coo|chro|cto|cmo|managing director|whole[- ]time director|president|senior (management|leadership|leaders)|company secretary)\b/i,
  brokerNote: /initiat(es|ed|ion of) coverage|target price|\btp\b|buy rating|rating: buy|brokerage/i,
};

export function ageDaysOf(dateIso: string | null | undefined, now: Date): number | null {
  if (!dateIso) return null;
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** ₹ Cr from "₹279.33 crore", "Rs. 126 Cr", "INR 1,370 crores", "Rs 5,000 lakh"; $ M from "$3.22 million", "USD 135 mn". */
export function parseStatedValue(text: string, market: 'IN' | 'US'): number | null {
  // "implying ₹42.84 crore annual revenue", "estimating ₹500 crore opportunity",
  // "potential of up to ₹1,000 crore" — an inference is not a stated event
  // value. The figure is dropped so the item is scored as unmeasured.
  const t = text.replace(/,/g, '').replace(/(impl(y|ies|ying)|estimat(e|ed|es|ing)|potential(ly)?|opportunity|could|may|might|expected to|targeting|aims?|envisag|projected|likely)[^.]{0,60}?(₹|rs\.?|inr|usd|\$)\s*[\d.]+(\s*[-–]\s*[\d.]+)?\s*(crore|cr\b|crores|lakh|lacs?|million|mn|billion|bn|m\b)/gi, ' ');
  if (market === 'IN') {
    // A bare "1.2 crore equity shares" / "2 crore users" is a COUNT: without a
    // currency mark a crore is money only when no counted noun follows. (zzz769)
    const cr = /(?:₹|rs\.?|inr)\s*([\d.]+)\s*(crore|cr\b|crores)/i.exec(t)
      || /([\d.]+)\s*(crores?|\bcr\b)(?!\s*(?:fully[- ]paid\s+|equity\s+|new\s+|convertible\s+)*(?:shares?|warrants?|units?|users?|customers?|subscribers?|tonnes?|litres?|equity|securities|options|policies|accounts|households|people|beneficiaries))/i.exec(t);
    if (cr) { const n = parseFloat(cr[1]); return Number.isFinite(n) ? n : null; }
    // "20 lakh users", "2.82 lakh shares", "70 lakh warrants" are counts, not
    // money: a lakh is ₹ only when a currency marks it. (zzz768 — RNIT ₹0.2 Cr)
    const lakh = /(?:₹|rs\.?|inr)\s*([\d.]+)\s*(lakh|lacs?)/i.exec(t);
    if (lakh) { const n = parseFloat(lakh[1]); return Number.isFinite(n) ? n / 100 : null; }
    // "Rs. 4,884.61 Million" (PACEDIGITK) — rupee millions.
    const inrM = /(?:₹|rs\.?|inr)\s*([\d.]+)\s*(million|mn\b)/i.exec(t);
    if (inrM) { const n = parseFloat(inrM[1]); return Number.isFinite(n) ? n / 10 : null; }
    // "aggregating upto 60,00,00,000/-" (LIKHITHA) — a rupee amount written in
    // full; commas are already stripped.
    const full = /(?:₹|rs\.?|inr)?\s*(\d{7,})(?:\.\d+)?\s*\/-/i.exec(t);
    if (full) { const n = parseFloat(full[1]); return Number.isFinite(n) ? n / 1e7 : null; }
    const usd = /(?:usd|\$)\s*([\d.]+)\s*(million|mn|m\b)/i.exec(t);
    if (usd) { const n = parseFloat(usd[1]); return Number.isFinite(n) ? n * 8.5 : null; }   // ≈ ₹85/$ → ₹ Cr
    const usdB = /(?:usd|\$)\s*([\d.]+)\s*(billion|bn)/i.exec(t);
    if (usdB) { const n = parseFloat(usdB[1]); return Number.isFinite(n) ? n * 8500 : null; }
    return null;
  }
  const m = /(?:usd|\$)\s*([\d.]+)\s*(billion|bn|million|mn|m\b)/i.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return /b/i.test(m[2]) ? n * 1000 : n;
}

export function classifyAnnouncement(a: AnnouncementLite, market: 'IN' | 'US' = 'IN'): ClassifiedAnnouncement {
  // zzz776: "Ms. Shubha Singh" — an honorific's full stop is not a sentence end.
  const hay = `${a.subject} ${a.summary || ''}`.replace(/\b(Mr|Ms|Mrs|Dr|Shri|Smt|Sri)\./g, '$1');
  const base = { ...a, category: null as ClassifiedAnnouncement['category'], stage: null as Stage | null, valueStated: parseStatedValue(hay, market), incremental: !RX.renewal.test(hay), routineReason: null as string | null };
  // US: the SEC form type and 8-K item code decide the KIND of event (zzz766).
  // Item 1.01 is not an order, a 424B is not a positive "fundraising", and an
  // Item 2.02 earnings release is not paperwork. A summary (a model read)
  // still refines an item the form cannot classify.
  if (market === 'US' && !a.summary) {
    const us = classifyUsFiling(a);
    if (us) return { ...base, ...us, valueStated: us.kind === 'catalyst' ? base.valueStated : null };
  }
  // A scheme the tribunal SANCTIONED is group restructuring, not insolvency
  // (MAWANASUG's amalgamation read as NEGATIVE because it names the NCLT);
  // a buyback's share extinguishment is the tail of an event already priced;
  // an officer joining or leaving moves no revenue. (zzz768)
  if (/(nclt|tribunal)[^.]{0,120}(sanction|approv)|(sanction|approv)[^.]{0,80}(nclt|tribunal)/i.test(hay) && /amalgamation|scheme|merger|demerger|arrangement/i.test(hay)) {
    return { ...base, kind: 'routine', valueStated: null, routineReason: 'scheme sanctioned by the tribunal — group restructuring' };
  }
  if (/extinguish/i.test(hay) && /buy[- ]?back/i.test(hay)) return { ...base, kind: 'routine', valueStated: null, routineReason: 'shares extinguished after a completed buyback' };
  const saysNothing = /no (undisclosed|unpublished)|not aware of any|nothing (to|that needs to be) disclose/i.test(hay);
  if (RX.exchangeAsk.test(hay) && !RX.companyReply.test(hay) && !saysNothing) return { ...base, kind: 'exchange_query', valueStated: null };
  // A reply that CONFIRMS a reported event is the event, not a denial.
  const confirms = /confirm(s|ed)? (the |that )?[^.]{0,40}(receipt|order|contract|acquisition|agreement|approval)|has (received|won|bagged|secured|signed)/i.test(hay);
  if (RX.denial.test(hay) && !confirms) return { ...base, kind: 'denial', valueStated: null };
  if (RX.exchangeQuery.test(hay) && !confirms) return { ...base, kind: 'exchange_query', valueStated: null };
  // zzz775: officer paperwork and scheme housekeeping are not events.
  if (/(company secretary|compliance officer|\bcs\b)[^.]{0,80}(resign|cessation|appoint|stepped down)|(resign|cessation|appoint)\w*[^.]{0,80}(company secretary|compliance officer)/i.test(hay) && !/(ceo|cfo|managing director|\bmd\b|whole[- ]time director|chairman)/i.test(hay)) {
    return { ...base, kind: 'routine', valueStated: null, routineReason: 'company secretary / compliance officer change' };
  }
  if (/fractional (entitlement|share)|compensation to[^.]{0,60}shareholders[^.]{0,60}(fraction|scheme)/i.test(hay)) {
    return { ...base, kind: 'routine', valueStated: null, routineReason: 'fractional-entitlement settlement under a scheme' };
  }
  // zzz775: TAX IS NOT AN ORDER. "GST order received" matched the order rule.
  if (isTaxMatter(hay)) {
    return taxFavourable(hay)
      ? { ...base, kind: 'routine', valueStated: null, routineReason: 'tax matter decided in the company\'s favour' }
      : { ...base, kind: 'negative', category: 'tax_litigation', valueStated: parseStatedValue(hay, market) };
  }
  if (RX.opsNegative.test(hay) && !/insurance claim (received|settled)|resumed|restored|back to normal/i.test(hay)) return { ...base, kind: 'negative', category: null, valueStated: null };
  if (RX.negative.test(hay)) return { ...base, kind: 'negative', category: /auditor/i.test(hay) ? 'auditor_resignation' : /sebi|penalt|search|raid|fraud|investigat/i.test(hay) ? 'regulatory_investigation' : /order (cancell|terminat)|cancellation|loss of/i.test(hay) ? 'order_cancellation' : null, valueStated: null };
  // THE SUBJECT DECIDES WHETHER A FILING IS PAPERWORK. An AGM notice whose
  // summary mentions "₹500 crore NCD authorisation" is still an AGM notice:
  // the summary supplies a value and a category only when the subject is a
  // substantive one (Reg 30 update, press release, "General Updates").
  // Some paperwork announces itself in the summary rather than the subject:
  // a Reg 74(5) share-certificate return, a demat report, a re-lodgement
  // report. Those never carry an event whatever the subject says.
  if (/share certificate|dematerialis|regulation 74|reg\.? ?74|re-?lodgement|newspaper (publication|advertisement)|\bbrsr\b|esg (score|rating)|trading window|closure of trading|book closure|record date for|internal auditor|secretarial auditor|cost auditor|appoint(ed|ment)[^.]{0,20}(additional |non-executive |independent )+director|reconstitut(ed|ion) (of )?(the )?(committee|board)/i.test(hay)) {
    return { ...base, kind: 'routine', valueStated: null, routineReason: 'administrative' };
  }
  // A person buying or selling a few thousand shares is an insider trade, an
  // acquisition only in the regulation's vocabulary. Promoter buying is kept
  // as its own (small) catalyst; anyone else's is paperwork.
  if (/(acquired|bought|purchased|sold|disposed)[^.]{0,20}[\d,.]+ (\S+ ){0,3}shares/i.test(hay) && !/open offer|stake|%|per ?cent/i.test(hay)) {
    return /promoter/i.test(hay) && !/sold|disposed/i.test(hay) ? { ...base, kind: 'catalyst', category: 'promoter_purchase', stage: 'executed', valueStated: null } : { ...base, kind: 'routine', valueStated: null, routineReason: 'insider trade' };
  }
  if (/authori[sz]\w*[^.]{0,80}(\bkmps?\b|key managerial personnel)|(\bkmps?\b|key managerial personnel)[^.]{0,80}authori[sz]\w*|regulation 30\s*\(5\)|reg\.? ?30\s*\(5\)/i.test(hay)) return { ...base, kind: 'routine', valueStated: null, routineReason: 'KMP authorisation under Reg 30' };
  const subjectRoutine = RX.routine.test(a.subject) && !RX.order.test(a.subject) && !RX.capacity.test(a.subject) && !RX.certification.test(a.subject) && !RX.mna.test(a.subject) && !RX.rating.test(a.subject);
  if (subjectRoutine) return { ...base, kind: 'routine', valueStated: null, routineReason: (RX.routine.exec(a.subject) || [''])[0].toLowerCase().trim() || 'routine' };
  // An MoU, a letter of intent or anything "non-binding" is ENABLING: nothing
  // has been ordered, built or paid for. "Will begin" is SCHEDULED.
  const stage: Stage = (RX.enabling.test(hay) || /non-binding|memorandum of understanding|\bmou\b|letter of intent|\bloi\b|in-principle|term sheet|proposed/i.test(hay)) ? 'enabling'
    : ((RX.scheduled.test(hay) || /will (begin|start|commence|be commissioned)|is expected to|likely to/i.test(hay)) && !RX.executed.test(hay)) ? 'scheduled' : 'executed';
  const cat = (c: ClassifiedAnnouncement['category']): ClassifiedAnnouncement => ({ ...base, kind: 'catalyst', category: c, stage });
  // An order RECEIVED is booked the day it arrives; the delivery date in the
  // same sentence is its execution schedule, not the event. PACEDIGITK's LoA
  // printed "SCHEDULED, not executed". An LoI stays enabling. (zzz768)
  if (RX.order.test(hay)) {
    const booked = stage === 'scheduled' && /(receiv|award|bagg|secur|won\b|wins\b|signed)/i.test(hay) && !/letter of intent|\bloi\b/i.test(hay);
    return booked ? { ...cat('order_win'), stage: 'executed' } : cat('order_win');
  }
  if (RX.capacity.test(hay)) return cat(/commission|commenc|start|first (batch|dispatch)/i.test(hay) ? 'production_ramp' : 'capacity_expansion');
  if (RX.buyback.test(hay)) return cat('buyback');
  if (RX.promoterBuy.test(hay) && !/inter[- ]se|gift|transmission|off-market transfer/i.test(hay)) return cat('promoter_purchase');
  if (RX.mna.test(hay)) {
    if (/open offer/i.test(hay)) return { ...cat('acquisition'), category: 'open_offer' };
    if (/joint venture|\bjv\b|\bmou\b|memorandum|strategic (partnership|alliance)/i.test(hay)) return cat('joint_venture');
    if (/demerger|scheme of arrangement/i.test(hay)) return cat('demerger');
    if (/divest|slump sale|stake sale/i.test(hay)) return cat('divestiture');
    return cat('acquisition');
  }
  if (RX.certification.test(hay)) return cat(/usfda|us fda|eir|483|who|gmp|dcgi|cdsco|anda|marketing authori|cep|ce mark/i.test(hay) ? 'regulatory_approval' : 'product_qualification');
  if (RX.rating.test(hay)) {
    // Only an UPGRADE or an outlook revised upward is an event. A
    // reaffirmation, an affirmation, an assignment or an ESG score is
    // paperwork however an aggregator headlines it.
    if (/upgrad|revised (to|upward)|outlook[^.]{0,30}(positive)|from (stable|negative) to positive/i.test(hay) && !/downgrad/i.test(hay)) return { ...cat('rating_action'), valueStated: null };
    if (/downgrad|outlook[^.]{0,30}negative|watch[^.]{0,20}negative/i.test(hay)) return { ...base, kind: 'negative', category: null, valueStated: null };
    return { ...base, kind: 'routine', valueStated: null, routineReason: 'rating reaffirmed / assigned / ESG score' };
  }
  if (RX.newProduct.test(hay)) return cat('new_product');
  // Debt is financing, not a catalyst: an NCD placement or a term loan adds
  // no revenue and dilutes no one. It is paperwork for this sweep. (zzz766 —
  // GABRIEL's ₹1,000 Cr NCD approval ranked as a PRICED "catalyst".)
  if (RX.debtOnly.test(hay) && !RX.equityWords.test(hay)) return { ...base, kind: 'routine', valueStated: null, routineReason: 'debt financing — borrowing is not a catalyst' };
  if (RX.fundraise.test(hay)) return cat('fundraising');
  if (RX.newCustomer.test(hay)) return cat('new_customer');
  if (RX.mgmtChange.test(hay)) return cat('management_change');
  if (RX.guidance.test(hay)) return cat('revenue_guidance_increase');
  // A results filing is scored by the graded funnel (revenue, PAT, EPS, tier)
  // with far more than a subject line; in THIS sweep it is context, and
  // counting it again as a fresh catalyst double-ranks every reporting name.
  if (RX.results.test(hay)) return { ...base, kind: 'routine', valueStated: null, routineReason: 'results filing — scored by the graded funnel' };
  if (RX.routine.test(hay)) return { ...base, kind: 'routine', valueStated: null, routineReason: (RX.routine.exec(hay) || [''])[0].toLowerCase().trim() || 'routine' };
  return { ...base, kind: 'unclassified' };
}

// ── 2. PRICE-HISTORY DERIVED FLAGS ─────────────────────────────────────────

/** Returns and history length from a daily close series [dateIso, close]. */
/** zzz782: the last daily move from the stored tail, with its date. */
export function d1FromTail(tail?: Array<[string, number]>): { d1: number | null; d1Date: string | null } {
  if (!tail || tail.length < 2) return { d1: null, d1Date: null };
  const [d, last] = tail[tail.length - 1], prev = tail[tail.length - 2][1];
  if (!(prev > 0) || !(last > 0)) return { d1: null, d1Date: null };
  return { d1: Math.round(((last / prev) - 1) * 1000) / 10, d1Date: String(d).slice(0, 10) };
}

/** zzz776: inputs stored before 1W existed still carry the 90-day tail. */
function w1FromTail(tail?: Array<[string, number]>): number | null {
  if (!tail || tail.length < 6) return null;
  const last = tail[tail.length - 1][1], prev = tail[tail.length - 6][1];
  return prev > 0 ? ((last / prev) - 1) * 100 : null;
}

export function returnsFromSeries(series: Array<[string, number]>): Returns {
  const v = series.map(([, c]) => c).filter((c) => Number.isFinite(c) && c > 0);
  const last = v[v.length - 1];
  const back = (n: number) => (v.length > n && last ? ((last / v[v.length - 1 - n]) - 1) * 100 : null);
  // A year of trading is ~247–252 sessions; a series of 247 points IS a year.
  const y1 = v.length >= 240 ? back(Math.min(247, v.length - 1)) : null;
  const tail = series.filter(([, c]) => Number.isFinite(c) && c > 0).slice(-90).map(([d, c]) => [String(d).slice(0, 10), c] as [string, number]);
  return { ...d1FromTail(tail), w1: back(5), m1: back(21), m3: back(63), m6: back(126), y1, history: v.length, tail };
}

/** Indian exchanges band small caps at 2/5/10/20%. A close within 0.15pp of a
 *  band on thin turnover is a band print: it measures the band, not demand. */
export function bandPrint(movePct: number | null, turnoverCr: number | null, market: 'IN' | 'US'): { band: boolean; level: number | null } {
  if (market !== 'IN' || movePct == null) return { band: false, level: null };
  for (const lvl of [20, 10, 5, 2]) {
    if (Math.abs(movePct - lvl) <= 0.15) {
      // 20% and 10% bands are unambiguous; 5% and 2% only count with thin turnover.
      const thin = turnoverCr == null || turnoverCr < 10;
      if (lvl >= 10 || thin) return { band: true, level: lvl };
    }
  }
  return { band: false, level: null };
}

// ── 3. THE NET SCORE ───────────────────────────────────────────────────────

const FRESH = (age: number | null): number => age == null ? 40 : age <= 0 ? 100 : age <= 3 ? 90 : age <= 7 ? 80 : age <= 30 ? 65 : age <= 90 ? 40 : age <= 180 ? 20 : 0;

function materialityOf(c: ClassifiedAnnouncement, marketCap: number | null): { score: number; pct: number | null; gated: boolean } {
  if (c.valueStated != null && marketCap != null && marketCap > 0) {
    const pct = (c.valueStated / marketCap) * 100;
    const s = pct >= 30 ? 100 : pct >= 15 ? 85 : pct >= 5 ? 65 : pct >= 1 ? 40 : 15;
    return { score: c.incremental ? s : Math.min(s, 30), pct, gated: pct < 1 };
  }
  if (c.valueStated != null) return { score: 60, pct: null, gated: false };          // value known, mcap unverified: capped at 60
  // No value: type fallback, capped at 35 for announcements.
  const byType: Record<string, number> = {
    acquisition: 100, open_offer: 100, order_win: 85, production_ramp: 90, capacity_expansion: 70, regulatory_approval: 90,
    revenue_guidance_increase: 85, quarterly_result: 80, new_customer: 75, new_product: 50, joint_venture: 70, fundraising: 50, buyback: 55,
    promoter_purchase: 45, rating_action: 25, product_qualification: 60, demerger: 70, divestiture: 60,
  };
  const t = byType[String(c.category || '')] ?? 30;
  return { score: Math.min(35, t), pct: null, gated: false };
}

const TRANSMISSION: Record<string, number> = {
  order_win: 80, production_ramp: 80, capacity_expansion: 60, quarterly_result: 80, revenue_guidance_increase: 80,
  regulatory_approval: 60, product_qualification: 40, new_customer: 60, new_product: 40, acquisition: 60, open_offer: 40, joint_venture: 40,
  demerger: 40, divestiture: 40, fundraising: 20, buyback: 20, promoter_purchase: 20, rating_action: 20, management_change: 20,
};
const PERSISTENCE: Record<string, number> = {
  order_win: 40, production_ramp: 100, capacity_expansion: 100, quarterly_result: 75, revenue_guidance_increase: 75,
  regulatory_approval: 75, product_qualification: 75, new_customer: 75, new_product: 60, acquisition: 75, open_offer: 40, joint_venture: 75,
  demerger: 40, divestiture: 40, fundraising: 40, buyback: 40, promoter_purchase: 40, rating_action: 40,
};

/** ── MARKET RESPONSE (zzz773) ─────────────────────────────────────────────
 *  What the price did around the DATED filing, measured from the last close
 *  before the filing date. Evidence about the market's response — never, on
 *  its own, proof of whether the catalyst is priced. */
export function marketResponseOf(r: Returns | null, filingIso: string | null | undefined, movePct: number | null = null): MarketResponse {
  const out: MarketResponse = { d1: movePct, m1: r?.m1 ?? null, m3: r?.m3 ?? null, sinceFiling: null, preFiling20: null, sessionsSinceFiling: null };
  const tail = r?.tail;
  const day = filingIso ? String(filingIso).slice(0, 10) : '';
  if (!tail || tail.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return out;
  // The filing can move the close of the day it was filed, so the reference
  // is the last close strictly BEFORE the filing date.
  let i = -1;
  for (let k = tail.length - 1; k >= 0; k--) if (tail[k][0] < day) { i = k; break; }
  if (i < 0) return out;                                    // filing older than the series
  const pre = tail[i][1], last = tail[tail.length - 1][1];
  out.sinceFiling = Math.round(((last / pre) - 1) * 1000) / 10;
  out.sessionsSinceFiling = tail.length - 1 - i;
  if (i >= 20) out.preFiling20 = Math.round(((pre / tail[i - 20][1]) - 1) * 1000) / 10;
  return out;
}

/** ── PRICING ASSESSMENT (zzz773) ───────────────────────────────────────────
 *  Only a DEFINED comparison is allowed: the reaction since the close before
 *  the filing against the event's size (value ÷ market cap), plus the run in
 *  the 20 sessions before it. Anything short of that is INSUFFICIENT
 *  EVIDENCE — never "down means not priced, up means priced". The adjustment
 *  is the only price input to NET, and it is printed. */
export function pricingOf(resp: MarketResponse, sizePct: number | null, stage: Stage | null): Pricing {
  const s = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  if (resp.sinceFiling == null) return { state: 'INSUFFICIENT_EVIDENCE', adj: 1, text: 'No dated price series around the filing — the reaction to it cannot be measured.' };
  if (resp.preFiling20 != null && resp.preFiling20 >= 25) {
    return { state: 'RAN_UP_BEFORE_FILING', adj: 0.75, text: `Ran ${s(resp.preFiling20)} in the 20 sessions before the filing — part of the news may have been anticipated. ×0.75.` };
  }
  if (stage === 'enabling' || stage === 'scheduled') return { state: 'INSUFFICIENT_EVIDENCE', adj: 1, text: `${s(resp.sinceFiling)} since the filing, but a ${stage} event has no size to compare the reaction with.` };
  if (sizePct == null) return { state: 'INSUFFICIENT_EVIDENCE', adj: 1, text: `${s(resp.sinceFiling)} since the close before the filing; no stated value, so the reaction cannot be compared with the event's size.` };
  if (resp.sinceFiling <= -3) return { state: 'FELL_AFTER_FILING', adj: 1, text: `${s(resp.sinceFiling)} since the filing — the market has not rewarded it. A response, not proof it is unpriced.` };
  const ratio = sizePct > 0 ? resp.sinceFiling / sizePct : Infinity;
  if (ratio <= 0.5) return { state: 'REACTION_SMALL_VS_SIZE', adj: 1, text: `${s(resp.sinceFiling)} since the filing against an event worth ${sizePct.toFixed(1)}% of mcap — reaction small for its size.` };
  if (ratio <= 2) return { state: 'REACTION_IN_LINE', adj: 0.85, text: `${s(resp.sinceFiling)} since the filing against an event worth ${sizePct.toFixed(1)}% of mcap — reaction in line with its size. ×0.85.` };
  return { state: 'REACTION_EXCEEDS_SIZE', adj: 0.6, text: `${s(resp.sinceFiling)} since the filing against an event worth ${sizePct.toFixed(1)}% of mcap — the stock moved more than twice the event's size. ×0.60.` };
}

/** How the catalyst's content was established. */
export function evidenceStateOf(c: ClassifiedAnnouncement, verifiedQuote: boolean): EvidenceState {
  if (verifiedQuote) return 'DOCUMENT_VERIFIED';
  if (c.summary && c.summary.trim().length >= 20) return 'SUMMARY_ONLY';
  return 'UNVERIFIED';
}
/** A value read in the document is trusted in full; a summary's is not. */
export const MATERIALITY_CONFIDENCE: Record<EvidenceState, number> = { DOCUMENT_VERIFIED: 1, SUMMARY_ONLY: 0.6, UNVERIFIED: 0.4, SOURCE_UNAVAILABLE: 0, NO_RELEVANT_FILING: 0 };
const SOURCE_MULT: Record<Finding['sourceTier'], number> = { primary: 1, secondary: 0.75, tertiary: 0.4, unsourced: 0 };
const r1 = (v: number) => Math.round(v * 10) / 10;

/** NET = (0.30·F + 0.30·M + 0.25·T + 0.15·P) × source × pricing, then caps.
 *  Every term is returned, so the displayed components reproduce the number.
 *  M is materiality after the evidence-confidence haircut. */
export function scoreCatalyst(c: ClassifiedAnnouncement, opts: { marketCap: number | null; returns: Returns | null; sourceTier: Finding['sourceTier']; verifiedQuote: boolean; movePct?: number | null }): { net: number; components: ScoreComponents; verdict: Verdict; valuePctMcap: number | null } {
  const freshness = FRESH(c.ageDays);
  const mat = materialityOf(c, opts.marketCap);
  const evidence = evidenceStateOf(c, opts.verifiedQuote);
  const conf = MATERIALITY_CONFIDENCE[evidence];
  const materiality = r1(mat.score * conf);
  let transmission = TRANSMISSION[String(c.category || '')] ?? 40;
  if (c.stage === 'enabling') transmission = Math.min(transmission, 20);
  if (c.stage === 'scheduled') transmission = Math.min(transmission, 40);
  const persistence = PERSISTENCE[String(c.category || '')] ?? 40;
  const sourceMult = SOURCE_MULT[opts.sourceTier] ?? 0;
  const response = marketResponseOf(opts.returns, c.dateIso, opts.movePct ?? null);
  const pricing = pricingOf(response, mat.pct, c.stage);
  const base = r1(0.30 * freshness + 0.30 * materiality + 0.25 * transmission + 0.15 * persistence);
  const netUncapped = r1(base * sourceMult * pricing.adj);
  let net = netUncapped;
  const caps: string[] = [];
  const cap = (lvl: number, why: string) => { if (net > lvl) { net = lvl; caps.push(`${why} → capped at ${lvl}`); } };
  let verdict: Verdict;
  if (mat.gated) { cap(17, `item is ${mat.pct!.toFixed(2)}% of market cap (under 1%)`); verdict = 'THIN'; }
  else {
    // An unmeasured event can never pay what a measured 30%-of-mcap one does.
    if (mat.pct == null) cap(44.9, 'no stated value');
    // P1 ("research first") needs the document itself: a summary can point
    // at a catalyst, it cannot establish one. (zzz773)
    if (evidence !== 'DOCUMENT_VERIFIED') cap(44.9, `${evidence === 'SUMMARY_ONLY' ? 'summary-only' : 'unverified'} evidence cannot rank P1`);
    // An appointment or a resignation moves no revenue. (zzz767)
    if (c.category === 'management_change') cap(15, 'management change moves no revenue');
    verdict = net >= 45 ? 'FIRE' : net >= 30 ? 'ROOM' : net >= 18 ? 'PRICED' : net >= 8 ? 'WEAK' : 'NONE';
  }
  const components: ScoreComponents = {
    freshness, materiality, materialityRaw: mat.score, materialityConfidence: conf, transmission, persistence, sourceMult,
    pricedIn: Math.round((1 - pricing.adj) * 100), pricingAdj: pricing.adj, base, netUncapped, caps, evidence, pricing, response,
  };
  return { net: r1(net), components, verdict, valuePctMcap: mat.pct == null ? null : Math.round(mat.pct * 100) / 100 };
}

/** Candidate order: NET, then the uncapped score — two capped items (a
 *  valued order and an unvalued rating note both at 44.9) are told apart by
 *  what they scored before the cap. */
const rankKey = (x: { net: number; components: ScoreComponents }) => x.net + (x.components.netUncapped ?? 0) / 1000;

/** The verdict from a NET (after any extra cap the builder applies). */
export const verdictOfNet = (net: number, thin = false): Verdict => thin ? 'THIN' : net >= 45 ? 'FIRE' : net >= 30 ? 'ROOM' : net >= 18 ? 'PRICED' : net >= 8 ? 'WEAK' : 'NONE';

// ── 4. FROM A SWEEP TO A FINDING ───────────────────────────────────────────

/** The filing worth model-reading: the same choice `buildFinding` makes. */
/** A filing published AFTER the session closed cannot have caused that
 *  session's move. (zzz766) */
export function filedAfterClose(dateIso: string | null | undefined, sessionCloseIso: string | null | undefined): boolean {
  if (!dateIso || !sessionCloseIso) return false;
  const t = Date.parse(dateIso), c = Date.parse(sessionCloseIso);
  return Number.isFinite(t) && Number.isFinite(c) && t > c;
}

/** 15:30 IST on the session date, as an ISO instant. */
export function indiaSessionCloseIso(sessionDate: string): string {
  return `${sessionDate}T15:30:00+05:30`;
}

export function chooseCandidate(announcements: AnnouncementLite[], market: 'IN' | 'US', opts: { marketCap: number | null; returns: Returns | null; windowDays: number; now: Date; sessionCloseIso?: string | null }): ClassifiedAnnouncement | null {
  const inWindow = announcements
    .map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, opts.now) }))
    .filter((a) => a.ageDays == null || a.ageDays <= opts.windowDays)
    .filter((a) => !filedAfterClose(a.dateIso, opts.sessionCloseIso))
    .map((a) => classifyAnnouncement(a, market));
  const cands = inWindow.filter((a) => a.kind === 'catalyst' && a.category !== 'rating_action')
    .map((a) => ({ a, s: rankKey(scoreCatalyst(a, { marketCap: opts.marketCap, returns: opts.returns, sourceTier: 'primary', verifiedQuote: false })) }))
    .sort((x, y) => y.s - x.s);
  return cands.length ? cands[0].a : null;
}

export interface SweepInput {
  ticker: string; company: string | null; market: 'IN' | 'US';
  movePct: number | null; marketCap: number | null; turnover: number | null;
  announcements: AnnouncementLite[];
  returns: Returns | null;
  holding: boolean;
  sources: string[];
  sourceFailed: boolean;
  windowDays: number;
  now: Date;
  /** When set, filings published after this instant are excluded from the
   *  explanation of the move — they post-date it. (zzz766) */
  sessionCloseIso?: string | null;
  /** A model-verified read of the chosen announcement, when one was made. */
  read?: { url: string; headline: string; quote: string; category: CatalystType; valueStated?: number | null; facts?: Record<string, string> | null;
    /** zzz782: 'document_extract' = verbatim sentences pulled from the filed
     *  document without a model; absent = a model read. */
    source?: 'model' | 'document_extract' } | null;
  /** Press coverage read for this name (zzz773). */
  news?: NewsContext | null;
  /** The graders hold a filed quarterly result behind this move (the scan's
   *  filed-results rows). A recent listing that has one is NOT a listing
   *  artifact only: the result is the context, the listing a caveat. (zzz769) */
  filedResult?: boolean;
  /** zzz785 (IN): documents opened for this name (the top candidate, generic /
   *  unclassified subjects, other substantive filings, older related ones). */
  docs?: DocRead[] | null;
  /** zzz785: a secondary source failed while the primary exchange source
   *  answered — e.g. "screener.in company page". Never "source unavailable". */
  secondaryUnavailable?: string | null;
  /** zzz785: structured facts / source refs another producer (US) built for
   *  this name; merged into the finding as they are. */
  extraFacts?: StructuredFacts[] | null;
  extraRefs?: SourceRef[] | null;
}

// ── zzz785: THE DOCUMENT DECIDES WHAT A GENERIC FILING IS ─────────────────

/** Documents by filing URL (a document read under two URLs answers both). */
function docIndex(docs: DocRead[] | null | undefined): Map<string, DocRead> {
  const m = new Map<string, DocRead>();
  for (const d of docs || []) { if (d.relation === 'history') continue; m.set(d.url, d); for (const u of d.sameAs || []) m.set(u, d); }
  return m;
}
const readDoc = (idx: Map<string, DocRead>, url: string | null | undefined): DocRead | null => { const d = url ? idx.get(url) : undefined; return d && d.access === 'DOCUMENT_READ' ? d : null; };

/** A subject-classified filing, corrected by its document when one was read:
 *  an unclassified / generic-subject filing takes the body's event; a
 *  summary's figure the document does not state (or states only as a
 *  "potential") is dropped. */
export function applyDocument(a: ClassifiedAnnouncement, d: DocRead | null, market: 'IN' | 'US'): ClassifiedAnnouncement & { docNote?: string } {
  if (!d || market !== 'IN') return a;
  const f = d.facts[0] as IndiaFacts | undefined;
  // A generic subject says nothing; the document says what was filed, whatever
  // the aggregator's summary suggested (ZIMLAB "Updates on Acquisition" was a
  // new subsidiary; VIKRAN's "Disclosure under Regulation 30" was a tax win).
  const generic = a.kind === 'unclassified' || (isGenericSubject(a.subject) && a.kind !== 'denial' && a.kind !== 'exchange_query' && !/results filing/.test(a.routineReason || '') && (!!f || !!d.routineReason));
  if (generic) {
    if (!f) return d.routineReason ? { ...a, kind: 'routine', valueStated: null, routineReason: `document read — ${d.routineReason.replace(/^routine:\s*/, '')}` } : a;
    const cat = catalystTypeOf(f);
    const v = factValueCr(f);
    const summary = a.summary || f.headline;
    if (f.polarity === 'negative') return { ...a, summary, kind: 'negative', category: f.event.kind === 'tax_litigation' ? 'tax_litigation' : (cat && cat !== 'new_geography' ? cat : null), valueStated: v, routineReason: f.event.kind === 'governance' ? 'exchange fine (document read)' : /^Promoter share sale/.test(f.headline) ? 'promoter share sale (supply)' : a.routineReason };
    if (f.event.kind === 'tax_litigation') return { ...a, summary, kind: 'routine', valueStated: null, routineReason: 'tax matter decided in the company\'s favour (document read)' };
    if (!cat) return a;
    const dropped = a.valueStated != null && v == null
      ? (f.statedPotentialNative != null && Math.abs(f.statedPotentialNative - a.valueStated) <= Math.max(0.01, a.valueStated * 0.01)
        ? `The document calls ${fmtMoney(a.valueStated, market)} an annual business POTENTIAL at expected production rates, not a firm order value — materiality is not measured from it.`
        : `The summary's figure (${fmtMoney(a.valueStated, market)}) is not stated as this event's value in the document.`)
      : undefined;
    return { ...a, summary, kind: 'catalyst', category: cat, stage: docStage(f) ?? 'executed', valueStated: v, ...(dropped ? { docNote: dropped } : {}) };
  }
  if (a.kind !== 'catalyst' || !f) return a;
  // The document's stage refines the subject's: a board approving a plant
  // has built nothing (KABRAEXTRU's ₹500 Cr battery plan).
  const ds = docStage(f);
  if (ds && ds !== a.stage && f.polarity !== 'negative') a = { ...a, stage: ds };
  const v = factValueCr(f);
  if (a.valueStated != null && f.statedPotentialNative != null && Math.abs(f.statedPotentialNative - a.valueStated) <= Math.max(0.01, a.valueStated * 0.01) && v == null) {
    return { ...a, valueStated: null, docNote: `The document calls ${fmtMoney(a.valueStated, market)} an annual business POTENTIAL at expected production rates, not a firm order value — materiality is not measured from it.` };
  }
  if (a.valueStated == null && v != null) return { ...a, valueStated: v };
  if (a.valueStated != null && d.valuesSeen.length && !d.valuesSeen.some((x) => Math.abs(x - a.valueStated!) <= Math.max(0.01, a.valueStated! * 0.01))) {
    return { ...a, valueStated: v, docNote: `The summary's figure (${fmtMoney(a.valueStated, market)}) is not stated in the document${v != null ? `; the document states ${fmtMoney(v, market)}` : ''}.` };
  }
  return a;
}

/** The sweep's stage from a read event: proposed / approved-but-unbuilt is
 *  enabling (scheduled when a completion date is stated); awarded, signed,
 *  commissioned or completed is executed. */
function docStage(f: IndiaFacts): Stage | null {
  const st = f.event.stage;
  if (f.event.kind === 'other') return 'enabling';
  if (st === 'PROPOSED') return 'enabling';
  if (st === 'APPROVED' && (f.event.kind === 'capacity' || f.event.kind === 'fundraising')) return f.time.expectedCompletion ? 'scheduled' : 'enabling';
  if (st === 'ANNOUNCED' && f.event.kind !== 'order') return 'enabling';
  return st ? 'executed' : null;
}

/** A tax notice or an exchange fine is bad news that does not cancel an order
 *  or a plant filed beside it; an auditor quitting or a SEBI order does. */
function softNegative(a: ClassifiedAnnouncement): boolean {
  return a.category === 'tax_litigation' || /exchange fine|promoter share sale/.test(a.routineReason || '') || isTaxMatter(`${a.subject} ${a.summary || ''}`);
}

function classifyWindow(inp: SweepInput) {
  const idx = docIndex(inp.docs);
  const all = inp.announcements
    .map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, inp.now) }))
    .filter((a) => a.ageDays == null || a.ageDays <= inp.windowDays)
    .map((a) => applyDocument(classifyAnnouncement(a, inp.market), readDoc(idx, a.url), inp.market));
  return { idx, all };
}

export function buildFinding(inp0: SweepInput): Finding {
  // zzz782: US 8-K subjects stored in the old item-title form read the same
  // as new ones (plain words, item codes as a tag).
  const inp: SweepInput = inp0.market === 'US' ? { ...inp0, announcements: inp0.announcements.map((a) => ({ ...a, subject: usPlainSubject(a.subject) })) } : inp0;
  return decorateFinding(buildFindingCore(inp), inp);
}

function buildFindingCore(inp: SweepInput): Finding {
  const now = inp.now.toISOString();
  const { idx: docs, all: allInWindow } = classifyWindow(inp);
  const docExtract0 = inp.read?.source === 'document_extract';
  const afterClose = allInWindow.filter((a) => filedAfterClose(a.dateIso, inp.sessionCloseIso));
  const inWindow = allInWindow.filter((a) => !filedAfterClose(a.dateIso, inp.sessionCloseIso));
  const band = bandPrint(inp.movePct, inp.turnover, inp.market);
  const listingDays = inp.returns && inp.returns.history > 0 && inp.returns.history < 60 ? inp.returns.history : null;
  const hasResult = !!inp.filedResult || allInWindow.some((a) => /^results filing/.test(a.routineReason || ''));
  const base: Finding = {
    ticker: inp.ticker, company: inp.company, market: inp.market, movePct: inp.movePct, marketCap: inp.marketCap, turnover: inp.turnover,
    status: 'none', category: null, stage: null, headline: null, evidenceQuote: null, sourceUrl: null, sourceDate: null, sourceTier: 'unsourced',
    ageDays: null, valueStated: null, valuePctMcap: null, net: null, components: null, verdict: null,
    returns: inp.returns ? { ...(inp.returns.d1 != null ? { d1: inp.returns.d1, d1Date: inp.returns.d1Date ?? null } : d1FromTail(inp.returns.tail)), w1: inp.returns.w1 ?? w1FromTail(inp.returns.tail), m1: inp.returns.m1, m3: inp.returns.m3, m6: inp.returns.m6, y1: inp.returns.y1, history: inp.returns.history } : null, bandPrint: band.band, bandLevel: band.level, listingDays,
    routine: inWindow.filter((a) => a.kind === 'routine').map((a) => a.subject).slice(0, 6),
    filingsInWindow: inWindow.length, windowDays: inp.windowDays, holding: inp.holding, notes: [], modelRead: !!inp.read && !docExtract0,
    researchedAt: now, sources: inp.sources, news: inp.news ?? null,
  };
  if (band.band) base.notes.push(`Closed at the ${band.level}% band${inp.turnover != null ? ` (avg daily value ~${fmtMoney(inp.turnover, inp.market)}, 1-week average)` : ''} — a band print measures the band, not demand.`);
  const lateSubstantive = afterClose.filter((a) => a.kind === 'catalyst' || a.kind === 'negative' || a.kind === 'denial');
  if (lateSubstantive.length) base.notes.push(`Filed after the session closed, so it cannot explain this move: ${lateSubstantive.slice(0, 2).map((a) => `${short(a.summary || a.subject)} (${fmtDate(a.dateIso)})`).join('; ')}.`);
  if (inp.returns && inp.returns.m1 != null && inp.returns.m3 != null && inp.returns.m1 <= -5 && inp.returns.m3 <= -10) base.notes.push(`Trend context: ${fmtPct(inp.returns.m1)} over 1M and ${fmtPct(inp.returns.m3)} over 3M — today's move is inside a falling trend.`);

  if (inp.sourceFailed && !inWindow.length) return { ...base, status: 'source_failed', notes: [...base.notes, 'The filing source could not be reached — this is not "nothing filed".', ...(inp.news?.narrative ? [`Press coverage (secondary, unverified): ${inp.news.narrative.label.toLowerCase()} story running ${inp.news.narrative.firstDate} → ${inp.news.narrative.lastDate} — “${inp.news.narrative.lead}”.`] : [])] };
  // No price history at all (a name too new for the chart API) plus the
  // paperwork a fresh listing files — Reg 7 / Reg 8(2) / listing intimation
  // — is a recent listing until proven otherwise.
  if (!inp.returns && !hasResult && inWindow.some((a) => /regulation 7\b|regulation 8\(2\)|listing of (equity|shares)|allotment of equity shares pursuant to (the )?(ipo|initial public)|basis of allotment/i.test(`${a.subject} ${a.summary || ''}`))) {
    return { ...base, status: 'listing_artifact', headline: 'No price history and listing paperwork in the window — a recent listing, no comparable prior close', sourceUrl: inWindow[0].url, sourceDate: inWindow[0].dateIso, sourceTier: 'primary' };
  }
  if (listingDays != null) {
    base.notes.push(hasResult
      ? `Recent listing — only ${listingDays} sessions of price history, so there is no comparable prior close and trailing returns mean nothing yet. The filed quarterly result is the context for the move; this is a caveat on it, not a contradiction.`
      : `Only ${listingDays} sessions of price history — a recent listing; trailing returns mean nothing yet.`);
  }

  // Reject-first. A denial or a negative filing in the window is the finding,
  // whatever else was filed alongside it.
  // A denial rejects the move UNLESS a catalyst was filed at or after it:
  // TEGA denied undisclosed information on 18 Sep for the 17 Sep spike, then
  // filed a ₹126 Cr contract later the same day. The contract is the finding
  // and the denial is a note — the earlier spike stays formally denied.
  const denial = inWindow.find((a) => a.kind === 'denial');
  const laterCatalyst = denial && inWindow.some((a) => a.kind === 'catalyst' && (a.dateIso || '') >= (denial.dateIso || ''));
  if (denial && !laterCatalyst) {
    // zzz771: a price-movement clarification is the company CONFIRMING there
    // is no catalyst; a true denial contradicts a reported story.
    const denialKind = denialKindOf(`${denial.subject} ${denial.summary || ''}`);
    return denialKind === 'denial'
      ? { ...base, status: 'denied', denialKind, headline: `Company denied the reported story (${fmtDate(denial.dateIso)}) — ${shorten(denial.summary || denial.subject, 90)}`, sourceUrl: denial.url, sourceDate: denial.dateIso, sourceTier: 'primary', ageDays: denial.ageDays, notes: [...base.notes, 'The company contradicted a specific report while the stock moved — negative evidence for that story, not a catalyst.'] }
      : { ...base, status: 'denied', denialKind, headline: `Company told the exchange it has no undisclosed information (${fmtDate(denial.dateIso)})`, sourceUrl: denial.url, sourceDate: denial.dateIso, sourceTier: 'primary', ageDays: denial.ageDays, notes: [...base.notes, 'Exchange clarification: the company confirmed it has nothing undisclosed — company-confirmed absence of a filed catalyst, not a negative event.'] };
  }
  if (denial) base.notes.push(`Company denied any undisclosed information on ${fmtDate(denial.dateIso)} (exchange query) — that answered an earlier spike; a filing followed.`);
  const isNegCat = (x: unknown) => (NEGATIVE_CATALYSTS as readonly string[]).includes(String(x));
  const hasCatalyst = inWindow.some((a) => a.kind === 'catalyst')
    || (!!inp.read && !isNegCat(inp.read.category) && inWindow.some((a) => a.url === inp.read!.url && a.kind === 'unclassified'));
  // US: an offering filed beside a real catalyst is supply INTO the move — a
  // flag on that catalyst, not a replacement for it. On its own it is the
  // finding. (zzz766)
  const dilution = inp.market === 'US' ? inWindow.find((a) => a.kind === 'negative' && a.category === 'dilution') : undefined;
  let negative = inWindow.find((a) => a.kind === 'negative' && !(a === dilution && hasCatalyst));
  // zzz785 (IN): a tax notice or an exchange fine beside an order is filed
  // news of both kinds — the positive event leads, the negative is a note and
  // stays in the structured facts. VIKRAN: a ₹5.34 Cr GST notice hid a
  // ₹153.76 Cr POWERGRID order filed the same day.
  const alsoNegative = inp.market === 'IN' && negative && hasCatalyst && inWindow.filter((a) => a.kind === 'negative').every(softNegative)
    ? inWindow.filter((a) => a.kind === 'negative') : [];
  if (alsoNegative.length) negative = undefined;
  if (negative && inp.market === 'US') {
    // zzz771: a resale / shelf registration releases existing stock for sale
    // (a supply overhang) and raises nothing new; it is not the move's
    // catalyst and not a negative event. A priced offering is a new raise.
    const resale = negative.category === 'dilution' && /resale|shelf/i.test(negative.routineReason || '');
    const note = negative.category === 'dilution'
      ? (resale ? 'Resale / shelf registration: existing or future stock registered for sale — a supply overhang, not a new raise and not this move\'s catalyst.' : 'An offering is supply into the move: a new raise dilutes holders. Check pricing, size against market cap and named buyers.')
      : 'A negative filing in the window. The move is not explained by it.';
    return { ...base, status: 'negative', category: negative.category, headline: shorten(negative.routineReason || negative.subject, 300), sourceUrl: negative.url, sourceDate: negative.dateIso, sourceTier: 'primary', ageDays: negative.ageDays, valueStated: negative.category === 'dilution' && !resale ? negative.valueStated : null, notes: [...base.notes, note] };
  }
  if (negative) {
    const nd = readDoc(docs, negative.url);
    const nf = nd?.facts.find((f) => f.polarity === 'negative') as IndiaFacts | undefined;
    return { ...base, status: 'negative', category: negative.category, headline: shorten(nf?.headline || negative.summary || negative.subject, 300), evidenceQuote: nf?.quotes[0] ?? null, sourceUrl: negative.url, sourceDate: negative.dateIso, sourceTier: 'primary', ageDays: negative.ageDays,
      valueStated: nf ? factValueCr(nf) : null, valuePctMcap: nf && factValueCr(nf) != null && inp.marketCap ? Math.round((factValueCr(nf)! / inp.marketCap) * 10000) / 100 : null,
      notes: [...base.notes, hasCatalyst ? 'A serious negative filing in the window; the positive filings beside it are listed in the structured facts but do not outweigh it.' : 'The only substantive in-window filing is negative. The move is not explained by it.'] };
  }
  const query = inWindow.find((a) => a.kind === 'exchange_query');

  // The candidate: the freshest catalyst-kind filing, executed before
  // scheduled before enabling, larger stated value first.
  // The candidate is whichever catalyst-kind filing SCORES highest under the
  // same rule the finding is scored by — a ₹279 Cr order two days old beats a
  // same-day rating outlook change, and an executed item beats an enabling
  // one, because the score already says so.
  const cands = inWindow.filter((a) => a.kind === 'catalyst')
    .map((a) => ({ a, s: rankKey(scoreCatalyst(a, { marketCap: inp.marketCap, returns: inp.returns, sourceTier: 'primary', verifiedQuote: false })) }))
    .sort((x, y) => y.s - x.s)
    .map((x) => x.a);
  // A model read of a filing the form type could not classify (US 8-K Item
  // 1.01 / 7.01 / 8.01, 6-K) IS the classification. It used to be paid for and
  // then dropped here, because only catalyst-kind filings were candidates.
  const readItem = inp.read && !cands.length ? inWindow.find((a) => a.url === inp.read!.url && a.kind === 'unclassified') : undefined;
  if (readItem && inp.read) {
    if (isNegCat(inp.read.category)) {
      return { ...base, status: 'negative', category: inp.read.category, headline: inp.read.headline, evidenceQuote: inp.read.quote, sourceUrl: readItem.url, sourceDate: readItem.dateIso, sourceTier: 'primary', ageDays: readItem.ageDays, notes: [...base.notes, 'Model-read filing; the quote was found verbatim in the document. The filing is negative.'] };
    }
    const refined = classifyAnnouncement({ ...readItem, summary: `${inp.read.headline}. ${inp.read.quote}` }, inp.market);
    cands.push({ ...readItem, kind: 'catalyst', category: inp.read.category, stage: refined.stage || 'executed', valueStated: inp.read.valueStated ?? refined.valueStated, incremental: refined.incremental });
  }
  if (listingDays != null && !hasResult) {
    // A recent listing is not a gainer, whatever it filed: there is no
    // comparable prior close, so the return is the listing, not the news.
    return { ...base, status: 'listing_artifact', headline: `Listed ~${listingDays} sessions ago — no comparable prior close${cands.length ? `; filed: ${shorten(cands[0].summary || cands[0].subject, 70)}` : ''}`, sourceUrl: cands[0]?.url || null, sourceDate: cands[0]?.dateIso || null, sourceTier: cands.length ? 'primary' : 'unsourced' };
  }
  if (!cands.length) {
    // A result the graders hold is the context for this move: the finding
    // says so rather than "no filing" beside a filed-result row. (zzz769)
    const resultLead = inp.filedResult ? 'Quarterly result on file — ranked in the filed-results rows of the research queue. ' : '';
    if (resultLead) base.notes.unshift('A results filing is scored by the graded funnel (revenue, PAT, tier), not by this sweep.');
    if (!inWindow.length) return { ...base, status: 'none', headline: resultLead + (afterClose.length ? `No filing before the session closed (${afterClose.length} filed after it)` : `No filing in the last ${inp.windowDays} days`), notes: [...base.notes, ...(query ? [`Exchange query on ${fmtDate(query.dateIso)} — reply pending.`] : [])] };
    const uncl = inWindow.filter((a) => a.kind === 'unclassified');
    const unclRead = uncl.filter((a) => readDoc(docs, a.url));
    const headline = uncl.length
      ? `${inWindow.length} filing${inWindow.length === 1 ? '' : 's'} in window; ${uncl.length} ${unclRead.length === uncl.length ? 'could not be classified even after reading the document' : 'not classifiable from the subject'} (${uncl.slice(0, 2).map((a) => short(a.summary || a.subject)).join('; ')})`
      : `${inWindow.length} filing${inWindow.length === 1 ? '' : 's'} in window, all routine (${base.routine.slice(0, 2).map(short).join('; ')})`;
    return { ...base, status: 'routine_only', headline: resultLead + headline, sourceUrl: (uncl[0] || inWindow[0]).url, sourceDate: (uncl[0] || inWindow[0]).dateIso, ageDays: (uncl[0] || inWindow[0]).ageDays, sourceTier: 'primary', notes: [...base.notes, ...(query ? [`Exchange query on ${fmtDate(query.dateIso)} — reply pending.`] : []), ...(uncl.length ? [unclRead.length === uncl.length ? 'The document was read and names no event this sweep recognises — open it before calling it nothing.' : 'An unclassified filing is worth opening: the subject line was generic and the summary matched no event pattern; its document was not read yet.'] : [])] };
  }
  let c = cands[0];
  // zzz785 (IN): no model read, but the document was read — its verbatim
  // sentence and stated figure verify the candidate the same way.
  const cDoc = readDoc(docs, c.url);
  if (!inp.read && inp.market === 'IN' && cDoc) {
    const f = cDoc.facts.find((x) => x.quotes.length && x.polarity !== 'negative') as IndiaFacts | undefined;
    if (f) inp = { ...inp, read: { url: c.url, headline: f.headline, quote: f.quotes[0], category: (c.category || catalystTypeOf(f) || 'none_identified') as CatalystType, valueStated: c.valueStated ?? factValueCr(f), facts: flatFacts(f), source: 'document_extract' } };
  }
  const docExtract = inp.read?.source === 'document_extract';
  const verified = !!inp.read && inp.read.url === c.url;
  if (verified && inp.read) {
    if (inp.market === 'US' && isNegCat(inp.read.category)) {
      return { ...base, status: 'negative', category: inp.read.category, headline: inp.read.headline, evidenceQuote: inp.read.quote, sourceUrl: c.url, sourceDate: c.dateIso, sourceTier: 'primary', ageDays: c.ageDays, notes: [...base.notes, 'Model-read filing; the quote was found verbatim in the document. The filing is negative.'] };
    }
    // A document extract states its value or none: a revenue sentence's
    // dollar figure is not a deal value (zzz782).
    c = { ...c, category: inp.read.category, valueStated: inp.read.valueStated ?? c.valueStated ?? (docExtract ? null : parseStatedValue(`${inp.read.headline} ${inp.read.quote}`, inp.market)) };
  }
  // zzz775: whatever a reader or a subject line called it, a tax demand is a
  // tax matter (SEDEMAC's "GST order received" was scored as an order win).
  const taxHay = `${c.subject} ${c.summary || ''} ${verified && inp.read ? `${inp.read.headline} ${inp.read.quote}` : ''}`;
  if (isTaxMatter(taxHay) && c.category !== 'tax_litigation') {
    // "₹40,036 demand" is rupees, not crores (SEDEMAC) — a bare rupee sum.
    const bare = inp.market === 'IN' ? /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)(?![\d,.]*\s*(?:crores?|cr\b|lakhs?|lacs?|million|mn\b|billion|bn\b))/i.exec(taxHay) : null;
    const v = parseStatedValue(taxHay, inp.market) ?? (bare ? Math.round((parseFloat(bare[1].replace(/,/g, '')) / 1e7) * 1e6) / 1e6 : null);
    const pctM = v != null && inp.marketCap ? Math.round((v / inp.marketCap) * 10000) / 100 : null;
    if (taxFavourable(taxHay)) {
      return { ...base, status: 'routine_only', headline: verified && inp.read ? inp.read.headline : shorten(c.summary || c.subject, 400), sourceUrl: c.url, sourceDate: c.dateIso, ageDays: c.ageDays, sourceTier: 'primary', notes: [...base.notes, 'A tax matter decided in the company\'s favour — not an operating catalyst.'] };
    }
    return { ...base, status: 'negative', category: 'tax_litigation', headline: verified && inp.read ? inp.read.headline : shorten(c.summary || c.subject, 400), evidenceQuote: verified && inp.read ? inp.read.quote : null, sourceUrl: c.url, sourceDate: c.dateIso, sourceTier: 'primary', ageDays: c.ageDays, valueStated: v, valuePctMcap: pctM,
      notes: [...base.notes, `Tax demand / notice, not an order${v != null ? ` — ${fmtMoney(v, inp.market)}${pctM != null ? ` (${pctM}% of market cap)` : ''}` : ''}${pctM != null && pctM < 1 ? ': immaterial to the company' : ''}. Contested tax is a contingent liability until the appeal ends.`] };
  }
  // zzz775: a GDV / "potential" figure is not the company's value.
  const potentialHay = `${c.subject} ${c.summary || ''} ${verified && inp.read ? `${inp.read.headline} ${inp.read.quote}` : ''}`;
  const potential = c.valueStated != null && isPotentialValue(potentialHay);
  if (potential) c = { ...c, valueStated: null };
  // Debt is financing, whichever reader filed it as a raise. (zzz768 — KUANTUM NCDs)
  const cHay = `${c.subject} ${c.summary || ''} ${verified && inp.read ? inp.read.headline : ''}`;
  if (c.category === 'fundraising' && RX.debtOnly.test(cHay) && !RX.equityWords.test(cHay)) {
    return { ...base, status: 'routine_only', headline: `Debt financing — ${shorten(c.summary || c.subject, 90)}`, sourceUrl: c.url, sourceDate: c.dateIso, ageDays: c.ageDays, sourceTier: 'primary', notes: [...base.notes, 'Borrowing is financing, not a catalyst.'] };
  }
  const scored = scoreCatalyst(c, { marketCap: inp.marketCap, returns: inp.returns, sourceTier: 'primary', verifiedQuote: verified, movePct: inp.movePct });
  // An offering into the move caps the verdict below FIRE (zzz766).
  if (dilution && scored.net > 44.9) { scored.net = 44.9; scored.verdict = 'ROOM'; scored.components.caps = [...(scored.components.caps || []), 'offering filed into the move → capped at 44.9']; }
  const notes = [...base.notes];
  if (potential) notes.push('The figure stated is a gross development value / potential, not the company\'s revenue, share or consideration — materiality is not measured from it.');
  if (c.stage === 'enabling') notes.push('ENABLING, not executed: a board considering something has no size, no price and no counterparty yet.');
  if (c.stage === 'scheduled') notes.push('SCHEDULED, not executed: dated in the future. Nothing has been produced yet.');
  if (!c.incremental) notes.push('Reads as a renewal or re-announcement, not an increment — materiality capped.');
  if (c.category === 'product_qualification' || c.category === 'regulatory_approval') notes.push('Qualification permits work; it books none.');
  if (c.category === 'rating_action' && /reaffirm|affirm/i.test(`${c.subject} ${c.summary || ''}`) && !/upgrad/i.test(`${c.subject} ${c.summary || ''}`)) notes.push('A reaffirmation is not an upgrade.');
  // zzz771: a named institutional / promoter allotment can be the catalyst
  // (ROSSTECH — preferential issue to SBI Mutual Fund); it still adds supply.
  if (c.category === 'fundraising') notes.push('Fundraising adds supply (dilution flag): a named institutional or promoter allottee can still be the catalyst — check price, allottees and use of proceeds.');
  if (c.category === 'quarterly_result' && !verified) notes.push('Results filed — the filing is the dated event; whether the numbers were good was not read here.');
  if (dilution) notes.push(`⚠ Offering filed in the window (${shorten(dilution.subject, 60)}, ${fmtDate(dilution.dateIso)}) — supply into the move.`);
  if (scored.valuePctMcap != null && inp.movePct != null && scored.valuePctMcap < 2 && Math.abs(inp.movePct) >= 8) notes.push(`Item is ${scored.valuePctMcap}% of market cap against a ${fmtPct(inp.movePct)} move — look for the real driver.`);
  if (verified && docExtract) notes.push(inp.market === 'IN'
    ? 'Read without a model: the quote and any figure are copied verbatim from the filed exchange document; anything the document does not state is left unknown.'
    : 'Read without a model: the quote and any figure are sentences copied verbatim from the filed document (press release); the category comes from the SEC form / item code, not from a reading of the text.');
  if ((c as any).docNote) notes.push((c as any).docNote);
  for (const n of alsoNegative) notes.push(`Also filed in the window (negative, does not cancel the event above): ${shorten(n.summary || n.subject, 160)} (${fmtDate(n.dateIso)}).`);
  if (verified && docExtract && c.category === 'quarterly_result') notes.push('Results filed — the revenue sentence is quoted as filed; whether the result was good is not judged here.');
  if (!verified) notes.push(scored.components.evidence === 'SUMMARY_ONLY'
    ? 'SUMMARY ONLY: the document was not model-read; the headline and any figure come from the source\'s summary, so materiality is counted at 60%.'
    : 'UNVERIFIED: only the filing subject line was available; materiality is counted at 40%.');
  return {
    ...base, status: 'catalyst', category: c.category, stage: c.stage,
    headline: verified && inp.read ? inp.read.headline : shorten(c.summary || c.subject, 400),
    evidenceQuote: verified && inp.read ? inp.read.quote : null,
    sourceUrl: c.url, sourceDate: c.dateIso, sourceTier: 'primary', ageDays: c.ageDays,
    valueStated: c.valueStated, valuePctMcap: scored.valuePctMcap, net: scored.net, components: scored.components, verdict: scored.verdict,
    notes, facts: verified && inp.read ? (inp.read.facts ?? null) : null,
    ...(verified && docExtract ? { docExtract: true } : {}),
  };
}

/** zzz785: a fact trimmed for storage — the day's state is one KV value. */
function compactFact<T extends StructuredFacts>(f: T): T {
  return { ...f, quotes: f.quotes.slice(0, 2).map((q) => q.slice(0, 260)), unknowns: f.unknowns.slice(0, 5), source: { ...f.source, title: String(f.source.title || '').slice(0, 140) } };
}

/** zzz785: structured facts, source refs, evidence gap and breadth — built
 *  from what the sweep read; never from price. */
function decorateFinding(f: Finding, inp: SweepInput): Finding {
  const { idx, all } = classifyWindow(inp);
  const inWindow = all.filter((a) => !filedAfterClose(a.dateIso, inp.sessionCloseIso));
  const issuer = inp.ticker;
  // Facts: every event in every document read (current and related history), deduplicated by document hash + kind.
  const seen = new Set<string>();
  const facts: StructuredFacts[] = [];
  for (const d of inp.docs || []) {
    if (d.access !== 'DOCUMENT_READ') continue;
    for (const x of d.facts) {
      const k = `${x.source.hash || d.hash || d.url}|${x.event.kind}`;
      if (seen.has(k)) continue;
      seen.add(k); facts.push(compactFact(x));
    }
  }
  for (const x of inp.extraFacts || []) facts.push(x);
  // Source refs: every in-window filing with how it was accessed.
  const refs: SourceRef[] = [];
  const refSeen = new Set<string>();
  const pushRef = (r: SourceRef) => { const k = r.hash || r.url || r.title; if (refSeen.has(k)) return; refSeen.add(k); refs.push(r); };
  const folderOf = (u: string | null | undefined) => (u && /sec\.gov\/Archives\//i.test(u) ? u.replace(/[^/]*$/, '').toLowerCase() : null);
  const usOpened = new Set(inp.market === 'US' ? (inp.extraRefs || []).filter((r) => r.access === 'DOCUMENT_READ').map((r) => folderOf(r.url)).filter(Boolean) as string[] : []);
  const opened = (u: string | null | undefined) => !!readDoc(idx, u) || (!!folderOf(u) && usOpened.has(folderOf(u)!));
  for (const a of inWindow) {
    if (usOpened.size && opened(a.url)) continue;   // the document refs below stand for this filing (one ref per document)
    const d = readDoc(idx, a.url);
    if (!d && a.kind === 'routine') continue;   // paperwork is counted in \`routine\`, not listed as a source
    const attributed = d?.facts.some((x) => x.source.kind === 'SUBSIDIARY_FILING');
    pushRef({ kind: inp.market === 'US' ? 'SEC_FILING' : attributed ? 'SUBSIDIARY_FILING' : 'EXCHANGE_FILING', access: d ? 'DOCUMENT_READ' : 'SUMMARY_ONLY', issuer, date: a.dateIso, accession: docSeqOf(a.url), url: a.url, title: String(a.subject || '').slice(0, 140), hash: d?.hash ?? null });
  }
  for (const d of inp.docs || []) if (d.relation === 'history' && d.access === 'DOCUMENT_READ') {
    pushRef({ kind: d.facts.some((x) => x.source.kind === 'SUBSIDIARY_FILING') ? 'SUBSIDIARY_FILING' : 'EXCHANGE_FILING', access: 'DOCUMENT_READ', issuer, date: d.date, accession: d.seq, url: d.url, title: `Earlier related filing: ${String(d.title || '').slice(0, 120)}`, hash: d.hash });
  }
  for (const r of inp.extraRefs || []) pushRef(r);
  if (inp.secondaryUnavailable) pushRef({ kind: 'EXCHANGE_FILING', access: 'SECONDARY_UNAVAILABLE', issuer, date: null, url: null, title: `Secondary source unavailable: ${inp.secondaryUnavailable}` });
  // Press: secondary, verification required; confirmed-by an official filing of the same event.
  let news = f.news ?? null;
  if (news && news.items?.length) {
    const p = pressFacts(news, issuer, facts);
    news = p.news;
    for (const x of p.facts) facts.push(x);
    for (const r of p.refs.slice(0, 4)) pushRef(r);
  }
  const breadth = evidenceBreadthOf(facts, refs);
  // Evidence gap — three different states, never merged.
  const uncl = inWindow.filter((a) => a.kind === 'unclassified');
  const substantiveRead = (url: string | null) => opened(url) || !!(url && inp.read && inp.read.url === url);
  let gap: Finding['evidenceGap'] = null;
  if (f.status === 'none') gap = 'NO_CATALYST';
  else if (f.status === 'routine_only') gap = !uncl.length ? 'NO_CATALYST' : uncl.every((a) => opened(a.url)) ? 'UNCLASSIFIED' : 'EVIDENCE_INCOMPLETE';
  else if (f.status === 'catalyst' || f.status === 'negative') gap = f.evidenceQuote || substantiveRead(f.sourceUrl) ? null : 'EVIDENCE_INCOMPLETE';
  // US: a reported event nobody has confirmed (press / an unread stake) is unknown, not "no catalyst".
  if (inp.market === 'US' && gap === 'NO_CATALYST' && facts.some((x) => x.verificationRequired && !['results', 'governance', 'other', 'debt'].includes(x.event.kind))) gap = 'EVIDENCE_INCOMPLETE';
  const notes = [...f.notes];
  if (inp.market === 'IN') {
    const read = (inp.docs || []).filter((d) => d.access === 'DOCUMENT_READ');
    const failed = (inp.docs || []).filter((d) => d.access !== 'DOCUMENT_READ');
    if (read.length) notes.push(`Documents read: ${read.length} (${read.filter((d) => d.relation !== 'history').length} in the window${read.some((d) => d.relation === 'history') ? `, ${read.filter((d) => d.relation === 'history').length} earlier related` : ''}).${failed.length ? ` ${failed.length} could not be opened.` : ''}`);
    else if (failed.length) notes.push(`${failed.length} document${failed.length === 1 ? '' : 's'} could not be opened — the finding rests on the filing summaries.`);
    for (const x of facts as IndiaFacts[]) {
      if (x.fundMateriality && x.fundMateriality.state === 'UNKNOWN' && x.relation !== 'history') notes.push(`Fundraise materiality: Unknown — not stated in the document: ${x.fundMateriality.missing.join(', ')}.`);
      if (x.attribution && x.relation !== 'history' && f.status === 'catalyst' && x.source.url === f.sourceUrl) notes.push(`Carried out by the subsidiary ${x.attribution.entity}; counted for the listed parent ${issuer}.`);
    }
    const hist = (facts as IndiaFacts[]).filter((x) => x.relation === 'history');
    if (hist.length) notes.push(`Continues earlier filings: ${hist.slice(0, 3).map((x) => `${fmtDate(x.source.date)} — ${shorten(x.headline || x.event.kind, 110)}`).join('; ')}.`);
    if (inp.secondaryUnavailable) notes.push(`Secondary source unavailable (${inp.secondaryUnavailable}); the exchange filings were read directly.`);
  }
  return { ...f, notes: Array.from(new Set(notes)), news, structuredFacts: facts.slice(0, 10), sourceRefs: refs.slice(0, 12), evidenceGap: gap, evidenceBreadth: breadth };
}

/** zzz773: screener.in's five newest filings plus BSE's complete list for the
 *  window, one row per filing. The screener row wins a tie (it carries
 *  screener's summary); a BSE row the screener list lacks is added. */
export function mergeAnnouncements(primary: AnnouncementLite[], extra: AnnouncementLite[]): AnnouncementLite[] {
  const norm = (a: AnnouncementLite) => `${String(a.dateIso || '').slice(0, 10)}|${String(a.subject || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)}`;
  const seen = new Map<string, AnnouncementLite>();
  const out: AnnouncementLite[] = [];
  for (const a of primary) { const k = norm(a); if (!seen.has(k)) { seen.set(k, a); out.push(a); } }
  for (const b of extra) {
    const k = norm(b);
    const hit = seen.get(k);
    if (hit) { if (!hit.summary && b.summary) hit.summary = b.summary; continue; }
    seen.set(k, b); out.push(b);
  }
  return out.sort((x, y) => String(y.dateIso || '').localeCompare(String(x.dateIso || '')));
}

/** A finding keeps its research but takes the latest move: the band flag and
 *  its note are recomputed from the new close. (zzz766) */
export function refreshFindingMove(f: Finding, movePct: number | null): Finding {
  const band = bandPrint(movePct, f.turnover, f.market);
  const notes = f.notes.filter((n) => !/^Closed at the \d+% band/.test(n));
  if (band.band) notes.unshift(`Closed at the ${band.level}% band${f.turnover != null ? ` (avg daily value ~${fmtMoney(f.turnover, f.market)}, 1-week average)` : ''} — a band print measures the band, not demand.`);
  return { ...f, movePct, bandPrint: band.band, bandLevel: band.level, notes };
}

// ── helpers ────────────────────────────────────────────────────────────────

export function shorten(s: string, max = 110): string {
  const t = s.replace(/\s+/g, ' ').replace(/^announcement under regulation 30 \(lodr\)-?/i, '').replace(/_/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s\S*$/, '') + '…' : t;
}
const short = (s: string) => shorten(s, 80);
export function fmtPct(v: number | null): string { return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`; }
export function fmtDate(iso: string | null): string { return iso ? iso.slice(0, 10) : 'undated'; }
export function fmtMoney(v: number, market: 'IN' | 'US'): string { if (market === 'IN' && v > 0 && v < 0.1) return v < 0.01 ? `₹${Math.round(v * 1e7).toLocaleString('en-IN')}` : `₹${(v * 100).toFixed(1)} lakh`; return market === 'IN' ? `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1)} Cr` : fmtUsdM(v); }

/** Coverage line, computed from findings so it cannot lie. */
export function coverage(findings: Record<string, Finding>, universe: string[]): { researched: number; total: number; pct: number; byStatus: Record<string, number> } {
  const by: Record<string, number> = {};
  let researched = 0;
  for (const t of universe) {
    const f = findings[t];
    const s = f?.status || 'unresearched';
    by[s] = (by[s] || 0) + 1;
    if (f && s !== 'unresearched') researched++;
  }
  return { researched, total: universe.length, pct: universe.length ? Math.round((researched / universe.length) * 100) : 0, byStatus: by };
}

// ── 5. RE-SCORING WITHOUT A MODEL  (zzz769) ─────────────────────────────────

/** What a sweep fetched for one name, kept beside the finding so a rules
 *  change re-scores the day from the same inputs — no refetch, no model. */
export interface StoredSweepInputs {
  announcements: AnnouncementLite[];
  returns: Returns | null;
  marketCap: number | null;
  turnover: number | null;
  sources: string[];
  sourceFailed: boolean;
  /** The instant the inputs were fetched: freshness is re-scored against it. */
  fetchedAt: string;
  read?: SweepInput['read'];
  news?: NewsContext | null;
  /** zzz782 (US): what EDGAR said about the name (not checked / checked +
   *  insider-form count), re-attached to the finding on every re-score. */
  usNote?: string | null;
  /** zzz782 (US): the free press-release read was already attempted. */
  docTried?: boolean;
  /** zzz785 (IN): the documents read — kept compact (see compactDocs). */
  docs?: DocRead[] | null;
  secondaryUnavailable?: string | null;
  /** zzz785 (US): facts / refs read from SEC documents and press, already compact. */
  extraFacts?: StructuredFacts[] | null;
  extraRefs?: SourceRef[] | null;
}

/** Keeps only what a finding can use (the window, a bounded summary): the
 *  day's state is one KV value and must stay well under its size limit. */
export function compactInputs(inp: Omit<StoredSweepInputs, 'announcements'> & { announcements: AnnouncementLite[] }, windowDays: number, now: Date): StoredSweepInputs {
  const announcements = inp.announcements
    .map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, now) }))
    .filter((a) => a.ageDays == null || a.ageDays <= windowDays)
    .slice(0, 25)
    .map((a) => ({ subject: String(a.subject || '').slice(0, 300), summary: a.summary ? String(a.summary).slice(0, 400) : null, url: a.url, dateIso: a.dateIso, ageDays: a.ageDays }));
  // zzz785: documents keep their facts (trimmed) — a re-score re-reads nothing.
  const docs = inp.docs ? inp.docs.slice(0, 6).map((d) => ({ ...d, title: String(d.title || '').slice(0, 160), valuesSeen: d.valuesSeen.slice(0, 12), facts: d.facts.slice(0, 2).map((f) => ({ ...compactFact(f), quotes: f.quotes.slice(0, 1).map((q) => q.slice(0, 260)), unknowns: f.unknowns.slice(0, 3) })) })) : inp.docs;
  return { ...inp, announcements, ...(docs !== undefined ? { docs } : {}) };
}

/** The filing a sweep would model-read — the same candidate the finding
 *  scores, plus (US) an 8-K/6-K item only a read can classify. */
export function pickReadCandidate(announcements: AnnouncementLite[], market: 'IN' | 'US', opts: { marketCap: number | null; returns: Returns | null; windowDays: number; now: Date; sessionCloseIso?: string | null }): ClassifiedAnnouncement | null {
  const c = chooseCandidate(announcements, market, opts);
  if (c || market !== 'US') return c;
  const inWindow = announcements.map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, opts.now) })).filter((a) => a.ageDays == null || a.ageDays <= opts.windowDays);
  return inWindow.map((a) => classifyAnnouncement(a, market)).find((x) => x.kind === 'unclassified' && (/item (1\.0[12]|2\.01|7\.01|8\.01)/i.test(x.subject) || /^6-K/i.test(x.subject))) || null;
}

/** A finding rebuilt from stored inputs under the CURRENT rules. Pure: the
 *  caller supplies any model read, and only from cache. */
export function rescoreFromInputs(inp: StoredSweepInputs, meta: { ticker: string; company: string | null; market: 'IN' | 'US'; movePct: number | null; holding: boolean; filedResult?: boolean; windowDays: number; sessionCloseIso?: string | null }, read: SweepInput['read'] = inp.read ?? null): Finding {
  const now = new Date(inp.fetchedAt);
  const f = buildFinding({
    ticker: meta.ticker, company: meta.company, market: meta.market, movePct: meta.movePct, marketCap: inp.marketCap, turnover: inp.turnover,
    announcements: inp.announcements, returns: inp.returns, holding: meta.holding, sources: inp.sources, sourceFailed: inp.sourceFailed, news: inp.news ?? null,
    docs: inp.docs ?? null, secondaryUnavailable: inp.secondaryUnavailable ?? null, extraFacts: inp.extraFacts ?? null, extraRefs: inp.extraRefs ?? null,
    windowDays: meta.windowDays, now: Number.isFinite(now.getTime()) ? now : new Date(), read, sessionCloseIso: meta.sessionCloseIso, filedResult: meta.filedResult,
  });
  return { ...f, rulesVersion: RULES_VERSION };
}

/** Findings built under older rules — the ones an automatic re-score redoes. */
export function staleRuleTickers(findings: Record<string, Finding>, universe: string[]): string[] {
  return universe.filter((t) => { const f = findings[t]; return !!f && f.status !== 'unresearched' && f.rulesVersion !== RULES_VERSION; });
}
