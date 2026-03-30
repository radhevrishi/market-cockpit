import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Config ──────────────────────────────────────────────────────────────
// MC Street Pulse bot (@mc_street_pulse_bot)
const TG_TOKEN = '8763736180:AAFZ96g_IMunKzwdkVacWLrfjl8fms1BdvY';
const TG_CHAT_ID = '5057319640'; // Radhev Rishi
const BOT_SECRET = 'mc-bot-2026';
const API_BASE = 'https://market-cockpit.vercel.app';

// ── NSE Direct Fetch ────────────────────────────────────────────────────
const NSE_BASE = 'https://www.nseindia.com';
const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Referer: 'https://www.nseindia.com/',
};

interface Stock {
  ticker: string;
  company: string;
  price: number;
  changePercent: number;
  change: number;
  cap: string;
}

interface Earning {
  symbol: string;
  company: string;
  quality: string;
  quarter: string;
  sector: string;
  price: number;
  movePercent: number;
}

async function getNseCookies(): Promise<string> {
  try {
    const r = await fetch(NSE_BASE, { headers: { 'User-Agent': NSE_HEADERS['User-Agent'] } });
    const setCookie = r.headers.getSetCookie?.() || [];
    return setCookie.map(c => c.split(';')[0]).join('; ');
  } catch { return ''; }
}

async function fetchNseIndex(indexName: string, cookies: string): Promise<any[]> {
  try {
    const url = `${NSE_BASE}/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`;
    const r = await fetch(url, {
      headers: { ...NSE_HEADERS, Cookie: cookies },
    });
    if (r.ok) {
      const json = await r.json();
      return json?.data || [];
    }
  } catch (e) {
    console.error(`NSE fetch ${indexName} failed:`, e);
  }
  return [];
}

async function fetchMovers(): Promise<{ total: number; gainers: Stock[]; losers: Stock[]; avgChange: number }> {
  const allStocks: Stock[] = [];
  const seen = new Set<string>();

  function addStock(s: any, capHint?: string) {
    const tk = (s.ticker || s.symbol || '').trim();
    if (!tk || tk.includes(' ') || tk.startsWith('NIFTY') || seen.has(tk)) return;
    if ((s.price || s.lastPrice || 0) <= 0) return;
    seen.add(tk);
    const grp = (s.indexGroup || capHint || '').toLowerCase();
    const cap = grp.includes('large') ? 'Large' : grp.includes('mid') ? 'Mid' : 'Sml';
    allStocks.push({
      ticker: tk,
      company: s.company || s.meta?.companyName || tk,
      price: s.price || s.lastPrice || 0,
      changePercent: Math.round((s.changePercent || s.pChange || 0) * 100) / 100,
      change: Math.round((s.change || 0) * 100) / 100,
      cap,
    });
  }

  // ── Step 1: Fetch full market (all stocks) — same endpoint the dashboard uses ──
  try {
    const url = `${API_BASE}/api/market/quotes?market=india`;
    console.log(`[BOT] Fetching ALL stocks: ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' } });
    console.log(`[BOT] All stocks: HTTP ${r.status}`);
    if (r.ok) {
      const data = await r.json();
      const stocks = data.stocks || [];
      console.log(`[BOT] All stocks: ${stocks.length} returned`);
      for (const s of stocks) addStock(s);
    }
  } catch (e) {
    console.error('[BOT] Full market fetch failed:', e);
  }

  // ── Step 2: If full fetch returned too few, top-up from specific indices ──
  if (allStocks.length < 50) {
    for (const idx of ['midsmall50', 'midcap150', 'smallcap150', 'nifty500']) {
      try {
        const url = `${API_BASE}/api/market/quotes?market=india&index=${idx}`;
        console.log(`[BOT] Top-up fetch: ${url}`);
        const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' } });
        if (r.ok) {
          const data = await r.json();
          for (const s of data.stocks || []) addStock(s);
        }
      } catch (e) {
        console.error(`[BOT] Index fetch ${idx} failed:`, e);
      }
    }
  }

  // ── Step 3: NSE direct fallback if API returned nothing ──
  if (allStocks.length === 0) {
    const cookies = await getNseCookies();
    if (cookies) {
      const indices = [
        { name: 'NIFTY 500', label: '' },
        { name: 'NIFTY MIDCAP 150', label: 'Mid' },
        { name: 'NIFTY SMLCAP 250', label: 'Sml' },
      ];
      for (const { name, label } of indices) {
        const data = await fetchNseIndex(name, cookies);
        for (const item of data) addStock(item, label);
      }
    }
  }

  // Sort gainers descending (biggest % gain first), losers ascending (biggest % loss first)
  const gainers = allStocks
    .filter(s => s.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent);
  const losers = allStocks
    .filter(s => s.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent);
  const avg = allStocks.length > 0
    ? Math.round(allStocks.reduce((sum, s) => sum + s.changePercent, 0) / allStocks.length * 100) / 100
    : 0;

  console.log(`[BOT] Final: ${allStocks.length} stocks, top gainer ${gainers[0]?.ticker} +${gainers[0]?.changePercent}%, top loser ${losers[0]?.ticker} ${losers[0]?.changePercent}%`);

  // Return top 20 of each so buildMessage has full coverage
  return { total: allStocks.length, gainers: gainers.slice(0, 20), losers: losers.slice(0, 20), avgChange: avg };
}

async function fetchEarningsPulse(): Promise<Earning[]> {
  try {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const r = await fetch(`${API_BASE}/api/market/earnings?month=${monthStr}`, {
      headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' },
    });
    if (r.ok) {
      const data = await r.json();
      const results = data.results || data.earnings || [];
      return results
        .filter((e: any) => (e.cmp || e.price || 0) > 0 && (e.quality === 'Excellent' || e.quality === 'Great'))
        .slice(0, 10)
        .map((e: any) => ({
          symbol: e.ticker || e.symbol || '',
          company: e.company || e.companyName || '',
          quality: e.quality || '-',
          quarter: e.quarter || e.period || '-',
          sector: e.sector || 'Other',
          price: e.cmp || e.currentPrice || e.price || 0,
          movePercent: e.priceMove || e.movePercent || 0,
        }));
    }
  } catch (e) {
    console.error('Earnings fetch failed:', e);
  }
  return [];
}

// HTML-escape helper — required for HTML parse mode
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildMessage(movers: Awaited<ReturnType<typeof fetchMovers>>, earnings: Earning[]): string {
  const now = new Date();
  // IST = UTC+5:30
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = ist.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  const { total, gainers, losers, avgChange } = movers;
  const mood = avgChange > 0.5 ? 'BULLISH' : avgChange < -0.5 ? 'BEARISH' : 'MIXED';
  const moodEmoji = mood === 'BULLISH' ? '\u{1F680}' : mood === 'BEARISH' ? '\u{1F327}' : '\u2696\uFE0F';
  const avgEmoji = avgChange >= 0 ? '\u{1F7E2}' : '\u{1F534}';
  const DIV = '\u2500'.repeat(24);

  const lines: string[] = [];

  // ── Header ──
  lines.push(`\u{1F4CA} <b>Market Cockpit</b>`);
  lines.push(`<b>Mid &amp; Small Cap Pulse</b>`);
  lines.push(`\u{1F4C5} ${esc(dateStr)}   \u{1F552} ${timeStr} IST`);
  lines.push('');

  // ── Mood ──
  lines.push(`${moodEmoji} <b>Market: ${mood}</b>`);
  lines.push(`${avgEmoji} Avg <b>${avgChange > 0 ? '+' : ''}${avgChange}%</b>   \u{1F4C8} <b>${total}</b> stocks tracked`);

  // ── Gainers ── (top 13, sorted biggest % gain first)
  if (gainers.length > 0) {
    lines.push('');
    lines.push(DIV);
    lines.push('');
    lines.push(`\u{1F4C8} <b>TOP GAINERS</b>  <i>(by % gain)</i>`);
    lines.push('');
    for (let i = 0; i < Math.min(13, gainers.length); i++) {
      const g = gainers[i];
      const price = g.price > 0 ? `\u20B9${g.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      const capLabel = esc(g.cap === 'Large' ? 'Lrg' : g.cap === 'Mid' ? 'Mid' : 'Sml');
      lines.push(`  ${i + 1}. <b>${esc(g.ticker)}</b>   <b>+${g.changePercent.toFixed(1)}%</b>   ${price}   <i>${capLabel}</i>`);
    }
  }

  // ── Losers ── (top 13, sorted biggest % loss first)
  if (losers.length > 0) {
    lines.push('');
    lines.push(DIV);
    lines.push('');
    lines.push(`\u{1F4C9} <b>TOP LOSERS</b>  <i>(by % loss)</i>`);
    lines.push('');
    for (let i = 0; i < Math.min(13, losers.length); i++) {
      const l = losers[i];
      const price = l.price > 0 ? `\u20B9${l.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      const capLabel = esc(l.cap === 'Large' ? 'Lrg' : l.cap === 'Mid' ? 'Mid' : 'Sml');
      lines.push(`  ${i + 1}. <b>${esc(l.ticker)}</b>   <b>${l.changePercent.toFixed(1)}%</b>   ${price}   <i>${capLabel}</i>`);
    }
  }

  // ── Extreme Movers (≥8%) ── highlight any stock with outsized move
  const extremeUp = gainers.filter(g => g.changePercent >= 8);
  const extremeDown = losers.filter(l => l.changePercent <= -8);
  if (extremeUp.length > 0 || extremeDown.length > 0) {
    lines.push('');
    lines.push(DIV);
    lines.push('');
    lines.push(`\u{1F525} <b>CIRCUIT BREAKERS  (\u22658%)</b>`);
    lines.push('');
    for (const s of extremeUp) {
      lines.push(`  \u{1F7E2} <b>${esc(s.ticker)}</b>  <b>+${s.changePercent.toFixed(1)}%</b>  \u20B9${s.price > 0 ? s.price.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : ''}  <i>${esc(s.cap)}</i>`);
    }
    for (const s of extremeDown) {
      lines.push(`  \u{1F534} <b>${esc(s.ticker)}</b>  <b>${s.changePercent.toFixed(1)}%</b>  \u20B9${s.price > 0 ? s.price.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : ''}  <i>${esc(s.cap)}</i>`);
    }
  }

  // ── Earnings Pulse ──
  if (earnings.length > 0) {
    lines.push('');
    lines.push(DIV);
    lines.push('');
    lines.push(`\u{1F4B0} <b>EARNINGS PULSE</b>`);
    lines.push(`<i>Top Quality Results This Month</i>`);
    lines.push('');
    for (const e of earnings.slice(0, 8)) {
      const qualEmoji = e.quality === 'Excellent' ? '\u2B50' : '\u2705';
      const mv = e.movePercent !== 0 ? `   <b>${e.movePercent > 0 ? '+' : ''}${e.movePercent.toFixed(1)}%</b>` : '';
      lines.push(`  ${qualEmoji} <b>${esc(e.symbol)}</b>  ${esc(e.quality)}  <i>${esc(e.quarter)}</i>${mv}`);
    }
  }

  // ── Footer ──
  lines.push('');
  lines.push(DIV);
  lines.push('');
  lines.push(`\u{1F310} <a href="https://market-cockpit.vercel.app/movers">Open Dashboard</a>`);
  lines.push(`<i>Powered by Market Cockpit</i>`);

  return lines.join('\n');
}

async function sendTelegram(text: string): Promise<{ ok: boolean; telegramResponse?: any; error?: string }> {
  const tgUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  console.log(`[BOT] Sending to Telegram chat=${TG_CHAT_ID}, token ends=...${TG_TOKEN.slice(-6)}, msg length=${text.length}`);
  try {
    const r = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const responseText = await r.text();
    console.log(`[BOT] Telegram HTTP ${r.status}: ${responseText.slice(0, 500)}`);
    let result: any;
    try { result = JSON.parse(responseText); } catch { result = { ok: false, raw: responseText }; }
    if (!result.ok) {
      return { ok: false, telegramResponse: result, error: `Telegram returned ok=false: ${result.description || responseText.slice(0, 200)}` };
    }
    return { ok: true, telegramResponse: { ok: true, message_id: result.result?.message_id } };
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    console.error(`[BOT] Telegram send EXCEPTION: ${errMsg}`);
    return { ok: false, error: `Fetch exception: ${errMsg}` };
  }
}

// ── Telegram Webhook Handler (commands) ─────────────────────────────────
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body?.message;
    if (!message?.text || !message?.chat?.id) {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const firstName = message.chat.first_name || 'there';

    // Handle commands (all using HTML parse mode)
    if (text === '/start') {
      await sendTelegramTo(chatId,
        `🚀 <b>MC Street Pulse — Connected!</b>\n\nWelcome ${esc(firstName)}! Your market intelligence bot is live.\n\n📊 <b>What you'll receive:</b>\n• Mid &amp; small cap movers (gainers/losers)\n• Earnings pulse (top quality results)\n• Big movers alerts (4%+ moves)\n• Market mood indicator\n\n⏰ <b>Schedule:</b> 10:05 AM &amp; 3:05 PM IST (Mon–Fri)\n\n💡 <b>Commands:</b>\n/pulse — Get live pulse right now\n/gainers — Top gainers only\n/losers — Top losers only\n/status — Bot status &amp; next alert\n/help — Show all commands\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `❓ <b>MC Street Pulse — Help</b>\n\n<b>Commands:</b>\n/start — Welcome message &amp; setup\n/pulse — Full market pulse (movers + earnings)\n/gainers — Top mid &amp; small cap gainers\n/losers — Top mid &amp; small cap losers\n/status — Bot status &amp; next scheduled alert\n/help — This help message\n\n<b>Automatic Alerts:</b>\n⏰ 10:05 AM IST — Morning pulse\n⏰ 3:05 PM IST — Afternoon pulse\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Full Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching live market data...</i>');
      const [movers, earnings] = await Promise.all([fetchMovers(), fetchEarningsPulse()]);
      if (movers.total === 0) {
        await sendTelegramTo(chatId, '📊 Market is closed or data unavailable. Try during market hours (9:15 AM – 3:30 PM IST).');
      } else {
        const msg = buildMessage(movers, earnings);
        await sendTelegramTo(chatId, msg);
      }
    } else if (text === '/gainers') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching gainers...</i>');
      const movers = await fetchMovers();
      if (movers.gainers.length === 0) {
        await sendTelegramTo(chatId, '📊 No gainers data available. Market may be closed.');
      } else {
        const lines = [`📈 <b>TOP MID &amp; SMALL CAP GAINERS</b>\n`];
        for (let i = 0; i < Math.min(15, movers.gainers.length); i++) {
          const g = movers.gainers[i];
          const price = g.price > 0 ? `₹${g.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
          lines.push(`  ${i + 1}. <b>${esc(g.ticker)}</b>   <b>+${g.changePercent.toFixed(1)}%</b>   ${price}   <i>${g.cap === 'Mid' ? 'Mid' : 'Sml'}</i>`);
        }
        lines.push(`\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Dashboard</a>`);
        await sendTelegramTo(chatId, lines.join('\n'));
      }
    } else if (text === '/losers') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching losers...</i>');
      const movers = await fetchMovers();
      if (movers.losers.length === 0) {
        await sendTelegramTo(chatId, '📊 No losers data available. Market may be closed.');
      } else {
        const lines = [`📉 <b>TOP MID &amp; SMALL CAP LOSERS</b>\n`];
        for (let i = 0; i < Math.min(15, movers.losers.length); i++) {
          const l = movers.losers[i];
          const price = l.price > 0 ? `₹${l.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
          lines.push(`  ${i + 1}. <b>${esc(l.ticker)}</b>   <b>${l.changePercent.toFixed(1)}%</b>   ${price}   <i>${l.cap === 'Mid' ? 'Mid' : 'Sml'}</i>`);
        }
        lines.push(`\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Dashboard</a>`);
        await sendTelegramTo(chatId, lines.join('\n'));
      }
    } else if (text === '/status') {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const h = ist.getHours();
      const day = ist.getDay();
      const isMarketDay = day >= 1 && day <= 5;
      const isMarketHours = h >= 9 && h < 16;
      const nextAlert = h < 10 ? '10:05 AM' : h < 15 ? '3:05 PM' : 'Tomorrow 10:05 AM';

      await sendTelegramTo(chatId,
        `⚙️ <b>MC Street Pulse — Status</b>\n\n✅ Bot: Online\n🕒 IST: ${ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n${isMarketDay && isMarketHours ? '🟢 Market: Open' : '🔴 Market: Closed'}\n⏰ Next Alert: ${isMarketDay ? nextAlert : 'Monday 10:05 AM'}\n\n<i>Alerts run Mon–Fri at 10:05 AM &amp; 3:05 PM IST</i>`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[BOT] Webhook error:', e);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

async function sendTelegramTo(chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error(`[BOT] sendTelegramTo ${chatId} failed:`, e);
  }
}

// ── Scheduled Alert Handler (GET) ───────────────────────────────────────
export async function GET(request: Request) {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = { timestamp: new Date().toISOString(), steps: [] };

  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  console.log(`[BOT] Incoming request: mode=${searchParams.get('mode')}, secret=${secret ? 'provided' : 'missing'}`);
  diagnostics.steps.push('request_received');

  // Auth check
  if (secret !== BOT_SECRET) {
    console.log(`[BOT] Auth failed: expected=${BOT_SECRET}, got=${secret}`);
    return NextResponse.json({ error: 'Unauthorized', hint: 'Add ?secret=mc-bot-2026 to the URL' }, { status: 401 });
  }
  diagnostics.steps.push('auth_passed');

  const mode = searchParams.get('mode') || 'full'; // full | test | diag

  // Diagnostic mode — just checks connectivity, no Telegram send
  if (mode === 'diag') {
    diagnostics.config = {
      tokenSet: !!TG_TOKEN && TG_TOKEN.length > 10,
      tokenEnds: TG_TOKEN.slice(-6),
      chatId: TG_CHAT_ID,
      apiBase: API_BASE,
    };
    return NextResponse.json({ ok: true, mode: 'diag', diagnostics, elapsed: Date.now() - startTime });
  }

  if (mode === 'test') {
    diagnostics.steps.push('sending_test_message');
    const result = await sendTelegram(
      '\u{2705} *Market Cockpit Bot Connected*\n\nAlerts are working! You\'ll receive mid & small cap movers + earnings pulse twice daily during market hours.\n\n\u{1F310} [View Dashboard](https://market-cockpit.vercel.app/movers)'
    );
    diagnostics.steps.push(result.ok ? 'test_sent_ok' : 'test_send_failed');
    return NextResponse.json({
      ok: result.ok,
      mode: 'test',
      telegramResponse: result.telegramResponse,
      error: result.error,
      diagnostics,
      elapsed: Date.now() - startTime,
    });
  }

  // ── Full mode: fetch data + send ──
  console.log('[BOT] Full mode: fetching movers + earnings...');
  diagnostics.steps.push('fetching_data');

  const [movers, earnings] = await Promise.all([
    fetchMovers().catch(e => {
      console.error('[BOT] fetchMovers failed:', e);
      diagnostics.moversError = String(e);
      return { total: 0, gainers: [] as Stock[], losers: [] as Stock[], avgChange: 0 };
    }),
    fetchEarningsPulse().catch(e => {
      console.error('[BOT] fetchEarningsPulse failed:', e);
      diagnostics.earningsError = String(e);
      return [] as Earning[];
    }),
  ]);

  diagnostics.steps.push('data_fetched');
  diagnostics.data = { moversTotal: movers.total, gainers: movers.gainers.length, losers: movers.losers.length, earnings: earnings.length };
  console.log(`[BOT] Data: ${movers.total} movers, ${movers.gainers.length} gainers, ${movers.losers.length} losers, ${earnings.length} earnings`);

  if (movers.total === 0 && earnings.length === 0) {
    diagnostics.steps.push('no_data_sending_closed_msg');
    const result = await sendTelegram(
      '\u{1F4CA} *Market Cockpit*\n\nMarket is closed or data unavailable.\n\n_Next alert during market hours._'
    );
    return NextResponse.json({
      ok: result.ok,
      status: 'no-data',
      telegramResponse: result.telegramResponse,
      error: result.error,
      diagnostics,
      elapsed: Date.now() - startTime,
    });
  }

  const msg = buildMessage(movers, earnings);
  diagnostics.steps.push('message_built');
  diagnostics.messageLength = msg.length;

  const result = await sendTelegram(msg);
  diagnostics.steps.push(result.ok ? 'telegram_sent_ok' : 'telegram_send_failed');

  return NextResponse.json({
    ok: result.ok,
    movers: movers.total,
    gainers: movers.gainers.length,
    losers: movers.losers.length,
    earnings: earnings.length,
    avgChange: movers.avgChange,
    telegramResponse: result.telegramResponse,
    error: result.error,
    diagnostics,
    elapsed: Date.now() - startTime,
  });
}
