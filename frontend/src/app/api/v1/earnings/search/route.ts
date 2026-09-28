// zzz282 — Earnings search endpoint. Uses a pre-built flat index cached in KV
// so hot queries return in <20ms instead of scanning 120 KV keys per request.
// Index is refreshed on-demand when older than INDEX_TTL_SECONDS.
//
// Contract: GET /api/v1/earnings/search?q=asian&limit=25
// Returns  { q, count, results: [{ ticker, company, filing_date, tier, sector,
//            market_cap_cr, quarter, composite_score }] }
//
// Ranking (zzz812): lib/earnings-search.ts rankMatches — exact ticker, then
// ticker prefix, then company-name words; newest filing breaks ties. Also
// returns lookback_business_days / oldest_indexed so the page can say how far
// back "not found" looked.

import { NextRequest } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { gradedKeyCandidates } from '@/lib/graded-cache-key';
import { rankMatches, normalizeTicker } from '@/lib/earnings-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// zzz812 — THE INDEX READ A DEAD NAMESPACE. It was hard-coded to
// `graded:v10:<date>`, which nothing has written since the India engine moved
// on (now v23, see lib/graded-cache-key.ts). Every result graded after that
// bump — FCL's Q1 FY27 among them — was invisible to search. It now reads the
// CURRENT key per date and falls back through the legacy namespaces only when
// the current one is empty, exactly like the bench cron.
const INDEX_KEY = 'search:idx:v3';
const INDEX_TTL_SECONDS = 15 * 60; // 15 minutes — daily grading is once/day, so 15min is plenty
const LOOKBACK_BUSINESS_DAYS = 120;
const DEFAULT_LIMIT = 25;

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
const TIERS: Tier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

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
  bse?: string | null;
};

function businessDaysBack(n: number): string[] {
  const out: string[] = [];
  // IST calendar dates — India files on IST days; a UTC date lags by 5h30.
  const now = new Date(Date.now() + 330 * 60_000);
  for (let i = 0; out.length < n && i < n * 2; i++) {
    const d = new Date(now.getTime() - i * 24 * 3600_000);
    const dow = d.getUTCDay();
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
      // Current namespace first; a legacy one only if the current is empty.
      let payload: any = null;
      for (const key of gradedKeyCandidates(d)) {
        try { payload = await kvGet(key); } catch { payload = null; }
        if (payload && payload.by_tier) break;
        payload = null;
      }
      if (!payload || !payload.by_tier) return;
      for (const tier of TIERS) {
        const arr = payload.by_tier[tier];
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (!e || !e.ticker) continue;
          const ticker = normalizeTicker(String(e.ticker));
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
            bse: e.bse_code != null ? String(e.bse_code) : (e.scrip_code != null ? String(e.scrip_code) : null),
          });
        }
      }
    }));
  }
  return flat;
}

// Warm-instance memo in front of KV: a typeahead fires many queries a minute
// and each KV read of the index is ~1 MB.
let _memo: { at: number; index: IndexEntry[] } | null = null;
let _building: Promise<IndexEntry[]> | null = null;

async function getIndex(force: boolean): Promise<{ index: IndexEntry[]; cache: 'hit' | 'miss' | 'stale' | 'memo' }> {
  if (!force && _memo && Date.now() - _memo.at < INDEX_TTL_SECONDS * 1000) return { index: _memo.index, cache: 'memo' };
  if (!force) {
    try {
      const cached = await kvGet(INDEX_KEY);
      if (Array.isArray(cached) && cached.length > 0) {
        _memo = { at: Date.now(), index: cached as IndexEntry[] };
        return { index: cached as IndexEntry[], cache: 'hit' };
      }
    } catch {}
  }
  // One build at a time per instance — concurrent keystrokes share it.
  if (!_building) _building = buildIndex().finally(() => { _building = null; });
  const idx = await _building;
  // An empty index usually means KV was unreachable, not that nothing was
  // ever graded — hold it for 30 s only, and never write it to KV.
  _memo = { at: idx.length ? Date.now() : Date.now() - (INDEX_TTL_SECONDS - 30) * 1000, index: idx };
  if (idx.length) { try { await kvSet(INDEX_KEY, idx, INDEX_TTL_SECONDS); } catch {} }
  return { index: idx, cache: force ? 'stale' : 'miss' };
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT)));
  const force = req.nextUrl.searchParams.get('refresh') === '1';

  // zzz812 — one character is enough for an exact ticker ("L", "M").
  if (q.length < 1) {
    return Response.json({ q, count: 0, results: [], _note: 'empty query' });
  }

  const t0 = Date.now();
  const { index, cache } = await getIndex(force);
  // zzz812 — one matcher for both pages (lib/earnings-search.ts): exact ticker
  // (after stripping NSE:/.NS/-EQ) first, then ticker prefix, then company
  // words. No mid-ticker substring matches, so "FCL" is not buried under
  // unrelated tickers. Ties go to the NEWEST filing.
  const rows = index.map((e) => ({
    ticker: e.t, company: e.c, filing_date: e.fd, tier: e.tier, bse_code: e.bse || null, _e: e,
  }));
  const ranked = rankMatches(rows, q, limit);
  const results = ranked.map(({ row }) => {
    const e = row._e as IndexEntry;
    return {
      ticker: e.t,
      company: e.c,
      filing_date: e.fd,
      tier: e.tier,
      sector: e.sec || undefined,
      market_cap_cr: e.mc,
      quarter: e.q || undefined,
      composite_score: e.cs != null ? e.cs : undefined,
    };
  });
  let oldest = '';
  for (const e of index) if (e.fd && (!oldest || e.fd < oldest)) oldest = e.fd;
  const span = businessDaysBack(LOOKBACK_BUSINESS_DAYS);
  const lookbackDays = Math.round((Date.parse(span[0]) - Date.parse(span[span.length - 1])) / 86_400_000) + 1;

  return Response.json({
    q, count: results.length, results,
    lookback_business_days: LOOKBACK_BUSINESS_DAYS, lookback_days: lookbackDays, oldest_indexed: oldest || null,
    _took_ms: Date.now() - t0, _cache: cache, _idx: index.length,
  });
}
