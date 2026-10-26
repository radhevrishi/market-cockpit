// zzz1178 — GET the last Future 100-baggers run (no AI); POST runs the AI once (owner's click, ≤ 6 a day).
import { NextResponse } from 'next/server';
import { loadHb, runHb } from '@/lib/hundred-baggers/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET() {
  const report = await loadHb().catch(() => null);
  return NextResponse.json({ ok: true, report }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST() {
  const r = await runHb();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 200 });
  return NextResponse.json({ ok: true, report: r.report });
}
