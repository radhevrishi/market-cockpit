// zzz1230 — key-value store on the app's own Postgres (Upstash bills every command).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runScript, scriptKind, encodeValue, decodeValue } from '../kv-pg';
import { groupBySize } from '../kv-maintenance';
import { VERSIONED_SET_LUA } from '../kv-versioned';
import { RESERVE_BUDGET_LUA, SETTLE_BUDGET_LUA } from '../ai-budget';

function memTx(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, tx: { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } } };
}

test('01 the three scripts the app sends are recognised; anything else is refused', () => {
  assert.equal(scriptKind(VERSIONED_SET_LUA), 'versioned');
  assert.equal(scriptKind(RESERVE_BUDGET_LUA), 'reserve');
  assert.equal(scriptKind(SETTLE_BUDGET_LUA), 'settle');
  assert.equal(scriptKind("return redis.call('GET', KEYS[1])"), null);
});

test('02 value rules match the Upstash client: strings as written, JSON for the rest', () => {
  assert.equal(encodeValue('abc'), 'abc');
  assert.equal(encodeValue({ a: 1 }), '{"a":1}');
  assert.deepEqual(decodeValue('{"a":1}'), { a: 1 });
  assert.equal(decodeValue('plain text'), 'plain text');
  assert.equal(decodeValue('12'), 12);
  assert.equal(decodeValue(null), null);
});

test('03 versioned compare-and-set: first insert, stale base refused, same hash unchanged', async () => {
  const { m, tx } = memTx();
  const v1 = JSON.stringify({ version: 1, hash: 'h1', data: 1 });
  assert.deepEqual(await runScript('versioned', tx, ['s'], [v1, 0]), [1, v1]);
  const v2 = JSON.stringify({ version: 2, hash: 'h2', data: 2 });
  assert.deepEqual(await runScript('versioned', tx, ['s'], [JSON.stringify({ version: 1, hash: 'h9' }), 0]), [0, v1]);   // stale base
  assert.deepEqual(await runScript('versioned', tx, ['s'], [v2, 1]), [1, v2]);
  assert.equal(m.get('s'), v2);
  assert.deepEqual(await runScript('versioned', tx, ['s'], [JSON.stringify({ version: 3, hash: 'h2' }), 2]), [2, v2]);
});

test('04 AI budget reserve + settle: cap holds, a settled call is not charged twice', async () => {
  const { m, tx } = memTx();
  const keys = ['spent', 'reserved', 'call1'];
  assert.deepEqual(await runScript('reserve', tx, keys, [0, 0.3, 1, 3600]), ['ok', '0', '0.3']);
  assert.deepEqual(await runScript('reserve', tx, ['spent', 'reserved', 'call2'], [0, 0.8, 1, 3600]), ['cap', '0', '0.3']);
  assert.equal(await runScript('settle', tx, keys, [0.25, 3600]), 1);
  assert.equal(m.get('spent'), '0.25'); assert.equal(m.get('reserved'), '0'); assert.equal(m.get('call1'), 'done');
  assert.equal(await runScript('settle', tx, keys, [0.25, 3600]), 1);
  assert.equal(m.get('spent'), '0.25');
});

test('05 copy groups stay under the size cap; a big value goes alone', () => {
  const g = groupBySize([{ key: 'a', bytes: 10 }, { key: 'b', bytes: 10 }, { key: 'big', bytes: 100 }, { key: 'c', bytes: 5 }], 30);
  assert.deepEqual(g, [['a', 'b'], ['big'], ['c']]);
});

test('06 wiring: Postgres is the default store, Upstash only read until copied; relay + collectors + worker', () => {
  const kv = readFileSync(new URL('../kv.ts', import.meta.url), 'utf8');
  assert.match(kv, /return pgUrl\(\) \? 'pg' : 'upstash';/);
  assert.match(kv, /async function migrateKeys/);
  assert.match(kv, /if \(onPg\(\)\) await migrateKeys\(\[key\]\);   \/\/ a lock/);
  const relay = readFileSync(new URL('../../app/api/v1/kv-rest/[[...cmd]]/route.ts', import.meta.url), 'utf8');
  assert.match(relay, /process\.env\.UPSTASH_REDIS_REST_TOKEN/);
  assert.match(relay, /PONG/);
  const sched = readFileSync(new URL('../app-scheduler.ts', import.meta.url), 'utf8');
  assert.match(sched, /name: 'kv-maintenance'/);
});
