// ═══════════════════════════════════════════════════════════════════════════
// INDIA GRADED WINDOW — BATCHED, CACHE-ONLY READ  (zzz814)
//
// GET /api/v1/earnings/graded-window?dates=2026-09-26,2026-09-25,...
//
// The India Earnings Opportunities page can now show a multi-day window (up
// to 60 trading sessions ≈ 84 calendar dates, weekends included). Asking
// /graded once per date from the browser would be 84 requests and 84+ KV
// commands. This reads the SAME store (`graded:<engine>:<date>`, one
// definition in lib/graded-cache-key.ts) with one MGET per group of dates.
//
// It NEVER grades. A date with nothing stored comes back in `missing`; the
// page grades those itself, one at a time through /graded, newest first.
//
// Engine version: a date stored only under an older engine's namespace is
// returned as it is, stamped `stale` with that engine — the page shows it
// labelled "graded under the previous rules" instead of re-grading the whole
// window. (The India payload stores graded OUTPUT, not the grader's inputs,
// so there is no US-style instant re-grade from stored inputs.)
//
// Response size: Vercel caps a function response at ~4.5 MB and a dense
// results day is a few hundred KB, so groups are read until ~3.5 MB is
// assembled and the rest is returned in `deferred` for the next request.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { GRADED_CACHE_VERSION, GRADED_CACHE_LEGACY } from '@/lib/graded-cache-key';
import { kvMGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATES = 100;
const GROUP = 6;
const BUDGET_BYTES = 3_500_000;
const TIERS = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

function rowCount(p: any): number {
  if (!p?.by_tier) return 0;
  return TIERS.reduce((n, t) => n + (Array.isArray(p.by_tier[t]) ? p.by_tier[t].length : 0), 0);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dates = Array.from(new Set(
    String(searchParams.get('dates') || '').split(',').map((s) => s.trim()).filter((s) => ISO_RE.test(s)),
  )).sort().reverse().slice(0, MAX_DATES);
  if (dates.length === 0) {
    return NextResponse.json({ error: 'dates param required (comma-separated YYYY-MM-DD)' }, { status: 400 });
  }

  const days: Array<{ date: string; payload: any; engine: string; stale: boolean }> = [];
  const missing: string[] = [];
  const deferred: string[] = [];
  let bytes = 0;
  let kvCommands = 0;

  for (let i = 0; i < dates.length; i += GROUP) {
    const group = dates.slice(i, i + GROUP);
    if (bytes >= BUDGET_BYTES) { deferred.push(...group); continue; }

    const found = new Map<string, { payload: any; engine: string; stale: boolean }>();
    // Current engine first — one command for the whole group.
    let cur: any[] = [];
    try { cur = await kvMGet(group.map((d) => `graded:${GRADED_CACHE_VERSION}:${d}`)); kvCommands++; } catch { cur = []; }
    group.forEach((d, k) => {
      const p = cur[k];
      // A stored day with zero rows is a real answer (a holiday, a quiet
      // Sunday) — unless the build recorded that the source was down.
      if (p?.by_tier && !(p._hub_fail && rowCount(p) === 0)) found.set(d, { payload: p, engine: GRADED_CACHE_VERSION, stale: false });
    });
    // Older engines, newest first, only for what is still missing — one
    // command per namespace, and it stops as soon as nothing is missing.
    let left = group.filter((d) => !found.has(d));
    for (const v of GRADED_CACHE_LEGACY) {
      if (left.length === 0) break;
      let old: any[] = [];
      try { old = await kvMGet(left.map((d) => `graded:${v}:${d}`)); kvCommands++; } catch { old = []; }
      left.forEach((d, k) => {
        const p = old[k];
        if (rowCount(p) > 0) found.set(d, { payload: p, engine: v, stale: true });
      });
      left = left.filter((d) => !found.has(d));
    }

    for (const d of group) {
      const f = found.get(d);
      if (!f) { missing.push(d); continue; }
      if (bytes >= BUDGET_BYTES) { deferred.push(d); continue; }
      bytes += JSON.stringify(f.payload).length;
      days.push({ date: d, payload: f.payload, engine: f.engine, stale: f.stale });
    }
  }

  return NextResponse.json(
    { engine_current: GRADED_CACHE_VERSION, days, missing, deferred, kv_commands: kvCommands, bytes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
