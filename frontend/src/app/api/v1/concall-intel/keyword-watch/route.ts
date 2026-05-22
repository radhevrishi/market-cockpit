// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0394 — Keyword Watch endpoint
//
// GET /api/v1/concall-intel/keyword-watch
//   ?days=14           lookback
//   ?keywords=margin-pressure,guidance-cut   comma-separated keyword ids
//                                            (omit = all keywords)
//   ?groups=RISK,THEME                       comma-separated group filter
//                                            (omit = all groups)
//   ?force=1
//
// Scans NSE/BSE concall-relevant filings, extracts PDFs, sanitizes, then
// finds every sentence containing any selected keyword. Returns filings
// + per-filing list of hits.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { fetchNSEAnnouncements, fetchBSEAnnouncements, type FilingRecord } from '@/lib/nse-bse-feed';
import { extractFirstPdf } from '@/lib/pdf-text-extractor';
import { extractSections } from '@/lib/concall-sections';
import { classifyFiling, type ConcallFilingType } from '@/lib/concall-bullish';
import { findKeywordHits, summarizeHits, KEYWORD_CATALOG, type KeywordHit, type KeywordGroup } from '@/lib/concall-keyword-watch';

const CACHE_KEY = (days: number) => `keyword-watch:v1:days:${days}`;
const CACHE_TTL_SHORT = 5 * 60;
const CACHE_TTL_LONG = 30 * 60;
const MAX_PDF_EXTRACTS = 30;  // higher than live-feed since this is the ONLY thing we do here

interface KeywordWatchFiling extends FilingRecord {
  filing_type: ConcallFilingType;
  hits: KeywordHit[];
  hit_keywords: string[];          // unique keyword IDs matched in this filing
  hit_groups: KeywordGroup[];      // unique groups matched
  hit_count: number;
}

interface KeywordWatchPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_matched: number;
  filings: KeywordWatchFiling[];
  totals: ReturnType<typeof summarizeHits>;
  sources: { nse: string; bse: string };
  catalog: typeof KEYWORD_CATALOG;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    return await handleKeywordWatch(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[keyword-watch] uncaught error', msg);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      count_total: 0, count_relevant: 0, matched_count: 0, total_hits: 0,
      filings: [], group_counts: {},
      sources: { nse: 'NSE_BLOCKED', bse: 'BSE_BLOCKED' },
      error: `keyword-watch failed: ${msg.slice(0, 200)}`,
    });
  }
}

async function handleKeywordWatch(req: NextRequest) {
  // PATCH 0405 — bumped 60 → 90 days for full-quarter view
  // PATCH 0407 — bumped 90 → 180 days for historical signal validation
  const days = Math.min(180, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '14')));
  const keywordsParam = (req.nextUrl.searchParams.get('keywords') || '').trim();
  const groupsParam = (req.nextUrl.searchParams.get('groups') || '').trim();
  const force = req.nextUrl.searchParams.get('force') === '1';

  const selectedKeywords = keywordsParam ? new Set(keywordsParam.split(',').map(s => s.trim()).filter(Boolean)) : null;
  const selectedGroups = groupsParam ? new Set(groupsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) as KeywordGroup[]) : null;

  // Effective keyword set after applying group filter
  let effectiveSet: Set<string> | null = selectedKeywords;
  if (selectedGroups) {
    const fromGroups = new Set(KEYWORD_CATALOG.filter(k => selectedGroups.has(k.group)).map(k => k.id));
    effectiveSet = selectedKeywords
      ? new Set([...Array.from(selectedKeywords)].filter(id => fromGroups.has(id)))
      : fromGroups;
  }

  const cacheKey = CACHE_KEY(days);
  if (!force && isRedisAvailable()) {
    const cached = await kvGet<KeywordWatchPayload>(cacheKey);
    if (cached) {
      return NextResponse.json(applyKeywordFilter(cached, effectiveSet));
    }
  }

  // PATCH 0408 — Long-window chunked fetch (NSE caps per-call rows so
  // 180d one-shot drops older filings). 30-day sub-windows in parallel.
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
  if (isRedisAvailable()) {
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
  // PATCH 0416 — null-guard against malformed cache entries
  for (const hit of subwinCacheHits) {
    if (!hit || !hit.nse || !hit.bse || !Array.isArray(hit.nse.filings) || !Array.isArray(hit.bse.filings)) continue;
    allResults.push([hit.nse, hit.bse]);
  }
  for (let i = 0; i < subwinMisses.length; i += SUBWIN_CONCURRENCY) {
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

  // Filter to concall-relevant filings only
  const candidates: Array<{ filing: FilingRecord; filing_type: ConcallFilingType }> = [];
  for (const f of merged.values()) {
    const ft = classifyFiling(f.subject);
    if (!ft) continue;
    candidates.push({ filing: f, filing_type: ft });
  }
  candidates.sort((a, b) => new Date(b.filing.filing_datetime).getTime() - new Date(a.filing.filing_datetime).getTime());

  // Extract PDFs for top candidates with attachments
  const PDF_PRIORITY: Record<ConcallFilingType, number> = {
    TRANSCRIPT: 1, INVESTOR_PRESENTATION: 1, RESULTS_PRESENTATION: 1,
    PRESS_RELEASE: 2, CONCALL_INVITE: 3, ANALYST_MEET: 3,
    AUDIO_RECORDING: 9, WEBCAST: 9,
    // PATCH 0669 — Reg-30 / Reg-15 categories. Subject line carries the
    // signal; skip PDF extraction (priority 9) for keyword-watch flow.
    ORDER_RECEIPT: 9, RATING_ACTION: 9,
    // PATCH 0713 — new event-driven categories. Subject line carries the
    // signal; skip PDF extraction for keyword-watch flow.
    CAPEX_ANNOUNCE: 9, BUYBACK_ANNOUNCE: 9, PROMOTER_TXN: 9,
    BLOCK_DEAL: 9, MA_EVENT: 9, GOVERNANCE: 9, USFDA_EVENT: 9,
  };
  const extractable = candidates
    .filter(c => PDF_PRIORITY[c.filing_type] <= 3 && c.filing.attachment_urls.length > 0)
    .sort((a, b) => PDF_PRIORITY[a.filing_type] - PDF_PRIORITY[b.filing_type])
    .slice(0, MAX_PDF_EXTRACTS);

  const extracts = new Map<string, string>();
  if (extractable.length > 0) {
    const results = await Promise.allSettled(
      extractable.map(async (c) => {
        const ext = await extractFirstPdf(c.filing.attachment_urls);
        return { hash: c.filing.content_hash, text: ext?.text || '' };
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.text) extracts.set(r.value.hash, r.value.text);
    }
  }

  // Scan all candidates with keyword detector. Use PDF text where available,
  // subject only otherwise.
  const all: KeywordWatchFiling[] = [];
  for (const { filing: f, filing_type } of candidates) {
    const pdfText = extracts.get(f.content_hash) || '';
    const scanText = pdfText.length > 200
      ? `${f.subject}\n\n${extractSections(pdfText).forward_text}`
      : f.subject;
    const hits = findKeywordHits(scanText);   // all keywords; filter at response time
    if (hits.length === 0) continue;
    const hitKeywords = Array.from(new Set(hits.map(h => h.keyword_id)));
    const hitGroups = Array.from(new Set(hits.map(h => h.group)));
    all.push({
      ...f,
      filing_type,
      hits,
      hit_keywords: hitKeywords,
      hit_groups: hitGroups,
      hit_count: hits.length,
    });
  }

  // Sort by hit count desc, then by recency
  all.sort((a, b) => {
    if (b.hit_count !== a.hit_count) return b.hit_count - a.hit_count;
    return new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime();
  });

  const totals = summarizeHits(all.flatMap(f => f.hits));

  const payload: KeywordWatchPayload = {
    generated_at: new Date().toISOString(),
    count_total: merged.size,
    count_relevant: candidates.length,
    count_matched: all.length,
    filings: all,
    totals,
    sources: { nse: nseResult.source, bse: bseResult.source },
    catalog: KEYWORD_CATALOG,
  };

  if (isRedisAvailable()) {
    const ttl = days <= 3 ? CACHE_TTL_SHORT : CACHE_TTL_LONG;
    await kvSet(cacheKey, payload, ttl);
  }

  return NextResponse.json(applyKeywordFilter(payload, effectiveSet));
}

function applyKeywordFilter(payload: KeywordWatchPayload, effectiveSet: Set<string> | null): KeywordWatchPayload {
  if (!effectiveSet || effectiveSet.size === KEYWORD_CATALOG.length) return payload;
  const filings = payload.filings
    .map(f => {
      const hits = f.hits.filter(h => effectiveSet.has(h.keyword_id));
      if (hits.length === 0) return null;
      return {
        ...f,
        hits,
        hit_keywords: Array.from(new Set(hits.map(h => h.keyword_id))),
        hit_groups: Array.from(new Set(hits.map(h => h.group))),
        hit_count: hits.length,
      };
    })
    .filter((f): f is KeywordWatchFiling => f !== null);
  filings.sort((a, b) => b.hit_count - a.hit_count);
  return {
    ...payload,
    filings,
    count_matched: filings.length,
    totals: summarizeHits(filings.flatMap(f => f.hits)),
  };
}
