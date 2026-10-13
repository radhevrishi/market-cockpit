import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableQuery, onList, runPine, DEFAULT_QUERY } from '../screener/pine';
import { readFileSync } from 'node:fs';

const rows: any[] = [
  { t: 'AAA', n: 'Alpha', mc: 500, px: 10, revQYoY: 30 },
  { t: 'BBB', n: 'Beta', mc: 900, px: 20, revQYoY: 50 },
];

test('zzz989 a rule on a figure no company has yet is paused, not emptying the list', () => {
  const q = { ...DEFAULT_QUERY, need: 'any' as const, filters: [{ kind: 'num', key: 'r40', op: 'ge', v: 40 } as any] };
  const a = availableQuery(rows, q, 0);
  assert.deepEqual(a.paused, ['r40']);
  assert.equal(runPine(rows, a.q, 'US').length, 2);
  // once the figure exists the rule applies again
  const later = rows.map((r, i) => ({ ...r, r40: i ? 55 : 20 }));
  const b = availableQuery(later, q, 2);
  assert.deepEqual(b.paused, []);
  assert.deepEqual(runPine(later, b.q, 'US').map((h) => h.row.t), ['BBB']);
});

test('zzz989 pattern requirement waits until the market is scanned; list scope narrows', () => {
  const a = availableQuery(rows, { ...DEFAULT_QUERY, need: 'pattern' } as any, 0);
  assert.equal(a.patternsPaused, true);
  assert.equal(runPine(rows, a.q, 'US').length, 2);
  assert.equal(availableQuery(rows, { ...DEFAULT_QUERY, need: 'pattern' } as any, 5).patternsPaused, false);
  const hits = runPine(rows, a.q, 'US');
  assert.deepEqual(onList(hits, new Set(['BBB'])).map((h) => h.row.t), ['BBB']);
  assert.equal(onList(hits, null).length, 2);
});

test('zzz989 the page links watchlists and says what is paused', () => {
  const src = readFileSync('src/components/pine-screener/PineScreener.tsx', 'utf8');
  // zzz994 (MC-07): strict results + a separate provisional preview instead of a silently relaxed query
  assert.match(src, /runPineFull/);
  assert.match(src, /Provisional/);
  assert.match(src, /Conviction Beats/);
  assert.match(src, /toggleStar/);
  const route = readFileSync('src/app/api/v1/pine-screener/route.ts', 'utf8');
  assert.match(route, /kickBuild\(market\)/);
});
