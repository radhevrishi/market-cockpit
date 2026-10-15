// zzz1049 — Upstash cost: memory read cache (TTL, invalidation, single flight, byte bound), MGET batching of cached keys,
// unchanged-write skipping, the per-hour command counter, and personal data always going straight to the durable store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KvReadCache, KvUsage, readThrough, isCacheableKey, keyFamily } from '../kv-read-cache';
import { unchangedWriteSkippable } from '../kv';

function cache(now: () => number, over: Partial<ConstructorParameters<typeof KvReadCache>[0]> = {}) {
  return new KvReadCache({ maxBytes: 10_000, maxEntryBytes: 5_000, hitTtlMs: 60_000, missTtlMs: 30_000, now, ...over });
}

test('a cached value is served until its TTL, then read again', async () => {
  let t = 0; const c = cache(() => t); const inflight = new Map();
  let loads = 0;
  const load = async () => { loads++; return { value: { n: loads }, failed: false }; };
  assert.deepEqual(await readThrough(c, inflight, 'graded:v19:2026-10-14', load), { n: 1 });
  t = 59_000;
  assert.deepEqual(await readThrough(c, inflight, 'graded:v19:2026-10-14', load), { n: 1 });
  assert.equal(loads, 1);
  t = 60_000;
  assert.deepEqual(await readThrough(c, inflight, 'graded:v19:2026-10-14', load), { n: 2 });
  assert.equal(loads, 2);
});

test('"missing" is remembered for the shorter miss TTL; a FAILED read is never remembered as missing', async () => {
  let t = 0; const c = cache(() => t); const inflight = new Map();
  let loads = 0;
  const miss = async () => { loads++; return { value: null, failed: false }; };
  assert.equal(await readThrough(c, inflight, 'news:x', miss), null);
  t = 29_000; assert.equal(await readThrough(c, inflight, 'news:x', miss), null); assert.equal(loads, 1);
  t = 30_000; await readThrough(c, inflight, 'news:x', miss); assert.equal(loads, 2);
  let fl = 0;
  const fail = async () => { fl++; return { value: null, failed: true }; };
  await readThrough(c, inflight, 'news:y', fail); await readThrough(c, inflight, 'news:y', fail);
  assert.equal(fl, 2);
});

test('every reader gets its own copy (no shared mutable object)', async () => {
  const c = cache(() => 0); const inflight = new Map();
  const a: any = await readThrough(c, inflight, 'k:1', async () => ({ value: { list: [1] }, failed: false }));
  a.list.push(2);
  const b: any = await readThrough(c, inflight, 'k:1', async () => ({ value: { list: [9] }, failed: false }));
  assert.deepEqual(b, { list: [1] });
});

test('concurrent readers of one key share ONE store read', async () => {
  const c = cache(() => 0); const inflight = new Map();
  let loads = 0;
  const load = async () => { loads++; await new Promise((r) => setTimeout(r, 10)); return { value: 7, failed: false }; };
  const got = await Promise.all(Array.from({ length: 16 }, () => readThrough(c, inflight, 'universe:x', load)));
  assert.equal(loads, 1);
  assert.deepEqual(got, Array(16).fill(7));
});

test('a write replaces / invalidates the cached copy; the store TTL caps the cache TTL', () => {
  let t = 0; const c = cache(() => t);
  c.put('a:b', JSON.stringify({ v: 1 }));
  c.put('a:b', JSON.stringify({ v: 2 }));
  assert.deepEqual(c.get('a:b'), { found: true, text: '{"v":2}' });
  c.invalidate('a:b');
  assert.deepEqual(c.get('a:b'), { found: false });
  c.put('short', '1', 5);   // store TTL 5 s < cache TTL 60 s
  t = 5_000;
  assert.deepEqual(c.get('short'), { found: false });
});

test('byte bound: least recently used entries are evicted; oversized values are not kept', () => {
  const c = cache(() => 0, { maxBytes: 300, maxEntryBytes: 200 });
  c.put('a', 'x'.repeat(100)); c.put('b', 'x'.repeat(100));
  c.get('a');                      // a is now the most recently used
  c.put('c', 'x'.repeat(100));     // over 300 → evict b (least recently used)
  assert.equal(c.get('b').found, false);
  assert.equal(c.get('a').found, true);
  c.put('big', 'x'.repeat(500));
  assert.equal(c.get('big').found, false);
  assert.ok(c.size().bytes <= 300);
});

test('personal data, locks and rate counters are never cacheable; SET NX keys become uncacheable', () => {
  for (const k of ['user-state:v1:mc_watchlist_tickers', 'us-book:v1:owner', 'us-book-profile:v1', 'book:v1:123', 'portfolio:123',
    'watchlist:123', 'evidence:x', 'user-alerts:rules', 'rate:public:v1:k', 'app-scheduler:lock:x:2026', 'graded:autoheal-lock:x', 'personal']) {
    assert.equal(isCacheableKey(k), false, k);
  }
  for (const k of ['graded:v19:2026-10-14', 'fundamentals:v1:TCS', 'cron-heartbeat:row:x', 'news:articles:v39', 'clock:x', 'blocks:v1']) {
    assert.equal(isCacheableKey(k), true, k);
  }
  const c = cache(() => 0);
  c.put('guidance:index', '1');
  c.markUncacheable('guidance:index');
  assert.equal(c.get('guidance:index').found, false);
  c.put('guidance:index', '2');
  assert.equal(c.get('guidance:index').found, false);
});

test('an unchanged write is skipped only inside a short window (10 % of TTL, max 10 min)', () => {
  const prev = { hash: 'h', at: 0, ttl: 3600 };
  assert.equal(unchangedWriteSkippable(prev, 'h', 3600, 300_000), true);       // 5 min < 6 min (10 % of 1 h)
  assert.equal(unchangedWriteSkippable(prev, 'h', 3600, 360_000), false);      // window over
  assert.equal(unchangedWriteSkippable(prev, 'other', 3600, 1_000), false);    // value changed
  assert.equal(unchangedWriteSkippable(prev, 'h', undefined, 1_000), false);   // TTL rule changed
  assert.equal(unchangedWriteSkippable({ hash: 'h', at: 0, ttl: null }, 'h', undefined, 599_000), true);
  assert.equal(unchangedWriteSkippable({ hash: 'h', at: 0, ttl: null }, 'h', undefined, 600_000), false);
  assert.equal(unchangedWriteSkippable(undefined, 'h', 60, 0), false);
});

test('usage counter: per hour and per key family, memory only', () => {
  let t = Date.parse('2026-10-15T10:05:00Z');
  const u = new KvUsage(() => t);
  u.record('get', 'graded:v19:2026-10-14');
  u.record('get(rest)', 'graded:v19:2026-10-13', 1, 2000);
  u.record('mget', 'fundamentals:v1:TCS');
  t += 3600_000;
  u.record('set', 'cron-heartbeat:row:news-feed');
  const s = u.snapshot();
  assert.equal(s.commands, 4);
  assert.equal(s.hours.length, 2);
  assert.equal(s.lastFullHour?.commands, 3);
  assert.ok(s.topSources48h.some((x) => x.source === 'graded get' && x.commands === 1));
  assert.ok(s.topSources48h.some((x) => x.source === 'cron-heartbeat:row set'));
  assert.equal(keyFamily('fundamentals:v1:TCS'), 'fundamentals');
  assert.equal(keyFamily('user-state:v1:x'), 'user-state');
});

test('personal-data paths go straight to the durable store (source check)', () => {
  const src = readFileSync(fileURLToPath(new URL('../kv.ts', import.meta.url)), 'utf8');
  const body = (name: string) => { const i = src.indexOf(`export async function ${name}`); return src.slice(i, src.indexOf('\n}\n', i)); };
  for (const fn of ['kvGetDurable', 'kvSetDurable', 'kvSetVersioned']) {
    const b = body(fn);
    assert.ok(b.length > 50, fn);
    assert.ok(!/readThrough|READ_CACHE\.get|READ_CACHE\.put|unchangedWriteSkippable/.test(b), `${fn} must not use the read cache or skip writes`);
  }
  assert.match(body('kvSetVersioned'), /r\.eval\(VERSIONED_SET_LUA/);
  assert.match(body('kvSetDurable'), /result !== 'OK'/);
  // kvGet only uses the cache for keys the cache accepts
  assert.match(body('kvGet<T = any>'), /READ_CACHE\.canCache\(key\)/);
  // the user-state store keeps using the durable helpers
  const us = readFileSync(fileURLToPath(new URL('../user-state-store.ts', import.meta.url)), 'utf8');
  assert.match(us, /kvSetVersioned\(kvKey\(key\)/);
  assert.equal(isCacheableKey('user-state:v1:anything'), false);
});

/** kv.ts end to end with a fake Upstash (client + REST), no network: counts what reaches the store. */
function runKv(body: string) {
  const root = mkdtempSync(join(tmpdir(), 'mc-kv-cost-'));
  try {
    mkdirSync(join(root, 'node_modules/@upstash/redis'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'node_modules/@upstash/redis/package.json'), '{"type":"module","exports":"./index.js"}');
    writeFileSync(join(root, 'node_modules/@upstash/redis/index.js'), `
      export class Redis {
        async get(k) { globalThis.calls.push('get ' + k); return globalThis.store.has(k) ? JSON.parse(globalThis.store.get(k)) : null; }
        async set(k, v, o) { globalThis.calls.push('set ' + k); if (o && o.nx && globalThis.store.has(k)) return null; globalThis.store.set(k, JSON.stringify(v)); return 'OK'; }
        async del(k) { globalThis.calls.push('del ' + k); globalThis.store.delete(k); return 1; }
        async eval(_s, keys, args) { globalThis.calls.push('eval ' + keys[0]); globalThis.store.set(keys[0], args[0]); return [1, args[0]]; }
        async mget(...ks) { globalThis.calls.push('mget'); return ks.map((k) => globalThis.store.has(k) ? JSON.parse(globalThis.store.get(k)) : null); }
      }`);
    const source = readFileSync(fileURLToPath(new URL('../kv.ts', import.meta.url)), 'utf8');
    writeFileSync(join(root, 'kv.ts'), source.replace("from './kv-memory'", "from './kv-memory.ts'").replace("from './kv-versioned'", "from './kv-versioned.ts'").replace("from './kv-read-cache'", "from './kv-read-cache.ts'"));
    for (const f of ['kv-memory.ts', 'kv-versioned.ts', 'kv-read-cache.ts']) copyFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), join(root, f));
    writeFileSync(join(root, 'run.mjs'), `import assert from 'node:assert/strict';
globalThis.calls = []; globalThis.store = new Map();
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/get/')) { const k = decodeURIComponent(u.split('/get/')[1]); globalThis.calls.push('rest-get ' + k); return new Response(JSON.stringify({ result: globalThis.store.has(k) ? globalThis.store.get(k) : null })); }
  const cmd = JSON.parse(init.body);
  if (cmd[0] === 'MGET') { globalThis.calls.push('rest-mget ' + cmd.slice(1).join(',')); return new Response(JSON.stringify({ result: cmd.slice(1).map((k) => globalThis.store.has(k) ? globalThis.store.get(k) : null) })); }
  throw new Error('unexpected ' + u);
};
const kv = await import('./kv.ts');
const n = (p) => globalThis.calls.filter((c) => c.startsWith(p)).length;
${body}\n`);
    const env = { ...process.env };
    for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_READ_CACHE']) delete env[k];
    env.UPSTASH_REDIS_REST_URL = 'https://example.invalid'; env.UPSTASH_REDIS_REST_TOKEN = 'test-only';
    const r = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'run.mjs')], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, String(r.stdout) + String(r.stderr));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('kvGet: repeated reads of a shared key cost one store read; a write updates the cached copy', () => {
  runKv(`
    globalThis.store.set('graded:v19:2026-10-14', JSON.stringify({ by_tier: { STRONG: [1] } }));
    for (let i = 0; i < 5; i++) assert.deepEqual(await kv.kvGet('graded:v19:2026-10-14'), { by_tier: { STRONG: [1] } });
    assert.equal(n('get graded'), 1);
    await kv.kvSet('graded:v19:2026-10-14', { by_tier: { STRONG: [1, 2] } }, 3600);
    assert.deepEqual(await kv.kvGet('graded:v19:2026-10-14'), { by_tier: { STRONG: [1, 2] } });
    assert.equal(n('get graded'), 1);
    await kv.kvDel('graded:v19:2026-10-14');
    assert.equal(await kv.kvGet('graded:v19:2026-10-14'), null);
    // a miss costs client GET + REST GET once, then is remembered
    assert.equal(await kv.kvGet('graded:v19:2026-10-14'), null);
    assert.equal(n('get graded') + n('rest-get graded'), 3);
  `);
});

test('kvMGet: cached keys are answered from memory, only the rest go into the MGET', () => {
  runKv(`
    globalThis.store.set('fundamentals:v1:A', '{"a":1}');
    globalThis.store.set('fundamentals:v1:B', '{"b":2}');
    await kv.kvGet('fundamentals:v1:A');
    const got = await kv.kvMGet(['fundamentals:v1:A', 'fundamentals:v1:B', 'fundamentals:v1:C']);
    assert.deepEqual(got, [{ a: 1 }, { b: 2 }, null]);
    assert.ok(globalThis.calls.includes('rest-mget fundamentals:v1:B,fundamentals:v1:C'));
    await kv.kvMGet(['fundamentals:v1:A', 'fundamentals:v1:B', 'fundamentals:v1:C']);
    assert.equal(n('rest-mget'), 1);
    const s = kv.kvUsageSnapshot();
    assert.ok(s.servedFromMemory >= 4);
  `);
});

test('personal data is read from and written to the store every time; an unchanged shared write is skipped', () => {
  runKv(`
    globalThis.store.set('user-state:v1:mc_watchlist_tickers', JSON.stringify({ value: ['A'], version: 1 }));
    await kv.kvGet('user-state:v1:mc_watchlist_tickers');
    await kv.kvGet('user-state:v1:mc_watchlist_tickers');
    assert.equal(n('get user-state'), 2);
    await kv.kvSet('user-state:v1:mc_watchlist_tickers', { value: ['A'], version: 1 });
    await kv.kvSet('user-state:v1:mc_watchlist_tickers', { value: ['A'], version: 1 });
    assert.equal(n('set user-state'), 2);
    await kv.kvSetDurable('us-book:v1:owner', { rows: [] });
    await kv.kvSetDurable('us-book:v1:owner', { rows: [] });
    assert.equal(n('set us-book'), 2);
    await kv.kvSetVersioned('user-state:v1:x', { value: 1, hash: 'h' }, 0);
    assert.equal(n('eval user-state'), 1);
    // shared cache key: the same value twice within the window is sent once
    await kv.kvSet('news:articles:v39', { a: 1 }, 3600);
    await kv.kvSet('news:articles:v39', { a: 1 }, 3600);
    assert.equal(n('set news'), 1);
    await kv.kvSet('news:articles:v39', { a: 2 }, 3600);
    assert.equal(n('set news'), 2);
    // a lock key is never cached
    assert.equal(await kv.kvSetNX('job:x', 'run', 60), true);
    await kv.kvGet('job:x'); await kv.kvGet('job:x');
    assert.equal(n('get job:x'), 2);
  `);
});
