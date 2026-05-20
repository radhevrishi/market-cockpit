'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { peadScore, peadColor, peadLabel } from '@/lib/pead-score';
import TickerExportToolbar from '@/components/TickerExportToolbar';
import {
  EarningsCardComponent,
  CoverageStatsBar,
  type EarningsScanCard,
} from '@/components/EarningsScanCard';

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
  // PATCH 0442 BUG-020 — extra columns
  volume?: number | null;
  week52High?: number | null;
  week52Low?: number | null;
  peRatio?: number | null;
  avgVolume?: number | null;
}

type SortField = 'ticker' | 'company' | 'sector' | 'price' | 'changePercent' | 'dayHigh' | 'dayLow' | 'flag' | 'volume' | 'week52High' | 'week52Low' | 'marketCap' | 'peRatio';
type SortOrder = 'asc' | 'desc';

// PATCH 0442 BUG-020/027 — Optional columns the user can toggle on. Persisted
// to localStorage so the choice survives reloads.
type OptionalCol = 'volume' | 'week52High' | 'week52Low' | 'marketCap' | 'peRatio' | 'avgVolume';
const OPTIONAL_COLS: Array<{ id: OptionalCol; label: string }> = [
  { id: 'volume',      label: 'Volume' },
  { id: 'week52High',  label: '52W High' },
  { id: 'week52Low',   label: '52W Low' },
  { id: 'marketCap',   label: 'Market Cap' },
  { id: 'peRatio',     label: 'P/E (TTM)' },
  { id: 'avgVolume',   label: 'Avg Vol (20D)' },
];
const COL_PREFS_KEY = 'mc:watchlist:cols:v1';

function loadColPrefs(): Set<OptionalCol> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(COL_PREFS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr as OptionalCol[] : []);
  } catch { return new Set(); }
}
function saveColPrefs(cols: Set<OptionalCol>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(COL_PREFS_KEY, JSON.stringify(Array.from(cols))); } catch {}
}

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

// PATCH 0445 BUG-020/037 — Always include the 6 optional columns when
// fetching quotes. Previously the response mapper dropped marketCap /
// volume / 52w / avgVolume / peRatio, so toggling the column chooser
// surfaced '—' in every row. Now they ride along on every map call.
const fetchStockQuotes = async (market: string = 'india'): Promise<StockQuote[]> => {
  // PATCH 0464 — bounded fetch. Previously this could hang the watchlist
  // refresh loop if /api/market/quotes was slow; AbortController fires at
  // 12s so the page never stalls indefinitely.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(`/api/market/quotes?market=${market}`, { signal: ctl.signal });
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
      // PATCH 0445 — optional columns
      volume: stock.volume ?? null,
      marketCap: stock.marketCap ?? stock.mcap ?? null,
      previousClose: stock.previousClose ?? null,
      week52High: stock.week52High ?? stock.fiftyTwoWeekHigh ?? null,
      week52Low: stock.week52Low ?? stock.fiftyTwoWeekLow ?? null,
      peRatio: stock.peRatio ?? stock.pe ?? null,
      avgVolume: stock.avgVolume ?? stock.averageDailyVolume3Month ?? null,
    }));
  } catch (error) {
    console.error('Error fetching quotes:', error);
    return [];
  } finally {
    clearTimeout(timer);
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
      // PATCH 0464 — per-batch 10s timeout. Without this, a single hung
      // batch could block the whole watchlist refresh.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch(`/api/market/quote?symbols=${normalizedBatch.join(',')}`, { signal: ctl.signal });
      } catch {
        clearTimeout(timer);
        continue;
      }
      clearTimeout(timer);
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
        // PATCH 0445 — optional columns
        volume: stock.volume ?? null,
        marketCap: stock.marketCap ?? stock.mcap ?? null,
        previousClose: stock.previousClose ?? null,
        week52High: stock.week52High ?? stock.fiftyTwoWeekHigh ?? null,
        week52Low: stock.week52Low ?? stock.fiftyTwoWeekLow ?? null,
        peRatio: stock.peRatio ?? stock.pe ?? null,
        avgVolume: stock.avgVolume ?? stock.averageDailyVolume3Month ?? null,
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
  // AUDIT_100 #22 — exclude items with price=0 (fallback / pre-market /
  // missing quote) before averaging. Otherwise the headline "Avg Change"
  // is dragged toward 0 even when 5 of 6 real stocks are solidly up.
  const valid = items.filter(item => (item.price ?? 0) > 0);
  const avgChange = valid.length > 0
    ? valid.reduce((sum, item) => sum + item.changePercent, 0) / valid.length
    : 0;

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
      {/* PATCH 0303 — Cross-link the institutional channels users can populate
          the watchlist from, so the empty state never feels like a dead end. */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <a
          href="/earnings-opportunities"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid rgba(245,158,11,0.4)',
            backgroundColor: 'rgba(245,158,11,0.10)',
            color: '#F59E0B', fontSize: 12, fontWeight: 700,
            textDecoration: 'none',
          }}
        >🏆 Auto-populate from Conviction Beats →</a>
        <a
          href="/screener"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid rgba(15,122,191,0.4)',
            backgroundColor: 'rgba(15,122,191,0.10)',
            color: '#0F7ABF', fontSize: 12, fontWeight: 700,
            textDecoration: 'none',
          }}
        >🔍 Find tickers in Screener →</a>
      </div>
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
  // PATCH 0442 BUG-020/027 — column chooser
  const [activeCols, setActiveCols] = useState<Set<OptionalCol>>(() => loadColPrefs());
  const [chooserOpen, setChooserOpen] = useState(false);
  const toggleCol = (id: OptionalCol) => {
    setActiveCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveColPrefs(next);
      return next;
    });
  };
  const formatVolume = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(0);
  };
  const formatMcap = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v >= 1e12) return `₹${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `₹${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(0)} Cr`;
    return `₹${v.toFixed(0)}`;
  };
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
            {/* PATCH 0442 BUG-020 — Optional columns rendered based on chooser state */}
            {OPTIONAL_COLS.filter(c => activeCols.has(c.id)).map(c => (
              <th key={c.id} style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort(c.id as SortField)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                  {c.label} <SortIcon field={c.id as SortField} />
                </div>
              </th>
            ))}
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: '#8BA3C1', letterSpacing: '0.5px', position: 'relative' }}>
              {/* PATCH 0442 BUG-027 — Working column chooser. Click to toggle
                  popover; select Volume / 52W / Mcap / PE / Avg Vol columns. */}
              <button
                onClick={() => setChooserOpen(o => !o)}
                title="Configure columns"
                style={{
                  background: chooserOpen ? '#0F7ABF30' : 'transparent',
                  border: `1px solid ${chooserOpen ? '#22D3EE' : '#2A3B4C'}`,
                  borderRadius: 6, color: chooserOpen ? '#22D3EE' : '#8BA3C1',
                  cursor: 'pointer', padding: '4px 9px', fontSize: '10px', fontWeight: 700,
                }}
              >⚙ Columns ({activeCols.size})</button>
              {chooserOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 8, marginTop: 4, zIndex: 50,
                  minWidth: 200, padding: 8, background: '#0D1B2E', border: '1px solid #2A3B4C',
                  borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                }}>
                  <div style={{ fontSize: 10, color: '#8BA3C1', marginBottom: 6, letterSpacing: '0.4px' }}>SHOW COLUMNS</div>
                  {OPTIONAL_COLS.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 4 }}>
                      <input type="checkbox" checked={activeCols.has(c.id)} onChange={() => toggleCol(c.id)} />
                      <span style={{ fontSize: 11, color: '#F5F7FA' }}>{c.label}</span>
                    </label>
                  ))}
                  <div style={{ fontSize: 9, color: '#4A5B6C', marginTop: 6, fontStyle: 'italic' }}>
                    Data may be — when source doesn&apos;t return the field
                  </div>
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const isPositive = item.changePercent >= 0;
            return (
              <tr key={item.ticker} data-watchlist-ticker={item.ticker} style={{ borderBottom: idx < items.length - 1 ? '1px solid #1A2B3C' : 'none', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
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
                {/* PATCH 0442 BUG-020 — Optional column cells */}
                {OPTIONAL_COLS.filter(c => activeCols.has(c.id)).map(c => {
                  const val = (item as any)[c.id] as number | null | undefined;
                  let txt = '—';
                  if (val != null && Number.isFinite(val)) {
                    if (c.id === 'volume' || c.id === 'avgVolume') txt = formatVolume(val);
                    else if (c.id === 'marketCap') txt = formatMcap(val);
                    else if (c.id === 'peRatio') txt = val.toFixed(1) + 'x';
                    else txt = `₹${val.toFixed(2)}`;
                  }
                  return (
                    <td key={c.id} style={{ padding: '12px 16px', textAlign: 'right', color: txt === '—' ? '#4A5B6C' : '#F5F7FA', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                      {txt}
                    </td>
                  );
                })}
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
  // PATCH 0297 — Functional setState so rapid double-clicks always read the
  // latest flag state. The previous closure read `watchlistFlags[ticker]`
  // captured at render time, which could race when two clicks fired
  // back-to-back before re-render.
  const handleToggleFlag = useCallback(async (ticker: string) => {
    const cycle = ['', '🟢', '🟠', '🔴'];
    let nextFlag = '';
    setWatchlistFlags(prev => {
      const current = prev[ticker] || '';
      const idx = cycle.indexOf(current);
      nextFlag = cycle[(idx + 1) % cycle.length];
      return { ...prev, [ticker]: nextFlag };
    });
    // Persist to API — fire after state update; reads `nextFlag` from the
    // closure populated inside the setState callback above.
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: CHAT_ID, action: 'set-flag', symbol: ticker, flag: nextFlag }),
      });
    } catch {}
  }, []);

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
      // AUDIT_100 #3 — fetch BOTH markets in parallel so US holdings
      // (NVDA / TSM / RKLB etc.) get live quotes alongside Indian names.
      const [india, us] = await Promise.all([
        fetchStockQuotes('india'),
        fetchStockQuotes('us'),
      ]);
      const bulkQuotes = [...india, ...us];

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

    // AUDIT_100 #7 — skip poll when tab is hidden
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
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
      let aVal: any = (a as any)[sortField];
      let bVal: any = (b as any)[sortField];

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
    // AUDIT_100 #27 — scroll the new row into view. With 60+ stocks the user
    // has to manually search for what they just added; data-ticker attribute
    // on each row lets us find + scroll the freshly-inserted one.
    setTimeout(() => {
      try {
        const el = document.querySelector(`[data-watchlist-ticker="${symbol}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {}
    }, 600);

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
// USER-REQ — Conviction Beats composable filters
//   1) Op-leverage (PAT/Sales ratio)  ≥1.5× / ≥2× / ≥3×
//   2) Sales YoY  ≥20/30/40/50%
//   3) PAT YoY    ≥20/30/40/50/60/100%
//   4) EPS YoY    ≥20/40/60%
// All compose AND-style. Counts beside each chip reflect the current
// post-filter universe so the user can see how each chip narrows.
type ConvFilters = {
  opLev: number | null;     // ratio threshold (1.5/2/3)
  sales: number | null;     // % threshold
  pat: number | null;
  eps: number | null;
  pead: number | null;      // USER-REQ — minimum PEAD score (50/60/70/80)
  sortByPead: boolean;
  // USER-REQ — Guidance in Conviction tab. null = no filter; specific label
  // means "only entries whose derived guidance matches this label".
  guidance: 'Positive' | 'Negative' | 'Neutral' | null;
};

const FILTER_DEFAULT: ConvFilters = { opLev: null, sales: null, pat: null, eps: null, pead: null, sortByPead: false, guidance: null };

function passesConvictionFilter(e: ConvictionEntry, f: ConvFilters): boolean {
  const sales = e.sales_yoy_pct ?? 0;
  const pat = e.net_profit_yoy_pct ?? 0;
  const eps = e.eps_yoy_pct ?? 0;
  if (f.sales != null && sales < f.sales) return false;
  if (f.pat != null && pat < f.pat) return false;
  if (f.eps != null && eps < f.eps) return false;
  if (f.opLev != null) {
    const ratio = pat / Math.max(sales, 0.01);
    if (!(ratio >= f.opLev)) return false;
  }
  // USER-REQ — PEAD score threshold filter (combinable with all others)
  if (f.pead != null) {
    if (peadScore(e).score < f.pead) return false;
  }
  // USER-REQ — Guidance in Conviction tab. Missing guidance treated as
  // non-match when a specific label is requested.
  if (f.guidance != null) {
    if (e.guidance !== f.guidance) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0539 — Rich Earnings Hub Scan parity for Conviction Beats.
// Fetches enriched EarningsScanCard payloads for the bench tickers via the
// same /api/market/earnings-scan endpoint the /earnings hub uses, caches in
// localStorage (24h TTL — past quarters are immutable), and surfaces the
// SAME card UI Earnings Hub Scan renders. Existing compact rows still
// available via the view-mode toggle.
// ═══════════════════════════════════════════════════════════════════════════
const RICH_LS_KEY = 'mc:conviction-enriched:v1';
const RICH_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface RichCache {
  cards: Record<string, { card: EarningsScanCard; ts: number }>;
}

function readRichCache(): RichCache {
  if (typeof window === 'undefined') return { cards: {} };
  try {
    const raw = localStorage.getItem(RICH_LS_KEY);
    if (!raw) return { cards: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.cards) return { cards: {} };
    return parsed as RichCache;
  } catch { return { cards: {} }; }
}

function writeRichCache(c: RichCache) {
  if (typeof window === 'undefined') return;
  // PATCH 0541 — prune TTL-expired entries on write so the cache doesn't
  // grow unbounded over time as users add/remove conviction entries.
  // 24h TTL on cards, but allow a 7-day grace (older entries removed).
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const pruned: RichCache = { cards: {} };
  for (const [k, v] of Object.entries(c.cards)) {
    if (v?.ts && v.ts > cutoff) pruned.cards[k] = v;
  }
  try { localStorage.setItem(RICH_LS_KEY, JSON.stringify(pruned)); } catch {
    // Quota exceeded — wipe entirely rather than half-write.
    try { localStorage.removeItem(RICH_LS_KEY); } catch {}
  }
}

/** Returns the cached card for a ticker if it's fresh, else null. */
function getCachedCard(ticker: string, cache: RichCache): EarningsScanCard | null {
  const key = ticker.toUpperCase();
  const entry = cache.cards[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > RICH_TTL_MS) return null;
  return entry.card;
}

/** Hook — owns enriched-card state for the bench. */
function useEnrichedConvictionCards(tickers: string[]) {
  const [cards, setCards] = useState<Record<string, EarningsScanCard>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  // PATCH 0541 — unmount guard for the refetch path (the useEffect path
  // already has its own cancelled flag; refetch was missing it).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tickers.length === 0) return;
    let cancelled = false;
    const cache = readRichCache();

    // Hydrate from cache first
    const fromCache: Record<string, EarningsScanCard> = {};
    const missing: string[] = [];
    for (const t of tickers) {
      const hit = getCachedCard(t, cache);
      if (hit) fromCache[t.toUpperCase()] = hit;
      else missing.push(t.toUpperCase());
    }
    setCards(fromCache);

    if (missing.length === 0) {
      setProgress({ done: tickers.length, total: tickers.length });
      return;
    }

    setLoading(true);
    setProgress({ done: tickers.length - missing.length, total: tickers.length });
    setError(null);

    (async () => {
      try {
        const BATCH = 30;
        const PARALLEL = 3;
        const batches: string[][] = [];
        for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
        const updated: Record<string, EarningsScanCard> = { ...fromCache };
        const cacheUpdate = readRichCache();

        for (let w = 0; w < batches.length; w += PARALLEL) {
          if (cancelled) return;
          const wave = batches.slice(w, w + PARALLEL);
          const results = await Promise.allSettled(
            wave.map(async (batch) => {
              const ctl = new AbortController();
              const timer = setTimeout(() => ctl.abort(), 25_000);
              try {
                const encoded = batch.map(s => encodeURIComponent(s)).join(',');
                const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: ctl.signal });
                clearTimeout(timer);
                if (!res.ok) return null;
                return (await res.json()) as { cards: EarningsScanCard[] };
              } catch {
                clearTimeout(timer);
                return null;
              }
            })
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              for (const c of (r.value.cards || [])) {
                const key = c.symbol.toUpperCase();
                updated[key] = { ...c, universeTag: 'conviction', isConviction: true };
                cacheUpdate.cards[key] = { card: updated[key], ts: Date.now() };
              }
            }
          }
          if (cancelled) return;
          setCards({ ...updated });
          setProgress({ done: Object.keys(updated).length, total: tickers.length });
        }
        writeRichCache(cacheUpdate);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to fetch enriched cards');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join('|')]);

  const refetch = useCallback(() => {
    // Force-bust cache for these tickers, then re-trigger by toggling state
    const cache = readRichCache();
    for (const t of tickers) delete cache.cards[t.toUpperCase()];
    writeRichCache(cache);
    setCards({});
    // re-trigger effect via dummy state change (will re-read tickers)
    setProgress({ done: 0, total: tickers.length });
    // The effect depends on tickers.join('|'); we have to nudge it via a
    // ref-like state. Simplest: just re-run the same load logic inline.
    (async () => {
      if (!mountedRef.current) return;
      setLoading(true);
      try {
        const BATCH = 30;
        const PARALLEL = 3;
        const all = tickers.map(t => t.toUpperCase());
        const batches: string[][] = [];
        for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
        const updated: Record<string, EarningsScanCard> = {};
        const cacheUpdate = readRichCache();
        for (let w = 0; w < batches.length; w += PARALLEL) {
          if (!mountedRef.current) return;
          const wave = batches.slice(w, w + PARALLEL);
          const results = await Promise.allSettled(
            wave.map(async (batch) => {
              const encoded = batch.map(s => encodeURIComponent(s)).join(',');
              try {
                const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`);
                if (!res.ok) return null;
                return (await res.json()) as { cards: EarningsScanCard[] };
              } catch { return null; }
            })
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              for (const c of (r.value.cards || [])) {
                const key = c.symbol.toUpperCase();
                updated[key] = { ...c, universeTag: 'conviction', isConviction: true };
                cacheUpdate.cards[key] = { card: updated[key], ts: Date.now() };
              }
            }
          }
          if (!mountedRef.current) return;
          setCards({ ...updated });
          setProgress({ done: Object.keys(updated).length, total: tickers.length });
        }
        writeRichCache(cacheUpdate);
      } catch (e: any) {
        console.warn('[Conviction enrichment refetch]', e?.message || e);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
  }, [tickers]);

  return { cards, loading, progress, error, refetch };
}

// PATCH 0539 — Hub-Scan-style filter rail for the rich view.
type HubFilters = {
  grades: Set<'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD'>;
  scoreMin: number | null;           // 60 / 75 / 85
  divergenceOnly: boolean;
  dataQuality: Set<'FULL' | 'PARTIAL' | 'PRICE_ONLY'>;
  audience: Set<'PORTFOLIO' | 'WATCHLIST' | 'BOTH' | 'BANK'>;
};
const HUB_FILTER_DEFAULT: HubFilters = {
  grades: new Set(),
  scoreMin: null,
  divergenceOnly: false,
  dataQuality: new Set(),
  audience: new Set(),
};

function audienceFromCard(c: EarningsScanCard, watchlistTickers: Set<string>, portfolioTickers: Set<string>): 'PORTFOLIO' | 'WATCHLIST' | 'BOTH' | 'BANK' {
  const sym = c.symbol.toUpperCase();
  if (c.isBanking) return 'BANK';
  const inP = portfolioTickers.has(sym);
  const inW = watchlistTickers.has(sym);
  if (inP && inW) return 'BOTH';
  if (inP) return 'PORTFOLIO';
  return 'WATCHLIST';
}

function passesHubFilter(c: EarningsScanCard, f: HubFilters, watchlist: Set<string>, portfolio: Set<string>): boolean {
  if (f.grades.size > 0 && !f.grades.has(c.grade)) return false;
  if (f.scoreMin != null && c.totalScore < f.scoreMin) return false;
  if (f.divergenceOnly && (!c.divergence || c.divergence === 'None')) return false;
  if (f.dataQuality.size > 0 && !f.dataQuality.has(c.dataQuality)) return false;
  if (f.audience.size > 0) {
    const a = audienceFromCard(c, watchlist, portfolio);
    if (!f.audience.has(a)) return false;
  }
  return true;
}

function ConvictionBeatsPanel({ entries, onRemove }: { entries: ConvictionEntry[]; onRemove: (t: string) => void }) {
  // PATCH 0540 — all hooks declared BEFORE any early-return so React's
  // Rules-of-Hooks holds across the empty-bench → populated-bench transition
  // (previously the empty-state returned before useState, which would have
  // crashed if the bench populated while the user was on the tab).
  // USER-REQ — filter state (composable AND)
  const [filters, setFilters] = useState<ConvFilters>(FILTER_DEFAULT);
  const toggle = <K extends keyof ConvFilters>(k: K, v: ConvFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: f[k] === v ? null : v } as ConvFilters));

  // PATCH 0539 — view-mode toggle (compact rows vs rich Earnings Hub cards)
  // Default: rich. localStorage so the user's preference survives reloads.
  const [viewMode, setViewMode] = useState<'rich' | 'compact'>(() => {
    if (typeof window === 'undefined') return 'rich';
    try { return (localStorage.getItem('mc:conviction-view') as 'rich' | 'compact') || 'rich'; } catch { return 'rich'; }
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('mc:conviction-view', viewMode); } catch {}
    }
  }, [viewMode]);

  // PATCH 0539 — Hub-Scan-style filter rail (rich view only)
  const [hubFilters, setHubFilters] = useState<HubFilters>(HUB_FILTER_DEFAULT);

  // PATCH 0539 — read watchlist + portfolio tickers for audience tagging.
  const [watchlistSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('mc_watchlist_tickers');
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set((Array.isArray(arr) ? arr : []).map((t: string) => String(t).toUpperCase()));
    } catch { return new Set(); }
  });
  const [portfolioSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      // Try the common portfolio keys; fall back to empty.
      for (const key of ['mc_portfolio_tickers', 'mc_portfolio_holdings_v1']) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            return new Set(arr.map((t: any) => String(typeof t === 'string' ? t : (t?.ticker || '')).toUpperCase()).filter(Boolean));
          }
          if (arr && typeof arr === 'object') {
            return new Set(Object.keys(arr).map(k => k.toUpperCase()));
          }
        }
      }
    } catch {}
    return new Set();
  });

  // Apply filters + optional PEAD sort
  let filteredEntries = entries.filter((e) => passesConvictionFilter(e, filters));
  if (filters.sortByPead) {
    filteredEntries = [...filteredEntries].sort((a, b) => peadScore(b).score - peadScore(a).score);
  }
  const blockbusters = filteredEntries.filter((e) => e.tier === 'BLOCKBUSTER');
  const strongs = filteredEntries.filter((e) => e.tier === 'STRONG');
  const allTickers = filteredEntries.map((e) => e.ticker);

  // PATCH 0539 — fetch enriched cards for the bench (cached 24h).
  // Trigger only when in rich mode and after the first render.
  const tickersForFetch = useMemo(() => filteredEntries.map(e => e.ticker), [filteredEntries.map(e => e.ticker).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const { cards: enrichedCards, loading: richLoading, progress: richProgress, refetch: richRefetch } = useEnrichedConvictionCards(
    viewMode === 'rich' ? tickersForFetch : [],
  );

  // Apply hub filter on top of the conviction-filtered list (memoized — was
  // recomputing on every render even when nothing changed).
  const enrichedList = useMemo(() => filteredEntries
    .map(e => enrichedCards[e.ticker.toUpperCase()])
    .filter((c): c is EarningsScanCard => Boolean(c)),
    [filteredEntries, enrichedCards]);
  const hubFilteredList = useMemo(() => enrichedList.filter(
    c => passesHubFilter(c, hubFilters, watchlistSet, portfolioSet)),
    [enrichedList, hubFilters, watchlistSet, portfolioSet]);

  // PATCH 0540 — empty-state render AFTER all hooks (fixes Rules-of-Hooks
  // landmine if the bench transitions from empty → populated mid-render).
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

  // Counts for each candidate chip — applied INDEPENDENTLY to the
  // post-other-filters universe so the count reflects what the chip would
  // narrow TO when toggled on (preserves AND-composable semantics).
  const countWith = (k: keyof ConvFilters, v: number) => {
    const probe: ConvFilters = { ...filters, [k]: v } as ConvFilters;
    return entries.filter((e) => passesConvictionFilter(e, probe)).length;
  };

  const chipBase: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, padding: '4px 9px', borderRadius: 14,
    cursor: 'pointer', border: '1px solid #2A3B4C', background: '#0A1422',
    color: '#8BA3C1', whiteSpace: 'nowrap',
  };
  const chipActive = (color: string): React.CSSProperties => ({
    ...chipBase,
    background: `${color}22`, borderColor: `${color}99`, color,
  });
  const renderChipGroup = (
    label: string, color: string, k: keyof ConvFilters,
    options: Array<{ v: number; lbl: string }>,
  ) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>{label}</span>
      {options.map((o) => {
        const active = filters[k] === o.v;
        const n = countWith(k, o.v);
        return (
          <button key={o.v} onClick={() => toggle(k, o.v as any)}
            style={active ? chipActive(color) : chipBase}>
            {o.lbl} <span style={{ color: active ? color : '#6B7A8D', marginLeft: 3 }}>({n})</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* USER-REQ — composable filter chips (Op-leverage / Sales / PAT / EPS YoY)
          + PEAD sort toggle. Renders at TOP of the Conviction Beats tab. */}
      <div style={{
        padding: '10px 14px', backgroundColor: '#0A1422',
        border: '1px solid #1A2840', borderRadius: 8,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#E6EDF3', letterSpacing: '0.4px' }}>
            FILTERS <span style={{ color: '#6B7A8D', fontWeight: 600 }}>· {filteredEntries.length} of {entries.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setFilters((f) => ({ ...f, sortByPead: !f.sortByPead }))}
              style={filters.sortByPead ? chipActive('#22D3EE') : chipBase}>
              🌊 Sort by PEAD {filters.sortByPead ? '✓' : ''}
            </button>
            <button onClick={() => setFilters(FILTER_DEFAULT)}
              disabled={filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && !filters.sortByPead}
              style={{ ...chipBase, opacity: (filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && !filters.sortByPead) ? 0.4 : 1 }}>
              Clear
            </button>
          </div>
        </div>
        {renderChipGroup('OP-LEV (PAT/Sales)', '#A78BFA', 'opLev', [
          { v: 1.5, lbl: '≥1.5×' }, { v: 2, lbl: '≥2×' }, { v: 3, lbl: '≥3×' },
        ])}
        {renderChipGroup('SALES YoY', '#22D3EE', 'sales', [
          { v: 20, lbl: '≥20%' }, { v: 30, lbl: '≥30%' }, { v: 40, lbl: '≥40%' }, { v: 50, lbl: '≥50%' },
        ])}
        {renderChipGroup('PAT YoY', '#10B981', 'pat', [
          { v: 20, lbl: '≥20%' }, { v: 30, lbl: '≥30%' }, { v: 40, lbl: '≥40%' },
          { v: 50, lbl: '≥50%' }, { v: 60, lbl: '≥60%' }, { v: 100, lbl: '≥100%' },
        ])}
        {renderChipGroup('EPS YoY', '#F59E0B', 'eps', [
          { v: 20, lbl: '≥20%' }, { v: 40, lbl: '≥40%' }, { v: 60, lbl: '≥60%' },
        ])}
        {/* USER-REQ — PEAD score threshold filter (composable with all others) */}
        {renderChipGroup('PEAD SCORE', '#22D3EE', 'pead', [
          { v: 50, lbl: '≥50' }, { v: 60, lbl: '≥60' }, { v: 70, lbl: '≥70' }, { v: 80, lbl: '≥80' },
        ])}
        {/* USER-REQ — Guidance in Conviction tab. String-keyed values, so
            render inline rather than generalize the number-keyed helper. */}
        {(() => {
          const toggleGuidance = (v: 'Positive' | 'Negative' | 'Neutral') =>
            setFilters((f) => ({ ...f, guidance: f.guidance === v ? null : v }));
          const countGuidance = (v: 'Positive' | 'Negative' | 'Neutral') => {
            const probe: ConvFilters = { ...filters, guidance: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          const opts: Array<{ v: 'Positive' | 'Neutral' | 'Negative'; lbl: string; color: string }> = [
            { v: 'Positive', lbl: '📈 Positive', color: '#10B981' },
            { v: 'Neutral',  lbl: '➖ Neutral',  color: '#94A3B8' },
            { v: 'Negative', lbl: '📉 Negative', color: '#EF4444' },
          ];
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>GUIDANCE</span>
              {opts.map((o) => {
                const active = filters.guidance === o.v;
                const n = countGuidance(o.v);
                return (
                  <button key={o.v} onClick={() => toggleGuidance(o.v)}
                    style={active ? chipActive(o.color) : chipBase}>
                    {o.lbl} <span style={{ color: active ? o.color : '#6B7A8D', marginLeft: 3 }}>({n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>
      <div style={{
        padding: '10px 14px', backgroundColor: '#0A1422',
        border: '1px solid #1A2840', borderRadius: 8,
        fontSize: 11.5, color: '#8BA3C1', lineHeight: 1.5,
      }}>
        Institutional bench of high-quality post-earnings setups.
        Auto-populated from <strong style={{ color: '#22D3EE' }}>Earnings Opportunities</strong> whenever a stock prints BLOCKBUSTER or STRONG.
        Removed entries don't auto-readd — use × to permanently prune.
      </div>

      {/* PATCH 0196 — Export toolbar (CSV, TradingView, .txt, Open chart). Tier-grouped.
          PATCH 0366 — tickerCompanyMap wired for Screener.in name-based matching. */}
      <TickerExportToolbar
        tickers={allTickers}
        groups={[
          { label: 'BLOCKBUSTER', emoji: '⭐', tickers: blockbusters.map((e) => e.ticker), color: '#F59E0B' },
          { label: 'STRONG', emoji: '🟢', tickers: strongs.map((e) => e.ticker), color: '#10B981' },
        ]}
        exchange="NSE"
        filenameHint="conviction-beats"
        tickerCompanyMap={
          [...blockbusters, ...strongs].reduce<Record<string, string>>((acc, e) => {
            if (e.ticker && e.company) acc[e.ticker.toUpperCase()] = e.company;
            return acc;
          }, {})
        }
      />

      {/* PATCH 0539 — View-mode toggle: Rich (Earnings Hub Scan parity) vs Compact rows */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 4, padding: 3, backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8 }}>
          <button onClick={() => setViewMode('rich')}
            style={{
              padding: '6px 12px', borderRadius: 6, border: 'none',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              backgroundColor: viewMode === 'rich' ? '#F59E0B22' : 'transparent',
              color: viewMode === 'rich' ? '#F59E0B' : '#8BA3C1',
            }}>📊 Rich (Earnings Hub)</button>
          <button onClick={() => setViewMode('compact')}
            style={{
              padding: '6px 12px', borderRadius: 6, border: 'none',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              backgroundColor: viewMode === 'compact' ? '#F59E0B22' : 'transparent',
              color: viewMode === 'compact' ? '#F59E0B' : '#8BA3C1',
            }}>📋 Compact</button>
        </div>
        {viewMode === 'rich' && (
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 11, color: '#8BA3C1' }}>
            {richLoading && (
              <span style={{ color: '#22D3EE' }}>Loading enriched cards… {richProgress.done}/{richProgress.total}</span>
            )}
            {!richLoading && richProgress.total > 0 && (
              <span>{Object.keys(enrichedCards).length} of {tickersForFetch.length} enriched</span>
            )}
            <button onClick={() => richRefetch()}
              disabled={richLoading}
              style={{
                fontSize: 10, fontWeight: 700, padding: '4px 8px',
                background: richLoading ? '#1A2840' : '#0A1422',
                border: '1px solid #2A3B4C', borderRadius: 5,
                color: richLoading ? '#6B7A8D' : '#22D3EE',
                cursor: richLoading ? 'not-allowed' : 'pointer',
              }}>↻ Refresh</button>
          </div>
        )}
      </div>

      {viewMode === 'rich' ? (
        // ── RICH (Earnings Hub Scan parity) ──────────────────────────────
        <>
          {/* PATCH 0539 — Hub-Scan filter rail */}
          <HubFilterRail
            cards={enrichedList}
            filters={hubFilters}
            setFilters={setHubFilters}
            watchlistSet={watchlistSet}
            portfolioSet={portfolioSet}
          />

          {/* Coverage stats bar (same shape as Earnings Hub Scan) */}
          <CoverageStatsBar cards={hubFilteredList} totalCount={enrichedList.length} showingCount={hubFilteredList.length} />

          {/* Card grid */}
          {hubFilteredList.length === 0 && !richLoading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#8BA3C1', backgroundColor: '#0D1623', border: '1px dashed #2A3B4C', borderRadius: 10 }}>
              {enrichedList.length === 0
                ? 'No enriched cards yet — fetch may still be running. Try again in a moment.'
                : 'No cards match the current hub filters. Adjust filters above.'}
            </div>
          )}
          {hubFilteredList.length > 0 && filters.sortByPead && (
            // PATCH 0540 — When PEAD sort is active, render a single
            // top-down sorted grid; grouping by tier would break the
            // sort signal the user just asked for.
            <div style={{ backgroundColor: '#0D1623', border: '1px solid #22D3EE40', borderLeft: '4px solid #22D3EE', borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#22D3EE', marginBottom: 10, letterSpacing: '0.5px' }}>
                🌊 PEAD-SORTED · {hubFilteredList.length}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                {hubFilteredList.map((c) => (
                  <div key={c.symbol} style={{ position: 'relative' }}>
                    <EarningsCardComponent card={c} />
                    <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                      style={{ position: 'absolute', top: 8, right: 8, background: '#0A1422', border: '1px solid #2A3B4C', color: '#8BA3C1', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hubFilteredList.length > 0 && !filters.sortByPead && (() => {
            const bb = hubFilteredList.filter(c => {
              const e = entries.find(en => en.ticker.toUpperCase() === c.symbol.toUpperCase());
              return e?.tier === 'BLOCKBUSTER';
            });
            const st = hubFilteredList.filter(c => {
              const e = entries.find(en => en.ticker.toUpperCase() === c.symbol.toUpperCase());
              return e?.tier === 'STRONG';
            });
            return (
              <>
                {bb.length > 0 && (
                  <div style={{ backgroundColor: '#0D1623', border: '1px solid #F59E0B40', borderLeft: '4px solid #F59E0B', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', letterSpacing: '0.5px' }}>
                        ⭐ BLOCKBUSTER · {bb.length}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                      {bb.map((c) => (
                        <div key={c.symbol} style={{ position: 'relative' }}>
                          <EarningsCardComponent card={c} />
                          <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                            style={{ position: 'absolute', top: 8, right: 8, background: '#0A1422', border: '1px solid #2A3B4C', color: '#8BA3C1', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {st.length > 0 && (
                  <div style={{ backgroundColor: '#0D1623', border: '1px solid #10B98140', borderLeft: '4px solid #10B981', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#10B981', letterSpacing: '0.5px' }}>
                        🟢 STRONG · {st.length}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                      {st.map((c) => (
                        <div key={c.symbol} style={{ position: 'relative' }}>
                          <EarningsCardComponent card={c} />
                          <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                            style={{ position: 'absolute', top: 8, right: 8, background: '#0A1422', border: '1px solid #2A3B4C', color: '#8BA3C1', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </>
      ) : (
        // ── COMPACT (legacy rows) ───────────────────────────────────────
        <>
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
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0539 — Hub-Scan-style filter rail (rich view only).
// Composes AND-style with the conviction-level filters. Each chip shows the
// post-filter count so the user sees how each chip would narrow the view.
// ═══════════════════════════════════════════════════════════════════════════
function HubFilterRail({
  cards, filters, setFilters, watchlistSet, portfolioSet,
}: {
  cards: EarningsScanCard[];
  filters: HubFilters;
  setFilters: React.Dispatch<React.SetStateAction<HubFilters>>;
  watchlistSet: Set<string>;
  portfolioSet: Set<string>;
}) {
  const chipBase: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, padding: '4px 9px', borderRadius: 14,
    cursor: 'pointer', border: '1px solid #2A3B4C', background: '#0A1422',
    color: '#8BA3C1', whiteSpace: 'nowrap',
  };
  const chipActive = (color: string): React.CSSProperties => ({
    ...chipBase, background: `${color}22`, borderColor: `${color}99`, color,
  });

  // count helper — probe filter narrows by toggling chip in question
  const countGradeChip = (g: HubFilters['grades'] extends Set<infer X> ? X : never) => {
    const next = new Set(filters.grades);
    if (next.has(g as any)) next.delete(g as any); else next.add(g as any);
    const probe: HubFilters = { ...filters, grades: next };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countScoreChip = (v: number) => {
    const probe: HubFilters = { ...filters, scoreMin: filters.scoreMin === v ? null : v };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countDivergenceChip = () => {
    const probe: HubFilters = { ...filters, divergenceOnly: !filters.divergenceOnly };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countDqChip = (q: HubFilters['dataQuality'] extends Set<infer X> ? X : never) => {
    const next = new Set(filters.dataQuality);
    if (next.has(q as any)) next.delete(q as any); else next.add(q as any);
    const probe: HubFilters = { ...filters, dataQuality: next };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countAudienceChip = (a: HubFilters['audience'] extends Set<infer X> ? X : never) => {
    const next = new Set(filters.audience);
    if (next.has(a as any)) next.delete(a as any); else next.add(a as any);
    const probe: HubFilters = { ...filters, audience: next };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };

  const toggleGrade = (g: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD') =>
    setFilters(f => {
      const next = new Set(f.grades);
      if (next.has(g)) next.delete(g); else next.add(g);
      return { ...f, grades: next };
    });
  const toggleDq = (q: 'FULL' | 'PARTIAL' | 'PRICE_ONLY') =>
    setFilters(f => {
      const next = new Set(f.dataQuality);
      if (next.has(q)) next.delete(q); else next.add(q);
      return { ...f, dataQuality: next };
    });
  const toggleAudience = (a: 'PORTFOLIO' | 'WATCHLIST' | 'BOTH' | 'BANK') =>
    setFilters(f => {
      const next = new Set(f.audience);
      if (next.has(a)) next.delete(a); else next.add(a);
      return { ...f, audience: next };
    });

  const isDefault =
    filters.grades.size === 0 && filters.scoreMin === null && !filters.divergenceOnly &&
    filters.dataQuality.size === 0 && filters.audience.size === 0;

  const gradeCfg: Array<{ v: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD'; color: string }> = [
    { v: 'EXCELLENT', color: '#7C3AED' },
    { v: 'STRONG',    color: '#00C853' },
    { v: 'GOOD',      color: '#4CAF50' },
    { v: 'OK',        color: '#FFD600' },
    { v: 'BAD',       color: '#F44336' },
  ];

  return (
    <div style={{
      padding: '10px 14px', backgroundColor: '#0A1422',
      border: '1px solid #1A2840', borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#E6EDF3', letterSpacing: '0.4px' }}>
          HUB FILTERS
        </div>
        <button onClick={() => setFilters(HUB_FILTER_DEFAULT)}
          disabled={isDefault}
          style={{ ...chipBase, opacity: isDefault ? 0.4 : 1 }}>Clear</button>
      </div>
      {/* GRADE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>GRADE</span>
        {gradeCfg.map(g => {
          const active = filters.grades.has(g.v);
          return (
            <button key={g.v} onClick={() => toggleGrade(g.v)}
              style={active ? chipActive(g.color) : chipBase}>
              {g.v} <span style={{ color: active ? g.color : '#6B7A8D', marginLeft: 3 }}>({countGradeChip(g.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* SCORE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>SCORE</span>
        {[60, 75, 85].map(v => {
          const active = filters.scoreMin === v;
          return (
            <button key={v} onClick={() => setFilters(f => ({ ...f, scoreMin: f.scoreMin === v ? null : v }))}
              style={active ? chipActive('#22D3EE') : chipBase}>
              ≥{v} <span style={{ color: active ? '#22D3EE' : '#6B7A8D', marginLeft: 3 }}>({countScoreChip(v)})</span>
            </button>
          );
        })}
      </div>
      {/* AUDIENCE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>AUDIENCE</span>
        {([
          { v: 'PORTFOLIO', color: '#10B981' },
          { v: 'WATCHLIST', color: '#0F7ABF' },
          { v: 'BOTH',      color: '#8B5CF6' },
          { v: 'BANK',      color: '#FF9800' },
        ] as const).map(o => {
          const active = filters.audience.has(o.v as any);
          return (
            <button key={o.v} onClick={() => toggleAudience(o.v as any)}
              style={active ? chipActive(o.color) : chipBase}>
              {o.v} <span style={{ color: active ? o.color : '#6B7A8D', marginLeft: 3 }}>({countAudienceChip(o.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* DATA QUALITY */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>QUALITY</span>
        {([
          { v: 'FULL', color: '#00C853', lbl: 'Full' },
          { v: 'PARTIAL', color: '#FFD600', lbl: 'Partial' },
          { v: 'PRICE_ONLY', color: '#F44336', lbl: 'Price Only' },
        ] as const).map(o => {
          const active = filters.dataQuality.has(o.v as any);
          return (
            <button key={o.v} onClick={() => toggleDq(o.v as any)}
              style={active ? chipActive(o.color) : chipBase}>
              {o.lbl} <span style={{ color: active ? o.color : '#6B7A8D', marginLeft: 3 }}>({countDqChip(o.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* DIVERGENCE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>FLAGS</span>
        <button onClick={() => setFilters(f => ({ ...f, divergenceOnly: !f.divergenceOnly }))}
          style={filters.divergenceOnly ? chipActive('#F59E0B') : chipBase}>
          ⚡ Divergence Only <span style={{ color: filters.divergenceOnly ? '#F59E0B' : '#6B7A8D', marginLeft: 3 }}>({countDivergenceChip()})</span>
        </button>
      </div>
    </div>
  );
}

function ConvictionRow({ entry, onRemove }: { entry: ConvictionEntry; onRemove: (t: string) => void }) {
  const tierColor = entry.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
  const pct = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
  // USER-REQ — PEAD score chip (formula from PEAD_Strategy_vF + checklists).
  const pead = peadScore(entry);
  const peadClr = peadColor(pead.score);
  const peadTip = `PEAD ${pead.score} (${peadLabel(pead.score)}) — ${pead.drift_phase} phase, ${pead.days_since_filing}d since filing\n` +
    `Sales norm ${pead.sales_norm}, PAT norm ${pead.pat_norm}, EPS norm ${pead.eps_norm}, base ${pead.raw}\n` +
    `Op-leverage +${pead.op_leverage_bonus}, Quality +${pead.quality_signal}, Tier +${pead.tier_bonus}, decay ×${pead.drift_decay}`;
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
        <div title={peadTip} style={{
          fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
          background: `${peadClr}20`, color: peadClr, border: `1px solid ${peadClr}55`,
          fontFamily: 'ui-monospace, monospace', cursor: 'help', whiteSpace: 'nowrap',
        }}>PEAD {pead.score}</div>
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
      {/* USER-REQ — Guidance in Conviction tab. Same look + colors as the
          Earnings Hub Scan GuidanceBadge. Only renders when set; entries
          without a derived label stay quiet. */}
      {entry.guidance && (() => {
        const cfg: Record<string, { color: string; icon: string }> = {
          'Positive': { color: '#10B981', icon: '📈' },
          'Neutral':  { color: '#94A3B8', icon: '➖' },
          'Negative': { color: '#EF4444', icon: '📉' },
        };
        const c = cfg[entry.guidance] || cfg['Neutral'];
        const s = entry.guidance_score;
        const scoreStr = (typeof s === 'number' && entry.guidance !== 'Neutral')
          ? ` (${s > 0 ? '+' : ''}${s.toFixed(2)})`
          : '';
        return (
          <div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10,
              padding: '2px 7px', borderRadius: 4,
              backgroundColor: `${c.color}18`, border: `1px solid ${c.color}40`,
              color: c.color, fontWeight: 700,
            }}>
              {c.icon} {entry.guidance}{scoreStr}
            </span>
          </div>
        );
      })()}
      {entry.source_url && (
        <a href={entry.source_url} target="_blank" rel="noreferrer"
          style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>
          📄 Filing →
        </a>
      )}
    </div>
  );
}
