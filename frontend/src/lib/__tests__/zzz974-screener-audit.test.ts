import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tvSectorOf, tvSectorMapping } from '../screener/tv-sectors';
import { closeConfirmed, makeShortlist, diffShortlist, ratioCause, membership, explainRow } from '../screener/research';
import { passes, runScreen, cleanScreens, type Filter } from '../screener/filters';
import { findInResults, setReviewState, cleanReviewStates, cleanView } from '../screener/workflow';

const row = (o: any) => ({ t: 'X', n: 'X Ltd', sec: null, ind: null, px: 100, chg: 0, vol: 1, avgVol10: 1, mc: 1000, sma50: null, sma200: null, revQYoY: null, revAYoY: null, gpQYoY: null, gmFY: null, ebitdaQoQ: null, ebitdaAYoY: null, epsQYoY: null, opmTTM: null, ps: 10, evRev: 11, de: null, cash: null, emp: null, flt: null, bb: null, fs: null, q: null, ...o });

test('N-01 RAMCOIND is Non-Energy Minerals, not Technology Services; checked companies carry their own sector', () => {
  assert.equal(tvSectorOf('IN', 'Construction Materials', 'Other Construction Materials', 'RAMCOIND'), 'Non-Energy Minerals');
  assert.equal(tvSectorOf('IN', 'Construction Materials', 'Other Construction Materials', 'SAHYADRI'), 'Non-Energy Minerals');
  assert.equal(tvSectorOf('IN', 'Construction Materials', 'Other Construction Materials', 'ARIS'), 'Technology Services');
  assert.equal(tvSectorMapping('IN', 'Construction Materials', 'Other Construction Materials', 'RAMCOIND').basis, 'checked');
  assert.equal(tvSectorMapping('IN', 'Construction Materials', 'Other Construction Materials', 'BIRLANU').basis, 'industry');
  assert.equal(tvSectorMapping('IN', null, null).sector, null);
  // unrelated mappings unchanged
  assert.equal(tvSectorOf('IN', 'Construction Materials', 'Cement & Cement Products'), 'Non-Energy Minerals');
  assert.equal(tvSectorOf('IN', 'Information Technology', 'Computers - Software & Consulting') ?? 'Technology Services', 'Technology Services');
  const sectorRule: Filter = { kind: 'sector', sectors: ['Technology Services', 'Electronic Technology', 'Health Technology'] };
  const ramco = row({ t: 'RAMCOIND', sec: 'Construction Materials', ind: 'Other Construction Materials', tvSec: tvSectorOf('IN', 'Construction Materials', 'Other Construction Materials', 'RAMCOIND') });
  assert.equal(passes(ramco as any, sectorRule), false);
});

test('N-02 completed-session mode re-works price-based valuations at the close', () => {
  const r = closeConfirmed(row({ px: 100, mc: 1000, ps: 10, pe: 20, pcf: 5, evRev: 11, cc: { px: 80 } }) as any) as any;
  assert.equal(r.px, 80);
  assert.equal(r.mc, 800);
  assert.equal(r.ps, 8);
  assert.equal(r.pe, 16);
  assert.equal(r.pcf, 4);
  assert.equal(r.evRev, 9);   // EV/rev 11 → cap falls 200 on revenue 100 → 9
  assert.equal(r.ccBasis, 'scaled');
  const split = closeConfirmed(row({ px: 100, mc: 1000, ps: 10, cc: { px: 20 } }) as any) as any;
  assert.equal(split.mc, null); assert.equal(split.ps, null); assert.equal(split.ccBasis, 'unavailable');
  const same = closeConfirmed(row({ px: 100, mc: 1000, cc: { px: 100, sma50: 90 } }) as any) as any;
  assert.equal(same.mc, 1000); assert.equal(same.sma50, 90);
  // exact-only exclusions survive
  const ax = closeConfirmed(row({ px: 100, evRev: 11, ps: 10, approx: ['evRev'], cc: { px: 90 } }) as any);
  assert.equal(passes(ax, { kind: 'num', key: 'evRev', op: 'lt', v: 100 }, new Date(), true), false);
});

test('N-03 an unchanged result of 1,001 or 4,000 companies has no entrants or exits', () => {
  for (const n of [1001, 4000]) {
    const rows = Array.from({ length: n }, (_, i) => row({ t: `T${i}`, n: `Co ${i}` }));
    const sl = makeShortlist({ name: 'x', market: 'US', screenId: 's', screenName: 's', filters: [], exactOnly: false, closeOnly: false, snapshotBuiltAt: null }, rows as any, ['px']);
    assert.equal(sl.rows.length, 1000); assert.equal(sl.all!.length, n); assert.equal(sl.total, n);
    const d = diffShortlist(sl, rows as any, rows as any, 'US');
    assert.equal(d.entered.length, 0); assert.equal(d.exited.length, 0); assert.equal(d.stayed, n); assert.equal(d.complete, true);
  }
  // an older shortlist cut at 1,000 does not invent entrants
  const legacy: any = { id: 'a', name: 'a', savedAt: '', market: 'US', screenId: 's', screenName: 's', filters: [], exactOnly: false, closeOnly: false, snapshotBuiltAt: null, formulaVersion: '2026.10.12b', rows: Array.from({ length: 1000 }, (_, i) => ({ t: `T${i}`, n: '', v: {} })) };
  assert.equal(membership(legacy).complete, false);
  const now = Array.from({ length: 1001 }, (_, i) => row({ t: `T${i}` }));
  assert.equal(diffShortlist(legacy, now as any, now as any, 'US').entered.length, 0);
});

test('N-04 a denominator-only change is never called price movement', () => {
  assert.match(ratioCause('ps', 1, 2, 50, 50), /price unchanged/);
  assert.doesNotMatch(ratioCause('ps', 1, 2, 50, 50), /price movement/);
  assert.match(ratioCause('ps', 1, 2, 50, 100), /price movement/);
  assert.match(ratioCause('ps', 1, 3, 50, 100), /both changed/);
  assert.match(ratioCause('ps', 1, 2, null, 100), /not established/);
  const sl = makeShortlist({ name: 'x', market: 'US', screenId: 's', screenName: 's', filters: [{ kind: 'num', key: 'ps', op: 'lt', v: 1.5 }], exactOnly: false, closeOnly: false, snapshotBuiltAt: null }, [row({ t: 'A', px: 50, mc: 100, ps: 1 })] as any, ['ps']);
  const cur = [row({ t: 'A', px: 50, mc: 100, ps: 2 })];
  const d = diffShortlist(sl, cur as any, [], 'US');
  assert.equal(d.exited.length, 1);
  assert.doesNotMatch(d.exited[0].why, /price movement/);
});

test('paused rules are kept but not applied; saved screens keep the pause', () => {
  const f: Filter = { kind: 'num', key: 'px', op: 'gt', v: 1000, off: true };
  const rows = [row({ t: 'A' })];
  assert.equal(runScreen(rows as any, [f]).length, 1);
  assert.equal(runScreen(rows as any, [{ ...f, off: false }]).length, 0);
  assert.equal(cleanScreens([{ id: 'a', name: 'a', market: 'US', filters: [f] }])[0].filters[0].off, true);
  assert.equal(cleanScreens([{ id: 'a', name: 'a', market: 'US', filters: [{ ...f, off: undefined }] }])[0].filters[0].off, undefined);
  assert.match(explainRow(rows[0] as any, [f], 'US')[0].detail, /paused/);
});

test('find in results, review states and the remembered view', () => {
  const rows = [{ t: 'RELIANCE', n: 'Reliance Industries' }, { t: 'TCS', n: 'Tata Consultancy' }];
  assert.deepEqual(findInResults(rows, 'reliance').map((r) => r.t), ['RELIANCE']);
  assert.deepEqual(findInResults(rows, 'NSE:TCS').map((r) => r.t), ['TCS']);
  assert.equal(findInResults(rows, '').length, 2);
  let st = setReviewState({}, 'IN', 'tcs', 'chart');
  assert.equal(st['IN:TCS'], 'chart');
  st = setReviewState(st, 'IN', 'TCS', 'unreviewed');
  assert.equal(st['IN:TCS'], undefined);
  assert.deepEqual(cleanReviewStates({ 'IN:TCS': 'parked', bad: 'chart', 'US:X': 'nope' }), { 'IN:TCS': 'parked' });
  assert.deepEqual(cleanView({ sort: { key: 'epsQYoY', dir: -1 }, scrollY: 400, junk: 1 }), { sort: { key: 'epsQYoY', dir: -1 }, scrollY: 400 });
});
