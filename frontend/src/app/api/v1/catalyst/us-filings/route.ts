// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/catalyst/us-filings — the SEC filings of the US names on the
// Portfolio Catalysts page, last N days, METADATA ONLY.            (zzz825)
//
// Body:   { tickers: string[], days?: number }   (≤ 200 tickers, ≤ 15 days)
// Answer: { filings: UsFilingMeta[], failed: [{ ticker, error }] }
//
// Each ticker's SEC submissions list (form, 8-K items, date, primary
// document link) — the same list the US gainers research reads — so the
// "New · last 10 days" tab can show an 8-K 5.02 officer change, a 2.01
// closing, a 3.02 sale or a 424B / S-3 offering the ledger never files. No
// document is opened here: the tab reads 8-K bodies lazily through
// /api/v1/catalyst/read-filings. Behind the owner's site login
// (PROTECTED_API_PREFIXES '/api/v1/catalyst/'). Cached per ticker for 2 h.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchEdgarResearch } from '@/lib/ai-gainers/edgar-research';
import type { UsFilingMeta } from '@/lib/catalyst/us-filings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TICKERS = 200;
const CONCURRENCY = 3;
const PER_TICKER_MS = 8_000;
const CALL_BUDGET_MS = 45_000;
const TTL_S = 2 * 3600;
const mem = new Map<string, { at: number; rows: UsFilingMeta[] }>();

const keyOf = (t: string, days: number) => `pc-us-filings:v1:${days}:${t}`;
const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

async function one(ticker: string, days: number, now: Date): Promise<{ rows: UsFilingMeta[] } | { error: string }> {
  const k = keyOf(ticker, days);
  const m = mem.get(k);
  if (m && Date.now() - m.at < TTL_S * 1000) return { rows: m.rows };
  try {
    const hit = await kvGet<UsFilingMeta[]>(k);
    if (Array.isArray(hit)) { mem.set(k, { at: Date.now(), rows: hit }); return { rows: hit }; }
  } catch { /* cold */ }
  const r = await fetchEdgarResearch(ticker, days, now, { timeoutMs: PER_TICKER_MS, readOwnership: false, pressFallback: false });
  if (r.failure) return { error: r.failure === 'cik_not_found' ? 'not an SEC filer' : (r.errors[0] || r.failure) };
  const rows: UsFilingMeta[] = (r.announcements || []).map((a) => ({ ticker, subject: a.subject, url: a.url || null, date: a.dateIso || null }));
  mem.set(k, { at: Date.now(), rows });
  if (mem.size > 1500) mem.delete(mem.keys().next().value as string);
  try { await kvSet(k, rows, TTL_S); } catch { /* memory still holds it */ }
  return { rows };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'body must be JSON' }, { status: 400 }); }
  const days = Math.max(1, Math.min(15, Number(body?.days) || 10));
  const tickers: string[] = Array.from(new Set<string>((Array.isArray(body?.tickers) ? body.tickers : [])
    .map((t: any) => String(t || '').toUpperCase().trim()).filter((t: string) => TICKER.test(t)))).slice(0, MAX_TICKERS);
  if (!tickers.length) return NextResponse.json({ ok: true, filings: [], failed: [] });
  const now = new Date();
  const filings: UsFilingMeta[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];
  let next = 0;
  const worker = async () => {
    while (next < tickers.length) {
      const t = tickers[next++];
      if (CALL_BUDGET_MS - (Date.now() - t0) < PER_TICKER_MS + 1_000) { failed.push({ ticker: t, error: 'not reached in this pass' }); continue; }
      try {
        const got = await one(t, days, now);
        if ('rows' in got) filings.push(...got.rows); else failed.push({ ticker: t, error: got.error });
      } catch (e: any) { failed.push({ ticker: t, error: String(e?.message || e).slice(0, 120) }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tickers.length) }, worker));
  return NextResponse.json({ ok: true, days, filings, failed, ms: Date.now() - t0 }, { headers: { 'Cache-Control': 'no-store' } });
}
