// zzz910 — owner notifications: Telegram splitting and "no settings = skipped, never an error".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitForTelegram, notifyOwner, notifyChannels } from '../owner-notify';

test('splitForTelegram keeps every line and stays under the limit', () => {
  const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
  const parts = splitForTelegram(text, 1000);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 1000);
  assert.equal(parts.join('\n'), text);
});

test('a single over-long line is cut, not lost', () => {
  const parts = splitForTelegram('a'.repeat(5000), 100);
  assert.equal(parts.length, 1);
  assert.ok(parts[0].length <= 100);
});

test('no channel settings → both skipped, no errors, no throw', async () => {
  const keep = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^(TELEGRAM_|SMTP_|RESEND_|NOTIFY_EMAIL)/.test(k)) delete process.env[k];
  try {
    assert.deepEqual(notifyChannels(), { telegram: false, email: false, push: false });   // zzz1063: push = a device subscribed
    const r = await notifyOwner({ subject: 's', text: 't' });
    assert.equal(r.telegram, 'skipped'); assert.equal(r.email, 'skipped'); assert.deepEqual(r.errors, []);
  } finally { Object.assign(process.env, keep); }
});
