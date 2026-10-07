import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWorkspaceLight, workspaceThemeClass, WORKSPACE_LIGHT_KEY } from '../workspace-theme';

const mem = (o: Record<string, string>) => ({ getItem: (k: string) => (k in o ? o[k] : null) });

test('zzz954 theme: white by default, remembers the choice, keeps an older Charts choice', () => {
  assert.equal(readWorkspaceLight(mem({})), true);
  assert.equal(readWorkspaceLight(null), true);
  assert.equal(readWorkspaceLight(mem({ [WORKSPACE_LIGHT_KEY]: '0' })), false);
  assert.equal(readWorkspaceLight(mem({ [WORKSPACE_LIGHT_KEY]: '1', 'mc:chart-light:v1': '0' })), true, 'the shared key wins');
  assert.equal(readWorkspaceLight(mem({ 'mc:chart-light:v1': '0' })), false, 'older Charts-only choice kept');
  assert.equal(readWorkspaceLight({ getItem: () => { throw new Error('blocked'); } }), true);
  assert.equal(workspaceThemeClass(true), 'mc-chart-light');
  assert.equal(workspaceThemeClass(true, true), 'mc-chart-light mc-light-legacy');
  assert.equal(workspaceThemeClass(false), 'mc-workspace-dark');
});

test('zzz954 theme: Charts, Watchlists and Stock Screener all carry the switch', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
  for (const f of ['components/charts/ChartWorkspace.tsx', 'components/stock-screener/StockScreener.tsx', 'app/(dashboard)/watchlists/page.tsx']) {
    const s = src(f);
    assert.match(s, /useWorkspaceLight\(/, f);
    assert.match(s, /<WorkspaceThemeToggle /, f);
    assert.match(s, /workspaceThemeClass\(/, f);
  }
  assert.match(src('styles/design-system.css'), /\.mc-workspace-dark \{/);
  assert.match(src('app/globals.css'), /\.mc-light-legacy \[style\*="#0a0a0f"\]/);
});

test('zzz957 theme: when the browser refuses to store the choice, it still holds for this visit (no flip back)', async () => {
  const { writeWorkspaceLight, readWorkspaceLight: read, _resetWorkspaceThemeMemory } = await import('../workspace-theme');
  _resetWorkspaceThemeMemory();
  const blocked = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(read(blocked), true);
  assert.equal(writeWorkspaceLight(blocked, false), false);
  assert.equal(read(blocked), false, 'dark kept although storage refused');
  const ok: Record<string, string> = {};
  const store = { getItem: (k: string) => ok[k] ?? null, setItem: (k: string, v: string) => { ok[k] = v; } };
  assert.equal(writeWorkspaceLight(store, true), true);
  assert.equal(read(store), true);
  _resetWorkspaceThemeMemory();
});
