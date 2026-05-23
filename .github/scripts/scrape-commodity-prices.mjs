#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0740 — Commodity prices scraper for GitHub Actions.
//
// Hits Yahoo Finance v7/quote in ONE batched call for all 50+ commodity
// + equity-proxy symbols used by /api/v1/transmission. Writes a single
// blob to Upstash keyed by symbol → quote. The transmission route reads
// the blob first and falls back to its existing live fetch only when
// the blob is stale.
//
// Why this matters: §10.6.3 batch shipped the transmission workstation
// with 34 inputs; §10.6.4 P0250 added equity-proxy mode for 17 commodities
// that don't have direct Yahoo feeds. The route currently fans out to
// Yahoo per request, eating Vercel CPU and getting rate-limited.
// Centralizing the fetch on GH free CPU eliminates both problems.
//
// Required env vars (GH Actions secrets):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// ═══════════════════════════════════════════════════════════════════════════

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN as repo secrets.');
  process.exit(1);
}

const KV_KEY         = 'commodity-prices:v1:latest';
const KV_TTL_SECONDS = 12 * 60 * 60;    // 12h — next run within 6h overwrites
const FETCH_TIMEOUT_MS = 12_000;

// Mirrored from frontend/src/app/api/v1/transmission/route.ts COMMODITIES
// array. If a new commodity is added there, mirror it here too so the
// scraper covers it. Includes both direct futures (CL=F, HG=F) and the
// equity-proxy stocks (P0250 — MOS, CF, BTU, etc.) so the transmission
// page never has to fetch live for any symbol.
const SYMBOLS = [
  // Direct commodity futures + indexes
  'CL=F', 'BZ=F', 'NG=F', 'HG=F', 'ALI=F', 'GC=F', 'SI=F', 'PA=F', 'PL=F',
  'ZN=F', 'ZL=F', 'ZC=F', 'ZS=F', 'ZW=F', 'KC=F', 'SB=F', 'CT=F', 'CC=F',
  // FX + rates
  'INR=X', '^TNX', '^FVX',
  // Equity proxies for manual-feed commodities (P0250)
  'MOS', 'CF', 'LYB', 'OLN', 'BTU', 'IP', 'MP',
  'GODREJAGRO.NS', 'BALKRISIND.NS', '1961.KL',
  // Lithium / rare earths / uranium ETFs
  'LIT', 'REMX', 'URA',
  // Specialty / nuclear / industrial
  'LEU', 'APD', 'CCJ',
];

// ─── Yahoo Finance batch quote ─────────────────────────────────────────────

async function fetchYahooBatch(symbols) {
  // Yahoo's v7/finance/quote supports comma-joined symbols in ONE call.
  // No auth, no rate limit at this volume. Crumb-less endpoint still
  // works for read-only access as of 2026-05.
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      console.log(`::warning title=Yahoo::HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const results = data?.quoteResponse?.result;
    return Array.isArray(results) ? results : [];
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `timeout (${FETCH_TIMEOUT_MS}ms)` : (e?.message || String(e));
    console.log(`::warning title=Yahoo::${msg}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Upstash KV writer ─────────────────────────────────────────────────────

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
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log(`▶ scrape-commodity-prices at ${new Date().toISOString()}`);
  console.log(`  fetching ${SYMBOLS.length} symbols in one Yahoo batch call...`);

  // Yahoo allows ~250 symbols per batch; we're at 37, so single call is fine.
  const results = await fetchYahooBatch(SYMBOLS);

  // Normalize to a flat { symbol -> quote } map keyed by Yahoo symbol.
  const quotes = {};
  for (const r of results) {
    if (!r?.symbol) continue;
    const price = Number(r.regularMarketPrice);
    if (!Number.isFinite(price)) continue;
    quotes[r.symbol] = {
      symbol: r.symbol,
      price,
      previousClose: Number(r.regularMarketPreviousClose) || null,
      change: Number(r.regularMarketChange) || null,
      changePercent: Number(r.regularMarketChangePercent) || null,
      currency: r.currency || null,
      exchange: r.fullExchangeName || r.exchange || null,
      asOf: r.regularMarketTime
        ? new Date(r.regularMarketTime * 1000).toISOString()
        : null,
      name: r.shortName || r.longName || r.symbol,
    };
  }

  const requestedCount = SYMBOLS.length;
  const receivedCount = Object.keys(quotes).length;
  const missing = SYMBOLS.filter((s) => !quotes[s]);

  if (missing.length > 0) {
    console.log(`  missing quotes for: ${missing.join(', ')}`);
  }

  const elapsed = Date.now() - start;
  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    requestedCount,
    receivedCount,
    missing,
    quotes,
  };

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} — ${receivedCount}/${requestedCount} quotes (${Math.round(JSON.stringify(payload).length / 1024)} KB) in ${elapsed}ms`);
  console.log(`::notice title=Quotes scrape complete::${receivedCount} commodity quotes cached for transmission page.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
