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

const CACHE_KEY = (days: number) => `concall-feed:v13:days:${days}`;  // v13: serialized sub-windows (fixes NSE 429)
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
const MAX_PDF_EXTRACTS_PER_REQUEST = 25;

interface ScoredFiling extends FilingRecord {
  filing_type: ConcallFilingType;
  bullish: BullishScore;
  is_high_bullish: boolean;
  scored_from: 'PDF' | 'SUBJECT';
  pdf_pages?: number;
  pdf_failure_reason?: string;
  sector_overlay?: SectorOverlayResult;   // PATCH 0401
  bottleneck?: BottleneckSignal;          // PATCH 0407 — supply-chain bottleneck detection
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

  // PATCH 0409 — serialize sub-window fetches with concurrency cap of 2.
  // Previous version fired all 6 sub-windows in parallel — NSE
  // rate-limited the burst and returned 429, dropping most filings.
  // Symptom: 180d returned 3924 filings while 14d returned 76566. Now
  // we batch 2 at a time with a 600ms jitter between batches.
  const totalBudgetMs = 14000;            // per sub-window budget (tighter, since serial)
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

  const allResults: Array<Awaited<ReturnType<typeof fetchSubWindow>>> = [];
  for (let i = 0; i < subWindows.length; i += SUBWIN_CONCURRENCY) {
    const batch = subWindows.slice(i, i + SUBWIN_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(w => fetchSubWindow(w.fromIso, w.toIso)));
    allResults.push(...batchResults);
    // Small inter-batch delay so NSE's per-IP rate-limit window resets
    if (i + SUBWIN_CONCURRENCY < subWindows.length) {
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

  // PATCH 0388 — PRIORITY EXTRACTION TIERS for PDF text
  // Transcript and investor presentation get highest priority (most likely
  // to contain rich bullish content). Audio recordings and webcasts get
  // none (no text). Press releases are middle tier.
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

  const extractable = candidates
    .filter(c => PDF_PRIORITY[c.filing_type] <= 3 && c.filing.attachment_urls.length > 0)
    .sort((a, b) => PDF_PRIORITY[a.filing_type] - PDF_PRIORITY[b.filing_type])
    .slice(0, MAX_PDF_EXTRACTS_PER_REQUEST);

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
  for (const { filing: f, filing_type } of candidates) {
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

    const is_high_bullish = isHighBullishRaw(bullish, rawThreshold);
    all.push({
      ...f,
      filing_type,
      bullish,
      is_high_bullish,
      scored_from: scoredFrom,
      pdf_pages: ext?.pages,
      pdf_failure_reason: ext?.failure,
      sector_overlay,
      bottleneck: bottleneck.detected ? bottleneck : undefined,
    });
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
