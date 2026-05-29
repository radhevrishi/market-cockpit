// PATCH 0310 — Ticker roles classifier.
//
// GET /api/v1/ticker-roles/<ticker> returns a role label
// (BENEFICIARY / LOSER / NEUTRAL) derived from the last 30 days of news
// for the ticker. Uses existing sentiment + article_type signals from
// the /news pipeline — no LLM, no schema migration.
//
// Caches per-ticker for 24h in KV (ticker-roles:v1:<ticker>).
//
// Upstream: /api/v1/news?ticker=<ticker>&window_days=30 (existing endpoint).
//
// Output:
//   {
//     ticker, role, score, evidence: { bullish, bearish, neutral, total }
//   }
//
// Replaces the client-side heuristic v0 shipped in Patch 0234 with a
// server-side classifier whose result can be authoritative.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { railwaySelfFetch } from '@/lib/railway-self-fetch'; // PATCH 0985

const KEY = (ticker: string) => `ticker-roles:v1:${ticker.toUpperCase()}`;
const TTL_SECONDS = 24 * 60 * 60;

type Role = 'BENEFICIARY' | 'LOSER' | 'NEUTRAL';

interface TickerRoleResult {
  ticker: string;
  role: Role;
  score: number;          // -100 (very bearish) to +100 (very bullish)
  evidence: { bullish: number; bearish: number; neutral: number; total: number };
  generated_at: string;
  source: 'CACHED' | 'COMPUTED' | 'NO_DATA';
}

interface NewsArticle {
  id?: string;
  headline?: string; title?: string;
  sentiment?: string;
  article_type?: string;
  importance_score?: number;
  ticker_symbols?: string[];
  published_at?: string;
}

function normalizeSentiment(s?: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const v = (s || '').toUpperCase();
  if (v === 'BULLISH' || v === 'POSITIVE' || v === 'POS') return 'BULLISH';
  if (v === 'BEARISH' || v === 'NEGATIVE' || v === 'NEG') return 'BEARISH';
  return 'NEUTRAL';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = (rawTicker || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9][A-Z0-9.&-]{0,19}$/.test(ticker)) {
    return NextResponse.json({ error: 'invalid ticker' }, { status: 400 });
  }
  const force = req.nextUrl.searchParams.get('force') === '1';

  // KV cache.
  if (isRedisAvailable() && !force) {
    const cached = await kvGet<TickerRoleResult>(KEY(ticker));
    if (cached) {
      return NextResponse.json({ ...cached, source: 'CACHED' });
    }
  }

  // Fetch last 30d of news for this ticker.
  // We hit our own news API directly via the request origin so this works
  // in both dev (localhost) and prod (Vercel).
  const origin = req.nextUrl.origin;
  let articles: NewsArticle[] = [];
  try {
    const res = await railwaySelfFetch(`${origin}/api/v1/news?ticker=${encodeURIComponent(ticker)}&window_days=30`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      articles = (Array.isArray(data) ? data : (data?.articles ?? data?.data ?? [])) as NewsArticle[];
    }
  } catch {
    // fall through with empty articles
  }

  if (articles.length === 0) {
    const out: TickerRoleResult = {
      ticker,
      role: 'NEUTRAL',
      score: 0,
      evidence: { bullish: 0, bearish: 0, neutral: 0, total: 0 },
      generated_at: new Date().toISOString(),
      source: 'NO_DATA',
    };
    return NextResponse.json(out);
  }

  let bullish = 0, bearish = 0, neutral = 0;
  let weightedScore = 0;
  for (const art of articles) {
    const importance = Math.max(0.1, Math.min(2, (art.importance_score ?? 1) / 50)); // 0.1 .. 2
    const sent = normalizeSentiment(art.sentiment);
    if (sent === 'BULLISH') { bullish++; weightedScore += 10 * importance; }
    else if (sent === 'BEARISH') { bearish++; weightedScore -= 10 * importance; }
    else { neutral++; }
  }

  // Bonus / penalty from article_type heuristics
  for (const art of articles) {
    const t = (art.article_type || '').toUpperCase();
    if (t === 'EARNINGS' || t === 'GUIDANCE') {
      const s = normalizeSentiment(art.sentiment);
      if (s === 'BULLISH') weightedScore += 5;
      if (s === 'BEARISH') weightedScore -= 5;
    }
  }

  const total = articles.length;
  // Normalize to -100 .. +100
  const maxPossible = total * 25; // rough cap
  const score = Math.round(Math.max(-100, Math.min(100, (weightedScore / Math.max(1, maxPossible)) * 100)));

  let role: Role = 'NEUTRAL';
  if (score >= 20) role = 'BENEFICIARY';
  else if (score <= -20) role = 'LOSER';

  const out: TickerRoleResult = {
    ticker,
    role,
    score,
    evidence: { bullish, bearish, neutral, total },
    generated_at: new Date().toISOString(),
    source: 'COMPUTED',
  };

  if (isRedisAvailable()) {
    await kvSet(KEY(ticker), out, TTL_SECONDS);
  }

  return NextResponse.json(out);
}
