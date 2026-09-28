// ═══════════════════════════════════════════════════════════════════════════
// NEW IN THE LAST 10 DAYS — one list of what was filed for the names on a
// Portfolio Catalysts page.                                          (zzz808)
//
// The owner's ask: "add a tab in India and USA portfolio catalyst: new in last
// 10 days. Show them with one filter."
//
// Pure. No fetch, no model, no price. It reads only what the page already
// holds for each name:
//   · the evidence ledger's documents (every filing a check or read found,
//     read or not), with their publication dates
//   · the structural events the reader extracted from those documents
//   · documents a check saw and no read has taken in yet (pending_documents)
//   · the persistent-catalyst items (lib/catalyst/persistence) — including
//     any that came from Daily Gainers news
//   · the exchange results feed (India "Update recent reporters"), when run
// and turns them into ONE row per filing/event, newest first.
//
// Rules this module keeps:
//   · A figure is printed only when the source states it (the extracted
//     event's own before/after). Nothing is computed or invented.
//   · Thesis impact is read from the existing thesis assessment — it is never
//     judged here. No assessment for that variable → "not assessed".
//   · Routine noise (trading window, analyst-meet intimations, newspaper
//     ads, duplicate filings) is kept out of the list but COUNTED, so the page
//     can say how many were hidden.
// ═══════════════════════════════════════════════════════════════════════════

import { VAR_LABEL } from '../thesis/taxonomy';

export const EVENT_TYPES = [
  'Order win', 'Results', 'Capex / capacity', 'Concall / business update', 'Guidance',
  'Acquisition', 'Management change', 'Regulatory approval', 'Fund raise', 'Other filing',
] as const;
export type RecentEventType = typeof EVENT_TYPES[number];
export type TypeFilter = RecentEventType | 'All';
export type SourceBadge = 'filed' | 'press';
export type ThesisTouch = 'supports' | 'against' | 'neutral' | 'not assessed';
export type RawOrigin = 'ledger-doc' | 'ledger-event' | 'pending-doc' | 'persistent' | 'feed';

/** One observation from one source, before merging. */
export interface RawEvent {
  ticker: string;
  company?: string | null;
  /** Source date: ISO date or datetime. Undated observations are dropped. */
  date: string | null;
  /** The document's own title / subject / label. */
  title: string;
  /** Document kind from discovery ('results', 'transcript', 'announcement' …). */
  kind?: string | null;
  /** Thesis variable an extracted event is about (VarKey). */
  variable?: string | null;
  /** What the event says, when it is an extracted event and not just a filing. */
  text?: string | null;
  /** A figure the source states (after, or "before → after"). Never computed. */
  figure?: string | null;
  url?: string | null;
  /** Where it came from ("SEC EDGAR", "BSE corporate announcements", a news site…). */
  source?: string | null;
  /** Forced badge; otherwise derived from `source`. */
  badge?: SourceBadge;
  thesis?: ThesisTouch;
  origin: RawOrigin;
}

export interface RecentEvent {
  id: string;
  date: string;               // YYYY-MM-DD
  ticker: string;
  company: string | null;
  type: RecentEventType;
  /** The filing's own title (or the item's text when there is no filing). */
  title: string;
  what: string;
  figure: string | null;
  badge: SourceBadge;
  url: string | null;
  source: string | null;
  thesis: ThesisTouch;
  origins: RawOrigin[];
  routine: boolean;
  /** Why it was hidden, when routine. */
  routineWhy?: string | null;
}

export interface RecentCatalystResult {
  /** Not routine, inside the window, newest first. */
  items: RecentEvent[];
  /** Routine or duplicate, inside the window — hidden by default. */
  hidden: RecentEvent[];
  /** Counts per type over `items`, plus 'All'. */
  counts: Record<TypeFilter, number>;
  /** The newest non-routine item at ANY date — for the empty state. */
  lastItem: { date: string; ticker: string } | null;
  window: { from: string; to: string; days: number };
}

export const DEFAULT_WINDOW_DAYS = 10;

// ── dates ──────────────────────────────────────────────────────────────────

export function isoDay(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function dayNum(d: string): number {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd) / 86_400_000;
}

/** Whole days from `date` to `today` (0 = same day, 9 = nine days before). */
export function daysAgo(date: string, today: string): number {
  return dayNum(today) - dayNum(date);
}

/**
 * The window is `days` calendar days: today and the days-1 before it. So with
 * 10 days an item 9 days old is in, 10 days old is out. One day in the FUTURE
 * is tolerated and treated as today: an Indian filing dated in IST can be a
 * day ahead of a European browser late at night. Anything further ahead (a
 * scheduled board meeting) is out.
 */
export function inWindow(date: string | null | undefined, today: string, days: number = DEFAULT_WINDOW_DAYS): boolean {
  const d = isoDay(date);
  if (!d) return false;
  const n = daysAgo(d, today);
  return n >= -1 && n < days;
}

export function windowStartDay(today: string, days: number = DEFAULT_WINDOW_DAYS): string {
  const t = new Date((dayNum(today) - (days - 1)) * 86_400_000);
  return t.toISOString().slice(0, 10);
}

// ── routine noise ──────────────────────────────────────────────────────────

const ROUTINE: Array<[RegExp, string]> = [
  [/trading\s+window/i, 'trading window'],
  [/intimation\s+of\s+(the\s+)?(analyst|investor|institutional|fund\s+manager)|(analysts?|investors?|institutional\s+investors?)\s*(\/\s*\w+\s*)?(meet|meeting|call|conference)s?\s*[-–:]?\s*(intimation|schedule)|schedule\s+of\s+(analyst|investor|institutional)/i, 'analyst / investor meet intimation'],
  [/newspaper|news\s*paper|publication\s+of\s+.*(results|notice)|advertisement/i, 'newspaper advertisement'],
  [/(prior\s+)?intimation\s+of\s+(the\s+)?board\s+meeting|notice\s+of\s+board\s+meeting|board\s+meeting\s+intimation/i, 'board meeting intimation'],
  [/loss\s+of\s+share\s+certificate|duplicate\s+share\s+certificate|issue\s+of\s+duplicate/i, 'share certificate'],
  [/regulation\s*74\s*\(\s*5\s*\)|reg\.?\s*74\s*\(\s*5\s*\)|compliance\s+certificate|certificate\s+under\s+reg/i, 'compliance certificate'],
  [/record\s+date|book\s+closure|postal\s+ballot|scrutini[sz]er|voting\s+results|notice\s+of\s+(the\s+)?(agm|egm|annual\s+general)/i, 'shareholder meeting / record date'],
  [/investor\s+grievance|registrar\s+(and|&)\s+(share\s+)?transfer|\bRTA\b/i, 'registrar / grievance'],
  [/\bESOP\b|\bESOS\b|employee\s+stock\s+option/i, 'employee stock option allotment'],
];

/** Why a title is routine noise, or null when it is not. */
export function routineReason(title: string | null | undefined): string | null {
  const t = String(title || '');
  for (const [re, why] of ROUTINE) if (re.test(t)) return why;
  // NSE's own category "Analysts/Institutional Investor Meet/Con. Call
  // Updates" is a schedule notice — unless it carries the transcript or deck.
  if (/(analyst|investor)s?[\w\s/.&-]{0,40}\b(meet|con\.?\s*call)\b/i.test(t) && !/transcript|presentation/i.test(t)) return 'analyst / investor meet intimation';
  return null;
}

export function isRoutine(title: string | null | undefined): boolean {
  return routineReason(title) !== null;
}

// ── type mapping ───────────────────────────────────────────────────────────

const TITLE_RULES: Array<[RegExp, RecentEventType]> = [
  [/\bQIP\b|qualified\s+institutions?\s+placement|preferential\s+(issue|allotment)|rights\s+issue|fund[\s-]*rais|private\s+placement|\bwarrants?\b|\bNCDs?\b|debentures?|allotment\s+of\s+(equity|shares)|public\s+offering|registered\s+direct|\bATM\s+(program|offering)|convertible\s+notes?/i, 'Fund raise'],
  [/acqui(re|red|res|ring|sition)|amalgamation|\bmerger\b|takeover|scheme\s+of\s+arrangement|stake\s+(purchase|acquisition)|definitive\s+agreement\s+to\s+(acquire|purchase)/i, 'Acquisition'],
  [/appoint(ment|ed)?|resign(ation|ed|s)?|cessation|re-?designat|change\s+in\s+(director|management|key\s+managerial|kmp|auditor|ceo|cfo)|\b(ceo|cfo|coo|managing\s+director|whole[-\s]time\s+director|company\s+secretary)\b\s+(appointed|steps|named|to\s+step)|item\s*5\.02/i, 'Management change'],
  [/\border(s)?\b|bagging|receiving\s+of\s+order|contract\s+(award|win|worth|of|from|for)|letter\s+of\s+(award|intent)|\bLOA\b|\bLOI\b|work\s+order|purchase\s+order|\bL1\b|awarded|order\s+book/i, 'Order win'],
  [/transcript|con[\s-]*call|conference\s+call|earnings\s+call|investor\s+(presentation|update|day)|analyst\s+(presentation|day)|business\s+update|earnings\s+(presentation|deck)|regulation\s+fd/i, 'Concall / business update'],
  [/financial\s+results|quarterly\s+results|\bresults\b|earnings\s+release|item\s*2\.02|form\s+10-?q|form\s+10-?k|form\s+20-?f|form\s+40-?f|form\s+6-?k|outcome\s+of\s+(the\s+)?board\s+meeting|press\s+release.*(quarter|results)/i, 'Results'],
  [/\bcapex\b|capital\s+expenditure|capacity|commission(ed|ing)?|commercial\s+(production|operation)|expansion|new\s+(plant|facility|unit|line)|greenfield|brownfield|de-?bottleneck/i, 'Capex / capacity'],
  [/approv(al|ed)\s+(from|by|of\s+(the\s+)?(usfda|fda|cdsco|dcgi|ministry|government|regulator))|\bUSFDA\b|\bFDA\b|\bEIR\b|\bANDA\b|\bCDSCO\b|\bDCGI\b|licen[cs]e|permit|clearance|certification|accredit|patent\s+(grant|granted)|regulatory\s+approval|\bNOC\b/i, 'Regulatory approval'],
  [/guidance|outlook|\btargets?\b|expects?\s+to/i, 'Guidance'],
];

const VAR_TYPE: Record<string, RecentEventType> = {
  order_intake: 'Order win', order_book: 'Order win', book_to_bill: 'Order win', revenue_visibility: 'Order win',
  capacity: 'Capex / capacity', capacity_addition: 'Capex / capacity', utilisation: 'Capex / capacity', new_plant: 'Capex / capacity',
  commissioning: 'Capex / capacity', capacity_bottleneck: 'Capex / capacity', capex: 'Capex / capacity', capex_status: 'Capex / capacity',
  capex_earning: 'Capex / capacity', maintenance_vs_growth: 'Capex / capacity',
  guidance: 'Guidance', management_target: 'Guidance', promise_vs_actual: 'Guidance',
  revenue_growth: 'Results', earnings_growth: 'Results', operating_leverage: 'Results', margin: 'Results',
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

/** The plain-words event type, from the title first, then the extracted
 *  variable, then the discovery kind. Unknown → "Other filing". */
export function eventTypeOf(title: string | null | undefined, variable?: string | null, kind?: string | null): RecentEventType {
  const t = String(title || '');
  for (const [re, ty] of TITLE_RULES) if (re.test(t)) return ty;
  if (variable && VAR_TYPE[variable]) return VAR_TYPE[variable];
  if (kind && KIND_TYPE[kind]) return KIND_TYPE[kind];
  return 'Other filing';
}

// ── source badge ───────────────────────────────────────────────────────────

const PRESS_SOURCE = /\bnews\b|press|media|moneycontrol|economic\s*times|\bET\b|business\s*standard|livemint|\bmint\b|reuters|bloomberg|cnbc|times\s+of|hindu|financial\s+express|yahoo|google|seeking\s+alpha|benzinga|marketwatch|globe\s*newswire|pr\s*newswire|business\s*wire|accesswire/i;
const FILED_SOURCE = /edgar|\bsec\b|\bbse\b|\bnse\b|exchange|filing|screener\.in|company|annual\s+report|investor\s+relations/i;

export function badgeOf(source: string | null | undefined, url?: string | null): SourceBadge {
  const s = String(source || '');
  if (FILED_SOURCE.test(s)) return 'filed';
  const u = String(url || '');
  if (/sec\.gov|bseindia\.com|nseindia\.com|nsearchives/i.test(u)) return 'filed';
  if (PRESS_SOURCE.test(s)) return 'press';
  // Everything the thesis readers take in is a filed document; an unnamed
  // source with no exchange URL is treated as press, never upgraded.
  return s || u ? 'press' : 'filed';
}

// ── thesis touch ───────────────────────────────────────────────────────────

/** Read — never judge — what the existing thesis assessment says about the
 *  variable this event is about. */
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

function combineTouch(list: ThesisTouch[]): ThesisTouch {
  const s = list.includes('supports'), a = list.includes('against');
  if (s && !a) return 'supports';
  if (a && !s) return 'against';
  if (s && a) return 'neutral';
  return list.includes('neutral') ? 'neutral' : 'not assessed';
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

const varLabel = (v: string | null | undefined): string => (v && (VAR_LABEL as Record<string, string>)[v]) || String(v || '').replace(/_/g, ' ');

/** Every dated document and extracted event in an evidence ledger. */
export function rawFromLedger(ticker: string, company: string | null, ledger: any, assessment?: any): RawEvent[] {
  const out: RawEvent[] = [];
  if (!ledger || typeof ledger !== 'object') return out;
  const periods = ledger.periods && typeof ledger.periods === 'object' ? Object.values(ledger.periods) as any[] : [];
  for (const p of periods) {
    const docs: any[] = Array.isArray(p?.documents) ? p.documents : [];
    const byId = new Map<string, any>(docs.map((d) => [String(d?.id || ''), d]));
    for (const d of docs) {
      if (!d?.date_iso) continue;
      out.push({ ticker, company, date: d.date_iso, title: String(d.label || ''), kind: d.kind || null, url: d.url || null, source: d.source || null, origin: 'ledger-doc' });
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
        variable: e.variable || null, figure: fig,
        text: fig ? `${varLabel(e.variable)}: ${fig}` : (quote ? `${varLabel(e.variable)} — “${quote.slice(0, 110)}${quote.length > 110 ? '…' : ''}”` : varLabel(e.variable)),
        thesis: thesisTouchFor(assessment, e.variable), origin: 'ledger-event',
      });
    }
  }
  const pend: any[] = Array.isArray(ledger.pending_documents) ? ledger.pending_documents : [];
  for (const d of pend) {
    if (!d?.date_iso) continue;
    out.push({ ticker, company, date: d.date_iso, title: String(d.label || ''), kind: d.kind || null, url: d.url || null, source: d.source || null, origin: 'pending-doc' });
  }
  return out;
}

/** The items behind persistent catalysts (lib/catalyst/persistence). */
export function rawFromPersistent(ticker: string, company: string | null, pcs: any[] | null | undefined, assessment?: any): RawEvent[] {
  const out: RawEvent[] = [];
  for (const pc of pcs || []) {
    if (pc?.ticker && String(pc.ticker).toUpperCase() !== ticker.toUpperCase()) continue;
    for (const it of [...(pc?.evidence || []), ...(pc?.forward || [])]) {
      const src = (it?.sources || [])[0] || null;
      const date = it?.date || src?.date || null;
      if (!date) continue;
      const fig = figureOf({ before: it.before, after: it.after });
      out.push({
        ticker, company, date, title: String(it.text || ''), variable: it.metric || null,
        text: String(it.text || ''), figure: fig, url: src?.url || null, source: src?.name || null,
        badge: it.origin === 'gainer' ? badgeOf(src?.name, src?.url) : 'filed',
        thesis: thesisTouchFor(assessment, it.metric), origin: 'persistent',
      });
    }
  }
  return out;
}

/** India exchange results feed (the "Update recent reporters" pass). */
export function rawFromFeed(items: Array<{ ticker: string; reported_at: string; subject: string }> | null | undefined, companyOf?: (t: string) => string | null): RawEvent[] {
  return (items || []).filter((x) => x && x.ticker && x.reported_at).map((x) => ({
    ticker: x.ticker, company: companyOf ? companyOf(x.ticker) : null, date: x.reported_at, title: String(x.subject || 'Financial results'),
    kind: 'results', url: null, source: 'NSE exchange filing feed', origin: 'feed' as const,
  }));
}

// ── merge, dedupe, rank ────────────────────────────────────────────────────

const normUrl = (u: string | null | undefined): string => String(u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const normTitle = (t: string): string => clean(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

const TYPE_RANK: Record<RecentEventType, number> = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, i])) as any;

interface Group { ticker: string; date: string; url: string | null; raws: RawEvent[] }

function groupToEvent(g: Group): RecentEvent {
  const docs = g.raws.filter((r) => r.origin !== 'ledger-event' && r.origin !== 'persistent');
  const evs = g.raws.filter((r) => r.origin === 'ledger-event' || r.origin === 'persistent');
  const title = clean((docs[0] || g.raws[0]).title);
  let type = eventTypeOf(title, null, (docs[0] || g.raws[0]).kind || null);
  if (type === 'Other filing' || !docs.length) {
    // No document title to decide — the extracted content decides.
    const v = evs.find((e) => e.variable && VAR_TYPE[e.variable]);
    const byText = evs.length ? eventTypeOf(evs[0].title, evs[0].variable, evs[0].kind) : type;
    type = v ? VAR_TYPE[v.variable as string] : byText;
  }
  const withFig = evs.filter((e) => e.figure);
  const best = withFig.find((e) => e.variable && VAR_TYPE[e.variable] === type) || withFig[0] || evs[0] || null;
  let what = best?.text ? String(best.text) : title;
  if (best && docs.length && title && !/^form\s|^earnings release|^press release/i.test(title)) what = `${title} — ${what}`;
  const more = evs.length - (best ? 1 : 0);
  if (more > 0) what += ` (+${more} more point${more === 1 ? '' : 's'} on the card)`;
  if (what.length > 220) what = `${what.slice(0, 219)}…`;
  const url = g.raws.find((r) => r.url)?.url || null;
  const source = (docs[0] || g.raws.find((r) => r.source) || g.raws[0]).source || null;
  const badges = g.raws.map((r) => r.badge || badgeOf(r.source, r.url));
  const touches = evs.map((e) => e.thesis || 'not assessed');
  const rw = routineReason(title);
  return {
    id: `${g.ticker}|${g.date}|${g.url || normTitle(title)}`,
    date: g.date, ticker: g.ticker, company: g.raws.find((r) => r.company)?.company || null,
    type, title, what: what || '(untitled filing)', figure: best?.figure || null,
    badge: badges.includes('filed') ? 'filed' : 'press',
    url, source, thesis: combineTouch(touches),
    origins: Array.from(new Set(g.raws.map((r) => r.origin))),
    routine: !!rw, routineWhy: rw,
  };
}

/** Pure: merge observations across sources into one row per filing/event. */
export function mergeRaw(raws: RawEvent[]): RecentEvent[] {
  const groups = new Map<string, Group>();
  const noUrl: RawEvent[] = [];
  for (const r of raws) {
    const date = isoDay(r.date);
    if (!date || !r.ticker) continue;
    const t = r.ticker.toUpperCase();
    const u = normUrl(r.url);
    if (!u) { noUrl.push({ ...r, ticker: t, date }); continue; }
    const k = `${t}|${date}|${u}`;
    const g = groups.get(k) || { ticker: t, date, url: u, raws: [] };
    g.raws.push({ ...r, ticker: t, date });
    groups.set(k, g);
  }
  // A URL-less observation (the exchange feed, a persistent item without a
  // link) joins a same-day, same-type row of that name when one exists —
  // the feed's "Financial Results" and the ledger's results PDF are one filing.
  for (const r of noUrl) {
    const ty = eventTypeOf(r.title, r.variable, r.kind);
    const hit = Array.from(groups.values()).find((g) => g.ticker === r.ticker && g.date === r.date
      && eventTypeOf(clean(g.raws[0].title), g.raws[0].variable, g.raws[0].kind) === ty);
    if (hit) { hit.raws.push(r); continue; }
    const k = `${r.ticker}|${r.date}|~${normTitle(r.title)}|${ty}`;
    const g = groups.get(k) || { ticker: r.ticker, date: r.date as string, url: null, raws: [] };
    g.raws.push(r);
    groups.set(k, g);
  }
  const events = Array.from(groups.values()).map(groupToEvent);
  // DUPLICATE FILINGS: the same subject filed twice on one day under two
  // links (NSE and BSE, or a re-upload). Keep the one carrying the most
  // evidence; the others are hidden as routine duplicates.
  const byTitle = new Map<string, RecentEvent[]>();
  for (const e of events) {
    const nt = normTitle(e.title);
    if (!nt) continue;
    const k = `${e.ticker}|${e.date}|${nt}`;
    byTitle.set(k, [...(byTitle.get(k) || []), e]);
  }
  for (const list of byTitle.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.origins.length - a.origins.length || (b.figure ? 1 : 0) - (a.figure ? 1 : 0) || (b.url ? 1 : 0) - (a.url ? 1 : 0));
    for (const d of list.slice(1)) { if (!d.routine) { d.routine = true; d.routineWhy = 'duplicate filing'; } }
  }
  return events;
}

export function sortNewestFirst(a: RecentEvent, b: RecentEvent): number {
  return b.date.localeCompare(a.date) || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.ticker.localeCompare(b.ticker) || a.what.localeCompare(b.what);
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

/** Pure: the whole tab's data from every observation on the page. */
export function buildRecentCatalysts(raws: RawEvent[], today: string, days: number = DEFAULT_WINDOW_DAYS): RecentCatalystResult {
  const all = mergeRaw(raws).sort(sortNewestFirst);
  const windowed = all.filter((e) => inWindow(e.date, today, days));
  const items = windowed.filter((e) => !e.routine);
  const hidden = windowed.filter((e) => e.routine);
  const last = all.find((e) => !e.routine && daysAgo(e.date, today) >= -1) || null;
  return {
    items, hidden, counts: typeCounts(items),
    lastItem: last ? { date: last.date, ticker: last.ticker } : null,
    window: { from: windowStartDay(today, days), to: today, days },
  };
}

/** The browser's local calendar day, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
