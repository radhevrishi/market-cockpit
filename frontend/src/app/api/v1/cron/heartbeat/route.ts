// /api/v1/cron/heartbeat — combined heartbeat ingest + health view.
//
// 10y-ops Section 7.3: GH Actions workflows POST end-of-run state; mc-guardian
// GETs ?action=health every 10 min. KV-backed (Upstash) so it works even if
// FastAPI/Render is down — the point is to alert on infra failures.
//
// POST body: { name, phase, ok, exit_code?, error?, run_url? }
// GET ?action=health[&stale_hours=25]  → aggregate health view
// GET ?ping=1                          → sanity check
//
// KV layout:
//   cron-heartbeat:names         → string[]  (set of all known cron names)
//   cron-heartbeat:row:<name>    → HeartbeatRow

import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvMGet } from '@/lib/kv';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import { staleAfterHoursFor } from '@/lib/app-scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAMES_KEY = 'cron-heartbeat:names';
const ROW_KEY = (name: string) => `cron-heartbeat:row:${name}`;
const NAMES_TTL = 60 * 60 * 24 * 90;
const ROW_TTL = 60 * 60 * 24 * 90;

// PATCH 1101xxx — ignore one-off manual/test pings in the stale_count.
// Names like `manual-smoke-test`, `validation-test` are written once and never
// recur on a schedule. They stay in the names index forever (90d TTL), so they
// become "stale" after 25h and pollute mc-guardian's alert. The actual rows
// still show in the `rows[]` response for debugging — they just don't trigger
// the alert flag.
// zzz665 — THE REGEX ONLY EVER MATCHED THE PREFIX.
//
// `^manual-` catches nothing we actually run, because the bridge writes the
// suffix form: `intelligence-manual`, `movers-manual`, `prewarm-us-manual`,
// `earnings-guidance-manual`. Those fire only when a human presses "Run
// workflow", so the moment one is used it is permanently 25 hours from being
// called stale — and it then sits red in the health view for ever, which is
// how `stale_count: 5` came to contain three rows that were working perfectly.
//
// A monitor that cries wolf is worse than no monitor: it trains you to ignore
// it, and the one row that mattered — prewarm-us-earnings, which had NEVER
// succeeded — was sitting in that same list being ignored with the rest.
const MANUAL_OR_RETIRED = /^manual-|-manual$|^test-|-test$|^validation|smoke-test/i;

// Jobs whose SCHEDULE was deliberately removed but whose workflow still exists
// as a manual backup. refresh-movers-live lost its cron on 2026-06-10 when the
// work moved to the Cloudflare Worker (workers/mc-movers) because GitHub cron
// starvation fired only ~2 of ~75 expected runs a day. It is not broken; it is
// retired, and the health view should say neither.
const RETIRED = new Set<string>(['refresh-movers-live']);

// zzz885: two workflows send the same evening alert under different names; the job is healthy if EITHER ran.
// zzz905: jobs that run less than daily, with the hours after which silence means trouble (monthly + a few days' slack).
const SLOW_JOB_HOURS: Record<string, number> = { 'scrape-nse-holidays': 24 * 35 };

const ALIASES: Record<string, string[]> = { 'eo-bb-evening': ['eo-blockbuster-evening'], 'eo-blockbuster-evening': ['eo-bb-evening'] };

function isTestName(name: string): boolean {
  return MANUAL_OR_RETIRED.test(name) || RETIRED.has(name);
}

interface HeartbeatRow {
  name: string;
  last_started_at: string | null;
  last_ok_at: string | null;
  last_ok: boolean;
  exit_code: number | null;
  error: string | null;
  run_url: string | null;
  updated_at: string;
}

// zzz882 security: the POST is open (≈20 workflows call it without a key), so it is bounded: a plain job name, at most 120 names, GitHub run links only
const NAME_RE = /^[a-z0-9][a-z0-9:._-]{0,59}$/i;
const MAX_NAMES = 120;
async function addToNamesIndex(name: string, known?: string[]) {
  const cur = known || (await kvGet<string[]>(NAMES_KEY)) || [];
  if (!cur.includes(name) && cur.length < MAX_NAMES) {
    cur.push(name);
    await kvSet(NAMES_KEY, cur, NAMES_TTL);
  }
}

// ── POST: record a cron heartbeat ────────────────────────────────────────────
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const name = String(body?.name || '').slice(0, 80);
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  if (!NAME_RE.test(name)) return NextResponse.json({ ok: false, error: 'bad name' }, { status: 400 });
  // zzz1049: the names index and this job's row in ONE command (was three GETs per heartbeat)
  const [namesNow, existingRow] = await kvMGet<any>([NAMES_KEY, ROW_KEY(name)]);
  const knownNames: string[] = Array.isArray(namesNow) ? namesNow : [];
  if (!knownNames.includes(name) && knownNames.length >= MAX_NAMES) return NextResponse.json({ ok: false, error: 'too many job names' }, { status: 429 });

  const phase = body?.phase === 'start' ? 'start' : 'end';
  const ok = !!body?.ok;
  const exit_code = typeof body?.exit_code === 'number' ? body.exit_code : null;
  const error = body?.error ? String(body.error).slice(0, 500) : null;
  const run_url = body?.run_url && /^https:\/\/github\.com\//.test(String(body.run_url)) ? String(body.run_url).slice(0, 500) : null;
  const now = new Date().toISOString();

  const existing: HeartbeatRow = (existingRow && typeof existingRow === 'object' ? existingRow as HeartbeatRow : null) || {
    name,
    last_started_at: null,
    last_ok_at: null,
    last_ok: false,
    exit_code: null,
    error: null,
    run_url: null,
    updated_at: now,
  };

  if (phase === 'start') {
    existing.last_started_at = now;
  } else {
    if (!existing.last_started_at) existing.last_started_at = now;
    existing.last_ok = ok;
    if (ok) existing.last_ok_at = now;
    existing.exit_code = exit_code;
    existing.error = error;
  }
  if (run_url) existing.run_url = run_url;
  existing.updated_at = now;

  await kvSet(ROW_KEY(name), existing, ROW_TTL);
  await addToNamesIndex(name, knownNames);

  return NextResponse.json({ ok: true, phase, stored: existing });
}

// ── GET: sanity ping OR aggregate health view ────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('ping') === '1') {
    return NextResponse.json({ ok: true, route: 'heartbeat', method: 'GET-ping' });
  }

  // Default action is health when called as GET
  // PATCH 1101zzz5 — weekend-aware stale threshold. Many of our crons are
  // Mon-Fri only (intelligence-compute, movers-alert, watchlist-alert,
  // earnings-guidance-ingest). On Saturday + Sunday they legitimately go
  // ~60h silent between Fri 16 UTC and Mon 04 UTC. With the default 25h
  // threshold mc-guardian Telegrams every 10 min through both weekend days.
  // Bump the effective threshold to 72h on Sat/Sun and Mon < 08 UTC so the
  // alert only fires for crons that are silent beyond a normal weekend gap.
  const baseStaleHours = parseFloat(searchParams.get('stale_hours') || '25');
  const now = new Date();
  const dowUtc = now.getUTCDay();           // 0=Sun, 6=Sat
  const hourUtc = now.getUTCHours();
  const isWeekend = dowUtc === 0 || dowUtc === 6;
  const isEarlyMonday = dowUtc === 1 && hourUtc < 8;
  const staleHours = (isWeekend || isEarlyMonday) ? Math.max(baseStaleHours, 72) : baseStaleHours;
  const cutoff = Date.now() - staleHours * 3600 * 1000;

  const names = (await kvGet<string[]>(NAMES_KEY)) || [];
  if (!names.length) {
    return NextResponse.json({
      ok: true,
      stale_count: 0,
      rows: [],
      note: 'no heartbeats recorded yet — POST { name, phase:"end", ok:true } to seed',
    });
  }

  // zzz1049: every row (and alias row) in ONE MGET instead of one GET per job
  const aliasNames = [...new Set(names.flatMap((n) => ALIASES[n] || []))];
  const allRowNames = [...new Set([...names, ...aliasNames])];
  const rowVals = await kvMGet<HeartbeatRow>(allRowNames.map((n) => ROW_KEY(n))).catch(() => allRowNames.map(() => null));
  const rowByName = new Map<string, HeartbeatRow | null>(allRowNames.map((n, i) => [n, rowVals[i] ?? null]));
  const rows = await Promise.all(
    names.map(async (name) => {
      const r = rowByName.get(name) ?? null;
      if (!r) return null;
      const lastOkMs = r.last_ok_at ? Date.parse(r.last_ok_at) : 0;
      const hoursSinceOk = lastOkMs ? Math.round(((Date.now() - lastOkMs) / 3600000) * 100) / 100 : null;
      // PATCH 1101zzz18 — gate the per-row `stale` flag on isTestName() too.
      // PATCH 1101xxx already excluded test rows from the COUNT, but the
      // per-row flag still rendered red, contradicting "stale_count: 0".
      let freshest = lastOkMs;
      for (const a of ALIASES[name] || []) { const ar = rowByName.get(a) ?? null; const t = ar?.last_ok_at ? Date.parse(ar.last_ok_at) : 0; if (t > freshest) freshest = t; }
      // zzz907: jobs the app schedules itself get their threshold from their schedule (longest normal gap between slots
      // + 6 h, never stricter than the global one) — a weekly job is not stale after 25 h. Others keep SLOW_JOB_HOURS.
      const fromSchedule = staleAfterHoursFor(name, staleHours, now);
      const slowCadence = fromSchedule ?? SLOW_JOB_HOURS[name];
      const rowCutoff = slowCadence ? Math.min(cutoff, Date.now() - slowCadence * 3600 * 1000) : cutoff;
      const rawStale = !freshest || freshest < rowCutoff;
      const stale = rawStale && !isTestName(name);
      return {
        name,
        last_ok_at: r.last_ok_at,
        last_started_at: r.last_started_at,
        last_ok: r.last_ok,
        exit_code: r.exit_code,
        error: r.error,
        run_url: r.run_url,
        hours_since_ok: hoursSinceOk,
        stale,
        stale_after_hours: slowCadence ? Math.max(slowCadence, staleHours) : staleHours,
        scheduled_by: fromSchedule !== null ? 'app' : 'other',
        is_test: isTestName(name),
      };
    }),
  );
  const filtered = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  filtered.sort((a, b) => Number(b.stale) - Number(a.stale) || a.name.localeCompare(b.name));
  // PATCH 1101xxx — exclude test/manual entries from the alert count.
  const staleCount = filtered.filter((r) => r.stale && !isTestName(r.name)).length;

  // zzz905: say so when the current year has no NSE holiday list (every weekday would be treated as a trading day).
  let holidays_missing_for: number | null = null;
  let holidays_next_year_missing: boolean | undefined;
  try { const st = await warmNseHolidays(); holidays_missing_for = st.missingFor; holidays_next_year_missing = st.nextYearMissing; } catch { /* informational */ }
  return NextResponse.json({ ok: staleCount === 0, stale_count: staleCount, rows: filtered, holidays_missing_for, holidays_next_year_missing });
}

// PATCH 1101xxx — DELETE a heartbeat (cleanup endpoint). Useful for removing
// one-off test/manual entries that should never have been written. Requires
// Authorization: Bearer <HEARTBEAT_ADMIN_TOKEN> env var. No token configured
// = endpoint is disabled (fail-closed).
export async function DELETE(req: Request) {
  const adminToken = (process.env.HEARTBEAT_ADMIN_TOKEN || '').trim();
  if (!adminToken) return NextResponse.json({ ok: false, error: 'DELETE disabled — set HEARTBEAT_ADMIN_TOKEN env var to enable' }, { status: 503 });
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${adminToken}`) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get('name') || '').slice(0, 80);
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });

  // Remove from names index
  const names = (await kvGet<string[]>(NAMES_KEY)) || [];
  const next = names.filter((n) => n !== name);
  await kvSet(NAMES_KEY, next, NAMES_TTL);
  // Overwrite row with a 1-second TTL to functionally delete it.
  await kvSet(ROW_KEY(name), null, 1);

  return NextResponse.json({ ok: true, deleted: name });
}
