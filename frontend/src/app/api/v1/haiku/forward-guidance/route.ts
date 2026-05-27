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

export interface AIForwardGuidance {
  label: 'Positive' | 'Neutral' | 'Negative';
  score: number;              // [-1, +1] — signed magnitude
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;          // 1-2 sentence summary
  quotes: string[];           // up to 4 verbatim forward statements
  source: 'concall-transcript' | 'investor-presentation' | 'press-release';
  source_url?: string;
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

// PATCH 0949a — per-ticker diagnostic trace. Surfaced both in console logs
// (Vercel) AND in the response body so the dashboard can show WHY a ticker
// returned no concall PDF without us having to grep logs. Possible reasons:
//   'cf-error'         CF Worker filings endpoint failed (network/timeout/HTTP)
//   'no-filings'       CF returned filings but none for this ticker
//   'no-attachment'    Ticker has filings but none with attachment_url
//   'ok'               Found a usable PDF URL (with preference order)
export interface PdfLookupDiag {
  ticker: string;
  outcome: 'cf-error' | 'no-filings' | 'no-attachment' | 'ok';
  total_filings_seen?: number;
  ticker_filings?: number;
  ticker_with_attachment?: number;
  matched_preference?: 'transcript' | 'investor-presentation' | 'press-release' | 'fallback';
  subject?: string;
  url?: string;
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

// ─── Step 1: Find latest concall PDF URL for a ticker ──────────────────────
async function findConcallPdfUrl(ticker: string): Promise<
  | { url: string; source: AIForwardGuidance['source']; subject: string; diag: PdfLookupDiag }
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
  if (tickerFilings.length === 0) {
    const diag: PdfLookupDiag = {
      ticker: tkr, outcome: 'no-filings',
      total_filings_seen: filings.length, ticker_filings: 0,
    };
    console.warn('[FG-DIAG]', diag);
    return { url: null, diag };
  }
  if (withAttachment.length === 0) {
    const diag: PdfLookupDiag = {
      ticker: tkr, outcome: 'no-attachment',
      total_filings_seen: filings.length,
      ticker_filings: tickerFilings.length,
      ticker_with_attachment: 0,
    };
    console.warn('[FG-DIAG]', diag);
    return { url: null, diag };
  }
  const ours = withAttachment.sort((a, b) => (b.filing_date || '').localeCompare(a.filing_date || ''));

  // PATCH 0950a — broadened preference regex. NSE's standard subject for
  // concall material is the exact string
  //   "Analysts/Institutional Investor Meet/Con. Call Updates"
  // — the old regex looking for "concall" never matched. Cover the actual
  // NSE text and the common transcript / call wording side-by-side. Order
  // remains: transcript > presentation > press release > anything.
  const preferences: Array<{ re: RegExp; tag: 'transcript' | 'investor-presentation' | 'press-release' }> = [
    { re: /transcript|earnings\s*call|conference\s*call|concall|con\.?\s*call|analysts?\/institutional\s*investor\s*meet/i, tag: 'transcript' },
    { re: /investor\s*presentation|results?\s*presentation|q[1-4]\s*presentation|earnings\s*presentation/i, tag: 'investor-presentation' },
    { re: /press\s*release|outcome\s*of\s*board|board\s*meeting/i, tag: 'press-release' },
  ];
  for (const p of preferences) {
    const match = ours.find(f => p.re.test(f.subject || ''));
    if (match) {
      const source: AIForwardGuidance['source'] =
        p.tag === 'transcript' ? 'concall-transcript' :
        p.tag === 'investor-presentation' ? 'investor-presentation' : 'press-release';
      const diag: PdfLookupDiag = {
        ticker: tkr, outcome: 'ok',
        total_filings_seen: filings.length,
        ticker_filings: tickerFilings.length,
        ticker_with_attachment: ours.length,
        matched_preference: p.tag,
        subject: match.subject,
        url: match.attachment_url!,
      };
      console.log('[FG-DIAG]', diag);
      return { url: match.attachment_url!, source, subject: match.subject, diag };
    }
  }
  // Fallback: freshest with any attachment (not in any preference bucket)
  const diag: PdfLookupDiag = {
    ticker: tkr, outcome: 'ok',
    total_filings_seen: filings.length,
    ticker_filings: tickerFilings.length,
    ticker_with_attachment: ours.length,
    matched_preference: 'fallback',
    subject: ours[0].subject,
    url: ours[0].attachment_url!,
  };
  console.log('[FG-DIAG]', diag);
  return { url: ours[0].attachment_url!, source: 'press-release', subject: ours[0].subject, diag };
}

// ─── Step 2: Extract forward statements via Haiku ──────────────────────────
async function extractForwardGuidance(
  ticker: string,
  pdfText: string,
  source: AIForwardGuidance['source'],
  sourceUrl: string,
  period: string,
  apiKey: string,
): Promise<AIForwardGuidance | null> {
  if (!pdfText || pdfText.length < 200) return null;

  // Trim to first ~12k chars (forward statements are usually in the management
  // commentary at the top, not in Q&A). Haiku 4.5 input is cheap but PDFs can
  // be 50-100 pages so we don't need everything.
  const text = pdfText.slice(0, 12_000);

  const systemPrompt = `You are an institutional equity research analyst extracting FORWARD-LOOKING guidance from an Indian-listed-company concall transcript or investor presentation. Forward guidance = statements about FUTURE performance (next quarter, FY, multi-year). Ignore backward statements about what happened.

Extract ONLY explicit forward statements such as:
- Revenue / order book / capacity / volume guidance
- Margin / profitability guidance
- Capex / expansion / new plant timing
- Demand / order pipeline outlook
- Strategic milestones (regulatory clearance, new geography, product launch)
- Debt reduction / balance sheet trajectory

Classify overall guidance bias:
- "Positive": management is clearly guiding to growth, margin expansion, or strategic upside
- "Negative": management is flagging risks, slowdown, margin pressure, headwinds
- "Neutral": guidance is balanced, in-line with current run-rate, or absent

Score in [-1, +1]:  +0.6 to +1.0 = strong positive · +0.1 to +0.5 = mild positive · -0.1 to +0.1 = neutral · -0.5 to -0.1 = mild negative · -1.0 to -0.6 = strong negative

Output JSON ONLY (no markdown, no commentary). Schema:
{
  "label": "Positive|Neutral|Negative",
  "score": <number in [-1, 1]>,
  "confidence": "HIGH|MEDIUM|LOW",
  "rationale": "<one or two sentence summary, max 200 chars>",
  "quotes": ["<verbatim forward statement 1>", "<verbatim 2>", "<verbatim 3 — up to 4 max>"]
}

confidence = HIGH if multiple explicit forward statements present, MEDIUM if 1-2 forward statements, LOW if guidance is implicit or sparse.`;

  const userPrompt = `Ticker: ${ticker}\nPeriod: ${period}\nSource: ${source}\n\n=== CONCALL / PRESENTATION TEXT ===\n${text}`;

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
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw = (data?.content || []).map((b: any) => b?.text || '').join('').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch { return null; }
    if (!['Positive', 'Neutral', 'Negative'].includes(parsed.label)) return null;
    const score = typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0;
    return {
      label: parsed.label,
      score,
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence) ? parsed.confidence : 'MEDIUM',
      rationale: String(parsed.rationale || '').slice(0, 240),
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes.slice(0, 4).map((q: any) => String(q).slice(0, 280)) : [],
      source,
      source_url: sourceUrl,
      period,
      extracted_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
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

  // Hard cap — protect Vercel timeout + Haiku budget. 25 tickers per call.
  const capped = items.slice(0, 25);

  const stats = { cached: 0, extracted: 0, missing_pdf: 0, llm_failed: 0, total: capped.length };
  const results: Record<string, AIForwardGuidance | null> = {};
  // PATCH 0949a — collect per-ticker diagnostics so the UI can show why each
  // ticker failed without us having to scrape Vercel logs.
  const diagnostics: Array<PdfLookupDiag & { stage?: 'pdf-empty' | 'llm-failed' }> = [];

  // Process in 4-concurrent batches so Vercel doesn't open 25 simultaneous PDF fetches
  const CONCURRENT = 4;
  for (let i = 0; i < capped.length; i += CONCURRENT) {
    const wave = capped.slice(i, i + CONCURRENT);
    await Promise.all(wave.map(async ({ ticker, period }) => {
      const T = (ticker || '').toUpperCase().trim();
      const P = (period || '').trim() || 'unknown';
      if (!T) { results[ticker] = null; return; }
      const key = `haiku-fg:v1:${T}:${P}`;

      // 1) Cache check (skipped if force=true)
      if (!force && isRedisAvailable()) {
        try {
          const cached = await kvGet<AIForwardGuidance>(key);
          if (cached) { results[T] = cached; stats.cached++; return; }
        } catch {}
      }

      // 2) Find concall PDF
      const lookup = await findConcallPdfUrl(T);
      if (lookup.url === null) {
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
      if (!pdfText) {
        results[T] = null;
        stats.missing_pdf++;
        diagnostics.push({ ...lookup.diag, stage: 'pdf-empty' });
        return;
      }

      // 4) Haiku extract
      const fg = await extractForwardGuidance(T, pdfText, lookup.source, lookup.url, P, apiKey);
      if (!fg) {
        results[T] = null;
        stats.llm_failed++;
        diagnostics.push({ ...lookup.diag, stage: 'llm-failed' });
        return;
      }

      // 5) Cache + return
      if (isRedisAvailable()) {
        try { await kvSet(key, fg, CACHE_TTL_S); } catch {}
      }
      results[T] = fg;
      stats.extracted++;
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
