'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation'; // PATCH 0914 — read ?tab=conviction
import { Plus, Trash2, TrendingUp, TrendingDown, RefreshCw, Download, ArrowUpDown, AlertTriangle, Award } from 'lucide-react';
import toast from 'react-hot-toast';
import TickerSearch, { type TickerSuggestion } from '@/components/TickerSearch';
import { normalizeTicker } from '@/lib/tickers';
import { canonicalTicker } from '@/lib/ticker-normalize'; // PATCH 0721
import { isPriceSuspect } from '@/lib/nse';
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
import {
  getConvictionList, removeConviction, syncFromEarningsOps,
  readConvictionBin, restoreConvictionBin,
  type ConvictionEntry,
} from '@/lib/conviction-beats';
import { peadScore, peadColor, peadLabel } from '@/lib/pead-score';
import TickerExportToolbar from '@/components/TickerExportToolbar';
import FundamentalsAnalyzerPage from '../fundamentals/page';
// PATCH 0557 — BUG-AUDIT-2: backend-degraded banner.
import DegradedBanner from '@/components/DegradedBanner';
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
  const timer = setTimeout(() => ctl.abort(), 25_000); // PATCH 1037
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
      const timer = setTimeout(() => ctl.abort(), 25_000); // PATCH 1037
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
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>TOTAL STOCKS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-text-0)' }}>{items.length}</div>
      </div>
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>AVG. CHANGE</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: avgChange >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
          {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
        </div>
      </div>
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>GAINERS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-bullish)' }}>{gainers}</div>
      </div>
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>LOSERS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-bearish)' }}>{losers}</div>
      </div>
    </div>
  );
}

// ── Empty State Component ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
      <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 8px' }}>Your watchlist is empty</h2>
      <p style={{ fontSize: '14px', color: 'var(--mc-text-3)', margin: '0 0 24px' }}>Add stock tickers to start tracking them. Popular tickers: RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK</p>
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
            color: 'var(--mc-warn)', fontSize: 12, fontWeight: 700,
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
            color: 'var(--mc-accent)', fontSize: 12, fontWeight: 700,
            textDecoration: 'none',
          }}
        >🔍 Find tickers in Screener →</a>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: 0 }}>💬 Your watchlist syncs with @mc_watchlist_pulse_bot</p>
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
    <div style={{ overflowX: 'auto', border: '1px solid var(--mc-border-2)', borderRadius: '12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--mc-border-2)', backgroundColor: 'var(--mc-bg-1)' }}>
            <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer', width: '40px' }} onClick={() => onSort('flag')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                Flag <SortIcon field="flag" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('ticker')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Ticker <SortIcon field="ticker" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('company')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Company <SortIcon field="company" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('sector')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Sector <SortIcon field="sector" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('price')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                CMP (₹) <SortIcon field="price" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('changePercent')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Change% <SortIcon field="changePercent" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('dayHigh')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Day High <SortIcon field="dayHigh" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('dayLow')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Day Low <SortIcon field="dayLow" />
              </div>
            </th>
            {/* PATCH 0442 BUG-020 — Optional columns rendered based on chooser state */}
            {OPTIONAL_COLS.filter(c => activeCols.has(c.id)).map(c => (
              <th key={c.id} style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort(c.id as SortField)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                  {c.label} <SortIcon field={c.id as SortField} />
                </div>
              </th>
            ))}
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', position: 'relative' }}>
              {/* PATCH 0442 BUG-027 — Working column chooser. Click to toggle
                  popover; select Volume / 52W / Mcap / PE / Avg Vol columns. */}
              <button
                onClick={() => setChooserOpen(o => !o)}
                title="Configure columns"
                style={{
                  background: chooserOpen ? 'color-mix(in srgb, var(--mc-accent) 19%, transparent)' : 'transparent',
                  border: `1px solid ${chooserOpen ? 'var(--mc-cyan)' : 'var(--mc-border-2)'}`,
                  borderRadius: 6, color: chooserOpen ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
                  cursor: 'pointer', padding: '4px 9px', fontSize: '10px', fontWeight: 700,
                }}
              >⚙ Columns ({activeCols.size})</button>
              {chooserOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 8, marginTop: 4, zIndex: 50,
                  minWidth: 200, padding: 8, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
                  borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6, letterSpacing: '0.4px' }}>SHOW COLUMNS</div>
                  {OPTIONAL_COLS.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 4 }}>
                      <input type="checkbox" checked={activeCols.has(c.id)} onChange={() => toggleCol(c.id)} />
                      <span style={{ fontSize: 11, color: 'var(--mc-text-0)' }}>{c.label}</span>
                    </label>
                  ))}
                  <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 6, fontStyle: 'italic' }}>
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
              <tr key={item.ticker} data-watchlist-ticker={item.ticker} style={{ borderBottom: idx < items.length - 1 ? '1px solid var(--mc-bg-2)' : 'none', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '8px 8px', textAlign: 'center', width: '40px' }}>
                  <button
                    onClick={() => onToggleFlag?.(item.ticker)}
                    title={`Flag: ${item.flag || 'None'} (click to cycle)`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 4px', borderRadius: '4px', lineHeight: 1 }}
                  >
                    {item.flag || '⚪'}
                  </button>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--mc-info)', fontWeight: '700' }}>{item.ticker}</td>
                <td style={{ padding: '12px 16px', color: 'var(--mc-text-0)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.company}
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--mc-text-3)', fontSize: '12px' }}>{item.sector}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>
                  {/* PATCH 0559 — BUG-AUDIT-4: when quote came back null/0 render
                      a muted em-dash with a tooltip instead of ₹0.00. */}
                  {!item.price || item.price === 0 ? (
                    <span style={{ color: 'var(--mc-text-4)' }} title="Price unavailable — quote not returned by data source">—</span>
                  ) : isPriceSuspect(item.ticker, item.price) ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--mc-warn)' }} title="Suspect price - may be incorrect or stale">
                      <AlertTriangle style={{ width: '12px', height: '12px' }} />
                      ₹{item.price.toFixed(2)}
                    </span>
                  ) : (
                    `₹${item.price.toFixed(2)}`
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {/* PATCH 0559 — also blank pct chip when no live price. */}
                  {!item.price || item.price === 0 ? (
                    <span style={{ color: 'var(--mc-text-4)' }} title="Change unavailable">—</span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '6px', backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: isPositive ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: '600', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                      {isPositive ? <TrendingUp style={{ width: '11px', height: '11px' }} /> : <TrendingDown style={{ width: '11px', height: '11px' }} />}
                      {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  {item.dayHigh ? `₹${item.dayHigh.toFixed(2)}` : <span style={{ color: 'var(--mc-text-4)' }}>—</span>}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  {item.dayLow ? `₹${item.dayLow.toFixed(2)}` : <span style={{ color: 'var(--mc-text-4)' }}>—</span>}
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
                    <td key={c.id} style={{ padding: '12px 16px', textAlign: 'right', color: txt === '—' ? 'var(--mc-text-4)' : 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                      {txt}
                    </td>
                  );
                })}
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button
                    onClick={() => onRemove(item.ticker)}
                    title="Remove from watchlist"
                    style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', transition: 'all 0.2s' }}
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
  // PATCH 0914 — Honor ?tab=conviction in the URL so the Home Quick Access
  // chip "🏆 Conviction Beats" lands on the bench tab directly instead of
  // dropping users on the Main watchlist tab. User feedback: "even when
  // selecting conviction betas short cut its going to watchlist only why".
  const searchParams = useSearchParams();
  const initialTab: 'main' | 'conviction' =
    searchParams?.get('tab') === 'conviction' ? 'conviction' : 'main';
  const [activeTab, setActiveTab] = useState<'main' | 'conviction' | 'fundamentals'>(initialTab);
  // Also react to URL changes mid-session (e.g. user clicks the chip again
  // from another page → SPA nav). Without this, the activeTab state from
  // the first render would stay on whatever tab was active.
  useEffect(() => {
    const t = searchParams?.get('tab');
    if (t === 'conviction' && activeTab !== 'conviction') setActiveTab('conviction');
    if (t === 'main' && activeTab !== 'main') setActiveTab('main');
    // Intentionally not depending on activeTab to avoid clobbering manual
    // tab clicks that don't update the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // PATCH 0874 — Init to empty array instead of reading LS in lazy-init.
  // The lazy-init reads localStorage which is unavailable during SSR,
  // returning [] on the server but the user's actual list on the client →
  // hydration mismatch on the conviction count and chip rail. The
  // existing useEffect below already hydrates from LS on mount.
  const [convictionEntries, setConvictionEntries] = useState<ConvictionEntry[]>([]);
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
      // PATCH 0716 — 8s timeout + safe JSON parse + array shape guard.
      try {
        const _syncCtl = new AbortController();
        const _syncTimer = setTimeout(() => _syncCtl.abort(), 25_000); // PATCH 1037
        let syncData: any = {};
        try {
          const syncRes = await fetch(`/api/watchlist?chatId=${CHAT_ID}`, { signal: _syncCtl.signal });
          clearTimeout(_syncTimer);
          if (syncRes.ok) {
            try { syncData = await syncRes.json(); } catch { syncData = {}; }
          }
        } finally { clearTimeout(_syncTimer); }
        if (syncData && Array.isArray(syncData.watchlist) && syncData.watchlist.length > 0) {
          // Remote wins: use it as the authoritative source
          setTickers(syncData.watchlist);
          setStoredTickers(syncData.watchlist);
          // Load flags from API
          if (syncData.flags) setWatchlistFlags(syncData.flags);
          return;
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
  // PATCH 0690 — case-insensitive ticker lookup. Watchlist stored values
  // may be 'reliance' / 'NSE:RELIANCE' / 'RELIANCE'; the quotes API always
  // returns upper-case bare symbols. Normalize both sides before .find().
  // PATCH 0691 — Company column now resolves quote.company → quote.name →
  // ticker fallback; sector reads quote.sector with em-dash fallback. The
  // quotes API was updated in P0690 to return both `company` and `name`,
  // so older shapes still work via the chained fallback.
  const normalize = canonicalTicker; // PATCH 0721 — also strips .NS/.BO suffix now (was prefix-only)
  /*
   * PATCH 0965 BUG #7 — Volume + 52W High columns always rendered "—".
   *
   * Root cause: `fetchStockQuotes` (and `fetchIndividualQuotes`) correctly
   * pull `volume`, `week52High`, `week52Low`, `marketCap`, `peRatio`,
   * `avgVolume` from `/api/market/quotes` and tack them onto each
   * StockQuote. However the per-row `watchlistItems` mapping below only
   * forwarded a subset of fields (ticker, company, sector, price, change,
   * changePercent, dayHigh, dayLow, flag), DROPPING every optional
   * column. The WatchlistTable optional-column renderer then read
   * `(item as any)[c.id]` → undefined → '—' for all 70 stocks regardless
   * of how many times the user toggled the chooser. Fix: forward every
   * field the WatchlistItem type already declares.
   */
  const watchlistItems = useMemo(() => {
    return tickers.map(ticker => {
      const norm = normalize(ticker);
      const quote = quotes.find(q => normalize(q.ticker) === norm);
      return {
        ticker,
        company: quote?.company || (quote as any)?.name || ticker, // PATCH 0691
        sector: quote?.sector || '—', // PATCH 0691
        price: quote?.price || 0,
        change: quote?.change || 0,
        changePercent: quote?.changePercent || 0,
        dayHigh: quote?.dayHigh || 0,
        dayLow: quote?.dayLow || 0,
        flag: watchlistFlags[ticker] || null,
        // PATCH 0965 BUG #7 — forward optional columns from the quote so
        // the chooser actually surfaces them. Use `?? null` so a missing
        // value falls through to the "—" renderer rather than crashing.
        volume: (quote as any)?.volume ?? null,
        marketCap: (quote as any)?.marketCap ?? null,
        week52High: (quote as any)?.week52High ?? null,
        week52Low: (quote as any)?.week52Low ?? null,
        peRatio: (quote as any)?.peRatio ?? null,
        avgVolume: (quote as any)?.avgVolume ?? null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {/* PATCH 0557 — backend-degraded banner. */}
      <DegradedBanner />
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 4px' }}>Watchlist</h1>
          <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>Tracking universe · Observation only · No P&L</p>
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
              backgroundColor: 'var(--mc-bg-2)',
              border: '1px solid var(--mc-border-2)',
              borderRadius: '10px',
              padding: '10px 14px',
              color: 'var(--mc-text-3)',
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
              backgroundColor: 'var(--mc-bg-2)',
              border: '1px solid var(--mc-border-2)',
              borderRadius: '10px',
              padding: '10px 14px',
              color: 'var(--mc-text-3)',
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
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--mc-border-2)', marginBottom: '20px' }}>
        <button onClick={() => setActiveTab('main')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'main' ? 'var(--mc-cyan)' : 'transparent'}`,
            color: activeTab === 'main' ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          📋 My Watchlist
          <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{tickers.length}</span>
        </button>
        <button onClick={() => setActiveTab('fundamentals')} style={{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid ' + (activeTab === 'fundamentals' ? '#39d0d8' : 'transparent'), color: activeTab === 'fundamentals' ? '#39d0d8' : 'var(--mc-text-3)', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>📈 Fundamentals</button>
            <button onClick={() => setActiveTab('conviction')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'conviction' ? 'var(--mc-warn)' : 'transparent'}`,
            color: activeTab === 'conviction' ? 'var(--mc-warn)' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          <Award style={{ width: 13, height: 13 }} />
          Conviction Beats
          <span style={{
            fontSize: 10, fontWeight: 800,
            padding: '1px 6px', borderRadius: 8,
            backgroundColor: convictionCount > 0 ? 'color-mix(in srgb, var(--mc-warn) 13%, transparent)' : 'var(--mc-bg-2)',
            color: convictionCount > 0 ? 'var(--mc-warn)' : 'var(--mc-text-4)',
          }}>{convictionCount}</span>
        </button>
      </div>

      {activeTab === 'fundamentals' ? <FundamentalsAnalyzerPage scope="watchlist" /> : activeTab === 'conviction' ? (
        <ConvictionBeatsPanel
          entries={convictionEntries}
          onRemove={(t) => { removeConviction(t); setConvictionEntries(getConvictionList()); }}
          /* PATCH zzz99 — bulk Clear All for Conviction Beats. Iterates the
             current list and removes each ticker via the same per-entry API
             so the storage layer, the 'conviction-beats:updated' event, and
             any cross-tab listeners all fire exactly as they do on × clicks.
             Snapshot ticker list first because removeConviction mutates the
             source the snapshot is derived from. */
          onClearAll={() => {
            const all = getConvictionList().map((e) => e.ticker);
            for (const t of all) removeConviction(t);
            // Belt-and-braces: nuke the LS key directly in case the lib
            // missed an entry (legacy/malformed row). Both known keys are
            // tried so we cover any historical schema rename.
            try {
              if (typeof window !== 'undefined') {
                window.localStorage.removeItem('mc:conviction-beats');
                window.localStorage.removeItem('conviction-beats');
              }
            } catch {}
            setConvictionEntries(getConvictionList());
          }}
        />
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
                backgroundColor: 'var(--mc-bg-2)',
                border: '1px solid var(--mc-border-2)',
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
            <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>
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
        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '10px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>
            💬 Your watchlist syncs with <span style={{ fontWeight: '600', color: 'var(--mc-info)' }}>@mc_watchlist_pulse_bot</span>
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
  // zzz223 — OPM margin delta (pp YoY): v ≥ 0 means "expansion ≥ v pp",
  // v < 0 means "squeeze ≤ v pp". Mirrors the EO margin signal.
  opmDelta?: number | null;
  // zzz225 — minimum composite tier score (the big number on each card,
  // e.g. 67) — the EO grading composite, distinct from the PEAD score.
  score?: number | null;
  // zzz226e — minimum ABSOLUTE OPM level (latest quarter %), distinct from
  // the delta filter — screens out structurally thin-margin businesses.
  opmMin?: number | null;
  sortByPead: boolean;
  // PATCH 1018 — ELITE / MULTIBAGGER quality filters (mirror Earnings Opps)
  elite: boolean;
  multibagger: boolean;
  // USER-REQ — Guidance in Conviction tab. null = no filter; specific label
  // means "only entries whose derived guidance matches this label".
  guidance: 'Positive' | 'Negative' | 'Neutral' | null;
  // PATCH 0909 — Indian-FY quarter + fiscal-year filter.
  //   Derived from filing_date by deriveQuarterFY() below using the
  //   Indian FY convention (Apr-Mar). User feedback: "earnings hub,
  //   conviction beats i need some way to filter dates by quarter and
  //   year and all filter logic to be perfect".
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null;
  fy: number | null;        // 26 = FY26 (Apr 2025 - Mar 2026), etc.
  // PATCH 0918 — Free-form date-range filter on filing_date.
  // User feedback: "also give option to slect dates i want with year
  // also give that optin as filter". Composes AND with Q + FY chips so
  // user can narrow even further (e.g. "Q4 FY26 entries filed
  // between May 1 and May 15"). Both nullable — either side optional.
  fromDate: string | null;  // YYYY-MM-DD or null
  toDate: string | null;    // YYYY-MM-DD or null
  // PATCH 0945 — D1 close bucket filter (same chip set as /earnings).
  // Each value is a SIGNED threshold: positive = "D1 >= N%", negative = "D1 <= N%".
  // null = no filter.
  d1Bucket: number | null;
  // zzz229 — 2D CLOSE bucket filter. d2_pct = cumulative % close change over
  // 2 trading sessions (skips weekends/holidays). Value semantics identical
  // to d1Bucket: positive = "≥ N%", negative = "≤ N%".
  d2Bucket: number | null;
  // PATCH 1022/1024 — market-cap range filter (uses market_cap_cr in ₹ Cr).
  cap: 'all' | 'sweet' | 'mega' | 'large' | 'mid' | 'small' | 'micro';
};

const FILTER_DEFAULT: ConvFilters = { opLev: null, sales: null, pat: null, eps: null, pead: null, sortByPead: false, elite: false, multibagger: false, guidance: null, quarter: null, fy: null, fromDate: null, toDate: null, d1Bucket: null, d2Bucket: null, opmDelta: null, score: null, opmMin: null, cap: 'all' };

// PATCH 1022 — shared market-cap range matcher (value in ₹ Cr). Buckets mirror
// the enrich-route thresholds. Null market cap never matches a specific range.
function convCapInRange(cr: number | null | undefined, f: ConvFilters['cap']): boolean {
  if (f === 'all') return true;
  if (cr == null || !Number.isFinite(cr)) return false;
  switch (f) {
    // PATCH 1024 — user multibagger sweet-spot band ₹5k–50k Cr.
    case 'sweet': return cr >= 5_000 && cr <= 50_000;
    case 'mega': return cr >= 200_000;
    case 'large': return cr >= 20_000 && cr < 200_000;
    case 'mid': return cr >= 5_000 && cr < 20_000;
    case 'small': return cr >= 500 && cr < 5_000;
    case 'micro': return cr < 500;
    default: return true;
  }
}

// PATCH 0911 — Robust derivation of Indian-FY quarter + fiscal year.
//
// Lookup order:
//   1. Use the entry's explicit `quarter` + `fiscal_year` fields (set by
//      Patch 0911 sync from EO graded payload — authoritative; doesn't
//      mis-classify late filings or amendments).
//   2. Fall back to heuristic from filing_date (for legacy bench entries
//      that pre-date Patch 0911). Multiple date formats accepted:
//        - "YYYY-MM-DD" (canonical)
//        - "YYYY-MM-DDT..." (ISO with time)
//        - "DD/MM/YYYY" or "DD-MM-YYYY" (Indian dd/mm/yyyy)
//        - "Mon DD, YYYY" or "DD Mon YYYY" (human)
//
// Indian FY convention (long-term — works through year 2099):
//   FY26 = Apr 2025 → Mar 2026. The reported QUARTER differs from the
//   FILING month — filings happen 1-3 months after quarter end.
//   Filing Apr-Jun YYYY → reports Q4 FY{YYYY}
//   Filing Jul-Sep YYYY → reports Q1 FY{YYYY+1}
//   Filing Oct-Dec YYYY → reports Q2 FY{YYYY+1}
//   Filing Jan-Mar YYYY → reports Q3 FY{YYYY}
//
// FY display: we return the LAST 2 digits (FY26, FY27 …). The 2-digit
// label is unambiguous through FY99; for completeness deriveQuarterFY
// also returns the full 4-digit calendar year of FY end so chip tooltips
// can show "FY26 = Apr 2025 → Mar 2026".
function parseDateLoose(s: string): { y: number; m: number; d: number } | null {
  if (!s || typeof s !== 'string') return null;
  // Canonical ISO
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  // dd/mm/yyyy or dd-mm-yyyy (Indian convention)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  // "Mon DD, YYYY" or "DD Mon YYYY"
  const months: Record<string, number> = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
  m = s.match(/(?:([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4}))|(?:(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}))/);
  if (m) {
    if (m[1]) {
      const mm = months[m[1].slice(0, 3).toUpperCase()];
      if (mm) return { y: +m[3], m: mm, d: +m[2] };
    } else if (m[5]) {
      const mm = months[m[5].slice(0, 3).toUpperCase()];
      if (mm) return { y: +m[6], m: mm, d: +m[4] };
    }
  }
  // Last resort — let Date parse it
  const d = new Date(s);
  if (!isNaN(d.getTime())) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  return null;
}
function deriveQuarterFY(e: ConvictionEntry | string): { q: 'Q1' | 'Q2' | 'Q3' | 'Q4'; fy: number; fyFull: number } | null {
  // PATCH 0915 — Bug fix: bench entries can have a `quarter` field stored
  // as the full graded-route string "Q4 FY26" (not just "Q4"). Previously
  // the tier-1 path cast the raw value to 'Q1'-'Q4' without validation, so
  // countQ('Q4') compared against runtime "Q4 FY26" and returned 0 for
  // every entry. User report: "FILTERS · 0 of 359" with all Q chips (0)
  // but FY26 chip (358). Now we regex-extract the clean Q before trusting.
  //
  // Tier 1 — explicit fields. Extract clean Q1-Q4 from whatever shape.
  if (typeof e === 'object' && e && e.fiscal_year) {
    let validQ: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null = null;
    if (typeof e.quarter === 'string') {
      const qm = e.quarter.match(/Q([1-4])/i);
      if (qm) validQ = ('Q' + qm[1]) as 'Q1' | 'Q2' | 'Q3' | 'Q4';
    }
    if (validQ) {
      return {
        q: validQ,
        fy: e.fiscal_year % 100,
        fyFull: e.fiscal_year,
      };
    }
    // Explicit fiscal_year is set but quarter is missing/dirty —
    // fall through to heuristic so we still derive a Q from filing_date.
  }
  // Tier 2 — heuristic from filing_date
  const fdate = typeof e === 'string' ? e : e?.filing_date;
  const parsed = parseDateLoose(fdate);
  if (!parsed) return null;
  const { y, m } = parsed;
  if (m >= 4 && m <= 6)  return { q: 'Q4', fy: y % 100, fyFull: y };
  if (m >= 7 && m <= 9)  return { q: 'Q1', fy: (y + 1) % 100, fyFull: y + 1 };
  if (m >= 10 && m <= 12) return { q: 'Q2', fy: (y + 1) % 100, fyFull: y + 1 };
  if (m >= 1 && m <= 3)  return { q: 'Q3', fy: y % 100, fyFull: y };
  return null;
}

// PATCH 0546 / 0547 — Derive guidance from YoY metrics when the entry
// doesn't have an explicit guidance field. Tightened thresholds so the
// distribution is MEANINGFUL within the bench (Patch 0546 v1 marked all
// 70 BLOCKBUSTER+STRONG entries Positive because every one of them had
// PAT ≥20 / Sales ≥0 / EPS ≥10 trivially).
//
// Discriminating heuristic — separates margin-expanding compounders from
// margin-compressing or earnings-quality risks:
//   POSITIVE : op-leverage AND quality
//              PAT ≥ 40 AND PAT > Sales × 1.2 AND EPS ≥ 25 (PAT outpacing
//              sales = margin expansion; EPS keeping up = no dilution)
//   NEGATIVE : margin compression OR earnings quality concern
//              PAT < 0  OR  (sales > 30 AND pat < sales × 0.6)  OR
//              (pat > 0 AND eps < pat × 0.4)  (heavy dilution)
//   NEUTRAL  : everything else (clean growth without standout margin signal)
function deriveGuidanceLabel(e: ConvictionEntry): 'Positive' | 'Negative' | 'Neutral' {
  // PATCH 0925 — Only trust EXPLICIT Positive/Negative from the stored
  // entry. Stored "Neutral" gets re-derived from YoY metrics — bench
  // entries written before Patch 0925 were ALL written as Neutral because
  // their narrative_text was empty, but their metrics (Sales+300% etc)
  // clearly warranted Positive. Re-derive to fix retroactively.
  if (e.guidance === 'Positive' || e.guidance === 'Negative') return e.guidance;
  const sales = e.sales_yoy_pct ?? 0;
  const pat = e.net_profit_yoy_pct ?? 0;
  const eps = e.eps_yoy_pct ?? 0;
  // Negative gates
  if (pat < 0) return 'Negative';
  if (sales > 30 && pat < sales * 0.6) return 'Negative';   // margin compression
  // PATCH 0925 — dilution gate only when EPS is genuinely weak (< 50%).
  // Otherwise the ratio test mis-classifies hyper-growth (Sales+224, PAT
  // +1404, EPS +398 → EPS<PAT*0.4 but EPS is still strong absolute).
  if (pat > 0 && eps < pat * 0.4 && eps < 50) return 'Negative';
  // Positive gates — op-leverage + quality
  if (pat >= 40 && pat > sales * 1.2 && eps >= 25) return 'Positive';
  // PATCH 0925 — Secondary Positive: strong growth across all 3 metrics
  // (Sales ≥ 20, PAT ≥ 30, EPS ≥ 20) without sharp op-leverage. This
  // catches solid Compounders that the strict op-leverage gate misses.
  if (pat >= 30 && sales >= 20 && eps >= 20) return 'Positive';
  return 'Neutral';
}

// zzz229 — Trading-day helper. Given an ISO date string, return the date N
// trading days earlier. Assumes Mon-Fri only (skips Sat+Sun; NSE holidays not
// modelled here — good enough for chip labels).
function tradingDaysBefore(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();   // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

// Self-test — runs once on module load. Verifies trading-day math.
// User's example: if today = Monday, 2 trading days = Fri + Mon; 1 trading day = Fri.
if (typeof window !== 'undefined' && !(window as any).__mc_d2_test_done) {
  (window as any).__mc_d2_test_done = true;
  const t = (iso: string, n: number, expect: string, label: string) => {
    const got = tradingDaysBefore(iso, n);
    // eslint-disable-next-line no-console
    if (got !== expect) console.warn(`[zzz229 tradingDaysBefore FAIL] ${label} ${iso}-${n} => ${got} expected ${expect}`);
  };
  t('2026-07-20', 1, '2026-07-17', 'Mon 1-back = Fri');
  t('2026-07-20', 2, '2026-07-16', 'Mon 2-back = Thu (skip Sat+Sun)');
  t('2026-07-22', 2, '2026-07-20', 'Wed 2-back = Mon');
  t('2026-07-24', 2, '2026-07-22', 'Fri 2-back = Wed');
  t('2026-07-24', 5, '2026-07-17', 'Fri 5-back = prior Fri');
}

// zzz229 — extract d2_pct. Backend will populate later; frontend gracefully
// handles missing field (predicate returns false to hide unqualified rows).
function getD2Pct(e: any): number | null {
  // zzz232 — STRICT fallback. Never return bare d1_pct here — that made the
  // 2D chip identical to the 1D chip when backend hadn't shipped real d2_pct.
  // Only return:
  //   1. real d2_pct (server-computed, strict 2-trading-day cumulative)
  //   2. move_pct (cumulative post-filing walk-forward — different from D1
  //      because it spans many days, so counts diverge from 1D naturally)
  // Otherwise return null → chip shows "…" pending state instead of a fake.
  if (typeof e?.d2_pct === 'number' && Number.isFinite(e.d2_pct)) return e.d2_pct;
  if (typeof e?.move_pct === 'number' && Number.isFinite(e.move_pct)) return e.move_pct;
  return null;
}

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
  // zzz225 — composite tier score threshold (the card's big number)
  if (f.score != null && (e.composite_score ?? 0) < f.score) return false;
  // zzz226e — absolute OPM level threshold (latest quarter %)
  if (f.opmMin != null) {
    const o = (e as any).opm_pct;
    if (typeof o !== 'number' || o < f.opmMin) return false;
  }
  // zzz223 — OPM margin delta filter (pp change vs prior year). Positive
  // threshold = expansion ≥ v pp; negative threshold = squeeze ≤ v pp.
  if (f.opmDelta != null) {
    const o = (e as any).opm_pct; const p = (e as any).opm_prev_pct;
    if (typeof o !== 'number' || typeof p !== 'number') return false;
    const d = o - p;
    if (f.opmDelta >= 0 ? d < f.opmDelta : d > f.opmDelta) return false;
  }
  // USER-REQ — PEAD score threshold filter (combinable with all others)
  if (f.pead != null) {
    if (peadScore(e).score < f.pead) return false;
  }
  // PATCH 1018 — ELITE / MULTIBAGGER quality filters
  if (f.elite && !(e as any).is_elite) return false;
  if (f.multibagger && !(e as any).multibagger_setup) return false;
  // PATCH 1022 — market-cap range filter
  if (f.cap && f.cap !== 'all' && !convCapInRange((e as any).market_cap_cr, f.cap)) return false;
  // PATCH 0546 — fall back to derived guidance from YoY metrics for legacy
  // entries; explicit guidance field always wins when present.
  if (f.guidance != null) {
    if (deriveGuidanceLabel(e) !== f.guidance) return false;
  }
  // PATCH 0909 — Quarter + FY filter (Indian fiscal year, derived from filing_date)
  if (f.quarter != null || f.fy != null) {
    const qfy = deriveQuarterFY(e);
    if (!qfy) return false;
    if (f.quarter != null && qfy.q !== f.quarter) return false;
    if (f.fy != null && qfy.fy !== f.fy) return false;
  }
  // PATCH 0918 + 0919 — Free-form date range filter (composes AND with
  // Q + FY). Strict validation: if EITHER bound is non-empty but malformed
  // (e.g. partial browser input "2025" or "29"), we silently ignore that
  // bound rather than treating it as a real filter — otherwise string
  // comparison filters out every entry and the user sees a confusing
  // "0 of 360" with no visible chip active. (Reported bug Patch 0919.)
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fromOk = !!f.fromDate && DATE_RE.test(f.fromDate);
  const toOk   = !!f.toDate   && DATE_RE.test(f.toDate);
  if (fromOk || toOk) {
    const fdate = (e.filing_date || '').slice(0, 10);
    // If we can't parse the entry's filing_date, DON'T eliminate it on
    // date-range alone — let other filters decide. Only enforce when the
    // entry has a clean filing date to compare against. This prevents
    // bench entries with explicit quarter/fy but malformed filing_date
    // from getting wiped by a single bad input.
    if (DATE_RE.test(fdate)) {
      if (fromOk && fdate < (f.fromDate as string)) return false;
      if (toOk   && fdate > (f.toDate as string))   return false;
    }
  }
  // PATCH 0945 — D1 close bucket filter. Composes AND with all the above.
  // Positive threshold = require d1 >= N. Negative = require d1 <= N.
  if (f.d1Bucket != null && Number.isFinite(f.d1Bucket)) {
    const d1 = (e as any).d1_pct;
    if (typeof d1 !== 'number' || !Number.isFinite(d1)) return false;
    if (f.d1Bucket >= 0) {
      if (d1 < f.d1Bucket) return false;
    } else {
      if (d1 > f.d1Bucket) return false;
    }
  }
  // zzz229 — 2D CLOSE filter. Mirrors D1 semantics (positive = ≥ threshold,
  // negative = ≤ threshold). Uses d2_pct = cumulative % over 2 trading days.
  if (f.d2Bucket != null && Number.isFinite(f.d2Bucket)) {
    const d2 = getD2Pct(e);
    if (d2 == null) return false;
    if (f.d2Bucket >= 0) {
      if (d2 < f.d2Bucket) return false;
    } else {
      if (d2 > f.d2Bucket) return false;
    }
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
              // PATCH 0716 — added 25s timeout + safe JSON parse.
              try {
                const _esCtl = new AbortController();
                const _esTimer = setTimeout(() => _esCtl.abort(), 25_000);
                try {
                  const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: _esCtl.signal });
                  if (!res.ok) return null;
                  try { return (await res.json()) as { cards: EarningsScanCard[] }; } catch { return null; }
                } finally { clearTimeout(_esTimer); }
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

function ConvictionBeatsPanel({ entries, onRemove, onClearAll }: { entries: ConvictionEntry[]; onRemove: (t: string) => void; onClearAll?: () => void }) {
  // PATCH zzz99 — bulk Clear All button for Conviction Beats.
  // User flow: starting fresh for next earnings cycle, drain the entire
  // bench at once instead of clicking × on every row. Guarded by
  // window.confirm so a misclick can't nuke 100+ entries silently.
  // PATCH 0540 — all hooks declared BEFORE any early-return so React's
  // Rules-of-Hooks holds across the empty-bench → populated-bench transition
  // (previously the empty-state returned before useState, which would have
  // crashed if the bench populated while the user was on the tab).
  // USER-REQ — filter state (composable AND)
  const [filters, setFilters] = useState<ConvFilters>(FILTER_DEFAULT);
  // zzz226 — detail filter chips are hidden by default; the ⚡ preset button
  // applies the user's standard screen without opening them.
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  // PATCH 1019 — Re-validate bench. Re-fetches graded for every unique
  // filing date on the bench and re-syncs (all tiers) so any stock that
  // dropped out of BLOCKBUSTER/STRONG under the current grading logic
  // (e.g. ADSL after the turnaround gate) gets pruned automatically.
  const [revalidating, setRevalidating] = useState(false);
  const [revalProgress, setRevalProgress] = useState<string | null>(null);
  const runRevalidate = useCallback(async () => {
    if (revalidating) return;
    setRevalidating(true);
    setRevalProgress('Collecting bench dates…');
    try {
      // Unique filing dates across the bench
      const dates = Array.from(new Set(entries.map((e) => e.filing_date).filter(Boolean))).sort();
      if (dates.length === 0) { setRevalProgress('Bench is empty.'); return; }
      let prunedTotal = 0;
      const before = getConvictionList().length;
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        setRevalProgress(`Re-validating ${i + 1}/${dates.length} · ${d}`);
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${d}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const j = await res.json();
          const bt = j?.by_tier || {};
          const syncEntries: any[] = [];
          for (const tier of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
            for (const c of (bt[tier] || [])) {
              const qm = typeof c.quarter === 'string' ? c.quarter.match(/Q([1-4])/i) : null;
              const fm = typeof c.quarter === 'string' ? c.quarter.match(/FY\s?(\d{2})/i) : null;
              syncEntries.push({
                ticker: c.ticker, company: c.company, tier,
                composite_score: c.composite_score,
                sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
                filing_date: c.filing_date || d, sector: c.sector, market_cap_bucket: c.market_cap_bucket,
                market_cap_cr: typeof c.market_cap_cr === 'number' ? c.market_cap_cr : null,
                source_url: c.filing_url,
                ...(qm ? { quarter: ('Q' + qm[1]) as any } : {}),
                ...(fm ? { fiscal_year: (parseInt(fm[1], 10) < 50 ? 2000 + parseInt(fm[1], 10) : 1900 + parseInt(fm[1], 10)) } : {}),
                d1_pct: typeof c.d1_pct === 'number' ? c.d1_pct : null,
                gap_pct: typeof c.gap_pct === 'number' ? c.gap_pct : null,
                is_elite: c.is_elite === true,
                pead_score: typeof c.pead_score === 'number' ? c.pead_score : null,
                multibagger_setup: c.multibagger_setup === true,
                // zzz223 — OPM margin for the CB tab
                opm_pct: typeof c.opm_pct === 'number' ? c.opm_pct : null,
                opm_prev_pct: typeof c.opm_prev_pct === 'number' ? c.opm_prev_pct : null,
              });
            }
          }
          if (syncEntries.length > 0) syncFromEarningsOps(syncEntries);
        } catch {}
        // Throttle ~1.2s between dates to respect rate limits
        await new Promise((r) => setTimeout(r, 1200));
      }
      const after = getConvictionList().length;
      prunedTotal = Math.max(0, before - after);
      setRevalProgress(`✓ Done — ${prunedTotal} stale ${prunedTotal === 1 ? 'entry' : 'entries'} pruned across ${dates.length} dates.`);
    } finally {
      setRevalidating(false);
      setTimeout(() => setRevalProgress(null), 12_000);
    }
  }, [entries, revalidating]);
  // zzz229 — REBUILD bench from server history. The bench lives only in
  // browser storage; if the browser evicts the origin's storage (quota
  // pressure from the big multibagger payloads) or grading-rule changes
  // demote everything, the bench drains. The server keeps per-date graded
  // payloads, so we can re-fetch the last 60 days and re-add every
  // BLOCKBUSTER/STRONG print (ADD-only — never demotes/deletes).
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<string | null>(null);
  const [binCount, setBinCount] = useState<number>(() => readConvictionBin().length);
  useEffect(() => {
    const refresh = () => setBinCount(readConvictionBin().length);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => window.removeEventListener('conviction-beats:updated', refresh);
  }, []);
  const runRebuild = useCallback(async () => {
    if (rebuilding) return;
    setRebuilding(true);
    try {
      const dates: string[] = [];
      const now = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(now.getTime() - i * 24 * 3600_000);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue;  // NSE closed
        dates.push(d.toISOString().slice(0, 10));
      }
      const before = getConvictionList().length;
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        setRebuildProgress(`Rebuilding ${i + 1}/${dates.length} · ${d}`);
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${d}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const j = await res.json();
          const bt = j?.by_tier || {};
          const syncEntries: any[] = [];
          for (const tier of ['BLOCKBUSTER', 'STRONG']) {  // ADD-only: skip MIXED/AVOID so nothing gets demoted
            for (const c of (bt[tier] || [])) {
              const qm = typeof c.quarter === 'string' ? c.quarter.match(/Q([1-4])/i) : null;
              const fm = typeof c.quarter === 'string' ? c.quarter.match(/FY\s?(\d{2})/i) : null;
              syncEntries.push({
                ticker: c.ticker, company: c.company, tier,
                composite_score: c.composite_score,
                sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
                filing_date: c.filing_date || d, sector: c.sector, market_cap_bucket: c.market_cap_bucket,
                market_cap_cr: typeof c.market_cap_cr === 'number' ? c.market_cap_cr : null,
                source_url: c.filing_url,
                ...(qm ? { quarter: ('Q' + qm[1]) as any } : {}),
                ...(fm ? { fiscal_year: (parseInt(fm[1], 10) < 50 ? 2000 + parseInt(fm[1], 10) : 1900 + parseInt(fm[1], 10)) } : {}),
                d1_pct: typeof c.d1_pct === 'number' ? c.d1_pct : null,
                gap_pct: typeof c.gap_pct === 'number' ? c.gap_pct : null,
                is_elite: c.is_elite === true,
                pead_score: typeof c.pead_score === 'number' ? c.pead_score : null,
                multibagger_setup: c.multibagger_setup === true,
                opm_pct: typeof c.opm_pct === 'number' ? c.opm_pct : null,
                opm_prev_pct: typeof c.opm_prev_pct === 'number' ? c.opm_prev_pct : null,
              });
            }
          }
          if (syncEntries.length > 0) syncFromEarningsOps(syncEntries);
        } catch {}
        await new Promise((r) => setTimeout(r, 350));
      }
      const after = getConvictionList().length;
      setRebuildProgress(`\u2713 Done \u2014 ${Math.max(0, after - before)} entries restored from ${dates.length} trading days.`);
    } finally {
      setRebuilding(false);
      setTimeout(() => setRebuildProgress(null), 15_000);
    }
  }, [rebuilding]);
  const runRestoreBin = useCallback(() => {
    const n = restoreConvictionBin();
    setRebuildProgress(`\u21a9 Restored ${n} removed ${n === 1 ? 'entry' : 'entries'} from the recycle bin.`);
    setTimeout(() => setRebuildProgress(null), 10_000);
  }, []);
  // PATCH 0923 — collapsible Q1-Q4 cheat sheet visibility.
  // Default OPEN on first mount so the user understands the chips immediately.
  const [showQuarterCheatSheet, setShowQuarterCheatSheet] = useState(true);
  const toggle = <K extends keyof ConvFilters>(k: K, v: ConvFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: f[k] === v ? null : v } as ConvFilters));

  // PATCH 0539 — view-mode toggle (compact rows vs rich Earnings Hub cards)
  // PATCH 0546 — Default to COMPACT.
  // PATCH 0547 — Rich view dead-coded behind `false ?` because the per-ticker
  // enrichment fetch was unreliable for 200+ entries (counts stayed at 0).
  // PATCH 0549 — Returning users with the legacy `'rich'` value still in
  // `mc:conviction-view` localStorage were triggering the dead-fetch on
  // every page load: the hook fired against all conviction tickers, the
  // network burned, and the UI ignored the result. Hard-coerce to 'compact'
  // and drop the legacy key so the fetch never starts. State is preserved
  // as a constant so the dead-code branch below still type-checks if the
  // user toggles it back on later.
  const viewMode: 'compact' = 'compact';
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.removeItem('mc:conviction-view'); } catch {}
  }, []);

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
  // PATCH 0549 — rich view dead-coded, so always pass [] to skip the fetch.
  // Hook still called (Rules of Hooks) but its effect short-circuits on
  // empty tickers.
  const tickersForFetch = useMemo(() => filteredEntries.map(e => e.ticker), [filteredEntries.map(e => e.ticker).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  void tickersForFetch;
  const { cards: enrichedCards, loading: richLoading } = useEnrichedConvictionCards([]);

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
        backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: 12,
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🏆</div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--mc-text-0)', margin: '0 0 6px' }}>
          Conviction Beats — empty
        </h3>
        <p style={{ fontSize: 12, color: 'var(--mc-text-3)', margin: '0 0 12px', lineHeight: 1.5 }}>
          This bench auto-fills with stocks that print BLOCKBUSTER or STRONG earnings in <strong style={{ color: 'var(--mc-cyan)' }}>/earnings-opportunities</strong>.
          <br />Visit that page after a day of filings; this list will populate automatically.
        </p>
        <a href="/earnings-opportunities" style={{
          display: 'inline-block', padding: '8px 16px',
          backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
          borderRadius: 6, color: 'var(--mc-warn)', fontSize: 12, fontWeight: 700,
          textDecoration: 'none',
        }}>Open Earnings Opportunities →</a>
        {/* zzz229 — recovery actions when the bench drained unexpectedly
            (browser storage eviction or rule-change demotions). */}
        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={runRebuild} disabled={rebuilding}
            title="Re-fetch server grading for the last 60 trading days and re-add every BLOCKBUSTER/STRONG print. Add-only: never deletes anything. Takes ~30s."
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: rebuilding ? 'wait' : 'pointer',
              backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 40%, transparent)', color: 'var(--mc-cyan)',
            }}>
            ♻ {rebuilding ? 'Rebuilding…' : 'Rebuild bench from last 60 days'}
          </button>
          {binCount > 0 && (
            <button onClick={runRestoreBin}
              title="Restore entries that were removed by demotion sync, the × button, or Clear All."
              style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 40%, transparent)', color: 'var(--mc-bullish)',
              }}>
              ↩ Restore removed ({binCount})
            </button>
          )}
        </div>
        {rebuildProgress && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--mc-cyan)', fontWeight: 600 }}>{rebuildProgress}</div>
        )}
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
      <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>{label}</span>
      {options.map((o) => {
        const active = filters[k] === o.v;
        const n = countWith(k, o.v);
        return (
          <button key={o.v} onClick={() => toggle(k, o.v as any)}
            style={active ? chipActive(color) : chipBase}>
            {o.lbl} <span style={{ color: active ? color : 'var(--mc-text-4)', marginLeft: 3 }}>({n})</span>
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
        padding: '10px 14px', backgroundColor: 'var(--mc-bg-0)',
        border: '1px solid var(--mc-bg-4)', borderRadius: 8,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>FILTERS</span>
            <span style={{ color: 'var(--mc-text-4)', fontWeight: 600 }}>· {filteredEntries.length} of {entries.length}</span>
            {/* PATCH 0919 — Safety-net "0 results" hint. When the bench is
                non-empty but no entries pass the filter, surface a prominent
                Reset button so the user isn't stuck wondering which chip is
                hiding the data. */}
            {filteredEntries.length === 0 && entries.length > 0 && (
              <button
                onClick={() => setFilters(FILTER_DEFAULT)}
                title="Resets every filter (Sales/PAT/EPS/OP-Lev/PEAD/Guidance/Quarter/FY/date range)"
                style={{
                  padding: '3px 9px', fontSize: 10, fontWeight: 800,
                  background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 50%, transparent)',
                  color: 'var(--mc-warn)', borderRadius: 4, cursor: 'pointer',
                }}
              >⚠ 0 match — Reset all filters</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setFilters((f) => ({ ...f, sortByPead: !f.sortByPead }))}
              style={filters.sortByPead ? chipActive('#22D3EE') : chipBase}>
              🌊 Sort by PEAD {filters.sortByPead ? '✓' : ''}
            </button>
            {/* PATCH 1018 — ELITE / MULTIBAGGER filter chips */}
            <button onClick={() => setFilters((f) => ({ ...f, elite: !f.elite }))}
              style={filters.elite ? chipActive('#FCD34D') : chipBase}>
              ⭐ ELITE only {filters.elite ? '✓' : ''}
            </button>
            <button onClick={() => setFilters((f) => ({ ...f, multibagger: !f.multibagger }))}
              style={filters.multibagger ? chipActive('#67E8F9') : chipBase}>
              💎 MULTIBAGGER only {filters.multibagger ? '✓' : ''}
            </button>
            {/* PATCH 1022 — market-cap range filter */}
            <select
              value={filters.cap}
              onChange={(e) => setFilters((f) => ({ ...f, cap: e.target.value as ConvFilters['cap'] }))}
              title="Filter by market cap (₹ Cr)"
              style={filters.cap !== 'all'
                ? { ...chipActive('#34D399'), cursor: 'pointer' }
                : { ...chipBase, cursor: 'pointer' }}>
              <option value="all">🏦 Mkt Cap · All</option>
              <option value="sweet">🎯 Multibagger ₹5k–50k Cr</option>
              <option value="mega">MEGA ≥ ₹2,00,000 Cr</option>
              <option value="large">LARGE ₹20k–2L Cr</option>
              <option value="mid">MID ₹5k–20k Cr</option>
              <option value="small">SMALL ₹500–5k Cr</option>
              <option value="micro">MICRO &lt; ₹500 Cr</option>
            </select>
            {/* zzz229 — Rebuild from history (add-only) + recycle-bin restore */}
            <button onClick={runRebuild} disabled={rebuilding}
              title="Re-fetch server grading for the last 60 trading days and re-add every BLOCKBUSTER/STRONG print that's missing from the bench. Add-only — never deletes."
              style={{ ...(rebuilding ? chipActive('var(--mc-cyan)') : chipBase), cursor: rebuilding ? 'wait' : 'pointer' }}>
              ♻ {rebuilding ? 'Rebuilding…' : 'Rebuild 60d'}
            </button>
            {binCount > 0 && (
              <button onClick={runRestoreBin}
                title="Restore entries removed by demotion sync, the × button, or Clear All."
                style={{ ...chipBase, cursor: 'pointer' }}>
                ↩ Restore ({binCount})
              </button>
            )}
            {/* PATCH 1019 — Re-validate bench (prune stocks no longer BB/ST) */}
            <button onClick={runRevalidate} disabled={revalidating}
              title="Re-fetch grading for every bench date and prune any stock that dropped out of BLOCKBUSTER/STRONG under current logic (e.g. demoted to MIXED). Takes ~1s per date."
              style={{ ...(revalidating ? chipActive('var(--mc-state-persistent)') : chipBase), cursor: revalidating ? 'wait' : 'pointer' }}>
              🔄 {revalidating ? 'Re-validating…' : 'Re-validate bench'}
            </button>
            {/* PATCH zzz99 — bulk Clear All button for Conviction Beats.
                Placed next to Re-validate bench so the two whole-bench
                actions live together. Disabled when the bench is empty
                or no clear handler is wired (panel can still be reused
                in a read-only context). window.confirm gates the wipe
                because it's irreversible — there is no undo for the LS
                write, and an accidental wipe of 100+ entries would force
                the user to wait for next earnings to re-populate. */}
            {onClearAll && (
              <button
                onClick={() => {
                  if (entries.length === 0) return;
                  const ok = window.confirm(`Clear all ${entries.length} conviction beats? This cannot be undone.`);
                  if (ok) onClearAll();
                }}
                disabled={entries.length === 0}
                title={entries.length === 0
                  ? 'Bench is already empty.'
                  : `Wipe all ${entries.length} conviction beats from the bench. Use this when starting fresh for the next earnings cycle. Cannot be undone — the bench will re-populate as new BLOCKBUSTER/STRONG prints come in.`}
                style={{
                  ...(entries.length === 0 ? chipBase : chipActive('var(--mc-bearish, #EF4444)')),
                  cursor: entries.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: entries.length === 0 ? 0.4 : 1,
                }}>
                🗑 Clear All ({entries.length})
              </button>
            )}
            {revalProgress && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                backgroundColor: revalProgress.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-state-persistent) 9%, transparent)',
                border: `1px solid ${revalProgress.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)'}`,
                color: revalProgress.startsWith('✓') ? 'var(--mc-bullish)' : 'var(--mc-state-persistent)',
              }}>{revalProgress}</span>
            )}
            {/* zzz229 - rebuild/restore progress chip (mirrors revalProgress styling) */}
            {rebuildProgress && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                backgroundColor: rebuildProgress.startsWith('\u2713') || rebuildProgress.startsWith('\u21a9') ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 9%, transparent)',
                border: `1px solid ${rebuildProgress.startsWith('\u2713') || rebuildProgress.startsWith('\u21a9') ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)'}`,
                color: rebuildProgress.startsWith('\u2713') || rebuildProgress.startsWith('\u21a9') ? 'var(--mc-bullish)' : 'var(--mc-cyan)',
              }}>{rebuildProgress}</span>
            )}
            <button onClick={() => setFilters(FILTER_DEFAULT)}
              disabled={filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && filters.quarter == null && filters.fy == null && filters.fromDate == null && filters.toDate == null && filters.d1Bucket == null && filters.d2Bucket == null && filters.opmDelta == null && filters.score == null && filters.opmMin == null && !filters.sortByPead && !filters.elite && !filters.multibagger && filters.cap === 'all'}
              style={{ ...chipBase, opacity: (filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && filters.quarter == null && filters.fy == null && filters.fromDate == null && filters.toDate == null && filters.d1Bucket == null && filters.d2Bucket == null && filters.opmDelta == null && filters.score == null && filters.opmMin == null && !filters.sortByPead) ? 0.4 : 1 }}>
              Clear
            </button>
          </div>
        </div>
        {/* zzz226 — ⚡ QUALITY PRESET: one click applies PAT≥30 · EPS≥40 ·
            OPM Δ≥0 · Composite≥65 · D1≥0. Click again to clear. Detail chips
            below stay collapsed unless expanded. */}
        {(() => {
          const presetActive = filters.sales === 20 && filters.pat === 30 && filters.eps === 25 && filters.opmDelta === 0 && filters.opmMin === 12 && filters.score === 65 && filters.d1Bucket === 2;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setFilters((prev) => presetActive
                  ? { ...FILTER_DEFAULT, cap: prev.cap }
                  : { ...FILTER_DEFAULT, cap: prev.cap, sales: 20, pat: 30, eps: 25, opmDelta: 0, opmMin: 12, score: 65, d1Bucket: 2 })}
                title="One-click quality screen: Sales YoY ≥20% · PAT YoY ≥30% · EPS YoY ≥25% · OPM expanding (Δ≥0pp) · OPM level ≥12% · Composite score ≥65 · Day-1 close ≥+2%. Click again to clear."
                style={presetActive
                  ? chipActive('#F59E0B')
                  : { ...chipBase, border: '1px solid #F59E0B', color: '#F59E0B', fontWeight: 800 }}>
                ⚡ QUALITY PRESET · Sales≥20 · PAT≥30 · EPS≥25 · OPM↗ ≥12% · Score≥65 · D1≥+2% {presetActive ? '✓ ON' : ''}
              </button>
              <button onClick={() => setShowAdvFilters((v) => !v)} style={chipBase}>
                {showAdvFilters ? '▴ Hide detail filters' : '▾ Show detail filters'}
              </button>
            </div>
          );
        })()}
        {showAdvFilters && (<>
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
          { v: 20, lbl: '≥20%' }, { v: 25, lbl: '≥25%' }, { v: 40, lbl: '≥40%' }, { v: 60, lbl: '≥60%' },
        ])}
        {/* zzz223 — OPM margin Δ chips (pp YoY) — mirrors the EO margin signal */}
        {renderChipGroup('OPM Δ (pp YoY)', '#F472B6', 'opmDelta', [
          { v: 0, lbl: '📈 Expanding ≥0' }, { v: 2, lbl: '≥+2pp' }, { v: 5, lbl: '≥+5pp' }, { v: -2, lbl: '📉 Squeeze ≤-2pp' },
        ])}
        {/* zzz226e — absolute OPM level chips (latest quarter %) */}
        {renderChipGroup('OPM LEVEL', '#F472B6', 'opmMin', [
          { v: 10, lbl: '≥10%' }, { v: 12, lbl: '≥12%' }, { v: 15, lbl: '≥15%' }, { v: 20, lbl: '≥20%' },
        ])}
        {/* zzz225 — composite tier score chips (the big number on each card) */}
        {renderChipGroup('COMPOSITE SCORE', '#FBBF24', 'score', [
          { v: 60, lbl: '≥60' }, { v: 65, lbl: '≥65' }, { v: 70, lbl: '≥70' }, { v: 75, lbl: '≥75' }, { v: 80, lbl: '≥80' },
        ])}
        {/* USER-REQ — PEAD score threshold filter (composable with all others) */}
        {renderChipGroup('PEAD SCORE', '#22D3EE', 'pead', [
          { v: 50, lbl: '≥50' }, { v: 60, lbl: '≥60' }, { v: 70, lbl: '≥70' }, { v: 80, lbl: '≥80' },
        ])}
        {/* PATCH 0945 — 1D CLOSE filter chips, matching the /earnings Hub UX.
            Composes AND with every other filter above. Signed threshold:
            positive = "D1 close ≥ N%", negative = "D1 close ≤ N%".

            PATCH 0965 BUG #8 — Counts always showed (0). Root cause: the
            chip count was computed inline on every render, but if entries
            had not yet been hydrated with d1_pct values (graded sync still
            pending) the predicate `Number.isFinite(d1)` returned false for
            every row → count 0. Two fixes:
              1. Memoize the counts so they only recompute when entries /
                 filters actually change (avoids redundant filter passes).
              2. Pre-compute `hasAnyD1` from entries; while it is FALSE,
                 render '…' instead of '(0)' so the user understands the
                 chip is waiting on data rather than mis-reading it as
                 "zero matches". The chip remains clickable for when data
                 arrives.
            The count predicate intentionally reuses `passesConvictionFilter`
            so it can never drift from the actual row-level filter. */}
        {(() => {
          const toggleD1 = (v: number) =>
            setFilters((f) => ({ ...f, d1Bucket: f.d1Bucket === v ? null : v }));
          const opts: Array<{ v: number; lbl: string; color: string }> = [
            // zzz226b — ≥0% chip so the QUALITY PRESET's D1≥0 is visible/toggleable
            { v: 0,  lbl: '≥0%',   color: '#10B981' },
            { v: 2,  lbl: '≥+2%',  color: '#10B981' },
            { v: 4,  lbl: '≥+4%',  color: '#10B981' },
            { v: 7,  lbl: '≥+7%',  color: '#10B981' },
            { v: 10, lbl: '≥+10%', color: '#10B981' },
            { v: -2, lbl: '≤-2%',  color: '#EF4444' },
            { v: -5, lbl: '≤-5%',  color: '#EF4444' },
          ];
          // PATCH 0965 BUG #8 — gate the (N) label on whether ANY entry
          // has a usable d1_pct. We compute this once per render rather
          // than per chip.
          const hasAnyD1 = entries.some(
            (e) => typeof (e as any).d1_pct === 'number' && Number.isFinite((e as any).d1_pct),
          );
          const countD1 = (v: number) => {
            const probe: ConvFilters = { ...filters, d1Bucket: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>1D CLOSE</span>
              {opts.map((o) => {
                const active = filters.d1Bucket === o.v;
                const n = hasAnyD1 ? countD1(o.v) : null;
                return (
                  <button key={o.v} onClick={() => toggleD1(o.v)}
                    title={hasAnyD1 ? `Filter to entries with D1 close ${o.lbl}` : 'Awaiting D1 close enrichment — entries do not yet have d1_pct populated. Counts will fill in once /earnings-opportunities syncs prices.'}
                    style={active ? chipActive(o.color) : chipBase}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n === null ? '…' : n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* zzz229 — 2D CLOSE filter. d2_pct = cumulative % over 2 TRADING
            sessions (skips weekends). If today is Monday, 2D covers Fri close
            → Mon close. Users can compose {1D≥0} AND {2D≥+2%} to require
            day-2 follow-through. Backend populates d2_pct via graded pipeline. */}
        {(() => {
          const toggleD2 = (v: number) =>
            setFilters((f) => ({ ...f, d2Bucket: f.d2Bucket === v ? null : v }));
          const opts: Array<{ v: number; lbl: string; color: string }> = [
            { v: 0,  lbl: '≥0%',   color: '#10B981' },
            { v: 2,  lbl: '≥+2%',  color: '#10B981' },
            { v: 4,  lbl: '≥+4%',  color: '#10B981' },
            { v: 7,  lbl: '≥+7%',  color: '#10B981' },
            { v: 10, lbl: '≥+10%', color: '#10B981' },
            { v: -2, lbl: '≤-2%',  color: '#EF4444' },
            { v: -5, lbl: '≤-5%',  color: '#EF4444' },
          ];
          // zzz229b — accept fallback (move_pct / d1+gap compound / d1 alone) so
          // chip counts populate even before backend ships d2_pct.
          const hasAnyD2 = entries.some((e) => getD2Pct(e) != null);
          const countD2 = (v: number) => {
            const probe: ConvFilters = { ...filters, d2Bucket: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>2D CLOSE</span>
              {opts.map((o) => {
                const active = filters.d2Bucket === o.v;
                const n = hasAnyD2 ? countD2(o.v) : null;
                return (
                  <button key={o.v} onClick={() => toggleD2(o.v)}
                    title={hasAnyD2 ? `Filter to entries with 2-day cumulative close ${o.lbl}. Bloomberg/Goldman convention: D2 = 2 trading sessions after earnings-day prev-close. Uses real d2_pct if backend populated it, else move_pct (walk-forward cumulative, spans many days). NEVER falls back to d1 to avoid duplicating the 1D chip.` : 'No d2_pct or move_pct in bench yet — Hard Refresh /earnings-opportunities to trigger backend compute.'}
                    style={active ? chipActive(o.color) : chipBase}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n === null ? '…' : n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
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
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>GUIDANCE</span>
              {opts.map((o) => {
                const active = filters.guidance === o.v;
                const n = countGuidance(o.v);
                return (
                  <button key={o.v} onClick={() => toggleGuidance(o.v)}
                    style={active ? chipActive(o.color) : chipBase}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* PATCH 0909 — Quarter (Q1-Q4) + FY filter chips. Indian fiscal-
            year convention derived from filing_date via deriveQuarterFY().
            Each chip shows a live (N) count under the OTHER active filters
            so the user sees how each option narrows the post-filter set.
            User feedback: "earnings hub, conviction beats i need some way
            to filter dates by quarter and year and all filter logic to be
            perfect". */}
        {(() => {
          const quarters: Array<'Q1' | 'Q2' | 'Q3' | 'Q4'> = ['Q1', 'Q2', 'Q3', 'Q4'];
          const toggleQ = (q: 'Q1' | 'Q2' | 'Q3' | 'Q4') =>
            setFilters((f) => ({ ...f, quarter: f.quarter === q ? null : q }));
          // PATCH 0921 — Independent-dimension count. When showing "Q4 (N)"
          // ignore other PERIOD filters (fy, fromDate, toDate) and only apply
          // the non-PERIOD filters (sales/PAT/EPS/etc) PLUS this specific Q.
          // Otherwise a narrow date range gets Q4 count = 0 even though the
          // bench has 359 Q4 entries — confusing UX.
          const countQ = (q: 'Q1' | 'Q2' | 'Q3' | 'Q4') => {
            const probe: ConvFilters = { ...filters, quarter: q, fy: null, fromDate: null, toDate: null };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          // PATCH 0913 — Show current FY + 3 prior FYs as chips regardless
          // of whether bench has data for them. User feedback: "i cant test
          // past . if past works future also works thats why". Empty FYs
          // render with (0) count so the chip is always available; user
          // can verify the filter logic by clicking a past FY even before
          // adding past-quarter entries to the bench.
          //
          // Today is 2026-05-26 (IST), so currentFY = FY26 (Apr 2025 - Mar
          // 2026 — we're in the post-Q4 filing window). Past 3 = FY25, FY24,
          // FY23. Future FY27 is shown only if any bench entry has it (rare).
          const presentFY = (() => {
            const s = new Set<number>();
            for (const e of entries) {
              const qfy = deriveQuarterFY(e);
              if (qfy) s.add(qfy.fy);
            }
            // PATCH 0926 — Add the FILING-FOCUS FY + next FY + 2 prior FYs.
            // Filing-focus FY is the year whose Q-results are currently being
            // filed (not the calendar FY we happen to be in). For May 2026
            // this gives FY26 (current filing focus), plus FY27 (next), FY25,
            // FY24. So the user sees FY26 (where their bench actually lives)
            // not FY27 (empty calendar year just begun).
            const now = new Date();
            const calY = now.getFullYear();
            const calM = now.getMonth() + 1;
            const filingFY = calM <= 6 ? calY % 100 : (calY + 1) % 100;
            // filingFY + next + 2 prior
            s.add(filingFY);
            s.add((filingFY + 1) % 100);
            for (let offset = 1; offset <= 2; offset++) {
              s.add((filingFY - offset + 100) % 100);
            }
            return Array.from(s).sort((a, b) => b - a);
          })();
          const toggleFY = (fy: number) =>
            setFilters((f) => ({ ...f, fy: f.fy === fy ? null : fy }));
          // PATCH 0921 — same independent-dimension rule for FY chips.
          const countFY = (fy: number) => {
            const probe: ConvFilters = { ...filters, fy, quarter: null, fromDate: null, toDate: null };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          // PATCH 0911 — Single prominent PERIOD row containing both
          // Quarter and FY chip groups, separated by a visual divider.
          // User feedback: "FYFY26 (289) why no quarter there" — the
          // previous two-row layout buried Quarter above FY and the
          // labels collided visually. New layout puts a bigger PERIOD
          // header + visible vertical divider between Q-chips and FY-chips.
          // PATCH 0922 + 0924 + 0926 — Q chip labels carry the SPECIFIC
          // calendar year derived from the active fiscal-year context.
          //
          // ctxFY = either the active FY filter OR the FILING-FOCUS FY
          // (what's currently being filed), NOT the calendar FY we're in.
          //
          // Filing windows by calendar month:
          //   Apr-Jun: filing Q4 of FY{calY}   (Jan-Mar calY results)
          //   Jul-Sep: filing Q1 of FY{calY+1} (Apr-Jun calY results)
          //   Oct-Dec: filing Q2 of FY{calY+1} (Jul-Sep calY results)
          //   Jan-Mar: filing Q3 of FY{calY}   (Oct-Dec calY-1 results)
          //
          // User feedback: "Showing for FY27 (Apr 2026 → Mar 2027) ← we're here
          // now" in May 2026 was confusing — we're CALENDAR-in FY27, but
          // every filing right now is Q4 FY26. Bench data reflects filing
          // focus, so the default chip should match.
          const ctxFY: number = (() => {
            if (filters.fy != null) return filters.fy;
            const now = new Date();
            const calY = now.getFullYear();
            const calM = now.getMonth() + 1;
            // calM <= 6 (Jan-Jun) → filing Q3 or Q4 of FY{calY}
            // calM >= 7 (Jul-Dec) → filing Q1 or Q2 of FY{calY+1}
            return calM <= 6 ? calY % 100 : (calY + 1) % 100;
          })();
          // PATCH 0926 — Which quarter row is "we're here now" annotated.
          // Based on calendar month (independent of any FY override):
          //   Apr-Jun → Q4 (filing Q4 results)
          //   Jul-Sep → Q1
          //   Oct-Dec → Q2
          //   Jan-Mar → Q3
          const currentFilingQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' = (() => {
            const m = new Date().getMonth() + 1;
            if (m >= 4 && m <= 6) return 'Q4';
            if (m >= 7 && m <= 9) return 'Q1';
            if (m >= 10 && m <= 12) return 'Q2';
            return 'Q3';
          })();
          // True only when the cheat sheet's FY matches the current filing-
          // focus FY (so the "← we're here now" indicator is honest if user
          // switched to a past or future FY).
          const isCtxFYCurrent = (() => {
            const now = new Date();
            const calY = now.getFullYear();
            const calM = now.getMonth() + 1;
            const realCurrentFY = calM <= 6 ? calY % 100 : (calY + 1) % 100;
            return ctxFY === realCurrentFY;
          })();
          const ctxFYFull = ctxFY < 50 ? 2000 + ctxFY : 2000 + ctxFY;
          const calForQ1Q2Q3 = ctxFYFull - 1;
          const calForQ4 = ctxFYFull;
          const qMeta: Record<string, { label: string; reports: string; filed: string }> = {
            Q1: { label: 'Q1', reports: `Apr-Jun ${calForQ1Q2Q3} results`,   filed: `typically filed Jul-Aug ${calForQ1Q2Q3}` },
            Q2: { label: 'Q2', reports: `Jul-Sep ${calForQ1Q2Q3} results`,   filed: `typically filed Oct-Nov ${calForQ1Q2Q3}` },
            Q3: { label: 'Q3', reports: `Oct-Dec ${calForQ1Q2Q3} results`,   filed: `typically filed Jan-Feb ${calForQ4}` },
            Q4: { label: 'Q4', reports: `Jan-Mar ${calForQ4} results · annual`, filed: `typically filed Apr-Jun ${calForQ4}` },
          };
          return (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              padding: '8px 10px',
              background: 'rgba(245,158,11,0.04)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 6,
            }}>
              {/* PATCH 0922 + 0923 — Inline definitional banner with
                  collapsible quarter cheat-sheet table. User wanted the
                  same table I showed in chat rendered on the page so they
                  never have to flip between explainer and chips again. */}
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', lineHeight: 1.4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--mc-warn)', fontWeight: 800 }}>📅 PERIOD</span>
                  <span>
                    Indian FY: <strong style={{ color: 'var(--mc-text-1)' }}>FY26 = Apr 2025 → Mar 2026</strong>.
                    Quarter chips filter by <strong style={{ color: 'var(--mc-text-1)' }}>reporting quarter</strong>
                    {' '}(what the results cover), NOT filing month.
                  </span>
                  <button
                    onClick={() => setShowQuarterCheatSheet(v => !v)}
                    title="Show / hide the Q1-Q4 cheat sheet"
                    style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
                  >
                    {showQuarterCheatSheet ? '▾' : '▸'} Cheat sheet
                  </button>
                </div>
                {showQuarterCheatSheet && (
                  <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 4 }}>
                    <div style={{ fontSize: 9.5, color: 'var(--mc-text-3)', marginBottom: 4 }}>
                      Showing for <strong style={{ color: 'var(--mc-warn)' }}>FY{ctxFY}</strong> (Apr {ctxFYFull - 1} → Mar {ctxFYFull})
                      {filters.fy == null && <span style={{ marginLeft: 4, color: 'var(--mc-text-4)' }}>· default · switch YEAR chip below to shift</span>}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(245,158,11,0.3)' }}>
                          <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.3px' }}>Reporting Quarter</th>
                          <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--mc-warn)', fontWeight: 800 }}>Period the results cover</th>
                          <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--mc-warn)', fontWeight: 800 }}>Companies typically file</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* PATCH 0926 — "we're here now" annotation moves to
                            the quarter row that matches the current FILING
                            window. Only fires when ctxFY matches the real
                            current filing-focus FY (else past-FY browsing
                            would falsely claim "we're here now"). */}
                        {([
                          { q: 'Q1', period: `Apr–Jun ${calForQ1Q2Q3}`, filed: `Jul–Aug ${calForQ1Q2Q3}` },
                          { q: 'Q2', period: `Jul–Sep ${calForQ1Q2Q3}`, filed: `Oct–Nov ${calForQ1Q2Q3}` },
                          { q: 'Q3', period: `Oct–Dec ${calForQ1Q2Q3}`, filed: `Jan–Feb ${calForQ4}` },
                          { q: 'Q4', period: `Jan–Mar ${calForQ4} (also annual)`, filed: `Apr–Jun ${calForQ4}` },
                        ] as const).map((row) => {
                          const isCurrent = isCtxFYCurrent && row.q === currentFilingQuarter;
                          return (
                            <tr key={row.q} style={isCurrent ? { background: 'rgba(245,158,11,0.10)' } : undefined}>
                              <td style={{ padding: '2px 6px', color: isCurrent ? 'var(--mc-warn)' : 'var(--mc-text-1)', fontWeight: 800 }}>{row.q} FY{ctxFY}</td>
                              <td style={{ padding: '2px 6px', color: isCurrent ? 'var(--mc-warn)' : 'var(--mc-text-3)' }}>{row.period}</td>
                              <td style={{ padding: '2px 6px', color: isCurrent ? 'var(--mc-warn)' : 'var(--mc-text-3)', fontWeight: isCurrent ? 700 : undefined }}>
                                {row.filed}{isCurrent ? ' ← we\'re here now' : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 110 }}>Reporting quarter:</span>
                <span style={{ fontSize: 9, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>
                  ({filters.fy != null ? `FY${ctxFY}` : `FY${ctxFY} default`})
                </span>
              {quarters.map((q) => {
                const active = filters.quarter === q;
                const n = countQ(q);
                const meta = qMeta[q];
                // The "Q3 FY26" full label so the chip is institutionally
                // unambiguous even when read out of context.
                const qFyLabel = `${meta.label} FY${ctxFY}`;
                // Strip the "results · annual" tail for compact inline tag.
                const periodTag = meta.reports.replace(' results', '').replace(' · annual', '');
                return (
                  <button key={q} onClick={() => toggleQ(q)}
                    style={active ? chipActive('#F59E0B') : chipBase}
                    title={`${qFyLabel} = ${meta.reports} · ${meta.filed}. Click to filter the bench to entries reporting this fiscal quarter, regardless of when they were filed. (Calendar years shown reflect ${filters.fy != null ? `your selected FY${ctxFY}` : `the current default FY${ctxFY}`}; if you switch the YEAR chip below, these labels will shift.)`}>
                    {qFyLabel} <span style={{ fontSize: 9, color: active ? 'var(--mc-warn)' : 'var(--mc-text-3)', marginLeft: 2 }}>({periodTag})</span> <span style={{ color: active ? 'var(--mc-warn)' : 'var(--mc-text-4)', marginLeft: 3, fontWeight: 800 }}>({n})</span>
                  </button>
                );
              })}
              </div>
              {presentFY.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 110 }}>Fiscal year:</span>
                  {presentFY.map((fy) => {
                    const active = filters.fy === fy;
                    const n = countFY(fy);
                    const fyFull = fy < 50 ? 2000 + fy : 2000 + fy;
                    return (
                      <button key={fy} onClick={() => toggleFY(fy)}
                        style={active ? chipActive('#A78BFA') : chipBase}
                        title={`FY${fy} = Apr ${fyFull - 1} → Mar ${fyFull} (full Indian fiscal year, all 4 quarters Q1+Q2+Q3+Q4). Click a quarter chip above to narrow further. ${n === 0 ? 'No bench entries for this FY yet.' : `${n} entr${n === 1 ? 'y' : 'ies'} match.`}`}>
                        FY{fy} <span style={{ fontSize: 9, color: active ? 'var(--mc-state-persistent)' : 'var(--mc-text-3)', marginLeft: 2 }}>(Apr {fyFull - 1}–Mar {fyFull})</span> <span style={{ color: active ? 'var(--mc-state-persistent)' : 'var(--mc-text-4)', marginLeft: 3, fontWeight: 800 }}>({n})</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* PATCH 0918 + 0922 — Filing-date range filter, own row,
                  clearly labeled distinct from reporting-quarter chips. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 110 }}>Filing date range:</span>
                <span style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700 }}>FROM:</span>
                <input
                  type="date"
                  value={filters.fromDate || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const ok = v && /^\d{4}-\d{2}-\d{2}$/.test(v);
                    setFilters((f) => ({ ...f, fromDate: ok ? v : null }));
                  }}
                  title="Filter to entries with filing_date on or AFTER this date (inclusive). This is the actual day the result was filed with NSE/BSE — different from the reporting quarter."
                  style={{ background: 'var(--mc-bg-0)', border: '1px solid #2A3550', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 4, outline: 'none', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700 }}>TO:</span>
                <input
                  type="date"
                  value={filters.toDate || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const ok = v && /^\d{4}-\d{2}-\d{2}$/.test(v);
                    setFilters((f) => ({ ...f, toDate: ok ? v : null }));
                  }}
                  title="Filter to entries with filing_date on or BEFORE this date (inclusive)."
                  style={{ background: 'var(--mc-bg-0)', border: '1px solid #2A3550', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 4, outline: 'none', cursor: 'pointer' }}
                />
                {(filters.quarter || filters.fy != null || filters.fromDate || filters.toDate) && (
                  <button
                    onClick={() => setFilters((f) => ({ ...f, quarter: null, fy: null, fromDate: null, toDate: null }))}
                    title="Clear ALL period filters (reporting quarter + fiscal year + filing date range)"
                    style={{ ...chipBase, marginLeft: 4, opacity: 0.8 }}
                  >× clear period</button>
                )}
              </div>
            </div>
          );
        })()}
        </>)}
      </div>
      <div style={{
        padding: '10px 14px', backgroundColor: 'var(--mc-bg-0)',
        border: '1px solid var(--mc-bg-4)', borderRadius: 8,
        fontSize: 11.5, color: 'var(--mc-text-3)', lineHeight: 1.5,
      }}>
        <div>
          Institutional bench of high-quality post-earnings setups.
          Auto-populated from <strong style={{ color: 'var(--mc-cyan)' }}>Earnings Opportunities</strong> whenever a stock prints BLOCKBUSTER or STRONG.
          Removed entries don't auto-readd — use × to permanently prune.
        </div>
        {/* PATCH 0918 — Explain why bench is heavily skewed toward current quarter.
            User feedback: clicked Jan 29 2026 on EO, saw 101 scheduled, expected
            those to land on the bench. They don't — bench only gains entries
            when a company is GRADED BLOCKBUSTER/STRONG (i.e. it actually filed
            financials AND beat the bar), not when a board meeting is announced. */}
        {(() => {
          // Compute quarter distribution to show user why their filters look skewed.
          const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, none: 0 };
          for (const e of entries) {
            const qfy = deriveQuarterFY(e);
            if (qfy) counts[qfy.q]++; else counts.none++;
          }
          const totalQ = counts.Q1 + counts.Q2 + counts.Q3 + counts.Q4;
          const dominantQ = (Object.entries(counts) as Array<[string, number]>)
            .filter(([k]) => k !== 'none')
            .sort((a, b) => b[1] - a[1])[0];
          if (!dominantQ || totalQ === 0) return null;
          const dominantPct = (dominantQ[1] / totalQ) * 100;
          if (dominantPct < 70) return null; // Only show when one quarter dominates >70%
          // PATCH 0922 — Quarter→date-range cheat sheet so user can verify.
          const qPeriodMap: Record<string, string> = {
            Q1: 'Apr–Jun results (filed Jul–Aug)',
            Q2: 'Jul–Sep results (filed Oct–Nov)',
            Q3: 'Oct–Dec results (filed Jan–Feb)',
            Q4: 'Jan–Mar results · annual (filed Apr–Jun)',
          };
          return (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 4, fontSize: 11, color: 'var(--mc-state-persistent)', lineHeight: 1.6 }}>
              ℹ️ <strong>Why is {dominantQ[0]} so dominant?</strong> Bench auto-populates only when a stock is GRADED (filed + parsed + tiered) — not when its board meeting is scheduled.
              We&apos;re in the middle of <strong>Q4 FY26 filing season</strong> (May–Jun 2026 — companies publishing their Jan–Mar 2026 numbers), so {dominantQ[0]} naturally has {dominantQ[1]} of {totalQ} entries ({dominantPct.toFixed(0)}%).
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-3)' }}>
                <strong style={{ color: 'var(--mc-text-1)' }}>Quarter → date cheat sheet:</strong> Q1 = {qPeriodMap.Q1} · Q2 = {qPeriodMap.Q2} · Q3 = {qPeriodMap.Q3} · Q4 = {qPeriodMap.Q4}
              </div>
            </div>
          );
        })()}
      </div>

      {/* PATCH 0196 — Export toolbar (CSV, TradingView, .txt, Open chart). Tier-grouped.
          PATCH 0366 — tickerCompanyMap wired for Screener.in name-based matching. */}
      <TickerExportToolbar
        tickers={allTickers}
        groups={[
          // zzz224 — ELITE leads: in the sectioned TradingView copy, elite
          // names land under ###ELITE and are deduped out of the tier
          // sections below (strongest names on top of the watchlist).
          { label: 'ELITE', emoji: '🏆', tickers: [...blockbusters, ...strongs].filter((e: any) => e.is_elite).map((e) => e.ticker), color: '#22D3EE' },
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

      {/* PATCH 0547 — Rich view + view-mode toggle REMOVED per user request.
          Hub-style enrichment fetch was unreliable for 200+ entries and
          counts stayed at 0. Compact view is now the only view. */}

      {false ? (
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
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--mc-text-3)', backgroundColor: 'var(--mc-bg-1)', border: '1px dashed var(--mc-border-2)', borderRadius: 10 }}>
              {enrichedList.length === 0
                ? 'No enriched cards yet — fetch may still be running. Try again in a moment.'
                : 'No cards match the current hub filters. Adjust filters above.'}
            </div>
          )}
          {hubFilteredList.length > 0 && filters.sortByPead && (
            // PATCH 0540 — When PEAD sort is active, render a single
            // top-down sorted grid; grouping by tier would break the
            // sort signal the user just asked for.
            <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderLeft: '4px solid var(--mc-cyan)', borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 10, letterSpacing: '0.5px' }}>
                🌊 PEAD-SORTED · {hubFilteredList.length}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                {hubFilteredList.map((c) => (
                  <div key={c.symbol} style={{ position: 'relative' }}>
                    <EarningsCardComponent card={c} />
                    <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                      style={{ position: 'absolute', top: 8, right: 8, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-3)', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
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
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderLeft: '4px solid var(--mc-warn)', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px' }}>
                        ⭐ BLOCKBUSTER · {bb.length}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                      {bb.map((c) => (
                        <div key={c.symbol} style={{ position: 'relative' }}>
                          <EarningsCardComponent card={c} />
                          <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                            style={{ position: 'absolute', top: 8, right: 8, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-3)', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {st.length > 0 && (
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderLeft: '4px solid var(--mc-bullish)', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.5px' }}>
                        🟢 STRONG · {st.length}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                      {st.map((c) => (
                        <div key={c.symbol} style={{ position: 'relative' }}>
                          <EarningsCardComponent card={c} />
                          <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                            style={{ position: 'absolute', top: 8, right: 8, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-3)', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
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
              backgroundColor: 'var(--mc-bg-1)',
              border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderLeft: '4px solid var(--mc-warn)',
              borderRadius: 12, padding: '14px 18px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', marginBottom: 10, letterSpacing: '0.5px' }}>
                ⭐ BLOCKBUSTER · {blockbusters.length}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                {blockbusters.map((e) => <ConvictionRow key={e.ticker} entry={e} onRemove={onRemove} />)}
              </div>
            </div>
          )}
          {strongs.length > 0 && (
            <div style={{
              backgroundColor: 'var(--mc-bg-1)',
              border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderLeft: '4px solid var(--mc-bullish)',
              borderRadius: 12, padding: '14px 18px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', marginBottom: 10, letterSpacing: '0.5px' }}>
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
      padding: '10px 14px', backgroundColor: 'var(--mc-bg-0)',
      border: '1px solid var(--mc-bg-4)', borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)', letterSpacing: '0.4px' }}>
          HUB FILTERS
        </div>
        <button onClick={() => setFilters(HUB_FILTER_DEFAULT)}
          disabled={isDefault}
          style={{ ...chipBase, opacity: isDefault ? 0.4 : 1 }}>Clear</button>
      </div>
      {/* GRADE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>GRADE</span>
        {gradeCfg.map(g => {
          const active = filters.grades.has(g.v);
          return (
            <button key={g.v} onClick={() => toggleGrade(g.v)}
              style={active ? chipActive(g.color) : chipBase}>
              {g.v} <span style={{ color: active ? g.color : 'var(--mc-text-4)', marginLeft: 3 }}>({countGradeChip(g.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* SCORE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>SCORE</span>
        {[60, 75, 85].map(v => {
          const active = filters.scoreMin === v;
          return (
            <button key={v} onClick={() => setFilters(f => ({ ...f, scoreMin: f.scoreMin === v ? null : v }))}
              style={active ? chipActive('#22D3EE') : chipBase}>
              ≥{v} <span style={{ color: active ? 'var(--mc-cyan)' : 'var(--mc-text-4)', marginLeft: 3 }}>({countScoreChip(v)})</span>
            </button>
          );
        })}
      </div>
      {/* AUDIENCE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>AUDIENCE</span>
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
              {o.v} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({countAudienceChip(o.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* DATA QUALITY */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>QUALITY</span>
        {([
          { v: 'FULL', color: '#00C853', lbl: 'Full' },
          { v: 'PARTIAL', color: '#FFD600', lbl: 'Partial' },
          { v: 'PRICE_ONLY', color: '#F44336', lbl: 'Price Only' },
        ] as const).map(o => {
          const active = filters.dataQuality.has(o.v as any);
          return (
            <button key={o.v} onClick={() => toggleDq(o.v as any)}
              style={active ? chipActive(o.color) : chipBase}>
              {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({countDqChip(o.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* DIVERGENCE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>FLAGS</span>
        <button onClick={() => setFilters(f => ({ ...f, divergenceOnly: !f.divergenceOnly }))}
          style={filters.divergenceOnly ? chipActive('#F59E0B') : chipBase}>
          ⚡ Divergence Only <span style={{ color: filters.divergenceOnly ? 'var(--mc-warn)' : 'var(--mc-text-4)', marginLeft: 3 }}>({countDivergenceChip()})</span>
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
      padding: '10px 12px', backgroundColor: 'var(--mc-bg-0)',
      border: '1px solid var(--mc-bg-4)', borderLeft: `3px solid ${tierColor}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.company}
          </div>
          <div style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'var(--mc-text-3)', display: 'flex', gap: 6 }}>
            <span style={{ fontWeight: 700 }}>{entry.ticker}</span>
            <span style={{ color: 'var(--mc-text-4)' }}>·</span>
            <span>filed {entry.filing_date}</span>
            {entry.sector && (<><span style={{ color: 'var(--mc-text-4)' }}>·</span><span>{entry.sector}</span></>)}
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
            background: 'none', border: 'none', color: 'var(--mc-text-4)',
            cursor: 'pointer', padding: '2px 6px', fontSize: 14,
          }}>×</button>
      </div>
      {/*
       * PATCH 0965 BUG #9 — "Results Pending" badge for unfiled stocks.
       *
       * Root cause: ~20+ companies (HONASA, GPIL, IOC, ABB, BERGEPAINT…)
       * land on the bench with their meta-row (ticker / sector / filing
       * date) populated, but Sales/PAT/EPS are null because Q4 FY26
       * results haven't been filed yet (board meeting announced but
       * actuals not yet published) OR screener.in enrichment hasn't
       * caught up. The previous render showed three lonely "—" cells,
       * which looked indistinguishable from "data is zero". Replace the
       * triple-dash with an explicit "Results Pending" badge with a
       * tooltip explaining the cause.
       */}
      {(() => {
        const allNull =
          (entry.sales_yoy_pct === null || entry.sales_yoy_pct === undefined) &&
          (entry.net_profit_yoy_pct === null || entry.net_profit_yoy_pct === undefined) &&
          (entry.eps_yoy_pct === null || entry.eps_yoy_pct === undefined);
        if (allNull) {
          return (
            <div>
              <span
                title="No Q4 FY26 data reported yet. Will populate when company files results."
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontStyle: 'italic',
                  padding: '2px 7px', borderRadius: 4,
                  backgroundColor: 'rgba(148,163,184,0.15)',
                  border: '1px solid rgba(148,163,184,0.35)',
                  color: 'var(--mc-text-3)', fontWeight: 600, cursor: 'help',
                }}
              >⏳ Results Pending</span>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', gap: 10, fontSize: 10.5 }}>
            <span><span style={{ color: 'var(--mc-text-4)' }}>Sales</span> <strong style={{ color: (entry.sales_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.sales_yoy_pct)}</strong></span>
            <span><span style={{ color: 'var(--mc-text-4)' }}>PAT</span> <strong style={{ color: (entry.net_profit_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.net_profit_yoy_pct)}</strong></span>
            <span><span style={{ color: 'var(--mc-text-4)' }}>EPS</span> <strong style={{ color: (entry.eps_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.eps_yoy_pct)}</strong></span>
            {/* zzz223 — OPM margin chip: latest OPM % + pp delta vs prior year */}
            {typeof (entry as any).opm_pct === 'number' && (() => {
              const o = (entry as any).opm_pct as number;
              const p = (entry as any).opm_prev_pct as number | null | undefined;
              const d = typeof p === 'number' ? o - p : null;
              const col = d == null ? 'var(--mc-text-2)' : d >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
              return (
                <span title={typeof p === 'number' ? `OPM ${o.toFixed(1)}% vs ${p.toFixed(1)}% prior year — ${(d as number) >= 0 ? '+' : ''}${(d as number).toFixed(1)}pp` : `OPM ${o.toFixed(1)}% (no prior-year value)`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>OPM</span>{' '}
                  <strong style={{ color: col }}>
                    {o.toFixed(1)}%{d != null ? ` (${d >= 0 ? '+' : ''}${d.toFixed(1)}pp)` : ''}
                  </strong>
                </span>
              );
            })()}
            {/* zzz230 — Since filing: cumulative % close move from earnings-report
                date to most recent close. Sourced from server-computed move_pct
                on the graded API. Shows how the market has voted since results. */}
            {typeof (entry as any).move_pct === 'number' && Number.isFinite((entry as any).move_pct) && (() => {
              const m = (entry as any).move_pct as number;
              const col = m >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
              const arrow = m >= 8 ? '🚀' : m >= 3 ? '📈' : m >= -3 ? '➖' : m >= -8 ? '📉' : '💥';
              return (
                <span title={`Cumulative close move since filing date (${entry.filing_date || '?'}). Server-computed from Yahoo daily bars. Refreshed on Hard Refresh.`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>Since {arrow}</span>{' '}
                  <strong style={{ color: col }}>
                    {m >= 0 ? '+' : ''}{m.toFixed(1)}%
                  </strong>
                </span>
              );
            })()}
          </div>
        );
      })()}
      {/* PATCH 0546 — Always render guidance badge using derived label
          (falls back to YoY-metric heuristic when no explicit field).
          Explicit field shows its signed score; derived label shows the
          deriving signal so user knows it's heuristic. */}
      {(() => {
        const label = deriveGuidanceLabel(entry);
        const isExplicit = !!entry.guidance;
        const cfg: Record<string, { color: string; icon: string }> = {
          'Positive': { color: '#10B981', icon: '📈' },
          'Neutral':  { color: '#94A3B8', icon: '➖' },
          'Negative': { color: '#EF4444', icon: '📉' },
        };
        const c = cfg[label];
        const s = entry.guidance_score;
        const scoreStr = (isExplicit && typeof s === 'number' && label !== 'Neutral')
          ? ` (${s > 0 ? '+' : ''}${s.toFixed(2)})`
          : '';
        const suffix = isExplicit ? '' : ' ~';  // ~ marks metric-derived
        return (
          <div>
            <span title={isExplicit ? 'From concall/PR text' : 'Derived from YoY metrics'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10,
              padding: '2px 7px', borderRadius: 4,
              backgroundColor: `${c.color}18`, border: `1px solid ${c.color}40`,
              color: c.color, fontWeight: 700,
            }}>
              {c.icon} {label}{scoreStr}{suffix}
            </span>
          </div>
        );
      })()}
      {entry.source_url && (
        <a href={entry.source_url} target="_blank" rel="noreferrer"
          style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>
          📄 Filing →
        </a>
      )}
    </div>
  );
}
—
