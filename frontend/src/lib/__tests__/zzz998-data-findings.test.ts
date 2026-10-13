// zzz998 — four data findings from the owner's tester:
//  1. resolveUsQuote needs stronger evidence before calling a Nasdaq quote "a session behind" (change % must be the previous
//     session's, prev2Close known, never during the US session);
//  2. weekly / monthly tag length carries its unit (`lu`), and tagLengthText() words it;
//  3. W / M scans keep their own close (`scanW.px` / `scanM.px`), tagScanClose() picks the right one, W / M lean tags carry `dq`;
//  4. aggregation and validation count repaired / rejected daily bars (`rep` / `rej`); > 5% rejected → 'invalid-data'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBars } from '../bar-aggregate';
import type { PBar } from '../chart-patterns';
import { techFigures, usSessionOpen, type DailyBars } from '../screener/tech';
import { usSessionOpen as usSessionOpenBuild } from '../screener/us-build';
import {
  resolveUsQuote, tagLengthText, tagScanClose, techEntry, rowPatternFields, leanRows, periodPatternsFromBars, patternsFromBars,
  SCAN_MAX_REJECT_SHARE, type ScreenPatternTag,
} from '../screener/pine';
import type { ScreenRow } from '../screener/types';

const AFTER_HOURS = new Date('2026-10-13T02:00:00Z');   // Mon 12 Oct 22:00 New York
const IN_SESSION = new Date('2026-10-13T15:00:00Z');    // Tue 13 Oct 11:00 New York

// ── 1. stale-quote evidence ─────────────────────────────────────────────────────────────────────────────────────────────
// bars: …, 9 Oct 12.96 (prev2), 10 Oct 13.74 (prev, +6.02%), 12 Oct 12.93 (last, −5.90%)
const TF = { close: 12.93, prevClose: 13.74, prev2Close: 12.96, scanPx: 12.93, scanAt: '2026-10-12' };

test('zzz998 #1 a stale Nasdaq quote (price AND change % of the previous session) is replaced', () => {
  const r = resolveUsQuote({ px: 13.74, chg: 6.02 }, TF, AFTER_HOURS);
  assert.equal(r.px, 12.93); assert.equal(r.pxAlt, 13.74); assert.equal(r.chg, -5.9); assert.equal(r.at, '2026-10-12');
  assert.match(r.src, /session behind/);
  assert.ok(Math.abs(r.mcScale - 12.93 / 13.74) < 1e-12);
});

test('zzz998 #1 a current quote that merely equals yesterday\'s close is kept (its change % is not the previous session\'s)', () => {
  // a newer session than the bars whose close happens to equal the previous bar's: change vs the last bar, not vs prev2
  const chgNow = Math.round((13.74 / 12.93 - 1) * 10000) / 100;   // +6.26
  const r = resolveUsQuote({ px: 13.74, chg: chgNow }, TF, AFTER_HOURS);
  assert.equal(r.px, 13.74); assert.equal(r.src, 'nasdaq'); assert.equal(r.pxAlt, undefined); assert.equal(r.mcScale, 1);
  // change 0.1 point away from the previous session's (outside the 0.05 tolerance) → kept
  assert.equal(resolveUsQuote({ px: 13.74, chg: 6.12 }, TF, AFTER_HOURS).src, 'nasdaq');
  // within the tolerance → replaced
  assert.equal(resolveUsQuote({ px: 13.74, chg: 6.06 }, TF, AFTER_HOURS).px, 12.93);
});

test('zzz998 #1 missing chg / missing prev2Close / during the US session → the Nasdaq quote is kept', () => {
  assert.equal(resolveUsQuote({ px: 13.74, chg: null }, TF, AFTER_HOURS).src, 'nasdaq');
  assert.equal(resolveUsQuote({ px: 13.74, chg: 6.02 }, { ...TF, prev2Close: undefined }, AFTER_HOURS).src, 'nasdaq');
  assert.equal(resolveUsQuote({ px: 13.74, chg: 6.02 }, { ...TF, prev2Close: null }, AFTER_HOURS).src, 'nasdaq');
  const live = resolveUsQuote({ px: 13.74, chg: 6.02 }, TF, IN_SESSION);
  assert.equal(live.px, 13.74); assert.equal(live.src, 'nasdaq');
  assert.equal(usSessionOpen(IN_SESSION), true); assert.equal(usSessionOpen(AFTER_HOURS), false);
  assert.equal(usSessionOpenBuild, usSessionOpen, 'us-build re-exports the same helper');
});

test('zzz998 #1 techFigures keeps prev2Close (6 significant digits, like prevClose)', () => {
  const b: DailyBars = { d: ['2026-10-08', '2026-10-09', '2026-10-12'], o: [1, 1, 1], h: [2, 2, 2], l: [0.5, 0.5, 0.5], c: [0.123456789, 0.98765432, 1.5], v: [1, 1, 1] };
  const f = techFigures(b);
  assert.equal(f.prev2Close, 0.123457); assert.equal(f.prevClose, 0.987654); assert.equal(f.close, 1.5);
  assert.equal(techFigures({ d: ['2026-10-12'], o: [1], h: [1], l: [1], c: [1], v: [1] }).prev2Close, null);
});

// ── 2. tag length unit ──────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz998 #2 tagLengthText: daily days (weeks from 10 bars), weekly wk, monthly mo; old W / M tags read by tf', () => {
  assert.equal(tagLengthText({ l: 9 }), '9 d');
  assert.equal(tagLengthText({ l: 30 }), '6 wk');
  assert.equal(tagLengthText({ l: 6, lu: 'w', tf: 'W' }), '6 wk');
  assert.equal(tagLengthText({ l: 9, lu: 'm', tf: 'M' }), '9 mo');
  assert.equal(tagLengthText({ l: 12, tf: 'W' }), '12 wk', 'stored before lu: the tf decides');
  assert.equal(tagLengthText({ l: 12, tf: 'M' }), '12 mo');
  assert.equal(tagLengthText({}), ''); assert.equal(tagLengthText(null), '');
});

// ── fixtures for 2–4 ────────────────────────────────────────────────────────────────────────────────────────────────────
type Leg = [number, number, ('lin' | 'ease')?];
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
function longSeries(legs: Leg[], flat: number): DailyBars {
  const r = rng(7);
  const path: number[] = new Array(flat).fill(legs[0][1]);
  for (const [d, to, shape] of legs) {
    const from = path[path.length - 1];
    for (let k = 1; k <= d; k++) { const x = k / d; path.push(from + (to - from) * (shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x)); }
  }
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.UTC(2021, 0, 4), prev = path[0];
  for (let i = 0; i < path.length; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 0.006), o = prev;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(o); b.c.push(c); b.h.push(Math.max(o, c) * 1.004); b.l.push(Math.min(o, c) * 0.996);
    b.v.push(1e6 * (0.8 + 0.4 * r()));
    prev = c; t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return b;
}
const LONG = longSeries([[60, 60], [250, 100], [150, 72, 'ease'], [180, 98, 'ease'], [40, 92], [20, 95]], 100);
const AFTER = new Date(Date.parse(LONG.d[LONG.d.length - 1]) + 40 * 86_400_000);   // the last week / month is complete
const copy = (b: DailyBars): DailyBars => ({ d: b.d.slice(), o: b.o.slice(), h: b.h.slice(), l: b.l.slice(), c: b.c.slice(), v: b.v.slice() });

test('zzz998 #2 weekly / monthly tags carry lu; daily tags do not', () => {
  const e = techEntry(LONG, null, false, null, { now: AFTER });
  assert.ok(e.patW!.length, 'fixture has weekly patterns');
  assert.ok(e.patW!.every((t) => t.lu === 'w' && t.tf === 'W'));
  assert.ok(e.patM!.every((t) => t.lu === 'm' && t.tf === 'M'));
  assert.ok(e.pat!.every((t) => t.lu === undefined));
});

// ── 3. the timeframe's own close ────────────────────────────────────────────────────────────────────────────────────────
test('zzz998 #3 W / M scans keep the close of the last completed period; tagScanClose picks the tag\'s timeframe; W / M lean tags get dq', () => {
  // a week still open at `now`: the W scan stops at the previous Friday, the daily scan at the last bar
  const lastT = Date.parse(LONG.d[LONG.d.length - 1]);
  const midWeek = new Date(lastT + 12 * 3_600_000);   // same day, noon: that week (and month) are not complete
  const e = techEntry(LONG, null, false, null, { now: midWeek });
  const wEnd = e.scanW!.asOf!;
  assert.ok(wEnd < LONG.d[LONG.d.length - 1] || e.scanW!.st === 'insufficient-history', 'weekly reading lags the daily one');
  const wi = LONG.d.lastIndexOf(wEnd);
  assert.ok(wi >= 0);
  assert.equal(e.scanW!.px, Number(LONG.c[wi].toPrecision(6)), 'px = the close of the last completed week');
  assert.notEqual(e.scanW!.px, e.scanPx, 'and not the daily scan close');
  const mi = LONG.d.lastIndexOf(e.scanM!.asOf!);
  assert.equal(e.scanM!.px, Number(LONG.c[mi].toPrecision(6)));
  const row = { t: 'X', n: 'X', px: 120, scanPx: e.scanPx, scanAt: e.scanAt, ...rowPatternFields(e) } as ScreenRow;
  assert.deepEqual(tagScanClose(row, { tf: 'W' }), { px: e.scanW!.px, at: wEnd, tf: 'W' });
  assert.deepEqual(tagScanClose(row, { tf: 'M' }), { px: e.scanM!.px, at: e.scanM!.asOf, tf: 'M' });
  assert.deepEqual(tagScanClose(row, {}), { px: e.scanPx, at: e.scanAt, tf: 'D' });
  assert.deepEqual(tagScanClose({}, { tf: 'W' }), { px: null, at: null, tf: 'W' }, 'older entry: unknown, never the daily close');
  // W tags' d is measured from scanW.px
  const full = techEntry(LONG, null, false, null, { now: AFTER });
  for (const t of full.patW!) if (t.p && t.d != null && t.b === 'U') assert.ok(Math.abs(t.d - (full.scanW!.px! / t.p - 1) * 100) <= 0.1, `${t.id} d ${t.d}`);
  // lean rows: W / M tags carry dq from the latest quote like the daily ones; scanW keeps px
  const lr = leanRows([{ t: 'X', n: 'X', px: 120, ...rowPatternFields(full) } as ScreenRow]).rows[0] as any;
  assert.ok(lr.patW.length);
  for (const t of lr.patW as ScreenPatternTag[]) if (t.p) assert.equal(t.dq, Math.round((120 / t.p - 1) * 1000) / 10);
  assert.equal(lr.scanW.px, full.scanW!.px);
});

// ── 4. repaired / rejected counts ───────────────────────────────────────────────────────────────────────────────────────
const bar = (iso: string, o: number, h: number, l: number, c: number, v: number): PBar => ({ t: Date.parse(`${iso}T03:45:00Z`), o, h, l, c, v });

test('zzz998 #4 aggregateBars counts repaired and rejected daily bars (nothing mended silently)', () => {
  const daily = [
    bar('2026-03-02', 10, 11, 9, 10.5, 100),          // clean
    bar('2026-03-03', 10.5, 10, 9.5, 10.8, 100),       // high below close → repaired
    bar('2026-03-04', 0, 11, 10, 10.9, 100),           // no open → repaired
    bar('2026-03-05', 11, 11.5, 10.5, NaN, 100),       // no close → rejected
    bar('2026-03-06', Infinity, 12, 10, 11, 100),      // infinite open → rejected (same rule as cleanBars)
    bar('2026-03-06', 11, 12, 10, 11, 100),            // clean
    bar('2026-03-06', 11, 12, 10, 11, 100),            // same time again → rejected
  ];
  const r = aggregateBars(daily, 'W', { now: new Date(Date.UTC(2035, 0, 1)) });
  assert.equal(r.repaired, 2); assert.equal(r.rejected, 3); assert.equal(r.skipped, 3); assert.equal(r.supplied, 7);
  assert.equal(r.bars.length, 1); assert.equal(r.bars[0].h, 12); assert.ok(r.bars[0].h >= 10.8);
  const clean = aggregateBars([daily[0], daily[5]], 'W', { now: new Date(Date.UTC(2035, 0, 1)) });
  assert.equal(clean.repaired, 0); assert.equal(clean.rejected, 0);
});

test('zzz998 #4 scans carry rep / rej; more than 5% of daily bars rejected → invalid-data (D, W and M)', () => {
  assert.equal(SCAN_MAX_REJECT_SHARE, 0.05);
  // a few repairs, a few rejections (well under 5%)
  const some = copy(LONG);
  for (const i of [100, 200, 300]) some.h[i] = some.c[i] * 0.9;   // high below close → repaired
  for (const i of [150, 250]) some.c[i] = NaN;                    // no close → rejected
  const w = periodPatternsFromBars(some, 'W', null, AFTER);
  assert.equal(w.scan.rep, 3); assert.equal(w.scan.rej, 2); assert.notEqual(w.scan.st, 'invalid-data');
  const m = periodPatternsFromBars(some, 'M', null, AFTER);
  assert.equal(m.scan.rep, 3); assert.equal(m.scan.rej, 2);
  const d = patternsFromBars(some, null);
  assert.equal(d.scan.rep, 3); assert.equal(d.scan.rej, 2); assert.notEqual(d.scan.st, 'invalid-data');
  // clean data: no rep / rej keys at all
  const c = periodPatternsFromBars(LONG, 'W', null, AFTER);
  assert.equal(c.scan.rep, undefined); assert.equal(c.scan.rej, undefined);
  // > 5% rejected: every timeframe is invalid-data, no tags, no patAt
  const bad = copy(LONG);
  const k = Math.ceil(bad.c.length * 0.06);
  for (let i = 0; i < k; i++) bad.c[10 + i * 7] = NaN;
  const bw = periodPatternsFromBars(bad, 'W', null, AFTER), bm = periodPatternsFromBars(bad, 'M', null, AFTER), bd = patternsFromBars(bad, null);
  for (const x of [bw, bm, bd]) { assert.equal(x.scan.st, 'invalid-data'); assert.equal(x.pat.length, 0); assert.equal(x.scan.rej, k); }
  assert.equal(bd.patAt, null);
  // carried through techEntry → row
  const e = techEntry(some, null, false, null, { now: AFTER });
  const row = rowPatternFields(e);
  assert.equal(row.scanW!.rep, 3); assert.equal(row.scanM!.rej, 2); assert.equal(row.scan!.rej, 2);
});
