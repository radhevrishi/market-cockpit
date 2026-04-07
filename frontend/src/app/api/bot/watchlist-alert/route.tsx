import { NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import React from 'react';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Config ──────────────────────────────────────────────────────────────
const TG_TOKEN = '8681784264:AAG7OV3ibS4r89Lbrta50NkWnJSCTrtoS80';
const TG_CHAT_ID = '5057319640';
const BOT_SECRET = process.env.MC_BOT_SECRET || 'mc-bot-2026';
const API_BASE = 'https://market-cockpit.vercel.app';

// ── Default Watchlist ───────────────────────────────────────────────────
const DEFAULT_WATCHLIST = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'BAJFINANCE', 'TATAMOTORS', 'WIPRO', 'SBIN', 'LT',
  'ITC', 'MARUTI', 'TITAN', 'AXISBANK', 'SUNPHARMA'
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

interface Watchlist {
  stocks: string[];
  addedAt: number;
}

// ── In-Memory Watchlist Storage (with API sync) ────────────────────────
const watchlistStorage: Record<string, Watchlist> = {};
let apiSyncDone: Record<string, boolean> = {};

async function getWatchlist(chatId: string): Promise<string[]> {
  // Try to load from shared API on first access (survives cold starts)
  if (!apiSyncDone[chatId]) {
    apiSyncDone[chatId] = true;
    try {
      const res = await fetch(`${API_BASE}/api/watchlist?chatId=${chatId}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.watchlist && Array.isArray(data.watchlist) && data.watchlist.length > 0) {
          watchlistStorage[chatId] = { stocks: data.watchlist, addedAt: Date.now() };
          console.log(`[WATCHLIST] Loaded ${data.watchlist.length} stocks from API for ${chatId}`);
          return data.watchlist;
        }
      }
    } catch (e) {
      console.warn('[WATCHLIST] API sync failed, using local:', e);
    }
  }

  if (!watchlistStorage[chatId]) {
    watchlistStorage[chatId] = {
      stocks: [...DEFAULT_WATCHLIST],
      addedAt: Date.now(),
    };
  }
  return watchlistStorage[chatId].stocks;
}

function setWatchlist(chatId: string, stocks: string[]): void {
  const unique = [...new Set(stocks.map(s => s.trim().toUpperCase()).filter(s => s.length > 0 && s.length < 30))];
  watchlistStorage[chatId] = {
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
    console.error(`[WATCHLIST] NSE fetch ${indexName} failed:`, e);
  }
  return [];
}

// ── Fetch Watchlist Stocks ──────────────────────────────────────────────
async function fetchWatchlistStocks(watchlist: string[]): Promise<Stock[]> {
  const watchlistSet = new Set(watchlist.map(t => t.toUpperCase()));
  const allStocks: Stock[] = [];
  const seen = new Set<string>();

  function addStock(s: any) {
    const tk = (s.ticker || s.symbol || '').trim().toUpperCase();
    if (!tk || !watchlistSet.has(tk) || seen.has(tk)) return;
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
    console.log(`[WATCHLIST] Fetching ALL stocks: ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' } });
    if (r.ok) {
      const data = await r.json();
      const stocks = data.stocks || [];
      console.log(`[WATCHLIST] All stocks: ${stocks.length} returned, filtering for watchlist`);
      for (const s of stocks) addStock(s);
    }
  } catch (e) {
    console.error('[WATCHLIST] Full market fetch failed:', e);
  }

  // Step 2: NSE fallback for missing stocks
  if (seen.size < watchlist.length) {
    const missing = [...watchlistSet].filter(t => !seen.has(t));
    console.log(`[WATCHLIST] ${missing.length} stocks still missing, trying NSE...`);
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
        if (seen.size === watchlist.length) break;
      }
    }
  }

  console.log(`[WATCHLIST] Final: ${allStocks.length} watchlist stocks fetched`);
  return allStocks;
}

// ── Fetch News for Watchlist ────────────────────────────────────────────
async function fetchWatchlistNews(watchlist: string[]): Promise<NewsItem[]> {
  try {
    // Use intelligence API as news source (the /api/v1/news endpoint doesn't exist)
    const wl = watchlist.join(',');
    const url = `${API_BASE}/api/market/intelligence?days=7&portfolio=${wl}`;
    console.log(`[WATCHLIST] Fetching news/intelligence from ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json();
      const allSignals = data.signals || [];

      const watchlistSet = new Set(watchlist.map(t => t.toUpperCase()));
      const newsItems: NewsItem[] = allSignals
        .filter((s: any) => {
          const sym = (s.symbol || s.ticker || s.primaryTicker || '').toUpperCase();
          return s.isPortfolio || watchlistSet.has(sym);
        })
        .slice(0, 15)
        .map((s: any) => ({
          title: s.headline || s.narrative || s.summary || `${s.symbol || s.ticker}: ${s.eventType || 'Update'}`,
          source: s.eventType || s.signalClass || 'Intelligence',
          timestamp: s.date || s.timestamp,
        }));

      return newsItems;
    }
  } catch (e) {
    console.error('[WATCHLIST] News/intelligence fetch failed:', e);
  }

  // Fallback: Try NSE corporate announcements
  try {
    const cookies = await getNseCookies();
    if (cookies) {
      const announcements: NewsItem[] = [];
      for (const symbol of watchlist.slice(0, 5)) {
        try {
          const url = `${NSE_BASE}/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`;
          const r = await fetch(url, { headers: { ...NSE_HEADERS, Cookie: cookies }, signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const data = await r.json();
            const items = (Array.isArray(data) ? data : data?.data || []).slice(0, 3);
            for (const item of items) {
              announcements.push({
                title: `${symbol}: ${item.desc || item.subject || 'Corporate Announcement'}`,
                source: 'NSE Filing',
                timestamp: item.an_dt || item.date,
              });
            }
          }
        } catch {}
      }
      if (announcements.length > 0) return announcements.slice(0, 10);
    }
  } catch {}

  return [];
}

// ══════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Watchlist Pulse Card
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

async function generateWatchlistImage(stocks: Stock[]): Promise<ArrayBuffer> {
  const displayStocks = stocks.slice(0, 60);
  const timestamp = getISTTimestamp();
  const W = 1200;

  const ACCENT_H = 2;
  const HEADER_H = 60;
  const KPI_STRIP_H = 40;
  const COL_HEADER_H = 32;
  const ROW_H = 36;
  const TIER_HEADER_H = 28;
  const FOOTER_H = 30;

  // Sort by changePercent descending
  const sorted = [...displayStocks].sort((a, b) => b.changePercent - a.changePercent);

  // Define tier thresholds
  interface Tier {
    label: string;
    min: number;
    max: number;
    color: string;
    bgLight: string;
    textColor: string;
  }

  const tiers: Tier[] = [
    { label: 'STRONG GAINERS', min: 3, max: Infinity, color: '#22C55E', bgLight: '#14532D15', textColor: '#22C55E' },
    { label: 'GAINERS', min: 0.5, max: 3, color: '#4ADE80', bgLight: '#1B673B15', textColor: '#4ADE80' },
    { label: 'FLAT', min: -0.5, max: 0.5, color: '#64748B', bgLight: '#334155', textColor: '#64748B' },
    { label: 'LOSERS', min: -3, max: -0.5, color: '#F87171', bgLight: '#7F1D1D15', textColor: '#F87171' },
    { label: 'STRONG LOSERS', min: -Infinity, max: -3, color: '#EF4444', bgLight: '#7F1D1D20', textColor: '#EF4444' },
  ];

  // Group stocks by tier
  const groupedStocks: Array<{ tier: Tier; stocks: Stock[] }> = [];
  for (const tier of tiers) {
    const tierStocks = sorted.filter(s => s.changePercent >= tier.min && s.changePercent < tier.max);
    if (tierStocks.length > 0) {
      groupedStocks.push({ tier, stocks: tierStocks });
    }
  }

  // Calculate total content height
  let contentHeight = 0;
  for (const { stocks: tierStocks } of groupedStocks) {
    contentHeight += TIER_HEADER_H + tierStocks.length * ROW_H;
  }
  const totalHeight = ACCENT_H + HEADER_H + KPI_STRIP_H + COL_HEADER_H + contentHeight + FOOTER_H;

  // Metrics for KPI
  const gainers = displayStocks.filter(s => s.changePercent > 0).length;
  const losers = displayStocks.filter(s => s.changePercent < 0).length;
  const flatCount = displayStocks.filter(s => s.changePercent === 0).length;
  const avgChange = displayStocks.length > 0
    ? Math.round(displayStocks.reduce((sum, s) => sum + s.changePercent, 0) / displayStocks.length * 100) / 100
    : 0;

  const element = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: `${W}px`,
        height: `${totalHeight}px`,
        backgroundColor: '#0F172A',
        fontFamily: 'sans-serif',
      }}
    >
      {/* ── Top accent bar (2px) ── */}
      <div style={{ display: 'flex', width: '100%', height: `${ACCENT_H}px`, backgroundColor: '#22C55E' }} />

      {/* ── Header Row ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '16px',
          paddingBottom: '12px',
          height: `${HEADER_H}px`,
          backgroundColor: '#111827',
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          borderBottomColor: '#1F2937',
        }}
      >
        {/* Left: Title */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: '#E5E7EB', letterSpacing: '1px', textTransform: 'uppercase' as const }}>
            WATCHLIST PULSE
          </span>
          <span style={{ fontSize: '12px', color: '#9CA3AF', letterSpacing: '0.5px', marginTop: '2px' }}>
            {timestamp}
          </span>
        </div>

        {/* Right: Quick KPI inline */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#9CA3AF', marginRight: '16px', fontWeight: 700 }}>
            {displayStocks.length} Stocks
          </span>
          <span style={{ fontSize: '13px', color: '#22C55E', marginRight: '16px', fontWeight: 700 }}>
            {gainers} Up
          </span>
          <span style={{ fontSize: '13px', color: '#EF4444', marginRight: '16px', fontWeight: 700 }}>
            {losers} Down
          </span>
          {flatCount > 0 && (
            <span style={{ fontSize: '13px', color: '#9CA3AF', marginRight: '16px', fontWeight: 700 }}>
              {flatCount} Flat
            </span>
          )}
          <span style={{ fontSize: '13px', color: avgChange >= 0 ? '#22C55E' : '#EF4444', fontWeight: 700 }}>
            Avg: {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* ── KPI strip (flows into table) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '10px',
          paddingBottom: '10px',
          height: `${KPI_STRIP_H}px`,
          backgroundColor: '#0F172A',
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          borderBottomColor: '#1F2937',
        }}
      >
        <span style={{ display: 'flex', fontSize: '13px', color: '#E5E7EB', marginRight: '24px', fontWeight: 700 }}>
          <span style={{ color: '#9CA3AF', marginRight: '6px', fontWeight: 700 }}>Total:</span>
          <span>{displayStocks.length}</span>
        </span>
        <span style={{ display: 'flex', fontSize: '13px', color: '#22C55E', marginRight: '24px', fontWeight: 700 }}>
          <span style={{ color: '#9CA3AF', marginRight: '4px', fontWeight: 700 }}>Up:</span>
          <span>{gainers}</span>
        </span>
        <span style={{ display: 'flex', fontSize: '13px', color: '#EF4444', marginRight: '24px', fontWeight: 700 }}>
          <span style={{ color: '#9CA3AF', marginRight: '4px', fontWeight: 700 }}>Down:</span>
          <span>{losers}</span>
        </span>
        {flatCount > 0 && (
          <span style={{ display: 'flex', fontSize: '13px', color: '#9CA3AF', marginRight: '24px', fontWeight: 700 }}>
            <span style={{ color: '#9CA3AF', marginRight: '4px', fontWeight: 700 }}>Flat:</span>
            <span>{flatCount}</span>
          </span>
        )}
        <span style={{ display: 'flex', fontSize: '13px', color: avgChange >= 0 ? '#22C55E' : '#EF4444', fontWeight: 700 }}>
          <span style={{ color: '#9CA3AF', marginRight: '4px', fontWeight: 700 }}>Avg:</span>
          <span>{avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%</span>
        </span>
      </div>

      {/* ── Column Headers ── */}
      <div
        style={{
          display: 'flex',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '8px',
          paddingBottom: '8px',
          height: `${COL_HEADER_H}px`,
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          borderBottomColor: '#1F2937',
          fontSize: '12px',
          fontWeight: 700,
          color: '#64748B',
          letterSpacing: '0.5px',
          textTransform: 'uppercase' as const,
          backgroundColor: '#0F172A',
        }}
      >
        <span style={{ display: 'flex', width: '35px', marginRight: '16px', fontWeight: 700 }}>
          {/* Centered # */}
        </span>
        <span style={{ display: 'flex', width: '110px', marginRight: '12px', fontWeight: 700 }}>Symbol</span>
        <span style={{ display: 'flex', width: '95px', marginRight: '12px', justifyContent: 'flex-end', fontWeight: 700 }}>%Chg</span>
        <span style={{ display: 'flex', width: '100px', marginRight: '12px', justifyContent: 'flex-end', fontWeight: 700 }}>Price</span>
        <span style={{ display: 'flex', width: '80px', marginRight: '12px', justifyContent: 'flex-end', fontWeight: 700 }}>Change</span>
        <span style={{ display: 'flex', flex: 1, fontWeight: 700 }}>Sector</span>
      </div>

      {/* ── Tier Groups ── */}
      {groupedStocks.map(({ tier, stocks: tierStocks }) => (
        <div key={tier.label} style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Tier Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '20px',
              paddingRight: '20px',
              paddingTop: '6px',
              paddingBottom: '6px',
              height: `${TIER_HEADER_H}px`,
              backgroundColor: tier.bgLight,
              borderBottomWidth: '1px',
              borderBottomStyle: 'solid',
              borderBottomColor: '#1F2937',
              fontSize: '12px',
              fontWeight: 700,
              color: tier.color,
              letterSpacing: '1px',
              textTransform: 'uppercase' as const,
            }}
          >
            {/* Left colored bar (4px) */}
            <div style={{ display: 'flex', width: '4px', height: '20px', backgroundColor: tier.color, marginRight: '12px' }} />
            {/* Tier label */}
            <span style={{ display: 'flex', flex: 1, color: tier.color }}>
              {tier.label}
            </span>
            {/* Count on right */}
            <span style={{ display: 'flex', color: tier.color }}>
              {tierStocks.length}
            </span>
          </div>

          {/* Data rows for this tier */}
          {tierStocks.map((s, i) => {
            const isPositive = s.changePercent > 0;
            const isNeutral = s.changePercent === 0;
            const isBigMover = Math.abs(s.changePercent) >= 2;

            // Determine row colors
            let textColor = '#64748B';
            let boldColor = '#64748B';
            if (s.changePercent >= 3) {
              textColor = '#22C55E';
              boldColor = '#22C55E';
            } else if (s.changePercent > 0.5) {
              textColor = '#4ADE80';
              boldColor = '#4ADE80';
            } else if (s.changePercent < -3) {
              textColor = '#EF4444';
              boldColor = '#EF4444';
            } else if (s.changePercent < -0.5) {
              textColor = '#F87171';
              boldColor = '#F87171';
            }

            const rowBg = i % 2 === 0 ? '#0F172A' : '#111827';

            return (
              <div
                key={`${tier.label}-${i}`}
                style={{
                  display: 'flex',
                  paddingLeft: '20px',
                  paddingRight: '20px',
                  paddingTop: '6px',
                  paddingBottom: '6px',
                  backgroundColor: rowBg,
                  fontSize: '14px',
                  alignItems: 'center',
                  height: `${ROW_H}px`,
                  fontFamily: 'sans-serif',
                }}
              >
                {/* # Index */}
                <span style={{ display: 'flex', width: '35px', marginRight: '16px', color: '#9CA3AF', fontSize: '13px', fontFamily: 'monospace' }}>
                  {/* Empty or centered number */}
                </span>

                {/* Symbol (bold) */}
                <span style={{ display: 'flex', width: '110px', marginRight: '12px', fontWeight: 700, color: '#E5E7EB', fontSize: '14px', fontFamily: 'sans-serif' }}>
                  {truncate(s.ticker, 10)}
                </span>

                {/* %Change (bold, colored, monospace, right-aligned) */}
                <span style={{ display: 'flex', width: '95px', marginRight: '12px', justifyContent: 'flex-end', color: boldColor, fontSize: '14px', fontWeight: 700, fontFamily: 'monospace' }}>
                  <span>
                    {isPositive ? '+' : ''}{s.changePercent.toFixed(1)}%
                    {isBigMover && <span style={{ marginLeft: '4px', color: '#F59E0B' }}>●</span>}
                  </span>
                </span>

                {/* Price (bold, monospace, right-aligned) */}
                <span style={{ display: 'flex', width: '100px', marginRight: '12px', justifyContent: 'flex-end', color: '#E5E7EB', fontSize: '14px', fontFamily: 'monospace', fontWeight: 700 }}>
                  {s.price.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                </span>

                {/* Change (colored, monospace, right-aligned) */}
                <span style={{ display: 'flex', width: '80px', marginRight: '12px', justifyContent: 'flex-end', color: textColor, fontSize: '14px', fontFamily: 'monospace', fontWeight: 700 }}>
                  <span>{isPositive ? '+' : ''}{s.change.toFixed(1)}</span>
                </span>

                {/* Sector (left-aligned, muted) */}
                <span style={{ display: 'flex', flex: 1, color: '#9CA3AF', fontSize: '13px', fontFamily: 'sans-serif' }}>
                  {truncate(s.sector, 20)}
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Footer ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '6px',
          paddingBottom: '6px',
          backgroundColor: '#0F172A',
          fontSize: '10px',
          color: '#64748B',
          borderTopWidth: '1px',
          borderTopStyle: 'solid',
          borderTopColor: '#1F2937',
          height: `${FOOTER_H}px`,
          letterSpacing: '0.5px',
        }}
      >
        <span style={{ display: 'flex', fontWeight: 700 }}>market-cockpit.vercel.app</span>
        <span style={{ display: 'flex', fontWeight: 700 }}>{timestamp}</span>
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
  console.log(`[WATCHLIST] Sending text to chat=${targetId}, length=${text.length}`);

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
    console.log(`[WATCHLIST] Telegram HTTP ${r.status}: ${responseText.slice(0, 500)}`);
    let result: any;
    try { result = JSON.parse(responseText); } catch { result = { ok: false, raw: responseText }; }
    if (!result.ok) {
      return { ok: false, telegramResponse: result, error: `Telegram returned ok=false: ${result.description || responseText.slice(0, 200)}` };
    }
    return { ok: true, telegramResponse: { ok: true, message_id: result.result?.message_id } };
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    console.error(`[WATCHLIST] Telegram send EXCEPTION: ${errMsg}`);
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
  console.log(`[WATCHLIST] Sending photo to chat=${targetId}, size=${imageBuffer.byteLength}`);

  try {
    const formData = new FormData();
    formData.append('chat_id', targetId);
    formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'watchlist.png');
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
    }

    const r = await fetch(tgUrl, { method: 'POST', body: formData });
    const result = await r.json();
    console.log(`[WATCHLIST] Photo send: ${result.ok ? 'OK' : 'FAILED'} - ${result.description || ''}`);
    return { ok: result.ok, error: result.description };
  } catch (e: any) {
    console.error(`[WATCHLIST] Photo send EXCEPTION: ${e.message}`);
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

// ── Build Watchlist Status Message ──────────────────────────────────────
function buildWatchlistMessage(stocks: Stock[], watchlist: string[]): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  const gainers = stocks.filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);
  const losers = stocks.filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);
  const avg = stocks.length > 0
    ? Math.round(stocks.reduce((sum, s) => sum + s.changePercent, 0) / stocks.length * 100) / 100
    : 0;

  const moodText = avg > 0.5 ? 'BULLISH' : avg < -0.5 ? 'BEARISH' : 'NEUTRAL';
  const moodMark = avg > 0.5 ? '[+]' : avg < -0.5 ? '[-]' : '[~]';

  const lines: string[] = [];
  const DIV = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

  lines.push(`${moodMark} <b>WATCHLIST PULSE</b>  ·  <code>${moodText}</code>`);
  lines.push(`<i>${timeStr} IST  •  ${stocks.length}/${watchlist.length} stocks tracked</i>`);
  lines.push('');

  if (gainers.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>Top Gainers</b>`);
    lines.push('');
    for (const s of gainers.slice(0, 5)) {
      lines.push(`  [+] <b>${esc(s.ticker)}</b>  <code>+${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}`);
    }
    lines.push('');
  }

  if (losers.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>Top Losers</b>`);
    lines.push('');
    for (const s of losers.slice(0, 5)) {
      lines.push(`  [-] <b>${esc(s.ticker)}</b>  <code>${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}`);
    }
    lines.push('');
  }

  lines.push(DIV);
  lines.push('');
  lines.push(`<b>Summary</b>`);
  lines.push(`Avg Change: <code>${fmtPct(avg, 2)}</code>`);
  lines.push(`Gainers: <b>${gainers.length}</b> | Losers: <b>${losers.length}</b>`);
  lines.push('');
  lines.push(`<i>/watch SYMBOL — Add to watchlist</i>`);
  lines.push(`<i>/unwatch SYMBOL — Remove from watchlist</i>`);
  lines.push(`<i>/list — Show current watchlist</i>`);

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
        `<b>MC Watchlist Pulse — Connected!</b>\n\nWelcome ${esc(firstName)}! Your personal stock watchlist tracker is live.\n\n<b>What you will receive:</b>\n• Real-time performance cards for YOUR stocks\n• Sector breakdown &amp; day ranges\n• Gainers &amp; losers from your watchlist\n• Latest news for your tracked companies\n\n<b>Default Watchlist:</b>\n${DEFAULT_WATCHLIST.slice(0, 8).join(', ')}, …\n\n<b>Commands:</b>\n/watch SYMBOL — Add stocks (space-separated)\n/unwatch SYMBOL — Remove stock\n/list — Show your watchlist\n/pulse — Get watchlist performance card\n/news — Latest news for your stocks\n/help — Show all commands\n/status — Bot status\n\n<a href="https://market-cockpit.vercel.app">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `<b>MC Watchlist Pulse — Help</b>\n\n<b>Commands:</b>\n/start — Welcome &amp; setup\n/watch SYMBOL — Add stocks (space-separated, e.g. /watch TCS INFY)\n/unwatch SYMBOL — Remove single stock\n/list — Show your current watchlist\n/pulse — Generate performance card for your stocks\n/news — Get latest news for watchlist stocks\n/status — Bot status &amp; diagnostics\n/help — This help message\n\n<b>Examples:</b>\n<code>/watch BAJAJFINSV BHARTIARTL</code> — Add two stocks\n<code>/unwatch TATAMOTORS</code> — Remove one\n<code>/list</code> — See all tracked stocks\n\n<b>Scheduled Alerts:</b>\nTwice daily: 10:05 AM &amp; 3:05 PM IST\nWatchlist performance card\nRelevant news\n\n<a href="https://market-cockpit.vercel.app">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/list') {
      const watchlist = await getWatchlist(chatId);
      const total = watchlist.length;
      const lines = [`<b>Your Watchlist</b>  (${total} stocks)\n`];

      if (total <= 20) {
        // Short list: numbered format
        for (let i = 0; i < total; i++) {
          lines.push(`${i + 1}. <code>${watchlist[i]}</code>`);
        }
      } else {
        // Large list: compact grid format (5 per row)
        for (let i = 0; i < total; i += 5) {
          const row = watchlist.slice(i, i + 5).map(s => `<code>${s}</code>`).join('  ');
          lines.push(row);
        }
      }
      lines.push('');
      lines.push(`/watch SYMBOL — Add stocks`);
      lines.push(`/unwatch SYMBOL — Remove stock`);
      lines.push(`/pulse — Performance card`);
      await sendTelegramTo(chatId, lines.join('\n'));
    } else if (text.startsWith('/watch ')) {
      // Support both comma and space separators: /watch TCS INFY or /watch TCS,INFY,WIPRO
      const toAdd = text.slice(7).trim().split(/[\s,]+/).map((t: string) => t.toUpperCase()).filter((t: string) => t.length > 0 && t.length < 30);
      if (toAdd.length === 0) {
        await sendTelegramTo(chatId, '[X] Please provide stock symbols. Example: <code>/watch TCS INFY</code> or <code>/watch TCS,INFY,WIPRO</code>');
      } else {
        const current = await getWatchlist(chatId);
        const before = current.length;
        const updated = [...new Set([...current, ...toAdd])];
        setWatchlist(chatId, updated);

        // Sync to shared API
        fetch(`${API_BASE}/api/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, watchlist: updated, secret: BOT_SECRET }),
        }).catch(() => {});

        const added = updated.length - before;
        await sendTelegramTo(chatId,
          `[OK] <b>Watchlist Updated</b>\n\nAdded: <code>${toAdd.join(', ')}</code>\nTotal stocks: <b>${updated.length}</b>\n\n<i>Your watchlist will be used for alerts and reports.</i>`
        );
      }
    } else if (text.startsWith('/unwatch ')) {
      const toRemove = text.slice(9).trim().toUpperCase();
      if (!toRemove) {
        await sendTelegramTo(chatId, '[X] Please provide a symbol. Example: <code>/unwatch RELIANCE</code>');
      } else {
        const current = await getWatchlist(chatId);
        const updated = current.filter(t => t !== toRemove);
        if (updated.length === current.length) {
          await sendTelegramTo(chatId, `[X] <b>${toRemove}</b> not found in your watchlist.`);
        } else {
          setWatchlist(chatId, updated);

          // Sync to shared API
          fetch(`${API_BASE}/api/watchlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, watchlist: updated, secret: BOT_SECRET }),
          }).catch(() => {});

          await sendTelegramTo(chatId,
            `[OK] <b>Removed</b>\n\nRemoved: <code>${toRemove}</code>\nTotal stocks: <b>${updated.length}</b>`
          );
        }
      }
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, 'Generating watchlist pulse card...');
      const watchlist = await getWatchlist(chatId);
      const stocks = await fetchWatchlistStocks(watchlist);
      if (stocks.length === 0) {
        await sendTelegramTo(chatId, 'No watchlist data available. Market may be closed or symbols not found.');
      } else {
        try {
          const img = await generateWatchlistImage(stocks);
          const gainers = stocks.filter(s => s.changePercent > 0).length;
          const losers = stocks.filter(s => s.changePercent < 0).length;
          await sendTelegramPhoto(img, `<b>${stocks.length} stocks</b> • Gainers: ${gainers} | Losers: ${losers} — <a href="https://market-cockpit.vercel.app">Dashboard</a>`, chatId);
        } catch (e) {
          console.error('[WATCHLIST] Image gen failed:', e);
          // Fallback to text
          const lines = [`<b>WATCHLIST PERFORMANCE</b>\n`];
          const sorted = [...stocks].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
          for (const s of sorted.slice(0, 15)) {
            const dir = s.changePercent >= 0 ? '>>' : '<<';
            lines.push(`${dir} <b>${s.ticker}</b>  <code>${fmtPct(s.changePercent)}</code>  ${fmtPrice(s.price)}`);
          }
          await sendTelegramTo(chatId, lines.join('\n'));
        }
      }
    } else if (text === '/news') {
      await sendTelegramTo(chatId, 'Fetching latest news...');
      const watchlist = await getWatchlist(chatId);
      const news = await fetchWatchlistNews(watchlist);
      if (news.length === 0) {
        await sendTelegramTo(chatId, 'No recent news for your watchlist stocks.');
      } else {
        const lines = [`<b>Latest News</b>\n`];
        for (let i = 0; i < news.length; i++) {
          lines.push(`${i + 1}. ${esc(truncate(news[i].title, 80))}`);
          if (news[i].source) lines.push(`   <i>Type: ${news[i].source}</i>`);
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
      const watchlist = await getWatchlist(chatId);

      await sendTelegramTo(chatId,
        `<b>MC Watchlist Pulse — Status</b>\n\n[OK] Bot: Online\nIST: ${ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n${isMarketDay && isMarketHours ? '[OPEN] Market: Open' : '[CLOSED] Market: Closed'}\nWatchlist: <b>${watchlist.length}</b> stocks\nAlerts: 10:05 AM &amp; 3:05 PM IST (Mon–Fri)\n\n<i>Watchlist synced to cloud — persists across sessions.</i>`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[WATCHLIST] Webhook error:', e);
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
  const watchlistParam = searchParams.get('watchlist');

  console.log(`[WATCHLIST] Incoming request: mode=${searchParams.get('mode')}, secret=${secret ? 'provided' : 'missing'}`);
  diagnostics.steps.push('request_received');

  if (secret !== BOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized', hint: 'Add ?secret=mc-bot-2026 to the URL' }, { status: 401 });
  }
  diagnostics.steps.push('auth_passed');

  const mode = searchParams.get('mode') || 'full';
  let watchlist = DEFAULT_WATCHLIST;

  // Allow override via URL param for scheduled tasks
  if (watchlistParam) {
    watchlist = watchlistParam.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
    console.log(`[WATCHLIST] Using URL watchlist: ${watchlist.join(',')}`);
  }

  if (mode === 'diag') {
    diagnostics.config = {
      tokenSet: !!TG_TOKEN && TG_TOKEN.length > 10,
      tokenEnds: TG_TOKEN.slice(-6),
      chatId: TG_CHAT_ID,
      apiBase: API_BASE,
      watchlistSize: watchlist.length,
    };
    return NextResponse.json({ ok: true, mode: 'diag', diagnostics, elapsed: Date.now() - startTime });
  }

  if (mode === 'test') {
    diagnostics.steps.push('sending_test_message');
    const result = await sendTelegram(
      '[OK] <b>Market Cockpit Watchlist Pulse Connected</b>\n\nYour watchlist alerts are active!\n\nPerformance card — Your tracked stocks\nRelevant news headlines\n\nTwice daily: 10:05 AM &amp; 3:05 PM IST\n\n<a href="https://market-cockpit.vercel.app">View Dashboard</a>'
    );
    diagnostics.steps.push(result.ok ? 'test_sent_ok' : 'test_send_failed');
    return NextResponse.json({ ok: result.ok, mode: 'test', telegramResponse: result.telegramResponse, error: result.error, diagnostics, elapsed: Date.now() - startTime });
  }

  // ── Full mode: fetch watchlist data + send image + news ──
  console.log(`[WATCHLIST] Full mode: fetching ${watchlist.length} stocks + news...`);
  diagnostics.steps.push('fetching_data');

  const [stocks, news] = await Promise.all([
    fetchWatchlistStocks(watchlist).catch(e => {
      console.error('[WATCHLIST] fetchWatchlistStocks failed:', e);
      diagnostics.stocksError = String(e);
      return [] as Stock[];
    }),
    fetchWatchlistNews(watchlist).catch(e => {
      console.error('[WATCHLIST] fetchWatchlistNews failed:', e);
      diagnostics.newsError = String(e);
      return [] as NewsItem[];
    }),
  ]);

  diagnostics.steps.push('data_fetched');
  diagnostics.data = {
    stocksFetched: stocks.length,
    watchlistSize: watchlist.length,
    news: news.length,
  };

  if (stocks.length === 0) {
    diagnostics.steps.push('no_data_sending_closed_msg');
    const result = await sendTelegram(
      '<b>Market Cockpit Watchlist Pulse</b>\n\nMarket is closed or watchlist stocks unavailable.\n\n<i>Next alert during market hours.</i>'
    );
    return NextResponse.json({ ok: result.ok, status: 'no-data', telegramResponse: result.telegramResponse, error: result.error, diagnostics, elapsed: Date.now() - startTime });
  }

  // Send watchlist image
  diagnostics.steps.push('sending_watchlist_image');
  let imageError: string | undefined;
  try {
    const img = await generateWatchlistImage(stocks);
    const gainers = stocks.filter(s => s.changePercent > 0).length;
    const losers = stocks.filter(s => s.changePercent < 0).length;
    const caption = `<b>Watchlist Pulse</b>\n${stocks.length} stocks • Gainers: ${gainers} | Losers: ${losers}\n<a href="https://market-cockpit.vercel.app">Dashboard</a>`;
    const photoResult = await sendTelegramPhoto(img, caption);
    if (!photoResult.ok) {
      imageError = photoResult.error;
      diagnostics.steps.push('image_send_failed');
    } else {
      diagnostics.steps.push('image_sent_ok');
    }
  } catch (e: any) {
    imageError = e.message;
    diagnostics.steps.push('image_generation_failed');
  }

  // Send watchlist summary
  diagnostics.steps.push('sending_summary_text');
  const summary = buildWatchlistMessage(stocks, watchlist);
  const textResult = await sendTelegram(summary);
  if (!textResult.ok) {
    diagnostics.steps.push('text_send_failed');
  } else {
    diagnostics.steps.push('text_sent_ok');
  }

  // Send news if available
  if (news.length > 0) {
    diagnostics.steps.push('sending_news');
    const newsLines = ['<b>Latest News</b>\n'];
    for (let i = 0; i < news.length; i++) {
      newsLines.push(`${i + 1}. ${esc(truncate(news[i].title, 80))}`);
      if (news[i].source) newsLines.push(`   <i>Type: ${news[i].source}</i>`);
    }
    const newsResult = await sendTelegram(newsLines.join('\n'));
    diagnostics.steps.push(newsResult.ok ? 'news_sent_ok' : 'news_send_failed');
  }

  diagnostics.steps.push('done');

  return NextResponse.json({
    ok: !imageError && textResult.ok,
    stocks: stocks.length,
    watchlist: watchlist.length,
    gainers: stocks.filter(s => s.changePercent > 0).length,
    losers: stocks.filter(s => s.changePercent < 0).length,
    news: news.length,
    imageError,
    textError: textResult.error,
    diagnostics,
    elapsed: Date.now() - startTime,
  });
}
