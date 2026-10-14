// zzz1022b/c — Charts. Owner: "make the mouse click options work like auto fit and others, like TradingView" and "when I go to
// different charts quickly from the watchlist the charts freeze".
//  • right-click on the chart opens a menu: reset view, fit, Auto / Log / Total return (ticked when on), a price line and a copy of the
//    price under the mouse, indicators on / off, drawings, theme; on the price axis only the scale items
//  • the Auto / Fit / Log / TR chips are larger and labelled in capitals
//  • the URL follows the symbol with history.replaceState (no server navigation per click), shortly after the last switch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chartMenuItems, placeMenu, type ChartMenuState } from '../../components/charts/ChartContextMenu';

const base: ChartMenuState = { axis: false, price: 123.456, cur: '$', decimals: 2, auto: true, log: false, tr: false, patterns: true, stage: false, setups: false, volume: true, selected: false, light: false };

test('chart menu: scale items ticked as set; the price under the mouse; drawings; theme', () => {
  const items = chartMenuItems(base);
  const by = (id: string) => items.find((x) => x.id === id)!;
  assert.deepEqual(items.slice(0, 5).map((x) => x.id), ['reset', 'fit', 'auto', 'log', 'tr']);
  assert.equal(by('auto').checked, true);
  assert.equal(by('log').checked, false);
  assert.equal(by('hline').label, 'Horizontal line at $123.46');
  assert.equal(by('copy').label, 'Copy price 123.46');
  assert.equal(by('patterns').checked, true);
  assert.equal(by('del1').disabled, true, 'nothing selected');
  assert.equal(by('theme').label, 'White chart');
  for (const it of items) assert.doesNotMatch(it.label, /\b(best|Buy|Sell|BUY|SELL)\b/);
});

test('price axis menu: only the scale items; no price items outside the price pane', () => {
  assert.deepEqual(chartMenuItems({ ...base, axis: true }).map((x) => x.id), ['reset', 'fit', 'auto', 'log', 'tr']);
  const ids = chartMenuItems({ ...base, price: null }).map((x) => x.id);
  assert.equal(ids.includes('hline'), false);
  assert.equal(ids.includes('copy'), false);
});

test('menu stays inside the chart', () => {
  assert.deepEqual(placeMenu(10, 10, 200, 300, 1000, 600), { left: 10, top: 10 });
  assert.deepEqual(placeMenu(900, 500, 200, 300, 1000, 600), { left: 700, top: 296 });
});

test('wiring: right-click handler, menu render, replaceState URL, capital chip labels', () => {
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ws, /<div className="ct-canvas" onContextMenu=\{onChartContextMenu\}>/);
  assert.match(ws, /<ChartContextMenu x=\{ctx\.x\} y=\{ctx\.y\} items=\{ctxItems\} onSelect=\{onCtxSelect\}/);
  assert.match(ws, /chart\.convertFromPixel\(\[\{ x, y \}\], \{ paneId: 'candle_pane' \}\)/);
  assert.match(ws, /window\.history\.replaceState\(window\.history\.state, '', `\/charts\$\{q\}`\)/);
  assert.doesNotMatch(ws, /router\.replace\(`\/charts/);
  assert.match(ws, />Auto<\/button>/);
  assert.match(ws, />Fit<\/button>/);
});
