import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const dynamic = 'force-dynamic';

// No hardcoded default — user's watchlist is the single source of truth (from Telegram bot or UI)
const DEFAULT_WATCHLIST: string[] = [];

const BOT_SECRET = 'mc-bot-2026';

type WatchlistFlag = 'GREEN' | 'ORANGE' | 'RED' | null;
interface WatchlistFlags { [symbol: string]: WatchlistFlag; }
interface WatchlistMeta {
  flags: WatchlistFlags;
  addedDates: { [symbol: string]: string }; // ISO date when stock was added
  addedPrices: { [symbol: string]: number }; // Price when stock was added
}

function kvKey(chatId: string): string {
  return `watchlist:${chatId}`;
}

function kvMetaKey(chatId: string): string {
  return `watchlist-meta:${chatId}`;
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
  const meta = await kvGet<WatchlistMeta>(kvMetaKey(chatId));

  const watchlist = (stored && Array.isArray(stored) && stored.length > 0) ? stored : DEFAULT_WATCHLIST;

  return NextResponse.json({
    chatId,
    watchlist,
    count: watchlist.length,
    source: stored ? (isRedisAvailable() ? 'redis' : 'memory') : 'default',
    updatedAt: new Date().toISOString(),
    flags: meta?.flags || {},
    addedDates: meta?.addedDates || {},
    addedPrices: meta?.addedPrices || {},
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

    // ── Flag update action (no secret needed — UI action) ──
    if (body.action === 'set-flag' && body.symbol && body.flag !== undefined) {
      const meta = await kvGet<WatchlistMeta>(kvMetaKey(chatId)) || { flags: {}, addedDates: {}, addedPrices: {} };
      const sym = String(body.symbol).trim().toUpperCase();
      if (body.flag === null || body.flag === 'NONE') {
        delete meta.flags[sym];
      } else {
        meta.flags[sym] = body.flag as WatchlistFlag;
      }
      await kvSet(kvMetaKey(chatId), meta);
      return NextResponse.json({ ok: true, symbol: sym, flag: meta.flags[sym] || null });
    }

    // ── Set added price for tracking ──
    if (body.action === 'set-price' && body.symbol && body.price !== undefined) {
      const meta = await kvGet<WatchlistMeta>(kvMetaKey(chatId)) || { flags: {}, addedDates: {}, addedPrices: {} };
      const sym = String(body.symbol).trim().toUpperCase();
      meta.addedPrices[sym] = body.price;
      if (!meta.addedDates[sym]) meta.addedDates[sym] = new Date().toISOString().slice(0, 10);
      await kvSet(kvMetaKey(chatId), meta);
      return NextResponse.json({ ok: true, symbol: sym, addedPrice: body.price });
    }

    // Auth check for watchlist modification actions
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

      // Auto-set addedDate for new symbols
      const meta = await kvGet<WatchlistMeta>(kvMetaKey(chatId)) || { flags: {}, addedDates: {}, addedPrices: {} };
      const today = new Date().toISOString().slice(0, 10);
      for (const sym of toAdd) {
        if (!meta.addedDates[sym]) meta.addedDates[sym] = today;
      }
      await kvSet(kvMetaKey(chatId), meta);
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
