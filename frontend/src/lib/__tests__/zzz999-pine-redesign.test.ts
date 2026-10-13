// zzz999 — Pine Screener redesign: setup cards and their counts, the "My portfolio" company list and chart check (every holding, with
// or without a pattern), distance to the 21 / 50 / 200-day averages from the SCAN close, plain verdict words, fundamental-only
// presets moved to the Stock Screener with stable ids, and a Stock Screener screen (or a hand-off) as the Pine company list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN_META, type PatternId } from '../chart-patterns';
import { runPineFull, cleanQuery, cleanPineScreens, onList, type ScreenPatternTag } from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { BUILT_IN_SCREENS, cleanScreens } from '../screener/filters';
import {
  SETUP_CARDS, cardQuery, setupCounts, scopeKind, stockScreenTickers, maPosition, maVerdict, portfolioCheck, invalidation, patternChecks,
} from '../screener/pine-view';
import { cleanHandoff, makeHandoff, normTicker } from '../screener/pine-handoff';
import type { ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const T = (id: PatternId, s: 'f' | 'b' | 'x', c: number, d: number | null, extra: Partial<ScreenPatternTag> = {}): ScreenPatternTag =>
  ({ id, b: PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s, c, p: 100, d, ...extra });
const row = (t: string, o: Partial<ScreenRow> = {}): ScreenRow =>
  ({ t, n: `${t} Ltd`, px: 100, mc: 1000, avgVol30: 300_000, tvSec: 'Electronic Technology', scan: { st: 'no-pattern', v: 5 }, patAt: '2026-10-12', ...o } as ScreenRow);
const ready = { st: 'ready', v: 5 } as any;

const ROWS: ScreenRow[] = [
  row('BRK', { pat: [T('flat_base', 'b', 72, 2)], scan: ready, sma200: 80 }),                 // breakout today
  row('NEAR', { pat: [T('cup_handle', 'f', 70, -3)], scan: ready, sma200: 80 }),              // ready to break out (and a base)
  row('BASE', { pat: [T('vcp', 'f', 66, -12)], scan: ready, sma200: 80 }),                    // base forming, not near
  row('DOWN', { pat: [T('double_top', 'b', 70, -4)], scan: ready, px: 50, sma200: 70 }),       // bearish breakdown (d < 0 = below the level)
  row('WEEK', { patW: [T('cup', 'f', 68, -6, { tf: 'W', l: 14, lu: 'w' })], scanW: { st: 'ready', v: 5, px: 99, asOf: '2026-10-10' } } as any),
  row('NONE'),
];

test('zzz999 setup cards: each opens a built-in screen and counts its strict matches; the portfolio card counts every holding', () => {
  assert.deepEqual(SETUP_CARDS.map((c) => c.id), ['breakouts', 'ready', 'bases', 'breakdowns', 'weekly', 'monthly', 'portfolio']);   // zzz1004: + Monthly bases
  for (const c of SETUP_CARDS) if (c.presetId) assert.ok(BUILT_IN_PINE_SCREENS.some((s) => s.id === c.presetId), c.presetId);
  const n = setupCounts(ROWS, 'US', null, ['NONE', 'BRK', 'GONE']);
  for (const c of SETUP_CARDS) if (c.presetId) assert.equal(n[c.id], runPineFull(ROWS, cardQuery(c)!, 'US').strict.length, c.id);
  assert.equal(n.breakouts, 1);
  assert.equal(n.ready, 1);
  assert.equal(n.bases, 2, 'cup with handle and the VCP are still forming');
  assert.equal(n.breakdowns, 1);
  assert.equal(n.weekly, 1, 'weekly bases read the weekly tags only');
  assert.equal(n.portfolio, 3, 'every holding, also one without a pattern or not in the data');
  assert.equal(setupCounts(ROWS, 'US', null, null).portfolio, null, 'unknown while the holdings load');
  // within a company list the cards count only that list
  assert.equal(setupCounts(ROWS, 'US', new Set(['NEAR']), []).bases, 1);
});

test('zzz999 distance to the 21 / 50 / 200-day averages uses the scan close (the same daily bars as the averages)', () => {
  const r = row('MA', { px: 120, scanPx: 110, scanAt: '2026-10-12', sma21: 100, sma50: 110, sma200: 125 } as any);
  const ma = maPosition(r);
  assert.equal(ma.basis, 'scan'); assert.equal(ma.close, 110); assert.equal(ma.at, '2026-10-12');
  assert.equal(ma.d21, 10); assert.equal(ma.d50, 0); assert.equal(ma.d200, -12);
  // no scan close (older data): the quote, labelled as such
  const old = maPosition(row('OLD', { px: 90, sma50: 100 } as any));
  assert.equal(old.basis, 'quote'); assert.equal(old.d50, -10); assert.equal(old.d200, null);
  // verdicts from the numbers only, never buy / sell words
  assert.equal(maVerdict(maPosition(row('A', { scanPx: 130, sma21: 120, sma50: 110, sma200: 100 } as any))).word, 'Above all MAs');
  assert.equal(maVerdict(maPosition(row('B', { scanPx: 90, sma21: 100, sma50: 110, sma200: 120 } as any))).word, 'Below all MAs');
  assert.equal(maVerdict(maPosition(row('C', { scanPx: 115, sma21: 110, sma50: 112, sma200: 120 } as any))).word, 'Below 200-day');
  assert.equal(maVerdict(maPosition(row('D', { scanPx: 105, sma21: 108, sma50: 110, sma200: 100 } as any))).word, 'Below 50-day');
  assert.equal(maVerdict(maPosition(row('E', { scanPx: 105, sma21: 108, sma50: 100, sma200: 90 } as any))).word, 'Below 21-day');
  assert.equal(maVerdict(maPosition(row('F', { scanPx: 105, sma21: 100, sma50: 100, sma200: 90 } as any)), [T('double_top', 'b', 70, -4)]).word, 'Breaking down · still above 200-day');   // zzz1002
  assert.equal(maVerdict(maPosition(row('G', { scanPx: 105, sma21: 100, sma50: 100, sma200: 120 } as any)), [T('flat_base', 'b', 70, 2)]).word, 'Breaking out · below 200-day');   // zzz1002
  for (const v of ['Above all MAs', 'Below all MAs', 'Below 200-day', 'Breaking down']) assert.doesNotMatch(v, /\b(buy|sell)\b/i);
});

test('zzz999 portfolio check: every holding is listed — with patterns on D / W / M, without any, or not in the data', () => {
  const rows = [
    row('HAS', { pat: [T('cup', 'f', 70, -3)], scan: ready, patW: [T('flat_base', 'f', 60, -2, { tf: 'W' })], scanW: { st: 'ready', v: 5 }, scanPx: 100, sma21: 95, sma50: 90, sma200: 80 } as any),
    row('BARE', { scanPx: 100, sma21: 105, sma50: 110, sma200: 120 } as any),
    row('TOP', { pat: [T('double_top', 'b', 72, -3)], scan: ready, scanPx: 100, sma21: 99, sma50: 98, sma200: 90 } as any),
  ];
  const out = portfolioCheck(rows, ['has', 'NSE:BARE', 'TOP.NS', 'MISSING', 'HAS']);
  assert.deepEqual(out.map((x) => x.ticker).sort(), ['BARE', 'HAS', 'MISSING', 'TOP'], 'normalised, de-duplicated, none dropped');
  const by = new Map(out.map((x) => [x.ticker, x]));
  assert.equal(by.get('HAS')!.patterns.find((p) => p.tf === 'W')!.tags!.length, 1, 'weekly patterns too');
  assert.equal(by.get('HAS')!.verdict.word, 'Above all MAs');
  assert.deepEqual(by.get('BARE')!.patterns.map((p) => p.tags?.length ?? null), [0, null, null], 'no daily pattern; weekly / monthly not scanned');
  assert.equal(by.get('BARE')!.verdict.word, 'Below all MAs');
  assert.equal(by.get('TOP')!.verdict.word.startsWith('Breaking down'), true);   // zzz1002: '· still above 200-day' when above both averages
  assert.equal(by.get('MISSING')!.row, null); assert.equal(by.get('MISSING')!.verdict.word, 'Not in the data');
  assert.deepEqual(out.map((x) => x.ticker).slice(0, 2).sort(), ['BARE', 'TOP'], 'weak first');
  assert.equal(out.at(-1)!.ticker, 'MISSING');
});

test('zzz999 company lists: portfolio / Stock screen / hand-off scopes narrow the Pine results', () => {
  assert.equal(scopeKind(''), 'all'); assert.equal(scopeKind('pf'), 'portfolio'); assert.equal(scopeKind('cb'), 'cb');
  assert.equal(scopeKind('ss:tv-rule-of-40'), 'stock'); assert.equal(scopeKind('wl:abc'), 'watchlist'); assert.equal(scopeKind('hand'), 'hand');
  // a Stock Screener screen runs on the Stock Screener's own rows; the Pine result keeps only those companies
  const stockRows = [row('NEAR', { r40: 55 } as any), row('BASE', { r40: 12 } as any), row('BRK', {})];
  const r40 = BUILT_IN_SCREENS.find((s) => s.id === 'tv-rule-of-40')!;
  const set = stockScreenTickers(stockRows, r40, 'US');
  assert.deepEqual([...set], ['NEAR']);
  const q = cleanQuery(BUILT_IN_PINE_SCREENS.find((s) => s.id === 'bases-forming')!.q);
  assert.deepEqual(onList(runPineFull(ROWS, q, 'US').strict, set).map((h) => h.row.t), ['NEAR']);
  // the hand-off from the Stock Screener: cleaned, de-duplicated, market kept
  const h = makeHandoff('IN', 'Zachs India', ['NSE:ABC', 'abc', 'XYZ.NS', '', '<bad>'], 5)!;
  assert.deepEqual(h, { market: 'IN', label: 'Zachs India', tickers: ['ABC', 'XYZ'], at: 5 });
  assert.equal(cleanHandoff({ market: 'EU', tickers: ['A'] }), null);
  assert.equal(cleanHandoff({ market: 'US', tickers: [] }), null);
  assert.equal(normTicker('bse:TATA-EQ'), 'TATA');
});

test('zzz999 fundamental-only presets have Stock Screener copies with stable ids; old saved Pine screens still load', () => {
  // zzz1007 — the Rule of 40 is a Pine screen again (the MOVED notice is gone); the Stock Screener copies stay
  for (const id of ['tv-rule-of-40', 'tv-rule-of-40-in']) {
    const sc = BUILT_IN_SCREENS.find((s) => s.id === id)!;
    assert.equal(sc.market, id.endsWith('-in') ? 'IN' : 'US'); assert.equal(sc.name, 'Rule of 40 (based on your TradingView script)');
    assert.deepEqual(cleanScreens([sc])[0].filters, sc.filters, 'the Stock Screener copy survives its clean-up');
  }
  assert.ok(BUILT_IN_PINE_SCREENS.some((s) => s.id === 'tv-rule-of-40'), 'the old Pine id opens a Pine screen again');
  // a Pine screen the owner saved from the old Rule of 40 preset keeps its rule as it was
  const saved = cleanPineScreens([{ id: 'my-r40', name: 'My Rule of 40', q: { qv: 2, bias: 'both', need: 'any', stages: ['f', 'b'], filters: [{ kind: 'num', key: 'r40', op: 'ge', v: 40 }], cols: ['r40'] } }]);
  assert.deepEqual(saved[0].q.filters, [{ kind: 'num', key: 'r40', op: 'ge', v: 40 }]);
  assert.equal(runPineFull([row('R', { r40: 50 } as any), row('S', { r40: 10 } as any)], saved[0].q, 'US').strict.length, 1);
  // every Pine built-in is still a chart setup: a pattern requirement or chart / momentum rules only (zzz1007: the Rule of 40 is
  // carried by its own control, q.r40Min — never as a hidden fundamental rule)
  const FUND = new Set(['r40', 'revQYoY', 'revAYoY', 'epsQYoY', 'fcfmTTM', 'gmFY', 'roeTTM', 'roceTTM', 'pe', 'ps', 'evRev', 'de', 'cash', 'opmTTM', 'nmTTM', 'fs']);
  for (const s of BUILT_IN_PINE_SCREENS) for (const f of s.q.filters) assert.ok(!('key' in f) || !FUND.has((f as any).key), `${s.id} uses fundamental figure ${(f as any).key}`);
});

test('zzz999 detail panel helpers: invalidation level and the screen checks in plain words', () => {
  assert.deepEqual(invalidation({ b: 'U', s: 'b', p: 100, dp: 20 }).level, 92.5);
  assert.equal(Math.round(invalidation({ b: 'U', s: 'f', p: 100, dp: 20 }).level!), 80);
  assert.equal(invalidation({ b: 'U', s: 'f', p: null, dp: 20 }).level, null);
  const hit = { row: ROWS[1], tags: ROWS[1].pat as ScreenPatternTag[], best: (ROWS[1].pat as ScreenPatternTag[])[0] };
  const checks = patternChecks(hit, { stages: ['f'], minConf: 75, dist: { on: true, lo: -5, hi: 0 } });
  assert.deepEqual(checks.map((c) => c.pass), [true, false, true]);
  assert.match(checks[1].label, /Shape score 70 \(needs 75 or more\)/);
});

test('zzz999 page wiring: cards, portfolio scope, Stock screen list, hand-off, links both ways', () => {
  const pine = read('components/pine-screener/PineScreener.tsx');
  assert.match(pine, /<SetupCards /);
  assert.match(pine, /<option value="pf">My portfolio/);
  assert.match(pine, /Stock Screener screens \(fundamentals\)/);
  assert.match(pine, /value="hand"/);
  assert.match(pine, /<PortfolioCheck /);
  assert.match(pine, /<HitDetail /);
  assert.doesNotMatch(read('components/pine-screener/PortfolioCheck.tsx'), /\b(Buy|Sell)\b/);
  const stock = read('components/stock-screener/StockScreener.tsx');
  assert.match(stock, />Open in Pine Screener</);
  assert.match(stock, /PINE_HANDOFF_KEY/);
  assert.match(stock, />Chart pattern</);
  assert.match(read('app/(dashboard)/portfolio/page.tsx'), /\/pine-screener\?view=portfolio&market=IN/);
  assert.match(read('lib/screener/portfolio-scope.ts'), /resolveIndiaBook/);
  assert.match(read('lib/screener/portfolio-scope.ts'), /\/api\/v1\/us-book\?view=universe/);
});

test('zzz999 Pine page (JSDOM): setup cards with counts, a card opens its screen, portfolio check lists every holding', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/pine-screener', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const { leanRows } = await import('../screener/pine');
  (globalThis as any).fetch = async (url: string) => ({
    ok: true, status: 200,
    json: async () => (url.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-12T23:00:00Z', ...leanRows(ROWS), notes: [] }
      : url.includes('/api/v1/us-book') ? { ok: true, universe: [{ ticker: 'NONE', origin: 'book', listing: 'US' }, { ticker: 'BRK', origin: 'both', listing: 'US' }, { ticker: 'BENCHONLY', origin: 'bench', listing: 'US' }, { ticker: 'GHOST', origin: 'book', listing: 'US' }] }
      : { ok: true }),
  });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  const text = () => document.body.textContent || '';
  try {
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); await settle(); });
    const card = (id: string) => document.querySelector(`[data-card="${id}"]`) as HTMLButtonElement;
    assert.equal(card('breakouts').querySelector('.pnx-card-count')!.textContent, '1');
    assert.equal(card('bases').querySelector('.pnx-card-count')!.textContent, '2');
    assert.equal(card('portfolio').querySelector('.pnx-card-count')!.textContent, '3', 'book + both, not the bench-only name');
    await act(async () => { card('breakouts').click(); await settle(); });
    assert.equal(card('breakouts').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(Array.from(document.querySelectorAll('tbody tr a[data-ticker]')).map((a) => a.textContent), ['BRK']);
    // the detail panel explains the row
    await act(async () => { (document.querySelector('button[aria-label="Details for BRK"]') as HTMLButtonElement).click(); await settle(); });
    assert.match(text(), /Flat base on daily bars, broke out/);
    assert.match(text(), /Every pattern on this company/);
    // the portfolio check: every holding, also without a pattern and not in the data
    await act(async () => { card('portfolio').click(); await settle(); });
    const held = Array.from(document.querySelectorAll('tr[data-holding]')).map((tr) => tr.getAttribute('data-holding')).sort();
    assert.deepEqual(held, ['BRK', 'GHOST', 'NONE']);
    assert.match(text(), /My portfolio check/);
    assert.match(text(), /Not in the data/);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
});

test('zzz1001 a weekly/monthly breakdown does not override the averages in the portfolio verdict', async () => {
  const { maVerdict: mv } = await import('../screener/pine-view');
  const ma = { close: 118, d21: 2, d50: 4, d200: 18, at: '2026-10-13', basis: 'scan' } as any;
  assert.equal(mv(ma, [{ id: 'double_top', b: 'D', s: 'b', c: 70, tf: 'M' } as any]).word, 'Above all MAs');
  assert.equal(mv(ma, [{ id: 'double_top', b: 'D', s: 'b', c: 70 } as any]).word, 'Breaking down · still above 200-day');
});

test('zzz1002 portfolio check shows strong setups near their pivot by default; breaks against the trend are said as such', async () => {
  const pv = await import('../screener/pine-view');
  // PPIH-like: a double top forming with the breakdown level 33% below → hidden; a likely rising-wedge breakdown → shown
  assert.equal(pv.isActivePattern({ c: 86, s: 'f', d: 32.9 }), false);
  assert.equal(pv.isActivePattern({ c: 68, s: 'b', d: -2.4 }), true);
  assert.equal(pv.isActivePattern({ c: 41, s: 'f', d: -3 }), false);
  assert.equal(pv.isActivePattern({ c: 65, s: 'f', d: -5.9 }), true);
  const up = { close: 514, d21: -1.5, d50: 4.7, d200: 42, at: 'x', basis: 'scan' } as any;
  assert.equal(pv.maVerdict(up, [{ id: 'rising_wedge', b: 'D', s: 'b', c: 70 } as any]).word, 'Breaking down · still above 200-day');
  const dn = { close: 10, d21: 3, d50: -2, d200: -9, at: 'x', basis: 'scan' } as any;
  assert.equal(pv.maVerdict(dn, [{ id: 'falling_wedge', b: 'U', s: 'b', c: 70 } as any]).word, 'Breaking out · below 200-day');
  const rows = [{ t: 'PPIH', scanPx: 30.6, sma21: 31, sma50: 29, sma200: 29.7, pat: [{ id: 'double_top', b: 'D', s: 'f', c: 86, d: 32.9 }, { id: 'cup_handle', b: 'U', s: 'f', c: 48, d: -6 }], scan: { st: 'ready', v: 5 } } as any];
  const [x] = pv.portfolioCheck(rows, ['PPIH']);
  assert.equal(x.hidden, 2);
  assert.equal(x.active.flatMap((p) => p.tags || []).length, 0);
});
