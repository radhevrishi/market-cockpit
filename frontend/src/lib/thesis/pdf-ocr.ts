// ═══════════════════════════════════════════════════════════════════════════
// OCR FOR SCANNED FILINGS — without a new dependency.                (zzz765)
//
// MOREPENLAB's and SOTL's filings are image-only PDFs: pdf-parse returns a few
// dozen characters for thirty pages, and the reader recorded `scanned` and
// moved on — the quarter's evidence existed and was unreadable to us.
//
// The Messages API reads a PDF natively when it is sent as a `document`
// content block (base64, application/pdf): each page is seen as an image as
// well as text, so a scan is transcribed. That is OCR with no Tesseract, no
// new package, and the same key and model the reader already uses.
//
// COST DISCIPLINE. This runs ONLY inside a read the owner clicked (the India
// reader's read / incremental / force modes; never `check`, never a cron),
// at most OCR_MAX_PER_READ documents per read, ≤ 10 MB per document, and a
// capped transcription length. A missing key or a failed call is recorded as
// "OCR unavailable" and the reader moves to the next candidate document.
// ═══════════════════════════════════════════════════════════════════════════

import { anthropicMessages, modelConfigured, modelKeyName, type MessagesBody } from '@/lib/anthropic-meter';
import { exchangeProxyFor } from '@/lib/pdf-text-extractor';

export const OCR_MAX_BYTES = 10 * 1024 * 1024;
export const OCR_MAX_TOKENS = 8_000;
export const OCR_MAX_PER_READ = 2;

/**
 * Pure: is this PDF's text layer usable, or is it a scan?
 *   'scanned'   — pages carry almost no text (< 100 chars/page over ≥ 2 pages),
 *                 or the "text" is binary noise from a failed parse
 *   'too_short' — a real but tiny document (an intimation, a cover note)
 *   'ok'        — a text layer worth reading
 */
export function pdfTextQuality(chars: number, pages: number, text?: string | null): 'ok' | 'scanned' | 'too_short' {
  const perPage = pages > 0 ? chars / pages : chars;
  // The extractor truncates at 80 KB, so a 900-page annual report can look
  // thin per page; that much text is never a scan.
  if (chars < 50_000 && pages >= 2 && perPage < 100) return 'scanned';
  // pdf-parse failing falls back to raw bytes: long, but not language.
  if (text && chars >= 1200 && wordShare(text) < 0.35) return 'scanned';
  if (chars < 1200) return 'too_short';
  return 'ok';
}

/** Share of whitespace-separated tokens that look like words or numbers. */
export function wordShare(text: string): number {
  const toks = String(text || '').slice(0, 20_000).split(/\s+/).filter(Boolean);
  if (!toks.length) return 0;
  const good = toks.filter((t) => /^[("'₹$]?[A-Za-z][A-Za-z'’.-]{0,24}[),.:;%"']?$|^[(₹$]?-?\d[\d,.]*%?[),.]?$/.test(t)).length;
  return good / toks.length;
}

/** Pure: the Messages request that asks for a transcription of the PDF. */
export function ocrRequestBody(model: string, base64Pdf: string, label: string): MessagesBody {
  return {
    model,
    max_tokens: OCR_MAX_TOKENS,
    system: 'You transcribe scanned Indian exchange filings. Output only the document text, verbatim, in reading order. Keep every number exactly as printed with its unit (crore, lakh, %, MT). Render tables as one row per line with cells separated by " | ". Do not summarise, interpret, translate or add anything. If a page is illegible write [illegible].',
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
        { type: 'text', text: `Transcribe this filing (${label}). Prioritise the statement of financial results and any management commentary if the output limit is reached.` },
      ],
    }],
  };
}

async function fetchPdfBytes(url: string, timeoutMs: number): Promise<{ buf: Buffer | null; why: string }> {
  const hops = [url, exchangeProxyFor(url)].filter((u): u is string => !!u);
  const why: string[] = [];
  for (const u of hops) {
    try {
      const r = await fetch(u, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/pdf,*/*' },
      });
      if (!r.ok) { why.push(`HTTP ${r.status}`); continue; }
      const len = Number(r.headers.get('content-length') || 0);
      if (len > OCR_MAX_BYTES) return { buf: null, why: `PDF is ${(len / 1048576).toFixed(1)} MB, over the ${OCR_MAX_BYTES / 1048576} MB OCR cap` };
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > OCR_MAX_BYTES) return { buf: null, why: `PDF is ${(buf.length / 1048576).toFixed(1)} MB, over the ${OCR_MAX_BYTES / 1048576} MB OCR cap` };
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { why.push('not a PDF'); continue; }
      return { buf, why: '' };
    } catch (e: any) {
      why.push(e?.name === 'TimeoutError' ? 'timed out' : String(e?.message || e));
    }
  }
  return { buf: null, why: why.join('; ') || 'no response' };
}

export type OcrResult = { ok: true; text: string; detail: 'ocr' } | { ok: false; detail: string };

/**
 * Transcribe a scanned PDF through the Messages API. Never throws: every
 * failure comes back as `{ ok: false, detail: 'OCR unavailable — <why>' }`.
 * The key is checked for presence only and never read into a message.
 */
export async function ocrPdf(url: string, label: string, model: string, opts: { timeoutMs?: number } = {}): Promise<OcrResult> {
  const unavailable = (why: string): OcrResult => ({ ok: false, detail: `OCR unavailable — ${why}`.slice(0, 300) });
  if (!modelConfigured()) return unavailable(`${modelKeyName()} is not configured`);
  const got = await fetchPdfBytes(url, 30_000);
  if (!got.buf) return unavailable(got.why);
  try {
    const resp = await anthropicMessages('catalysts-ocr', ocrRequestBody(model, got.buf.toString('base64'), label),
      { signal: AbortSignal.timeout(opts.timeoutMs || 60_000), anthropicOnly: true });
    if (!resp.ok) {
      let msg = '';
      try { const j = JSON.parse(await resp.text()); msg = String(j?.error?.message || ''); } catch { /* status alone */ }
      return unavailable(`model API HTTP ${resp.status}${msg ? `: ${msg}` : ''}`);
    }
    const j: any = await resp.json();
    const text = (Array.isArray(j?.content) ? j.content : [])
      .filter((c: any) => c?.type === 'text').map((c: any) => String(c.text || '')).join('\n')
      .replace(/[ \t]+/g, ' ').trim();
    if (text.length < 400) return unavailable(`transcription too short (${text.length} chars)`);
    return { ok: true, text, detail: 'ocr' };
  } catch (e: any) {
    return unavailable(e?.name === 'TimeoutError' ? 'model call timed out' : String(e?.message || e));
  }
}

// ── ONE DOCUMENT, READ OR ACCOUNTED FOR.                         (zzz770)
//
// The reader's per-document decision — download, judge the text layer, OCR a
// scan when this read may, or record why not — as one function with its I/O
// injected, so the scanned-PDF path is tested without a network or a model.
// Every failure is an OUTCOME (download_failed / scanned / too_short), never
// an absence of disclosure.

export type DocumentRead =
  | { outcome: 'read'; text: string; pages: number; viaOcr: boolean }
  | { outcome: 'download_failed' | 'scanned' | 'too_short'; chars: number; pages: number; detail?: string };

export interface DocumentReadDeps {
  /** pdf text extraction; null or source 'FAILED' is a failed download. */
  extract: (url: string) => Promise<{ text?: string | null; pages?: number | null; source?: string; failure_reason?: string } | null>;
  /** OCR of a scanned PDF (ocrPdf in production). */
  ocr: (url: string, label: string) => Promise<OcrResult>;
  /** true when this read may spend an OCR call now, else the reason not. */
  ocrGate: () => true | string;
}

export async function readOneDocument(doc: { url: string; label: string }, deps: DocumentReadDeps): Promise<DocumentRead> {
  const e = await deps.extract(doc.url);
  const body = String(e?.text || '');
  const pages = Number(e?.pages || 0);
  if (!e || e.source === 'FAILED') return { outcome: 'download_failed', chars: 0, pages, detail: e?.failure_reason || 'no response' };
  // Below 1,200 characters a one- or two-page file is an intimation or a
  // cover note; a multi-page file with almost no text per page is a scan.
  const quality = pdfTextQuality(body.length, pages, body);
  if (quality === 'too_short') return { outcome: 'too_short', chars: body.length, pages };
  if (quality === 'scanned') {
    const gate = deps.ocrGate();
    const ocr: OcrResult = gate === true ? await deps.ocr(doc.url, doc.label) : { ok: false, detail: gate };
    if (!ocr.ok) return { outcome: 'scanned', chars: body.length, pages, detail: ocr.detail };
    return { outcome: 'read', text: ocr.text, pages, viaOcr: true };
  }
  return { outcome: 'read', text: body, pages, viaOcr: false };
}
