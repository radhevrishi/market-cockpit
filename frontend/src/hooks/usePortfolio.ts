import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Portfolio, Position, Watchlist } from '@/types';

export function usePortfolios() {
  return useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data } = await api.get('/portfolios');
      return data;
    },
  });
}

export function usePortfolioSummary(portfolioId: string) {
  return useQuery({
    queryKey: ['portfolios', portfolioId, 'summary'],
    queryFn: async () => {
      const { data } = await api.get(`/portfolios/${portfolioId}/summary`);
      return data;
    },
    enabled: !!portfolioId,
    refetchInterval: 60_000,
  });
}

export function usePositions(portfolioId: string) {
  return useQuery<Position[]>({
    queryKey: ['portfolios', portfolioId, 'positions'],
    queryFn: async () => {
      const { data } = await api.get(`/portfolios/${portfolioId}/positions`);
      return data;
    },
    enabled: !!portfolioId,
    refetchInterval: 60_000,
  });
}

export function useAddPosition(portfolioId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (position: Partial<Position>) =>
      api.post(`/portfolios/${portfolioId}/positions`, position),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
    },
  });
}

export function useDeletePosition(portfolioId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (positionId: string) =>
      api.delete(`/portfolios/${portfolioId}/positions/${positionId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
    },
  });
}

export function useWatchlists() {
  return useQuery<Watchlist[]>({
    queryKey: ['watchlists'],
    queryFn: async () => {
      const { data } = await api.get('/watchlists');
      return data;
    },
  });
}
