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
import { kvGet, kvSet } from '@/lib/kv';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { gradedKeyCandidates, GRADED_CACHE_VERSION } from '@/lib/graded-cache-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;  // zzz421 — 60-day scan needs a little more headroom

const BENCH_KEY = 'bench:server:v1';
const BENCH_TTL_S = 60 * 60 * 24 * 7; // ~7 days
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

  // Iterate newest date first so first-write-wins yields the newest filing
  // per ticker.
  const byTicker = new Map<string, any>();  // zzz427 — carry full graded card
  let blockbuster = 0;
  let strong = 0;
  let scannedDays = 0;
  // How many days could only be answered by an ABANDONED cache namespace. A
  // healthy steady state is 0; a high number right after a version bump is
  // expected and should fall to 0 as the new engine re-grades each session.
  let legacyDays = 0;

  for (let offset = 0; offset < SCAN_DAYS; offset++) {
    const dateStr = istDateStr(offset);
    // zzz665 — this read used a HARD-CODED 'graded:v10:' while the graded route
    // had moved on to v14. A kvGet on a key nobody writes returns null, and
    // null here means "nothing filed that day", so the cron rebuilt the bench
    // from the previous generation of cached sessions and reported success
    // every night. The key now comes from ONE definition both sides import.
    //
    // The legacy fallback is deliberate: on the day a version is bumped nothing
    // has been written to the new namespace yet, and without it the bench would
    // empty itself overnight. Current key always wins; older ones only answer
    // for a day the current engine has not graded yet.
    let payload: GradedPayload | null = null;
    let usedLegacy = false;
    for (const key of gradedKeyCandidates(dateStr)) {
      try {
        const hit = await kvGet<GradedPayload>(key);
        if (hit?.by_tier) {
          payload = hit;
          if (!key.startsWith(`graded:${GRADED_CACHE_VERSION}:`)) usedLegacy = true;
          break;
        }
      } catch { /* try the next namespace */ }
    }
    if (usedLegacy) legacyDays++;
    scannedDays++;
    if (!payload || !payload.by_tier) continue;

    const bb = Array.isArray(payload.by_tier.BLOCKBUSTER) ? payload.by_tier.BLOCKBUSTER : [];
    const st = Array.isArray(payload.by_tier.STRONG) ? payload.by_tier.STRONG : [];
    blockbuster += bb.length;
    strong += st.length;

    for (const row of [...bb, ...st]) {
      if (!row || !row.ticker) continue;
      const key = row.ticker;
      if (byTicker.has(key)) continue; // newest date already won (first-write-wins)
      // zzz427 — store the FULL graded card so bench cards render complete
      // (financials, OPM, PE, drift, quality flags) without any client rebuild.
      byTicker.set(key, { ...(row as any), seen_date: dateStr });
    }
  }

  const entries = Array.from(byTicker.values());
  const updatedAt = new Date().toISOString();

  await kvSet(
    BENCH_KEY,
    { updatedAt, count: entries.length, entries },
    BENCH_TTL_S,
  );

  return NextResponse.json({
    ok: true,
    graded_cache_version: GRADED_CACHE_VERSION,
    legacyDays,
    legacy_note: legacyDays > 0
      ? `${legacyDays} of ${scannedDays} day(s) were only available under an older cache namespace. Expected right after a version bump; it should fall to 0 as those sessions are re-graded.`
      : undefined,
    scannedDays,
    blockbuster,
    strong,
    total: entries.length,
    updatedAt,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
