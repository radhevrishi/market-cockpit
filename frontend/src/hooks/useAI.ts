import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import type { AIBrief } from '@/types';

export function useMorningBrief() {
  return useQuery<AIBrief>({
    queryKey: ['ai', 'brief', 'morning'],
    queryFn: async () => {
      const { data } = await api.get('/ai/brief/morning');
      return data;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useEveningBrief() {
  return useQuery<AIBrief>({
    queryKey: ['ai', 'brief', 'evening'],
    queryFn: async () => {
      const { data } = await api.get('/ai/brief/evening');
      return data;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useExplainMove(ticker: string, exchange: string) {
  return useMutation({
    mutationFn: () => api.post(`/ai/explain/${ticker}`, { exchange }),
  });
}

export function useEarningsMemo(ticker: string, exchange: string) {
  return useMutation({
    mutationFn: () => api.post(`/ai/memo/${ticker}`, { exchange }),
  });
}

export function useSavedBriefs() {
  return useQuery<AIBrief[]>({
    queryKey: ['ai', 'briefs'],
    queryFn: async () => {
      const { data } = await api.get('/ai/briefs');
      return data;
    },
  });
}
