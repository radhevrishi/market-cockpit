// zzz908 — GitHub-side collector resilience: transient-vs-real classification, retrying fetch, and the
// daily actions-watchdog classifier (fixtures are the real failure annotations seen 15 Sep – 6 Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RF from '../../../../.github/scripts/lib/resilient-fetch.mjs';
import * as W from '../../../../.github/scripts/actions-watchdog.mjs';

// ── resilient-fetch ────────────────────────────────────────────────────────

test('isTransientError: outages and rate limits are transient, our own bugs and 4xx are not', () => {
  assert.equal(RF.isTransientError(new Error('Upstash SET failed: HTTP 503 — busy')), true);
  assert.equal(RF.isTransientError(new Error('GitHub API /x → HTTP 502')), true);
  assert.equal(RF.isTransientError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })), true);
  assert.equal(RF.isTransientError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), true);
  assert.equal(RF.isTransientError(new RF.TransientUpstreamError('NSE refused')), true);
  // real
  assert.equal(RF.isTransientError(new Error('KV set failed 413: ERR max request size exceeded')), false);
  assert.equal(RF.isTransientError(new Error('ingest HTTP 404')), false);
  assert.equal(RF.isTransientError(new TypeError("Cannot read properties of undefined (reading 'tickers')")), false);
  assert.equal(RF.isTransientError(Object.assign(new Error('HTTP 503'), { transient: false })), false);
});

test('resilient fetch retries 503 then succeeds, honouring a short Retry-After', async () => {
  let calls = 0;
  const base = async () => { calls++; return calls < 3 ? new Response('busy', { status: 503, headers: { 'retry-after': '0' } }) : new Response('ok', { status: 200 }); };
  const f = RF.makeResilientFetch(base as any, { retries: 3, backoffMs: 5, log: () => {} });
  const r = await f('https://example.test/a');
  assert.equal(r.status, 200);
  assert.equal(calls, 3);
});

test('resilient fetch does not retry 404 / 401, and gives up after the retry budget on 502', async () => {
  for (const status of [404, 401, 413]) {
    let calls = 0;
    const f = RF.makeResilientFetch((async () => { calls++; return new Response('', { status }); }) as any, { retries: 3, backoffMs: 5, log: () => {} });
    assert.equal((await f('https://example.test/b')).status, status);
    assert.equal(calls, 1, `status ${status} must not be retried`);
  }
  let calls = 0;
  const f = RF.makeResilientFetch((async () => { calls++; return new Response('', { status: 502, headers: { 'retry-after': '0' } }); }) as any, { retries: 1, backoffMs: 5, log: () => {} });
  assert.equal((await f('https://example.test/c')).status, 502);
  assert.equal(calls, 2);
});

test('resilient fetch retries a reset connection but never a caller timeout', async () => {
  let calls = 0;
  const reset = RF.makeResilientFetch((async () => {
    calls++;
    if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return new Response('ok');
  }) as any, { retries: 2, backoffMs: 5, log: () => {} });
  assert.equal((await reset('https://example.test/d')).status, 200);
  assert.equal(calls, 2);

  let t = 0;
  const timeout = RF.makeResilientFetch((async () => { t++; throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }) as any, { retries: 3, backoffMs: 5, log: () => {} });
  await assert.rejects(timeout('https://example.test/e'), /aborted/);
  assert.equal(t, 1);
});

// ── actions-watchdog classifier ────────────────────────────────────────────

const run = (conclusion: string, extra: any = {}) => ({ conclusion, path: '.github/workflows/x.yml', html_url: 'https://github.com/o/r/actions/runs/1', created_at: '2026-10-05T20:00:00Z', ...extra });
const MIGRATE = '"The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026."';

test('runner capacity (5 Oct 2026) is GitHub-side, not ours', () => {
  const c = W.classifyRun(run('failure'), [{ conclusion: 'cancelled', steps: [], runner_name: '' }], ['The job was not acquired by Runner of type hosted even after multiple attempts', MIGRATE]);
  assert.equal(c.kind, 'capacity');
});

test('concurrency supersede and manual cancel are harmless', () => {
  assert.equal(W.classifyRun(run('cancelled'), [], ['Canceling since a higher priority waiting request for ci-refs/heads/main exists', 'The operation was canceled.']).kind, 'superseded');
  assert.equal(W.classifyRun(run('cancelled'), [], ['The run was canceled by @radhevrishi.']).kind, 'manual');
});

test('real failures stay real: missing secret, ingest not storing, quality bar, job timeout', () => {
  const steps = [{ name: 'Backfill EDGAR guidance documents', conclusion: 'failure' }];
  assert.equal(W.classifyRun(run('failure'), [{ conclusion: 'failure', steps, runner_name: 'r' }], ['Process completed with exit code 1.', 'Set SEC_USER_AGENT or SEC_CONTACT_EMAIL (SEC rejects requests without a contact User-Agent).', MIGRATE]).kind, 'real');
  assert.equal(W.classifyRun(run('failure'), [], ['rows were read but not stored']).kind, 'real');
  assert.equal(W.classifyRun(run('failure'), [], ['guidance extractor below the bar (precision ≥ 0.90, recall ≥ 0.80)']).kind, 'real');
  const t = W.classifyRun(run('cancelled'), [{ conclusion: 'cancelled', steps: [{ name: 'Run mover-reasons scraper', conclusion: 'cancelled' }], runner_name: 'r' }], ['The job has exceeded the maximum execution time of 8m0s', 'The operation was canceled.']);
  assert.equal(t.kind, 'real');
  assert.match(t.reason, /time limit/);
});

test('an upstream outage is transient; only exit-code noise falls back to the failed step name', () => {
  assert.equal(W.classifyRun(run('failure'), [], ['Upstash SET failed: HTTP 503 — Service Unavailable', 'Process completed with exit code 1.']).kind, 'transient');
  const c = W.classifyRun(run('failure'), [{ conclusion: 'failure', steps: [{ name: 'Restore test', conclusion: 'failure' }], runner_name: 'r' }], ['Process completed with exit code 1.']);
  assert.equal(c.kind, 'real');
  assert.match(c.reason, /Restore test/);
});

test('summary: alert only for unrecovered real failures or a collector deferred all day', () => {
  const items = [
    { workflow: 'a.yml', kind: 'real', reason: 'boom', createdAt: '2026-10-05T10:00:00Z', url: 'u1' },
    { workflow: 'a.yml', kind: 'ok', createdAt: '2026-10-05T12:00:00Z' },       // a recovered
    { workflow: 'b.yml', kind: 'capacity', createdAt: '2026-10-05T12:00:00Z' },
    { workflow: 'c.yml', kind: 'ok', deferred: true, createdAt: '2026-10-05T01:00:00Z' },
    { workflow: 'c.yml', kind: 'ok', deferred: true, createdAt: '2026-10-05T07:00:00Z' },
  ];
  let s = W.summarize(items as any);
  assert.equal(s.realWfs.length, 0);
  assert.equal(s.recovered.length, 1);
  assert.equal(s.stuck.length, 1);
  assert.equal(s.alert, true);
  const msg = W.buildMessage(s, { hours: 24, repo: 'o/r' });
  assert.match(msg, /STUCK/);
  assert.match(msg, /no free machine/);

  s = W.summarize([{ workflow: 'd.yml', kind: 'ok', createdAt: '1' }, { workflow: 'd.yml', kind: 'real', reason: 'x', createdAt: '2' }] as any);
  assert.equal(s.realWfs.length, 1);
  assert.equal(s.alert, true);

  s = W.summarize([{ workflow: 'e.yml', kind: 'capacity', createdAt: '1' }, { workflow: 'e.yml', kind: 'ok', createdAt: '2' }] as any);
  assert.equal(s.alert, false);
});
