// zzz1055 — FII / DII collector (fallback). The app's own scheduler job `fii-dii` (frontend/src/lib/fii-dii/job.ts) fetches
// NSE + NSDL itself; this script exists for when NSE or NSDL refuse the app host. It asks the app what it already has, fetches
// only what is missing from GitHub's network and POSTs the RAW pages to /api/v1/fii-dii (the app parses — one parser).
// zzz1060: also NSE participant-wise OI files, and — while the app's `status` says a history backfill is unfinished — NSDL
// archive months (continuing the app's cursor), a year of participant-OI files and the older sector reports.
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
  // zzz1060: before ~18:30 IST (or at the weekend) today's NSE figures cannot exist yet — the early-morning backfill run
  // must not end as "deferred" just because of that.
  const ist = new Date(Date.now() + 330 * 60_000);
  const notDueYet = ist.getUTCDay() === 0 || ist.getUTCDay() === 6 || ist.getUTCHours() * 60 + ist.getUTCMinutes() < 18 * 60 + 30;
  const haveToday = notDueYet || (have?.today?.date === today && have?.today?.source === 'nse');

  const body = {};
  if (!haveToday) {
    const j = await nseJson();
    if (j) body.nse = j;
  }
  const latest = await text(NSDL_LATEST);
  if (latest) body.nsdlDaily = [latest];

  const list = await text(NSDL_SECTOR_LIST);
  const reportFiles = [];
  if (list) {
    const re = /<option[^>]*value="[^"]*Fortnightly_Sector_wise_FII_Investment_Data\/([^"]+\.html?)"/gi;
    let m; while ((m = re.exec(list)) && reportFiles.length < 48) if (!reportFiles.includes(m[1])) reportFiles.push(m[1]);
    if (reportFiles[0]) {
      // re-sending a report the app already has is harmless (stored by report date + sector)
      const html = await text(SECTOR_BASE + reportFiles[0]);
      if (html) body.sectorReports = [html];
    }
  }

  // zzz1060 — participant-wise OI: the last few weekdays (404 = holiday / not out yet; harmless)
  const recentOi = [];
  for (const d of weekdaysBack(today, 4, true)) { const csv = await oiCsv(d); if (csv.csv) recentOi.push(csv.csv); }
  if (recentOi.length) body.participantOi = recentOi;

  let res = null;
  if (Object.keys(body).length) {
    res = await post(body);
    if (!res) process.exit(1);
  } else console.log('nothing fetched for today');

  // zzz1060 — history backfill from GitHub's network when the app reports it unfinished (NSDL / NSE may refuse the app host).
  // Each step continues the app's own cursor, so the app job and this collector never fill the same months twice.
  await backfill(have?.status, reportFiles);

  if (!res) process.exit(haveToday ? 0 : 75);
  if (!haveToday && res.nse !== today) { console.log(`NSE figures for ${today} not out yet (got ${res.nse})`); process.exit(75); }
}

async function post(body) {
  const r = await fetch(`${BASE}/api/v1/fii-dii`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': KEY }, body: JSON.stringify(body), signal: t(180_000) });
  const out = await r.text();
  console.log(`ingest HTTP ${r.status}: ${out.slice(0, 400)}`);
  if (!r.ok) return null;
  try { return JSON.parse(out); } catch { return null; }
}

const isoAdd = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
/** Weekdays going back from `from` (inclusive when `incl`), `n` of them. */
function weekdaysBack(from, n, incl = false) {
  const out = []; let d = incl ? from : isoAdd(from, -1);
  while (out.length < n) { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d); d = isoAdd(d, -1); }
  return out;
}
async function oiCsv(iso) {
  const url = `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}.csv`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', Referer: 'https://www.nseindia.com/' }, signal: t(20_000) });
    if (r.status === 404) return { csv: null, missing: true };
    if (!r.ok) return { csv: null, error: `HTTP ${r.status}` };
    const x = await r.text();
    return /participant/i.test(x.slice(0, 200)) ? { csv: x } : { csv: null, error: 'not a participant OI file' };
  } catch (e) { return { csv: null, error: e.message }; }
}

/** Same walk as lib/fii-dii/schedule backfillMonths: month-ends newest first below `cursor` (null → this month, ending today). */
function nextMonths(today, cursor, limit, months = 60) {
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7)) - 1;
  const stop = Date.UTC(ty, tm - months, 1);
  let cur = cursor ? Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)) - 2, 1) : Date.UTC(ty, tm, 1);
  const out = [];
  while (cur >= stop && out.length < limit) {
    const c = new Date(cur);
    const end = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    out.push(end > today ? today : end);
    cur = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() - 1, 1);
  }
  return out;
}

async function nsdlArchiveMonth(iso) {
  const U = 'https://www.fpi.nsdl.co.in/web/Reports/Archive.aspx';
  try {
    const f = await fetch(U, { headers: { 'User-Agent': UA }, signal: t(30_000) });
    const page = await f.text();
    const cookie = (f.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    const h = (n) => new RegExp(`id="${n}"\\s+value="([^"]*)"`).exec(page)?.[1] ?? '';
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1];
    const body = new URLSearchParams({ __EVENTTARGET: 'btnSubmit1', __EVENTARGUMENT: '', __VIEWSTATE: h('__VIEWSTATE'), __VIEWSTATEGENERATOR: h('__VIEWSTATEGENERATOR'), __EVENTVALIDATION: h('__EVENTVALIDATION'), hdnDate: `${iso.slice(8, 10)}-${mon}-${iso.slice(0, 4)}`, HdnValexceldata: '', hdnFlag: '' });
    const r = await fetch(U, { method: 'POST', body: body.toString(), headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: U, ...(cookie ? { Cookie: cookie } : {}) }, signal: t(60_000) });
    if (!r.ok) { console.log(`NSDL archive ${iso} HTTP ${r.status}`); return null; }
    const x = await r.text();
    return /Reporting\s*Date/i.test(x) ? x : null;
  } catch (e) { console.log(`NSDL archive ${iso} failed: ${e.message}`); return null; }
}

async function backfill(status, reportFiles) {
  const deadline = Date.now() + 5 * 60_000;
  const today = istToday();
  // 1) NSDL daily archive (5 years of FII history), 3 months per POST so the cursor advances step by step
  if (status && (!status.daily || !status.daily.done)) {
    let cursor = status.daily?.cursor ?? null;
    let rounds = 0;
    while (Date.now() < deadline && rounds < 6) {
      const months = nextMonths(today, cursor, 3);
      if (!months.length) break;
      const pages = [];
      for (const m of months) { const h = await nsdlArchiveMonth(m); if (!h) break; pages.push({ month: m, html: h }); }
      if (!pages.length) break;
      const r = await post({ nsdlArchive: pages });
      const took = r?.archiveMonths || [];
      console.log(`archive months taken: ${took.join(', ') || 'none'}`);
      if (!took.length) break;
      cursor = took[took.length - 1];
      rounds++;
    }
  }
  // 2) participant-OI history (~1 year), 60 weekdays per POST
  if (status && (!status.oi || !status.oi.done) && Date.now() < deadline) {
    let cursor = status.oi?.cursor ?? isoAdd(today, 1);
    const stop = isoAdd(today, -380);
    for (let round = 0; round < 3 && Date.now() < deadline && cursor > stop; round++) {
      const days = weekdaysBack(cursor, 60).filter((d) => d >= stop);
      if (!days.length) break;
      const csvs = []; let oldest = null;
      for (let i = 0; i < days.length; i += 6) {
        const chunk = days.slice(i, i + 6);
        const got = await Promise.all(chunk.map(oiCsv));
        if (got.some((g) => !g.csv && !g.missing)) { console.log(`OI fetch refused near ${chunk[0]}`); break; }
        for (const g of got) if (g.csv) csvs.push(g.csv);
        oldest = chunk[chunk.length - 1];
      }
      if (!oldest) break;
      const r = await post({ participantOi: csvs, oiBackfillCursor: oldest });
      if (!r) break;
      console.log(`OI history: ${r.oiDays} files, cursor ${oldest}`);
      cursor = oldest;
    }
  }
  // 3) sector reports (2 years) when the app has not finished them
  if (status && status.sectors && !status.sectors.done && reportFiles.length > 1 && Date.now() < deadline) {
    for (let i = 1; i < reportFiles.length && Date.now() < deadline; i += 6) {
      const htmls = [];
      for (const f of reportFiles.slice(i, i + 6)) { const h = await text(SECTOR_BASE + f); if (h) htmls.push(h); }
      if (htmls.length) await post({ sectorReports: htmls });
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
