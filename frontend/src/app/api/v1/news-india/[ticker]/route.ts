// PATCH 0724 — Free Indian-smallcap news endpoint.
//
// GET /api/v1/news-india/<ticker>?company=<optional company name>
//
// Returns an array of NewsItem rows merged from Yahoo Finance + Google
// News RSS. KV-cached for 6 hours so repeated Home Movers loads from
// many browsers don't re-hit the upstream RSS endpoints.
//
// This is the FALLBACK source for Indian tickers the main /api/v1/news
// pipeline misses — MINDACORP, SPARC, RATEGAIN class smallcaps where
// the editorial-curated news cache is empty but Google News still has
// coverage.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { fetchIndianNews, type NewsItem } from '@/lib/indian-news-rss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const KEY = (ticker: string) => `news-india:v1:${ticker.toUpperCase()}`;
const TTL_SECONDS = 6 * 60 * 60; // 6h

interface CachedPayload {
  ticker: string;
  articles: NewsItem[];
  generatedAt: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const sym = (rawTicker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  if (!sym) {
    return NextResponse.json(
      { error: 'ticker required', articles: [] },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const company = (url.searchParams.get('company') || '').trim();

  // ── Cache read ──────────────────────────────────────────────────
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<CachedPayload>(KEY(sym));
      if (cached && Array.isArray(cached.articles)) {
        return NextResponse.json({
          ticker: sym,
          articles: cached.articles,
          cached: true,
          generatedAt: cached.generatedAt,
        });
      }
    } catch {
      /* fall through to live fetch */
    }
  }

  // ── Live fetch ──────────────────────────────────────────────────
  let articles: NewsItem[] = [];
  try {
    articles = await fetchIndianNews(sym, company || undefined);
  } catch {
    articles = [];
  }

  const generatedAt = new Date().toISOString();

  // Cache even empty results — prevents hammering RSS endpoints for
  // tickers genuinely without coverage. 6h TTL still gives them time
  // to recover when news drops.
  if (isRedisAvailable()) {
    try {
      await kvSet(
        KEY(sym),
        { ticker: sym, articles, generatedAt } as CachedPayload,
        TTL_SECONDS,
      );
    } catch {
      /* best-effort */
    }
  }

  return NextResponse.json({
    ticker: sym,
    articles,
    cached: false,
    generatedAt,
  });
}
