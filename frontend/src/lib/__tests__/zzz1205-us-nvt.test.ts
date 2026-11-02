// zzz1205 — NVT Q3 FY26: gross margin fall shown (informational, no grade cost); AI summary carries the EPS facts from the row;
// today's US session refreshes every 5 minutes in the morning release window.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { grossMarginMove, applyGrossMargin, GM_DOWN_TAG } from '../us-gross-margin';
import { countingCaveats } from '../earnings-grade-shared';

const series = { ends: ['2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'],
  revenue: [963.1, 1054, 1066.7, 1242, 1471.3, 1514.9], gross_profit: [371.8, 394.7, 388.9, 445.6, 558, 542.9] };
test('NVT gross margin 37.4% → 35.8% is found against the same quarter a year earlier', () => {
  const m = grossMarginMove(series)!;
  assert.deepEqual([m.prev, m.now, m.delta, m.prevEnd], [37.4, 35.8, -1.6, '2025-09-30']);
  const row: any = { series, caveat_tags: ['x'] };
  applyGrossMargin(row);
  assert.ok(row.caveat_tags.includes(GM_DOWN_TAG));
  assert.equal(countingCaveats(row.caveat_tags), 1);   // informational: never costs a grade point
  assert.equal(grossMarginMove({ ...series, gross_profit: series.gross_profit.map(() => null) }), null);
});
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
test('wired: EPS block in the summary, 5-minute morning refresh', () => {
  const c = read('components/us-earnings-card.tsx');
  assert.match(c, /<SummaryView d=\{struct\} eps=\{eps\} \/>/);
  assert.match(c, /eps=\{epsFactsOf\(r\)\}/);
  assert.match(read('app/api/v1/earnings/graded-us/route.ts'), /etHr >= 6 && etHr < 10 \? 5 \* 60_000/);
});
