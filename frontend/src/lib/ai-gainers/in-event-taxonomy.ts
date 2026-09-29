// ═══════════════════════════════════════════════════════════════════════════
// INDIA CATALYST TAXONOMY — EXCHANGE-FILING + PRESS WORDING, KEYWORD RULES.
//                                                                    (zzz803)
//
// The owner's complaint on the India board: names with real catalysts came
// back "no catalyst / no fresh catalyst". His reference ranking for the day:
//   Whirlpool India  — parent (Whirlpool Mauritius) may sell its remaining
//                      promoter stake (press, unconfirmed)
//   Shanti Gold      — strong Q1 growth, an accounting-policy restatement,
//                      promoter stake movement, AGM
//   Taneja Aerospace — latest quarterly numbers (+ aerospace theme)
//   Allied Digital   — Q1 revenue up 19% YoY to ₹260 crore; a senior
//                      executive resigned
//   Avadh Sugar      — back to profit, but only ₹0.24 crore (turnaround, small)
//   Bhageria         — exchange clarification: volume market-driven, nothing
//                      undisclosed (no fundamental catalyst — the clarification
//                      itself is the event)
//   Steelcast / TCI / Advit — analyst meet / board meeting / trading window
//                      (routine: no fresh catalyst)
// Three things hid them: the 21-day window dropped a quarterly result filed
// 40+ days ago that is still the latest fundamental news; a results filing
// was classified as paperwork; and press / filing wording like "promoter set
// to sell entire stake", "restated", "turns profitable", "resigns as CFO",
// "clarification on volume movement" matched no rule.
//
// This module mirrors us-event-taxonomy.ts (zzz801) with India wording:
// "Reg 30", "SAST", "Regulation 29", "open offer", "crore", "lakh", "LOA",
// "work order", "outcome of board meeting", "clarification on price
// movement", "financial results", "restated" … It reads plain text (a filing
// subject + summary, a read document's sentences, a press headline) sentence
// by sentence and returns every event it can name, each with:
//   · a plain-English label and one of ten categories,
//   · a direction HINT (positive / negative / mixed / neutral) — never a
//     trade instruction,
//   · the evidence sentence exactly as written,
//   · the figures (₹ crore / lakh, %, bps, MW, TPA …) LITERALLY present in
//     that sentence — never computed, rounded or borrowed,
//   · `routine: true` for paperwork (analyst meet, trading window, board
//     meeting intimation, AGM / record date …) — named, never a catalyst.
//
// buildIndiaCard() turns a name's filings (in-window + up to 60 days of
// results) and its press headlines into the card the view renders: the lead
// event, the filed-vs-press honesty label, the latest quarterly result as the
// fundamental BACKDROP when nothing fresher exists, the price / volume
// clarification as the event when that is all there is, the routine list —
// and, when there is nothing, the plain line "No catalyst found in filings or
// news". Unknown is never negative; silence never passes.
//
// Pure: no fetch, no clock (the caller passes `now`), no model.
// ═══════════════════════════════════════════════════════════════════════════

import { causalWindow, directionOf, directionNote, subtypeOf, isPlausibleAmount, contextTag, type EconDirection, type EventSubtype, exchangeAgeDays, exchangeDate, exchangeDay, reconcileValues, stageFromText, type CausalWindow, type EventStage, type EventValue, type ValueStatus } from './structured-facts';

export type InEventCategory =
  | 'Results' | 'Ownership & control' | 'Orders & business' | 'Capacity & capex' | 'Corporate action'
  | 'Capital raising' | 'Management & governance' | 'Regulatory & legal' | 'Exchange disclosure' | 'Routine'
  // zzz836: a credit rating is a balance-sheet / credit event - never guidance, never a result
  | 'Balance sheet / credit';

export const IN_EVENT_CATEGORIES: InEventCategory[] = [
  'Results', 'Ownership & control', 'Orders & business', 'Capacity & capex', 'Corporate action',
  'Capital raising', 'Management & governance', 'Regulatory & legal', 'Exchange disclosure', 'Routine', 'Balance sheet / credit',
];

export type InEventDirection = 'positive' | 'negative' | 'mixed' | 'neutral';

export interface InEventHit {
  /** Stable rule id ("promoter_stake_sale"). */
  id: string;
  /** Plain-English label ("Promoter / parent stake sale"). */
  label: string;
  category: InEventCategory;
  /** A hint for the reader — never a trade instruction. */
  direction: InEventDirection;
  /** The evidence sentence, as written in the source (trimmed, clipped). */
  sentence: string;
  /** Figures literally present in that sentence ("₹260 crore", "19%"). */
  figures: string[];
  /** The sentence speaks of a plan / report / possibility ("set to", "mulls", "proposed"). */
  planned: boolean;
  /** Paperwork: named, never a catalyst. */
  routine: boolean;
  /** Results only: 'small' when a stated profit / figure is tiny (₹0.24 crore turnaround); 'weak' for a decline / loss. */
  strength: 'weak' | 'small' | null;
  /** A plain note for the reader ("turnaround, small", "company says no undisclosed information"). */
  note: string | null;
  // ── zzz836 (optional) ──
  /** Economic direction of the event itself (never the price move): POSITIVE | NEGATIVE | MIXED | NEUTRAL | UNKNOWN. `direction` keeps the older lower-case hint. */
  economicDirection?: EconDirection;
  /** One plain line for a direction that needs it (dilution, contingent, observations are not a clean result). */
  directionNote?: string | null;
  /** Finer than the category: store_launch, dealership, facility_for_customer, credit_rating, inspection ... */
  subtype?: EventSubtype;
}

interface Rule {
  id: string;
  label: string;
  category: InEventCategory;
  direction: InEventDirection;
  any: RegExp[];
  not?: RegExp;
  dir?: (s: string) => InEventDirection;
  hides?: string[];
  rank: number;
  routine?: boolean;
  note?: string | ((s: string) => string | null);
}

// ── the rules ─────────────────────────────────────────────────────────────

const REV = String.raw`(?:revenues?|net sales|sales|total income|turnover|income from operations|revenue from operations|top[- ]?line|operating revenue)`;
const PROFIT = String.raw`(?:net profit|consolidated net profit|standalone net profit|profit after tax|\bPAT\b|profit before tax|\bPBT\b|\bEBITDA\b|operating profit|bottom[- ]?line|net income|earnings)`;
const UP = String.raw`(?:up|rose|rises|rising|grew|grows|growing|increased|increases|jumped|jumps|surged|surges|soared|soars|climbed|climbs|higher|improved|improves|expanded|doubled|zoomed|gained|registered a growth|growth of|rise of|increase of)`;
const DOWN = String.raw`(?:down|fell|falls|declined|declines|decreased|decreases|dropped|drops|slipped|slumped|plunged|lower|contracted|shrank|degrowth|de-growth)`;
const PCT = String.raw`\d+(?:\.\d+)?\s?(?:%|per ?cent\b)`;
const HEDGE_SALE = /\b(mulls?|eyes?|eyeing|explor(?:e|es|ing)|consider(?:s|ing)?|set to|plans? to|planning|looking to|in talks|talks with|potential|likely|may|could|buzz|reports?|reportedly|sources|proposed|seeking|evaluat(?:e|es|ing))\b/i;

/** "Total Income at Rs. 781.05 Cr as against Rs. 716.91 Cr" — the direction is read by comparing the two
 *  figures the sentence states (no new figure is produced). Neutral when either is missing. */
function vsPriorDir(s: string): InEventDirection {
  const m = /\bat\s+(?:₹|rs\.?|inr)\s?(\d[\d,]*(?:[.,]\d+)?)[^.;]{0,30}?\b(?:as against|against|compared (?:to|with)|vs\.?|versus)\s+(?:₹|rs\.?|inr)\s?(\d[\d,]*(?:[.,]\d+)?)/i.exec(s);
  if (!m) return 'neutral';
  const num = (x: string) => parseFloat(x.replace(/,(\d{1,2})$/, '.$1').replace(/,/g, ''));
  const a = num(m[1]), b = num(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'neutral';
  return a > b ? 'positive' : a < b ? 'negative' : 'neutral';
}

const RULES: Rule[] = [
  // ── RESULTS ──
  { id: 'turnaround_profit', label: 'Turnaround to profit', category: 'Results', direction: 'positive', rank: 10,
    any: [/\breturn(?:ed|s|ing)? to (?:profitability|profits?|the black|black)\b/i, /\bturn(?:ed|s)? (?:profitable|to (?:a )?profit|around)\b/i, /\bswung to (?:a )?(?:net )?profit\b/i, /\bback in (?:the )?black\b/i,
      /\b(?:net )?profit (?:of|at)\b[^.;]{0,60}\b(?:against|as against|compared (?:to|with)|versus|vs\.?)\s+(?:a\s+)?(?:net\s+)?loss\b/i, /\bprofit\b[^.;]{0,40}\bagainst (?:a )?(?:net )?loss\b/i,
      // "PAT in Q1 FY27 at Rs. 0.24 Cr as against Rs. (-) 8.41 Cr in Q1 FY26" — the year-ago figure is a loss
      new RegExp(String.raw`${PROFIT}[^.;]{0,50}\bat\s+(?:₹|rs\.?|inr)\s?\d[\d,.]*\s?(?:crores?|cr\b|lakhs?)?[^.;]{0,10}\b(?:as against|against|compared (?:to|with)|vs\.?|versus)\s+(?:₹|rs\.?|inr)?\s?(?:\(\s?-\s?\)|\(-|-\s?\d|negative|\(\d)`, 'i')],
    not: /\b(?:not|yet to|failed to)\s+(?:\w+\s+)?(?:turn|return)|\bloss\b[^.;]{0,20}\bas against\b[^.;]{0,20}\bprofit\b/i, hides: ['profit_growth', 'net_loss', 'results_filed'] },
  { id: 'revenue_growth', label: 'Revenue growth', category: 'Results', direction: 'positive', rank: 11,
    any: [new RegExp(String.raw`\b${REV}\b[^.;]{0,80}?\b${UP}\b[^.;]{0,40}?${PCT}`, 'i'), new RegExp(String.raw`${PCT}\s+(?:y-?o-?y |yoy |year[- ]on[- ]year |year[- ]over[- ]year |q-?o-?q )?(?:growth|increase|rise|jump)\s+in\s+(?:its\s+|the\s+)?(?:consolidated\s+|standalone\s+)?${REV}`, 'i'),
      new RegExp(String.raw`\b${REV}\b[^.;]{0,40}\b(?:doubled|tripled|more than doubled)\b`, 'i')],
    not: new RegExp(String.raw`\b${REV}\b[^.;]{0,60}\b${DOWN}\b`, 'i'), hides: ['results_filed'] },
  { id: 'profit_growth', label: 'Profit growth', category: 'Results', direction: 'positive', rank: 12,
    any: [new RegExp(String.raw`${PROFIT}[^.;]{0,80}?\b${UP}\b[^.;]{0,40}?(?:${PCT}|\bfold\b|times)`, 'i'), new RegExp(String.raw`${PCT}\s+(?:y-?o-?y |yoy |year[- ]on[- ]year )?(?:growth|increase|rise|jump)\s+in\s+(?:its\s+|the\s+)?(?:consolidated\s+|standalone\s+)?${PROFIT}`, 'i'),
      new RegExp(String.raw`${PROFIT}[^.;]{0,30}\b(?:doubled|tripled|more than doubled)\b`, 'i')],
    not: new RegExp(String.raw`${PROFIT}[^.;]{0,50}\b${DOWN}\b|\bloss\b`, 'i'), hides: ['results_filed'] },
  { id: 'record_results', label: 'Record revenue / profit', category: 'Results', direction: 'positive', rank: 11,
    any: [new RegExp(String.raw`\b(?:record|highest[- ]ever|all[- ]time high(?:est)?|best[- ]ever)\b[^.;]{0,30}\b(?:quarterly |annual )?(?:${REV}|${PROFIT}|order (?:book|inflow)|volumes?)`, 'i')], hides: ['results_filed'] },
  { id: 'revenue_vs_prior', label: 'Revenue vs year-ago (as stated)', category: 'Results', direction: 'neutral', rank: 12,
    any: [new RegExp(String.raw`\b${REV}\b[^.;]{0,50}?\bat\s+(?:₹|rs\.?|inr)\s?\d[\d,.]*\s?(?:crores?|cr\b|lakhs?|million|mn)?[^.;]{0,20}?\b(?:as against|against|compared (?:to|with)|vs\.?|versus)\s+(?:₹|rs\.?|inr)\s?\d`, 'i')],
    dir: (s) => vsPriorDir(s), hides: ['results_filed'] },
  { id: 'profit_vs_prior', label: 'Profit / EBITDA vs year-ago (as stated)', category: 'Results', direction: 'neutral', rank: 13,
    any: [new RegExp(String.raw`${PROFIT}[^.;]{0,50}?\bat\s+(?:₹|rs\.?|inr)\s?\d[\d,.]*\s?(?:crores?|cr\b|lakhs?|million|mn)?[^.;]{0,20}?\b(?:as against|against|compared (?:to|with)|vs\.?|versus)\s+(?:₹|rs\.?|inr)\s?\d`, 'i')],
    dir: (s) => vsPriorDir(s), hides: ['results_filed'] },
  { id: 'revenue_decline', label: 'Revenue decline', category: 'Results', direction: 'negative', rank: 13,
    any: [new RegExp(String.raw`\b${REV}\b[^.;]{0,60}?\b${DOWN}\b[^.;]{0,30}?${PCT}`, 'i')], hides: ['results_filed'] },
  { id: 'profit_decline', label: 'Profit decline', category: 'Results', direction: 'negative', rank: 13,
    any: [new RegExp(String.raw`${PROFIT}[^.;]{0,60}?\b${DOWN}\b[^.;]{0,30}?${PCT}`, 'i'), /\b(?:net )?loss (?:widened|widens|deepened)\b/i], hides: ['results_filed'] },
  { id: 'net_loss', label: 'Net loss reported', category: 'Results', direction: 'negative', rank: 14,
    any: [/\b(?:reported|posted|posts|reports|incurred|clocked)\b[^.;]{0,20}\b(?:a\s+)?(?:consolidated\s+|standalone\s+)?net loss\b/i, /\bnet loss (?:of|at|stood)\b/i],
    not: /\bagainst (?:a )?(?:net )?loss\b|\bfrom (?:a )?(?:net )?loss\b|\bturn(?:ed|s)? (?:profitable|around)\b/i, hides: ['results_filed'] },
  { id: 'margin_expansion', label: 'Margin expansion', category: 'Results', direction: 'positive', rank: 15,
    any: [/\b(?:ebitda|operating|gross|net|pat) margins?\b[^.;]{0,50}?\b(?:expanded|improved|increased|rose|up)\b/i, /\bmargin expansion\b/i, /\b\d+\s?(?:bps|basis points)\b[^.;]{0,30}\b(?:expansion|improvement|increase)\b/i],
    not: /\b(?:contract|compress|declin|decreas|lower)\w*\b[^.;]{0,20}\bmargin/i },
  { id: 'margin_compression', label: 'Margin compression', category: 'Results', direction: 'negative', rank: 15,
    any: [/\b(?:ebitda|operating|gross|net|pat) margins?\b[^.;]{0,50}?\b(?:contracted|compressed|declined|fell|narrowed|down)\b/i, /\bmargin (?:compression|pressure|contraction)\b/i] },
  { id: 'restatement', label: 'Restatement / accounting-policy change', category: 'Results', direction: 'mixed', rank: 14,
    any: [/\brestat(?:ed|ement|ements|ing)\b/i, /\bre-stated\b/i, /\bchange in (?:the )?accounting polic(?:y|ies)\b/i, /\baccounting polic(?:y|ies)\b[^.;]{0,40}\b(?:change[ds]?|revis(?:ed|ion)|modif(?:ied|ication))\b/i, /\bprior[- ]period (?:adjustments?|errors?|items?)\b/i],
    not: /\bregroup(?:ed|ing)\b[^.;]{0,40}\breclassif/i,
    note: 'figures restated — compare like with like before reading growth' },
  { id: 'guidance', label: 'Guidance / target stated', category: 'Results', direction: 'positive', rank: 16,
    any: [/\b(?:rais(?:ed|es)|revis(?:ed|es) upward|upgrad(?:ed|es))\b[^.;]{0,40}\b(?:guidance|outlook|target)\b/i, /\b(?:guidance|outlook)\b[^.;]{0,50}\b(?:₹|rs\.?|inr|\d+(?:\.\d+)?\s?%|crore)/i, /\btarget(?:s|ing|ed)?\b[^.;]{0,20}\b(?:revenue|turnover|sales|topline|growth)\b[^.;]{0,40}(?:₹|rs\.?|\d)/i],
    not: /\b(?:crisil|icra|care ratings?|\bCARE\b|india ratings|ind-?ra|acuit[eé]|infomerics|brickwork|credit rating|rating agency|reaffirm\w*|long[- ]term (?:bank )?facilit\w+|short[- ]term (?:bank )?facilit\w+)\b/i,
    dir: (s) => (/\b(?:lower(?:ed|s)|cut|reduc(?:ed|es)|withdr(?:ew|awn))\b[^.;]{0,30}\b(?:guidance|outlook|target)\b/i.test(s) ? 'negative' : 'positive') },
  { id: 'order_book', label: 'Order book stated', category: 'Results', direction: 'positive', rank: 17,
    any: [/\border ?book\b[^.;]{0,50}(?:₹|rs\.?|inr|crore|\d)/i, /\bunexecuted order\b/i],
    dir: (s) => (new RegExp(String.raw`\border ?book\b[^.;]{0,40}\b${DOWN}\b`, 'i').test(s) ? 'negative' : 'positive') },
  { id: 'results_filed', label: 'Quarterly result filed', category: 'Results', direction: 'neutral', rank: 19,
    any: [/\b(?:un-?audited|audited)\s+(?:standalone\s+(?:and|&)\s+consolidated\s+|consolidated\s+(?:and|&)\s+standalone\s+|standalone\s+|consolidated\s+)?financial results\b/i, /\bfinancial results for the (?:quarter|period|half[- ]year|year|nine months)\b/i, /\bregulation 33\b|\breg\.?\s?33\b/i,
      /\boutcome of (?:the )?board meeting\b[^.;]{0,80}\b(?:results|financials?)\b/i, /\b(?:results|financials?)\b[^.;]{0,40}\boutcome of (?:the )?board meeting\b/i, /\bq[1-4]\s?(?:fy)?\s?'?\d{2}\s+results?\b/i, /\bquarterly results?\b/i, /\bresults? for (?:the )?(?:quarter|q[1-4])\b/i, /\bnet sales at (?:₹|rs\.?)/i,
      /\b(?:quarterly )?earnings release\b/i, /\bpress release\b[^.;]{0,100}\b(?:financial )?results\b/i],
    not: /\b(?:intimation|to consider|will be (?:held|considered)|is scheduled|to be held|prior intimation|trading window|conference call|earnings call|investor call|con-?call|newspaper|publication|advertisement)\b/i },

  // ── OWNERSHIP & CONTROL ──
  { id: 'open_offer', label: 'Open offer (SAST)', category: 'Ownership & control', direction: 'positive', rank: 4,
    any: [/\bopen offer\b/i, /\bmandatory (?:open )?offer\b/i, /\bregulations? 3\s?\(1\)\b|\bregulations? 3\(1\) and 4\b|\bregulation 4 of (?:the )?(?:sebi )?\(?sast\)?/i, /\bdetailed public statement\b|\bletter of offer\b[^.;]{0,40}\bshareholders\b/i],
    not: /\b(?:no|not|without|exempt(?:ed|ion)?(?: from)?)\b[^.;]{0,25}\bopen offer\b|\bopen offer\b[^.;]{0,30}\b(?:not (?:be )?triggered|not applicable|exempt)/i,
    hides: ['promoter_stake_sale', 'acquisition', 'stake_disclosure'] },
  { id: 'promoter_selling', label: 'Promoter sold shares', category: 'Ownership & control', direction: 'negative', rank: 18,
    any: [/\b(?:promoters?|promoter group|promoter entity|director|managing director|chairman)\b[^.;]{0,80}\b(?:sold|disposed(?: of)?|offloaded|divested|pared|reduced (?:its|their|his|her) (?:stake|holding|shareholding))\b[^.;]{0,60}\b(?:shares|stake|%|holding)/i, /\bdisposal of (?:equity )?shares\b[^.;]{0,60}\bpromoter/i, /\bregulation 29\s?\(2\)\b[^.;]{0,80}\b(?:sale|disposal|sold)\b/i],
    not: /\b(?:set to|plans? to|mulls?|eyes?|to sell|may sell|likely to|considering|talks)\b/i, hides: ['promoter_stake_sale', 'stake_disclosure'] },
  { id: 'promoter_stake_sale', label: 'Promoter / parent stake sale', category: 'Ownership & control', direction: 'mixed', rank: 5,
    any: [/\b(?:promoters?|promoter group|parent(?: company)?|holding company|foreign parent|[A-Z][\w&.-]*(?: [A-Z][\w&.-]*){0,2} (?:Mauritius|Singapore|Netherlands|B\.?V\.?|AG|GmbH|Inc|Holdings?|International))\b[^.;]{0,80}\b(?:sell(?:s|ing)?|sale of|stake sale|offload(?:s|ing)?|divest(?:s|ing|ment)?|exit(?:s|ing)?|full exit|dilute|pare|monetis|monetiz|reduce|reducing|reduction)\w*\b[^.;]{0,60}\b(?:stake|holding|shareholding|shares|entire|remaining|\d+(?:\.\d+)?\s?%|exit)/,
      /\b(?:promoters?|promoter group|parent)\b[^.;]{0,80}\b(?:sell(?:s|ing)?|offload(?:s|ing)?|divest(?:s|ing)?|exit(?:s|ing)?)\b/i,
      /\bpromoter(?:'s)? stake sale\b|\bstake sale (?:by|plan of) (?:the )?(?:promoter|parent)/i, /\b(?:potential|prospective) (?:stake )?buyers?\b[^.;]{0,40}\bstake\b|\bstake\b[^.;]{0,40}\b(?:potential|prospective) buyers?\b/i],
    not: /\b(?:regulation 29|reg\.?\s?29|sast regulations|pit regulations|regulation 7\s?\(2\))\b|\bdisposed\b/i,
    note: (s) => (/\bnot (?:a )?party to\b|\bnot aware\b|\bno (?:such )?(?:proposal|decision)\b/i.test(s) ? 'company says it is not party to the talks' : null) },
  { id: 'promoter_buying', label: 'Promoter buying (SAST / PIT)', category: 'Ownership & control', direction: 'positive', rank: 20,
    any: [/\b(?:promoters?|promoter group|promoter entity|managing director|chairman|whole[- ]time director)\b[^.;]{0,80}\b(?:acquired|purchased|bought|buys|acquires|increased (?:its|their|his|her) (?:stake|holding|shareholding)|raised (?:its|their) stake)\b[^.;]{0,60}\b(?:shares|stake|%|holding)/i, /\bcreeping acquisition\b/i, /\bpromoter (?:buying|purchase|stake (?:hike|increase))\b/i],
    not: /\b(?:sold|disposed|pledg\w*|inter[- ]se|gift|transmission|allot\w*|preferential|warrants?)\b/i, hides: ['stake_disclosure'] },
  { id: 'pledge', label: 'Promoter pledge change', category: 'Ownership & control', direction: 'negative', rank: 28,
    any: [/\bpledg(?:e|ed|es|ing)\b/i, /\bencumbrance\b|\bencumbered\b/i],
    dir: (s) => (/\b(?:release|released|revoked|revocation|invocation withdrawn|discharge)\b/i.test(s) ? 'positive' : 'negative') , hides: ['stake_disclosure'] },
  { id: 'block_deal', label: 'Block / bulk deal', category: 'Ownership & control', direction: 'mixed', rank: 27,
    any: [/\b(?:block|bulk) deals?\b/i, /\bchanges? hands\b/i] },
  { id: 'strategic_investor', label: 'Strategic / marquee investor', category: 'Ownership & control', direction: 'positive', rank: 16,
    any: [/\bstrategic investor\b/i, /\b(?:picks? up|picked up|acquires?|acquired|takes?|took)\b[^.;]{0,20}\b\d+(?:\.\d+)?\s?%\s+stake in\b/i],
    not: /\bpromoters?\b[^.;]{0,20}\b(?:sold|sell)/i },
  { id: 'stake_disclosure', label: 'Promoter / insider stake movement (SAST / PIT disclosure)', category: 'Ownership & control', direction: 'neutral', rank: 34,
    any: [/\bregulation 29\s?\(?[12]?\)?\b|\breg\.?\s?29\b/i, /\bregulation 31\s?\(?[12]?\)?\b[^.;]{0,40}\b(?:sast|takeover)/i, /\bsast\b/i, /\bsubstantial acquisition of shares\b/i, /\bregulation 7\s?\(2\)\b|\bpit regulations\b|\bprohibition of insider trading\b[^.;]{0,40}\bdisclos/i, /\bchange in (?:the )?(?:promoter(?:s'?)?|promoter group) (?:holding|shareholding)\b/i, /\binter[- ]se (?:transfer|transmission)\b/i],
    note: 'ownership disclosure — who bought or sold, and how much, is in the form' },

  // ── ORDERS & BUSINESS ──
  { id: 'order_win', label: 'Order / contract win', category: 'Orders & business', direction: 'positive', rank: 8,
    any: [/\bletter of (?:award|acceptance)\b|\bnotification of award\b/i, /\bLOA\b|\bLoA\b/, /\b(?:work|purchase|supply|export|repeat) orders?\b/i, /\border(?:s)? (?:worth|valued at|aggregating|amounting to|for the value of|of (?:₹|rs\.?|inr))/i,
      /\b(?:received|receipt of|bagged|bags|secured|secures|won|wins|awarded|bagging)\b[^.;]{0,70}\b(?:order|orders|contract|contracts|project|tender|LOA|mandate)\b/i, /\b(?:L-?1|lowest) bidder\b/i, /\bletter of intent\b/i, /\bLOI\b/],
    not: /\b(?:gst|tax|assessment|show[- ]cause|demand|penalty|court|tribunal|nclt|nclat|arbitral|adjudicat\w*|commissioner|appellate)\b[^.;]{0,30}\border\b|\border\b[^.;]{0,30}\b(?:passed by|of the hon|from the hon|by the (?:court|tribunal|commissioner))\b|\bcancell?(?:ed|ation)\b|\bterminat\w*\b|\border of (?:the )?(?:day|priority|magnitude|merit)\b|\bin order to\b[^.;]{0,20}$/i,
    note: (s) => (/\bletter of intent\b/i.test(s) || /\bLOI\b/.test(s) ? 'letter of intent — not yet a firm order' : null) },
  { id: 'order_cancellation', label: 'Order cancelled / terminated', category: 'Orders & business', direction: 'negative', rank: 8,
    any: [/\b(?:cancell?(?:ed|ation)|terminat(?:ed|ion)|foreclos(?:ed|ure)|short[- ]clos(?:ed|ure))\b[^.;]{0,40}\b(?:order|contract|LOA|agreement)\b/i], hides: ['order_win'] },
  { id: 'partnership', label: 'MoU / partnership / supply agreement', category: 'Orders & business', direction: 'positive', rank: 21,
    any: [/\bmemorandum of understanding\b/i, /\bMoU\b|\bMOU\b/, /\b(?:strategic|technology|commercial|distribution|supply|licen[cs]ing|teaming|collaboration|framework|offtake|off-take|long[- ]term) (?:partnership|alliance|agreement|tie[- ]up)\b/i, /\b(?:partners?|partnered|ties? up|tied up|teams? up) with\b/i] },
  { id: 'new_product', label: 'New product / market launch', category: 'Orders & business', direction: 'positive', rank: 22,
    any: [/\blaunch(?:es|ed|ing)?\b[^.;]{0,60}\b(?:new|product|range|brand|variant|model|drug|formulation|platform|service|store|outlet)s?\b/i, /\b(?:commercial|product) launch\b/i, /\b(?:foray|forays|forayed|entry|enters?|entered) into\b[^.;]{0,40}\b(?:market|segment|business|sector|vertical)\b/i],
    not: /\blaunch\w* (?:of )?(?:the )?(?:qip|issue|offer|ipo|buy-?back|website)\b/i },
  { id: 'price_hike', label: 'Price increase', category: 'Orders & business', direction: 'positive', rank: 24,
    any: [/\b(?:announced|announces|implemented|takes?|took|effected) (?:a )?price (?:hike|increase|revision)s?\b/i, /\b(?:raised|increased|hiked|raises|hikes) (?:its |the |our )?(?:product |selling |list )?prices?\b/i, /\bprice (?:hike|increase)s? of \d/i] },
  { id: 'commodity_price', label: 'Sector / commodity price move (theme, not a company event)', category: 'Orders & business', direction: 'neutral', rank: 39,
    any: [/\b(?:[\w-]+ )?prices? (?:of [\w -]{2,30} )?(?:surged?|jumped|rose|spiked|soared|rall(?:y|ied)|see (?:a )?(?:massive )?surge)\b/i, /\b(?:surge|spike|jump|rally) in [\w -]{2,30} prices\b/i],
    not: /\bshare prices?\b|\bstock prices?\b/i,
    note: 'a sector / input-price theme — not a company filing' },
  { id: 'vendor_approval', label: 'Vendor / product approval', category: 'Orders & business', direction: 'positive', rank: 23,
    any: [/\bempanel(?:led|ment)\b/i, /\b(?:approved|registered|qualified) (?:vendor|supplier|source)\b/i, /\bvendor (?:registration|approval|qualification)\b/i, /\b(?:as9100|nadcap|iso ?\d{4,5})\b[^.;]{0,30}\b(?:certif|accredit)/i] },

  // ── CAPACITY & CAPEX ──
  { id: 'capacity_commissioned', label: 'Capacity commissioned / production started', category: 'Capacity & capex', direction: 'positive', rank: 9,
    any: [/\bcommission(?:ed|ing)\b[^.;]{0,60}\b(?:plant|unit|line|capacity|facility|project|mw|tpa|mtpa|tpd|klpd|furnace|kiln|boiler)\b/i, /\b(?:plant|unit|line|capacity|facility|project)\b[^.;]{0,60}\bcommission(?:ed|ing)\b/i,
      /\bcommenc(?:ed|ement of|es)\b[^.;]{0,20}\b(?:commercial )?(?:production|operations|dispatch(?:es)?)\b/i, /\b(?:start(?:ed|s)?|began|begins)\b[^.;]{0,15}\b(?:commercial )?production\b/i, /\bcommercial operation date\b/i, /\bCOD\b/, /\btrial (?:run|production)\b/i, /\binaugurat(?:ed|ion|es)\b[^;]{0,50}\b(?:plants?|units?|facilit(?:y|ies)|factory|factories|lines?|centre|center)\b/i],
    not: /\b(?:showroom|dealerships?|retail (?:and service )?partner|(?:retail )?stores?|outlets?|boutique)\b/i, },
  { id: 'capacity_expansion', label: 'Capacity expansion / capex', category: 'Capacity & capex', direction: 'positive', rank: 15,
    any: [/\bcapacity (?:expansion|addition|enhancement|augmentation|increase)\b/i, /\b(?:expand|expansion of|enhance|enhancement of|increase|augment|augmentation of|double|doubling)\b[^.;]{0,40}\b(?:production |installed |manufacturing )?capacity\b/i, /\bcapex\b[^.;]{0,40}(?:₹|rs\.?|inr|crore|plan|programme|program)/i, /\b(?:greenfield|brownfield)\b/i, /\bnew (?:plant|facility|manufacturing unit|production line|unit)\b/i, /\bset(?:ting)? up (?:a |an )?(?:new )?(?:plant|facility|unit|factory)\b/i],
    not: /\b(?:showroom|dealerships?|retail (?:and service )?partner|(?:retail )?stores?|outlets?|boutique)\b/i,
    hides: [] },

  // ── CORPORATE ACTION ──
  { id: 'acquisition', label: 'Acquisition', category: 'Corporate action', direction: 'positive', rank: 7,
    any: [/\b(?:acquisition of|to acquire|will acquire|has acquired|acquires|acquired|takeover of|share purchase agreement|business transfer agreement)\b[^.;]{0,80}\b(?:company|business|stake|%|shares of|entity|brand|unit|plant|subsidiary|limited|ltd|pvt|private|inc|gmbh|llc|assets)\b/i],
    not: /\b(?:promoters?|promoter group|director|acquirer)\b[^.;]{0,40}\bacqui\w+\b[^.;]{0,40}\bshares\b|\bcustomer acquisition\b|\bland\b|\bregulation 29\b|\bsast\b/i },
  { id: 'merger', label: 'Merger / amalgamation', category: 'Corporate action', direction: 'mixed', rank: 7,
    any: [/\bamalgamation\b|\bmerger\b|\bscheme of arrangement\b|\bmerge with\b/i], hides: ['acquisition'] },
  { id: 'demerger', label: 'Demerger', category: 'Corporate action', direction: 'positive', rank: 7,
    any: [/\bde-?merger\b|\bdemerg(?:e|ed|ing)\b|\bspin[- ]?off\b/i], hides: ['merger'] },
  { id: 'divestment', label: 'Divestment / slump sale', category: 'Corporate action', direction: 'mixed', rank: 9,
    any: [/\bslump sale\b|\bdivest(?:s|ed|ment|iture)\b/i, /\bsale of (?:its |the |our )?(?:business|unit|division|undertaking|subsidiary|plant|brand|stake in [A-Z])/i],
    not: /\bpromoters?\b|\bparent\b/i },
  { id: 'joint_venture', label: 'Joint venture', category: 'Corporate action', direction: 'positive', rank: 12,
    any: [/\bjoint venture\b/i, /\bJV\b/], hides: ['partnership'] },
  { id: 'buyback', label: 'Buyback', category: 'Corporate action', direction: 'positive', rank: 13,
    any: [/\bbuy[- ]?back\b/i], not: /\bextinguish\w*\b|\bcompletion of buy/i },
  { id: 'delisting', label: 'Delisting offer', category: 'Corporate action', direction: 'positive', rank: 5,
    any: [/\bdelisting (?:offer|proposal)\b|\bvoluntary delisting\b|\bdelist the (?:equity )?shares\b/i],
    dir: (s) => (/\bcompulsory\b|\bsuspension\b/i.test(s) ? 'negative' : 'positive') },
  { id: 'bonus_split', label: 'Bonus / stock split', category: 'Corporate action', direction: 'positive', rank: 29,
    any: [/\bbonus (?:issue|shares?|equity)\b/i, /\b(?:stock|share) split\b|\bsub-?division of (?:equity )?shares\b|\bsplit of (?:equity )?shares\b/i],
    not: /\brecord date\b/i },
  { id: 'special_dividend', label: 'Special / interim dividend', category: 'Corporate action', direction: 'positive', rank: 33,
    any: [/\bspecial dividend\b/i, /\binterim dividend of\b/i], not: /\brecord date\b/i },

  // ── CAPITAL RAISING ──
  { id: 'equity_raise', label: 'Equity raise (QIP / preferential / rights / warrants)', category: 'Capital raising', direction: 'mixed', rank: 25,
    any: [/\bqualified institutions? placement\b/i, /\bQIP\b/, /\bpreferential (?:issue|allotment|basis)\b/i, /\brights issue\b/i, /\b(?:convertible )?warrants?\b[^.;]{0,40}\b(?:issue|allot|allotment|convert)/i, /\bfund ?rais(?:e|ing)\b[^.;]{0,40}(?:₹|rs\.?|crore|equity|qip|preferential)/i, /\bprivate placement of (?:equity|shares)\b/i],
    note: 'equity raise adds supply — check price, allottees and use of proceeds' },
  { id: 'debt_raise', label: 'Debt raise / borrowing', category: 'Capital raising', direction: 'neutral', rank: 38,
    any: [/\bnon[- ]convertible debentures?\b/i, /\bNCDs?\b/, /\bterm loan\b|\bcommercial paper\b|\bborrowing limits?\b/i] },
  { id: 'rating_upgrade', label: 'Credit rating upgrade', category: 'Balance sheet / credit', direction: 'positive', rank: 30,
    any: [/\b(?:rating|outlook)\b[^.;]{0,60}\b(?:upgrad(?:ed|e)|revised (?:upward|to positive)|to positive)\b/i, /\bupgrad(?:ed|es)\b[^.;]{0,40}\b(?:rating|outlook)\b/i],
    hides: ['rating_action'], note: 'rated facility size is a debt figure, not guidance or revenue' },
  { id: 'rating_downgrade', label: 'Credit rating downgrade', category: 'Balance sheet / credit', direction: 'negative', rank: 30,
    any: [/\b(?:rating|outlook)\b[^.;]{0,60}\b(?:downgrad(?:ed|e)|revised to negative|to negative|watch with negative)\b/i, /\bdowngrad(?:ed|es)\b[^.;]{0,40}\b(?:rating|outlook)\b/i],
    hides: ['rating_action'], note: 'rated facility size is a debt figure, not guidance or revenue' },
  { id: 'rating_action', label: 'Credit rating action', category: 'Balance sheet / credit', direction: 'neutral', rank: 31,
    any: [/\b(?:crisil|icra|care ratings?|\bCARE\b|india ratings|ind-?ra|acuit[eé]|infomerics|brickwork)\b[^.;]{0,80}\b(?:reaffirm\w*|assign\w*|retain\w*|maintain\w*|rating)\b/i, /\b(?:reaffirm\w*|assign\w*)\b[^.;]{0,40}\b(?:credit )?rating\b/i, /\bcredit rating\b/i],
    hides: [], note: 'rated facility size is a debt figure, not guidance or revenue' },

  // ── MANAGEMENT & GOVERNANCE ──
  { id: 'auditor_resignation', label: 'Auditor resignation', category: 'Management & governance', direction: 'negative', rank: 6,
    any: [/\b(?:statutory |joint )?auditors?\b[^.;]{0,40}\bresign(?:ed|s|ation)?\b|\bresignation of (?:the )?(?:statutory |joint )?auditors?\b/i],
    not: /\b(?:internal|secretarial|cost) auditors?\b/i },
  { id: 'kmp_resignation', label: 'Key management resignation', category: 'Management & governance', direction: 'negative', rank: 26,
    any: [/\b(?:resign(?:ed|s|ation)?|stepp?(?:ed|s)? down|cessation|quit(?:s)?|demit(?:s|ted)? office)\b[^.;]{0,90}\b(?:chief|ceo|cfo|coo|cto|cxo|managing director|whole[- ]time director|executive director|president|senior management|senior managerial|smp|key managerial|kmp|business head|head of)\b/i,
      /\b(?:chief [a-z]+ officer|ceo|cfo|coo|cto|managing director|whole[- ]time director|executive director|president|senior management personnel|key managerial personnel|business head)\b[^.;]{0,90}\b(?:resign(?:ed|s|ation)?|stepp?(?:ed|s)? down|cessation|quit)\b/i],
    not: /\bcompany secretary\b(?![^.;]{0,60}\b(?:ceo|cfo|chief|managing director)\b)|\bindependent director\b(?![^.;]{0,60}\b(?:ceo|cfo|managing)\b)/i,
    dir: (s) => (/\b(?:ceo|cfo|managing director|chief executive|chief financial)\b/i.test(s) ? 'negative' : 'mixed') },
  { id: 'independent_director_exit', label: 'Independent director resignation', category: 'Management & governance', direction: 'negative', rank: 31,
    any: [/\bindependent director\b[^.;]{0,60}\bresign(?:ed|s|ation)?\b|\bresignation of (?:an? |the )?independent director\b/i] },
  { id: 'kmp_appointment', label: 'Senior management appointment', category: 'Management & governance', direction: 'neutral', rank: 40,
    any: [/\b(?:appoint(?:ed|s|ment of)|elevat(?:ed|es)|re-?designat(?:ed|ion))\b[^.;]{0,90}\b(?:ceo|cfo|coo|cto|chief [a-z]+ officer|managing director|whole[- ]time director|president)\b/i, /\b(?:ceo|cfo|chief [a-z]+ officer|managing director)\b[^.;]{0,40}\bappoint(?:ed|ment)\b/i],
    not: /\bresign|\bcessation\b/i },

  // ── REGULATORY & LEGAL ──
  { id: 'regulatory_approval', label: 'Regulatory approval / licence', category: 'Regulatory & legal', direction: 'positive', rank: 10,
    any: [/\b(?:usfda|us fda|fda|eir|anda|dcgi|cdsco|who[- ]gmp|eu[- ]gmp|mhra|tga|anvisa|pmda|ema|ce mark|cep|dmf)\b[^.;]{0,60}\b(?:approv\w*|clearance|cleared|received|granted|nai|voluntary action indicated|vai|establishment inspection report)\b/i, /\b(?:final|tentative) approval\b/i, /\b(?:licen[cs]e|approval|clearance|permission|nod)\b[^.;]{0,30}\b(?:received|granted|obtained)\b/i, /\b(?:received|granted|obtained)\b[^.;]{0,30}\b(?:licen[cs]e|approval|clearance|permission|nod)\b/i],
    not: /\bshareholders?'? approval\b|\bboard(?:'s)? approval\b|\bsubject to (?:the )?(?:approval|shareholders)|\bapproval of (?:the )?(?:board|shareholders|members)\b|\bapproved the (?:financial )?results\b|\bin-principle approval\b[^.;]{0,30}\blisting\b/i,
    hides: ['vendor_approval'] },
  { id: 'regulatory_setback', label: 'Regulatory setback (warning letter / import alert / 483)', category: 'Regulatory & legal', direction: 'negative', rank: 6,
    any: [/\bwarning letter\b|\bimport alert\b|\bform 483\b|\b483 observations?\b|\bofficial action indicated\b|\bOAI\b/i, /\b(?:licen[cs]e|approval|registration)\b[^.;]{0,20}\b(?:suspended|cancelled|revoked)\b/i],
    // an inspection that ended with observations is its own (mixed) event; only a warning letter / import alert / OAI is a setback
    not: /^(?!.*(?:warning letter|import alert|official action indicated|\bOAI\b)).*\binspect(?:ion|ed|ions)\b/is },
  { id: 'subsidiary_incorporation', label: 'New subsidiary incorporated', category: 'Corporate action', direction: 'neutral', rank: 36,
    any: [/\bincorporat\w*\b[^;]{0,120}\bsubsidiary\b/i, /\bsubsidiary\b[^;]{0,80}\bincorporat\w*\b/i, /\bwholly[- ]owned subsidiary\b[^;]{0,60}\b(?:formed|set up|incorporated|established)\b/i],
    not: /\bstrike[- ]off\b|\bcessation\b|\bclosure of (?:the )?subsidiary\b/i, note: 'an enabling step - it books no revenue by itself' },
  { id: 'regulatory_inspection', label: 'Regulatory inspection / observations', category: 'Regulatory & legal', direction: 'neutral', rank: 9,
    any: [/\b(?:usfda|us fda|fda|mhra|eu[- ]?gmp|who[- ]?gmp|anvisa|pmda|tga|dcgi|cdsco|health canada|pic\/s|gmp)\b[^.;]{0,80}\binspect(?:ion|ed|ions)\b/i, /\binspect(?:ion|ed|ions)\b[^.;]{0,80}\b(?:usfda|us fda|fda|mhra|eu[- ]?gmp|who[- ]?gmp|observations?|form 483|483|EIR|NAI|VAI)\b/i, /\b(?:pre[- ]approval|surveillance|cgmp|gmp)\s+inspection\b/i],
    not: /\b(?:warning letter|import alert|official action indicated|\bOAI\b)\b|\bcomplete response letter\b|\binspection of (?:records|books|documents)\b/i,
    dir: (s) => { const d = directionOf('regulatory_inspection', s); return d === 'POSITIVE' ? 'positive' : d === 'NEGATIVE' ? 'negative' : d === 'MIXED' ? 'mixed' : 'neutral'; },
    hides: ['regulatory_approval'],
    note: 'inspection is not an approval - read the observations, the response and the site\'s revenue share' },
  { id: 'store_launch', label: 'New store / showroom launch', category: 'Orders & business', direction: 'positive', rank: 21,
    any: [/\b(?:showroom|store|stores|outlet|outlets|boutique|retail (?:store|outlet))\b[^.;]{0,50}\b(?:launch\w*|opening|opened|inaugurat\w*|open)\b/i, /\b(?:launch\w*|open(?:s|ed|ing)?|inaugurat\w*)\b[^.;]{0,40}\b(?:new |first )?(?:showroom|store|stores|outlet|outlets|boutique)\b/i],
    not: /\bdealership\b/i, note: 'store economics differ from a plant: capex per store, same-store sales, payback' },
  { id: 'dealership_expansion', label: 'Dealership / network expansion', category: 'Orders & business', direction: 'positive', rank: 21,
    any: [/\bdealerships?\b/i, /\b(?:dealer|retail|service|distribution) network\b[^.;]{0,40}\b(?:expand\w*|addition|new)\b/i, /\bexpands? its (?:dealer |retail |service )?network\b/i, /\bretail and service partner\b[^.;]{0,120}\bnew (?:facility|outlet|showroom)\b/i],
    note: 'network expansion: capex per outlet, throughput and the brand\'s allocation' },
  { id: 'tax_demand', label: 'Tax demand / penalty', category: 'Regulatory & legal', direction: 'negative', rank: 32,
    any: [/\b(?:gst|income[- ]tax|customs|excise|service tax)\b[^.;]{0,60}\b(?:demand|notice|order|penalty|show[- ]cause)\b/i, /\bshow[- ]cause notice\b|\bdemand notice\b|\bpenalty of\b/i],
    not: /\b(?:quashed|set aside|dropped|in (?:our|its|the company'?s) favou?r|allowed the appeal|deleted)\b/i,
    note: 'contingent until any appeal ends' },
  { id: 'legal_win', label: 'Favourable legal / tax outcome', category: 'Regulatory & legal', direction: 'positive', rank: 28,
    any: [/\b(?:quashed|set aside|allowed the appeal|in (?:our|its|the company'?s) favou?r|favourable (?:order|judgment|ruling|award)|arbitral award in favou?r|won the (?:case|arbitration))\b/i] },
  { id: 'insolvency_default', label: 'Insolvency / default / enforcement', category: 'Regulatory & legal', direction: 'negative', rank: 3,
    any: [/\binsolvency\b|\bcirp\b|\bnclt\b[^.;]{0,40}\b(?:admit|petition|insolvency)|\bdefault(?:ed)? (?:in|on) (?:the )?(?:repayment|payment|interest)\b/i, /\bsebi\b[^.;]{0,40}\b(?:order|penalt|ban|bars?|show[- ]cause|adjudicat)/i, /\b(?:search|survey|raid)\b[^.;]{0,30}\b(?:income tax|enforcement directorate|\bED\b|gst|dggi)\b|\bforensic audit\b|\bfraud\b/i],
    not: /\b(?:sanction(?:ed)?|approv(?:ed|al))\b[^.;]{0,60}\b(?:scheme|amalgamation|merger)\b/i },
  { id: 'operations_disruption', label: 'Operational disruption (fire / accident / shutdown)', category: 'Regulatory & legal', direction: 'negative', rank: 7,
    any: [/\b(?:major )?fire (?:at|in|broke|incident|accident)\b|\bexplosion\b|\bgas leak\b|\baccident at\b/i, /\b(?:temporar(?:y|ily)|partial(?:ly)?) (?:shut|suspend|halt|clos)\w*\b|\bsuspension of (?:operations|production|manufacturing)\b|\bplant shut ?down\b|\block-?out\b|\bforce majeure\b/i],
    not: /\bresumed\b|\brestored\b|\bback to normal\b/i },

  // ── EXCHANGE DISCLOSURE ──
  { id: 'price_clarification', label: 'Exchange clarification on price / volume movement', category: 'Exchange disclosure', direction: 'neutral', rank: 35,
    any: [/\b(?:clarification|reply|replies|response|responds?)\b[^.]{0,140}?\b(?:price movement|volume movement|movement in (?:the )?(?:price|volume|share price)|spurt in (?:the )?(?:price|volume)|(?:increase|surge|rise|spike) in (?:the )?(?:price|volume|trading volume))/i,
      /\bno (?:undisclosed|unpublished)\b[^.;]{0,40}\b(?:information|events?|developments?|announcements?)\b/i, /\b(?:purely |entirely )?market[- ]driven\b/i, /\bnot aware of any (?:information|event|announcement|development)\b/i, /\bnothing (?:to|that needs to be) disclose/i],
    not: /\b(?:news (?:item|article|report)|media (?:report|article)|press report|reported in)\b/i,
    note: 'company says no undisclosed information', hides: ['exchange_query'] },
  { id: 'media_clarification', label: 'Company response to a media report', category: 'Exchange disclosure', direction: 'mixed', rank: 19,
    any: [/\bclarification\b[^.;]{0,60}\b(?:news (?:item|article|report)|media (?:report|article)|press report|article|report(?:ed)? in)\b/i, /\b(?:news (?:item|article)|media report)\b[^.;]{0,60}\b(?:clarification|response)\b/i, /\bnot (?:been )?(?:a )?party to\b[^.;]{0,60}\b(?:talks|discussions|negotiations|deal)\b/i, /\bclarif(?:ies|ied|y)\b[^.;]{0,60}\b(?:news|article|media|report)\b/i, /\b(?:denies|denied|refutes?|refuted)\b[^.;]{0,60}\b(?:report|news|article|rumou?r|speculation)\b/i],
    note: (s) => (/\bdenies|denied|refut|baseless|untrue|incorrect\b/i.test(s) ? 'company denies the reported story' : /\bnot (?:been )?(?:a )?party to\b/i.test(s) ? 'company says it is not party to the talks' : 'company response to a press report') },
  { id: 'exchange_query', label: 'Exchange sought clarification', category: 'Exchange disclosure', direction: 'neutral', rank: 45,
    any: [/\b(?:exchange|nse|bse)\b[^.;]{0,40}\b(?:sought|seeks|seeking|has sought) (?:a )?clarification\b|\bclarification sought\b|\bquery (?:from|by) (?:nse|bse|the exchange)\b/i, /\bsignificant (?:movement|increase) in (?:the )?(?:price|volume)s? has been observed\b|\bhas written to the company\b|\bresponse from the company is awaited\b/i],
    not: /\b(?:reply|replies|replied|response|responded|clarifies|clarified|confirms?|confirmed|states?|stated)\b/i },

  // ── ROUTINE (named, never a catalyst) ──
  { id: 'analyst_meet', label: 'Analyst / investor meet', category: 'Routine', direction: 'neutral', rank: 90, routine: true,
    any: [/\b(?:analysts?|institutional investors?|investors?|fund managers?)\b[^.;]{0,30}\b(?:meets?|meetings?|conference|call|interaction|day)\b/i, /\b(?:earnings|conference|con-?|investor) ?calls?\b[^.;]{0,40}\b(?:schedule|intimation|scheduled|will be held|audio|recording|transcript)\b/i, /\bschedule of (?:analyst|investor)\b/i, /\broad ?show\b/i, /\bNDR\b/] },
  { id: 'trading_window', label: 'Trading window closure', category: 'Routine', direction: 'neutral', rank: 91, routine: true,
    any: [/\btrading window\b/i] },
  { id: 'board_meeting_intimation', label: 'Board meeting intimation', category: 'Routine', direction: 'neutral', rank: 92, routine: true,
    any: [/\b(?:intimation|notice) of (?:the )?(?:meeting of (?:the )?)?board(?: of directors)?(?: meeting)?\b/i, /\bboard meeting\b[^.;]{0,40}\b(?:is scheduled|will be held|to be held|shall be held|scheduled)\b/i, /\bprior intimation\b/i, /\bboard (?:of directors )?(?:will|shall) (?:meet|consider)\b/i] },
  { id: 'agm_record_date', label: 'AGM / record date / book closure', category: 'Routine', direction: 'neutral', rank: 93, routine: true,
    any: [/\bannual general meeting\b|\bextraordinary general meeting\b/i, /\bAGM\b|\bEGM\b/, /\brecord date\b|\bbook closure\b|\bcut-?off date\b|\be-?voting\b|\bpostal ballot\b|\bscrutini[sz]er\b|\bvoting results?\b/i] },
  { id: 'admin_filing', label: 'Administrative filing', category: 'Routine', direction: 'neutral', rank: 94, routine: true,
    any: [/\bnewspaper (?:publication|advertisement)s?\b|\bpublication of\b[^.;]{0,30}\bnewspaper/i, /\bcompliance certificate\b|\bshareholding pattern\b|\breconciliation of share capital\b|\bsecretarial (?:compliance|audit)\b|\bcorporate governance report\b|\bbusiness responsibility\b|\bBRSR\b|\bannual report\b|\bregulation 74\s?\(5\)|\breg\.?\s?74\b|\bloss of share certificates?\b|\bduplicate share\b|\bESOP\b|\bESOS\b|\bstatement of (?:deviation|investor complaints)\b|\bmonitoring agency\b|\bxbrl\b|\bchange in (?:the )?(?:registrar|rta|registered office|statutory auditor)\b|\bKYC\b/i,
      /\b(?:appointment|resignation|cessation) of (?:the )?company secretary\b|\bcompany secretary (?:and|&) compliance officer\b[^.;]{0,30}\b(?:appoint|resign)/i] },
];

export const IN_EVENT_RULE_IDS: string[] = RULES.map((r) => r.id);
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r] as const));
export function inEventMeta(id: string): { label: string; category: InEventCategory; rank: number; routine: boolean } | null {
  const r = RULE_BY_ID.get(id);
  return r ? { label: r.label, category: r.category, rank: r.rank, routine: !!r.routine } : null;
}

// ── boilerplate / sentences ────────────────────────────────────────────────

/** Safe-harbour / disclaimer / risk language — the whole sentence is dropped, never an event. */
export const IN_BOILERPLATE = /\b(?:forward[- ]looking (?:statements?|information)|safe harbou?r|could differ materially|actual results (?:may|could|might) differ|no assurance|risks? and uncertainties|disclaimer|does not (?:undertake|constitute)|undertakes? no obligation|should not be (?:construed|relied)|for illustrative purposes)\b/i;
/** Letter furniture — the phrase is cut, the rest of the sentence is read (a cover letter's "Sub:" line is the event). */
const LETTER_FURNITURE = /\b(?:this is for your (?:kind )?(?:information|reference|records)(?: and records)?|kindly take (?:the same|this|the above|note)[^.;]*|(?:please |request you to )?take (?:the )?(?:same|above|this) on (?:your )?records?|we request you to take[^.;]*|yours (?:faithfully|truly|sincerely)|thanking you|for and on behalf of[^.;]*|the (?:above )?(?:information|same) (?:is|will be|shall be) (?:also )?(?:available|hosted|uploaded) on the (?:company'?s )?website[^.;]*|dear (?:sir|madam|sirs)(?:\s*\/\s*madam)?|scrip code\s*:?\s*\d*|exchange plaza|dalal street|phiroze jeejeebhoy towers?)\b/gi;

/** The Reg 30 preamble is stripped (the event usually follows it in the same sentence). */
const PREAMBLE = /\b(?:pursuant to|in (?:compliance|accordance) with|under|in terms of)\s+(?:the\s+)?(?:provisions of\s+)?regulation\s+30\b[^,]{0,140}?(?:regulations?,?\s*(?:20\d\d)?|\(lodr\)|lodr)\s*(?:\([^)]*\))?,?\s*(?:as amended,?\s*)?(?:we (?:wish|would like) to (?:inform|intimate)(?: you)?(?: that)?,?\s*)?/gi;

const ABBR = /\b(?:Rs|No|Nos|Ltd|Pvt|Co|Inc|Corp|Mr|Ms|Mrs|Dr|Shri|Smt|Sri|St|vs|viz|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|i\.e|e\.g|w\.e\.f|Reg|Cr|Govt|Dept|Hon'?ble)\./gi;

/** Sentences of an India filing / press text (Reg 30 preamble removed, letter furniture dropped). */
export function inSentences(text: string): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').replace(PREAMBLE, '').replace(ABBR, (m) => m.replace(/\./g, '\u0000'));
  return t
    .replace(/&middot;|·|•|●|▪|■/g, ' \u0001 ')
    .split(/(?<=[a-z0-9)\]%"'”])[.!?;]\s+(?=[A-Z0-9(₹"“])|\s\u0001\s|\s+[-–—]{1,2}\s+(?=[A-Z])|\s*\|\s*/)
    .map((s) => s.replace(/\u0000/g, '.').replace(/\u0001/g, '').replace(/^[\s.,:;-]+/, '').trim())
    .filter((s) => s.length >= 8);
}

// ── figures (literal only) ─────────────────────────────────────────────────

const FIG_RES: RegExp[] = [
  /(?:₹|Rs\.?|INR)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:crores?|cr\b\.?|lakhs?|lacs?|million|mn\b|billion|bn\b|\/-))?/gi,
  /\b\d[\d,]*(?:\.\d+)?\s?(?:crores?|cr\b\.?|lakhs?|lacs?)(?!\s*(?:equity\s+|fully[- ]paid\s+)?(?:shares?|warrants?|units?|users?|customers?))/gi,
  /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|mn|bn|[MB])\b)?/gi,
  /[-+]?\d[\d,]*(?:\.\d+)?\s?(?:%|per ?cent\b)/gi,
  /\b\d[\d,]*(?:\.\d+)?\s?(?:bps|basis points)\b/gi,
  /\b\d[\d,]*(?:\.\d+)?\s?(?:MW|GW|MWp|KW|MTPA|TPA|TPD|KLPD|MLD|tonnes|tons|MT\b|lakh tonnes|sq\.? ?ft|square feet|beds|acres)\b/gi,
];

/** Figures literally present in one sentence, in order, de-duplicated. */
export function inFiguresIn(sentence: string): string[] {
  const s = String(sentence || '');
  const hits: Array<{ at: number; v: string }> = [];
  for (const re of FIG_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const v = m[0].trim().replace(/[,.]$/, '').trim();
      if (!v || !/\d/.test(v)) continue;
      if (hits.some((h) => m!.index >= h.at && m!.index < h.at + h.v.length)) continue;
      hits.push({ at: m.index, v });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const h of hits) if (!out.includes(h.v) && s.includes(h.v) && isPlausibleAmount(h.v)) out.push(h.v);
  return out.slice(0, 6);
}

/** ₹ crore of a money figure string, only when the figure itself names the unit ("₹0.24 Cr" → 0.24, "Rs 24 lakh" → 0.24). */
export function figureCrore(fig: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s?(crores?|cr\b\.?|lakhs?|lacs?|million|mn\b|billion|bn\b)/i.exec(fig);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = m[2].toLowerCase();
  if (/^(lakh|lac)/.test(u)) return n / 100;
  if (/^(million|mn)/.test(u)) return /(₹|rs|inr)/i.test(fig) ? n / 10 : null;
  if (/^(billion|bn)/.test(u)) return /(₹|rs|inr)/i.test(fig) ? n * 100 : null;
  return n;
}

// ── the classifier ────────────────────────────────────────────────────────

/** The form rules match on: abbreviation dots removed so a "[^.;]" window is not cut by "Rs." / "Ltd." / "₹0.24". */
function matchForm(s: string): string {
  return s.replace(ABBR, (m) => m.replace(/\./g, ' ')).replace(/(\d)\.(\d)/g, '$1,$2').replace(/\s{2,}/g, ' ');
}

const PLANNED = /\b(?:plans? to|planning to|intends? to|proposes? to|proposed|to consider|will consider|set to|mulls?|eyes?|eyeing|explor(?:e|es|ing)|considering|in talks|talks with|potential|likely to|may (?:sell|acquire|raise|exit)|could|expects? to|expected to|targets?|aims? to|reportedly|reports?|sources said|buzz|letter of intent|\bLOI\b|in-principle|subject to)\b/i;

function clip(s: string, n = 300): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s\S*$/, '')}…` : t;
}

export interface InClassifyOptions {
  /** Text is a single headline — no sentence split. */
  headline?: boolean;
  /** Max hits returned (default 12). */
  max?: number;
  /** Max sentences read (default 300). */
  maxSentences?: number;
}

/** Every event named in the text: one hit per rule (the first sentence that
 *  states it, replaced by a later one only when that one states a figure),
 *  lead event first. Routine hits are returned too, flagged `routine`. */
export function classifyIndiaEvents(text: string, opts: InClassifyOptions = {}): InEventHit[] {
  const raw = String(text || '').slice(0, 120_000);
  if (!raw.trim()) return [];
  const sents = opts.headline ? [raw.replace(/\s+/g, ' ').replace(PREAMBLE, '').trim()] : inSentences(raw).slice(0, opts.maxSentences ?? 300);
  const byId = new Map<string, InEventHit & { order: number }>();
  sents.forEach((s, order) => {
    if (!s || IN_BOILERPLATE.test(s)) return;
    s = s.replace(LETTER_FURNITURE, ' ').replace(/\s+/g, ' ').replace(/^[\s,.:;/-]+/, '').trim();
    if (s.length < 8) return;
    const m = matchForm(s);
    const here: Array<{ r: Rule; hit: InEventHit }> = [];
    for (const r of RULES) {
      const had = byId.get(r.id);
      if (had && had.figures.length) continue;
      if (!r.any.some((re) => re.test(m))) continue;
      if (r.not && r.not.test(m)) continue;
      const shown = clip(s);
      const figures = inFiguresIn(shown);
      if (had && !figures.length) continue;
      const note = typeof r.note === 'function' ? r.note(m) : (r.note ?? null);
      here.push({ r, hit: { id: r.id, label: r.label, category: r.category, direction: r.dir ? r.dir(m) : r.direction, sentence: shown, figures, planned: !r.routine && r.category !== 'Exchange disclosure' && r.category !== 'Results' && PLANNED.test(shown), routine: !!r.routine, strength: null, note } });
    }
    const hidden = new Set(here.flatMap((x) => x.r.hides || []));
    for (const x of here) {
      if (hidden.has(x.r.id)) continue;
      const had = byId.get(x.r.id);
      byId.set(x.r.id, { ...x.hit, order: had ? had.order : order });
    }
  });
  // a sentence-level hide also applies across sentences for the same filing:
  // a turnaround hides "net loss" (the year-ago loss), an open offer hides the stake-sale report it answers.
  const all = Array.from(byId.values());
  const crossHide = new Set(all.flatMap((h) => RULE_BY_ID.get(h.id)?.hides || []));
  const kept = all.filter((h) => !crossHide.has(h.id) || h.id === 'results_filed' && !all.some((x) => x.category === 'Results' && x.id !== 'results_filed'));
  // results strength — only from what the sentence states
  for (const h of kept) {
    if (h.id === 'turnaround_profit') {
      // the profit is the figure BEFORE "as against / compared with" (the year-ago loss comes after it)
      const head = h.sentence.split(/\b(?:as against|against|compared (?:to|with)|versus|vs\.?|from a)\b/i)[0];
      const cr = inFiguresIn(head).map(figureCrore).filter((v): v is number => v != null);
      if (cr.length && cr[0] < 5) { h.strength = 'small'; h.note = 'turnaround, small'; }
    } else if (h.id === 'revenue_decline' || h.id === 'profit_decline' || h.id === 'net_loss' || ((h.id === 'revenue_vs_prior' || h.id === 'profit_vs_prior') && h.direction === 'negative')) h.strength = 'weak';
  }
  const rank = (id: string) => RULE_BY_ID.get(id)?.rank ?? 99;
  return kept
    .sort((a, b) => Number(a.routine) - Number(b.routine) || (Math.min(a.order, 4) - Math.min(b.order, 4)) * 3 + (rank(a.id) - rank(b.id)) || Number(a.planned) - Number(b.planned) || a.order - b.order)
    .slice(0, opts.max ?? 12)
    .map(({ order: _o, ...h }) => ({ ...h, economicDirection: directionOf(h.id, h.sentence, h.direction), directionNote: directionNote(h.id, h.sentence), subtype: subtypeOf(h.id, h.sentence) }));
}

/** Counts of hits by category (every category present, zero when none). */
export function countInByCategory(hits: Array<Pick<InEventHit, 'category'>>): Record<InEventCategory, number> {
  const out = Object.fromEntries(IN_EVENT_CATEGORIES.map((c) => [c, 0])) as Record<InEventCategory, number>;
  for (const h of hits) out[h.category] = (out[h.category] || 0) + 1;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA CARD — what one gainer's filings and press say, honestly labelled.
// ═══════════════════════════════════════════════════════════════════════════

export const IN_CARD_VERSION = 1;
/** A quarterly result this recent is still the latest fundamental news. */
export const IN_BACKDROP_DAYS = 60;

export interface InCatalyst extends InEventHit {
  source: 'FILING' | 'PRESS';
  /** "exchange filing (document read)", "exchange filing (subject / summary)", "reported, not confirmed by the company", "press; the company filed on the same subject". */
  sourceLabel: string;
  /** A press item whose event an exchange filing also states. */
  confirmedByFiling: boolean;
  date: string | null;
  url: string | null;
  ageDays: number | null;
  /** The filing's subject / the headline — what the reader clicks. */
  title: string;
  // ── zzz835 (optional; cards cached before this lack them) ──
  /** PROPOSED for an LOI / tentative / non-binding / subject-to-approval event - never firm, never booked. */
  stage?: EventStage | null;
  /** 'conflicting' when a headline / summary / press value differs from the filed value - both are kept in `values`. */
  valueStatus?: ValueStatus;
  values?: EventValue[];
  conflicts?: string[];
  /** True when the impact cannot be sized (conflict, or a value not confirmed by a filed document). */
  impactUnknown?: boolean;
  /** Age at the move day and the causal-window verdict (context only when outside). */
  ageDaysAtMove?: number | null;
  causalWindowStatus?: CausalWindow['status'];
  contextOnly?: boolean;
  // ── zzz836 (optional): two independent fields, never one 'verified' chip ──
  /** SOURCE EXISTENCE: 'official' (an exchange filing) | 'press' | 'both' (press whose event a filing also states). */
  sourceExistence?: 'official' | 'press' | 'both';
  /** EVIDENCE VERIFICATION: 'document_read' | 'document_not_read' | 'secondary_only' | 'contradicted'. An official filing that was not read is NOT verified. */
  evidenceVerification?: 'document_read' | 'document_not_read' | 'secondary_only' | 'contradicted';
  /** 'headline' = the card's lead event; 'context' = press / older items about other topics, never the headline's evidence. */
  evidenceRole?: 'headline' | 'supporting' | 'context';
}

export interface InBackdrop {
  /** The results filing (or, with no filing in the fetched list, the press report of it). */
  filing: { title: string; date: string | null; ageDays: number | null; url: string | null } | null;
  /** The strongest Results event read — from the filing text first, else a press report of the same result. */
  lead: InCatalyst | null;
  /** 'growth' | 'turnaround' | 'turnaround_small' | 'weak' | 'filed' (figures not stated in what was read). */
  tone: 'growth' | 'turnaround' | 'turnaround_small' | 'weak' | 'filed';
  label: string;
  /** Other Results facts read (restatement, margins …). */
  also: InCatalyst[];
  // ── zzz836 (optional) ──
  /** True when the result filing is older than 14 days: shown as context, never as the KEY CHANGE. */
  context?: boolean;
  /** "OLDER RESULT (46d) - context" when `context`. */
  contextLabel?: string | null;
}

export interface InCard {
  v: number;
  /** Every non-routine event found (filings in the window first, then press), lead first. */
  catalysts: InCatalyst[];
  /** The event this move is filed under — null when there is none. */
  lead: InCatalyst | null;
  /** The latest quarterly result within IN_BACKDROP_DAYS. */
  backdrop: InBackdrop | null;
  /** The exchange clarification on a price / volume movement, when one is on file. */
  clarification: InCatalyst | null;
  /** Routine filings in the window, named. */
  routine: Array<{ label: string; title: string; date: string | null }>;
  filingsChecked: number;
  pressChecked: number;
  /** zzz835: every value conflict on the card (headline vs filed), plainly worded. */
  conflicts?: string[];
  /** zzz835: what was searched and how far back - printed with any "no catalyst" conclusion. */
  searched?: { filings: number; press: number; lookbackDays: number; sources: string[] };
  /** zzz835: never "no catalyst" when an event was extracted. */
  catalystStatus?: 'no_event_found' | 'event_found_low_information' | 'event_found_not_market_moving' | 'event_found_unverified' | 'confirmed_material_event';
  /** The move day (IST calendar) the causal windows were measured against. */
  moveDate?: string | null;
  /** zzz836: the headline (lead) event's OWN date and age - the timing line must be computed from this, never from another filing. */
  headline?: { id: string; label: string; date: string | null; ageDays: number | null; ageDaysAtMove: number | null; source: 'FILING' | 'PRESS'; causalWindowStatus: CausalWindow['status'] | null } | null;
  /** One plain sentence — never empty; "No catalyst found in filings or news" when nothing. */
  summary: string;
}

export interface InCardFiling { subject: string; summary: string | null; url: string | null; dateIso: string | null; ageDays?: number | null;
  /** Sentences read in the filed document (verbatim quotes), when it was opened. */
  docText?: string | null }
export interface InCardPress { title: string; url: string | null; date: string | null; source?: string | null }

const QUOTES_PRESS = /\bcaptioned\b|\bnews (?:item|article|report)s?\b|\brumou?r verification\b|\bmarket rumou?rs?\b|\bmedia (?:report|article)s?\b/i;
// zzz835: days are IST calendar days (Asia/Kolkata), never UTC or the server's / browser's clock.
const dayOf = (iso: string | null | undefined): string | null => exchangeDay(iso, 'IN');
const ageOf = (iso: string | null | undefined, now: Date): number | null => {
  const a = exchangeAgeDays(iso, now, 'IN');
  return a == null ? null : Math.max(0, a);
};
/** The first money amount of a hit in ₹ crore, from its own stated figures. */
const hitCrore = (h: Pick<InEventHit, 'figures' | 'sentence'>): number | null => {
  for (const f of h.figures) { const v = figureCrore(f); if (v != null) return v; }
  return null;
};
const fmtCrText = (v: number) => `Rs ${Math.round(v * 100) / 100} crore`;
const rankOf = (id: string) => RULE_BY_ID.get(id)?.rank ?? 99;
/** Events that explain nothing on their own — they never lead the card. */
const NEVER_LEAD = new Set(['price_clarification', 'exchange_query', 'results_filed', 'commodity_price']);
const RESULT_TONE_ORDER = ['turnaround_profit', 'revenue_growth', 'profit_growth', 'record_results', 'revenue_vs_prior', 'profit_vs_prior', 'revenue_decline', 'profit_decline', 'net_loss', 'margin_expansion', 'margin_compression', 'restatement', 'guidance', 'order_book', 'results_filed'];

function filingHits(f: InCardFiling): Array<InEventHit & { fromDoc: boolean }> {
  const subj = classifyIndiaEvents(f.subject, { headline: true });
  const body = f.summary ? classifyIndiaEvents(f.summary) : [];
  const doc = f.docText ? classifyIndiaEvents(f.docText) : [];
  const out = new Map<string, InEventHit & { fromDoc: boolean }>();
  // document sentences first (verbatim, read), then the summary, then the subject; a later source only adds a figure-bearing sentence.
  for (const [hs, fromDoc] of [[doc, true], [body, false], [subj, false]] as const) {
    for (const h of hs) {
      const had = out.get(h.id);
      if (!had || (!had.figures.length && h.figures.length)) out.set(h.id, { ...h, fromDoc });
    }
  }
  // A routine subject stays routine: a "Trading Window Closure" letter that mentions "financial results" is not a result.
  const subjRoutine = subj.length > 0 && subj.every((h) => h.routine);
  if (subjRoutine) for (const [k, h] of Array.from(out.entries())) if (!h.routine && (h.category === 'Results' || h.id === 'stake_disclosure')) out.delete(k);
  // An outcome-of-board-meeting letter that approves results is a result, even when it also names the AGM or a record date.
  return Array.from(out.values());
}

function resultTone(hits: InEventHit[]): InBackdrop['tone'] {
  const ids = new Set(hits.map((h) => h.id));
  const turn = hits.find((h) => h.id === 'turnaround_profit');
  if (turn) return turn.strength === 'small' ? 'turnaround_small' : 'turnaround';
  const vs = hits.filter((h) => h.id === 'revenue_vs_prior' || h.id === 'profit_vs_prior');
  const up = ids.has('revenue_growth') || ids.has('profit_growth') || ids.has('record_results') || vs.some((h) => h.direction === 'positive');
  const down = ids.has('revenue_decline') || ids.has('profit_decline') || ids.has('net_loss') || (vs.length > 0 && vs.every((h) => h.direction === 'negative'));
  if (up && !down) return 'growth';
  if (down && !up) return 'weak';
  if (up && down) return 'growth';
  return 'filed';
}

/** Build the India card for one gainer. `filings` may reach back further than
 *  the window — only results filings older than the window are used, and only
 *  as the backdrop. Pure. */
export function buildIndiaCard(input: { filings: InCardFiling[]; press: InCardPress[]; now: Date; windowDays: number; backdropDays?: number; sessionCloseIso?: string | null; moveDate?: string | null;
  /** Causal window for an official filing (default: windowDays; the QA brief's default is 3) and for a press item (default: windowDays; brief: 1). An item older than its window is context only. */
  causalWindowDays?: number; pressWindowDays?: number }): InCard {
  const { now, windowDays } = input;
  const backdropDays = input.backdropDays ?? IN_BACKDROP_DAYS;
  const closeT = input.sessionCloseIso ? Date.parse(input.sessionCloseIso) : NaN;
  const afterClose = (iso: string | null) => !!iso && Number.isFinite(closeT) && Date.parse(iso) > closeT;
  const filings = input.filings
    .map((f) => ({ ...f, ageDays: f.ageDays ?? ageOf(f.dateIso, now) }))
    .filter((f) => f.ageDays == null || f.ageDays <= backdropDays)
    .sort((a, b) => String(b.dateIso || '').localeCompare(String(a.dateIso || '')));
  const inWin = filings.filter((f) => (f.ageDays == null || f.ageDays <= windowDays) && !afterClose(f.dateIso));

  const catalysts: InCatalyst[] = [];
  const routine: InCard['routine'] = [];
  let clarification: InCatalyst | null = null;
  const toCat = (h: InEventHit, f: InCardFiling & { ageDays: number | null }, fromDoc: boolean): InCatalyst => ({
    ...h, sourceExistence: 'official', evidenceVerification: fromDoc ? 'document_read' : 'document_not_read', source: 'FILING', sourceLabel: fromDoc ? 'exchange filing (document read)' : 'exchange filing (subject / summary)', confirmedByFiling: true,
    date: dayOf(f.dateIso), url: f.url ?? null, ageDays: f.ageDays, title: clip(f.subject || h.sentence, 160),
  });
  for (const f of inWin) {
    const hits = filingHits(f);
    const real = hits.filter((h) => !h.routine);
    // An exchange news / rumour verification QUOTES a press report ("news item captioned …"): the event in it is
    // the press story, not the company's disclosure — labelled reported, not confirmed by the company.
    const quotesPress = QUOTES_PRESS.test(`${f.subject} ${f.summary || ''}`);
    if (!real.length) {
      const r = hits.find((h) => h.routine);
      if (routine.length < 8) routine.push({ label: r ? r.label : 'Routine / unclassified filing', title: clip(f.subject, 140), date: dayOf(f.dateIso) });
      continue;
    }
    for (const h of real) {
      const c0 = toCat(h, f, h.fromDoc);
      const c: InCatalyst = quotesPress && h.category !== 'Exchange disclosure'
        ? { ...c0, source: 'PRESS', confirmedByFiling: false, planned: h.planned || h.id === 'promoter_stake_sale', sourceLabel: 'reported in the press (quoted in an exchange news-verification filing) — not confirmed by the company' }
        : c0;
      if (h.id === 'price_clarification') { if (!clarification) clarification = c; continue; }
      if (!catalysts.some((x) => x.id === c.id && (x.source === c.source || x.source === 'FILING'))) catalysts.push(c);
    }
  }

  // Press: each dated headline, labelled "reported, not confirmed by the company" unless a filing states the same event.
  const press = (input.press || []).filter((p) => p && p.title).slice(0, 12);
  const pressCats: InCatalyst[] = [];
  for (const p of press) {
    const age = ageOf(p.date, now);
    if (age != null && age > backdropDays) continue;
    for (const h of classifyIndiaEvents(p.title, { headline: true })) {
      if (h.routine || pressCats.some((x) => x.id === h.id)) continue;
      const confirmed = catalysts.some((c) => c.source === 'FILING' && (c.id === h.id || (c.category === h.category && h.category !== 'Results' && h.category !== 'Exchange disclosure' && h.category !== 'Ownership & control')));
      pressCats.push({ ...h, sourceExistence: confirmed ? 'both' : 'press', evidenceVerification: 'secondary_only', planned: h.planned || h.id === 'promoter_stake_sale', source: 'PRESS', sourceLabel: confirmed ? 'press; an exchange filing states the same event' : 'reported, not confirmed by the company', confirmedByFiling: confirmed,
        date: dayOf(p.date), url: p.url ?? null, ageDays: age, title: clip(`${p.title}${p.source ? ` — ${p.source}` : ''}`, 180) });
    }
  }

  // BACKDROP — the latest quarterly result within backdropDays (in the window or older).
  let backdrop: InBackdrop | null = null;
  for (const f of filings) {
    if (afterClose(f.dateIso)) continue;
    const hits = filingHits(f).filter((h) => h.category === 'Results' && !h.routine);
    if (!hits.length) continue;
    const pressRes = pressCats.filter((c) => c.category === 'Results' && c.id !== 'results_filed' && (c.ageDays == null || f.ageDays == null || c.ageDays <= f.ageDays + 2));
    const own = hits.map((h) => toCat(h, f, h.fromDoc));
    const informative = own.filter((c) => c.id !== 'results_filed');
    const pool = informative.length ? informative : pressRes;
    const sorted = [...pool].sort((a, b) => RESULT_TONE_ORDER.indexOf(a.id) - RESULT_TONE_ORDER.indexOf(b.id));
    const lead = sorted[0] || null;
    const tone = resultTone(pool);
    const d = dayOf(f.dateIso);
    const when = `filed ${d || 'undated'}${f.ageDays != null ? `, ${f.ageDays}d ago` : ''}`;
    const label = tone === 'turnaround_small' ? `Turnaround, small — quarterly result (${when})`
      : tone === 'turnaround' ? `Turnaround to profit — quarterly result (${when})`
        : tone === 'growth' ? `Quarterly result: growth (${when})`
          : tone === 'weak' ? `Weak result (${when})`
            : `Quarterly result filed (${when}) — figures not stated in the text read`;
    const ctx = contextTag(f.ageDays, 'result');
    backdrop = { filing: { title: clip(f.subject, 160), date: d, ageDays: f.ageDays, url: f.url ?? null }, lead, tone, label, also: sorted.slice(1, 4), context: ctx.context, contextLabel: ctx.label };
    break;
  }
  if (!backdrop) {
    // No results filing in the fetched list: a press report of a result is the backdrop — labelled press.
    const pr = pressCats.filter((c) => c.category === 'Results' && c.id !== 'results_filed' && (c.ageDays == null || c.ageDays <= backdropDays))
      .sort((a, b) => RESULT_TONE_ORDER.indexOf(a.id) - RESULT_TONE_ORDER.indexOf(b.id));
    if (pr.length) {
      const tone = resultTone(pr);
      const when = `reported ${pr[0].date || 'undated'}${pr[0].ageDays != null ? `, ${pr[0].ageDays}d ago` : ''}; press, the results filing itself was not in the fetched list`;
      const label = tone === 'turnaround_small' ? `Turnaround, small — quarterly result (${when})` : tone === 'turnaround' ? `Turnaround to profit — quarterly result (${when})` : tone === 'growth' ? `Quarterly result: growth (${when})` : tone === 'weak' ? `Weak result (${when})` : `Quarterly result (${when})`;
      const ctx = contextTag(pr[0].ageDays, 'result');
      backdrop = { filing: null, lead: pr[0], tone, label, also: pr.slice(1, 3), context: ctx.context, contextLabel: ctx.label };
    }
  }

  // Merge: filing events, then press events not already filed.
  const merged: InCatalyst[] = [...catalysts];
  for (const p of pressCats) {
    const same = merged.findIndex((c) => c.id === p.id);
    if (same < 0) merged.push(p);
    // a press item and an exchange query quoting the same story are one reported event — the dated press item is kept
    else if (merged[same].source === 'PRESS' && !merged[same].confirmedByFiling && (merged[same].ageDays ?? 99) >= (p.ageDays ?? 99)) merged[same] = { ...p, url: p.url || merged[same].url };
  }
  const score = (c: InCatalyst) => rankOf(c.id) + (c.source === 'PRESS' ? 3 : 0) + (c.planned ? 1 : 0) + (c.category === 'Results' ? 2 : 0) - (c.figures.length ? 1 : 0);
  merged.sort((a, b) => score(a) - score(b));
  // The lead is a fresh event: an in-window filing, or press dated inside the window. Results older than the window are the backdrop, not the lead.
  const lead = merged.find((c) => !NEVER_LEAD.has(c.id) && (c.ageDays == null || c.ageDays <= windowDays)) || null;

  // ── zzz835: stage, value conflicts, causal windows, search record ──
  const moveDate = input.moveDate || (input.sessionCloseIso ? dayOf(input.sessionCloseIso) : null) || exchangeDate(now, 'IN');
  const conflicts: string[] = [];
  const shown = merged.slice(0, 12);
  for (const c of shown) {
    if (c.category !== 'Results' && c.category !== 'Exchange disclosure') c.stage = stageFromText(c.sentence) ?? undefined;
    if (c.stage === 'PROPOSED') c.impactUnknown = true;
    const cw = causalWindow({ itemDate: c.date, moveDate, official: c.source === 'FILING', windowDays: c.source === 'FILING' ? (input.causalWindowDays ?? windowDays) : (input.pressWindowDays ?? input.causalWindowDays ?? windowDays) });
    c.ageDaysAtMove = cw.ageDaysAtMove; c.causalWindowStatus = cw.status; c.contextOnly = cw.contextOnly;
    c.evidenceRole = c === lead ? 'headline' : (c.source === 'PRESS' || c.contextOnly || (c.ageDays != null && c.ageDays > windowDays)) ? 'context' : 'supporting';
  }
  // a headline / summary / press value that differs from the FILED value: keep both, never pick one
  for (const f of inWin) {
    const meta = [...classifyIndiaEvents(f.subject, { headline: true }), ...(f.summary ? classifyIndiaEvents(f.summary) : [])];
    const doc = f.docText ? classifyIndiaEvents(f.docText) : [];
    for (const d of doc) {
      const dv = hitCrore(d);
      const m = meta.find((x) => x.id === d.id && hitCrore(x) != null);
      if (dv == null || !m) continue;
      const r = reconcileValues([{ value: dv, unit: 'INR_CRORE', source: 'filed', text: fmtCrText(dv) }, { value: hitCrore(m)!, unit: 'INR_CRORE', source: 'headline', text: fmtCrText(hitCrore(m)!) }]);
      if (r.valueStatus !== 'conflicting') continue;
      const tgt = shown.find((c) => c.id === d.id && c.source === 'FILING');
      if (tgt) { tgt.valueStatus = 'conflicting'; tgt.values = r.values; tgt.conflicts = [...(tgt.conflicts || []), ...r.conflicts]; tgt.impactUnknown = true; }
      conflicts.push(...r.conflicts);
    }
  }
  for (const p of shown.filter((c) => c.source === 'PRESS')) {
    const pv = hitCrore(p);
    for (const fcat of shown.filter((c) => c.source === 'FILING' && c.id === p.id)) {
      const fv = hitCrore(fcat);
      if (pv == null || fv == null) continue;
      const r = reconcileValues([{ value: fv, unit: 'INR_CRORE', source: 'filed', text: fmtCrText(fv) }, { value: pv, unit: 'INR_CRORE', source: 'press', text: fmtCrText(pv) }]);
      if (r.valueStatus !== 'conflicting') continue;
      for (const t of [p, fcat]) { t.valueStatus = 'conflicting'; t.values = r.values; t.conflicts = [...(t.conflicts || []), ...r.conflicts]; t.impactUnknown = true; }
      conflicts.push(...r.conflicts);
    }
  }
  for (const c of shown) if (c.valueStatus === 'conflicting') c.evidenceVerification = 'contradicted';
  const conflictNotes = Array.from(new Set(conflicts));
  const hl = lead ? { id: lead.id, label: lead.label, date: lead.date, ageDays: lead.ageDays, ageDaysAtMove: lead.ageDaysAtMove ?? null, source: lead.source, causalWindowStatus: lead.causalWindowStatus ?? null } : null;

  let summary: string;
  if (lead) summary = `${lead.label}${lead.planned && lead.source === 'PRESS' ? ' (reported plan)' : ''} — ${lead.sourceLabel}${lead.date ? `, ${lead.date}` : ''}`;
  else if (clarification) summary = `Exchange clarification on price / volume movement${clarification.date ? ` (${clarification.date})` : ''} — company says no undisclosed information; no fundamental catalyst filed`;
  else if (merged.some((c) => c.id === 'exchange_query')) {
    const q = merged.find((c) => c.id === 'exchange_query')!;
    summary = `Exchange query on the price / volume movement${q.date ? ` (${q.date})` : ''} — the company's reply was not read; no fundamental catalyst found${backdrop ? ` · backdrop: ${backdrop.label}` : ''}`;
  }
  else if (backdrop) summary = `No fresher event · ${backdrop.label} is the fundamental backdrop`;
  else if (routine.length) summary = `Routine filings only (${Array.from(new Set(routine.map((r) => r.label.toLowerCase()))).slice(0, 3).join(', ')}) — no fresh catalyst`;
  else summary = 'No catalyst found in filings or news';

  const eventFound = !!lead || !!clarification || merged.some((c) => c.id === 'exchange_query') || !!backdrop || routine.length > 0;
  const catalystStatus: InCard['catalystStatus'] = !eventFound ? 'no_event_found'
    : lead ? (lead.source === 'FILING' && !lead.contextOnly ? 'confirmed_material_event' : 'event_found_unverified')
      : routine.length && !backdrop && !clarification ? 'event_found_low_information' : 'event_found_not_market_moving';
  const searched = { filings: inWin.length, press: press.length, lookbackDays: windowDays, sources: ['exchange filings (NSE / BSE announcements)', 'press headlines'] };
  return { v: IN_CARD_VERSION, catalysts: shown, lead, backdrop, clarification, routine, filingsChecked: inWin.length, pressChecked: press.length, conflicts: conflictNotes, searched, catalystStatus, moveDate, headline: hl, summary };
}

/** The sentences of a filed document that name a (non-routine) event — kept with the document read so the
 *  India card can quote the company's own words (a clarification reply, a results press release). Verbatim, ≤ 8. */
export function indiaEventLines(text: string, max = 8): string[] {
  return classifyIndiaEvents(text, { max: 20 }).filter((h) => !h.routine).map((h) => h.sentence).filter((x, i, a) => a.indexOf(x) === i).slice(0, max);
}
