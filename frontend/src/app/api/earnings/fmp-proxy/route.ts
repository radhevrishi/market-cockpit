import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────
// /api/earnings/fmp-proxy?endpoint=<path>&<other>=<value>
//
// Server-side proxy for FMP. Replaces direct browser-side FMP calls in
// the earnings-analysis page that hardcoded the API key as a string in
// React component code (visible in Sources tab → quota drainable by any
// visitor).
//
// Allowlist of endpoints — only routes the page actually uses. Anything
// else returns 403. Per-IP rate limit applies.
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED_ENDPOINTS = new Set<string>([
  // legacy v3
  'earnings-surprises',
  'analyst-estimates',
  'profile',
  'income-statement',
  'balance-sheet-statement',
  'cash-flow-statement',
  // /stable/ — keep aligned with /api/earnings/{estimates,history}
  'profile-v2',
  'quote',
  'earnings',
  'price-target-summary',
  'grades',
  'key-metrics-ttm',
]);

function getFmpKey(): string | null {
  // Server-only env var. No fallback string — fail rather than ship a
  // hardcoded key to anyone who reads the source.
  return process.env.FMP_KEY || null;
}

export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 60, 60_000); // 60 req/min/IP
  if (limited) return limited;

  const apiKey = getFmpKey();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'FMP_KEY env var not set on server' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint');
  const ticker = url.searchParams.get('ticker');
  if (!endpoint || !ticker) {
    return NextResponse.json(
      { ok: false, error: 'Missing endpoint or ticker query param' },
      { status: 400 },
    );
  }
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json(
      { ok: false, error: `Endpoint "${endpoint}" not allowlisted` },
      { status: 403 },
    );
  }

  // Pass through all original query params except endpoint/ticker, and
  // append apikey on the server side.
  const passthrough = new URLSearchParams();
  url.searchParams.forEach((v, k) => {
    if (k !== 'endpoint' && k !== 'ticker') passthrough.append(k, v);
  });
  passthrough.append('apikey', apiKey);

  // Map our endpoint slug to FMP path:
  //   profile, income-statement, etc → /api/v3/{endpoint}/{ticker}
  //   profile-v2 → /stable/profile?symbol=
  //   quote, earnings, price-target-summary, grades, key-metrics-ttm → /stable/{endpoint}?symbol=
  let fmpUrl: string;
  if (endpoint === 'profile-v2' || endpoint === 'quote' || endpoint === 'earnings' ||
      endpoint === 'price-target-summary' || endpoint === 'grades' || endpoint === 'key-metrics-ttm') {
    const slug = endpoint === 'profile-v2' ? 'profile' : endpoint;
    passthrough.set('symbol', ticker);
    fmpUrl = `https://financialmodelingprep.com/stable/${slug}?${passthrough.toString()}`;
  } else {
    fmpUrl = `https://financialmodelingprep.com/api/v3/${endpoint}/${encodeURIComponent(ticker)}?${passthrough.toString()}`;
  }

  try {
    const res = await fetch(fmpUrl, {
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 300 }, // 5-min cache
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `FMP returned ${res.status}`, endpoint, ticker },
        { status: res.status === 429 ? 429 : 502 },
      );
    }
    const text = await res.text();
    if (text.startsWith('Premium') || text.includes('"Error Message"')) {
      return NextResponse.json(
        { ok: false, error: 'FMP endpoint requires premium subscription', endpoint, ticker },
        { status: 402 },
      );
    }
    let json: any;
    try { json = JSON.parse(text); } catch {
      return NextResponse.json({ ok: false, error: 'FMP returned non-JSON' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, data: json });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `FMP fetch failed: ${err?.message || 'timeout'}` },
      { status: 504 },
    );
  }
}
