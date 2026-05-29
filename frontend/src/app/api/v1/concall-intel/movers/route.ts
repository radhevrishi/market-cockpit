// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0400 — Concall Intel MOVERS view (daily delta detection)
//
// GET /api/v1/concall-intel/movers
//   ?date=YYYY-MM-DD     compare today against this snapshot (defaults to yesterday)
//
// POST /api/v1/concall-intel/movers
//   body: triggers a snapshot of TODAY's top-30 by composite_score into KV.
//   (Called by Vercel cron each evening; manual POST allowed for testing.)
//
// KV layout:
//   concall-snapshot:v1:YYYY-MM-DD  →  Snapshot { generated_at, top: SnapshotEntry[] }
//   concall-snapshot-index:v1       →  array of dates, newest first (cap 60)
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { railwaySelfFetch } from '@/lib/railway-self-fetch'; // PATCH 0985

const SNAPSHOT_TTL = 90 * 24 * 60 * 60;  // 90 days
const SNAPSHOT_KEY = (date: string) => `concall-snapshot:v1:${date}`;
const INDEX_KEY = 'concall-snapshot-index:v1';
const MAX_INDEX = 60;
const SNAPSHOT_SIZE = 30;  // top-30 names per day

export interface SnapshotEntry {
  symbol: string;
  company_name: string;
  tier: string;
  raw_score: number;
  composite_score: number;
  quality_score: number;
  cycle_score: number;
  sentiment_score: number;
  earnings_anchored: boolean;
  tags: string[];
  red_flags: string[];
}

interface Snapshot {
  date: string;
  generated_at: string;
  top: SnapshotEntry[];
}

interface MoverEntry {
  symbol: string;
  company_name: string;
  tier: string;
  composite_today: number;
  composite_yesterday: number | null;
  delta: number | null;
  rank_today: number;
  rank_yesterday: number | null;
}

interface MoversPayload {
  generated_at: string;
  today_date: string;
  reference_date: string | null;
  new_entries: MoverEntry[];
  big_jumps: MoverEntry[];
  lost_momentum: MoverEntry[];
  ranking_today: MoverEntry[];
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─── POST — snapshot today's top picks ────────────────────────────────────
export async function POST(req: NextRequest) {
  // PATCH 0460 — drop the 'mc-bot-2026' hardcoded fallback. Require env
  // CRON_SECRET; if env unset, fail closed (was: anyone with any secret
  // matched the public fallback).
  const required = process.env.CRON_SECRET;
  if (!required) {
    return NextResponse.json({ error: 'cron-secret-unset' }, { status: 503 });
  }
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== required) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isRedisAvailable()) {
    return NextResponse.json({ error: 'KV not available' }, { status: 500 });
  }

  // Fetch today's live-feed data
  const origin = new URL(req.url).origin;
  const r = await railwaySelfFetch(`${origin}/api/v1/concall-intel/live-feed?days=2`, { cache: 'no-store' });
  if (!r.ok) return NextResponse.json({ error: `live-feed HTTP ${r.status}` }, { status: 502 });
  const data = await r.json();

  // Build Top-30 by composite_score (only ULTRA + BULLISH + MIXED_POSITIVE)
  const top: SnapshotEntry[] = (data.filings || [])
    .filter((f: any) => ['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE'].includes(f.bullish?.tier))
    .map((f: any) => ({
      symbol: f.symbol,
      company_name: f.company_name,
      tier: f.bullish.tier,
      raw_score: f.bullish.raw_score,
      composite_score: f.bullish.components?.composite_score ?? f.bullish.raw_score,
      quality_score: f.bullish.components?.quality_score ?? 0,
      cycle_score: f.bullish.components?.cycle_score ?? 0,
      sentiment_score: f.bullish.components?.sentiment_score ?? 0,
      earnings_anchored: f.bullish.components?.earnings_anchored ?? false,
      tags: f.bullish.tags || [],
      red_flags: f.bullish.red_flags || [],
    }))
    .sort((a: SnapshotEntry, b: SnapshotEntry) => b.composite_score - a.composite_score)
    .slice(0, SNAPSHOT_SIZE);

  const date = new Date().toISOString().slice(0, 10);
  const snapshot: Snapshot = {
    date,
    generated_at: new Date().toISOString(),
    top,
  };
  await kvSet(SNAPSHOT_KEY(date), snapshot, SNAPSHOT_TTL);

  // Update index
  const index = (await kvGet<string[]>(INDEX_KEY)) || [];
  const newIndex = [date, ...index.filter(d => d !== date)].slice(0, MAX_INDEX);
  await kvSet(INDEX_KEY, newIndex, SNAPSHOT_TTL);

  return NextResponse.json({ ok: true, snapshot, index_len: newIndex.length });
}

// ─── GET — compute movers vs reference date ───────────────────────────────
export async function GET(req: NextRequest) {
  try {
    return await _handleGET(req);
  } catch (err) {
    // PATCH 0420 — never return HTTP 500. Empty payload + error field.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[movers] uncaught', msg);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      today_date: new Date().toISOString().slice(0, 10),
      reference_date: null,
      new_entries: [],
      big_jumps: [],
      lost_momentum: [],
      ranking_today: [],
      error: `movers failed: ${msg.slice(0, 200)}`,
    });
  }
}

async function _handleGET(req: NextRequest) {
  const referenceDate = req.nextUrl.searchParams.get('date');

  // Build TODAY's snapshot live (don't write to KV — that's POST's job)
  const origin = new URL(req.url).origin;
  const r = await railwaySelfFetch(`${origin}/api/v1/concall-intel/live-feed?days=2`, { cache: 'no-store' });
  if (!r.ok) return NextResponse.json({ error: `live-feed HTTP ${r.status}` }, { status: 502 });
  const data = await r.json();

  const todayTop: SnapshotEntry[] = (data.filings || [])
    .filter((f: any) => ['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE'].includes(f.bullish?.tier))
    .map((f: any) => ({
      symbol: f.symbol,
      company_name: f.company_name,
      tier: f.bullish.tier,
      raw_score: f.bullish.raw_score,
      composite_score: f.bullish.components?.composite_score ?? f.bullish.raw_score,
      quality_score: f.bullish.components?.quality_score ?? 0,
      cycle_score: f.bullish.components?.cycle_score ?? 0,
      sentiment_score: f.bullish.components?.sentiment_score ?? 0,
      earnings_anchored: f.bullish.components?.earnings_anchored ?? false,
      tags: f.bullish.tags || [],
      red_flags: f.bullish.red_flags || [],
    }))
    .sort((a: SnapshotEntry, b: SnapshotEntry) => b.composite_score - a.composite_score)
    .slice(0, SNAPSHOT_SIZE);

  // Find reference snapshot — explicit date OR most recent index entry that isn't today
  const today = new Date().toISOString().slice(0, 10);
  let refDate: string | null = referenceDate;
  if (!refDate && isRedisAvailable()) {
    const index = (await kvGet<string[]>(INDEX_KEY)) || [];
    refDate = index.find(d => d !== today) || null;
  }
  let refSnapshot: Snapshot | null = null;
  if (refDate && isRedisAvailable()) {
    refSnapshot = (await kvGet<Snapshot>(SNAPSHOT_KEY(refDate))) || null;
  }

  const refMap = new Map<string, { entry: SnapshotEntry; rank: number }>();
  if (refSnapshot) {
    refSnapshot.top.forEach((e, idx) => refMap.set(e.symbol, { entry: e, rank: idx + 1 }));
  }
  const todayMap = new Map<string, { entry: SnapshotEntry; rank: number }>();
  todayTop.forEach((e, idx) => todayMap.set(e.symbol, { entry: e, rank: idx + 1 }));

  const newEntries: MoverEntry[] = [];
  const bigJumps: MoverEntry[] = [];
  const lostMomentum: MoverEntry[] = [];
  const rankingToday: MoverEntry[] = [];

  for (const [symbol, today_info] of todayMap.entries()) {
    const ref = refMap.get(symbol);
    const refComposite = ref?.entry.composite_score ?? null;
    const delta = refComposite != null ? today_info.entry.composite_score - refComposite : null;
    const me: MoverEntry = {
      symbol,
      company_name: today_info.entry.company_name,
      tier: today_info.entry.tier,
      composite_today: today_info.entry.composite_score,
      composite_yesterday: refComposite,
      delta,
      rank_today: today_info.rank,
      rank_yesterday: ref?.rank ?? null,
    };
    rankingToday.push(me);
    if (!ref) {
      newEntries.push(me);
    } else if (delta != null && delta >= 2) {
      bigJumps.push(me);
    }
  }

  // Lost momentum: in ref but not in today (or dropped below SNAPSHOT_SIZE)
  if (refSnapshot) {
    for (const [symbol, ref_info] of refMap.entries()) {
      if (!todayMap.has(symbol)) {
        lostMomentum.push({
          symbol,
          company_name: ref_info.entry.company_name,
          tier: ref_info.entry.tier,
          composite_today: 0,
          composite_yesterday: ref_info.entry.composite_score,
          delta: -ref_info.entry.composite_score,
          rank_today: -1,
          rank_yesterday: ref_info.rank,
        });
      }
    }
  }

  // Sort
  newEntries.sort((a, b) => b.composite_today - a.composite_today);
  bigJumps.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  lostMomentum.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));

  const payload: MoversPayload = {
    generated_at: new Date().toISOString(),
    today_date: today,
    reference_date: refDate,
    new_entries: newEntries.slice(0, 10),
    big_jumps: bigJumps.slice(0, 10),
    lost_momentum: lostMomentum.slice(0, 10),
    ranking_today: rankingToday.slice(0, 30),
  };
  return NextResponse.json(payload);
}
