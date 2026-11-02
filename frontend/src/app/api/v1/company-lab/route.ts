// zzz1208 — GET /api/v1/company-lab?market=IN|US&tickers=A,B (≤ 8): one Company Lab card per company (lib/company-lab).
import { NextRequest, NextResponse } from 'next/server';
import { labCard, cleanLabTicker } from '@/lib/company-lab/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const market = sp.get('market') === 'US' ? 'US' : 'IN';
  const tickers = Array.from(new Set((sp.get('tickers') || '').split(/[,\s]+/).map(cleanLabTicker).filter(Boolean))).slice(0, 8);
  if (!tickers.length) return NextResponse.json({ ok: false, error: 'Add at least one ticker.' }, { status: 400 });
  const cards = await Promise.all(tickers.map((t) => labCard(market, t).catch((e) => ({ market, ticker: t, ok: false, error: String(e?.message || e).slice(0, 160) }))));
  return NextResponse.json({ ok: true, market, cards }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
