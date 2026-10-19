// zzz1096–1098 (evening retest R4 / R5 / R6) — the grid keeps the NSE / BSE listing end to end, shows only the answer for the
// current selection, keeps zoom on polls, and its intraday status keeps "market open/closed", "bar forming" and delay apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanGrid, gridFromParams, cellUrl, cellLabel, fullChartHref, defaultGrid } from '../multichart';
import { barEnd, intradayStatus, parseYahooIntraday } from '../intraday';

const MC = readFileSync(join(__dirname, '..', '..', 'components', 'charts', 'MultiChart.tsx'), 'utf8');

test('R4: BSE stays BSE — link in, state, reload, data address, label, link back', () => {
  const ws = readFileSync(join(__dirname, '..', '..', 'components', 'charts', 'ChartWorkspace.tsx'), 'utf8');
  assert.match(ws, /exchange === 'BSE' \? 'BSE:' : 'NSE:'/);
  const g = gridFromParams(defaultGrid(), 'BSE:TATVA', null);
  assert.deepEqual([g.cells[0].m, g.cells[0].t, g.cells[0].x], ['IN', 'TATVA', 'BSE']);
  const again = cleanGrid(JSON.parse(JSON.stringify(g)));                 // reload
  assert.equal(again.cells[0].x, 'BSE');
  assert.equal(cellUrl(again.cells[0]), '/api/v1/chart/TATVA?market=IN&interval=1d&exchange=BSE');
  assert.equal(cellUrl({ ...again.cells[0], tf: '5m' }), '/api/v1/chart-intraday/TATVA?market=IN&interval=5m&exchange=BSE');
  assert.equal(cellLabel(again.cells[0]), 'BSE:TATVA');
  assert.match(fullChartHref(again.cells[0]), /t=TATVA&m=IN&tf=D&x=BSE$/);
  const nse = gridFromParams(defaultGrid(), 'NSE:TATVA', null).cells[0];
  assert.notEqual(cellUrl(nse), cellUrl(again.cells[0]), 'NSE and BSE requests are different identities');
  assert.equal(cleanGrid({ cells: [{ t: 'NVDA', m: 'US', tf: 'D', x: 'BSE' }] }).cells[0].x, undefined, 'a US cell has no listing');
});

test('R5: the header / VWAP / candles show only the answer for the current request; polls keep the view', () => {
  assert.match(MC, /const current = data && data\.url === url \? data : null;/);
  assert.doesNotMatch(MC, /data\?\.name|data\.last != null/, 'nothing reads the raw (possibly old) answer');
  assert.match(MC, /if \(wantUrlRef\.current !== forUrl\) return;/, 'a late answer for an older selection is dropped');
  assert.match(MC, /barsRef\.current = \[\]; shownUrlRef\.current = '';\s*chart\.resetData\(\);/, 'old candles leave at once');
  assert.match(MC, /if \(plan\.kind === 'tail'\) \{ for \(const x of bars\.slice\(plan\.from\)\) barUpdateRef\.current\(x\); \}/, 'a poll appends — zoom kept (zzz1110: pollPlan)');
});

test('R6: a final short bar ends at the close; open / closed / delayed are separate facts', () => {
  // US 60m bar from 15:30 ET (19:30 UTC) on Fri 16 Oct 2026 ends at the 16:00 ET close (20:00 UTC), not 16:30
  const bar = { t: Date.UTC(2026, 9, 16, 19, 30), s: '2026-10-16' };
  assert.equal(barEnd(bar, '60m', 'US'), Date.UTC(2026, 9, 16, 20, 0));
  const j = { chart: { result: [{ meta: { exchangeTimezoneName: 'America/New_York', dataGranularity: '60m' }, timestamp: [bar.t / 1000], indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [1] }] } }] } };
  assert.equal(parseYahooIntraday(j, '60m', Date.UTC(2026, 9, 16, 20, 10), 'US')!.lastLive, false, '16:10 ET: the session is over');
  // early close (Fri 27 Nov 2026, 13:00 ET = 18:00 UTC): a 12:30 ET bar ends at 13:00
  assert.equal(barEnd({ t: Date.UTC(2026, 10, 27, 17, 30), s: '2026-11-27' }, '60m', 'US'), Date.UTC(2026, 10, 27, 18, 0));
  // during an open session a completed bar is NOT "market closed"
  const tue = Date.UTC(2026, 9, 20, 15, 0);   // Tue 11:00 ET
  assert.match(intradayStatus('US', tue + 2 * 60_000, { t: tue - 5 * 60_000, s: '2026-10-20' }, '5m').text, /market open · last completed bar/);
  assert.match(intradayStatus('US', tue + 2 * 60_000, { t: tue, s: '2026-10-20' }, '5m').text, /market open · bar forming/);
  assert.match(intradayStatus('US', tue, { t: tue - 60 * 60_000, s: '2026-10-20' }, '5m').text, /data delayed/);
  assert.match(intradayStatus('US', Date.UTC(2026, 9, 18, 15, 0), { t: bar.t, s: '2026-10-16' }, '60m').text, /market closed · last session 16 Oct/);
  assert.match(MC, /intradayStatus\(cell\.m, nowTick/);
  assert.doesNotMatch(MC, /'session closed'/);
});
