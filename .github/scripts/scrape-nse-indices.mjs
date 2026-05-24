#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0786 — NSE constituent CSV scraper. Ticker → cap blob ONLY.
//
// Confirmed across runs #1-#4:
//   ✓ NSE archives.nseindia.com CSVs accessible from GH Actions IPs
//     (Nifty50 50 + Next50 54 + Smallcap250 250 + Nifty500 504 = 504 unique).
//   ✗ NSE main API (/api/equity-stockIndices) blocked by Akamai bot-detection.
//   ✗ NSE BHAVCOPY URL pattern changed — 404 for last 10 weekdays.
//   ✗ Yahoo Finance v7 quote API also blocks GH Actions IPs (0/504 resolved).
//
// Resolution: write ONLY the ticker → cap blob. Vercel /api/market/quotes
// reads this blob and does its own Yahoo price fetch (Vercel IPs are NOT
// blocked by Yahoo — proven by existing /api/market/quote endpoint).
//
// KV blob shape (new key): nse-ticker-universe:v1:latest
//   { generatedAt, totalTickers, capBreakdown, tickers: [
//       { ticker, company, industry, cap }
//   ]}
//
// Pure Node 20.
// ═══════════════════════════════════════════════════════════════════════════

const ARCHIVES_BASE = 'https://archives.nseindia.com';

// Priority order: Large → Mid → Small → Micro. First match wins for cap label.
// PATCH 0787: added Total Market 750 + Microcap 250 + LargeMidcap 250 to
// widen the universe so +12% to +20% movers (which are usually
// smallcap/microcap) show up. SME excluded per user instruction.
const CONSTITUENT_LISTS = [
  { name: 'Nifty 50',              url: `${ARCHIVES_BASE}/content/indices/ind_nifty50list.csv`,            cap: 'Large' },
  { name: 'Nifty Next 50',         url: `${ARCHIVES_BASE}/content/indices/ind_niftynext50list.csv`,        cap: 'Large' },
  { name: 'Nifty LargeMidcap 250', url: `${ARCHIVES_BASE}/content/indices/ind_niftylargemidcap250list.csv`, cap: 'Mid'   },
  { name: 'Nifty Midcap 150',      url: `${ARCHIVES_BASE}/content/indices/ind_niftymidcap150list.csv`,     cap: 'Mid'   },
  { name: 'Nifty Smallcap 250',    url: `${ARCHIVES_BASE}/content/indices/ind_niftysmallcap250list.csv`,   cap: 'Small' },
  { name: 'Nifty Microcap 250',    url: `${ARCHIVES_BASE}/content/indices/ind_niftymicrocap250_list.csv`,  cap: 'Micro' },
  { name: 'Nifty Total Market',    url: `${ARCHIVES_BASE}/content/indices/ind_niftytotalmarket_list.csv`,  cap: 'Small' },
  { name: 'Nifty 500',             url: `${ARCHIVES_BASE}/content/indices/ind_nifty500list.csv`,           cap: 'Mid'   },
];

const FETCH_TIMEOUT_MS = 30_000;
const KV_KEY = 'nse-ticker-universe:v1:latest';
const KV_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — NSE constituents change weekly at most

const ARCHIVE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/csv,application/octet-stream,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}

function parseCsv(text) {
  const out = [];
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return out;
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] || '').trim();
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
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      cols.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

async function fetchCsv(url, label) {
  try {
    const res = await fetch(url, { headers: ARCHIVE_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) {
      console.log(`::warning title=${label}::HTTP ${res.status}`);
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

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
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

// PATCH 0789 — NSE master list URLs. EQUITY_L.csv is the canonical list
// of all ~2000 NSE-listed equities. Tickers not in any benchmark index
// (DYNACONS, AEROFLEX, SASKEN etc.) live here. Try multiple URL patterns
// since NSE has moved this file across infrastructure over time.
const EQUITY_MASTER_URLS = [
  'https://archives.nseindia.com/content/equities/EQUITY_L.csv',
  'https://www1.nseindia.com/content/equities/EQUITY_L.csv',
  'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
];

async function fetchEquityMaster() {
  for (const url of EQUITY_MASTER_URLS) {
    const rows = await fetchCsv(url, `EQUITY_L (${new URL(url).hostname})`);
    if (rows && rows.length > 500) {
      console.log(`  ✓ master list loaded from ${url}`);
      return rows;
    }
  }
  console.log('::warning title=EQUITY_L::all master list URLs failed');
  return null;
}

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-nse-indices (full master + indices) at ${new Date().toISOString()}`);

  const tickerCap = new Map();
  const tickerCompany = new Map();
  const tickerIndustry = new Map();
  const tickerSeries = new Map();

  // Phase 1: NSE benchmark index CSVs → canonical cap labels (Large/Mid/Small/Micro)
  console.log('  ── Phase 1: NSE benchmark indices ──');
  for (const list of CONSTITUENT_LISTS) {
    const rows = await fetchCsv(list.url, list.name);
    if (!rows) continue;
    for (const row of rows) {
      const sym = (row['Symbol'] || row['symbol'] || '').trim().toUpperCase();
      if (!sym) continue;
      if (!tickerCap.has(sym)) tickerCap.set(sym, list.cap);
      const company = row['Company Name'] || row['company name'] || row['company'] || '';
      const industry = row['Industry'] || row['industry'] || '';
      if (company && !tickerCompany.has(sym)) tickerCompany.set(sym, company);
      if (industry && !tickerIndustry.has(sym)) tickerIndustry.set(sym, industry);
    }
  }
  const indexCount = tickerCap.size;
  console.log(`  indexed universe: ${indexCount} unique symbols`);

  // Phase 2: NSE EQUITY_L master list → adds the ~1250 NSE-listed equities
  // that aren't in any benchmark index (DYNACONS, AEROFLEX, SASKEN, etc.).
  // Tagged with cap='Other'; Vercel side derives cap from Yahoo marketCap.
  console.log('  ── Phase 2: NSE EQUITY_L master list ──');
  const masterRows = await fetchEquityMaster();
  if (masterRows) {
    let added = 0;
    for (const row of masterRows) {
      // EQUITY_L columns: SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING,
      // PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
      const sym = (row['SYMBOL'] || row[' SYMBOL'] || row['Symbol'] || '').trim().toUpperCase();
      const series = (row['SERIES'] || row[' SERIES'] || '').trim();
      // EQ = regular equity; SM = SME (skip per user instruction); BE/BL/BZ = restricted
      if (!sym) continue;
      if (series && series !== 'EQ') continue;
      if (!tickerCap.has(sym)) {
        tickerCap.set(sym, 'Other');
        added++;
      }
      tickerSeries.set(sym, series || 'EQ');
      const company = row[' NAME OF COMPANY'] || row['NAME OF COMPANY'] || row['Company Name'] || '';
      if (company && !tickerCompany.has(sym)) tickerCompany.set(sym, company.trim());
    }
    console.log(`  master added: +${added} non-indexed tickers (total ${tickerCap.size})`);
  }

  console.log(`  FINAL ticker universe: ${tickerCap.size} unique symbols (${indexCount} indexed + ${tickerCap.size - indexCount} other)`);

  if (tickerCap.size < 50) {
    console.log('::error title=Too few tickers::Constituent CSV fetches returned <50 rows total.');
    process.exit(1);
  }

  const tickers = [];
  for (const [sym, cap] of tickerCap) {
    tickers.push({
      ticker: sym,
      company: tickerCompany.get(sym) || sym,
      industry: tickerIndustry.get(sym) || '',
      cap,
    });
  }

  const capBreakdown = tickers.reduce((acc, t) => { acc[t.cap] = (acc[t.cap] || 0) + 1; return acc; }, {});
  const elapsed = Date.now() - startedAt;

  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    totalTickers: tickers.length,
    capBreakdown,
    tickers,
  };

  const payloadSize = JSON.stringify(payload).length;
  console.log(`  payload size: ${Math.round(payloadSize / 1024)} KB · breakdown: ${JSON.stringify(capBreakdown)}`);

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} (${tickers.length} tickers, ${Math.round(payloadSize / 1024)} KB) in ${elapsed}ms`);
  console.log(`::notice title=Scrape complete::${tickers.length} NSE tickers cached for 7d.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
