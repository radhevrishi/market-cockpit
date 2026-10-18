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
import { swrGet, swrHeaders, privateCache, SwrUnusableError, SwrPendingError } from '@/lib/swr-cache';
import { railwaySelfFetch } from '@/lib/railway-self-fetch';
import { extractFirstPdf } from '@/lib/pdf-text-extractor';
import { analyzeTransformation } from '@/lib/transformation-analyzer';
import { classifyConcallFiling, type FeedStatus } from '@/lib/concall-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 12 * 60;               // zzz466 — 12 min (was 30) so new grading appears fast
// zzz475 — BUMP this version string whenever the analyzer grading/quote logic
// changes. The Redis cache survives redeploys, so without a version bump a code
// fix keeps serving the OLD graded results until the 12-min TTL lapses or the user
// force-refreshes — which is why fixed quotes appeared "still broken". A new
// version orphans the stale entries so the very next request recomputes fresh.
// zzz810 — v4: payload carries feed_status; cached empties from the broken feed are orphaned.
// zzz855: the cache now lives in lib/swr-cache under transform-screener:swr:v4:<days>:<limit>:<minPatterns>.

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
  caution_level: number;       // zzz467 — 0 none / 1 mixed / 2 cautious (guidance cut / negatives)
  caution_flags: string[];     // zzz467 — the negatives found
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
  // zzz810 — the live feed's own honest status (could not fetch vs nothing
  // filed), plus how many of the feed rows are real concalls / transcripts.
  feed_status?: FeedStatus | null;
  concalls_in_feed?: number;
  transcripts_in_feed?: number;
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
  // zzz467 — caution haircut: a guidance-cut / cautious concall sinks in the
  // leaderboard even if a positive keyword fired (real-analyst behaviour).
  const cautionPenalty = t.caution_level >= 2 ? 12 : t.caution_level === 1 ? 5 : 0;
  return t.pattern_count * 3 + t.evidence_score + t.triple.count * 2 + (t.stage_sweet_spot ? 4 : 0) + breadthBonus - cautionPenalty;
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

// zzz855 — stale-while-revalidate. A scan (live-feed read + up to 80 PDF analyses) took ~4.4 s even warm-ish and up to
// 48 s cold, and ran on the reader's clock whenever the 12-min KV entry lapsed. Now the last good scan is served at once
// (its generated_at is the age label; x-mc-cache / x-mc-cache-age headers too) while ONE background rescan runs.
// ?refresh=1 / ?nocache=1 still rescans synchronously (the cron warmer uses it). A scan of a failed / empty feed is
// never cached (zzz810 rule) and never replaces the last good scan. minPatterns is now part of the key (the old key
// ignored it, so a request with a different floor could be served another floor's result).
const SCREEN_FRESH_MS = CACHE_TTL * 1000;
// zzz1070 — last good scan kept 7 days (was 24 h: off-season, a day without a reader meant the next open scanned cold), and a
// cold scan is awaited at most SCREEN_WAIT_MS: past it the reader gets an honest "building" answer (`building: true`) while the
// scan finishes in the background and is served on the next ask. It used to hang the home page for 70 s+ ("radar returned nothing").
const SCREEN_MAX_STALE_MS = 7 * 24 * 3_600_000;
const SCREEN_WAIT_MS = 9_000;
type Built = { payload: ScreenPayload; cacheable: boolean };
async function handle(req: NextRequest, days: number, limit: number, minPatterns: number) {
  const sp = req.nextUrl.searchParams;
  const forceFresh = sp.get('refresh') === '1' || sp.get('nocache') === '1';
  try {
    const r = await swrGet<Built>({
      key: `transform-screener:swr:v4:${days}:${limit}:${minPatterns}`, freshMs: SCREEN_FRESH_MS, maxStaleMs: SCREEN_MAX_STALE_MS, force: forceFresh,
      build: () => buildScreen(req, days, limit, minPatterns, forceFresh),
      isUsable: (b) => !!b && b.cacheable,
      waitMs: forceFresh ? undefined : SCREEN_WAIT_MS,
    });
    return NextResponse.json(r.value.payload, { headers: swrHeaders(r, privateCache(120, 1800)) });
  } catch (e) {
    if (e instanceof SwrPendingError) {
      return NextResponse.json({ ...emptyPayload(days), building: true, error: undefined, message: 'Scanning the latest concalls — ask again in a minute' }, { headers: { 'Cache-Control': 'no-store', 'x-mc-cache': 'building' } });
    }
    if (e instanceof SwrUnusableError && (e.value as Built | undefined)?.payload) return NextResponse.json((e.value as Built).payload);
    throw e;
  }
}

async function buildScreen(req: NextRequest, days: number, limit: number, minPatterns: number, forceFresh: boolean): Promise<Built> {
  const origin = new URL(req.url).origin;
  // zzz810 — a forced Rescan also forces the feed, so an empty/failed feed
  // is re-fetched from NSE/BSE instead of re-read from cache.
  // zzz1070 — never wait on the feed forever (Railway does not enforce maxDuration): 45 s, then a "couldn't load" scan (not cached).
  let r: Response;
  try {
    r = await railwaySelfFetch(`${origin}/api/v1/concall-intel/live-feed?days=${days}${forceFresh ? '&force=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
  } catch (e: any) {
    return { payload: emptyPayload(days, `Couldn't load the concall feed (${e?.name === 'TimeoutError' ? 'timed out' : 'unreachable'}) — retrying`), cacheable: false };
  }
  if (!r.ok) return { payload: emptyPayload(days, `Couldn't load the concall feed (live-feed HTTP ${r.status}) — retrying`), cacheable: false };
  const data = await r.json();
  const filings: any[] = Array.isArray(data.filings) ? data.filings : [];
  const feedStatus: FeedStatus | null = data.fetch_status ?? null;
  if (data.error && filings.length === 0) {
    return { payload: { ...emptyPayload(days, `Couldn't load the concall feed (${data.error}) — retrying`), feed_status: feedStatus }, cacheable: false };
  }
  let concallsInFeed = 0, transcriptsInFeed = 0;
  for (const f of filings) {
    const c = classifyConcallFiling(f.subject || '', f.detail);
    if (c.is_concall || c.kind === 'INVESTOR_PRESENTATION') concallsInFeed++;
    if (c.is_transcript && c.is_concall) transcriptsInFeed++;
  }

  // zzz444 — a real transcript / investor-presentation is where the signal
  // lives; a "management change / AGM / record date" notice is pure noise that
  // wastes the scan budget and pollutes the leaderboard. Detect both so we (a)
  // spend the scan budget on transcripts FIRST and (b) keep obvious notices out
  // of the ranked list.
  const isTranscript = (f: any) => f.filing_type === 'TRANSCRIPT' || classifyConcallFiling(f.subject || '', f.detail).is_concall || /transcript|earnings call|con\s?call|conference call|investor (?:presentation|meet|update)|analyst (?:meet|call)|results? (?:presentation|call)|q[1-4]\s?fy/i.test(`${f.subject || ''} ${(f.attachment_urls?.[0] || '')}`);
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
        caution_level: t.caution_level,
        caution_flags: t.caution_flags,
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
    feed_status: feedStatus,
    concalls_in_feed: concallsInFeed,
    transcripts_in_feed: transcriptsInFeed,
  };

  // zzz810 — never cache a scan of a feed that failed or came back empty;
  // the next open must retry the exchanges, not replay "0 in feed".
  // zzz1070 — PARTIAL with NSE itself OK (BSE down / empty, e.g. 18 Oct 2026: NSE 30,597 announcements, BSE none) is a real scan
  // and is kept (its feed_status says BSE is missing and being retried); otherwise every visit rescanned for 6–48 s.
  const nseOk = feedStatus?.nse === 'OK';
  const feedHealthy = filings.length > 0 && (!feedStatus || feedStatus.state === 'OK' || feedStatus.state === 'EMPTY' || (feedStatus.state === 'PARTIAL' && nseOk));
  return { payload, cacheable: feedHealthy };
}
