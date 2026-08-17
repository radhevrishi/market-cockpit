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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BENCH_KEY = 'bench:server:v1';
const BENCH_TTL_S = 60 * 60 * 24 * 7; // ~7 days
const SCAN_DAYS = 10;

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
  const byTicker = new Map<string, BenchEntry>();
  let blockbuster = 0;
  let strong = 0;
  let scannedDays = 0;

  for (let offset = 0; offset < SCAN_DAYS; offset++) {
    const dateStr = istDateStr(offset);
    let payload: GradedPayload | null = null;
    try {
      payload = await kvGet<GradedPayload>('graded:v10:' + dateStr);
    } catch {
      payload = null;
    }
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
      byTicker.set(key, {
        ticker: row.ticker,
        company: row.company,
        tier: row.tier,
        composite_score: row.composite_score,
        filing_date: row.filing_date,
        quarter: row.quarter,
        move_pct: row.move_pct ?? null,
        sector: row.sector,
        market_cap_cr: row.market_cap_cr ?? null,
        seen_date: dateStr,
      });
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
