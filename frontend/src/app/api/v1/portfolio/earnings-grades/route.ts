// zzz283 — Portfolio earnings grades endpoint. Given a comma-separated list of
// tickers, returns the latest graded earnings entry per ticker (or null if none
// found in the search index's 120-day window). Backed by the same
// `search:idx:v2` KV index that powers /api/v1/earnings/search — so this is
// essentially free once the index is warm.
//
// Contract: GET /api/v1/portfolio/earnings-grades?tickers=MTAR,ASIANPAINT,SYRMA
// Returns  { count, graded, results: { MTAR: {ticker,company,filing_date,tier,...} | null, ... } }

import { NextRequest } from 'next/server';
import { kvGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INDEX_KEY = 'search:idx:v2';

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

type IndexEntry = {
  t: string; c: string; fd: string; tier: Tier;
  sec: string | null; mc: number | null; q: string | null; cs: number | null; db: number;
};

export async function GET(req: NextRequest) {
  const tickersParam = (req.nextUrl.searchParams.get('tickers') || '').trim();
  if (!tickersParam) {
    return Response.json({ count: 0, graded: 0, results: {} });
  }
  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const tickerSet = new Set(tickers);

  let index: IndexEntry[] = [];
  try {
    const cached = await kvGet(INDEX_KEY);
    if (Array.isArray(cached)) index = cached as IndexEntry[];
  } catch {}

  // For each ticker, keep the LATEST entry by filing_date.
  const byTicker = new Map<string, IndexEntry>();
  for (const e of index) {
    if (!e || !e.t) continue;
    if (!tickerSet.has(e.t)) continue;
    const existing = byTicker.get(e.t);
    if (!existing || (e.fd || '') > (existing.fd || '')) {
      byTicker.set(e.t, e);
    }
  }

  const results: Record<string, any> = {};
  for (const t of tickers) {
    const e = byTicker.get(t);
    results[t] = e ? {
      ticker: e.t,
      company: e.c,
      filing_date: e.fd,
      tier: e.tier,
      sector: e.sec,
      market_cap_cr: e.mc,
      quarter: e.q,
      composite_score: e.cs,
    } : null;
  }

  const graded = Object.values(results).filter(Boolean).length;
  return Response.json({ count: tickers.length, graded, results, _idx: index.length });
}
