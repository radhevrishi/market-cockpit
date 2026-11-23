// zzz1291 — GET /api/market/leadership-perf?market=us|india → indices (1D … 1Y), every theme with its member companies, and the
// market-cycles history (bull runs / 20%+ busts, led by). Cached 1 hour fresh (prices), served stale up to 3 days while it rebuilds.
import { NextResponse } from 'next/server';
import { swrGet } from '@/lib/swr-cache';
import { buildPerf, PERF_VERSION, type PerfPayload } from '@/lib/market-leadership/perf-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const m = url.searchParams.get('market') === 'india' ? 'india' : 'us';
  try {
    const r = await swrGet<PerfPayload>({
      key: `leadership-perf:v${PERF_VERSION}:${m}`,
      freshMs: 60 * 60_000, maxStaleMs: 3 * 86_400_000, force: url.searchParams.get('refresh') === '1', waitMs: 90_000,
      build: () => buildPerf(m),
      isUsable: (v) => !!v && Array.isArray(v.indices) && v.indices.some((x) => x.last != null),
    });
    return NextResponse.json({ ok: true, ...r.value, cacheState: r.state, ageMin: Math.round(r.ageMs / 60000) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, market: m, error: 'Performance data is being built — try again in a minute.', detail: String(e?.message || e).slice(0, 160) });
  }
}
