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
    // PATCH 1101zzz18 — earnings calendar self-heal. The legacy
    // `earnings:calendar:nse:v1` key is written ONLY by an external
    // Claude-in-Chrome scraper that has gone silent (last write
    // 2026-05-28, 24 days stale on the user's June 21 visit). The
    // GitHub Actions cron `refresh-earnings-calendar` writes a DIFFERENT
    // KV namespace — `earnings-cal:auto:YYYY-MM-DD` — with the same
    // ticker symbols. When the legacy payload is missing OR older than
    // 7 days, fall back to synthesising a minimal calendar from the
    // auto-* keys so the EO page is never stale by more than a day.
    const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
    const parsedFull: FullPayload | null = full
      ? (typeof full === 'string' ? JSON.parse(full) : full)
      : null;
    const legacyScrapedMs = parsedFull?.scraped_at ? Date.parse(parsedFull.scraped_at) : 0;
    const legacyIsFresh = parsedFull && (Date.now() - legacyScrapedMs < SEVEN_DAYS_MS);

    if (!legacyIsFresh) {
      // Build fallback from the cron-written namespace.
      const today = new Date();
      const horizonStart = new Date(today); horizonStart.setUTCDate(today.getUTCDate() - 60);
      const horizonEnd   = new Date(today); horizonEnd.setUTCDate(today.getUTCDate() + 60);
      const datesToCheck: string[] = [];
      for (let d = new Date(horizonStart); d <= horizonEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        datesToCheck.push(d.toISOString().slice(0, 10));
      }
      const cronByDate: Record<string, CalendarItem[]> = {};
      let cronTotal = 0;
      await Promise.all(datesToCheck.map(async (date) => {
        try {
          const tickers = await kvGet<string[]>(`earnings-cal:auto:${date}`);
          if (!tickers || !tickers.length) return;
          // Synthesize CalendarItem stubs (only ticker available — no PE / mcap / financials).
          // The UI tolerates the sparse shape; sub-fields just render as "—".
          cronByDate[date] = tickers.map((t) => ({
            symbol: t,
            company: t,
            filing_date: date,
            filing_dt_iso: null,
            quarter: '',
            period_ended: '',
            audited: false,
            consolidated: false,
            period_type: 'Quarterly',
            attachment: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(t)}`,
            source_url: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(t)}`,
            exchange: 'NSE',
          } as any));
          cronTotal += tickers.length;
        } catch {}
      }));
      const summary = (await kvGet<{ last_run?: string }>('earnings-cal:auto:_summary')) || {};
      const fallbackPayload: any = {
        ...emptyPayload(),
        scraped_at: summary.last_run || new Date().toISOString(),
        from: horizonStart.toISOString().slice(0, 10),
        to: horizonEnd.toISOString().slice(0, 10),
        total: cronTotal,
        by_date: cronByDate,
        source: 'cron-fallback',
        note: parsedFull
          ? 'legacy scraper stale (>7d); falling back to GitHub Actions cron data'
          : 'legacy scraper has not written; using GitHub Actions cron data',
      };
      // Range filter on fallback
      if (from || to) {
        const fromD = from || '0000-00-00';
        const toD   = to   || '9999-99-99';
        const filtered: Record<string, CalendarItem[]> = {};
        let count = 0;
        for (const [d, arr] of Object.entries(cronByDate)) {
          if (d >= fromD && d <= toD) {
            filtered[d] = arr;
            count += arr.length;
          }
        }
        fallbackPayload.from = fromD;
        fallbackPayload.to = toD;
        fallbackPayload.total = count;
        fallbackPayload.by_date = filtered;
      }
      return NextResponse.json(fallbackPayload);
    }
    const parsed = parsedFull as FullPayload;

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
