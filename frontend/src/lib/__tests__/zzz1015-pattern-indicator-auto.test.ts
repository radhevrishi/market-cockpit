// zzz1015 — chart "Automate chart patterns": Analysis Auto. Owner: "most charts show No qualifying pattern on daily, weekly,
// monthly". The D / W / M choice was remembered for every chart: once set to M, every chart read monthly bars (5 of 116 audit charts
// have a monthly pattern) while e.g. HAL's daily bars show "Falling wedge · Daily · broke out 7 days ago".
//  • Auto (new default; a choice stored before zzz1015 reads as Auto): D, W and M are read together and the most relevant current
//    structure leads (current first, the timeframe on screen wins a tie); the 10-year history for M is one shared request
//  • an explicit D / W / M with nothing current names another timeframe's current structure instead of a bare "no pattern"
//  • nothing anywhere: "No textbook pattern on D/W/M · last: … · N weaker candidates" with a one-click "show weaker"
//  • the list is grouped by timeframe with counts; rows are keyed by timeframe + pattern
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePatterns, analyzeDailyAs, type PBar, type PatternHit } from '../chart-patterns';
import { _resetChartLoadCache } from '../chart-load-cache';
import {
  parsePatternTfPref, serializePatternTfPref, DEFAULT_PATTERN_TF, patternView, pickHeadlineTf, multiBanner, crossTfWords, currentTier, rowKeyOf,
  viewRelevance, TF_TIE_EPS, type TfViews,
} from '../../components/charts/pattern-view';

const DAY = 86_400_000;
// ───────── generator (the zzz981 one: legs of [days, target, shape], weekdays only, seeded noise) ─────────
type Leg = [number, number, ('lin' | 'ease')?];
interface GenOpt { start?: number; seed?: number; noise?: number; spread?: number; vol?: (i: number, n: number) => number; t0?: number; history?: number }
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
function gen(legs: Leg[], opt: GenOpt = {}): PBar[] {
  const r = rng(opt.seed ?? 7);
  const noise = opt.noise ?? 0.003, spread = opt.spread ?? 0.005;
  const path: number[] = new Array((opt.history ?? 300) + 1).fill(opt.start ?? legs[0][1]);
  for (const [d, to, shape] of legs) {
    const from = path[path.length - 1];
    for (let k = 1; k <= d; k++) { const x = k / d; path.push(from + (to - from) * (shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x)); }
  }
  const bars: PBar[] = [];
  let t = opt.t0 ?? Date.UTC(2018, 0, 1), prevC = path[0];
  for (let i = 0; i < path.length; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 2 * noise), o = prevC;
    bars.push({ t, o, h: Math.max(o, c) * (1 + spread * (0.3 + 0.7 * r())), l: Math.min(o, c) * (1 - spread * (0.3 + 0.7 * r())), c, v: opt.vol ? opt.vol(i, path.length) : 1_000_000 * (0.8 + 0.4 * r()) });
    prevC = c; t += DAY;
    while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
  }
  return bars;
}
/** D and W have a current flat base, M has nothing */
const LEGS_B: Leg[] = [[400, 50], [300, 100], [40, 92, 'ease'], [30, 99, 'ease'], [20, 95], [15, 99.5]];
/** D and W only weaker candidates, M a current VCP */
const LEGS_C: Leg[] = [[600, 40], [500, 100], [60, 85], [60, 100], [40, 90], [20, 99]];

const H = (o: Partial<PatternHit> = {}): PatternHit => ({
  id: 'falling_wedge', label: 'Falling wedge', bias: 'bullish', family: 'reversal', stage: 'breakout', confidence: 0.62, likelihood: 'likely',
  startT: 0, endT: 10 * DAY, lengthBars: 30, depthPct: 20, pivot: 100, distToPivotPct: 4, note: '', lines: [], timeframe: 'D', breakAgo: 7, ...o,
});
const v = (hits: PatternHit[], tf: 'D' | 'W' | 'M', extra: { weak?: PatternHit[]; expired?: PatternHit[]; status?: any } = {}) => patternView({ hits, tf, ...extra });

// ───────── stored choice ─────────
test('zzz1015 pref: default Auto; a choice stored before Auto (no version) reads as Auto; an explicit choice made now is kept', () => {
  assert.deepEqual(DEFAULT_PATTERN_TF, { tf: 'A', provisional: false });
  assert.deepEqual(parsePatternTfPref(null), { tf: 'A', provisional: false });
  for (const old of ['M', 'W', 'D']) assert.deepEqual(parsePatternTfPref(JSON.stringify({ tf: old, provisional: true })), { tf: 'A', provisional: false }, old);
  for (const tf of ['A', 'D', 'W', 'M'] as const) assert.equal(parsePatternTfPref(serializePatternTfPref({ tf, provisional: false })).tf, tf);
  assert.deepEqual(parsePatternTfPref(serializePatternTfPref({ tf: 'A', provisional: true })), { tf: 'A', provisional: true });
  assert.equal(JSON.parse(serializePatternTfPref({ tf: 'M', provisional: false })).v, 2);
});

// ───────── headline across timeframes ─────────
test('zzz1015 headline: current structure first (tier group, then rank); within the tie margin the timeframe on screen, then D, W, M', () => {
  const dNear = v([H({ confidence: 0.62 })], 'D');                                                      // tier 1 (breakout holding)
  const wFail = v([H({ id: 'cup', label: 'Cup', stage: 'failed', confidence: 0.95, breakAgo: 1, distToPivotPct: -3, timeframe: 'W' })], 'W');   // tier 4
  assert.equal(currentTier(dNear.active[0]), 1); assert.equal(currentTier(wFail.active[0]), 4);
  assert.equal(pickHeadlineTf({ D: dNear, W: wFail }), 'D', 'a recent breakout beats a stronger failed structure');
  const wStrong = v([H({ confidence: 0.9, timeframe: 'W', breakAgo: 1 })], 'W');
  assert.equal(pickHeadlineTf({ D: dNear, W: wStrong }, 'D'), 'W', 'a clearly stronger weekly structure leads');
  const wTie = v([H({ confidence: 0.62 + TF_TIE_EPS / 2, timeframe: 'W', breakAgo: 1 })], 'W');
  assert.equal(pickHeadlineTf({ D: dNear, W: wTie }, 'D'), 'D', 'tie → the timeframe on screen');
  assert.equal(pickHeadlineTf({ D: dNear, W: wTie }, 'W'), 'W');
  assert.equal(pickHeadlineTf({ D: dNear, W: wTie }, null), 'D', 'tie, no screen preference → D first');
  assert.equal(pickHeadlineTf({ D: v([], 'D'), W: v([], 'W') }), null);
  assert.equal(viewRelevance(v([], 'D')), null);
  assert.notEqual(rowKeyOf(H({ timeframe: 'D' })), rowKeyOf(H({ timeframe: 'W' })), 'the same pattern on two timeframes is two rows');
});

test('zzz1015 banner: explicit timeframe with nothing names the other timeframe; Auto counts all; nothing anywhere says so', () => {
  const views: TfViews = { D: v([H()], 'D'), W: v([], 'W'), M: v([], 'M') };
  assert.equal(crossTfWords(views.D!, 'D', '₹'), 'Daily: Falling wedge broke out 7 days ago (shape 62)');
  const m = multiBanner(views, 'M', '₹', { displayTf: 'D' });
  // zzz1024 — the other timeframe's structure is drawn (leadHit); zzz1028 (QA, AVAV) — the CHOSEN timeframe's state is said first and
  // the other timeframe's structure is marked apart (own / other: the page shows "Daily" as a chip with a "Switch to daily" action)
  assert.equal(m.text, '📐 Monthly: no qualifying pattern · Other timeframe → Daily: Falling wedge · broke out 7 days ago · pivot ₹100.00, 4% above · shape 62/100');
  assert.equal(m.own, 'Monthly: no qualifying pattern');
  assert.deepEqual(m.other, { tf: 'D', words: 'Falling wedge · broke out 7 days ago · pivot ₹100.00, 4% above · shape 62/100' });
  assert.equal(m.headTf, 'M');
  assert.equal(m.leadHit, views.D!.active[0]);
  assert.equal(m.tone, 'bullish');
  // too little monthly history: the monthly state first, then the other timeframe's structure
  const ms = multiBanner({ ...views, M: v([], 'M', { status: 'short' }) }, 'M', '₹', { errors: { M: 'Too little history (9 monthly bars)' } });
  assert.match(ms.text, /^📐 Monthly: Too little history \(9 monthly bars\) — patterns need at least 24 monthly bars · Other timeframe → Daily: Falling wedge · .*$/);
  // the explicit timeframe has its own current structure: the zzz1009 banner, unchanged
  assert.match(multiBanner(views, 'D', '₹').text, /^📐 Falling wedge · Daily · broke out 7 days ago · pivot ₹100\.00, 4% above · shape 62\/100$/);
  // Auto: the headline, "+N more" over every timeframe
  const a = multiBanner({ D: v([H()], 'D'), W: v([H({ id: 'flat_base', label: 'Flat base', stage: 'forming', confidence: 0.5, distToPivotPct: -2, timeframe: 'W', breakAgo: undefined })], 'W'), M: v([], 'M') }, 'A', '₹', { displayTf: 'D' });
  assert.equal(a.headTf, 'D');
  assert.match(a.text, /^📐 Falling wedge · Daily · broke out 7 days ago · .* · \+1 more$/);
  // nothing current anywhere
  const exp = H({ id: 'bear_flag', label: 'Bear flag', bias: 'bearish', stage: 'failed', expired: 'failed-old', breakAgo: 35, breakT: 50 * DAY });
  const weak = H({ id: 'vcp', label: 'VCP', stage: 'forming', confidence: 0.3, weak: true, timeframe: 'W', breakAgo: undefined });
  const none = multiBanner({ D: v([], 'D', { expired: [exp] }), W: v([], 'W', { weak: [weak] }), M: v([], 'M') }, 'A', '$');
  assert.equal(none.text, '📐 No textbook pattern on D/W/M · last: Bear flag (Daily), breakdown failed (break 7 wk ago) · 1 weaker candidate');
  assert.equal(none.weakerHint, 1);
  // Auto while monthly is still loading and D / W have nothing: says what it is still reading
  assert.equal(multiBanner({ D: v([], 'D'), W: v([], 'W'), M: v([], 'M', { status: 'loading' }) }, 'A', '$').text, '📐 Looking for chart patterns on the monthly bars…');
  // M too short: left out of the "on D/W/M" list
  assert.match(multiBanner({ D: v([], 'D'), W: v([], 'W'), M: v([], 'M', { status: 'short' }) }, 'A', '$').text, /^📐 No textbook pattern on D\/W$/);
});

// ───────── mounted hook + banner (JSDOM) ─────────
async function withDom<T>(fn: (h: { React: any; act: any; root: any; settle: (ms?: number) => Promise<void> }) => Promise<T>): Promise<T> {
  const { JSDOM } = await import('jsdom');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
  try {
    return await fn({ React, act, root, settle });
  } finally {
    try { await act(async () => { root.unmount(); }); } catch { /* keep the test's own failure visible */ }
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
    _resetChartLoadCache();
  }
}
const pack = (b: PBar[]) => ({ t: b.map((x) => x.t), o: b.map((x) => x.o), h: b.map((x) => x.h), l: b.map((x) => x.l), c: b.map((x) => x.c), v: b.map((x) => x.v) });
/** a fetcher whose answers are released by hand */
function hold() {
  const calls: string[] = [];
  const pending = new Map<string, (v: any) => void>();
  const fetcher = (url: string) => { calls.push(url); return new Promise<any>((res) => pending.set(url, res)); };
  return { calls, fetcher, answer: (url: string, body: any) => pending.get(url)!({ ok: true, status: 200, json: async () => body }) };
}
const mount = async (h: { React: any; act: any; root: any; settle: (ms?: number) => Promise<void> }, props: any) => {
  const { usePatternIndicator, PatternBanner } = await import('../../components/charts/PatternIndicator');
  const box: { out: any } = { out: null };
  const Probe = (pr: any) => { const p = usePatternIndicator(pr); h.React.useEffect(() => { box.out = p; }); return h.React.createElement(PatternBanner, { p, cur: '$', light: true, onTurnOff: () => {}, tf: 'D' }); };
  await h.act(async () => { h.root.render(h.React.createElement(Probe, props)); }); await h.act(async () => { await h.settle(260); });
  return box;
};
const head = () => Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').startsWith('📐'))!;

/** The views the hook must show, straight from the engine (independent of rule changes in lib/chart-patterns). */
function directViews(b5: PBar[], b10: PBar[]): TfViews {
  const one = (tf: 'D' | 'W' | 'M', b: PBar[]) => {
    const r = tf === 'D' ? analyzePatterns(b, { weak: true }) : analyzeDailyAs(b, tf, { weak: true });
    return patternView({ hits: r.hits, weak: r.weak, expired: r.expired, tf, status: r.tooShort ? 'short' : 'ready' });
  };
  return { D: one('D', b5), W: one('W', b5), M: one('M', b10) };
}
const sig = (v: any) => `${v.state}:${v.active.map((h: PatternHit) => h.id).join(',')}`;

test('zzz1015 mounted: an old stored M reads as Auto; D / W from the 5 years on screen at once, M from ONE shared 10-year request', async () => {
  await withDom(async (h) => {
    const f = hold(); _resetChartLoadCache(f.fetcher as any);
    localStorage.setItem('mc:chart-pattern-tf:v1', JSON.stringify({ tf: 'M', provisional: false }));
    const b = gen(LEGS_C, { history: 300 });
    const want = directViews(b, b);
    const live = { ok: true, ticker: 'CCC', market: 'US', interval: '1d', range: '5y', basis: 'price', bars: pack(b) };
    const box = await mount(h, { on: true, ready: false, ticker: 'CCC', market: 'US', exchange: undefined, basis: 'price', chartRef: { current: null }, cacheRef: { current: new Map() }, cur: '$', chart: { loading: false, error: null }, live, bars: b, displayTf: undefined });
    // zzz1019 — with a chart timeframe the analysis follows it; without one (here) the stored choice applies
    assert.equal(box.out.analysisTf, 'A', 'the old monthly choice no longer applies to every chart');
    assert.equal(f.calls.length, 1, 'one request: the 10-year daily history for monthly');
    assert.match(f.calls[0], /\/api\/v1\/chart\/CCC\?market=US&interval=1d&range=10y$/);
    assert.equal(box.out.views.M.state, 'pending', 'monthly still loading');
    assert.equal(sig(box.out.views.D), sig(want.D), 'daily read at once from the bars on screen');
    assert.equal(sig(box.out.views.W), sig(want.W));
    await h.act(async () => { f.answer(f.calls[0], live); await h.settle(30); });
    assert.equal(sig(box.out.views.M), sig(want.M));
    const ht = pickHeadlineTf(want, undefined);
    assert.equal(box.out.banner.headTf, ht ?? 'D');
    const strip = (t: string) => t.replace(/ · \d{1,2} \w+ \d{4}/g, '');   // the analysis date
    assert.equal(strip(box.out.banner.text), strip(multiBanner(want, 'A', '$', { displayTf: undefined }).text), 'the banner = the pure Auto banner of the engine views')
    assert.match(head().textContent || '', ht ? new RegExp(`^📐 .* · ${ht === 'D' ? 'Daily' : ht === 'W' ? 'Weekly' : 'Monthly'} · `) : /^📐 (No textbook pattern|Too little history)/);
    assert.equal(box.out.drawnIds.size, ht ? 1 : 0, 'the headline (only) is drawn');
    if (ht) assert.ok(box.out.drawnIds.has(`${ht}:${want[ht]!.active[0].id}`));
    assert.equal(f.calls.length, 1, 'no further requests');
    // the grouped list: one group per timeframe with counts
    await h.act(async () => { head().click(); await h.settle(); });
    for (const tf of ['D', 'W', 'M'] as const) {
      const g = document.querySelector(`[data-testid="pattern-group-${tf}"]`);
      assert.ok(g, tf);
      assert.match(g!.textContent || '', new RegExp(`${tf === 'D' ? 'Daily' : tf === 'W' ? 'Weekly' : 'Monthly'}${want[tf]!.active.length} current`));
    }
  });
});

test('zzz1015 mounted: explicit D — the 10-year request only when D / W have nothing current; explicit M points to another timeframe', async () => {
  await withDom(async (h) => {
    const f = hold(); _resetChartLoadCache(f.fetcher as any);
    localStorage.setItem('mc:chart-pattern-tf:v1', serializePatternTfPref({ tf: 'D', provisional: false }));
    const b = gen(LEGS_B, { history: 300 });
    const want = directViews(b, b);
    const dwCurrent = want.D!.state === 'qualifying' || want.W!.state === 'qualifying';
    const live = { ok: true, ticker: 'BBB', market: 'US', interval: '1d', range: '5y', basis: 'price', bars: pack(b) };
    const props = { on: true, ready: false, ticker: 'BBB', market: 'US', exchange: undefined, basis: 'price', chartRef: { current: null }, cacheRef: { current: new Map() }, cur: '$', chart: { loading: false, error: null }, live, bars: b, displayTf: 'D' };
    const box = await mount(h, props);
    assert.equal(box.out.analysisTf, 'D');
    assert.equal(f.calls.length, dwCurrent ? 0 : 1, 'monthly fetched only as a pointer when D / W have nothing current');
    if (dwCurrent) assert.equal(box.out.views.M, undefined);
    assert.deepEqual(box.out.hits.map((x: PatternHit) => x.id), analyzePatterns(b).hits.map((x) => x.id));
    // switch to M: the 10-year history once
    await h.act(async () => { box.out.setAnalysisTf('M'); }); await h.act(async () => { await h.settle(260); });
    assert.equal(f.calls.length, 1);
    await h.act(async () => { f.answer(f.calls[0], live); await h.settle(30); });
    assert.equal(sig(box.out.views.M), sig(want.M));
    assert.equal(JSON.parse(localStorage.getItem('mc:chart-pattern-tf:v1')!).tf, 'M');
    const other = pickHeadlineTf(want, 'D', ['D', 'W']);
    if (want.M!.state !== 'qualifying' && other) {
      // zzz1024 — the other timeframe's structure leads the banner and is drawn by default (rows keyed by timeframe)
      assert.match(head().textContent || '', /^📐 Monthly: no qualifying pattern · Other timeframe → (Daily|Weekly): .+ · shape \d+\/100/, 'never a bare "no pattern"');
      // zzz1028 — the other timeframe as a chip, and a one-click switch to it
      const chip = document.querySelector('[data-testid="pattern-other-tf"]') as HTMLElement;
      assert.equal(chip?.dataset.tf, other);
      const sw = document.querySelector('[data-testid="pattern-switch-tf"]') as HTMLButtonElement;
      assert.match(sw.textContent || '', /^Switch to (daily|weekly)$/);
      const rk = rowKeyOf(want[other]!.active[0]);
      assert.deepEqual([...box.out.drawnIds], [rk], 'the structure the banner leads with is drawn');
      // unticking it removes it
      await h.act(async () => { box.out.togglePick(rk); await h.settle(); });
      assert.deepEqual([...box.out.drawnIds], []);
    }
  });
  await withDom(async (h) => {
    const f = hold(); _resetChartLoadCache(f.fetcher as any);
    // a flat line: nothing current on any timeframe — the weaker count with a one-click "show weaker" when there are weaker ones
    const b = gen([[700, 100]], { history: 300 });
    const live = { ok: true, ticker: 'FLAT', market: 'US', interval: '1d', range: '10y', basis: 'price', bars: pack(b) };
    const box = await mount(h, { on: true, ready: false, ticker: 'FLAT', market: 'US', exchange: undefined, basis: 'price', chartRef: { current: null }, cacheRef: { current: new Map() }, cur: '$', chart: { loading: false, error: null }, live, bars: b, displayTf: undefined });
    assert.equal(f.calls.length, 0, '10 years on screen: no request');
    assert.equal(box.out.analysisTf, 'A');
    const want = directViews(b, b);
    if (!pickHeadlineTf(want)) assert.match(head().textContent || '', /^📐 (No textbook pattern on D|Too little history)/);
    const weakBtn = document.querySelector('[data-testid="pattern-show-weaker"]') as HTMLButtonElement | null;
    if (box.out.banner.weakerHint > 0) {
      await h.act(async () => { weakBtn!.click(); await h.settle(); });
      assert.ok(document.querySelector('[data-testid="pattern-row-weaker"]'), 'weaker rows shown');
    } else assert.equal(weakBtn, null);
  });
});

test('zzz1015 wiring: shared chart request, per-hit timeframe mapping, the chart passes its timeframe, Auto button', () => {
  const ind = readFileSync(new URL('../../components/charts/PatternIndicator.tsx', import.meta.url), 'utf8');
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ind, /chartFetch\(url, \{ signal: ctrl\.signal/);
  assert.ok(!/\bfetch\(plan/.test(ind), 'no private fetch');
  assert.match(ind, /overlayFit\(h, times, fmt, fitOptsOf\(h\)\)/);
  assert.match(ind, /x === 'A' \? 'Auto' : x/);
  assert.match(ws, /displayTf: tf(, display)? \}\)/);
});

test('zzz1019 mounted: the analysis follows the chart timeframe (open on W → weekly; switch to M → monthly; back to D → daily)', async () => {
  await withDom(async (h) => {
    const f = hold(); _resetChartLoadCache(f.fetcher as any);
    localStorage.setItem('mc:chart-pattern-tf:v1', serializePatternTfPref({ tf: 'A', provisional: false }));
    const b = gen(LEGS_B, { history: 300 });
    const live = { ok: true, ticker: 'BBB', market: 'US', interval: '1d', range: '10y', basis: 'price', bars: pack(b) };
    const props = { on: true, ready: false, ticker: 'BBB', market: 'US', exchange: undefined, basis: 'price', chartRef: { current: null }, cacheRef: { current: new Map() }, cur: '$', chart: { loading: false, error: null }, live, bars: b };
    const { usePatternIndicator } = await import('../../components/charts/PatternIndicator');
    const box: { out: any } = { out: null };
    const Probe = (pr: any) => { const p = usePatternIndicator(pr); h.React.useEffect(() => { box.out = p; }); return null; };
    await h.act(async () => { h.root.render(h.React.createElement(Probe, { ...props, displayTf: 'W' })); });
    assert.equal(box.out.analysisTf, 'W');
    await h.act(async () => { h.root.render(h.React.createElement(Probe, { ...props, displayTf: 'M' })); });
    assert.equal(box.out.analysisTf, 'M');
    await h.act(async () => { box.out.setAnalysisTf('A'); });
    assert.equal(box.out.analysisTf, 'A', 'a pick in the banner applies until the chart timeframe changes');
    await h.act(async () => { h.root.render(h.React.createElement(Probe, { ...props, displayTf: 'D' })); });
    assert.equal(box.out.analysisTf, 'D');
  });
});
