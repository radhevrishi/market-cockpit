import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForFacts } from '../gu-facts-deadline';

test('a hung company does not delay completed companies past the response deadline', async () => {
  const facts: Record<string, number> = { A: 10 };
  const work = new Promise<void>(() => {});
  assert.equal(await waitForFacts(work, 5), false);
  assert.deepEqual(facts, { A: 10 });
});
test('a late company still populates its cache after the partial response', async () => {
  const cache = new Map<string, number>(); let finish!: () => void;
  const work = new Promise<void>((r) => { finish = () => { cache.set('B', 20); r(); }; });
  assert.equal(await waitForFacts(work, 5), false);
  finish(); await work;
  assert.equal(cache.get('B'), 20);
});
test('a completed batch returns immediately, and a failed batch can return explicit pending keys', async () => {
  assert.equal(await waitForFacts(Promise.resolve(), 5000), true);
  assert.equal(await waitForFacts(Promise.reject(new Error('source down')), 5000), false);
});
