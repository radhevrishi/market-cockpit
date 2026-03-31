import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const dynamic = 'force-dynamic';

// No hardcoded default — user's watchlist is the single source of truth (from Telegram bot or UI)
const DEFAULT_WATCHLIST: string[] = [];

const BOT_SECRET = 'mc-bot-2026';

function kvKey(chatId: string): string {
  return `watchlist:${chatId}`;
}

/**
 * GET /api/watchlist?chatId=xxx
 * Returns the watchlist for a given chat ID
 * Uses Redis (persistent) → in-memory fallback → DEFAULT_WATCHLIST
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId') || 'default';

  // Try KV store (Redis or in-memory)
  const stored = await kvGet<string[]>(kvKey(chatId));
  if (stored && Array.isArray(stored) && stored.length > 0) {
    return NextResponse.json({
      chatId,
      watchlist: stored,
      count: stored.length,
      source: isRedisAvailable() ? 'redis' : 'memory',
      updatedAt: new Date().toISOString(),
    });
  }

  // Fallback to DEFAULT_WATCHLIST
  return NextResponse.json({
    chatId,
    watchlist: DEFAULT_WATCHLIST,
    count: DEFAULT_WATCHLIST.length,
    source: 'default',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * POST /api/watchlist
 * Body: { chatId, watchlist, secret } or { chatId, action: 'add'|'remove', symbols: string[], secret }
 * Persists to Redis (if available) + in-memory
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { chatId = 'default', secret } = body;

    // Simple auth check
    if (secret !== BOT_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let updated: string[] = [];

    if (body.watchlist && Array.isArray(body.watchlist)) {
      // Full replacement
      updated = body.watchlist
        .map((s: string) => String(s).trim().toUpperCase())
        .filter((s: string) => s.length > 0 && /^[A-Z0-9&-]+$/.test(s));
    } else if (body.action === 'add' && Array.isArray(body.symbols)) {
      const current = await kvGet<string[]>(kvKey(chatId)) || [...DEFAULT_WATCHLIST];
      const toAdd = body.symbols
        .map((s: string) => String(s).trim().toUpperCase())
        .filter((s: string) => s.length > 0 && /^[A-Z0-9&-]+$/.test(s));
      updated = [...new Set([...current, ...toAdd])];
    } else if (body.action === 'remove' && Array.isArray(body.symbols)) {
      const current = await kvGet<string[]>(kvKey(chatId)) || [...DEFAULT_WATCHLIST];
      const toRemove = new Set(
        body.symbols.map((s: string) => String(s).trim().toUpperCase())
      );
      updated = current.filter((s: string) => !toRemove.has(s));
    } else {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Persist to KV store (no TTL — watchlist should persist forever)
    await kvSet(kvKey(chatId), updated);

    return NextResponse.json({
      ok: true,
      chatId,
      watchlist: updated,
      count: updated.length,
      action: body.action || 'replace',
      storage: isRedisAvailable() ? 'redis' : 'memory',
    });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
