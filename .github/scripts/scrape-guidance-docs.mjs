#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// zzz857 — collect the companies' OWN guidance-bearing documents (India).
//
// Runs in GitHub Actions (NSE/BSE refuse Railway's datacenter range). For each
// day of the window it lists BSE corporate announcements across ALL companies
// (AnnSubCategoryGetData), keeps earnings-call transcripts, investor
// presentations, results press releases and AGM / chairman speeches, downloads
// each PDF (≤ 15 MB), extracts text with `pdftotext -layout`, keeps documents
// that carry a guidance cue, and POSTs them in batches (≤ 25 docs / ≤ 4 MB) to
// /api/v1/guidance-docs/ingest (x-cron-secret).
//
// Fallbacks, per day: BSE direct → BSE via the mc-proxy worker (PROXY_URL +
// PROXY_SECRET, optional) → NSE corporate-announcements (cookie warm-up) → NSE
// via the proxy. A day every source failed is recorded as `failed` — never as
// zero filings.
//
// Logs carry counts only: never a secret, never document text, never names.
//
// Env:
//   CRON_SECRET (required to POST)   CRON_BASE_URL (default production URL)
//   DAYS (default 7, max 210 — zzz874: reaches the previous quarter's calls so a raise can be compared)        BSE_MODE auto|sub|all (default auto)
//   MAX_DOWNLOADS (default 600)      RUN_BUDGET_MIN (default 50)
//   PROXY_URL / PROXY_SECRET (optional mc-proxy worker)
//   INCLUDE_PLAIN_RESULTS=1 (also read plain "Financial Results" PDFs; large)
//   DRY_RUN=1 (collect + extract, do not POST)
//
// zzz916 additions:
//   • NSE SME (Emerge) companies are listed too (corporate-announcements index=sme), every day, best effort.
//   • An INTIMATION (a short letter saying the transcript / recording / deck is "available at <link>") is never stored as the
//     document and never marked "read, no guidance": its links are followed, then Screener.in's concall list for the company
//     (the call nearest before the filing). Still not found → recorded as a pending intimation (server list) and retried on later runs.
//   • Screener.in concall sweep: SCREENER_TICKERS (NSE symbols or BSE codes) and, with SCREENER_QUEUE=1, the India companies whose
//     call / presentation filings sit in the events queue: every transcript (or the deck when there is no transcript) of a call on or
//     after the window start is collected. This is how BSE-only companies are reached while BSE refuses GitHub's network.
//     SCREENER_MAX (company pages per run; default 40 scheduled, 800 manual), SCREENER_DELAY_MS (default 1500).
//
// zzz921 — targeted RE-COLLECT (RECOLLECT_TICKERS = comma list, ≤ 30; RECOLLECT_DAYS default 120, max 210):
//   for just those companies the seen / known memory is ignored: their filings (NSE per-symbol, BSE per-scrip, Screener.in concall list) over the
//   window are listed, downloaded and read again, and posted with reextract = true so the store overwrites the document, clears its "extracted" flag
//   and the extractor's old result, and the extractor reads it again. The day-by-day listing and the pending-intimation / queue sweeps do NOT run
//   in that mode. Empty RECOLLECT_TICKERS → nothing here runs and the collector behaves exactly as before.
//   RECOLLECT_MAX_PER_COMPANY (default 10) caps the documents re-read per company, newest first.
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifySubject, extractPeriodHint, hasGuidanceCue, isUnreadableText, findLinkedPdfs, isIntimationText,
  bseRowToFiling, nseRowToFiling, parseEquityL, parseBseScripList, parseCuratedMap, resolveTicker,
  buildDoc, chunkBatches, docIdFor, dayList, MAX_BATCH_DOCS, MAX_BATCH_BYTES,
  parseScreenerCompany, screenerSearchPath, normaliseExchangePdfUrl, pickConcallFor, concallsSince, callDateFrom, parseTickerList, sweepTarget,
  parseRecollectTickers, recollectDays, parseBseScripIds, validBseCode, nseRangeUrl, bseScripRangeUrl,
} from './guidance-docs-lib.mjs';
import { installResilientFetch, exitTransient, exitForError } from './lib/resilient-fetch.mjs';   // zzz908

export { classifySubject, extractPeriodHint, hasGuidanceCue, buildDoc, chunkBatches, docIdFor };

export const COLLECTOR = 'gh-india-guidance-docs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BSE_HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.bseindia.com/', Origin: 'https://www.bseindia.com' };
const NSE_HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements' };
const PDF_MAX_BYTES = 15 * 1024 * 1024;

// BSE category / subcategory pairs read in `sub` mode. Names as the BSE
// filter uses them (the concall live-feed reads the first three already).
export const BSE_SUB_QUERIES = [
  { cat: 'Company Update', sub: 'Earnings Call Transcript' },
  { cat: 'Company Update', sub: 'Investor Presentation' },
  { cat: 'Company Update', sub: 'Analyst / Investor Meet' },
  { cat: 'Company Update', sub: 'Press Release / Media Release' },
  { cat: 'Result', sub: '-1' },
  { cat: 'AGM/EGM', sub: '-1' },
];

const ymd = (iso) => iso.replace(/-/g, '');
const ddmmyyyy = (iso) => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };

// ── HTTP with retries ───────────────────────────────────────────────────────

export function makeHttp(deps) {
  const { fetch: f, sleep, log } = deps;
  /** GET with retries + backoff on 429 / 5xx / network. 401/403 → no retry. */
  async function get(url, init = {}, o = {}) {
    const retries = o.retries ?? 3;
    const timeoutMs = o.timeoutMs ?? 20_000;
    let last = 'no response';
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) return { res, error: null };
        last = `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403 || res.status === 404) return { res: null, error: last };
      } catch (e) {
        last = e?.name === 'TimeoutError' ? 'timeout' : 'network error';
      }
      if (i < retries) await sleep(1500 * 2 ** i + Math.floor(Math.random() * 500));
    }
    return { res: null, error: last };
  }
  return { get, log };
}

function proxied(url, env) {
  if (!env.PROXY_URL) return null;
  const base = env.PROXY_URL.replace(/\/+$/, '').replace(/\/proxy$/, '');
  const sec = env.PROXY_SECRET ? `secret=${encodeURIComponent(env.PROXY_SECRET)}&` : '';
  return `${base}/proxy?${sec}url=${encodeURIComponent(url)}`;
}

// ── BSE listing ─────────────────────────────────────────────────────────────

/** All rows for one BSE query on one day, paged by ROWCNT. null = failed. */
async function bseQueryDay(http, deps, day, q, viaProxy, o = {}) {
  const rows = [];
  for (let page = 1; page <= 120; page++) {
    const target = o.scrip
      ? bseScripRangeUrl({ scrip: o.scrip, from: day, to: o.toDay || day, page })   // zzz921: one company over a date range
      : `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=${encodeURIComponent(q.cat)}&strPrevDate=${ymd(day)}&strScrip=&strSearch=P&strToDate=${ymd(day)}&strType=C&subcategory=${encodeURIComponent(q.sub)}`;
    const url = viaProxy ? proxied(target, deps.env) : target;
    if (!url) return null;
    const { res } = await http.get(url, { headers: BSE_HEADERS }, { retries: 2 });
    if (!res) return page === 1 ? null : rows;     // a later page failing keeps what was read
    let j = null;
    try { j = JSON.parse(await res.text()); } catch { j = null; }
    if (j === null) return page === 1 ? null : rows;
    const table = Array.isArray(j?.Table) ? j.Table : [];
    if (!table.length) break;                        // "No Record Found" / past the last page
    rows.push(...table);
    const total = Number(j?.Table1?.[0]?.ROWCNT || 0);
    if (!total || rows.length >= total) break;
    await deps.sleep(deps.apiDelayMs);
  }
  return rows;
}

async function listBseDay(http, deps, day, mode) {
  const queries = mode === 'all' ? [{ cat: '-1', sub: '-1' }] : BSE_SUB_QUERIES;
  const out = [];
  let failed = 0, viaProxy = false;
  for (const q of queries) {
    let rows = await bseQueryDay(http, deps, day, q, false);
    if (rows === null && deps.env.PROXY_URL) { rows = await bseQueryDay(http, deps, day, q, true); if (rows !== null) viaProxy = true; }
    if (rows === null) { failed++; continue; }
    out.push(...rows);
    await deps.sleep(deps.apiDelayMs);
  }
  if (failed === queries.length) return { ok: false, rows: [], source: 'BSE' };
  // partly failed: the rows read are kept, but the day is retried on NSE too
  return { ok: failed === 0, partial: failed > 0, rows: out, source: viaProxy ? 'BSE_PROXY' : 'BSE' };
}

// ── NSE listing ─────────────────────────────────────────────────────────────

async function nseCookie(deps) {
  try {
    const res = await deps.fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(10_000) });
    const set = res.headers.getSetCookie?.() || [];
    return set.map((c) => c.split(';')[0]).join('; ');
  } catch { return ''; }
}

async function listNseDay(http, deps, day, index = 'equities') {
  return listNseUrl(http, deps, `https://www.nseindia.com/api/corporate-announcements?index=${index}&from_date=${ddmmyyyy(day)}&to_date=${ddmmyyyy(day)}`);
}

async function listNseUrl(http, deps, target) {
  if (!deps.nseCookieValue) deps.nseCookieValue = await nseCookie(deps);
  let { res } = await http.get(target, { headers: { ...NSE_HEADERS, Cookie: deps.nseCookieValue } }, { retries: 1 });
  if (!res) { deps.nseCookieValue = await nseCookie(deps); ({ res } = await http.get(target, { headers: { ...NSE_HEADERS, Cookie: deps.nseCookieValue } }, { retries: 1 })); }
  let source = 'NSE';
  if (!res && deps.env.PROXY_URL) { ({ res } = await http.get(proxied(target, deps.env), {}, { retries: 1 })); source = 'NSE_PROXY'; }
  if (!res) return { ok: false, rows: [], source: 'NSE' };
  let j = null;
  try { j = JSON.parse(await res.text()); } catch { j = null; }
  const rows = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null;
  if (!rows) return { ok: false, rows: [], source };
  return { ok: true, rows, source };
}

// ── ticker maps ─────────────────────────────────────────────────────────────

async function loadTickerMaps(http, deps) {
  const maps = { isinToNse: new Map(), bseToIsin: new Map(), curated: new Map() };
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    maps.curated = parseCuratedMap(await readFile(join(here, '../../frontend/src/lib/bse-nse-mapping.ts'), 'utf8'));
  } catch { /* optional */ }
  for (const u of ['https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', 'https://archives.nseindia.com/content/equities/EQUITY_L.csv']) {
    const { res } = await http.get(u, { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' } }, { retries: 1 });
    if (!res) continue;
    const m = parseEquityL(await res.text());
    if (m.size > 500) { maps.isinToNse = m; break; }
  }
  {
    const target = 'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active';
    for (const u of [target, proxied(target, deps.env)].filter(Boolean)) {
      const { res } = await http.get(u, { headers: BSE_HEADERS }, { retries: 1, timeoutMs: 40_000 });
      if (!res) continue;
      let rows = null;
      try { rows = JSON.parse(await res.text()); } catch { rows = null; }
      const m = parseBseScripList(Array.isArray(rows) ? rows : rows?.Table);
      if (m.size > 500) { maps.bseToIsin = m; maps.bseIdToCode = parseBseScripIds(Array.isArray(rows) ? rows : rows?.Table); break; }
    }
  }
  return maps;
}

// ── PDF download + text ─────────────────────────────────────────────────────

/** Download a PDF (≤ 15 MB) directly, then through the proxy. */
async function downloadPdf(http, deps, url) {
  const headers = { 'User-Agent': UA, Accept: 'application/pdf,*/*', Referer: url.includes('nseindia') ? 'https://www.nseindia.com/' : 'https://www.bseindia.com/' };
  const hops = [url, /bseindia\.com|nseindia\.com/.test(url) ? proxied(url, deps.env) : null].filter(Boolean);
  let last = 'error';
  for (const u of hops) {
    const { res, error } = await http.get(u, { headers }, { retries: 2, timeoutMs: 60_000 });
    if (!res) { last = error || 'error'; continue; }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > PDF_MAX_BYTES) return { buf: null, outcome: 'too_big' };
    const reader = res.body?.getReader?.();
    const chunks = []; let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > PDF_MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } return { buf: null, outcome: 'too_big' }; }
        chunks.push(value);
      }
    } else {
      const ab = new Uint8Array(await res.arrayBuffer());
      if (ab.byteLength > PDF_MAX_BYTES) return { buf: null, outcome: 'too_big' };
      chunks.push(ab); total = ab.byteLength;
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
    if (buf.subarray(0, 1024).indexOf('%PDF') < 0) { last = 'not a pdf'; continue; }
    return { buf, outcome: 'ok' };
  }
  return { buf: null, outcome: last === 'not a pdf' ? 'unreadable' : 'error' };
}

/** Default pdftotext runner (poppler-utils). */
export async function pdftotextCli(buf) {
  const dir = await mkdtemp(join(tmpdir(), 'gdoc-'));
  const file = join(dir, 'doc.pdf');
  try {
    await writeFile(file, buf);
    return await new Promise((resolve) => {
      execFile('pdftotext', ['-layout', '-enc', 'UTF-8', '-q', file, '-'], { maxBuffer: 64 * 1024 * 1024, timeout: 90_000 }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── ingest client ───────────────────────────────────────────────────────────

async function postIngest(deps, body) {
  if (deps.env.DRY_RUN === '1') return true;
  const url = `${deps.baseUrl}/api/v1/guidance-docs/ingest`;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': deps.env.CRON_SECRET || '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        deps.counts.ingestRejected += Array.isArray(j?.rejected) ? j.rejected.length : 0;
        return true;
      }
      deps.log(`ingest HTTP ${res.status}`);
      if (res.status === 400 || res.status === 401 || res.status === 413) return false;
    } catch { deps.log('ingest network error'); }
    await deps.sleep(3000 * 2 ** i);
  }
  return false;
}

/** Known docIds plus (zzz916) the server's pending intimations and, when asked, the India tickers waiting in the events queue. */
async function knownIds(deps, o = {}) {
  const empty = { known: new Set(), intimations: [], queueTickers: [] };
  if (!deps.env.CRON_SECRET) return empty;
  try {
    const q = `market=IN&extras=1${o.queue ? '&queueTickers=1' : ''}`;
    const res = await deps.fetch(`${deps.baseUrl}/api/v1/guidance-docs/ingest?${q}`, { headers: { 'x-cron-secret': deps.env.CRON_SECRET }, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) { deps.log(`known-ids HTTP ${res.status} (continuing without)`); return empty; }
    const j = await res.json();
    return {
      known: new Set(Array.isArray(j?.known) ? j.known : []),
      intimations: Array.isArray(j?.intimations) ? j.intimations.filter((x) => x && typeof x.url === 'string' && /^[0-9a-f]{20}$/.test(String(x.docId || ''))) : [],
      queueTickers: Array.isArray(j?.queueTickers) ? parseTickerList(j.queueTickers.join(',')) : [],
    };
  } catch { deps.log('known-ids unavailable (continuing without)'); return empty; }
}

// ── zzz916: Screener.in concall list ────────────────────────────────────────

const SCREENER = 'https://www.screener.in';
const SCREENER_HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };

/** The company's Screener page (consolidated, then standalone, then the search API), parsed. Cached per run; null when not found. */
async function screenerCompany(http, deps, token) {
  const key = String(token || '').toUpperCase();
  if (!key) return null;
  if (deps.screenerCache.has(key)) return deps.screenerCache.get(key);
  if (deps.screenerPages >= deps.screenerMax) return null;     // budget: a target not looked up this run is retried next run
  const get = async (path) => {
    deps.screenerPages++;
    const { res } = await http.get(`${SCREENER}${path}`, { headers: SCREENER_HEADERS }, { retries: 1, timeoutMs: 25_000 });
    await deps.sleep(deps.screenerDelayMs);
    return res ? res.text() : null;
  };
  let page = null;
  for (const path of [`/company/${encodeURIComponent(key)}/consolidated/`, `/company/${encodeURIComponent(key)}/`]) {
    const html = await get(path);
    if (html && /Concalls/i.test(html)) { page = parseScreenerCompany(html); break; }
  }
  if (!page) {
    const js = await get(`/api/company/search/?q=${encodeURIComponent(key)}`);
    let path = null;
    try { path = screenerSearchPath(JSON.parse(js || '[]'), key); } catch { path = null; }
    if (path) { const html = await get(path); if (html && /Concalls/i.test(html)) page = parseScreenerCompany(html); }
  }
  deps.screenerCache.set(key, page);
  return page;
}

/**
 * zzz861 — claim-driven collection. The server lists the companies a media claim names whose own document is not on file yet (GET /api/v1/guidance-pipeline,
 * from the claims table; no company is named in this script). A filing from one of them is read even when its subject is a plain "Financial Results" /
 * "Outcome of Board Meeting" (those are skipped for everybody else), because that is where a results release usually states guidance.
 */
export async function fetchWanted(deps) {
  try {
    const res = await deps.fetch(`${deps.baseUrl}/api/v1/guidance-pipeline?market=IN&window=24H`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) { deps.log(`wanted list HTTP ${res.status} (continuing without)`); return []; }
    const j = await res.json();
    return Array.isArray(j?.wanted) ? j.wanted.filter((w) => w && w.market === 'IN') : [];
  } catch { deps.log('wanted list unavailable (continuing without)'); return []; }
}
const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(limited|ltd|pvt|private|plc|inc|corporation|corp|co)\b/g, ' ').replace(/\s+/g, ' ').trim();
export function wantedMatcher(wanted) {
  const names = new Set(wanted.map((w) => normName(w.company)).filter(Boolean));
  const ticks = new Set(wanted.map((w) => String(w.ticker || '').toUpperCase()).filter(Boolean));
  return (f) => (f.nseSymbol && ticks.has(String(f.nseSymbol).toUpperCase())) || names.has(normName(f.company));
}
const WANTED_SUBJECT = /result|outcome of board|presentation|transcript|conference call|earnings call|investor|press release|media release|guidance|outlook/i;

/** Per-day status → coverage rows for guidance-docs:v1:coverage:IN (failed stays failed; a partial read is 'partial'). */
export function coverageRows(statusDays, at) {
  const out = {};
  for (const d of statusDays) {
    const status = d.status === 'failed' ? 'failed' : d.partial ? 'partial' : 'ok';
    out[d.date] = { status, filings: d.filings ?? 0, docs: d.stored ?? 0, at };
  }
  return out;
}

// ── main run (all I/O injected) ─────────────────────────────────────────────

const RESOLVABLE_KINDS = new Set(['TRANSCRIPT', 'PRESENTATION', 'RESULTS_RELEASE', 'AGM_SPEECH']);

/**
 * @param {{ fetch: typeof fetch, pdftotext: (buf: Buffer) => Promise<string>, sleep?: (ms:number)=>Promise<void>, log?: (s:string)=>void, env?: Record<string,string|undefined>, now?: Date }} d
 */
export async function run(d) {
  const env = d.env || process.env;
  const manual = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const deps = {
    fetch: d.fetch, pdftotext: d.pdftotext, env,
    sleep: d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    log: d.log || ((s) => console.log(s)),
    apiDelayMs: Number(env.API_DELAY_MS ?? 400),
    baseUrl: (env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, ''),
    nseCookieValue: '',
    // zzz916: Screener.in budget (company pages per run) and pacing
    screenerMax: Math.max(0, Number(env.SCREENER_MAX ?? (manual ? 800 : 40)) || 0),
    screenerDelayMs: Math.max(0, Number(env.SCREENER_DELAY_MS ?? 1500) || 0),
    screenerPages: 0, screenerCache: new Map(),
    counts: { listed: 0, matched: 0, known: 0, downloaded: 0, stored: 0, unreadable: 0, noCue: 0, tooBig: 0, errors: 0, linked: 0, posted: 0, postFailed: 0, ingestRejected: 0,
      smeListed: 0, intimations: 0, intimationsResolved: 0, intimationsPending: 0, screenerPages: 0, screenerDocs: 0, screenerOffHost: 0 },
  };
  const http = makeHttp(deps);
  const now = d.now || new Date();
  const days = Math.max(1, Math.min(210, Number(env.DAYS) || 7));
  const mode = ['sub', 'all', 'auto'].includes(env.BSE_MODE) ? env.BSE_MODE : 'auto';
  const maxDownloads = Math.max(1, Number(env.MAX_DOWNLOADS) || 600);
  const deadline = Date.now() + Math.max(1, Number(env.RUN_BUDGET_MIN) || 50) * 60_000;
  const includePlainResults = env.INCLUDE_PLAIN_RESULTS === '1';
  const c = deps.counts;

  // zzz921: targeted re-collect. Empty RECOLLECT_TICKERS -> recollectRequested is false and nothing below changes.
  const recollectRequested = String(env.RECOLLECT_TICKERS || '').trim() !== '';
  const recollect = recollectRequested ? parseRecollectTickers(env.RECOLLECT_TICKERS) : [];
  if (recollectRequested && !recollect.length) {
    deps.log('recollect: RECOLLECT_TICKERS held no valid NSE symbol / BSE code; nothing to do');
    return { counts: c, statusDays: [], stoppedBy: 'bad_recollect_input' };
  }
  const server = recollectRequested ? { known: new Set(), intimations: [], queueTickers: [] } : await knownIds(deps, { queue: env.SCREENER_QUEUE === '1' });
  const known = server.known;
  // zzz921: in re-collect mode the known memory is ignored (only a per-run set stops the same url being read twice)
  const reDone = new Set();
  let bypassKnown = false;
  const isKnown = (id) => (bypassKnown ? reDone.has(id) : known.has(id));
  const markKnown = (id) => { known.add(id); reDone.add(id); };
  const wanted = env.WANTED === '0' || recollectRequested ? [] : await fetchWanted(deps);
  const isWanted = wantedMatcher(wanted);
  deps.log(`wanted companies: ${wanted.length}; pending intimations: ${server.intimations.length}; queue tickers: ${server.queueTickers.length}`);
  const maps = await loadTickerMaps(http, deps);
  deps.log(`maps: isin→nse ${maps.isinToNse.size}, bse→isin ${maps.bseToIsin.size}, curated ${maps.curated.size}; known docs ${known.size}`);

  const pending = [];        // docs waiting to be posted
  const seen = [];           // skipped docIds
  const intimations = [];    // zzz916: intimations still waiting for the real document
  const statusDays = [];
  let downloads = 0, stoppedBy = null;

  const pendingRe = [];      // zzz921: re-collected docs (posted with reextract = true)
  const flush = async (final) => {
    for (const [list, reextract] of [[pending, false], [pendingRe, true]]) {
      const batches = chunkBatches(list.splice(0), { maxDocs: MAX_BATCH_DOCS, maxBytes: MAX_BATCH_BYTES });
      for (const b of batches) {
        const ok = await postIngest(deps, { market: 'IN', collector: COLLECTOR, docs: b, ...(reextract ? { reextract: true } : {}), seen: seen.splice(0, 2000), intimations: intimations.splice(0, 500) });
        if (ok) c.posted += b.length; else c.postFailed += b.length;
      }
    }
    if (final || seen.length >= 500 || intimations.length >= 200) {
      while (seen.length || intimations.length) {
        const ok = await postIngest(deps, { market: 'IN', collector: COLLECTOR, docs: [], seen: seen.splice(0, 2000), intimations: intimations.splice(0, 500) });
        if (!ok) break;
      }
    }
  };

  /** Download + read one PDF; null when it cannot be read. */
  const readPdf = async (url) => {
    const dl = await downloadPdf(http, deps, url);
    if (!dl.buf) return { text: null, outcome: dl.outcome };
    c.downloaded++;
    return { text: await deps.pdftotext(dl.buf), outcome: 'ok' };
  };

  /**
   * zzz916 — the real document behind an intimation, from the company's Screener.in concall list: the call nearest before the
   * exchange filing; the transcript for a transcript intimation, the deck for a presentation (each falls back to the other).
   * Returns { text, url, kind, company } or null. Never returns the intimation itself, another intimation, or an unreadable PDF.
   */
  const usedThisRun = new Set();
  const resolveViaScreener = async (t) => {
    const token = t.bseCode || t.ticker;   // a BSE code is unambiguous on Screener; an NSE symbol is the page name
    if (!token || Date.now() > deadline) return null;
    const page = await screenerCompany(http, deps, token);
    if (!page) return null;
    const call = pickConcallFor(page.concalls, t.filedAt);
    if (!call) return null;
    const order = t.kind === 'PRESENTATION' ? [call.ppt, call.transcript] : [call.transcript, call.ppt];
    for (const raw of order.filter(Boolean)) {
      const url = normaliseExchangePdfUrl(raw);
      if (!url) continue;
      const id = docIdFor(url);
      // a document already stored is posted again WITH the intimation as its exchangeUrl, so the store retires the intimation (idempotent per docId)
      if (id === t.docId || usedThisRun.has(id)) continue;
      const r = await readPdf(url);
      if (!r.text || isUnreadableText(r.text) || isIntimationText(r.text)) continue;
      markKnown(id); usedThisRun.add(id);
      return { text: r.text, url, kind: url === normaliseExchangePdfUrl(call.ppt || '') ? 'PRESENTATION' : 'TRANSCRIPT', company: page.name };
    }
    return null;
  };

  /**
   * Download, read and queue ONE filing (shared by the day loop and the zzz921 re-collect). Returns 'stored' | 'time' | 'max_downloads' | null.
   * ctx.re → the document goes to the re-extract batch (posted with reextract = true); ctx.ticker → the ticker the company was named by.
   */
  const handleMatch = async (f, kind, ctx = {}) => {
    if (Date.now() > deadline) return 'time';
    if (downloads >= maxDownloads) return 'max_downloads';
    const exId = docIdFor(f.url);
    if (isKnown(exId)) { c.known++; return null; }
    markKnown(exId);
    downloads++;
    const dl = await downloadPdf(http, deps, f.url);
    await deps.sleep(Math.max(150, deps.apiDelayMs / 2));
    if (!dl.buf) {
      if (dl.outcome === 'too_big') { c.tooBig++; seen.push({ docId: exId, outcome: 'too_big' }); }
      else if (dl.outcome === 'unreadable') { c.unreadable++; seen.push({ docId: exId, outcome: 'unreadable' }); }
      else c.errors++;                       // transient: retried next run
      return null;
    }
    c.downloaded++;
    let text = await deps.pdftotext(dl.buf);
    let docUrl = f.url, exchangeUrl = null, docKind = kind;
    const ticker = ctx.ticker || resolveTicker(f, maps);
    // a cover letter that links the real transcript / deck on the company site (zzz916: every candidate link, not only the first)
    if (RESOLVABLE_KINDS.has(kind)) {
      for (const linked of findLinkedPdfs(text)) {
        if (isKnown(docIdFor(linked))) continue;
        const l = await downloadPdf(http, deps, linked);
        if (!l.buf) continue;
        const lt = await deps.pdftotext(l.buf);
        if (!isUnreadableText(lt) && !isIntimationText(lt)) { text = lt; docUrl = linked; exchangeUrl = f.url; c.linked++; markKnown(docIdFor(linked)); break; }
      }
    }
    // zzz916: an intimation is not the document. Screener.in's concall list next; else it waits as a pending intimation.
    if (!exchangeUrl && RESOLVABLE_KINDS.has(kind) && isIntimationText(text)) {
      c.intimations++;
      const t = { docId: exId, url: f.url, ticker, bseCode: f.bseCode ?? null, company: f.company, kind, filedAt: f.filedAt };
      const real = await resolveViaScreener(t);
      if (real) { text = real.text; docUrl = real.url; exchangeUrl = f.url; docKind = real.kind; c.intimationsResolved++; }
      else { c.intimationsPending++; seen.push({ docId: exId, outcome: 'intimation' }); intimations.push(t); return null; }
    }
    if (isUnreadableText(text)) { c.unreadable++; seen.push({ docId: exId, outcome: 'unreadable' }); return null; }
    if (!hasGuidanceCue(text)) { c.noCue++; seen.push({ docId: exId, outcome: 'no_cue' }); return null; }
    const doc = buildDoc({ filing: f, kind: docKind, text, url: docUrl, exchangeUrl, ticker, collector: COLLECTOR });
    if (exchangeUrl) seen.push({ docId: exId, outcome: 'linked' });
    (ctx.re ? pendingRe : pending).push(doc);
    c.stored++;
    if (pending.length >= MAX_BATCH_DOCS || pendingRe.length >= MAX_BATCH_DOCS) await flush(false);
    return 'stored';
  };

  /**
   * One Screener.in company: every transcript (or deck) of a call on or after the window start. ctx.re → documents go to the re-extract batch;
   * ctx.cap → stop after that many stored documents. Returns the number stored.
   */
  const sweepToken = async (token, ctx = {}) => {
    let stored = 0;
    const tg = sweepTarget(token);
    const page = await screenerCompany(http, deps, tg.lookup);
    if (!page) return 0;
    const ticker = tg.ticker || page.nseSymbol || null;
    const bseCode = tg.bseCode || page.bseCode || null;
    for (const call of concallsSince(page.concalls, windowStart)) {
      if (Date.now() > deadline) break;
      if (ctx.cap != null && stored >= ctx.cap) break;
      const raw = call.transcript || call.ppt;
      const url = raw ? normaliseExchangePdfUrl(raw) : null;
      if (!url) continue;
      let host = '';
      try { host = new URL(url).hostname; } catch { continue; }
      // a company-site link needs an exchange filing to vouch for it (store host policy); the sweep has none
      if (!/(^|\.)(bseindia\.com|nseindia\.com)$/.test(host)) { c.screenerOffHost++; continue; }
      const id = docIdFor(url);
      if (isKnown(id)) { c.known++; continue; }
      markKnown(id);
      const r = await readPdf(url);
      if (!r.text) { if (r.outcome === 'too_big' || r.outcome === 'unreadable') seen.push({ docId: id, outcome: r.outcome }); else c.errors++; continue; }
      if (isUnreadableText(r.text)) { c.unreadable++; seen.push({ docId: id, outcome: 'unreadable' }); continue; }
      if (isIntimationText(r.text)) { c.intimations++; seen.push({ docId: id, outcome: 'intimation' }); continue; }
      if (!hasGuidanceCue(r.text)) { c.noCue++; seen.push({ docId: id, outcome: 'no_cue' }); continue; }
      const kind = call.transcript ? 'TRANSCRIPT' : 'PRESENTATION';
      const hint = extractPeriodHint(r.text.slice(0, 3000));
      const f = { exchange: 'BSE', bseCode: bseCode ?? null, nseSymbol: ticker, company: page.name || ticker || token, subject: `${kind === 'TRANSCRIPT' ? 'Earnings call transcript' : 'Investor presentation'} (${call.label} call; Screener.in concall list)`, headline: hint ? `${hint} ${kind === 'TRANSCRIPT' ? 'earnings call transcript' : 'investor presentation'} (${call.label})` : '', filedAt: callDateFrom(r.text, call.month), url };
      (ctx.re ? pendingRe : pending).push(buildDoc({ filing: f, kind, text: r.text, url, ticker, collector: COLLECTOR }));
      c.screenerDocs++; c.stored++; stored++;
      if (pending.length >= MAX_BATCH_DOCS || pendingRe.length >= MAX_BATCH_DOCS) await flush(false);
    }
    return stored;
  };

  /**
   * zzz924: the BSE scrip code of an NSE-style symbol, one lookup per company: (1) the BSE scrip master already loaded for the run (its trading id),
   * (2) the company's Screener.in page ("BSE: 5xxxxx"; cached, so the later concall sweep reuses it). A code must be 6 digits starting with 5;
   * a Screener page naming a different NSE symbol is not this company. null = could not resolve.
   */
  const resolveBseCode = async (symbol) => {
    const sym = String(symbol || '').toUpperCase();
    const fromList = validBseCode(maps.bseIdToCode?.get(sym));
    if (fromList) return { code: fromList, via: 'BSE scrip list' };
    const page = await screenerCompany(http, deps, sym);
    const code = validBseCode(page?.bseCode);
    if (code && (!page.nseSymbol || page.nseSymbol === sym)) return { code, via: 'Screener.in' };
    return null;
  };

  /** zzz921: one company's filings over a date range: NSE per symbol (equities, then SME), BSE per scrip. Strictly that company's rows. */
  const listCompanyRange = async (tg, from, to) => {
    const out = []; const byUrl = new Set();
    const add = (f) => { if (f && !byUrl.has(f.url)) { byUrl.add(f.url); out.push(f); } };
    if (tg.ticker) {
      if (!deps.nseCookieValue) deps.nseCookieValue = await nseCookie(deps);
      for (const index of ['equities', 'sme']) {
        const r = await listNseUrl(http, deps, nseRangeUrl({ symbol: tg.ticker, index, from, to }));
        await deps.sleep(deps.apiDelayMs);
        if (!r.ok) continue;
        const rows = r.rows.map(nseRowToFiling).filter((f) => f && f.nseSymbol === tg.ticker);
        rows.forEach(add);
        if (rows.length) break;
      }
    }
    // zzz924: a symbol-only entry that lists nothing on NSE (equities and SME) is probably BSE-only: find its BSE scrip code and list BSE filings
    let bseCode = tg.bseCode;
    if (!bseCode && tg.ticker && !out.length) {
      const hit = await resolveBseCode(tg.ticker);
      if (hit) { bseCode = hit.code; deps.log(`recollect: ${tg.ticker}: BSE code ${hit.code} (resolved via ${hit.via})`); }
      else deps.log(`recollect: ${tg.ticker}: listed 0 on NSE and no BSE code could be resolved (not in the BSE scrip list, Screener.in gave none); give it as ${tg.ticker}:<BSE code>`);
    }
    if (bseCode) {
      let rows = await bseQueryDay(http, deps, from, { cat: '-1', sub: '-1' }, false, { scrip: bseCode, toDay: to });
      if (rows === null && deps.env.PROXY_URL) rows = await bseQueryDay(http, deps, from, { cat: '-1', sub: '-1' }, true, { scrip: bseCode, toDay: to });
      (rows || []).map(bseRowToFiling).filter((f) => f && f.bseCode === bseCode).forEach(add);
      await deps.sleep(deps.apiDelayMs);
    }
    return out.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  };

  const daysList = dayList(days, now);
  const windowStart = daysList[daysList.length - 1];
  // zzz916: SKIP_LISTING=1 → only the Screener.in phase (the window still bounds which calls are collected)
  for (let di = 0; di < (env.SKIP_LISTING === '1' || recollectRequested ? 0 : daysList.length); di++) {
    const day = daysList[di];
    if (Date.now() > deadline) { stoppedBy = 'time'; break; }
    if (downloads >= maxDownloads) { stoppedBy = 'max_downloads'; break; }
    const dayMode = mode === 'auto' ? (di < 2 || manual ? 'all' : 'sub') : mode;

    // 1) list the day: BSE → (proxy) → NSE
    let filings = [];
    let source = 'NONE';
    const bse = await listBseDay(http, deps, day, dayMode);
    if (bse.ok || bse.partial) { filings = bse.rows.map(bseRowToFiling).filter(Boolean); source = bse.source; }
    if (!bse.ok) {
      const nse = await listNseDay(http, deps, day);
      if (nse.ok) {
        const nseFilings = nse.rows.map(nseRowToFiling).filter(Boolean);
        filings = filings.concat(nseFilings);
        source = bse.partial ? `${bse.source}+${nse.source}` : nse.source;
      } else if (!bse.partial) {
        statusDays.push({ date: day, source: 'NONE', status: 'failed', filings: null, matched: null, note: 'BSE and NSE listings failed' });
        deps.log(`${day}: FAILED (all sources)`);
        continue;
      }
    }
    // zzz916: NSE SME (Emerge) companies are not in index=equities — listed every day, best effort (a failure never fails the day)
    if (env.NSE_SME !== '0') {
      const sme = await listNseDay(http, deps, day, 'sme');
      if (sme.ok) { const sf = sme.rows.map(nseRowToFiling).filter(Boolean); c.smeListed += sf.length; filings = filings.concat(sf); }
    }
    c.listed += filings.length;

    // 2) classify, dedupe by url
    const seenUrl = new Set();
    const matches = [];
    for (const f of filings) {
      if (seenUrl.has(f.url)) continue;
      seenUrl.add(f.url);
      let kind = classifySubject(f.subject, { headline: f.headline, category: f.category, subcategory: f.subcategory, includePlainResults });
      if (!kind && wanted.length && isWanted(f)) {   // zzz861: a company a claim is waiting on: read its results / outcome filings too
        kind = classifySubject(f.subject, { headline: f.headline, category: f.category, subcategory: f.subcategory, includePlainResults: true })
          || (WANTED_SUBJECT.test(`${f.subject} ${f.headline}`) ? 'RESULTS_RELEASE' : null);
        if (kind) c.wanted = (c.wanted || 0) + 1;
      }
      if (kind) matches.push({ f, kind });
    }
    c.matched += matches.length;

    // 3) download + extract
    let dayStored = 0;
    for (const { f, kind } of matches) {
      const r = await handleMatch(f, kind);
      if (r === 'time' || r === 'max_downloads') { stoppedBy = r; break; }
      if (r === 'stored') dayStored++;
    }
    const complete = stoppedBy == null;
    statusDays.push({
      date: day, source, status: matches.length || filings.length ? 'ok' : 'empty',
      filings: filings.length, matched: matches.length, stored: dayStored, partial: !!bse.partial || !complete,
      note: `${dayMode}${bse.partial ? ' partial-bse' : ''}${complete ? '' : ' (stopped early)'}; stored ${dayStored}`,
    });
    deps.log(`${day}: ${source} listed ${filings.length}, matched ${matches.length}, new docs ${dayStored}`);
    if (stoppedBy) break;
  }

  // 3b) zzz921: targeted re-collect of the named companies (known / seen memory ignored; documents go out with reextract = true)
  if (recollectRequested) {
    const rdays = recollectDays(env.RECOLLECT_DAYS);
    const rl = dayList(rdays, now);
    const from = rl[rl.length - 1], to = rl[0];
    const perCompany = Math.max(1, Math.min(40, Number(env.RECOLLECT_MAX_PER_COMPANY) || 10));
    c.recollectTargets = recollect.length; c.recollectDocs = 0; c.recollectListed = 0;
    deps.log(`recollect: ${recollect.length} companies, ${from} → ${to}, up to ${perCompany} documents each`);
    bypassKnown = true;
    try {
      for (const token of recollect) {
        if (Date.now() > deadline) { stoppedBy = 'time'; break; }
        if (downloads >= maxDownloads) { stoppedBy = 'max_downloads'; break; }
        const tg = sweepTarget(token);
        let stored = 0;
        const filings = await listCompanyRange(tg, from, to);
        c.recollectListed += filings.length; c.listed += filings.length;
        const matches = [];
        for (const f of filings) {
          const kind = classifySubject(f.subject, { headline: f.headline, category: f.category, subcategory: f.subcategory, includePlainResults });
          if (kind) matches.push({ f, kind });
        }
        c.matched += matches.length;
        for (const { f, kind } of matches) {
          if (stored >= perCompany) break;
          const r = await handleMatch(f, kind, { re: true, ticker: tg.ticker });
          if (r === 'time' || r === 'max_downloads') { stoppedBy = r; break; }
          if (r === 'stored') stored++;
        }
        // Screener.in's concall list adds the calls the exchange listing did not give (and reaches BSE-only companies)
        if (!stoppedBy && stored < perCompany && deps.screenerMax > 0 && !(Date.now() > deadline) && deps.screenerPages < deps.screenerMax) {
          stored += await sweepToken(token, { re: true, cap: perCompany - stored });
        }
        c.recollectDocs += stored;
        deps.log(`recollect: ${token}: listed ${filings.length}, matched ${matches.length}, re-read ${stored}`);
        if (stoppedBy) break;
      }
    } finally { bypassKnown = false; }
  }

  // 4) zzz916: Screener.in — intimations waiting from earlier runs, then the concall sweep (explicit tickers, events-queue tickers)
  const screenerStop = () => Date.now() > deadline || deps.screenerPages >= deps.screenerMax;
  if (deps.screenerMax > 0 && !recollectRequested) {
    // pending intimations: a different slice each run (stateless rotation) so a long list is not stuck on its first entries
    const pend = server.intimations.filter((t) => t.ticker || t.bseCode);
    const rot = pend.length ? Math.floor(now.getTime() / (2 * 3_600_000)) % pend.length : 0;
    for (const t of [...pend.slice(rot), ...pend.slice(0, rot)]) {
      if (screenerStop()) break;
      const real = await resolveViaScreener(t);
      if (!real) continue;
      const f = { exchange: 'NSE', bseCode: t.bseCode ?? null, nseSymbol: t.ticker ?? null, company: t.company || real.company || t.ticker || 'Unknown', subject: `${real.kind === 'PRESENTATION' ? 'Investor presentation' : 'Earnings call transcript'} (the exchange filing was an intimation)`, headline: '', filedAt: t.filedAt, url: t.url };
      if (!hasGuidanceCue(real.text)) { c.noCue++; continue; }
      pending.push(buildDoc({ filing: f, kind: real.kind, text: real.text, url: real.url, exchangeUrl: t.url, ticker: t.ticker ?? null, collector: COLLECTOR }));
      c.intimationsResolved++; c.stored++;
      if (pending.length >= MAX_BATCH_DOCS) await flush(false);
    }
    // the sweep
    const sweep = parseTickerList([env.SCREENER_TICKERS || '', ...(env.SCREENER_QUEUE === '1' ? server.queueTickers : [])].join(','));
    for (const token of sweep) {
      if (screenerStop()) { c.screenerStopped = sweep.length; break; }
      await sweepToken(token);
    }
  }
  c.screenerPages = deps.screenerPages;

  await flush(true);
  const failedDays = statusDays.filter((s) => s.status === 'failed').length;
  // status last, so it reflects what was actually posted
  const atIso = new Date().toISOString();
  if (!recollectRequested) await postIngest(deps, {
    market: 'IN', collector: COLLECTOR, docs: [], seen: [],
    coverage: { market: 'IN', days: coverageRows(statusDays, atIso) },
    status: { days: statusDays, run: { at: new Date().toISOString(), days, stored: c.posted, skipped: c.unreadable + c.noCue + c.tooBig, failedDays } },
  });
  deps.log(`done: ${JSON.stringify({ ...c, days, daysRead: statusDays.length, failedDays, stoppedBy })}`);
  return { counts: c, statusDays, stoppedBy };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (!process.env.CRON_SECRET && process.env.DRY_RUN !== '1') {
    console.error('::error title=Missing secret::CRON_SECRET is not set');
    process.exit(1);
  }
  installResilientFetch();
  run({ fetch: globalThis.fetch, pdftotext: pdftotextCli })
    .then((r) => {
      if (r.stoppedBy === 'bad_recollect_input') { console.error('::error title=Re-collect::recollect_tickers held no valid NSE symbol or BSE code'); process.exit(1); }
      if (r.counts.postFailed > 0) { console.error(`::error title=Ingest failed::${r.counts.postFailed} docs not stored`); process.exit(1); }
      const failed = r.statusDays.filter((s) => s.status === 'failed').length;
      if (failed && failed === r.statusDays.length) exitTransient('no day could be read from BSE or NSE (exchange outage / refusal); days stay marked failed and are re-read next run');
      if (failed) console.log(`::warning title=Some days failed::${failed} day(s) unread (recorded as failed)`);
    })
    .catch((e) => exitForError(e, 'Collector crashed'));
}
