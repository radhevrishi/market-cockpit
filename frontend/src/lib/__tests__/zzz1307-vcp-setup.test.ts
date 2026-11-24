import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETUP_META, SETUPS_VERSION, STRUCTURE_PATTERNS } from '../options-ideas/setups';
import { finalGrade, NO_HISTORY_YET } from '../options-ideas/model';

test('VCP is a call setup and is read in the chart structure next to trendlines and cups', () => {
  assert.equal(SETUP_META.vcp_breakout.side, 'CALL');
  assert.equal(SETUPS_VERSION, 'oi-3');
  for (const id of ['vcp', 'cup', 'cup_handle', 'flat_base', 'double_bottom']) assert.ok(STRUCTURE_PATTERNS.has(id));
});

test('a VCP with no replay history stays at grade B at most', () => {
  assert.ok(NO_HISTORY_YET.has('vcp_breakout'));
  const g = finalGrade({ market: 'US', id: 'vcp_breakout' } as any, { grade: 'A', checks: [], verdict: '' } as any, {});
  assert.equal(g.grade, 'B');
  const other = finalGrade({ market: 'US', id: 'trend_bounce' } as any, { grade: 'A', checks: [], verdict: '' } as any, {});
  assert.equal(other.grade, 'A');
});

test('Entry Desk retest view, server retest brief and Best Picks all take the VCP', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
  assert.match(src('app/(dashboard)/cheat-entry/page.tsx'), /vcp_breakout/);
  assert.match(src('lib/options-ideas/server.ts'), /vcp_breakout/);
  assert.match(src('lib/best-picks/run.ts'), /vcp_breakout/);
});
