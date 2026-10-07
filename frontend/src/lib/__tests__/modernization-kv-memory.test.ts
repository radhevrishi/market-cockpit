import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKvStore } from '../kv-memory.ts';

test('fallback data expires at the requested boundary', () => {
  let time = 1000;
  const store = new MemoryKvStore(() => time);
  store.set('quotes', '{"price":42}', 2);
  time = 2999;
  assert.equal(store.get('quotes'), '{"price":42}');
  time = 3000;
  assert.equal(store.get('quotes'), undefined);
  assert.equal(store.has('quotes'), false);
});

test('expired fallback lock can be acquired again', () => {
  let time = 0;
  const store = new MemoryKvStore(() => time);
  const acquire = () => {
    if (store.has('lock')) return false;
    store.set('lock', 'owner', 30);
    return true;
  };
  assert.equal(acquire(), true);
  assert.equal(acquire(), false);
  time = 30000;
  assert.equal(acquire(), true);
});

test('rewriting a value replaces its expiry', () => {
  let time = 0;
  const store = new MemoryKvStore(() => time);
  store.set('result', 'old', 1);
  time = 500;
  store.set('result', 'new', 2);
  time = 1000;
  assert.equal(store.get('result'), 'new');
  time = 2500;
  assert.equal(store.get('result'), undefined);
});

test('persistent values stay readable while expired cache values disappear', () => {
  let time = 0;
  const store = new MemoryKvStore(() => time);
  store.set('book', 'saved');
  store.set('cache', 'temporary', 1);
  time = 86400000;
  assert.equal(store.get('book'), 'saved');
  assert.equal(store.get('cache'), undefined);
});

test('explicit zero TTL retains existing persistent-write semantics', () => {
  let time = 0;
  const store = new MemoryKvStore(() => time);
  store.set('book', '', 0);
  time = 86400000;
  assert.equal(store.has('book'), true);
  assert.equal(store.get('book'), '');
  assert.equal(store.delete('book'), true);
  assert.equal(store.get('book'), undefined);
});

test('sweeping expired entries never removes an active or persistent value', () => {
  let time = 0;
  const store = new MemoryKvStore(() => time);
  store.set('expired', 'old', 1);
  store.set('persistent', 'record');
  store.set('active', 'live', 60);
  time = 2000;
  for (let i = 0; i < 64; i++) store.set(`write:${i}`, 'value', 1);
  assert.equal(store.get('expired'), undefined);
  assert.equal(store.get('persistent'), 'record');
  assert.equal(store.get('active'), 'live');
});
