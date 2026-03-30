import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Config ──────────────────────────────────────────────────────────────
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8401991707:AAGpZj1UgW4sJdLm7FLhedC2nBwxUtgXFIc';
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5057319640';
const BOT_SECRET = process.env.BOT_SECRET || 'mc-bot-2026';
const API_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://market-cockpit.vercel.app';

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

// ── API Handler ─────────────────────────────────────────────────────────
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
