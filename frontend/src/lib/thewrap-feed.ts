// ═══════════════════════════════════════════════════════════════════════════
// THE-WRAP FEED — shared dual-source ingest for the TheWrap tracker pages.
//
// The /strategic-hires, /marquee-capital and /marketing-auth pages each run a
// different detector from `lib/thewrap-detectors.ts` over the SAME two upstream
// streams:
//
//   1. News stream       — GET /api/v1/news?limit=300
//                          (articles with title/headline, url, ticker_symbols[],
//                           published_at, source/source_name, summary, impact)
//   2. Concall-intel      — GET /api/v1/concall-intel/live-feed?days=14&cacheOnly=1
//      live-feed            (NSE/BSE Reg-30 filings indexed by symbol; cacheOnly=1
//                           so the page never blocks on the 60s cold-start path)
//
// This module owns the fetch, normalization, dedup and detector-run so the
// three pages don't each re-implement the pipeline. Pages keep only their own
// detector + copy + JSX. Libs MAY export (unlike Next.js page files).
// ═══════════════════════════════════════════════════════════════════════════

import type { DetectorSignal } from '@/lib/thewrap-detectors';

// ── Normalized item shape (union of the two upstream shapes) ─────────────────

export interface WrapFeedItem {
  /** Primary ticker (first ticker_symbol / filing symbol), upper-cased. */
  ticker: string;
  /** Company name when available (filings carry it; news usually doesn't). */
  company: string;
  /** Headline / filing subject — the human-readable title. */
  title: string;
  /** Full text run through the detector (title + summary + evidence phrases). */
  text: string;
  /** Source label (news source name, or "NSE filing" / "BSE filing"). */
  source: string;
  /** Best available link. */
  url: string;
  /** Publish/filing time as epoch ms (0 when unparseable). */
  publishedAt: number;
  /** Where the item came from — for a small provenance badge. */
  origin: 'news' | 'filing';
}

/** A WrapFeedItem whose detector fired, carrying the resulting signal. */
export interface WrapMatch extends WrapFeedItem {
  signal: DetectorSignal;
}

export interface WrapFeedResult {
  items: WrapFeedItem[];
  fetchedAt: number;
  /** True when the news stream returned successfully. */
  newsOk: boolean;
  /** True when the live-feed returned successfully (may still be cache-warming). */
  filingsOk: boolean;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function safeJson(url: string, signal: AbortSignal): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function parseTime(v: unknown): number {
  if (!v || typeof v !== 'string') return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function firstTicker(syms: unknown): string {
  if (Array.isArray(syms) && syms.length > 0) {
    const s = syms[0];
    return typeof s === 'string' ? s.toUpperCase().trim() : '';
  }
  return '';
}

function normalizeNews(article: any): WrapFeedItem {
  const title: string = article?.headline || article?.title || '';
  const summary: string = article?.summary || '';
  const impact: string = article?.impact_statement || '';
  return {
    ticker: firstTicker(article?.ticker_symbols),
    company: '',
    title,
    text: `${title} ${article?.title || ''} ${summary} ${impact}`.trim(),
    source: article?.source_name || article?.source || 'News',
    url: article?.url || article?.source_url || '',
    publishedAt: parseTime(article?.published_at),
    origin: 'news',
  };
}

function normalizeFiling(filing: any): WrapFeedItem {
  const subject: string = filing?.subject || '';
  const company: string = filing?.company_name || '';
  const phrases: string[] = Array.isArray(filing?.bullish?.bullish_phrases)
    ? filing.bullish.bullish_phrases
    : [];
  const exchange: string = filing?.exchange === 'BSE' ? 'BSE' : 'NSE';
  return {
    ticker: typeof filing?.symbol === 'string' ? filing.symbol.toUpperCase().trim() : '',
    company,
    title: subject,
    text: `${subject} ${company} ${phrases.join(' ')}`.trim(),
    source: `${exchange} filing`,
    url: filing?.source_url || (Array.isArray(filing?.attachment_urls) ? filing.attachment_urls[0] : '') || '',
    publishedAt: parseTime(filing?.filing_datetime),
    origin: 'filing',
  };
}

/**
 * Fetch BOTH upstream streams in parallel with a bounded client timeout, then
 * dedup by ticker+title. One stream failing does not fail the whole call.
 */
export async function fetchWrapFeed(opts?: { timeoutMs?: number }): Promise<WrapFeedResult> {
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const [newsRaw, feedRaw] = await Promise.all([
      safeJson(`/api/v1/news?limit=300`, controller.signal),
      safeJson(`/api/v1/concall-intel/live-feed?days=14&bullishOnly=false&cacheOnly=1`, controller.signal),
    ]);

    const newsOk = newsRaw != null;
    const filingsOk = feedRaw != null;

    const newsItems: WrapFeedItem[] = Array.isArray(newsRaw)
      ? newsRaw.map(normalizeNews)
      : [];
    const filings: any[] = Array.isArray(feedRaw?.filings) ? feedRaw.filings : [];
    const filingItems: WrapFeedItem[] = filings.map(normalizeFiling);

    // Dedup by ticker + normalized title. Filings win over news when both
    // describe the same event (filings carry the company name + primary link).
    const merged = [...filingItems, ...newsItems];
    const seen = new Set<string>();
    const items: WrapFeedItem[] = [];
    for (const it of merged) {
      if (!it.title) continue;
      const key = `${it.ticker}::${it.title.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 90)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }

    return { items, fetchedAt: Date.now(), newsOk, filingsOk };
  } finally {
    clearTimeout(timer);
  }
}

// ── Detector runner ──────────────────────────────────────────────────────────

/**
 * Run a single detector over the normalized items, keeping only those where
 * it returns a non-null signal. Results are sorted newest-first by default.
 */
export function runDetector(
  items: WrapFeedItem[],
  detector: (text: string) => DetectorSignal | null,
): WrapMatch[] {
  const out: WrapMatch[] = [];
  for (const it of items) {
    const signal = detector(it.text);
    if (signal) out.push({ ...it, signal });
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt);
  return out;
}

// ── Relative-time helper (mirrors the app's deterministic ladder) ────────────

export function relativeTime(epochMs: number): string {
  if (!epochMs) return '—';
  const age = Date.now() - epochMs;
  if (age < 0) return 'now';
  if (age < 60_000) return 'now';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  if (age < 7 * 86_400_000) return `${Math.floor(age / 86_400_000)}d ago`;
  return new Date(epochMs).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
