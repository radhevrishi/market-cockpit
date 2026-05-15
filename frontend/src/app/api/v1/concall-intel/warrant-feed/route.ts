// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0390 — Warrant Momentum Intelligence feed
//
// Endpoint: GET /api/v1/concall-intel/warrant-feed
//   ?days=7           lookback (default 7 — warrants are slower-moving)
//   ?threshold=8      conviction floor (default 8/10 per user spec)
//   ?passingOnly=1    only return filings that pass the strict gate
//   ?force=1          cache bust
//
// Separate intelligence lane from the concall feed because warrants are
// structural slow-moving signals vs concall's short-term narrative.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { fetchNSEAnnouncements, fetchBSEAnnouncements, type FilingRecord } from '@/lib/nse-bse-feed';
import { extractFirstPdf } from '@/lib/pdf-text-extractor';
import { extractSections } from '@/lib/concall-sections';
import { scoreBullish } from '@/lib/concall-bullish';
import {
  classifyWarrantFiling, extractWarrantDetails, scoreWarrantConviction,
  type WarrantFilingType, type WarrantDetails, type WarrantConvictionScore,
} from '@/lib/warrant-momentum';

const CACHE_KEY = (days: number) => `warrant-feed:v3:days:${days}`;  // v3: 60d + ranking
const CACHE_TTL_SHORT = 5 * 60;
const CACHE_TTL_LONG = 30 * 60;
const MAX_PDF_EXTRACTS = 15;

// ─── KV-stored historical warrant memory ─────────────────────────────────
interface PriorWarrant {
  date: string;            // ISO
  price_at_filing: number | null;
  current_perf_pct: number | null;
}

const HISTORY_KEY = (symbol: string) => `warrant-history:v1:${symbol.toUpperCase()}`;
const HISTORY_TTL = 365 * 24 * 60 * 60;  // 365 days

async function getWarrantHistory(symbol: string): Promise<PriorWarrant[]> {
  if (!isRedisAvailable()) return [];
  const v = await kvGet<PriorWarrant[]>(HISTORY_KEY(symbol));
  return Array.isArray(v) ? v : [];
}

async function appendWarrantHistory(symbol: string, entry: PriorWarrant): Promise<void> {
  if (!isRedisAvailable()) return;
  const existing = await getWarrantHistory(symbol);
  // De-dupe by date — don't re-store same filing
  if (existing.some(e => e.date.slice(0, 10) === entry.date.slice(0, 10))) return;
  existing.push(entry);
  existing.sort((a, b) => a.date.localeCompare(b.date));
  await kvSet(HISTORY_KEY(symbol), existing.slice(-20), HISTORY_TTL);  // cap at 20
}

// ─── Price lookup via Yahoo Finance ─────────────────────────────────────
// We compute current price + 90d perf + 52w-high distance to inform the
// breakout/RS component. KV cached 30 min.

interface PriceContext {
  cmp: number | null;
  perf_90d_pct: number | null;
  perf_52w_high_pct: number | null;
}

async function fetchPriceContext(symbol: string, signal?: AbortSignal): Promise<PriceContext> {
  if (!symbol) return { cmp: null, perf_90d_pct: null, perf_52w_high_pct: null };
  const cacheKey = `price-context:v1:${symbol.toUpperCase()}`;
  if (isRedisAvailable()) {
    const cached = await kvGet<PriceContext>(cacheKey);
    if (cached) return cached;
  }
  try {
    // Yahoo Finance v8 chart endpoint — 1y history
    const yahooSymbol = `${symbol}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1y`;
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return { cmp: null, perf_90d_pct: null, perf_52w_high_pct: null };
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    const closes: number[] = result?.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter((c: number) => c != null && c > 0);
    if (validCloses.length < 30) return { cmp: null, perf_90d_pct: null, perf_52w_high_pct: null };
    const cmp = validCloses[validCloses.length - 1];
    const c90 = validCloses[validCloses.length - 90] || validCloses[0];
    const perf90 = c90 > 0 ? ((cmp / c90) - 1) * 100 : null;
    const peak52 = Math.max(...validCloses);
    const dist52 = peak52 > 0 ? ((cmp / peak52) - 1) * 100 : null;
    const out: PriceContext = {
      cmp,
      perf_90d_pct: perf90 != null ? Math.round(perf90 * 10) / 10 : null,
      perf_52w_high_pct: dist52 != null ? Math.round(dist52 * 10) / 10 : null,
    };
    if (isRedisAvailable()) await kvSet(cacheKey, out, 30 * 60);
    return out;
  } catch {
    return { cmp: null, perf_90d_pct: null, perf_52w_high_pct: null };
  }
}

// ─── Feed payload ────────────────────────────────────────────────────────

interface ScoredWarrantFiling extends FilingRecord {
  warrant_type: WarrantFilingType;
  details: WarrantDetails;
  price: PriceContext;
  conviction: WarrantConvictionScore;
  business_momentum_score: number | null;
  prior_warrants: PriorWarrant[];
}

interface WarrantFeedPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_passing: number;
  filings: ScoredWarrantFiling[];
  sources: { nse: string; bse: string };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // PATCH 0393 — max lookback bumped 30 → 60 days per user request
  // PATCH 0405 — bumped 60 → 90 days for full-quarter view
  const days = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '14')));
  // PATCH 0392 — threshold default dropped 8 → 5 (ranking, not hard gate)
  const threshold = parseFloat(req.nextUrl.searchParams.get('threshold') || '5');
  const passingOnly = req.nextUrl.searchParams.get('passingOnly') === '1';
  // PATCH 0392 — top-N ranking mode (returns best N regardless of threshold)
  const topN = parseInt(req.nextUrl.searchParams.get('topN') || '0');
  const force = req.nextUrl.searchParams.get('force') === '1';

  const cacheKey = CACHE_KEY(days);
  if (!force && isRedisAvailable()) {
    const cached = await kvGet<WarrantFeedPayload>(cacheKey);
    if (cached) return NextResponse.json(applyWarrantFilters(cached, { passingOnly, threshold, topN }));
  }

  // Fetch NSE + BSE filings
  const today = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const fromIso = fromDate.toISOString().slice(0, 10);
  const toIso = today.toISOString().slice(0, 10);

  const nseCtrl = new AbortController();
  const bseCtrl = new AbortController();
  const nseTimer = setTimeout(() => nseCtrl.abort(), 12000);
  const bseTimer = setTimeout(() => bseCtrl.abort(), 12000);
  const [nseResult, bseResult] = await Promise.all([
    fetchNSEAnnouncements({ signal: nseCtrl.signal, fromIso, toIso }),
    fetchBSEAnnouncements({ signal: bseCtrl.signal, fromIso, toIso, pages: 2 }),
  ]);
  clearTimeout(nseTimer);
  clearTimeout(bseTimer);

  const merged = new Map<string, FilingRecord>();
  for (const f of nseResult.filings) merged.set(f.content_hash, f);
  for (const f of bseResult.filings) {
    if (!merged.has(f.content_hash)) merged.set(f.content_hash, f);
  }

  // Phase 1: filter to warrant-relevant filings
  const candidates: Array<{ filing: FilingRecord; warrant_type: WarrantFilingType }> = [];
  for (const f of merged.values()) {
    const wt = classifyWarrantFiling(f.subject);
    if (!wt) continue;
    candidates.push({ filing: f, warrant_type: wt });
  }
  candidates.sort((a, b) => new Date(b.filing.filing_datetime).getTime() - new Date(a.filing.filing_datetime).getTime());

  // Phase 2: extract PDFs for top candidates (warrant details + concall context)
  const extracts = new Map<string, string>();
  const toExtract = candidates.slice(0, MAX_PDF_EXTRACTS).filter(c => c.filing.attachment_urls.length > 0);
  if (toExtract.length > 0) {
    const results = await Promise.allSettled(
      toExtract.map(async c => {
        const ext = await extractFirstPdf(c.filing.attachment_urls);
        return { hash: c.filing.content_hash, text: ext?.text || '' };
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.text) extracts.set(r.value.hash, r.value.text);
    }
  }

  // Phase 3: score each
  const all: ScoredWarrantFiling[] = [];
  for (const { filing: f, warrant_type } of candidates) {
    const pdfText = extracts.get(f.content_hash) || '';
    const combinedText = `${f.subject}\n\n${pdfText}`;

    // Extract warrant-specific details from full text
    const details = extractWarrantDetails(combinedText);

    // Business momentum from concall scoring on forward-looking sections
    let momentum: number | null = null;
    if (pdfText.length > 300) {
      const sections = extractSections(pdfText);
      const bullish = scoreBullish(`${f.subject}\n${sections.forward_text}`);
      momentum = bullish.score;
    }

    // Historical warrant memory + price context (parallel)
    const [history, price] = await Promise.all([
      getWarrantHistory(f.symbol),
      fetchPriceContext(f.symbol),
    ]);

    // Compute prior_warrant_perf using stored prices + current price
    const prior_warrant_perf = history.map(h => ({
      date: h.date,
      perf_pct: (h.price_at_filing != null && price.cmp != null)
        ? ((price.cmp / h.price_at_filing) - 1) * 100
        : 0,
    })).filter(p => p.perf_pct !== 0);

    const conviction = scoreWarrantConviction({
      details,
      cmp: price.cmp,
      perf_90d_pct: price.perf_90d_pct,
      perf_52w_high_pct: price.perf_52w_high_pct,
      market_cap_cr: null,        // we don't have mcap from filings; would need a second lookup
      promoter_holding_pct: null,
      pledge_pct: null,
      business_momentum_score: momentum,
      prior_warrant_perf,
    });

    all.push({
      ...f,
      warrant_type,
      details,
      price,
      conviction,
      business_momentum_score: momentum,
      prior_warrants: history,
    });

    // Append to history (for future runs to compare against)
    if (price.cmp != null) {
      await appendWarrantHistory(f.symbol, {
        date: f.filing_datetime,
        price_at_filing: price.cmp,
        current_perf_pct: null,
      });
    }
  }

  // Sort: passing gate first, then conviction desc
  all.sort((a, b) => {
    if (a.conviction.passes_gate !== b.conviction.passes_gate) return a.conviction.passes_gate ? -1 : 1;
    return b.conviction.conviction - a.conviction.conviction;
  });

  const payload: WarrantFeedPayload = {
    generated_at: new Date().toISOString(),
    count_total: merged.size,
    count_relevant: all.length,
    count_passing: all.filter(x => x.conviction.passes_gate).length,
    filings: all,
    sources: { nse: nseResult.source, bse: bseResult.source },
  };

  if (isRedisAvailable()) {
    const ttl = days <= 3 ? CACHE_TTL_SHORT : CACHE_TTL_LONG;
    await kvSet(cacheKey, payload, ttl);
  }

  return NextResponse.json(applyWarrantFilters(payload, { passingOnly, threshold, topN }));
}

function applyWarrantFilters(payload: WarrantFeedPayload, opts: { passingOnly: boolean; threshold: number; topN: number }): WarrantFeedPayload {
  let filings = payload.filings;
  if (opts.passingOnly) filings = filings.filter(f => f.conviction.passes_gate);
  if (opts.threshold > 0) filings = filings.filter(f => f.conviction.conviction >= opts.threshold);
  // PATCH 0392 — top-N ranking. When topN > 0, return the best N regardless
  // of absolute threshold. Lets the UI show 'top 10 warrant setups this
  // month' even when no filing crosses the strict gate.
  if (opts.topN > 0) filings = filings.slice(0, opts.topN);
  return { ...payload, filings };
}
