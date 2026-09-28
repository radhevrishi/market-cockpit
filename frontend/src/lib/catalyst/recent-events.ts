// ═══════════════════════════════════════════════════════════════════════════
// NEW IN THE LAST 10 DAYS — what actually happened, and whether it matters.
//                                                        (zzz808 → zzz813)
//
// The owner's first ask: "add a tab in India and USA portfolio catalyst: new
// in last 10 days. Show them with one filter." His verdict on v1: "it's not
// good. It should read and show the final important info to me already."
// v1 listed raw exchange subject lines ("Reg 23(5)(i): Disclosure of material
// issue", "Press Release", "General Updates") and typed them by keyword, so a
// BMC tax notice ("Action(s) initiated or orders passed") read as an ORDER WIN
// and a promoter inter-se transfer as an ACQUISITION.
//
// v2 (zzz813), still pure — no fetch, no model, no price:
//   1. SUBJECT CLASSIFIER with the exchange's own wording: clarification ≠
//      results, "orders passed" = regulatory / legal, inter-se transfer =
//      promoter holding change, SAST = shareholding disclosure, scheme /
//      demerger = corporate restructuring, sale or disposal = divestment,
//      CP/NCD repayment, ESG rating, AGM, newspaper ads = routine. A generic
//      subject ("Press Release", "General Updates", "Reg 30", "material
//      issue") is marked GENERIC: the document decides.
//   2. THE DOCUMENT READ (lib/catalyst/filing-read, server-side, cached per
//      URL) supplies the one line that matters and the stated figures; the
//      raw subject stays underneath in small grey text.
//   3. GROUPING: one row per company per event — filings of the same event
//      type within 2 days are one row ("3 filings", expandable).
//   4. IMPORTANCE: Material / Notable / Minor, in words. Sorted by importance,
//      then kind (results with numbers, orders with value, capacity, M&A …),
//      then date. Minor sits behind the routine toggle with the routine
//      filings.
//   5. THESIS: the read's variables mapped onto the name's thesis type
//      (THESES in lib/thesis/ledger) deterministically; a name without a type
//      says so in words, never a bare "Not assessed".
// A figure is printed only when the filing states it.
// ═══════════════════════════════════════════════════════════════════════════

import { VAR_LABEL } from '../thesis/taxonomy';
import { THESES } from '../thesis/ledger';
import type { FilingRead, Touch } from './filing-read-types';
import { buildCard, pairVerified, tidyFigure, usdShort, usdAmountIn, type Claim, type EventCard } from './event-card';
import { accessionOf } from './us-filings';
import { usBoilerplateEvidence } from '../us-thesis/sanitize';

export type { FilingRead, Touch } from './filing-read-types';
export type { EventCard, Impact, EvidenceQuality, Claim } from './event-card';

export const EVENT_TYPES = [
  'Results', 'Order win', 'Capex / capacity', 'Corporate restructuring', 'Acquisition', 'Divestment',
  'Regulatory approval', 'Fund raise', 'Guidance', 'Management change', 'Concall / business update',
  'Regulatory / legal action', 'Credit rating', 'Corporate action', 'Exchange clarification', 'Shareholding disclosure',
  'Promoter holding change', 'Other filing',
] as const;
export type RecentEventType = typeof EVENT_TYPES[number];
export type TypeFilter = RecentEventType | 'All';
export type SourceBadge = 'filed' | 'press';
export type ThesisTouch = 'supports' | 'against' | 'neutral' | 'not assessed';
export type Importance = 'Material' | 'Notable' | 'Minor';
export type RawOrigin = 'ledger-doc' | 'ledger-event' | 'pending-doc' | 'persistent' | 'feed';

/** What the page knows about a name's thesis — enough to map an event. */
export interface ThesisCtx {
  /** A / B / F / G, or null when no thesis type is set. */
  pattern: string | null;
  /** 'provisional' when the type is a nearest fit the owner has not confirmed. */
  fit?: 'exact' | 'provisional' | null;
  assessment?: any;
}

/** One observation from one source, before merging. */
export interface RawEvent {
  ticker: string;
  company?: string | null;
  /** Source date: ISO date or datetime. Undated observations are dropped. */
  date: string | null;
  /** The document's own title / subject / label. */
  title: string;
  kind?: string | null;
  variable?: string | null;
  /** Extracted event direction when known ('up' | 'down' | …). */
  direction?: string | null;
  text?: string | null;
  figure?: string | null;
  /** zzz824: the stated prior / latest behind `figure`, and the source quote — a change is verified only when the
   *  quote carries both numbers. */
  before?: string | null;
  after?: string | null;
  quote?: string | null;
  url?: string | null;
  source?: string | null;
  badge?: SourceBadge;
  /** @deprecated v1 — kept so old callers compile; the thesis is derived from ctx. */
  thesis?: ThesisTouch;
  ctx?: ThesisCtx | null;
  origin: RawOrigin;
}

export interface FilingRef {
  date: string;
  title: string;
  url: string | null;
  badge: SourceBadge;
  line: string | null;
  read: ReadState;
  readNote: string | null;
}
export type ReadState = 'read' | 'failed' | 'pending' | 'not-needed';

export interface RecentEvent {
  id: string;
  date: string;               // newest filing of the event, YYYY-MM-DD
  ticker: string;
  company: string | null;
  type: RecentEventType;
  /** The lead filing's own subject (shown small and grey). */
  title: string;
  /** The one line that matters. */
  what: string;
  figure: string | null;
  badge: SourceBadge;
  url: string | null;
  source: string | null;
  importance: Importance;
  thesis: ThesisTouch;
  thesisWhy: string;
  origins: RawOrigin[];
  routine: boolean;
  routineWhy?: string | null;
  read: ReadState;
  readNote: string | null;
  /** Every filing merged into this event (≥ 1). */
  filings: FilingRef[];
  /** zzz824: the decision card — every field computed separately (lib/catalyst/event-card). */
  card?: EventCard;
  /** zzz824: the name's thesis context (type + assessment) — the ledger side panel reads it. */
  ctx?: ThesisCtx | null;
  /** zzz824: NSE / BSE / SEC, from the document address. */
  exchange?: string | null;
  /** zzz825: when the lead document is still unread, which reading tier it sits in (see ReadTier). */
  readTier?: ReadTier | null;
  /** zzz829: other events stated in the SAME filing (one 8-K = one card) and changes it states in a metric other
   *  than the headline's — listed under the headline as "also in this filing". */
  also?: Array<{ type: string; line: string; dir?: 'up' | 'down' | null }>;
}

export interface RecentCatalystResult {
  /** Material + Notable events in the window, most important first. */
  items: RecentEvent[];
  /** Minor events in the window (behind the toggle). */
  minor: RecentEvent[];
  /** Routine filings in the window (behind the toggle), counted. */
  hidden: RecentEvent[];
  /** Counts per type over `items`, plus 'All'. */
  counts: Record<TypeFilter, number>;
  /** The newest non-routine item at ANY date — for the empty state. */
  lastItem: { date: string; ticker: string } | null;
  window: { from: string; to: string; days: number };
  /** Documents in the window the reader should open (newest first), for the page's reading queue. */
  toRead: ReadRequest[];
  /** `lazy`: known-Minor documents left for the owner to open (Minor section / "read now"). */
  reading: { total: number; read: number; failed: number; pending: number; lazy?: number };
}

/** zzz825 (owner spec §34): the reading order. `first` = Material / Notable by what is already on file;
 *  `open` = the subject names no event, or the document can still raise it (a deck, a rating letter, a
 *  bonus notice) — read after `first`; `minor` = Minor whatever the document says (a non-senior
 *  appointment, a shareholding form) — read ONLY when the Minor section is opened or the row is clicked.
 *  Routine paperwork is never read. */
export type ReadTier = 'first' | 'open' | 'minor';
export interface ReadRequest { url: string; ticker: string; subject: string; date: string; company: string | null; tier?: ReadTier }

export const DEFAULT_WINDOW_DAYS = 10;
export const GROUP_DAYS = 2;

// ── dates ──────────────────────────────────────────────────────────────────

export function isoDay(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function dayNum(d: string): number { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86_400_000; }
/** Whole days from `date` to `today` (0 = same day, 9 = nine days before). */
export function daysAgo(date: string, today: string): number { return dayNum(today) - dayNum(date); }
/** Today and the days-1 before it; one day ahead is tolerated (IST vs Europe). */
export function inWindow(date: string | null | undefined, today: string, days: number = DEFAULT_WINDOW_DAYS): boolean {
  const d = isoDay(date);
  if (!d) return false;
  const n = daysAgo(d, today);
  return n >= -1 && n < days;
}
export function windowStartDay(today: string, days: number = DEFAULT_WINDOW_DAYS): string {
  return new Date((dayNum(today) - (days - 1)) * 86_400_000).toISOString().slice(0, 10);
}

// ── the subject classifier ────────────────────────────────────────────────

export interface SubjectClass {
  type: RecentEventType;
  /** Why it is routine, when it is. */
  routine: string | null;
  /** The subject names no event ("Press Release", "General Updates") — the document decides. */
  generic: boolean;
  /** CEO / CFO / MD / chairman level (management changes). */
  senior: boolean;
}

const ROUTINE: Array<[RegExp, string]> = [
  [/trading\s+window/i, 'trading window'],
  [/intimation\s+of\s+(the\s+)?(analyst|investor|institutional|fund\s+manager)|(analysts?|investors?|institutional\s+investors?)\s*(\/\s*\w+\s*)?(meet|meeting|call|conference)s?\s*[-–:]?\s*(intimation|schedule)|schedule\s+of\s+(analyst|investor|institutional)/i, 'analyst / investor meet intimation'],
  [/newspaper|news\s*paper|publication\s+of\s+.*(results|notice)|advertisement/i, 'newspaper advertisement'],
  [/(prior\s+)?intimation\s+of\s+(the\s+)?board\s+meeting|notice\s+of\s+board\s+meeting|board\s+meeting\s+intimation/i, 'board meeting intimation'],
  [/loss\s+of\s+share\s+certificate|duplicate\s+share\s+certificate|issue\s+of\s+duplicate/i, 'share certificate'],
  [/regulation\s*74\s*\(\s*5\s*\)|reg\.?\s*74\s*\(\s*5\s*\)|compliance\s+certificate|certificate\s+under\s+reg/i, 'compliance certificate'],
  [/record\s+date|book\s+closure|postal\s+ballot|scrutini[sz]er|voting\s+results|notice\s+of\s+(the\s+)?(agm|egm|annual\s+general)|shareholders?'?\s+meeting|annual\s+general\s+meeting|\bAGM\b|\bEGM\b|annual\s+report\s+(for|dispatch)|dispatch\s+of\s+annual/i, 'shareholder meeting / record date'],
  [/investor\s+grievance|registrar\s+(and|&)\s+(share\s+)?transfer|\bRTA\b/i, 'registrar / grievance'],
  [/\bESOP\b|\bESOS\b|employee\s+stock\s+option/i, 'employee stock option allotment'],
  [/\bESG\s+rating|\bESG\b/i, 'ESG rating'],
  [/commercial\s+paper|\bCPs?\b\s+(issue|repay|redempt)|(repayment|redemption|payment\s+of\s+(interest|principal)|servicing)\s+.{0,40}(commercial\s+paper|\bNCDs?\b|debentures?|bonds?)|(commercial\s+paper|\bNCDs?\b|debentures?)\s+.{0,40}(repay|redeem|redemption|interest\s+payment)/i, 'debt servicing (CP / NCD repayment)'],
  [/statement\s+of\s+(deviation|variation)|shareholding\s+pattern|reconciliation\s+of\s+share\s+capital|regulation\s*(39|40)\s*\(|certificate\s+under\s+regulation\s*(7|57)/i, 'periodic compliance filing'],
  [/audio\s+recording|recording\s+of\s+(the\s+)?(earnings|conference|analyst|investor)|link\s+(to|of)\s+(the\s+)?(audio|recording)/i, 'call recording link'],
  [/change\s+in\s+(registered|corporate)\s+office\s+address|change\s+of\s+(e-?mail|website|contact)/i, 'address / contact change'],
];

const SENIOR = /\b(ceo|chief\s+executive|cfo|chief\s+financial|managing\s+director|\bmd\b|chairman|chairperson|whole[-\s]time\s+director|executive\s+director|coo|chief\s+operating|president|jt\.?\s+managing|joint\s+managing|company\s+secretary)\b/i;

const RULES: Array<[RegExp, RecentEventType, { generic?: boolean }?]> = [
  // exchange questions first: "Reply to Clarification- Financial results" is a reply, not results
  [/clarification|spurt\s+in\s+(volume|price)|(price|volume)\s+movement|movement\s+in\s+(price|volume)|significant\s+(increase|movement)\s+in\s+(price|volume)|query\s+from\s+the\s+exchange/i, 'Exchange clarification'],
  // zzz824: a rating letter is its own event — never Results (a rationale quotes annual figures) or an acquisition
  [/credit\s+rating|rating\s+(?:rationale|action|letter)|ratings?\s+(?:re-?)?affirm|\b(?:CRISIL|ICRA|CARE\s+Ratings|CARE\s+Edge|India\s+Ratings|Acuit[eé]|Brickwork|Infomerics)\b/i, 'Credit rating'],
  // zzz824: bonus / split — a corporate action with no cash raised; never a rights fund raise
  [/\bbonus\s+(?:issue|shares?|equity|allotment)|\ballotment\s+of\s+bonus|\bsub[-\s]?division|stock\s+split|split\s+of\s+(?:the\s+)?(?:equity\s+)?shares|consolidation\s+of\s+shares/i, 'Corporate action'],
  [/scheme\s+of\s+(arrangement|amalgamation)|demerg|amalgamat|\bmerger\b|composite\s+scheme|hive[-\s]off|resulting\s+company|transferor|transferee/i, 'Corporate restructuring'],
  // a regulator / court / tax authority acting — never an order win
  [/action\(?s?\)?\s+initiated|orders?\s+passed|penalt|show[-\s]cause|demand\s+(notice|order)|tax\s+demand|notice\s+(from|under|of|received)|litigation|\bdispute\b|court\b|tribunal|\bsearch\b|\bseizure|\bfine\b|levied|enforcement|warning\s+letter|import\s+alert|form\s+483|\b483\b|suspension|insolvency|\bCIRP\b|default/i, 'Regulatory / legal action'],
  [/inter[-\s]?se\s+transfer|regulation\s*10\s*\(\s*[56]\s*\)|reg\.?\s*10\s*\(\s*[56]\s*\)/i, 'Promoter holding change'],
  [/\bSAST\b|regulation\s*29\s*\(|reg\.?\s*29\s*\(|regulation\s*31\s*\(|takeover\s+regulations?|substantial\s+acquisition|\bpledge|encumbrance|regulation\s*7\s*\(\s*2\s*\)|insider\s+trading|\bPIT\b|form\s+(3|4|5)\b|schedule\s+13[dg]|\b13[dg]\b/i, 'Shareholding disclosure'],
  [/sale\s+or\s+disposal|disposal\s+of|divest|slump\s+sale|sale\s+of\s+(stake|business|undertaking|unit|division|subsidiary|shares?\s+(in|of)\s+(its\s+)?(subsidiary|associate|jv))|transfer\s+of\s+(business|undertaking)|item\s*2\.01.*dispos/i, 'Divestment'],
  [/acqui(re|red|res|ring|sition)|takeover\s+(bid|offer)|stake\s+(purchase|acquisition)|open\s+offer|definitive\s+agreement\s+to\s+(acquire|purchase)|item\s*2\.01/i, 'Acquisition'],
  [/\bQIP\b|qualified\s+institutions?\s+placement|preferential\s+(issue|allotment)|rights\s+issue|fund[\s-]*rais|private\s+placement|\bwarrants?\b|allotment\s+of\s+(equity|shares|securities)|issue\s+of\s+(equity|securities)|\ballot(?:ment|ted)\b|public\s+offering|registered\s+direct|\bATM\s+(program|offering)|convertible\s+notes?|item\s*3\.02/i, 'Fund raise'],
  [/appoint(ment|ed)?|resign(ation|ed|s)?|cessation|re-?designat|change\s+in\s+(directors?|management|key\s+managerial|kmp|senior\s+management|auditor|ceo|cfo)|item\s*5\.02/i, 'Management change'],
  [/bagging|receiving\s+of\s+(orders?|contracts?)|receipt\s+of\s+(an?\s+)?(new\s+)?(purchase\s+|work\s+|export\s+)?(order|contract|loa)|orders?\s+(received|win|won|bagged|worth|valued|from|for)|contract\s+(award|win|worth|valued|from|for|signed)|letter\s+of\s+(award|intent)|\bLOA\b|\bLOI\b|work\s+order|purchase\s+order|\bL-?1\b|awarded|secur(es|ed)\s+(an?\s+)?(new\s+)?(order|contract)|order\s+book/i, 'Order win'],
  [/transcript|con[\s.-]*call|conference\s+call|earnings\s+call|investor\s+(presentation|update|day)|analyst\s+(presentation|day)|business\s+update|earnings\s+(presentation|deck)|regulation\s+fd|item\s*7\.01/i, 'Concall / business update'],
  [/financial\s+results|quarterly\s+results|results?\s+for\s+the\s+(quarter|period|year|half)|earnings\s+release|item\s*2\.02|form\s+10-?q|form\s+10-?k|form\s+20-?f|form\s+40-?f|form\s+6-?k|\bunaudited\b|\baudited\b/i, 'Results'],
  [/\bcapex\b|capital\s+expenditure|capacity|commission(ed|ing)?|commercial\s+(production|operation)|expansion|new\s+(plant|facility|unit|line)|greenfield|brownfield|de-?bottleneck/i, 'Capex / capacity'],
  [/approv(al|ed)\s+(from|by|of\s+(the\s+)?(usfda|fda|cdsco|dcgi|ministry|government|regulator))|\bUSFDA\b|\bFDA\b|\bEIR\b|\bANDA\b|\bCDSCO\b|\bDCGI\b|licen[cs]e|permit|clearance|certification|accredit|patent\s+(grant|granted)|regulatory\s+approval|\bNOC\b|\bCE\s+mark/i, 'Regulatory approval'],
  [/guidance|outlook/i, 'Guidance'],
];

/** Subjects that name no event: the document decides what happened. */
export const GENERIC_SUBJECT = /press\s+release|media\s+release|general\s+updates?|^\s*updates?\s*$|^\s*others?\s*$|regulation\s*30|reg\.?\s*30\b|\blodr\b|material\s+issue|reg(ulation)?\.?\s*23\s*\(\s*5\s*\)|disclosure\s+of\s+(event|information)|intimation\s+pursuant|outcome\s+of\s+(the\s+)?board\s+meeting|item\s*8\.01|item\s*1\.01|material\s+(definitive\s+)?agreement|other\s+events|^\s*announcement\s*$|^\s*disclosure\s*$/i;

/** Pure: what a filing's subject says it is. */
export function subjectClass(title: string | null | undefined): SubjectClass {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  const senior = SENIOR.test(t);
  for (const [re, why] of ROUTINE) if (re.test(t)) return { type: 'Other filing', routine: why, generic: false, senior };
  // NSE's own category "Analysts/Institutional Investor Meet/Con. Call Updates" is a schedule notice —
  // unless it carries the transcript or deck.
  if (/(analyst|investor)s?[\w\s/.&-]{0,40}\b(meet|con\.?\s*call)\b/i.test(t) && !/transcript|presentation/i.test(t)) {
    return { type: 'Other filing', routine: 'analyst / investor meet intimation', generic: false, senior };
  }
  // A subject that names an event is typed by it ("Outcome of Board Meeting - Financial Results" is
  // results); a bare wrapper ("Press Release", "Outcome of Board Meeting", "General Updates") and any
  // subject no rule knows are GENERIC — the document decides.
  for (const [re, ty] of RULES) {
    if (re.test(t)) return { type: ty, routine: null, generic: false, senior };
  }
  return { type: 'Other filing', routine: null, generic: true, senior };
}

// ── zzz825: SEC event typing (8-K items, offerings) ──────────────────────
//
// The SEC's own item numbers say what KIND of event an 8-K is. Used for the US
// tab only (buildRecentCatalysts with market 'US'); India subjects never carry
// "8-K". A subject that names no event (1.01, 7.01, 8.01) stays GENERIC so the
// read document can decide.

const US_OFFERING_FORM = /^(?:Form\s+)?(424B\d|S-1|S-3|F-1|F-3|FWP)(?:\/A|ASR|MEF)?\b/i;
const US_ROUTINE_ITEMS = new Set(['5.03', '5.05', '5.07', '5.08', '9.01', '3.03', '2.03', '1.02']);

/** Pure: 8-K item numbers in a subject ("8-K: … [Item 1.01, Item 9.01]", "8-K Item 1.01 / 7.01 (…)"). */
export function usItemsIn(title: string | null | undefined): string[] {
  const t = String(title || '');
  if (!/\b8-?K\b/i.test(t)) return [];
  return Array.from(new Set(Array.from(t.matchAll(/(?<![\d.])(\d\.\d\d)(?![\d])/g)).map((m) => m[1])));
}

/** Pure: what an SEC filing's form / 8-K items say it is — null when the subject is not an SEC form this
 *  rule knows (a 10-Q, a press report), so the shared classifier decides. */
export function usSubjectClass(title: string | null | undefined): SubjectClass | null {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (US_OFFERING_FORM.test(t)) return { type: 'Fund raise', routine: null, generic: false, senior: false };
  const it = usItemsIn(t);
  if (!it.length) return null;
  const has = (x: string) => it.includes(x);
  if (has('2.02')) return { type: 'Results', routine: null, generic: false, senior: false };
  if (has('2.01')) return { type: /dispos|\bsale of\b|divest/i.test(t.replace(/acquisition or disposition(?: of assets)?/gi, '')) ? 'Divestment' : 'Acquisition', routine: null, generic: false, senior: false };
  if (has('1.01') && /business combination|merger (?:agreement|communication)/i.test(t)) return { type: 'Acquisition', routine: null, generic: false, senior: false };
  if (has('3.02')) return { type: 'Fund raise', routine: null, generic: false, senior: false };
  if (has('1.01')) return { type: 'Order win', routine: null, generic: true, senior: false };
  if (has('5.02')) return { type: 'Management change', routine: null, generic: false, senior: true };
  if (has('7.01') || has('8.01')) return { type: 'Other filing', routine: null, generic: true, senior: false };
  if (it.every((x) => US_ROUTINE_ITEMS.has(x))) return { type: 'Other filing', routine: `8-K Item ${it.join(', ')} — governance / administrative`, generic: false, senior: false };
  return null;
}

/** The subject class for a merged filing in a market (US: the SEC item rule first). */
function subjectIn(f: FilingItem, market: 'IN' | 'US'): SubjectClass {
  if (market !== 'US') return f.subject;
  if (!f.origins.some((o) => o !== 'ledger-event' && o !== 'persistent')) return f.subject;
  return usSubjectClass(f.title) || f.subject;
}

/** v1 compatibility: the plain-words type from a title (and variable / kind when the title is silent). */
export function eventTypeOf(title: string | null | undefined, variable?: string | null, kind?: string | null): RecentEventType {
  const s = subjectClass(title);
  if (s.type !== 'Other filing' || s.routine) return s.type;
  if (variable && VAR_TYPE[variable]) return VAR_TYPE[variable];
  if (kind && KIND_TYPE[kind]) return KIND_TYPE[kind];
  return 'Other filing';
}

export function routineReason(title: string | null | undefined): string | null { return subjectClass(title).routine; }
export function isRoutine(title: string | null | undefined): boolean { return routineReason(title) !== null; }

export const VAR_TYPE: Record<string, RecentEventType> = {
  order_intake: 'Order win', order_book: 'Order win', book_to_bill: 'Order win', revenue_visibility: 'Order win',
  capacity: 'Capex / capacity', capacity_addition: 'Capex / capacity', utilisation: 'Capex / capacity', new_plant: 'Capex / capacity',
  commissioning: 'Capex / capacity', capacity_bottleneck: 'Capex / capacity', capex: 'Capex / capacity', capex_status: 'Capex / capacity',
  capex_earning: 'Capex / capacity', maintenance_vs_growth: 'Capex / capacity',
  guidance: 'Guidance', management_target: 'Guidance', promise_vs_actual: 'Guidance',
  revenue_growth: 'Results', earnings_growth: 'Results', operating_leverage: 'Results', margin: 'Results', margin_driver: 'Results',
  approval: 'Regulatory approval', qualification: 'Regulatory approval',
  new_customer: 'Concall / business update', customer_loss: 'Concall / business update', new_product: 'Concall / business update',
  volume: 'Concall / business update', price: 'Concall / business update', mix: 'Concall / business update', exports: 'Concall / business update',
  // Daily Gainers categories carried by persistent-catalyst items.
  order_win: 'Order win', backlog_increase: 'Order win',
  capacity_expansion: 'Capex / capacity', production_ramp: 'Capex / capacity', utilization_increase: 'Capex / capacity',
  customer_ramp: 'Concall / business update', new_geography: 'Concall / business update',
  product_qualification: 'Regulatory approval', regulatory_approval: 'Regulatory approval', export_approval: 'Regulatory approval',
};
const KIND_TYPE: Record<string, RecentEventType> = {
  results: 'Results', transcript: 'Concall / business update', investor_presentation: 'Concall / business update',
};

// ── source badge ───────────────────────────────────────────────────────────

const PRESS_SOURCE = /\bnews\b|press|media|moneycontrol|economic\s*times|\bET\b|business\s*standard|livemint|\bmint\b|reuters|bloomberg|cnbc|times\s+of|hindu|financial\s+express|yahoo|google|seeking\s+alpha|benzinga|marketwatch|globe\s*newswire|pr\s*newswire|business\s*wire|accesswire/i;
const FILED_SOURCE = /edgar|\bsec\b|\bbse\b|\bnse\b|exchange|filing|screener\.in|company|annual\s+report|investor\s+relations/i;
export function badgeOf(source: string | null | undefined, url?: string | null): SourceBadge {
  const s = String(source || '');
  if (FILED_SOURCE.test(s)) return 'filed';
  if (/sec\.gov|bseindia\.com|nseindia\.com|nsearchives/i.test(String(url || ''))) return 'filed';
  if (PRESS_SOURCE.test(s)) return 'press';
  return s || url ? 'press' : 'filed';
}

// ── thesis mapping ─────────────────────────────────────────────────────────

const varLabel = (v: string | null | undefined): string => (v && (VAR_LABEL as Record<string, string>)[v]) || String(v || '').replace(/_/g, ' ');

/** Variables a thesis type rests on (from the assessment when present, else THESES). */
function thesisVars(ctx: ThesisCtx): Set<string> {
  const fromA = ctx.assessment?.thesis?.variables;
  const list: any[] = Array.isArray(fromA) && fromA.length ? fromA : ((THESES as any)[String(ctx.pattern || '').toUpperCase()]?.variables || []);
  return new Set(list.map((v: any) => String(v?.key || v)));
}

/** v1 compatibility: read — never judge — what the assessment says about a variable. */
export function thesisTouchFor(assessment: any | null | undefined, variable: string | null | undefined): ThesisTouch {
  if (!assessment || !variable) return 'not assessed';
  if (assessment.status === 'THESIS_NOT_SET') return 'not assessed';
  const c = Array.isArray(assessment.checked) ? assessment.checked.find((x: any) => x?.key === variable) : null;
  if (!c) return 'not assessed';
  if (c.verdict === 'improving') return 'supports';
  if (c.verdict === 'deteriorating' && !c.watch && !c.historical?.active) return 'against';
  if (c.verdict === 'unknown') return 'not assessed';
  return 'neutral';
}

/**
 * Pure: what this event does to the name's thesis. Deterministic: the event's
 * variables (from the document read or the ledger's extracted events) against
 * the variables the thesis type rests on. Up → supports, down → against, a
 * level only → neutral. For results figures the card's own direction for that
 * variable is named alongside, so a disagreement is visible.
 */
export function thesisFor(touches: Touch[], ctx: ThesisCtx | null | undefined, read: ReadState): { touch: ThesisTouch; why: string } {
  if (!ctx || !ctx.pattern) {
    return { touch: 'not assessed', why: 'thesis type not set — pick A / B / F / G on the card' };
  }
  const p = String(ctx.pattern).toUpperCase();
  const name = String((THESES as any)[p]?.name || '').toLowerCase();
  const art = /^[AEFHILMNORSX]/.test(p) ? 'an' : 'a';
  const your = `your ${p}${name ? ` (${name})` : ''} thesis`;
  const prov = ctx.fit === 'provisional' ? ' (type is provisional)' : '';
  if (!touches.length) {
    return read === 'pending' ? { touch: 'not assessed', why: 'document still being read' }
      : read === 'failed' ? { touch: 'not assessed', why: 'document could not be opened' }
      : { touch: 'neutral', why: `No effect on ${your}${prov}` };
  }
  const vars = thesisVars(ctx);
  const hit = touches.filter((t) => vars.has(t.key));
  if (!hit.length) {
    return { touch: 'neutral', why: `No effect on ${your}${prov}` };
  }
  const up = hit.filter((t) => t.dir === 'up'), down = hit.filter((t) => t.dir === 'down');
  const card = (k: string) => {
    const c = Array.isArray(ctx.assessment?.checked) ? ctx.assessment.checked.find((x: any) => x?.key === k) : null;
    return c?.verdict === 'improving' ? 'card: improving' : c?.verdict === 'deteriorating' ? 'card: getting worse' : null;
  };
  const say = (list: Touch[], w: string) => {
    const k = list[0].key;
    const cw = card(k);
    return `${varLabel(k).toLowerCase()} ${w}${cw ? ` (${cw})` : ''}`;
  };
  const tv = `${art} ${p}-type thesis variable`;
  if (up.length && !down.length) return { touch: 'supports', why: `${say(up, 'up')} — ${tv}${prov}` };
  if (down.length && !up.length) return { touch: 'against', why: `${say(down, 'down')} — ${tv}${prov}` };
  if (up.length && down.length) return { touch: 'neutral', why: `Mixed: ${say(up, 'up')}, ${say(down, 'down')}${prov}` };
  return { touch: 'neutral', why: `States ${varLabel(hit[0].key).toLowerCase()} (a level, no change)${prov}` };
}

const DIR: Record<string, Touch['dir']> = { up: 'up', UP: 'up', down: 'down', DOWN: 'down' };

// ── importance ─────────────────────────────────────────────────────────────

const TYPE_RANK: Record<RecentEventType, number> = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, i])) as any;
const IMP_RANK: Record<Importance, number> = { Material: 0, Notable: 1, Minor: 2 };

/** Pure: Material / Notable / Minor, in words. Material needs a stated figure or a clearly big event
 *  with its terms (results with numbers, an order with a value, capacity with numbers, an acquisition
 *  with consideration or a stated stake, a scheme with its swap ratio). (zzz815) */
export function importanceOf(e: { type: RecentEventType; figure: string | null; line: string | null; senior?: boolean; read: ReadState; noImpact?: boolean }): Importance {
  const fig = !!e.figure;
  const line = e.line || '';
  switch (e.type) {
    case 'Results': return fig ? 'Material' : 'Notable';
    case 'Order win': return fig ? 'Material' : 'Notable';
    case 'Capex / capacity': return fig ? 'Material' : 'Notable';
    case 'Corporate restructuring': return fig || /share swap|for every \d+|consideration/i.test(line) ? 'Material' : 'Notable';
    case 'Acquisition': case 'Divestment': return fig ? 'Material' : 'Notable';
    case 'Regulatory approval': return fig ? 'Material' : line && !/see filing/.test(line) ? 'Notable' : e.read === 'pending' ? 'Notable' : 'Minor';
    case 'Fund raise': return fig ? 'Material' : 'Notable';
    case 'Guidance': return fig ? 'Material' : 'Notable';
    case 'Management change': return e.senior ? 'Notable' : 'Minor';
    case 'Concall / business update': return fig ? 'Notable' : e.read === 'read' || e.line ? 'Notable' : 'Minor';
    case 'Regulatory / legal action': return e.noImpact ? 'Minor' : 'Notable';
    case 'Credit rating': return /upgrad|downgrad|outlook\s+(?:revised|changed)|placed\s+on\s+(?:rating\s+)?watch/i.test(line) ? 'Notable' : 'Minor';
    case 'Corporate action': return /bonus|split|sub-?division/i.test(line) ? 'Notable' : 'Minor';
    default: return 'Minor';
  }
}

// ── adapters (pure) ────────────────────────────────────────────────────────

const clean = (s: string | null | undefined): string => String(s || '')
  .replace(/,?\s*filed\s+\d{4}-\d{2}-\d{2}/i, '')
  .replace(/\s+/g, ' ').trim();

function figureOf(e: { before?: string | null; after?: string | null; unit?: string | null }): string | null {
  const after = String(e.after || '').trim();
  if (!after || !/\d/.test(after)) return null;
  const unit = String(e.unit || '').trim();
  const withUnit = (v: string) => (unit && !v.toLowerCase().includes(unit.toLowerCase()) && unit.length <= 12 ? `${v} ${unit}` : v);
  const before = String(e.before || '').trim();
  return before && /\d/.test(before) ? `${withUnit(before)} → ${withUnit(after)}` : withUnit(after);
}

/** Every dated document and extracted event in an evidence ledger. */
export function rawFromLedger(ticker: string, company: string | null, ledger: any, assessment?: any, ctx?: ThesisCtx | null): RawEvent[] {
  const out: RawEvent[] = [];
  if (!ledger || typeof ledger !== 'object') return out;
  const c: ThesisCtx | null = ctx === undefined ? (assessment ? { pattern: assessment?.thesis?.pattern && assessment.thesis.pattern !== 'UNCLASSIFIED' ? assessment.thesis.pattern : null, assessment } : null) : ctx;
  const periods = ledger.periods && typeof ledger.periods === 'object' ? Object.values(ledger.periods) as any[] : [];
  for (const p of periods) {
    const docs: any[] = Array.isArray(p?.documents) ? p.documents : [];
    const byId = new Map<string, any>(docs.map((d) => [String(d?.id || ''), d]));
    for (const d of docs) {
      if (!d?.date_iso) continue;
      out.push({ ticker, company, date: d.date_iso, title: String(d.label || ''), kind: d.kind || null, url: d.url || null, source: d.source || null, origin: 'ledger-doc', ctx: c });
    }
    const events: any[] = Array.isArray(p?.events) ? p.events : [];
    for (const e of events) {
      if (e?.record_status === 'SUPERSEDED') continue;
      const d = byId.get(String(e?.source_document_id || ''));
      if (!d?.date_iso) continue;
      const fig = figureOf(e);
      const quote = String(e.evidence_text || '').replace(/\s+/g, ' ').trim();
      out.push({
        ticker, company, date: d.date_iso, title: String(d.label || ''), kind: d.kind || null, url: d.url || null, source: d.source || null,
        variable: e.variable || null, direction: e.direction || null, figure: fig,
        before: e.before != null ? String(e.before) : null, after: e.after != null ? String(e.after) : null, quote: quote || null,
        text: fig ? `${varLabel(e.variable)}: ${fig}` : (quote ? `${varLabel(e.variable)} — “${quote.slice(0, 110)}${quote.length > 110 ? '…' : ''}”` : varLabel(e.variable)),
        origin: 'ledger-event', ctx: c,
      });
    }
  }
  const pend: any[] = Array.isArray(ledger.pending_documents) ? ledger.pending_documents : [];
  for (const d of pend) {
    if (!d?.date_iso) continue;
    out.push({ ticker, company, date: d.date_iso, title: String(d.label || ''), kind: d.kind || null, url: d.url || null, source: d.source || null, origin: 'pending-doc', ctx: c });
  }
  return out;
}

/** The items behind persistent catalysts (lib/catalyst/persistence). */
export function rawFromPersistent(ticker: string, company: string | null, pcs: any[] | null | undefined, assessment?: any, ctx?: ThesisCtx | null): RawEvent[] {
  const out: RawEvent[] = [];
  const c: ThesisCtx | null = ctx === undefined ? (assessment ? { pattern: assessment?.thesis?.pattern && assessment.thesis.pattern !== 'UNCLASSIFIED' ? assessment.thesis.pattern : null, assessment } : null) : ctx;
  for (const pc of pcs || []) {
    if (pc?.ticker && String(pc.ticker).toUpperCase() !== ticker.toUpperCase()) continue;
    for (const it of [...(pc?.evidence || []), ...(pc?.forward || [])]) {
      const src = (it?.sources || [])[0] || null;
      const date = it?.date || src?.date || null;
      if (!date) continue;
      const fig = figureOf({ before: it.before, after: it.after });
      const n = Number(it.numeric), nb = Number(it.numericBefore);
      const dir = Number.isFinite(n) && Number.isFinite(nb) && it.numericBefore != null ? (n > nb ? 'up' : n < nb ? 'down' : null) : null;
      out.push({
        ticker, company, date, title: String(it.text || ''), variable: it.metric || null, direction: dir,
        text: String(it.text || ''), figure: fig, url: src?.url || null, source: src?.name || null,
        before: it.before != null ? String(it.before) : null, after: it.after != null ? String(it.after) : null, quote: String(it.quote || it.text || '') || null,
        badge: it.origin === 'gainer' ? badgeOf(src?.name, src?.url) : 'filed',
        origin: 'persistent', ctx: c,
      });
    }
  }
  return out;
}

/** India exchange results feed (the "Update recent reporters" pass). */
export function rawFromFeed(items: Array<{ ticker: string; reported_at: string; subject: string }> | null | undefined, companyOf?: (t: string) => string | null, ctxOf?: (t: string) => ThesisCtx | null): RawEvent[] {
  return (items || []).filter((x) => x && x.ticker && x.reported_at).map((x) => ({
    ticker: x.ticker, company: companyOf ? companyOf(x.ticker) : null, date: x.reported_at, title: String(x.subject || 'Financial results'),
    kind: 'results', url: null, source: 'NSE exchange filing feed', origin: 'feed' as const, ctx: ctxOf ? ctxOf(x.ticker) : null,
  }));
}

// ── merge per filing ───────────────────────────────────────────────────────

export const normUrl = (u: string | null | undefined): string => String(u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const normTitle = (t: string): string => clean(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

/** One filing (or one URL-less observation) after merging its sources. */
export interface FilingItem {
  key: string;
  ticker: string;
  company: string | null;
  date: string;
  url: string | null;
  title: string;
  source: string | null;
  badge: SourceBadge;
  subject: SubjectClass;
  events: RawEvent[];
  origins: RawOrigin[];
  ctx: ThesisCtx | null;
  kind: string | null;
}

/** Pure: every observation → one item per filing (same URL = same filing). */
export function mergeFilings(raws: RawEvent[]): FilingItem[] {
  const groups = new Map<string, RawEvent[]>();
  const noUrl: RawEvent[] = [];
  for (const r of raws) {
    const date = isoDay(r.date);
    if (!date || !r.ticker) continue;
    const x = { ...r, ticker: r.ticker.toUpperCase(), date };
    const u = normUrl(r.url);
    if (!u) { noUrl.push(x); continue; }
    const k = `${x.ticker}|${date}|${u}`;
    groups.set(k, [...(groups.get(k) || []), x]);
  }
  for (const r of noUrl) {
    const ty = eventTypeOf(r.title, r.variable, r.kind);
    // the exchange feed's "Financial Results" and the ledger's results PDF are one filing
    const hit = Array.from(groups.entries()).find(([, g]) => g[0].ticker === r.ticker && g[0].date === r.date
      && eventTypeOf(g[0].title, g[0].variable, g[0].kind) === ty);
    if (hit) { hit[1].push(r); continue; }
    const k = `${r.ticker}|${r.date}|~${normTitle(r.title)}|${ty}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return Array.from(groups.entries()).map(([key, g]) => {
    const docs = g.filter((r) => r.origin !== 'ledger-event' && r.origin !== 'persistent');
    const lead = docs[0] || g[0];
    const title = clean(lead.title);
    return {
      key, ticker: g[0].ticker, company: g.find((r) => r.company)?.company || null, date: g[0].date as string,
      url: g.find((r) => r.url)?.url || null, title, source: lead.source || g.find((r) => r.source)?.source || null,
      badge: g.map((r) => r.badge || badgeOf(r.source, r.url)).includes('filed') ? 'filed' : 'press',
      subject: docs.length ? subjectClass(title) : { ...subjectClass(title), generic: false },
      events: g.filter((r) => r.origin === 'ledger-event' || r.origin === 'persistent'),
      origins: Array.from(new Set(g.map((r) => r.origin))),
      ctx: g.find((r) => r.ctx)?.ctx || null,
      kind: lead.kind || null,
    };
  });
}

/** Pure: whether a filing's document should be opened (URL, not routine by subject). */
export function needsRead(f: FilingItem, market: 'IN' | 'US' = 'IN'): boolean {
  if (!f.url) return false;
  if (subjectIn(f, market).routine) return false;
  // a periodic report (10-Q / 10-K) is long and its figures are on the card already
  if (market === 'US' && /form\s+(10-?q|10-?k|20-?f|40-?f)/i.test(f.title)) return false;
  // zzz825: a prospectus / shelf is hundreds of pages — the form says what it is (an offering)
  if (market === 'US' && US_OFFERING_FORM.test(f.title)) return false;
  if (!/^https:\/\//i.test(f.url)) return false;
  return true;
}

// ── build one filing's final shape ─────────────────────────────────────────

interface Resolved {
  f: FilingItem;
  type: RecentEventType;
  line: string | null;
  figure: string | null;
  routine: string | null;
  touches: Touch[];
  read: ReadState;
  readNote: string | null;
  senior: boolean;
  noImpact: boolean;
  /** Read, but no line passed the quality gate — show "<type> — see filing". */
  seeFiling?: boolean;
  /** zzz824: what the evidence says about thesis variables — verified only with a stated prior. */
  claims: Claim[];
  docType: string | null;
  lowConfidence: boolean;
  ratingAction: string | null;
  market: 'IN' | 'US';
  /** zzz829 (US): the SEC accession the document belongs to — one filing, one card. */
  acc: string | null;
  /** zzz829 (US): an SEC XBRL filed figure (the RPO reading), not a document. */
  xbrlFact: boolean;
}

function resolve(f: FilingItem, readMap: Map<string, FilingRead>, market: 'IN' | 'US'): Resolved {
  const r = f.url ? readMap.get(normUrl(f.url)) || null : null;
  const want = needsRead(f, market);
  const read: ReadState = r ? (r.status === 'read' ? 'read' : 'failed') : want ? 'pending' : 'not-needed';
  const subj = subjectIn(f, market);
  let type: RecentEventType = subj.type;
  let routine = subj.routine;
  // the document decides a generic subject ("Press Release", "General Updates", "material issue")
  if (r?.status === 'read' && (subj.generic || type === 'Other filing') && !routine) {
    if (r.routine) routine = r.routine;
    else if (r.kind && restructuringAllowed(r, subj)) type = r.kind as RecentEventType;
  }
  // a concall / presentation that states a hard fact is filed under that fact (capacity commissioned,
  // results figures, an order with value) — the deck is the wrapper, the fact is the event
  if (r?.status === 'read' && type === 'Concall / business update' && r.kind && (r.figures || []).length
    && ['Capex / capacity', 'Order win', 'Results', 'Regulatory approval', 'Guidance'].includes(r.kind)) type = r.kind as RecentEventType;
  if (!subj.routine && !r && f.events.length && type === 'Other filing') {
    const v = f.events.find((e) => e.variable && VAR_TYPE[e.variable]);
    if (v) type = VAR_TYPE[v.variable as string];
  }
  if (type === 'Other filing' && !r && f.kind && KIND_TYPE[f.kind]) type = KIND_TYPE[f.kind];
  // zzz829 (US): the document typed the event beyond doubt (an Item 2.01 / "acquires" headline, a notes offering) —
  // a subject that only says "business update" / "Regulation FD" does not decide it
  if (market === 'US' && r?.status === 'read' && r.strongKind && r.kind && !routine
    && (subj.generic || /^(?:Concall \/ business update|Other filing|Order win)$/.test(type))) type = r.kind as RecentEventType;
  // the line that matters — only a clean one (quality gate); the ledger's extracted events next.
  // zzz829 (US): a hypothetical / risk-factor / business-description sentence is mentioned, not evidence
  const evs = f.events.filter((e) => (!e.text || lineQuality(e.text).ok)
    && !(market === 'US' && usBoilerplateEvidence(e.variable, e.quote || e.text)))
    .map((e) => (market === 'US' ? usCashAmount(e) : e));
  const withFig = evs.filter((e) => e.figure);
  const best = withFig.find((e) => e.variable && VAR_TYPE[e.variable] === type) || withFig[0] || evs[0] || null;
  let line: string | null = null;
  let figure: string | null = null;
  const readLine = r?.status === 'read' && r.line && lineQuality(r.line).ok ? r.line : null;
  if (readLine) { line = readLine; figure = r!.figures && r!.figures.length ? r!.figures[0] : null; }
  if (!line && best?.text) {
    line = String(best.text); figure = best.figure || null;
    // a results filing whose only extracted point is a qualification / capacity is not "Results"
    const bt = best.variable ? VAR_TYPE[best.variable] : null;
    if (type === 'Results' && bt && bt !== 'Results') type = bt;
  }
  if (line && evs.length > 1 && !readLine) {
    const more = evs.length - 1;
    line += ` (+${more} more point${more === 1 ? '' : 's'} on the card)`;
  }
  // thesis variables only from what this event states (a scheme does not state capacity)
  const touches: Touch[] = [];
  for (const t of r?.status === 'read' ? r.touches || [] : []) if (touchAllowed(type, t.key)) touches.push(t);
  for (const e of evs) if (e.variable && touchAllowed(type, e.variable)) touches.push({ key: e.variable, dir: DIR[String(e.direction || '')] || 'stated' });
  const readNote = r && r.status !== 'read' ? `couldn't open the document (${r.reason || 'no reason given'})` : null;
  // zzz824: claims — a change the filing states with its prior is verified; a direction with no prior is not
  const claims: Claim[] = [];
  if (r?.status === 'read') {
    for (const c of r.changes || []) if (touchAllowed(type, c.key)) claims.push({ key: c.key, dir: c.dir, verified: true, text: tidyFigure(c.text, market), source: 'filing' });
    for (const t of r.touches || []) if (touchAllowed(type, t.key)) claims.push({ key: t.key, dir: t.dir, verified: false, source: 'filing' });
  }
  for (const e of evs) {
    if (!e.variable || !touchAllowed(type, e.variable)) continue;
    const dir = DIR[String(e.direction || '')] || 'stated';
    const ok = dir !== 'stated' && pairVerified(e.before, e.after, `${e.quote || ''} ${e.origin === 'persistent' ? e.text || '' : ''}`);
    const b = tidyFigure(e.before, market), a = tidyFigure(e.after, market);
    claims.push({ key: e.variable, dir, verified: ok, source: 'ledger', text: ok && b && a ? `${varLabel(e.variable)} ${b} → ${a}${pctOf(b, a)}` : null });
  }
  if (line) line = tidyFigure(line, market) || line;
  if (figure) figure = tidyFigure(figure, market);
  if (market === 'US') { line = usPeriodWords(line); figure = usPeriodWords(figure); }
  const kindDoc = r?.status === 'read' ? r.docType || null : null;
  return {
    f, type, line, figure, routine, touches, read, readNote,
    senior: !!(subj.senior || r?.senior), noImpact: !!r?.noImpact,
    seeFiling: r?.status === 'read' && !line,
    claims, docType: kindDoc, lowConfidence: !!(r?.status === 'read' && (r.lowConfidence || (!line && r.rejected))),
    ratingAction: r?.status === 'read' ? r.ratingAction || null : null, market,
    acc: market === 'US' && /sec\.gov\/Archives/i.test(String(f.url || '')) ? accessionOf(f.url) : null,
    xbrlFact: market === 'US' && (/SEC XBRL/i.test(String(f.source || '')) || /browse-edgar/i.test(String(f.url || ''))),
  };
}

/** zzz829: "(three months ended June 30, 2026)" → "(3 months)". */
function usPeriodWords(s: string | null): string | null {
  if (!s) return s;
  const n: Record<string, string> = { three: '3', six: '6', nine: '9', twelve: '12' };
  return s.replace(/\(\s*(three|six|nine|twelve)\s+months(?:\s+ended[^)]*)?\)/gi, (_m, w) => `(${n[w.toLowerCase()]} months)`);
}

const MONEYLIKE = /[$₹€£]\s?\d|\d\s?(?:mn|bn|million|billion|thousand|Cr)\b|\d\s?[MB]\b/i;
/** zzz829 (US): "Cash conversion $46.0M (three months ended …)" is an AMOUNT — operating cash flow — not a ratio of
 *  cash to profit. Shown as "Operating cash flow $46.0 mn (3 months)" and never read as cash conversion. */
function usCashAmount(e: RawEvent): RawEvent {
  if (e.variable !== 'cash_conversion') return e;
  const val = String(e.after || e.figure || e.text || '');
  if (!MONEYLIKE.test(val) || /[×x]\s*$|\d\s?[×x]\b|%/.test(String(e.after || e.figure || ''))) return e;
  const fig = tidyFigure(e.after || e.figure, 'US') || (e.figure || '');
  const months = /\b(three|six|nine|twelve)\s+months\b/i.exec(`${e.after || ''} ${e.text || ''} ${e.quote || ''}`)?.[1] || null;
  const mw: Record<string, string> = { three: '3', six: '6', nine: '9', twelve: '12' };
  const text = `Operating cash flow ${String(fig).replace(/\s*\((?:three|six|nine|twelve) months[^)]*\)/i, '')}${months ? ` (${mw[months.toLowerCase()]} months)` : ''}`;
  return { ...e, variable: null, direction: null, before: null, text, figure: fig || null };
}

/** zzz825: a read may call a filing a restructuring only when the SUBJECT says so, or the reader found an
 *  explicit board-approval / sanction sentence (restructuringStated). A read cached before that flag existed
 *  is trusted only when it was not an investor deck or transcript — "Demerger" on a slide is marketing text. */
export function restructuringAllowed(r: Pick<FilingRead, 'kind' | 'docType' | 'restructuringStated'>, subj: Pick<SubjectClass, 'type'>): boolean {
  if (r.kind !== 'Corporate restructuring') return true;
  if (subj.type === 'Corporate restructuring') return true;
  if (r.restructuringStated === true) return true;
  if (r.restructuringStated === false) return false;
  return !/presentation|transcript|deck/i.test(String(r.docType || ''));
}

/** " (+22.7%)" from two figures in the same unit, else "". */
function pctOf(b: string, a: string): string {
  const u = (s: string) => (/\bbn\b/.test(s) ? 'bn' : /\bCr\b/.test(s) ? 'Cr' : /\bmn\b/.test(s) ? 'mn' : /%/.test(s) ? '%' : /[A-Za-z]/.test(s.replace(/^[₹$]/, '')) ? s.replace(/[\d,.\s₹$+~]/g, '') : '');
  if (u(b) !== u(a) || u(a) === '%') return '';
  const x = parseFloat(b.replace(/[^\d.]/g, '')), y = parseFloat(a.replace(/[^\d.]/g, ''));
  if (!(x > 0) || !Number.isFinite(y)) return '';
  const p = Math.round(((y - x) / x) * 1000) / 10;
  return Math.abs(p) < 1000 ? ` (${p >= 0 ? '+' : ''}${p}%)` : '';
}

/** zzz824: NSE / BSE / SEC from the document address or the source name. */
export function exchangeOf(url: string | null | undefined, source?: string | null): string | null {
  const u = String(url || '');
  if (/bseindia\.com/i.test(u)) return 'BSE';
  if (/nseindia\.com|nsearchives/i.test(u)) return 'NSE';
  if (/sec\.gov/i.test(u)) return 'SEC';
  const s = String(source || '');
  if (/\bNSE\b/i.test(s)) return 'NSE';
  if (/\bBSE\b/i.test(s)) return 'BSE';
  if (/edgar|\bSEC\b/i.test(s)) return 'SEC';
  return null;
}

/** zzz824: the document kind in words, from the read or the subject. */
function sourceDocOf(x: Resolved): string {
  if (x.docType) return x.docType;
  const t = x.f.title;
  if (/credit rating|rating rationale/i.test(t)) return 'Credit rating letter';
  if (/transcript/i.test(t) || x.f.kind === 'transcript') return 'Concall transcript';
  if (/presentation/i.test(t) || x.f.kind === 'investor_presentation') return 'Investor presentation';
  if (/financial results|quarterly results/i.test(t) || x.f.kind === 'results') return 'Results filing';
  if (/allot/i.test(t)) return 'Allotment intimation';
  if (/press release/i.test(t)) return 'Press release';
  if (/form\s+8-?k|8-K/i.test(t)) return 'Form 8-K';
  if (x.f.badge === 'press') return 'Press report';
  return x.market === 'US' ? 'SEC filing' : 'Exchange filing';
}

const TOUCH_BY_TYPE: Partial<Record<RecentEventType, RegExp>> = {
  'Results': /^(?:revenue_growth|earnings_growth|margin|operating_leverage|margin_driver|guidance)$/,
  'Capex / capacity': /^(?:capacity|capacity_addition|utilisation|new_plant|commissioning|capacity_bottleneck|capex|capex_status|capex_earning|maintenance_vs_growth)$/,
  'Order win': /^(?:order_intake|order_book|book_to_bill|revenue_visibility)$/,
  'Regulatory approval': /^(?:approval|qualification)$/,
  'Guidance': /^(?:guidance|management_target|promise_vs_actual)$/,
  'Concall / business update': /./,
};
/** Pure: may an event of this type move this thesis variable? Only what the event can state. */
export function touchAllowed(type: RecentEventType, key: string): boolean {
  const re = TOUCH_BY_TYPE[type];
  return !!re && re.test(key);
}

// ── grouping and ranking ───────────────────────────────────────────────────

/** zzz829 (US): the SEC XBRL grader row the card carries — the year-ago comparison for a results event and the
 *  company's size for materiality. Only filed figures; no price. */
export interface UsCardFacts {
  period?: string | null;
  fiscal_label?: string | null;
  q_end?: string | null;
  revenue_curr_musd?: number | null; revenue_prev_musd?: number | null;
  net_income_curr_musd?: number | null; net_income_prev_musd?: number | null;
  opm_pct?: number | null; opm_prev_pct?: number | null;
  sales_yoy_pct?: number | null; net_profit_yoy_pct?: number | null;
}

interface BuildCtx { market: 'IN' | 'US'; facts: Map<string, UsCardFacts> }

/** Which event of one filing is the headline (lower first). */
const HEAD_RANK: Partial<Record<RecentEventType, number>> = {
  'Results': 0, 'Acquisition': 1, 'Divestment': 2, 'Corporate restructuring': 3, 'Fund raise': 4, 'Order win': 5,
  'Regulatory approval': 6, 'Capex / capacity': 7, 'Guidance': 8, 'Regulatory / legal action': 9, 'Management change': 10,
  'Credit rating': 11, 'Corporate action': 12, 'Concall / business update': 20, 'Exchange clarification': 25, 'Other filing': 30,
};
const headRank = (t: RecentEventType) => HEAD_RANK[t] ?? 15;

const pctTxt = (a: number, b: number) => { const p = Math.round(((a - b) / Math.abs(b)) * 1000) / 10; return `${p >= 0 ? '+' : ''}${p}%`; };

/** Pure (zzz829): a US results event's year-ago comparison from the card's SEC XBRL figures — the SAME fiscal
 *  quarter a year earlier — when the XBRL quarter is the one the filing reports (filed within ~110 days of the
 *  quarter end, and the revenue the filing states agrees). Otherwise no claim, and a note saying why. */
export function xbrlResultsClaims(fx: UsCardFacts | null | undefined, filed: string, line: string | null): { claims: Claim[]; note: string | null } {
  if (!fx) return { claims: [], note: null };
  const qEnd = isoDay(fx.q_end);
  const label = String(fx.fiscal_label || fx.period || (qEnd ? `quarter ended ${qEnd}` : '') || 'an earlier quarter').replace(/\s*\(quarter ended[^)]*\)/, '');
  if (!qEnd) return { claims: [], note: null };
  const lag = daysAgo(qEnd, filed);
  if (lag < -5) return { claims: [], note: `the SEC XBRL figures on the card are for a later quarter (${label}) — no year-ago comparison drawn for this filing` };
  if (lag > 110) return { claims: [], note: `the SEC XBRL figures for this quarter are not in yet (the card still has ${label}) — no year-ago comparison drawn` };
  const rev = fx.revenue_curr_musd, revP = fx.revenue_prev_musd;
  const stated = /\bRevenue\s+(\$[\d,.]+\s?(?:mn|bn|million|billion)?)/i.exec(String(line || ''))?.[1] || null;
  const sv = stated ? usdAmountIn(stated) : null;
  if (sv != null && typeof rev === 'number' && rev > 0 && Math.abs(sv / 1e6 - rev) / rev > 0.03) {
    return { claims: [], note: `the revenue this filing states (${stated}) is not the SEC XBRL quarter's (${usdShort(rev * 1e6)}) — no year-ago comparison drawn` };
  }
  const out: Claim[] = [];
  const src = `same quarter a year earlier, SEC XBRL (${label})`;
  if (typeof rev === 'number' && typeof revP === 'number' && revP > 0 && rev !== revP) {
    out.push({ key: 'revenue_growth', dir: rev > revP ? 'up' : 'down', verified: true, source: 'xbrl', text: `Revenue ${usdShort(revP * 1e6)} → ${usdShort(rev * 1e6)} (${pctTxt(rev, revP)}) · ${src}` });
  }
  const ni = fx.net_income_curr_musd, niP = fx.net_income_prev_musd;
  if (typeof ni === 'number' && typeof niP === 'number' && ni !== niP) {
    const tail = niP > 0 && ni > 0 ? ` (${pctTxt(ni, niP)})` : niP <= 0 && ni > 0 ? ' (loss → profit)' : niP > 0 && ni <= 0 ? ' (profit → loss)' : '';
    out.push({ key: 'earnings_growth', dir: ni > niP ? 'up' : 'down', verified: true, source: 'xbrl', text: `Net income ${usdShort(niP * 1e6)} → ${usdShort(ni * 1e6)}${tail} · ${src}` });
  }
  const m = fx.opm_pct, mP = fx.opm_prev_pct;
  if (typeof m === 'number' && typeof mP === 'number' && Math.abs(m - mP) >= 0.5) {
    out.push({ key: 'margin', dir: m > mP ? 'up' : 'down', verified: true, source: 'xbrl', text: `Operating margin ${mP}% → ${m}% · ${src}` });
  }
  return { claims: out, note: out.length ? null : `the SEC XBRL figures carry no year-ago comparison for ${label}` };
}

/** Pure (zzz829): US materiality scaled to the company — a $ amount against the card's annual revenue (latest
 *  quarter × 4): ≥ 5% Material, ≥ 1% Notable, else Minor; under $1 mn Minor. Guidance without a metric and a
 *  direction is Minor (a fragment, level only). Results keep their own rule. */
export function usMateriality(type: RecentEventType, base: Importance, text: string | null, fx: UsCardFacts | null | undefined): Importance {
  if (type === 'Results' || base === 'Minor') return base;
  const t = String(text || '');
  if (type === 'Guidance') {
    // the reader's label ("Outlook issued / reaffirmed:") is not the filing's words — only the sentence counts
    const t = String(text || '').replace(/^(?:[^:·]{0,40}·\s*)?(?:Outlook issued \/ reaffirmed|Guidance)\s*:\s*/i, '');
    const metric = /\b(?:revenue|sales|EPS|earnings|EBITDA|margin|net income|operating income|cash flow|bookings|backlog|free cash)\b/i.test(t);
    const dir = /\b(?:rais\w*|increas\w*|lower\w*|reduc\w*|cut|narrow\w*|reaffirm\w*|maintain\w*|above|below|withdr[ae]w\w*)\b|→|\bfrom\b[^.]{0,40}\bto\b/i.test(t);
    return metric && dir ? base : 'Minor';
  }
  if (!/^(?:Order win|Capex \/ capacity|Acquisition|Divestment|Fund raise|Concall \/ business update|Corporate restructuring|Regulatory \/ legal action)$/.test(type)) return base;
  const amt = usdAmountIn(t);
  if (amt == null || amt <= 0) return base;
  if (amt < 1e6) return 'Minor';
  const q = typeof fx?.revenue_curr_musd === 'number' && fx.revenue_curr_musd > 0 ? fx.revenue_curr_musd : null;
  if (q) { const r = amt / (q * 4 * 1e6); return r >= 0.05 ? 'Material' : r >= 0.01 ? 'Notable' : 'Minor'; }
  return amt >= 1e8 ? base : 'Notable';
}

/** zzz829 (US): the metrics a headline can carry a delta for — an award is order intake; only a backlog line
 *  carries an order-book change. Null = no restriction beyond the event type. */
function headKeysOf(type: RecentEventType, line: string | null): string[] | null {
  const l = String(line || '');
  if (type === 'Order win') return /backlog|order book|remaining performance|\bRPOs?\b|book[- ]to[- ]bill/i.test(l) ? ['order_book', 'book_to_bill', 'revenue_visibility'] : ['order_intake'];
  if (type === 'Results') return ['revenue_growth', 'earnings_growth', 'margin', 'operating_leverage', 'guidance'];
  if (type === 'Capex / capacity') return ['capacity', 'capacity_addition', 'utilisation', 'new_plant', 'commissioning', 'capex', 'capex_status', 'capex_earning'];
  if (type === 'Guidance') return ['guidance', 'management_target'];
  return null;
}

/** Pure: one event from its filings. `units` = one entry per filing (US: every document of one SEC accession). */
function toEvent(units: Resolved[][], bx: BuildCtx = { market: 'IN', facts: new Map() }): RecentEvent {
  // lead = the filing with the most substance (a read line with a figure, then any line, then newest)
  const score = (x: Resolved) => (x.figure ? 4 : 0) + (x.line ? 2 : 0) + (x.read === 'read' ? 1 : 0);
  // inside one filing the headline is the most important event type (results over an order over a business update)
  const unitLead = (u: Resolved[]) => [...u].sort((a, b) => headRank(a.type) - headRank(b.type) || score(b) - score(a) || b.f.date.localeCompare(a.f.date))[0];
  const leadUnit = [...units].sort((a, b) => score(unitLead(b)) - score(unitLead(a)) || unitLead(b).f.date.localeCompare(unitLead(a).f.date))[0];
  const lead = unitLead(leadUnit);
  const list = units.flat();
  const us = bx.market === 'US';
  const newest = list.reduce((m, x) => (x.f.date > m ? x.f.date : m), list[0].f.date);
  const touches = list.flatMap((x) => x.touches);
  const read: ReadState = list.some((x) => x.read === 'read') ? 'read' : list.some((x) => x.read === 'pending') ? 'pending' : list.some((x) => x.read === 'failed') ? 'failed' : 'not-needed';
  const th = thesisFor(dedupeTouches(touches), lead.f.ctx, read);
  const cleanTitle = stripLetterhead(lead.f.title) || lead.f.title;
  const what = lead.line || (lead.seeFiling ? `${lead.type} — see filing` : cleanTitle) || '(untitled filing)';
  const parts = us ? units.map(unitLead).filter((x) => x.type === lead.type) : list;
  let imp = parts.map((x) => importanceOf({ type: x.type, figure: x.figure, line: x.line, senior: x.senior, read: x.read, noImpact: x.noImpact }))
    .sort((a, b) => IMP_RANK[a] - IMP_RANK[b])[0];
  const fx = us ? bx.facts.get(bareTicker(lead.f.ticker)) || null : null;
  if (us) imp = usMateriality(lead.type, imp, [lead.figure, lead.line].filter(Boolean).join(' · ') || null, fx);
  // zzz829 (US): other events in the SAME filing — "also in this filing", never a card of their own
  const also: NonNullable<RecentEvent['also']> = [];
  if (us) {
    for (const u of units) for (const x of u) {
      if (x === lead || x.type === lead.type) continue;
      const l = x.line || stripLetterhead(x.f.title) || x.f.title;
      if (l && !also.some((a) => a.type === x.type && a.line === l)) also.push({ type: x.type, line: cleanClip(l, 160) });
    }
  }
  // zzz829 (US): claims only from the headline's own filing (never another document grouped beside it); a US
  // results event takes its year-ago comparison from the card's SEC XBRL quarter when that quarter is this one
  let claims = dedupeClaims((us ? leadUnit : list).flatMap((x) => x.claims));
  let xbrlNote: string | null = null;
  if (us && lead.type === 'Results') {
    const xr = xbrlResultsClaims(fx, lead.f.date, lead.line);
    xbrlNote = xr.note;
    const have = new Set(claims.filter((c) => c.verified).map((c) => c.key));
    claims = dedupeClaims([...claims, ...xr.claims.filter((c) => !have.has(c.key))]);
  }
  const headKeys = us ? headKeysOf(lead.type, lead.line) : null;
  if (us && headKeys) {
    for (const c of claims) if (c.verified && c.dir !== 'stated' && !headKeys.includes(c.key) && c.text && !also.some((a) => a.line === c.text)) also.push({ type: 'Stated change', line: c.text, dir: c.dir });
  }
  const ev: RecentEvent = {
    id: `${lead.f.ticker}|${newest}|${lead.type}|${lead.f.url ? normUrl(lead.f.url) : normTitle(lead.f.title)}`,
    date: newest, ticker: lead.f.ticker, company: list.find((x) => x.f.company)?.f.company || null,
    type: lead.type, title: cleanTitle, what: cleanClip(what, 240),
    figure: lead.figure, badge: list.some((x) => x.f.badge === 'filed') ? 'filed' : 'press',
    url: lead.f.url || list.find((x) => x.f.url)?.f.url || null, source: lead.f.source,
    importance: imp, thesis: th.touch, thesisWhy: th.why,
    origins: Array.from(new Set(list.flatMap((x) => x.f.origins))),
    routine: false, routineWhy: null, read, readNote: lead.readNote || (read === 'failed' ? list.find((x) => x.readNote)?.readNote || null : null),
    filings: dedupeFilings([...list].sort((a, b) => b.f.date.localeCompare(a.f.date)).map((x) => ({ date: x.f.date, title: x.f.title, url: x.f.url, badge: x.f.badge, line: x.line, read: x.read, readNote: x.readNote }))),
    ctx: lead.f.ctx, exchange: exchangeOf(lead.f.url || list.find((x) => x.f.url)?.f.url, lead.f.source),
    ...(also.length ? { also: also.slice(0, 6) } : {}),
  };
  const leadParts = us ? leadUnit : list;
  ev.card = buildCard({
    type: ev.type, importance: ev.importance, read, badge: ev.badge, title: cleanTitle, what: ev.what, line: lead.line, figure: lead.figure,
    claims, ctx: lead.f.ctx, noImpact: leadParts.some((x) => x.noImpact), senior: leadParts.some((x) => x.senior),
    lowConfidence: lead.lowConfidence || !!lead.seeFiling || (!lead.line && leadParts.some((x) => x.lowConfidence)),
    sourceDoc: sourceDocOf(lead), exchange: ev.exchange || null, date: newest, ratingAction: list.find((x) => x.ratingAction)?.ratingAction || null, market: lead.market,
    ...(headKeys ? { headKeys } : {}), ...(xbrlNote ? { xbrlNote } : {}),
  });
  return ev;
}

/** US: one filing's documents (8-K body + EX-99.1) are one row in the filings list, keyed by URL. */
function dedupeFilings(f: FilingRef[]): FilingRef[] {
  const seen = new Set<string>();
  return f.filter((x) => { const k = x.url ? normUrl(x.url) : `${x.date}|${x.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function dedupeClaims(c: Claim[]): Claim[] {
  const m = new Map<string, Claim>();
  for (const x of c) { const k = `${x.key}|${x.dir}|${x.verified}`; if (!m.has(k) || (x.text && !m.get(k)!.text)) m.set(k, x); }
  return Array.from(m.values());
}

function dedupeTouches(t: Touch[]): Touch[] {
  const m = new Map<string, Touch>();
  for (const x of t) { const k = `${x.key}|${x.dir}`; if (!m.has(k)) m.set(k, x); }
  return Array.from(m.values());
}

function routineEvent(x: Resolved, why: string): RecentEvent {
  const ev: RecentEvent = {
    id: `r|${x.f.key}`, date: x.f.date, ticker: x.f.ticker, company: x.f.company, type: x.type, title: x.f.title,
    what: x.line || x.f.title, figure: null, badge: x.f.badge, url: x.f.url, source: x.f.source, importance: 'Minor',
    thesis: 'neutral', thesisWhy: 'routine filing', origins: x.f.origins, routine: true, routineWhy: why,
    read: x.read, readNote: x.readNote,
    filings: [{ date: x.f.date, title: x.f.title, url: x.f.url, badge: x.f.badge, line: x.line, read: x.read, readNote: x.readNote }],
    ctx: x.f.ctx, exchange: exchangeOf(x.f.url, x.f.source),
  };
  ev.card = buildCard({ type: ev.type, importance: 'Minor', routine: true, read: x.read, badge: x.f.badge, title: x.f.title, what: ev.what, line: x.line, figure: null,
    claims: [], ctx: x.f.ctx, sourceDoc: sourceDocOf(x), exchange: ev.exchange || null, date: x.f.date, market: x.market });
  return ev;
}

/** Pure: same ticker, same event type, filed within GROUP_DAYS of each other → one event. */
export function groupResolved(list: Resolved[]): Resolved[][] {
  const out: Resolved[][] = [];
  const by = new Map<string, Resolved[]>();
  for (const x of list) by.set(`${x.f.ticker}|${x.type}`, [...(by.get(`${x.f.ticker}|${x.type}`) || []), x]);
  for (const g of by.values()) {
    const s = [...g].sort((a, b) => a.f.date.localeCompare(b.f.date));
    let cur: Resolved[] = [];
    for (const x of s) {
      if (cur.length && Math.abs(daysAgo(cur[cur.length - 1].f.date, x.f.date)) > GROUP_DAYS) { out.push(cur); cur = []; }
      cur.push(x);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/** Pure (zzz829): every filing's documents as one unit — US: the same SEC accession (8-K body, EX-99.1, the ledger's
 *  read of either) is ONE filing; India: every resolved filing is its own unit. */
function unitsOf(live: Resolved[]): Resolved[][] {
  const out: Resolved[][] = [];
  const by = new Map<string, Resolved[]>();
  for (const x of live) {
    if (!x.acc) { out.push([x]); continue; }
    const k = `${x.f.ticker}|${x.acc}`;
    if (!by.has(k)) { const u: Resolved[] = []; by.set(k, u); out.push(u); }
    by.get(k)!.push(x);
  }
  return out;
}

/** Pure: units of the same ticker and headline type within GROUP_DAYS → one event. A filed SEC XBRL figure (the RPO
 *  reading) never joins a document's event — its change is not the document's. */
function groupUnits(units: Resolved[][]): Resolved[][][] {
  const lead = (u: Resolved[]) => [...u].sort((a, b) => headRank(a.type) - headRank(b.type))[0];
  const keyOf = (u: Resolved[]) => { const l = lead(u); return `${l.f.ticker}|${l.type}|${u.every((x) => x.xbrlFact) ? 'x' : ''}`; };
  const by = new Map<string, Resolved[][]>();
  for (const u of units) by.set(keyOf(u), [...(by.get(keyOf(u)) || []), u]);
  const out: Resolved[][][] = [];
  const dateOf = (u: Resolved[]) => u.reduce((m, x) => (x.f.date > m ? x.f.date : m), u[0].f.date);
  for (const g of by.values()) {
    const s = [...g].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    let cur: Resolved[][] = [];
    for (const u of s) {
      if (cur.length && Math.abs(daysAgo(dateOf(cur[cur.length - 1]), dateOf(u))) > GROUP_DAYS) { out.push(cur); cur = []; }
      cur.push(u);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

export function sortByImportance(a: RecentEvent, b: RecentEvent): number {
  return IMP_RANK[a.importance] - IMP_RANK[b.importance] || TYPE_RANK[a.type] - TYPE_RANK[b.type]
    || b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker);
}

export function emptyCounts(): Record<TypeFilter, number> {
  const c = { All: 0 } as Record<TypeFilter, number>;
  for (const t of EVENT_TYPES) c[t] = 0;
  return c;
}
export function typeCounts(items: RecentEvent[]): Record<TypeFilter, number> {
  const c = emptyCounts();
  for (const e of items) { c[e.type] += 1; c.All += 1; }
  return c;
}
export function filterByType(items: RecentEvent[], f: TypeFilter): RecentEvent[] {
  return f === 'All' ? items : items.filter((e) => e.type === f);
}

export interface BuildOptions {
  days?: number;
  /** Document reads keyed by URL (any spelling — normalised here). */
  reads?: Record<string, FilingRead> | Map<string, FilingRead> | null;
  market?: 'IN' | 'US';
  /** zzz825: company names the page already holds (book rows, bench rows, Conviction Beats lists), by ticker —
   *  used when no filing row carries one. A "name" equal to the ticker is ignored. */
  names?: Record<string, string | null | undefined> | Map<string, string | null | undefined> | null;
  /** zzz829 (US): each ticker's SEC XBRL grader row (the card's figures) — a results event's year-ago comparison,
   *  and the company's size for materiality. */
  facts?: Record<string, UsCardFacts | null | undefined> | Map<string, UsCardFacts | null | undefined> | null;
}

const bareTicker = (t: string): string => String(t || '').toUpperCase().trim().replace(/^(?:NSE|BSE|NYSE|NASDAQ):/, '').replace(/-(?:BE|SM|ST|BZ|E1|EQ)$/, '');

/** Pure: one ticker → company-name map from any number of lists; the first real name wins. */
export function nameMapOf(...lists: Array<Array<{ ticker?: string | null; symbol?: string | null; company?: string | null; name?: string | null }> | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const list of lists) for (const x of list || []) {
    const t = bareTicker(String(x?.ticker || x?.symbol || ''));
    const n = String(x?.company || x?.name || '').replace(/\s+/g, ' ').trim();
    if (!t || !n || out[t] || bareTicker(n) === t || /^\d+$/.test(n)) continue;
    out[t] = n;
  }
  return out;
}

/** Pure: the reading tier of one resolved filing (see ReadTier). */
function tierOf(x: Resolved): ReadTier {
  const subj = subjectIn(x.f, x.market);
  if (subj.generic) return 'open';
  const imp = importanceOf({ type: x.type, figure: x.figure, line: x.line, senior: x.senior, read: x.read, noImpact: x.noImpact });
  if (imp !== 'Minor') return 'first';
  return /^(?:Management change|Shareholding disclosure|Promoter holding change|Exchange clarification|Other filing)$/.test(x.type) ? 'minor' : 'open';
}
const TIER_RANK: Record<ReadTier, number> = { first: 0, open: 1, minor: 2 };

/** Pure: the whole tab's data from every observation on the page. */
export function buildRecentCatalysts(raws: RawEvent[], today: string, daysOrOpts: number | BuildOptions = {}): RecentCatalystResult {
  const o: BuildOptions = typeof daysOrOpts === 'number' ? { days: daysOrOpts } : daysOrOpts;
  const days = o.days ?? DEFAULT_WINDOW_DAYS;
  const market = o.market || 'IN';
  const readMap = new Map<string, FilingRead>();
  const src = o.reads instanceof Map ? Array.from(o.reads.entries()) : Object.entries(o.reads || {});
  for (const [u, r] of src) if (r) readMap.set(normUrl(u || r.url), r);

  const filings = mergeFilings(raws);
  const resolved = filings.map((f) => resolve(f, readMap, market));
  const win = resolved.filter((x) => inWindow(x.f.date, today, days));

  // DUPLICATE FILINGS: the same subject filed twice on one day under two links (NSE + BSE, a re-upload).
  const dupes = new Set<Resolved>();
  const byTitle = new Map<string, Resolved[]>();
  for (const x of win) {
    const nt = normTitle(x.f.title);
    if (!nt || x.routine) continue;
    const k = `${x.f.ticker}|${x.f.date}|${nt}`;
    byTitle.set(k, [...(byTitle.get(k) || []), x]);
  }
  for (const list of byTitle.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.f.origins.length - a.f.origins.length || (b.line ? 1 : 0) - (a.line ? 1 : 0) || (b.f.url ? 1 : 0) - (a.f.url ? 1 : 0));
    for (const d of list.slice(1)) dupes.add(d);
  }

  const hidden: RecentEvent[] = [];
  const live: Resolved[] = [];
  for (const x of win) {
    if (x.routine) hidden.push(routineEvent(x, x.routine));
    else if (dupes.has(x)) hidden.push(routineEvent(x, 'duplicate filing'));
    else live.push(x);
  }
  // zzz829: the card's SEC XBRL figures by ticker (US results comparison, materiality by company size)
  const facts = new Map<string, UsCardFacts>();
  const fsrc = o.facts instanceof Map ? Array.from(o.facts.entries()) : Object.entries(o.facts || {});
  for (const [k, v] of fsrc) if (k && v) facts.set(bareTicker(k), v);
  const bx: BuildCtx = { market, facts };
  const events = market === 'US'
    ? groupUnits(unitsOf(live)).map((g) => toEvent(g, bx)).sort(sortByImportance)
    : groupResolved(live).map((g) => toEvent(g.map((x) => [x]), bx)).sort(sortByImportance);
  // zzz824: one name per ticker — a row whose filing carried no company name takes it from the ticker's other rows
  const names = new Map<string, string>();
  for (const r of raws) if (r.company && r.ticker && !names.has(r.ticker.toUpperCase())) names.set(r.ticker.toUpperCase(), r.company);
  // zzz825: then the page's own name map (book / bench / Conviction Beats lists); unknown stays null
  const given = new Map<string, string>();
  const gsrc = o.names instanceof Map ? Array.from(o.names.entries()) : Object.entries(o.names || {});
  for (const [k, v] of gsrc) { const n = String(v || '').trim(); if (k && n && bareTicker(n) !== bareTicker(k)) given.set(bareTicker(k), n); }
  for (const e of [...events, ...hidden]) {
    if (!e.company) e.company = names.get(e.ticker.toUpperCase()) || given.get(bareTicker(e.ticker)) || null;
    if (e.company && bareTicker(e.company) === bareTicker(e.ticker)) e.company = null;
  }
  // zzz825: the reading tier of each still-unread event (the tab offers "read now" for the lazy ones)
  const tierByUrl = new Map<string, ReadTier>();
  for (const x of win) if (x.f.url && x.read === 'pending') tierByUrl.set(normUrl(x.f.url), tierOf(x));
  for (const e of events) e.readTier = e.read === 'pending' && e.url ? tierByUrl.get(normUrl(e.url)) || null : null;
  const items = events.filter((e) => e.importance !== 'Minor');
  const minor = events.filter((e) => e.importance === 'Minor');
  hidden.sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));

  const lastAny = resolved.filter((x) => !x.routine && daysAgo(x.f.date, today) >= -1).sort((a, b) => b.f.date.localeCompare(a.f.date))[0] || null;

  // zzz825 (§34): Material + Notable first, then the undecided, the known-Minor last (the page reads those on demand)
  const toRead: ReadRequest[] = win
    .filter((x) => needsRead(x.f, market) && !readMap.has(normUrl(x.f.url)))
    .map((x) => ({ x, tier: tierOf(x) }))
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.x.f.date.localeCompare(a.x.f.date))
    .map(({ x, tier }) => ({ url: x.f.url as string, ticker: x.f.ticker, subject: x.f.title, date: x.f.date, company: x.f.company || given.get(bareTicker(x.f.ticker)) || null, tier }));
  const wantRead = win.filter((x) => needsRead(x.f, market));
  const readN = wantRead.filter((x) => readMap.get(normUrl(x.f.url))?.status === 'read').length;
  const failN = wantRead.filter((x) => readMap.get(normUrl(x.f.url))?.status === 'failed').length;

  return {
    items, minor, hidden, counts: typeCounts(items),
    lastItem: lastAny ? { date: lastAny.f.date, ticker: lastAny.f.ticker } : null,
    window: { from: windowStartDay(today, days), to: today, days },
    toRead,
    reading: { total: wantRead.length, read: readN, failed: failN, pending: wantRead.length - readN - failN, lazy: toRead.filter((q) => q.tier === 'minor').length },
  };
}

/** The browser's local calendar day, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// BY CALENDAR DAY, LIKE EARNINGS OPPORTUNITIES.                      (zzz814)
// The owner: "keep latest at top, similar to India Earnings Opportunities
// based on calendar dates selected — inside that, BLOCKBUSTER / most important
// first". A window selector (Today · 3d · 5d · 10d, ← → one day, jump to a
// date inside the last 10 days) picks the days; each day is a group, newest
// day first; inside a day Material → Notable → Minor, then event weight.
// ═══════════════════════════════════════════════════════════════════════════

export const WINDOW_SPANS = [1, 3, 5, 10] as const;
export type WindowSpan = typeof WINDOW_SPANS[number];

const addDays = (d: string, n: number): string => new Date((dayNum(d) + n) * 86_400_000).toISOString().slice(0, 10);

/** Pure: the selected days. `anchor` is the newest day shown (default today), clamped to the last
 *  `maxDays` days; the range never reaches before the oldest day the tab holds. */
export function windowRange(today: string, span: WindowSpan | number, anchor?: string | null, maxDays: number = DEFAULT_WINDOW_DAYS): { from: string; to: string; days: number } {
  const oldest = addDays(today, -(maxDays - 1));
  let to = isoDay(anchor) || today;
  if (to > today) to = today;
  if (to < oldest) to = oldest;
  let from = addDays(to, -(Math.max(1, span) - 1));
  if (from < oldest) from = oldest;
  return { from, to, days: daysAgo(from, to) + 1 };
}

/** Pure: is the day inside the range (one day ahead of `to` is tolerated when `to` is today — IST vs Europe). */
export function inRange(date: string, r: { from: string; to: string }, today?: string): boolean {
  const d = isoDay(date);
  if (!d) return false;
  const top = today && r.to === today ? addDays(today, 1) : r.to;
  return d >= r.from && d <= top;
}

/** Pure: the order inside one day — Material → Notable → Minor, then a stated figure first (the
 *  "blockbuster" — results with numbers, an order with a value), then event weight, then ticker. */
export function compareWithinDay(a: RecentEvent, b: RecentEvent): number {
  return IMP_RANK[a.importance] - IMP_RANK[b.importance]
    || (a.figure ? 0 : 1) - (b.figure ? 0 : 1)
    || (a.thesis === 'supports' ? 0 : 1) - (b.thesis === 'supports' ? 0 : 1)
    || TYPE_RANK[a.type] - TYPE_RANK[b.type]
    || a.ticker.localeCompare(b.ticker);
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon 22 Sep" */
export function dayLabel(date: string): string {
  const d = new Date(dayNum(date) * 86_400_000);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
}

export interface DayGroup {
  date: string;
  label: string;
  /** Material + Notable, most important first. */
  items: RecentEvent[];
  minor: RecentEvent[];
  hidden: RecentEvent[];
  /** "Mon 22 Sep · 5 events (2 Material)" — events counts items + minor, never routine. */
  header: string;
}

/** Pure: one group per calendar day in the range, newest day first. A day with nothing but
 *  routine paperwork still gets its group (so "3 routine filings hidden" is said per day). */
export function groupByDay(res: Pick<RecentCatalystResult, 'items' | 'minor' | 'hidden'>, range: { from: string; to: string }, today?: string): DayGroup[] {
  const map = new Map<string, DayGroup>();
  const at = (d: string) => {
    const k = d > range.to ? range.to : d;          // an IST "tomorrow" sits with today
    if (!map.has(k)) map.set(k, { date: k, label: dayLabel(k), items: [], minor: [], hidden: [], header: '' });
    return map.get(k)!;
  };
  for (const e of res.items) if (inRange(e.date, range, today)) at(e.date).items.push(e);
  for (const e of res.minor) if (inRange(e.date, range, today)) at(e.date).minor.push(e);
  for (const e of res.hidden) if (inRange(e.date, range, today)) at(e.date).hidden.push(e);
  const out = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  for (const g of out) {
    g.items.sort(compareWithinDay);
    g.minor.sort(compareWithinDay);
    const n = g.items.length + g.minor.length;
    const mat = g.items.filter((e) => e.importance === 'Material').length;
    g.header = `${g.label} · ${n} event${n === 1 ? '' : 's'}${mat ? ` (${mat} Material)` : ''}`;
  }
  return out;
}

/** Pure: up to `n` Material items across the range, newest first (weight breaks a tie). */
export function topOfWindow(items: RecentEvent[], range: { from: string; to: string }, n = 5, today?: string): RecentEvent[] {
  return items.filter((e) => e.importance === 'Material' && inRange(e.date, range, today))
    .sort((a, b) => b.date.localeCompare(a.date) || compareWithinDay(a, b)).slice(0, n);
}

/** Pure: the default-visible count for a range (the tab label). */
export function countInRange(items: RecentEvent[], range: { from: string; to: string }, today?: string): number {
  return items.filter((e) => inRange(e.date, range, today)).length;
}

/** A DOM-safe anchor id for a row. */
export const rowAnchor = (e: Pick<RecentEvent, 'id'>): string => `nc-${e.id.replace(/[^a-z0-9]+/gi, '-').slice(0, 120)}`;

// ═══════════════════════════════════════════════════════════════════════════
// CLEAN TEXT ONLY.                                                   (zzz815)
// Live rows showed letterhead ("Scrip Code: GOLDIAM EQ Respected Sir/Madam"),
// SEBI disclosure-table junk ("No No No … Not Applicable Not Applicable"),
// investor-deck dumps ("15,021 17,714 17,976 5,346 19% 20% 24% 25% FY24FY25…")
// and OCR breakage ("Bimad1 i Speciality"). Three pure tools:
//   stripLetterhead — cut the letter furniture before any sentence is chosen
//   lineQuality     — the gate a line must pass before it is displayed
//   cleanClip       — shorten at a sentence end, else a word end, never mid-word
// ═══════════════════════════════════════════════════════════════════════════

const LETTERHEAD: RegExp[] = [
  // exchange addresses and departments
  /\b(?:the\s+)?(?:general\s+manager[,\s]*)?(?:listing\s+(?:department|compliance|operations)|department\s+of\s+corporate\s+services|corporate\s+relationship\s+department|corporate\s+communication\s+department)\b[^.]{0,40}?/gi,
  /\b(?:BSE\s+Limited|National\s+Stock\s+Exchange\s+of\s+India\s+(?:Limited|Ltd\.?))[,\s]*(?:(?:Phiroze\s+Jeejeebhoy\s+Towers|P\.?\s?J\.?\s+Towers|Exchange\s+Plaza)[^.]{0,160}?(?:400\s?0\d\d|Mumbai)\s*[-–]?\s*(?:400\s?0\d\d)?)?/gi,
  /\b(?:Plot\s+No\.?\s*C\/?1,?\s*)?(?:G\s+)?Block,?\s+Bandra[-\s]?Kurla\s+Complex,?\s+Bandra\s*\(E(?:ast)?\),?\s+Mumbai\s*[-–]?\s*400\s?0\d\d/gi,
  /\bDalal\s+Street,?\s+(?:Fort,?\s+)?Mumbai\s*[-–]?\s*400\s?0\d\d/gi,
  /\b(?:Mumbai|New\s+Delhi|Delhi|Chennai|Kolkata|Bengaluru|Bangalore|Hyderabad|Pune|Ahmedabad|Gurugram|Gurgaon|Noida)\s*[-–,]?\s*\d{3}\s?\d{3}\b/g,
  // identifiers
  /\b(?:NSE|BSE)?\s*(?:Scrip|Script|Security|Stock)\s*(?:Code|Symbol|ID|Name)\s*[:\-–]?\s*[A-Z0-9&.\-]{2,20}(?:\s*\((?:Units|Equity|EQ)\)|\s+EQ\b|\s+(?:Series\s*:?\s*)?EQ)?/gi,
  /\b(?:NSE|BSE)\s+Symbol\s*[:\-–]?\s*[A-Z0-9&.\-]{2,20}/gi,
  /\bSymbol\s*[:\-–]\s*[A-Z0-9&.\-]{2,20}(?:\s*\((?:Units|Equity)\))?/g,
  /\bISIN\s*(?:No\.?|Code)?\s*[:\-–]?\s*[A-Z]{2}[A-Z0-9]{9}\d\b/gi,
  /\bSeries\s*[:\-–]\s*[A-Z]{1,3}\b/g,
  /\bCIN\s*[:\-–]?\s*[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/gi,
  // salutations, subject / reference labels, closings
  /\b(?:Dear|Respected)\s+(?:Sir|Madam|Sirs)(?:\s*[\/,]\s*(?:Madam|Sir|Ma'?am))?\s*[,:]?/gi,
  /\bTo,?\s+(?=The\s+(?:Manager|General Manager|Listing|Secretary))/g,
  // a subject / reference line is the filing's title, not its content: dropped whole when it ends in a
  // full stop and holds no content verbs, else only its label goes ("Subject: Disclosure , We wish …")
  /\b(?:Ref(?:erence)?|Sub(?:ject)?)\s*[:\-–]\s*(?:(?![^.]{0,220}\b(?:we|has|have|had|is|are|was|were)\b)[^.]{3,220}\.\s+)?/gi,
  /\b(?:kindly|please)\s+take\s+(?:the\s+)?(?:same|above|this)\s+on\s+(?:your\s+)?records?\.?/gi,
  /\bthis\s+is\s+for\s+your\s+(?:kind\s+)?(?:information|reference|records)(?:\s+and\s+(?:records|necessary action))?\.?/gi,
  /\b(?:thanking\s+you|yours\s+(?:faithfully|truly|sincerely)|with\s+regards|regards)[.,]?/gi,
  /\bfor\s+and\s+on\s+behalf\s+of\b[^.]{0,80}/gi,
  /\bFor\s+[A-Z][A-Za-z&.\- ]{2,60}\s+(?:Limited|Ltd\.?)\s+(?=[A-Z][a-z]+\s+[A-Z])/g,
  /\b(?:Company\s+Secretary|Compliance\s+Officer)(?:\s*(?:&|and)\s*(?:Compliance\s+Officer|Company\s+Secretary))?\b(?:\s*(?:Membership|M\.?\s?No\.?|ACS|FCS)\s*[:.]?\s*[A-Z]*\d+)?/gi,
  /\b(?:Membership\s+No\.?|ACS|FCS)\s*[:.]?\s*[A-Z]?\d{3,6}\b/gi,
  /\bEncl(?:osure)?s?\s*[:.]\s*(?:as\s+above)?/gi,
  // office lines, contacts, footers
  /\b(?:Regd\.?|Registered|Corporate|Head)\s+Office\s*[:\-–]?[^.]{0,160}?(?=\s(?:Tel|Phone|Ph|Fax|E-?mail|Website|CIN|www)\b|$)/gi,
  /\b(?:Tel|Phone|Ph|Fax|Mob(?:ile)?)\s*(?:No\.?)?\s*[:.]?\s*[+()\d][\d\s()+\-\/,]{6,40}/gi,
  /\b(?:E-?mail|Email\s+ID)\s*[:\-–]?\s*\S+@\S+/gi,
  /\S+@\S+\.\w{2,}/g,
  /\b(?:Website|Web)\s*[:\-–]?\s*(?:https?:\/\/)?(?:www\.)?\S+\.\w{2,}\S*/gi,
  /\b(?:https?:\/\/)?www\.\S+/gi,
  /\bPage\s+\d+\s+(?:of|\/)\s+\d+\b/gi,
];

/** Pure: the text with letterhead, identifiers, salutations, closings and footers cut out. */
export function stripLetterhead(text: string): string {
  let t = String(text || '').replace(/\s+/g, ' ');
  for (const re of LETTERHEAD) t = t.replace(re, ' ');
  return t.replace(/\s+([,.;:])/g, '$1').replace(/([,.;:])(?:\s*[,.;:])+/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

const LETTERHEAD_HINT = /listing\s+department|scrip\s*(?:code|symbol)|script\s+code|\bISIN\b|\bCIN\b|dalal\s+street|exchange\s+plaza|bandra[-\s]kurla|\b400\s?0\d\d\b|(?:dear|respected)\s+sir|sir\s*\/\s*madam|\bsub(?:ject)?\s*:|\bref\s*:|take\s+(?:the\s+)?same\s+on\s+record|yours\s+(?:faithfully|truly)|company\s+secretary|compliance\s+officer|regd\.?\s+office|registered\s+office/i;

/** Pure: a word with a digit inside it ("Bimad1i", "Re1iance") or a split word inside a name. */
export function ocrBroken(s: string): boolean {
  const t = String(s || '');
  if (/[A-Za-z]\d+[A-Za-z]|\b[A-Za-z]{2,}\d\s[a-z]\b|\b\d[a-z]{3,}/.test(t)) return true;
  return false;
}
/** In a proper name every word is capitalised; a lower-case fragment of 4+ letters is a split word ("Re fractories"). */
export function nameBroken(name: string): boolean {
  if (ocrBroken(name)) return true;
  const words = String(name || '').split(/\s+/).filter(Boolean);
  return words.some((w) => /^[a-z]{4,}$/.test(w) && !/^(?:private|limited|and|with|from|into)$/.test(w))
    || /\b[a-z]\s[a-z]\b/.test(name);
}

/** Pure: may this line be shown? Rejects table dumps, disclosure-table junk, letterhead and OCR breakage. */
export function lineQuality(line: string | null | undefined): { ok: boolean; why: string | null } {
  const s = String(line || '').trim();
  if (!s) return { ok: false, why: 'empty' };
  const tokens = s.split(/\s+/).filter(Boolean);
  // bare numbers (no ₹ / $ / unit in front) and run-together period labels ("FY24FY25FY26") are table text
  const bare = (w: string) => /^[\d,.]+%?$/.test(w) || /^(?:FY\d{2}|Q[1-4]-?FY\d{2}){2,}/i.test(w);
  const numeric = tokens.filter(bare).length;
  let run = 0, maxRun = 0;
  for (const w of tokens) { run = bare(w) ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
  if ((tokens.length >= 6 && numeric / tokens.length > 0.3) || maxRun >= 4) return { ok: false, why: 'mostly numbers / table text' };
  if ((s.match(/\b(?:Not\s+Applicable|N\.?A\.?|No|Nil)\b(?=[\s,.;]|$)/gi) || []).length >= 3) return { ok: false, why: 'disclosure-table text' };
  if (/\b(?:If yes|whether the (?:same|sale|transaction|acquisition)|arm'?\s?s length|related party transaction)\b/i.test(s) && !/₹|Rs\.?\s?\d|crore/i.test(s)) return { ok: false, why: 'disclosure-table text' };
  if (/\bParticulars\s+Details\b|\bName of the listed (?:company|entity)\b|^(?:Sr\.?|S\.?)?\s*No\.?\s+Particulars\b/i.test(s)) return { ok: false, why: 'disclosure-table text' };
  if (LETTERHEAD_HINT.test(s)) return { ok: false, why: 'letterhead text' };
  if (/[A-Za-z]\d+[A-Za-z]{2,}|\b[A-Za-z]{3,}\d\s[a-z]\b/.test(s.replace(/\b(?:FY|Q[1-4]|H[12]|9M)[-']?\d+|\d+(?:MTPA|TPA|MW|GW|KLPD|MT|mn|bn|cr)\b|\b(?:[A-Z]{1,4}\d{1,4}[A-Z]{0,3})\b/g, ''))) return { ok: false, why: 'broken OCR text' };
  if (/(?:[A-Z]{2,}\s+){6,}/.test(s)) return { ok: false, why: 'slide heading text' };
  return { ok: true, why: null };
}

/** Pure: shorten at a sentence end within `n`, else at a word end with "…" — never mid-word. */
export function cleanClip(s: string, n = 200): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const head = t.slice(0, n);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '));
  if (end >= n * 0.5) return head.slice(0, end + 1).replace(/;$/, '.');
  return `${head.replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '')}…`;
}
