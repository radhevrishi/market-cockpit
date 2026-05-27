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

// ─── Step 1: Find latest concall PDF URL for a ticker ──────────────────────
async function findConcallPdfUrl(ticker: string): Promise<{ url: string; source: AIForwardGuidance['source']; subject: string } | null> {
  try {
    // Read general filings blob (covers analyst meets / transcripts / investor presentations)
    const res = await fetch(`${CF_WORKER_URL}/api/filings/latest`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = await res.json();
    const filings: CFFilingItem[] = (json?.filings || []);
    const tkr = ticker.toUpperCase();
    // Filter to this ticker, freshest first
    const ours = filings
      .filter(f => (f.symbol || '').toUpperCase() === tkr)
      .filter(f => !!f.attachment_url)
      .sort((a, b) => (b.filing_date || '').localeCompare(a.filing_date || ''));
    if (ours.length === 0) return null;

    // Preference order — transcript > investor presentation > press release > anything
    const preferRe = [
      /transcript|earnings call|conference call|concall/i,
      /investor presentation|results presentation|q[1-4]\s+presentation/i,
      /press release/i,
    ];
    for (const re of preferRe) {
      const match = ours.find(f => re.test(f.subject || ''));
      if (match) {
        const source: AIForwardGuidance['source'] =
          /press release/i.test(match.subject) ? 'press-release' :
          /investor presentation|results presentation/i.test(match.subject) ? 'investor-presentation' :
          'concall-transcript';
        return { url: match.attachment_url!, source, subject: match.subject };
      }
    }
    // Fall through: take freshest with any attachment
    return { url: ours[0].attachment_url!, source: 'press-release', subject: ours[0].subject };
  } catch {
    return null;
  }
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
      if (!lookup) { results[T] = null; stats.missing_pdf++; return; }

      // 3) Extract PDF text
      let pdfText = '';
      try {
        const ext = await extractFirstPdf([lookup.url]);
        if (ext && ext.text && ext.text.length >= 200) pdfText = ext.text;
      } catch {}
      if (!pdfText) { results[T] = null; stats.missing_pdf++; return; }

      // 4) Haiku extract
      const fg = await extractForwardGuidance(T, pdfText, lookup.source, lookup.url, P, apiKey);
      if (!fg) { results[T] = null; stats.llm_failed++; return; }

      // 5) Cache + return
      if (isRedisAvailable()) {
        try { await kvSet(key, fg, CACHE_TTL_S); } catch {}
      }
      results[T] = fg;
      stats.extracted++;
    }));
  }

  return NextResponse.json({ results, stats, generated_at: new Date().toISOString() }, {
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
