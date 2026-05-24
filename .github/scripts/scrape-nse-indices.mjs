#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0782 — NSE broad-indices scraper for GitHub Actions.
//
// Background: NSE's /api/equity-stockIndices is heavily rate-limited when
// called from Vercel's serverless IPs, especially on weekends. The Vercel-
// hosted /api/market/quotes endpoint regularly falls back to Yahoo-only
// (49 NIFTY-50 names) when the broad indices fail upstream.
//
// This scraper runs from a GitHub Actions ubuntu-latest runner (different
// IP pool), fetches the broad indices, normalizes them with cap labels,
// and writes a consolidated blob to Upstash Redis. The Vercel route then
// reads the KV blob FIRST and only falls back to live NSE if the blob is
// stale or missing.
//
// Indices ingested (in priority order — first match wins for cap label):
//   • NIFTY 50           → cap='Large'
//   • NIFTY NEXT 50      → cap='Large'
//   • NIFTY MIDCAP 250   → cap='Mid'
//   • NIFTY SMALLCAP 250 → cap='Small'
//   • NIFTY MICROCAP 250 → cap='Micro'
//   • NIFTY 500          → cap=fallback ('Mid' if not in above sets)
//
// KV write strategy: single blob `nse-indices-blob:v1:latest`, ~150KB
// containing 750-900 deduped tickers. TTL 4h (next run overwrites).
// Costs 1 KV write per run × 4 runs/day = 4 writes/day (well under cap).
//
// Pure Node 20 — built-in fetch only. No dependencies.
//
// Required env vars (GH Actions secrets):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// ═══════════════════════════════════════════════════════════════════════════

// ─── Config ─────────────────────────────────────────────────────────────────

const INDICES = [
  { key: 'NIFTY 50',           cap: 'Large' },
  { key: 'NIFTY NEXT 50',      cap: 'Large' },
  { key: 'NIFTY MIDCAP 250',   cap: 'Mid'   },
  { key: 'NIFTY SMALLCAP 250', cap: 'Small' },
  { key: 'NIFTY MICROCAP 250', cap: 'Micro' },
  { key: 'NIFTY 500',          cap: 'Mid'   }, // fallback for any name not in above
];

const NSE_BASE = 'https://www.nseindia.com';
const FETCH_TIMEOUT_MS = 20_000;
const KV_KEY = 'nse-indices-blob:v1:latest';
const KV_TTL_SECONDS = 4 * 60 * 60; // 4h

// ─── Env validation ─────────────────────────────────────────────────────────

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN as repo secrets.');
  process.exit(1);
}

// ─── NSE session bootstrap (cookies) ────────────────────────────────────────

// Headers MUST match what lib/nse.ts uses — NSE fingerprints these and
// will return 404/403 if any required header is missing. Referer is the
// site root, not a deep page. Cookies acquired by visiting the root.
const NSE_HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Referer': 'https://www.nseindia.com/',
};

let nseCookieJar = '';

async function bootstrapNseCookies() {
  try {
    const res = await fetch(NSE_BASE, {
      headers: {
        'User-Agent': NSE_HEADERS_BASE['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Node 20 fetch exposes res.headers.getSetCookie() returning an array
    // of full Set-Cookie strings (one per cookie). Use that if available
    // for robust parsing — splitting raw header text on `,` breaks on
    // comma-containing dates.
    let cookies = [];
    if (typeof res.headers.getSetCookie === 'function') {
      cookies = res.headers.getSetCookie();
    } else {
      const raw = res.headers.get('set-cookie') || '';
      cookies = raw.split(/,(?=[^=]+=)/g);
    }
    const jar = cookies
      .map((c) => String(c).split(';')[0].trim())
      .filter(Boolean);
    nseCookieJar = jar.join('; ');
    if (!nseCookieJar) {
      console.log('::warning title=NSE cookie bootstrap::No Set-Cookie received');
    } else {
      console.log(`  NSE cookie acquired (${jar.length} fields): ${nseCookieJar.slice(0, 120)}${nseCookieJar.length > 120 ? '...' : ''}`);
    }
  } catch (e) {
    console.log(`::warning title=NSE cookie bootstrap::${e?.message || e}`);
  }
}

async function fetchIndex(indexKey) {
  const url = `${NSE_BASE}/api/equity-stockIndices?index=${encodeURIComponent(indexKey)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...NSE_HEADERS_BASE, Cookie: nseCookieJar },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      // 401, 403, 404 all suggest cookie/session issue — refresh and retry.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        if (attempt < 2) {
          console.log(`  ${indexKey}: HTTP ${res.status}, refreshing cookie (attempt ${attempt + 1})`);
          // Light browse to a sub-page to upgrade session before retry
          try {
            await fetch(`${NSE_BASE}/market-data/live-equity-market`, {
              headers: { ...NSE_HEADERS_BASE, Cookie: nseCookieJar },
              signal: AbortSignal.timeout(8000),
            });
          } catch {}
          await bootstrapNseCookies();
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
      }
      if (!res.ok) {
        console.log(`::warning title=${indexKey}::HTTP ${res.status}`);
        // Log the response body once for the first index for debugging
        if (indexKey === 'NIFTY 50') {
          try {
            const body = await res.text();
            console.log(`  body (first 300 chars): ${body.slice(0, 300)}`);
          } catch {}
        }
        return null;
      }
      const json = await res.json();
      const items = Array.isArray(json) ? json : (json?.data || []);
      console.log(`  ${indexKey.padEnd(22)} → ${items.length} stocks`);
      return items;
    } catch (e) {
      const msg = e?.name === 'AbortError' ? `timeout (${FETCH_TIMEOUT_MS}ms)` : (e?.message || String(e));
      if (attempt < 2) {
        console.log(`  ${indexKey}: ${msg}, retrying...`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      console.log(`::warning title=${indexKey}::${msg}`);
      return null;
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

// ─── Normalization ──────────────────────────────────────────────────────────

function normalizeItem(item, capDefault) {
  const symbol = item.symbol || '';
  if (!symbol || symbol.includes(' ')) return null; // skip header rows like 'NIFTY 50'
  const lastPrice = item.lastPrice || item.ltP || 0;
  const previousClose = item.previousClose || item.prevClose || 0;
  // Compute change/pct from prices (NSE returns pChange=0 on non-trading days)
  const reportedPChange = typeof item.pChange === 'number' ? item.pChange : 0;
  const reportedChange = typeof item.change === 'number' ? item.change : 0;
  const computedChange = (lastPrice > 0 && previousClose > 0) ? (lastPrice - previousClose) : 0;
  const computedPct = (lastPrice > 0 && previousClose > 0) ? ((lastPrice - previousClose) / previousClose) * 100 : 0;
  return {
    ticker: symbol,
    company: item.meta?.companyName || item.identifier || symbol,
    industry: item.meta?.industry || item.industry || '',
    price: lastPrice,
    previousClose,
    change: reportedChange !== 0 ? reportedChange : computedChange,
    changePercent: reportedPChange !== 0 ? reportedPChange : computedPct,
    volume: item.totalTradedVolume || item.trdVol || 0,
    ffmc: item.ffmc || item.freeFloatMktCap || 0,
    yearHigh: item.yearHigh || 0,
    yearLow: item.yearLow || 0,
    dayHigh: item.dayHigh || 0,
    dayLow: item.dayLow || 0,
    open: item.open || 0,
    cap: capDefault,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-nse-indices at ${new Date().toISOString()}`);

  await bootstrapNseCookies();

  // Sequential fetch — NSE rate-limits parallel calls on the same cookie.
  const stocksByTicker = new Map();
  const indexCounts = {};

  for (const { key, cap } of INDICES) {
    const items = await fetchIndex(key);
    if (!items) {
      indexCounts[key] = 0;
      continue;
    }
    indexCounts[key] = items.length;
    for (const raw of items) {
      const item = normalizeItem(raw, cap);
      if (!item) continue;
      // First match wins (cap-priority order in INDICES const).
      if (!stocksByTicker.has(item.ticker)) {
        stocksByTicker.set(item.ticker, item);
      }
    }
    // Polite pause to avoid burst-limit
    await new Promise(r => setTimeout(r, 500));
  }

  const stocks = Array.from(stocksByTicker.values());
  const elapsed = Date.now() - startedAt;
  const capBreakdown = stocks.reduce((acc, s) => { acc[s.cap] = (acc[s.cap] || 0) + 1; return acc; }, {});

  console.log(`  totals: ${stocks.length} unique stocks · breakdown: ${JSON.stringify(capBreakdown)}`);

  if (stocks.length === 0) {
    console.log('::error title=Empty scrape::All NSE index fetches returned 0 stocks. KV blob NOT updated.');
    process.exit(1);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    indexCounts,
    capBreakdown,
    totalStocks: stocks.length,
    stocks,
  };

  // Trim if too large (Upstash REST has 1MiB body limit)
  let payloadSize = JSON.stringify(payload).length;
  console.log(`  payload size: ${Math.round(payloadSize / 1024)} KB`);
  while (payloadSize > 900_000 && payload.stocks.length > 200) {
    payload.stocks = payload.stocks.slice(0, Math.floor(payload.stocks.length * 0.85));
    payloadSize = JSON.stringify(payload).length;
  }

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} (${payload.stocks.length} stocks, ${Math.round(payloadSize / 1024)} KB) in ${elapsed}ms`);
  console.log(`::notice title=Scrape complete::${payload.stocks.length} NSE stocks cached for 4h.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
