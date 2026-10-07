import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshChart, cacheChart, refreshedQuotes } from '../chart-refresh';
import { drawingKey } from '../chart-math';
import { mergeDrawingStores, drawingsFor, readDrawingStore } from '../chart-sync';
import { itemKey, parseTradingView, sanitizeStore, serializeTradingView, importParsed } from '../chart-watchlist';
import { yahooCandidates } from '../yahoo-symbol';
import { techFigures } from '../screener/tech';
import { assembleUsRows } from '../screener/us-build';
import { framePeriods, type FrameData } from '../screener/sec-assemble';

test('chart cache expires and stays bounded without mixing symbols', () => {
  const cache = new Map();
  cacheChart(cache, 'A', { px: 10 }, 100, 2);
  assert.deepEqual(freshChart(cache, 'A', 300, 399), { px: 10 });
  assert.equal(freshChart(cache, 'A', 300, 400), null);
  assert.equal(freshChart(cache, 'A', 300, 99), null);
  cacheChart(cache, 'B', { px: 20 }, 200, 2);
  cacheChart(cache, 'C', { px: 30 }, 300, 2);
  assert.equal(cache.size, 2); assert.equal(cache.has('A'), false);
});

test('partial/failed quote refresh preserves and marks old values, successful refresh clears warning', () => {
  const previous = { A: { last: 100, chgPct: 3, at: 100 }, B: { last: 200, chgPct: -2, at: 100 }, inactive: { last: 1, chgPct: 0 } };
  const failed = refreshedQuotes(previous, { A: { last: 101, chgPct: 4, at: 200 } }, ['A', 'B'], 200);
  assert.equal(failed.B.last, 200); assert.equal(failed.B.at, 100); assert.equal(failed.B.stale, true);
  assert.equal(failed.A.stale, false); assert.equal('inactive' in failed, false);
  const recovered = refreshedQuotes(failed, { B: { last: 201, chgPct: 2 } }, ['B'], 300);
  assert.equal(recovered.B.stale, false); assert.equal(recovered.B.at, 300);
});

test('NSE and BSE identity survives storage/export and routes to only the requested exchange', () => {
  const parsed = parseTradingView('BSE:RELIANCE,NSE:RELIANCE');
  assert.equal(parsed.count, 2);
  assert.deepEqual(parsed.sections[0].items.map(itemKey), ['IN:BSE:RELIANCE', 'IN:RELIANCE']);
  const store = sanitizeStore(importParsed(sanitizeStore(null), parsed, { mode: 'new', name: 'Both exchanges' }));
  const list = store.lists.find((l) => l.id === store.activeId)!;
  assert.equal(serializeTradingView(list), 'BSE:RELIANCE,NSE:RELIANCE');
  assert.deepEqual(yahooCandidates('IN', 'RELIANCE', 'BSE'), ['RELIANCE.BO']);
  assert.deepEqual(yahooCandidates('IN', 'RELIANCE', 'NSE'), ['RELIANCE.NS']);
  assert.deepEqual(yahooCandidates('IN', '543193', 'BSE'), ['543193.BO']);
});

test('existing NSE drawings remain readable while BSE drawings have an independent identity', () => {
  const drawing = { name: 'mcHLine', points: [{ t: 100, p: 50 }] };
  const store = mergeDrawingStores({ 'IN:RELIANCE': [drawing] }, { v: 2, items: { 'IN:BSE:RELIANCE': { at: 5, d: [drawing] } } });
  assert.equal(drawingKey('IN', 'RELIANCE', 'NSE'), 'IN:RELIANCE');
  assert.equal(drawingsFor(readDrawingStore(store), 'IN:RELIANCE').length, 1);
  assert.equal(drawingsFor(readDrawingStore(store), 'IN:BSE:RELIANCE').length, 1);
});

test('YTD includes a listing this year, without changing an established company baseline', () => {
  const b = { d: ['2026-01-02', '2026-01-05'], o: [100, 110], h: [110, 120], l: [99, 109], c: [110, 120], v: [1000, 1000] };
  assert.equal(techFigures(b).perfYTD, 20);
  assert.equal(techFigures({ ...b, d: ['2025-12-31', ...b.d], o: [90, ...b.o], h: [99, ...b.h], l: [89, ...b.l], c: [95, ...b.c], v: [1000, ...b.v] }).perfYTD, 20);
});

test('EV/revenue is unavailable with missing debt/cash, but accepts reported zero', () => {
  const periods = framePeriods(new Date('2026-10-07T12:00:00Z'));
  const fd: FrameData = { Revenues: {} };
  for (const p of periods.quarters) fd.Revenues[p] = { '123': { v: 25e6, s: '2026-01-01', e: '2026-03-31' } };
  const company = { t: 'TEST', n: 'Test', px: 100, chg: 0, vol: 1000, mc: 100, sec: 'Technology', ind: 'Software', ex: 'NASDAQ' };
  const assemble = () => assembleUsRows([company], new Map([['TEST', 123]]), fd, periods, new Map(), new Map(), new Map()).rows[0];
  assert.equal(assemble().ps, 1); assert.equal(assemble().evRev, null);
  const I = periods.instants[0];
  fd.StockholdersEquity = { [I]: { '123': { v: 50e6 } } };
  fd.CashAndCashEquivalentsAtCarryingValue = { [I]: { '123': { v: 0 } } };
  assert.equal(assemble().evRev, null, 'an absent debt tag is not known zero');
  fd.LongTermDebt = { [I]: { '123': { v: 0 } } };
  assert.equal(assemble().evRev, 1);
});
