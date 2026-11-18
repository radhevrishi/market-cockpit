// zzz1280 — POST { keys: ["IN:ROTO:2026-11-18", …] } → { moves: { key: { pct, base, baseDate, last, lastDate, sessions } | null } }
// The share's move since the session it joined the Transformational Gainers board. Free daily prices only (no AI).
import { NextRequest, NextResponse } from 'next/server';
import { sinceAddedMany } from '@/lib/transformational/since-added';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const keys: string[] = Array.isArray(body?.keys) ? body.keys.map(String).slice(0, 400) : [];
  try {
    const moves = await sinceAddedMany(keys);
    return NextResponse.json({ ok: true, moves });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
