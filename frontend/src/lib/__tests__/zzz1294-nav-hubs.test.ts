import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUBS, SYSTEM_PAGES, allHubLinks, hubFor } from '../nav-hubs';

const root = join(__dirname, '..', '..');
const hrefsIn = (src: string) => Array.from(src.matchAll(/href: '([^']+)'/g)).map((m) => m[1]);

test('seven main hubs', () => { assert.equal(HUBS.length, 7); });

test('every old favourite chip on the home page is inside a hub (nothing lost)', () => {
  const home = readFileSync(join(root, 'app/(dashboard)/page.tsx'), 'utf8');
  const favs = hrefsIn(home.slice(home.indexOf('const FAVS'), home.indexOf('const FAV_ORDER_KEY')));
  assert.ok(favs.length >= 50);
  const links = new Set(allHubLinks());
  const missing = favs.filter((h) => !links.has(h));
  assert.deepEqual(missing, []);
});

test('every page of the old sidebar is in a hub or the System group', () => {
  const old = ['/', '/cockpit', '/news', '/hundred-baggers', '/in-play', '/fundamentals', '/earnings-hub', '/earnings-opportunities', '/us-earnings-opportunities', '/us-conviction-beats', '/ai-gainers', '/transformational-gainers', '/inflection-radar', '/company-lab', '/guidance-upgrades', '/growth-guidance', '/ai-desk', '/earnings', '/earnings-analysis', '/earnings-guidance', '/pead-tracker', '/calendars', '/bottleneck-intel', '/bottleneck-workbench', '/transmission', '/strategic-visibility', '/concall-intel', '/search-docs', '/concall-intel?tab=radar', '/guidance-extractor', '/company-intel', '/special-situations', '/book-watch', '/strategic-hires', '/marquee-capital', '/marketing-auth', '/multibagger', '/smallcap-simulator', '/qqq-simulator', '/historical-returns', '/buy-strategy', '/capex-tracker', '/valuations', '/valuation-calc', '/return-simulator', '/valuation-bands', '/portfolio-simulator', '/winning-playbook', '/auto-valuation', '/rerating', '/stock-sheet', '/screener', '/stock-screener', '/screener-screens', '/pine-screener', '/charts', '/charts/grid', '/market-leadership', '/market-snapshot', '/heatmap', '/movers', '/rrg', '/breadth', '/smart-money', '/fii-dii', '/ipos', '/portfolio', '/portfolio?tab=tradebook', '/us-portfolio-book', '/portfolio-catalysts', '/us-portfolio-catalysts', '/exit-radar', '/risk', '/position-sizing', '/thesis', '/coffee-can', '/tax-planner', '/watchlists', '/price-alerts', '/decisions', '/activity-log', '/orders', '/alerts', '/playbook', '/investing-os', '/journey', '/monte-carlo', '/market-cycles', '/gautam-baid', '/earnings-trigger', '/earnings-trigger-masterclass', '/critical-themes', '/themes', '/news-alerts', '/status', '/ai-runs', '/system-health', '/guidance-diagnostics', '/settings'];
  const links = new Set([...allHubLinks(), ...SYSTEM_PAGES.map((p) => p.href)]);
  assert.deepEqual(old.filter((h) => !links.has(h)), []);
});

test('the current address finds the most specific sub-tab, and India / USA twins share one', () => {
  assert.equal(hubFor('/us-earnings-opportunities')?.tab.label, 'Earnings Ops');
  assert.equal(hubFor('/us-earnings-opportunities')?.market, 'US');
  assert.equal(hubFor('/watchlists', 'tab=conviction')?.hub.id, 'earnings');
  assert.equal(hubFor('/watchlists')?.hub.id, 'book');
  assert.equal(hubFor('/concall-intel', 'tab=radar')?.tab.label, 'Transformation Radar');
  assert.equal(hubFor('/concall-intel')?.tab.label, 'Concall Intelligence');
  assert.equal(hubFor('/multibagger', 'tab=technicals-usa')?.hub.id, 'charts');
  assert.equal(hubFor('/multibagger', 'tab=technicals-usa')?.market, 'US');
  assert.equal(hubFor('/multibagger', 'tab=excel')?.tab.label, 'Multibagger');
  assert.equal(hubFor('/pine-screener', 'screen=mtf-aligned')?.tab.label, 'Pine Screener');
  assert.equal(hubFor('/playbook', '', '#stress')?.link, '/playbook#stress');
  assert.equal(hubFor('/news', 'choke=1')?.hub.id, 'discover');
  assert.equal(hubFor('/news')?.hub.id, 'markets');
  assert.equal(hubFor('/nowhere'), null);
});
