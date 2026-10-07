import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { framePeriods, type FrameData } from '../screener/sec-assemble';
import { assembleUsRows } from '../screener/us-build';

test('zzz955: cash filed only with restricted cash (or as cash and due from banks) still counts; the plain line wins when filed', () => {
  const periods = framePeriods(new Date('2026-10-07T12:00:00Z'));
  const fd: FrameData = { Revenues: {} };
  for (const p of periods.quarters) fd.Revenues[p] = { '123': { v: 25e6, s: '2026-01-01', e: '2026-03-31' } };
  const I = periods.instants[0];
  fd.StockholdersEquity = { [I]: { '123': { v: 50e6 } } };
  fd.LongTermDebt = { [I]: { '123': { v: 10e6 } } };
  fd.CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents = { [I]: { '123': { v: 10e6 } } };
  const company = { t: 'TEST', n: 'Test', px: 100, chg: 0, vol: 1000, mc: 100, sec: 'Industrials', ind: 'Railroads', ex: 'NASDAQ' };
  const row = () => assembleUsRows([company], new Map([['TEST', 123]]), fd, periods, new Map(), new Map(), new Map()).rows[0];
  assert.equal(row().cash, 10); assert.equal(row().evRev, 1);
  fd.CashAndCashEquivalentsAtCarryingValue = { [I]: { '123': { v: 4e6 } } };
  assert.equal(row().cash, 4, 'the plain cash line wins over the restricted-cash total');
});

test('zzz955: the chart legend never blocks taps or clicks on the chart (only its eye buttons take them)', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'components', 'charts', 'LayoutControls.tsx'), 'utf8');
  const row = src.slice(src.indexOf('className="mc-legend-row"'), src.indexOf('className="mc-legend-row"') + 200);
  assert.match(row, /pointerEvents: 'none'/);
  assert.match(src, /lineHeight: 1, pointerEvents: 'auto' \}\}>\{r\.on \? '👁'/);
});
