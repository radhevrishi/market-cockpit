import { NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import React from 'react';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Config ──────────────────────────────────────────────────────────────
const TG_TOKEN = '8522816501:AAGFbhOb8EYj7cG0yUwsaZ5ZFUEpRkA7Zss';
const TG_CHAT_ID = '5057319640';
const BOT_SECRET = process.env.MC_BOT_SECRET || 'mc-bot-2026';
const API_BASE = 'https://market-cockpit.vercel.app';

// ── Default Portfolio (user's actual holdings) ─────────────────────────
const DEFAULT_PORTFOLIO = [
  'HFCL', 'GRAVITA', 'CEINSYS', 'AEROFLEX', 'CPPLUS', 'DIXON',
  'IKS', 'PARAS', 'QPOWER', 'JSWINFRA', 'DEEDEV', 'WELCORP',
  'LUMAXTECH', 'MTARTECH', 'WAAREEENER', 'HBLENGINE',
];

// ── NSE Headers ─────────────────────────────────────────────────────────
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
  dayHigh?: number;
  dayLow?: number;
  weekHigh52?: number;
  weekLow52?: number;
}

interface NewsItem {
  title: string;
  source?: string;
  timestamp?: string;
}

interface Portfolio {
  stocks: string[];
  addedAt: number;
}

// ── In-Memory Portfolio Storage (with API sync) ─────────────────────────
const portfolioStorage: Record<string, Portfolio> = {};
let apiSyncDone: Record<string, boolean> = {};

async function getPortfolio(chatId: string): Promise<string[]> {
  if (!apiSyncDone[chatId]) {
    apiSyncDone[chatId] = true;
    try {
      const res = await fetch(`${API_BASE}/api/watchlist?chatId=pf_${chatId}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.watchlist && Array.isArray(data.watchlist) && data.watchlist.length > 0) {
          portfolioStorage[chatId] = { stocks: data.watchlist, addedAt: Date.now() };
          console.log(`[PORTFOLIO] Loaded ${data.watchlist.length} stocks from API for ${chatId}`);
          return data.watchlist;
        }
      }
    } catch (e) {
      console.warn('[PORTFOLIO] API sync failed, using local:', e);
    }
  }

  if (!portfolioStorage[chatId]) {
    portfolioStorage[chatId] = {
      stocks: [...DEFAULT_PORTFOLIO],
      addedAt: Date.now(),
    };
  }
  return portfolioStorage[chatId].stocks;
}

function setPortfolio(chatId: string, stocks: string[]): void {
  const unique = [...new Set(stocks.map(s => s.trim().toUpperCase()).filter(s => s.length > 0 && s.length < 30))];
  portfolioStorage[chatId] = {
    stocks: unique,
    addedAt: Date.now(),
  };
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
    console.error(`[PORTFOLIO] NSE fetch ${indexName} failed:`, e);
  }
  return [];
}

// ── Fetch Portfolio Stocks ──────────────────────────────────────────────
async function fetchPortfolioStocks(portfolio: string[]): Promise<Stock[]> {
  const portfolioSet = new Set(portfolio.map(t => t.toUpperCase()));
  const allStocks: Stock[] = [];
  const seen = new Set<string>();

  function addStock(s: any) {
    const tk = (s.ticker || s.symbol || '').trim().toUpperCase();
    if (!tk || !portfolioSet.has(tk) || seen.has(tk)) return;
    if ((s.price || s.lastPrice || 0) <= 0) return;
    seen.add(tk);
    allStocks.push({
      ticker: tk,
      company: s.company || s.meta?.companyName || tk,
      price: s.price || s.lastPrice || 0,
      changePercent: Math.round((s.changePercent || s.pChange || 0) * 100) / 100,
      change: Math.round((s.change || 0) * 100) / 100,
      cap: (s.indexGroup || '').toLowerCase().includes('large') ? 'L' : 'M',
      sector: s.sector || '',
      dayHigh: s.dayHigh || s.high || undefined,
      dayLow: s.dayLow || s.low || undefined,
      weekHigh52: s.yearHigh || s.weekHigh52 || undefined,
      weekLow52: s.yearLow || s.weekLow52 || undefined,
    });
  }

  // Step 1: Full market from API
  try {
    const url = `${API_BASE}/api/market/quotes?market=india`;
    console.log(`[PORTFOLIO] Fetching ALL stocks: ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' } });
    if (r.ok) {
      const data = await r.json();
      const stocks = data.stocks || [];
      console.log(`[PORTFOLIO] All stocks: ${stocks.length} returned, filtering for portfolio`);
      for (const s of stocks) addStock(s);
    }
  } catch (e) {
    console.error('[PORTFOLIO] Full market fetch failed:', e);
  }

  // Step 2: NSE fallback for missing stocks
  if (seen.size < portfolio.length) {
    const missing = [...portfolioSet].filter(t => !seen.has(t));
    console.log(`[PORTFOLIO] ${missing.length} stocks still missing, trying NSE...`);
    const cookies = await getNseCookies();
    if (cookies) {
      const indices = [
        { name: 'NIFTY 50', label: '' },
        { name: 'NIFTY NEXT 50', label: '' },
        { name: 'NIFTY MIDCAP 100', label: '' },
        { name: 'NIFTY SMLCAP 100', label: '' },
      ];
      for (const { name } of indices) {
        const data = await fetchNseIndex(name, cookies);
        for (const item of data) addStock(item);
        if (seen.size === portfolio.length) break;
      }
    }
  }

  console.log(`[PORTFOLIO] Final: ${allStocks.length} portfolio stocks fetched`);
  return allStocks;
}

// ── Fetch News for Portfolio ────────────────────────────────────────────
async function fetchPortfolioNews(portfolio: string[]): Promise<NewsItem[]> {
  try {
    const url = `${API_BASE}/api/v1/news`;
    console.log(`[PORTFOLIO] Fetching news from ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' } });
    if (r.ok) {
      const data = await r.json();
      const allNews = data.news || data.results || [];
      const portfolioSet = new Set(portfolio.map(t => t.toUpperCase()));

      const filtered = allNews.filter((n: any) => {
        const text = (n.title || n.headline || '').toUpperCase();
        return [...portfolioSet].some(t => text.includes(t));
      });

      return filtered.slice(0, 10).map((n: any) => ({
        title: n.title || n.headline || 'Untitled',
        source: n.source || 'Market Cockpit',
        timestamp: n.date || n.timestamp,
      }));
    }
  } catch (e) {
    console.error('[PORTFOLIO] News fetch failed:', e);
  }
  return [];
}

// ── Fetch Intelligence Signals for Portfolio ────────────────────────────
async function fetchPortfolioIntelligence(portfolio: string[]): Promise<any[]> {
  try {
    const pf = portfolio.join(',');
    const url = `${API_BASE}/api/market/intelligence?days=7&portfolio=${pf}`;
    console.log(`[PORTFOLIO] Fetching intelligence from ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json();
      const allSignals = data.signals || [];
      // Filter for portfolio stocks and ACTIONABLE/NOTABLE
      return allSignals.filter((s: any) =>
        s.isPortfolio &&
        (s.signalTierV7 === 'ACTIONABLE' || s.signalTierV7 === 'NOTABLE')
      ).slice(0, 10);
    }
  } catch (e) {
    console.error('[PORTFOLIO] Intelligence fetch failed:', e);
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Portfolio Pulse Card
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

async function generatePortfolioImage(stocks: Stock[]): Promise<ArrayBuffer> {
  const displayStocks = stocks.slice(0, 20);
  const timestamp = getISTTimestamp();
  const W = 1200;

  const ACCENT_H = 4;
  const HEADER_H = 72;
  const METRICS_H = 64;
  const COL_HEADER_H = 36;
  const ROW_H = 38;
  const FOOTER_H = 36;
  const totalHeight = ACCENT_H + HEADER_H + METRICS_H + COL_HEADER_H + displayStocks.length * ROW_H + FOOTER_H;

  // Sort by change percent descending
  const sorted = [...displayStocks].sort((a, b) => b.changePercent - a.changePercent);

  const gainers = stocks.filter(s => s.changePercent > 0).length;
  const losers = stocks.filter(s => s.changePercent < 0).length;
  const unchanged = stocks.length - gainers - losers;
  const avgChange = stocks.length > 0
    ? Math.round(stocks.reduce((sum, s) => sum + s.changePercent, 0) / stocks.length * 100) / 100
    : 0;

  // Best & worst performers
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const moodColor = avgChange > 0.3 ? '#10B981' : avgChange < -0.3 ? '#EF4444' : '#F59E0B';
  const moodLabel = avgChange > 0.3 ? 'BULLISH' : avgChange < -0.3 ? 'BEARISH' : 'NEUTRAL';

  // 52W range helper — position as pct (0-100) within 52w band
  const w52Pct = (s: Stock) => {
    if (!s.weekHigh52 || !s.weekLow52 || s.weekHigh52 === s.weekLow52) return null;
    return Math.max(0, Math.min(100, Math.round(((s.price - s.weekLow52) / (s.weekHigh52 - s.weekLow52)) * 100)));
  };

  const element = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: `${W}px`,
        height: `${totalHeight}px`,
        backgroundColor: '#080C14',
        fontFamily: 'Inter, Menlo, system-ui, sans-serif',
      }}
    >
      {/* ── Top accent gradient bar ── */}
      <div style={{ display: 'flex', width: '100%', height: `${ACCENT_H}px`, background: 'linear-gradient(90deg, #7C3AED 0%, #A855F7 40%, #C084FC 100%)' }} />

      {/* ── Header Row ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 28px 12px 28px',
          height: `${HEADER_H}px`,
        }}
      >
        {/* Left: Title block */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#7C3AED', fontSize: '20px' }}>
            P
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '22px', fontWeight: 800, color: '#F1F5F9', letterSpacing: '1px', textTransform: 'uppercase' as const }}>
              Portfolio Pulse
            </span>
            <span style={{ fontSize: '11px', color: '#64748B', letterSpacing: '0.5px', marginTop: '2px' }}>
              {displayStocks.length} HOLDINGS  ·  LIVE  ·  {timestamp}
            </span>
          </div>
        </div>

        {/* Right: Mood badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 14px',
            borderRadius: '6px',
            backgroundColor: avgChange > 0.3 ? '#052E16' : avgChange < -0.3 ? '#450A0A' : '#422006',
            border: `1px solid ${avgChange > 0.3 ? '#166534' : avgChange < -0.3 ? '#991B1B' : '#854D0E'}`,
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: moodColor, letterSpacing: '0.5px' }}>
              {moodLabel}
            </span>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 14px',
            borderRadius: '6px',
            backgroundColor: '#0F172A',
            border: '1px solid #1E293B',
          }}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: moodColor }}>
              {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Metrics Strip ── */}
      <div
        style={{
          display: 'flex',
          padding: '0 28px',
          height: `${METRICS_H}px`,
          gap: '12px',
        }}
      >
        {/* Gainers */}
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', padding: '10px 16px', backgroundColor: '#0A1A12', borderRadius: '8px', border: '1px solid #14532D' }}>
          <span style={{ fontSize: '11px', color: '#4ADE80', fontWeight: 600, letterSpacing: '0.5px' }}>GAINERS</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#22C55E', marginTop: '2px' }}>{gainers}</span>
        </div>
        {/* Losers */}
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', padding: '10px 16px', backgroundColor: '#1A0A0A', borderRadius: '8px', border: '1px solid #7F1D1D' }}>
          <span style={{ fontSize: '11px', color: '#F87171', fontWeight: 600, letterSpacing: '0.5px' }}>LOSERS</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#EF4444', marginTop: '2px' }}>{losers}</span>
        </div>
        {/* Unchanged */}
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', padding: '10px 16px', backgroundColor: '#0F172A', borderRadius: '8px', border: '1px solid #1E293B' }}>
          <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600, letterSpacing: '0.5px' }}>FLAT</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#CBD5E1', marginTop: '2px' }}>{unchanged}</span>
        </div>
        {/* Best Performer */}
        <div style={{ display: 'flex', flex: 2, flexDirection: 'column', justifyContent: 'center', padding: '10px 16px', backgroundColor: '#0A1A12', borderRadius: '8px', border: '1px solid #14532D' }}>
          <span style={{ fontSize: '11px', color: '#4ADE80', fontWeight: 600, letterSpacing: '0.5px' }}>TOP PERFORMER</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '2px' }}>
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#F1F5F9' }}>{best?.ticker || '—'}</span>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#22C55E' }}>+{best?.changePercent?.toFixed(1) || '0'}%</span>
          </div>
        </div>
        {/* Worst Performer */}
        <div style={{ display: 'flex', flex: 2, flexDirection: 'column', justifyContent: 'center', padding: '10px 16px', backgroundColor: '#1A0A0A', borderRadius: '8px', border: '1px solid #7F1D1D' }}>
          <span style={{ fontSize: '11px', color: '#F87171', fontWeight: 600, letterSpacing: '0.5px' }}>WORST PERFORMER</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '2px' }}>
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#F1F5F9' }}>{worst?.ticker || '—'}</span>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#EF4444' }}>{worst?.changePercent?.toFixed(1) || '0'}%</span>
          </div>
        </div>
      </div>

      {/* ── Column Headers ── */}
      <div
        style={{
          display: 'flex',
          padding: '8px 28px',
          marginTop: '8px',
          borderBottom: '1px solid #1E293B',
          fontSize: '10px',
          fontWeight: 700,
          color: '#64748B',
          letterSpacing: '1px',
          textTransform: 'uppercase' as const,
        }}
      >
        <span style={{ width: '30px' }}>#</span>
        <span style={{ width: '120px' }}>SYMBOL</span>
        <span style={{ width: '170px' }}>SECTOR</span>
        <span style={{ width: '100px', textAlign: 'right' }}>PRICE</span>
        <span style={{ width: '90px', textAlign: 'right' }}>CHG</span>
        <span style={{ width: '80px', textAlign: 'right' }}>%CHG</span>
        <span style={{ width: '120px', textAlign: 'right' }}>DAY RANGE</span>
        <span style={{ width: '180px', textAlign: 'center' }}>52W POSITION</span>
      </div>

      {/* ── Data Rows ── */}
      {sorted.map((s, i) => {
        const isPositive = s.changePercent >= 0;
        const pctColor = isPositive ? '#22C55E' : '#EF4444';
        const chgColor = isPositive ? '#15803D' : '#991B1B';
        const rangeText = s.dayHigh && s.dayLow
          ? `${s.dayLow.toFixed(0)} – ${s.dayHigh.toFixed(0)}`
          : '—';
        const pos52 = w52Pct(s);
        const barW = 120;
        const fillW = pos52 !== null ? Math.round((pos52 / 100) * barW) : 0;
        const barColor = pos52 !== null ? (pos52 > 70 ? '#22C55E' : pos52 > 40 ? '#F59E0B' : '#EF4444') : '#334155';

        return (
          <div
            key={i}
            style={{
              display: 'flex',
              padding: '8px 28px',
              backgroundColor: i % 2 === 0 ? '#0B1120' : '#080C14',
              fontSize: '13px',
              alignItems: 'center',
              borderBottom: '1px solid #111827',
              height: `${ROW_H}px`,
            }}
          >
            <span style={{ width: '30px', color: '#475569', fontSize: '11px', fontWeight: 600 }}>{i + 1}</span>
            <span style={{ width: '120px', fontWeight: 700, color: '#F1F5F9', fontSize: '13px', letterSpacing: '0.3px' }}>
              {truncate(s.ticker, 12)}
            </span>
            <span style={{ width: '170px', color: '#64748B', fontSize: '11px' }}>
              {truncate(s.sector, 22)}
            </span>
            <span style={{ width: '100px', textAlign: 'right', color: '#E2E8F0', fontSize: '13px', fontWeight: 600, fontFamily: 'Menlo, monospace' }}>
              {s.price.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
            </span>
            <span style={{ width: '90px', textAlign: 'right', color: pctColor, fontSize: '12px', fontFamily: 'Menlo, monospace' }}>
              {isPositive ? '+' : ''}{s.change.toFixed(1)}
            </span>
            <div style={{ display: 'flex', width: '80px', justifyContent: 'flex-end' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: isPositive ? '#052E16' : '#450A0A',
              }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: pctColor, fontFamily: 'Menlo, monospace' }}>
                  {isPositive ? '+' : ''}{s.changePercent.toFixed(1)}%
                </span>
              </div>
            </div>
            <span style={{ width: '120px', textAlign: 'right', color: '#94A3B8', fontSize: '11px', fontFamily: 'Menlo, monospace' }}>
              {rangeText}
            </span>
            {/* 52W position bar */}
            <div style={{ display: 'flex', width: '180px', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              {pos52 !== null ? (
                <>
                  <div style={{ display: 'flex', width: `${barW}px`, height: '6px', backgroundColor: '#1E293B', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', width: `${fillW}px`, height: '6px', backgroundColor: barColor, borderRadius: '3px' }} />
                  </div>
                  <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 600, fontFamily: 'Menlo, monospace', minWidth: '32px' }}>{pos52}%</span>
                </>
              ) : (
                <span style={{ fontSize: '10px', color: '#334155' }}>—</span>
              )}
            </div>
          </div>
        );
      })}

      {/* ── Footer ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 28px',
          backgroundColor: '#0B1120',
          fontSize: '10px',
          color: '#475569',
          borderTop: '1px solid #1E293B',
          marginTop: 'auto',
          letterSpacing: '0.5px',
        }}
      >
        <span>MARKET COCKPIT  ·  {displayStocks.length} HOLDINGS</span>
        <span>DATA: NSE INDIA  ·  LIVE</span>
        <span>@mc_portfolio_pulse_bot</span>
      </div>
    </div>
  );

  const response = new ImageResponse(element, {
    width: W,
    height: totalHeight,
  });

  return response.arrayBuffer();
}

// ── Telegram Send Functions ─────────────────────────────────────────────
async function sendTelegram(text: string, chatId?: string): Promise<{ ok: boolean; telegramResponse?: any; error?: string }> {
  const targetId = chatId || TG_CHAT_ID;
  const tgUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  console.log(`[PORTFOLIO] Sending text to chat=${targetId}, length=${text.length}`);

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
    console.log(`[PORTFOLIO] Telegram HTTP ${r.status}: ${responseText.slice(0, 500)}`);
    let result: any;
    try { result = JSON.parse(responseText); } catch { result = { ok: false, raw: responseText }; }
    if (!result.ok) {
      return { ok: false, telegramResponse: result, error: `Telegram returned ok=false: ${result.description || responseText.slice(0, 200)}` };
    }
    return { ok: true, telegramResponse: { ok: true, message_id: result.result?.message_id } };
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    console.error(`[PORTFOLIO] Telegram send EXCEPTION: ${errMsg}`);
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
  console.log(`[PORTFOLIO] Sending photo to chat=${targetId}, size=${imageBuffer.byteLength}`);

  try {
    const formData = new FormData();
    formData.append('chat_id', targetId);
    formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'portfolio.png');
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
    }

    const r = await fetch(tgUrl, { method: 'POST', body: formData });
    const result = await r.json();
    console.log(`[PORTFOLIO] Photo send: ${result.ok ? 'OK' : 'FAILED'} - ${result.description || ''}`);
    return { ok: result.ok, error: result.description };
  } catch (e: any) {
    console.error(`[PORTFOLIO] Photo send EXCEPTION: ${e.message}`);
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

// ── Build Portfolio Performance Message ─────────────────────────────────
function buildPortfolioMessage(stocks: Stock[], portfolio: string[]): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  const gainers = stocks.filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);
  const losers = stocks.filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);
  const avg = stocks.length > 0
    ? Math.round(stocks.reduce((sum, s) => sum + s.changePercent, 0) / stocks.length * 100) / 100
    : 0;

  const moodEmoji = avg > 0.5 ? '🟢' : avg < -0.5 ? '🔴' : '🟡';
  const moodText = avg > 0.5 ? 'BULLISH' : avg < -0.5 ? 'BEARISH' : 'NEUTRAL';

  const lines: string[] = [];
  const DIV = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

  lines.push(`${moodEmoji} <b>PORTFOLIO PULSE</b>  ·  <code>${moodText}</code>`);
  lines.push(`<i>${timeStr} IST  •  ${stocks.length}/${portfolio.length} holdings tracked</i>`);
  lines.push('');

  if (gainers.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>📈 Top Gainers</b>`);
    lines.push('');
    for (const s of gainers.slice(0, 5)) {
      lines.push(`  🟢 <b>${esc(s.ticker)}</b>  <code>+${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}`);
    }
    lines.push('');
  }

  if (losers.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>📉 Top Losers</b>`);
    lines.push('');
    for (const s of losers.slice(0, 5)) {
      lines.push(`  🔴 <b>${esc(s.ticker)}</b>  <code>${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}`);
    }
    lines.push('');
  }

  // 52-week high/low proximity
  const near52High = stocks.filter(s => s.weekHigh52 && s.price >= s.weekHigh52 * 0.95);
  const near52Low = stocks.filter(s => s.weekLow52 && s.price <= s.weekLow52 * 1.05);

  if (near52High.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>🏔 Near 52-Week High</b>`);
    for (const s of near52High.slice(0, 3)) {
      const pctFrom = s.weekHigh52 ? ((s.price / s.weekHigh52 - 1) * 100).toFixed(1) : '?';
      lines.push(`  ⬆️ <b>${esc(s.ticker)}</b>  ${fmtPrice(s.price)}  (${pctFrom}% from high)`);
    }
    lines.push('');
  }

  if (near52Low.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>⚠️ Near 52-Week Low</b>`);
    for (const s of near52Low.slice(0, 3)) {
      const pctFrom = s.weekLow52 ? ((s.price / s.weekLow52 - 1) * 100).toFixed(1) : '?';
      lines.push(`  ⬇️ <b>${esc(s.ticker)}</b>  ${fmtPrice(s.price)}  (+${pctFrom}% from low)`);
    }
    lines.push('');
  }

  lines.push(DIV);
  lines.push('');
  lines.push(`<b>📊 Portfolio Summary</b>`);
  lines.push(`Avg Change: <code>${fmtPct(avg, 2)}</code>`);
  lines.push(`Gainers: <b>${gainers.length}</b> | Losers: <b>${losers.length}</b>`);
  lines.push('');
  lines.push(`<i>/add SYMBOL — Add to portfolio</i>`);
  lines.push(`<i>/remove SYMBOL — Remove from portfolio</i>`);
  lines.push(`<i>/list — Show current holdings</i>`);

  return lines.join('\n');
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
        `💼 <b>MC Portfolio Pulse — Connected!</b>\n\nWelcome ${esc(firstName)}! Your portfolio tracker is live.\n\n📊 <b>What you'll receive:</b>\n• Real-time performance cards for YOUR holdings\n• Gainers &amp; losers in your portfolio\n• 52-week high/low proximity alerts\n• Intelligence signals for your stocks\n• Latest news for portfolio companies\n\n⏰ <b>Default Portfolio:</b>\n${DEFAULT_PORTFOLIO.slice(0, 8).join(', ')}, …\n\n💡 <b>Commands:</b>\n/add SYMBOL — Add holdings (space-separated)\n/remove SYMBOL — Remove holding\n/list — Show your portfolio\n/pulse — Get portfolio performance card\n/intel — Intelligence signals for your stocks\n/news — Latest news for portfolio\n/help — Show all commands\n/status — Bot status\n\n🌐 <a href="https://market-cockpit.vercel.app/portfolio">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `❓ <b>MC Portfolio Pulse — Help</b>\n\n<b>Commands:</b>\n/start — Welcome &amp; setup\n/add SYMBOL — Add holdings (space-separated, e.g. /add TCS INFY)\n/remove SYMBOL — Remove single holding\n/list — Show your current portfolio\n/pulse — Generate portfolio performance card\n/intel — Get intelligence signals for portfolio\n/news — Get latest news for portfolio companies\n/status — Bot status &amp; diagnostics\n/help — This help message\n\n<b>Examples:</b>\n<code>/add BAJAJFINSV BHARTIARTL</code> — Add two stocks\n<code>/remove TATAMOTORS</code> — Remove one\n<code>/list</code> — See all holdings\n\n<b>Scheduled Alerts:</b>\n⏰ Twice daily: 10:15 AM &amp; 3:15 PM IST\n📸 Portfolio performance card\n📰 Relevant news &amp; intelligence\n\n🌐 <a href="https://market-cockpit.vercel.app/portfolio">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/list') {
      const portfolio = await getPortfolio(chatId);
      const total = portfolio.length;
      const lines = [`💼 <b>Your Portfolio</b>  (${total} holdings)\n`];

      if (total <= 20) {
        for (let i = 0; i < total; i++) {
          lines.push(`${i + 1}. <code>${portfolio[i]}</code>`);
        }
      } else {
        for (let i = 0; i < total; i += 5) {
          const row = portfolio.slice(i, i + 5).map(s => `<code>${s}</code>`).join('  ');
          lines.push(row);
        }
      }
      lines.push('');
      lines.push(`💡 /add SYMBOL — Add holdings`);
      lines.push(`➖ /remove SYMBOL — Remove holding`);
      lines.push(`📸 /pulse — Performance card`);
      await sendTelegramTo(chatId, lines.join('\n'));
    } else if (text.startsWith('/add ')) {
      const toAdd = text.slice(5).trim().split(/[\s,]+/).map((t: string) => t.toUpperCase()).filter((t: string) => t.length > 0 && t.length < 30);
      if (toAdd.length === 0) {
        await sendTelegramTo(chatId, '❌ Please provide stock symbols. Example: <code>/add TCS INFY</code> or <code>/add TCS,INFY,WIPRO</code>');
      } else {
        const current = await getPortfolio(chatId);
        const before = current.length;
        const updated = [...new Set([...current, ...toAdd])];
        setPortfolio(chatId, updated);

        // Sync to shared API
        fetch(`${API_BASE}/api/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: `pf_${chatId}`, watchlist: updated, secret: BOT_SECRET }),
        }).catch(() => {});

        const added = updated.length - before;
        await sendTelegramTo(chatId,
          `✅ <b>Portfolio Updated</b>\n\n➕ Added: <code>${toAdd.join(', ')}</code>\n💼 Total holdings: <b>${updated.length}</b>\n\n<i>Your portfolio will be used for alerts and reports.</i>`
        );
      }
    } else if (text.startsWith('/remove ')) {
      const toRemove = text.slice(8).trim().toUpperCase();
      if (!toRemove) {
        await sendTelegramTo(chatId, '❌ Please provide a symbol. Example: <code>/remove HFCL</code>');
      } else {
        const current = await getPortfolio(chatId);
        const updated = current.filter(t => t !== toRemove);
        if (updated.length === current.length) {
          await sendTelegramTo(chatId, `❌ <b>${toRemove}</b> not found in your portfolio.`);
        } else {
          setPortfolio(chatId, updated);

          fetch(`${API_BASE}/api/watchlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: `pf_${chatId}`, watchlist: updated, secret: BOT_SECRET }),
          }).catch(() => {});

          await sendTelegramTo(chatId,
            `✅ <b>Removed</b>\n\n➖ Removed: <code>${toRemove}</code>\n💼 Total holdings: <b>${updated.length}</b>`
          );
        }
      }
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, '⏳ <i>Generating portfolio pulse card...</i>');
      const portfolio = await getPortfolio(chatId);
      const stocks = await fetchPortfolioStocks(portfolio);
      if (stocks.length === 0) {
        await sendTelegramTo(chatId, '💼 No portfolio data available. Market may be closed or symbols not found.');
      } else {
        try {
          const img = await generatePortfolioImage(stocks);
          const gainers = stocks.filter(s => s.changePercent > 0).length;
          const losers = stocks.filter(s => s.changePercent < 0).length;
          await sendTelegramPhoto(img, `💼 <b>${stocks.length} holdings</b> • ↑${gainers} ↓${losers} — <a href="https://market-cockpit.vercel.app/portfolio">Dashboard</a>`, chatId);
        } catch (e) {
          console.error('[PORTFOLIO] Image gen failed:', e);
          const msg = buildPortfolioMessage(stocks, portfolio);
          await sendTelegramTo(chatId, msg);
        }
      }
    } else if (text === '/intel') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching intelligence signals...</i>');
      const portfolio = await getPortfolio(chatId);
      const signals = await fetchPortfolioIntelligence(portfolio);
      if (signals.length === 0) {
        await sendTelegramTo(chatId, '🧠 No actionable intelligence signals for your portfolio right now.');
      } else {
        const lines = [`<b>🧠 Portfolio Intelligence</b>\n`];
        for (let i = 0; i < signals.length; i++) {
          const s = signals[i];
          const tier = s.signalTierV7 === 'ACTIONABLE' ? '🔴' : s.signalTierV7 === 'NOTABLE' ? '🟡' : '⚪';
          const action = s.action || 'MONITOR';
          const name = s.symbol || s.ticker || s.primaryTicker || '???';
          const company = s.company || s.companyName || '';
          const impact = s.impactLevel ? ` · ${s.impactLevel}` : '';
          const value = s.eventValueCr ? ` · ₹${s.eventValueCr} Cr` : '';
          lines.push(`${tier} <b>${esc(name)}</b>${company ? ` (${esc(truncate(company, 25))})` : ''}  <code>${action}</code>`);
          const desc = s.headline || s.narrative || s.summary || s.eventType || '';
          if (desc) lines.push(`   ${esc(truncate(desc, 80))}`);
          if (s.eventType) lines.push(`   <i>${s.eventType}${impact}${value}</i>`);
          lines.push('');
        }
        lines.push(`<i>Full analysis: <a href="https://market-cockpit.vercel.app/orders">Intelligence Dashboard</a></i>`);
        await sendTelegramTo(chatId, lines.join('\n'));
      }
    } else if (text === '/news') {
      await sendTelegramTo(chatId, '⏳ <i>Fetching latest news...</i>');
      const portfolio = await getPortfolio(chatId);
      const news = await fetchPortfolioNews(portfolio);
      if (news.length === 0) {
        await sendTelegramTo(chatId, '📰 No recent news for your portfolio holdings.');
      } else {
        const lines = [`<b>📰 Portfolio News</b>\n`];
        for (let i = 0; i < news.length; i++) {
          lines.push(`${i + 1}. ${esc(truncate(news[i].title, 80))}`);
          if (news[i].source) lines.push(`   <i>${news[i].source}</i>`);
        }
        await sendTelegramTo(chatId, lines.join('\n'));
      }
    } else if (text === '/status') {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const h = ist.getHours();
      const day = ist.getDay();
      const isMarketDay = day >= 1 && day <= 5;
      const isMarketHours = h >= 9 && h < 16;
      const portfolio = await getPortfolio(chatId);

      await sendTelegramTo(chatId,
        `⚙️ <b>MC Portfolio Pulse — Status</b>\n\n✅ Bot: Online\n🕒 IST: ${ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n${isMarketDay && isMarketHours ? '🟢 Market: Open' : '🔴 Market: Closed'}\n💼 Portfolio: <b>${portfolio.length}</b> holdings\n⏰ Alerts: 10:15 AM &amp; 3:15 PM IST (Mon–Fri)\n\n<i>Portfolio synced to cloud — persists across sessions.</i>`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[PORTFOLIO] Webhook error:', e);
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
  const portfolioParam = searchParams.get('portfolio');

  console.log(`[PORTFOLIO] Incoming request: mode=${searchParams.get('mode')}, secret=${secret ? 'provided' : 'missing'}`);
  diagnostics.steps.push('request_received');

  if (secret !== BOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized', hint: 'Add ?secret=mc-bot-2026 to the URL' }, { status: 401 });
  }
  diagnostics.steps.push('auth_passed');

  const mode = searchParams.get('mode') || 'full';
  let portfolio = DEFAULT_PORTFOLIO;

  if (portfolioParam) {
    portfolio = portfolioParam.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
    console.log(`[PORTFOLIO] Using URL portfolio: ${portfolio.join(',')}`);
  }

  if (mode === 'diag') {
    diagnostics.config = {
      tokenSet: !!TG_TOKEN && TG_TOKEN.length > 10,
      tokenEnds: TG_TOKEN.slice(-6),
      chatId: TG_CHAT_ID,
      apiBase: API_BASE,
      portfolioSize: portfolio.length,
    };
    return NextResponse.json({ ok: true, mode: 'diag', diagnostics, elapsed: Date.now() - startTime });
  }

  // Fetch portfolio stock data
  console.log(`[PORTFOLIO] Fetching data for ${portfolio.length} holdings...`);
  diagnostics.steps.push('fetching_data');

  const stocks = await fetchPortfolioStocks(portfolio);
  diagnostics.steps.push(`fetched_${stocks.length}_stocks`);

  if (stocks.length === 0) {
    console.warn('[PORTFOLIO] No stock data fetched!');
    const errMsg = await sendTelegram(
      `⚠️ <b>Portfolio Pulse</b>\n\nCould not fetch market data for ${portfolio.length} holdings.\nMarket may be closed or data unavailable.\n\n<i>Will retry on next schedule.</i>`
    );
    return NextResponse.json({ ok: false, reason: 'no_data', diagnostics, elapsed: Date.now() - startTime });
  }

  // Generate and send image
  try {
    const img = await generatePortfolioImage(stocks);
    diagnostics.steps.push('image_generated');

    const gainers = stocks.filter(s => s.changePercent > 0).length;
    const losers = stocks.filter(s => s.changePercent < 0).length;
    const photoResult = await sendTelegramPhoto(
      img,
      `💼 <b>${stocks.length} holdings</b> • ↑${gainers} ↓${losers} — <a href="https://market-cockpit.vercel.app/portfolio">Dashboard</a>`
    );
    diagnostics.steps.push(photoResult.ok ? 'photo_sent' : 'photo_failed');

    if (!photoResult.ok) {
      // Fallback to text
      const msg = buildPortfolioMessage(stocks, portfolio);
      const textResult = await sendTelegram(msg);
      diagnostics.steps.push(textResult.ok ? 'text_fallback_sent' : 'text_fallback_failed');
    }
  } catch (e: any) {
    console.error('[PORTFOLIO] Image generation failed:', e);
    diagnostics.steps.push('image_error');
    const msg = buildPortfolioMessage(stocks, portfolio);
    await sendTelegram(msg);
  }

  // Also send intelligence signals if available
  if (mode === 'full') {
    try {
      const signals = await fetchPortfolioIntelligence(portfolio);
      if (signals.length > 0) {
        const lines = [`<b>🧠 Portfolio Intelligence</b>\n`];
        for (const s of signals.slice(0, 5)) {
          const tier = s.signalTierV7 === 'ACTIONABLE' ? '🔴' : s.signalTierV7 === 'NOTABLE' ? '🟡' : '⚪';
          const action = s.action || 'MONITOR';
          const name = s.symbol || s.ticker || s.primaryTicker || '???';
          const company = s.company || s.companyName || '';
          const impact = s.impactLevel ? ` · ${s.impactLevel}` : '';
          const value = s.eventValueCr ? ` · ₹${s.eventValueCr} Cr` : '';
          lines.push(`${tier} <b>${esc(name)}</b>${company ? ` (${esc(truncate(company, 25))})` : ''}  <code>${action}</code>`);
          const desc = s.headline || s.narrative || s.summary || s.eventType || '';
          if (desc) lines.push(`   ${esc(truncate(desc, 80))}`);
          if (s.eventType) lines.push(`   <i>${s.eventType}${impact}${value}</i>`);
          lines.push('');
        }
        lines.push(`<a href="https://market-cockpit.vercel.app/orders">Full Intelligence →</a>`);
        await sendTelegram(lines.join('\n'));
        diagnostics.steps.push('intel_sent');
      }
    } catch (e) {
      console.warn('[PORTFOLIO] Intel fetch failed:', e);
    }
  }

  // Fetch and send news
  try {
    const news = await fetchPortfolioNews(portfolio);
    diagnostics.steps.push(`news_fetched_${news.length}`);

    if (news.length > 0) {
      const newsLines = [`<b>📰 Portfolio News</b>\n`];
      for (let i = 0; i < Math.min(news.length, 8); i++) {
        newsLines.push(`${i + 1}. ${esc(truncate(news[i].title, 80))}`);
        if (news[i].source) newsLines.push(`   <i>${news[i].source}</i>`);
      }
      const newsResult = await sendTelegram(newsLines.join('\n'));
      diagnostics.steps.push(newsResult.ok ? 'news_sent' : 'news_failed');
    }
  } catch (e) {
    console.warn('[PORTFOLIO] News fetch failed:', e);
    diagnostics.steps.push('news_error');
  }

  return NextResponse.json({
    ok: true,
    mode,
    portfolio: portfolio.length,
    stocksFetched: stocks.length,
    diagnostics,
    elapsed: Date.now() - startTime,
  });
}
