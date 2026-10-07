import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPriceRange } from '../chart-math';
import { activeLayout, cleanLayout, sameSettings, sanitizeLayoutStore, seedLayoutStore } from '../chart-layouts';

test('auto-fit uses only the candles on screen', () => {
  const lows = [1, 50, 52, 49, 500], highs = [2, 55, 56, 53, 600];
  assert.deepEqual(fitPriceRange(lows, highs, 1, 4), { min: 49, max: 56 });     // bars 1..3 on screen; the far ones ignored
  assert.deepEqual(fitPriceRange(lows, highs, -5, 99), { min: 1, max: 600 });   // clamped to the data
  assert.equal(fitPriceRange(lows, highs, 3, 3), null);                         // nothing on screen
  assert.deepEqual(fitPriceRange([10], [10], 0, 1), { min: 9.9, max: 10.1 });   // flat: a small band around it
  assert.deepEqual(fitPriceRange([NaN, 5], [NaN, 6], 0, 2), { min: 5, max: 6 });
});

test('A / L are part of each layout: auto on and log off by default, kept on save, older layouts upgraded', () => {
  const s = seedLayoutStore(1);
  assert.deepEqual(activeLayout(s).scale, { auto: true, log: false });
  const old = sanitizeLayoutStore({ layouts: [{ id: 'a', name: 'Old', lines: [], volume: { on: true, avg: 20 }, extras: [] }], activeId: 'a' });
  assert.deepEqual(old.layouts[0].scale, { auto: true, log: false });          // zzz944 layouts had no scale
  const l = activeLayout(s);
  const logOn = cleanLayout({ ...l, scale: { auto: false, log: true } });
  assert.deepEqual(logOn.scale, { auto: false, log: true });
  assert.equal(sameSettings(l, logOn), false);                                  // toggling A or L marks the layout ●
});
