// zzz1033 — owner: the left rail only on the home page; Pine: an option to hide the filter panel (shown by default), the coverage /
// scope / count lines behind "ⓘ Details" (hidden by default), and the lede line removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('left rail: shown on the home page only; MARKET COCKPIT links home', () => {
  const d = read('../../app/(dashboard)/DashboardClient.tsx');
  assert.match(d, /\$\{pathname === '\/' \? '' : ' rail-hidden'\}/);
  assert.match(d, /<Link href="\/" prefetch=\{false\} title="Home — all pages"/);
  const css = read('../../app/globals.css');
  assert.match(css, /\.desktop-sidebar\.rail-hidden \{ display: none !important; \}/);
});

test('Pine: filter panel can be hidden (default shown, remembered); details hidden by default; lede removed', () => {
  const p = read('../../components/pine-screener/PineScreener.tsx');
  assert.match(p, /localStorage\.getItem\('mc:pine-filters-hidden:v1'\) === '1'/);
  assert.match(p, /data-testid="pine-filters-collapse"/);
  assert.match(p, /localStorage\.getItem\('mc:pine-details:v1'\) === '1'/);
  assert.match(p, /\{showDetails && snap && scopeCov \? \(/);
  assert.match(p, /\{showDetails && scope && listTickers \? \(/);
  assert.doesNotMatch(p, /Which charts are setting up now/);
  const ui = read('../../components/pine-screener/pine-ui.tsx');
  assert.match(ui, /\.pnx-layout\[data-filters-hidden="true"\]/);
});
