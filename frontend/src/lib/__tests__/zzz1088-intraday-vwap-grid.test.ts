// zzz1088 — intraday bars with their exchange session date, session VWAP (resets per session), multi-chart grid state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYahooIntraday, sessionVwap, sessionDate, lastSessions } from '../intraday';
import { cleanGrid, gridFromParams, cellUrl, defaultGrid } from '../multichart';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

test('session date is the exchange date, not UTC', () => {
  // 03:50 UTC on 16 Oct = 09:20 IST 16 Oct; 01:00 UTC on 17 Oct = 21:00 New York 16 Oct
  assert.equal(sessionDate(Date.UTC(2026, 9, 16, 3, 50), 'Asia/Kolkata'), '2026-10-16');
  assert.equal(sessionDate(Date.UTC(2026, 9, 17, 1, 0), 'America/New_York'), '2026-10-16');
});

test('Yahoo intraday answer: empty closes dropped, out-of-order dropped, live bar flagged', () => {
  const t0 = Date.UTC(2026, 9, 16, 13, 30) / 1000;
  const j = { chart: { result: [{ meta: { symbol: 'NVDA', exchangeTimezoneName: 'America/New_York', dataGranularity: '5m' }, timestamp: [t0, t0 + 300, t0 + 300, t0 + 600],
    indicators: { quote: [{ open: [10, 11, 11, 12], high: [11, 12, 12, 13], low: [9, 10, 10, 11], close: [10.5, null, 11.5, 12.5], volume: [100, 50, 200, 300] }] } }] } };
  const s = parseYahooIntraday(j, '5m', (t0 + 700) * 1000)!;
  assert.deepEqual(s.bars.map((b) => b.c), [10.5, 11.5, 12.5]);
  assert.equal(s.bars[0].s, '2026-10-16');
  assert.equal(s.lastLive, true);
  assert.equal(parseYahooIntraday(j, '5m', (t0 + 2000) * 1000)!.lastLive, false);
});

test('session VWAP = Σ(hlc3 × volume) ÷ Σ volume, reset at a new session; null before any volume', () => {
  const bars = [
    { h: 11, l: 9, c: 10, v: 0, s: 'A' },     // no volume yet
    { h: 12, l: 10, c: 11, v: 100, s: 'A' },  // tp 11
    { h: 14, l: 12, c: 13, v: 300, s: 'A' },  // tp 13 → (1100 + 3900) / 400 = 12.5
    { h: 21, l: 19, c: 20, v: 50, s: 'B' },   // new session → 20
  ];
  assert.deepEqual(sessionVwap(bars), [null, 11, 12.5, 20]);
  assert.deepEqual(lastSessions(bars, 1).map((b) => b.s), ['B']);
});

test('grid state: cleaned, URL symbols with market prefixes, data addresses', () => {
  const g = cleanGrid({ n: 4, sync: true, cells: [{ t: 'nvda', m: 'US', tf: '15m', vwap: false }, { t: '???', m: 'IN', tf: 'X' }] });
  assert.equal(g.n, 4); assert.equal(g.sync, true);
  assert.deepEqual(g.cells[0], { t: 'NVDA', m: 'US', tf: '15m', vwap: false });
  assert.equal(g.cells[1].t, defaultGrid().cells[1].t, 'an invalid symbol falls back');
  assert.equal(cleanGrid('junk').n, 2);
  const u = gridFromParams(defaultGrid(), 'NSE:HAL,US:HAL', null);
  assert.deepEqual([u.cells[0].m, u.cells[0].t, u.cells[1].m, u.cells[1].t], ['IN', 'HAL', 'US', 'HAL'], 'NSE:HAL and US:HAL stay different companies');
  assert.equal(cellUrl({ t: 'HAL', m: 'IN', tf: '5m' }), '/api/v1/chart-intraday/HAL?market=IN&interval=5m');
  assert.equal(cellUrl({ t: 'HAL', m: 'IN', tf: 'W' }), '/api/v1/chart/HAL?market=IN&interval=1wk');
});

test('wiring: route, page, VWAP indicator, link from Charts and the nav', () => {
  assert.match(read('app/api/v1/chart-intraday/[ticker]/route.ts'), /includePrePost=false/);
  assert.match(read('components/charts/MultiChart.tsx'), /name: 'MC_VWAP'/);
  assert.match(read('components/charts/ChartWorkspace.tsx'), /data-testid="open-grid"/);
  assert.match(read('app/(dashboard)/DashboardClient.tsx'), /href: '\/charts\/grid'/);
});
