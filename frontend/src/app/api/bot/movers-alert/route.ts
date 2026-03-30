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
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.nseindia.com/',
  'Accept-Language': 'en-US,en;q=0.9',
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

interface IndexData {
  name: string;
  shortName: string;
  level: number;
  change: number;
  changePercent: number;
}

interface Breadth {
  advancing: number;
  declining: number;
  unchanged: number;
  mid: { adv: number; dec: number };
  small: { adv: number; dec: number };
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

// ── Fetch Index Snapshot (NIFTY, BANKNIFTY, MIDCAP, SMALLCAP, VIX) ──────
async function fetchIndexSnapshot(): Promise<IndexData[]> {
  const targetMap: Record<string, string> = {
    'NIFTY 50': 'NIFTY',
    'NIFTY BANK': 'BANKNIFTY',
    'NIFTY MIDCAP 100': 'MIDCAP100',
    'NIFTY SMLCAP 100': 'SMALLCAP',
    'INDIA VIX': 'VIX',
  };
  try {
    const cookies = await getNseCookies();
    const url = `${NSE_BASE}/api/allIndices`;
    const r = await fetch(url, { headers: { ...NSE_HEADERS, Cookie: cookies } });
    if (r.ok) {
      const json = await r.json();
      const data = json?.data || [];
      const results: IndexData[] = [];
      for (const item of data) {
        const name = (item.indexSymbol || item.index || '').trim();
        if (targetMap[name]) {
          results.push({
            name,
            shortName: targetMap[name],
            level: Math.round((item.last || item.current || 0) * 100) / 100,
            change: Math.round((item.variation || item.change || 0) * 100) / 100,
            changePercent: Math.round((item.percentChange || item.pChange || 0) * 100) / 100,
          });
        }
      }
      const order = ['NIFTY', 'BANKNIFTY', 'MIDCAP100', 'SMALLCAP', 'VIX'];
      return results.sort((a, b) => order.indexOf(a.shortName) - order.indexOf(b.shortName));
    }
  } catch (e) {
    console.error('[BOT] fetchIndexSnapshot failed:', e);
  }
  return [];
}

// ── Fetch Movers + Breadth ───────────────────────────────────────────────
async function fetchMovers(): Promise<{
  total: number;
  gainers: Stock[];
  losers: Stock[];
  avgChange: number;
  breadth: Breadth;
}> {
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

  // Step 1: Full market
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

  // Step 2: Supplemental indices if needed
  if (allStocks.length < 50) {
    for (const idx of ['midsmall50', 'midcap150', 'smallcap150', 'nifty500']) {
      try {
        const url = `${API_BASE}/api/market/quotes?market=india&index=${idx}`;
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

  // Step 3: NSE direct fallback
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

  // Compute breadth
  const breadth: Breadth = {
    advancing: 0, declining: 0, unchanged: 0,
    mid: { adv: 0, dec: 0 },
    small: { adv: 0, dec: 0 },
  };
  for (const s of allStocks) {
    const upDown = s.changePercent > 0.05 ? 'up' : s.changePercent < -0.05 ? 'down' : 'flat';
    if (upDown === 'up') {
      breadth.advancing++;
      if (s.cap === 'Mid') breadth.mid.adv++;
      else if (s.cap === 'Sml') breadth.small.adv++;
    } else if (upDown === 'down') {
      breadth.declining++;
      if (s.cap === 'Mid') breadth.mid.dec++;
      else if (s.cap === 'Sml') breadth.small.dec++;
    } else {
      breadth.unchanged++;
    }
  }

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

  return {
    total: allStocks.length,
    gainers: gainers.slice(0, 20),
    losers: losers.slice(0, 20),
    avgChange: avg,
    breadth,
  };
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

// ── Helpers ──────────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pct(v: number, decimals = 2): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

function idxLine(idx: IndexData): string {
  const isVix = idx.shortName === 'VIX';
  // VIX rising = fear (bad), VIX falling = calm (good)
  const emoji = isVix
    ? (idx.changePercent > 0 ? '😨' : '😎')
    : (idx.changePercent >= 0 ? '🟢' : '🔴');
  const lvl = isVix
    ? idx.level.toFixed(2)
    : idx.level.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const chgSign = idx.changePercent >= 0 ? '+' : '';
  return `${emoji} <b>${esc(idx.shortName)}</b>  ${lvl}  <b>${chgSign}${idx.changePercent.toFixed(2)}%</b>`;
}

// ── Build two-part Telegram message ──────────────────────────────────────
function buildMessages(
  movers: Awaited<ReturnType<typeof fetchMovers>>,
  earnings: Earning[],
  indices: IndexData[]
): [string, string] {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = ist.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  const { total, gainers, losers, avgChange, breadth } = movers;
  const mood = avgChange > 0.5 ? 'BULLISH 🚀' : avgChange < -0.5 ? 'BEARISH 🌧' : 'MIXED ⚖️';
  const avgEmoji = avgChange >= 0 ? '🟢' : '🔴';
  const DIV = '─'.repeat(22);
  const adRatio = breadth.declining > 0
    ? (breadth.advancing / breadth.declining).toFixed(2)
    : breadth.advancing > 0 ? '∞' : '0';

  // ══════════════════════════════════════════════════════════
  // MESSAGE 1: Header + Index Snapshot + Breadth + Gainers
  // ══════════════════════════════════════════════════════════
  const m1: string[] = [];

  m1.push(`📊 <b>Market Cockpit Pulse — Part 1/2</b>`);
  m1.push(`📅 ${esc(dateStr)}   🕒 ${timeStr} IST`);
  m1.push('');

  // ── Index Snapshot ──
  if (indices.length > 0) {
    m1.push(DIV);
    m1.push(`📈 <b>INDEX SNAPSHOT</b>`);
    m1.push('');
    for (const idx of indices) {
      m1.push(idxLine(idx));
    }
  }

  // ── Market Overview ──
  m1.push('');
  m1.push(DIV);
  m1.push('');
  m1.push(`<b>Market: ${mood}</b>`);
  m1.push(`${avgEmoji} Avg Move <b>${pct(avgChange)}</b>   📦 <b>${total}</b> stocks tracked`);
  m1.push('');
  m1.push(`📊 <b>BREADTH</b>  ↑<b>${breadth.advancing}</b>  ↓<b>${breadth.declining}</b>  →${breadth.unchanged}`);
  m1.push(`   A/D Ratio: <b>${adRatio}x</b>`);
  if (breadth.mid.adv + breadth.mid.dec > 0 || breadth.small.adv + breadth.small.dec > 0) {
    m1.push(`   Mid: ↑${breadth.mid.adv} ↓${breadth.mid.dec}   Sml: ↑${breadth.small.adv} ↓${breadth.small.dec}`);
  }

  // ── Gainers (all 20) ──
  if (gainers.length > 0) {
    m1.push('');
    m1.push(DIV);
    m1.push('');
    m1.push(`📈 <b>TOP ${gainers.length} GAINERS</b>  <i>(by % gain)</i>`);
    m1.push('');
    for (let i = 0; i < gainers.length; i++) {
      const g = gainers[i];
      const price = g.price > 0 ? `₹${g.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      const cap = g.cap === 'Large' ? 'Lrg' : g.cap === 'Mid' ? 'Mid' : 'Sml';
      m1.push(`  ${i + 1}. <b>${esc(g.ticker)}</b>  <b>+${g.changePercent.toFixed(1)}%</b>  ${price}  <i>${cap}</i>`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // MESSAGE 2: Losers + Circuit Breakers + Earnings + Footer
  // ══════════════════════════════════════════════════════════
  const m2: string[] = [];

  m2.push(`📊 <b>Market Cockpit Pulse — Part 2/2</b>`);
  m2.push('');

  // ── Losers (all 20) ──
  if (losers.length > 0) {
    m2.push(DIV);
    m2.push('');
    m2.push(`📉 <b>TOP ${losers.length} LOSERS</b>  <i>(by % loss)</i>`);
    m2.push('');
    for (let i = 0; i < losers.length; i++) {
      const l = losers[i];
      const price = l.price > 0 ? `₹${l.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      const cap = l.cap === 'Large' ? 'Lrg' : l.cap === 'Mid' ? 'Mid' : 'Sml';
      m2.push(`  ${i + 1}. <b>${esc(l.ticker)}</b>  <b>${l.changePercent.toFixed(1)}%</b>  ${price}  <i>${cap}</i>`);
    }
  }

  // ── Circuit Breakers (≥8%) ──
  const extremeUp = gainers.filter(g => g.changePercent >= 8);
  const extremeDown = losers.filter(l => l.changePercent <= -8);
  if (extremeUp.length > 0 || extremeDown.length > 0) {
    m2.push('');
    m2.push(DIV);
    m2.push('');
    m2.push(`🔥 <b>CIRCUIT BREAKERS  (≥8%)</b>`);
    m2.push('');
    for (const s of extremeUp) {
      const price = s.price > 0 ? `₹${s.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      m2.push(`  🟢 <b>${esc(s.ticker)}</b>  <b>+${s.changePercent.toFixed(1)}%</b>  ${price}  <i>${esc(s.cap)}</i>`);
    }
    for (const s of extremeDown) {
      const price = s.price > 0 ? `₹${s.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '';
      m2.push(`  🔴 <b>${esc(s.ticker)}</b>  <b>${s.changePercent.toFixed(1)}%</b>  ${price}  <i>${esc(s.cap)}</i>`);
    }
  }

  // ── Earnings Pulse ──
  if (earnings.length > 0) {
    m2.push('');
    m2.push(DIV);
    m2.push('');
    m2.push(`💰 <b>EARNINGS PULSE</b>  <i>Top Quality Results This Month</i>`);
    m2.push('');
    for (const e of earnings.slice(0, 8)) {
      const qualEmoji = e.quality === 'Excellent' ? '⭐' : '✅';
      const mv = e.movePercent !== 0 ? `   <b>${e.movePercent > 0 ? '+' : ''}${e.movePercent.toFixed(1)}%</b>` : '';
      m2.push(`  ${qualEmoji} <b>${esc(e.symbol)}</b>  ${esc(e.quality)}  <i>${esc(e.quarter)}</i>${mv}`);
    }
  }

  // ── Footer ──
  m2.push('');
  m2.push(DIV);
  m2.push('');
  m2.push(`🌐 <a href="https://market-cockpit.vercel.app/movers">Open Dashboard</a>`);
  m2.push(`<i>Powered by Market Cockpit</i>`);

  return [m1.join('\n'), m2.join('\n')];
}

async function sendTelegram(text: string): Promise<{ ok: boolean; telegramResponse?: any; error?: string }> {
  const tgUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  console.log(`[BOT] Sending to Telegram chat=${TG_CHAT_ID}, msg length=${text.length}`);
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

    if (text === '/start') {
      await sendTelegramTo(chatId,
        `🚀 <b>MC Street Pulse — Connected!</b>\n\nWelcome ${esc(firstName)}! Your market intelligence bot is live.\n\n📊 <b>What you'll receive:</b>\n• NIFTY, MIDCAP, SMALLCAP &amp; VIX snapshot\n• Market breadth (advance/decline ratio)\n• All top 20 mid &amp; small cap movers (gainers/losers)\n• Earnings pulse (top quality results)\n• Circuit breaker alerts (8%+ moves)\n\n⏰ <b>Schedule:</b> 10:05 AM &amp; 3:05 PM IST (Mon–Fri)\n\n💡 <b>Commands:</b>\n/pulse — Get live pulse right now\n/gainers — Top 20 gainers only\n/losers — Top 20 losers only\n/indices — Index snapshot + breadth\n/status — Bot status &amp; next alert\n/help — Show all commands\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `❓ <b>MC Street Pulse — Help</b>\n\n<b>Commands:</b>\n/start — Welcome message &amp; setup\n/pulse — Full market pulse (2 messages)\n/gainers — Top 20 mid &amp; small cap gainers\n/losers — Top 20 mid &amp; small cap losers\n/indices — NIFTY/MIDCAP/SMALLCAP/VIX snapshot\n/status — Bot status &amp; next scheduled alert\n/help — This help message\n\n<b>Automatic Alerts:</b>\n⏰ 10:05 AM IST — Morning pulse\n⏰ 3:05 PM IST — Afternoon pulse\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Full Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching live market data...</i>');
      const [movers, earnings, indices] = await Promise.all([fetchMovers(), fetchEarningsPulse(), fetchIndexSnapshot()]);
      if (movers.total === 0) {
        await sendTelegramTo(chatId, '📊 Market is closed or data unavailable. Try during market hours (9:15 AM – 3:30 PM IST).');
      } else {
        const [msg1, msg2] = buildMessages(movers, earnings, indices);
        await sendTelegramTo(chatId, msg1);
        await sendTelegramTo(chatId, msg2);
      }
    } else if (text === '/indices') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching index data...</i>');
      const [indices, movers] = await Promise.all([fetchIndexSnapshot(), fetchMovers()]);
      const DIV = '─'.repeat(22);
      const adRatio = movers.breadth.declining > 0
        ? (movers.breadth.advancing / movers.breadth.declining).toFixed(2)
        : '∞';
      const lines = [`📈 <b>INDEX SNAPSHOT</b>\n`];
      for (const idx of indices) lines.push(idxLine(idx));
      lines.push('');
      lines.push(DIV);
      lines.push('');
      lines.push(`📊 <b>MARKET BREADTH</b>`);
      lines.push(`↑<b>${movers.breadth.advancing}</b> advancing  ↓<b>${movers.breadth.declining}</b> declining  →${movers.breadth.unchanged} flat`);
      lines.push(`A/D Ratio: <b>${adRatio}x</b>`);
      lines.push(`Mid: ↑${movers.breadth.mid.adv} ↓${movers.breadth.mid.dec}   Sml: ↑${movers.breadth.small.adv} ↓${movers.breadth.small.dec}`);
      await sendTelegramTo(chatId, lines.join('\n'));
    } else if (text === '/gainers') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching gainers...</i>');
      const movers = await fetchMovers();
      if (movers.gainers.length === 0) {
        await sendTelegramTo(chatId, '📊 No gainers data available. Market may be closed.');
      } else {
        const lines = [`📈 <b>TOP ${movers.gainers.length} MID &amp; SMALL CAP GAINERS</b>\n`];
        for (let i = 0; i < movers.gainers.length; i++) {
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
        const lines = [`📉 <b>TOP ${movers.losers.length} MID &amp; SMALL CAP LOSERS</b>\n`];
        for (let i = 0; i < movers.losers.length; i++) {
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
    return NextResponse.json({ ok: true });
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

  if (secret !== BOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized', hint: 'Add ?secret=mc-bot-2026 to the URL' }, { status: 401 });
  }
  diagnostics.steps.push('auth_passed');

  const mode = searchParams.get('mode') || 'full';

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
      '✅ <b>Market Cockpit Bot Connected</b>\n\nAlerts are working! You\'ll receive index snapshot, market breadth, and top 20 mid &amp; small cap movers twice daily.\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Dashboard</a>'
    );
    diagnostics.steps.push(result.ok ? 'test_sent_ok' : 'test_send_failed');
    return NextResponse.json({ ok: result.ok, mode: 'test', telegramResponse: result.telegramResponse, error: result.error, diagnostics, elapsed: Date.now() - startTime });
  }

  // ── Full mode: fetch data + send two-part message ──
  console.log('[BOT] Full mode: fetching movers + earnings + indices...');
  diagnostics.steps.push('fetching_data');

  const [movers, earnings, indices] = await Promise.all([
    fetchMovers().catch(e => {
      console.error('[BOT] fetchMovers failed:', e);
      diagnostics.moversError = String(e);
      return { total: 0, gainers: [] as Stock[], losers: [] as Stock[], avgChange: 0, breadth: { advancing: 0, declining: 0, unchanged: 0, mid: { adv: 0, dec: 0 }, small: { adv: 0, dec: 0 } } };
    }),
    fetchEarningsPulse().catch(e => {
      console.error('[BOT] fetchEarningsPulse failed:', e);
      diagnostics.earningsError = String(e);
      return [] as Earning[];
    }),
    fetchIndexSnapshot().catch(e => {
      console.error('[BOT] fetchIndexSnapshot failed:', e);
      diagnostics.indicesError = String(e);
      return [] as IndexData[];
    }),
  ]);

  diagnostics.steps.push('data_fetched');
  diagnostics.data = {
    moversTotal: movers.total,
    gainers: movers.gainers.length,
    losers: movers.losers.length,
    earnings: earnings.length,
    indices: indices.length,
  };

  if (movers.total === 0 && earnings.length === 0) {
    diagnostics.steps.push('no_data_sending_closed_msg');
    const result = await sendTelegram(
      '📊 <b>Market Cockpit</b>\n\nMarket is closed or data unavailable.\n\n<i>Next alert during market hours.</i>'
    );
    return NextResponse.json({ ok: result.ok, status: 'no-data', telegramResponse: result.telegramResponse, error: result.error, diagnostics, elapsed: Date.now() - startTime });
  }

  const [msg1, msg2] = buildMessages(movers, earnings, indices);
  diagnostics.steps.push('messages_built');
  diagnostics.msg1Length = msg1.length;
  diagnostics.msg2Length = msg2.length;

  // Send part 1
  const result1 = await sendTelegram(msg1);
  diagnostics.steps.push(result1.ok ? 'msg1_sent_ok' : 'msg1_send_failed');

  // Send part 2 (even if part 1 failed — give partial data)
  const result2 = await sendTelegram(msg2);
  diagnostics.steps.push(result2.ok ? 'msg2_sent_ok' : 'msg2_send_failed');
  diagnostics.steps.push('telegram_sent_ok');

  return NextResponse.json({
    ok: result1.ok && result2.ok,
    movers: movers.total,
    gainers: movers.gainers.length,
    losers: movers.losers.length,
    earnings: earnings.length,
    indices: indices.length,
    avgChange: movers.avgChange,
    breadth: movers.breadth,
    telegramResponse: { part1: result1.telegramResponse, part2: result2.telegramResponse },
    error: result1.error || result2.error,
    diagnostics,
    elapsed: Date.now() - startTime,
  });
}
