// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0522 — Telegram Bot Webhook (on-demand commands + inline buttons)
//
// Handles incoming /commands from Telegram users and callback_data taps
// from inline keyboard buttons. Lets the user pull EO BLOCKBUSTER/STRONG
// and other data instantly without waiting for the next cron.
//
// SETUP (one-time, run from browser or curl):
//   GET /api/bot/telegram-webhook?setup=1&secret=<CRON_SECRET>
//     → registers this URL as the webhook with Telegram + sets command menu
//   CRON_SECRET MUST be set in Vercel env — no hardcoded fallback.
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
// PATCH 0715 — centralized IST helpers.
import { istToday as _istToday, istNow as _istNow } from '@/lib/market-hours';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN_EARNINGS ||
  process.env.TELEGRAM_BOT_TOKEN ||
  '';
const API_BASE = 'https://market-cockpit.vercel.app';
// CRON_SECRET MUST be set in Vercel env — no hardcoded fallback (security).
const SECRET = process.env.CRON_SECRET || '';

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
      { text: '📋 SUMMARY 2d', callback_data: 'cmd:summary' },
      { text: '📋 SUMMARY 3d', callback_data: 'cmd:summary3' },
      { text: '📋 SUMMARY 7d', callback_data: 'cmd:summary7' },
    ],
    [
      { text: '⭐ BB cards (2d)', callback_data: 'cmd:blockbuster' },
      { text: '🟢 STRONG cards', callback_data: 'cmd:strong' },
    ],
    [
      { text: '📅 Today', callback_data: 'cmd:today' },
      { text: '📅 Yesterday', callback_data: 'cmd:yesterday' },
    ],
    [
      { text: '🗓 Cards 3d', callback_data: 'cmd:last3' },
      { text: '🗓 Cards 5d', callback_data: 'cmd:last5' },
      { text: '🗓 Cards 7d', callback_data: 'cmd:week' },
    ],
    [
      { text: '📈 Market Pulse', callback_data: 'cmd:pulse' },
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

// Quick-action keyboard attached after card-mode results message
const POST_RESULTS_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '📋 Summary 2d', callback_data: 'cmd:summary' },
      { text: '📋 Summary 3d', callback_data: 'cmd:summary3' },
    ],
    [
      { text: '⭐ BB (2d)', callback_data: 'cmd:blockbuster' },
      { text: '🟢 STRONG', callback_data: 'cmd:strong' },
      { text: '🗓 Last 3d', callback_data: 'cmd:last3' },
    ],
    [{ text: '📋 Main menu', callback_data: 'cmd:menu' }],
  ],
};

// Quick-action keyboard attached after the summary card — lets the user
// switch the scope window without leaving the message thread.
const SUMMARY_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🗓 2d', callback_data: 'cmd:summary' },
      { text: '🗓 3d', callback_data: 'cmd:summary3' },
      { text: '🗓 5d', callback_data: 'cmd:summary5' },
      { text: '🗓 7d', callback_data: 'cmd:summary7' },
    ],
    [
      { text: '⭐ BB cards', callback_data: 'cmd:blockbuster' },
      { text: '🟢 STRONG cards', callback_data: 'cmd:strong' },
    ],
    [{ text: '📋 Main menu', callback_data: 'cmd:menu' }],
  ],
};

// ─── Command handlers ──────────────────────────────────────────────────────

async function triggerEoAlert(
  chatId: string | number,
  tiers: string,
  opts: { dates?: string; days?: number; mode?: 'cards' | 'summary' } = {},
): Promise<void> {
  // Re-use the existing eo-blockbuster-alert endpoint with overrides.
  // force=1 bypasses dedup so on-demand requests always return results.
  // override_chat_id=X routes the messages back to THIS chat instead of
  // the default channel — that way /blockbuster from a DM responds in
  // that DM, not the broadcast channel.
  // mode=summary returns ONE consolidated message (BB + STRONG combined).
  const params = new URLSearchParams({
    secret: SECRET,
    tiers,
    force: '1',
    override_chat_id: String(chatId),
  });
  if (opts.dates) params.set('dates', opts.dates);
  if (opts.days) params.set('days', String(opts.days));
  if (opts.mode) params.set('mode', opts.mode);

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
      '<b>📊 MARKET COCKPIT BOT</b>',
      '<i>Institutional earnings intelligence · on-demand</i>',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '<b>📋 SUMMARY (recommended — one card)</b>',
      '/summary — 2-day snapshot (BB + STRONG)',
      '/summary3 — 3-day snapshot',
      '/summary5 — 5-day snapshot',
      '/summary7 — 7-day snapshot',
      '',
      '<b>⭐ INDIVIDUAL CARDS (deep detail)</b>',
      '/blockbuster — BB cards · last 2d',
      '/strong — STRONG cards · last 2d',
      '/today /yesterday — single-date filter',
      '/last3 /last5 /week — wider card scope',
      '',
      '<b>📈 MARKET PULSE</b>',
      '/pulse · /gainers · /losers · /indices · /news',
      '',
      '<b>⭐ WATCHLIST</b>',
      '/pulse_watchlist · /watch · /unwatch · /list',
      '',
      '<i>Daily auto-broadcasts: 11:00 / 14:00 / 21:00 IST</i>',
    ].join('\n');
    await sendMessage(chatId, text, { reply_markup: MAIN_MENU_KEYBOARD });
    return;
  }

  if (lower === 'help') {
    const text = [
      '<b>🤖 COMMAND REFERENCE</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '<b>📋 Earnings Summary (one card)</b>',
      '/summary    — 2-day BB + STRONG snapshot',
      '/summary3   — 3-day snapshot',
      '/summary5   — 5-day snapshot',
      '/summary7   — 7-day snapshot',
      '',
      '<b>⭐ Earnings Cards (per-stock detail)</b>',
      '/blockbuster /bb — ⭐ BB cards (2d)',
      '/strong          — 🟢 STRONG cards (2d)',
      '/today           — top tier filed today',
      '/yesterday       — filed yesterday',
      '/last3 /last5 /week — wider card scope',
      '',
      '<b>📈 Market Pulse</b>',
      '/pulse — full snapshot',
      '/gainers · /losers · /indices',
      '/news · /status',
      '',
      '<b>⭐ Watchlist</b>',
      '/pulse_watchlist · /watch · /unwatch · /list',
      '',
      '/menu — button keyboard · /help — this',
    ].join('\n');
    await sendMessage(chatId, text, { reply_markup: MAIN_MENU_KEYBOARD });
    return;
  }

  // ═════ SUMMARY commands — one consolidated card (BB + STRONG combined) ═════
  if (lower === 'summary' || lower === 'summary2' || lower === 'summary2d') {
    await sendMessage(chatId, '⏳ Generating institutional summary · <b>last 2 days</b>…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { days: 2, mode: 'summary' });
    await sendMessage(chatId, '<i>Switch scope or open dashboard:</i>', { reply_markup: SUMMARY_KEYBOARD });
    return;
  }

  if (lower === 'summary3' || lower === 'summary3d') {
    await sendMessage(chatId, '⏳ Generating institutional summary · <b>last 3 days</b>…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { days: 3, mode: 'summary' });
    await sendMessage(chatId, '<i>Switch scope or open dashboard:</i>', { reply_markup: SUMMARY_KEYBOARD });
    return;
  }

  if (lower === 'summary5' || lower === 'summary5d') {
    await sendMessage(chatId, '⏳ Generating institutional summary · <b>last 5 days</b>…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { days: 5, mode: 'summary' });
    await sendMessage(chatId, '<i>Switch scope or open dashboard:</i>', { reply_markup: SUMMARY_KEYBOARD });
    return;
  }

  if (lower === 'summary7' || lower === 'summary7d' || lower === 'weeksummary') {
    await sendMessage(chatId, '⏳ Generating institutional summary · <b>last 7 days</b>…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { days: 7, mode: 'summary' });
    await sendMessage(chatId, '<i>Switch scope or open dashboard:</i>', { reply_markup: SUMMARY_KEYBOARD });
    return;
  }

  if (lower === 'blockbuster' || lower === 'bb') {
    await sendMessage(chatId, '⏳ Scanning ⭐ <b>BLOCKBUSTER</b> tier · last 2 days…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER');
    await sendMessage(chatId, '<i>More options below:</i>', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'strong') {
    await sendMessage(chatId, '⏳ Scanning 🟢 <b>STRONG</b> tier · last 2 days…');
    await triggerEoAlert(chatId, 'STRONG');
    await sendMessage(chatId, '<i>More options below:</i>', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'today') {
    // PATCH 0715 — centralized via _istToday.
    const todayIst = _istToday();
    await sendMessage(chatId, `⏳ Scanning top tier · <b>${todayIst}</b> only…`);
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { dates: todayIst });
    await sendMessage(chatId, '<i>More options below:</i>', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'yesterday') {
    // PATCH 0715 — centralized via _istNow.
    const istNowVal = _istNow();
    const yIst = new Date(istNowVal.getTime() - 86_400_000).toISOString().slice(0, 10);
    await sendMessage(chatId, `⏳ Scanning top tier · <b>${yIst}</b> only…`);
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { dates: yIst });
    await sendMessage(chatId, '<i>More options below:</i>', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'last3' || lower === 'last3days' || lower === '3days') {
    await sendMessage(chatId, '⏳ Scanning top tier · <b>last 3 days</b>…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { days: 3 });
    await sendMessage(chatId, '<i>More options below:</i>', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'last5' || lower === 'last5days' || lower === '5days') {
    await sendMessage(chatId, '⏳ Scanning top tier · <b>last 5 days</b>…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { days: 5 });
    await sendMessage(chatId, '<i>More options below:</i>', { reply_markup: POST_RESULTS_KEYBOARD });
    return;
  }

  if (lower === 'week' || lower === 'last7') {
    await sendMessage(chatId, '⏳ Scanning top tier · <b>last 7 days</b>…');
    await triggerEoAlert(chatId, 'BLOCKBUSTER,STRONG', { days: 7 });
    await sendMessage(chatId, '<i>More options below:</i>', { reply_markup: POST_RESULTS_KEYBOARD });
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

  // PATCH 1073 — /portfolio, /news <ticker>, /scorecard <ticker>
  // Lightweight on-demand commands wired into existing dashboard endpoints.
  // Each command is fail-soft: if the backend returns an error we send a
  // single message explaining and bail rather than rethrowing.
  if (lower === 'portfolio') {
    try {
      const r = await fetch(`${API_BASE}/api/v1/portfolio?secret=${SECRET}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (!r.ok) { await sendMessage(chatId, `⚠️ Portfolio: HTTP ${r.status}`); return; }
      const j: any = await r.json().catch(() => ({}));
      const positions: any[] = Array.isArray(j.positions) ? j.positions : Array.isArray(j.rows) ? j.rows : [];
      if (positions.length === 0) {
        await sendMessage(chatId, '📦 No open positions found.');
        return;
      }
      const top = positions.slice(0, 8);
      const lines = ['<b>💼 Portfolio — top 8</b>'];
      for (const p of top) {
        const tk = String(p.ticker || p.symbol || '').toUpperCase();
        const pnl = typeof p.pnlPct === 'number' ? p.pnlPct : Number(p.pnl_pct || 0);
        const sign = pnl >= 0 ? '+' : '';
        lines.push(`<code>${tk.padEnd(12, ' ')}</code> ${sign}${pnl.toFixed(2)}%`);
      }
      await sendMessage(chatId, lines.join('\n'));
    } catch (e: any) {
      await sendMessage(chatId, `⚠️ Portfolio error: ${String(e?.message || e).slice(0, 200)}`);
    }
    return;
  }

  if (lower === 'news') {
    // Original update message has the full "/news SHAILY" — pluck the ticker.
    const fullText = String(originalUpdate?.message?.text || cmd || '');
    const arg = fullText.split(/\s+/).slice(1).join(' ').trim();
    if (!arg) {
      await sendMessage(chatId, '📰 Usage: <code>/news TICKER</code>  (e.g. <code>/news SHAILY</code>)');
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/api/v1/news?query=${encodeURIComponent(arg)}&limit=5`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!r.ok) { await sendMessage(chatId, `⚠️ News: HTTP ${r.status}`); return; }
      const j: any = await r.json().catch(() => ([]));
      const items: any[] = Array.isArray(j) ? j : (j.articles || []);
      if (items.length === 0) {
        await sendMessage(chatId, `📰 No recent news for <b>${arg.toUpperCase()}</b>.`);
        return;
      }
      const lines = [`<b>📰 News — ${arg.toUpperCase()}</b>`];
      for (const a of items.slice(0, 5)) {
        const title = String(a.title || '').slice(0, 120);
        const url = String(a.url || '#');
        lines.push(`• <a href="${url}">${title}</a>`);
      }
      await sendMessage(chatId, lines.join('\n'), { disable_web_page_preview: true });
    } catch (e: any) {
      await sendMessage(chatId, `⚠️ News error: ${String(e?.message || e).slice(0, 200)}`);
    }
    return;
  }

  if (lower === 'scorecard' || lower === 'sheet' || lower === 'stock') {
    const fullText = String(originalUpdate?.message?.text || cmd || '');
    const arg = fullText.split(/\s+/).slice(1).join(' ').trim().toUpperCase();
    if (!arg) {
      await sendMessage(chatId, `🎯 Usage: <code>/scorecard TICKER</code>`);
      return;
    }
    // No dedicated API yet — link to the stock sheet on the portal.
    const url = `${API_BASE}/stock-sheet?ticker=${encodeURIComponent(arg)}`;
    await sendMessage(
      chatId,
      `<b>🎯 ${arg} scorecard</b>\n<a href="${url}">Open on portal</a>`,
      { disable_web_page_preview: false },
    );
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
      { command: 'summary', description: '📋 Summary 2d (BB + STRONG)' },
      { command: 'summary3', description: '📋 Summary 3d (BB + STRONG)' },
      { command: 'summary5', description: '📋 Summary 5d (BB + STRONG)' },
      { command: 'summary7', description: '📋 Summary 7d (BB + STRONG)' },
      { command: 'blockbuster', description: '⭐ Top-tier earnings (2d)' },
      { command: 'bb', description: 'Shortcut for /blockbuster' },
      { command: 'strong', description: '🟢 Strong beats (2d)' },
      { command: 'today', description: 'Top tier filed today' },
      { command: 'yesterday', description: 'Top tier filed yesterday' },
      { command: 'last3', description: '🗓 Top tier last 3 days' },
      { command: 'last5', description: '🗓 Top tier last 5 days' },
      { command: 'week', description: '🗓 Top tier last 7 days' },
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
      // AWAIT the work — fire-and-forget gets killed by Vercel the
      // moment we return 200, so the actual fetch never completes.
      // Telegram allows up to ~60s for webhook response and we set
      // maxDuration = 60 above. Wrap in try/catch so a failure inside
      // the dispatcher still returns 200 to Telegram (no retry storm).
      try {
        await dispatchCommand(chatId, cmd, synthetic);
      } catch (e) {
        try { await sendMessage(chatId, `⚠️ Error: ${String(e).slice(0, 200)}`); } catch {}
      }
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
      try {
        await dispatchCommand(chatId, text, update);
      } catch (e) {
        try { await sendMessage(chatId, `⚠️ Error: ${String(e).slice(0, 200)}`); } catch {}
      }
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
