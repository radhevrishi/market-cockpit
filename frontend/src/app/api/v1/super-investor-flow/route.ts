// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR FLOW MOMENTUM (PATCH 0493)
//
// GET /api/v1/super-investor-flow?days=30
//
// Fans out across all 21 super investors via the existing
// /api/v1/super-investor-news endpoint and aggregates parsed BUY/ADD/TRIM/EXIT
// moves into a per-ticker flow signal. Returns net accumulation/distribution
// momentum across the roster — institutional accumulation heatmap.
// KV-cached 30 min to avoid hammering RSS sources.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { SUPER_INVESTORS } from '@/lib/super-investors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface MoveLite {
  direction: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'UNKNOWN';
  company?: string;
  stakePct?: number;
  stakeFromPct?: number;
  stakeDeltaPct?: number;
  signalScore?: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  publishedAt?: string;
}

interface FlowRow {
  ticker: string;        // best-guess ticker — derived from company name if explicit ticker absent
  company: string;
  addCount: number;
  exitCount: number;
  netActions: number;    // adds - exits (positive = accumulation)
  totalSignalScore: number;
  investors: string[];   // unique investor names who moved on this name
  topDirection: 'ACCUM' | 'DISTRIB' | 'MIXED' | 'NEUTRAL';
  lastMoveAt: string;
}

function normalizeCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|company|industries|industrial|corp(oration)?|plc)\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30', 10);
  const cacheKey = `super-investor-flow:v1:${days}d`;

  try {
    const cached = await kvGet<any>(cacheKey);
    if (cached && cached._ts && Date.now() - cached._ts < 30 * 60 * 1000) {
      return NextResponse.json({ ...cached, cached: true });
    }
  } catch {}

  const origin = new URL(request.url).origin;
  const cutoffMs = Date.now() - days * 86_400_000;

  // Fan out — fetch news for each investor in parallel (concurrency limited).
  const allMoves: Array<{ investor: string; move: MoveLite }> = [];
  const CONC = 5;
  for (let i = 0; i < SUPER_INVESTORS.length; i += CONC) {
    const batch = SUPER_INVESTORS.slice(i, i + CONC);
    await Promise.all(batch.map(async (inv) => {
      try {
        const u = `${origin}/api/v1/super-investor-news?query=${encodeURIComponent(inv.newsQuery)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        const res = await fetch(u, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        const moves: MoveLite[] = Array.isArray(data?.moves) ? data.moves : [];
        for (const m of moves) {
          if (m.publishedAt && new Date(m.publishedAt).getTime() < cutoffMs) continue;
          allMoves.push({ investor: inv.name, move: m });
        }
      } catch {}
    }));
  }

  // Aggregate by company (canonical key — exact ticker often not parseable from news).
  const byCo = new Map<string, FlowRow>();
  for (const { investor, move } of allMoves) {
    if (!move.company || move.confidence === 'LOW') continue;
    const key = normalizeCompany(move.company);
    if (!key || key.length < 3) continue;
    if (!byCo.has(key)) {
      byCo.set(key, {
        ticker: move.company,         // display name; real ticker only known via static map
        company: move.company,
        addCount: 0, exitCount: 0, netActions: 0,
        totalSignalScore: 0,
        investors: [],
        topDirection: 'NEUTRAL',
        lastMoveAt: move.publishedAt || new Date().toISOString(),
      });
    }
    const row = byCo.get(key)!;
    if (move.direction === 'BUY' || move.direction === 'ADD') row.addCount++;
    else if (move.direction === 'EXIT' || move.direction === 'TRIM') row.exitCount++;
    row.totalSignalScore += move.signalScore || 0;
    if (!row.investors.includes(investor)) row.investors.push(investor);
    if (move.publishedAt && move.publishedAt > row.lastMoveAt) row.lastMoveAt = move.publishedAt;
  }

  // Compute net + dominant direction.
  for (const row of byCo.values()) {
    row.netActions = row.addCount - row.exitCount;
    if (row.netActions >= 2) row.topDirection = 'ACCUM';
    else if (row.netActions <= -2) row.topDirection = 'DISTRIB';
    else if (row.addCount > 0 && row.exitCount > 0) row.topDirection = 'MIXED';
    else if (row.netActions > 0) row.topDirection = 'ACCUM';
    else if (row.netActions < 0) row.topDirection = 'DISTRIB';
    else row.topDirection = 'NEUTRAL';
  }

  const rows = Array.from(byCo.values())
    .sort((a, b) => Math.abs(b.netActions) - Math.abs(a.netActions) || b.totalSignalScore - a.totalSignalScore)
    .slice(0, 50);

  const payload = {
    days,
    rows,
    counts: {
      total: rows.length,
      accumulation: rows.filter((r) => r.topDirection === 'ACCUM').length,
      distribution: rows.filter((r) => r.topDirection === 'DISTRIB').length,
      mixed: rows.filter((r) => r.topDirection === 'MIXED').length,
    },
    generated_at: new Date().toISOString(),
    cached: false,
  };

  try {
    await kvSet(cacheKey, { ...payload, _ts: Date.now() }, 30 * 60);
  } catch {}

  return NextResponse.json(payload);
}
