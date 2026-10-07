import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupHash, verifyBackup, encryptBackup, decryptBackup, restoreCheck } from '../../../../.github/scripts/user-data-backup.mjs';
import { hashOf } from '../user-state-store';

function sample() {
  const value = { __raw: '{"notes":"₹ α","positions":[]}', parsed: { notes: '₹ α', positions: [] } };
  const book = { version: 1, owner: 'test', updatedAt: '2026-10-07T00:00:00Z', holdings: [], bench: [], cash: { EUR: 10.12 } };
  return { ok: true, formatVersion: 2, items: [{ key: 'mc:decisions:v1', value, hash: hashOf(value), version: 3, updatedAt: '2026-10-07T00:00:00Z' }], usBook: { key: 'us-book:v1:test', value: book, hash: hashOf(book) } };
}
test('backup hashes agree with the server, including reordered JSONB and Unicode', () => {
  assert.equal(backupHash({ z: [null, '₹'], a: 1.2345678901234567 }), hashOf({ a: 1.2345678901234567, z: [null, '₹'] }));
  assert.equal(verifyBackup(sample()).items.length, 1);
});
test('omitted US coverage, duplicates and altered values invalidate the backup', () => {
  const missing = sample() as any; delete missing.usBook; assert.throws(() => verifyBackup(missing));
  const duplicate = sample(); duplicate.items.push(duplicate.items[0]); assert.throws(() => verifyBackup(duplicate));
  const changed = sample(); changed.usBook.value.cash.EUR = 99; assert.throws(() => verifyBackup(changed));
});
test('authenticated encryption round-trips and rejects wrong keys or tampering', () => {
  const data = sample(); const encrypted = encryptBackup(data, 'disposable-test-password');
  assert.deepEqual(decryptBackup(encrypted, 'disposable-test-password'), data);
  assert.throws(() => decryptBackup(encrypted, 'wrong-password'));
  const altered = JSON.parse(encrypted); const bytes = Buffer.from(altered.ciphertext, 'base64'); bytes[0] ^= 1; altered.ciphertext = bytes.toString('base64');
  assert.throws(() => decryptBackup(JSON.stringify(altered), 'disposable-test-password'));
  assert.throws(() => encryptBackup(data, ''));
});
test('failed restore read-back rolls back and deletes the isolated KV key', async () => {
  const queries: string[] = []; let removed = '';
  const db = { query: async (sql: string) => { queries.push(sql); return { rows: [] }; } };
  await assert.rejects(restoreCheck(db, { set: async () => {}, get: async () => 'null', del: async (key: string) => { removed = key; } }, sample(), []), /count mismatch/);
  assert.equal(queries.at(-1), 'ROLLBACK'); assert.match(removed, /^backup_drill_[a-f0-9]+:us-book$/);
});
