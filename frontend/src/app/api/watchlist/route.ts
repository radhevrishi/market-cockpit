import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Simple in-memory store (persists within same serverless instance)
// For true persistence across cold starts, would need a database
// This works well enough since the cron and website requests often hit the same instance
const STORE = (globalThis as any).__MC_WATCHLIST_STORE__ || new Map<string, string[]>();
(globalThis as any).__MC_WATCHLIST_STORE__ = STORE;

const DEFAULT_WATCHLIST = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'BAJFINANCE', 'TATAMOTORS', 'LT', 'SBIN', 'AXISBANK',
  'SUNPHARMA', 'TITAN', 'WIPRO', 'MARUTI', 'HCLTECH',
];

const BOT_SECRET = 'mc-bot-2026';

/**
 * GET /api/watchlist?chatId=xxx
 * Returns the watchlist for a given chat ID
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId') || 'default';

  // Return the stored watchlist or DEFAULT_WATCHLIST as fallback
  // The store persists within the same serverless instance, but cold starts will fall back to DEFAULT
  const watchlist = STORE.get(chatId) || DEFAULT_WATCHLIST;

  return NextResponse.json({
    chatId,
    watchlist,
    count: watchlist.length,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * POST /api/watchlist
 * Body: { chatId, watchlist, secret } or { chatId, action: 'add'|'remove', symbols: string[], secret }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { chatId = 'default', secret } = body;

    // Simple auth check
    if (secret !== BOT_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (body.watchlist && Array.isArray(body.watchlist)) {
      // Full replacement
      const cleaned = body.watchlist
        .map((s: string) => String(s).trim().toUpperCase())
        .filter((s: string) => s.length > 0 && /^[A-Z0-9&-]+$/.test(s));
      STORE.set(chatId, cleaned);
      return NextResponse.json({
        ok: true,
        chatId,
        watchlist: cleaned,
        count: cleaned.length,
      });
    }

    if (body.action === 'add' && Array.isArray(body.symbols)) {
      const current = STORE.get(chatId) || [...DEFAULT_WATCHLIST];
      const toAdd = body.symbols
        .map((s: string) => String(s).trim().toUpperCase())
        .filter((s: string) => s.length > 0 && /^[A-Z0-9&-]+$/.test(s));
      const updated = [...new Set([...current, ...toAdd])];
      STORE.set(chatId, updated);
      return NextResponse.json({
        ok: true,
        action: 'add',
        added: toAdd,
        chatId,
        watchlist: updated,
        count: updated.length,
      });
    }

    if (body.action === 'remove' && Array.isArray(body.symbols)) {
      const current = STORE.get(chatId) || [...DEFAULT_WATCHLIST];
      const toRemove = new Set(
        body.symbols.map((s: string) => String(s).trim().toUpperCase())
      );
      const updated = current.filter((s: string) => !toRemove.has(s));
      STORE.set(chatId, updated);
      return NextResponse.json({
        ok: true,
        action: 'remove',
        removed: [...toRemove],
        chatId,
        watchlist: updated,
        count: updated.length,
      });
    }

    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
