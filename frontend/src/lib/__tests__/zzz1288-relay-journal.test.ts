import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..', '..', '..');

test('zzz1288: the relay recognises exactly the collector journal scripts', async () => {
  const src = fs.readFileSync(path.join(repo, '.github', 'scripts', 'lib', 'guidance-delivery.mjs'), 'utf8');
  const enq = /ENQUEUE_LUA = "([^"]+)"/.exec(src)![1];
  const ack = /ACK_LUA = "([^"]+)"/.exec(src)![1];
  const { journalScript: fn } = await import('../kv-relay-journal');
  assert.equal(fn(enq), 'enqueue');
  assert.equal(fn(ack), 'ack');
  assert.equal(fn("redis.call('DEL',KEYS[1])"), null);
});

test('zzz1288: the relay serves the journal set commands', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'api', 'v1', 'kv-rest', '[[...cmd]]', 'route.ts'), 'utf8');
  for (const op of ['SMEMBERS', 'SCARD', 'SREM', 'SADD', 'EXPIRE', 'EVAL']) assert.ok(route.includes(`op === '${op}'`), op);
});
