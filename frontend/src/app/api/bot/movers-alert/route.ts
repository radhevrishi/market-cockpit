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
  // Try our own API first (self-referencing on Vercel — this is fine)
  const allStocks: Stock[] = [];
  const seen = new Set<string>();

  for (const idx of ['midsmall50', 'smallcap150', 'midcap150']) {
    try {
      const url = `${API_BASE}/api/market/quotes?market=india&index=${idx}`;
      console.log(`[BOT] Fetching movers: ${url}`);
      const r = await fetch(url, {
        headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' },
      });
      console.log(`[BOT] Movers ${idx}: HTTP ${r.status}`);
      if (r.ok) {
        const data = await r.json();
        console.log(`[BOT] Movers ${idx}: ${(data.stocks || []).length} stocks`);
        for (const s of data.stocks || []) {
          const tk = s.ticker || '';
          if (tk && !seen.has(tk)) {
            seen.add(tk);
            const grp = (s.indexGroup || '').toLowerCase();
            allStocks.push({
              ticker: tk,
              company: s.company || tk,
              price: s.price || 0,
              changePercent: Math.round((s.changePercent || 0) * 100) / 100,
              change: Math.round((s.change || 0) * 100) / 100,
              cap: grp.includes('mid') ? 'Mid' : 'Sml',
            });
          }
        }
      }
    } catch (e) {
      console.error(`API fetch ${idx} failed:`, e);
    }
  }

  // Fallback to NSE direct if API returned nothing
  if (allStocks.length === 0) {
    const cookies = await getNseCookies();
    if (cookies) {
      const indices = [
        { name: 'NIFTY MIDCAP 50', label: 'Mid' },
        { name: 'NIFTY MIDCAP 100', label: 'Mid' },
        { name: 'NIFTY SMLCAP 50', label: 'Sml' },
        { name: 'NIFTY SMLCAP 100', label: 'Sml' },
      ];
      for (const { name, label } of indices) {
        const data = await fetchNseIndex(name, cookies);
        for (const item of data) {
          const sym = item.symbol || '';
          if (!sym || sym.includes(' ') || seen.has(sym)) continue;
          seen.add(sym);
          allStocks.push({
            ticker: sym,
            company: item.meta?.companyName || sym,
            price: item.lastPrice || 0,
            changePercent: Math.round((item.pChange || 0) * 100) / 100,
            change: Math.round((typeof item.change === 'number' ? item.change : 0) * 100) / 100,
            cap: label,
          });
        }
      }
    }
  }

  const gainers = allStocks.filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);
  const losers = allStocks.filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);
  const avg = allStocks.length > 0
    ? Math.round(allStocks.reduce((sum, s) => sum + s.changePercent, 0) / allStocks.length * 100) / 100
    : 0;

  return { total: allStocks.length, gainers: gainers.slice(0, 15), losers: losers.slice(0, 15), avgChange: avg };
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

function buildMessage(movers: Awaited<ReturnType<typeof fetchMovers>>, earnings: Earning[]): string {
  const now = new Date();
  // IST = UTC+5:30
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = ist.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  const { total, gainers, losers, avgChange } = movers;
  const avgEmoji = avgChange >= 0 ? '\u{1F7E2}' : '\u{1F534}';
  const mood = avgChange > 0.5 ? 'BULLISH' : avgChange < -0.5 ? 'BEARISH' : 'MIXED';

  const lines: string[] = [];
  lines.push(`\u{1F4CA} *Market Cockpit — Mid & Small Cap Pulse*`);
  lines.push(`\u{1F4C5} ${dateStr} | \u{1F552} ${timeStr} IST`);
  lines.push('');
  lines.push(`${avgEmoji} *Market Mood: ${mood}* (avg ${avgChange > 0 ? '+' : ''}${avgChange}%)`);
  lines.push(`\u{1F4C8} ${total} stocks tracked`);
  lines.push('');

  // Top Gainers
  if (gainers.length > 0) {
    lines.push(`\u{1F680} *TOP GAINERS*`);
    lines.push('```');
    for (let i = 0; i < Math.min(10, gainers.length); i++) {
      const g = gainers[i];
      const pct = `+${g.changePercent.toFixed(1)}%`;
      const price = g.price > 0 ? `₹${g.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      lines.push(`${String(i + 1).padStart(2)}. ${g.ticker.padEnd(14)} ${pct.padStart(7)}  ${price.padStart(8)} [${g.cap}]`);
    }
    lines.push('```');
    lines.push('');
  }

  // Top Losers
  if (losers.length > 0) {
    lines.push(`\u{1F4C9} *TOP LOSERS*`);
    lines.push('```');
    for (let i = 0; i < Math.min(10, losers.length); i++) {
      const l = losers[i];
      const pct = `${l.changePercent.toFixed(1)}%`;
      const price = l.price > 0 ? `₹${l.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      lines.push(`${String(i + 1).padStart(2)}. ${l.ticker.padEnd(14)} ${pct.padStart(7)}  ${price.padStart(8)} [${l.cap}]`);
    }
    lines.push('```');
    lines.push('');
  }

  // Big movers
  const bigUp = gainers.filter(g => g.changePercent >= 4);
  const bigDown = losers.filter(l => l.changePercent <= -4);
  if (bigUp.length > 0 || bigDown.length > 0) {
    lines.push(`\u{26A1} *BIG MOVERS (4%+)*`);
    for (const s of bigUp.slice(0, 5)) {
      lines.push(`  \u{1F7E2} ${s.ticker} +${s.changePercent.toFixed(1)}% [${s.cap}]`);
    }
    for (const s of bigDown.slice(0, 5)) {
      lines.push(`  \u{1F534} ${s.ticker} ${s.changePercent.toFixed(1)}% [${s.cap}]`);
    }
    lines.push('');
  }

  // Earnings Pulse
  if (earnings.length > 0) {
    lines.push(`\u{1F4B0} *EARNINGS PULSE* (Top ${earnings.length} Quality Results)`);
    lines.push('```');
    for (const e of earnings.slice(0, 8)) {
      const mv = e.movePercent !== 0 ? `${e.movePercent > 0 ? '+' : ''}${e.movePercent.toFixed(1)}%` : '';
      lines.push(`  ${e.symbol.padEnd(12)} ${e.quality.padEnd(6)} ${e.quarter.padEnd(8)} ${mv}`);
    }
    lines.push('```');
    lines.push('');
  }

  lines.push(`\u{1F310} [View Dashboard](https://market-cockpit.vercel.app/movers)`);
  lines.push(`_Powered by Market Cockpit_`);

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
        parse_mode: 'Markdown',
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

    // Handle commands
    if (text === '/start') {
      await sendTelegramTo(chatId,
        `\u{1F680} *MC Street Pulse — Connected!*\n\nWelcome ${firstName}! Your market intelligence bot is live.\n\n\u{1F4CA} *What you'll receive:*\n\u{2022} Mid & small cap movers (gainers/losers)\n\u{2022} Earnings pulse (top quality results)\n\u{2022} Big movers alerts (4%+ moves)\n\u{2022} Market mood indicator\n\n\u{23F0} *Schedule:* 10:05 AM & 3:05 PM IST (Mon-Fri)\n\n\u{1F4A1} *Commands:*\n/pulse \u{2014} Get live pulse right now\n/gainers \u{2014} Top gainers only\n/losers \u{2014} Top losers only\n/status \u{2014} Bot status & next alert\n/help \u{2014} Show all commands\n\n\u{1F310} [View Dashboard](https://market-cockpit.vercel.app/movers)\n_Powered by Market Cockpit_`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `\u{2753} *MC Street Pulse \u{2014} Help*\n\n*Available Commands:*\n/start \u{2014} Welcome message & setup\n/pulse \u{2014} Full market pulse (movers + earnings)\n/gainers \u{2014} Top mid & small cap gainers\n/losers \u{2014} Top mid & small cap losers\n/status \u{2014} Bot status & next scheduled alert\n/help \u{2014} This help message\n\n*Automatic Alerts:*\n\u{23F0} 10:05 AM IST \u{2014} Morning pulse\n\u{23F0} 3:05 PM IST \u{2014} Afternoon pulse\n\n\u{1F310} [View Full Dashboard](https://market-cockpit.vercel.app/movers)\n_Powered by Market Cockpit_`
      );
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, '\u{23F3} _Fetching live market data..._');
      const [movers, earnings] = await Promise.all([fetchMovers(), fetchEarningsPulse()]);
      if (movers.total === 0) {
        await sendTelegramTo(chatId, '\u{1F4CA} Market is closed or data unavailable. Try during market hours (9:15 AM - 3:30 PM IST).');
      } else {
        const msg = buildMessage(movers, earnings);
        await sendTelegramTo(chatId, msg);
      }
    } else if (text === '/gainers') {
      await sendTelegramTo(chatId, '\u{23F3} _Fetching gainers..._');
      const movers = await fetchMovers();
      if (movers.gainers.length === 0) {
        await sendTelegramTo(chatId, '\u{1F4CA} No gainers data available. Market may be closed.');
      } else {
        const lines = [`\u{1F680} *TOP MID & SMALL CAP GAINERS*\n`, '```'];
        for (let i = 0; i < Math.min(15, movers.gainers.length); i++) {
          const g = movers.gainers[i];
          lines.push(`${String(i + 1).padStart(2)}. ${g.ticker.padEnd(14)} +${g.changePercent.toFixed(1)}%  \u{20B9}${g.price.toLocaleString('en-IN', { maximumFractionDigits: 0 }).padStart(8)} [${g.cap}]`);
        }
        lines.push('```');
        lines.push(`\n\u{1F310} [View Dashboard](https://market-cockpit.vercel.app/movers)`);
        await sendTelegramTo(chatId, lines.join('\n'));
      }
    } else if (text === '/losers') {
      await sendTelegramTo(chatId, '\u{23F3} _Fetching losers..._');
      const movers = await fetchMovers();
      if (movers.losers.length === 0) {
        await sendTelegramTo(chatId, '\u{1F4CA} No losers data available. Market may be closed.');
      } else {
        const lines = [`\u{1F4C9} *TOP MID & SMALL CAP LOSERS*\n`, '```'];
        for (let i = 0; i < Math.min(15, movers.losers.length); i++) {
          const l = movers.losers[i];
          lines.push(`${String(i + 1).padStart(2)}. ${l.ticker.padEnd(14)} ${l.changePercent.toFixed(1)}%  \u{20B9}${l.price.toLocaleString('en-IN', { maximumFractionDigits: 0 }).padStart(8)} [${l.cap}]`);
        }
        lines.push('```');
        lines.push(`\n\u{1F310} [View Dashboard](https://market-cockpit.vercel.app/movers)`);
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
        `\u{2699}\u{FE0F} *MC Street Pulse \u{2014} Status*\n\n\u{2705} Bot: Online\n\u{1F552} IST: ${ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n${isMarketDay && isMarketHours ? '\u{1F7E2} Market: Open' : '\u{1F534} Market: Closed'}\n\u{23F0} Next Alert: ${isMarketDay ? nextAlert : 'Monday 10:05 AM'}\n\n_Alerts run Mon-Fri at 10:05 AM & 3:05 PM IST_`
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
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
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
