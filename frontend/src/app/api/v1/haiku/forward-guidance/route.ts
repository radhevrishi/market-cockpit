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
const CACHE_TTL_S = 365 * 24 * 3600;        // 1 year — quarterly results are immutable
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';

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
  outcome: 'cf-error' | 'no-filings' | 'no-attachment' | 'intimation-only' | 'ok' | 'ok-screener-fallback';
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

  // ── Subject as a tiebreaker (mild positive only) ──
  if (/press release/.test(subject))           score += 15;
  if (/investor presentation/.test(subject))   score += 15;
  if (/con\.?\s*call|conference call/.test(subject)) score += 5;  // weak — could be intimation

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
async function extractForwardGuidance(
  ticker: string,
  pdfText: string,
  source: AIForwardGuidance['source'],
  sourceUrl: string,
  sourceFilename: string,
  period: string,
  apiKey: string,
): Promise<AIForwardGuidance | null> {
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

  // PATCH 0956 — one-shot retry with backoff. Haiku occasionally returns
  // non-JSON (~1-2% of calls) due to model-side hiccups; one retry recovers
  // most of these without a meaningful cost increase. Also detects 429
  // (budget / rate limit) and returns a sentinel so the POST handler can
  // surface it distinctly from a normal llm-failed.
  let parsed: any = null;
  let last429 = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
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
      if (resp.status === 429) {
        last429 = true;
        console.warn(`[FG-DIAG] anthropic 429 (budget/rate limit) for ${ticker}`);
        break;  // don't retry budget exceeded
      }
      if (!resp.ok) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 500 + Math.random() * 500)); continue; }
        break;
      }
      const data = await resp.json();
      const raw = (data?.content || []).map((b: any) => b?.text || '').join('').trim();
      if (!raw) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 500 + Math.random() * 500)); continue; }
        break;
      }
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        parsed = JSON.parse(cleaned);
        break;  // success
      } catch {
        if (attempt === 0) {
          console.warn(`[FG-DIAG] haiku non-JSON for ${ticker} on attempt 1, retrying...`);
          await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
          continue;
        }
        break;
      }
    } catch (e) {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 500 + Math.random() * 500)); continue; }
      console.warn(`[FG-DIAG] haiku fetch error for ${ticker}:`, (e as Error).message);
      break;
    }
  }
  if (last429) {
    // Sentinel: budget exceeded. Caller distinguishes from llm-failed.
    return { __budgetExceeded: true } as any;
  }
  if (!parsed) return null;

  try {
    if (!['Positive', 'Neutral', 'Negative', 'NoGuidance'].includes(parsed.label)) return null;
    const score = typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0;
    return {
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
      extracted_at: new Date().toISOString(),
    };
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
  ticker: string,
  pdfText: string,
  source: AIForwardGuidance['source'],
  sourceUrl: string,
  sourceFilename: string,
  period: string,
  apiKey: string,
  force: boolean,
): Promise<AIForwardGuidance | { __budgetExceeded: true } | null> {
  // force=true means user explicitly wants a fresh call; don't share.
  if (force) return extractForwardGuidance(ticker, pdfText, source, sourceUrl, sourceFilename, period, apiKey) as any;
  const key = `haiku-fg:v2:${ticker.toUpperCase()}:${period}`;
  const existing = _haikuInFlight.get(key);
  if (existing) {
    console.log(`[FG-DIAG] dedup hit for ${ticker} (${period}) — sharing in-flight Haiku call`);
    return existing;
  }
  const p = (extractForwardGuidance(ticker, pdfText, source, sourceUrl, sourceFilename, period, apiKey) as any) as Promise<AIForwardGuidance | { __budgetExceeded: true } | null>;
  _haikuInFlight.set(key, p);
  // Cleanup on resolve/reject — keep in-flight only during active call.
  p.finally(() => _haikuInFlight.delete(key));
  return p;
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

  // PATCH 0961 — hard cap reduced 25 → 8 to keep wall-clock under Vercel's
  // 55s maxDuration. With internal CONCURRENT=6 below, an 8-ticker request
  // completes in ~1-2 waves of ~25s each = ~30-50s, well inside budget.
  // Previously CHUNK=25 × CONCURRENT=4 needed ~6 internal waves = 120-200s
  // → 504 timeouts → silent null results. That's how 217 tickers became
  // "only 4 extracted" while still billing Haiku for half of them.
  const capped = items.slice(0, 8);

  // PATCH 0951/0953/0956 — stat tracking.
  //   intimation_only — every NSE PDF was a notice (Haiku skipped)
  //   screener_fallback — NSE was intimation-only / had nothing, but Screener.in
  //                       had a real transcript and the extraction worked
  //   budget_exceeded  — Anthropic returned 429 (rate limit / monthly cap)
  const stats = { cached: 0, extracted: 0, intimation_only: 0, screener_fallback: 0, missing_pdf: 0, llm_failed: 0, budget_exceeded: 0, total: capped.length };
  const results: Record<string, AIForwardGuidance | null> = {};
  // PATCH 0949a — collect per-ticker diagnostics so the UI can show why each
  // ticker failed without us having to scrape Vercel logs.
  const diagnostics: Array<PdfLookupDiag & { stage?: 'pdf-empty' | 'llm-failed' }> = [];

  // PATCH 0961 — bumped from 4 → 6 to flush an 8-ticker request in ≤2 waves
  // (was 6-7 waves at CHUNK=25). Combined with capped=8, total wall time
  // fits under Vercel's 55s. Per-ticker latency is bounded by Haiku call
  // (~5-15s) + PDF fetch+parse (~2-5s) + optional Screener fallback (~5-8s).
  const CONCURRENT = 6;
  for (let i = 0; i < capped.length; i += CONCURRENT) {
    const wave = capped.slice(i, i + CONCURRENT);
    await Promise.all(wave.map(async ({ ticker, period }) => {
      const T = (ticker || '').toUpperCase().trim();
      const P = (period || '').trim() || 'unknown';
      if (!T) { results[ticker] = null; return; }
      // PATCH 0951 — bumped cache key from v1 → v2. New schema includes
      // numbers + catalysts + NoGuidance label; old v1 results don't have
      // those fields. Forcing a re-extract is cheap (intimation skip will
      // catch most of the waste) and gives every ticker the new prompt.
      const key = `haiku-fg:v2:${T}:${P}`;

      // 1) Cache check (skipped if force=true)
      if (!force && isRedisAvailable()) {
        try {
          const cached = await kvGet<AIForwardGuidance>(key);
          if (cached) { results[T] = cached; stats.cached++; return; }
        } catch {}
      }

      // 2) Find concall PDF (returns intimation-only outcome when every
      //    candidate is a notice/intimation — skip Haiku to save cost).
      const lookup = await findConcallPdfUrl(T);
      if (lookup.url === null) {
        if (lookup.diag.outcome === 'intimation-only') {
          // PATCH 0951a — return a synthetic NoGuidance result so the dashboard
          // chip flips to grey "No fwd guidance — only intimation filed" and
          // OVERWRITES any stale Haiku output cached from earlier runs that
          // used to call Haiku on intimation PDFs and got Neutral 0.00.
          const noGuidance: AIForwardGuidance = {
            label: 'NoGuidance',
            score: 0,
            confidence: 'HIGH',
            rationale: 'Only intimation/notice PDFs filed on NSE — no transcript content yet to extract. Try again after the company uploads the actual transcript.',
            quotes: [],
            numbers: [],
            catalysts: [],
            source: 'press-release',
            source_filename: lookup.diag.filename,
            period: P,
            extracted_at: new Date().toISOString(),
          };
          results[T] = noGuidance;
          stats.intimation_only++;
          diagnostics.push(lookup.diag);
          return;
        }
        results[T] = null;
        stats.missing_pdf++;
        diagnostics.push(lookup.diag);
        return;
      }

      // 3) Extract PDF text
      let pdfText = '';
      try {
        const ext = await extractFirstPdf([lookup.url]);
        if (ext && ext.text && ext.text.length >= 200) pdfText = ext.text;
      } catch (e) {
        console.warn('[FG-DIAG] extract error', T, (e as Error).message);
      }
      if (!pdfText || pdfText.length < 1200) {
        // PATCH 0951 — < 1200 chars is intimation-equivalent (even if filename
        // looked promising, the actual content is too thin). Tag as intimation
        // outcome so the user sees the honest reason.
        results[T] = null;
        stats.intimation_only++;
        diagnostics.push({ ...lookup.diag, outcome: 'intimation-only', stage: 'pdf-empty' });
        return;
      }

      // 4) Haiku extract — with one-shot retry inside (P0956) and
      //    server-side in-flight dedup (P0957) so concurrent identical
      //    requests don't bill Haiku twice for the same ticker+period.
      const fg = await extractForwardGuidanceDedup(T, pdfText, lookup.source, lookup.url, lookup.filename, P, apiKey, force);
      // PATCH 0956 — budget-exceeded sentinel from extractForwardGuidance
      if (fg && (fg as any).__budgetExceeded) {
        results[T] = null;
        stats.budget_exceeded++;
        diagnostics.push({ ...lookup.diag, stage: 'llm-failed', error: 'Anthropic 429: budget/rate limit exceeded' });
        return;
      }
      if (!fg) {
        results[T] = null;
        stats.llm_failed++;
        diagnostics.push({ ...lookup.diag, stage: 'llm-failed' });
        return;
      }

      // 5) Cache + return — narrow type (we already returned above for the
      // budget-exceeded sentinel and the null case).
      const fgGuidance = fg as AIForwardGuidance;
      if (isRedisAvailable()) {
        try { await kvSet(key, fgGuidance, CACHE_TTL_S); } catch {}
      }
      results[T] = fgGuidance;
      stats.extracted++;
      // PATCH 0953 — also track that Screener.in fallback rescued this ticker
      // (NSE had nothing, Screener.in had the real transcript). Visible in
      // stats banner so the user knows the fallback paid off.
      if (lookup.diag.outcome === 'ok-screener-fallback') stats.screener_fallback++;
      diagnostics.push(lookup.diag);
    }));
  }

  return NextResponse.json({ results, stats, diagnostics, generated_at: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

// ─── GET helper — single-ticker probe for debugging ────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  const period = url.searchParams.get('period') || 'unknown';
  if (!ticker) return NextResponse.json({ error: 'ticker query required' }, { status: 400 });
  // Reuse POST flow with one item
  const fakeReq = {
    json: async () => ({ items: [{ ticker, period }], force: url.searchParams.get('force') === '1' }),
  } as NextRequest;
  return POST(fakeReq);
}
