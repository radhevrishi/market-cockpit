// zzz1235 — GET /api/v1/inflection-radar[?force=1] — abnormal industry signals scored, with the Indian supply-chain map.
import { NextRequest, NextResponse } from 'next/server';
import { inflectionRadar } from '@/lib/inflection/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ ok: true, ...(await inflectionRadar(new URL(req.url).searchParams.get('force') === '1')) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
