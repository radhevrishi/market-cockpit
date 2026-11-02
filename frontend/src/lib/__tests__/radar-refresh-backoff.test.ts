import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swrGet, __resetSwrForTests, __swrSettled } from '../swr-cache';

test('failed stale rebuild preserves last-good and backs off subsequent requests', async () => {
  __resetSwrForTests();
  let t = 100_000, attempts = 0, fails = false;
  const opts = {
    key: 'radar-backoff-unique', freshMs: 1_000, maxStaleMs: 100_000,
    now: () => t, kv: false, failureRetryMs: 5_000,
    build: async () => {
      attempts++;
      if (fails) throw new Error('exchange feed down');
      return { records: ['good'] };
    },
  };
  const first = await swrGet(opts);
  assert.equal(first.state, 'miss');
  fails = true; t += 2_000;
  const stale = await swrGet(opts);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.refreshing, true);
  await __swrSettled();
  assert.equal(attempts, 2);
  for (let i = 0; i < 6; i++) {
    t += 200;
    const r = await swrGet(opts);
    assert.deepEqual(r.value, { records: ['good'] });
    assert.equal(r.refreshing, false, 'cooldown must not claim a refresh is running');
  }
  assert.equal(attempts, 2, 'a failed upstream must not trigger work on each request');
  t += 6_000;
  const after = await swrGet(opts);
  assert.equal(after.refreshing, true, 'retry after cooldown');
  await __swrSettled();
  assert.equal(attempts, 3);
});

test('explicit force refresh bypasses failed-background cooldown', async () => {
  __resetSwrForTests();
  let t = 100_000, attempts = 0, fails = false;
  const opts = {
    key: 'radar-backoff-force', freshMs: 1_000, maxStaleMs: 100_000,
    now: () => t, kv: false, failureRetryMs: 30_000,
    build: async () => {
      attempts++;
      if (fails) throw new Error('temporary outage');
      return { v: attempts };
    },
  };
  await swrGet(opts);
  fails = true; t += 2_000;
  await swrGet(opts);
  await __swrSettled();
  assert.equal(attempts, 2);
  fails = false;
  const r = await swrGet({ ...opts, force: true });
  assert.equal(r.value.v, 3);
  assert.equal(attempts, 3);
});
