// zzz1055 — FII / DII collector (fallback). The app's own scheduler job `fii-dii` (frontend/src/lib/fii-dii/job.ts) fetches
// NSE + NSDL itself; this script exists for when NSE or NSDL refuse the app host. It asks the app what it already has, fetches
// only what is missing from GitHub's network and POSTs the RAW pages to /api/v1/fii-dii (the app parses — one parser).
//
// Env: CRON_BASE_URL (default production), CRON_SECRET (service key), optional PROXY_URL + PROXY_SECRET (mc-proxy relay).
// Exit 0 = done / nothing to do; 75 = upstream not available or not published yet (deferred); 1 = our side failed.

const BASE = (process.env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/$/, '');
const KEY = process.env.CRON_SECRET || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const NSE_API = 'https://www.nseindia.com/api/fiidiiTradeReact';
const NSDL_LATEST = 'https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx';
const NSDL_SECTOR_LIST = 'https://www.fpi.nsdl.co.in/web/Reports/FPI_Fortnightly_Selection.aspx';
const SECTOR_BASE = 'https://www.fpi.nsdl.co.in/web/StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/';

if (!KEY) { console.error('CRON_SECRET is not set'); process.exit(1); }

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const t = (ms) => AbortSignal.timeout(ms);

async function nseJson() {
  try {
    const home = await fetch('https://www.nseindia.com/reports/fii-dii', { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: t(20_000) });
    const cookie = (home.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    const r = await fetch(NSE_API, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.nseindia.com/reports/fii-dii', ...(cookie ? { Cookie: cookie } : {}) }, signal: t(20_000) });
    if (r.ok) return await r.json();
    console.log(`NSE direct HTTP ${r.status}`);
  } catch (e) { console.log(`NSE direct failed: ${e.message}`); }
  if (process.env.PROXY_URL && process.env.PROXY_SECRET) {
    try {
      const u = `${process.env.PROXY_URL.replace(/\/$/, '')}/proxy?url=${encodeURIComponent(NSE_API)}&secret=${encodeURIComponent(process.env.PROXY_SECRET)}`;
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: t(20_000) });
      if (r.ok) return await r.json();
      console.log(`NSE relay HTTP ${r.status}`);
    } catch (e) { console.log(`NSE relay failed: ${e.message}`); }
  }
  return null;
}

async function text(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: t(30_000) });
    if (r.ok) return await r.text();
    console.log(`${url} HTTP ${r.status}`);
  } catch (e) { console.log(`${url} failed: ${e.message}`); }
  return null;
}

async function main() {
  let have = null;
  try {
    const r = await fetch(`${BASE}/api/v1/fii-dii?range=1M`, { signal: t(30_000) });
    if (r.ok) have = await r.json();
  } catch (e) { console.log(`app read failed: ${e.message}`); }
  const today = istToday();
  const haveToday = have?.today?.date === today && have?.today?.source === 'nse';

  const body = {};
  if (!haveToday) {
    const j = await nseJson();
    if (j) body.nse = j;
  }
  const latest = await text(NSDL_LATEST);
  if (latest) body.nsdlDaily = [latest];

  const list = await text(NSDL_SECTOR_LIST);
  if (list) {
    const m = /<option[^>]*value="[^"]*Fortnightly_Sector_wise_FII_Investment_Data\/([^"]+\.html?)"/i.exec(list);
    if (m) {
      // re-sending a report the app already has is harmless (stored by report date + sector)
      const html = await text(SECTOR_BASE + m[1]);
      if (html) body.sectorReports = [html];
    }
  }

  if (!Object.keys(body).length) { console.log('nothing fetched'); process.exit(haveToday ? 0 : 75); }
  const r = await fetch(`${BASE}/api/v1/fii-dii`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': KEY }, body: JSON.stringify(body), signal: t(120_000) });
  const out = await r.text();
  console.log(`ingest HTTP ${r.status}: ${out.slice(0, 400)}`);
  if (!r.ok) process.exit(1);
  const res = JSON.parse(out);
  if (!haveToday && res.nse !== today) { console.log(`NSE figures for ${today} not out yet (got ${res.nse})`); process.exit(75); }
}

main().catch((e) => { console.error(e); process.exit(1); });
