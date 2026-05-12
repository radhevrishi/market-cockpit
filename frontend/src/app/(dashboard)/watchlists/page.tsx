'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown, RefreshCw, Download, ArrowUpDown, AlertTriangle, Award } from 'lucide-react';
import toast from 'react-hot-toast';
import TickerSearch, { type TickerSuggestion } from '@/components/TickerSearch';
import { normalizeTicker } from '@/lib/tickers';
import { isPriceSuspect } from '@/lib/nse';
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
import {
  getConvictionList, removeConviction,
  type ConvictionEntry,
} from '@/lib/conviction-beats';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StockQuote {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
}

interface WatchlistItem {
  ticker: string;
  company: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  marketCap?: number | null; // For weighted averages
  flag?: string | null;      // 🟢 🟠 🔴 or null
}

type SortField = 'ticker' | 'company' | 'sector' | 'price' | 'changePercent' | 'dayHigh' | 'dayLow' | 'flag';
type SortOrder = 'asc' | 'desc';

// ── Constants ──────────────────────────────────────────────────────────────────

// No hardcoded default — watchlist comes from Redis API (synced via Telegram bot or UI)
const DEFAULT_TICKERS: string[] = [];

const STORAGE_KEY = 'mc_watchlist_tickers';

// ── Utilities ──────────────────────────────────────────────────────────────────

const getStoredTickers = (): string[] => {
  if (typeof window === 'undefined') return DEFAULT_TICKERS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_TICKERS;
  } catch {
    return DEFAULT_TICKERS;
  }
};

const setStoredTickers = (tickers: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
  } catch {
    // Storage error silently handled
  }
};

const fetchStockQuotes = async (market: string = 'india'): Promise<StockQuote[]> => {
  try {
    const res = await fetch(`/api/market/quotes?market=${market}`);
    if (!res.ok) throw new Error('Failed to fetch quotes');
    const data = await res.json();
    return (data.stocks || []).map((stock: any) => ({
      ticker: stock.ticker,
      company: stock.company || stock.ticker,
      sector: stock.sector || '—',
      industry: stock.industry || '—',
      price: stock.price || 0,
      change: stock.change || 0,
      changePercent: stock.changePercent || 0,
      dayHigh: stock.dayHigh || stock.price || 0,
      dayLow: stock.dayLow || stock.price || 0,
    }));
  } catch (error) {
    console.error('Error fetching quotes:', error);
    return [];
  }
};

// Fetch individual quotes for tickers not in any index (small/micro-cap)
const fetchIndividualQuotes = async (symbols: string[]): Promise<StockQuote[]> => {
  if (symbols.length === 0) return [];
  try {
    // Batch in groups of 20 (API cap)
    const results: StockQuote[] = [];
    for (let i = 0; i < symbols.length; i += 20) {
      const batch = symbols.slice(i, i + 20);
      // Normalize tickers and URL-encode them to handle special chars like &
      const normalizedBatch = batch.map(s => encodeURIComponent(normalizeTicker(s)));
      const res = await fetch(`/api/market/quote?symbols=${normalizedBatch.join(',')}`);
      if (!res.ok) continue;
      const data = await res.json();
      results.push(...(data.stocks || []).map((stock: any) => ({
        ticker: stock.ticker,
        company: stock.company || stock.ticker,
        sector: stock.sector || '—',
        industry: stock.industry || '—',
        price: stock.price || 0,
        change: stock.change || 0,
        changePercent: stock.changePercent || 0,
        dayHigh: stock.dayHigh || stock.price || 0,
        dayLow: stock.dayLow || stock.price || 0,
      })));
    }
    return results;
  } catch (error) {
    console.error('Error fetching individual quotes:', error);
    return [];
  }
};

// ── Summary Component ──────────────────────────────────────────────────────────

function SummaryBar({ items }: { items: WatchlistItem[] }) {
  if (items.length === 0) return null;

  const gainers = items.filter(item => item.changePercent > 0).length;
  const losers = items.filter(item => item.changePercent < 0).length;
  const avgChange = items.reduce((sum, item) => sum + item.changePercent, 0) / items.length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
      <div style={{ backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: '#8BA3C1', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>TOTAL STOCKS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: '#F5F7FA' }}>{items.length}</div>
      </div>
      <div style={{ backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: '#8BA3C1', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>AVG. CHANGE</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: avgChange >= 0 ? '#10B981' : '#EF4444' }}>
          {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
        </div>
      </div>
      <div style={{ backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: '#8BA3C1', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>GAINERS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: '#10B981' }}>{gainers}</div>
      </div>
      <div style={{ backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: '#8BA3C1', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>LOSERS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: '#EF4444' }}>{losers}</div>
      </div>
    </div>
  );
}

// ── Empty State Component ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
      <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 8px' }}>Your watchlist is empty</h2>
      <p style={{ fontSize: '14px', color: '#8BA3C1', margin: '0 0 24px' }}>Add stock tickers to start tracking them. Popular tickers: RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK</p>
      <p style={{ fontSize: '12px', color: '#4A5B6C', margin: 0 }}>💬 Your watchlist syncs with @mc_watchlist_pulse_bot</p>
    </div>
  );
}

// ── Table Component ────────────────────────────────────────────────────────────

function WatchlistTable({
  items,
  sortField,
  sortOrder,
  onSort,
  onRemove,
  onToggleFlag,
}: {
  items: WatchlistItem[];
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  onRemove: (ticker: string) => void;
  onToggleFlag?: (ticker: string) => void;
}) {
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown style={{ width: '12px', height: '12px', opacity: 0.4 }} />;
    return sortOrder === 'asc' ? (
      <TrendingUp style={{ width: '12px', height: '12px' }} />
    ) : (
      <TrendingDown style={{ width: '12px', height: '12px' }} />
    );
  };

  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #2A3B4C', borderRadius: '12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2A3B4C', backgroundColor: '#0D1B2E' }}>
            <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer', width: '40px' }} onClick={() => onSort('flag')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                Flag <SortIcon field="flag" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('ticker')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Ticker <SortIcon field="ticker" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('company')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Company <SortIcon field="company" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('sector')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Sector <SortIcon field="sector" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('price')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                CMP (₹) <SortIcon field="price" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('changePercent')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Change% <SortIcon field="changePercent" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('dayHigh')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Day High <SortIcon field="dayHigh" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('dayLow')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Day Low <SortIcon field="dayLow" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px' }}>
              —
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const isPositive = item.changePercent >= 0;
            return (
              <tr key={item.ticker} style={{ borderBottom: idx < items.length - 1 ? '1px solid #1A2B3C' : 'none', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '8px 8px', textAlign: 'center', width: '40px' }}>
                  <button
                    onClick={() => onToggleFlag?.(item.ticker)}
                    title={`Flag: ${item.flag || 'None'} (click to cycle)`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 4px', borderRadius: '4px', lineHeight: 1 }}
                  >
                    {item.flag || '⚪'}
                  </button>
                </td>
                <td style={{ padding: '12px 16px', color: '#3B82F6', fontWeight: '700' }}>{item.ticker}</td>
                <td style={{ padding: '12px 16px', color: '#F5F7FA', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.company}
                </td>
                <td style={{ padding: '12px 16px', color: '#8BA3C1', fontSize: '12px' }}>{item.sector}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#F5F7FA', fontVariantNumeric: 'tabular-nums' }}>
                  {isPriceSuspect(item.ticker, item.price) ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#FBBF24' }} title="Suspect price - may be incorrect or stale">
                      <AlertTriangle style={{ width: '12px', height: '12px' }} />
                      ₹{item.price.toFixed(2)}
                    </span>
                  ) : (
                    `₹${item.price.toFixed(2)}`
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '6px', backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: isPositive ? '#10B981' : '#EF4444', fontWeight: '600', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                    {isPositive ? <TrendingUp style={{ width: '11px', height: '11px' }} /> : <TrendingDown style={{ width: '11px', height: '11px' }} />}
                    {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                  </span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#F5F7FA', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  ₹{item.dayHigh.toFixed(2)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#F5F7FA', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  ₹{item.dayLow.toFixed(2)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button
                    onClick={() => onRemove(item.ticker)}
                    title="Remove from watchlist"
                    style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.color = '#EF4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#4A5B6C'; }}
                  >
                    <Trash2 style={{ width: '14px', height: '14px' }} />
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

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function WatchlistsPage() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [tickerInput, setTickerInput] = useState('');
  const [sortField, setSortField] = useState<SortField>('ticker');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [watchlistFlags, setWatchlistFlags] = useState<Record<string, string>>({});

  // PATCH 0186 — Tab switcher: 'main' (existing user watchlist) vs 'conviction'
  // (auto-populated from Earnings Ops BLOCKBUSTER + STRONG cards).
  const [activeTab, setActiveTab] = useState<'main' | 'conviction'>('main');
  const [convictionEntries, setConvictionEntries] = useState<ConvictionEntry[]>(() => getConvictionList());
  // Re-read on mount + listen for cross-tab updates
  useEffect(() => {
    setConvictionEntries(getConvictionList());
    if (typeof window === 'undefined') return;
    const refresh = () => setConvictionEntries(getConvictionList());
    window.addEventListener('conviction-beats:updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('conviction-beats:updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const convictionCount = convictionEntries.length;

  // Flag cycle: ⚪ → 🟢 → 🟠 → 🔴 → ⚪
  const handleToggleFlag = useCallback(async (ticker: string) => {
    const cycle = ['', '🟢', '🟠', '🔴'];
    const current = watchlistFlags[ticker] || '';
    const idx = cycle.indexOf(current);
    const next = cycle[(idx + 1) % cycle.length];
    setWatchlistFlags(prev => ({ ...prev, [ticker]: next }));
    // Persist to API
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: CHAT_ID, action: 'set-flag', symbol: ticker, flag: next }),
      });
    } catch {}
  }, [watchlistFlags]);

  // Initialize tickers from API first, fallback to localStorage
  useEffect(() => {
    const initTickers = async () => {
      // Try to sync with shared watchlist (remote is source of truth)
      try {
        const syncRes = await fetch(`/api/watchlist?chatId=${CHAT_ID}`);
        if (syncRes.ok) {
          const syncData = await syncRes.json();
          if (syncData.watchlist && syncData.watchlist.length > 0) {
            // Remote wins: use it as the authoritative source
            setTickers(syncData.watchlist);
            setStoredTickers(syncData.watchlist);
            // Load flags from API
            if (syncData.flags) setWatchlistFlags(syncData.flags);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to sync watchlist:', e);
      }

      // Fallback to localStorage if remote fetch failed or returned empty
      const stored = getStoredTickers();
      setTickers(stored);
    };

    initTickers();
  }, []);

  // Fetch quotes — bulk first, then individual for missing tickers
  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Step 1: Get bulk index quotes
      const bulkQuotes = await fetchStockQuotes('india');

      // Step 2: Find tickers NOT in bulk response
      const bulkTickers = new Set(bulkQuotes.map(q => q.ticker));
      const missingTickers = tickers.filter(t => !bulkTickers.has(t));

      // Step 3: Fetch individual quotes for missing tickers (small/micro-cap)
      let allQuotes = bulkQuotes;
      if (missingTickers.length > 0) {
        console.log(`[Watchlist] Fetching ${missingTickers.length} individual quotes: ${missingTickers.join(', ')}`);
        const individualQuotes = await fetchIndividualQuotes(missingTickers);
        allQuotes = [...bulkQuotes, ...individualQuotes];
      }

      setQuotes(allQuotes);
      setLastRefresh(new Date());
      setLoading(false);
    } catch (error) {
      console.error('Error fetching quotes:', error);
      toast.error('Failed to fetch stock quotes');
      setLoading(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [tickers]);

  // Fetch data whenever tickers change (fixes race condition with async init)
  useEffect(() => {
    if (tickers.length > 0) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [tickers, fetchData]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (tickers.length === 0) return;

    const interval = setInterval(() => {
      fetchData();
    }, 60000);

    return () => clearInterval(interval);
  }, [tickers, fetchData]);

  // Build watchlist items — show ALL tickers, even without live quotes
  const watchlistItems = useMemo(() => {
    return tickers.map(ticker => {
      const quote = quotes.find(q => q.ticker === ticker);
      return {
        ticker,
        company: quote?.company || ticker,
        sector: quote?.sector || '—',
        price: quote?.price || 0,
        change: quote?.change || 0,
        changePercent: quote?.changePercent || 0,
        dayHigh: quote?.dayHigh || 0,
        dayLow: quote?.dayLow || 0,
        flag: watchlistFlags[ticker] || null,
      };
    });
  }, [tickers, quotes, watchlistFlags]);

  // Sort items
  const sortedItems = useMemo(() => {
    const sorted = [...watchlistItems];
    sorted.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [watchlistItems, sortField, sortOrder]);

  // Handle add ticker — supports comma/space separated, strips exchange prefixes, bulk paste
  const handleAddTicker = useCallback(() => {
    const raw = tickerInput.trim();
    if (!raw) return;

    // Split by comma, space, newline, semicolon — handle "NSE:CCL", "BOM:532067" prefixes
    const parsed = raw
      .toUpperCase()
      .split(/[\s,;\n\r]+/)
      .map(t => t.replace(/^(NSE|BSE|BOM|MCX):/, '').trim())
      .filter(t => t.length > 0 && t.length < 30 && /^[A-Z0-9&-]+$/.test(t));

    if (parsed.length === 0) {
      toast.error('No valid ticker symbols found');
      setTickerInput('');
      return;
    }

    // Deduplicate against existing AND within the input itself
    const existing = new Set(tickers);
    const seen = new Set<string>();
    const toAdd: string[] = [];
    const skipped: string[] = [];

    for (const t of parsed) {
      if (existing.has(t) || seen.has(t)) {
        skipped.push(t);
      } else {
        toAdd.push(t);
        seen.add(t);
      }
    }

    if (toAdd.length === 0) {
      toast.error(`All ${parsed.length} tickers already in watchlist`);
      setTickerInput('');
      return;
    }

    const prevTickers = [...tickers]; // snapshot for rollback
    const newTickers = [...tickers, ...toAdd];
    setTickers(newTickers);
    setStoredTickers(newTickers);
    setTickerInput('');

    const msg = skipped.length > 0
      ? `Added ${toAdd.length}, skipped ${skipped.length} (already in list). Total: ${newTickers.length}`
      : `${toAdd.length} ticker${toAdd.length > 1 ? 's' : ''} added. Total: ${newTickers.length}`;
    toast.success(msg);

    // Sync FULL list to shared API — roll back on failure
    fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
    })
      .then(res => {
        if (!res.ok) {
          setTickers(prevTickers); setStoredTickers(prevTickers);
          toast.error('Failed to save — changes reverted');
        }
      })
      .catch(() => {
        setTickers(prevTickers); setStoredTickers(prevTickers);
        toast.error('Network error — changes reverted');
      });

    setTimeout(() => fetchData(), 500);
  }, [tickerInput, tickers, fetchData]);

  // Handle ticker search selection (single ticker from autocomplete)
  const handleSearchSelect = useCallback((rawTicker: string, suggestion?: TickerSuggestion) => {
    // If it looks like bulk paste (has commas), delegate to bulk handler
    if (rawTicker.includes(',') || rawTicker.includes(' ') || rawTicker.includes('\n')) {
      setTickerInput(rawTicker);
      // Trigger bulk add after state update
      setTimeout(() => {
        const parsed = rawTicker.toUpperCase().split(/[\s,;\n\r]+/)
          .map(t => t.replace(/^(NSE|BSE|BOM|MCX):/, '').trim())
          .filter(t => t.length > 0 && t.length < 30 && /^[A-Z0-9&-]+$/.test(t));
        const existing = new Set(tickers);
        const toAdd = parsed.filter(t => !existing.has(t));
        if (toAdd.length === 0) { toast.error('All tickers already in watchlist'); return; }
        const newTickers = [...tickers, ...toAdd];
        setTickers(newTickers);
        setStoredTickers(newTickers);
        toast.success(`${toAdd.length} ticker${toAdd.length > 1 ? 's' : ''} added. Total: ${newTickers.length}`);
        fetch('/api/watchlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
        }).catch(console.error);
        setTimeout(() => fetchData(), 500);
      }, 0);
      return;
    }

    // Single ticker add
    const symbol = rawTicker.toUpperCase().replace(/^(NSE|BSE|BOM|MCX):/, '').trim();
    if (!symbol || !/^[A-Z0-9&-]+$/.test(symbol)) { toast.error('Invalid ticker'); return; }
    if (tickers.includes(symbol)) { toast.error(`${symbol} already in watchlist`); return; }

    const prevTickers = [...tickers];
    const newTickers = [...tickers, symbol];
    setTickers(newTickers);
    setStoredTickers(newTickers);
    toast.success(`${symbol} added to watchlist. Total: ${newTickers.length}`);

    fetch('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
    })
      .then(res => {
        if (!res.ok) { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error(`${symbol} — save failed, reverted`); }
      })
      .catch(() => { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error('Network error — reverted'); });
    setTimeout(() => fetchData(), 500);
  }, [tickers, fetchData]);

  // Build suggestions from quotes for autocomplete
  const searchSuggestions = useMemo((): TickerSuggestion[] => {
    return quotes.map(q => ({
      ticker: q.ticker,
      company: q.company || q.ticker,
      sector: q.sector || '—',
      price: q.price || 0,
      changePercent: q.changePercent || 0,
    }));
  }, [quotes]);

  // Handle remove ticker — with rollback on failure
  const handleRemoveTicker = useCallback((ticker: string) => {
    const prevTickers = [...tickers];
    const newTickers = tickers.filter(t => t !== ticker);
    setTickers(newTickers);
    setStoredTickers(newTickers);
    toast.success(`${ticker} removed from watchlist`);

    fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
    })
      .then(res => {
        if (!res.ok) { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error(`${ticker} — remove failed, reverted`); }
      })
      .catch(() => { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error('Network error — reverted'); });
  }, [tickers]);

  // Handle sort
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField, sortOrder]);

  // Handle export XLSX
  const handleExportXLSX = useCallback(async () => {
    if (sortedItems.length === 0) {
      toast.error('No items to export');
      return;
    }
    const XLSX = await import('xlsx');

    const data = sortedItems.map((item, i) => ({
      '#': i + 1,
      'Ticker': item.ticker,
      'Company': item.company,
      'Sector': item.sector,
      'CMP (₹)': item.price,
      'Change %': parseFloat(item.changePercent.toFixed(2)),
      'Day High': item.dayHigh,
      'Day Low': item.dayLow,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 16 },
      { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Watchlist');
    XLSX.writeFile(wb, `watchlist_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Exported watchlist to XLSX');
  }, [sortedItems]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 4px' }}>Watchlist</h1>
          <p style={{ fontSize: '12px', color: '#8BA3C1', margin: 0 }}>Tracking universe · Observation only · No P&L</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => fetchData()}
            disabled={isRefreshing}
            title="Refresh data"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#1A2B3C',
              border: '1px solid #2A3B4C',
              borderRadius: '10px',
              padding: '10px 14px',
              color: '#8BA3C1',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              transition: 'all 0.2s',
              opacity: isRefreshing ? 0.6 : 1,
            }}
            onMouseEnter={e => !isRefreshing && (e.currentTarget.style.backgroundColor = '#2A3B4C')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1A2B3C')}
          >
            <RefreshCw style={{ width: '14px', height: '14px', transform: isRefreshing ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.6s linear' }} />
            Refresh
          </button>
          <button
            onClick={handleExportXLSX}
            disabled={sortedItems.length === 0}
            title="Export to XLSX"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#1A2B3C',
              border: '1px solid #2A3B4C',
              borderRadius: '10px',
              padding: '10px 14px',
              color: '#8BA3C1',
              cursor: sortedItems.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              transition: 'all 0.2s',
              opacity: sortedItems.length === 0 ? 0.4 : 1,
            }}
            onMouseEnter={e => sortedItems.length > 0 && (e.currentTarget.style.backgroundColor = '#2A3B4C')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1A2B3C')}
          >
            <Download style={{ width: '14px', height: '14px' }} />
            Export
          </button>
        </div>
      </div>

      {/* ── Tab switcher (PATCH 0186) ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2A3B4C', marginBottom: '20px' }}>
        <button onClick={() => setActiveTab('main')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'main' ? '#22D3EE' : 'transparent'}`,
            color: activeTab === 'main' ? '#22D3EE' : '#8BA3C1',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          📋 My Watchlist
          <span style={{ fontSize: 10, color: '#6B7A8D' }}>{tickers.length}</span>
        </button>
        <button onClick={() => setActiveTab('conviction')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'conviction' ? '#F59E0B' : 'transparent'}`,
            color: activeTab === 'conviction' ? '#F59E0B' : '#8BA3C1',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          <Award style={{ width: 13, height: 13 }} />
          Conviction Beats
          <span style={{
            fontSize: 10, fontWeight: 800,
            padding: '1px 6px', borderRadius: 8,
            backgroundColor: convictionCount > 0 ? '#F59E0B22' : '#1A2B3C',
            color: convictionCount > 0 ? '#F59E0B' : '#6B7A8D',
          }}>{convictionCount}</span>
        </button>
      </div>

      {activeTab === 'conviction' ? (
        <ConvictionBeatsPanel entries={convictionEntries} onRemove={(t) => { removeConviction(t); setConvictionEntries(getConvictionList()); }} />
      ) : (
      <>
      {/* ── Add Ticker Search ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <TickerSearch
            onSelect={handleSearchSelect}
            quotes={searchSuggestions}
            existingTickers={tickers}
            placeholder="Search company name or ticker... (or paste bulk: INFY, TCS, RELIANCE)"
            allowBulk={true}
            clearOnSelect={true}
          />
        </div>
      </div>

      {/* ── Summary ───────────────────────────────────────────────────────── */}
      {tickers.length > 0 && <SummaryBar items={sortedItems} />}

      {/* ── Loading State ─────────────────────────────────────────────────── */}
      {loading && tickers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              style={{
                height: '48px',
                backgroundColor: '#1A2B3C',
                border: '1px solid #2A3B4C',
                borderRadius: '10px',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }}
            />
          ))}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {!loading && tickers.length > 0 && (
        <div>
          <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: '12px', color: '#8BA3C1', margin: 0 }}>
              {sortedItems.length} stocks · Last refreshed: {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
            </p>
          </div>
          <WatchlistTable
            items={sortedItems}
            sortField={sortField}
            sortOrder={sortOrder}
            onSort={handleSort}
            onRemove={handleRemoveTicker}
            onToggleFlag={handleToggleFlag}
          />
        </div>
      )}

      {/* ── Empty State ───────────────────────────────────────────────────── */}
      {!loading && tickers.length === 0 && <EmptyState />}

      {/* ── Telegram Sync Info ────────────────────────────────────────────── */}
      {tickers.length > 0 && (
        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '10px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#8BA3C1', margin: 0 }}>
            💬 Your watchlist syncs with <span style={{ fontWeight: '600', color: '#3B82F6' }}>@mc_watchlist_pulse_bot</span>
          </p>
        </div>
      )}
      </>
      )}

      {/* ── CSS Animation ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVICTION BEATS PANEL (PATCH 0186)
// Auto-populated bench of BLOCKBUSTER + STRONG earnings prints from
// /earnings-opportunities. localStorage-backed via lib/conviction-beats.ts.
// ═══════════════════════════════════════════════════════════════════════════
function ConvictionBeatsPanel({ entries, onRemove }: { entries: ConvictionEntry[]; onRemove: (t: string) => void }) {
  if (entries.length === 0) {
    return (
      <div style={{
        padding: '40px 24px', textAlign: 'center',
        backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: 12,
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🏆</div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 6px' }}>
          Conviction Beats — empty
        </h3>
        <p style={{ fontSize: 12, color: '#8BA3C1', margin: '0 0 12px', lineHeight: 1.5 }}>
          This bench auto-fills with stocks that print BLOCKBUSTER or STRONG earnings in <strong style={{ color: '#22D3EE' }}>/earnings-opportunities</strong>.
          <br />Visit that page after a day of filings; this list will populate automatically.
        </p>
        <a href="/earnings-opportunities" style={{
          display: 'inline-block', padding: '8px 16px',
          backgroundColor: '#F59E0B15', border: '1px solid #F59E0B60',
          borderRadius: 6, color: '#F59E0B', fontSize: 12, fontWeight: 700,
          textDecoration: 'none',
        }}>Open Earnings Opportunities →</a>
      </div>
    );
  }
  const blockbusters = entries.filter((e) => e.tier === 'BLOCKBUSTER');
  const strongs = entries.filter((e) => e.tier === 'STRONG');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        padding: '10px 14px', backgroundColor: '#0A1422',
        border: '1px solid #1A2840', borderRadius: 8,
        fontSize: 11.5, color: '#8BA3C1', lineHeight: 1.5,
      }}>
        Institutional bench of high-quality post-earnings setups.
        Auto-populated from <strong style={{ color: '#22D3EE' }}>Earnings Opportunities</strong> whenever a stock prints BLOCKBUSTER or STRONG.
        Removed entries don't auto-readd — use × to permanently prune.
      </div>
      {blockbusters.length > 0 && (
        <div style={{
          backgroundColor: '#0D1623',
          border: '1px solid #F59E0B40', borderLeft: '4px solid #F59E0B',
          borderRadius: 12, padding: '14px 18px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', marginBottom: 10, letterSpacing: '0.5px' }}>
            ⭐ BLOCKBUSTER · {blockbusters.length}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {blockbusters.map((e) => <ConvictionRow key={e.ticker} entry={e} onRemove={onRemove} />)}
          </div>
        </div>
      )}
      {strongs.length > 0 && (
        <div style={{
          backgroundColor: '#0D1623',
          border: '1px solid #10B98140', borderLeft: '4px solid #10B981',
          borderRadius: 12, padding: '14px 18px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#10B981', marginBottom: 10, letterSpacing: '0.5px' }}>
            🟢 STRONG · {strongs.length}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {strongs.map((e) => <ConvictionRow key={e.ticker} entry={e} onRemove={onRemove} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ConvictionRow({ entry, onRemove }: { entry: ConvictionEntry; onRemove: (t: string) => void }) {
  const tierColor = entry.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
  const pct = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
  return (
    <div style={{
      padding: '10px 12px', backgroundColor: '#0A1422',
      border: '1px solid #1A2840', borderLeft: `3px solid ${tierColor}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.company}
          </div>
          <div style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: '#8BA3C1', display: 'flex', gap: 6 }}>
            <span style={{ fontWeight: 700 }}>{entry.ticker}</span>
            <span style={{ color: '#6B7A8D' }}>·</span>
            <span>filed {entry.filing_date}</span>
            {entry.sector && (<><span style={{ color: '#6B7A8D' }}>·</span><span>{entry.sector}</span></>)}
          </div>
        </div>
        <div style={{
          fontSize: 14, fontWeight: 900, color: tierColor,
          fontFamily: 'ui-monospace, monospace',
        }}>{entry.composite_score}</div>
        <button onClick={() => onRemove(entry.ticker)} title="Remove from Conviction Beats"
          style={{
            background: 'none', border: 'none', color: '#6B7A8D',
            cursor: 'pointer', padding: '2px 6px', fontSize: 14,
          }}>×</button>
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: 10.5 }}>
        <span><span style={{ color: '#6B7A8D' }}>Sales</span> <strong style={{ color: (entry.sales_yoy_pct ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{pct(entry.sales_yoy_pct)}</strong></span>
        <span><span style={{ color: '#6B7A8D' }}>PAT</span> <strong style={{ color: (entry.net_profit_yoy_pct ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{pct(entry.net_profit_yoy_pct)}</strong></span>
        <span><span style={{ color: '#6B7A8D' }}>EPS</span> <strong style={{ color: (entry.eps_yoy_pct ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{pct(entry.eps_yoy_pct)}</strong></span>
      </div>
      {entry.source_url && (
        <a href={entry.source_url} target="_blank" rel="noreferrer"
          style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>
          📄 Filing →
        </a>
      )}
    </div>
  );
}
