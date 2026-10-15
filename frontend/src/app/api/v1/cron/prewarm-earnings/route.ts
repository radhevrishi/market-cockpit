// ═══════════════════════════════════════════════════════════════════════════
// CRON: EARNINGS SELF-HEALING + SELF-FILLING SWEEP  (zzz417/zzz420)
//
// Runs 4×/day via the GitHub Actions cron bridge (03:00 / 06:00 / 11:00 /
// 14:00 UTC). Keeps the Earnings Opportunities page complete and warm — no
// Hard Refresh, no Backfill, no "Refresh N missing" clicks — for years,
// unattended. Two independent problems, two budgets:
//
//   HEAL  (missing CARDS): a cache written before the day's filings propagated
//          holds far fewer graded cards than the day filed (the 1-of-89 bug),
//          or is empty though the calendar has data. Fix = full force rebuild.
//
//   FILL  (missing DETAIL): the cards are all present but some lack YoY/margin
//          because Screener rate-limited the bulk enrich during the rebuild.
//          Fix = a refreshMissing pass (now serial + paced in the graded route,
//          so it actually completes instead of getting throttled).
//
// RECENT dates (<= RECENT_DAYS) always get force + fill (freshest intraday).
// OLDER dates get a cheap health check and are healed or filled only when
// needed, newest-first, capped by HEAL_BUDGET / FILL_BUDGET and the run Budget (zzz919) so
// the job always finishes inside its 5-min window. Past days are immutable, so
// once complete they're skipped forever — the window converges then maintains.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { secretFromRequest } from '@/lib/request-secret';   // zzz883: header first, ?secret= only for old callers
import { railwaySelfFetch } from '@/lib/railway-self-fetch';
import { kvGet, kvSet } from '@/lib/kv';
import { recheckableDrops, unconfirmedRows, missingDetailCounts, pickStaleRebuild, cashRefetchRows } from '@/lib/india-eo-card-data';  // zzz820 / zzz822 / zzz826
import { GRADED_CACHE_VERSION, GRADED_CACHE_LEGACY } from '@/lib/graded-cache-key';
import { INDIA_REGRADABLE_FROM } from '@/lib/india-regrade';
import { Budget, orderOffsets, nextCursor, MIN_STEP_MS } from '@/lib/prewarm-budget';   // zzz919

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // 5 min

const WINDOW_DAYS = 60;   // zzz822 — was 45; the page's 60-session window reaches back ~60 days
const RECENT_DAYS = 2;
const HEAL_BUDGET = 5;         // max force-rebuilds (missing cards) per run
const FILL_BUDGET = 5;         // max refreshMissing passes (missing detail) per run
const CURSOR_KEY = 'prewarm-earnings:cursor:v1';   // zzz919 — where the older-date rotation resumes
const UNDERCOUNT_RATIO = 0.6;
const MIN_RAW = 8;
// zzz822 — was 8: a date with 1–7 cards missing numbers was never refilled
// ("51 companies listed without numbers"). Any such card now qualifies; the
// per-date lock and the per-run budget keep it bounded.
const FILL_THRESHOLD = 1;      // # of un-enriched cards that triggers a fill pass
const FILL_LOCK_S = 20 * 3600;
// zzz822 — STALE REBUILD: days stored only under rules too old to regrade
// in-process (below INDIA_REGRADABLE_FROM — v14, v10 …) kept their old,
// ungated grades for ever. They are rebuilt under the current rules, oldest
// rules first, STALE_BUDGET per run, each date at most once per lock period.
// The scan (EXISTS only, never the payloads) is cached for STALE_SCAN_TTL_S.
const STALE_WINDOW_DAYS = 90;
const STALE_BUDGET = 1;
const STALE_LOCK_S = 20 * 3600;
const STALE_SCAN_TTL_S = 6 * 3600;
// zzz820 — RE-CHECK (companies the grader DROPPED): a company whose new quarter
// was not on Screener at the first scan, or whose filing was not yet confirmed,
// used to stay dropped for good — the health check above never looked at
// `_dropped`, so August results were still "not on Screener yet" in late
// September. A date with at least RECHECK_MIN such companies, within
// RECHECK_MAX_AGE_DAYS, is rebuilt at most once per RECHECK_LOCK_S, and at
// most RECHECK_BUDGET dates per run, newest first.
// zzz820b — a date holding ANY row whose growth was measured against an
// unverified year-ago quarter (the gappy-Screener positional bug) is re-checked
// under the same bounds, so its tier is rebuilt from date-matched figures.
// zzz826 — a date holding ANY row whose cash figures predate the current cash
// rule (no same-year basis, or a real ratio hidden by the old ±8x limit) is
// re-checked under the same bounds. A re-check is a REFETCH: the rebuild asks
// the graded route (refetch=1) to fetch the flagged tickers with the
// enrichment cache bypassed, so corrected figures actually come back.
const RECHECK_BUDGET = 2;
// zzz865: was 3, so one or two waiting companies (ANSALAPI, HAWAENG, HIIL on 3 Oct) were never retried by the schedule; now any one qualifies
const RECHECK_MIN = 1;
const RECHECK_MAX_AGE_DAYS = 60;
const RECHECK_LOCK_S = 20 * 3600;
// zzz865: results filed in the last 3 days are retried every ~5 hours (four schedule runs a day), older dates keep the 20 hour lock
const RECHECK_LOCK_RECENT_S = 5 * 3600;

/** EXISTS for many keys in one Upstash pipeline call (never reads payloads).
 *  Null when the REST backend is not configured. */
async function kvExistsMany(keys: string[]): Promise<boolean[] | null> {
  if (keys.length === 0) return [];
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    (await import('@/lib/kv')).kvCountExternal('exists', keys[0], keys.length);   // zzz1049: each EXISTS is one billed command
    const r = await fetch(`${url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(keys.map((k) => ['EXISTS', k])),
      cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (!Array.isArray(j) || j.length !== keys.length) return null;
    return j.map((x: any) => Number(x?.result) > 0);
  } catch { return null; }
}

function tierTotal(g: any): number {
  return Object.values(g?.by_tier || {}).reduce<number>(
    (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = secretFromRequest(req) || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelHeader = '' /* zzz883: x-vercel-cron no longer trusted (forgeable on Railway) */;
  if (!vercelHeader && expected && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const windowDays = Math.min(120, Math.max(1, parseInt(searchParams.get('days') || String(WINDOW_DAYS), 10) || WINDOW_DAYS));
  const healBudgetMax = Math.max(0, parseInt(searchParams.get('heal') || String(HEAL_BUDGET), 10));
  const fillBudgetMax = Math.max(0, parseInt(searchParams.get('fill') || String(FILL_BUDGET), 10));
  const start = Date.now();
  // zzz919 — ONE budget for the whole run. The scheduler allows 240 s; the old
  // run could not know that and was cut mid-step. Every step below asks it.
  const budget = new Budget(start);
  const today = new Date();

  const results: any[] = [];
  let healsUsed = 0, fillsUsed = 0, healed = 0, filled = 0, refreshed = 0, healthy = 0;
  let rechecksUsed = 0, rechecked = 0;
  const recheckBudgetMax = Math.max(0, parseInt(searchParams.get('recheck') || String(RECHECK_BUDGET), 10) || 0);
  let budgetStopped = false;

  // zzz429 — rebuild the server Conviction Beats bench FIRST (it is now a
  // batched scan that finishes in seconds — zzz919). Timeout is bounded by the
  // run budget, not a fixed 110 s.
  let benchRefreshed: any = null;
  try {
    const bs = expected ? `?secret=${encodeURIComponent(expected)}` : '';
    const br = await railwaySelfFetch(`${origin}/api/v1/cron/refresh-bench${bs}`, { cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(60_000)) });
    if (br.ok) { const bj = await br.json(); benchRefreshed = { count: bj?.count, blockbuster: bj?.blockbuster, strong: bj?.strong, partial: bj?.partial }; }
    else benchRefreshed = { status: br.status };
  } catch (e: any) { benchRefreshed = { error: e?.message || String(e) }; }

  let themeRotationWarmed: any = null;
  // zzz477 — piggyback the CONCALL INTEL + TRANSFORMATION RADAR warm on this
  // already-scheduled 4×/day sweep (the GitHub workflow file is protected and
  // can't be edited via remote tools). concall-intel-warm extracts fresh live-feed
  // PDFs and re-grades the transformation screener (days=60 & limit=80 — the exact
  // key the Radar AND the home Daily Signal Inbox read), so both pages stay graded
  // on the newest filings automatically, no user ↻ Fresh. Fire-and-forget: never
  // let it block or fail the earnings sweep.
  let concallWarmed: any = null;
  const runOptionalWarms = async () => {
  try {
    const cs = expected ? `?secret=${encodeURIComponent(expected)}` : '';
    const cr = await railwaySelfFetch(`${origin}/api/v1/cron/concall-intel-warm${cs}`, { cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(120_000)) });
    concallWarmed = cr.ok ? (await cr.json())?.results ?? { ok: true } : { status: cr.status };
  } catch (e: any) { concallWarmed = { error: e?.message || String(e) }; }

  // zzz483 — also pre-warm the THEME ROTATION dashboard (both regions) on the same
  // 4×/day sweep so it's graded on fresh prices and opens instantly, fully
  // unattended for the long term. Fire-and-forget, never blocks the earnings sweep.
  try {
    const rr = await Promise.all(['us', 'india'].map((rg) =>
      railwaySelfFetch(`${origin}/api/market/theme-rotation?region=${rg}&refresh=1`, { cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(90_000)) })
        .then((r) => r.ok).catch(() => false)));
    themeRotationWarmed = { us: rr[0], india: rr[1] };
  } catch (e: any) { themeRotationWarmed = { error: e?.message || String(e) }; }
  };
  // zzz919 — these two warms run IN PARALLEL with the date loop (they used to run
  // before it, in series, and ate up to 210 s). Each is capped by the run budget.
  const warmsPromise = runOptionalWarms();

  const forceGraded = async (date: string) => {
    const r = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&force=1`, {
      cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(180_000)),
    });
    return r.ok ? await r.json() : null;
  };
  const recheckGraded = async (date: string) => {
    const r = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&force=1&refetch=1`, {
      cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(180_000)),
    });
    return r.ok ? await r.json() : null;
  };
  const fillGraded = async (date: string) => {
    const r = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&refreshMissing=1`, {
      cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(180_000)),
    });
    return r.ok ? await r.json() : null;
  };

  const lockedFor = async (key: string, ttlS: number): Promise<boolean> => {
    try {
      const t = await kvGet<number>(key);
      return !!t && Date.now() - Number(t) < ttlS * 1000;
    } catch { return false; }
  };

  // ── zzz822 — STALE REBUILD (oldest rules first), before the daily sweep ──
  let staleRebuilt: any = null;
  if (STALE_BUDGET > 0 && budget.canStart(60_000)) {
    try {
      const scanKey = `graded:stale-scan:${GRADED_CACHE_VERSION}`;
      let scan: { at: number; stale: Array<{ date: string; version: string }> } | null = null;
      try { scan = await kvGet<any>(scanKey); } catch { scan = null; }
      if (!scan || !Array.isArray(scan.stale) || Date.now() - Number(scan.at) > STALE_SCAN_TTL_S * 1000) {
        const dates: string[] = [];
        for (let k = RECENT_DAYS + 1; k <= STALE_WINDOW_DAYS; k++) {
          const d = new Date(today); d.setDate(d.getDate() - k); dates.push(d.toISOString().slice(0, 10));
        }
        const cur = await kvExistsMany(dates.map((d) => `graded:${GRADED_CACHE_VERSION}:${d}`));
        if (cur) {
          let left = dates.filter((_, k) => !cur[k]);
          // Fast-regradable namespaces are handled in-process by graded-window.
          const fast = INDIA_REGRADABLE_FROM.filter((v) => v !== GRADED_CACHE_VERSION);
          if (left.length && fast.length) {
            const keys = left.flatMap((d) => fast.map((v) => `graded:${v}:${d}`));
            const ex = await kvExistsMany(keys);
            if (ex) left = left.filter((_, k) => !fast.some((__, m) => ex[k * fast.length + m]));
          }
          const old = GRADED_CACHE_LEGACY.filter((v) => !INDIA_REGRADABLE_FROM.includes(v));
          const stale: Array<{ date: string; version: string }> = [];
          if (left.length && old.length) {
            const keys = left.flatMap((d) => old.map((v) => `graded:${v}:${d}`));
            const ex = await kvExistsMany(keys);
            if (ex) left.forEach((d, k) => {
              const m = old.findIndex((_, mm) => ex[k * old.length + mm]);   // newest old namespace present
              if (m >= 0) stale.push({ date: d, version: old[m] });
            });
          }
          scan = { at: Date.now(), stale };
          try { await kvSet(scanKey, scan, STALE_SCAN_TTL_S); } catch {}
        }
      }
      const pick = scan ? await pickStaleRebuild(scan.stale, GRADED_CACHE_LEGACY, (d) => lockedFor(`graded:stale-rebuild-lock:${d}`, STALE_LOCK_S)) : null;
      if (pick) {
        try { await kvSet(`graded:stale-rebuild-lock:${pick.date}`, Date.now(), STALE_LOCK_S); } catch {}
        const g = await forceGraded(pick.date);
        staleRebuilt = { date: pick.date, from: pick.version, ok: !!g, total: g ? tierTotal(g) : null, remaining: (scan?.stale.length || 1) - 1 };
        if (g && scan) {
          scan = { at: scan.at, stale: scan.stale.filter((x) => x.date !== pick.date) };
          try { await kvSet(`graded:stale-scan:${GRADED_CACHE_VERSION}`, scan, STALE_SCAN_TTL_S); } catch {}
        }
      } else {
        staleRebuilt = { none: true, stale_known: scan?.stale.length ?? null };
      }
    } catch (e: any) { staleRebuilt = { error: e?.message || String(e) }; }
  }

  const recentlyRechecked = async (date: string, recent = false): Promise<boolean> => {
    try {
      const t = await kvGet<number>(`graded:recheck-lock:${date}`);
      return !!t && Date.now() - Number(t) < (recent ? RECHECK_LOCK_RECENT_S : RECHECK_LOCK_S) * 1000;
    } catch { return false; }
  };

  // zzz919 — newest 12 dates every run; older dates rotate from a stored cursor
  // so a run that stops early is continued by the next slot, not repeated.
  let cursor = 0;
  try { cursor = Number(await kvGet<number>(CURSOR_KEY)) || 0; } catch { cursor = 0; }
  const offsets = orderOffsets(windowDays, cursor);
  let firstUnreached: number | null = null;
  for (const i of offsets) {
    if (!budget.canStart(MIN_STEP_MS)) { budgetStopped = true; firstUnreached = i; break; }
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const entry: any = { date };

    try {
      if (i <= RECENT_DAYS) {
        try {
          const liveRes = await railwaySelfFetch(`${origin}/api/v1/earnings/today-live?date=${date}&force=1`, {
            cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(20_000)),
          });
          entry.today_live_status = liveRes.status;
          if (liveRes.ok) entry.today_live_count = (await liveRes.json())?.count || 0;
        } catch (e: any) { entry.today_live_error = e?.message || String(e); }

        const g = await forceGraded(date);
        if (g) entry.graded_total = tierTotal(g);
        const f = await fillGraded(date);   // always fill the hot dates
        if (f) { entry.graded_total = tierTotal(f); entry.refresh_msg = f?._refresh; }
        entry.action = 'refreshed+filled';
        refreshed++;
      } else {
        const chk = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}`, {
          cache: 'no-store', signal: AbortSignal.timeout(budget.timeout(30_000)),
        });
        entry.graded_status = chk.status;
        let cand = 0, raw = 0, failed = 0;
        let waiting = 0;
        let unconfirmed = 0;   // zzz820b — rows whose growth used an unverified year-ago quarter
        let noData = 0, noPrice = 0;   // zzz822
        let cashStale = 0;             // zzz826 — rows whose cash figures predate the current rule
        if (chk.ok) {
          const j = await chk.json();
          waiting = recheckableDrops(j?._dropped);
          entry.waiting_for_data = waiting;
          unconfirmed = unconfirmedRows(j);
          if (unconfirmed) entry.unconfirmed_rows = unconfirmed;
          cashStale = cashRefetchRows(j);
          if (cashStale) entry.cash_stale_rows = cashStale;
          ({ noData, noPrice } = missingDetailCounts(j));
          if (noData) entry.no_data = noData;
          if (noPrice) entry.no_price = noPrice;
          cand = Number(j?.candidates_total) || tierTotal(j);
          raw = Number(j?.raw_items_total) || 0;
          failed = Array.isArray(j?._failed_tickers) ? j._failed_tickers.length : 0;
          entry.graded_total = cand; entry.raw_items_total = raw; entry.failed = failed;
        }
        const undercounted = (raw >= MIN_RAW && cand < UNDERCOUNT_RATIO * raw) || (cand === 0 && raw >= MIN_RAW);
        if (undercounted && healsUsed < healBudgetMax) {
          const g = await forceGraded(date);
          if (g) entry.graded_total_after = tierTotal(g);
          // a fresh rebuild often leaves an enrichment tail — fill it if budget allows
          if (fillsUsed < fillBudgetMax) { const f = await fillGraded(date); if (f) { entry.graded_total_after = tierTotal(f); entry.refresh_msg = f?._refresh; } fillsUsed++; }
          entry.action = 'healed'; healsUsed++; healed++;
        } else if (Math.max(failed, noData) >= FILL_THRESHOLD && fillsUsed < fillBudgetMax
                   && !(await lockedFor(`graded:fill-lock:${date}`, FILL_LOCK_S))) {
          try { await kvSet(`graded:fill-lock:${date}`, Date.now(), FILL_LOCK_S); } catch {}
          const f = await fillGraded(date);
          if (f) { entry.graded_total = tierTotal(f); entry.refresh_msg = f?._refresh; entry.failed_after = Array.isArray(f?._failed_tickers) ? f._failed_tickers.length : undefined; }
          entry.action = 'filled'; fillsUsed++; filled++;
        // zzz822 — cards with no share price are re-fetched by a rebuild (the
        // fill pass only targets cards missing financial numbers).
        } else if ((waiting >= RECHECK_MIN || unconfirmed > 0 || noPrice > 0 || cashStale > 0) && i <= RECHECK_MAX_AGE_DAYS && rechecksUsed < recheckBudgetMax
                   && !(await recentlyRechecked(date, i <= 3))) {
          // zzz820 — rebuild so dropped companies are graded once their data lands.
          // zzz826 — with the flagged tickers re-fetched, not re-read from cache.
          try { await kvSet(`graded:recheck-lock:${date}`, Date.now(), RECHECK_LOCK_S); } catch {}
          const g = await recheckGraded(date);
          if (g) { entry.graded_total_after = tierTotal(g); entry.waiting_after = recheckableDrops(g?._dropped); entry.unconfirmed_after = unconfirmedRows(g); entry.cash_stale_after = cashRefetchRows(g); }
          entry.action = 'rechecked-dropped'; rechecksUsed++; rechecked++;
        } else if (undercounted) {
          entry.action = 'heal-deferred (budget)'; budgetStopped = true;
        } else if (Math.max(failed, noData) >= FILL_THRESHOLD) {
          entry.action = 'fill-deferred (budget or locked)';
        } else {
          entry.action = 'healthy'; healthy++;
        }
      }
    } catch (e: any) {
      entry.error = e?.message || String(e);
    }
    results.push(entry);
  }

  // Where the next slot resumes (0 = everything reached).
  try { await kvSet(CURSOR_KEY, firstUnreached === null ? 0 : nextCursor(firstUnreached), 7 * 86400); } catch { /* best effort */ }
  await warmsPromise;   // already bounded by the budget

  return NextResponse.json({
    status: 'ok',
    bench: benchRefreshed,
    concall_warm: concallWarmed,   // zzz477
    theme_rotation_warm: themeRotationWarmed,   // zzz483
    window_days: windowDays,
    scanned: results.length,
    stale_rebuild: staleRebuilt,   // zzz822
    refreshed, healed, filled, healthy, rechecked,
    heals_used: healsUsed, fills_used: fillsUsed, rechecks_used: rechecksUsed,
    budget_stopped: budgetStopped,
    // zzz919 — running out of time is a PARTIAL SUCCESS: the next slot continues
    partial: budgetStopped,
    note: budgetStopped ? `Stopped at ${Math.round(budget.elapsed() / 1000)}s of ${Math.round((budget.elapsed() + budget.remaining()) / 1000)}s budget; ${offsets.length - results.length} date(s) left for the next run (cursor saved).` : undefined,
    elapsed_ms: Date.now() - start,
    results,
    completed_at: new Date().toISOString(),
  });
}

export async function POST(req: Request) { return GET(req); }
