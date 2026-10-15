// zzz1044b — F05: one ATR (TradingView's ta.atr, first bar's true range = high − low, RMA seeded with the SMA of the first
// `length` true ranges) for the chart, the Stock Screener's ATR % and the trader setups. F06: the four analysis overlays do not
// count toward the 8-indicator limit; nothing is dropped silently; a full "Add an indicator" menu says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atrSeries, atrLast } from '../atr';
import { atr, type Bar } from '../chart-math';
import { atrPctOf } from '../screener/tech';
import { setupFigures } from '../setups';
import {
  addExtraBlockedReason, cleanLayout, cleanLayoutReport, clearDropped, droppedNote, newExtra, regularExtraCount, sameSettings,
  sanitizeLayoutStore, seedLayoutStore, withAutoLinesExtra, migrateAutoLines, EXTRA_TYPES, MAX_EXTRAS, SPECIAL_EXTRAS,
  type ChartLayout, type ExtraType,
} from '../chart-layouts';
import { withPatterns } from '../../components/charts/pattern-view';
import { withStage } from '../../components/charts/stage-view';
import { withSetups } from '../../components/charts/setup-view';
import { withAcc } from '../../components/charts/acc-view';
import { withAutoLines, autoLinesOn } from '../../components/charts/auto-lines-view';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;
const mk = (rows: Array<[number, number, number]>): Bar[] => rows.map(([h, l, c], i) => ({ t: i * DAY, o: c, h, l, c, v: 1e6 }));
const cols = (b: Bar[]) => ({ h: b.map((x) => x.h), l: b.map((x) => x.l), c: b.map((x) => x.c) });
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// the audit counterexample: 15 bars, close 100; first bar 130 / 70, the rest 101 / 99
const counter = mk(Array.from({ length: 15 }, (_, i) => (i === 0 ? [130, 70, 100] : [101, 99, 100]) as [number, number, number]));

// the two old formulas, kept here to show what changed and what did not
function oldChartAtr(bars: Bar[], period = 14): (number | null)[] {
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period) return out;
  let prev = 0; for (let i = 0; i < period; i++) prev += tr[i]; prev /= period; out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) { prev = (prev * (period - 1) + tr[i]) / period; out[i] = prev; }
  return out;
}
function oldScreenerAtrPct(h: number[], l: number[], c: number[], n = 14): number | null {
  const len = c.length; if (len < n + 1) return null;
  const tr = (i: number) => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n;
  for (let i = n + 1; i < len; i++) a = (a * (n - 1) + tr(i)) / n;
  return (a / c[len - 1]) * 100;
}
function wobble(n: number, seed = 7): Bar[] {
  let s = seed, px = 100;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const rows: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const gap = i % 37 === 0 && i ? (rnd() - 0.3) * 12 : 0;      // an occasional gap away from the previous close
    px = Math.max(5, px * (1 + (rnd() - 0.48) * 0.04) + gap);
    const hi = px * (1 + rnd() * 0.03), lo = px * (1 - rnd() * 0.03);
    rows.push([hi, lo, px]);
  }
  return mk(rows);
}

// ── F05 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('F05: the counterexample — chart ATR 14 ÷ close × 100 equals the screener ATR %', () => {
  const a = atr(counter, 14);
  close(a[14] as number, 5.8469387755, 1e-9);
  const { h, l, c } = cols(counter);
  const pct = atrPctOf(h, l, c, 14) as number;
  close(pct, ((a[14] as number) / 100) * 100, 1e-12);
  close(pct, 5.8469387755, 1e-9);
  assert.equal(oldScreenerAtrPct(h, l, c), 2, 'the old screener rule skipped the first bar');
});

test('F05: 13 / 14 / 15 bars — fewer than the length gives nothing, everywhere', () => {
  for (const n of [13, 14, 15]) {
    const b = counter.slice(0, n), { h, l, c } = cols(b);
    const s = atrSeries(h, l, c, 14), ch = atr(b, 14), pct = atrPctOf(h, l, c, 14);
    if (n < 14) {
      assert.ok(s.every((v) => Number.isNaN(v)), 'series all NaN');
      assert.ok(ch.every((v) => v === null), 'chart all null');
      assert.equal(pct, null);
      assert.ok(Number.isNaN(atrLast(h, l, c, 14)));
    } else {
      // first value on bar 13 = mean of the 14 true ranges (60 + 13 × 2) / 14
      close(s[13], (60 + 13 * 2) / 14);
      assert.equal(ch[12], null); close(ch[13] as number, (60 + 13 * 2) / 14);
      close(pct as number, (s[n - 1] / 100) * 100);
    }
  }
});

test('F05: an IPO-style wild first bar counts (TradingView ta.tr(true) = high − low on bar 0)', () => {
  const b = mk([[200, 50, 120], ...Array.from({ length: 20 }, () => [121, 119, 120] as [number, number, number])]);
  const { h, l, c } = cols(b);
  const s = atrSeries(h, l, c, 14);
  close(s[13], (150 + 13 * 2) / 14);
  let e = s[13]; for (let i = 14; i < 21; i++) e = (e * 13 + 2) / 14;
  close(s[20], e);
});

test('F05: gaps use the previous close (true range wider than high − low)', () => {
  const rows: Array<[number, number, number]> = Array.from({ length: 14 }, () => [101, 99, 100]);
  rows.push([131, 129, 130]);                        // gap up 30: TR = |131 − 100| = 31
  const { h, l, c } = cols(mk(rows));
  const s = atrSeries(h, l, c, 14);
  close(s[13], 2); close(s[14], (2 * 13 + 31) / 14);
});

test('F05: the chart keeps its old numbers; the screener converges to them on a long history', () => {
  const b = wobble(400);
  const nw = atr(b, 14), old = oldChartAtr(b, 14);
  for (let i = 0; i < b.length; i++) {
    if (old[i] === null) assert.equal(nw[i], null); else close(nw[i] as number, old[i] as number, 1e-9);
  }
  const { h, l, c } = cols(b);
  const pNew = atrPctOf(h, l, c) as number, pOld = oldScreenerAtrPct(h, l, c) as number;
  assert.ok(Math.abs(pNew - pOld) < 1e-6, `long history: ${pNew} vs ${pOld}`);
  close(pNew, ((nw[399] as number) / c[399]) * 100, 1e-9);
});

test('F05: non-finite data — leading bad bars are skipped, a later bad bar holds the value', () => {
  const rows: Array<[number, number, number]> = [[NaN, NaN, NaN], ...Array.from({ length: 16 }, () => [101, 99, 100] as [number, number, number])];
  const { h, l, c } = cols(mk(rows));
  const s = atrSeries(h, l, c, 14);
  assert.ok(Number.isNaN(s[13])); close(s[14], 2);
  h[16] = NaN;
  const t = atrSeries(h, l, c, 14);
  close(t[16], t[15]);
});

test('F05: the trader setups read the same ATR (x10A = (close − EMA 10) ÷ ATR 14)', () => {
  const b = wobble(300, 11);
  const f = setupFigures(b);
  const { h, l, c } = cols(b);
  const a = atrLast(h, l, c, 14);
  // EMA 10 seeded with the SMA of the first 10 closes (TradingView ta.ema)
  let e = c.slice(0, 10).reduce((x, y) => x + y, 0) / 10;
  for (let i = 10; i < c.length; i++) e = c[i] * (2 / 11) + e * (9 / 11);
  if (f.x10A != null) assert.ok(Math.abs(f.x10A - (c[c.length - 1] - e) / a) <= 0.051, `x10A ${f.x10A}`);
});

test('F05: one implementation — chart, screener and setups all call lib/atr', () => {
  assert.match(read('../chart-math.ts'), /atrSeries\(/);
  assert.match(read('../screener/tech.ts'), /atrLast\(/);
  assert.match(read('../setups.ts'), /atrSeries\(/);
  assert.doesNotMatch(read('../screener/tech.ts'), /for \(let i = 1; i <= n; i\+\+\) atr \+= tr\(i\)/, 'the bar-1 seed is gone');
});

// ── F06 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = (): ChartLayout => cleanLayout(seedLayoutStore(1).layouts[0]);
const regular = EXTRA_TYPES.filter((t) => !SPECIAL_EXTRAS.has(t));

test('F06: all eleven extras survive — 5 overlays + 6 regular indicators, in any add order (zzz1046b: + ACC overlay, + OBV)', () => {
  assert.equal(EXTRA_TYPES.length, 11);
  const orders: ExtraType[][] = [
    ['PAT', 'STG', 'SET', 'ALN', 'ACC', 'BOLL', 'ST', 'RSI', 'MACD', 'ATR', 'OBV'],
    ['BOLL', 'ST', 'RSI', 'MACD', 'ATR', 'OBV', 'PAT', 'STG', 'SET', 'ALN', 'ACC'],
    ['RSI', 'ALN', 'BOLL', 'ACC', 'SET', 'ATR', 'OBV', 'PAT', 'MACD', 'STG', 'ST'],
  ];
  for (const ord of orders) {
    let l = base();
    for (const t of ord) l = cleanLayout({ ...l, extras: [...l.extras, newExtra(t)] });
    assert.deepEqual(new Set(l.extras.map((x) => x.type)), new Set(EXTRA_TYPES), ord.join(','));
    assert.equal(l.dropped, undefined);
    // and through the toggle helpers (overlays appended last)
    let m = base();
    for (const t of regular) m = cleanLayout({ ...m, extras: [...m.extras, newExtra(t)] });
    m = cleanLayout(withPatterns(m, true)); m = cleanLayout(withStage(m, true)); m = cleanLayout(withSetups(m, true)); m = cleanLayout(withAutoLines(m, true)); m = cleanLayout(withAcc(m, true));
    assert.equal(m.extras.length, 11);
    // save + reload
    const re = sanitizeLayoutStore(JSON.parse(JSON.stringify({ v: 1, layouts: [m], deleted: {}, activeId: m.id })));
    assert.equal(re.layouts[0].extras.length, 11);
    assert.equal(sameSettings(re.layouts[0], m), true);
  }
});

test('F06: the audit case — 4 overlays + Bollinger, Supertrend, RSI, MACD: ATR can still be added', () => {
  let l = base();
  for (const t of ['PAT', 'STG', 'SET', 'ALN', 'BOLL', 'ST', 'RSI', 'MACD'] as ExtraType[]) l = cleanLayout({ ...l, extras: [...l.extras, newExtra(t)] });
  assert.equal(regularExtraCount(l), 4);
  assert.equal(addExtraBlockedReason(l, 'ATR'), null);
});

test('F06: overlays are never dropped, even next to 8 regular indicators', () => {
  const extras = [...Array.from({ length: 8 }, () => newExtra('RSI')), newExtra('PAT'), newExtra('STG'), newExtra('SET'), newExtra('ALN'), newExtra('ACC')];
  const l = cleanLayout({ ...base(), extras });
  for (const t of SPECIAL_EXTRAS) assert.ok(l.extras.some((x) => x.type === t), t);
  assert.equal(regularExtraCount(l), 8);
  assert.equal(l.dropped, undefined);
  // the ALN migration adds it even to a full layout now
  const full = cleanLayout({ ...base(), extras: Array.from({ length: 8 }, () => newExtra('MACD')) });
  assert.ok(autoLinesOn(withAutoLinesExtra(full)));
  const st = migrateAutoLines({ v: 1, layouts: [full], deleted: {}, activeId: full.id });
  assert.equal(st.aln, 1); assert.ok(autoLinesOn(st.layouts[0]));
  // a second copy of an overlay collapses to one (draws nothing new)
  assert.equal(cleanLayout({ ...base(), extras: [newExtra('PAT'), newExtra('PAT')] }).extras.length, 1);
});

test('F06: a legacy / imported layout with more than 8 regular indicators keeps the first 8 and reports the rest', () => {
  const types: ExtraType[] = ['RSI', 'MACD', 'BOLL', 'ST', 'ATR', 'RSI', 'MACD', 'BOLL', 'ATR', 'ST'];
  const raw = { ...base(), extras: [newExtra('ALN'), ...types.map((t) => newExtra(t))] };
  const { layout, dropped } = cleanLayoutReport(raw);
  assert.deepEqual(layout.extras.filter((x) => !SPECIAL_EXTRAS.has(x.type)).map((x) => x.type), types.slice(0, MAX_EXTRAS));
  assert.deepEqual(dropped, ['ATR', 'ST']);
  assert.deepEqual(layout.dropped, ['ATR', 'ST']);
  assert.ok(layout.extras.some((x) => x.type === 'ALN'));
  const note = droppedNote(layout) as string;
  assert.match(note, /2 indicators were not loaded/); assert.match(note, /ATR, Supertrend/);
  // the note survives the next clean-ups (store sanitize, the panel's setW) until dismissed — no double counting
  const again = cleanLayout(layout);
  assert.deepEqual(again.dropped, ['ATR', 'ST']);
  const st = sanitizeLayoutStore({ v: 1, layouts: [raw], deleted: {}, activeId: raw.id });
  assert.deepEqual(st.layouts[0].dropped, ['ATR', 'ST']);
  const cleared = clearDropped(again);
  assert.equal(cleared.dropped, undefined); assert.equal(droppedNote(cleared), null);
  assert.equal(cleanLayout(cleared).dropped, undefined);
  assert.equal(sameSettings(cleared, again), true, 'the note is not an unsaved change');
  // hostile / junk `dropped` entries are ignored
  assert.equal(cleanLayout({ ...base(), dropped: ['PAT', 'NOPE', 5] }).dropped, undefined);
});

test('F06: at the limit the menu keeps the item, disabled, with the reason', () => {
  const full = cleanLayout({ ...base(), extras: Array.from({ length: MAX_EXTRAS }, () => newExtra('RSI')) });
  assert.equal(addExtraBlockedReason(full, 'ATR'), 'Limit 8 indicators — remove one to add ATR');
  for (const t of SPECIAL_EXTRAS) assert.equal(addExtraBlockedReason(full, t), null);
  const src = read('../../components/charts/LayoutControls.tsx');
  assert.match(src, /disabled=\{!!why\}/);
  assert.doesNotMatch(src, /w\.extras\.length < MAX_EXTRAS &&/, 'the items are no longer hidden at the limit');
  assert.match(src, /dismissDropped/);
  // existing ids and colours are kept by the clean-up
  const l = cleanLayout({ ...base(), extras: [{ id: 'keep1', type: 'RSI', params: [9], color: '#123456', on: false }] });
  assert.deepEqual(l.extras[0], { id: 'keep1', type: 'RSI', params: [9], color: '#123456', on: false });
});
