// zzz912 — GAINERS PULSE: did the India gainers research pipeline PRODUCE anything in the last two trading sessions?
//
// Replaces a Claude scheduled task ("gainers pipeline heartbeat"), which looked for the Daily Gainers Brief email. The
// app cannot read Gmail, so it checks the thing the brief is built from: the day's research store
// (`ai-gainers:research:v1:IN:<session>`, filled by the gainers-in run of daily-research.yml at 10:50 UTC and by the
// page). Healthy = at least one of the last two completed trading sessions (weekends and NSE holidays skipped) has
// researched names. Silence when healthy; the Cloudflare guardian sends the alert (workers/mc-guardian).
// PURE: no fetch, no KV, no clock — the route passes `now` and the holiday test.

const IST_MS = 5.5 * 3600_000;
/** After this IST time on a trading day, that day's research is expected (the run starts 16:20 IST). */
export const GAINERS_DUE_IST_MIN = 17 * 60;
export const GAINERS_CHECK_SESSIONS = 2;
export const GAINERS_LOOKBACK_SESSIONS = 7;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** The last `n` trading sessions whose research should exist by `now`, newest first. */
export function expectedIndiaSessions(now: Date, n: number, isHoliday: (ymd: string) => boolean): string[] {
  const ist = new Date(now.getTime() + IST_MS);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const trading = (x: Date) => !isWeekend(x) && !isHoliday(ymd(x));
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (!(trading(d) && mins >= GAINERS_DUE_IST_MIN)) d.setUTCDate(d.getUTCDate() - 1);
  const out: string[] = [];
  for (let guard = 0; out.length < n && guard < n * 4 + 10; guard++) {
    if (trading(d)) out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

export interface GainersSessionInfo { date: string; researched: number; total: number; updated_at: string | null }
export interface GainersHeartbeat { name: string; last_ok_at: string | null; last_ok: boolean | null; error: string | null }
export interface GainersPulse {
  ok: boolean;
  checked: string[];
  last_output: GainersSessionInfo | null;
  sessions: GainersSessionInfo[];
  reason: string;
  likely_cause: string | null;
}

/** Counts of one stored research state (or null when the session has none). */
export function sessionInfo(date: string, st: any): GainersSessionInfo {
  const researched = st && st.findings && typeof st.findings === 'object' ? Object.keys(st.findings).length : 0;
  const total = Array.isArray(st?.universe) ? st.universe.length : 0;
  return { date, researched, total, updated_at: typeof st?.updated_at === 'string' ? st.updated_at : null };
}

/**
 * The verdict. `sessions` = what was read for the expected sessions, newest first (it may run past the checked ones,
 * to find when output last appeared). `hb` = the gainers-in heartbeat row, used only to name the likely cause.
 */
export function gainersPulseVerdict(checked: string[], sessions: GainersSessionInfo[], hb: GainersHeartbeat | null): GainersPulse {
  const byDate = new Map(sessions.map((s) => [s.date, s]));
  const last = sessions.find((s) => s.researched > 0) || null;
  const ok = checked.some((d) => (byDate.get(d)?.researched || 0) > 0);
  if (ok) return { ok, checked, last_output: last, sessions, reason: 'research found for a recent session', likely_cause: null };
  const lastWords = last ? `last research was for the ${last.date} session (${last.researched} names)` : `no research found in the last ${sessions.length} sessions`;
  const reason = `no gainers research for the ${checked.join(' or ')} session${checked.length > 1 ? 's' : ''}; ${lastWords}`;
  // likely cause — only from what is observable
  let cause: string;
  const oldest = checked[checked.length - 1];
  const boardSeen = checked.some((d) => (byDate.get(d)?.total || 0) > 0);
  if (!hb || !hb.last_ok_at) cause = 'the gainers-in job (daily-research.yml, 10:50 UTC on GitHub) has never reported a heartbeat';
  else if (hb.last_ok === false) cause = `the last gainers-in run failed${hb.error ? `: ${hb.error}` : ''} (last success ${hb.last_ok_at})`;
  else if (oldest && hb.last_ok_at.slice(0, 10) < oldest) cause = `the gainers-in job has not run successfully since ${hb.last_ok_at} — the GitHub schedule may have skipped it`;
  else if (boardSeen) cause = 'the job ran and read the gainers board, but no name was researched (research step failing)';
  else cause = 'the job ran but read no gainers board (screener.in page not answered or empty)';
  return { ok, checked, last_output: last, sessions, reason, likely_cause: cause };
}
