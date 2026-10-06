// zzz907 — GET /api/v1/cron/schedule: read-only view of the jobs the app schedules itself (lib/app-scheduler.ts).
// Per job: UTC crons, what it calls, the workflow kept for hand runs, the current slot's lock state (running / done),
// the heartbeat's last success and the next slot. Public: no secrets, nothing changes.

import { NextResponse } from 'next/server';
import { APP_JOBS, GITHUB_SCHEDULED, prevSlot, nextSlot, slotWindowMs, lockKeyFor, staleAfterHoursFor, MAX_CONCURRENT } from '@/lib/app-scheduler';
import { kvMGet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const slots = APP_JOBS.map((j) => prevSlot(j.crons, now));
  let rows: Array<{ last_ok_at?: string | null; last_ok?: boolean; updated_at?: string; error?: string | null } | null> = APP_JOBS.map(() => null);
  let locks: Array<{ state?: string; ok?: boolean; status?: number; at?: string } | null> = APP_JOBS.map(() => null);
  const redis = isRedisAvailable();
  if (redis) {
    try {
      const keys = [...APP_JOBS.map((j) => `cron-heartbeat:row:${j.name}`), ...APP_JOBS.map((j, i) => (slots[i] ? lockKeyFor(j.name, slots[i]!) : `appsched:v1:none`))];
      const vals = await kvMGet<any>(keys);
      rows = vals.slice(0, APP_JOBS.length);
      locks = vals.slice(APP_JOBS.length);
    } catch { /* informational view */ }
  }
  const jobs = APP_JOBS.map((j, i) => {
    const slot = slots[i];
    const win = slot ? slotWindowMs(j, slot) : null;
    const lock = locks[i];
    const lockState = typeof lock === 'object' && lock ? lock : null;
    return {
      name: j.name,
      crons_utc: j.crons,
      does: j.does,
      timeout_min: Math.round(j.timeoutMs / 60_000),
      manual_fallback: `.github/workflows/${j.workflow} (Run workflow)`,
      current_slot: slot ? slot.toISOString() : null,
      current_slot_window_ends: slot && win ? new Date(slot.getTime() + win).toISOString() : null,
      current_slot_state: lockState?.state || (slot && win && now.getTime() - slot.getTime() < win ? 'pending' : 'closed'),
      current_slot_ok: lockState?.state === 'done' ? !!lockState.ok : null,
      last_ok_at: rows[i]?.last_ok_at ?? null,
      last_ok: rows[i]?.last_ok ?? null,
      last_error: rows[i]?.last_ok === false ? (rows[i]?.error ?? null) : null,
      next_run: nextSlot(j.crons, now)?.toISOString() ?? null,
      stale_after_hours: staleAfterHoursFor(j.name, 25, now),
    };
  });
  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    scheduler: { enabled: process.env.APP_SCHEDULER !== '0' && process.env.BACKSTOP_SCHEDULER !== '0', has_secret: !!process.env.CRON_SECRET, redis, max_concurrent: MAX_CONCURRENT, retry: 'one retry after 45 s on 5xx / network error (not for paid-AI calls)' },
    jobs,
    stays_on_github: GITHUB_SCHEDULED,
  }, { headers: { 'cache-control': 'no-store' } });
}
