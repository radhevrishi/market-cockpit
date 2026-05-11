import { NextResponse } from 'next/server';
import { kvGet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/earnings/calendar — read endpoint (patch 0135)
//
// PURE READ — Vercel does NO scraping.  Data is populated by an external
// worker (worker/ directory, deploy to Hetzner / Railway / Render / fly.io)
// that pushes canonical payloads via /api/v1/earnings/calendar/ingest.
//
// Architecture (10-yr durable stack):
//   Tier 1: Persistent worker w/ Playwright + cookie jar (external host)
//   Tier 2: Multi-source aggregator (NSE + BSE + Trendlyne + Tickertape)
//   Tier 3: Reconciliation + dedup
//   Tier 4: AI = analyst layer (scoring, classification) — NOT transport
//
// Chrome-MCP path is one-time seed / emergency fallback only.
// ═══════════════════════════════════════════════════════════════════════════

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
  if (!isRedisAvailable()) {
    return NextResponse.json({
      error: 'KV not configured.',
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
      const day: any = await kvGet(`earnings:calendar:nse:v1:date:${date}`);
      if (day) {
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
    const full: any = await kvGet('earnings:calendar:nse:v1');
    if (!full) {
      return NextResponse.json({
        ...emptyPayload(),
        empty_reason: 'worker_has_not_pushed_yet',
        next_step: 'Run the worker (worker/scrape-runner.ts) on a persistent host. Chrome-MCP seed is one-time only.',
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
