// PATCH 0309 — NSE corporate-announcements adapter.
//
// Implements Tier 2 of the institutional filing-date resolver framework
// described in CLAUDE.md §10.5. Sits between Tier 1 (KV calendar lookup
// from graded:v8:*) and Tier 3 (Yahoo price-action inference).
//
// Endpoint: GET /api/v1/earnings/nse-announcements?symbol=<TICKER>
//
// Hits NSE's corp-announcements feed for the symbol and looks for the
// most recent "Financial Results" / "Quarterly Results" / "Annual Results"
// filing. Returns the structured filing date + subject + attachment URL.
// Cached in KV for 24h to avoid hammering NSE.
//
// NOTE: NSE blocks anonymous traffic aggressively. We send a real
// browser-like User-Agent. If NSE returns 401/403/429, we return
// `source: 'NSE_BLOCKED'` and the caller falls through to Tier 3.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

const KEY = (symbol: string) => `nse-announce:v1:${symbol.toUpperCase()}`;
const TTL_SECONDS = 24 * 60 * 60; // 24h

const RESULT_PATTERNS = [
  /quarterly\s+result/i,
  /financial\s+result/i,
  /annual\s+result/i,
  /half[\s-]?yearly\s+result/i,
  /\b(?:Q[1-4]|FY)\s*FY?\s*\d{2,4}\s+result/i,
];

interface ResolvedFiling {
  symbol: string;
  filing_date: string | null;       // YYYY-MM-DD
  filing_iso: string | null;        // full ISO timestamp
  subject: string | null;
  attachment_url: string | null;
  source: 'NSE_DIRECT' | 'NSE_BLOCKED' | 'NSE_EMPTY' | 'KV_CACHED';
  cached_at?: number;
}

async function fetchFromNSE(symbol: string, signal?: AbortSignal): Promise<ResolvedFiling> {
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`;
  try {
    // NSE requires a session cookie warm-up; we do best-effort here.
    // Production callers can pre-warm by hitting nseindia.com/ first.
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
      },
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return { symbol, filing_date: null, filing_iso: null, subject: null, attachment_url: null, source: 'NSE_BLOCKED' };
    }
    if (!res.ok) {
      return { symbol, filing_date: null, filing_iso: null, subject: null, attachment_url: null, source: 'NSE_BLOCKED' };
    }
    const data = await res.json() as Array<Record<string, any>>;
    const entries = Array.isArray(data) ? data : (Array.isArray((data as any)?.data) ? (data as any).data : []);
    // Find the most recent results filing.
    for (const e of entries) {
      const subject = String(e.subject || e.desc || '');
      if (!RESULT_PATTERNS.some(re => re.test(subject))) continue;
      const ts = e.an_dt || e.sm_dt || e.dt || e.broadcastdt;
      if (!ts) continue;
      try {
        const d = new Date(ts);
        if (!Number.isFinite(d.getTime())) continue;
        return {
          symbol,
          filing_date: d.toISOString().slice(0, 10),
          filing_iso: d.toISOString(),
          subject,
          attachment_url: e.attchmntFile || e.attachmentUrl || null,
          source: 'NSE_DIRECT',
        };
      } catch { continue; }
    }
    return { symbol, filing_date: null, filing_iso: null, subject: null, attachment_url: null, source: 'NSE_EMPTY' };
  } catch (err) {
    return { symbol, filing_date: null, filing_iso: null, subject: null, attachment_url: null, source: 'NSE_BLOCKED' };
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') || '').trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol)) {
    return NextResponse.json({ error: 'invalid symbol' }, { status: 400 });
  }
  const force = req.nextUrl.searchParams.get('force') === '1';

  // KV cache first.
  if (isRedisAvailable() && !force) {
    const cached = await kvGet<ResolvedFiling>(KEY(symbol));
    if (cached) {
      return NextResponse.json({ ...cached, source: 'KV_CACHED' });
    }
  }

  // Fetch from NSE.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const resolved = await fetchFromNSE(symbol, controller.signal);
  clearTimeout(timeoutId);

  // Only cache successful resolutions; transient blocks shouldn't poison KV.
  if (resolved.source === 'NSE_DIRECT' && isRedisAvailable()) {
    await kvSet(KEY(symbol), { ...resolved, cached_at: Date.now() }, TTL_SECONDS);
  }

  return NextResponse.json(resolved);
}
