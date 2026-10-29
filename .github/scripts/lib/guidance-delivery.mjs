// Durable delivery of PUBLIC company documents. No credentials or portfolio data are journalled.
// The journal stays in Redis, never in public Actions artifacts/caches. Payloads expire after 30 days.
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const ENQUEUE_LUA = "redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); redis.call('SADD',KEYS[2],ARGV[3]); redis.call('EXPIRE',KEYS[2],ARGV[2]); return 1";
export const ACK_LUA = "redis.call('SREM',KEYS[2],ARGV[1]); redis.call('DEL',KEYS[1]); return 1";

export function createGuidanceDelivery({ fetch: f, env = process.env, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  const base = (env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, '');
  const redis = env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '');
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const durable = !!(redis && token);
  const ttl = 30 * 86400;
  async function command(args) {
    const r = await f(redis, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Delivery journal HTTP ${r.status}`);
    const j = await r.json();
    if (j.error || !Object.hasOwn(j, 'result')) throw new Error('Delivery journal refused command');
    return j.result;
  }
  const queue = (market) => `collector-delivery:v1:${market}`;
  const key = (market, id) => `${queue(market)}:item:${id}`;
  async function enqueue(payload, quarantine = false) {
    if (!durable || !(payload.docs?.length || payload.seen?.length || payload.intimations?.length)) return null;
    // Coverage/status are NOT replayed: a later run must calculate coverage from its own successful reads.
    const { coverage, status, ...body } = payload;
    const id = createHash('sha256').update(JSON.stringify(body, (k, v) => k === 'collectedAt' ? undefined : v)).digest('hex');
    const text = gzipSync(Buffer.from(JSON.stringify(body))).toString('base64');
    if (Buffer.byteLength(text) > 900000) throw new Error('Delivery journal batch exceeds 900 KB compressed; reduce collector batch size');
    // Atomically persist both payload and membership before any network delivery.
    const market = quarantine ? `${body.market}:review` : body.market;
    await command(['EVAL', ENQUEUE_LUA, 2, key(market, id), queue(market), text, ttl, id]);
    return id;
  }
  async function acknowledge(market, id) {
    if (!id) return;
    await command(['EVAL', ACK_LUA, 2, key(market, id), queue(market), id]);
  }
  async function send(payload) {
    let status = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await f(`${base}/api/v1/guidance-docs/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.CRON_SECRET || '' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
        status = r.status;
        if (r.ok) {
          const j = await r.json().catch(() => null);
          const rejected = Array.isArray(j?.rejected) ? j.rejected.length : 0;
          const expected = new Set((payload.docs || []).map((d) => d.docId)).size;
          const complete = j?.ok === true && rejected === 0 && Number(j.stored) === expected;
          if (complete) return { ok: true, status, stored: j.stored, rejected: 0 };
          // A 200 with rejected/missing documents is NOT an acknowledgement of the whole batch.
          return { ok: false, status, rejected, incomplete: true, rejectedRows: j?.rejected, stored: j?.stored, validEnvelope: j?.ok === true };
        }
        if (r.status !== 429 && r.status < 500) return { ok: false, status };
        await r.body?.cancel?.();
      } catch { status = 0; }
      if (attempt < 3) await sleep(3000 * 2 ** attempt);
    }
    return { ok: false, status };
  }
  async function quarantineRejected(payload, result, id) {
    const rejected = result.rejectedRows;
    if (!durable || !result.validEnvelope || !Array.isArray(rejected) || !rejected.length) return false;
    const indexes = new Set(rejected.map((r) => r.i));
    if ([...indexes].some((i) => !Number.isInteger(i) || i < 0 || i >= payload.docs.length)) return false;
    const accepted = new Set(payload.docs.filter((_, i) => !indexes.has(i)).map((d) => d.docId)).size;
    if (Number(result.stored) !== accepted) return false;
    // Keep rejected public documents for inspection without blocking all new market collection forever.
    await enqueue({ market: payload.market, collector: payload.collector, docs: payload.docs.filter((_, i) => indexes.has(i)) }, true);
    await acknowledge(payload.market, id);
    log(`::error::${indexes.size} rejected documents retained in the market delivery review queue; accepted documents acknowledged.`);
    return true;
  }
  return {
    durable,
    async post(payload) {
      if (env.DRY_RUN === '1') return { ok: true, status: 200, stored: payload.docs?.length || 0 };
      const id = await enqueue(payload);
      const result = await send(payload);
      if (result.ok) await acknowledge(payload.market, id);
      else if (await quarantineRejected(payload, result, id)) result.quarantined = true;
      else log(`ingest not acknowledged: HTTP ${result.status}; ${id ? 'journalled for retry' : 'source must be re-read'}${result.incomplete ? '; incomplete response' : ''}`);
      return result;
    },
    async replay(market) {
      if (!durable || env.DRY_RUN === '1') return { attempted: 0, recovered: 0, pending: 0 };
      const ids = await command(['SMEMBERS', queue(market)]);
      if (!Array.isArray(ids)) throw new Error('Delivery journal index malformed');
      let attempted = 0, recovered = 0, expired = 0;
      for (const id of ids.slice(0, 20)) {
        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Delivery journal ID malformed');
        const text = await command(['GET', key(market, id)]);
        if (text == null) {
          log('::warning::A delivery journal entry expired; reconcile source coverage before claiming recovery.');
          await command(['SREM', queue(market), id]);
          expired++;
          continue;
        }
        const body = JSON.parse(gunzipSync(Buffer.from(text, 'base64'), { maxOutputLength: 6 * 1024 * 1024 }).toString());
        if (body.market !== market || !Array.isArray(body.docs)) throw new Error('Delivery journal payload malformed');
        attempted++;
        const result = await send(body);
        if (!result.ok) {
          if (await quarantineRejected(body, result, id)) continue;
          break; // do not hammer a redeploying application with every pending batch
        }
        await acknowledge(market, id); recovered++;
      }
      const pending = Number(await command(['SCARD', queue(market)]));
      log(`delivery recovery: ${recovered} batches acknowledged, ${pending} pending`);
      if (expired) throw new Error(`${expired} delivery journal entries expired; reconcile the original sources before claiming recovery`);
      return { attempted, recovered, pending };
    },
  };
}
