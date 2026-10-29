#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0739 — NSE + BSE corporate-filings scraper for GitHub Actions.
//
// Pulls corp-announcements from NSE + BSE on the GH free CPU runner and
// writes a consolidated blob to Upstash. Vercel routes (concall-intel,
// order-book, rating-actions, special-situations) read this blob as a
// fallback when their fresh upstream calls fail (the 50% NSE failure
// rate documented in CLAUDE.md §18.8 / §18.11).
//
// Same architectural pattern as scrape-india-news.mjs:
//   - pure Node 20, no npm install
//   - one consolidated blob in Upstash (key: corp-filings:v1:latest)
//   - 24h TTL so stale blob serves until next run, never goes blank
//
// Required env vars (GH Actions secrets):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// ═══════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'node:url';
import { installResilientFetch, exitTransient, exitForError } from './lib/resilient-fetch.mjs';   // zzz908: retries + transient-vs-real exit

const KV_KEY         = 'corp-filings:v1:latest';
const KV_TTL_SECONDS = 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FILINGS    = 500;

// ─── Date helpers ──────────────────────────────────────────────────────────

function isoDaysAgo(n, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatNSEDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;   // NSE expects DD-MM-YYYY
}

// ─── NSE adapter ───────────────────────────────────────────────────────────

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
};

async function fetchNSECookies(f) {
  // NSE blocks API calls without a session cookie. Visit homepage first.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await f('https://www.nseindia.com/', {
      signal: ctl.signal,
      headers: { 'User-Agent': NSE_HEADERS['User-Agent'], 'Accept': 'text/html' },
      redirect: 'follow',
    });
    const cookies = res.headers.getSetCookie?.() || [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNSEFilings(f, now) {
  const from = isoDaysAgo(2, now);
  const to   = isoDaysAgo(0, now);
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${formatNSEDate(from)}&to_date=${formatNSEDate(to)}`;

  const cookie = await fetchNSECookies(f);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await f(url, {
      signal: ctl.signal,
      headers: { ...NSE_HEADERS, Cookie: cookie },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.log(`::warning title=NSE::HTTP ${res.status}`);
      return { ok: false, filings: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!Array.isArray(data) && !Array.isArray(data?.data)) return { ok: false, filings: [], error: 'invalid response shape' };
    const entries = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const filings = [];
    for (const e of entries) {
      const subject = String(e.subject || e.desc || '').trim();
      if (!subject) continue;
      const ts = e.an_dt || e.sm_dt || e.dt || e.broadcastdt;
      if (!ts) continue;
      let isoDt;
      try {
        const d = new Date(ts);
        if (!Number.isFinite(d.getTime())) continue;
        isoDt = d.toISOString();
      } catch { continue; }

      const symbol = String(e.symbol || '').trim().toUpperCase();
      const company = String(e.sm_name || e.company_name || symbol).trim();
      const urls = [];
      if (e.attchmntFile)   urls.push(String(e.attchmntFile));
      if (e.attachmentUrl)  urls.push(String(e.attachmentUrl));

      filings.push({
        exchange: 'NSE',
        symbol,
        company_name: company,
        subject,
        category:    e.csubject || e.category    || null,
        subcategory: e.smkt_cat || e.sub_category || null,
        filing_datetime: isoDt,
        attachment_urls: urls,
        source_url: `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(symbol)}`,
      });
    }
    console.log(`  NSE → ${filings.length} filings`);
    return { ok: true, filings };
  } catch (e) {
    console.log(`::warning title=NSE::${e?.message || e}`);
    return { ok: false, filings: [], error: 'network or unreadable response' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── BSE adapter ───────────────────────────────────────────────────────────

const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.bseindia.com/corporates/ann.html',
};

async function fetchBSEFilings(f, now, pages = 2) {
  let ok = true;
  const fromStr = isoDaysAgo(2, now).replace(/-/g, '');
  const toStr   = isoDaysAgo(0, now).replace(/-/g, '');
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=${p}&strCat=-1&strPrevDate=${fromStr}&strScrip=&strSearch=P&strToDate=${toStr}&strType=C`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await f(url, {
        signal: ctl.signal,
        headers: BSE_HEADERS,
        cache: 'no-store',
      });
      if (!res.ok) {
        ok = false;
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          console.log(`::warning title=BSE::HTTP ${res.status} — bailing`);
          break;
        }
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data?.Table)) { ok = false; continue; }
      const table = data.Table;
      for (const e of table) {
        const subject = String(e.NEWSSUB || e.HEADLINE || '').trim();
        if (!subject) continue;
        const ts = e.NEWS_DT || e.DT_TM;
        if (!ts) continue;
        let isoDt;
        try {
          const d = new Date(ts);
          if (!Number.isFinite(d.getTime())) continue;
          isoDt = d.toISOString();
        } catch { continue; }

        const symbol = String(e.SCRIP_CD || '').trim();
        const company = String(e.SLONGNAME || e.SHORTNAME || symbol).trim();
        const urls = [];
        if (e.ATTACHMENTNAME) {
          urls.push(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${e.ATTACHMENTNAME}`);
        }
        all.push({
          exchange: 'BSE',
          symbol,
          company_name: company,
          subject,
          category:    e.CATEGORYNAME || null,
          subcategory: e.SUBCATNAME   || null,
          filing_datetime: isoDt,
          attachment_urls: urls,
          source_url: `https://www.bseindia.com/stock-share-price/_/_/${symbol}/`,
        });
      }
    } catch (e) {
      ok = false; console.log(`::warning title=BSE page ${p}::network or unreadable response`);
    } finally {
      clearTimeout(timer);
    }
  }
  console.log(`  BSE → ${all.length} filings`);
  return { ok, filings: all, ...(!ok ? { error: 'source incomplete or unavailable' } : {}) };
}

// ─── Upstash KV writer (REST API) ──────────────────────────────────────────

// Source-specific freshness prevents a successful NSE read making carried BSE rows appear new.
export function mergeFilings(previous, readings, now = new Date()) {
  const cutoff = now.getTime() - 3 * 86400000;
  const sources = {}; const bySource = {};
  for (const exchange of ['NSE', 'BSE']) {
    const current = readings[exchange];
    const oldAt = previous?.sources?.[exchange]?.fetchedAt || previous?.generatedAt || null;
    const oldMs = Date.parse(oldAt || '');
    const retained = Number.isFinite(oldMs) && oldMs <= now.getTime() && now.getTime() - oldMs <= 86400000
      ? (previous?.filings || []).filter((x) => x.exchange === exchange && Date.parse(x.filing_datetime) >= cutoff) : [];
    const filings = current.ok ? current.filings : [...current.filings, ...retained];
    bySource[exchange] = filings;
    sources[exchange] = { state: current.ok ? 'fresh' : filings.length ? 'partial' : 'unavailable', fetchedAt: current.ok ? now.toISOString() : oldAt, fetched: current.filings.length, carried: current.ok ? 0 : retained.length };
  }
  const seen = new Set(); const unique = [];
  for (const f of [...bySource.NSE, ...bySource.BSE]) {
    const identity = `${f.exchange}|${(f.symbol || '').toUpperCase()}|${(f.subject || '').toLowerCase().trim()}|${f.filing_datetime}`;
    if (!seen.has(identity)) { seen.add(identity); unique.push(f); }
  }
  unique.sort((a, b) => b.filing_datetime.localeCompare(a.filing_datetime));
  // Keep at least the newest 100 from each available source before filling the remaining slots by time.
  const selected = new Set();
  for (const ex of ['NSE', 'BSE']) for (const f of unique.filter((x) => x.exchange === ex).slice(0, 100)) selected.add(f);
  for (const f of unique) if (selected.size < MAX_FILINGS) selected.add(f);
  const filings = unique.filter((f) => selected.has(f));
  return { generatedAt: now.toISOString(), sources, partial: Object.values(sources).some((s) => s.state !== 'fresh'), nseCount: readings.NSE.filings.length, bseCount: readings.BSE.filings.length, dedupedCount: unique.length, finalCount: filings.length, filings };
}

export async function run({ fetch: f = fetch, env = process.env, now = new Date() } = {}) {
  const url = env.UPSTASH_REDIS_REST_URL; const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN as repo secrets');
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function kv(command) {
    const r = await f(url.replace(/\/+$/, ''), { method: 'POST', headers: auth, body: JSON.stringify(command), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Filings storage HTTP ${r.status}`);
    const j = await r.json();
    if (j.error || !Object.hasOwn(j, 'result')) throw new Error('Filings storage refused command');
    return j.result;
  }
  let previous = await kv(['GET', KV_KEY]);
  for (let i = 0; i < 2 && typeof previous === 'string'; i++) previous = JSON.parse(previous);
  const [NSE, BSE] = await Promise.all([fetchNSEFilings(f, now), fetchBSEFilings(f, now)]);
  const payload = mergeFilings(previous, { NSE, BSE }, now);
  // Neither source worked: never replace the last good blob or renew its freshness.
  if (!NSE.filings.length && !BSE.filings.length && !NSE.ok && !BSE.ok) return { partial: true, stored: false };
  const crypto = await import('node:crypto');
  payload.filings = payload.filings.map((f) => ({ ...f, content_hash: f.content_hash || crypto.createHash('sha256').update(`${f.exchange}|${(f.symbol || '').toUpperCase()}|${(f.subject || '').toLowerCase().trim()}|${f.filing_datetime}`).digest('hex').slice(0, 16) }));
  // Trim by UTF-8 bytes (not JS character count). Source counts below describe the actually stored list.
  while (Buffer.byteLength(JSON.stringify(payload)) > 800000 && payload.filings.length) payload.filings.pop();
  payload.finalCount = payload.filings.length;
  for (const ex of ['NSE', 'BSE']) payload.sources[ex].stored = payload.filings.filter((f) => f.exchange === ex).length;
  await kv(['SET', KV_KEY, JSON.stringify(payload), 'EX', KV_TTL_SECONDS]);
  console.log(`Stored ${payload.finalCount} filings; NSE ${payload.sources.NSE.state}, BSE ${payload.sources.BSE.state}`);
  return { partial: payload.partial, stored: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installResilientFetch();
  run().then((r) => { if (r.partial) exitTransient('Corporate-filings collection partial; last-good rows retained with source-specific timestamps'); }).catch((e) => exitForError(e, 'Filings collector failed'));
}
