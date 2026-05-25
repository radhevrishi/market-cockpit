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

// PATCH 0819: removed force-dynamic so Cache-Control headers aren't overridden by Next.js. Query params still force dynamic at runtime.
export const runtime = 'nodejs';
export const maxDuration = 30; // PATCH 0818

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
  // PATCH 0734 — bumped v1→v2 to invalidate any cached payloads built with
  // the old (unsanitized) company-name extractor. The new sanitizer +
  // aggregator-side `looksLikeCompany` filter would otherwise be masked
  // by stale entries serving "Nazara for Rs 216 crore"-style garbage.
  const cacheKey = `super-investor-flow:v2:${days}d`;

  try {
    const cached = await kvGet<any>(cacheKey);
    if (cached && cached._ts && Date.now() - cached._ts < 30 * 60 * 1000) {
      return NextResponse.json({ ...cached, cached: true }, { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=1800' } });  // PATCH 0818 — flow data changes slowly
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
  // PATCH 0734 — defensive secondary filter so even if super-investor-news
  // sanitizer ever misses something, the home Super Investors panel doesn't
  // render garbage. Rejects company strings that contain pricing fragments,
  // URL hints, or anything that doesn't look like a real company name.
  const looksLikeCompany = (s: string): boolean => {
    if (!s) return false;
    if (s.length < 3 || s.length > 45) return false;
    if (!/^[A-Za-z]/.test(s)) return false;
    // Pricing / quantity contaminants
    if (/\b(?:Rs\.?|INR|USD|EUR|₹|\$)\s*[\d,.]/i.test(s)) return false;
    if (/\b(?:crore|lakh|million|billion|cr\.?\s*\d)\b/i.test(s)) return false;
    if (/\b(?:per\s*share|each|@)\b/i.test(s)) return false;
    // URL hints
    if (/\b(?:\.com|\.in|\.net|http|www\.|moneycontrol|trendlyne|bloomberg)\b/i.test(s)) return false;
    // Verb phrases that mean it captured a sentence, not a name
    if (/\b(?:bought|sold|adds|trims|exits|raises|cuts|holds|owns|reduces|increases)\b/i.test(s)) return false;
    // Q1 FY25 / first time / etc.
    if (/\b(?:Q[1-4]|FY\d{2}|first\s*time|new\s*entry)\b/i.test(s)) return false;
    return true;
  };

  const byCo = new Map<string, FlowRow>();
  let rejectedCount = 0;
  for (const { investor, move } of allMoves) {
    if (!move.company || move.confidence === 'LOW') continue;
    if (!looksLikeCompany(move.company)) { rejectedCount++; continue; }
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

  // PATCH 0729 — Upstash KV SET was failing on 180d payload (UpstashError:
  // 'Command fail'). Likely cause: payload exceeded Upstash 1 MiB request
  // size limit. Counter-measures:
  //   1. Build a TRIMMED variant for cache write: top 30 rows + truncated
  //      investors list per row (cap 8) + short ISO dates (no ms). This
  //      typically halves the payload size while preserving the entire
  //      shape consumers depend on.
  //   2. Size-check before SET — if still > 900 KB, log + skip cache
  //      rather than retry. The route already returns 200 with fresh data
  //      so the user-facing output is unaffected.
  //   3. Longer TTL for larger windows (180d data changes slowly): 30 min
  //      for ≤30d, 60 min for ≤90d, 120 min for 180d. Fewer SET attempts
  //      = fewer chances to fail.
  try {
    const trimmedRows = rows.slice(0, 30).map((r) => ({
      ticker: (r.ticker || '').slice(0, 80),
      company: (r.company || '').slice(0, 80),
      addCount: r.addCount,
      exitCount: r.exitCount,
      netActions: r.netActions,
      totalSignalScore: Math.round(r.totalSignalScore * 10) / 10,  // 1 decimal
      investors: r.investors.slice(0, 8),
      topDirection: r.topDirection,
      lastMoveAt: (r.lastMoveAt || '').slice(0, 10),               // YYYY-MM-DD only
    }));
    const cachePayload = { ...payload, rows: trimmedRows, _ts: Date.now() };
    const sizeBytes = JSON.stringify(cachePayload).length;
    if (sizeBytes > 900_000) {
      console.warn(`[super-investor-flow] cache SKIPPED — payload ${(sizeBytes / 1024).toFixed(0)} KB exceeds 900 KB safe limit for ${days}d window`);
    } else {
      const ttlSec = days <= 30 ? 30 * 60 : days <= 90 ? 60 * 60 : 120 * 60;
      await kvSet(cacheKey, cachePayload, ttlSec);
    }
  } catch (err) {
    // KV write failure must NEVER break the response — log + continue.
    console.warn('[super-investor-flow] KV SET failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json(payload, { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=1800' } });  // PATCH 0818 — flow data changes slowly
}
