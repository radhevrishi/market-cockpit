import { NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import React from 'react';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Config ──────────────────────────────────────────────────────────────
const TG_TOKEN = '8763736180:AAFZ96g_IMunKzwdkVacWLrfjl8fms1BdvY';
const TG_CHAT_ID = '5057319640';
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

// ── Interfaces ──────────────────────────────────────────────────────────
interface Stock {
  ticker: string;
  company: string;
  price: number;
  changePercent: number;
  change: number;
  cap: string;
  sector: string;
  industry: string;
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

// ── NSE Helpers ─────────────────────────────────────────────────────────
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
    const r = await fetch(url, { headers: { ...NSE_HEADERS, Cookie: cookies } });
    if (r.ok) {
      const json = await r.json();
      return json?.data || [];
    }
  } catch (e) {
    console.error(`NSE fetch ${indexName} failed:`, e);
  }
  return [];
}

// ── Fetch Index Snapshot ────────────────────────────────────────────────
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

// ── Fetch Movers + Breadth ──────────────────────────────────────────────
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
    const cap = grp.includes('large') ? 'L' : grp.includes('mid') ? 'M' : 'S';
    allStocks.push({
      ticker: tk,
      company: s.company || s.meta?.companyName || tk,
      price: s.price || s.lastPrice || 0,
      changePercent: Math.round((s.changePercent || s.pChange || 0) * 100) / 100,
      change: Math.round((s.change || 0) * 100) / 100,
      cap,
      sector: s.sector || '',
      industry: s.industry || s.meta?.industry || '',
    });
  }

  // Step 1: Full market from API
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
      if (s.cap === 'M') breadth.mid.adv++;
      else if (s.cap === 'S') breadth.small.adv++;
    } else if (upDown === 'down') {
      breadth.declining++;
      if (s.cap === 'M') breadth.mid.dec++;
      else if (s.cap === 'S') breadth.small.dec++;
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
    gainers: gainers.slice(0, 25),
    losers: losers.slice(0, 25),
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

// ══════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Professional table cards like EarningsPulse
// ══════════════════════════════════════════════════════════════════════════

function truncate(s: string, maxLen: number): string {
  if (!s) return '—';
  return s.length > maxLen ? s.slice(0, maxLen - 2) + '..' : s;
}

function getISTTimestamp(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getDate().toString().padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[ist.getMonth()];
  const year = ist.getFullYear();
  const hours = ist.getHours();
  const minutes = ist.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${day} ${month} ${year}, ${h12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

async function generateMoversImage(
  stocks: Stock[],
  type: 'gainers' | 'losers',
): Promise<ArrayBuffer> {
  const isGainers = type === 'gainers';
  const title = isGainers ? 'Top Gainers' : 'Top Losers';
  const titleColor = isGainers ? '#2e7d32' : '#c62828';
  const pctColor = isGainers ? '#2e7d32' : '#c62828';
  const threshold = isGainers ? '≥+4%' : '≤-4%';
  const timestamp = getISTTimestamp();

  // Filter by 4% threshold
  const filtered = isGainers
    ? stocks.filter(s => s.changePercent >= 4)
    : stocks.filter(s => s.changePercent <= -4);

  const displayStocks = filtered.length > 0 ? filtered.slice(0, 20) : stocks.slice(0, 20);
  const actualThreshold = filtered.length > 0;

  const ROW_H = 42;
  const HEADER_H = 90;
  const COL_HEADER_H = 44;
  const FOOTER_H = 44;
  const totalHeight = HEADER_H + COL_HEADER_H + displayStocks.length * ROW_H + FOOTER_H;

  const element = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '1100px',
        height: `${totalHeight}px`,
        backgroundColor: '#ffffff',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px 32px',
          gap: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            backgroundColor: '#1a1a2e',
            fontSize: '28px',
          }}
        >
          🐂
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '32px', fontWeight: 700, color: titleColor, letterSpacing: '-0.5px' }}>
            {title}
          </span>
          <span style={{ fontSize: '15px', color: '#718096', marginTop: '2px' }}>
            Intraday  •  {actualThreshold ? threshold : 'All'}  •  {timestamp}
          </span>
        </div>
      </div>

      {/* ── Column Headers ── */}
      <div
        style={{
          display: 'flex',
          backgroundColor: '#2d3748',
          color: '#e2e8f0',
          padding: '12px 32px',
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '0.5px',
        }}
      >
        <span style={{ width: '140px' }}>Symbol</span>
        <span style={{ width: '200px' }}>Sector</span>
        <span style={{ width: '220px' }}>Industry</span>
        <span style={{ width: '100px', textAlign: 'right' }}>Chg%</span>
        <span style={{ width: '100px', textAlign: 'right' }}>Price</span>
        <span style={{ width: '50px', textAlign: 'center' }}>Cap</span>
      </div>

      {/* ── Data Rows ── */}
      {displayStocks.map((s, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            padding: '10px 32px',
            backgroundColor: i % 2 === 0 ? '#f7fafc' : '#ffffff',
            fontSize: '14px',
            alignItems: 'center',
            borderBottom: '1px solid #edf2f7',
          }}
        >
          <span style={{ width: '140px', fontWeight: 700, color: '#1a202c', fontSize: '14px' }}>
            {truncate(s.ticker, 14)}
          </span>
          <span style={{ width: '200px', color: '#2d3748', fontSize: '13px' }}>
            {truncate(s.sector, 20)}
          </span>
          <span style={{ width: '220px', color: '#2d3748', fontSize: '13px' }}>
            {truncate(s.industry, 22)}
          </span>
          <span style={{ width: '100px', textAlign: 'right', fontWeight: 700, color: pctColor, fontSize: '15px' }}>
            {isGainers ? '+' : ''}{s.changePercent.toFixed(1)}%
          </span>
          <span style={{ width: '100px', textAlign: 'right', color: '#2d3748', fontSize: '13px' }}>
            ₹{s.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
          <span style={{ width: '50px', textAlign: 'center', color: '#2d3748', fontSize: '13px', fontWeight: 600 }}>
            {s.cap}
          </span>
        </div>
      ))}

      {/* ── Footer ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 32px',
          backgroundColor: '#edf2f7',
          fontSize: '13px',
          color: '#718096',
          marginTop: 'auto',
        }}
      >
        <span>{displayStocks.length} stocks</span>
        <span>@mc_street_pulse_bot</span>
      </div>
    </div>
  );

  const response = new ImageResponse(element, {
    width: 1100,
    height: totalHeight,
  });

  return response.arrayBuffer();
}

// ── Telegram Send Functions ─────────────────────────────────────────────
async function sendTelegram(text: string, chatId?: string): Promise<{ ok: boolean; telegramResponse?: any; error?: string }> {
  const targetId = chatId || TG_CHAT_ID;
  const tgUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  console.log(`[BOT] Sending text to chat=${targetId}, length=${text.length}`);
  try {
    const r = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetId,
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

async function sendTelegramPhoto(
  imageBuffer: ArrayBuffer,
  caption: string = '',
  chatId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const targetId = chatId || TG_CHAT_ID;
  const tgUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`;
  console.log(`[BOT] Sending photo to chat=${targetId}, size=${imageBuffer.byteLength}`);

  try {
    const formData = new FormData();
    formData.append('chat_id', targetId);
    formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'movers.png');
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
    }

    const r = await fetch(tgUrl, { method: 'POST', body: formData });
    const result = await r.json();
    console.log(`[BOT] Photo send: ${result.ok ? 'OK' : 'FAILED'} - ${result.description || ''}`);
    return { ok: result.ok, error: result.description };
  } catch (e: any) {
    console.error(`[BOT] Photo send EXCEPTION: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function sendTelegramTo(chatId: string, text: string): Promise<void> {
  await sendTelegram(text, chatId);
}

// ── Text Helpers ────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtPct(v: number, decimals = 1): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}%`;
}

function fmtPrice(p: number): string {
  if (p <= 0) return '';
  return `₹${p.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function idxLine(idx: IndexData): string {
  const isVix = idx.shortName === 'VIX';
  const emoji = isVix
    ? (idx.changePercent > 0 ? '🔺' : '🔻')
    : (idx.changePercent >= 0 ? '🟩' : '🟥');
  const lvl = isVix
    ? idx.level.toFixed(2)
    : idx.level.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const chg = fmtPct(idx.changePercent, 2);
  const label = isVix ? `${idx.shortName} (Fear)` : idx.shortName;
  return `${emoji} <b>${esc(label)}</b>  ${lvl}  <code>${chg}</code>`;
}

function breadthBar(adv: number, dec: number, total: number): string {
  const barLen = 14;
  const advPct = total > 0 ? adv / total : 0;
  const advBlocks = Math.round(advPct * barLen);
  const decBlocks = barLen - advBlocks;
  return '🟩'.repeat(advBlocks) + '🟥'.repeat(decBlocks);
}

// ── Build Text Summary Message (indices + breadth + earnings) ──────────
function buildSummaryMessage(
  movers: Awaited<ReturnType<typeof fetchMovers>>,
  earnings: Earning[],
  indices: IndexData[],
): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = ist.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  const { total, avgChange, breadth } = movers;
  const DIV = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

  const moodEmoji = avgChange > 0.5 ? '🟢' : avgChange < -0.5 ? '🔴' : '🟡';
  const moodText = avgChange > 0.5 ? 'BULLISH' : avgChange < -0.5 ? 'BEARISH' : 'NEUTRAL';

  const adTotal = breadth.advancing + breadth.declining + breadth.unchanged;
  const adRatio = breadth.declining > 0
    ? (breadth.advancing / breadth.declining).toFixed(2)
    : breadth.advancing > 0 ? '∞' : '0';

  const lines: string[] = [];

  // Header
  lines.push(`${moodEmoji} <b>MC STREET PULSE</b>  ·  <code>${moodText}</code>`);
  lines.push(`<i>${esc(dateStr)}  ${timeStr} IST</i>`);
  lines.push('');

  // Indices
  if (indices.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>📊 INDICES</b>`);
    lines.push('');
    for (const idx of indices) {
      lines.push(idxLine(idx));
    }
    lines.push('');
  }

  // Breadth
  lines.push(DIV);
  lines.push('');
  lines.push(`<b>📈 MARKET BREADTH</b>  <i>${total} stocks</i>`);
  lines.push('');
  lines.push(breadthBar(breadth.advancing, breadth.declining, adTotal));
  lines.push(`🟩 <b>${breadth.advancing}</b> advancing   🟥 <b>${breadth.declining}</b> declining   ⬜ ${breadth.unchanged} flat`);
  lines.push(`A/D: <b>${adRatio}</b>   Avg: <code>${fmtPct(avgChange, 2)}</code>`);
  if (breadth.mid.adv + breadth.mid.dec > 0 || breadth.small.adv + breadth.small.dec > 0) {
    lines.push(`<i>Mid</i> ↑${breadth.mid.adv} ↓${breadth.mid.dec}   <i>Small</i> ↑${breadth.small.adv} ↓${breadth.small.dec}`);
  }
  lines.push('');

  // Circuit Breakers
  const extremeUp = movers.gainers.filter(g => g.changePercent >= 8);
  const extremeDown = movers.losers.filter(l => l.changePercent <= -8);
  if (extremeUp.length > 0 || extremeDown.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>🚨 CIRCUIT BREAKERS</b>  <i>≥ 8% move</i>`);
    lines.push('');
    for (const s of extremeUp.slice(0, 5)) {
      lines.push(`  🟢 <b>${esc(s.ticker)}</b>  <code>+${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}  [${s.cap}]`);
    }
    for (const s of extremeDown.slice(0, 5)) {
      lines.push(`  🔴 <b>${esc(s.ticker)}</b>  <code>${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}  [${s.cap}]`);
    }
    lines.push('');
  }

  // Earnings Pulse
  if (earnings.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>💰 EARNINGS PULSE</b>  <i>Top Results This Month</i>`);
    lines.push('');
    for (const e of earnings.slice(0, 8)) {
      const badge = e.quality === 'Excellent' ? '⭐' : '✅';
      const mv = e.movePercent !== 0 ? `  <code>${fmtPct(e.movePercent)}</code>` : '';
      lines.push(`  ${badge} <b>${esc(e.symbol)}</b>  <i>${esc(e.quarter)}</i>${mv}`);
    }
    lines.push('');
  }

  // Legend + Footer
  lines.push(DIV);
  lines.push('');
  lines.push(`<i>L=Large  M=Mid  S=Small</i>`);
  lines.push('');
  lines.push(`🌐 <a href="https://market-cockpit.vercel.app/movers">Open Dashboard</a>  ·  <i>Market Cockpit</i>`);

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════
// SEND FULL ALERT (images + text summary)
// ══════════════════════════════════════════════════════════════════════════
async function sendFullAlert(
  movers: Awaited<ReturnType<typeof fetchMovers>>,
  earnings: Earning[],
  indices: IndexData[],
  chatId?: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const target = chatId || TG_CHAT_ID;

  // 1. Send Gainers Image
  try {
    const gainersImg = await generateMoversImage(movers.gainers, 'gainers');
    const r1 = await sendTelegramPhoto(gainersImg, '', target);
    if (!r1.ok) errors.push(`Gainers image: ${r1.error}`);
  } catch (e: any) {
    console.error('[BOT] Gainers image failed:', e);
    errors.push(`Gainers image exception: ${e.message}`);
  }

  // 2. Send Losers Image
  try {
    const losersImg = await generateMoversImage(movers.losers, 'losers');
    const r2 = await sendTelegramPhoto(losersImg, '', target);
    if (!r2.ok) errors.push(`Losers image: ${r2.error}`);
  } catch (e: any) {
    console.error('[BOT] Losers image failed:', e);
    errors.push(`Losers image exception: ${e.message}`);
  }

  // 3. Send Text Summary (indices, breadth, earnings, circuits)
  const summary = buildSummaryMessage(movers, earnings, indices);
  const r3 = await sendTelegram(summary, target);
  if (!r3.ok) errors.push(`Summary text: ${r3.error}`);

  return { ok: errors.length === 0, errors };
}

// ══════════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER (POST) — Telegram commands
// ══════════════════════════════════════════════════════════════════════════
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
        `🚀 <b>MC Street Pulse — Connected!</b>\n\nWelcome ${esc(firstName)}! Your market intelligence bot is live.\n\n📊 <b>What you'll receive:</b>\n• Professional image cards — Top Gainers &amp; Losers\n• Sector &amp; Industry breakdown\n• NIFTY, MIDCAP, SMALLCAP &amp; VIX snapshot\n• Market breadth (advance/decline ratio)\n• Circuit breaker alerts (8%+ moves)\n• Earnings pulse (top quality results)\n\n⏰ <b>Schedule:</b> 10:05 AM &amp; 3:05 PM IST (Mon–Fri)\n\n💡 <b>Commands:</b>\n/pulse — Get live pulse with images\n/gainers — Top gainers image card\n/losers — Top losers image card\n/indices — Index snapshot + breadth\n/status — Bot status &amp; next alert\n/help — Show all commands\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `❓ <b>MC Street Pulse — Help</b>\n\n<b>Commands:</b>\n/start — Welcome &amp; setup\n/pulse — Full market pulse with image cards\n/gainers — Top gainers image (4%+ movers)\n/losers — Top losers image (4%+ drops)\n/indices — NIFTY/MIDCAP/SMALLCAP/VIX snapshot\n/status — Bot status &amp; next alert\n/help — This help message\n\n<b>Automatic Alerts:</b>\n⏰ 10:05 AM IST — Morning pulse\n⏰ 3:05 PM IST — Afternoon pulse\n\nEach alert includes:\n📸 Top Gainers image card\n📸 Top Losers image card\n📊 Index snapshot &amp; breadth\n🚨 Circuit breakers (8%+)\n💰 Earnings pulse\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Full Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, '⏳ <i>Generating market pulse with image cards...</i>');
      const [movers, earnings, indices] = await Promise.all([fetchMovers(), fetchEarningsPulse(), fetchIndexSnapshot()]);
      if (movers.total === 0) {
        await sendTelegramTo(chatId, '📊 Market is closed or data unavailable. Try during market hours (9:15 AM – 3:30 PM IST).');
      } else {
        await sendFullAlert(movers, earnings, indices, chatId);
      }
    } else if (text === '/gainers') {
      await sendTelegramTo(chatId, '⏳ <i>Generating gainers card...</i>');
      const movers = await fetchMovers();
      if (movers.gainers.length === 0) {
        await sendTelegramTo(chatId, '📊 No gainers data available. Market may be closed.');
      } else {
        try {
          const img = await generateMoversImage(movers.gainers, 'gainers');
          await sendTelegramPhoto(img, `🟢 Top ${movers.gainers.filter(g => g.changePercent >= 4).length || movers.gainers.length} Gainers — <a href="https://market-cockpit.vercel.app/movers">Dashboard</a>`, chatId);
        } catch (e) {
          // Fallback to text
          const lines = [`📈 <b>TOP GAINERS</b>\n`];
          for (let i = 0; i < movers.gainers.length; i++) {
            const g = movers.gainers[i];
            lines.push(`${i + 1}. <b>${esc(g.ticker)}</b>  <b>+${g.changePercent.toFixed(1)}%</b>  ${fmtPrice(g.price)}  [${g.cap}]`);
          }
          await sendTelegramTo(chatId, lines.join('\n'));
        }
      }
    } else if (text === '/losers') {
      await sendTelegramTo(chatId, '⏳ <i>Generating losers card...</i>');
      const movers = await fetchMovers();
      if (movers.losers.length === 0) {
        await sendTelegramTo(chatId, '📊 No losers data available. Market may be closed.');
      } else {
        try {
          const img = await generateMoversImage(movers.losers, 'losers');
          await sendTelegramPhoto(img, `🔴 Top ${movers.losers.filter(l => l.changePercent <= -4).length || movers.losers.length} Losers — <a href="https://market-cockpit.vercel.app/movers">Dashboard</a>`, chatId);
        } catch (e) {
          const lines = [`📉 <b>TOP LOSERS</b>\n`];
          for (let i = 0; i < movers.losers.length; i++) {
            const l = movers.losers[i];
            lines.push(`${i + 1}. <b>${esc(l.ticker)}</b>  <b>${l.changePercent.toFixed(1)}%</b>  ${fmtPrice(l.price)}  [${l.cap}]`);
          }
          await sendTelegramTo(chatId, lines.join('\n'));
        }
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
    } else if (text === '/status') {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const h = ist.getHours();
      const day = ist.getDay();
      const isMarketDay = day >= 1 && day <= 5;
      const isMarketHours = h >= 9 && h < 16;
      const nextAlert = h < 10 ? '10:05 AM' : h < 15 ? '3:05 PM' : 'Tomorrow 10:05 AM';

      await sendTelegramTo(chatId,
        `⚙️ <b>MC Street Pulse — Status</b>\n\n✅ Bot: Online\n🕒 IST: ${ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n${isMarketDay && isMarketHours ? '🟢 Market: Open' : '🔴 Market: Closed'}\n⏰ Next Alert: ${isMarketDay ? nextAlert : 'Monday 10:05 AM'}\n📸 Mode: Image Cards + Text Summary\n\n<i>Alerts run Mon–Fri at 10:05 AM &amp; 3:05 PM IST</i>`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[BOT] Webhook error:', e);
    return NextResponse.json({ ok: true });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SCHEDULED ALERT HANDLER (GET)
// ══════════════════════════════════════════════════════════════════════════
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
      '✅ <b>Market Cockpit Bot Connected</b>\n\nImage card alerts are active! You\'ll receive:\n📸 Top Gainers card\n📸 Top Losers card\n📊 Index + Breadth summary\n\nTwice daily at 10:05 AM &amp; 3:05 PM IST.\n\n🌐 <a href="https://market-cockpit.vercel.app/movers">View Dashboard</a>'
    );
    diagnostics.steps.push(result.ok ? 'test_sent_ok' : 'test_send_failed');
    return NextResponse.json({ ok: result.ok, mode: 'test', telegramResponse: result.telegramResponse, error: result.error, diagnostics, elapsed: Date.now() - startTime });
  }

  // ── Full mode: fetch data + send images + text ──
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

  // Send full alert with images
  const alertResult = await sendFullAlert(movers, earnings, indices);
  diagnostics.steps.push(alertResult.ok ? 'alert_sent_ok' : 'alert_partial_fail');
  if (alertResult.errors.length > 0) {
    diagnostics.alertErrors = alertResult.errors;
  }
  diagnostics.steps.push('done');

  return NextResponse.json({
    ok: alertResult.ok,
    movers: movers.total,
    gainers: movers.gainers.length,
    losers: movers.losers.length,
    earnings: earnings.length,
    indices: indices.length,
    avgChange: movers.avgChange,
    breadth: movers.breadth,
    errors: alertResult.errors,
    diagnostics,
    elapsed: Date.now() - startTime,
  });
}
