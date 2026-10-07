import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTvBundle, importTvBundle, sanitizeStore, listCount } from '../chart-watchlist';

const base = sanitizeStore({ lists: [{ id: 'a', name: 'Mine', sections: [{ id: 's', name: '', items: [{ m: 'IN', t: 'TCS' }] }] }, { id: 'b', name: 'Old Copy', sections: [{ id: 's2', name: '', items: [{ m: 'US', t: 'AAPL' }] }] }], activeId: 'a' });
const file = JSON.stringify({ mcTradingViewLists: 1, active: 'Second', lists: [
  { name: 'old copy', text: '###GROWTH,NSE:INFY,NASDAQ:NVDA,TVC:GOLD,###ETF,AMEX:EWZ' },
  { name: 'Second', text: 'NYSE:BRK.B,NSE:M_M' },
  { name: 'Empty', text: '' },
], flags: { red: ['NSE:INFY'], green: ['NYSE:BRK.B'], pink: ['NSE:X'] } });

test('zzz945 bundle: parse rejects other JSON', () => {
  assert.equal(parseTvBundle('{"lists":[]}'), null);
  assert.equal(parseTvBundle('not json'), null);
  const b = parseTvBundle(file)!;
  assert.equal(b.lists.length, 3);
  assert.deepEqual(Object.keys(b.flags).sort(), ['green', 'red']);
});
test('zzz945 bundle: same name replaced in place, others kept, sections + flags carried, empty skipped', () => {
  const r = importTvBundle(base, parseTvBundle(file)!);
  assert.equal(r.lists, 2); assert.equal(r.replaced, 1); assert.equal(r.skipped, 1); assert.equal(r.flagged, 2);
  const names = r.store.lists.map((l) => l.name);
  assert.deepEqual(names, ['Mine', 'old copy', 'Second']);
  const oc = r.store.lists[1];
  assert.equal(oc.id, 'b');
  assert.deepEqual(oc.sections.map((s) => s.name), ['GROWTH', 'ETF']);
  assert.equal(oc.sections[0].items.find((i) => i.t === 'INFY')?.flag, 'red');
  const sec = r.store.lists[2];
  assert.equal(r.store.activeId, sec.id);
  assert.deepEqual(sec.sections[0].items.map((i) => i.t), ['BRK.B', 'M&M']);
  assert.equal(sec.sections[0].items[0].flag, 'green');
  assert.equal(listCount(r.store.lists[0]), 1);
  // re-import does not duplicate
  const again = importTvBundle(r.store, parseTvBundle(file)!);
  assert.equal(again.store.lists.length, 3);
});
