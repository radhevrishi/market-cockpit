#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// INDIA STOCK TECHNICALS, FROM A CLEAN IP  (zzz666)
//
// WHY THIS EXISTS.
//
// A census of all 438 names on the India conviction bench:
//
//     stage              0 / 438
//     rs_rating          0 / 438
//     pct_from_52w_high  0 / 438
//     close_30d          0 / 438
//     d1_pct             434 / 438   ← NSE bhavcopy
//     adtv_cr            434 / 438   ← NSE bhavcopy
//
// Every field sourced from NSE's static archive works. Every field sourced
// from Yahoo is null on every Indian company in the book. Yahoo is not
// reachable from Railway for Indian symbols — the enrichment route has said
// so in its own comments for months ("Yahoo sometimes blocks Railway IPs")
// and the truth is harsher than "sometimes".
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
// template`, `sepa` and `canslim` all require RS ≥ 70/80, so they are not
// rare, they are IMPOSSIBLE. Blockbuster Path A needs one of them and is
// therefore unreachable. Every `stage !== 4` veto in the tier ladder is a
// no-op, and `chartOk` is unconditionally true.
//
// None of this ever errored. It just quietly became a constant.
//
// WHY GITHUB ACTIONS. This codebase has already solved this exact problem
// once: scrape-nse-index-history runs here rather than in the app because
// datacentre IPs are refused and Actions runners are not. Four runs of
// evidence. This is the same pattern applied to stocks instead of indices.
//
// WHY IT IS SAFE. The output is an OVERLAY, and every consumer treats a
// missing entry exactly as it treats today's null. If this job never runs,
// nothing changes anywhere. If it runs and Yahoo refuses, the previous blob is
// kept — a failed run never truncates. The blast radius of a bug here is
// bounded by "the technical axis goes back to being a constant".
//
//   KV key: india-tech:v1:latest
//   { generatedAt, count, benchmarkRet12m,
//     symbols: { PATANJALI: { stage, ma50, ma150, ma200, ma200_slope,
//                             trend_template, pct_from_52w_high, rs_rating,
//                             ret1m, ret3m, ret6m, ret12m, close_30d } } }
// ═══════════════════════════════════════════════════════════════════════════

const KV_KEY = 'india-tech:v1:latest';
const KV_TTL = 21 * 24 * 60 * 60;            // three weeks — far longer than the daily cadence
const BENCH_KEY = 'bench:server:v1';
const MAX_SYMBOLS = Number(process.env.MAX_SYMBOLS || 700);
const GAP_MS = Number(process.env.GAP_MS || 130);
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

/** Daily closes for one symbol. .NS first, .BO as the fallback listing. */
async function fetchDaily(symbol) {
  const suffixes = symbol.startsWith('^') ? [''] : ['.NS', '.BO'];
  for (const sfx of suffixes) {
    for (const host of ['query1', 'query2']) {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol + sfx)}?range=2y&interval=1d`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,*/*' }, signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const j = await res.json();
        const r = j?.chart?.result?.[0];
        const closes = r?.indicators?.quote?.[0]?.close;
        if (!Array.isArray(closes) || closes.length < 60) continue;
        return { closes, meta: r.meta || {} };
      } catch { clearTimeout(t); }
    }
  }
  return null;
}

/** Simple moving average ending at the last bar. Null when there is not
 *  enough history — averaging 120 bars and calling it a 200-day line is how
 *  a chart lies. */
function sma(closes, window) {
  if (closes.length < window) return null;
  let s = 0, n = 0;
  for (let i = closes.length - window; i < closes.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) continue;
    s += v; n++;
  }
  return n >= window * 0.8 ? s / n : null;
}
function smaAt(closes, window, idxFromEnd) {
  const end = closes.length - idxFromEnd;
  if (end < window) return null;
  let s = 0, n = 0;
  for (let i = end - window; i < end; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) continue;
    s += v; n++;
  }
  return n >= window * 0.8 ? s / n : null;
}
const retPct = (closes, back) => {
  const a = closes[closes.length - 1 - back], b = closes[closes.length - 1];
  return (a != null && b != null && a > 0) ? ((b - a) / a) * 100 : null;
};

function technicalsFor(closes, meta) {
  const clean = closes.filter((c) => c != null && Number.isFinite(c));
  const last = clean[clean.length - 1] ?? null;
  if (last == null) return null;

  const ma50 = sma(clean, 50), ma150 = sma(clean, 150), ma200 = sma(clean, 200);
  const ma200_prev = smaAt(clean, 200, 21);                 // ~1 month earlier
  const ma200_slope = (ma200 != null && ma200_prev != null) ? ma200 - ma200_prev : null;

  // Weinstein stage — the same test the app already uses, so a value from
  // here and a value from the app mean the same thing.
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

  const hi52 = meta.fiftyTwoWeekHigh ?? Math.max(...clean.slice(-252));
  const lo52 = meta.fiftyTwoWeekLow ?? Math.min(...clean.slice(-252));
  const trend_template = !!(ma50 && ma150 && ma200
    && last > ma50 && last > ma150 && last > ma200
    && ma150 > ma200 && ma200_slope != null && ma200_slope > 0 && ma50 > ma150
    && lo52 && last > lo52 * 1.25 && hi52 && last >= hi52 * 0.75);

  return {
    stage, ma50, ma150, ma200, ma200_slope, trend_template,
    pct_from_52w_high: (hi52 && hi52 > 0) ? Math.round(((last - hi52) / hi52) * 1000) / 10 : null,
    ret1m: retPct(clean, 21), ret3m: retPct(clean, 63),
    ret6m: retPct(clean, 126), ret12m: retPct(clean, 252),
    // The reaction ladder scales its thresholds by the stock's own typical
    // move, and needs a close series to measure one.
    close_30d: clean.slice(-31),
    rs_rating: null,                 // assigned across the cohort below
  };
}

// ── RS: cohort percentile blended with a return relative to the Nifty ──────
// Identical construction to the US side (assignRsRatings), for the same
// reason: a pure percentile over a small cohort is noise, and a pure absolute
// return ignores what the rest of the market did. Half of each.
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
  // WHICH SYMBOLS. The bench is the working set — these are the names whose
  // cards get read. Recent filers come along via the bench too, because the
  // bench cron adds them the morning after they report. Deliberately not the
  // whole exchange: this is a daily job and 2,000 requests would get the
  // runner throttled for data nobody looks at.
  const bench = await kvGet(BENCH_KEY);
  const fromBench = Array.isArray(bench?.entries)
    ? bench.entries.map((e) => String(e?.ticker || '').toUpperCase()).filter(Boolean)
    : [];
  const extra = String(process.env.EXTRA_SYMBOLS || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const symbols = [...new Set([...fromBench, ...extra])].slice(0, MAX_SYMBOLS);
  console.log(`symbols to fetch: ${symbols.length} (bench ${fromBench.length}, extra ${extra.length})`);
  if (!symbols.length) {
    console.log('nothing to do — the bench is empty; leaving the existing blob untouched.');
    return;
  }

  // The benchmark leg. If the Nifty itself cannot be read, RS falls back to a
  // pure cohort percentile rather than being abandoned.
  let benchmarkRet12m = null;
  const nifty = await fetchDaily('^NSEI');
  if (nifty) {
    const c = nifty.closes.filter((x) => x != null && Number.isFinite(x));
    benchmarkRet12m = retPct(c, 252);
  }
  console.log(`Nifty 12m return: ${benchmarkRet12m == null ? 'unavailable' : benchmarkRet12m.toFixed(1) + '%'}`);

  const out = {};
  let ok = 0, failed = 0;
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const got = await Promise.all(batch.map(async (sym) => {
      const d = await fetchDaily(sym);
      if (!d) return [sym, null];
      try { return [sym, technicalsFor(d.closes, d.meta)]; } catch { return [sym, null]; }
    }));
    for (const [sym, t] of got) {
      if (t) { out[sym] = t; ok++; } else failed++;
    }
    if (i % 80 === 0) console.log(`  ${i + batch.length}/${symbols.length}  ok=${ok} failed=${failed}`);
    await sleep(GAP_MS);
  }

  assignRs(Object.entries(out), benchmarkRet12m);

  // A RUN THAT LEARNED ALMOST NOTHING MUST NOT REPLACE ONE THAT KNEW A LOT.
  // Yahoo rate-limits in bursts; a run caught by it would otherwise overwrite
  // a good blob with a handful of names and take the technical axis away
  // again until tomorrow.
  const prior = await kvGet(KV_KEY);
  const priorCount = Object.keys(prior?.symbols || {}).length;
  if (priorCount > 0 && ok < priorCount * 0.5) {
    console.log(`::warning::only ${ok} symbols resolved against ${priorCount} already stored — keeping the existing blob.`);
    console.log(JSON.stringify({ ok, failed, kept_prior: true, priorCount }));
    return;
  }

  // Merge so a symbol Yahoo refused today keeps yesterday's reading rather
  // than vanishing. Stale-but-present beats absent for a moving average.
  const merged = { ...(prior?.symbols || {}), ...out };

  const stages = {};
  for (const t of Object.values(merged)) stages[t.stage] = (stages[t.stage] || 0) + 1;

  await kvSet(KV_KEY, {
    generatedAt: new Date().toISOString(),
    count: Object.keys(merged).length,
    benchmarkRet12m,
    symbols: merged,
  }, KV_TTL);

  console.log(JSON.stringify({
    fetched_ok: ok, failed, stored: Object.keys(merged).length,
    stage_distribution: stages,
    with_rs: Object.values(merged).filter((t) => t.rs_rating != null).length,
    trend_template: Object.values(merged).filter((t) => t.trend_template).length,
  }, null, 2));
}

main().catch((e) => {
  console.error('::error title=India technicals scrape failed::' + String(e?.message || e));
  process.exit(1);
});
