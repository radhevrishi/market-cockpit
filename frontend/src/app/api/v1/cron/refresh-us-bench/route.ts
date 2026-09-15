// ═══════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE US CONVICTION BENCH — cron refresh.  (zzz665)
//
// WHY THIS EXISTS.
//
// India's bench has been server-side since zzz427. Its own header says why:
// "previously the bench only updated when a human opened the Earnings tab."
// That fix was never carried across to the US side, and nobody noticed because
// the US bench APPEARS to work — it just only ever works while you are looking
// at it.
//
// The US bench lives in `localStorage` under `mc:conviction-beats-us:v1`,
// mirrored into IndexedDB `mc-us-bench`. Consequences, all of them real:
//
//   · It does not accumulate while the tab is closed. Go away for a month and
//     the bench has not moved; open it, and a sweep rebuilds what it can reach.
//   · It is per-BROWSER. The bench on the laptop and the bench on the phone are
//     different benches, and neither knows the other exists.
//   · The client sweep reaches back 21/42/63 sessions. A name that graded
//     BLOCKBUSTER four months ago is outside every window and is simply gone.
//
// This route is the US twin of refresh-bench: it walks the graded-US sessions
// already cached by prewarm-us-earnings, keeps BLOCKBUSTER and STRONG, dedupes
// per ticker with the newest filing winning, and persists the result so the
// bench keeps growing whether or not a browser is open.
//
// IT READS ONLY THE CACHE, NEVER EDGAR. Grading a session is expensive and is
// prewarm-us-earnings' job; this route's whole contribution is to remember what
// that grading found. A session that is not yet warm is skipped and counted, not
// waited for — so this is a handful of Redis reads and nothing else, and it is
// safe to run immediately after the prewarm on the same schedule.
//
// THE PAYLOAD IS GZIPPED, exactly as graded-us writes it. Reading tolerates
// both shapes so anything stored before compression keeps working.
//
// ON MERGING: this bench is ADDITIVE ONLY, and the client treats it that way.
// A name the owner has removed by hand is a decision, and a cron must not
// overrule a decision — see the merge note in lib/conviction-beats-us.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { gunzipSync } from 'zlib';
import { US_ENGINE_VERSION } from '@/lib/us-engine-version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const US_BENCH_KEY = 'bench:us:server:v1';
const BENCH_TTL_S = 60 * 60 * 24 * 30;   // 30 days — outlives any gap in the crons
/** Trading sessions to sweep. A quarter is ~63; this holds two full earnings
 *  seasons, which is deliberately more than any client window can reach. */
const SCAN_SESSIONS = 130;
/** Hard ceiling on the stored bench, newest filing first. */
const MAX_ENTRIES = 600;

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
interface UsGradedPayload { by_tier?: Partial<Record<Tier, any[]>> }

/** graded-us stores `{ z: base64(gzip(json)) }`; older rows are plain objects. */
function unzipPayload(raw: any): UsGradedPayload | null {
  if (!raw) return null;
  if (typeof raw?.z === 'string') {
    try { return JSON.parse(gunzipSync(Buffer.from(raw.z, 'base64')).toString('utf8')); }
    catch { return null; }
  }
  return raw?.by_tier ? (raw as UsGradedPayload) : null;
}

/** Today in New York — the calendar the US engine grades on, not the server's. */
function etToday(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
}

/** `count` weekday sessions ending at `endDate`, newest first. Holidays simply
 *  come back uncached and are skipped — no exchange calendar needed. */
function sessionsBack(endDate: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count && i < count * 3; i++) {
    const iso = new Date(Date.parse(endDate + 'T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10);
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(iso);
  }
  return out;
}

export async function GET(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason },
      { status: auth.reason.includes('not configured') ? 503 : 401 });
  }

  const byTicker = new Map<string, any>();
  let blockbuster = 0, strong = 0, warmDays = 0, coldDays = 0;

  // Newest session first, so first-write-wins leaves the newest filing per
  // ticker — the same rule the India bench uses.
  for (const dateStr of sessionsBack(etToday(), SCAN_SESSIONS)) {
    let payload: UsGradedPayload | null = null;
    try {
      payload = unzipPayload(await kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${dateStr}|1`));
    } catch { payload = null; }

    if (!payload?.by_tier) { coldDays++; continue; }
    warmDays++;

    const bb = Array.isArray(payload.by_tier.BLOCKBUSTER) ? payload.by_tier.BLOCKBUSTER : [];
    const st = Array.isArray(payload.by_tier.STRONG) ? payload.by_tier.STRONG : [];
    blockbuster += bb.length;
    strong += st.length;

    for (const row of [...bb, ...st]) {
      if (!row?.ticker) continue;
      if (byTicker.has(row.ticker)) continue;   // newer session already won
      // The FULL graded card is stored, so a bench row renders complete —
      // financials, margins, PEAD, drift — with no client rebuild.
      byTicker.set(row.ticker, { ...row, seen_date: dateStr });
    }
  }

  const entries = Array.from(byTicker.values())
    .sort((a, b) => String(b.filing_date || b.seen_date || '').localeCompare(String(a.filing_date || a.seen_date || '')))
    .slice(0, MAX_ENTRIES);
  const updatedAt = new Date().toISOString();

  await kvSet(US_BENCH_KEY, {
    updatedAt, count: entries.length, engine_version: US_ENGINE_VERSION, entries,
  }, BENCH_TTL_S);

  return NextResponse.json({
    ok: true,
    engine_version: US_ENGINE_VERSION,
    scanned_sessions: SCAN_SESSIONS,
    warm_days: warmDays,
    cold_days: coldDays,
    blockbuster,
    strong,
    total: entries.length,
    updatedAt,
    note: coldDays > warmDays
      ? 'More sessions were cold than warm — the bench is only as complete as prewarm-us-earnings has made it. Run that first.'
      : 'Built from the warm sessions only; nothing was fetched from EDGAR.',
  });
}

export async function POST(req: Request) { return GET(req); }
