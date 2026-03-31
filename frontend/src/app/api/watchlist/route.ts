import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// In-memory store (warm instance cache)
const STORE = (globalThis as any).__MC_WATCHLIST_STORE__ || new Map<string, { watchlist: string[]; updatedAt: number }>();
(globalThis as any).__MC_WATCHLIST_STORE__ = STORE;

const DEFAULT_WATCHLIST = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'BAJFINANCE', 'TATAMOTORS', 'LT', 'SBIN', 'AXISBANK',
  'SUNPHARMA', 'TITAN', 'WIPRO', 'MARUTI', 'HCLTECH',
];

const BOT_SECRET = 'mc-bot-2026';
const BOT_TOKEN = '8681784264:AAG7OV3ibS4r89Lbrta50NkWnJSCTrtoS80';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Persist watchlist to Telegram (send as a special JSON message the bot can read back)
async function persistToTelegram(chatId: string, watchlist: string[]): Promise<void> {
  try {
    const payload = JSON.stringify({ _mc_watchlist: true, chatId, watchlist, ts: Date.now() });
    // Send as a message to the chat — this persists in Telegram's servers
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `📋 Watchlist synced (${watchlist.length} stocks):\n${watchlist.join(', ')}\n\n_MC_DATA:${Buffer.from(payload).toString('base64')}`,
        parse_mode: 'HTML',
        disable_notification: true,
      }),
    });
    console.log(`[Watchlist] Persisted ${watchlist.length} stocks to Telegram for ${chatId}`);
  } catch (e) {
    console.error('[Watchlist] Failed to persist to Telegram:', e);
  }
}

// Recover watchlist from Telegram messages on cold start
async function recoverFromTelegram(chatId: string): Promise<string[] | null> {
  try {
    // Get recent messages from the chat via getUpdates won't work for bot's own messages
    // Instead, use the forwardMessage trick or just use getChat + getChatHistory
    // Actually, the simplest: use getUpdates with offset -1 to get recent messages
    // But getUpdates only shows incoming messages TO the bot, not FROM the bot.

    // Better approach: use Telegram's getChatHistory via Bot API
    // Actually Bot API doesn't support getChatHistory.

    // Best approach: search recent updates for callback or command messages
    // that contain watchlist info. But this won't find bot's OWN messages.

    // SIMPLEST WORKING APPROACH: The bot sends a message with _MC_DATA marker.
    // We can't read those back easily. Instead, let's use a different persistence:
    // Pin a message with the watchlist data!

    // Try to get the pinned message from the chat
    const chatRes = await fetch(`${TELEGRAM_API}/getChat?chat_id=${chatId}`);
    if (chatRes.ok) {
      const chatData = await chatRes.json();
      const pinnedMsg = chatData?.result?.pinned_message?.text;
      if (pinnedMsg && pinnedMsg.includes('_MC_DATA:')) {
        const b64 = pinnedMsg.split('_MC_DATA:')[1]?.trim();
        if (b64) {
          const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
          if (decoded._mc_watchlist && Array.isArray(decoded.watchlist)) {
            console.log(`[Watchlist] Recovered ${decoded.watchlist.length} stocks from Telegram pinned message`);
            return decoded.watchlist;
          }
        }
      }
    }
    return null;
  } catch (e) {
    console.error('[Watchlist] Failed to recover from Telegram:', e);
    return null;
  }
}

// Persist + pin the watchlist message
async function persistAndPinToTelegram(chatId: string, watchlist: string[]): Promise<void> {
  try {
    const payload = JSON.stringify({ _mc_watchlist: true, chatId, watchlist, ts: Date.now() });
    const text = `📋 Watchlist (${watchlist.length} stocks):\n${watchlist.join(', ')}\n\n_MC_DATA:${Buffer.from(payload).toString('base64')}`;

    const sendRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_notification: true,
      }),
    });

    if (sendRes.ok) {
      const sendData = await sendRes.json();
      const messageId = sendData?.result?.message_id;
      if (messageId) {
        // Pin this message so we can find it on cold start
        await fetch(`${TELEGRAM_API}/pinChatMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            disable_notification: true,
          }),
        });
        console.log(`[Watchlist] Persisted and pinned watchlist (${watchlist.length} stocks) to Telegram`);
      }
    }
  } catch (e) {
    console.error('[Watchlist] Failed to persist to Telegram:', e);
  }
}

/**
 * GET /api/watchlist?chatId=xxx
 * Returns the watchlist for a given chat ID
 * On cold start: recovers from Telegram pinned message
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId') || 'default';

  // Check in-memory store first
  const cached = STORE.get(chatId);
  if (cached && cached.watchlist.length > 0) {
    return NextResponse.json({
      chatId,
      watchlist: cached.watchlist,
      count: cached.watchlist.length,
      source: 'memory',
      updatedAt: new Date(cached.updatedAt).toISOString(),
    });
  }

  // Cold start: try to recover from Telegram pinned message
  if (chatId !== 'default') {
    const recovered = await recoverFromTelegram(chatId);
    if (recovered && recovered.length > 0) {
      STORE.set(chatId, { watchlist: recovered, updatedAt: Date.now() });
      return NextResponse.json({
        chatId,
        watchlist: recovered,
        count: recovered.length,
        source: 'telegram',
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Final fallback: DEFAULT_WATCHLIST
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
 * Persists to both in-memory AND Telegram (pinned message) for cold start recovery
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
      const current = STORE.get(chatId)?.watchlist || await recoverFromTelegram(chatId) || [...DEFAULT_WATCHLIST];
      const toAdd = body.symbols
        .map((s: string) => String(s).trim().toUpperCase())
        .filter((s: string) => s.length > 0 && /^[A-Z0-9&-]+$/.test(s));
      updated = [...new Set([...current, ...toAdd])];
    } else if (body.action === 'remove' && Array.isArray(body.symbols)) {
      const current = STORE.get(chatId)?.watchlist || await recoverFromTelegram(chatId) || [...DEFAULT_WATCHLIST];
      const toRemove = new Set(
        body.symbols.map((s: string) => String(s).trim().toUpperCase())
      );
      updated = current.filter((s: string) => !toRemove.has(s));
    } else {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Update in-memory store
    STORE.set(chatId, { watchlist: updated, updatedAt: Date.now() });

    // Persist to Telegram (async, don't await to keep response fast)
    if (chatId !== 'default') {
      persistAndPinToTelegram(chatId, updated).catch(e => console.error('[Watchlist] Background persist failed:', e));
    }

    return NextResponse.json({
      ok: true,
      chatId,
      watchlist: updated,
      count: updated.length,
      action: body.action || 'replace',
    });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
