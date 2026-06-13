// mc-alerts — server-side buy-zone alerts (works even with the browser closed).
// Configure zones once via POST /zones (Bearer ALERT_SECRET), then the cron
// checks the index every 5 min during IST market hours and Telegrams you when
// price enters an un-triggered zone. A zone re-arms after a 2% recovery.
// Secrets: ALERT_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// Endpoints: GET / (help+state) · GET /zones · POST /zones · GET /check (manual run).

// 10y-ops Section 7.3: portal URL is env-overridable. When migrating off
// Railway, set PORTAL_URL via `wrangler secret put PORTAL_URL` — no code change.
const PORTAL_FALLBACK = 'https://market-cockpit-production.up.railway.app';

function getPortal(env) {
  return (env && env.PORTAL_URL) || PORTAL_FALLBACK;
}

function istNowParts() {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000);
  return { dow: t.getUTCDay(), mins: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

function marketOpen() {
  const { dow, mins } = istNowParts();
  if (dow === 0 || dow === 6) return false;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

async function priceFromYahoo(symbol) {
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1m&range=1d', {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
    const p = m && m.regularMarketPrice;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch { return null; }
}

async function priceFromPortal(env, matchRe) {
  try {
    const r = await fetch(getPortal(env) + '/api/market/indices', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const pools = [];
    if (Array.isArray(j)) pools.push(j);
    if (j && typeof j === 'object') for (const v of Object.values(j)) if (Array.isArray(v)) pools.push(v);
    for (const arr of pools) {
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        const label = String(it.name || it.label || it.symbol || it.index || '');
        if (!matchRe.test(label)) continue;
        const p = Number(it.price || it.last || it.value || it.ltp || it.close);
        if (p > 0) return p;
      }
    }
    return null;
  } catch { return null; }
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

async function check(env, manual) {
  if (!manual && !marketOpen()) return { skipped: 'market closed (IST)' };
  const cfg = await env.KV.get('alerts:config:india', 'json');
  if (!cfg || !Array.isArray(cfg.zones) || cfg.zones.length === 0) return { skipped: 'no zones configured — POST /zones' };
  const name = cfg.name || 'Nifty Midcap 50';
  let price = await priceFromPortal(env, new RegExp(cfg.match || 'midcap', 'i'));
  let source = 'portal';
  if (!price) { price = await priceFromYahoo(cfg.symbol || '^NSEMDCP50'); source = 'yahoo'; }
  if (!price) {
    await tg(env, '⚠️ mc-alerts: could not fetch ' + name + ' price from portal or Yahoo.');
    return { error: 'no price' };
  }
  const state = (await env.KV.get('alerts:state:india', 'json')) || { triggered: {} };
  const fired = [];
  for (const z of cfg.zones) {
    const entry = Number(z.entry);
    if (!(entry > 0)) continue;
    const key = String(entry);
    if (price <= entry && !state.triggered[key]) {
      state.triggered[key] = new Date().toISOString();
      fired.push(z);
    } else if (state.triggered[key] && price > entry * 1.02) {
      delete state.triggered[key];
    }
  }
  if (fired.length) {
    await tg(env, '🎯 BUY ZONE HIT — ' + name + ' at ' + price.toLocaleString('en-IN') + '\n' +
      fired.map((z) => '• ' + (z.label || z.entry)).join('\n') + '\n' + getPortal(env) + '/buy-strategy');
  }
  state.lastPrice = price; state.lastSource = source; state.lastAt = new Date().toISOString();
  await env.KV.put('alerts:state:india', JSON.stringify(state));
  return { price, source, fired: fired.length, armedZones: cfg.zones.length, triggered: Object.keys(state.triggered) };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(check(env, false)); },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/zones') {
      if (req.method === 'POST') {
        const auth = req.headers.get('authorization') || '';
        if (!env.ALERT_SECRET || auth !== 'Bearer ' + env.ALERT_SECRET) return new Response('unauthorized', { status: 401 });
        const body = await req.json().catch(() => null);
        if (!body || !Array.isArray(body.zones)) return new Response('expected { zones: [{entry, label}] }', { status: 400 });
        await env.KV.put('alerts:config:india', JSON.stringify(body));
        return Response.json({ ok: true, zones: body.zones.length });
      }
      const cfg = await env.KV.get('alerts:config:india', 'json');
      return Response.json(cfg || { note: 'no zones configured — POST /zones with Authorization: Bearer ALERT_SECRET' });
    }
    if (url.pathname === '/check') return Response.json(await check(env, true));
    const state = await env.KV.get('alerts:state:india', 'json');
    return Response.json({ ok: true, endpoints: ['GET /zones', 'POST /zones (Bearer ALERT_SECRET)', 'GET /check'], state: state || null });
  },
};
