import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/earnings/calendar — read endpoint (patch 0133)
//
// Reads the canonical NSE filings calendar from Upstash KV.  Data is
// populated by .github/workflows/scrape-nse-earnings.yml every 30 min
// during IST market hours.  Vercel does NO scraping — it just renders
// what the GitHub Action prepared.
//
// Query params:
//   date=YYYY-MM-DD   → returns filings for that single date
//   from=YYYY-MM-DD&to=YYYY-MM-DD  → returns filings in date range
//   (no params)       → returns full payload (last 90d + next 30d)
// ═══════════════════════════════════════════════════════════════════════════

let redis: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
} catch {}

interface CalendarItem {
  symbol: string;
  company: string;
  filing_date: string;
  filing_dt_iso?: string | null;
  quarter?: string;
  period_ended?: string;
  audited?: boolean;
  consolidated?: boolean;
  period_type?: string;
  attachment?: string | null;
  source_url?: string;
  exchange?: string;
}

interface FullPayload {
  scraped_at: string;
  from: string;
  to: string;
  total: number;
  by_date: Record<string, CalendarItem[]>;
  items: CalendarItem[];
}

function emptyPayload(): FullPayload {
  return { scraped_at: '', from: '', to: '', total: 0, by_date: {}, items: [] };
}

export async function GET(req: Request) {
  if (!redis) {
    return NextResponse.json({
      error: 'KV not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.',
      ...emptyPayload(),
    }, { status: 503 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const from = url.searchParams.get('from');
  const to   = url.searchParams.get('to');

  try {
    // Fast path: single-date lookup
    if (date) {
      const day: any = await redis.get(`earnings:calendar:nse:v1:date:${date}`);
      if (day) {
        // Upstash returns parsed JSON when the key was set via SET <json-string>
        const parsed = typeof day === 'string' ? JSON.parse(day) : day;
        return NextResponse.json({
          date: parsed.date || date,
          items: parsed.items || [],
          total: parsed.total ?? (parsed.items?.length || 0),
          scraped_at: parsed.scraped_at || null,
          source: 'NSE',
        });
      }
      return NextResponse.json({ date, items: [], total: 0, source: 'NSE', empty_reason: 'no_filings_or_scrape_pending' });
    }

    // Full payload
    const full: any = await redis.get('earnings:calendar:nse:v1');
    if (!full) {
      return NextResponse.json({
        ...emptyPayload(),
        empty_reason: 'scraper_has_not_run_yet',
        next_step: 'Trigger the NSE Earnings Calendar Scrape GitHub Action manually, or wait for the 30-min cron.',
      });
    }
    const parsed: FullPayload = typeof full === 'string' ? JSON.parse(full) : full;

    // Range filter
    if (from || to) {
      const fromD = from || '0000-00-00';
      const toD   = to   || '9999-99-99';
      const byDateFiltered: Record<string, CalendarItem[]> = {};
      let count = 0;
      for (const [d, arr] of Object.entries(parsed.by_date || {})) {
        if (d >= fromD && d <= toD) {
          byDateFiltered[d] = arr;
          count += arr.length;
        }
      }
      return NextResponse.json({
        ...parsed,
        from: fromD,
        to: toD,
        total: count,
        by_date: byDateFiltered,
        items: undefined,  // omit huge flat list when range-filtered
      });
    }

    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({
      error: String(e?.message || e),
      ...emptyPayload(),
    }, { status: 500 });
  }
}
