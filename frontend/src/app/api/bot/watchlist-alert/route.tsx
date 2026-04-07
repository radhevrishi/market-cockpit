import { NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import React from 'react';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchNifty500, fetchNiftyMidcap250, fetchNiftySmallcap250, fetchNiftyMicrocap250, fetchNiftyTotalMarket, fetchGainers, fetchLosers, nseApiFetch } from '@/lib/nse';

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

// ── Watchlist Storage (direct Redis — no self-referencing HTTP calls) ──
const watchlistStorage: Record<string, Watchlist> = {};

async function getWatchlist(chatId: string): Promise<string[]> {
  // Read DIRECTLY from Redis — no HTTP self-call, no timeout issues
  try {
    const stored = await kvGet<string[]>(`watchlist:${chatId}`);
    if (stored && Array.isArray(stored) && stored.length > 0) {
      console.log(`[WATCHLIST] Loaded ${stored.length} stocks from Redis for ${chatId}`);
      watchlistStorage[chatId] = { stocks: stored, addedAt: Date.now() };
      return stored;
    }
  } catch (e) {
    console.warn('[WATCHLIST] Redis read failed:', e);
  }

  // Fallback: in-memory
  if (watchlistStorage[chatId] && watchlistStorage[chatId].stocks.length > 0) {
    return watchlistStorage[chatId].stocks;
  }

  // Last resort: default
  watchlistStorage[chatId] = { stocks: [...DEFAULT_WATCHLIST], addedAt: Date.now() };
  return DEFAULT_WATCHLIST;
}

function setWatchlist(chatId: string, stocks: string[]): void {
  const unique = [...new Set(stocks.map(s => s.trim().toUpperCase()).filter(s => s.length > 0 && s.length < 30))];
  watchlistStorage[chatId] = {
    stocks: unique,
    addedAt: Date.now(),
  };
}

// NSE helpers removed — using @/lib/nse directly (shared cookies, caching, retry)

// ── Fetch Watchlist Stocks (DIRECT NSE LIB — zero self-referencing calls) ──
async function fetchWatchlistStocks(watchlist: string[]): Promise<Stock[]> {
  const watchlistSet = new Set(watchlist.map(t => t.toUpperCase()));
  const allStocks: Stock[] = [];
  const seen = new Set<string>();

  function addNseItem(item: any) {
    const tk = (item.symbol || '').trim().toUpperCase();
    if (!tk || !watchlistSet.has(tk) || seen.has(tk)) return;
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

  console.log(`[WATCHLIST] Fetching ${watchlist.length} stocks via DIRECT NSE lib (no self-calls)...`);
  const phase1Start = Date.now();

  // ── PHASE 1: Fetch ALL NSE indices in PARALLEL using @/lib/nse ──
  const [n500, mid250, sml250, micro250, totalMkt, gainersR, losersR] = await Promise.allSettled([
    fetchNifty500().catch(() => null),
    fetchNiftyMidcap250().catch(() => null),
    fetchNiftySmallcap250().catch(() => null),
    fetchNiftyMicrocap250().catch(() => null),
    fetchNiftyTotalMarket().catch(() => null),
    fetchGainers().catch(() => null),
    fetchLosers().catch(() => null),
  ]);

  const processIndex = (result: PromiseSettledResult<any>) => {
    if (result.status !== 'fulfilled' || !result.value?.data) return;
    for (const item of result.value.data) addNseItem(item);
  };
  processIndex(n500);
  processIndex(mid250);
  processIndex(sml250);
  processIndex(micro250);
  processIndex(totalMkt);

  const processLive = (result: PromiseSettledResult<any>) => {
    if (result.status !== 'fulfilled' || !result.value) return;
    const v = result.value;
    const items = [...(v.NIFTY?.data || []), ...(v.allSec?.data || [])];
    for (const item of items) addNseItem(item);
  };
  processLive(gainersR);
  processLive(losersR);

  console.log(`[WATCHLIST] Phase 1 done in ${Date.now() - phase1Start}ms: ${seen.size}/${watchlist.length} found`);

  // ── PHASE 2: Individual NSE quote for missing stocks — ALL PARALLEL ──
  if (seen.size < watchlist.length) {
    const missing = [...watchlistSet].filter(t => !seen.has(t));
    console.log(`[WATCHLIST] Phase 2: ${missing.length} missing, fetching individually...`);
    const phase2Start = Date.now();

    await Promise.allSettled(
      missing.map(async (symbol) => {
        try {
          const cleanSymbol = symbol.replace(/^NSE:/i, '').replace(/^BOM:/i, '').replace(/^\d+$/, '');
          if (!cleanSymbol) return;
          const data = await nseApiFetch(`/api/quote-equity?symbol=${encodeURIComponent(cleanSymbol)}`, 30000);
          if (data?.priceInfo?.lastPrice > 0) {
            const pd = data.priceInfo;
            const info = data.info || {};
            const tk = (info.symbol || cleanSymbol).toUpperCase();
            if (!seen.has(tk) && (watchlistSet.has(tk) || watchlistSet.has(symbol))) {
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
        } catch {}
      })
    );
    console.log(`[WATCHLIST] Phase 2 done in ${Date.now() - phase2Start}ms`);
  }

  const stillMissing = [...watchlistSet].filter(t => !seen.has(t));
  if (stillMissing.length > 0) {
    console.warn(`[WATCHLIST] STILL MISSING ${stillMissing.length}: ${stillMissing.join(', ')}`);
  }
  console.log(`[WATCHLIST] Final: ${allStocks.length}/${watchlist.length} stocks fetched`);
  return allStocks;
}

// ── Fetch News for Watchlist ────────────────────────────────────────────
async function fetchWatchlistNews(watchlist: string[]): Promise<NewsItem[]> {
  const watchlistSet = new Set(watchlist.map(t => t.toUpperCase()));

  // Try intelligence API first
  try {
    const wl = watchlist.join(',');
    const url = `${API_BASE}/api/market/intelligence?days=7&portfolio=${wl}`;
    console.log(`[WATCHLIST] Fetching news/intelligence from ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'MarketCockpit-Bot/1.0' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json();
      const allSignals = data.signals || [];

      // Try watchlist-specific signals first
      let newsItems: NewsItem[] = allSignals
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

      // If no watchlist-specific news, return top general signals
      if (newsItems.length === 0 && allSignals.length > 0) {
        newsItems = allSignals.slice(0, 10).map((s: any) => ({
          title: s.headline || s.narrative || s.summary || `${s.symbol || s.ticker}: ${s.eventType || 'Update'}`,
          source: s.eventType || s.signalClass || 'Market Intel',
          timestamp: s.date || s.timestamp,
        }));
      }

      if (newsItems.length > 0) return newsItems;
    }
  } catch (e) {
    console.error('[WATCHLIST] News/intelligence fetch failed:', e);
  }

  // Fallback: unfiltered intelligence
  try {
    const url = `${API_BASE}/api/market/intelligence?days=7`;
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
  } catch {}

  // Fallback 2: NSE corporate announcements (PARALLEL via @/lib/nse)
  try {
    const results = await Promise.allSettled(
      watchlist.slice(0, 10).map(async (symbol) => {
        const data = await nseApiFetch(`/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`, 30000);
        const items = (Array.isArray(data) ? data : data?.data || []).slice(0, 2);
        return items.map((item: any) => ({
          title: `${symbol}: ${item.desc || item.subject || 'Corporate Announcement'}`,
          source: 'NSE Filing',
          timestamp: item.an_dt || item.date,
        }));
      })
    );
    const announcements: NewsItem[] = results
      .filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);
    if (announcements.length > 0) return announcements.slice(0, 10);
  } catch {}

  return [];
}

// ══════════════════════════════════════════════════════════════════════════
// STOCK REASONS — Real news catalysts for each stock
// ══════════════════════════════════════════════════════════════════════════

function extractCatalyst(headline: string): string {
  if (!headline) return '';
  const patterns: [RegExp, string][] = [
    [/nuclear|reactor|atomic/i, 'Nuclear Deal'],
    [/order\s*win|order\s*bag|order\s*worth|new\s*order|bags?\s*order/i, 'Order Win'],
    [/block\s*deal|bulk\s*deal/i, 'Block Deal'],
    [/buyback|buy\s*back/i, 'Buyback'],
    [/dividend/i, 'Dividend'],
    [/split|stock\s*split|bonus/i, 'Bonus/Split'],
    [/result|earning|profit\s*(up|surge|jump|rise|grow)|revenue\s*(up|surge|jump|grow)|net\s*profit|PAT\s*(up|surge|rise)/i, 'Results Beat'],
    [/loss|profit\s*(fall|drop|decline|slip)|revenue\s*(fall|drop|decline)/i, 'Weak Results'],
    [/upgrade|target\s*raise|outperform|overweight/i, 'Upgrade'],
    [/downgrade|underperform|underweight|target\s*cut/i, 'Downgrade'],
    [/acquisition|acquire|takeover|buyout|merger/i, 'Acquisition'],
    [/partnership|tie-?up|collaborat|joint\s*venture|JV|MOU|pact/i, 'New Pact'],
    [/contract|deal\s*worth|wins?\s*contract/i, 'New Contract'],
    [/expansion|capex|new\s*plant|capacity|greenfield/i, 'Expansion'],
    [/launch|new\s*product|introduce/i, 'New Launch'],
    [/stake\s*(sale|buy|acquire|hike|increase)|promoter/i, 'Stake Change'],
    [/FII|FPI|DII|mutual\s*fund|institutional/i, 'Fund Flow'],
    [/defence|defense|military|army|navy|missile/i, 'Defence Order'],
    [/export|international|global\s*order/i, 'Export Order'],
    [/approval|clearance|SEBI|RBI|regulatory/i, 'Approval'],
    [/IPO|listing|debut/i, 'IPO Buzz'],
    [/solar|wind|renewable|green\s*energy/i, 'Green Energy'],
    [/EV|electric\s*vehicle|battery/i, 'EV Play'],
    [/semiconductor|chip|fab/i, 'Chip/Semi'],
    [/AI|artificial\s*intelligence|data\s*center/i, 'AI/Data'],
    [/infra|highway|railway|metro|road/i, 'Infra Push'],
    [/pharma|drug|FDA|USFDA|ANDA/i, 'Pharma News'],
    [/bank|NPA|NIM|credit\s*grow|loan\s*growth/i, 'Banking'],
    [/oil|gas|crude|refin/i, 'Oil & Gas'],
    [/metal|steel|aluminium|copper|zinc/i, 'Metal Rally'],
    [/IT\s*deal|digital\s*deal|tech\s*deal|cloud/i, 'Tech Deal'],
    [/real\s*estate|realty|housing|property/i, 'Realty Boom'],
    [/rating|CRISIL|ICRA|credit\s*rating/i, 'Rating News'],
    [/demerger|demerge|spin-?off/i, 'Demerger'],
    [/right\s*issue|QIP|preferential/i, 'Fund Raise'],
    [/ban|restriction|penalty|fine/i, 'Regulatory'],
    [/short\s*cover|short\s*squeeze/i, 'Short Cover'],
  ];
  for (const [regex, label] of patterns) {
    if (regex.test(headline)) return label;
  }
  const words = headline.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'has', 'had', 'its', 'that', 'this', 'are', 'was', 'were', 'been', 'will', 'can', 'may', 'not', 'but', 'also', 'into', 'said', 'says', 'per', 'ltd', 'limited', 'shares', 'stock', 'stocks', 'company', 'market', 'nse', 'bse', 'india']);
  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase())).slice(0, 3);
  if (meaningful.length > 0) return meaningful.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return '';
}

async function fetchStockReasons(tickers: string[]): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  const tickerSet = new Set(tickers.map(t => t.toUpperCase()));

  // Phase 1: Intelligence signals from Redis
  try {
    const intel = await kvGet<any>('intelligence:signals');
    if (intel && intel.signals) {
      const allSignals = [...(intel.signals || []), ...(intel.top3 || []), ...(intel.notable || [])];
      for (const sig of allSignals) {
        const sym = (sig.symbol || '').toUpperCase();
        if (tickerSet.has(sym) && !reasons.has(sym)) {
          const catalyst = extractCatalyst(sig.headline || '') ||
            extractCatalyst(sig.whyItMatters || '') ||
            sig.eventType || '';
          if (catalyst) reasons.set(sym, truncate(catalyst, 14));
        }
      }
    }
  } catch (e) {
    console.warn('[REASONS] Intel signals fetch failed:', e);
  }

  // Phase 2: Google News RSS for stocks without reasons (parallel, top 15)
  const needReasons = tickers.filter(t => !reasons.has(t.toUpperCase())).slice(0, 15);
  if (needReasons.length > 0) {
    try {
      const rssResults = await Promise.allSettled(
        needReasons.map(async (symbol) => {
          const query = encodeURIComponent(`${symbol} NSE stock`);
          const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
          const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) return { symbol, headline: '' };
          const xml = await r.text();
          const titleMatch = xml.match(/<item[^>]*>[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
          return { symbol, headline: titleMatch?.[1]?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || '' };
        })
      );
      for (const result of rssResults) {
        if (result.status === 'fulfilled' && result.value.headline) {
          const sym = result.value.symbol.toUpperCase();
          const catalyst = extractCatalyst(result.value.headline);
          if (catalyst && !reasons.has(sym)) {
            reasons.set(sym, truncate(catalyst, 14));
          }
        }
      }
    } catch (e) {
      console.warn('[REASONS] Google News RSS failed:', e);
    }
  }

  return reasons;
}

// ══════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Watchlist Pulse Card
// ══════════════════════════════════════════════════════════════════════════

function truncate(s: string, maxLen: number): string {
  if (!s) return '';
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

async function generateWatchlistImage(stocks: Stock[], reasons: Map<string, string>): Promise<ArrayBuffer> {
  const displayStocks = stocks.slice(0, 100);
  const timestamp = getISTTimestamp();
  const W = 1200;

  // Dimensions — match Portfolio Pulse exactly
  const ACCENT_H = 4;
  const HEADER_H = 64;
  const METRICS_H = 48;
  const COL_HEADER_H = 34;
  const ROW_H = 32;
  const FOOTER_H = 30;
  const COL_GAP = 6;
  const HALF_W = (W - COL_GAP) / 2;

  // Sort by change percent descending
  const sorted = [...displayStocks].sort((a, b) => b.changePercent - a.changePercent);
  const winners = sorted.filter(s => s.changePercent >= 0);
  const losers = sorted.filter(s => s.changePercent < 0).reverse();
  const winnersN = winners.length;
  const losersN = losers.length;
  const avgChange = displayStocks.length > 0
    ? Math.round(displayStocks.reduce((a, b) => a + b.changePercent, 0) / displayStocks.length * 100) / 100
    : 0;

  const maxRows = Math.max(winners.length, losers.length);
  const totalHeight = ACCENT_H + HEADER_H + METRICS_H + COL_HEADER_H + (maxRows * ROW_H) + FOOTER_H;

  // High-contrast color palette
  const getPctColor = (pct: number): string => {
    if (pct >= 3) return '#00E676';
    if (pct >= 0.5) return '#69F0AE';
    if (pct >= 0) return '#A5D6A7';
    if (pct > -0.5) return '#EF9A9A';
    if (pct > -3) return '#EF5350';
    return '#FF1744';
  };

  // Render a single stock row
  const renderRow = (s: Stock, idx: number, side: string) => {
    const pctColor = getPctColor(s.changePercent);
    const rowBg = idx % 2 === 0 ? '#101828' : '#161F33';
    const sign = s.changePercent >= 0 ? '+' : '';
    const reason = reasons.get(s.ticker.toUpperCase()) || '';

    return (
      <div key={`${side}-${idx}`} style={{
        display: 'flex', alignItems: 'center', height: `${ROW_H}px`,
        backgroundColor: rowBg, paddingLeft: '8px', paddingRight: '8px',
        borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B',
      }}>
        <div style={{ display: 'flex', width: '22px', color: '#64748B', fontSize: '11px', fontWeight: 700, justifyContent: 'flex-end', marginRight: '6px' }}>
          {idx + 1}
        </div>
        <div style={{ display: 'flex', width: '100px', fontWeight: 900, color: '#F8FAFC', fontSize: '14px' }}>
          {truncate(s.ticker, 10)}
        </div>
        <div style={{ display: 'flex', width: '80px', justifyContent: 'flex-end', color: '#E2E8F0', fontSize: '13px', fontWeight: 700 }}>
          <span style={{ display: 'flex' }}>{s.price.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
        </div>
        <div style={{ display: 'flex', width: '58px', justifyContent: 'flex-end', color: pctColor, fontSize: '12px', fontWeight: 700, marginLeft: '4px' }}>
          <span style={{ display: 'flex' }}>{sign}{s.change.toFixed(1)}</span>
        </div>
        <div style={{ display: 'flex', width: '62px', justifyContent: 'flex-end', color: pctColor, fontWeight: 900, fontSize: '14px', marginLeft: '2px' }}>
          <span style={{ display: 'flex' }}>{sign}{s.changePercent.toFixed(1)}%</span>
        </div>
        <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', marginLeft: '6px' }}>
          {reason ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: s.changePercent >= 0 ? '#052E16' : '#2D0A0A',
              borderWidth: '1px', borderStyle: 'solid',
              borderColor: s.changePercent >= 0 ? '#166534' : '#7F1D1D',
              borderRadius: '4px', paddingLeft: '5px', paddingRight: '5px',
              paddingTop: '1px', paddingBottom: '1px',
            }}>
              <span style={{ display: 'flex', fontSize: '10px', fontWeight: 700, color: s.changePercent >= 0 ? '#86EFAC' : '#FCA5A5' }}>
                {reason}
              </span>
            </div>
          ) : <span style={{ display: 'flex' }} />}
        </div>
      </div>
    );
  };

  // Filler rows
  const renderFillers = (count: number, side: string) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(
        <div key={`fill-${side}-${i}`} style={{ display: 'flex', height: `${ROW_H}px`, backgroundColor: '#101828', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B' }} />
      );
    }
    return out;
  };

  const element = (
    <div style={{
      display: 'flex', flexDirection: 'column', width: `${W}px`, height: `${totalHeight}px`,
      backgroundColor: '#0B1120', fontFamily: 'sans-serif',
    }}>
      {/* Accent bar */}
      <div style={{ display: 'flex', width: '100%', height: `${ACCENT_H}px`, background: 'linear-gradient(90deg, #00E676 0%, #2979FF 50%, #FF1744 100%)' }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: '24px', paddingRight: '24px', height: `${HEADER_H}px`,
        backgroundColor: '#0D1526', borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#1E3A5F',
      }}>
        <span style={{ display: 'flex', fontSize: '28px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '2px' }}>
          WATCHLIST PULSE
        </span>
        <span style={{ display: 'flex', fontSize: '14px', color: '#94A3B8', fontWeight: 700 }}>{timestamp}</span>
      </div>

      {/* KPI Strip */}
      <div style={{
        display: 'flex', alignItems: 'center', paddingLeft: '24px', paddingRight: '24px',
        height: `${METRICS_H}px`, backgroundColor: '#0F1729', fontSize: '17px', fontWeight: 700,
        borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B',
      }}>
        <span style={{ display: 'flex', marginRight: '32px' }}>
          <span style={{ display: 'flex', color: '#FFFFFF', fontWeight: 900, fontSize: '20px' }}>{displayStocks.length}</span>
          <span style={{ display: 'flex', marginLeft: '6px', color: '#94A3B8' }}>Stocks</span>
        </span>
        <span style={{ display: 'flex', marginRight: '32px' }}>
          <span style={{ display: 'flex', color: '#00E676', fontWeight: 900, fontSize: '20px' }}>{winnersN}</span>
          <span style={{ display: 'flex', marginLeft: '6px', color: '#94A3B8' }}>Up</span>
        </span>
        <span style={{ display: 'flex', marginRight: '32px' }}>
          <span style={{ display: 'flex', color: '#FF1744', fontWeight: 900, fontSize: '20px' }}>{losersN}</span>
          <span style={{ display: 'flex', marginLeft: '6px', color: '#94A3B8' }}>Down</span>
        </span>
        <span style={{ display: 'flex' }}>
          <span style={{ display: 'flex', marginRight: '6px', color: '#94A3B8' }}>Avg</span>
          <span style={{ display: 'flex', color: avgChange >= 0 ? '#00E676' : '#FF1744', fontWeight: 900, fontSize: '20px' }}>
            {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
          </span>
        </span>
      </div>

      {/* Two-column body */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* LEFT — WINNERS */}
        <div style={{ display: 'flex', flexDirection: 'column', width: `${HALF_W}px` }}>
          <div style={{
            display: 'flex', alignItems: 'center', height: `${COL_HEADER_H}px`,
            backgroundColor: '#071A0B', paddingLeft: '8px', paddingRight: '8px',
            borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#00C853',
          }}>
            <div style={{ display: 'flex', width: '22px', marginRight: '6px' }} />
            <div style={{ display: 'flex', width: '100px', fontSize: '12px', fontWeight: 900, color: '#00E676', letterSpacing: '1px' }}>
              WINNERS ({winnersN})
            </div>
            <div style={{ display: 'flex', width: '80px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B' }}>PRICE</div>
            <div style={{ display: 'flex', width: '58px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B', marginLeft: '4px' }}>CHG</div>
            <div style={{ display: 'flex', width: '62px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B', marginLeft: '2px' }}>%CHG</div>
            <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B', marginLeft: '6px' }}>WHY</div>
          </div>
          {winners.map((s, i) => renderRow(s, i, 'w'))}
          {winners.length < maxRows && renderFillers(maxRows - winners.length, 'w')}
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', width: `${COL_GAP}px`, backgroundColor: '#1E3A5F' }} />

        {/* RIGHT — LOSERS */}
        <div style={{ display: 'flex', flexDirection: 'column', width: `${HALF_W}px` }}>
          <div style={{
            display: 'flex', alignItems: 'center', height: `${COL_HEADER_H}px`,
            backgroundColor: '#1A0808', paddingLeft: '8px', paddingRight: '8px',
            borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#D50000',
          }}>
            <div style={{ display: 'flex', width: '22px', marginRight: '6px' }} />
            <div style={{ display: 'flex', width: '100px', fontSize: '12px', fontWeight: 900, color: '#FF1744', letterSpacing: '1px' }}>
              LOSERS ({losersN})
            </div>
            <div style={{ display: 'flex', width: '80px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B' }}>PRICE</div>
            <div style={{ display: 'flex', width: '58px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B', marginLeft: '4px' }}>CHG</div>
            <div style={{ display: 'flex', width: '62px', justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B', marginLeft: '2px' }}>%CHG</div>
            <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', fontSize: '10px', fontWeight: 800, color: '#64748B', marginLeft: '6px' }}>WHY</div>
          </div>
          {losers.map((s, i) => renderRow(s, i, 'l'))}
          {losers.length < maxRows && renderFillers(maxRows - losers.length, 'l')}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingLeft: '24px', paddingRight: '24px', height: `${FOOTER_H}px`,
        backgroundColor: '#0B1120', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#1E293B',
        fontSize: '12px', color: '#64748B', fontWeight: 600,
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

        // Save directly to Redis (no fire-and-forget HTTP)
        await kvSet(`watchlist:${chatId}`, updated);

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

          // Save directly to Redis (no fire-and-forget HTTP)
          await kvSet(`watchlist:${chatId}`, updated);

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
          const reasons = await fetchStockReasons(stocks.map(s => s.ticker));
          const img = await generateWatchlistImage(stocks, reasons);
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
    const reasons = await fetchStockReasons(stocks.map(s => s.ticker));
    const img = await generateWatchlistImage(stocks, reasons);
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
