#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0784 — NSE broad-indices scraper for GitHub Actions.
//
// Workflow #1 + #2 confirmed that NSE's main API (www.nseindia.com/api/
// equity-stockIndices) is fronted by Akamai's bot-detection layer.
// GitHub Actions IP range is blocked: only the Akamai sentinel cookie
// AKA_A2=A is issued, not the real NSE session cookies, and every
// /api call returns HTTP 404.
//
// Solution: use NSE's `archives.nseindia.com` infra instead. The
// archives subdomain serves static CSV files for:
//   • Ticker → index membership lists (constituent CSVs)
//   • End-of-day BHAVCOPY (full equity-cash market dump)
//
// archives.nseindia.com is a different CDN (not the Akamai-fronted
// API gateway) — accepts requests from any IP without session cookies.
//
// Strategy:
//   1. Pull constituent CSVs for Nifty 50 / Next 50 / Midcap 250 /
//      Smallcap 250 / Microcap 250 / Nifty 500. Build ticker→cap map.
//   2. Pull the latest BHAVCOPY (most recent trading day). Parse to
//      get last close, prev close, change, volume, day high/low,
//      year high/low.
//   3. Merge constituent lists with prices. Compute change/changePct
//      from close vs prevClose.
//
// Pure Node 20 — built-in fetch + zlib (gzip decompression). No deps.
//
// Required env (GH Actions secrets):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// ═══════════════════════════════════════════════════════════════════════════

import { gunzipSync } from 'node:zlib';

// ─── Config ─────────────────────────────────────────────────────────────────

const ARCHIVES_BASE = 'https://archives.nseindia.com';
const NSE_BASE = 'https://www.nseindia.com';

// Constituent list URLs — these are public CSVs hosted by NSE archives.
// First-match-wins on cap label (priority: Large → Mid → Small → Micro).
const CONSTITUENT_LISTS = [
  { name: 'Nifty 50',           url: `${ARCHIVES_BASE}/content/indices/ind_nifty50list.csv`,        cap: 'Large' },
  { name: 'Nifty Next 50',      url: `${ARCHIVES_BASE}/content/indices/ind_niftynext50list.csv`,    cap: 'Large' },
  { name: 'Nifty Midcap 250',   url: `${ARCHIVES_BASE}/content/indices/ind_niftymidcap250list.csv`, cap: 'Mid'   },
  { name: 'Nifty Smallcap 250', url: `${ARCHIVES_BASE}/content/indices/ind_niftysmallcap250list.csv`, cap: 'Small' },
  { name: 'Nifty Microcap 250', url: `${ARCHIVES_BASE}/content/indices/ind_niftymicrocap250list.csv`, cap: 'Micro' },
  { name: 'Nifty 500',          url: `${ARCHIVES_BASE}/content/indices/ind_nifty500list.csv`,        cap: 'Mid'   },
];

const FETCH_TIMEOUT_MS = 30_000;
const KV_KEY = 'nse-indices-blob:v1:latest';
const KV_TTL_SECONDS = 4 * 60 * 60; // 4h

// Headers that pass NSE archive CDN. Less strict than main API.
const ARCHIVE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/csv,application/octet-stream,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── Env validation ─────────────────────────────────────────────────────────

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN as repo secrets.');
  process.exit(1);
}

// ─── CSV helpers ────────────────────────────────────────────────────────────

function parseCsv(text) {
  // RFC-ish CSV parser handling quoted fields with commas.
  const out = [];
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return out;
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (cols[c] || '').trim();
    }
    out.push(row);
  }
  return out;
}

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

// ─── Fetch with timeout ─────────────────────────────────────────────────────

async function fetchCsv(url, label) {
  try {
    const res = await fetch(url, {
      headers: ARCHIVE_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) {
      console.log(`::warning title=${label}::HTTP ${res.status} from ${url}`);
      return null;
    }
    const text = await res.text();
    const rows = parseCsv(text);
    console.log(`  ${label.padEnd(22)} → ${rows.length} rows`);
    return rows;
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `timeout (${FETCH_TIMEOUT_MS}ms)` : (e?.message || String(e));
    console.log(`::warning title=${label}::${msg}`);
    return null;
  }
}

async function fetchBhavCopyGz(url, label) {
  try {
    const res = await fetch(url, {
      headers: { ...ARCHIVE_HEADERS, 'Accept': 'application/octet-stream,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) {
      console.log(`  ${label}: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const unzipped = gunzipSync(buf).toString('utf8');
    const rows = parseCsv(unzipped);
    console.log(`  ${label.padEnd(22)} → ${rows.length} rows`);
    return rows;
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `timeout (${FETCH_TIMEOUT_MS}ms)` : (e?.message || String(e));
    console.log(`  ${label}: ${msg}`);
    return null;
  }
}

// ─── Find most recent BHAVCOPY ──────────────────────────────────────────────
// BHAVCOPY filename pattern: cmDDMMMYYYYbhav.csv.gz (e.g. cm22MAY2026bhav.csv.gz)
// Walk back from yesterday looking for the most recent file that exists.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function bhavCopyUrl(d) {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const filename = `cm${day}${month}${year}bhav.csv.gz`;
  return `${ARCHIVES_BASE}/content/historical/EQUITIES/${year}/${month}/${filename}`;
}

async function findRecentBhavCopy() {
  // Walk back up to 10 calendar days
  const today = new Date();
  for (let back = 1; back <= 10; back++) {
    const d = new Date(today.getTime() - back * 86400_000);
    // Skip weekends — NSE doesn't publish Sat/Sun
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const url = bhavCopyUrl(d);
    const label = `BHAVCOPY ${d.toISOString().slice(0, 10)}`;
    const rows = await fetchBhavCopyGz(url, label);
    if (rows && rows.length > 100) {
      return { rows, dateISO: d.toISOString().slice(0, 10), url };
    }
  }
  return null;
}

// ─── Upstash KV writer ──────────────────────────────────────────────────────

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upstash SET failed: HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
  const j = await res.json().catch(() => ({}));
  if (j?.result !== 'OK' && j?.result !== 1) {
    throw new Error(`Upstash SET returned unexpected: ${JSON.stringify(j).slice(0, 200)}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-nse-indices (archives mode) at ${new Date().toISOString()}`);

  // Step 1: Build ticker → cap + company name map from constituent CSVs.
  // CSV columns vary by index file but generally include:
  //   "Company Name", "Industry", "Symbol", "Series", "ISIN Code"
  console.log('  ── Pulling constituent CSVs ──');
  const tickerCap = new Map();
  const tickerCompany = new Map();
  const tickerIndustry = new Map();

  for (const list of CONSTITUENT_LISTS) {
    const rows = await fetchCsv(list.url, list.name);
    if (!rows) continue;
    for (const row of rows) {
      const sym = (row['Symbol'] || row['symbol'] || '').trim().toUpperCase();
      if (!sym) continue;
      // First match wins for cap (priority order in CONSTITUENT_LISTS)
      if (!tickerCap.has(sym)) {
        tickerCap.set(sym, list.cap);
      }
      const company = row['Company Name'] || row['company name'] || row['company'] || '';
      const industry = row['Industry'] || row['industry'] || '';
      if (company && !tickerCompany.has(sym)) tickerCompany.set(sym, company);
      if (industry && !tickerIndustry.has(sym)) tickerIndustry.set(sym, industry);
    }
  }
  console.log(`  ticker universe: ${tickerCap.size} unique symbols`);

  if (tickerCap.size === 0) {
    console.log('::error title=No constituents::All constituent CSV fetches returned 0 rows.');
    process.exit(1);
  }

  // Step 2: Pull most recent BHAVCOPY for prices.
  console.log('  ── Pulling BHAVCOPY for prices ──');
  const bhav = await findRecentBhavCopy();
  if (!bhav) {
    console.log('::error title=No BHAVCOPY::Could not find a BHAVCOPY file within the last 10 weekdays.');
    process.exit(1);
  }
  console.log(`  using BHAVCOPY ${bhav.dateISO}`);

  // BHAVCOPY columns (canonical):
  //   SYMBOL, SERIES, OPEN, HIGH, LOW, CLOSE, LAST, PREVCLOSE, TOTTRDQTY,
  //   TOTTRDVAL, TIMESTAMP, TOTALTRADES, ISIN
  // We want SERIES='EQ' (regular equity, skip BE/EQ-special/etc).
  const priceMap = new Map();
  for (const row of bhav.rows) {
    const series = (row['SERIES'] || row[' SERIES'] || '').trim();
    if (series !== 'EQ') continue;
    const sym = (row['SYMBOL'] || row[' SYMBOL'] || '').trim().toUpperCase();
    if (!sym) continue;
    const close = Number(row['CLOSE']) || Number(row[' CLOSE']) || 0;
    const prevClose = Number(row['PREVCLOSE']) || Number(row[' PREVCLOSE']) || 0;
    const open = Number(row['OPEN']) || Number(row[' OPEN']) || 0;
    const high = Number(row['HIGH']) || Number(row[' HIGH']) || 0;
    const low = Number(row['LOW']) || Number(row[' LOW']) || 0;
    const volume = Number(row['TOTTRDQTY']) || Number(row[' TOTTRDQTY']) || 0;
    if (close <= 0) continue;
    const change = prevClose > 0 ? close - prevClose : 0;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    priceMap.set(sym, {
      price: close,
      previousClose: prevClose,
      change,
      changePercent: changePct,
      open,
      dayHigh: high,
      dayLow: low,
      volume,
    });
  }
  console.log(`  parsed ${priceMap.size} EQ-series prices from BHAVCOPY`);

  // Step 3: Merge → final stock list
  const stocks = [];
  for (const [sym, cap] of tickerCap) {
    const p = priceMap.get(sym);
    if (!p) continue; // skip symbols without a price in this BHAVCOPY
    stocks.push({
      ticker: sym,
      company: tickerCompany.get(sym) || sym,
      industry: tickerIndustry.get(sym) || '',
      cap,
      price: p.price,
      previousClose: p.previousClose,
      change: p.change,
      changePercent: p.changePercent,
      open: p.open,
      dayHigh: p.dayHigh,
      dayLow: p.dayLow,
      yearHigh: 0,
      yearLow: 0,
      volume: p.volume,
      ffmc: 0,
    });
  }

  const capBreakdown = stocks.reduce((acc, s) => { acc[s.cap] = (acc[s.cap] || 0) + 1; return acc; }, {});
  const elapsed = Date.now() - startedAt;
  console.log(`  totals: ${stocks.length} unique stocks · breakdown: ${JSON.stringify(capBreakdown)}`);

  if (stocks.length < 50) {
    console.log('::error title=Too few stocks::Merged result has <50 stocks. KV blob NOT updated.');
    process.exit(1);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    sourceBhavDate: bhav.dateISO,
    sourceBhavUrl: bhav.url,
    indexCounts: Object.fromEntries(
      CONSTITUENT_LISTS.map(l => [l.name, Array.from(tickerCap.entries()).filter(([_, c]) => c === l.cap).length])
    ),
    capBreakdown,
    totalStocks: stocks.length,
    stocks,
  };

  let payloadSize = JSON.stringify(payload).length;
  console.log(`  payload size: ${Math.round(payloadSize / 1024)} KB`);
  while (payloadSize > 900_000 && payload.stocks.length > 200) {
    payload.stocks = payload.stocks.slice(0, Math.floor(payload.stocks.length * 0.85));
    payloadSize = JSON.stringify(payload).length;
  }

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} (${payload.stocks.length} stocks, ${Math.round(payloadSize / 1024)} KB) in ${elapsed}ms`);
  console.log(`::notice title=Scrape complete::${payload.stocks.length} NSE stocks cached for 4h (BHAVCOPY ${bhav.dateISO}).`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
