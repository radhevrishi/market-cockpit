// PATCH 0311 — Public read-only API: graded earnings.
//
// GET /api/v1/public/graded/<YYYY-MM-DD>?key=<api-key>
//
// Returns a redacted version of the institutional graded earnings list
// for the requested date. Designed for embed widgets, partner dashboards,
// and read-only third-party clients.
//
// Auth: simple shared-key model until real Auth lands. Configure
// PUBLIC_API_KEYS env var with a comma-separated list of allowed keys.
// Anonymous access is allowed if PUBLIC_API_ANON=1.
//
// Rate-limit: tracked in KV by api-key (or by IP if anonymous).
//   Default: 60 requests / hour per key. Returns 429 on overage.
//
// Redaction policy:
//   - Keeps: symbol, company, sector, grade, composite, magnitude_summary,
//            filing_date, methodology_tags (high-level only).
//   - Drops: internal scoring weights, audit trail, post-gap details,
//            news evidence URLs (those are subscriber-only).

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

const RATE_KEY = (id: string) => `pubapi-rate:v1:${id}`;
const RATE_WINDOW_SECONDS = 3600;          // 1h sliding
const RATE_LIMIT_DEFAULT = 60;

interface RateRow {
  count: number;
  reset_at: number;
}

function clientId(req: NextRequest, key: string | null): string {
  if (key) return `k:${key}`;
  const forwarded = req.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || req.headers.get('x-real-ip') || 'anon';
  return `ip:${ip}`;
}

function allowedKey(key: string | null): boolean {
  const list = (process.env.PUBLIC_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.length === 0) return process.env.PUBLIC_API_ANON === '1';
  if (!key) return process.env.PUBLIC_API_ANON === '1';
  return list.includes(key);
}

async function checkRate(id: string): Promise<{ ok: boolean; remaining: number; resetAt: number }> {
  if (!isRedisAvailable()) return { ok: true, remaining: RATE_LIMIT_DEFAULT, resetAt: Date.now() + RATE_WINDOW_SECONDS * 1000 };
  const now = Date.now();
  const row = (await kvGet<RateRow>(RATE_KEY(id))) || { count: 0, reset_at: now + RATE_WINDOW_SECONDS * 1000 };
  if (row.reset_at < now) { row.count = 0; row.reset_at = now + RATE_WINDOW_SECONDS * 1000; }
  row.count += 1;
  await kvSet(RATE_KEY(id), row, RATE_WINDOW_SECONDS);
  const remaining = Math.max(0, RATE_LIMIT_DEFAULT - row.count);
  return { ok: row.count <= RATE_LIMIT_DEFAULT, remaining, resetAt: row.reset_at };
}

function redact(card: any): any {
  if (!card || typeof card !== 'object') return null;
  // Whitelist only the public-safe fields.
  return {
    symbol: card.symbol,
    company: card.company || card.name,
    sector: card.sector,
    grade: card.grade,
    grade_label: card.grade_label,
    composite_score: card.composite_score,
    magnitude_summary: card.magnitude_summary || card.magnitude || null,
    filing_date: card.filing_date,
    methodology_tags: Array.isArray(card.methodology_tags) ? card.methodology_tags : (Array.isArray(card.tags) ? card.tags : []),
  };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid date — use YYYY-MM-DD' }, { status: 400 });
  }
  const key = req.nextUrl.searchParams.get('key');
  if (!allowedKey(key)) {
    return NextResponse.json({ error: 'unauthorized — pass ?key=<api-key>' }, { status: 401 });
  }

  const cid = clientId(req, key);
  const rate = await checkRate(cid);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'rate-limited', limit: RATE_LIMIT_DEFAULT, window_seconds: RATE_WINDOW_SECONDS, reset_at: new Date(rate.resetAt).toISOString() },
      { status: 429, headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_DEFAULT),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(rate.resetAt / 1000)),
      } }
    );
  }

  // Read the institutional graded:v8 payload from KV directly.
  if (!isRedisAvailable()) {
    return NextResponse.json({ error: 'data-store-unavailable' }, { status: 503 });
  }
  const payload = await kvGet<any>(`graded:v8:${date}`);
  if (!payload) {
    return NextResponse.json({ date, cards: [], total: 0, note: 'no data for this date' });
  }

  // PATCH 0452 P0-3 — Audit found this always returned 0 cards. Main
  // graded route stores `{ by_tier: { BLOCKBUSTER: [...], STRONG: [...] } }`
  // — never the legacy `cards` / `items` shapes. Public consumers paying for
  // the API were getting an empty payload silently. Flatten by_tier here.
  const allCards = Array.isArray(payload?.cards) ? payload.cards
                 : Array.isArray(payload?.items) ? payload.items
                 : (payload?.by_tier && typeof payload.by_tier === 'object')
                   ? Object.values(payload.by_tier).flat()
                 : Array.isArray(payload) ? payload : [];
  const redacted = allCards.map(redact).filter(Boolean);

  return NextResponse.json(
    {
      date,
      total: redacted.length,
      cards: redacted,
      // Quality grade buckets summarized for embed callers
      counts_by_grade: redacted.reduce((acc: Record<string, number>, c: any) => {
        const g = c.grade || c.grade_label || 'UNKNOWN';
        acc[g] = (acc[g] || 0) + 1;
        return acc;
      }, {}),
      api_version: '1',
      generated_at: new Date().toISOString(),
    },
    { headers: {
      'X-RateLimit-Limit': String(RATE_LIMIT_DEFAULT),
      'X-RateLimit-Remaining': String(rate.remaining),
      'X-RateLimit-Reset': String(Math.floor(rate.resetAt / 1000)),
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    } }
  );
}
