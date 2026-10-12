import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packLarge, unpackLarge } from '../kv';

test('zzz985 a large value is stored compressed and read back intact', () => {
  const big = { rows: Array.from({ length: 40_000 }, (_, i) => ({ t: `T${i}`, n: `Company ${i % 50}`, v: i * 1.5, note: 'same text again and again' })) };
  const s = JSON.stringify(big);
  const p = packLarge(s);
  assert.ok(p.d.length < s.length / 4, 'JSON should shrink well');
  assert.deepEqual(unpackLarge(p), big);
  // anything else passes through untouched
  assert.deepEqual(unpackLarge({ a: 1 }), { a: 1 });
  assert.equal(unpackLarge('x'), 'x');
  assert.equal(unpackLarge(null), null);
  assert.equal(unpackLarge({ __mc_gz: 1, d: 'not-gzip' }), null);
});
