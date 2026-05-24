#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0800 — Screener.in fundamentals scraper.
//
// Pulls per-ticker fundamentals from screener.in/company/<TICKER>/ pages.
// Extracts the data points the catalyst-scoring engine needs to detect
// "quality of earnings" (operational vs exceptional/one-time) and
// "operating leverage inflection" cases — the things the user pointed
// out our system was missing (JSWCEMENT real earnings beat vs SPARC
// exceptional-gain dominated profit).
//
// Per-ticker output written to KV key 'fundamentals:v1:<TICKER>' (24h TTL):
//   {
//     ticker, company, sector,
//     mcapCr,                       — market cap in ₹ crores
//     promoterPct,                  — promoter holding %
//     pe, pb, divYield,
//     roce, roe,
//     opmTtm, opmLatestQ,          — operating margins
//     salesTtmCr, patTtmCr,        — TTM revenue and PAT (₹ Cr)
//     salesQtrYoY, patQtrYoY,      — latest quarter Y/Y growth %
//     opMargin3yAvg,                — 3-year avg operating margin (for inflection detect)
//     exceptionalItemsFlag,        — true if PAT > (Sales × OPM) by >15% (suggests one-time gain)
//     debt, debtToEquity,
//     fetchedAt
//   }
//
// Throttling: 1 req per 600ms = ~100 tickers/min = top 500 in ~5 min.
// Scope: process tickers from nse-ticker-universe blob, prioritize by
// market cap (load top N each run). Cycles through all over the week.
//
// Pure Node 20 — built-in fetch, simple regex-based HTML parsing.
// ═══════════════════════════════════════════════════════════════════════════

const SCREENER_BASE = 'https://www.screener.in';
const FETCH_TIMEOUT_MS = 15_000;
const THROTTLE_MS = 600;
const KV_TTL_SECONDS = 24 * 60 * 60;
const MAX_TICKERS_PER_RUN = 200;  // ~2 min runtime

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}

// ─── KV helpers ─────────────────────────────────────────────────────────

async function kvGet(key) {
  const url = `${KV_URL.replace(/\/+$/, '')}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KV_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j || j.result === null || j.result === undefined) return null;
  try { return typeof j.result === 'string' ? JSON.parse(j.result) : j.result; } catch { return null; }
}

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upstash SET failed: HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
}

// ─── Screener HTML parsing helpers ─────────────────────────────────────

function num(s) {
  if (s === undefined || s === null) return null;
  const cleaned = String(s).replace(/[,₹%]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Extract key ratios from the "Company Ratios" sidebar block (li with name + value)
// Format: <li class="flex flex-space-between"><span class="name">Market Cap</span><span class="nowrap value">₹ 250 Cr.</span></li>
function extractKeyRatios(html) {
  const ratios = {};
  const liRe = /<li[^>]*class="flex[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const block = m[1];
    const nameM = block.match(/<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const valM  = block.match(/<span[^>]*class="[^"]*value[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    if (!nameM || !valM) continue;
    const name = nameM[1].replace(/<[^>]+>/g, '').trim();
    const value = valM[1].replace(/<[^>]+>/g, '').trim();
    if (name && value) ratios[name] = value;
  }
  return ratios;
}

// Extract the "Quarters" table — quarterly Sales/PAT/OPM history
// Returns { headers: [...], rows: { 'Sales': [...], 'Net Profit': [...], 'Operating Profit %': [...] } }
function extractQuartersTable(html) {
  // The Quarterly Results section has id="quarters"
  const sectionM = html.match(/<section[^>]*id="quarters"[^>]*>([\s\S]*?)<\/section>/);
  if (!sectionM) return null;
  const tableM = sectionM[1].match(/<table[\s\S]*?<\/table>/);
  if (!tableM) return null;
  const table = tableM[0];
  // Header row
  const headerRowM = table.match(/<thead>([\s\S]*?)<\/thead>/);
  const headers = [];
  if (headerRowM) {
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/g;
    let m;
    while ((m = thRe.exec(headerRowM[1])) !== null) {
      headers.push(m[1].replace(/<[^>]+>/g, '').trim());
    }
  }
  const rows = {};
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(table)) !== null) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let td;
    while ((td = tdRe.exec(tr[1])) !== null) {
      cells.push(td[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 2) {
      const label = cells[0];
      const values = cells.slice(1).map(num);
      rows[label] = values;
    }
  }
  return { headers, rows };
}

// Compute YoY% growth from a sequence of quarterly values
// Assumes values are in chronological order, last 4 quarters per year
function yoyGrowth(values) {
  if (!Array.isArray(values) || values.length < 5) return null;
  const latest = values[values.length - 1];
  const yearAgo = values[values.length - 5];
  if (latest === null || yearAgo === null || yearAgo === 0) return null;
  return ((latest - yearAgo) / Math.abs(yearAgo)) * 100;
}

function ttmSum(values) {
  if (!Array.isArray(values)) return null;
  const last4 = values.slice(-4).filter((v) => v !== null);
  if (last4.length < 4) return null;
  return last4.reduce((s, v) => s + v, 0);
}

// ─── Per-ticker scrape ─────────────────────────────────────────────────

async function fetchScreener(ticker) {
  // Try consolidated first (preferred for groups), fall back to standalone
  const urls = [
    `${SCREENER_BASE}/company/${ticker}/consolidated/`,
    `${SCREENER_BASE}/company/${ticker}/`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      const html = await res.text();
      if (html.length < 5000) continue;  // junk response
      return { html, url };
    } catch { /* try next */ }
  }
  return null;
}

function parseTicker(ticker, html) {
  const ratios = extractKeyRatios(html);
  const quarters = extractQuartersTable(html);

  // Company name from <h1>
  const nameM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const company = nameM ? nameM[1].replace(/<[^>]+>/g, '').trim() : ticker;

  // Sector (from breadcrumb / "About" section — best-effort)
  let sector = '';
  const sectorM = html.match(/Sector[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
  if (sectorM) sector = sectorM[1].replace(/<[^>]+>/g, '').trim();

  // Parse ratio map
  const mcapCr = num(ratios['Market Cap']);
  const pe = num(ratios['Stock P/E'] || ratios['P/E']);
  const pb = num(ratios['Book Value'] && ratios['Current Price']
    ? (parseFloat(String(ratios['Current Price']).replace(/[,₹]/g, '')) / parseFloat(String(ratios['Book Value']).replace(/[,₹]/g, '')))
    : null);
  const divYield = num(ratios['Dividend Yield']);
  const roce = num(ratios['ROCE']);
  const roe = num(ratios['ROE']);
  const debt = num(ratios['Debt']);
  const dToE = num(ratios['Debt to equity']);
  const promoterPctRaw = ratios['Promoter holding'] || ratios['Promoters'];
  const promoterPct = num(promoterPctRaw);

  // Quarterly extracts
  let opmLatestQ = null, salesQtrYoY = null, patQtrYoY = null;
  let salesTtmCr = null, patTtmCr = null;
  let opMargin3yAvg = null;
  let exceptionalItemsFlag = false;

  if (quarters) {
    const sales = quarters.rows['Sales'] || quarters.rows['Sales+'] || quarters.rows['Revenue'];
    const op = quarters.rows['Operating Profit'] || quarters.rows['Operating Profit+'];
    const opm = quarters.rows['OPM %'] || quarters.rows['OPM%'];
    const np = quarters.rows['Net Profit'] || quarters.rows['Net Profit+'];
    if (opm && opm.length) {
      opmLatestQ = opm[opm.length - 1];
      const last12 = opm.slice(-12).filter((v) => v !== null);
      if (last12.length >= 8) {
        opMargin3yAvg = last12.reduce((s, v) => s + v, 0) / last12.length;
      }
    }
    if (sales) {
      salesQtrYoY = yoyGrowth(sales);
      salesTtmCr = ttmSum(sales);
    }
    if (np) {
      patQtrYoY = yoyGrowth(np);
      patTtmCr = ttmSum(np);
    }

    // Exceptional items heuristic:
    // If latest quarter PAT > (Sales × OPM/100) by >15% AND PAT growth is huge while Sales is flat/negative,
    // probability of one-time gain dominating is high.
    if (sales && opm && np && sales.length && opm.length && np.length) {
      const latestSales = sales[sales.length - 1];
      const latestOpm = opm[opm.length - 1];
      const latestPat = np[np.length - 1];
      if (latestSales && latestOpm && latestPat) {
        const expectedPatRough = (latestSales * latestOpm) / 100;
        if (latestPat > expectedPatRough * 1.5 && (salesQtrYoY === null || salesQtrYoY < 5)) {
          exceptionalItemsFlag = true;
        }
      }
    }
  }

  return {
    ticker,
    company,
    sector,
    mcapCr,
    promoterPct,
    pe,
    pb,
    divYield,
    roce,
    roe,
    debt,
    debtToEquity: dToE,
    opmLatestQ,
    opMargin3yAvg,
    salesTtmCr,
    patTtmCr,
    salesQtrYoY,
    patQtrYoY,
    exceptionalItemsFlag,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Universe loader (which tickers to scrape this run) ────────────────

async function loadUniverseTickers() {
  const blob = await kvGet('nse-ticker-universe:v1:latest');
  if (!blob || !Array.isArray(blob.tickers)) {
    throw new Error('nse-ticker-universe blob missing — scrape-nse-indices workflow must run first');
  }
  // Priority order: Large → Mid → Small → Micro → Other
  // Then within same cap, by ticker name (deterministic so we cycle predictably)
  const capRank = { Large: 0, Mid: 1, Small: 2, Micro: 3, Other: 4 };
  const sorted = [...blob.tickers].sort((a, b) => {
    const ra = capRank[a.cap] ?? 5;
    const rb = capRank[b.cap] ?? 5;
    if (ra !== rb) return ra - rb;
    return (a.ticker || '').localeCompare(b.ticker || '');
  });
  return sorted;
}

// ─── Rotation marker — track which tickers we've scraped recently ──────
// We process MAX_TICKERS_PER_RUN per run and cycle through the universe.
// 2155 tickers / 200 per run = ~11 runs to cover all. With daily runs,
// every ticker gets fundamentals refreshed at least once a week.

const ROTATION_KEY = 'fundamentals:v1:rotation-cursor';

async function getRotationCursor() {
  const v = await kvGet(ROTATION_KEY);
  return typeof v?.cursor === 'number' ? v.cursor : 0;
}

async function setRotationCursor(cursor, totalSize) {
  await kvSet(ROTATION_KEY, { cursor, totalSize, updatedAt: new Date().toISOString() }, 30 * 24 * 3600);
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-screener-fundamentals at ${new Date().toISOString()}`);

  const universe = await loadUniverseTickers();
  console.log(`  universe: ${universe.length} tickers`);

  let cursor = await getRotationCursor();
  if (cursor >= universe.length) cursor = 0;
  console.log(`  cursor: ${cursor} → ${Math.min(cursor + MAX_TICKERS_PER_RUN, universe.length)}`);

  const slice = universe.slice(cursor, cursor + MAX_TICKERS_PER_RUN);

  let ok = 0, fail = 0, exceptional = 0;
  for (let i = 0; i < slice.length; i++) {
    const { ticker } = slice[i];
    try {
      const fetched = await fetchScreener(ticker);
      if (!fetched) {
        fail++;
        continue;
      }
      const parsed = parseTicker(ticker, fetched.html);
      // Only persist if we extracted at least some signal
      if (parsed.mcapCr === null && parsed.opmLatestQ === null && parsed.salesTtmCr === null) {
        fail++;
        continue;
      }
      if (parsed.exceptionalItemsFlag) exceptional++;
      await kvSet(`fundamentals:v1:${ticker}`, parsed, KV_TTL_SECONDS);
      ok++;
      if ((i + 1) % 25 === 0) {
        console.log(`  ${i + 1}/${slice.length} processed (ok=${ok} fail=${fail})`);
      }
    } catch (e) {
      fail++;
      if (fail <= 5) console.log(`  ${ticker}: ${e?.message || e}`);
    }
    // Throttle to be polite to Screener
    if (i < slice.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  await setRotationCursor(cursor + slice.length, universe.length);

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`✓ done in ${elapsed}s · ok=${ok} fail=${fail} exceptionalItemFlag=${exceptional}`);
  console.log(`::notice title=Screener scrape::${ok} tickers updated, ${fail} failed, ${exceptional} flagged with exceptional items.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
