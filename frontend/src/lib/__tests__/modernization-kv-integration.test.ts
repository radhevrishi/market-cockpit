import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Isolated KV integration: real helpers, fake Redis transport, no network. */
function runKv(body: string, configured = false) {
  const root = mkdtempSync(join(tmpdir(), 'mc-kv-integration-'));
  try {
    mkdirSync(join(root, 'node_modules/@upstash/redis'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'node_modules/@upstash/redis/package.json'), '{"type":"module","exports":"./index.js"}');
    writeFileSync(join(root, 'node_modules/@upstash/redis/index.js'), 'export class Redis { async set() { globalThis.remoteWrites++; if (globalThis.rejectWrite) throw new Error("transport failed"); return globalThis.noAck ? null : "OK"; } }');
    const source = readFileSync(fileURLToPath(new URL('../kv.ts', import.meta.url)), 'utf8');
    writeFileSync(join(root, 'kv.ts'), source.replace("from './kv-memory'", "from './kv-memory.ts'").replace("from './kv-versioned'", "from './kv-versioned.ts'"));
    copyFileSync(fileURLToPath(new URL('../kv-memory.ts', import.meta.url)), join(root, 'kv-memory.ts'));
    copyFileSync(fileURLToPath(new URL('../kv-versioned.ts', import.meta.url)), join(root, 'kv-versioned.ts'));
    writeFileSync(join(root, 'run.mjs'), `import assert from 'node:assert/strict';\nlet time = 0; Date.now = () => time; globalThis.remoteWrites = 0;\nglobalThis.fetch = () => { throw new Error('Network forbidden in KV regression'); };\nconst kv = await import('./kv.ts');\n${body}\n`);
    const env = { ...process.env };
    for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete env[k];
    if (configured) { env.UPSTASH_REDIS_REST_URL = 'https://example.invalid'; env.UPSTASH_REDIS_REST_TOKEN = 'test-only'; }
    const r = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'run.mjs')], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, String(r.stdout) + String(r.stderr));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('kvGet and kvSetNX respect memory expiry through the public API', () => {
  runKv(`
    await kv.kvSet('cache', { price: 42 }, 1);
    assert.deepEqual(await kv.kvGet('cache'), { price: 42 });
    assert.equal(await kv.kvSetNX('lock', 'one', 2), true);
    assert.equal(await kv.kvSetNX('lock', 'two', 2), false);
    time = 1000;
    assert.equal(await kv.kvGet('cache'), null);
    time = 2000;
    assert.equal(await kv.kvSetNX('lock', 'two', 2), true);
  `);
});

test('kvSwap cannot publish expired memory data and applies destination TTL', () => {
  runKv(`
    await kv.kvSet('old-temp', 'expired', 1);
    time = 1000;
    assert.equal(await kv.kvSwap('old-temp', 'prod', 10), false);
    await kv.kvSet('temp', { value: 7 }, 5);
    assert.equal(await kv.kvSwap('temp', 'prod', 1), true);
    assert.deepEqual(await kv.kvGet('prod'), { value: 7 });
    assert.equal(await kv.kvGet('temp'), null);
    time = 2000;
    assert.equal(await kv.kvGet('prod'), null);
  `);
});

test('remote size guard uses UTF-8 bytes instead of character count', () => {
  runKv(`
    await kv.kvSet('small', 'okay', 60);
    assert.equal(globalThis.remoteWrites, 1);
    const large = '₹'.repeat(3000000);
    assert.ok(large.length < 8 * 1024 * 1024);
    assert.ok(Buffer.byteLength(large, 'utf8') > 8 * 1024 * 1024);
    // zzz985: over the 8 MB cap (counted in UTF-8 bytes) the value is gzip-packed and still stored
    await kv.kvSet('oversize', large, 60);
    assert.equal(globalThis.remoteWrites, 2);
  `, true);
});

test('durable saves fail without Redis and do not populate memory', () => {
  runKv(`
    await assert.rejects(kv.kvSetDurable('personal', { drawing: 1 }), /unavailable/);
    assert.equal(await kv.kvGet('personal'), null);
  `);
});

test('durable saves require acknowledgement and preserve the last confirmed value on failure', () => {
  runKv(`
    await kv.kvSetDurable('personal', { drawing: 1 });
    globalThis.rejectWrite = true;
    await assert.rejects(kv.kvSetDurable('personal', { drawing: 2 }), /transport failed/);
    globalThis.rejectWrite = false; globalThis.noAck = true;
    await assert.rejects(kv.kvSetDurable('personal', { drawing: 3 }), /acknowledge/);
    assert.deepEqual(await kv.kvGet('personal'), { drawing: 1 });
  `, true);
});
