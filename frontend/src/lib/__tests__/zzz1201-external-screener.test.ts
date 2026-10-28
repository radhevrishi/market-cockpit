import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { withBuildLease, publicationQuery, type LeaseClient } from '../screener/build-lease';
import { externalBuildFresh, shouldDeferToExternal } from '../screener/external-runner';

function fakePool() {
  const owners = new Map<string, Client>(); const clients: Client[] = [];
  class Client extends EventEmitter implements LeaseClient {
    writes = 0; destroyed = false; lock: string | null = null;
    async query(sql: string, params: any[] = []) {
      const key = params.join(':');
      if (sql.includes('pg_try_advisory_lock')) {
        if (owners.has(key)) return { rows: [{ acquired: false }] };
        owners.set(key, this); this.lock = key; return { rows: [{ acquired: true }] };
      }
      if (sql.includes('pg_advisory_unlock')) { if (owners.get(key) === this) owners.delete(key); return { rows: [] }; }
      this.writes++; return { rows: [] };
    }
    release(destroy = false) { this.destroyed = destroy; if (this.lock && owners.get(this.lock) === this) owners.delete(this.lock); }
  }
  return { clients, connect: async () => { const c = new Client(); clients.push(c); return c; } };
}

test('two processes cannot build one market together; publication uses the lease connection', async () => {
  const pool = fakePool(); let finish!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => { entered = r; });
  const wait = new Promise<void>((r) => { finish = r; });
  const first = withBuildLease('US', async () => { entered(); await wait; await publicationQuery('UPDATE screener_snapshot SET meta = $1', ['ok']); return 'built'; }, () => 'busy', pool);
  await started;
  assert.equal(await withBuildLease('US', async () => { assert.fail('duplicate builder ran'); }, () => 'busy', pool), 'busy');
  assert.equal(await withBuildLease('IN', async () => 'india built', () => 'busy', pool), 'india built');
  finish(); assert.equal(await first, 'built');
  assert.equal(pool.clients[0].writes, 1);
  assert.equal(await withBuildLease('US', async () => 'next build', () => 'busy', pool), 'next build');
});

test('a lost database lease cannot publish and its connection is discarded', async () => {
  const pool = fakePool();
  await assert.rejects(withBuildLease('IN', async () => {
    pool.clients[0].emit('error', new Error('connection lost'));
    await publicationQuery('UPDATE screener_snapshot SET meta = $1', ['must not publish']);
    return 'bad';
  }, () => 'busy', pool), /lease was lost/);
  assert.equal(pool.clients[0].writes, 0);
  assert.equal(pool.clients[0].destroyed, true);
});

test('only recently completed external snapshots defer Railway; missing/stale/future data always falls back', async () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const meta = (hours: number, runner = 'github') => ({ runner, checkedAt: new Date(now - hours * 3600_000).toISOString() });
  assert.equal(externalBuildFresh(meta(0.5), 'IN', now), true);
  assert.equal(externalBuildFresh(meta(1), 'IN', now), false);
  assert.equal(externalBuildFresh(meta(7), 'US', now), true);
  assert.equal(externalBuildFresh(meta(8), 'US', now), false);
  assert.equal(externalBuildFresh(meta(-1), 'US', now), false);
  assert.equal(externalBuildFresh(meta(0.5, 'railway'), 'US', now), false);
  assert.equal(externalBuildFresh({}, 'US', now), false);
  const old = process.env.SCREENER_RUNNER; delete process.env.SCREENER_RUNNER;
  try { assert.equal(await shouldDeferToExternal('US'), false); } finally { if (old !== undefined) process.env.SCREENER_RUNNER = old; }
});

test('external schema validation never runs DDL or obtains the migration connection', async () => {
  const file = join(__dirname, '..', 'db-migrate.ts'); const out = { exports: {} as any }; const statements: string[] = [];
  const pool = {
    connect: async () => { assert.fail('read-only external validation must not obtain a migration connection'); },
    query: async (sql: string) => { statements.push(sql); return { rows: out.exports.MIGRATIONS.map((m: any) => ({ id: m.id })) }; },
  };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'process', js)(() => ({ getPool: () => pool }), out, out.exports, { env: { SCREENER_SCHEMA_CHECK_ONLY: '1' } });
  assert.equal(await out.exports.ensureSchema(), true);
  assert.deepEqual(statements, ['SELECT id FROM schema_migrations']);
});
