// ═══════════════════════════════════════════════════════════════════════════
// CRON: REFRESH EARNINGS CALENDAR (PATCH 0181)
//
// Runs daily via Vercel Cron (configured in vercel.json — `0 1 * * *` = 06:30 IST).
// Walks the Nifty500 + Nifty Smallcap 250 + NiftyNext50 universe (~750 tickers)
// and fetches each ticker's upcoming board meetings from NSE. Bucket them by
// scheduled meeting date and write to KV: `earnings-cal:auto:YYYY-MM-DD`
// → string[] of tickers scheduled for that date.
//
// /api/market/earnings reads this on every request and merges into universe.
//
// Result: self-updating calendar that survives 10+ years without intervention.
// No hardcoded ticker lists.
//
// Manual trigger: GET /api/v1/cron/refresh-earnings-calendar?secret=<env>
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvSet, isRedisAvailable } from '@/lib/kv';
import {
  fetchNifty50,
  fetchNiftyNext50,
  fetchNifty500,
  fetchNiftySmallcap250,
  nseApiFetch,
} from '@/lib/nse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // 5 min — Vercel Pro plan

/** Parse "DD-MMM-YYYY" → YYYY-MM-DD */
function parseNseDate(s: string): string | null {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[- /]([A-Za-z]{3})[- /](\d{4})/);
  if (!m) return null;
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const mm = months[m[2].toUpperCase().slice(0, 3)];
  if (mm === undefined) return null;
  const d = new Date(Date.UTC(parseInt(m[3], 10), mm, parseInt(m[1], 10)));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  // Optional auth: ?secret=... must match env var if set (recommended for
  // production so randos can't hammer the endpoint).
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  if (expected && provided !== expected) {
    // Vercel Cron sends its own header — also accept that:
    const vercelHeader = req.headers.get('x-vercel-cron') || req.headers.get('x-vercel-signature') || '';
    if (!vercelHeader) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (!isRedisAvailable()) {
    return NextResponse.json({ error: 'KV not configured — nothing to refresh' }, { status: 503 });
  }

  // ── Step 1: Build the universe of tickers to check ─────────────────────
  const [n50, nn50, n500, smc250] = await Promise.all([
    fetchNifty50().catch(() => null),
    fetchNiftyNext50().catch(() => null),
    fetchNifty500().catch(() => null),
    fetchNiftySmallcap250().catch(() => null),
  ]);
  const universe = new Set<string>();
  for (const idx of [n50, nn50, n500, smc250]) {
    if (!idx?.data) continue;
    for (const item of idx.data as any[]) {
      const sym = item?.symbol;
      if (sym && typeof sym === 'string' && /^[A-Z0-9&\-]+$/.test(sym)) universe.add(sym);
    }
  }
  const tickers = [...universe];

  // ── Step 2: For each ticker, fetch upcoming board meetings ──────────────
  // NSE per-symbol board-meeting endpoint: /api/equity-meetings?index=equities&symbol=X
  // Returns recent + upcoming meetings. We bucket by meeting date.
  const calendar: Record<string, Set<string>> = {};   // date → tickers
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 60);  // look 60 days forward

  // Concurrency limit: 5 parallel requests, throttle to avoid NSE rate limits
  const CONCURRENCY = 5;
  let cursor = 0;
  let scanned = 0;
  let withMeeting = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const i = cursor++;
      const sym = tickers[i];
      scanned++;
      try {
        const data = await nseApiFetch(
          `/api/equity-meetings?index=equities&symbol=${encodeURIComponent(sym)}`,
          300000,
        );
        if (!data) continue;
        const arr = Array.isArray(data) ? data : (data?.data || []);
        for (const meeting of arr as any[]) {
          const purpose = String(meeting?.bm_purpose || meeting?.purpose || '').toLowerCase();
          if (!purpose.includes('financial result') && !purpose.includes('quarterly result')) continue;
          const desc = String(meeting?.bm_desc || meeting?.desc || '').toLowerCase();
          // Exclude AGM/EGM/Dividend-only meetings
          if (purpose.includes('agm') || purpose.includes('egm')) continue;
          if (purpose.includes('dividend') && !purpose.includes('financial result')) continue;
          const meetDateStr = meeting?.bm_date || meeting?.bm_meetingDate || meeting?.date;
          const meetDate = parseNseDate(meetDateStr);
          if (!meetDate) continue;
          // Only future + recent past (last 14 days)
          const md = new Date(meetDate);
          if (md > horizon) continue;
          const ageDays = (today.getTime() - md.getTime()) / (24 * 3600_000);
          if (ageDays > 14) continue;
          if (!calendar[meetDate]) calendar[meetDate] = new Set();
          calendar[meetDate].add(sym);
          withMeeting++;
          // also try to capture additional desc text for evidence
          void desc;
        }
      } catch {
        // ignore per-symbol failures
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // ── Step 3: Write to KV ────────────────────────────────────────────────
  let writes = 0;
  for (const [date, set] of Object.entries(calendar)) {
    const tickerList = [...set];
    try {
      await kvSet(`earnings-cal:auto:${date}`, tickerList, 30 * 24 * 3600);  // 30 day TTL
      writes++;
    } catch {}
  }
  // Also write a summary index
  try {
    await kvSet(
      'earnings-cal:auto:_summary',
      {
        last_run: new Date().toISOString(),
        scanned_tickers: scanned,
        meetings_found: withMeeting,
        dates_written: writes,
        date_range: Object.keys(calendar).sort(),
      },
      30 * 24 * 3600,
    );
  } catch {}

  return NextResponse.json({
    status: 'ok',
    scanned_tickers: scanned,
    universe_size: tickers.length,
    meetings_found: withMeeting,
    dates_written: writes,
    dates: Object.keys(calendar).sort(),
    sample: Object.entries(calendar).slice(0, 5).map(([d, s]) => ({ date: d, count: s.size, sample: [...s].slice(0, 10) })),
    completed_at: new Date().toISOString(),
  });
}
