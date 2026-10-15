// zzz1035 — owner (NTNX screenshot): "so many lines and look messy". Clean view: auto levels = the 2 nearest above and below the
// price, drawn from their last touch; trendlines = the strongest rising and the strongest falling, no broken ones; level touch rings on
// hover only; hidden legend rows fold into "+N hidden". Research unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanLevels, cleanLines } from '../../components/charts/auto-lines-kline';

test('clean levels: 2 nearest each side of the close', () => {
  const L = [60, 63, 66, 68.7, 71.7, 76.2, 80].map((price, i) => ({ id: `l${i}`, price }));
  assert.deepEqual(cleanLevels(L, 69.85).map((l) => l.price), [71.7, 76.2, 68.7, 66]);
  assert.equal(cleanLevels(L, null).length, 4);
});

test('clean lines: strongest intact support and resistance only', () => {
  const ls = [
    { id: 'a', kind: 'support' as const, broken: false, strength: 50 },
    { id: 'b', kind: 'support' as const, broken: false, strength: 70 },
    { id: 'c', kind: 'resistance' as const, broken: true, strength: 90 },
    { id: 'd', kind: 'resistance' as const, broken: false, strength: 40 },
  ];
  assert.deepEqual(cleanLines(ls).map((l) => l.id), ['b', 'd']);
});

test('wiring: Clean branch in the drawing, folded hidden legend rows, note in the list', () => {
  const k = readFileSync(new URL('../../components/charts/auto-lines-kline.ts', import.meta.url), 'utf8');
  assert.match(k, /const levelsShown = clean \? cleanLevels/);
  assert.match(k, /const linesShown = clean \? cleanLines/);
  assert.match(k, /if \(!clean \|\| hov\) for \(const \[t, p\] of lv\.touches\)/);
  const lc = readFileSync(new URL('../../components/charts/LayoutControls.tsx', import.meta.url), 'utf8');
  assert.match(lc, /data-testid="legend-hidden-toggle"/);
  assert.match(lc, /`\+\$\{hiddenN\} hidden`/);
  const ai = readFileSync(new URL('../../components/charts/AutoLinesIndicator.tsx', import.meta.url), 'utf8');
  assert.match(ai, /data-testid="aln-clean-note"/);
});
