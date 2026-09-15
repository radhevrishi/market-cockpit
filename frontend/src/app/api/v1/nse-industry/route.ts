// ═══════════════════════════════════════════════════════════════════════════
// NSE TICKER → INDUSTRY  (zzz631)
//
// WHY THIS EXISTS. Every India-graded earnings row comes back with
// `sector: ''` and `industry: null` — all 962 of them in a five-day sample,
// and by extension all 315 names on the India Conviction Beats bench. The
// theme classifier works off exactly those two fields, so it returned null for
// every one of them, and "Your Book by Theme" showed 257 of 478 India names
// under "Unclassified · no theme call". More than half the book had no
// rotation call, which makes the panel close to useless for India.
//
// The cause is upstream and fragile: the sector is scraped from a
// "Compare with …" peer link on the Screener page, which is not there to be
// found any more. Rather than nurse a scrape, this reads the industry from a
// source the app already maintains for something else entirely: the
// `nse-ticker-universe` blob a GitHub Action refreshes from the NSE bhavcopy,
// which carries an `industry` for the whole ~2,500-name universe and is what
// the market-breadth engine already groups by.
//
// That makes the fix GENERAL rather than a list of companies: every NSE name
// the bench ever picks up classifies automatically, including ones that do not
// exist yet, and nobody has to maintain a mapping by hand.
//
//   GET /api/v1/nse-industry                  → the whole map
//   GET /api/v1/nse-industry?tickers=A,B,C    → just those
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UniverseTicker { ticker: string; industry?: string }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const want = (searchParams.get('tickers') || '')
    .split(',').map((s) => s.trim().toUpperCase().replace(/\.(NS|BO)$/, '')).filter(Boolean);

  if (!isRedisAvailable()) {
    return NextResponse.json({ map: {}, error: 'no cache backend' }, { status: 200 });
  }
  try {
    const blob = await kvGet<{ tickers?: UniverseTicker[]; generatedAt?: string }>('nse-ticker-universe:v1:latest');
    const list = blob?.tickers || [];
    const map: Record<string, string> = {};
    for (const t of list) {
      const k = String(t?.ticker || '').toUpperCase().replace(/\.(NS|BO)$/, '').trim();
      const ind = String(t?.industry || '').trim();
      if (k && ind) map[k] = ind;
    }
    // A requested subset still answers for every ticker asked about, with the
    // misses present and null — so the caller can cache "NSE does not carry an
    // industry for this one" and stop asking, exactly as the US venue endpoint
    // does. Silence and "not found" must not look the same.
    if (want.length) {
      const out: Record<string, string | null> = {};
      for (const t of want) out[t] = map[t] ?? null;
      return NextResponse.json({
        map: out, requested: want.length,
        resolved: Object.values(out).filter(Boolean).length,
        universe: Object.keys(map).length,
        generated_at: blob?.generatedAt ?? null,
      }, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } });
    }
    return NextResponse.json({
      map, universe: Object.keys(map).length, generated_at: blob?.generatedAt ?? null,
    }, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } });
  } catch (e: any) {
    // Never break a caller over this — an unclassified name is what they
    // already had.
    return NextResponse.json({ map: {}, error: String(e?.message || e) }, { status: 200 });
  }
}
