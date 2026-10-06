import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vaultPlan, quickHash } from '../user-vault-client';
import { USER_STATE_KEYS_CLIENT } from '../user-vault-keys';
import { USER_STATE_KEYS, isUserStateKey, hashOf } from '../user-state-store';
import { MIGRATIONS, migrationsValid } from '../db-migrate';
import { isProtectedApi } from '../site-auth';

test('vault plan: push local edits, pull other-device edits, restore when missing, never let a fresh browser overwrite', () => {
  assert.deepEqual(vaultPlan('a', undefined, undefined), { kind: 'push' });                         // first save ever
  assert.deepEqual(vaultPlan(null, undefined, { hash: 'srv:x', version: 3 }), { kind: 'pull' });     // browser cleared → restore
  assert.deepEqual(vaultPlan('fresh', undefined, { hash: 'srv:x', version: 3 }), { kind: 'pull' });  // new device: server wins
  assert.deepEqual(vaultPlan('a', { hash: 'a', version: 2 }, { hash: 'a', version: 2 }), { kind: 'none' });
  assert.deepEqual(vaultPlan('b', { hash: 'a', version: 2 }, { hash: 'a', version: 2 }), { kind: 'push' });   // edited here
  assert.deepEqual(vaultPlan('a', { hash: 'a', version: 2 }, { hash: 'srv:z', version: 3 }), { kind: 'pull' }); // edited elsewhere
  assert.deepEqual(vaultPlan('b', { hash: 'a', version: 2 }, { hash: 'srv:z', version: 3 }), { kind: 'push' }); // both: last writer, history keeps the other
  assert.deepEqual(vaultPlan(null, undefined, undefined), { kind: 'none' });
});
test('client and server agree on the allowed keys; anything else is refused', () => {
  assert.deepEqual([...USER_STATE_KEYS_CLIENT].sort(), [...USER_STATE_KEYS].sort());
  assert.equal(isUserStateKey('mc:decisions:v1'), true); assert.equal(isUserStateKey('anything-else'), false);
});
test('hashes are stable', () => { assert.equal(quickHash('abc'), quickHash('abc')); assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 })); });
test('migrations are append-only and numbered 1..n', () => { assert.ok(migrationsValid()); assert.ok(MIGRATIONS.length >= 2); assert.ok(!migrationsValid([{ id: 2, name: 'x', sql: 'select 1' }])); });
test('the personal-data and archive routes are protected', () => { assert.ok(isProtectedApi('/api/v1/user-state')); assert.ok(isProtectedApi('/api/v1/intel-archive')); });
import { archiveRowsFromEvents, extractionRow } from '../intel-archive';
test('archive: only shown events, with source, evidence and engine version; extraction keeps model + prompt version', () => {
  const ev = (st: string) => ({ guidance_event_id: `x${st}`, market: 'IN', ticker: 'ABC', company: 'Abc Ltd', announcement_date: '2026-08-12', verification: 'VERIFIED', taxonomy: 'formal_upgrade', materiality: 'HIGH', guidance_quality: 'HIGH', sources: [{ name: 'Transcript', url: 'https://www.nseindia.com/a.pdf', tier: 'PRIMARY', type: 'Transcript', date: '2026-08-12' }], changes: [{ metric: 'REVENUE', direction: 'UP', percentageChange: 20, before: { low: 1000, high: 1000, unit: 'Cr' }, after: { low: 1200, high: 1200, unit: 'Cr', period: 'FY27', raw: 'We now expect ₹1,200 crore.' } }], pipeline: { status: st } }) as any;
  const rows = archiveRowsFromEvents([ev('CARD'), ev('AUDIT'), ev('QUEUE')]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].eventType, 'GUIDANCE_FORMAL_UPGRADE'); assert.equal(rows[0].sourceUrl, 'https://www.nseindia.com/a.pdf'); assert.match(rows[0].evidence!, /1,200/);
  const x = extractionRow({ docId: 'd', market: 'IN', ticker: 'ABC', company: 'Abc', docUrl: 'u', docKind: 'TRANSCRIPT', filedAt: '2026-08-12', extractedAt: '2026-08-13T00:00:00Z', model: 'gpt-5-mini', promptVersion: 'gx-1', status: 'ok', rows: [], dropped: 0 } as any);
  assert.equal(x.promptVersion, 'gx-1'); assert.equal(x.model, 'gpt-5-mini');
  assert.equal(extractionRow({ ...x, promptVersion: undefined } as any).promptVersion, 'pre-zzz883');
});
