// ════════════════════════════════════════════════════════════════════════════
// /api/market/regime (zzz524) — the portal-wide market-regime engine.
// ────────────────────────────────────────────────────────────────────────────
// One classification, computed server-side from Yahoo daily bars for the two
// benchmark indices, consumed by the RegimeBanner, Cheat Entry, Bounce Desk,
// Position Sizing and Next-Best-Actions. Encodes the regime tree from the
// Oversold Bounce Playbook (research/Oversold_Bounce_Playbook.docx §4):
//   BULL       — above 200DMA, <5% off 52w high
//   PULLBACK   — above 200DMA, 5-12% off high (the buy-the-dip zone)
//   CORRECTION — below 200DMA but drawdown < 12% (whipsaw zone)
//   BEAR       — below 200DMA, drawdown ≥ 12%, no recovery signature
//   RECOVERY   — drawdown ≥ 12% but price reclaimed the 20DMA and the 20DMA
//                is rising (post-capitulation window — the regime-7 analog)
// Cached in-memory 30 min. Never throws — degrades to UNKNOWN per market.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const YH_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface Pt { ts: number; close: number }

async function fetchDaily(symbol: string): Promise<Pt[] | null> {
  try {
    const res = await fetch(`${YH_BASE}/${encodeURIComponent(symbol)}?range=2y&interval=1d`, {
      headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    const ts: number[] = r?.timestamp || [];
    const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close || [];
    const out: Pt[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c != null && Number.isFinite(c)) out.push({ ts: ts[i], close: c });
    }
    return out.length >= 60 ? out : null;
  } catch { return null; }
}

const smaAt = (pts: Pt[], endIdx: number, w: number): number | null => {
  if (endIdx + 1 < w) return null;
  let s = 0; for (let i = endIdx - w + 1; i <= endIdx; i++) s += pts[i].close;
  return s / w;
};

export type RegimeKind = 'BULL' | 'PULLBACK' | 'CORRECTION' | 'BEAR' | 'RECOVERY' | 'UNKNOWN';

export interface MarketRegime {
  kind: RegimeKind;
  close: number | null; sma20: number | null; sma50: number | null; sma200: number | null;
  drawdownPct: number | null;         // % below 52-week high (negative number)
  above200: boolean | null; sma20Rising: boolean | null;
  asOfTs: number | null;
  note: string;                        // one-line human explanation
}

function classify(pts: Pt[] | null): MarketRegime {
  const empty: MarketRegime = { kind: 'UNKNOWN', close: null, sma20: null, sma50: null, sma200: null, drawdownPct: null, above200: null, sma20Rising: null, asOfTs: null, note: 'index history unavailable' };
  if (!pts || pts.length < 210) return empty;
  const i = pts.length - 1;
  const close = pts[i].close;
  const sma20 = smaAt(pts, i, 20), sma50 = smaAt(pts, i, 50), sma200 = smaAt(pts, i, 200);
  const sma20Prev = smaAt(pts, i - 5, 20);
  const yearWindow = pts.slice(Math.max(0, i - 251), i + 1);
  const hi52 = Math.max(...yearWindow.map((p) => p.close));
  const dd = (close / hi52 - 1) * 100;
  const above200 = sma200 != null ? close > sma200 : null;
  const sma20Rising = sma20 != null && sma20Prev != null ? sma20 > sma20Prev : null;

  let kind: RegimeKind = 'UNKNOWN'; let note = '';
  if (above200 === true && dd > -5) { kind = 'BULL'; note = 'above 200DMA, near highs — dips are buyable'; }
  else if (above200 === true) { kind = 'PULLBACK'; note = `uptrend intact, ${dd.toFixed(1)}% off high — the classic dip-buy zone`; }
  else if (dd > -12) { kind = 'CORRECTION'; note = 'below 200DMA but shallow — whipsaw zone, halve size and demand confirmation'; }
  else if (sma20 != null && close > sma20 && sma20Rising === true) { kind = 'RECOVERY'; note = `${dd.toFixed(1)}% drawdown but price back above a rising 20DMA — post-capitulation window`; }
  else { kind = 'BEAR'; note = `${dd.toFixed(1)}% below high and under the 200DMA — oversold readings are continuation signals; single-name bounce lane closed`; }

  return { kind, close, sma20, sma50, sma200, drawdownPct: dd, above200, sma20Rising, asOfTs: pts[i].ts, note };
}

let _cache: { data: any; ts: number } | null = null;
const TTL = 30 * 60 * 1000;

export async function GET() {
  if (_cache && Date.now() - _cache.ts < TTL) return NextResponse.json(_cache.data);
  const [ind, usa] = await Promise.all([fetchDaily('^NSEI'), fetchDaily('^GSPC')]);
  const data = {
    asOf: new Date().toISOString(),
    india: classify(ind),
    usa: classify(usa),
  };
  // Only cache when at least one market classified (don't cache a total failure)
  if (data.india.kind !== 'UNKNOWN' || data.usa.kind !== 'UNKNOWN') _cache = { data, ts: Date.now() };
  return NextResponse.json(data, { headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=1800' } });
}
