// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/guidance-docs/ingest — collectors write company documents. (zzz857)
//
//   POST  { collector, market?: 'IN'|'US', docs: GuidanceDoc[] (≤25, may be []),
//         seen?: [{docId, outcome}], status?: { days: DayStatus[], run? },
//         coverage?: { market, days: { 'YYYY-MM-DD': { status: ok|partial|failed,
//         filings, docs, at } } } } → validates every doc
//         (shape, docId, allowed host: bseindia.com / nseindia.com / sec.gov, or
//         the company's own domain when `exchangeUrl` is an exchange / SEC page)
//         and stores it (lib/guidance-docs-store). Bad docs are rejected one by
//         one; the response lists their index + reason.
//   GET   ?market=IN|US → { known: docIds already stored or skipped } so a
//         collector does not download them again; storage { docs, textBytes };
//         the market's coverage (days read); the collector status (?collector=).
//         zzz916: &extras=1 → intimations (exchange letters whose real document
//         is still to be found; the collector retries them via Screener.in);
//         &queueTickers=1 → India tickers whose call / presentation / release
//         filings sit in the events queue (the collector's Screener.in sweep).
//         zzz921: `reextract: true` (market 'IN' + ≥ 1 document, service key only) = the documents are re-collected: each is stored again as
//         UNEXTRACTED and the extractor's old result for it is cleared, so the extractor reads it again under the current rules.
//   A body over 6 MB is refused with 413 — never truncated.
//
// PROTECTED (lib/site-auth PROTECTED_API_PREFIXES '/api/v1/guidance-docs'):
// middleware requires the owner cookie or a service key; both handlers
// re-check the service key / cookie here. Responses carry counts only — never
// document text, never a key.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { SITE_COOKIE, expectedToken, safeEqual, hasServiceKey } from '@/lib/site-auth';
import { validateIngestBody, ingestDocs, knownDocIds, readCollectorStatus, readCoverage, storageStats, realDocsKv, pendingIntimations, DocsIndexUnreadableError } from '@/lib/guidance-docs-store';
import { readQueue, collectorQueueTickers } from '@/lib/guidance-upgrades-queue';
import { IN_NEED_CALL_KEY, needCallSlice } from '@/lib/need-call';   // zzz1151
import { kvGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 6 * 1024 * 1024;

async function authorised(req: NextRequest): Promise<boolean> {
  if (hasServiceKey(req.headers.get('x-cron-secret')) || hasServiceKey(req.headers.get('x-mc-key'))) return true;
  const want = await expectedToken();
  const got = req.cookies.get(SITE_COOKIE)?.value || '';
  return !!want && !!got && safeEqual(want, got);
}

export async function GET(req: NextRequest) {
  if (!(await authorised(req))) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });
  const sp = new URL(req.url).searchParams;
  const m = sp.get('market');
  const market = m === 'IN' || m === 'US' ? m : undefined;
  const kv = realDocsKv(15_000);   // zzz916: the index is large; a short read used to hand the collector an incomplete known list
  const collector = sp.get('collector');
  const extras = sp.get('extras') === '1' && market === 'IN';
  const wantQueue = sp.get('queueTickers') === '1' && market === 'IN';
  const [known, status, storage, coverage, intimations, queue] = await Promise.all([
    knownDocIds(kv, market),
    collector ? readCollectorStatus(kv, collector) : Promise.resolve(null),
    storageStats(kv),
    market ? readCoverage(kv, market) : Promise.resolve(null),
    extras ? pendingIntimations(kv).catch(() => []) : Promise.resolve(undefined),
    wantQueue ? readQueue().catch(() => null) : Promise.resolve(null),
  ]);
  const queueTickers = wantQueue ? collectorQueueTickers(queue) : undefined;
  // zzz1151 — graded companies with no guidance document at all: a rotating slice for the collector to read their last calls
  const needCall = extras ? needCallSlice(await kvGet<Record<string, string>>(IN_NEED_CALL_KEY).catch(() => null), new Date()) : undefined;
  return NextResponse.json({ ok: true, known, count: known.length, storage, coverage, status, ...(intimations ? { intimations } : {}), ...(queueTickers ? { queueTickers } : {}), ...(needCall ? { needCall } : {}) }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  // service key only: a browser session never needs to write documents
  if (!(hasServiceKey(req.headers.get('x-cron-secret')) || hasServiceKey(req.headers.get('x-mc-key')))) {
    return NextResponse.json({ ok: false, error: 'service key required' }, { status: 401, headers: NO_STORE });
  }
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'body too large' }, { status: 413, headers: NO_STORE });
  let raw: unknown;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'body too large' }, { status: 413, headers: NO_STORE });
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: NO_STORE });
  }
  const v = validateIngestBody(raw);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400, headers: NO_STORE });
  try {
    // zzz916: a longer read timeout (the index is large) — a read that still fails makes ingest refuse (503), never overwrite
    const r = await ingestDocs(v.body, realDocsKv(15_000));
    // zzz1051: the document search index takes the FULL text the collector sent (KV keeps only excerpts). Runs after the
    // answer, never fails the ingest; the hourly doc-search job catches up on anything missed.
    if (v.body.docs.length) {
      const rawDocs = (raw as any)?.docs;
      void import('@/lib/doc-search/store').then((m) => m.indexFromIngest(v.body.docs, rawDocs)).catch(() => {});
    }
    return NextResponse.json({ ok: true, ...r, rejected: v.rejected }, { headers: NO_STORE });
  } catch (e: any) {
    if (e instanceof DocsIndexUnreadableError) return NextResponse.json({ ok: false, error: 'index busy or unreadable; retry' }, { status: 503, headers: NO_STORE });
    console.error('[guidance-docs/ingest] store failed:', String(e?.message || e).slice(0, 200));
    return NextResponse.json({ ok: false, error: 'store failed' }, { status: 500, headers: NO_STORE });
  }
}
