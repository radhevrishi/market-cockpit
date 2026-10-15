// ═══════════════════════════════════════════════════════════════════════════
// AI RUN RECORDS — one row per model call, kept 90 days.                (zzz1050)
//
// Every model call leaves one record in Postgres table `ai_run` (migration 4 in
// lib/db-migrate.ts): which job asked, which model answered, the prompt version,
// the document, start / finish / duration, tokens, cost, the outcome and — for
// the guidance extractor — how many rows the checks kept and rejected and why a
// call was sent to the stronger model. The /ai-runs page reads it.
//
//   • The meter (lib/anthropic-meter) writes a record for every call by default.
//   • The guidance extractor writes its own, richer records (rows kept /
//     rejected, escalation) in one batch at the end of a run, and tells the
//     meter not to write.
//
// Writes are BEST-EFFORT: no database, a failed migration, a slow insert — the
// record is lost, the job never fails and never waits long. The same write
// deletes rows older than 90 days (a small bounded DELETE, so it stays cheap).
// Records carry counts and short, redacted error text — never document text,
// never a key.
// ═══════════════════════════════════════════════════════════════════════════

export const AI_RUN_OUTCOMES = ['ok', 'failed', 'schema_fail', 'quote_rejected', 'escalated', 'cap_reached'] as const;
export type AiRunOutcome = typeof AI_RUN_OUTCOMES[number];
export const AI_RUN_RETENTION_DAYS = 90;
export const AI_RUN_DELETE_BATCH = 500;
const ERROR_MAX = 300;

export interface AiRunRecord {
  /** one id per call (`<job>-<time>-<random>`) */
  runId: string;
  /** the batch this call belonged to (a guidance extraction run), or null */
  batchId: string | null;
  job: string;
  model: string | null;
  promptVersion: string | null;
  docId: string | null;
  ticker: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outcome: AiRunOutcome;
  error: string | null;
  rowsKept: number | null;
  rowsRejected: number | null;
  /** why this call went to (or came from) the stronger model; null when no routing */
  escalationReason: string | null;
}

/** The same redaction the extractor uses for its notes: never a key or a bearer token in a stored error. */
export function shortError(s: unknown, max = ERROR_MAX): string | null {
  const t = String(s ?? '')
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b(sk-ant|sk-proj)[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/\bbearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|authorization|x-api-key|secret|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

export const newRunId = (job: string, at = new Date()) => `${String(job || 'ai').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'ai'}-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const int = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const clip = (v: unknown, n: number) => (v == null || v === '' ? null : String(v).slice(0, n));

/** Pure: a well-formed record from a partial one (unknown outcome → failed; negative / NaN numbers → 0; strings clipped). */
export function buildRunRecord(p: Partial<AiRunRecord> & { job: string; startedAt: string }): AiRunRecord {
  const started = Date.parse(p.startedAt);
  const finishedAt = p.finishedAt || new Date().toISOString();
  const dur = p.durationMs != null ? int(p.durationMs) : Number.isFinite(started) ? Math.max(0, Date.parse(finishedAt) - started) : 0;
  const cost = Number(p.costUsd);
  return {
    runId: p.runId || newRunId(p.job),
    batchId: clip(p.batchId, 64),
    job: String(p.job).slice(0, 48),
    model: clip(p.model, 64),
    promptVersion: clip(p.promptVersion, 64),
    docId: clip(p.docId, 80),
    ticker: clip(p.ticker, 24),
    startedAt: p.startedAt,
    finishedAt,
    durationMs: dur,
    inputTokens: int(p.inputTokens),
    outputTokens: int(p.outputTokens),
    costUsd: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 1e6) / 1e6 : 0,
    outcome: (AI_RUN_OUTCOMES as readonly string[]).includes(String(p.outcome)) ? (p.outcome as AiRunOutcome) : 'failed',
    error: shortError(p.error),
    rowsKept: p.rowsKept == null ? null : int(p.rowsKept),
    rowsRejected: p.rowsRejected == null ? null : int(p.rowsRejected),
    escalationReason: clip(p.escalationReason, 48),
  };
}

const COLS = ['run_id', 'batch_id', 'job', 'model', 'prompt_version', 'doc_id', 'ticker', 'started_at', 'finished_at', 'duration_ms', 'input_tokens', 'output_tokens', 'cost_usd', 'outcome', 'error', 'rows_kept', 'rows_rejected', 'escalation_reason'] as const;

/** Pure: one multi-row INSERT (parameterised). */
export function insertSql(recs: AiRunRecord[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const rows = recs.map((r) => {
    const v = [r.runId, r.batchId, r.job, r.model, r.promptVersion, r.docId, r.ticker, r.startedAt, r.finishedAt, r.durationMs, r.inputTokens, r.outputTokens, r.costUsd, r.outcome, r.error, r.rowsKept, r.rowsRejected, r.escalationReason];
    const ph = v.map((x) => { values.push(x); return `$${values.length}`; });
    return `(${ph.join(',')})`;
  });
  return { text: `INSERT INTO ai_run (${COLS.join(', ')}) VALUES ${rows.join(', ')} ON CONFLICT (run_id) DO NOTHING`, values };
}

/** Pure: the retention DELETE — at most AI_RUN_DELETE_BATCH rows older than the retention window, per write. */
export const RETENTION_SQL = `DELETE FROM ai_run WHERE run_id IN (SELECT run_id FROM ai_run WHERE started_at < now() - interval '${AI_RUN_RETENTION_DAYS} days' LIMIT ${AI_RUN_DELETE_BATCH})`;

let lastPrune = 0;
/** Best-effort: never throws, gives up after `timeoutMs`. Returns how many records were written (0 when there is no database). */
export async function writeRunRecords(recs: AiRunRecord[], timeoutMs = 4_000): Promise<number> {
  if (!recs.length) return 0;
  const work = (async () => {
    const db = await import('./db');
    const pool = db.getPool();
    if (!pool) return 0;
    const { ensureSchema } = await import('./db-migrate');
    if (!(await ensureSchema())) return 0;
    let n = 0;
    for (let i = 0; i < recs.length; i += 200) {
      const q = insertSql(recs.slice(i, i + 200));
      const r = await pool.query(q.text, q.values);
      n += r.rowCount || 0;
    }
    // retention, at most once every 10 minutes per server
    if (Date.now() - lastPrune > 600_000) { lastPrune = Date.now(); await pool.query(RETENTION_SQL).catch(() => undefined); }
    return n;
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work.catch(() => 0), new Promise<number>((r) => { timer = setTimeout(() => r(0), timeoutMs); (timer as any)?.unref?.(); })]);
  } catch { return 0; } finally { if (timer) clearTimeout(timer); }
}

/** Fire-and-forget for the meter: one record, never awaited by the caller's answer path. */
export function trackRun(rec: AiRunRecord): void {
  void writeRunRecords([rec]).catch(() => 0);
}

// ── reading (the /ai-runs page) ─────────────────────────────────────────────

export interface RunsQuery { days?: number; outcome?: string | null; job?: string | null; limit?: number }
export interface RunsView {
  available: boolean;
  reason?: string;
  perDay: Array<{ day: string; runs: number; costUsd: number; failed: number }>;
  byOutcome: Array<{ outcome: string; runs: number }>;
  failureReasons: Array<{ outcome: string; error: string; runs: number; lastAt: string }>;
  modelMix: Array<{ model: string; runs: number; costUsd: number }>;
  byJob: Array<{ job: string; runs: number; costUsd: number }>;
  slowest: AiRunRow[];
  rows: AiRunRow[];
  today: { runs: number; costUsd: number; escalatedUsd: number };
}
export interface AiRunRow {
  runId: string; job: string; model: string | null; promptVersion: string | null; docId: string | null; ticker: string | null;
  startedAt: string; durationMs: number; inputTokens: number; outputTokens: number; costUsd: number; outcome: string;
  error: string | null; rowsKept: number | null; rowsRejected: number | null; escalationReason: string | null;
}

/** Pure: clamp the query (days 1..90, limit 1..500, outcome / job only from a safe alphabet). */
export function normaliseRunsQuery(q: RunsQuery): Required<RunsQuery> {
  const days = Math.max(1, Math.min(AI_RUN_RETENTION_DAYS, Math.round(Number(q.days) || 14)));
  const limit = Math.max(1, Math.min(500, Math.round(Number(q.limit) || 200)));
  const outcome = q.outcome && (AI_RUN_OUTCOMES as readonly string[]).includes(q.outcome) ? q.outcome : null;
  const job = q.job && /^[a-z0-9-]{1,48}$/i.test(q.job) ? q.job : null;
  return { days, limit, outcome, job };
}

const toRow = (r: any): AiRunRow => ({
  runId: r.run_id, job: r.job, model: r.model, promptVersion: r.prompt_version, docId: r.doc_id, ticker: r.ticker,
  startedAt: new Date(r.started_at).toISOString(), durationMs: Number(r.duration_ms) || 0, inputTokens: Number(r.input_tokens) || 0,
  outputTokens: Number(r.output_tokens) || 0, costUsd: Number(r.cost_usd) || 0, outcome: r.outcome, error: r.error,
  rowsKept: r.rows_kept == null ? null : Number(r.rows_kept), rowsRejected: r.rows_rejected == null ? null : Number(r.rows_rejected), escalationReason: r.escalation_reason,
});

export async function readRunsView(q: RunsQuery): Promise<RunsView> {
  const empty: RunsView = { available: false, perDay: [], byOutcome: [], failureReasons: [], modelMix: [], byJob: [], slowest: [], rows: [], today: { runs: 0, costUsd: 0, escalatedUsd: 0 } };
  const db = await import('./db');
  const pool = db.getPool();
  if (!pool) return { ...empty, reason: 'Postgres is not configured (DATABASE_URL), so AI runs are not recorded.' };
  const { ensureSchema } = await import('./db-migrate');
  if (!(await ensureSchema())) return { ...empty, reason: 'The database migrations did not run — see the server log.' };
  const n = normaliseRunsQuery(q);
  const since = `started_at >= now() - ($1::int * interval '1 day')`;
  // filters for the table; the summaries cover every run in the window
  const where: string[] = [since]; const vals: unknown[] = [n.days];
  if (n.outcome) { vals.push(n.outcome); where.push(`outcome = $${vals.length}`); }
  if (n.job) { vals.push(n.job); where.push(`job = $${vals.length}`); }
  const [perDay, byOutcome, reasons, mix, jobs, slow, rows, today] = await Promise.all([
    pool.query(`SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS runs, coalesce(sum(cost_usd),0)::float AS cost, count(*) FILTER (WHERE outcome <> 'ok')::int AS failed FROM ai_run WHERE ${since} GROUP BY 1 ORDER BY 1 DESC`, [n.days]),
    pool.query(`SELECT outcome, count(*)::int AS runs FROM ai_run WHERE ${since} GROUP BY 1 ORDER BY 2 DESC`, [n.days]),
    pool.query(`SELECT outcome, coalesce(left(error, 120), escalation_reason, '(no message)') AS error, count(*)::int AS runs, max(started_at) AS last_at FROM ai_run WHERE ${since} AND outcome <> 'ok' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`, [n.days]),
    pool.query(`SELECT coalesce(model, '(none)') AS model, count(*)::int AS runs, coalesce(sum(cost_usd),0)::float AS cost FROM ai_run WHERE ${since} GROUP BY 1 ORDER BY 2 DESC`, [n.days]),
    pool.query(`SELECT job, count(*)::int AS runs, coalesce(sum(cost_usd),0)::float AS cost FROM ai_run WHERE ${since} GROUP BY 1 ORDER BY 2 DESC`, [n.days]),
    pool.query(`SELECT * FROM ai_run WHERE ${since} ORDER BY duration_ms DESC LIMIT 10`, [n.days]),
    pool.query(`SELECT * FROM ai_run WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ${n.limit}`, vals),
    pool.query(`SELECT count(*)::int AS runs, coalesce(sum(cost_usd),0)::float AS cost, coalesce(sum(cost_usd) FILTER (WHERE escalation_reason IS NOT NULL AND outcome <> 'escalated'),0)::float AS esc FROM ai_run WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`),
  ]);
  return {
    available: true,
    perDay: perDay.rows.map((r: any) => ({ day: r.day, runs: r.runs, costUsd: Number(r.cost) || 0, failed: r.failed })),
    byOutcome: byOutcome.rows.map((r: any) => ({ outcome: r.outcome, runs: r.runs })),
    failureReasons: reasons.rows.map((r: any) => ({ outcome: r.outcome, error: r.error, runs: r.runs, lastAt: new Date(r.last_at).toISOString() })),
    modelMix: mix.rows.map((r: any) => ({ model: r.model, runs: r.runs, costUsd: Number(r.cost) || 0 })),
    byJob: jobs.rows.map((r: any) => ({ job: r.job, runs: r.runs, costUsd: Number(r.cost) || 0 })),
    slowest: slow.rows.map(toRow),
    rows: rows.rows.map(toRow),
    today: { runs: Number(today.rows[0]?.runs) || 0, costUsd: Number(today.rows[0]?.cost) || 0, escalatedUsd: Number(today.rows[0]?.esc) || 0 },
  };
}
