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
  ranked_all?: ScoredWarrantFiling[];   // PATCH 0411 — full ranked list (ignores passingOnly filter) for Top-N
  sources: { nse: string; bse: string };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    return await handleWarrantFeed(req);
  } catch (err) {
    // PATCH 0416 — Never return HTTP 500
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[warrant-feed] uncaught error', msg);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      count_total: 0, count_relevant: 0, count_passing: 0,
      filings: [], ranked_all: [],
      sources: { nse: 'NSE_BLOCKED', bse: 'BSE_BLOCKED' },
      error: `warrant-feed failed: ${msg.slice(0, 200)}`,
    });
  }
}

async function handleWarrantFeed(req: NextRequest) {
  // PATCH 0420 — Strict time budget to prevent Vercel 60s hard cap kills.
  // Hard cap is 60s; soft budget is 45s, bail out of expensive operations
  // (PDF extraction + per-filing async work) once exceeded and return what
  // we have. Better partial results with cache write than HTTP 500.
  const STARTED_AT = Date.now();
  const TIME_BUDGET_MS = 45_000;
  const overBudget = () => Date.now() - STARTED_AT > TIME_BUDGET_MS;

  // PATCH 0393 — max lookback bumped 30 → 60 days per user request
  // PATCH 0405 — bumped 60 → 90 days for full-quarter view
  // PATCH 0407 — bumped 90 → 180 days for historical validation
  const days = Math.min(180, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '14')));
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

  // PATCH 0408 — Long-window chunked fetch (same as live-feed). NSE
  // corp-announcements caps per-call rows; one 180-day request returns
  // only the most recent ~500 filings, silently dropping older ones.
  // Chunk into 30-day sub-windows + parallel fetch + merge.
  const today = new Date();
  const CHUNK_DAYS = 30;
  const subWindows: Array<{ fromIso: string; toIso: string }> = [];
  {
    let cur = new Date(today);
    let remaining = days;
    while (remaining > 0) {
      const chunkSize = Math.min(CHUNK_DAYS, remaining);
      const winTo = new Date(cur);
      const winFrom = new Date(cur);
      winFrom.setDate(winFrom.getDate() - chunkSize + 1);
      subWindows.push({
        fromIso: winFrom.toISOString().slice(0, 10),
        toIso: winTo.toISOString().slice(0, 10),
      });
      cur.setDate(cur.getDate() - chunkSize);
      remaining -= chunkSize;
    }
  }
  const bsePages = Math.min(12, Math.max(2, Math.ceil(days / 15)));
  // PATCH 0409 — serialize sub-window fetches (parallel triggered NSE 429)
  // PATCH 0413 — cache closed sub-windows for 6 months so we don't re-scrape
  const totalBudgetMs = 14000;
  const SUBWIN_CONCURRENCY = 2;
  const todayIsoForCache = new Date().toISOString().slice(0, 10);
  const SUBWIN_KEY = (fromIso: string, toIso: string) => `subwin-filings:v1:${fromIso}:${toIso}`;
  const ttlForSubwindow = (toIso: string) => toIso < todayIsoForCache ? 180 * 24 * 60 * 60 : 30 * 60;
  const fetchSubWindow = (fromIsoW: string, toIsoW: string) => {
    const nseCtrl = new AbortController();
    const bseCtrl = new AbortController();
    const tNse = setTimeout(() => nseCtrl.abort(), totalBudgetMs);
    const tBse = setTimeout(() => bseCtrl.abort(), totalBudgetMs);
    return Promise.all([
      fetchNSEAnnouncements({ signal: nseCtrl.signal, fromIso: fromIsoW, toIso: toIsoW }),
      fetchBSEAnnouncements({ signal: bseCtrl.signal, fromIso: fromIsoW, toIso: toIsoW, pages: bsePages }),
    ]).finally(() => { clearTimeout(tNse); clearTimeout(tBse); });
  };
  type SubWinCache = { fromIso: string; toIso: string; nse: any; bse: any };
  const subwinCacheHits: SubWinCache[] = [];
  const subwinMisses: typeof subWindows = [];
  if (isRedisAvailable() && !force) {
    const reads = await Promise.all(subWindows.map(w =>
      kvGet<SubWinCache>(SUBWIN_KEY(w.fromIso, w.toIso)).catch(() => null)
    ));
    for (let i = 0; i < subWindows.length; i++) {
      if (reads[i]) subwinCacheHits.push(reads[i]!);
      else subwinMisses.push(subWindows[i]);
    }
  } else {
    subwinMisses.push(...subWindows);
  }
  const allResults: Array<Awaited<ReturnType<typeof fetchSubWindow>>> = [];
  // PATCH 0416 — null-guard against malformed cache entries (same fix as live-feed)
  for (const hit of subwinCacheHits) {
    if (!hit || !hit.nse || !hit.bse || !Array.isArray(hit.nse.filings) || !Array.isArray(hit.bse.filings)) continue;
    allResults.push([hit.nse, hit.bse]);
  }
  for (let i = 0; i < subwinMisses.length; i += SUBWIN_CONCURRENCY) {
    // PATCH 0420 — stop fetching new sub-windows once over budget; use what we have
    if (overBudget()) break;
    const batch = subwinMisses.slice(i, i + SUBWIN_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(w => fetchSubWindow(w.fromIso, w.toIso)));
    if (isRedisAvailable()) {
      for (let j = 0; j < batch.length; j++) {
        const [nseR, bseR] = batchResults[j];
        const w = batch[j];
        const payload: SubWinCache = {
          fromIso: w.fromIso, toIso: w.toIso,
          nse: { filings: nseR.filings, source: nseR.source },
          bse: { filings: bseR.filings, source: bseR.source },
        };
        kvSet(SUBWIN_KEY(w.fromIso, w.toIso), payload, ttlForSubwindow(w.toIso)).catch(() => {});
      }
    }
    allResults.push(...batchResults);
    if (i + SUBWIN_CONCURRENCY < subwinMisses.length) {
      await new Promise(r => setTimeout(r, 600 + Math.random() * 200));
    }
  }

  const merged = new Map<string, FilingRecord>();
  let nseStatus: string = 'NSE_EMPTY';
  let bseStatus: string = 'BSE_EMPTY';
  for (const [nseR, bseR] of allResults) {
    if (nseR.source === 'NSE_OK') nseStatus = 'NSE_OK';
    if (bseR.source === 'BSE_OK') bseStatus = 'BSE_OK';
    for (const f of nseR.filings) merged.set(f.content_hash, f);
    for (const f of bseR.filings) {
      if (!merged.has(f.content_hash)) merged.set(f.content_hash, f);
    }
  }
  const nseResult = { filings: [] as FilingRecord[], source: nseStatus as any };
  const bseResult = { filings: [] as FilingRecord[], source: bseStatus as any };

  // Phase 1: filter to warrant-relevant filings
  const candidates: Array<{ filing: FilingRecord; warrant_type: WarrantFilingType }> = [];
  for (const f of merged.values()) {
    const wt = classifyWarrantFiling(f.subject);
    if (!wt) continue;
    candidates.push({ filing: f, warrant_type: wt });
  }
  candidates.sort((a, b) => new Date(b.filing.filing_datetime).getTime() - new Date(a.filing.filing_datetime).getTime());

  // Phase 2: extract PDFs for top candidates (warrant details + concall context)
  // PATCH 0420 — bail PDF extraction entirely if already over budget
  const extracts = new Map<string, string>();
  if (!overBudget()) {
    const dynamicPdfCap = overBudget() ? 0 : MAX_PDF_EXTRACTS;
    const toExtract = candidates.slice(0, dynamicPdfCap).filter(c => c.filing.attachment_urls.length > 0);
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
  }

  // Phase 3: score each
  // PATCH 0420 — bail per-filing loop early if approaching Vercel hard cap
  const all: ScoredWarrantFiling[] = [];
  for (const { filing: f, warrant_type } of candidates) {
    if (overBudget()) break;
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
  // PATCH 0411 — Always preserve the FULL ranked list separately so the
  // Top-N panel can render even when passingOnly empties the main filings
  // array. Previously the page showed "No warrant filings" because the
  // panel only looked at `filings` which was filtered to passing-gate ≥8.
  const ranked_all = payload.filings.slice(0, Math.max(10, opts.topN || 10));
  if (opts.passingOnly) filings = filings.filter(f => f.conviction.passes_gate);
  if (opts.threshold > 0) filings = filings.filter(f => f.conviction.conviction >= opts.threshold);
  // PATCH 0392 — top-N ranking. When topN > 0, return the best N regardless
  // of absolute threshold. Lets the UI show 'top 10 warrant setups this
  // month' even when no filing crosses the strict gate.
  if (opts.topN > 0) filings = filings.slice(0, opts.topN);
  return { ...payload, filings, ranked_all };
}
