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
  // zzz835 - SEC identity kept beside the accession (all optional)
  cik?: string | null;          // issuer CIK (unpadded)
  formType?: string | null;     // '8-K', '10-Q' …
  exhibit?: string | null;      // '99.1' when the facts came from an exhibit; null / absent = the filing body
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
  /** zzz836: a finer type than `kind` ('regulatory_inspection' = a regulator's inspection / Form 483 / observations, NOT an approval). kind stays 'other'. */
  eventType?: string;
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

// ═══════════════════════════════════════════════════════════════════════════
// zzz835 — CLASSIFICATION, NUMERIC PARSING AND STATUS LOGIC (shared, pure).
//
// Everything below is additive: no existing shape changes. Rules encoded:
//   · a number is parsed with its sign, unit and ORIGINAL TEXT beside it;
//     a range is {low, high}, never a negative second number
//   · a guidance growth % exists only when the periods match
//   · a headline value never replaces a filed value — both are kept and a
//     conflict is shown; the impact is then unknown, not guessed
//   · a proposed / LOI / tentative event is never booked or firm
//   · a document read and an event confirmed are two separate facts
//   · older items are context only; "today" is the exchange calendar's
// ═══════════════════════════════════════════════════════════════════════════

// ── typed numbers ───────────────────────────────────────────────────────

export type NumUnit = 'percent' | 'bps' | 'usd' | 'inr' | 'count';
export type Magnitude = 'K' | 'M' | 'B' | 'lakh' | 'crore' | null;

export interface ParsedNumber {
  /** The text exactly as written ("$323M", "Rs. 2.13 billion", "(0.12)"). */
  raw: string;
  /** Signed value in the unit as written (28 for "28%", 323 for "$323M", -0.12 for "(0.12)"). */
  value: number;
  unit: NumUnit;
  magnitude: Magnitude;
  currency: 'USD' | 'INR' | null;
  /** Full amount in currency units ($323M → 323_000_000; Rs 213.48 crore → 2_134_800_000). null for percent / bps / count. */
  absolute: number | null;
}

export interface ParsedRange {
  raw: string;
  /** Smaller and larger end (signed). */
  low: number;
  high: number;
  lowText: string;
  highText: string;
  unit: NumUnit;
  magnitude: Magnitude;
  currency: 'USD' | 'INR' | null;
  absoluteLow: number | null;
  absoluteHigh: number | null;
  /** Both ends in the order written, each with its own text and sign. */
  ends: [ParsedNumber, ParsedNumber];
}

const NEG_SIGN = '-−–';
const CUR_RX = String.raw`(?:US\$|\$|₹|Rs\.?|INR)`;
const WORD_MAG = String.raw`(?:billions?|bn|millions?|mm|mn|thousand|crores?|cr|lakhs?|lacs?)`;

function magOf(u: string | undefined | null, hasCur: boolean): { mag: Magnitude; mult: number } {
  const x = String(u || '').toLowerCase();
  if (!x) return { mag: null, mult: 1 };
  if (/^(billion|bn)/.test(x)) return { mag: 'B', mult: 1e9 };
  if (/^(million|mm|mn)/.test(x)) return { mag: 'M', mult: 1e6 };
  if (/^thousand/.test(x)) return { mag: 'K', mult: 1e3 };
  if (/^crore|^cr$/.test(x)) return { mag: 'crore', mult: 1e7 };
  if (/^(lakh|lac)/.test(x)) return { mag: 'lakh', mult: 1e5 };
  if (hasCur && x === 'b') return { mag: 'B', mult: 1e9 };
  if (hasCur && x === 'm') return { mag: 'M', mult: 1e6 };
  if (hasCur && x === 'k') return { mag: 'K', mult: 1e3 };
  return { mag: null, mult: 1 };
}

// one amount token: [sign][currency][sign]number[unit]; parentheses = negative
const AMT_SRC = String.raw`([${NEG_SIGN}+]|\()?\s?(${CUR_RX})?\s?([${NEG_SIGN}+]|\()?\s?(\d[\d,]*(?:\.\d+)?|\.\d+)\s?(?:(${WORD_MAG})\b|(%|percent\b|per cent\b|basis[- ]points?\b|bps\b|[MBK]\b))?\)?`;

function buildNumber(m: RegExpExecArray, base: number, forceNeg?: boolean): ParsedNumber | null {
  const cur = m[base + 1] || null;
  const num = parseFloat(m[base + 3].replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const s1 = m[base] || '', s2 = m[base + 2] || '';
  const negative = forceNeg === true || /[-−–(]/.test(s1) || /[-−–(]/.test(s2);
  const wordMag = m[base + 4] || null;
  const tail = m[base + 5] || null;
  let unit: NumUnit; let currency: 'USD' | 'INR' | null = null; let magnitude: Magnitude = null; let absolute: number | null = null;
  const value = negative ? -num : num;
  if (tail && /^(%|percent|per cent)/i.test(tail)) unit = 'percent';
  else if (tail && /^(basis|bps)/i.test(tail)) unit = 'bps';
  else if (cur) {
    currency = /^(₹|rs|inr)/i.test(cur) ? 'INR' : 'USD';
    unit = currency === 'INR' ? 'inr' : 'usd';
    const g = magOf(wordMag || tail, true);
    magnitude = g.mag;
    absolute = value * g.mult;
  } else if (wordMag) {
    // a bare crore / lakh / million is an amount only when a currency marks it — else a count
    unit = 'count';
    magnitude = magOf(wordMag, false).mag;
  } else unit = 'count';
  return { raw: m[0].trim(), value, unit, magnitude, currency, absolute };
}

/** First number in the text, with sign, unit and original text. "(0.12)" and
 *  "-$0.12" are negative; "28-30%" is NOT read as -30. */
export function parseAmount(text: string): ParsedNumber | null {
  const rx = new RegExp(AMT_SRC, 'i');
  const s = String(text || '');
  const m = rx.exec(s);
  if (!m) return null;
  // a hyphen glued to the digit of a preceding digit ("28-30") is a separator, not a sign
  const before = s.slice(0, m.index);
  const glued = /\d\s?$/.test(before) && /^[-−–]/.test(m[0]);
  const one = buildNumber(m, 1, glued ? false : undefined);
  // the first end of a range shares the unit stated once at the end ("28–30%")
  if (one && (one.unit === 'count' || (one.absolute != null && one.magnitude == null))) {
    const r = parseRange(s.slice(m.index));
    if (r && r.unit !== 'count' && s.slice(m.index).trim().startsWith(r.raw.slice(0, 1))) return r.ends[0];
  }
  return one;
}

/** Every number in the text, in order. Range ends are separate entries. */
export function parseAllAmounts(text: string): ParsedNumber[] {
  const s = String(text || '');
  const rx = new RegExp(AMT_SRC, 'gi');
  const out: ParsedNumber[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s))) {
    if (!m[0].trim()) { rx.lastIndex++; continue; }
    const before = s.slice(0, m.index);
    const glued = /\d\s?$/.test(before) && /^[-−–]\s?\d/.test(m[0]);
    const n = buildNumber(m, 1, glued ? false : undefined);
    if (n) out.push(n);
  }
  return out;
}

const SEP = String.raw`\s?(?:to|and|through|thru|[-−–—])\s?`;
const RANGE_SRC = String.raw`([${NEG_SIGN}+]|\()?\s?(${CUR_RX})?\s?([${NEG_SIGN}+]|\()?\s?(\d[\d,]*(?:\.\d+)?)\s?(?:(${WORD_MAG})\b|(%|percent\b|per cent\b|basis[- ]points?\b|bps\b|[MBK]\b))?\)?${SEP}([${NEG_SIGN}+]|\()?\s?(${CUR_RX})?\s?([${NEG_SIGN}+]|\()?\s?(\d[\d,]*(?:\.\d+)?)\s?(?:(${WORD_MAG})\b|(%|percent\b|per cent\b|basis[- ]points?\b|bps\b|[MBK]\b))?\)?`;

/** A range "28–30%", "$323M–$328M", "Rs 10 to 12 crore", "-5% to -3%" as {low, high}. Keeps the original text. Returns null when the text has no range. */
export function parseRange(text: string): ParsedRange | null {
  const s = String(text || '');
  const m = new RegExp(RANGE_SRC, 'i').exec(s);
  if (!m) return null;
  // shared unit / currency: "28–30%" and "$323–328 million" state it once
  const curA = m[2] || m[8] || null;
  const tailA = m[6] || null, tailB = m[12] || null;
  const wordA = m[5] || null, wordB = m[11] || null;
  const mk = (sign1: string | undefined, sign2: string | undefined, num: string, cur: string | null, word: string | null, tail: string | null): ParsedNumber | null => {
    const fake = [`${sign1 || ''}${cur || ''}${sign2 || ''}${num}${word ? ` ${word}` : ''}${tail || ''}`, sign1, cur, sign2, num, word, tail] as unknown as RegExpExecArray;
    return buildNumber(fake, 1);
  };
  const wordShared = wordB || wordA, tailShared = tailB || tailA;
  const a = mk(m[1], m[3], m[4], curA, wordA || wordShared, tailA || tailShared);
  const b = mk(m[7], m[9], m[10], m[8] || curA, wordB || wordShared, tailB || tailShared);
  if (!a || !b) return null;
  // two bare counts joined by a hyphen are not a range worth typing (dates, "10-2" votes): need a unit
  if (a.unit === 'count' && b.unit === 'count') return null;
  const lo = Math.min(a.value, b.value), hi = Math.max(a.value, b.value);
  const loN = a.value <= b.value ? a : b, hiN = a.value <= b.value ? b : a;
  return {
    raw: m[0].trim(), low: lo, high: hi, lowText: loN.raw, highText: hiN.raw,
    unit: b.unit, magnitude: b.magnitude, currency: b.currency,
    absoluteLow: loN.absolute, absoluteHigh: hiN.absolute, ends: [a, b],
  };
}

/** Canonical money: ₹ in crore with the full rupee amount; $ in millions. */
export interface Money {
  value: number;
  unit: 'INR_CRORE' | 'USD_M';
  normalized_inr?: number;
  normalized_usd?: number;
  raw: string;
}
export function toMoney(n: ParsedNumber | null): Money | null {
  if (!n || n.absolute == null || n.currency == null) return null;
  if (n.currency === 'INR') return { value: n.absolute / 1e7, unit: 'INR_CRORE', normalized_inr: n.absolute, raw: n.raw };
  return { value: n.absolute / 1e6, unit: 'USD_M', normalized_usd: n.absolute, raw: n.raw };
}

// ── periods and typed metrics ───────────────────────────────────────────

export interface PeriodBasis {
  kind: 'quarter' | 'half' | 'year' | 'ttm' | 'unknown';
  label: string;
  fiscalYear: number | null;
  quarter: number | null;
}
const yr = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n < 100 ? 2000 + n : n;
};
const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };
/** The period a sentence talks about: quarter / half / fiscal year / trailing twelve months. */
export function periodBasisOf(text: string | null | undefined): PeriodBasis {
  const t = String(text || '');
  if (/\btrailing[- ]twelve[- ]months?\b|\blast twelve months\b|\bTTM\b|\bLTM\b|\btwelve months ended\b/i.test(t)) return { kind: 'ttm', label: 'trailing twelve months', fiscalYear: null, quarter: null };
  const q = /\b(?:Q([1-4])|(first|second|third|fourth) (?:fiscal )?quarter)\b(?:\s+(?:of\s+)?(?:fiscal(?: year)?\s+|FY\s?)?'?(\d{4}|\d{2})\b)?/i.exec(t);
  if (q) {
    const qn = q[1] ? parseInt(q[1], 10) : ORD[String(q[2]).toLowerCase()];
    const fy = yr(q[3]) ?? yr((/\b(?:fiscal(?: year)?|FY)\s?'?(\d{4}|\d{2})\b/i.exec(t) || [])[1]);
    return { kind: 'quarter', label: `Q${qn}${fy ? ` FY${fy}` : ''}`, fiscalYear: fy, quarter: qn };
  }
  const h = /\b(first|second) half\b|\bH([12])\b/i.exec(t);
  if (h) {
    const hn = h[2] ? parseInt(h[2], 10) : ORD[String(h[1]).toLowerCase()];
    const fy = yr((/\b(?:fiscal(?: year)?|FY)\s?'?(\d{4}|\d{2})\b/i.exec(t) || [])[1]);
    return { kind: 'half', label: `H${hn}${fy ? ` FY${fy}` : ''}`, fiscalYear: fy, quarter: hn };
  }
  const y = /\b(?:full[- ]year|fiscal(?: year)?|FY\s?|year ended)\s*'?(\d{4}|\d{2})?\b/i.exec(t);
  if (y) { const fy = yr(y[1]); return { kind: 'year', label: fy ? `FY${fy}` : 'full year', fiscalYear: fy, quarter: null }; }
  return { kind: 'unknown', label: 'period not stated', fiscalYear: null, quarter: null };
}

export type MetricName =
  | 'revenue_growth' | 'net_income_growth' | 'operating_income_growth' | 'ebitda_growth' | 'eps_growth' | 'bookings_growth'
  | 'gross_margin' | 'operating_margin' | 'net_margin' | 'ebitda_margin' | 'margin'
  | 'margin_change' | 'net_income' | 'revenue' | 'eps' | 'other';

export interface TypedMetric {
  name: MetricName;
  /** Signed value (a decline is negative). For a range: the midpoint is not used — see low / high. */
  value: number;
  low: number | null;
  high: number | null;
  unit: NumUnit;
  direction: 'growth' | 'decline' | 'level';
  /** Guidance / target wording ("targets", "expects", "outlook") rather than a reported result. */
  forward: boolean;
  period: string | null;
  comparisonPeriod: string | null;
  /** The number exactly as written. */
  raw: string;
  sourceQuote: string;
}

const NOUNS: Array<[RegExp, string]> = [
  [/net (?:income|earnings|profit)|profit after tax|\bPAT\b|net loss/i, 'net_income'],
  [/operating (?:income|profit)|\bEBIT\b/i, 'operating_income'],
  [/(?:adjusted )?EBITDA(?! margin)/i, 'ebitda'],
  [/gross margins?/i, 'gross_margin'],
  [/operating margins?/i, 'operating_margin'],
  [/net (?:profit |loss )?margins?/i, 'net_margin'],
  [/(?:adjusted )?EBITDA margins?/i, 'ebitda_margin'],
  [/margins?/i, 'margin'],
  [/(?:diluted )?(?:EPS|earnings per (?:diluted )?share)/i, 'eps'],
  [/bookings|backlog|order book/i, 'bookings'],
  [/(?:total |net )?(?:revenues?|net sales|sales|top[- ]line)/i, 'revenue'],
];
const CHANGE_UP = /\b(?:up|increas\w*|grew|grow\w*|rose|rise\w*|jump\w*|soar\w*|surg\w*|climb\w*|gain\w*|higher|improv\w*|expan\w*|widen\w*)\b|\+/i;
const CHANGE_DOWN = /\b(?:down|decreas\w*|declin\w*|fell|fall\w*|drop\w*|lower|reduc\w*|shrank|contract\w*|narrow\w*)\b/i;
const FORWARD = /\b(?:targets?|expects?|expected|guidance|outlook|forecast\w*|anticipates?|aims?|projects?|guides?|guided|plans?)\b/i;

function metricNameFor(noun: string, mode: 'growth' | 'level' | 'margin_change'): MetricName {
  if (noun.endsWith('_margin') || noun === 'margin') return mode === 'margin_change' ? 'margin_change' : (noun as MetricName);
  if (mode === 'growth') return `${noun}_growth` as MetricName;
  return (noun === 'net_income' || noun === 'revenue' || noun === 'eps' ? noun : 'other') as MetricName;
}

/** Typed metrics in one sentence. "net income up 154.9%" is net_income_growth (not margin, not revenue growth); "targets 28–30% revenue growth" is a forward revenue_growth range 28..30; "margin was 7.3%" is a margin LEVEL. Only from the text. */
export function extractMetrics(sentence: string): TypedMetric[] {
  const s = String(sentence || '').replace(/\s+/g, ' ');
  const out: TypedMetric[] = [];
  const pct = new RegExp(String.raw`([${NEG_SIGN}+])?\s?(\d[\d,]*(?:\.\d+)?)\s?(?:(?:[-−–—]|to|and)\s?([${NEG_SIGN}+])?\s?(\d[\d,]*(?:\.\d+)?)\s?)?(%|percent\b|basis[- ]points?\b|bps\b)`, 'gi');
  let prevEnd = 0; let m: RegExpExecArray | null;
  const period = periodBasisOf(s);
  while ((m = pct.exec(s))) {
    const seg = s.slice(prevEnd, m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 48).split(/[;.]|\band\b(?=[^%]*\d+(?:\.\d+)?\s?%)/i)[0];
    const glued = /\d\s?$/.test(s.slice(0, m.index)) && /^[-−–]/.test(m[0]);
    prevEnd = m.index + m[0].length;
    const unit: NumUnit = /^(basis|bps)/i.test(m[5]) ? 'bps' : 'percent';
    const explicitNeg = !glued && !!m[1] && /[-−–]/.test(m[1]);
    const explicitPos = !glued && m[1] === '+';
    const isRange = m[4] != null;
    let a = parseFloat(m[2].replace(/,/g, '')); let b = isRange ? parseFloat(m[4].replace(/,/g, '')) : null;
    // nearest noun: the last one in the text before the number, else the first after it
    const findNoun = (txt: string, last: boolean): { key: string; at: number } | null => {
      let best: { key: string; at: number; len: number } | null = null;
      for (const [rx, key] of NOUNS) {
        const g = new RegExp(rx.source, 'gi'); let x: RegExpExecArray | null;
        while ((x = g.exec(txt))) {
          const cand = { key, at: x.index, len: x[0].length };
          // longer / later match wins ("EBITDA margin" over "margin")
          if (!best || (last ? (x.index + x[0].length > best.at + best.len || (x.index + x[0].length === best.at + best.len && x[0].length > best.len)) : (x.index < best.at || (x.index === best.at && x[0].length > best.len)))) best = cand;
        }
      }
      return best;
    };
    const segTail = seg.slice(-90);
    const nBefore = findNoun(segTail, true);
    const nAfter = findNoun(after, false);
    // words between the noun and the number, and right after the number
    const between = nBefore ? segTail.slice(nBefore.at) : segTail;
    const up = CHANGE_UP.test(between) || CHANGE_UP.test(after.slice(0, 24)) || explicitPos;
    const down = CHANGE_DOWN.test(between) || CHANGE_DOWN.test(after.slice(0, 24));
    const growthWord = /\bgrowth\b|\bchange\b/i.test(between) || /^\s*(?:[a-z]+\s+){0,2}(?:growth|increase|decline|decrease)\b/i.test(after);
    // "X% revenue growth" (noun after): pick the after noun when the number is not preceded by a same-clause noun
    const useAfter = !!nAfter && (!nBefore || /^\s*(?:year[- ]over[- ]year |yoy |annual |annualized )?(?:revenues?|sales|net income|net earnings|profit|EBITDA|EPS|bookings)/i.test(after));
    const noun = (useAfter ? nAfter : nBefore)?.key || null;
    if (!noun) continue;
    const isMarginNoun = noun === 'margin' || noun.endsWith('_margin');
    let mode: 'growth' | 'level' | 'margin_change' = 'level';
    if (isMarginNoun) mode = (up || down) && (unit === 'bps' || /\b(?:expan\w*|improv\w*|compress\w*|contract\w*|widen\w*|narrow\w*|increase\w*|decline\w*)\b/i.test(between)) ? 'margin_change' : 'level';
    else if (up || down || growthWord) mode = 'growth';
    else if (noun === 'revenue' && FORWARD.test(seg)) mode = 'level';
    if (mode === 'level' && (explicitNeg || explicitPos) && unit === 'percent' && (noun === 'revenue' || noun === 'net_income' || noun === 'eps')) mode = 'growth';
    if (mode === 'level' && !isMarginNoun && noun !== 'revenue' && noun !== 'net_income' && noun !== 'eps') continue;
    let sign = 1;
    if (explicitNeg) sign = -1;
    else if (!explicitPos && down && !up) sign = -1;
    else if (mode === 'growth' && down && up) sign = /\b(?:down|decreas\w*|declin\w*|fell|drop\w*)\b/i.test(between) ? -1 : 1;
    if (mode === 'level' && /net loss margin/i.test(segTail)) sign = -1;
    a *= sign; if (b != null) b *= sign;
    const lo = b != null ? Math.min(a, b) : null, hi = b != null ? Math.max(a, b) : null;
    out.push({
      name: metricNameFor(noun, mode), value: b != null ? a : a, low: lo, high: hi, unit,
      direction: mode === 'level' ? 'level' : sign < 0 ? 'decline' : 'growth',
      forward: FORWARD.test(segTail) && !/\breported\b/i.test(segTail),
      period: period.kind === 'unknown' ? null : period.label, comparisonPeriod: null,
      raw: m[0].trim(), sourceQuote: s,
    });
  }
  return out;
}

// ── guidance vs actual: only when the periods match ─────────────────────

export interface GuidanceCheck {
  comparable: boolean;
  /** Implied growth vs the actual base — null unless the periods match. */
  changePct: { low: number; high: number } | null;
  guidancePeriod: string;
  actualPeriod: string | null;
  priorGuidance: string | null;
  action: 'raised' | 'maintained' | 'cut' | 'new' | 'unknown';
  /** Plain-English line for the card. */
  display: string;
  reason: string;
}
const NEW_OUTLOOK = 'new outlook — direction cannot be inferred';

/** Guidance vs an actual base. A growth % is produced ONLY when the guidance period is the same kind of period as the base and is exactly one year later (a quarter vs the same quarter a year earlier, a fiscal year vs the last fiscal year, or a fiscal year vs the trailing twelve months of a year-end result). Otherwise "comparison unavailable" — never a forced percentage. */
export function guidanceCheck(o: {
  guidance: { low: number; high: number; period: PeriodBasis | string | null };
  actual?: { value: number; period: PeriodBasis | string | null; /** the twelve months end at a fiscal year end */ yearEnd?: boolean } | null;
  prior?: { low: number; high: number; period: PeriodBasis | string | null } | null;
}): GuidanceCheck {
  const gp = typeof o.guidance.period === 'string' || o.guidance.period == null ? periodBasisOf(o.guidance.period as string | null) : o.guidance.period;
  const ap = !o.actual ? null : typeof o.actual.period === 'string' || o.actual.period == null ? periodBasisOf(o.actual.period as string | null) : o.actual.period;
  const pp = !o.prior ? null : typeof o.prior.period === 'string' || o.prior.period == null ? periodBasisOf(o.prior.period as string | null) : o.prior.period;
  let comparable = false; let reason = '';
  let changePct: GuidanceCheck['changePct'] = null;
  if (!o.actual || !ap) reason = 'no actual base for the same period is stated';
  else if (gp.kind === 'unknown') reason = 'the period the guidance covers is not stated';
  else if (ap.kind === 'unknown') reason = 'the period of the actual figure is not stated';
  else if (ap.kind === 'ttm') {
    if (gp.kind === 'year' && o.actual.yearEnd) comparable = true;
    else reason = `the base is the ${ap.label}; the guidance covers ${gp.label} — different period bases`;
  } else if (gp.kind !== ap.kind) reason = `the guidance covers ${gp.label} (${gp.kind}); the base is ${ap.label} (${ap.kind}) — different period bases`;
  else if (gp.kind === 'quarter' || gp.kind === 'half') {
    if (gp.quarter !== ap.quarter) reason = `different quarters (${gp.label} vs ${ap.label})`;
    else if (gp.fiscalYear == null || ap.fiscalYear == null) reason = 'the fiscal year of one side is not stated';
    else if (gp.fiscalYear - ap.fiscalYear !== 1) reason = `${gp.label} is not the year after ${ap.label}`;
    else comparable = true;
  } else if (gp.kind === 'year') {
    if (gp.fiscalYear == null || ap.fiscalYear == null) reason = 'the fiscal year of one side is not stated';
    else if (gp.fiscalYear - ap.fiscalYear !== 1) reason = `${gp.label} is not the year after ${ap.label}`;
    else comparable = true;
  }
  if (comparable && o.actual && o.actual.value > 0) changePct = { low: Math.round((o.guidance.low / o.actual.value - 1) * 1000) / 10, high: Math.round((o.guidance.high / o.actual.value - 1) * 1000) / 10 };
  else comparable = false;
  let action: GuidanceCheck['action'] = 'new';
  let priorText: string | null = null;
  if (o.prior && pp) {
    const same = pp.kind === gp.kind && pp.kind !== 'unknown' && pp.fiscalYear === gp.fiscalYear && pp.quarter === gp.quarter;
    priorText = `${o.prior.low}–${o.prior.high}`;
    if (!same) action = 'unknown';
    else if (o.guidance.low === o.prior.low && o.guidance.high === o.prior.high) action = 'maintained';
    else if (o.guidance.low >= o.prior.low && o.guidance.high >= o.prior.high) action = 'raised';
    else if (o.guidance.low <= o.prior.low && o.guidance.high <= o.prior.high) action = 'cut';
    else action = 'unknown';
  }
  const parts: string[] = [];
  parts.push(comparable && changePct ? `implied ${changePct.low >= 0 ? '+' : ''}${changePct.low}% to ${changePct.high >= 0 ? '+' : ''}${changePct.high}% vs ${ap!.label} actual` : `comparison unavailable — ${reason}`);
  if (action === 'new') parts.push(NEW_OUTLOOK);
  else if (action === 'unknown') parts.push('prior guidance is for a different period or range — direction cannot be inferred');
  else parts.push(`guidance ${action}`);
  return { comparable, changePct, guidancePeriod: gp.label, actualPeriod: ap ? ap.label : null, priorGuidance: priorText, action, display: parts.join(' · '), reason };
}

// ── stage: proposed is never firm ───────────────────────────────────────

export type EventStage = 'PROPOSED' | 'SIGNED' | 'AWARDED' | 'EXECUTED' | 'COMPLETED';
const PROPOSED_RX = /\bletters? of intent\b|\bLOIs?\b|\btentative(?:ly)?\b|\bnon-?binding\b|\bproposed\b|\bproposes? to\b|\bsubject to (?:the )?(?:approval|receipt|regulatory|shareholder|board|stockholder|customary|satisfaction|conditions|definitive|completion)|\bsubject to (?:approvals?|conditions)\b|\bin[- ]principle\b|\bmemorandum of understanding\b|\bMoU\b|\bterm sheet\b|\bhas agreed to consider\b|\bunder negotiation\b|\bin talks\b|\bexpects? to (?:sign|enter)\b|\bplans? to\b|\bintends? to\b/i;
const COMPLETED_RX = /\b(?:has )?(?:completed|completes|closed|closes|consummated|consummates)\b (?:the )?(?:acquisition|merger|transaction|sale|purchase|deal)|\btransaction (?:has )?closed\b|\bcompletion of (?:the )?(?:acquisition|merger|transaction)\b/i;
const AWARDED_RX = /\b(?:awarded|won|wins|secur(?:es|ed)|bags|bagged|received|receives|has received|been awarded)\b[^;]{0,60}\b(?:contract|order|work order|purchase order|letter of award|LoA|tender)\b|\bletter of award\b|\bpurchase order\b/i;
const SIGNED_RX = /\b(?:signed|entered into|executed|inked|definitive agreement|agreement (?:was )?signed)\b/i;

/** Stage of an event, from its own words. Proposed wording (LOI, tentative, subject to approval …) WINS over an "order"/"contract" word: an LOI is not an order win and is never firm or booked. */
export function stageFromText(text: string | null | undefined): EventStage | null {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (PROPOSED_RX.test(t) && !COMPLETED_RX.test(t)) return 'PROPOSED';
  if (COMPLETED_RX.test(t)) return 'COMPLETED';
  if (AWARDED_RX.test(t)) return 'AWARDED';
  if (SIGNED_RX.test(t)) return 'SIGNED';
  return null;
}
/** True only for a stage that is firm (not proposed / unknown). */
export const isFirmStage = (s: string | null | undefined): boolean => s === 'SIGNED' || s === 'AWARDED' || s === 'EXECUTED' || s === 'COMPLETED';
/** Words that claim a firm order, forbidden next to PROPOSED. */
export const FIRM_CLAIM_RX = /\b(?:order win|won|booked|order booked|executed|awarded|firm order|secured)\b/i;
/** A label for a proposed event: never "Order win" / "booked". */
export function proposedLabel(label: string): string {
  return /\(proposed\)|\bproposed\b/i.test(label) ? label : `${label.replace(/\b(?:order win|order booked|booked)\b/i, 'Order / contract')} (proposed)`;
}
export const POTENTIAL_SCALE_NOTE = 'Proposed — this is potential scale, not realised impact; it is not booked revenue or a completed investment.';

// ── two values for one event: keep both, show the conflict ──────────────

export type ValueStatus = 'verified' | 'reported' | 'conflicting' | 'not_disclosed';
export interface EventValue { value: number; unit: string; source: 'filed' | 'headline' | 'press' | 'summary'; text: string }
export interface ValueReconciliation {
  valueStatus: ValueStatus;
  /** Every value seen — never reduced to one when they disagree. */
  values: EventValue[];
  conflicts: string[];
  /** True when the impact cannot be sized (conflict, or only a press / headline value). */
  impactUnknown: boolean;
  /** The value that may be used for sizing — only a single agreed filed value, else null. */
  usable: EventValue | null;
  display: string;
}
/** Reconcile the values stated for ONE event (same unit). A headline / press value that differs from the filed value (by more than 1%) is a conflict: both are kept, the impact is unknown, and nothing is picked. */
export function reconcileValues(values: EventValue[]): ValueReconciliation {
  const vs = values.filter((v) => Number.isFinite(v.value));
  if (!vs.length) return { valueStatus: 'not_disclosed', values: [], conflicts: [], impactUnknown: true, usable: null, display: 'value not disclosed in the cited filing' };
  const filed = vs.filter((v) => v.source === 'filed');
  const other = vs.filter((v) => v.source !== 'filed');
  const differs = (a: number, b: number) => Math.abs(a - b) > Math.max(1e-9, 0.01 * Math.max(Math.abs(a), Math.abs(b)));
  const distinct = (xs: EventValue[]) => xs.reduce<EventValue[]>((acc, x) => (acc.some((y) => !differs(x.value, y.value)) ? acc : [...acc, x]), []);
  const conflicts: string[] = [];
  const fd = distinct(filed);
  if (fd.length > 1) conflicts.push(`Filed documents state different values: ${fd.map((v) => v.text).join(' vs ')}.`);
  for (const o of distinct(other)) {
    for (const f of fd) if (differs(o.value, f.value)) conflicts.push(`${o.source === 'headline' ? 'Headline' : o.source === 'press' ? 'Press' : 'Summary'} states ${o.text}; the filed document states ${f.text}. Both are kept; neither is used until confirmed.`);
  }
  if (!fd.length) {
    const od = distinct(other);
    if (od.length > 1) conflicts.push(`Reports state different values: ${od.map((v) => v.text).join(' vs ')}.`);
  }
  if (conflicts.length) return { valueStatus: 'conflicting', values: vs, conflicts, impactUnknown: true, usable: null, display: `conflicting values — ${vs.map((v) => `${v.text} (${v.source})`).join(' vs ')}; impact unknown` };
  if (fd.length === 1) return { valueStatus: 'verified', values: vs, conflicts: [], impactUnknown: false, usable: fd[0], display: fd[0].text };
  return { valueStatus: 'reported', values: vs, conflicts: [], impactUnknown: true, usable: null, display: `${vs[0].text} (reported, not verified in a filing)` };
}

// ── document read vs event confirmed: two facts, validated together ─────

export type DocumentVerification = 'read' | 'summary_only' | 'unavailable' | 'not_applicable';
export type CatalystConfirmation = 'confirmed_in_official_filing' | 'filed_document_unread' | 'press_unconfirmed' | 'not_found';

/** document_verification: was the cited document actually read? catalyst_confirmation: does an authoritative source contain the event? */
export function verificationOf(o: { sourceKind: SourceKind | null | undefined; access: SourceAccess | null | undefined; eventInDocument: boolean }): { documentVerification: DocumentVerification; catalystConfirmation: CatalystConfirmation } {
  const official = !!o.sourceKind && o.sourceKind !== 'PRESS';
  if (!o.sourceKind) return { documentVerification: 'not_applicable', catalystConfirmation: 'not_found' };
  const dv: DocumentVerification = o.access === 'DOCUMENT_READ' ? 'read' : o.access === 'SUMMARY_ONLY' ? 'summary_only' : 'unavailable';
  if (!official) return { documentVerification: dv, catalystConfirmation: 'press_unconfirmed' };
  if (dv === 'read' && o.eventInDocument) return { documentVerification: dv, catalystConfirmation: 'confirmed_in_official_filing' };
  return { documentVerification: dv, catalystConfirmation: 'filed_document_unread' };
}
/** A contradiction message, or null when the pair is allowed. */
export function validateVerification(dv: DocumentVerification, cc: CatalystConfirmation, ctx: { sourceKind?: SourceKind | null; eventInDocument?: boolean } = {}): string | null {
  if (cc === 'confirmed_in_official_filing' && dv !== 'read') return 'an event cannot be confirmed in an official filing when the document was not read';
  if (cc === 'press_unconfirmed' && dv === 'read' && ctx.sourceKind && ctx.sourceKind !== 'PRESS' && ctx.eventInDocument) return 'the event is in an official filing that was read, so it cannot be "not yet in an official filing"';
  if (cc === 'not_found' && dv === 'read' && ctx.eventInDocument) return 'the event was found in the document that was read';
  return null;
}
export const CATALYST_CONFIRMATION_LABEL: Record<CatalystConfirmation, string> = {
  confirmed_in_official_filing: 'Confirmed in an official filing',
  filed_document_unread: 'Filed — the document itself was not read',
  press_unconfirmed: 'Reported in the press — not yet in an official filing',
  not_found: 'No source found',
};
/** A state label that says "not yet in an official filing" is replaced when the event IS in a filing that was read. */
export function reconcileStateLabel(stateLabel: string, cc: CatalystConfirmation): string {
  if (cc === 'confirmed_in_official_filing' && /not yet in an official filing/i.test(stateLabel)) return 'Identified — confirmed in an official filing that was read';
  return stateLabel;
}

// ── catalyst search status (no "no catalyst found" when an event exists) ─

export type CatalystSearchStatus = 'no_event_found' | 'event_found_low_information' | 'event_found_not_market_moving' | 'event_found_unverified' | 'confirmed_material_event';
export interface CatalystSearchResult { status: CatalystSearchStatus; label: string; sentence: string; sources: string[]; lookbackDays: number | null }
export function catalystSearchResult(o: { eventExtracted: boolean; verified?: boolean; material?: boolean; lowInformation?: boolean; routine?: boolean; sources: string[]; lookbackDays?: number | null; eventLabel?: string | null }): CatalystSearchResult {
  const window = o.lookbackDays != null ? ` over the last ${o.lookbackDays} days` : '';
  const where = o.sources.length ? o.sources.join(', ') : 'no source could be searched';
  if (!o.eventExtracted) {
    return { status: 'no_event_found', label: 'No event found', sources: o.sources, lookbackDays: o.lookbackDays ?? null,
      sentence: `No catalyst found in filings or news — searched ${where}${window}.` };
  }
  const ev = o.eventLabel ? ` (${o.eventLabel})` : '';
  if (o.material && o.verified) return { status: 'confirmed_material_event', label: 'Confirmed material event', sources: o.sources, lookbackDays: o.lookbackDays ?? null, sentence: `Event found${ev} and confirmed in ${where}${window}.` };
  if (!o.verified) return { status: 'event_found_unverified', label: 'Event found, unverified', sources: o.sources, lookbackDays: o.lookbackDays ?? null, sentence: `Event found${ev}, not verified in an official filing — searched ${where}${window}.` };
  if (o.lowInformation) return { status: 'event_found_low_information', label: 'Event found, low information', sources: o.sources, lookbackDays: o.lookbackDays ?? null, sentence: `Event found${ev}, low information; no material operating catalyst found — searched ${where}${window}.` };
  return { status: 'event_found_not_market_moving', label: 'Event found, not market-moving', sources: o.sources, lookbackDays: o.lookbackDays ?? null, sentence: `Event found${ev}; no material operating catalyst found — searched ${where}${window}.` };
}

// ── causal window: context only ─────────────────────────────────────────

export interface CausalWindow {
  ageDaysAtMove: number | null;
  status: 'inside_window' | 'outside_window' | 'unknown';
  windowDays: number;
  contextOnly: boolean;
  label: string;
}
const dayNumber = (iso: string | null | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
};
/** Default: official filing = move date − 3 calendar days … move date; press = move date − 1 … move date. Dates are calendar dates (YYYY-MM-DD) in the exchange's own calendar. An item older than the window (or dated after the move) is "Context only" and is not counted as the move catalyst. */
export function causalWindow(o: { itemDate: string | null | undefined; moveDate: string | null | undefined; official: boolean; windowDays?: number }): CausalWindow {
  const windowDays = o.windowDays ?? (o.official ? 3 : 1);
  const a = dayNumber(o.itemDate), b = dayNumber(o.moveDate);
  if (a == null || b == null) return { ageDaysAtMove: null, status: 'unknown', windowDays, contextOnly: false, label: 'Date unknown — cannot tell whether it is inside the catalyst window' };
  const age = b - a;
  if (age < 0) return { ageDaysAtMove: age, status: 'outside_window', windowDays, contextOnly: true, label: 'Dated after the move day — context only, not counted as the move catalyst' };
  if (age > windowDays) return { ageDaysAtMove: age, status: 'outside_window', windowDays, contextOnly: true, label: `Context only — ${age} days before the move (window ${windowDays}); not counted as the move catalyst` };
  return { ageDaysAtMove: age, status: 'inside_window', windowDays, contextOnly: false, label: age === 0 ? 'Same day as the move' : `${age} day${age === 1 ? '' : 's'} before the move — inside the window` };
}

// ── exchange calendar (never UTC, never the browser's zone) ─────────────

export const EXCHANGE_TZ = { US: 'America/New_York', IN: 'Asia/Kolkata' } as const;
/** The calendar date (YYYY-MM-DD) at `now` on the exchange's own clock. */
export function exchangeDate(now: Date, market: 'US' | 'IN'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: EXCHANGE_TZ[market], year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
/** Whole calendar days from an ISO date / timestamp to "today" on the exchange calendar (a timestamp is first placed on the exchange's calendar too). */
export function exchangeAgeDays(iso: string | null | undefined, now: Date, market: 'US' | 'IN'): number | null {
  if (!iso) return null;
  const s = String(iso);
  let day = s.slice(0, 10);
  if (s.length > 10) { const t = Date.parse(s); if (Number.isFinite(t)) day = exchangeDate(new Date(t), market); }
  const a = dayNumber(day), b = dayNumber(exchangeDate(now, market));
  return a == null || b == null ? null : b - a;
}

// ── clusters: one filing is one event, not ten ──────────────────────────

export interface FactLike { id: string; label: string; category?: string; url: string | null; source?: string; date?: string | null }
export interface EventCluster<T extends FactLike = FactLike> {
  clusterId: string;
  primaryEventType: string;
  primary: T;
  facts: T[];
  primarySource: string | null;
  /** Distinct filings / articles (accession or URL) — never the number of sentences. */
  independentConfirmationCount: number;
}
const accessionOf = (url: string | null | undefined): string | null => {
  const m = /\/data\/\d+\/(\d{18})\//.exec(String(url || '')) || /(\d{10}-\d{2}-\d{6})/.exec(String(url || ''));
  return m ? m[1].replace(/-/g, '') : null;
};
/** Group extracted facts. Facts of ONE filing (accession) that sit in a results release (≥ 1 Earnings-category fact) form one earnings cluster with the other facts as children; other facts cluster by event id. Independent sources are distinct accessions / URLs. */
export function clusterFacts<T extends FactLike>(facts: T[], opts: { rank?: (f: T) => number } = {}): Array<EventCluster<T>> {
  const rank = opts.rank || (() => 0);
  const srcKey = (f: T) => accessionOf(f.url) || f.url || f.source || 'unknown';
  const byDoc = new Map<string, T[]>();
  for (const f of facts) { const k = srcKey(f); byDoc.set(k, [...(byDoc.get(k) || []), f]); }
  const clusters = new Map<string, T[]>();
  for (const [doc, fs] of Array.from(byDoc.entries())) {
    const isResults = fs.some((f) => f.category === 'Earnings' || f.category === 'Results');
    if (isResults) clusters.set(`${doc}:earnings`, fs);
    else for (const f of fs) clusters.set(`${f.id}`, [...(clusters.get(`${f.id}`) || []), f]);
  }
  const out: Array<EventCluster<T>> = [];
  for (const [key, fs] of Array.from(clusters.entries())) {
    const sorted = [...fs].sort((a, b) => rank(a) - rank(b));
    const isEarn = key.endsWith(':earnings');
    const docs = new Set(fs.map(srcKey));
    out.push({ clusterId: isEarn ? `earnings:${key.replace(':earnings', '')}` : `event:${key}`, primaryEventType: isEarn ? 'earnings' : sorted[0].id, primary: sorted[0], facts: sorted, primarySource: sorted[0].url, independentConfirmationCount: docs.size });
  }
  return out;
}

// ── exchange-calendar day of a timestamp, and issuer identity (zzz835) ─────

const HAS_ZONE = /(?:[zZ]|[+-]\d\d:?\d\d)$/;
/** The calendar day (YYYY-MM-DD) of a date / timestamp ON THE EXCHANGE'S CLOCK. A date-only string is already a calendar day; a timestamp with a zone is placed on the exchange calendar (a UTC stamp of 01:14Z is still the previous US day). A timestamp with no zone is read as written. */
export function exchangeDay(iso: string | null | undefined, market: 'US' | 'IN'): string | null {
  const s = String(iso || '').trim();
  if (!s) return null;
  if (s.length <= 10 || !HAS_ZONE.test(s)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? exchangeDate(new Date(t), market) : null;
}

/** "Sugs Lloyd Ltd." -> "sugs lloyd" (for exact security-master lookups only). */
export function normaliseCompanyName(name: string | null | undefined): string {
  return String(name || '').toLowerCase().replace(/&amp;/g, '&').replace(/\([^)]*\)/g, ' ').replace(/\b(limited|ltd|inc|incorporated|corp|corporation|plc|llc|pvt|private|co|company)\b\.?/g, ' ').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export interface IssuerIdentity {
  /** Shown as written: a numeric BSE scrip code stays a CODE, never a ticker. */
  code: string | null;
  ticker: string | null;
  name: string | null;
  /** "Sugs Lloyd (BSE 544501)" / "ORIRAIL" */
  display: string;
  /** How the ticker was known: 'given' | 'security_master' | null (never guessed from the name). */
  tickerBasis: 'given' | 'security_master' | null;
}
/** Who is this issuer. A numeric BSE code is a code (shown as "BSE 544434"), the company name is kept separately, and a ticker is filled from a NAME only by an exact match in the supplied security master - never inferred. */
export function resolveIssuer(o: { ticker?: string | null; company?: string | null; securityMaster?: Record<string, string> | null }): IssuerIdentity {
  const raw = String(o.ticker || '').trim();
  const name = o.company ? String(o.company).trim() : null;
  const numeric = /^\d{5,6}$/.test(raw);
  if (numeric) return { code: raw, ticker: null, name, display: `${name || 'Company'} (BSE ${raw})`, tickerBasis: null };
  if (raw) return { code: null, ticker: raw.toUpperCase(), name, display: name ? `${name} (${raw.toUpperCase()})` : raw.toUpperCase(), tickerBasis: 'given' };
  const hit = name && o.securityMaster ? o.securityMaster[normaliseCompanyName(name)] : null;
  if (hit) return { code: /^\d{5,6}$/.test(hit) ? hit : null, ticker: /^\d{5,6}$/.test(hit) ? null : hit.toUpperCase(), name, display: `${name} (${/^\d{5,6}$/.test(hit) ? `BSE ${hit}` : hit.toUpperCase()})`, tickerBasis: 'security_master' };
  return { code: null, ticker: null, name, display: name || 'Unknown issuer', tickerBasis: null };
}

// ═══ zzz836: ECONOMIC DIRECTION, SUBTYPE, RESEARCH QUESTION, PRICE COMMENTARY, AMOUNTS ═══════════════════════
// Direction is about the ECONOMICS of the event, never about the price move.

export type EconDirection = 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL' | 'UNKNOWN';

const typeKey = (t: string) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const RX_INSPECTION_NEG = /\b(?:official action indicated|OAI|warning letter|import alert|form 483 (?:with|citing) (?:critical|repeat|data[- ]integrity)|data integrity|critical observations?|unacceptable)\b/i;
const RX_INSPECTION_CLEAN = /\b(?:no observations?|zero observations?|nil observations?|\bNAI\b|no action indicated|closed without (?:any )?observations?|EIR (?:received|issued)|establishment inspection report|voluntary action indicated|\bVAI\b)\b/i;
const RX_INSPECTION_OBS = /\b(?:observations?|form 483|483s?|procedural|deficienc(?:y|ies)|citations?)\b/i;

/** The direction of an event's economics. `type` is a taxonomy id / label from either market; `text` is the evidence sentence.
 *  Unknown is UNKNOWN - never guessed negative. A fallback (the taxonomy's own hint) is used only when the type is not known here. */
export function directionOf(type: string, text: string, fallback?: string | null): EconDirection {
  const k = typeKey(type);
  const t = String(text || '');
  const has = (rx: RegExp) => rx.test(t);
  if (/inspection|warning_letter/.test(k) || (/\b(?:usfda|us fda|fda|mhra|eu[- ]gmp|who[- ]gmp|anvisa|pmda|tga)\b/i.test(t) && /\binspection\b/i.test(t) && !/^(?:regulatory_approval|tax)/.test(k))) {
    if (has(RX_INSPECTION_NEG)) return 'NEGATIVE';
    if (has(/\b(?:no observations?|zero observations?|nil observations?|\bNAI\b|no action indicated)\b/i)) return 'POSITIVE';
    if (has(RX_INSPECTION_OBS)) return 'MIXED';
    if (has(RX_INSPECTION_CLEAN)) return 'POSITIVE';
    return 'UNKNOWN';
  }
  if (/credit_rating|rating_(?:upgrade|downgrade|action|reaffirm)/.test(k)) {
    if (has(/\bdowngrad|\bto negative\b|\bnegative outlook\b|\bwatch with negative\b|\brevised (?:downward|to negative)\b/i)) return 'NEGATIVE';
    if (has(/\bupgrad|\bto positive\b|\bpositive outlook\b|\brevised (?:upward|to positive)\b/i)) return 'POSITIVE';
    if (has(/\breaffirm|\bassigned\b|\bretained\b|\bmaintained\b/i)) return 'NEUTRAL';
    return 'UNKNOWN';
  }
  if (/tax_demand|tax_litigation|regulatory_setback|insolvency|default|operations_disruption|auditor_resignation|net_loss|revenue_decline|profit_decline|margin_compression|litigation_loss|going_concern|delist/.test(k)) return 'NEGATIVE';
  if (/legal_win|favourable|patent_litigation_win/.test(k)) return 'POSITIVE';
  if (/kmp_resignation|independent_director_exit|resignation|departure/.test(k)) {
    return has(/\b(?:ceo|cfo|chief executive|chief financial|managing director|md\b|promoter)\b/i) ? 'NEGATIVE' : 'UNKNOWN';
  }
  if (/subsidiary|incorporation|debt_raise|ncd|financing|debt|borrowing|equity_raise|equity_offering|fundrais|qip|preferential|rights_issue|dividend|bonus|split|buyback|kmp_appointment|record_date|agm|price_commentary|circuit|broker/.test(k)) return 'NEUTRAL';
  if (/store_launch|dealership|network_expansion/.test(k)) return 'POSITIVE';
  if (/results|revenue|profit|earnings|turnaround|guidance/.test(k)) {
    const up = has(/\b(?:up|rose|grew|growth|increase[ds]?|jumped|surged|record|beat|raised|turnaround|profit)\b/i);
    const dn = has(/\b(?:down|fell|declined|decrease[ds]?|dropped|slumped|loss|missed|lowered|cut|withdr[ae]w)\b/i);
    if (up && dn) return 'MIXED';
    if (up) return 'POSITIVE';
    if (dn) return 'NEGATIVE';
    return 'UNKNOWN';
  }
  if (/order|contract|work_order|capacity|capex|commission|acquisition|approval|qualification|partnership|new_product|launch|customer|promoter_buying|stake_buy|trial|licens|milestone|expansion/.test(k)) return 'POSITIVE';
  const fb = String(fallback || '').toLowerCase();
  return fb === 'positive' ? 'POSITIVE' : fb === 'negative' ? 'NEGATIVE' : fb === 'mixed' ? 'MIXED' : fb === 'neutral' ? 'NEUTRAL' : 'UNKNOWN';
}

/** A plain note for a direction that needs one (dilution, contingent, procedural). */
export function directionNote(type: string, text: string): string | null {
  const k = typeKey(type);
  if (/equity_raise|equity_offering|fundrais|qip|preferential|rights_issue/.test(k)) return 'equity raise adds shares - dilution note: check price, allottees and use of proceeds';
  if (/tax_demand/.test(k)) return 'contingent until any appeal ends - size it against earnings, net worth and cash';
  if (/inspection/.test(k) && RX_INSPECTION_OBS.test(text) && !RX_INSPECTION_NEG.test(text)) return 'observations are not a clean result - severity and response not yet read';
  if (/debt_raise|ncd|financing/.test(k)) return 'financing - neutral until the use of proceeds is known';
  return null;
}

export const DIRECTION_MARK: Record<EconDirection, string> = { POSITIVE: '▲', NEGATIVE: '▼', MIXED: '◆', NEUTRAL: '◆', UNKNOWN: '?' };

export type EventSubtype =
  | 'store_launch' | 'dealership' | 'facility_for_customer' | 'capacity_capex' | 'credit_rating' | 'inspection'
  | 'tax_demand' | 'subsidiary' | 'debt_financing' | 'equity_raise' | 'acquisition' | 'order' | 'price_commentary' | 'other';

/** What kind of the broad type this really is - drives the research question. Text first, type second. */
export function subtypeOf(type: string, text: string): EventSubtype {
  const k = typeKey(type);
  const t = String(text || '');
  if (/credit_rating|rating_/.test(k) || /\b(?:crisil|icra|care ratings|\bCARE\b|india ratings|acuite|infomerics|brickwork)\b[^.;]{0,80}\b(?:rating|reaffirm|upgrad|downgrad|outlook)/i.test(t)) return 'credit_rating';
  if (/inspection|warning_letter/.test(k) || (/\binspection\b/i.test(t) && /\b(?:usfda|us fda|fda|mhra|eu[- ]gmp|who[- ]gmp|form 483|observations?)\b/i.test(t))) return 'inspection';
  if (/tax_demand/.test(k)) return 'tax_demand';
  if (/dealership|network_expansion/.test(k) || /\bdealership\b|\bshowroom for (?:BYD|[A-Z][a-z]+)\b|\bnew (?:BYD|[A-Z]{2,}) (?:outlet|dealership|facility)\b|\bdealer(?:ship)? network\b/i.test(t)) return 'dealership';
  if (/store_launch/.test(k) || /\b(?:showroom|store|stores|outlet|outlets|boutique|retail (?:store|outlet))\b[^.;]{0,50}\b(?:launch|launched|launching|opening|opened|inaugurat\w*|open)\b|\b(?:launch\w*|open(?:s|ed|ing)?|inaugurat\w*)\b[^.;]{0,40}\b(?:new )?(?:showroom|store|stores|outlet|outlets|boutique)\b/i.test(t)) return 'store_launch';
  if (/\binaugurat\w*\b[^;]{0,80}\bfor\s+(?:[A-Z][A-Za-z&.-]+)/.test(t) && /\b(?:facility|facilities|plant|unit|centre|center)\b/i.test(t)) return 'facility_for_customer';
  if (/subsidiary|incorporation/.test(k) || /\bincorporat\w*\b[^.;]{0,60}\bsubsidiary\b/i.test(t)) return 'subsidiary';
  if (/debt_raise|ncd|financing|debt/.test(k) || /\bnon[- ]convertible debentures?\b|\bNCDs?\b/.test(t)) return 'debt_financing';
  if (/equity_raise|equity_offering|fundrais|qip|preferential|rights_issue/.test(k)) return 'equity_raise';
  if (/acquisition/.test(k)) return 'acquisition';
  if (/order|contract/.test(k)) return 'order';
  if (/capacity|capex|commission/.test(k)) return 'capacity_capex';
  if (/price_commentary/.test(k)) return 'price_commentary';
  return 'other';
}

/** The subtype-specific research question (WHY RESEARCH). Plain words; asks, never asserts. */
export function researchQuestionFor(sub: EventSubtype): string {
  switch (sub) {
    case 'store_launch': return 'Store launch on file - the open question is store economics: capex per store, same-store sales and payback, and how many more openings are planned.';
    case 'dealership': return 'New dealership on file - the open question is network economics: capex for the outlet, sales and service throughput, and the brand\'s vehicle allocation to it.';
    case 'facility_for_customer': return 'Facility opened for a named customer - the open question is the customer contract: volume, price, tenor and ramp-up, and the customer\'s share of revenue.';
    case 'capacity_capex': return 'Capex / capacity on file - the open question is utilisation: will orders or offtake fill it, and what revenue and EBITDA follow.';
    case 'credit_rating': return 'Rating action on file - the open question is the cost and access of debt: rated facilities, the agency\'s reasons, and debt due for refinancing.';
    case 'inspection': return 'Inspection on file - the open question is compliance risk: what the observations are, the company\'s response and due date, whether a repeat inspection follows, and how much revenue depends on the site.';
    case 'tax_demand': return 'Tax demand on file - the open question is the exposure: the amount against earnings, net worth and cash, the appeal stage and any provision made.';
    case 'subsidiary': return 'New subsidiary on file - the open question is what it is for: the business it will run, capital put in and any customer or asset moving into it.';
    case 'debt_financing': return 'Debt raised - the open question is the use of the money: refinancing or growth, cost of debt, maturity and the effect on leverage.';
    case 'equity_raise': return 'Equity raise on file - the open question is dilution and use: issue price, who subscribes and what the money funds.';
    case 'acquisition': return 'Acquisition on file - the open question is the deal economics: purchase price / swap ratio, what the target earns, how it is financed and when it closes.';
    case 'order': return 'Order on file - the open question is delivery: size against revenue, margin, execution timeline and who the customer is.';
    case 'price_commentary': return 'Price commentary only - not evidence; find the filed event, if any.';
    default: return '';
  }
}

/** Circuit / momentum / broker-target headlines describe the PRICE, not the business. */
const RX_PRICE_TALK = /\b(?:upper circuit|lower circuit|locks? at (?:the )?upper|circuit (?:limit|filter)|buyers queue|shares? (?:surge|jump|zoom|soar|rally|spike|slump|tumble)|stock (?:surges?|jumps?|rallies|zooms?|soars?|hits? (?:upper|52)|climbs?)|52[- ]week high|all[- ]time high|multibagger|technical breakout|target price|price target|brokerage|buy rating|overweight|initiates? coverage|goldman|jefferies|motilal|nomura|nuvama)\b/i;
const RX_EVENT_WORD = /\b(?:order|contract|work order|acquir\w+|acquisition|approval|approved|result|results|profit|revenue|launch\w*|inspection|rating|incorporat\w+|subsidiary|capex|capacity|commission\w*|allot\w*|debentures?|dividend|bonus|merger|demerger|agreement|partnership|resign\w*|appoint\w*)\b/i;
export function isPriceCommentary(text: string): boolean {
  const t = String(text || '');
  if (!RX_PRICE_TALK.test(t)) return false;
  // "shares surge after Rs 200 crore order" states an event: it is classified by the event, not as commentary
  const stripped = t.replace(RX_PRICE_TALK, ' ');
  return !RX_EVENT_WORD.test(stripped);
}

/** An amount is presentable only with an explicit currency unit, or a full number with a currency prefix. "Rs 7" and "15 years 7" are table fragments. */
export function isPlausibleAmount(fig: string): boolean {
  const s = String(fig || '').trim();
  if (!/\d/.test(s)) return false;
  if (/(?:crores?|\bcr\b|lakhs?|lacs?|million|\bmn\b|billion|\bbn\b|thousand|\bk\b|%|per ?cent|bps|basis points|\/-)/i.test(s)) return true;
  if (/^(?:US)?\$/.test(s)) return /[MBK]\b/.test(s) || Number(s.replace(/[^\d.]/g, '')) >= 1000;
  const n = Number(s.replace(/[^\d.]/g, ''));
  if (/^(?:₹|rs\.?|inr)/i.test(s)) return Number.isFinite(n) && n >= 1000;
  return true;   // unit-carrying non-money figures (MW, tonnes ...) are judged by their own unit
}

/** Anything older than this many days is context, not fresh news (stale ALSO ON FILE items, older result blocks). */
export const CONTEXT_AGE_DAYS = 14;
export function contextTag(ageDays: number | null | undefined, what = 'item', threshold = CONTEXT_AGE_DAYS): { context: boolean; label: string | null } {
  if (ageDays == null || !Number.isFinite(ageDays) || ageDays <= threshold) return { context: false, label: null };
  return { context: true, label: `OLDER ${what.toUpperCase()} (${ageDays}d) - context` };
}
export const ACQUISITION_PRICE_LABEL = 'Purchase price / swap ratio';
