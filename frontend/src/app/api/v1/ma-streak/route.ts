// zzz1231 — GET /api/v1/ma-streak?market=IN|US&tickers=A,B → per ticker: days below the 50 / 200 EMA and DMA, and the
// 3-candle-low state (lib/ma-streak). Daily bars from the chart data cache (Yahoo, memory only). ≤ 80 tickers a call.
import { NextRequest, NextResponse } from 'next/server';
import { cleanTicker, validTicker, type Market } from '@/lib/chart-math';
import { getDailySeries } from '@/lib/chart-data';
import { maStreak, type MaStreak } from '@/lib/ma-streak';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const m = String(u.searchParams.get('market') || '').toUpperCase();
  if (m !== 'IN' && m !== 'US') return NextResponse.json({ ok: false, error: 'market IN or US' }, { status: 400 });
  const market = m as Market;
  const tickers = Array.from(new Set(String(u.searchParams.get('tickers') || '').split(',').map(cleanTicker).filter((t) => t && validTicker(market, t)))).slice(0, 80);
  const results: Record<string, MaStreak> = {};
  const failed: string[] = [];
  const deadline = Date.now() + 50_000;
  let i = 0;
  const worker = async () => {
    while (i < tickers.length && Date.now() < deadline) {
      const t = tickers[i++];
      const s = await getDailySeries(market, t, '2y').catch(() => null);
      if (s && s.bars.length >= 60) results[t] = maStreak(s.bars);
      else failed.push(t);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return NextResponse.json({ ok: true, market, results, failed }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
