// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTELLIGENCE — per-ticker corpus
//
// GET  /api/v1/company-intel/<TICKER>       → return persisted corpus + guidance
// POST /api/v1/company-intel/<TICKER>       → append a document to the corpus
// DELETE /api/v1/company-intel/<TICKER>     → drop the corpus (admin / reset)
//
// Storage shape (KV):
//   key:  company-intel:v1:<TICKER>
//   value: {
//     ticker, company,
//     documents: [{ id, kind, title, text, uploaded_at, size_chars }],
//     guidance:  [{ category, text, quote, year, pct, inrCr, source_doc_id }],
//     updated_at,
//   }
//
// Re-upload behaviour:
//   - We MERGE — new documents are appended; old ones are NOT deleted.
//   - Each document's guidance items carry the source doc_id so the UI
//     can show which upload produced which line.
//   - Dedup is by (category, text) — a re-upload of the same transcript
//     does not produce duplicate guidance rows.
//
// Document size cap: 200 kB per upload (Vercel body limit headroom).
// Total corpus cap: 50 docs × 200 kB = 10 MB per ticker. Older docs auto-
// drop when the cap is hit (FIFO).
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, kvDel, isRedisAvailable } from '@/lib/kv';
import { extractGuidance, guidanceSummary } from '@/lib/company-intel/guidance-extractor';
// PATCH 0458 — maintainIndex lives in /lib now; route files can't export helpers.
import { maintainCompanyIntelIndex as maintainIndex } from '@/lib/company-intel/index-maintenance';
import type { IntelDocument, IntelCorpus } from '@/lib/company-intel/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const KEY = (t: string) => `company-intel:v1:${t.toUpperCase()}`;
const MAX_DOCS = 50;
const MAX_DOC_CHARS = 200_000;
const TTL_S = 365 * 24 * 3600; // 1 year

// PATCH 0458 — IntelDocument / IntelCorpus types moved to
// @/lib/company-intel/types so Next.js route file doesn't try to export
// them. They are imported at the top of the file.

function normalizeTicker(t: string): string {
  return (t || '').toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO|BSE|NSE)$/, '').trim();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tk = normalizeTicker(ticker);
  if (!tk) return NextResponse.json({ error: 'invalid ticker' }, { status: 400 });
  if (!isRedisAvailable()) return NextResponse.json({ ticker: tk, documents: [], guidance: [], updated_at: new Date().toISOString() });

  try {
    const corpus = await kvGet<IntelCorpus>(KEY(tk));
    if (!corpus) {
      return NextResponse.json({
        ticker: tk, documents: [], guidance: [], summary: '', updated_at: new Date(0).toISOString(),
      });
    }
    return NextResponse.json(corpus);
  } catch (e: any) {
    return NextResponse.json({ error: 'kv-read-failed', message: e?.message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tk = normalizeTicker(ticker);
  if (!tk) return NextResponse.json({ error: 'invalid ticker' }, { status: 400 });
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid-json' }, { status: 400 }); }

  const text = String(body?.text || '').slice(0, MAX_DOC_CHARS).trim();
  if (text.length < 30) {
    return NextResponse.json({ error: 'text too short — paste full transcript/PPT' }, { status: 400 });
  }
  const kind: IntelDocument['kind'] = ['concall_transcript','earnings_ppt','guidance_doc','investor_presentation','manual','other'].includes(body?.kind) ? body.kind : 'manual';
  const title = String(body?.title || `${kind} ${new Date().toLocaleDateString('en-IN')}`).slice(0, 200);
  const company = body?.company ? String(body.company).slice(0, 200) : undefined;

  // Read existing corpus
  let corpus: IntelCorpus | null = null;
  try {
    corpus = await kvGet<IntelCorpus>(KEY(tk));
  } catch {}
  if (!corpus) {
    corpus = { ticker: tk, company, documents: [], guidance: [], updated_at: new Date().toISOString() };
  }
  if (company && !corpus.company) corpus.company = company;

  // Append the new doc
  const doc: IntelDocument = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind, title, text,
    uploaded_at: new Date().toISOString(),
    size_chars: text.length,
  };
  corpus.documents.push(doc);
  // FIFO trim
  if (corpus.documents.length > MAX_DOCS) {
    corpus.documents = corpus.documents.slice(-MAX_DOCS);
  }

  // Extract guidance from the new doc; merge into existing list, de-dup by (category, text).
  const fresh = extractGuidance(text).map(g => ({ ...g, source_doc_id: doc.id }));
  const existingKeys = new Set(corpus.guidance.map(g => `${g.category}|${g.text}`));
  for (const g of fresh) {
    const key = `${g.category}|${g.text}`;
    if (!existingKeys.has(key)) {
      corpus.guidance.push(g);
      existingKeys.add(key);
    }
  }

  // Also re-derive across ALL retained documents periodically (every 5th
  // upload) so deletions or text refinements eventually clean up the list.
  if (corpus.documents.length % 5 === 0) {
    const merged: typeof corpus.guidance = [];
    const seen = new Set<string>();
    for (const d of corpus.documents) {
      const items = extractGuidance(d.text);
      for (const i of items) {
        const k = `${i.category}|${i.text}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push({ ...i, source_doc_id: d.id });
      }
    }
    corpus.guidance = merged;
  }

  corpus.summary = guidanceSummary(corpus.guidance);
  corpus.updated_at = new Date().toISOString();

  try {
    await kvSet(KEY(tk), corpus, TTL_S);
    await maintainIndex(tk);
  } catch (e: any) {
    return NextResponse.json({ error: 'kv-write-failed', message: e?.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ticker: tk,
    doc_id: doc.id,
    doc_count: corpus.documents.length,
    guidance_count: corpus.guidance.length,
    guidance_extracted_now: fresh.length,
    summary: corpus.summary,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tk = normalizeTicker(ticker);
  if (!tk) return NextResponse.json({ error: 'invalid ticker' }, { status: 400 });
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });
  try {
    await kvDel(KEY(tk));
    return NextResponse.json({ ok: true, ticker: tk });
  } catch (e: any) {
    return NextResponse.json({ error: 'kv-delete-failed', message: e?.message }, { status: 500 });
  }
}
