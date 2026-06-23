// PATCH 0324 — Transmission server-side z-score statistical layer.
//
// GET /api/v1/transmission/zscore/<commodity>?window=<days>
//
// For each commodity in the transmission universe, compute the
// z-score of the current price vs the rolling distribution. Lets
// users see "current price is +2.1σ above the 5yr mean" — much
// more institutionally meaningful than the raw 1m / 3m % change.
//
// Data source: pulls historical prices from the existing
// /api/v1/transmission endpoint (which already returns sparklines)
// OR from Yahoo Finance directly when sparkline is too short for
// the requested window.
//
// Windows supported: 60 (3m), 180 (6m), 365 (1y), 1825 (5y).
//
// Cached in KV 1h since commodity prices update at most hourly.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

const KEY = (commodity: string, window: number) => `tx-zscore:v1:${commodity}:${window}`;
const TTL_SECONDS = 60 * 60; // 1h

type Window = 60 | 180 | 365 | 1825;
const VALID_WINDOWS = new Set<Window>([60, 180, 365, 1825]);

interface ZScoreResult {
  commodity: string;
  window_days: number;
  current_price: number;
  mean: number;
  median: number;
  std_dev: number;
  z_score: number;            // current vs window mean / std
  percentile: number;         // 0-100 — where in the historical distribution
  min: number;
  max: number;
  sample_size: number;
  interpretation: string;     // one-line institutional read
  source: 'COMPUTED' | 'CACHED' | 'INSUFFICIENT_DATA';
  generated_at: string;
}

function computeStats(prices: number[]): { mean: number; std: number; median: number; min: number; max: number } | null {
  if (prices.length < 5) return null;
  const cleaned = prices.filter(p => Number.isFinite(p) && p > 0);
  if (cleaned.length < 5) return null;
  const mean = cleaned.reduce((s, p) => s + p, 0) / cleaned.length;
  const variance = cleaned.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / cleaned.length;
  const std = Math.sqrt(variance);
  const sorted = [...cleaned].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { mean, std, median, min: sorted[0], max: sorted[sorted.length - 1] };
}

function interpretZ(z: number, windowDays: number): string {
  const horizon = windowDays >= 1000 ? '5yr' : windowDays >= 300 ? '1yr' : windowDays >= 150 ? '6m' : '3m';
  if (z > 2.5) return `Extremely elevated vs ${horizon} history (>2.5σ) — mean-reversion risk high; positioning likely crowded.`;
  if (z > 1.5) return `Materially above ${horizon} mean (${z.toFixed(1)}σ) — sustained at this level requires continued tailwind; consider trim.`;
  if (z > 0.5) return `Modestly above ${horizon} mean (${z.toFixed(1)}σ) — within normal range.`;
  if (z > -0.5) return `Near ${horizon} mean (${z.toFixed(1)}σ) — fair-value zone.`;
  if (z > -1.5) return `Modestly below ${horizon} mean (${z.toFixed(1)}σ) — value zone if structurally intact.`;
  if (z > -2.5) return `Materially below ${horizon} mean (${z.toFixed(1)}σ) — institutional buy-zone for non-cyclical commodities; cyclical bottoms can extend.`;
  return `Extreme below ${horizon} mean (${z.toFixed(1)}σ) — historically rare; capitulation likely if cyclical.`;
}

async function fetchPriceHistory(commodity: string, windowDays: number, overrideSymbol: string | null, signal?: AbortSignal): Promise<number[]> {
  // Try Yahoo Finance first; it has reliable history for most commodities.
  // The transmission endpoint maps each commodity to its Yahoo symbol.
  const symbolMap: Record<string, string> = {
    crude:       'CL=F',
    brent:       'BZ=F',
    natgas:      'NG=F',
    gold:        'GC=F',
    silver:      'SI=F',
    copper:      'HG=F',
    aluminum:    'ALI=F',
    zinc:        'ZN=F',
    soybean_oil: 'ZL=F',
    soybean:     'ZS=F',
    corn:        'ZC=F',
    wheat:       'ZW=F',
    coffee:      'KC=F',
    sugar:       'SB=F',
    cocoa:       'CC=F',
    cotton:      'CT=F',
    lithium:     'LIT',
    uranium:     'URA',
    rare_earth:  'REMX',
    palladium:   'PA=F',
    platinum:    'PL=F',
  };
  // PATCH 0330 — accept Yahoo symbol directly via ?symbol= override.
  // Lets the Transmission page pass each commodity's actual Yahoo symbol
  // without needing to know the internal keying.
  const symbol = overrideSymbol || symbolMap[commodity.toLowerCase()];
  if (!symbol) return [];

  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - (windowDays + 7) * 86400; // +7d buffer for weekends/holidays
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes)) return [];
    return closes.filter((p: any) => Number.isFinite(p) && p > 0);
  } catch {
    return [];
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ commodity: string }> }) {
 try {
  const { commodity } = await params;
  if (!commodity) return NextResponse.json({ error: 'commodity required' }, { status: 400 });
  // PATCH zzz65 — restrict commodity path param to safe chars (used in KV key).
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(commodity)) {
    return NextResponse.json({ error: 'invalid commodity' }, { status: 400 });
  }
  const windowRaw = parseInt(req.nextUrl.searchParams.get('window') || '365', 10);
  const windowDays = (VALID_WINDOWS.has(windowRaw as Window) ? windowRaw : 365) as Window;
  const force = req.nextUrl.searchParams.get('force') === '1';

  const overrideSymbol = req.nextUrl.searchParams.get('symbol');
  const cacheKey = overrideSymbol ? `${commodity}__${overrideSymbol}` : commodity;
  if (isRedisAvailable() && !force) {
    const cached = await kvGet<ZScoreResult>(KEY(cacheKey, windowDays));
    if (cached) return NextResponse.json({ ...cached, source: 'CACHED' });
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  const prices = await fetchPriceHistory(commodity, windowDays, overrideSymbol, controller.signal);
  clearTimeout(tid);

  if (prices.length < 30) {
    const result: ZScoreResult = {
      commodity, window_days: windowDays,
      current_price: 0, mean: 0, median: 0, std_dev: 0, z_score: 0, percentile: 0,
      min: 0, max: 0, sample_size: prices.length,
      interpretation: 'Insufficient price history for z-score computation.',
      source: 'INSUFFICIENT_DATA',
      generated_at: new Date().toISOString(),
    };
    return NextResponse.json(result);
  }

  const current = prices[prices.length - 1];
  const stats = computeStats(prices);
  if (!stats) {
    // PATCH zzz65 — was returning HTTP 500 for legitimate sparse-history case
    // (inconsistent with line 152 which returns 200). Return 200 with same
    // INSUFFICIENT_DATA shape so client doesn't think server is broken.
    return NextResponse.json({
      commodity, window_days: windowDays,
      current_price: 0, mean: 0, median: 0, std_dev: 0, z_score: 0, percentile: 0,
      min: 0, max: 0, sample_size: prices.length,
      interpretation: 'Failed to compute statistics.',
      source: 'INSUFFICIENT_DATA',
      generated_at: new Date().toISOString(),
    });
  }
  const z = stats.std > 0 ? (current - stats.mean) / stats.std : 0;
  // Percentile: where does current fall in sorted history?
  const sorted = [...prices].sort((a, b) => a - b);
  const idx = sorted.findIndex(p => p >= current);
  const percentile = idx >= 0 ? (idx / sorted.length) * 100 : 100;

  const result: ZScoreResult = {
    commodity, window_days: windowDays,
    current_price: current,
    mean: Math.round(stats.mean * 100) / 100,
    median: Math.round(stats.median * 100) / 100,
    std_dev: Math.round(stats.std * 100) / 100,
    z_score: Math.round(z * 100) / 100,
    percentile: Math.round(percentile * 10) / 10,
    min: Math.round(stats.min * 100) / 100,
    max: Math.round(stats.max * 100) / 100,
    sample_size: prices.length,
    interpretation: interpretZ(z, windowDays),
    source: 'COMPUTED',
    generated_at: new Date().toISOString(),
  };
  if (isRedisAvailable()) {
    await kvSet(KEY(cacheKey, windowDays), result, TTL_SECONDS);
  }
  return NextResponse.json(result);
 } catch (e: any) {
  // PATCH zzz65 — outer try/catch.
  console.error('[transmission/zscore] fatal error', e?.message || e);
  return NextResponse.json({
    error: 'zscore temporarily unavailable',
    source: 'ERROR',
    generated_at: new Date().toISOString(),
  }, { status: 200 });
 }
}
