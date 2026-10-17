// zzz1065 (H01) — REAL BROWSER layout check for the home lazy panels and the Signal Inbox lanes.
// A full `next build` is too heavy for the sandbox, so this renders a small static HTML harness that uses the exact
// wrapper CSS LazyPanel uses (lib/lazy-panel-style.ts) and the exact inbox CSS from globals.css, in Chromium, at
// 390 / 768 / 1024 / 1366 / 1920 px. JSDOM cannot catch this bug (it has no layout: every width is 0).
//
// Run by hand (not part of `npm test` / CI, which have no browser):
//   node --import tsx --test tests/e2e/zzz1065-lazy-panel-layout.test.ts
// Playwright is resolved from the frontend's node_modules or the global tools folder; if neither has it, the test skips.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { lazyPanelWrapperCss } from '../../src/lib/lazy-panel-style';
import { inboxLaneColumns } from '../../src/lib/inbox-lanes';

const WIDTHS = [390, 768, 1024, 1366, 1920];
const req = createRequire(import.meta.url);
function loadPlaywright(): any | null {
  for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright', '/home/claude/.npm-global/lib/node_modules/playwright']) {
    try { return req(p); } catch { /* next */ }
  }
  return null;
}
const pw = loadPlaywright();
const chromePath = ['/opt/pw-browsers/chromium', process.env.PLAYWRIGHT_CHROMIUM_PATH].find((p) => p && existsSync(p) && !p.endsWith('/'));

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
const inboxCss = css.slice(css.indexOf('/* zzz1065 — Daily Signal Inbox'), css.indexOf('/* zzz1065 — home: never scroll sideways'));

/** The home structure: `container` is how the blocks are laid out (the fixed column, or the OLD wrapping row). */
function harness(container: 'column' | 'old-row', wrapperCss: (state: 'waiting' | 'mounted', h: number) => string): string {
  const containerCss = container === 'column'
    ? 'display:flex;flex-direction:column;gap:12px;min-width:0'
    : 'display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px';
  const panels = [['inbox', 220], ['fresh', 40], ['score', 200]] as const;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:14px sans-serif} .root{padding:12px 16px;overflow-x:clip} .max{max-width:1400px;margin:0 auto}
${inboxCss}</style></head><body><div class="root"><div class="max"><div id="col" style="${containerCss}">
<div style="height:40px;width:100%">status strip</div>
<div style="height:1400px;width:100%">tall blocks above the fold</div>
${panels.map(([id, h]) => `<div id="${id}" data-lazy-panel="waiting" data-h="${h}" style="${wrapperCss('waiting', h)}"></div>`).join('\n')}
<div style="height:1600px;width:100%">below</div>
</div></div></div>
<script>
window.__mounts = {};
const WRAP = ${JSON.stringify({ inbox: wrapperCss('mounted', 220), fresh: wrapperCss('mounted', 40), score: wrapperCss('mounted', 200) })};
for (const el of document.querySelectorAll('[data-lazy-panel]')) {
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting || e.intersectionRatio > 0)) return;
    io.disconnect();
    window.__mounts[el.id] = (window.__mounts[el.id] || 0) + 1;
    el.setAttribute('data-lazy-panel', 'mounted');
    el.setAttribute('style', WRAP[el.id]);
    el.innerHTML = el.id === 'inbox'
      ? '<div class="mc-inbox-wrap"><div class="mc-inbox-lanes" style="display:grid;gap:10px">' + ['MOMENTUM','WARRANT','TRANSFORM','BENCH'].map((l) => '<div data-lane="' + l + '" style="height:80px;min-width:0">' + l + '</div>').join('') + '</div></div>'
      : '<div style="height:' + el.dataset.h + 'px">panel ' + el.id + '</div>';
  }, { rootMargin: '300px' });
  io.observe(el);
}
</script></body></html>`;
}

describe('home lazy panels in a real browser (Chromium)', { skip: !pw ? 'playwright not installed' : false }, () => {
  let browser: any;
  before(async () => { browser = await pw.chromium.launch(chromePath ? { executablePath: chromePath } : {}); });
  after(async () => { await browser?.close(); });

  const geometry = async (page: any) => page.evaluate(() => ['inbox', 'fresh', 'score'].map((id) => {
    const r = document.getElementById(id)!.getBoundingClientRect();
    return { id, w: r.width, h: r.height, state: document.getElementById(id)!.getAttribute('data-lazy-panel') };
  }));

  test('reproduction: the OLD wrapper (min-height only) in the OLD wrapping row has width 0', async () => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
    await page.setContent(harness('old-row', (_s, h) => `min-height:${h}px`));
    const g = await geometry(page);
    assert.ok(g.every((x: any) => x.w === 0), `old layout widths: ${JSON.stringify(g)}`);
    await page.close();
  });

  for (const width of WIDTHS) {
    for (const container of ['column', 'old-row'] as const) {
      test(`${width}px, ${container}: positive width, mounts once on scroll, no remount, no sideways scroll, 1/2/4 lanes`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        await page.setContent(harness(container, lazyPanelWrapperCss));
        const before = await geometry(page);
        for (const x of before) {
          assert.ok(x.w > 0, `${x.id} width ${x.w} before mount`);
          assert.equal(x.state, 'waiting', `${x.id} not mounted while far below the screen`);
        }
        const inboxBefore = before.find((x: any) => x.id === 'inbox')!;
        for (const id of ['inbox', 'fresh', 'score']) {
          await page.evaluate((i: string) => document.getElementById(i)!.scrollIntoView({ block: 'start' }), id);
          await page.waitForFunction((i: string) => document.getElementById(i)!.getAttribute('data-lazy-panel') === 'mounted', id, { timeout: 5000 });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);
        await page.evaluate(() => document.getElementById('score')!.scrollIntoView());
        await page.waitForTimeout(100);
        const mounts = await page.evaluate(() => (window as any).__mounts);
        assert.deepEqual(mounts, { inbox: 1, fresh: 1, score: 1 }, 'each panel mounted exactly once');
        const afterG = await geometry(page);
        for (const x of afterG) assert.ok(x.w > 0, `${x.id} width after mount`);
        assert.equal(afterG.find((x: any) => x.id === 'inbox')!.w, inboxBefore.w, 'inbox keeps its width (no jump)');
        const lanes = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('[data-lane]')) as HTMLElement[];
          const tops = new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)));
          const lefts = new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)));
          return { n: els.length, rows: tops.size, cols: lefts.size, inboxW: document.querySelector('.mc-inbox-wrap')!.getBoundingClientRect().width };
        });
        assert.equal(lanes.n, 4, 'four lanes');
        assert.notEqual(lanes.cols, 3, 'never 3 + 1');
        assert.equal(lanes.cols, inboxLaneColumns(lanes.inboxW), `lane columns at inbox width ${lanes.inboxW}`);
        assert.equal(lanes.cols * lanes.rows, 4);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(sideways <= 0, `no sideways scroll (${sideways}px)`);
        await page.close();
      });
    }
  }
});
