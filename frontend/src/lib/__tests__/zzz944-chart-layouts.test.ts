import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atr, bollinger, extendedHoursPct, floatPct, headerStats, macd, peakVolumePct, rsi, supertrend, type Bar } from '../chart-math';
import {
  CHART_LAYOUTS_KEY, activeLayout, cleanExtra, deleteLayout, legendRows, mergeLayoutStores, newExtra, priceSeriesOf, renameLayout,
  sameSettings, sanitizeLayoutStore, saveLayout, saveLayoutAs, seedLayoutStore, seriesValues, toggleRow,
} from '../chart-layouts';
import { CHART_DRAWINGS_KEY, VAULT_MERGERS, mergeDrawingStores, readDrawingStore, rescueFromBackup, setDrawings } from '../chart-sync';
import { mergeDecision, unwrapVaultValue } from '../user-vault-client';
import { USER_STATE_KEYS_CLIENT } from '../user-vault-keys';
import { USER_STATE_KEYS } from '../user-state-store';

const H = (p: number) => ({ name: 'mcHLine' as const, points: [{ t: 1, p }] });
const bar = (i: number, o: number, h: number, l: number, c: number, v = 100): Bar => ({ t: i, o, h, l, c, v });

// ── the drawing-loss bug ──────────────────────────────────────────────────────
test('drawings: another device’s empty copy can no longer wipe this device’s drawings (the bug)', () => {
  const mine = { 'US:QQQ': [H(500)] };                // old shape, drawn here, never synced
  const server = {};                                  // what a device writes after opening a drawing tool on another ticker
  const merged = mergeDrawingStores(mine, server);
  assert.deepEqual(merged.items['US:QQQ'].d, [H(500)]);
  const dec = mergeDecision(mine, server, VAULT_MERGERS[CHART_DRAWINGS_KEY]);
  assert.equal(dec.needPush, true);                   // the server gets the drawings back
});

test('drawings: per ticker the newer save wins; a cleared ticker stays cleared everywhere; nothing written when unchanged', () => {
  let a = readDrawingStore(null);
  a = setDrawings(a, 'US:QQQ', [H(1)], 1000);
  a = setDrawings(a, 'IN:TCS', [H(2)], 1000);
  let b = readDrawingStore(JSON.parse(JSON.stringify(a)));
  b = setDrawings(b, 'US:QQQ', [H(1), H(3)], 2000);   // other device added a line on QQQ
  a = setDrawings(a, 'IN:TCS', [], 3000);             // this device cleared TCS
  const m = mergeDrawingStores(a, b);
  assert.equal(m.items['US:QQQ'].d.length, 2);
  assert.deepEqual(m.items['IN:TCS'], { at: 3000, d: [] });
  assert.equal(setDrawings(m, 'US:QQQ', [H(1), H(3)], 9999), m);   // same drawings → same object, nothing saved
  assert.equal(setDrawings(m, 'US:NEW', [], 9999), m);             // nothing to clear → nothing saved
  assert.deepEqual(mergeDrawingStores(b, a), m);                    // order does not matter
});

test('drawings: old shape is read, junk is dropped, and the vault backup brings lost tickers back', () => {
  const s = readDrawingStore({ 'US:QQQ': [H(5)], 'bad key': [H(1)], 'IN:TCS': 'junk' });
  assert.deepEqual(Object.keys(s.items), ['US:QQQ']);
  const backup = { at: 'x', value: { __raw: JSON.stringify({ 'US:AMZN': [H(150)] }), parsed: { 'US:AMZN': [H(150)] } } };
  const r = rescueFromBackup(readDrawingStore({}), backup);
  assert.deepEqual(r.items['US:AMZN'], { at: 0, d: [H(150)] });
  assert.equal(rescueFromBackup(r, backup), r);                     // already there → unchanged
  assert.equal(rescueFromBackup(r, null), r);
});

test('vault merge helpers: unwrap stored values; merged keys are in both allow-lists', () => {
  assert.deepEqual(unwrapVaultValue({ __raw: '{"a":1}' }), { a: 1 });
  assert.deepEqual(unwrapVaultValue({ __raw: 'x', parsed: { b: 2 } }), { b: 2 });
  assert.equal(unwrapVaultValue(null), null);
  for (const k of [CHART_DRAWINGS_KEY, CHART_LAYOUTS_KEY]) {
    assert.ok((USER_STATE_KEYS_CLIENT as readonly string[]).includes(k), k);
    assert.ok((USER_STATE_KEYS as readonly string[]).includes(k), k);
    assert.equal(typeof VAULT_MERGERS[k], 'function');
  }
  const same = mergeDecision({ v: 2, items: {} }, { v: 2, items: {} }, VAULT_MERGERS[CHART_DRAWINGS_KEY]);
  assert.equal(same.needPush, false); assert.equal(same.changedLocal, false);
});

// ── layouts ───────────────────────────────────────────────────────────────────
test('seed layouts match his TradingView legend', () => {
  const s = seedLayoutStore(1);
  assert.deepEqual(s.layouts.map((l) => l.name), ['Manual Support Resistance', 'RSI']);
  const msr = s.layouts[0];
  assert.deepEqual(msr.lines.map((l) => [l.period, l.color, l.on]), [
    [100, '#FFD600', true], [150, '#2E7D32', false], [50, '#2962FF', true], [55, '#8E24AA', false], [89, '#000000', true], [21, '#F23645', true],
  ]);
  assert.deepEqual(msr.volume, { on: true, avg: 20 });
  assert.deepEqual(s.layouts[1].extras.map((e) => [e.type, e.params]), [['RSI', [14]]]);
  assert.equal(s.activeId, msr.id);
});

test('save / save as / rename / delete, and the unsaved-changes compare', () => {
  let s = seedLayoutStore(1);
  const w = { ...activeLayout(s), lines: activeLayout(s).lines.map((l) => (l.period === 55 ? { ...l, on: true } : l)) };
  assert.equal(sameSettings(w, activeLayout(s)), false);
  s = saveLayout(s, w, 50);
  assert.equal(sameSettings(w, activeLayout(s)), true);
  assert.equal(activeLayout(s).name, 'Manual Support Resistance');
  assert.equal(activeLayout(s).updatedAt, 50);
  s = saveLayoutAs(s, { ...w, extras: [newExtra('MACD')] }, 'With MACD', 60);
  assert.equal(activeLayout(s).name, 'With MACD');
  assert.equal(s.layouts.length, 3);
  s = renameLayout(s, s.activeId, '  MACD view ', 70);
  assert.equal(activeLayout(s).name, 'MACD view');
  const id = s.activeId;
  s = deleteLayout(s, id, 80);
  assert.equal(s.layouts.length, 2); assert.equal(s.deleted[id], 80); assert.notEqual(s.activeId, id);
  let one = { ...s, layouts: [s.layouts[0]], activeId: s.layouts[0].id };
  one = deleteLayout(one, one.layouts[0].id);
  assert.equal(one.layouts.length, 1);                                // the last layout stays
});

test('layouts merge across devices: newer save wins, deletes stick, active layout is this device’s choice', () => {
  const base = seedLayoutStore(1);
  const a = saveLayoutAs(base, activeLayout(base), 'Mine', 10);         // device A adds a layout (active)
  let b = renameLayout(base, 'lay-rsi', 'RSI 14', 20);                  // device B renames RSI
  b = deleteLayout(b, 'lay-msr', 30);                                   // … and deletes the first one
  const m = mergeLayoutStores(a, b);
  assert.deepEqual(m.layouts.map((l) => l.name).sort(), ['Mine', 'RSI 14']);
  assert.equal(m.activeId, a.activeId);
  const back = mergeLayoutStores(b, a);
  assert.deepEqual(back.layouts.map((l) => l.name).sort(), ['Mine', 'RSI 14']);
});

test('layout clean-up: bad values clamped, unknown indicators dropped, never empty', () => {
  const s = sanitizeLayoutStore({ layouts: [{ id: 'x', name: '', lines: [{ kind: 'WMA', period: 9999, color: 'red' }], volume: { avg: 0 }, extras: [{ type: 'NOPE' }, { type: 'BOLL', params: [1, 99] }] }], activeId: 'zz' });
  const l = s.layouts[0];
  assert.equal(l.name, 'Layout');
  assert.deepEqual([l.lines[0].kind, l.lines[0].period, l.lines[0].color], ['EMA', 500, '#2962FF']);
  assert.equal(l.volume.avg, 1);
  assert.deepEqual(l.extras.map((e) => [e.type, e.params]), [['BOLL', [2, 10]]]);
  assert.equal(s.activeId, 'x');
  assert.equal(sanitizeLayoutStore(null).layouts.length, 2);            // nothing stored → the two seeds
  assert.equal(cleanExtra({ type: 'ST', params: [10, 2.5] })!.params[1], 2.5);
});

test('legend rows, eye toggle and what the price pane draws', () => {
  let l = activeLayout(seedLayoutStore(1));
  l = { ...l, extras: [newExtra('BOLL'), newExtra('ST'), newExtra('RSI')] };
  const rows = legendRows(l);
  assert.deepEqual(rows.map((r) => r.label).slice(0, 6), ['EMA 100', 'EMA 150', 'EMA 50', 'EMA 55', 'EMA 89', 'EMA 21']);
  assert.equal(rows.find((r) => r.label.startsWith('Bollinger'))!.series.length, 3);
  assert.equal(rows.find((r) => r.label.startsWith('RSI'))!.pane, true);
  // price pane: 4 visible EMAs + 3 Bollinger lines + 2 Supertrend lines; RSI goes to its own pane
  assert.equal(priceSeriesOf(l).length, 9);
  const hidden = toggleRow(l, 'e100');
  assert.equal(hidden.lines.find((x) => x.id === 'e100')!.on, false);
  assert.equal(priceSeriesOf(hidden).length, 8);
  assert.equal(sameSettings(hidden, l), false);
});

// ── indicator maths ──────────────────────────────────────────────────────────
test('RSI (Wilder): all gains → 100, all losses → 0, flat → 50, known value', () => {
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 3)[5], 100);
  assert.equal(rsi([6, 5, 4, 3, 2, 1], 3)[5], 0);
  assert.equal(rsi([5, 5, 5, 5], 3)[3], 50);
  const r = rsi([10, 11, 10, 12, 11], 2);
  // seed: gains 1, losses 1 → avg 0.5/0.5 → 50; next d=+2: g=(0.5+2)/2=1.25, l=0.25 → 83.33; d=-1: g=0.625, l=0.625 → 50
  assert.equal(r[2], 50); assert.ok(Math.abs((r[3] as number) - 83.3333) < 1e-3); assert.equal(r[4], 50);
  assert.deepEqual(rsi([1, 2], 14), [null, null]);
});

test('Bollinger, MACD, ATR', () => {
  const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  assert.equal(b.mid[7], 5); assert.equal(b.up[7], 9); assert.equal(b.lo[7], 1);    // population sd = 2
  const m = macd([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2, 4, 2);
  assert.equal(m.macd[2], null); assert.ok(m.macd[3] != null);
  assert.ok(m.signal[4] != null && m.hist[4] != null);
  assert.ok(Math.abs((m.hist[4] as number) - ((m.macd[4] as number) - (m.signal[4] as number))) < 1e-12);
  const bars = [bar(0, 10, 12, 9, 11), bar(1, 11, 13, 10, 12), bar(2, 12, 16, 11, 15), bar(3, 15, 15, 13, 14)];
  // true ranges: 3, 3, 5 (16−11), 2; ATR(2): seed (3+3)/2 = 3, then (3+5)/2 = 4, then (4+2)/2 = 3
  assert.deepEqual(atr(bars, 2), [null, 3, 4, 3]);
});

test('Supertrend follows TradingView: starts in a down trend, flips up when the close breaks the upper band', () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 12; i++) bars.push(bar(i, 100, 101, 99, 100));           // flat
  for (let i = 12; i < 20; i++) bars.push(bar(i, 100 + (i - 11) * 5, 103 + (i - 11) * 5, 99 + (i - 11) * 5, 102 + (i - 11) * 5)); // rally
  const st = supertrend(bars, 3, 1);
  assert.equal(st.dir[2], -1);                       // first value: down trend, line above price
  assert.ok((st.line[2] as number) > bars[2].c);
  assert.equal(st.dir[19], 1);                       // after the rally: up trend, line below price
  assert.ok((st.line[19] as number) < bars[19].c);
  const up = seriesValues({ kind: 'STU', a: 3, b: 1 }, bars), dn = seriesValues({ kind: 'STD', a: 3, b: 1 }, bars);
  for (let i = 0; i < bars.length; i++) assert.ok(up[i] == null || dn[i] == null);   // never both
});

// ── header numbers ────────────────────────────────────────────────────────────
test('PVol and Float %', () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(bar(i, 1, 1, 1, 1, i === 30 ? 1000 : 100));
  bars.push(bar(60, 1, 1, 1, 1, 250));
  assert.equal(peakVolumePct(bars), 25);             // 250 ÷ the 50-day high of 1000
  assert.equal(peakVolumePct(bars.slice(0, 1)), null);
  assert.equal(headerStats(bars).pvol, 25);
  assert.equal(floatPct({ floatShares: 80, sharesOut: 100 }), 80);
  assert.equal(floatPct({ pct: 64.2 }), 64.2);
  assert.equal(floatPct({ promoterPct: 72.5 }), 27.5);
  assert.equal(floatPct({ pct: 140 }), null);
  assert.equal(floatPct({}), null);
});

test('Ext column: only during the pre-market or after-hours session', () => {
  const meta = { regularMarketPrice: 100, fulldayPrice: 102, currentTradingPeriod: { pre: { start: 1000, end: 2000 }, regular: { start: 2000, end: 3000 }, post: { start: 3000, end: 4000 } } };
  assert.equal(extendedHoursPct(meta, 1500 * 1000), 2);
  assert.equal(extendedHoursPct(meta, 3500 * 1000), 2);
  assert.equal(extendedHoursPct(meta, 2500 * 1000), null);   // regular session: blank
  assert.equal(extendedHoursPct({ regularMarketPrice: 100 }, 1500 * 1000), null);
});
