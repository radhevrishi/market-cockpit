// ═══════════════════════════════════════════════════════════════════════════
// One-shot KV migration: Upstash (REST) ──► Railway Redis (TCP)
//
// Reads every key from the legacy Upstash store and writes it into the new
// Railway Redis, preserving TTLs. Idempotent and safe to re-run.
//
// Manual trigger:
//   GET /api/v1/admin/migrate-kv?secret=<CRON_SECRET>            (live migrate)
//   GET /api/v1/admin/migrate-kv?secret=<CRON_SECRET>&dry=1      (count only, no writes)
//   GET /api/v1/admin/migrate-kv?secret=<CRON_SECRET>&match=graded:v8:*&limit=5000
//
// Requires BOTH sets of env vars present at once:
//   UPSTASH_REDIS_REST_URL + _TOKEN (source)  and  REDIS_URL (destination).
// After migration you can remove the Upstash vars; lib/kv.ts already prefers
// REDIS_URL.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function serialize(value: any): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'cron-secret-unset' }, { status: 503 });
    }
  } else if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dry = searchParams.get('dry') === '1';
  const match = searchParams.get('match') || '*';
  const limit = Math.max(0, parseInt(searchParams.get('limit') || '100000', 10));

  // Source: Upstash
  const upUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const upTok = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!upUrl || !upTok) {
    return NextResponse.json({ error: 'upstash-source-missing', hint: 'Set UPSTASH_REDIS_REST_URL + _TOKEN' }, { status: 400 });
  }
  const upstash = new UpstashRedis({ url: upUrl, token: upTok });

  // Destination: Railway Redis
  const rwUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || process.env.RAILWAY_REDIS_URL || process.env.REDIS_PUBLIC_URL;
  if (!rwUrl && !dry) {
    return NextResponse.json({ error: 'railway-dest-missing', hint: 'Add a Railway Redis and set REDIS_URL' }, { status: 400 });
  }
  const dest = rwUrl ? new IORedis(rwUrl, { lazyConnect: false, maxRetriesPerRequest: 3 }) : null;

  const started = Date.now();
  let scanned = 0, migrated = 0, withTtl = 0, emptySkipped = 0, errors = 0;
  const sampleKeys: string[] = [];

  try {
    let cursor = '0';
    do {
      // Upstash SCAN returns [nextCursor, keys]
      const [next, keys] = (await upstash.scan(cursor, { match, count: 200 })) as [string, string[]];
      cursor = next;
      for (const key of keys) {
        if (scanned >= limit) { cursor = '0'; break; }
        scanned++;
        if (sampleKeys.length < 10) sampleKeys.push(key);
        if (dry) continue;
        try {
          const val = await upstash.get(key);
          if (val === null || val === undefined) { emptySkipped++; continue; }
          const ttl = await upstash.ttl(key); // -1 no expiry, -2 missing, >0 seconds
          const payload = serialize(val);
          if (ttl && ttl > 0) {
            await dest!.set(key, payload, 'EX', ttl);
            withTtl++;
          } else {
            await dest!.set(key, payload);
          }
          migrated++;
        } catch (e) {
          errors++;
        }
      }
    } while (cursor !== '0' && scanned < limit);
  } catch (e: any) {
    return NextResponse.json({ error: 'scan-failed', message: e?.message || String(e), scanned, migrated }, { status: 500 });
  } finally {
    try { await dest?.quit(); } catch {}
  }

  return NextResponse.json({
    ok: true,
    dry_run: dry,
    match,
    scanned,
    migrated,
    with_ttl: withTtl,
    empty_skipped: emptySkipped,
    errors,
    sample_keys: sampleKeys,
    elapsed_ms: Date.now() - started,
  });
}

// POST alias (parity with the cron bridge convention).
export async function POST(req: Request) {
  return GET(req);
}
