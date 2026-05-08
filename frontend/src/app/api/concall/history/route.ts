import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { rateLimitResponse } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────
// /api/concall/history — store and retrieve concall extractions per ticker
//
// Stores guidance + topQuotes + tone counts + score per (ticker, period) so
// that the Concall Contradiction Engine can later compare what management
// said in Q-1 vs what actually happened in Q.
//
// GET  ?ticker=X        — returns stored history (newest first)
// POST { ticker, period, snapshot } — appends a snapshot to history
// ─────────────────────────────────────────────────────────────────────────

const KEY = (ticker: string) => `concall-history:${ticker.toUpperCase()}`;
const MAX_ENTRIES = 12;

interface ConcallSnapshot {
  period: string;
  capturedAt: string;
  concallScore: number;
  concallGrade: string;
  positiveCount: number;
  negativeCount: number;
  cautiousCount: number;
  guidanceDirection: string;
  guidanceCommentary: string[];
  topQuotes: string[];
  // Actual outcomes — added retroactively when next quarter's data lands
  actualRevenue?: number | null;
  actualPat?: number | null;
}

export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 60, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim();
  if (!ticker) return NextResponse.json({ ok: false, error: 'Missing ticker' }, { status: 400 });

  const history = await kvGet<ConcallSnapshot[]>(KEY(ticker)).catch(() => null);
  return NextResponse.json({ ok: true, ticker, history: history || [] });
}

export async function POST(request: Request) {
  const limited = rateLimitResponse(request, 30, 60_000);
  if (limited) return limited;

  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const ticker: string | undefined = body.ticker;
  const snapshot: ConcallSnapshot | undefined = body.snapshot;
  if (!ticker || !snapshot?.period) {
    return NextResponse.json({ ok: false, error: 'ticker and snapshot.period required' }, { status: 400 });
  }

  const existing = (await kvGet<ConcallSnapshot[]>(KEY(ticker)).catch(() => null)) || [];
  // Replace if same period already stored, else prepend
  const filtered = existing.filter((e) => e.period !== snapshot.period);
  const updated = [snapshot, ...filtered].slice(0, MAX_ENTRIES);
  await kvSet(KEY(ticker), updated, 365 * 24 * 3600).catch(() => null);

  return NextResponse.json({ ok: true, ticker, stored: updated.length });
}
