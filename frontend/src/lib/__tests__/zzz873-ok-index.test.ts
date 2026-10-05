// zzz873 — the universe must see EVERY extraction result with rows, not only the 600 most recently extracted documents.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { listExtractResults, EXTRACT_INDEX_KEY, EXTRACT_OK_INDEX_KEY, extractKey } from '../guidance-extract-reader';
import { updateOkIndex, OK_INDEX_KEY, INDEX_KEY, resultKey, type KvIo } from '../ai-guidance-extract';

const res = (id: string, status: 'ok' | 'no_guidance', filed: string, rows = status === 'ok' ? 1 : 0) => ({
  docId: id, market: 'IN', ticker: 'T' + id, company: 'C', docUrl: 'u', docKind: 'TRANSCRIPT', filedAt: `${filed}T10:00:00Z`, extractedAt: '2026-10-05T12:00:00Z', model: 'm', status, rows: Array.from({ length: rows }, () => ({ metric: 'REVENUE' })), dropped: 0,
});
function memKv(init: Record<string, any>): KvIo & { store: Map<string, any>; mgets: number } {
  const store = new Map(Object.entries(init));
  const kv: any = { store, mgets: 0,
    get: async (k: string) => (store.has(k) ? store.get(k) : null),
    set: async (k: string, v: any) => { store.set(k, v); },
    mget: async (ks: string[]) => { kv.mgets++; return ks.map((k) => (store.has(k) ? store.get(k) : null)); },
  };
  return kv;
}

describe('zzz873 — ok index', () => {
  test('without an ok index the reader behaves as before (main index, capped at 600)', async () => {
    const init: Record<string, any> = {}; const ids: string[] = [];
    for (let i = 0; i < 900; i++) { const id = `d${i}`; ids.push(id); init[extractKey(id)] = res(id, 'ok', '2026-08-01'); }
    init[EXTRACT_INDEX_KEY] = ids;
    const kv = memKv(init);
    const l = await listExtractResults({ io: kv });
    assert.equal(l.results.length, 600);
  });

  test('with an ok index every result with rows is read, and includeEmpty adds the recent empty results', async () => {
    const init: Record<string, any> = {}; const main: string[] = []; const ok: string[] = [];
    for (let i = 0; i < 2000; i++) { const id = `d${i}`; main.push(id); const st = i % 3 === 0 ? 'no_guidance' : 'ok'; init[extractKey(id)] = res(id, st, i < 1000 ? '2026-06-10' : '2026-08-20'); if (st === 'ok') ok.push(id); }
    init[EXTRACT_INDEX_KEY] = main; init[EXTRACT_OK_INDEX_KEY] = ok;
    const kv = memKv(init);
    const l = await listExtractResults({ io: kv, market: 'IN' });
    assert.equal(l.results.length, ok.length, 'all ok results, not 600');
    assert.ok(l.results.every((r) => r.status === 'ok'));
    assert.equal(l.results[0].filedAt.slice(0, 10), '2026-08-20', 'newest filing first');
    const all = await listExtractResults({ io: kv, includeEmpty: true });
    assert.ok(all.results.length > ok.length && all.results.some((r) => r.status === 'no_guidance'));
  });

  test('updateOkIndex: rebuilt once from the main index when missing, then kept current (fresh first, no duplicates, capped)', async () => {
    const init: Record<string, any> = {}; const main: string[] = [];
    for (let i = 0; i < 250; i++) { const id = `d${i}`; main.push(id); init[resultKey(id)] = res(id, i % 2 ? 'ok' : 'no_guidance', '2026-07-01'); }
    init[INDEX_KEY] = main;
    const kv = memKv(init);
    const n = await updateOkIndex(kv, []);
    assert.equal(n, 125); assert.equal(kv.store.get(OK_INDEX_KEY).length, 125);
    assert.ok(kv.store.get(OK_INDEX_KEY).every((id: string) => kv.store.get(resultKey(id)).status === 'ok'));
    const before = kv.mgets;
    await updateOkIndex(kv, ['new1', 'd1']);
    assert.equal(kv.mgets, before, 'no rebuild once the index exists');
    const idx = kv.store.get(OK_INDEX_KEY);
    assert.deepEqual(idx.slice(0, 2), ['new1', 'd1']); assert.equal(idx.length, 126); assert.equal(new Set(idx).size, idx.length);
    assert.equal(OK_INDEX_KEY, EXTRACT_OK_INDEX_KEY);
  });
});
