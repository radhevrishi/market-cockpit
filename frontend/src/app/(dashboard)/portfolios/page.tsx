'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, TrendingUp, TrendingDown, RefreshCw, AlertCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { fmtPct, pnlColor } from '@/lib/utils';
import { Skeleton, TableRowSkeleton } from '@/components/ui/Skeleton';

// ─── Hooks ────────────────────────────────────────────────────────────────────

interface ApiPortfolio {
  id: string;
  name: string;
  currency: string;
  description?: string;
  created_at?: string;
}

interface ApiPosition {
  id: string;
  ticker: string;
  exchange: string;
  company_name?: string;
  quantity: number;
  avg_cost: number;
  currency?: string;
  notes?: string;
  // enriched from yfinance
  cmp?: number;
  current_price?: number;
  pnl?: number;
  pnl_pct?: number;
  day_change_percent?: number;
  next_earnings_date?: string;
}

interface PortfolioSummary {
  portfolio_id?: string;
  portfolio_name?: string;
  currency?: string;
  total_value?: number;
  total_cost?: number;
  day_pnl?: number;
  day_pnl_pct?: number;
  total_pnl?: number;
  total_pnl_pct?: number;
  position_count?: number;
}

function usePortfolios() {
  return useQuery<ApiPortfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data } = await api.get('/portfolios');
      return Array.isArray(data) ? data : [];
    },
    retry: 1,
  });
}

function usePositions(portfolioId: string) {
  return useQuery<ApiPosition[]>({
    queryKey: ['portfolios', portfolioId, 'positions'],
    queryFn: async () => {
      const { data } = await api.get(`/portfolios/${portfolioId}/positions`);
      return Array.isArray(data) ? data : [];
    },
    enabled: !!portfolioId,
    refetchInterval: 60_000,
    staleTime: 45_000,
    gcTime: 10 * 60 * 1000, // keep cache for 10 minutes
    retry: 1,
  });
}

// ── Intelligence signals for a set of tickers (same endpoint as single-portfolio view) ──
interface PortfolioSignal {
  symbol: string;
  weightedScore?: number;
  action?: string;          // BUY | ADD | HOLD | TRIM | EXIT | AVOID | WATCH
  sectorTrend?: string;     // Bullish | Neutral | Bearish
}
function usePortfolioIntelligence(tickers: string[]) {
  return useQuery<Map<string, PortfolioSignal>>({
    queryKey: ['portfolios', 'intelligence', tickers.sort().join(',')],
    queryFn: async () => {
      if (!tickers.length) return new Map();
      const pfParam = `portfolio=${tickers.join(',')}`;
      const res = await fetch(`/api/market/intelligence?days=30&${pfParam}`);
      if (!res.ok) return new Map();
      const data = await res.json();
      const signals: PortfolioSignal[] = [...(data.signals || []), ...(data.notable || [])];
      const map = new Map<string, PortfolioSignal>();
      for (const s of signals) {
        if (!map.has(s.symbol)) map.set(s.symbol, s);
      }
      return map;
    },
    enabled: tickers.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    retry: 0,
  });
}

function usePortfolioSummary(portfolioId: string) {
  return useQuery<PortfolioSummary>({
    queryKey: ['portfolios', portfolioId, 'summary'],
    queryFn: async () => {
      const { data } = await api.get(`/portfolios/${portfolioId}/summary`);
      return data ?? {};
    },
    enabled: !!portfolioId,
    refetchInterval: 60_000,
    staleTime: 45_000,
    gcTime: 10 * 60 * 1000, // keep cache for 10 minutes
    retry: 1,
  });
}

// ─── Create Portfolio Modal ───────────────────────────────────────────────────

function CreatePortfolioModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', currency: 'INR', description: '' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (body: object) => api.post('/portfolios', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios'] });
      toast.success('Portfolio created!');
      onClose();
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Failed to create portfolio'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Portfolio name is required'); return; }
    mutation.mutate({
      name: form.name.trim(),
      currency: form.currency,
      description: form.description.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-white font-semibold text-base">Create Portfolio</h2>
            <p className="text-[#4A5B6C] text-xs mt-0.5">Track your stock positions in one place</p>
          </div>
          <button onClick={onClose} className="text-[#4A5B6C] hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">
              Portfolio Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Long-Term India, US Growth"
              required
              autoFocus
              className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2.5 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">
              Base Currency
            </label>
            <div className="flex gap-3">
              {(['INR', 'USD'] as const).map(cur => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, currency: cur }))}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                    form.currency === cur
                      ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white'
                      : 'bg-[#0D1B2E] border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'
                  }`}
                >
                  {cur === 'INR' ? '🇮🇳 INR' : '🇺🇸 USD'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">
              Description <span className="text-[#4A5B6C] normal-case tracking-normal font-normal">(optional)</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Core holdings, dividend income portfolio..."
              rows={2}
              className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2.5 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] transition-colors resize-none"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-[#2A3B4C] text-[#8899AA] text-sm hover:border-[#0F7ABF] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              {mutation.isPending ? 'Creating…' : 'Create Portfolio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Position Modal ───────────────────────────────────────────────────────

function AddPositionModal({ portfolioId, onClose }: { portfolioId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    ticker: '', exchange: 'NSE', company_name: '', quantity: '', avg_cost: '', currency: 'INR', notes: '',
  });
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [lookingUp, setLookingUp] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: object) => api.post(`/portfolios/${portfolioId}/positions`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
      toast.success('Position added!');
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.detail ?? 'Failed to add position';
      setError(msg);
      toast.error(`Failed to add position: ${msg}`);
    },
  });

  // Auto-lookup company name & CMP when ticker loses focus
  const [lookupFailed, setLookupFailed] = useState(false);

  // Common US stock tickers
  const knownUsNyse = ['JPM', 'V', 'MA', 'WMT', 'DIS', 'CRM', 'BAC', 'JNJ', 'HD', 'PG', 'UNH', 'TSM'];
  const knownUsNasdaq = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NFLX', 'AMD', 'INTC', 'AVGO', 'ADBE', 'CSCO', 'QCOM', 'PYPL', 'ORCL', 'ASML'];
  // Common Indian stock tickers
  const inTickersList = ['RELIANCE', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'BAJAJFINSV', 'MARUTI', 'ICICIBANK', 'HDFC', 'SBIN', 'HDFC', 'ITC', 'ADANIPORTS', 'AXISBANK'];

  const lookupTicker = async (tickerToLookup?: string) => {
    const ticker = (tickerToLookup ?? form.ticker).trim().toUpperCase();
    if (!ticker) return;
    setLookingUp(true);
    setLookupFailed(false);

    // Auto-switch exchange based on ticker
    if (knownUsNyse.includes(ticker)) {
      setForm(f => ({ ...f, exchange: 'NYSE', currency: 'USD', ticker }));
    } else if (knownUsNasdaq.includes(ticker)) {
      setForm(f => ({ ...f, exchange: 'NASDAQ', currency: 'USD', ticker }));
    } else if (inTickersList.includes(ticker)) {
      setForm(f => ({ ...f, exchange: 'NSE', currency: 'INR', ticker }));
    }

    try {
      // 5 second timeout to avoid infinite spinner
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const { data } = await api.get(`/market/quote/${ticker}`, {
        params: { exchange: form.exchange },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (data) {
        const name = data.company_name || data.name || data.shortName || data.longName || '';
        const price = data.price ?? data.current_price ?? data.regularMarketPrice ?? '';
        if (name || price) {
          setForm(f => ({
            ...f,
            ticker,
            company_name: f.company_name || name,
            avg_cost: f.avg_cost || (price ? String(price) : ''),
          }));
        } else {
          setLookupFailed(true);
        }
      } else {
        setLookupFailed(true);
      }
    } catch {
      setLookupFailed(true);
    } finally {
      setLookingUp(false);
    }
  };

  // BUG-07: Debounced ticker lookup as user types
  useEffect(() => {
    const ticker = form.ticker.trim().toUpperCase();
    if (ticker.length >= 2) {
      const timer = setTimeout(() => {
        lookupTicker(ticker);
      }, 500);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ticker]);

  const checkTickerExchangeMismatch = () => {
    const ticker = form.ticker.toUpperCase().trim();
    const exchange = form.exchange;

    const allUsStocks = [...knownUsNyse, ...knownUsNasdaq];
    const isLikelyUSStock = allUsStocks.some(t => ticker.includes(t) || t.includes(ticker));
    const isLikelyIndianStock = inTickersList.some(t => ticker.includes(t) || t.includes(ticker));

    if (isLikelyUSStock && ['NSE', 'BSE'].includes(exchange)) {
      return `${ticker} appears to be a US stock but you're adding it to ${exchange}. Consider using NYSE or NASDAQ instead.`;
    }
    if (isLikelyIndianStock && ['NYSE', 'NASDAQ'].includes(exchange)) {
      return `${ticker} appears to be an Indian stock but you're adding it to ${exchange}. Consider using NSE or BSE instead.`;
    }
    return '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWarning('');
    // BUG-09: Explicit validation
    if (!form.ticker.trim()) { setError('Ticker is required'); return; }
    if (!form.quantity || parseFloat(form.quantity) <= 0) { setError('Quantity must be greater than 0'); return; }
    if (!form.avg_cost || parseFloat(form.avg_cost) <= 0) { setError('Average cost must be greater than 0'); return; }

    const mismatchWarning = checkTickerExchangeMismatch();
    if (mismatchWarning) {
      setWarning(mismatchWarning);
      return;
    }
    mutation.mutate({
      ticker: form.ticker.toUpperCase().trim(),
      exchange: form.exchange,
      company_name: form.company_name.trim() || form.ticker.toUpperCase().trim(),
      quantity: parseFloat(form.quantity),
      avg_cost: parseFloat(form.avg_cost),
      currency: form.currency,
      notes: form.notes,
    });
  };

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWarning('');
    mutation.mutate({
      ticker: form.ticker.toUpperCase().trim(),
      exchange: form.exchange,
      company_name: form.company_name.trim() || form.ticker.toUpperCase().trim(),
      quantity: parseFloat(form.quantity),
      avg_cost: parseFloat(form.avg_cost),
      currency: form.currency,
      notes: form.notes,
    });
  };

  const field = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        required={key !== 'notes' && key !== 'company_name'}
        className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2.5 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] transition-colors"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold">Add Position</h2>
          <button onClick={onClose} className="text-[#4A5B6C] hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {warning && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4 text-yellow-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{warning}</p>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={mutation.isPending || lookingUp}
                className="mt-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
              >
                Continue Anyway
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">Ticker</label>
              <input
                type="text"
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                onBlur={() => lookupTicker()}
                placeholder="RELIANCE / NVDA"
                required
                autoFocus
                className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2.5 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">Exchange</label>
              <div className="flex gap-2">
                {(['NSE', 'BSE', 'NYSE', 'NASDAQ'] as const).map(ex => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, exchange: ex, currency: ['NSE', 'BSE'].includes(ex) ? 'INR' : 'USD' }))}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                      form.exchange === ex
                        ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white'
                        : 'bg-[#0D1B2E] border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'
                    }`}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="relative">
            {field('Company Name', 'company_name', 'text', lookingUp ? 'Looking up…' : lookupFailed ? 'Enter manually' : 'Auto-filled from ticker lookup')}
            {lookingUp && (
              <div className="absolute right-3 top-8 w-4 h-4 border-2 border-[#0F7ABF] border-t-transparent rounded-full animate-spin" />
            )}
            {lookupFailed && !lookingUp && (
              <p className="text-yellow-400 text-[10px] mt-1">Ticker not found or data unavailable — please enter details manually</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('Quantity', 'quantity', 'number', '100')}
            {field('Avg Cost', 'avg_cost', 'number', form.avg_cost ? '' : 'Enter average cost per share')}
          </div>
          {field('Notes (optional)', 'notes', 'text', 'Q3 buy on dip')}
          <button
            type="submit"
            disabled={mutation.isPending || lookingUp}
            className="w-full bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {mutation.isPending ? 'Adding…' : 'Add Position'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Position Modal ──────────────────────────────────────────────────────

function EditPositionModal({ pos, portfolioId, onClose }: { pos: ApiPosition; portfolioId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    quantity: Number.isInteger(pos.quantity) ? String(Math.round(pos.quantity)) : String(parseFloat(pos.quantity.toFixed(2))),
    avg_cost: String(parseFloat(pos.avg_cost.toFixed(2))),
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (body: object) => api.put(`/portfolios/${portfolioId}/positions/${pos.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
      toast.success('Position updated!');
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.detail ?? 'Failed to update position';
      setError(msg);
      toast.error(`Failed to update: ${msg}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/portfolios/${portfolioId}/positions/${pos.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
      toast.success('Position deleted!');
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.detail ?? 'Failed to delete position';
      setError(msg);
      toast.error(`Failed to delete: ${msg}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const qty = parseFloat(form.quantity.replace(',', '.'));
    const cost = parseFloat(form.avg_cost.replace(',', '.'));
    if (!qty || qty <= 0) { setError('Quantity must be greater than 0'); return; }
    if (!cost || cost <= 0) { setError('Average cost must be greater than 0'); return; }
    mutation.mutate({
      quantity: qty,
      avg_cost: cost,
    });
  };

  const handleDelete = () => {
    if (window.confirm(`Delete position ${pos.ticker}? This cannot be undone.`)) {
      deleteMutation.mutate();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-white font-semibold">Edit Position</h2>
            <p className="text-[#4A5B6C] text-xs mt-0.5">{pos.ticker} ({pos.exchange})</p>
          </div>
          <button onClick={onClose} className="text-[#4A5B6C] hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">Quantity</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              placeholder="100"
              required
              autoFocus
              className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2.5 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-1.5">Average Cost</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.avg_cost}
              onChange={e => setForm(f => ({ ...f, avg_cost: e.target.value }))}
              placeholder="1000"
              required
              className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2.5 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] transition-colors"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-[#2A3B4C] text-[#8899AA] text-sm hover:border-[#0F7ABF] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || deleteMutation.isPending}
              className="flex-1 bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              {mutation.isPending ? 'Updating…' : 'Update Position'}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending || mutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Position Row ─────────────────────────────────────────────────────────────

function PositionRow({ pos, portfolioId, signal }: { pos: ApiPosition; portfolioId: string; signal?: PortfolioSignal }) {
  const qc = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/portfolios/${portfolioId}/positions/${pos.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
      toast.success('Position removed');
    },
  });

  const avgCost = Number(pos.avg_cost) || 0;
  const rawCmp = Number(pos.cmp ?? pos.current_price ?? 0);
  const hasLivePrice = rawCmp > 0;
  const cmp = hasLivePrice ? rawCmp : avgCost; // fallback to avgCost if no live price
  const qty = Number(pos.quantity) || 0;
  // Only trust backend P&L if we got a real live price; otherwise recalculate from avgCost
  const pnl = hasLivePrice && pos.pnl != null ? Number(pos.pnl) : ((cmp - avgCost) * qty);
  const pnlPct = hasLivePrice && pos.pnl_pct != null ? Number(pos.pnl_pct) : (avgCost > 0 ? ((cmp - avgCost) / avgCost * 100) : 0);
  const dayChange = hasLivePrice ? (Number(pos.day_change_percent) || 0) : 0;
  const totalValue = cmp * qty;
  const currency = pos.currency ?? 'INR';
  const sym = currency === 'INR' ? '₹' : '$';
  // Format quantity: show integers without decimals, decimals with 2 places
  const qtyDisplay = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);

  return (
    <tr className="border-b border-[#2A3B4C] hover:bg-[#0D1B2E]/30 transition-colors group">
      <td className="px-4 py-3">
        <div>
          <p className="text-white text-sm font-bold">{pos.ticker}</p>
          <p className="text-[#4A5B6C] text-[10px]">{pos.company_name ?? ''}</p>
        </div>
      </td>
      <td className="px-4 py-3 text-[#8899AA] text-xs">{pos.exchange}</td>
      <td className="px-4 py-3 text-white text-sm">{qtyDisplay}</td>
      <td className="px-4 py-3 text-[#8899AA] text-sm">{sym}{avgCost.toFixed(2)}</td>
      <td className="px-4 py-3 text-white text-sm font-semibold">{sym}{cmp.toFixed(2)}</td>
      <td className="px-4 py-3">
        <p className={`text-sm font-semibold ${pnlColor(pnl)}`}>
          {pnl >= 0 ? '+' : ''}{sym}{Math.abs(pnl).toFixed(0)}
        </p>
        <p className={`text-xs ${pnlColor(pnlPct)}`}>{fmtPct(pnlPct)}</p>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-semibold ${pnlColor(dayChange)}`}>
          {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)}%
        </span>
      </td>
      {/* Intelligence signal — score + action badge from /api/market/intelligence */}
      <td className="px-4 py-3">
        {signal ? (
          <div className="flex flex-col gap-0.5">
            {signal.weightedScore !== undefined && (
              <span className={`text-xs font-bold ${signal.weightedScore >= 65 ? 'text-emerald-400' : signal.weightedScore >= 45 ? 'text-amber-400' : 'text-[#4A5B6C]'}`}>
                {Math.round(signal.weightedScore)}
              </span>
            )}
            {signal.action && (
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                signal.action === 'BUY' || signal.action === 'ADD'  ? 'bg-emerald-500/15 text-emerald-400' :
                signal.action === 'TRIM' || signal.action === 'EXIT' ? 'bg-red-500/15 text-red-400' :
                'bg-[#1A2B3C] text-[#4A5B6C]'
              }`}>
                {signal.action}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[#2A3B4C] text-[10px]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-[#8899AA] text-xs">{sym}{totalValue.toFixed(0)}</td>
      <td className="px-4 py-3 text-[#4A5B6C] text-xs">
        {pos.next_earnings_date
          ? format(new Date(pos.next_earnings_date), 'MMM d')
          : '—'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEditModal(true)}
            disabled={false}
            className="text-[#4A5B6C] hover:text-[#0F7ABF] transition-colors"
            title="Edit position"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete ${pos.ticker} position? This cannot be undone.`)) {
                deleteMut.mutate();
              }
            }}
            disabled={deleteMut.isPending}
            className="text-[#4A5B6C] hover:text-red-400 transition-colors"
            title="Delete position"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
      {showEditModal && <EditPositionModal pos={pos} portfolioId={portfolioId} onClose={() => setShowEditModal(false)} />}
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// ─── CSV Import Modal ─────────────────────────────────────────────────────────
interface CsvRow { ticker: string; exchange: string; quantity: number; avgCost: number; currency: string }

function ImportCSVModal({ portfolioId, onClose }: { portfolioId: string; onClose: () => void }) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const qc = useQueryClient();

  const parseCSV = (text: string) => {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (!lines.length) { setError('Empty file'); return; }
    const header = lines[0].toLowerCase().replace(/\s/g, '');
    if (!header.includes('ticker') || !header.includes('quantity') || !header.includes('avgcost')) {
      setError('CSV must have columns: Ticker, Exchange, Quantity, AvgCost (Currency optional)');
      return;
    }
    const parsed: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 4) continue;
      const row: CsvRow = {
        ticker: cols[0].toUpperCase(),
        exchange: cols[1].toUpperCase() || 'NSE',
        quantity: parseFloat(cols[2]) || 0,
        avgCost: parseFloat(cols[3]) || 0,
        currency: cols[4]?.toUpperCase() || 'INR',
      };
      if (row.ticker && row.quantity > 0 && row.avgCost > 0) parsed.push(row);
    }
    if (!parsed.length) { setError('No valid rows found. Check format: Ticker,Exchange,Quantity,AvgCost,Currency'); return; }
    setError('');
    setRows(parsed);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => parseCSV(ev.target?.result as string);
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setImporting(true);
    setProgress({ done: 0, total: rows.length, errors: 0 });
    let errors = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        await api.post(`/portfolios/${portfolioId}/positions`, {
          ticker: row.ticker,
          exchange: row.exchange,
          company_name: row.ticker,
          quantity: row.quantity,
          avg_cost: row.avgCost,
          currency: row.currency,
        });
      } catch { errors++; }
      setProgress({ done: i + 1, total: rows.length, errors });
    }
    await qc.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
    if (errors === 0) toast.success(`Imported ${rows.length} positions successfully`);
    else toast.error(`Imported ${rows.length - errors}/${rows.length} positions (${errors} failed)`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-2xl w-full max-w-xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A3B4C]">
          <h3 className="text-white font-semibold">Import Positions from CSV</h3>
          <button onClick={onClose} className="text-[#4A5B6C] hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-[#0D1B2E] rounded-xl p-4 text-xs text-[#8899AA] font-mono">
            Ticker,Exchange,Quantity,AvgCost,Currency<br/>
            RELIANCE,NSE,10,2500,INR<br/>
            AAPL,NASDAQ,5,150,USD
          </div>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#2A3B4C] hover:border-[#0F7ABF] rounded-xl p-8 cursor-pointer transition-colors">
            <span className="text-3xl">📂</span>
            <span className="text-white text-sm font-medium">Click to select CSV file</span>
            <span className="text-[#4A5B6C] text-xs">Columns: Ticker, Exchange, Quantity, AvgCost, Currency</span>
            <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
          </label>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {rows.length > 0 && (
            <div>
              <p className="text-[#8899AA] text-xs mb-2">{rows.length} rows ready to import:</p>
              <div className="max-h-40 overflow-y-auto bg-[#0D1B2E] rounded-lg">
                <table className="w-full text-xs">
                  <thead><tr className="text-[#4A5B6C] border-b border-[#2A3B4C]">
                    {['Ticker','Exch','Qty','Avg Cost','Curr'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
                  </tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i} className="border-b border-[#1A2B3C] text-white">
                      <td className="px-3 py-1.5 font-semibold">{r.ticker}</td>
                      <td className="px-3 py-1.5 text-[#8899AA]">{r.exchange}</td>
                      <td className="px-3 py-1.5">{r.quantity}</td>
                      <td className="px-3 py-1.5">{r.avgCost}</td>
                      <td className="px-3 py-1.5 text-[#8899AA]">{r.currency}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          {importing && (
            <div>
              <div className="flex justify-between text-xs text-[#8899AA] mb-1">
                <span>Importing... {progress.done}/{progress.total}</span>
                {progress.errors > 0 && <span className="text-red-400">{progress.errors} errors</span>}
              </div>
              <div className="h-2 bg-[#0D1B2E] rounded-full overflow-hidden">
                <div className="h-full bg-[#0F7ABF] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2A3B4C]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[#8899AA] hover:text-white text-sm transition-colors">Cancel</button>
          <button
            onClick={handleImport}
            disabled={rows.length === 0 || importing}
            className="flex items-center gap-2 bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-40 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors"
          >
            {importing ? 'Importing…' : `Import ${rows.length} Positions`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PortfoliosPage() {
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [showCreatePortfolio, setShowCreatePortfolio] = useState(false);
  const [showImportCSV, setShowImportCSV] = useState(false);
  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: portfolios, isLoading: loadingPf, error: pfError } = usePortfolios();

  // Select first portfolio by default
  const activeId = activePortfolioId ?? portfolios?.[0]?.id ?? '';

  const { data: positions, isLoading: loadingPos, refetch } = usePositions(activeId);
  const { data: summary, isLoading: loadingSum } = usePortfolioSummary(activeId);
  // Intelligence signals for all positions in the active portfolio
  const positionTickers = (positions ?? []).map(p => p.ticker).filter(Boolean);
  const { data: intelligenceMap } = usePortfolioIntelligence(positionTickers);

  const currency = portfolios?.find(p => p.id === activeId)?.currency ?? 'INR';
  const sym = currency === 'INR' ? '₹' : '$';

  const noPortfolios = !loadingPf && (portfolios ?? []).length === 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">

      {/* Modals */}
      {showCreatePortfolio && <CreatePortfolioModal onClose={() => setShowCreatePortfolio(false)} />}
      {showAddPosition && activeId && <AddPositionModal portfolioId={activeId} onClose={() => setShowAddPosition(false)} />}
      {showImportCSV && activeId && <ImportCSVModal portfolioId={activeId} onClose={() => setShowImportCSV(false)} />}

      {/* Empty state — no portfolios yet */}
      {noPortfolios ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <p className="text-5xl mb-4">💼</p>
          <p className="text-white text-lg font-bold mb-1">No portfolios yet</p>
          <p className="text-[#4A5B6C] text-sm mb-6">Create a portfolio to start tracking your NSE, BSE & US positions</p>
          <button
            onClick={() => setShowCreatePortfolio(true)}
            className="flex items-center gap-2 bg-[#0F7ABF] hover:bg-[#0E6DAD] text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors shadow-lg"
          >
            <Plus className="w-4 h-4" /> Create Your First Portfolio
          </button>
        </div>
      ) : (
        <>
          {/* Portfolio selector tabs */}
          <div className="flex items-center gap-3 flex-wrap">
            {portfolios?.map(pf => (
              <button
                key={pf.id}
                onClick={() => setActivePortfolioId(pf.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  activeId === pf.id
                    ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white'
                    : 'bg-[#1A2B3C] border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'
                }`}
              >
                {pf.name}
                {pf.currency && <span className="ml-1.5 text-[10px] opacity-60">{pf.currency}</span>}
              </button>
            ))}
            <button
              onClick={() => setShowCreatePortfolio(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-[#2A3B4C] text-[#4A5B6C] hover:border-[#0F7ABF] hover:text-[#0F7ABF] text-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New portfolio
            </button>
          </div>

          {/* Summary row */}
          {activeId && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(['Total Value', "Today's P&L", 'Total Return', 'Positions'] as const).map((label, i) => {
                let value = '—';
                let sub: string | undefined = undefined;
                let subColor = 'text-[#4A5B6C]';

                if (summary && Object.keys(summary).length > 0) {
                  if (i === 0) value = `${sym}${(summary.total_value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
                  if (i === 1) {
                    value = `${summary.day_pnl != null && summary.day_pnl < 0 ? '-' : '+'}${sym}${Math.abs(summary.day_pnl ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
                    sub = fmtPct(summary?.day_pnl_pct ?? 0);
                    subColor = pnlColor(summary?.day_pnl ?? 0);
                  }
                  if (i === 2) {
                    value = `${summary.total_pnl != null && summary.total_pnl < 0 ? '-' : '+'}${sym}${Math.abs(summary.total_pnl ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
                    sub = fmtPct(summary?.total_pnl_pct ?? 0);
                    subColor = pnlColor(summary?.total_pnl ?? 0);
                  }
                  if (i === 3) value = String(summary.position_count ?? 0);
                }
                return (
                  <div key={label} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl p-5">
                    <p className="text-[#8899AA] text-xs font-medium uppercase tracking-wider mb-2">{label}</p>
                    {loadingSum ? (
                      <>
                        <Skeleton className="h-7 w-2/3 mb-1" />
                        <Skeleton className="h-4 w-1/3" />
                      </>
                    ) : (
                      <>
                        <p className="text-xl font-bold text-white">{value}</p>
                        {sub && <p className={`text-xs mt-0.5 font-semibold ${subColor}`}>{sub}</p>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Positions table */}
          {activeId && (
            <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A3B4C]">
                <h2 className="text-sm font-semibold text-white">Positions</h2>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await qc.invalidateQueries({ queryKey: ['portfolios', activeId, 'positions'] });
                      await qc.invalidateQueries({ queryKey: ['portfolios', activeId, 'summary'] });
                      await refetch();
                      toast.success('Quotes refreshed');
                    }}
                    className="flex items-center gap-1.5 text-[#4A5B6C] hover:text-[#8899AA] text-xs transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh quotes
                  </button>
                  <button
                    onClick={() => setShowImportCSV(true)}
                    className="flex items-center gap-1.5 bg-[#1A3A2A] hover:bg-[#1F4A33] text-green-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors border border-green-800"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                    Import CSV
                  </button>
                  <button
                    onClick={() => setShowAddPosition(true)}
                    className="flex items-center gap-1.5 bg-[#0F7ABF] hover:bg-[#0E6DAD] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Position
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-[#2A3B4C] bg-[#0D1B2E]/40">
                      {['Ticker', 'Exch', 'Qty', 'Avg Cost', 'CMP', 'P&L', 'Day%', 'Signal', 'Value', 'Next Earn', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[#4A5B6C] text-[11px] font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingPos
                      ? Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={11} />)
                      : !positions?.length
                      ? (
                        <tr>
                          <td colSpan={11} className="text-center py-16 text-[#4A5B6C] text-sm">
                            No positions yet.{' '}
                            <button onClick={() => setShowAddPosition(true)} className="text-[#0F7ABF] hover:text-[#38A9E8]">
                              Add your first position →
                            </button>
                          </td>
                        </tr>
                      )
                      : positions.map(pos => <PositionRow key={pos.id} pos={pos} portfolioId={activeId} signal={intelligenceMap?.get(pos.ticker)} />)
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
