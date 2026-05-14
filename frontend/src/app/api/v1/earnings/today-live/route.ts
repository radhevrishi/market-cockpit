// PATCH 0363 — Live NSE corporate-announcements scanner for today's
// Financial Results filings.
//
// Purpose: the hub builder (/api/market/earnings) lags actual filing
// time by hours because it relies on slower aggregators. User's
// complaint: "today's companies not showing at all" on filing day.
// This endpoint hits NSE's announcements feed for TODAY (and optionally
// yesterday) and returns every ticker whose subject matches a
// quarterly-results pattern. Cached 3 minutes in KV.
//
// Endpoint: GET /api/v1/earnings/today-live?date=YYYY-MM-DD (optional;
// defaults to today IST).
//
// Returned shape mirrors what the hub uses so the graded route can
// merge results without remapping.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

const KEY = (date: string) => `today-live:v1:${date}`;
const CACHE_TTL_SECONDS = 3 * 60;  // 3 minutes — page auto-polls every 4

const RESULT_PATTERNS = [
  /quarterly\s+result/i,
  /financial\s+result/i,
  /annual\s+result/i,
  /half[\s-]?yearly\s+result/i,
  /\bQ[1-4]\s+(?:FY)?\s*\d{2,4}/i,
  /\bFY\s*\d{2,4}\s+result/i,
  /board\s+meeting.*outcome.*result/i,
];

interface LiveFiling {
  symbol: string;
  company: string;
  subject: string;
  filing_iso: string;
  filing_date: string;
  attachment_url: string | null;
}

interface LiveResponse {
  date: string;
  fetched_at: string;
  source: 'NSE_DIRECT' | 'NSE_BLOCKED' | 'KV_CACHED';
  cache_age_seconds?: number;
  count: number;
  filings: LiveFiling[];
  error?: string;
}

// Convert YYYY-MM-DD → DD-MM-YYYY (NSE format)
function isoToNseDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

async function fetchNseAnnouncements(date: string, signal?: AbortSignal): Promise<LiveFiling[] | 'BLOCKED'> {
  const nseDate = isoToNseDate(date);
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${nseDate}&to_date=${nseDate}`;

  try {
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
      return 'BLOCKED';
    }
    if (!res.ok) return 'BLOCKED';
    const json: any = await res.json();
    const entries: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.rows) ? json.rows
      : [];

    const out: LiveFiling[] = [];
    const seenSymbols = new Set<string>();

    for (const e of entries) {
      const subject = String(e.subject || e.desc || e.title || '');
      if (!RESULT_PATTERNS.some(re => re.test(subject))) continue;
      const symbol = String(e.symbol || e.scrip || '').trim().toUpperCase();
      if (!symbol) continue;
      // Keep only the most recent filing per symbol on this date
      if (seenSymbols.has(symbol)) continue;

      const ts = e.an_dt || e.sm_dt || e.dt || e.broadcastdt || e.broadcastDate;
      let isoTs: string;
      let isoDate: string;
      if (ts) {
        const d = new Date(ts);
        if (Number.isFinite(d.getTime())) {
          isoTs = d.toISOString();
          isoDate = isoTs.slice(0, 10);
        } else {
          isoTs = new Date().toISOString();
          isoDate = date;
        }
      } else {
        isoTs = new Date().toISOString();
        isoDate = date;
      }

      seenSymbols.add(symbol);
      out.push({
        symbol,
        company: String(e.company_name || e.companyName || e.sm_name || symbol),
        subject,
        filing_iso: isoTs,
        filing_date: isoDate,
        attachment_url: e.attchmntFile || e.attachmentUrl || e.attachment_url || null,
      });
    }
    return out;
  } catch (err) {
    return 'BLOCKED';
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let date = searchParams.get('date') || '';
  if (!date) {
    // Default to today in IST
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const istNow = new Date(istMs);
    date = istNow.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }
  const force = searchParams.get('force') === '1';

  // Cache layer
  if (!force && isRedisAvailable()) {
    try {
      const cached: any = await kvGet(KEY(date));
      if (cached?.fetched_at) {
        const ageSec = Math.floor((Date.now() - new Date(cached.fetched_at).getTime()) / 1000);
        if (ageSec < CACHE_TTL_SECONDS) {
          return NextResponse.json({
            ...cached,
            source: 'KV_CACHED',
            cache_age_seconds: ageSec,
          });
        }
      }
    } catch {}
  }

  // 8s budget per NSE fetch
  const result = await fetchNseAnnouncements(date, AbortSignal.timeout(8000));
  if (result === 'BLOCKED') {
    const payload: LiveResponse = {
      date,
      fetched_at: new Date().toISOString(),
      source: 'NSE_BLOCKED',
      count: 0,
      filings: [],
      error: 'NSE blocked the request (rate-limit or session cookie). Use Hard Refresh to retry.',
    };
    return NextResponse.json(payload);
  }

  const payload: LiveResponse = {
    date,
    fetched_at: new Date().toISOString(),
    source: 'NSE_DIRECT',
    count: result.length,
    filings: result,
  };

  if (isRedisAvailable()) {
    try { await kvSet(KEY(date), payload, CACHE_TTL_SECONDS); } catch {}
  }

  return NextResponse.json(payload);
}
