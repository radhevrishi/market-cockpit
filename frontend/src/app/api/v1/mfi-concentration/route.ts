// ════════════════════════════════════════════════════════════════════════════
// MFI CONCENTRATION HEATMAP — PATCH 1081c
// Aggregates super-investor-flow rows into a per-ticker concentration ranking.
// GET /api/v1/mfi-concentration?days=90&limit=30
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { internalBase } from '@/lib/internal-base';

export const runtime = 'nodejs';
export const maxDuration = 45;

interface FlowRow {
  ticker: string; company: string;
  addCount: number; exitCount: number; netActions: number;
  totalSignalScore: number; investors: string[];
  topDirection: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'NEUTRAL';
  lastMoveAt: string;
}
interface ConcentrationRow {
  ticker: string; company: string;
  investors: string[]; investorCount: number;
  netActions: number; signalScore: number;
  concentrationScore: number;
  direction: 'ACCUMULATION' | 'DISTRIBUTION' | 'MIXED';
  lastMoveAt: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.max(7, Math.min(365, Number(searchParams.get('days') || '90')));
  const limit = Math.max(5, Math.min(100, Number(searchParams.get('limit') || '30')));

  let flow: { rows: FlowRow[] } | null = null;
  try {
    const base = internalBase();
    const res = await fetch(`${base}/api/v1/super-investor-flow?days=${days}`, { cache: 'no-store' });
    if (res.ok) flow = await res.json();
  } catch (err) {
    return NextResponse.json({ error: 'flow fetch failed', detail: String(err) }, { status: 502 });
  }
  if (!flow || !Array.isArray(flow.rows)) {
    return NextResponse.json({ asOf: new Date().toISOString(), days, count: 0, rows: [] });
  }

  const rows: ConcentrationRow[] = flow.rows
    .map((r) => {
      const investorCount = Array.isArray(r.investors) ? r.investors.length : 0;
      const netActions = r.netActions || 0;
      const concentrationScore = investorCount * netActions;
      const direction: ConcentrationRow['direction'] =
        netActions > 0 && r.addCount > 0 && r.exitCount === 0 ? 'ACCUMULATION' :
        netActions < 0 && r.exitCount > 0 && r.addCount === 0 ? 'DISTRIBUTION' :
        'MIXED';
      return {
        ticker: r.ticker || r.company, company: r.company,
        investors: r.investors || [], investorCount,
        netActions, signalScore: r.totalSignalScore || 0,
        concentrationScore, direction, lastMoveAt: r.lastMoveAt,
      };
    })
    .filter((r) => r.investorCount >= 2 || Math.abs(r.netActions) >= 2)
    .sort((a, b) => Math.abs(b.concentrationScore) - Math.abs(a.concentrationScore))
    .slice(0, limit);

  return NextResponse.json(
    { asOf: new Date().toISOString(), days, count: rows.length, rows },
    { headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=1800' } },
  );
}
