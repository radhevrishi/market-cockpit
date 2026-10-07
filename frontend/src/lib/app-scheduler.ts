// zzz907 — APP SCHEDULER: the app runs its own scheduled jobs.
//
// Why: GitHub Actions' scheduler silently skips or delays runs (a 5 Oct outage cancelled ~10 jobs; 626 runs in a week
// where far more were scheduled), and the repo is private, so every run costs paid Actions minutes. Most scheduled
// workflows only made an HTTP call back to this app. The app runs all day on Railway, so it now calls those routes
// itself, at their slot. The workflows keep `workflow_dispatch`, so any job can still be run by hand from GitHub.
//
// Rules (see docs/SCHEDULING.md):
//   • every job has its exact UTC cron schedule(s) copied from the workflow it replaced (weekday rules in the cron)
//   • a job runs once per slot: a Redis lock per (job, slot) — taken with SET NX, so a second copy of the server during a
//     deploy cannot double-run it. Redis down → the job is skipped (fail closed), never run twice.
//   • lock TTL = the job's timeout + 2 min, shorter than the slot's window: if the server dies mid-run, the lock expires
//     and the next tick re-runs the job inside the window. On finish the lock is rewritten as "done" for the rest of the
//     window, and the heartbeat (`cron-heartbeat:row:<name>`, same name the workflow posted) is checked first — so a
//     restart never re-runs a slot that already succeeded, and a hand run from GitHub after the slot counts too.
//   • one HTTP retry after 45 s on a 5xx / network error (not for paid-AI calls: a failed answer may already have spent;
//     the next slot continues)
//   • at most 2 jobs at once; each job one at a time; nothing blocks a request (timers + fetch to 127.0.0.1)
//
// Pure decision logic (cron parsing, slots, windows, due, staleness, loop rounds) is exported and unit-tested
// (src/lib/__tests__/zzz907-app-scheduler.test.ts). `startAppScheduler` is the timer, started from instrumentation.ts.

// ── cron (5 fields, UTC) ─────────────────────────────────────────────────────

interface CronSpec { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean }

function parseField(field: string, lo: number, hi: number, isDow = false): Set<number> | null {
  const out = new Set<number>();
  for (const part0 of field.split(',')) {
    const part = part0.trim();
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    let a = lo, b = hi;
    if (m[1] !== '*') {
      const [x, y] = m[1].split('-').map(Number);
      a = x; b = y ?? (m[2] ? hi : x);
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (!(step >= 1) || a < lo || b > hi || a > b) {
      if (!(isDow && (a === 7 || b === 7) && a <= b && b <= 7)) return null;
    }
    for (let v = a; v <= b; v += step) out.add(isDow && v === 7 ? 0 : v);
  }
  return out.size ? out : null;
}

const cronCache = new Map<string, CronSpec | null>();
/** Parses a standard 5-field cron (minute hour day-of-month month day-of-week), UTC. null when not understood. */
export function parseCron(expr: string): CronSpec | null {
  if (cronCache.has(expr)) return cronCache.get(expr)!;
  const f = String(expr || '').trim().split(/\s+/);
  let spec: CronSpec | null = null;
  if (f.length === 5) {
    const min = parseField(f[0], 0, 59), hour = parseField(f[1], 0, 23), dom = parseField(f[2], 1, 31), mon = parseField(f[3], 1, 12), dow = parseField(f[4], 0, 6, true);
    if (min && hour && dom && mon && dow) spec = { min, hour, dom, mon, dow, domStar: f[2] === '*', dowStar: f[4] === '*' };
  }
  cronCache.set(expr, spec);
  return spec;
}

/** Day rule of cron: when BOTH day-of-month and day-of-week are restricted, either may match (standard cron). */
function dayMatches(c: CronSpec, y: number, m0: number, d: number): boolean {
  if (!c.mon.has(m0 + 1)) return false;
  const wd = new Date(Date.UTC(y, m0, d)).getUTCDay();
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return c.dow.has(wd);
  if (c.dowStar) return c.dom.has(d);
  return c.dom.has(d) || c.dow.has(wd);
}

/** search horizon for a slot (> 4 years, so a 29 Feb cron still resolves) */
const SEARCH_DAYS = 1500;
const sortedDesc =(s: Set<number>) => [...s].sort((a, b) => b - a);
const sortedAsc = (s: Set<number>) => [...s].sort((a, b) => a - b);

/** Latest fire time ≤ `now` (minute precision) of one cron, searching back up to SEARCH_DAYS. */
export function prevCronSlot(expr: string, now: Date): Date | null {
  const c = parseCron(expr); if (!c) return null;
  const hoursD = sortedDesc(c.hour), minsD = sortedDesc(c.min);
  const y0 = now.getUTCFullYear(), m0 = now.getUTCMonth(), d0 = now.getUTCDate();
  for (let k = 0; k <= SEARCH_DAYS; k++) {
    const day = new Date(Date.UTC(y0, m0, d0 - k));
    const y = day.getUTCFullYear(), mo = day.getUTCMonth(), d = day.getUTCDate();
    if (!dayMatches(c, y, mo, d)) continue;
    for (const h of hoursD) {
      if (k === 0 && h > now.getUTCHours()) continue;
      for (const mi of minsD) {
        if (k === 0 && h === now.getUTCHours() && mi > now.getUTCMinutes()) continue;
        return new Date(Date.UTC(y, mo, d, h, mi));
      }
    }
  }
  return null;
}

/** Earliest fire time strictly after `after` (minute precision) of one cron, searching ahead up to SEARCH_DAYS. */
export function nextCronSlot(expr: string, after: Date): Date | null {
  const c = parseCron(expr); if (!c) return null;
  const hoursA = sortedAsc(c.hour), minsA = sortedAsc(c.min);
  const t = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);   // first whole minute after
  const y0 = t.getUTCFullYear(), m0 = t.getUTCMonth(), d0 = t.getUTCDate();
  for (let k = 0; k <= SEARCH_DAYS; k++) {
    const day = new Date(Date.UTC(y0, m0, d0 + k));
    const y = day.getUTCFullYear(), mo = day.getUTCMonth(), d = day.getUTCDate();
    if (!dayMatches(c, y, mo, d)) continue;
    for (const h of hoursA) {
      if (k === 0 && h < t.getUTCHours()) continue;
      for (const mi of minsA) {
        if (k === 0 && h === t.getUTCHours() && mi < t.getUTCMinutes()) continue;
        return new Date(Date.UTC(y, mo, d, h, mi));
      }
    }
  }
  return null;
}

/** Latest slot ≤ now over several crons. */
export function prevSlot(crons: readonly string[], now: Date): Date | null {
  let best: Date | null = null;
  for (const c of crons) { const s = prevCronSlot(c, now); if (s && (!best || s > best)) best = s; }
  return best;
}
/** Earliest slot > after over several crons. */
export function nextSlot(crons: readonly string[], after: Date): Date | null {
  let best: Date | null = null;
  for (const c of crons) { const s = nextCronSlot(c, after); if (s && (!best || s < best)) best = s; }
  return best;
}

// ── jobs ────────────────────────────────────────────────────────────────────

export interface CallResult { status: number; ok: boolean; json: any; text: string; error: string | null; ms: number }
export interface CallOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  /** one retry after 45 s on a 5xx / network error (default true). false for paid-AI calls. */
  retry?: boolean;
  /** statuses that are an ANSWER, never retried (e.g. data-watch's 503 "a check is failing") */
  noRetryStatuses?: number[];
  headers?: Record<string, string>;
}
export interface JobCtx {
  slot: Date;
  /** ms epoch after which the job must not start new requests */
  deadline: number;
  call: (path: string, opts?: CallOpts) => Promise<CallResult>;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
}
export interface JobOutcome { ok: boolean; status: number; error?: string | null }

export interface AppJob {
  /** heartbeat name (the same name the GitHub workflow posted) */
  name: string;
  /** UTC 5-field crons, copied from the workflow */
  crons: readonly string[];
  /** whole-job time budget (also sets the lock TTL) */
  timeoutMs: number;
  /** the workflow it replaced (manual fallback lives there) */
  workflow: string;
  /** human summary for /api/v1/cron/schedule (method + path); no secrets */
  does: string;
  run: (ctx: JobCtx) => Promise<JobOutcome>;
}

/** how long after its slot a job may still start; never past the next slot */
export const MAX_WINDOW_MIN = 180;
export const RETRY_DELAY_MS = 45_000;
export const MAX_CONCURRENT = 2;
export const LOCK_PREFIX = 'appsched:v1';

const ym = (d: Date, addMonths = 0) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + addMonths, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };
const MIN = 60_000;
const ok2xx = (s: number) => s >= 200 && s < 300;
const fail = (r: CallResult, what: string): JobOutcome => ({ ok: false, status: r.status, error: r.error || `${what} HTTP ${r.status}${r.text ? `: ${r.text.slice(0, 300)}` : ''}` });

/** One HTTP call; ok when 2xx. */
function http(method: 'GET' | 'POST', path: string | ((slot: Date) => string), timeoutMs: number, extra: Partial<CallOpts> = {}): (ctx: JobCtx) => Promise<JobOutcome> {
  return async (ctx) => {
    const p = typeof path === 'function' ? path(ctx.slot) : path;
    const r = await ctx.call(p, { method, timeoutMs, ...extra });
    return r.ok ? { ok: true, status: r.status } : fail(r, p.split('?')[0]);
  };
}

// ── loop jobs: pure round decisions (mirrors of the workflows' python) ─────────

/** ai-verify.yml: up to 4 rounds; again while the server stopped on time, claims + budget remain and the queue is not empty. */
export function aiVerifyNext(left: { n: number; usd: number }, run: any): { again: boolean; n: number; usd: number } {
  const n = Math.max(left.n - Number(run?.checked || 0), 0);
  const usd = Math.max(left.usd - Number(run?.spentUsd || 0), 0);
  const again = run?.stoppedBy === 'time' && n > 0 && usd > 0.005 && Number(run?.queueAfter || 0) > 0;
  return { again, n, usd };
}
/** ai-guidance-extract.yml: up to 40 rounds within the minutes; again while stopped on time/limit, spend + documents remain and the round did something. */
export function guidanceExtractNext(leftUsd: number, run: any): { again: boolean; usd: number; done: number } {
  const done = Number(run?.attempted || 0) + Number(run?.screened || 0) + Number(run?.missingDoc || 0) + Number(run?.alreadyDone || 0);
  const usd = Math.max(leftUsd - Number(run?.spentUsd || 0), 0);
  const left = Number(run?.queued || 0) - done - Number(run?.skippedBackoff || 0);
  const again = (run?.stoppedBy === 'time' || run?.stoppedBy === 'limit') && usd > 0.02 && left > 0 && done > 0;
  return { again, usd, done };
}
/** score-ai-ledger.yml: up to 6 marking passes; stop when a pass did not run out of time. */
export function ledgerPassComplete(resp: any): boolean { return Number(resp?.skipped_for_time || 0) === 0; }
/** ai-eval.yml: red below precision 0.90 or recall 0.80. */
export function aiEvalPasses(resp: any): boolean {
  const p = resp?.precision, r = resp?.recall;
  return typeof p === 'number' && typeof r === 'number' && p >= 0.9 && r >= 0.8;
}

async function aiVerifyJob(ctx: JobCtx): Promise<JobOutcome> {
  let left = { n: 100, usd: 1.5 };   // workflow defaults for a scheduled run (inputs limit=100, max_usd=1.50)
  for (let round = 1; round <= 4; round++) {
    if (Date.now() >= ctx.deadline) break;
    const r = await ctx.call(`/api/v1/ai-verify?limit=${left.n}&maxUsd=${left.usd.toFixed(4)}`, { method: 'POST', timeoutMs: 75_000, retry: false });
    if (r.status !== 200) return fail(r, 'ai-verify');
    const nx = aiVerifyNext(left, r.json?.run);
    ctx.log(`round ${round}: checked=${r.json?.run?.checked ?? '?'} stoppedBy=${r.json?.run?.stoppedBy ?? '?'} queueAfter=${r.json?.run?.queueAfter ?? '?'}`);
    left = { n: nx.n, usd: nx.usd };
    if (!nx.again) break;
  }
  return { ok: true, status: 200 };
}

const EXTRACT_MINUTES = 20, EXTRACT_USD = 0.25, EXTRACT_LIMIT = 40;   // zzz915: $0.40 a run (was 1.20); the route also enforces a daily ceiling
/** zzz928: the run cap for one hourly job — $2 while the one-off extra allowance is active (the route still enforces the day
 *  budget + allowance left, so this is only an upper bound), otherwise the normal $0.25. */
export function extractRunUsd(status: any): number {
  const a = status?.allowance;
  return a && a.active === true && Number(a.leftUsd) > 0 ? 2 : EXTRACT_USD;
}
async function guidanceExtractJob(ctx: JobCtx): Promise<JobOutcome> {
  const end = Math.min(ctx.deadline, Date.now() + EXTRACT_MINUTES * MIN);
  const st = await ctx.call('/api/v1/guidance-extract', { timeoutMs: 30_000, retry: false });
  let usd = extractRunUsd(st.json), total = 0;
  if (usd > EXTRACT_USD) ctx.log(`extra allowance active: left $${Number(st.json?.allowance?.leftUsd).toFixed(2)} until ${st.json?.allowance?.until}`);
  for (let round = 1; round <= 60; round++) {
    if (Date.now() >= end) break;
    const r = await ctx.call(`/api/v1/guidance-extract?limit=${EXTRACT_LIMIT}&maxUsd=${usd.toFixed(4)}`, { method: 'POST', timeoutMs: 75_000, retry: false });
    if (r.status !== 200) return fail(r, 'guidance-extract');
    // zzz928: another reader (a hand-run workflow) holds the run lock — wait and try again instead of ending the job
    if (r.json?.run?.stoppedBy === 'locked') { await ctx.sleep(20_000); continue; }
    const nx = guidanceExtractNext(usd, r.json?.run);
    usd = nx.usd; total += nx.done;
    if (!nx.again) break;
  }
  ctx.log(`documents handled: ${total} (usd left of the run cap: ${usd.toFixed(2)})`);
  return { ok: true, status: 200 };
}

async function scoreLedgerJob(ctx: JobCtx): Promise<JobOutcome> {
  for (const region of ['us', 'india']) {   // warm both decks so the ledger records without a reader (failure never blocks marking)
    if (Date.now() >= ctx.deadline) break;
    const r = await ctx.call(`/api/v1/ai/desk?region=${region}`, { timeoutMs: 280_000, retry: false });
    ctx.log(`desk ${region}: HTTP ${r.status || 'error'}`);
  }
  let any200 = false, last: CallResult | null = null, marked = 0;
  for (let pass = 1; pass <= 6; pass++) {
    if (Date.now() >= ctx.deadline) break;
    const r = await ctx.call('/api/v1/ai/ledger?score=1', { timeoutMs: 280_000, retry: false });
    last = r;
    if (r.status !== 200) { await ctx.sleep(20_000); continue; }
    any200 = true; marked += Number(r.json?.marked || 0);
    if (ledgerPassComplete(r.json)) break;
    await ctx.sleep(10_000);
  }
  ctx.log(`newly marked: ${marked}`);
  return any200 ? { ok: true, status: 200 } : fail(last || { status: 0, ok: false, json: null, text: '', error: 'no pass ran', ms: 0 }, 'ai/ledger');
}

async function newsFeedJob(ctx: JobCtx): Promise<JobOutcome> {
  await ctx.call('/api/v1/news/refresh', { method: 'POST', timeoutMs: 60_000, retry: false });   // invalidate (best effort)
  const r = await ctx.call('/api/v1/news?market=all', { timeoutMs: 90_000 });                   // scrape + repopulate (must succeed)
  await ctx.call('/api/v1/news/in-play', { timeoutMs: 60_000, retry: false });                    // warm in-play (best effort)
  return r.status === 200 ? { ok: true, status: 200 } : fail(r, '/api/v1/news');
}

async function moversJob(ctx: JobCtx): Promise<JobOutcome> {
  // 2xx OR 4xx ends a market (4xx = the route answered); 5xx / network → the one retry
  let bad: CallResult | null = null;
  for (const market of ['india', 'us']) {
    const r = await ctx.call(`/api/market/quotes?market=${market}&refresh=1`, { timeoutMs: 90_000 });
    if (!(r.status >= 200 && r.status < 500)) bad = r;
  }
  return bad ? fail(bad, 'market/quotes') : { ok: true, status: 200 };
}

async function guidanceUpgradesJob(ctx: JobCtx): Promise<JobOutcome> {
  let bad: CallResult | null = null;
  for (const w of ['30D', '120D']) {
    const r = await ctx.call(`/api/v1/guidance-upgrades?window=${w}&market=ALL&force=1`, { timeoutMs: 100_000 });
    if (!r.ok) bad = r;
  }
  const u = await ctx.call('/api/v1/guidance-universe?market=ALL&force=1', { timeoutMs: 100_000 });
  if (!u.ok) bad = u;
  // archive events + AI extractions into Postgres (continue-on-error in the workflow: never decides the outcome)
  const a = await ctx.call('/api/v1/intel-archive', { method: 'POST', timeoutMs: 130_000 });
  ctx.log(`intel-archive HTTP ${a.status || 'error'}`);
  return bad ? fail(bad, 'guidance-upgrades') : { ok: true, status: 200 };
}

async function bookWatchJob(ctx: JobCtx): Promise<JobOutcome> {
  await ctx.call('/api/v1/cron/refresh-bench', { timeoutMs: 60_000, retry: false });   // pre-warm the server bench first
  return http('GET', '/api/v1/cron/book-watch', 90_000)(ctx);
}

async function dataWatchJob(ctx: JobCtx): Promise<JobOutcome> {
  // 503 = the watch ran and a CHECK is failing (already on Telegram + the route's own heartbeat) — an answer, not an outage
  const r = await ctx.call('/api/v1/cron/data-watch?x=1', { timeoutMs: 780_000, noRetryStatuses: [503] });
  if (r.status === 200 || r.status === 503) return { ok: true, status: r.status, error: r.status === 503 ? 'ran; failing checks reported' : null };
  return fail(r, 'data-watch');
}

async function aiEvalJob(ctx: JobCtx): Promise<JobOutcome> {
  const r = await ctx.call('/api/v1/ai-eval?run=1', { timeoutMs: 300_000, retry: false });
  if (!r.ok) return fail(r, 'ai-eval');
  if (!aiEvalPasses(r.json)) return { ok: false, status: r.status, error: `guidance extractor below the bar: precision ${r.json?.precision} recall ${r.json?.recall} (need ≥0.90 / ≥0.80)` };
  return { ok: true, status: r.status };
}

async function resultsPdfJob(ctx: JobCtx): Promise<JobOutcome> {
  const r = await ctx.call('/api/v1/results-pdf?max_items=12&max_usd=0.30', { method: 'POST', timeoutMs: 330_000, retry: false });
  return r.status === 200 ? { ok: true, status: 200 } : fail(r, 'results-pdf');
}

// daily-research.yml (gainers-us, portfolio) — the same steps as .github/scripts/daily-research.mjs. gainers-in stays on
// GitHub: it pre-fetches screener.in pages from GitHub's network (screener.in does not answer the app's host).
async function gainersJob(ctx: JobCtx, market: 'US'): Promise<JobOutcome> {
  const scan = await ctx.call(`/api/v1/ai-gainers?market=${market}&limit=15&fresh=1`, { timeoutMs: 120_000 });
  if (!scan.ok || !scan.json) return fail(scan, 'ai-gainers');
  const scanned: any[] = Array.isArray(scan.json.scanned) ? scan.json.scanned : [];
  if (!scanned.length) { ctx.log('no gainers list was read — nothing researched'); return { ok: true, status: 200 }; }
  const rows = scanned.map((g) => ({ ticker: g.ticker, company: g.company, move_pct: g.move_pct, volume: g.volume ?? null, price: g.price ?? null, market_cap: g.market_cap ?? null, perf: g.perf ?? null, filed_result: !!g.matched }));
  let last: any = null;
  for (let i = 0; i < 30; i++) {
    if (Date.now() >= ctx.deadline) break;
    const j = await ctx.call('/api/v1/ai-gainers/research', { method: 'POST', timeoutMs: 110_000, retry: false, body: { market, rows: i === 0 ? rows : [], budget_ms: 40_000, ...(i === 0 ? { reprocess: true } : {}) } });
    if (!j.ok || !j.json) { await ctx.sleep(10_000); continue; }
    last = j.json;
    if (!last.remaining || last.researched_now === 0) break;
  }
  for (let k = 0; k < 3 && last && Object.values(last.findings || {}).some((f: any) => f?.status === 'source_failed'); k++) {
    if (Date.now() >= ctx.deadline) break;
    await ctx.sleep(20_000 * (k + 1));
    const j = await ctx.call('/api/v1/ai-gainers/research', { method: 'POST', timeoutMs: 110_000, retry: false, body: { market, rows: [], budget_ms: 40_000, retry_failed: true } });
    if (!j.ok || !j.json) break;
    last = j.json;
  }
  ctx.log(`board ${rows.length} names · model reads today ${last?.model_reads ?? '?'}`);
  return { ok: true, status: 200 };
}

async function portfolioJob(ctx: JobCtx, days = 4): Promise<JobOutcome> {
  const st = await ctx.call('/api/v1/book/state', { timeoutMs: 30_000 });
  if (!st.ok || !st.json) return fail(st, 'book/state');
  const all: string[] = (st.json?.book?.tickers || []).filter((t: any) => t.held || t.benched).map((t: any) => String(t.ticker).toUpperCase());
  const india = all.filter((t) => /^[A-Z0-9&.\-]{1,24}$/.test(t) && !t.includes('.US'));
  if (!india.length) { ctx.log('book is empty or unreadable'); return { ok: true, status: 200 }; }
  const rr = await ctx.call(`/api/v1/thesis/recent-reporters?days=${days}&tickers=${encodeURIComponent(india.join(','))}`, { timeoutMs: 90_000 });
  if (!rr.ok || !rr.json) return fail(rr, 'thesis/recent-reporters');
  const reported: any[] = Array.isArray(rr.json.reported) ? rr.json.reported : [];
  let read = 0, failed = 0;
  for (const r of reported) {
    if (Date.now() >= ctx.deadline) break;
    const t = String(r.ticker || '').toUpperCase();
    const fd = String(r.reported_at || r.filing_date || '').slice(0, 10);
    const q = `/api/v1/india/ai-summary?ticker=${encodeURIComponent(t)}${/^\d{4}-\d{2}-\d{2}$/.test(fd) ? `&filing_date=${fd}` : ''}&mode=incremental&ocr=1`;
    const j = await ctx.call(q, { timeoutMs: 170_000, retry: false });
    if (!j.ok || !j.json) failed++;
    else if (j.json.skipped) { /* nothing new */ }
    else if (j.json.ok) read++;
    else failed++;
    await ctx.sleep(2_000);
  }
  ctx.log(`${india.length} holdings · ${reported.length} reported · ${read} read · ${failed} failed`);
  return { ok: true, status: 200 };
}

// ── the job list (schedules copied from the workflows; keep docs/SCHEDULING.md in step) ─────────────────────────

const BRIDGE = 'vercel-cron-bridge.yml';
const BOOK = 'book-watch.yml';
export const APP_JOBS: readonly AppJob[] = [
  // vercel-cron-bridge.yml — POST for /api/v1/* and /api/market/*, GET for /api/bot/* (their POST is the Telegram webhook)
  { name: 'refresh-earnings-calendar', crons: ['7 1 * * *'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/refresh-earnings-calendar', run: http('POST', '/api/v1/cron/refresh-earnings-calendar', 240_000) },
  { name: 'intelligence-compute', crons: ['7 4 * * 1-5'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'POST /api/market/intelligence/compute', run: http('POST', '/api/market/intelligence/compute', 240_000) },
  { name: 'earnings-guidance-ingest', crons: ['15 4 * * 1-5'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'POST /api/market/earnings-guidance/ingest', run: http('POST', '/api/market/earnings-guidance/ingest', 240_000) },
  { name: 'movers-alert', crons: ['35 4 * * 1-5'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'GET /api/bot/movers-alert?mode=full', run: http('GET', '/api/bot/movers-alert?mode=full', 240_000) },
  { name: 'watchlist-alert', crons: ['50 4 * * 1-5'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'GET /api/bot/watchlist-alert?mode=full', run: http('GET', '/api/bot/watchlist-alert?mode=full', 240_000) },
  { name: 'eo-blockbuster-morning', crons: ['30 5 * * *'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'GET /api/bot/eo-blockbuster-alert', run: http('GET', '/api/bot/eo-blockbuster-alert', 240_000) },
  { name: 'eo-blockbuster-evening', crons: ['30 15 * * *'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'GET /api/bot/eo-blockbuster-alert', run: http('GET', '/api/bot/eo-blockbuster-alert', 240_000) },
  { name: 'prewarm-earnings', crons: ['7 3 * * *', '7 6 * * *', '7 11 * * *', '7 14 * * *'], timeoutMs: 10 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/prewarm-earnings', run: http('POST', '/api/v1/cron/prewarm-earnings', 240_000) },
  { name: 'prewarm-us-earnings', crons: ['20 1 * * 2-6', '40 1 * * 2-6', '20 5 * * *'], timeoutMs: 10 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/prewarm-us-earnings?sessions=30', run: http('POST', '/api/v1/cron/prewarm-us-earnings?sessions=30', 240_000) },
  { name: 'refresh-us-bench', crons: ['45 5 * * *'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/refresh-us-bench', run: http('POST', '/api/v1/cron/refresh-us-bench', 240_000) },
  { name: 'refresh-guidance', crons: ['10 13 * * 1-5'], timeoutMs: 6 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/refresh-guidance', run: http('POST', '/api/v1/cron/refresh-guidance', 240_000) },
  { name: 'archive-to-postgres', crons: ['30 19 * * *'], timeoutMs: 10 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/archive-to-postgres?months=2&ahead=1', run: http('POST', '/api/v1/cron/archive-to-postgres?months=2&ahead=1', 240_000) },
  // zzz897: the month comes from the SLOT's date, never the clock (a run after midnight UTC on the 1st still ingests the month that just ended)
  { name: 'hub-ingest', crons: ['7 18 * * *'], timeoutMs: 10 * MIN, workflow: BRIDGE, does: 'POST /api/market/earnings?ingest=1&force=1&month=<slot month>', run: http('POST', (s) => `/api/market/earnings?ingest=1&force=1&month=${ym(s)}`, 240_000) },
  { name: 'hub-ingest-next', crons: ['15 18 * * *'], timeoutMs: 10 * MIN, workflow: BRIDGE, does: 'POST /api/market/earnings?ingest=1&force=1&month=<slot month + 1>', run: http('POST', (s) => `/api/market/earnings?ingest=1&force=1&month=${ym(s, 1)}`, 240_000) },
  // zzz938 — our own stock screener (USA): Nasdaq list + SEC figures + Yahoo prices, after the US close on weekdays
  { name: 'build-screener-us', crons: ['45 22 * * 1-5'], timeoutMs: 15 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/build-screener?market=US', run: http('POST', '/api/v1/cron/build-screener?market=US', 840_000) },
  // zzz939 — India screener: NSE price files + screener.in company pages (a slice each hour until every company is read, then ~weekly)
  { name: 'build-screener-in', crons: ['25 * * * *'], timeoutMs: 15 * MIN, workflow: BRIDGE, does: 'POST /api/v1/cron/build-screener?market=IN', run: http('POST', '/api/v1/cron/build-screener?market=IN', 840_000) },
  // book-watch.yml — all GET
  { name: 'refresh-bench', crons: ['4 3 * * *'], timeoutMs: 4 * MIN, workflow: BOOK, does: 'GET /api/v1/cron/refresh-bench', run: http('GET', '/api/v1/cron/refresh-bench', 90_000) },
  { name: 'book-watch', crons: ['30 5 * * 1-5', '4 12 * * 1-5', '4 15 * * 1-6'], timeoutMs: 5 * MIN, workflow: BOOK, does: 'GET /api/v1/cron/refresh-bench, then GET /api/v1/cron/book-watch', run: bookWatchJob },
  { name: 'eo-bb-evening', crons: ['30 13 * * *'], timeoutMs: 4 * MIN, workflow: BOOK, does: 'GET /api/bot/eo-blockbuster-alert', run: http('GET', '/api/bot/eo-blockbuster-alert', 90_000) },
  { name: 'user-alerts', crons: ['45 4-9 * * 1-5', '45 15 * * 1-5', '45 19 * * 1-5'], timeoutMs: 4 * MIN, workflow: BOOK, does: 'GET /api/v1/cron/user-alerts', run: http('GET', '/api/v1/cron/user-alerts', 90_000) },
  // single-purpose workflows
  { name: 'refresh-movers', crons: ['30 3 * * 1-5', '30 5 * * 1-5', '30 7 * * 1-5', '2 9 * * 1-5', '15 10 * * 1-5', '45 10 * * 1-5', '30 11 * * 1-5', '30 12 * * 1-5', '30 13 * * 1-5', '30 15 * * 1-5'], timeoutMs: 6 * MIN, workflow: 'refresh-movers.yml', does: 'GET /api/market/quotes?market=india|us&refresh=1', run: moversJob },
  { name: 'refresh-news-feed', crons: ['9 * * * *'], timeoutMs: 6 * MIN, workflow: 'refresh-news-feed.yml', does: 'POST /api/v1/news/refresh, GET /api/v1/news?market=all, GET /api/v1/news/in-play', run: newsFeedJob },
  { name: 'refresh-special-situations', crons: ['*/15 3-12 * * 1-5', '11 13-23 * * *', '11 0-2 * * *'], timeoutMs: 4 * MIN, workflow: 'refresh-special-situations.yml', does: 'GET /api/v1/special-situations/feed?refresh=1', run: http('GET', '/api/v1/special-situations/feed?refresh=1', 90_000) },
  { name: 'refresh-guidance-upgrades', crons: ['10 * * * *'], timeoutMs: 12 * MIN, workflow: 'refresh-guidance-upgrades.yml', does: 'GET /api/v1/guidance-upgrades (30D, 120D), GET /api/v1/guidance-universe, POST /api/v1/intel-archive', run: guidanceUpgradesJob },
  { name: 'daily-summary', crons: ['30 16 * * 1-5'], timeoutMs: 4 * MIN, workflow: 'daily-summary.yml', does: 'POST /api/v1/cron/daily-summary', run: http('POST', '/api/v1/cron/daily-summary', 60_000) },
  { name: 'data-watch', crons: ['30 5 * * *', '30 10 * * 1-5', '30 14 * * 1-5'], timeoutMs: 15 * MIN, workflow: 'data-watch.yml', does: 'GET /api/v1/cron/data-watch (heals what it can)', run: dataWatchJob },
  { name: 'ai-verify', crons: ['35 * * * *'], timeoutMs: 8 * MIN, workflow: 'ai-verify.yml', does: 'POST /api/v1/ai-verify, up to 4 rounds (100 claims, $1.50 a run)', run: aiVerifyJob },
  { name: 'ai-guidance-extract', crons: ['50 * * * *'], timeoutMs: 23 * MIN, workflow: 'ai-guidance-extract.yml', does: 'POST /api/v1/guidance-extract, rounds for up to 20 min ($0.25 a run, $0.25 a day; up to $2 a run while a zzz928 extra allowance is active)', run: guidanceExtractJob },
  { name: 'results-pdf', crons: ['20 * * * *'], timeoutMs: 7 * MIN, workflow: 'results-pdf.yml', does: 'POST /api/v1/results-pdf?max_items=12&max_usd=0.30', run: resultsPdfJob },
  { name: 'score-ai-ledger', crons: ['20 2 * * *'], timeoutMs: 25 * MIN, workflow: 'score-ai-ledger.yml', does: 'GET /api/v1/ai/desk (us, india), then GET /api/v1/ai/ledger?score=1 up to 6 passes', run: scoreLedgerJob },
  { name: 'ai-eval', crons: ['41 3 * * 1'], timeoutMs: 6 * MIN, workflow: 'ai-eval.yml', does: 'GET /api/v1/ai-eval?run=1 (fails below precision 0.90 / recall 0.80)', run: aiEvalJob },
  { name: 'daily-research-gainers-us', crons: ['30 21 * * 1-5'], timeoutMs: 45 * MIN, workflow: 'daily-research.yml', does: 'US gainers: GET /api/v1/ai-gainers, POST /api/v1/ai-gainers/research rounds', run: (ctx) => gainersJob(ctx, 'US') },
  { name: 'daily-research-portfolio', crons: ['13 14 * * *'], timeoutMs: 45 * MIN, workflow: 'daily-research.yml', does: 'GET /api/v1/book/state, /api/v1/thesis/recent-reporters, /api/v1/india/ai-summary per reporter', run: (ctx) => portfolioJob(ctx) },
  // zzz911 — India earnings alerts moved from Claude scheduled tasks into the app (rules only, no AI; lib/india-earnings-alert).
  // App-only jobs (no workflow ever ran them); the manual button lives in book-watch.yml like the other owner alerts.
  { name: 'in-earnings-alert', crons: ['27 4-16 * * 1-6'], timeoutMs: 3 * MIN, workflow: BOOK, does: 'GET /api/v1/cron/india-earnings-alert (new Blockbuster/Strong preset passers, sent once each)', run: http('GET', '/api/v1/cron/india-earnings-alert', 90_000) },
  { name: 'in-earnings-eod', crons: ['37 15 * * 1-5'], timeoutMs: 3 * MIN, workflow: BOOK, does: 'GET /api/v1/cron/india-earnings-eod (evening check-in, always one message)', run: http('GET', '/api/v1/cron/india-earnings-eod', 90_000) },
  // zzz912 — was two Claude scheduled tasks (US hours every 2 h, late after-close sweep 20:00–22:00 ET). Rules only, no AI.
  { name: 'us-earnings-watch', crons: ['7 11-23/2 * * 1-5', '7 0-2 * * 2-6'], timeoutMs: 27 * MIN, workflow: 'us-earnings-watch.yml', does: 'GET /api/v1/cron/us-earnings-watch (graded-us → US Quality Preset, under $30B → one ranked alert of new names)', run: http('GET', '/api/v1/cron/us-earnings-watch', 12 * MIN) },
  // zzz913 — Daily Gainers Brief (was a Claude scheduled task). Logic in lib/gainers-brief.ts (loaded lazily: no import edit here).
  { name: 'gainers-in-backup', crons: ['41 11 * * 1-5'], timeoutMs: 40 * MIN, workflow: 'daily-research.yml', does: 'GET /api/v1/ai-gainers/research?market=IN; only when GitHub’s gainers-in sweep is missing or stalled: GET /api/v1/ai-gainers?market=IN, POST /api/v1/ai-gainers/research rounds (no re-process)', run: async (ctx) => (await import('./gainers-brief')).gainersInBackupJob(ctx) },
  { name: 'gainers-brief-in', crons: ['57 11 * * 1-5', '37 12 * * 1-5', '31 13 * * 1-5'], timeoutMs: 4 * MIN, workflow: 'gainers-brief.yml', does: 'POST /api/v1/cron/gainers-brief?final=0 (sends when the sweep is complete); the 13:31 slot sends with final=1 (PARTIAL when incomplete)', run: async (ctx) => (await import('./gainers-brief')).gainersBriefJob(ctx) },
  // zzz914 — owner briefs moved in from Claude scheduled tasks (they needed the owner's Mac awake; the book is on the server now).
  // Morning conviction brief: 04:29 UTC Mon–Fri (≈06:30 Berlin). Thesis watch: 02:15 UTC Mon–Fri (≈07:45 IST). The route sends
  // once per day; a run that composed but could not deliver (no channel set up) reports ok=false so the heartbeat shows it.
  { name: 'conviction-catalyst-brief', crons: ['29 4 * * 1-5'], timeoutMs: 4 * MIN, workflow: 'owner-briefs.yml', does: 'POST /api/v1/cron/conviction-catalyst-brief (rules + stored research; AI only for new names, ≤ $0.05 a run)', run: async (ctx) => (await import('./owner-briefs/job')).ownerBriefJob(ctx, '/api/v1/cron/conviction-catalyst-brief', false) },
  { name: 'portfolio-thesis-watch', crons: ['15 2 * * 1-5'], timeoutMs: 4 * MIN, workflow: 'owner-briefs.yml', does: 'POST /api/v1/cron/portfolio-thesis-watch (stored research only, no AI, no price)', run: async (ctx) => (await import('./owner-briefs/job')).ownerBriefJob(ctx, '/api/v1/cron/portfolio-thesis-watch', true) },
];

/** Workflows that keep their GitHub schedule, and why (shown by /api/v1/cron/schedule and docs/SCHEDULING.md). */
export const GITHUB_SCHEDULED: ReadonlyArray<{ workflow: string; why: string }> = [
  { workflow: 'daily-research.yml (gainers-in only)', why: 'pre-fetches screener.in pages from GitHub’s network into KV; screener.in does not answer the app host' },
  { workflow: 'scrape-*.yml (13 workflows)', why: 'fetch NSE / BSE / Screener / Yahoo / Trendlyne / news sites from GitHub IPs — those sources block Railway' },
  { workflow: 'edgar-guidance-backfill.yml', why: 'repo script reading SEC EDGAR at a fair-access rate and writing KV directly' },
  { workflow: 'screener-sync.yml, tradingview-sync.yml', why: 'log in to Screener / TradingView, download CSVs and commit them to git' },
  { workflow: 'backup-user-data.yml', why: 'the backup must live OFF the app (encrypted GitHub artifact, 90 days)' },
  { workflow: 'ci.yml, deploy-workers.yml', why: 'run on push (tests / build / Cloudflare deploy), not on a clock' },
  { workflow: 'ai-guidance-backlog.yml, refresh-movers-live.yml', why: 'manual only (no schedule)' },
];

// ── pure decisions ──────────────────────────────────────────────────────────

/** How long after `slot` the job may still start: up to the next slot, at most MAX_WINDOW_MIN. */
export function slotWindowMs(job: Pick<AppJob, 'crons'>, slot: Date): number {
  const nx = nextSlot(job.crons, slot);
  const cap = MAX_WINDOW_MIN * MIN;
  return nx ? Math.min(cap, nx.getTime() - slot.getTime()) : cap;
}
/** Lock TTL (seconds): the job's time budget (incl. the one 45 s retry) + 2 min of slack for the heartbeat. */
export function lockTtlSec(job: Pick<AppJob, 'timeoutMs'>): number {
  return Math.ceil((job.timeoutMs + 2 * MIN) / 1000);
}
export const lockKeyFor = (name: string, slot: Date) => `${LOCK_PREFIX}:${name}:${slot.toISOString().slice(0, 16)}`;

export interface DueSlot { job: AppJob; slot: Date; windowEnds: Date; lockKey: string }
/**
 * Pure: the job's current slot if it still needs a run now. `lastOkIso` = the heartbeat's last success.
 * Due when: the latest slot ≤ now is still inside its window, and no success has been recorded at/after the slot.
 */
export function dueSlot(job: AppJob, now: Date, lastOkIso: string | null | undefined): DueSlot | null {
  const slot = prevSlot(job.crons, now);
  if (!slot) return null;
  const win = slotWindowMs(job, slot);
  if (now.getTime() - slot.getTime() >= win) return null;
  const ok = lastOkIso ? Date.parse(String(lastOkIso)) : NaN;
  if (Number.isFinite(ok) && ok >= slot.getTime()) return null;   // already succeeded in this slot (app run, or a hand run from GitHub)
  return { job, slot, windowEnds: new Date(slot.getTime() + win), lockKey: lockKeyFor(job.name, slot) };
}

/** Pure: the retry rule for one HTTP call (attempt 1 → may retry once). */
export function shouldRetry(status: number, attempt: number, opts: Pick<CallOpts, 'retry' | 'noRetryStatuses'> = {}): boolean {
  if (attempt >= 2 || opts.retry === false) return false;
  if (opts.noRetryStatuses?.includes(status)) return false;
  return status === 0 || status >= 500;
}

/** Pure: should the lock row read after a failed SET NX settle this slot (never run it here)? */
export function lockSettlesSlot(lockValue: unknown): boolean {
  const v: any = typeof lockValue === 'string' ? (() => { try { return JSON.parse(lockValue); } catch { return null; } })() : lockValue;
  return !!v && v.state === 'done';
}

/** Longest gap between consecutive slots over the next `days` days (hours). */
export function maxGapHours(crons: readonly string[], from: Date, days = 15): number {
  let t = prevSlot(crons, from) || from;
  const end = from.getTime() + days * 24 * 3600_000;
  let gap = 0;
  for (let i = 0; i < 5000 && t.getTime() < end; i++) {
    const n = nextSlot(crons, t);
    if (!n) break;
    gap = Math.max(gap, n.getTime() - t.getTime());
    t = n;
  }
  return gap / 3600_000;
}
/**
 * Heartbeat staleness for a scheduled job: silence longer than the longest normal gap between its slots + 6 h of slack
 * is trouble. Never stricter than the global threshold (`baseHours`), so a weekly job is not stale after 25 h while an
 * hourly job keeps the old 25 h alarm. null when the name is not an app job.
 */
const gapMemo = new Map<string, number>();
export function staleAfterHoursFor(name: string, baseHours: number, now: Date, jobs: readonly AppJob[] = APP_JOBS): number | null {
  const job = jobs.find((j) => j.name === name);
  if (!job) return null;
  const memoKey = `${job.crons.join('|')}@${now.toISOString().slice(0, 13)}`;
  let gap = gapMemo.get(memoKey);
  if (gap === undefined) { gap = maxGapHours(job.crons, now); if (gapMemo.size > 500) gapMemo.clear(); gapMemo.set(memoKey, gap); }
  return Math.max(baseHours, Math.ceil(gap + 6));
}

// ── the runner ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeCall(base: string, secret: string, deadline: number, log: (m: string) => void) {
  return async function call(path: string, opts: CallOpts = {}): Promise<CallResult> {
    let last: CallResult = { status: 0, ok: false, json: null, text: '', error: 'not started', ms: 0 };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const left = deadline - Date.now();
      if (left <= 1_000) { last = { ...last, error: last.error === 'not started' ? 'job time budget used' : last.error }; break; }
      const t0 = Date.now();
      try {
        const r = await fetch(base + path, {
          method: opts.method || 'GET',
          headers: { 'content-type': 'application/json', 'x-cron-secret': secret, 'x-mc-key': secret, 'x-app-scheduler': '1', ...(opts.headers || {}) },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(Math.min(opts.timeoutMs || 90_000, left)),
          cache: 'no-store',
        });
        const text = await r.text().catch(() => '');
        let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        last = { status: r.status, ok: ok2xx(r.status), json, text: ok2xx(r.status) ? '' : text.slice(0, 500), error: null, ms: Date.now() - t0 };
      } catch (e: any) {
        last = { status: 0, ok: false, json: null, text: '', error: String(e?.name === 'TimeoutError' ? 'timeout' : e?.message || e).slice(0, 200), ms: Date.now() - t0 };
      }
      if (!shouldRetry(last.status, attempt, opts)) break;
      if (deadline - Date.now() < RETRY_DELAY_MS + 5_000) break;
      log(`${path.split('?')[0]} → ${last.status || last.error}; retrying once in 45 s`);
      await sleep(RETRY_DELAY_MS);
    }
    return last;
  };
}

let started = false;
const running = new Set<string>();
/** slot (ISO minute) per job that this process knows is settled (done here, done elsewhere, or succeeded) */
const settled = new Map<string, string>();

async function postHeartbeat(base: string, name: string, out: JobOutcome): Promise<void> {
  await fetch(`${base}/api/v1/cron/heartbeat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, phase: 'end', ok: out.ok, exit_code: out.status || null, error: out.ok ? (out.error || null) : (out.error || `app-scheduler HTTP ${out.status}`).slice(0, 480) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

async function runOne(d: DueSlot, base: string, secret: string): Promise<void> {
  const { kvSet } = await import('./kv');
  const job = d.job, slotIso = d.slot.toISOString().slice(0, 16);
  const t0 = Date.now();
  const log = (m: string) => console.log(`[app-scheduler] ${job.name} ${slotIso}Z: ${m}`);
  let out: JobOutcome;
  try {
    out = await job.run({ slot: d.slot, deadline: t0 + job.timeoutMs, call: makeCall(base, secret, t0 + job.timeoutMs, log), sleep, log });
  } catch (e: any) {
    out = { ok: false, status: 0, error: `job threw: ${String(e?.message || e).slice(0, 200)}` };
  }
  log(`${out.ok ? 'ok' : 'FAILED'} (HTTP ${out.status || 'error'}) in ${Math.round((Date.now() - t0) / 1000)}s${out.error ? ` — ${out.error.slice(0, 160)}` : ''}`);
  await postHeartbeat(base, job.name, out);
  // hold the slot as done for the rest of its window (no second run after a failure — the next slot is the retry)
  const holdSec = Math.max(60, Math.ceil((d.windowEnds.getTime() - Date.now()) / 1000) + 60);
  await kvSet(d.lockKey, { state: 'done', ok: out.ok, status: out.status, at: new Date().toISOString() }, holdSec).catch(() => {});
  settled.set(job.name, slotIso);
}

/** One scheduler pass (timer only; never on a request path). */
async function tick(base: string, secret: string): Promise<void> {
  const { kvMGet, kvSetNX, kvGet, isRedisAvailable } = await import('./kv');
  if (!isRedisAvailable()) return;   // no lock store → never run (fail closed)
  const now = new Date();
  // candidates: jobs with a slot inside its window that this process has not settled yet (no Redis call otherwise)
  const cands = APP_JOBS.filter((j) => {
    if (running.has(j.name)) return false;
    const s = prevSlot(j.crons, now);
    if (!s || now.getTime() - s.getTime() >= slotWindowMs(j, s)) return false;
    return settled.get(j.name) !== s.toISOString().slice(0, 16);
  });
  if (!cands.length) return;
  const rows = await kvMGet<{ last_ok_at?: string | null }>(cands.map((j) => `cron-heartbeat:row:${j.name}`));
  for (let i = 0; i < cands.length; i++) {
    const job = cands[i];
    const d = dueSlot(job, now, rows[i]?.last_ok_at || null);
    if (!d) { const s = prevSlot(job.crons, now); if (s) settled.set(job.name, s.toISOString().slice(0, 16)); continue; }
    if (running.size >= MAX_CONCURRENT) return;   // the rest waits for a later tick (still inside its window)
    const got = await kvSetNX(d.lockKey, { state: 'running', at: new Date().toISOString(), pid: process.pid }, lockTtlSec(job));
    if (!got) {
      // taken: by another copy that is running it (wait), by a finished run (settle), or Redis failed (skip, retry next tick)
      const v = await kvGet(d.lockKey).catch(() => null);
      if (lockSettlesSlot(v)) settled.set(job.name, d.slot.toISOString().slice(0, 16));
      continue;
    }
    running.add(job.name);
    void runOne(d, base, secret).catch((e) => console.warn('[app-scheduler] run failed', e)).finally(() => running.delete(job.name));
  }
}

/** Starts the 1-minute scheduler. Needs CRON_SECRET (the jobs check it) and Redis (the lock). Off with APP_SCHEDULER=0. */
export function startAppScheduler(): void {
  if (started) return;
  if (process.env.APP_SCHEDULER === '0' || process.env.BACKSTOP_SCHEDULER === '0') { console.log('[app-scheduler] disabled by env'); return; }
  const secret = process.env.CRON_SECRET || '';
  if (!secret) { console.warn('[app-scheduler] not started: CRON_SECRET is not set'); return; }
  started = true;
  const port = parseInt(process.env.PORT || '', 10) || 3000;
  const base = `http://127.0.0.1:${port}`;
  let busy = false;
  const safeTick = async () => {
    if (busy) return; busy = true;
    try { await tick(base, secret); } catch (e) { console.warn('[app-scheduler] tick failed', e); } finally { busy = false; }
  };
  // first pass 90 s after start (let the server warm up), then every minute
  setTimeout(() => { void safeTick(); setInterval(() => { void safeTick(); }, MIN).unref?.(); }, 90_000).unref?.();
  console.log(`[app-scheduler] started: ${APP_JOBS.length} jobs`);
}
