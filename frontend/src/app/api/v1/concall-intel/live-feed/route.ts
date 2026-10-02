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
import { kvGet, kvSet, kvMGet, isRedisAvailable } from '@/lib/kv';
import { parseListOptions, shapeLiveFeedPayload } from '@/lib/lean-view';
import { privateCache } from '@/lib/swr-cache';
import { fetchNSEAnnouncements, fetchBSEAnnouncements, type FilingRecord } from '@/lib/nse-bse-feed';
import { scoreBullish, type BullishScore, type ConcallFilingType } from '@/lib/concall-bullish';
import { loadConcallWindow, classifyConcallFiling, dedupeConcallFilings, displaySubject, buildFeedStatus, countConcalls, LAST_OK_KEY, type WindowStore, type FeedStatus } from '@/lib/concall-feed';
// PATCH 0934 — Haiku import REMOVED from Signals pipeline per user
// directive. Wrapper stays available at @/lib/anthropic-classifier for the
// /api/v1/haiku/health diagnostic endpoint and any FUTURE non-Signals use.
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
// PATCH 0424 — Economic Translation Layer (institutional review item 4.1-4.4)
import { predictEarningsDelta, type EarningsDelta } from '@/lib/economic-translation';

const CACHE_KEY = (days: number) => `concall-feed:v26:days:${days}`;  // v26: zzz810 honest fetch_status + backfill (orphans cached empties)
// v25: Patch 0429 cross-exchange dedup + scored-filing cache flush  // v25: Patch 0429 cross-exchange dedup + scored-filing cache flush
// PATCH 0703 — Vercel free-tier rescue. User hit 5h16m / 4h Fluid CPU cap
// (was 4h52m at last check). This route is the single heaviest endpoint
// (60s maxDuration, parallel PDF parse). Bumping TTLs 15× drops the
// cold-start frequency from ~every 2 min to ~every 30 min during busy
// periods — saves the bulk of remaining CPU for the month.
//   prev (P0396): 2 min / 10 min
//   now           30 min / 60 min
// Caller can still force-bypass with ?force=1 (existing param).
const CACHE_TTL_SHORT = 30 * 60;       // 30 min for fresh data
const CACHE_TTL_LONG  = 60 * 60;       // 60 min for older lookback

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
  earnings_delta?: EarningsDelta;         // PATCH 0424 — economic translation: revenue/margin direction
  // PATCH 0934 — haiku_catalyst field removed; Signals stays regex-only.
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
  fetch_status?: FeedStatus;   // zzz810
}

// zzz810 — BSE "Company Update" subcategories that carry concall material.
const BSE_CONCALL_SUBCATEGORIES = ['Earnings Call Transcript', 'Analyst / Investor Meet', 'Investor Presentation'];

export const runtime = 'nodejs';
// PATCH 0819: removed force-dynamic so Cache-Control headers aren't overridden by Next.js. Query params still force dynamic at runtime.
export const maxDuration = 30;  // PATCH 0818 — tighter cap to bound CPU per call

export async function GET(req: NextRequest) {
  try {
    return await handleLiveFeed(req);
  } catch (err) {
    // PATCH 0416 — Never return HTTP 500. Any unexpected error becomes
    // a 200 with an `error` field. UI shows graceful degradation.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[live-feed] uncaught error', msg);
    // PATCH zzz65 — never echo raw error to client (could include upstream
    // URLs, KV creds-in-message, stack fragments). Generic label only.
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      count_total: 0,
      count_relevant: 0,
      count_high_bullish: 0,
      filings: [],
      theme_clusters: [],
      sources: { nse: 'NSE_BLOCKED', bse: 'BSE_BLOCKED' },
      error: 'live-feed temporarily unavailable',
    }, { headers: { 'Cache-Control': 'no-store' } });  // PATCH 0818 / zzz855: never cache an empty/error answer
  }
}

async function handleLiveFeed(req: NextRequest) {
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
  // PATCH zzz65 — NaN guard. `?days=foo` → NaN → Invalid Date later → garbage NSE call.
  const daysRaw = parseInt(req.nextUrl.searchParams.get('days') || '7');
  const days = Math.min(180, Math.max(1, Number.isFinite(daysRaw) ? daysRaw : 7));
  const exchangeFilter = (req.nextUrl.searchParams.get('exchange') || '').toUpperCase();
  // PATCH zzz65 — NaN guard on threshold (silent `NaN >= NaN = false` hid all results).
  const thresholdRaw = parseFloat(req.nextUrl.searchParams.get('threshold') || '4');
  const rawThreshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 4;
  const bullishOnly = req.nextUrl.searchParams.get('bullishOnly') === '1';
  const force = req.nextUrl.searchParams.get('force') === '1';
  // PATCH 0704 — cacheOnly=1 returns cached payload if any, otherwise an
  // immediate empty payload tagged 'CACHE_WARMING'. Used by /order-book
  // and /rating-actions so cold-start NEVER blocks user. Page can then
  // optionally trigger a background warm without ?cacheOnly.
  const cacheOnly = req.nextUrl.searchParams.get('cacheOnly') === '1';

  // KV cache check
  const cacheKey = CACHE_KEY(days);
  // zzz855 — opt-in lean shapes (?view=lean|summary, ?fields=, ?limit=); default response unchanged.
  const listOpts = parseListOptions(req.nextUrl.searchParams);
  const out = (p: FeedPayload) => shapeLiveFeedPayload(applyFilters(p, { exchangeFilter, bullishOnly }), listOpts);
  if (!force) {
    // zzz855 — in-process memo of the parsed KV payload (2.5 MB+ JSON; the home page asks for it 3× per load).
    // 60 s, always ≤ the KV entry's own age window; same validity rule as the KV read below.
    const m = FEED_MEMO.get(cacheKey);
    if (m && Date.now() - m.ts < FEED_MEMO_MS) {
      return NextResponse.json(out(m.payload), { headers: { 'Cache-Control': privateCache(60, 300), 'x-mc-cache': 'hit', 'x-mc-cache-age': String(Math.round((Date.now() - m.ts) / 1000)) } });
    }
  }
  if (!force && isRedisAvailable()) {
    const cached = await kvGet<FeedPayload>(cacheKey);
    // zzz810 — an empty or failed cached payload is not a store to serve:
    // fall through and backfill the window from the exchanges.
    if (cached && Array.isArray(cached.filings) && cached.filings.length > 0 && cached.fetch_status && cached.fetch_status.state !== 'FAILED') {
      feedMemoPut(cacheKey, cached);
      return NextResponse.json(out(cached), { headers: { 'Cache-Control': privateCache(60, 300), 'x-mc-cache': 'hit' } });  // PATCH 0818 / zzz855 private
    }
  }
  // PATCH 0704 — cacheOnly path: no cache → return empty immediately so
  // client doesn't block on the 30-60s fresh-fetch.
  // PATCH 1101zzz37 — when Redis cache is cold but the CF Worker blob has
  // fresh filings (sub-100ms read, already deployed), fall through to that
  // before declaring empty. Otherwise the Signals page shows "Upstream
  // scraper is empty" forever even though mc-scraper has 20 fresh filings.
  if (cacheOnly) {
    try {
      const fromDateCO = new Date();
      fromDateCO.setDate(fromDateCO.getDate() - days);
      const fromIsoCO = fromDateCO.toISOString().slice(0, 10);
      const toIsoCO = new Date().toISOString().slice(0, 10);
      const cfResult = await fetchNSEAnnouncements({
        signal: AbortSignal.timeout(3000),
        fromIso: fromIsoCO,
        toIso: toIsoCO,
      });
      const cfFilings = cfResult?.filings || [];
      if (cfFilings.length > 0) {
        // Return raw filings — caller routes only need .filings.length for
        // the "is upstream empty?" diagnostic. Skips heavy scoring on
        // cacheOnly path; cache the result so Signals reuses it.
        const payload: any = {
          generated_at: new Date().toISOString(),
          count_total: cfFilings.length,
          count_relevant: cfFilings.length,
          count_high_bullish: 0,
          filings: cfFilings.slice(0, 200).map((f: FilingRecord) => ({
            symbol: f.symbol,
            company: f.company_name,
            exchange: f.exchange,
            subject: f.subject,
            filing_datetime: f.filing_datetime,
            attachment_url: f.attachment_urls?.[0] || null,
            source_url: f.source_url,
            bullish: { tier: 'NEUTRAL', raw_score: 0, composite: 0 },
            sectorOverlay: null,
          })),
          theme_clusters: [],
          sources: { nse: 'NSE_OK', bse: 'BSE_EMPTY' },
          cacheStatus: 'CF_WORKER_DIRECT',
        };
        return NextResponse.json(payload, { headers: { 'Cache-Control': privateCache(30, 120) } });
      }
    } catch { /* fall through to empty payload */ }
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      count_total: 0,
      count_relevant: 0,
      count_high_bullish: 0,
      filings: [],
      theme_clusters: [],
      sources: { nse: 'NSE_EMPTY', bse: 'BSE_EMPTY' },
      cacheStatus: 'CACHE_WARMING',
    }, { headers: { 'Cache-Control': 'no-store' } });  // PATCH 0818 / zzz855: never cache an empty/error answer
  }

  // zzz810 — window loading moved to lib/concall-feed.loadConcallWindow:
  // sub-windows are dated on the IST calendar, a stored sub-window is reused
  // only if its fetch actually succeeded and held rows (a blocked / empty
  // fetch used to be cached — past windows for 180 days — which kept the feed
  // at 0 after the exchanges recovered), and missing windows are backfilled
  // from NSE/BSE on demand. BSE is additionally queried by the concall
  // subcategories, because its unfiltered newest-N pages cover only a few
  // hours of a results-season day.
  const bsePages = Math.min(12, Math.max(2, Math.ceil(days / 15)));
  const SUBWIN_BUDGET_MS = 10_000;
  const store: WindowStore | null = isRedisAvailable()
    ? { get: (k) => kvGet(k), set: (k, v, ttl) => kvSet(k, v, ttl) }
    : null;
  const win = await loadConcallWindow(days, {
    store,
    fetchNSE: (fromIsoW, toIsoW) => fetchNSEAnnouncements({ signal: AbortSignal.timeout(SUBWIN_BUDGET_MS), fromIso: fromIsoW, toIso: toIsoW }),
    fetchBSE: async (fromIsoW, toIsoW) => {
      const signal = AbortSignal.timeout(SUBWIN_BUDGET_MS);
      const generic = await fetchBSEAnnouncements({ signal, fromIso: fromIsoW, toIso: toIsoW, pages: bsePages });
      const parts = [generic];
      if (generic.source !== 'BSE_BLOCKED' || generic.filings.length > 0) {
        for (const sub of BSE_CONCALL_SUBCATEGORIES) {
          if (signal.aborted) break;
          parts.push(await fetchBSEAnnouncements({ signal, fromIso: fromIsoW, toIso: toIsoW, pages: 6, category: 'Company Update', subcategory: sub }));
        }
      }
      const filings = parts.flatMap((p) => p.filings);
      const ok = parts.some((p) => p.source === 'BSE_OK');
      return {
        filings,
        source: ok ? 'BSE_OK' : generic.source,
        reason: ok ? undefined : (generic.reason || parts.find((p) => p.reason)?.reason),
      };
    },
  }, { force });
  console.log(`[live-feed] window ${win.from_iso}→${win.to_iso}: ${win.windows_from_store}/${win.windows_total} sub-windows from store, ${win.windows_backfilled} fetched · NSE ${win.nse} · BSE ${win.bse} · ${win.filings.length} announcements`);

  const merged = new Map<string, FilingRecord>();
  for (const f of win.filings) merged.set(f.content_hash, f);
  const nseResult = { filings: [] as FilingRecord[], source: (win.nse === 'OK' ? 'NSE_OK' : win.nse === 'EMPTY' ? 'NSE_EMPTY' : 'NSE_BLOCKED') as FeedPayload['sources']['nse'] };
  const bseResult = { filings: [] as FilingRecord[], source: (win.bse === 'OK' ? 'BSE_OK' : win.bse === 'EMPTY' ? 'BSE_EMPTY' : 'BSE_BLOCKED') as FeedPayload['sources']['bse'] };

  // PATCH 0412 — Per-filing scored cache. User feedback: "have some concept
  // to save already saved in our website and then only look new in every
  // refresh." Each scored filing is persisted to KV by content_hash with
  // 90-day TTL. On every request we check cache for ALL candidates first,
  // only extract + score NEW filings (not seen before) within the budget.
  // Universe grows monotonically across refreshes.
  // PATCH 0419 — bumped v2 → v3 so all cached scored filings get
  // re-evaluated with Patch 0418's loosened gates. Without this bump,
  // the per-filing cache holds old NEUTRAL tier values from before
  // the recalibration, and Top-10 stays empty.
  // PATCH 0429 — bumped scored-filing v3 → v4 to flush stale ENRIN
  // AUTO_TRANSMISSIONS bottleneck data (Patch 0422 fixed the vocab but cached
  // payloads still had the false-positive) + propagate the Patch 0424
  // earnings_delta field through to retroactively scored filings.
  const SCORED_KEY = (hash: string) => `scored-filing:v4:${hash}`;
  // PATCH 0413 — bumped 90 → 180 days per user request (6 months)
  const SCORED_TTL = 180 * 24 * 60 * 60;

  // Phase 1: classify + identify candidates for PDF extraction
  // zzz810 — classify on subject + detail line. NSE files every concall
  // item as "Analysts/Institutional Investor Meet/Con. Call Updates"; only the
  // detail says transcript vs recording vs intimation. Business-update,
  // investor-call and analyst-meet transcripts are TRANSCRIPTs too.
  const candidates: Array<{ filing: FilingRecord; filing_type: ConcallFilingType }> = [];
  for (const raw of dedupeConcallFilings([...merged.values()])) {
    const cls = classifyConcallFiling(raw.subject, raw.detail);
    if (!cls.filing_type) continue;
    const f: FilingRecord = raw.detail ? { ...raw, subject: displaySubject(raw) } : raw;
    candidates.push({ filing: f, filing_type: cls.filing_type });
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
    // PATCH 0669 — Order receipts + rating actions get tier-2 priority so
    // they pass through the filter but aren't pulled for PDF parsing (the
    // subject line alone carries the signal for /order-book and /rating-actions).
    ORDER_RECEIPT: 2,
    RATING_ACTION: 2,
    // PATCH 0713 — new event-driven categories. Subject line carries the
    // signal; same tier-2 treatment as Reg-30 (pass through, no PDF parse).
    CAPEX_ANNOUNCE: 2,
    BUYBACK_ANNOUNCE: 2,
    PROMOTER_TXN: 2,
    BLOCK_DEAL: 2,
    MA_EVENT: 2,
    GOVERNANCE: 2,
    USFDA_EVENT: 2,
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
        // zzz855 — was one GET per hash (up to 2000 parallel round-trips); now MGET in chunks of 200.
        (async () => {
          const CH = 200;
          const chunks: string[][] = [];
          for (let i = 0; i < HASHES_TO_CHECK.length; i += CH) chunks.push(HASHES_TO_CHECK.slice(i, i + CH));
          const parts = await Promise.all(chunks.map((c) => kvMGet<ScoredFiling>(c.map((h) => SCORED_KEY(h))).catch(() => c.map(() => null))));
          return parts.flat();
        })(),
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
  // PATCH 0415 — PDFs run in parallel (Promise.allSettled), so the wall-clock
  // is governed by the slowest PDF + the 7s timeout in pdf-text-extractor,
  // NOT by N × avg. Treat PDF extraction as a flat ~8s budget regardless of
  // count. This unlocks 30-100 extractions per refresh on warm KV.
  // PATCH 0415 — reservedFinalMs dropped 6s → 3s (scoring + KV writes are <1s).
  const PDF_WALL_CLOCK_MS = 9000;              // worst-case for parallel batch
  const reservedFinalMs = 3000;
  const budgetForPdfs = Math.max(0, remainingBeforeExtract - reservedFinalMs);
  // If we have ≥9s left, run full PDF batch; otherwise cap proportionally.
  const maxPdfExtracts = budgetForPdfs >= PDF_WALL_CLOCK_MS
    ? maxPdfExtractsBase
    : Math.floor((budgetForPdfs / PDF_WALL_CLOCK_MS) * maxPdfExtractsBase);
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
      // zzz810 — keep the stored score, but take today's classification and
      // subject (older entries were classified on the generic NSE category).
      all.push({ ...cached, filing_type, subject: f.subject, ...(f.detail ? { detail: f.detail } : {}) });
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
    // PATCH 0424 — Economic Translation. Aggregate the per-tag economic
    // sensitivities into a directional read on revenue / margin / cycle +
    // the 2-axis Narrative-vs-Financial split (review item 4.5).
    const positive_tags: string[] = (bullish.tags || []).filter((t: any) =>
      !/^⚠/.test(String(t)) && !/(Slowdown|Delay|Cancel|One-off|Pricing pressure|GNPA|Lower utiliz|Near-term|Cautious)/i.test(String(t))
    );
    const negative_tags: string[] = (bullish.red_flags || []).map((rf: any) =>
      typeof rf === 'string' ? rf : (rf?.tag || rf?.label || String(rf))
    );
    const earnings_delta = predictEarningsDelta({
      positive_tags,
      negative_tags,
      has_numeric_anchor: !!(evidence as any)?.numeric_anchors_count || !!(evidence as any)?.tier1_financial_evidence,
      has_concrete_guidance: !!(evidence as any)?.has_concrete_guidance || positive_tags.includes('Guidance'),
      narrative_score_raw: bullish.score ?? 0,
      composite_score: (bullish.components as any)?.composite_score ?? bullish.score ?? 0,
      bottleneck_detected: bottleneck.detected,
      bottleneck_critical: bottleneck.critical,
    });

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
      earnings_delta,
    };
    all.push(scored);
    // PATCH 0412 — track for KV write-back so future requests skip extraction
    freshlyScored.push(scored);
  }

  // PATCH 0934 — Haiku wiring REVERTED per user directive ("For signals
  // dont use anthropic key"). Haiku classifier remains available via
  // /api/v1/haiku/health for future use but does NOT touch the Signals path.
  // Original P0931/P0932 wiring removed to keep this pipeline regex-only.

  // PATCH 0412 — Persist newly-scored filings to KV (fire-and-forget batched).
  // Each scored filing keyed by content_hash with 90-day TTL. Next request
  // for any window containing this filing will pick it up instantly.
  // PATCH 0931 — Haiku catalyst result (if attached above) gets persisted
  // alongside the scored payload so future cache reads skip the LLM call entirely.
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

  // zzz810 — honest status. "Last successful fetch" is persisted so a
  // failure can say when the feed last worked.
  const nowIso = new Date().toISOString();
  const anyOk = win.nse === 'OK' || win.bse === 'OK';
  let lastOk: { at: string } | null = null;
  if (isRedisAvailable()) {
    if (anyOk && merged.size > 0) {
      lastOk = { at: nowIso };
      kvSet(LAST_OK_KEY, { at: nowIso, announcements: merged.size }, 30 * 24 * 60 * 60).catch(() => {});
    } else {
      lastOk = await kvGet<{ at: string }>(LAST_OK_KEY).catch(() => null);
    }
  } else if (anyOk && merged.size > 0) {
    lastOk = { at: nowIso };
  }
  const counts = countConcalls(deduped);
  const fetch_status = buildFeedStatus({
    nse: win.nse, bse: win.bse, nse_reason: win.nse_reason, bse_reason: win.bse_reason,
    announcements_total: merged.size,
    concall_filings: counts.concall_filings,
    transcripts: counts.transcripts,
    window_days: days,
    last_success_at: lastOk?.at ?? null,
    from_iso: win.from_iso, to_iso: win.to_iso,
  });

  const payload: FeedPayload = {
    generated_at: nowIso,
    count_total: merged.size,
    count_relevant: deduped.length,
    count_high_bullish: deduped.filter(x => x.is_high_bullish).length,
    filings: deduped,
    theme_clusters,
    sources: { nse: nseResult.source, bse: bseResult.source },
    fetch_status,
  };

  // Cache the full payload; filters applied at response time.
  // zzz810 — never cache a failed fetch (the next request must retry), and
  // keep a partial one only briefly.
  if (isRedisAvailable() && fetch_status.state !== 'FAILED') {
    const ttl = fetch_status.state === 'PARTIAL' ? 5 * 60 : (days <= 2 ? CACHE_TTL_SHORT : CACHE_TTL_LONG);
    await kvSet(cacheKey, payload, ttl);
  }

  if (fetch_status.state !== 'FAILED' && fetch_status.state !== 'PARTIAL' && payload.filings.length > 0) feedMemoPut(cacheKey, payload);
  return NextResponse.json(out(payload), { headers: { 'Cache-Control': privateCache(60, 300), 'x-mc-cache': 'miss' } });  // PATCH 0818 / zzz855 private
}

// zzz855 — per-instance memo of the full (unfiltered) payload per window.
const FEED_MEMO_MS = 60_000;
const FEED_MEMO: Map<string, { payload: FeedPayload; ts: number }> = (globalThis as any).__MC_LIVE_FEED_MEMO__ || new Map();
(globalThis as any).__MC_LIVE_FEED_MEMO__ = FEED_MEMO;
function feedMemoPut(key: string, payload: FeedPayload) {
  FEED_MEMO.set(key, { payload, ts: Date.now() });
  if (FEED_MEMO.size > 8) { const first = FEED_MEMO.keys().next().value; if (first !== undefined) FEED_MEMO.delete(first); }
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

  // PATCH 0429 — REMOVE filing_type from the dedup key. The Sambhv bug:
  // BSE labels the same earnings call 'Earnings Call Transcript' (→ TRANSCRIPT)
  // while NSE labels it 'Analyst/Institutional Investor Meet' (→ ANALYST_MEET).
  // Same underlying event, different filing_type in our taxonomy. Previous
  // key included filing_type so they were treated as distinct and BOTH made
  // it into Top 10. Same root cause for CENTUM ×2, GMRP&UI ×2, JETFREIGHT ×2.
  //
  // New key: just company + day. Within the same company on the same day, we
  // keep the SINGLE highest-quality filing (PDF over subject, higher raw, NSE
  // over BSE for cleaner symbol). This is the user's mental model — one
  // company × one day = one entry. Distinct DOCUMENT TYPES (e.g. investor
  // presentation released morning + earnings call transcript released evening
  // on same day) WILL collapse to one; the winner exposes both attachment_urls
  // in its `cross_exchange_dups` field for transparency.
  const clusters = new Map<string, ScoredFiling[]>();
  for (const f of filings) {
    const company = normalizeCompany(f.company_name) || normalizeCompany(f.symbol);
    const day = f.filing_datetime.slice(0, 10);
    const key = `${company}|${day}`;
    const arr = clusters.get(key) || [];
    arr.push(f);
    clusters.set(key, arr);
  }

  const out: ScoredFiling[] = [];
  for (const arr of clusters.values()) {
    if (arr.length === 1) { out.push(arr[0]); continue; }
    // Multiple filings same company on same day — collapse to winner
    arr.sort((a, b) => {
      // zzz810 — the transcript IS the concall; never let a same-day notice
      // or presentation hide it.
      const ta = a.filing_type === 'TRANSCRIPT' ? 0 : 1, tb = b.filing_type === 'TRANSCRIPT' ? 0 : 1;
      if (ta !== tb) return ta - tb;
      // Prefer PDF-scored over subject
      if (a.scored_from !== b.scored_from) return a.scored_from === 'PDF' ? -1 : 1;
      // Prefer higher raw score
      if (b.bullish.raw_score !== a.bullish.raw_score) return b.bullish.raw_score - a.bullish.raw_score;
      // Prefer NSE (cleaner symbol display)
      if (a.exchange !== b.exchange) return a.exchange === 'NSE' ? -1 : 1;
      // More recent timestamp
      return new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime();
    });
    const winner = arr[0];
    // Expose the collapsed siblings for transparency
    const dups = arr.slice(1).map(s => ({
      exchange: s.exchange,
      symbol: s.symbol,
      filing_type: s.filing_type,
      filing_datetime: s.filing_datetime,
      source_url: s.source_url,
    }));
    if (dups.length > 0) (winner as any).cross_exchange_dups = dups;
    out.push(winner);
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

function buildThemeClusters(allFilings: ScoredFiling[]): ThemeCluster[] {
  // PATCH 0417 — Per user feedback: Theme Clusters should only count
  // ACTIONABLE companies (ULTRA / BULLISH / MIXED_POSITIVE / BEARISH).
  // NEUTRAL companies dilute the conviction signal — a cluster of 10
  // NEUTRAL companies all mentioning "demand" tells the user nothing
  // useful. With this filter, INSTITUTIONAL conviction now requires
  // 10 actionable companies cross-confirming.
  const filings = allFilings.filter(f =>
    f.bullish.tier && ['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE', 'BEARISH'].includes(f.bullish.tier)
  );
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
