// zzz1056 — GET /api/v1/us-movers?mode=smallmid|all — the US Top Movers · Top Losers for the home page (read-only).
// Top 20 gainers + 20 losers of the latest US session (live during 09:30–16:00 ET, else the last completed session — the
// payload's `notice` says which), each with its WHY (graded results → SEC filing → news → sector → honest none), the move
// quality Q and chips. Memory-cached on the server (3 min live / 15 min otherwise); no Redis. Logic: lib/us-movers*.ts.
import { NextResponse } from 'next/server';
import { internalBase } from '@/lib/internal-base';
import { getUsMovers } from '@/lib/us-movers-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get('mode') === 'all' ? 'all' : 'smallmid';
  try {
    const { data, cache } = await getUsMovers(mode, internalBase(req));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, max-age=60', 'x-mc-cache': cache } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, market: 'US', mode, error: String(e?.message || e).slice(0, 200) }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
