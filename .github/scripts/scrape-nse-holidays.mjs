#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// NSE TRADING HOLIDAYS  (zzz905)
//
// WHY. lib/market-hours.ts carried the 2026 holiday list only, so from 1 Jan
// 2027 every exchange holiday would be treated as a trading day (calendar
// windows, holiday skips, "is the market open", data-watch). This collects
// NSE's own list every month so the app keeps working for decades without a
// code edit.
//
// SOURCE. https://www.nseindia.com/api/holiday-master?type=trading — the
// list behind nseindia.com/resources/exchange-communication-holidays. The
// capital-market segment ("CM") is the equity segment the app cares about.
// NSE usually publishes next year's list in December, so the workflow also
// runs mid-December. Order of attempts:
//   1. direct, with browser-like headers and the home-page cookie
//   2. the mc-proxy Cloudflare worker (PROXY_URL / PROXY_SECRET, optional),
//      for when NSE's bot protection refuses GitHub's IPs
//
// MERGE, NEVER DROP. The stored blob is read first. A year in the fresh list
// replaces that year (NSE does revise lists); every year NOT in the fresh list
// is kept as it was. A failed or empty fetch writes nothing.
//
//   KV key: nse-holidays:v1
//   { updatedAt, source, years: { '2027': ['2027-01-26', ...] } }
// ═══════════════════════════════════════════════════════════════════════════

import { pathToFileURL } from 'node:url';
import { installResilientFetch, exitTransient, exitForError } from './lib/resilient-fetch.mjs';   // zzz908

export const KV_KEY = 'nse-holidays:v1';
export const KV_TTL = 5 * 365 * 24 * 3600;   // refreshed monthly; long enough to outlive any outage
const SOURCE_URL = 'https://www.nseindia.com/api/holiday-master?type=trading';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** '15-Jan-2026' (NSE's shape) or '2026-01-15' → '2026-01-15'; anything else → null. */
export function parseNseDate(s) {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(t);
  if (m) { const mo = MON[m[2].toLowerCase()]; return mo ? valid(+m[3], mo, +m[1]) : null; }
  return null;
}
function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** holiday-master JSON → { '2026': ['2026-01-15', …] } for the equity (CM) segment. */
export function yearsFromHolidayMaster(json, segment = 'CM') {
  const rows = Array.isArray(json?.[segment]) ? json[segment] : [];
  const years = {};
  for (const r of rows) {
    const d = parseNseDate(r?.tradingDate);
    if (!d) continue;
    (years[d.slice(0, 4)] ||= new Set()).add(d);
  }
  return Object.fromEntries(Object.entries(years).map(([y, s]) => [y, [...s].sort()]));
}

/**
 * Merge a fresh list into what is stored. Years present (non-empty) in `incoming` replace the stored year; every other
 * stored year is kept, and a year whose fresh list is under half the stored size is kept too (truncated response).
 * Returns the new blob, or null when the fetch brought no usable year.
 * @param {any} existing
 * @param {Record<string, string[]>} incoming
 * @param {{ source?: string, now?: Date }} [opts]
 */
export function mergeHolidayYears(existing, incoming, opts = {}) {
  const { source, now = new Date() } = opts;
  const prevYears = existing && typeof existing.years === 'object' && existing.years ? existing.years : {};
  const years = {};
  for (const [y, list] of Object.entries(prevYears)) if (/^\d{4}$/.test(y) && Array.isArray(list) && list.length) years[y] = [...list].sort();
  let changed = false;
  for (const [y, list] of Object.entries(incoming || {})) {
    if (!/^\d{4}$/.test(y) || !Array.isArray(list) || !list.length) continue;
    const next = [...new Set(list)].sort();
    // A response that suddenly lists far fewer dates for a year is more likely truncated than revised: keep what is stored.
    if (years[y] && next.length < Math.ceil(years[y].length / 2)) continue;
    if (JSON.stringify(years[y] || []) !== JSON.stringify(next)) changed = true;
    years[y] = next;
  }
  const added = Object.keys(incoming || {}).filter((y) => Array.isArray(incoming[y]) && incoming[y].length);
  if (!added.length) return null;
  const sorted = Object.fromEntries(Object.keys(years).sort().map((y) => [y, years[y]]));
  return { updatedAt: now.toISOString(), source: source || 'nse-holiday-master', years: sorted, changed };
}

// ── network ────────────────────────────────────────────────────────────────

async function nseCookie() {
  try {
    const r = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(15_000) });
    return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  } catch { return ''; }
}

async function getJson(url, headers) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
    if (!r.ok) return { json: null, status: r.status };
    const text = await r.text();
    try { return { json: JSON.parse(text), status: r.status }; } catch { return { json: null, status: r.status }; }
  } catch (e) { return { json: null, status: String(e?.name || 'error') }; }
}

function proxied(url) {
  const base = (process.env.PROXY_URL || '').replace(/\/+$/, '').replace(/\/proxy$/, '');
  if (!base) return null;
  const sec = process.env.PROXY_SECRET ? `secret=${encodeURIComponent(process.env.PROXY_SECRET)}&` : '';
  return `${base}/proxy?${sec}url=${encodeURIComponent(url)}`;
}

async function fetchHolidayMaster() {
  const headers = {
    'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.nseindia.com/resources/exchange-communication-holidays',
  };
  const cookie = await nseCookie();
  let { json, status } = await getJson(SOURCE_URL, cookie ? { ...headers, Cookie: cookie } : headers);
  console.log(`direct: ${status}`);
  if (json && Object.keys(yearsFromHolidayMaster(json)).length) return { json, source: 'nse-holiday-master' };
  const p = proxied(SOURCE_URL);
  if (p) {
    ({ json, status } = await getJson(p, {}));
    console.log(`proxy: ${status}`);
    if (json && Object.keys(yearsFromHolidayMaster(json)).length) return { json, source: 'nse-holiday-master-via-proxy' };
  } else console.log('proxy: not configured (PROXY_URL unset)');
  return null;
}

// ── KV (Upstash REST) ──────────────────────────────────────────────────────

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`KV get failed ${r.status}`);
  const j = await r.json();
  if (j?.result == null) return null;
  try { return typeof j.result === 'string' ? JSON.parse(j.result) : j.result; } catch { return null; }
}
async function kvSet(url, token, key, value, ttl) {
  const r = await fetch(`${url}/set/${encodeURIComponent(key)}?EX=${ttl}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV set failed ${r.status}`);
}

async function main() {
  const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!KV_URL || !KV_TOKEN) { console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.'); process.exit(1); }

  const got = await fetchHolidayMaster();
  if (!got) exitTransient('could not read the NSE holiday list (direct and proxy). Nothing written.');   // zzz908: NSE outage, next run retries
  const incoming = yearsFromHolidayMaster(got.json);
  for (const [y, l] of Object.entries(incoming)) console.log(`fetched ${y}: ${l.length} dates`);

  // A failed read of the stored blob must not let this run overwrite years it cannot see.
  const existing = await kvGet(KV_URL, KV_TOKEN, KV_KEY);
  const merged = mergeHolidayYears(existing, incoming, { source: got.source });
  if (!merged) { console.log('nothing to write'); return; }
  const { changed, ...blob } = merged;
  await kvSet(KV_URL, KV_TOKEN, KV_KEY, blob, KV_TTL);
  console.log(`wrote ${KV_KEY}: years ${Object.keys(blob.years).join(', ')}${changed ? '' : ' (no date changes, refreshed)'}`);
  const next = String(new Date().getUTCFullYear() + 1);
  if (new Date().getUTCMonth() === 11 && !blob.years[next]) console.log(`::warning title=NSE holidays::${next} list not published yet`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installResilientFetch();
  main().catch((e) => exitForError(e, 'NSE holidays'));
}
