// zzz1179 — GET every choke-point theme's live pulse (news heat, bottleneck, company proof, crowding, latest news). No AI.
import { NextResponse } from 'next/server';
import { allPulses } from '@/lib/choke-themes/pulse-load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const r = await allPulses();
    return NextResponse.json({ ok: true, ...(r || { pulses: {}, generatedAt: null, newsItems: 0 }) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
