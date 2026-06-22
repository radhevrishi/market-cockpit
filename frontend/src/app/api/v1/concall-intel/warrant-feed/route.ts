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

// PATCH 0430 — bumped v8 → v9 to flush the corrupt v8 payload that had
// count_relevant=0 due to over-budget early-break bug.
// PATCH 0536 — v9 → v10 to flush the strict-gate cache (count_passing=0)
// after gate-D promoter-premium-proxy was added and the floor dropped to 5.5.
const CACHE_KEY = (days: number) => `warrant-feed:v10:days:${days}`;
const CACHE_TTL_SHORT = 5 * 60;
const CACHE_TTL_LONG = 30 * 60;
// PATCH 0422 — bumped 15 → 40 so more warrant candidates get full PDF
// body scoring. With only 15, most warrants fell back to subject-only
// (score 2.5 OTHER_WARRANT) and none could cross the strict ≥8/10 gate
// because issue price / promoter participation / conversion period are
// only in the PDF body. Time-budget guard (Patch 0420) still bails early
// if Vercel 45s soft cap is hit.
const MAX_PDF_EXTRACTS = 40;

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
    // PATCH 1101zzz46 — Yahoo returns 429 (Too Many Requests) when there's
    // no User-Agent header. That's why CMP coverage on the warrant feed
    // recently dropped to 0%. v8 chart API works fine with a UA — same
    // header lib/yahoo.ts already uses.
    const res = await fetch(url, {
      signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/1.0)' },
    });
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
  // PATCH 0536 — keep ranking floor at 5 but the hard passing gate in
  // warrant-momentum.ts is now 5.5 (was 6.5); callers passing threshold=6.5
  // get the old behaviour but the default surface is more permissive.
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
  // PATCH 0425 — Extraction priority. User reported STLTECH/Sterlite
  // (4.5Cr promoter warrants @ ₹24, ₹108 Cr to Twin Star Overseas) was
  // missing from Top 10 because its PDF never got extracted. Only 40 of
  // 129 candidates get full PDF body scoring; before this patch, the
  // queue was sorted purely by recency, so a generic 'Outcome of Board
  // Meeting' filing could push a specific 'Preferential Allotment of
  // Warrants to Promoter Group' filing out of the extraction window.
  // Now: higher-specificity classifications get PDF-extracted first,
  // then within each tier by recency.
  const TYPE_PRIORITY: Record<WarrantFilingType, number> = {
    PROMOTER_WARRANT:        0,   // strongest signal — extract first
    CONVERTIBLE_WARRANT:     1,
    PREFERENTIAL_ALLOTMENT:  2,
    WARRANT_CONVERSION:      3,
    QIP_WARRANT:             4,
    OTHER_WARRANT:           5,   // generic fallback — extract last
  };
  candidates.sort((a, b) => {
    const pa = TYPE_PRIORITY[a.warrant_type];
    const pb = TYPE_PRIORITY[b.warrant_type];
    if (pa !== pb) return pa - pb;
    return new Date(b.filing.filing_datetime).getTime() - new Date(a.filing.filing_datetime).getTime();
  });

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
  // PATCH 0430 — CRITICAL fix for 0-relevant regression. Previously, if
  // overBudget() fired BEFORE entering the loop, `all` stayed empty and the
  // UI showed '76464 filings · 0 warrant-related'. With Patches 0427/0428
  // adding entity-dedup + weighted scoring, the 45s soft budget was getting
  // hit before Phase 3 even began on cold 180d cache.
  //
  // Fix: ALWAYS process every candidate. When over budget, fall back to a
  // 'minimum-viable' score that uses subject + warrant_type only — no PDF
  // text, no Yahoo price fetch, no history. Result: user sees the universe
  // of warrants in the window even when fundamentals can't be fully scored.
  const all: ScoredWarrantFiling[] = [];
  for (const { filing: f, warrant_type } of candidates) {
    const isOverBudget = overBudget();
    const pdfText = isOverBudget ? '' : (extracts.get(f.content_hash) || '');
    const combinedText = `${f.subject}\n\n${pdfText}`;

    // Extract warrant-specific details from full text
    const details = extractWarrantDetails(combinedText);

    // Business momentum from concall scoring on forward-looking sections
    let momentum: number | null = null;
    if (!isOverBudget && pdfText.length > 300) {
      const sections = extractSections(pdfText);
      const bullish = scoreBullish(`${f.subject}\n${sections.forward_text}`);
      momentum = bullish.score;
    }

    // Historical warrant memory + price context (parallel) —
    // SKIP Yahoo network call when over budget; use neutral fallback values
    const [history, price] = isOverBudget
      ? [[] as PriorWarrant[], { cmp: null, perf_90d_pct: null, perf_52w_high_pct: null }]
      : await Promise.all([
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

    // Append to history (for future runs to compare against) — skip when
    // over budget to avoid KV write storm at end of loop
    if (!isOverBudget && price.cmp != null) {
      await appendWarrantHistory(f.symbol, {
        date: f.filing_datetime,
        price_at_filing: price.cmp,
        current_perf_pct: null,
      });
    }
  }

  // PATCH 0426/0427 — DEDUPLICATION + ENTITY GROUP CANONICALIZATION.
  // 0426: collapse (symbol, 14-day-bucket) when same warrant transaction
  // produces 3-4 filings.
  // 0427: also collapse listed entities that belong to the SAME corporate
  // group. STLTECH (Sterlite Technologies, parent) and STLNETWORK (STL
  // Networks Limited, subsidiary) are separately listed but related —
  // showing both as distinct "warrants" in the top 10 is misleading
  // entity-mapping risk. Canonical group map collapses them to a single
  // group key for ranking purposes; we keep both filings tagged in the
  // group_aliases field so the UI can show "and related: X, Y".
  const ENTITY_GROUPS: Record<string, string> = {
    'STLTECH':     'STERLITE_GROUP',
    'STLNETWORK':  'STERLITE_GROUP',
    'STERLITETECH': 'STERLITE_GROUP',
    // Vedanta group
    'HZL':         'VEDANTA_GROUP',
    'VEDL':        'VEDANTA_GROUP',
    // Adani group (high-promoter-warrant frequency)
    'ADANIENT':    'ADANI_GROUP',
    'ADANIPORTS':  'ADANI_GROUP',
    'ADANIGREEN':  'ADANI_GROUP',
    'ADANIPOWER':  'ADANI_GROUP',
    'ADANITRANS':  'ADANI_GROUP',
    'ATGL':        'ADANI_GROUP',
    'NDTV':        'ADANI_GROUP',
    'AMBUJACEM':   'ADANI_GROUP',
    'ACC':         'ADANI_GROUP',
    // GMR
    'GMRINFRA':    'GMR_GROUP',
    'GMRP&UI':     'GMR_GROUP',
    'GMRPUI':      'GMR_GROUP',
    // Reliance — though warrants here would be unusual
    'RELIANCE':    'RELIANCE_GROUP',
    'JIOFIN':      'RELIANCE_GROUP',
  };
  const canonicalKey = (sym: string): string => {
    const u = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ENTITY_GROUPS[u] || u;
  };
  const dedupBuckets = new Map<string, typeof all[number]>();
  const groupAliases = new Map<string, Set<string>>();   // key → {symbol, symbol, …}
  for (const sf of all) {
    const sym = (sf.symbol || sf.company_name || '').toUpperCase();
    const groupCanon = canonicalKey(sym);
    const dateMs = new Date(sf.filing_datetime).getTime();
    const bucketStart = Math.floor(dateMs / (14 * 24 * 60 * 60 * 1000));
    const key = `${groupCanon}:${bucketStart}`;
    // Track aliases for transparency
    if (!groupAliases.has(key)) groupAliases.set(key, new Set());
    groupAliases.get(key)!.add(sym);
    const existing = dedupBuckets.get(key);
    if (!existing) { dedupBuckets.set(key, sf); continue; }
    // Prefer higher conviction; tie-break on extraction richness
    const richness = (s: typeof sf) =>
      (s.conviction.diagnostics.pdf_extracted ? 1 : 0) +
      (s.conviction.diagnostics.promoter_subscribed_found ? 1 : 0) +
      (s.conviction.diagnostics.issue_price_found ? 1 : 0) +
      (s.conviction.diagnostics.conversion_period_found ? 1 : 0) +
      (s.conviction.diagnostics.total_size_found ? 1 : 0);
    if (sf.conviction.conviction > existing.conviction.conviction ||
        (sf.conviction.conviction === existing.conviction.conviction && richness(sf) > richness(existing))) {
      dedupBuckets.set(key, sf);
    }
  }
  const deduped = Array.from(dedupBuckets.entries()).map(([key, sf]) => {
    const aliases = Array.from(groupAliases.get(key) || []);
    const otherEntities = aliases.filter(a => a !== (sf.symbol || sf.company_name || '').toUpperCase());
    if (otherEntities.length > 0) {
      (sf as any).group_aliases = otherEntities;
    }
    return sf;
  });

  // Sort: passing gate first, then conviction desc
  deduped.sort((a, b) => {
    if (a.conviction.passes_gate !== b.conviction.passes_gate) return a.conviction.passes_gate ? -1 : 1;
    return b.conviction.conviction - a.conviction.conviction;
  });

  const payload: WarrantFeedPayload = {
    generated_at: new Date().toISOString(),
    count_total: merged.size,
    count_relevant: deduped.length,
    count_passing: deduped.filter(x => x.conviction.passes_gate).length,
    filings: deduped,
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
