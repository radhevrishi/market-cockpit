'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, TrendingUp, TrendingDown, AlertCircle, RefreshCw, Eye, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import TickerDrawer from '@/components/TickerDrawer';

// ── Types ──────────────────────────────────────────────────────────────────────

interface WatchlistItem {
  id: string;
  ticker: string;
  exchange: string;
  company_name?: string;
  notes?: string;
  added_at: string;
  price?: number | null;
  change_pct?: number | null;
  currency?: string;
}

// ── Ticker to Company Name Mapping ───────────────────────────────────────────

const TICKER_TO_NAME: Record<string, string> = {
  // India - Large Cap
  'RELIANCE': 'Reliance Industries',
  'TCS': 'Tata Consultancy Services',
  'HDFCBANK': 'HDFC Bank',
  'INFY': 'Infosys',
  'ICICIBANK': 'ICICI Bank',
  'WIPRO': 'Wipro',
  'BAJFINANCE': 'Bajaj Finance',
  'TATAMOTORS': 'Tata Motors',
  'SUNPHARMA': 'Sun Pharmaceutical',
  'ADANIENT': 'Adani Enterprises',
  'SBIN': 'State Bank of India',
  'AXISBANK': 'Axis Bank',
  'KOTAKBANK': 'Kotak Mahindra Bank',
  'HAL': 'Hindustan Aeronautics',
  'BEL': 'Bharat Electronics',
  'NTPC': 'NTPC',
  'ONGC': 'Oil & Natural Gas Corp',
  'MARUTI': 'Maruti Suzuki',
  'HCLTECH': 'HCL Technologies',
  'ITC': 'ITC Ltd',
  'LT': 'Larsen & Toubro',
  'POWERGRID': 'Power Grid Corp',
  // US - Mega Cap
  'AAPL': 'Apple Inc.',
  'MSFT': 'Microsoft',
  'GOOGL': 'Alphabet (Google)',
  'GOOG': 'Alphabet (Google)',
  'AMZN': 'Amazon',
  'NVDA': 'NVIDIA',
  'META': 'Meta Platforms',
  'TSLA': 'Tesla',
  'AMD': 'Advanced Micro Devices',
  'NFLX': 'Netflix',
  'INTC': 'Intel',
  'JPM': 'JPMorgan Chase',
  'BAC': 'Bank of America',
  'V': 'Visa Inc.',
  'WMT': 'Walmart',
  'DIS': 'Walt Disney',
  'CRM': 'Salesforce',
  'ORCL': 'Oracle',
  'AVGO': 'Broadcom',
  'ASML': 'ASML Holding',
  'TSM': 'TSMC',
};

interface Watchlist {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  item_count: number;
  items: WatchlistItem[];
}

// ── API hooks ─────────────────────────────────────────────────────────────────

function useWatchlists() {
  return useQuery<Watchlist[]>({
    queryKey: ['watchlists'],
    queryFn: async () => {
      const { data } = await api.get('/watchlists');
      return Array.isArray(data) ? data : [];
    },
    staleTime: 30_000,
    retry: 1,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const exportCSV = (watchlist: Watchlist) => {
  const header = 'Ticker,Exchange,Company,Price,Change%\n';
  const rows = watchlist.items.map(item => {
    const companyName = item.company_name || TICKER_TO_NAME[item.ticker] || item.ticker;
    return `${item.ticker},${item.exchange},"${companyName}",${item.price || ''},${item.change_pct || ''}`;
  }).join('\n');
  const csv = header + rows;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${watchlist.name.replace(/\s+/g, '_')}_watchlist.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast.success(`Exported ${watchlist.name} to CSV`);
};

// ── Sub-components ────────────────────────────────────────────────────────────

function CreateWatchlistModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post('/watchlists', { name: name.trim() }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['watchlists'] });
      // Auto-select the newly created watchlist
      if (data?.data?.id) {
        // We'll let the parent handle this via the list refresh
      }
      toast.success('Watchlist created!');
      onClose();
      setName('');
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.detail || e?.message || 'Failed to create watchlist';
      toast.error(`Failed to create watchlist: ${msg}`);
    },
  });
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '420px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 20px' }}>New Watchlist</h2>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#4A5B6C', marginBottom: '8px', letterSpacing: '0.5px' }}>WATCHLIST NAME</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && name.trim() && create.mutate()}
            placeholder="e.g. AI Picks, Dividend Portfolio…"
            autoFocus
            disabled={create.isPending}
            style={{ width: '100%', backgroundColor: '#0D1B2E', border: '1px solid #2A3B4C', borderRadius: '10px', padding: '11px 14px', color: 'white', fontSize: '13px', outline: 'none', boxSizing: 'border-box', opacity: create.isPending ? 0.6 : 1 }}
          />
        </div>
        {create.isError && (
          <div style={{ backgroundColor: '#7f1d1d', border: '1px solid #DC2626', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
            <p style={{ fontSize: '12px', color: '#FCA5A5', margin: 0 }}>
              Error: {(create.error as any)?.response?.data?.detail || (create.error as Error)?.message || 'Could not create watchlist'}
            </p>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={create.isPending}
            style={{ padding: '9px 18px', borderRadius: '10px', border: '1px solid #2A3B4C', backgroundColor: 'transparent', color: '#8A95A3', fontSize: '13px', cursor: create.isPending ? 'not-allowed' : 'pointer', opacity: create.isPending ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
            style={{ padding: '9px 18px', borderRadius: '10px', backgroundColor: '#0F7ABF', color: 'white', fontSize: '13px', fontWeight: '600', cursor: !name.trim() || create.isPending ? 'not-allowed' : 'pointer', border: 'none', opacity: !name.trim() || create.isPending ? 0.5 : 1 }}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddTickerRow({ watchlistId }: { watchlistId: string }) {
  const [ticker, setTicker] = useState('');
  const [exchange, setExchange] = useState('NASDAQ');
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.post(`/watchlists/${watchlistId}/items`, { ticker: ticker.trim().toUpperCase(), exchange }),
    onSuccess: async () => {
      // Invalidate and refetch the watchlists query to get updated data
      await qc.invalidateQueries({ queryKey: ['watchlists'] });
      toast.success(`${ticker} added to watchlist`);
      setTicker('');
    },
    onError: (e: any) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed';
      toast.error(`Failed to add ticker: ${msg}`);
    },
  });
  return (
    <div style={{ display: 'flex', gap: '8px', padding: '12px 16px', borderTop: '1px solid #1E2D45', backgroundColor: '#0A0E1A' }}>
      <input
        value={ticker}
        onChange={e => setTicker(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && ticker.trim() && add.mutate()}
        placeholder="Ticker (e.g. AAPL)"
        style={{ flex: 1, backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '8px', padding: '7px 12px', color: 'white', fontSize: '12px', outline: 'none' }}
      />
      <select
        value={exchange}
        onChange={e => setExchange(e.target.value)}
        style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '8px', padding: '7px 10px', color: '#C9D4E0', fontSize: '12px', outline: 'none' }}
      >
        {['NASDAQ', 'NYSE', 'NSE', 'BSE'].map(ex => <option key={ex} value={ex}>{ex}</option>)}
      </select>
      <button
        onClick={() => add.mutate()}
        disabled={!ticker.trim() || add.isPending}
        style={{ backgroundColor: '#0F7ABF', color: 'white', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', opacity: !ticker.trim() || add.isPending ? 0.5 : 1, whiteSpace: 'nowrap' }}
      >
        {add.isPending ? '…' : '+ Add'}
      </button>
      {add.isError && (
        <span style={{ fontSize: '11px', color: '#EF4444', alignSelf: 'center' }}>
          {(add.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed'}
        </span>
      )}
    </div>
  );
}

function WatchlistTable({ watchlist, onTickerClick }: { watchlist: Watchlist; onTickerClick: (t: WatchlistItem) => void }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (itemId: string) => api.delete(`/watchlists/${watchlist.id}/items/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlists'] });
      toast.success('Removed from watchlist');
    },
  });

  if (!watchlist.items.length) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: '#4A5B6C', fontSize: '13px' }}>
        No tickers yet — add one below
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1E2D45' }}>
            {['Symbol', 'Name', 'Price', 'Day %', 'Exch.', ''].map(h => (
              <th key={h} style={{ padding: '8px 16px', textAlign: h === '' ? 'right' : 'left', fontSize: '10px', fontWeight: '600', color: '#4A5B6C', letterSpacing: '0.5px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {watchlist.items.map(item => {
            const up = (item.change_pct ?? 0) >= 0;
            return (
              <tr key={item.id} style={{ borderBottom: '1px solid #1A2840' }}>
                <td style={{ padding: '10px 16px' }}>
                  <button
                    onClick={() => onTickerClick(item)}
                    style={{ fontWeight: '700', color: '#0F7ABF', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    {item.ticker}
                    <Eye style={{ width: '10px', height: '10px', opacity: 0.6 }} />
                  </button>
                </td>
                <td style={{ padding: '10px 16px', color: '#8A95A3', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.company_name || TICKER_TO_NAME[item.ticker] || item.ticker}</td>
                <td style={{ padding: '10px 16px', color: '#C9D4E0', fontVariantNumeric: 'tabular-nums' }}>
                  {item.price != null ? item.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                </td>
                <td style={{ padding: '10px 16px' }}>
                  {item.change_pct != null ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: up ? '#10B981' : '#EF4444', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>
                      {up ? <TrendingUp style={{ width: '10px', height: '10px' }} /> : <TrendingDown style={{ width: '10px', height: '10px' }} />}
                      {up ? '+' : ''}{item.change_pct.toFixed(2)}%
                    </span>
                  ) : <span style={{ color: '#2A3B4C' }}>—</span>}
                </td>
                <td style={{ padding: '10px 16px', color: '#4A5B6C', fontSize: '11px' }}>{item.exchange}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                  <button
                    onClick={() => remove.mutate(item.id)}
                    title="Remove"
                    style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', padding: '4px' }}
                  >
                    <Trash2 style={{ width: '13px', height: '13px' }} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WatchlistsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerTicker, setDrawerTicker] = useState<{ symbol: string; exchange?: string } | null>(null);
  const qc = useQueryClient();

  const { data: watchlists, isLoading, error, refetch } = useWatchlists();

  // Auto-select first watchlist on load
  useEffect(() => {
    if (watchlists && watchlists.length > 0 && !activeId) {
      setActiveId(watchlists[0].id);
    }
  }, [watchlists, activeId]);

  const deleteWatchlist = useMutation({
    mutationFn: (id: string) => api.delete(`/watchlists/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['watchlists'] });
      if (activeId === id) setActiveId(null);
      toast.success('Watchlist deleted');
    },
  });

  const activeWatchlist = watchlists?.find(w => w.id === activeId) ?? null;

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>

      {/* ── Header ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '15px', fontWeight: '700', color: '#F5F7FA', margin: 0 }}>Watchlists</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => refetch()} style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '8px', padding: '7px 10px', color: '#4A5B6C', cursor: 'pointer' }}>
            <RefreshCw style={{ width: '12px', height: '12px' }} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#0F7ABF', color: 'white', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            <Plus style={{ width: '13px', height: '13px' }} /> New Watchlist
          </button>
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && !isLoading && (
        <div style={{ backgroundColor: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircle style={{ width: '16px', height: '16px', color: '#EF4444' }} />
          <span style={{ fontSize: '13px', color: '#fca5a5' }}>Could not load watchlists — is the backend running?</span>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────── */}
      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: '56px', backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '12px' }} className="animate-shimmer" />
          ))}
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────── */}
      {!isLoading && !error && watchlists?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>👁</p>
          <p style={{ fontSize: '15px', fontWeight: '600', color: '#F5F7FA', margin: '0 0 8px' }}>No watchlists yet</p>
          <p style={{ fontSize: '13px', color: '#4A5B6C', margin: '0 0 20px' }}>Create a watchlist to track tickers you care about</p>
          <button
            onClick={() => setShowCreate(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#0F7ABF', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            <Plus style={{ width: '14px', height: '14px' }} /> Create your first watchlist
          </button>
        </div>
      )}

      {/* ── List ─────────────────────────────────────────────────── */}
      {!isLoading && (watchlists?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: '16px' }}>

          {/* Sidebar: watchlist list */}
          <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {watchlists!.map(wl => (
              <div
                key={wl.id}
                onClick={() => setActiveId(wl.id)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  border: `1px solid ${activeId === wl.id ? '#0F7ABF' : '#1E2D45'}`,
                  backgroundColor: activeId === wl.id ? '#0F7ABF18' : '#111B35',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: activeId === wl.id ? '#0F7ABF' : '#C9D4E0', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wl.name}</p>
                  <p style={{ fontSize: '10px', color: '#4A5B6C', margin: 0 }}>{wl.item_count} ticker{wl.item_count !== 1 ? 's' : ''}</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteWatchlist.mutate(wl.id); }}
                  style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', flexShrink: 0, padding: '2px' }}
                  title="Delete watchlist"
                >
                  <Trash2 style={{ width: '12px', height: '12px' }} />
                </button>
              </div>
            ))}
          </div>

          {/* Right panel: ticker table */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeWatchlist ? (
              <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #1E2D45', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 style={{ fontSize: '14px', fontWeight: '700', color: '#F5F7FA', margin: 0 }}>{activeWatchlist.name}</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '11px', color: '#4A5B6C' }}>{activeWatchlist.item_count} {activeWatchlist.item_count === 1 ? 'ticker' : 'tickers'} · Prices delayed ~15 min</span>
                    <button
                      onClick={() => exportCSV(activeWatchlist)}
                      style={{ backgroundColor: '#0D1B2E', border: '1px solid #2A3B4C', borderRadius: '6px', padding: '5px 10px', color: '#0F7ABF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600' }}
                      title="Export to CSV"
                    >
                      <Download style={{ width: '10px', height: '10px' }} /> Export
                    </button>
                  </div>
                </div>
                <WatchlistTable
                  watchlist={activeWatchlist}
                  onTickerClick={item => setDrawerTicker({ symbol: item.ticker, exchange: item.exchange })}
                />
                <AddTickerRow watchlistId={activeWatchlist.id} />
              </div>
            ) : (
              <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: '#4A5B6C', fontSize: '13px' }}>
                ← Select a watchlist to view its tickers
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modals & drawers ──────────────────────────────────────── */}
      {showCreate && <CreateWatchlistModal onClose={() => setShowCreate(false)} />}
      {drawerTicker && (
        <TickerDrawer
          symbol={drawerTicker.symbol}
          exchange={drawerTicker.exchange}
          onClose={() => setDrawerTicker(null)}
        />
      )}
    </div>
  );
}
