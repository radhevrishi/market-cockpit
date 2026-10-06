// zzz914 — the app-scheduler side of an owner brief (jobs `conviction-catalyst-brief`, `portfolio-thesis-watch`).
// One POST; the route answers 200 with `ok` — false when nothing could be delivered (no channel set up) or the book could
// not be read (the brief then went out marked PARTIAL). That `ok` decides the heartbeat. A paid-AI brief is never retried.
// Type-only import from app-scheduler: no cycle at runtime.
import type { CallResult, JobCtx, JobOutcome } from '../app-scheduler';

export function ownerBriefOutcome(r: CallResult): JobOutcome {
  if (!r.ok) return { ok: false, status: r.status, error: r.error || `owner brief HTTP ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}` };
  const j = r.json || {};
  if (j.ok === true) return { ok: true, status: r.status, error: j.alreadySent ? 'already sent today' : null };
  const ch = j.channels || {};
  const why = j.partial ? `brief went out PARTIAL: ${String(j.partial).slice(0, 160)}`
    : (!ch.telegram && !ch.email) ? 'no Telegram or email channel set up (lib/owner-notify)' : 'brief composed but not delivered';
  return { ok: false, status: r.status, error: why };
}

export async function ownerBriefJob(ctx: JobCtx, path: string, retry: boolean): Promise<JobOutcome> {
  const r = await ctx.call(path, { method: 'POST', timeoutMs: 170_000, retry });
  const out = ownerBriefOutcome(r);
  ctx.log(`counts ${JSON.stringify(r.json?.counts ?? {})}${r.json?.oneLine ? ' (one line: nothing new)' : ''}`);   // counts only, never tickers
  return out;
}
