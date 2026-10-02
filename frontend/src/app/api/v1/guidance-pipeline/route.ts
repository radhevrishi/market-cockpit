// GET /api/v1/guidance-pipeline?market=IN|US&window=24H|3D|7D|14D|30D|120D   (zzz861)
// The real backend query behind the recent windows and the pipeline state. It reads only KV (collected company documents, extractor results, per-day coverage,
// the filings queue, the last exchange-scan snapshot). It does NOT read the Active universe, so a window is never empty just because Active is. No AI call, no
// document fetch, no network to the exchanges. Public company data only.
// Body: { windows: { IN: {24H..120D}, US: {...} }, queueStages, snapshot: { at }, evidenceErrors }.
// Each window: requested_window, actual_start, actual_end, trading_days, covered_days, partial_days, failed_days, documents, events, coverage_status, partial_coverage, engine { ...recent-events numbers + why_zero }.
import { NextRequest, NextResponse } from 'next/server';
import { loadPipelineEvidence, allWindows } from '@/lib/guidance-pipeline-service';
import { isWindowKey } from '@/lib/guidance-pipeline-windows';
import { queueStageCounts } from '@/lib/guidance-claims';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const mk = String(sp.get('market') || '').toUpperCase(); const market = mk === 'IN' || mk === 'US' ? mk : undefined;
  const w = String(sp.get('window') || '').toUpperCase();
  try {
    const ev = await loadPipelineEvidence(); const now = new Date();
    const all = allWindows(ev, now, market);
    const wantedRaw: any = await import('@/lib/kv').then((k) => k.kvGet('guidance-pipeline:wanted:v1')).catch(() => null);
    const wanted = (Array.isArray(wantedRaw?.wanted) ? wantedRaw.wanted : []).filter((w: any) => !market || w.market === market).slice(0, 300);
    const windows: any = {};
    for (const m of ['IN', 'US'] as const) { if (market && m !== market) continue; windows[m] = isWindowKey(w) ? { [w]: all[m][w] } : all[m]; }
    const byDoc = new Map(ev.extracted.map((r) => [r.docId, r] as const));
    return NextResponse.json({ ok: true, asOf: now.toISOString(), windows,
      queueStages: { IN: queueStageCounts(ev.queue as any, byDoc, 'IN'), US: queueStageCounts(ev.queue as any, byDoc, 'US') },
      wanted, snapshot: ev.snapshot ? { at: ev.snapshot.at } : null, evidenceErrors: ev.errors }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[guidance-pipeline] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The pipeline view could not be built.' }, { status: 500 });
  }
}
