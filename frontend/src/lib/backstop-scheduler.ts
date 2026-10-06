// zzz885 — BACKSTOP SCHEDULER: GitHub's free cron drops many scheduled runs (the 03:00 / 06:00 / 11:00 / 14:00 prewarm-earnings
// slots fired 0 times in 8 days). The app itself runs all day on Railway, so it checks each important job a while after its slot:
// if the job's heartbeat shows no success since the slot, the app runs the job itself, once (a Redis lock per slot, so a second
// copy of the server during a deploy cannot double-run it). When GitHub DID run the job, nothing happens — no double work.
//
// Pure decision logic (`dueBackstops`) is unit-tested; `startBackstopScheduler` is the timer, started from instrumentation.ts.

export interface BackstopJob {
  /** heartbeat name (same name GitHub's workflow posts) */
  name: string;
  /** UTC "HH:MM" slots; the job is expected to have succeeded at or after each */
  slotsUtc: string[];
  /** builds the path to call (may depend on the date) */
  path: (now: Date) => string;
  method: 'GET' | 'POST';
  /** minutes after the slot before the backstop steps in (GitHub runs are often 10-40 min late) */
  graceMin: number;
  /** only these UTC weekdays (0=Sun); empty = every day */
  days?: number[];
}

const ym = (d: Date, addMonths = 0) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + addMonths, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };

export const BACKSTOP_JOBS: readonly BackstopJob[] = [
  { name: 'prewarm-earnings', slotsUtc: ['03:07', '06:07', '11:07', '14:07'], path: () => '/api/v1/cron/prewarm-earnings', method: 'POST', graceMin: 45 },
  { name: 'refresh-earnings-calendar', slotsUtc: ['01:07'], path: () => '/api/v1/cron/refresh-earnings-calendar', method: 'POST', graceMin: 60 },
  { name: 'hub-ingest', slotsUtc: ['18:07'], path: (d) => `/api/market/earnings?ingest=1&force=1&month=${ym(d)}`, method: 'POST', graceMin: 60 },
  { name: 'hub-ingest-next', slotsUtc: ['18:15'], path: (d) => `/api/market/earnings?ingest=1&force=1&month=${ym(d, 1)}`, method: 'POST', graceMin: 60 },
  { name: 'archive-to-postgres', slotsUtc: ['19:30'], path: () => '/api/v1/cron/archive-to-postgres?months=2&ahead=1', method: 'POST', graceMin: 60 },
  // zzz906: two more GitHub often skips (both went stale on 6 Oct)
  { name: 'refresh-bench', slotsUtc: ['03:04'], path: () => '/api/v1/cron/refresh-bench', method: 'GET', graceMin: 60 },
  { name: 'intelligence-compute', slotsUtc: ['04:07'], path: () => '/api/market/intelligence/compute', method: 'POST', graceMin: 60, days: [1, 2, 3, 4, 5] },
  { name: 'refresh-us-bench', slotsUtc: ['05:45'], path: () => '/api/v1/cron/refresh-us-bench', method: 'POST', graceMin: 60 },
];

/** how long after (slot + grace) the backstop still acts; later than this the next slot takes over */
export const BACKSTOP_WINDOW_MIN = 120;

/** Pure: which (job, slot) pairs need running now. `lastOk` maps job name → ISO time of its last success (or null). */
export function dueBackstops(now: Date, jobs: readonly BackstopJob[], lastOk: Record<string, string | null | undefined>): Array<{ job: BackstopJob; slot: Date; lockKey: string }> {
  const out: Array<{ job: BackstopJob; slot: Date; lockKey: string }> = [];
  for (const job of jobs) {
    if (job.days?.length && !job.days.includes(now.getUTCDay())) continue;
    for (const s of job.slotsUtc) {
      const [h, m] = s.split(':').map(Number);
      // the slot today, or yesterday's when today's has not come yet (handles the window crossing midnight)
      for (const dayShift of [0, -1]) {
        const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayShift, h, m));
        const sinceMin = (now.getTime() - slot.getTime()) / 60000;
        if (sinceMin < job.graceMin || sinceMin > job.graceMin + BACKSTOP_WINDOW_MIN) continue;
        const ok = lastOk[job.name] ? Date.parse(String(lastOk[job.name])) : 0;
        // a run that started a little before the slot (GitHub early / manual) still counts
        if (ok && ok >= slot.getTime() - 15 * 60000) continue;
        out.push({ job, slot, lockKey: `backstop:v1:${job.name}:${slot.toISOString().slice(0, 16)}` });
      }
    }
  }
  return out;
}

let started = false;
/** Starts a 5-minute timer. Needs CRON_SECRET (the jobs check it) and Redis (the lock). Off with BACKSTOP_SCHEDULER=0. */
export function startBackstopScheduler(): void {
  if (started || process.env.BACKSTOP_SCHEDULER === '0' || !process.env.CRON_SECRET) return;
  started = true;
  const port = parseInt(process.env.PORT || '', 10) || 3000;
  const base = `http://127.0.0.1:${port}`;
  const tick = async () => {
    try {
      const { kvMGet, kvSetNX, isRedisAvailable } = await import('./kv');
      if (!isRedisAvailable()) return;
      const rows = await kvMGet<{ last_ok_at?: string | null }>(BACKSTOP_JOBS.map((j) => `cron-heartbeat:row:${j.name}`));
      const lastOk: Record<string, string | null> = {};
      BACKSTOP_JOBS.forEach((j, i) => { lastOk[j.name] = rows[i]?.last_ok_at || null; });
      for (const d of dueBackstops(new Date(), BACKSTOP_JOBS, lastOk)) {
        if (!(await kvSetNX(d.lockKey, { at: new Date().toISOString() }, 12 * 3600))) continue;   // another copy took it, or already done
        const t0 = Date.now(); let status = 0; let err: string | null = null;
        try {
          const r = await fetch(base + d.job.path(d.slot),   // zzz897: month from the SLOT's date, not the clock (a catch-up after midnight UTC on the 1st must still ingest the month that just ended)
           { method: d.job.method, headers: { 'content-type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET || '' }, signal: AbortSignal.timeout(14 * 60_000) });
          status = r.status; await r.text().catch(() => '');
        } catch (e: any) { err = String(e?.message || e).slice(0, 200); }
        const ok = status >= 200 && status < 300;
        console.log(`[backstop] ${d.job.name} slot ${d.slot.toISOString().slice(11, 16)}Z → HTTP ${status || 'error'} in ${Math.round((Date.now() - t0) / 1000)}s${err ? ` (${err})` : ''}`);
        await fetch(`${base}/api/v1/cron/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: d.job.name, phase: 'end', ok, exit_code: status || null, error: ok ? null : (err || `backstop HTTP ${status}`) }), signal: AbortSignal.timeout(10_000) }).catch(() => {});
      }
    } catch (e) { console.warn('[backstop] tick failed', e); }
  };
  // first check two minutes after start (let the server warm up), then every five minutes
  setTimeout(() => { void tick(); setInterval(() => { void tick(); }, 5 * 60_000).unref?.(); }, 2 * 60_000).unref?.();
}
