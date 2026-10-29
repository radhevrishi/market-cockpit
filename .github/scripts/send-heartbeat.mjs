import { pathToFileURL } from 'node:url';

// Report delivery independently of collection. Never print credentials, response bodies or source payloads.
export async function sendHeartbeat({ env = process.env, fetch: f = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  const base = (env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, '');
  const deferred = env.COLLECTION_DEFERRED === '1';
  const ok = env.COLLECTION_OUTCOME === 'success' && !deferred;
  const body = { name: env.JOB_NAME, phase: 'end', ok, ...(deferred ? { error: 'deferred: partial or unavailable source; stored data retained' } : {}), run_url: env.RUN_URL };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await f(`${base}/api/v1/cron/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const j = r.ok ? await r.json().catch(() => null) : null;
      if (r.ok && j?.ok === true) { log(`heartbeat delivered (collection ${ok ? 'complete' : deferred ? 'partial/deferred' : 'failed'})`); return true; }
      log(`heartbeat delivery HTTP ${r.status}${r.ok ? ' without acknowledgement' : ''}`);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    } catch { log('heartbeat delivery unavailable'); }
    if (i < 2) await sleep(1000 * 2 ** i);
  }
  log('::error title=Heartbeat delivery failed::Collection and heartbeat are separate checks. See the collection step for whether data was stored.');
  return false;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  sendHeartbeat().then((ok) => { if (!ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; });
}
