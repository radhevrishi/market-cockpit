// zzz1269 — GET /api/v1/ops/heap → which code allocated the memory the server still holds, and how long the event loop was held up.
// Owner login or service key only. Read-only; ?gc=1 runs a full collection first (rate-limited), ?reset=1 restarts the delay histogram.
import { NextRequest, NextResponse } from 'next/server';
import { siteAuthOk } from '@/lib/site-auth-request';
import { heapTop, loopDelay, startHeapProfile } from '@/lib/heap-profile';
import { forceFullGc } from '@/lib/force-gc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await siteAuthOk(req))) return NextResponse.json({ ok: false, error: 'owner only' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  startHeapProfile();
  const gc = sp.get('gc') === '1' ? forceFullGc() : null;
  const m = process.memoryUsage();
  const top = await heapTop(Math.min(80, Number(sp.get('top')) || 40), Math.min(16, Number(sp.get('depth')) || 10));
  return NextResponse.json({
    ok: top.ok, error: top.error, uptimeMin: Math.round(process.uptime() / 60), gc,
    memory: { rssMb: Math.round(m.rss / 1048576), heapUsedMb: Math.round(m.heapUsed / 1048576), externalMb: Math.round(m.external / 1048576) },
    loopDelay: loopDelay(sp.get('reset') === '1'), sampledSinceMin: top.sinceMin, sampledLiveMb: top.totalMb, rows: top.rows,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
