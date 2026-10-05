// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/nse-results/ingest — the GitHub collector writes NSE's financial-results list. (zzz875)
//
//   POST  { collector, rows: raw NSE rows (≤ 8,000), readDays: ['YYYY-MM-DD', ...] (the days the collector asked NSE for) }
//         → rows grouped by broadcast day and merged into nse-results:v1:day:<day>; nse-results:v1:coverage records the days read.
//   GET   → { coverage } (days read, rows per day), for the pipeline status.
//   A body over 6 MB is refused with 413 — never truncated.
//
// PROTECTED (lib/site-auth PROTECTED_API_PREFIXES '/api/v1/nse-results'): service key (x-cron-secret / x-mc-key) or the owner cookie.
// Responses carry counts only — never a key.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { SITE_COOKIE, expectedToken, safeEqual, hasServiceKey } from '@/lib/site-auth';
import { realDocsKv } from '@/lib/guidance-docs-store';
import { ingestNseResults, NSE_RESULTS_COVERAGE_KEY, NSE_RESULTS_MAX_DAYS_PER_REQUEST, type NseResultsCoverage } from '@/lib/nse-results-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_ROWS = 8_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function authorised(req: NextRequest): Promise<boolean> {
  if (hasServiceKey(req.headers.get('x-cron-secret')) || hasServiceKey(req.headers.get('x-mc-key'))) return true;
  const want = await expectedToken();
  const got = req.cookies.get(SITE_COOKIE)?.value || '';
  return !!want && !!got && safeEqual(want, got);
}

export async function GET(req: NextRequest) {
  if (!(await authorised(req))) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });
  const cov = await realDocsKv().get<NseResultsCoverage>(NSE_RESULTS_COVERAGE_KEY);
  return NextResponse.json({ ok: true, coverage: cov ?? null }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(hasServiceKey(req.headers.get('x-cron-secret')) || hasServiceKey(req.headers.get('x-mc-key')))) {
    return NextResponse.json({ ok: false, error: 'service key required' }, { status: 401, headers: NO_STORE });
  }
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'body too large' }, { status: 413, headers: NO_STORE });
  let raw: any;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'body too large' }, { status: 413, headers: NO_STORE });
    raw = JSON.parse(text);
  } catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: NO_STORE }); }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows)) return NextResponse.json({ ok: false, error: 'rows must be an array' }, { status: 400, headers: NO_STORE });
  if (raw.rows.length > MAX_ROWS) return NextResponse.json({ ok: false, error: `at most ${MAX_ROWS} rows per request` }, { status: 400, headers: NO_STORE });
  const readDays: string[] = Array.isArray(raw.readDays) ? raw.readDays.filter((d: unknown) => typeof d === 'string' && DAY_RE.test(d)).slice(0, NSE_RESULTS_MAX_DAYS_PER_REQUEST + 1) : [];
  try {
    const r = await ingestNseResults(realDocsKv(), raw.rows, readDays);
    return NextResponse.json({ ok: true, ...r }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[nse-results/ingest] store failed:', String(e?.message || e).slice(0, 200));
    return NextResponse.json({ ok: false, error: 'store failed' }, { status: 500, headers: NO_STORE });
  }
}
