// zzz795 — Theme Rotation route: the history read and the overlay write path
// validate their input and fail soft (no network, no KV needed).
// Run: npx tsx --test src/lib/__tests__/zzz795-theme-route.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../../app/api/market/theme-rotation/route';
import { isoWeek } from '../theme-rotation/history';

const post = (body: unknown) => POST(new Request('http://x/api/market/theme-rotation', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

describe('history endpoint', () => {
  test('GET ?history=1 answers with the current ISO week and a list', async () => {
    const r = await GET(new Request('http://x/api/market/theme-rotation?region=india&history=1&weeks=4'));
    const j: any = await r.json();
    assert.equal(j.region, 'india');
    assert.equal(j.currentWeek, isoWeek(new Date()));
    assert.ok(Array.isArray(j.snapshots));
  });
  test('POST rejects a missing region, a past week and an empty overlay', async () => {
    assert.equal((await post({ overlay: { 'us-semis': { t: 'top' } } })).status, 400);
    assert.equal((await post({ region: 'us', week: '2020-W01', overlay: { 'us-semis': { t: 'top' } } })).status, 400);
    assert.equal((await post({ region: 'us', overlay: { 'not-a-theme': { t: 'top' } } })).status, 400);
  });
  test('POST with a valid overlay never throws (storage may be unavailable in tests)', async () => {
    const r = await post({ region: 'us', week: isoWeek(new Date()), overlay: { 'us-semis': { t: 'top', r: 1, e: 2, c: 1, f: ['crowded'] } } });
    const j: any = await r.json();
    assert.ok(r.status === 200);
    assert.equal(typeof j.ok, 'boolean');
  });
});
