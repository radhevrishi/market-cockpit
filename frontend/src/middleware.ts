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
//     300 requests / minute / IP
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

// PATCH 1101zzz13 — Cheap KV-backed read routes. They return cached
// payloads with negligible upstream work and are fired in bursts by the
// concall-intel and home dashboards (5+ concurrent feeds + auto-poll).
// Exempt from rate-limit counting so a normal active session with two
// tabs open and a "Refresh" click doesn't trip 429 on these alone.
const CHEAP_CACHED_ROUTES = [
  '/api/v1/concall-intel/live-feed',
  '/api/v1/concall-intel/warrant-feed',
  '/api/v1/concall-intel/keyword-watch',
  '/api/v1/concall-intel/movers',
  '/api/v1/breadth',
  '/api/v1/news/in-play',
  '/api/v1/news/bottleneck-dashboard',
  '/api/v1/cron/heartbeat',
];

// PATCH 0699 — Permanent (308) redirects for legacy / wrong slugs that
// currently 404. Old bookmarks update on first hit.
//   /activity      → /activity-log
//   /strategic-vis → /strategic-visibility
//   /calendar      → /calendars
//   /guidance      → /earnings-hub?tab=guidance
//   /my-book       → /portfolio
//   /concall-ai    → /earnings-analysis (the Concall AI tab)
const SLUG_REDIRECTS: Record<string, string> = {
  '/activity': '/activity-log',
  '/strategic-vis': '/strategic-visibility',
  '/calendar': '/calendars',
  '/guidance': '/earnings-hub?tab=guidance',
  '/my-book': '/portfolio',
  '/concall-ai': '/earnings-analysis',
  '/re-rating': '/rerating',
};

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

  // PATCH 0699 — Handle legacy slug redirects before any other middleware logic.
  // Normalise trailing slash (e.g. '/activity/' → '/activity') so both forms hit.
  const normalisedPath = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (SLUG_REDIRECTS[normalisedPath]) {
    const target = SLUG_REDIRECTS[normalisedPath];
    const url = new URL(target, req.url);
    return NextResponse.redirect(url, 308);
  }

  if (!path.startsWith('/api/')) return NextResponse.next();

  // PATCH 1101zzz13 — Bypass rate limit for cheap KV-cached read routes.
  // These return cached payloads with negligible cost. Without this,
  // a normal session (home tab + concall-intel tab + a refresh) was
  // burning the 300/min budget on these alone, then 429-wiping the
  // page on the next render. Heavy routes are still gated.
  const isCheap = CHEAP_CACHED_ROUTES.some((p) => path.startsWith(p));
  if (isCheap) {
    const res = NextResponse.next();
    res.headers.set('X-RateLimit-Exempt', '1');
    return res;
  }

  const ip = clientIp(req);
  const isHeavy = HEAVY_ROUTES.some((p) => path.startsWith(p));
  // PATCH 1101zzz13 — bumped 300 → 600. Auto-poll + multiple tabs +
  // user refreshes on the home dashboard burn through 300 in ~3 minutes.
  // 600 still rejects real abuse but accommodates active normal use.
  const limit = isHeavy ? 30 : 600;
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

// PATCH 0699 — matcher expanded so the middleware fires on the legacy slugs
// (not just /api/*) so the redirects above can intercept them. Other paths
// pass through with NextResponse.next() unchanged.
export const config = {
  matcher: [
    '/api/:path*',
    '/activity',
    '/strategic-vis',
    '/calendar',
    '/guidance',
    '/my-book',
    '/concall-ai',
    '/re-rating',
  ],
};
