// zzz843 — Guidance Upgrades: maps EXISTING internal feeds into GuCandidate. Pure (no I/O of its own), so it can be tested.
// Sources: the news article cache, the concall/exchange filing feed cache, the India graded-results cache,
// and the US graded-results cache (KV `us-graded:<engine>:<date>|1`, gzip). Nothing here fetches a document,
// imports a price module, or calls an AI model.
import { gunzipSync } from 'zlib';
import type { GuCandidate, GuContext, GuMarket, GuWindow, GuidanceEvent, GuScanStatus, GuScanState } from './guidance-upgrades-types';
import { buildGuidanceEvent, isGuidanceUpgradeCandidate, mergeCandidates, rank, withinWindow } from './guidance-upgrades';

const WINDOWS: GuWindow[] = ['24H', '3D', '7D', '14D', '30D', '120D'];
/** Missing or unknown window falls back to 7D. */
export function parseWindow(v: string | null | undefined): GuWindow {
  const u = String(v ?? '').trim().toUpperCase();
  return (WINDOWS as string[]).includes(u) ? (u as GuWindow) : '7D';
}
export type MarketFilter = 'IN' | 'US' | 'ALL';
export function parseMarket(v: string | null | undefined): MarketFilter {
  const u = String(v ?? '').trim().toUpperCase();
  return u === 'IN' || u === 'US' ? u : 'ALL';
}
export function lookbackDays(w: GuWindow): number {
  return w === '24H' ? 1 : w === '3D' ? 3 : w === '7D' ? 7 : w === '14D' ? 14 : w === '120D' ? 120 : 30;
}
/** Longest window a date list may cover (120D + the 1-day edge). Lists for windows up to 30D are exactly as before. */
export const MAX_LIST_DAYS = 130;
/** Live source scans stay bounded: a window longer than this is served from the persisted event store plus a bounded live scan. */
export const LIVE_SCAN_MAX_DAYS = 30;

const clean = (s: unknown, max = 1500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ── India time: exchanges publish in IST, RSS in RFC 822 (sometimes '... IST'), some rows carry no zone at all ──────────────
const IST_MIN = 330;
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const utcFrom = (y: number, mo: number, d: number, h: number, mi: number, sec: number, zoneMin: number): string | null => {
  const t = Date.UTC(y, mo, d, h, mi, sec) - zoneMin * 60_000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/**
 * Tolerant timestamp parser. ISO and RFC 822 with an explicit zone go through Date.parse. A trailing 'IST' is read as +05:30.
 * A zone-less 'DD-Mon-YYYY HH:mm:ss' (NSE style) or 'YYYY-MM-DD HH:mm:ss' is exchange local time, so it is read in `naiveZoneMin`
 * (IST by default) instead of the server's zone. Date-only input becomes 00:00 UTC of that date (callers that need the date
 * itself keep the original string).
 */
export function parseWhen(v: unknown, naiveZoneMin: number = IST_MIN): string | null {
  let s = String(v ?? '').trim();
  if (!s) return null;
  s = s.replace(/\s*\(?\bIST\b\)?\s*$/i, ' +0530');
  let m = s.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3,9})[-\s\/](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo !== undefined) return utcFrom(+m[3], mo, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), naiveZoneMin); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (m) return utcFrom(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), naiveZoneMin);
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return utcFrom(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), naiveZoneMin);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
const iso = (s: unknown): string | null => parseWhen(s, 0);
/** YYYY-MM-DD of an instant in IST (the Indian trading/announcement day). */
export const istDate = (d: Date): string => new Date(d.getTime() + IST_MIN * 60_000).toISOString().slice(0, 10);
/** IST calendar days, today first. India graded sessions and exchange announcements are keyed by the IST day. */
export function istDateList(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(days, MAX_LIST_DAYS); i++) out.push(istDate(new Date(now.getTime() - i * 86_400_000)));
  return out;
}
const tick = (s: unknown): string | undefined => { const t = String(s ?? '').trim().toUpperCase().replace(/\.(NS|BO)$/, ''); return t || undefined; };

const hostOf = (u: unknown): string => { try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const isSecUrl = (u: unknown): boolean => { const h = hostOf(u); return h === 'sec.gov' || h.endsWith('.sec.gov'); };
/** Wires that publish the COMPANY'S OWN release (issuer-paid). Reuters, Yahoo, Benzinga etc. are not here on purpose. */
const WIRE_HOSTS = ['businesswire.com', 'prnewswire.com', 'globenewswire.com', 'accesswire.com', 'newsfilecorp.com'];
const WIRE_NAME_RE = /\b(business ?wire|pr ?newswire|globe ?newswire|accesswire|newsfile)\b/i;
export function isCompanyWire(sourceName: unknown, url: unknown): boolean {
  const h = hostOf(url);
  if (h && WIRE_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  return WIRE_NAME_RE.test(String(sourceName || '')) && !/\b(yahoo|reuters|benzinga|seeking ?alpha|marketwatch)\b/i.test(String(sourceName || ''));
}

// ═══════════════════════════════════════════════════════════════════════════
// India company -> NSE symbol. Indian headlines name the company ("Cupid raises FY27 guidance"), and the news pipeline's
// `ticker_symbols` is built from ALL-CAPS words in the headline (so it can hold "AGM" or "NSE" and miss the company).
// The index below is built by the route from data the app already holds: the NSE symbol catalog (KV `symbolmaster:catalog`),
// the curated NSE_TICKER_NAMES map, and every (symbol, company_name) pair in the filing / results rows it read this request.
// Nothing here names a company or a ticker.
// ═══════════════════════════════════════════════════════════════════════════
export interface CompanyIndex {
  /** normalised company name -> NSE symbol; null = two symbols share that name (ambiguous, never guessed) */
  names: Map<string, string | null>;
  /** every NSE-style symbol seen */
  known: Set<string>;
  maxWords: number;
  size: number;
}
const SYMBOL_OK = /^[A-Z0-9][A-Z0-9&-]{0,19}$/;
/** NSE symbol shape; a pure-digit code is a BSE scrip code, not an NSE symbol. */
export const isNseSymbol = (t: unknown): boolean => { const u = String(t ?? '').trim().toUpperCase(); return SYMBOL_OK.test(u) && !/^\d+$/.test(u); };
export function normCompanyName(s: unknown): string {
  let t = String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const n = t.replace(/\s+(?:limited|ltd|pvt|private|plc|inc|corporation|corp|co)$/, '').trim();
    if (n === t) break; t = n;
  }
  return t;
}
export function buildCompanyIndex(pairs: Iterable<{ symbol?: unknown; name?: unknown }>): CompanyIndex {
  const names = new Map<string, string | null>(); const known = new Set<string>(); let maxWords = 1;
  const put = (key: string, sym: string) => {
    if (key.length < 3) return;
    const cur = names.get(key);
    if (cur === undefined) names.set(key, sym); else if (cur !== sym) names.set(key, null);
    maxWords = Math.max(maxWords, key.split(' ').length);
  };
  for (const p of pairs) {
    const sym = String(p?.symbol ?? '').trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!isNseSymbol(sym)) continue;
    known.add(sym);
    const base = normCompanyName(p?.name);
    if (!base) continue;
    put(base, sym);
    const noIndia = base.replace(/\s+india$/, '').trim();
    if (noIndia && noIndia !== base) put(noIndia, sym);
  }
  return { names, known, maxWords: Math.min(maxWords, 7), size: names.size };
}
/** Words that are a whole company name only by accident ("India", "Bank"); never matched as a single-word name. */
const GENERIC_WORD = new Set(['india', 'indian', 'bank', 'group', 'global', 'power', 'steel', 'gold', 'energy', 'capital', 'finance', 'industries', 'international', 'technologies', 'company', 'corporation', 'holdings', 'infra', 'ventures', 'enterprises', 'trading', 'foods', 'oil', 'gas', 'green', 'new', 'first', 'national', 'united', 'sector', 'stock', 'stocks', 'shares', 'market', 'markets']);
/** Institutions and generic actors that raise forecasts but are not listed companies with company guidance. */
const NON_COMPANY = /^(?:rbi|sebi|imf|oecd|adb|fed|ecb|government|govt|centre|center|ministry|cabinet|brokerage|brokerages|analysts?|world bank|moody'?s|fitch|crisil|icra|care ratings|s&p|goldman sachs|morgan stanley|jefferies|nomura|citi|hsbc|ubs|kotak institutional equities|motilal oswal|icici securities|sensex|nifty|india inc)$/i;

export interface ResolvedCompany { ticker?: string; company?: string; how: 'article-ticker' | 'exchange-tag' | 'name' | 'headline' | 'none' }
const RAISE_VERB_HEAD = /\b(?:raises?|raised|hikes?|hiked|lifts?|lifted|upgrades?|upgraded|increases?|increased|revises?|revised|boosts?|boosted|ups|now\s+(?:expects?|sees?|targets?|guides?|projects?)|expects?|sees|targets?|guides?|aims?|plans?|sets?|announces?)\b/i;
/** Best-effort company name from the words in front of the first raise verb of a headline. Never invents a ticker. */
export function companyFromHeadline(title: string): string | undefined {
  const t = clean(title, 300).replace(/^[\s"'“‘\[\(]+/, '');
  const m = RAISE_VERB_HEAD.exec(t);
  if (!m || m.index < 2) return undefined;
  let head = t.slice(0, m.index).trim();
  head = head.split(/\s*[:|–—]\s+/).pop() || head;              // "Stocks to watch: Cupid" -> "Cupid"
  head = head.replace(/[,;]+$/, '').replace(/\s+(?:shares?|stock|share price)$/i, '').trim();
  const words = head.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return undefined;
  if (!/^[A-Z0-9]/.test(words[0])) return undefined;
  if (NON_COMPANY.test(head) || (words.length === 1 && GENERIC_WORD.has(words[0].toLowerCase()))) return undefined;
  return head;
}
const EXCH_TAG = /\b(?:NSE|BSE)\s*[:\-]\s*([A-Z0-9][A-Z0-9&-]{1,19})\b/g;
const PAREN_SYM = /\(([A-Z0-9][A-Z0-9&-]{1,19})\)/g;
/** Find the company a headline is about. Order: the article's own ticker if the index knows it, an exchange tag, a company name in the headline. */
export function resolveCompany(title: string, lead: string, articleTickers: readonly string[], idx?: CompanyIndex): ResolvedCompany {
  const fallbackName = companyFromHeadline(title);
  if (!idx || (!idx.known.size && !idx.names.size)) return { company: fallbackName, how: fallbackName ? 'headline' : 'none' };
  for (const raw of articleTickers) { const t = String(raw ?? '').trim().toUpperCase().replace(/\.(NS|BO)$/, ''); if (t && idx.known.has(t)) return { ticker: t, company: fallbackName, how: 'article-ticker' }; }
  const hay = `${title} ${lead}`;
  for (const re of [EXCH_TAG, PAREN_SYM]) { re.lastIndex = 0; let m: RegExpExecArray | null; while ((m = re.exec(re === PAREN_SYM ? title : hay)) !== null) if (idx.known.has(m[1])) return { ticker: m[1], company: fallbackName, how: 'exchange-tag' }; }
  const scan = (text: string, maxStart: number): { sym: string; name: string } | null => {
    const toks = text.match(/[A-Za-z0-9&'.-]+/g) || [];
    for (let n = Math.min(idx.maxWords, toks.length); n >= 1; n--) {
      for (let i = 0; i + n <= toks.length && i <= maxStart; i++) {
        const first = toks[i];
        if (!/^[A-Z0-9]/.test(first)) continue;
        const name = toks.slice(i, i + n).join(' ');
        const key = normCompanyName(name);
        if (n === 1 && (key.length < 4 || GENERIC_WORD.has(key))) continue;
        const sym = idx.names.get(key);
        if (sym) return { sym, name };
      }
    }
    return null;
  };
  const inTitle = scan(title, 99);
  if (inTitle) return { ticker: inTitle.sym, company: inTitle.name, how: 'name' };
  const inLead = scan(clean(lead, 160), 1);   // the summary only when it OPENS with the company name
  if (inLead) return { ticker: inLead.sym, company: inLead.name, how: 'name' };
  return { company: fallbackName, how: fallbackName ? 'headline' : 'none' };
}

const INDIAN_NEWS_HOSTS = ['livemint.com', 'business-standard.com', 'economictimes.indiatimes.com', 'moneycontrol.com', 'ndtvprofit.com', 'financialexpress.com', 'businesstoday.in', 'thehindubusinessline.com', 'cnbctv18.com', 'whalesbook.com', 'multibagg.com', 'retailintel.in', 'tradingview.com', 'screener.in', 'trendlyne.com', 'scanx.trade'];

/**
 * One news-cache article -> candidate.
 * `idx` (India company index) is optional: without it the article's own primary_ticker / ticker_symbols[0] is used as before.
 * With it, an India or unlabelled article is attached to an NSE symbol by company name when the pipeline's own ticker is missing
 * or is not a real NSE symbol (e.g. 'AGM'). When no symbol can be found the candidate keeps the company name and ticker stays
 * undefined, so the route can show it labelled 'ticker not resolved'.
 */
export function newsToCandidate(a: any, idx?: CompanyIndex): GuCandidate | null {
  const region = String(a?.region || '').toUpperCase();
  let market: GuMarket = region === 'IN' || region === 'INDIA' ? 'IN' : region === 'US' || region === 'USA' ? 'US' : 'GLOBAL';
  const url = a?.source_url || a?.url || undefined;
  const publishedAt = parseWhen(a?.published_at ?? a?.publishedAt ?? a?.pubDate, market === 'US' ? 0 : IST_MIN);
  const title = clean(a?.title || a?.headline, 300);
  if (!publishedAt || !title) return null;
  const tickers: string[] = Array.isArray(a?.ticker_symbols) ? a.ticker_symbols : Array.isArray(a?.tickers) ? a.tickers : [];
  const summary = clean(a?.summary ?? a?.snippet);
  let ticker: string | undefined; let company: string | undefined;
  if (idx && market !== 'US') {
    const r = resolveCompany(title, summary, [a?.primary_ticker, ...tickers].filter(Boolean), idx);
    ticker = r.ticker; company = r.company;
    if (market === 'GLOBAL' && (r.ticker || INDIAN_NEWS_HOSTS.some((h) => { const x = hostOf(url); return x === h || x.endsWith(`.${h}`); }))) market = 'IN';
  } else ticker = tick(a?.primary_ticker || tickers[0]);
  const sourceName = clean(a?.source_name || a?.source || 'News', 80);
  // PRIMARY only when the item IS the company's own document: the SEC's own site, or a wire release that names a company.
  const kind: GuCandidate['kind'] = isSecUrl(url) ? 'FILING' : ticker && isCompanyWire(sourceName, url) ? 'RELEASE' : 'NEWS';
  const cand: GuCandidate = { id: `news:${a?.id ?? title.slice(0, 40)}`, ticker, market, title, text: summary, url, sourceName, publishedAt, kind };
  if (company) cand.company = clean(company, 120);
  return cand;
}

const djb = (s: string): string => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
/** One entry of `scraped-india-news:v1:latest` ({ title, url, source, publishedAt, snippet }) -> India news candidate. */
export function scrapedNewsToCandidate(s: any, idx?: CompanyIndex): GuCandidate | null {
  if (!s || !s.title) return null;
  return newsToCandidate({ id: `scraped-${djb(String(s.url || s.title))}`, title: s.title, summary: s.snippet, source_name: s.source || 'India news', source_url: s.url, published_at: s.publishedAt, region: 'IN' }, idx);
}

/** Every text field a filing / concall-feed row can carry. The exchange subject is usually administrative; the scored excerpts are where a company says what it expects. */
function filingText(f: any): string {
  const parts: unknown[] = [f?.detail, f?.headline, f?.summary, f?.excerpt, f?.attchmntText];
  if (Array.isArray(f?.evidence_excerpts)) parts.push(...f.evidence_excerpts);
  if (Array.isArray(f?.bullish_excerpts)) parts.push(...f.bullish_excerpts);
  const b = f?.bullish;
  if (b && Array.isArray(b.evidence)) for (const e of b.evidence) if (e && e.polarity !== 'BEAR' && !e.negated) parts.push(e.text);
  if (b && Array.isArray(b.bullish_phrases)) parts.push(...b.bullish_phrases);
  if (f?.evidence && Array.isArray(f.evidence.numeric_examples)) parts.push(...f.evidence.numeric_examples);
  const seen = new Set<string>(); const out: string[] = [];
  for (const p of parts) { const t = clean(p, 500); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return clean(out.join(' '), 2500);
}

export function filingToCandidate(f: any, idx?: CompanyIndex): GuCandidate | null {
  const publishedAt = parseWhen(f?.filing_datetime ?? f?.filing_date ?? f?.an_dt ?? f?.NEWS_DT, IST_MIN);
  const title = clean(f?.subject, 300);
  if (!publishedAt || !title) return null;
  const company = clean(f?.company_name, 120) || undefined;
  // A BSE row's symbol is a numeric scrip code, which is not an NSE symbol: resolve by company name or leave the ticker empty.
  let ticker = isNseSymbol(f?.symbol) ? tick(f?.symbol) : undefined;
  if (!ticker && idx && company) { const r = resolveCompany(company, '', [], idx); ticker = r.ticker; }
  return {
    id: `filing:${f?.content_hash ?? `${f?.exchange}:${f?.symbol}:${publishedAt}`}`,
    ticker, company, market: 'IN',
    title, text: filingText(f), url: (Array.isArray(f?.attachment_urls) && f.attachment_urls[0]) || f?.source_url || undefined,
    sourceName: `${f?.exchange || 'Exchange'} filing`, publishedAt, kind: 'FILING',
  };
}

/** The six text fields the India grader itself reads for forward guidance (see earnings-grade-shared / india-grade). */
const GRADED_TEXT_FIELDS = ['guidance_text', 'narrative_text', 'announcement_text', 'attachment', 'headline', 'title'] as const;
/** One India graded results row. Its guidance text is the company's own words. */
export function gradedRowToCandidate(r: any, fallbackDate: string): GuCandidate | null {
  const seen = new Set<string>(); const parts: string[] = [];
  for (const f of GRADED_TEXT_FIELDS) { const t = clean(r?.[f], 700); if (t && !seen.has(t)) { seen.add(t); parts.push(t); } }
  const text = clean(parts.join(' '), 2500);
  if (!text) return null;
  // the overlay's own verdict: a row it marked as a CUT is not a raise candidate
  if (r?.guidance_lowered === true && r?.guidance_raised !== true) return null;
  const fd = String(r?.filing_date ?? '').trim();
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(fd) ? fd : parseWhen(fd, IST_MIN) || (/^\d{4}-\d{2}-\d{2}$/.test(fallbackDate) ? fallbackDate : parseWhen(fallbackDate, IST_MIN));
  if (!publishedAt) return null;
  const sym = tick(r?.symbol ?? r?.ticker);
  // the boolean is added to the headline only when the text itself reads as a raise (the overlay also counts 'record order book' as a raise)
  const flagged = r?.guidance_raised === true && looksLikeGuidanceRaise(text);
  return {
    id: `graded:${sym ?? r?.company}:${publishedAt.slice(0, 10)}`,
    ticker: sym, company: clean(r?.company, 120) || undefined, market: 'IN',
    title: `${clean(r?.company || r?.symbol, 80)} results${flagged ? ': guidance raised' : ''}`,
    text, url: r?.source_url || undefined, sourceName: 'Exchange results filing', publishedAt, kind: 'FILING',
  };
}

export function collectGradedRows(payload: any): any[] {
  if (!payload?.by_tier || typeof payload.by_tier !== 'object') return [];
  const out: any[] = [];
  for (const k of Object.keys(payload.by_tier)) if (Array.isArray(payload.by_tier[k])) out.push(...payload.by_tier[k]);
  return out;
}

export function dateList(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(days, MAX_LIST_DAYS); i++) out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Same ticker + same headline start = one candidate. First seen wins (filings are added before news). */
export function dedupeCandidates(list: GuCandidate[]): GuCandidate[] {
  const seen = new Set<string>();
  const out: GuCandidate[] = [];
  for (const c of list) {
    const k = `${c.ticker || ''}|${c.publishedAt.slice(0, 10)}|${c.title.toLowerCase().slice(0, 60)}`;
    if (seen.has(k) || seen.has(c.id)) continue;
    seen.add(k); seen.add(c.id); out.push(c);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// US: the graded-results cache
// The route's graded-US cache (`us-graded:<engine>:<date>|1`) already holds, per filer, the guidance the company
// published (`guidance_figures`), the company's OWN previous full-year guidance (`guide_change`, built from two
// filed releases), the release link, and the street estimate matched to the guided period (`est`).
// We turn those STRUCTURED figures into the plain sentence a company release would carry and let the engine read
// it. Nothing is invented: every number in the sentence is a number the company published.
// ═══════════════════════════════════════════════════════════════════════════

/** graded-us stores `{ z: base64(gzip(json)) }`; older rows are plain objects. */
export function unzipUsPayload(raw: any): any | null {
  if (!raw) return null;
  if (typeof raw?.z === 'string') {
    try { return JSON.parse(gunzipSync(Buffer.from(raw.z, 'base64')).toString('utf8')); } catch { return null; }
  }
  return raw?.by_tier ? raw : null;
}

/** US session dates (Eastern time, weekdays only), newest first. Enough sessions to cover the window. */
export function usSessionDates(now: Date, days: number): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const out: string[] = [];
  const span = Math.min(Math.max(days, 1), MAX_LIST_DAYS) + 1;
  for (let i = 0; i <= span; i++) {
    const d = fmt.format(new Date(now.getTime() - i * 86_400_000));
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6 || out.includes(d)) continue;
    out.push(d);
  }
  return out;
}

export interface UsSessions {
  rows: Array<{ date: string; payload: any; version: string }>;
  total: number; warm: number; olderEngine: number;
}
/**
 * Read the graded-US sessions from KV (reader injected, so this stays testable). Cache only: a missing session is
 * COLD and is reported, never graded here. `versions[0]` is the current engine; later versions are tried only for
 * sessions the current one does not hold (a rules change does not change the company's guidance).
 */
export async function loadUsSessions(
  dates: string[], versions: string[], mget: (keys: string[]) => Promise<any[]>, chunk = 6,
  opts: { concurrency?: number; budgetMs?: number } = {},
): Promise<UsSessions> {
  const rows: UsSessions['rows'] = [];
  const have = new Set<string>();
  let olderEngine = 0;
  // zzz848: a long window (120D = ~85 sessions) is read in bounded waves inside a shared deadline. Without `opts` every chunk runs at once, as before.
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  const conc = Math.max(1, opts.concurrency ?? Infinity);
  for (let vi = 0; vi < versions.length; vi++) {
    const missing = dates.filter((d) => !have.has(d));
    if (!missing.length || Date.now() >= deadline) break;
    const parts: string[][] = [];
    for (let i = 0; i < missing.length; i += chunk) parts.push(missing.slice(i, i + chunk));
    const readPart = async (ds: string[]) => {
      if (Date.now() >= deadline) return ds.map((d) => ({ d, p: null as any }));   // out of time: these sessions stay COLD and are reported as such
      try { const vals = await mget(ds.map((d) => `us-graded:${versions[vi]}:${d}|1`)); return ds.map((d, i) => ({ d, p: unzipUsPayload(vals?.[i]) })); }
      catch { return ds.map((d) => ({ d, p: null as any })); }
    };
    const got: Array<Array<{ d: string; p: any }>> = new Array(parts.length);
    if (conc >= parts.length) await Promise.all(parts.map(async (ds, i) => { got[i] = await readPart(ds); }));
    else {
      let next = 0;
      await Promise.all(Array.from({ length: conc }, async () => { while (next < parts.length) { const i = next++; got[i] = await readPart(parts[i]); } }));
    }
    for (const g of got.flat()) if (g?.p?.by_tier) { rows.push({ date: g.d, payload: g.p, version: versions[vi] }); have.add(g.d); if (vi > 0) olderEngine++; }
  }
  return { rows, total: dates.length, warm: have.size, olderEngine };
}

type UsLine = { metric: string; basis: string | null; period: string | null; unit: string; low: number | null; high: number | null; prevLow: number | null; prevHigh: number | null; est: number | null };

const fyNorm = (label: unknown): string => {
  const t = String(label ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!t || t === 'FULL YEAR') return '';
  return t.replace(/\bFY(\d{4})\b/, (_m, y: string) => `FY${y.slice(2)}`);
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const US_METRIC_WORDS: Record<string, { word: string; unit: 'usd' | 'usd_share' | 'pct'; engine: 'REVENUE' | 'ADJ_EPS' | 'EPS' | null }> = {
  revenue: { word: 'revenue', unit: 'usd', engine: 'REVENUE' },
  eps: { word: 'EPS', unit: 'usd_share', engine: 'EPS' },
  operating_income: { word: 'operating income', unit: 'usd', engine: null },
  ebitda: { word: 'EBITDA', unit: 'usd', engine: null },
  free_cash_flow: { word: 'free cash flow', unit: 'usd', engine: null },
  net_income: { word: 'net income', unit: 'usd', engine: null },
  operating_margin: { word: 'operating margin', unit: 'pct', engine: null },
};

type Scale = { key: 'B' | 'M' | 'K' | ''; div: number; word: string };
const scaleFor = (v: number): Scale => {
  const a = Math.abs(v);
  return a >= 1e9 ? { key: 'B', div: 1e9, word: ' billion' } : a >= 1e6 ? { key: 'M', div: 1e6, word: ' million' } : a >= 1e3 ? { key: 'K', div: 1e3, word: ' thousand' } : { key: '', div: 1, word: '' };
};
const trim = (v: number, dp: number): string => String(parseFloat(v.toFixed(dp)));

function sentenceFor(l: UsLine, company: string, verb = 'raised'): { text: string; label: string; scale: Scale | null; fmt: (lo: number | null, hi: number | null) => string } | null {
  const w = US_METRIC_WORDS[l.metric];
  if (!w || w.unit !== l.unit) return null;
  const newV = [l.low, l.high].filter((x): x is number => x != null);
  const oldV = [l.prevLow, l.prevHigh].filter((x): x is number => x != null);
  if (!newV.length || !oldV.length) return null;
  const scale = l.unit === 'usd' ? scaleFor(Math.max(...newV.map(Math.abs))) : null;
  const one = (v: number): string => l.unit === 'pct' ? `${trim(v, 2)}%` : l.unit === 'usd_share' ? `$${v.toFixed(2)}` : `$${trim(v / scale!.div, 3)}${scale!.word}`;
  const fmt = (lo: number | null, hi: number | null): string => {
    const a = lo ?? hi!; const b = hi ?? lo!;
    return a === b ? one(a) : `${one(Math.min(a, b))} to ${one(Math.max(a, b))}`;
  };
  const adj = l.basis === 'adjusted' && l.metric !== 'revenue';
  const word = l.metric === 'eps' ? (adj ? 'adjusted EPS' : 'GAAP EPS') : `${adj ? 'adjusted ' : ''}${w.word}`;
  const per = fyNorm(l.period) || 'full-year';
  const text = `The company ${verb} ${per} ${word} guidance to ${fmt(l.low, l.high)} from ${fmt(l.prevLow, l.prevHigh)}.`;
  return { text, label: `${per} ${word}`, scale, fmt };
}

export interface UsRowResult {
  cand: GuCandidate;
  consensus?: NonNullable<GuContext['consensus']>;
  pe?: number;
  /** Lines the SAME release lowered. The engine keeps raises only, so the route adds these as a stated risk. */
  cuts: string[];
}

/** One graded-US row -> a candidate (or null when the row carries no raised guidance). */
export function usGradedRowToCandidate(row: any, sessionDate: string, generatedAt?: string): UsRowResult | null {
  const ticker = tick(row?.ticker);
  if (!ticker) return null;
  const company = clean(row?.company, 120) || ticker;
  const fd = String(row?.filing_date || '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fd) ? fd : /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? sessionDate : '';
  if (!date) return null;

  const figs: any[] = Array.isArray(row?.guidance_figures) ? row.guidance_figures : [];
  const chgs: any[] = Array.isArray(row?.guide_change) ? row.guide_change : [];
  const key = (m: unknown, b: unknown, p: unknown) => `${m}|${b || ''}|${fyNorm(p)}`;
  const figBy = new Map<string, any>();
  for (const f of figs) figBy.set(key(f?.metric, f?.basis, f?.period_label), f);

  const raised: UsLine[] = []; const lowered: UsLine[] = []; const seen = new Set<string>();
  for (const c of chgs) {
    const k = key(c?.metric, c?.basis, c?.period_label); seen.add(k);
    const f = figBy.get(k);
    const line: UsLine = { metric: String(c?.metric), basis: c?.basis ?? null, period: c?.period_label ?? null, unit: String(c?.unit ?? f?.unit ?? ''),
      low: num(c?.new_low), high: num(c?.new_high), prevLow: num(c?.prev_low), prevHigh: num(c?.prev_high), est: num(f?.est) };
    if (c?.direction === 'raised') raised.push(line); else if (c?.direction === 'lowered') lowered.push(line);
  }
  for (const f of figs) {   // a prior column printed inside the release's own outlook table
    const k = key(f?.metric, f?.basis, f?.period_label);
    if (seen.has(k) || (f?.prior_low == null && f?.prior_high == null)) continue;
    const line: UsLine = { metric: String(f?.metric), basis: f?.basis ?? null, period: f?.period_label ?? null, unit: String(f?.unit ?? ''),
      low: num(f?.low), high: num(f?.high), prevLow: num(f?.prior_low), prevHigh: num(f?.prior_high), est: num(f?.est) };
    if (f?.raised === true) raised.push(line); else if (f?.raised === false) lowered.push(line);
  }

  const sentences: string[] = []; const periods: string[] = []; const built: Array<{ l: UsLine; s: NonNullable<ReturnType<typeof sentenceFor>> }> = [];
  for (const l of raised) {
    const s = sentenceFor(l, company); if (!s) continue;
    sentences.push(s.text); built.push({ l, s }); const p = fyNorm(l.period) || 'full-year'; if (!periods.includes(p)) periods.push(p);
  }
  const cuts: string[] = [];
  for (const l of lowered) {
    const s = sentenceFor(l, company, 'lowered'); if (!s) continue;
    cuts.push(`The same release lowered ${s.label} guidance to ${s.fmt(l.low, l.high)} from ${s.fmt(l.prevLow, l.prevHigh)}`);
  }

  let title: string; let text: string;
  if (sentences.length) { title = `${company} raises ${periods.join(' and ')} guidance`; text = sentences.join(' '); }
  else {
    // No structured before/after: use the company's own verbatim outlook sentences, only when the row's own verdict is RAISED.
    const snips: string[] = Array.isArray(row?.guidance_snippets) ? row.guidance_snippets.map((x: unknown) => clean(x, 400)).filter(Boolean) : [];
    if (String(row?.guidance || '').toUpperCase() !== 'RAISED' || !snips.length) return null;
    title = `${company} raises guidance`; text = snips.join(' ');
  }

  // Source: PRIMARY only when we hold the SEC document link. Without one it stays a cache row (DISCOVERY tier -> UNVERIFIED).
  const gUrl = row?.guidance_url; const fUrl = row?.filing_url;
  const url = isSecUrl(gUrl) ? String(gUrl) : isSecUrl(fUrl) ? String(fUrl) : undefined;
  const kind: GuCandidate['kind'] = url ? (isSecUrl(gUrl) ? 'RELEASE' : 'FILING') : 'OTHER';
  const sourceName = url ? (isSecUrl(gUrl) ? 'Company earnings release (SEC 8-K exhibit)' : 'SEC filing (8-K)') : 'US graded results cache (no source link)';
  const cand: GuCandidate = { id: `usgraded:${ticker}:${date}`, ticker, company, market: 'US', title, text, url, sourceName, publishedAt: date, kind };

  // Street estimate: only one the results row already matched to THIS guided period (revenue first, then adjusted EPS).
  let consensus: UsRowResult['consensus'];
  const pick = built.find((b) => b.l.metric === 'revenue' && b.l.est != null) ?? built.find((b) => b.l.metric === 'eps' && b.l.basis === 'adjusted' && b.l.est != null);
  if (pick && pick.l.est != null) {
    const per = fyNorm(pick.l.period) || 'UNSTATED';
    const isRev = pick.l.metric === 'revenue';
    const sc = pick.s.scale;
    consensus = {
      metric: isRev ? 'REVENUE' : 'ADJ_EPS', period: per,
      value: isRev ? parseFloat((pick.l.est / (sc?.div ?? 1)).toFixed(4)) : pick.l.est,
      unit: isRev ? `$${sc?.key ?? ''}` : '$',
      source: `Analyst estimate attached to this results row (vendor estimate feed, read when the session was graded${generatedAt ? ` on ${String(generatedAt).slice(0, 10)}` : ''}; it may already reflect the raise)`,
    };
  }
  const pe = num(row?.pe);
  return { cand, consensus, pe: pe != null && pe > 0 ? pe : undefined, cuts };
}

// ═══════════════════════════════════════════════════════════════════════════
// Markets: keep IN and US apart, filter, and say honestly what was covered
// ═══════════════════════════════════════════════════════════════════════════

/** A wire/news item with no region but a ticker the US graded cache knows is a US item. */
export function reassignGlobalToUs(list: GuCandidate[], usTickers: ReadonlySet<string>): GuCandidate[] {
  return list.map((c) => (c.market === 'GLOBAL' && c.ticker && usTickers.has(c.ticker) ? { ...c, market: 'US' as GuMarket } : c));
}

/** Split so a US ticker and an India ticker with the same letters can never be merged into one event. */
export function splitByMarket(list: GuCandidate[], perMarketCap = 200): Record<GuMarket, GuCandidate[]> {
  const out: Record<GuMarket, GuCandidate[]> = { IN: [], US: [], GLOBAL: [] };
  for (const c of list) if (out[c.market].length < perMarketCap) out[c.market].push(c);
  return out;
}

export function filterByMarket(events: GuidanceEvent[], market: MarketFilter): GuidanceEvent[] {
  return market === 'ALL' ? events : events.filter((e) => e.market === market);
}

export type CandidateOrigin = 'graded' | 'filings' | 'news';
export const originOf = (c: GuCandidate): CandidateOrigin => c.id.startsWith('graded:') || c.id.startsWith('usgraded:') ? 'graded' : c.id.startsWith('filing:') ? 'filings' : 'news';

export interface MarketCoverage {
  market: 'IN' | 'US';
  candidates: Record<CandidateOrigin, number>;   // raise candidates that passed the guidance filter
  sessions?: { warm: number; total: number; olderEngine: number };   // US graded sessions found in KV
  cacheEmpty: string[];                          // feeds that returned nothing
  events: number; withConsensus: number;
  newest: string | null;
  /** zzz844: live scan status for this market; when present the line leads with SCAN COMPLETE / SCAN INCOMPLETE */
  scan?: GuScanStatus;
  verified?: number;
  /** India: what each source actually returned, so a zero can be explained source by source */
  read?: IndiaRead;
}

export interface IndiaRead {
  news: number;              // India articles in the news cache (news:articles:v39)
  newsScraped: number;       // entries in the scraped India news blob (scraped-india-news:v1:latest)
  retained: number;          // earlier raise-worded news items kept past the feeds' own retention
  filings: number;           // exchange announcements read (feed cache + live day scan)
  graded: number;            // India results rows read
  subjectOnly: number;       // announcements seen whose raise text sits in an unread document
  unresolved: number;        // raise candidates with a company name but no NSE symbol
  noCompany: number;         // raise wording found but no company could be identified (not shown)
}

export function coverageLine(c: MarketCoverage, now: Date = new Date()): string {
  const name = c.market === 'IN' ? 'India' : 'US';
  const total = c.candidates.graded + c.candidates.filings + c.candidates.news;
  const parts: string[] = [];
  if (c.candidates.graded) parts.push(`${c.candidates.graded} from ${c.market === 'IN' ? 'results filings' : 'graded results (SEC releases)'}`);
  if (c.candidates.filings) parts.push(`${c.candidates.filings} from exchange filings`);
  if (c.candidates.news) parts.push(`${c.candidates.news} from news`);
  let s: string;
  if (c.scan) {
    s = scanSummaryLine(c.scan, { candidates: total, verified: c.verified ?? 0, events: c.events, withConsensus: c.withConsensus });
    if (parts.length) s += ` (${parts.join(', ')})`;
  } else {
    s = `${name}: ${total} candidate${total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}. Live scan status not available, so this is cache-only coverage`;
  }
  if (c.market === 'US' && c.sessions && c.sessions.total > 0) {
    if (c.sessions.warm === 0) s += `. The US graded-results cache holds 0 of ${c.sessions.total} sessions`;
    else if (c.sessions.warm < c.sessions.total) s += `. Graded cache holds ${c.sessions.warm} of ${c.sessions.total} US sessions (${c.sessions.total - c.sessions.warm} still awaiting grading; this is not full coverage)`;
    if (c.sessions.olderEngine) s += `. ${c.sessions.olderEngine} from an earlier grading version`;
  }
  if (c.cacheEmpty.length) s += `. Empty: ${c.cacheEmpty.join(', ')}`;
  if (c.read) s += `. Read: ${readWords(c.read)}`;
  if (c.events > 0 || !c.read) s += `. ${consensusLabel(c.withConsensus, c.events)}`;
  if (c.newest) {
    const d = Math.max(0, Math.floor((now.getTime() - Date.parse(c.newest)) / 86_400_000));
    s += `. Newest announcement ${c.newest.slice(0, 10)} (${d === 0 ? 'today' : `${d}d ago`})`;
  } else if (c.scan && !c.scan.complete) s += '. No announcement found (scan incomplete)';
  else s += c.read ? '. No guidance raise found among the items read' : '. No announcement found in this window';
  return `${s}.`;
}

/** Per-source counts in plain words. Never offers consensus as a reason for a zero. */
export function readWords(r: IndiaRead): string {
  const parts = [
    `${r.news} India news item${r.news === 1 ? '' : 's'} (cache)`,
    `${r.newsScraped} from the scraped news feed`,
    ...(r.retained ? [`${r.retained} kept from earlier days`] : []),
    `${r.filings} exchange announcement${r.filings === 1 ? '' : 's'}`,
    `${r.graded} results row${r.graded === 1 ? '' : 's'}`,
  ];
  let s = parts.join(', ');
  if (r.subjectOnly) s += `; ${r.subjectOnly} announcement${r.subjectOnly === 1 ? '' : 's'} seen with raise text not read (document not opened, not counted as a raise)`;
  if (r.unresolved) s += `; ${r.unresolved} candidate${r.unresolved === 1 ? '' : 's'} shown with ticker not resolved`;
  if (r.noCompany) s += `; ${r.noCompany} raise-worded item${r.noCompany === 1 ? '' : 's'} dropped because no company could be identified`;
  return s;
}

export function coverageNote(list: MarketCoverage[], now: Date = new Date()): string {
  return list.map((c) => coverageLine(c, now)).join(' ');
}


// ═══════════════════════════════════════════════════════════════════════════
// zzz848: honest coverage + mandatory wording for empty results
// ═══════════════════════════════════════════════════════════════════════════
export const NOT_CONFIRMATION = 'Zero events shown is NOT a confirmation of no upgrades.';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The ONLY wording for "no events". Never the bare phrase that says nothing was found.
 * complete -> 'No verified upgrades found in the fully processed 120D source universe.'
 * incomplete -> 'No additional verified upgrades found in currently processed sources. 102 filings remain awaiting grading.'
 * `awaiting` null/undefined = unknown: the generic sentence is used instead of a number.
 */
export function noUpgradesMessage(o: { window: GuWindow; complete: boolean; awaiting?: number | null }): string {
  if (o.complete) return `No verified upgrades found in the fully processed ${o.window} source universe.`;
  const n = o.awaiting;
  const tail = typeof n === 'number' && Number.isFinite(n) && n > 0
    ? `${plural(n, 'filing')} remain${n === 1 ? 's' : ''} awaiting grading.`
    : typeof n === 'number' && n === 0 ? 'Some sources or days were not fully processed.'
    : 'Some filings may remain awaiting grading.';
  return `No additional verified upgrades found in currently processed sources. ${tail}`;
}
/** Empty-result note: the wording above, plus the not-a-confirmation line whenever the scan is incomplete. */
export function noUpgradesNote(o: { window: GuWindow; complete: boolean; awaiting?: number | null }): string {
  const m = noUpgradesMessage(o);
  return o.complete ? m : `${m} ${NOT_CONFIRMATION}`;
}
/** 'Coverage: 74/120 days — 120D coverage incomplete' (or just 'Coverage: 120/120 days' when nothing is missing). */
export function coverageLabel(covered: number, requested: number, window: GuWindow): string {
  const base = `Coverage: ${covered}/${requested} days`;
  return covered >= requested ? base : `${base} — ${window} coverage incomplete`;
}
const isWeekendDay = (d: string): boolean => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
export interface CoverageInput {
  /** calendar days of the window, newest first */
  days: readonly string[];
  /** days a required LIVE source answered for, in this run */
  live: ReadonlySet<string>;
  /** days that have a graded results session (null = this market has no graded-session requirement) */
  graded?: ReadonlySet<string> | null;
  /** days an earlier run already processed completely (persisted store) */
  store?: ReadonlySet<string>;
  /** days that cannot have a graded session (weekend) are not missing just because nothing was graded */
  freeDay?: (d: string) => boolean;
}
export interface CoverageResult { covered: string[]; missing: string[]; fromStore: number; fromLive: number }
/** A day is covered when an earlier run processed it, or when every live requirement was met today. A missing day is never counted as zero events. */
export function computeCoverage(i: CoverageInput): CoverageResult {
  const free = i.freeDay ?? isWeekendDay;
  const covered: string[] = []; const missing: string[] = []; let fromStore = 0; let fromLive = 0;
  for (const d of i.days) {
    const liveOk = i.live.has(d) && (!i.graded || i.graded.has(d) || free(d));
    if (liveOk) { covered.push(d); fromLive++; }
    else if (i.store?.has(d)) { covered.push(d); fromStore++; }
    else missing.push(d);
  }
  return { covered, missing, fromStore, fromLive };
}
/** COMPLETE only when nothing failed, nothing is missing and nothing is waiting to be read. */
export function scanState(s: Pick<GuScanStatus, 'complete' | 'sources' | 'daysCovered'>): GuScanState {
  if (s.complete) return 'COMPLETE';
  const ran = s.sources.filter((x) => x.state !== 'NOT_RUN' && x.state !== 'NOT_AVAILABLE');
  if (s.daysCovered === 0 && (ran.length === 0 || ran.every((x) => x.state === 'FAILED'))) return s.sources.some((x) => x.state === 'NOT_AVAILABLE') && ran.length === 0 ? 'NOT_AVAILABLE' : 'FAILED';
  return 'PARTIAL';
}
/** Who confirmed a raise: the owner of the primary document, when one was actually read. */
export function verifiedByOf(e: Pick<GuidanceEvent, 'verification' | 'primaryAvailable' | 'sources'>): string | undefined {
  if (e.verification !== 'VERIFIED' || !e.primaryAvailable) return undefined;
  const p = e.sources.find((x) => x.tier === 'PRIMARY');
  return p ? `${p.name}${p.type && !p.name.includes(p.type) ? ` (${p.type})` : ''}` : undefined;
}
/** Where each event came from on this read: live sources, the persisted event store, or both. Matching is by ticker (or name) + event day. */
export function tagOrigin(events: GuidanceEvent[], live: readonly GuCandidate[], stored: readonly GuCandidate[]): GuidanceEvent[] {
  const key = (c: GuCandidate) => `${(c.ticker || nameKeyOf(c)).toUpperCase()}|${c.publishedAt.slice(0, 10)}`;
  const liveK = new Set(live.map(key)); const storeK = new Set(stored.map(key));
  return events.map((e) => {
    if (!e.v2) return e;
    const k = `${e.ticker.toUpperCase()}|${e.announcement_date.slice(0, 10)}`;
    const origin: 'LIVE' | 'STORE' | 'LIVE+STORE' = liveK.has(k) && storeK.has(k) ? 'LIVE+STORE' : storeK.has(k) && !liveK.has(k) ? 'STORE' : 'LIVE';
    return e.v2.origin === origin ? e : { ...e, v2: { ...e.v2, origin } };
  });
}
/** Additive provenance: `verifiedBy` (the primary source that confirmed it) next to `detectedVia` (who first saw it). Everything else is untouched. */
export function withProvenance(events: GuidanceEvent[]): GuidanceEvent[] {
  return events.map((e) => {
    if (!e.v2) return e;
    const vb = verifiedByOf(e);
    return vb && e.v2.verifiedBy !== vb ? { ...e, v2: { ...e.v2, verifiedBy: vb } } : e;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz844 V2: semantic intake + scan-aware wording
// ═══════════════════════════════════════════════════════════════════════════

/** Company-voice guidance-raise phrasing. Language only; no ticker or company is named here. */
const RAISE_VERB = String.raw`(?:rais(?:e|es|ed|ing)|further raised|hik(?:e|es|ed|ing)|lift(?:s|ed|ing)?|upgrad(?:e|es|ed|ing)|increas(?:e|es|ed|ing)|rev(?:ise|ises|ised|ising)|boost(?:s|ed|ing)?|upped|up-?revis(?:e|es|ed|ing))`;
const GUIDE_NOUN = String.raw`(?:guidance|outlook|forecast|targets?|projections?|expectations?)`;
const PHRASE_RES: RegExp[] = [
  new RegExp(String.raw`\b${RAISE_VERB}\b[^.;:]{0,60}\b(?:FY ?\d{2,4}|full[- ]year|annual|revenue|sales|profit|net profit|PAT|EBITDA|margin|EPS|earnings|turnover|top[- ]?line)\b[^.;:]{0,40}\b${GUIDE_NOUN}\b`, 'i'),
  new RegExp(String.raw`\b${RAISE_VERB}\b[^.;:]{0,40}\b${GUIDE_NOUN}\b`, 'i'),
  /\bnow (?:expects?|expected|sees?|anticipates?|targets?|projects?|guides?)\b/i,
  /\brevis(?:e|es|ed|ing)\b[^.;:]{0,30}\b(?:outlook|guidance|targets?)\b/i,
  /\b(?:revenue|sales|profit|PAT|EBITDA|turnover|earnings)\s+(?:target|guidance)\b[^.;:]{0,40}\b(?:raised|increased|revised|upgraded|hiked|to)\b/i,
];
const ANALYST_ONLY = /\b(?:price targets?|target price|analysts?|brokerages?|broker|rating|initiat\w+ coverage|consensus)\b/i;


// ═══════════════════════════════════════════════════════════════════════════
// zzz848 false-positive guard: a company "raises" many things that are NOT its earnings guidance.
// Funds, stake, prices, capex, dividend, a bid, a price target, a brokerage estimate, an index / market-wide wrap.
// Judged sentence by sentence. A sentence is only dropped when it names one of those objects and does NOT also carry a real
// "raises <FY / revenue / profit ...> guidance | outlook | forecast" phrase. Clean candidates come back as the SAME object.
// ═══════════════════════════════════════════════════════════════════════════
const RV = String.raw`(?:rais(?:e|es|ed|ing)|hik(?:e|es|ed|ing)|lift(?:s|ed|ing)?|boost(?:s|ed|ing)?|increas(?:e|es|ed|ing)|upgrad(?:e|es|ed|ing)|ups|upped|bump(?:s|ed|ing)?)`;
const RAISE_ANY = new RegExp(String.raw`\b${RV}\b`, 'i');
/** words that may sit between "raises" and "guidance" in a real company raise */
const GUIDE_QUAL = String.raw`(?:(?:FY|F\.?Y\.?)\s?'?\d{2,4}|[HQ][1-4]\s?FY\s?'?\d{2,4}|full[- ]year|fiscal(?: year)?(?:\s*'?\d{2,4})?|annual|medium[- ]term|revenues?|sales|turnover|net|profit|PAT|EBITDA|EBIT|EPS|earnings|margins?|operating|volumes?|growth|income|production|order(?:s| book| inflows?)?|top[- ]?line|bottom[- ]?line|\d{2,4}|and|&|,)`;
const DET = String.raw`(?:(?:its|their|the|our|his|her|a|an)\s+)?`;
/** raise verb + qualifiers + guidance / outlook / forecast  (qualifiers optional) */
const STRONG_GUIDE_RE = new RegExp(String.raw`\b${RV}\s+${DET}(?:${GUIDE_QUAL}\s*){0,5}(?:guidance|outlook|forecasts?|projections?)\b`, 'i');
/** raise verb + at least ONE qualifier + target  ("raises FY27 revenue target"; a bare "raises target" is a price target) */
const STRONG_TARGET_RE = new RegExp(String.raw`\b${RV}\s+${DET}(?:${GUIDE_QUAL}\s*){1,5}(?:targets?)\b`, 'i');
/** a real raise that also says WHICH period / how much: used where the sentence is otherwise suspicious (index wrap) */
const SPECIFIC_RE = /\b(?:FY\s?'?\d{2,4}|F\.?Y\.?\s?'?\d{2,4}|full[- ]year|fiscal|from\s+(?:Rs\.?|₹|INR|\$)?\s?[\d,.]+[^.]{0,40}?\bto\b|(?:Rs\.?|₹|INR|\$)\s?[\d,.]+\s*(?:crore|cr|lakh|million|mn|billion|bn)|\d+(?:\.\d+)?\s?%)/i;
const MONEY = String.raw`(?:(?:rs\.?|inr|₹|us\$|\$|usd|eur|€|£)\s?\d[\d,.]*(?:\s?-\s?\d[\d,.]*)?(?:\s?(?:crore|cr|lakh|mn|million|billion|bn|trillion|tn))?|\d[\d,.]*(?:\s?-\s?\d[\d,.]*)?\s?(?:crore|cr|lakh|mn|million|billion|bn|trillion|tn))`;
const NON_EARN_NOUN = String.raw`(?:funds?|funding|capital|money|cash|debt|loans?|bonds?|ncds?|debentures?|notes|stakes?|shareholding|holding|prices?|tariffs?|fares?|rates?|capex|capital expenditures?|spending|investments?|dividends?|payouts?|bids?|offers?|limits?|caps?|fees?|salar(?:y|ies)|wages|quotas?|premium|commissions?|levies|duty|duties|interest|borrowings?|exposure|credit lines?|pay(?:ment)?s?)`;
/** what the raise verb is applied to: money raised, a stake, a price, capex, a dividend, a bid, or a bare (price) target */
const NON_EARN_OBJ_RE = new RegExp(String.raw`\b${RV}\s+${DET}(?:(?:${MONEY})\b|(?:[A-Za-z0-9&'-]+\s+){0,2}?${NON_EARN_NOUN}\b|(?:price\s+)?targets?\b(?!\s+(?:for|of)\s+(?:FY|full|the year|revenue|sales|profit)))`, 'i');
const BROKER_SUBJECT_RE = /\b(?:analysts?|brokers?|brokerages?|research (?:house|firm)|street|goldman|jpmorgan|jp morgan|morgan stanley|citi(?:group)?|jefferies|nomura|kotak|motilal|hsbc|ubs|barclays|bernstein|macquarie|clsa|bofa|wells fargo|deutsche|credit suisse|iifl|axis securities|icici securities|sbi securities|nuvama|elara|ambit|emkay|prabhudas|anand rathi|kr choksey|sharekhan|crisil|icra|care ratings|fitch|moody'?s|s&p|rating agenc\w+)\b/i;
const NON_EARNINGS_ONLY_RE = /\b(?:capex|capital expenditures?|capital spending|capital outlay|dividends?|buy-?backs?|hiring|headcount|store (?:count|openings?)|share repurchases?)\b/i;
const EARNINGS_WORD_RE = /\b(?:revenues?|sales|top[- ]?line|turnover|profit|pat|net income|earnings|ebitda|ebit|eps|margins?|volumes?|order (?:inflows?|intake|book))\b/i;
const FWD_CUE_RE = /\b(?:now\s+(?:expects?|sees?|guides?|forecasts?|targets?|projects?)|guidance|outlook)\b/i;
const FY_PERIOD_RE = /\b(?:FY\s?'?\d{2,4}|F\.?Y\.?\s?'?\d{2,4}|full[- ]year|fiscal)\b/i;
const COMPANY_VOICE_RE = /\b(?:company|management|the firm|the board|we|our)\b/i;
/** index / market-wide pieces ("Sensex, Nifty end higher", "market wrap"). 'Stocks to watch' lists company news, so it is NOT here. */
const INDEX_PIECE_RE = /\b(?:sensex|nifty(?:\s?(?:50|100|bank|midcap|smallcap|next 50|it))?|bank nifty|indices|indexes|index|dalal street|market wrap|closing bell|opening bell|stock market(?: today)?|markets? (?:live|today|close|update|cheat sheet)|top (?:gainers|losers)|stocks? (?:to buy|that (?:rose|fell))|market breadth|gift nifty)\b/i;

/** True when a sentence uses a raise verb on something that is not the company's own earnings guidance. */
export function nonGuidanceRaiseSentence(sentence: string): boolean {
  const s = String(sentence || '');
  if (!s || !RAISE_ANY.test(s)) return false;
  const vm = new RegExp(String.raw`\b${RV}\b`, 'i').exec(s);
  // a brokerage / agency subject ("Jefferies raises FY27 EBITDA forecast") is an analyst action even when the sentence reads like guidance
  if (vm) {
    const seg = s.slice(Math.max(0, vm.index - 60), vm.index);
    const re = new RegExp(BROKER_SUBJECT_RE.source, 'gi'); let m: RegExpExecArray | null; let last: RegExpExecArray | null = null;
    while ((m = re.exec(seg)) !== null) last = m;
    if (last && !/\b(?:after|as|following|because|when|while|but|say|says|said|note|notes|noted)\b/i.test(seg.slice(last.index + last[0].length)) && !COMPANY_VOICE_RE.test(seg.slice(last.index + last[0].length))) return true;
  }
  const strong = STRONG_GUIDE_RE.test(s) || STRONG_TARGET_RE.test(s);
  if (INDEX_PIECE_RE.test(s) && !(strong && SPECIFIC_RE.test(s))) return true;             // market wrap: only a specific company raise survives
  if (strong) return false;
  if (FWD_CUE_RE.test(s) && FY_PERIOD_RE.test(s)) return false;                               // compound sentence that also states a dated company forward view: the engine decides
  return NON_EARN_OBJ_RE.test(s);
}
const SENT_SPLIT = /(?<=[.!?])\s+(?=[A-Z₹$€£])|\n+|;\s+/;
const sentencesOf = (t: string): string[] => String(t || '').split(SENT_SPLIT).map((x) => x.trim()).filter(Boolean);

/**
 * Drop the sentences that raise something else. Returns the SAME candidate object when nothing needed dropping.
 * Returns null when the headline is such a sentence and nothing else in the text reads as a company guidance raise.
 */
export function sanitizeRaiseCandidate(c: GuCandidate): GuCandidate | null {
  const titleBad = nonGuidanceRaiseSentence(c.title);
  const sents = sentencesOf(c.text);
  const keep = sents.filter((x) => !nonGuidanceRaiseSentence(x));
  if (!titleBad && keep.length === sents.length) return c;
  const text = keep.join(' ');
  if (!titleBad) return { ...c, text };
  const pick = keep.find((x) => looksLikeGuidanceRaise(x) || isGuidanceUpgradeCandidate({ ...c, title: x, text: '' }).include);
  return pick ? { ...c, title: clean(pick, 200), text } : null;
}

/** True when the text reads like the COMPANY raising its own outlook. Analyst wording never matches. */
export function looksLikeGuidanceRaise(text: string): boolean {
  const t = String(text || '');
  if (!t) return false;
  for (const s of t.split(/(?<=[.!?])\s+|\n+/)) {
    if (!PHRASE_RES.some((r) => r.test(s))) continue;
    if (nonGuidanceRaiseSentence(s)) continue;                 // zzz848: funds / stake / prices / capex / dividend / bid / price target / index wrap
    if (NON_EARNINGS_ONLY_RE.test(s) && !EARNINGS_WORD_RE.test(s)) continue;   // capex / dividend / hiring guidance is not an earnings upgrade
    if (ANALYST_ONLY.test(s) && !/\bcompany|management|board|we\b/i.test(s)) continue;
    return true;
  }
  return false;
}

/** Exchange categories / subjects that can carry guidance: results, outcome, AGM, investor presentation, press release, call, outlook. */
const FILING_RELEVANT_RE = /\b(?:results?|outcome|board meeting|agm|annual general|egm|investor|analyst|presentation|press release|media release|earnings|concall|con\.? call|conference call|transcript|guidance|outlook|target|forecast|business update|operational update|update)\b/i;
export function isGuidanceRelevantFiling(f: any): boolean {
  const hay = `${f?.subject ?? ''} ${f?.category ?? ''} ${f?.subcategory ?? ''} ${f?.detail ?? ''}`;
  return FILING_RELEVANT_RE.test(hay) || looksLikeGuidanceRaise(hay);
}

/** Consensus is optional enrichment, never a reason for zero candidates. */
export function consensusLabel(have: number, of: number): string {
  return `Consensus available ${have} of ${of}`;
}

export interface ScanLineCounts { candidates: number; verified: number; events: number; withConsensus: number }
export function scanSummaryLine(s: GuScanStatus, n: ScanLineCounts): string {
  const name = s.market === 'IN' ? 'India' : 'US';
  const sourceCount = s.sources.filter((x) => x.state !== 'NOT_RUN').length;
  if (s.windowDays && s.windowDays > LIVE_SCAN_MAX_DAYS && s.coverageLabel) {
    const wait = (s.unprocessed ?? s.awaitingGrading) > 0 ? `; ${plural(s.unprocessed ?? s.awaitingGrading, 'filing')} awaiting grading` : '';
    return `${name}: ${s.complete ? 'SCAN COMPLETE' : 'SCAN INCOMPLETE'} — ${s.coverageLabel}; ${sourceCount} source${sourceCount === 1 ? '' : 's'}; ${n.candidates} candidate${n.candidates === 1 ? '' : 's'}, ${n.verified} verified${wait}${s.complete ? '' : `; ${n.events} event${n.events === 1 ? '' : 's'} shown is NOT a confirmation of no upgrades`}`;
  }
  if (s.complete) {
    return `${name}: SCAN COMPLETE — ${s.daysCovered} of ${s.daysRequested} days, ${sourceCount} source${sourceCount === 1 ? '' : 's'}; ${n.candidates} candidate${n.candidates === 1 ? '' : 's'}, ${n.verified} verified`;
  }
  const bad = s.sources.filter((x) => x.state !== 'COMPLETE').map((x) => `${x.name}: ${x.detail || x.state}`).join('; ');
  const waiting = s.unprocessed ?? s.awaitingGrading;
  const wait = waiting > 0 ? `; ${waiting} filing${waiting === 1 ? '' : 's'} awaiting grading` : '';
  return `${name}: SCAN INCOMPLETE — ${s.daysCovered} of ${s.daysRequested} days covered${bad ? ` (${bad})` : ''}${wait}; ${n.events} event${n.events === 1 ? '' : 's'} shown is NOT a confirmation of no upgrades`;
}

// ═══════════════════════════════════════════════════════════════════════════
// India pipeline: what counts as a raise candidate, how it reaches the engine, and how filings corroborate it
// ═══════════════════════════════════════════════════════════════════════════

/** The name the engine will group an UNRESOLVED candidate under (mirrors the engine's own ticker fallback). */
export const nameKeyOf = (c: Pick<GuCandidate, 'company'>): string => (c.company ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * A candidate goes to the engine when the engine itself accepts it as a management raise, or when it reads as a company raise and
 * none of the engine's exclusions (analyst action, rumour, cut, reiteration, beat, price move, policy, contract) applies.
 * The second kind has wording but no parsed numbers: it stays a visible CANDIDATE (stage CANDIDATE, decision UNVERIFIED).
 * Wording-only candidates need a resolved NSE symbol, so macro or broker headlines ("RBI raises FY27 growth forecast") never become events.
 */
export function isRaiseCandidate(c0: GuCandidate): boolean {
  const c = sanitizeRaiseCandidate(c0);                       // zzz848: funds / stake / prices / capex / dividend / bid / price target / index wrap are not guidance
  if (!c) return false;
  const r = isGuidanceUpgradeCandidate(c);
  if (isExchangeFiling(c)) {
    // zzz848: an exchange subject line is administrative. It never makes an event on its own: the raise has to be in the text we hold,
    // or the subject itself must pass the engine's strict management-raise test. Otherwise it is "filing seen, raise text not read".
    if (!c.text.trim()) return r.include && isGuidanceUpgradeCandidate({ ...c, text: '' }).include;
    if (r.include) return true;
    return !!c.ticker && r.reason === 'No management guidance raise found' && looksLikeGuidanceRaise(c.text);
  }
  if (r.include) return true;
  if (!c.ticker || r.reason !== 'No management guidance raise found') return false;
  return looksLikeGuidanceRaise(`${c.title}. ${c.text}`);
}
/** An India exchange announcement row (NSE / BSE), as opposed to a graded results row or a news item. */
export const isExchangeFiling = (c: Pick<GuCandidate, 'id' | 'kind' | 'market'>): boolean => c.kind === 'FILING' && c.market === 'IN' && c.id.startsWith('filing:');

/** processCandidates for India: same engine, same window rule, wording-only raises kept as CANDIDATE. */
export function processRaiseCandidates(cands: GuCandidate[], ctxFor: (ticker: string) => GuContext, now: Date, window: GuWindow = '7D'): GuidanceEvent[] {
  const kept = cands.filter((c) => withinWindow(c.publishedAt, window, now) && isRaiseCandidate(c)).map((c) => sanitizeRaiseCandidate(c) ?? c);
  return rank(mergeCandidates(kept).map((sk) => buildGuidanceEvent(sk, ctxFor(sk.ticker) ?? {}, now)));
}

/** An unresolved candidate whose company name matches a resolved candidate of the batch takes that symbol (one outlet wrote 'Cupid Ltd', another 'Cupid'). */
export function propagateTickers(list: GuCandidate[]): GuCandidate[] {
  const byName = new Map<string, string | null>();
  for (const c of list) {
    if (!c.ticker || !c.company) continue;
    const k = normCompanyName(c.company); if (!k) continue;
    const cur = byName.get(k); if (cur === undefined) byName.set(k, c.ticker); else if (cur !== c.ticker) byName.set(k, null);
  }
  return list.map((c) => {
    if (c.ticker || !c.company) return c;
    const t = byName.get(normCompanyName(c.company));
    return t ? { ...c, ticker: t } : c;
  });
}

/**
 * Exchange announcements whose SUBJECT says an outcome / presentation / release / call / results document exists. The figures of a
 * raise often sit only in that attachment, and a public route never opens documents, so such a row is evidence that a primary
 * document EXISTS, never evidence of a raise.
 */
const RAISE_BEARING_SUBJECT = /\b(?:outcome of (?:the )?(?:\d+\w*\s+)?(?:annual general|agm|egm|extra[- ]ordinary)|annual general meeting|\bagm\b|investor presentation|analyst(?:s)?\s*\/?\s*(?:and\s+)?institutional investor|investor (?:meet|call|day)|press release|media release|earnings (?:call|release)|con(?:ference)?\.? call|transcript|(?:financial|quarterly|audited|unaudited)\s+results?|results?\s+for the|guidance|outlook|forecast|(?:business|operational|trading|quarterly) update)\b/i;
export function isRaiseBearingSubject(subject: unknown): boolean { return RAISE_BEARING_SUBJECT.test(String(subject ?? '')); }

export interface SubjectOnlyFiling { ticker?: string; company?: string; nameKey: string; subject: string; date: string; url?: string; exchange: string }
/** Filing candidates that carry no raise wording but whose subject names a guidance-bearing document. Deduped by company + subject + day. */
export function collectSubjectOnly(filings: GuCandidate[]): SubjectOnlyFiling[] {
  const out: SubjectOnlyFiling[] = []; const seen = new Set<string>();
  for (const c of filings) {
    if (c.kind !== 'FILING' || c.market !== 'IN' || !c.id.startsWith('filing:')) continue;
    if (!isRaiseBearingSubject(c.title)) continue;
    const nameKey = normCompanyName(c.company || c.ticker || '');
    const k = `${c.ticker || nameKey}|${c.publishedAt.slice(0, 10)}|${c.title.toLowerCase().slice(0, 50)}`;
    if (seen.has(k)) continue; seen.add(k);
    out.push({ ticker: c.ticker, company: c.company, nameKey, subject: c.title, date: c.publishedAt.slice(0, 10), url: c.url, exchange: c.sourceName.replace(/ filing$/, '') });
  }
  return out;
}

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
export const FILING_NOT_READ = 'document not read';

/**
 * A media/graded raise for a company that ALSO filed an AGM outcome / investor presentation / press release / results subject within
 * a day or two gets that filing attached as a source, plus an evidence-gap line saying the document was not opened.
 * It does NOT change verification, primaryAvailable, stage or decision: the engine has no PARTIALLY_VERIFIED state for guidance
 * upgrades, and a subject line is not a number.
 */
export function corroborateWithFilings(events: GuidanceEvent[], subjectOnly: readonly SubjectOnlyFiling[]): { events: GuidanceEvent[]; matched: number; unmatched: SubjectOnlyFiling[] } {
  const used = new Set<SubjectOnlyFiling>(); let matched = 0;
  const out = events.map((e) => {
    if (e.market !== 'IN') return e;
    const key = normCompanyName(e.company); const tk = (e.ticker || '').toUpperCase();
    const hits = subjectOnly.filter((f) => {
      const same = (f.ticker && f.ticker === tk) || (!!f.nameKey && f.nameKey === key);
      if (!same) return false;
      const d = dayDiff(f.date, e.announcement_date);
      return d >= -1 && d <= 3;
    });
    if (!hits.length) return e;
    hits.forEach((h) => used.add(h));
    if (e.primaryAvailable) return e;     // already backed by a document whose text was read: the subject-only row adds nothing
    matched++;
    const h = hits[0];
    const gap = `Exchange filing seen on ${h.date} ("${h.subject.slice(0, 90)}"); the raise figures sit in its attached document, which this page does not open (${FILING_NOT_READ}), so the claim stays unverified`;
    const next = 'Open the attached exchange filing and confirm the raised figures';
    const sources = e.sources.some((s) => s.name.includes('subject only')) ? e.sources
      : [...e.sources, { url: h.url, name: `${h.exchange} announcement (subject only)`, tier: 'SECONDARY' as const, type: `Exchange filing, ${FILING_NOT_READ}`, date: h.date }];
    const via = e.v2 ? { ...e.v2, detectedVia: e.v2.detectedVia.includes('exchange filing (subject only)') ? e.v2.detectedVia : [...e.v2.detectedVia, 'exchange filing (subject only)'] } : e.v2;
    return { ...e, sources, evidenceGaps: e.evidenceGaps.includes(gap) ? e.evidenceGaps : [gap, ...e.evidenceGaps], nextEvidence: e.nextEvidence.includes(next) ? e.nextEvidence : [next, ...e.nextEvidence].slice(0, 3), v2: via };
  });
  return { events: out, matched, unmatched: subjectOnly.filter((f) => !used.has(f)) };
}

export const TICKER_NOT_RESOLVED = 'ticker not resolved';
/** Events built from a company name only get a visible label and an evidence-gap line. `nameKeys` = nameKeyOf() of each unresolved candidate. */
export function labelUnresolved(events: GuidanceEvent[], nameKeys: ReadonlySet<string>): GuidanceEvent[] {
  return events.map((e) => {
    if (!nameKeys.has(e.ticker)) return e;
    const gap = `Ticker not resolved: the company was matched by name only, so no NSE symbol, price or history is attached`;
    return { ...e, company: /ticker not resolved/i.test(e.company) ? e.company : `${e.company} (${TICKER_NOT_RESOLVED})`, evidenceGaps: e.evidenceGaps.includes(gap) ? e.evidenceGaps : [...e.evidenceGaps, gap] };
  });
}

/** True for a ticker the ledger and price-free context may use (an NSE-style symbol, not a company-name fallback). */
export const isResolvedTicker = (t: unknown): boolean => isNseSymbol(t);

export interface IndiaInputs {
  /** `news:articles:v39` array (all regions) */
  news: any[] | null;
  /** `scraped-india-news:v1:latest` payload ({ entries } or an array) */
  scraped: any;
  /** `concall-feed:v26:days:N` payload ({ filings }) */
  feed: any;
  /** graded payloads, one per date in `gradedDates` (same order) */
  graded: any[] | null; gradedDates: string[];
  /** rows the live exchange scan returned (already candidates) */
  scanCandidates: GuCandidate[];
  /** `symbolmaster:catalog` value (entries) */
  catalog?: any;
  /** raise-worded news candidates kept from earlier requests */
  retained?: GuCandidate[];
}
export interface IndiaBuild {
  index: CompanyIndex;
  candidates: GuCandidate[];
  /** candidates that came from the news cache / scraped blob / retention, kept apart for persistence */
  counts: { news: number; newsAll: number; newsScraped: number; retained: number; filings: number; graded: number; gradedRows: number };
}

export function indexPairs(inp: Pick<IndiaInputs, 'feed' | 'graded' | 'scanCandidates' | 'catalog'>, names: Record<string, string>): Array<{ symbol: string; name: string }> {
  const pairs: Array<{ symbol: string; name: string }> = [];
  const ents = inp.catalog?.entries;
  if (ents && typeof ents === 'object') for (const k of Object.keys(ents)) { const e = ents[k]; if (e) pairs.push({ symbol: e.symbol || k, name: e.companyName }); }
  for (const [symbol, name] of Object.entries(names)) pairs.push({ symbol, name });
  if (Array.isArray(inp.feed?.filings)) for (const f of inp.feed.filings) pairs.push({ symbol: f?.symbol, name: f?.company_name });
  for (const c of inp.scanCandidates) if (c.ticker) pairs.push({ symbol: c.ticker, name: c.company ?? '' });
  if (Array.isArray(inp.graded)) for (const p of inp.graded) for (const r of collectGradedRows(p)) pairs.push({ symbol: r?.symbol ?? r?.ticker, name: r?.company });
  return pairs;
}

/**
 * Every India input path in one place, shared by Guidance Upgrades and Growth Guidance:
 * news cache + scraped India news + retained items (media), exchange feed + live scan (filings), graded rows (results).
 * `names` is the curated symbol -> company map (NSE_TICKER_NAMES), passed in so this module stays data-free.
 */
export function buildIndiaCandidates(inp: IndiaInputs, names: Record<string, string>): IndiaBuild {
  const index = buildCompanyIndex(indexPairs(inp, names));
  // live-scan rows were built before the index existed: a BSE row (numeric scrip code) is resolved by company name now
  const cands: GuCandidate[] = inp.scanCandidates.map((c) => (c.ticker || !c.company ? c : { ...c, ticker: resolveCompany(c.company, '', [], index).ticker }));
  let filings = 0; let graded = 0; let gradedRows = 0; let news = 0; let newsAll = 0; let newsScraped = 0;
  if (Array.isArray(inp.feed?.filings)) for (const f of inp.feed.filings) { filings++; const c = filingToCandidate(f, index); if (c) cands.push(c); }
  if (Array.isArray(inp.graded)) inp.graded.forEach((p, i) => { for (const r of collectGradedRows(p)) { gradedRows++; const c = gradedRowToCandidate(r, inp.gradedDates[i]); if (c) { graded++; cands.push(c); } } });
  if (Array.isArray(inp.news)) for (const a of inp.news) {
    newsAll++;
    const c = newsToCandidate(a, index); if (!c) continue;
    if (c.market === 'IN') news++;
    cands.push(c);
  }
  const scrapedList: any[] = Array.isArray(inp.scraped) ? inp.scraped : Array.isArray(inp.scraped?.entries) ? inp.scraped.entries : Array.isArray(inp.scraped?.items) ? inp.scraped.items : [];
  for (const s of scrapedList) { const c = scrapedNewsToCandidate(s, index); if (c) { newsScraped++; cands.push(c); } }
  const retained = (inp.retained || []).filter((c) => c && c.id && c.title && c.publishedAt && c.market === 'IN');
  cands.push(...retained);
  return { index, candidates: propagateTickers(dedupeCandidates(cands)), counts: { news, newsAll, newsScraped, retained: retained.length, filings, graded, gradedRows } };
}
