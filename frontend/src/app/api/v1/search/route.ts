// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/search — search the companies' own documents (zzz1051; lib/doc-search).
//
//   GET  ?q=<words>&market=IN|US&from=YYYY-MM-DD&to=&kinds=TRANSCRIPT,PRESENTATION&tickers=A,B&quarter=Q1 FY27
//        &rerank=1&limit=40                         → ranked passages (company, document, date, link, why matched)
//   GET  ?coverage=1                                 → documents indexed / in the store, passages, vectors, mode, today's spend vs ceilings
//   GET  ?eval=1[&rerank=1]                          → recall@10 / MRR for keyword, hybrid (and hybrid + rerank) on the label file
//   POST ?eval=1  { labels: [{ q, phrases, tickers? }] } → same, on posted labels
//   POST ?index=1                                    → one index slice now (the app scheduler runs it hourly)
//
// PROTECTED (lib/site-auth PROTECTED_API_PREFIXES '/api/v1/search'): owner cookie or service key; re-checked here.
// Paid work is bounded by SEARCH_EMBED_DAILY_USD (default $0.10) and SEARCH_RERANK_DAILY_USD (default $0.05).
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { siteAuthOk } from '@/lib/site-auth-request';
import { parseFilters } from '@/lib/doc-search/rank';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const NO_STORE = { 'Cache-Control': 'no-store' };
const deny = () => NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });

export async function GET(req: Request) {
  if (!(await siteAuthOk(req))) return deny();
  const sp = new URL(req.url).searchParams;
  try {
    const store = await import('@/lib/doc-search/store');
    if (sp.get('coverage') === '1') return NextResponse.json(await store.coverage(), { headers: NO_STORE });
    if (sp.get('eval') === '1') {
      const { runEval } = await import('@/lib/doc-search/eval-run');
      return NextResponse.json({ ok: true, ...(await runEval({ rerank: sp.get('rerank') === '1', filters: parseFilters(sp) })) }, { headers: NO_STORE });
    }
    const q = String(sp.get('q') || '').trim();
    if (q.length < 2 || q.length > 300) return NextResponse.json({ ok: false, error: 'q must be 2–300 characters' }, { status: 400, headers: NO_STORE });
    const limit = Number(sp.get('limit')) || 40;
    const r = await store.searchDocs(q, parseFilters(sp), { limit, rerank: sp.get('rerank') === '1' });
    return NextResponse.json(r, { status: r.ok ? 200 : 503, headers: NO_STORE });
  } catch (e: any) {
    console.error('[search] failed:', String(e?.message || e).slice(0, 200));
    return NextResponse.json({ ok: false, error: 'search failed' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  if (!(await siteAuthOk(req))) return deny();
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get('index') === '1') {
      const { runIndexJob } = await import('@/lib/doc-search/store');
      const r = await runIndexJob({ budgetMs: 8 * 60_000 });
      return NextResponse.json(r, { status: r.ok ? 200 : 503, headers: NO_STORE });
    }
    if (sp.get('eval') === '1') {
      const text = await req.text();
      if (text.length > 200_000) return NextResponse.json({ ok: false, error: 'body too large' }, { status: 413, headers: NO_STORE });
      let raw: unknown = null;
      try { raw = JSON.parse(text || '{}'); } catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: NO_STORE }); }
      const { validLabels } = await import('@/lib/doc-search/eval');
      const labels = validLabels(raw);
      if (!labels.length) return NextResponse.json({ ok: false, error: 'no valid labels ({ labels: [{ q, phrases: [] }] })' }, { status: 400, headers: NO_STORE });
      const { runEval } = await import('@/lib/doc-search/eval-run');
      return NextResponse.json({ ok: true, ...(await runEval({ labels, rerank: sp.get('rerank') === '1', filters: parseFilters(sp) })) }, { headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: 'use ?index=1 or ?eval=1' }, { status: 400, headers: NO_STORE });
  } catch (e: any) {
    console.error('[search] POST failed:', String(e?.message || e).slice(0, 200));
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500, headers: NO_STORE });
  }
}
