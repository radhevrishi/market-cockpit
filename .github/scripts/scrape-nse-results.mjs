#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// zzz875 — collect NSE's FINANCIAL RESULTS list (the filings the Earnings hub
// confirms a results card from). NSE refuses the Railway server, so a company
// that filed its results could never be confirmed there and was dropped
// (ANSALAPI / HAWAENG / HIIL, Sat 3 Oct 2026). GitHub reaches NSE: this job
// reads /api/corporates-financial-results for the last DAYS days (one call per
// day) and POSTs the RAW rows to /api/v1/nse-results/ingest (x-cron-secret).
// Logs carry counts only: never a secret.
//
// Env: CRON_SECRET (required)  CRON_BASE_URL (default production)  DAYS (default 7, max 60)  DRY_RUN=1
// ═══════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'node:url';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-financial-results' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);
const ddmmyyyy = (isoDay) => { const [y, m, d] = isoDay.split('-'); return `${d}-${m}-${y}`; };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ddMonyyyy = (isoDay) => { const [y, m, d] = isoDay.split('-'); return `${d}-${MON[Number(m) - 1]}-${y}`; };

/** IST calendar days, today first (NSE's broadcast day is an IST day). */
export function dayList(days, now = new Date()) {
  const out = [];
  for (let i = 0; i < days; i++) out.push(new Date(now.getTime() + 330 * 60_000 - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}
/** Rows out of whatever shape NSE answers with: a bare array, { data: [...] }, or the first array-valued property. */
export function rowsOf(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  if (Array.isArray(j.data)) return j.data;
  for (const v of Object.values(j)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  return [];
}
/** What the answer looked like, for the log (keys and lengths only, never values). */
export function shapeOf(j) {
  if (Array.isArray(j)) return `array[${j.length}]`;
  if (!j || typeof j !== 'object') return typeof j;
  return '{' + Object.entries(j).slice(0, 8).map(([k, v]) => `${k}:${Array.isArray(v) ? `array[${v.length}]` : typeof v}`).join(',') + '}';
}
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** Broadcast day (YYYY-MM-DD) of a raw row; null when absent. Mirrors lib/nse-results-store rowBroadcastDay. */
export function rowDay(r) {
  for (const c of [r?.broadCastDate, r?.re_broadcastDt, r?.broadcastDate, r?.re_date, r?.date, r?.re_submissionDate, r?.exchdisstime, r?.an_dt]) {
    const t = String(c ?? '').trim(); if (!t) continue;
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[-\s/](\d{4})/.exec(t); if (m) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`; }
    m = /^(\d{1,2})[-/](\d{2})[-/](\d{4})/.exec(t); if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

async function nseCookie(f) {
  // the results page itself (not the home page): NSE sets the api cookies for this section there
  let out = '';
  for (const u of ['https://www.nseindia.com/', 'https://www.nseindia.com/companies-listing/corporate-filings-financial-results']) {
    try {
      const res = await f(u, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', Cookie: out }, signal: AbortSignal.timeout(10_000) });
      const set = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]);
      if (set.length) out = [...new Set([...out.split('; ').filter(Boolean), ...set])].join('; ');
    } catch { /* keep what we have */ }
  }
  return out;
}
/** The mc-proxy worker hop (Cloudflare IPs are the one route NSE answers reliably); null when PROXY_URL is not set. */
function proxied(url, env) {
  if (!env.PROXY_URL) return null;
  const base = env.PROXY_URL.replace(/\/+$/, '').replace(/\/proxy$/, '');
  const sec = env.PROXY_SECRET ? `secret=${encodeURIComponent(env.PROXY_SECRET)}&` : '';
  return `${base}/proxy?${sec}nocache=1&url=${encodeURIComponent(url)}`;   // zzz879: never a cached "no data found"
}
const isWeekend = (isoDay) => { const w = new Date(`${isoDay}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
async function getJson(f, url, cookie) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await f(url, { headers: { ...HEADERS, Cookie: cookie }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) { try { return { ok: true, json: JSON.parse(await res.text()) }; } catch { return { ok: false, error: 'bad json' }; } }
      if (res.status === 401 || res.status === 403) return { ok: false, error: `HTTP ${res.status}`, blocked: true };
    } catch (e) { /* retry */ }
    await sleep(1500 * 2 ** i);
  }
  return { ok: false, error: 'no response' };
}

export async function run(d) {
  const env = d.env || process.env;
  const f = d.fetch; const log = d.log || ((s) => console.log(s));
  const baseUrl = (env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, '');
  const days = Math.max(1, Math.min(60, Number(env.DAYS) || 7));
  const list = dayList(days, d.now || new Date());
  log(`relay settings: PROXY_URL ${env.PROXY_URL ? 'set' : 'MISSING'}, PROXY_SECRET ${env.PROXY_SECRET ? 'set' : 'MISSING'}`);   // never the values
  let cookie = await nseCookie(f);
  const rows = []; const readDays = []; const failed = [];
  let shown = 0;
  // 0) the plain list (no dates): NSE's own page loads this first; it holds the latest filings. Rows are kept for the days asked.
  {
    const r = await getJson(f, 'https://www.nseindia.com/api/corporates-financial-results?index=equities', cookie);
    if (r.ok) { const got = rowsOf(r.json); log(`latest list: ${got.length} rows, shape ${shapeOf(r.json)}`); const want = new Set(list); for (const x of got) if (want.has(rowDay(x))) rows.push(x); }
    else log(`latest list: FAILED (${r.error})`);
    await sleep(400);
  }
  for (const day of list) {
    // one day per call: the list is small per day and a failure stays local to that day. The website's own query first
    // (DD-MM-YYYY with period=Quarterly), then the other spellings.
    const urls = [
      `https://www.nseindia.com/api/corporates-financial-results?index=equities&from_date=${ddmmyyyy(day)}&to_date=${ddmmyyyy(day)}&period=Quarterly`,
      `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${ddMonyyyy(day)}&to_date=${ddMonyyyy(day)}`,
      `https://www.nseindia.com/api/corporates-financial-results?index=equities&from_date=${ddmmyyyy(day)}&to_date=${ddmmyyyy(day)}`,
    ];
    let got = null; let last = null;
    for (const u of urls) {
      let r = await getJson(f, u, cookie);
      if (!r.ok && r.blocked) { cookie = await nseCookie(f); r = await getJson(f, u, cookie); }
      last = r;
      if (r.ok) { const rows = rowsOf(r.json); if (shown++ < 3) log(`${day}: answer shape ${shapeOf(r.json)}${typeof r.json?.msg === 'string' ? ` msg="${r.json.msg.slice(0, 120)}"` : ''}`); if (rows.length) { got = rows; break; } got = got || []; }
      await sleep(300);
    }
    // direct read empty or refused: the same queries through the mc-proxy worker (Cloudflare egress)
    if (!got || !got.length) {
      for (const u of urls) {
        const pu = proxied(u, env); if (!pu) { if (shown < 4) { log('proxy: PROXY_URL not set, no proxy hop'); shown = 4; } break; }
        const r = await getJson(f, pu, '');
        last = last && last.ok ? last : r;
        if (r.ok) { const rows = rowsOf(r.json); if (shown++ < 6) log(`${day}: proxy answer shape ${shapeOf(r.json)}${typeof r.json?.msg === 'string' ? ` msg="${r.json.msg.slice(0, 120)}"` : ''}`); if (rows.length) { got = rows; break; } got = got || []; }
        await sleep(300);
      }
    }
    if (got == null) { failed.push(day); log(`${day}: FAILED (${last?.error || 'no answer'})`); await sleep(400); continue; }
    // zero rows on a trading day cannot be told from a soft block ("no data found" is what a refused query says too): NOT a read day
    if (got.length || isWeekend(day)) readDays.push(day); else failed.push(day);
    rows.push(...got);
    log(`${day}: ${got.length} results rows${!got.length && !isWeekend(day) ? ' (weekday with zero rows: not counted as read)' : ''}`);
    await sleep(400);
  }
  let posted = false;
  if (env.DRY_RUN === '1') posted = true;
  else if (readDays.length) {
    for (let i = 0; i < 4 && !posted; i++) {
      try {
        const res = await f(`${baseUrl}/api/v1/nse-results/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.CRON_SECRET || '' }, body: JSON.stringify({ collector: 'gh-nse-results', rows: rows.slice(0, 8000), readDays }), signal: AbortSignal.timeout(90_000) });
        if (res.ok) { const j = await res.json().catch(() => ({})); log(`ingest ok: days ${j.daysWritten?.length ?? '?'}, rows ${j.rowsStored ?? '?'}, dropped ${j.dropped ?? '?'}`); posted = true; break; }
        log(`ingest HTTP ${res.status}`);
        if (res.status === 400 || res.status === 401 || res.status === 413) break;
      } catch { log('ingest network error'); }
      await sleep(3000 * 2 ** i);
    }
  }
  log(`done: ${JSON.stringify({ days, daysRead: readDays.length, failedDays: failed.length, rows: rows.length, posted })}`);
  return { readDays, failed, rows: rows.length, posted };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (!process.env.CRON_SECRET && process.env.DRY_RUN !== '1') { console.error('::error title=Missing secret::CRON_SECRET is not set'); process.exit(1); }
  run({ fetch: globalThis.fetch }).then((r) => {
    if (r.failed.length && r.failed.length === r.readDays.length + r.failed.length) { console.error('::error title=NSE refused every day::no day could be read'); process.exit(1); }
    if (!r.posted) { console.error('::error title=Ingest failed::rows were read but not stored'); process.exit(1); }
    if (r.failed.length) console.log(`::warning title=Some days failed::${r.failed.length} day(s) not read`);
  }).catch((e) => { console.error(`::error title=Collector crashed::${String(e?.message || e).slice(0, 200)}`); process.exit(1); });
}
