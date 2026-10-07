import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store: Record<string, string> = {};
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } };

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

test('zzz954: a BSE row shows drawings saved earlier under the plain India key until it has its own', async () => {
  const { saveDrawings, loadDrawingsWithLegacy } = await import('../chart-storage');
  const line = [{ name: 'mcHLine' as const, points: [{ t: 1, p: 10 }] }];
  saveDrawings('IN:TATVA', line, 1000);
  assert.deepEqual(loadDrawingsWithLegacy('IN:BSE:TATVA').map((d) => d.name), ['mcHLine']);
  saveDrawings('IN:BSE:TATVA', [], 2000);   // cleared on the BSE row: stays cleared
  assert.deepEqual(loadDrawingsWithLegacy('IN:BSE:TATVA'), []);
  assert.deepEqual(loadDrawingsWithLegacy('IN:TATVA').length, 1, 'the NSE row keeps its own');
  assert.deepEqual(loadDrawingsWithLegacy('US:QQQ'), []);
});
