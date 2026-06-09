// ============================================================================
// scrape-movers-live.mjs  (PATCH 1130 — the real fix for stale movers)
//
// THE PROBLEM this solves: live intraday quotes are fetched server-side from
// Railway, whose datacenter IP is blocked by Yahoo (yahoo:0). The route then
// falls back to ~12h-old BHAVCOPY (EOD) data → "movers are stale/incorrect".
//
// THE FIX: GitHub Actions runners have a clean IP that CAN reach Yahoo
// (already proven by scrape-mover-reasons.mjs hitting query2.finance.yahoo.com).
// This script runs intraday from that clean IP, pulls LIVE quotes for the
// liquid NSE universe, and writes them to KV (nse-movers-live:v1:latest).
// The /api/market/quotes route then serves this fresh blob during market hours.
//
// Reads:  nse-ticker-universe:v1:latest  (symbol list + cap + company + sector)
// Writes: nse-movers-live:v1:latest      ({ generatedAt, source, count, tickers })
// ============================================================================

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SYMBOL_CAP = parseInt(process.env.MOVERS_SYMBOL_CAP || '1600', 10); // bound load/run-time
const FRESH_TTL = 3600; // KV key auto-expires in 1h if the cron stops

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kvGetRaw(key) {
  const r = await fetch(`${KV_URL.replace(/\/+$/, '')}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }, cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  let v = j && j.result;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} }
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} } // tolerate double-encoding
  return v;
}

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Upstash SET ${res.status} ${t.slice(0, 200)}`); }
}

// ---- Yahoo auth (cookie + crumb) — the v7 batch-quote endpoint needs both ----
async function yahooAuth() {
  let cookie = '';
  for (const u of ['https://fc.yahoo.com/', 'https://finance.yahoo.com/']) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
      const sc = r.headers.get('set-cookie');
      if (sc) { cookie = sc.split(/,(?=[^ ;]+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; '); if (cookie) break; }
    } catch {}
  }
  let crumb = '';
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/plain' } });
    crumb = (await r.text()).trim();
  } catch {}
  return { cookie, crumb };
}

async function yahooBatch(symbols, auth) {
  const sym = symbols.join(',');
  const tryUrls = [];
  if (auth.crumb) tryUrls.push(`https://query1.finance.yahoo.com/v7/finance/quote?crumb=${encodeURIComponent(auth.crumb)}&symbols=${encodeURIComponent(sym)}`);
  tryUrls.push(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`);
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: auth.cookie, Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const arr = j && j.quoteResponse && j.quoteResponse.result;
      if (Array.isArray(arr) && arr.length) return arr;
    } catch {}
  }
  return [];
}

function chunk(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-movers-live @ ${new Date().toISOString()}`);

  // 1) universe (symbol list + cap + company + sector). Prioritise liquid caps.
  const uni = await kvGetRaw('nse-ticker-universe:v1:latest');
  const tickers = (uni && uni.tickers) || [];
  console.log(`  universe tickers: ${tickers.length}`);
  if (tickers.length < 50) { console.error('::error::universe blob missing/empty; cannot build movers-live'); process.exit(1); }

  const capRank = { Large: 0, Mid: 1, Small: 2, Micro: 3 };
  const meta = new Map(); // SYM -> {company, sector, cap}
  for (const t of tickers) {
    const sym = (t.ticker || t.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    if (!meta.has(sym)) meta.set(sym, { company: t.company || t.name || sym, sector: t.industry || t.sector || '', cap: t.cap || 'Small' });
  }
  let syms = [...meta.keys()].sort((a, b) => (capRank[meta.get(a).cap] ?? 2) - (capRank[meta.get(b).cap] ?? 2));
  if (syms.length > SYMBOL_CAP) { console.log(`  capping ${syms.length} → ${SYMBOL_CAP} most-liquid (by cap rank)`); syms = syms.slice(0, SYMBOL_CAP); }

  // 2) auth + batched live quotes from Yahoo (clean GH IP)
  const auth = await yahooAuth();
  console.log(`  yahoo auth: cookie=${auth.cookie ? 'yes(' + auth.cookie.length + ')' : 'NO'} crumb=${auth.crumb ? 'yes(' + auth.crumb.length + ')' : 'NO'}`);

  const batches = chunk(syms.map((s) => `${s}.NS`), 50);
  const out = [];
  let okBatches = 0;
  for (let i = 0; i < batches.length; i++) {
    const res = await yahooBatch(batches[i], auth);
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
    if (i % 5 === 0) console.log(`  batch ${i + 1}/${batches.length} — cumulative ${out.length} live quotes`);
    await sleep(150); // be gentle with Yahoo
  }

  console.log(`  RESULT: ${out.length} live quotes from ${okBatches}/${batches.length} batches`);
  if (out.length < 50) {
    console.error(`::error title=Live fetch failed::Only ${out.length} live quotes — Yahoo likely unreachable/blocked from this runner. NOT overwriting KV.`);
    process.exit(1);
  }

  const gainers = [...out].filter((x) => x.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);
  const losers = [...out].filter((x) => x.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);
  console.log(`  gainers=${gainers.length} losers=${losers.length}`);
  if (gainers[0]) console.log(`  top gainer: ${gainers[0].ticker} ${gainers[0].changePercent}% @ ${gainers[0].price}`);
  if (losers[0]) console.log(`  top loser:  ${losers[0].ticker} ${losers[0].changePercent}% @ ${losers[0].price}`);

  const blob = { generatedAt: new Date().toISOString(), source: 'yahoo-live-gh', count: out.length, tickers: out };
  await kvSet('nse-movers-live:v1:latest', blob, FRESH_TTL);
  console.log(`✓ wrote nse-movers-live:v1:latest (${out.length} tickers, TTL ${FRESH_TTL}s) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error('::error title=movers-live crashed::' + (e && e.message)); process.exit(1); });
