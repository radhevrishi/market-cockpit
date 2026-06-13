// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0388 — PDF text extractor for Concall Intel pipeline.
//
// Fetches a PDF URL, extracts text (truncated to 80KB to stay within budget),
// caches in KV by URL hash for 30 days. Falls back gracefully if pdf-parse
// fails or PDF is image-only.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { createHash } from 'crypto';
import { sanitizePdfText } from '@/lib/pdf-sanitizer';

const CACHE_TTL = 30 * 24 * 60 * 60;  // 30 days
const CACHE_KEY_PREFIX = 'pdf-text:v2';   // v2: post-sanitization
const MAX_TEXT_BYTES = 80_000;        // Cap extracted text size
const FETCH_TIMEOUT_MS = 10000;       // PATCH 1057: was 7000, raised for slow NSE archive PDFs
const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5MB cap — skip huge PDFs

export interface ExtractedPdf {
  url: string;
  text: string;
  bytes: number;
  pages?: number;
  source: 'CACHE' | 'FRESH' | 'FAILED';
  failure_reason?: string;
}

function cacheKey(url: string): string {
  const h = createHash('sha256').update(url).digest('hex').slice(0, 24);
  return `${CACHE_KEY_PREFIX}:${h}`;
}

// PATCH 1057: wrap inner fetch with 1 retry + 500ms backoff for transient
// NSE archive timeouts. Cache check stays outside the retry loop.
export async function extractPdfText(url: string, opts: { signal?: AbortSignal } = {}): Promise<ExtractedPdf> {
  // KV cache check (no retry needed for cache hit)
  if (isRedisAvailable()) {
    const cached = await kvGet<ExtractedPdf>(cacheKey(url));
    if (cached) return { ...cached, source: 'CACHE' };
  }
  // Try once; if FAILED with a fetch-related reason, retry once after 500ms.
  let result = await _extractPdfInner(url, opts);
  if (result.source === 'FAILED' && /HTTP \d|abort|timeout|fetch|network/i.test(result.failure_reason || '')) {
    await new Promise((r) => setTimeout(r, 500));
    result = await _extractPdfInner(url, opts);
  }
  return result;
}

async function _extractPdfInner(url: string, opts: { signal?: AbortSignal } = {}): Promise<ExtractedPdf> {
  // Fetch the PDF
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const signal = opts.signal || controller.signal;

  try {
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/pdf,*/*',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { url, text: '', bytes: 0, source: 'FAILED', failure_reason: `HTTP ${res.status}` };
    }
    // Read content-length to skip huge PDFs
    const lenHdr = res.headers.get('content-length');
    if (lenHdr && parseInt(lenHdr) > MAX_PDF_BYTES) {
      return { url, text: '', bytes: parseInt(lenHdr), source: 'FAILED', failure_reason: 'PDF too large' };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES) {
      return { url, text: '', bytes: buf.length, source: 'FAILED', failure_reason: 'PDF too large' };
    }

    // Lazy import pdf-parse (heavy lib, only on demand)
    let pdfText = '';
    let pages = 0;
    try {
      const modName = 'pdf-parse';
      const pdfParse = (await import(/* webpackIgnore: true */ modName)).default;
      const out = await pdfParse(buf);
      pdfText = (out.text || '').replace(/\s+/g, ' ').trim();
      pages = out.numpages || 0;
    } catch (err: any) {
      // pdf-parse unavailable or PDF unreadable — try naive UTF-8 extraction
      pdfText = buf.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').trim();
      if (pdfText.length < 200) {
        return { url, text: '', bytes: buf.length, source: 'FAILED', failure_reason: err?.message || 'parse failed' };
      }
    }

    // PATCH 0391 — sanitize before caching so subsequent runs use clean text
    const sanitized = sanitizePdfText(pdfText);
    const truncated = sanitized.text.slice(0, MAX_TEXT_BYTES);
    const result: ExtractedPdf = {
      url,
      text: truncated,
      bytes: buf.length,
      pages,
      source: 'FRESH',
    };

    if (isRedisAvailable()) {
      await kvSet(cacheKey(url), result, CACHE_TTL);
    }
    return result;
  } catch (err: any) {
    clearTimeout(timer);
    return { url, text: '', bytes: 0, source: 'FAILED', failure_reason: err?.message || 'fetch failed' };
  }
}

// Convenience: extract first PDF from a list of attachment URLs
export async function extractFirstPdf(urls: string[]): Promise<ExtractedPdf | null> {
  for (const u of urls) {
    if (!u) continue;
    const lc = u.toLowerCase();
    // Heuristic: skip obvious non-PDFs
    if (lc.endsWith('.zip') || lc.endsWith('.png') || lc.endsWith('.jpg')) continue;
    const ext = await extractPdfText(u);
    if (ext.source !== 'FAILED' && ext.text.length >= 200) return ext;
  }
  return null;
}
