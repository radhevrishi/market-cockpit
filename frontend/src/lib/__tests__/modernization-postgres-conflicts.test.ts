import { test } from 'node:test';
import assert from 'node:assert/strict';
import { putUserState, UserStateConflict, hashOf } from '../user-state-store';

// Query spy exercises the actual writer without a live database credential.
test('PostgreSQL rejects stale edits, serializes first inserts, and acknowledges identical values', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousPool = (globalThis as any).__MC_PG_POOL__;
  const redisNames = Object.keys(process.env).filter(k => /^(UPSTASH_REDIS_REST|KV_REST_API)_(URL|TOKEN)$/.test(k));
  const previousRedis = Object.fromEntries(redisNames.map(k => [k, process.env[k]]));
  for (const k of redisNames) delete process.env[k];
  const sql: string[] = []; let current: any = { hash: hashOf({ notes: 'saved' }), version: 4 };
  const client = { query: async (query: string, params?: any[]) => {
    sql.push(query);
    if (query === 'SELECT id FROM schema_migrations') return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    if (query.startsWith('SELECT hash, version')) return { rows: current ? [current] : [] };
    if (query.startsWith('INSERT INTO user_state (')) current = { hash: params![2], version: params![3] };
    return { rows: [] };
  }, release() {} };
  (globalThis as any).__MC_PG_POOL__ = { connect: async () => client };
  process.env.DATABASE_URL = 'postgres://disposable.invalid/test';
  try {
    await assert.rejects(putUserState('mc:decisions:v1', { notes: 'stale' }, { baseVersion: 3 }), UserStateConflict);
    assert.equal(current.version, 4); assert.ok(!sql.some(q => q.startsWith('INSERT INTO user_state ('))); assert.equal(sql[sql.length - 1], 'ROLLBACK');
    sql.length = 0;
    const same = await putUserState('mc:decisions:v1', { notes: 'saved' }, { baseVersion: 1 });
    assert.equal(same.unchanged, true); assert.equal(same.version, 4);
    assert.ok(!sql.some(q => q.startsWith('INSERT INTO user_state (')));
    current = null; sql.length = 0;
    const first = await putUserState('mc:decisions:v1', { notes: 'first' }, { baseVersion: 0 });
    assert.equal(first.version, 1);
    assert.ok(sql.findIndex(q => q.startsWith('SELECT pg_advisory_xact_lock')) < sql.findIndex(q => q.startsWith('SELECT hash, version')));
    assert.equal(sql[sql.length - 1], 'COMMIT');
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    (globalThis as any).__MC_PG_POOL__ = previousPool;
    Object.assign(process.env, previousRedis);
  }
});
