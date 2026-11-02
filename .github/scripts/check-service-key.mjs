import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// zzz1210 — run before a collector that uploads with x-cron-secret. Writes key_ok=1|0 to GITHUB_OUTPUT.
// key accepted → key_ok=1. Key refused → key_ok=0; the first refusal of the UTC day fails this step with the fix written
// out (one e-mail a day, not one per run); later runs that day pass with a warning and the collector is skipped.
// App unreachable / unknown answer → key_ok=1 (the collector runs and reports its own result). Never prints the key.
export async function checkServiceKey({ env = process.env, fetch: f = fetch, log = console.log } = {}) {
  const base = (env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, '');
  const job = String(env.JOB_NAME || '').replace(/[^a-z0-9-]/gi, '');
  if (!env.CRON_SECRET) {
    log('::error title=Missing secret::Add CRON_SECRET in GitHub → Settings → Secrets and variables → Actions (same value as CRON_SECRET on Railway).');
    return { ok: false, fail: true };
  }
  for (let i = 0; i < 2; i++) {
    try {
      const r = await f(`${base}/api/v1/service-key-check?job=${encodeURIComponent(job)}`, { headers: { 'x-cron-secret': env.CRON_SECRET }, signal: AbortSignal.timeout(15000) });
      if (r.status === 200) { log('service key accepted'); return { ok: true, fail: false }; }
      if (r.status === 401) {
        const j = await r.json().catch(() => null);
        const msg = 'The CRON_SECRET saved in GitHub is not a key the app accepts, so nothing can be uploaded. Fix: copy CRON_SECRET from Railway (service → Variables) into GitHub → Settings → Secrets and variables → Actions → CRON_SECRET. Collectors are skipped until then.';
        if (j?.firstToday === false) { log(`::warning title=Service key mismatch (reported earlier today)::${msg}`); return { ok: false, fail: false }; }
        log(`::error title=Service key mismatch::${msg}`);
        return { ok: false, fail: true };
      }
      if (r.status === 404) { log('key check not deployed yet; running the collector'); return { ok: true, fail: false }; }
    } catch { /* retry once, then let the collector try */ }
  }
  log('app not reachable for the key check; running the collector');
  return { ok: true, fail: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkServiceKey().then((r) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `key_ok=${r.ok ? 1 : 0}\n`);
    if (r.fail) process.exitCode = 1;
  }).catch(() => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'key_ok=1\n'); });
}
