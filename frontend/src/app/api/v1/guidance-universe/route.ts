// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/guidance-universe?market=IN|US|ALL&metric=REVENUE|PAT|EPS|EBITDA|FCF&threshold=30&view=active|all|history&force=1   (zzz848, Layer A)
//
// The persistent GUIDANCE UNIVERSE: management guidance that is still valid today, regardless of when it was announced (no event window).
// Sources: the live Growth Guidance pipeline (cached KV), the append-only ledger, the stored universe, and researched records held as data.
// PUBLIC company data only (never holdings). No AI, no document fetching. 22s budget, shared 2-minute memory cache.
// metric (optional): keep only companies with a counted figure for that metric at or above `threshold`. Summary is always for the whole universe.
// view=all (alias: history) also returns the inactive records (expired / superseded / withdrawn) and the excluded unverified rows. Expired guidance is never in `records`.
// summary (zzz849, additive): byMarket {IN,US,ALL}:{companies,revenueGe30,patGe30,multiMetric,cagrMultiYear}, highGrowth[] (the ONE filtered list every count comes from),
//   expiredCount, unknownPeriodCount, awaitingVerificationCount, needsReviewCount. The page needs no recomputation.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { getUniverseBundle } from '@/lib/guidance-universe-service';
import { summarize } from '@/lib/guidance-universe';
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
  const t = parseFloat(sp.get('threshold') || '30');
  const threshold = Number.isFinite(t) ? Math.min(500, Math.max(1, t)) : 30;
  const vq = String(sp.get('view') || 'active').toLowerCase(); const view = vq === 'all' || vq === 'history' ? 'all' : 'active';
  try {
    const b = await getUniverseBundle(t0, sp.get('force') === '1');
    const summary = summarize(b.build.records, b.now, threshold, b.build.inactive);
    let records = b.build.records.filter((r) => market === 'ALL' || r.record.market === market);
    if (metric) records = records.filter((r) => r.points.some((p) => p.metric === metric && p.compareValue != null && p.compareValue >= threshold && p.counted));
    const inactive = b.build.inactive.filter((x) => market === 'ALL' || x.market === market);
    const body = {
      summary, records, pendingPrimary: summary.all.pendingPrimary,
      scan: { note: b.scan.note, complete: b.scan.complete },
      seed: { loaded: b.seed.rows.length, dropped: b.seed.dropped }, persisted: b.persisted,
      ...(view === 'all' ? { inactive, excluded: b.build.excluded } : {}),
      filters: { market, metric, threshold, view },
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[guidance-universe] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The guidance universe could not be built. Please try again.' }, { status: 500 });
  }
}
