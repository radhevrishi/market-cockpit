// PATCH 0307 — Server-side heartbeat logger.
//
// POST /api/v1/heartbeat/<pipeline> records {ok, ms, status, ts} into a
// KV-backed ring buffer keyed by pipeline id. GET reads back the last
// N entries.
//
// Pipelines are free-form strings (e.g. 'news-in-play', 'earnings-graded',
// 'transmission'). Each pipeline gets up to 240 entries; older entries
// are evicted. With one entry per probe (~60s interval) that's 4 hours of
// history at minimum; with a 5-minute probe interval, 20 hours.
//
// Replaces the previous client-side mc:status-history:v1 (Patch 0236)
// with a cross-user persistent log. The /status page now reads from this
// endpoint so health history is shared across browsers/devices.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

interface HeartbeatEntry {
  t: number;
  ok: boolean;
  ms: number;
  status?: number | string;
  note?: string;
}

const KEY = (pipeline: string) => `heartbeat:v1:${pipeline}`;
const MAX_ENTRIES = 240;
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// PATCH 0452 P0-8 — Audit flagged this endpoint as a KV pollution risk:
// anyone could POST 240 entries × 64-char arbitrary pipeline names. Now
// restricted to a known allowlist of pipeline IDs (matches the /status
// page probes). Random IDs return 400 — no KV write happens.
const ALLOWED_PIPELINES = new Set<string>([
  'news-in-play',
  'news-bottleneck',
  'earnings-post-gap',
  'earnings-enrich',
  'earnings-graded',
  'earnings-scan',
  'earnings-guidance',
  'special-situations',
  'bottleneck-dashboard',
  'transmission',
  'concall-intel-live',
  'concall-intel-warrant',
  'concall-intel-keyword',
  'strategic-visibility',
  'breadth',
  'movers',
  'multibagger-india',
  'multibagger-usa',
  'rerating',
]);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pipeline: string }> }
) {
  const { pipeline } = await params;
  if (!pipeline || pipeline.length > 64 || !/^[a-z0-9_-]+$/i.test(pipeline)) {
    return NextResponse.json({ error: 'invalid pipeline id' }, { status: 400 });
  }
  // PATCH 0452 P0-8 — Hard allowlist gate prevents KV pollution.
  if (!ALLOWED_PIPELINES.has(pipeline)) {
    return NextResponse.json({ error: 'pipeline not in allowlist' }, { status: 403 });
  }

  if (!isRedisAvailable()) {
    return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });
  }

  let payload: HeartbeatEntry | null = null;
  try {
    const body = await req.json();
    if (typeof body?.ok !== 'boolean' || typeof body?.ms !== 'number') {
      return NextResponse.json({ error: 'invalid body — need {ok, ms, status?, note?}' }, { status: 400 });
    }
    payload = {
      t: Date.now(),
      ok: body.ok,
      ms: Math.max(0, Math.round(body.ms)),
      status: body.status,
      note: typeof body.note === 'string' ? body.note.slice(0, 200) : undefined,
    };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const key = KEY(pipeline);
  const existing = (await kvGet<HeartbeatEntry[]>(key)) || [];
  const next = [...existing, payload!].slice(-MAX_ENTRIES);
  await kvSet(key, next, TTL_SECONDS);

  return NextResponse.json({ ok: true, stored: next.length });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pipeline: string }> }
) {
  const { pipeline } = await params;
  if (!pipeline || pipeline.length > 64 || !/^[a-z0-9_-]+$/i.test(pipeline)) {
    return NextResponse.json({ error: 'invalid pipeline id' }, { status: 400 });
  }

  if (!isRedisAvailable()) {
    return NextResponse.json({ entries: [] });
  }

  const entries = (await kvGet<HeartbeatEntry[]>(KEY(pipeline))) || [];
  const limit = Math.min(MAX_ENTRIES, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || '50')));

  return NextResponse.json({
    pipeline,
    entries: entries.slice(-limit),
    total: entries.length,
  });
}
