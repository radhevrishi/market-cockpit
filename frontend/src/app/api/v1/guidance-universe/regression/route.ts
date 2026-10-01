// GET /api/v1/guidance-universe/regression?force=1   (zzz848)
// The owner's list of companies vs what the sources say: expected, found, source/date and one status per row
// (VERIFIED, PARTIALLY_VERIFIED, NOT_FOUND, REJECTED, SUPERSEDED, EXPIRED) plus the zzz853 columns (resolved, source/primary found, period, metric, growthType, current/previous guidance, active, verificationState, reason). Nothing is forced to PASS. Uses the FULL build (default + review queue). Public data only; same cached build as the universe route.
import { NextRequest, NextResponse } from 'next/server';
import { getUniverseBundle } from '@/lib/guidance-universe-service';
import { buildRegression } from '@/lib/guidance-universe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  try {
    const b = await getUniverseBundle(t0, new URL(req.url).searchParams.get('force') === '1');
    return NextResponse.json({ ...buildRegression(b.seed.rows, b.build, b.now), servedFrom: b.servedFrom, builtAt: b.builtAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[guidance-universe/regression] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The regression could not be built. Please try again.' }, { status: 500 });
  }
}
