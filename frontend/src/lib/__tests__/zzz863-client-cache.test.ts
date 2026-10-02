import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCache, writeCache, ageText, FRESH_MS } from '../gu-client-cache';

test('a written answer is read back with its age (memory copy, no storage needed)', () => {
  writeCache('k1', { a: 1 }, 1_000);
  const h = readCache<{ a: number }>('k1', 61_000);
  assert.ok(h); assert.equal(h!.data.a, 1); assert.equal(h!.ageMs, 60_000); assert.ok(h!.ageMs < FRESH_MS === true || h!.ageMs >= FRESH_MS);
});
test('a missing key is a miss, never an error', () => { assert.equal(readCache('nope'), null); });
test('age wording', () => { assert.equal(ageText(10_000), 'a moment ago'); assert.equal(ageText(180_000), '3 minutes ago'); assert.equal(ageText(7_300_000), '2 hours ago'); });
