// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTELLIGENCE — index across all stored companies
//
// GET /api/v1/company-intel/index → flat list of every ticker that has at
// least one uploaded document, plus its one-line Growth Guidance summary.
//
// Powers the table view the user asked for (Company Name | Growth Guidance).
//
// Implementation note: Upstash Redis REST doesn't support SCAN cheaply, so
// we maintain a parallel set of known tickers at 'company-intel:index:v1'.
// Updated by the upload route's POST handler (we re-write it on every
// upload below as a side effect).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import type { IntelCorpus } from '../[ticker]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const INDEX_KEY = 'company-intel:index:v1';
const CORPUS_KEY = (t: string) => `company-intel:v1:${t.toUpperCase()}`;

export async function GET() {
  if (!isRedisAvailable()) {
    return NextResponse.json({ rows: [], updated_at: new Date().toISOString() });
  }
  let tickers: string[] = [];
  try {
    tickers = (await kvGet<string[]>(INDEX_KEY)) || [];
  } catch {}
  // Fan-out — cap at 200 known tickers to keep this under the 30s ceiling.
  const limited = Array.from(new Set(tickers.map(t => (t || '').toUpperCase()))).filter(Boolean).slice(0, 200);
  const rows: Array<{
    ticker: string;
    company?: string;
    summary?: string;
    doc_count: number;
    guidance_count: number;
    updated_at: string;
    top_guidance: { category: string; text: string }[];
  }> = [];
  const settled = await Promise.allSettled(limited.map(async (tk) => {
    const corpus = await kvGet<IntelCorpus>(CORPUS_KEY(tk));
    if (!corpus) return null;
    return {
      ticker: tk,
      company: corpus.company,
      summary: corpus.summary,
      doc_count: corpus.documents?.length || 0,
      guidance_count: corpus.guidance?.length || 0,
      updated_at: corpus.updated_at,
      top_guidance: (corpus.guidance || []).slice(0, 5).map(g => ({ category: g.category, text: g.text })),
    };
  }));
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) rows.push(r.value);
  }
  // Newest-uploaded first
  rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return NextResponse.json({ rows, total: rows.length, updated_at: new Date().toISOString() });
}

/** Helper for the [ticker] POST route to maintain the index set. */
export async function maintainIndex(ticker: string): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    const tickers = (await kvGet<string[]>(INDEX_KEY)) || [];
    const tk = ticker.toUpperCase();
    if (!tickers.includes(tk)) {
      tickers.push(tk);
      // Keep last 500 to bound the set.
      const trimmed = tickers.slice(-500);
      await kvSet(INDEX_KEY, trimmed, 365 * 24 * 3600);
    }
  } catch {}
}
