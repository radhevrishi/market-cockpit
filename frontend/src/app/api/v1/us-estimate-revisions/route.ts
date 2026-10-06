// zzz890 — GET /api/v1/us-estimate-revisions?items=NVDA:2026-08-27,CRM:2026-09-03 → how the street's EPS estimates moved
// since before each print (lib/us-estimate-revision). Public market data only; at most 40 tickers per call; the Yahoo trend
// is cached 6 hours in Redis so a busy page does not re-ask.
import { NextRequest, NextResponse } from 'next/server';
import { yahooEstimateTrend, pooled, type EstimateTrendRow } from '@/lib/us-prices';
import { estimateRevision } from '@/lib/us-estimate-revision';
import { kvGet, kvSet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const raw = String(req.nextUrl.searchParams.get('items') || '');
  const items = Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))).slice(0, 40)
    .map((s) => { const [t, d] = s.split(':'); return { t: String(t || '').toUpperCase(), d: /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null }; })
    .filter((x) => /^[A-Z0-9.\-]{1,10}$/.test(x.t));
  const out: Record<string, unknown> = {};
  await pooled(items, 6, async ({ t, d }) => {
    const key = `us-est-trend:v1:${t}`;
    let rows = await kvGet<EstimateTrendRow[]>(key).catch(() => null);
    if (!Array.isArray(rows)) {
      rows = await yahooEstimateTrend(t);
      if (rows.length) await kvSet(key, rows, 6 * 3600).catch(() => {});
    }
    out[t] = estimateRevision(rows, d);
  });
  return NextResponse.json({ ok: true, revisions: out }, { headers: { 'Cache-Control': 'private, max-age=600' } });
}
