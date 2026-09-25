// ═══════════════════════════════════════════════════════════════════════════
// NEWS CONTEXT FOR A GAINER — SECONDARY EVIDENCE, NEVER THE CATALYST. (zzz773)
//
// Screener.in shows five announcements per company, and it sometimes does not
// answer at all. The owner's complaint: 21 of 43 names came back "source
// failed" and stories that move a stock for days or weeks (a large contract,
// a lock-up expiry, a block deal, a broker initiation, an IPO rally) were
// never seen. This file reads dated press coverage for each gainer and turns
// it into:
//   • the headlines themselves, dated and linked (secondary · unverified);
//   • themes (order win, block deal, lock-up, initiation, results, …);
//   • a RUNNING NARRATIVE when one theme recurs across several days — the
//     kind of story that keeps a stock moving long after the filing.
// It never changes the filing verdict and never supplies a number to NET: a
// news line is where to look, not evidence of what happened.
// ═══════════════════════════════════════════════════════════════════════════

import type { StructuredFacts, SourceRef, EventKind } from './structured-facts';
import { emptyEconomics, emptyTime, favourableLegalOutcome } from './structured-facts';
import { moneyCr } from './india-extract';

export interface NewsLite { title: string; url: string; published_at: string; source?: string }

export type NewsTheme =
  | 'order_win' | 'results' | 'guidance' | 'block_deal' | 'lockup' | 'ipo_listing' | 'broker_view'
  | 'fundraise' | 'rating' | 'capacity' | 'acquisition' | 'promoter' | 'dividend_action'
  | 'circuit_momentum' | 'sector_theme' | 'regulatory' | 'management' | 'negative'
  // zzz789: a fund / institution buying or selling shares (13F-style
  // "XYZ Capital acquires new stake in …") — an ownership change, never M&A.
  | 'institutional_holding';

export const THEME_LABEL: Record<NewsTheme, string> = {
  order_win: 'Order / contract', results: 'Results', guidance: 'Guidance / outlook', block_deal: 'Block / bulk deal',
  lockup: 'Lock-in expiry', ipo_listing: 'IPO / listing', broker_view: 'Broker initiation / target', fundraise: 'Fundraise',
  rating: 'Credit rating', capacity: 'Capacity / plant', acquisition: 'M&A', promoter: 'Promoter / stake',
  dividend_action: 'Dividend / corporate action', circuit_momentum: 'Circuit / momentum', sector_theme: 'Sector theme',
  regulatory: 'Approval / regulatory', management: 'Management', negative: 'Negative',
  institutional_holding: 'Institutional holding change',
};

/** zzz789: a fund / institution changing its holding — checked before the M&A
 *  and block-deal rules so "XYZ Capital acquires new stake in Kosmos" is an
 *  ownership change, never an acquisition story (KOS). */
const RX_INSTITUTIONAL = /\b(?:acquires?|acquired|buys?|bought|purchases?|purchased|takes?|took|initiates?|initiated|opens?|opened|establishes|raises?|raised|boosts?|boosted|increases?|increased|adds? to|trims?|trimmed|cuts?|reduces?|reduced|lowers?|lowered|sells?|sold|exits?|decreases?|decreased)\s+(?:a\s+|its\s+|their\s+)?(?:new\s+|additional\s+|\$?[\d.,]+\s*(?:k|m|million|mn)?\s+)?(?:stake|position|holdings?|shares?)\s+(?:in|of)\b|\b(?:shares?|stake|position|holdings?)\s+(?:bought|sold|purchased|acquired|trimmed|raised|lowered|increased|decreased|boosted|reduced)\s+by\b|\b13f\b|\bholdings? (?:raised|lowered|trimmed|boosted|increased|decreased)\b/i;
/** "Shares Bought by Vanguard", "Stake Raised by Invesco" — the passive holding-report form. */
const RX_INST_PASSIVE = /\b(?:shares?|stake|position|holdings?)\s+(?:bought|sold|purchased|acquired|trimmed|raised|lowered|increased|decreased|boosted|reduced|cut|added)\s+by\b/i;
const RX_FUND_WORDS = /\b(capital|advisors?|advisers?|asset management|investment management|management|partners|wealth|fund|funds|llc|l\.l\.c|lp|investments?|securities|bank|trust|group|financial|retirement|pension|holdings? (?:inc|llc))\b/i;
/** M&A needs an M&A word, not "stake in". */
const RX_MNA = /\b(merger|merge with|amalgamat\w*|takeover|take over|buyout|acquisition of (?!(?:a |new |additional )?(?:stake|shares|position))|to acquire (?!(?:a |new |additional )?(?:stake|shares|position))|agrees? to (?:buy|acquire)|deal to (?:buy|acquire)|open offer|tender offer|demerger|business combination)\b/i;

const RULES: Array<[NewsTheme, RegExp]> = [
  ['negative', /\b(gst|tax) (demand|notice|order)|demand notice|show[- ]cause notice|\b(raid|probe|fraud|default|downgrad|resign(s|ed)? as (ceo|md|cfo)|penalty|show[- ]cause|insolven|plunge|slump|crash|tumble|sebi (bans|order))/i],
  ['block_deal', /\bblock deal|bulk deal|change(s)? hands|offload|stake sale|sells? stake|buys? [\d.,]+ (lakh|crore|million)? ?shares/i],
  ['lockup', /lock[- ]?in|lock[- ]?up|anchor (investors?|lock)|shares? unlock/i],
  ['broker_view', /\b(initiat\w+ coverage|target price|price target|\btarget (of )?₹|\bbuy rating|overweight|brokerage|motilal|jefferies|hsbc|kotak inst|nomura|jm financial|nuvama|axis securities|icici securities)/i],
  ['order_win', /\b(order|contract|letter of award|\bLoA\b|work order|bags|wins?|secures?|bagged|awarded)\b.*(₹|rs\.?|crore|cr\b|mn\b|million|billion|order|contract)|order (book|inflow|win)/i],
  ['results', /\b(q[1-4]\s*(fy)?\d{2}|quarter(ly)? results?|net profit|pat (up|rises|jumps)|revenue (up|rises|jumps|grows)|earnings)\b/i],
  ['guidance', /\b(guidance|outlook|targets? (revenue|growth)|expects? (revenue|growth)|revenue target|fy2?\d guidance)\b/i],
  ['ipo_listing', /\b(ipo|listing|lists? at|debut|listing gains?|post[- ]listing|sme ipo|grey market|gmp)\b/i],
  ['fundraise', /\b(qip|preferential (issue|allotment)|rights issue|fund ?rais|raises? ₹|warrants?|ncds?|debentures?)\b/i],
  ['rating', /\b(crisil|icra|care ratings|india ratings|acuite|infomerics|brickwork|credit rating|rating (upgrade|reaffirm)|[abc][+-]? rating)\b/i],
  ['capacity', /\b(capacity|plant|facility|commission\w*|capex|expansion|greenfield|brownfield|mtpa|gw\b|mw\b)\b/i],
  ['acquisition', /\b(acquir\w+|acquisition|merger|amalgamation|takeover|open offer|demerger|stake in)\b/i],
  ['promoter', /\b(promoter (buys|increases|hikes|raises)|creeping acquisition|insider buying|stake (hike|increase))\b/i],
  ['dividend_action', /\b(dividend|bonus|stock split|split|record date|buyback|agm)\b/i],
  ['regulatory', /\b(usfda|approval|approved by|eir|license|licence|patent|clearance|nod)\b/i],
  ['management', /\b(appoint\w*|ceo|cfo|managing director|chairman|joins as)\b/i],
  ['circuit_momentum', /\b(upper circuit|52[- ]week high|record high|hits? high|rall(y|ies)|surges?|zooms?|soars?|jumps?|multibagger|skyrocket)\b/i],
  ['sector_theme', /\b(ai\b|data cent(er|re)s?|defen[cs]e|railway|semiconductor|ev\b|electric vehicle|renewable|solar|green hydrogen|power (sector|demand)|pharma|capital goods|psu)\b/i],
];

/** Generic market-data spam that names the stock but carries no event. */
const JUNK = /latest shareholding|share price (today|live)|stock price (today|live)|session: finishes|level watch|technical (analysis|view)|stocks? to (watch|buy)|top (gainers|losers)|shares? of .* trade|market (live|update|wrap)|sensex|nifty (ends|closes|opens)|intraday|tracxn|marketscreener|investing\.com|moneycontrol quote|stock analysis|peer context/i;

export function themesOf(title: string): NewsTheme[] {
  // zzz789: an institutional holding change is its own theme — never M&A,
  // never a block deal (KOS "institutional share purchase" filed under M&A).
  if (!RX_MNA.test(title) && (RX_INST_PASSIVE.test(title) || (RX_INSTITUTIONAL.test(title) && RX_FUND_WORDS.test(title)))) return ['institutional_holding'];
  const out: NewsTheme[] = [];
  for (const [t, rx] of RULES) if (rx.test(title)) out.push(t);
  // "stake in" alone is not an acquisition story.
  if (out.includes('acquisition') && !RX_MNA.test(title) && !/\b(acquir\w+|acquisition)\b/i.test(title)) out.splice(out.indexOf('acquisition'), 1);
  // zzz789: a favourable legal outcome (appeal allowed, demand reduced / quashed)
  // is resolved, never a negative story (PRIORITY).
  if (out.includes('negative') && favourableLegalOutcome(title)) { out.splice(out.indexOf('negative'), 1); if (!out.includes('regulatory')) out.push('regulatory'); }
  return out;
}

// ── zzz789: ENTITY IDENTITY ────────────────────────────────────────────────
// A headline is about THIS company only on strong identity: the full company
// name (two or more significant words together), a single-word name WITH a
// corporate suffix or stock context ("Arvind Ltd", "Arvind shares"), or the
// ticker in exchange form ("NSE: ARVIND", "(NASDAQ: KOS)", "$KOS"). A bare
// first name / surname token is not identity: "Arvind Kejriwal" is a person,
// not Arvind Ltd.
const CORP_SUFFIX = /^(ltd|limited|inc|incorporated|corp|corporation|plc|llc|pvt|private|co|company|group|holdings|industries|enterprises)\b\.?/i;
const STOCK_CONTEXT = /^(?:ltd\b|limited\b|inc\b|corp\b|plc\b|shares?\b|stock\b|share price\b|scrip\b|q[1-4]\b|results?\b|board\b|arm\b|unit\b|subsidiary\b|'s\s+(?:q[1-4]|shares?|stock|board|results?|profit|revenue|order|plant|arm|unit)\b)/i;
const EVENT_WORD = /^(?:block|bulk|deal|deals|order|orders|shares?|stock|q[1-4]|results?|bags|bagged|wins?|won|secures?|stake|board|ipo|plant|profit|net|revenue|rating|target|signs|acquires|launches|posts|reports|surges?|jumps?|rall(?:y|ies)|falls?|hits?|gains?|soars?|slumps?|zooms?|commissions|announces|receives|allots|arm|unit|subsidiary|dividend|bonus|buyback|capex|expansion|approval|q[1-4]fy\d*|fy\d+)$/i;
const PERSON_CONTEXT = /\b(?:cm|chief minister|minister|mla|mp|aap|bjp|congress|politic\w*|election|leader|actor|actress|director of the film|cricketer|singer|kejriwal|gandhi|modi|arrest\w*|bail|jail)\b/i;
const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STOP_NAME = new Set(['ltd', 'limited', 'india', 'the', 'and', 'of', 'co', 'company', 'corporation', 'corp', 'inc', 'plc', 'llc', 'private', 'pvt', 'holdings', 'group']);
/** The company's name without the corporate suffix, as words. */
export function baseNameWords(company: string | null): string[] {
  return String(company || '').replace(/&amp;/g, '&').replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z0-9&' ]/g, ' ').split(/\s+/).filter(Boolean)
    .filter((w, i, a) => !(STOP_NAME.has(w.toLowerCase()) && (i === a.length - 1 || i === a.length - 2 && STOP_NAME.has(a[a.length - 1].toLowerCase()))));
}
export function entityMatch(title: string, ticker: string, company: string | null): { ok: boolean; why: string } {
  const t = String(title || '');
  const T = String(ticker || '').toUpperCase();
  // 1. exchange-form ticker
  if (T && !/^\d+$/.test(T) && new RegExp(`(?:\\b(?:NSE|BSE|NYSE|NASDAQ|Nasdaq|NYSEAMERICAN|NYSE American|AMEX|OTC)\\s*[:\\-]\\s*${escRx(T)}\\b|\\$${escRx(T)}\\b|\\(${escRx(T)}\\))`).test(t)) return { ok: true, why: 'ticker (exchange form)' };
  const words = baseNameWords(company).filter((w) => w !== '&');
  // 2. full name: the first two significant words together
  if (words.length >= 2) {
    const [a, b] = words;
    // zzz803: an auto-generated headline clips the name ("Taneja Aerospac Consolidated June 2026 Net Sales …"):
    // the second word may be cut short, never below six letters of it.
    const bRx = b.length >= 8 ? `${escRx(b.slice(0, 6))}[a-z]{0,${b.length - 6}}` : escRx(b);
    const rx = new RegExp(`\\b${escRx(a)}\\s+(?:&\\s+)?${bRx}\\b`, 'i');
    if (rx.test(t)) return { ok: true, why: 'company name' };
  }
  // 3. a distinctive all-caps ticker (4+ letters, not a word of the name) as a token
  if (T.length >= 4 && !/^\d+$/.test(T) && !words.some((w) => w.toUpperCase() === T) && new RegExp(`\\b${escRx(T)}\\b`).test(t)) return { ok: true, why: 'ticker' };
  // 4. the first name word alone: only with a suffix / stock or event context,
  //    never followed by a capitalised non-company word (a person's surname:
  //    "Arvind Kejriwal", "Raymond James") and never in a political / personal context.
  const first = words[0];
  if (first && first.length >= 3) {
    const rx = new RegExp(`\\b${escRx(first)}\\b`, 'gi');
    for (const m of Array.from(t.matchAll(rx))) {
      const after = t.slice((m.index || 0) + m[0].length).replace(/^\s+/, '');
      if (CORP_SUFFIX.test(after) || STOCK_CONTEXT.test(after)) return { ok: true, why: 'company name + suffix / stock context' };
      const next = /^([A-Za-z][\w'’-]*)/.exec(after)?.[1] || '';
      const before = t.slice(0, m.index || 0).trim().split(/\s+/).pop() || '';
      const personLike = (/^[A-Z]/.test(next) && !EVENT_WORD.test(next) && !words.slice(1).some((w) => w.toLowerCase() === next.toLowerCase()))
        || (/^[A-Z][a-z]+$/.test(before) && !/^(?:The|A|An|How|Why|What|When|Will|Can|Is|Are|Should|After|Before|As|On|In|At|For|From|With)$/.test(before) && m.index !== 0);
      if (!personLike && !PERSON_CONTEXT.test(t)) return { ok: true, why: 'company name (distinctive word, no person / other-entity context)' };
    }
  }
  return { ok: false, why: first ? `"${first}" alone is not the company (could be a person or another entity)` : 'no identity' };
}

/** zzz789: the press search phrase. A one-word name ("Arvind") searched alone
 *  returns people and places; it is searched with a stock word instead. */
export function newsQueryFor(ticker: string, name: string | null, market: 'IN' | 'US'): string {
  const raw0 = String(name || '').trim();
  // "Jay Bharat Maru." is a clipped name; "Kosmos Energy Ltd." is a suffix, not an abbreviation.
  const abbreviated = /\.$/.test(raw0) && !/\b(ltd|inc|corp|co|plc|llc)\.$/i.test(raw0);
  const clean = raw0.replace(/\s+\S+\.$/, abbreviated ? '' : '$&').replace(/\b(ltd|limited|inc|corp|corporation|plc|holdings)\b\.?,?/gi, '').replace(/[.,]+$/, '').replace(/\s+/g, ' ').trim();
  const oneWord = clean.split(' ').filter(Boolean).length === 1;
  const stockWord = market === 'IN' ? 'share' : 'stock';
  return clean.length >= 4 ? `"${clean}"${abbreviated || oneWord ? ` ${stockWord}` : ''} when:45d` : `${ticker} ${stockWord} when:45d`;
}

/** Tokens that must appear in a headline for it to be about THIS company. */
export function nameTokens(ticker: string, company: string | null): string[] {
  const stop = new Set(['ltd', 'limited', 'india', 'the', 'and', 'of', 'co', 'company', 'corporation', 'industries', 'inds', 'ind', 'solutions', 'technologies', 'tech', 'services', 'global', 'international', 'enterprises', 'group', 'holdings', 'private', 'pvt', 'systems']);
  const words = String(company || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w));
  const t = /^\d+$/.test(ticker) ? [] : [ticker.toLowerCase()];
  return Array.from(new Set([...words.slice(0, 2), ...t]));
}

export interface NewsContext {
  items: Array<{ title: string; url: string; date: string; source: string; themes: NewsTheme[];
    /** zzz785: always true — press is secondary until an official filing confirms it. */
    secondary?: boolean;
    /** zzz785: the official filing that states the same event, when one was read. */
    confirmedBy?: { url: string | null; date: string | null; title: string } | null }>;
  themes: Array<{ theme: NewsTheme; label: string; count: number; firstDate: string; lastDate: string }>;
  /** A theme covered on ≥2 different days within the window — a story that keeps running. */
  narrative: { theme: NewsTheme; label: string; count: number; days: number; firstDate: string; lastDate: string; lead: string } | null;
  windowDays: number;
  fetched: number;
  query: string;
}

export function buildNewsContext(raw: NewsLite[], opts: { ticker: string; company: string | null; now: Date; windowDays?: number; query?: string }): NewsContext {
  const windowDays = opts.windowDays ?? 45;
  const cutoff = opts.now.getTime() - windowDays * 86_400_000;
  const toks = nameTokens(opts.ticker, opts.company);
  const seen = new Set<string>();
  const items: NewsContext['items'] = [];
  const nameWords = String(opts.company || '').replace(/\b(ltd|limited)\b\.?/gi, '').replace(/[^A-Za-z0-9& ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const nameRx = nameWords.length ? new RegExp(`\\b(${nameWords.map((w) => w.replace(/[&]/g, '\\&')).join('|')})\\b`, 'gi') : null;
  for (const n of raw) {
    const t = Date.parse(n.published_at);
    if (!Number.isFinite(t) || t < cutoff || t > opts.now.getTime() + 86_400_000) continue;
    // Google News appends " - Publisher"; the publisher is the source.
    const m = /^(.*?)(?:\s+-\s+([^-]{2,60}))?$/.exec(n.title.trim());
    const title = (m?.[1] || n.title).trim();
    const source = (m?.[2] || n.source || '').trim();
    const low = title.toLowerCase();
    if (JUNK.test(n.title)) continue;
    if (toks.length && !toks.some((k) => low.includes(k))) continue;
    // zzz789: strong entity identity — never a bare first name / surname (ARVIND ≠ Arvind Kejriwal).
    if (!entityMatch(title, opts.ticker, opts.company).ok) continue;
    const key = low.replace(/[^a-z0-9]/g, '').slice(0, 70);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Theme on the headline with the company's own name removed: "Kavveri
    // Defence … falls 8%" is not defence-sector news.
    const bare = nameRx ? title.replace(nameRx, ' ') : title;
    items.push({ title: title.slice(0, 180), url: n.url, date: new Date(t).toISOString().slice(0, 10), source, themes: themesOf(bare) });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  const by = new Map<NewsTheme, { n: number; dates: Set<string>; first: string; last: string; lead: string }>();
  for (const it of items) for (const th of it.themes) {
    const e = by.get(th) || { n: 0, dates: new Set<string>(), first: it.date, last: it.date, lead: it.title };
    e.n++; e.dates.add(it.date);
    if (it.date < e.first) e.first = it.date;
    if (it.date > e.last) { e.last = it.date; e.lead = it.title; }
    by.set(th, e);
  }
  const themes = Array.from(by.entries()).map(([theme, e]) => ({ theme, label: THEME_LABEL[theme], count: e.n, firstDate: e.first, lastDate: e.last }))
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  // Momentum commentary is not a story in itself; a sector word alone is not
  // company news. Either can still be the narrative when nothing else recurs.
  const weak = new Set<NewsTheme>(['circuit_momentum', 'sector_theme', 'management', 'dividend_action']);
  // zzz789: routine institutional holding reports are never a running story.
  const cands = Array.from(by.entries()).filter(([th, e]) => e.dates.size >= 2 && th !== 'institutional_holding')
    .sort(([ta, a], [tb, b]) => Number(weak.has(ta)) - Number(weak.has(tb)) || b.dates.size - a.dates.size || b.last.localeCompare(a.last) || b.n - a.n);
  const top = cands[0];
  const narrative = top ? { theme: top[0], label: THEME_LABEL[top[0]], count: top[1].n, days: top[1].dates.size, firstDate: top[1].first, lastDate: top[1].last, lead: top[1].lead } : null;
  return { items: items.slice(0, 6), themes: themes.slice(0, 6), narrative, windowDays, fetched: raw.length, query: opts.query || '' };
}

/** The full legal name from a screener.in company page title. */
export function companyNameFromPage(html: string): string | null {
  const m = /<title>\s*([^<|]+?)\s+share price/i.exec(html) || /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i.exec(html);
  return m ? m[1].replace(/&amp;/g, '&').trim() : null;
}

// ── zzz785: PRESS AS STRUCTURED FACTS — SECONDARY, VERIFICATION REQUIRED ────

const THEME_KIND: Partial<Record<NewsTheme, EventKind>> = {
  order_win: 'order', fundraise: 'fundraising', capacity: 'capacity', acquisition: 'acquisition', regulatory: 'qualification',
  results: 'results', guidance: 'guidance', rating: 'other', promoter: 'promoter_buying',   // zzz787: a promoter buying is not a strategic stake
};

export interface PressFacts extends StructuredFacts {
  polarity: 'positive' | 'negative' | 'neutral';
  headline: string;
  secondary: true;
  confirmedBy: { url: string | null; date: string | null; title: string } | null;
}

const tok = (s: string | null | undefined) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !/^(limited|india|indian|order|orders|crore|leading|private|company)$/.test(w)));
const days = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.abs(Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86_400_000 : Infinity);

/** Each dated headline that names an event, as a SECONDARY fact. When a read
 *  official filing states the same event (same kind and the same value,
 *  counterparty or date ±3 days), the press item is marked confirmed-by it. */
export function pressFacts(news: NewsContext, issuer: string, official: StructuredFacts[]): { facts: PressFacts[]; refs: SourceRef[]; news: NewsContext } {
  const out: PressFacts[] = [];
  const refs: SourceRef[] = [];
  const offs = official.filter((f) => f.source.kind !== 'PRESS');
  const items = news.items.map((it) => {
    const negTax = it.themes.includes('negative') && /\b(gst|tax|demand|show[- ]cause)\b/i.test(it.title) && !favourableLegalOutcome(it.title);
    const theme = it.themes.find((t) => THEME_KIND[t]) || (negTax ? 'negative' : null);
    const newSub = /\bincorporat\w*[^.]{0,40}subsidiary|subsidiary[^.]{0,40}incorporat/i.test(it.title);
    const kind: EventKind | null = negTax ? 'tax_litigation' : newSub ? 'strategic_expansion' : theme === 'negative' ? 'regulatory_negative' : theme ? THEME_KIND[theme]! : null;
    const value = moneyCr(it.title);
    let confirmedBy: PressFacts['confirmedBy'] = null;
    if (kind) {
      const mine = tok(it.title);
      const hit = offs.find((f) => {
        if (f.event.kind !== kind) return false;
        const fv = f.economics.valueNative ?? f.economics.considerationNative ?? f.economics.capex;
        if (value != null && fv != null) return Math.abs(value - fv) <= Math.max(0.05, fv * 0.02);
        const cp = tok(`${f.event.counterparty || ''} ${f.event.product || ''}`);
        if (Array.from(cp).some((w) => mine.has(w))) return true;
        return days(f.source.date, it.date) <= 3;
      });
      if (hit) confirmedBy = { url: hit.source.url ?? null, date: hit.source.date, title: hit.source.title };
    }
    const src: SourceRef = { kind: 'PRESS', access: 'SUMMARY_ONLY', issuer, date: it.date, url: it.url, title: `${it.title}${it.source ? ` — ${it.source}` : ''}`.slice(0, 160) };
    refs.push(src);
    if (kind && out.length < 6) {
      const economics = emptyEconomics();
      if (value != null) { economics.valueNative = value; economics.currency = 'INR_CR'; }
      out.push({
        source: src, event: { kind, counterparty: null, product: null, geography: null, stage: null }, economics, time: emptyTime(),
        quotes: [], unknowns: ['Press report — not verified against an official filing.', ...(confirmedBy ? [] : ['No official filing read that states the same event.'])],
        verificationRequired: true, polarity: kind === 'tax_litigation' || kind === 'regulatory_negative' ? 'negative' : ['order', 'capacity', 'qualification', 'acquisition', 'partnership', 'stake_by_strategic', 'strategic_investment', 'promoter_buying'].includes(kind) ? 'positive' : 'neutral',
        headline: it.title, secondary: true, confirmedBy,
      });
    }
    return { ...it, secondary: true, confirmedBy };
  });
  return { facts: out, refs, news: { ...news, items } };
}
