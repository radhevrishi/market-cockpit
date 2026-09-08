// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/us/exchange?tickers=NVDA,KEYS,BRK-B
//
// Ticker → listing venue, straight out of SEC's own
// `company_tickers_exchange.json` (via lib/us-edgar's cached `listings()`, so
// every sec.gov byte still goes through the rate-limited, User-Agent'd helper —
// nothing here fetches sec.gov directly).
//
// It exists for ONE consumer: the grouped TradingView export on
// /us-conviction-beats. The bench is a localStorage store that accumulates over
// months, so most of its rows were written long before the graded payload
// carried a venue at all; asking for the venue at export time is what lets a
// name benched ninety days ago still export as `NASDAQ:XYZ` instead of a bare
// symbol. A ticker the SEC file does not carry answers `null` — the caller then
// exports it unqualified rather than inventing a venue for it.
//
// The response is a plain map. Unknown tickers are present with a null value
// rather than absent, so the caller can cache the ANSWER (including "SEC does
// not list this one") and stop asking.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { exchangeForTickers } from '@/lib/us-edgar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One request may not ask about more than this many names. The listings map is
 *  in memory, so the cap is about response size, not about EDGAR load. */
const MAX_TICKERS = 600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get('tickers') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!raw.length) {
    return NextResponse.json({ map: {}, notes: ['no tickers requested'] });
  }
  const wanted = Array.from(new Set(raw.map((t) => t.toUpperCase()))).slice(0, MAX_TICKERS);
  try {
    const map = await exchangeForTickers(wanted);
    const known = Object.values(map).filter(Boolean).length;
    return NextResponse.json({
      map,
      requested: wanted.length,
      resolved: known,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    // A failure here must never break an export. The caller falls back to bare
    // tickers, which TradingView still accepts.
    return NextResponse.json(
      { map: {}, requested: wanted.length, resolved: 0, error: String(e?.message || e) },
      { status: 200 },
    );
  }
}
