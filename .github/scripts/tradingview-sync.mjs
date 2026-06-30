// zzz151 — TradingView sync v2: stealth plugin + always-save debug screenshots.
// Failure mode in v1 was "All screeners failed" with no useful info because
// the prior debug screenshots were discarded when the script exited non-zero
// before the commit step ran. Now: we save multi-step screenshots for every
// screener (pre-load, post-render, post-menu, on-failure) and the workflow
// uploads them as an artifact + commits them to the repo so we can inspect.
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

// process.cwd() is .github/scripts when run from workflow
const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'frontend/public/data/tradingview');
const DEBUG_DIR = path.join(OUT_DIR, '_debug');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });
console.log(`Output dir: ${OUT_DIR}`);
console.log(`Debug dir: ${DEBUG_DIR}`);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
  ],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
  locale: 'en-US',
  timezoneId: 'America/New_York',
  bypassCSP: true,
});
await context.addCookies([
  { name: 'sessionid', value: SESSION, domain: '.tradingview.com', path: '/', secure: true, sameSite: 'Lax' },
]);

const shot = async (page, sc, step) => {
  const file = path.join(DEBUG_DIR, `${sc.slug}-${step}.png`);
  try { await page.screenshot({ path: file, fullPage: false }); console.log(`  📸 ${path.basename(file)}`); } catch {}
};

const results = [];

for (const sc of SCREENERS) {
  console.log(`\n=== ${sc.name} (${sc.id}) ===`);
  const page = await context.newPage();
  const outPath = path.join(OUT_DIR, `${sc.slug}.csv`);

  try {
    const url = `https://www.tradingview.com/screener/${sc.id}/`;
    console.log(`  → ${url}`);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`  HTTP ${resp ? resp.status() : '?'} ${resp ? resp.statusText() : ''}`);
    await shot(page, sc, '1-loaded');

    // Detect Cloudflare or login challenge
    const title = await page.title();
    console.log(`  page title: "${title}"`);
    const html = await page.content();
    if (/just a moment|cloudflare|attention required|checking your browser/i.test(title) ||
        /cf-browser-verification|cf-challenge-running/i.test(html)) {
      console.log('  ⚠️ Cloudflare challenge detected — waiting up to 30s for it to resolve');
      try { await page.waitForFunction(() => !document.title.match(/just a moment|cloudflare|checking/i), { timeout: 30000 }); } catch {}
      await shot(page, sc, '1b-post-cloudflare');
    }

    if (/sign in|log in/i.test(title)) {
      throw new Error(`Login page returned — sessionid likely expired. Title: "${title}"`);
    }

    // Wait for the screener UI to mount
    try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
    await page.waitForTimeout(5000);
    await shot(page, sc, '2-after-wait');

    // Strategy A: TradingView 3-dot button on screener toolbar
    let downloaded = false;

    const tryMenuExport = async () => {
      const triggers = await page.$$('button[aria-label*="menu" i], button[aria-label*="More" i], button[data-name="menu-button"], [data-name="screener-toolbar"] button, .menuOpenButton-l31H9iuA, .menuOpenButton');
      console.log(`  found ${triggers.length} potential menu buttons`);
      for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        try {
          const box = await t.boundingBox();
          if (!box) continue;
          // Only consider buttons in the top half (toolbar area)
          if (box.y > 250) continue;
          await t.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          await shot(page, sc, `3-menu-${i}-opened`);
          // Look for Export in the open menu
          const exp = await page.$('[data-name="export"], div[role="menuitem"]:has-text("Export"), button:has-text("Export"), span:has-text("Export")');
          if (exp) {
            console.log(`  menu ${i}: clicked Export`);
            await exp.click({ timeout: 3000 });
            await page.waitForTimeout(500);
            await shot(page, sc, `4-export-${i}-opened`);
            // CSV option
            const dlPromise = page.waitForEvent('download', { timeout: 20000 });
            const csv = await page.$('button:has-text("CSV"), a:has-text("CSV"), div[role="menuitem"]:has-text("CSV"), text=/^CSV/i');
            if (csv) {
              await csv.click({ timeout: 3000 });
              const dl = await dlPromise;
              await dl.saveAs(outPath);
              return true;
            }
            console.log('  CSV option not found in export submenu');
          }
          // Close menu before trying next trigger
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(300);
        } catch (e) {
          console.log(`  trigger ${i} failed: ${e.message.split('\n')[0]}`);
        }
      }
      return false;
    };

    downloaded = await tryMenuExport();

    // Strategy B: Direct keyboard shortcut Alt+S (legacy TV screener)
    if (!downloaded) {
      console.log('  trying Alt+S shortcut...');
      try {
        const dlPromise = page.waitForEvent('download', { timeout: 10000 });
        await page.keyboard.press('Alt+S');
        const dl = await dlPromise;
        await dl.saveAs(outPath);
        downloaded = true;
      } catch (e) {
        console.log(`  Alt+S failed: ${e.message.split('\n')[0]}`);
      }
    }

    if (!downloaded) {
      throw new Error('Could not trigger CSV export (no menu, no shortcut worked)');
    }

    const stat = fs.statSync(outPath);
    if (stat.size < 200) throw new Error(`CSV looks empty (${stat.size} bytes)`);
    console.log(`  ✓ ${path.basename(outPath)} (${stat.size} bytes)`);
    results.push({ ...sc, ok: true, size: stat.size });
  } catch (e) {
    const errMsg = e.message || String(e);
    console.error(`  ✗ ${sc.slug}: ${errMsg}`);
    await shot(page, sc, '9-FAIL');
    results.push({ ...sc, ok: false, error: errMsg });
  } finally {
    await page.close();
    await new Promise(r => setTimeout(r, 2000));
  }
}

await browser.close();

const manifest = {
  lastSync: new Date().toISOString(),
  workflowVersion: 'zzz151',
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
console.log(`\n=== Manifest: ${manifest.ok} ok, ${manifest.fail} failed ===`);

// Exit non-zero only if all failed (so partial success still commits files)
if (manifest.fail === results.length) {
  console.error('::error::All screeners failed. Check uploaded debug screenshots.');
  process.exit(2);
}
