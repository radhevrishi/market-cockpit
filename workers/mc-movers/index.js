// ============================================================================
// mc-movers — Cloudflare Worker port of .github/scripts/scrape-movers-live.mjs
//
// WHY: GitHub Actions cron starvation. The "Refresh Movers (live intraday)"
// workflow is scheduled every 5 min during IST market hours, but GitHub fired
// only ~2 of ~75 runs on a bad day, so nse-movers-live:v1:latest went stale
// mid-session. Cloudflare Worker crons fire punctually.
//
// FAITHFUL PORT: same Upstash keys, same blob shape, same guards — the Railway
// /api/market/quotes route keeps working unchanged.
//   Reads:  nse-ticker-universe:v1:latest  (symbol list + cap + company + sector)
//   Writes: nse-movers-live:v1:latest      ({ generatedAt, source, count, tickers }, TTL 1h)
//           nse-movers-live:lastrun:v1     (small run summary, TTL 1 day — served at GET /)
//
// Secrets (wrangler secret put): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, RUN_SECRET
// Endpoints: GET / (last-run summary) · GET /run (Bearer RUN_SECRET — manual trigger)
// Subrequest budget: ~32 batches x up to 4 fetches + auth + KV ops — well under limits.
// ============================================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SYMBOL_CAP = 1600; // bound load/run-time (same default as MOVERS_SYMBOL_CAP in the .mjs)
const FRESH_TTL = 86400; // PATCH zzz231: live blob persists 24h so overnight/weekend keep last-close visible (post-close cron overwrites every 15 min)
const LASTRUN_TTL = 86400; // 1 day
const UNIVERSE_KEY = 'nse-ticker-universe:v1:latest';
const LIVE_KEY = 'nse-movers-live:v1:latest';
const LASTRUN_KEY = 'nse-movers-live:lastrun:v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function istNowParts() {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000);
  return { dow: t.getUTCDay(), mins: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// PATCH zzz231 — widened to also cover post-close capture window so the
// live blob keeps refreshing until 22:00 IST (previously stopped at 15:35).
// Mon-Fri 09:15-22:00 IST (intraday + post-close). Cron may overshoot at
// either end — the check keeps us Mon-Fri and inside the widened window.
function marketOpen() {
  const { dow, mins } = istNowParts();
  if (dow === 0 || dow === 6) return false;
  return mins >= 9 * 60 + 15 && mins <= 22 * 60;
}

// Kept for logs / diagnostics: strict intraday session (unchanged).
function marketOpenIntraday() {
  const { dow, mins } = istNowParts();
  if (dow === 0 || dow === 6) return false;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 35;
}

function kvBase(env) { return String(env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''); }

async function kvGetRaw(env, key) {
  const r = await fetch(kvBase(env) + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + env.UPSTASH_REDIS_REST_TOKEN },
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  let v = j && j.result;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} }
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} } // tolerate double-encoding
  return v;
}

async function kvSet(env, key, value, ttlSeconds) {
  const url = kvBase(env) + '/set/' + encodeURIComponent(key) + '?EX=' + ttlSeconds;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.UPSTASH_REDIS_REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error('Upstash SET ' + res.status + ' ' + t.slice(0, 200)); }
}

// ---- Yahoo spark (v7) — batch endpoint that still works without cookie/crumb.
// PATCH 1101xxx: the /v7/finance/quote endpoint started returning 401 from
// Cloudflare egress IPs (and from most servers since Aug 2024) even with the
// cookie+crumb dance. The /v7/finance/spark endpoint (max 20 symbols/call)
// still serves the same fields we need: regularMarketPrice, chartPreviousClose,
// regularMarketDayHigh/Low, regularMarketVolume, fiftyTwoWeekHigh/Low. No auth
// required. Smaller batches → more subrequests, but well within the paid
// Worker limit (1000) for our 1600-symbol cap (1600/20 = 80 batches).
async function yahooSparkBatch(symbols) {
  const url = 'https://query1.finance.yahoo.com/v7/finance/spark?symbols=' +
    encodeURIComponent(symbols.join(',')) + '&range=1d&interval=1d';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    const arr = j && j.spark && j.spark.result;
    if (!Array.isArray(arr)) return [];
    // Flatten to {symbol, regularMarketPrice, regularMarketPreviousClose, ...}
    // so the downstream parsing stays identical to the v7/quote shape.
    const out = [];
    for (const row of arr) {
      const resp = row && row.response && row.response[0];
      const meta = resp && resp.meta;
      if (!meta) continue;
      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose;
      out.push({
        symbol: meta.symbol || row.symbol,
        regularMarketPrice: price,
        regularMarketPreviousClose: prev,
        regularMarketChange: (price != null && prev != null) ? price - prev : null,
        regularMarketChangePercent: (price != null && prev) ? ((price - prev) / prev) * 100 : null,
        regularMarketVolume: meta.regularMarketVolume,
      });
    }
    return out;
  } catch { return []; }
}

function chunk(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

async function run(env, trigger) {
  const startedAt = Date.now();
  const summary = { ok: false, trigger: trigger || 'cron', startedAt: new Date().toISOString() };
  try {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      summary.error = 'missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN secrets';
      summary.durationMs = Date.now() - startedAt;
      console.log('mc-movers: FAILED — ' + summary.error);
      return summary;
    }

    // 1) universe (symbol list + cap + company + sector). Prioritise liquid caps.
    const uni = await kvGetRaw(env, UNIVERSE_KEY);
    const tickers = (uni && uni.tickers) || [];
    summary.universe = tickers.length;
    if (tickers.length < 50) {
      summary.error = 'universe blob missing/empty (' + tickers.length + ' tickers) — cannot build movers-live';
    } else {
      const capRank = { Large: 0, Mid: 1, Small: 2, Micro: 3 };
      const meta = new Map(); // SYM -> {company, sector, cap}
      for (const t of tickers) {
        const sym = String(t.ticker || t.symbol || '').trim().toUpperCase();
        if (!sym) continue;
        if (!meta.has(sym)) meta.set(sym, { company: t.company || t.name || sym, sector: t.industry || t.sector || '', cap: t.cap || 'Small' });
      }
      let syms = [...meta.keys()].sort((a, b) => (capRank[meta.get(a).cap] ?? 2) - (capRank[meta.get(b).cap] ?? 2));
      if (syms.length > SYMBOL_CAP) syms = syms.slice(0, SYMBOL_CAP); // cap to most-liquid by cap rank

      // 2) batched live quotes from Yahoo via /v7/finance/spark (no auth needed,
      // max 20 symbols/call). 1600/20 = 80 batches — within paid Worker limits.
      const batches = chunk(syms.map((s) => s + '.NS'), 20);
      const out = [];
      let okBatches = 0;
      for (let i = 0; i < batches.length; i++) {
        let res = await yahooSparkBatch(batches[i]);
        if (!res.length) { await sleep(800); res = await yahooSparkBatch(batches[i]); } // one retry per failed batch
        if (res.length) okBatches++;
        for (const q of res) {
          const sym = String(q.symbol || '').replace(/\.NS$/i, '').toUpperCase();
          const m = meta.get(sym);
          const price = q.regularMarketPrice;
          const prev = q.regularMarketPreviousClose;
          let pct = q.regularMarketChangePercent;
          if ((pct == null || !isFinite(pct)) && price != null && prev) pct = ((price - prev) / prev) * 100;
          if (sym && price != null && isFinite(price) && m) {
            out.push({
              ticker: sym, company: m.company, industry: m.sector, cap: m.cap,
              price: +price, previousClose: prev != null ? +prev : 0,
              change: q.regularMarketChange != null ? +q.regularMarketChange : (prev ? +(price - prev) : 0),
              changePercent: pct != null && isFinite(pct) ? +(+pct).toFixed(2) : 0,
              volume: q.regularMarketVolume != null ? +q.regularMarketVolume : 0,
              live: true,
            });
          }
        }
        await sleep(50); // be gentle with Yahoo (tighter pacing to fit 80 batches in budget)
      }

      summary.symbols = syms.length;
      summary.batches = batches.length;
      summary.okBatches = okBatches;
      summary.quotes = out.length;

      // Guards — identical to the .mjs: never overwrite KV with partial coverage.
      if (batches.length && okBatches / batches.length < 0.7) {
        summary.error = 'only ' + okBatches + '/' + batches.length + ' Yahoo batches succeeded (<70%) — refusing to overwrite KV';
      } else if (out.length < 50) {
        summary.error = 'only ' + out.length + ' live quotes — Yahoo likely unreachable/blocked. NOT overwriting KV';
      } else {
        const blob = { generatedAt: new Date().toISOString(), source: 'yahoo-live-cfw', count: out.length, tickers: out };
        await kvSet(env, LIVE_KEY, blob, FRESH_TTL);
        summary.ok = true;
        summary.generatedAt = blob.generatedAt;
      }
    }
  } catch (e) {
    summary.error = (e && e.message) || String(e);
  }
  summary.durationMs = Date.now() - startedAt;
  try { await kvSet(env, LASTRUN_KEY, summary, LASTRUN_TTL); } catch {}
  console.log('mc-movers: ' + (summary.ok
    ? 'wrote ' + LIVE_KEY + ' (' + summary.quotes + ' quotes, ' + summary.okBatches + '/' + summary.batches + ' batches, TTL ' + FRESH_TTL + 's)'
    : 'FAILED — ' + summary.error) + ' in ' + (summary.durationMs / 1000).toFixed(1) + 's');
  return summary;
}

export default {
  async scheduled(event, env, ctx) {
    if (!marketOpen()) { console.log('mc-movers: skipped — outside IST cover window (Mon-Fri 09:15-22:00)'); return; }
    ctx.waitUntil(run(env, 'cron'));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/run') {
      if (!env.RUN_SECRET) return new Response('RUN_SECRET not configured', { status: 503 }); // fail closed
      const auth = req.headers.get('authorization') || '';
      if (auth !== 'Bearer ' + env.RUN_SECRET) return new Response('unauthorized', { status: 401 });
      return Response.json(await run(env, 'manual'));
    }
    // PATCH 1101xxx: /probe — public read-only Yahoo connectivity check. Fetches
    // one spark batch (no KV writes, no secrets touched) so the deploy can be
    // verified end-to-end without RUN_SECRET. Safe to keep enabled.
    if (url.pathname === '/probe') {
      const sample = ['RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'SBIN.NS'];
      const t0 = Date.now();
      const res = await yahooSparkBatch(sample);
      return Response.json({
        ok: res.length === sample.length,
        endpoint: 'v7/finance/spark',
        requested: sample.length,
        returned: res.length,
        sample: res.slice(0, 2).map((q) => ({ symbol: q.symbol, price: q.regularMarketPrice, prev: q.regularMarketPreviousClose })),
        durationMs: Date.now() - t0,
      });
    }
    let last = null;
    try { last = await kvGetRaw(env, LASTRUN_KEY); } catch {}
    return Response.json({
      ok: true,
      worker: 'mc-movers',
      endpoints: ['GET / (this summary)', 'GET /run (Bearer RUN_SECRET — manual trigger)'],
      marketOpenIST: marketOpenIntraday(), coverWindow: marketOpen(),
      lastRun: last || null,
    });
  },
};
