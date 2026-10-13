// zzz983 — Pine Screener: chart patterns stored on screener rows by the build path, the page's pure filters, built-in
// screens, and the page / nav / home / vault registrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN_IDS, PATTERN_META, type PatternId } from '../chart-patterns';
import type { DailyBars } from '../screener/tech';
import {
  techEntry, patternsFromBars, rowPatternFields, matchTags, runPine, patternCounts, passesCompany, turnoverOf, dirDist, bestTag, patternGroups,
  leanRows, LEAN_KEYS, cleanQuery, cleanPineScreens, DEFAULT_QUERY, PATTERN_SCAN_VERSION, PINE_SCREENS_KEY, type PineQuery, type ScreenPatternTag,
} from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { filterKeys, fieldOf } from '../screener/filters';
import { assembleInRow } from '../screener/in-build';
import { assembleUsRows } from '../screener/us-build';
import type { ScreenRow } from '../screener/types';
import { USER_STATE_KEYS_CLIENT } from '../user-vault-keys';
import { USER_STATE_KEYS } from '../user-state-store';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// ───────── a synthetic daily series (weekdays, seeded noise) shaped like a textbook cup with handle ─────────
type Leg = [number, number, ('lin' | 'ease')?];
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function series(legs: Leg[], vol?: (i: number, n: number) => number): DailyBars {
  const r = rng(7);
  const path: number[] = new Array(301).fill(legs[0][1]);
  for (const [d, to, shape] of legs) {
    const from = path[path.length - 1];
    for (let k = 1; k <= d; k++) { const x = k / d; path.push(from + (to - from) * (shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x)); }
  }
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.UTC(2023, 0, 2), prev = path[0];
  for (let i = 0; i < path.length; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 0.006), o = prev;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(o); b.c.push(c);
    b.h.push(Math.max(o, c) * (1 + 0.005 * (0.3 + 0.7 * r()))); b.l.push(Math.min(o, c) * (1 - 0.005 * (0.3 + 0.7 * r())));
    b.v.push(vol ? vol(i, path.length) : 1_000_000 * (0.8 + 0.4 * r()));
    prev = c; t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return b;
}
const fade = (k: number) => (i: number, n: number) => (i < n - k ? 1_000_000 : 1_000_000 * (1 - 0.55 * ((i - (n - k)) / k)));
const CUP = series([[60, 60], [120, 100], [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 94.5]], fade(16));
const DOUBLE_TOP = series([[60, 60], [120, 100], [12, 88], [12, 99.5], [8, 94]]);

test('zzz983 build path: techEntry keeps the price figures AND the chart patterns from the same bars', () => {
  const e = techEntry(CUP, Date.UTC(2010, 0, 4) / 1000, false);
  assert.equal(e.patV, PATTERN_SCAN_VERSION);
  assert.equal(e.patAt, CUP.d[CUP.d.length - 1]);
  assert.equal(e.d, CUP.d[CUP.d.length - 1]);                    // price figures still there
  assert.ok(typeof e.sma50 === 'number' && typeof e.rsi === 'number');
  assert.ok(e.pat && e.pat.length >= 1, JSON.stringify(e.pat));
  const cup = e.pat!.find((t) => t.id === 'cup_handle');
  assert.ok(cup, `cup_handle expected, got ${e.pat!.map((t) => t.id).join(',')}`);
  assert.equal(cup.b, 'U'); assert.equal(cup.s, 'f');
  assert.ok(cup.c >= 55 && cup.p != null && cup.d != null && cup.d < 0, JSON.stringify(cup));
  assert.ok(typeof cup.l === 'number' && cup.l > 50);
  for (const t of e.pat!) assert.ok(t.c >= 35, 'only hits with likelihood ≥ 35 are stored');
  assert.equal(techEntry(CUP, null, true).cc != null, true, 'a mid-session read still keeps the completed-session figures');
});

test('zzz983 build path: rows assembled for both markets carry pat / patAt; an entry from before the scan carries neither', () => {
  const tf = techEntry(CUP, null, false);
  const last = CUP.c[CUP.c.length - 1];
  const inRow = assembleInRow('CUPCO', 'Cup Co', { date: CUP.d[CUP.d.length - 1], px: { CUPCO: [last, last, 1000] } } as any, [], undefined, tf, undefined);
  assert.deepEqual(inRow.pat, tf.pat);
  assert.equal(inRow.patAt, tf.patAt);
  const { rows } = assembleUsRows([{ t: 'CUPC', n: 'Cup Corp', sec: 'Technology', ind: 'Software', px: last, chg: 0, vol: 1, mc: 500, ex: 'NASDAQ' } as any],
    new Map(), {} as any, {} as any, new Map([['CUPC', tf]]), new Map(), new Map());
  assert.deepEqual(rows[0].pat, tf.pat);
  assert.equal(rows[0].patAt, tf.patAt);
  const { pat: _p, patAt: _a, patV: _v, ...old } = tf;
  assert.deepEqual(rowPatternFields(old as any), {});
  assert.equal(assembleInRow('CUPCO', 'Cup Co', { date: 'x', px: { CUPCO: [1, 1, 1] } } as any, [], undefined, old as any, undefined).patAt, undefined);
});

test('zzz983 patterns: bearish double top is stored with bias D; junk bars do not throw', () => {
  const { pat } = patternsFromBars(DOUBLE_TOP, null);
  assert.ok(pat.some((t) => t.id === 'double_top' && t.b === 'D'), JSON.stringify(pat));
  // zzz993 (MC-02): an empty history is reported as insufficient, not as a scan that found nothing
  assert.deepEqual(patternsFromBars({ d: [], o: [], h: [], l: [], c: [], v: [] }, null), { pat: [], patAt: null, scan: { st: 'insufficient-history', v: PATTERN_SCAN_VERSION, n: 0 } });
  const tiny: DailyBars = { d: ['2026-01-02'], o: [1], h: [1], l: [1], c: [1], v: [0] };
  assert.deepEqual(patternsFromBars(tiny, 1).pat, []);
});

// ───────── pure filters ─────────
const T = (id: PatternId, s: 'f' | 'b' | 'x', c: number, d: number | null, extra: Partial<ScreenPatternTag> = {}): ScreenPatternTag =>
  ({ id, b: PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s, c, p: 100, d, ...extra });
const row = (t: string, pat: ScreenPatternTag[], o: Partial<ScreenRow> = {}): ScreenRow => ({ t, n: t, px: 50, mc: 1000, avgVol30: 200_000, tvSec: 'Electronic Technology', perf3M: 20, pat, ...o } as ScreenRow);
const Q = (o: Partial<PineQuery> = {}): PineQuery => ({ ...DEFAULT_QUERY, ...o, dist: { ...DEFAULT_QUERY.dist, ...(o.dist || {}) } });
/** zzz993 — the scan status a current build gives a row */
const CUR = (r: ScreenRow) => ({ st: r.pat?.length ? 'ready' as const : 'no-pattern' as const, v: PATTERN_SCAN_VERSION });
const ROWS: ScreenRow[] = [
  row('CUP', [T('cup_handle', 'f', 80, -4), T('vcp', 'f', 50, -3)]),
  row('UBASE', [T('u_base', 'f', 60, -8)]),
  row('FLAG', [T('bull_flag', 'b', 70, 2)], { mc: 50 }),
  row('FAIL', [T('flat_base', 'x', 60, -9)]),
  row('FAR', [T('double_bottom', 'f', 90, -30)]),
  row('TOP', [T('double_top', 'f', 75, 3)]),          // bearish: 3% above the breakdown level → −3 in its direction
  row('HS', [T('head_shoulders', 'b', 65, -2)]),     // broke down, 2% below the level → +2
  row('NONE', []),
];

test('zzz983 filters: bias, sub-pattern, stage, likelihood and pivot window', () => {
  const tickers = (q: PineQuery) => runPine(ROWS, q, 'US').map((h) => h.row.t).sort();
  assert.deepEqual(tickers(Q()), ['CUP', 'FLAG', 'UBASE']);                                 // default: bullish, forming+breakout, likely, −15…+5
  assert.deepEqual(tickers(Q({ bias: 'D' })), ['HS', 'TOP']);
  assert.deepEqual(tickers(Q({ bias: 'both' })), ['CUP', 'FLAG', 'HS', 'TOP', 'UBASE']);
  assert.deepEqual(tickers(Q({ ids: ['u_base'] })), ['UBASE']);                               // "U / rounding only"
  assert.deepEqual(tickers(Q({ stages: ['b'] })), ['FLAG']);
  assert.deepEqual(tickers(Q({ stages: ['x'] })), ['FAIL']);
  assert.deepEqual(tickers(Q({ minConf: 75 })), ['CUP']);
  assert.deepEqual(tickers(Q({ dist: { on: false, lo: 0, hi: 0 } })), ['CUP', 'FAR', 'FLAG', 'UBASE']);
  assert.deepEqual(tickers(Q({ dist: { on: true, lo: 0, hi: 5 } })), ['FLAG']);
  assert.equal(dirDist(T('double_top', 'f', 75, 3)), -3);
  assert.equal(dirDist(T('cup', 'f', 75, -3)), -3);
  // only the tags that pass are returned, the strongest is the "best"
  const cup = runPine(ROWS, Q({ minConf: 35 }), 'US').find((h) => h.row.t === 'CUP')!;
  assert.deepEqual(cup.tags.map((t) => t.id), ['cup_handle', 'vcp']);
  assert.equal(cup.best?.id, 'cup_handle');
  assert.equal(bestTag([T('vcp', 'f', 60, 0), T('flat_base', 'b', 60, 1)]).id, 'flat_base');   // a breakout wins a tie
  assert.deepEqual(matchTags({ pat: [{ id: 'nope' } as any] }, Q({ bias: 'both' })), []);       // unknown ids ignored
});

test('zzz983 filters: company part (size, price, daily value, strength, sector, extra rules)', () => {
  const r = ROWS[0];
  assert.equal(turnoverOf(r, 'US'), 10);                     // 50 × 200,000 = $10M
  assert.equal(turnoverOf(r, 'IN'), 1);                      // ₹1 crore
  assert.equal(passesCompany(r, Q({ mcMin: 500, mcMax: 2000, pxMin: 10, turnMin: 5, perfMin: 10 }), 'US'), true);
  assert.equal(passesCompany(r, Q({ mcMax: 999 }), 'US'), false);
  assert.equal(passesCompany(r, Q({ turnMin: 11 }), 'US'), false);
  assert.equal(passesCompany(r, Q({ perfKey: 'perf1Y', perfMin: 0 }), 'US'), false);     // no 1-year figure → fails
  assert.equal(passesCompany(r, Q({ sectors: ['Finance'] }), 'US'), false);
  assert.equal(passesCompany({ ...r, sma50: 40 } as ScreenRow, Q({ filters: [{ kind: 'cmp', key: 'px', op: 'above', other: 'sma50' }] }), 'US'), true);
  assert.equal(passesCompany({ ...r, sma50: 60 } as ScreenRow, Q({ filters: [{ kind: 'cmp', key: 'px', op: 'above', other: 'sma50' }] }), 'US'), false);
  assert.deepEqual(runPine(ROWS, Q({ mcMin: 100 }), 'US').map((h) => h.row.t).sort(), ['CUP', 'UBASE']);
});

test('zzz983 chip counts ignore the sub-pattern and bias choices but respect the rest', () => {
  const c = patternCounts(ROWS, Q({ ids: ['u_base'] }), 'US');
  assert.equal(c.cup_handle, 1); assert.equal(c.u_base, 1); assert.equal(c.double_top, 1); assert.equal(c.head_shoulders, 1);
  assert.equal(c.double_bottom, 0);      // outside the pivot window
  assert.equal(c.flat_base, 0);          // failed stage not ticked
  assert.equal(Object.keys(c).length, PATTERN_IDS.length);
  const g = patternGroups('U');
  assert.ok(g.every((x) => x.bias === 'bullish'));
  assert.equal(g.flatMap((x) => x.ids).length, PATTERN_IDS.filter((id) => PATTERN_META[id].bias === 'bullish').length);
  assert.equal(patternGroups('both').flatMap((x) => x.ids).length, PATTERN_IDS.length);
});

test('zzz983 lean rows for the page: only companies with a (matching-bias) pattern, scan coverage counted', () => {
  // zzz993: rows built by the current scan carry `scan` (a row with patAt but no scan is an older scan version → stale)
  const rows = [...ROWS, { t: 'OLD', n: 'Old', px: 1 } as ScreenRow].map((r) => (r.t === 'OLD' ? r : { ...r, patAt: '2026-10-09', scan: CUR(r), sma200: 10, roeFY: 5 }));   // zzz993: roeTTM is now sent; roeFY is not
  const l = leanRows(rows, null, true);
  assert.equal(l.total, 9); assert.equal(l.scanned, 8); assert.equal(l.withPattern, 7); assert.equal(l.patAt, '2026-10-09');
  assert.equal(l.rows.length, 7);
  assert.ok(l.rows.every((r) => !('roeFY' in r)) && l.rows.every((r) => 'sma200' in r));
  assert.deepEqual(leanRows(rows, 'D', true).rows.map((r) => r.t).sort(), ['HS', 'TOP']);
  // zzz984: by default every company is sent (rules-only screens need them all); a company without a pattern carries no `pat`
  const all = leanRows(rows);
  assert.equal(all.rows.length, 9); assert.equal(all.withPattern, 7);
  assert.ok(!('pat' in all.rows.find((r) => r.t === 'NONE')!));
});

test('zzz983 built-in Pine screens are well formed and their rules only read fields sent to the page', () => {
  const ids = new Set<string>();
  assert.ok(BUILT_IN_PINE_SCREENS.length >= 8);
  for (const s of BUILT_IN_PINE_SCREENS) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`); ids.add(s.id);
    assert.ok(s.name && s.builtIn);
    assert.deepEqual(cleanQuery(s.q), s.q, `${s.id} survives cleaning unchanged`);
    for (const id of s.q.ids) assert.equal(PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s.q.bias === 'both' ? (PATTERN_META[id].bias === 'bullish' ? 'U' : 'D') : s.q.bias, `${s.id}: ${id} matches the bias`);
    assert.ok(s.q.stages.length > 0);
    for (const f of s.q.filters) for (const k of filterKeys(f)) {
      assert.ok(fieldOf(k), `${s.id}: unknown field ${k}`);
      assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${s.id}: ${k} is not sent to the page`);
    }
  }
  for (const want of ['all-bullish', 'all-bearish', 'oneil-bases', 'minervini-vcp', 'breakouts-today', 'bearish-tops', 'flags-pennants']) assert.ok(ids.has(want), want);
  assert.equal(BUILT_IN_PINE_SCREENS[0].id, 'all-bullish');
});

test('zzz983 saved Pine screens: cleaning keeps valid choices, drops junk', () => {
  const out = cleanPineScreens([
    { id: 'my-1', name: 'Cups', market: 'IN', q: { bias: 'U', ids: ['cup', 'bogus'], stages: ['f', 'z'], minConf: 10, dist: { lo: -5, hi: 2 }, mcMin: 300, filters: [{ kind: 'num', key: 'rsi', op: 'gt', v: 50 }, { kind: 'num', key: 'nope', op: 'gt', v: 1 }] } },
    { id: 'x', name: '' }, null, 'junk',
  ]);
  assert.equal(out.length, 1);
  const q = out[0].q;
  assert.equal(out[0].market, 'IN');
  assert.deepEqual(q.ids, ['cup']); assert.deepEqual(q.stages, ['f']); assert.equal(q.minConf, 35);
  assert.deepEqual(q.dist, { on: true, lo: -5, hi: 2 }); assert.equal(q.mcMin, 300); assert.equal(q.filters.length, 1);
  assert.deepEqual(cleanQuery(null), DEFAULT_QUERY);
  assert.deepEqual(cleanPineScreens('x'), []);
});

test('zzz983 registration: page, API, sidebar nav, Home chips, favourites offer and vault keys', () => {
  assert.ok(existsSync(join(SRC, 'app/(dashboard)/pine-screener/page.tsx')));
  assert.ok(existsSync(join(SRC, 'app/api/v1/pine-screener/route.ts')));
  const page = read('app/(dashboard)/pine-screener/page.tsx');
  assert.ok(!/^export (?!default)/m.test(page), 'a page file only has a default export');
  const nav = read('app/(dashboard)/DashboardClient.tsx');
  assert.equal((nav.match(/href: '\/pine-screener'/g) || []).length, 2, 'sidebar group + flat nav');
  const home = read('app/(dashboard)/page.tsx');
  assert.ok((home.match(/\/pine-screener/g) || []).length >= 3, 'Home quick access, chips and favourites grid');
  assert.match(read('lib/nav-favourites.ts'), /OFFER_ALL[^\n]*'\/pine-screener'/);
  assert.ok((USER_STATE_KEYS_CLIENT as readonly string[]).includes(PINE_SCREENS_KEY));
  assert.ok((USER_STATE_KEYS as readonly string[]).includes(PINE_SCREENS_KEY));
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, /writeReviewQueue\([^\n]*'\/pine-screener'\)/, 'chart review returns to the Pine Screener');
  assert.match(ui, /WorkspaceThemeToggle/);
});

test('zzz983 page renders the matches and switches bias / sub-pattern (JSDOM)', async () => {
  const { JSDOM } = await import('jsdom');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/pine-screener', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const urls: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    urls.push(url);
    return { ok: true, json: async () => (url.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-09T23:00:00Z', ...leanRows(ROWS.map((r) => ({ ...r, patAt: '2026-10-09', scan: CUR(r) }))), notes: [] } : { ok: true }) };
  };
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 20));
  const text = () => document.body.textContent || '';
  const tickers = () => Array.from(document.querySelectorAll('tbody tr a[data-ticker]')).map((a) => a.textContent).sort();
  const click = async (pred: (b: HTMLButtonElement) => boolean) => {
    const b = Array.from(document.querySelectorAll('button')).find(pred);
    assert.ok(b, 'button');
    await act(async () => { b!.click(); await settle(); });
  };
  try {
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); });
    assert.ok(urls.some((u) => u.includes('/api/v1/pine-screener?market=US')));
    assert.deepEqual(tickers(), ['CUP', 'FLAG', 'UBASE']);
    assert.match(text(), /3 companies/);
    assert.match(text(), /patterns as of the 2026-10-09 close/);
    await click((b) => b.textContent === '▼ Bearish');
    assert.deepEqual(tickers(), ['HS', 'TOP']);
    await click((b) => b.textContent === '▲ Bullish');
    await click((b) => (b.textContent || '').startsWith('U / rounding base'));
    assert.deepEqual(tickers(), ['UBASE']);
    const saved = JSON.parse(localStorage.getItem('mc:pine-screener:last:v1') || '{}');
    assert.deepEqual(saved.q.ids, ['u_base']);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
});
