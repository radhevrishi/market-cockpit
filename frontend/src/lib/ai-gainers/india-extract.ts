// ═══════════════════════════════════════════════════════════════════════════
// INDIA — STRUCTURED FACTS FROM THE FILED DOCUMENT ITSELF.           (zzz785)
//
// The sweep used to judge an Indian filing by its exchange subject ("Press
// Release / Media Release", "General Updates", "Disclosure under Regulation
// 30") and an aggregator's one-line summary. This file reads the attachment
// text and pulls out, WITHOUT a model:
//   event      — kind, counterparty, product, geography, stage
//   economics  — ₹ Cr value, shares, issue price, allottees, consideration,
//                target turnover, stake %, capacity, capex
//   time       — execution period, completion, milestones
//   quotes     — verbatim sentences, each checked present in the document
//   unknowns   — plain words for what the document does not say
// Ratios are computed only from stated numbers and carry their formula.
//
// Rules: a field the document does not state stays null (unknown, never
// negative); price is never an input; a negative event never hides a
// positive one — every event found is returned.
// ═══════════════════════════════════════════════════════════════════════════

import { indiaEventLines } from './in-event-taxonomy';
import { createHash } from 'crypto';
import {
  emptyEconomics, emptyTime, favourableLegalOutcome,
  type StructuredFacts, type SourceRef, type SourceKind, type SourceAccess, type EventKind, type EventFacts,
} from './structured-facts';
import { quoteIsInDocument, docSeqOf, isGenericSubject } from './announcement-reader';
import type { CatalystType } from './events';

/** Bump when extraction changes what a document yields (cached reads re-extract). */
// zzz803: x2 — a document read also keeps its event sentences (eventLines) for the India card.
export const INDIA_EXTRACT_VERSION = 'x2';

export type Polarity = 'positive' | 'negative' | 'neutral';

/** StructuredFacts plus India-side detail. Every extra field is optional to a
 *  reader of the shared contract: an IndiaFacts IS a StructuredFacts. */
export interface IndiaFacts extends StructuredFacts {
  polarity: Polarity;
  /** A plain-English one-line summary built only from stated fields. */
  headline: string;
  /** The event was carried out by a named subsidiary; the finding belongs to the listed parent. */
  attribution?: { entity: string; relation: 'subsidiary' } | null;
  /** "With reference to our earlier intimation dated March 25, 2026" — the filing continues an older one. */
  continues?: string | null;
  /** 'current' = filed in the research window; 'history' = an older related filing (timeline). */
  relation?: 'current' | 'history';
  /** A stated figure that is NOT a firm value ("annual business potential of ~₹33 Cr"). */
  statedPotentialNative?: number | null;
  /** Fundraising only: materiality stays Unknown until all four are known. */
  fundMateriality?: { state: 'KNOWN' | 'UNKNOWN'; missing: string[] } | null;
}

export interface IndiaDoc {
  text: string;
  issuer: string;
  date: string | null;
  url: string | null;
  title: string;
  accession?: string | null;
  kind?: SourceKind;
  access?: SourceAccess;
}

/** Stated context the ratios may use. Market cap is shown as a ratio only. */
export interface ExtractContext { ttmRevenueCr?: number | null; marketCapCr?: number | null; sharesOutstanding?: number | null }

export interface DocExtraction {
  facts: IndiaFacts[];
  /** The body read as routine housekeeping (branch opening, analyst meet …). */
  routineReason: string | null;
  /** True when the body gave an event or a routine reason; false = still unclassifiable after reading. */
  classified: boolean;
  /** Every ₹ Cr figure the body states — used to check a summary's figure against the document. */
  valuesSeen: number[];
}

// ── text helpers ────────────────────────────────────────────────────────────

export function normaliseDocText(s: string): string {
  return String(s || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export function textHash(s: string): string {
  return createHash('sha1').update(normaliseDocText(s).toLowerCase()).digest('hex').slice(0, 16);
}

const ABBR = /\b(Rs|No|Nos|Sr|Mr|Ms|Mrs|Dr|M\/s|Ltd|Pvt|Co|Inc|St|viz|i\.e|e\.g|approx|Sl|Ref|vs|Bhd|SDN)\./g;
/** Sentences, keeping the original characters so each can be quoted verbatim. */
export function sentencesOf(text: string): string[] {
  const t = normaliseDocText(text).replace(ABBR, (m) => m.replace('.', '\u0000'));
  return t.split(/(?<=[a-z0-9)\]%"'])[.;]\s+(?=[A-Z0-9(])/)
    .map((s) => s.replace(/\u0000/g, '.').trim()).filter((s) => s.length > 0);
}

/** A verbatim quote around `re`'s first match — the sentence, or a ≤ 300-char
 *  window of it — kept only if it is found in the document. */
const LETTER = /dear (sir|madam)|sub(ject)?\s*:|listing obligations and disclosure requirements|scrip code|exchange plaza|dalal street|symbol\s*:|cin\s*[:-]/i;
function quoteFor(text: string, sentences: string[], re: RegExp): string | null {
  // Body sentences first; a letter's cover (addresses, "Dear Sir", the Reg 30 preamble) only as a last resort.
  const ordered = [...sentences.filter((s) => !LETTER.test(s)), ...sentences.filter((s) => LETTER.test(s))];
  for (const s of ordered) {
    const m = re.exec(s);
    if (!m) continue;
    let q = s;
    if (q.length > 300) {
      const at = Math.max(0, m.index - 20);
      const start = at === 0 ? 0 : (q.indexOf(' ', at) + 1 || at);
      q = q.slice(start, start + 300).replace(/\s\S*$/, '');
    }
    q = q.replace(/[.;,\s]+$/, '');
    if (quoteIsInDocument(text, q)) return q;
  }
  return null;
}

const MONEY_SRC = String.raw`(?:(?:rs\.?|inr|₹)\s*)?~?\s*([\d,]+(?:\.\d+)?)\s*-?\s*(crores?|cr\b|lakhs?|lacs?|million|mn\b|billions?|bn\b)|(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)\s*\/-|\b(\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d+)?)\s*\/-|(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)`;
const COUNTED = /^\s*(?:fully[- ]paid(?:[- ]up)?\s+|equity\s+|new\s+)*(?:shares?|warrants?|units?|users?|customers?|components?|part numbers?|tonnes?|litres?|securities)\b/i;

/** ₹ Cr of the first money amount in `s`, or null. Handles the PDF text layer
 *  losing the rupee sign ("153.76 Crore", "5,34,45,785/-"). A bare crore
 *  followed by a counted noun ("37 crore shares") is a count, not money. */
export function moneyCr(s: string): number | null {
  const re = new RegExp(MONEY_SRC, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const after = s.slice(m.index + m[0].length);
    if (m[1]) {
      if (COUNTED.test(after)) continue;
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isFinite(n)) continue;
      const u = m[2].toLowerCase();
      // A lakh or a million is money only when a currency marks it ("20 lakh users").
      if (/^(lakh|lac|million|mn|billion|bn)/.test(u) && !/(rs\.?|inr|₹)/i.test(m[0])) continue;
      // zzz835: Rs 2.13 billion = 213 crore (it was read as Rs 2.13 = 0.0000002 crore)
      return /^(lakh|lac)/.test(u) ? n / 100 : /^(million|mn)/.test(u) ? n / 10 : /^(billion|bn)/.test(u) ? n * 100 : n;
    }
    const raw = m[3] || m[4] || m[5];
    if (!raw) continue;
    if (COUNTED.test(after) || /^\s*(%|per cent|kv|mw|days|months|years)/i.test(after)) continue;
    const n = parseFloat(raw.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) continue;
    return Math.round((n / 1e7) * 1e6) / 1e6;
  }
  return null;
}

function allMoney(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(MONEY_SRC, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const v = moneyCr(m[0] + text.slice(m.index + m[0].length, m.index + m[0].length + 24)); if (v != null) out.push(v); }
  return Array.from(new Set(out.map((v) => Math.round(v * 1e4) / 1e4)));
}

const clean = (s: string | null | undefined, max = 140): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').trim();
  if (t.length < 2) return null;
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s\S*$/, '')}…` : t;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const fmtCr = (v: number) => (v < 0.1 ? `₹${Math.round(v * 1e7).toLocaleString('en-IN')}` : `₹${r2(v)} Cr`);

// ── event kind from the BODY ────────────────────────────────────────────────

const RX = {
  taxProceeding: /show[- ]cause notice|demand[- ]cum[- ]show[- ]cause|\bscn\b|\bdrc-0\d|tax demand|demand of rs|assessment order|appellate tribunal|\bitat\b|commissioner \(appeals|appeals-?ii|confirmed (a |the )?demand|penalty raised|section 7[34]\s*(\(\d\)\s*)?of the cgst|gst demand|income tax (demand|department)/i,
  taxWord: /\b(gst|cgst|sgst|igst|goods and services? tax|income[- ]tax|customs|excise|service tax)\b/i,
  taxFavourable: /(decid\w+|order\w*|ruled?)[^.]{0,80}in favou?r of the company|allowed the (company'?s )?appeal|in (the )?company'?s favou?r|(dropped|deleted|quashed|set aside) the (demand|addition|proceedings)|dropp(ed|ing) the proceedings/i,
  governanceFine: /fine (was |has been )?levied|levied (a )?(total )?fine|fines? (of|levied)[^.]{0,40}(exchange|bse|nse)|delayed compliance with regulation|non-?compliance with regulation \d/i,
  order: /purchase order|work order|letter of award|notification of award|receipt of (a )?(firm )?(purchase )?order|secured (a |an )?(new )?(order|contract)|order aggregating|order (worth|valued)|contract (award|worth|valued)|emerged as successful in the tender|successful (bidder|in the tender)|\bl-?1 bidder|\bwins?\b[^.]{0,60}\borders?\b|awarded (a |an |the )?(contract|order)|rate contract/i,
  fundraising: /preferential (issue|basis|allotment)|qualified institutions? placement|\bqip\b|convertible warrants|rights issue|issue of (up to )?[\d,]+ (fully paid[- ]up )?equity shares/i,
  // A certification printed in a letterhead ("AS 9100D ISO 9001:2015") is not news: an approval needs a verb.
  qualification: /licen[cs]e (has been )?(granted|received|for (the )?manufactur)|grant(ed|ing)? (of )?(a )?licen[cs]e|granting licen[cs]e|(received|granted|obtained|awarded|achieved)[^.]{0,60}(approval|certification|accreditation|as ?9100|nadcap|usfda|eir\b)|marketing authori[sz]ation|approval (from|of) the (drug|ministry|dgca|commissioner)/i,
  capacity: /successful(ly)? commission|has been commissioned|commissioned (the|a|an|its|our|\d)|commissioning of (the |a |an |its |our )?(\d|new|plant|project|unit|facility|line|battery)|commenced commercial (production|operations)|manufacturing facility|capacity (addition|expansion|enhancement)|proposed capacity|setting up (a |an |new )?[a-z ]{0,40}(plant|distillery|facility|unit|warehouse)|new (plant|facility|manufacturing unit)|battery (manufacturing )?plant|\d+\s*mw\s*\/\s*\d+\s*mwh|greenfield|brownfield/i,
  subsidiaryIncorporation: /(incorporat\w+)[^.]{0,120}wholly[- ]owned subsidiary|wholly[- ]owned subsidiary[^.]{0,120}(has been |was )?incorporated|incorporation of (a )?(wholly[- ]owned )?(step[- ]down )?subsidiary/i,
  acquisition: /business transfer agreement|share purchase agreement|acquisition of (the )?[\w\s]{0,60}(portfolio|business|division|brand|stake|shares|equity|ccps)|to acquire|acquire[sd]? (a )?\d|slump sale|investment in [A-Z][\w&.\- ]+ (private limited|limited|llp)|stake (acquisition|purchase)/i,
  // zzz787: a promoter / promoter-group BUYING shares is insider buying, not an acquisition.
  promoterBuy: /\bpromoters?\b(?: group)?[^.]{0,80}\b(acquired|acquires|acquisition of|purchased|purchases|bought|buys|increased (its |their )?(shareholding|stake))\b[^.]{0,120}(shares|stake|shareholding|%)|(acquisition|purchase) of [^.]{0,60}(shares|stake)[^.]{0,80}\bby (the |a |its )?(member of (the )?)?promoters?\b/i,
  promoterSale: /sale of (\w+ )?(equity )?shares[^.]{0,160}by (a |the )?(member of (its|the) )?promoter|minimum public shareholding|offer for sale \(ofs\)|promoter[^.]{0,40}(propos\w+ to sell|will sell|to offload)/i,
  merger: /scheme of (amalgamation|arrangement)|merger of [A-Z]|amalgamation of/i,
  partnership: /memorandum of understanding|\bmou\b|joint venture|strategic (partnership|alliance)|teaming agreement|collaboration agreement|technology (transfer|licensing) agreement/i,
  newProduct: /\blaunch(ed|es)?\b[^.]{0,60}(product|brand|range|variant|model|drug)|unveil(ed|s)?\b/i,
  results: /financial results for the (quarter|year|period)|unaudited (standalone|consolidated)? ?financial results|audited (standalone|consolidated)? ?financial results/i,
  routine: /listing (and|&) admission to dealings|admitted to dealings|opening of (a )?new branch|appoint\w*[^.]{0,80}(senior (general )?manager|general manager|head[- ]\w+|vice president)|bank is opening|investor (meet|conference|summit)|analyst(s)? (meet|call)|newspaper (publication|advertisement)|annual general meeting|postal ballot|scrutini[sz]er|trading window|record date|book closure|shareholding pattern|loss of share certificate|regulation 74\s*\(5\)|compliance certificate|dispatch of (the )?(annual report|notice)|e-?voting|endurance ride|plant visit|site visit/i,
};

const COUNTRIES = ['Chile', 'Malaysia', 'United Arab Emirates', 'UAE', 'Vietnam', 'Singapore', 'United States', 'USA', 'United Kingdom', 'UK', 'Germany', 'Netherlands', 'Mexico', 'Brazil', 'Kenya', 'Nigeria', 'South Africa', 'Saudi Arabia', 'Oman', 'Qatar', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Indonesia', 'Thailand', 'Philippines', 'Australia', 'Canada', 'France', 'Italy', 'Spain', 'Poland', 'Japan', 'China', 'Egypt', 'Morocco', 'Peru', 'Colombia', 'Argentina', 'Bhutan', 'Mauritius'];
const REGIONS = ['LATAM', 'Latin America', 'Middle East', 'Africa', 'Europe', 'North America', 'South East Asia', 'Southeast Asia', 'GCC'];
const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu'];

/** The body without the "About the company" boilerplate a press release ends with. */
export function eventBody(text: string): string {
  const m = /\bAbout (?:[A-Z][\w&.]*\s+){1,5}(?:Limited|Ltd\.?|Group)?\s*:?\s*(?=With|[A-Z])/.exec(text);
  return m && m.index > 400 ? text.slice(0, m.index) : text;
}

/** Where the EVENT is — read only from sentences about the event, never from a
 *  letterhead address or the "About us" paragraph. */
function geographyOf(text: string, trig: RegExp | null): string | null {
  const found: string[] = [];
  const sentences = sentencesOf(eventBody(text)).filter((s) => !/(regd\.?|registered|corporate|head|branch) off|cin\s*[:-]|tel\s*[:.]|phone|fax|e-?mail|scrip code|exchange plaza|dalal street|towers/i.test(s) || (trig && trig.test(s)));
  const rel = sentences.filter((s) => (trig && trig.test(s)) || /country of incorporation|incorporat|situated|located|facility at|plant at|project at|region|in the name of/i.test(s)).join(' ')
    .replace(/Republic of /g, '')
    .replace(/(?:regd\.?|registered|corporate|branch|head|works)\s*off(?:ice)?\.?\s*:?[\s\S]{0,180}/gi, ' ')
    .replace(/\b(?:[A-Z][a-z]+,\s*)*[A-Z][a-z]+\s*\[\s*\d{1,2}\s*(?:st|nd|rd|th)?\s*[A-Z][a-z]+\s*(?:\d{4})?\s*\]/g, ' ');
  for (const c of [...COUNTRIES, ...REGIONS]) if (new RegExp(`\\b${c.replace(/\s/g, '\\s+')}\\b`).test(rel)) found.push(c);
  if (!found.length) for (const st of STATES) if (new RegExp(`\\b${st}\\b`).test(rel)) { found.push(st); break; }
  const uniq = Array.from(new Set(found)).filter((x) => !(x === 'UAE' && found.includes('United Arab Emirates')) && !(x === 'USA' && found.includes('United States')) && !(x === 'UK' && found.includes('United Kingdom')));
  if (!uniq.length && /(?:awarded by domestic \/ international entity|whether domestic or international)\s*Domestic/i.test(text)) return 'Domestic (India)';
  return uniq.length ? uniq.slice(0, 3).join(', ') : null;
}

/** Order-of-priority classification of the body. */
/** The body without "the company is engaged in …" business descriptions,
 *  which name every activity the company has ever done. */
function eventSentences(text: string): string {
  return sentencesOf(eventBody(text)).filter((s) => !/is engaged in|engaged in the business|is in the business of|line of business|brief background about/i.test(s)).join('. ');
}

function kindOf(text0: string): { kind: EventKind | 'routine' | null; polarity: Polarity; sub?: 'subsidiary' | 'fine' | 'favourable' | 'merger' | 'promoter_sale' } {
  const text = eventSentences(text0);
  if (RX.taxProceeding.test(text) && (RX.taxWord.test(text) || /\bitat\b|appellate tribunal/i.test(text))) {
    return RX.taxFavourable.test(text) || favourableLegalOutcome(text) ? { kind: 'tax_litigation', polarity: 'positive', sub: 'favourable' } : { kind: 'tax_litigation', polarity: 'negative' };
  }
  if (RX.governanceFine.test(text)) return { kind: 'governance', polarity: 'negative', sub: 'fine' };
  if (RX.promoterSale.test(text)) return { kind: 'other', polarity: 'negative', sub: 'promoter_sale' };
  if (RX.promoterBuy.test(text) && !/\b(sold|sale of|disposed|offload|pledg)/i.test(text)) return { kind: 'promoter_buying', polarity: 'positive' };
  if (RX.order.test(text)) return { kind: 'order', polarity: 'positive' };
  if (RX.fundraising.test(text)) return { kind: 'fundraising', polarity: 'neutral' };
  if (RX.merger.test(text)) return { kind: 'other', polarity: 'neutral', sub: 'merger' };
  if (RX.qualification.test(text)) return { kind: 'qualification', polarity: 'positive' };
  if (RX.capacity.test(text)) return { kind: 'capacity', polarity: 'positive' };
  if (RX.subsidiaryIncorporation.test(text)) return { kind: 'other', polarity: 'neutral', sub: 'subsidiary' };
  if (RX.acquisition.test(text)) return { kind: 'acquisition', polarity: /withdrawn|revis(ed|ion)|terminat|call(ed)? off/i.test(text) ? 'neutral' : 'positive' };
  if (RX.partnership.test(text)) return { kind: 'partnership', polarity: 'positive' };
  if (RX.newProduct.test(text)) return { kind: 'new_product', polarity: 'positive' };
  if (RX.results.test(text)) return { kind: 'results', polarity: 'neutral' };
  if (RX.routine.test(text)) return { kind: 'routine', polarity: 'neutral' };
  return { kind: null, polarity: 'neutral' };
}

const TRIGGER: Partial<Record<EventKind, RegExp>> = {
  tax_litigation: /confirmed (a )?demand|dropped the demand|demand raised|tax demand|show[- ]cause|demand|appellate tribunal|\bitat\b|appeal/i,
  governance: /fine/i,
  order: new RegExp(RX.order.source, 'i'),
  fundraising: new RegExp(RX.fundraising.source, 'i'),
  qualification: new RegExp(RX.qualification.source, 'i'),
  capacity: new RegExp(RX.capacity.source, 'i'),
  acquisition: new RegExp(RX.acquisition.source, 'i'),
  partnership: new RegExp(RX.partnership.source, 'i'),
  promoter_buying: new RegExp(RX.promoterBuy.source, 'i'),
  new_product: new RegExp(RX.newProduct.source, 'i'),
  results: new RegExp(RX.results.source, 'i'),
};

// ── field extractors ────────────────────────────────────────────────────────

const ORG_END = String.raw`(?:Private Limited|Pvt\.? Ltd\.?|Limited|Ltd\.?|Corporation|LLP|SpA|SDN\.? BHD\.?|LLC|Inc\.?|GmbH|Pte\.? Ltd\.?|B\.V\.)`;
const ORG = String.raw`((?:[A-Z][A-Za-z0-9&'\-]*\.?\s+(?:of\s+|and\s+|&\s+)?){0,7}` + ORG_END + ')';

function counterpartyOf(text: string, kind: EventKind): string | null {
  if (kind === 'order') {
    const tab = new RegExp(String.raw`[Nn]ame of the entity awarding the order\S*\s*(?:\/\s*contract\S*)?\s*(?:M\/s\.?\s*)?` + ORG).exec(text);
    if (tab) return clean(tab[1]);
    const m = new RegExp(String.raw`(?:from|by)\s+(?:M\/s\.?\s*)?` + ORG + String.raw`(\s*\(\s*[A-Z][A-Z0-9&\-]{2,15}\s*\))?`).exec(text);
    if (m) return clean(`${m[1]}${m[2] ? ` ${m[2].replace(/\s+/g, '')}` : ''}`);
    const d = /(?:by|from)\s+(a leading [^.,;]{5,90}?(?:OEM|major|company|manufacturer|player|customer|PSU|utility))\b/i.exec(text);
    if (d) return clean(`${d[1]} (not named)`);
    return null;
  }
  if (kind === 'acquisition') {
    const s = new RegExp(String.raw`with\s+` + ORG + String.raw`\s*\(\s*["“]?\s*(?:the\s+)?["“]?[Ss]eller`).exec(text) || new RegExp(String.raw`investment in\s+` + ORG).exec(text) || new RegExp(String.raw`(?:acquire|acquisition of)[^.]{0,40}?(?:of|in|from)\s+` + ORG).exec(text);
    return s ? clean(s[1]) : null;
  }
  if (kind === 'tax_litigation') {
    const a = /name of the authority\s+([^0-9]{5,120}?)(?=\s+\d\s|\s+2\s|$)/i.exec(text) || /issued by (?:the )?(office of [^,.;]{5,90}|[A-Z][^,.;]{3,80}?commissioner[^,.;]{0,60})/i.exec(text) || /(income tax appellate tribunal[^,.;]{0,30}|principal commissioner \(appeals[^)]*\)|commissioner of gst[^,.;]{0,60})/i.exec(text);
    return a ? clean(a[1], 110) : null;
  }
  if (kind === 'qualification') {
    const a = /(?:from|by) (?:the )?((?:commissioner|ministry|department|directorate|office|government|dgca|usfda|cdsco)[^,.;]{3,90})/i.exec(text);
    return a ? clean(a[1], 110) : null;
  }
  if (kind === 'governance') {
    const a = /(?:by|from) (?:both )?(bse limited and (?:the )?national stock exchange of india limited|(?:the )?exchanges|bse(?: limited)?|nse)/i.exec(text);
    return a ? clean(a[1]) : null;
  }
  if (kind === 'partnership') {
    const m = new RegExp(String.raw`(?:with|between the company and)\s+` + ORG).exec(text);
    return m ? clean(m[1]) : null;
  }
  return null;
}

function productOf(text: string, kind: EventKind): string | null {
  const pats: RegExp[] = kind === 'order' ? [
    /(\d{2,3}\s*kV[^.;,]{3,80}?Package\s+[A-Z]{1,4}-?\s?\d+[A-Z]?)/i,
    /for (?:the )?assembly of ([^.;]{4,160}?)(?= for a | for the |[.;]|$)/i,
    /supply of ([^.;,]{4,100}?)(?=\s+s\b|,| along| pursuant|[.;]|$)/i,
    /scope spans ([^.;]{8,160}?)(?=,\s*extending|\s+across|[.;]|$)/i,
    /award covers ([^.;]{8,160}?)(?= across|[.;]|$)/i,
  ] : kind === 'capacity' ? [
    /(malt distillery[^.;,]{0,40}?)(?= with| at|[.;,]|$)/i,
    /(battery energy storage system \(bess\) project|battery energy storage system|bess project)/i,
    /manufacturing facility for ([^.;,]{3,60}?)(?= with|[.;,]|$)/i,
    /setting up (?:a |an |new )?([^.;,]{3,60}?(?:plant|facility|unit|warehouse)s?)/i,
  ] : kind === 'qualification' ? [
    /permit(?:s|ted)? the company to (manufacture [^.;]{3,80}?)(?= at | subject|[.;,]|$)/i,
    /licen[cs]e for (?:the )?(manufactur[^.;]{3,80}?)(?= at | Dear |[.;,]|$)/i,
    /(as ?9100d?|nadcap|usfda|who[- ]gmp)[^.;,]{0,40}/i,
  ] : kind === 'acquisition' ? [
    /acquisition of (?:the )?([A-Z][\w\- ]{2,40}?(?:Portfolio|Business|Division|Brand|Unit))/,
    /acquisition of ([\d,]+ (?:ccps|equity shares|shares)[^.;,]{0,30})/i,
  ] : kind === 'new_product' ? [
    /(?:unveil\w*|launch\w*|introduc\w*)\s+(?:the |a |an |its |new )*([^.;,]{4,80}?)(?= at | in | for | to |[.;,]|$)/i,
  ] : kind === 'other' ? [
    /(scheme of (?:amalgamation|arrangement)[^.;]{0,120}?)(?= under|[.;]|$)/i, /(merger of [^.;]{4,120}?)(?= with| into|[.;]|$)/i,
    /objective of ([^.;]{8,120})/i, /primary objective to ([^.;]{8,100})/i,
  ] : kind === 'tax_litigation' ? [
    /(form gst drc-0\d|show cause notice|demand cum show cause notice|assessment year \d{4}-\s?\d{2}|period involved\s+fy\s?\d{4}-\d{2})/i,
  ] : [];
  for (const p of pats) { const m = p.exec(text); if (m) return clean(m[1], 150); }
  return null;
}

function attributionOf(text: string): { entity: string; relation: 'subsidiary' } | null {
  const a = new RegExp(String.raw`(?:[Ii]ts|[Tt]he [Cc]ompany'?s|[Oo]ur)\s+(?:[A-Za-z]+\s+){0,2}[Ss]ubsidiary,?\s+` + ORG).exec(text)
    || new RegExp(ORG + String.raw`\s*(?:\(\s*["“]?[A-Z]{2,12}["”]?\s*\))?,?\s+a\s+(?:[Ww]holly[- ][Oo]wned\s+)?(?:[Ss]tep[- ][Dd]own\s+)?[Ss]ubsidiary`).exec(text)
    || new RegExp(String.raw`in the name (?:and style )?of\s+` + ORG).exec(text);
  if (a) { const e = clean(a[1], 90); if (e && !/^(the|a|an)\s/i.test(e)) return { entity: e, relation: 'subsidiary' }; }
  const g = /(?:company'?s|its)\s+([A-Z][a-z]+)\s+subsidiary\s+(?:has\s+)?(secured|won|wins|received|bagged|emerged)/i.exec(text);
  if (g) return { entity: `${g[1]} subsidiary (not named)`, relation: 'subsidiary' };
  return null;
}

function continuesOf(text: string): string | null {
  const m = /(with reference to (?:the |our )?(?:earlier )?(?:intimation|disclosure)[^.]{0,40}?dated|in continuation (?:of|to) (?:our |the )?(?:earlier )?(?:intimation|disclosure)[^.]{0,20}?dated|update to earlier disclosure dated|further to (?:our|the) (?:earlier )?(?:intimation|disclosure)[^.]{0,20}?dated|this is (?:in|with) reference to the disclosure made by the company on)\s*([0-9]{1,2}(?:st|nd|rd|th)?\s*[A-Z][a-z]+,?\s*\d{4}|[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i.exec(text);
  return m ? `earlier disclosure dated ${m[2].replace(/\s+/g, ' ').trim()}` : null;
}

function executionOf(text: string): string | null {
  const pats: RegExp[] = [
    /execution schedule (?:stipulated at|of) (\d+\s*months?[^.;,]{0,60}?)(?=[.;]|$)/i,
    /(\d+\s*months? from the date of [^.;,]{3,60})/i,
    /to be executed\s*:?\s*(?:by|within)?\s*([A-Z][a-z]+,?\s+\d{4}|\d+\s*(?:months?|days|weeks))/i,
    /executed (?:by|within)\s+([A-Z][a-z]+,?\s+\d{4}|\d+\s*(?:working )?(?:months?|days|weeks))/i,
    /within (\d+\s*(?:working )?(?:days|months|weeks))/i,
    /over (?:a period of )?(\d+\s*(?:months|years))/i,
  ];
  for (const p of pats) {
    const m = p.exec(text);
    if (!m) continue;
    // zzz824: "over 38 years" is the company's history, not an execution period — implausible durations are dropped
    const d = /(\d+)\s*(?:working\s+)?(years?|months?|weeks?|days?)/i.exec(m[1]);
    if (d) {
      const v = Number(d[1]), u = d[2].toLowerCase();
      if ((/^y/.test(u) && v > 15) || (/^mo/.test(u) && v > 180) || (/^w/.test(u) && v > 520) || (/^d/.test(u) && v > 3650)) continue;
    }
    return clean(m[1], 80);
  }
  return null;
}

function completionOf(text: string): string | null {
  const pats: RegExp[] = [
    /period within which the proposed capacity is to be added\s*(Q[1-4]\s*FY\s*\d{2,4})/i,
    /indicative time period for completion[^.]{0,40}?(on or before\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+,?\s+\d{4})/i,
    /(on or before\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+,?\s+\d{4})/i,
    /(?:expected to be (?:completed|commissioned|operational)|completion)\s*(?:by|in)\s+(Q[1-4]\s*FY\s*\d{2,4}|[A-Z][a-z]+\s+\d{4}|FY\s?\d{2,4})/i,
    /by (Q[1-4]\s*FY\s*\d{2,4})/i,
  ];
  for (const p of pats) { const m = p.exec(text); if (m) return clean(m[1], 60); }
  return null;
}

function milestonesOf(sentences: string[]): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    const m = /(production (?:commences|to commence|starts?|begins?)[^.;]{0,90}|commercial (?:production|operations?) (?:by|from|in)[^.;]{0,60}|first (?:delivery|supply|dispatch)[^.;]{0,60}|hearing (?:on|scheduled)[^.;]{0,40}|e-voting runs[^.;]{0,60})/i.exec(s);
    if (m) out.push(clean(m[1], 120)!);
  }
  return Array.from(new Set(out.filter(Boolean))).slice(0, 3);
}

function capacityOf(text: string): { before: string | null; after: string | null } {
  const unit = String.raw`(?:mn|million|lakh|crore)?\s*(?:bl|mt|mtpa|tpa|tonnes?|units|kl|klpd|mw|mwh|gw|pieces|pcs)\b(?:\s*(?:per (?:year|annum|day)|p\.?a\.?))?`;
  const after = new RegExp(String.raw`(\d+(?:\.\d+)?\s*MW\s*\/\s*\d+(?:\.\d+)?\s*MWh)`, 'i').exec(text)
    || new RegExp(String.raw`(?:capacity (?:addition |of )?|quantity of |proposed capacity addition\s*)~?\s*(~?[\d.,]+\s*` + unit + ')', 'i').exec(text);
  const before = new RegExp(String.raw`existing capacity\s*(?:of\s*)?~?\s*([\d.,]+\s*` + unit + ')', 'i').exec(text);
  return { before: before ? clean(before[1], 60) : null, after: after ? clean(after[1], 60) : null };
}

function capexOf(text: string, trigger: string | null): number | null {
  const re = /(?:aggregate (?:equity )?investment|investment required|capital (?:contribution|expenditure)|financial assistance|capex|investment)[^.;]{0,80}?(?:not exceeding|up to|upto|of|~|:)\s*((?:(?:rs\.?|inr|₹)\s*)?~?\s*[\d,]+(?:\.\d+)?\s*(?:crores?|cr\b))/i;
  const m = (trigger && re.exec(trigger)) || re.exec(text);
  return m ? moneyCr(m[1]) : null;
}

function allotteesOf(text: string): string[] {
  const out: string[] = [];
  const re = /\b\d{1,2}\s+([A-Z][A-Za-z&.'\- ]{2,70}?)\s+(?:Promoter Group|Non-Promoter|Promoter)\s+(?:Promoter Group|Non-Promoter|Promoter)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const n = clean(m[1], 80); if (n && !/^(name|sr|current|proposed)/i.test(n)) out.push(n); }
  if (!out.length) {
    const s = /(?:allot(?:ment|ted)? to|proposed allottees? (?:is|are|being))\s+([A-Z][^.;]{3,160})/.exec(text);
    if (s) out.push(...s[1].split(/,\s*|\s+and\s+/).map((x) => clean(x, 80)!).filter(Boolean).slice(0, 12));
  }
  return Array.from(new Set(out)).slice(0, 20);
}

function numberOf(s: string): number | null { const n = parseFloat(s.replace(/,/g, '')); return Number.isFinite(n) ? n : null; }

// ── the extraction ──────────────────────────────────────────────────────────

// zzz835: LOI / tentative / non-binding / MoU / "subject to approval" is PROPOSED - never booked, awarded or firm.
const PROPOSED_WORDING = /letter of intent|\bloi\b|\btentative|non-?binding|term sheet|memorandum of understanding|\bmou\b|in[- ]principle/i;
const STAGE_OF = (kind: EventKind, text: string, sub?: string): EventFacts['stage'] => {
  const st = STAGE_OF0(kind, text, sub);
  return PROPOSED_WORDING.test(text) && !/purchase order|notification of award|letter of award|work order/i.test(text) && (st === 'AWARDED' || st === 'SIGNED' || st === 'ANNOUNCED' || st === 'APPROVED') ? 'PROPOSED' : st;
};
const STAGE_OF0 = (kind: EventKind, text: string, sub?: string): EventFacts['stage'] => {
  if (kind === 'order') return /letter of intent|\bloi\b/i.test(text) && !/purchase order|notification of award|letter of award/i.test(text) ? 'PROPOSED' : 'AWARDED';
  if (kind === 'capacity') return /successful(ly)? commission|has been commissioned|commissioning of|commenced commercial/i.test(text) ? 'COMMISSIONED' : /approved|has approved|considered and approved/i.test(text) ? 'APPROVED' : 'PROPOSED';
  if (kind === 'fundraising') return /allotted|allotment of [\d,]+/i.test(text) && !/proposed allot/i.test(text) ? 'COMPLETED' : /approved/i.test(text) && !/proposed/i.test(text) ? 'APPROVED' : 'PROPOSED';
  if (kind === 'acquisition') return /has completed the acquisition|completed the acquisition|acquisition (is|has been) completed/i.test(text) ? 'COMPLETED' : /entered into|executed|signed|execution of (a |the )?(business transfer|share purchase)/i.test(text) ? 'SIGNED' : 'PROPOSED';
  if (kind === 'qualification') return 'APPROVED';
  if (kind === 'promoter_buying') return /propos|intend|will acquire/i.test(text) ? 'PROPOSED' : 'COMPLETED';
  if (kind === 'other' && sub === 'subsidiary') return /proposed incorporation|proposes to incorporate/i.test(text) && !/has been incorporated|completed the incorporation/i.test(text) ? 'PROPOSED' : 'COMPLETED';
  if (kind === 'governance') return /paid|payment of the levied|stands concluded|resolved and closed/i.test(text) ? 'COMPLETED' : 'ANNOUNCED';
  if (kind === 'tax_litigation') return sub === 'favourable' ? 'COMPLETED' : 'ANNOUNCED';
  return 'ANNOUNCED';
};

const KIND_WORD: Record<string, string> = {
  order: 'Order', capacity: 'Capacity', qualification: 'Licence / approval', acquisition: 'Acquisition', fundraising: 'Fundraise',
  partnership: 'Partnership', tax_litigation: 'Tax matter', governance: 'Exchange fine', new_product: 'New product', results: 'Results', other: 'Update',
  promoter_buying: 'Promoter stake purchase',
};

function headlineOf(f: Omit<IndiaFacts, 'headline'>, sub?: string): string {
  const e = f.economics, ev = f.event;
  const parts: string[] = [];
  const by = f.attribution ? ` (via subsidiary ${f.attribution.entity})` : '';
  switch (ev.kind) {
    case 'order':
      parts.push(`Order${ev.counterparty ? ` from ${ev.counterparty}` : ''}${e.valueNative != null ? ` worth ${fmtCr(e.valueNative)}` : ' (value not stated)'}${ev.product ? ` for ${ev.product}` : ''}${by}`);
      if (f.time.executionPeriod) parts.push(`to be executed in ${f.time.executionPeriod}`);
      break;
    case 'tax_litigation':
      parts.push(sub === 'favourable'
        ? `Tax appeal decided in the company's favour${e.valueNative != null ? ` (${fmtCr(e.valueNative)} demand dropped)` : ''}`
        : `Tax notice / demand${e.valueNative != null ? ` of ${fmtCr(e.valueNative)}` : ' (amount not stated)'}${ev.counterparty ? ` from ${ev.counterparty}` : ''}`);
      break;
    case 'governance': parts.push(`Exchange fine${e.valueNative != null ? ` of ${fmtCr(e.valueNative)}` : ''}${ev.stage === 'COMPLETED' ? ', paid and closed' : ''}`); break;
    case 'fundraising':
      parts.push(`${ev.stage === 'PROPOSED' ? 'Proposed ' : ''}equity raise${e.valueNative != null ? ` of ${fmtCr(e.valueNative)}` : ''}${e.sharesIssued != null ? `, ${e.sharesIssued.toLocaleString('en-IN')} shares` : ''}${e.issuePrice != null ? ` at ₹${e.issuePrice}` : ''}${e.allottees.length ? `, ${e.allottees.length} named allottees` : ''}`);
      break;
    case 'acquisition':
      parts.push(`Acquisition${ev.product ? ` of ${ev.product}` : ''}${ev.counterparty ? ` from/in ${ev.counterparty}` : ''}${e.considerationNative != null ? ` for ${fmtCr(e.considerationNative)}` : ''}${e.stakePct != null ? `, ${e.stakePct}% stake` : ''}`);
      if (f.time.expectedCompletion) parts.push(`completion ${f.time.expectedCompletion}`);
      break;
    case 'capacity':
      parts.push(`${ev.stage === 'COMMISSIONED' ? 'Commissioned' : ev.stage === 'APPROVED' ? 'Approved' : 'Proposed'} ${ev.product || 'capacity'}${e.capacityAfter ? ` (${e.capacityAfter})` : ''}${e.capex != null ? `, investment ${fmtCr(e.capex)}` : ''}${by}`);
      if (f.time.expectedCompletion) parts.push(`by ${f.time.expectedCompletion}`);
      break;
    case 'qualification': parts.push(`Licence / approval${ev.product ? ` for ${ev.product}` : ''}${e.capacityAfter ? ` (${e.capacityAfter})` : ''}${ev.counterparty ? ` from ${ev.counterparty}` : ''}`); break;
    case 'new_product': parts.push(`New product${ev.product ? `: ${ev.product}` : ''}`); break;
    case 'promoter_buying': parts.push(`Promoter stake purchase${e.stakePct != null ? ` of ${e.stakePct}%` : ''}${ev.counterparty ? ` by ${ev.counterparty}` : ''} — insider buying, not a business event`); break;
    case 'other':
      if (sub === 'promoter_sale') { parts.push(`Promoter share sale${e.sharesIssued != null ? ` of up to ${e.sharesIssued.toLocaleString('en-IN')} shares` : ''}${e.stakePct != null ? ` (${e.stakePct}%)` : ''} — supply, not a company event`); break; }
      if (sub === 'merger') { parts.push(`Group restructuring${ev.product ? ` — ${ev.product}` : ''}`); break; }
      if (sub === 'subsidiary') { parts.push(`Wholly owned subsidiary ${ev.stage === 'PROPOSED' ? 'proposed' : 'incorporated'}${f.attribution ? `: ${f.attribution.entity}` : ''}${ev.geography ? ` in ${ev.geography}` : ''}`); break; }
      parts.push('Update');
      break;
    default: parts.push(`${KIND_WORD[ev.kind] || 'Event'}${ev.counterparty ? ` with ${ev.counterparty}` : ''}`);
  }
  return parts.join('; ').slice(0, 220);
}

/** Read one document's text into every event it states. Pure. */
export function extractIndiaFacts(doc: IndiaDoc, ctx: ExtractContext = {}): DocExtraction {
  const text = normaliseDocText(doc.text);
  const valuesSeen = allMoney(text);
  if (text.length < 200) return { facts: [], routineReason: null, classified: false, valuesSeen };
  const k = kindOf(text);
  if (k.kind === 'routine') {
    const m = RX.routine.exec(text);
    return { facts: [], routineReason: m ? `routine: ${m[0].toLowerCase()}` : 'routine', classified: true, valuesSeen };
  }
  if (!k.kind) return { facts: [], routineReason: null, classified: false, valuesSeen };
  const kind = k.kind as EventKind;
  const sentences = sentencesOf(text);
  const trig = TRIGGER[kind] || (k.sub === 'subsidiary' ? RX.subsidiaryIncorporation : null);
  const triggerSentence = trig ? sentences.find((s) => trig.test(s)) || null : null;

  const econ = emptyEconomics();
  const time = emptyTime();
  const unknowns: string[] = [];
  let statedPotential: number | null = null;
  let fundMateriality: IndiaFacts['fundMateriality'] = null;

  const ev: EventFacts = {
    kind,
    counterparty: counterpartyOf(text, kind),
    product: productOf(eventBody(text), kind),
    geography: geographyOf(text, trig || null),
    stage: STAGE_OF(kind, text, k.sub),
  };
  const attribution = kind === 'tax_litigation' || kind === 'governance' ? null : attributionOf(text);

  // Economics by kind — only what is stated.
  if (kind === 'order') {
    const vs = /(?:order|contract)[^.;]{0,60}?(?:aggregating|worth|valued at|value of|of)\s*(?:approximately|about|approx\.?|~)?\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,]+(?:\.\d+)?\s*(?:crores?|cr\b|lakhs?|million)?)/i.exec(text)
      || /(?:total value of the said purchase order is|broad consideration or size of the order\S*\s*(?:\/\s*contract\S*)?)\s*((?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d+)?\s*(?:crores?|cr\b|lakhs?))/i.exec(text)
      || /secures?\s+((?:rs\.?|inr|₹)?\s*[\d,.]+\s*crores?)/i.exec(text);
    econ.valueNative = vs ? moneyCr(vs[1]) : null;
    const pot = /(?:business|revenue) potential of (?:approximately|about|~)?\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,.]+\s*(?:crores?|cr\b))/i.exec(text);
    if (pot) { statedPotential = moneyCr(pot[1]); if (econ.valueNative != null && statedPotential != null && Math.abs(econ.valueNative - statedPotential) < 0.01) econ.valueNative = null; }
    if (econ.valueNative != null) econ.currency = 'INR_CR';
    if (econ.valueNative == null) unknowns.push(statedPotential != null ? `Order value not stated — the filing gives only an annual business potential of about ${fmtCr(statedPotential)} at expected production rates, not a firm order value.` : 'Order value not stated.');
    if (!ev.counterparty) unknowns.push('Customer not named.');
    if (/inclusive of (applicable )?taxes|incl\.? taxes/i.test(text)) unknowns.push('Value includes taxes — the revenue share of it is not stated.');
  }
  if (kind === 'tax_litigation') {
    const d = /(?:confirmed|dropped|deleted)?\s*(?:a |the )?(?:tax )?demand(?: raised)?\s*(?:of\s*)?-?\s*((?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d+)?\s*(?:\/-|crores?|cr\b|lakhs?)?)/i.exec(text.replace(/confirmed,? out of the total demand of[^.]*?has confirmed/i, 'confirmed'));
    const confirmed = /has confirmed (?:a )?demand of\s*((?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d+)?)/i.exec(text) || /confirmed a demand of\s*((?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d+)?)/i.exec(text);
    econ.valueNative = moneyCr((confirmed || d)?.[1] || '');
    if (econ.valueNative != null) econ.currency = 'INR_CR';
    else unknowns.push('Amount of the demand not stated.');
    const pens = Array.from(text.matchAll(/penalty(?: raised| of)?\s*-?\s*((?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s*(?:\/-)?)/gi));
    const pen = pens.length ? pens[pens.length - 1] : null;   // the latest stage of the proceeding is stated last
    if (pen) { const p = moneyCr(pen[1]); if (p != null) time.milestones.push(`Penalty stated: ${fmtCr(p)}`); }
    if (k.polarity === 'negative') {
      if (/intends to (file an )?appeal|will (file an )?appeal|will respond|preferred an appeal/i.test(text)) time.milestones.push('Company says it will contest / appeal.');
      unknowns.push('Final outcome unknown — a contested tax demand is a contingent liability until the appeal ends.');
    }
  }
  if (kind === 'governance') {
    const f = /fine of\s*((?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?)/i.exec(text);
    econ.valueNative = f ? moneyCr(f[1]) : null;
    if (econ.valueNative != null) econ.currency = 'INR_CR';
  }
  if (kind === 'fundraising') {
    const sh = /(?:issue of|allot(?:ment of)?|up to)\s*([\d,]{4,})\s*(?:fully paid[- ]up\s+)?(?:equity shares|warrants|convertible warrants)/i.exec(text);
    econ.sharesIssued = sh ? numberOf(sh[1]) : null;
    const pr = /issue price of\s*(?:(?:rs\.?|inr|₹)\s*)?([\d,]+(?:\.\d+)?)/i.exec(text) || /at (?:a price of|an issue price of)?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?\s*(?:per|each)/i.exec(text);
    econ.issuePrice = pr ? numberOf(pr[1]) : null;
    const amt = /aggregating (?:up ?to|to)?\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,]+(?:\.\d+)?\s*(?:crores?|cr\b|lakhs?))/i.exec(text);
    econ.valueNative = amt ? moneyCr(amt[1]) : null;
    if (econ.valueNative != null) econ.currency = 'INR_CR';
    econ.allottees = allotteesOf(text);
    const dil = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:of the )?(?:post|expanded|enlarged)[- ](?:issue|preferential|share capital)/i.exec(text);
    if (dil) { econ.dilutionPct = numberOf(dil[1]); econ.ratios.push({ label: 'Dilution (stated)', value: econ.dilutionPct!, formula: 'as stated in the filing' }); }
    else if (econ.sharesIssued != null && ctx.sharesOutstanding && ctx.sharesOutstanding > 0) {
      econ.dilutionPct = r2((econ.sharesIssued / (ctx.sharesOutstanding + econ.sharesIssued)) * 100);
      econ.ratios.push({ label: 'Dilution', value: econ.dilutionPct, formula: `${econ.sharesIssued.toLocaleString('en-IN')} new shares ÷ (${ctx.sharesOutstanding.toLocaleString('en-IN')} existing + ${econ.sharesIssued.toLocaleString('en-IN')} new)` });
    }
    const missing: string[] = [];
    if (econ.valueNative == null) missing.push('amount');
    if (econ.dilutionPct == null) missing.push('dilution');
    if (econ.issuePrice == null) missing.push('issue price');
    if (!econ.allottees.length) missing.push('allottees');
    fundMateriality = { state: missing.length ? 'UNKNOWN' : 'KNOWN', missing };
    if (missing.length) unknowns.push(`Materiality unknown — not stated: ${missing.join(', ')}${missing.includes('dilution') ? ' (dilution needs the existing share count)' : ''}.`);
    if (!/objects? of the issue[^.]{0,20}(is|are|:)|use of proceeds/i.test(text)) unknowns.push('Use of the money not stated in this document.');
  }
  if (kind === 'acquisition') {
    const cap = /total consideration cap of\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,.]+\s*(?:crores?|cr\b))/i.exec(text)
      || /aggregate consideration[^.;]{0,80}?\bto\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,]+(?:\.\d+)?\s*(?:\/-|crores?|cr\b)?)/i.exec(text)
      || /(?:initial )?consideration of\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,.]+\s*(?:crores?|cr\b|\/-))/i.exec(text);
    econ.considerationNative = cap ? moneyCr(cap[1]) : null;
    if (econ.considerationNative != null) econ.currency = 'INR_CR';
    const initial = /initial consideration of\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,.]+\s*(?:crores?|cr\b))/i.exec(text);
    if (initial && /total consideration cap/i.test(text)) time.milestones.push(`Initial consideration ${fmtCr(moneyCr(initial[1]) || 0)} on closing; the rest is linked to future sales.`);
    const tr = /turnover[^.;]{0,60}?(?:was|of|:)\s*((?:(?:rs\.?|inr|₹)\s*)?[\d,.]+\s*(?:crores?|cr\b|lakhs?))/i.exec(text);
    econ.targetRevenueNative = tr ? moneyCr(tr[1]) : null;
    const st = /(?:hold|holding|stake|shareholding|control)[^.;]{0,90}?(\d{1,3}(?:\.\d+)?)\s*%/i.exec(text);
    econ.stakePct = st ? numberOf(st[1]) : null;
    if (econ.considerationNative == null) unknowns.push('Consideration not stated.');
    if (econ.targetRevenueNative == null) unknowns.push('Target turnover not stated.');
    if (econ.considerationNative != null && econ.targetRevenueNative != null && econ.targetRevenueNative > 0) {
      econ.ratios.push({ label: 'Consideration ÷ target turnover', value: r2(econ.considerationNative / econ.targetRevenueNative), formula: `${fmtCr(econ.considerationNative)} ÷ ${fmtCr(econ.targetRevenueNative)}` });
    }
  }
  if (kind === 'capacity' || kind === 'qualification') {
    const c = capacityOf(text);
    econ.capacityBefore = c.before; econ.capacityAfter = c.after;
    if (kind === 'capacity') {
      econ.capex = capexOf(text, triggerSentence);
      if (econ.capex != null) econ.currency = 'INR_CR';
      if (!c.after) unknowns.push('Capacity not stated.');
      if (econ.capex == null && ev.stage !== 'COMMISSIONED') unknowns.push('Investment not stated.');
      if (ev.stage === 'COMMISSIONED') unknowns.push('Revenue from the new capacity not stated.');
    }
  }
  if (kind === 'other' && k.sub === 'promoter_sale') {
    const sh = /up to ([\d,]{4,})\s*(?:\(|equity shares|shares)/i.exec(text) || /([\d,]{5,})\s*equity shares/i.exec(text);
    econ.sharesIssued = sh ? numberOf(sh[1]) : null;
    const pc = /(\d{1,2}\.\d+)\s*%/.exec(text);
    econ.stakePct = pc ? numberOf(pc[1]) : null;
    unknowns.push('Sale price and buyers not known in advance — an open-market sale.');
  }
  if (kind === 'promoter_buying') {
    const pc = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(text);
    econ.stakePct = pc ? numberOf(pc[1]) : null;
    unknowns.push('Purchase price and total holding after the purchase are not both stated — capital-allocation signal, not revenue.');
  }
  if (kind === 'other' && k.sub === 'subsidiary') {
    const st = /(?:percentage of shareholding|shareholding \/ control)[^%]{0,120}?(\d{1,3})\s*%/i.exec(text);
    econ.stakePct = st ? numberOf(st[1]) : null;
    unknowns.push('No revenue, order or investment size stated — a new subsidiary is a step, not business yet.');
  }
  if (econ.valueNative != null && ['order'].includes(kind)) {
    if (ctx.ttmRevenueCr && ctx.ttmRevenueCr > 0) econ.ratios.push({ label: 'Order value ÷ TTM revenue', value: r2(econ.valueNative / ctx.ttmRevenueCr), formula: `${fmtCr(econ.valueNative)} ÷ ${fmtCr(ctx.ttmRevenueCr)}` });
    if (ctx.marketCapCr && ctx.marketCapCr > 0) econ.ratios.push({ label: 'Order value ÷ market cap', value: r2(econ.valueNative / ctx.marketCapCr), formula: `${fmtCr(econ.valueNative)} ÷ ${fmtCr(ctx.marketCapCr)}` });
  }

  // Time.
  time.executionPeriod = kind === 'order' ? executionOf(text) : null;
  time.expectedCompletion = completionOf(text);
  time.milestones.push(...milestonesOf(sentences));
  if (kind === 'order' && !time.executionPeriod) unknowns.push('Execution period not stated.');

  // Verbatim quotes — the trigger, the value, the timeline — each verified.
  const quotes: string[] = [];
  const add = (q: string | null) => { if (q && !quotes.includes(q) && quotes.length < 3) quotes.push(q); };
  if (trig) add(quoteFor(text, sentences, trig));
  if (econ.valueNative != null || econ.considerationNative != null || econ.capex != null) add(quoteFor(text, sentences, /crores?|\/-|consideration|aggregating|rs\.?\s*[\d,]{5,}/i));
  if (statedPotential != null) add(quoteFor(text, sentences, /business potential/i));
  if (time.executionPeriod || time.expectedCompletion) add(quoteFor(text, sentences, /months? from|executed|on or before|to be added|completion/i));

  const continues = continuesOf(text);
  const seq = doc.accession ?? (doc.url ? docSeqOf(doc.url) : null);
  const source: SourceRef = {
    kind: doc.kind ?? (attribution ? 'SUBSIDIARY_FILING' : 'EXCHANGE_FILING'),
    access: doc.access ?? 'DOCUMENT_READ',
    issuer: doc.issuer, date: doc.date, accession: seq, url: doc.url, title: doc.title, hash: textHash(text),
  };
  const base: Omit<IndiaFacts, 'headline'> = {
    source, event: ev, economics: econ, time, quotes, unknowns: Array.from(new Set(unknowns)),
    verificationRequired: source.access !== 'DOCUMENT_READ' || !quotes.length,
    polarity: k.polarity, attribution, continues, relation: 'current',
    ...(statedPotential != null ? { statedPotentialNative: statedPotential } : {}),
    ...(fundMateriality ? { fundMateriality } : {}),
  };
  // zzz787: a new subsidiary is a STRATEGIC EXPANSION and a scheme of
  // amalgamation a MERGER — their own kinds, never 'acquisition' / 'other'.
  // (The body was read as 'other' + sub above; the headline keeps its words.)
  const headline = headlineOf(base, k.sub);
  const finalKind: EventKind = kind === 'other' && k.sub === 'subsidiary' ? 'strategic_expansion' : kind === 'other' && k.sub === 'merger' ? 'merger' : kind;
  return { facts: [{ ...base, event: { ...base.event, kind: finalKind }, headline }], routineReason: null, classified: true, valuesSeen };
}

// ── from facts to the sweep's vocabulary ────────────────────────────────────

/** The CatalystType a read event stands for (used to classify a filing whose
 *  subject could not be classified). */
export function catalystTypeOf(f: IndiaFacts): CatalystType | null {
  switch (f.event.kind) {
    case 'order': return 'order_win';
    case 'capacity': return f.event.stage === 'COMMISSIONED' ? 'production_ramp' : 'capacity_expansion';
    case 'qualification': return 'regulatory_approval';
    case 'acquisition': return 'acquisition';
    case 'fundraising': return 'fundraising';
    case 'partnership': return 'joint_venture';
    case 'stake_by_strategic': case 'strategic_investment': return 'strategic_investor';
    case 'strategic_expansion': return 'new_geography';
    case 'promoter_buying': return 'promoter_purchase';
    case 'capital_allocation': return 'buyback';
    case 'new_product': return 'new_product';
    case 'guidance': return 'revenue_guidance_increase';
    case 'results': return 'quarterly_result';
    case 'tax_litigation': return 'tax_litigation';
    case 'regulatory_negative': return 'regulatory_investigation';
    case 'other': return /subsidiary/i.test(f.headline) ? 'new_geography' : null;
    default: return null;
  }
}

/** The fact's stated money as the sweep's single value (₹ Cr). */
export const factValueCr = (f: IndiaFacts): number | null => f.economics.valueNative ?? f.economics.considerationNative ?? f.economics.capex ?? null;

/** Flat "what the filing states" map, shaped like the model reader's facts. */
export function flatFacts(f: IndiaFacts): Record<string, string> | null {
  const o: Record<string, string> = {};
  const e = f.economics;
  const v = factValueCr(f);
  if (v != null) o.value = fmtCr(v);
  if (f.event.counterparty) o.counterparty = f.event.counterparty;
  if (f.time.executionPeriod) o.execution_period = f.time.executionPeriod;
  if (f.time.expectedCompletion) o.completion = f.time.expectedCompletion;
  if (e.capacityAfter) o.capacity = e.capacityAfter;
  if (e.issuePrice != null) o.price_terms = `₹${e.issuePrice} per share`;
  if (e.stakePct != null) o.stake = `${e.stakePct}%`;
  if (f.attribution) o.subsidiary = f.attribution.entity;
  return Object.keys(o).length ? o : null;
}

// ── related history (a gainer's filing that continues an older one) ─────────

const STOP = new Set(['limited', 'private', 'company', 'india', 'indian', 'leading', 'order', 'orders', 'programme', 'program', 'contract', 'supply', 'subsidiary', 'services', 'business', 'major', 'global', 'named', 'wholly', 'owned', 'regulation', 'disclosure', 'intimation', 'announcement', 'update', 'updates', 'press', 'release', 'media', 'structures', 'components', 'equipment', 'project', 'projects', 'receipt', 'award', 'value', 'stated', 'worth', 'crore', 'crores', 'about', 'annual', 'approximately', 'which', 'their', 'there', 'other', 'under', 'within', 'months', 'first', 'second', 'third', 'shares', 'equity', 'total', 'group', 'industries', 'technologies', 'solutions', 'systems', 'multi', 'secures', 'wins', 'received', 'nomination', 'investment']);

/** Distinctive words of an event: counterparty, product, subsidiary. */
export function relationTokens(f: IndiaFacts, issuerName: string | null = null): string[] {
  const own = new Set(String(issuerName || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const hay = [f.event.counterparty, f.event.product, f.attribution?.entity].filter(Boolean).join(' ').toLowerCase();
  return Array.from(new Set(hay.split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w) && !own.has(w) && !/^\d+$/.test(w)))).slice(0, 12);
}

/** Older filings that talk about the same counterparty / programme. Pure:
 *  the caller passes the wider (≈365-day) announcement list it already has. */
export function relatedFilings<T extends { subject: string; summary: string | null; url: string; dateIso: string | null }>(current: IndiaFacts[], candidates: T[], opts: { excludeUrls: Set<string>; issuerName?: string | null; max?: number }): T[] {
  const toks = Array.from(new Set(current.filter((f) => f.polarity !== 'negative').flatMap((f) => relationTokens(f, opts.issuerName))));
  if (!toks.length) return [];
  const scored = candidates
    .filter((a) => !opts.excludeUrls.has(a.url))
    .map((a) => {
      const h = `${a.subject} ${a.summary || ''}`.toLowerCase();
      const hits = toks.filter((t) => new RegExp(`\\b${t}\\b`).test(h)).length;
      return { a, hits };
    })
    .filter((x) => x.hits >= 1 && !RX.routine.test(`${x.a.subject} ${x.a.summary || ''}`))
    .sort((x, y) => y.hits - x.hits || String(y.a.dateIso || '').localeCompare(String(x.a.dateIso || '')));
  return scored.slice(0, opts.max ?? 2).map((x) => x.a);
}

// ── evidence breadth, independent dimensions ────────────────────────────────

export function evidenceBreadthOf(facts: Array<Pick<StructuredFacts, 'source' | 'event'>>, refs: SourceRef[]): { documents: number; sourceKinds: number; eventKinds: number } {
  const docs = new Set<string>();
  for (const r of refs) if (r.access === 'DOCUMENT_READ') docs.add(r.hash || r.url || r.title);
  for (const f of facts) if (f.source.access === 'DOCUMENT_READ') docs.add(f.source.hash || f.source.url || f.source.title);
  const kinds = new Set<string>(refs.filter((r) => r.access !== 'SECONDARY_UNAVAILABLE' && r.access !== 'SOURCE_UNAVAILABLE').map((r) => r.kind));
  for (const f of facts) kinds.add(f.source.kind);
  // Event kinds only from official sources: a press headline is where to look, not a second event.
  return { documents: docs.size, sourceKinds: kinds.size, eventKinds: new Set(facts.filter((f) => f.source.kind !== 'PRESS').map((f) => f.event.kind)).size };
}

// ── choosing and reading documents (network through an injected fetcher) ────

export interface DocRead {
  url: string;
  date: string | null;
  title: string;
  seq: string | null;
  hash: string | null;
  access: 'DOCUMENT_READ' | 'SOURCE_UNAVAILABLE';
  facts: IndiaFacts[];
  routineReason: string | null;
  classified: boolean;
  valuesSeen: number[];
  relation: 'current' | 'history';
  /** Other filing URLs that turned out to be the same document (same text hash). */
  sameAs?: string[];
  /** zzz803: verbatim sentences of the document that name an event (in-event-taxonomy), ≤ 8 —
   *  the company's own words for the India card (a clarification reply, a results press release). */
  eventLines?: string[];
}

export const INDIA_READ_BUDGET = 3;
export const INDIA_HISTORY_BUDGET = 2;

/** Which filings to open, cheapest first to matter: the top candidate, every
 *  generic-subject or unclassified filing, then any other catalyst / negative
 *  filing (so a positive and a negative in the same window are both read). */
export function chooseDocuments<T extends { url: string; subject: string; kind: string; dateIso: string | null }>(inWindow: T[], topUrl: string | null, budget = INDIA_READ_BUDGET): T[] {
  const openable = (a: T) => !!a.url && !/corp-announcements\/?$/.test(a.url);
  const out: T[] = [];
  const push = (a: T | undefined) => { if (a && openable(a) && !out.some((x) => x.url === a.url) && out.length < budget) out.push(a); };
  push(inWindow.find((a) => a.url === topUrl));
  const newest = [...inWindow].sort((x, y) => String(y.dateIso || '').localeCompare(String(x.dateIso || '')));
  for (const a of newest) if (a.kind === 'unclassified' || (isGenericSubject(a.subject) && a.kind !== 'catalyst' && a.kind !== 'negative')) push(a);
  for (const a of newest) if (a.kind === 'catalyst' || a.kind === 'negative' || a.kind === 'denial') push(a);
  return out;
}

const docMem = new Map<string, DocRead>();
export const docCacheKey = (issuer: string, date: string | null, seq: string | null, url: string) =>
  `ai-gainers:indoc:${INDIA_EXTRACT_VERSION}:${issuer}:${String(date || '').slice(0, 10)}:${seq || createHash('sha1').update(url).digest('hex').slice(0, 12)}`;

/** Read up to `budget` documents, each at most once (memory + KV cache keyed
 *  by issuer + date + sequence id; the PDF text itself is cached by URL in
 *  extractPdfText). Two filings with the same text hash count once. */
export async function readIndiaDocuments(
  issuer: string,
  picks: Array<{ url: string; subject: string; dateIso: string | null }>,
  fetchText: (url: string) => Promise<string>,
  opts: { ctx?: ExtractContext; relation?: 'current' | 'history'; kv?: { get: (k: string) => Promise<any>; set: (k: string, v: any, ttl: number) => Promise<any> } | null; deadlineMs?: number } = {},
): Promise<DocRead[]> {
  const t0 = Date.now();
  const out: DocRead[] = [];
  for (const a of picks) {
    if (opts.deadlineMs != null && Date.now() - t0 > opts.deadlineMs) break;
    const seq = docSeqOf(a.url);
    const key = docCacheKey(issuer, a.dateIso, seq, a.url);
    let r: DocRead | null = docMem.get(key) || null;
    if (!r && opts.kv) { try { const hit = await opts.kv.get(key); if (hit && Array.isArray(hit.facts)) r = hit as DocRead; } catch { /* cold cache */ } }
    if (!r) {
      let text = '';
      try { text = await fetchText(a.url); } catch { text = ''; }
      if (!text || text.length < 200) {
        out.push({ url: a.url, date: a.dateIso, title: a.subject, seq, hash: null, access: 'SOURCE_UNAVAILABLE', facts: [], routineReason: null, classified: false, valuesSeen: [], relation: opts.relation || 'current' });
        continue;   // a failed read is never cached: the next sweep tries again
      }
      const x = extractIndiaFacts({ text, issuer, date: a.dateIso, url: a.url, title: a.subject }, opts.ctx || {});
      r = { url: a.url, date: a.dateIso, title: a.subject, seq, hash: textHash(text), access: 'DOCUMENT_READ', facts: x.facts, routineReason: x.routineReason, classified: x.classified, valuesSeen: x.valuesSeen, relation: opts.relation || 'current', eventLines: indiaEventLines(text) };
      docMem.set(key, r);
      if (opts.kv) { try { await opts.kv.set(key, r, 30 * 24 * 3600); } catch { /* optional */ } }
    }
    const rel = opts.relation || 'current';
    const facts = r.facts.map((f) => ({ ...f, relation: rel }));
    const dup = out.find((d) => d.hash && d.hash === r!.hash);
    if (dup) { dup.sameAs = Array.from(new Set([...(dup.sameAs || []), a.url])); continue; }
    out.push({ ...r, facts, relation: rel });
  }
  return out;
}
