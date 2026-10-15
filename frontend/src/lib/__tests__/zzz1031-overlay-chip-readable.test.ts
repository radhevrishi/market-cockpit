// zzz1031 — QA: compact overlay chips cut the pattern to "Daily: …" and the stage's confirmation. Chips keep the pattern name and
// condition / the stage and its confirmation, keep a readable minimum width, and the row wraps onto a second line (the legend
// follows the row's measured height).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlayChipText } from '../chart-display';

test('chip text keeps pattern name + condition and stage + confirmation', () => {
  assert.equal(overlayChipText('stage', 'Stage 2 · Advancing · began wk to 7 Aug · confirmed 14 Aug close (10 weeks) · 30-wk MA rising · price 9% above MA'), 'Stage 2 · Advancing · confirmed 14 Aug close (10 weeks)');
  assert.equal(overlayChipText('patterns', '📐 Monthly: no qualifying pattern · Other timeframe → Daily: Descending triangle · broke down 2 days ago · breakdown $135.20, 11% below · shape 62/100'), '📐 Monthly: none · Daily: Descending triangle broke down 2d');
  assert.equal(overlayChipText('patterns', '📐 Falling wedge · Daily · broke out 6 days ago · pivot ₹4,521.99'), '📐 Daily: Falling wedge broke out 6d');
});

test('row wraps, chips keep a readable width, legend follows the row height', () => {
  const dock = readFileSync(new URL('../../components/charts/overlay-dock.ts', import.meta.url), 'utf8');
  assert.match(dock, /minWidth: 'min\(240px, 100%\)'/);
  const sum = readFileSync(new URL('../../components/charts/OverlaySummary.tsx', import.meta.url), 'utf8');
  assert.match(sum, /flexWrap: 'wrap'/);
  assert.match(sum, /new ResizeObserver\(report\)/);
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ws, /onHeight=\{setOverlayRowH\}/);
  assert.match(ws, /const legendTop = nOverlays \? 4 \+ overlayRowH \+ 4 : 28;/);
});
