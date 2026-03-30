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
  // Try our own API first
  const allStocks: Stock[] = [];
  const seen = new Set<string>();

  for (const idx of ['midsmall50', 'smallcap150', 'midcap150']) {
    try {
      const r = await fetch(`${API_BASE}/api/market/quotes?market=india&index=${idx}`, {
        headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' },
      });
      if (r.ok) {
        const data = await r.json();
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

async function sendTelegram(text: string): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    const result = await r.json();
    if (!result.ok) {
      console.error('Telegram error:', result);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Telegram send failed:', e);
    return false;
  }
}

// ── API Handler ─────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  // Auth check
  if (secret !== BOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') || 'full'; // full | test

  if (mode === 'test') {
    const ok = await sendTelegram(
      '\u{2705} *Market Cockpit Bot Connected*\n\nAlerts are working! You\'ll receive mid & small cap movers + earnings pulse twice daily during market hours.\n\n\u{1F310} [View Dashboard](https://market-cockpit.vercel.app/movers)'
    );
    return NextResponse.json({ ok, mode: 'test' });
  }

  // Fetch data in parallel
  const [movers, earnings] = await Promise.all([
    fetchMovers(),
    fetchEarningsPulse(),
  ]);

  if (movers.total === 0 && earnings.length === 0) {
    const ok = await sendTelegram(
      '\u{1F4CA} *Market Cockpit*\n\nMarket is closed or data unavailable.\n\n_Next alert during market hours._'
    );
    return NextResponse.json({ ok, movers: 0, earnings: 0, status: 'no-data' });
  }

  const msg = buildMessage(movers, earnings);
  const ok = await sendTelegram(msg);

  return NextResponse.json({
    ok,
    movers: movers.total,
    gainers: movers.gainers.length,
    losers: movers.losers.length,
    earnings: earnings.length,
    avgChange: movers.avgChange,
  });
}
