import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPineFull, DEFAULT_QUERY, cleanQuery } from '../screener/pine';
import { readWorkspaceLight, _resetWorkspaceThemeMemory } from '../workspace-theme';
import { SCREEN_THEME_KEY } from '../theme';

const tag = (id: string) => ({ id, b: 'U', s: 'f', c: 70, p: 10, d: -2 });
const scan = { st: 'ready', v: 5 };
const rows: any[] = [
  { t: 'FLAT', px: 10, mc: 1000, r40: 55, pat: [tag('flat_base')], scan },
  { t: 'NOPAT', px: 10, mc: 1000, r40: 60, scan: { st: 'no-pattern', v: 5 } },
  { t: 'NOR40', px: 10, mc: 1000, pat: [tag('flat_base')], scan },
];
const r40 = { kind: 'num', key: 'r40', op: 'ge', v: 40 } as any;

test('zzz997 ticked pattern types are required even on a rules-only screen', () => {
  const q = cleanQuery({ ...DEFAULT_QUERY, need: 'any', ids: ['flat_base'], filters: [r40], stages: ['f', 'b'], minConf: 35, dist: { on: false, lo: -15, hi: 5 } });
  const run = runPineFull(rows, q, 'US');
  assert.deepEqual(run.strict.map((h) => h.row.t), ['FLAT']);
});

test('zzz997 a missing figure that other companies have fails the rule instead of counting as provisional', () => {
  const q = cleanQuery({ ...DEFAULT_QUERY, need: 'any', ids: [], filters: [r40], stages: ['f', 'b'], minConf: 35, dist: { on: false, lo: -15, hi: 5 } });
  const run = runPineFull(rows, q, 'US');
  assert.deepEqual(run.strict.map((h) => h.row.t).sort(), ['FLAT', 'NOPAT']);
  assert.equal(run.provisional.length, 0);
  // nobody has the figure yet (build pending) → still provisional
  const none = runPineFull(rows.map(({ r40: _x, ...r }) => r), q, 'US');
  assert.equal(none.strict.length, 0);
  assert.equal(none.provisional.length, 3);
});

test('zzz997 workspace pages follow the site theme until they have their own choice; the header switch updates them', () => {
  _resetWorkspaceThemeMemory();
  const store = (o: Record<string, string>) => ({ getItem: (k: string) => (k in o ? o[k] : null) });
  assert.equal(readWorkspaceLight(store({})), true);
  assert.equal(readWorkspaceLight(store({ [SCREEN_THEME_KEY]: 'dark' })), false);
  assert.equal(readWorkspaceLight(store({ [SCREEN_THEME_KEY]: 'dark', 'mc:workspace-light:v1': '1' })), true);
  const ctx = readFileSync('src/contexts/ThemeContext.tsx', 'utf8');
  assert.match(ctx, /setWorkspaceLight\(next === 'light'\)/);
});
