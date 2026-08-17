// ═══════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE CONVICTION BENCH — read route.
//
// Read-only (no secret; mirrors other public-ish read routes). Returns the
// bench blob written by /api/v1/cron/refresh-bench, or an honest empty payload
// when the cron hasn't run yet.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BENCH_KEY = 'bench:server:v1';

export async function GET() {
  let payload: any = null;
  try {
    payload = await kvGet(BENCH_KEY);
  } catch {
    payload = null;
  }

  if (!payload) {
    return NextResponse.json({
      ok: true,
      entries: [],
      count: 0,
      updatedAt: null,
      note: 'not built yet',
    });
  }

  return NextResponse.json(payload);
}
