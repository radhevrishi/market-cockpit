import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adrPct, aggregateBars, avgDollarVolume, barsBetween, cleanTicker, dataRangeFor, ema, fmtMoney, headerStats, measureLabel,
  rangeStart, relVolume, sanitizeDrawings, sanitizeSettings, sma, validTicker, weekStart, type Bar,
} from '../chart-math';
import { parseYahooChart, yahooSymbolsFor } from '../chart-data';
import { USER_STATE_KEYS_CLIENT } from '../user-vault-keys';
import { CHART_DRAWINGS_KEY, CHART_SETTINGS_KEY } from '../chart-storage';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const bar = (iso: string, o: number, h: number, l: number, c: number, v: number): Bar => ({ t: day(iso), o, h, l, c, v });

test('sma and ema: EMA seeds with the simple average, then k = 2/(n+1)', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  assert.equal(e[2], 2);            // (1+2+3)/3
  assert.equal(e[3], 3);            // 4×0.5 + 2×0.5
  assert.equal(e[4], 4);            // 5×0.5 + 3×0.5
  assert.deepEqual(ema([1, 2], 5), [null, null]);
});

test('ADR%, RVol and average traded value', () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 21; i++) bars.push({ t: i, o: 100, h: 102, l: 100, c: 101, v: 1000 });
  bars[20].v = 3000;
  assert.ok(Math.abs((adrPct(bars) as number) - 2) < 1e-9);          // high/low = 1.02 every day
  assert.equal(relVolume(bars), 3);                                    // 3000 ÷ average of the 20 days before (1000)
  assert.equal(avgDollarVolume(bars.slice(0, 20)), 101_000);          // 101 × 1000
  const s = headerStats([bar('2026-01-01', 1, 1, 1, 100, 1), bar('2026-01-02', 1, 1, 1, 110, 1)]);
  assert.equal(s.change, 10); assert.equal(s.changePct, 10);
  assert.equal(relVolume([bar('2026-01-01', 1, 1, 1, 1, 0)]), null);
});

test('weekly bars start on Monday and monthly on the 1st; OHLCV combine correctly', () => {
  assert.equal(weekStart(day('2026-10-07')), day('2026-10-05'));      // Wednesday → Monday
  assert.equal(weekStart(day('2026-10-04')), day('2026-09-28'));      // Sunday → previous Monday
  const daily = [
    bar('2026-09-30', 10, 12, 9, 11, 100),   // Wed
    bar('2026-10-01', 11, 15, 10, 14, 200),  // Thu
    bar('2026-10-05', 14, 16, 13, 15, 50),   // next Mon
  ];
  const w = aggregateBars(daily, 'W');
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { t: day('2026-09-28'), o: 10, h: 15, l: 9, c: 14, v: 300 });
  const m = aggregateBars(daily, 'M');
  assert.deepEqual(m.map((b) => b.t), [day('2026-09-01'), day('2026-10-01')]);
  assert.deepEqual(m[1], { t: day('2026-10-01'), o: 11, h: 16, l: 10, c: 15, v: 250 });
  assert.equal(aggregateBars(daily, 'D').length, 3);
});

test('measure label and bar count', () => {
  assert.equal(measureLabel(634.2, 746.83, 34), '+112.63 (+17.76%) · 34 bars');
  assert.equal(measureLabel(200, 150, 1), '-50.00 (-25.00%) · 1 bar');
  const times = [10, 20, 30, 40, 50];
  assert.equal(barsBetween(times, 20, 50), 3);
  assert.equal(barsBetween(times, 50, 20), 3);
  assert.equal(barsBetween(times, 25, 41), 2);   // between bars → the bar at or before
});

test('range windows and how much history to fetch', () => {
  assert.equal(rangeStart('1M', day('2026-10-07')), day('2026-09-07'));
  assert.equal(rangeStart('YTD', day('2026-10-07')), day('2026-01-01'));
  assert.equal(rangeStart('5Y', day('2026-10-07')), day('2021-10-07'));
  assert.equal(rangeStart('All', day('2026-10-07')), null);
  assert.equal(dataRangeFor('D', '6M'), '2y');
  assert.equal(dataRangeFor('D', '1Y'), '5y');
  assert.equal(dataRangeFor('D', '5Y'), '10y');
  assert.equal(dataRangeFor('W', '1Y'), '10y');
  assert.equal(dataRangeFor('M', '1Y'), 'max');
  assert.equal(dataRangeFor('D', 'All'), 'max');
});

test('ticker checks: digit-leading NSE symbols pass; junk is refused; prefixes are stripped', () => {
  assert.ok(validTicker('IN', '360ONE')); assert.ok(validTicker('IN', 'M&M')); assert.ok(validTicker('IN', 'BAJAJ-AUTO'));
  assert.ok(validTicker('US', 'BRK.B')); assert.ok(!validTicker('US', '3M')); assert.ok(!validTicker('IN', 'A B'));
  assert.ok(!validTicker('US', 'https://x')); assert.ok(!validTicker('IN', '../etc'));
  assert.equal(cleanTicker(' nse:reliance '), 'RELIANCE'); assert.equal(cleanTicker('TCS.NS'), 'TCS'); assert.equal(cleanTicker('NASDAQ:qqq'), 'QQQ');
  assert.deepEqual(yahooSymbolsFor('IN', 'TCS'), ['TCS.NS', 'TCS.BO']);
  assert.deepEqual(yahooSymbolsFor('US', 'BRK.B'), ['BRK-B']);
});

test('money formatting', () => {
  assert.equal(fmtMoney(2.13e10, 'US'), '$21.30B');
  assert.equal(fmtMoney(4.5e6, 'US'), '$4.5M');
  assert.equal(fmtMoney(1.23e8, 'IN'), '₹12.3 Cr');
  assert.equal(fmtMoney(null, 'IN'), '—');
});

test('saved settings and drawings are cleaned; drawings keep time + price only', () => {
  const s = sanitizeSettings({ emas: [{ period: 21, color: '#ff0000', on: true }, { period: -4, color: 'red', on: false }], volAvg: 0 });
  assert.equal(s.emas[0].color, '#ff0000');
  assert.equal(s.emas[1].period, 1); assert.equal(s.emas[1].color, '#1E66F5'); assert.equal(s.emas[1].on, false);
  assert.equal(s.volAvg, 20); assert.equal(s.showVolume, true);
  const def = sanitizeSettings(null);
  assert.deepEqual(def.emas.filter((e) => e.on).map((e) => e.period), [21, 50, 89]);
  const d = sanitizeDrawings([
    { name: 'segment', points: [{ t: 1, p: 2, x: 400 }, { t: 3, p: 4 }], color: '#00ff00' },
    { name: 'evil', points: [{ t: 1, p: 1 }] },
    { name: 'mcText', points: [{ t: 'x', p: 1 }] },
    { name: 'mcText', points: [{ t: 5, p: 6 }], text: 'breakout' },
  ]);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], { name: 'segment', points: [{ t: 1, p: 2 }, { t: 3, p: 4 }], color: '#00ff00' });
  assert.equal(d[1].text, 'breakout');
  assert.deepEqual(sanitizeDrawings('nope'), []);
});

test('the chart keys are synced to the owner database', () => {
  assert.ok((USER_STATE_KEYS_CLIENT as readonly string[]).includes(CHART_DRAWINGS_KEY));
  assert.ok((USER_STATE_KEYS_CLIENT as readonly string[]).includes(CHART_SETTINGS_KEY));
});

test('Yahoo response parsing: local date at UTC midnight, null closes skipped, high/low widened', () => {
  const j = { chart: { result: [{
    meta: { symbol: 'TCS.NS', longName: 'Tata Consultancy Services', currency: 'INR', gmtoffset: 19800, fullExchangeName: 'NSE' },
    timestamp: [1759550400 /* 2025-10-04 04:00Z = 09:30 IST */, 1759636800, 1759723200],
    indicators: { quote: [{ open: [10, null, 12], high: [11, 12, 11], low: [9, 10, 11.5], close: [10.5, null, 12.5], volume: [100, 200, null] }] },
  }] } };
  const p = parseYahooChart(j)!;
  assert.equal(p.name, 'Tata Consultancy Services');
  assert.equal(p.bars.length, 2);
  assert.equal(p.bars[0].t, day('2025-10-04'));
  assert.deepEqual(p.bars[1], { t: day('2025-10-06'), o: 12, h: 12.5, l: 11.5, c: 12.5, v: 0 });
  assert.equal(parseYahooChart({}), null);
});
