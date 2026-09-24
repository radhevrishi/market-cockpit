// ═══════════════════════════════════════════════════════════════════════════
// EDGAR AS THE US FILING SOURCE.                                     (zzz741)
//
// The US side had "no equivalent feed wired yet", so every US gainer was a
// quarterly result or nothing. SEC EDGAR's submissions API lists every
// filing per company with form type, date and — for 8-Ks — the item codes,
// which are a taxonomy already: 1.01 material agreement, 2.01 acquisition,
// 2.02 results, 3.02 unregistered sale (dilution), 5.02 officer change,
// 7.01/8.01 press release. Two fetches per name, no scraping, and the SEC
// asks only for a User-Agent that names the caller.
//
// Prices and trailing returns come from the TradingView export the page
// already reads (1M/3M/6M/1Y columns), so no market-data call is needed.
//
// zzz766 — SEC FAIR ACCESS AND A BOUNDED CLOCK.
//   · Every request carries the declared User-Agent and is spaced ≥ 125 ms
//     apart in this process (the SEC ceiling is 10 requests/second).
//   · The 800 KB ticker map is memoised in memory for a day. It was read from
//     KV per name and, when KV was unavailable (the Upstash quota incident),
//     re-downloaded from sec.gov for EVERY name on the board.
//   · Timeouts are passed in, so the research route can keep a sweep inside
//     its 60 s function limit (a 20 s + 20 s + model-read chain overran it and
//     the proxy answered "upstream error" — not JSON — to the page).
//   · The submissions → announcements mapping is pure and lives in
//     us-gainers.ts, where it is tested against captured EDGAR JSON.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import { classifyAnnouncement, type AnnouncementLite, type ClassifiedAnnouncement, type SweepInput } from './catalyst-research';
import { announcementsFromSubmissions, secTickerCandidates, extractUsPressRelease, usPlainSubject } from './us-gainers';
import { isKnownCatalyst } from './events';

const UA = 'MarketCockpit research (radhev.232@gmail.com)';
const TICKER_MAP_KEY = 'edgar:ticker-map:v1';
const MIN_SPACING_MS = 125;
const MAP_MEMO_MS = 24 * 3600_000;

let lastSecCall = 0;
let mapMemo: { at: number; map: Record<string, string>; live?: boolean } | null = null;
/** zzz782: a ticker missing from a cached map (a KV copy up to 7 days old)
 *  forces ONE live re-download per process per hour — a recent listing is
 *  otherwise "not in the SEC company list" for a week. */
const MAP_MISS_REFRESH_MS = 3600_000;
let lastMissRefresh = 0;

async function secFetch(url: string, timeoutMs: number): Promise<Response> {
  const wait = lastSecCall + MIN_SPACING_MS - Date.now();
  lastSecCall = Math.max(Date.now(), lastSecCall + MIN_SPACING_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate', Accept: 'application/json, text/html;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(timeoutMs), cache: 'no-store',
  });
}

function secError(what: string, status: number): string {
  if (status === 429 || status === 403) return `${what}: SEC rate-limited or refused the request (HTTP ${status}) — retry later`;
  return `${what} HTTP ${status}`;
}

async function loadTickerMap(timeoutMs: number, forceLive = false): Promise<Record<string, string>> {
  if (!forceLive && mapMemo && Date.now() - mapMemo.at < MAP_MEMO_MS) return mapMemo.map;
  if (!forceLive) {
    try {
      const hit = await kvGet<Record<string, string>>(TICKER_MAP_KEY);
      if (hit && Object.keys(hit).length > 1000) { mapMemo = { at: Date.now(), map: hit }; return hit; }
    } catch { /* fall through */ }
  }
  const r = await secFetch('https://www.sec.gov/files/company_tickers.json', Math.max(timeoutMs, 8_000));
  if (!r.ok) throw new Error(secError('SEC ticker map', r.status));
  const j: any = await r.json();
  const map: Record<string, string> = {};
  for (const k of Object.keys(j || {})) {
    const e = j[k];
    if (e?.ticker && e?.cik_str != null) map[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, '0');
  }
  mapMemo = { at: Date.now(), map, live: true };
  try { await kvSet(TICKER_MAP_KEY, map, 7 * 24 * 3600); } catch { /* best effort */ }
  return map;
}

export interface EdgarResearch {
  ticker: string;
  cik: string | null;
  name: string | null;
  announcements: AnnouncementLite[];
  sources: string[];
  errors: string[];
  /** zzz782: why nothing came back, so "not checked" is never shown as
   *  "checked, nothing filed". */
  failure?: 'cik_not_found' | 'ticker_map_failed' | 'submissions_failed' | null;
  /** Filings of any form in the window, and how many were insider Forms 3/4/5/144 (not listed). */
  filingsInWindow?: number;
  insiderForms?: number;
}

/** Filings for the ticker in the last `windowDays`, as announcements. */
export async function fetchEdgarResearch(ticker: string, windowDays: number, now = new Date(), opts: { timeoutMs?: number } = {}): Promise<EdgarResearch> {
  const timeoutMs = Math.max(2_000, Math.min(20_000, opts.timeoutMs ?? 12_000));
  const out: EdgarResearch = { ticker, cik: null, name: null, announcements: [], sources: [], errors: [] };
  let map: Record<string, string>;
  try { map = await loadTickerMap(timeoutMs); } catch (e: any) { out.errors.push(String(e?.message || e)); out.failure = 'ticker_map_failed'; return out; }
  let cik = secTickerCandidates(ticker).map((t) => map[t]).find(Boolean) || null;
  if (!cik && !mapMemo?.live && Date.now() - lastMissRefresh > MAP_MISS_REFRESH_MS) {
    lastMissRefresh = Date.now();
    try { map = await loadTickerMap(timeoutMs, true); cik = secTickerCandidates(ticker).map((t) => map[t]).find(Boolean) || null; } catch { /* keep the cached answer */ }
  }
  out.cik = cik;
  if (!cik) { out.errors.push('ticker not in the SEC company list'); out.failure = 'cik_not_found'; return out; }
  let sub: any;
  try {
    const r = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, timeoutMs);
    if (!r.ok) { out.errors.push(secError('EDGAR submissions', r.status)); out.failure = 'submissions_failed'; return out; }
    sub = await r.json();
  } catch (e: any) { out.errors.push(`EDGAR: ${String(e?.message || e)}`); out.failure = 'submissions_failed'; return out; }
  out.name = sub?.name || null;
  out.sources.push('SEC EDGAR submissions');
  const stats = { insiderForms: 0, inWindow: 0 };
  out.announcements = announcementsFromSubmissions(sub, cik, windowDays, now, stats);
  out.filingsInWindow = stats.inWindow;
  out.insiderForms = stats.insiderForms;
  return out;
}

// ── zzz782: THE FILING'S OWN WORDS, WITHOUT A MODEL ────────────────────────
//
// A US 8-K candidate used to be either model-read (paid, ceilinged, and only
// when an API key is set) or left as "document not parsed" with its value
// unknown. This reads the press release text (fetchEdgarText — EX-99.1 when
// there is one) with the same SEC fair-access headers and spacing, and:
//   · for a filing the FORM already classified (merger 8-K, 2.02 results,
//     2.01 completion, 425, SC TO-T…), returns a document read whose quote is
//     the verbatim sentence stating the value or the revenue — never a
//     figure the text does not state;
//   · for a filing only a reader can classify (1.01 / 7.01 / 8.01 / 6-K),
//     returns the release's lead sentence as the announcement SUMMARY. The
//     classifier then reads the company's own words, and the evidence stays
//     SUMMARY-level (materiality at 60%, capped below P1) — it is not a
//     verified reading.
// Returns null when nothing usable is stated. Never throws.

export type UsDocRead = NonNullable<SweepInput['read']>;
const DEAL_WORDS = /\b(contract|award|order|agreement|acquisition|merger|purchase)\b/i;

/** Pure: the document read / summary for a candidate from its text. */
export function usDocumentReadFromText(cand: ClassifiedAnnouncement, text: string): { read: UsDocRead | null; summary: string | null } {
  if (!text || text.length < 200) return { read: null, summary: null };
  const pr = extractUsPressRelease(text);
  const plain = usPlainSubject(cand.subject).replace(/ \[Item [^\]]*\]/, '').replace(/ · filed [\s\S]*$/, '').replace(/^[^:]+:\s*/, '');
  const facts = Object.keys(pr.facts).length ? { ...pr.facts } : null;
  if (cand.kind === 'catalyst' && isKnownCatalyst(cand.category)) {
    const category = cand.category;
    if (category === 'quarterly_result' && pr.revenueSentence) {
      return { read: { url: cand.url, headline: `Results released — ${pr.revenueSentence.slice(0, 160)}`, quote: pr.revenueSentence, category, valueStated: null, facts, source: 'document_extract' }, summary: null };
    }
    if (category !== 'quarterly_result' && pr.valueM != null && pr.valueSentence) {
      return { read: { url: cand.url, headline: `${plain.replace(/ \([^)]*\)$/, '')} — ${pr.valueSentence.slice(0, 160)}`, quote: pr.valueSentence, category, valueStated: pr.valueM, facts, source: 'document_extract' }, summary: null };
    }
    if (facts && pr.facts.price_terms) {
      // Terms without a stated deal value (per-share price only): the facts
      // travel, the value stays unknown.
      const q = /“([^”]+)”/.exec(pr.facts.price_terms)?.[1] || null;
      if (q && text.replace(/\s+/g, ' ').includes(q)) return { read: { url: cand.url, headline: `${plain.replace(/ \([^)]*\)$/, '')} — ${pr.facts.price_terms.split(' — ')[0]}`, quote: q, category, valueStated: null, facts, source: 'document_extract' }, summary: null };
    }
    return { read: null, summary: null };
  }
  if (cand.kind === 'unclassified' && pr.lead) {
    // The value sentence, when there is one, is the more useful summary: the
    // classifier takes its category and its figure from the same words.
    const summary = (pr.valueSentence && DEAL_WORDS.test(pr.valueSentence) ? `${pr.lead} ${pr.valueSentence}` : pr.lead).slice(0, 400);
    const c = classifyAnnouncement({ ...cand, summary }, 'US');
    // A summary that reads as a catalyst, routine or negative is worth
    // recording; one that still classifies nothing adds nothing.
    return c.kind === 'unclassified' ? { read: null, summary: null } : { read: null, summary };
  }
  return { read: null, summary: null };
}

/** Fetch + read one candidate filing. Null on any failure. */
export async function readUsFilingDocument(cand: ClassifiedAnnouncement, timeoutMs = 8_000): Promise<{ read: UsDocRead | null; summary: string | null } | null> {
  if (!/^https:\/\/www\.sec\.gov\//.test(String(cand.url || ''))) return null;
  try {
    const text = await fetchEdgarText(cand.url, timeoutMs);
    if (!text) return null;
    return usDocumentReadFromText(cand, text);
  } catch { return null; }
}

/** Fetch an EDGAR document as text. For an 8-K the press release usually sits
 *  in EX-99.1 beside the primary document; that is what a reader wants. */
export async function fetchEdgarText(url: string, timeoutMs = 12_000): Promise<string> {
  const dir = url.replace(/\/[^/]+$/, '/');
  let target = /-index\.htm$/i.test(url) ? '' : url;
  try {
    const r = await secFetch(`${dir}index.json`, timeoutMs);
    if (r.ok) {
      const j: any = await r.json();
      const items: any[] = j?.directory?.item || [];
      // zzz782: "exhibit991.htm" / "ex99-1.htm" / "d123dex991.htm" are all the
      // press release; 99.1 is preferred over 99.2 (often a slide deck).
      const exs = items.filter((it) => /(ex|exhibit)[-_ .]?99/i.test(String(it?.name || '')) && /\.htm/i.test(String(it?.name || '')));
      const ex = exs.find((it) => /99[-_ .]?0?1(?!\d)/.test(String(it?.name || ''))) || exs[0];
      if (ex?.name) target = `${dir}${ex.name}`;
      else if (!target) {
        const main = items.find((it) => /\.htm/i.test(String(it?.name || '')) && !/index/i.test(String(it?.name || '')));
        if (main?.name) target = `${dir}${main.name}`;
      }
    }
  } catch { /* the primary document is still a fine read */ }
  if (!target) return '';
  const r = await secFetch(target, timeoutMs);
  if (!r.ok) return '';
  return htmlToText(await r.text());
}

const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', bull: '•', reg: '®', trade: '™',
};

/** Filing HTML → text. Entities are DECODED, not blanked: "company&#8217;s"
 *  used to become "company s", so a verbatim quote containing an apostrophe or
 *  a dash never matched the document and a paid read was thrown away. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c === 160 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c === 0xa0 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&([a-z]+);/gi, (m, k) => NAMED[k.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim().slice(0, 60_000);
}
