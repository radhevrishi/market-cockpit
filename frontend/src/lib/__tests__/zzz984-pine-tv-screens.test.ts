// zzz984 — the owner's TradingView Pine Screener setups as screener fields: trend template, RSI vs its average, MA crosses,
// RS Rating, Weinstein stage, pocket pivots, swing data, Ripster clouds, FCF margin + Rule of 40; and the built-in screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DailyBars } from '../screener/tech';
import { smaOf } from '../screener/tech';
import {
  tvFigures, trendTemplate, weinsteinStage, pocketPivotAge, rsRatings, barsSinceCross, rsiSeries, smaSeries, emaSeries,
} from '../screener/tv-screens';
import { techEntry, rowTvFields, applyRsRating, ruleOf40, runPine, cleanQuery, LEAN_KEYS, OPTIONAL_COLS, PINE_GROUPS, DEFAULT_QUERY, PATTERN_SCAN_VERSION } from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { FIELDS, fieldOf, filterKeys, passes } from '../screener/filters';
import { inFiguresFromRaw } from '../screener/in-assemble';
import { FORMULA_VERSION, FORMULA_CHANGES } from '../screener/research';
import type { ScreenRow } from '../screener/types';

// ───────── synthetic daily bars from a list of closes (weekdays; high/low ±0.5%; volume per bar) ─────────
function bars(closes: number[], vol: (i: number) => number = () => 1_000_000): DailyBars {
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.UTC(2021, 0, 4);
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i], o = i ? closes[i - 1] : c;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(o); b.c.push(c);
    b.h.push(Math.max(o, c) * 1.005); b.l.push(Math.min(o, c) * 0.995); b.v.push(vol(i));
    t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return b;
}
const line = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);
const wiggle = (xs: number[], amp = 0.004) => xs.map((x, i) => x * (1 + amp * Math.sin(i * 1.7)));
const UP = wiggle([...line(100, 50, 50), ...line(300, 50, 150)]);            // steady advance over ~14 months
const DOWN = wiggle([...line(100, 150, 150), ...line(300, 150, 60)]);

test('zzz984 trend template: a steady advance passes all six rules; a decline and a 30% drawdown fail', () => {
  const up = trendTemplate(bars(UP))!;
  assert.deepEqual(up.rules, [true, true, true, true, true, true]);
  assert.equal(up.tt, 6); assert.equal(up.ttOk, 1);
  const dn = trendTemplate(bars(DOWN))!;
  assert.equal(dn.ttOk, 0); assert.ok(dn.tt <= 1, String(dn.tt));
  // advance, then a sharp 30% drop: c6 (close > 0.75 × 250-session high) and c1 fail
  const dd = trendTemplate(bars([...UP, ...line(15, 150, 105)]))!;
  assert.equal(dd.rules[5], false); assert.equal(dd.rules[0], false); assert.equal(dd.ttOk, 0);
  // too little history: the 250-session rules cannot pass (TradingView: na → false)
  const short = trendTemplate(bars(UP.slice(-240)))!;
  assert.equal(short.rules[4], false); assert.equal(short.rules[5], false);
  // c4: SMA 200 must rise on EACH of the last 20 sessions — after a long flat stretch it no longer does
  const flatEnd = trendTemplate(bars([...UP, ...line(220, 150, 150)]))!;
  assert.equal(flatEnd.rules[3], false);
  const fe = tvFigures(bars(UP));
  assert.equal(fe.tt, 6); assert.equal(fe.ttOk, 1);
});

test('zzz984 RSI script: average of RSI 14 and the cross above it', () => {
  const closes = [...wiggle(line(300, 100, 100), 0.01), ...line(30, 100, 70), 72, 75, 79];
  const b = bars(closes);
  const f = tvFigures(b);
  const rsi = rsiSeries(b.c, 14);
  const avg = rsi.slice(-14).reduce((a, x) => a + x, 0) / 14;
  assert.ok(Math.abs((f.rsiMA as number) - avg) < 0.01, `${f.rsiMA} vs ${avg}`);
  assert.ok(f.rsiX != null && f.rsiX >= 0 && f.rsiX <= 2, String(f.rsiX));
  const L = rsi.length - 1 - (f.rsiX as number);
  const ma = smaSeries(rsi.map((x) => (Number.isFinite(x) ? x : 0)), 14);
  assert.ok(rsi[L] > ma[L] && rsi[L - 1] <= ma[L - 1], 'it is a real cross');
  assert.equal(tvFigures(bars([...wiggle(line(300, 100, 100), 0.01), ...line(30, 100, 70)])).rsiX, null, 'still falling: no cross');
});

test('zzz984 MA Cross: golden cross (SMA 50 over 200), death cross and EMA 10/21', () => {
  let found = false;
  for (let n = 20; n <= 140 && !found; n += 2) {
    const closes = [...line(250, 120, 60), ...line(n, 60, 140)];
    const f = tvFigures(bars(closes));
    if (f.gcD == null) continue;
    found = true;
    const at = closes.length - f.gcD;
    assert.ok(smaOf(closes.slice(0, at), 50)! > smaOf(closes.slice(0, at), 200)!);
    assert.ok(smaOf(closes.slice(0, at - 1), 50)! <= smaOf(closes.slice(0, at - 1), 200)!);
    assert.ok(f.gcD >= 0 && f.gcD < 20);
    assert.equal(f.dcD, null);
  }
  assert.ok(found, 'a golden cross within 20 sessions for some rally length');
  let death = false;
  for (let n = 20; n <= 140 && !death; n += 2) { const f = tvFigures(bars([...line(250, 60, 120), ...line(n, 120, 40)])); if (f.dcD != null) { death = true; assert.equal(f.gcD, null); } }
  assert.ok(death);
  // EMA 10 over EMA 21 after a dip and a turn
  const e = tvFigures(bars([...line(300, 100, 100), ...line(30, 100, 80), ...line(8, 80, 92)]));
  assert.ok(e.emaXU != null && e.emaXU < 8, String(e.emaXU));
  const c = [...line(300, 100, 100), ...line(30, 100, 80), ...line(8, 80, 92)];
  const e10 = emaSeries(c, 10), e21 = emaSeries(c, 21), k = c.length - 1 - e.emaXU!;
  assert.ok(e10[k] > e21[k] && e10[k - 1] <= e21[k - 1]);
  assert.equal(barsSinceCross([1, 2, 3], [2, 2, 2], 1, 20), 0);
  assert.equal(barsSinceCross([1, 1, 3], [2, 2, 2], -1, 20), null);
});

test('zzz984 pocket pivot: up day with volume above every down day of the prior 10, above the 10/50-day averages', () => {
  const closes = wiggle([...line(100, 80, 80), ...line(100, 80, 120)], 0.01);
  const quiet = (_i: number) => 1_000_000;   // equal volume: no ordinary up day beats the down days
  const last = closes.length - 1;
  closes[last] = closes[last - 1] * 1.03;
  assert.equal(pocketPivotAge(bars(closes, (i) => (i === last ? 5_000_000 : quiet(i)))), 0);
  assert.equal(pocketPivotAge(bars(closes, (i) => (i === last ? 500_000 : quiet(i)))), null, 'volume too light');
  const two = closes.slice(); two.push(two[last] * 1.001, two[last] * 1.002);
  assert.equal(pocketPivotAge(bars(two, (i) => (i === last ? 5_000_000 : quiet(i)))), 2);
  const below = closes.map((x, i) => (i === last ? 60 : x));   // under its averages
  assert.equal(pocketPivotAge(bars(below, (i) => (i === last ? 5_000_000 : quiet(i)))), null);
});

test('zzz984 Weinstein stage: 2 in an advance, 4 in a decline, 1 → 2 out of a base', () => {
  const w = (xs: number[]) => xs;
  assert.equal(weinsteinStage(w(line(60, 50, 120))), 2);
  assert.equal(weinsteinStage(w(line(60, 120, 50))), 4);
  const base = [...line(40, 120, 60), ...wiggle(line(45, 60, 60), 0.01)];
  assert.equal(weinsteinStage(base), 1);
  const breakout = [...base, 64, 68, 72, 76];
  assert.equal(weinsteinStage(breakout), 2);
  assert.equal(weinsteinStage(line(20, 1, 2)), null, 'needs 34 weeks');
  assert.equal(weinsteinStage([...line(40, 60, 120), ...wiggle(line(45, 120, 120), 0.01)]), 3, 'flat after an advance');
  assert.equal(tvFigures(bars(UP)).stage, 2);
  assert.equal(tvFigures(bars(DOWN)).stage, 4);
});

test('zzz984 Ripster clouds and swing data', () => {
  assert.equal(tvFigures(bars(UP)).ripB, 1);
  assert.equal(tvFigures(bars(DOWN)).ripB, 0);
  const b = bars(line(100, 10, 10), (i) => (i === 99 ? 3000 : 1000));
  const f = tvFigures(b);
  assert.equal(f.rvol, 3);
  assert.equal(f.adv, Math.round((10 * 1000 * 19 + 10 * 3000) / 20));
});

test('zzz984 RS Rating: weighted performance ranked 1–99 within the market, ties share a rating', () => {
  const f = tvFigures(bars(UP));
  const c = UP, L = c.length - 1, roc = (k: number) => c[L] / c[L - k] - 1;
  assert.ok(Math.abs((f.rsRaw as number) - (0.4 * roc(63) + 0.2 * roc(126) + 0.2 * roc(189) + 0.2 * roc(252)) * 100) < 0.01);
  assert.equal(tvFigures(bars(UP.slice(-200))).rsRaw, null, 'needs 253 sessions');
  const r = rsRatings([{ t: 'A', v: -20 }, { t: 'B', v: 5 }, { t: 'C', v: 40 }, { t: 'D', v: 5 }, { t: 'E', v: null }, { t: 'F', v: 90 }]);
  assert.equal(r.get('A'), 1); assert.equal(r.get('F'), 99);
  assert.equal(r.get('B'), r.get('D'));
  assert.ok(r.get('A')! < r.get('B')! && r.get('B')! < r.get('C')! && r.get('C')! < r.get('F')!);
  assert.equal(r.has('E'), false);
  const rows = [{ t: 'A' }, { t: 'F' }, { t: 'X' }] as ScreenRow[];
  applyRsRating(rows, (t) => ({ A: 1, F: 50 } as Record<string, number>)[t]);
  assert.equal(rows[0].rsR, 1); assert.equal(rows[1].rsR, 99); assert.equal(rows[2].rsR, undefined);
});

test('zzz984 build path: techEntry carries the fields, rows get them (adv$ in the market unit), older entries none', () => {
  const tf = techEntry(bars(UP, () => 2_000_000), null, false);
  assert.ok(PATTERN_SCAN_VERSION >= 2);   // zzz987 bumped it to 3 (Stage Analysis); the zzz984 fields are carried from 2 on
  assert.equal(tf.patV, PATTERN_SCAN_VERSION); assert.equal(tf.tt, 6); assert.equal(tf.stage, 2); assert.equal(tf.ripB, 1);
  const us = rowTvFields(tf, 'US'), inr = rowTvFields(tf, 'IN');
  assert.equal(us.tt, 6); assert.equal(us.ttOk, 1); assert.equal(us.stage, 2);
  assert.ok(Math.abs((us['adv$'] as number) - tf.adv! / 1e6) < 0.01);
  assert.ok(Math.abs((inr['adv$'] as number) - tf.adv! / 1e7) < 0.01);
  assert.ok(!('rsRaw' in us), 'the raw RS figure stays out of the row (only the rating goes in)');
  assert.deepEqual(rowTvFields({ ...tf, patV: 1 }, 'US'), {});
  assert.deepEqual(rowTvFields(undefined, 'US'), {});
});

test('zzz984 Rule of 40: revenue growth + FCF margin; India FCF margin from the cash-flow lines (≈)', () => {
  assert.equal(ruleOf40(25, 18.2), 43.2);
  assert.equal(ruleOf40(null, 18), null);
  const T = (headers: string[], rows: Record<string, (number | null)[]>) => ({ headers, rows });
  const raw: any = {
    v: 2, name: 'X', sector: null, industry: null, bse: false, price: null, mcapCr: null, roce: null, cogsQ: {}, cogsA: {}, cash: {}, ann: [],
    T: {
      q: null, bs: null, r: null,
      a: T(['Mar 2025', 'Mar 2026'], { Sales: [100, 200], 'Operating Profit': [10, 30], 'Net Profit': [5, 15] }),
      cf: T(['Mar 2025', 'Mar 2026'], { 'Cash from Operating Activity': [8, 50], 'Cash from Investing Activity': [-4, -20] }),
    },
  };
  const f = inFiguresFromRaw(raw);
  assert.equal(f.fcfmFY, 15);
  assert.ok(f.approx.includes('fcfmTTM') && f.approx.includes('r40'));
  const old = inFiguresFromRaw({ ...raw, T: { ...raw.T, cf: T(['Mar 2026'], { 'Cash from Operating Activity': [50] }) } });
  assert.equal(old.fcfmFY ?? null, null, 'a page read before zzz984 kept no investing line: blank, not guessed');
});

test('zzz984 fields: every new field is labelled for the Stock Screener and sent to the Pine Screener', () => {
  const keys = ['tt', 'ttOk', 'rsR', 'rsiMA', 'rsiX', 'gcD', 'dcD', 'emaXU', 'emaXD', 'stage', 'st12', 'ppD', 'rvol', 'adv$', 'ripB', 'fcfmTTM', 'r40'];
  for (const k of keys) {
    assert.ok(fieldOf(k), `${k} in FIELDS`);
    assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${k} in LEAN_KEYS`);
    assert.ok((OPTIONAL_COLS as readonly string[]).includes(k) || ['ttOk', 'st12'].includes(k) || (OPTIONAL_COLS as readonly string[]).includes(k), `${k} can be a column`);
  }
  assert.equal(new Set(FIELDS.map((f) => f.key)).size, FIELDS.length, 'no duplicate field');
  for (const k of OPTIONAL_COLS) assert.ok(fieldOf(k) && (LEAN_KEYS as readonly string[]).includes(k), `optional column ${k}`);
  assert.ok(FORMULA_CHANGES[0].v === FORMULA_VERSION && FORMULA_VERSION >= '2026.10.12d');
  assert.equal(passes({ t: 'A', ttOk: 1 } as ScreenRow, { kind: 'num', key: 'ttOk', op: 'ge', v: 1 }), true);
  assert.equal(passes({ t: 'A' } as ScreenRow, { kind: 'num', key: 'rsiX', op: 'le', v: 9 }), false, 'no cross → fails');
});

test('zzz984 built-in screens: well formed, grouped, and the owner\'s scripts are there', () => {
  const byId = new Map(BUILT_IN_PINE_SCREENS.map((s) => [s.id, s]));
  assert.equal(byId.size, BUILT_IN_PINE_SCREENS.length, 'unique ids');
  const groups = new Set(PINE_GROUPS.map((g) => g.id));
  for (const s of BUILT_IN_PINE_SCREENS) {
    assert.ok(s.group && groups.has(s.group), `${s.id} has a group`);
    assert.deepEqual(cleanQuery(s.q), s.q, `${s.id} survives cleaning`);
    for (const f of s.q.filters) for (const k of filterKeys(f)) assert.ok((LEAN_KEYS as readonly string[]).includes(k) && fieldOf(k), `${s.id}: ${k}`);
    for (const k of s.q.cols) assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${s.id}: column ${k}`);
  }
  for (const id of ['tv-trend-template', 'tv-rule-of-40', 'tv-rsi-cross', 'tv-rsi-50', 'tv-golden-cross', 'tv-death-cross', 'tv-ema-cross-up']) assert.equal(byId.get(id)?.group, 'tv', id);
  for (const id of ['rs-80', 'stage-2', 'stage-1-2', 'pocket-pivot', 'ripster-bull', 'tt-bullish-base', 'rs80-stage2-forming']) assert.equal(byId.get(id)?.group, 'momentum', id);
  assert.equal(byId.get('all-bullish')?.group, 'patterns');
  assert.equal(byId.get('tv-trend-template')!.name, 'Minervini Trend Template (your script)');
  assert.equal(byId.get('tv-rule-of-40')!.name, 'Rule of 40 (your script)');
  assert.deepEqual(byId.get('tv-rule-of-40')!.q.cols, ['r40', 'revQYoY', 'fcfmTTM']);
  assert.ok(byId.get('minervini-vcp')!.q.filters.some((f) => f.kind === 'num' && f.key === 'ttOk'), 'Minervini VCP uses the trend-template script');
  assert.equal(byId.get('tt-bullish-base')!.q.need, 'pattern');
  // rules-only screens find companies without any pattern; pattern screens do not
  const rows = [
    { t: 'TT', n: 'TT', ttOk: 1, tt: 6, pat: [] },
    { t: 'TTP', n: 'TTP', ttOk: 1, tt: 6, pat: [{ id: 'vcp', b: 'U', s: 'f', c: 70, p: 10, d: -3 }] },
    { t: 'NO', n: 'NO', ttOk: 0, tt: 3, pat: [{ id: 'vcp', b: 'U', s: 'f', c: 70, p: 10, d: -3 }] },
  ] as unknown as ScreenRow[];
  const run = (id: string) => runPine(rows, byId.get(id)!.q, 'US').map((h) => h.row.t).sort();
  assert.deepEqual(run('tv-trend-template'), ['TT', 'TTP']);
  assert.deepEqual(run('minervini-vcp'), ['TTP']);
  assert.deepEqual(run('tt-bullish-base'), ['TTP']);
  assert.equal(runPine(rows, byId.get('tv-trend-template')!.q, 'US').find((h) => h.row.t === 'TT')!.best, null);
  assert.equal(cleanQuery({}).need, DEFAULT_QUERY.need);
  assert.deepEqual(cleanQuery({ cols: ['tt', 'nope', 'tt'] }).cols, ['tt']);
});
