import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { drawdownEpisodes, regimeOf, referenceWindow, themeCycle, windowReturn, type DaySeries } from '../theme-cycle/core';
import { classifyCycle, leadershipTransitions, watchlistOrder, type CycleRead } from '../theme-cycle/classify';
import type { LayerSet, LayerRead, ThemeRow } from '../theme-rotation/types';

// Daily (weekday) series from piecewise-linear legs: [days, end price].
function series(start: string, p0: number, legs: Array<[number, number]>): DaySeries {
  const d: string[] = [], c: number[] = [];
  let t = Date.parse(`${start}T00:00:00Z`), p = p0;
  const push = () => { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) { d.push(new Date(t).toISOString().slice(0, 10)); c.push(p); } t += 86_400_000; };
  push();
  for (const [n, end] of legs) { const step = (end - p) / n; for (let i = 0; i < n; i++) { p += step; push(); } }
  return { d, c };
}

test('zzz1289: falls are found on the benchmark and end only when the old high is regained', () => {
  const s = series('2020-01-01', 100, [[200, 130], [100, 91], [150, 135], [60, 140]]);
  const eps = drawdownEpisodes(s, 0.15);
  assert.equal(eps.length, 1);
  assert.ok(Math.abs(eps[0].depth - 0.30) < 0.01, `depth ${eps[0].depth}`);
  assert.ok(eps[0].recovered, 'regained the high');
  assert.equal(drawdownEpisodes(series('2020-01-01', 100, [[100, 110], [50, 100]]), 0.15).length, 0, 'a 9% dip is not a fall');
});

test('zzz1289: regime — a fall mostly won back reads as recovery, not as a bear market', () => {
  const s = series('2024-01-01', 100, [[200, 120], [120, 100], [120, 117]]);
  const r = regimeOf(s)!;
  assert.equal(r.kind, 'recovery');
  assert.ok(r.recovered! > 0.8);
  const bear = regimeOf(series('2024-01-01', 100, [[200, 120], [120, 90]]))!;
  assert.equal(bear.kind, 'bear');
});

test('zzz1289: every theme is measured over the SAME benchmark peak → trough window', () => {
  const bench = series('2024-01-01', 100, [[250, 120], [120, 100], [80, 108]]);
  const ref = referenceWindow(bench)!;
  assert.ok(ref, 'a 17% fall gives a reference window');
  // A theme with its own (different) peak: still measured from the BENCHMARK's dates.
  const theme = series('2024-01-01', 50, [[200, 70], [170, 63], [80, 66]]);
  const c = themeCycle(theme, ref);
  assert.equal(c.fall!.toFixed(4), windowReturn(theme, ref.peak, ref.trough)!.toFixed(4));
  assert.ok(c.relFall! > 0, 'fell less than the market → positive points');
  assert.equal(themeCycle(theme, null).fall, null, 'no correction → no fall figure invented');
});

function layer(state: LayerRead['state'], extra: Partial<LayerRead> = {}): LayerRead {
  return { key: 'breadth', state, level: null, headline: state, detail: '', basis: 'trend', lowConfidence: false, ...extra } as unknown as LayerRead;
}
function layers(over: Partial<Record<keyof LayerSet, LayerRead>>): LayerSet {
  const base = { price: layer('steady'), rs: layer('steady'), breadth: layer('steady'), earnings: layer('steady'), catalysts: layer('steady'), flow: layer('steady'), valuation: layer('steady') } as unknown as LayerSet;
  return { ...base, ...over } as LayerSet;
}
function row(over: Partial<ThemeRow>): ThemeRow {
  return {
    id: 'x', name: 'X', emoji: '', group: 'G', ok: true,
    ret: { w1: 0, m1: 0, m3: 0, m6: 0, ytd: 0, y1: 0 },
    rsRatio: 100, rsMomentum: 100, rsSlope: 0, rsDelta1w: 0, quadrant: 'Lagging', aboveSMA50: false,
    breadthStats: { n: 12, above50: 6, above50Prev: 5, above20: 6, above200: 6, n200: 12 },
    ...over,
  } as unknown as ThemeRow;
}
const bench = { w1: 0, m1: 0, m3: 0, m6: 0, ytd: 0, y1: 0 };

test('zzz1289: "fell least" alone is defence, never a next-cycle candidate', () => {
  const r = classifyCycle({
    row: row({ cycle: { fall: -0.02, sincePeak: 0, fromTrough: 0.05, relFall: 14, relSincePeak: 8, runUp: 0.1, ownDD: 0.05, ownLow: null, higherLows: null, volRatio: 1, dist200: 2, nearLow: false } as any }),
    L: layers({}), flags: [], bench, ref: { peak: 'a', trough: 'b', last: 'c', benchFall: -0.16, benchSincePeak: -0.03, benchFromTrough: 0.15, ddMax: 0.16, ongoing: true },
  });
  assert.equal(r.state, 'DEFENSIVE');
});

test('zzz1289: three price signals cannot outvote missing fundamentals — market counts once', () => {
  const priceOnly = classifyCycle({
    row: row({ rsMomentum: 104, rsSlope: 0.4, rsDelta1w: 1, aboveSMA50: true, ret: { w1: 2, m1: 8, m3: 4, m6: 0, ytd: 0, y1: 0 } }),
    L: layers({}), flags: [], bench, ref: null,
  });
  assert.notEqual(priceOnly.state, 'EARLY_ROTATION');
  assert.notEqual(priceOnly.state, 'EMERGING_LEADER');
  assert.equal(priceOnly.nonPriceImproving, 0);

  const early = classifyCycle({
    row: row({ rsMomentum: 103, rsSlope: 0.3, aboveSMA50: true, ret: { w1: 2, m1: 6, m3: -2, m6: -8, ytd: 0, y1: 0 } }),
    L: layers({ breadth: layer('improving') }), flags: [], bench, ref: null,
  });
  assert.equal(early.state, 'EARLY_ROTATION');

  const emerging = classifyCycle({
    row: row({ rsMomentum: 105, rsSlope: 0.5, aboveSMA50: true, ret: { w1: 2, m1: 6, m3: 3, m6: -2, ytd: 0, y1: 0 } }),
    L: layers({ breadth: layer('improving'), earnings: layer('improving') }), flags: [], bench, ref: null,
  });
  assert.equal(emerging.state, 'EMERGING_LEADER');
  assert.ok(watchlistOrder(emerging, early) < 0, 'emerging ranks above early');

  // An "improving" read that is only a level (no earlier period) or rests on too few names does not count.
  const levelOnly = classifyCycle({
    row: row({ rsMomentum: 103, rsSlope: 0.3, aboveSMA50: true, ret: { w1: 2, m1: 6, m3: -2, m6: -8, ytd: 0, y1: 0 } }),
    L: layers({ breadth: layer('improving', { basis: 'level' } as any), earnings: layer('improving', { lowConfidence: true } as any) }), flags: [], bench, ref: null,
  });
  assert.equal(levelOnly.nonPriceImproving, 0);
  assert.notEqual(levelOnly.state, 'EARLY_ROTATION');
});

test('zzz1289: a former early candidate that breaks down is a failed transition', () => {
  const r = classifyCycle({
    row: row({ rsMomentum: 96, rsSlope: -0.4, aboveSMA50: false, ret: { w1: -2, m1: -6, m3: -4, m6: 0, ytd: 0, y1: 0 } }),
    L: layers({}), flags: [], bench, ref: null, previous: 'EARLY_ROTATION',
  });
  assert.equal(r.state, 'FAILED_TRANSITION');
});

test('zzz1289: transitions only between related themes, never worded as money moving', () => {
  const a = row({ id: 'a', name: 'A', cluster: 1, quadrant4w: 'Leading', quadrant: 'Weakening', rsSlope: -0.3, ret: { w1: 0, m1: -5, m3: 0, m6: 0, ytd: 0, y1: 0 } });
  const b = row({ id: 'b', name: 'B', cluster: 1, quadrant: 'Improving', rsSlope: 0.3, aboveSMA50: true, ret: { w1: 0, m1: 5, m3: 0, m6: 0, ytd: 0, y1: 0 } });
  const c = row({ id: 'c', name: 'C', cluster: 2, group: 'Other', quadrant: 'Improving', rsSlope: 0.3, ret: { w1: 0, m1: 9, m3: 0, m6: 0, ytd: 0, y1: 0 } });
  const reads = new Map<string, CycleRead>();
  for (const t of [a, b, c]) reads.set(t.id, classifyCycle({ row: t, L: layers({}), flags: [], bench, ref: null }));
  const tr = leadershipTransitions([a, b, c], reads);
  assert.deepEqual(tr.map((t) => `${t.from}>${t.to}`), ['a>b']);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'dashboard', 'theme-rotation', 'CyclePanel.tsx'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'theme-cycle', 'classify.ts'), 'utf8');
  assert.ok(!/institutional money moved|money (is )?moving into|smart money/i.test(src.replace(/never "money moved"|never a claim that money moved/gi, '')));
  assert.ok(/not buy signals/.test(src));
});
