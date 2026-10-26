// zzz1174 — GET the last Choke-Point Themes run (no AI); POST runs the AI once (owner's click, ≤ 6 a day).
import { NextResponse } from 'next/server';
import { loadChoke, runChoke } from '@/lib/choke-themes/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET() {
  const report = await loadChoke().catch(() => null);
  return NextResponse.json({ ok: true, report }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST() {
  const r = await runChoke();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 200 });
  return NextResponse.json({ ok: true, report: r.report });
}
