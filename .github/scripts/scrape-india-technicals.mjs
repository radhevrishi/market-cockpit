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

const OUT_KEY    = 'india-tech:v1:latest';
// ═══════════════════════════════════════════════════════════════════════════
// THE HISTORY IS CHUNKED AND COLUMN-ENCODED.  (zzz667)
//
// The first build stored one JSON object, `{SYM: {"2026-09-15": 339, ...}}`,
// and Upstash refused it at 10,485,801 bytes against a 10,485,760 limit. The
// working set was then capped at 900 symbols to fit — which is why a company
// outside the most-traded 900 had no stage and no RS on the day it reported.
//
// Neither half of that shape was necessary.
//
// THE DATE WAS STORED ONCE PER SYMBOL PER DAY. Every point carried its own
// "2026-09-15" key: about 22 bytes to record one number. Holding the dates ONCE
// in the metadata and storing each symbol's closes as an array aligned to that
// index costs about 8. Same information, a third of the space.
//
// AND THE 10 MB LIMIT IS PER VALUE, NOT PER DATABASE. Splitting the symbols
// across chunk keys by a stable hash of the symbol multiplies the ceiling by
// the number of chunks, and a symbol always lands in the same chunk so a run
// only rewrites what it touched.
//
// Together: roughly 8,000 symbols over 400 sessions. The entire NSE equity list
// is about 2,000 names, so this does not raise the cap — it removes it, and the
// universe filter can stop pretending to be a size decision.
// ═══════════════════════════════════════════════════════════════════════════
const HIST_META  = 'india-tech-hist:v2:meta';
const HIST_CHUNK = (i) => `india-tech-hist:v2:c${i}`;
const CHUNKS = 6;
/** Stable so a symbol keeps its chunk across runs. */
function chunkOf(sym) {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (Math.imul(h, 31) + sym.charCodeAt(i)) >>> 0;
  return h % CHUNKS;
}
/** Reads meta + every chunk and rebuilds { SYM: { iso: close } } for the run. */
async function loadHistory() {
  const meta = await kvGet(HIST_META);
  if (!meta) return null;
  const dates = Array.isArray(meta.dates) ? meta.dates : [];
  const series = {};
  for (let i = 0; i < (meta.chunks || CHUNKS); i++) {
    const c = await kvGet(HIST_CHUNK(i));
    if (!c) continue;
    for (const [sym, arr] of Object.entries(c)) {
      if (!Array.isArray(arr)) continue;
      const m = {};
      for (let j = 0; j < arr.length; j++) if (arr[j] != null) m[dates[j]] = arr[j];
      series[sym] = m;
    }
  }
  return { ...meta, series };
}
/** Column-encodes and writes meta + chunks, trimming the oldest sessions only
 *  if a chunk would still be over the limit. */
async function saveHistory(meta, series) {
  let dates = [...new Set(Object.values(series).flatMap((m) => Object.keys(m)))].sort();
  const LIMIT = 9_000_000;
  for (let guard = 0; guard < 12; guard++) {
    const chunks = Array.from({ length: CHUNKS }, () => ({}));
    for (const [sym, m] of Object.entries(series)) {
      chunks[chunkOf(sym)][sym] = dates.map((d) => {
        const v = m[d];
        return v == null ? null : Math.round(v * 100) / 100;
      });
    }
    const biggest = Math.max(...chunks.map((c) => JSON.stringify(c).length));
    if (biggest > LIMIT) {
      const drop = Math.ceil(dates.length * 0.12);
      dates = dates.slice(drop);
      console.log(`  a chunk was ${biggest} bytes — dropping the oldest ${drop} sessions`);
      continue;
    }
    await kvSet(HIST_META, { ...meta, dates, chunks: CHUNKS }, HIST_TTL);
    for (let i = 0; i < CHUNKS; i++) await kvSet(HIST_CHUNK(i), chunks[i], HIST_TTL);
    return { dates, biggestChunkBytes: biggest };
  }
  throw new Error('history could not be reduced under the chunk limit');
}
const BENCH_KEY = 'bench:server:v1';
const OUT_TTL  = 30 * 24 * 60 * 60;
const HIST_TTL = 400 * 24 * 60 * 60;

const BACKFILL_DAYS      = Number(process.env.BACKFILL_DAYS || 400);
const MAX_FETCH_PER_RUN  = Number(process.env.MAX_FETCH || 120);
// zzz667 — was 900, which was never a judgement about which companies matter;
// it was the largest number that fit in one 10 MB value. The store is chunked
// and column-encoded now, so this is a safety valve rather than a ceiling: the
// whole NSE equity list is about 2,000 names and all of them fit.
const MAX_SYMBOLS        = Number(process.env.MAX_SYMBOLS || 5000);
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
    const turnover = {};
    const iTov = head.indexOf('TURNOVER_LACS');
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
      if (!want && iTov >= 0) {
        const tv = Number(String(c[iTov] || '').trim());
        if (Number.isFinite(tv)) turnover[sym] = tv;
      }
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
    return { holiday: false, closes, turnover, mktRet };
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
  // WHICH SYMBOLS WE KEEP HISTORY FOR. Every listed equity, now that the store
  // can hold them. The earlier 900-name limit was a storage constraint wearing
  // the costume of a relevance filter, and it showed: MOLBIO graded on 08 Sep
  // with stage null and RS null purely because it sat outside the most-traded
  // 900. A company you have never heard of reporting tomorrow is exactly the
  // one this engine exists to find.
  const priorHist = (await loadHistory()) || {};
  let series = priorHist.series || {};
  let marketDaily = priorHist.marketDaily || {};
  let knownEmpty = new Set(priorHist.knownEmpty || []);
  let have = new Set(priorHist.sessions || []);

  // WHEN THE MARKET FORMULA CHANGES, THE STORED VALUES ARE WRONG.
  //
  // The market leg is computed at FETCH time, from PREV_CLOSE in each session's
  // file, and then stored. So changing the formula changes nothing: the job
  // only fetches sessions it does not already hold, finds none missing, and
  // keeps serving figures computed the old way. That is exactly what happened
  // when this moved from a median to a trimmed mean — the run reported success
  // and the benchmark stayed at the old −36.8%.
  //
  // The basis is therefore stamped into the blob. Change the formula, change
  // the stamp, and the history rebuilds itself once instead of silently
  // disagreeing with its own code.
  const MARKET_BASIS = 'trimmed-mean-v1';
  if (priorHist.marketBasis && priorHist.marketBasis !== MARKET_BASIS) {
    console.log(`market basis changed (${priorHist.marketBasis} → ${MARKET_BASIS}) — refetching the window once.`);
    series = {}; marketDaily = {}; have = new Set(); knownEmpty = new Set();
  } else if (!priorHist.marketBasis && Object.keys(marketDaily).length) {
    console.log(`stored history predates the basis stamp — refetching the window once.`);
    series = {}; marketDaily = {}; have = new Set(); knownEmpty = new Set();
  }

  const bench = await kvGet(BENCH_KEY);
  const fromBench = Array.isArray(bench?.entries)
    ? bench.entries.map((e) => String(e?.ticker || '').toUpperCase()).filter(Boolean) : [];
  const extra = String(process.env.EXTRA_SYMBOLS || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  // THE BENCH IS NOT ENOUGH, AND THAT IS THE WHOLE POINT.
  //
  // The first version stored history only for names already on the bench. But
  // the names being GRADED are new filers, and a new filer is not on the bench
  // until the morning after it reports — so the company whose card you are
  // reading is precisely the one with no technicals. MOLBIO graded on 08 Sep
  // with stage null and RS null for exactly this reason.
  //
  // So the working set is the bench PLUS the most liquid part of the exchange,
  // up to the cap. Then a company that reports tomorrow already has two hundred
  // sessions of history waiting for it. Turnover is the filter because a name
  // nobody trades is one the thin-float gate would demote anyway.
  let universe = Array.isArray(priorHist.universe) ? priorHist.universe : [];
  const universeAge = priorHist.universeAt ? (Date.now() - Date.parse(priorHist.universeAt)) / 86_400_000 : 999;
  if (!universe.length || universeAge > 7) {
    for (let i = 1; i <= 8 && !universe.length; i++) {
      const d = new Date(Date.now() - i * 86_400_000);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      const probe = await fetchSession(stampOf(d), null);      // unfiltered: one file
      if (probe.holiday || !probe.turnover) continue;
      universe = Object.entries(probe.turnover)
        .sort((a, b) => b[1] - a[1]).map(([sym]) => sym).slice(0, MAX_SYMBOLS);
      console.log(`universe rebuilt from ${isoOf(d)}: ${universe.length} symbols by turnover`);
    }
  }
  // DE-DUPLICATE BEFORE CAPPING, NOT AFTER. Slicing the concatenated array
  // first meant the bench and the stored history filled the 900 slots twice
  // over and only 25 universe names survived — a working set of 455 that
  // looked like it had honoured the cap.
  const want = new Set([...new Set([...fromBench, ...extra, ...Object.keys(series), ...universe])].slice(0, MAX_SYMBOLS));

  // A SESSION ALREADY FETCHED ONLY HOLDS THE SYMBOLS WE WANTED AT THE TIME.
  //
  // Sessions are filtered on the way in, so widening the working set does not
  // retroactively fill the new names — the loop below sees nothing missing and
  // fetches nothing, and the new symbols stay empty for ever. The set the
  // history was actually built against is therefore recorded, and a material
  // widening re-opens the window once. Five per cent of tolerance so a couple
  // of new bench names do not trigger a full refetch every morning.
  const coverage = new Set(priorHist.coverage || Object.keys(series));
  const missingFromCoverage = [...want].filter((x) => !coverage.has(x)).length;
  // ANY new symbol re-opens the window, not five per cent of them.  (zzz671)
  //
  // Sessions are filtered on the way in, so a symbol added to the working set
  // today has NO history in the sessions already stored — and with a 5%
  // threshold, adding a handful never crossed it. A company benched tomorrow
  // would therefore start from one bar and take two hundred sessions to earn a
  // stage, while the file it needed was sitting in the archive all along.
  //
  // Re-fetching is ~280 files and about four minutes, bounded by MAX_FETCH, on
  // a job that runs once a day. Paying that whenever the working set actually
  // changes is cheaper than a name being silently unmeasurable for months.
  if (coverage.size && missingFromCoverage > 0) {
    console.log(`working set widened by ${missingFromCoverage} symbols beyond what the history covers — re-opening the window once.`);
    have = new Set(); knownEmpty = new Set();
  }
  console.log(`working set: ${want.size} symbols (bench ${fromBench.length}, universe ${universe.length}, in history ${Object.keys(series).length}, new vs coverage ${missingFromCoverage})`);

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
  const saved = await saveHistory({
    generatedAt: new Date().toISOString(),
    marketBasis: MARKET_BASIS,
    universe, universeAt: universe.length ? new Date().toISOString() : (priorHist.universeAt || null),
    coverage: [...want],
    sessions: [...have], knownEmpty: [...knownEmpty], marketDaily,
  }, series);
  console.log(`history saved: ${Object.keys(series).length} symbols \u00d7 ${saved.dates.length} sessions, biggest chunk ${(saved.biggestChunkBytes / 1e6).toFixed(2)} MB of 9`);

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
  // Compute for everything we hold history for, not just the bench — that is
  // what puts a new filer's stage and RS on its card the day it reports.
  const targets = [...want];
  const out = {};
  // WHY A SYMBOL HAS NO TECHNICALS, RECORDED RATHER THAN GUESSED.  (zzz667)
  //
  // Four bench names came back empty after coverage went from 900 to 2,885,
  // which ruled out the size cap and left two candidate explanations that
  // cannot be told apart from outside: the symbol is not in the bhavcopy at
  // all (an SME/EMERGE listing, which trades under a different series and is
  // deliberately excluded), or it is there but has traded too few sessions for
  // a moving average to mean anything. Both are correct behaviour; only one is
  // worth acting on. So the job says which, instead of leaving it to be
  // rediscovered by hand every time somebody asks.
  // A PER-SYMBOL REASON, FOR EVERY SYMBOL, NOT A COUNT FOR THE BENCH.  (zzz670)
  //
  // The first version of this only explained bench names, so the first question
  // asked of it — "BLEL trades ₹113 Cr a day and has no stage, why?" — could
  // not be answered from the job's own output. A missing value that cannot
  // explain itself gets rediscovered by hand every time somebody notices it.
  //
  // `skipped` is now keyed by symbol and stored WITH the overlay, so the
  // enrichment route can hand the reason straight back on the card:
  //   "absent"  — no such symbol in the bhavcopy EQ/BE series (an SME/EMERGE
  //               listing, a REIT/InvIT, or a ticker that simply is not there)
  //   "bars:N"  — present, but only N sessions of history. A 200-day average on
  //               twelve bars is not a cautious estimate, it is a fabrication.
  const skipped = {};
  for (const sym of targets) {
    const m = series[sym];
    if (!m) { skipped[sym] = 'absent'; continue; }
    const dates = Object.keys(m).sort();
    const t = technicalsFor(dates.map((d) => m[d]));
    if (t) out[sym] = t;
    else skipped[sym] = `bars:${dates.length}`;
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
    skipped,
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
    skipped_total: Object.keys(skipped).length,
    skipped_absent: Object.values(skipped).filter((v) => v === 'absent').length,
    skipped_too_few_bars: Object.values(skipped).filter((v) => String(v).startsWith('bars:')).length,
    bench_without_technicals: fromBench.filter((s2) => skipped[s2]).map((s2) => `${s2}:${skipped[s2]}`).slice(0, 15),
  }, null, 2));
}

main().catch((e) => {
  console.error('::error title=India technicals scrape failed::' + String(e?.message || e));
  process.exit(1);
});
