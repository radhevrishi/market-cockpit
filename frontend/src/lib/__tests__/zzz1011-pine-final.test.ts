// zzz1011 — PINE FINAL (tester brief §1, §3, §5, §6 screener side, §8): presets set their own stages and can be restored; "no pattern
// types ticked" = All applicable patterns; stage / score / distance / type come from ONE qualifying reading; ANY / ALL for every
// timeframe combination in both markets; the latest condition (forming · crossed · holding · retesting · back inside · invalidated ·
// expired) apart from the historical event, mirrored for bearish; the one-click workflows; eligible / evaluated / matched / unavailable;
// the Rule of 40's formula with missing = unknown; and the page itself (JSDOM): Breakouts → W → W+M keeps the stage, Restore preset
// stages, workflows, keyboard review, the shortcut sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN_META, type PatternId } from '../chart-patterns';
import {
  runPineFull, cleanQuery, leanRows, r40Explain, R40_FORMULA, R40_FIELDS, DEFAULT_QUERY, PATTERN_SCAN_VERSION, type PineQuery, type ScreenPatternTag,
} from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import {
  conditionState, WORKFLOWS, workflowScope, presetStages, stagesDiffer, screenFunnel, perfPath, querySummary, tagRejectReasons,
  NO_STAGE_TEXT, ALL_TYPES_TEXT, EXPIRE_DAYS,
} from '../screener/pine-view';
import type { PatTf } from '../screener/filters';
import type { ScreenMarket, ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const NOW = new Date('2026-10-13T12:00:00Z');
const T = (id: PatternId, s: 'f' | 'b' | 'x', c: number, d: number | null, extra: Partial<ScreenPatternTag> = {}): ScreenPatternTag =>
  ({ id, b: PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s, c, p: 100, d, ...extra });
const cur = (tf: PatTf, px = 100) => ({ st: 'ready', v: PATTERN_SCAN_VERSION, px, asOf: tf === 'M' ? '2026-09-30' : tf === 'W' ? '2026-10-09' : '2026-10-12', ...(tf !== 'D' ? { tf } : {}) });
const Q = (o: Partial<PineQuery> = {}): PineQuery => ({ ...DEFAULT_QUERY, ...o, dist: { ...DEFAULT_QUERY.dist, ...(o.dist || {}) } });
const screenQ = (id: string) => BUILT_IN_PINE_SCREENS.find((s) => s.id === id)!.q;
const tick = (h: { row: ScreenRow }) => h.row.t;

// ── §3: presets set their stages; restore; never an empty stage from a preset ───────────────────────────────────────────
test('zzz1011 every built-in screen names its stages explicitly; Restore preset stages puts exactly those back', () => {
  const src = read('lib/screener/pine-presets.ts');
  const calls = src.split('\n').filter((l) => /^\s{2}screen\('/.test(l));
  assert.ok(calls.length >= 20);
  // the screen() helper takes `stages` as a required field (PresetQ), so a preset cannot inherit a default or empty choice
  assert.match(src, /type PresetQ = Partial<PineQuery> & Pick<PineQuery, 'stages'>/);
  for (const s of BUILT_IN_PINE_SCREENS) {
    assert.ok(s.q.stages.length > 0, `${s.id} has stages`);
    assert.deepEqual(presetStages(s.id), s.q.stages, s.id);
    assert.equal(stagesDiffer(s.id, s.q.stages), false, s.id);
    assert.equal(stagesDiffer(s.id, s.q.stages.slice().reverse()), false, `${s.id}: order does not matter`);
  }
  assert.deepEqual(presetStages('breakouts-today'), ['b']);
  assert.equal(stagesDiffer('breakouts-today', []), true);
  assert.equal(stagesDiffer('breakouts-today', ['f', 'b']), true);
  assert.equal(presetStages('my-saved-screen'), null);
  assert.equal(stagesDiffer('my-saved-screen', []), false, 'a saved screen has no preset to restore');
  // the empty choice is a prompt, not a result
  assert.equal(NO_STAGE_TEXT, 'Select a stage to evaluate patterns.');
  assert.match(querySummary(Q({ stages: [] }), ''), /No stage selected/);
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, />Restore preset stages</);
  assert.match(ui, /NO_STAGE_TEXT/);
  // a timeframe toggle only changes the timeframes
  assert.match(ui, /const toggleTf = \(tf: PatTf\) => \{ const next = [^\n]*change\(\{ tfs: next \}\)/);
});

test('zzz1011 "no pattern types ticked" reads All applicable patterns (summary, panel)', () => {
  assert.equal(ALL_TYPES_TEXT, 'All applicable patterns');
  assert.match(querySummary(Q(), ''), / · All applicable patterns · Shape ≥ 55$/);
  assert.doesNotMatch(querySummary(Q({ ids: ['cup'] }), ''), /All applicable/);
  assert.doesNotMatch(querySummary(Q({ need: 'any' }), ''), /All applicable/, 'a rules-only screen does not need a pattern');
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, /hint=\{allOfBias \? ALL_TYPES_TEXT/);
});

// ── §3: stage, score, distance and type come from ONE qualifying reading ─────────────────────────────────────────────────
test('zzz1011 the hit\'s stage, score, distance and type all belong to the same qualifying tag', () => {
  // the stronger cup is 20% below its pivot (outside the -15…+5 window); the weaker flat base qualifies
  const r = { t: 'MIX', n: 'Mix', px: 97, pat: [T('cup_handle', 'f', 82, -20), T('flat_base', 'f', 61, -3), T('double_top', 'f', 90, 2)], patAt: '2026-10-12', scan: cur('D', 97) } as unknown as ScreenRow;
  const [h] = runPineFull([r], Q(), 'US', NOW).strict;
  assert.equal(h.best!.id, 'flat_base');
  assert.equal(h.best!.c, 61, 'never the 82 of the cup that failed the window');
  assert.equal(h.best!.d, -3);
  assert.equal(h.best!.s, 'f');
  assert.ok(h.tags.includes(h.best!), 'the best is one of the matching tags');
  assert.ok(!h.tags.some((t) => t.id === 'cup_handle' || t.id === 'double_top'), 'non-qualifying readings are not in the hit');
  // property over many combinations: every hit's best passes the query on its own
  const ids: PatternId[] = ['cup', 'flat_base', 'vcp', 'bull_flag', 'double_bottom', 'double_top', 'head_shoulders'];
  const rows: ScreenRow[] = [];
  let k = 0;
  for (const a of ids) for (const b of ids) {
    const tags = [T(a, (['f', 'b', 'x'] as const)[k % 3], 35 + (k * 7) % 60, -25 + (k * 3) % 33, { tf: 'D' }), T(b, (['f', 'b', 'x'] as const)[(k + 1) % 3], 35 + (k * 11) % 60, -10 + (k * 5) % 20, { tf: 'W' })];
    rows.push({ t: `R${k++}`, pat: [tags[0]], patW: [tags[1]], patAt: '2026-10-12', scan: cur('D'), scanW: cur('W'), scanM: cur('M'), patM: [] } as unknown as ScreenRow);
  }
  for (const q of [Q(), Q({ bias: 'both', tfs: ['D', 'W'] }), Q({ bias: 'D', stages: ['f', 'b', 'x'], dist: { on: false, lo: 0, hi: 0 } }), Q({ tfs: ['D', 'W'], tfMode: 'all', stages: ['f', 'b', 'x'], minConf: 35, dist: { on: false, lo: 0, hi: 0 } })]) {
    for (const hit of runPineFull(rows, q, 'US', NOW).strict) {
      assert.ok(hit.best && hit.tags.includes(hit.best), `${hit.row.t}: best is a matching tag`);
      assert.deepEqual(tagRejectReasons(hit.best!, q), [], `${hit.row.t}: the best reading passes every pattern choice itself`);
    }
  }
});

// ── §3: ANY / ALL for every timeframe combination, both markets ──────────────────────────────────────────────────────────
test('zzz1011 ANY / ALL matching for D, W, M, D+W, D+M, W+M, D+W+M in both markets', () => {
  const SETS: PatTf[][] = [['D'], ['W'], ['M'], ['D', 'W'], ['D', 'M'], ['W', 'M'], ['D', 'W', 'M']];
  const key = (s: readonly PatTf[]) => s.join('');
  const make = (has: PatTf[]): ScreenRow => ({
    t: `HAS_${key(has)}`, n: key(has), px: 99,
    pat: has.includes('D') ? [T('cup', 'f', 70, -2)] : [], patW: has.includes('W') ? [T('cup', 'f', 70, -2, { tf: 'W' })] : [], patM: has.includes('M') ? [T('u_base', 'f', 70, -2, { tf: 'M' })] : [],
    patAt: '2026-10-12', scan: cur('D'), scanW: cur('W'), scanM: cur('M'),
  } as unknown as ScreenRow);
  const rows = SETS.map(make);
  for (const market of ['US', 'IN'] as ScreenMarket[]) {
    for (const sel of SETS) {
      for (const mode of ['any', 'all'] as const) {
        const got = runPineFull(rows, Q({ tfs: sel, tfMode: mode }), market, NOW).strict.map(tick).sort();
        const want = SETS.filter((has) => (mode === 'any' ? sel.some((tf) => has.includes(tf)) : sel.every((tf) => has.includes(tf)))).map((has) => `HAS_${key(has)}`).sort();
        assert.deepEqual(got, want, `${market} ${key(sel)} ${mode}`);
        // the best reading is on one of the selected timeframes
        for (const h of runPineFull(rows, Q({ tfs: sel, tfMode: mode }), market, NOW).strict) assert.ok(sel.includes((h.best!.tf || 'D') as PatTf), `${market} ${key(sel)} ${mode} ${h.row.t}`);
      }
    }
  }
  // a selected timeframe that cannot be read: ALL is not a pass, ANY still matches on the readable one
  const noM = { ...make(['D', 'W', 'M']), t: 'NOM', scanM: { st: 'insufficient-history', v: PATTERN_SCAN_VERSION, tf: 'M' } } as unknown as ScreenRow;
  assert.deepEqual(runPineFull([noM], Q({ tfs: ['W', 'M'], tfMode: 'all' }), 'IN', NOW).strict.map(tick), []);
  assert.deepEqual(runPineFull([noM], Q({ tfs: ['W', 'M'], tfMode: 'any' }), 'IN', NOW).strict.map(tick), ['NOM']);
});

// ── §5: the latest condition apart from the historical event, mirrored for bearish ───────────────────────────────────────
test('zzz1011 condition states — forming, crossed, holding, retesting, back inside, invalidated, expired — bullish and bearish', () => {
  const row = (px: number) => ({ t: 'X', px, scan: cur('D', px), scanPx: px, scanAt: '2026-10-12', patAt: '2026-10-12' } as unknown as ScreenRow);
  const st = (t: ScreenPatternTag, px = 103, now = NOW) => conditionState(row(px), t, now);
  // bullish (d = analysis close vs pivot, + = above)
  assert.equal(st(T('cup', 'f', 70, -4)).id, 'forming');
  assert.equal(st(T('cup', 'f', 70, 0.3)).id, 'crossed', 'at / past the pivot without a recorded breakout');
  assert.equal(st(T('cup', 'b', 70, 0.2), 100.2).id, 'crossed');
  assert.equal(st(T('cup', 'b', 70, 3), 103).id, 'holding');
  assert.equal(st(T('cup', 'b', 70, 3), 100.6).id, 'retesting', 'analysis close beyond, the latest quote back at the level');
  const back = st(T('cup', 'b', 70, -1.2), 98.8);
  assert.equal(back.id, 'returned'); assert.equal(back.label, 'Back below pivot');
  assert.equal(back.event.id, 'breakout', 'the historical event is kept');
  assert.match(back.event.label, /daily breakout \(first daily close beyond the pivot in the last 5 sessions\)/);
  assert.equal(st(T('cup', 'x', 70, -9)).id, 'invalidated');
  assert.equal(st(T('cup', 'x', 70, -9)).event.id, 'failed');
  assert.equal(st(T('cup', 'f', 70, -4)).event.id, null);
  // expired: the observation is older than its timeframe's window
  const later = new Date(Date.parse('2026-10-12T00:00:00Z') + (EXPIRE_DAYS.D + 1) * 86_400_000);
  assert.equal(st(T('cup', 'b', 70, 3), 103, later).id, 'expired');
  assert.equal(st(T('cup', 'x', 70, -9), 90, later).id, 'invalidated', 'invalidated wins over expired');
  // bearish mirror (d raw: close vs level, − = below = beyond a breakdown)
  const bear = (s: 'f' | 'b' | 'x', d: number, px: number) => st(T('double_top', s, 70, d), px);
  assert.equal(bear('f', 4, 104).id, 'forming');
  const hold = bear('b', -3, 97);
  assert.equal(hold.id, 'holding'); assert.equal(hold.label, 'Holding below level'); assert.equal(hold.event.id, 'breakdown');
  const ret = bear('b', 1, 101);
  assert.equal(ret.id, 'returned'); assert.equal(ret.label, 'Back above level');
  assert.equal(bear('b', -3, 99.5).id, 'retesting');
  assert.equal(bear('b', -0.2, 99.8).label, 'Level crossed');
  // the table, the detail and the CSV all show the condition apart from the event
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, /<Th label="Condition" k="cond"/);
  assert.match(ui, /'Historical event', 'Condition \(analysis close\)'/);
  assert.match(read('components/pine-screener/HitDetail.tsx'), /data-detail="event"[\s\S]*data-detail="condition"/);
});

// ── §8: workflows ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz1011 the eight one-click workflows exist, each on a built-in screen with its company list', () => {
  assert.deepEqual(WORKFLOWS.map((w) => w.label), [
    'Bullish opportunities in my portfolio', 'Bearish risks in my portfolio', 'Forming bases in a watchlist', 'Recent breakouts holding',
    'Breakouts back below pivot', 'Monthly bases', 'Monthly reversal candidates', 'Weekly + monthly aligned',
    'Accumulation in my portfolio', 'Distribution warning in my portfolio', 'Weekly + monthly + accumulation', 'Weekly + monthly + STRONG/BLOCKBUSTER result', 'Weekly + monthly + accumulation + strong result', 'Stage 2 weakening in my portfolio']);   // zzz1046a, zzz1047
  for (const w of WORKFLOWS) assert.ok(BUILT_IN_PINE_SCREENS.some((s) => s.id === w.presetId), w.presetId);
  assert.equal(workflowScope(WORKFLOWS[0], 'cb', 'L1'), 'pf');
  assert.equal(workflowScope(WORKFLOWS[2], 'wl:MINE', 'L1'), 'wl:MINE', 'the chosen watchlist');
  assert.equal(workflowScope(WORKFLOWS[2], '', 'L1'), 'wl:L1', 'else the active one');
  assert.equal(workflowScope(WORKFLOWS[3], 'cb', 'L1'), 'cb', 'others keep the current list');
  const mtf = screenQ('mtf-aligned');
  assert.deepEqual([mtf.bias, mtf.tfs, mtf.tfMode], ['U', ['W', 'M'], 'all']);
  assert.deepEqual(screenQ('monthly-reversal-bases').tfs, ['M']);
  assert.deepEqual(screenQ('wl-forming-bases').stages, ['f']);
});

test('zzz1011 breakouts holding vs back below the pivot (returned "only"), bullish and bearish', () => {
  const rows = [
    { t: 'NOW', n: 'Now', px: 99, pat: [T('cup', 'b', 70, -1)], patAt: '2026-10-12', scan: cur('D', 99) },
    { t: 'HOLD', n: 'Hold', px: 102, pat: [T('cup', 'b', 70, 2)], patAt: '2026-10-12', scan: cur('D', 102) },
    { t: 'FORM', n: 'Form', px: 97, pat: [T('cup', 'f', 70, -3)], patAt: '2026-10-12', scan: cur('D', 97) },
  ] as unknown as ScreenRow[];
  assert.deepEqual(runPineFull(rows, screenQ('breakouts-back-below'), 'US', NOW).strict.map(tick), ['NOW']);
  assert.deepEqual(runPineFull(rows, screenQ('breakouts-holding'), 'US', NOW).strict.map(tick), ['HOLD']);
  assert.deepEqual(runPineFull(rows, Q({ stages: ['b'], dist: { on: false, lo: 0, hi: 0 } }), 'US', NOW).strict.map(tick).sort(), ['HOLD', 'NOW'], 'default: both, labelled apart');
  assert.equal(cleanQuery({ returned: 'only' }).returned, 'only');
  assert.equal(cleanQuery({ returned: false }).returned, false);
  assert.equal(cleanQuery({}).returned, true);
  assert.match(tagRejectReasons(T('cup', 'b', 70, 2), screenQ('breakouts-back-below')).join(), /breakout still above the pivot/);
  assert.match(querySummary(screenQ('breakouts-back-below'), ''), /Breakouts back below the pivot only/);
  // bearish mirror
  const bear = [
    { t: 'BACK', px: 101, pat: [T('double_top', 'b', 70, 1)], patAt: '2026-10-12', scan: cur('D', 101) },
    { t: 'BELOW', px: 97, pat: [T('double_top', 'b', 70, -3)], patAt: '2026-10-12', scan: cur('D', 97) },
  ] as unknown as ScreenRow[];
  assert.deepEqual(runPineFull(bear, Q({ bias: 'D', stages: ['b'], returned: 'only', dist: { on: false, lo: 0, hi: 0 } }), 'IN', NOW).strict.map(tick), ['BACK']);
  assert.deepEqual(runPineFull(bear, Q({ bias: 'D', stages: ['b'], returned: false, dist: { on: false, lo: 0, hi: 0 } }), 'IN', NOW).strict.map(tick), ['BELOW']);
  // ALL across timeframes is decided again on the kept tags
  const two = [{ t: 'TW', px: 99, pat: [T('cup', 'b', 70, -1)], patW: [T('cup', 'b', 70, 2, { tf: 'W' })], patAt: '2026-10-12', scan: cur('D', 99), scanW: cur('W', 102) }] as unknown as ScreenRow[];
  assert.deepEqual(runPineFull(two, Q({ tfs: ['D', 'W'], tfMode: 'all', stages: ['b'], returned: 'only', dist: { on: false, lo: 0, hi: 0 } }), 'US', NOW).strict.map(tick), []);
  assert.deepEqual(runPineFull(two, Q({ tfs: ['D', 'W'], tfMode: 'any', stages: ['b'], returned: 'only', dist: { on: false, lo: 0, hi: 0 } }), 'US', NOW).strict.map(tick), ['TW']);
});

test('zzz1011 eligible / evaluated / matched / unavailable per screen', () => {
  const rows = [
    { t: 'A', px: 99, pat: [T('cup', 'f', 70, -3)], patW: [T('cup', 'f', 70, -3, { tf: 'W' })], patAt: '2026-10-12', scan: cur('D'), scanW: cur('W') },
    { t: 'B', px: 99, pat: [], patW: [], patAt: '2026-10-12', scan: cur('D'), scanW: cur('W') },
    { t: 'C', px: 99, pat: [T('cup', 'f', 70, -3)], patAt: '2026-10-12', scan: cur('D'), scanW: { st: 'insufficient-history', v: PATTERN_SCAN_VERSION, tf: 'W' } },
    { t: 'D', px: 99, pat: [T('cup', 'f', 70, -3)], patAt: '2026-10-12', scan: cur('D'), scanW: cur('W'), patW: [] },
  ] as unknown as ScreenRow[];
  const list = new Set(['A', 'B', 'C', 'GHOST']);
  const qAll = Q({ tfs: ['D', 'W'], tfMode: 'all' });
  const f = screenFunnel(rows, qAll, list, runPineFull(rows, qAll, 'US', NOW));
  assert.deepEqual(f, { eligible: 3, evaluated: 2, matched: 1, unavailable: 2, notInData: 1, provisional: 0 }, 'C cannot be read on W; GHOST is not in the data');
  const qAny = Q({ tfs: ['D', 'W'], tfMode: 'any' });
  const g = screenFunnel(rows, qAny, null, runPineFull(rows, qAny, 'US', NOW));
  assert.deepEqual([g.eligible, g.evaluated, g.matched, g.unavailable], [4, 4, 3, 0]);
  assert.match(read('components/pine-screener/PineScreener.tsx'), /<FunnelStrip f=\{funnel\}/);
});

// ── §8: Rule of 40 — the exact formula, periods, fields; missing = unknown ────────────────────────────────────────────────
test('zzz1011 Rule of 40: formula, periods and fields shown; a missing input is unknown, never 0 or a pass', () => {
  assert.match(R40_FORMULA, /revenue growth \(latest reported quarter vs the same quarter a year earlier, %\) \+ free-cash-flow margin \(latest full fiscal year/);
  assert.deepEqual(R40_FIELDS.map((f) => f.key), ['revQYoY', 'fcfmTTM']);
  const miss = r40Explain({ revQYoY: 50 }, 40);
  assert.equal(miss.state, 'unknown'); assert.equal(miss.value, null); assert.equal(miss.pass, null);
  assert.match(miss.text, /Unknown — missing FCF margin \(latest full fiscal year/);
  assert.match(miss.text, /Not counted as 0 and never a pass/);
  const both = r40Explain({}, null);
  assert.equal(both.missing.length, 2);
  assert.deepEqual([r40Explain({ revQYoY: 30, fcfmTTM: 15 }, 40).value, r40Explain({ revQYoY: 30, fcfmTTM: 15 }, 40).pass], [45, true]);
  assert.equal(r40Explain({ revQYoY: 20, fcfmTTM: 5 }, 40).pass, false);
  assert.equal(r40Explain({ revQYoY: 400, fcfmTTM: 5 }, 40).state, 'guarded');
  assert.equal(r40Explain({ revQYoY: 400, fcfmTTM: 5 }, 40).pass, false);
  // a company without an input is never a strict match while others have the figures
  const rows = [
    { t: 'OK', px: 1, pat: [T('cup', 'f', 70, -3)], patAt: '2026-10-12', scan: cur('D'), revQYoY: 30, fcfmTTM: 15, r40: 45 },
    { t: 'MISS', px: 1, pat: [T('cup', 'f', 70, -3)], patAt: '2026-10-12', scan: cur('D'), revQYoY: 80 },
  ] as unknown as ScreenRow[];
  assert.deepEqual(runPineFull(rows, Q({ r40Min: 40 }), 'US', NOW).strict.map(tick), ['OK']);
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, /data-testid="r40-formula"/);
  assert.match(ui, /data-r40=\{x\.state\}/);
  assert.match(ui, /'unknown' \? <span className="pnx-unknown">unknown<\/span>/);
});

test('zzz1011 12-month path from the stored performance figures (no fetch)', () => {
  const p = perfPath({ perf1Y: 100, perf6M: 25, perf3M: 0, perf1M: -20, perf1W: 0 })!;
  assert.deepEqual(p.map((x) => x.at), ['−12M', '−6M', '−3M', '−1M', '−1W', 'now']);
  assert.deepEqual(p.map((x) => Math.round(x.v * 100) / 100), [0.5, 0.8, 1, 1.25, 1, 1]);
  assert.equal(perfPath({ perf1Y: 10 }), null, 'too few points');
  assert.doesNotMatch(read('components/pine-screener/pine-ui.tsx'), /fetch\(/, 'no per-row network fetch');
});

// ── the page (JSDOM) ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function withPage<T>(rows: unknown[], fn: (h: { act: any; click: (pred: (b: HTMLButtonElement) => boolean) => Promise<void>; text: () => string; settle: () => Promise<void>; key: (k: string) => Promise<void> }) => Promise<T>) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/pine-screener?market=US', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  (dom.window as any).confirm = () => true;
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  (globalThis as any).fetch = async (u: string) => ({ ok: true, status: 200, json: async () => (u.includes('detail=') ? { ok: true, geometry: { D: [], W: [], M: [], L: [] } } : u.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-13T12:00:00Z', ...leanRows(rows as ScreenRow[]), notes: [] } : { ok: true }) });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  const text = () => document.body.textContent || '';
  const click = async (pred: (b: HTMLButtonElement) => boolean) => { const b = Array.from(document.querySelectorAll('button')).find(pred); assert.ok(b, 'button'); await act(async () => { b!.click(); await settle(); }); };
  const key = async (k: string) => { await act(async () => { window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: k, bubbles: true })); await settle(); }); };
  try {
    try { localStorage.setItem('mc:pine-details:v1', '1'); } catch { /* no DOM */ }   // zzz1033 — coverage / count lines behind ⓘ Details
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); await settle(); });
    return await fn({ act, click, text, settle, key });
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 3000));
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
}

test('zzz1011 page (JSDOM): Breakouts → W → W+M keeps the stage; Restore preset stages; workflows; condition column; funnel; keyboard', async () => {
  const rows = [
    { t: 'NOW', n: 'Now Inc', px: 99, pat: [T('cup', 'b', 70, -1)], patW: [T('cup', 'b', 72, 1, { tf: 'W' })], patM: [T('u_base', 'f', 66, -4, { tf: 'M' })], patAt: '2026-10-12', scan: cur('D', 99), scanW: cur('W', 101), scanM: cur('M', 96), perf1Y: 40, perf6M: 10, perf3M: 5, perf1M: 2 },
    { t: 'HOLD', n: 'Hold Inc', px: 103, pat: [T('vcp', 'b', 80, 3)], patW: [T('vcp', 'f', 60, -2, { tf: 'W' })], patM: [T('cup', 'f', 61, -6, { tf: 'M' })], patAt: '2026-10-12', scan: cur('D', 103), scanW: cur('W', 98), scanM: cur('M', 94) },
    { t: 'BASE', n: 'Base Inc', px: 96, pat: [T('flat_base', 'f', 65, -4)], patW: [], patM: [], patAt: '2026-10-12', scan: cur('D', 96), scanW: cur('W', 96), scanM: cur('M', 96) },
  ];
  await withPage(rows, async ({ click, text, key }) => {
    const h2 = () => document.querySelector('[data-testid="active-query"]')!.textContent!;
    const listed = () => Array.from(document.querySelectorAll('tbody tr a[data-ticker]')).map((a) => a.textContent).sort();
    // the reproduction: Breakouts preset → weekly → weekly + monthly: the breakout stage stays selected
    await click((b) => b.getAttribute('data-card') === 'breakouts');
    assert.match(h2(), /· Breakout · /);
    await click((b) => b.getAttribute('aria-label') === 'weekly patterns');
    await click((b) => b.getAttribute('aria-label') === 'daily patterns');
    assert.match(h2(), /^Bullish · Weekly · .*· Breakout · /);
    await click((b) => b.getAttribute('aria-label') === 'monthly patterns');
    assert.match(h2(), /^Bullish · Weekly \+ Monthly \(any\) · .*· Breakout · /);
    assert.doesNotMatch(h2(), /No stage/);
    // a manual stage change offers the restore; it puts the preset's own stage back
    await click((b) => b.textContent === 'Forming');
    assert.match(h2(), /Breakout \+ Forming/);
    await click((b) => b.textContent === 'Restore preset stages');
    assert.match(h2(), /· Breakout · /); assert.doesNotMatch(h2(), /Forming/);
    assert.equal(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Restore preset stages'), false, 'gone once they match');
    // workflows: one click each, with their counts
    const flow = (id: string) => document.querySelector(`[data-flow="${id}"]`) as HTMLButtonElement;
    assert.equal(document.querySelectorAll('[data-flow]').length, 14);   // zzz1047: + Stage 2 weakening in my portfolio   // zzz1046a: + accumulation / distribution in my portfolio
    assert.equal(flow('bo-back').querySelector('[data-flow-count]')!.textContent, '1');
    await click((b) => b.getAttribute('data-flow') === 'bo-back');
    assert.deepEqual(listed(), ['NOW']);
    assert.equal(flow('bo-back').getAttribute('aria-pressed'), 'true');
    const cond = document.querySelector('tbody tr .pnx-cond')!;
    assert.equal(cond.getAttribute('data-state'), 'returned'); assert.equal(cond.textContent, 'Back below pivot');
    assert.equal(document.querySelector('tbody tr [data-event]')!.textContent, 'broke out', 'the event stays, apart from the condition');
    await click((b) => b.getAttribute('data-flow') === 'bo-holding');
    assert.deepEqual(listed(), ['HOLD']);
    await click((b) => b.getAttribute('data-flow') === 'mtf');
    assert.match(h2(), /^Bullish · Weekly \+ Monthly \(all\)/);
    assert.deepEqual(listed(), ['HOLD', 'NOW']);
    // the funnel: every company eligible and evaluated, two matched
    const fn = (k: string) => document.querySelector(`[data-funnel="${k}"]`)!.textContent;
    assert.deepEqual([fn('eligible'), fn('evaluated'), fn('matched'), fn('unavailable')], ['3', '3', '2', '0']);
    // analysis close always its own column, with its timeframe; quote apart
    assert.ok(Array.from(document.querySelectorAll('th')).some((th) => /Analysis close/.test(th.textContent || '')));
    assert.ok(Array.from(document.querySelectorAll('th')).some((th) => /^Quote/.test(th.textContent || '')));
    // keyboard: j moves the cursor, o opens the detail, ? the shortcut sheet
    await key('j');
    assert.equal(document.querySelector('tr.pnx-row[data-cursor="true"]')!.getAttribute('data-idx'), '0');
    await key('j');
    assert.equal(document.querySelector('tr.pnx-row[data-cursor="true"]')!.getAttribute('data-idx'), '1');
    await key('k');
    await key('o');
    assert.ok(document.querySelector('[data-detail="condition"]'), 'detail open');
    await key('?');
    assert.ok(document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]'));
    assert.match(text(), /Open the chart of the row/);
    await key('Escape');
    assert.equal(document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]'), null);
  });
});
