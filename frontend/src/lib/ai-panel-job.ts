// zzz1181 — A LONG AI RUN WITHOUT A TIMED-OUT REQUEST. The Choke-Point Themes and Future 100-baggers runs take 1–3 minutes;
// the host's proxy cut the waiting request (HTTP 502) and nothing was saved. Now the click STARTS the run on the server and
// returns at once; the run continues in this process and records its state in Redis; the page asks for the state every few
// seconds and shows the new result when it is done. One run at a time per panel. Server-only.
const running = new Map<string, Promise<void>>();
export interface JobState { state: 'idle' | 'running' | 'done' | 'error'; startedAt: string | null; finishedAt: string | null; error: string | null }
const STALE_MS = 16 * 60_000;   // zzz1187 — a research pass before the answer: runs take up to ~10 minutes

export async function jobState(key: string): Promise<JobState> {
  const { kvGet } = await import('./kv');
  const s = await kvGet<JobState>(`${key}:job`).catch(() => null);
  if (!s) return { state: 'idle', startedAt: null, finishedAt: null, error: null };
  // a "running" record whose process is gone (restart) stops counting after 16 minutes
  if (s.state === 'running' && !running.has(key) && s.startedAt && Date.now() - Date.parse(s.startedAt) > STALE_MS) return { ...s, state: 'error', error: 'The run was interrupted (server restart) — click again.' };
  return s;
}

/** Starts `fn` unless a run is already going; resolves at once with the state. */
export async function startJob(key: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<JobState> {
  const { kvSet } = await import('./kv');
  const cur = await jobState(key);
  if (running.has(key) || (cur.state === 'running' && cur.startedAt && Date.now() - Date.parse(cur.startedAt) < STALE_MS)) return { ...cur, state: 'running' };
  const startedAt = new Date().toISOString();
  const st: JobState = { state: 'running', startedAt, finishedAt: null, error: null };
  await kvSet(`${key}:job`, st, 3600).catch(() => undefined);
  const p = (async () => {
    let out: JobState;
    try {
      const r = await fn();
      out = { state: r.ok ? 'done' : 'error', startedAt, finishedAt: new Date().toISOString(), error: r.ok ? null : (r.error || 'failed') };
    } catch (e: any) {
      out = { state: 'error', startedAt, finishedAt: new Date().toISOString(), error: String(e?.message || e).slice(0, 300) };
    }
    await kvSet(`${key}:job`, out, 3 * 86_400).catch(() => undefined);
  })().finally(() => running.delete(key));
  running.set(key, p);
  return st;
}
