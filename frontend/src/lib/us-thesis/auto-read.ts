// zzz1259 — AUTOMATIC reading of new US SEC evidence (owner approved 11 Nov: "yes do all").
// After the free EDGAR discovery (us-evidence-check) says a name has NEW EVIDENCE AVAILABLE, the summary read
// (/api/v1/us-thesis/read?mode=incremental, Haiku) runs for it — inside hard limits, because this is paid:
//   • its own USD ceiling per UTC day (US_AUTO_READ_DAILY_USD, default $0.30); the worst-case cost of a read is RESERVED
//     before the call (atomic increment) and handed back when the read was skipped or failed;
//   • at most 8 names a run, book names before the rest (the order check-all lists them in);
//   • a name that fails twice is left for a manual click ("needs manual"), never retried forever;
//   • one read per name at a time (NX lock — the manual click can race the job);
//   • the first budget refusal (HTTP 429 / "limit") ends the run;
//   • never force=1 — mode=incremental reads only when EDGAR lists a filing newer than the latest period on file.
// Pure planning is separate from the I/O so it is testable.
export const AUTO_READ_EST_USD = 0.03;
export const AUTO_READ_MAX_NAMES = 8;
export const AUTO_READ_MAX_TRIES = 2;

export const autoReadCapUsd = (): number => {
  const raw = process.env.US_AUTO_READ_DAILY_USD, v = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(v) && v >= 0 ? v : 0.3;
};

export const dayKey = (d = new Date()) => `us-auto-read:usd:v1:${d.toISOString().slice(0, 10)}`;
export const triesKey = (t: string) => `us-auto-read:tries:v1:${t.toUpperCase()}`;
export const lockKey = (t: string) => `us-auto-read:lock:v1:${t.toUpperCase()}`;

/** names to read this run (order kept, duplicates dropped) and names left for a manual click */
export function planAutoRead(withNew: readonly string[], tries: Readonly<Record<string, number>>, maxNames = AUTO_READ_MAX_NAMES, maxTries = AUTO_READ_MAX_TRIES): { pick: string[]; needsManual: string[] } {
  const seen = new Set<string>(), pick: string[] = [], needsManual: string[] = [];
  for (const raw of withNew) {
    const t = String(raw || '').trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if ((tries[t] || 0) >= maxTries) { needsManual.push(t); continue; }
    if (pick.length < maxNames) pick.push(t);
  }
  return { pick, needsManual };
}

/** does this answer mean "the spending limit is reached — stop"? */
export function isBudgetRefusal(status: number, error: unknown): boolean {
  return status === 429 || /budget|spend limit|daily limit|cap reached|quota|rate limit/i.test(String(error || ''));
}

export interface AutoReadDeps {
  call: (path: string, opts: { timeoutMs: number; retry: false }) => Promise<{ ok: boolean; status: number; json?: any }>;
  kv: {
    get: <T>(k: string) => Promise<T | null>;
    set: (k: string, v: any, ttl?: number) => Promise<void>;
    setNX: (k: string, v: any, ttl: number) => Promise<boolean>;
    del: (k: string) => Promise<void>;
    incrByFloat: (k: string, by: number, ttl?: number) => Promise<number | null>;
  };
  deadline: number;
  now?: () => number;
  log: (m: string) => void;
}
export interface AutoReadResult { read: string[]; skipped: string[]; failed: string[]; needsManual: string[]; stoppedBy: 'budget' | 'ceiling' | 'time' | null; reservedUsd: number }

export async function runAutoRead(withNew: readonly string[], d: AutoReadDeps): Promise<AutoReadResult> {
  const now = d.now || Date.now, cap = autoReadCapUsd();
  const out: AutoReadResult = { read: [], skipped: [], failed: [], needsManual: [], stoppedBy: null, reservedUsd: 0 };
  if (cap <= 0 || !withNew.length) return out;
  const tries: Record<string, number> = {};
  for (const t of new Set(withNew.map((x) => String(x).toUpperCase()))) tries[t] = Number(await d.kv.get<number>(triesKey(t)).catch(() => 0)) || 0;
  const plan = planAutoRead(withNew, tries);
  out.needsManual = plan.needsManual;
  const dk = dayKey(new Date(now()));
  for (const t of plan.pick) {
    if (d.deadline - now() < 200_000) { out.stoppedBy = 'time'; break; }
    // reserve first: if the day's total passes the ceiling, give the reservation back and stop
    const total = await d.kv.incrByFloat(dk, AUTO_READ_EST_USD, 2 * 86_400);
    if (total == null || total > cap + 1e-9) { await d.kv.incrByFloat(dk, -AUTO_READ_EST_USD, 2 * 86_400).catch(() => null); out.stoppedBy = 'ceiling'; break; }
    const refund = () => d.kv.incrByFloat(dk, -AUTO_READ_EST_USD, 2 * 86_400).catch(() => null);
    if (!(await d.kv.setNX(lockKey(t), 1, 600).catch(() => false))) { await refund(); out.skipped.push(t); continue; }
    try {
      const r = await d.call(`/api/v1/us-thesis/read?ticker=${encodeURIComponent(t)}&mode=incremental`, { timeoutMs: Math.min(200_000, d.deadline - now() - 5_000), retry: false });
      const j = r.json || {};
      if (r.ok && j.ok) {
        if (j.skipped) { await refund(); out.skipped.push(t); } else { out.read.push(t); out.reservedUsd += AUTO_READ_EST_USD; }
        await d.kv.del(triesKey(t)).catch(() => undefined);
      } else {
        await refund();
        if (isBudgetRefusal(r.status, j.error)) { out.stoppedBy = 'budget'; break; }
        out.failed.push(t);
        await d.kv.set(triesKey(t), (tries[t] || 0) + 1, 3 * 86_400).catch(() => undefined);
      }
    } catch (e: any) {
      await refund();
      out.failed.push(t);
      await d.kv.set(triesKey(t), (tries[t] || 0) + 1, 3 * 86_400).catch(() => undefined);
    } finally { await d.kv.del(lockKey(t)).catch(() => undefined); }
  }
  d.log(`auto-read: read ${out.read.join(', ') || 'none'} · skipped ${out.skipped.length} · failed ${out.failed.join(', ') || 'none'} · needs manual ${out.needsManual.join(', ') || 'none'}${out.stoppedBy ? ` · stopped: ${out.stoppedBy}` : ''}`);
  return out;
}
