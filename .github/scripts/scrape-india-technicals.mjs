#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// INDIA STOCK TECHNICALS, FROM NSE'S OWN ARCHIVE  (zzz666)
//
// WHY THIS EXISTS.
//
// A census of all 438 names on the India conviction bench:
//
//     stage              0 / 438          d1_pct    434 / 438   ← NSE bhavcopy
//     rs_rating          0 / 438          adtv_cr   434 / 438   ← NSE bhavcopy
//     pct_from_52w_high  0 / 438          price     434 / 438   ← NSE bhavcopy
//     close_30d          0 / 438
//
// Every field NSE supplies works. Every field Yahoo supplies is null on every
// Indian company in the book. The enrichment route has said "Yahoo sometimes
// blocks Railway IPs" in its comments for months; the measurement says always.
//
// WHAT THAT COSTS. The technical axis is a quarter of the composite:
//
//     technical = stageBase + RS/3 + 52w adjustment + trend-template bonus
//               =    50     +  0   +       0        +          0         = 50
//
// Fifty, for every company on the exchange, for ever. A stock at an all-time
// high and one in a 60% drawdown score identically on a quarter of the grade.
//
// It also silently disables most of the methodology axis. Of 438 bench rows
// the ONLY tag that has ever fired is `bonde ep` (428 of them) — `trend
// template`, `sepa` and `canslim` all require RS ≥ 70/80, so they are not rare,
// they are IMPOSSIBLE. Blockbuster Path A needs one of them and is therefore
// unreachable. Every `stage !== 4` veto in the tier ladder is a no-op, and
// `chartOk` is unconditionally true. None of it ever errored.
//
// WHY NOT YAHOO FROM HERE. That was this job's first design, on the theory
// that a GitHub runner would be treated better than Railway. It was not:
// 438 of 438 symbols failed on the first run, and so did the Nifty itself.
// Yahoo refuses this runner exactly as it refuses the app.
//
// SO THE SOURCE IS NSE, on the same static host the index-history scraper has
// been reading successfully for weeks:
//
//     https://archives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv
//
// One file per session, carrying OHLCV for EVERY listed security. A single
// request therefore yields one day of closes for all 438 names at once, rather
// than 438 requests for one name each — faster and far gentler than the design
// it replaces.
//
// IT ACCUMULATES. Past closes are immutable, so the stored history is read, the
// missing sessions are worked out from it, and only those are fetched, bounded
// per run. A cold start converges over a few runs and then costs one file a day
// for ever. A holiday has no file: a 404 is recorded as "not a trading day" so
// it is never requested again, which is also how the job learns the real
// trading calendar.
//
// WHY IT IS SAFE. The output is an OVERLAY and every consumer already treats a
// missing entry exactly as it treats today's null. If this job never runs,
// nothing changes anywhere. A failed or thin run never truncates what is
// stored. The blast radius of a bug here is bounded by "the technical axis goes
// back to being a constant", which is where it is today.
//
//   KV  india-tech-hist:v1:latest  — the accumulating close history
//   KV  india-tech:v1:latest       — the computed technicals the app reads
// ═══════════════════════════════════════════════════════════════════════════

const OUT_KEY   = 'india-tech:v1:latest';
const HIST_KEY  = 'india-tech-hist:v1:latest';
const BENCH_KEY = 'bench:server:v1';
const OUT_TTL  = 30 * 24 * 60 * 60;
const HIST_TTL = 400 * 24 * 60 * 60;

const BACKFILL_DAYS      = Number(process.env.BACKFILL_DAYS || 400);
const MAX_FETCH_PER_RUN  = Number(process.env.MAX_FETCH || 120);
const MAX_SYMBOLS        = Number(process.env.MAX_SYMBOLS || 900);
const GAP_MS             = Number(process.env.GAP_MS || 250);
const TIMEOUT_MS         = 30_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  if (j?.result == null) return null;
  try { return typeof j.result === 'string' ? JSON.parse(j.result) : j.result; } catch { return null; }
}
async function kvSet(key, value, ttl) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttl}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV set failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BHAV = (ddmmyyyy) => `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`;
const stampOf = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
};
const isoOf = (d) => d.toISOString().slice(0, 10);

/**
 * One session's closes, keyed by symbol, plus that session's MARKET return.
 *
 * `want` filters to the symbols we actually store. The first build kept every
 * symbol in the file — about two thousand of them across 283 sessions — and the
 * resulting blob was 10,485,801 bytes against Upstash's 10,485,760 limit. Forty
 * one bytes over, after a clean four-minute fetch. Keeping only the working set
 * makes the blob a few megabytes and leaves room to grow.
 *
 * The market leg of RS still needs a BROAD comparison, not a comparison against
 * the bench (which is all strong-earnings names by construction and would
 * flatter everything on it). The bhavcopy carries PREV_CLOSE on every row, so
 * each session yields its own breadth figure — the median daily return across
 * every listed equity — without storing any of those symbols. One number per
 * session instead of two thousand series.
 */
async function fetchSession(ddmmyyyy, want) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BHAV(ddmmyyyy), { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' }, signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 404) return { holiday: true, closes: null };
    if (!res.ok) return { holiday: false, closes: null };
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 5) return { holiday: false, closes: null };
    const head = lines[0].split(',').map((h) => h.trim().toUpperCase());
    const iSym = head.indexOf('SYMBOL'), iSer = head.indexOf('SERIES'), iCls = head.indexOf('CLOSE_PRICE');
    const iPrv = head.indexOf('PREV_CLOSE');
    if (iSym < 0 || iCls < 0) return { holiday: false, closes: null };
    const closes = {};
    const dayRets = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length <= iCls) continue;
      // EQ / BE are the ordinary equity series. Debt, ETFs and rights
      // entitlements would otherwise pollute the cohort RS percentile.
      const ser = (iSer >= 0 ? String(c[iSer] || '') : 'EQ').trim().toUpperCase();
      if (ser !== 'EQ' && ser !== 'BE') continue;
      const sym = String(c[iSym] || '').trim().toUpperCase();
      const px = Number(String(c[iCls] || '').trim());
      if (!sym || !Number.isFinite(px) || px <= 0) continue;
      if (iPrv >= 0) {
        const pv = Number(String(c[iPrv] || '').trim());
        if (Number.isFinite(pv) && pv > 0) dayRets.push(((px - pv) / pv) * 100);
      }
      if (!want || want.has(sym)) closes[sym] = px;
    }
    // THE MEAN, NOT THE MEDIAN.
    //
    // The first version compounded the MEDIAN daily return and produced a
    // 282-session market return of −36.8%, which is not what the Indian market
    // did. Daily cross-sectional returns are right-skewed — a few large winners
    // pull the mean above the median every day — so compounding the median
    // manufactures a steady drag and would have told the engine that almost
    // every stock beat the market. An equal-weighted index return is the
    // compounded MEAN, and that is the comparison RS is supposed to make.
    //
    // A trimmed mean, because a single mis-parsed row or a 400% listing-day
    // move should not set the market's return for that session.
    dayRets.sort((a, b) => a - b);
    let mktRet = null;
    if (dayRets.length >= 50) {
      const cut = Math.floor(dayRets.length * 0.02);
      const core = dayRets.slice(cut, dayRets.length - cut);
      mktRet = core.reduce((a, b) => a + b, 0) / core.length;
    }
    return { holiday: false, closes, mktRet };
  } catch { clearTimeout(t); return { holiday: false, closes: null }; }
}

// ── technical construction ────────────────────────────────────────────────
function sma(closes, window, back = 0) {
  const end = closes.length - back;
  if (end < window) return null;
  let s = 0, n = 0;
  for (let i = end - window; i < end; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) continue;
    s += v; n++;
  }
  return n >= window * 0.8 ? s / n : null;
}
const retPct = (c, back) => {
  const a = c[c.length - 1 - back], b = c[c.length - 1];
  return (a != null && b != null && a > 0) ? ((b - a) / a) * 100 : null;
};

function technicalsFor(closes) {
  const c = closes.filter((x) => x != null && Number.isFinite(x));
  const last = c[c.length - 1];
  if (last == null || c.length < 60) return null;

  const ma50 = sma(c, 50), ma150 = sma(c, 150), ma200 = sma(c, 200);
  const ma200_prev = sma(c, 200, 21);                       // ~one month earlier
  const ma200_slope = (ma200 != null && ma200_prev != null) ? ma200 - ma200_prev : null;

  // Weinstein stage — the same test the app uses, so a value from here and a
  // value from the app mean the same thing.
  let stage = null;
  if (ma200 != null) {
    const above200 = last > ma200;
    const stacked = ma50 != null && ma150 != null && ma50 > ma150 && ma150 > ma200;
    const slopeUp = ma200_slope != null && ma200_slope > 0;
    if (above200 && stacked && slopeUp) stage = 2;
    else if (!above200 && !slopeUp) stage = 4;
    else if (above200 && !slopeUp) stage = 3;
    else stage = 1;
  }

  const win = c.slice(-252);
  const hi52 = win.length ? Math.max(...win) : null;
  const lo52 = win.length ? Math.min(...win) : null;
  const trend_template = !!(ma50 && ma150 && ma200
    && last > ma50 && last > ma150 && last > ma200
    && ma150 > ma200 && ma200_slope != null && ma200_slope > 0 && ma50 > ma150
    && lo52 && last > lo52 * 1.25 && hi52 && last >= hi52 * 0.75);

  return {
    stage, ma50, ma150, ma200, ma200_slope, trend_template,
    pct_from_52w_high: (hi52 && hi52 > 0) ? Math.round(((last - hi52) / hi52) * 1000) / 10 : null,
    ret1m: retPct(c, 21), ret3m: retPct(c, 63), ret6m: retPct(c, 126), ret12m: retPct(c, 252),
    // The reaction ladder scales its thresholds by the stock's own typical
    // move and needs a close series to measure one.
    close_30d: c.slice(-31),
    bars: c.length,
    rs_rating: null,                 // assigned across the cohort below
  };
}

// RS: a cohort percentile blended half-and-half with a return relative to the
// market. Identical construction to the US side, for the same reason — a pure
// percentile over a small cohort is noise, and a pure absolute return ignores
// what the rest of the market did.
function assignRs(entries, benchRet12m) {
  const blended = entries.map(([, t]) => {
    const parts = [[t.ret12m, 0.4], [t.ret6m, 0.2], [t.ret3m, 0.2], [t.ret1m, 0.2]];
    let s = 0, w = 0;
    for (const [v, wt] of parts) if (v != null && Number.isFinite(v)) { s += v * wt; w += wt; }
    return w > 0 ? s / w : null;
  });
  const known = blended.filter((x) => x != null).sort((a, b) => a - b);
  entries.forEach(([, t], i) => {
    const b = blended[i];
    if (b == null) { t.rs_rating = null; return; }
    let lo = 0;
    while (lo < known.length && known[lo] < b) lo++;
    const pct = known.length > 1 ? (lo / (known.length - 1)) * 100 : 50;
    const rel = (t.ret12m != null && benchRet12m != null) ? t.ret12m - benchRet12m : null;
    const abs = rel == null ? 50
      : rel >= 60 ? 95 : rel >= 40 ? 88 : rel >= 25 ? 80 : rel >= 12 ? 70
      : rel >= 0 ? 58 : rel >= -10 ? 45 : rel >= -25 ? 32 : rel >= -40 ? 20 : 8;
    t.rs_rating = Math.max(1, Math.min(99, Math.round(pct * 0.5 + abs * 0.5)));
  });
}

async function main() {
  // WHICH SYMBOLS WE KEEP HISTORY FOR. The bench is the working set — these are
  // the names whose cards get read, and the bench cron adds a fresh filer the
  // morning after it reports. Storing the whole exchange is what blew the 10 MB
  // Redis limit on the first run; storing the working set is a few megabytes.
  // Symbols already in the stored history are kept even if they have since left
  // the bench, so a name that returns does not start from zero bars.
  const priorHist = (await kvGet(HIST_KEY)) || {};
  const series = priorHist.series || {};
  const marketDaily = priorHist.marketDaily || {};
  const knownEmpty = new Set(priorHist.knownEmpty || []);
  const have = new Set(priorHist.sessions || []);

  const bench = await kvGet(BENCH_KEY);
  const fromBench = Array.isArray(bench?.entries)
    ? bench.entries.map((e) => String(e?.ticker || '').toUpperCase()).filter(Boolean) : [];
  const extra = String(process.env.EXTRA_SYMBOLS || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const want = new Set([...Object.keys(series), ...fromBench, ...extra].slice(0, MAX_SYMBOLS));
  console.log(`working set: ${want.size} symbols (bench ${fromBench.length}, already in history ${Object.keys(series).length})`);

  // ── 1. fetch the sessions we do not already hold ──────────────────────
  const wanted = [];
  for (let i = 1; i <= BACKFILL_DAYS; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const st = stampOf(d);
    if (have.has(st) || knownEmpty.has(st)) continue;
    wanted.push({ stamp: st, iso: isoOf(d) });
  }
  // Newest first: on a cold start a usable 30-day series at the RECENT end is
  // worth more than a 400-day gap filled from the wrong end.
  const todo = wanted.slice(0, MAX_FETCH_PER_RUN);
  console.log(`history: ${have.size} sessions stored, ${wanted.length} missing, fetching ${todo.length} this run`);

  let fetched = 0, holidays = 0, failures = 0;
  for (const { stamp, iso } of todo) {
    const r = await fetchSession(stamp, want);
    if (r.holiday) { knownEmpty.add(stamp); holidays++; }
    else if (r.closes) {
      for (const [sym, px] of Object.entries(r.closes)) (series[sym] ||= {})[iso] = px;
      if (r.mktRet != null) marketDaily[iso] = Math.round(r.mktRet * 1000) / 1000;
      have.add(stamp); fetched++;
    } else failures++;
    await sleep(GAP_MS);
  }
  console.log(`fetched=${fetched} holidays=${holidays} failures=${failures}`);

  // NEVER TRUNCATE ON FAILURE, but DO stay under the store's limit. Oldest
  // sessions go first if the blob has outgrown the cap — a 200-day moving
  // average needs 200 sessions, not 400.
  const trimTo = (obj, keepIso) => {
    for (const sym of Object.keys(obj)) {
      for (const d of Object.keys(obj[sym])) if (!keepIso.has(d)) delete obj[sym][d];
      if (!Object.keys(obj[sym]).length) delete obj[sym];
    }
  };
  let hist = { generatedAt: new Date().toISOString(), sessions: [...have], knownEmpty: [...knownEmpty], marketDaily, series };
  const LIMIT = 9_000_000;
  let guard = 0;
  while (JSON.stringify(hist).length > LIMIT && guard++ < 12) {
    const allIso = [...new Set(Object.values(series).flatMap((m) => Object.keys(m)))].sort();
    const keep = new Set(allIso.slice(Math.ceil(allIso.length * 0.12)));   // drop the oldest ~12%
    trimTo(series, keep);
    for (const d of Object.keys(marketDaily)) if (!keep.has(d)) delete marketDaily[d];
    hist = { ...hist, series, marketDaily };
    console.log(`  blob over ${LIMIT} bytes — trimmed to ${keep.size} sessions`);
  }
  await kvSet(HIST_KEY, hist, HIST_TTL);

  // ── 2. the market leg of RS ───────────────────────────────────────────
  // Compounded median daily return over the last 252 sessions. Broad by
  // construction: it is every listed equity, not the bench.
  const mdDates = Object.keys(marketDaily).sort();
  let benchmarkRet12m = null;
  if (mdDates.length >= 150) {
    let acc = 1;
    for (const d of mdDates.slice(-252)) acc *= (1 + (marketDaily[d] || 0) / 100);
    benchmarkRet12m = (acc - 1) * 100;
  }
  console.log(`market ${mdDates.length}-session compounded return: ${benchmarkRet12m == null ? 'not enough history yet' : benchmarkRet12m.toFixed(1) + '%'}`);

  // ── 3. compute technicals ─────────────────────────────────────────────
  const targets = [...new Set([...fromBench, ...extra])];
  const out = {};
  for (const sym of targets) {
    const m = series[sym];
    if (!m) continue;
    const dates = Object.keys(m).sort();
    const t = technicalsFor(dates.map((d) => m[d]));
    if (t) out[sym] = t;
  }
  assignRs(Object.entries(out), benchmarkRet12m);

  // A THIN RUN MUST NOT REPLACE A RICH ONE. On a cold start there is simply not
  // enough history yet, and overwriting a good blob with a handful of names
  // would take the technical axis away again until tomorrow.
  const priorOut = await kvGet(OUT_KEY);
  const priorCount = Object.keys(priorOut?.symbols || {}).length;
  const count = Object.keys(out).length;
  if (priorCount > 0 && count < priorCount * 0.5) {
    console.log(`::warning::only ${count} symbols computed against ${priorCount} stored — keeping the existing blob.`);
    console.log(JSON.stringify({ computed: count, kept_prior: true, priorCount }));
    return;
  }

  const merged = { ...(priorOut?.symbols || {}), ...out };
  await kvSet(OUT_KEY, {
    generatedAt: new Date().toISOString(),
    count: Object.keys(merged).length,
    benchmarkRet12m, sessions_stored: have.size,
    symbols: merged,
  }, OUT_TTL);

  const stages = {};
  for (const t of Object.values(merged)) stages[String(t.stage)] = (stages[String(t.stage)] || 0) + 1;
  console.log(JSON.stringify({
    sessions_stored: have.size,
    symbols_in_history: Object.keys(series).length,
    computed_this_run: count,
    stored: Object.keys(merged).length,
    stage_distribution: stages,
    with_rs: Object.values(merged).filter((t) => t.rs_rating != null).length,
    with_ma200: Object.values(merged).filter((t) => t.ma200 != null).length,
    trend_template: Object.values(merged).filter((t) => t.trend_template).length,
  }, null, 2));
}

main().catch((e) => {
  console.error('::error title=India technicals scrape failed::' + String(e?.message || e));
  process.exit(1);
});
