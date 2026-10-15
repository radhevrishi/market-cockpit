// zzz1029 — Charts, QA (HAL): patterns + stage analysis + auto levels on together gave overlapping status bars at the top, many
// turning-point labels and right-edge price tags on top of each other.
//  • one overlay summary row: a chip per overlay that is on; a chip opens its own details, one at a time; Esc / a click outside closes
//  • Clean (default) / Research labels, saved per viewer in 'mc:chart-display:v1'; the calculations are the same in both
//  • Clean: turning-point codes only when a pattern is picked / hovered, stage marks for the current stage + the change before it,
//    setup tags on the last ~20 bars, nearby auto-line tags merged (exact prices kept), right-edge tags capped and kept clear of the
//    last-price tag and the pattern pivot tag
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHART_DISPLAY_KEY, CLEAN_MAX_EDGE_TAGS, DEFAULT_CHART_DISPLAY, TAG_PRIORITY, levelPriorities, mergeLevelTags, overlayChipText, parseChartDisplay,
  patternLabelsShown, placeEdgeTags, recentSetupPoints, serializeChartDisplay, stageMarksForDisplay, type LevelTag,
  CLEAN_MIN_SPAN_CANDLES, candlesSpanned, drawOtherTfStructure,
} from '../chart-display';
import { chartMenuItems } from '../../components/charts/ChartContextMenu';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;

test('preset: Clean by default; saved as JSON; anything unknown reads as Clean', () => {
  assert.equal(DEFAULT_CHART_DISPLAY, 'clean');
  assert.equal(CHART_DISPLAY_KEY, 'mc:chart-display:v1');
  assert.equal(parseChartDisplay(null), 'clean');
  assert.equal(parseChartDisplay(serializeChartDisplay('research')), 'research');
  assert.equal(parseChartDisplay(serializeChartDisplay('clean')), 'clean');
  assert.equal(parseChartDisplay('{"mode":"weird"}'), 'clean');
  assert.equal(parseChartDisplay('not json'), 'clean');
  assert.equal(parseChartDisplay('"research"'), 'research');
});

test('Clean: turning-point codes only while a pattern is picked, its row is hovered or its lines are hovered; Research always', () => {
  const base = { display: 'clean' as const, picked: false, hoverRow: null, rowKey: 'D:falling_wedge', chartHover: false };
  assert.equal(patternLabelsShown(base), false, 'hidden by default');
  assert.equal(patternLabelsShown({ ...base, picked: true }), true, 'picked in the list');
  assert.equal(patternLabelsShown({ ...base, hoverRow: 'D:falling_wedge' }), true, 'its row hovered');
  assert.equal(patternLabelsShown({ ...base, hoverRow: 'W:flat_base' }), false, 'another row hovered');
  assert.equal(patternLabelsShown({ ...base, chartHover: true }), true, 'its lines hovered');
  assert.equal(patternLabelsShown({ ...base, display: 'research' }), true);
});

test('Clean: stage marks = the last two (current stage + the change before it); setup tags on the last 20 bars; Research keeps all', () => {
  const marks = [1, 2, 3, 4, 5];
  assert.deepEqual(stageMarksForDisplay(marks, 'clean'), [4, 5]);
  assert.deepEqual(stageMarksForDisplay(marks, 'research'), marks);
  assert.deepEqual(stageMarksForDisplay([7], 'clean'), [7]);
  const times = Array.from({ length: 60 }, (_, i) => Date.UTC(2026, 0, 1) + i * DAY);
  const pts = times.map((t, i) => [t, i % 2 ? 'EP' : 'NR7', 1] as const);
  const clean = recentSetupPoints(pts, times, 'clean');
  assert.equal(clean.length, 20);
  assert.equal(clean[0][0], times[40]);
  assert.equal(recentSetupPoints(pts, times, 'research').length, 60);
});

const tag = (id: string, y: number, price: number, n: number, kind: LevelTag['kind'] = 'support', priority = TAG_PRIORITY.other): LevelTag =>
  ({ id, y, price, n, kind, color: kind === 'support' ? '#089981' : '#F23645', priority, text: `×${n}  ${price.toFixed(2)}` });

test('merge: auto-line tags within 1.2% (or 14 px) become one tag "×5 · ×3  131.00–132.60", exact prices kept; Research one each', () => {
  const fmt = (n: number) => n.toFixed(2);
  const tags = [tag('a', 200, 131, 3), tag('b', 190, 132.6, 5), tag('c', 60, 160, 4, 'resistance')];
  const m = mergeLevelTags(tags, { mode: 'clean', fmt });
  assert.equal(m.length, 2);
  const g = m.find((x) => x.id.includes('|'))!;
  assert.equal(g.text, '×5 · ×3  131.00–132.60');
  assert.deepEqual(g.prices, [131, 132.6], 'exact values kept');
  assert.equal(g.y, 195);
  // 1.5% apart and 40 px apart: two tags
  assert.equal(mergeLevelTags([tag('a', 200, 100, 3), tag('b', 160, 101.5, 4)], { mode: 'clean', fmt }).length, 2);
  // 3% apart but only 10 px apart on screen: merged
  assert.equal(mergeLevelTags([tag('a', 200, 100, 3), tag('b', 190, 103, 4)], { mode: 'clean', fmt }).length, 1);
  assert.equal(mergeLevelTags(tags, { mode: 'research', fmt }).length, 3);
  // a provisional member is said on the merged tag
  assert.match(mergeLevelTags([{ ...tag('a', 200, 131, 3), prov: true }, tag('b', 195, 131.5, 4)], { mode: 'clean', fmt })[0].text, / · provisional$/);
});

test('priorities: nearest line above and below the last price first', () => {
  const p = levelPriorities([{ id: 'hi', price: 150 }, { id: 'up', price: 121 }, { id: 'dn', price: 118 }, { id: 'lo', price: 90 }], 120);
  assert.equal(p.get('up'), TAG_PRIORITY.nearest);
  assert.equal(p.get('dn'), TAG_PRIORITY.nearest);
  assert.equal(p.get('hi'), TAG_PRIORITY.other);
  assert.equal(p.get('lo'), TAG_PRIORITY.other);
  assert.ok(TAG_PRIORITY.lastPrice > TAG_PRIORITY.patternPivot && TAG_PRIORITY.patternPivot > TAG_PRIORITY.nearest && TAG_PRIORITY.nearest > TAG_PRIORITY.other);
});

test('placement: clear of reserved spots (last price, pattern pivot); no two tags closer than the gap; Clean caps and drops the lowest', () => {
  const req = (id: string, y: number, priority: number) => ({ id, y, priority, text: id, color: '#000' });
  const reqs = [req('o1', 100, 10), req('near', 102, 50), req('o2', 104, 10), req('o3', 300, 10), req('o4', 305, 10), req('o5', 310, 10), req('o6', 500, 10)];
  const reserved = [100];   // the last-price tag
  const gap = 16;
  const clean = placeEdgeTags(reqs, { mode: 'clean', gap, min: 8, max: 592, reserved, maxTags: CLEAN_MAX_EDGE_TAGS, maxShift: 48 });
  const ys = [...reserved, ...clean.placed.map((t) => t.yPlaced)].sort((a, b) => a - b);
  for (let k = 1; k < ys.length; k++) assert.ok(ys[k] - ys[k - 1] >= gap - 1e-9, `gap ${ys[k - 1]} → ${ys[k]}`);
  assert.ok(clean.placed.length + reserved.length <= CLEAN_MAX_EDGE_TAGS, 'cap includes the reserved tags');
  assert.ok(clean.placed.some((t) => t.id === 'near'), 'the nearest support / resistance is kept first');
  assert.ok(clean.dropped.length > 0 && clean.dropped.every((t) => t.priority === 10), 'only low-priority tags dropped');
  for (const t of clean.placed) assert.ok(Math.abs(t.yPlaced - t.y) <= 48, 'never moved far from its line');
  const research = placeEdgeTags(reqs, { mode: 'research', gap, min: 8, max: 592, reserved });
  assert.equal(research.placed.length, reqs.length, 'Research keeps every tag');
  assert.equal(research.dropped.length, 0);
  const rys = [...reserved, ...research.placed.map((t) => t.yPlaced)].sort((a, b) => a - b);
  for (let k = 1; k < rys.length; k++) assert.ok(rys[k] - rys[k - 1] >= gap - 1e-9, 'stacked, not overlapping');
  assert.deepEqual(research.placed.map((t) => t.id), reqs.map((t) => t.id), 'input order kept in the output');
  // no room at all: Research stacks on top, Clean drops
  const full = placeEdgeTags([req('x', 50, 10)], { mode: 'research', gap: 20, min: 40, max: 60, reserved: [40, 60] });
  assert.equal(full.placed.length, 1);
  assert.equal(placeEdgeTags([req('x', 50, 10)], { mode: 'clean', gap: 20, min: 40, max: 60, reserved: [40, 60], maxShift: 40 }).placed.length, 0);
});

test('zzz1029b (AVAV monthly): Clean does not draw another timeframe\'s structure squeezed onto fewer than 6 candles; Research does', () => {
  assert.equal(CLEAN_MIN_SPAN_CANDLES, 6);
  // 10 years of monthly candles (first of each month)
  const months = Array.from({ length: 120 }, (_, i) => Date.UTC(2016, i, 1));
  // a DAILY descending triangle over the last ~45 sessions: Aug 20 → Oct 10 2025
  const tri = { startT: Date.UTC(2025, 7, 20), endT: Date.UTC(2025, 9, 10) };
  assert.equal(candlesSpanned(tri.startT, tri.endT, months), 3, 'Aug (holds the start), Sep, Oct');
  const base = { hitTf: 'D', shownTf: 'M', times: months, ...tri };
  assert.equal(drawOtherTfStructure({ ...base, display: 'clean' }), false, 'Clean: kept in the chip, not drawn');
  assert.equal(drawOtherTfStructure({ ...base, display: 'research' }), true, 'Research: drawn');
  // a weekly base over 40 weeks covers 9–10 monthly candles: drawn in Clean too
  assert.equal(drawOtherTfStructure({ ...base, hitTf: 'W', startT: Date.UTC(2025, 0, 6), endT: Date.UTC(2025, 9, 6), display: 'clean' }), true);
  // the same timeframe as the candles is always drawn
  assert.equal(drawOtherTfStructure({ ...base, hitTf: 'M', display: 'clean' }), true);
  // daily candles: a daily structure of 4 bars is the chart's own timeframe — drawn
  const days = Array.from({ length: 30 }, (_, i) => Date.UTC(2026, 0, 1) + i * DAY);
  assert.equal(drawOtherTfStructure({ display: 'clean', hitTf: 'D', shownTf: 'D', startT: days[25], endT: days[28], times: days }), true);
  assert.equal(candlesSpanned(5, 1, days), 0, 'empty range');
  const pi = read('../../components/charts/PatternIndicator.tsx');
  assert.match(pi, /chosen\.filter\(\(h\) => drawOtherTfStructure\(\{ display, hitTf: h\.timeframe \?\? 'D', shownTf: shown, startT: h\.startT, endT: h\.endT, times \}\)\)/);
  assert.match(pi, /drawnIds: new Set\(chosen\.map\(rowKeyOf\)\)/, 'still ticked in the list');
  assert.match(pi, /data-testid="pattern-squeezed"/, 'the list says why it is not drawn');
  assert.match(pi, /\{dock && !show && switchBtn\}/, '"Switch to …" stays on the chip');
});

test('chip words: short status, the full line stays on hover', () => {
  assert.equal(overlayChipText('patterns', '📐 Falling wedge · Daily · broke out 7 days ago · pivot ₹100.00, 4% above · shape 62/100'), '📐 Daily: Falling wedge broke out 7d');
  assert.equal(overlayChipText('patterns', '📐 No qualifying daily pattern'), '📐 No qualifying daily pattern');
  assert.equal(overlayChipText('setups', 'Trader setups · Daily · Squeeze fired · +1 more'), 'Setups: Squeeze fired · +1 more');
  assert.equal(overlayChipText('alines', 'Auto lines · Weekly · 2 trendlines · 4 levels'), 'Lines: 2 trendlines · 4 levels');
  assert.equal(overlayChipText('stage', 'Stage 2 · Advancing · confirmed 10 Aug 26'), 'Stage 2 · Advancing · confirmed 10 Aug 26');
  assert.equal(overlayChipText('stage', 'Stage Analysis: reading the weekly bars…'), 'Stage: reading the weekly bars…');
});

test('right-click menu: Clean / Research labels, ticked as set', () => {
  const base = { axis: false, price: null, cur: '$', decimals: 2, auto: true, log: false, tr: false, patterns: true, stage: true, setups: false, autoLines: true, volume: true, selected: false, light: false } as const;
  const items = chartMenuItems({ ...base, display: 'clean' });
  const by = (id: string) => items.find((x) => x.id === id)!;
  assert.equal(by('view-clean').checked, true);
  assert.equal(by('view-research').checked, false);
  assert.equal(chartMenuItems({ ...base, display: 'research' }).find((x) => x.id === 'view-research')!.checked, true);
  assert.equal(chartMenuItems({ ...base }).some((x) => x.id === 'view-clean'), false, 'absent when not given');
  assert.deepEqual(chartMenuItems({ ...base, axis: true, display: 'clean' }).map((x) => x.id), ['reset', 'fit', 'auto', 'log', 'tr'], 'price axis: scale items only');
});

test('wiring: one summary row, preset passed to every overlay (calculations untouched), point codes can be hidden', () => {
  const ws = read('../../components/charts/ChartWorkspace.tsx');
  assert.match(ws, /<OverlaySummary patterns=\{patterns\} stage=\{stageInd\} setups=\{setupsInd\} alines=\{alines\}[^>]*display=\{display\} onDisplay=\{setDisplay\}/);
  assert.doesNotMatch(ws, /<(PatternBanner|StageBanner|SetupBanner|AutoLinesBanner) /, 'no stacked banners on the page');
  assert.match(ws, /usePatternIndicator\(\{.*displayTf: tf, display \}\)/);
  assert.match(ws, /useStageIndicator\(\{[^}]*display \}\)/);
  assert.match(ws, /useSetupIndicator\(\{[^}]*display \}\)/);
  assert.match(ws, /useAutoLines\(\{[^}]*display, avoid: patterns\.pivots \}\)/);
  assert.match(ws, /case 'view-clean': setDisplay\('clean'\); break;/);
  assert.match(ws, /<IndicatorLegend top=\{legendTop\}/);
  const ks = read('../../components/charts/kline-setup.ts');
  assert.match(ks, /if \(d\.hideLabel \|\| !d\.role\) return \[ring\];/);
  const pi = read('../../components/charts/PatternIndicator.tsx');
  assert.match(pi, /hideLabel: !showCodes/);
  // display only: the detection calls take no preset
  assert.doesNotMatch(pi, /analyzePatterns\([^)]*display/);
  assert.match(read('../../components/charts/StageIndicator.tsx'), /stageMarksForDisplay\(stageMarksFor\(times, result\), display\)/);
  assert.match(read('../../components/charts/SetupIndicator.tsx'), /recentSetupPoints\(setupPointsFor\(done, series, shown\), done\.map\(\(x\) => x\.t\), display\)/);
  const ak = read('../../components/charts/auto-lines-kline.ts');
  assert.match(ak, /placeEdgeTags\(reqs, \{ mode,/);
  assert.match(ak, /const reserved = \[lastClose, \.\.\.\(ext\.avoid \|\| \[\]\)\]/);
});

test('wording: plain words, no "best", no buy / sell words in the new pieces', () => {
  for (const f of ['../chart-display.ts', '../../components/charts/OverlaySummary.tsx', '../../components/charts/overlay-dock.ts']) {
    const src = read(f);
    assert.ok(!/\bbest\b/i.test(src), `${f}: "best"`);
    assert.ok(!/\b(buy|sell|buying|selling)\b/i.test(src), `${f}: buy / sell`);
  }
  for (const it of chartMenuItems({ axis: false, price: 1, cur: '$', decimals: 2, auto: true, log: false, tr: false, patterns: true, stage: true, setups: true, autoLines: true, volume: true, selected: false, light: true, display: 'clean' })) {
    assert.doesNotMatch(it.label, /\b(best|buy|sell)\b/i);
  }
});

// ───────── fake canvas: auto-line tags, Clean vs Research ─────────
test('auto-line tags on the chart: Clean merges / caps and keeps clear of the last price; Research shows one tag per line', async () => {
  let tpl: any = null;
  const { registerAutoLinesIndicator } = await import('../../components/charts/auto-lines-kline');
  registerAutoLinesIndicator({ registerIndicator: (t: any) => { tpl = t; } } as any);
  if (!tpl) {   // already registered by another test in this process: re-import a fresh copy is not possible, so read the source instead
    assert.match(read('../../components/charts/auto-lines-kline.ts'), /mergeLevelTags\(/);
    return;
  }
  const n = 120;
  const data = Array.from({ length: n }, (_, i) => ({ timestamp: Date.UTC(2026, 0, 1) + i * DAY, open: 100, high: 101, low: 99, close: 100 }));
  const lv = (price: number, nTouch: number, kind: 'support' | 'resistance') => ({ id: `l:${kind}:${price}`, kind, strength: 60, n: nTouch, price, tA: data[5].timestamp, touches: [], prov: false });
  const payload = { lines: [], levels: [lv(130, 3, 'resistance'), lv(130.8, 5, 'resistance'), lv(131.4, 4, 'resistance'), lv(112, 3, 'resistance'), lv(100.4, 6, 'resistance'), lv(95, 3, 'support'), lv(80, 3, 'support'), lv(70, 4, 'support'), lv(60, 3, 'support')], light: true, decimals: 2 };
  const H = 600, W = 800;
  const chart = { getDataList: () => data, getVisibleRange: () => ({ from: 0, to: n, realFrom: 0, realTo: n }), getBarSpace: () => ({ bar: 6 }) };
  const xAxis = { convertToPixel: (k: number) => k * 6, convertFromPixel: (px: number) => px / 6 };
  const yAxis = { convertToPixel: (v: number) => H - (v - 50) * 6 };
  const run = (display?: string, avoid?: number[]) => {
    const texts: Array<{ t: string; y: number }> = [];
    const ctx: any = new Proxy({}, {
      get: (_o, k: string) => {
        if (k === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (k === 'fillText') return (t: string, _x: number, y: number) => { texts.push({ t, y }); };
        return () => {};
      },
      set: () => true,
    });
    tpl.draw({ ctx, chart, indicator: { extendData: { ...payload, display, avoid } }, bounding: { width: W, height: H }, xAxis, yAxis });
    return texts.filter((x) => x.t.startsWith('×'));
  };
  const research = run('research');
  assert.equal(research.length, payload.levels.length, 'Research: one tag per level');
  const clean = run('clean', [112]);
  assert.ok(clean.length < research.length, 'Clean: fewer tags');
  assert.ok(clean.length <= CLEAN_MAX_EDGE_TAGS - 2, 'Clean: capped (last price + pivot reserved)');
  assert.ok(clean.some((x) => /^×5 · ×4 · ×3 {2}130\.00–131\.40$/.test(x.t)), `merged tag: ${clean.map((x) => x.t).join(' | ')}`);
  const lastY = yAxis.convertToPixel(100), pivotY = yAxis.convertToPixel(112);
  for (const x of [...clean, ...research]) {
    assert.ok(Math.abs(x.y - lastY) >= 16 - 1e-9, `clear of the last-price tag: ${x.t}`);
  }
  for (const x of clean) assert.ok(Math.abs(x.y - pivotY) >= 16 - 1e-9, `clear of the pattern pivot tag: ${x.t}`);
  assert.ok(clean.some((x) => x.t.startsWith('×6')), 'the line next to the price (nearest) is kept');
});

// ───────── mounted summary row (JSDOM) ─────────
test('mounted: one chip per overlay; one details panel at a time; Esc and a click outside close; × turns one off; preset saved', async () => {
  const { JSDOM } = await import('jsdom');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="outside">chart</div><div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'navigator', 'self', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { self: dom.window, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  try {
    const { OverlaySummary, useChartDisplay } = await import('../../components/charts/OverlaySummary');
    const noop = () => {};
    const off: string[] = [];
    const patterns: any = { on: true, hits: [], status: 'ready', error: undefined, drawnIds: new Set<string>(), togglePick: noop, omittedLines: 0 };
    const stage: any = { on: true, banner: { text: 'Stage 2 · Advancing · confirmed 10 Aug 26', color: '#22AB94', details: [{ label: 'Close vs 30-week average', value: '+6%', ok: true }], meaning: 'Rising.' }, benchName: 'S&P 500', display: 'clean' };
    const setups: any = { on: true, status: 'ready', banner: { text: 'Trader setups · Daily · Squeeze fired', tone: 'none', more: 0 }, rows: [], prefs: { shown: {}, sqzPane: false, donchian: false }, counts: {}, dropped: false, tf: 'D', toggleType: noop, setAll: noop, toggleSqzPane: noop, toggleDonchian: noop, display: 'clean' };
    const alines: any = { on: true, status: 'ready', headline: 'Auto lines · Daily · 2 trendlines · 4 levels', refText: '', rows: [], prefs: { trend: true, levels: true }, tf: 'D', dropped: false, log: false, hover: null, hoverRow: null, toggleTrend: noop, toggleLevels: noop, display: 'clean' };
    const Probe = () => {
      const [display, setDisplay] = useChartDisplay();
      return React.createElement(OverlaySummary, { patterns, stage, setups, alines, cur: '$', tf: 'D', light: true, display, onDisplay: setDisplay, onTurnOff: (id: string) => { off.push(id); } });
    };
    await act(async () => { root.render(React.createElement(Probe)); });
    const row = document.querySelector('[data-testid="overlay-summary"]') as HTMLElement;
    assert.ok(row, 'summary row');
    for (const id of ['pattern-banner', 'stage-banner', 'setup-banner', 'aln-banner']) assert.ok(row.querySelector(`[data-testid="${id}"]`), id);
    assert.equal(row.querySelectorAll('[data-testid$="-banner"]').length, 4, 'one chip per overlay');
    assert.equal(row.style.position, 'absolute');
    assert.equal(row.style.flexWrap, 'nowrap', 'one line');
    for (const box of ['setup-banner-box', 'aln-banner-box']) assert.notEqual((row.querySelector(`[data-testid="${box}"]`) as HTMLElement).style.position, 'absolute', `${box}: in the row, not stacked`);
    // chips: short words on the chip, the full line on hover
    const chipBtn = (id: string) => row.querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement;
    assert.match(chipBtn('setup-banner').textContent!, /^Setups: Squeeze fired/);
    assert.match(chipBtn('setup-banner').title, /^Trader setups · Daily · Squeeze fired/);
    assert.match(chipBtn('aln-banner').textContent!, /^Lines: 2 trendlines · 4 levels/);
    assert.match(chipBtn('stage-banner').title, /Stage 2 · Advancing · confirmed 10 Aug 26/);
    assert.equal(chipBtn('stage-banner').style.textOverflow, 'ellipsis');
    const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.getAttribute('aria-label'));
    const press = async (el: Element) => { await act(async () => { el.dispatchEvent(new (dom.window as any).MouseEvent('mousedown', { bubbles: true })); (el as HTMLElement).click(); }); };
    await press(chipBtn('setup-banner'));
    assert.deepEqual(dialogs(), ['Trader setups']);
    await press(chipBtn('stage-banner'));
    assert.deepEqual(dialogs(), ['Stage Analysis details'], 'opening one closes the other');
    await press(chipBtn('pattern-banner'));
    assert.deepEqual(dialogs(), ['Chart patterns found']);
    assert.ok(document.querySelector('[data-testid="pattern-controls"] [data-testid="pattern-tf-A"]') || document.querySelector('[data-testid="pattern-controls"]'), 'pattern controls live in its details');
    assert.ok(document.querySelector('[data-testid="pattern-headline"]'), 'full status line in the details');
    await act(async () => { document.dispatchEvent(new (dom.window as any).KeyboardEvent('keydown', { key: 'Escape' })); });
    assert.deepEqual(dialogs(), [], 'Esc closes');
    await press(chipBtn('aln-banner'));
    assert.deepEqual(dialogs(), ['Auto trendlines & levels']);
    await act(async () => { document.getElementById('outside')!.dispatchEvent(new (dom.window as any).MouseEvent('mousedown', { bubbles: true })); });
    assert.deepEqual(dialogs(), [], 'a click outside closes');
    // × per overlay
    await act(async () => { (row.querySelector('[aria-label="Turn off Stage Analysis"]') as HTMLButtonElement).click(); });
    assert.deepEqual(off, ['stage']);
    // preset: Clean by default, Research saved and read back
    const clean = row.querySelector('[data-testid="display-clean"]') as HTMLButtonElement;
    const research = row.querySelector('[data-testid="display-research"]') as HTMLButtonElement;
    assert.equal(clean.getAttribute('aria-pressed'), 'true');
    await act(async () => { research.click(); });
    assert.equal(research.getAttribute('aria-pressed'), 'true');
    assert.equal(parseChartDisplay(localStorage.getItem(CHART_DISPLAY_KEY)), 'research', 'saved');
    await act(async () => { root.render(React.createElement('div')); });
    await act(async () => { root.render(React.createElement(Probe)); });
    assert.equal((document.querySelector('[data-testid="display-research"]') as HTMLButtonElement).getAttribute('aria-pressed'), 'true', 'read back on the next visit');
    // nothing on: no row
    await act(async () => { root.render(React.createElement(OverlaySummary, { patterns: { ...patterns, on: false }, stage: { ...stage, on: false }, setups: { ...setups, on: false }, alines: { ...alines, on: false }, cur: '$', light: false, display: 'clean', onDisplay: noop, onTurnOff: noop } as any)); });
    assert.equal(document.querySelector('[data-testid="overlay-summary"]'), null);
  } finally {
    try { await act(async () => { root.unmount(); }); } catch { /* keep the test's own failure visible */ }
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
});
