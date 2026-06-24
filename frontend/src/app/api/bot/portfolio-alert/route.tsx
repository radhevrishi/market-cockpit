import { NextResponse } from 'next/server';
// PATCH 0715 — centralized IST helpers.
import { istNow as _istNow } from '@/lib/market-hours';
import { ImageResponse } from 'next/og';
import React from 'react';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchQuotesWithFallback } from '@/lib/yahoo';
import { fetchNifty500, fetchNiftyMidcap250, fetchNiftySmallcap250, fetchNiftyMicrocap250, fetchNiftyTotalMarket, fetchGainers, fetchLosers, nseApiFetch } from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Config ──────────────────────────────────────────────────────────────
// Server-only — leaked token rotated; set TELEGRAM_BOT_TOKEN_PORTFOLIO
// (or TELEGRAM_BOT_TOKEN as a shared default) in Vercel env vars.
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN_PORTFOLIO || process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID_PORTFOLIO || process.env.TELEGRAM_CHAT_ID || '';
// PATCH 1095c — accept CRON_SECRET as a fallback so vercel-cron-bridge.yml
// (which sends ?secret=$CRON_SECRET uniformly) authenticates without
// having to plumb a second secret into GitHub Actions. The original
// MC_BOT_SECRET path still works for any other caller. Same pattern as
// movers-alert (1095a) and watchlist-alert (1095b).
const BOT_SECRET = process.env.MC_BOT_SECRET || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const API_BASE = 'https://market-cockpit-production.up.railway.app';

// ── Default Portfolio (user's actual holdings) ─────────────────────────
const DEFAULT_PORTFOLIO = [
  'HFCL', 'GRAVITA', 'CEINSYS', 'AEROFLEX', 'CPPLUS', 'DIXON',
  'IKS', 'PARAS', 'QPOWER', 'JSWINFRA', 'DEEDEV', 'WELCORP',
  'LUMAXTECH', 'MTARTECH', 'WAAREEENER', 'HBLENGINE',
];

// NSE headers/cookies handled by @/lib/nse (shared across all routes)

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

// ── Portfolio Storage (direct Redis — no self-referencing HTTP calls) ───
const portfolioStorage: Record<string, Portfolio> = {};

async function getPortfolio(chatId: string): Promise<string[]> {
  // PATCH zzz81 — read PortfolioData (portal schema) OR legacy string[].
  // Empty if neither — no more hardcoded DEFAULT_PORTFOLIO seed.
  try {
    const stored = await kvGet<any>(`portfolio:${chatId}`);
    if (stored?.holdings && Array.isArray(stored.holdings)) {
      const syms = stored.holdings
        .map((h: any) => String(h.symbol || '').trim().toUpperCase())
        .filter((s: string) => s.length > 0);
      console.log(`[PORTFOLIO] Loaded ${syms.length} holdings from PortfolioData (portal sync) for ${chatId}`);
      return syms;
    }
    if (Array.isArray(stored) && stored.length > 0) {
      const syms = stored.map((s: any) => String(s).trim().toUpperCase()).filter((s: string) => s.length > 0);
      console.log(`[PORTFOLIO] Loaded ${syms.length} symbols from legacy string[] for ${chatId}`);
      return syms;
    }
  } catch (e) {
    console.warn('[PORTFOLIO] KV read failed:', e);
  }
  if (portfolioStorage[chatId] && portfolioStorage[chatId].stocks.length > 0) {
    return portfolioStorage[chatId].stocks;
  }
  // PATCH zzz82 — first-time / empty KV: seed defaults into KV as PortfolioData
  // so the /portfolio dashboard tab also sees them. User can /add or /remove
  // to customize from here.
  if (DEFAULT_PORTFOLIO.length > 0) {
    try {
      await savePortfolioToKv(chatId, [...DEFAULT_PORTFOLIO]);
      portfolioStorage[chatId] = { stocks: [...DEFAULT_PORTFOLIO], addedAt: Date.now() };
      console.log(`[PORTFOLIO] First-time seed: wrote ${DEFAULT_PORTFOLIO.length} DEFAULT_PORTFOLIO to KV for ${chatId}`);
      return [...DEFAULT_PORTFOLIO];
    } catch (e) {
      console.warn('[PORTFOLIO] seed failed, returning defaults in-memory only:', e);
      return [...DEFAULT_PORTFOLIO];
    }
  }
  console.log(`[PORTFOLIO] No portfolio for ${chatId} and no defaults — empty`);
  return [];
}

// PATCH zzz81 — write PortfolioData schema (portal-compat). Preserves existing
// entryPrice/quantity for symbols that were already there.
async function savePortfolioToKv(chatId: string, symbols: string[]): Promise<void> {
  try {
    const existing = await kvGet<any>(`portfolio:${chatId}`);
    let existingHoldings: any[] = [];
    if (existing?.holdings && Array.isArray(existing.holdings)) {
      existingHoldings = existing.holdings;
    } else if (Array.isArray(existing)) {
      existingHoldings = existing.map((s: any) => ({
        symbol: String(s).trim().toUpperCase(),
        entryPrice: 0,
        quantity: 0,
        weight: 0,
        addedAt: new Date().toISOString(),
      }));
    }
    const symSet = new Set(symbols.map(s => s.toUpperCase()));
    const merged: any[] = existingHoldings.filter((h: any) => symSet.has(String(h.symbol || '').toUpperCase()));
    const existingSyms = new Set(merged.map((h: any) => String(h.symbol).toUpperCase()));
    for (const sym of symbols) {
      const up = sym.toUpperCase();
      if (!existingSyms.has(up)) {
        merged.push({ symbol: up, entryPrice: 0, quantity: 0, weight: 0, addedAt: new Date().toISOString() });
      }
    }
    await kvSet(`portfolio:${chatId}`, { holdings: merged, updatedAt: new Date().toISOString() });
    console.log(`[PORTFOLIO] Saved ${merged.length} holdings to KV as PortfolioData`);
  } catch (e) {
    console.error('[PORTFOLIO] savePortfolioToKv failed:', e);
    throw e;
  }
}

function setPortfolio(chatId: string, stocks: string[]): void {
  const unique = [...new Set(stocks.map(s => s.trim().toUpperCase()).filter(s => s.length > 0 && s.length < 30))];
  portfolioStorage[chatId] = {
    stocks: unique,
    addedAt: Date.now(),
  };
}

// NSE helpers removed — using @/lib/nse directly (shared cookies, caching, retry)

// ── Fetch Portfolio Stocks (DIRECT NSE LIB — zero self-referencing calls) ──
async function fetchPortfolioStocks(portfolio: string[]): Promise<Stock[]> {
  const portfolioSet = new Set(portfolio.map(t => t.toUpperCase()));
  const allStocks: Stock[] = [];
  const seen = new Set<string>();

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

  console.log(`[PORTFOLIO] Fetching ${portfolio.length} stocks via DIRECT NSE lib (no self-calls)...`);
  const phase1Start = Date.now();

  // ── PHASE 1: Fetch ALL NSE indices in PARALLEL using the shared @/lib/nse ──
  // These functions have built-in caching (60s), cookie management, retry on 403.
  // NO self-referencing HTTP calls — runs in the SAME serverless function.
  const [n500, mid250, sml250, micro250, totalMkt, gainers, losers] = await Promise.allSettled([
    fetchNifty500().catch(() => null),
    fetchNiftyMidcap250().catch(() => null),
    fetchNiftySmallcap250().catch(() => null),
    fetchNiftyMicrocap250().catch(() => null),
    fetchNiftyTotalMarket().catch(() => null),
    fetchGainers().catch(() => null),
    fetchLosers().catch(() => null),
  ]);

  // Process each index result
  const processIndex = (result: PromiseSettledResult<any>) => {
    if (result.status !== 'fulfilled' || !result.value?.data) return;
    for (const item of result.value.data) addNseItem(item);
  };
  processIndex(n500);
  processIndex(mid250);
  processIndex(sml250);
  processIndex(micro250);
  processIndex(totalMkt);

  // Gainers/losers have different structure
  const processLive = (result: PromiseSettledResult<any>) => {
    if (result.status !== 'fulfilled' || !result.value) return;
    const v = result.value;
    const items = [...(v.NIFTY?.data || []), ...(v.allSec?.data || [])];
    for (const item of items) addNseItem(item);
  };
  processLive(gainers);
  processLive(losers);

  console.log(`[PORTFOLIO] Phase 1 done in ${Date.now() - phase1Start}ms: ${seen.size}/${portfolio.length} found`);

  // ── PHASE 2: Individual NSE quote for ALL remaining missing stocks — ALL PARALLEL ──
  if (seen.size < portfolio.length) {
    const missing = [...portfolioSet].filter(t => !seen.has(t));
    console.log(`[PORTFOLIO] Phase 2: ${missing.length} missing, fetching individually via nseApiFetch...`);
    const phase2Start = Date.now();

    await Promise.allSettled(
      missing.map(async (symbol) => {
        try {
          const cleanSymbol = symbol.replace(/^NSE:/i, '').replace(/^BOM:/i, '').replace(/^\d+$/, '');
          if (!cleanSymbol) return;
          // Use shared nseApiFetch — handles cookies, caching, retry automatically
          const data = await nseApiFetch(`/api/quote-equity?symbol=${encodeURIComponent(cleanSymbol)}`, 30000);
          if (data?.priceInfo?.lastPrice > 0) {
            const pd = data.priceInfo;
            const info = data.info || {};
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
        } catch (e) {
          console.warn(`[PORTFOLIO] Individual fetch ${symbol} failed:`, e);
        }
      })
    );
    console.log(`[PORTFOLIO] Phase 2 done in ${Date.now() - phase2Start}ms`);
  }

  const stillMissing = [...portfolioSet].filter(t => !seen.has(t));
  if (stillMissing.length > 0) {
    console.warn(`[PORTFOLIO] STILL MISSING ${stillMissing.length}: ${stillMissing.join(', ')}`);
  }

  // ── PHASE 3: Enrich stocks missing sector/industry data ──
  // Phase 1 index scans often don't include industry — fetch individually
  const needSector = allStocks.filter(s => !s.sector);
  if (needSector.length > 0) {
    console.log(`[PORTFOLIO] Phase 3: ${needSector.length} stocks missing sector, enriching...`);
    const phase3Start = Date.now();
    await Promise.allSettled(
      needSector.slice(0, 30).map(async (stock) => {
        try {
          const data = await nseApiFetch(`/api/quote-equity?symbol=${encodeURIComponent(stock.ticker)}`, 10000);
          if (data?.info?.industry) {
            stock.sector = data.info.industry;
          }
        } catch {}
      })
    );
    console.log(`[PORTFOLIO] Phase 3 done in ${Date.now() - phase3Start}ms`);
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

  // Fallback 2: NSE corporate announcements (PARALLEL, using nseApiFetch)
  try {
    const results = await Promise.allSettled(
      portfolio.slice(0, 10).map(async (symbol) => {
        const data = await nseApiFetch(`/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`, 30000);
        if (data) {
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
// IMAGE GENERATION — Portfolio Pulse Card (Institutional Grade)
// ══════════════════════════════════════════════════════════════════════════

function truncate(s: string, maxLen: number): string {
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 2) + '..' : s;
}

function getISTTimestamp(): string {
  // PATCH 0715 — centralized via _istNow + UTC getters.
  const ist = _istNow();
  const day = ist.getUTCDate().toString().padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[ist.getUTCMonth()];
  const year = ist.getUTCFullYear();
  const hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${day} ${month} ${year}, ${h12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

// Generates a SINGLE image with all stocks (dynamic sizing based on count)
async function generatePortfolioImage(stocks: Stock[]): Promise<ArrayBuffer> {
  const displayStocks = stocks.slice(0, 100);
  const timestamp = getISTTimestamp();
  const W = 1200;

  // Sort
  const sorted = [...displayStocks].sort((a, b) => b.changePercent - a.changePercent);
  const winners = sorted.filter(s => s.changePercent >= 0);
  const losers = sorted.filter(s => s.changePercent < 0).reverse();
  const winnersN = winners.length;
  const losersN = losers.length;
  const avgChange = displayStocks.length > 0
    ? Math.round(displayStocks.reduce((a, b) => a + b.changePercent, 0) / displayStocks.length * 100) / 100
    : 0;

  const maxRows = Math.max(winners.length, losers.length);

  // Colors
  const getPctColor = (pct: number): string => {
    if (pct >= 3) return '#00E676';
    if (pct >= 0.5) return '#69F0AE';
    if (pct >= 0) return '#A5D6A7';
    if (pct > -0.5) return '#EF9A9A';
    if (pct > -3) return '#EF5350';
    return '#FF1744';
  };

  {
    // Dimensions — single image, all stocks
    const ACCENT_H = 4;
    const HEADER_H = 64;
    const METRICS_H = 48;
    const COL_HEADER_H = 32;
    const ROW_H = maxRows > 30 ? 34 : maxRows > 20 ? 38 : 44;
    const FOOTER_H = 28;
    const COL_GAP = 4;
    const HALF_W = (W - COL_GAP) / 2;
    const fontSize = maxRows > 30 ? { sym: 13, pct: 13, price: 12, chg: 11, w52: 11, sec: 10, rng: 11, num: 10 }
      : maxRows > 20 ? { sym: 14, pct: 14, price: 13, chg: 12, w52: 12, sec: 11, rng: 12, num: 11 }
      : { sym: 16, pct: 16, price: 14, chg: 13, w52: 13, sec: 12, rng: 13, num: 12 };

    const totalHeight = ACCENT_H + HEADER_H + METRICS_H + COL_HEADER_H + (maxRows * ROW_H) + FOOTER_H;

    // Row renderer — clean single-line layout, no redundant % from 52W
    const renderRow = (s: Stock, idx: number, side: string) => {
      const pctColor = getPctColor(s.changePercent);
      const rowBg = idx % 2 === 0 ? '#0C1322' : '#111B30';
      const sign = s.changePercent >= 0 ? '+' : '';

      // 52W Range Position (200 DMA proxy)
      const rangePct = s.weekHigh52 && s.weekLow52 && s.weekHigh52 > s.weekLow52
        ? ((s.price - s.weekLow52) / (s.weekHigh52 - s.weekLow52)) * 100
        : 50;
      let dotColor = '#334155';
      if (rangePct < 25) dotColor = '#FF1744';
      else if (rangePct < 50) dotColor = '#FF9100';
      else if (rangePct >= 75) dotColor = '#00E676';

      return (
        <div key={`${side}-${idx}`} style={{
          display: 'flex', alignItems: 'center', height: `${ROW_H}px`,
          backgroundColor: rowBg, paddingLeft: '4px', paddingRight: '4px',
          borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B',
        }}>
          {/* # */}
          <div style={{ display: 'flex', width: '16px', color: '#94A3B8', fontSize: `${fontSize.num}px`, fontWeight: 700, justifyContent: 'flex-end', marginRight: '1px' }}>
            {idx + 1}
          </div>
          {/* 200 DMA warning dot */}
          <div style={{ display: 'flex', width: '7px', height: '7px', borderRadius: '4px', backgroundColor: dotColor, marginRight: '2px' }} />
          {/* SYMBOL */}
          <div style={{ display: 'flex', width: '108px', fontWeight: 900, color: '#F1F5F9', fontSize: `${fontSize.sym}px` }}>
            {truncate(s.ticker, 10)}
          </div>
          {/* %CHG */}
          <div style={{ display: 'flex', width: '60px', justifyContent: 'flex-end', color: pctColor, fontWeight: 900, fontSize: `${fontSize.pct}px` }}>
            <span style={{ display: 'flex' }}>{sign}{s.changePercent.toFixed(1)}%</span>
          </div>
          {/* CHG */}
          <div style={{ display: 'flex', width: '56px', justifyContent: 'flex-end', color: pctColor, fontSize: `${fontSize.chg}px`, fontWeight: 600, marginLeft: '1px' }}>
            <span style={{ display: 'flex' }}>{sign}{s.change.toFixed(1)}</span>
          </div>
          {/* PRICE */}
          <div style={{ display: 'flex', width: '62px', justifyContent: 'flex-end', color: '#E5E7EB', fontSize: `${fontSize.price}px`, fontWeight: 600, marginLeft: '2px' }}>
            <span style={{ display: 'flex' }}>{s.price.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
          </div>
          {/* INDUSTRY — flex fills remaining space */}
          <div style={{ display: 'flex', flex: 1, color: '#94A3B8', fontSize: `${fontSize.sec}px`, fontWeight: 600, marginLeft: '4px', overflow: 'hidden' }}>
            <span style={{ display: 'flex' }}>{s.sector || '--'}</span>
          </div>
          {/* 52W HIGH — single line, no % */}
          <div style={{ display: 'flex', width: '56px', justifyContent: 'flex-end', color: '#78909C', fontSize: `${fontSize.w52}px`, fontWeight: 600, marginLeft: '2px' }}>
            <span style={{ display: 'flex' }}>{s.weekHigh52 ? s.weekHigh52.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '--'}</span>
          </div>
          {/* RNG% */}
          <div style={{ display: 'flex', width: '38px', justifyContent: 'flex-end', marginLeft: '2px' }}>
            <span style={{ display: 'flex', fontSize: `${fontSize.rng}px`, fontWeight: 800, color: rangePct >= 75 ? '#00E676' : rangePct >= 50 ? '#FDD835' : rangePct >= 25 ? '#FF9100' : '#FF1744' }}>
              {Math.round(rangePct)}%
            </span>
          </div>
        </div>
      );
    };

    // Filler rows
    const renderFillers = (count: number, side: string) => {
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push(
          <div key={`fill-${side}-${i}`} style={{ display: 'flex', height: `${ROW_H}px`, backgroundColor: '#0C1322', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B' }} />
        );
      }
      return out;
    };

    // Single image — no pagination labels needed

    const element = (
      <div style={{
        display: 'flex', flexDirection: 'column', width: `${W}px`, height: `${totalHeight}px`,
        backgroundColor: '#080E1A', fontFamily: 'sans-serif',
      }}>
        {/* Accent bar */}
        <div style={{ display: 'flex', width: '100%', height: `${ACCENT_H}px`, background: 'linear-gradient(90deg, #00E676 0%, #2979FF 50%, #FF1744 100%)' }} />

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingLeft: '20px', paddingRight: '20px', height: `${HEADER_H}px`,
          backgroundColor: '#0A1128', borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#1E3A5F',
        }}>
          <span style={{ display: 'flex', fontSize: '32px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '1px' }}>
            PORTFOLIO PULSE
          </span>
          <span style={{ display: 'flex', fontSize: '16px', color: '#CBD5E1', fontWeight: 700 }}>{timestamp}</span>
        </div>

        {/* KPI Strip */}
        <div style={{
          display: 'flex', alignItems: 'center', paddingLeft: '20px', paddingRight: '20px',
          height: `${METRICS_H}px`, backgroundColor: '#0C1322', fontSize: '15px', fontWeight: 700,
          borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: '#1E293B',
        }}>
          <span style={{ display: 'flex', marginRight: '28px' }}>
            <span style={{ display: 'flex', color: '#FFFFFF', fontWeight: 900, fontSize: '24px' }}>{displayStocks.length}</span>
            <span style={{ display: 'flex', marginLeft: '5px', color: '#CBD5E1', fontSize: '17px' }}>Holdings</span>
          </span>
          <span style={{ display: 'flex', marginRight: '28px' }}>
            <span style={{ display: 'flex', color: '#00E676', fontWeight: 900, fontSize: '24px' }}>{winnersN}</span>
            <span style={{ display: 'flex', marginLeft: '5px', color: '#CBD5E1', fontSize: '17px' }}>Up</span>
          </span>
          <span style={{ display: 'flex', marginRight: '28px' }}>
            <span style={{ display: 'flex', color: '#FF1744', fontWeight: 900, fontSize: '24px' }}>{losersN}</span>
            <span style={{ display: 'flex', marginLeft: '5px', color: '#CBD5E1', fontSize: '17px' }}>Down</span>
          </span>
          <span style={{ display: 'flex' }}>
            <span style={{ display: 'flex', marginRight: '5px', color: '#CBD5E1', fontSize: '17px' }}>Avg</span>
            <span style={{ display: 'flex', color: avgChange >= 0 ? '#00E676' : '#FF1744', fontWeight: 900, fontSize: '24px' }}>
              {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
            </span>
          </span>
          <span style={{ display: 'flex', marginLeft: '20px' }}>
            <span style={{ display: 'flex', width: '8px', height: '8px', borderRadius: '4px', backgroundColor: '#FF1744', marginRight: '3px' }} />
            <span style={{ display: 'flex', color: '#CBD5E1', fontSize: '12px' }}>Below 200 DMA</span>
          </span>
        </div>


        {/* Two-column body */}
        <div style={{ display: 'flex', flex: 1 }}>
          {/* LEFT — WINNERS */}
          <div style={{ display: 'flex', flexDirection: 'column', width: `${HALF_W}px` }}>
            <div style={{
              display: 'flex', alignItems: 'center', height: `${COL_HEADER_H}px`,
              backgroundColor: '#061208', paddingLeft: '4px', paddingRight: '4px',
              borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#00C853',
            }}>
              <div style={{ display: 'flex', width: '16px', marginRight: '1px' }} />
              <div style={{ display: 'flex', width: '7px', marginRight: '2px' }} />
              <div style={{ display: 'flex', width: '78px', fontSize: '12px', fontWeight: 900, color: '#00E676', letterSpacing: '1px' }}>
                WINNERS ({winnersN})
              </div>
              <div style={{ display: 'flex', width: '52px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8' }}>%CHG</div>
              <div style={{ display: 'flex', width: '48px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '1px' }}>CHG</div>
              <div style={{ display: 'flex', width: '62px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '2px' }}>PRICE</div>
              <div style={{ display: 'flex', flex: 1, fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '4px' }}>INDUSTRY</div>
              <div style={{ display: 'flex', width: '56px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '2px' }}>52W H</div>
              <div style={{ display: 'flex', width: '38px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#FDD835', marginLeft: '2px' }}>RNG%</div>
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
              backgroundColor: '#120606', paddingLeft: '4px', paddingRight: '4px',
              borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#D50000',
            }}>
              <div style={{ display: 'flex', width: '16px', marginRight: '1px' }} />
              <div style={{ display: 'flex', width: '7px', marginRight: '2px' }} />
              <div style={{ display: 'flex', width: '78px', fontSize: '12px', fontWeight: 900, color: '#FF1744', letterSpacing: '1px' }}>
                LOSERS ({losersN})
              </div>
              <div style={{ display: 'flex', width: '52px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8' }}>%CHG</div>
              <div style={{ display: 'flex', width: '48px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '1px' }}>CHG</div>
              <div style={{ display: 'flex', width: '62px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '2px' }}>PRICE</div>
              <div style={{ display: 'flex', flex: 1, fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '4px' }}>INDUSTRY</div>
              <div style={{ display: 'flex', width: '56px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#94A3B8', marginLeft: '2px' }}>52W H</div>
              <div style={{ display: 'flex', width: '38px', justifyContent: 'flex-end', fontSize: '11px', fontWeight: 800, color: '#FDD835', marginLeft: '2px' }}>RNG%</div>
            </div>
            {losers.map((s, i) => renderRow(s, i, 'l'))}
            {losers.length < maxRows && renderFillers(maxRows - losers.length, 'l')}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingLeft: '20px', paddingRight: '20px', height: `${FOOTER_H}px`,
          backgroundColor: '#080E1A', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#1E293B',
          fontSize: '13px', color: '#94A3B8', fontWeight: 600,
        }}>
          <span style={{ display: 'flex' }}>market-cockpit-production.up.railway.app</span>
          <span style={{ display: 'flex' }}>{timestamp}</span>
        </div>
      </div>
    );

    const buf = await (new ImageResponse(element, { width: W, height: totalHeight })).arrayBuffer();
    return buf;
  }
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

async function sendTelegramMediaGroup(
  imageBuffers: ArrayBuffer[],
  caption: string = '',
  chatId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const targetId = chatId || TG_CHAT_ID;
  if (imageBuffers.length === 1) {
    return sendTelegramPhoto(imageBuffers[0], caption, chatId);
  }
  const tgUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendMediaGroup`;
  console.log(`[PORTFOLIO] Sending ${imageBuffers.length} photos as media group to chat=${targetId}`);
  try {
    const formData = new FormData();
    formData.append('chat_id', targetId);
    const media = imageBuffers.map((_, i) => ({
      type: 'photo',
      media: `attach://photo${i}`,
      ...(i === 0 && caption ? { caption, parse_mode: 'HTML' } : {}),
    }));
    formData.append('media', JSON.stringify(media));
    imageBuffers.forEach((buf, i) => {
      formData.append(`photo${i}`, new Blob([buf], { type: 'image/png' }), `pulse_${i}.png`);
    });
    const r = await fetch(tgUrl, { method: 'POST', body: formData });
    const result = await r.json();
    console.log(`[PORTFOLIO] MediaGroup send: ${result.ok ? 'OK' : 'FAILED'} - ${result.description || ''}`);
    return { ok: result.ok, error: result.description };
  } catch (e: any) {
    console.error(`[PORTFOLIO] MediaGroup send EXCEPTION: ${e.message}`);
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
  // PATCH 0715 — centralized via _istNow.
  const ist = _istNow();
  const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

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
    const rawText = (message.text || '').trim();
    // PATCH zzz85 — robust command normalization. Handles @bot suffix,
    // mixed case, weird unicode whitespace. Logs every command for debug.
    // Strip @bot_username anywhere in first token, normalize whitespace.
    const firstSpace = rawText.search(/\s/);
    const cmdRaw = firstSpace === -1 ? rawText : rawText.slice(0, firstSpace);
    const argsRaw = firstSpace === -1 ? '' : rawText.slice(firstSpace + 1);
    const cmd = cmdRaw.replace(/@\w+$/, '').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const text = argsRaw ? `${cmd} ${argsRaw}` : cmd;
    console.log(`[PORTFOLIO] cmd received: raw=${JSON.stringify(rawText)} cmd=${JSON.stringify(cmd)} text=${JSON.stringify(text)}`);
    const firstName = message.chat.first_name || 'there';

    if (text === '/start') {
      await sendTelegramTo(chatId,
        `<b>MC Portfolio Pulse — Connected!</b>\n\nWelcome ${esc(firstName)}! Your portfolio tracker is live.\n\n<b>What you'll receive:</b>\n• Real-time performance cards for YOUR holdings\n• Gainers &amp; losers in your portfolio\n• 52-week high/low proximity alerts\n• Intelligence signals for your stocks\n• Latest news for portfolio companies\n\n<b>Default Portfolio:</b>\n${DEFAULT_PORTFOLIO.slice(0, 8).join(', ')}, …\n\n<b>Commands:</b>\n/add SYMBOL — Add holdings (space-separated)\n/remove SYMBOL — Remove holding\n/list — Show your portfolio\n/pulse — Get portfolio performance card\n/intel — Intelligence signals for your stocks\n/news — Latest news for portfolio\n/blockbuster — My holdings in BLOCKBUSTER tier (yesterday)\n/strong — My holdings in STRONG tier (yesterday)\n/help — Show all commands\n/status — Bot status\n\n<a href="https://market-cockpit-production.up.railway.app/portfolio">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
      );
    } else if (text === '/help') {
      await sendTelegramTo(chatId,
        `<b>MC Portfolio Pulse — Help</b>\n\n<b>Commands:</b>\n/start — Welcome &amp; setup\n/add SYMBOL — Add holdings (space-separated, e.g. /add TCS INFY)\n/remove SYMBOL — Remove single holding\n/list — Show your current portfolio\n/pulse — Generate portfolio performance card\n/intel — Get intelligence signals for portfolio\n/news — Get latest news for portfolio companies\n/status — Bot status &amp; diagnostics\n/help — This help message\n\n<b>Examples:</b>\n<code>/add BAJAJFINSV BHARTIARTL</code> — Add two stocks\n<code>/remove TATAMOTORS</code> — Remove one\n<code>/list</code> — See all holdings\n\n<b>Scheduled Alerts:</b>\nTwice daily: 10:15 AM &amp; 3:15 PM IST\n• Portfolio performance card\n• Relevant news &amp; intelligence\n\n<a href="https://market-cockpit-production.up.railway.app/portfolio">View Dashboard</a>\n<i>Powered by Market Cockpit</i>`
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
    } else if (text === '/add' || text.startsWith('/add ') || text === '/watch' || text.startsWith('/watch ')) {
      // PATCH zzz81 — bare /add usage hint; /watch alias; writes PortfolioData.
      const body = text.replace(/^\/(add|watch)\s*/, '').trim();
      const toAdd = body.split(/[\s,]+/).map((t: string) => t.toUpperCase()).filter((t: string) => t.length > 0 && t.length < 30);
      if (toAdd.length === 0) {
        await sendTelegramTo(chatId, '<b>/add</b> — Add holdings to your portfolio\n\nUsage:\n<code>/add TCS</code>\n<code>/add TCS INFY WIPRO</code>\n<code>/add TCS,INFY,WIPRO</code>\n\nUse /list to see your current portfolio.');
      } else {
        const current = await getPortfolio(chatId);
        const before = current.length;
        const updated = [...new Set([...current, ...toAdd])];
        setPortfolio(chatId, updated);
        try { await savePortfolioToKv(chatId, updated); } catch (e) { console.error('[PORTFOLIO] /add KV save failed:', e); }
        const added = updated.length - before;
        await sendTelegramTo(chatId,
          `[OK] <b>Portfolio Updated</b>\n\n[+] Added: <code>${toAdd.join(', ')}</code>\nNew: <b>${added}</b> · Total: <b>${updated.length}</b>\n\n<i>Synced with /portfolio dashboard.</i>`
        );
      }
    } else if (text === '/remove' || text.startsWith('/remove ') || text === '/unwatch' || text.startsWith('/unwatch ')) {
      // PATCH zzz81 — bare /remove usage hint; /unwatch alias.
      const body = text.replace(/^\/(remove|unwatch)\s*/, '').trim();
      const toRemove = body.toUpperCase().split(/[\s,]+/)[0] || '';
      if (!toRemove) {
        const pf = await getPortfolio(chatId);
        const sample = pf.slice(0, 3).join(', ');
        await sendTelegramTo(chatId, `<b>/remove</b> — Remove a holding\n\nUsage:\n<code>/remove ${sample || 'RELIANCE'}</code>\n\nUse /list to see what you can remove.`);
      } else {
        const current = await getPortfolio(chatId);
        const updated = current.filter((t: string) => t !== toRemove);
        if (updated.length === current.length) {
          await sendTelegramTo(chatId, `[X] <b>${toRemove}</b> not found in your portfolio.`);
        } else {
          setPortfolio(chatId, updated);
          try { await savePortfolioToKv(chatId, updated); } catch {}
          await sendTelegramTo(chatId,
            `[OK] <b>Removed</b>\n\n[-] Removed: <code>${toRemove}</code>\nTotal: <b>${updated.length}</b>\n\n<i>Synced with /portfolio dashboard.</i>`
          );
        }
      }
    } else if (text === '/pulse') {
      await sendTelegramTo(chatId, '<i>Generating portfolio pulse card...</i>');
      const portfolio = await getPortfolio(chatId);
      let stocks = await fetchPortfolioStocks(portfolio);

      // PATCH zzz74 — Yahoo fallback for after-hours / NSE-empty
      if (stocks.length === 0) {
        console.log(`[PORTFOLIO] NSE returned 0 stocks; trying Yahoo fallback for ${portfolio.length} symbols`);
        try {
          const ySyms = portfolio.map((s: string) => `${s.toUpperCase()}.NS`);
          const yQuotes = await fetchQuotesWithFallback(ySyms);
          stocks = yQuotes
            .filter((q: any) => (q?.regularMarketPrice || 0) > 0)
            .map((q: any) => ({
              ticker: String(q.symbol || '').replace(/\.NS$/i, ''),
              company: q.longName || q.shortName || q.symbol,
              price: q.regularMarketPrice || 0,
              changePercent: Math.round((q.regularMarketChangePercent || 0) * 100) / 100,
              change: Math.round((q.regularMarketChange || 0) * 100) / 100,
              cap: 'M',
              sector: q.sector || q.industry || '',
              dayHigh: q.regularMarketDayHigh,
              dayLow: q.regularMarketDayLow,
              weekHigh52: q.fiftyTwoWeekHigh,
              weekLow52: q.fiftyTwoWeekLow,
            }));
          console.log(`[PORTFOLIO] Yahoo fallback returned ${stocks.length}/${portfolio.length} stocks`);
        } catch (e) {
          console.error('[PORTFOLIO] Yahoo fallback failed:', e);
        }
      }

      if (stocks.length === 0) {
        await sendTelegramTo(chatId, '<b>Portfolio Pulse — data sources unavailable</b>\n\nNSE and Yahoo both returned empty. Market closed and feeds throttled.\n\nTry /list to see holdings, or visit the <a href="https://market-cockpit-production.up.railway.app/portfolio">Dashboard</a>.');
      } else {
        try {
          const img = await generatePortfolioImage(stocks);
          const gainers = stocks.filter(s => s.changePercent > 0).length;
          const losers = stocks.filter(s => s.changePercent < 0).length;
          await sendTelegramPhoto(img, `<b>${stocks.length} holdings</b> | Up:${gainers} Down:${losers} — <a href="https://market-cockpit-production.up.railway.app/portfolio">Dashboard</a>`, chatId);
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
        lines.push(`<i>Full analysis: <a href="https://market-cockpit-production.up.railway.app/orders">Intelligence Dashboard</a></i>`);
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
    } else if (text === '/blockbuster' || text === '/strong') {
      // PATCH zzz77 — filter user's portfolio by Earnings Opportunities tier.
      // Different from Street Pulse where these show MARKET-wide results.
      const tier: 'BLOCKBUSTER' | 'STRONG' = text === '/blockbuster' ? 'BLOCKBUSTER' : 'STRONG';
      await sendTelegramTo(chatId, `<i>Checking your portfolio for ${tier} earnings...</i>`);
      const holdings = await getPortfolio(chatId);
      if (!holdings.length) {
        await sendTelegramTo(chatId, 'Your portfolio is empty.');
      } else {
        // Yesterday in IST, weekend-aware (Sat/Sun → Fri)
        const ist = _istNow();
        const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - 1));
        const dow = d.getUTCDay();
        if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
        else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
        const yest = d.toISOString().slice(0, 10);
        try {
          const r = await fetch(`${API_BASE}/api/v1/earnings/graded?date=${yest}`, { signal: AbortSignal.timeout(20_000) });
          if (!r.ok) {
            await sendTelegramTo(chatId, `Could not fetch earnings for ${yest} (HTTP ${r.status}).`);
          } else {
            const data = await r.json();
            const tierCards = (data?.by_tier?.[tier] || []) as any[];
            const myset = new Set(holdings.map((s: string) => s.toUpperCase()));
            const myCards = tierCards.filter((c: any) => myset.has(String(c.ticker || '').toUpperCase()));
            if (!myCards.length) {
              await sendTelegramTo(chatId, `<b>${tier} in your portfolio · ${yest}</b>\n\nNone of your ${holdings.length} holdings filed ${tier}-tier results.\n\n<i>Tip: Street Pulse bot /${tier === 'BLOCKBUSTER' ? 'toptiers' : 'strongbeats'} shows MARKET-wide results.</i>`);
            } else {
              const lines = [`<b>${tier} earnings in your portfolio · ${yest}</b>`, `<i>${myCards.length} of ${holdings.length} holdings</i>`, ''];
              for (const c of myCards) {
                const move = c.move_pct != null ? ` · ${c.move_pct >= 0 ? '+' : ''}${Number(c.move_pct).toFixed(1)}%` : '';
                const score = c.composite_score != null ? ` · Score ${c.composite_score}` : '';
                lines.push(`<b>${esc(c.ticker)}</b> — ${esc(c.company || '')}${move}${score}`);
              }
              await sendTelegramTo(chatId, lines.join('\n'));
            }
          }
        } catch (e: any) {
          console.error(`[PORTFOLIO] /${tier.toLowerCase()} failed:`, e?.message || e);
          await sendTelegramTo(chatId, `Could not fetch ${tier} earnings. Try again later.`);
        }
      }
        } else if (text === '/blockbuster' || text === '/strong') {
      // PATCH zzz77 — filter user's portfolio by Earnings Opportunities tier.
      // Different from Street Pulse where these show MARKET-wide results.
      const tier: 'BLOCKBUSTER' | 'STRONG' = text === '/blockbuster' ? 'BLOCKBUSTER' : 'STRONG';
      await sendTelegramTo(chatId, `<i>Checking your portfolio for ${tier} earnings...</i>`);
      const holdings = await getPortfolio(chatId);
      if (!holdings.length) {
        await sendTelegramTo(chatId, 'Your portfolio is empty.');
      } else {
        // Yesterday in IST, weekend-aware (Sat/Sun → Fri)
        const ist = _istNow();
        const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - 1));
        const dow = d.getUTCDay();
        if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
        else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
        const yest = d.toISOString().slice(0, 10);
        try {
          const r = await fetch(`${API_BASE}/api/v1/earnings/graded?date=${yest}`, { signal: AbortSignal.timeout(20_000) });
          if (!r.ok) {
            await sendTelegramTo(chatId, `Could not fetch earnings for ${yest} (HTTP ${r.status}).`);
          } else {
            const data = await r.json();
            const tierCards = (data?.by_tier?.[tier] || []) as any[];
            const myset = new Set(holdings.map((s: string) => s.toUpperCase()));
            const myCards = tierCards.filter((c: any) => myset.has(String(c.ticker || '').toUpperCase()));
            if (!myCards.length) {
              await sendTelegramTo(chatId, `<b>${tier} in your portfolio · ${yest}</b>\n\nNone of your ${holdings.length} holdings filed ${tier}-tier results.\n\n<i>Tip: Street Pulse bot /${tier === 'BLOCKBUSTER' ? 'toptiers' : 'strongbeats'} shows MARKET-wide results.</i>`);
            } else {
              const lines = [`<b>${tier} earnings in your portfolio · ${yest}</b>`, `<i>${myCards.length} of ${holdings.length} holdings</i>`, ''];
              for (const c of myCards) {
                const move = c.move_pct != null ? ` · ${c.move_pct >= 0 ? '+' : ''}${Number(c.move_pct).toFixed(1)}%` : '';
                const score = c.composite_score != null ? ` · Score ${c.composite_score}` : '';
                lines.push(`<b>${esc(c.ticker)}</b> — ${esc(c.company || '')}${move}${score}`);
              }
              await sendTelegramTo(chatId, lines.join('\n'));
            }
          }
        } catch (e: any) {
          console.error(`[PORTFOLIO] /${tier.toLowerCase()} failed:`, e?.message || e);
          await sendTelegramTo(chatId, `Could not fetch ${tier} earnings. Try again later.`);
        }
      }
    } else if (text === '/status') {
      // PATCH 0715 — centralized via _istNow + UTC getters.
      const ist = _istNow();
      const h = ist.getUTCHours();
      const day = ist.getUTCDay();
      const isMarketDay = day >= 1 && day <= 5;
      const isMarketHours = h >= 9 && h < 16;
      const portfolio = await getPortfolio(chatId);

      await sendTelegramTo(chatId,
        `<b>MC Portfolio Pulse — Status</b>\n\n[OK] Bot: Online\nIST: ${ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}\n${isMarketDay && isMarketHours ? '[+] Market: Open' : '[-] Market: Closed'}\nPortfolio: <b>${portfolio.length}</b> holdings\nAlerts: 10:15 AM &amp; 3:15 PM IST (Mon–Fri)\n\n<i>Portfolio synced to cloud — persists across sessions.</i>`
      );
    } else if (text.startsWith('/') && text.length < 40) {
      console.log(`[PORTFOLIO] Unmatched slash command: ${JSON.stringify(text)}`);
      await sendTelegramTo(chatId, `Unknown command: <code>${esc(text)}</code>\n\nSend /help for the command list.`);
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

  // Fail-closed when both BOT_SECRET and CRON_SECRET are unset; allow Vercel-cron header bypass.
  // PATCH 1095c — accept BOT_SECRET OR CRON_SECRET so vercel-cron-bridge.yml works uniformly.
  const vercelCron = request.headers.get('x-vercel-cron') || request.headers.get('x-vercel-signature') || '';
  if (!BOT_SECRET && !CRON_SECRET) {
    if (!vercelCron) {
      return NextResponse.json({ error: 'server-misconfigured: MC_BOT_SECRET / CRON_SECRET not set' }, { status: 503 });
    }
  } else if (!vercelCron && secret !== BOT_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      `<b>${stocks.length} holdings</b> | Up:${gainers} Down:${losers} — <a href="https://market-cockpit-production.up.railway.app/portfolio">Dashboard</a>`
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
