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
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifySubject, extractPeriodHint, hasGuidanceCue, isUnreadableText, findLinkedPdf,
  bseRowToFiling, nseRowToFiling, parseEquityL, parseBseScripList, parseCuratedMap, resolveTicker,
  buildDoc, chunkBatches, docIdFor, dayList, MAX_BATCH_DOCS, MAX_BATCH_BYTES,
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
async function bseQueryDay(http, deps, day, q, viaProxy) {
  const rows = [];
  for (let page = 1; page <= 120; page++) {
    const target = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=${encodeURIComponent(q.cat)}&strPrevDate=${ymd(day)}&strScrip=&strSearch=P&strToDate=${ymd(day)}&strType=C&subcategory=${encodeURIComponent(q.sub)}`;
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

async function listNseDay(http, deps, day) {
  const target = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${ddmmyyyy(day)}&to_date=${ddmmyyyy(day)}`;
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
      if (m.size > 500) { maps.bseToIsin = m; break; }
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

async function knownIds(deps) {
  if (!deps.env.CRON_SECRET) return new Set();
  try {
    const res = await deps.fetch(`${deps.baseUrl}/api/v1/guidance-docs/ingest?market=IN`, { headers: { 'x-cron-secret': deps.env.CRON_SECRET }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { deps.log(`known-ids HTTP ${res.status} (continuing without)`); return new Set(); }
    const j = await res.json();
    return new Set(Array.isArray(j?.known) ? j.known : []);
  } catch { deps.log('known-ids unavailable (continuing without)'); return new Set(); }
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

/**
 * @param {{ fetch: typeof fetch, pdftotext: (buf: Buffer) => Promise<string>, sleep?: (ms:number)=>Promise<void>, log?: (s:string)=>void, env?: Record<string,string|undefined>, now?: Date }} d
 */
export async function run(d) {
  const env = d.env || process.env;
  const deps = {
    fetch: d.fetch, pdftotext: d.pdftotext, env,
    sleep: d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    log: d.log || ((s) => console.log(s)),
    apiDelayMs: Number(env.API_DELAY_MS ?? 400),
    baseUrl: (env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, ''),
    nseCookieValue: '',
    counts: { listed: 0, matched: 0, known: 0, downloaded: 0, stored: 0, unreadable: 0, noCue: 0, tooBig: 0, errors: 0, linked: 0, posted: 0, postFailed: 0, ingestRejected: 0 },
  };
  const http = makeHttp(deps);
  const now = d.now || new Date();
  const days = Math.max(1, Math.min(210, Number(env.DAYS) || 7));
  const mode = ['sub', 'all', 'auto'].includes(env.BSE_MODE) ? env.BSE_MODE : 'auto';
  const maxDownloads = Math.max(1, Number(env.MAX_DOWNLOADS) || 600);
  const deadline = Date.now() + Math.max(1, Number(env.RUN_BUDGET_MIN) || 50) * 60_000;
  const includePlainResults = env.INCLUDE_PLAIN_RESULTS === '1';
  const c = deps.counts;

  const known = await knownIds(deps);
  const wanted = env.WANTED === '0' ? [] : await fetchWanted(deps);
  const isWanted = wantedMatcher(wanted);
  deps.log(`wanted companies: ${wanted.length}`);
  const maps = await loadTickerMaps(http, deps);
  deps.log(`maps: isin→nse ${maps.isinToNse.size}, bse→isin ${maps.bseToIsin.size}, curated ${maps.curated.size}; known docs ${known.size}`);

  const pending = [];        // docs waiting to be posted
  const seen = [];           // skipped docIds
  const statusDays = [];
  let downloads = 0, stoppedBy = null;

  const flush = async (final) => {
    const batches = chunkBatches(pending.splice(0), { maxDocs: MAX_BATCH_DOCS, maxBytes: MAX_BATCH_BYTES });
    for (const b of batches) {
      const ok = await postIngest(deps, { market: 'IN', collector: COLLECTOR, docs: b, seen: seen.splice(0, 2000) });
      if (ok) c.posted += b.length; else c.postFailed += b.length;
    }
    if (final || seen.length >= 500) {
      while (seen.length) {
        const ok = await postIngest(deps, { market: 'IN', collector: COLLECTOR, docs: [], seen: seen.splice(0, 2000) });
        if (!ok) break;
      }
    }
  };

  const daysList = dayList(days, now);
  for (let di = 0; di < daysList.length; di++) {
    const day = daysList[di];
    if (Date.now() > deadline) { stoppedBy = 'time'; break; }
    if (downloads >= maxDownloads) { stoppedBy = 'max_downloads'; break; }
    const dayMode = mode === 'auto' ? (di < 2 || env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 'all' : 'sub') : mode;

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
      if (Date.now() > deadline) { stoppedBy = 'time'; break; }
      if (downloads >= maxDownloads) { stoppedBy = 'max_downloads'; break; }
      const exId = docIdFor(f.url);
      if (known.has(exId)) { c.known++; continue; }
      known.add(exId);
      downloads++;
      const dl = await downloadPdf(http, deps, f.url);
      await deps.sleep(Math.max(150, deps.apiDelayMs / 2));
      if (!dl.buf) {
        if (dl.outcome === 'too_big') { c.tooBig++; seen.push({ docId: exId, outcome: 'too_big' }); }
        else if (dl.outcome === 'unreadable') { c.unreadable++; seen.push({ docId: exId, outcome: 'unreadable' }); }
        else c.errors++;                       // transient: retried next run
        continue;
      }
      c.downloaded++;
      let text = await deps.pdftotext(dl.buf);
      let docUrl = f.url, exchangeUrl = null;
      // a cover letter that links the real transcript / deck on the company site
      const linked = (kind === 'TRANSCRIPT' || kind === 'PRESENTATION' || kind === 'AGM_SPEECH') ? findLinkedPdf(text) : null;
      if (linked && !known.has(docIdFor(linked))) {
        const l = await downloadPdf(http, deps, linked);
        if (l.buf) {
          const lt = await deps.pdftotext(l.buf);
          if (!isUnreadableText(lt)) { text = lt; docUrl = linked; exchangeUrl = f.url; c.linked++; known.add(docIdFor(linked)); }
        }
      }
      if (isUnreadableText(text)) { c.unreadable++; seen.push({ docId: exId, outcome: 'unreadable' }); continue; }
      if (!hasGuidanceCue(text)) { c.noCue++; seen.push({ docId: exId, outcome: 'no_cue' }); continue; }
      const ticker = resolveTicker(f, maps);
      const doc = buildDoc({ filing: f, kind, text, url: docUrl, exchangeUrl, ticker, collector: COLLECTOR });
      if (exchangeUrl) seen.push({ docId: exId, outcome: 'linked' });
      pending.push(doc);
      dayStored++; c.stored++;
      if (pending.length >= MAX_BATCH_DOCS) await flush(false);
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

  await flush(true);
  const failedDays = statusDays.filter((s) => s.status === 'failed').length;
  // status last, so it reflects what was actually posted
  const atIso = new Date().toISOString();
  await postIngest(deps, {
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
      if (r.counts.postFailed > 0) { console.error(`::error title=Ingest failed::${r.counts.postFailed} docs not stored`); process.exit(1); }
      const failed = r.statusDays.filter((s) => s.status === 'failed').length;
      if (failed && failed === r.statusDays.length) exitTransient('no day could be read from BSE or NSE (exchange outage / refusal); days stay marked failed and are re-read next run');
      if (failed) console.log(`::warning title=Some days failed::${failed} day(s) unread (recorded as failed)`);
    })
    .catch((e) => exitForError(e, 'Collector crashed'));
}
