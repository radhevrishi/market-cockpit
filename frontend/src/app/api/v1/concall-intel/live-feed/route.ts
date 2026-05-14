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

const CACHE_KEY = (days: number) => `concall-feed:v3:days:${days}`;   // v3: section extraction + sentence-level scoring + cross-exchange dedup
const CACHE_TTL_SHORT = 5 * 60;        // 5 min for fresh data
const CACHE_TTL_LONG = 30 * 60;        // 30 min for older lookback

// PATCH 0388 — extract PDFs in parallel for top N most-recent filings.
// Pure subject-line scoring was producing 0 high-bullish on user's 681
// relevant filings because subjects like "Transcript of Q2 Earnings Call"
// don't contain guidance/order-book/margin keywords. Bullish content is
// inside the PDF.
// Budget: Vercel maxDuration 45s, each PDF takes 2-5s with cache, ~10
// PDFs in parallel is safe. Cached PDFs hit instantly.
const MAX_PDF_EXTRACTS_PER_REQUEST = 12;

interface ScoredFiling extends FilingRecord {
  filing_type: ConcallFilingType;
  bullish: BullishScore;
  is_high_bullish: boolean;
  scored_from: 'PDF' | 'SUBJECT';
  pdf_pages?: number;
  pdf_failure_reason?: string;
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
export const maxDuration = 60;  // PATCH 0388: extended for PDF extraction budget

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
    const is_high_bullish = isHighBullishRaw(bullish, rawThreshold);
    all.push({
      ...f,
      filing_type,
      bullish,
      is_high_bullish,
      scored_from: scoredFrom,
      pdf_pages: ext?.pages,
      pdf_failure_reason: ext?.failure,
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

  const payload: FeedPayload = {
    generated_at: new Date().toISOString(),
    count_total: merged.size,
    count_relevant: deduped.length,
    count_high_bullish: deduped.filter(x => x.is_high_bullish).length,
    filings: deduped,
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
