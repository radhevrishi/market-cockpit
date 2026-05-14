// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0387 — Concall Intelligence: LIVE BULLISH FEED
//
// Endpoint: GET /api/v1/concall-intel/live-feed
//   ?days=2           lookback window (default 2)
//   ?exchange=NSE|BSE filter by exchange
//   ?threshold=4      raw_score floor for bullish (default 4)
//   ?bullishOnly=1    return only sentiment=BULLISH + passes high-bullish gate
//   ?force=1          bypass cache
//
// Flow:
//   1. Pull NSE general announcements (primary) + BSE (best-effort)
//   2. Dedup by content_hash
//   3. Classify filing type (transcript / con-call / investor pres / etc.)
//      — drop filings that aren't relevant
//   4. Score each filing's subject text with bullish keyword combinations +
//      negative blockers
//   5. Apply high-bullish gate (mgmt confidence + business evidence + no
//      critical blocker + raw score ≥ threshold)
//   6. KV cache 5min (today) / 30min (older) to avoid hammering exchanges
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { fetchNSEAnnouncements, fetchBSEAnnouncements, type FilingRecord } from '@/lib/nse-bse-feed';
import { classifyFiling, scoreBullish, isHighBullishRaw, type BullishScore, type ConcallFilingType } from '@/lib/concall-bullish';

const CACHE_KEY = (days: number) => `concall-feed:v1:days:${days}`;
const CACHE_TTL_SHORT = 5 * 60;        // 5 min for fresh data
const CACHE_TTL_LONG = 30 * 60;        // 30 min for older lookback

interface ScoredFiling extends FilingRecord {
  filing_type: ConcallFilingType;
  bullish: BullishScore;
  is_high_bullish: boolean;
}

interface FeedPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_high_bullish: number;
  filings: ScoredFiling[];
  sources: {
    nse: 'NSE_OK' | 'NSE_BLOCKED' | 'NSE_EMPTY';
    bse: 'BSE_OK' | 'BSE_BLOCKED' | 'BSE_EMPTY';
  };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const days = Math.min(7, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '2')));
  const exchangeFilter = (req.nextUrl.searchParams.get('exchange') || '').toUpperCase();
  const rawThreshold = parseFloat(req.nextUrl.searchParams.get('threshold') || '4');
  const bullishOnly = req.nextUrl.searchParams.get('bullishOnly') === '1';
  const force = req.nextUrl.searchParams.get('force') === '1';

  // KV cache check
  const cacheKey = CACHE_KEY(days);
  if (!force && isRedisAvailable()) {
    const cached = await kvGet<FeedPayload>(cacheKey);
    if (cached) {
      return NextResponse.json(applyFilters(cached, { exchangeFilter, bullishOnly }));
    }
  }

  // Compute date range
  const today = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const fromIso = fromDate.toISOString().slice(0, 10);
  const toIso = today.toISOString().slice(0, 10);

  // Parallel fetch with timeout budget
  const nseController = new AbortController();
  const bseController = new AbortController();
  const nseTimeout = setTimeout(() => nseController.abort(), 12000);
  const bseTimeout = setTimeout(() => bseController.abort(), 12000);

  const [nseResult, bseResult] = await Promise.all([
    fetchNSEAnnouncements({ signal: nseController.signal, fromIso, toIso }),
    fetchBSEAnnouncements({ signal: bseController.signal, fromIso, toIso, pages: 2 }),
  ]);
  clearTimeout(nseTimeout);
  clearTimeout(bseTimeout);

  // Merge + dedup by content_hash
  const merged = new Map<string, FilingRecord>();
  for (const f of nseResult.filings) merged.set(f.content_hash, f);
  for (const f of bseResult.filings) {
    if (!merged.has(f.content_hash)) merged.set(f.content_hash, f);
  }

  // Classify + score every filing
  const all: ScoredFiling[] = [];
  for (const f of merged.values()) {
    const filing_type = classifyFiling(f.subject);
    if (!filing_type) continue;  // not concall-relevant
    const bullish = scoreBullish(f.subject);
    const is_high_bullish = isHighBullishRaw(bullish, rawThreshold);
    all.push({ ...f, filing_type, bullish, is_high_bullish });
  }

  // Sort: high bullish first, then by score desc, then by date desc
  all.sort((a, b) => {
    if (a.is_high_bullish !== b.is_high_bullish) return a.is_high_bullish ? -1 : 1;
    if (b.bullish.raw_score !== a.bullish.raw_score) return b.bullish.raw_score - a.bullish.raw_score;
    return new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime();
  });

  const payload: FeedPayload = {
    generated_at: new Date().toISOString(),
    count_total: merged.size,
    count_relevant: all.length,
    count_high_bullish: all.filter(x => x.is_high_bullish).length,
    filings: all,
    sources: { nse: nseResult.source, bse: bseResult.source },
  };

  // Cache the full payload; filters applied at response time
  if (isRedisAvailable()) {
    const ttl = days <= 2 ? CACHE_TTL_SHORT : CACHE_TTL_LONG;
    await kvSet(cacheKey, payload, ttl);
  }

  return NextResponse.json(applyFilters(payload, { exchangeFilter, bullishOnly }));
}

function applyFilters(payload: FeedPayload, opts: { exchangeFilter: string; bullishOnly: boolean }): FeedPayload {
  let filings = payload.filings;
  if (opts.exchangeFilter === 'NSE' || opts.exchangeFilter === 'BSE') {
    filings = filings.filter(f => f.exchange === opts.exchangeFilter);
  }
  if (opts.bullishOnly) {
    filings = filings.filter(f => f.is_high_bullish);
  }
  return {
    ...payload,
    filings,
    count_relevant: payload.count_relevant,
    count_high_bullish: payload.count_high_bullish,
  };
}
