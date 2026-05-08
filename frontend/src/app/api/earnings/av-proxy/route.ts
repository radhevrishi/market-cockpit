import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────
// /api/earnings/av-proxy — Alpha Vantage server-side proxy
//
// Hides the AV API key (was hardcoded in earnings-analysis client; visible
// in browser sources). Allowlists only the two functions actually used:
// EARNINGS and OVERVIEW.
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED = new Set(['EARNINGS', 'OVERVIEW']);

export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 30, 60_000);
  if (limited) return limited;

  const apiKey = process.env.AV_KEY || process.env.ALPHA_VANTAGE_KEY || '';
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'AV_KEY env var not set on server' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const fn = url.searchParams.get('function');
  const symbol = url.searchParams.get('symbol');
  if (!fn || !symbol) {
    return NextResponse.json(
      { ok: false, error: 'Missing function or symbol' },
      { status: 400 },
    );
  }
  if (!ALLOWED.has(fn)) {
    return NextResponse.json(
      { ok: false, error: `Function "${fn}" not allowlisted` },
      { status: 403 },
    );
  }

  const avUrl = `https://www.alphavantage.co/query?function=${encodeURIComponent(fn)}&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  try {
    const res = await fetch(avUrl, {
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `AV returned ${res.status}` },
        { status: 502 },
      );
    }
    const text = await res.text();
    if (text.includes('Information') && text.includes('rate limit')) {
      return NextResponse.json(
        { ok: false, error: 'Alpha Vantage rate limit reached' },
        { status: 429 },
      );
    }
    let json: any;
    try { json = JSON.parse(text); } catch {
      return NextResponse.json({ ok: false, error: 'AV returned non-JSON' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, data: json });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `AV fetch failed: ${err?.message || 'timeout'}` },
      { status: 504 },
    );
  }
}
