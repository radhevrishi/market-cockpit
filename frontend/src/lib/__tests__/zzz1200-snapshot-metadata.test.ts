import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';
import { getSnapshot, noteSnapshotMetadataWritten, _setSnapshotReaderForTests, REVALIDATE_MS } from '../screener/snapshot-cache';

test('metadata-only checks refresh without loading the rows again, locally and from another builder', async () => {
  let now = 1000, fullReads = 0, meta = { checkedAt: '2026-10-28T10:00:00Z', notes: ['old'] };
  const rows = [{ t: 'TEST', px: 10 }] as any;
  _setSnapshotReaderForTests({
    builtAt: async () => '2026-10-27T00:00:00Z',
    head: async () => ({ builtAt: '2026-10-27T00:00:00Z', meta }),
    full: async (market) => { fullReads++; return { market, builtAt: '2026-10-27T00:00:00Z', rows, meta }; },
  }, () => now);
  try {
    await getSnapshot('US');
    meta = { checkedAt: '2026-10-28T11:00:00Z', notes: ['new source check'] };
    now += REVALIDATE_MS + 1;
    const external = await getSnapshot('US');
    assert.equal(external!.meta.checkedAt, meta.checkedAt);
    assert.equal(external!.rows, rows);
    assert.equal(fullReads, 1);
    noteSnapshotMetadataWritten('US', { checkedAt: '2026-10-28T12:00:00Z', notes: ['local check'] });
    assert.deepEqual((await getSnapshot('US'))!.meta.notes, ['local check']);
    assert.equal(fullReads, 1);
  } finally { _setSnapshotReaderForTests(null); }
});

test('metadata-only changes invalidate the Stock Screener body and ETag without changing figures', async () => {
  const file = join(__dirname, '../../app/api/v1/stock-screener/route.ts'), req = createRequire(file);
  let snap = { builtAt: '2026-10-27T00:00:00Z', rows: [{ t: 'TEST', px: 10 }], meta: { checkedAt: '2026-10-28T10:00:00Z', notes: ['old'] } };
  const fakeRequire = (name: string) => {
    if (name === '@/lib/screener/snapshot-cache') return { getSnapshot: async () => snap, r40GuardedRows: (s: any) => s.rows };
    if (name === '@/lib/screener/run') return { kickBuild: () => false };
    if (name === '@/lib/db') return { getPool: () => null };
    if (name === '@/lib/screener/pine') return { ruleOf40Usable: () => true };
    if (name.startsWith('@/')) return req(join(__dirname, '../../', name.slice(2)));
    return req(name);
  };
  const out = { exports: {} as any };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(fakeRequire, out, out.exports);
  const first = await out.exports.GET(new Request('https://test.invalid/api/v1/stock-screener'));
  const tag = first.headers.get('etag'); const before = await first.json();
  snap = { ...snap, meta: { checkedAt: '2026-10-28T11:00:00Z', notes: ['source was rechecked'] } };
  const second = await out.exports.GET(new Request('https://test.invalid/api/v1/stock-screener', { headers: { 'if-none-match': tag! } }));
  assert.equal(second.status, 200); assert.notEqual(second.headers.get('etag'), tag);
  const after = await second.json();
  assert.deepEqual(after.rows, before.rows); assert.equal(after.builtAt, before.builtAt);
  assert.equal(after.checkedAt, snap.meta.checkedAt); assert.deepEqual(after.notes, snap.meta.notes);
  const third = await out.exports.GET(new Request('https://test.invalid/api/v1/stock-screener', { headers: { 'if-none-match': second.headers.get('etag')! } }));
  assert.equal(third.status, 304);
});
