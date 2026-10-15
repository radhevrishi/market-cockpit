// zzz994 — Pine / Stock Screener UI audit (MC-03 … MC-08, section B): explicit stages, one action scope, shape-score wording,
// strict results with a provisional preview, price / market-cap formatting, the 'pattern' filter kind and D / W / M timeframes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN_META, type PatternId } from '../chart-patterns';
import {
  matchTags, runPine, runPineFull, patternCounts, cleanQuery, cleanPineScreens, ruleCoverage, pineRuleFields, ruleState, evalRowPatterns, leanRows,
  DEFAULT_QUERY, LIKELIHOODS, SHAPE_SCORE_LABEL, LEAN_KEYS, type PineQuery, type ScreenPatternTag,
} from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import {
  passes, runScreen, cleanScreens, filterLabel, filterKeys, fmtPrice, fmtMoney, fmtValue, evalPattern, patTagsOf, DEFAULT_PATTERN_RULE, type Filter,
} from '../screener/filters';
import { explainRow } from '../screener/research';
import { scopeItems, scopeCounts, scopeLabel, countsLine, emptyState, effectiveScope, confirmAddText } from '../screener/action-scope';
import type { ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const T = (id: PatternId, s: 'f' | 'b' | 'x', c: number, d: number | null, extra: Partial<ScreenPatternTag> = {}): ScreenPatternTag =>
  ({ id, b: PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s, c, p: 100, d, ...extra });
const row = (t: string, pat: ScreenPatternTag[] | undefined, o: Partial<ScreenRow> = {}): ScreenRow =>
  ({ t, n: `${t} Ltd`, px: 50, mc: 1000, avgVol30: 200_000, tvSec: 'Electronic Technology', perf3M: 20, ...(pat ? { pat, patAt: '2026-10-12' } : {}), ...o } as ScreenRow);
const Q = (o: Partial<PineQuery> = {}): PineQuery => ({ ...DEFAULT_QUERY, ...o, dist: { ...DEFAULT_QUERY.dist, ...(o.dist || {}) } });

const ROWS = [
  row('CUP', [T('cup_handle', 'f', 80, -4)]),
  row('FLAG', [T('bull_flag', 'b', 70, 2)]),
  row('FAIL', [T('flat_base', 'x', 60, -9)]),
  row('TOP', [T('double_top', 'f', 75, 3)]),
];

// ───────── MC-03: stages are explicit ─────────
test('zzz994 MC-03 no stage selected matches nothing; legacy empty stages migrate to all three explicitly', () => {
  assert.deepEqual(matchTags(ROWS[0], Q({ stages: [] })), []);
  assert.equal(runPine(ROWS, Q({ stages: [] }), 'US').length, 0, 'an empty-looking stage choice never broadens the result');
  assert.deepEqual(runPine(ROWS, Q({ stages: ['f', 'b', 'x'] }), 'US').map((h) => h.row.t).sort(), ['CUP', 'FAIL', 'FLAG']);
  // a screen saved before query format 2 with no stage ticked meant "every stage" — kept, but now explicit
  assert.deepEqual(cleanQuery({ bias: 'U', stages: [] }).stages, ['f', 'b', 'x']);
  assert.deepEqual(cleanPineScreens([{ id: 'my-old', name: 'Old', q: { stages: [] } }])[0].q.stages, ['f', 'b', 'x']);
  assert.deepEqual(cleanQuery({ qv: 2, stages: [] }).stages, [], 'a current screen keeps an empty choice (0 results + prompt)');
  assert.equal(cleanQuery({}).qv, 2);
  // built-in screens and their ids survive unchanged
  for (const s of BUILT_IN_PINE_SCREENS) { assert.deepEqual(cleanQuery(s.q), s.q, s.id); assert.ok(s.q.stages.length, s.id); }
  for (const id of ['all-bullish', 'all-bearish', 'tv-trend-template', 'failed-breakouts']) assert.ok(BUILT_IN_PINE_SCREENS.some((s) => s.id === id), id);   // zzz999: tv-rule-of-40 moved to the Stock Screener
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, />All stages</);
  assert.match(ui, /No stage selected/);
});

// ───────── MC-04 / MC-06: one action scope ─────────
test('zzz994 MC-04/06 action scope: searched result by default, all matches only when chosen, selection, distinct counts and empty states', () => {
  const all = ['A', 'B', 'C', 'D'].map((t) => ({ t }));
  const results = [all[2]];
  const key = (x: { t: string }) => x.t;
  const sets = { results, all, selected: new Set(['B', 'D', 'GONE']), provisional: [{ t: 'P' }] };
  assert.deepEqual(scopeItems(sets, 'results', key).map(key), ['C'], 'one searched row → one ticker');
  assert.deepEqual(scopeItems(sets, 'all', key).map(key), ['A', 'B', 'C', 'D']);
  assert.deepEqual(scopeItems(sets, 'selected', key).map(key), ['B', 'D'], 'ticks that are no longer matches are dropped');
  assert.deepEqual(scopeItems(sets, 'provisional', key).map(key), ['P']);
  const c = scopeCounts(sets, 1, key);
  assert.deepEqual(c, { shown: 1, results: 1, all: 4, selected: 2, provisional: 1 });
  assert.equal(countsLine(c, true), '1 shown · 1 search match · 4 filter matches · 2 selected');
  assert.equal(countsLine({ ...c, selected: 0 }, false), '1 shown · 4 filter matches');
  assert.equal(scopeLabel('all', c, true), 'All 4 filter matches (search ignored)');
  assert.equal(effectiveScope('selected', { ...c, selected: 0 }), 'results', 'never silently "all"');
  assert.equal(emptyState({ dataRows: 0, filterMatches: 0, searchMatches: 0, searching: false }), 'no-data');
  assert.equal(emptyState({ dataRows: 5, filterMatches: 0, searchMatches: 0, searching: true }), 'no-filter-match');
  assert.equal(emptyState({ dataRows: 5, filterMatches: 3, searchMatches: 0, searching: true }), 'no-search-match');
  assert.equal(emptyState({ dataRows: 5, filterMatches: 3, searchMatches: 3, searching: false }), null);
  assert.match(confirmAddText(21, 'Research', 'All 21 filter matches'), /^Add 21 symbols \(All 21 filter matches\) to “Research”/);
  // both pages use the shared helper for copy / CSV / watchlist (no more full-sorted-list exports beside a searched table)
  const stock = read('components/stock-screener/StockScreener.tsx');
  const pine = read('components/pine-screener/PineScreener.tsx');
  for (const src of [stock, pine]) { assert.match(src, /scopeItems\(/); assert.match(src, /countsLine\(/); assert.match(src, /confirmAddText\(/); assert.match(src, /Clear search/); }
  assert.doesNotMatch(stock, /for \(const r of sorted\)/, 'Stock add-to-watchlist no longer iterates the full sorted result');
  assert.doesNotMatch(stock, /sorted\.map\(\(r\) => \(market === 'IN' \? `NSE:/, 'Stock copy no longer uses the full sorted result');
  assert.match(pine, /aria-label=\{`Select \$\{r\.t\}`\}/, 'Pine rows can be selected');
});

// ───────── MC-05: shape score, never a percentage likelihood ─────────
test('zzz994 MC-05 shape score wording in table, filters and CSV; engine version and volume in the export', () => {
  assert.equal(SHAPE_SCORE_LABEL, 'Shape score (0–100)');
  for (const l of LIKELIHOODS) assert.doesNotMatch(l.label, /%/);
  assert.deepEqual(LIKELIHOODS.map((l) => l.min), [35, 55, 75]);
  const pine = read('components/pine-screener/PineScreener.tsx');
  assert.doesNotMatch(pine, /Likelihood \(%\)/);
  assert.doesNotMatch(pine, /label="Likelihood"/);
  assert.match(pine, /SHAPE_SCORE_LABEL, 'Shape score band', 'Volume confirmed'/);
  assert.match(pine, /'Scan engine version'/);
  assert.match(pine, /r\.scan\?\.v/);
  assert.match(pine, /Our own chart-pattern &amp; rule screener — it does not run Pine Script/);   // zzz1033 — moved into 'How the patterns are found'
  for (const s of BUILT_IN_PINE_SCREENS) assert.doesNotMatch(s.name, /\(your script\)/, s.id);
  assert.match(BUILT_IN_PINE_SCREENS.find((s) => s.id === 'tv-trend-template')!.name, /based on your TradingView script/);
});

// ───────── MC-07: strict by default, provisional apart ─────────
test('zzz994 MC-07 a rule that cannot be evaluated never certifies a pass; unsupported vs pending fields', () => {
  const rows = [
    row('HAS', [T('cup', 'f', 70, -3)], { revQYoY: 50 } as any),
    row('MISS', [T('cup', 'f', 70, -3)]),                                       // no revenue growth figure
    row('LOW', [T('cup', 'f', 70, -3)], { revQYoY: 5 } as any),
    row('NOSCAN', undefined, { revQYoY: 60 } as any),                          // never scanned for patterns
  ];
  const q = Q({ filters: [{ kind: 'num', key: 'revQYoY', op: 'gt', v: 20 }] });
  const r = runPineFull(rows, q, 'US');
  assert.deepEqual(r.strict.map((h) => h.row.t), ['HAS']);
  // zzz997: other companies have the figure / were scanned → a company without it simply does not match (not provisional)
  assert.deepEqual(r.provisional.map((h) => h.row.t), []);
  // provisional only while NO company has the figure (a build pending)
  const pend = runPineFull(rows.map(({ revQYoY: _x, ...rr }: any) => rr), q, 'US');
  assert.deepEqual(pend.provisional.map((h) => h.row.t).sort(), ['HAS', 'LOW', 'MISS']);
  assert.match(pend.provisional[0].missing!.join(), /Revenue growth, quarterly YoY/);
  assert.deepEqual(runPine(rows, q, 'US').map((h) => h.row.t), ['HAS'], 'runPine is strict');
  // a SPARSE field's absence is the answer itself (no golden cross in 20 sessions) — a fail, not "missing"
  assert.equal(ruleState(rows[0], { kind: 'num', key: 'gcD', op: 'le', v: 19 }, 'US'), 'fail');
  assert.equal(ruleState(rows[1], { kind: 'num', key: 'revQYoY', op: 'gt', v: 1 }, 'US'), 'missing');
  // coverage: a figure the Pine page never receives is unsupported (never "the next build fills it"); a delivered one with no data is pending
  assert.ok(!(LEAN_KEYS as readonly string[]).includes('roeFY'));   // zzz993: roeTTM is now sent (rule-editor fields)
  const cov = ruleCoverage(rows, [{ kind: 'num', key: 'roeFY', op: 'gt', v: 5 }, { kind: 'num', key: 'r40', op: 'ge', v: 40 }, { kind: 'cmp', key: 'px', op: 'above', other: 'sma200' }], 'US');
  assert.equal(cov.find((c) => c.key === 'roeFY')!.status, 'unsupported-pine');
  assert.equal(cov.find((c) => c.key === 'r40')!.status, 'pending');
  assert.equal(cov.find((c) => c.key === 'px')!.status, 'ok');
  assert.equal(ruleCoverage(rows, [{ kind: 'num', key: 'fcfEmp', op: 'gt', v: 0 }], 'IN')[0].status, 'unsupported-market');
  // the Pine rule editor only offers fields the page receives
  assert.ok(pineRuleFields('US').length > 10);
  assert.ok(pineRuleFields('US').every((f) => (LEAN_KEYS as readonly string[]).includes(f.key)));
  const pine = read('components/pine-screener/PineScreener.tsx');
  assert.match(pine, /not delivered to the Pine Screener/);
  assert.doesNotMatch(pine, /the next build of this market fills these figures in/);
});

// ───────── MC-08: formatting ─────────
test('zzz994 MC-08 prices at 2 decimals, market caps $ T/B/M and ₹ crore with Indian grouping; formatting never changes a filter', () => {
  assert.equal(fmtPrice(163.59, 'IN'), '₹163.59');
  assert.equal(fmtPrice(12.89, 'US'), '$12.89');
  assert.equal(fmtPrice(136.826, 'US'), '$136.83');
  assert.equal(fmtPrice(2450, 'IN'), '₹2,450.00');
  assert.equal(fmtPrice(12345.67, 'IN'), '₹12,345.7');
  assert.equal(fmtPrice(0.4321, 'US'), '$0.4321');
  assert.equal(fmtValue(163.59, 'price', 'IN'), '₹163.59', 'the shared formatter no longer rounds prices ≥ 100 to whole numbers');
  assert.equal(fmtMoney(30_000, 'US'), '$30B');
  assert.equal(fmtMoney(1_234, 'US'), '$1.2B');
  assert.equal(fmtMoney(2_500_000, 'US'), '$2.5T');
  assert.equal(fmtMoney(370, 'US'), '$370M');
  assert.equal(fmtMoney(123_456, 'IN'), '₹1,23,456 Cr');
  assert.equal(fmtMoney(5_000, 'IN'), '₹5,000 Cr');
  assert.equal(filterLabel({ kind: 'num', key: 'mc', op: 'between', v: 200, v2: 30_000 }, 'US'), 'Market cap $200M to $30B');
  // the filter compares the unrounded figure: 163.594 shows as ₹163.59 but fails "≥ 163.595"
  const r = row('X', [], { px: 163.594 });
  assert.equal(fmtPrice(r.px, 'IN'), '₹163.59');
  assert.equal(passes(r, { kind: 'num', key: 'px', op: 'ge', v: 163.595 }), false);
  assert.equal(passes(r, { kind: 'num', key: 'px', op: 'ge', v: 163.594 }), true);
});

// ───────── section B: the 'pattern' filter kind (Stock Screener) ─────────
test('zzz994 pattern filter kind: pass / fail / missing, explanation, label, saved-screen cleaning', () => {
  const f: Filter = { kind: 'pattern', ...DEFAULT_PATTERN_RULE, ids: ['cup_handle', 'bull_flag'] };
  assert.equal(passes(ROWS[0], f), true);
  assert.equal(passes(ROWS[1], f), true);
  assert.equal(passes(ROWS[3], f), false, 'bearish top is not a bullish cup / flag');
  assert.deepEqual(runScreen(ROWS, [f]).map((r) => r.t), ['CUP', 'FLAG']);
  assert.deepEqual(filterKeys(f), []);
  assert.match(filterLabel(f, 'US'), /^Pattern ▲ bullish: Cup with handle or Bull flag · D · forming\/breakout · score ≥ 55/);
  // an unscanned company cannot be evaluated → strict fail, with the reason
  const unscanned = row('NEW', undefined);
  assert.equal(evalPattern(unscanned, f).status, 'missing');
  assert.equal(passes(unscanned, f), false);
  assert.match(explainRow(unscanned, [f], 'US')[0].detail, /cannot be evaluated — daily: not scanned yet/);
  assert.match(explainRow(ROWS[0], [f], 'US')[0].detail, /matches: Cup with handle \[D\] score 80, -4% to pivot/);
  assert.match(explainRow(ROWS[0], [{ ...f, stages: [] } as Filter], 'US')[0].detail, /no stage selected/);
  // a stale / failed scan is "missing", not "no pattern"
  assert.equal(evalPattern({ ...ROWS[0], scan: { st: 'stale-version', v: 4 } }, f).status, 'missing');
  assert.equal(evalPattern({ ...ROWS[0], scan: { st: 'no-pattern', v: 5 }, pat: undefined }, f).status, 'fail');
  // saved screens keep the rule (and an empty stage list stays empty)
  const saved = cleanScreens([{ id: 'p', name: 'Pat', market: 'US', filters: [{ kind: 'pattern', bias: 'D', ids: ['double_top', 'bogus'], tfs: ['W', 'Q'], tfMode: 'all', stages: [], minScore: 10, dist: { on: false, lo: -5, hi: 5 } }] }]);
  assert.deepEqual(saved[0].filters[0], { kind: 'pattern', bias: 'D', ids: ['double_top'], tfs: ['W'], tfMode: 'all', stages: [], minScore: 35, dist: { on: false, lo: -5, hi: 5 } });
  const stock = read('components/stock-screener/StockScreener.tsx');
  // zzz1006 — the filter list is a searchable panel (AddFilterPanel), offering the same pattern rule
  assert.match(read('components/stock-screener/AddFilterPanel.tsx'), /key: 'pattern', label: 'Chart pattern'/);
  assert.match(stock, /<AddFilterPanel /);
  assert.match(read('components/stock-screener/FilterEditor.tsx'), /function PatternEditor/);
});

// ───────── weekly / monthly analysis timeframes ─────────
test('zzz994 D/W/M: matchTags reads pat / patW / patM, ANY vs ALL, unscanned timeframe is "missing", tf on every tag', () => {
  const both = row('BOTH', [T('cup', 'f', 70, -3)], { patW: [T('flat_base', 'f', 65, -2)], scanW: { st: 'ready', v: 5 } } as any);
  const dOnly = row('DONLY', [T('cup', 'f', 70, -3)]);
  assert.deepEqual(matchTags(both, Q({ tfs: ['W'] })).map((t) => [t.id, t.tf]), [['flat_base', 'W']]);
  assert.deepEqual(matchTags(both, Q({ tfs: ['D'] })).map((t) => [t.id, t.tf]), [['cup', 'D']]);
  assert.equal(matchTags(both, Q({ tfs: ['D', 'W'], tfMode: 'all' })).length, 2);
  // W not scanned for DONLY: ANY → D still matches; ALL → cannot be evaluated (provisional), never a silent pass or a silent zero
  assert.equal(evalRowPatterns(dOnly, Q({ tfs: ['D', 'W'], tfMode: 'any' })).status, 'pass');
  assert.equal(evalRowPatterns(dOnly, Q({ tfs: ['D', 'W'], tfMode: 'all' })).status, 'missing');
  assert.equal(evalRowPatterns(dOnly, Q({ tfs: ['W'] })).status, 'missing');
  assert.equal(patTagsOf(dOnly, 'W'), null);
  assert.deepEqual(patTagsOf(both, 'M'), null);
  const run = runPineFull([both, dOnly], Q({ tfs: ['W'] }), 'US');
  assert.deepEqual(run.strict.map((h) => h.row.t), ['BOTH']);
  // zzz997: another company was scanned weekly → DONLY simply has no weekly match (a daily pattern is never relabelled as weekly)
  assert.deepEqual(run.provisional.map((h) => h.row.t), []);
  assert.deepEqual(runPineFull([dOnly], Q({ tfs: ['W'] }), 'US').provisional.map((h) => h.row.t), ['DONLY'], 'nobody scanned weekly yet → provisional');
  assert.equal(run.strict[0].best?.tf, 'W');
  // ALL mode with a scanned timeframe that fails → fail
  const wNo = row('WNO', [T('cup', 'f', 70, -3)], { scanW: { st: 'no-pattern', v: 5 } } as any);
  assert.equal(evalRowPatterns(wNo, Q({ tfs: ['D', 'W'], tfMode: 'all' })).status, 'fail');
  // chip counts follow the timeframe choice
  assert.equal(patternCounts([both, dOnly], Q({ tfs: ['W'] }), 'US').flat_base, 1);
  assert.equal(patternCounts([both, dOnly], Q({ tfs: ['W'] }), 'US').cup, 0);
  // saved queries: tfs cleaned, default D
  assert.deepEqual(cleanQuery({ tfs: ['M', 'x', 'M'] }).tfs, ['M']);
  assert.deepEqual(cleanQuery({ tfs: [] }).tfs, ['D']);
  assert.equal(cleanQuery({ tfMode: 'all' }).tfMode, 'all');
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, /&tf=\$\{tf\}&review=screener/, 'the chart link passes the analysis timeframe');
  assert.match(ui, /not scanned yet/);
});

// ───────── the pages (JSDOM) ─────────
async function withDom<T>(url: string, fn: (h: { React: any; act: any; root: any; settle: () => Promise<void>; text: () => string; click: (pred: (b: HTMLButtonElement) => boolean) => Promise<void>; clip: string[]; blobs: string[] }) => Promise<T>) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url, pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'Blob'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  const clip: string[] = [], blobs: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t: string) => { clip.push(t); } }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'Blob', { value: class { constructor(parts: string[]) { blobs.push(parts.join('')); } }, configurable: true, writable: true });
  (dom.window as any).URL.createObjectURL = () => 'blob:x'; (dom.window as any).URL.revokeObjectURL = () => {};
  const oldCreate = (URL as any).createObjectURL, oldRevoke = (URL as any).revokeObjectURL;
  (URL as any).createObjectURL = () => 'blob:x'; (URL as any).revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  // react-dom decides at load time whether a DOM exists (input events need it): import it after the globals are in place
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 25));
  const text = () => document.body.textContent || '';
  const click = async (pred: (b: HTMLButtonElement) => boolean) => {
    const b = Array.from(document.querySelectorAll('button')).find(pred);
    assert.ok(b, 'button');
    await act(async () => { b!.click(); await settle(); });
  };
  try { return await fn({ React, act, root, settle, text, click, clip, blobs }); } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 3100));   // let the pages' 2.5–2.8 s status-message timers run while the DOM still exists
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    (URL as any).createObjectURL = oldCreate; (URL as any).revokeObjectURL = oldRevoke;
    dom.window.close();
  }
}
const setInput = async (act: any, el: HTMLInputElement, v: string, settle: () => Promise<void>) => {
  const proto = Object.getPrototypeOf(el);
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); await settle(); });
};

test('zzz994 Pine page (JSDOM): counts kept apart, search-scoped copy, explicit all-matches scope, no-stage prompt, scan close, shape-score CSV', async () => {
  const PROWS = [
    row('CUP', [T('cup_handle', 'f', 80, -4)], { scan: { st: 'ready', v: 5 }, scanPx: 48.2, scanAt: '2026-10-12', scanSrc: 'yahoo', pxSrc: 'nasdaq', pxGap: 3.73, pxConflict: 1 } as any),
    row('FLAG', [T('bull_flag', 'b', 70, 2)], { scan: { st: 'ready', v: 5 } } as any),
    row('UBASE', [T('u_base', 'f', 60, -8)], { scan: { st: 'ready', v: 5 } } as any),
  ];
  await withDom('http://localhost/pine-screener', async ({ React, act, root, settle, text, click, clip, blobs }) => {
    (globalThis as any).fetch = async (url: string) => ({ ok: true, json: async () => (url.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-12T23:00:00Z', ...leanRows(PROWS), notes: [] } : { ok: true }) });
    localStorage.setItem('mc:pine-details:v1', '1');   // zzz1033 — counts / scope lines sit behind "ⓘ Details" (hidden by default)
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); });
    assert.match(text(), /3 companies match/);
    assert.match(text(), /3 shown · 3 filter matches/);
    assert.ok(Array.from(document.querySelectorAll('th')).some((th) => /Shape score/.test(th.textContent || '')));
    assert.ok(!Array.from(document.querySelectorAll('th')).some((th) => /Likelihood/.test(th.textContent || '')));
    // zzz1008: the column shows the pattern's ANALYSIS close (its own timeframe), named so
    assert.ok(Array.from(document.querySelectorAll('th')).some((th) => /Analysis close/.test(th.textContent || '')), 'analysis close shown where it differs from the quote');
    assert.ok(document.querySelector('[aria-label="Price sources disagree"]'));
    assert.ok(document.querySelector('[aria-label="daily timeframe"]'), 'timeframe on every chip');
    // search: one row shown; Copy acts on it, "all matches" only when chosen
    await setInput(act, document.querySelector('input[aria-label="Find in results"]') as HTMLInputElement, 'flag', settle);
    assert.match(text(), /1 shown · 1 search match · 3 filter matches/);
    await click((b) => b.textContent === 'Copy for TradingView');
    assert.equal(clip.at(-1), 'FLAG');
    const scopeSel = document.querySelector('select[aria-label="Action scope"]') as HTMLSelectElement;
    await act(async () => { scopeSel.value = 'all'; scopeSel.dispatchEvent(new (window as any).Event('change', { bubbles: true })); await settle(); });
    await click((b) => b.textContent === 'Copy for TradingView');
    assert.equal(clip.at(-1)!.split(',').sort().join(','), 'CUP,FLAG,UBASE');
    // a search with no match: its own message + Clear search
    await setInput(act, document.querySelector('input[aria-label="Find in results"]') as HTMLInputElement, 'zzzz', settle);
    assert.match(text(), /No match contains “zzzz” — 3 companies pass the screen/);
    await click((b) => b.textContent === 'Clear search');
    assert.match(text(), /3 shown · 3 filter matches/);
    // CSV: Shape score (0–100), never "Likelihood (%)"
    await click((b) => b.textContent === 'Download CSV');
    const csv = blobs.at(-1)!;
    assert.match(csv, /Shape score \(0–100\)/);
    assert.match(csv, /Volume confirmed/);
    assert.match(csv, /Daily technical close \(USD\)/);   // zzz1004 (PS-02): analysis close and daily technical close kept apart
    assert.match(csv, /Analysis close \(USD\)/);
    assert.doesNotMatch(csv, /Likelihood/);
    // zzz1008 (item 1a): unpress Forming, then Breakout — the LAST stage cannot be switched off (it used to leave "No stage" and 0
    // matches everywhere); the screen keeps Breakout and says why. An empty stage list (a saved query) still shows the prompt.
    await click((b) => b.textContent === 'Forming');
    await click((b) => b.textContent === 'Breakout');
    assert.doesNotMatch(document.querySelector('[data-testid="active-query"]')!.textContent!, /No stage/);
    assert.match(text(), /At least one stage stays selected/);
    assert.match(text(), /1 companies match/);
    await click((b) => b.textContent === 'All stages');
    assert.match(text(), /3 companies match/);
    // weekly timeframe: not scanned yet → said so, nothing silently relabelled
    await click((b) => b.getAttribute('aria-label') === 'weekly patterns');
    assert.match(text(), /Weekly patterns: not scanned yet/);
  });
});

test('zzz994 Stock page (JSDOM): one searched row → one copied ticker; all matches only when chosen; no-search-match state; pattern filter offered', async () => {
  await withDom('http://localhost/stock-screener', async ({ React, act, root, settle, text, click, clip }) => {
    localStorage.setItem('mc:stock-screens:v1', JSON.stringify([{ id: 'audit', name: 'Audit', market: 'IN', filters: [] }]));
    localStorage.setItem('mc:stock-screener:last:v1', 'audit');
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ ok: true, builtAt: '2026-10-12T12:00:00Z', rows: [
      { t: 'DEEDEV', n: 'DEE Development', px: 312.456, mc: 2150, exch: ['NSE'] }, { t: 'TCS', n: 'Tata Consultancy', px: 3050.1, mc: 1_100_000, exch: ['NSE'] },
    ], notes: [], sources: [] }) });
    const { default: Screener } = await import('../../components/stock-screener/StockScreener');
    await act(async () => { root.render(React.createElement(Screener)); await settle(); });
    assert.match(text(), /2 of 2 companies match/);
    assert.match(text(), /₹312\.46/, 'price at 2 decimals');
    assert.match(text(), /₹11,00,000 Cr/, 'India market cap with Indian grouping');
    await setInput(act, document.querySelector('input[aria-label="Find in results"]') as HTMLInputElement, 'DEE Development', settle);
    assert.match(text(), /1 shown · 1 search match · 2 filter matches/);
    const actions = () => click((b) => b.textContent!.startsWith('Actions'));   // zzz1006: Copy / CSV live in the Actions menu
    await actions(); await click((b) => b.textContent === 'Copy tickers');
    assert.equal(clip.at(-1), 'NSE:DEEDEV');
    const scopeSel = document.querySelector('select[aria-label="Action scope"]') as HTMLSelectElement;
    await act(async () => { scopeSel.value = 'all'; scopeSel.dispatchEvent(new (window as any).Event('change', { bubbles: true })); await settle(); });
    await actions(); await click((b) => b.textContent === 'Copy tickers');
    assert.equal(clip.at(-1), 'NSE:TCS,NSE:DEEDEV');
    await setInput(act, document.querySelector('input[aria-label="Find in results"]') as HTMLInputElement, 'nothing-like-this', settle);
    assert.match(text(), /No filter match contains “nothing-like-this”/);
    assert.ok(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Clear search'));
    await click((b) => b.getAttribute('aria-label') === 'Add a filter');
    assert.ok(document.querySelector('[role="dialog"][aria-label="Add a filter"] [data-filter-key="pattern"]'), 'the chart-pattern rule is offered');
  });
});
