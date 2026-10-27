// zzz1196 — the in-process copy of Redis writes has a byte limit (market data evicted oldest first); personal state / locks are
// never evicted; no limit when Redis is not configured (then it is the only store). Memory sampler summary is pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKvStore } from '../kv-memory';
import { summarise, type MemSample } from '../mem-sampler';

test('no limit by default: nothing is evicted', () => {
  const s = new MemoryKvStore(() => 0);
  for (let i = 0; i < 200; i++) s.set(`k${i}`, 'x'.repeat(1000));
  assert.equal(s.size().entries, 200);
  assert.equal(s.size().evictions, 0);
});

test('over the limit the oldest market-data entry goes first; pinned keys stay', () => {
  const s = new MemoryKvStore(() => 0, { maxBytes: 3000, pinned: (k) => k.startsWith('lock:') || k.startsWith('user-state:') });
  s.set('lock:a', 'owner');
  s.set('user-state:me', 'y'.repeat(5000));   // bigger than the budget, still kept
  s.set('feed:1', 'a'.repeat(500));            // 1000 bytes
  s.set('feed:2', 'b'.repeat(500));
  s.set('feed:3', 'c'.repeat(500));
  s.set('feed:4', 'd'.repeat(500));            // pushes feed:1 out
  assert.equal(s.get('feed:1'), undefined);
  assert.ok(s.get('feed:4'));
  assert.equal(s.get('lock:a'), 'owner');
  assert.equal(s.get('user-state:me')!.length, 5000);
  assert.ok(s.size().bytes <= 3000);
  assert.equal(s.size().evictions, 1);
});

test('re-writing a key makes it the newest; a value larger than the whole budget is not kept', () => {
  const s = new MemoryKvStore(() => 0, { maxBytes: 3000 });
  s.set('a', 'a'.repeat(500)); s.set('b', 'b'.repeat(500)); s.set('a', 'A'.repeat(500));
  s.set('c', 'c'.repeat(500)); s.set('d', 'd'.repeat(500));
  assert.equal(s.get('b'), undefined);
  assert.ok(s.get('a'));
  s.set('huge', 'h'.repeat(5000));
  assert.equal(s.get('huge'), undefined);
  s.delete('a');
  assert.equal(s.size().bytes, 2000);
});

test('memory summary covers only the window asked for', () => {
  const mk = (at: string, rss: number): MemSample => ({ at, rss, heapUsed: rss / 2, heapTotal: rss, external: 0, arrayBuffers: 0, kvFallbackMb: 0, kvFallbackEntries: 0, readCacheMb: 0, jobs: [] });
  const r = summarise([mk('2026-10-25T00:00:00Z', 900), mk('2026-10-27T00:00:00Z', 400), mk('2026-10-27T01:00:00Z', 600)], Date.parse('2026-10-26T12:00:00Z'));
  assert.deepEqual([r.n, r.avgRss, r.maxRss], [2, 500, 600]);
  assert.equal(summarise([], 0).avgRss, null);
});

// zzz1197 — screener snapshots are replaced only when the rows changed
import { shouldPublish, rowsHashOf } from '../screener/snapshot-publish';
test('same rows → no new snapshot; changed rows, unknown stored hash or the rollback switch → publish', () => {
  const a = rowsHashOf('[{"t":"A","px":1}]'), b = rowsHashOf('[{"t":"A","px":2}]');
  assert.equal(shouldPublish(a, a, false), false);
  assert.equal(shouldPublish(a, b, false), true);
  assert.equal(shouldPublish(null, a, false), true);
  assert.equal(shouldPublish(a, a, true), true);
});

// zzz1197 — AI budget: each call reserves its worst case before it is sent
import { estimateCallUsd, reservationFits, settleReservation, costOf } from '../anthropic-meter';
test('reservation: worst-case estimate, fits under the cap with others in flight, settled only once', async () => {
  const est = estimateCallUsd('gpt-5-mini', { max_tokens: 4000, messages: [{ role: 'user', content: 'x'.repeat(3000) }] });
  assert.ok(est >= costOf('gpt-5-mini', { input_tokens: 1000, output_tokens: 4000 }));
  assert.ok(estimateCallUsd('gpt-5-mini', { max_tokens: 10, messages: [{ role: 'user', content: 'x'.repeat(50_000_000) }] }) <= costOf('gpt-5-mini', { input_tokens: 400_000, output_tokens: 10 }) + 1e-9);
  assert.equal(reservationFits(59.9, 0.05, 60), true);
  assert.equal(reservationFits(59.9, 0.2, 60), false);   // two calls in flight together no longer both pass
  assert.equal(reservationFits(10, -0.01, 60), true);
  const r = { usd: 0, month: '2026-10', settled: false };
  await settleReservation(r); await settleReservation(undefined);
  assert.equal(r.settled, false);   // nothing reserved → nothing to give back
});
