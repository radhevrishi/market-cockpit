#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// NSE SECTOR INDEX HISTORY, FROM NSE  (zzz654)
//
// WHY THIS EXISTS. Eleven of the fifteen NSE sector indices the rotation board
// is named after stopped updating on Yahoo on 2026-07-17 and resumed on
// 2026-09-15 — a sixty-day hole with healthy bars on both sides, which no bar
// count or staleness check can see. Worse than absent: Yahoo served a bar
// dated 2026-09-14 for Nifty Realty at 918.7 on a day the exchange was SHUT
// (NSE has no file for it), while NSE's own close for the previous session was
// 848.5. The board was not missing data, it was being given invented data.
//
// The engine now falls back to a constituent basket when a proxy fails, which
// is current and correct — but a basket of five leaders is not the published
// index, and the whole point of naming a theme "Nifty Realty" is that it IS
// Nifty Realty. So this fetches the real thing from the people who calculate
// it.
//
// WHY archives.nseindia.com AND NOT THE NSE API. The scraper next door records
// what four runs of testing established: NSE's main /api/ endpoints are behind
// Akamai bot-detection and answer 403 to GitHub Actions IPs, but the static
// archive CSVs are served plainly. `ind_close_all_DDMMYYYY.csv` is one file
// per trading session containing OHLC for all ~160 NSE indices — the exact
// figures NSE publishes, and the only source here that is not a third party's
// reconstruction.
//
// WHY IT ACCUMULATES RATHER THAN REBUILDS. Two years is about five hundred
// files. Fetching them on every run would be five hundred requests a day at
// NSE for data that cannot change — past index closes are immutable. So the
// blob is READ, the missing sessions are worked out from it, and only those
// are fetched, bounded per run. A cold start converges over a few runs and
// then costs one file a day forever. A weekend or a holiday simply has no
// file: a 404 is recorded as "not a trading day" so it is never asked for
// again, which is also how the board learns the real trading calendar.
//
// THE BLOB IS NEVER TRUNCATED ON FAILURE. Every merge starts from what is
// already stored and only ever adds. If NSE is down, the run writes nothing
// and the board keeps the history it had.
//
//   KV key: nse-index-history:v1:latest
//   { generatedAt, sessions: N, indices: { "^CNXREALTY": { ts:[], close:[] } },
//     knownEmpty: ["14092026", ...] }
// ═══════════════════════════════════════════════════════════════════════════

const ARCHIVES = 'https://archives.nseindia.com/content/indices';
const KV_KEY = 'nse-index-history:v1:latest';
const KV_TTL = 400 * 24 * 60 * 60;          // longer than the history it holds
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS || 760);
const MAX_FETCH_PER_RUN = Number(process.env.MAX_FETCH || 260);
const GAP_MS = 220;
const TIMEOUT_MS = 25_000;

// The indices the rotation board actually names, mapped from NSE's own label
// to the symbol theme-universe.ts uses. Deliberately NOT all 160: the blob is
// read on every board build, and carrying 150 indices nothing references would
// make every reader pay for data no page displays.
const WANT = {
  'Nifty 50': '^NSEI',
  'Nifty Bank': '^NSEBANK',
  'Nifty IT': '^CNXIT',
  'Nifty Pharma': '^CNXPHARMA',
  'Nifty FMCG': '^CNXFMCG',
  'Nifty Auto': '^CNXAUTO',
  'Nifty Metal': '^CNXMETAL',
  'Nifty Energy': '^CNXENERGY',
  'Nifty Realty': '^CNXREALTY',
  'Nifty PSU Bank': '^CNXPSUBANK',
  'Nifty Financial Services': '^CNXFIN',
  'Nifty Infrastructure': '^CNXINFRA',
  'Nifty PSE': '^CNXPSE',
  'Nifty Media': '^CNXMEDIA',
  'Nifty India Consumption': '^CNXCONSUM',
  'Nifty Commodities': '^CNXCMDT',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/csv,application/octet-stream,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (j?.result == null) return null;
  try { return typeof j.result === 'string' ? JSON.parse(j.result) : j.result; }
  catch { return null; }
}
async function kvSet(key, value, ttl) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttl}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV set failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/** DDMMYYYY, which is the only shape the archive accepts. */
const stamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
};
/** Midnight UTC seconds for the session — the same basis fetchChart uses, so
 *  the two sources are interchangeable downstream without a conversion. */
const secOf = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** One session's file → { symbol: close }. Returns null when NSE has no file
 *  for that date, which means it was not a trading day. */
async function fetchSession(ddmmyyyy) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ARCHIVES}/ind_close_all_${ddmmyyyy}.csv`, { headers: HEADERS, signal: ctl.signal });
    if (res.status === 404) return null;                 // not a trading day
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // NSE serves an HTML error page with a 200 on some failures, so the shape
    // is checked rather than the status code.
    if (!/^Index Name,/i.test(text.trim())) return null;
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    const head = parseCsvLine(lines[0]).map((h) => h.trim());
    const iName = head.findIndex((h) => /^index name$/i.test(h));
    const iClose = head.findIndex((h) => /closing index value/i.test(h));
    if (iName < 0 || iClose < 0) return null;
    const out = {};
    for (let i = 1; i < lines.length; i++) {
      const c = parseCsvLine(lines[i]);
      const name = (c[iName] || '').trim();
      const sym = WANT[name];
      if (!sym) continue;
      const v = Number((c[iClose] || '').trim());
      if (Number.isFinite(v) && v > 0) out[sym] = v;
    }
    return out;
  } finally { clearTimeout(timer); }
}

(async () => {
  const prior = (await kvGet(KV_KEY)) || {};
  const indices = prior.indices && typeof prior.indices === 'object' ? prior.indices : {};
  const knownEmpty = new Set(Array.isArray(prior.knownEmpty) ? prior.knownEmpty : []);

  // Which sessions do we already hold? Any date present on the benchmark is a
  // session we have; the benchmark trades every day the exchange is open, so
  // it is the right yardstick.
  const have = new Set((indices['^NSEI']?.ts || []).map(Number));

  // Newest first: a cold start should make the RECENT window usable before it
  // worries about two years ago, because that is the window every return and
  // moving average on the board is computed over.
  const wanted = [];
  const today = new Date();
  for (let i = 1; i <= BACKFILL_DAYS; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;                 // NSE does not trade weekends
    const st = stamp(d);
    if (knownEmpty.has(st)) continue;                     // a holiday we already learned
    if (have.has(secOf(d))) continue;                     // already stored
    wanted.push({ d, st });
  }

  console.log(`held sessions: ${have.size} · known non-trading days: ${knownEmpty.size} · missing: ${wanted.length}`);
  const todo = wanted.slice(0, MAX_FETCH_PER_RUN);
  let added = 0, holidays = 0, failed = 0;

  for (const { d, st } of todo) {
    let row;
    try { row = await fetchSession(st); }
    catch (e) { failed++; console.log(`  ${st}: ${e.message}`); await new Promise((r) => setTimeout(r, GAP_MS)); continue; }
    if (row === null) { knownEmpty.add(st); holidays++; await new Promise((r) => setTimeout(r, GAP_MS)); continue; }
    const ts = secOf(d);
    for (const [sym, close] of Object.entries(row)) {
      const s = indices[sym] || (indices[sym] = { ts: [], close: [] });
      s.ts.push(ts); s.close.push(close);
    }
    added++;
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  if (!added && !holidays) {
    console.log('nothing new resolved — leaving the stored history exactly as it was');
    if (failed) process.exitCode = 1;
    return;
  }

  // Sort and de-duplicate every series. Sessions arrive newest-first and across
  // many runs, so order is never guaranteed by construction — and a series the
  // board reads must be strictly ascending or every window computed on it is
  // measured between the wrong two points.
  let longest = 0;
  for (const [sym, s] of Object.entries(indices)) {
    const seen = new Map();
    for (let i = 0; i < s.ts.length; i++) seen.set(Number(s.ts[i]), Number(s.close[i]));
    const ts = [...seen.keys()].sort((a, b) => a - b);
    indices[sym] = { ts, close: ts.map((t) => seen.get(t)) };
    longest = Math.max(longest, ts.length);
  }

  const blob = {
    generatedAt: new Date().toISOString(),
    source: 'archives.nseindia.com ind_close_all — NSE published closes',
    sessions: indices['^NSEI']?.ts.length || longest,
    indices,
    // Kept so a holiday is never re-fetched. Bounded: two years of holidays is
    // a few dozen entries, and anything older cannot be asked for again anyway.
    knownEmpty: [...knownEmpty].slice(-400),
  };
  await kvSet(KV_KEY, blob, KV_TTL);

  const cover = Object.entries(indices)
    .map(([k, v]) => `${k}:${v.ts.length}`).sort().join(' ');
  console.log(`added ${added} sessions · ${holidays} non-trading days learned · ${failed} failed`);
  console.log(`stored ${blob.sessions} sessions — ${cover}`);
  if (wanted.length > todo.length) {
    console.log(`${wanted.length - todo.length} sessions still missing; the next run continues (coverage only ever accumulates).`);
  }
})().catch((e) => {
  console.error(`::error title=NSE index history failed::${e.message}`);
  process.exit(1);
});
