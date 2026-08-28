// ═══════════════════════════════════════════════════════════════════════════
// zzz433 — TRANSFORMATION SCREENER (batch multibagger radar)
//
// GET /api/v1/concall-intel/transformation-screener
//   ?days=30        window passed through to live-feed (default 30)
//   ?limit=24       max filings to PDF-analyze (default 24, cap 40)
//   ?minPatterns=1  drop names with fewer transformation patterns than this
//
// Runs the deterministic transformation radar (lib/transformation-analyzer)
// over EVERY relevant filing in the concall live-feed, not just the one the
// user pasted. PDF text comes from the same KV cache the live-feed populates
// (pdf-text:v2:<hash>), so most extractions are instant CACHE hits. Ranks
// companies by a composite transformation score so the terminal surfaces the
// early-inflection names automatically. Result cached 30 min per window.
//
// Nothing here changes existing behaviour — it only READS the live-feed and
// the shared analyzer. The single-paste Concall AI flow is untouched.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { railwaySelfFetch } from '@/lib/railway-self-fetch';
import { extractFirstPdf } from '@/lib/pdf-text-extractor';
import { analyzeTransformation } from '@/lib/transformation-analyzer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 12 * 60;               // zzz466 — 12 min (was 30) so new grading appears fast
const CACHE_KEY = (days: number, limit: number) => `transform-screener:v1:${days}:${limit}`;

export interface TransformScreenEntry {
  symbol: string;
  company_name: string;
  exchange: string;
  subject: string;
  filing_datetime: string;
  source_url: string;
  attachment_url: string | null;
  bullish_tier: string;
  // transformation radar
  transformation_score: number;
  pattern_count: number;
  patterns: Array<{ key: string; label: string; emoji: string; hits: number }>;
  evidence_score: number;
  evidence_label: string;
  evidence_quote: string;      // zzz462 — exact proof sentence (verifiability)
  evidence_breadth: number;    // zzz462 — distinct proof rungs that fired (depth)
  stage: number;
  stage_sweet_spot: boolean;
  velocity: string;
  triple: { industry: boolean; company: boolean; financial: boolean; count: number };
  top_events: string[];
  scored_from: 'PDF' | 'SUBJECT';
}

// zzz434 — lightweight record of a filing we scanned that produced no
// transformation signal, so the UI can show "scanned, nothing yet" instead of
// a blank tab in a quiet (off-season) filing period.
export interface ScannedNoSignal {
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  source_url: string;
  attachment_url: string | null;
  bullish_tier: string;
  scored_from: 'PDF' | 'SUBJECT';
}

interface ScreenPayload {
  generated_at: string;
  window_days: number;
  analyzed: number;          // how many filings we actually PDF-analyzed
  pdf_cache_hits: number;
  candidates_total: number;  // relevant filings in feed
  entries: TransformScreenEntry[];
  scanned_no_signal: ScannedNoSignal[];  // zzz434 — analyzed but below the pattern floor
  error?: string;
}

// composite transformation score — mirrors the framework weighting:
// pattern breadth (how many transformation vectors fire), evidence strength
// (how far up the story→evidence ladder), the industry/company/financial
// triple, and a sweet-spot bonus for stages 3-7 (built, ramping, not yet
// fully re-rated).
function transformScore(t: ReturnType<typeof analyzeTransformation>): number {
  // zzz462 — reward proof DEPTH: a story with several evidence rungs firing
  // (capex → facility → production → revenue → margin) is more genuinely proven
  // than one that scored a single high rung off one lucky sentence.
  const breadthBonus = Math.min(t.evidence_breadth || 0, 5) * 2;
  return t.pattern_count * 3 + t.evidence_score + t.triple.count * 2 + (t.stage_sweet_spot ? 4 : 0) + breadthBonus;
}

const emptyPayload = (days: number, error?: string): ScreenPayload => ({
  generated_at: new Date().toISOString(),
  window_days: days,
  analyzed: 0,
  pdf_cache_hits: 0,
  candidates_total: 0,
  entries: [],
  scanned_no_signal: [],
  ...(error ? { error } : {}),
});

export async function GET(req: NextRequest) {
  const days = Math.min(180, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 60));
  const limit = Math.min(150, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 80));
  const minPatterns = Math.max(0, Number(req.nextUrl.searchParams.get('minPatterns')) || 1);
  try {
    return await handle(req, days, limit, minPatterns);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transform-screener] uncaught', msg);
    return NextResponse.json(emptyPayload(days, 'transformation screener temporarily unavailable'));
  }
}

async function handle(req: NextRequest, days: number, limit: number, minPatterns: number) {
  // zzz466 — force-refresh bypass: ?refresh=1 (or ?nocache=1) skips the cache
  // READ so a fresh computation runs immediately (still written back to cache).
  // Lets you see new grading at once instead of waiting out the cache window.
  const sp = req.nextUrl.searchParams;
  const forceFresh = sp.get('refresh') === '1' || sp.get('nocache') === '1';
  // cached?
  if (isRedisAvailable() && !forceFresh) {
    const cached = await kvGet<ScreenPayload>(CACHE_KEY(days, limit));
    if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=600' } });
  }

  const origin = new URL(req.url).origin;
  const r = await railwaySelfFetch(`${origin}/api/v1/concall-intel/live-feed?days=${days}`, { cache: 'no-store' });
  if (!r.ok) return NextResponse.json(emptyPayload(days, `live-feed HTTP ${r.status}`), { status: 200 });
  const data = await r.json();
  const filings: any[] = Array.isArray(data.filings) ? data.filings : [];

  // zzz444 — a real transcript / investor-presentation is where the signal
  // lives; a "management change / AGM / record date" notice is pure noise that
  // wastes the scan budget and pollutes the leaderboard. Detect both so we (a)
  // spend the scan budget on transcripts FIRST and (b) keep obvious notices out
  // of the ranked list.
  const isTranscript = (f: any) => /transcript|earnings call|con\s?call|conference call|investor (?:presentation|meet|update)|analyst (?:meet|call)|results? (?:presentation|call)|q[1-4]\s?fy/i.test(`${f.subject || ''} ${(f.attachment_urls?.[0] || '')}`);
  const isNoiseNotice = (f: any) => /management change|change in (?:management|director|kmp)|record date|book closure|board meeting|annual general meeting|\bAGM\b|postal ballot|voting result|scrutinizer|newspaper (?:publication|advertisement|clipping)|loss of (?:share|certificate)|duplicate (?:share|certificate)|sub[- ]division|stock split|dividend distribution|trading window|compliance certificate|reg\.?\s?74|reconciliation of share/i.test(f.subject || '');

  // zzz463 — FRESHNESS-FIRST scan order so the radar always reads the NEWEST
  // concalls, never gets stuck re-chewing the same old high-tier set. Root fix
  // for "does it read new or the same old 80?": we scan newest DAY first, and
  // within a day put transcripts + high-bullish ahead (quality within freshness).
  // Noise notices (AGM / record date / board meeting …) are dropped from the
  // scan queue entirely so the budget is never spent on them. Because PDF text
  // is cached (pdf-text KV), older filings are near-free to include — so the
  // cold-fetch budget is spent on genuinely NEW filings, newest first.
  const TIER_RANK: Record<string, number> = { ULTRA_BULLISH: 0, BULLISH: 1, MIXED_POSITIVE: 2, NEUTRAL: 3, MIXED_NEGATIVE: 4, BEARISH: 5 };
  const dayOf = (f: any) => { const d = new Date(f.filing_datetime); return isNaN(d.getTime()) ? '0000-00-00' : d.toISOString().slice(0, 10); };
  const withPdf = filings
    .filter((f) => Array.isArray(f.attachment_urls) && f.attachment_urls.length > 0)
    .filter((f) => !isNoiseNotice(f))                       // never waste budget on notices
    .sort((a, b) => {
      const da = dayOf(a), db = dayOf(b);
      if (da !== db) return da < db ? 1 : -1;               // newest day first — guarantees fresh reads
      const ta = isTranscript(a) ? 0 : 1, tb = isTranscript(b) ? 0 : 1;
      if (ta !== tb) return ta - tb;                        // within a day: transcripts first
      const t = (TIER_RANK[a.bullish?.tier] ?? 9) - (TIER_RANK[b.bullish?.tier] ?? 9);
      if (t !== 0) return t;                                // then high-bullish
      return new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime();
    })
    .slice(0, limit);

  let cacheHits = 0;
  const entries: TransformScreenEntry[] = [];

  // Bounded concurrency (8 at a time). A soft time budget stops fresh PDF
  // fetches before maxDuration so a big cold scan degrades gracefully (cached
  // + already-scanned rows still return) instead of timing out.
  const START = Date.now();
  const TIME_BUDGET_MS = 48_000;
  const CONC = 8;
  for (let i = 0; i < withPdf.length; i += CONC) {
    if (Date.now() - START > TIME_BUDGET_MS) break;   // out of time — return what we have
    const batch = withPdf.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (f) => {
      let text = '';
      let scoredFrom: 'PDF' | 'SUBJECT' = 'SUBJECT';
      try {
        const pdf = await extractFirstPdf(f.attachment_urls);
        if (pdf && pdf.text && pdf.text.length > 200) {
          text = pdf.text;
          scoredFrom = 'PDF';
          if (pdf.source === 'CACHE') cacheHits++;
        }
      } catch { /* fall through to subject */ }
      if (!text) text = `${f.company_name || ''} ${f.subject || ''}`;
      const t = analyzeTransformation(text);
      const entry: TransformScreenEntry = {
        symbol: f.symbol,
        company_name: f.company_name,
        exchange: f.exchange,
        subject: f.subject,
        filing_datetime: f.filing_datetime,
        source_url: f.source_url,
        attachment_url: f.attachment_urls?.[0] || null,
        bullish_tier: f.bullish?.tier || 'NEUTRAL',
        transformation_score: transformScore(t),
        pattern_count: t.pattern_count,
        patterns: t.patterns,
        evidence_score: t.evidence_score,
        evidence_label: t.evidence_label,
        evidence_quote: t.evidence_quote,
        evidence_breadth: t.evidence_breadth,
        stage: t.stage,
        stage_sweet_spot: t.stage_sweet_spot,
        velocity: t.velocity,
        triple: t.triple,
        top_events: t.events.slice(0, 8).map((e) => e.kw),
        scored_from: scoredFrom,
      };
      return entry;
    }));
    entries.push(...results);
  }

  // Keep the ones with real transformation signal, best first. Obvious
  // non-earnings notices (management change / AGM / record date …) are kept OUT
  // of the ranking even if their notice text happens to hit a keyword.
  const ranked = entries
    .filter((e) => e.pattern_count >= minPatterns && !isNoiseNotice(e))
    .sort((a, b) => b.transformation_score - a.transformation_score);

  // zzz434 — the rest were scanned but produced no signal (or were notices).
  // Surface a light record so the UI can show "we looked, nothing yet".
  const scannedNoSignal: ScannedNoSignal[] = entries
    .filter((e) => e.pattern_count < minPatterns || isNoiseNotice(e))
    .sort((a, b) => new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime())
    .slice(0, 20)
    .map((e) => ({
      symbol: e.symbol,
      company_name: e.company_name,
      subject: e.subject,
      filing_datetime: e.filing_datetime,
      source_url: e.source_url,
      attachment_url: e.attachment_url,
      bullish_tier: e.bullish_tier,
      scored_from: e.scored_from,
    }));

  const payload: ScreenPayload = {
    generated_at: new Date().toISOString(),
    window_days: days,
    analyzed: withPdf.length,
    pdf_cache_hits: cacheHits,
    candidates_total: filings.length,
    entries: ranked,
    scanned_no_signal: scannedNoSignal,
  };

  if (isRedisAvailable()) {
    try { await kvSet(CACHE_KEY(days, limit), payload, CACHE_TTL); } catch { /* best effort */ }
  }
  return NextResponse.json(payload, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=1800' } });
}
