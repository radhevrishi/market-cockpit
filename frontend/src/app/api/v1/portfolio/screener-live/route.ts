// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/portfolio/screener-live?tickers=A,B,C                  (zzz764)
//
// The financial row for names the graded bench and the static screener CSV
// do not carry, parsed from screener.in's company page. Called by the book
// page in small batches AFTER the first paint, for rows whose source is
// 'none' or the thinner CSV. Cached 24h per ticker (a quarter's table does
// not change within a day); a failure is cached 6h so an unreachable page is
// not re-hit on every load. No model call anywhere.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchScreenerFinancials, isCurrentPeriod, type ScreenerFinancials } from '@/lib/thesis/screener-financials';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX = 12;
const TTL_OK = 24 * 3600;
const TTL_FAIL = 6 * 3600;
const key = (t: string) => `thesis:screener-live:v1:${t}`;

export async function GET(req: NextRequest) {
  const tickers = (new URL(req.url).searchParams.get('tickers') || '')
    .split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9][A-Z0-9&-]*$/.test(s)).slice(0, MAX);
  if (!tickers.length) return NextResponse.json({ ok: false, error: 'tickers is required' }, { status: 400 });
  const rows: Record<string, ScreenerFinancials | null> = {};
  const errors: Record<string, string> = {};
  let i = 0;
  const worker = async () => {
    while (i < tickers.length) {
      const t = tickers[i++];
      try {
        const hit = await kvGet<{ row: ScreenerFinancials | null; error: string | null }>(key(t));
        if (hit && (hit.row ? isCurrentPeriod(hit.row.period) : true)) {
          rows[t] = hit.row; if (hit.error) errors[t] = hit.error; continue;
        }
      } catch { /* a cold cache is not an error */ }
      const got = await fetchScreenerFinancials(t);
      rows[t] = got.row;
      if (got.error) errors[t] = got.error;
      try { await kvSet(key(t), got, got.row ? TTL_OK : TTL_FAIL); } catch { /* best-effort */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tickers.length) }, worker));
  return NextResponse.json({ ok: true, rows, errors });
}
