// /api/v1/cron/heartbeat — store a cron run's last status in Upstash KV.
//
// 10y-ops Section 7.3: GH Actions workflows POST here at end-of-run so
// mc-guardian can detect silent stops. KV-backed (no DB) so it works even
// if FastAPI/Render is down — the whole point is to alert on infra failures.
//
// POST body: { name, phase, ok, exit_code?, error?, run_url? }
// KV layout:
//   cron-heartbeat:names         → string[]  (set of all known cron names)
//   cron-heartbeat:row:<name>    → { last_started_at, last_ok_at, last_ok, exit_code, error, run_url, updated_at }

import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAMES_KEY = 'cron-heartbeat:names';
const ROW_KEY = (name: string) => `cron-heartbeat:row:${name}`;
const NAMES_TTL = 60 * 60 * 24 * 90;  // 90d — long enough to survive low-frequency crons
const ROW_TTL = 60 * 60 * 24 * 90;

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

async function addToNamesIndex(name: string) {
  const cur = (await kvGet<string[]>(NAMES_KEY)) || [];
  if (!cur.includes(name)) {
    cur.push(name);
    await kvSet(NAMES_KEY, cur, NAMES_TTL);
  }
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const name = String(body?.name || '').slice(0, 80);
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });

  const phase = body?.phase === 'start' ? 'start' : 'end';
  const ok = !!body?.ok;
  const exit_code = typeof body?.exit_code === 'number' ? body.exit_code : null;
  const error = body?.error ? String(body.error).slice(0, 500) : null;
  const run_url = body?.run_url ? String(body.run_url).slice(0, 500) : null;
  const now = new Date().toISOString();

  const existing = (await kvGet<HeartbeatRow>(ROW_KEY(name))) || {
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
    if (!existing.last_started_at) existing.last_started_at = now;  // synthesize if only end was sent
    existing.last_ok = ok;
    if (ok) existing.last_ok_at = now;
    existing.exit_code = exit_code;
    existing.error = error;
  }
  if (run_url) existing.run_url = run_url;
  existing.updated_at = now;

  await kvSet(ROW_KEY(name), existing, ROW_TTL);
  await addToNamesIndex(name);

  return NextResponse.json({ ok: true, phase, stored: existing });
}

// Allow GET for ?ping=1 sanity check + cron sources that only do GET
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('ping') === '1') {
    return NextResponse.json({ ok: true, route: 'heartbeat', method: 'GET-ping' });
  }
  return NextResponse.json({ ok: false, hint: 'POST { name, phase, ok } to record. GET ?ping=1 to confirm route is live.' }, { status: 405 });
}
