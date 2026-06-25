// ═══════════════════════════════════════════════════════════════════════════
// /api/system/health — zzz106
//
// Short-path alias for /api/v1/system-health. Previously: /api/system/health
// returned 404. Now it forwards to the v1 probe with the same query string
// and returns the same JSON, so dashboards and external checks can use the
// shorter URL.
//
// We don't import the v1 handler directly to keep the v1 route in charge of
// its own caching/timeouts; instead we self-fetch via the Railway-safe
// loopback (the v1 endpoint itself uses `internalBase` for its own probes).
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { internalBase } from '@/lib/internal-base';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.search; // preserves ?fresh=1 etc.
  const base = internalBase(req);
  const target = `${base}/api/v1/system-health${qs}`;

  try {
    const res = await fetch(target, {
      headers: { 'x-forwarded-from': '/api/system/health' },
      // v1 probe has its own per-check timeouts; cap the whole call at 15s.
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
        'x-alias-of': '/api/v1/system-health',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        alias_of: '/api/v1/system-health',
        error: err?.message || String(err),
        hint: 'v1 probe timed out or refused — check Railway logs.',
        checked_at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
