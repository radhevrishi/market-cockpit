// AUDIT_100 #76 — Shared React Query key for /api/market/quotes.
//
// Movers, Heatmap, Screener, Watchlists, Portfolio all hit the same
// /api/market/quotes endpoint independently. Inside /market-snapshot the
// user toggles between Heatmap and Movers and pays two separate network
// hits within the same minute. This hook lifts the fetch to a shared React
// Query cache so consumers ride the same payload while it's fresh.
//
// Default staleTime = 60s (movers/heatmap update intra-day, not tick-by-tick).
// Callers that want fresher data pass `staleTime: 0`.
//
// PATCH 0544 — Module-scope cache + in-flight dedupe for non-React-Query
// consumers. Movers and Heatmap pages use plain useState/useEffect polling
// (not React Query) — migrating them to RQ would be invasive surgery on
// large stateful components. Instead, `fetchQuotesShared(...)` is a thin
// wrapper around `fetch('/api/market/quotes?...')` that:
//   1. Returns the in-flight Promise if a request to the same URL is
//      already pending (dedupe — two pages mounting in the same tick
//      share one network call).
//   2. Returns a cached payload if it was fetched within `cacheTtlMs`
//      (default 60s, matching the RQ hook's staleTime).
// Both pages now call `fetchQuotesShared('india', { signal })` instead of
// raw fetch, so consecutive tab switches inside /market-snapshot don't
// double the NSE API quota burn.

import { useQuery } from '@tanstack/react-query';

export type MarketQuote = {
  symbol?: string;
  ticker?: string;
  price?: number;
  changePercent?: number;
  change_percent?: number;
  volume?: number;
  high?: number;
  low?: number;
  marketCap?: number;
  [k: string]: any;
};

export type QuotesResponse = {
  stocks?: MarketQuote[];
  quotes?: MarketQuote[];
  generated_at?: string;
  [k: string]: any;
};

export type QuotesOpts = {
  market?: 'india' | 'us';
  index?: string;
  staleTime?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
};

const DEFAULT_STALE_MS = 60_000; // 1 min — quotes are intra-day, not tick

export function useMarketQuotes(opts: QuotesOpts = {}) {
  const market = opts.market ?? 'india';
  const index = opts.index;
  const key = ['market-quotes', market, index ?? 'all'];

  return useQuery<QuotesResponse>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ market });
      if (index) params.set('index', index);
      const res = await fetch(`/api/market/quotes?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`quotes ${res.status}`);
      return res.json();
    },
    staleTime: opts.staleTime ?? DEFAULT_STALE_MS,
    refetchInterval: opts.refetchInterval ?? false,
    refetchOnWindowFocus: false,
    enabled: opts.enabled ?? true,
  });
}

// PATCH 0544 — shared module-scope cache + in-flight dedupe for non-RQ pages.

type CacheEntry = { ts: number; payload: QuotesResponse };
const _payloadCache = new Map<string, CacheEntry>();
const _inFlight = new Map<string, Promise<QuotesResponse>>();

export type FetchQuotesOpts = {
  market?: 'india' | 'us';
  index?: string;
  /** Force a fresh fetch even if cached payload is still fresh. */
  force?: boolean;
  /** TTL beyond which the cached payload is considered stale. Default 60_000. */
  cacheTtlMs?: number;
  /** AbortSignal from the caller; ignored if the in-flight request was started
   *  by a different caller. Aborting only protects YOUR consumer. */
  signal?: AbortSignal;
};

export async function fetchQuotesShared(opts: FetchQuotesOpts = {}): Promise<QuotesResponse> {
  const market = opts.market ?? 'india';
  const index = opts.index;
  const params = new URLSearchParams({ market });
  if (index) params.set('index', index);
  const url = `/api/market/quotes?${params.toString()}`;
  const ttl = opts.cacheTtlMs ?? DEFAULT_STALE_MS;

  if (!opts.force) {
    const cached = _payloadCache.get(url);
    if (cached && Date.now() - cached.ts < ttl) {
      return cached.payload;
    }
    const inflight = _inFlight.get(url);
    if (inflight) {
      // Note: caller's signal can't abort someone else's fetch, but if it
      // aborts before our await resolves, the throw propagates naturally.
      return inflight;
    }
  }

  const p = (async () => {
    try {
      const res = await fetch(url, { signal: opts.signal });
      if (!res.ok) throw new Error(`quotes ${res.status}`);
      const json = (await res.json()) as QuotesResponse;
      _payloadCache.set(url, { ts: Date.now(), payload: json });
      return json;
    } finally {
      _inFlight.delete(url);
    }
  })();
  _inFlight.set(url, p);
  return p;
}

/** Test/diagnostic helper — wipe shared cache. */
export function _clearQuotesSharedCache() {
  _payloadCache.clear();
  _inFlight.clear();
}
