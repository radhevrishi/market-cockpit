// zzz282 — Earnings search endpoint. Uses a pre-built flat index cached in KV
// so hot queries return in <20ms instead of scanning 120 KV keys per request.
// Index is refreshed on-demand when older than INDEX_TTL_SECONDS.
//
// Contract: GET /api/v1/earnings/search?q=asian&limit=25
// Returns  { q, count, results: [{ ticker, company, filing_date, tier, sector,
//            market_cap_cr, quarter, composite_score }] }
//
// Ranking:  tickerExact (100) + tickerStartsWith (70) + tickerContains (35)
//         + companyStartsWith (50) + companyContains (20)
//         + tier bonus (BB +10 / ST +5) + recency (linear decay by days)

import { NextRequest } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_PREFIX = 'graded:v10:';
const INDEX_KEY = 'search:idx:v2';
const INDEX_TTL_SECONDS = 15 * 60; // 15 minutes — daily grading is once/day, so 15min is plenty
const LOOKBACK_BUSINESS_DAYS = 120;
const DEFAULT_LIMIT = 25;

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
const TIERS: Tier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
const TIER_BONUS: Record<Tier, number> = { BLOCKBUSTER: 10, STRONG: 5, MIXED: 0, AVOID: -5 };

type IndexEntry = {
  t: string;    // ticker (uppercase)
  c: string;    // company
  fd: string;   // filing_date
  tier: Tier;
  sec: string | null;
  mc: number | null;
  q: string | null;
  cs: number | null;
  db: number;   // days-back at index time (for recency scoring)
};

function businessDaysBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; out.length < n && i < n * 2; i++) {
    const d = new Date(now.getTime() - i * 24 * 3600_000);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function buildIndex(): Promise<IndexEntry[]> {
  const dates = businessDaysBack(LOOKBACK_BUSINESS_DAYS);
  const flat: IndexEntry[] = [];
  const seen = new Set<string>();
  const CONC = 16;
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
          const ticker = String(e.ticker).toUpperCase();
          const quarter = e.quarter || '';
          const dedupKey = quarter ? `${ticker}@${quarter}` : ticker;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          flat.push({
            t: ticker,
            c: String(e.company || ticker),
            fd: String(e.filing_date || d),
            tier,
            sec: e.sector || null,
            mc: typeof e.market_cap_cr === 'number' ? e.market_cap_cr : null,
            q: e.quarter || null,
            cs: typeof e.composite_score === 'number' ? e.composite_score : null,
            db: daysBack,
          });
        }
      }
    }));
  }
  return flat;
}

async function getIndex(force: boolean): Promise<{ index: IndexEntry[]; cache: 'hit' | 'miss' | 'stale' }> {
  if (!force) {
    try {
      const cached = await kvGet(INDEX_KEY);
      if (Array.isArray(cached) && cached.length > 0) return { index: cached as IndexEntry[], cache: 'hit' };
    } catch {}
  }
  const idx = await buildIndex();
  try { await kvSet(INDEX_KEY, idx, INDEX_TTL_SECONDS); } catch {}
  return { index: idx, cache: force ? 'stale' : 'miss' };
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT)));
  const force = req.nextUrl.searchParams.get('refresh') === '1';

  if (q.length < 2) {
    return Response.json({ q, count: 0, results: [], _note: 'need at least 2 chars' });
  }

  const t0 = Date.now();
  const { index, cache } = await getIndex(force);
  const Q = q.toUpperCase();
  const scored: { e: IndexEntry; s: number }[] = [];
  for (const e of index) {
    const t = e.t;
    const c = (e.c || '').toUpperCase();
    let s = 0;
    if (t === Q) s += 100;
    else if (t.startsWith(Q)) s += 70;
    else if (t.includes(Q)) s += 35;
    if (c.startsWith(Q)) s += 50;
    else if (c.includes(Q)) s += 20;
    if (s === 0) continue;
    s += TIER_BONUS[e.tier] || 0;
    const recency = Math.max(0, 25 - Math.floor((e.db / LOOKBACK_BUSINESS_DAYS) * 25));
    s += recency;
    scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s || b.e.fd.localeCompare(a.e.fd));
  const results = scored.slice(0, limit).map(({ e }) => ({
    ticker: e.t,
    company: e.c,
    filing_date: e.fd,
    tier: e.tier,
    sector: e.sec || undefined,
    market_cap_cr: e.mc,
    quarter: e.q || undefined,
    composite_score: e.cs != null ? e.cs : undefined,
  }));

  return Response.json({ q, count: results.length, results, _took_ms: Date.now() - t0, _cache: cache, _idx: index.length });
}
