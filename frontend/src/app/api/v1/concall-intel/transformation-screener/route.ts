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
import { createHash } from 'crypto';
import { extractPdfText } from '@/lib/pdf-text-extractor';
import { analyzeTransformation, TRANSFORM_PATTERNS, EVIDENCE_LADDER } from '@/lib/transformation-analyzer';
import { kvMGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { secretFromRequest } from '@/lib/request-secret';
import { parseTranscript, speakerOf, documentTone, tierFromTone, type DocTone } from '@/lib/radar-speakers';
import { radarInsight, orderValueCr, type RadarFacts, type RadarInsight } from '@/lib/radar-insight';
import { radarDecision } from '@/lib/concall-radar-decision';
import { assessRadarQuote } from '@/lib/concall-radar-decision';
import {
  preClassifyRadarFiling, shouldReadRadarDoc, classifyRadarContent, isRetryableFailure, emptyFunnel, coverageSentence,
  type RadarDocVerdict, type RadarFunnel, type RadarDocClass,
} from '@/lib/radar-doc-class';
import { buildRadarEvidenceRecord, type RadarEvidenceRecord } from '@/lib/concall-evidence-ledger';
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
// v5: guidance-cut context and action triage changed. Invalidate v4 so stale scores cannot survive release.
// zzz855: the cache now lives in lib/swr-cache under transform-screener:swr:v6:<days>:<limit>:<minPatterns>.

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
  evidence_record: RadarEvidenceRecord;
  /** zzz1212 — what the attached document really is (transcript / presentation / results), decided from its text */
  doc_class?: RadarDocClass;
  doc_label?: string;
  doc_confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  /** zzz1214 — management tone of the document (pos / neg phrase counts) and where the sentiment tier came from */
  tone?: DocTone; tone_pos?: number; tone_neg?: number; tier_source?: 'feed' | 'document';
  /** zzz1214 — who said the evidence quote; COMPANY = the company's own presentation / results document */
  quote_role?: 'MANAGEMENT' | 'ANALYST' | 'COMPANY' | 'UNKNOWN'; quote_speaker?: string | null;
  /** zzz1214 — transcript split into speakers (only management text was scored) */
  speakers_parsed?: boolean; analyst_share?: number | null;
  /** zzz1214 — market data and the cross-period / valuation verdicts (filled at scan time, not stored per document) */
  market_cap_cr?: number | null; facts?: RadarFacts; insight?: RadarInsight;
  /** zzz1216 — largest order / order-book value management states (₹ crore), for materiality */
  order_value_cr?: number | null;
  /** zzz1219 — one company, one dossier: this company's other documents in the window, newest first */
  more_docs?: RadarDocRef[];
}

/** zzz1219 — another document of the same company (dated evidence record under the company's dossier). */
export interface RadarDocRef {
  filing_datetime: string; doc_label?: string; evidence_label: string; evidence_quote: string;
  quote_speaker?: string | null; quote_role?: string | null; source_url: string; attachment_url: string | null;
  lane?: string; best?: boolean; proof?: string;
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
  /** zzz1212 — read in full, no transformation pattern (only substantive documents land here now) */
  doc_class?: RadarDocClass;
  doc_label?: string;
}

/** zzz1212 — a filing the radar did not score, with the honest reason (routine notice, covering letter, unreadable PDF …). */
export interface RadarExcluded {
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  attachment_url: string | null;
  doc_class: RadarDocClass;
  label: string;
  reason: string;
  basis: 'SUBJECT' | 'CONTENT';
  link?: string;
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
  /** zzz1212 — honest processing funnel: what was in the feed, what was routine, what was really read */
  funnel?: RadarFunnel;
  coverage_note?: string;
  /** zzz1212 — newest documents NOT scored, each with its reason (max 80) */
  excluded?: RadarExcluded[];
  /** zzz1212 — counts of excluded documents per class */
  excluded_counts?: Partial<Record<RadarDocClass, number>>;
  error?: string;
  /** zzz1219 — unique companies with a signal in the window, and documents behind them */
  companies?: number;
  signal_documents?: number;
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
  funnel: emptyFunnel(),
  generated_at: new Date().toISOString(),
  window_days: days,
  analyzed: 0,
  pdf_cache_hits: 0,
  candidates_total: 0,
  entries: [],
  scanned_no_signal: [],
  ...(error ? { error } : {}),
});

// zzz1212 — every eligible document's result (its class + the scored entry) is remembered per attachment URL, so
// coverage GROWS across scans instead of re-reading the same newest 80: a scan reuses all stored results (cheap
// MGETs) and spends its download budget only on documents not read yet, newest first. The key carries a fingerprint
// of the analyzer + classifier code, so a rule change re-scores everything (PDF text itself stays cached 30 days).
// zzz1217 — the fingerprint used to hash the analyzer functions' compiled text (fn.toString()). The production bundle
// renames module references on every deploy, so EVERY deploy changed the key and threw away all stored reads (coverage
// fell from 457 to 63 documents after a one-line deploy). Now: a hand-bumped rules version + the pattern data only.
// BUMP RADAR_RULES_VERSION whenever analyzeTransformation, classifyRadarContent, parseTranscript, documentTone,
// assessRadarQuote, buildRadarEvidenceRecord or orderValueCr change what a document scores.
const RADAR_RULES_VERSION = 'r1217';
const ANALYZER_FP = createHash('sha256').update([
  RADAR_RULES_VERSION,
  JSON.stringify(TRANSFORM_PATTERNS.map((p) => [p.key, p.re.source])), JSON.stringify(EVIDENCE_LADDER.map((r) => [r.score, r.re.source])),
].join('|')).digest('hex').slice(0, 10);
const DOC_KEY = (url: string) => `radar-doc:v1:${ANALYZER_FP}:${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
const DOC_TTL_S = 75 * 24 * 3600;           // longer than the widest window used (60–120 days)
const DOC_TTL_TOO_LARGE_S = 14 * 24 * 3600;
const DOC_TTL_UNREADABLE_S = 24 * 3600;
const READ_MAX_BYTES = 25 * 1024 * 1024;    // presentations are 5–11 MB; pdf-parse reads a 10 MB deck in < 1 s
interface DocResult { v: RadarDocVerdict; entry?: TransformScreenEntry; at: string }

/** Download budget per scan: a reader's background refresh, a manual "read next batch", or the scheduled coverage job. */
type ScanMode = { feedForce: boolean; readBudget: number; timeBudgetMs: number };
const MODE_READER: ScanMode = { feedForce: false, readBudget: 60, timeBudgetMs: 30_000 };
const MODE_MORE: ScanMode = { feedForce: false, readBudget: 40, timeBudgetMs: 30_000 };
const MODE_COVERAGE: ScanMode = { feedForce: false, readBudget: 150, timeBudgetMs: 50_000 };
const MODE_FRESH: ScanMode = { feedForce: true, readBudget: 60, timeBudgetMs: 30_000 };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = Math.min(180, Math.max(1, Number(sp.get('days')) || 60));
  // zzz1212 — `limit` now only trims the RESPONSE (best-ranked first); what is read is decided by the scan mode.
  const limit = Math.min(1000, Math.max(1, Number(sp.get('limit')) || 80));
  const minPatterns = Math.max(0, Number(sp.get('minPatterns')) || 1);
  const coverage = sp.get('coverage') === '1';
  if (coverage) {
    const expected = process.env.CRON_SECRET || '';
    if (!expected || secretFromRequest(req, sp) !== expected) return NextResponse.json({ error: 'service key required' }, { status: 401 });
  }
  try {
    return await handle(req, days, limit, minPatterns, coverage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transform-screener] uncaught', msg);
    return NextResponse.json(emptyPayload(days, 'transformation screener temporarily unavailable'));
  }
}

// zzz855 — stale-while-revalidate: the last good scan is served at once while ONE background rescan runs.
// zzz1070 — last good scan kept 7 days; a cold scan is awaited at most SCREEN_WAIT_MS, then "building".
// zzz1212 — one cache entry per window (+ pattern floor). ?more=1 (the page's "read next batch") and ?coverage=1 (the
// scheduled job) force a rebuild that reads further unread documents; ?refresh=1 also re-fetches the exchange feed.
const SCREEN_FRESH_MS = CACHE_TTL * 1000;
const SCREEN_MAX_STALE_MS = 7 * 24 * 3_600_000;
const SCREEN_WAIT_MS = 9_000;
const COVERAGE_EXTRA_WAIT_MS = 100_000;
type Built = { payload: ScreenPayload; cacheable: boolean };
async function handle(req: NextRequest, days: number, limit: number, minPatterns: number, coverage: boolean) {
  const sp = req.nextUrl.searchParams;
  const fresh = sp.get('refresh') === '1' || sp.get('nocache') === '1';
  const more = sp.get('more') === '1';
  const mode = coverage ? MODE_COVERAGE : fresh ? MODE_FRESH : more ? MODE_MORE : MODE_READER;
  // zzz1217 — every window up to 90 days is cut from ONE 90-day scan (the one the coverage job keeps warm), so
  // switching 60d → 7d is instant instead of a cold exchange-feed fetch that can time out and show nothing.
  const scanDays = baseScanDays(days);
  try {
    const r = await swrGet<Built>({
      key: `transform-screener:swr:v9:${scanDays}:${minPatterns}`, freshMs: SCREEN_FRESH_MS, maxStaleMs: SCREEN_MAX_STALE_MS, force: fresh || more || coverage,
      build: () => buildScreen(req, scanDays, minPatterns, mode),
      isUsable: (b) => !!b && b.cacheable,
      waitMs: SCREEN_WAIT_MS + (coverage ? COVERAGE_EXTRA_WAIT_MS : 0),   // the scheduled job may wait for its own scan
      readWaitMs: 2_000, // 18s browser budget also includes Redis; avoid unbounded cold lookup
      failureRetryMs: 5 * 60_000, // feed failures retry at most once per 5 min per instance; never discard last-good
    });
    const p = companyDossiers(windowPayload(r.value.payload, days, scanDays));
    const out: ScreenPayload = p.entries.length > limit ? { ...p, entries: p.entries.slice(0, limit) } : p;
    return NextResponse.json(out, { headers: swrHeaders(r, privateCache(120, 1800)) });
  } catch (e) {
    if (e instanceof SwrPendingError) {
      return NextResponse.json({ ...emptyPayload(days), building: true, error: undefined, message: 'Scanning the latest concalls — ask again in a minute' }, { headers: { 'Cache-Control': 'no-store', 'x-mc-cache': 'building' } });
    }
    if (e instanceof SwrUnusableError && (e.value as Built | undefined)?.payload) return NextResponse.json(companyDossiers(windowPayload((e.value as Built).payload, days, scanDays)));
    throw e;
  }
}

/** zzz1219 — one company, one dossier. Entries arrive ranked (best first); the first entry of each company is its headline
 *  document and every later document of that company is kept underneath as a dated evidence record. */
function companyDossiers(p: ScreenPayload): ScreenPayload {
  const byCo = new Map<string, TransformScreenEntry>();
  const order: TransformScreenEntry[] = [];
  for (const e of p.entries) {
    const k = String(e.symbol || e.company_name || '').toUpperCase();
    const head = byCo.get(k);
    if (!head) { const c = { ...e, more_docs: [] as RadarDocRef[] }; byCo.set(k, c); order.push(c); continue; }
    head.more_docs!.push({
      filing_datetime: e.filing_datetime, doc_label: e.doc_label, evidence_label: e.evidence_label, evidence_quote: e.evidence_quote,
      quote_speaker: e.quote_speaker ?? null, quote_role: e.quote_role ?? null, source_url: e.source_url, attachment_url: e.attachment_url,
      lane: e.insight?.lane, best: !!e.insight?.best, proof: e.insight?.proof?.reason,
    });
  }
  for (const c of order) c.more_docs = (c.more_docs || []).sort((a, b) => String(b.filing_datetime).localeCompare(String(a.filing_datetime))).slice(0, 10);
  return { ...p, entries: order, companies: order.length, signal_documents: p.entries.length };
}

/** zzz1217 — the scan that serves a window: 90 days for any window up to 90, else the window itself. */
function baseScanDays(days: number): number { return days <= 90 ? 90 : days; }

/** zzz1217 — cut a longer scan down to the asked window (by filing date). Counts in the funnel stay those of the scan. */
function windowPayload(p: ScreenPayload, days: number, scanDays: number): ScreenPayload {
  if (days >= scanDays) return p;
  const from = Date.now() - days * 86_400_000;
  const inWin = (d: string) => { const t = new Date(d).getTime(); return Number.isFinite(t) && t >= from; };
  const entries = p.entries.filter((e) => inWin(e.filing_datetime));
  const note = `Last ${days} days of the ${scanDays}-day scan: ${entries.length} companies with a signal in this window. Reading counts above cover the full ${scanDays} days.`;
  return {
    ...p,
    window_days: days,
    entries,
    scanned_no_signal: p.scanned_no_signal.filter((e) => inWin(e.filing_datetime)),
    excluded: p.excluded?.filter((e) => inWin(e.filing_datetime)),
    coverage_note: p.coverage_note ? `${p.coverage_note} ${note}` : note,
  };
}

const PRE_ORDER: Partial<Record<RadarDocClass, number>> = { TRANSCRIPT: 0, PRESENTATION: 1, RESULTS: 2 };

async function readDocResults(urls: string[]): Promise<Map<string, DocResult>> {
  const out = new Map<string, DocResult>();
  if (!isRedisAvailable() || urls.length === 0) return out;
  for (let i = 0; i < urls.length; i += 100) {
    const chunk = urls.slice(i, i + 100);
    try {
      const got = await kvMGet<DocResult>(chunk.map(DOC_KEY));
      got.forEach((v, j) => { if (v && v.v && v.v.cls) out.set(chunk[j], v); });
    } catch { /* unread: these documents are simply read again */ }
  }
  return out;
}

const PENDING_TIERS = new Set(['', 'DATA_PENDING', 'PENDING', 'UNKNOWN']);
/** The feed's sentiment tier when it really graded the filing, else null. */
const feedTier = (f: any): string | null => { const t = String(f?.bullish?.tier || '').toUpperCase(); return PENDING_TIERS.has(t) ? null : t; };

function scoreEntry(f: any, text: string, v: RadarDocVerdict): TransformScreenEntry {
  // zzz1214 — in a transcript only MANAGEMENT turns are scored; analyst questions never become proof
  const isTranscript = v.cls === 'TRANSCRIPT';
  const parse = isTranscript ? parseTranscript(text) : null;
  const scoring = parse?.ok ? parse.managementText : text;
  const t = analyzeTransformation(scoring);
  const tone = documentTone(scoring);
  let role: TransformScreenEntry['quote_role'] = isTranscript ? 'UNKNOWN' : 'COMPANY';
  let speaker: string | null = null;
  if (isTranscript && parse?.ok && t.evidence_quote) {
    const who = speakerOf(t.evidence_quote, text, parse);
    role = who.role === 'MANAGEMENT' ? 'MANAGEMENT' : who.role === 'ANALYST' ? 'ANALYST' : 'UNKNOWN';
    speaker = who.speaker;
    if (role === 'UNKNOWN') role = 'MANAGEMENT';   // the quote was taken from management-only text
  } else if (isTranscript && assessRadarQuote(t.evidence_quote).quality === 'QUESTION') role = 'ANALYST';
  const tier = feedTier(f);
  return {
    symbol: f.symbol,
    company_name: f.company_name,
    exchange: f.exchange,
    subject: f.subject,
    filing_datetime: f.filing_datetime,
    source_url: f.source_url,
    attachment_url: f.attachment_urls?.[0] || null,
    bullish_tier: tier ?? tierFromTone(tone.tone),
    tier_source: tier ? 'feed' : 'document',
    tone: tone.tone, tone_pos: tone.pos, tone_neg: tone.neg,
    quote_role: role, quote_speaker: speaker,
    speakers_parsed: parse ? parse.ok : undefined,
    order_value_cr: orderValueCr(scoring),
    analyst_share: parse?.ok ? Math.round((100 * parse.analystChars) / Math.max(1, text.length)) : null,
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
    scored_from: 'PDF',
    evidence_record: buildRadarEvidenceRecord({
      symbol: f.symbol, source_url: f.source_url,
      attachment_url: f.attachment_urls?.[0] || null,
      filing_datetime: f.filing_datetime, evidence_quote: t.evidence_quote,
      scored_from: 'PDF',
      attribution: role === 'COMPANY' ? 'COMPANY_DOCUMENT' : role === 'MANAGEMENT' ? 'MANAGEMENT' : role === 'ANALYST' ? 'ANALYST' : 'UNKNOWN',
      speaker,
    }),
    doc_class: v.cls,
    doc_label: v.label,
    doc_confidence: v.confidence,
  };
}

// ── zzz1214 — market data for the cross-period / valuation checks (one in-memory snapshot + the guidance universe) ──
const crOf = (mc: unknown): number | null => {
  const v = typeof mc === 'number' && Number.isFinite(mc) ? mc : null;
  if (v == null || v <= 0) return null;
  return v > 1e7 ? v / 1e7 : v;   // the India snapshot stores ₹ crore; a raw-rupee figure is converted
};
async function loadFacts(symbols: string[]): Promise<Map<string, RadarFacts>> {
  const out = new Map<string, RadarFacts>();
  const want = new Set(symbols.map((s) => String(s || '').toUpperCase()));
  const timed = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const [snap, uni] = await Promise.all([
    timed((async () => (await import('@/lib/screener/snapshot-cache')).getSnapshot('IN'))(), 8_000),
    // the universe is built once and kept in memory; a cold build takes 5–20 s, so it gets more time than the snapshot (zzz1215)
    timed((async () => { const s = await import('@/lib/guidance-universe-service'); const b = await s.getUniverseBundle(Date.now()); return [...(b.build.defaultRecords ?? [])] as any[]; })(), 25_000),
  ]);
  for (const r of (snap as any)?.rows || []) {
    const t = String(r?.t || '').toUpperCase();
    if (!want.has(t)) continue;
    out.set(t, {
      mcCr: crOf(r.mc), salesCr: crOf(r.mc) != null && typeof r.ps === 'number' && r.ps > 0 ? crOf(r.mc)! / r.ps : null,
      asOf: (snap as any)?.builtAt ?? null, pe: r.pe ?? null, revQ: r.revQYoY ?? null, revTTM: r.revTTMYoY ?? null, epsQ: r.epsQYoY ?? null, epsTTM: r.epsTTMYoY ?? null,
      ebitdaQ: r.ebitdaQYoY ?? null, perf6M: r.perf6M ?? null, perf1Y: r.perf1Y ?? null, stage: r.twSt ?? null, stageHealth: r.twH ?? null, resultsDate: r.earnD ?? null, industry: r.ind ?? null, sector: r.sec ?? null,
      guidance: null,
    });
  }
  for (const g of (uni as any[]) || []) {
    if (String(g?.record?.market || 'IN') !== 'IN') continue;
    const t = [g?.record?.ticker, ...(Array.isArray(g?.tickers) ? g.tickers : [])]
      .map((x: unknown) => String(x || '').toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '')).find((x: string) => want.has(x));
    if (!t) continue;
    const cur = out.get(t) || {};
    if (cur.guidance) continue;   // the first (headline) record
    out.set(t, { ...cur, guidance: { revision: String(g.revision || 'NONE'), display: String(g.display || ''), period: g.record?.primary?.period ?? null, atRisk: !!g.atRisk } });
  }
  return out;
}

async function buildScreen(req: NextRequest, days: number, minPatterns: number, mode: ScanMode): Promise<Built> {
  const origin = new URL(req.url).origin;
  // zzz1070 — never wait on the feed forever (Railway does not enforce maxDuration): 45 s, then a "couldn't load" scan (not cached).
  let r: Response;
  try {
    r = await railwaySelfFetch(`${origin}/api/v1/concall-intel/live-feed?days=${days}${mode.feedForce ? '&force=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
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

  // ── step 1: classify every feed row from its subject + file name; routine notices are never downloaded ──
  const funnel = emptyFunnel();
  funnel.announcements_total = feedStatus?.announcements_total ?? null;
  funnel.feed_rows = filings.length;
  const excluded: RadarExcluded[] = [];
  const excludedCounts: Partial<Record<RadarDocClass, number>> = {};
  const exclude = (f: any, v: RadarDocVerdict) => {
    excludedCounts[v.cls] = (excludedCounts[v.cls] || 0) + 1;
    excluded.push({
      symbol: f.symbol, company_name: f.company_name, subject: f.subject, filing_datetime: f.filing_datetime,
      attachment_url: f.attachment_urls?.[0] || null, doc_class: v.cls, label: v.label, reason: v.reason, basis: v.basis,
      ...(v.link ? { link: v.link } : {}),
    });
  };
  const eligible: Array<{ f: any; pre: RadarDocVerdict; url: string }> = [];
  for (const f of filings) {
    const pre = preClassifyRadarFiling(f);
    if (shouldReadRadarDoc(pre)) { eligible.push({ f, pre, url: f.attachment_urls[0] }); continue; }
    if (pre.cls === 'OUT_OF_SCOPE') { funnel.out_of_scope++; continue; }   // orders, ratings … — not listed, only counted
    if (pre.cls === 'MEETING_SCHEDULE') funnel.routine.meeting_schedule++;
    else if (pre.cls === 'CALL_INVITE') funnel.routine.call_invite++;
    else if (pre.cls === 'RECORDING_LINK') funnel.routine.recording_link++;
    else if (pre.cls === 'NO_ATTACHMENT') funnel.routine.no_attachment++;
    else funnel.routine.admin_notice++;
    exclude(f, pre);
  }
  funnel.eligible = eligible.length;

  // newest day first; within a day transcripts, then presentations, then results; then filing sentiment
  const TIER_RANK: Record<string, number> = { ULTRA_BULLISH: 0, BULLISH: 1, MIXED_POSITIVE: 2, NEUTRAL: 3, MIXED_NEGATIVE: 4, BEARISH: 5 };
  const dayOf = (f: any) => { const d = new Date(f.filing_datetime); return isNaN(d.getTime()) ? '0000-00-00' : d.toISOString().slice(0, 10); };
  eligible.sort((a, b) => {
    const da = dayOf(a.f), db = dayOf(b.f);
    if (da !== db) return da < db ? 1 : -1;
    const pa = PRE_ORDER[a.pre.cls] ?? 9, pb = PRE_ORDER[b.pre.cls] ?? 9;
    if (pa !== pb) return pa - pb;
    const t = (TIER_RANK[a.f.bullish?.tier] ?? 9) - (TIER_RANK[b.f.bullish?.tier] ?? 9);
    if (t !== 0) return t;
    return new Date(b.f.filing_datetime).getTime() - new Date(a.f.filing_datetime).getTime();
  });

  // ── step 2: reuse stored results; download only unread documents, newest first, within the budget ──
  const stored = await readDocResults(eligible.map((e) => e.url));
  const unread = eligible.filter((e) => !stored.has(e.url));
  const toRead = unread.slice(0, mode.readBudget);
  const fresh = new Map<string, DocResult>();
  const START = Date.now();
  // Concall PDFs are CPU-heavy to parse in this SAME Node process that serves the terminal: 3 at a time, yield between batches.
  const CONC = 3;
  for (let i = 0; i < toRead.length; i += CONC) {
    if (Date.now() - START > mode.timeBudgetMs) break;   // out of time — the rest stays unread (and is reported as such)
    const batch = toRead.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async ({ f, pre, url }) => {
      let text = '', pages = 0, bytes = 0, failure = '';
      try {
        const pdf = await extractPdfText(url, { maxBytes: READ_MAX_BYTES, timeoutMs: 20_000 });
        text = pdf.text || ''; pages = pdf.pages || 0; bytes = pdf.bytes || 0; failure = pdf.failure_reason || '';
      } catch (e: any) { failure = e?.message || 'extract failed'; }
      const v = classifyRadarContent(pre, { text, pages, bytes, failure });
      const res: DocResult = { v, at: new Date().toISOString(), ...(v.analyzable ? { entry: scoreEntry(f, text, v) } : {}) };
      return { url, res };
    }));
    for (const { url, res } of results) {
      fresh.set(url, res);
      if (isRedisAvailable() && !isRetryableFailure(res.v)) {
        // an unexplained empty / failed parse is retried after a day (it may be a transient bad download), not kept 75 days
        const ttl = /too large/i.test(res.v.reason) ? DOC_TTL_TOO_LARGE_S : res.v.cls === 'UNREADABLE' && !/Scanned image|Mostly images/.test(res.v.reason) ? DOC_TTL_UNREADABLE_S : DOC_TTL_S;
        kvSet(DOC_KEY(url), res, ttl).catch(() => { /* read again next scan */ });
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve)); // yield to interactive requests
  }
  funnel.fresh_reads = fresh.size;

  // ── step 3: assemble from stored + fresh results ──
  const entries: TransformScreenEntry[] = [];
  for (const { f, url } of eligible) {
    const res = fresh.get(url) || stored.get(url);
    if (!res) { funnel.not_yet_read++; continue; }
    funnel.examined++;
    const v = res.v;
    if (v.analyzable && res.entry) {
      funnel.read_full++;
      // the stored entry carries the filing details as of its first read; sentiment can be re-graded by the feed
      // the feed's sentiment wins when it really graded the filing; otherwise the document's own tone (zzz1214)
      const ft = feedTier(f);
      entries.push({ ...res.entry, ...(ft ? { bullish_tier: ft, tier_source: 'feed' as const } : {}) });
    } else if (v.cls === 'UNREADABLE') { funnel.unreadable++; exclude(f, v); }
    else { funnel.cover_only++; exclude(f, v); }
  }

  const ranked = entries.filter((e) => e.pattern_count >= minPatterns).sort((a, b) => b.transformation_score - a.transformation_score);
  // zzz1214 — results / guidance / valuation from market data, then the lane and the "best" verdict
  const facts = await loadFacts(ranked.map((e) => e.symbol)).catch(() => new Map<string, RadarFacts>());
  for (const e of ranked) {
    const fx = facts.get(String(e.symbol || '').toUpperCase());
    e.facts = fx;
    e.market_cap_cr = fx?.mcCr ?? null;
    e.insight = radarInsight({ ...e, quote_quality: e.evidence_record?.quote_quality ?? null, review_queue: radarDecision(e).queue }, fx);
  }
  ranked.sort((a, b) => Number(!!b.insight?.best) - Number(!!a.insight?.best) || Number(!!b.insight?.promising) - Number(!!a.insight?.promising) || (b.insight?.bestScore ?? 0) - (a.insight?.bestScore ?? 0) || b.transformation_score - a.transformation_score);
  funnel.with_signal = ranked.length;
  // read in full, no transformation pattern: only substantive documents now (never a notice or covering letter)
  const scannedNoSignal: ScannedNoSignal[] = entries
    .filter((e) => e.pattern_count < minPatterns)
    .sort((a, b) => new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime())
    .slice(0, 20)
    .map((e) => ({
      symbol: e.symbol, company_name: e.company_name, subject: e.subject, filing_datetime: e.filing_datetime,
      source_url: e.source_url, attachment_url: e.attachment_url, bullish_tier: e.bullish_tier, scored_from: 'PDF' as const,
      doc_class: e.doc_class, doc_label: e.doc_label,
    }));
  excluded.sort((a, b) => new Date(b.filing_datetime).getTime() - new Date(a.filing_datetime).getTime());

  const payload: ScreenPayload = {
    generated_at: new Date().toISOString(),
    window_days: days,
    analyzed: funnel.read_full,              // substantive documents read in full — never notices, letters or subject lines
    pdf_cache_hits: funnel.examined - funnel.fresh_reads,
    candidates_total: filings.length,
    entries: ranked,
    scanned_no_signal: scannedNoSignal,
    feed_status: feedStatus,
    concalls_in_feed: concallsInFeed,
    transcripts_in_feed: transcriptsInFeed,
    funnel,
    coverage_note: coverageSentence(funnel),
    excluded: excluded.slice(0, 80),
    excluded_counts: excludedCounts,
  };

  // zzz810 — never cache a scan of a feed that failed or came back empty. zzz1070 — PARTIAL with NSE OK is a real scan.
  const nseOk = feedStatus?.nse === 'OK';
  const feedHealthy = filings.length > 0 && (!feedStatus || feedStatus.state === 'OK' || feedStatus.state === 'EMPTY' || (feedStatus.state === 'PARTIAL' && nseOk));
  return { payload, cacheable: feedHealthy };
}
