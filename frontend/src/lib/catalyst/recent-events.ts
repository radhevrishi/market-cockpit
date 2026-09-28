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

export type { FilingRead, Touch } from './filing-read-types';

export const EVENT_TYPES = [
  'Results', 'Order win', 'Capex / capacity', 'Corporate restructuring', 'Acquisition', 'Divestment',
  'Regulatory approval', 'Fund raise', 'Guidance', 'Management change', 'Concall / business update',
  'Regulatory / legal action', 'Exchange clarification', 'Shareholding disclosure', 'Promoter holding change',
  'Other filing',
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
  reading: { total: number; read: number; failed: number; pending: number };
}

export interface ReadRequest { url: string; ticker: string; subject: string; date: string; company: string | null }

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

const SENIOR = /\b(ceo|chief\s+executive|cfo|chief\s+financial|managing\s+director|\bmd\b|chairman|chairperson|whole[-\s]time\s+director|executive\s+director|coo|chief\s+operating|president|jt\.?\s+managing|joint\s+managing)\b/i;

const RULES: Array<[RegExp, RecentEventType, { generic?: boolean }?]> = [
  // exchange questions first: "Reply to Clarification- Financial results" is a reply, not results
  [/clarification|spurt\s+in\s+(volume|price)|(price|volume)\s+movement|movement\s+in\s+(price|volume)|significant\s+(increase|movement)\s+in\s+(price|volume)|query\s+from\s+the\s+exchange/i, 'Exchange clarification'],
  [/scheme\s+of\s+(arrangement|amalgamation)|demerg|amalgamat|\bmerger\b|composite\s+scheme|hive[-\s]off|resulting\s+company|transferor|transferee/i, 'Corporate restructuring'],
  // a regulator / court / tax authority acting — never an order win
  [/action\(?s?\)?\s+initiated|orders?\s+passed|penalt|show[-\s]cause|demand\s+(notice|order)|tax\s+demand|notice\s+(from|under|of|received)|litigation|\bdispute\b|court\b|tribunal|\bsearch\b|\bseizure|\bfine\b|levied|enforcement|warning\s+letter|import\s+alert|form\s+483|\b483\b|suspension|insolvency|\bCIRP\b|default/i, 'Regulatory / legal action'],
  [/inter[-\s]?se\s+transfer|regulation\s*10\s*\(\s*[56]\s*\)|reg\.?\s*10\s*\(\s*[56]\s*\)/i, 'Promoter holding change'],
  [/\bSAST\b|regulation\s*29\s*\(|reg\.?\s*29\s*\(|regulation\s*31\s*\(|takeover\s+regulations?|substantial\s+acquisition|\bpledge|encumbrance|regulation\s*7\s*\(\s*2\s*\)|insider\s+trading|\bPIT\b|form\s+(3|4|5)\b|schedule\s+13[dg]|\b13[dg]\b/i, 'Shareholding disclosure'],
  [/sale\s+or\s+disposal|disposal\s+of|divest|slump\s+sale|sale\s+of\s+(stake|business|undertaking|unit|division|subsidiary|shares?\s+(in|of)\s+(its\s+)?(subsidiary|associate|jv))|transfer\s+of\s+(business|undertaking)|item\s*2\.01.*dispos/i, 'Divestment'],
  [/acqui(re|red|res|ring|sition)|takeover\s+(bid|offer)|stake\s+(purchase|acquisition)|open\s+offer|definitive\s+agreement\s+to\s+(acquire|purchase)|item\s*2\.01/i, 'Acquisition'],
  [/\bQIP\b|qualified\s+institutions?\s+placement|preferential\s+(issue|allotment)|rights\s+issue|fund[\s-]*rais|private\s+placement|\bwarrants?\b|allotment\s+of\s+(equity|shares|securities)|issue\s+of\s+(equity|securities)|public\s+offering|registered\s+direct|\bATM\s+(program|offering)|convertible\s+notes?|item\s*3\.02/i, 'Fund raise'],
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
  const prov = ctx.fit === 'provisional' ? ' (type provisional)' : '';
  if (!touches.length) {
    return read === 'pending' ? { touch: 'not assessed', why: 'document still being read' }
      : read === 'failed' ? { touch: 'not assessed', why: 'document could not be opened' }
      : { touch: 'neutral', why: `nothing in it moves a ${p} thesis variable` };
  }
  const vars = thesisVars(ctx);
  const hit = touches.filter((t) => vars.has(t.key));
  if (!hit.length) {
    const names = Array.from(new Set(touches.map((t) => varLabel(t.key).toLowerCase()))).slice(0, 2).join(', ');
    return { touch: 'neutral', why: `${names} — not a variable the ${p} thesis rests on` };
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
  if (up.length && !down.length) return { touch: 'supports', why: `${say(up, 'up')} — ${p} thesis variable${prov}` };
  if (down.length && !up.length) return { touch: 'against', why: `${say(down, 'down')} — ${p} thesis variable${prov}` };
  if (up.length && down.length) return { touch: 'neutral', why: `mixed: ${say(up, 'up')}, ${say(down, 'down')}${prov}` };
  return { touch: 'neutral', why: `states ${varLabel(hit[0].key).toLowerCase()} (a level, no change)${prov}` };
}

const DIR: Record<string, Touch['dir']> = { up: 'up', UP: 'up', down: 'down', DOWN: 'down' };

// ── importance ─────────────────────────────────────────────────────────────

const TYPE_RANK: Record<RecentEventType, number> = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, i])) as any;
const IMP_RANK: Record<Importance, number> = { Material: 0, Notable: 1, Minor: 2 };

/** Pure: Material / Notable / Minor, in words. */
export function importanceOf(e: { type: RecentEventType; figure: string | null; line: string | null; senior?: boolean; read: ReadState; noImpact?: boolean }): Importance {
  const fig = !!e.figure;
  switch (e.type) {
    case 'Results': return fig ? 'Material' : 'Notable';
    case 'Order win': return fig ? 'Material' : 'Notable';
    case 'Capex / capacity': return fig || /commission|commercial production|operational/i.test(e.line || '') ? 'Material' : 'Notable';
    case 'Corporate restructuring': case 'Acquisition': case 'Divestment': return 'Material';
    case 'Regulatory approval': return 'Material';
    case 'Fund raise': return fig ? 'Material' : 'Notable';
    case 'Guidance': return fig ? 'Material' : 'Notable';
    case 'Management change': return e.senior ? 'Notable' : 'Minor';
    case 'Concall / business update': return fig ? 'Notable' : e.read === 'read' || e.line ? 'Notable' : 'Minor';
    case 'Regulatory / legal action': return e.noImpact ? 'Minor' : 'Notable';
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
  if (f.subject.routine) return false;
  // a periodic report (10-Q / 10-K) is long and its figures are on the card already
  if (market === 'US' && /form\s+(10-?q|10-?k|20-?f|40-?f)/i.test(f.title)) return false;
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
}

function resolve(f: FilingItem, readMap: Map<string, FilingRead>, market: 'IN' | 'US'): Resolved {
  const r = f.url ? readMap.get(normUrl(f.url)) || null : null;
  const want = needsRead(f, market);
  const read: ReadState = r ? (r.status === 'read' ? 'read' : 'failed') : want ? 'pending' : 'not-needed';
  let type: RecentEventType = f.subject.type;
  let routine = f.subject.routine;
  // the document decides a generic subject ("Press Release", "General Updates", "material issue")
  if (r?.status === 'read' && (f.subject.generic || type === 'Other filing') && !routine) {
    if (r.routine) routine = r.routine;
    else if (r.kind) type = r.kind as RecentEventType;
  }
  // a concall / presentation that states a hard fact is filed under that fact (capacity commissioned,
  // results figures, an order with value) — the deck is the wrapper, the fact is the event
  if (r?.status === 'read' && type === 'Concall / business update' && r.kind && (r.figures || []).length
    && ['Capex / capacity', 'Order win', 'Results', 'Regulatory approval', 'Guidance'].includes(r.kind)) type = r.kind as RecentEventType;
  if (!f.subject.routine && !r && f.events.length && type === 'Other filing') {
    const v = f.events.find((e) => e.variable && VAR_TYPE[e.variable]);
    if (v) type = VAR_TYPE[v.variable as string];
  }
  if (type === 'Other filing' && !r && f.kind && KIND_TYPE[f.kind]) type = KIND_TYPE[f.kind];
  // the line that matters
  const evs = f.events;
  const withFig = evs.filter((e) => e.figure);
  const best = withFig.find((e) => e.variable && VAR_TYPE[e.variable] === type) || withFig[0] || evs[0] || null;
  let line: string | null = null;
  let figure: string | null = null;
  if (r?.status === 'read' && r.line) { line = r.line; figure = r.figures && r.figures.length ? r.figures[0] : null; }
  if (!line && best?.text) { line = String(best.text); figure = best.figure || null; }
  if (line && evs.length > 1 && !(r?.status === 'read' && r.line)) {
    const more = evs.length - 1;
    line += ` (+${more} more point${more === 1 ? '' : 's'} on the card)`;
  }
  const touches: Touch[] = [];
  for (const t of r?.touches || []) touches.push(t);
  for (const e of evs) if (e.variable) touches.push({ key: e.variable, dir: DIR[String(e.direction || '')] || (e.figure ? 'stated' : 'stated') });
  const readNote = r && r.status !== 'read' ? `couldn't open the document (${r.reason || 'no reason given'})` : null;
  return {
    f, type, line, figure, routine, touches, read, readNote,
    senior: !!(f.subject.senior || r?.senior), noImpact: !!r?.noImpact,
  };
}

// ── grouping and ranking ───────────────────────────────────────────────────

function toEvent(list: Resolved[]): RecentEvent {
  // lead = the filing with the most substance (a read line with a figure, then any line, then newest)
  const score = (x: Resolved) => (x.figure ? 4 : 0) + (x.line ? 2 : 0) + (x.read === 'read' ? 1 : 0);
  const sorted = [...list].sort((a, b) => score(b) - score(a) || b.f.date.localeCompare(a.f.date));
  const lead = sorted[0];
  const newest = list.reduce((m, x) => (x.f.date > m ? x.f.date : m), list[0].f.date);
  const touches = list.flatMap((x) => x.touches);
  const read: ReadState = list.some((x) => x.read === 'read') ? 'read' : list.some((x) => x.read === 'pending') ? 'pending' : list.some((x) => x.read === 'failed') ? 'failed' : 'not-needed';
  const th = thesisFor(dedupeTouches(touches), lead.f.ctx, read);
  const what = lead.line || lead.f.title || '(untitled filing)';
  const imp = list.map((x) => importanceOf({ type: x.type, figure: x.figure, line: x.line, senior: x.senior, read: x.read, noImpact: x.noImpact }))
    .sort((a, b) => IMP_RANK[a] - IMP_RANK[b])[0];
  return {
    id: `${lead.f.ticker}|${newest}|${lead.type}|${lead.f.url ? normUrl(lead.f.url) : normTitle(lead.f.title)}`,
    date: newest, ticker: lead.f.ticker, company: list.find((x) => x.f.company)?.f.company || null,
    type: lead.type, title: lead.f.title, what: what.length > 240 ? `${what.slice(0, 239)}…` : what,
    figure: lead.figure, badge: list.some((x) => x.f.badge === 'filed') ? 'filed' : 'press',
    url: lead.f.url || list.find((x) => x.f.url)?.f.url || null, source: lead.f.source,
    importance: imp, thesis: th.touch, thesisWhy: th.why,
    origins: Array.from(new Set(list.flatMap((x) => x.f.origins))),
    routine: false, routineWhy: null, read, readNote: lead.readNote || (read === 'failed' ? list.find((x) => x.readNote)?.readNote || null : null),
    filings: [...list].sort((a, b) => b.f.date.localeCompare(a.f.date)).map((x) => ({ date: x.f.date, title: x.f.title, url: x.f.url, badge: x.f.badge, line: x.line, read: x.read, readNote: x.readNote })),
  };
}

function dedupeTouches(t: Touch[]): Touch[] {
  const m = new Map<string, Touch>();
  for (const x of t) { const k = `${x.key}|${x.dir}`; if (!m.has(k)) m.set(k, x); }
  return Array.from(m.values());
}

function routineEvent(x: Resolved, why: string): RecentEvent {
  return {
    id: `r|${x.f.key}`, date: x.f.date, ticker: x.f.ticker, company: x.f.company, type: x.type, title: x.f.title,
    what: x.line || x.f.title, figure: null, badge: x.f.badge, url: x.f.url, source: x.f.source, importance: 'Minor',
    thesis: 'neutral', thesisWhy: 'routine filing', origins: x.f.origins, routine: true, routineWhy: why,
    read: x.read, readNote: x.readNote,
    filings: [{ date: x.f.date, title: x.f.title, url: x.f.url, badge: x.f.badge, line: x.line, read: x.read, readNote: x.readNote }],
  };
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
}

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
  const events = groupResolved(live).map(toEvent).sort(sortByImportance);
  const items = events.filter((e) => e.importance !== 'Minor');
  const minor = events.filter((e) => e.importance === 'Minor');
  hidden.sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));

  const lastAny = resolved.filter((x) => !x.routine && daysAgo(x.f.date, today) >= -1).sort((a, b) => b.f.date.localeCompare(a.f.date))[0] || null;

  const toRead: ReadRequest[] = win
    .filter((x) => needsRead(x.f, market) && !readMap.has(normUrl(x.f.url)))
    .sort((a, b) => b.f.date.localeCompare(a.f.date))
    .map((x) => ({ url: x.f.url as string, ticker: x.f.ticker, subject: x.f.title, date: x.f.date, company: x.f.company }));
  const wantRead = win.filter((x) => needsRead(x.f, market));
  const readN = wantRead.filter((x) => readMap.get(normUrl(x.f.url))?.status === 'read').length;
  const failN = wantRead.filter((x) => readMap.get(normUrl(x.f.url))?.status === 'failed').length;

  return {
    items, minor, hidden, counts: typeCounts(items),
    lastItem: lastAny ? { date: lastAny.f.date, ticker: lastAny.f.ticker } : null,
    window: { from: windowStartDay(today, days), to: today, days },
    toRead,
    reading: { total: wantRead.length, read: readN, failed: failN, pending: wantRead.length - readN - failN },
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
