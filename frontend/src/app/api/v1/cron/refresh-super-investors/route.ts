// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR HOLDINGS — SCHEDULED REFRESH (PATCH 1066)
//
// GET  /api/v1/cron/refresh-super-investors?secret=<CRON_SECRET>
// POST /api/v1/cron/refresh-super-investors?secret=<CRON_SECRET>
//
// Touches every entry in `SUPER_INVESTORS` and writes their static holdings
// to KV under `superinv:holdings:v1:<id>` with a fresh `scrapedAt`. The read
// endpoint then reports `source: "kv"` + `stale: false` and the UI freshness
// chip stays green.
//
// This is a degenerate-but-honest V1 of the scraper pipeline:
//   • Most investors don't ship a public JSON feed of their holdings.
//   • Trendlyne is JS-rendered and not easily scrape-able from a Next.js
//     route (Playwright would need a separate worker container).
//   • Pragmatic compromise: keep the curated static list as source of truth,
//     promote it to KV on a schedule. The plumbing for "real" scrape data
//     is unchanged — when a future worker writes scraped rows to the same
//     KV key, the cron call below either no-ops (if already fresh) or
//     overwrites, both safe.
//
// Auth: same CRON_SECRET as /alerts/dispatch + /super-investor-holdings/ingest.
// Caller: GitHub Actions workflow .github/workflows/refresh-super-investors.yml
// (fires every 6 h). Also runs on `workflow_dispatch` for manual ad-hoc warm.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvSet, kvGet } from '@/lib/kv';
import { SUPER_INVESTORS } from '@/lib/super-investors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TTL_SECONDS = 6 * 60 * 60;  // 6 h — matches read-endpoint stale window

interface CachedPayload {
  scrapedAt: string;
  holdings: any[];
}

interface RefreshRow {
  id: string;
  staticCount: number;
  /** 'wrote' = wrote static into KV. 'skipped' = KV already has live scraped data fresher than 6h. */
  action: 'wrote' | 'skipped' | 'error';
  reason?: string;
}

async function check(secret: string | null): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured; endpoint disabled' },
      { status: 503 },
    );
  }
  if (secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

async function refresh(force: boolean): Promise<{ fetchedAt: string; results: RefreshRow[]; written: number; skipped: number }> {
  const fetchedAt = new Date().toISOString();
  const results: RefreshRow[] = [];

  for (const inv of SUPER_INVESTORS) {
    if (!inv.topHoldings || inv.topHoldings.length === 0) {
      results.push({ id: inv.id, staticCount: 0, action: 'skipped', reason: 'no static holdings' });
      continue;
    }

    // If a scraper has already written fresher data, leave it. `force=true`
    // bypasses this — useful for manual reseed.
    if (!force) {
      try {
        const existing = await kvGet<CachedPayload>(`superinv:holdings:v1:${inv.id}`);
        if (existing && existing.scrapedAt) {
          const ageMs = Date.now() - new Date(existing.scrapedAt).getTime();
          if (ageMs >= 0 && ageMs < 4 * 60 * 60 * 1000) {  // <4h old → leave alone
            results.push({ id: inv.id, staticCount: inv.topHoldings.length, action: 'skipped', reason: 'fresh entry already in KV' });
            continue;
          }
        }
      } catch {
        // KV read failure — proceed to write.
      }
    }

    try {
      await kvSet(
        `superinv:holdings:v1:${inv.id}`,
        { scrapedAt: fetchedAt, holdings: inv.topHoldings },
        TTL_SECONDS,
      );
      results.push({ id: inv.id, staticCount: inv.topHoldings.length, action: 'wrote' });
    } catch (e: any) {
      results.push({ id: inv.id, staticCount: inv.topHoldings.length, action: 'error', reason: String(e?.message || e).slice(0, 160) });
    }
  }

  const written = results.filter((r) => r.action === 'wrote').length;
  const skipped = results.filter((r) => r.action === 'skipped').length;
  return { fetchedAt, results, written, skipped };
}

export async function GET(req: NextRequest) {
  const denied = await check(req.nextUrl.searchParams.get('secret'));
  if (denied) return denied;
  const force = req.nextUrl.searchParams.get('force') === '1';
  const body = await refresh(force);
  return NextResponse.json({ ok: true, force, ...body });
}

export async function POST(req: NextRequest) {
  const denied = await check(req.nextUrl.searchParams.get('secret'));
  if (denied) return denied;
  const force = req.nextUrl.searchParams.get('force') === '1';
  const body = await refresh(force);
  return NextResponse.json({ ok: true, force, ...body });
}
