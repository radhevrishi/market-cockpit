import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readView, DEFAULT_VIEW, rightPadBars } from '../chart-view-prefs';

test('zzz956 view: daily + 3 months by default (his TradingView layout), saved choices kept, junk ignored', () => {
  assert.deepEqual(readView(null), DEFAULT_VIEW);
  assert.equal(DEFAULT_VIEW.tf, 'D'); assert.equal(DEFAULT_VIEW.ranges.D, '3M');
  assert.deepEqual(readView({ tf: 'W', ranges: { W: '5Y', D: 'nope' } }), { tf: 'W', ranges: { D: '3M', W: '5Y', M: 'All' } });
  assert.equal(readView({ tf: 'X' }).tf, 'D');
  assert.equal(rightPadBars(63), 9); assert.equal(rightPadBars(250), 12); assert.equal(rightPadBars(10), 4);
});

test('zzz956 look: TradingView colours by previous close, no grid, no high/low labels, no OHLC line, auto-fit labelled', () => {
  const s = readFileSync(join(__dirname, '..', '..', 'components', 'charts', 'ChartWorkspace.tsx'), 'utf8');
  assert.match(s, /compareRule: 'previous_close', upColor: up/);
  assert.match(s, /const up = '#089981', down = '#F23645'/);
  assert.match(s, /grid: \{ show: false \}/);
  assert.match(s, /high: \{ show: false \}, low: \{ show: false \}/);
  assert.match(s, /tooltip: \{ showRule: 'none', title: \{ show: false \}/);
  assert.match(s, /gap: \{ top: 0\.1, bottom: 0\.1 \}/);
  assert.match(s, />auto<\/button>/);
});
