// zzz1289 — GET /api/market/theme-cycle?region=us|india → history of benchmark falls (15%+), every sector over the same
// peak→trough window, the market regime, and the computed lessons. Long histories change slowly: fresh 20 h, last-good 7 days.
import { NextResponse } from 'next/server';
import { swrGet } from '@/lib/swr-cache';
import { buildCyclePayload, dailyHistory, FAILS, CYCLE_VERSION, type CyclePayload } from '@/lib/theme-cycle/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = url.searchParams.get('region') === 'india' ? 'india' : 'us';
  const force = url.searchParams.get('refresh') === '1';
  const probe = url.searchParams.get('probe');
  if (probe) {
    const t0 = Date.now();
    const s = await dailyHistory(probe.slice(0, 20));
    return NextResponse.json({ ok: !!s, symbol: probe, bars: s?.d.length ?? 0, first: s?.d[0] ?? null, last: s?.d[s.d.length - 1] ?? null, ms: Date.now() - t0, why: FAILS.get(probe) ?? null });
  }
  try {
    const r = await swrGet<CyclePayload>({
      key: `theme-cycle:v${CYCLE_VERSION}:${market}`,
      freshMs: 20 * 3600_000, maxStaleMs: 7 * 86_400_000, force, waitMs: 90_000,
      build: () => buildCyclePayload(market),
      isUsable: (v) => !!v && Array.isArray(v.episodes) && v.episodes.length > 0,
    });
    return NextResponse.json({ ok: true, ...r.value, cacheState: r.state, ageMin: Math.round(r.ageMs / 60000) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, market, error: 'History is being built — try again in a minute.', detail: String(e?.message || e).slice(0, 160) }, { status: 200 });
  }
}
