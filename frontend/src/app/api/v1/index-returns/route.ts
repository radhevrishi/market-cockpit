// zzz891 — GET /api/v1/index-returns?market=IN|US → 1M / 3M / 6M / 12M returns of NIFTY 50 (NSE's own published closes,
// stored by the scrape-nse-index-history job) or the S&P 500 (Yahoo daily chart). Public market data; cached 1 hour.
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { yahooChart } from '@/lib/us-prices';
import { indexReturnsFrom, type IndexReturns } from '@/lib/relative-strength';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const market = String(req.nextUrl.searchParams.get('market') || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
  const ck = `index-returns:v1:${market}`;
  const hit = await kvGet<IndexReturns>(ck).catch(() => null);
  if (hit && hit.r3m != null) return NextResponse.json({ ok: true, ...hit, cached: true });
  let out: IndexReturns | null = null;
  if (market === 'IN') {
    const blob = await kvGet<any>('nse-index-history:v1:latest').catch(() => null);
    const s = blob?.indices?.['^NSEI'];
    if (s?.ts?.length && s?.close?.length) out = indexReturnsFrom('NIFTY 50', s.ts.map(Number), s.close.map(Number));
  } else {
    const b = await yahooChart('^GSPC', '2y').catch(() => null);
    if (b && Array.isArray(b.close) && b.close.length) out = indexReturnsFrom('S&P 500', (b.dates || []).map((d) => Date.parse(d)), b.close);
  }
  if (!out || out.r3m == null) return NextResponse.json({ ok: false, error: `${market === 'IN' ? 'NIFTY 50' : 'S&P 500'} history not available right now.` }, { status: 503 });
  await kvSet(ck, out, 3600).catch(() => {});
  return NextResponse.json({ ok: true, ...out });
}
