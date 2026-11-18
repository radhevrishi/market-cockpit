import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinceAdded } from '../transformational/since-added';

const bar = (d: string, c: number) => ({ t: Date.parse(`${d}T10:00:00Z`) / 1000, o: c, h: c, l: c, c, v: 1 });

test('zzz1280 since added: close of the added session → latest close', () => {
  const bars = [bar('2026-11-10', 90), bar('2026-11-11', 100), bar('2026-11-12', 104), bar('2026-11-18', 112)];
  assert.deepEqual(sinceAdded(bars, '2026-11-11'), { base: 100, baseDate: '2026-11-11', last: 112, lastDate: '2026-11-18', pct: 12, sessions: 2 });
  assert.equal(sinceAdded(bars, '2026-11-08')?.baseDate, '2026-11-10');   // weekend session date → next trading day
  assert.equal(sinceAdded(bars, '2026-11-18')?.sessions, 0);
  assert.equal(sinceAdded(bars, '2026-11-19'), null);                    // not in the series yet
  assert.equal(sinceAdded([bar('2026-11-18', 1)], '2026-10-01'), null);  // added day missing from the series
  assert.equal(sinceAdded([], '2026-11-11'), null);
});
