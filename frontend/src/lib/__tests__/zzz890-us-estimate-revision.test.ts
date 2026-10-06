// zzz890 — US estimate revisions after the print. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorFor, estimateRevision } from '../us-estimate-revision';

const row = (period: string, o: Partial<Record<string, number | null>>) => ({ period, end_date: null, current: null, d7: null, d30: null, d60: null, d90: null, up7: null, up30: null, down7: null, down30: null, ...o });
const NOW = new Date('2026-10-06T12:00:00Z');
test('anchor is the first snapshot before the print', () => {
  assert.equal(anchorFor(3), 'd7'); assert.equal(anchorFor(12), 'd30'); assert.equal(anchorFor(45), 'd60'); assert.equal(anchorFor(80), 'd90'); assert.equal(anchorFor(120), null);
});
test('next-year estimate raised after a print 12 days ago (30-day-ago anchor)', () => {
  const r = estimateRevision([row('0y', { current: 5.2, d30: 5.0 }), row('+1y', { current: 6.3, d30: 6.0, up30: 14, down30: 1 })], '2026-09-24', NOW);
  assert.equal(r.verdict, 'RAISED'); assert.equal(r.daysSincePrint, 12);
  assert.match(r.text, /Next fiscal year EPS estimate raised \+5% .*\$6\.00 → \$6\.30.*14 analysts up, 1 down/);
});
test('cut, unchanged and no data', () => {
  assert.equal(estimateRevision([row('+1y', { current: 2.85, d7: 3.0 })], '2026-10-03', NOW).verdict, 'CUT');
  assert.equal(estimateRevision([row('+1y', { current: 3.01, d7: 3.0 })], '2026-10-03', NOW).verdict, 'UNCHANGED');
  assert.equal(estimateRevision([], '2026-10-03', NOW).verdict, 'NO_DATA');
  assert.match(estimateRevision([row('+1y', { current: 3, d90: 2 })], '2026-05-01', NOW).text, /over 90 days/);
});
