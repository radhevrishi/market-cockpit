import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedFetchJson, _resetSharedFetch } from '../tab-shared-fetch';
import { addSet, chooseSet, removeSet, readSets, withSet, activeSetOf, setsOf, MAIN_SET } from '../chart-drawing-sets';
import { readDrawingStore } from '../chart-sync';

test('zzz969 shared fetch: this tab always re-reads (only another tab\'s answer is reused); failures return null', async () => {
  _resetSharedFetch();
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ ok: 1 }), { status: 200 }); }) as any;
  try {
    assert.deepEqual(await sharedFetchJson('/x', 10_000), { ok: 1 });
    assert.deepEqual(await sharedFetchJson('/x', 10_000), { ok: 1 });
    assert.equal(calls, 2);
    globalThis.fetch = (async () => new Response('no', { status: 500 })) as any;
    assert.equal(await sharedFetchJson('/y', 10_000), null);
  } finally { globalThis.fetch = orig; }
});

test('zzz969 drawing sets: main keeps the old key, others get #id, and the sync keeps them', () => {
  let s = readSets(null);
  const r = addSet(s, 'US:ALAB', 'Earnings setup');
  s = r.store;
  assert.equal(r.id, 'earnings-setup');
  assert.equal(activeSetOf(s, 'US:ALAB'), 'earnings-setup');
  assert.equal(withSet('US:ALAB', activeSetOf(s, 'US:ALAB')), 'US:ALAB#earnings-setup');
  assert.equal(withSet('US:ALAB', MAIN_SET), 'US:ALAB');
  s = chooseSet(s, 'US:ALAB', MAIN_SET);
  assert.equal(setsOf(s, 'US:ALAB').length, 2);
  s = removeSet(s, 'US:ALAB', 'earnings-setup');
  assert.equal(setsOf(s, 'US:ALAB').length, 1);
  const store = readDrawingStore({ v: 2, items: { 'US:ALAB#earnings-setup': { at: 1, d: [{ name: 'mcHLine', points: [{ t: 1, p: 2 }] }] } } });
  assert.ok(store.items['US:ALAB#earnings-setup']);
});

import { backAdjustDividends } from '../chart-math';
test('zzz969 total return: bars before the ex-day are scaled by (1 − dividend ÷ prior close); the latest price is unchanged', () => {
  const d = (i: number, c: number) => ({ t: Date.UTC(2026, 0, 1 + i), o: c, h: c, l: c, c, v: 10 });
  const bars = [d(0, 100), d(1, 100), d(2, 98), d(3, 99)];
  const out = backAdjustDividends(bars, [{ t: bars[2].t, amount: 2 }]);
  assert.equal(out[3].c, 99);
  assert.equal(out[2].c, 98);
  assert.ok(Math.abs(out[1].c - 98) < 1e-9);   // 100 × (1 − 2/100)
  assert.equal(out[1].v, 10);
});
