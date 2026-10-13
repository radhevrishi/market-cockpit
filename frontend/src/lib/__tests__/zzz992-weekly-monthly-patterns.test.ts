import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregateBars, periodCloseT, periodKey } from '../bar-aggregate';
import {
  analyzeDailyAs, analyzePatterns, detectPatterns, patternApplies, patternHeadline, patternLengthWords, stageWindowsFor,
  DAILY_STAGE_WINDOWS, PATTERN_ENGINE_VERSION, PATTERN_IDS, PATTERN_MIN_HISTORY, PATTERN_NA_REASON, PATTERN_TIMEFRAMES,
  type PBar, type PatternHit, type PatternId,
} from '../chart-patterns';
import { analysisKey, bannerOf, fitPlan, parsePatternTfPref, patternDataPlan, serializePatternTfPref } from '../../components/charts/pattern-view';

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2035, 0, 1));   // every generated period is complete

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
const ids = (h: PatternHit[]) => h.map((x) => x.id);
const hitOf = (h: PatternHit[], id: PatternId) => h.find((x) => x.id === id);
const bar = (iso: string, o: number, h: number, l: number, c: number, v: number): PBar => ({ t: Date.parse(`${iso}T03:45:00Z`), o, h, l, c, v });

// ───────── aggregation ─────────
test('zzz992 aggregate W: ISO weeks Mon–Sun, O first / H max / L min / C last / V sum, holiday skipped, t = first session', () => {
  const daily = [
    bar('2026-01-05', 10, 11, 9.5, 10.5, 100),   // Mon
    bar('2026-01-06', 10.5, 12, 10, 11.8, 200),
    // Wed 7th a holiday — no bar
    bar('2026-01-08', 11.8, 12.4, 11, 11.2, 300),
    bar('2026-01-09', 11.2, 11.5, 9, 9.4, 400),  // Fri
    bar('2026-01-12', 9.4, 10, 9.2, 9.9, 50),    // next Mon
    bar('2026-01-16', 9.9, 10.6, 9.8, 10.4, 60), // Fri (Tue–Thu holidays)
  ];
  const r = aggregateBars(daily, 'W', { now: NOW });
  assert.equal(r.bars.length, 2);
  assert.deepEqual(r.bars[0], { t: daily[0].t, o: 10, h: 12.4, l: 9, c: 9.4, v: 1000 });
  assert.deepEqual(r.bars[1], { t: daily[4].t, o: 9.4, h: 10.6, l: 9.2, c: 10.4, v: 110 });
  assert.equal(r.periodEnd, daily[5].t);
  assert.equal(r.latestT, daily[5].t);
  assert.equal(r.provisional, false);
  // a Sunday-dated stamp belongs to the week that started the Monday before
  assert.equal(periodKey(Date.UTC(2026, 0, 11, 12), 'W'), periodKey(daily[0].t, 'W'));
  assert.notEqual(periodKey(Date.UTC(2026, 0, 12, 0), 'W'), periodKey(daily[0].t, 'W'));
});

test('zzz992 aggregate M: calendar months; one day without volume → the period volume is missing, never a partial sum', () => {
  const daily = [
    bar('2026-01-30', 10, 11, 9, 10.5, 100),
    bar('2026-02-02', 10.5, 13, 10, 12, 100),
    bar('2026-02-27', 12, 12.5, 8, 9, NaN),   // missing volume
    bar('2026-03-02', 9, 9.5, 8.5, 9.2, 0),   // zero = missing
    bar('2026-03-03', 9.2, 9.6, 9, 9.5, 500),
    bar('2026-04-01', 9.5, 10, 9.4, 9.8, 700),
  ];
  const r = aggregateBars(daily, 'M', { now: NOW });
  assert.equal(r.bars.length, 4);
  assert.deepEqual(r.bars.map((b) => [b.o, b.h, b.l, b.c]), [[10, 11, 9, 10.5], [10.5, 13, 8, 9], [9, 9.6, 8.5, 9.5], [9.5, 10, 9.4, 9.8]]);
  assert.equal(r.bars[0].v, 100);
  assert.ok(Number.isNaN(r.bars[1].v), 'February: one day without volume');
  assert.ok(Number.isNaN(r.bars[2].v), 'March: a zero volume is missing too');
  assert.equal(r.bars[3].v, 700);
  // CP-04 carries over: on W / M, deleting volume never raises a score
  const b = gen([[300, 60], [250, 100], [75, 72, 'ease'], [20, 72], [75, 98, 'ease'], [15, 90], [5, 93]]);
  const real = analyzeDailyAs(b, 'W', { now: NOW }).hits;
  const none = analyzeDailyAs(b.map((x) => ({ ...x, v: NaN })), 'W', { now: NOW }).hits;
  // (as in zzz990 CP-04: the pattern's own score — the opposing-reading damping between patterns is a separate rule)
  const hr = hitOf(real, 'cup_handle'), hn = hitOf(none, 'cup_handle');
  assert.ok(hr, 'weekly cup with handle with real volume');
  assert.ok(!hn || hn.confidence <= hr.confidence + 1e-9, `${hn?.confidence} > ${hr.confidence}`);
  assert.equal(hn?.volumeOk ?? false, false);
});

test('zzz992 aggregate: the current week / month is provisional — dropped by default, kept and flagged when asked', () => {
  const daily = [bar('2026-10-05', 10, 11, 9, 10, 1), bar('2026-10-09', 10, 11, 9, 10.5, 1), bar('2026-10-12', 10.5, 12, 10, 11.5, 1), bar('2026-10-13', 11.5, 12.5, 11, 12, 1)];
  const wed = new Date(Date.UTC(2026, 9, 14, 10));
  const done = aggregateBars(daily, 'W', { now: wed });
  assert.equal(done.bars.length, 1);
  assert.equal(done.droppedProvisional, true);
  assert.equal(done.provisional, false);
  assert.equal(done.periodEnd, daily[1].t, 'the period end is the last session of the last COMPLETED week');
  assert.equal(done.latestT, daily[3].t, 'the data timestamp is still the latest daily bar');
  const live = aggregateBars(daily, 'W', { now: wed, completedOnly: false });
  assert.equal(live.bars.length, 2);
  assert.equal(live.provisional, true);
  assert.equal(live.bars[1].c, 12);
  // a week is complete from the Saturday 00:00 UTC after it (after both NSE and US Friday closes)
  assert.equal(periodCloseT(daily[2].t, 'W'), Date.UTC(2026, 9, 17));
  assert.equal(aggregateBars(daily, 'W', { now: new Date(Date.UTC(2026, 9, 17)) }).bars.length, 2);
  // a month is complete from the day after its last weekday (Oct 2026 ends on a Saturday → Fri 30th → Sat 31st 00:00)
  assert.equal(periodCloseT(daily[0].t, 'M'), Date.UTC(2026, 9, 31));
  assert.equal(aggregateBars(daily, 'M', { now: wed }).bars.length, 0);
  assert.equal(aggregateBars(daily, 'M', { now: wed, completedOnly: false }).provisional, true);
  // invalid daily bars are skipped and counted
  const bad = [...daily.slice(0, 2), { ...daily[2], c: NaN }, { ...daily[3], t: daily[0].t }];
  const rb = aggregateBars(bad as PBar[], 'W', { now: NOW });
  assert.equal(rb.skipped, 2);
  assert.equal(rb.bars.length, 1);
});

// ───────── daily behaviour unchanged ─────────
test('zzz992 D unchanged: default = explicit D = analyzeDailyAs D; hits say timeframe D; daily words unchanged', () => {
  const fixtures = [
    gen([[60, 60], [120, 100], [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 94.5]]),
    gen([[60, 60], [10, 75], [3, 72.5], [2, 74], [3, 71.5], [2, 73], [3, 70.5]]),
    gen([[60, 100], [60, 70], [20, 80], [20, 70.5], [10, 76]]),
  ];
  for (const b of fixtures) {
    const a = analyzePatterns(b), d = analyzePatterns(b, { timeframe: 'D' }), x = analyzeDailyAs(b, 'D');
    assert.deepEqual(d, a);
    assert.deepEqual(x.hits, a.hits);
    assert.ok(a.hits.length > 0);
    for (const h of a.hits) assert.equal(h.timeframe, 'D');
    assert.equal(a.timeframe, 'D'); assert.equal(a.minBars, 30); assert.deepEqual(a.notApplicable, []);
  }
  assert.match(detectPatterns(fixtures[0])[0].note, /^Cup with handle, \d+ weeks/);
  assert.equal(patternLengthWords(35), '7 wk'); assert.equal(patternLengthWords(8), '8 days');
  assert.deepEqual(stageWindowsFor('D'), DAILY_STAGE_WINDOWS);
  assert.deepEqual(DAILY_STAGE_WINDOWS, { lead: 3, breakout: 4, failed: 40 });
  assert.equal(typeof PATTERN_ENGINE_VERSION, 'string'); assert.ok(PATTERN_ENGINE_VERSION.length > 0);
});

// ───────── weekly ─────────
test('zzz992 W: a weekly cup with handle — found on weekly bars with week-based lengths', () => {
  // rise 50 weeks, cup 15 weeks down + 4 flat + 15 up, handle 3 weeks down + 1 up
  const b = gen([[300, 60], [250, 100], [75, 72, 'ease'], [20, 72], [75, 98, 'ease'], [15, 90], [5, 93]]);
  const r = analyzeDailyAs(b, 'W', { now: NOW });
  assert.equal(r.timeframe, 'W'); assert.equal(r.tooShort, false);
  const h = hitOf(r.hits, 'cup_handle');
  assert.ok(h, ids(r.hits).join(','));
  assert.equal(h.timeframe, 'W');
  assert.equal(h.stage, 'forming');
  assert.ok(h.confidence >= 0.55, String(h.confidence));
  // the cup + handle spans ~37 weeks (185 sessions / 5); the daily reading of the same bars agrees on the span in days
  assert.ok(h.lengthBars >= 34 && h.lengthBars <= 42, String(h.lengthBars));
  const dh = hitOf(analyzePatterns(b).hits, 'cup_handle');
  assert.ok(dh && Math.abs(dh.lengthBars / 5 - h.lengthBars) <= 3, `${dh?.lengthBars} days vs ${h.lengthBars} weeks`);
  assert.match(h.note, /^Cup with handle \(weekly\), \d+ weeks, /);
  assert.match(patternHeadline(r.hits), /\d+ wk/);
  assert.ok(h.pivot! > 95 && h.pivot! < 101, String(h.pivot));
});

test('zzz992 W: a weekly flat base — ≥ 5 weekly bars, lengths in weeks', () => {
  const b = gen([[300, 60], [250, 100], [15, 93], [15, 99], [15, 94], [15, 98.5], [12, 95], [10, 97]]);
  const h = hitOf(analyzeDailyAs(b, 'W', { now: NOW }).hits, 'flat_base');
  assert.ok(h, 'weekly flat base');
  assert.ok(h.lengthBars >= 5 && h.lengthBars <= 26, String(h.lengthBars));
  assert.ok(h.lengthBars >= 15 && h.lengthBars <= 20, `~17 weeks: ${h.lengthBars}`);
  assert.ok(h.depthPct! <= 15);
  assert.ok(!hitOf(analyzeDailyAs(b, 'M', { now: NOW }).hits, 'flat_base'), 'a flat base is not read on monthly bars');
});

// ───────── monthly ─────────
test('zzz992 M: a multi-year rounding base is found on monthly bars only', () => {
  for (const seed of [1, 2, 3]) {
    // a ~43-month saucer after a rise: longer than the 65-week cap of D / W
    const b = gen([[400, 40], [300, 100], [400, 70, 'ease'], [100, 70], [400, 96, 'ease']], { history: 200, noise: 0.01, spread: 0.01, seed });
    const m = analyzeDailyAs(b, 'M', { now: NOW });
    const h = hitOf(m.hits, 'u_base');
    assert.ok(h, `seed ${seed}: ${ids(m.hits).join(',')}`);
    assert.equal(h.timeframe, 'M');
    assert.ok(h.lengthBars >= 36 && h.lengthBars <= 48, String(h.lengthBars));
    assert.match(h.note, /\(monthly\), \d+ months, .*multi-year rounded base/);
    assert.match(patternHeadline(m.hits), /\d+ mo/);
    assert.ok(!ids(analyzePatterns(b).hits).includes('u_base'), 'not on daily');
    assert.ok(!ids(analyzeDailyAs(b, 'W', { now: NOW }).hits).some((id) => id === 'u_base' || id === 'cup'), 'not on weekly');
  }
});

test('zzz992 N/A: a short daily flag is never reported on W or M; the map and the analysis say so', () => {
  const b = gen([[60, 60], [10, 75], [3, 72.5], [2, 74], [3, 71.5], [2, 73], [3, 70.5]], { history: 700 });
  assert.ok(ids(analyzePatterns(b).hits).includes('bull_flag'));
  for (const tf of ['W', 'M'] as const) {
    const r = analyzeDailyAs(b, tf, { now: NOW });
    assert.equal(r.tooShort, false, tf);
    for (const id of ['bull_flag', 'bull_pennant', 'bear_flag', 'high_tight_flag'] as PatternId[]) {
      assert.ok(!ids(r.hits).includes(id), `${id} on ${tf}`);
      assert.ok(r.notApplicable.includes(id));
      assert.equal(patternApplies(id, tf), false);
      assert.ok(PATTERN_NA_REASON[id]);
    }
  }
  // map: every id is applicable on D; W / M lists are what the header documents
  for (const id of PATTERN_IDS) assert.ok(PATTERN_TIMEFRAMES[id].includes('D'), id);
  const naW = PATTERN_IDS.filter((id) => !patternApplies(id, 'W')).sort();
  const naM = PATTERN_IDS.filter((id) => !patternApplies(id, 'M')).sort();
  assert.deepEqual(naW, ['bear_flag', 'bull_flag', 'bull_pennant', 'high_tight_flag']);
  assert.deepEqual(naM, ['ascending_base', 'ascending_triangle', 'base_on_base', 'bear_flag', 'bull_flag', 'bull_pennant', 'cup_handle', 'descending_triangle', 'falling_wedge', 'flat_base', 'high_tight_flag', 'ipo_base', 'rising_wedge']);
  for (const id of naM) assert.ok(PATTERN_NA_REASON[id], id);
  // every hit on any timeframe is an applicable pattern (random walks)
  for (let seed = 1; seed <= 25; seed++) {
    const w = gen([[1500, 100]], { seed, noise: 0.03, spread: 0.01, history: 0 });
    for (const tf of ['W', 'M'] as const) for (const h of analyzeDailyAs(w, tf, { now: NOW }).hits) assert.ok(patternApplies(h.id, tf), `${h.id} on ${tf}`);
  }
});

test('zzz992 insufficient history: W needs 30 weekly bars, M 24 monthly bars', () => {
  assert.deepEqual(PATTERN_MIN_HISTORY, { D: 30, W: 30, M: 24 });
  const b = gen([[20, 60], [100, 100]], { history: 0 });   // ~121 sessions ≈ 25 weeks ≈ 6 months
  const w = analyzeDailyAs(b, 'W', { now: NOW });
  assert.equal(w.tooShort, true); assert.equal(w.minBars, 30); assert.deepEqual(w.hits, []);
  assert.ok(w.usableBars >= 24 && w.usableBars <= 26, String(w.usableBars));
  const m = analyzeDailyAs(gen([[200, 60], [200, 100]], { history: 0 }), 'M', { now: NOW });
  assert.equal(m.tooShort, true); assert.equal(m.minBars, 24);
  assert.equal(analyzePatterns(b).tooShort, false, 'the same daily history is enough on D');
  assert.equal(bannerOf([], '$', 'short', 'Too little history (25 weekly bars)', 'W').text, '📐 Too little history (25 weekly bars) — patterns need at least 30 weekly bars');
});

test('zzz992 stage windows on W / M: breakout = this or the previous candle; failed within 8 weeks / 2 months', () => {
  assert.deepEqual(stageWindowsFor('W'), { lead: 1, breakout: 1, failed: 8 });
  assert.deepEqual(stageWindowsFor('M'), { lead: 1, breakout: 1, failed: 2 });
  assert.equal(patternLengthWords(12, 'W'), '12 wk'); assert.equal(patternLengthWords(9, 'M', true), '9 months');
});

// ───────── chart view pieces ─────────
test('zzz992 chart: analysis choice stored per viewer, keyed results, longer history for monthly, banner words, fit plan', () => {
  assert.deepEqual(parsePatternTfPref(null), { tf: 'D', provisional: false });
  assert.deepEqual(parsePatternTfPref('garbage'), { tf: 'D', provisional: false });
  assert.deepEqual(parsePatternTfPref(serializePatternTfPref({ tf: 'W', provisional: true })), { tf: 'W', provisional: true });
  assert.deepEqual(parsePatternTfPref(serializePatternTfPref({ tf: 'D', provisional: true })), { tf: 'D', provisional: false });
  assert.equal(analysisKey('US::ABC:price', 'D', false), 'US::ABC:price', 'daily keeps the old identity');
  assert.notEqual(analysisKey('US::ABC:price', 'W', false), analysisKey('US::ABC:price', 'W', true));
  assert.notEqual(analysisKey('US::ABC:price', 'W', false), analysisKey('US::ABC:price', 'M', false));
  assert.match(patternDataPlan(null, 'ABC', 'US', undefined, 'price', 'M').url, /range=10y/);
  assert.match(patternDataPlan(null, 'ABC', 'US', undefined, 'price', 'W').url, /range=5y/);
  assert.equal(patternDataPlan({ interval: '1d', range: '5y' }, 'ABC', 'US', undefined, 'price', 'M').useShown, false);
  assert.equal(patternDataPlan({ interval: '1d', range: '10y' }, 'ABC', 'US', undefined, 'price', 'M').useShown, true);
  assert.equal(bannerOf([], '$', 'loading', undefined, 'M').text, '📐 Looking for chart patterns on the monthly bars…');
  assert.equal(bannerOf([], '$', 'ready', undefined, 'W').text, '📐 No clear weekly chart pattern');
  assert.equal(bannerOf([], '$').text, '📐 No clear chart pattern');
  // fit: the span plus 15% (≥ 3 candles) each side fills the width; right edge index
  const times = Array.from({ length: 200 }, (_, i) => i * 7 * DAY);
  const f = fitPlan(times, times[100], times[139], 800)!;
  assert.equal(f.rightIndex, 145);
  assert.ok(Math.abs(f.space - 800 / 52) < 1e-9, String(f.space));
  assert.equal(fitPlan([], 0, 1, 800), null);
  assert.equal(fitPlan(times, times[190], times[199], 800)!.rightIndex, 199);
  // wiring: the hook aggregates via analyzeDailyAs, remembers the choice, never touches the drawings group
  const ind = readFileSync(new URL('../../components/charts/PatternIndicator.tsx', import.meta.url), 'utf8');
  assert.ok(ind.includes('analyzeDailyAs(daily, analysisTf') && ind.includes('PATTERN_TF_KEY'));
  assert.ok(ind.includes('data-testid="tf-pattern-badge"') && ind.includes('Fit pattern') && ind.includes('Restore view'));
  assert.ok(!ind.includes('DRAW_GROUP'));
});

// ───────── mounted hook (JSDOM): the remembered W choice aggregates the daily bars on screen ─────────
test('zzz992 mounted hook: weekly analysis from the 5y daily bars on screen; switching back to D restores daily hits (JSDOM)', async () => {
  const { JSDOM } = await import('jsdom');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Node']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  try {
    localStorage.setItem('mc:chart-pattern-tf:v1', JSON.stringify({ tf: 'W', provisional: false }));
    const { usePatternIndicator } = await import('../../components/charts/PatternIndicator');
    let out: any = null;
    const Probe = (props: any) => { const p = usePatternIndicator(props); React.useEffect(() => { out = p; }); return null; };
    const b = gen([[300, 60], [250, 100], [75, 72, 'ease'], [20, 72], [75, 98, 'ease'], [15, 90], [5, 93]]);
    const pack = { t: b.map((x) => x.t), o: b.map((x) => x.o), h: b.map((x) => x.h), l: b.map((x) => x.l), c: b.map((x) => x.c), v: b.map((x) => x.v) };
    const props = { on: true, ready: false, ticker: 'ABC', market: 'US', exchange: undefined, basis: 'price', chartRef: { current: null }, cacheRef: { current: new Map() }, cur: '$', chart: { loading: false, error: null },
      live: { ok: true, ticker: 'ABC', market: 'US', interval: '1d', range: '5y', basis: 'price', bars: pack }, bars: b };
    const render = async () => { await act(async () => { root.render(React.createElement(Probe, props)); }); await act(async () => { await new Promise((r) => setTimeout(r, 260)); }); };
    await render();
    assert.equal(out.analysisTf, 'W');
    assert.equal(out.status, 'ready');
    // the dates of the bars are in 2018–2022: every week is complete → not provisional
    assert.equal(out.provisional, false);
    assert.ok(out.hits.length > 0 && out.hits.every((h: PatternHit) => h.timeframe === 'W'), JSON.stringify(out.hits.map((h: PatternHit) => h.id)));
    assert.deepEqual(out.hits.map((h: PatternHit) => h.id), analyzeDailyAs(b, 'W').hits.map((h) => h.id));
    await act(async () => { out.setAnalysisTf('D'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 260)); });
    assert.equal(out.analysisTf, 'D');
    assert.ok(out.hits.every((h: PatternHit) => h.timeframe === 'D'));
    assert.deepEqual(out.hits.map((h: PatternHit) => h.id), analyzePatterns(b).hits.map((h) => h.id));
    assert.equal(JSON.parse(localStorage.getItem('mc:chart-pattern-tf:v1')!).tf, 'D', 'the choice is remembered');
  } finally {
    try { await act(async () => { root.unmount(); }); } catch { /* keep the test's own failure visible */ }
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
});
