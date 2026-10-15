import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decideInitialWatchlist, interpretWriteResponse, nextFlag, normalizeFlag, clickFlag, settleFlag, flagView,
  FlagSync, WatchlistMutationQueue, applyOps, type WriteResult,
} from '../watchlist-sync';

// Made-up tickers only.
const A = 'ZZALPHA', B = 'ZZBRAVO', C = 'ZZCHARLIE', X = 'ZZXRAY', Y = 'ZZYANKEE';

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── F08 ──
test('F08: a successful EMPTY list on reload stays empty (deliberate clear is kept)', () => {
  const d = decideInitialWatchlist({ kind: 'response', ok: true, status: 200, body: { watchlist: [], flags: {}, source: 'redis' } });
  assert.deepEqual(d, { use: 'remote', tickers: [], flags: {} });
});

test('F08: network error → this browser\'s copy', () => {
  assert.deepEqual(decideInitialWatchlist({ kind: 'error', error: new TypeError('Failed to fetch') }), { use: 'local', reason: 'network' });
});

test('F08: HTTP 500 with valid-looking JSON is a failure, not an empty list', () => {
  const d = decideInitialWatchlist({ kind: 'response', ok: false, status: 500, body: { watchlist: [], flags: {} } });
  assert.deepEqual(d, { use: 'local', reason: 'http' });
});

test('F08: unreadable JSON / wrong shape → local; server with no record (source default) → local', () => {
  assert.equal(decideInitialWatchlist({ kind: 'response', ok: true, status: 200, body: undefined, parseFailed: true }).use, 'local');
  assert.deepEqual(decideInitialWatchlist({ kind: 'response', ok: true, status: 200, body: { watchlist: 'ZZALPHA' } }), { use: 'local', reason: 'schema' });
  assert.deepEqual(decideInitialWatchlist({ kind: 'response', ok: true, status: 200, body: { watchlist: [A, 3] } }), { use: 'local', reason: 'schema' });
  assert.deepEqual(decideInitialWatchlist({ kind: 'response', ok: true, status: 200, body: { watchlist: [A], flags: [] } }), { use: 'local', reason: 'schema' });
  assert.deepEqual(decideInitialWatchlist({ kind: 'response', ok: true, status: 200, body: { watchlist: [], source: 'default' } }), { use: 'local', reason: 'no-record' });
});

test('F08: non-empty list wins and flags are normalised (GREEN → 🟢, junk dropped)', () => {
  const d = decideInitialWatchlist({ kind: 'response', ok: true, status: 200, body: { watchlist: [A, B], flags: { [A]: 'GREEN', [B]: '🔴', [C]: 42 }, source: 'redis' } });
  assert.deepEqual(d, { use: 'remote', tickers: [A, B], flags: { [A]: '🟢', [B]: '🔴' } });
});

test('writes count only when HTTP ok AND body ok:true', () => {
  assert.equal(interpretWriteResponse(false, 500, { ok: true }).ok, false);
  assert.equal(interpretWriteResponse(true, 200, { error: 'x' }).ok, false);
  assert.equal(interpretWriteResponse(true, 200, null).ok, false);
  assert.deepEqual(interpretWriteResponse(true, 200, { ok: true, watchlist: [A] }), { ok: true, list: [A] });
});

// ── F09 ──
test('F09: next flag is derived from the visible flag', () => {
  assert.equal(nextFlag(''), '🟢'); assert.equal(nextFlag('🟢'), '🟠'); assert.equal(nextFlag('🟠'), '🔴'); assert.equal(nextFlag('🔴'), '');
  assert.equal(nextFlag('GREEN'), '🟠'); assert.equal(normalizeFlag('weird'), '');
});

test('F09: offline flag click is never shown as saved — rolls back to the last saved value and is marked', async () => {
  const fails: string[] = [];
  const fs = new FlagSync({ send: async () => { throw new TypeError('Failed to fetch'); }, onFailed: (t, f) => fails.push(`${t}:${f}`) });
  fs.loadServer({ [A]: '🟢' });
  fs.click(A);
  assert.deepEqual(fs.view(A), { flag: '🟠', status: 'saving', failedFlag: null });
  await fs.idle();
  assert.deepEqual(fs.view(A), { flag: '🟢', status: 'error', failedFlag: '🟠' });
  assert.deepEqual(fails, [`${A}:🟠`]);
});

test('F09: HTTP failure (send → false) also rolls back; retry re-sends the failed value', async () => {
  let ok = false; const sent: string[] = [];
  const fs = new FlagSync({ send: async (_t, f) => { sent.push(f); return ok; } });
  fs.click(A); await fs.idle();
  assert.equal(fs.view(A).status, 'error'); assert.equal(fs.view(A).flag, '');
  ok = true; fs.retry(A); await fs.idle();
  assert.deepEqual(fs.view(A), { flag: '🟢', status: 'saved', failedFlag: null });
  assert.deepEqual(sent, ['🟢', '🟢']);
});

test('F09: rapid two flag clicks — one save at a time, final saved value is the second click', async () => {
  const calls: Array<{ f: string; d: ReturnType<typeof deferred<boolean>> }> = [];
  const fs = new FlagSync({ send: (_t, f) => { const d = deferred<boolean>(); calls.push({ f, d }); return d.promise; } });
  fs.click(A); fs.click(A);
  assert.equal(calls.length, 1, 'second save waits for the first');
  assert.equal(calls[0].f, '🟢');
  assert.deepEqual(fs.view(A), { flag: '🟠', status: 'saving', failedFlag: null });
  calls[0].d.resolve(true); await tick();
  assert.equal(calls.length, 2); assert.equal(calls[1].f, '🟠');
  calls[1].d.resolve(true); await fs.idle();
  assert.deepEqual(fs.view(A), { flag: '🟠', status: 'saved', failedFlag: null });
  assert.equal(fs.snapshot()[A].confirmed, '🟠');
});

test('F09: rapid two clicks where the first save fails — the newer choice is still sent and kept', async () => {
  const calls: Array<{ f: string; d: ReturnType<typeof deferred<boolean>> }> = [];
  const fs = new FlagSync({ send: (_t, f) => { const d = deferred<boolean>(); calls.push({ f, d }); return d.promise; } });
  fs.click(A); fs.click(A);
  calls[0].d.resolve(false); await tick();
  assert.equal(calls[1].f, '🟠');
  calls[1].d.resolve(true); await fs.idle();
  assert.deepEqual(fs.view(A), { flag: '🟠', status: 'saved', failedFlag: null });
});

test('F09: reducer is pure — no reliance on React updater order', () => {
  const s1 = clickFlag({}, A);
  assert.equal(s1.send, '🟢');
  const s2 = settleFlag(s1.state, A, '🟢', false);
  assert.equal(s2.send, null);
  assert.deepEqual(flagView(s2.state, A), { flag: '', status: 'error', failedFlag: '🟢' });
});

// ── F10 ──
function controlledQueue(base: string[]) {
  const calls: Array<{ list: string[]; d: ReturnType<typeof deferred<WriteResult>> }> = [];
  const failed: string[][] = [];
  const q = new WatchlistMutationQueue({
    send: (list) => { const d = deferred<WriteResult>(); calls.push({ list, d }); return d.promise; },
    onFailed: (ops) => failed.push(ops.flatMap((o) => o.tickers)),
  });
  q.reset(base);
  return { q, calls, failed };
}

test('F10: add A then add B — B waits, cannot complete before A; both kept', async () => {
  const { q, calls } = controlledQueue([X]);
  q.enqueue('add', [A]); q.enqueue('add', [B]);
  assert.equal(calls.length, 1, 'only one write in flight, so completions cannot be reversed');
  assert.deepEqual(calls[0].list, [X, A]);
  assert.deepEqual(q.snapshot().tickers, [X, A, B]);
  calls[0].d.resolve({ ok: true }); await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].list, [X, A, B], 'second write sends the latest intended list');
  calls[1].d.resolve({ ok: true }); await q.idle();
  assert.deepEqual(q.snapshot().confirmed, [X, A, B]);
  assert.deepEqual(q.snapshot().pending, []);
});

test('F10: remove and add at the same time — both land', async () => {
  const { q, calls } = controlledQueue([X, Y]);
  q.enqueue('remove', [X]); q.enqueue('add', [A]);
  assert.deepEqual(q.snapshot().tickers, [Y, A]);
  calls[0].d.resolve({ ok: true }); await tick();
  assert.deepEqual(calls[1].list, [Y, A]);
  calls[1].d.resolve({ ok: true }); await q.idle();
  assert.deepEqual(q.snapshot().confirmed, [Y, A]);
});

test('F10: earlier write fails, later succeeds — later edit kept, failed one undone on its own', async () => {
  const { q, calls, failed } = controlledQueue([X]);
  q.enqueue('add', [A]); q.enqueue('add', [B]);
  calls[0].d.resolve({ ok: false, error: 'HTTP 500' }); await tick();
  assert.deepEqual(q.snapshot().tickers, [X, B], 'A undone, B still there');
  assert.deepEqual(q.snapshot().failed.map((f) => f.tickers), [[A]]);
  assert.deepEqual(calls[1].list, [X, B]);
  calls[1].d.resolve({ ok: true }); await q.idle();
  assert.deepEqual(q.snapshot().confirmed, [X, B]);
  assert.deepEqual(q.snapshot().tickers, [X, B]);
  assert.deepEqual(failed, [[A]]);
});

test('F10: a failed remove puts back only that company while a later add stays', async () => {
  const { q, calls } = controlledQueue([X, Y]);
  q.enqueue('remove', [X]); q.enqueue('add', [A]);
  calls[0].d.reject(new TypeError('Failed to fetch')); await tick();
  assert.deepEqual(q.snapshot().tickers, [X, Y, A]);
  calls[1].d.resolve({ ok: true }); await q.idle();
  assert.deepEqual(q.snapshot().confirmed, [X, Y, A]);
  assert.equal(q.snapshot().failed[0].kind, 'remove');
});

test('F10: later write fails, earlier succeeded — earlier stays, later undone', async () => {
  const { q, calls } = controlledQueue([X]);
  q.enqueue('add', [A]); q.enqueue('add', [B]);
  calls[0].d.resolve({ ok: true }); await tick();
  calls[1].d.resolve({ ok: false, error: 'HTTP 503' }); await q.idle();
  assert.deepEqual(q.snapshot().tickers, [X, A]);
  assert.deepEqual(q.snapshot().confirmed, [X, A]);
});

test('F10: retry a failed change re-applies it on the current list; dismiss clears it', async () => {
  let ok = false;
  const q = new WatchlistMutationQueue({ send: async (list) => (ok ? { ok: true, list } : { ok: false, error: 'HTTP 500' }) });
  q.reset([X]);
  q.enqueue('add', [A]); await q.idle();
  assert.deepEqual(q.snapshot().tickers, [X]);
  ok = true; q.enqueue('add', [B]); await q.idle();
  q.retry(q.snapshot().failed[0].id); await q.idle();
  assert.deepEqual(q.snapshot().confirmed, [X, B, A]);
  assert.deepEqual(q.snapshot().failed, []);
  ok = false; q.enqueue('remove', [B]); await q.idle();
  q.dismiss(q.snapshot().failed[0].id);
  assert.deepEqual(q.snapshot().failed, []); assert.deepEqual(q.snapshot().tickers, [X, B, A]);
});

test('F10: same array kept when the visible list did not change (no extra quote refetch)', async () => {
  const { q, calls } = controlledQueue([X]);
  q.enqueue('add', [A]);
  const before = q.snapshot().tickers;
  calls[0].d.resolve({ ok: true }); await q.idle();
  assert.equal(q.snapshot().tickers, before);
});

test('applyOps: add skips duplicates, remove of a missing name is a no-op', () => {
  assert.deepEqual(applyOps([X], [{ id: '1', kind: 'add', tickers: [X, A, A] }, { id: '2', kind: 'remove', tickers: [C] }]), [X, A]);
});

test('page wiring: /watchlists uses the sync module, no fire-and-forget saves', () => {
  const page = readFileSync(new URL('../../app/(dashboard)/watchlists/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /decideInitialWatchlist\(/);
  assert.match(page, /new WatchlistMutationQueue\(/);
  assert.match(page, /new FlagSync\(/);
  assert.doesNotMatch(page, /\.length > 0\) \{\s*\/\/ Remote wins/);
  assert.doesNotMatch(page, /let nextFlag/);
  assert.doesNotMatch(page, /catch\(console\.error\)/);
});
