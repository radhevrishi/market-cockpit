// zzz1032 — PINE SCREENER: the latest earnings result per company (Earnings Opportunities graded days + Conviction Beats).
//   · index: newest filing wins (same filing → the later grading), 'Upcoming' / no grade / future dates ignored, the 🏆 mark for a
//     bench name, a result filed under a BSE code matched to the NSE company by a unique name, US tickers;
//   · column text, sorting by date and by grade, the three result rules (days / grade / Conviction Beats) and their provisional
//     state while the results are not loaded, CSV cells; the page shows the column by default and filters on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLatestResultIndex, withBrowserBench, attachLatestResults, resultFromRow, resultText, resultLines, passesResult, resultRuleText,
  resultSortDate, resultSortTier, resultCsvCells, RESULT_CSV_HEAD, daysSince, nameKey, resultKey, mergeResult, type LatestResultIndex,
} from '../screener/latest-result';
import { scanDates, slimDay } from '../screener/latest-result-server';
import { runPineFull, cleanQuery, leanRows, PATTERN_SCAN_VERSION, DEFAULT_QUERY, type PineQuery, type ScreenPatternTag } from '../screener/pine';
import { querySummary } from '../screener/pine-view';
import { PATTERN_META } from '../chart-patterns';
import type { ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const TODAY = '2026-10-15';
const card = (ticker: string, tier: string, filing_date: string, extra: Record<string, unknown> = {}) => ({
  ticker, tier, filing_date, company: `${ticker} Ltd`, quarter: 'Q2 FY27', sales_yoy_pct: 24.04, net_profit_yoy_pct: 41.26, eps_yoy_pct: 38.9, composite_score: 81.6, ...extra,
});
const day = (date: string, rows: any[]) => ({ date, payload: { by_tier: { BLOCKBUSTER: rows.filter((r) => r.tier === 'BLOCKBUSTER'), STRONG: rows.filter((r) => r.tier === 'STRONG'), MIXED: rows.filter((r) => r.tier === 'MIXED'), AVOID: rows.filter((r) => r.tier === 'AVOID') } } });

test('zzz1032 index: the newest filing wins; the same filing graded later wins; Upcoming / no grade / future dates are not results', () => {
  const { index } = buildLatestResultIndex({
    today: TODAY,
    days: [
      day('2026-10-14', [card('AAA', 'MIXED', '2026-10-14'), card('BBB', 'STRONG', '2026-10-13'), card('FUT', 'STRONG', '2026-10-20'), card('UPC', 'STRONG', '2026-10-14', { quality: 'Upcoming' })]),
      day('2026-08-10', [card('AAA', 'BLOCKBUSTER', '2026-08-10'), card('BBB', 'MIXED', '2026-10-13'), card('NOG', 'PENDING', '2026-08-10')]),
    ],
  });
  assert.equal(index.AAA.d, '2026-10-14'); assert.equal(index.AAA.g, 'MIXED', 'the newer filing wins over a stronger older one');
  assert.equal(index.BBB.g, 'STRONG', 'same filing date: the later grading (14 Oct) wins');
  assert.equal(index.BBB.gd, '2026-10-14');
  assert.equal(index.FUT, undefined, 'a filing date after today is not a result');
  assert.equal(index.UPC, undefined, 'a board meeting (quality Upcoming) is not a filing');
  assert.equal(index.NOG, undefined, 'a row without a known grade is not a result');
  assert.deepEqual({ s: index.AAA.s, p: index.AAA.p, e: index.AAA.e, sc: index.AAA.sc, q: index.AAA.q, src: index.AAA.src }, { s: 24.04, p: 41.26, e: 38.9, sc: 82, q: 'Q2 FY27', src: 'EO' });
  // a missing figure stays blank (never 0)
  const r = resultFromRow(card('X', 'STRONG', '2026-10-01', { sales_yoy_pct: null, net_profit_yoy_pct: undefined }), '2026-10-01', 'EO', TODAY)!;
  assert.equal('s' in r, false); assert.equal('p' in r, false); assert.equal(r.e, 38.9);
});

test('zzz1032 index: Conviction Beats bench — 🏆 mark, combined source on the same filing, a newer bench filing wins, a bench name beyond the scan', () => {
  const { index } = buildLatestResultIndex({
    today: TODAY,
    days: [day('2026-10-10', [card('CBX', 'STRONG', '2026-10-10'), card('EOY', 'MIXED', '2026-10-01'), card('OLD', 'STRONG', '2026-08-01')])],
    bench: [card('CBX', 'STRONG', '2026-10-10'), card('EOY', 'STRONG', '2026-07-15'), card('OLD', 'BLOCKBUSTER', '2026-09-20'), card('FAR', 'STRONG', '2026-06-02'), { ticker: 'NOD', tier: 'STRONG' }],
  });
  assert.equal(index.CBX.src, 'EO+CB'); assert.equal(index.CBX.cb, 1);
  assert.equal(index.EOY.src, 'EO', 'the graded day is newer than the bench entry'); assert.equal(index.EOY.cb, 1, 'still on the bench: 🏆');
  assert.equal(index.EOY.g, 'MIXED');
  assert.equal(index.OLD.src, 'CB'); assert.equal(index.OLD.g, 'BLOCKBUSTER', 'the bench holds the newer filing');
  assert.equal(index.FAR.d, '2026-06-02'); assert.equal(index.FAR.src, 'CB');
  assert.deepEqual(index.NOD, { d: '', src: 'CB', cb: 1 }, 'on the bench without a dated result: the mark only, no invented figures');
  assert.match(resultText(index.NOD, 'IN', TODAY), /result not on file/);
});

test('zzz1032 India: a result filed under a BSE code is matched to the NSE company by a unique name; an ambiguous name is not', () => {
  const universe = [{ t: 'DJML', n: 'DJ Mediaprint & Logistics Limited' }, { t: 'ABC', n: 'Twin Co Ltd' }, { t: 'ABD', n: 'Twin Co Limited' }, { t: '360ONE', n: '360 ONE WAM Ltd' }];
  const { index, byName } = buildLatestResultIndex({
    today: TODAY, universe,
    days: [day('2026-10-14', [
      { ...card('543193', 'STRONG', '2026-10-14'), company: 'DJ Mediaprint &amp; Logistics Ltd' },
      { ...card('TWINB', 'STRONG', '2026-10-14'), company: 'Twin Co Ltd' },
      card('360ONE', 'MIXED', '2026-10-14'),
      { ...card('SULABEN', 'STRONG', '2026-10-14'), company: 'Sulabh Engineers & Services Ltd' },
    ])],
  });
  assert.equal(index.DJML?.g, 'STRONG'); assert.equal(byName, 1);
  assert.equal(index['543193'], undefined, 'only universe tickers are keyed');
  assert.equal(index.ABC, undefined); assert.equal(index.ABD, undefined, 'two companies share the name: no match');
  assert.equal(index['360ONE']?.g, 'MIXED', 'digit-leading NSE symbols keep working');
  assert.equal(index.SULABEN, undefined, 'a BSE-only company outside the screener list is left out');
  assert.equal(nameKey('DJ Mediaprint &amp; Logistics Ltd'), nameKey('DJ Mediaprint & Logistics Limited'));
  const us = buildLatestResultIndex({ today: TODAY, universe: [{ t: 'SAR', n: 'Saratoga Investment Corp' }], byNameMatch: false, days: [day('2026-10-14', [{ ...card('SAZ', 'MIXED', '2026-10-14'), company: 'Saratoga Investment Corp.' }])] });
  assert.equal(us.index.SAR, undefined, 'US: no name match (a note line of the same issuer is not the common stock)');
  assert.equal(resultKey('NSE:MTAR@Q3-2026'), 'MTAR'); assert.equal(resultKey('tcs.ns'), 'TCS');
});

test('zzz1032 US: graded-us rows (net income) and the browser bench; text, lines, days since', () => {
  const { index } = buildLatestResultIndex({ today: TODAY, days: [day('2026-10-14', [card('FAST', 'MIXED', '2026-10-14', { quarter: 'Q3 FY26', sales_yoy_pct: 15.47, net_profit_yoy_pct: 19.7 })])] });
  const merged = withBrowserBench(index, [{ ticker: 'FAST@Q3', tier: 'STRONG', filing_date: '2026-07-14', quarter: 'Q2 FY26' }, { ticker: 'NVDA', tier: 'BLOCKBUSTER', filing_date: '2026-08-27', quarter: 'Q2', fiscal_year: 2027, sales_yoy_pct: 56 }, { ticker: 'ZZZ', tier: 'STRONG', filing_date: '2026-08-01' }], TODAY, new Set(['FAST', 'NVDA']));
  assert.equal(merged.FAST.g, 'MIXED'); assert.equal(merged.FAST.cb, 1, 'on this browser\'s bench (older quarter): 🏆 on the newer result');
  assert.equal(merged.NVDA.q, 'Q2 FY27', 'a browser entry keeps Q2 + fiscal year'); assert.equal(merged.NVDA.src, 'CB');
  assert.equal(merged.ZZZ, undefined, 'not in the screener list');
  assert.equal(resultText(merged.FAST, 'US', TODAY), '🏆 Q3 FY26 · 14 Oct · MIXED · Sales +15% · Net income +20%');
  assert.equal(resultText(index.FAST, 'US', TODAY), 'Q3 FY26 · 14 Oct · MIXED · Sales +15% · Net income +20%');
  assert.equal(resultText({ d: '2025-12-30', g: 'STRONG', src: 'EO', p: 140.2 }, 'IN', TODAY), '30 Dec 2025 · STRONG · PAT +140%');
  assert.equal(resultText(undefined, 'IN', TODAY), '');
  const lines = resultLines(merged.FAST, 'US', TODAY).join('\n');
  assert.match(lines, /Result filed 14 Oct 2026 \(1 day ago\) — Q3 FY26/);
  assert.match(lines, /Grade: MIXED \(composite 82\)/);
  assert.match(lines, /Source: Earnings Opportunities · on the Conviction Beats bench/);
  assert.match(resultLines(undefined, 'IN', TODAY)[0], /No graded result on file/);
  assert.equal(daysSince('2026-10-12', TODAY), 3); assert.equal(daysSince(undefined, TODAY), null);
  assert.deepEqual(scanDates('2026-10-15', 3), ['2026-10-15', '2026-10-14', '2026-10-13']);
  // a cached day keeps only what the index reads (the grade cards are large)
  const slim = slimDay({ by_tier: { STRONG: [{ ...card('Q', 'STRONG', '2026-10-01'), grade_input: { big: 1 }, narrative: 'x' }] }, generated_at: 'x' });
  assert.deepEqual(Object.keys(slim), ['by_tier']);
  assert.equal('grade_input' in slim.by_tier.STRONG[0], false);
  assert.deepEqual(buildLatestResultIndex({ today: TODAY, days: [{ date: '2026-10-01', payload: slim }] }).index.Q.g, 'STRONG');
  assert.deepEqual(scanDates('2026-10-12', 3, true), ['2026-10-12'], 'weekends skipped for US sessions');
});

test('zzz1032 sorting values, rules, words, CSV', () => {
  const A = { d: '2026-10-12', g: 'MIXED' as const, src: 'EO' as const };
  const B = { d: '2026-09-01', g: 'BLOCKBUSTER' as const, src: 'CB' as const, cb: 1 as const };
  assert.ok(resultSortDate(A)! > resultSortDate(B)!);
  assert.ok(resultSortTier(B)! > resultSortTier(A)!);
  assert.equal(resultSortDate(undefined), null); assert.equal(resultSortTier({ d: '', src: 'CB', cb: 1 }), null);
  assert.equal(passesResult(A, { resDays: 7 }, TODAY), true);
  assert.equal(passesResult(B, { resDays: 30 }, TODAY), false);
  assert.equal(passesResult(A, { resTier: 'STRONG' }, TODAY), false);
  assert.equal(passesResult(B, { resTier: 'BLOCKBUSTER' }, TODAY), true);
  assert.equal(passesResult(A, { resCb: true }, TODAY), false); assert.equal(passesResult(B, { resCb: true }, TODAY), true);
  assert.equal(passesResult(undefined, { resDays: 90 }, TODAY), false, 'no result on file does not pass');
  assert.equal(passesResult(undefined, {}, TODAY), true, 'no rule: everything passes');
  assert.equal(resultRuleText({ resDays: 30, resTier: 'STRONG', resCb: true }), 'Result in last 30 days · Grade ≥ STRONG · Conviction Beats only');
  assert.equal(RESULT_CSV_HEAD.length, resultCsvCells(B, TODAY).length);
  assert.deepEqual(resultCsvCells(B, TODAY), ['2026-09-01', '', 'BLOCKBUSTER', 44, '', '', '', 'Conviction Beats bench', 'yes']);
  assert.deepEqual(resultCsvCells(undefined, TODAY), ['', '', '', '', '', '', '', '', '']);
  // merging the same filing from the bench after the graded day keeps the graded figures
  const ix: LatestResultIndex = {};
  mergeResult(ix, 'K', { d: '2026-10-01', g: 'STRONG', src: 'EO', s: 30, gd: '2026-10-01' });
  mergeResult(ix, 'K', { d: '2026-10-01', g: 'STRONG', src: 'CB', cb: 1 });
  assert.deepEqual(ix.K, { d: '2026-10-01', g: 'STRONG', src: 'EO+CB', s: 30, gd: '2026-10-01', cb: 1 });
});

// ── the query: cleanQuery, runPineFull, summary ──────────────────────────────────────────────────────────────────────────
const tag = (c = 70): ScreenPatternTag => ({ id: 'flat_base', b: 'U', s: 'f', c, p: 100, d: -2 });
const cur = (tf: 'D' | 'W' | 'M') => ({ st: 'ready', v: PATTERN_SCAN_VERSION, px: 100, asOf: '2026-10-14', ...(tf !== 'D' ? { tf } : {}) });
const prow = (t: string, extra: Record<string, unknown> = {}) => ({ t, n: `${t} Ltd`, px: 100, patAt: '2026-10-14', pat: [tag()], patW: [], patM: [], scan: cur('D'), scanW: cur('W'), scanM: cur('M'), scanPx: 100, scanAt: '2026-10-14', ...extra }) as unknown as ScreenRow;
const NOW = new Date('2026-10-15T06:00:00Z');

test('zzz1032 query: result rules saved, combined AND-style, provisional while no result is loaded; named in the summary', () => {
  const q = cleanQuery({ ...DEFAULT_QUERY, resDays: 30, resTier: 'STRONG', resCb: true });
  assert.equal(q.resDays, 30); assert.equal(q.resTier, 'STRONG'); assert.equal(q.resCb, true);
  const off = cleanQuery({ ...DEFAULT_QUERY, resDays: 'x', resTier: 'GOOD', resCb: 1 });
  assert.equal('resDays' in off, false); assert.equal('resTier' in off, false); assert.equal('resCb' in off, false);
  const base = [prow('A'), prow('B'), prow('C')];
  const idx: LatestResultIndex = { A: { d: '2026-10-10', g: 'STRONG', src: 'EO' }, B: { d: '2026-07-01', g: 'BLOCKBUSTER', src: 'CB', cb: 1 } };
  const rows = attachLatestResults(base, idx) as unknown as ScreenRow[];
  const Q = (x: Partial<PineQuery>) => ({ ...DEFAULT_QUERY, ...x }) as PineQuery;
  const names = (r: ReturnType<typeof runPineFull>) => r.strict.map((h) => h.row.t);
  assert.deepEqual(names(runPineFull(rows, Q({}), 'IN', NOW)), ['A', 'B', 'C']);
  assert.deepEqual(names(runPineFull(rows, Q({ resDays: 30 }), 'IN', NOW)), ['A']);
  assert.deepEqual(names(runPineFull(rows, Q({ resTier: 'STRONG' }), 'IN', NOW)), ['A', 'B']);
  assert.deepEqual(names(runPineFull(rows, Q({ resTier: 'BLOCKBUSTER' }), 'IN', NOW)), ['B']);
  assert.deepEqual(names(runPineFull(rows, Q({ resCb: true }), 'IN', NOW)), ['B']);
  assert.deepEqual(names(runPineFull(rows, Q({ resCb: true, resDays: 30 }), 'IN', NOW)), []);
  // results not loaded (no row carries one): provisional, never a silent "0 matches"
  const pend = runPineFull(base, Q({ resDays: 30 }), 'IN', NOW);
  assert.equal(pend.strict.length, 0); assert.equal(pend.provisional.length, 3);
  assert.match(pend.provisional[0].missing!.join(), /latest result \(Result in last 30 days\) — results not loaded yet/);
  assert.match(querySummary(Q({ resDays: 30, resTier: 'STRONG' }), ''), /Result in last 30 days · Grade ≥ STRONG/);
  assert.doesNotMatch(querySummary(Q({}), ''), /Result in last/);
  // lean rows (the list payload) never carry the result (it is a separate request)
  assert.equal('lr' in (leanRows(rows).rows[0] as any), false);
});

test('zzz1032 sources: the route serves ?results=1 from the cached builder; the page fetches it once, shows the column by default, exports it; plain words', () => {
  const route = read('app/api/v1/pine-screener/route.ts');
  assert.match(route, /sp\.get\('results'\) === '1'/);
  assert.match(route, /getResultPayload\(market, universe\)/);
  const srv = read('lib/screener/latest-result-server.ts');
  assert.match(srv, /RESULT_TTL_MS = 30 \* 60_000/);
  assert.match(srv, /gradedKeyCandidates/); assert.match(srv, /us-engine-version/); assert.match(srv, /bench:server:v1/); assert.match(srv, /bench:us:server:v1/);
  const page = read('components/pine-screener/PineScreener.tsx');
  assert.match(page, /results=1/);
  assert.match(page, /getItem\(RES_COL_KEY\) !== '0'/, 'on by default');
  assert.match(page, /\.\.\.RESULT_CSV_HEAD/); assert.match(page, /resultCsvCells\(/);
  assert.match(page, /k="resD"/); assert.match(page, /k="resG"/);
  for (const f of ['components/pine-screener/LatestResult.tsx', 'lib/screener/latest-result.ts']) {
    const s = read(f);
    assert.doesNotMatch(s, /\b(BUY|SELL|Buy|Sell)\b/, f);
    assert.doesNotMatch(s, /\bbest\b/i, f);
    assert.doesNotMatch(s, /\/100\b/, f);
    assert.doesNotMatch(s, /fetch\(/, `${f}: no per-row fetch`);
  }
});

// ── the page (JSDOM) ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz1032 page (JSDOM): the Latest result column with chip and figures, sort by date / grade, the result rules filter the list', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/pine-screener?market=IN', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  (dom.window as any).confirm = () => true;
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.localStorage.setItem('mc:pine-screener:last:v1', JSON.stringify({ id: 'x', market: 'IN', q: { ...DEFAULT_QUERY, need: 'any' }, dirty: true }));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const ago = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const ROWS = [prow('AAA'), prow('BBB'), prow('CCC')];
  const results: LatestResultIndex = {
    AAA: { d: ago(3), q: 'Q2 FY27', g: 'MIXED', s: 12, p: -8, src: 'EO' },
    BBB: { d: ago(40), q: 'Q1 FY27', g: 'BLOCKBUSTER', s: 55, p: 120, src: 'EO+CB', cb: 1 },
  };
  (globalThis as any).fetch = async (u: string) => ({
    ok: true, status: 200,
    json: async () => (u.includes('results=1') ? { ok: true, market: 'IN', results, count: 2, days: 100, graded: 70 }
      : u.includes('detail=') ? { ok: true, geometry: { D: [], W: [], M: [], L: [] } }
      : u.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-14T12:00:00Z', ...leanRows(ROWS), notes: [] }
      : { ok: true }),
  });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  const click = async (el: Element | null | undefined) => { assert.ok(el, 'element'); await act(async () => { (el as HTMLElement).click(); await settle(); }); };
  const select = async (label: string, v: string) => {
    const el = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    assert.ok(el, label);
    await act(async () => { Object.getOwnPropertyDescriptor((dom.window as any).HTMLSelectElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new (dom.window as any).Event('change', { bubbles: true })); await settle(); });
  };
  const listed = () => Array.from(document.querySelectorAll('tbody tr a[data-ticker]')).map((a) => a.textContent);
  try {
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); await settle(); });
    assert.ok(document.querySelector('th[data-col="result"]'), 'column on by default');
    const cellOf = (t: string) => document.querySelector(`a[data-ticker="${t}"]`)!.closest('tr')!.querySelector('td[data-col="result"]')!;
    assert.match(cellOf('AAA').textContent!, /Q2 FY27 · .*3d.*MIXED.*Sales\s*\+12%.*PAT\s*-8%/);
    assert.ok(cellOf('BBB').querySelector('[data-tier="BLOCKBUSTER"]'));
    assert.match(cellOf('BBB').textContent!, /🏆/);
    assert.equal(cellOf('CCC').textContent, '—', 'no result: blank, never invented');
    assert.match((cellOf('CCC') as HTMLElement).title, /No graded result on file/);
    // sort by date (newest first) and by grade
    await click(document.querySelector('th[data-col="result"] button[aria-label="Sort by Latest result"]'));
    assert.deepEqual(listed(), ['AAA', 'BBB', 'CCC'], 'newest result first, no result last');
    await click(document.querySelector('th[data-col="result"] button[aria-label="Sort by grade"]'));
    assert.deepEqual(listed(), ['BBB', 'AAA', 'CCC']);
    // the rules
    await click(Array.from(document.querySelectorAll('button.pnx-sum')).find((b) => /Latest result/.test(b.textContent || '')));
    await select('Result filed in the last', '30');
    assert.deepEqual(listed(), ['AAA']);
    await select('Result filed in the last', '');
    await select('Result grade at least', 'STRONG');
    assert.deepEqual(listed(), ['BBB']);
    await select('Result grade at least', '');
    await click(document.querySelector('input[aria-label="Conviction Beats only"]'));
    assert.deepEqual(listed(), ['BBB']);
    assert.match(document.querySelector('[data-testid="result-source"]')!.textContent!, /2 companies with a graded result/);
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 300));
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
});
void PATTERN_META;
