// zzz1222 — an MGET that went over Upstash's 10 MB limit is remembered per key family, so the next one is split up front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mgetSafeKeys, noteMgetTooLarge } from '../kv';

test('the safe MGET size halves on each over-limit answer and never grows back by itself', () => {
  assert.equal(mgetSafeKeys('graded-test'), null);
  noteMgetTooLarge('graded-test', 40);
  assert.equal(mgetSafeKeys('graded-test'), 20);
  noteMgetTooLarge('graded-test', 30);
  assert.equal(mgetSafeKeys('graded-test'), 15);
  noteMgetTooLarge('graded-test', 60);
  assert.equal(mgetSafeKeys('graded-test'), 15);
  noteMgetTooLarge('one-test', 1);
  assert.equal(mgetSafeKeys('one-test'), 1);
});
