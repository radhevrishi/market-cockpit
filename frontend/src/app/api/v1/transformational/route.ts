// zzz1166 — GET /api/v1/transformational?days=60&market=IN|US — the Transformational Gainers board: the events from AI Daily
// Gainers that can change future earnings, over the last 60 days, with themes (and which themes / companies are new this week).
import { NextRequest, NextResponse } from 'next/server';
import { buildBoard, type TgMarket } from '@/lib/transformational/core';
import { loadReviewed } from '@/lib/transformational/reviewed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const days = Math.max(7, Math.min(90, Number(sp.get('days')) || 60));
  const m = (sp.get('market') || '').toUpperCase();
  const market: TgMarket | undefined = m === 'IN' || m === 'US' ? m : undefined;
  try {
    // zzz1168 — only the most important: rows saved under the first, looser rule that are neither a firm event nor a clear
    // multibagger read are not shown (the daily job re-saves each session under the current rule)
    // zzz1169 — every stored row passes today's review (clean text, industry theme, figures from the stock screener, takeover
    // targets / old events / small orders out, chance re-read) so the board is right now, not after the night job
    const all = await loadReviewed(days + 7, market);
    const today = new Date().toISOString().slice(0, 10);
    const board = buildBoard(all, today, days);
    return NextResponse.json({ ok: true, ...board, generatedAt: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
