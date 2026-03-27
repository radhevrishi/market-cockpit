import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { NewsArticle } from '@/types';

export interface NewsFilters {
  region?: 'IN' | 'US' | 'GLOBAL';
  ticker?: string;
  article_type?: string;
  min_importance?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useNews(filters: NewsFilters = {}) {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== '') params.set(k, String(v));
      });
      const { data } = await api.get(`/news?${params}`);
      return data;
    },
    refetchInterval: 60_000, // refresh every 60 seconds
    staleTime: 30_000,
  });
}

export function useNewsInPlay() {
  return useQuery<{ ticker: string; count: number; top_headline: string }[]>({
    queryKey: ['news', 'in-play'],
    queryFn: async () => {
      const { data } = await api.get('/news/in-play');
      return data;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}

export function useTickerNews(ticker: string, days = 7) {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', 'ticker', ticker, days],
    queryFn: async () => {
      const { data } = await api.get(`/news/ticker/${ticker}?days=${days}`);
      return data;
    },
    enabled: !!ticker,
    staleTime: 60_000,
  });
}
