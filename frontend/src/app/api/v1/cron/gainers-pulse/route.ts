// zzz912 — GET /api/v1/cron/gainers-pulse: did the India gainers research produce anything in the last two trading
// sessions? Read by the Cloudflare guardian (workers/mc-guardian) once a day on weekdays; it alerts only when `ok` is
// false. Public and read-only: dates, counts and the gainers job heartbeats — no findings, no personal data, no AI.
// Always HTTP 200 when the check itself ran (the verdict is in the body); 503 only when Redis is unavailable.

import { NextResponse } from 'next/server';
import { kvGet, kvMGet, isRedisAvailable } from '@/lib/kv';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import { isNseHolidayDate } from '@/lib/market-hours';
import {
  expectedIndiaSessions, sessionInfo, gainersPulseVerdict, GAINERS_CHECK_SESSIONS, GAINERS_LOOKBACK_SESSIONS,
  type GainersSessionInfo, type GainersHeartbeat,
} from '@/lib/gainers-pulse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_KEY = (d: string) => `ai-gainers:research:v1:IN:${d}`;   // written by /api/v1/ai-gainers/research
const HB = ['daily-research-gainers-in', 'daily-research-gainers-us'];

export async function GET() {
  if (!isRedisAvailable()) return NextResponse.json({ ok: null, error: 'Redis not available — cannot check' }, { status: 503 });
  try { await warmNseHolidays(); } catch { /* weekday rule still applies */ }
  const now = new Date();
  const dates = expectedIndiaSessions(now, GAINERS_LOOKBACK_SESSIONS, isNseHolidayDate);
  const checked = dates.slice(0, GAINERS_CHECK_SESSIONS);
  // newest first, one state at a time (each is up to ~250 KB); stop at the first session with output
  const sessions: GainersSessionInfo[] = [];
  try {
    for (let i = 0; i < dates.length; i++) {
      const info = sessionInfo(dates[i], await kvGet<any>(STATE_KEY(dates[i])));
      sessions.push(info);
      if (info.researched > 0) break;
    }
  } catch (e: any) {
    return NextResponse.json({ ok: null, error: `research store not readable: ${String(e?.message || e).slice(0, 200)}` }, { status: 503 });
  }
  const rows = await kvMGet<any>(HB.map((n) => `cron-heartbeat:row:${n}`)).catch(() => HB.map(() => null));
  const heartbeats: GainersHeartbeat[] = HB.map((name, i) => ({
    name, last_ok_at: rows[i]?.last_ok_at ?? null, last_ok: typeof rows[i]?.last_ok === 'boolean' ? rows[i].last_ok : null, error: rows[i]?.error ?? null,
  }));
  const verdict = gainersPulseVerdict(checked, sessions, heartbeats[0]);
  return NextResponse.json({ ...verdict, heartbeats, as_of: now.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
