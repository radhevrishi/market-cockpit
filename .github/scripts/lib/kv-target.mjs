// zzz1230 — the app now keeps its key-value data in its own PostgreSQL (no per-command Upstash bill). Collectors keep their
// Upstash REST code and secrets; this points UPSTASH_REDIS_REST_URL at the app's Upstash-compatible relay
// (/api/v1/kv-rest, same token) when the app answers that it stores in Postgres. If the relay cannot be reached, or the app
// is still on Upstash, nothing changes and the collector writes to Upstash as before. KV_TARGET=upstash forces the old path.
export async function applyKvTarget(env = process.env) {
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  if (!token || env.KV_TARGET === 'upstash') return 'upstash';
  const relay = String(env.MC_KV_RELAY_URL || 'https://market-cockpit-production.up.railway.app/api/v1/kv-rest').replace(/\/+$/, '');
  try {
    const r = await fetch(`${relay}/ping`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const j = r.ok ? await r.json().catch(() => null) : null;
    if (j && j.result === 'PONG' && j.backend === 'pg') {
      env.UPSTASH_REDIS_REST_URL = relay;
      env.KV_REST_API_URL = relay;
      if (!env.UPSTASH_REDIS_REST_TOKEN) env.UPSTASH_REDIS_REST_TOKEN = token;
      console.log(`key-value store: app relay (${relay})`);
      return 'relay';
    }
    console.log(`key-value store: Upstash (relay answered ${r.status}${j?.backend ? `, backend ${j.backend}` : ''})`);
  } catch (e) {
    console.log(`key-value store: Upstash (relay not reachable: ${String(e?.message || e).slice(0, 80)})`);
  }
  return 'upstash';
}
