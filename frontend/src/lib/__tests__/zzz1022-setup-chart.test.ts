// zzz1022 — "Trader setups" on /charts: the chart side of lib/setups (zzz1020). Owner: well-known traders' setups automated on the
// chart. An Indicators ▾ entry 'Trader setups' (extra 'SET'), tags on the candles on screen (D / W / M), the latest Darvas boxes,
// optional Donchian 20 lines and squeeze pane, a status line with a list (a checkbox per type, saved in 'mc:chart-setups:v1').
// A still-forming last candle is left out. Our own version of the published rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupSeries, SETUP_META, type SetupBar, type SetupCode } from '../setups';
import { aggregateBars } from '../chart-math';
import { activeLayout, seedLayoutStore, legendRows, SPECIAL_EXTRAS, EXTRA_INFO, cleanLayout } from '../chart-layouts';
import {
  SETUP_CODES, SETUP_TAG, SETUP_PREFS_KEY, completedBars, countsInRange, defaultSetupPrefs, lastBarForming, parseSetupPrefs, serializeSetupPrefs,
  setupBannerRows, setupBoxesFor, setupHeadline, setupPointsFor, setupsOn, squeezePointsFor, tagOf, withSetups, donchianPointsFor,
} from '../../components/charts/setup-view';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;
const MON = Date.UTC(2024, 0, 1);   // a Monday
const dayT = (i: number) => { const w = Math.floor(i / 5), d = i % 5; return MON + (w * 7 + d) * DAY; };
type Spec = { c: number; o?: number; h?: number; l?: number; v?: number };
function bars(specs: Spec[]): SetupBar[] {
  return specs.map((s, i) => {
    const o = s.o ?? (i ? specs[i - 1].c : s.c);
    return { t: dayT(i), o, h: s.h ?? Math.max(o, s.c) * 1.005, l: s.l ?? Math.min(o, s.c) * 0.995, c: s.c, v: s.v ?? 1_000_000 };
  });
}
/** a wavy series with a trend so most setups get a chance */
function wavy(n: number, seed = 7): SetupBar[] {
  let x = seed, c = 100;
  const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    c *= 1 + (rnd() - 0.47) * 0.04 + Math.sin(i / 25) * 0.004;
    out.push({ c, v: 800_000 + rnd() * 900_000 });
  }
  return bars(out);
}

test('layout: SET is a special extra (own row, no legend row); with / on helpers', () => {
  assert.ok(SPECIAL_EXTRAS.has('SET'));
  assert.equal(EXTRA_INFO.SET.label, 'Trader setups');
  const l = activeLayout(seedLayoutStore(0));
  assert.equal(setupsOn(l), false);
  const on = withSetups(l, true);
  assert.equal(setupsOn(on), true);
  assert.equal(on.extras.filter((x) => x.type === 'SET').length, 1);
  assert.equal(setupsOn(withSetups(withSetups(on, true), true)), true);
  assert.equal(withSetups(withSetups(on, true), true).extras.filter((x) => x.type === 'SET').length, 1, 'never two');
  assert.equal(legendRows(on).length, legendRows(l).length, 'no legend row');
  assert.equal(setupsOn(withSetups(on, false)), false);
  // survives the layout clean-up (saved layouts)
  assert.equal(setupsOn(cleanLayout(JSON.parse(JSON.stringify(on)))), true);
});

test('setupPointsFor: timestamps are the bars\' own; per-type filter; same events as setupSeries', () => {
  const b = wavy(400);
  const s = setupSeries(b);
  const pts = setupPointsFor(b, s);
  assert.equal(pts.length, s.events.length);
  const ts = new Set(b.map((x) => x.t));
  for (const [t, code, dir] of pts) { assert.ok(ts.has(t)); assert.ok(SETUP_CODES.includes(code)); assert.ok(dir === 1 || dir === -1); }
  s.events.forEach((e, k) => assert.equal(pts[k][0], b[e.i].t));
  // computed from bars alone gives the same
  assert.deepEqual(setupPointsFor(b), pts);
  const noDc = setupPointsFor(b, s, (c) => c !== 'DC20');
  assert.equal(noDc.some((p) => p[1] === 'DC20'), false);
  assert.equal(noDc.length, pts.filter((p) => p[1] !== 'DC20').length);
  // boxes / Donchian / squeeze points carry the bars' timestamps
  for (const bx of setupBoxesFor(b, s)) { assert.ok(ts.has(bx.fromT) && ts.has(bx.toT)); assert.ok(bx.top > bx.bottom); }
  assert.ok(setupBoxesFor(b, s).length <= 3);
  const dc = donchianPointsFor(b, s);
  assert.equal(dc.length, b.length); assert.equal(dc[0][1], null); assert.ok(dc[25][1] != null);
  const sq = squeezePointsFor(b, s);
  assert.equal(sq.length, b.length); assert.equal(sq[0][0], b[0].t);
});

test('weekly bars give weekly events (timestamps on the weekly candles)', () => {
  const d = wavy(1300, 11);
  const w = aggregateBars(d, 'W');
  const s = setupSeries(w);
  const pts = setupPointsFor(w, s);
  const wts = new Set(w.map((x) => x.t));
  assert.ok(pts.length > 0, 'some weekly events');
  for (const [t] of pts) assert.ok(wts.has(t), 'on a weekly candle');
  // every weekly candle is a Monday here
  for (const [t] of pts) assert.equal(new Date(t).getUTCDay(), 1);
});

test('forming last candle: daily before / after the close, weekly / monthly by period end; left out', () => {
  const t = Date.UTC(2026, 9, 14);   // Wed 14 Oct 2026, a daily bar at 00:00 UTC
  assert.equal(lastBarForming(t, 'D', 'US', Date.UTC(2026, 9, 14, 18)), true, 'US session still open at 18:00 UTC');
  assert.equal(lastBarForming(t, 'D', 'US', Date.UTC(2026, 9, 14, 21, 1)), false);
  assert.equal(lastBarForming(t, 'D', 'US', Date.UTC(2026, 9, 14, 20, 5)), false, 'summer time: New York closes at 20:00 UTC');
  assert.equal(lastBarForming(Date.UTC(2026, 11, 14), 'D', 'US', Date.UTC(2026, 11, 14, 20, 30)), true, 'winter: closes at 21:00 UTC');
  assert.equal(lastBarForming(t, 'D', 'IN', Date.UTC(2026, 9, 14, 9)), true);
  assert.equal(lastBarForming(t, 'D', 'IN', Date.UTC(2026, 9, 14, 11)), false);
  assert.equal(lastBarForming(t, 'D', 'US', Date.UTC(2026, 9, 15, 3)), false, 'next day');
  const wk = Date.UTC(2026, 9, 12);   // Monday
  assert.equal(lastBarForming(wk, 'W', 'US', Date.UTC(2026, 9, 16, 22)), true, 'Friday evening: the week closes at Saturday 00:00 UTC');
  assert.equal(lastBarForming(wk, 'W', 'US', Date.UTC(2026, 9, 17, 1)), false);
  assert.equal(lastBarForming(Date.UTC(2026, 9, 1), 'M', 'US', Date.UTC(2026, 9, 20)), true);
  assert.equal(lastBarForming(Date.UTC(2026, 8, 1), 'M', 'US', Date.UTC(2026, 9, 20)), false);
  const b = wavy(30);
  const now = b[b.length - 1].t + 2 * 3_600_000;
  const r = completedBars(b, 'D', 'US', now);
  assert.equal(r.dropped, true); assert.equal(r.bars.length, b.length - 1); assert.equal(r.bars[0], b[0]);
  assert.equal(completedBars(b, 'D', 'US', now + DAY).dropped, false);
});

test('banner: Darvas box with top and distance, recent event leads, hidden types left out, headline words', () => {
  // a 252-bar climb to a high, then a box: 3 bars under the top, a bottom confirmed by 3 bars, price inside near the top
  const specs: Spec[] = Array.from({ length: 260 }, (_, i) => ({ c: 50 + i * 0.25 }));
  const top = 50 + 259 * 0.25;   // ≈ 114.75
  specs.push({ c: top - 2, h: top - 1.5 }, { c: top - 4, h: top - 3 }, { c: top - 6, h: top - 5, l: top - 8 }, { c: top - 5, h: top - 4.5, l: top - 7 },
    { c: top - 3, h: top - 2.5, l: top - 6 }, { c: top - 2.2, h: top - 2, l: top - 5 });
  const b = bars(specs);
  const s = setupSeries(b);
  const box = s.darvas[s.darvas.length - 1];
  assert.ok(box && box.state === 'inside' && box.to === b.length - 1, 'price inside a confirmed box');
  const rows = setupBannerRows(b, s, 'D');
  const dv = rows.find((r) => r.code === 'DVX' && r.state)!;
  assert.ok(dv, 'Darvas row');
  assert.match(dv.text, /^Darvas box · top [\d,.]+ · \d+\.\d% below · bottom [\d,.]+$/);
  assert.ok(dv.distPct! < 0);
  assert.match(dv.short, /^Darvas box top [\d,.]+ \(\d+\.\d% below\)$/);
  const head = setupHeadline(rows, 'W');
  assert.match(head.text, /^Trader setups · Weekly · /);
  assert.ok(head.text.includes('Darvas box top'));
  // hiding DVX removes it from the banner
  assert.equal(setupBannerRows(b, s, 'D', (c) => c !== 'DVX').some((r) => r.code === 'DVX'), false);
  // nothing → plain words
  assert.equal(setupHeadline([], 'D').text, 'Trader setups · Daily · no setup on the last 10 bars');
  assert.equal(setupHeadline([], 'M', 'loading').text, 'Trader setups · Monthly · reading the bars…');
});

test('banner: squeeze fired N bars ago leads; age words; events older than the window are not active', () => {
  const b = wavy(500, 3);
  const s = setupSeries(b);
  const L = b.length - 1;
  const fired = [...s.events].reverse().find((e) => e.code === 'SQZF');
  assert.ok(fired, 'a squeeze fired somewhere');
  // cut the bars 2 bars after it fired
  const cut = b.slice(0, fired!.i + 3);
  const s2 = setupSeries(cut);
  const rows = setupBannerRows(cut, s2, 'D');
  const r = rows.find((x) => x.code === 'SQZF')!;
  assert.ok(r, 'squeeze-fired row');
  assert.equal(r.age, 2);
  assert.match(r.text, new RegExp(`^Squeeze fired ${fired!.dir === 1 ? 'up' : 'down'} · 2 bars ago`));
  assert.ok(rows.every((x) => x.state || x.age < 10));
  void L;
  // the headline leads with the most recent event
  const lead = setupBannerRows(cut, s2, 'D')[0];
  assert.ok(lead.state || lead.age <= r.age);
});

test('per-type prefs: NR7 / IB off by default; parse / serialize; garbage gives defaults', () => {
  const d = defaultSetupPrefs();
  assert.equal(d.shown.NR7, false); assert.equal(d.shown.IB, false); assert.equal(d.shown.DVX, true); assert.equal(d.sqzPane, false); assert.equal(d.donchian, false);
  const p = { ...d, shown: { ...d.shown, EP: false, NR7: true }, sqzPane: true };
  assert.deepEqual(parseSetupPrefs(serializeSetupPrefs(p)), p);
  assert.deepEqual(parseSetupPrefs('{oops'), d);
  assert.deepEqual(parseSetupPrefs(JSON.stringify({ shown: { EP: 'x', ZZZ: true } })), d);
  assert.equal(SETUP_PREFS_KEY, 'mc:chart-setups:v1');
  // every code has a tag; the squeeze-fired tag carries its direction
  for (const c of SETUP_CODES) assert.ok(SETUP_TAG[c]);
  assert.equal(tagOf('SQZF', 1), 'SQZ↑'); assert.equal(tagOf('SQZF', -1), 'SQZ↓'); assert.equal(tagOf('GV', 1), 'GAP'); assert.equal(tagOf('DVX', 1), 'DBX');
  assert.deepEqual(new Set(SETUP_CODES), new Set(Object.keys(SETUP_META) as SetupCode[]));
});

test('counts in view', () => {
  const b = wavy(300);
  const s = setupSeries(b);
  const all = countsInRange(s, 0, b.length);
  assert.equal(Object.values(all).reduce((a, n) => a + (n || 0), 0), s.events.length);
  const half = countsInRange(s, 150, 300);
  assert.equal(Object.values(half).reduce((a, n) => a + (n || 0), 0), s.events.filter((e) => e.i >= 150).length);
});

test('wording: no best / Buy / Sell in the setup chart files; says our own version', () => {
  const files = ['../../components/charts/setup-view.ts', '../../components/charts/SetupIndicator.tsx', '../../components/charts/setup-kline.ts'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\bbest\b/i, f);
    assert.doesNotMatch(src, /\b(buy|sell)\b/i, f);
  }
  assert.match(read('../../components/charts/SetupIndicator.tsx'), /our own version of the published rules/);
  assert.match(read('../../components/charts/LayoutControls.tsx'), /Our own version of the published rules\./);
  // banner text from real data never says buy / sell
  const b = wavy(500, 5);
  const s = setupSeries(b);
  for (const r of setupBannerRows(b, s, 'D')) assert.doesNotMatch(`${r.text} ${r.short}`, /\bbest\b|\bbuy\b|\bsell\b/i);
});

test('wiring: Indicators panel, workspace hook + banner stacked under the other banners, lazy chart indicators', () => {
  const lc = read('../../components/charts/LayoutControls.tsx');
  assert.match(lc, /checked=\{setupsOn\(w\)\} onChange=\{\(e\) => setW\(\(l\) => withSetups\(l, e\.target\.checked\)\)\}/);
  assert.match(lc, /position: 'absolute', left: 8, top, zIndex: 5/);
  const ws = read('../../components/charts/ChartWorkspace.tsx');
  assert.match(ws, /useSetupIndicator\(\{ on: setupsOn\(L\.working\), ready, market, bars, tf, chartRef, light: chartLight(, display)? \}\)/);
  // zzz1029 — the status lines are chips in one overlay summary row (OverlaySummary), not stacked banners
  assert.match(ws, /<OverlaySummary patterns=\{patterns\} stage=\{stageInd\} setups=\{setupsInd\} alines=\{alines\}/);
  assert.match(ws, /else if \(id === 'setups'\) L\.setWorking\(\(w\) => withSetups\(w, false\)\);/);
  assert.match(read('../../components/charts/OverlaySummary.tsx'), /<SetupBanner s=\{setups\} light=\{light\} onTurnOff=\{\(\) => onTurnOff\('setups'\)\} dock=\{docks\.setups\} \/>/);
  assert.match(ws, /<IndicatorLegend top=\{legendTop\}/);
  const si = read('../../components/charts/SetupIndicator.tsx');
  assert.match(si, /await import\('\.\/setup-kline'\)/);
  assert.match(si, /completedBars\(bars, tf, mkt\)/);
  assert.match(si, /localStorage\.setItem\(SETUP_PREFS_KEY/);
  assert.match(si, /e\.key === 'Escape'/);
  const sk = read('../../components/charts/setup-kline.ts');
  assert.match(sk, /name: 'MC_SETUPS'/); assert.match(sk, /name: 'MC_SQZ'/);
});

// ───────── mounted hook + banner (JSDOM) ─────────
test('mounted: banner reads the bars, list opens with a checkbox per type, unticking persists, Esc closes', async () => {
  const { JSDOM } = await import('jsdom');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'navigator', 'self', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { self: dom.window, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  try {
    const { useSetupIndicator, SetupBanner } = await import('../../components/charts/SetupIndicator');
    const b = wavy(400, 9).map((x, i) => ({ ...x, t: Date.UTC(2020, 0, 1) + i * DAY }));   // old dates: nothing forming
    const Probe = () => { const s = useSetupIndicator({ on: true, ready: false, market: 'US', bars: b, tf: 'D', chartRef: { current: null }, light: true }); return React.createElement(SetupBanner, { s, light: true, onTurnOff: () => {} }); };
    await act(async () => { root.render(React.createElement(Probe)); });
    const head = () => Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').startsWith('Trader setups'))!;
    assert.ok(head(), 'banner');
    assert.match(head().textContent!, /^Trader setups · Daily · /);
    await act(async () => { head().click(); });
    for (const c of SETUP_CODES) assert.ok(document.querySelector(`[data-testid="setup-type-${c}"]`), c);
    const nr7 = document.querySelector('[data-testid="setup-type-NR7"] input') as HTMLInputElement;
    assert.equal(nr7.checked, false, 'NR7 off by default');
    const dv = document.querySelector('[data-testid="setup-type-DVX"] input') as HTMLInputElement;
    assert.equal(dv.checked, true);
    await act(async () => { dv.click(); });
    assert.equal((document.querySelector('[data-testid="setup-type-DVX"] input') as HTMLInputElement).checked, false);
    assert.equal(parseSetupPrefs(localStorage.getItem(SETUP_PREFS_KEY)).shown.DVX, false, 'saved');
    const title = (document.querySelector('[data-testid="setup-type-EP"]') as HTMLElement).title;
    assert.ok(title.includes(SETUP_META.EP.method) && title.includes(SETUP_META.EP.rule));
    await act(async () => { document.dispatchEvent(new (dom.window as any).KeyboardEvent('keydown', { key: 'Escape' })); });
    assert.equal(document.querySelector('[data-testid="setup-type-DVX"]'), null, 'Esc closes the list');
  } finally {
    try { await act(async () => { root.unmount(); }); } catch { /* keep the test's own failure visible */ }
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
});
