import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanIndia } from '../guidance-upgrades-scan';

const now = new Date('2026-10-05T08:00:00Z');
const blocked = async () => ({ ok: false, filings: [], reason: 'NSE_BLOCKED' });

test('days the GitHub collector indexed count as read when the exchange feeds are blocked', async () => {
  const r = await scanIndia({ now, days: 5, fetchNse: blocked, fetchBse: blocked, collectorDays: new Set(['2026-10-05', '2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01']) });
  assert.ok(r.status.daysCovered >= 4, `covered ${r.status.daysCovered}`);
  assert.ok(r.status.sources.some((s) => s.name === 'GitHub India collector' && s.state !== 'NOT_RUN'));
});
test('no collector record: nothing is counted (unknown is not covered)', async () => {
  const r = await scanIndia({ now, days: 5, fetchNse: blocked, fetchBse: blocked, collectorDays: null });
  assert.equal(r.status.daysCovered, 0);
  const s = r.status.sources.find((x) => x.name === 'GitHub India collector')!;
  assert.equal(s.state, 'NOT_RUN');
  assert.match(s.detail || '', /Scrape Guidance Docs/);
});
test('a partial collector set covers only its days', async () => {
  const r = await scanIndia({ now, days: 5, fetchNse: blocked, fetchBse: blocked, collectorDays: new Set(['2026-10-05']) });
  assert.equal(r.status.daysCovered, 1);
  assert.equal(r.status.complete, false);
});
test('long window: collector days older than the live window count as covered', async () => {
  const old = new Set<string>(); for (let i = 0; i < 90; i++) old.add(new Date(now.getTime() - i * 86_400_000 + 19_800_000).toISOString().slice(0, 10));
  const r = await scanIndia({ now, days: 120, fetchNse: blocked, fetchBse: blocked, collectorDays: old });
  assert.ok(r.status.daysCovered >= 80, `covered ${r.status.daysCovered}`);
});
