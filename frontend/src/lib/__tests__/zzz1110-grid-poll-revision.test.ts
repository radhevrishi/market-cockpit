// zzz1110 (deep audit N10) — a grid poll pushes only the tail when every earlier candle is unchanged; a corrected earlier candle
// (same timestamps, new close), a split rebase, a moved window or a shorter answer redraws the whole set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pollPlan } from '../multichart';

const b = (t: number, c: number, v = 100) => ({ timestamp: t, open: c, high: c + 1, low: c - 1, close: c, volume: v });
const prior = [b(1, 10), b(2, 11), b(3, 12)];

test('unchanged history: tail update from the last old candle (append and live update)', () => {
  assert.deepEqual(pollPlan(prior, [b(1, 10), b(2, 11), b(3, 12.4)]), { kind: 'tail', from: 2 });
  assert.deepEqual(pollPlan(prior, [b(1, 10), b(2, 11), b(3, 12.4), b(4, 13)]), { kind: 'tail', from: 2 });
});

test('a revised earlier candle → reload (the audit fixture: first close 10 → 10.5)', () => {
  assert.equal(pollPlan(prior, [{ ...b(1, 10), close: 10.5 }, b(2, 11), b(3, 12)]).kind, 'reload');
  assert.equal(pollPlan(prior, [b(1, 10, 999), b(2, 11), b(3, 12)]).kind, 'reload', 'volume correction');
  assert.equal(pollPlan(prior, [b(1, 5), b(2, 5.5), b(3, 6)]).kind, 'reload', 'split rebase');
  assert.equal(pollPlan(prior, [b(2, 11), b(3, 12), b(4, 13)]).kind, 'reload', 'window rolled forward');
  assert.equal(pollPlan(prior, [b(1, 10)]).kind, 'reload', 'shorter answer');
  assert.equal(pollPlan([], [b(1, 10)]).kind, 'reload');
});

test('the grid uses the plan and keeps zoom / scroll on a reload', () => {
  const src = readFileSync(new URL('../../components/charts/MultiChart.tsx', import.meta.url), 'utf8');
  assert.match(src, /pollPlan\(prior, bars\)/);
  assert.match(src, /setBarSpace\(space\)/);
  assert.doesNotMatch(src, /const sameHead/);
});
