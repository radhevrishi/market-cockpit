// zzz1046b — "Volume & accumulation (institutional footprint)" on /charts: the pure acc-view pieces (marks from the engine's
// series, chip text, completed candles only, W / M wording), the ACC overlay in SPECIAL_EXTRAS (not counted toward the limit),
// OBV as a regular indicator, and the wiring in the chart sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXTRA_INFO, EXTRA_TYPES, MAX_EXTRAS, SPECIAL_EXTRAS, addExtraBlockedReason, cleanLayout, cleanLayoutReport, droppedNote, legendRows, newExtra,
  regularExtraCount, sanitizeLayoutStore, seedLayoutStore, type ChartLayout,
} from '../chart-layouts';
import { ACC_HONESTY, ACC_RULES, accumulationSeries } from '../accumulation';
import {
  accBarWord, accChipText, accCountsInRange, accDetailLines, accMarkColor, accMarkTitle, accOn, accPointsFor, accReading, accStatus, cmfPointsFor,
  obvValues, parseAccPrefs, serializeAccPrefs, toVolBars, withAcc,
} from '../../components/charts/acc-view';
import { chartMenuItems } from '../../components/charts/ChartContextMenu';
import { overlayChipText } from '../chart-display';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;

/** A rising stock: quiet drift, with heavy up days closing on the high every 7th bar and a breakout at the end. */
function risingBars(n = 160, start = Date.UTC(2025, 0, 6)) {
  const out: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const big = i > 60 && i % 7 === 0;
    const prev = c;
    c = big ? c * 1.03 : c * (i % 2 ? 1.002 : 0.999);
    const h = Math.max(prev, c) * (big ? 1.001 : 1.004), l = Math.min(prev, c) * 0.996;
    out.push({ t: start + i * DAY, o: prev, h, l, c, v: big ? 3_000_000 : 1_000_000 });
  }
  return out;
}

const base = (): ChartLayout => cleanLayout(seedLayoutStore(1).layouts[0]);

test('ACC is an analysis overlay: in SPECIAL_EXTRAS, own on/off, not counted toward the limit, off by default', () => {
  assert.ok(SPECIAL_EXTRAS.has('ACC'));
  assert.equal(EXTRA_INFO.ACC.label, 'Volume & accumulation (institutional footprint)');
  assert.equal(EXTRA_INFO.ACC.pane, false);
  // existing layouts: off (no migration adds it)
  const seeded = sanitizeLayoutStore(seedLayoutStore(1));
  for (const l of seeded.layouts) assert.equal(accOn(l), false);
  // on / off helper: one copy, never two
  const on = withAcc(base(), true);
  assert.equal(accOn(on), true);
  assert.equal(withAcc(on, true).extras.filter((x) => x.type === 'ACC').length, 1);
  assert.equal(accOn(withAcc(on, false)), false);
  // not counted: next to 8 regular indicators it is kept, and it can always be added
  const full = cleanLayout({ ...base(), extras: Array.from({ length: MAX_EXTRAS }, () => newExtra('RSI')) });
  assert.equal(addExtraBlockedReason(full, 'ACC'), null);
  const both = cleanLayoutReport({ ...full, extras: [...full.extras, newExtra('ACC')] });
  assert.ok(accOn(both.layout));
  assert.deepEqual(both.dropped, []);
  assert.equal(regularExtraCount(both.layout), MAX_EXTRAS);
  // a second copy collapses
  assert.equal(cleanLayout({ ...base(), extras: [newExtra('ACC'), newExtra('ACC')] }).extras.length, 1);
  // not a legend row (it has its own chip)
  assert.equal(legendRows(on).some((r) => r.label.startsWith('Volume & accumulation')), false);
  // the dropped note counts the overlays
  const many = cleanLayout({ ...base(), extras: Array.from({ length: MAX_EXTRAS + 1 }, () => newExtra('ATR')) });
  assert.match(droppedNote(many) as string, new RegExp(`the ${SPECIAL_EXTRAS.size} analysis overlays do not count`));
});

test('OBV is a regular lower-pane indicator, counted in the normal limit', () => {
  assert.ok(EXTRA_TYPES.includes('OBV'));
  assert.equal(SPECIAL_EXTRAS.has('OBV'), false);
  assert.equal(EXTRA_INFO.OBV.pane, true);
  const l = cleanLayout({ ...base(), extras: [newExtra('OBV')] });
  assert.equal(regularExtraCount(l), 1);
  const row = legendRows(l).find((r) => r.source === 'extra');
  assert.ok(row && row.pane && /On-Balance Volume/.test(row.label));
  const full = cleanLayout({ ...base(), extras: Array.from({ length: MAX_EXTRAS }, () => newExtra('RSI')) });
  assert.match(addExtraBlockedReason(full, 'OBV') as string, /Limit 8 indicators/);
  // OBV values = the engine's running total
  const bars = risingBars(30);
  const eng = accumulationSeries({ h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c), v: bars.map((b) => b.v) }).obv;
  assert.deepEqual(obvValues(bars), eng);
  assert.equal(obvValues(bars)[0], 0);
  assert.equal(obvValues(bars)[1], bars[1].c > bars[0].c ? bars[1].v : bars[1].c < bars[0].c ? -bars[1].v : 0);
  assert.deepEqual(obvValues([]), []);
});

test('marks come from the engine series: one per classified bar, by timestamp, stalling marks can be hidden', () => {
  const bars = risingBars();
  const s = accumulationSeries(toVolBars(bars));
  const pts = accPointsFor(bars, s);
  const classified = s.kind.filter(Boolean).length;
  assert.ok(classified > 3, 'the synthetic stock has accumulation bars');
  assert.equal(pts.length, classified);
  for (const [t, k, x] of pts) {
    const i = bars.findIndex((b) => b.t === t);
    assert.equal(s.kind[i], k);
    assert.equal(x, s.volX[i]);
  }
  assert.ok(pts.some((p) => p[1] === 'acc' || p[1] === 'vbo'));
  // churn hidden
  const fake = { ...s, kind: s.kind.map((k, i) => (i === 100 ? 'churn' as const : k)) };
  assert.equal(accPointsFor(bars, fake).some((p) => p[1] === 'churn'), true);
  assert.equal(accPointsFor(bars, fake, { churn: false }).some((p) => p[1] === 'churn'), false);
  // money-flow points: one per bar, null before 21 bars
  const cmf = cmfPointsFor(bars, s);
  assert.equal(cmf.length, bars.length);
  assert.equal(cmf[5][1], null);
  assert.equal(typeof cmf[bars.length - 1][1], 'number');
  // counts in view
  const c = accCountsInRange(s, 0, bars.length);
  assert.equal(c.acc + c.vbo + c.dist + c.churn, classified);
});

test('completed candles only: a forming last daily candle is left out (indexes still match)', () => {
  const bars = risingBars(120);
  const lastT = bars[bars.length - 1].t;
  // US: the session closes 21:00 UTC in winter (January) — at 15:00 UTC the last candle is still forming
  const forming = accReading(bars, 'D', 'US', lastT + 15 * 3_600_000);
  assert.equal(forming.dropped, true);
  assert.equal(forming.done.length, bars.length - 1);
  assert.equal(forming.series.kind.length, bars.length - 1);
  // after the close it is read
  const closed = accReading(bars, 'D', 'US', lastT + 22 * 3_600_000);
  assert.equal(closed.dropped, false);
  assert.equal(closed.done.length, bars.length);
  assert.ok(closed.figures.accS != null);
  // the chip says "today" only when the last session is complete and read
  assert.doesNotMatch(accChipText(forming.figures, { tf: 'D', status: 'ready', dropped: true }).text, /today/);
});

test('W / M candles: the same rules read weeks / months, no weekly re-grouping of non-daily bars', () => {
  assert.equal(accBarWord('D'), 'session');
  assert.equal(accBarWord('W'), 'week');
  assert.equal(accBarWord('M'), 'month');
  const weekly = risingBars(120, Date.UTC(2023, 0, 2)).map((b, i) => ({ ...b, t: Date.UTC(2023, 0, 2) + i * 7 * DAY }));
  const r = accReading(weekly, 'W', 'US', Date.UTC(2026, 9, 15));
  assert.equal(r.dropped, false);
  assert.equal(r.figures.bigUpW, null, 'no weekly volume reading on weekly candles (daily: false)');
  assert.equal(r.figures.bigDnW, null);
  const chip = accChipText(r.figures, { tf: 'W', status: 'ready' }).text;
  assert.match(chip, /\(25 weeks\)/);
  const lines = accDetailLines(r.figures, 'W', 'US');
  assert.ok(lines.some((l) => /Last 25 weeks/.test(l)), lines.join('\n'));
  assert.equal(lines[lines.length - 1], ACC_HONESTY);
  assert.match(accChipText(null, { tf: 'M', status: 'short' }).text, new RegExp(`needs ${ACC_RULES.minBars} months`));
  assert.match(accMarkTitle('acc', 1.6, 'week'), /^Accumulation week · vol 1\.6×$/);
});

test('chip text: grade, counts, money flow, breakout, distribution warning; compact in Clean', () => {
  const f: any = { accV: 1, accS: 70, accG: 'B', distWarn: 0, accD: 5, disD: 3, chD: 0, cmf21: 0.41, cmf65: 0.2, udv50: 1.4, obvSlope: 0.2, obvLead: 0, bigUpW: 2, bigDnW: 0, vdu: null, vboD: null, vboX: null, dlv10: null, dlvChg: null };
  assert.deepEqual(accChipText(f, { tf: 'D', status: 'ready' }), { text: 'Accumulation B · 5 acc / 3 dist (25 sessions) · money flow +0.41', tone: 'up' });
  assert.equal(accChipText({ ...f, vboD: 0, vboX: 2.1 }, { tf: 'D', status: 'ready' }).text, 'Accumulation B · 5 acc / 3 dist (25 sessions) · money flow +0.41 · vol breakout today');
  assert.match(accChipText({ ...f, vboD: 0, vboX: 2.1 }, { tf: 'D', status: 'ready', dropped: true }).text, /vol breakout last session$/);
  assert.match(accChipText({ ...f, vboD: 3 }, { tf: 'W', status: 'ready' }).text, /vol breakout 3 weeks ago$/);
  const warn = accChipText({ ...f, accG: 'E', accS: 20, cmf21: -0.3, distWarn: 1 }, { tf: 'D', status: 'ready' });
  assert.match(warn.text, /money flow −0\.30 · ⚠ distribution$/);
  assert.equal(warn.tone, 'down');
  assert.equal(accChipText({ ...f, accG: 'C' }, { tf: 'D', status: 'ready' }).tone, 'none');
  assert.equal(accChipText(f, { tf: 'D', status: 'ready', compact: true }).text, 'Accumulation B · 5 acc / 3 dist · MF +0.41');
  assert.equal(accChipText(null, { tf: 'D', status: 'loading' }).text, 'Accumulation · reading the bars…');
  assert.equal(accChipText({ ...f, accS: null, accG: null }, { tf: 'D', status: 'ready' }).text, 'Accumulation · no volume in this data');
  assert.equal(accStatus(false, 10, 10), 'idle');
  assert.equal(accStatus(true, 0, 0), 'loading');
  assert.equal(accStatus(true, 50, 50), 'short');
  assert.equal(accStatus(true, 100, 99), 'ready');
  assert.equal(overlayChipText('acc', ' Accumulation B · 5 acc / 3 dist '), 'Accumulation B · 5 acc / 3 dist');
  // no buy / sell wording anywhere in the overlay's words
  const words = [accChipText(f, { tf: 'D', status: 'ready' }).text, ...accDetailLines(f, 'D', 'US'), read('../../components/charts/AccIndicator.tsx')].join('\n');
  assert.doesNotMatch(words, /\b(buy|sell)\b/i);
});

test('marks: colours per theme, prefs parse safely', () => {
  for (const k of ['acc', 'vbo', 'dist', 'churn'] as const) assert.notEqual(accMarkColor(k, true), accMarkColor(k, false));
  assert.notEqual(accMarkColor('acc', true), accMarkColor('vbo', true));
  assert.match(accMarkTitle('vbo', 2.1), /^Volume breakout · vol 2\.1×$/);
  assert.deepEqual(parseAccPrefs(null), { cmfPane: true, tint: true, churn: true });
  assert.deepEqual(parseAccPrefs('{bad'), { cmfPane: true, tint: true, churn: true });
  assert.deepEqual(parseAccPrefs(serializeAccPrefs({ cmfPane: false, tint: true, churn: false })), { cmfPane: false, tint: true, churn: false });
});

test('right-click menu has the overlay toggle next to the other analysis overlays', () => {
  const st = { axis: false, price: null, cur: '$', decimals: 2, auto: true, log: false, tr: false, patterns: false, stage: false, setups: false, volume: true, selected: false, light: true };
  const ids = chartMenuItems({ ...st, acc: true }).map((x) => x.id);
  assert.equal(ids[ids.indexOf('alines') + 1], 'acc');
  assert.equal(chartMenuItems({ ...st, acc: true }).find((x) => x.id === 'acc')?.checked, true);
  assert.equal(chartMenuItems(st).find((x) => x.id === 'acc')?.checked, false);
});

test('source wiring: hook, chip, panes, OBV, menu, layout controls', () => {
  const ws = read('../../components/charts/ChartWorkspace.tsx');
  assert.match(ws, /useAccIndicator\(\{ on: accOn\(L\.working\)/);
  assert.match(ws, /volumeOn: L\.working\.volume\.on, volPane: VOL_PANE/);
  assert.match(ws, /accInd\.on\]\.filter\(Boolean\)/);
  assert.match(ws, /acc=\{accInd\}/);
  assert.match(ws, /case 'acc': L\.setWorking\(\(w\) => withAcc\(w, !accOn\(w\)\)\)/);
  assert.match(ws, /else if \(id === 'acc'\) L\.setWorking\(\(w\) => withAcc\(w, false\)\)/);
  assert.match(ws, /x\.type === 'OBV' \? 'MC_OBV'/);
  assert.match(ws, /'MC_ATR', 'MC_OBV'\]\) chart\.removeIndicator/);
  assert.match(ws, /CMF: 'Money flow'/);
  const hook = read('../../components/charts/AccIndicator.tsx');
  assert.match(hook, /accReading\(bars, tf, mkt\)/, 'completed candles via acc-view (setup-view completedBars)');
  assert.match(hook, /removeIndicator\(\{ name: ACC_INDICATOR \}\); chart\.removeIndicator\(\{ name: CMF_INDICATOR \}\)/, 'stale marks cleared before every redraw');
  assert.match(hook, /paneId: CMF_PANE/);
  assert.match(hook, /compact: display === 'clean'/);
  const view = read('../../components/charts/acc-view.ts');
  assert.match(view, /completedBars\(bars, tf, market, now\)/);
  assert.match(view, /daily \? \{ daily: true, weekDone: \(mon\) => weekComplete\(mon, market, now\) \} : \{ daily: false \}/);
  const kl = read('../../components/charts/acc-kline.ts');
  assert.match(kl, /name: 'MC_ACC'/); assert.match(kl, /name: 'MC_CMF'/);
  assert.match(read('../../components/charts/kline-setup.ts'), /name: 'MC_OBV'/);
  const sum = read('../../components/charts/OverlaySummary.tsx');
  assert.match(sum, /'alines', 'acc'\]/);
  assert.match(sum, /<AccBanner s=\{acc\}/);
  const lc = read('../../components/charts/LayoutControls.tsx');
  assert.match(lc, /withAcc\(l, e\.target\.checked\)/);
  assert.match(lc, /The \{SPECIAL_EXTRAS\.size\} analysis overlays above do not count/);
});
