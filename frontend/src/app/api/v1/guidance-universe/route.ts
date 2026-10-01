// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/guidance-universe?market=IN|US|ALL&metric=REVENUE|PAT|EPS|EBITDA|FCF&threshold=30&view=active|review|history&force=1   (zzz848, zzz853, Layer A)
//
// The persistent GUIDANCE UNIVERSE: management guidance that is still valid today, regardless of when it was announced (no event window).
// view=active (default): active + company resolved + period CONFIRMED + not needs-review. view=review: the review queue (records[] with reviewReasons[]).
// view=history (alias: all): also inactive records (expired / superseded / withdrawn, each with expiryReason) and excluded rows (analyst / consensus / commentary).
// Extra (additive): viewCounts, invariantViolations (must be empty), servedFrom 'live'|'last_good'|'seed', builtAt. The universe is independent of the news cache.
// PUBLIC company data only (never holdings). No AI, no document fetching.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { getUniverseBundle, buildUniverseResponse, parseView, clampThreshold } from '@/lib/guidance-universe-service';
import type { GgMetric } from '@/lib/growth-guidance-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const METRICS: GgMetric[] = ['REVENUE', 'PAT', 'EPS', 'EBITDA', 'FCF'];

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const sp = new URL(req.url).searchParams;
  const mk = String(sp.get('market') || 'ALL').toUpperCase();
  const market = mk === 'IN' || mk === 'US' ? mk : 'ALL';
  const m = String(sp.get('metric') || '').toUpperCase() as GgMetric;
  const metric = METRICS.includes(m) ? m : null;
  try {
    const b = await getUniverseBundle(t0, sp.get('force') === '1');
    const body = buildUniverseResponse(b, { market, metric, threshold: clampThreshold(sp.get('threshold')), view: parseView(sp.get('view')) });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[guidance-universe] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The guidance universe could not be built. Please try again.' }, { status: 500 });
  }
}
