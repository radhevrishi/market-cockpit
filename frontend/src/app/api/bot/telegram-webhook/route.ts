// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0522 — Telegram Bot Webhook (on-demand commands + inline buttons)
//
// Handles incoming /commands from Telegram users and callback_data taps
// from inline keyboard buttons. Lets the user pull EO BLOCKBUSTER/STRONG
// and other data instantly without waiting for the next cron.
//
// SETUP (one-time, run from browser or curl):
//   GET /api/bot/telegram-webhook?setup=1&secret=mc-bot-2026
//     → registers this URL as the webhook with Telegram + sets command menu
//
// TELEGRAM SLASH COMMANDS supported:
//   /start, /menu        — welcome + button keyboard
//   /blockbuster, /bb    — today + yesterday BLOCKBUSTER cards
//   /strong              — today + yesterday STRONG cards
//   /today               — top-tier cards for today only
//   /yesterday           — top-tier cards for yesterday only
//   /movers              — triggers existing movers-alert bot
//   /watchlist           — triggers existing watchlist-alert bot
//   /help                — list commands
//
// CALLBACK_DATA from inline buttons: same routing as slash commands.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN_EARNINGS ||
  process.env.TELEGRAM_BOT_TOKEN ||
  '';
const API_BASE = 'https://market-cockpit.vercel.app';
const SECRET = process.env.CRON_SECRET || 'mc-bot-2026';

// ─── Telegram helpers ──────────────────────────────────────────────────────

async function tgPost(method: string, body: any): Promise<any> {
  if (!BOT_TOKEN) return { ok: false, error: 'no_token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return await res.json();
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function sendMessage(
  chatId: string | number,
  text: string,
  opts: {
    parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    reply_markup?: any;
    disable_web_page_preview?: boolean;
  } = {},
): Promise<any> {
  return tgPost('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts.parse_mode || 'HTML',
    reply_markup: opts.reply_markup,
    disable_web_page_preview: opts.disable_web_page_preview ?? true,
  });
}

async function answerCallback(callbackId: string, text?: string): Promise<any> {
  return tgPost('answerCallbackQuery', { callback_query_id: callbackId, text: text || '⏳ Fetching…', show_alert: false });
}

// ─── Inline keyboards ──────────────────────────────────────────────────────

const MAIN_MENU_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '⭐ BLOCKBUSTER', callback_data: 'cmd:blockbuster' },
      { text: '🟢 STRONG', callback_data: 'cmd:strong' },
    ],
    [
      { text: '📅 Today only', callback_data: 'cmd:today' },
      { text: '📅 Yesterday', callback_data: 'cmd:yesterday' },
    ],
    [
      { text: '📈 Full Pulse', callback_data: 'cmd:pulse' },
      { text: '⭐ Watchlist', callback_data: 'cmd:pulse_watchlist' },
    ],
    [
      { text: '📰 News', callback_data: 'cmd:news' },
      { text: '📊 Indices', callback_data: 'cmd:indices' },
    ],
    [
      { text: '🔄 Refresh menu', callback_data: 'cmd:menu' },
      { text: '❓ Help', callback_data: 'cmd:help' },
    ],
  ],
};

// Quick-action keyboard attached after a results message
const POST_RESULTS_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🔄 Refresh', callback_data: 'cmd:blockbuster' },
      { text: '🟢 Add STRONG', callback_data: 'cmd:strong' },
    ],
    [{ text: '📋 Main menu', callback_data: 'cmd:menu' }],
  ],
};

// ─── Command handlers ──────────────────────────────────────────────────────

async function triggerEoAlert(
  chatId: string | number,
  tiers: string,
  dates?: string,
): Promise<void> {
  // Re-use the existing eo-blockbuster-alert endpoint with overrides.
  // force=1 bypasses dedup so on-demand requests always return results.
  // override_chat_id=X routes the messages back to THIS chat instead of
  // the default channel — that way /blockbuster from a DM responds in
  // that DM, not the broadcast channel.
  const params = new URLSearchParams({
    secret: SECRET,
    tiers,
    force: '1',
    override_chat_id: String(chatId),
  });
  if (dates) params.set('dates', dates);

  try {
    await fetch(`${API_BASE}/api/bot/eo-blockbuster-alert?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    await sendMessage(chatId, '⚠️ Fetch timed out. Try again in a moment.');
  }
}

// Legacy commands handled by /api/bot/movers-alert (POST) and
// /api/bot/watchlist-alert (POST). When the new central webhook receives
// these, forward the original Telegram update to those endpoints so the
// existing handlers can respond — preserves all existing behavior.
const LEGACY_MOVERS_COMMANDS = new Set([
  'pulse', 'gainers', 'losers', 'indices', 'news', 'status',
]);
const LEGACY_WATCHLIST_COMMANDS = new Set([
  'watch', 'unwatch', 'list', 'pulse_watchlist',
]);

async function forwardToLegacy(targetUrl: string, update: any): Promise<void> {
  try {
    await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    // Silent — the legacy handler logs its own errors
  }
}

async function dispatchCommand(
  chatId: string | number,
  cmd: string,
  originalUpdate?: any,
): Promise<void> {
  // Strip leading slash, then strip "@BotName" suffix, then lowercase + trim.
  // ("/watch TCS" → cmd is "/watch" here; arg is in original message text.)
  const cmdFirstWord = cmd.split(/\s+/)[0];
  const lower = cmdFirstWord.toLowerCase().replace(/^\//, '').split('@')[0].trim();

  if (lower === 'start' || lower === 'menu') {
    const text = [
      '<b>📊 Market Cockpit Bot</b>',
      '',
      'Tap a button below or send a command:',
      '',
      '<b>Earnings (new):</b>',
      '⭐ /blockbuster — top-tier earnings (last 2 days)',
      '🟢 /strong — strong beats (last 2 days)',
      '📅 /today / /yesterday — single-date filter',
      '',
      '<b>Market pulse:</b>',
      '📈 /pulse — full market snapshot',
      '📈 /gainers /losers /indices — pulse subsets',
      '📰 /news — market intelligence',
      '',
      '<b>Watchlist:</b>',
      '⭐ /pulse_watchlist — your tracked tickers',
      '➕ /watch SYMBOL — add to watchlist',
      '➖ /unwatch SYMBOL — remove from watchlist',
      '📋 /list — show current watchlist',
      '',
      '<i>Daily auto-broadcasts: 11:00 / 14:00 / 21:00 IST</i>',
    ].join('\n');
    await sendMessage(chatId, text, { reply_markup: MAIN_MENU_KEYBOARD });
    return;
  }

  if (lower === 'help') {
    const text = [
      '<b>🤖 Available commands</b>',
      '',
      '<b>Earnings (new):</b>',
      '/blockbuster — ⭐ today+yesterday top tier',
      '/bb — shortcut for /blockbuster',
      '/strong — 🟢 today+yesterday strong beats',
      '/today — top-tier cards filed today',
      '/yesterday — top-tier cards filed yesterday',
      '',
      '<b>Market pulse:</b>',
      '/pulse — full market snapshot',
      '/gainers — top gainers card',
      '/losers — top losers card',
      '/indices — NIFTY / MIDCAP / SMALL / VIX',
      '/news — market intelligence',
      '/status — bot status',
      '',
      '<b>Watchlist:</b>',
      '/pulse_watchlist — performance card',
      '/watch SYMBOL — add stocks (space-sep)',
      '/unwatch SYMBOL — remove a stock',
      '/list — show your watchlist',
      '',
      '/menu — button keyboard',
      '/help — this message',
    ].join('\n');
    await sendMessage(chatId, text, { reply_markup: MAIN_MENU_KEYBOARD });
    return;
  }

  if (lower === 'blockbuster' || lower === 'bb') {
    await sendMessage(chatId, '⏳ Fetching ⭐ BLOCKBUSTER for last 2 days…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER');
    await sendMessage(chatId, '✅ Done. Tap below for more:', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'strong') {
    await sendMessage(chatId, '⏳ Fetching 🟢 STRONG for last 2 days…');
    await triggerEoAlert(chatId, 'STRONG');
    await sendMessage(chatId, '✅ Done. Tap below for more:', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'today') {
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayIst = istNow.toISOString().slice(0, 10);
    await sendMessage(chatId, `⏳ Fetching top tier for ${todayIst}…`);
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', todayIst);
    await sendMessage(chatId, '✅ Done.', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'yesterday') {
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const yIst = new Date(istNow.getTime() - 86_400_000).toISOString().slice(0, 10);
    await sendMessage(chatId, `⏳ Fetching top tier for ${yIst}…`);
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', yIst);
    await sendMessage(chatId, '✅ Done.', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  // Inline-keyboard shortcuts — these came from the MAIN_MENU buttons and
  // map to the user's existing slash commands.
  if (lower === 'movers') {
    // Same as /pulse — full market snapshot via movers-alert
    if (originalUpdate) {
      await forwardToLegacy(`${API_BASE}/api/bot/movers-alert`, {
        ...originalUpdate,
        message: { ...(originalUpdate.message || {}), text: '/pulse', chat: { id: chatId } },
      });
    } else {
      await fetch(`${API_BASE}/api/bot/movers-alert?secret=${SECRET}&mode=full&override_chat_id=${chatId}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(55_000),
      }).catch(() => {});
    }
    return;
  }

  if (lower === 'watchlist') {
    // Same as /pulse on watchlist bot
    if (originalUpdate) {
      await forwardToLegacy(`${API_BASE}/api/bot/watchlist-alert`, {
        ...originalUpdate,
        message: { ...(originalUpdate.message || {}), text: '/pulse', chat: { id: chatId } },
      });
    } else {
      await fetch(`${API_BASE}/api/bot/watchlist-alert?secret=${SECRET}&mode=full&override_chat_id=${chatId}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(55_000),
      }).catch(() => {});
    }
    return;
  }

  // Legacy commands — forward the original Telegram update to the
  // route that already implements that command's POST handler. This
  // preserves /pulse, /gainers, /losers, /indices, /news, /status,
  // /watch, /unwatch, /list, /pulse_watchlist behavior.
  if (LEGACY_MOVERS_COMMANDS.has(lower)) {
    if (originalUpdate) {
      await forwardToLegacy(`${API_BASE}/api/bot/movers-alert`, originalUpdate);
    } else {
      await sendMessage(chatId, '⚠️ This command needs a fresh tap to work — try the slash command directly.');
    }
    return;
  }

  if (LEGACY_WATCHLIST_COMMANDS.has(lower)) {
    if (originalUpdate) {
      // /pulse_watchlist is exposed in our menu but the legacy handler
      // listens to /pulse — rewrite the text before forwarding.
      const rewriteText = lower === 'pulse_watchlist' ? '/pulse' : (originalUpdate.message?.text || `/${lower}`);
      await forwardToLegacy(`${API_BASE}/api/bot/watchlist-alert`, {
        ...originalUpdate,
        message: { ...(originalUpdate.message || {}), text: rewriteText, chat: { id: chatId } },
      });
    } else {
      await sendMessage(chatId, '⚠️ This command needs a fresh tap to work — try the slash command directly.');
    }
    return;
  }

  // Unknown command
  await sendMessage(chatId, `❓ Unknown command: /${lower}\n\nSend /menu or /help for available commands.`);
}

// ─── Main handler ──────────────────────────────────────────────────────────

// One-time setup: registers the webhook with Telegram + populates command menu
async function runSetup(): Promise<any> {
  const webhookUrl = `${API_BASE}/api/bot/telegram-webhook`;

  const setWebhookResult = await tgPost('setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });

  const setCommandsResult = await tgPost('setMyCommands', {
    commands: [
      { command: 'start', description: 'Welcome + menu' },
      { command: 'menu', description: 'Show button menu' },
      { command: 'blockbuster', description: '⭐ Top-tier earnings (2d)' },
      { command: 'bb', description: 'Shortcut for /blockbuster' },
      { command: 'strong', description: '🟢 Strong beats (2d)' },
      { command: 'today', description: 'Top tier filed today' },
      { command: 'yesterday', description: 'Top tier filed yesterday' },
      { command: 'pulse', description: '📈 Full market pulse' },
      { command: 'gainers', description: 'Top gainers card' },
      { command: 'losers', description: 'Top losers card' },
      { command: 'indices', description: 'NIFTY / MIDCAP / VIX snapshot' },
      { command: 'news', description: '📰 Market intelligence' },
      { command: 'pulse_watchlist', description: '⭐ Watchlist performance' },
      { command: 'watch', description: 'Add stocks to watchlist' },
      { command: 'unwatch', description: 'Remove a stock' },
      { command: 'list', description: 'Show your watchlist' },
      { command: 'status', description: 'Bot status' },
      { command: 'help', description: 'List all commands' },
    ],
  });

  return {
    status: 'ok',
    setWebhook: setWebhookResult,
    setCommands: setCommandsResult,
    webhook_url: webhookUrl,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('setup') === '1') {
    const provided = searchParams.get('secret') || '';
    if (provided !== SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const result = await runSetup();
    return NextResponse.json(result);
  }
  // Status / health check
  return NextResponse.json({
    status: 'ok',
    bot_configured: !!BOT_TOKEN,
    endpoint: `${API_BASE}/api/bot/telegram-webhook`,
    setup_instructions: 'Hit GET ?setup=1&secret=<CRON_SECRET> to register webhook with Telegram',
  });
}

export async function POST(req: Request) {
  let update: any = null;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Telegram callback_query — user tapped an inline button
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = String(cb.data || '');
    // Acknowledge tap immediately so the user sees ⏳
    await answerCallback(cb.id, '⏳ Working…');
    if (chatId && data.startsWith('cmd:')) {
      const cmd = data.slice(4);
      // Synthesize a message-style update for legacy-forward compatibility
      const synthetic = {
        message: {
          text: `/${cmd}`,
          chat: { id: chatId, first_name: cb.from?.first_name || '' },
          from: cb.from,
        },
      };
      // fire-and-forget so we return 200 to Telegram fast
      dispatchCommand(chatId, cmd, synthetic).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  // Telegram message — user typed a /command
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat?.id;
    const text = String(msg.text || '').trim();
    if (chatId && text.startsWith('/')) {
      // Pass full text (not just first word) so /watch SYMBOL args survive
      // the round-trip when forwarded to legacy POST handlers.
      dispatchCommand(chatId, text, update).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
