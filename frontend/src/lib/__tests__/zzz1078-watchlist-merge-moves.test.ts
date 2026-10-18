// zzz1078 — retest B02 / B03: moves, reorders and limits in the three-way chart-watchlist merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeWatchlistStores, mergeWatchlistStoresDetailed, describeLost } from '../chart-watchlist-merge';
import { MAX_ITEMS, type WlStore, type WlItem } from '../chart-watchlist';

type Sec = { id: string; items: Array<string | WlItem>; collapsed?: boolean; book?: 'IN' | 'US'; name?: string };
const store = (secs: Sec[]): WlStore => ({
  activeId: 'L', lists: [{ id: 'L', name: 'Main', sections: secs.map((s) => ({ id: s.id, name: s.name ?? s.id, collapsed: !!s.collapsed, ...(s.book ? { book: s.book } : {}),
    items: s.items.map((x) => (typeof x === 'string' ? { m: 'US' as const, t: x } : x)) })) }],
});
const view = (s: WlStore) => s.lists[0].sections.map((x) => `${x.id}:${x.items.map((i) => i.t + (i.flag ? `(${i.flag})` : '')).join(',')}`);
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

test('B02: a move on one device + a flag on the other keep BOTH (either direction)', () => {
  const base = store([{ id: 'A', items: ['NVDA', 'AAPL'] }, { id: 'B', items: [] }]);
  const moved = store([{ id: 'A', items: ['AAPL'] }, { id: 'B', items: ['NVDA'] }]);
  const flagged = copy(base); flagged.lists[0].sections[0].items[0].flag = 'red';
  assert.deepEqual(view(mergeWatchlistStores(moved, flagged, base)), ['A:AAPL', 'B:NVDA(red)']);
  assert.deepEqual(view(mergeWatchlistStores(flagged, moved, base)), ['A:AAPL', 'B:NVDA(red)']);
});

test('B02: a reorder on this device + a flag on the other: the reorder survives', () => {
  const base = store([{ id: 'A', items: ['NVDA', 'AAPL'] }]);
  const reordered = store([{ id: 'A', items: ['AAPL', 'NVDA'] }]);
  const flagged = copy(base); flagged.lists[0].sections[0].items[1].flag = 'blue';
  assert.deepEqual(view(mergeWatchlistStores(reordered, flagged, base)), ['A:AAPL(blue),NVDA']);
  // and the other way round: the reorder came from the other device, this one only flagged
  assert.deepEqual(view(mergeWatchlistStores(flagged, reordered, base)), ['A:AAPL(blue),NVDA']);
});

test('B02: two different moves of the same ticker → this device wins (deterministic); move + rename both kept', () => {
  const base = store([{ id: 'A', items: ['NVDA'] }, { id: 'B', items: [] }, { id: 'C', items: [] }]);
  const toB = store([{ id: 'A', items: [] }, { id: 'B', items: ['NVDA'] }, { id: 'C', items: [] }]);
  const toC = store([{ id: 'A', items: [] }, { id: 'B', items: [] }, { id: 'C', items: ['NVDA'] }]);
  assert.deepEqual(view(mergeWatchlistStores(toB, toC, base)), ['A:', 'B:NVDA', 'C:']);
  const renamed = copy(base); renamed.lists[0].sections[1].name = 'Breakouts';
  const m = mergeWatchlistStores(toB, renamed, base);
  assert.equal(m.lists[0].sections[1].name, 'Breakouts');
  assert.deepEqual(view(m), ['A:', 'B:NVDA', 'C:']);
});

test('B02: deleted on one device while the other moved it → kept (it was changed); a plain delete stays deleted', () => {
  const base = store([{ id: 'A', items: ['NVDA', 'AMD'] }, { id: 'B', items: [] }]);
  const deleted = store([{ id: 'A', items: ['AMD'] }, { id: 'B', items: [] }]);
  const moved = store([{ id: 'A', items: ['AMD'] }, { id: 'B', items: ['NVDA'] }]);
  assert.deepEqual(view(mergeWatchlistStores(deleted, moved, base)), ['A:AMD', 'B:NVDA']);
  const untouched = copy(base);
  assert.deepEqual(view(mergeWatchlistStores(deleted, untouched, base)), ['A:AMD', 'B:']);
});

test('B02: folded state, a deleted section and a linked-book section merge sensibly', () => {
  const base = store([{ id: 'A', items: ['NVDA'] }, { id: 'X', items: ['OLD'] }, { id: 'BK', book: 'US', name: 'USA Portfolio', items: ['MSFT'] }]);
  const local = copy(base); local.lists[0].sections[0].collapsed = true;
  const server = store([{ id: 'A', items: ['NVDA'] }, { id: 'BK', book: 'US', name: 'USA Portfolio', items: ['MSFT', 'GOOGL'] }]);   // X deleted there
  const m = mergeWatchlistStores(local, server, base);
  assert.equal(m.lists[0].sections[0].collapsed, true);
  assert.deepEqual(view(m), ['A:NVDA', 'BK:MSFT,GOOGL']);
  assert.equal(m.lists[0].sections[1].book, 'US');
});

test('B03: 999 + one addition on each device → nothing vanishes silently', () => {
  const many = Array.from({ length: MAX_ITEMS - 1 }, (_, i) => `T${i}`);
  const base = store([{ id: 'A', items: many }]);
  const local = store([{ id: 'A', items: [...many, 'LOCAL'] }]);
  const server = store([{ id: 'A', items: [...many, 'SERVER'] }]);
  const r = mergeWatchlistStoresDetailed(local, server, base);
  const count = r.store.lists[0].sections[0].items.length;
  assert.equal(count, MAX_ITEMS);
  assert.equal(r.lost.length, 1, 'the one that did not fit is reported');
  const kept = r.store.lists[0].sections[0].items.some((i) => i.t === 'LOCAL') ? 'LOCAL' : 'SERVER';
  assert.equal(r.lost[0].symbol, kept === 'LOCAL' ? 'US:SERVER' : 'US:LOCAL');
  assert.match(describeLost(r.lost), /Not merged: 1 ticker .* list is full .* recovery copy/);
});

test('sync: a merge that hit a limit keeps a recovery copy and tells the user', () => {
  const v = readFileSync(join(__dirname, '..', 'user-vault-client.ts'), 'utf8');
  assert.match(v, /mc:vault:overflow:\$\{key\}/);
  assert.match(v, /new CustomEvent\('mc:vault:overflow'/);
  const n = readFileSync(join(__dirname, '..', '..', 'components', 'VaultSyncNotice.tsx'), 'utf8');
  assert.match(n, /Download recovery copy/);
});
