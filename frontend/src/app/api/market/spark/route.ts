// ════════════════════════════════════════════════════════════════════════════
// /api/market/spark (zzz527) — tiny per-symbol price context for home cards.
// GET ?symbols=A,B,C (≤25). For each symbol: last close, TRUE 52-week high,
// % below it, 1-day change, and a 20-point sparkline (last ~3 months).
// Exists because the bulk NSE quote feed carries no yearHigh for most names —
// which silently froze the Quality Pullbacks at their since-filing values.
// Yahoo daily bars, .NS first then bare (US), 20-min in-memory cache/symbol.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const YH_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface SparkRow {
  symbol: string; last: number; hi52: number; ddPct: number; chg1d: number | null; spark: number[];
}

const cache = new Map<string, { row: SparkRow | null; ts: number }>();
const TTL = 20 * 60 * 1000;

async function fetchCloses(sym: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${YH_BASE}/${encodeURIComponent(sym)}?range=1y&interval=1d`, {
      headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const closes: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .filter((c: any) => typeof c === 'number' && Number.isFinite(c) && c > 0);
    return closes.length >= 30 ? closes : null;
  } catch { return null; }
}

function downsample(closes: number[], points: number): number[] {
  const src = closes.slice(-66); // ~3 months of context
  if (src.length <= points) return src;
  const out: number[] = [];
  for (let i = 0; i < points; i++) out.push(src[Math.round(i * (src.length - 1) / (points - 1))]);
  return out;
}

async function buildRow(symbol: string): Promise<SparkRow | null> {
  const closes = (await fetchCloses(`${symbol}.NS`)) || (await fetchCloses(symbol));
  if (!closes) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const hi52 = Math.max(...closes.slice(-252));
  return {
    symbol,
    last,
    hi52,
    ddPct: (last / hi52 - 1) * 100,
    chg1d: prev > 0 ? (last / prev - 1) * 100 : null,
    spark: downsample(closes, 20),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = String(searchParams.get('symbols') || '')
    .split(',').map((s) => s.toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim())
    .filter(Boolean).slice(0, 25);
  if (!symbols.length) return NextResponse.json({ rows: [] });

  const now = Date.now();
  const rows: SparkRow[] = [];
  await Promise.all(symbols.map(async (s) => {
    const hit = cache.get(s);
    if (hit && now - hit.ts < TTL) { if (hit.row) rows.push(hit.row); return; }
    const row = await buildRow(s);
    cache.set(s, { row, ts: now });
    if (cache.size > 300) { const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]; cache.delete(oldest[0]); }
    if (row) rows.push(row);
  }));
  return NextResponse.json({ rows }, { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=1200' } });
}
