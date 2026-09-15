// ═══════════════════════════════════════════════════════════════════════════
// DID ANY OF THIS ACTUALLY WORK?                                    (zzz676)
//
// Every grade this engine has ever published was an assertion about the
// future, and until now nothing measured whether those assertions came true.
// The forward ledger (/api/v1/ai/ledger) was built to do it honestly and says
// so itself: 16 marked predictions at one horizon is not evidence. Waiting for
// it to mature means waiting a year.
//
// But the answer is already sitting in the store. Graded sessions are held for
// 180 days, and the India technicals scraper keeps a daily close for ~2,650
// symbols over the same window. Joining those two gives several thousand
// (grade, forward return) pairs TODAY, without a single network call.
//
// WHAT THIS IS NOT. It is not a trading backtest. There is no slippage, no
// commission, no position sizing and no compounding — it measures the SIGNAL,
// not a strategy that trades the signal. Read it as "did names the engine
// called BLOCKBUSTER outperform names it called MIXED", nothing more.
//
// THREE THINGS IT IS CAREFUL ABOUT, because each is a standard way a backtest
// flatters itself:
//
//  1. NO LOOK-AHEAD. Entry is the close of the first session STRICTLY AFTER
//     the filing date. Indian results are routinely published after the close,
//     so buying at the filing-day close would be buying on information that
//     was not public when that price printed. This costs the gap — which is
//     exactly the point, because you could not have had it.
//
//  2. EXCESS, NOT ABSOLUTE. The benchmark is the trimmed-mean return of every
//     symbol in the history over the SAME two dates. In a market that rose
//     30%, an absolute return of +12% is a failure, and only a cross-sectional
//     comparison shows that.
//
//  3. HORIZONS IN SESSIONS, NOT CALENDAR DAYS. A calendar horizon silently
//     shortens over holidays and lands on a non-trading day, which quietly
//     drops the names whose exit fell in a market closure.
//
// AND THE ONE NUMBER THAT DECIDES THE V2 REDESIGN. `by_tier_setup` crosses the
// earnings tier with the chart's Setup grade. If BLOCKBUSTER · Setup D earns
// what BLOCKBUSTER · Setup A earns, the chart contributes nothing to the
// VERDICT and belongs out of the tier (zzz673). If it earns materially less,
// the chart is carrying real information and the gates should keep it. That is
// an empirical question, and this is the measurement that answers it rather
// than another argument about it.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, isRedisAvailable } from '@/lib/kv';
import { gradedKeyCandidates } from '@/lib/graded-cache-key';
import { passesIndiaPreset } from '@/lib/quality-preset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HIST_META = 'india-tech-hist:v2:meta';
const HIST_CHUNK = (i: number) => `india-tech-hist:v2:c${i}`;
const HIST_CHUNKS = 6;

/** Trading sessions held, not calendar days. ~1 week, ~1 month, ~3 months. */
const HORIZONS = [5, 21, 63] as const;

type Series = Record<string, Record<string, number>>;

async function loadHistory(): Promise<{ dates: string[]; series: Series } | null> {
  const meta: any = await kvGet(HIST_META);
  if (!meta || !Array.isArray(meta.dates) || meta.dates.length === 0) return null;
  const dates: string[] = meta.dates;
  const series: Series = {};
  for (let i = 0; i < (meta.chunks || HIST_CHUNKS); i++) {
    const c: any = await kvGet(HIST_CHUNK(i));
    if (!c) continue;
    for (const [sym, arr] of Object.entries(c)) {
      if (!Array.isArray(arr)) continue;
      const m: Record<string, number> = {};
      for (let j = 0; j < arr.length; j++) {
        const v = (arr as any[])[j];
        if (v != null) m[dates[j]] = v;
      }
      series[sym] = m;
    }
  }
  return { dates, series };
}

/** Mean of the middle 80%, so one delisting-grade print cannot set the market. */
function trimmedMean(xs: number[]): number | null {
  if (xs.length < 5) return null;
  const s = [...xs].sort((a, b) => a - b);
  const cut = Math.floor(s.length * 0.1);
  const core = s.slice(cut, s.length - cut);
  if (!core.length) return null;
  return core.reduce((a, b) => a + b, 0) / core.length;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Obs {
  ticker: string;
  filing_date: string;
  tier: string;
  setup: string | null;
  preset: boolean;
  fund: number | null;
  composite: number | null;
  /** excess return in %, per horizon index */
  excess: Array<number | null>;
  /** worst close between entry and the LONGEST horizon reached, in % */
  mae: number | null;
}

function summarise(rows: Obs[], hi: number) {
  const vals = rows.map((r) => r.excess[hi]).filter((x): x is number => x != null);
  if (!vals.length) return { n: 0, avg_excess: null, median_excess: null, hit_rate: null };
  const wins = vals.filter((v) => v > 0).length;
  return {
    n: vals.length,
    avg_excess: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    median_excess: Math.round((median(vals) ?? 0) * 10) / 10,
    hit_rate: Math.round((wins / vals.length) * 100),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(400, Math.max(30, Number(searchParams.get('days')) || 180));

  if (!isRedisAvailable()) {
    return NextResponse.json({ ok: false, error: 'kv_unavailable' }, { status: 503 });
  }

  const hist = await loadHistory();
  if (!hist) {
    return NextResponse.json(
      { ok: false, error: 'no_price_history', note: 'india-tech-hist:v2:meta is empty — the technicals scraper has not run.' },
      { status: 503 },
    );
  }
  const { dates, series } = hist;
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  /** First session index strictly after an ISO date. */
  function entryIndex(iso: string): number {
    // dates is sorted; a linear scan is fine at ~180 entries and avoids an
    // off-by-one in a hand-written binary search on a hot path nobody re-reads.
    for (let i = 0; i < dates.length; i++) if (dates[i] > iso) return i;
    return -1;
  }

  // The market's return between two sessions, MEMOISED.
  //
  // Without this the benchmark is recomputed from scratch for every
  // observation at every horizon — ~2,650 symbols × three horizons × several
  // thousand rows, which is tens of millions of lookups and a request that
  // never returns. There are only ever a few hundred DISTINCT (entry, exit)
  // pairs, because every company filing on the same day shares one.
  const benchCache = new Map<string, number | null>();
  const symbols = Object.keys(series);
  function benchBetween(ei: number, xi: number): number | null {
    const key = `${ei}:${xi}`;
    const hit = benchCache.get(key);
    if (hit !== undefined) return hit;
    const a0 = dates[ei], b0 = dates[xi];
    const peers: number[] = [];
    for (const k of symbols) {
      const s2 = series[k];
      const a = s2[a0], b = s2[b0];
      if (a && b && a > 0) peers.push((b / a - 1) * 100);
    }
    const v = trimmedMean(peers);
    benchCache.set(key, v);
    return v;
  }

  // ── Collect the graded rows ──────────────────────────────────────────────
  const obs: Obs[] = [];
  const scanned: Array<{ date: string; key: string; rows: number }> = [];
  let noPrice = 0;

  for (let back = 0; back < days; back++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - back);
    const date = d.toISOString().slice(0, 10);

    let payload: any = null;
    let usedKey = '';
    for (const k of gradedKeyCandidates(date)) {
      try {
        const v = await kvGet(k);
        if (!v) continue;
        const p = typeof v === 'string' ? JSON.parse(v) : v;
        const n = Object.values(p?.by_tier || {}).reduce((a: number, b: any) => a + (Array.isArray(b) ? b.length : 0), 0);
        if (n > 0) { payload = p; usedKey = k; break; }
      } catch { /* next namespace */ }
    }
    if (!payload) continue;

    const rows: any[] = Object.values(payload.by_tier || {}).flatMap((v: any) => (Array.isArray(v) ? v : []));
    scanned.push({ date, key: usedKey, rows: rows.length });

    for (const r of rows) {
      const sym = String(r.ticker || '').toUpperCase();
      const s = series[sym];
      if (!s) { noPrice++; continue; }
      const fd = r.filing_date || date;
      const ei = entryIndex(fd);
      if (ei < 0) continue;
      const entry = s[dates[ei]];
      if (!entry || entry <= 0) { noPrice++; continue; }

      const excess: Array<number | null> = [];
      for (const h of HORIZONS) {
        const xi = ei + h;
        if (xi >= dates.length) { excess.push(null); continue; }
        const exit = s[dates[xi]];
        if (!exit || exit <= 0) { excess.push(null); continue; }
        const ret = (exit / entry - 1) * 100;

        const bench = benchBetween(ei, xi);
        excess.push(bench == null ? null : Math.round((ret - bench) * 100) / 100);
      }

      // Max adverse excursion over the longest horizon that exists.
      let mae: number | null = null;
      const lastH = HORIZONS[HORIZONS.length - 1];
      let worst = entry;
      for (let j = ei + 1; j <= Math.min(ei + lastH, dates.length - 1); j++) {
        const c = s[dates[j]];
        if (c && c < worst) worst = c;
      }
      if (worst < entry) mae = Math.round((worst / entry - 1) * 1000) / 10;
      else mae = 0;

      obs.push({
        ticker: sym,
        filing_date: fd,
        tier: String(r.tier || '').toUpperCase(),
        setup: r.setup_grade ?? null,
        preset: passesIndiaPreset(r),
        fund: typeof r.fund_composite === 'number' ? r.fund_composite : null,
        composite: typeof r.composite_score === 'number' ? r.composite_score : null,
        excess,
        mae,
      });
    }
  }

  if (!obs.length) {
    return NextResponse.json({
      ok: true, note: 'No graded session in the window joined to a price series.',
      coverage: { scanned: scanned.length, observations: 0, dropped_no_price: noPrice },
    });
  }

  // ── Cuts ─────────────────────────────────────────────────────────────────
  const horizonLabel = HORIZONS.map((h) => `${h}d`);
  const cut = (pred: (o: Obs) => boolean) => HORIZONS.map((_, i) => summarise(obs.filter(pred), i));

  const by_tier: Record<string, any> = {};
  for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
    by_tier[t] = cut((o) => o.tier === t);
  }

  const by_setup: Record<string, any> = {};
  for (const g of ['A', 'B', 'C', 'D']) by_setup[g] = cut((o) => o.setup === g);
  by_setup['none'] = cut((o) => o.setup == null);

  // THE DECIDING TABLE. Top tiers only — a MIXED name's chart is not the
  // question, and splitting four tiers by five setups makes every cell too
  // small to read.
  const by_tier_setup: Record<string, any> = {};
  for (const t of ['BLOCKBUSTER', 'STRONG']) {
    for (const g of ['A', 'B', 'C', 'D']) {
      by_tier_setup[`${t}·${g}`] = cut((o) => o.tier === t && o.setup === g);
    }
  }

  const by_preset = {
    pass: cut((o) => o.preset),
    fail: cut((o) => !o.preset),
    pass_top: cut((o) => o.preset && (o.tier === 'BLOCKBUSTER' || o.tier === 'STRONG')),
  };

  // ── Stop-loss study: what a fixed stop would have done to the top tiers ──
  // A stop is "hit" when the worst close in the window is below the threshold.
  // This OVERSTATES survival slightly (an intraday low can breach a level the
  // close never does) and the note below says so, because a backtest that
  // quietly uses closes to model stops is the most common way this particular
  // measurement lies.
  const top = obs.filter((o) => o.tier === 'BLOCKBUSTER' || o.tier === 'STRONG');
  const stop_study = [5, 7, 10, 15, 20].map((pct) => {
    const stopped = top.filter((o) => o.mae != null && o.mae <= -pct);
    const survived = top.filter((o) => o.mae != null && o.mae > -pct);
    const sv = survived.map((o) => o.excess[2] ?? o.excess[1]).filter((x): x is number => x != null);
    return {
      stop_pct: pct,
      stopped_out: stopped.length,
      stopped_pct: top.length ? Math.round((stopped.length / top.length) * 100) : null,
      survivors: sv.length,
      survivor_avg_excess: sv.length ? Math.round((sv.reduce((a, b) => a + b, 0) / sv.length) * 10) / 10 : null,
    };
  });

  const maes = top.map((o) => o.mae).filter((x): x is number => x != null).sort((a, b) => a - b);

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    horizons: horizonLabel,
    method: {
      entry: 'close of the first session strictly after the filing date (no look-ahead)',
      benchmark: 'trimmed mean of every symbol trading on both dates (cross-sectional)',
      returns: 'EXCESS over that benchmark, in percent',
      caution: 'signal study, not a trading backtest — no costs, slippage, sizing or compounding. Stops modelled on CLOSES, so real intraday stop-outs would be higher.',
    },
    coverage: {
      sessions_scanned: scanned.length,
      observations: obs.length,
      dropped_no_price: noPrice,
      price_history_sessions: dates.length,
      price_history_symbols: Object.keys(series).length,
      first_date: scanned.length ? scanned[scanned.length - 1].date : null,
      last_date: scanned.length ? scanned[0].date : null,
    },
    by_tier,
    by_setup,
    by_tier_setup,
    by_preset,
    stop_study,
    drawdown_percentiles: maes.length
      ? { p10: maes[Math.floor(maes.length * 0.1)], p25: maes[Math.floor(maes.length * 0.25)], median: maes[Math.floor(maes.length * 0.5)] }
      : null,
  });
}
