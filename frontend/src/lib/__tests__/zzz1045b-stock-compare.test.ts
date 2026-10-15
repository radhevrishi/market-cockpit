// zzz1045b — Stock Screener: compare two screens, Refresh vs scheduled rebuild, per-field period / source, exact rule on hover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScreenRow } from '../screener/types';
import type { Filter, Screen } from '../screener/filters';
import { BUILT_IN_SCREENS } from '../screener/filters';
import { compareRules, compareScreens, compareCandidates, missingLoss, ruleSignature, ruleSlot } from '../screener/screen-compare';
import { SCREENER_REBUILD_CRONS, nextRebuild, parseCron, refreshExplain, hhmmUtc } from '../screener/rebuild-schedule';
import { fieldMeta, fieldMetaLine } from '../screener/field-meta';
import { cellRuleLines, looksAtBoundary } from '../screener/cell-rules';

const SRC = join(__dirname, '..', '..');
const row = (t: string, o: Partial<ScreenRow>): ScreenRow => ({ t, n: `${t} Inc`, sec: null, ind: null, px: null, chg: null, vol: null, avgVol10: null, mc: null, sma50: null, sma200: null,
  revQYoY: null, revAYoY: null, gpQYoY: null, gmFY: null, ebitdaQoQ: null, ebitdaAYoY: null, epsQYoY: null, opmTTM: null, ps: null, evRev: null, de: null, cash: null, emp: null, flt: null, bb: null, fs: null, q: null, ...o });

const ROWS: ScreenRow[] = [
  row('AAA', { mc: 5000, revQYoY: 40.04, px: 50, sma50: 45 }),
  row('BBB', { mc: 3000, revQYoY: 25, px: 20, sma50: 30 }),
  row('CCC', { mc: 9000, revQYoY: 60, px: 10, sma50: null }),
  row('DDD', { mc: 100, revQYoY: null, px: 5, sma50: 4 }),
];

// ── 1. compare ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('rules: identical = shared, same field different limit = side by side, rest = only', () => {
  const a: Filter[] = [{ kind: 'num', key: 'revQYoY', op: 'gt', v: 40 }, { kind: 'cmp', key: 'px', op: 'above', other: 'sma50' }, { kind: 'num', key: 'mc', op: 'ge', v: 1000 }, { kind: 'sector', sectors: ['Finance', 'Utilities'] }];
  const b: Filter[] = [{ kind: 'sector', sectors: ['Utilities', 'Finance'] }, { kind: 'num', key: 'revQYoY', op: 'ge', v: 20 }, { kind: 'num', key: 'pe', op: 'lt', v: 30 }, { kind: 'num', key: 'mc', op: 'ge', v: 1000 }, { kind: 'num', key: 'ps', op: 'lt', v: 5, off: true }];
  const r = compareRules(a, b);
  assert.equal(r.shared.length, 2);                      // mc ≥ 1000, sector (order of the list does not count)
  assert.equal(r.changed.length, 1);
  assert.deepEqual([r.changed[0].a, r.changed[0].b].map((f) => (f as any).v), [40, 20]);
  assert.deepEqual(r.onlyA.map(ruleSlot), ['cmp:px:sma50']);
  assert.deepEqual(r.onlyB.map(ruleSlot), ['num:pe']);
  assert.equal(r.pausedB, 1);
  assert.equal(ruleSignature({ kind: 'num', key: 'mc', op: 'between', v: 10, v2: 1 }), ruleSignature({ kind: 'num', key: 'mc', op: 'between', v: 1, v2: 10 }));
});

test('compareScreens: counts, missing-figure losses and examples, never changes the screens', () => {
  const A = { name: 'A', market: 'US' as const, filters: [{ kind: 'num', key: 'revQYoY', op: 'gt', v: 40 }] as Filter[] };
  const B = { name: 'B', market: 'US' as const, filters: [{ kind: 'cmp', key: 'px', op: 'above', other: 'sma50' }] as Filter[] };
  const before = JSON.stringify([A, B]);
  const r = compareScreens(A, B, ROWS, ROWS);
  assert.equal(JSON.stringify([A, B]), before);
  assert.equal(r.a.matches, 2);                          // AAA (40.04), CCC
  assert.equal(r.b.matches, 2);                          // AAA, DDD
  assert.equal(r.both, 1);
  assert.deepEqual(r.onlyInA.map((x) => x.t), ['CCC']);
  assert.deepEqual(r.onlyInB.map((x) => x.t), ['DDD']);
  assert.equal(r.a.missing.companies, 1);                // DDD has no revenue growth
  assert.equal(r.b.missing.companies, 1);                // CCC has no SMA 50
  assert.deepEqual(r.b.missing.byField, [{ key: 'sma50', n: 1 }]);
  assert.equal(r.marketsDiffer, false);
});

test('examples are capped and largest first; other market is flagged', () => {
  const many = Array.from({ length: 15 }, (_, i) => row(`T${i}`, { mc: i, revQYoY: 99 }));
  const r = compareScreens({ name: 'A', market: 'US', filters: [{ kind: 'num', key: 'revQYoY', op: 'gt', v: 1 }] }, { name: 'B', market: 'IN', filters: [] }, many, [], { limit: 10 });
  assert.equal(r.onlyInA.length, 10);
  assert.equal(r.onlyInACount, 15);
  assert.equal(r.onlyInA[0].t, 'T14');
  assert.equal(r.marketsDiffer, true);
  assert.deepEqual(missingLoss(many, [{ kind: 'num', key: 'pe', op: 'gt', v: 1, off: true }]), { companies: 0, byField: [] });
});

test('candidates: open screen left out, same market first, hidden left out', () => {
  const list = compareCandidates(BUILT_IN_SCREENS as Screen[], BUILT_IN_SCREENS[0].id, BUILT_IN_SCREENS[0].market, [BUILT_IN_SCREENS[1].id]);
  assert.ok(!list.some((s) => s.id === BUILT_IN_SCREENS[0].id || s.id === BUILT_IN_SCREENS[1].id));
  const firstOther = list.findIndex((s) => s.market !== BUILT_IN_SCREENS[0].market);
  assert.ok(firstOther > 0 && list.slice(firstOther).every((s) => s.market !== BUILT_IN_SCREENS[0].market));
});

// ── 2. refresh vs rebuild ──────────────────────────────────────────────────────────────────────────────────────────────
test('rebuild crons match the app scheduler', () => {
  const sched = readFileSync(join(SRC, 'lib', 'app-scheduler.ts'), 'utf8');
  for (const [m, job] of [['US', 'build-screener-us'], ['IN', 'build-screener-in']] as const) {
    const line = sched.split('\n').find((l) => l.includes(`name: '${job}'`))!;
    const crons = JSON.parse(line.match(/crons: (\[[^\]]*\])/)![1].replace(/'/g, '"'));
    assert.deepEqual(crons, SCREENER_REBUILD_CRONS[m]);
  }
  for (const c of [...SCREENER_REBUILD_CRONS.US, ...SCREENER_REBUILD_CRONS.IN]) assert.ok(parseCron(c));
});

test('next rebuild times', () => {
  const at = (iso: string, m: 'US' | 'IN') => nextRebuild(m, new Date(iso))!.toISOString().slice(0, 16);
  assert.equal(at('2026-10-15T10:06:00Z', 'IN'), '2026-10-15T10:25');
  assert.equal(at('2026-10-15T10:45:00Z', 'IN'), '2026-10-15T11:05');     // strictly after
  assert.equal(at('2026-10-15T15:00:00Z', 'US'), '2026-10-15T18:45');     // Thursday
  assert.equal(at('2026-10-15T23:00:00Z', 'US'), '2026-10-16T02:45');     // the night after (Fri 02:45)
  assert.equal(at('2026-10-17T03:00:00Z', 'US'), '2026-10-19T14:45');     // Saturday → Monday
  assert.equal(at('2026-10-17T01:00:00Z', 'US'), '2026-10-17T02:45');     // Sat 02:45 = Friday night's run
  assert.equal(hhmmUtc(new Date('2026-10-15T18:45:00Z')), '18:45');
  const txt = refreshExplain('US', new Date('2026-10-15T12:00:00Z'), new Date('2026-10-15T15:00:00Z'));
  assert.match(txt, /does not rebuild/);
  assert.match(txt, /18:45 UTC/);
});

test('the page says Refresh reloads the stored snapshot and shows build time + next rebuild; no rebuild button', () => {
  const page = readFileSync(join(SRC, 'components', 'stock-screener', 'StockScreener.tsx'), 'utf8');
  assert.match(page, /Data built \{/);
  assert.match(page, /Next rebuild ~/);
  assert.match(page, /title=\{refreshText\}/);
  assert.ok(!page.includes('/api/v1/cron/build-screener'), 'the page must not start a rebuild');
});

// ── 3. per-field period / source ───────────────────────────────────────────────────────────────────────────────────────
test('field meta: period and source per market', () => {
  const r = row('X', { q: 'Q2 2026', scanAt: '2026-10-14', pxAt: '2026-10-14', fcfmAt: 'Mar 2026', approx: ['evRev'] });
  assert.deepEqual([fieldMeta('revQYoY', 'US', r).kind, fieldMeta('revQYoY', 'US', r).source], ['quarter', 'SEC filings']);
  assert.match(fieldMeta('revQYoY', 'IN', r).period, /latest quarter \(Q2 2026\)/);
  assert.equal(fieldMeta('revQYoY', 'IN', r).source, 'screener.in');
  assert.equal(fieldMeta('opmTTM', 'US', r).kind, 'ttm');
  assert.equal(fieldMeta('gmFY', 'US', r).kind, 'year');
  assert.equal(fieldMeta('px', 'US', r).source, 'Nasdaq stock list');
  assert.equal(fieldMeta('px', 'IN', r).source, 'NSE daily price file');
  assert.match(fieldMeta('sma50', 'IN', r).source, /Yahoo daily prices, with NSE/);
  assert.equal(fieldMeta('sma50', 'US', r).kind, 'session');
  assert.equal(fieldMeta('emp', 'US', r).source, 'Yahoo company profile');
  assert.match(fieldMeta('fcfmTTM', 'IN', r).period, /to Mar 2026/);
  assert.match(fieldMeta('fcfmTTM', 'IN', r).source, /cash-flow proxy/);       // fcfmSourceText
  assert.equal(fieldMeta('roceTTM', 'IN', r).kind, 'year');                      // screener.in ROCE of the latest year
  assert.ok(fieldMeta('gpQYoY', 'IN', r).approx);                                // approxNote reused from FIELDS
  assert.equal(fieldMeta('gpQYoY', 'US', r).approx, undefined);
  assert.match(fieldMetaLine('evRev', 'US', r), /≈/);
  assert.doesNotMatch(fieldMetaLine('ps', 'US', r), /≈/);
  const detail = readFileSync(join(SRC, 'components', 'stock-screener', 'CompanyDetail.tsx'), 'utf8');
  assert.match(detail, /fieldMeta\(f\.key, market, row\)/);
});

// ── 4. exact rule on hover ─────────────────────────────────────────────────────────────────────────────────────────────
test('cell rule lines: exact value, exact rule, pass / fail, boundary warning', () => {
  const r = ROWS[0];                                         // revQYoY 40.04 → shows 40%
  const f: Filter[] = [{ kind: 'num', key: 'revQYoY', op: 'gt', v: 40 }, { kind: 'num', key: 'revQYoY', op: 'lt', v: 40.04 }, { kind: 'num', key: 'pe', op: 'gt', v: 1 }];
  const lines = cellRuleLines(r, 'revQYoY', f, 'US');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text.startsWith('40.04 > 40 ✓'), true);
  assert.ok(lines[0].boundary);
  assert.equal(lines[1].pass, false);
  assert.ok(lines[1].text.startsWith('40.04 < 40.04 ✗'));
  assert.ok(looksAtBoundary(40.04, 40, 'revQYoY', 'US'));
  assert.ok(!looksAtBoundary(45, 40, 'revQYoY', 'US'));
  assert.equal(cellRuleLines(r, 'revQYoY', [{ ...f[0], off: true }], 'US').length, 0);
  const c = cellRuleLines(r, 'sma50', [{ kind: 'cmp', key: 'px', op: 'above', other: 'sma50' }], 'US');
  assert.match(c[0].text, /Price 50 > SMA 50 45 ✓/);
  assert.match(cellRuleLines(ROWS[3], 'revQYoY', f, 'US')[0].text, /not known ✗/);
  const page = readFileSync(join(SRC, 'components', 'stock-screener', 'StockScreener.tsx'), 'utf8');
  assert.match(page, /\.\.\.ruleLinesFor\(r, k\)/);
  assert.match(page, /Compare with another screen…/);
});
