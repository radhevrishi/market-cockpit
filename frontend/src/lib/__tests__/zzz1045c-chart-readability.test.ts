// zzz1045c — chart readability (audit, NVDA monthly dark view: overlay chips + the long MA / indicator legend covered much of the
// candle pane, lower panes squeezed the price pane, the previous symbol's analysis stayed readable while the next one loaded).
//  1. compact legend: one strip in Clean by default (names + latest values, the rest behind "+N"), a toggle to the full legend, choice
//     remembered in 'mc:chart-display:v1'; full list kept for screen readers; "+N hidden" and × still in the full legend
//  2. lower panes: the price pane keeps ≥ ~45% (or a pixel minimum); panes shrink in proportion; each collapsible, per layout
//  3. missing values: "— (needs 200 bars, has 120)"
//  4. switching symbol / timeframe: "Loading NVDA M…" badge, the overlay chips and legend dimmed (never removed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLLAPSED_PANE_PX, MIN_PANE_PX, analysisStale, barsNeeded, fitPaneHeights, isPaneCollapsed, legendCompact, missingValueText, paneBarsNeeded,
  parsePaneCollapse, stripFit, togglePaneCollapsed, transitionLabel,
} from '../chart-readability';
import { CHART_DISPLAY_KEY, parseChartDisplay, parseLegendPref, saveChartDisplay, saveLegendPref, serializeChartDisplay } from '../chart-display';
import { atr, ema, macd, rsi, sma, bollinger, supertrend, type Bar } from '../chart-math';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 1. compact legend ─────────────────────────────────────────────────────────────
test('legend: one strip by default in Clean, full in Research; the viewer choice wins', () => {
  assert.equal(legendCompact('clean', null), true);
  assert.equal(legendCompact('research', null), false);
  assert.equal(legendCompact('clean', 'full'), false);
  assert.equal(legendCompact('research', 'compact'), true);
});

test('legend choice lives in the display record, next to the mode (old records still read)', () => {
  assert.equal(parseLegendPref(null), null);
  assert.equal(parseLegendPref('"research"'), null);
  assert.equal(parseLegendPref('not json'), null);
  assert.equal(parseLegendPref('{"mode":"clean","legend":"weird"}'), null);
  assert.equal(parseLegendPref(serializeChartDisplay('clean', 'full')), 'full');
  assert.equal(parseChartDisplay(serializeChartDisplay('research', 'compact')), 'research');
  assert.equal(serializeChartDisplay('clean'), '{"mode":"clean"}', 'unchanged without a legend choice');
});

test('legend choice and mode survive each other being saved (localStorage, try/catch)', () => {
  const mem = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  const had = g.localStorage;
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  try {
    saveChartDisplay('research');
    saveLegendPref('compact');
    assert.equal(parseChartDisplay(mem.get(CHART_DISPLAY_KEY)), 'research');
    saveChartDisplay('clean');
    assert.equal(parseLegendPref(mem.get(CHART_DISPLAY_KEY)), 'compact');
    assert.equal(parseChartDisplay(mem.get(CHART_DISPLAY_KEY)), 'clean');
    g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.doesNotThrow(() => saveLegendPref('full'));
  } finally { g.localStorage = had; }
});

test('strip fit: all items when they fit; otherwise room for "+N"; hidden lines counted in +N', () => {
  assert.deepEqual(stripFit([50, 50, 50], 200, 30, 10), { shown: 3, more: 0 });
  // 200 − 30 (+N) − 10 (gap) = 160 → 50 + 10 + 50 = 110, the third (+60 = 170) does not fit
  assert.deepEqual(stripFit([50, 50, 50, 50], 200, 30, 10), { shown: 2, more: 2 });
  assert.deepEqual(stripFit([50, 50], 200, 30, 10, 3), { shown: 2, more: 3 }, 'hidden lines: always a +N');
  assert.deepEqual(stripFit([300], 200, 30, 10), { shown: 0, more: 1 });
  assert.deepEqual(stripFit([], 200, 30), { shown: 0, more: 0 });
});

// ── 3. missing values ─────────────────────────────────────────────────────────────
test('missing value text: needs N bars, has M — only when the history is short', () => {
  assert.equal(missingValueText(200, 120), '— (needs 200 bars, has 120)');
  assert.equal(missingValueText(200, 200), '—');
  assert.equal(missingValueText(null, 5), '—');
  assert.equal(missingValueText(14, Number.POSITIVE_INFINITY), '—');
  assert.equal(missingValueText(21, -3), '— (needs 21 bars, has 0)');
});

const bars = (n: number): Bar[] => Array.from({ length: n }, (_, i) => ({ t: i * 86400000, o: 100 + Math.sin(i / 3) * 5, h: 106 + Math.sin(i / 3) * 5, l: 95 + Math.sin(i / 3) * 5, c: 100 + Math.sin(i / 2) * 6 + i * 0.1, v: 1000 }));
const firstValue = (a: (number | null)[]) => a.findIndex((v) => v != null) + 1;

test('bars needed match the maths that draws the lines', () => {
  const b = bars(400), c = b.map((x) => x.c);
  assert.equal(barsNeeded({ kind: 'EMA', a: 200 }), firstValue(ema(c, 200)));
  assert.equal(barsNeeded({ kind: 'SMA', a: 150 }), firstValue(sma(c, 150)));
  assert.equal(barsNeeded({ kind: 'BBU', a: 20, b: 2 }), firstValue(bollinger(c, 20, 2).up));
  assert.equal(barsNeeded({ kind: 'STU', a: 10, b: 3 }), firstValue(supertrend(b, 10, 3).line));
  assert.deepEqual(paneBarsNeeded('RSI', [14]), [firstValue(rsi(c, 14))]);
  const m = macd(c, 12, 26, 9);
  assert.deepEqual(paneBarsNeeded('MACD', [12, 26, 9]), [firstValue(m.macd), firstValue(m.signal)]);
  assert.deepEqual(paneBarsNeeded('ATR', [14]), [firstValue(atr(b, 14))]);
  assert.deepEqual(paneBarsNeeded('BOLL', [20, 2]), []);
  // the NVDA case: SMA 200 on 120 monthly bars
  const v = sma(c.slice(0, 120), 200);
  assert.equal(v[119], null);
  assert.equal(missingValueText(barsNeeded({ kind: 'SMA', a: 200 }), 120), '— (needs 200 bars, has 120)');
});

// ── 2. lower panes ────────────────────────────────────────────────────────────────
test('panes: wanted heights kept when the price pane stays above its minimum', () => {
  assert.deepEqual(fitPaneHeights(800, [{ id: 'vol', want: 100 }, { id: 'rsi', want: 110 }], { axis: 28 }), { vol: 100, rsi: 110 });
});

test('panes: shrunk in proportion so the price pane keeps ≥ 45% of the chart', () => {
  const panes = [{ id: 'vol', want: 100 }, { id: 'rsi', want: 110 }, { id: 'macd', want: 110 }, { id: 'atr', want: 110 }, { id: 'mrs', want: 100 }];
  const total = 600, axis = 28;
  const h = fitPaneHeights(total, panes, { axis });
  const sum = Object.values(h).reduce((s, x) => s + x, 0);
  assert.ok(total - axis - sum >= 0.45 * (total - axis) - 1, `price pane ${total - axis - sum}px`);
  assert.ok(h.rsi > h.vol, 'proportional: the taller ask stays taller');
  for (const x of Object.values(h)) assert.ok(x >= MIN_PANE_PX);
});

test('panes: a pixel minimum on short charts; floors hold when there is no room', () => {
  const h = fitPaneHeights(330, [{ id: 'a', want: 100 }, { id: 'b', want: 100 }], { axis: 30, minPx: 180 });
  assert.ok(300 - h.a - h.b >= 180 || h.a === MIN_PANE_PX, JSON.stringify(h));
  const tiny = fitPaneHeights(200, [{ id: 'a', want: 100 }, { id: 'b', want: 100 }, { id: 'c', want: 100 }]);
  assert.deepEqual(tiny, { a: MIN_PANE_PX, b: MIN_PANE_PX, c: MIN_PANE_PX });
});

test('panes: collapsed panes are a thin strip and give their room to the others', () => {
  const h = fitPaneHeights(800, [{ id: 'vol', want: 100, collapsed: true }, { id: 'rsi', want: 110 }], { axis: 28 });
  assert.equal(h.vol, COLLAPSED_PANE_PX);
  assert.equal(h.rsi, 110);
  assert.deepEqual(fitPaneHeights(500, [{ id: 'x', want: 100, collapsed: true }]), { x: COLLAPSED_PANE_PX });
});

test('collapsed panes are remembered per layout (bad stored data ignored)', () => {
  let s = parsePaneCollapse(null);
  s = togglePaneCollapsed(s, 'L1', 'mc_vol_pane');
  assert.equal(isPaneCollapsed(s, 'L1', 'mc_vol_pane'), true);
  assert.equal(isPaneCollapsed(s, 'L2', 'mc_vol_pane'), false, 'another layout keeps its own');
  const round = parsePaneCollapse(JSON.stringify(s));
  assert.deepEqual(round, s);
  s = togglePaneCollapsed(s, 'L1', 'mc_vol_pane');
  assert.deepEqual(s, {}, 'expanded again: nothing kept');
  assert.deepEqual(parsePaneCollapse('[1,2]'), {});
  assert.deepEqual(parsePaneCollapse('{"L1":[1,"",null,"p"],"L2":"x"}'), { L1: ['p'] });
  assert.deepEqual(parsePaneCollapse('nope'), {});
});

// ── 4. symbol / timeframe switch ──────────────────────────────────────────────────
test('loading badge and stale analysis', () => {
  assert.equal(transitionLabel('NVDA', 'M').text, 'Loading NVDA M…');
  assert.match(transitionLabel('NVDA', 'M').title, /monthly/);
  assert.equal(transitionLabel('RELIANCE', 'D', 'BSE').text, 'Loading RELIANCE (BSE) D…');
  const base = { ready: true, loadedId: 'US|QQQ|D', viewId: 'US|NVDA|M', loading: true, error: null };
  assert.equal(analysisStale(base), true);
  assert.equal(analysisStale({ ...base, loading: false }), true, 'the frame before the load starts');
  assert.equal(analysisStale({ ...base, loading: false, error: 'No data' }), false, 'a failed load shows its own message');
  assert.equal(analysisStale({ ...base, loadedId: base.viewId }), false, 'a refresh of the same chart is not a switch');
  assert.equal(analysisStale({ ...base, ready: false }), false);
});

// ── wiring ────────────────────────────────────────────────────────────────────────
test('wiring: legend strip, toggle, screen-reader list, hidden rows and × kept', () => {
  const lc = src('../../components/charts/LayoutControls.tsx');
  assert.match(lc, /data-testid="legend-strip"/);
  assert.match(lc, /data-testid="legend-strip-more"/);
  assert.match(lc, /data-testid="legend-expand"/);
  assert.match(lc, /data-testid="legend-collapse"/);
  assert.match(lc, /aria-label="Indicators on the chart"/);
  assert.match(lc, /data-testid="legend-hidden-toggle"/);
  assert.match(lc, /className="mc-legend-x"/);
  assert.match(lc, /stripFit\(/);
  assert.match(lc, /missingValueText\(/);
});

test('wiring: chart passes the strip choice, bars needed, stale state; panes fitted and collapsible; loading badge', () => {
  const ws = src('../../components/charts/ChartWorkspace.tsx');
  assert.match(ws, /<IndicatorLegend top=\{legendTop\}/);
  assert.match(ws, /compact=\{compactLegend\} onCompact=\{setLegendCompact\} neededOf=\{neededOf\}/);
  assert.match(ws, /legendCompact\(display, legendPref\)/);
  assert.match(ws, /fitPaneHeights\(el\.clientHeight/);
  assert.match(ws, /subscribeAction\('onPaneDrag'/);
  assert.match(ws, /new MutationObserver\(fitSoon\)/);
  assert.match(ws, /fitPanesRef\.current\(\);\s+\/\/ zzz1045c/);
  assert.match(ws, /data-testid="pane-collapse"/);
  assert.match(ws, /togglePaneCollapsed\(paneStoreRef\.current, workingRef\.current\.id/);
  assert.match(ws, /data-testid="chart-loading-badge"/);
  assert.match(ws, /analysisStale\(\{ ready, loadedId: loadedBars\.id, viewId, loading, error \}\)/);
  assert.match(ws, /stale=\{analysisOld\} \/>/);
  const os = src('../../components/charts/OverlaySummary.tsx');
  assert.match(os, /data-stale=\{stale \? '1' : undefined\}/);
  assert.match(os, /aria-busy=\{stale \|\| undefined\}/);
  const css = src('../../components/charts/chart-workspace-css.ts');
  assert.match(css, /\.mc-overlay-row\[data-stale\] > :not\(\[data-testid="display-toggle"\]\) \{ opacity: \.35/);
});
