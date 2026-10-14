// zzz987 — Stage Analysis (TheWrap method): weekly resample, the stage state machine (1 → 2 → 3 → 4 → 1), SATA, Mansfield RS,
// the screener fields / presets and the chart's per-bar mapping. Synthetic series only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weeklyBars, weeklyFromTimed, weekKey, benchWeekly, mansfieldRs, stageAnalysis, stageFromDaily, stageHeadline, readingsForBars,
  SATA_LABELS, STAGE_TOOLTIP, type WeekBar,
} from '../stage-analysis';
import { tvFigures } from '../screener/tv-screens';
import { techEntry, rowTvFields, LEAN_KEYS, OPTIONAL_COLS, PATTERN_SCAN_VERSION } from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { fieldOf, passes } from '../screener/filters';
import type { ScreenRow } from '../screener/types';

const MON0 = Date.UTC(2020, 0, 6);   // a Monday
const wkIso = (i: number) => new Date(MON0 + i * 7 * 86_400_000).toISOString().slice(0, 10);

/** base 60 wks → advance 30 → chop 40 (the top) → dip 3 → decline 25 → base 30 (zzz1023: Weinstein's rules need a top and a
 *  base long enough for the 30-week average to flatten) */
function cyclePath(): number[] {
  const path: number[] = [];
  for (let i = 0; i < 60; i++) path.push(i % 2 ? 101 : 99);
  let p = 100; for (let i = 0; i < 30; i++) { p *= 1.02; path.push(p); }
  for (let i = 0; i < 40; i++) path.push(i % 2 ? 182 : 168);
  for (let i = 0; i < 3; i++) path.push(171);
  p = 171; for (let i = 0; i < 25; i++) { p *= 0.96; path.push(p); }
  for (let i = 0; i < 30; i++) path.push(i % 2 ? 66 : 64);
  return path;
}
const toWeeks = (path: number[]): WeekBar[] => path.map((c, i) => ({ wk: wkIso(i), o: c, h: c * 1.01, l: c * 0.99, c, v: i > 0 && c > path[i - 1] ? 2e6 : 1e6 }));
const flatBench = (n: number) => new Map(Array.from({ length: n }, (_, i) => [wkIso(i), 1000] as [string, number]));
/** Five daily bars per week (Mon–Fri) ending on the week's close. */
function dailyOf(path: number[]) {
  const d: string[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  path.forEach((close, w) => {
    const prev = w ? path[w - 1] : close;
    for (let k = 0; k < 5; k++) {
      const x = prev + ((close - prev) * (k + 1)) / 5;
      d.push(new Date(MON0 + (w * 7 + k) * 86_400_000).toISOString().slice(0, 10));
      o.push(x); h.push(x * 1.005); l.push(x * 0.995); c.push(x); v.push(close > prev ? 400_000 : 200_000);
    }
  });
  return { d, o, h, l, c, v };
}

test('zzz987 weekly resample: ISO weeks, first open / extremes / last close / summed volume', () => {
  assert.equal(weekKey('2026-10-12'), '2026-10-12');   // Monday
  assert.equal(weekKey('2026-10-18'), '2026-10-12');   // Sunday → same week
  const w = weeklyBars({ d: ['2026-10-12', '2026-10-13', '2026-10-16', '2026-10-19'], o: [10, 11, 12, 13], h: [11, 14, 13, 14], l: [9, 10, 8, 12], c: [10.5, 12, 11, 13.5], v: [1, 2, 3, 4] });
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { wk: '2026-10-12', o: 10, h: 14, l: 8, c: 11, v: 6 });
  assert.equal(w[1].c, 13.5);
  const t = weeklyFromTimed([{ t: Date.parse('2026-10-12T00:00:00Z'), o: 1, h: 2, l: 1, c: 2, v: 5 }, { t: Date.parse('2026-10-14T00:00:00Z'), o: 2, h: 3, l: 2, c: 3, v: 5 }]);
  assert.deepEqual(t, [{ wk: '2026-10-12', o: 1, h: 3, l: 1, c: 3, v: 10 }]);
});

test('zzz987 / zzz1023 state machine: base (1) → Stage 2 → Stage 3 → Stage 4 → Stage 1, each holding until a confirmed change', () => {
  const path = cyclePath();
  const r = stageAnalysis(toWeeks(path), flatBench(path.length));
  const st = r.weeks.map((w) => w.stage);
  // zzz1023 — the stage needs the 30-week average and its 5-week slope (34 weeks); SATA still needs the 40-week average
  assert.equal(st[32], null); assert.equal(r.weeks[38].sata, null);
  assert.ok(st.slice(34, 60).every((s) => s === 1), 'the flat base reads Stage 1');
  // the first close above the base: Stage 2 (confirmed by the next close, dated to the breakout week)
  assert.equal(st[60], 2); assert.ok(r.weeks[60].sata! >= 6); assert.equal(r.weeks[60].weeks, 1);
  assert.equal(r.weeks[60].level, 101, 'the base high broken');
  assert.ok(st.slice(60, 106).every((s) => s === 2), 'Stage 2 persists through the advance and the start of the chop');
  assert.equal(r.weeks[89].weeks, 30);
  // topping: the 30-week average stops rising and price swings around it
  const s3 = st.indexOf(3);
  assert.ok(s3 > 106 && s3 < 133, `stage 3 at ${s3}`);
  assert.notEqual(r.weeks[s3].slope, 'rising');
  // breakdown: Stage 4 below the range and the average
  const s4 = st.indexOf(4);
  assert.ok(s4 > s3); assert.ok(r.weeks[s4].c < r.weeks[s4].lo13!); assert.ok(r.weeks[s4].c < r.weeks[s4].ma30!);
  // the post-decline base: Stage 1 again
  const s1 = st.lastIndexOf(4) + 1;
  assert.equal(st[s1], 1); assert.ok(s1 > 160, `stage 1 at ${s1}`);
  assert.equal(r.last!.stage, 1); assert.equal(r.last!.weeks, path.length - s1);
  assert.deepEqual(r.changes!.map((c) => c.to), [1, 2, 3, 4, 1]);
  // SATA is the count of its ten parts
  for (const w of r.weeks) if (w.sata != null) assert.equal(w.sata, w.comps.filter(Boolean).length);
  assert.equal(SATA_LABELS.length, 10);
});

test('zzz987 / zzz1023 a flat series is a base (Stage 1) and never reads Stage 3 without a Stage 2 first', () => {
  const path = Array.from({ length: 70 }, (_, i) => (i % 2 ? 101 : 99));
  const r = stageAnalysis(toWeeks(path), flatBench(70));
  assert.ok(r.weeks.every((w) => w.stage == null || w.stage === 1));
});

test('zzz987 Stage 4 directly from a top (no Stage 3 needed)', () => {
  const path: number[] = [];
  for (let i = 0; i < 60; i++) path.push(i % 2 ? 101 : 99);
  let p = 100; for (let i = 0; i < 20; i++) { p *= 0.95; path.push(p); }
  const r = stageAnalysis(toWeeks(path), flatBench(path.length));
  const s4 = r.weeks.findIndex((w) => w.stage === 4);
  assert.ok(s4 >= 60 && s4 < 66, `breakdown at ${s4}`);
  assert.equal(r.last!.stage, 4);
  assert.ok(r.last!.mrs! < 0);
});

test('zzz987 Mansfield RS: ((stock ÷ index) ÷ SMA52 − 1) × 100; flat ratio → 0, no index → null', () => {
  const n = 60;
  const weeks = Array.from({ length: n }, (_, i) => ({ wk: wkIso(i), o: 1, h: 1, l: 1, c: 100 * 1.01 ** i, v: 1 }));
  const same = new Map(weeks.map((w) => [w.wk, w.c * 10] as [string, number]));
  const m0 = mansfieldRs(weeks, same);
  assert.equal(m0[50], null); assert.equal(m0[51], 0); assert.equal(m0[n - 1], 0);
  const flat = mansfieldRs(weeks, flatBench(n));
  // by hand for the last week: ratio_i = c_i / 1000, SMA of the last 52 ratios
  let s = 0; for (let i = n - 52; i < n; i++) s += weeks[i].c / 1000;
  const want = Math.round(((weeks[n - 1].c / 1000) / (s / 52) - 1) * 1000) / 10;
  assert.equal(flat[n - 1], want); assert.ok(want > 0);
  assert.deepEqual(mansfieldRs(weeks, null), weeks.map(() => null));
  // a missing index week takes the previous weekly close
  const gappy = new Map(flatBench(n)); gappy.delete(wkIso(55));
  assert.equal(mansfieldRs(weeks, gappy)[55], flat[55]);
  // without an index the two RS points of SATA score 0
  const r = stageAnalysis(toWeeks(cyclePath()), null);
  for (const w of r.weeks) { assert.equal(w.comps[6], false); assert.equal(w.comps[7], false); assert.equal(w.mrs, null); }
});

test('zzz987 from daily bars: resample + reading; benchmark weekly closes', () => {
  const path = cyclePath();
  const daily = dailyOf(path);
  const bench = benchWeekly(daily.d, daily.d.map(() => 500));
  assert.equal(bench.size, path.length);
  const last = stageFromDaily(daily, bench)!;
  assert.equal(last.stage, 1);
  assert.equal(stageAnalysis(weeklyBars(daily), bench).weeks.length, path.length);
  assert.match(stageHeadline(last), /^Stage 1 · Basing · since \d+ \w{3} \d{4} \(\d+ weeks?\) · 30-wk MA (rising|flat|falling) · RS [+−]?\d+ · price /);
  assert.equal(stageHeadline({ ...last, stage: 2, sub: 'A', since: '2026-08-10', slope: 'rising', sata: 7, mrs: 12.44, vsMa: 8.2, weeks: 9, pending: null }), 'Stage 2 · Advancing · since 10 Aug 2026 (9 weeks) · 30-wk MA rising · RS +12 · price 8% above MA');
  assert.match(stageHeadline(null), /not enough weekly history/);
  assert.match(STAGE_TOOLTIP, /TheWrap/); assert.match(STAGE_TOOLTIP, /Not the original script/);
});

test('zzz987 chart mapping: daily bars get their own week, weekly their week, monthly the month\'s last week', () => {
  const weeks = [{ wk: '2026-09-28' }, { wk: '2026-10-05' }, { wk: '2026-10-12' }];
  const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const daily = ['2026-09-25', '2026-09-28', '2026-10-02', '2026-10-05', '2026-10-09', '2026-10-12', '2026-10-13'].map(t);
  assert.deepEqual(readingsForBars(daily, weeks, (k) => k), [null, 0, 0, 1, 1, 2, 2]);
  assert.deepEqual(readingsForBars(['2026-09-28', '2026-10-05', '2026-10-12'].map(t), weeks, (k) => k), [0, 1, 2]);
  assert.deepEqual(readingsForBars(['2026-09-01', '2026-10-01'].map(t), weeks, (k) => k), [0, 2]);
});

test('zzz987 screener: techEntry / tvFigures carry the fields, rows get them, filters and presets work', () => {
  const daily = dailyOf(cyclePath());
  const bench = benchWeekly(daily.d, daily.d.map(() => 500));
  const tv = tvFigures(daily, bench);
  assert.equal(tv.twSt, 1); assert.ok(tv.sata! >= 0 && tv.sata! <= 10); assert.ok(tv.twWk! >= 1); assert.ok(typeof tv.mrs === 'number');
  assert.equal(tvFigures(daily).mrs, null, 'no index → no Mansfield RS');
  assert.ok(PATTERN_SCAN_VERSION >= 3, 'scan version bumped so stored entries are re-read');
  const tf = techEntry(daily, null, false, bench);
  const row = rowTvFields(tf, 'US');
  assert.equal(row.twSt, 1); assert.equal(row.sata, tv.sata); assert.equal(row.twWk, tv.twWk); assert.equal(row.mrs, tv.mrs);
  for (const k of ['twSt', 'sata', 'mrs', 'twWk']) {
    assert.ok(fieldOf(k), `${k} in FIELDS`);
    assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${k} sent to the Pine Screener`);
    assert.ok((OPTIONAL_COLS as readonly string[]).includes(k), `${k} can be a column`);
  }
  const byId = new Map(BUILT_IN_PINE_SCREENS.map((s) => [s.id, s]));
  const rowOf = (x: Partial<ScreenRow>) => ({ t: 'X', ...x }) as ScreenRow;
  const ok = (id: string, r: ScreenRow) => byId.get(id)!.q.filters.every((f) => passes(r, f));
  assert.ok(ok('tw-stage2-sata6', rowOf({ twSt: 2, sata: 6 }))); assert.ok(!ok('tw-stage2-sata6', rowOf({ twSt: 2, sata: 5 })));
  assert.ok(ok('tw-fresh-stage2', rowOf({ twSt: 2, twWk: 4 }))); assert.ok(!ok('tw-fresh-stage2', rowOf({ twSt: 2, twWk: 5 })));
  assert.ok(ok('tw-stage4-sata3', rowOf({ twSt: 4, sata: 3 }))); assert.ok(!ok('tw-stage4-sata3', rowOf({ twSt: 3, sata: 1 })));
  assert.ok(ok('tw-stage1-bases', rowOf({ twSt: 1 }))); assert.ok(!ok('tw-stage1-bases', rowOf({})));
  for (const id of ['tw-stage2-sata6', 'tw-fresh-stage2', 'tw-stage4-sata3', 'tw-stage1-bases']) {
    const s = byId.get(id)!;
    assert.equal(s.group, 'tv'); assert.match(s.name, /TheWrap method/); assert.match(s.note || '', /not the original script/);
  }
});

test('zzz987 chart indicator: on/off in the layout, index per market, per-candle points, banner', async () => {
  const { stageOn, withStage, benchmarkOf, benchmarkUrl, stageFromCharts, stagePointsFor, stageBanner, STAGE_COLOR } = await import('../../components/charts/stage-view');
  const { cleanLayout, legendRows, EXTRA_INFO } = await import('../chart-layouts');
  const base = cleanLayout({ name: 'L', lines: [], extras: [] });
  assert.equal(stageOn(base), false);
  const on = withStage(base, true);
  assert.equal(stageOn(on), true); assert.equal(stageOn(cleanLayout(on)), true, 'survives the layout clean-up');
  assert.equal(legendRows(on).length, 0, 'no legend row (its own status line)');
  assert.equal(stageOn(withStage(on, false)), false);
  assert.match(EXTRA_INFO.STG.label, /TheWrap method/);
  assert.equal(benchmarkOf('US').name, 'S&P 500'); assert.equal(benchmarkOf('IN').name, 'Nifty 50');
  assert.match(benchmarkUrl('US'), /\/api\/v1\/chart\/SPX\?market=US&interval=1d/);
  assert.match(benchmarkUrl('IN'), /\/api\/v1\/chart\/NIFTY\?market=IN&interval=1d/);
  const path = cyclePath();
  const daily = dailyOf(path);
  const timed = daily.d.map((d, i) => ({ t: Date.parse(`${d}T00:00:00Z`), o: daily.o[i], h: daily.h[i], l: daily.l[i], c: daily.c[i], v: daily.v[i] }));
  const benchTimed = timed.map((b) => ({ ...b, o: 500, h: 500, l: 500, c: 500 }));
  const r = stageFromCharts(timed, benchTimed);
  assert.equal(r.last!.stage, 1);
  const pts = stagePointsFor(timed.map((b) => b.t), r);
  assert.equal(pts.length, timed.length);
  assert.equal(pts[0][1], 0, 'no stage before the first reading');
  assert.equal(pts[pts.length - 1][1], 1); assert.equal(typeof pts[pts.length - 1][2], 'number');
  assert.equal(pts[60 * 5][1], 2, 'the breakout week is green on every day of it');
  assert.equal(stageFromCharts(timed, null).last!.mrs, null);
  const b = stageBanner('ready', r.last, true);
  assert.match(b.text, /^Stage 1 · Basing/); assert.equal(b.color, STAGE_COLOR[1]);
  assert.match(stageBanner('ready', r.last, false).text, /index not loaded \(no RS\)/);
  assert.match(stageBanner('loading', null, false).text, /reading/);
  // zzz1023 — four calm, distinct stage colours (1 blue-grey, 2 green, 3 amber, 4 red)
  assert.equal(new Set([1, 2, 3, 4].map((k) => STAGE_COLOR[k as 1])).size, 4);
});
