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
import { kvGet, isRedisAvailable } from '@/lib/kv';

// PATCH 0458 — Inline the corpus shape here instead of importing from
// '../[ticker]/route' because Next.js route files are not type-stable
// import targets across the build pipeline (the Vercel build pass
// rejected the export of maintainIndex from this file, and we don't
// want to risk the type import failing the same way).
interface IntelCorpus {
  ticker: string;
  company?: string;
  documents: any[];
  guidance: any[];
  summary?: string;
  updated_at: string;
}

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

// PATCH 0458 — maintainIndex moved to /lib/company-intel/index-maintenance.ts
// because Next.js route files can only export GET/POST/DELETE etc. Any other
// export (even a helper) is rejected by the build.
