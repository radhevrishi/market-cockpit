// zzz152 — TradingView sync v3: intercept Scanner API JSON, no Export-menu dependency.
// Diagnosis from zzz151 debug screenshots:
//   - Stealth plugin works: pages load fully, user is logged in (premium R avatar visible)
//   - 51 stocks render in the screener with all filters applied
//   - The Export-menu click hit the WRONG button (user-account avatar menu opened
//     instead of screener's own menu) because aria-label*="menu" was too broad
//
// New strategy: when the page loads, TradingView's web app POSTs to
//   https://scanner.tradingview.com/<market>/scan
// to fetch the screener results. We listen for that response, capture the JSON
// body, and convert it to CSV directly. No UI clicks needed.
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';
import path from 'node:path';

chromium.use(StealthPlugin());

const SCREENERS = [
  { id: 'sBtiBahk', slug: 'minervini-stocks',          name: 'Minervni Stocks' },
  { id: 'WJDx6FZ9', slug: 'qullamaggie-leaders',       name: 'Qualmaggie Leader Stocks in Bearmarket or Corrections' },
  { id: 'Px4kG2hQ', slug: 'episodic-pivot',            name: 'EPISODIC PIVOT / VOLUME SURGE' },
  { id: '9IcX30Ez', slug: 'liquidity-leaders',         name: 'Liquidity Leaders' },
  { id: 'Neuim2Bm', slug: 'weekly-gainer-usa',         name: 'Weekly Gainer Stocks USA' },
  { id: 'RtSuWTgK', slug: 'sales-eps-growth-bonde',    name: 'Sales And EPS Growth for EP - Pradeep Bonde style' },
];

const SESSION = process.env.TRADINGVIEW_SESSIONID;
if (!SESSION) { console.error('[fatal] TRADINGVIEW_SESSIONID not set'); process.exit(1); }

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'frontend/public/data/tradingview');
const DEBUG_DIR = path.join(OUT_DIR, '_debug');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
  locale: 'en-US',
  timezoneId: 'America/New_York',
});
await context.addCookies([
  { name: 'sessionid', value: SESSION, domain: '.tradingview.com', path: '/', secure: true, sameSite: 'Lax' },
]);

const shot = async (page, sc, step) => {
  try { await page.screenshot({ path: path.join(DEBUG_DIR, `${sc.slug}-${step}.png`), fullPage: false }); } catch {}
};

// Convert TradingView Scanner JSON to a CSV that mimics the manual-export format.
// Scanner JSON shape (typical): { totalCount, data: [{ s: "NASDAQ:AAPL", d: [v0, v1, ...] }, ...] }
// `columns` array is sometimes in a separate response. We save raw JSON for debugging.
function scannerJsonToCsv(scanResponse, requestBody) {
  if (!scanResponse || !Array.isArray(scanResponse.data)) return null;
  // Columns are echoed in the request body, not always in response
  let columns = [];
  try {
    const reqJson = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
    columns = reqJson?.columns || [];
  } catch {}
  const header = ['Symbol', 'Exchange', ...columns];
  const rows = scanResponse.data.map(item => {
    const sym = (item.s || '').split(':');
    const exchange = sym[0] || '';
    const ticker = sym[1] || sym[0] || '';
    const vals = (item.d || []).map(v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v.includes(',') ? `"${v.replace(/"/g, '""')}"` : v;
      return String(v);
    });
    return [ticker, exchange, ...vals].join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

const results = [];

for (const sc of SCREENERS) {
  console.log(`\n=== ${sc.name} (${sc.id}) ===`);
  const page = await context.newPage();
  const outPath = path.join(OUT_DIR, `${sc.slug}.csv`);
  const rawJsonPath = path.join(DEBUG_DIR, `${sc.slug}-scanner-response.json`);

  // Capture all scanner requests and their responses
  const scannerCalls = [];
  const onRequest = (request) => {
    const url = request.url();
    if (url.includes('scanner.tradingview.com') && url.includes('/scan')) {
      try {
        const postData = request.postData();
        scannerCalls.push({ url, request: postData, response: null });
        console.log(`  → scanner request: ${url.slice(0, 100)}`);
      } catch {}
    }
  };
  const onResponse = async (response) => {
    const url = response.url();
    if (url.includes('scanner.tradingview.com') && url.includes('/scan')) {
      try {
        const body = await response.json();
        const last = scannerCalls.find(c => c.url === url && c.response === null);
        if (last) last.response = body;
        console.log(`  ← scanner response: ${response.status()} (${body?.data?.length || 0} rows)`);
      } catch (e) {
        console.log(`  ← scanner non-JSON response: ${e.message}`);
      }
    }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);

  try {
    const url = `https://www.tradingview.com/screener/${sc.id}/`;
    console.log(`  → ${url}`);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`  HTTP ${resp ? resp.status() : '?'}`);
    await shot(page, sc, '1-loaded');

    // Wait for scanner calls to complete
    try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
    await page.waitForTimeout(5000);
    await shot(page, sc, '2-after-wait');

    console.log(`  captured ${scannerCalls.length} scanner calls`);

    // Save the raw captures for debugging
    fs.writeFileSync(rawJsonPath, JSON.stringify(scannerCalls, null, 2));

    // Find the scanner call with the most data — that's the real screener result
    const bestCall = scannerCalls
      .filter(c => c.response && Array.isArray(c.response.data))
      .sort((a, b) => (b.response.data.length) - (a.response.data.length))[0];

    if (!bestCall) {
      throw new Error('No scanner data captured');
    }
    console.log(`  best call has ${bestCall.response.data.length} rows`);

    const csv = scannerJsonToCsv(bestCall.response, bestCall.request);
    if (!csv) throw new Error('Failed to convert scanner JSON to CSV');
    fs.writeFileSync(outPath, csv);
    const stat = fs.statSync(outPath);
    console.log(`  ✓ ${path.basename(outPath)} (${stat.size} bytes, ${bestCall.response.data.length} rows)`);
    results.push({ ...sc, ok: true, size: stat.size, rowCount: bestCall.response.data.length });
  } catch (e) {
    const errMsg = e.message || String(e);
    console.error(`  ✗ ${sc.slug}: ${errMsg}`);
    await shot(page, sc, '9-FAIL');
    results.push({ ...sc, ok: false, error: errMsg });
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    await page.close();
    await new Promise(r => setTimeout(r, 2000));
  }
}

await browser.close();

const manifest = {
  lastSync: new Date().toISOString(),
  workflowVersion: 'zzz152',
  approach: 'scanner-api-interception',
  ok: results.filter(r => r.ok).length,
  fail: results.filter(r => !r.ok).length,
  files: results.map(r => ({
    name: `${r.slug}.csv`,
    displayName: r.name,
    screenerId: r.id,
    ok: r.ok,
    size: r.size || 0,
    rowCount: r.rowCount || 0,
    error: r.error || null,
  })),
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n=== Manifest: ${manifest.ok} ok, ${manifest.fail} failed ===`);

if (manifest.fail === results.length) {
  console.error('::error::All screeners failed. Inspect _debug/<slug>-scanner-response.json files for what TradingView returned.');
  process.exit(2);
}
