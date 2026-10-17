// zzz1055 — /api/v1/fii-dii
//   GET  ?range=1M|3M|6M|1Y|3Y|ALL  → today's card, streaks, history (cumulative FII, daily FII/DII, 20-day rolling), sectors.
//        Public read-only market data, like the other /api/market + /api/v1 market routes. Memory-cached 3 min.
//        zzz1060: + positioning (NSE participant OI), absorption, streak history, sector grid / rotation, monthly totals,
//        FII vs Nifty, FPI equity / debt split, a rule-based summary, and `status` (backfill cursors — read by the collector).
//   POST (service key in x-cron-secret / x-mc-key)
//        zzz1060: body may also carry nsdlArchive: [{ month, html }] (continues the backfill cursor), participantOi: string[]
//        (CSV files) and oiBackfillCursor (oldest OI day the collector tried).
//        body { nse?, nsdlDaily?: string[], sectorReports?: string[] } — the scrape-fii-dii collector's raw pages, or
//        ?run=1 — run the scheduler job now (all steps).
import { NextRequest, NextResponse } from 'next/server';
import { hasServiceKey } from '@/lib/site-auth';
import { parseRange, sessionCalendar } from '@/lib/fii-dii/compute';
import { buildView, parseBasis } from '@/lib/fii-dii/view';
import { isNseHolidayDate, nseHolidayStatus } from '@/lib/market-hours';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import {
  storeReady, readDaily, readSectorRows, apiCache, readOi, readCloses, readMeta, latestOiDate, latestCloseDate, NIFTY_SYMBOL,
} from '@/lib/fii-dii/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const CACHE_MS = 3 * 60_000;
const BROWSER_CACHE = 'public, max-age=120, stale-while-revalidate=600';

/** zzz1067 (F03): a stored quarantine record, shaped for the page (anything else = none). */
const quarantineOf = (v: any) => (v && typeof v === 'object' && typeof v.at === 'string' && Array.isArray(v.problems)
  ? { at: v.at, problems: v.problems.map((p: unknown) => String(p).slice(0, 200)).slice(0, 6), via: typeof v.via === 'string' ? v.via : undefined, report: typeof v.report === 'string' ? v.report : undefined }
  : null);

export async function GET(req: NextRequest) {
  const range = parseRange(req.nextUrl.searchParams.get('range'));
  const basis = parseBasis(req.nextUrl.searchParams.get('basis'));
  const cacheKey = `${range}:${basis ?? 'auto'}`;
  const hit = apiCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body, { headers: { 'Cache-Control': BROWSER_CACHE, 'X-Cache': 'HIT' } });
  try {
    if (!(await storeReady())) {
      return NextResponse.json({ ok: false, available: false, error: 'The database is not available right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const safe = <T,>(p: Promise<T>, d: T) => p.catch(() => d);   // zzz1060 extras never break the main answer
    const [daily, sectors, oi, closes, dailyMeta, sectorMeta, oiMeta, oiLatest, niftyLatest, nseQ, secQ, hol] = await Promise.all([
      readDaily(), readSectorRows(400), safe(readOi(400), []), safe(readCloses(NIFTY_SYMBOL), []),
      safe(readMeta<any>('daily_backfill'), null), safe(readMeta<any>('sector_backfill'), null), safe(readMeta<any>('oi_backfill'), null),
      safe(latestOiDate(), null), safe(latestCloseDate(NIFTY_SYMBOL), null),
      safe(readMeta<any>('nse_quarantine'), null), safe(readMeta<any>('sector_quarantine'), null),
      safe(warmNseHolidays(), null),
    ]);
    const status = {
      daily: dailyMeta ? { cursor: dailyMeta.cursor ?? null, done: !!dailyMeta.done } : null,
      sectors: sectorMeta ? { done: !!sectorMeta.done } : null,
      oi: oiMeta ? { cursor: oiMeta.cursor ?? null, done: !!oiMeta.done } : null,
      oiLatest, niftyLatest,
      nseQuarantine: quarantineOf(nseQ), sectorQuarantine: quarantineOf(secQ),
    };
    // zzz1067 (F02): the NSE session calendar — only years whose holiday list is stored count as "known"
    const calendar = sessionCalendar(isNseHolidayDate, (hol ?? nseHolidayStatus()).years);
    const body = buildView(daily, sectors, range, { oi, closes, status, basis, calendar });
    apiCache.set(cacheKey, { at: Date.now(), body });
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
