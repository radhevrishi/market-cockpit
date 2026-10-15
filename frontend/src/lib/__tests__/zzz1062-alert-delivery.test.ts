// zzz1062 — Test button explains delivery in plain words; provider reasons come through without secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testReport } from '../alerts/engine';
import { providerReason, notifyDiagnosis } from '../owner-notify';

const ready = { telegram: { ready: true, missing: [] }, email: { ready: true, missing: [], toMasked: 'r••••••@gmail.com' } };

test('email not ticked on the alert is named, with the fix', () => {
  const lines = testReport({ telegram: 'sent', email: 'sent', errors: [] }, ready, { telegram: true, email: false });
  assert.match(lines[0], /^Email: sent to r••••••@gmail.com/);
  assert.match(lines[0], /NOT ticked on this alert/);
  assert.doesNotMatch(lines[1], /NOT ticked/);
});

test('missing settings are named by variable name', () => {
  const d = { telegram: { ready: false, missing: ['TELEGRAM_CHAT_ID'] }, email: { ready: false, missing: ['RESEND_API_KEY'], toMasked: null } };
  const lines = testReport({ telegram: 'skipped', email: 'skipped', errors: [] }, d, { telegram: true, email: true });
  assert.match(lines[0], /Railway is missing RESEND_API_KEY/);
  assert.match(lines[1], /Railway is missing TELEGRAM_CHAT_ID/);
});

test('provider reasons give a fix', () => {
  const lines = testReport(
    { telegram: 'error', email: 'error', errors: ['telegram HTTP 400 — Bad Request: chat not found', 'email HTTP 403 — You can only send testing emails to your own email address'] },
    ready, { telegram: true, email: true });
  assert.match(lines[0], /own email address/);
  assert.match(lines[0], /same address you signed up/);
  assert.match(lines[1], /chat not found/);
  assert.match(lines[1], /press Start/);
});

test('providerReason reads JSON reasons and hides secrets', async () => {
  const r = new Response(JSON.stringify({ ok: false, description: 'Unauthorized for bot123:SECRET' }), { status: 401 });
  const why = await providerReason(r, ['123:SECRET']);
  assert.equal(why, 'Unauthorized for bot***');
  const r2 = new Response(JSON.stringify({ statusCode: 422, message: 'Invalid `to` field' }), { status: 422 });
  assert.equal(await providerReason(r2), 'Invalid `to` field');
});

test('diagnosis names missing settings and never returns values', () => {
  const keep = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (/^(TELEGRAM_|RESEND_|NOTIFY_EMAIL|SMTP_)/.test(k)) delete process.env[k];
    process.env.RESEND_API_KEY = 're_secretvalue';
    process.env.NOTIFY_EMAIL_TO = 'someone@example.com';
    const d = notifyDiagnosis('ALERTS');
    assert.equal(d.email.ready, true);
    assert.equal(d.email.via, 'resend');
    assert.equal(d.email.toMasked, 's••••••@example.com');
    assert.deepEqual(d.telegram.missing, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']);
    assert.doesNotMatch(JSON.stringify(d), /re_secretvalue/);
  } finally { process.env = keep; }
});
