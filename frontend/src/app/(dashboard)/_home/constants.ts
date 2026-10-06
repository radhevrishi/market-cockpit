// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import type { MoveBucket } from '@/lib/move-quality';

// PATCH 0820 — short labels for the new bucket taxonomy on home Movers row
export const BUCKET_MQ_SHORT: Record<MoveBucket, string> = {
  FUNDAMENTAL_RERATING: 'RERATE',
  PRE_EVENT:            'PRE-EVT',
  SHORT_COVERING:       'COVER',
  OPERATOR:             'OP-PUMP',
  FLOW:                 'FLOW',
  ROTATION:             'ROTATE',
  TECHNICAL:            'BREAKOUT',
  SPECULATIVE:          'SPEC',
  ILLIQUID:             'ILLIQUID',
};

// zzz855 — ONE India quotes request feeds every home consumer (Movers,
// Portfolio P&L, Watchlist Pulse, Sector rotation/pulse, Conviction live,
// Daily Signal Inbox pullbacks + momentum). It used to be 4 separate calls
// (two of them the full ~1.16 MB universe, cache-busted). `fields=` is the
// route's existing projection; the list is the union of every field the home
// page reads off a quote row — keep it in sync when a panel reads a new field.
export const HOME_QUOTE_FIELDS = [
  'ticker', 'symbol', 'company', 'price', 'changePercent', 'previousClose', 'open', 'dayHigh', 'dayLow',
  'volume', 'vol20DAvg', 'volMultiple', 'deliveryPct', 'turnoverLacs', 'indexGroup', 'sector', 'industry',
  'marketCap', 'pctOf52wHigh', 'mom1M', 'week52High', 'staleEOD',
].join(',');

export const HOME_QUOTES_INDIA_URL = `/api/market/quotes?market=india&fields=${HOME_QUOTE_FIELDS}`;

// zzz855 — news rows: exactly the fields the home page reads (In-Play filter +
// render, Signals tiering + render, Movers attribution NewsInput, fan-out dedup).
// Explicit list rather than view=lean because lean drops feed_type/date/time/market.
export const HOME_NEWS_FIELDS = [
  'id', 'title', 'headline', 'summary', 'published_at', 'date', 'time', 'source', 'source_name', 'source_url', 'url',
  'importance_score', 'is_synthetic', 'structural_status', 'feed_layer', 'feed_type', 'freshness_layer',
  'primary_ticker', 'ticker_symbols', 'ticker', 'region', 'market', 'article_type',
].join(',');

// Movers attribution reads exactly these FilingInput fields (lib/movers-attribution.ts) + symbol for indexing.
export const HOME_FILING_FIELDS = 'symbol,subject,filing_type,filing_datetime,source_url,attachment_urls';

// Freshness windows (client memory). Market data ≥ 60 s, news ≥ 5 min.
export const TTL_QUOTES = 55_000;          // just under the 60 s market-hours tick so each tick refreshes prices

export const TTL_NEWS = 5 * 60_000;        // news / filings feeds

export const TTL_FEED = 10 * 60_000;       // graded earnings, special situations, bottleneck, fundamentals

export const TTL_SLOW = 30 * 60_000;       // super-investor flow, earnings calendar, snapshots

export const FANOUT_CONCURRENCY = 6;

export const BG = '#0A0E1A';

export const CARD = '#0D1623';

export const BORDER = '#1A2540';

export const TEXT = '#E6EDF3';

export const DIM = '#8A95A3';

// zzz855 — India re-score result per source array (rows are never mutated in place).
export const _indiaRescoreMemo = new WeakMap<any[], any[]>();

export const cardStyle: React.CSSProperties = {
  backgroundColor: CARD, border: `1px solid ${BORDER}`,
  borderRadius: 8, padding: '14px 16px',
};
