// zzz1069 — Stock Screener: the screen picker lists ONLY the open market's screens; the new built-in "Volume Accumulation Leaders"
// screen (India + USA) on the accumulation engine; the Volume column view; accumulation grade shown as a letter; plain chip labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_SCREENS, VOL_ACC_NOTE, filterLabel, runScreen, type Screen } from '../screener/filters';
import { pickerGroups, otherMarketScreenCount } from '../screener/screen-picker';
import { COLUMN_VIEWS, cellText, viewColumns } from '../screener/column-views';
import type { ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const built = new Set(BUILT_IN_SCREENS.map((s) => s.id));
const mine: Screen = { id: 'mine-in', name: 'My India screen', market: 'IN', filters: [] };
const mineUs: Screen = { id: 'mine-us', name: 'My US screen', market: 'US', filters: [] };
const all = [...BUILT_IN_SCREENS, mine, mineUs];

test('India open: the picker shows only India screens (built-in, own, favourites, hidden)', () => {
  const favUs = BUILT_IN_SCREENS.find((s) => s.market === 'US')!.id;
  const favIn = BUILT_IN_SCREENS.find((s) => s.market === 'IN')!.id;
  const g = pickerGroups(all, built, [favUs, favIn], '', [], 'IN');
  const shown = g.flatMap((x) => x.screens);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((s) => s.market === 'IN'), 'no USA screen in the India list — not even a USA favourite');
  assert.ok(!g.some((x) => x.id === 'us'), 'no "Built-in · USA" group');
  assert.ok(shown.some((s) => s.id === mine.id) && !shown.some((s) => s.id === mineUs.id));
  assert.ok(g.find((x) => x.id === 'fav')!.screens.map((s) => s.id).includes(favIn));
  assert.equal(shown.length, all.filter((s) => s.market === 'IN').length);
});

test('USA open: only USA screens; a search for an India screen finds nothing', () => {
  const shown = pickerGroups(all, built, [], '', [], 'US').flatMap((x) => x.screens);
  assert.ok(shown.every((s) => s.market === 'US'));
  assert.equal(shown.length, all.filter((s) => s.market === 'US').length);
  assert.equal(pickerGroups(all, built, [], 'my india', [], 'US').length, 0, 'the own India screen is not offered while USA is open');
  assert.equal(pickerGroups(all, built, [], 'my india', [], 'IN').flatMap((g) => g.screens)[0]?.id, mine.id);
});

test('no market given: unchanged (every market) — and the other-market count ignores hidden screens', () => {
  const g = pickerGroups(all, built, []);
  assert.equal(g.flatMap((x) => x.screens).length, all.length);
  const usCount = all.filter((s) => s.market === 'US').length;
  assert.equal(otherMarketScreenCount(all, 'IN'), usCount);
  assert.equal(otherMarketScreenCount(all, 'IN', [mineUs.id]), usCount - 1);
});

test('the page passes the open market to the picker and wires the market switch', () => {
  const page = read('components/stock-screener/StockScreener.tsx');
  assert.match(page, /<ScreenPicker[^>]*currentMarket=\{market\}[^>]*onSwitchMarket=\{switchMarket\}/);
  const picker = read('components/stock-screener/ScreenPicker.tsx');
  assert.match(picker, /pickerGroups\(screens, builtInIds, favs, q, hidden, currentMarket\)/);
  assert.match(picker, /hidden\.includes\(s\.id\) && s\.market === currentMarket/);
});

// ── the new screen ───────────────────────────────────────────────────────────────────────────────────────────────────────
const leader = (over: Partial<ScreenRow> = {}): ScreenRow => ({
  t: 'GOOD', n: 'Good Co', px: 100, sma50: 90, sma200: 80, hi52: 110, accR: 4, accS: 75, rsR: 80, revQYoY: 22, mc: 2000,
  ...over,
} as unknown as ScreenRow);

test('Volume Accumulation Leaders: one screen per market, same idea, market-correct money limits', () => {
  const us = BUILT_IN_SCREENS.find((s) => s.id === 'us-volume-accumulation')!;
  const ind = BUILT_IN_SCREENS.find((s) => s.id === 'in-volume-accumulation')!;
  assert.ok(us && ind);
  assert.equal(us.market, 'US'); assert.equal(ind.market, 'IN');
  assert.equal(us.name, ind.name);
  assert.ok(us.note!.startsWith(VOL_ACC_NOTE) && ind.note!.startsWith(VOL_ACC_NOTE));
  const capUs = us.filters.find((f) => f.kind === 'num' && f.key === 'mc') as any;
  const capIn = ind.filters.find((f) => f.kind === 'num' && f.key === 'mc') as any;
  assert.deepEqual([capUs.op, capUs.v], ['ge', 300]);   // $300 million
  assert.deepEqual([capIn.op, capIn.v], ['ge', 500]);   // ₹500 crore
  // the picker shows each in its own market only
  assert.deepEqual(pickerGroups(all, built, [], 'accumulation', [], 'IN').flatMap((g) => g.screens).map((s) => s.id), ['in-volume-accumulation']);
  assert.deepEqual(pickerGroups(all, built, [], 'accumulation', [], 'US').flatMap((g) => g.screens).map((s) => s.id), ['us-volume-accumulation']);
});

test('Volume Accumulation Leaders keeps a confirmed leader and drops each failure', () => {
  const ind = BUILT_IN_SCREENS.find((s) => s.id === 'in-volume-accumulation')!.filters;
  const us = BUILT_IN_SCREENS.find((s) => s.id === 'us-volume-accumulation')!.filters;
  const now = new Date('2026-10-18T08:00:00Z');
  assert.equal(runScreen([leader()], ind, now).length, 1, 'grade B, uptrend, near high, strong, growing');
  const fails: Array<[string, Partial<ScreenRow>]> = [
    ['grade C', { accR: 3 }], ['no grade yet', { accR: undefined }], ['50-day under 200-day', { sma50: 75 }], ['price under 50-day', { px: 85, hi52: 95 }],
    ['30% off the high', { hi52: 145 }], ['weak RS', { rsR: 60 }], ['sales growth 5%', { revQYoY: 5 }], ['₹300 Cr company', { mc: 300 }],
  ];
  for (const [why, over] of fails) assert.equal(runScreen([leader(over)], ind, now).length, 0, why);
  assert.equal(runScreen([leader({ px: 4, sma50: 3.6, sma200: 3.2, hi52: 4.4 })], us, now).length, 0, 'US penny stock');
  assert.equal(runScreen([leader()], us, now).length, 1);
});

test('chip labels read plainly: grade letters and "within 25% below the 52-week high"', () => {
  assert.equal(filterLabel({ kind: 'num', key: 'accR', op: 'ge', v: 4 }, 'IN'), 'Accumulation grade A or B');
  assert.equal(filterLabel({ kind: 'num', key: 'accR', op: 'ge', v: 5 }, 'IN'), 'Accumulation grade A');
  assert.equal(filterLabel({ kind: 'num', key: 'accR', op: 'le', v: 2 }, 'IN'), 'Accumulation grade D or E');
  assert.equal(filterLabel({ kind: 'near', key: 'px', other: 'hi52', lo: -25, hi: 0 }, 'US'), 'Price within 25% below 52-week high');
  assert.equal(filterLabel({ kind: 'near', key: 'hi52', other: 'px', lo: 0, hi: 10 }, 'US'), '52-week high 0–10% above Price', 'existing labels unchanged');
});

test('Volume column view: accumulation figures; India adds delivery %, USA does not', () => {
  assert.ok(COLUMN_VIEWS.some((v) => v.id === 'volume'));
  const inCols = viewColumns('volume', [], 'IN');
  const usCols = viewColumns('volume', [], 'US');
  for (const k of ['accR', 'accS', 'accD', 'disD', 'cmf65', 'udv', 'vboD']) { assert.ok(inCols.includes(k as any), k); assert.ok(usCols.includes(k as any), k); }
  assert.ok(inCols.includes('dlv10') && !usCols.includes('dlv10'));
});

test('accumulation grade cells show the letter; medians and blanks unchanged', () => {
  assert.equal(cellText(5, 'num', 'IN', 'accR'), 'A');
  assert.equal(cellText(1, 'num', 'US', 'accR'), 'E');
  assert.equal(cellText(4.5, 'num', 'IN', 'accR'), '4.5');
  assert.equal(cellText(null, 'num', 'IN', 'accR'), '—');
});

test('the company panel explains the accumulation reading in words', () => {
  const p = read('components/stock-screener/CompanyDetail.tsx');
  assert.match(p, /accExplainRow\(row, market\)/);
  assert.match(p, /data-acc-explain/);
});
