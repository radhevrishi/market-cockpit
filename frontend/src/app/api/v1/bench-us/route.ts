// ═══════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE US CONVICTION BENCH — read route.  (zzz665)
//
// The US sibling of /api/v1/bench. Read-only, no secret, and honest about an
// empty bench rather than pretending to one: a client that cannot tell "the
// cron has not run" from "there is nothing on the bench" will quietly show an
// empty page and look broken.
//
// `engine_version` travels with the payload so the client can ignore a bench
// built by an older engine instead of merging stale verdicts into a fresh one.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { US_ENGINE_VERSION } from '@/lib/us-engine-version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const US_BENCH_KEY = 'bench:us:server:v1';

export async function GET() {
  let payload: any = null;
  try { payload = await kvGet(US_BENCH_KEY); } catch { payload = null; }

  if (!payload) {
    return NextResponse.json({
      ok: true, entries: [], count: 0, updatedAt: null,
      engine_version: US_ENGINE_VERSION,
      note: 'not built yet — /api/v1/cron/refresh-us-bench has not run',
    });
  }

  return NextResponse.json({ ...payload, current_engine_version: US_ENGINE_VERSION });
}
