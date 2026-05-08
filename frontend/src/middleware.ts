import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';

// ─────────────────────────────────────────────────────────────────────────
// Global Edge middleware — applies a per-IP rate ceiling to /api/*
//
// Tiered limits:
//   - Heavy routes (server-side scrape / file parse / EDGAR XBRL):
//     30 requests / minute / IP
//   - Other API routes:
//     120 requests / minute / IP
//
// Individual route handlers may apply additional, tighter limits (e.g.
// watchlist write paths). The middleware is the outermost filter so abusive
// IPs get rejected before any route code runs.
// ─────────────────────────────────────────────────────────────────────────

const HEAVY_ROUTES = [
  '/api/earnings/india-screener',
  '/api/earnings/india',
  '/api/earnings/history',
  '/api/earnings/edgar',
  '/api/earnings/estimates',
  '/api/earnings/fmp-proxy',
  '/api/concall/parse',
  '/api/market/multibagger',
];

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    req.ip ||
    'anon'
  );
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (!path.startsWith('/api/')) return NextResponse.next();

  const ip = clientIp(req);
  const isHeavy = HEAVY_ROUTES.some((p) => path.startsWith(p));
  const limit = isHeavy ? 30 : 120;
  const windowMs = 60_000;

  const { allowed, remaining, resetInMs } = checkRateLimit(ip, limit, windowMs);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Rate limit exceeded',
        remaining,
        resetInSeconds: Math.ceil(resetInMs / 1000),
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset-Ms': String(resetInMs),
          'Retry-After': String(Math.ceil(resetInMs / 1000)),
        },
      },
    );
  }

  const res = NextResponse.next();
  res.headers.set('X-RateLimit-Limit', String(limit));
  res.headers.set('X-RateLimit-Remaining', String(remaining));
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
