// zzz276 — Earnings search endpoint. Indexes the last ~120 business days of
// graded payloads (already cached in KV under `graded:v10:${date}`) and returns
// ranked matches for a user query. Powers the typeahead on /earnings-opportunities.
//
// Contract: GET /api/v1/earnings/search?q=asian&limit=25
// Returns  { q, count, results: [{ ticker, company, filing_date, tier, sector,
//            market_cap_cr, quarter, composite_score }] }
//
// Ranking:  tickerExact (100) + tickerStartsWith (70) + tickerContains (35)
//         + companyStartsWith (50) + companyContains (20)
//         + tier bonus (BB +10 / ST +5) + recency (log-decay by days)
//
// Dedup: keeps the latest filing per (ticker + quarter) — historical quarters
//        still surface so you can jump to old prints too.

import { NextRequest } from 'next/server';
import { kvGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_PREFIX = 'graded:v10:';
const LOOKBACK_BUSINESS_DAYS = 120;
const DEFAULT_LIMIT = 25;

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
const TIERS: Tier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
const TIER_BONUS: Record<Tier, number> = { BLOCKBUSTER: 10, STRONG: 5, MIXED: 0, AVOID: -5 };

type SearchResult = {
  ticker: string;
  company: string;
  filing_date: string;
  tier: Tier;
  sector?: string;
  market_cap_cr?: number | null;
  quarter?: string;
  composite_score?: number;
  _score: number;
};

function businessDaysBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; out.length < n && i < n * 2; i++) {
    const d = new Date(now.getTime() - i * 24 * 3600_000);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // NSE closed
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function scoreEntry(e: any, q: string, tier: Tier, daysBack: number): number {
  const t = String(e.ticker || '').toUpperCase();
  const c = String(e.company || '').toUpperCase();
  const Q = q.toUpperCase();
  let s = 0;
  if (t === Q) s += 100;
  else if (t.startsWith(Q)) s += 70;
  else if (t.includes(Q)) s += 35;
  if (c.startsWith(Q)) s += 50;
  else if (c.includes(Q)) s += 20;
  if (s === 0) return 0; // no match
  s += TIER_BONUS[tier];
  // Recency: linear decay over the lookback window, bounded [0, 25]
  const recency = Math.max(0, 25 - Math.floor((daysBack / LOOKBACK_BUSINESS_DAYS) * 25));
  s += recency;
  return s;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT)));

  if (q.length < 2) {
    return Response.json({ q, count: 0, results: [], _note: 'need at least 2 chars' });
  }

  const dates = businessDaysBack(LOOKBACK_BUSINESS_DAYS);
  // Dedup key: TICKER@QUARTER — keep the highest-scored (or latest) entry per key
  const bestByKey = new Map<string, SearchResult>();

  // Batch KV reads with a soft parallel cap (KV can rate-limit if we open 100+ sockets)
  const CONC = 8;
  for (let i = 0; i < dates.length; i += CONC) {
    const batch = dates.slice(i, i + CONC);
    await Promise.all(batch.map(async (d, batchIdx) => {
      const daysBack = i + batchIdx;
      const key = CACHE_PREFIX + d;
      let payload: any = null;
      try { payload = await kvGet(key); } catch { return; }
      if (!payload || !payload.by_tier) return;
      for (const tier of TIERS) {
        const arr = payload.by_tier[tier];
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (!e || !e.ticker) continue;
          const s = scoreEntry(e, q, tier, daysBack);
          if (s <= 0) continue;
          const ticker = String(e.ticker).toUpperCase();
          const quarter = e.quarter || '';
          const dedupKey = quarter ? `${ticker}@${quarter}` : ticker;
          const existing = bestByKey.get(dedupKey);
          if (!existing || s > existing._score) {
            bestByKey.set(dedupKey, {
              ticker,
              company: String(e.company || ticker),
              filing_date: String(e.filing_date || d),
              tier,
              sector: e.sector || undefined,
              market_cap_cr: typeof e.market_cap_cr === 'number' ? e.market_cap_cr : null,
              quarter: e.quarter || undefined,
              composite_score: typeof e.composite_score === 'number' ? e.composite_score : undefined,
              _score: s,
            });
          }
        }
      }
    }));
  }

  const results = Array.from(bestByKey.values())
    .sort((a, b) => b._score - a._score || b.filing_date.localeCompare(a.filing_date))
    .slice(0, limit)
    // Strip internal score field before returning
    .map(({ _score, ...rest }) => rest);

  return Response.json({ q, count: results.length, results });
}
