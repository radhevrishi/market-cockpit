// PATCH 0948 — Real AI Forward Guidance endpoint.
//
// Purpose: replace the misleading "Guidance" badge (which was Screener pros/cons
// keyword scoring) with REAL forward-looking statements extracted from concall
// transcripts via Haiku. Per user spec, restricted to EXCELLENT/STRONG tier
// stocks with D1 close >= +2% so we only spend on prints the market already
// validated — and quarter-cached forever (period like "Q4-FY26") so refreshes
// never re-bill the same data.
//
// POST body: { items: [{ticker, period}], force?: boolean }
// Returns:   { results: { [ticker]: AIForwardGuidance | null }, stats }
//
// Cache key: `haiku-fg:v1:${ticker}:${period}`  TTL: 365 days (quarterly results
// are immutable — no reason to ever refetch unless user explicitly forces).

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { extractFirstPdf } from '@/lib/pdf-text-extractor';

export const runtime = 'nodejs';
export const maxDuration = 55;

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';

// ════════════════════════════════════════════════════════════════════════════
// PATCH 0962 — Versioning + split-TTL cache scheme.
//
// ISSUE #3: A flat 1-year TTL keyed only on ticker+period meant prompt fixes,
//           parser improvements, and scoring threshold changes never reached
//           cached tickers — stale low-quality extractions survived indefinitely.
//
// ISSUE #4: Synthetic "NoGuidance" entries (written when only intimation PDFs
//           exist on NSE) inherited the same 1-year TTL — so a company that
//           later uploaded a real transcript would be permanently suppressed
//           from re-extraction until either force=true or year rollover.
//
// FIX: Cache key now embeds PROMPT_VERSION + PARSER_VERSION; bump either to
//      invalidate all dependent entries automatically. Two TTLs: positive
//      extractions are immutable (1y) while negative/no-pdf entries are
//      short-lived (24h) so re-uploads can break out of stale state.
// ════════════════════════════════════════════════════════════════════════════
const SCHEMA_VERSION = 3;                    // bump if AIForwardGuidance shape changes
const PROMPT_VERSION = 'p0962-inst-v3';      // bump on system-prompt edits
const PARSER_VERSION = 'p0962-pdfparse-v3';  // bump on PDF / scoring logic edits
const CACHE_TTL_POS_S = 365 * 24 * 3600;     // 1 year — quarterly results immutable
const CACHE_TTL_NEG_S = 24 * 3600;           // 24 hours — re-uploads & worker fixes get retried
const STATUS_TTL_S = 6 * 3600;               // mini job-store ticker checkpoints (ISSUE #2)

function buildCacheKey(ticker: string, period: string): string {
  // PATCH 0962 — v3 key includes prompt + parser version so any schema /
  // prompt evolution auto-invalidates without manual cache purges.
  return `haiku-fg:v3:${PROMPT_VERSION}:${PARSER_VERSION}:${ticker.toUpperCase()}:${period}`;
}

function buildStatusKey(ticker: string, period: string): string {
  // PATCH 0962 — per-ticker mini job-store. Written as the server processes
  // each ticker; surviving even when Vercel kills the function at 55s, so the
  // client can reconcile via GET ?action=status after a batch timeout.
  return `haiku-fg-status:v3:${ticker.toUpperCase()}:${period}`;
}

// ISSUE #2 — TickerStatus checkpoint. Written WHENEVER the per-ticker state
// changes during a batch. Survives Vercel function kills so the next client
// click can recover progress instead of re-paying for completed extractions.
type TickerStatusKind = 'extracting' | 'cached' | 'extracted' | 'failed' | 'noguidance' | 'budget_exceeded' | 'no_pdf' | 'intimation_only';
interface TickerStatusRecord {
  kind: TickerStatusKind;
  at: string;
  detail?: string;
}

async function setTickerStatus(ticker: string, period: string, kind: TickerStatusKind, detail?: string): Promise<void> {
  if (!isRedisAvailable()) return;
  try { await kvSet(buildStatusKey(ticker, period), { kind, at: new Date().toISOString(), detail } as TickerStatusRecord, STATUS_TTL_S); }
  catch {}
}

// PATCH 0951 — Extended schema. Adds 'NoGuidance' label so Haiku can honestly
// say "the PDF had no forward content" instead of fabricating Neutral 0.00.
// Adds 'numbers' + 'catalysts' so the badge can show institutional-grade
// specifics inline ("rev +20% FY27 · capex ₹400Cr H2FY27") rather than just
// a sentiment tier.
export interface AIForwardGuidance {
  label: 'Positive' | 'Neutral' | 'Negative' | 'NoGuidance';
  score: number;              // [-1, +1] — signed magnitude (0 for NoGuidance)
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;          // 1-2 sentence summary
  quotes: string[];           // up to 6 verbatim forward statements
  numbers?: Array<{ metric: string; value: string; period?: string }>;  // hard guidance figures
  catalysts?: Array<{ event: string; timing?: string }>;                 // forward catalysts with timing
  source: 'concall-transcript' | 'investor-presentation' | 'press-release';
  source_url?: string;
  source_filename?: string;   // PATCH 0951 — surfaced in UI so user can audit
  period: string;             // 'Q4-FY26' etc — cache invalidates next quarter
  extracted_at: string;       // ISO timestamp

  // PATCH 0962 — provenance + observability fields.
  // ISSUE #5 / #9: every cached object now self-describes its lineage, so the
  // client can hydrate safely after a deploy and the user can audit which
  // prompt/parser version produced which extraction.
  schema_version?: number;          // SCHEMA_VERSION at write time
  prompt_version?: string;          // PROMPT_VERSION at write time
  parser_version?: string;          // PARSER_VERSION at write time
  source_fetched_at?: string;       // when the PDF was downloaded
  source_provider?: 'nse' | 'screener-in';  // ISSUE #5: explicit fallback provenance
  source_period_hint?: string;      // e.g. "May 2026" from Screener row — for quarter-alignment audit
  pdf_chars?: number;               // how much text Haiku actually saw
  pdf_pages?: number;               // for image-only detection ratio
  pdf_quality?: PdfQuality;         // ISSUE #6 — taxonomy below
  // ISSUE #11 — per-extraction telemetry (rolled up into stats by the POST handler)
  extraction_ms?: number;           // total wall time for Haiku call
  retry_count?: number;             // 0 or 1 — only retried on JSON parse failure (ISSUE #7)
  stop_reason?: string;             // anthropic stop_reason — distinguishes max_tokens from end_turn
}

// ISSUE #6 — PDF quality taxonomy. Previously every problem PDF (image-only,
// truncated, corrupt) was conflated into "intimation-only", which silently
// discarded valid transcripts that happened to be scanned. Now each failure
// mode is a distinct outcome, surfaced in diagnostics, and (where worth it)
// queued for OCR retry later.
export type PdfQuality =
  | 'good'           // text-extractable, length >= 1200 chars
  | 'pdf-empty'      // 0 chars extracted (parser returned nothing)
  | 'pdf-image-only' // many pages, near-zero text — scanned/image PDF (would need OCR)
  | 'pdf-too-short'  // some text but < 1200 chars (likely intimation)
  | 'pdf-corrupt'    // parser threw / returned FAILED
  | 'no-pdf'         // no URL to fetch in the first place
  | 'intimation-only';  // filename-scored as intimation BEFORE PDF fetch (cheapest skip)

// ISSUE #10 — Validator. Cached objects (server or client localStorage) can
// be partially migrated, schema-mismatched, or truncated. Trust nothing on
// hydrate — always validate before using as the source of truth.
// NOT exported: Next.js route files only allow GET/POST/etc. as runtime exports.
function isValidGuidanceObject(v: unknown): v is AIForwardGuidance {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!['Positive', 'Neutral', 'Negative', 'NoGuidance'].includes(o.label as string)) return false;
  if (typeof o.score !== 'number' || !isFinite(o.score)) return false;
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(o.confidence as string)) return false;
  if (typeof o.rationale !== 'string') return false;
  if (!Array.isArray(o.quotes)) return false;
  if (typeof o.period !== 'string' || !o.period) return false;
  return true;
}

interface CFFilingItem {
  symbol: string;
  subject: string;
  filing_date: string;
  attachment_url?: string;
  raw?: any;
}

// PATCH 0949a / 0951 — per-ticker diagnostic trace. Surfaced both in console
// logs (Vercel) AND in the response body so the dashboard can show WHY a
// ticker returned no concall PDF without us having to grep logs.
//   'cf-error'         CF Worker filings endpoint failed (network/timeout/HTTP)
//   'no-filings'       CF returned filings but none for this ticker
//   'no-attachment'    Ticker has filings but none with attachment_url
//   'intimation-only'  Only intimation / notice / newspaper PDFs exist —
//                      we refuse to spend Haiku on those (no forward content).
//   'ok'               Found a usable PDF URL (real transcript/presentation)
export interface PdfLookupDiag {
  ticker: string;
  outcome:
    | 'cf-error' | 'no-filings' | 'no-attachment'
    | 'intimation-only'      // filename-scored as intimation pre-fetch (saved $)
    | 'ok' | 'ok-screener-fallback'
    // PATCH 0962 — ISSUE #6: new post-fetch PDF quality outcomes. Previously
    // all of these collapsed to "intimation-only" which silently discarded
    // valid-but-image-based or corrupt PDFs. Now distinct so we know whether
    // to OCR-retry, ignore, or re-fetch.
    | 'pdf-empty' | 'pdf-image-only' | 'pdf-too-short' | 'pdf-corrupt';
  total_filings_seen?: number;
  ticker_filings?: number;
  ticker_with_attachment?: number;
  matched_preference?: 'transcript' | 'investor-presentation' | 'press-release' | 'fallback';
  best_score?: number;        // PATCH 0951 — selection algorithm score for audit
  subject?: string;
  url?: string;
  filename?: string;          // PATCH 0951 — the actual file picked (audit trail)
  fallback_source?: 'screener-in';  // PATCH 0953 — which fallback chain rescued it
  fallback_date?: string;           // PATCH 0953 — date of Screener.in row picked
  // PATCH 0962 — observability fields (ISSUE #11)
  pdf_chars?: number;
  pdf_pages?: number;
  pdf_quality?: PdfQuality;
  error?: string;
}

// PATCH 0950a — module-scoped in-memory cache for the 8 MB /api/results/latest
// blob. Keeps a single fetch per AI-Guidance batch instead of re-fetching for
// every ticker. 5-minute TTL so cron-refreshed worker data is still picked up
// promptly. Race-safe via the in-flight Promise.
let _filingsCache: { fetchedAt: number; data: CFFilingItem[] } | null = null;
let _filingsInFlight: Promise<CFFilingItem[]> | null = null;
const FILINGS_TTL_MS = 5 * 60 * 1000;

async function loadAllFilings(): Promise<CFFilingItem[]> {
  const now = Date.now();
  if (_filingsCache && now - _filingsCache.fetchedAt < FILINGS_TTL_MS) {
    return _filingsCache.data;
  }
  if (_filingsInFlight) return _filingsInFlight;
  _filingsInFlight = (async () => {
    try {
      // PATCH 0950a — endpoint changed from /api/filings/latest (only the 20
      // freshest NSE corporate-actions filings — none of our universe was
      // ever in there) to /api/results/latest, which holds the worker's
      // full ticker-indexed filings archive (~6.6k items / ~1.7k symbols).
      const res = await fetch(`${CF_WORKER_URL}/api/results/latest`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items: CFFilingItem[] = (json?.results || json?.filings || []);
      _filingsCache = { fetchedAt: Date.now(), data: items };
      return items;
    } finally {
      _filingsInFlight = null;
    }
  })();
  return _filingsInFlight;
}

// PATCH 0951 — Score-based filing selection. Filename is a far stronger signal
// than the subject line ("SANSERA_..._Transcript_Final.pdf" is unambiguous;
// the subject is just the bucket "Analysts/Investor Meet/Con. Call Updates"
// for both real transcripts AND one-line intimation notices). We score each
// candidate filing on filename + subject and pick the highest scorer above a
// threshold; anything below threshold = intimation-only, not worth Haiku.
interface ScoredFiling {
  filing: CFFilingItem;
  score: number;
  tag: 'transcript' | 'investor-presentation' | 'press-release' | 'fallback';
  filename: string;
}

// PATCH 0972 BUG-1 — Stale-filename detector.
// User reported: BHEL card showed Q4 FY24 concall (filename
// 'bhel-transcript%20concall%20q4fy24-may21_2024.pdf') used as the Q4 FY26
// guidance source. The score-based selector picked it because "transcript"
// in the filename gives +100, but it failed to penalize the explicit
// "q4fy24" and "_2024" tokens marking it as 2-year-old content.
//
// New approach: extract year/quarter tokens from filename. If they're > 1
// year behind the current calendar year, apply a heavy penalty (-250)
// that drops the filing below threshold so we fall through to Screener.in
// or skip the ticker entirely. Catches the BHEL-style case + protects
// against any future "old transcript with new filename wrapper" issues.
function detectFilenameYear(filename: string): number | null {
  // Look for 'fy24', 'fy2024', '_2024_', '_2024.pdf', 'q4fy24'
  const fyMatch = filename.match(/fy\s*(?:20)?(\d{2})\b/);
  const yearMatch = filename.match(/(?:^|[\W_])(20[12]\d)(?:[\W_]|$)/);
  let year: number | null = null;
  if (yearMatch) year = parseInt(yearMatch[1], 10);
  if (fyMatch) {
    const fyYear = 2000 + parseInt(fyMatch[1], 10);
    // FY year (e.g. fy24 = Apr 2023–Mar 2024) corresponds to calendar year
    if (year == null || fyYear > year) year = fyYear;
  }
  return year;
}

function scoreFiling(f: CFFilingItem): ScoredFiling {
  const url = f.attachment_url || '';
  const filename = (url.split('/').pop() || '').toLowerCase();
  const subject = (f.subject || '').toLowerCase();
  let score = 0;
  let tag: ScoredFiling['tag'] = 'fallback';

  // ── Strong positive signals (the filename actually IS what we need) ──
  if (/transcript/.test(filename))                               { score += 100; tag = 'transcript'; }
  else if (/investor.{0,3}presentation|earnings.{0,3}presentation|results.{0,3}presentation|investor.{0,3}pres|earnings.{0,3}pres/.test(filename))
                                                                  { score += 70;  tag = 'investor-presentation'; }
  else if (/earnings|press.{0,3}release|earnings_release|prerelease|pressrelease/.test(filename))
                                                                  { score += 50;  tag = 'press-release'; }
  else if (/results|q[1-4]|fy\d{2}/.test(filename))              { score += 20;  tag = 'press-release'; }

  // ── Strong negative signals (filename screams "skip me") ──
  if (/intimat|notice|reg.?30|reg-30|reg\s*30|disclosure|signed|invitation/.test(filename)) score -= 200;
  if (/audio.{0,3}recording|recording/.test(filename))                                     score -= 300;  // audio file, not text
  if (/newspaper|publication|copy.{0,3}of/.test(filename))                                 score -= 150;
  if (/^outcome|board.?meeting/.test(filename))                                            score -= 80;

  // ── PATCH 0972 BUG-1 — STALE-YEAR penalty. ──
  // If the filename contains an explicit year/FY token that's > 1 year
  // behind the current calendar year, this is almost certainly an old
  // transcript that was misindexed under a new filing. Apply -250 (drops
  // below threshold so we never feed Haiku stale content). Logged so
  // diagnostics can audit.
  const detectedYear = detectFilenameYear(filename);
  const currentYear = new Date().getUTCFullYear();
  if (detectedYear != null && detectedYear < currentYear - 1) {
    score -= 250;
    console.warn(`[FG-DIAG] STALE FILENAME detected: '${filename}' has year ${detectedYear} vs current ${currentYear} (penalty -250)`);
  }

  // ── Subject as a tiebreaker (mild positive only) ──
  if (/press release/.test(subject))           score += 15;
  if (/investor presentation/.test(subject))   score += 15;
  if (/con\.?\s*call|conference call/.test(subject)) score += 5;  // weak — could be intimation

  // ── PATCH 0972 BUG-1b — Freshness bonus for current-year files. ──
  // Filenames with current year (2026) get +20 so even when multiple
  // valid PDFs exist, the freshest one wins.
  if (detectedYear === currentYear) score += 20;

  return { filing: f, score, tag, filename };
}

// Threshold below which we treat the filing as not-worth-extracting.
// 0 = "no positive signals found" → almost certainly intimation/notice/junk.
const FILING_SCORE_THRESHOLD = 1;

// ════════════════════════════════════════════════════════════════════════
// PATCH 0953 — Screener.in transcript fallback.
//
// When NSE has only intimation/notice PDFs for a ticker, Screener.in often
// has the actual concall transcript (hosted as a BSE archives PDF). We
// scrape the per-company concall section and pick the freshest UNLOCKED
// (i.e. accessible <a href>) transcript URL. Locked (<div>) rows are for
// paid Screener users — we skip those.
//
// Architecture mirrors loadAllFilings: module-scope cache, 24h TTL (Screener
// updates concall lists slowly; transcripts that are up are stable).
// Race-safe via in-flight Promise per ticker.
// ════════════════════════════════════════════════════════════════════════
interface ScreenerInResult {
  url: string;
  date: string;  // "May 2026" / "Feb 2026" — for diag display
}
const SCREENER_IN_TTL_MS = 24 * 60 * 60 * 1000;  // 24h
const _screenerInCache = new Map<string, { fetchedAt: number; result: ScreenerInResult | null }>();
const _screenerInInFlight = new Map<string, Promise<ScreenerInResult | null>>();

async function findConcallFromScreenerIn(ticker: string): Promise<ScreenerInResult | null> {
  const tkr = ticker.toUpperCase();
  const now = Date.now();
  const cached = _screenerInCache.get(tkr);
  if (cached && now - cached.fetchedAt < SCREENER_IN_TTL_MS) return cached.result;
  const inFlight = _screenerInInFlight.get(tkr);
  if (inFlight) return inFlight;

  const p = (async (): Promise<ScreenerInResult | null> => {
    try {
      // Try consolidated first (most companies have it), fall back to standalone
      const urls = [
        `https://www.screener.in/company/${tkr}/consolidated/`,
        `https://www.screener.in/company/${tkr}/`,
      ];
      let html = '';
      for (const u of urls) {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
            },
            signal: AbortSignal.timeout(12_000),
          });
          if (res.ok) {
            html = await res.text();
            if (html && html.length > 5000) break;
          }
        } catch {}
      }
      if (!html || html.length < 5000) {
        console.warn('[FG-DIAG] screener.in fetch empty for', tkr);
        return null;
      }

      // Parse: find every date row that has "concall-link" within next 2000 chars.
      // Each row may have <a href="..."> (accessible) or <div> (locked).
      const datePositions: Array<{ date: string; idx: number }> = [];
      const dateRe = /<div[^>]*>([A-Z][a-z]{2,4}\s+20\d{2})<\/div>/g;
      let m: RegExpExecArray | null;
      while ((m = dateRe.exec(html)) !== null) {
        if (html.slice(m.index, m.index + 2000).includes('concall-link')) {
          datePositions.push({ date: m[1], idx: m.index });
        }
      }
      if (datePositions.length === 0) {
        console.warn('[FG-DIAG] screener.in no concall rows for', tkr);
        return null;
      }
      // For each row, extract the accessible <a class="concall-link" href="...">
      const monthIdx: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
      const rows: ScreenerInResult[] = [];
      for (let i = 0; i < datePositions.length; i++) {
        const start = datePositions[i].idx;
        const end = i + 1 < datePositions.length ? datePositions[i + 1].idx : Math.min(start + 2500, html.length);
        const chunk = html.slice(start, end);
        const aMatch = chunk.match(/<a[^>]*class="concall-link"[^>]*href="([^"]+)"/);
        if (aMatch && aMatch[1].toLowerCase().endsWith('.pdf')) {
          rows.push({ url: aMatch[1], date: datePositions[i].date });
        }
      }
      if (rows.length === 0) {
        console.warn('[FG-DIAG] screener.in all rows locked for', tkr);
        return null;
      }
      // Sort freshest first (e.g. May 2026 > Feb 2026)
      rows.sort((a, b) => {
        const parse = (d: string) => {
          const [mon, yr] = d.split(/\s+/);
          return Number(yr) * 12 + (monthIdx[mon] ?? 0);
        };
        return parse(b.date) - parse(a.date);
      });
      console.log(`[FG-DIAG] screener.in picked ${rows[0].date} for ${tkr}: ${rows[0].url.slice(0, 120)}`);
      return rows[0];
    } catch (e) {
      console.warn('[FG-DIAG] screener.in error for', tkr, (e as Error).message);
      return null;
    }
  })();
  _screenerInInFlight.set(tkr, p);
  try {
    const result = await p;
    _screenerInCache.set(tkr, { fetchedAt: Date.now(), result });
    return result;
  } finally {
    _screenerInInFlight.delete(tkr);
  }
}

// ─── Step 1: Find latest concall PDF URL for a ticker ──────────────────────
async function findConcallPdfUrl(ticker: string): Promise<
  | { url: string; source: AIForwardGuidance['source']; subject: string; filename: string; diag: PdfLookupDiag }
  | { url: null; diag: PdfLookupDiag }
> {
  const tkr = ticker.toUpperCase();
  let filings: CFFilingItem[];
  try {
    filings = await loadAllFilings();
  } catch (e) {
    const diag: PdfLookupDiag = { ticker: tkr, outcome: 'cf-error', error: (e as Error).message };
    console.warn('[FG-DIAG]', diag);
    return { url: null, diag };
  }
  const tickerFilings = filings.filter(f => (f.symbol || '').toUpperCase() === tkr);
  const withAttachment = tickerFilings.filter(f => !!f.attachment_url);

  // PATCH 0953 — Screener.in fallback helper. Used when NSE has nothing
  // usable (intimation-only or no-filings). Returns Screener.in PDF URL +
  // diag annotation, or null if Screener.in has nothing either.
  const tryScreenerInFallback = async (
    baseDiag: PdfLookupDiag,
  ): Promise<
    | { url: string; source: AIForwardGuidance['source']; subject: string; filename: string; diag: PdfLookupDiag }
    | null
  > => {
    const si = await findConcallFromScreenerIn(tkr);
    if (!si) return null;
    const filename = (si.url.split('/').pop() || '').toLowerCase();
    const enrichedDiag: PdfLookupDiag = {
      ...baseDiag,
      outcome: 'ok-screener-fallback',
      matched_preference: 'transcript',
      fallback_source: 'screener-in',
      fallback_date: si.date,
      subject: `Screener.in concall · ${si.date}`,
      filename,
      url: si.url,
    };
    console.log('[FG-DIAG]', enrichedDiag);
    return {
      url: si.url,
      source: 'concall-transcript',
      subject: enrichedDiag.subject!,
      filename,
      diag: enrichedDiag,
    };
  };

  if (tickerFilings.length === 0) {
    const baseDiag: PdfLookupDiag = {
      ticker: tkr, outcome: 'no-filings',
      total_filings_seen: filings.length, ticker_filings: 0,
    };
    const fb = await tryScreenerInFallback(baseDiag);
    if (fb) return fb;
    console.warn('[FG-DIAG]', baseDiag);
    return { url: null, diag: baseDiag };
  }
  if (withAttachment.length === 0) {
    const baseDiag: PdfLookupDiag = {
      ticker: tkr, outcome: 'no-attachment',
      total_filings_seen: filings.length,
      ticker_filings: tickerFilings.length,
      ticker_with_attachment: 0,
    };
    const fb = await tryScreenerInFallback(baseDiag);
    if (fb) return fb;
    console.warn('[FG-DIAG]', baseDiag);
    return { url: null, diag: baseDiag };
  }

  // Score every candidate, pick highest. Within equal scores, pick freshest.
  const scored = withAttachment
    .map(scoreFiling)
    .sort((a, b) => b.score - a.score || (b.filing.filing_date || '').localeCompare(a.filing.filing_date || ''));
  const best = scored[0];

  if (best.score < FILING_SCORE_THRESHOLD) {
    // All NSE candidates look like intimations/notices/audio/newspaper.
    // Try Screener.in fallback before giving up.
    const baseDiag: PdfLookupDiag = {
      ticker: tkr, outcome: 'intimation-only',
      total_filings_seen: filings.length,
      ticker_filings: tickerFilings.length,
      ticker_with_attachment: withAttachment.length,
      best_score: best.score,
      subject: best.filing.subject,
      filename: best.filename,
    };
    const fb = await tryScreenerInFallback(baseDiag);
    if (fb) return fb;
    console.warn('[FG-DIAG]', baseDiag);
    return { url: null, diag: baseDiag };
  }

  const source: AIForwardGuidance['source'] =
    best.tag === 'transcript' ? 'concall-transcript' :
    best.tag === 'investor-presentation' ? 'investor-presentation' : 'press-release';
  const diag: PdfLookupDiag = {
    ticker: tkr, outcome: 'ok',
    total_filings_seen: filings.length,
    ticker_filings: tickerFilings.length,
    ticker_with_attachment: withAttachment.length,
    matched_preference: best.tag,
    best_score: best.score,
    subject: best.filing.subject,
    filename: best.filename,
    url: best.filing.attachment_url!,
  };
  console.log('[FG-DIAG]', diag);
  return {
    url: best.filing.attachment_url!,
    source,
    subject: best.filing.subject,
    filename: best.filename,
    diag,
  };
}

// ─── Step 2: Extract forward statements via Haiku ──────────────────────────
// PATCH 0962 — extended signature with provenance + pdf telemetry fields so
// every cached object is self-describing (ISSUE #5, #9, #11).
interface ExtractionContext {
  ticker: string;
  pdfText: string;
  source: AIForwardGuidance['source'];
  sourceUrl: string;
  sourceFilename: string;
  sourceProvider: 'nse' | 'screener-in';
  sourcePeriodHint?: string;   // ISSUE #5 — for Screener fallback quarter-alignment audit
  pdfChars: number;
  pdfPages?: number;
  pdfQuality: PdfQuality;
  period: string;
  apiKey: string;
}

async function extractForwardGuidance(ctx: ExtractionContext): Promise<AIForwardGuidance | null> {
  const { ticker, pdfText, source, sourceUrl, sourceFilename, sourceProvider, sourcePeriodHint, pdfChars, pdfPages, pdfQuality, period, apiKey } = ctx;
  // PATCH 0951 — bumped minimum from 200 to 1200 chars. Anything shorter is
  // almost certainly an intimation notice (~500 chars of "kindly note...")
  // and Haiku will just return Neutral 0.00 — pure waste of money. Better
  // to flag it as "no transcript content" upstream and skip the LLM call.
  if (!pdfText || pdfText.length < 1200) return null;

  // Trim to first ~14k chars (forward statements are usually in the
  // management commentary at the top, not in Q&A). Haiku 4.5 input is cheap
  // but PDFs can be 50-100 pages so we don't need everything.
  const text = pdfText.slice(0, 14_000);

  // PATCH 0951 — Institutional-grade prompt. Three changes vs P0948:
  //  (1) NoGuidance label — Haiku honestly admits when the PDF has no forward
  //      content instead of fabricating Neutral 0.00. We pay for honesty.
  //  (2) Hard "numbers" array — specific guidance figures (%, ₹Cr, MW, units)
  //      with metric/value/period. This is what a buy-side analyst writes in
  //      their note. If management didn't give a number, the array is empty.
  //  (3) Hard "catalysts" array — forward events with timing (Q2 FY27, etc).
  //      Confidence reflects DATA DENSITY: HIGH only when 2+ specific
  //      numbers are present, MEDIUM with 1, LOW with directional language
  //      only, and NoGuidance when there's nothing forward at all.
  const systemPrompt = `You are a buy-side equity research analyst at a long-only institutional fund. You are reading an Indian-listed-company filing (could be a concall transcript, investor presentation, OR an intimation notice). Your job is to extract ONLY forward-looking management guidance — statements about FUTURE performance — and output a JSON brief that a portfolio manager can paste into a model.

CRITICAL — DISTINGUISH THESE THREE CASES:
  CASE A — The PDF contains real forward guidance (transcript / presentation / detailed press release):
           Extract everything. Be specific. Cite numbers verbatim.
  CASE B — The PDF is short or contains only retrospective commentary on Q-just-ended:
           Return label="Neutral", LOW confidence, rationale="No forward guidance — commentary backward-looking".
  CASE C — The PDF is an intimation notice / invitation / regulatory disclosure with NO management commentary at all
           (e.g. "We hereby intimate that a Q4 FY26 earnings call will be held on May 26 at 4:00 PM IST"):
           Return label="NoGuidance", score=0, confidence="HIGH" (you are HIGH-confident there is nothing here),
           rationale="Intimation/notice only — no transcript content".
           Empty quotes, empty numbers, empty catalysts. Do NOT fabricate.

WHAT COUNTS AS FORWARD GUIDANCE:
  - Revenue / order book / capacity / volume targets ("FY27 revenue growth of 18-20%", "order book ₹4,200 Cr at FY-end")
  - Margin / profitability targets ("EBITDA margin of 22-23% in FY27", "100-150 bps expansion")
  - Capex commitments with timing ("₹500 Cr capex in FY27 for Pithampur plant, commissioning Q2 FY27")
  - Demand / pipeline outlook ("auto OEM demand expected to revive H2 FY27", "L1 in tenders worth ₹800 Cr")
  - Strategic milestones with timing (regulatory clearance, new geography, product launch — all with quarter)
  - Debt reduction / balance sheet trajectory ("net-debt-free by FY28")
  - M&A intent / divestment / demerger plans

IGNORE: retrospective commentary on the quarter just ended, generic macro views, boilerplate.

OUTPUT JSON ONLY — no markdown, no preamble. Schema:
{
  "label": "Positive" | "Neutral" | "Negative" | "NoGuidance",
  "score": <number in [-1, +1], 0 if NoGuidance/Neutral>,
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "rationale": "<one or two sentence institutional summary, max 240 chars>",
  "quotes": ["<verbatim forward statement 1>", "...", "<up to 6 verbatim>"],
  "numbers": [{"metric": "Revenue growth", "value": "+18-20%", "period": "FY27"}, {"metric": "EBITDA margin", "value": "22%", "period": "FY27"}],
  "catalysts": [{"event": "Pithampur plant commissioning", "timing": "Q2 FY27"}, {"event": "USFDA inspection at Hyderabad facility", "timing": "Q3 FY27"}]
}

SCORE SCALE:
  +0.7 to +1.0  strong positive — explicit growth guidance with hard numbers
  +0.3 to +0.6  mild positive — directional growth language without hard numbers
  -0.2 to +0.2  neutral — balanced / in-line with run-rate / absent
  -0.3 to -0.6  mild negative — headwinds / slowdown without disasters
  -0.7 to -1.0  strong negative — explicit guidance cuts, capex deferral, demand collapse

CONFIDENCE — REFLECTS DATA DENSITY, NOT YOUR PERSONAL CERTAINTY:
  HIGH   = 2+ hard numbers (% / ₹Cr / units) in the "numbers" array
  MEDIUM = 1 hard number OR multiple directional statements with timing
  LOW    = only directional adjectives, no specifics
  HIGH on NoGuidance = you are sure there is nothing forward in this document

If "numbers" array would be empty, omit hard numbers in the rationale too — say "Directional only" rather than inventing figures.`;

  const userPrompt = `Ticker: ${ticker}\nPeriod: ${period}\nSource type: ${source}\nSource filename: ${sourceFilename}\nPDF length: ${pdfText.length} chars\n\n=== FILING TEXT ===\n${text}`;

  // ── PATCH 0962 — Cost-guarded retry loop. ISSUE #7. ────────────────────────
  //   * Retry ONLY on transient failures (network error, 5xx, empty body, OR
  //     malformed JSON with SHORT completion — short completion suggests a
  //     mid-thought interruption that a retry can recover).
  //   * NEVER retry when stop_reason === 'max_tokens' — that's structural
  //     truncation, the model would just hit the same wall and double cost.
  //   * NEVER retry on 429 — budget exceeded.
  //   * NEVER retry when malformed JSON is LONG (>= 600 chars) — model is
  //     confident but malformed; another call costs full tokens for the same
  //     mistake.
  //
  // Also captures stop_reason + extraction_ms + retry_count for the cached
  // object (ISSUE #11 telemetry).
  let parsed: any = null;
  let last429 = false;
  let stopReason: string | undefined;
  let retryCount = 0;
  const startMs = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    let resp: Response | null = null;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: HAIKU_MODEL,
          max_tokens: 1400,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      // Network / abort error — transient, retry once.
      if (attempt === 0) {
        retryCount = 1;
        console.warn(`[FG-DIAG] haiku fetch error for ${ticker} on attempt 1 (will retry):`, (e as Error).message);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        continue;
      }
      console.warn(`[FG-DIAG] haiku fetch error for ${ticker} on attempt 2 (giving up):`, (e as Error).message);
      break;
    }
    if (resp.status === 429) {
      last429 = true;
      console.warn(`[FG-DIAG] anthropic 429 (budget/rate limit) for ${ticker} — NOT retrying`);
      break;
    }
    if (!resp.ok) {
      // 5xx / 4xx (not 429) — transient on first attempt, give up on second.
      if (attempt === 0) {
        retryCount = 1;
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        continue;
      }
      break;
    }
    const data = await resp.json();
    stopReason = data?.stop_reason;
    const raw = (data?.content || []).map((b: any) => b?.text || '').join('').trim();
    // PATCH 0962 ISSUE #7 — if stop_reason === 'max_tokens', the model hit
    // its 1400-token cap mid-JSON. Retrying with the same max_tokens would
    // hit the same wall and double cost. Bail out cleanly.
    if (stopReason === 'max_tokens') {
      console.warn(`[FG-DIAG] haiku hit max_tokens for ${ticker} — NOT retrying (would truncate again)`);
      // Try to salvage partial JSON; if it parses, use it.
      const salvaged = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try { parsed = JSON.parse(salvaged); } catch {}
      break;
    }
    if (!raw) {
      if (attempt === 0) {
        retryCount = 1;
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        continue;
      }
      break;
    }
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      parsed = JSON.parse(cleaned);
      break;
    } catch {
      // PATCH 0962 ISSUE #7 — retry ONLY when the malformed output is SHORT,
      // suggesting a transient model hiccup rather than a structural issue.
      // Long malformed output means the model is confidently wrong; another
      // call costs full tokens for the same mistake.
      if (attempt === 0 && cleaned.length < 600) {
        retryCount = 1;
        console.warn(`[FG-DIAG] haiku short non-JSON (${cleaned.length} chars) for ${ticker} on attempt 1, retrying...`);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        continue;
      }
      console.warn(`[FG-DIAG] haiku non-JSON (${cleaned.length} chars) for ${ticker} — NOT retrying (long output ⇒ structural)`);
      break;
    }
  }
  const extractionMs = Date.now() - startMs;
  if (last429) {
    // Sentinel: budget exceeded. Caller distinguishes from llm-failed.
    return { __budgetExceeded: true, retryCount, extractionMs } as any;
  }
  if (!parsed) return null;

  try {
    if (!['Positive', 'Neutral', 'Negative', 'NoGuidance'].includes(parsed.label)) return null;
    const score = typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0;
    const now = new Date().toISOString();
    const built: AIForwardGuidance = {
      label: parsed.label,
      score: parsed.label === 'NoGuidance' ? 0 : score,
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence) ? parsed.confidence : 'MEDIUM',
      rationale: String(parsed.rationale || '').slice(0, 280),
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes.slice(0, 6).map((q: any) => String(q).slice(0, 320)) : [],
      numbers: Array.isArray(parsed.numbers) ? parsed.numbers.slice(0, 8).map((n: any) => ({
        metric: String(n?.metric || '').slice(0, 80),
        value: String(n?.value || '').slice(0, 60),
        period: n?.period ? String(n.period).slice(0, 30) : undefined,
      })).filter((n: any) => n.metric && n.value) : [],
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.slice(0, 6).map((c: any) => ({
        event: String(c?.event || '').slice(0, 100),
        timing: c?.timing ? String(c.timing).slice(0, 30) : undefined,
      })).filter((c: any) => c.event) : [],
      source,
      source_url: sourceUrl,
      source_filename: sourceFilename,
      period,
      extracted_at: now,
      // PATCH 0962 — provenance + telemetry. Every cached object now carries
      // enough lineage to validate at hydration time (ISSUE #9, #10) and to
      // power the diagnostics panel without grepping Vercel logs (ISSUE #11).
      schema_version: SCHEMA_VERSION,
      prompt_version: PROMPT_VERSION,
      parser_version: PARSER_VERSION,
      source_fetched_at: now,
      source_provider: sourceProvider,
      source_period_hint: sourcePeriodHint,
      pdf_chars: pdfChars,
      pdf_pages: pdfPages,
      pdf_quality: pdfQuality,
      extraction_ms: extractionMs,
      retry_count: retryCount,
      stop_reason: stopReason,
    };
    return built;
  } catch {
    return null;
  }
}

// PATCH 0957 — Server-side in-flight dedup for the Haiku extraction step.
// Without this, two concurrent identical requests (user double-clicks, two
// browser tabs open, retry storm during deploy, etc.) BOTH check cache
// (miss), BOTH do PDF lookup, BOTH call Haiku — duplicate $ for the same
// data. The Map keys on the same string as the KV cache so the dedup
// is bulletproof across periods/quarters too. Force=true bypasses dedup
// because force is explicit re-extraction intent.
const _haikuInFlight = new Map<string, Promise<AIForwardGuidance | { __budgetExceeded: true } | null>>();

async function extractForwardGuidanceDedup(
  ctx: ExtractionContext,
  force: boolean,
): Promise<AIForwardGuidance | { __budgetExceeded: true } | null> {
  // force=true means user explicitly wants a fresh call; don't share.
  if (force) return extractForwardGuidance(ctx);
  const key = buildCacheKey(ctx.ticker, ctx.period);
  const existing = _haikuInFlight.get(key);
  if (existing) {
    console.log(`[FG-DIAG] dedup hit for ${ctx.ticker} (${ctx.period}) — sharing in-flight Haiku call`);
    return existing;
  }
  const p = extractForwardGuidance(ctx);
  _haikuInFlight.set(key, p);
  // Cleanup on resolve/reject — keep in-flight only during active call.
  p.finally(() => _haikuInFlight.delete(key));
  return p;
}

// ─── PDF quality classifier (ISSUE #6) ─────────────────────────────────────
// Replaces the old "text.length < 1200 → intimation-only" conflation with a
// taxonomy: scanned PDFs, corrupt PDFs, short PDFs, and missing PDFs are now
// distinct outcomes. Image-only detection uses chars/page ratio because
// scanned PDFs have many pages but ~0 extractable text.
import type { ExtractedPdf } from '@/lib/pdf-text-extractor';
function classifyPdfQuality(ext: ExtractedPdf | null): { quality: PdfQuality; chars: number; pages?: number } {
  if (!ext) return { quality: 'no-pdf', chars: 0 };
  const chars = (ext.text || '').length;
  const pages = ext.pages;
  if (ext.source === 'FAILED') return { quality: 'pdf-corrupt', chars, pages };
  if (chars === 0) return { quality: 'pdf-empty', chars, pages };
  // Image-only heuristic: 5+ pages, < 100 chars/page average. A real
  // transcript averages 1500-3000 chars/page; a scanned PDF averages < 50.
  if (pages && pages >= 5 && chars / pages < 100) return { quality: 'pdf-image-only', chars, pages };
  if (chars < 1200) return { quality: 'pdf-too-short', chars, pages };
  return { quality: 'good', chars, pages };
}

// ─── POST handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 503 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const items: Array<{ ticker: string; period: string }> = Array.isArray(body?.items) ? body.items : [];
  const force = !!body?.force;
  if (items.length === 0) return NextResponse.json({ error: 'items required' }, { status: 400 });

  // PATCH 0961 — hard cap 8/req keeps wall time under Vercel's 55s.
  const capped = items.slice(0, 8);

  // PATCH 0962 — expanded stats (ISSUE #11). Each new field is also rolled
  // up by the client into the banner so PDF taxonomy, parse failures, and
  // retry counts are visible without scraping Vercel logs.
  const stats = {
    cached: 0,
    cached_invalid_dropped: 0,  // ISSUE #10 — schema-mismatched cache entries (dropped, will re-extract)
    extracted: 0,
    intimation_only: 0,         // pre-fetch filename-scored skip
    screener_fallback: 0,
    missing_pdf: 0,
    llm_failed: 0,
    budget_exceeded: 0,
    // ISSUE #6 — PDF quality taxonomy
    pdf_empty: 0,
    pdf_image_only: 0,
    pdf_too_short: 0,
    pdf_corrupt: 0,
    // ISSUE #11 — extraction telemetry
    retries: 0,
    parse_failures: 0,           // null returns from extractForwardGuidance (post-retry)
    max_tokens_hits: 0,          // stop_reason === 'max_tokens'
    extraction_ms_sum: 0,        // for averaging client-side
    total: capped.length,
  };
  const results: Record<string, AIForwardGuidance | null> = {};
  // PATCH 0949a — collect per-ticker diagnostics so the UI can show why each
  // ticker failed without us having to scrape Vercel logs.
  const diagnostics: Array<PdfLookupDiag & { stage?: 'pdf-empty' | 'llm-failed' }> = [];

  // PATCH 0962 — ISSUE #8: adaptive concurrency. Start at 6; if the previous
  // wave's worst case > 30s, drop concurrency for the next wave so we don't
  // amplify a slow upstream (Screener.in throttling, NSE pdf giant, etc.).
  // Recover up to 6 when latencies normalize. Bounded [2, 6] so we never
  // stall and never overshoot the function timeout.
  let CONCURRENT = 6;
  for (let i = 0; i < capped.length; i += CONCURRENT) {
    const waveStart = Date.now();
    const wave = capped.slice(i, i + CONCURRENT);
    await Promise.all(wave.map(async ({ ticker, period }) => {
      const T = (ticker || '').toUpperCase().trim();
      const P = (period || '').trim() || 'unknown';
      if (!T) { results[ticker] = null; return; }
      // PATCH 0962 — v3 key embeds prompt + parser version so a prompt fix
      // automatically invalidates dependent entries.
      const key = buildCacheKey(T, P);

      // ── ISSUE #2 — checkpoint: mark this ticker as extracting BEFORE we
      // do anything expensive. The status survives if Vercel kills the
      // function, so the client can poll via GET ?action=status and learn
      // the real state instead of treating the whole batch as lost.
      await setTickerStatus(T, P, 'extracting');

      // 1) Cache check — with VALIDATION (ISSUE #10). A stale or partially
      //    migrated entry is now dropped and re-extracted instead of being
      //    silently trusted.
      if (!force && isRedisAvailable()) {
        try {
          const cached = await kvGet<AIForwardGuidance>(key);
          if (cached) {
            if (isValidGuidanceObject(cached)) {
              results[T] = cached;
              stats.cached++;
              await setTickerStatus(T, P, 'cached');
              return;
            } else {
              stats.cached_invalid_dropped++;
              console.warn(`[FG-DIAG] dropping invalid cache entry for ${T} (${P}) — schema mismatch, will re-extract`);
              // fall through to fresh extract
            }
          }
        } catch {}
      }

      // 2) Find concall PDF
      const lookup = await findConcallPdfUrl(T);
      if (lookup.url === null) {
        if (lookup.diag.outcome === 'intimation-only') {
          // ISSUE #4 — synthetic NoGuidance entries now write with SHORT TTL
          // (24h) instead of 1y. If the company later uploads a real transcript,
          // the cache will expire and re-extraction picks it up automatically.
          const noGuidance: AIForwardGuidance = {
            label: 'NoGuidance',
            score: 0,
            confidence: 'HIGH',
            rationale: 'Only intimation/notice PDFs filed on NSE — no transcript content yet to extract. Cached for 24h; re-extracts automatically once the company uploads the actual transcript.',
            quotes: [],
            numbers: [],
            catalysts: [],
            source: 'press-release',
            source_filename: lookup.diag.filename,
            period: P,
            extracted_at: new Date().toISOString(),
            schema_version: SCHEMA_VERSION,
            prompt_version: PROMPT_VERSION,
            parser_version: PARSER_VERSION,
            source_fetched_at: new Date().toISOString(),
            source_provider: 'nse',
            pdf_quality: 'intimation-only',
          };
          if (isRedisAvailable()) {
            try { await kvSet(key, noGuidance, CACHE_TTL_NEG_S); } catch {}
          }
          results[T] = noGuidance;
          stats.intimation_only++;
          await setTickerStatus(T, P, 'intimation_only');
          diagnostics.push({ ...lookup.diag, pdf_quality: 'intimation-only' });
          return;
        }
        results[T] = null;
        stats.missing_pdf++;
        await setTickerStatus(T, P, 'no_pdf', lookup.diag.outcome);
        diagnostics.push({ ...lookup.diag, pdf_quality: 'no-pdf' });
        return;
      }

      // 3) Extract PDF text + classify quality (ISSUE #6).
      let ext: ExtractedPdf | null = null;
      try { ext = await extractFirstPdf([lookup.url]); }
      catch (e) { console.warn('[FG-DIAG] extract error', T, (e as Error).message); }
      const quality = classifyPdfQuality(ext);

      // Augment diag with PDF telemetry now that we have it.
      const diagWithPdf: PdfLookupDiag & { stage?: 'pdf-empty' | 'llm-failed' } = {
        ...lookup.diag,
        pdf_chars: quality.chars,
        pdf_pages: quality.pages,
        pdf_quality: quality.quality,
      };

      if (quality.quality !== 'good') {
        // ISSUE #6 — distinct outcomes per failure mode. Each is short-TTL
        // cached so re-uploads / OCR improvements / parser fixes can recover.
        results[T] = null;
        if (quality.quality === 'pdf-empty')         { stats.pdf_empty++;       diagWithPdf.outcome = 'pdf-empty';      }
        else if (quality.quality === 'pdf-image-only') { stats.pdf_image_only++; diagWithPdf.outcome = 'pdf-image-only';  }
        else if (quality.quality === 'pdf-too-short')  { stats.pdf_too_short++;  diagWithPdf.outcome = 'pdf-too-short';   }
        else if (quality.quality === 'pdf-corrupt')    { stats.pdf_corrupt++;    diagWithPdf.outcome = 'pdf-corrupt';     }
        await setTickerStatus(T, P, 'no_pdf', quality.quality);
        diagnostics.push(diagWithPdf);
        return;
      }

      // 4) Haiku extract — extended ExtractionContext carries provenance +
      //    PDF telemetry through to the cached object (ISSUE #5, #9, #11).
      const sourceProvider: 'nse' | 'screener-in' = lookup.diag.outcome === 'ok-screener-fallback' ? 'screener-in' : 'nse';
      const sourcePeriodHint = lookup.diag.fallback_date;  // ISSUE #5 — Screener row date for audit
      const fg = await extractForwardGuidanceDedup({
        ticker: T,
        pdfText: ext!.text,
        source: lookup.source,
        sourceUrl: lookup.url,
        sourceFilename: lookup.filename,
        sourceProvider,
        sourcePeriodHint,
        pdfChars: quality.chars,
        pdfPages: quality.pages,
        pdfQuality: quality.quality,
        period: P,
        apiKey,
      }, force);

      if (fg && (fg as any).__budgetExceeded) {
        results[T] = null;
        stats.budget_exceeded++;
        stats.retries += (fg as any).retryCount || 0;
        await setTickerStatus(T, P, 'budget_exceeded');
        diagnostics.push({ ...diagWithPdf, stage: 'llm-failed', error: 'Anthropic 429: budget/rate limit exceeded' });
        return;
      }
      if (!fg) {
        results[T] = null;
        stats.parse_failures++;
        stats.llm_failed++;
        await setTickerStatus(T, P, 'failed');
        diagnostics.push({ ...diagWithPdf, stage: 'llm-failed' });
        return;
      }

      // 5) Cache + return. Split TTL (ISSUE #4): positive extractions are
      //    immutable for 1y; NoGuidance / Neutral-LOW write short-TTL so a
      //    later transcript upload or prompt revision can break out.
      const fgGuidance = fg as AIForwardGuidance;
      const ttl = (fgGuidance.label === 'NoGuidance' || (fgGuidance.label === 'Neutral' && fgGuidance.confidence === 'LOW'))
        ? CACHE_TTL_NEG_S
        : CACHE_TTL_POS_S;
      if (isRedisAvailable()) {
        try { await kvSet(key, fgGuidance, ttl); } catch {}
      }
      results[T] = fgGuidance;
      stats.extracted++;
      stats.retries += fgGuidance.retry_count || 0;
      if (fgGuidance.stop_reason === 'max_tokens') stats.max_tokens_hits++;
      stats.extraction_ms_sum += fgGuidance.extraction_ms || 0;
      if (sourceProvider === 'screener-in') stats.screener_fallback++;
      await setTickerStatus(T, P, fgGuidance.label === 'NoGuidance' ? 'noguidance' : 'extracted');
      diagnostics.push(diagWithPdf);
    }));

    // ── ISSUE #8 — adaptive concurrency. Measure this wave, tune next one.
    const waveMs = Date.now() - waveStart;
    if (waveMs > 30_000 && CONCURRENT > 2) {
      CONCURRENT = Math.max(2, CONCURRENT - 2);
      console.log(`[FG-DIAG] adaptive concurrency ↓ ${CONCURRENT} (last wave ${waveMs}ms)`);
    } else if (waveMs < 15_000 && CONCURRENT < 6) {
      CONCURRENT = Math.min(6, CONCURRENT + 1);
      console.log(`[FG-DIAG] adaptive concurrency ↑ ${CONCURRENT} (last wave ${waveMs}ms)`);
    }
  }

  return NextResponse.json({
    results,
    stats,
    diagnostics,
    generated_at: new Date().toISOString(),
    // ISSUE #11 — surface server version so client can validate alignment.
    server_versions: { schema: SCHEMA_VERSION, prompt: PROMPT_VERSION, parser: PARSER_VERSION },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

// ─── GET handler — debug probe + status reconciliation ─────────────────────
//
// PATCH 0962 (ISSUE #2, partial #12) — mini job-store status endpoint.
//
// When a POST batch times out at Vercel's 55s cutoff, the per-ticker
// extraction may have COMPLETED server-side and even written to KV — but
// the client never saw the response. Previously those completed-but-orphaned
// extractions were invisible until the user manually re-ran AI Guidance.
//
// GET ?action=status&tickers=A,B,C&period=Q4-FY26 — returns per-ticker
//   status records from KV (status: 'extracted' | 'noguidance' | 'failed' |
//   'budget_exceeded' | 'no_pdf' | 'cached' | 'extracting').
// GET ?action=fetch&tickers=A,B,C&period=Q4-FY26 — returns the actual
//   AIForwardGuidance objects from KV for any tickers that have one cached.
//   Client calls this after a batch failure to reconcile orphaned completions.
// GET ?ticker=X&period=...&force=1 — original single-ticker probe (unchanged).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // ── Mini job-store: status reconciliation ──
  if (action === 'status' || action === 'fetch') {
    const tickers = (url.searchParams.get('tickers') || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const period = url.searchParams.get('period') || 'unknown';
    if (tickers.length === 0) return NextResponse.json({ error: 'tickers required' }, { status: 400 });
    if (!isRedisAvailable()) return NextResponse.json({ error: 'KV unavailable' }, { status: 503 });
    if (action === 'status') {
      const out: Record<string, TickerStatusRecord | null> = {};
      await Promise.all(tickers.map(async t => {
        try { out[t] = await kvGet<TickerStatusRecord>(buildStatusKey(t, period)); }
        catch { out[t] = null; }
      }));
      return NextResponse.json({ statuses: out, server_versions: { schema: SCHEMA_VERSION, prompt: PROMPT_VERSION, parser: PARSER_VERSION } }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    // action === 'fetch'
    const out: Record<string, AIForwardGuidance | null> = {};
    await Promise.all(tickers.map(async t => {
      try {
        const cached = await kvGet<AIForwardGuidance>(buildCacheKey(t, period));
        out[t] = (cached && isValidGuidanceObject(cached)) ? cached : null;
      } catch { out[t] = null; }
    }));
    return NextResponse.json({ results: out, server_versions: { schema: SCHEMA_VERSION, prompt: PROMPT_VERSION, parser: PARSER_VERSION } }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // ── Original single-ticker probe ──
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  const period = url.searchParams.get('period') || 'unknown';
  if (!ticker) return NextResponse.json({ error: 'ticker query required, or use ?action=status / ?action=fetch' }, { status: 400 });
  const fakeReq = {
    json: async () => ({ items: [{ ticker, period }], force: url.searchParams.get('force') === '1' }),
  } as NextRequest;
  return POST(fakeReq);
}
