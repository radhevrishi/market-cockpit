// ═══════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE US CONVICTION BENCH — read route.  (zzz665 → zzz797)
//
// The US sibling of /api/v1/bench. Read-only, no secret, and honest about an
// empty bench rather than pretending to one: a client that cannot tell "the
// cron has not run" from "there is nothing on the bench" will quietly show an
// empty page and look broken.
//
// `engine_version` travels with the payload so the client can ignore a bench
// built by an older engine instead of merging stale verdicts into a fresh one.
//
// zzz797 — NEVER EMPTY JUST BECAUSE A CRON DID NOT RUN. When the KV list is
// missing or empty, the bench is rebuilt here from the graded-US session
// cache — the same source and rule as /api/v1/cron/refresh-us-bench and the
// US Conviction Beats page (BLOCKBUSTER + STRONG, newest filing per ticker),
// reading the cache only, never EDGAR — and saved, so a fresh phone or
// browser sees the same list as the laptop. `?view=tickers` returns only the
// names (ticker, tier, company, filing date): what US Portfolio Catalysts
// needs, without ~800 KB of grade cards.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { kvGet, kvSet } from '@/lib/kv';
import { US_ENGINE_VERSION } from '@/lib/us-engine-version';
import { compactUsBench, rebuildUsBench, usBenchSessions } from '@/lib/us-thesis/us-bench';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const US_BENCH_KEY = 'bench:us:server:v1';
/** A rebuilt list is kept for a day; the nightly cron replaces it anyway. */
const REBUILT_TTL_S = 24 * 3600;
const SCAN_SESSIONS = 130;

/** graded-us stores `{ z: base64(gzip(json)) }`; older rows are plain objects. */
function unzipPayload(raw: any): { by_tier?: Record<string, any[]> } | null {
  if (!raw) return null;
  if (typeof raw?.z === 'string') {
    try { return JSON.parse(gunzipSync(Buffer.from(raw.z, 'base64')).toString('utf8')); } catch { return null; }
  }
  return raw?.by_tier ? raw : null;
}

function etToday(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);
}

let _rebuilding: Promise<any> | null = null;

async function rebuild(): Promise<any | null> {
  if (_rebuilding) return _rebuilding;
  _rebuilding = (async () => {
    const r = await rebuildUsBench(
      usBenchSessions(etToday(), SCAN_SESSIONS),
      async (d) => unzipPayload(await kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${d}|1`)),
      { concurrency: 8, deadlineMs: 40_000 },
    );
    if (!r.entries.length) return { entries: [], warm: r.warm, cold: r.cold, timedOut: r.timedOut };
    const payload = {
      updatedAt: new Date().toISOString(), count: r.entries.length, engine_version: US_ENGINE_VERSION,
      entries: r.entries, rebuilt_by: 'bench-us (KV list was empty)', warm_days: r.warm, cold_days: r.cold,
    };
    // A partial walk (deadline hit) is served but not saved over a future full build.
    if (!r.timedOut) await kvSet(US_BENCH_KEY, payload, REBUILT_TTL_S).catch(() => null);
    return { ...payload, timedOut: r.timedOut };
  })().finally(() => { _rebuilding = null; });
  return _rebuilding;
}

export async function GET(req: Request) {
  const view = new URL(req.url).searchParams.get('view');
  let payload: any = null;
  let readError: string | null = null;
  try { payload = await kvGet(US_BENCH_KEY); } catch (e: any) { payload = null; readError = String(e?.message || e).slice(0, 160); }

  let source: 'kv' | 'rebuilt' | 'empty' = 'kv';
  let note: string | null = null;
  if (!payload || !Array.isArray(payload.entries) || !payload.entries.length) {
    const r = await rebuild().catch((e: any) => ({ entries: [], error: String(e?.message || e).slice(0, 160) }));
    if (r?.entries?.length) {
      payload = r; source = 'rebuilt';
      note = `rebuilt from the graded US sessions in the cache (${r.warm_days ?? '?'} sessions warm${r.timedOut ? ', partial — time limit reached' : ''})`;
    } else {
      source = 'empty';
      note = readError ? `the server list could not be read (${readError})`
        : r?.error ? `rebuild failed (${r.error})`
        : `no BLOCKBUSTER or STRONG US result in the graded sessions on file (${r?.warm ?? 0} sessions warm, ${r?.cold ?? 0} not yet graded) — /api/v1/cron/refresh-us-bench has not run and the nightly US grading has not warmed any session`;
    }
  }

  if (source === 'empty') {
    return NextResponse.json({
      ok: true, entries: [], count: 0, updatedAt: null, source,
      engine_version: US_ENGINE_VERSION, current_engine_version: US_ENGINE_VERSION, note,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (view === 'tickers') {
    const names = compactUsBench(payload.entries);
    return NextResponse.json({
      ok: true, view: 'tickers', entries: names, count: names.length, updatedAt: payload.updatedAt ?? null, source,
      engine_version: payload.engine_version ?? null, current_engine_version: US_ENGINE_VERSION, note,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ ...payload, source, ...(note ? { note } : {}), current_engine_version: US_ENGINE_VERSION },
    { headers: { 'Cache-Control': 'no-store' } });
}
