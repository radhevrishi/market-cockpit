#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0785 — Hybrid NSE constituents + Yahoo prices scraper.
//
// Previous attempts:
//   Workflow #1 + #2 → NSE www.nseindia.com/api/equity-stockIndices blocked
//                      by Akamai (only AKA_A2=A sentinel cookie).
//   Workflow #3      → NSE archives constituent CSVs partially worked
//                      (504 unique tickers from Nifty50 + Next50 + Nifty500
//                      + Smallcap250), but BHAVCOPY URL pattern changed
//                      and returns 404 for the last 10 weekdays.
//
// This patch goes with: NSE archives for the ticker universe + cap labels
// (proven to work from GH Actions IPs), Yahoo Finance for prices (only
// IP-unrestricted last-close source we have). This gives the user 500+
// stocks with correct cap labels and real Friday close % moves.
//
// Cap classification derived purely from index membership:
//   • Nifty 50 + Next 50         → Large
//   • Nifty Smallcap 250         → Small
//   • Nifty 500 ∖ (Large + Small) → Mid
//
// Pure Node 20 — built-in fetch only. No deps.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Config ─────────────────────────────────────────────────────────────────

const ARCHIVES_BASE = 'https://archives.nseindia.com';

const CONSTITUENT_LISTS = [
  { name: 'Nifty 50',           url: `${ARCHIVES_BASE}/content/indices/ind_nifty50list.csv`,        cap: 'Large' },
  { name: 'Nifty Next 50',      url: `${ARCHIVES_BASE}/content/indices/ind_niftynext50list.csv`,    cap: 'Large' },
  { name: 'Nifty Smallcap 250', url: `${ARCHIVES_BASE}/content/indices/ind_niftysmallcap250list.csv`, cap: 'Small' },
  { name: 'Nifty 500',          url: `${ARCHIVES_BASE}/content/indices/ind_nifty500list.csv`,        cap: 'Mid'   },
  // Tried Midcap250 + Microcap250 archives URLs — both 404. Mid label
  // derived as 'in Nifty 500 but not in Large+Small' which gives a
  // ~150-200-ticker midcap segment.
];

const YAHOO_BASE = 'https://query1.finance.yahoo.com';
const YAHOO_BATCH = 20;          // v7 quote endpoint limit
const YAHOO_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;

const KV_KEY = 'nse-indices-blob:v1:latest';
const KV_TTL_SECONDS = 4 * 60 * 60; // 4h

const ARCHIVE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/csv,application/octet-stream,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,*/*',
};

// ─── Env validation ─────────────────────────────────────────────────────────

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN as repo secrets.');
  process.exit(1);
}

// ─── CSV parsing ────────────────────────────────────────────────────────────

function parseCsv(text) {
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

// ─── Yahoo bulk quote fetcher ───────────────────────────────────────────────

async function fetchYahooBatch(symbols) {
  // symbols expected to be raw NSE tickers; we append .NS suffix
  const yahooSyms = symbols.map(s => `${s}.NS`);
  const url = `${YAHOO_BASE}/v7/finance/quote?symbols=${encodeURIComponent(yahooSyms.join(','))}`;
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS) });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.quoteResponse?.result || [];
  } catch {
    return [];
  }
}

async function fetchAllYahooPrices(tickers) {
  const priceMap = new Map();
  const batches = [];
  for (let i = 0; i < tickers.length; i += YAHOO_BATCH) {
    batches.push(tickers.slice(i, i + YAHOO_BATCH));
  }
  console.log(`  ── Yahoo bulk fetch: ${tickers.length} tickers in ${batches.length} batches of ${YAHOO_BATCH} ──`);

  // Run 4 batches in parallel — keeps under Yahoo rate-limit while finishing
  // ~25 batches in ~10s rather than 25s serial.
  const CONC = 4;
  let resolved = 0;
  for (let b = 0; b < batches.length; b += CONC) {
    const slab = batches.slice(b, b + CONC);
    const results = await Promise.all(slab.map(fetchYahooBatch));
    for (const arr of results) {
      for (const q of arr) {
        const raw = (q?.symbol || '').replace(/\.(NS|BO)$/i, '');
        if (!raw) continue;
        const price = q.regularMarketPrice || 0;
        const prevClose = q.regularMarketPreviousClose || 0;
        if (price <= 0) continue;
        const reportedChg = Number.isFinite(q.regularMarketChange) ? q.regularMarketChange : 0;
        const reportedPct = Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : 0;
        const computedChg = (price > 0 && prevClose > 0) ? (price - prevClose) : 0;
        const computedPct = (price > 0 && prevClose > 0) ? ((price - prevClose) / prevClose) * 100 : 0;
        priceMap.set(raw, {
          price,
          previousClose: prevClose,
          change: reportedChg !== 0 ? reportedChg : computedChg,
          changePercent: reportedPct !== 0 ? reportedPct : computedPct,
          open: q.regularMarketOpen || 0,
          dayHigh: q.regularMarketDayHigh || 0,
          dayLow: q.regularMarketDayLow || 0,
          yearHigh: q.fiftyTwoWeekHigh || 0,
          yearLow: q.fiftyTwoWeekLow || 0,
          volume: q.regularMarketVolume || 0,
          companyShort: q.shortName || '',
        });
        resolved++;
      }
    }
  }
  console.log(`  Yahoo resolved ${resolved}/${tickers.length} tickers`);
  return priceMap;
}

// ─── Upstash KV writer ──────────────────────────────────────────────────────

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

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-nse-indices (hybrid CSV+Yahoo) at ${new Date().toISOString()}`);

  // Step 1: Pull NSE constituent CSVs → ticker → cap map + company name.
  console.log('  ── Pulling NSE constituent CSVs ──');
  const tickerCap = new Map();
  const tickerCompany = new Map();
  const tickerIndustry = new Map();

  for (const list of CONSTITUENT_LISTS) {
    const rows = await fetchCsv(list.url, list.name);
    if (!rows) continue;
    for (const row of rows) {
      const sym = (row['Symbol'] || row['symbol'] || '').trim().toUpperCase();
      if (!sym) continue;
      // First match wins for cap; CONSTITUENT_LISTS is ordered Large → Small → Mid (Nifty 500)
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

  // Step 2: Yahoo bulk fetch for prices.
  const tickerList = Array.from(tickerCap.keys());
  const priceMap = await fetchAllYahooPrices(tickerList);

  if (priceMap.size === 0) {
    console.log('::error title=No prices::Yahoo bulk fetch returned 0 prices.');
    process.exit(1);
  }

  // Step 3: Merge → final stock list.
  const stocks = [];
  for (const [sym, cap] of tickerCap) {
    const p = priceMap.get(sym);
    if (!p) continue;
    stocks.push({
      ticker: sym,
      company: tickerCompany.get(sym) || p.companyShort || sym,
      industry: tickerIndustry.get(sym) || '',
      cap,
      price: p.price,
      previousClose: p.previousClose,
      change: p.change,
      changePercent: p.changePercent,
      open: p.open,
      dayHigh: p.dayHigh,
      dayLow: p.dayLow,
      yearHigh: p.yearHigh,
      yearLow: p.yearLow,
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
    sources: {
      constituents: 'archives.nseindia.com CSV',
      prices: 'Yahoo Finance v7 quote API',
    },
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
  console.log(`::notice title=Scrape complete::${payload.stocks.length} NSE stocks cached for 4h (hybrid CSV+Yahoo).`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
