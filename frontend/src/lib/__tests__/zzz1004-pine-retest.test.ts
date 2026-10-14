// zzz1004 — Pine Screener retest (13 Oct 2026): one timeframe-aware result model (analysis close / daily technical close / latest quote
// kept apart), completed vs provisional session labels, the seven supplied weekly double-bottom examples as regression fixtures
// (pivots, scores, lengths, 9 Oct weekly closes; AEQUS / JKIPL back below the pivot on the newer daily close; DBSTOCKBRO marginal;
// OMFREIGHT outside the default +5% window with the why-not explanation), portfolio risk / opportunity presets, Monthly Bases,
// unsupported monthly pattern types, the active-query summary, scope coverage and elapsed-duration length sorting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATTERN_SCAN_VERSION, runPineFull, cleanPineScreens, tagLengthText, type ScreenPatternTag } from '../screener/pine';
import { BUILT_IN_PINE_SCREENS, MONTHLY_BASE_IDS, MONTHLY_REVERSAL_IDS } from '../screener/pine-presets';
import { unsupportedChoices } from '../screener/filters';
import {
  analysisOf, sessionLabel, priceSet, latestConditions, lengthDays, querySummary, presetLine, scopeCoverage, coverageLine, chipApplicability,
  unsupportedNotice, whyNotListed, listCoverageRows, portfolioCheck, portfolioFocus, setupCounts, SETUP_CARDS, familyOf, analysisCsvCells, ANALYSIS_CSV_HEAD,
  chartIdentityParams,
} from '../screener/pine-view';
import type { ScreenRow } from '../screener/types';

const V = PATTERN_SCAN_VERSION;
const screenQ = (id: string) => BUILT_IN_PINE_SCREENS.find((s) => s.id === id)!.q;

// ── the seven supplied weekly double-bottom examples (India, completed week to Fri 9 Oct 2026) ─────────────────────────────
const EX = [
  { t: 'GTECJAINX', c: 100, low: [25.0, 24.8], p: 33.10, wk: 33.74, daily: 34.57, l: 13, wDist: 1.93, dDist: 4.44 },
  { t: 'AEQUS', c: 96, low: [215.0, 213.41], p: 271.21, wk: 273.50, daily: 265.10, l: 11, wDist: 0.84, dDist: -2.25 },
  { t: 'OMFREIGHT', c: 91, low: [84.0, 83.46], p: 99.50, wk: 107.46, daily: 108.00, l: 10, wDist: 8.00, dDist: 8.54 },
  { t: 'JKIPL', c: 89, low: [91.2, 89.42], p: 109.80, wk: 113.40, daily: 107.37, l: 12, wDist: 3.28, dDist: -2.21 },
  { t: 'DBSTOCKBRO', c: 65, low: [27.51, 27.05], p: 31.97, wk: 31.99, daily: 32.47, l: 7, wDist: 0.06, dDist: 1.56 },
  { t: 'EPACKPEB', c: 62, low: [218.3, 213.22], p: 250.90, wk: 253.62, daily: 252.60, l: 8, wDist: 1.08, dDist: 0.68 },
  { t: 'OMNI', c: 61, low: [531.35, 513.0], p: 615.00, wk: 634.10, daily: 653.45, l: 9, wDist: 3.11, dDist: 6.25 },
];
const r2 = (x: number) => Math.round(x * 100) / 100;
const weekTag = (e: typeof EX[number]): ScreenPatternTag =>
  ({ id: 'double_bottom', b: 'U', s: 'b', c: e.c, p: e.p, d: r2((e.wk / e.p - 1) * 100), l: e.l, lu: 'w', tf: 'W', dp: r2((1 - Math.min(...e.low) / e.p) * 100) });
const exRow = (e: typeof EX[number]): ScreenRow => ({
  t: e.t, n: `${e.t} Ltd`, px: e.daily, pxSrc: 'nse-bhav', pxAt: '2026-10-13', mc: 1000, avgVol30: 100_000, tvSec: 'Producer Manufacturing',
  scan: { st: 'no-pattern', v: V, asOf: '2026-10-13', session: 'completed' } as any, patAt: '2026-10-13', scanPx: e.daily, scanAt: '2026-10-13', scanSrc: 'yahoo+nse-bhav',
  patW: [weekTag(e)], scanW: { st: 'ready', v: V, tf: 'W', asOf: '2026-10-09', px: e.wk } as any,
  scanM: { st: 'no-pattern', v: V, tf: 'M', asOf: '2026-09-30', px: e.wk * 0.97 } as any,
} as ScreenRow);
const ROWS = EX.map(exRow);
const by = (t: string) => ROWS.find((r) => r.t === t)!;

test('zzz1004 fixtures: the seven weekly examples reproduce pivot, score, length and the 9 Oct completed-week distance', () => {
  for (const e of EX) {
    const r = by(e.t), tag = r.patW![0] as ScreenPatternTag;
    const a = analysisOf(r, tag);
    assert.equal(a.tf, 'W');
    assert.equal(a.close, e.wk, `${e.t}: the analysis close is the 9 Oct weekly close, not the daily close ${e.daily}`);
    assert.equal(a.at, '2026-10-09');
    assert.equal(a.session, 'completed');
    assert.equal(sessionLabel(a), 'completed weekly close 2026-10-09');
    assert.ok(Math.abs(((a.close! / tag.p!) - 1) * 100 - e.wDist) < 0.01, `${e.t}: distance reconciles with the displayed weekly close`);
    assert.ok(Math.abs((tag.d as number) - e.wDist) < 0.01);
    assert.equal(tag.c, e.c);
    assert.equal(tagLengthText(tag), `${e.l} wk`);
    // the two lows are within ~0.6–3.5% of each other (a double bottom), below the pivot
    const [a1, a2] = e.low; assert.ok(Math.abs(a1 / a2 - 1) < 0.036 && Math.max(a1, a2) < e.p);
    // the daily technical close and the latest quote are labelled apart
    const ps = priceSet(r, tag);
    assert.equal(ps.daily.close, e.daily); assert.equal(ps.daily.at, '2026-10-13');
    assert.equal(ps.quote.px, e.daily); assert.equal(ps.quote.src, 'nse-bhav');
    assert.ok(Math.abs(((e.daily / e.p) - 1) * 100 - e.dDist) < 0.01);
    // the chart hand-off carries the pattern, the analysis timeframe and its own date
    assert.match(chartIdentityParams(r, tag), /&pat=double_bottom&atf=W&asof=2026-10-09&session=completed/);
  }
});

test('zzz1004 weekly breakout vs the latest condition: AEQUS / JKIPL back below the pivot, DBSTOCKBRO marginal, OMFREIGHT extended', () => {
  const cond = (t: string) => latestConditions(by(t), by(t).patW![0] as ScreenPatternTag).map((c) => c.id).sort();
  assert.deepEqual(cond('AEQUS'), ['back-through']);
  assert.deepEqual(cond('JKIPL'), ['back-through']);
  assert.match(latestConditions(by('AEQUS'), by('AEQUS').patW![0] as ScreenPatternTag)[0].label, /latest quote back below pivot/);
  assert.match(latestConditions(by('AEQUS'), by('AEQUS').patW![0] as ScreenPatternTag)[0].tip, /2\.25% below the pivot 271\.21.*not a current trigger/);
  assert.deepEqual(cond('DBSTOCKBRO'), ['marginal']);
  assert.match(latestConditions(by('DBSTOCKBRO'), by('DBSTOCKBRO').patW![0] as ScreenPatternTag)[0].tip, /0\.06% \(about 0\.02\) past the pivot — a raw crossing/);
  assert.deepEqual(cond('OMFREIGHT'), ['extended']);
  for (const t of ['GTECJAINX', 'EPACKPEB', 'OMNI']) assert.deepEqual(cond(t), [], t);
  // the raw crossing itself is not removed: DBSTOCKBRO still matches a weekly breakout screen
  const q = { ...screenQ('all-bullish'), tfs: ['W' as const] };
  assert.ok(runPineFull(ROWS, q, 'IN').strict.some((h) => h.row.t === 'DBSTOCKBRO'));
});

test('zzz1004 OMFREIGHT is excluded by the default +5% window — and "Why not listed?" says so; the other six are listed', () => {
  const q = { ...screenQ('all-bullish'), tfs: ['W' as const] };
  const run = runPineFull(ROWS, q, 'IN');
  assert.deepEqual(run.strict.map((h) => h.row.t).sort(), EX.map((e) => e.t).filter((t) => t !== 'OMFREIGHT').sort());
  const w = whyNotListed('nse:omfreight', { rows: ROWS, q, market: 'IN', list: null, run });
  assert.equal(w.verdict, 'excluded');
  assert.match(w.headline, /OMFREIGHT: excluded — Double bottom \[W\]: \+8\.0% to the pivot is outside the -15% to \+5% window/);   // zzz1008: label without '(W)'
  assert.ok(w.steps.some((s) => s.label === 'Weekly scan' && s.ok && /completed weekly close 2026-10-09/.test(s.detail)));
  // with no pivot window it would be listed (nothing is relaxed by the checker itself)
  assert.equal(whyNotListed('OMFREIGHT', { rows: ROWS, q: { ...q, dist: { ...q.dist, on: false } }, market: 'IN', list: null }).verdict, 'listed');
  // a company not in the data / not on the list
  assert.equal(whyNotListed('NOSUCH', { rows: ROWS, q, market: 'IN', list: null }).verdict, 'not-in-data');
  const out = whyNotListed('GTECJAINX', { rows: ROWS, q, market: 'IN', list: new Set(['AEQUS']), listName: 'My portfolio' });
  assert.equal(out.verdict, 'out-of-scope'); assert.match(out.headline, /not on My portfolio \(it would match every chart choice\)/);
  // a stage / score / type exclusion is named too
  assert.match(whyNotListed('OMNI', { rows: ROWS, q: { ...q, minConf: 75 }, market: 'IN', list: null }).headline, /shape score 61 below 75/);
  assert.match(whyNotListed('OMNI', { rows: ROWS, q: { ...q, stages: ['f'] }, market: 'IN', list: null }).headline, /stage "broke out" not selected/);
});

test('zzz1004 PS-01/02: a W / M reading without its own close never shows the daily close under its date', () => {
  // PPIH-like: monthly reading dated 30 Sep with no stored close; the row's daily close (13 Oct) is 30.62
  const row = { t: 'PPIH', px: 30.62, scanPx: 30.62, scanAt: '2026-10-13', scan: { st: 'ready', v: V, session: 'completed', asOf: '2026-10-13' },
    patM: [{ id: 'double_top', b: 'D', s: 'f', c: 86, p: 36.72, d: -16.2, tf: 'M', l: 14, lu: 'm' }], scanM: { st: 'ready', v: V, tf: 'M', asOf: '2026-09-30' } } as any;
  const tag = row.patM[0];
  const a = analysisOf(row, tag);
  assert.equal(a.close, null);
  assert.equal(a.missing, 'monthly analysis close unavailable');
  assert.equal(a.at, '2026-09-30', 'the monthly date, never the daily 13 Oct');
  assert.equal(sessionLabel(a), 'completed monthly close 2026-09-30');
  const cells = analysisCsvCells(row, tag);
  const col = (h: string) => cells[ANALYSIS_CSV_HEAD.indexOf(h as any)];
  assert.equal(col('Analysis timeframe'), 'M');
  assert.equal(col('Analysis close'), 'monthly analysis close unavailable');
  assert.equal(col('Analysis close date'), '2026-09-30');
  assert.equal(col('Daily technical close'), 30.62);
  assert.equal(col('Daily technical close date'), '2026-10-13');
  // with its own close stored, that close (and its date) is shown
  const ok = { ...row, scanM: { ...row.scanM, px: 30.77 } };
  assert.equal(analysisOf(ok, tag).close, 30.77);
});

test('zzz1004 PS-03: a provisional daily reading is labelled with its observation time, never as a close', () => {
  const live = { t: 'X', scanPx: 30.62, scanAt: '2026-10-13', scan: { st: 'ready', v: V, asOf: '2026-10-13', session: 'provisional', obsAt: '2026-10-13T14:46:00Z' } } as any;
  const a = analysisOf(live, { tf: 'D' });
  assert.equal(a.session, 'provisional');
  assert.equal(sessionLabel(a), 'provisional (session open, observed 14:46 UTC)');
  assert.doesNotMatch(sessionLabel(a), /13 Oct|close/);
  // an older row read during a session (live: 1, no session field) is provisional too
  assert.equal(analysisOf({ t: 'Y', live: 1, scan: { st: 'ready', v: V } } as any, { tf: 'D' }).session, 'provisional');
  assert.equal(sessionLabel(analysisOf({ t: 'Z', scanAt: '2026-10-12', scan: { st: 'ready', v: V, session: 'completed' } } as any, null)), 'completed close 2026-10-12');
  // coverage: one provisional row makes the daily line provisional, with its count
  const cov = scopeCoverage([live, { t: 'Z', patAt: '2026-10-13', scanAt: '2026-10-13', scan: { st: 'no-pattern', v: V, session: 'completed' } } as any], ['D'], null);
  assert.match(coverageLine(cov.perTf[0]), /^Daily — provisional \(session open, observed 14:46 UTC\) \(1 provisional\): 2 of 2 scanned/);
});

test('zzz1004 PS-05: the heading is the ACTIVE query; the preset name is apart and marked changed', () => {
  const q = { ...screenQ('all-bearish'), bias: 'U' as const, tfs: ['M' as const], dist: { on: false, lo: -15, hi: 5 } };
  assert.match(querySummary(q, 'My portfolio'), /^Bullish · Monthly · My portfolio · Forming \+ Breakout · No pivot limit · All applicable patterns · Shape ≥ 55$/);
  assert.equal(presetLine('All bearish patterns', true), 'Preset: All bearish patterns (changed)');
  assert.match(querySummary(screenQ('all-bearish'), ''), /^Bearish · Daily · All companies · Forming \+ Breakdown · Pivot -15% to \+5%/);
  assert.match(querySummary({ ...q, tfs: ['W', 'M'], tfMode: 'all' }, ''), /Weekly \+ Monthly \(all\)/);
});

test('zzz1004 PS-02: coverage counts reflect the selected timeframes and the current list', () => {
  const rows = [
    ...ROWS,
    { t: 'SHORT', scan: { st: 'no-pattern', v: V }, patAt: '2026-10-13', scanW: { st: 'insufficient-history', v: V, tf: 'W' } } as any,
    { t: 'OLD', scan: { st: 'stale-version', v: 4 }, scanW: { st: 'stale-version', v: 5, tf: 'W' } } as any,
  ] as ScreenRow[];
  const list = new Set(['AEQUS', 'JKIPL', 'SHORT', 'OLD', 'MISSING']);
  const cov = scopeCoverage(rows, ['W'], list);
  assert.equal(cov.inData, 4);
  assert.deepEqual(cov.notInData, ['MISSING']);
  const w = cov.perTf[0];
  assert.deepEqual([w.ready, w.noPattern, w.insufficient, w.stale], [2, 0, 1, 1]);
  assert.match(coverageLine(w), /^Weekly — completed weekly close 2026-10-09: 2 of 4 scanned \(2 with a pattern, 0 none\) · 1 too little history · 1 stale version$/);
  // the whole market is not the list
  assert.equal(scopeCoverage(rows, ['W'], null).perTf[0].ready, 7);
  // coverage rows: every list member that is not a match, with its reason
  const q = { ...screenQ('pf-bullish-opps') };
  const run = runPineFull(rows, q, 'IN');
  const cr = listCoverageRows({ rows, q, market: 'IN', list, listName: 'My portfolio', run });
  assert.deepEqual(cr.map((x) => x.ticker), ['MISSING', 'OLD', 'SHORT']);
  assert.equal(cr[0].verdict, 'not-in-data');
});

test('zzz1004 PS-06: pattern types the engine does not read on M are disabled with the reason; a saved query says "unsupported on M"', () => {
  const fb = chipApplicability('flat_base', ['M']);
  assert.equal(fb.na, true); assert.equal(fb.suggest, 'W');
  assert.match(fb.reason, /Not read on M: a 5–26 week base is 1–6 monthly candles — try weekly \(W\)/);
  for (const id of ['cup_handle', 'ipo_base', 'bull_flag', 'ascending_triangle', 'falling_wedge'] as const) assert.equal(chipApplicability(id, ['M']).na, true, id);
  for (const id of ['u_base', 'cup', 'vcp', 'double_bottom', 'inverse_hs'] as const) assert.equal(chipApplicability(id, ['M']).na, false, id);
  assert.equal(chipApplicability('flat_base', ['D', 'M']).na, false, 'still read on D');
  assert.equal(chipApplicability('bull_flag', ['W']).suggest, 'D');
  const notice = unsupportedNotice({ ids: ['flat_base', 'cup'], tfs: ['M'], tfMode: 'any' });
  assert.equal(notice.length, 1);
  assert.match(notice[0], /^Flat base: unsupported on M — .*cannot match under this choice; the count is not a "none found".*read on weekly bars \(W\)/);
  assert.equal(unsupportedChoices(['flat_base'], ['D', 'M'], 'any')[0].blocked, false);
  assert.equal(unsupportedChoices(['flat_base'], ['D', 'M'], 'all')[0].blocked, true);
});

test('zzz1004 PS-04 / Monthly Bases: presets, the monthly card with reversal bases counted apart, families', () => {
  const risk = BUILT_IN_PINE_SCREENS.find((s) => s.id === 'pf-bearish-risks')!;
  assert.equal(risk.scope, 'pf'); assert.equal(risk.q.bias, 'D'); assert.deepEqual(risk.q.tfs, ['D', 'W', 'M']); assert.equal(risk.q.tfMode, 'any');
  assert.deepEqual(risk.q.stages, ['f', 'b']); assert.equal(risk.q.dist.on, false);
  assert.deepEqual([risk.q.mcMin, risk.q.mcMax, risk.q.turnMin, risk.q.pxMin, risk.q.perfMin, risk.q.filters.length, risk.q.sectors.length], [null, null, null, null, null, 0, 0]);
  const opp = BUILT_IN_PINE_SCREENS.find((s) => s.id === 'pf-bullish-opps')!;
  assert.equal(opp.scope, 'pf'); assert.equal(opp.q.bias, 'U'); assert.deepEqual(opp.q.tfs, ['D', 'W', 'M']);
  const rec = BUILT_IN_PINE_SCREENS.find((s) => s.id === 'pf-failed-bearish')!;
  assert.equal(rec.q.bias, 'D'); assert.deepEqual(rec.q.stages, ['x']);
  const mb = BUILT_IN_PINE_SCREENS.find((s) => s.id === 'monthly-bases')!;
  assert.deepEqual(mb.q.tfs, ['M']); assert.deepEqual(mb.q.ids, MONTHLY_BASE_IDS); assert.deepEqual(mb.q.stages, ['f', 'b']); assert.equal(mb.q.dist.on, false);
  assert.equal(mb.scope, undefined, 'monthly bases keep whatever company list is chosen');
  assert.deepEqual(screenQ('monthly-reversal-bases').ids, MONTHLY_REVERSAL_IDS);
  assert.equal(screenQ('monthly-near-pivot').dist.on, true);
  for (const id of [...MONTHLY_BASE_IDS, ...MONTHLY_REVERSAL_IDS]) assert.equal(chipApplicability(id, ['M']).na, false, id);
  assert.equal(familyOf('monthly-near-pivot')!.id, 'monthly'); assert.equal(familyOf('pf-bearish-risks')!.id, 'portfolio'); assert.equal(familyOf('all-bullish'), null);
  // the monthly card counts bases and, apart, reversal bases
  const T = (id: any, o: any = {}) => ({ id, b: 'U', s: 'f', c: 70, p: 100, d: -6, tf: 'M', l: 20, lu: 'm', ...o });
  const rows = [
    { t: 'UB', scan: { st: 'no-pattern', v: V }, patAt: 'x', patM: [T('u_base')], scanM: { st: 'ready', v: V, tf: 'M', px: 94, asOf: '2026-09-30' } },
    { t: 'DB', scan: { st: 'no-pattern', v: V }, patAt: 'x', patM: [T('double_bottom', { s: 'b', d: 2 })], scanM: { st: 'ready', v: V, tf: 'M', px: 102, asOf: '2026-09-30' } },
  ] as any as ScreenRow[];
  assert.ok(SETUP_CARDS.some((c) => c.id === 'monthly' && c.presetId === 'monthly-bases'));
  const n = setupCounts(rows, 'US', null, []);
  assert.equal(n.monthly, 1); assert.equal(n['monthly:alt'], 1);
});

test('zzz1004 PS-04: the portfolio check Risks / Opportunities views list every holding (matched first, the rest as coverage rows)', () => {
  const rows = [
    { t: 'BROKE', scan: { st: 'ready', v: V }, patAt: 'x', pat: [{ id: 'double_top', b: 'D', s: 'b', c: 70, p: 100, d: -30 }], scanPx: 70, sma200: 90 },      // broke support long ago, 30% below
    { t: 'WEAK', scan: { st: 'ready', v: V }, patAt: 'x', pat: [{ id: 'head_shoulders', b: 'D', s: 'f', c: 40, p: 100, d: 25 }], scanPx: 125 },
    { t: 'BULL', scan: { st: 'ready', v: V }, patAt: 'x', pat: [{ id: 'cup', b: 'U', s: 'f', c: 66, p: 100, d: -20 }], scanPx: 80 },
    { t: 'NOSCAN', scan: { st: 'insufficient-history', v: V } },
  ] as any as ScreenRow[];
  const items = portfolioCheck(rows, ['BROKE', 'WEAK', 'BULL', 'NOSCAN', 'GONE']);
  const risks = portfolioFocus(items, 'risks');
  assert.equal(risks.length, 5, 'every holding is represented');
  assert.deepEqual(risks.filter((x) => x.matched).map((x) => x.item.ticker), ['BROKE', 'WEAK'], 'a long-broken support is not hidden by a pivot window; a weak one is shown');
  assert.match(risks.find((x) => x.item.ticker === 'BULL')!.coverage, /^no bearish pattern on D/);
  assert.match(risks.find((x) => x.item.ticker === 'NOSCAN')!.coverage, /^not scanned \(daily: too little price history/);
  assert.equal(risks.find((x) => x.item.ticker === 'GONE')!.coverage, 'not in the screener data');
  assert.deepEqual(portfolioFocus(items, 'opps').filter((x) => x.matched).map((x) => x.item.ticker), ['BULL']);
  // the old default near-pivot bearish screen hides BROKE; the risk screen does not
  assert.ok(!runPineFull(rows, screenQ('all-bearish'), 'US').strict.some((h) => h.row.t === 'BROKE'));
  assert.ok(runPineFull(rows, screenQ('pf-bearish-risks'), 'US').strict.some((h) => h.row.t === 'BROKE'));
});

test('zzz1004 length sorts by elapsed duration across timeframes (9 d < 9 wk < 9 mo)', () => {
  assert.equal(lengthDays({ l: 9 }), 9);
  assert.equal(lengthDays({ l: 9, lu: 'w', tf: 'W' }), 45);
  assert.equal(lengthDays({ l: 9, tf: 'M' }), 189);
  assert.equal(lengthDays({}), null);
});

test('zzz1004 a screen keeps its company list when saved; a one-off hand-off is never saved', () => {
  const s = cleanPineScreens([{ id: 'a', name: 'A', q: {}, scope: 'pf' }, { id: 'b', name: 'B', q: {}, scope: 'hand' }, { id: 'c', name: 'C', q: {}, scope: 'wl:abc' }, { id: 'd', name: 'D', q: {} }]);
  assert.deepEqual(s.map((x) => x.scope), ['pf', undefined, 'wl:abc', undefined]);
});

test('zzz1004 Pine page (JSDOM): active-query heading, M disables unsupported chips, list kept across screens, CSV metadata', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/pine-screener?market=IN', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'Blob'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  const blobs: string[] = [];
  Object.defineProperty(globalThis, 'Blob', { value: class { constructor(parts: string[]) { blobs.push(parts.join('')); } }, configurable: true, writable: true });
  const oldCreate = (URL as any).createObjectURL, oldRevoke = (URL as any).revokeObjectURL;
  (URL as any).createObjectURL = () => 'blob:x'; (URL as any).revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  (dom.window as any).confirm = () => true;
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const { leanRows } = await import('../screener/pine');
  (globalThis as any).fetch = async (url: string) => ({
    ok: true, status: 200,
    json: async () => (url.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-13T12:00:00Z', ...leanRows(ROWS), notes: [] } : { ok: true }),
  });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  const text = () => document.body.textContent || '';
  const click = async (pred: (b: HTMLButtonElement) => boolean) => {
    const b = Array.from(document.querySelectorAll('button')).find(pred);
    assert.ok(b, 'button');
    await act(async () => { b!.click(); await settle(); });
  };
  const choose = async (label: string, value: string) => {
    const el = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    await act(async () => { el.value = value; el.dispatchEvent(new (window as any).Event('change', { bubbles: true })); await settle(); });
  };
  try {
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); await settle(); });
    const h2 = () => document.querySelector('[data-testid="active-query"]')!.textContent!;
    assert.match(h2(), /^Bullish · Daily · All companies · Forming \+ Breakout/);
    // weekly only: the seven examples, OMFREIGHT outside the +5% window, the latest-condition badges
    await click((b) => b.getAttribute('aria-label') === 'weekly patterns');
    await click((b) => b.getAttribute('aria-label') === 'daily patterns');
    assert.match(h2(), /^Bullish · Weekly · All companies/);
    assert.match(document.querySelector('[data-testid="preset-line"]')!.textContent!, /^Preset: All bullish patterns \(changed\)$/);
    const listed = () => Array.from(document.querySelectorAll('tbody tr a[data-ticker]')).map((a) => a.textContent).sort();
    assert.deepEqual(listed(), EX.map((e) => e.t).filter((t) => t !== 'OMFREIGHT').sort());
    assert.equal(document.querySelectorAll('tr [data-cond="back-through"]').length, 2, 'AEQUS and JKIPL');
    assert.equal(document.querySelectorAll('tr [data-cond="marginal"]').length, 1, 'DBSTOCKBRO');
    assert.match(text(), /Weekly — completed weekly close 2026-10-09: 7 of 7 scanned \(7 with a pattern, 0 none\)/);
    // the row detail shows the weekly analysis close, not the daily close
    await click((b) => b.getAttribute('aria-label') === 'Details for AEQUS');
    const an = document.querySelector('[data-price="analysis"]')!.textContent!;
    assert.match(an, /Weekly analysis close ₹273\.50 · week to 2026-10-09/);
    assert.match(document.querySelector('[data-price="daily"]')!.textContent!, /Daily technical close ₹265\.10 on 2026-10-13/);
    // CSV: analysis close / date per timeframe, daily close apart, the active query and the preset on every row
    await click((b) => b.textContent === 'Download CSV');
    const csv = blobs.at(-1)!;
    assert.match(csv, /Analysis close \(INR\),Analysis close date/);
    assert.match(csv, /AEQUS,NSE,.*,W,273\.5,2026-10-09,completed weekly close 2026-10-09,ready,\d+,265\.1,2026-10-13,completed,265\.1,nse-bhav,2026-10-13,latest quote back below pivot,55,/);
    assert.match(csv, /Bullish · Weekly · All companies · Forming \+ Breakout · Pivot -15% to \+5% · All applicable patterns · Shape ≥ 55,Preset: All bullish patterns \(changed\)/);
    // bearish: the heading follows the live direction (PS-05)
    await click((b) => b.textContent === '▼ Bearish');
    assert.match(h2(), /^Bearish · Weekly/);
    await click((b) => b.textContent === '▲ Bullish');
    // monthly only: the types the engine does not read on M are disabled with the reason
    await click((b) => b.getAttribute('aria-label') === 'monthly patterns');
    await click((b) => b.getAttribute('aria-label') === 'weekly patterns');
    const fb = document.querySelector('button[data-pat="flat_base"]') as HTMLButtonElement;
    assert.equal(fb.disabled, true); assert.match(fb.title, /Not read on M/); assert.match(fb.textContent!, /n\/a on M/);
    assert.equal((document.querySelector('button[data-pat="cup"]') as HTMLButtonElement).disabled, false);
    // screens: a company list picked by hand survives a screen change; a screen saved with a list (the portfolio ones) sets it.
    // zzz1016 (coordinator) — a list SET BY A SCREEN is not carried: the next screen without one goes back to the list picked by hand
    await choose('Pine screens', 'monthly-bases');
    assert.match(h2(), /^Bullish · Monthly · All companies · Forming \+ Breakout · No pivot limit · U \/ rounding base, Cup, VCP/);
    assert.ok(document.querySelector('[role="radiogroup"][aria-label="Monthly variants"]'));
    await choose('Pine screens', 'pf-bearish-risks');
    assert.match(h2(), /^Bearish · Daily \+ Weekly \+ Monthly \(any\) · My portfolio · Forming \+ Breakdown · No pivot limit · All applicable patterns · Shape ≥ 35/);
    await choose('Pine screens', 'all-bullish');
    assert.match(h2(), /^Bullish · Daily · All companies · /, 'the list set by the portfolio screen is not carried to the next screen (zzz1016)');
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 50));
    (URL as any).createObjectURL = oldCreate; (URL as any).revokeObjectURL = oldRevoke;
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
});
