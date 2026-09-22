// ═══════════════════════════════════════════════════════════════════════════
// CRON: REFRESH EARNINGS CALENDAR (PATCH 0181)
//
// Runs daily via Vercel Cron (configured in vercel.json — `0 1 * * *` = 06:30 IST).
// One NSE board-meetings range call (zzz748; was ~750 per-symbol calls that
// answered nothing). Buckets results-purpose meetings by scheduled date and
// writes to KV: `earnings-cal:auto:YYYY-MM-DD`
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
import { fetchUpcomingBoardMeetings } from '@/lib/earnings/upcoming-meetings';

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
  // PATCH 0460 — require auth in production. Previously the endpoint was
  // OPEN to the world when CRON_SECRET was unset (so any external caller
  // could hammer it and force a costly NSE-universe fetch). Now: missing
  // env in production rejects; Vercel Cron header bypasses for the cron
  // pipeline. Dev / preview without env still permits ad-hoc triggers.
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelHeader = req.headers.get('x-vercel-cron') || req.headers.get('x-vercel-signature') || '';

  // PATCH 1041 — CRON_SECRET is unset on this deploy and the GitHub Actions
  // bridge can't send a Vercel header, so the old code 503'd every cron run and
  // the calendar was never warmed. Only enforce the secret when one is actually
  // configured; otherwise allow the cron so daily warming keeps the durable
  // month snapshot accumulating.
  if (!vercelHeader && expected && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isRedisAvailable()) {
    return NextResponse.json({ error: 'KV not configured — nothing to refresh' }, { status: 503 });
  }

  // ── Steps 1+2: NSE + BSE upcoming meetings, one call each  (zzz748) ─────
  //
  // The per-symbol `/api/equity-meetings?symbol=X` walk (~750 NSE calls a
  // morning) answered nothing for weeks — HTTP 200, meetings_found 0, no
  // keys written, and nobody told. Now the shared fetch in
  // lib/earnings/upcoming-meetings (NSE range call + BSE forthcoming
  // results) over [today-14d, today+60d], every listed company, not just
  // the Nifty universe the small and mid caps here were never in.
  const calendar: Record<string, Set<string>> = {};   // date → tickers
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 60);
  const back = new Date(today);
  back.setDate(back.getDate() - 14);

  let scanned = 0;
  let withMeeting = 0;
  const up = await fetchUpcomingBoardMeetings(back, horizon);
  const fetchError = [up.nse.error ? `NSE: ${up.nse.error}` : null, up.bse.error ? `BSE: ${up.bse.error}` : null].filter(Boolean).join(' · ') || null;
  for (const m of up.meetings) {
    scanned++;
    const meetDate = parseNseDate(m.bm_date);
    if (!meetDate) continue;
    const md = new Date(meetDate);
    if (md > horizon || md < back) continue;
    if (!calendar[meetDate]) calendar[meetDate] = new Set();
    calendar[meetDate].add(m.bm_symbol);
    withMeeting++;
  }
  const tickers = { length: scanned };   // kept for the response shape below

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
        fetch_error: fetchError,
        sources: { nse: up.nse, bse: up.bse },
      },
      30 * 24 * 3600,
    );
  } catch {}

  // zzz748 — a run that found nothing is reported as such, with the reason.
  // The GitHub bridge treats non-2xx as a failed run, which is what an empty
  // calendar in results season should be.
  const nothing = withMeeting === 0;
  return NextResponse.json({
    status: nothing ? 'empty' : 'ok',
    fetch_error: fetchError,
    sources: { nse: up.nse, bse: up.bse },
    scanned_meetings: scanned,
    universe_size: tickers.length,
    meetings_found: withMeeting,
    dates_written: writes,
    dates: Object.keys(calendar).sort(),
    sample: Object.entries(calendar).slice(0, 5).map(([d, s]) => ({ date: d, count: s.size, sample: [...s].slice(0, 10) })),
    completed_at: new Date().toISOString(),
  }, { status: nothing ? 503 : 200 });
}

// PATCH 1031 — accept POST too (the GitHub cron bridge POSTs). Delegates to GET.
export async function POST(req: Request) { return GET(req); }
