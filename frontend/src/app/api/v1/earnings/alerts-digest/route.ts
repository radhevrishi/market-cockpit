// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS WORTH WAKING SOMEONE UP FOR.                              (zzz675)
//
// One read-only endpoint answering a single question: which companies have
// filed recently, graded BLOCKBUSTER or STRONG, and pass the Quality Preset?
//
// It exists so that "preset-passing" has exactly ONE definition on the server
// side, shared with the chip in the UI (lib/quality-preset). Any alert channel
// — email, Telegram, a push — reads this and formats it. None of them gets to
// re-implement the filter, because every time this codebase has allowed two
// copies of a rule, the copies have drifted and the drift has shipped.
//
// zzz911 — the selection itself now lives in lib/india-earnings-alert.ts, so the
// app's own alert job (/api/v1/cron/india-earnings-alert) uses the very same code
// in-process. Hits also carry `pe` and `source_url` (the filing link).
//
// DEDUP IS THE CALLER'S JOB, NOT THIS ROUTE'S. This endpoint is a pure view of
// the current state: ask it twice and it answers the same thing twice. A
// caller that sends messages keeps its own "already told him about this"
// record, because only the caller knows what it actually delivered. Making the
// read side stateful would mean a failed send silently consumed the alert.
//
// Read-only: no writes, no KV mutation, safe to call as often as you like.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { isRedisAvailable } from '@/lib/kv';
import { utcDatesBack } from '@/lib/india-earnings-alert';
import { collectIndiaAlertHits } from '@/lib/india-earnings-alert-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Calendar days back to scan. Kept small: an "alert" about a filing from last
 *  week is not an alert, it is a report, and the bench already serves those. */
const DEFAULT_DAYS = 3;
const MAX_DAYS = 14;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(MAX_DAYS, Math.max(1, Number(searchParams.get('days')) || DEFAULT_DAYS));

  if (!isRedisAvailable()) {
    return NextResponse.json(
      { ok: false, error: 'kv_unavailable', hits: [], scanned: [] },
      { status: 503 },
    );
  }

  // isAlertable (lib/quality-preset) on every graded row of each day; alert_id = TICKER:FILING_DATE (the next
  // quarter is a new event, a re-grade of the same filing is not); best first: BLOCKBUSTER over STRONG, then the
  // fundamentals-only score rather than the blended one, because the blend still carries the chart.
  const { hits, scanned } = await collectIndiaAlertHits(utcDatesBack(days));

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    days,
    count: hits.length,
    scanned,
    hits,
  });
}
