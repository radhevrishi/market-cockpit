import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeServerPull, mergeUpload, tagRows } from '../../app/(dashboard)/multibagger/tech-merge';

test('server pull replaces old rows (FSLY stuck at an old price)', () => {
  const old = [{ symbol: 'FSLY', price: 26.34 }, { symbol: 'GONE', price: 5 }, { symbol: 'MINE', price: 9, _src: 'upload' }];
  const m = mergeServerPull(old, tagRows([{ symbol: 'FSLY', price: 15.86 }, { symbol: 'NEW', price: 3 }], 'server', '2026-11-24T19:25:00Z'));
  const by = Object.fromEntries(m.rows.map((r) => [r.symbol, r]));
  assert.equal(by.FSLY.price, 15.86);
  assert.equal(by.GONE, undefined, 'a row the server no longer lists is dropped');
  assert.equal(by.MINE.price, 9, 'own upload not on the server stays');
  assert.equal(m.added, 1); assert.equal(m.updated, 1); assert.equal(m.dropped, 1);
});

test('server row wins over an older upload of the same symbol; upload replaces same symbols', () => {
  const m = mergeServerPull([{ symbol: 'A', price: 1, _src: 'upload' }], tagRows([{ symbol: 'A', price: 2 }], 'server', 'x'));
  assert.equal(m.rows[0].price, 2);
  const u = mergeUpload([{ symbol: 'A', price: 2 }, { symbol: 'B', price: 7 }], [{ symbol: 'A', price: 3 }], true);
  assert.deepEqual(u.rows.map((r) => [r.symbol, r.price]).sort(), [['A', 3], ['B', 7]]);
  assert.equal(mergeUpload([{ symbol: 'B', price: 7 }], [{ symbol: 'A', price: 3 }], false).rows.length, 1);
});
