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
import type { AnnouncementLite } from './catalyst-research';
import { announcementsFromSubmissions, secTickerCandidates } from './us-gainers';

const UA = 'MarketCockpit research (radhev.232@gmail.com)';
const TICKER_MAP_KEY = 'edgar:ticker-map:v1';
const MIN_SPACING_MS = 125;
const MAP_MEMO_MS = 24 * 3600_000;

let lastSecCall = 0;
let mapMemo: { at: number; map: Record<string, string> } | null = null;

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

async function loadTickerMap(timeoutMs: number): Promise<Record<string, string>> {
  if (mapMemo && Date.now() - mapMemo.at < MAP_MEMO_MS) return mapMemo.map;
  try {
    const hit = await kvGet<Record<string, string>>(TICKER_MAP_KEY);
    if (hit && Object.keys(hit).length > 1000) { mapMemo = { at: Date.now(), map: hit }; return hit; }
  } catch { /* fall through */ }
  const r = await secFetch('https://www.sec.gov/files/company_tickers.json', Math.max(timeoutMs, 8_000));
  if (!r.ok) throw new Error(secError('SEC ticker map', r.status));
  const j: any = await r.json();
  const map: Record<string, string> = {};
  for (const k of Object.keys(j || {})) {
    const e = j[k];
    if (e?.ticker && e?.cik_str != null) map[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, '0');
  }
  mapMemo = { at: Date.now(), map };
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
}

/** Filings for the ticker in the last `windowDays`, as announcements. */
export async function fetchEdgarResearch(ticker: string, windowDays: number, now = new Date(), opts: { timeoutMs?: number } = {}): Promise<EdgarResearch> {
  const timeoutMs = Math.max(2_000, Math.min(20_000, opts.timeoutMs ?? 12_000));
  const out: EdgarResearch = { ticker, cik: null, name: null, announcements: [], sources: [], errors: [] };
  let map: Record<string, string>;
  try { map = await loadTickerMap(timeoutMs); } catch (e: any) { out.errors.push(String(e?.message || e)); return out; }
  const cik = secTickerCandidates(ticker).map((t) => map[t]).find(Boolean) || null;
  out.cik = cik;
  if (!cik) { out.errors.push('ticker not in the SEC company list'); return out; }
  let sub: any;
  try {
    const r = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, timeoutMs);
    if (!r.ok) { out.errors.push(secError('EDGAR submissions', r.status)); return out; }
    sub = await r.json();
  } catch (e: any) { out.errors.push(`EDGAR: ${String(e?.message || e)}`); return out; }
  out.name = sub?.name || null;
  out.sources.push('SEC EDGAR submissions');
  out.announcements = announcementsFromSubmissions(sub, cik, windowDays, now);
  return out;
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
      const ex = items.find((it) => /ex[-_]?99/i.test(String(it?.name || '')) && /\.htm/i.test(String(it?.name || '')));
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
