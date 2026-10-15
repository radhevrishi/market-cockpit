// zzz1025 — "Auto trendlines & levels" on /charts. Owner: auto trendlines and horizontal supports / resistances, a line only when
// it connects 3 or more touches (2 touches are never shown), on by default, on daily, weekly and monthly candles.
// Engine: lib/auto-lines; chart: components/charts/auto-lines-view, auto-lines-kline, AutoLinesIndicator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoLines, linePriceAt, pivots, MIN_TOUCHES, type AutoLinesTf } from '../auto-lines';
import type { Bar } from '../chart-math';
import { activeLayout, cleanLayout, legendRows, mergeLayoutStores, migrateAutoLines, sanitizeLayoutStore, seedLayoutStore, EXTRA_INFO, SPECIAL_EXTRAS } from '../chart-layouts';
import { alnPayload, autoLinesHeadline, autoLinesOn, autoLinesRows, parseAutoLinesPrefs, serializeAutoLinesPrefs, withAutoLines, DEFAULT_ALN_PREFS } from '../../components/charts/auto-lines-view';
import { chartMenuItems } from '../../components/charts/ChartContextMenu';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const bar = (i: number, c: number, lo?: number, hi?: number): Bar => ({ t: T0 + i * DAY, o: c, h: hi ?? c + 0.5, l: lo ?? c - 0.5, c, v: 1e6 });

/** a rising line 100 + 0.2·i; price swings 10 above it with its lows ON the line every 40 bars, from bar 20 */
const lineAt = (i: number) => 100 + 0.2 * i;
function rising(n: number, tweak?: (i: number, b: Bar) => Bar): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const wave = 10 * Math.abs(Math.sin((Math.PI * (i - 20)) / 40));   // V-shaped lows at bars 20, 60, 100 …
    const c = lineAt(i) + 0.5 + wave;
    const b = bar(i, c);
    out.push(tweak ? tweak(i, b) : b);
  }
  return out;
}
/** a flat range 100–110: lows at bars 20, 60, 100 …, highs at bars 40, 80 … */
function range(n: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) out.push(bar(i, 105 - 5 * Math.cos((2 * Math.PI * (i - 20)) / 40)));
  return out;
}
const supports = (b: Bar[], tf: AutoLinesTf = 'D') => autoLines(b, { tf }).trend.filter((l) => l.kind === 'support');
const touchIdx = (l: { touches: { i: number }[] }) => l.touches.map((t) => t.i);

test('a rising support line with exactly 3 touches is found, through its touches', () => {
  const b = rising(130);
  const s = supports(b);
  assert.equal(s.length, 1, 'one line (near-duplicate lines merged)');
  const l = s[0];
  assert.equal(l.dir, 'rising');
  assert.equal(l.state, 'intact');
  assert.deepEqual(touchIdx(l), [20, 60, 100]);
  for (const i of [20, 60, 100]) assert.ok(Math.abs(linePriceAt(l, i) - lineAt(i)) < 0.05, `on the line at ${i}`);
  assert.ok(l.slopePctPerBar > 0 && l.slopePctPerWeek > l.slopePctPerBar);
  assert.ok(l.strength > 0 && l.strength <= 100);
  assert.ok(l.distPct > 0, 'price above a support line');
});

test('owner rule: a line with only 2 touches is never shown', () => {
  assert.equal(MIN_TOUCHES, 3);
  const b = rising(90);   // valleys at 20 and 60 only
  assert.equal(supports(b).length, 0);
  // the peaks (40, 80) are two touches too: no resistance line either
  assert.equal(autoLines(b, { tf: 'D' }).trend.length, 0);
});

test('a close through the line between its touches rejects it (a wick through it is allowed)', () => {
  const cut = rising(130, (i, b) => (i === 45 ? { ...b, o: b.c, c: lineAt(i) - 4, l: lineAt(i) - 4.5, h: b.c } : b));
  for (const l of supports(cut)) assert.ok(!(touchIdx(l).includes(20) && touchIdx(l).includes(100)), 'no line from 20 to 100 across the close below it');
  // the same dip as a wick only (close back above the line) does not reject it
  const wick = rising(130, (i, b) => (i === 45 ? { ...b, l: lineAt(i) - 4 } : b));
  assert.ok(supports(wick).some((l) => touchIdx(l).includes(20) && touchIdx(l).includes(100)));
});

test('a close beyond the line after the last touch marks it broken, with the break bar', () => {
  const b = rising(135, (i, x) => (i >= 121 ? bar(i, lineAt(i) - 4) : x));
  const s = supports(b);
  const l = s.find((x) => touchIdx(x).includes(20) && touchIdx(x).includes(100));
  assert.ok(l, 'still listed (broken recently)');
  assert.equal(l!.state, 'broken');
  assert.equal(l!.breakIndex, 121);
  assert.ok(l!.distPct < 0, 'price now below the line');
});

test('horizontal level: 3 touches found, 2 touches not', () => {
  const r = autoLines(range(110), { tf: 'D' });
  const lows = r.levels.filter((l) => Math.abs(l.price - 99.5) < 0.6);
  assert.equal(lows.length, 1);
  assert.equal(lows[0].touches.length, 3);
  assert.equal(lows[0].kind, 'support');
  assert.ok(lows[0].distPct > 0);
  assert.ok(!r.levels.some((l) => Math.abs(l.price - 110.5) < 0.6), 'the 110.5 highs touched only twice');
  assert.equal(r.trend.length, 0, 'flat lines are levels, not trendlines');
  // with a third high the resistance appears
  const r2 = autoLines(range(130), { tf: 'D' });
  const highs = r2.levels.filter((l) => Math.abs(l.price - 110.5) < 0.6);
  assert.equal(highs.length, 1);
  assert.equal(highs[0].kind, 'resistance');
  assert.ok(highs[0].touches.length >= 3);
});

test('levels: never two on top of each other; at most 3 per side', () => {
  const r = autoLines(range(400), { tf: 'D' });
  const ps = r.levels.map((l) => l.price).sort((a, b) => a - b);
  for (let k = 1; k < ps.length; k++) assert.ok(ps[k] / ps[k - 1] - 1 > 0.01, 'separate levels');
  assert.ok(r.levels.filter((l) => l.kind === 'support').length <= 3);
  assert.ok(r.levels.filter((l) => l.kind === 'resistance').length <= 3);
  for (const l of r.levels) assert.ok(l.touches.length >= 3);
});

test('pivots: fractal highs and lows; deterministic results', () => {
  const b = rising(130);
  assert.deepEqual(pivots(b, 5, 'low'), [20, 60, 100]);
  assert.deepEqual(JSON.stringify(autoLines(b, { tf: 'D' })), JSON.stringify(autoLines(b, { tf: 'D' })));
  assert.deepEqual(autoLines([], { tf: 'W' }).trend, []);
  assert.deepEqual(autoLines(b.slice(0, 10), { tf: 'M' }).levels, []);
});

test('weekly and monthly use their own swing sizes and tolerances; log price on a long monthly move', () => {
  const b = rising(130);
  assert.ok(supports(b, 'W').some((l) => touchIdx(l).includes(20) && touchIdx(l).includes(100)));
  // a 3× monthly move is read in % terms; a log chart is too
  const m: Bar[] = [];
  for (let i = 0; i < 80; i++) { const base = 10 * Math.exp(0.02 * i); const wave = 1 + 0.3 * Math.abs(Math.sin((Math.PI * (i - 10)) / 20)); m.push(bar(i, base * wave, base * wave * 0.99, base * wave * 1.01)); }
  const rm = autoLines(m, { tf: 'M' });
  assert.equal(rm.log, true);
  assert.ok(rm.trend.some((l) => l.kind === 'support' && l.touches.length >= 3 && l.log), 'the exponential support line in % terms');
  assert.equal(autoLines(b, { tf: 'D', log: true }).log, true);
  assert.equal(autoLines(b, { tf: 'D' }).log, false);
});

test('timing: under 50 ms for 1,500 bars', () => {
  let x = 11, c = 100;
  const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const b: Bar[] = [];
  for (let i = 0; i < 1500; i++) { const o = c; c *= 1 + (rnd() - 0.48) * 0.035; b.push({ t: T0 + i * DAY, o, h: Math.max(o, c) * (1 + rnd() * 0.01), l: Math.min(o, c) * (1 - rnd() * 0.01), c, v: 1e6 }); }
  for (let k = 0; k < 20; k++) autoLines(b, { tf: 'D' });   // warm up: the engine compiled (the browser runs it once per bar set)
  let ms = Infinity;
  for (let k = 0; k < 7; k++) { const t0 = performance.now(); autoLines(b, { tf: 'D' }); ms = Math.min(ms, performance.now() - t0); }
  // a busy test machine (parallel test files) is allowed proportionally more: a fixed loop that takes ~10 ms on a free one
  let calib = Infinity;
  for (let k = 0; k < 3; k++) { const t0 = performance.now(); const a = new Float64Array(1500); let acc = 0; for (let r = 0; r < 2000; r++) for (let i = 0; i < 1500; i++) { a[i] = a[i] * 0.5 + i; acc += a[i]; } if (acc < 0) throw new Error('x'); calib = Math.min(calib, performance.now() - t0); }
  const slow = Math.max(1, calib / 10);
  assert.ok(ms < 50 * slow, `took ${ms.toFixed(1)} ms (machine factor ${slow.toFixed(1)})`);
});

test('layout: ALN is a special extra (own row, no legend row), with / on helpers', () => {
  assert.ok(SPECIAL_EXTRAS.has('ALN'));
  assert.equal(EXTRA_INFO.ALN.label, 'Auto trendlines & levels');
  const l = activeLayout(seedLayoutStore(0));
  assert.equal(autoLinesOn(l), false);
  const on = withAutoLines(l, true);
  assert.equal(autoLinesOn(on), true);
  assert.equal(withAutoLines(on, true).extras.filter((e) => e.type === 'ALN').length, 1, 'never two');
  assert.equal(legendRows(on).length, legendRows(l).length);
  assert.equal(autoLinesOn(cleanLayout(JSON.parse(JSON.stringify(on)))), true);
  assert.equal(autoLinesOn(withAutoLines(on, false)), false);
});

test('default on: the one-time migration adds it to every layout once; a later turn-off stays off', () => {
  const s0 = seedLayoutStore(5);
  const m = migrateAutoLines(s0);
  assert.equal(m.aln, 1);
  assert.ok(m.layouts.every((l) => autoLinesOn(l)), 'on in every layout');
  assert.deepEqual(m.layouts.map((l) => l.updatedAt), s0.layouts.map((l) => l.updatedAt), 'save times unchanged');
  assert.equal(migrateAutoLines(m), m, 'second run: nothing changes');
  // he turns it off in the first layout and saves; reloading (sanitize + migrate) keeps it off
  const off = { ...m, layouts: m.layouts.map((l, k) => (k === 0 ? { ...withAutoLines(l, false), updatedAt: 9 } : l)) };
  const back = migrateAutoLines(sanitizeLayoutStore(JSON.parse(JSON.stringify(off))));
  assert.equal(autoLinesOn(back.layouts[0]), false);
  assert.equal(autoLinesOn(back.layouts[1]), true);
  // a merge with an older copy from before the change keeps the flag and the newer choice
  const merged = mergeLayoutStores(back, JSON.parse(JSON.stringify(s0)));
  assert.equal(merged.aln, 1);
  assert.equal(autoLinesOn(migrateAutoLines(merged).layouts[0]), false);
});

test('chart-storage: an old saved store is migrated once on load (with the unsaved draft), then left alone', async () => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); } };
  try {
    const { loadLayoutStore, saveLayoutStore } = await import('../chart-storage');
    const old = seedLayoutStore(1);
    mem.set('mc:chart-layouts:v1', JSON.stringify(old));
    mem.set('mc:chart-layout-draft:v1', JSON.stringify({ id: old.activeId, working: { ...old.layouts[0], lines: [] }, at: 1 }));
    const a = loadLayoutStore();
    assert.equal(a.aln, 1);
    assert.ok(a.layouts.every((l) => autoLinesOn(l)));
    assert.equal(JSON.parse(mem.get('mc:chart-layouts:v1')!).aln, 1, 'written back');
    assert.ok(autoLinesOn(JSON.parse(mem.get('mc:chart-layout-draft:v1')!).working), 'draft too');
    // turned off and saved: stays off on the next load
    saveLayoutStore({ ...a, layouts: a.layouts.map((l) => withAutoLines(l, false)) });
    assert.ok(loadLayoutStore().layouts.every((l) => !autoLinesOn(l)));
    // first visit (nothing saved): seeded with it on
    mem.clear();
    assert.ok(loadLayoutStore().layouts.every((l) => autoLinesOn(l)));
  } finally { delete (globalThis as any).localStorage; }
});

test('chart payload: timestamps of the bars, per-viewer show / hide; banner and list words', () => {
  const b = rising(130);
  const r = autoLines(b, { tf: 'D' });
  const p = alnPayload(b, r, DEFAULT_ALN_PREFS, false, 2);
  const ts = new Set(b.map((x) => x.t));
  assert.ok(p.lines.length >= 1);
  for (const l of p.lines) { assert.ok(ts.has(l.tA)); for (const [t] of l.touches) assert.ok(ts.has(t)); assert.ok(l.n >= 3); }
  assert.equal(alnPayload(b, r, { trend: false, levels: true }, false, 2).lines.length, 0);
  assert.deepEqual(parseAutoLinesPrefs(serializeAutoLinesPrefs({ trend: false, levels: true })), { trend: false, levels: true });
  assert.deepEqual(parseAutoLinesPrefs('{bad'), DEFAULT_ALN_PREFS);
  assert.match(autoLinesHeadline(r, 'D', 'ready'), /^Auto lines · Daily · \d trendlines? · \d levels?$/);
  assert.match(autoLinesHeadline({ trend: [], levels: [], log: false, tolPct: 0 }, 'D', 'ready'), /no line with 3\+ touches near price/);
  assert.match(autoLinesHeadline(r, 'W', 'loading'), /Weekly · reading the bars/);
  assert.match(autoLinesHeadline(null, 'M', 'short'), /too little history/);
  const rows = autoLinesRows(b, r, 'D');
  assert.match(rows[0].title, /^Rising support line/);
  assert.match(rows[0].detail, /^3 touches/);
  assert.match(rows[0].tip, /3 touches: /);
});

test('right-click menu and Indicators panel offer it; the page stacks its status line', () => {
  const items = chartMenuItems({ axis: false, price: null, cur: '$', decimals: 2, auto: true, log: false, tr: false, patterns: false, stage: false, setups: false, autoLines: true, volume: true, selected: false, light: false });
  const it = items.find((x) => x.id === 'alines');
  assert.ok(it && it.checked === true && it.label === 'Auto trendlines & levels');
  const ws = read('../../components/charts/ChartWorkspace.tsx');
  assert.ok(ws.includes("case 'alines': L.setWorking((w) => withAutoLines(w, !autoLinesOn(w)))"));
  // zzz1029 — one overlay summary row; the legend under it
  assert.ok(read('../../components/charts/OverlaySummary.tsx').includes('<AutoLinesBanner s={alines}'));
  assert.ok(ws.includes('const legendTop = nOverlays ? 4 + overlayRowH + 4 : 28;'));   // zzz1031 — under the (possibly wrapped) overlay row
  assert.ok(read('../../components/charts/LayoutControls.tsx').includes('withAutoLines(l, e.target.checked)'));
});

test('wording: plain words, no "best", no buy / sell words', () => {
  for (const f of ['../auto-lines.ts', '../../components/charts/auto-lines-view.ts', '../../components/charts/auto-lines-kline.ts', '../../components/charts/AutoLinesIndicator.tsx']) {
    const src = read(f);
    assert.ok(!/\bbest\b/i.test(src), `${f}: "best"`);
    assert.ok(!/\b(buy|sell|buying|selling)\b/i.test(src), `${f}: buy / sell`);
  }
});

test('chart drawing: lines, touch rings and stacked right-edge tags are drawn without errors (fake canvas)', async () => {
  let tpl: any = null;
  const { registerAutoLinesIndicator } = await import('../../components/charts/auto-lines-kline');
  registerAutoLinesIndicator({ registerIndicator: (t: any) => { tpl = t; } } as any);
  assert.ok(tpl && tpl.name === 'MC_ALINES' && tpl.figures.length === 0, 'no figures: never changes the price axis');
  const b = rising(130);
  const r = autoLines(range(130), { tf: 'D' });
  const r2 = autoLines(b, { tf: 'D' });
  const payload = alnPayload(b, { ...r2, levels: r.levels }, DEFAULT_ALN_PREFS, true, 2);
  const calls: string[] = [];
  const texts: Array<{ t: string; y: number }> = [];
  const ctx: any = new Proxy({}, {
    get: (_o, k: string) => {
      if (k === 'measureText') return (t: string) => ({ width: t.length * 6 });
      if (k === 'fillText') return (t: string, _x: number, y: number) => { texts.push({ t, y }); calls.push('fillText'); };
      return (..._a: unknown[]) => { calls.push(k); };
    },
    set: () => true,
  });
  const data = b.map((x) => ({ timestamp: x.t, open: x.o, high: x.h, low: x.l, close: x.c }));
  const chart = { getDataList: () => data, getVisibleRange: () => ({ from: 0, to: data.length, realFrom: 0, realTo: data.length }), getBarSpace: () => ({ bar: 6, halfBar: 3, gapBar: 2, halfGapBar: 1 }) };
  const H = 400, W = 800;
  const xAxis = { convertToPixel: (k: number) => k * 6, convertFromPixel: (px: number) => px / 6 };
  const yAxis = { convertToPixel: (v: number) => H - (v - 90) * 6 };
  tpl.draw({ ctx, chart, indicator: { extendData: { ...payload, hover: payload.lines[0]?.id ?? null } }, bounding: { width: W, height: H, left: 0, top: 0, right: 0, bottom: 0 }, xAxis, yAxis });
  assert.ok(calls.includes('stroke') && calls.includes('arc'), 'lines and rings');
  const tags = texts.filter((x) => x.t.startsWith('×'));
  assert.ok(tags.length >= 2);
  const ys = tags.map((x) => x.y).sort((a, c) => a - c);
  for (let k = 1; k < ys.length; k++) assert.ok(ys[k] - ys[k - 1] >= 15, 'tags never overlap');
  assert.equal(tpl.draw({ ctx, chart, indicator: { extendData: undefined }, bounding: { width: W, height: H }, xAxis, yAxis }), false);
});
