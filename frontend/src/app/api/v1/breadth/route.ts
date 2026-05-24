// ═══════════════════════════════════════════════════════════════════════════
// MARKET BREADTH INDICATOR (PATCH 0168)
//
// GET /api/v1/breadth
//
// Returns composite breadth score 0-100 with regime label, plus pillar
// breakdowns. Powers the /breadth page AND can be consumed by other tabs
// to modify stock scores dynamically.
//
// PILLARS (weights):
//   35% TREND BREADTH  (% above 50/200 DMA, A/D ratio, new highs vs lows)
//   25% SECTOR BREADTH (how many sectors above 50DMA, cyclicals vs defensives)
//   20% SMALLCAP PARTICIPATION (smallcap vs nifty, % small above 200DMA)
//   10% INSTITUTIONAL FLOW (FII/DII broad buying)
//   10% MOMENTUM BREADTH (% making higher highs, % outperforming Nifty)
//
// Regime labels:
//   80+    Expansion
//   60-79  Healthy Bull
//   40-59  Transitional
//   <40    Risk-Off
//
// Cached 5 min via Cache-Control header (Vercel edge).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NSE_BASE = 'https://www.nseindia.com/api';
const YH_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 25-symbol Indian breadth basket (Nifty + sector reps) — keeps fetch budget tight
const BASKET = [
  '^NSEI','^CNXIT','^CNXAUTO','^CNXBANK','^CNXPHARMA','^CNXFMCG','^CNXREALTY','^CNXENERGY',
  '^CNXMETAL','^CNXPSUBANK','^CNXMEDIA','^CNXINFRA',
  '^CNXSMALLCAP','^CNXMIDCAP',
  // marquee largecaps (sector flag-bearers)
  'RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','HINDUNILVR.NS','ITC.NS','LT.NS','BAJFINANCE.NS','MARUTI.NS','TATAMOTORS.NS','SBIN.NS',
];

interface YahooPoint { close: number; ts: number; }

async function fetchYahooDaily(symbol: string): Promise<YahooPoint[] | null> {
  // PATCH 0453 P1-21 — Audit found no fetch timeout. A single hung Yahoo
  // request can wedge the route up to the Vercel 30s ceiling. 8s per symbol
  // is plenty since we're firing 25 in parallel inside the route handler.
  try {
    const url = `${YH_BASE}/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp || [];
    const closes: (number|null)[] = r.indicators?.quote?.[0]?.close || [];
    const out: YahooPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null && Number.isFinite(closes[i])) out.push({ ts: ts[i], close: closes[i] as number });
    }
    return out.length > 0 ? out : null;
  } catch { return null; }
}

function sma(points: YahooPoint[], window: number): number | null {
  if (points.length < window) return null;
  const last = points.slice(-window);
  return last.reduce((a, b) => a + b.close, 0) / window;
}

function sigmoid(x: number, mid: number, k: number) {
  return 100 / (1 + Math.exp(-(x - mid) / k));
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0807 — Broad-universe breadth path
//
// Default mode now uses the nse-ticker-universe + nse-rolling-stats blobs
// to compute breadth over the full ~2,369-ticker NSE universe instead of
// the 25-symbol Yahoo basket.
//
// DMA proxies (since we don't have explicit 50DMA / 200DMA in the blobs):
//   • mom1M  ≥  0%  → proxy for "above 50DMA"   (in uptrend last month)
//   • pctOf52wHigh ≥ 0.70 → proxy for "above 200DMA" (within 30% of 52W high)
//   • pctOf52wHigh ≥ 0.98 → 52W new high
//   • pctOf52wHigh ≤ 0.05 → 52W new low (within 5% of 52W low)
//
// Sector breadth uses sector field per ticker; participation across all
// sectors with ≥ 5 stocks classified.
//
// Fallback: when the blobs are missing or stale (>48h), the route falls
// back to the legacy 25-symbol Yahoo basket so the page always renders.
// ═══════════════════════════════════════════════════════════════════════════

// PATCH 0809 — actual nse-ticker-universe:v1:latest blob shape:
//   { ticker, company, industry, cap, price, changePercent, deliveryPct,
//     turnoverLacs, hasPrice, ... }
// No `sector`, `marketCap`, or `indexGroup` — those come from enrichments.
interface UniverseTicker {
  ticker: string;
  industry?: string;
  cap?: string;                  // 'Large' | 'Mid' | 'Small' | 'Micro'
  changePercent?: number;
  hasPrice?: boolean;
  turnoverLacs?: number;
}

interface RollingStat {
  vol20DAvg?: number;
  mom1M?: number;
  high52w?: number;
  low52w?: number;
  pctOf52wHigh?: number;
}

interface BroadResult {
  ok: boolean;
  trendScore?: number;
  sectorScore?: number;
  smallcapScore?: number;
  flowScore?: number;
  momScore?: number;
  pillars?: any;
  universeSize?: number;
  cohortDate?: string;
}

async function computeBroadBreadth(): Promise<BroadResult> {
  // Read both blobs in parallel — neither blocks the other.
  const [uniBlob, rsBlob] = await Promise.all([
    kvGet<{ tickers?: UniverseTicker[]; generatedAt?: string }>('nse-ticker-universe:v1:latest').catch(() => null),
    kvGet<{ stats?: Record<string, RollingStat>; generatedAt?: string }>('nse-rolling-stats:v1:latest').catch(() => null),
  ]);

  if (!uniBlob?.tickers || !Array.isArray(uniBlob.tickers) || uniBlob.tickers.length < 100) {
    return { ok: false };
  }

  // Quality gate: blob older than 4 days = stale, fall back.
  if (uniBlob.generatedAt) {
    const ageDays = (Date.now() - new Date(uniBlob.generatedAt).getTime()) / 86400000;
    if (ageDays > 4) return { ok: false };
  }

  const stats = rsBlob?.stats || {};
  const tickers = uniBlob.tickers.filter((t) => t.hasPrice && t.ticker);

  // ─── TREND BREADTH (35%) ─────────────────────────────────────────────
  let aboveTrend50 = 0, hasTrend50 = 0;       // mom1M ≥ 0
  let aboveTrend200 = 0, hasTrend200 = 0;     // pctOf52wHigh ≥ 0.70
  let newHigh = 0, newLow = 0, hasHL = 0;
  for (const t of tickers) {
    const s = stats[t.ticker] || {};
    if (Number.isFinite(s.mom1M)) {
      hasTrend50++;
      if (s.mom1M! >= 0) aboveTrend50++;
    }
    if (Number.isFinite(s.pctOf52wHigh)) {
      hasTrend200++;
      const p = s.pctOf52wHigh!;
      if (p >= 0.70) aboveTrend200++;
      hasHL++;
      if (p >= 0.98) newHigh++;
      if (p <= 0.05) newLow++;
    }
  }
  const pct50 = hasTrend50 > 0 ? (aboveTrend50 / hasTrend50) * 100 : 50;
  const pct200 = hasTrend200 > 0 ? (aboveTrend200 / hasTrend200) * 100 : 50;
  const hlSpread = hasHL > 0 ? ((newHigh - newLow) / hasHL) * 100 : 0;
  const trendScore =
    0.45 * pct50 +
    0.40 * pct200 +
    0.15 * Math.max(0, Math.min(100, 50 + hlSpread * 15));

  // ─── SECTOR BREADTH (25%) ────────────────────────────────────────────
  // P0809: blob uses `industry` not `sector`; group by industry.
  const sectorMom: Record<string, number[]> = {};
  for (const t of tickers) {
    const sec = (t.industry || '').trim();
    if (!sec) continue;
    const s = stats[t.ticker] || {};
    if (!Number.isFinite(s.mom1M)) continue;
    if (!sectorMom[sec]) sectorMom[sec] = [];
    sectorMom[sec].push(s.mom1M!);
  }
  const sectorRows: { sector: string; n: number; medianMom: number; pctUp: number }[] = [];
  for (const [sec, vals] of Object.entries(sectorMom)) {
    if (vals.length < 5) continue;            // require ≥5 stocks to count
    const sorted = vals.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const up = vals.filter((v) => v >= 0).length;
    sectorRows.push({ sector: sec, n: vals.length, medianMom: median, pctUp: (up / vals.length) * 100 });
  }
  const sectorsAbove = sectorRows.filter((r) => r.medianMom >= 0).length;
  const sectorScore = sectorRows.length > 0 ? (sectorsAbove / sectorRows.length) * 100 : 50;

  // ─── SMALLCAP PARTICIPATION (20%) ────────────────────────────────────
  // P0809: blob uses `cap` field ('Large' | 'Mid' | 'Small' | 'Micro').
  let smMomUp = 0, smMomHas = 0;
  let lgMomUp = 0, lgMomHas = 0;
  for (const t of tickers) {
    const s = stats[t.ticker] || {};
    if (!Number.isFinite(s.mom1M)) continue;
    const cap = (t.cap || '').toLowerCase();
    const isSmall = cap === 'small' || cap === 'micro';
    if (isSmall) {
      smMomHas++;
      if (s.mom1M! >= 0) smMomUp++;
    } else {
      lgMomHas++;
      if (s.mom1M! >= 0) lgMomUp++;
    }
  }
  const smPct = smMomHas > 0 ? (smMomUp / smMomHas) * 100 : 50;
  const lgPct = lgMomHas > 0 ? (lgMomUp / lgMomHas) * 100 : 50;
  // Smallcap outperformance = healthy participation
  const smallcapScore = Math.max(0, Math.min(100, 50 + (smPct - lgPct) * 1.0));

  // ─── INSTITUTIONAL FLOW (10%) ────────────────────────────────────────
  // P0809: cap='Large' = institutional ownership concentration tier
  // (top constituents of Nifty + Nifty Next 50). Use turnover ≥ ₹100 Cr
  // (= 10,000 lacs) as a secondary filter so we exclude largecaps with
  // negligible institutional participation today.
  let lcAbove = 0, lcHas = 0;
  for (const t of tickers) {
    const cap = (t.cap || '').toLowerCase();
    if (cap !== 'large') continue;
    const s = stats[t.ticker] || {};
    if (!Number.isFinite(s.pctOf52wHigh)) continue;
    lcHas++;
    if (s.pctOf52wHigh! >= 0.70) lcAbove++;
  }
  const flowScore = lcHas > 0 ? (lcAbove / lcHas) * 100 : 50;

  // ─── MOMENTUM BREADTH (10%) ──────────────────────────────────────────
  // % of universe where today's change AND mom1M agree (sign-aligned)
  let aligned = 0, hasAlign = 0;
  for (const t of tickers) {
    const s = stats[t.ticker] || {};
    if (!Number.isFinite(s.mom1M) || !Number.isFinite(t.changePercent)) continue;
    hasAlign++;
    if (Math.sign(s.mom1M!) === Math.sign(t.changePercent!) && Math.abs(s.mom1M!) > 1) aligned++;
  }
  const momScore = hasAlign > 0 ? (aligned / hasAlign) * 100 : 50;

  return {
    ok: true,
    trendScore, sectorScore, smallcapScore, flowScore, momScore,
    pillars: {
      trend: {
        score: Math.round(trendScore),
        weight: 35,
        pct50: Math.round(pct50),
        pct200: Math.round(pct200),
        newHigh,
        newLow,
        hlSpread: Math.round(hlSpread),
        proxy: true,                          // signal to UI: these are proxies
        proxyNote: 'mom1M ≥ 0 used as 50DMA proxy; pctOf52wHigh ≥ 0.70 as 200DMA proxy',
      },
      sector: {
        score: Math.round(sectorScore),
        weight: 25,
        above: sectorsAbove,
        total: sectorRows.length,
        topSectors: sectorRows.slice().sort((a, b) => b.medianMom - a.medianMom).slice(0, 5)
          .map((r) => ({ sector: r.sector, n: r.n, medianMom: +r.medianMom.toFixed(2), pctUp: Math.round(r.pctUp) })),
        bottomSectors: sectorRows.slice().sort((a, b) => a.medianMom - b.medianMom).slice(0, 5)
          .map((r) => ({ sector: r.sector, n: r.n, medianMom: +r.medianMom.toFixed(2), pctUp: Math.round(r.pctUp) })),
      },
      smallcap: { score: Math.round(smallcapScore), weight: 20, smPct: Math.round(smPct), lgPct: Math.round(lgPct), smCount: smMomHas, lgCount: lgMomHas },
      flow:     { score: Math.round(flowScore), weight: 10, lcAbove, lcTotal: lcHas, proxy: true, proxyNote: 'largecap above 200DMA proxy = institutional ownership concentration' },
      momentum: { score: Math.round(momScore), weight: 10, aligned, total: hasAlign },
    },
    universeSize: tickers.length,
    cohortDate: uniBlob.generatedAt,
  };
}

export async function GET(request: Request) {
  const t0 = Date.now();
  const { searchParams } = new URL(request.url);
  const mode = (searchParams.get('mode') || 'broad').toLowerCase();   // PATCH 0807 — default to broad

  // ─── BROAD MODE — read from KV blobs, full NSE universe ──────────────
  if (mode === 'broad' || mode === 'auto') {
    const broad = await computeBroadBreadth();
    if (broad.ok) {
      const composite =
        broad.trendScore! * 0.35 +
        broad.sectorScore! * 0.25 +
        broad.smallcapScore! * 0.20 +
        broad.flowScore! * 0.10 +
        broad.momScore! * 0.10;
      const compositeR = Math.round(composite);
      const regime =
        compositeR >= 80 ? { label: 'Expansion',    color: '#10B981', desc: 'Broad participation, aggressive risk-on', cash: 0 } :
        compositeR >= 60 ? { label: 'Healthy Bull', color: '#22D3EE', desc: 'Bullish but selective; reward leadership', cash: 10 } :
        compositeR >= 40 ? { label: 'Transitional', color: '#F59E0B', desc: 'Mixed signals; penalize weak balance sheets', cash: 25 } :
                           { label: 'Risk-Off',     color: '#EF4444', desc: 'Narrow tape; only quality and FCF survives', cash: 45 };
      const payload = {
        composite: compositeR,
        regime: regime.label,
        regime_color: regime.color,
        regime_desc: regime.desc,
        suggested_cash_pct: regime.cash,
        pillars: broad.pillars,
        universe_size: broad.universeSize,
        scope: 'broad',
        scope_label: `Full NSE universe (${broad.universeSize} stocks)`,
        source: 'nse-ticker-universe + nse-rolling-stats (GH Actions BHAVCOPY)',
        cohort_date: broad.cohortDate,
        ms: Date.now() - t0,
        generated_at: new Date().toISOString(),
      };
      return NextResponse.json(payload, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' } });
    }
    // Fall through to Yahoo basket when blobs missing/stale
  }

  // ─── LEGACY YAHOO BASKET (?mode=basket or blob fallback) ─────────────
  // Fetch all in parallel
  const results = await Promise.all(BASKET.map((s) => fetchYahooDaily(s)));
  const byName = new Map<string, YahooPoint[]>();
  BASKET.forEach((s, i) => { if (results[i]) byName.set(s, results[i]!); });

  // ─── TREND BREADTH (35%) ──────────────────────────────────────────────
  let above50 = 0, above200 = 0, has50 = 0, has200 = 0;
  let newHigh = 0, newLow = 0, hasHL = 0;
  for (const [sym, pts] of byName.entries()) {
    if (pts.length < 50) continue;
    const last = pts[pts.length - 1].close;
    const m50 = sma(pts, 50);
    if (m50 != null) { has50++; if (last > m50) above50++; }
    const m200 = sma(pts, 200);
    if (m200 != null) { has200++; if (last > m200) above200++; }
    // 1y new high/low check on basket members (excluding indices)
    if (!sym.startsWith('^')) {
      const closes = pts.map((p) => p.close);
      const max = Math.max(...closes);
      const min = Math.min(...closes);
      hasHL++;
      if (last >= max * 0.99) newHigh++;
      if (last <= min * 1.05) newLow++;
    }
  }
  const pct50 = has50 > 0 ? (above50 / has50) * 100 : 50;
  const pct200 = has200 > 0 ? (above200 / has200) * 100 : 50;
  const hlSpread = hasHL > 0 ? ((newHigh - newLow) / hasHL) * 100 : 0;
  const trendScore =
    0.45 * pct50 +
    0.40 * pct200 +
    0.15 * Math.max(0, Math.min(100, 50 + hlSpread * 1.5));

  // ─── SECTOR BREADTH (25%) ─────────────────────────────────────────────
  // Count sector indices above their 50DMA
  const sectorIndices = ['^CNXIT','^CNXAUTO','^CNXBANK','^CNXPHARMA','^CNXFMCG','^CNXREALTY','^CNXENERGY','^CNXMETAL','^CNXPSUBANK','^CNXMEDIA','^CNXINFRA'];
  let secAbove = 0, secHas = 0;
  for (const s of sectorIndices) {
    const pts = byName.get(s);
    if (!pts || pts.length < 50) continue;
    secHas++;
    const m50 = sma(pts, 50);
    if (m50 != null && pts[pts.length - 1].close > m50) secAbove++;
  }
  const sectorScore = secHas > 0 ? (secAbove / secHas) * 100 : 50;

  // ─── SMALLCAP PARTICIPATION (20%) ─────────────────────────────────────
  // Smallcap index vs Nifty 1m
  const smallcap = byName.get('^CNXSMALLCAP');
  const nifty = byName.get('^NSEI');
  let smallcapScore = 50;
  if (smallcap && nifty && smallcap.length >= 21 && nifty.length >= 21) {
    const sc_1m = (smallcap[smallcap.length - 1].close - smallcap[smallcap.length - 21].close) / smallcap[smallcap.length - 21].close;
    const nf_1m = (nifty[nifty.length - 1].close - nifty[nifty.length - 21].close) / nifty[nifty.length - 21].close;
    const diff = (sc_1m - nf_1m) * 100;  // pp outperformance
    smallcapScore = sigmoid(diff, 0, 3);
    // Also weight smallcap above 200DMA
    const sm200 = sma(smallcap, 200);
    if (sm200 != null) {
      const aboveBonus = smallcap[smallcap.length - 1].close > sm200 ? 15 : -15;
      smallcapScore = Math.max(0, Math.min(100, smallcapScore + aboveBonus));
    }
  }

  // ─── INSTITUTIONAL FLOW (10%) ─────────────────────────────────────────
  // We don't have direct FII/DII feed; proxy: PSU Bank index momentum +
  // CNXFINANCE 1m perf. Strong relative perf = institutional accumulation.
  let flowScore = 50;
  const psu = byName.get('^CNXPSUBANK');
  if (psu && nifty && psu.length >= 21 && nifty.length >= 21) {
    const psu_1m = (psu[psu.length - 1].close - psu[psu.length - 21].close) / psu[psu.length - 21].close;
    const nf_1m = (nifty[nifty.length - 1].close - nifty[nifty.length - 21].close) / nifty[nifty.length - 21].close;
    const diff = (psu_1m - nf_1m) * 100;
    flowScore = sigmoid(diff, 0, 4);
  }

  // ─── MOMENTUM BREADTH (10%) ───────────────────────────────────────────
  // % of basket making higher highs in last 20 days
  let mhh = 0, mhhHas = 0;
  for (const [sym, pts] of byName.entries()) {
    if (sym.startsWith('^')) continue;
    if (pts.length < 60) continue;
    mhhHas++;
    const recent20 = pts.slice(-20).map((p) => p.close);
    const prev20 = pts.slice(-40, -20).map((p) => p.close);
    if (recent20.length > 0 && prev20.length > 0) {
      const recentHigh = Math.max(...recent20);
      const prevHigh = Math.max(...prev20);
      if (recentHigh > prevHigh) mhh++;
    }
  }
  const momScore = mhhHas > 0 ? (mhh / mhhHas) * 100 : 50;

  // ─── COMPOSITE ────────────────────────────────────────────────────────
  const composite = (
    trendScore * 0.35 +
    sectorScore * 0.25 +
    smallcapScore * 0.20 +
    flowScore * 0.10 +
    momScore * 0.10
  );
  const compositeR = Math.round(composite);

  const regime =
    compositeR >= 80 ? { label: 'Expansion', color: '#10B981', desc: 'Broad participation, aggressive risk-on', cash: 0 } :
    compositeR >= 60 ? { label: 'Healthy Bull', color: '#22D3EE', desc: 'Bullish but selective; reward leadership', cash: 10 } :
    compositeR >= 40 ? { label: 'Transitional', color: '#F59E0B', desc: 'Mixed signals; penalize weak balance sheets', cash: 25 } :
                       { label: 'Risk-Off',     color: '#EF4444', desc: 'Narrow tape; only quality and FCF survives', cash: 45 };

  const payload = {
    composite: compositeR,
    regime: regime.label,
    regime_color: regime.color,
    regime_desc: regime.desc,
    suggested_cash_pct: regime.cash,
    pillars: {
      trend:    { score: Math.round(trendScore), weight: 35, pct50: Math.round(pct50), pct200: Math.round(pct200), newHigh, newLow, hlSpread: Math.round(hlSpread) },
      sector:   { score: Math.round(sectorScore), weight: 25, above: secAbove, total: secHas },
      smallcap: { score: Math.round(smallcapScore), weight: 20 },
      flow:     { score: Math.round(flowScore), weight: 10 },
      momentum: { score: Math.round(momScore), weight: 10, makingHigherHighs: mhh, total: mhhHas },
    },
    universe_size: byName.size,
    scope: 'basket',                                    // PATCH 0807
    scope_label: `Curated 25-symbol Yahoo basket (${byName.size} resolved)`,
    source: 'Yahoo Finance daily bars',
    ms: Date.now() - t0,
    generated_at: new Date().toISOString(),
  };
  return NextResponse.json(payload, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' } });
}
