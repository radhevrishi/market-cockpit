#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0798 — NSE rolling stats scraper (20-day window)
//
// Pulls 20 most-recent BHAVCOPY files from NSE archives, computes per-ticker
// rolling statistics that the catalyst-scoring engine needs to label moves
// as "Vol 3.2× 20D avg / Position unwind / Near 52w high".
//
// Output blob: `nse-rolling-stats:v1:latest` (KV)
//   {
//     generatedAt, daysWindow, stockCount,
//     stats: { [ticker]: { vol20DAvg, mom1M, mom3M?, high52w, low52w, pctOf52wHigh } }
//   }
//
// Stats per ticker:
//   • vol20DAvg     — mean daily volume over last 20 sessions
//   • mom1M         — % change of close vs ~21 sessions ago
//   • mom3M         — % change of close vs ~63 sessions ago (when available)
//   • high52w       — max close in window (approx since we only have ~20-30 days)
//   • low52w        — min close in window
//   • pctOf52wHigh  — current close / high52w (0-1)
//
// Cost: 20 BHAVCOPY downloads (~600KB each), parsed locally, written as
// single KV blob (~800KB). GH Actions free-tier (unlimited public repos),
// Upstash: 1 SET/day, ~800KB.
//
// Pure Node 20 — built-in fetch only.
// ═══════════════════════════════════════════════════════════════════════════

const ARCHIVES_BASE = 'https://nsearchives.nseindia.com';
const FETCH_TIMEOUT_MS = 25_000;
const KV_KEY = 'nse-rolling-stats:v1:latest';
const KV_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d
const DAYS_WINDOW = 60;        // PATCH 0810 — 20 → 60 for real sma20 + sma50 + honest range

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/csv,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function bhavUrl(d) {
  const dd = pad2(d.getUTCDate()), mm = pad2(d.getUTCMonth() + 1), yyyy = d.getUTCFullYear();
  return `${ARCHIVES_BASE}/products/content/sec_bhavdata_full_${dd}${mm}${yyyy}.csv`;
}

function parseCsvLine(line) {
  const cols = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur); return cols;
}

function parseCsv(text) {
  const out = []; const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return out;
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]); const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] || '').trim();
    out.push(row);
  }
  return out;
}

async function fetchBhavOnDate(d) {
  const url = bhavUrl(d);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) return null;
    const text = await res.text();
    const rows = parseCsv(text);
    if (rows.length < 500) return null;
    // Sanity check on DATE1 to ensure NSE didn't serve a different day silently
    const dateField = (rows[0]['DATE1'] ?? rows[0][' DATE1'] ?? '').toString().trim();
    if (dateField && !dateField.includes(String(d.getUTCFullYear()))) return null;
    return { dateISO: d.toISOString().slice(0, 10), rows };
  } catch { return null; }
}

async function fetchRecentBhavs() {
  // Walk back from yesterday; skip weekends; collect DAYS_WINDOW successful fetches.
  const today = new Date();
  const collected = [];
  for (let back = 1; back <= 100 && collected.length < DAYS_WINDOW; back++) {
    const d = new Date(today.getTime() - back * 86400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const bhav = await fetchBhavOnDate(d);
    if (bhav) {
      collected.push(bhav);
      console.log(`  ✓ ${bhav.dateISO}: ${bhav.rows.length} rows`);
    } else {
      console.log(`  - ${d.toISOString().slice(0, 10)}: skipped (no data)`);
    }
  }
  return collected;
}

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const body = JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upstash SET failed: HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
}

function num(s) {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-rolling-stats at ${new Date().toISOString()}`);
  console.log(`  fetching ${DAYS_WINDOW} most-recent BHAVCOPY files...`);

  const bhavs = await fetchRecentBhavs();
  if (bhavs.length < 5) {
    console.error(`::error title=Too few BHAVCOPY days::collected ${bhavs.length} of ${DAYS_WINDOW}`);
    process.exit(1);
  }
  console.log(`  ✓ collected ${bhavs.length} sessions (need ≥5 for meaningful stats)`);

  // Sort newest-first so bhavs[0] is the most recent session
  bhavs.sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  // Build per-ticker history: arrays of close + volume from oldest to newest
  // (we want newest=index 0 since we walk back; but rolling avg is order-independent)
  const history = new Map(); // ticker -> { closes: [], volumes: [] }
  for (const bhav of bhavs) {
    for (const row of bhav.rows) {
      const sym = (row['SYMBOL'] || row[' SYMBOL'] || '').toString().trim().toUpperCase();
      const series = (row['SERIES'] || row[' SERIES'] || '').toString().trim();
      if (!sym) continue;
      if (series && series !== 'EQ' && series !== 'BE' && series !== 'BL' && series !== 'BZ') continue;
      const close = num(row['CLOSE_PRICE'] || row[' CLOSE_PRICE']);
      const volume = parseInt(row['TTL_TRD_QNTY'] || row[' TTL_TRD_QNTY'] || '0', 10) || 0;
      if (close <= 0) continue;
      if (!history.has(sym)) history.set(sym, { closes: [], volumes: [] });
      const h = history.get(sym);
      h.closes.push(close);
      h.volumes.push(volume);
    }
  }
  console.log(`  ✓ ${history.size} unique tickers with at least 1 session`);

  // Compute per-ticker stats. bhavs[0] is newest; index 0 → today, last → ~60 days ago.
  // PATCH 0810: now compute real sma20 + sma50, plus honest range60d (NOT 52w).
  const stats = {};
  let withStats = 0;
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  for (const [ticker, h] of history) {
    if (h.closes.length < 5) continue; // not enough data
    const closes = h.closes;            // newest-first (index 0 = today)
    const volumes = h.volumes;
    const sessions = closes.length;
    const currentClose = closes[0];
    const currentVol = volumes[0];

    // SMAs over the most-recent N sessions (with fall-through when window short)
    const sma20 = sessions >= 5  ? mean(closes.slice(0, Math.min(20, sessions))) : null;
    const sma50 = sessions >= 30 ? mean(closes.slice(0, Math.min(50, sessions))) : null;

    // Volume averages
    const vol20DAvg = mean(volumes.slice(0, Math.min(20, sessions)));
    const vol50DAvg = sessions >= 30 ? mean(volumes.slice(0, Math.min(50, sessions))) : vol20DAvg;
    const volMultiple = vol20DAvg > 0 ? currentVol / vol20DAvg : 0;

    // Momentum vs N sessions ago (clamp to available history)
    const idx1M = Math.min(21, sessions - 1);
    const idx3M = sessions >= 63 ? 62 : null;
    const close1MAgo = closes[idx1M];
    const close3MAgo = idx3M !== null ? closes[idx3M] : null;
    const mom1M = close1MAgo > 0 ? ((currentClose - close1MAgo) / close1MAgo) * 100 : 0;
    const mom3M = close3MAgo !== null && close3MAgo > 0
      ? ((currentClose - close3MAgo) / close3MAgo) * 100
      : null;

    // Honest range over the actual window (NOT 52w — we only have ~60 days)
    const range60dHigh = Math.max(...closes);
    const range60dLow  = Math.min(...closes);
    const pctOfRange60dHigh = range60dHigh > 0 ? currentClose / range60dHigh : 0;

    stats[ticker] = {
      vol20DAvg: Math.round(vol20DAvg),
      vol50DAvg: Math.round(vol50DAvg),
      volMultiple: Math.round(volMultiple * 100) / 100,
      sma20: sma20 !== null ? Math.round(sma20 * 100) / 100 : null,
      sma50: sma50 !== null ? Math.round(sma50 * 100) / 100 : null,
      aboveSma20: sma20 !== null && currentClose > sma20,
      aboveSma50: sma50 !== null && currentClose > sma50,
      mom1M: Math.round(mom1M * 100) / 100,
      mom3M: mom3M !== null ? Math.round(mom3M * 100) / 100 : null,
      range60dHigh,
      range60dLow,
      pctOfRange60dHigh: Math.round(pctOfRange60dHigh * 1000) / 1000,
      // LEGACY field aliases (kept so old consumers don't break)
      high52w: range60dHigh,
      low52w: range60dLow,
      pctOf52wHigh: Math.round(pctOfRange60dHigh * 1000) / 1000,
      sessions,
    };
    withStats++;
  }
  console.log(`  ✓ ${withStats} tickers have computed stats (with sma20 + sma50)`);

  const elapsed = Date.now() - startedAt;
  const payload = {
    generatedAt: new Date().toISOString(),
    daysWindow: bhavs.length,
    sessionDates: bhavs.map(b => b.dateISO),
    stockCount: withStats,
    elapsedMs: elapsed,
    stats,
  };

  let payloadSize = JSON.stringify(payload).length;
  console.log(`  payload size: ${Math.round(payloadSize / 1024)} KB`);
  // Trim if too large
  while (payloadSize > 900_000) {
    const entries = Object.entries(payload.stats).sort((a, b) => b[1].sessions - a[1].sessions);
    payload.stats = Object.fromEntries(entries.slice(0, Math.floor(entries.length * 0.85)));
    payload.stockCount = Object.keys(payload.stats).length;
    payloadSize = JSON.stringify(payload).length;
  }

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} (${payload.stockCount} tickers, ${Math.round(payloadSize / 1024)} KB) in ${elapsed}ms`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
