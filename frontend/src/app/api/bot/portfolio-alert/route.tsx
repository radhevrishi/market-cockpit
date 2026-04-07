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

// ── Fetch Portfolio Stocks (FULLY PARALLEL — no sequential bottlenecks) ─
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

  function addNseItem(item: any) {
    const tk = (item.symbol || '').trim().toUpperCase();
    if (!tk || !portfolioSet.has(tk) || seen.has(tk)) return;
    if ((item.lastPrice || 0) <= 0) return;
    seen.add(tk);
    allStocks.push({
      ticker: tk,
      company: item.meta?.companyName || item.identifier || tk,
      price: item.lastPrice || 0,
      changePercent: Math.round((item.pChange || 0) * 100) / 100,
      change: Math.round((item.change || 0) * 100) / 100,
      cap: 'M',
      sector: item.meta?.industry || item.industry || '',
      dayHigh: item.dayHigh || undefined,
      dayLow: item.dayLow || undefined,
      weekHigh52: item.yearHigh || undefined,
      weekLow52: item.yearLow || undefined,
    });
  }

  // Get cookies ONCE upfront
  const cookies = await getNseCookies();
  console.log(`[PORTFOLIO] Cookies: ${cookies ? 'OK' : 'FAILED'}, portfolio: ${portfolio.length} stocks`);

  // ── PHASE 1: Fire ALL data sources in PARALLEL ──
  // Market quotes API (self-call) + 5 NSE indices — ALL at once, no waiting
  const phase1Start = Date.now();
  const results = await Promise.allSettled([
    // Source 0: Market quotes API (10s timeout — don't let self-call block everything)
    fetch(`${API_BASE}/api/market/quotes?market=india`, {
      headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' },
      signal: AbortSignal.timeout(10000),
    }).then(r => r.ok ? r.json() : null).catch(() => null),
    // Source 1-5: Direct NSE index fetches (parallel, not sequential!)
    cookies ? fetchNseIndex('NIFTY 500', cookies) : Promise.resolve([]),
    cookies ? fetchNseIndex('NIFTY MIDCAP 150', cookies) : Promise.resolve([]),
    cookies ? fetchNseIndex('NIFTY SMLCAP 250', cookies) : Promise.resolve([]),
    cookies ? fetchNseIndex('NIFTY MICROCAP 250', cookies) : Promise.resolve([]),
    cookies ? fetchNseIndex('NIFTY TOTAL MARKET', cookies) : Promise.resolve([]),
  ]);
  console.log(`[PORTFOLIO] Phase 1 (parallel) done in ${Date.now() - phase1Start}ms`);

  // Process market quotes API response
  const marketResult = results[0];
  if (marketResult.status === 'fulfilled' && marketResult.value?.stocks) {
    const stocks = marketResult.value.stocks;
    console.log(`[PORTFOLIO] Market API returned ${stocks.length} stocks`);
    for (const s of stocks) addStock(s);
  } else {
    console.warn(`[PORTFOLIO] Market API failed or empty`);
  }

  // Process all NSE index data
  for (let i = 1; i <= 5; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const item of r.value) addNseItem(item);
    }
  }
  console.log(`[PORTFOLIO] After Phase 1: ${seen.size}/${portfolio.length} found`);

  // ── PHASE 2: Individual NSE fetches for ALL remaining missing stocks — ALL PARALLEL ──
  if (seen.size < portfolio.length && cookies) {
    const missing = [...portfolioSet].filter(t => !seen.has(t));
    console.log(`[PORTFOLIO] Phase 2: fetching ${missing.length} missing stocks individually (ALL parallel)...`);
    const phase2Start = Date.now();

    await Promise.allSettled(
      missing.map(async (symbol) => {
        try {
          const cleanSymbol = symbol.replace(/^NSE:/i, '').replace(/^BOM:/i, '').replace(/^\d+$/, '');
          if (!cleanSymbol) return;
          const url = `${NSE_BASE}/api/quote-equity?symbol=${encodeURIComponent(cleanSymbol)}`;
          const r = await fetch(url, {
            headers: { ...NSE_HEADERS, Cookie: cookies },
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            const data = await r.json();
            const pd = data?.priceInfo || {};
            const info = data?.info || {};
            if (pd.lastPrice > 0) {
              const tk = (info.symbol || cleanSymbol).toUpperCase();
              if (!seen.has(tk) && (portfolioSet.has(tk) || portfolioSet.has(symbol))) {
                seen.add(tk);
                seen.add(symbol);
                allStocks.push({
                  ticker: tk,
                  company: info.companyName || tk,
                  price: pd.lastPrice,
                  changePercent: Math.round((pd.pChange || 0) * 100) / 100,
                  change: Math.round((pd.change || 0) * 100) / 100,
                  cap: 'S',
                  sector: info.industry || '',
                  dayHigh: pd.intraDayHighLow?.max,
                  dayLow: pd.intraDayHighLow?.min,
                  weekHigh52: pd.weekHighLow?.max,
                  weekLow52: pd.weekHighLow?.min,
                });
              }
            }
          }
        } catch (e) {
          console.warn(`[PORTFOLIO] Individual fetch ${symbol} failed:`, e);
        }
      })
    );
    console.log(`[PORTFOLIO] Phase 2 done in ${Date.now() - phase2Start}ms, total: ${allStocks.length}`);
  }

  const stillMissing = [...portfolioSet].filter(t => !seen.has(t));
  if (stillMissing.length > 0) {
    console.warn(`[PORTFOLIO] STILL MISSING ${stillMissing.length}: ${stillMissing.join(', ')}`);
  }
  console.log(`[PORTFOLIO] Final: ${allStocks.length}/${portfolio.length} stocks fetched`);
  return allStocks;
}

// ── Fetch News for Portfolio ────────────────────────────────────────────
async function fetchPortfolioNews(portfolio: string[]): Promise<NewsItem[]> {
  const portfolioSet = new Set(portfolio.map(t => t.toUpperCase()));

  // Try intelligence API first (with portfolio filter)
  try {
    const pf = portfolio.join(',');
    const url = `${API_BASE}/api/market/intelligence?days=7&portfolio=${pf}`;
    console.log(`[PORTFOLIO] Fetching news/intelligence from ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json();
      const allSignals = data.signals || [];

      // Try portfolio-specific signals first
      let newsItems: NewsItem[] = allSignals
        .filter((s: any) => s.isPortfolio || portfolioSet.has((s.symbol || s.ticker || s.primaryTicker || '').toUpperCase()))
        .slice(0, 15)
        .map((s: any) => ({
          title: s.headline || s.narrative || s.summary || `${s.symbol || s.ticker}: ${s.eventType || 'Update'}`,
          source: s.eventType || s.signalClass || 'Intelligence',
          timestamp: s.date || s.timestamp,
        }));

      // If no portfolio-specific news, return TOP general market signals
      if (newsItems.length === 0 && allSignals.length > 0) {
        console.log(`[PORTFOLIO] No portfolio-specific news, using top ${Math.min(10, allSignals.length)} general signals`);
        newsItems = allSignals
          .slice(0, 10)
          .map((s: any) => ({
            title: s.headline || s.narrative || s.summary || `${s.symbol || s.ticker}: ${s.eventType || 'Update'}`,
            source: s.eventType || s.signalClass || 'Market Intel',
            timestamp: s.date || s.timestamp,
          }));
      }

      if (newsItems.length > 0) return newsItems;
    }
  } catch (e) {
    console.error('[PORTFOLIO] News/intelligence fetch failed:', e);
  }

  // Fallback: Try UNFILTERED intelligence (no portfolio param — get ALL signals)
  try {
    const url = `${API_BASE}/api/market/intelligence?days=7`;
    console.log(`[PORTFOLIO] Trying unfiltered intelligence...`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const data = await r.json();
      const allSignals = data.signals || [];
      if (allSignals.length > 0) {
        return allSignals.slice(0, 10).map((s: any) => ({
          title: s.headline || s.narrative || s.summary || `${s.symbol || s.ticker}: ${s.eventType || 'Update'}`,
          source: s.eventType || s.signalClass || 'Market Intel',
          timestamp: s.date || s.timestamp,
        }));
      }
    }
  } catch (e) {
    console.error('[PORTFOLIO] Unfiltered intelligence fetch failed:', e);
  }

  // Fallback 2: NSE corporate announcements (PARALLEL, not sequential)
  try {
    const cookies = await getNseCookies();
    if (cookies) {
      const results = await Promise.allSettled(
        portfolio.slice(0, 10).map(async (symbol) => {
          const url = `${NSE_BASE}/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`;
          const r = await fetch(url, { headers: { ...NSE_HEADERS, Cookie: cookies }, signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const data = await r.json();
            const items = (Array.isArray(data) ? data : data?.data || []).slice(0, 2);
            return items.map((item: any) => ({
              title: `${symbol}: ${item.desc || item.subject || 'Corporate Announcement'}`,
              source: 'NSE Filing',
              timestamp: item.an_dt || item.date,
            }));
          }
          return [];
        })
      );
      const announcements: NewsItem[] = results
        .filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);
      if (announcements.length > 0) return announcements.slice(0, 10);
    }
  } catch {}

  return [];
}

// ── Fetch Intelligence Signals for Portfolio ────────────────────────────
async function fetchPortfolioIntelligence(portfolio: string[]): Promise<any[]> {
  const portfolioSet = new Set(portfolio.map(t => t.toUpperCase()));

  try {
    const pf = portfolio.join(',');
    const url = `${API_BASE}/api/market/intelligence?days=7&portfolio=${pf}`;
    console.log(`[PORTFOLIO] Fetching intelligence from ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json();
      const allSignals = data.signals || [];

      // Try portfolio-specific ACTIONABLE/NOTABLE first
      let filtered = allSignals.filter((s: any) =>
        (s.isPortfolio || portfolioSet.has((s.symbol || s.ticker || '').toUpperCase())) &&
        (s.signalTierV7 === 'ACTIONABLE' || s.signalTierV7 === 'NOTABLE')
      ).slice(0, 10);

      // If no portfolio-specific actionable signals, return top general signals
      if (filtered.length === 0 && allSignals.length > 0) {
        console.log(`[PORTFOLIO] No portfolio intel, using top ${Math.min(8, allSignals.length)} general signals`);
        filtered = allSignals
          .filter((s: any) => s.signalTierV7 === 'ACTIONABLE' || s.signalTierV7 === 'NOTABLE')
          .slice(0, 8);
        // If still nothing, just return top signals regardless of tier
        if (filtered.length === 0) {
          filtered = allSignals.slice(0, 8);
        }
      }

      return filtered;
    }
  } catch (e) {
    console.error('[PORTFOLIO] Intelligence fetch failed:', e);
  }

  // Fallback: unfiltered intelligence
  try {
    const url = `${API_BASE}/api/market/intelligence?days=7`;
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const data = await r.json();
      return (data.signals || []).slice(0, 8);
    }
  } catch {}

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
  const displayStocks = stocks.slice(0, 100);
  const timestamp = getISTTimestamp();
  const W = 1200;

  // Dimensions
  const ACCENT_H = 3;
  const HEADER_H = 58;
  const METRICS_H = 44;
  const COL_HEADER_H = 32;
  const ROW_H = 34;
  const FOOTER_H = 28;
  const COL_GAP = 8;
  const HALF_W = (W - COL_GAP) / 2;

  // Sort by change percent descending
  const sorted = [...displayStocks].sort((a, b) => b.changePercent - a.changePercent);

  // Split: winners LEFT, losers RIGHT
  const winners = sorted.filter(s => s.changePercent >= 0);
  const losers = sorted.filter(s => s.changePercent < 0).reverse();

  const winnersN = winners.length;
  const losersN = losers.length;
  const avgChange = displayStocks.length > 0
    ? Math.round(displayStocks.reduce((a, b) => a + b.changePercent, 0) / displayStocks.length * 100) / 100
    : 0;

  const maxRows = Math.max(winners.length, losers.length);
  const totalHeight = ACCENT_H + HEADER_H + METRICS_H + COL_HEADER_H + (maxRows * ROW_H) + FOOTER_H;

  // Color helper
  const getPctColor = (pct: number): string => {
    if (pct >= 3) return '#22C55E';
    if (pct >= 0.5) return '#4ADE80';
    if (pct >= 0) return '#86EFAC';
    if (pct > -0.5) return '#FCA5A5';
    if (pct > -3) return '#F87171';
    return '#EF4444';
  };

  // Render a single stock row (used for both sides)
  const renderRow = (s: Stock, idx: number, side: string) => {
    const pctColor = getPctColor(s.changePercent);
    const rowBg = idx % 2 === 0 ? '#0F172A' : '#141C2F';
    const sign = s.changePercent >= 0 ? '+' : '';

    return (
      <div key={`${side}-${idx}`} style={{
        display: 'flex', alignItems: 'center', height: `${ROW_H}px`,
        backgroundColor: rowBg, paddingLeft: '10px', paddingRight: '10px',
        borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B',
      }}>
        {/* # */}
        <div style={{ display: 'flex', width: '24px', color: '#4B5563', fontSize: '11px', fontWeight: 600, justifyContent: 'flex-end', marginRight: '8px' }}>
          {idx + 1}
        </div>
        {/* Symbol */}
        <div style={{ display: 'flex', width: '110px', fontWeight: 800, color: '#FFFFFF', fontSize: '15px' }}>
          {truncate(s.ticker, 11)}
        </div>
        {/* Price */}
        <div style={{ display: 'flex', width: '90px', justifyContent: 'flex-end', color: '#E5E7EB', fontSize: '14px', fontWeight: 700 }}>
          <span style={{ display: 'flex' }}>{s.price.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
        </div>
        {/* Change (absolute) */}
        <div style={{ display: 'flex', width: '70px', justifyContent: 'flex-end', color: pctColor, fontSize: '13px', fontWeight: 700, marginLeft: '6px' }}>
          <span style={{ display: 'flex' }}>{sign}{s.change.toFixed(1)}</span>
        </div>
        {/* %Change */}
        <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', color: pctColor, fontWeight: 800, fontSize: '15px' }}>
          <span style={{ display: 'flex' }}>{sign}{s.changePercent.toFixed(1)}%</span>
        </div>
      </div>
    );
  };

  // Filler rows for the shorter column
  const renderFillers = (count: number, side: string) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(
        <div key={`fill-${side}-${i}`} style={{ display: 'flex', height: `${ROW_H}px`, backgroundColor: '#0F172A', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B' }} />
      );
    }
    return out;
  };

  const element = (
    <div style={{
      display: 'flex', flexDirection: 'column', width: `${W}px`, height: `${totalHeight}px`,
      backgroundColor: '#0F172A', fontFamily: 'sans-serif',
    }}>
      {/* Accent bar */}
      <div style={{ display: 'flex', width: '100%', height: `${ACCENT_H}px`, background: 'linear-gradient(90deg, #22C55E 0%, #3B82F6 50%, #EF4444 100%)' }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: '24px', paddingRight: '24px', height: `${HEADER_H}px`,
        backgroundColor: '#111827', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1F2937',
      }}>
        <span style={{ display: 'flex', fontSize: '26px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '2px' }}>
          PORTFOLIO PULSE
        </span>
        <span style={{ display: 'flex', fontSize: '13px', color: '#9CA3AF', fontWeight: 600 }}>{timestamp}</span>
      </div>

      {/* KPI Strip */}
      <div style={{
        display: 'flex', alignItems: 'center', paddingLeft: '24px', paddingRight: '24px',
        height: `${METRICS_H}px`, backgroundColor: '#0F172A', fontSize: '16px', fontWeight: 700,
        borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1F2937',
      }}>
        <span style={{ display: 'flex', marginRight: '28px' }}>
          <span style={{ display: 'flex', color: '#FFFFFF', fontWeight: 800 }}>{displayStocks.length}</span>
          <span style={{ display: 'flex', marginLeft: '5px', color: '#6B7280' }}>Holdings</span>
        </span>
        <span style={{ display: 'flex', marginRight: '28px' }}>
          <span style={{ display: 'flex', color: '#22C55E', fontWeight: 800 }}>{winnersN}</span>
          <span style={{ display: 'flex', marginLeft: '5px', color: '#6B7280' }}>Up</span>
        </span>
        <span style={{ display: 'flex', marginRight: '28px' }}>
          <span style={{ display: 'flex', color: '#EF4444', fontWeight: 800 }}>{losersN}</span>
          <span style={{ display: 'flex', marginLeft: '5px', color: '#6B7280' }}>Down</span>
        </span>
        <span style={{ display: 'flex' }}>
          <span style={{ display: 'flex', marginRight: '5px', color: '#6B7280' }}>Avg</span>
          <span style={{ display: 'flex', color: avgChange >= 0 ? '#22C55E' : '#EF4444', fontWeight: 800 }}>
            {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
          </span>
        </span>
      </div>

      {/* Two-column body */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* LEFT — WINNERS */}
        <div style={{ display: 'flex', flexDirection: 'column', width: `${HALF_W}px` }}>
          {/* Column header */}
          <div style={{
            display: 'flex', alignItems: 'center', height: `${COL_HEADER_H}px`,
            backgroundColor: '#0A1A0A', paddingLeft: '10px', paddingRight: '10px',
            borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#16A34A',
          }}>
            <div style={{ display: 'flex', width: '24px', marginRight: '8px' }} />
            <div style={{ display: 'flex', width: '110px', fontSize: '11px', fontWeight: 800, color: '#22C55E', letterSpacing: '1px' }}>
              WINNERS ({winnersN})
            </div>
            <div style={{ display: 'flex', width: '90px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 700, color: '#4B5563' }}>PRICE</div>
            <div style={{ display: 'flex', width: '70px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 700, color: '#4B5563', marginLeft: '6px' }}>CHG</div>
            <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', fontSize: '10px', fontWeight: 700, color: '#4B5563' }}>%CHG</div>
          </div>
          {winners.map((s, i) => renderRow(s, i, 'w'))}
          {winners.length < maxRows && renderFillers(maxRows - winners.length, 'w')}
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', width: `${COL_GAP}px`, backgroundColor: '#1E293B' }} />

        {/* RIGHT — LOSERS */}
        <div style={{ display: 'flex', flexDirection: 'column', width: `${HALF_W}px` }}>
          {/* Column header */}
          <div style={{
            display: 'flex', alignItems: 'center', height: `${COL_HEADER_H}px`,
            backgroundColor: '#1A0A0A', paddingLeft: '10px', paddingRight: '10px',
            borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#DC2626',
          }}>
            <div style={{ display: 'flex', width: '24px', marginRight: '8px' }} />
            <div style={{ display: 'flex', width: '110px', fontSize: '11px', fontWeight: 800, color: '#EF4444', letterSpacing: '1px' }}>
              LOSERS ({losersN})
            </div>
            <div style={{ display: 'flex', width: '90px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 700, color: '#4B5563' }}>PRICE</div>
            <div style={{ display: 'flex', width: '70px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 700, color: '#4B5563', marginLeft: '6px' }}>CHG</div>
            <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', fontSize: '10px', fontWeight: 700, color: '#4B5563' }}>%CHG</div>
          </div>
          {losers.map((s, i) => renderRow(s, i, 'l'))}
          {losers.length < maxRows && renderFillers(maxRows - losers.length, 'l')}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingLeft: '24px', paddingRight: '24px', height: `${FOOTER_H}px`,
        backgroundColor: '#0F172A', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#1F2937',
        fontSize: '11px', color: '#4B5563',
      }}>
        <span style={{ display: 'flex' }}>market-cockpit.vercel.app</span>
        <span style={{ display: 'flex' }}>{timestamp}</span>
      </div>
    </div>
  );

  return (new ImageResponse(element, { width: W, height: totalHeight })).arrayBuffer();
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

  const moodMarker = avg > 0.5 ? '[+]' : avg < -0.5 ? '[-]' : '[~]';
  const moodText = avg > 0.5 ? 'BULLISH' : avg < -0.5 ? 'BEARISH' : 'NEUTRAL';

  const lines: string[] = [];
  const DIV = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

  lines.push(`${moodMarker} <b>PORTFOLIO PULSE</b>  ·  <code>${moodText}</code>`);
  lines.push(`<i>${timeStr} IST  •  ${stocks.length}/${portfolio.length} holdings tracked</i>`);
  lines.push('');

  if (gainers.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>> Top Gainers</b>`);
    lines.push('');
    for (const s of gainers.slice(0, 5)) {
      lines.push(`  [+] <b>${esc(s.ticker)}</b>  <code>+${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}`);
    }
    lines.push('');
  }

  if (losers.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b><< Top Losers</b>`);
    lines.push('');
    for (const s of losers.slice(0, 5)) {
      lines.push(`  [-] <b>${esc(s.ticker)}</b>  <code>${s.changePercent.toFixed(1)}%</code>  ${fmtPrice(s.price)}`);
    }
    lines.push('');
  }

  // 52-week high/low proximity
  const near52High = stocks.filter(s => s.weekHigh52 && s.price >= s.weekHigh52 * 0.95);
  const near52Low = stocks.filter(s => s.weekLow52 && s.price <= s.weekLow52 * 1.05);

  if (near52High.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>^ Near 52-Week High</b>`);
    for (const s of near52High.slice(0, 3)) {
      const pctFrom = s.weekHigh52 ? ((s.price / s.weekHigh52 - 1) * 100).toFixed(1) : '?';
      lines.push(`  ^ <b>${esc(s.ticker)}</b>  ${fmtPrice(s.price)}  (${pctFrom}% from high)`);
    }
    lines.push('');
  }

  if (near52Low.length > 0) {
    lines.push(DIV);
    lines.push('');
    lines.push(`<b>[!] Near 52-Week Low</b>`);
    for (const s of near52Low.slice(0, 3)) {
      const pctFrom = s.weekLow52 ? ((s.price / s.weekLow52 - 1) * 100).toFixed(1) : '?';
      lines.push(`  v <b>${esc(s.ticker)}</b>  ${fmtPrice(s.price)}  (+${pctFrom}% from low)`);
    }
    lines.push('');
  }

  lines.push(DIV);
  lines.push('');
  lines.push(`<b>Portfolio Summary</b>`);
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
        `<b>MC Portfolio Pulse — Connected!</b>\n\nWelcome ${esc(firstName)}! Your portfolio tracker is live.\n\n<b>What you'll receive:</b>\n• Real-time performance cards for YOUR holdings\n• Gainers &amp; losers in your portfolio\n• 52-week high/low proximity alerts\n• Intelligence signals for your stocks\n• Latest news for portfolio companies\n\n<b>Default Portfolio:</b>\n${DEFAULT_PORTFOLIO.slice(0, 8).join(', ')}, …\n\n<b>Commands:</b>\n/add SYMBOL — Add holdings (space-separated)\n/remove SYMBOL — Remove holding\n/list — Show your portfolio\n/pulse — Get portfolio performance card\n/intel — Intelligence signals for your stocks\n/news — Latest news for portfolio\n/help — Show all commands\n/status — Bot status\n\n<a href="https://market-cockpit.vercel.app/portfolio">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `<b>MC Portfolio Pulse — Help</b>\n\n<b>Commands:</b>\n/start — Welcome &amp; setup\n/add SYMBOL — Add holdings (space-separated, e.g. /add TCS INFY)\n/remove SYMBOL — Remove single holding\n/list — Show your current portfolio\n/pulse — Generate portfolio performance card\n/intel — Get intelligence signals for portfolio\n/news — Get latest news for portfolio companies\n/status — Bot status &amp; diagnostics\n/help — This help message\n\n<b>Examples:</b>\n<code>/add BAJAJFINSV BHARTIARTL</code> — Add two stocks\n<code>/remove TATAMOTORS</code> — Remove one\n<code>/list</code> — See all holdings\n\n<b>Scheduled Alerts:</b>\nTwice daily: 10:15 AM &amp; 3:15 PM IST\n• Portfolio performance card\n• Relevant news &amp; intelligence\n\n<a href="https://market-cockpit.vercel.app/portfolio">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/list') {
      const portfolio = await getPortfolio(chatId);
      const total = portfolio.length;
      const lines = [`<b>Your Portfolio</b>  (${total} holdings)\n`];

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
      lines.push(`/add SYMBOL — Add holdings`);
      lines.push(`/remove SYMBOL — Remove holding`);
      lines.push(`/pulse — Performance card`);
      await sendTelegramTo(chatId, lines.join('\n'));
    } else if (text.startsWith('/add ')) {
      const toAdd = text.slice(5).trim().split(/[\s,]+/).map((t: string) => t.toUpperCase()).filter((t: string) => t.length > 0 && t.length < 30);
      if (toAdd.length === 0) {
        await sendTelegramTo(chatId, '[X] Please provide stock symbols. Example: <code>/add TCS INFY</code> or <code>/add TCS,INFY,WIPRO</code>');
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
          `[OK] <b>Portfolio Updated</b>\n\n[+] Added: <code>${toAdd.join(', ')}</code>\nTotal holdings: <b>${updated.length}</b>\n\n<i>Your portfolio will be used for alerts and reports.</i>`
        );
      }
    } else if (text.startsWith('/remove ')) {
      const toRemove = text.slice(8).trim().toUpperCase();
      if (!toRemove) {
        await sendTelegramTo(chatId, '[X] Please provide a symbol. Example: <code>/remove HFCL</code>');
      } else {
        const current = await getPortfolio(chatId);
        const updated = current.filter(t => t !== toRemove);
        if (updated.length === current.length) {
          await sendTelegramTo(chatId, `[X] <b>${toRemove}</b> not found in your portfolio.`);
        } else {
          setPortfolio(chatId, updated);

          fetch(`${API_BASE}/api/watchlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: `pf_${chatId}`, watchlist: updated, secret: BOT_SECRET }),
          }).catch(() => {});

          await sendTelegramTo(chatId,
            `[OK] <b>Removed</b>\n\n[-] Removed: <code>${toRemove}</code>\nTotal holdings: <b>${updated.length}</b>`
          );
        }
      }
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, '<i>Generating portfolio pulse card...</i>');
      const portfolio = await getPortfolio(chatId);
      const stocks = await fetchPortfolioStocks(portfolio);
      if (stocks.length === 0) {
        await sendTelegramTo(chatId, 'No portfolio data available. Market may be closed or symbols not found.');
      } else {
        try {
          const img = await generatePortfolioImage(stocks);
          const gainers = stocks.filter(s => s.changePercent > 0).length;
          const losers = stocks.filter(s => s.changePercent < 0).length;
          await sendTelegramPhoto(img, `<b>${stocks.length} holdings</b> • Up:${gainers} Down:${losers} — <a href="https://market-cockpit.vercel.app/portfolio">Dashboard</a>`, chatId);
        } catch (e) {
          console.error('[PORTFOLIO] Image gen failed:', e);
          const msg = buildPortfolioMessage(stocks, portfolio);
          await sendTelegramTo(chatId, msg);
        }
      }
    } else if (text === '/intel') {
      await sendTelegramTo(chatId, '<i>Fetching intelligence signals...</i>');
      const portfolio = await getPortfolio(chatId);
      const signals = await fetchPortfolioIntelligence(portfolio);
      if (signals.length === 0) {
        await sendTelegramTo(chatId, 'No actionable intelligence signals for your portfolio right now.');
      } else {
        const lines = [`<b>Portfolio Intelligence</b>\n`];
        for (let i = 0; i < signals.length; i++) {
          const s = signals[i];
          const tier = s.signalTierV7 === 'ACTIONABLE' ? '[ACTION]' : s.signalTierV7 === 'NOTABLE' ? '[NOTABLE]' : '[INFO]';
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
      await sendTelegramTo(chatId, '<i>Fetching latest news...</i>');
      const portfolio = await getPortfolio(chatId);
      const news = await fetchPortfolioNews(portfolio);
      if (news.length === 0) {
        await sendTelegramTo(chatId, 'No recent news for your portfolio holdings.');
      } else {
        const lines = [`<b>Portfolio News</b>\n`];
        for (let i = 0; i < news.length; i++) {
          lines.push(`${i + 1}. ${esc(truncate(news[i].title, 80))}`);
          if (news[i].source) lines.push(`   <i>[${news[i].source}]</i>`);
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
        `<b>MC Portfolio Pulse — Status</b>\n\n[OK] Bot: Online\nIST: ${ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n${isMarketDay && isMarketHours ? '[+] Market: Open' : '[-] Market: Closed'}\nPortfolio: <b>${portfolio.length}</b> holdings\nAlerts: 10:15 AM &amp; 3:15 PM IST (Mon–Fri)\n\n<i>Portfolio synced to cloud — persists across sessions.</i>`
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
  let portfolio: string[];

  if (portfolioParam) {
    portfolio = portfolioParam.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
    console.log(`[PORTFOLIO] Using URL portfolio: ${portfolio.join(',')}`);
  } else {
    // Load saved portfolio from API (same as POST /pulse does) instead of DEFAULT_PORTFOLIO
    portfolio = await getPortfolio(TG_CHAT_ID);
    console.log(`[PORTFOLIO] Loaded saved portfolio: ${portfolio.length} stocks`);
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
      `<b>Portfolio Pulse</b>\n\nCould not fetch market data for ${portfolio.length} holdings.\nMarket may be closed or data unavailable.\n\n<i>Will retry on next schedule.</i>`
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
      `<b>${stocks.length} holdings</b> • Up:${gainers} Down:${losers} — <a href="https://market-cockpit.vercel.app/portfolio">Dashboard</a>`
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

  // Intel and news are only sent via explicit /intel and /news commands
  // The scheduled GET alert only sends the portfolio image card
  diagnostics.steps.push('done');

  return NextResponse.json({
    ok: true,
    mode,
    portfolio: portfolio.length,
    stocksFetched: stocks.length,
    diagnostics,
    elapsed: Date.now() - startTime,
  });
}
