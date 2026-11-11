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
import { rankMatches, normalizeTicker } from '@/lib/earnings-search';
import { gradedIndex, clearGradedSessionMemo, istBusinessDaysBack, GRADED_LOOKBACK_BUSINESS_DAYS } from '@/lib/graded-session-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// zzz812 — THE INDEX READ A DEAD NAMESPACE. It was hard-coded to
// `graded:v10:<date>`, which nothing has written since the India engine moved
// on (now v23, see lib/graded-cache-key.ts). Every result graded after that
// bump — FCL's Q1 FY27 among them — was invisible to search. It now reads the
// CURRENT key per date and falls back through the legacy namespaces only when
// the current one is empty, exactly like the bench cron.
// zzz1262 — the index now comes from lib/graded-session-index (which reads gradedKeyCandidates(date) per session, current
// namespace first): compact rows per session kept in memory, a session that could not be read is never remembered as
// empty. The 15-minute copy in the store (`search:idx:v3`) is no longer written or read: one build that missed recent
// sessions used to be served to every search for 15 minutes.
const LOOKBACK_BUSINESS_DAYS = GRADED_LOOKBACK_BUSINESS_DAYS;
const DEFAULT_LIMIT = 25;

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
type IndexEntry = { t: string; c: string; fd: string; tier: Tier; sec: string | null; mc: number | null; q: string | null; cs: number | null; db: number; bse?: string | null };

async function getIndex(force: boolean): Promise<{ index: IndexEntry[]; cache: 'memo' | 'miss' | 'stale'; unread: number }> {
  if (force) clearGradedSessionMemo();
  const g = await gradedIndex();
  // one entry per normalised ticker + quarter (NSE:/.NS/-EQ forms of one symbol are the same company)
  const seen = new Set<string>();
  const index: IndexEntry[] = [];
  for (const e of g.index) {
    const t = normalizeTicker(e.t);
    const k = e.q ? `${t}@${e.q}` : t;
    if (seen.has(k)) continue;
    seen.add(k);
    index.push({ ...e, t });
  }
  return { index, cache: force ? 'stale' : g.cache === 'memo' ? 'memo' : 'miss', unread: g.unread.length };
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
  const { index, cache, unread } = await getIndex(force);
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
  const span = istBusinessDaysBack(LOOKBACK_BUSINESS_DAYS);
  const lookbackDays = Math.round((Date.parse(span[0]) - Date.parse(span[span.length - 1])) / 86_400_000) + 1;

  return Response.json({
    q, count: results.length, results,
    lookback_business_days: LOOKBACK_BUSINESS_DAYS, lookback_days: lookbackDays, oldest_indexed: oldest || null,
    _took_ms: Date.now() - t0, _cache: cache, _idx: index.length, unread_sessions: unread,
  });
}
