import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_WATCHLISTS_KEY, addItem, addList, addSection, emptyList, findItem, flatRows, importParsed, itemKey, listCount, moveItem,
  nextFlag, nextSort, parseTradingView, patchItem, patchSection, removeItem, removeList, removeSection, sanitizeStore, seedStore,
  serializeTradingView, sortItems, stepRow, tvSymbol, type WlList, type WlStore,
} from '../chart-watchlist';
import { USER_STATE_KEYS_CLIENT } from '../user-vault-keys';
import { USER_STATE_KEYS } from '../user-state-store';

const TV = '###SELL OR HOLD,NSE:TATVA,NSE:BBOX,###INDIA PORTFOLIO,NSE:PINELABS,NASDAQ:AKAM,NYSE:HSCL';

test('TradingView import: sections, mixed markets, exchange kept for export', () => {
  const p = parseTradingView(TV);
  assert.equal(p.count, 5);
  assert.deepEqual(p.sections.map((s) => s.name), ['SELL OR HOLD', 'INDIA PORTFOLIO']);
  assert.deepEqual(p.sections[0].items, [{ m: 'IN', t: 'TATVA', x: 'NSE' }, { m: 'IN', t: 'BBOX', x: 'NSE' }]);
  assert.deepEqual(p.sections[1].items.map(itemKey), ['IN:PINELABS', 'US:AKAM', 'US:HSCL']);
  assert.equal(p.skipped, 0);
});

test('TradingView import: new lines, unknown exchanges counted, BSE codes kept and counted, duplicates dropped, _ mapping', () => {
  const p = parseTradingView('﻿NSE:M_M\nNSE:BAJAJ_AUTO\r\nBSE:543193\nFX:EURUSD, BINANCE:BTCUSDT ,NSE:M_M\nAMEX:SPY\nNYSE:BRK.B\n\n');
  assert.deepEqual(p.sections.length, 1);
  assert.equal(p.sections[0].name, '');
  assert.deepEqual(p.sections[0].items.map(itemKey), ['IN:M&M', 'IN:BAJAJ-AUTO', 'IN:543193', 'US:SPY', 'US:BRK.B']);
  assert.equal(p.skipped, 2);
  assert.deepEqual(p.skippedExamples, ['FX:EURUSD', 'BINANCE:BTCUSDT']);
  assert.equal(p.bseCodes, 1);
  const bare = parseTradingView('QQQ,AAPL', 'US');
  assert.deepEqual(bare.sections[0].items, [{ m: 'US', t: 'QQQ' }, { m: 'US', t: 'AAPL' }]);
  assert.equal(parseTradingView('').count, 0);
});

test('TradingView export round-trips', () => {
  const s = importParsed(sanitizeStore(null), parseTradingView(TV + ',NSE:M_M,BSE:543193'), { mode: 'new', name: 'From TV' });
  const l = s.lists.find((x) => x.id === s.activeId)!;
  assert.equal(l.name, 'From TV');
  const text = serializeTradingView(l);
  assert.equal(text, '###SELL OR HOLD,NSE:TATVA,NSE:BBOX,###INDIA PORTFOLIO,NSE:PINELABS,NASDAQ:AKAM,NYSE:HSCL,NSE:M_M,BSE:543193');
  const again = parseTradingView(text);
  assert.deepEqual(again.sections.flatMap((x) => x.items.map(itemKey)), l.sections.flatMap((x) => x.items.map(itemKey)));
  assert.equal(tvSymbol({ m: 'IN', t: 'BAJAJ-AUTO' }), 'NSE:BAJAJ_AUTO');
  assert.equal(tvSymbol({ m: 'US', t: 'QQQ' }), 'NASDAQ:QQQ');
});

test('import into the current list merges same-name sections and skips symbols already there', () => {
  let s: WlStore = importParsed(sanitizeStore(null), parseTradingView(TV), { mode: 'new', name: 'A' });
  s = importParsed(s, parseTradingView('###india portfolio,NSE:PINELABS,NSE:TCS,###NEW ONE,NASDAQ:NVDA'), { mode: 'append', listId: s.activeId });
  const l = s.lists.find((x) => x.id === s.activeId)!;
  assert.deepEqual(l.sections.map((x) => x.name), ['SELL OR HOLD', 'INDIA PORTFOLIO', 'NEW ONE']);
  assert.deepEqual(l.sections[1].items.map((x) => x.t), ['PINELABS', 'AKAM', 'HSCL', 'TCS']);
  assert.equal(listCount(l), 7);
});

test('clean-up on read: bad rows, bad flags, duplicates and junk lists are dropped; always one list', () => {
  const s = sanitizeStore({
    lists: [
      { id: 'a', name: '  Mine ', sections: [{ id: 's1', name: 'X', collapsed: true, items: [
        { m: 'IN', t: 'tcs', flag: 'red' }, { m: 'IN', t: 'TCS' }, { m: 'US', t: '3M' }, { m: 'XX', t: 'A' }, { m: 'US', t: 'QQQ', flag: 'pink', x: 'NASDAQ' }, null,
      ] }] },
      'junk',
      { id: 'a', name: '', sections: [] },
    ],
    activeId: 'nope',
  });
  assert.equal(s.lists.length, 2);
  assert.equal(s.lists[0].name, 'Mine');
  assert.deepEqual(s.lists[0].sections[0].items, [{ m: 'IN', t: 'TCS', flag: 'red' }, { m: 'US', t: 'QQQ', x: 'NASDAQ' }]);
  assert.equal(s.lists[0].sections[0].collapsed, true);
  assert.notEqual(s.lists[1].id, 'a');                      // duplicate id replaced
  assert.equal(s.lists[1].sections.length, 1);              // a list always has a section
  assert.equal(s.activeId, 'a');
  assert.equal(sanitizeStore('garbage').lists.length, 1);
});

test('first-visit seed from the site watchlist and India book', () => {
  const s = seedStore(['tcs', 'NSE:INFY', 'TCS', 'bad ticker', 'RELIANCE.NS'], [{ symbol: 'HDFCBANK' }, { symbol: '' }]);
  assert.deepEqual(s.lists.map((l) => l.name), ['My Watchlist', 'Portfolio']);
  assert.deepEqual(s.lists[0].sections[0].items.map(itemKey), ['IN:TCS', 'IN:INFY', 'IN:RELIANCE']);
  assert.deepEqual(s.lists[1].sections[0].items.map(itemKey), ['IN:HDFCBANK']);
  assert.equal(s.activeId, s.lists[0].id);
  assert.equal(seedStore(null, null).lists.length, 1);
});

function sample(): WlList {
  let l = emptyList('L');
  l = patchSection(l, l.sections[0].id, { name: 'ONE' });
  l = addSection(l, 'TWO');
  const [a, b] = l.sections.map((s) => s.id);
  for (const t of ['AAA', 'BBB', 'CCC']) l = addItem(l, a, { m: 'US', t });
  l = addItem(l, b, { m: 'IN', t: 'TCS' });
  return l;
}

test('list operations: add (no duplicates), remove, flag, move, reorder, sections', () => {
  let l = sample();
  const [a, b] = l.sections.map((s) => s.id);
  assert.equal(addItem(l, a, { m: 'US', t: 'AAA' }), l);                       // already there
  l = patchItem(l, 'US:BBB', { flag: 'green' });
  assert.equal(findItem(l, 'US:BBB')!.item.flag, 'green');
  l = patchItem(l, 'US:BBB', { flag: undefined });
  assert.equal('flag' in findItem(l, 'US:BBB')!.item, false);
  l = moveItem(l, 'US:AAA', b);
  assert.deepEqual(l.sections[1].items.map((x) => x.t), ['TCS', 'AAA']);
  l = moveItem(l, 'US:CCC', a, 0);
  assert.deepEqual(l.sections[0].items.map((x) => x.t), ['CCC', 'BBB']);
  l = moveItem(l, 'US:CCC', a, 2);                                               // drop below BBB in the same section
  assert.deepEqual(l.sections[0].items.map((x) => x.t), ['BBB', 'CCC']);
  l = removeItem(l, 'IN:TCS');
  assert.equal(findItem(l, 'IN:TCS'), null);
  l = removeSection(l, b);                                                        // rows move up, not lost
  assert.equal(l.sections.length, 1);
  assert.deepEqual(l.sections[0].items.map((x) => x.t), ['BBB', 'CCC', 'AAA']);
  assert.equal(removeSection(l, l.sections[0].id), l);                            // last section stays
  assert.equal(nextFlag(undefined), 'red'); assert.equal(nextFlag('red'), 'blue'); assert.equal(nextFlag('purple'), undefined);
});

test('lists: add makes it active, remove falls back, never zero lists', () => {
  let s = sanitizeStore(null);
  const first = s.activeId;
  s = addList(s, 'Second');
  assert.equal(s.lists.length, 2); assert.notEqual(s.activeId, first);
  s = removeList(s, s.activeId);
  assert.equal(s.activeId, first);
  s = removeList(s, first);
  assert.equal(s.lists.length, 1);
});

test('sorting: header click cycle, missing prices last, within each section', () => {
  assert.deepEqual(nextSort(null, 'chg'), { key: 'chg', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'chg', dir: 'desc' }, 'chg'), { key: 'chg', dir: 'asc' });
  assert.equal(nextSort({ key: 'chg', dir: 'asc' }, 'chg'), null);
  assert.deepEqual(nextSort(null, 'symbol'), { key: 'symbol', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'chg', dir: 'asc' }, 'last'), { key: 'last', dir: 'desc' });
  const l = sample();
  const q = { 'US:AAA': { last: 10, chgPct: -1 }, 'US:BBB': { last: 20, chgPct: 3 }, 'IN:TCS': { last: 5, chgPct: 9 } };
  assert.deepEqual(sortItems(l.sections[0].items, { key: 'chg', dir: 'desc' }, q).map((x) => x.t), ['BBB', 'AAA', 'CCC']);
  assert.deepEqual(sortItems(l.sections[0].items, { key: 'chg', dir: 'asc' }, q).map((x) => x.t), ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(sortItems(l.sections[0].items, { key: 'symbol', dir: 'desc' }, q).map((x) => x.t), ['CCC', 'BBB', 'AAA']);
  const rows = flatRows(l, { key: 'chg', dir: 'desc' }, q, null);
  assert.deepEqual(rows.map((r) => r.item.t), ['BBB', 'AAA', 'CCC', 'TCS']);       // TCS stays in its own section
});

test('↑/↓ order skips collapsed sections and respects the flag filter', () => {
  let l = sample();
  l = patchItem(l, 'US:CCC', { flag: 'red' });
  l = patchItem(l, 'IN:TCS', { flag: 'red' });
  const rows = flatRows(l, null, {}, null);
  assert.equal(stepRow(rows, 'US:AAA', 1)!.item.t, 'BBB');
  assert.equal(stepRow(rows, 'US:CCC', 1)!.item.t, 'TCS');
  assert.equal(stepRow(rows, 'IN:TCS', 1), null);
  assert.equal(stepRow(rows, 'US:AAA', -1), null);
  assert.equal(stepRow(rows, 'US:QQQ', 1)!.item.t, 'AAA');                       // current ticker not in list → first row
  const red = flatRows(l, null, {}, 'red');
  assert.deepEqual(red.map((r) => r.item.t), ['CCC', 'TCS']);
  const collapsed = patchSection(l, l.sections[1].id, { collapsed: true });
  assert.deepEqual(flatRows(collapsed, null, {}, null).map((r) => r.item.t), ['AAA', 'BBB', 'CCC']);
});

test('the watchlist key syncs to the owner database (both allow-lists)', () => {
  assert.ok((USER_STATE_KEYS_CLIENT as readonly string[]).includes(CHART_WATCHLISTS_KEY));
  assert.ok((USER_STATE_KEYS as readonly string[]).includes(CHART_WATCHLISTS_KEY));
});
