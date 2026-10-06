// zzz883 — GET /api/v1/fx → { usdInr, asOf, source, live }. Public, cheap, cached.
import { NextResponse } from 'next/server';
import { getUsdInr } from '@/lib/fx';
export const dynamic = 'force-dynamic';
export async function GET() {
  const fx = await getUsdInr();
  return NextResponse.json({ ok: true, ...fx }, { headers: { 'Cache-Control': 'public, max-age=900' } });
}
