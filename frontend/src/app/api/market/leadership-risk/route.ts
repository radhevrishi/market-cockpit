// zzz1290 — GET /api/market/leadership-risk?market=us|india → Market Leadership & Risk payload for ONE market (regime, distribution,
// breadth, leader health, emerging names, risk posture, recovery checks). Cached 30 min (benchmarks move intraday; the screener
// snapshot rebuilds daily / hourly). Themes come from Theme Rotation on the page itself — not recomputed here.
import { NextResponse } from 'next/server';
import { swrGet } from '@/lib/swr-cache';
import { buildMarket, LR_VERSION, type MarketPayload } from '@/lib/market-leadership/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const m = url.searchParams.get('market') === 'india' ? 'IN' : 'US';
  try {
    const r = await swrGet<MarketPayload>({
      key: `leadership-risk:v${LR_VERSION}:${m}`,
      freshMs: 30 * 60_000, maxStaleMs: 3 * 86_400_000, force: url.searchParams.get('refresh') === '1', waitMs: 45_000,
      build: () => buildMarket(m),
      isUsable: (v) => !!v && !!v.regime,
    });
    return NextResponse.json({ ok: true, ...r.value, cacheState: r.state, ageMin: Math.round(r.ageMs / 60000) }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, market: m, error: 'Market data is being built — try again in a minute.', detail: String(e?.message || e).slice(0, 160) });
  }
}
