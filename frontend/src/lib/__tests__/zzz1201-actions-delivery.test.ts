import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGuidanceDelivery } from '../../../../.github/scripts/lib/guidance-delivery.mjs';
import { sendHeartbeat } from '../../../../.github/scripts/send-heartbeat.mjs';
import { mergeFilings, run as collectFilings } from '../../../../.github/scripts/scrape-corp-filings.mjs';
import { run as collectResults } from '../../../../.github/scripts/scrape-nse-results.mjs';
import { classifyRun, summarize } from '../../../../.github/scripts/actions-watchdog.mjs';
import { fetchFacts } from '../../components/guidance-upgrades/facts-request';
import { run as collectGuidance } from '../../../../.github/scripts/scrape-guidance-docs.mjs';

const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status });
function deliveryFixture() {
  const values = new Map<string, string>(); const members = new Map<string, Set<string>>();
  const sent: any[] = []; let mode = 'outage', calls = 0, journalDown = false;
  const env = { NODE_ENV: 'test' as const, UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'redis-credential', CRON_BASE_URL: 'https://app.test', CRON_SECRET: 'job-credential' };
  const f = async (url: string, init: any) => {
    if (url === env.UPSTASH_REDIS_REST_URL) {
      if (journalDown) return json({}, 503);
      const [op, ...a] = JSON.parse(init.body);
      let result: any = null;
      if (op === 'EVAL') {
        const [, , item, queue, ...args] = a;
        const set = members.get(queue) || new Set<string>(); members.set(queue, set);
        if (args.length === 3) { values.set(item, args[0]); set.add(args[2]); }
        else { values.delete(item); set.delete(args[0]); }
        result = 1;
      } else if (op === 'SMEMBERS') result = [...(members.get(a[0]) || [])];
      else if (op === 'SCARD') result = members.get(a[0])?.size || 0;
      else if (op === 'GET') result = values.get(a[0]) || null;
      else if (op === 'SREM') result = members.get(a[0])?.delete(a[1]) ? 1 : 0;
      else throw new Error(`Unexpected Redis command ${op}`);
      return json({ result });
    }
    calls++; const body = JSON.parse(init.body); sent.push(body);
    if (mode === 'outage') return json({}, 502);
    if (mode === 'auth') return json({}, 401);
    if (mode === 'malformed') return new Response('broken');
    if (mode === 'partial') return json({ ok: true, stored: 0, rejected: [{ index: 0 }] });
    if (mode === 'reject') return json({ ok: true, stored: 0, rejected: [{ i: 0, reason: 'bad company document' }] });
    return json({ ok: true, stored: new Set(body.docs.map((d: any) => d.docId)).size, rejected: [] });
  };
  return { values, members, sent, env, f, calls: () => calls, mode: (s: string) => { mode = s; }, failJournal: () => { journalDown = true; }, client: () => createGuidanceDelivery({ fetch: f, env, sleep: async () => {}, log: () => {} }) };
}
const payload = { market: 'US', collector: 'test', docs: [{ docId: 'a'.repeat(20), text: 'Public company guidance.' }] };

test('an outage preserves a compressed batch across process restarts; recovery acknowledges and removes it', async () => {
  const f = deliveryFixture();
  assert.equal((await f.client().post(payload)).ok, false);
  assert.equal(f.values.size, 1);
  assert.ok(![...f.values.values()].join('').includes('job-credential'));
  f.mode('ok');
  assert.deepEqual(await f.client().replay('US'), { attempted: 1, recovered: 1, pending: 0 });
  assert.deepEqual(f.sent.at(-1), payload);
  assert.equal(f.values.size, 0);
});
test('401 is not retried or acknowledged; a malformed 200 and rejected rows stay pending too', async () => {
  for (const mode of ['auth', 'malformed', 'partial']) {
    const f = deliveryFixture(); f.mode(mode);
    assert.equal((await f.client().post(payload)).ok, false);
    assert.equal(f.values.size, 1);
    assert.equal(f.calls(), 1);
  }
});
test('a journal failure prevents unprotected delivery, and a dry run writes nothing', async () => {
  const f = deliveryFixture(); f.failJournal();
  await assert.rejects(() => f.client().post(payload), /journal HTTP 503/);
  assert.equal(f.calls(), 0);
  const d = createGuidanceDelivery({ fetch: async () => { throw new Error('must not call'); }, env: { ...f.env, DRY_RUN: '1' } });
  assert.equal((await d.post(payload)).ok, true);
});
test('recovery never replays an obsolete coverage/status claim', async () => {
  const f = deliveryFixture();
  await f.client().post({ ...payload, status: { old: true }, coverage: { days: { old: 'ok' } } });
  f.mode('ok'); await f.client().replay('US');
  assert.equal(f.sent.at(-1).coverage, undefined);
  assert.equal(f.sent.at(-1).status, undefined);
});
test('duplicate IDs use the ingest endpoint unique-document acknowledgement count', async () => {
  const f = deliveryFixture(); f.mode('ok');
  assert.equal((await f.client().post({ ...payload, docs: [...payload.docs, ...payload.docs] })).ok, true);
  assert.equal(f.values.size, 0);
});
test('validation rejections enter a separate review queue, without blocking all later market collection', async () => {
  const f = deliveryFixture(); f.mode('reject');
  const result: any = await f.client().post(payload);
  assert.equal(result.quarantined, true);
  assert.equal(f.members.get('collector-delivery:v1:US')?.size, 0);
  assert.equal(f.members.get('collector-delivery:v1:US:review')?.size, 1);
  assert.deepEqual(await f.client().replay('US'), { attempted: 0, recovered: 0, pending: 0 });
});
test('re-reading unchanged public text does not create a new pending batch just because collection time changed', async () => {
  const f = deliveryFixture();
  await f.client().post({ ...payload, docs: [{ ...payload.docs[0], collectedAt: '2026-10-28T00:00:00Z' }] });
  await f.client().post({ ...payload, docs: [{ ...payload.docs[0], collectedAt: '2026-10-29T00:00:00Z' }] });
  assert.equal(f.values.size, 1);
});
test('India collection stops on an invalid service key before downloading PDFs', async () => {
  let requests = 0;
  await assert.rejects(() => collectGuidance({ env: { CRON_SECRET: 'bad-key' }, fetch: async () => { requests++; return json({}, 401); }, pdftotext: async () => '', sleep: async () => {}, log: () => {} }), /authentication\/configuration failed/);
  assert.equal(requests, 1);
});
test('a company facts request with a hung JSON body reaches an error and aborts', async () => {
  let signal: AbortSignal | undefined;
  const f: typeof fetch = async (_u, init) => { signal = init?.signal as AbortSignal; return { ok: true, json: () => new Promise(() => {}) } as any; };
  await assert.rejects(() => fetchFacts('/facts', new AbortController().signal, f, 5), /did not answer in time/);
  assert.equal(signal?.aborted, true);
});
test('leaving a page cancels its in-flight figures request', async () => {
  const page = new AbortController();
  const f: typeof fetch = (_u, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('cancelled'))); });
  const p = fetchFacts('/facts', page.signal, f, 1000);
  page.abort();
  await assert.rejects(p, /cancelled/);
});
const NOW = new Date('2026-10-29T12:00:00Z');
const filing = (exchange: string, n = 0) => ({ exchange, symbol: `${exchange}${n}`, subject: 'Results', filing_datetime: new Date(NOW.getTime() - n * 1000).toISOString() });
test('blocked BSE retains last-good BSE while fresh NSE does not renew the BSE timestamp', () => {
  const oldAt = '2026-10-29T01:00:00Z';
  const old = { generatedAt: oldAt, filings: [filing('BSE')] };
  const readings = { NSE: { ok: true, filings: Array.from({ length: 600 }, (_, i) => filing('NSE', i)) }, BSE: { ok: false, filings: [] } };
  const p: any = mergeFilings(old, readings, NOW);
  assert.equal(p.finalCount, 500);
  assert.ok(p.filings.some((x: any) => x.exchange === 'BSE'));
  assert.equal(p.sources.BSE.fetchedAt, oldAt);
  assert.equal(p.sources.BSE.state, 'partial');
  assert.equal(p.sources.NSE.fetchedAt, NOW.toISOString());
});
test('expired carried filings cannot become fresh through repeated partial runs', () => {
  const old = { generatedAt: NOW.toISOString(), sources: { BSE: { fetchedAt: '2026-10-27T01:00:00Z' } }, filings: [filing('BSE')] };
  const p: any = mergeFilings(old, { NSE: { ok: true, filings: [filing('NSE')] }, BSE: { ok: false, filings: [] } }, NOW);
  assert.equal(p.filings.filter((x: any) => x.exchange === 'BSE').length, 0);
});
test('total exchange outage never replaces the existing blob', async () => {
  let writes = 0;
  const r = await collectFilings({ env: { NODE_ENV: 'test', UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'test' }, now: NOW, fetch: async (input: any, init: any) => {
    const url = String(input);
    if (url === 'https://kv.test') { const c = JSON.parse(init.body); if (c[0] !== 'GET') writes++; return json({ result: null }); }
    return json({}, 403);
  } });
  assert.equal(r.stored, false); assert.equal(writes, 0);
});
test('results collector keeps weekend empties separate from unread weekdays', async () => {
  const r = await collectResults({ now: new Date('2026-10-26T10:00:00Z'), env: { DAYS: '3', DRY_RUN: '1' }, sleep: async () => {}, log: () => {}, fetch: async () => json([]) });
  assert.deepEqual(r.failed, ['2026-10-26']);
  assert.deepEqual(r.readDays, ['2026-10-25', '2026-10-24']);
});
test('heartbeat retries outages and records partial/deferred as incomplete', async () => {
  let calls = 0; let sent: any;
  assert.equal(await sendHeartbeat({ env: { NODE_ENV: 'test', JOB_NAME: 'test', COLLECTION_OUTCOME: 'success', COLLECTION_DEFERRED: '1' }, sleep: async () => {}, log: () => {}, fetch: async (_u: any, i: any) => { sent = JSON.parse(i.body); return ++calls < 3 ? json({}, 502) : json({ ok: true }); } }), true);
  assert.equal(calls, 3); assert.equal(sent.ok, false); assert.match(sent.error, /partial/);
});
test('a 200 without a heartbeat acknowledgement is not success', async () => {
  assert.equal(await sendHeartbeat({ env: { NODE_ENV: 'test' }, sleep: async () => {}, log: () => {}, fetch: async () => json({}) }), false);
});
test('billing blocks are actionable even without a runner, not harmless capacity failures', () => {
  const c = classifyRun({ conclusion: 'failure' }, [{ conclusion: 'failure', steps: [], runner_name: '' }], ['The job was not started because recent account payments have failed or your spending limit needs to be increased.']);
  assert.equal(c.kind, 'real');
  assert.equal(summarize([{ workflow: 'x', kind: c.kind, reason: c.reason, createdAt: '2026-10-29' }]).alert, true);
});
test('public backups have a separate required passphrase before export, with no job-key fallback', () => {
  const s = readFileSync('../.github/workflows/backup-user-data.yml', 'utf8');
  assert.doesNotMatch(s, /BACKUP_PASSPHRASE \|\|/);
  assert.ok(s.indexOf('Verify dedicated backup passphrase') < s.indexOf('Export including US book'));
});
