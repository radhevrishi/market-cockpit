import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYahooChart } from '../chart-data';
import { passes, runScreen, filterCounts, type Filter } from '../screener/filters';

const yahoo = (closeToday: number | null, meta: Record<string, number>) => ({ chart: { result: [{
  meta: { symbol: 'TATVA.BO', gmtoffset: 19800, ...meta },
  timestamp: [1791171900, 1791258300, 1791344700],   // 5, 6, 7 Oct 2026 at 09:15 IST
  indicators: { quote: [{ open: [1700, 1790, 1885], high: [1800, 1890, null], low: [1690, 1780, null], close: [1790.3, 1884.15, closeToday], volume: [1000, 2000, null] }] },
}] } });

test('zzz957: today\'s daily bar left empty by Yahoo is filled from the quote in the same answer', () => {
  const j: any = yahoo(null, { regularMarketTime: 1791367199, regularMarketPrice: 1994.5, regularMarketDayHigh: 1999, regularMarketDayLow: 1868.05, regularMarketVolume: 18378 });
  const s = parseYahooChart(j)!;
  const last = s.bars[s.bars.length - 1];
  assert.equal(new Date(last.t).toISOString().slice(0, 10), '2026-10-07');
  assert.deepEqual([last.o, last.h, last.l, last.c, last.v], [1885, 1999, 1868.05, 1994.5, 18378]);
  // a complete bar for that day is left alone
  j.chart.result[0].indicators.quote[0].close[2] = 1990; j.chart.result[0].indicators.quote[0].high[2] = 1999; j.chart.result[0].indicators.quote[0].low[2] = 1868;
  const s2 = parseYahooChart(j)!;
  assert.equal(s2.bars.length, 3); assert.equal(s2.bars[2].c, 1990);
});

test('zzz957: "exact figures only" makes approximate (≈) figures fail the filter', () => {
  const rows: any[] = [{ t: 'A', evRev: 5, approx: ['evRev'] }, { t: 'B', evRev: 5 }];
  const f: Filter = { kind: 'num', key: 'evRev', op: 'lt', v: 20 } as Filter;
  assert.equal(passes(rows[0], f), true);
  assert.equal(passes(rows[0], f, new Date(), true), false);
  assert.deepEqual(runScreen(rows, [f], new Date(), true).map((r) => r.t), ['B']);
  assert.deepEqual(filterCounts(rows, [f], new Date(), true), [1]);
});

test('zzz957: the status check reads the graded cache only (never starts a grading build) and shares one result for 30 s', () => {
  const s = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'system-status', 'route.ts'), 'utf8');
  assert.match(s, /graded\?date=\$\{istToday\(\)\}&cache_only=1/);
  assert.match(s, /const MEMO_MS = (30_000|90_000)/);   // zzz1049: 90 s (fewer Redis reads)
});
