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

  // PATCH 0738 — merge entries from the GitHub-Actions-scraped blob.
  // The scraper runs 4×/day on GH free CPU, pulls 10 Indian RSS feeds,
  // and writes a single consolidated blob to Upstash. We filter that
  // blob for entries mentioning this ticker OR the optional company
  // name and merge alongside the live Yahoo+Google RSS results. This
  // is the principal Indian smallcap coverage path now — Yahoo+Google
  // RSS is sparse for sub-₹5000Cr names; the GH scraper hits the
  // editorial sources (ET/Mint/Moneycontrol/BS/NDTV) where smallcap
  // mentions actually live.
  if (isRedisAvailable()) {
    try {
      const blob = await kvGet<{
        generatedAt?: string;
        entries?: Array<{ title: string; url: string; source?: string; publishedAt?: string; snippet?: string }>;
      }>('scraped-india-news:v1:latest');
      const entries = Array.isArray(blob?.entries) ? blob!.entries : [];
      if (entries.length > 0) {
        // Match by ticker symbol OR company-name fragment. Use word-boundary
        // checks to avoid false positives ("MCX" matching "commerce" etc).
        const symRe = new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        const coRe = company && company.length >= 3
          ? new RegExp(`\\b${company.split(/\s+/).slice(0, 2).join('\\s+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
          : null;
        const matched: NewsItem[] = [];
        for (const e of entries) {
          const haystack = `${e.title || ''} ${e.snippet || ''}`;
          if (symRe.test(haystack) || (coRe && coRe.test(haystack))) {
            // The shared NewsItem type uses snake_case + a narrow source
            // union; the scraped-blob entries use camelCase + an open
            // source string. Cast through `any` so this normalization
            // doesn't require widening the lib type for what is, in
            // practice, the same shape.
            matched.push({
              title: e.title,
              url: e.url,
              source: (e.source || 'India RSS') as any,
              published_at: e.publishedAt || new Date().toISOString(),
              summary: e.snippet,
            } as NewsItem);
          }
        }
        if (matched.length > 0) {
          // Merge in, dedupe by URL, keep newest first.
          const seen = new Set(articles.map((a) => (a.url || a.title || '').slice(0, 200)));
          for (const m of matched) {
            const key = (m.url || m.title || '').slice(0, 200);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            articles.push(m);
          }
          articles.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
        }
      }
    } catch {
      /* best-effort: ignore blob read failure, keep the live fetch results */
    }
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
