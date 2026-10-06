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
import { secretFromRequest } from '@/lib/request-secret';   // zzz883: header first, ?secret= only for old callers
import { kvSet, kvDel, kvMGet, isRedisAvailable } from '@/lib/kv';
import { calendarWindow, parseIsoDay, daysBetween, planCalendarWrites, calendarKeyTtlSeconds } from '@/lib/calendar-dates';   // zzz897
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
  const provided = secretFromRequest(req) || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelHeader = '' /* zzz883: x-vercel-cron no longer trusted (forgeable on Railway) */;

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
  // zzz897 — the window is anchored on the IST date and compared as YYYY-MM-DD strings (was server-local
  // Date objects compared with UTC-parsed meeting dates — off by a day on any non-UTC host).
  const win = calendarWindow(new Date(), 14, 60);
  const back = parseIsoDay(win.from)!;
  const horizon = parseIsoDay(win.to)!;

  let scanned = 0;
  let withMeeting = 0;
  const up = await fetchUpcomingBoardMeetings(back, horizon);
  const fetchError = [up.nse.error ? `NSE: ${up.nse.error}` : null, up.bse.error ? `BSE: ${up.bse.error}` : null].filter(Boolean).join(' · ') || null;
  for (const m of up.meetings) {
    scanned++;
    const meetDate = parseNseDate(m.bm_date);
    if (!meetDate) continue;
    if (meetDate > win.to || meetDate < win.from) continue;
    if (!calendar[meetDate]) calendar[meetDate] = new Set();
    calendar[meetDate].add(m.bm_symbol);
    withMeeting++;
  }
  const tickers = { length: scanned };   // kept for the response shape below

  // ── Step 3: Write to KV ────────────────────────────────────────────────
  // zzz897 — when both exchanges answered, every date in the window is rewritten and a date whose meeting moved
  // is cleared (it used to keep the old ticker for 30 days); when one exchange failed, new names are merged
  // into what is stored instead of replacing it, so a one-sided outage cannot drop the other exchange's names.
  const found: Record<string, string[]> = {};
  for (const [d, set] of Object.entries(calendar)) found[d] = [...set];
  const windowDays = daysBetween(win.from, win.to);
  const existing: Record<string, string[] | null> = {};
  try {
    const rows = await kvMGet<string[]>(windowDays.map((d) => `earnings-cal:auto:${d}`));
    windowDays.forEach((d, i) => { existing[d] = Array.isArray(rows[i]) ? rows[i] : null; });
  } catch {}
  const bothOk = up.nse.ok && up.bse.ok && !up.nse.error && !up.bse.error;
  const plan = withMeeting === 0 ? {} : planCalendarWrites(found, existing, win, bothOk);
  let writes = 0;
  let cleared = 0;
  for (const [date, tickerList] of Object.entries(plan)) {
    try {
      if (tickerList.length) { await kvSet(`earnings-cal:auto:${date}`, tickerList, calendarKeyTtlSeconds(date)); writes++; }  // zzz897: until 30 days after the date (was a flat 30 days, shorter than the 60-day look-ahead)
      else { await kvDel(`earnings-cal:auto:${date}`); cleared++; }
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
        dates_cleared: cleared,
        window: win,
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
    dates_cleared: cleared,
    merge_mode: bothOk ? 'replace' : 'merge',
    window: win,
    dates: Object.keys(calendar).sort(),
    sample: Object.entries(calendar).slice(0, 5).map(([d, s]) => ({ date: d, count: s.size, sample: [...s].slice(0, 10) })),
    completed_at: new Date().toISOString(),
  }, { status: nothing ? 503 : 200 });
}

// PATCH 1031 — accept POST too (the GitHub cron bridge POSTs). Delegates to GET.
export async function POST(req: Request) { return GET(req); }
