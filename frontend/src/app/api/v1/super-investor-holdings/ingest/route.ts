// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR HOLDINGS — INGEST ENDPOINT (PATCH 1062)
//
// POST /api/v1/super-investor-holdings/ingest?secret=<CRON_SECRET>
//
// Body (single investor):
//   { id: string, scrapedAt: string, holdings: DisclosedHolding[] }
//
// Body (batch of investors — preferred for cron payloads):
//   { batch: Array<{ id, scrapedAt, holdings }> }
//
// Writes one KV key per investor: `superinv:holdings:v1:<id>` with TTL 6 h.
// Validates each holding shape minimally so bad input doesn't corrupt the
// cache and silently flip the freshness chip to green.
//
// Auth: shared CRON_SECRET (same as /api/v1/alerts/dispatch). When the
// secret is unset, the endpoint hard-503s so a forgotten env var never
// allows anonymous writes.
//
// Caller pattern:
//   - mc-guardian Cloudflare Worker (preferred — runs every 10 min anyway)
//   - Vercel-style cron route GET /api/v1/cron/refresh-super-investors
//   - Manual `curl -X POST` for one-shot seeding from the laptop
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvSet } from '@/lib/kv';
import { SUPER_INVESTORS, type DisclosedHolding } from '@/lib/super-investors';
import { verifyCronSecret } from '@/lib/verifyAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 6 * 60 * 60; // 6 h — matches the read endpoint's stale window

interface InvestorPayload {
  id: string;
  scrapedAt: string;
  holdings: any[];
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function sanitizeHolding(raw: unknown): DisclosedHolding | null {
  if (!isPlainObject(raw)) return null;
  const ticker = String(raw.ticker || '').toUpperCase().trim();
  const company = String(raw.company || '').trim();
  if (!ticker) return null;
  const stakePctRaw = raw.stakePct;
  const stakePct =
    typeof stakePctRaw === 'number' && isFinite(stakePctRaw) && stakePctRaw >= 0
      ? stakePctRaw
      : undefined;
  const disclosedOn = String(raw.disclosedOn || '').trim();
  const disclosedOnSafe = /^\d{4}-\d{2}-\d{2}$/.test(disclosedOn) ? disclosedOn : '';
  const tier =
    raw.tier === 'BSE_1PCT' ||
    raw.tier === 'AIF_FILING' ||
    raw.tier === 'PUBLIC_COMMENTARY' ||
    raw.tier === 'INFERRED'
      ? raw.tier
      : 'BSE_1PCT';
  const exchange =
    raw.exchange === 'NSE' || raw.exchange === 'BSE' ||
    raw.exchange === 'NYSE' || raw.exchange === 'NASDAQ' ||
    raw.exchange === 'ASX' || raw.exchange === 'LSE' || raw.exchange === 'TSE'
      ? raw.exchange
      : undefined;
  return {
    ticker,
    company: company || ticker,
    stakePct,
    disclosedOn: disclosedOnSafe,
    tier,
    exchange,
    thesis: typeof raw.thesis === 'string' ? raw.thesis.slice(0, 400) : undefined,
  };
}

function sanitizePayload(raw: unknown): InvestorPayload | null {
  if (!isPlainObject(raw)) return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  if (!SUPER_INVESTORS.some((x) => x.id === id)) return null;
  const scrapedAtRaw = String(raw.scrapedAt || '').trim();
  const scrapedAt = /^\d{4}-\d{2}-\d{2}T/.test(scrapedAtRaw)
    ? scrapedAtRaw
    : new Date().toISOString();
  if (!Array.isArray(raw.holdings)) return null;
  const holdings: DisclosedHolding[] = [];
  for (const h of raw.holdings) {
    const safe = sanitizeHolding(h);
    if (safe) holdings.push(safe);
  }
  return { id, scrapedAt, holdings: holdings as any };
}

interface IngestResult {
  id: string;
  written: boolean;
  count: number;
  reason?: string;
}

async function writeOne(p: InvestorPayload): Promise<IngestResult> {
  if (p.holdings.length === 0) {
    return { id: p.id, written: false, count: 0, reason: 'empty holdings (refused so static fallback stays in effect)' };
  }
  try {
    await kvSet(
      `superinv:holdings:v1:${p.id}`,
      { scrapedAt: p.scrapedAt, holdings: p.holdings },
      TTL_SECONDS,
    );
    return { id: p.id, written: true, count: p.holdings.length };
  } catch (e: any) {
    return { id: p.id, written: false, count: p.holdings.length, reason: String(e?.message || e).slice(0, 200) };
  }
}

export async function POST(req: NextRequest) {
  // PATCH 1101zzz2 / AUDIT H2 — constant-time secret comparison via shared helper.
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) {
    const status = auth.reason.includes('not configured') ? 503 : 401;
    return NextResponse.json({ error: auth.reason }, { status });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const fetchedAt = new Date().toISOString();
  const items: InvestorPayload[] = [];

  if (isPlainObject(body) && Array.isArray((body as any).batch)) {
    for (const raw of (body as any).batch) {
      const safe = sanitizePayload(raw);
      if (safe) items.push(safe);
    }
  } else {
    const safe = sanitizePayload(body);
    if (safe) items.push(safe);
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'no valid payloads — need { id, scrapedAt, holdings:[...] } or { batch:[...] }' },
      { status: 400 },
    );
  }

  const results: IngestResult[] = [];
  for (const item of items) {
    results.push(await writeOne(item));
  }
  const written = results.filter((r) => r.written).length;
  return NextResponse.json({
    fetchedAt,
    totalAccepted: items.length,
    written,
    skipped: results.length - written,
    results,
  });
}
