// zzz877 — new STRONG / BLOCKBUSTER cards reach the server bench when the day is graded.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIntoBench } from '../server-bench-upsert';

describe('zzz877 — server bench upsert', () => {
  test('adds new STRONG / BLOCKBUSTER names, ignores MIXED / AVOID, keeps everything already there', () => {
    const prev = { updatedAt: '', count: 1, entries: [{ ticker: 'OLD', tier: 'STRONG', filing_date: '2026-09-01' }] };
    const r = mergeIntoBench(prev, [{ ticker: 'HIIL', tier: 'STRONG', filing_date: '2026-10-03' }, { ticker: 'HAWAENG', tier: 'MIXED', filing_date: '2026-10-03' }], '2026-10-03');
    assert.equal(r.added, 1); assert.equal(r.doc.count, 2);
    assert.deepEqual(r.doc.entries.map((e) => e.ticker), ['OLD', 'HIIL']);
    assert.equal(r.doc.entries[1].seen_date, '2026-10-03');
  });
  test('a newer filing replaces the old entry; an older one never does; same day upgrades to BLOCKBUSTER', () => {
    const prev = { updatedAt: '', count: 1, entries: [{ ticker: 'X', tier: 'STRONG', filing_date: '2026-09-10', v: 1 }] };
    assert.equal(mergeIntoBench(prev, [{ ticker: 'X', tier: 'STRONG', filing_date: '2026-08-01' }], '2026-08-01').replaced, 0);
    const n = mergeIntoBench(prev, [{ ticker: 'X', tier: 'STRONG', filing_date: '2026-10-01', v: 2 }], '2026-10-01');
    assert.equal(n.replaced, 1); assert.equal(n.doc.entries[0].v, 2); assert.equal(n.doc.count, 1);
    const prevBb = { updatedAt: '', count: 1, entries: [{ ticker: 'X', tier: 'BLOCKBUSTER', filing_date: '2026-09-10' }] };
    assert.equal(mergeIntoBench(prevBb, [{ ticker: 'X', tier: 'STRONG', filing_date: '2026-09-10' }], '2026-09-10').replaced, 0, 'same day never downgrades');
  });
  test('an empty bench starts from the day\'s cards', () => {
    const r = mergeIntoBench(null, [{ ticker: 'A', tier: 'BLOCKBUSTER', filing_date: '2026-10-05' }], '2026-10-05');
    assert.equal(r.doc.count, 1); assert.equal(r.added, 1);
  });
});
