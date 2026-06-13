// mc-guardian — uptime & freshness monitor for Market Cockpit.
// Cron: every 10 minutes. Alerts via Telegram on NEW failures and on recovery
// (no repeat spam). State lives in KV. Manual run: GET /run. Status: GET /.
// Secrets (wrangler secret put ...): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.

// 10y-ops Section 7.3: portal URL is env-overridable. When migrating off
// Railway, set PORTAL_URL via `wrangler secret put PORTAL_URL` — no code change.
const BASE_FALLBACK = 'https://market-cockpit-production.up.railway.app';
function getBase(env) { return (env && env.PORTAL_URL) || BASE_FALLBACK; }

function makeProbes(BASE) { return [
  { name: 'home', url: BASE + '/', type: 'html', mustInclude: 'Market Cockpit' },
  { name: 'news-feed', url: BASE + '/api/v1/news?market=all&limit=5', type: 'json',
    check: (j) => (Array.isArray(j) ? j : (j && (j.articles || j.items)) || []).length > 0, desc: 'no articles returned' },
  { name: 'quotes', url: BASE + '/api/market/quotes?market=india', type: 'json',
    check: (j) => (((j && j.stocks) || []).length + ((j && j.gainers) || []).length) > 0, desc: 'no stocks in payload' },
  { name: 'in-play', url: BASE + '/api/v1/news/in-play', type: 'json', check: () => true, desc: 'bad response' },
  { name: 'corp-filings', url: BASE + '/api/market/corporate-orders', type: 'json', check: () => true, desc: 'bad response' }, // workers.dev-to-workers.dev fetches are blocked, so probe the portal route that consumes mc-scraper
  // 10y-ops Section 7.3: cron-runs heartbeat health. Any cron silent for >25h becomes stale_count>0.
  // The body lists which cron names went stale so the alert is actionable.
  { name: 'cron-heartbeats', url: BASE + '/api/v1/cron/health', type: 'json',
    check: (j) => !j || j.stale_count === 0,
    desc: 'stale cron heartbeats',
    detail: (j) => {
      if (!j || !Array.isArray(j.rows)) return '';
      const stale = j.rows.filter((r) => r.stale).map((r) => r.name);
      return stale.length ? ' (' + stale.join(', ') + ')' : '';
    },
  },
]; }

async function probeOne(p) {
  const t0 = Date.now();
  try {
    const r = await fetch(p.url, { headers: { 'user-agent': 'mc-guardian/1.0' }, signal: AbortSignal.timeout(20000) });
    const ms = Date.now() - t0;
    if (!r.ok) return { name: p.name, ok: false, why: 'HTTP ' + r.status, ms };
    if (p.type === 'json') {
      const j = await r.json().catch(() => null);
      if (!j) return { name: p.name, ok: false, why: 'invalid JSON', ms };
      if (p.check && !p.check(j)) return { name: p.name, ok: false, why: (p.desc || 'check failed') + (p.detail ? p.detail(j) : ''), ms };
    } else {
      const t = await r.text();
      if (p.mustInclude && !t.includes(p.mustInclude)) return { name: p.name, ok: false, why: 'marker missing', ms };
    }
    return { name: p.name, ok: true, ms };
  } catch (e) {
    return { name: p.name, ok: false, why: String((e && e.message) || e).slice(0, 120), ms: Date.now() - t0 };
  }
}

async function tg(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    return true;
  } catch { return false; }
}

async function run(env) {
  const BASE = getBase(env);
  const PROBES = makeProbes(BASE);
  const results = await Promise.all(PROBES.map(probeOne));
  const failures = results.filter((r) => !r.ok);
  const prev = (await env.KV.get('guardian:state', 'json')) || { failing: [] };
  const prevFailing = new Set(prev.failing || []);
  const nowFailing = failures.map((f) => f.name);
  const newFails = failures.filter((f) => !prevFailing.has(f.name));
  const recovered = [...prevFailing].filter((n) => !nowFailing.includes(n));
  let notified = false;
  if (newFails.length) {
    notified = await tg(env, '🔴 Market Cockpit guardian:\n' + newFails.map((f) => '• ' + f.name + ' — ' + f.why).join('\n'));
  }
  if (recovered.length) {
    notified = (await tg(env, '🟢 Recovered: ' + recovered.join(', '))) || notified;
  }
  const state = { at: new Date().toISOString(), failing: nowFailing, results, notified };
  await env.KV.put('guardian:state', JSON.stringify(state), { expirationTtl: 7 * 86400 });
  return state;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/run') return Response.json(await run(env));
    const state = await env.KV.get('guardian:state', 'json');
    return Response.json(state || { ok: true, note: 'no runs yet — hit /run or wait for the cron' });
  },
};
