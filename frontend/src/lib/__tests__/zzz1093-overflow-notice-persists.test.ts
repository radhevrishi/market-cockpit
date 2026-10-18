// zzz1093 (evening retest R2) — an unresolved merge-overflow record is shown again after a reload / remount, for every affected
// key, until dismissed; Dismiss keeps the copy, Delete removes it; a copy that could not be written is never claimed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pendingOverflows, dismissOverflow, deleteOverflow, storeOverflow, OVERFLOW_PREFIX } from '../vault-overflow';

function mem(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i: number) => Array.from(m.keys())[i] ?? null, getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear() } as Storage;
}

test('records survive a "reload" (a fresh read), several keys, dismiss keeps the copy, delete removes it', () => {
  const s = mem();
  assert.equal(storeOverflow(s, 'mc:chart-watchlists:v1', { at: '2026-10-18T19:00:00Z', message: '2 items did not fit: NVDA, AMD' }), true);
  assert.equal(storeOverflow(s, 'other:v1', { at: '2026-10-18T20:00:00Z', message: '1 list did not fit' }), true);
  s.setItem('unrelated', 'x');
  let p = pendingOverflows(s);
  assert.deepEqual(p.map((x) => x.key), ['other:v1', 'mc:chart-watchlists:v1']);
  assert.match(p[1].message, /NVDA, AMD/);
  assert.equal(dismissOverflow(s, 'other:v1'), true);
  p = pendingOverflows(s);
  assert.deepEqual(p.map((x) => x.key), ['mc:chart-watchlists:v1']);
  assert.ok(s.getItem(`${OVERFLOW_PREFIX}other:v1`), 'dismissed copy is kept for download');
  deleteOverflow(s, 'mc:chart-watchlists:v1');
  assert.equal(pendingOverflows(s).length, 0);
});

test('a copy that could not be stored is reported as not kept', () => {
  const s = mem();
  (s as any).setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(storeOverflow(s, 'k', { message: 'x' }), false);
});

test('the notice reads stored records on mount (not only the live event) and says when no copy was kept', () => {
  const n = readFileSync(join(__dirname, '..', '..', 'components', 'VaultSyncNotice.tsx'), 'utf8');
  assert.match(n, /useEffect\(\(\) => \{\s*reread\(\);/);
  assert.match(n, /pendingOverflows\(localStorage\)/);
  assert.match(n, /could not be saved in this browser/);
  assert.match(n, /Delete copy/);
});
