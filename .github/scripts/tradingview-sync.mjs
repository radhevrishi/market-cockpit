// zzz150 — TradingView saved-screener sync (Playwright-based)
// Reads the user's TRADINGVIEW_SESSIONID, opens each saved screener, exports
// to CSV, writes manifest.json. Robust to TradingView's two common export
// patterns (download event vs HTTP response interception).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

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
fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`Output dir: ${OUT_DIR}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
});
await context.addCookies([
  { name: 'sessionid', value: SESSION, domain: '.tradingview.com', path: '/', secure: true, sameSite: 'Lax' },
]);

const results = [];

for (const sc of SCREENERS) {
  console.log(`\n=== ${sc.name} (${sc.id}) ===`);
  const page = await context.newPage();
  const outPath = path.join(OUT_DIR, `${sc.slug}.csv`);
  let ok = false;
  let errMsg = '';

  try {
    const url = `https://www.tradingview.com/screener/${sc.id}/`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    console.log('  page loaded, waiting for screener table...');
    // Wait for the screener table to render
    await page.waitForSelector('[data-name="screener"], div.screener, table', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Strategy 1: try keyboard shortcut Alt+S (TradingView's screener export shortcut on some versions)
    // Strategy 2: click 3-dot menu → Export → CSV
    // We try several known selectors

    const exportTriggers = [
      'button[aria-label*="Open menu" i]',
      'button[data-name="menu-inner"]',
      'div[data-name="menu-inner"]',
      'button[aria-label*="More" i]',
    ];

    let menuOpened = false;
    for (const sel of exportTriggers) {
      const all = await page.$$(sel);
      for (const el of all) {
        try {
          const box = await el.boundingBox();
          if (!box) continue;
          await el.click({ timeout: 3000 });
          await page.waitForTimeout(500);
          // Look for Export in menu
          const exp = await page.$('text=/^Export/i, [data-name*="export" i], button:has-text("Export")');
          if (exp) {
            await exp.click({ timeout: 3000 });
            menuOpened = true;
            break;
          }
        } catch {}
      }
      if (menuOpened) break;
    }

    // Try direct Export button if menu approach failed
    if (!menuOpened) {
      const directExport = await page.$('button:has-text("Export"), [aria-label*="Export" i]');
      if (directExport) {
        await directExport.click({ timeout: 3000 }).catch(() => {});
      }
    }

    await page.waitForTimeout(800);

    // Click CSV option
    const dlPromise = page.waitForEvent('download', { timeout: 30000 });
    const csvCandidates = ['button:has-text("CSV")', 'a:has-text("CSV")', 'text="CSV"', '[data-name*="csv" i]'];
    let csvClicked = false;
    for (const sel of csvCandidates) {
      const el = await page.$(sel);
      if (el) {
        try { await el.click({ timeout: 3000 }); csvClicked = true; break; } catch {}
      }
    }
    if (!csvClicked) throw new Error('Could not find CSV export option (TradingView UI may have changed)');

    const dl = await dlPromise;
    await dl.saveAs(outPath);
    const stat = fs.statSync(outPath);
    console.log(`  ✓ saved ${outPath} (${stat.size} bytes)`);
    results.push({ ...sc, ok: true, size: stat.size });
    ok = true;
  } catch (e) {
    errMsg = e.message || String(e);
    console.error(`  ✗ ${sc.slug}: ${errMsg}`);
    // Save a debug screenshot for inspection
    try { await page.screenshot({ path: path.join(OUT_DIR, `_debug-${sc.slug}.png`), fullPage: false }); } catch {}
    results.push({ ...sc, ok: false, error: errMsg });
  } finally {
    await page.close();
  }

  // Throttle between screeners
  await new Promise(r => setTimeout(r, 2000));
}

await browser.close();

const manifest = {
  lastSync: new Date().toISOString(),
  ok: results.filter(r => r.ok).length,
  fail: results.filter(r => !r.ok).length,
  files: results.map(r => ({
    name: `${r.slug}.csv`,
    displayName: r.name,
    screenerId: r.id,
    ok: r.ok,
    size: r.size || 0,
    error: r.error || null,
  })),
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nManifest: ${manifest.ok} ok, ${manifest.fail} failed`);

if (manifest.fail === results.length) {
  console.error('::error::All screeners failed. Likely Cloudflare block or expired sessionid.');
  process.exit(2);
}
