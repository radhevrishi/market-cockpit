import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMembershipIndex, findInList, isBulkQuery, listingKey, membershipsFor } from '../watchlist-find';

const ROWS = [
  { ticker: 'RELIANCE', company: 'Reliance Industries Ltd' },
  { ticker: 'NSE:TATVA', company: 'Tatva Chintan Pharma Chem' },
  { ticker: 'INFY.NS', company: 'Infosys Limited' },
  { ticker: 'RPOWER', company: 'Reliance Power' },
  { ticker: 'TCS', company: null },
];

test('find: company name, case-insensitive, matches only those rows', () => {
  assert.deepEqual(findInList(ROWS, 'Reliance').map((r) => r.ticker), ['RELIANCE', 'RPOWER']);
  assert.deepEqual(findInList(ROWS, 'reliance industries').map((r) => r.ticker), ['RELIANCE']);
  assert.deepEqual(findInList(ROWS, 'infosys').map((r) => r.ticker), ['INFY.NS']);
});

test('find: ticker with exchange prefix / suffix on either side', () => {
  assert.deepEqual(findInList(ROWS, 'tatva').map((r) => r.ticker), ['NSE:TATVA']);
  assert.deepEqual(findInList(ROWS, 'NSE:INFY').map((r) => r.ticker), ['INFY.NS']);
  assert.deepEqual(findInList(ROWS, 'tcs.ns').map((r) => r.ticker), ['TCS']);
  assert.deepEqual(findInList(ROWS, 'BSE:RELIANCE').map((r) => r.ticker), ['RELIANCE']);
});

test('find: empty, blank and bulk text keep every row; no match gives none', () => {
  assert.equal(findInList(ROWS, '').length, ROWS.length);
  assert.equal(findInList(ROWS, '   ').length, ROWS.length);
  assert.equal(findInList(ROWS, undefined).length, ROWS.length);
  assert.equal(findInList(ROWS, 'INFY, TCS').length, ROWS.length);
  assert.equal(isBulkQuery('INFY\nTCS'), true);
  assert.deepEqual(findInList(ROWS, 'zzzz'), []);
});

test('listing key: BSE kept apart only when stated', () => {
  assert.equal(listingKey('TATVA'), 'TATVA');
  assert.equal(listingKey('NSE:TATVA'), 'TATVA');
  assert.equal(listingKey('tatva.ns'), 'TATVA');
  assert.equal(listingKey('BSE:TATVA'), 'BSE:TATVA');
  assert.equal(listingKey('BOM:TATVA'), 'BSE:TATVA');
  assert.equal(listingKey('TATVA.BO'), 'BSE:TATVA');
  assert.equal(listingKey('TATVA', true), 'BSE:TATVA');
  assert.equal(listingKey(''), '');
  assert.equal(listingKey(null), '');
});

const CHART = {
  activeId: 'l1',
  lists: [
    { id: 'l1', name: 'AI infra', sections: [{ id: 's', name: '', collapsed: false, items: [{ m: 'IN', t: 'TATVA', x: 'NSE' }, { m: 'US', t: 'NVDA' }] }] },
    { id: 'l2', name: 'BSE names', sections: [{ id: 's', name: 'x', collapsed: false, items: [{ m: 'IN', t: 'TATVA', x: 'BSE' }] }, { id: 's2', name: 'y', collapsed: false, items: [{ m: 'IN', t: 'RELIANCE' }] }] },
  ],
};

test('memberships: every list named, NSE and BSE kept apart, bare = NSE', () => {
  const idx = buildMembershipIndex({
    watchlist: ['RELIANCE', 'NSE:TATVA'],
    chartStore: CHART,
    portfolio: [{ symbol: 'RELIANCE', qty: 5 }, 'BSE:TATVA'],
    conviction: new Set(['TATVA', 'NVDA']),
  });
  assert.deepEqual(membershipsFor(idx, 'TATVA'), ['Watchlist', "Chart list 'AI infra'", 'Conviction Beats']);
  assert.deepEqual(membershipsFor(idx, 'NSE:TATVA'), ['Watchlist', "Chart list 'AI infra'", 'Conviction Beats']);
  assert.deepEqual(membershipsFor(idx, 'BSE:TATVA'), ["Chart list 'BSE names'", 'Portfolio']);
  assert.deepEqual(membershipsFor(idx, 'reliance'), ['Watchlist', "Chart list 'BSE names'", 'Portfolio']);
  assert.deepEqual(membershipsFor(idx, 'NVDA'), ["Chart list 'AI infra'", 'Conviction Beats']);
  assert.deepEqual(membershipsFor(idx, 'INFY'), []);
});

test('memberships: same list named once even if held twice; returned array is a copy', () => {
  const store = { lists: [{ name: 'Dup', sections: [{ items: [{ m: 'IN', t: 'ABC' }] }, { items: [{ m: 'IN', t: 'ABC' }] }] }] };
  const idx = buildMembershipIndex({ chartStore: store });
  const a = membershipsFor(idx, 'ABC');
  assert.deepEqual(a, ["Chart list 'Dup'"]);
  a.push('mutated');
  assert.deepEqual(membershipsFor(idx, 'ABC'), ["Chart list 'Dup'"]);
});

test('memberships: junk input never throws', () => {
  const idx = buildMembershipIndex({ watchlist: 'nope', chartStore: { lists: [null, { sections: 'x' }, { name: 5, sections: [{ items: [null, { t: 3 }] }] }] }, portfolio: 7 as any, conviction: null });
  assert.equal(idx.size, 0);
  const idx2 = buildMembershipIndex({ portfolio: { RELIANCE: { qty: 1 } } });
  assert.deepEqual(membershipsFor(idx2, 'RELIANCE'), ['Portfolio']);
  assert.deepEqual(buildMembershipIndex({}).size, 0);
});
