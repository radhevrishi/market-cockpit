// zzz1259 — the weekly automatic Choke-Point Themes run (see the app-scheduler entry). A failed run never overwrites the last
// good report (runChoke only stores on success) and never blocks the next try beyond the weekly attempt cap.
export const CHOKE_WEEKLY_MIN_AGE_DAYS = 4;
export const CHOKE_WEEKLY_MAX_ATTEMPTS = 2;

export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
}

/** pure decision: run now, or why not */
export function chokeWeeklyDecision(generatedAt: string | null | undefined, attemptsThisWeek: number, now: Date): { run: boolean; why: string } {
  if (attemptsThisWeek >= CHOKE_WEEKLY_MAX_ATTEMPTS) return { run: false, why: `already tried ${attemptsThisWeek} times this week` };
  const ms = generatedAt ? Date.parse(generatedAt) : NaN;
  if (Number.isFinite(ms) && now.getTime() - ms < CHOKE_WEEKLY_MIN_AGE_DAYS * 86_400_000) return { run: false, why: `last report is ${((now.getTime() - ms) / 86_400_000).toFixed(1)} days old` };
  return { run: true, why: Number.isFinite(ms) ? `last report is ${Math.round((now.getTime() - ms) / 86_400_000)} days old` : 'no report on file' };
}

export async function chokeWeeklyJob(ctx: { log: (m: string) => void }): Promise<{ ok: boolean; status: number; error?: string | null }> {
  const { kvGet, kvGetStrict, kvIncrByFloat } = await import('../kv');
  const { CHOKE_KEY, runChoke } = await import('./run');
  const now = new Date();
  const wk = `choke-themes:auto:v1:${isoWeekKey(now)}`;
  // zzz1262 — a store that cannot be read is not "no report on file": skip (this is a paid run), the next slot tries again
  let attempts = 0, last: { generatedAt?: string } | null = null;
  try { attempts = Number(await kvGet<number>(wk)) || 0; last = await kvGetStrict<{ generatedAt?: string }>(CHOKE_KEY); }
  catch (e: any) { ctx.log(`choke weekly: skipped — the store could not be read (${String(e?.message || e).slice(0, 80)})`); return { ok: false, status: 503, error: 'store unreadable' }; }
  const d = chokeWeeklyDecision(last?.generatedAt, attempts, now);
  if (!d.run) { ctx.log(`choke weekly: skipped — ${d.why}`); return { ok: true, status: 200 }; }
  await kvIncrByFloat(wk, 1, 9 * 86_400).catch(() => null);
  const r = await runChoke();
  if (!r.ok) { ctx.log(`choke weekly: run failed — ${r.error}`); return { ok: false, status: 503, error: String(r.error).slice(0, 200) }; }
  ctx.log(`choke weekly: refreshed (${d.why})`);
  return { ok: true, status: 200 };
}
