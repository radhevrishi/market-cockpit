import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, parseCsv, csvCell } from '../csv';

test('zzz967 CSV: headers with commas, quotes and newlines round-trip with equal field counts', () => {
  const rows = [['Ticker', 'Revenue growth, quarterly YoY (%)', 'Company'], ['ZACHS', 8.96, 'A "B" & C, Ltd\nUnit 2'], ['X', null, '=HYPERLINK("x")']];
  const back = parseCsv(toCsv(rows));
  assert.equal(back.length, 3);
  for (const r of back) assert.equal(r.length, 3);
  assert.equal(back[0][1], 'Revenue growth, quarterly YoY (%)');
  assert.equal(back[1][2], 'A "B" & C, Ltd\nUnit 2');
  assert.equal(back[1][1], '8.96');
  assert.ok(back[2][2].startsWith("'="));          // formula guard
  assert.equal(csvCell(-5), '-5');                  // numbers untouched
});
