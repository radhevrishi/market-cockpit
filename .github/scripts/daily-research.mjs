// ═══════════════════════════════════════════════════════════════════════════
// DAILY RESEARCH — AI Daily Gainers + Portfolio Catalysts, unattended. (zzz773)
//
// Does exactly what the owner's clicks do, on a schedule, against the live
// app — no secrets needed, no new server code:
//   gainers-in / gainers-us : read the board fresh, research every name,
//                             then retry the names whose filing source failed.
//   portfolio               : ask the exchange feed which holdings reported in
//                             the last few days and read only those
//                             (incremental: a holding with nothing new costs
//                             no model call).
// Model spend stays bounded by the server's own daily ceilings.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = (process.env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, '');
const JOB = process.argv[2] || 'gainers-in';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, init = {}, timeoutMs = 90_000, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const r = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      if (r.ok && j) return j;
      console.log(`  ${path.split('?')[0]} → HTTP ${r.status} (attempt ${attempt})`);
    } catch (e) { console.log(`  ${path.split('?')[0]} → ${e?.name === 'TimeoutError' ? 'timeout' : e?.message || e} (attempt ${attempt})`); }
    await sleep(5_000 * attempt);
  }
  return null;
}

// ── screener.in pre-fetch ────────────────────────────────────────────────
// screener.in answers GitHub's network directly but times out the proxy
// Worker under load. Each board name's company page and price chart are
// fetched here and filed in KV under the exact URL the app asks for; the app
// reads them first (lib/earnings/screener-fetch.ts, 'kv' hop, < 10h old).
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const bare = (t) => String(t || '').toUpperCase().trim().replace(/-(BE|BZ|SM|ST|BL|IL|GS|SZ|E1|N[0-9A-Z])$/, '');
async function kvPut(key, value, ttl) {
  const r = await fetch(`${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttl}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`KV HTTP ${r.status}`);
}
async function grab(url, accept) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url, { headers: { ...UA, Accept: accept }, signal: AbortSignal.timeout(20_000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(3_000 * (k + 1));
  }
  return null;
}
async function prefetchScreener(tickers) {
  if (!KV_URL || !KV_TOKEN) { console.log('  pre-fetch skipped: KV secrets not set'); return; }
  let pages = 0, charts = 0, miss = 0;
  for (const t of tickers) {
    const url = `https://www.screener.in/company/${encodeURIComponent(bare(t))}/`;
    const html = await grab(url, 'text/html');
    if (!html || html.length < 5000) { miss++; continue; }
    const at = new Date().toISOString();
    try { await kvPut(`scr-page:v1:${url}`, { html, at }, 36_000); pages++; } catch (e) { console.log(`  kv ${t}: ${e.message}`); }
    const id = (/data-company-id="(\d+)"/.exec(html) || /\/company\/(\d+)\/chart/.exec(html) || [])[1];
    if (id) {
      const cu = `https://www.screener.in/api/company/${id}/chart/?q=Price&days=365`;
      const js = await grab(cu, 'application/json');
      if (js && js.trim().startsWith('{')) { try { await kvPut(`scr-page:v1:${cu}`, { html: js, at }, 36_000); charts++; } catch { /* next */ } }
    }
    await sleep(1_200);
  }
  console.log(`  pre-fetched ${pages} pages · ${charts} charts · ${miss} not answered`);
}

const tally = (findings) => {
  const c = {};
  for (const f of Object.values(findings || {})) c[f.status] = (c[f.status] || 0) + 1;
  return c;
};

async function gainers(market) {
  console.log(`▶ gainers ${market}: reading the board fresh`);
  const scan = await call(`/api/v1/ai-gainers?market=${market}&limit=15&fresh=1`, {}, 120_000);
  const scanned = scan?.scanned || [];
  if (!scanned.length) { console.log(`::warning title=gainers ${market}::no gainers list was read — nothing researched`); return; }
  const rows = scanned.map((g) => ({ ticker: g.ticker, company: g.company, move_pct: g.move_pct, volume: g.volume ?? null, price: g.price ?? null, market_cap: g.market_cap ?? null, perf: g.perf ?? null, filed_result: !!g.matched }));
  console.log(`  board: ${rows.length} names`);
  if (market === 'IN') await prefetchScreener(rows.map((r) => r.ticker));
  let last = null;
  for (let i = 0; i < 30; i++) {
    const j = await call('/api/v1/ai-gainers/research', { method: 'POST', body: JSON.stringify({ market, rows: i === 0 ? rows : [], budget_ms: 40_000, ...(i === 0 && process.env.REPROCESS === '1' ? { reprocess: true } : {}) }) }, 110_000, 1);
    if (!j) { await sleep(10_000); continue; }
    last = j;
    console.log(`  pass ${i + 1}: researched ${j.researched_now ?? '?'} · remaining ${j.remaining} · ${JSON.stringify(tally(j.findings))}`);
    if (!j.remaining || j.researched_now === 0) break;
  }
  // A source that refused under the burst usually answers a little later.
  for (let k = 0; k < 3 && last && Object.values(last.findings || {}).some((f) => f.status === 'source_failed'); k++) {
    await sleep(20_000 * (k + 1));
    const j = await call('/api/v1/ai-gainers/research', { method: 'POST', body: JSON.stringify({ market, rows: [], budget_ms: 40_000, retry_failed: true }) }, 110_000, 1);
    if (!j) break;
    last = j;
    console.log(`  retry ${k + 1}: ${JSON.stringify(tally(j.findings))}`);
  }
  const t = tally(last?.findings);
  console.log(`::notice title=gainers ${market}::${JSON.stringify(t)} · model reads today ${last?.model_reads ?? '?'}`);
}

async function portfolio(days = 4) {
  console.log(`▶ portfolio: holdings that reported in the last ${days} days`);
  const st = await call('/api/v1/book/state', {}, 30_000);
  const all = (st?.book?.tickers || []).filter((t) => t.held || t.benched).map((t) => String(t.ticker).toUpperCase());
  const india = all.filter((t) => /^[A-Z0-9&.\-]{1,24}$/.test(t) && !t.includes('.US'));
  if (!india.length) { console.log('::warning title=portfolio::book is empty or unreadable'); return; }
  const rr = await call(`/api/v1/thesis/recent-reporters?days=${days}&tickers=${encodeURIComponent(india.join(','))}`, {}, 90_000);
  const reported = Array.isArray(rr?.reported) ? rr.reported : [];
  console.log(`  ${india.length} Indian holdings · ${reported.length} reported (feed items ${rr?.feed?.items ?? '?'})`);
  let read = 0, skipped = 0, failed = 0;
  for (const r of reported) {
    const t = String(r.ticker || '').toUpperCase();
    const fd = String(r.reported_at || r.filing_date || '').slice(0, 10);
    const q = `/api/v1/india/ai-summary?ticker=${encodeURIComponent(t)}${/^\d{4}-\d{2}-\d{2}$/.test(fd) ? `&filing_date=${fd}` : ''}&mode=incremental&ocr=1`;
    const j = await call(q, {}, 170_000);
    if (!j) { failed++; console.log(`  ${t}: no answer`); continue; }
    if (j.skipped) { skipped++; console.log(`  ${t}: nothing new`); }
    else if (j.ok) { read++; console.log(`  ${t}: read ${j.period || ''}`); }
    else { failed++; console.log(`  ${t}: ${String(j.error || 'failed').slice(0, 120)}`); }
    await sleep(2_000);
  }
  console.log(`::notice title=portfolio::${reported.length} reported · ${read} read · ${skipped} unchanged · ${failed} failed`);
}

if (JOB === 'gainers-in') await gainers('IN');
else if (JOB === 'gainers-us') await gainers('US');
else if (JOB === 'portfolio') await portfolio();
else { console.log(`unknown job ${JOB}`); process.exit(1); }
