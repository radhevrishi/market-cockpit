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
