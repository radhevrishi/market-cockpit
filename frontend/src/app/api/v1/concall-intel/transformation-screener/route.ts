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

const CACHE_TTL = 30 * 60;               // 30 min
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
  return t.pattern_count * 3 + t.evidence_score + t.triple.count * 2 + (t.stage_sweet_spot ? 4 : 0);
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
  const limit = Math.min(40, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 24));
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
  // cached?
  if (isRedisAvailable()) {
    const cached = await kvGet<ScreenPayload>(CACHE_KEY(days, limit));
    if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=1800' } });
  }

  const origin = new URL(req.url).origin;
  const r = await railwaySelfFetch(`${origin}/api/v1/concall-intel/live-feed?days=${days}`, { cache: 'no-store' });
  if (!r.ok) return NextResponse.json(emptyPayload(days, `live-feed HTTP ${r.status}`), { status: 200 });
  const data = await r.json();
  const filings: any[] = Array.isArray(data.filings) ? data.filings : [];

  // Prioritise: high-bullish first, then most recent. These are the ones the
  // live-feed most likely already PDF-parsed (so cache hits), and the ones
  // most worth reading. Only filings with an attachment can be text-analyzed.
  const TIER_RANK: Record<string, number> = { ULTRA_BULLISH: 0, BULLISH: 1, MIXED_POSITIVE: 2, NEUTRAL: 3, MIXED_NEGATIVE: 4, BEARISH: 5 };
  const withPdf = filings
    .filter((f) => Array.isArray(f.attachment_urls) && f.attachment_urls.length > 0)
    .sort((a, b) => {
      const t = (TIER_RANK[a.bullish?.tier] ?? 9) - (TIER_RANK[b.bullish?.tier] ?? 9);
      if (t !== 0) return t;
      return new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime();
    })
    .slice(0, limit);

  let cacheHits = 0;
  const entries: TransformScreenEntry[] = [];

  // Bounded concurrency (6 at a time) so we stay under maxDuration even when
  // some PDFs miss cache and must be fetched fresh.
  const CONC = 6;
  for (let i = 0; i < withPdf.length; i += CONC) {
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

  // Keep the ones with real transformation signal, best first.
  const ranked = entries
    .filter((e) => e.pattern_count >= minPatterns)
    .sort((a, b) => b.transformation_score - a.transformation_score);

  // zzz434 — the rest were scanned but produced no signal. Surface a light
  // record so the UI can show "we looked, nothing yet" in quiet periods.
  const scannedNoSignal: ScannedNoSignal[] = entries
    .filter((e) => e.pattern_count < minPatterns)
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
