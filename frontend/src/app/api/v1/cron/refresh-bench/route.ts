// ═══════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE CONVICTION BENCH — cron refresh.
//
// Scans the graded earnings KV (last ~10 IST days) for BLOCKBUSTER + STRONG
// tiers, builds a deduped bench keyed by ticker (newest filing wins), and
// persists it to `bench:server:v1` with a 7-day TTL. This keeps the bench
// fresh from a cron even when no browser tab is open — previously the bench
// only updated when a human opened the Earnings tab.
//
// Auth: secret-gated via verifyCronSecret (requireSecret:true). Reads ?secret=
// or the x-vercel-cron header. Vercel cron can also POST.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvMGet, kvExistsMany } from '@/lib/kv';
import { scanGradedDays, mergePartial, boundEntries } from '@/lib/bench-scan';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { gradedKeyCandidates, GRADED_CACHE_VERSION } from '@/lib/graded-cache-key';
import { withCurrentIndiaRules } from '@/lib/india-regrade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BENCH_KEY = 'bench:server:v1';
const BENCH_TTL_S = 60 * 60 * 24 * 7; // ~7 days
const SCAN_DEADLINE_MS = 45_000;   // zzz919 — stop reading well inside every caller's timeout (60 s book-watch, 90 s scheduler)
const BENCH_MAX_BYTES = 6 * 1024 * 1024;   // zzz919 — kvSet's remote cap is 8 MB; stay clear of it
const SCAN_DAYS = 60;  // zzz421 — was 10; hold the whole earnings season, not just last 10 days

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

interface ParsedEarning {
  ticker: string;
  company: string;
  tier: Tier;
  composite_score: number;
  filing_date: string;
  quarter?: string;
  sector?: string;
  move_pct?: number | null;
  d1_pct?: number | null;
  price?: number | null;
  market_cap_cr?: number | null;
}

interface GradedPayload {
  by_tier?: Record<Tier, ParsedEarning[]>;
}

interface BenchEntry {
  ticker: string;
  company: string;
  tier: Tier;
  composite_score: number;
  filing_date: string;
  quarter?: string;
  move_pct?: number | null;
  sector?: string;
  market_cap_cr?: number | null;
  seen_date: string;
}

// IST date string for `offsetDays` days ago (server tz agnostic).
function istDateStr(offsetDays: number): string {
  const istMs = Date.now() + 5.5 * 3600 * 1000 - offsetDays * 86400 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason },
      { status: auth.reason.includes('not configured') ? 503 : 401 },
    );
  }

  // zzz919 — batched scan (see lib/bench-scan.ts): one EXISTS pipeline over all
  // candidate keys, then MGET of only the newest existing namespace per day,
  // newest day first, under a deadline. The old loop did ~2000 sequential
  // round trips (60 days x 17 namespaces, 2 per miss) and was cut at 90 s -> 502.
  //
  // Rules kept from zzz665/zzz665c/zzz819: the current namespace wins; an
  // EMPTY payload is an absence, not an answer (falls to an older namespace);
  // a legacy day is regraded in memory under the current rules.
  const started = Date.now();
  const deadlineAt = started + SCAN_DEADLINE_MS;
  const rowCount = (p: GradedPayload | null): number =>
    !p?.by_tier ? 0 : (Object.values(p.by_tier) as any[][])
      .reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  const dates: string[] = [];
  for (let offset = 0; offset < SCAN_DAYS; offset++) dates.push(istDateStr(offset));   // newest first

  const scan = await scanGradedDays(dates, {
    candidates: gradedKeyCandidates,
    exists: kvExistsMany,
    mget: (keys) => kvMGet<GradedPayload>(keys),
    rowCount,
    adopt: (hit, key) => withCurrentIndiaRules(hit, key),
    isCurrent: (key) => key.startsWith(`graded:${GRADED_CACHE_VERSION}:`),
    now: Date.now,
  }, deadlineAt);

  const byTicker = new Map<string, any>();  // zzz427 — carry full graded card
  let blockbuster = 0;
  let strong = 0;
  // How many days could only be answered by an ABANDONED cache namespace. A
  // healthy steady state is 0; a high number right after a version bump is
  // expected and should fall to 0 as the new engine re-grades each session.
  const legacyDays = scan.days.filter((d) => d.legacy).length;
  const scannedDays = scan.scannedDays;

  for (const day of scan.days) {   // newest first → first-write-wins keeps the newest filing per ticker
    const bt = day.payload?.by_tier;
    if (!bt) continue;
    const bb = Array.isArray(bt.BLOCKBUSTER) ? bt.BLOCKBUSTER : [];
    const st = Array.isArray(bt.STRONG) ? bt.STRONG : [];
    blockbuster += bb.length;
    strong += st.length;
    for (const row of [...bb, ...st]) {
      if (!row || !row.ticker) continue;
      if (byTicker.has(row.ticker)) continue;
      // zzz427 — store the FULL graded card so bench cards render complete.
      byTicker.set(row.ticker, { ...(row as any), seen_date: day.date });
    }
  }

  let entries: any[] = Array.from(byTicker.values());

  // A scan that ran out of time must not SHRINK the bench: keep the previous
  // entries for the days it never reached.
  if (scan.partial) {
    const reachedDates = dates.filter((d) => !scan.skipped.includes(d));
    const oldestReached = reachedDates.length ? reachedDates[reachedDates.length - 1] : null;
    let prior: any[] = [];
    try { prior = (await kvGet<any>(BENCH_KEY))?.entries ?? []; } catch { /* keep none */ }
    entries = mergePartial(entries, Array.isArray(prior) ? prior : [], oldestReached);
  }

  // Bounded payload: full cards for a whole season can pass what KV should
  // carry; drop the OLDEST names, never the newest, and say so.
  const bounded = boundEntries(entries, BENCH_MAX_BYTES);
  entries = bounded.entries;
  const updatedAt = new Date().toISOString();

  // Do not overwrite a good bench with nothing because the scan found nothing in time.
  if (entries.length > 0 || !scan.partial) {
    await kvSet(
      BENCH_KEY,
      { updatedAt, count: entries.length, entries },
      BENCH_TTL_S,
    );
  }

  return NextResponse.json({
    ok: true,
    graded_cache_version: GRADED_CACHE_VERSION,
    legacyDays,
    legacy_note: legacyDays > 0
      ? `${legacyDays} of ${scannedDays} day(s) were only available under an older cache namespace. Expected right after a version bump; it should fall to 0 as those sessions are re-graded.`
      : undefined,
    scannedDays,
    partial: scan.partial,
    skipped_days: scan.skipped.length,
    partial_note: scan.partial ? `Scan stopped at ${SCAN_DEADLINE_MS / 1000}s; ${scan.skipped.length} oldest day(s) not reached — previous bench kept for them. Next run continues.` : undefined,
    trimmed: bounded.trimmed,
    mget_calls: scan.mgetCalls,
    elapsed_ms: Date.now() - started,
    blockbuster,
    strong,
    total: entries.length,
    updatedAt,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
