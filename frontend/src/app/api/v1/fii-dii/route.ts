// zzz1055 — /api/v1/fii-dii
//   GET  ?range=1M|3M|6M|1Y|3Y|ALL  → today's card, streaks, history (cumulative FII, daily FII/DII, 20-day rolling), sectors.
//        Public read-only market data, like the other /api/market + /api/v1 market routes. Memory-cached 3 min.
//   POST (service key in x-cron-secret / x-mc-key)
//        body { nse?, nsdlDaily?: string[], sectorReports?: string[] } — the scrape-fii-dii collector's raw pages, or
//        ?run=1 — run the scheduler job now (all steps).
import { NextRequest, NextResponse } from 'next/server';
import { hasServiceKey } from '@/lib/site-auth';
import { parseRange } from '@/lib/fii-dii/compute';
import { buildView } from '@/lib/fii-dii/view';
import { storeReady, readDaily, readSectorRows, apiCache } from '@/lib/fii-dii/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const CACHE_MS = 3 * 60_000;
const BROWSER_CACHE = 'public, max-age=120, stale-while-revalidate=600';

export async function GET(req: NextRequest) {
  const range = parseRange(req.nextUrl.searchParams.get('range'));
  const hit = apiCache.get(range);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body, { headers: { 'Cache-Control': BROWSER_CACHE, 'X-Cache': 'HIT' } });
  try {
    if (!(await storeReady())) {
      return NextResponse.json({ ok: false, available: false, error: 'The database is not available right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const [daily, sectors] = await Promise.all([readDaily(), readSectorRows(400)]);
    const body = buildView(daily, sectors, range);
    apiCache.set(range, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { 'Cache-Control': BROWSER_CACHE, 'X-Cache': 'MISS' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, available: false, error: e?.message || 'failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(req: NextRequest) {
  if (!hasServiceKey(req.headers.get('x-cron-secret')) && !hasServiceKey(req.headers.get('x-mc-key'))) {
    return NextResponse.json({ ok: false, error: 'service key required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const { runFiiDii, ingestCollected } = await import('@/lib/fii-dii/job');
  if (req.nextUrl.searchParams.get('run') === '1') {
    const r = await runFiiDii({ slot: new Date(), force: true, deadline: Date.now() + 4 * 60_000 });
    return NextResponse.json(r, { status: r.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
  let body: any = null;
  try { body = await req.json(); } catch { /* fall through */ }
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'JSON body required' }, { status: 400 });
  const r = await ingestCollected(body);
  return NextResponse.json(r, { status: r.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
