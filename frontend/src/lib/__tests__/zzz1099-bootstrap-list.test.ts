// zzz1099 (evening retest R7) — a first-visit automatic empty list does not take over the saved lists; an empty list the owner
// made is kept; lists with the same name are never merged or deleted by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWatchlistStores } from '../chart-watchlist-merge';
import { seedStore, sanitizeStore, addList, addItem, activeList } from '../chart-watchlist';

const server = sanitizeStore({ activeId: 'existing', lists: [{ id: 'existing', name: 'My Watchlist', sections: [{ id: 's1', name: '', items: [{ m: 'IN', t: 'HAL' }, { m: 'IN', t: 'TCS' }] }] }] });

test('a new browser (pristine empty seed) opens the saved list', () => {
  const local = seedStore([], []);
  assert.equal(local.lists[0].seed, true);
  const m = mergeWatchlistStores(local, server);
  assert.deepEqual(m.lists.map((l) => l.id), ['existing'], 'the empty bootstrap list is left out');
  assert.equal(m.activeId, 'existing');
  // the other direction (this device has real lists, the server only a seed)
  const m2 = mergeWatchlistStores(server, seedStore([], []));
  assert.deepEqual(m2.lists.map((l) => l.id), ['existing']);
});

test('an empty list the owner made is kept, also with the same name as a saved one', () => {
  const mine = addList(sanitizeStore({ lists: [] }), 'My Watchlist');   // made on purpose → not a seed
  assert.equal(activeList(mine).seed, undefined);
  const m = mergeWatchlistStores(mine, server);
  assert.equal(m.lists.length, 2, 'both kept — never merged by name');
  // a seed that got an item is a real list
  const st = seedStore([], []);
  const used = { ...st, lists: [addItem(st.lists[0], null, { m: 'IN', t: 'INFY' } as any)] };
  const san = sanitizeStore(used);
  assert.equal(san.lists[0].seed, undefined);
});

test('nothing on the server: the seed stays (the page always has a list)', () => {
  const m = mergeWatchlistStores(seedStore([], []), sanitizeStore({ lists: [] }));
  assert.equal(m.lists.length, 1);
});
