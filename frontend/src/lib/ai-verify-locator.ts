// ═══════════════════════════════════════════════════════════════════════════
// AI VERIFICATION — PRIMARY-DOCUMENT LOCATOR.                         (zzz856)
//
// Most special-situation events arrive as a media story (ET, Livemint, CNBC,
// MarketWatch ...) with no company document attached, so the AI verifier had
// nothing to read ("No company document to read") and the item could never
// leave "Awaiting verification". This module finds the company's OWN document
// from data we already hold — never by guessing a URL:
//
//   · SEC form rows: the filing index is built from the accession + CIK the
//     row itself carries (secIndexUrl).
//   · India: the event's company (an NSE symbol the event names, or a company
//     name the event names) is matched against the NSE / BSE announcements we
//     already scraped (corp-filings blob, concall-feed window, stored
//     sub-windows), dated within ±3 days of the event, with a PDF attachment.
//   · US news: a ticker the event names → CIK (SEC ticker map) → that
//     company's EDGAR filings (submissions) within ±3 days, a form that fits
//     the event (8-K, SC TO-*, 425, DEFM14A, 10-12B ...).
//
// A document is attached ONLY when the company matches: the NSE symbol is one
// the event names, or the filing company's name equals / contains a name the
// event names AND that name is in the event's own text. A group word alone
// ("Tata", "Adani") never matches. Unknown ≠ negative: when the filing data
// could not be read, nothing is recorded and the claim is searched again on
// the next run; "none found" says what was searched.
// Pure functions first; real wiring (lazy imports) at the bottom.
// ═══════════════════════════════════════════════════════════════════════════

import type { LocatedDoc, PrimaryHow, VerifyClaim } from './ai-verify-types';

export const LOCATE_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;

// ── names ───────────────────────────────────────────────────────────────────

const CORP_WORDS = new Set(['inc', 'incorporated', 'corp', 'corporation', 'plc', 'ltd', 'limited', 'llc', 'lllp', 'llp', 'lp', 'sa', 'nv', 'ag', 'se', 'co', 'company', 'the', 'pvt', 'private', 'and', 'of', 'cos', 'companies']);
/** Words that never identify one company on their own (group prefixes, sector words). A name made only of these needs an exact match. */
const GENERIC_WORDS = new Set([
  'tata', 'adani', 'reliance', 'bajaj', 'birla', 'aditya', 'mahindra', 'godrej', 'jsw', 'hdfc', 'icici', 'kotak', 'jindal', 'vedanta', 'essar', 'rpsg', 'murugappa', 'shapoorji', 'lodha', 'hinduja', 'wadia', 'piramal', 'ab', 'ck', 'sbi',
  'india', 'indian', 'bharat', 'hindustan', 'national', 'state', 'bank', 'power', 'energy', 'industries', 'industry', 'finance', 'financial', 'capital', 'international', 'global', 'technologies', 'technology', 'tech', 'holdings', 'holding', 'group',
  'enterprises', 'ventures', 'infra', 'infrastructure', 'motors', 'steel', 'cement', 'pharma', 'pharmaceuticals', 'chemicals', 'textiles', 'solutions', 'services', 'systems', 'products', 'resources', 'america', 'american', 'us', 'usa', 'new', 'first', 'united', 'general',
]);

/** Lower-case name tokens without corporate words / punctuation / possessives. */
export function nameTokens(s: string | null | undefined): string[] {
  return String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/['’]s\b/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !CORP_WORDS.has(t));
}

/**
 * Same company: the two names differ only by corporate / group / sector words, and share at least one distinctive word (or are
 * identical). "ITC" = "ITC Limited"; "ITC" ≠ "ITC Hotels"; "Tata Motors" ≠ "Tata Steel"; "Tata" ≠ "Tata Motors".
 */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = Array.from(new Set(nameTokens(a))); const y = Array.from(new Set(nameTokens(b)));
  if (!x.length || !y.length) return false;
  const common = x.filter((t) => y.includes(t));
  if (!common.length) return false;
  const extra = [...x, ...y].filter((t) => !common.includes(t));
  if (extra.some((t) => !GENERIC_WORDS.has(t))) return false;
  const distinctive = common.filter((t) => !GENERIC_WORDS.has(t));
  return distinctive.length > 0 || extra.length === 0;
}

/** Every token of the name appears in the text (the event really names this company). */
export function nameInText(name: string, text: string): boolean {
  const n = nameTokens(name); const t = new Set(nameTokens(text));
  return n.length > 0 && n.every((w) => t.has(w));
}

// ── event kind → what a matching document is about ─────────────────────────

type KindFamily = 'MA' | 'TENDER' | 'SPIN' | 'CAPITAL' | 'NCLT' | 'CAPEX' | 'CONCALL' | 'OTHER';
export function kindFamily(eventType: string | null | undefined): KindFamily {
  const t = String(eventType || '').toUpperCase();
  if (/TENDER|BUYBACK/.test(t)) return 'TENDER';
  if (/SPIN|DEMERG|IPO_SUB|FORM10/.test(t)) return 'SPIN';
  if (/MERGER|ACQUI|OPEN_OFFER|STAKE|GOING_PRIVATE|ASSET_SALE|TAKEOVER/.test(t)) return 'MA';
  if (/RIGHTS|QIP|PIPE|BONUS|SPLIT|DIVIDEND|BACKSTOP|CAPITAL|WARRANT/.test(t)) return 'CAPITAL';
  if (/NCLT|IBC|TURNAROUND|INSOLV/.test(t)) return 'NCLT';
  if (/CAPEX|CAPACITY|ORDER/.test(t)) return 'CAPEX';
  if (/CONCALL|PRESENTATION|ANALYST_MEET/.test(t)) return 'CONCALL';   // zzz1057
  return 'OTHER';
}

const KIND_SUBJECT: Record<KindFamily, RegExp> = {
  MA: /acqui|merger|amalgamat|takeover|open offer|stake|share purchase|share subscription|investment in|scheme of arrangement|sale of|divest|slump sale|business transfer|definitive agreement|joint venture/i,
  TENDER: /buy[\s-]?back|tender offer|repurchase|open offer/i,
  SPIN: /demerg|scheme of arrangement|spin[\s-]?off|hive[\s-]?off|separation|listing of|composite scheme/i,
  CAPITAL: /preferential|rights issue|qualified institution|\bqip\b|warrant|allotment|fund[\s-]?rais|\bncds?\b|debenture|bonus|split|sub[\s-]?division|dividend|record date/i,
  NCLT: /nclt|insolvency|\bibc\b|resolution plan|\bcirp\b|one[\s-]?time settlement|restructur|financial results|results/i,
  CAPEX: /capacity|commission|plant|expansion|\border\b|contract|award|letter of (?:intent|award)|\bloi\b|capex|new (?:unit|facility)/i,
  CONCALL: /investor presentation|con\.? ?call|conference call|earnings call|analysts?\/?institutional|investor meet|transcript/i,
  OTHER: /acqui|merger|amalgamat|demerg|scheme of arrangement|buy[\s-]?back|open offer|preferential|rights issue|qip|bonus|split|dividend|nclt|insolvency|order|contract|capacity|stake/i,
};
const GENERIC_SUBJECT = /regulation 30|reg\.? 30|press release|media release|outcome of (?:the )?board|board meeting|disclosure|intimation|general updates?|updates?$/i;
const IRRELEVANT_SUBJECT = /trading window|share certificate|duplicate|reg(?:ulation)?\.?\s*74|reg(?:ulation)?\.?\s*39|newspaper|publication|compliance certificate|investor (?:complaint|grievance)|shareholding pattern|esop|esos|employee stock|change in (?:director|management|kmp|auditor)|resignation|appointment|cessation|postal ballot|annual general|\bagm\b|annual report|credit rating|analysts?\/?institutional|investor meet|con\.? ?call|conference call|transcript|audio recording|loss of|certificate under|closure of/i;

/** 0 = not about this event; 1 = a generic Regulation 30 / press release / board outcome; 3 = names this kind of event. */
export function subjectScore(subject: string, eventType: string | null | undefined): number {
  const s = String(subject || '');
  if (!s.trim()) return 0;
  // zzz1057: for a first concall / presentation the call itself IS the document (otherwise those subjects are irrelevant)
  if (kindFamily(eventType) === 'CONCALL' && KIND_SUBJECT.CONCALL.test(s)) return 3;
  if (IRRELEVANT_SUBJECT.test(s)) return 0;
  if (KIND_SUBJECT[kindFamily(eventType)].test(s)) return 3;
  if (GENERIC_SUBJECT.test(s)) return 1;
  return 0;
}

// ── dates ───────────────────────────────────────────────────────────────────

const parseMs = (s: unknown): number | null => {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── SEC: filing index from accession + CIK ─────────────────────────────────

/** https://www.sec.gov/Archives/edgar/data/<cik>/<acc-no-dashes>/<acc>-index.htm — null unless both are well formed. */
export function secIndexUrl(cik: string | number | null | undefined, accession: string | null | undefined): string | null {
  const c = String(cik ?? '').replace(/^0+/, '');
  const a = String(accession || '').trim();
  if (!/^\d{1,10}$/.test(c) || !/^\d{10}-\d{2}-\d{6}$/.test(a)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${c}/${a.replace(/-/g, '')}/${a}-index.htm`;
}

// ── India: NSE / BSE announcements ─────────────────────────────────────────

export interface ExchangeFiling {
  exchange?: string; symbol?: string; company_name?: string; subject?: string; detail?: string;
  filing_datetime?: string; attachment_urls?: string[];
}

const EXCHANGE_DOC = /^https:\/\/(?:[a-z0-9-]+\.)*(?:nseindia\.com|bseindia\.com)\//i;
const docOf = (f: ExchangeFiling): string | null => (Array.isArray(f.attachment_urls) ? f.attachment_urls : []).map(String).find((u) => EXCHANGE_DOC.test(u)) || null;

export interface FilingsCoverage { fromMs: number; toMs: number; rows: number }
export function coverageOf(filings: ReadonlyArray<ExchangeFiling>): FilingsCoverage | null {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const f of filings) { const t = parseMs(f.filing_datetime); if (t == null) continue; n++; if (t < lo) lo = t; if (t > hi) hi = t; }
  return n ? { fromMs: lo, toMs: hi, rows: n } : null;
}

/** Which of the event's own names / tickers this filing belongs to (null = a different company). */
export function filingCompanyMatch(f: ExchangeFiling, hints: NonNullable<VerifyClaim['locateHints']>): string | null {
  const sym = String(f.symbol || '').trim().toUpperCase();
  const tickers = hints.tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean);
  const exch = String(f.exchange || '').toUpperCase();
  if (sym && !/^\d+$/.test(sym) && exch !== 'BSE' && tickers.includes(sym)) {
    // a symbol match is accepted unless the filing's own company name contradicts every name the event gives
    const named = hints.names.filter(Boolean);
    if (!named.length || !f.company_name || named.some((n) => sameCompany(n, f.company_name)) || nameInText(String(f.company_name), hints.text) || tickers.length === 1) return `NSE symbol ${sym}`;
  }
  const co = String(f.company_name || '').trim();
  if (!co) return null;
  for (const n of hints.names) {
    if (!n || !nameInText(n, hints.text)) continue;   // only names the event itself carries
    if (sameCompany(n, co)) return `company name "${co}"`;
  }
  return null;
}

/** Find the company's own exchange announcement for an India event. `null` = the filing data does not reach the event date yet (search again later). */
export function locateIndia(claim: VerifyClaim, filings: ReadonlyArray<ExchangeFiling>, now: Date, cov: FilingsCoverage | null = coverageOf(filings)): LocatedDoc | null {
  const h = claim.locateHints;
  const base = { claimId: claim.claimId, checkedAt: now.toISOString() };
  if (!h) return { ...base, found: false, url: null, how: null, detail: 'The event carries no company name or symbol to search exchange filings with.', matchedName: null, filingDate: null, text: null, kindMatch: false };
  const evMs = parseMs(claim.eventDate);
  if (evMs == null) return { ...base, found: false, url: null, how: null, detail: 'The event has no date, so its exchange filing cannot be matched by date.', matchedName: null, filingDate: null, text: null, kindMatch: false };
  if (!cov) return null;
  let best: { f: ExchangeFiling; url: string; score: number; dist: number; why: string } | null = null;
  for (const f of filings) {
    const t = parseMs(f.filing_datetime); if (t == null) continue;
    const dist = Math.abs(t - evMs); if (dist > LOCATE_WINDOW_DAYS * DAY_MS) continue;
    const url = docOf(f); if (!url) continue;
    const why = filingCompanyMatch(f, h); if (!why) continue;
    const score = subjectScore(`${f.subject || ''} ${f.detail || ''}`, h.eventType); if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { f, url, score, dist, why };
  }
  const names = [...h.tickers, ...h.names].filter(Boolean).slice(0, 3).join(' / ') || 'the company';
  // nothing yet, and the filings we hold end before the event's window closes: a later scrape may carry it (search again)
  if (!best && cov.toMs < evMs + LOCATE_WINDOW_DAYS * DAY_MS && now.getTime() - evMs < (LOCATE_WINDOW_DAYS + 1) * DAY_MS) return null;
  if (!best) {
    const inCov = evMs >= cov.fromMs - LOCATE_WINDOW_DAYS * DAY_MS;
    return { ...base, found: false, url: null, how: null, matchedName: null, filingDate: null, text: null, kindMatch: false,
      detail: inCov
        ? `Searched ${cov.rows} NSE / BSE announcements dated ${isoDay(cov.fromMs)} to ${isoDay(cov.toMs)}: none from ${names} within ${LOCATE_WINDOW_DAYS} days of ${isoDay(evMs)} about this event.`
        : `The NSE / BSE announcements we hold start ${isoDay(cov.fromMs)}, after this event (${isoDay(evMs)}), so its filing could not be looked up.` };
  }
  const f = best.f;
  const subj = `${String(f.subject || '').trim()}${f.detail ? ` — ${String(f.detail).trim()}` : ''}`.replace(/\s+/g, ' ').slice(0, 400);
  return { ...base, found: true, url: best.url, how: 'exchange_announcement', matchedName: String(f.company_name || f.symbol || '') || null, filingDate: f.filing_datetime || null, text: subj || null, kindMatch: best.score >= 3,
    detail: `${String(f.exchange || 'Exchange').toUpperCase()} announcement "${String(f.subject || '').trim().slice(0, 120)}" filed ${isoDay(parseMs(f.filing_datetime)!)} by ${f.company_name || f.symbol} (matched on ${best.why}, within ${LOCATE_WINDOW_DAYS} days of the event).` };
}

// ── US: EDGAR filings of the company named by the event ────────────────────

export interface EdgarRecent { form: string; filingDate: string; items?: string[]; accession: string }
export interface EdgarCompany { cik: number; name: string | null; tickers?: string[]; recent: EdgarRecent[] }

const FORMS_BY_KIND: Record<KindFamily, string[]> = {
  TENDER: ['SC TO-I', 'SC TO-T', 'SC 14D9', 'SC 13E3', '8-K', '6-K'],
  MA: ['8-K', '425', 'DEFM14A', 'PREM14A', 'DEFA14A', 'S-4', 'F-4', 'SC TO-T', 'SC 14D9', 'SC 13E3', 'SC 13D', '6-K'],
  SPIN: ['10-12B', '10-12G', '8-K', '6-K', 'S-1', 'S-4'],
  CAPITAL: ['8-K', '6-K', 'S-3', 'S-1', '424B5', 'SC TO-I'],
  NCLT: ['8-K', '6-K'],
  CAPEX: ['8-K', '6-K'],
  CONCALL: ['8-K', '6-K'],
  OTHER: ['8-K', '6-K', 'SC TO-T', 'SC TO-I', '425', 'DEFM14A', '10-12B'],
};
/** 8-K items that carry deal / corporate-action text (material agreement, acquisition completed, Reg FD release, other events, securities, charter). */
const EVENT_8K_ITEMS = ['1.01', '1.02', '2.01', '2.02', '2.05', '3.02', '3.03', '5.03', '7.01', '8.01'];
const baseForm = (f: string) => String(f || '').toUpperCase().replace(/\s+/g, ' ').replace(/\/A$/, '').replace(/^SC\s*14D-?9$/, 'SC 14D9').replace(/^SC\s*13E-?3$/, 'SC 13E3').trim();

export function edgarFormScore(form: string, items: string[] | undefined, eventType: string | null | undefined): number {
  const b = baseForm(form);
  const kind = kindFamily(eventType);
  if (!FORMS_BY_KIND[kind].includes(b)) return 0;
  if (b === '8-K') { const it = (items || []).map(String); return it.length === 0 ? 1 : it.some((x) => EVENT_8K_ITEMS.includes(x)) ? 2 : 0; }
  if (b === '6-K') return 1;
  return 3;
}

/** The company's own EDGAR filing for a US event. The company must be named in the event text (CIK came from a ticker the event names). */
export function locateUsFromSubmissions(claim: VerifyClaim, co: EdgarCompany, ticker: string, now: Date): LocatedDoc {
  const h = claim.locateHints!;
  const base = { claimId: claim.claimId, checkedAt: now.toISOString() };
  const nameOk = !!co.name && (nameInText(co.name, h.text) || h.names.some((n) => nameInText(n, h.text) && sameCompany(n, co.name)));
  // a bare ticker in a headline can be a word ("AI", "ON"): the SEC name must also be in the event text, or the ticker must be stated as a ticker
  const tickerStated = new RegExp(`(?:\\(|\\b(?:NYSE|NASDAQ|AMEX|NYSE American|NYSEARCA)\\s*:\\s*|\\$)${ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(h.text);
  if (!nameOk && !tickerStated) {
    return { ...base, found: false, url: null, how: null, matchedName: co.name, filingDate: null, text: null, kindMatch: false, detail: `Ticker ${ticker} maps to ${co.name || `CIK ${co.cik}`} on EDGAR, but the event text does not name that company, so its filings were not used.` };
  }
  const evMs = parseMs(claim.eventDate);
  if (evMs == null) return { ...base, found: false, url: null, how: null, matchedName: co.name, filingDate: null, text: null, kindMatch: false, detail: 'The event has no date, so its EDGAR filing cannot be matched by date.' };
  let best: { r: EdgarRecent; score: number; dist: number } | null = null;
  for (const r of co.recent) {
    const t = parseMs(r.filingDate ? `${r.filingDate}T12:00:00Z` : ''); if (t == null) continue;
    const dist = Math.abs(t - evMs); if (dist > (LOCATE_WINDOW_DAYS + 0.5) * DAY_MS) continue;
    const score = edgarFormScore(r.form, r.items, h.eventType); if (score <= 0) continue;
    if (!secIndexUrl(co.cik, r.accession)) continue;
    if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { r, score, dist };
  }
  if (!best) return { ...base, found: false, url: null, how: null, matchedName: co.name, filingDate: null, text: null, kindMatch: false, detail: `Searched EDGAR filings of ${co.name || ticker} (CIK ${co.cik}): none of a fitting form within ${LOCATE_WINDOW_DAYS} days of ${isoDay(evMs)}.` };
  const r = best.r;
  return { ...base, found: true, url: secIndexUrl(co.cik, r.accession), how: 'edgar_by_cik', matchedName: co.name, filingDate: r.filingDate, text: null, kindMatch: best.score >= 2,
    detail: `SEC ${r.form}${r.items?.length ? ` (items ${r.items.join(', ')})` : ''} filed ${r.filingDate} by ${co.name || ticker} (CIK ${co.cik}, ticker ${ticker} named by the event), within ${LOCATE_WINDOW_DAYS} days of the event.` };
}

// ── zzz1057: US / global news with NO ticker: EDGAR full-text search by the company name ─────────
// 69 + 50 of the first 300 "No company document" rows were US / global stories that name a company but no ticker ("The event
// names no US ticker, so EDGAR could not be searched by CIK"). EDGAR's own full-text search finds that company's filings by
// name within the date window; a hit is used ONLY when the FILER's name is the same company as a name the event itself carries.

export interface EdgarNameHit { cik: number; company: string; form: string; filingDate: string; accession: string; items?: string[] }

/** Names worth a full-text search: carried by the event text, at least one distinctive (non-group, non-sector) word. */
export function searchableNames(h: NonNullable<VerifyClaim['locateHints']>): string[] {
  return Array.from(new Set(h.names.map((n) => String(n || '').trim()).filter((n) => n.length >= 3 && nameInText(n, h.text) && nameTokens(n).some((t) => !GENERIC_WORDS.has(t) && t.length >= 3)))).slice(0, 2);
}

/** The company's own filing among full-text hits: same company as the event's name, a fitting form, within the window. */
export function locateUsByName(claim: VerifyClaim, name: string, hits: ReadonlyArray<EdgarNameHit>, now: Date): LocatedDoc {
  const h = claim.locateHints!;
  const base = { claimId: claim.claimId, checkedAt: now.toISOString() };
  const evMs = parseMs(claim.eventDate);
  if (evMs == null) return { ...base, found: false, url: null, how: null, matchedName: null, filingDate: null, text: null, kindMatch: false, detail: 'The event has no date, so its EDGAR filing cannot be matched by date.' };
  let best: { r: EdgarNameHit; score: number; dist: number } | null = null;
  for (const r of hits) {
    if (!sameCompany(name, r.company)) continue;                         // the filer itself, never a company that merely mentions it
    const t = parseMs(r.filingDate ? `${r.filingDate.slice(0, 10)}T12:00:00Z` : ''); if (t == null) continue;
    const dist = Math.abs(t - evMs); if (dist > (LOCATE_WINDOW_DAYS + 0.5) * DAY_MS) continue;
    const score = edgarFormScore(r.form, r.items, h.eventType); if (score <= 0) continue;
    if (!secIndexUrl(r.cik, r.accession)) continue;
    if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { r, score, dist };
  }
  if (!best) return { ...base, found: false, url: null, how: null, matchedName: null, filingDate: null, text: null, kindMatch: false, detail: `EDGAR full-text search for "${name}": no filing by that company of a fitting form within ${LOCATE_WINDOW_DAYS} days of ${isoDay(evMs)}.` };
  const r = best.r;
  return { ...base, found: true, url: secIndexUrl(r.cik, r.accession), how: 'edgar_by_name', matchedName: r.company, filingDate: r.filingDate, text: null, kindMatch: best.score >= 2,
    detail: `SEC ${r.form}${r.items?.length ? ` (items ${r.items.join(', ')})` : ''} filed ${r.filingDate.slice(0, 10)} by ${r.company} (CIK ${r.cik}), found by an EDGAR full-text search for the name the event gives, within ${LOCATE_WINDOW_DAYS} days of the event.` };
}

// ── real wiring (lazy imports; tests inject their own locate) ──────────────

export interface LocateIo {
  /** NSE / BSE announcements we already hold (null = could not be read: unknown, never "none") */
  indiaFilings(): Promise<ExchangeFiling[] | null>;
  /** ticker → CIK; throws when the SEC ticker map could not be loaded (unknown, not "no filer") */
  cikForTicker(t: string): Promise<number | null>;
  /** EDGAR submissions (null = could not be read) */
  submissions(cik: number): Promise<EdgarCompany | null>;
  /** zzz1057: EDGAR full-text search for a name in a date range (null = could not be read: unknown, search again next run) */
  searchByName?(name: string, fromIso: string, toIso: string, forms: string[]): Promise<EdgarNameHit[] | null>;
  now?: () => Date;
}

/** Search documents for claims. A claim missing from the result was not searched (data unavailable / out of time): retried next run. */
export async function locateDocs(claims: ReadonlyArray<VerifyClaim>, io: LocateIo, o: { deadline: number; maxUs?: number } = { deadline: Date.now() + 15_000 }): Promise<Map<string, LocatedDoc>> {
  const out = new Map<string, LocatedDoc>();
  const now = (io.now || (() => new Date()))();
  const base = (c: VerifyClaim) => ({ claimId: c.claimId, checkedAt: now.toISOString(), url: null, how: null as PrimaryHow | null, matchedName: null, filingDate: null, text: null, kindMatch: false });
  const india = claims.filter((c) => c.locateHints?.region === 'IN');
  const us = claims.filter((c) => c.locateHints && c.locateHints.region !== 'IN');
  if (india.length) {
    const filings = await io.indiaFilings().catch(() => null);
    if (filings) {
      const cov = coverageOf(filings);
      for (const c of india) { const r = locateIndia(c, filings, now, cov); if (r) out.set(c.claimId, r); }
    }
  }
  let usDone = 0;
  const maxUs = o.maxUs ?? 120;
  for (const c of us) {
    if (Date.now() > o.deadline || usDone >= maxUs) break;
    const h = c.locateHints!;
    const tickers = Array.from(new Set(h.tickers.map((t) => String(t).trim().toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.-]{0,6}$/.test(t)))).slice(0, 3);
    if (!tickers.length) {
      // zzz1057: no ticker → search EDGAR by the company name the event gives (when the I/O supports it)
      const names = io.searchByName ? searchableNames(h) : [];
      const evMs = parseMs(c.eventDate);
      if (!names.length || evMs == null) { out.set(c.claimId, { ...base(c), found: false, detail: names.length ? 'The event has no date, so its EDGAR filing cannot be matched by date.' : 'The event names no US ticker and no distinctive company name, so EDGAR could not be searched.' }); continue; }
      usDone++;
      const from = isoDay(evMs - (LOCATE_WINDOW_DAYS + 1) * DAY_MS); const to = isoDay(evMs + (LOCATE_WINDOW_DAYS + 1) * DAY_MS);
      const forms = FORMS_BY_KIND[kindFamily(h.eventType)];
      let res: LocatedDoc | null = null; let unknownN = false;
      for (const n of names) {
        const hits = await io.searchByName!(n, from, to, forms).catch(() => null);
        if (!hits) { unknownN = true; continue; }
        const r = locateUsByName(c, n, hits, now);
        if (r.found) { res = r; break; }
        if (!res) res = r;
      }
      if (res?.found || (res && !unknownN)) out.set(c.claimId, res!);
      continue;   // unknown (EDGAR not readable): search again next run
    }
    usDone++;
    let result: LocatedDoc | null = null; let unknown = false; const tried: string[] = [];
    for (const t of tickers) {
      let cik: number | null;
      try { cik = await io.cikForTicker(t); } catch { unknown = true; break; }
      if (!cik) { tried.push(`${t} (not an SEC filer)`); continue; }
      const subs = await io.submissions(cik).catch(() => null);
      if (!subs) { unknown = true; continue; }
      const r = locateUsFromSubmissions(c, subs, t, now);
      if (r.found) { result = r; break; }
      tried.push(r.detail);
      if (!result) result = r;
    }
    if (result?.found) out.set(c.claimId, result);
    else if (unknown) continue;   // SEC could not be read: search again next run
    else out.set(c.claimId, result ? { ...result, detail: tried.join(' ').slice(0, 400) || result.detail } : { ...base(c), found: false, detail: `No SEC filer for ${tried.join(', ') || tickers.join(', ')}.` });
  }
  return out;
}

const INDIA_MEMO_MS = 10 * 60_000;
let indiaMemo: { at: number; rows: ExchangeFiling[] } | null = null;

/** Production I/O: the scraped NSE / BSE announcements in KV (corp-filings blob, concall-feed window, stored sub-windows) and SEC EDGAR. */
export function realLocateIo(): LocateIo {
  return {
    indiaFilings: async () => {
      if (indiaMemo && Date.now() - indiaMemo.at < INDIA_MEMO_MS) return indiaMemo.rows;
      const { kvGet } = await import('./kv');
      const cf = await import('./concall-feed');
      const race = <T>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
      const wins = cf.subWindowsFor(90, new Date());
      const [blob, feed, ...subs] = await Promise.all([
        race(kvGet<any>('corp-filings:v1:latest'), 5_000),
        race(cf.readConcallFeedWithFallback(cf.makeKvFeedIo(4_000)), 8_000),
        ...wins.map((w) => race(kvGet<any>(cf.SUBWIN_STORE_KEY(w.fromIso, w.toIso)), 5_000)),
      ]);
      const rows: ExchangeFiling[] = [];
      const seen = new Set<string>();
      const add = (arr: any) => { if (!Array.isArray(arr)) return; for (const f of arr) { const k = `${f?.exchange}|${f?.symbol}|${f?.subject}|${f?.filing_datetime}`; if (f && !seen.has(k)) { seen.add(k); rows.push(f); } } };
      add(blob?.filings);
      add((feed as any)?.feed?.filings);
      for (const s of subs) { add((s as any)?.nse?.filings); add((s as any)?.bse?.filings); }
      if (!rows.length) return null;   // nothing readable: unknown, not "no filing"
      indiaMemo = { at: Date.now(), rows };
      return rows;
    },
    cikForTicker: async (t) => { const m = await import('./us-edgar'); return (await m.cikForTicker(t)).cik; },
    searchByName: async (name, fromIso, toIso, forms) => { const m = await import('./us-edgar'); return m.edgarNameSearch(name, fromIso, toIso, forms); },
    submissions: async (cik) => {
      const m = await import('./us-edgar');
      const s = await m.submissions(cik);
      return s ? { cik, name: s.name, tickers: s.tickers, recent: s.recent.slice(0, 400) } : null;
    },
  };
}
