import { NextResponse } from 'next/server';
import { kvDel } from '@/lib/kv';

export const dynamic = 'force-dynamic';

// PATCH 0452 P0-1 — Audit found the Refresh button was a silent no-op:
// it deleted 'news:articles:v1' but the live cache key is bumped on every
// roster change (currently 'news:articles:v39'). Now we delete the same
// key shape the main route uses; if either side is bumped, just update
// here too. Also clear the persistent-bottleneck shard so the bottleneck
// strip refreshes on next hit.
const ACTIVE_NEWS_KEY = 'news:articles:v39';
const ACTIVE_BOTTLENECK_KEY = 'bottleneck:articles:persistent:v14';

export async function POST() {
  try {
    await Promise.all([
      kvDel(ACTIVE_NEWS_KEY),
      kvDel(ACTIVE_BOTTLENECK_KEY),
    ]);
    return NextResponse.json({
      success: true,
      message: 'News cache cleared — next request will fetch fresh data',
      cleared: [ACTIVE_NEWS_KEY, ACTIVE_BOTTLENECK_KEY],
    });
  } catch (error) {
    console.error('[News Refresh] Error:', error);
    return NextResponse.json({ success: true, message: 'Refresh triggered' });
  }
}
