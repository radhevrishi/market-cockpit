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
import { extractFirstPdf } from '@/lib/pdf-text-extractor';
import { extractSections } from '@/lib/concall-sections';
import { applySectorOverlay, type SectorOverlayResult } from '@/lib/concall-sector-overlays';
// PATCH 0407 — Bottleneck Scanner + Sympathy beneficiary map.
// Detects supply-chain bottlenecks in concall text and surfaces ecosystem
// beneficiaries (Modern Insulators read-through pattern).
import { scanBottleneck, type BottleneckSignal } from '@/lib/bottleneck-scanner';
// PATCH 0410 — Evidence Hierarchy: filing-type confidence + numeric anchors
// + boilerplate suppression + strict ULTRA gate.
import { applyEvidenceHierarchy, type EvidenceHierarchyResult } from '@/lib/evidence-hierarchy';

const CACHE_KEY = (days: number) => `concall-feed:v18:days:${days}`;  // v18: time-budget guard + sector confidence threshold
// PATCH 0396 — Aggressive live-cache per user spec: 'always take live data'
const CACHE_TTL_SHORT = 2 * 60;        // 2 min for fresh data (was 5)
const CACHE_TTL_LONG = 10 * 60;        // 10 min for older lookback (was 30)

// PATCH 0388 — extract PDFs in parallel for top N most-recent filings.
// Pure subject-line scoring was producing 0 high-bullish on user's 681
// relevant filings because subjects like "Transcript of Q2 Earnings Call"
// don't contain guidance/order-book/margin keywords. Bullish content is
// inside the PDF.
// Budget: Vercel maxDuration 45s, each PDF takes 2-5s with cache, ~10
// PDFs in parallel is safe. Cached PDFs hit instantly.
// PATCH 0393 — bumped 18 → 25 for 60-day window; subsequent refreshes
// hit cached PDFs so the next-poll cost is near-zero. Each refresh adds
// 25 more PDFs to KV cache, so within ~5 refreshes the top 100+ filings
// in any window are fully PDF-scored.
// PATCH 0412/0413 — Scaled PDF extraction cap. Each refresh adds MORE
// scored filings to the persistent store (Patch 0412 per-filing cache).
// Over multiple visits, DATA_PENDING count drops monotonically until
// every relevant filing has been parsed once.
function maxPdfExtractsForWindow(days: number): number {
  if (days <= 7)   return 50;
  if (days <= 30)  return 70;
  if (days <= 60)  return 85;
  if (days <= 90)  return 100;
  return 120;                         // 180d
}

interface ScoredFiling extends FilingRecord {
  filing_type: ConcallFilingType;
  bullish: BullishScore;
  is_high_bullish: boolean;
  scored_from: 'PDF' | 'SUBJECT';
  pdf_pages?: number;
  pdf_failure_reason?: string;
  sector_overlay?: SectorOverlayResult;   // PATCH 0401
  bottleneck?: BottleneckSignal;          // PATCH 0407 — supply-chain bottleneck detection
  evidence?: EvidenceHierarchyResult;     // PATCH 0410 — institutional evidence hierarchy
}

// PATCH 0408 — Cross-Company Theme Cluster.
// When N unrelated companies independently mention the same tag /
// component / sector inside the same window, conviction in the underlying
// industrial signal compounds. The aggregator emits these as a separate
// payload section that the UI pins above the filings list — institutional
// users care about cross-confirmation more than about any individual card.
export interface ThemeCluster {
  key: string;                    // canonical identifier (tag or component)
  kind: 'TAG' | 'COMPONENT' | 'SECTOR';
  label: string;                  // human-readable
  company_count: number;          // unique tickers
  filing_count: number;           // total filings (one company can file multiple)
  avg_score: number;              // mean composite score across participants
  top_companies: Array<{ symbol: string; company_name: string; score: number }>;
  evidence_excerpts: string[];    // 1-2 sentence quotes
  beneficiaries?: string[];       // for COMPONENT kind, expanded via sympathy map
  sectors?: string[];
  conviction: 'WATCH' | 'EMERGING' | 'CONFIRMED' | 'INSTITUTIONAL';
}

interface FeedPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_high_bullish: number;
  filings: ScoredFiling[];
  theme_clusters?: ThemeCluster[];   // PATCH 0408
  sources: {
    nse: 'NSE_OK' | 'NSE_BLOCKED' | 'NSE_EMPTY';
    bse: 'BSE_OK' | 'BSE_BLOCKED' | 'BSE_EMPTY';
  };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;  // PATCH 0388: extended for PDF extraction budget

export async function GET(req: NextRequest) {
  // PATCH 0414 — Hard time-budget guard. Vercel maxDuration=60s. We
  // track elapsed from request start and stop accepting new PDF
  // extractions once we cross 45s. This is the 504-prevention safety net.
  const REQUEST_START = Date.now();
  const TIME_BUDGET_MS = 45_000;   // hard ceiling — return what we have past this
  const timeElapsed = () => Date.now() - REQUEST_START;
  const timeRemaining = () => Math.max(0, TIME_BUDGET_MS - timeElapsed());

  // PATCH 0393 — max lookback bumped 30 → 60 days per user request
  // PATCH 0405 — bumped 60 → 90 days so Top-10 surfaces a wider universe
  // PATCH 0407 — bumped 90 → 180 days so user can validate historical
  // signal calls (Dec 25-27 concalls etc.) against current engine
  const days = Math.min(180, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '7')));
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

  // PATCH 0408 — Long-window fetch: chunk NSE into ≤30-day sub-windows
  // (NSE corp-announcements API caps returned rows per call, so a single
  // 180-day request gets truncated to the most recent ~500 filings).
  // Each sub-window runs in parallel. BSE page count scales with window
  // size: 2 pages per 30 days, capped at 12.
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
  // PATCH 0413 — Per-sub-window raw filings cache. Closed past windows
  // are immutable (NSE/BSE never republish history); we cache them 180
  // days. The rolling current window gets 30 min TTL. User feedback:
  // "what we saved should be saved and not scraped always."
  const todayIsoForCache = new Date().toISOString().slice(0, 10);
  const SUBWIN_KEY = (fromIso: string, toIso: string) => `subwin-filings:v1:${fromIso}:${toIso}`;
  const SUBWIN_TTL_PAST = 180 * 24 * 60 * 60;      // 6 months
  const SUBWIN_TTL_CURRENT = 30 * 60;              // 30 minutes for rolling window
  function ttlForSubwindow(toIso: string): number {
    return toIso < todayIsoForCache ? SUBWIN_TTL_PAST : SUBWIN_TTL_CURRENT;
  }

  // PATCH 0409 — serialize sub-window fetches with concurrency cap of 2.
  // Previous version fired all 6 sub-windows in parallel — NSE
  // rate-limited the burst and returned 429, dropping most filings.
  // Symptom: 180d returned 3924 filings while 14d returned 76566. Now
  // we batch 2 at a time with a 600ms jitter between batches.
  // PATCH 0414 — tightened from 14s → 10s per sub-window so the worst
  // case across 6 sub-windows stays under 32s, leaving 13s+ for PDFs.
  const totalBudgetMs = 10000;
  const SUBWIN_CONCURRENCY = 2;
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

  // PATCH 0413 — cache-first sub-window fetch.
  // Step 1: try KV for every sub-window. Step 2: scrape only the cache-misses
  // (typically just the current rolling window).
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
  console.log(`[live-feed] sub-windows: ${subwinCacheHits.length} cached, ${subwinMisses.length} need scrape`);

  const allResults: Array<Awaited<ReturnType<typeof fetchSubWindow>>> = [];
  for (const hit of subwinCacheHits) {
    allResults.push([hit.nse, hit.bse]);
  }
  for (let i = 0; i < subwinMisses.length; i += SUBWIN_CONCURRENCY) {
    const batch = subwinMisses.slice(i, i + SUBWIN_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(w => fetchSubWindow(w.fromIso, w.toIso)));
    // Write each batch result back to KV before moving on
    if (isRedisAvailable()) {
      for (let j = 0; j < batch.length; j++) {
        const [nseR, bseR] = batchResults[j];
        const w = batch[j];
        // Persist serializable plain objects (filings array + source)
        const payload: SubWinCache = {
          fromIso: w.fromIso,
          toIso: w.toIso,
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

  // Merge + dedup across ALL sub-windows by content_hash
  const merged = new Map<string, FilingRecord>();
  let nseStatus: string = 'NSE_EMPTY';
  let bseStatus: string = 'BSE_EMPTY';
  for (const [nseResult, bseResult] of allResults) {
    if (nseResult.source === 'NSE_OK') nseStatus = 'NSE_OK';
    if (bseResult.source === 'BSE_OK') bseStatus = 'BSE_OK';
    for (const f of nseResult.filings) merged.set(f.content_hash, f);
    for (const f of bseResult.filings) {
      if (!merged.has(f.content_hash)) merged.set(f.content_hash, f);
    }
  }
  // Reconstruct top-level result shape for the rest of the pipeline
  const nseResult = { filings: [] as FilingRecord[], source: nseStatus as any };
  const bseResult = { filings: [] as FilingRecord[], source: bseStatus as any };

  // PATCH 0412 — Per-filing scored cache. User feedback: "have some concept
  // to save already saved in our website and then only look new in every
  // refresh." Each scored filing is persisted to KV by content_hash with
  // 90-day TTL. On every request we check cache for ALL candidates first,
  // only extract + score NEW filings (not seen before) within the budget.
  // Universe grows monotonically across refreshes.
  const SCORED_KEY = (hash: string) => `scored-filing:v2:${hash}`;
  // PATCH 0413 — bumped 90 → 180 days per user request (6 months)
  const SCORED_TTL = 180 * 24 * 60 * 60;

  // Phase 1: classify + identify candidates for PDF extraction
  const candidates: Array<{ filing: FilingRecord; filing_type: ConcallFilingType }> = [];
  for (const f of merged.values()) {
    const filing_type = classifyFiling(f.subject);
    if (!filing_type) continue;
    candidates.push({ filing: f, filing_type });
  }

  // Sort by recency so we extract PDFs for the freshest filings first
  candidates.sort((a, b) =>
    new Date(b.filing.filing_datetime).getTime() - new Date(a.filing.filing_datetime).getTime(),
  );

  // PATCH 0388 / 0414 — PDF priority tiers hoisted above cache-read so
  // we can use it to filter candidates.
  const PDF_PRIORITY: Record<ConcallFilingType, number> = {
    TRANSCRIPT: 1,
    INVESTOR_PRESENTATION: 1,
    RESULTS_PRESENTATION: 1,
    PRESS_RELEASE: 2,
    CONCALL_INVITE: 3,
    ANALYST_MEET: 3,
    AUDIO_RECORDING: 9,  // skip — no text
    WEBCAST: 9,          // skip — no text
  };

  // PATCH 0412 — Look up cached scored payloads for every candidate.
  // PATCH 0414 — CRITICAL FIX: previously batched 40-at-a-time SEQUENTIAL
  // which meant 120 batches × ~150ms = 18s just on cache reads for 180d.
  // This was the dominant 504 cause. Now: single Promise.all over ALL
  // priority candidates (typically 500-1500 instead of 4800+). Also
  // skipped entirely if we're already over the time budget.
  let cacheHits = 0;
  const cachedScored = new Map<string, ScoredFiling>();
  // Only check cache for filings we'd actually consider extracting —
  // skips 70%+ of irrelevant subject-only filings.
  const priorityHashes = candidates
    .filter(c => PDF_PRIORITY[c.filing_type] <= 3)
    .map(c => c.filing.content_hash);
  // Cap at 2000 to prevent KV burst-rate-limit
  const HASHES_TO_CHECK = priorityHashes.slice(0, 2000);
  if (isRedisAvailable() && timeElapsed() < 25000 && HASHES_TO_CHECK.length > 0) {
    const ALL_PARALLEL_BUDGET_MS = 4000;     // hard cap on this phase
    try {
      const reads = await Promise.race([
        Promise.all(HASHES_TO_CHECK.map(h =>
          kvGet<ScoredFiling>(SCORED_KEY(h)).catch(() => null)
        )),
        new Promise<null[]>((resolve) =>
          setTimeout(() => resolve(new Array(HASHES_TO_CHECK.length).fill(null)), ALL_PARALLEL_BUDGET_MS)
        ),
      ]) as (ScoredFiling | null)[];
      for (let i = 0; i < HASHES_TO_CHECK.length; i++) {
        if (reads[i]) {
          cachedScored.set(HASHES_TO_CHECK[i], reads[i]!);
          cacheHits++;
        }
      }
    } catch {}
  }
  console.log(`[live-feed] elapsed=${timeElapsed()}ms · ${cacheHits}/${HASHES_TO_CHECK.length} cached (of ${candidates.length} total candidates)`);

  // PATCH 0412 — Within the same priority tier, prefer the MOST RECENT
  // filings so longer windows still see fresh content first. Previously
  // a 180d window could waste extraction budget on 5-month-old filings
  // and never reach the past week's transcripts.
  const maxPdfExtractsBase = maxPdfExtractsForWindow(days);
  // PATCH 0414 — Dynamically shrink the extraction quota based on REMAINING
  // budget. If we've already burned 30s on sub-window scraping, only spend
  // 15s on PDFs (each PDF avg ~2-4s with KV cache, so ~5 extractions).
  // Prevents the 60s Vercel timeout cold-start 504s.
  const remainingBeforeExtract = timeRemaining();
  const estPdfMs = 2500;                       // avg time per PDF (cold + warm mix)
  const reservedFinalMs = 6000;                // reserve 6s for scoring + theme + KV writes
  const budgetForPdfs = Math.max(0, remainingBeforeExtract - reservedFinalMs);
  const maxPdfsByTime = Math.floor(budgetForPdfs / estPdfMs);
  const maxPdfExtracts = Math.min(maxPdfExtractsBase, maxPdfsByTime);
  console.log(`[live-feed] elapsed=${timeElapsed()}ms, budget=${budgetForPdfs}ms → maxPdfExtracts=${maxPdfExtracts} (base ${maxPdfExtractsBase})`);

  // PATCH 0412 — Exclude cache hits from the extraction queue. The budget
  // is now spent ONLY on filings we haven't scored before.
  const extractable = maxPdfExtracts > 0 ? candidates
    .filter(c => !cachedScored.has(c.filing.content_hash))
    .filter(c => PDF_PRIORITY[c.filing_type] <= 3 && c.filing.attachment_urls.length > 0)
    .sort((a, b) => {
      const tierDiff = PDF_PRIORITY[a.filing_type] - PDF_PRIORITY[b.filing_type];
      if (tierDiff !== 0) return tierDiff;
      // Within the same tier, most-recent first
      return new Date(b.filing.filing_datetime).getTime() - new Date(a.filing.filing_datetime).getTime();
    })
    .slice(0, maxPdfExtracts) : [];

  const extractedTexts = new Map<string, { text: string; pages?: number; failure?: string }>();
  if (extractable.length > 0) {
    const results = await Promise.allSettled(
      extractable.map(async (c) => {
        const ext = await extractFirstPdf(c.filing.attachment_urls);
        return { hash: c.filing.content_hash, ext };
      }),
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { hash, ext } = r.value;
      if (!ext) {
        extractedTexts.set(hash, { text: '', failure: 'no PDF in attachments' });
        continue;
      }
      extractedTexts.set(hash, {
        text: ext.text,
        pages: ext.pages,
        failure: ext.source === 'FAILED' ? ext.failure_reason : undefined,
      });
    }
  }

  // Phase 2: score each filing using PDF text if available, else subject.
  // PATCH 0389 — extract forward-looking sections from PDF text before
  // scoring. Avoids boilerplate/legal/ESG inflating bullish counts.
  const all: ScoredFiling[] = [];
  // Track which hashes we score fresh this request (for KV write-back)
  const freshlyScored: ScoredFiling[] = [];
  for (const { filing: f, filing_type } of candidates) {
    // PATCH 0412 — Cache hit short-circuit. If we've scored this filing
    // before, use the persisted payload directly. Skip extraction + scoring.
    const cached = cachedScored.get(f.content_hash);
    if (cached) {
      all.push(cached);
      continue;
    }
    const ext = extractedTexts.get(f.content_hash);
    const usePdf = ext && ext.text.length >= 200;
    const scoredFrom: 'PDF' | 'SUBJECT' = usePdf ? 'PDF' : 'SUBJECT';
    let scoringText: string;
    if (usePdf) {
      const sections = extractSections(ext!.text);
      // Score the forward-looking sections + subject for context
      scoringText = `${f.subject}\n\n${sections.forward_text}`;
    } else {
      scoringText = f.subject;
    }
    const bullish = scoreBullish(scoringText);
    // PATCH 0401 — Apply sector overlay (detects sector + applies +/-0-3 delta)
    const sector_overlay = applySectorOverlay(scoringText);
    if (sector_overlay.overlay_score !== 0) {
      // Apply overlay to raw_score (cap at 0-10)
      const newRaw = Math.max(-5, Math.min(10, bullish.raw_score + sector_overlay.overlay_score));
      const newScore = Math.max(0, Math.min(10, newRaw));
      bullish.raw_score = Math.round(newRaw * 10) / 10;
      bullish.score = Math.round(newScore * 10) / 10;
      // Also nudge composite by 60% of overlay (overlay is supplemental signal)
      const compNudge = sector_overlay.overlay_score * 0.6;
      const newComp = Math.max(0, Math.min(10, (bullish.components as any).composite_score + compNudge));
      (bullish.components as any).composite_score = Math.round(newComp * 10) / 10;
    }
    // PATCH 0407 — Run the Bottleneck Scanner on the same text. When a
    // critical bottleneck fires (single-source / approved-vendor / qualification),
    // boost the bullish raw + composite score because scarcity = pricing
    // power = structural rerating fuel. Generic supply tightness gets a
    // smaller boost.
    const bottleneck = scanBottleneck(scoringText);
    if (bottleneck.detected) {
      // Weight is 3-8 from the scanner; translate to a raw-score nudge of
      // up to +2.5 so it doesn't crowd out the main bullish signal.
      const nudge = Math.min(2.5, bottleneck.weight / 3.2);
      const newRaw = Math.max(-5, Math.min(10, bullish.raw_score + nudge));
      const newScore = Math.max(0, Math.min(10, newRaw));
      bullish.raw_score = Math.round(newRaw * 10) / 10;
      bullish.score = Math.round(newScore * 10) / 10;
      const newComp = Math.max(0, Math.min(10, (bullish.components as any).composite_score + nudge * 0.7));
      (bullish.components as any).composite_score = Math.round(newComp * 10) / 10;
      // Tag for visibility
      if (!bullish.tags.includes('BOTTLENECK')) bullish.tags.push('BOTTLENECK');
      if (bottleneck.critical && !bullish.tags.includes('CRITICAL_COMPONENT')) bullish.tags.push('CRITICAL_COMPONENT');
    }

    // PATCH 0410 — Apply the Evidence Hierarchy. Replaces tier/composite
    // with institutionally-calibrated values. Filing-type weight,
    // numeric-anchor count, boilerplate suppression, and a strict ULTRA
    // gate all apply here.
    const evidence = applyEvidenceHierarchy(scoringText, bullish, filing_type, scoredFrom, sector_overlay?.sector);

    // PATCH 0411 — Time decay within the selected window. Recent filings
    // weight more than 6-month-old ones. λ depends on filing type —
    // transcripts decay slowly (high signal lasts months), investor
    // presentations decay faster (often re-issued each quarter).
    // PATCH 0412 — Softened decay rates after user feedback that 180d
    // window showed near-identical Top-N to 7d (older filings vanishing).
    // multiplier = exp(-λ × days_old). For transcripts: λ=0.005/day → 30d ≈ 0.86, 90d ≈ 0.64, 180d ≈ 0.41.
    // For presentations: λ=0.009/day → 30d ≈ 0.76, 90d ≈ 0.44, 180d ≈ 0.20.
    const filingTs = new Date(f.filing_datetime).getTime();
    const daysOld = Math.max(0, (Date.now() - filingTs) / 86_400_000);
    const lambda =
      filing_type === 'TRANSCRIPT' ? 0.005 :
      filing_type === 'CONCALL_INVITE' ? 0.005 :
      filing_type === 'RESULTS_PRESENTATION' ? 0.007 :
      filing_type === 'ANALYST_MEET' ? 0.008 :
      filing_type === 'INVESTOR_PRESENTATION' ? 0.009 :
      0.008;
    const timeDecay = Math.exp(-lambda * daysOld);
    if (timeDecay < 0.99) {
      evidence.adjusted_composite = Math.round(evidence.adjusted_composite * timeDecay * 10) / 10;
      // Bake the decay into the cap_reason for transparency
      if (timeDecay < 0.8) {
        const decayPct = Math.round((1 - timeDecay) * 100);
        evidence.cap_reason = evidence.cap_reason
          ? `${evidence.cap_reason} · −${decayPct}% time decay (${Math.round(daysOld)}d old)`
          : `−${decayPct}% time decay (${Math.round(daysOld)}d old)`;
      }
    }
    // Push the adjusted values back onto the bullish object so all
    // downstream consumers (theme aggregator, ranking, UI) see consistent
    // scores. The pre-hierarchy values remain visible inside the evidence
    // object for transparency.
    (bullish.components as any).composite_score = evidence.adjusted_composite;
    bullish.tier = evidence.adjusted_tier as any;
    bullish.score = evidence.adjusted_composite;
    // is_high_bullish now keyed off the hierarchy tier, not raw threshold.
    const is_high_bullish =
      evidence.adjusted_tier === 'ULTRA_BULLISH' ||
      evidence.adjusted_tier === 'BULLISH';
    const scored: ScoredFiling = {
      ...f,
      filing_type,
      bullish,
      is_high_bullish,
      scored_from: scoredFrom,
      pdf_pages: ext?.pages,
      pdf_failure_reason: ext?.failure,
      sector_overlay,
      bottleneck: bottleneck.detected ? bottleneck : undefined,
      evidence,
    };
    all.push(scored);
    // PATCH 0412 — track for KV write-back so future requests skip extraction
    freshlyScored.push(scored);
  }

  // PATCH 0412 — Persist newly-scored filings to KV (fire-and-forget batched).
  // Each scored filing keyed by content_hash with 90-day TTL. Next request
  // for any window containing this filing will pick it up instantly.
  if (isRedisAvailable() && freshlyScored.length > 0) {
    const writes = freshlyScored.map(s =>
      kvSet(SCORED_KEY(s.content_hash), s, SCORED_TTL).catch(() => {})
    );
    // Fire and forget — we don't block the response on cache writes
    Promise.all(writes).catch(() => {});
  }

  // PATCH 0389 — Cross-exchange dedup. Same company often files identical
  // disclosures on both NSE + BSE within minutes. Group by normalized
  // company name + filing_type, keep the highest-scoring per cluster.
  const deduped = mergeNSEBSE(all);

  // Sort: high bullish first, PDF-scored before subject-scored within tier,
  // then by raw score desc, then by date desc
  deduped.sort((a, b) => {
    if (a.is_high_bullish !== b.is_high_bullish) return a.is_high_bullish ? -1 : 1;
    if (a.scored_from !== b.scored_from) return a.scored_from === 'PDF' ? -1 : 1;
    if (b.bullish.raw_score !== a.bullish.raw_score) return b.bullish.raw_score - a.bullish.raw_score;
    return new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime();
  });

  // PATCH 0408 — Cross-Company Theme Aggregator.
  // For each tag / component / sector mentioned across the window, count
  // how many DIFFERENT companies independently surfaced it. ≥3 = EMERGING,
  // ≥6 = CONFIRMED, ≥10 = INSTITUTIONAL (i.e. the theme is too obvious for
  // smart money to ignore — late but high-conviction).
  const theme_clusters = buildThemeClusters(deduped);

  const payload: FeedPayload = {
    generated_at: new Date().toISOString(),
    count_total: merged.size,
    count_relevant: deduped.length,
    count_high_bullish: deduped.filter(x => x.is_high_bullish).length,
    filings: deduped,
    theme_clusters,
    sources: { nse: nseResult.source, bse: bseResult.source },
  };

  // Cache the full payload; filters applied at response time
  if (isRedisAvailable()) {
    const ttl = days <= 2 ? CACHE_TTL_SHORT : CACHE_TTL_LONG;
    await kvSet(cacheKey, payload, ttl);
  }

  return NextResponse.json(applyFilters(payload, { exchangeFilter, bullishOnly }));
}

// PATCH 0389 — Cross-exchange dedup. Same disclosure often filed on both
// NSE + BSE within minutes. Cluster by normalized company name + filing
// type within 24h window, keep the highest-scoring (NSE preferred on ties).
function mergeNSEBSE(filings: ScoredFiling[]): ScoredFiling[] {
  const normalizeCompany = (n: string): string =>
    (n || '').toLowerCase()
      .replace(/\b(ltd|limited|pvt|private|corp(?:oration)?|inc|company)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

  const clusters = new Map<string, ScoredFiling[]>();
  for (const f of filings) {
    const company = normalizeCompany(f.company_name) || normalizeCompany(f.symbol);
    const day = f.filing_datetime.slice(0, 10);  // YYYY-MM-DD
    const key = `${company}|${f.filing_type}|${day}`;
    const arr = clusters.get(key) || [];
    arr.push(f);
    clusters.set(key, arr);
  }

  const out: ScoredFiling[] = [];
  for (const arr of clusters.values()) {
    if (arr.length === 1) { out.push(arr[0]); continue; }
    // Multiple filings same company/type/day — collapse to winner
    arr.sort((a, b) => {
      // Prefer PDF-scored over subject
      if (a.scored_from !== b.scored_from) return a.scored_from === 'PDF' ? -1 : 1;
      // Prefer higher raw score
      if (b.bullish.raw_score !== a.bullish.raw_score) return b.bullish.raw_score - a.bullish.raw_score;
      // Prefer NSE
      if (a.exchange !== b.exchange) return a.exchange === 'NSE' ? -1 : 1;
      // More recent timestamp
      return new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime();
    });
    out.push(arr[0]);
  }
  return out;
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

// ─── PATCH 0408 — Cross-Company Theme Aggregator ─────────────────────────
//
// Walks all scored filings, counts how many UNIQUE COMPANIES independently
// mentioned each tag / bottleneck component / sector overlay. Clusters
// that span ≥3 unrelated companies surface as institutional-grade themes,
// because cross-confirmation by independent management teams is the
// strongest possible signal for a real industrial inflection.
//
// Conviction tiers:
//   3-5 companies  → EMERGING        (theme has multiple data points)
//   6-9 companies  → CONFIRMED       (theme broadly visible — institutions catching on)
//   ≥10 companies  → INSTITUTIONAL   (theme too obvious for smart money to miss — late but high conviction)
//
// We exclude generic ambient tags (e.g. 'AI', 'export') from cluster surfacing
// to focus on industrial-causal themes. Allow tags that map to real
// engineering / supply-chain nodes.
const TAG_INCLUDE_FOR_CLUSTERING = new Set<string>([
  'Order book', 'Capacity', 'Capex', 'Capacity expansion', 'Margin',
  'Margin expansion', 'Premiumization', 'Cash Flow', 'Demand',
  'Guidance', 'Deleveraging', 'Market Share', 'Defence', 'Renewable / Solar',
  'EV / Electric Vehicle', 'Tariff / Duty', 'Semiconductor',
  'Real estate / RERA', 'GST', 'China', 'Utilization (IT/Mfg)',
  'New customer / order', 'BOTTLENECK', 'CRITICAL_COMPONENT',
  'DEMAND_SUPPLY_ASYMMETRY',
]);

function classifyConviction(companyCount: number): ThemeCluster['conviction'] {
  if (companyCount >= 10) return 'INSTITUTIONAL';
  if (companyCount >= 6)  return 'CONFIRMED';
  if (companyCount >= 3)  return 'EMERGING';
  return 'WATCH';
}

function buildThemeClusters(filings: ScoredFiling[]): ThemeCluster[] {
  // Index: clusterKey → { kind, label, participants: Map<symbol,{name,score,one_excerpt}> }
  type Participant = { symbol: string; company_name: string; score: number; excerpt: string };
  type Acc = {
    kind: ThemeCluster['kind'];
    label: string;
    participants: Map<string, Participant>;
    filings: number;
    beneficiaries?: Set<string>;
    sectors?: Set<string>;
  };
  const buckets = new Map<string, Acc>();

  const addToBucket = (key: string, kind: ThemeCluster['kind'], label: string, f: ScoredFiling, excerpt: string) => {
    const sym = (f.symbol || f.company_name || '').toUpperCase();
    if (!sym) return;
    let b = buckets.get(key);
    if (!b) {
      b = { kind, label, participants: new Map(), filings: 0 };
      buckets.set(key, b);
    }
    b.filings += 1;
    const existing = b.participants.get(sym);
    const score = (f.bullish.components as any).composite_score ?? f.bullish.raw_score ?? 0;
    if (!existing || score > existing.score) {
      b.participants.set(sym, { symbol: sym, company_name: f.company_name, score, excerpt });
    }
  };

  for (const f of filings) {
    // Tag clustering — only over our whitelist
    for (const tag of f.bullish.tags || []) {
      if (!TAG_INCLUDE_FOR_CLUSTERING.has(tag)) continue;
      // Use first evidence quote (BULL polarity) as excerpt
      const ex = (f.bullish.evidence || []).find(e => e.polarity === 'BULL' && !e.negated && e.tag === tag);
      addToBucket(`TAG:${tag}`, 'TAG', tag, f, ex?.text || '');
    }
    // Bottleneck component clustering
    if (f.bottleneck && f.bottleneck.detected) {
      const trig = f.bottleneck.evidence[0] || '';
      for (const comp of f.bottleneck.components || []) {
        const key = `COMP:${comp}`;
        addToBucket(key, 'COMPONENT', comp.replace(/_/g, ' '), f, trig);
        const acc = buckets.get(key)!;
        if (!acc.beneficiaries) acc.beneficiaries = new Set();
        if (!acc.sectors) acc.sectors = new Set();
        for (const b of f.bottleneck.beneficiaries || []) acc.beneficiaries.add(b);
        for (const s of f.bottleneck.sectors || []) acc.sectors.add(s);
      }
    }
    // Sector overlay clustering — surface when many companies in same sector
    // confirm bullish tilt
    if (f.sector_overlay && f.sector_overlay.sector !== 'UNKNOWN' && f.sector_overlay.overlay_score > 0) {
      const sec = f.sector_overlay.sector.replace(/_/g, ' ');
      addToBucket(`SEC:${sec}`, 'SECTOR', sec, f, '');
    }
  }

  // Materialize clusters where ≥3 unique companies
  const out: ThemeCluster[] = [];
  for (const [key, b] of buckets) {
    const companyCount = b.participants.size;
    if (companyCount < 3) continue;
    const ranked = Array.from(b.participants.values()).sort((x, y) => y.score - x.score);
    const top = ranked.slice(0, 8).map(p => ({ symbol: p.symbol, company_name: p.company_name, score: Math.round(p.score * 10) / 10 }));
    const excerpts = ranked.filter(p => p.excerpt).slice(0, 3).map(p => `[${p.symbol}] "${p.excerpt.slice(0, 240)}${p.excerpt.length > 240 ? '…' : ''}"`);
    const avgScore = ranked.reduce((s, p) => s + p.score, 0) / ranked.length;
    out.push({
      key,
      kind: b.kind,
      label: b.label,
      company_count: companyCount,
      filing_count: b.filings,
      avg_score: Math.round(avgScore * 10) / 10,
      top_companies: top,
      evidence_excerpts: excerpts,
      beneficiaries: b.beneficiaries ? Array.from(b.beneficiaries) : undefined,
      sectors: b.sectors ? Array.from(b.sectors) : undefined,
      conviction: classifyConviction(companyCount),
    });
  }
  // Rank: COMPONENT first (highest causal value), then by company_count desc
  const kindWeight: Record<ThemeCluster['kind'], number> = { COMPONENT: 0, TAG: 1, SECTOR: 2 };
  out.sort((a, b) => {
    if (kindWeight[a.kind] !== kindWeight[b.kind]) return kindWeight[a.kind] - kindWeight[b.kind];
    if (b.company_count !== a.company_count) return b.company_count - a.company_count;
    return b.avg_score - a.avg_score;
  });
  return out.slice(0, 20);
}
