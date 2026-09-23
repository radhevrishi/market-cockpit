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
import { classifyUsFiling, fmtUsdM } from './us-gainers';

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

export interface Returns { m1: number | null; m3: number | null; m6: number | null; y1: number | null; history: number }

export interface Finding {
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
  components: { freshness: number; materiality: number; transmission: number; persistence: number; sourceMult: number; pricedIn: number } | null;
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
}

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
  // seven senior leaders") were left "not classifiable". (zzz768)
  mgmtChange: /departure of (directors|certain officers)|item 5\.02|appointment of (chief|ceo|cfo|managing director)|resignation of (chief|ceo|cfo|managing director)|(resign(ed|s|ation)?|appoint(ed|s|ment)?|designated|re-?designat\w*|steps? down|stepped down)\b[^.]{0,80}\b(chief|ceo|cfo|coo|chro|cto|cmo|managing director|whole[- ]time director|president|senior (management|leadership|leaders)|company secretary)\b/i,
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
  const t = text.replace(/,/g, '').replace(/(impl(y|ies|ying)|estimat(e|ed|es|ing)|potential(ly)?|opportunity|could|may|might|expected to|up to|targeting|aims?|envisag|projected|likely)[^.]{0,60}?(₹|rs\.?|inr|usd|\$)\s*[\d.]+\s*(crore|cr\b|crores|lakh|lacs?|million|mn|billion|bn|m\b)/gi, ' ');
  if (market === 'IN') {
    const cr = /(?:₹|rs\.?|inr)\s*([\d.]+)\s*(crore|cr\b|crores)/i.exec(t) || /([\d.]+)\s*(crore|crores|\bcr\b)/i.exec(t);
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
  const hay = `${a.subject} ${a.summary || ''}`;
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
  if (/authori[sz]ed[^.]{0,40}\bkmps?\b|\bkmps?\b[^.]{0,40}authori[sz]ed[^.]{0,40}materiality/i.test(hay)) return { ...base, kind: 'routine', valueStated: null, routineReason: 'KMP authorisation under Reg 30' };
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
export function returnsFromSeries(series: Array<[string, number]>): Returns {
  const v = series.map(([, c]) => c).filter((c) => Number.isFinite(c) && c > 0);
  const last = v[v.length - 1];
  const back = (n: number) => (v.length > n && last ? ((last / v[v.length - 1 - n]) - 1) * 100 : null);
  // A year of trading is ~247–252 sessions; a series of 247 points IS a year.
  const y1 = v.length >= 240 ? back(Math.min(247, v.length - 1)) : null;
  return { m1: back(21), m3: back(63), m6: back(126), y1, history: v.length };
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

export function pricedInOf(r: Returns | null): number {
  if (!r) return 15;
  const w = (v: number | null, k: number) => (v == null ? 0 : v * k);
  const denom = [r.m1, r.m3, r.m6, r.y1].filter((x) => x != null).length ? 1 : 0;
  if (!denom) return 15;
  const blended = w(r.m1, 0.40) + w(r.m3, 0.35) + w(r.m6, 0.15) + w(r.y1, 0.10);
  return blended >= 100 ? 100 : blended >= 50 ? 80 : blended >= 25 ? 60 : blended >= 10 ? 35 : blended >= 0 ? 15 : 0;
}

export function scoreCatalyst(c: ClassifiedAnnouncement, opts: { marketCap: number | null; returns: Returns | null; sourceTier: Finding['sourceTier']; verifiedQuote: boolean }): { net: number; components: NonNullable<Finding['components']>; verdict: Verdict; valuePctMcap: number | null } {
  const freshness = FRESH(c.ageDays);
  const mat = materialityOf(c, opts.marketCap);
  let transmission = TRANSMISSION[String(c.category || '')] ?? 40;
  if (c.stage === 'enabling') transmission = Math.min(transmission, 20);
  if (c.stage === 'scheduled') transmission = Math.min(transmission, 40);
  const persistence = PERSISTENCE[String(c.category || '')] ?? 40;
  const sourceMult = opts.sourceTier === 'primary' ? (opts.verifiedQuote ? 1.0 : 0.85) : opts.sourceTier === 'secondary' ? 0.75 : opts.sourceTier === 'tertiary' ? 0.4 : 0;
  const pricedIn = pricedInOf(opts.returns);
  let net = (0.30 * freshness + 0.30 * mat.score + 0.25 * transmission + 0.15 * persistence) * sourceMult * (1 - pricedIn / 100);
  let verdict: Verdict;
  if (mat.gated) { net = Math.min(net, 17); verdict = 'THIN'; }
  else {
    // An event with no stated value cannot be FIRE: "never let an unmeasured
    // event pay the same as a measured 30%-of-mcap one." It can still be ROOM.
    if (mat.pct == null && net >= 45) net = 44.9;
    // An appointment or a resignation moves no revenue. INOD's new director
    // scored 44 — "ROOM, not yet priced in" — on freshness alone. It is shown
    // as a dated fact and capped at WEAK. (zzz767)
    if (c.category === 'management_change') net = Math.min(net, 15);
    verdict = net >= 45 ? 'FIRE' : net >= 30 ? 'ROOM' : net >= 18 ? 'PRICED' : net >= 8 ? 'WEAK' : 'NONE';
  }
  return { net: Math.round(net * 10) / 10, components: { freshness, materiality: mat.score, transmission, persistence, sourceMult, pricedIn }, verdict, valuePctMcap: mat.pct == null ? null : Math.round(mat.pct * 100) / 100 };
}

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
    .map((a) => ({ a, s: scoreCatalyst(a, { marketCap: opts.marketCap, returns: opts.returns, sourceTier: 'primary', verifiedQuote: false }).net }))
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
  read?: { url: string; headline: string; quote: string; category: CatalystType; valueStated?: number | null } | null;
}

export function buildFinding(inp: SweepInput): Finding {
  const now = inp.now.toISOString();
  const allInWindow = inp.announcements
    .map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, inp.now) }))
    .filter((a) => a.ageDays == null || a.ageDays <= inp.windowDays)
    .map((a) => classifyAnnouncement(a, inp.market));
  const afterClose = allInWindow.filter((a) => filedAfterClose(a.dateIso, inp.sessionCloseIso));
  const inWindow = allInWindow.filter((a) => !filedAfterClose(a.dateIso, inp.sessionCloseIso));
  const band = bandPrint(inp.movePct, inp.turnover, inp.market);
  const listingDays = inp.returns && inp.returns.history > 0 && inp.returns.history < 60 ? inp.returns.history : null;
  const base: Finding = {
    ticker: inp.ticker, company: inp.company, market: inp.market, movePct: inp.movePct, marketCap: inp.marketCap, turnover: inp.turnover,
    status: 'none', category: null, stage: null, headline: null, evidenceQuote: null, sourceUrl: null, sourceDate: null, sourceTier: 'unsourced',
    ageDays: null, valueStated: null, valuePctMcap: null, net: null, components: null, verdict: null,
    returns: inp.returns, bandPrint: band.band, bandLevel: band.level, listingDays,
    routine: inWindow.filter((a) => a.kind === 'routine').map((a) => a.subject).slice(0, 6),
    filingsInWindow: inWindow.length, windowDays: inp.windowDays, holding: inp.holding, notes: [], modelRead: !!inp.read,
    researchedAt: now, sources: inp.sources,
  };
  if (band.band) base.notes.push(`Closed at the ${band.level}% band${inp.turnover != null ? ` (avg daily value ~${fmtMoney(inp.turnover, inp.market)}, 1-week average)` : ''} — a band print measures the band, not demand.`);
  const lateSubstantive = afterClose.filter((a) => a.kind === 'catalyst' || a.kind === 'negative' || a.kind === 'denial');
  if (lateSubstantive.length) base.notes.push(`Filed after the session closed, so it cannot explain this move: ${lateSubstantive.slice(0, 2).map((a) => `${short(a.summary || a.subject)} (${fmtDate(a.dateIso)})`).join('; ')}.`);
  if (inp.returns && inp.returns.m1 != null && inp.returns.m3 != null && inp.returns.m1 < 0 && inp.returns.m3 < 0) base.notes.push(`Down ${fmtPct(inp.returns.m1)} over 1M and ${fmtPct(inp.returns.m3)} over 3M — a one-day bounce in a falling stock, not a gainer.`);

  if (inp.sourceFailed && !inWindow.length) return { ...base, status: 'source_failed', notes: [...base.notes, 'The filing source could not be reached — this is not "nothing filed".'] };
  // No price history at all (a name too new for the chart API) plus the
  // paperwork a fresh listing files — Reg 7 / Reg 8(2) / listing intimation
  // — is a recent listing until proven otherwise.
  if (!inp.returns && inWindow.some((a) => /regulation 7\b|regulation 8\(2\)|listing of (equity|shares)|allotment of equity shares pursuant to (the )?(ipo|initial public)|basis of allotment/i.test(`${a.subject} ${a.summary || ''}`))) {
    return { ...base, status: 'listing_artifact', headline: 'No price history and listing paperwork in the window — a recent listing, no comparable prior close', sourceUrl: inWindow[0].url, sourceDate: inWindow[0].dateIso, sourceTier: 'primary' };
  }
  if (listingDays != null) {
    base.notes.push(`Only ${listingDays} sessions of price history — a recent listing; trailing returns mean nothing yet.`);
  }

  // Reject-first. A denial or a negative filing in the window is the finding,
  // whatever else was filed alongside it.
  // A denial rejects the move UNLESS a catalyst was filed at or after it:
  // TEGA denied undisclosed information on 18 Sep for the 17 Sep spike, then
  // filed a ₹126 Cr contract later the same day. The contract is the finding
  // and the denial is a note — the earlier spike stays formally denied.
  const denial = inWindow.find((a) => a.kind === 'denial');
  const laterCatalyst = denial && inWindow.some((a) => a.kind === 'catalyst' && (a.dateIso || '') >= (denial.dateIso || ''));
  if (denial && !laterCatalyst) return { ...base, status: 'denied', headline: `Company told the exchange it has no undisclosed information (${fmtDate(denial.dateIso)})`, sourceUrl: denial.url, sourceDate: denial.dateIso, sourceTier: 'primary', ageDays: denial.ageDays, notes: [...base.notes, 'A denial on a stock that is moving is a caution flag, not a catalyst.'] };
  if (denial) base.notes.push(`Company denied any undisclosed information on ${fmtDate(denial.dateIso)} (exchange query) — that answered an earlier spike; a filing followed.`);
  const isNegCat = (x: unknown) => (NEGATIVE_CATALYSTS as readonly string[]).includes(String(x));
  const hasCatalyst = inWindow.some((a) => a.kind === 'catalyst')
    || (!!inp.read && !isNegCat(inp.read.category) && inWindow.some((a) => a.url === inp.read!.url && a.kind === 'unclassified'));
  // US: an offering filed beside a real catalyst is supply INTO the move — a
  // flag on that catalyst, not a replacement for it. On its own it is the
  // finding. (zzz766)
  const dilution = inp.market === 'US' ? inWindow.find((a) => a.kind === 'negative' && a.category === 'dilution') : undefined;
  const negative = inWindow.find((a) => a.kind === 'negative' && !(a === dilution && hasCatalyst));
  if (negative && inp.market === 'US') return { ...base, status: 'negative', category: negative.category, headline: shorten(negative.routineReason || negative.subject, 140), sourceUrl: negative.url, sourceDate: negative.dateIso, sourceTier: 'primary', ageDays: negative.ageDays, notes: [...base.notes, negative.category === 'dilution' ? 'An offering / registration is supply, not demand: it dilutes or releases stock for sale. No catalyst was filed beside it.' : 'A negative filing in the window. The move is not explained by it.'] };
  if (negative) return { ...base, status: 'negative', category: negative.category, headline: shorten(negative.summary || negative.subject), sourceUrl: negative.url, sourceDate: negative.dateIso, sourceTier: 'primary', ageDays: negative.ageDays, notes: [...base.notes, 'The only substantive in-window filing is negative. The move is not explained by it.'] };
  const query = inWindow.find((a) => a.kind === 'exchange_query');

  // The candidate: the freshest catalyst-kind filing, executed before
  // scheduled before enabling, larger stated value first.
  // The candidate is whichever catalyst-kind filing SCORES highest under the
  // same rule the finding is scored by — a ₹279 Cr order two days old beats a
  // same-day rating outlook change, and an executed item beats an enabling
  // one, because the score already says so.
  const cands = inWindow.filter((a) => a.kind === 'catalyst')
    .map((a) => ({ a, s: scoreCatalyst(a, { marketCap: inp.marketCap, returns: inp.returns, sourceTier: 'primary', verifiedQuote: false }).net }))
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
  if (listingDays != null) {
    // A recent listing is not a gainer, whatever it filed: there is no
    // comparable prior close, so the return is the listing, not the news.
    return { ...base, status: 'listing_artifact', headline: `Listed ~${listingDays} sessions ago — no comparable prior close${cands.length ? `; filed: ${shorten(cands[0].summary || cands[0].subject, 70)}` : ''}`, sourceUrl: cands[0]?.url || null, sourceDate: cands[0]?.dateIso || null, sourceTier: cands.length ? 'primary' : 'unsourced' };
  }
  if (!cands.length) {
    if (!inWindow.length) return { ...base, status: 'none', headline: afterClose.length ? `No filing before the session closed (${afterClose.length} filed after it)` : `No filing in the last ${inp.windowDays} days`, notes: [...base.notes, ...(query ? [`Exchange query on ${fmtDate(query.dateIso)} — reply pending.`] : [])] };
    const uncl = inWindow.filter((a) => a.kind === 'unclassified');
    const headline = uncl.length
      ? `${inWindow.length} filing${inWindow.length === 1 ? '' : 's'} in window; ${uncl.length} not classifiable from the subject (${uncl.slice(0, 2).map((a) => short(a.summary || a.subject)).join('; ')})`
      : `${inWindow.length} filing${inWindow.length === 1 ? '' : 's'} in window, all routine (${base.routine.slice(0, 2).map(short).join('; ')})`;
    return { ...base, status: 'routine_only', headline, sourceUrl: (uncl[0] || inWindow[0]).url, sourceDate: (uncl[0] || inWindow[0]).dateIso, ageDays: (uncl[0] || inWindow[0]).ageDays, sourceTier: 'primary', notes: [...base.notes, ...(query ? [`Exchange query on ${fmtDate(query.dateIso)} — reply pending.`] : []), ...(uncl.length ? ['An unclassified filing is worth opening: the subject line was generic and the summary matched no event pattern.'] : [])] };
  }
  let c = cands[0];
  const verified = !!inp.read && inp.read.url === c.url;
  if (verified && inp.read) {
    if (inp.market === 'US' && isNegCat(inp.read.category)) {
      return { ...base, status: 'negative', category: inp.read.category, headline: inp.read.headline, evidenceQuote: inp.read.quote, sourceUrl: c.url, sourceDate: c.dateIso, sourceTier: 'primary', ageDays: c.ageDays, notes: [...base.notes, 'Model-read filing; the quote was found verbatim in the document. The filing is negative.'] };
    }
    c = { ...c, category: inp.read.category, valueStated: inp.read.valueStated ?? c.valueStated };
  }
  // Debt is financing, whichever reader filed it as a raise. (zzz768 — KUANTUM NCDs)
  const cHay = `${c.subject} ${c.summary || ''} ${verified && inp.read ? inp.read.headline : ''}`;
  if (c.category === 'fundraising' && RX.debtOnly.test(cHay) && !RX.equityWords.test(cHay)) {
    return { ...base, status: 'routine_only', headline: `Debt financing — ${shorten(c.summary || c.subject, 90)}`, sourceUrl: c.url, sourceDate: c.dateIso, ageDays: c.ageDays, sourceTier: 'primary', notes: [...base.notes, 'Borrowing is financing, not a catalyst.'] };
  }
  const scored = scoreCatalyst(c, { marketCap: inp.marketCap, returns: inp.returns, sourceTier: 'primary', verifiedQuote: verified });
  // An offering into the move caps the verdict below FIRE (zzz766).
  if (dilution && scored.verdict === 'FIRE') { scored.net = Math.min(scored.net, 44.9); scored.verdict = 'ROOM'; }
  const notes = [...base.notes];
  if (c.stage === 'enabling') notes.push('ENABLING, not executed: a board considering something has no size, no price and no counterparty yet.');
  if (c.stage === 'scheduled') notes.push('SCHEDULED, not executed: dated in the future. Nothing has been produced yet.');
  if (!c.incremental) notes.push('Reads as a renewal or re-announcement, not an increment — materiality capped.');
  if (c.category === 'product_qualification' || c.category === 'regulatory_approval') notes.push('Qualification permits work; it books none.');
  if (c.category === 'rating_action' && /reaffirm|affirm/i.test(`${c.subject} ${c.summary || ''}`) && !/upgrad/i.test(`${c.subject} ${c.summary || ''}`)) notes.push('A reaffirmation is not an upgrade.');
  if (c.category === 'fundraising') notes.push('A raise is supply, not demand — dilution unless the use of proceeds is disclosed.');
  if (c.category === 'quarterly_result' && !verified) notes.push('Results filed — the filing is the dated event; whether the numbers were good was not read here.');
  if (dilution) notes.push(`⚠ Offering filed in the window (${shorten(dilution.subject, 60)}, ${fmtDate(dilution.dateIso)}) — supply into the move.`);
  if (scored.valuePctMcap != null && inp.movePct != null && scored.valuePctMcap < 2 && Math.abs(inp.movePct) >= 8) notes.push(`Item is ${scored.valuePctMcap}% of market cap against a ${fmtPct(inp.movePct)} move — look for the real driver.`);
  if (scored.components.pricedIn >= 80) notes.push(`Largely priced: ${fmtPct(inp.returns?.m1 ?? null)} 1M / ${fmtPct(inp.returns?.m3 ?? null)} 3M.`);
  if (!verified) notes.push('Headline from the filing subject and the source\'s summary; the document itself was not model-read — treat the figure as unverified.');
  return {
    ...base, status: 'catalyst', category: c.category, stage: c.stage,
    headline: verified && inp.read ? inp.read.headline : shorten(c.summary || c.subject),
    evidenceQuote: verified && inp.read ? inp.read.quote : null,
    sourceUrl: c.url, sourceDate: c.dateIso, sourceTier: 'primary', ageDays: c.ageDays,
    valueStated: c.valueStated, valuePctMcap: scored.valuePctMcap, net: scored.net, components: scored.components, verdict: scored.verdict,
    notes,
  };
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
const short = (s: string) => shorten(s, 40);
export function fmtPct(v: number | null): string { return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`; }
export function fmtDate(iso: string | null): string { return iso ? iso.slice(0, 10) : 'undated'; }
export function fmtMoney(v: number, market: 'IN' | 'US'): string { return market === 'IN' ? `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1)} Cr` : fmtUsdM(v); }

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
