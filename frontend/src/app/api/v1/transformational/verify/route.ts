// zzz1233 — POST /api/v1/transformational/verify { ids? , market? } — settle the "Needs verification" rows: rejected by the
// criteria, or the company's filing read and checked by AI (≤ 80 AI checks a day). Runs from the transformational job too.
import { NextRequest, NextResponse } from 'next/server';
import { runVerify } from '@/lib/transformational/verify-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const m = String(body?.market || '').toUpperCase();
  try {
    const r = await runVerify({ ids: Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 60) : undefined, market: m === 'IN' || m === 'US' ? m : undefined, deadlineMs: 150_000 });
    return NextResponse.json({ ok: true, ...r }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
