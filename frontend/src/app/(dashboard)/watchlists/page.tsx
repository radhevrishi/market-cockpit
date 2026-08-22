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
  patchConvictionEntries,  // zzz372
  readConvictionBin, restoreConvictionBin,
  type ConvictionEntry,
} from '@/lib/conviction-beats';
import { peadScore, peadColor, peadLabel } from '@/lib/pead-score';
import { armBookFlag } from '@/lib/book-flags-client';

// zzz253 — hardcoded sector map for known NSE tickers. Backend enrichment
// often returns null sector; this fallback ensures peer comparison + sector-
// median P/E coloring work even when Screener/Worker skip sector data.
const NSE_SECTOR_MAP: Record<string, string> = {
  LAURUSLABS: 'Pharma', GRANULES: 'Pharma', VENUSREM: 'Pharma', IPCALAB: 'Pharma', GLENMARK: 'Pharma', GUFICBIO: 'Pharma',
  ATUL: 'Chemicals', KRISHANA: 'Chemicals/Fertilizers', PLASTIBLEN: 'Chemicals/Additives',
  MAHLIFE: 'Real Estate', DBREALTY: 'Real Estate', PROZONER: 'Real Estate',
  CYIENTDLM: 'EMS/Defence', AVANTEL: 'Defence', KERNEX: 'Defence',
  RPEL: 'Refractories', TINNARUBR: 'Rubber Products',
  SGFIN: 'NBFC', POONAWALLA: 'NBFC', FEDFINA: 'NBFC', LTF: 'NBFC', BFINVEST: 'NBFC',
  MENONBE: 'Auto Parts', SSWL: 'Auto Parts', JAMNAAUTO: 'Auto Parts', LUMAXTECH: 'Auto Parts',
  'BAJAJ-AUTO': 'Auto OEM',
  SESHAPAPER: 'Paper',
  IDFCFIRSTB: 'Banks', UJJIVANSFB: 'Banks', CSBBANK: 'Banks', KARURVYSYA: 'Banks', JSFB: 'Banks', MAHABANK: 'PSU Banks',
  ADANIENSOL: 'Power/Transmission', ADANIPOWER: 'Power', GIPCL: 'Power', IREDA: 'Power/Green Finance',
  JSWSTEEL: 'Steel', JAYNECOIND: 'Steel', STEELXIND: 'Steel',
  ANGELONE: 'Broker/Fintech',
  BAJAJCON: 'FMCG', NESTLEIND: 'FMCG',
  'NAM-INDIA': 'AMC',
  ORIENTELEC: 'Consumer Durables',
  LALPATHLAB: 'Diagnostics',
  CRISIL: 'Ratings/Analytics',
  GLOBUSSPR: 'Distillers/Breweries',
  TECHM: 'IT Services', KSOLVES: 'IT Services',
  ITCHOTELS: 'Hotels',
  NEWGEN: 'IT Products',
  SONAMLTD: 'Jewelry/Bullion',
  INOXGREEN: 'Renewables', OLECTRA: 'EVs/Buses', NIBE: 'Defence/Aerospace',
  SBC: 'Textiles', ASMS: 'Electronics/Bartronics',
  SHREEJISPG: 'Textiles',
  GICL: 'Auto Parts/Globe',
  RUBICON: 'IT Products',
  WANBURY: 'Pharma',
  PASHUPATI: 'Overseas Products',
  NCLIND: 'Cement',
  AEGISLOG: 'Logistics',
  GRMOVER: 'Overseas Trading',
  ASIANPAINT: 'Paints',
  DYNPRO: 'Engineering',
};
// zzz254 — Sector color palette for the sector-dot chip. Stable, distinctive
// hues so an analyst scanning 42 cards instantly clusters by industry.
const SECTOR_COLORS: Record<string, string> = {
  'Pharma': '#14B8A6', 'Chemicals': '#8B5CF6', 'Chemicals/Fertilizers': '#8B5CF6',
  'Chemicals/Additives': '#8B5CF6', 'Real Estate': '#EF4444',
  'EMS/Defence': '#A78BFA', 'Defence': '#A78BFA', 'Defence/Aerospace': '#A78BFA',
  'Refractories': '#F97316', 'Rubber Products': '#F97316', 'Paper': '#84CC16',
  'NBFC': '#6366F1', 'Banks': '#F59E0B', 'PSU Banks': '#EAB308',
  'Auto Parts': '#F97316', 'Auto OEM': '#F97316',
  'Power/Transmission': '#0EA5E9', 'Power': '#0EA5E9', 'Power/Green Finance': '#0EA5E9',
  'Steel': '#64748B', 'Broker/Fintech': '#EC4899', 'FMCG': '#10B981',
  'AMC': '#22D3EE', 'Consumer Durables': '#F59E0B', 'Diagnostics': '#14B8A6',
  'Ratings/Analytics': '#22D3EE', 'Distillers/Breweries': '#8B5CF6',
  'IT Services': '#22D3EE', 'IT Products': '#22D3EE', 'Hotels': '#F472B6',
  'Jewelry/Bullion': '#EAB308', 'Renewables': '#10B981', 'EVs/Buses': '#10B981',
  'Textiles': '#8B5CF6', 'Electronics/Bartronics': '#A78BFA',
  'Cement': '#94A3B8', 'Logistics': '#0EA5E9', 'Paints': '#EC4899', 'Engineering': '#F97316',
};
const sectorColor = (sec: string | null): string => (sec && SECTOR_COLORS[sec]) || 'var(--mc-text-4)';

// zzz253 — sector resolver: prefer explicit entry.sector, fall back to map
const resolveSector = (e: any): string | null => {
  if (e?.sector && typeof e.sector === 'string' && e.sector.trim() !== '') return e.sector.trim();
  const t = (e?.ticker || '').toUpperCase();
  return NSE_SECTOR_MAP[t] || null;
};
import TickerExportToolbar from '@/components/TickerExportToolbar';
import FundamentalsAnalyzerPage from '../fundamentals/page';
import PortfolioEarningsTab from './PortfolioEarningsTab'; // zzz283
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
  const [activeTab, setActiveTab] = useState<'main' | 'conviction' | 'fundamentals' | 'ei-elite' | 'portfolio-earnings'>(initialTab);
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
  // zzz426 — hold the SERVER bench in state and merge it at render time so the
  // tab ALWAYS shows every server-confirmed BLOCKBUSTER/STRONG (e.g. RUBICON),
  // regardless of local scan history, prune bin, or sync quirks. The cron-
  // maintained 60-day server bench is authoritative for membership.
  const [serverBench, setServerBench] = useState<ConvictionEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/v1/bench', { cache: 'no-store' });
        if (!r.ok) return;
        const j: any = await r.json();
        const ents: any[] = Array.isArray(j?.entries) ? j.entries : [];
        if (cancelled) return;
        const mapped: ConvictionEntry[] = ents
          .filter((e: any) => e && e.ticker && (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG'))
          .map((e: any) => {
            let q: any, fy: any;
            if (typeof e.quarter === 'string') {
              const qm = e.quarter.match(/Q([1-4])/i); if (qm) q = 'Q' + qm[1];
              const fm = e.quarter.match(/FY\s?(\d{2})/i); if (fm) { const yy = parseInt(fm[1], 10); fy = yy < 50 ? 2000 + yy : 1900 + yy; }
            }
            // zzz427 — spread the full bench card (financials/OPM/PE/drift/flags)
            // so the rendered card is complete, not a lean 'Results Pending' stub.
            return {
              ...(e as any),
              ticker: String(e.ticker).toUpperCase(),
              company: e.company || e.ticker,
              added_at: new Date().toISOString(),
              ...(q ? { quarter: q } : {}), ...(fy ? { fiscal_year: fy } : {}),
            } as ConvictionEntry;
          });
        if (!cancelled) setServerBench(mapped);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
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

  // zzz305 — Auto-populate CB bench from recent server graded data.
  // Bug: syncFromEarningsOps only fired when user visited /earnings-opportunities
  // for a specific date. New BLOCKBUSTER/STRONG entries for dates the user
  // never visited never landed. Fix: on /watchlists mount + every 10min,
  // pull last 14 days of graded data and sync any BB/ST. Dedupe logic in
  // syncFromEarningsOps handles same-filing upserts safely.
  useEffect(() => {
    let cancelled = false;
    const scan = async () => {
      const today = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 45; i++) {  // zzz421 — was 14; scan the full season so older BLOCKBUSTER/STRONG (RUBICON etc.) auto-populate
        const d = new Date(today.getTime() - i * 86400_000);
        dates.push(d.toISOString().slice(0, 10));
      }
      const entries: Array<any> = [];
      for (const dstr of dates) {
        if (cancelled) return;
        try {
          const r = await fetch('/api/v1/earnings/graded?date=' + dstr);
          if (!r.ok) continue;
          const j: any = await r.json();
          for (const tier of ['BLOCKBUSTER', 'STRONG'] as const) {
            for (const c of (j?.by_tier?.[tier] || [])) {
              let qParsed: 'Q1' | 'Q2' | 'Q3' | 'Q4' | undefined;
              let fyParsed: number | undefined;
              if (typeof c.quarter === 'string') {
                const qm = c.quarter.match(/Q([1-4])/i);
                if (qm) qParsed = ('Q' + qm[1]) as any;
                const fm = c.quarter.match(/FY\s?(\d{2})/i);
                if (fm) { const yy = parseInt(fm[1], 10); fyParsed = yy < 50 ? 2000 + yy : 1900 + yy; }
              }
              entries.push({
                ticker: c.ticker, company: c.company, tier,
                composite_score: c.composite_score,
                sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
                filing_date: c.filing_date, sector: c.sector, market_cap_bucket: c.market_cap_bucket,
                market_cap_cr: (c as any).market_cap_cr ?? null,
                source_url: c.filing_url,
                ...(qParsed ? { quarter: qParsed } : {}),
                ...(fyParsed ? { fiscal_year: fyParsed } : {}),
                d1_pct: typeof (c as any).d1_pct === 'number' ? (c as any).d1_pct : null,
                gap_pct: typeof (c as any).gap_pct === 'number' ? (c as any).gap_pct : null,
                pead_score: typeof (c as any).pead_score === 'number' ? (c as any).pead_score : null,
                is_elite: (c as any).is_elite === true,
                multibagger_setup: (c as any).multibagger_setup === true,
                opm_pct: typeof (c as any).opm_pct === 'number' ? (c as any).opm_pct : null,
                opm_prev_pct: typeof (c as any).opm_prev_pct === 'number' ? (c as any).opm_prev_pct : null,
                pe: typeof (c as any).pe === 'number' ? (c as any).pe : null,
                cfo_to_pat_ratio: typeof (c as any).cfo_to_pat_ratio === 'number' ? (c as any).cfo_to_pat_ratio : null, // zzz304
              });
            }
          }
        } catch {}
      }
      if (cancelled || entries.length === 0) return;
      try { syncFromEarningsOps(entries); } catch {}
    };
    scan();
    const interval = setInterval(scan, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // zzz422 — merge the SERVER-authoritative Conviction bench (/api/v1/bench).
  // The client self-scan above only catches dates THIS browser happened to
  // open while they were healthy; the server bench is cron-maintained over 60
  // days (refresh-bench) and holds every BLOCKBUSTER/STRONG the pipeline graded.
  // Reading it here makes the tab complete regardless of local scan history
  // (this is why RUBICON etc. were missing). Detail fields backfill from the
  // graded self-scan on the same filing_date.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/v1/bench', { cache: 'no-store' });
        if (!r.ok) return;
        const j: any = await r.json();
        const ents: any[] = Array.isArray(j?.entries) ? j.entries : [];
        if (cancelled || ents.length === 0) return;
        const mapped = ents
          .filter((e: any) => e && e.ticker && (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG'))
          .map((e: any) => {
            let qParsed: 'Q1'|'Q2'|'Q3'|'Q4'|undefined; let fyParsed: number|undefined;
            if (typeof e.quarter === 'string') {
              const qm = e.quarter.match(/Q([1-4])/i); if (qm) qParsed = ('Q'+qm[1]) as any;
              const fm = e.quarter.match(/FY\s?(\d{2})/i); if (fm) { const yy = parseInt(fm[1],10); fyParsed = yy<50?2000+yy:1900+yy; }
            }
            return {
              ticker: e.ticker, company: e.company || e.ticker, tier: e.tier,
              composite_score: e.composite_score ?? 0,
              sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
              filing_date: e.filing_date, sector: e.sector ?? null,
              market_cap_cr: e.market_cap_cr ?? null, move_pct: e.move_pct ?? null,
              ...(qParsed ? { quarter: qParsed } : {}), ...(fyParsed ? { fiscal_year: fyParsed } : {}),
            };
          });
        if (!cancelled && mapped.length) { try { syncFromEarningsOps(mapped as any); } catch {} }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const convictionCount = (() => {
    const set = new Set<string>();
    for (const e of convictionEntries) { const t = String(e.ticker || '').toUpperCase(); if (t) set.add(t); }
    for (const e of serverBench) { const t = String(e.ticker || '').toUpperCase(); if (t) set.add(t); }
    return set.size;
  })();  // zzz426 — count includes server-bench members

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

      // zzz378 — string branch keyed on aVal only could call bVal.toLowerCase() on a
      // non-string; and null/NaN numerics compared with </> ordered blank-metric rows
      // arbitrarily. Guard both: strings compared case-insensitively, nullish sunk to end.
      if (typeof aVal === 'string' || typeof bVal === 'string') {
        const as = (aVal ?? '').toString().toLowerCase();
        const bs = (bVal ?? '').toString().toLowerCase();
        if (as < bs) return sortOrder === 'asc' ? -1 : 1;
        if (as > bs) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      }
      const an = (typeof aVal === 'number' && Number.isFinite(aVal)) ? aVal : (sortOrder === 'asc' ? Infinity : -Infinity);
      const bn = (typeof bVal === 'number' && Number.isFinite(bVal)) ? bVal : (sortOrder === 'asc' ? Infinity : -Infinity);
      if (an < bn) return sortOrder === 'asc' ? -1 : 1;
      if (an > bn) return sortOrder === 'asc' ? 1 : -1;
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
          {activeTab !== 'conviction' && (<>
            <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 4px' }}>Watchlist</h1>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>Tracking universe · Observation only · No P&L</p>
          </>)}
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
        {/* zzz261 — EI Elite tab: EXCELLENT+STRONG from Earnings Intelligence, auto-synced */}
        <button onClick={() => setActiveTab('ei-elite')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'ei-elite' ? '#8B5CF6' : 'transparent'}`,
            color: activeTab === 'ei-elite' ? '#8B5CF6' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          🎖️ EI Elite
        </button>
        {/* zzz283 — Portfolio Earnings tab */}
        <button onClick={() => setActiveTab('portfolio-earnings')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'portfolio-earnings' ? '#22C55E' : 'transparent'}`,
            color: activeTab === 'portfolio-earnings' ? '#22C55E' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          ���� Portfolio Earnings
        </button>
      </div>

      {activeTab === 'portfolio-earnings' ? <PortfolioEarningsTab /> : activeTab === 'ei-elite' ? <EIEliteTab /> : activeTab === 'fundamentals' ? <FundamentalsAnalyzerPage scope="watchlist" /> : activeTab === 'conviction' ? (
        <ConvictionBeatsPanel
          entries={(() => { const map = new Map<string, any>(); for (const e of [...convictionEntries, ...serverBench]) { /* zzz426 merge server bench */ const t = String(e.ticker || '').toUpperCase(); if (!t) continue; const cur = map.get(t); if (!cur) { map.set(t, e); continue; } const eDate = String((e as any).filing_date || ''); const cDate = String((cur as any).filing_date || ''); if (eDate > cDate) { map.set(t, e); continue; } if (eDate < cDate) continue; const eScore = (e as any).composite_score ?? -1; const cScore = (cur as any).composite_score ?? -1; if (eScore > cScore) map.set(t, e); } return Array.from(map.values()); })()}
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
  // zzz329 — max trailing P/E (null = no cap; excludes negative-earnings tickers)
  peMax?: number | null;
  // zzz332 - when true, entries with filing_date within last 3 business days bypass preset gates
  freshBypass?: boolean;
  // zzz348 — minimum market cap in Cr (null = no min)
  mktCapMin?: number | null;
  // zzz304 — minimum CFO/PAT ratio (Screener). Filters low earnings quality;
  // 0.5 = weak, 0.8 = healthy, 1.0 = pristine cash conversion.
  cfoPatMin?: number | null;
  // zzz360 — max promoter-pledge % (null = no cap). 0 = only unpledged names.
  // Null pledged_pct passes (don't over-filter unknowns).
  pledgedMax?: number | null;
  // zzz362 — multi-select verdict filter. When a non-empty array, only entries
  // whose cbComputeQuality verdict label ∈ the array pass. Labels: STRONG BUY /
  // BUY / WATCH / AVOID / HIGH RISK. null = no filter.
  verdicts?: string[] | null;
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
  driftBucket: number | null;  // zzz245 — cumulative drift % filter
  // PATCH 1022/1024 — market-cap range filter (uses market_cap_cr in ₹ Cr).
  cap: 'all' | 'sweet' | 'mega' | 'large' | 'mid' | 'small' | 'micro';
};

const FILTER_DEFAULT: ConvFilters = { opLev: null, sales: null, pat: null, eps: null, pead: null, sortByPead: false, elite: false, multibagger: false, guidance: null, quarter: null, fy: null, fromDate: null, toDate: null, d1Bucket: null, d2Bucket: null, driftBucket: null, opmDelta: null, score: null, opmMin: null, peMax: null, freshBypass: false, mktCapMin: null, cfoPatMin: null, pledgedMax: null, verdicts: null /* zzz362 */, cap: 'all' };

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

// zzz362 — financials: CFO/PAT is meaningless for banks/NBFCs/lenders (their
// "cash from operations" mixes financing flows), so we exempt them from the
// CFO-based quality component / red flag / chips. Conservative detection:
// sector keyword OR company-name token match. Covers BF Investment,
// Cholamandalam Financial Holdings, Muthoot Microfin, Sundaram Finance,
// Paisalo Digital, Summit Securities, Vardhman Holdings, Dhunseri Investments,
// U.Y. Fincorp, etc.
function cbIsFinancial(e: any): boolean {
  // zzz364 (BUG 1) — base the sector test on resolveSector(e) (fallback to raw
  // e.sector) AND lower-case it, and broaden the keyword set so lenders whose
  // sector only resolves via NSE_SECTOR_MAP are caught (PAISALO etc). Company-
  // name regex now carries the `i` flag so lower-case variants match too.
  const sec = String(resolveSector(e) || e?.sector || '').toLowerCase();
  // zzz371 (audit) — the old bare `capital|housing|holding|amc` tokens exempted
  // "Capital Goods" industrials, Ashiana Housing, R-AMC-o Cements, and any
  // "Holdings" from every CFO/OPM signal (their trends went blank). Only treat
  // as financial when the token is a genuine financial phrase / word-anchored.
  if (/nbfc|bank|financ|finance|insurance|capital\s*market|housing\s*fin|holding\s*co|\bamc\b|asset\s*manag|securit|microfin|invit|reit|broking|mutual\s*fund|fincorp|investment\s*(co|trust|manag)/.test(sec)) return true;
  if (/^(capital goods|capital equipment|capital markets?\s*infra)/.test(sec)) return false; // explicit industrial carve-out
  const co = String(e?.company || '');
  if (/\b(Finance|Financial|Fincorp|Microfin|Housing Finance|Bank|Capital(?!\s*Goods)|Investments?\b|Holdings?\s*Ltd|Securities|AMC|Insurance|NBFC)\b/i.test(co)) return true;
  return false;
}

// zzz362 — extracted module-level pure earnings-quality helper. Behavior-
// preserving move of the zzz355 SCORES IIFE (incl. zzz357 ROCE weight +
// ROCE/ROE cap-at-55 + zzz357 absolute-P/E isOvervalued). Reused by the
// SCORES render AND the verdict filter gate below so the filter matches the
// rendered pill exactly. The only new behaviour vs the old inline code is the
// zzz362 financials exemption on the CFO/PAT component + CFO<0.5 red flag.
function cbComputeQuality(e: any): {
  qScore: number; qCol: string; bits: string[]; rf: number;
  verdictLabel: string; verdictIcon: string; verdictColor: string; verdictTip: string;
  isOvervalued: boolean; triLabel: string | null; triCol: string;
} {
  const cfo = e.cfo_to_pat_ratio;
  const opm = e.opm_pct, opmP = e.opm_prev_pct;
  const sales = e.sales_yoy_pct, pat = e.net_profit_yoy_pct, eps = e.eps_yoy_pct;
  const pe = e.pe;
  const drift = e.move_pct;
  const fin = cbIsFinancial(e); // zzz362 — financials: CFO/PAT not meaningful
  let q = 0; const bits: string[] = [];
  if (typeof cfo === 'number' && !fin) { // zzz362 — financials: CFO/PAT not meaningful
    if (cfo >= 1) { q += 30; bits.push('CFO/PAT ' + cfo.toFixed(2) + '→30'); }
    else if (cfo >= 0.8) { q += 25; bits.push('CFO/PAT ' + cfo.toFixed(2) + '→25'); }
    else if (cfo >= 0.5) { q += 15; bits.push('CFO/PAT ' + cfo.toFixed(2) + '→15'); }
    else bits.push('CFO/PAT ' + cfo.toFixed(2) + '→0');
  }
  if (typeof opm === 'number' && typeof opmP === 'number' && !fin) { // zzz364 (BUG 2a) — financials: OPM-Δ not meaningful for lenders
    const d = opm - opmP;
    if (d > 3) { q += 25; bits.push('OPM Δ +' + d.toFixed(1) + '→25'); }
    else if (d > 1) { q += 20; bits.push('OPM Δ +' + d.toFixed(1) + '→20'); }
    else if (d >= 0) { q += 10; bits.push('OPM Δ +' + d.toFixed(1) + '→10'); }
    else bits.push('OPM Δ ' + d.toFixed(1) + '→0');
  }
  if (typeof sales === 'number' && typeof pat === 'number' && sales > 3) { // zzz364 (BUG 3) — sales<=0 makes PAT/Sales op-leverage absurd; skip it
    const r = pat / sales;
    if (r >= 1 && r <= 2) { q += 20; bits.push('PAT/Sales ' + r.toFixed(1) + '×→20'); }
    else if (r > 2 && r <= 3) { q += 10; bits.push('PAT/Sales ' + r.toFixed(1) + '×→10'); }
    else if (r > 3) bits.push('PAT/Sales ' + r.toFixed(1) + '×→0(windfall)');
    else if (r > 0) { q += 15; bits.push('PAT/Sales ' + r.toFixed(1) + '×→15'); }
  }
  if (typeof eps === 'number' && typeof pat === 'number' && Math.abs(pat) > 5) {
    const gap = Math.abs(eps - pat);
    if (gap <= 10) { q += 15; bits.push('EPS-PAT gap ' + gap.toFixed(0) + '→15'); }
    else if (gap <= 30) { q += 8; bits.push('EPS-PAT gap ' + gap.toFixed(0) + '→8'); }
    else bits.push('EPS-PAT gap ' + gap.toFixed(0) + '→0');
  }
  if (typeof pe === 'number' && pe > 0 && typeof eps === 'number' && eps > 0) {
    const peg = pe / eps;
    if (peg < 1) { q += 10; bits.push('PEG ' + peg.toFixed(2) + '→10'); }
    else if (peg < 2) { q += 5; bits.push('PEG ' + peg.toFixed(2) + '→5'); }
  }
  // zzz357 — ROCE weight (0-20). Capital efficiency is the single best quality proxy.
  const roceQ = e.roce, roeQ = e.roe;
  if (typeof roceQ === 'number' && Number.isFinite(roceQ)) {
    if (roceQ >= 25) { q += 20; bits.push('ROCE ' + roceQ.toFixed(0) + '%→20'); }
    else if (roceQ >= 20) { q += 15; bits.push('ROCE ' + roceQ.toFixed(0) + '%→15'); }
    else if (roceQ >= 15) { q += 10; bits.push('ROCE ' + roceQ.toFixed(0) + '%→10'); }
    else { bits.push('ROCE ' + roceQ.toFixed(0) + '%→0'); }
  }
  let qScore = Math.min(100, Math.round(q));
  // zzz357 — weak capital efficiency caps quality at 55 regardless of accrual metrics.
  // Fixes BHAGCHEM (ROCE 4.5%) still showing QUALITY 75 off a strong CFO/OPM print.
  if ((typeof roceQ === 'number' && Number.isFinite(roceQ) && roceQ < 15)
      || (typeof roeQ === 'number' && Number.isFinite(roeQ) && roeQ < 10)) {
    qScore = Math.min(qScore, 55);
    bits.push('ROCE/ROE cap→55');
  }
  const qCol = qScore >= 75 ? '#22C55E' : qScore >= 60 ? '#84CC16' : qScore >= 40 ? '#F59E0B' : '#EF4444';

  // Growth triangulation - is growth coherent across the three metrics?
  let triLabel: string | null = null; let triCol = '';
  if (typeof sales === 'number' && typeof pat === 'number' && typeof eps === 'number'
      && sales > 10 && pat > 0 && eps > 0) {
    const salesOK = sales >= 15;
    const patStrong = pat >= sales;
    const epsCoherent = Math.abs(eps - pat) <= 25;
    if (salesOK && patStrong && epsCoherent) { triLabel = 'GROWTH TRIPLE ✓'; triCol = '#22C55E'; }
    else if (patStrong && !salesOK) { triLabel = 'MARGIN-LED'; triCol = '#F59E0B'; }
    else if (salesOK && !patStrong) { triLabel = 'VOLUME-ONLY'; triCol = '#F59E0B'; }
  }

  // zzz366 — "cash-confirmed": CFO/PAT >= 1.5 means the period's cash generation
  // EXCEEDS reported profit by 50%+, so a headline PAT spike is validated by real
  // cash, not an accrual mirage. The MARGIN-SPIKE red flag exists to catch profit
  // that ISN'T real; when cash confirms it, the flag is a false positive. Aegis
  // Logistics (CFO/PAT 3.72, OPM +16pp, ROE 16%, undervalued) was hitting exactly
  // 3 red flags — MARGIN-SPIKE + EPS≠PAT + MKT-DOUBT — and getting AVOID purely on
  // that count, despite the beat being fully cash-backed. Suppressing MARGIN-SPIKE
  // when cash-confirmed drops it to 2 flags → WATCH (fair: real but low-base).
  const cashConfirmed = typeof cfo === 'number' && cfo >= 1.5 && cfo <= 5 && !fin; // zzz371 — |ratio|>5 is an artifact band, not confirmation
  // Count red flags (mirrors the RED FLAGS render block)
  let rf = 0;
  if (typeof cfo === 'number' && cfo > 0 && cfo < 0.5 && !fin) rf++; // zzz362/zzz364 (BUG 6) — CASH-CONV only for genuine weak-but-positive; financials exempt
  if (typeof sales === 'number' && typeof pat === 'number' && sales > 5 && pat > 5 * sales && !cashConfirmed) rf++; // zzz366 — cash-confirmed beats don't count MARGIN-SPIKE
  if (typeof eps === 'number' && typeof pat === 'number' && Math.abs(pat) > 10 && Math.abs(eps - pat) > 30) rf++;
  if (typeof opm === 'number' && typeof opmP === 'number' && !fin && (opm - opmP) < -3) rf++; // zzz364 (BUG 2a) — financials: OPM-based signal not meaningful
  if (typeof drift === 'number' && drift < -5 && ['BLOCKBUSTER','ELITE','STRONG'].includes(String(e.tier || '').toUpperCase())) rf++;

  // zzz364 (BUG 7) — GROWTH TRIPLE ✓ must not be decoupled from cash. When the
  // print is non-financial AND cash conversion is soft (CFO/PAT < 0.8) or any
  // red flag is present, downgrade the green triple to an amber "cash?" caveat.
  if (triLabel === 'GROWTH TRIPLE ✓' && !fin && ((typeof cfo === 'number' && cfo < 0.8) || rf >= 1)) {
    triLabel = 'GROWTH TRIPLE (cash?)'; triCol = '#F59E0B';
  }

  // Overall verdict — combines Quality + valuation + risk
  const valPE = typeof pe === 'number' && pe > 0 ? pe : null;
  const valGrowth = typeof eps === 'number' ? eps : null;
  // zzz364 (BUG 4) — cap the growth denominator used for VALUATION at 100 so a
  // triple-digit base-effect EPS growth can't manufacture UNDERVALUED / cheap.
  const valGrowthCap = valGrowth != null ? Math.min(valGrowth, 100) : null;
  // zzz364 (BUG 5) — a business with negative ROCE destroys capital; never cheap.
  const roceVal = e.roce;
  const roceNeg = typeof roceVal === 'number' && roceVal < 0;
  const isOvervalued = (valPE != null && valPE > 100) /* zzz357 absolute ceiling */
    || (valPE != null && valGrowthCap != null && valGrowthCap > 0 && valPE > 2 * valGrowthCap);
  const isCheap = valPE != null && valGrowthCap != null && valGrowthCap > 0 && valPE < 0.5 * valGrowthCap && !roceNeg;
  const driftBad = typeof drift === 'number' && drift < -8;
  let verdict: {label: string; icon: string; color: string; tip: string};
  if (rf >= 3 || (typeof drift === 'number' && drift < -12) || (valGrowth != null && valGrowth <= 0)) {
    verdict = { label: 'AVOID', icon: '🚫', color: '#EF4444', tip: 'Multiple red flags OR sharp market disbelief OR negative EPS growth. Downside heavy.' };
  } else if (qScore >= 80 && !isOvervalued && rf <= 1 && !driftBad) {
    verdict = { label: 'STRONG BUY', icon: '🚀', color: '#22C55E', tip: 'Composite: high earnings quality (' + qScore + ') + reasonable valuation + no serious flags + no market disbelief. Institutional-grade setup.' };
  } else if (qScore >= 65 && rf <= 2 && !driftBad && !isOvervalued) { // zzz371 — BUY must not ignore the valuation gate STRONG BUY already applies
    verdict = { label: 'BUY', icon: '📈', color: '#84CC16', tip: 'Quality (' + qScore + ') solid, risk manageable. Position sizing at conviction.' };
  } else if (qScore >= 45 && rf <= 3) {
    verdict = { label: 'WATCH', icon: '👁', color: '#F59E0B', tip: 'Mixed signals — quality ' + qScore + '/100, ' + rf + ' red flags. Track catalyst/management commentary before sizing.' };
  } else {
    verdict = { label: 'HIGH RISK', icon: '⚠️', color: '#EF4444', tip: 'Weak composite — quality ' + qScore + ', ' + rf + ' red flags. High probability of downside surprise.' };
  }
  void isCheap; // zzz362 — preserved from original inline (computed, not used in the chain)

  return {
    qScore, qCol, bits, rf,
    verdictLabel: verdict.label, verdictIcon: verdict.icon, verdictColor: verdict.color, verdictTip: verdict.tip,
    isOvervalued, triLabel, triCol,
  };
}

function passesConvictionFilter(e: ConvictionEntry, f: ConvFilters): boolean {
  const sales = e.sales_yoy_pct ?? 0;
  const pat = e.net_profit_yoy_pct ?? 0;
  const eps = e.eps_yoy_pct ?? 0;
  // zzz340 FRESH-3D as POSITIVE filter (not bypass). When chip is ON, drop any entry NOT filed within last ~3 biz days (5 calendar days).
  // All other filters including CFO/PAT, PEAD, etc. apply strictly regardless.
  if (f.freshBypass) {
    const __fd = String((e as any).filing_date || '');
    if (!__fd) return false;
    const __ts = new Date(__fd + 'T00:00:00').getTime();
    const __d = Math.floor((Date.now() - __ts) / 86400000);
    if (__d < 0 || __d > 5) return false;
  }
  if (f.sales != null && sales < f.sales) return false;
  if (f.pat != null && pat < f.pat) return false;
  if (f.eps != null && eps < f.eps) return false;
  if (f.opLev != null && sales > 0) { // zzz364 (BUG 3) — sales<=0 makes the op-leverage ratio absurd; skip the gate for that entry
    const ratio = pat / sales;
    if (!(ratio >= f.opLev)) return false;
  }
  // zzz225 — composite tier score threshold (the card's big number)
  if (f.score != null && (e.composite_score ?? 0) < f.score) return false;
  // zzz226e — absolute OPM level threshold (latest quarter %)
  if (f.opmMin != null) {
    const o = (e as any).opm_pct;
    if (typeof o !== 'number' || o < f.opmMin) return false;
  }
  // zzz304 — minimum CFO/PAT ratio filter.
  // zzz359 (BUG 4) — NULL-SAFE. Q1 press releases rarely bundle a cash-flow
  // statement, so cfo_to_pat_ratio is legitimately null for ~40% of legit Q1
  // filings (Divgi TorqTransfer case). Treating null as fail silently dropped
  // them. Now only reject entries that HAVE a CFO/PAT number below the floor;
  // null passes through (the WC-STRETCH chip acts as the CFO proxy on the card).
  if (f.cfoPatMin != null) {
    // zzz364 (BUG 2d) — CFO/PAT is not meaningful for lenders/NBFCs, so the
    // cfoPatMin gate must not drop financials on a metric that doesn't apply.
    if (cbIsFinancial(e)) { /* skip cfoPatMin for financials */ }
    else {
      const c = (e as any).cfo_to_pat_ratio;
      if (typeof c === 'number' && c < f.cfoPatMin) return false;
    }
  }
  // zzz360 — max promoter-pledge % filter. Null pledged_pct passes (unknown ≠
  // fail — mirrors the zzz359 CFO/PAT null-safe philosophy). 0 = valid/good.
  if (f.pledgedMax != null) {
    const p = (e as any).pledged_pct;
    if (typeof p === 'number' && Number.isFinite(p) && p > f.pledgedMax) return false;
  }
  // zzz348 — minimum market cap filter (Cr)
  if (f.mktCapMin != null) {
    const mc = (e as any).market_cap_cr;
    if (typeof mc !== 'number' || mc < f.mktCapMin) return false;
  }
  // zzz329 — maximum trailing P/E filter (excludes negative-earnings tickers)
  if (f.peMax != null) {
    const p = (e as any).pe;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > f.peMax) return false;
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
  // zzz245 — DRIFT filter. Uses move_pct = cumulative % from filing anchor
  // to most recent close. Same positive/negative threshold convention as D1/D2.
  if (f.driftBucket != null && Number.isFinite(f.driftBucket)) {
    const m = (e as any).move_pct;
    if (typeof m !== 'number' || !Number.isFinite(m)) return false;
    if (f.driftBucket >= 0) {
      if (m < f.driftBucket) return false;
    } else {
      if (m > f.driftBucket) return false;
    }
  }
  // zzz362 — VERDICT filter (multi-select). Reuses cbComputeQuality so the gate
  // matches the rendered SCORES verdict pill exactly. Empty/null = no filter.
  if (f.verdicts && f.verdicts.length > 0) {
    const { verdictLabel } = cbComputeQuality(e);
    if (!f.verdicts.includes(verdictLabel)) return false;
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

// DRIFT — always-visible thesis-break tell. A BLOCKBUSTER/STRONG bench name
// whose post-print cumulative move (move_pct, already on the entry — no fetch
// needed) has faded materially (<= -12%) is the market flagging a low-quality
// beat: the earliest sell signal. Computed the same way for the row chip, the
// tab-header summary, and the Book Watch arming effect so they never disagree.
// move_pct is the primary field; it is server-computed from the filing anchor
// to the most-recent close, so no live-price fetch or reference is required.
function cbDriftState(e: ConvictionEntry): { drifting: boolean; movePct: number | null } {
  const tier = String(e?.tier || '').toUpperCase();
  const tierMatch = tier === 'BLOCKBUSTER' || tier === 'STRONG';
  const m = typeof e?.move_pct === 'number' && Number.isFinite(e.move_pct) ? (e.move_pct as number) : null;
  return { drifting: tierMatch && m != null && m <= -12, movePct: m };
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
  // zzz246 — auto-apply Quality Preset v2 on first mount unless user opted out.
  // Runs once client-side. If localStorage says "optout=1", we respect that
  // and leave FILTER_DEFAULT (all null). Otherwise we set the preset values.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // zzz366 — optout key bumped v2->v3. The preset meaning changed (verdicts now
      // default to STRONG BUY + BUY + WATCH), so a stale v2 opt-out must NOT suppress
      // the new default. A fresh v3 key means every user gets the new preset auto-ON
      // once; they can still opt out again (which sets v3) and that choice sticks.
      const optOut = localStorage.getItem('mc:cb:preset:v3:optout') === '1';
      if (optOut) return;
      // Only apply if filters are still at their FILTER_DEFAULT initial state.
      // (Avoids clobbering filters restored from a saved view later.)
      setFilters((prev) => (
        prev.sales == null && prev.eps == null && prev.pead == null && prev.opmDelta == null && prev.cfoPatMin == null && prev.mktCapMin == null && prev.verdicts == null /* zzz362 */
          ? { ...prev, sales: 20, eps: 25, pead: 60, opmDelta: 0, cfoPatMin: 0.5, mktCapMin: 3000, pledgedMax: 0 /* zzz360 */, verdicts: ['STRONG BUY', 'BUY', 'WATCH'] /* zzz366 — user: preset auto-ON with SB+BUY+WATCH */ }
          : prev
      ));
    } catch {}
  }, []);
  // zzz226 — detail filter chips are hidden by default; the ⚡ preset button
  // applies the user's standard screen without opening them.
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  // PATCH 1019 — Re-validate bench. Re-fetches graded for every unique
  // filing date on the bench and re-syncs (all tiers) so any stock that
  // dropped out of BLOCKBUSTER/STRONG under the current grading logic
  // (e.g. ADSL after the turnaround gate) gets pruned automatically.
  const [revalidating, setRevalidating] = useState(false);
  // zzz236 — Auto-enrich entries lacking d2_pct/move_pct. Runs once on mount.
  // Fires the enrich API for stale entries (added before zzz230/231) so d2/move
  // fields populate without user needing to click Re-validate.
  // zzz373 — the walk is now a reusable function so the "⟳ Fill missing" button
  // can run it on demand (manual=true → ignore attempt bound, force nocache, report
  // progress). The mount effect below calls it once with manual=false.
  const [fillProgress, setFillProgress] = useState<string | null>(null);
  const fillRunningRef = useRef(false);
  const runEnrichWalk = useCallback(async (manual: boolean) => {
    if (typeof window === 'undefined') return;
    // zzz374 — a manual click must ALWAYS give feedback. Previously, if the
    // mount auto-walk was still in flight (fillRunningRef true), the click
    // returned silently and the user saw "nothing happened". Now: manual
    // clicks show an immediate status, and if a walk is already running they
    // say so instead of no-op'ing.
    if (fillRunningRef.current) {
      if (manual) { setFillProgress('⏳ A fill pass is already running — watch the counter, or try again once it finishes.'); setTimeout(() => setFillProgress(null), 6000); }
      return;
    }
    setFillProgress(manual ? 'Scanning bench for missing data…' : 'Auto-filling missing data…');
    fillRunningRef.current = true;
    const list = getConvictionList();
    let done = 0, total = 0;
    // zzz375 — report for BOTH manual and the mount auto-walk so a background
    // fill is visible (the user pressed nothing but sees "Auto-filling 8/40…"
    // rather than a dead page). Background runs clear their own status when done.
    const report = (msg: string) => setFillProgress(manual ? msg : `⟳ ${msg}`);
    // zzz244/248/255 — broaden auto-enrich gate. Fire whenever ANY expected field
    // is missing (move_pct, d2, pe, close_30d, roce). This includes new institutional
    // fields added in zzz254 so existing entries backfill on next page load.
    // zzz369 — a bench entry can be stamped cb_enrich_v=367 yet still lack the
    // quarterly trend series, because on the fetch that stamped it the server had a
    // transient Screener miss for that symbol (cache poisoning). Keep re-enriching
    // such entries (non-financial, bounded to 6 attempts so we never loop forever on
    // symbols Screener genuinely can't parse) until the trends actually arrive. The
    // server now short-TTLs the trend-less cache, so each retry has a fresh chance.
    const needsTrends = (e: any): boolean => {
      if (cbIsFinancial(e)) return false; // financials: OPM/tax trends not meaningful
      const hasTrend = Array.isArray(e.quarters_opm) || Array.isArray(e.quarters_tax_pct)
        || Array.isArray(e.quarters_other_income_pct) || Array.isArray(e.annual_cfo_pat);
      return !hasTrend && (manual || (e.cb_trend_attempts || 0) < 6);
    };
    const stale = list.filter(e =>
      e.ticker && e.filing_date &&
      (typeof (e as any).move_pct !== 'number'
        || typeof (e as any).d2_pct !== 'number'
        || typeof (e as any).pe !== 'number'
        || typeof (e as any).roce !== 'number'  // zzz255
        || (e as any).cb_enrich_v !== 377  // zzz377 (was 375) — re-enrich once so worker-sourced Q-TRENDS land (Screener direct scrape is IP-blocked on Railway). zzz375 (was 371) — re-enrich once so the Screener standalone-page fallback fills names that only had /consolidated/ misses. zzz372 (was 369) — one-time re-enrich so zzz371 CFO/PAT value fixes propagate. zzz367 — one-time re-enrich (v11 cache: trends now extracted on the proven fetchScreenerCFO path, which actually works in prod)
        || needsTrends(e)  // zzz369 — keep retrying until the trend series lands
        || !Array.isArray((e as any).close_30d)
        || (e as any).close_30d.length < 2)
    );
    if (stale.length === 0) { fillRunningRef.current = false; if (manual) { setFillProgress('✓ Nothing missing — every card already has trends / P/E / DRIFT (or is a financial).'); setTimeout(() => setFillProgress(null), 8000); } else { setFillProgress(null); } return; }
    total = stale.length;
    report(`Filling 0/${total}…`);
    // zzz370 — walk is a reusable pass so we can run a RETRY SWEEP after the first
    // full walk. `retry=true` adds nocache=1 so a symbol whose first fetch hit a
    // transient Screener miss (and got a short-TTL trend-less payload cached) is
    // re-scraped fresh instead of being served the same empty result again.
    const runPass = async (targets: typeof stale, retry: boolean) => {
      // Batch by filing_date so we can pass filedHint per group
      const byDate = new Map<string, string[]>();
      for (const e of targets) {
        const arr = byDate.get(e.filing_date!) || [];
        arr.push(e.ticker!);
        byDate.set(e.filing_date!, arr);
      }
      for (const [dt, tickers] of byDate) {
        // zzz369 — chunk into small batches of 8 so the server can live-scrape
        // Screener for each symbol WITHIN its function timeout. A 30-symbol batch was
        // timing out server-side and returning nothing, so the trend series never got
        // persisted onto the bench (the real reason cards showed no Q-TRENDS even when
        // the single-symbol API had them). Also processes EVERY ticker for the date
        // instead of silently dropping everything past the first 30.
        for (let ci = 0; ci < tickers.length; ci += 8) {
          const chunk = tickers.slice(ci, ci + 8);
          try {
          const url = `/api/v1/earnings/enrich?symbols=${chunk.join(',')}&filed=${dt}${retry ? '&nocache=1' : ''}`;
          // zzz372 — a failed/timed-out batch used to be SKIPPED, leaving every symbol in
          // the chunk without P/E, DRIFT, ROCE (the "P/E vanished on many cards" symptom,
          // clustered by chunk/date). Now: fall back to per-symbol fetches so one slow
          // Screener scrape can't blank seven neighbours.
          let data: Record<string, any> = {};
          let batchOk = false;
          try {
            const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
            if (res.ok) { const j = await res.json(); data = j?.data || {}; batchOk = true; }
          } catch {}
          if (!batchOk || chunk.some(sym => !data[sym])) {
            for (const sym of chunk) {
              if (data[sym]) continue;
              try {
                const r1 = await fetch(`/api/v1/earnings/enrich?symbols=${sym}&filed=${dt}${retry ? '&nocache=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
                if (r1.ok) { const j1 = await r1.json(); if (j1?.data?.[sym]) data[sym] = j1.data[sym]; }
              } catch {}
              await new Promise(r => setTimeout(r, 150));
            }
          }
          const syncEntries: any[] = [];
          for (const sym of chunk) {
            const enr = data[sym];
            if (!enr) continue;
            // zzz371 — read the CURRENT bench entry, not the mount-time `list` snapshot.
            // Pass 1 mutates the bench (stamps cb_enrich_v / cb_trend_attempts); if pass 2
            // read the stale snapshot, cb_trend_attempts would never advance and the
            // 6-attempt retry bound could never be consumed.
            const existing = getConvictionList().find(e => e.ticker === sym) || list.find(e => e.ticker === sym);
            if (!existing) continue;
            syncEntries.push({
              ticker: sym,
              company: existing.company,
              tier: existing.tier,
              filing_date: existing.filing_date,
              // Only fields we want to update:
              d1_pct: typeof enr.d1_pct === 'number' ? enr.d1_pct : (existing as any).d1_pct,
              gap_pct: typeof enr.gap_pct === 'number' ? enr.gap_pct : (existing as any).gap_pct,
              // zzz372 — never null-out drift on a partial/nocache response; keep what we have.
              d2_pct: typeof enr.d2_pct === 'number' ? enr.d2_pct : (existing as any).d2_pct,
              move_pct: typeof enr.move_pct === 'number' ? enr.move_pct : (existing as any).move_pct,
              opm_pct: typeof enr.opm_pct === 'number' ? enr.opm_pct : (existing as any).opm_pct,
              opm_prev_pct: typeof enr.opm_prev_pct === 'number' ? enr.opm_prev_pct : (existing as any).opm_prev_pct,
              // zzz242 — pull trailing P/E from enrich response (fallback to stockPE)
              pe: typeof enr.pe === 'number' ? enr.pe : (typeof enr.stockPE === 'number' ? enr.stockPE : (existing as any).pe),
              // zzz248 — carry 30-day close series for sparkline
              close_30d: Array.isArray(enr.close_30d) && enr.close_30d.length >= 2 ? enr.close_30d : (existing as any).close_30d,
              // zzz254 — institutional quality fields (all optional; carry from Screener/Yahoo)
              roce: typeof enr.roce === 'number' ? enr.roce : (existing as any).roce,
              roe: typeof enr.roe === 'number' ? enr.roe : (existing as any).roe,
              debtToEquity: typeof enr.debtToEquity === 'number' ? enr.debtToEquity : ((existing as any).debtToEquity ?? (existing as any).debt_to_equity),
              rs_rating: typeof enr.rs_rating === 'number' ? enr.rs_rating : (existing as any).rs_rating,
              ocf_to_pat_ratio: typeof enr.ocf_to_pat_ratio === 'number' ? enr.ocf_to_pat_ratio : (existing as any).ocf_to_pat_ratio,
              // zzz361 — carry full institutional field set onto bench
              quarters_sales: Array.isArray(enr.quarters_sales) ? enr.quarters_sales : (existing as any).quarters_sales,
              quarters_eps: Array.isArray(enr.quarters_eps) ? enr.quarters_eps : (existing as any).quarters_eps,
              quarters_opm: Array.isArray(enr.quarters_opm) ? enr.quarters_opm : (existing as any).quarters_opm,
              quarters_material_cost_pct: Array.isArray(enr.quarters_material_cost_pct) ? enr.quarters_material_cost_pct : (existing as any).quarters_material_cost_pct,
              quarters_other_income_pct: Array.isArray(enr.quarters_other_income_pct) ? enr.quarters_other_income_pct : (existing as any).quarters_other_income_pct,
              quarters_tax_pct: Array.isArray(enr.quarters_tax_pct) ? enr.quarters_tax_pct : (existing as any).quarters_tax_pct,
              annual_cfo_pat: Array.isArray(enr.annual_cfo_pat) ? enr.annual_cfo_pat : (existing as any).annual_cfo_pat,
              ebitda_margin_pct: typeof enr.ebitda_margin_pct === 'number' ? enr.ebitda_margin_pct : (existing as any).ebitda_margin_pct,
              receivables_yoy_pct: typeof enr.receivables_yoy_pct === 'number' ? enr.receivables_yoy_pct : (existing as any).receivables_yoy_pct,
              inventory_yoy_pct: typeof enr.inventory_yoy_pct === 'number' ? enr.inventory_yoy_pct : (existing as any).inventory_yoy_pct,
              avg_vol_20d: typeof enr.avg_vol_20d === 'number' ? enr.avg_vol_20d : (existing as any).avg_vol_20d,
              vol_ratio_20d: typeof enr.vol_ratio_20d === 'number' ? enr.vol_ratio_20d : (existing as any).vol_ratio_20d,
              dist_52w_pct_yahoo: typeof enr.dist_52w_pct_yahoo === 'number' ? enr.dist_52w_pct_yahoo : (existing as any).dist_52w_pct_yahoo,
              pledged_pct: typeof enr.pledged_pct === 'number' ? enr.pledged_pct : (existing as any).pledged_pct,
              roic: typeof enr.roic === 'number' ? enr.roic : (existing as any).roic,
              int_coverage: typeof enr.int_coverage === 'number' ? enr.int_coverage : (existing as any).int_coverage,
              debtor_days: typeof enr.debtor_days === 'number' ? enr.debtor_days : (existing as any).debtor_days,
              inventory_days: typeof enr.inventory_days === 'number' ? enr.inventory_days : (existing as any).inventory_days,
              wc_days: typeof enr.wc_days === 'number' ? enr.wc_days : (existing as any).wc_days,
              pat_margin_curr: typeof enr.pat_margin_curr === 'number' ? enr.pat_margin_curr : (existing as any).pat_margin_curr,
              pat_margin_prev: typeof enr.pat_margin_prev === 'number' ? enr.pat_margin_prev : (existing as any).pat_margin_prev,
              other_income_pct_sales_curr: typeof enr.other_income_pct_sales_curr === 'number' ? enr.other_income_pct_sales_curr : (existing as any).other_income_pct_sales_curr,
              other_income_pct_sales_prev: typeof enr.other_income_pct_sales_prev === 'number' ? enr.other_income_pct_sales_prev : (existing as any).other_income_pct_sales_prev,
              effective_tax_rate_curr: typeof enr.effective_tax_rate_curr === 'number' ? enr.effective_tax_rate_curr : (existing as any).effective_tax_rate_curr,
              effective_tax_rate_prev: typeof enr.effective_tax_rate_prev === 'number' ? enr.effective_tax_rate_prev : (existing as any).effective_tax_rate_prev,
              dep_yoy_pct: typeof enr.dep_yoy_pct === 'number' ? enr.dep_yoy_pct : (existing as any).dep_yoy_pct,
              finance_cost_curr_cr: typeof enr.finance_cost_curr_cr === 'number' ? enr.finance_cost_curr_cr : (existing as any).finance_cost_curr_cr,
              ebit_curr_cr: typeof enr.ebit_curr_cr === 'number' ? enr.ebit_curr_cr : (existing as any).ebit_curr_cr,
              ebit_yoy_pct: typeof enr.ebit_yoy_pct === 'number' ? enr.ebit_yoy_pct : (existing as any).ebit_yoy_pct,
              ebitda_curr_cr: typeof enr.ebitda_curr_cr === 'number' ? enr.ebitda_curr_cr : (existing as any).ebitda_curr_cr,
              ebitda_yoy_pct: typeof enr.ebitda_yoy_pct === 'number' ? enr.ebitda_yoy_pct : (existing as any).ebitda_yoy_pct,
              // zzz363 — one-off / exceptional-item fields (v9 cache)
              exceptional_curr_cr: typeof enr.exceptional_curr_cr === 'number' ? enr.exceptional_curr_cr : (existing as any).exceptional_curr_cr,
              exceptional_pct_pbt: typeof enr.exceptional_pct_pbt === 'number' ? enr.exceptional_pct_pbt : (existing as any).exceptional_pct_pbt,
              cb_enrich_v: 377,  // zzz377 — bump (was 375) so re-enrich fires once for the v13 cache. zzz369 — bump so re-enrich fires once for v11 cache (trends on proven CFO path)
              // zzz369 — count trend-fetch attempts so needsTrends() retry is bounded.
              cb_trend_attempts: ((existing as any).cb_trend_attempts || 0) + 1,
              // zzz376 — carry the server's reason so the card can say "genuinely
              // absent" vs "fetch failed (transient)". Overwrite each pass.
              _trends_status: typeof enr._trends_status === 'string' ? enr._trends_status : (existing as any)._trends_status,
            });
          }
          if (syncEntries.length > 0) syncFromEarningsOps(syncEntries);
          done += chunk.length;
          report(`Filling ${Math.min(done, total)}/${total} · ${chunk.join(', ')}`);
          // zzz372 — syncFromEarningsOps null-fills only (by design, so stale graded
          // payloads can't clobber data). But THIS walk carries LIVE values, and some
          // must OVERWRITE: the zzz371 CFO/PAT alignment fix (KMEW 1.17 → 0.62),
          // fresh drift/P/E after a re-enrich, corrected ROCE/ROE. Patch those in.
          if (syncEntries.length > 0) {
            const live = syncEntries.map(se => {
              const enr = data[se.ticker] || {};
              const n = (v: any) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
              return {
                ticker: se.ticker,
                move_pct: n(enr.move_pct), d2_pct: n(enr.d2_pct), d1_pct: n(enr.d1_pct), gap_pct: n(enr.gap_pct),
                pe: n(enr.pe) ?? n(enr.stockPE),
                roce: n(enr.roce), roe: n(enr.roe), debtToEquity: n(enr.debtToEquity),
                cfo_to_pat_ratio: n(enr.ocf_to_pat_ratio), ocf_to_pat_ratio: n(enr.ocf_to_pat_ratio),
                close_30d: Array.isArray(enr.close_30d) && enr.close_30d.length >= 2 ? enr.close_30d : null,
                other_income_pct_sales_curr: n(enr.other_income_pct_sales_curr), other_income_pct_sales_prev: n(enr.other_income_pct_sales_prev),
                effective_tax_rate_curr: n(enr.effective_tax_rate_curr), effective_tax_rate_prev: n(enr.effective_tax_rate_prev),
                roic: n(enr.roic), pledged_pct: n(enr.pledged_pct),
              };
            });
            try { patchConvictionEntries(live); } catch {}
          }
          } catch {}
          // Throttle between chunks
          await new Promise(r => setTimeout(r, 300));
        }
      }
    };
    try {
      // Pass 1 — everything the gate flagged. Manual runs go straight to nocache=1
      // (the user is asking for a FRESH scrape, not a cache replay).
      await runPass(stale, manual);
      // zzz370 — Pass 2: RETRY SWEEP. Re-read the bench (pass 1 mutated it) and
      // re-fetch, with nocache=1, only the non-financial entries that STILL lack a
      // trend series. Fixes the "only some populating" symptom: well-covered names
      // (NAVINFLUOR / DIVISLAB / DEEPAKNTR ...) whose single first attempt hit a
      // transient Screener miss now get a fresh live scrape in the same session
      // instead of waiting for the next page load. Bounded by cb_trend_attempts.
      await new Promise(r => setTimeout(r, 1500));
      const again = getConvictionList().filter(e => e.ticker && e.filing_date && needsTrends(e));
      if (again.length > 0) { done = 0; total = again.length; report(`Retry sweep 0/${total}…`); await runPass(again, true); }
      if (manual) {
        const stillMissing = getConvictionList().filter(e => e.ticker && e.filing_date && needsTrends(e)).length;
        setFillProgress(stillMissing === 0
          ? `✓ Done — all ${stale.length} entries filled.`
          : `✓ Done — ${stale.length - stillMissing} filled · ${stillMissing} still without trends (Screener has no parsable quarterly table for them, or it is a financial). Re-run later to retry.`);
        setTimeout(() => setFillProgress(null), 15_000);
      } else {
        // Background walk finished — clear the "Auto-filling…" indicator.
        setFillProgress(null);
      }
    } finally { fillRunningRef.current = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { runEnrichWalk(false); }, [runEnrichWalk]);

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
          // zzz306 — force fresh grade for the LAST 3 dates so cfo_to_pat_ratio (added in
          // zzz304a) actually populates cached payloads that were built before it. Older
          // dates use existing cache to keep the rebuild cheap.
          const _force = i < 3 ? '&force=1' : '';
          const res = await fetch(`/api/v1/earnings/graded?date=${d}${_force}`, { cache: 'no-store' });
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
                // zzz236 — carry d2_pct + move_pct from graded response into bench entry.
                // Previously dropped — that's why 2D chip stayed at ⏳ even after backend enrich shipped.
                d2_pct: typeof c.d2_pct === 'number' ? c.d2_pct : null,
                move_pct: typeof c.move_pct === 'number' ? c.move_pct : null,
                is_elite: c.is_elite === true,
                pead_score: typeof c.pead_score === 'number' ? c.pead_score : null,
                multibagger_setup: c.multibagger_setup === true,
                // zzz223 — OPM margin for the CB tab
                opm_pct: typeof c.opm_pct === 'number' ? c.opm_pct : null,
                opm_prev_pct: typeof c.opm_prev_pct === 'number' ? c.opm_prev_pct : null,
                // zzz242 — carry trailing P/E for valuation chip
                pe: typeof c.pe === 'number' ? c.pe : null,
                // zzz306 — carry CFO/PAT so bench cards can render the earnings-quality chip.
                cfo_to_pat_ratio: typeof c.cfo_to_pat_ratio === 'number' ? c.cfo_to_pat_ratio : null,
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
                // zzz236 — carry d2_pct + move_pct from graded response into bench entry.
                // Previously dropped — that's why 2D chip stayed at ⏳ even after backend enrich shipped.
                d2_pct: typeof c.d2_pct === 'number' ? c.d2_pct : null,
                move_pct: typeof c.move_pct === 'number' ? c.move_pct : null,
                is_elite: c.is_elite === true,
                pead_score: typeof c.pead_score === 'number' ? c.pead_score : null,
                multibagger_setup: c.multibagger_setup === true,
                opm_pct: typeof c.opm_pct === 'number' ? c.opm_pct : null,
                opm_prev_pct: typeof c.opm_prev_pct === 'number' ? c.opm_prev_pct : null,
                // zzz242 — carry trailing P/E for valuation chip
                pe: typeof c.pe === 'number' ? c.pe : null,
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
  // every page load — coerce to 'compact' and drop the key.
  const viewMode: 'compact' = 'compact';
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.removeItem('mc:conviction-view'); } catch {}
  }, []);
  // zzz247 — Card vs Table view toggle. Persisted in localStorage. Table view
  // shows sortable columns for institutional-analyst scanning of 42+ rows.
  const [tableMode, setTableMode] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { setTableMode(localStorage.getItem('mc:cb:table') === '1'); } catch {}
  }, []);
  const toggleTable = () => {
    setTableMode((v) => {
      const nv = !v;
      try { localStorage.setItem('mc:cb:table', nv ? '1' : '0'); } catch {}
      return nv;
    });
  };
  const [tableSort, setTableSort] = useState<{col: string; dir: 'asc'|'desc'}>({col: 'pead', dir: 'desc'});
  // zzz254 — density toggle: comfy (default) | compact | ultra
  const [density, setDensity] = useState<'comfy'|'compact'|'ultra'>('comfy');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const d = localStorage.getItem('mc:cb:density');
      if (d === 'compact' || d === 'ultra' || d === 'comfy') setDensity(d);
    } catch {}
  }, []);
  const cycleDensity = () => {
    const next = density === 'comfy' ? 'compact' : density === 'compact' ? 'ultra' : 'comfy';
    setDensity(next);
    try { localStorage.setItem('mc:cb:density', next); } catch {}
  };
  // zzz252 — expose entries + sector median P/E on window so ConvictionRow can
  // access peer stats without threading them through props. Rerun whenever the
  // entries list changes (add/remove/re-enrich). Moved out of JSX to avoid the
  // ternary syntax error that killed zzz251's build.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__cbAllEntries = entries;
    const bySec = new Map<string, number[]>();
    for (const e of entries) {
      const sec = resolveSector(e);
      if (sec && typeof (e as any).pe === 'number' && Number.isFinite((e as any).pe) && (e as any).pe > 0) {
        const arr = bySec.get(sec) || [];
        arr.push((e as any).pe);
        bySec.set(sec, arr);
      }
    }
    const medMap: Record<string, number> = {};
    for (const [sec, vals] of bySec) {
      if (vals.length < 2) continue;
      const s = [...vals].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      medMap[sec] = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    (window as any).__cbSectorPeMed = medMap;
  }, [entries]);

  // zzz250 — Full institutional Excel export. Uses SheetJS (already bundled).
  // Native .xlsx binary format — Mac Excel + Numbers + Windows Excel all open cleanly.
  // Includes freeze-header + auto-filter for immediate scan usability.
  // zzz253 — force re-enrichment: clear stale price fields for every entry, then
  // rely on the useEffect auto-enrich to re-fetch. Also invalidates the KV cache
  // by sending nocache=1 in the first fetch.
  const handleRefreshPrices = () => {
    if (typeof window === 'undefined') return;
    const list = getConvictionList();
    if (list.length === 0) { alert('No entries to refresh.'); return; }
    // Read current store, clear price fields for all entries, write back.
    try {
      const raw = localStorage.getItem('mc:conviction-beats:v1');
      const store: any = raw ? JSON.parse(raw) : {};
      let cleared = 0;
      for (const key of Object.keys(store)) {
        const e = store[key];
        if (!e) continue;
        // Clear only price-related fields, keep fundamentals intact
        delete e.move_pct;
        delete e.d2_pct;
        delete e.pe;
        cleared++;
      }
      localStorage.setItem('mc:conviction-beats:v1', JSON.stringify(store));
      alert(`Cleared ${cleared} entries. Reloading to trigger fresh enrichment...`);
      window.location.reload();
    } catch (e) { alert('Refresh failed: ' + String(e)); }
  };
  const handleExportFullExcel = async () => {
    if (typeof window === 'undefined') return;
    const list = filteredEntries;
    if (list.length === 0) { alert('No entries to export. Adjust filters.'); return; }
    const XLSX = await import('xlsx');
    const now = new Date();
    const daysSince = (iso?: string, added?: string) => {
      const s = added || iso;
      if (!s) return null;
      const t = Date.parse(s.length === 10 ? s + 'T09:30:00+05:30' : s);
      return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 86400000)) : null;
    };
    const header = [
      '#','Tier','Ticker','Company','Filed Date','Days Since','Sector','Market Cap (Cr)',
      'Composite','PEAD','Sales YoY %','PAT YoY %','EPS YoY %','OPM %','OPM prev %','OPM Δ (pp)',
      'P/E','Gap %','D1 %','D2 %','DRIFT %','Guidance','Guidance Score','Filing URL'
    ];
    const rows: any[][] = [header];
    list.forEach((e: any, i: number) => {
      const p = peadScore(e).score;
      const omP = e.opm_pct, omPr = e.opm_prev_pct;
      const opmD = (typeof omP === 'number' && typeof omPr === 'number') ? +(omP - omPr).toFixed(2) : '';
      rows.push([
        i + 1,
        e.tier || '',
        e.ticker || '',
        e.company || '',
        e.filing_date || '',
        daysSince(e.filing_date, e.added_at) ?? '',
        e.sector || '',
        typeof e.market_cap_cr === 'number' ? Math.round(e.market_cap_cr) : '',
        typeof e.composite_score === 'number' ? e.composite_score : '',
        p,
        typeof e.sales_yoy_pct === 'number' ? +e.sales_yoy_pct.toFixed(2) : '',
        typeof e.net_profit_yoy_pct === 'number' ? +e.net_profit_yoy_pct.toFixed(2) : '',
        typeof e.eps_yoy_pct === 'number' ? +e.eps_yoy_pct.toFixed(2) : '',
        typeof omP === 'number' ? +omP.toFixed(2) : '',
        typeof omPr === 'number' ? +omPr.toFixed(2) : '',
        opmD,
        typeof e.pe === 'number' ? +e.pe.toFixed(2) : '',
        typeof e.gap_pct === 'number' ? +e.gap_pct.toFixed(2) : '',
        typeof e.d1_pct === 'number' ? +e.d1_pct.toFixed(2) : '',
        typeof e.d2_pct === 'number' ? +e.d2_pct.toFixed(2) : '',
        typeof e.move_pct === 'number' ? +e.move_pct.toFixed(2) : '',
        e.guidance || '',
        typeof e.guidance_score === 'number' ? +e.guidance_score.toFixed(2) : '',
        e.source_url || '',
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      {wch:4},{wch:12},{wch:12},{wch:32},{wch:11},{wch:11},{wch:16},{wch:14},
      {wch:9},{wch:6},{wch:11},{wch:11},{wch:11},{wch:8},{wch:11},{wch:10},
      {wch:8},{wch:8},{wch:8},{wch:8},{wch:9},{wch:11},{wch:14},{wch:60}
    ];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: {r:0,c:0}, e: {r:rows.length-1,c:header.length-1} }) };
    (ws as any)['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Conviction Beats');
    const fname = `conviction-beats_${now.toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fname);
  };
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

  // DRIFT → Book Watch. For every BLOCKBUSTER/STRONG bench name that has faded
  // materially since its print (cbDriftState), arm a BENCH_DRIFT flag so the
  // signal is pushed into Book Watch / the alert feed instead of only living on
  // this page. armBookFlag() self-dedups by kind+ticker+day and is a no-op
  // server-side, so this is safe to run on every bench/price change. Only
  // drifting BLOCKBUSTER/STRONG rows are armed — never every row.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    for (const e of entries) {
      const { drifting, movePct } = cbDriftState(e);
      if (!drifting || movePct == null) continue;
      const sym = e.ticker;
      armBookFlag({
        kind: 'BENCH_DRIFT', ticker: sym, company: e.company,
        severity: movePct <= -20 ? 'critical' : 'warning',
        message: `${sym} (${e.tier} bench) fading ${movePct.toFixed(1)}% since its print — the market is questioning the beat`,
        detail: 'conviction bench',
      });
    }
  }, [entries]);

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

  // zzz362/zzz364 — verdict tally across the currently-loaded bench, for the
  // VERDICT multi-select chip counts. zzz364 FIX: this sits AFTER conditional
  // early-returns in the component, so it MUST NOT be a hook (useMemo here
  // caused React #310 "rendered more hooks than previous render"). Plain const
  // recomputed each render — cheap, same cost as countWith which also scans.
  const verdictCounts: Record<string, number> = (() => {
    const m: Record<string, number> = { 'STRONG BUY': 0, 'BUY': 0, 'WATCH': 0, 'AVOID': 0, 'HIGH RISK': 0 };
    for (const e of entries) {
      const { verdictLabel } = cbComputeQuality(e);
      if (m[verdictLabel] != null) m[verdictLabel]++;
    }
    return m;
  })();

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
            {/* Always-visible DRIFT summary — count of BLOCKBUSTER/STRONG bench
                names fading <= -12% since their print. Independent of any filter
                toggle; also armed to Book Watch as BENCH_DRIFT. */}
            {(() => {
              const n = entries.filter((e) => cbDriftState(e).drifting).length;
              if (n === 0) return null;
              return (
                <span
                  title="BLOCKBUSTER/STRONG bench names fading ≤ -12% since their print — the earliest sell tell. Each is armed to Book Watch as a BENCH_DRIFT flag."
                  style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, cursor: 'help',
                    background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.4)',
                  }}
                >⚠ {n} bench drifting</span>
              );
            })()}
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
            {/* zzz247 — Table view toggle for institutional scanning */}
            <button onClick={toggleTable} title="Toggle between Card and Table view. Table view supports sortable columns."
              style={tableMode ? chipActive('#F59E0B') : chipBase}>
              {tableMode ? '📇 Card view' : '📊 Table view'}
            </button>
            {/* zzz250 — Full institutional Excel export. Every column, native .xlsx (Mac-safe). */}
            <button onClick={handleExportFullExcel} title="Download all filtered entries with every column (Sales/PAT/EPS/OPM/P/E/D1/D2/DRIFT/MktCap/Sector/Composite/PEAD/Days-Since/Guidance) as native .xlsx. Opens in Excel/Numbers on Mac + Windows."
              style={{ ...chipBase, border: '1px solid #10B981', color: '#10B981', fontWeight: 800 }}>
              📥 Excel (Full)
            </button>
            {/* zzz253 — force re-enrichment. Clears stale price fields + re-fetches. */}
            <button onClick={handleRefreshPrices} title="Force re-fetch of all price data (D1/D2/DRIFT/P/E) for every bench entry. Use when data feels stale — typically after market close."
              style={{ ...chipBase, border: '1px solid #22D3EE', color: '#22D3EE', fontWeight: 800 }}>
              🔄 Refresh Prices
            </button>
            {(() => {
              const busy = !!fillProgress && !fillProgress.startsWith('✓') && !fillProgress.startsWith('⏳');
              return (
                <button onClick={() => runEnrichWalk(true)}
                  title="Fill whatever is missing on the cards — Q-TRENDS (OPM / Other-Income / Tax / CFO-PAT annual), QoQ ACCEL, P/E, DRIFT, ROCE. Only touches entries that lack data; entries that already have it are left alone. Forces a fresh Screener scrape (bypasses cache)."
                  style={busy
                    ? { ...chipActive('#A78BFA'), fontWeight: 800 }
                    : { ...chipBase, border: '1px solid #A78BFA', color: '#A78BFA', fontWeight: 700 }}>
                  {busy ? '⟳ Filling…' : '⟳ Fill missing (trends · P/E · DRIFT)'}
                </button>
              );
            })()}
            {/* zzz254 — density toggle */}
            <button onClick={cycleDensity} title="Cycle card density: Comfy (default) → Compact → Ultra-compact. Persists across visits."
              style={{ ...chipBase, border: '1px solid #A78BFA', color: '#A78BFA', fontWeight: 800 }}>
              {density === 'comfy' ? '🔳 Comfy' : density === 'compact' ? '▦ Compact' : '▬ Ultra'}
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
            {fillProgress && (
              <span style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 4, background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.35)', color: '#A78BFA', fontWeight: 600 }}>{fillProgress}</span>
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
              disabled={filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && filters.quarter == null && filters.fy == null && filters.fromDate == null && filters.toDate == null && filters.d1Bucket == null && filters.d2Bucket == null && filters.driftBucket == null && filters.opmDelta == null && filters.score == null && filters.opmMin == null && !filters.sortByPead && !filters.elite && !filters.multibagger && filters.cap === 'all'}
              style={{ ...chipBase, opacity: (filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && filters.quarter == null && filters.fy == null && filters.fromDate == null && filters.toDate == null && filters.d1Bucket == null && filters.d2Bucket == null && filters.driftBucket == null && filters.opmDelta == null && filters.score == null && filters.opmMin == null && !filters.sortByPead) ? 0.4 : 1 }}>
              Clear
            </button>
          </div>
        </div>
        {/* zzz226 — ⚡ QUALITY PRESET: one click applies PAT≥30 · EPS≥40 ·
            OPM Δ≥0 · Composite≥65 · D1≥0. Click again to clear. Detail chips
            below stay collapsed unless expanded. */}
        {(() => {
          // zzz309 → zzz319 → zzz330 — Quality Preset v5: Sales≥20 · EPS≥25 · PEAD≥60 · OPM Δ ≥0 · CFO/PAT ≥0.5.
          const presetActive = filters.sales === 20 && filters.eps === 25 && filters.pead === 60 && filters.opmDelta === 0 && filters.cfoPatMin === 0.5 && filters.mktCapMin === 3000 && filters.pledgedMax === 0 /* zzz360 */ && filters.driftBucket == null && JSON.stringify((filters.verdicts || []).slice().sort()) === JSON.stringify(['BUY', 'STRONG BUY', 'WATCH']) /* zzz366 */;
          const OPT_OUT_KEY = 'mc:cb:preset:v3:optout';
          const handleToggle = () => {
            setFilters((prev) => {
              if (presetActive) {
                try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {}
                return { ...FILTER_DEFAULT, cap: prev.cap };
              } else {
                try { localStorage.removeItem(OPT_OUT_KEY); } catch {}
                return { ...FILTER_DEFAULT, cap: prev.cap, sales: 20, eps: 25, pead: 60, opmDelta: 0, cfoPatMin: 0.5, mktCapMin: 3000, pledgedMax: 0 /* zzz360 */, verdicts: ['STRONG BUY', 'BUY', 'WATCH'] /* zzz366 */ };
              }
            });
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handleToggle}
                title="One-click institutional screen: Sales YoY ≥20% · EPS YoY ≥25% · PEAD score ≥60 · OPM Δ ≥0pp · CFO/PAT ≥0.5 · MktCap ≥₹3k Cr · Promoter pledge 0% (zzz360; null pledge passes). Auto-applied on first visit; disable it here to opt out permanently. Click again to re-enable."
                style={presetActive
                  ? chipActive('#F59E0B')
                  : { ...chipBase, border: '1px solid #F59E0B', color: '#F59E0B', fontWeight: 800 }}>
                ⚡ QUALITY PRESET · Sales≥20 · EPS≥25 · PEAD≥60 · OPM Δ≥0 · CFO/PAT≥0.5 · MktCap≥₹3k Cr · Pledge 0% · Verdict: STRONG BUY·BUY·WATCH {presetActive ? '✓ ON' : '· OFF — click to enable'}
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
          { v: 20, lbl: '≥20%' }, { v: 25, lbl: '≥25%' }, { v: 30, lbl: '≥30%' }, { v: 40, lbl: '≥40%' }, { v: 50, lbl: '≥50%' },
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
        {/* zzz304 — CFO/PAT minimum ratio chips (earnings quality: cash conversion). */}
        {renderChipGroup('CFO/PAT MIN', '#34D399', 'cfoPatMin' as any, [
          { v: 0.5, lbl: '≥0.5' }, { v: 0.7, lbl: '≥0.7' }, { v: 0.8, lbl: '≥0.8' }, { v: 1.0, lbl: '≥1.0' },
        ])}
        {/* zzz360 — promoter-pledge MAX chips. 0 = only unpledged names (governance
            clean). Null pledged_pct passes the gate so unknowns aren't dropped. */}
        {renderChipGroup('PLEDGED MAX', '#EF4444', 'pledgedMax' as any, [
          { v: 0, lbl: '0%' }, { v: 1, lbl: '≤1%' }, { v: 5, lbl: '≤5%' },
        ])}
        {/* zzz362 — VERDICT multi-select filter. Toggles membership in
            filters.verdicts. Count = currently-loaded bench entries whose
            cbComputeQuality verdict == that label. Custom row (not renderChipGroup)
            because the value is an array, not a scalar. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>VERDICT</span>
          {([
            { label: 'STRONG BUY', color: '#22C55E' },
            { label: 'BUY', color: '#84CC16' },
            { label: 'WATCH', color: '#F59E0B' },
            { label: 'AVOID', color: '#EF4444' },
            { label: 'HIGH RISK', color: '#EF4444' },
          ] as Array<{ label: string; color: string }>).map((o) => {
            const active = (filters.verdicts || []).includes(o.label);
            const n = verdictCounts[o.label] || 0;
            return (
              <button key={o.label}
                onClick={() => setFilters((prev) => {
                  const cur = prev.verdicts || [];
                  const next = cur.includes(o.label) ? cur.filter((x) => x !== o.label) : [...cur, o.label];
                  return { ...prev, verdicts: next.length ? next : null };
                })}
                style={active ? chipActive(o.color) : chipBase}>
                {o.label} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n})</span>
              </button>
            );
          })}
        </div>
        {/* zzz348 - market cap min chips */}
        {renderChipGroup('MKT CAP MIN', '#F59E0B', 'mktCapMin' as any, [
          { v: 500, lbl: '≥₹500 Cr' }, { v: 1000, lbl: '≥₹1k Cr' }, { v: 3000, lbl: '≥₹3k Cr' }, { v: 5000, lbl: '≥₹5k Cr' }, { v: 10000, lbl: '≥₹10k Cr' },
        ])}
        {/* zzz329 — Max trailing P/E chips. Excludes negative-earnings names automatically. */}
        {renderChipGroup('P/E MAX', '#A78BFA', 'peMax' as any, [
          { v: 15, lbl: '≤15' }, { v: 20, lbl: '≤20' }, { v: 30, lbl: '≤30' }, { v: 50, lbl: '≤50' }, { v: 80, lbl: '≤80' },
        ])}
        {/* zzz332 FRESH 3D bypass toggle */}
        <button onClick={() => setFilters(prev => ({ ...prev, freshBypass: !prev.freshBypass }))} title="When ON, entries filed within last 3 business days ALWAYS show regardless of preset gates (Sales/EPS/PEAD/OPM/CFO-PAT). Off by default so preset applies uniformly." style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: filters.freshBypass ? '#F59E0B22' : 'transparent', border: '1px solid ' + (filters.freshBypass ? '#F59E0B' : '#334155'), color: filters.freshBypass ? '#F59E0B' : '#94A3B8', fontSize: 11, fontWeight: 700, letterSpacing: '0.5px' }}>{filters.freshBypass ? '✓ 🆕 FRESH 3D' : '🆕 FRESH 3D'}</button>
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
                // zzz234 — Disable clicks when no d2/move data available. Prevents
                // the "select 2D chip → 0 matches" confusion that happens when
                // backend hasn't enriched entries yet.
                const disabled = !hasAnyD2;
                return (
                  <button key={o.v}
                    onClick={disabled ? undefined : () => toggleD2(o.v)}
                    disabled={disabled}
                    title={disabled ? '⚠ 2D data not enriched yet. Push zzz231 backend files + Hard Refresh /earnings-opportunities. Until then, chip is disabled to avoid confusing "0 matches" selections.' : `Filter to entries with 2-day cumulative close ${o.lbl}. Bloomberg/Goldman convention: D2 = 2 trading sessions after earnings-day prev-close.`}
                    style={active ? chipActive(o.color) : { ...chipBase, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n === null ? '⏳' : n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* zzz245 — DRIFT (cumulative post-filing move) filter. Uses move_pct.
            Mirrors 1D/2D CLOSE UX so users can compose D1 + D2 + DRIFT gates. */}
        {(() => {
          const toggleDrift = (v: number) =>
            setFilters((f) => ({ ...f, driftBucket: f.driftBucket === v ? null : v }));
          const opts: Array<{ v: number; lbl: string; color: string }> = [
            { v: 0,   lbl: '≥0%',    color: '#10B981' },
            { v: 3,   lbl: '≥+3%',   color: '#10B981' },
            { v: 5,   lbl: '≥+5%',   color: '#10B981' },
            { v: 10,  lbl: '≥+10%',  color: '#10B981' },
            { v: 20,  lbl: '≥+20%',  color: '#10B981' },
            { v: -3,  lbl: '≤-3%',   color: '#EF4444' },
            { v: -8,  lbl: '≤-8%',   color: '#EF4444' },
          ];
          const hasAnyDrift = entries.some((e) => typeof (e as any).move_pct === 'number' && Number.isFinite((e as any).move_pct));
          const countDrift = (v: number) => {
            const probe: ConvFilters = { ...filters, driftBucket: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>DRIFT</span>
              {opts.map((o) => {
                const active = filters.driftBucket === o.v;
                const n = hasAnyDrift ? countDrift(o.v) : null;
                const disabled = !hasAnyDrift;
                return (
                  <button key={o.v}
                    onClick={disabled ? undefined : () => toggleDrift(o.v)}
                    disabled={disabled}
                    title={disabled ? 'DRIFT (cumulative post-filing move) not yet enriched.' : `Filter to entries with cumulative post-filing drift ${o.lbl}. Bernard-Thomas PEAD signal.`}
                    style={active ? chipActive(o.color) : { ...chipBase, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n === null ? '⏳' : n})</span>
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
      {/* PATCH 0196 — Export toolbar (CSV, TradingView, .txt, Open chart). Tier-grouped.
          PATCH 0366 — tickerCompanyMap wired for Screener.in name-based matching. */}
      <TickerExportToolbar
        compact
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
        // ── COMPACT (legacy rows) OR TABLE view ─────────────────────────
        tableMode ? (
          <ConvictionTable entries={[...blockbusters, ...strongs]} onRemove={onRemove} sort={tableSort} setSort={setTableSort} />
        ) : (
<>
          {/* zzz254 — Side-by-side split when both tiers have entries. On narrow
              screens (< 1280px) it collapses back to stacked via 1fr fallback. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: (blockbusters.length > 0 && strongs.length > 0)
              ? 'repeat(auto-fit, minmax(min(100%, 640px), 1fr))'
              : '1fr',
            gap: 12,
          }}>
            {blockbusters.length > 0 && (
              <div style={{
                backgroundColor: 'var(--mc-bg-1)',
                border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderLeft: '4px solid var(--mc-warn)',
                borderRadius: 12, padding: density === 'ultra' ? '8px 12px' : density === 'compact' ? '10px 14px' : '14px 18px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', marginBottom: 10, letterSpacing: '0.5px' }}>
                  ⭐ BLOCKBUSTER · {blockbusters.length}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${density === 'ultra' ? 300 : density === 'compact' ? 340 : 380}px, 1fr))`, gap: density === 'ultra' ? 6 : 10 }}>
                  {blockbusters.map((e) => <ConvictionRow key={e.ticker} entry={e} onRemove={onRemove} density={density} />)}
                </div>
              </div>
            )}
            {strongs.length > 0 && (
              <div style={{
                backgroundColor: 'var(--mc-bg-1)',
                border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderLeft: '4px solid var(--mc-bullish)',
                borderRadius: 12, padding: density === 'ultra' ? '8px 12px' : density === 'compact' ? '10px 14px' : '14px 18px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', marginBottom: 10, letterSpacing: '0.5px' }}>
                  🟢 STRONG · {strongs.length}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${density === 'ultra' ? 300 : density === 'compact' ? 340 : 380}px, 1fr))`, gap: density === 'ultra' ? 6 : 10 }}>
                  {strongs.map((e) => <ConvictionRow key={e.ticker} entry={e} onRemove={onRemove} density={density} />)}
                </div>
              </div>
            )}
          </div>
        </>
        )
      )}
      <div style={{
        padding: '8px 12px', backgroundColor: 'var(--mc-bg-0)',
        border: '1px solid var(--mc-bg-4)', borderRadius: 8,
        fontSize: 10.5, color: 'var(--mc-text-4)', lineHeight: 1.5,
        marginTop: 20,
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
          // zzz373 — season label derived from the calendar (was hard-coded "Q4 FY26 · May–Jun 2026").
          const seasonLabel = (() => {
            const now = new Date(); const m = now.getMonth() + 1; const y = now.getFullYear();
            // Indian FY ends March. Jul–Aug = Q1 (Apr–Jun) season; Oct–Nov = Q2; Jan–Feb = Q3; Apr–Jun = Q4/annual.
            if (m >= 7 && m <= 9) return `Q1 FY${String(y + 1).slice(2)} filing season (Jul–Aug ${y} — companies publishing their Apr–Jun ${y} numbers)`;
            if (m >= 10 && m <= 12) return `Q2 FY${String(y + 1).slice(2)} filing season (Oct–Nov ${y} — companies publishing their Jul–Sep ${y} numbers)`;
            if (m >= 1 && m <= 3) return `Q3 FY${String(y).slice(2)} filing season (Jan–Feb ${y} — companies publishing their Oct–Dec ${y - 1} numbers)`;
            return `Q4 FY${String(y).slice(2)} filing season (Apr–Jun ${y} — companies publishing their Jan–Mar ${y} numbers)`;
          })();
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
              We&apos;re in the middle of <strong>{seasonLabel}</strong>, so {dominantQ[0]} naturally has {dominantQ[1]} of {totalQ} entries ({dominantPct.toFixed(0)}%).
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-3)' }}>
                <strong style={{ color: 'var(--mc-text-1)' }}>Quarter → date cheat sheet:</strong> Q1 = {qPeriodMap.Q1} · Q2 = {qPeriodMap.Q2} · Q3 = {qPeriodMap.Q3} · Q4 = {qPeriodMap.Q4}
              </div>
            </div>
          );
        })()}
      </div>

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

// zzz261 — EI Elite tab. Fetches EXCELLENT+STRONG from Earnings Intelligence
// via /api/market/earnings-scan for the user's Conviction Beats + Watchlist
// tickers. Cached in localStorage 4h TTL. Renders sortable table + export toolbar.
interface EIEliteRow {
  symbol: string;
  company: string;
  grade: string;
  score?: number;
  pe?: number;
  marketCapCr?: number;
  revenueYoy?: number;
  patYoy?: number;
  epsYoy?: number;
  opmPct?: number;
  guidance?: string;
  price?: number;
  d1_close_pct?: number;
  filed_date?: string;
  period?: string;
  fetched_at?: string;
}
const EI_ELITE_LS_KEY = 'mc:ei-elite:v1';
const EI_ELITE_HIDDEN_KEY = 'mc:ei-elite:hidden:v1';
const EI_ELITE_MAX_AGE_DAYS = 30;
function EIEliteTab() {
  const [rows, setRows] = useState<EIEliteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [sort, setSort] = useState<{col: string; dir: 'asc'|'desc'}>({col: 'score', dir: 'desc'});
  // zzz266 — Quality Preset default ON: Sales≥20, PAT≥20, EPS≥25, OPM≥11
  const [qualityPreset, setQualityPreset] = useState(true);
  // zzz267 — time window selector; period filtered on scan result
  const [timeWindow, setTimeWindow] = useState<'7d' | '1m' | '2m' | '3m'>('1m');
  // Load from cache on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(EI_ELITE_LS_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw);
      if (cached && Array.isArray(cached.rows) && typeof cached.ts === 'number') {
        setRows(cached.rows);
        setLastFetch(cached.ts);
      }
    } catch {}
  }, []);
  // zzz263 — hidden set: tickers user has manually removed (× button).
  // Never re-added by auto-sync so removals are permanent unless user restores.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(EI_ELITE_HIDDEN_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw)));
    } catch {}
  }, []);
  const removeRow = useCallback((sym: string) => {
    const symUp = sym.toUpperCase();
    setHidden((prev) => {
      const next = new Set(prev); next.add(symUp);
      try { localStorage.setItem(EI_ELITE_HIDDEN_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
    setRows((prev) => {
      const next = prev.filter(r => r.symbol.toUpperCase() !== symUp);
      try { localStorage.setItem(EI_ELITE_LS_KEY, JSON.stringify({ rows: next, ts: Date.now() })); } catch {}
      return next;
    });
  }, []);
  // zzz263 — Full Screener-universe sticky sync. Mirrors what EI page does:
  // (1) fetch /api/market/quotes to get all NSE tickers (~2317)
  // (2) worker-pool through /api/market/earnings-scan in 15-ticker batches
  // (3) filter EXCELLENT+STRONG within 30 days of filing
  // (4) ADDITIVE merge — new tickers added, existing kept; nothing auto-removed
  // (5) User-hidden set persists across syncs
  const fetchElite = useCallback(async () => {
    setLoading(true);
    setProgress('Loading Screener universe…');
    // Step 1: full stock list
    let allStocks: string[] = [];
    try {
      const qres = await fetch('/api/market/quotes?market=india', { cache: 'no-store' });
      if (!qres.ok) throw new Error('Failed to load stock list');
      const qj = await qres.json();
      allStocks = (Array.isArray(qj?.stocks) ? qj.stocks : [])
        .map((s: any) => s?.ticker).filter((t: any): t is string => typeof t === 'string' && t.length > 0);
    } catch (e) {
      setLoading(false); setProgress(null);
      alert('Failed to load Screener universe: ' + String(e)); return;
    }
    // Step 2: worker-pool batched scan
    const BATCH = 15, WORKERS = 12;
    const batches: string[][] = [];
    for (let i = 0; i < allStocks.length; i += BATCH) batches.push(allStocks.slice(i, i + BATCH));
    let cursor = 0, done = 0;
    const claimNext = (): string[] | null => cursor < batches.length ? batches[cursor++] : null;
    const acc: EIEliteRow[] = [];
    const worker = async () => {
      while (true) {
        const batch = claimNext();
        if (!batch) return;
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 20000);
          const url = '/api/market/earnings-scan?symbols=' + encodeURIComponent(batch.join(','));
          const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(timer);
          if (r.ok) {
            const j = await r.json();
            const cards = Array.isArray(j?.cards) ? j.cards : Array.isArray(j?.data) ? j.data : [];
            for (const c of cards) {
              const grade = c?.grade || c?.tier;
              if (grade !== 'EXCELLENT' && grade !== 'STRONG') continue;
              const qs = Array.isArray(c.quarters) ? c.quarters : [];
              const lastQ = qs[qs.length - 1] || {};
              acc.push({
                symbol: (c.symbol || c.ticker || '').toUpperCase(), company: c.company || c.name || '',
                grade, score: c.totalScore ?? c.total_score ?? c.score,
                pe: c.pe, marketCapCr: c.mcap ?? c.marketCapCr ?? c.market_cap_cr,
                revenueYoy: c.revenueYoY ?? c.revenueYoy ?? c.rev_yoy_pct ?? c.sales_yoy_pct,
                patYoy: c.patYoY ?? c.patYoy ?? c.pat_yoy_pct,
                epsYoy: c.epsYoY ?? c.epsYoy ?? c.eps_yoy_pct,
                opmPct: lastQ.opm ?? c.opmPct ?? c.opm_pct,
                guidance: c.guidance, price: c.cmp ?? c.price ?? c.currentPrice,
                d1_close_pct: c.d1_close_pct ?? c.d1_pct, // zzz266: dropped priceScore fallback (was 50 default)
                filed_date: c.resultDate ?? c.filed_date ?? c.filing_date, period: c.period ?? lastQ.period,
                fetched_at: new Date().toISOString(),
              });
            }
          }
        } catch {}
        done++;
        setProgress(`Scanning ${done}/${batches.length} batches (${acc.length} elite found so far)…`);
      }
    };
    await Promise.all(Array.from({length: WORKERS}, () => worker()));
    // Step 3: filter — drop hidden + apply time-window filter via period quarter.
    // zzz267 — Use the period string (e.g. "Jun 2026") as a proxy for recency.
    // We map today → current quarter, then count quarters back based on window.
    // 7d/1M → only current quarter | 2M → current + prev | 3M → current + prev 2
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth(); // 0-11
    // Quarter mapping: Jan-Mar → Q4 prev FY (Mar), Apr-Jun → Q1 (Jun), Jul-Sep → Q2 (Sep), Oct-Dec → Q3 (Dec)
    const quarterOf = (m: number) => m <= 2 ? 'Mar' : m <= 5 ? 'Jun' : m <= 8 ? 'Sep' : 'Dec';
    const yearOf = (m: number, y: number) => m <= 2 ? y : y; // simplified — same calendar year
    // Build acceptable "period" strings based on window
    const acceptPeriods: Set<string> = new Set();
    const monthsBack = timeWindow === '7d' || timeWindow === '1m' ? 0 : timeWindow === '2m' ? 3 : 6;
    const quartersBack = Math.ceil(monthsBack / 3);
    for (let q = 0; q <= quartersBack + 1; q++) {
      const monthOffset = curMonth - q * 3;
      let year = curYear;
      let month = monthOffset;
      while (month < 0) { month += 12; year -= 1; }
      acceptPeriods.add(`${quarterOf(month)} ${year}`);
    }
    const freshOnly = acc.filter(r => {
      if (hidden.has(r.symbol.toUpperCase())) return false;
      // If period is unknown, keep (data quality) unless very strict window
      if (!r.period) return timeWindow !== '7d';
      return acceptPeriods.has(String(r.period));
    });
    // Step 4: additive merge — union existing rows + new fresh (dedupe by symbol, prefer new)
    // zzz264 — add diagnostic so user can verify: found X elite, Y after date filter, Z stored total.
    const foundElite = acc.length;
    const afterFilter = freshOnly.length;
    let finalCount = 0;
    setRows((prev) => {
      const merged = new Map<string, EIEliteRow>();
      for (const r of prev) if (!hidden.has(r.symbol.toUpperCase())) merged.set(r.symbol.toUpperCase(), r);
      for (const r of freshOnly) merged.set(r.symbol.toUpperCase(), r); // new overwrites stale
      const arr = Array.from(merged.values());
      finalCount = arr.length;
      try { localStorage.setItem(EI_ELITE_LS_KEY, JSON.stringify({ rows: arr, ts: Date.now() })); } catch {}
      return arr;
    });
    setTimeout(() => {
      console.log('[EI Elite] Sync complete:', { foundElite, afterFilter, finalCount });
    }, 100);
    setLastFetch(Date.now()); setLoading(false); setProgress(null);
  }, [hidden]);
  // zzz267 — NO auto-fetch. User must click Refresh with a time window selected.
  // Prevents 90-second scan running silently on every tab visit.
  const sorted = useMemo(() => {
    // zzz266 — apply Quality Preset filter (Sales≥20, PAT≥20, EPS≥25, OPM≥11) before sort
    const filtered = qualityPreset
      ? rows.filter((r) => {
          const s = typeof r.revenueYoy === 'number' ? r.revenueYoy : -Infinity;
          const pt = typeof r.patYoy === 'number' ? r.patYoy : -Infinity;
          const ep = typeof r.epsYoy === 'number' ? r.epsYoy : -Infinity;
          const om = typeof r.opmPct === 'number' ? r.opmPct : -Infinity;
          return s >= 20 && pt >= 20 && ep >= 25 && om >= 11;
        })
      : rows;
    return [...filtered].sort((a: any, b: any) => {
      const av = a[sort.col], bv = b[sort.col];
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      const as = String(av || ''), bs = String(bv || '');
      return sort.dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [rows, sort, qualityPreset]);
  const onSort = (col: string) => setSort((s) => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  const arrow = (c: string) => sort.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const fmtPct = (v: any) => typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
  const fmtNum = (v: any) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';
  const fmtMcap = (v: any) => typeof v === 'number' && v > 0 ? (v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : v >= 1000 ? `₹${(v/1000).toFixed(1)}k` : `₹${Math.round(v)}`) : '—';
  const pctCol = (v: any) => (typeof v === 'number' && v >= 0) ? 'var(--mc-bullish)' : (typeof v === 'number' ? 'var(--mc-bearish)' : 'var(--mc-text-4)');
  const excellents = rows.filter(r => r.grade === 'EXCELLENT').length;
  const strongs = rows.filter(r => r.grade === 'STRONG').length;
  // zzz268 — export toolbar respects Quality Preset filter (use sorted, not rows)
  const filteredExcellents = sorted.filter(r => r.grade === 'EXCELLENT').length;
  const filteredStrongs = sorted.filter(r => r.grade === 'STRONG').length;
  const allTickers = sorted.map(r => r.symbol);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--mc-text-2)' }}>
          <strong style={{ color: '#8B5CF6' }}>🎖️ EI Elite</strong> — sticky bench of EXCELLENT+STRONG from EI (last 30d, additive, × to remove)
        </div>
        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
          {/* zzz268 — show filtered counts when preset ON so header matches export */}
          <span style={{ padding: '2px 8px', background: 'color-mix(in srgb, #10B981 15%, transparent)', color: '#10B981', borderRadius: 4, fontWeight: 700 }}>
            EXCELLENT · {qualityPreset ? `${filteredExcellents}/${excellents}` : excellents}
          </span>
          <span style={{ padding: '2px 8px', background: 'color-mix(in srgb, #22D3EE 15%, transparent)', color: '#22D3EE', borderRadius: 4, fontWeight: 700 }}>
            STRONG · {qualityPreset ? `${filteredStrongs}/${strongs}` : strongs}
          </span>
          {qualityPreset && (
            <span style={{ padding: '2px 8px', background: 'color-mix(in srgb, #F59E0B 15%, transparent)', color: '#F59E0B', borderRadius: 4, fontWeight: 700 }}>Total · {sorted.length}</span>
          )}
        </div>
        {/* zzz266 — Quality Preset toggle, default ON */}
        <button onClick={() => setQualityPreset(v => !v)} title="Toggle Quality Preset: Sales≥20, PAT≥20, EPS≥25, OPM≥11. Same institutional gate as Conviction Beats."
          style={{ padding: '6px 12px', fontSize: 11.5, fontWeight: 800, borderRadius: 6, background: qualityPreset ? '#F59E0B' : 'none', border: '1px solid #F59E0B', color: qualityPreset ? '#0B1220' : '#F59E0B', cursor: 'pointer' }}>
          ⚡ Quality Preset {qualityPreset ? '✓ ON' : 'OFF'}
        </button>
        {/* zzz267 — Time window selector */}
        <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', marginLeft: 8 }}>WINDOW:</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(['7d', '1m', '2m', '3m'] as const).map((w) => (
            <button key={w} onClick={() => setTimeWindow(w)}
              title={w === '7d' ? 'Last 7 days (current quarter only)' : w === '1m' ? 'Last 1 month' : w === '2m' ? 'Last 2 months' : 'Last 3 months'}
              style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, background: timeWindow === w ? '#22D3EE' : 'none', border: '1px solid #22D3EE', color: timeWindow === w ? '#0B1220' : '#22D3EE', cursor: 'pointer' }}>
              {w === '7d' ? '7D' : w.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={fetchElite} disabled={loading}
          style={{ padding: '6px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 6, background: 'none', border: '1px solid #8B5CF6', color: '#8B5CF6', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? '⏳ Fetching…' : '🔄 Refresh'}
        </button>
        {hidden.size > 0 && (
          <button onClick={() => {
            if (!confirm(`Restore all ${hidden.size} hidden tickers? They will be eligible for re-add on next sync.`)) return;
            setHidden(new Set());
            try { localStorage.removeItem(EI_ELITE_HIDDEN_KEY); } catch {}
          }} style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, background: 'none', border: '1px solid var(--mc-text-4)', color: 'var(--mc-text-3)', cursor: 'pointer' }}>
            ↩ Restore ({hidden.size})
          </button>
        )}
        {lastFetch && (
          <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>
            Last: {new Date(lastFetch).toLocaleString()}
          </span>
        )}
      </div>
      {progress && (
        <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, #8B5CF6 8%, transparent)', border: '1px solid color-mix(in srgb, #8B5CF6 25%, transparent)', borderRadius: 6, fontSize: 11.5, color: '#8B5CF6' }}>
          {progress}
        </div>
      )}
      {rows.length === 0 && !loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mc-text-3)', background: 'var(--mc-bg-1)', border: '1px dashed var(--mc-bg-4)', borderRadius: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-text-2)', marginBottom: 6 }}>No EI Elite data yet</div>
          <div style={{ fontSize: 12 }}>1. Pick a time window (7D / 1M / 2M / 3M) — smaller windows scan fewer quarters<br/>2. Click <strong>🔄 Refresh</strong> to scan the Screener universe once<br/>Subsequent visits show cached data (never auto-fetches).</div>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <TickerExportToolbar
            compact
            tickers={allTickers}
            groups={[
              // zzz268 — groups reflect filtered subset (Quality Preset ON respected)
              { label: 'EXCELLENT', emoji: '⭐', tickers: sorted.filter(r => r.grade === 'EXCELLENT').map(r => r.symbol), color: '#10B981' },
              { label: 'STRONG', emoji: '🔵', tickers: sorted.filter(r => r.grade === 'STRONG').map(r => r.symbol), color: '#22D3EE' },
            ]}
            exchange="NSE"
            filenameHint="ei-elite"
            tickerCompanyMap={sorted.reduce<Record<string, string>>((acc, r) => { if (r.symbol && r.company) acc[r.symbol.toUpperCase()] = r.company; return acc; }, {})}
          />
          <div style={{ background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10, overflow: 'auto', maxHeight: '75vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'ui-sans-serif, system-ui' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--mc-bg-1)', zIndex: 1 }}>
                <tr>
                  {[
                    ['grade', 'Grade'], ['symbol', 'Ticker'], ['company', 'Company'], ['period', 'Period'],
                    ['score', 'Score'], ['pe', 'P/E'], ['marketCapCr', 'MktCap'],
                    ['revenueYoy', 'Rev YoY'], ['patYoy', 'PAT YoY'], ['epsYoy', 'EPS YoY'], ['opmPct', 'OPM'],
                    ['filed_date', 'Filed'], ['guidance', 'Guidance']
                  ].map(([k, l]) => (
                    <th key={k} onClick={() => onSort(k)}
                      style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', padding: '6px 8px', borderBottom: '1px solid var(--mc-bg-4)', cursor: 'pointer', textAlign: 'left', letterSpacing: '0.3px', textTransform: 'uppercase', whiteSpace: 'nowrap', userSelect: 'none' }}>
                      {l}{arrow(k)}
                    </th>
                  ))}
                  <th style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', padding: '6px 8px', borderBottom: '1px solid var(--mc-bg-4)', textAlign: 'center' }}>·</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const gColor = r.grade === 'EXCELLENT' ? '#10B981' : '#22D3EE';
                  return (
                    <tr key={r.symbol} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'var(--mc-bg-2)'; }}
                      onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                      <td style={{ fontSize: 10, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: gColor, fontWeight: 800 }}>{r.grade}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{r.symbol}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-1)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                      <td style={{ fontSize: 10.5, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-3)' }}>{r.period || '—'}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: gColor, fontWeight: 700 }}>{r.score ?? '—'}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right' }}>{fmtNum(r.pe)}{typeof r.pe === 'number' ? 'x' : ''}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: 'var(--mc-text-3)' }}>{fmtMcap(r.marketCapCr)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: pctCol(r.revenueYoy), fontVariantNumeric: 'tabular-nums' as any }}>{fmtPct(r.revenueYoy)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: pctCol(r.patYoy), fontVariantNumeric: 'tabular-nums' as any }}>{fmtPct(r.patYoy)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: pctCol(r.epsYoy), fontVariantNumeric: 'tabular-nums' as any }}>{fmtPct(r.epsYoy)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right' }}>{typeof r.opmPct === 'number' ? r.opmPct.toFixed(1) + '%' : '—'}</td>
                      <td style={{ fontSize: 10.5, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-3)' }}>{r.filed_date || '—'}</td>
                      <td style={{ fontSize: 10.5, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-3)' }}>{r.guidance || '—'}</td>
                      <td style={{ fontSize: 12, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'center' }}>
                        <button onClick={() => removeRow(r.symbol)} title="Remove from EI Elite (permanent unless restored)"
                          style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: 0, fontSize: 14 }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// zzz254 — Mini progress bar for Composite / PEAD scores. Fixed 40px wide.
// Colored by tier band: red < 50, amber 50-70, green >= 70.
function MiniBar({ value, width = 40, height = 5, invert = false }: { value: number | null | undefined; width?: number; height?: number; invert?: boolean }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const clamped = Math.max(0, Math.min(100, value));
  const color = invert
    ? (clamped >= 70 ? 'var(--mc-bearish)' : clamped >= 40 ? '#F59E0B' : 'var(--mc-bullish)')
    : (clamped >= 70 ? 'var(--mc-bullish)' : clamped >= 50 ? '#F59E0B' : 'var(--mc-bearish)');
  return (
    <div style={{ width, height, backgroundColor: 'var(--mc-bg-3)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${clamped}%`, height: '100%', backgroundColor: color }} />
    </div>
  );
}

// zzz254 — Prominent tier badge pill (top-right of card). Filled color, high-contrast.
function TierPill({ tier }: { tier: string }) {
  const isBB = tier === 'BLOCKBUSTER';
  const bg = isBB ? '#F59E0B' : '#10B981';
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 800, letterSpacing: '0.6px',
      padding: '2px 6px', borderRadius: 3, background: bg, color: '#0B1220',
      fontFamily: 'ui-sans-serif, system-ui', whiteSpace: 'nowrap',
    }}>{isBB ? 'BLOCKBUSTER' : 'STRONG'}</span>
  );
}

// zzz251 — DRIFT PATH mini-chart. zzz254 — expanded with tick-value labels
// below each dot so analyst reads exact %s without hovering.
function DriftPath({ entry, width = 130, height = 26, showLabels = true }: { entry: any; width?: number; height?: number; showLabels?: boolean }) {
  const raw = [
    { label: 'Gap', v: typeof entry.gap_pct === 'number' && Number.isFinite(entry.gap_pct) ? entry.gap_pct : null },
    { label: 'D1', v: typeof entry.d1_pct === 'number' && Number.isFinite(entry.d1_pct) ? entry.d1_pct : null },
    { label: 'D2', v: typeof entry.d2_pct === 'number' && Number.isFinite(entry.d2_pct) ? entry.d2_pct : null },
    { label: 'Now', v: typeof entry.move_pct === 'number' && Number.isFinite(entry.move_pct) ? entry.move_pct : null },
  ];
  const pts = raw.filter((p) => p.v != null);
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.v as number);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const range = max - min || 1;
  const step = width / (raw.length - 1);
  // Build path only for populated points, but use original index for X positioning
  const coords = raw.map((p, i) => p.v == null ? null : ({
    x: i * step,
    y: height - ((p.v - min) / range) * height,
    v: p.v,
    label: p.label,
  })).filter((c): c is NonNullable<typeof c> => c != null);
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const first = vals[0], last = vals[vals.length - 1];
  const up = last >= first;
  const color = up ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  const zeroY = height - ((0 - min) / range) * height;
  const tip = pts.map((p) => `${p.label}: ${(p.v as number) >= 0 ? '+' : ''}${(p.v as number).toFixed(1)}%`).join(' · ');
  const labelH = showLabels ? 12 : 0;
  return (
    <svg width={width} height={height + labelH} style={{ display: 'block', overflow: 'visible' }} aria-label="Post-earnings drift trajectory">
      <title>DRIFT PATH: {tip}</title>
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="var(--mc-text-4)" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.4" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 2 : 1.5} fill={c.v >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'} />
      ))}
      {/* zzz254 — value labels under each dot */}
      {showLabels && raw.map((p, i) => (
        <text key={i} x={i * step} y={height + 10} textAnchor={i === 0 ? 'start' : i === raw.length - 1 ? 'end' : 'middle'}
          style={{ fontSize: 9, fill: p.v == null ? 'var(--mc-text-4)' : (p.v >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'), fontFamily: 'ui-monospace, monospace', opacity: 1, fontWeight: 600 }}>
          {p.v == null ? '—' : `${p.v >= 0 ? '+' : ''}${p.v.toFixed(1)}`}
        </text>
      ))}
    </svg>
  );
}

// zzz247 — Institutional table view. Sortable columns for analysts who want to
// scan 42+ rows in 3 seconds. Same filter set, denser layout.
function ConvictionTable({ entries, onRemove, sort, setSort }: {
  entries: ConvictionEntry[]; onRemove: (t: string) => void;
  sort: { col: string; dir: 'asc'|'desc' }; setSort: (s: { col: string; dir: 'asc'|'desc' }) => void;
}) {
  const cols: Array<{ key: string; label: string; align?: string; get: (e: any) => any }> = [
    { key: 'tier',      label: 'Tier',    get: (e) => e.tier === 'BLOCKBUSTER' ? 1 : 0 },
    { key: 'ticker',    label: 'Ticker',  get: (e) => e.ticker || '' },
    { key: 'company',   label: 'Company', get: (e) => e.company || '' },
    { key: 'filed',     label: 'Filed',   get: (e) => e.filing_date || '' },
    { key: 'sector',    label: 'Sector',  get: (e) => resolveSector(e) || '' },
    { key: 'mcap',      label: 'MktCap',  align: 'right', get: (e) => e.market_cap_cr ?? 0 },
    { key: 'composite', label: 'Comp',    align: 'right', get: (e) => e.composite_score ?? 0 },
    { key: 'pead',      label: 'PEAD',    align: 'right', get: (e) => peadScore(e).score },
    { key: 'sales',     label: 'Sales',   align: 'right', get: (e) => e.sales_yoy_pct ?? -999 },
    { key: 'pat',       label: 'PAT',     align: 'right', get: (e) => e.net_profit_yoy_pct ?? -999 },
    { key: 'eps',       label: 'EPS',     align: 'right', get: (e) => e.eps_yoy_pct ?? -999 },
    { key: 'opm',       label: 'OPM',     align: 'right', get: (e) => e.opm_pct ?? -999 },
    { key: 'pe',        label: 'P/E',     align: 'right', get: (e) => e.pe ?? Infinity },
    { key: 'd1',        label: 'D1',      align: 'right', get: (e) => e.d1_pct ?? -999 },
    { key: 'drift',     label: 'DRIFT',   align: 'right', get: (e) => e.move_pct ?? -999 },
  ];
  const sorted = [...entries].sort((a, b) => {
    const c = cols.find((c) => c.key === sort.col);
    if (!c) return 0;
    const av = c.get(a), bv = c.get(b);
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const onSort = (col: string) => {
    if (sort.col === col) setSort({ col, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ col, dir: 'desc' });
  };
  const fmtPct = (v: any) => typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
  const fmtNum = (v: any) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';
  const fmtMcap = (v: any) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? (v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : v >= 1000 ? `₹${(v/1000).toFixed(1)}k` : `₹${Math.round(v)}`) : '—';
  const pctColor = (v: any) => (typeof v === 'number' && Number.isFinite(v)) ? (v >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)') : 'var(--mc-text-4)';
  const arrow = (c: string) => sort.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const th = { fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', padding: '6px 8px', borderBottom: '1px solid var(--mc-bg-4)', cursor: 'pointer', letterSpacing: '0.3px', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const, userSelect: 'none' as const };
  const td = { fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums' as any };
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10, overflow: 'auto', maxHeight: '75vh' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'ui-sans-serif, system-ui' }}>
        <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--mc-bg-1)', zIndex: 1 }}>
          <tr>
            {cols.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)} style={{ ...th, textAlign: (c.align as any) || 'left' }} title={`Sort by ${c.label}`}>
                {c.label}{arrow(c.key)}
              </th>
            ))}
            <th style={{ ...th, textAlign: 'center' }}>·</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const tierColor = e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
            const tierLbl = e.tier === 'BLOCKBUSTER' ? '⭐' : '🟢';
            return (
              <tr key={e.ticker + (e.filing_date || '')} style={{ transition: 'background 0.1s' }}
                onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'var(--mc-bg-2)'; }}
                onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <td style={{ ...td, color: tierColor, fontWeight: 800 }}>{tierLbl}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                  {e.source_url ? (
                    <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-text-2)', textDecoration: 'none', borderBottom: '1px dotted var(--mc-text-4)' }}>{e.ticker}</a>
                  ) : e.ticker}
                </td>
                <td style={{ ...td, color: 'var(--mc-text-1)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.company}</td>
                <td style={{ ...td, color: 'var(--mc-text-3)' }}>{e.filing_date || '—'}</td>
                <td style={{ ...td, color: 'var(--mc-text-3)' }}>{resolveSector(e) || '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--mc-text-3)' }}>{fmtMcap((e as any).market_cap_cr)}</td>
                <td style={{ ...td, textAlign: 'right', color: tierColor, fontWeight: 800 }}>{e.composite_score}</td>
                <td style={{ ...td, textAlign: 'right', color: peadColor(peadScore(e).score), fontWeight: 700 }}>{peadScore(e).score}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor(e.sales_yoy_pct) }}>{fmtPct(e.sales_yoy_pct)}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor(e.net_profit_yoy_pct) }}>{fmtPct(e.net_profit_yoy_pct)}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor(e.eps_yoy_pct) }}>{fmtPct(e.eps_yoy_pct)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{typeof (e as any).opm_pct === 'number' ? `${(e as any).opm_pct.toFixed(1)}%` : '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--mc-text-2)' }}>{fmtNum((e as any).pe) === '—' ? '—' : fmtNum((e as any).pe) + 'x'}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor((e as any).d1_pct) }}>{fmtPct((e as any).d1_pct)}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor((e as any).move_pct), fontWeight: 700 }}>{fmtPct((e as any).move_pct)}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button onClick={() => onRemove(e.ticker)} title="Remove"
                    style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: 0, fontSize: 13 }}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConvictionRow({ entry, onRemove, density = 'comfy' }: { entry: ConvictionEntry; onRemove: (t: string) => void; density?: 'comfy'|'compact'|'ultra' }) {
  const tierColor = entry.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
  const pct = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
  // USER-REQ — PEAD score chip (formula from PEAD_Strategy_vF + checklists).
  const pead = peadScore(entry);
  const peadClr = peadColor(pead.score);
  const peadTip = `PEAD ${pead.score} (${peadLabel(pead.score)}) — ${pead.drift_phase} phase, ${pead.days_since_filing}d since filing\n` +
    `Sales norm ${pead.sales_norm}, PAT norm ${pead.pat_norm}, EPS norm ${pead.eps_norm}, base ${pead.raw}\n` +
    `Op-leverage +${pead.op_leverage_bonus}, Quality +${pead.quality_signal}, Tier +${pead.tier_bonus}, decay ×${pead.drift_decay}`;
  return (
    <div
      onMouseEnter={(ev) => { const t = ev.currentTarget as HTMLElement; t.style.transform = 'translateY(-2px)'; t.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)'; t.style.borderColor = tierColor; }}
      onMouseLeave={(ev) => { const t = ev.currentTarget as HTMLElement; t.style.transform = ''; t.style.boxShadow = ''; t.style.borderColor = 'var(--mc-bg-4)'; }}
      style={{
        padding: density === 'ultra' ? '6px 10px' : density === 'compact' ? '8px 12px' : '10px 12px',
        backgroundColor: 'var(--mc-bg-0)',
        border: '1px solid var(--mc-bg-4)', borderLeft: `3px solid ${tierColor}`,
        borderRadius: 8, display: 'flex', flexDirection: 'column', gap: density === 'ultra' ? 3 : density === 'compact' ? 5 : 6,
        transition: 'transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease',
        willChange: 'transform',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: density === 'ultra' ? 12 : 13, fontWeight: 800, color: 'var(--mc-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.company}
          </div>
          <div style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'var(--mc-text-3)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', rowGap: 2 }}>
            {entry.source_url ? (
              <a href={entry.source_url} target="_blank" rel="noreferrer" title="Open filing on NSE"
                style={{ fontWeight: 700, color: 'var(--mc-text-2)', textDecoration: 'none', borderBottom: '1px dotted var(--mc-text-4)' }}>{entry.ticker}</a>
            ) : (
              <span style={{ fontWeight: 700 }}>{entry.ticker}</span>
            )}
            <span style={{ color: 'var(--mc-text-4)' }}>·</span>
            <span style={{ whiteSpace: 'nowrap' }}>{entry.filing_date}</span>
            {(() => {
              const sec = resolveSector(entry);
              if (!sec) return null;
              const dotColor = sectorColor(sec);
              return (<><span style={{ color: 'var(--mc-text-4)' }}>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span title={sec} style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />{sec}</span></>);
            })()}
            {/* zzz249 — compact mktCap: drop "₹" and " Cr" (context is clear on Indian bench) */}
            {typeof (entry as any).market_cap_cr === 'number' && Number.isFinite((entry as any).market_cap_cr) && (() => {
              const c = (entry as any).market_cap_cr as number;
              const s = c >= 100000 ? `${(c/100000).toFixed(2)}L` : c >= 1000 ? `${(c/1000).toFixed(1)}k` : `${Math.round(c)}`;
              return (<><span style={{ color: 'var(--mc-text-4)' }}>·</span><span title={`Market cap: ₹${Math.round(c).toLocaleString('en-IN')} Cr`} style={{ whiteSpace: 'nowrap' }}>₹{s} Cr</span></>);
            })()}
            {/* zzz250 — days-since-flagged chip. Color-coded freshness. */}
            {entry.filing_date && (() => {
              const ms = Date.parse(entry.filing_date + 'T09:30:00+05:30');
              if (!Number.isFinite(ms)) return null;
              const days = Math.max(0, Math.round((Date.now() - ms) / 86400000));
              const col = days <= 3 ? 'var(--mc-bullish)' : days <= 14 ? 'var(--mc-warn)' : 'var(--mc-text-4)';
              return (<><span style={{ color: 'var(--mc-text-4)' }}>·</span><span title={`${days} day${days===1?'':'s'} since filing — freshness matters for post-earnings drift`} style={{ color: col, fontWeight: 700, whiteSpace: 'nowrap' }}>{days}d</span></>);
            })()}
          </div>
        </div>
        {/* zzz254 — right-side stack: TierPill + Composite bar + PEAD bar + × */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TierPill tier={entry.tier} />
            <button onClick={() => onRemove(entry.ticker)} title="Remove from Conviction Beats"
              style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '2px 6px', fontSize: 15, lineHeight: 1, marginLeft: 2 }}>×</button>
          </div>
          <div title={`Composite Score: ${entry.composite_score} — magnitude 35% + quality 25% + technical 25% + methodology 15%`}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <MiniBar value={entry.composite_score} width={44} height={5} />
            <span style={{ fontSize: 11, fontWeight: 800, color: tierColor, fontFamily: 'ui-monospace, monospace', minWidth: 22, textAlign: 'right' }}>{entry.composite_score}</span>
          </div>
          <div title={peadTip} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'help' }}>
            <MiniBar value={pead.score} width={44} height={5} />
            <span style={{ fontSize: 11, fontWeight: 800, color: peadClr, fontFamily: 'ui-monospace, monospace', minWidth: 22, textAlign: 'right' }}>{pead.score}</span>
          </div>
        </div>
      </div>
      {/* Always-visible DRIFT chip. A BLOCKBUSTER/STRONG bench name fading
          <= -12% since its print is the market fading the beat — the earliest
          sell tell. Renders without any filter toggle and is also armed to
          Book Watch (BENCH_DRIFT). Uses move_pct (no fetch needed). */}
      {(() => {
        const { drifting, movePct } = cbDriftState(entry);
        if (!drifting || movePct == null) return null;
        const critical = movePct <= -20;
        const col = critical ? '#EF4444' : '#F59E0B';
        return (
          <div>
            <span
              title={`DRIFT: ${entry.tier} bench name is ${movePct.toFixed(1)}% below its filing-day price. The market is fading the beat — the earliest sell tell. Armed to Book Watch as BENCH_DRIFT (${critical ? 'critical' : 'warning'}).`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, cursor: 'help',
                background: `${col}1A`, color: col, border: `1px solid ${col}66`, letterSpacing: '0.3px',
              }}
            >⚠ DRIFT {movePct.toFixed(1)}%</span>
          </div>
        );
      })()}
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
          <div style={{ display: 'flex', gap: '6px 14px', fontSize: 10.5, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span><span style={{ color: 'var(--mc-text-4)' }}>Sales</span> <strong style={{ color: (entry.sales_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.sales_yoy_pct)}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            <span><span style={{ color: 'var(--mc-text-4)' }}>PAT</span> <strong style={{ color: (entry.net_profit_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.net_profit_yoy_pct)}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            <span><span style={{ color: 'var(--mc-text-4)' }}>EPS</span> <strong style={{ color: (entry.eps_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.eps_yoy_pct)}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            {/* zzz223 — OPM margin chip: latest OPM % + pp delta vs prior year */}
            {typeof (entry as any).opm_pct === 'number' && (() => {
              const o = (entry as any).opm_pct as number;
              const p = (entry as any).opm_prev_pct as number | null | undefined;
              const d = typeof p === 'number' ? o - p : null;
              const col = d == null ? 'var(--mc-text-2)' : d >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
              // zzz354 — explicit OPM trend classification
              const cls = d == null ? null : d >= 1 ? '🟢 EXPANDING' : d >= -1 ? '🟡 FLAT' : '🔴 CONTRACTING';
              return (
                <span title={typeof p === 'number' ? `OPM ${o.toFixed(1)}% vs ${p.toFixed(1)}% prior year — ${(d as number) >= 0 ? '+' : ''}${(d as number).toFixed(1)}pp. Trend: ${cls || 'unknown'}` : `OPM ${o.toFixed(1)}% (no prior-year value)`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>OPM</span>{' '}
                  <strong style={{ color: col }}>
                    {o.toFixed(1)}%{d != null ? ` (${d >= 0 ? '+' : ''}${d.toFixed(1)}pp)` : ''}
                  </strong>
                  {cls && <span style={{ marginLeft: 4, fontSize: 9.5, color: 'var(--mc-text-3)' }}>{cls}</span>}
                </span>
              );
            })()}
            {/* zzz304 — CFO/PAT chip. Green >= 0.8 (healthy), amber 0.5-0.8, red < 0.5.
                zzz317 — Explicitly ANNUAL CFO / ANNUAL PAT from Screener's annual
                cash-flow + P&L tables. Screener does not publish quarterly cash
                flow, so this is a multi-year quality signal — a company that
                consistently converts profit to cash over years — NOT a per-
                quarter check on the specific earnings event that triggered the
                BLOCKBUSTER/STRONG grade. Label + tooltip make the annual scope
                explicit so it isn't misread against quarterly PAT growth. */}
            {(() => {
              // zzz374 — reconcile the header "CFO/PAT FY" with the Q-TRENDS
              // "CFO/PAT (annual)" pill. They used two different sources:
              //   header  = cfo_to_pat_ratio (a single graded/enrich number, often
              //             a year older than the fresh Screener series)
              //   pill    = latest of annual_cfo_pat[] (zzz371-aligned by FY label)
              // That's why KMEW showed header 1.17 next to pill 0.94. Prefer the
              // annual-series latest value (the accurate one) for the header too;
              // fall back to cfo_to_pat_ratio only when the series is absent.
              const arr = Array.isArray((entry as any).annual_cfo_pat)
                ? (entry as any).annual_cfo_pat.filter((x: any) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 5)
                : null;
              const seriesLatest = arr && arr.length >= 1 ? arr[arr.length - 1] as number : null;
              const rSrc = seriesLatest != null ? seriesLatest : (entry as any).cfo_to_pat_ratio;
              if (typeof rSrc !== 'number') return null;
              const r = rSrc as number;
              // zzz364 (BUG 2c) — financials: CFO/PAT is not meaningful for lenders/NBFCs.
              if (cbIsFinancial(entry)) {
                return (
                  <span title="Cash-flow/PAT is not meaningful for lenders/NBFCs">
                    <span style={{ color: 'var(--mc-text-4)' }}>·</span>{' '}
                    <span style={{ color: 'var(--mc-text-4)' }}>CFO/PAT</span>{' '}
                    <strong style={{ color: 'var(--mc-text-4)' }}>n/m</strong>
                  </span>
                );
              }
              // zzz364 (BUG 6) — |ratio|>5× is an artifact (depressed PAT / WC swing),
              // not a real cash-conversion read. Render n/m rather than an absurd number.
              if (Math.abs(r) > 5) {
                return (
                  <span title={`Annual CFO/PAT ${r.toFixed(2)} is outside the meaningful range (|ratio| > 5×) — likely a depressed-PAT or working-capital artifact, not a genuine cash-conversion signal.`}>
                    <span style={{ color: 'var(--mc-text-4)' }}>·</span>{' '}
                    <span style={{ color: 'var(--mc-text-4)' }}>CFO/PAT FY</span>{' '}
                    <strong style={{ color: 'var(--mc-text-4)' }}>n/m</strong>
                  </span>
                );
              }
              const col = r >= 0.8 ? 'var(--mc-bullish)' : r >= 0.5 ? '#F59E0B' : 'var(--mc-bearish)';
              const base = 'Annual CFO/PAT ' + r.toFixed(2) + ' (Screener FY figures — cash flow is published annually, not quarterly). ';
              const tip = r >= 1 ? base + 'Pristine cash conversion (>=1 means annual CFO ≥ reported profit).'
                : r >= 0.8 ? base + 'Healthy multi-year cash conversion.'
                : r >= 0.5 ? base + 'Cash conversion running below reported profit — watch working capital days.'
                : base + 'WEAK: profits not translating into cash. Earnings-quality concern that predates this quarter.';
              return (
                <span title={tip}>
                  <span style={{ color: 'var(--mc-text-4)' }}>·</span>{' '}
                  <span style={{ color: 'var(--mc-text-4)' }}>CFO/PAT FY</span>{' '}
                  <strong style={{ color: col }}>{r.toFixed(2)}</strong>
                </span>
              );
            })()}
            {/* zzz256 — force P/E + DRIFT onto own row */}
            <span style={{ flexBasis: '100%', height: 0, margin: 0 }} />
            {/* zzz242 — trailing P/E chip. zzz251 — color-code vs SECTOR MEDIAN P/E
                (compares apples to apples). Falls back to absolute bands if no sector peers. */}
            {typeof (entry as any).pe === 'number' && Number.isFinite((entry as any).pe) && (entry as any).pe > 0 && (() => {
              const pval = (entry as any).pe as number;
              const secMap: Record<string, number> = (typeof window !== 'undefined' && (window as any).__cbSectorPeMed) || {};
              const secMed = (() => { const s = resolveSector(entry); return s ? secMap[s] : null; })();
              let col: string; let tip: string;
              if (secMed != null && secMed > 0) {
                const ratio = pval / secMed;
                if (ratio >= 1.5) { col = 'var(--mc-bearish)'; tip = `P/E ${pval.toFixed(1)}x is ${((ratio - 1) * 100).toFixed(0)}% above sector median (${secMed.toFixed(1)}x) — expensive vs peers.`; }
                else if (ratio >= 1.15) { col = '#F59E0B'; tip = `P/E ${pval.toFixed(1)}x is ${((ratio - 1) * 100).toFixed(0)}% above sector median (${secMed.toFixed(1)}x) — richer than peers.`; }
                else if (ratio >= 0.85) { col = 'var(--mc-text-2)'; tip = `P/E ${pval.toFixed(1)}x is in line with sector median (${secMed.toFixed(1)}x).`; }
                else if (ratio >= 0.65) { col = 'var(--mc-bullish)'; tip = `P/E ${pval.toFixed(1)}x is ${((1 - ratio) * 100).toFixed(0)}% below sector median (${secMed.toFixed(1)}x) — cheaper than peers.`; }
                else { col = 'var(--mc-bullish)'; tip = `P/E ${pval.toFixed(1)}x is ${((1 - ratio) * 100).toFixed(0)}% below sector median (${secMed.toFixed(1)}x) — deep value vs peers.`; }
              } else {
                col = pval > 100 ? 'var(--mc-bearish)' : pval > 60 ? '#F59E0B' : pval > 30 ? 'var(--mc-text-2)' : 'var(--mc-bullish)';
                tip = `Trailing P/E: ${pval.toFixed(1)}x. No sector peers in bench — using absolute band. Red > 100x, Amber 60-100x, Grey 30-60x, Green < 30x.`;
              }
              return (
                <span title={tip}>
                  <span style={{ color: 'var(--mc-text-4)' }}>P/E</span>{' '}
                  <strong style={{ color: col }}>{pval.toFixed(1)}x</strong>
                  {secMed != null && density !== 'ultra' && (
                    <span style={{ fontSize: 8.5, color: 'var(--mc-text-4)', marginLeft: 3 }}>(med {secMed.toFixed(1)})</span>
                  )}
                </span>
              );
            })()}
            {/* zzz354 — PEG chip: P/E ÷ EPS growth. <1 undervalued, 1-2 fair, >2 rich, <0 negative-growth guard.
                Uses trailing P/E and latest EPS YoY %. Skips when EPS growth ≤ 0 or missing. */}
            {typeof (entry as any).pe === 'number' && Number.isFinite((entry as any).pe) && (entry as any).pe > 0 && typeof entry.eps_yoy_pct === 'number' && (entry.eps_yoy_pct as number) > 5 && (() => {
              const pe = (entry as any).pe as number;
              const g = entry.eps_yoy_pct as number;
              // zzz364 (BUG 4) — cap the valuation denominator at 100 so a triple-
              // digit base-effect EPS growth can't manufacture DEEP VALUE. The
              // DISPLAYED EPS-growth number (g) is unchanged; only the denom caps.
              const gVal = Math.min(g, 100);
              const peg = pe / gVal;
              // zzz357/zzz358 — PEG < 0.15 is almost always a low-base optical artifact
              // (GNFC PEG 0.03, SFL PEG 0.04) not genuine deep value. Flag it as BASE EFFECT?.
              const col = peg < 0.15 ? '#F59E0B' : peg < 0.5 ? 'var(--mc-bullish)' : peg < 1 ? 'var(--mc-bullish)' : peg < 2 ? '#F59E0B' : 'var(--mc-bearish)';
              const label = peg < 0.15 ? 'BASE EFFECT?' : peg < 0.5 ? 'DEEP VALUE' : peg < 1 ? 'CHEAP vs growth' : peg < 2 ? 'FAIR' : 'RICH vs growth';
              return (
                <span title={`PEG = P/E (${pe.toFixed(1)}) ÷ EPS YoY % (${g.toFixed(1)}%${gVal !== g ? `, capped at ${gVal.toFixed(0)}% for valuation` : ''}) = ${peg.toFixed(2)}. Traditional PEG: <1 undervalued, 1-2 fair, >2 overvalued. Verdict: ${label}.`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>PEG</span>{' '}
                  <strong style={{ color: col }}>{peg.toFixed(2)}</strong>
                  <span style={{ marginLeft: 3, fontSize: 8.5, color: 'var(--mc-text-4)' }}>({label})</span>
                </span>
              );
            })()}
            {/* zzz354 — P/E-vs-growth verdict chip: standalone classifier that works even when
                EPS growth is 0 or negative (which PEG skips). Compares P/E ratio to EPS growth
                rate directly: P/E > 2×growth = OVERVALUED, P/E < 0.5×growth = UNDERVALUED, else FAIR.
                For negative EPS growth (turnaround): always OVERVALUED regardless of P/E. */}
            {typeof (entry as any).pe === 'number' && Number.isFinite((entry as any).pe) && (entry as any).pe > 0 && typeof entry.eps_yoy_pct === 'number' && (() => {
              const pe = (entry as any).pe as number;
              const g = entry.eps_yoy_pct as number;
              // zzz364 (BUG 4) — cap the valuation denominator at 100 (displayed g unchanged).
              const gVal = Math.min(g, 100);
              // zzz364 (BUG 5) — negative ROCE destroys capital; never allow UNDERVALUED.
              const roceV = (entry as any).roce;
              const roceNeg = typeof roceV === 'number' && roceV < 0;
              let verdict: string; let col: string;
              // zzz357 — absolute P/E ceilings override the growth-relative verdict.
              // Fixes NYKAA 351x / CUPID 271x / HITACHI 131x rendering as FAIR when a
              // large EPS-growth base made P/E < 2×growth. No triple-digit multiple is "fair".
              if (pe > 200) { verdict = 'EXTREME'; col = 'var(--mc-bearish)'; }
              else if (pe > 100) { verdict = 'OVERVALUED'; col = 'var(--mc-bearish)'; }
              else if (g <= 0) { verdict = 'NEG-GROWTH'; col = 'var(--mc-bearish)'; }
              else if (pe > 2 * gVal) { verdict = 'OVERVALUED'; col = 'var(--mc-bearish)'; }
              else if (pe < 0.5 * gVal && !roceNeg) { verdict = 'UNDERVALUED'; col = 'var(--mc-bullish)'; }
              else { verdict = 'FAIR'; col = 'var(--mc-text-2)'; }
              return (
                <span title={`P/E-vs-Growth verdict: ${verdict}. P/E ${pe.toFixed(1)}x vs EPS growth ${g.toFixed(1)}%. Rule: P/E>200 = EXTREME, P/E>100 = OVERVALUED, >2×growth = OVERVALUED, <0.5×growth = UNDERVALUED, negative growth = flag.`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>VAL</span>{' '}
                  <strong style={{ color: col, fontSize: 10 }}>{verdict}</strong>
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
                <span title={`DRIFT: cumulative % close change from earnings-day prev close (${entry.filing_date || '?'}) to most recent close. Post-Earnings Announcement Drift = the classic Bernard-Thomas signal — beats persist to +Xd, misses fade.`}>
                  <span style={{ color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>DRIFT {arrow}</span>{' '}
                  <strong style={{ color: col }}>
                    {m >= 0 ? '+' : ''}{m.toFixed(1)}%
                  </strong>
                </span>
              );
            })()}
          </div>
        );
      })()}
      {/* zzz254 — Institutional-quality row: ROCE, ROE, D/E. zzz255 — dropped RS/OCF
          because enrich API doesn't return them (only graded API does). Hidden in ultra. */}
      {/* zzz260 — D/E removed per user request (data unreliable across sources). ROCE + ROE only. */}
      {density !== 'ultra' && (() => {
        const roce = (entry as any).roce, roe = (entry as any).roe;
        const qCol = (v: any, thr: number) => (typeof v === 'number' && Number.isFinite(v) && v >= thr) ? 'var(--mc-bullish)' : (typeof v === 'number' ? '#F59E0B' : 'var(--mc-text-4)');
        const val = (v: any, suffix = '') => (typeof v === 'number' && Number.isFinite(v)) ? (v.toFixed(1) + suffix) : '—';
        return (
          <div style={{ display: 'flex', gap: '6px 14px', fontSize: 10, flexWrap: 'wrap', alignItems: 'baseline', color: 'var(--mc-text-3)', paddingTop: 2, borderTop: '1px dashed var(--mc-bg-3)', marginTop: 2 }}>
            <span title="ROCE — Return on Capital Employed. ≥25% = capital-efficient compounder. Screener/Yahoo may not report ROCE for banks/NBFCs — shown as — when unavailable."><span style={{ color: 'var(--mc-text-4)' }}>ROCE</span> <strong style={{ color: qCol(roce, 25) }}>{val(roce, '%')}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            <span title="ROE — Return on Equity. ≥18% = strong equity productivity."><span style={{ color: 'var(--mc-text-4)' }}>ROE</span> <strong style={{ color: qCol(roe, 18) }}>{val(roe, '%')}</strong></span>
            {/* zzz360 — promoter-pledge chip. 0% = clean (green); any pledge = red
                governance flag. Guarded on typeof number so unknown pledge omits. */}
            {typeof (entry as any).pledged_pct === 'number' && Number.isFinite((entry as any).pledged_pct) && (() => {
              const p = (entry as any).pledged_pct as number;
              const clean = p === 0;
              const col = clean ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
              return (
                <>
                  <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
                  <span title={clean
                    ? 'Promoter pledge 0% — no shares pledged. Clean governance signal.'
                    : `Promoter pledge ${p.toFixed(p < 1 ? 2 : 1)}% of promoter holding. Pledged shares = leverage/liquidity risk; forced sale on margin call can cascade the price.`}>
                    <span style={{ color: 'var(--mc-text-4)' }}>PLEDGE</span>{' '}
                    <strong style={{ color: col }}>{clean ? '0%' : p.toFixed(p < 1 ? 2 : 1) + '%'}</strong>
                  </span>
                </>
              );
            })()}
          </div>
        );
      })()}
      {/* zzz355 — SCORES row: composite Earnings Quality Score (0-100) + Overall Verdict pill.
          Quality Score components (max 100):
            - CFO/PAT: >=1 → 30, 0.8-1 → 25, 0.5-0.8 → 15, <0.5 → 0
            - OPM Δ (pp): >3 → 25, 1-3 → 20, 0-1 → 10, <0 → 0
            - PAT/Sales ratio (op-lev sanity): 1-2× → 20, 2-3× → 10, >3× → 0, <1× → 15
            - EPS-PAT gap (dilution proxy): ≤10pp → 15, ≤30pp → 8, >30pp → 0
            - PEG (valuation): <1 → 10, 1-2 → 5
          Overall Verdict combines Quality + PE-vs-growth + red flag count + DRIFT. */}
      {density !== 'ultra' && (() => {
        // zzz362 — computation extracted to module-level cbComputeQuality so the
        // verdict can also drive the filter gate. Rendered output is unchanged
        // (qScore bar, QUALITY number, triangulation chip, verdict pill).
        const { qScore, qCol, bits, verdictLabel, verdictIcon, verdictColor, verdictTip, triLabel, triCol } = cbComputeQuality(entry);

        return (
          <div style={{ display: 'flex', gap: '8px 10px', flexWrap: 'wrap', alignItems: 'center', paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)', fontSize: 10 }}>
            <span title={'Earnings Quality Score (0-100). Composite of: ' + bits.join(' | ')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
              <span style={{ color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>QUALITY</span>
              <span style={{ position: 'relative', width: 44, height: 5, background: 'var(--mc-bg-3)', borderRadius: 2 }}>
                <span style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: qScore + '%', background: qCol, borderRadius: 2 }} />
              </span>
              <strong style={{ color: qCol, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 22 }}>{qScore}</strong>
            </span>
            {triLabel && (
              <span title="Growth Triangulation: are Sales+PAT+EPS all coherent? GROWTH TRIPLE = healthy across the board. MARGIN-LED = PAT strong but Sales weak (watch sustainability). VOLUME-ONLY = Sales up but margins compressing." style={{ padding: '1px 6px', borderRadius: 3, background: triCol + '22', color: triCol, fontWeight: 700, border: '1px solid ' + triCol + '55', fontSize: 9.5, letterSpacing: '0.3px' }}>{triLabel}</span>
            )}
            <span title={verdictTip} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 3, cursor: 'help',
              background: verdictColor + '22', color: verdictColor, fontWeight: 800,
              border: '1px solid ' + verdictColor + '66', fontSize: 10.5, letterSpacing: '0.5px',
              marginLeft: 'auto',
            }}>{verdictIcon} {verdictLabel}</span>
          </div>
        );
      })()}
      {/* zzz358 — INSTITUTIONAL CHIPS row: positive/neutral signal pills (blue-ish).
          Additive to the SCORES + RED FLAGS rows. Every chip is individually
          guarded (typeof === 'number' && Number.isFinite) so an absent field
          simply omits its chip — never crashes. Some Tier-2 fields (ebit_yoy_pct,
          pat_margin_*, finance_cost_curr_cr / ebit_curr_cr, other_income_pct_sales_*,
          effective_tax_rate_*, dep_yoy_pct) don't yet exist on the bench schema —
          those chips no-op until the enrich backend ships them. */}
      {density !== 'ultra' && (() => {
        const e: any = entry;
        const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        const chips: Array<{ icon: string; label: string; tip: string; color: string }> = [];
        const BLUE = '#3B82F6', CYAN = '#06B6D4', GREEN = '#22C55E', AMBER = '#F59E0B', VIOLET = '#A855F7';

        // ── Tier 1 (payload data) ──────────────────────────────────────────
        // 🚀 QoQ ACCEL — sequential sales growth accelerating (quarters_sales, 4Q).
        // Assume chronological oldest→newest; last QoQ growth > prior QoQ growth.
        const qs: any[] | null = Array.isArray(e.quarters_sales) ? e.quarters_sales : null;
        if (qs && qs.length >= 4) {
          const q2 = num(qs[qs.length - 3]), q3 = num(qs[qs.length - 2]), q4 = num(qs[qs.length - 1]), q1 = num(qs[qs.length - 4]);
          if (q1 !== null && q2 !== null && q3 !== null && q4 !== null && q1 > 0 && q2 > 0 && q3 > 0) {
            const lastQoQ = (q4 - q3) / q3, priorQoQ = (q3 - q2) / q2;
            if (lastQoQ > priorQoQ) {
              chips.push({ icon: '🚀', label: 'QoQ ACCEL', color: CYAN,
                tip: `Sequential sales growth accelerating: latest QoQ +${(lastQoQ * 100).toFixed(1)}% > prior QoQ +${(priorQoQ * 100).toFixed(1)}% (quarters_sales 4Q).` });
            }
          }
        }
        // ⚙️ OP-LEV — EBIT YoY exceeds EBITDA YoY by >20pp (operating leverage).
        const ebitY = num(e.ebit_yoy_pct), ebitdaY = num(e.ebitda_yoy_pct);
        if (ebitY !== null && ebitdaY !== null && (ebitY - ebitdaY) > 20) {
          chips.push({ icon: '⚙️', label: 'OP-LEV', color: BLUE,
            tip: `Operating leverage: EBIT +${ebitY.toFixed(1)}% YoY vs EBITDA +${ebitdaY.toFixed(1)}% YoY (${(ebitY - ebitdaY).toFixed(1)}pp gap). Below-EBITDA costs scaling slower than revenue.` });
        }
        // PAT-M ±X.Xpp — PAT margin YoY delta (curr vs prev).
        const patmC = num(e.pat_margin_curr), patmP = num(e.pat_margin_prev);
        if (patmC !== null && patmP !== null) {
          const d = patmC - patmP, sign = d >= 0 ? '+' : '−';
          chips.push({ icon: '', label: `PAT-M ${sign}${Math.abs(d).toFixed(1)}pp`, color: d >= 0 ? GREEN : AMBER,
            tip: `PAT margin ${patmC.toFixed(1)}% vs ${patmP.toFixed(1)}% YoY (${sign}${Math.abs(d).toFixed(1)}pp).` });
        }
        // 💧 WC-STRETCH / WC-TIGHT — receivables/inventory YoY vs sales YoY.
        const salesY = num(e.sales_yoy_pct), recvY = num(e.receivables_yoy_pct), invY = num(e.inventory_yoy_pct);
        if (salesY !== null && (recvY !== null || invY !== null)) {
          const wcMax = Math.max(recvY ?? -Infinity, invY ?? -Infinity);
          const wcMin = Math.min(recvY ?? Infinity, invY ?? Infinity);
          if (Number.isFinite(wcMax) && wcMax > salesY + 15) {
            chips.push({ icon: '💧', label: 'WC-STRETCH', color: AMBER,
              tip: `Working capital stretching: receivables/inventory YoY (${wcMax.toFixed(0)}%) well above sales YoY (${salesY.toFixed(0)}%). Watch cash conversion.` });
          } else if (Number.isFinite(wcMin) && wcMin < salesY - 15) {
            chips.push({ icon: '💧', label: 'WC-TIGHT', color: GREEN,
              tip: `Working capital disciplined: receivables/inventory YoY (${wcMin.toFixed(0)}%) clearly below sales YoY (${salesY.toFixed(0)}%).` });
          }
        }
        // 💰 DEBT-FREE — finance cost < 2% of EBIT.
        const finC = num(e.finance_cost_curr_cr), ebitC = num(e.ebit_curr_cr);
        if (finC !== null && ebitC !== null && ebitC > 0 && finC < 0.02 * ebitC) {
          chips.push({ icon: '💰', label: 'DEBT-FREE', color: GREEN,
            tip: `Finance cost ₹${finC.toFixed(1)} Cr is <2% of EBIT ₹${ebitC.toFixed(1)} Cr — effectively debt-free / negligible interest burden.` });
        }

        // ── Tier 2 (new backend fields, may be null until enrich ships) ─────
        // 📊 OTHER-INC ↓ — other income falling as % of sales (cleaner quality).
        // zzz373 — when the quarterly series exists, derive curr/prev FROM IT so this chip and
        // the Q-TRENDS OTHER-INC pill can never contradict (TIIL showed "OTHER-INC ↓" next to
        // "OTHER-INC 5.0% ▲+3.0" because the scalar came from an older enrich pass).
        const oiSeries = Array.isArray(e.quarters_other_income_pct) ? e.quarters_other_income_pct.filter((x: any) => typeof x === 'number' && Number.isFinite(x)) : null;
        const oiC = oiSeries && oiSeries.length >= 2 ? oiSeries[oiSeries.length - 1] : num(e.other_income_pct_sales_curr);
        const oiP = oiSeries && oiSeries.length >= 2 ? oiSeries[oiSeries.length - 2] : num(e.other_income_pct_sales_prev);
        if (oiC !== null && oiP !== null && (oiP - oiC) >= 0.5) {
          chips.push({ icon: '📊', label: 'OTHER-INC ↓', color: BLUE,
            tip: `Other income falling as % of sales (${oiC.toFixed(1)}% vs ${oiP.toFixed(1)}%) — cleaner, more operating-driven earnings.` });
        }
        // ⚠️ TAX-BENEFIT −Xpp — effective tax rate below prev by >5pp (optical EPS boost).
        const taxSeriesChip = Array.isArray(e.quarters_tax_pct) ? e.quarters_tax_pct.filter((x: any) => typeof x === 'number' && Number.isFinite(x)) : null;
        const taxC = taxSeriesChip && taxSeriesChip.length >= 2 ? taxSeriesChip[taxSeriesChip.length - 1] : num(e.effective_tax_rate_curr);
        const taxP = taxSeriesChip && taxSeriesChip.length >= 2 ? taxSeriesChip[taxSeriesChip.length - 2] : num(e.effective_tax_rate_prev);
        // zzz372/373 — sanity band: effective tax rates outside [-10, 70] are artifacts of a
        // near-zero / negative PBT denominator (DCW showed −9497%). Skip the chip then.
        const taxSane = (v: number | null): v is number => v !== null && v >= -10 && v <= 70;
        if (taxSane(taxC) && taxSane(taxP) && (taxP - taxC) > 5) {
          chips.push({ icon: '⚠️', label: `TAX-BENEFIT −${(taxP - taxC).toFixed(0)}pp`, color: AMBER,
            tip: `Effective tax rate dropped ${(taxP - taxC).toFixed(1)}pp YoY (${taxP.toFixed(1)}% → ${taxC.toFixed(1)}%). Optical EPS boost — check if one-off.` });
        }
        // 📈 SCALE ✓ — depreciation YoY ÷ sales YoY < 0.3 (operating scale).
        const depY = num(e.dep_yoy_pct);
        if (depY !== null && salesY !== null && salesY > 0 && (depY / salesY) < 0.3) {
          chips.push({ icon: '📈', label: 'SCALE ✓', color: GREEN,
            tip: `Operating scale: depreciation +${depY.toFixed(0)}% YoY growing far slower than sales +${salesY.toFixed(0)}% YoY (ratio ${(depY / salesY).toFixed(2)} <0.3).` });
        }

        // ── Extras ─────────────────────────────────────────────────────────
        // 📊 LOW-BASE — prior-period sales < ₹100 Cr AND sales YoY > 100 (optical growth).
        const priorSales = qs && qs.length >= 4 ? num(qs[0]) : null;
        if (priorSales !== null && priorSales < 100 && salesY !== null && salesY > 100) {
          chips.push({ icon: '📊', label: 'LOW-BASE', color: AMBER,
            tip: `Optical growth off a tiny base: prior-period sales ₹${priorSales.toFixed(0)} Cr with +${salesY.toFixed(0)}% YoY. High % masks small absolute size.` });
        }
        // 💧 CASH-RICH — cfo_to_pat_ratio > 3 (cash flow far exceeds profit).
        // zzz366 — reframed from the old alarmist "CFO-INFLATED" amber flag. A very
        // high CFO/PAT is usually a POSITIVE (strong cash generation, or a heavy-
        // depreciation asset base adding back), and it was sitting contradictorily
        // next to a cash-backed beat. Rendered neutral grey as an informational note,
        // not a red/amber warning, with a caveat to check the driver.
        const cfoR = num(e.cfo_to_pat_ratio);
        // zzz371 (audit) — cap at the same 5x artifact ceiling the top-line uses, so a card
        // can never show "CFO/PAT FY n/m" AND "CASH-RICH 8.7x" at once (TVSSRICHAK).
        if (cfoR !== null && cfoR > 3 && cfoR <= 5 && !cbIsFinancial(e)) { // zzz362 — financials: CFO/PAT not meaningful
          chips.push({ icon: '💧', label: `CASH-RICH ${cfoR.toFixed(1)}×`, color: 'var(--mc-text-4)',
            tip: `CFO/PAT ${cfoR.toFixed(1)}× — operating cash flow far exceeds reported profit. Usually healthy (strong cash conversion or heavy depreciation add-back); occasionally a working-capital release or a depressed-PAT base. Informational, not a red flag.` });
        }
        // ⚠️ ONE-OFF — latest quarter carries a large exceptional/one-off item.
        // zzz363 — |exceptional| ≥ 15% of PBT. Amber when >0 (gain-flattered),
        // grey when <0 (charge-depressed). Signed % of PBT.
        const exPct = num(e.exceptional_pct_pbt);
        if (exPct !== null && Math.abs(exPct) >= 15) {
          const exCol = exPct > 0 ? AMBER : 'var(--mc-text-4)';
          chips.push({ icon: '⚠️', label: `ONE-OFF ${exPct > 0 ? '+' : ''}${exPct.toFixed(0)}% PBT`, color: exCol,
            tip: `Latest quarter includes a large exceptional/one-off item (${exPct > 0 ? '+' : ''}${exPct.toFixed(0)}% of PBT) — the beat may be flattered by a non-recurring gain; check recurring PAT.` });
        }
        // 👑 PREMIUM — ROCE ≥ 30 AND ROE ≥ 25 (compounder tier).
        const roceV = num(e.roce), roeV = num(e.roe);
        if (roceV !== null && roeV !== null && roceV >= 30 && roeV >= 25) {
          chips.push({ icon: '👑', label: 'PREMIUM', color: VIOLET,
            tip: `Compounder tier: ROCE ${roceV.toFixed(0)}% (≥30) and ROE ${roeV.toFixed(0)}% (≥25).` });
        }
        // CFO N/A (Q1) — cfo ratio absent AND Q1-looking filing. zzz359 CFO proxy note.
        const filingMonth = (() => {
          const fd = typeof e.filing_date === 'string' ? e.filing_date : '';
          const m = /^\d{4}-(\d{2})/.exec(fd);
          return m ? parseInt(m[1], 10) : null;
        })();
        const isQ1Filing = String(e.quarter || '').toUpperCase() === 'Q1'
          || (filingMonth !== null && filingMonth >= 4 && filingMonth <= 6);
        if (cfoR === null && isQ1Filing) {
          chips.push({ icon: '', label: 'CFO N/A (Q1)', color: 'var(--mc-text-4)',
            tip: `CFO/PAT unavailable — Q1 filings rarely disclose cash-flow statements (annual/H1 cadence). Not a red flag; earnings-quality proxy pending H1.` });
        }

        // ⚠ DEGRADED — BLOCKBUSTER tier but genuinely broken (3+ red flags, the
        // same conditions that drive the AVOID verdict). zzz361 — ROCE<15 alone
        // is common among solid cyclicals and over-fired the banner on ~15 cards.
        const tierBB = String(e.tier || '').toUpperCase().includes('BLOCKBUSTER');
        const sYoY = num(e.sales_yoy_pct), pYoY = num(e.net_profit_yoy_pct), epsYoY = num(e.eps_yoy_pct);
        const opmD = (num(e.opm_pct) != null && num(e.opm_prev_pct) != null) ? (num(e.opm_pct)! - num(e.opm_prev_pct)!) : null;
        const drift = num(e.move_pct);
        let rfCount = 0;
        if (cfoR !== null && cfoR < 0.5) rfCount++;
        if (sYoY != null && pYoY != null && sYoY > 5 && pYoY > 5 * sYoY) rfCount++;
        if (epsYoY != null && pYoY != null && Math.abs(pYoY) > 10 && Math.abs(epsYoY - pYoY) > 30) rfCount++;
        if (opmD != null && opmD < -3) rfCount++;
        if (drift != null && drift < -5 && tierBB) rfCount++;
        const degraded = tierBB && (rfCount >= 3 || (drift != null && drift < -12));

        if (chips.length === 0 && !degraded) return null;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)' }}>
            {degraded && (
              <div title={`3+ quality red flags on a BLOCKBUSTER print — headline tier overstates the setup.`}
                style={{ flexBasis: '100%', padding: '2px 8px', borderRadius: 3, background: '#F59E0B22', color: '#F59E0B', fontWeight: 800, border: '1px solid #F59E0B66', fontSize: 9.5, letterSpacing: '0.4px' }}>
                ⚠ DEGRADED — BLOCKBUSTER tier but quality flags present
              </div>
            )}
            {chips.map((c, i) => (
              <span key={i} title={c.tip} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 5px', borderRadius: 3, cursor: 'help',
                background: c.color + '18', color: c.color, fontWeight: 700,
                border: '1px solid ' + c.color + '44', fontSize: 9, letterSpacing: '0.2px',
              }}>{c.icon ? c.icon + ' ' : ''}{c.label}</span>
            ))}
          </div>
        );
      })()}
      {/* zzz360 — QUARTER TRENDS + CFO/PAT-annual + CONCLUSIONS. Additive to the
          zzz358 chips block. Every array is guarded (Array.isArray && length>=2,
          last two entries finite) and every scalar via typeof===number &&
          Number.isFinite. Institutional color semantics per metric. Renders
          nothing when no series/scalar is present. */}
      {density !== 'ultra' && !cbIsFinancial(entry) /* zzz374 — investment/holding/NBFC OPM+CFO trends are noise (DHUNINV showed OPM ▲+222, OTHER-INC ▼-139) */ && (() => {
        const e: any = entry;
        // zzz371 (audit) — NEU must be a real hex, not a CSS var(): the pill style
        // appends a hex-alpha suffix (col + '14' / col + '40'), and 'var(--x)14' is
        // invalid CSS, so neutral TAX/OPM pills silently lost their bg + border.
        const GREEN = '#22C55E', AMBER = '#F59E0B', RED = '#EF4444', NEU = '#94A3B8';
        // last two finite values of a chronological (oldest→newest) array
        const lastTwo = (v: any): { latest: number; prev: number } | null => {
          if (!Array.isArray(v) || v.length < 2) return null;
          const latest = v[v.length - 1], prev = v[v.length - 2];
          if (typeof latest !== 'number' || !Number.isFinite(latest)) return null;
          if (typeof prev !== 'number' || !Number.isFinite(prev)) return null;
          return { latest, prev };
        };
        // zzz374 — drop implausible values (a quarter with ~0 sales makes % ratios
        // explode: DHUNINV OPM prev -178% → delta +222). Filter to [lo,hi] FIRST,
        // then take the last two survivors so the pill reflects real quarters.
        const lastTwoBounded = (v: any, lo: number, hi: number): { latest: number; prev: number } | null => {
          if (!Array.isArray(v)) return null;
          const clean = v.filter((x: any) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi);
          return lastTwo(clean);
        };
        const seriesStr = (v: any): string => Array.isArray(v)
          ? v.slice(-5).map((x: any) => (typeof x === 'number' && Number.isFinite(x)) ? x.toFixed(1) : '—').join(' → ')
          : '';

        type TP = { key: string; label: string; latest: number; delta: number; col: string; tip: string };
        const tps: TP[] = [];

        // OPM % — rising = good (green), falling = amber/red.
        const opm = lastTwoBounded(e.quarters_opm, -50, 100);
        if (opm) {
          const d = opm.latest - opm.prev;
          const col = d >= 0.1 ? GREEN : d <= -1.5 ? RED : d < 0 ? AMBER : NEU;
          tps.push({ key: 'opm', label: 'OPM', latest: opm.latest, delta: d, col,
            tip: `OPM % by quarter (oldest→newest): ${seriesStr(e.quarters_opm)}. Rising = margin tailwind (good), falling = margin pressure.` });
        }
        // Material Cost % — FALLING = good (green), rising = red (input-cost pressure).
        const mat = lastTwo(e.quarters_material_cost_pct);
        if (mat) {
          const d = mat.latest - mat.prev;
          const col = d < 0 ? GREEN : d > 0 ? RED : NEU;
          tps.push({ key: 'mat', label: 'MAT-COST', latest: mat.latest, delta: d, col,
            tip: `Material cost % of sales by quarter: ${seriesStr(e.quarters_material_cost_pct)}. FALLING = margin tailwind (good); rising = input-cost pressure (red).` });
        }
        // Other Income % — FALLING = good/cleaner (green), rising = amber (quality watch).
        const oi = lastTwoBounded(e.quarters_other_income_pct, -60, 100);
        if (oi) {
          const d = oi.latest - oi.prev;
          const col = d < 0 ? GREEN : d > 0 ? AMBER : NEU;
          tps.push({ key: 'oi', label: 'OTHER-INC', latest: oi.latest, delta: d, col,
            tip: `Other income % by quarter: ${seriesStr(e.quarters_other_income_pct)}. FALLING = cleaner/operating-driven (good); rising = earnings-quality watch (amber).` });
        }
        // Tax % — show latest; sharp DROP (>5pp below prior) = amber "tax-aided"; up = neutral.
        // zzz372 — same sanity band as the TAX-BENEFIT chip: a quarter with ~0 or negative
        // PBT makes tax % explode (DCW −9497%). Drop those points before taking lastTwo.
        const taxSeries = Array.isArray(e.quarters_tax_pct)
          ? e.quarters_tax_pct.filter((x: any) => typeof x === 'number' && Number.isFinite(x) && x >= -10 && x <= 70)
          : null;
        const tax = lastTwo(taxSeries);
        if (tax) {
          const d = tax.latest - tax.prev;
          const taxAided = d < -5;
          const col = taxAided ? AMBER : NEU;
          tps.push({ key: 'tax', label: taxAided ? 'TAX·aided' : 'TAX', latest: tax.latest, delta: d, col,
            tip: `Tax rate % by quarter: ${seriesStr(taxSeries)}. Sharp drop (>5pp below prior) = tax-aided EPS (amber); normalizing up = neutral.` });
        }

        // ── CFO/PAT annual trend pill (annual_cfo_pat) ──────────────────────
        const cfoAnnArr: number[] | null = Array.isArray(e.annual_cfo_pat)
          // zzz372 — |ratio| > 5 is a near-zero-PAT artifact (VIPCLOTHNG showed −7.4 → 2.0 as
          // "▲+9.40"); drop those years so the pill reflects the real trend.
          ? e.annual_cfo_pat.filter((x: any) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 5)
          : null;
        const cfoAnnLatest = cfoAnnArr && cfoAnnArr.length >= 1 ? cfoAnnArr[cfoAnnArr.length - 1] : null;
        let cfoAnnPill: React.ReactNode = null;
        if (cfoAnnArr && cfoAnnArr.length >= 2) {
          const latest = cfoAnnArr[cfoAnnArr.length - 1], prev = cfoAnnArr[cfoAnnArr.length - 2];
          const d = latest - prev, rising = d >= 0;
          const col = (latest >= 1 && rising) ? GREEN : (latest < 0.8 || !rising) ? AMBER : NEU;
          const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '▬';
          cfoAnnPill = (
            <span title={`CFO/PAT annual series (Screener cash-flow is published ANNUALLY, so this is a yearly trend, not quarterly): ${cfoAnnArr.map((x) => x.toFixed(2)).join(' → ')}. Green when ≥1 and rising; amber when <0.8 or falling.`}
              style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '1px 5px', borderRadius: 3, cursor: 'help', background: col + '14', border: '1px solid ' + col + '40', fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: 'var(--mc-text-4)' }}>CFO/PAT (annual)</span>
              <strong style={{ color: col }}>{latest.toFixed(2)}</strong>
              <span style={{ color: col }}>{arrow}{d >= 0 ? '+' : ''}{d.toFixed(2)}</span>
            </span>
          );
        }

        // ── CONCLUSIONS synthesis ───────────────────────────────────────────
        const concl: string[] = []; const firedTips: string[] = [];
        const opmRising = !!opm && opm.latest > opm.prev;
        const opmFalling = !!opm && opm.latest < opm.prev;
        const matFalling = !!mat && mat.latest < mat.prev;
        const matRising = !!mat && mat.latest > mat.prev;
        const taxDrop = !!tax && (tax.latest - tax.prev) < -5;
        const oiRising = !!oi && (oi.latest - oi.prev) > 1;
        const cfoRatio = (typeof e.cfo_to_pat_ratio === 'number' && Number.isFinite(e.cfo_to_pat_ratio)) ? e.cfo_to_pat_ratio as number : null;
        const cfoWeak = cfoRatio != null && cfoRatio < 0.8 && !cbIsFinancial(e); // zzz362 — financials: CFO/PAT not meaningful
        const pledgeNum = (typeof e.pledged_pct === 'number' && Number.isFinite(e.pledged_pct)) ? e.pledged_pct as number : null;
        // zzz363 — large exceptional/one-off gain flattering the beat (signed % of PBT).
        const exPctPbt = (typeof e.exceptional_pct_pbt === 'number' && Number.isFinite(e.exceptional_pct_pbt)) ? e.exceptional_pct_pbt as number : null;
        const oneOffBoost = exPctPbt != null && exPctPbt > 15;
        // margin
        if (opm) {
          if (opmRising && matFalling) { concl.push('Clean margin-led'); firedTips.push('OPM rising + material cost falling'); }
          else if (opmRising && matRising) { concl.push('Margin up despite cost pressure'); firedTips.push('OPM rising but material cost also rising'); }
          else if (opmRising) { concl.push('Margin-led'); firedTips.push('OPM rising'); }
          else if (opmFalling) { concl.push('Margin compressing'); firedTips.push('OPM falling'); }
        }
        // cash — zzz364 (BUG 2b) — financials: CFO/PAT not meaningful, suppress the
        // cash-backed / weak-cash-conversion conclusion clause for lenders/NBFCs.
        let cashWeak = false;
        if (cfoAnnLatest != null && !cbIsFinancial(e)) {
          if (cfoAnnLatest >= 1) { concl.push('cash-backed'); firedTips.push('annual CFO/PAT ≥1'); }
          else if (cfoAnnLatest < 0.5) { concl.push('weak cash conversion'); cashWeak = true; firedTips.push('annual CFO/PAT <0.5'); }
        }
        // quality flags
        const qbits: string[] = [];
        if (taxDrop) qbits.push('tax');
        if (oiRising) qbits.push('other-income');
        if (cfoWeak) qbits.push('cash');
        if (qbits.length) {
          // zzz361 — when the quality-flags clause is the ONLY one that fired,
          // render it as a proper statement instead of a bare parenthetical.
          concl.push(concl.length === 0
            ? 'Beat quality: low (' + qbits.join('/') + '-aided)'
            : '(low-quality: ' + qbits.join('/') + '-aided)');
          firedTips.push('quality flags: ' + qbits.join(', '));
        }
        // zzz363 — one-off / exceptional item flattering the beat.
        if (oneOffBoost) {
          concl.push('one-off-boosted (+' + exPctPbt!.toFixed(0) + '% PBT)');
          firedTips.push('exceptional item +' + exPctPbt!.toFixed(0) + '% of PBT');
        }
        // pledge
        if (pledgeNum != null) {
          if (pledgeNum > 0) { concl.push('⚠ promoter pledge ' + pledgeNum.toFixed(pledgeNum < 1 ? 2 : 1) + '%'); firedTips.push('promoter pledge ' + pledgeNum + '%'); }
          else { concl.push('no pledge'); }
        }
        const caution = qbits.length > 0 || matRising || cashWeak || opmFalling || oneOffBoost || (pledgeNum != null && pledgeNum > 0);
        let sentence = '';
        if (concl.length) {
          const raw = concl.join(', ');
          sentence = raw.charAt(0).toUpperCase() + raw.slice(1) + (raw.endsWith('.') ? '' : '.');
        }

        if (tps.length === 0 && !cfoAnnPill && concl.length === 0) return null;
        return (
          <>
            {(tps.length > 0 || cfoAnnPill) && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)' }}>
                <span style={{ fontSize: 8.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px' }} title="Quarter-on-quarter trend (latest quarter vs the one before). The OPM Δ in the header row is YEAR-on-year (same quarter last year), so the two can differ.">Q-TRENDS (QoQ)</span>
                {tps.map((t) => {
                  const arrow = t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '▬';
                  return (
                    <span key={t.key} title={t.tip}
                      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '1px 5px', borderRadius: 3, cursor: 'help', background: t.col + '14', border: '1px solid ' + t.col + '40', fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--mc-text-4)' }}>{t.label}</span>
                      <strong style={{ color: t.col }}>{t.latest.toFixed(1)}%</strong>
                      <span style={{ color: t.col }}>{arrow}{t.delta >= 0 ? '+' : ''}{t.delta.toFixed(1)}</span>
                    </span>
                  );
                })}
                {cfoAnnPill}
              </div>
            )}
            {concl.length > 0 && (
              <div title={'Signals fired: ' + firedTips.join(' · ')}
                style={{ display: 'flex', alignItems: 'baseline', gap: 5, paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)', fontSize: 9.5, cursor: 'help' }}>
                <span style={{ fontSize: 8.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px' }}>READ</span>
                <span style={{ color: caution ? AMBER : GREEN, fontWeight: 700 }}>{sentence}</span>
              </div>
            )}
          </>
        );
      })()}
      {/* zzz375 — HONEST "no trends" hint. When a NON-financial card has been through
          enrichment (cb_enrich_v current) but Screener still yields no quarterly table,
          show a muted note so the empty gap reads as "Screener can't parse this one",
          NOT "the Fill button is broken / data is missing". */}
      {density !== 'ultra' && (() => {
        const e: any = entry;
        const hasTrend = Array.isArray(e.quarters_opm) || Array.isArray(e.quarters_tax_pct)
          || Array.isArray(e.quarters_other_income_pct) || Array.isArray(e.annual_cfo_pat);
        if (hasTrend) return null; // real Q-TRENDS pills already rendered above
        // zzz376 — ALWAYS say WHY the Q-TRENDS strip is absent instead of leaving a
        // blank gap the user reads as a bug. Three honest states:
        const base = { fontSize: 8.5, color: 'var(--mc-text-4)', fontStyle: 'italic' as const, paddingTop: 2 };
        if (cbIsFinancial(entry)) {
          return (
            <div style={base} title="Q-TRENDS (OPM / Other-Income / Tax / CFO-PAT-annual) measure operating-margin & cash quality. For banks / NBFCs / holding & investment companies those aren't meaningful (their 'operating margin' and 'cash from operations' mix financing flows), so the strip is intentionally omitted — same reason CFO/PAT shows n/m.">
              Q-TRENDS n/a — financial company (margin/tax trends not meaningful)
            </div>
          );
        }
        const status = e._trends_status as string | undefined;
        const tried = ((e.cb_enrich_v || 0) >= 375) || ((e.cb_trend_attempts || 0) >= 2);
        // zzz376 — three distinct, honest states, colour-coded so GENUINELY-ABSENT
        // (grey) is visually different from a FETCH BUG (amber) the user can retry.
        if (status === 'no-table') {
          return (
            <div style={base} title="A Screener page DID load for this ticker but it has no quarterly results table — so the trend data is GENUINELY absent, not a fetch error. Nothing to retry. (Header stats like OPM / ROCE / CFO-PAT come from a different source and are unaffected.)">
              Q-TRENDS n/a — genuinely absent (Screener has no quarterly table)
            </div>
          );
        }
        if (status === 'fetch-failed') {
          return (
            <div style={{ ...base, color: '#F59E0B', fontStyle: 'normal' }} title="Screener could NOT be reached for this ticker (403 / rate-limit / timeout) — so we don't yet know if trends exist. This is a TRANSIENT fetch failure, not missing data. Click ⟳ Fill missing to retry, or reload in a minute.">
              ⚠ Q-TRENDS unavailable — Screener fetch failed (transient · click ⟳ Fill missing to retry)
            </div>
          );
        }
        if (!tried) {
          return (
            <div style={base} title="Q-TRENDS come from Screener's quarterly table and are still being fetched. If they don't appear after a moment, click ⟳ Fill missing to force a fresh scrape.">
              ⟳ Q-TRENDS loading… (auto-filling from Screener)
            </div>
          );
        }
        // Tried, but the server never told us why (older cached entry). Neutral wording.
        return (
          <div style={base} title="Q-TRENDS (OPM / Other-Income / Tax / CFO-PAT-annual) come from Screener's quarterly table and haven't been captured for this ticker yet. Click ⟳ Fill missing to force a fresh scrape; if it still doesn't appear, Screener likely has no quarterly table for it.">
            Q-TRENDS not captured yet — click ⟳ Fill missing to retry
          </div>
        );
      })()}
      {/* zzz354 — RED FLAGS row: quality-of-earnings warning badges computed from
          existing bench fields. Only renders when at least one flag is triggered.
          Flags: (1) CFO/PAT < 0.5 = cash conversion broken;
                 (2) PAT growth > 3× Sales growth = margin windfall (not sustainable);
                 (3) EPS growth wildly different from PAT growth = share-count noise;
                 (4) OPM contracted > 3pp = margin deterioration;
                 (5) DRIFT negative post beat = market disbelief. */}
      {density !== 'ultra' && (() => {
        const flags: Array<{icon: string; label: string; tip: string}> = [];
        const cfoR = (entry as any).cfo_to_pat_ratio;
        const sales = entry.sales_yoy_pct;
        const pat = entry.net_profit_yoy_pct;
        const eps = entry.eps_yoy_pct;
        const opmD = typeof (entry as any).opm_pct === 'number' && typeof (entry as any).opm_prev_pct === 'number'
          ? ((entry as any).opm_pct - (entry as any).opm_prev_pct) : null;
        const drift = (entry as any).move_pct;
        if (typeof cfoR === 'number' && cfoR > 0 && cfoR < 0.5 && !cbIsFinancial(entry)) { // zzz362/zzz364 (BUG 6) — only genuine weak-but-positive (0<r<0.5); negative/huge are artifacts, financials exempt
          flags.push({icon:'🚩', label:'CASH-CONV', tip:`CFO/PAT ${cfoR.toFixed(2)} — annual cash conversion below 0.5 (but positive). Reported profit isn't translating into cash. Investigate receivables/inventory build.`});
        }
        // zzz366 — mirror cbComputeQuality: a cash-confirmed beat (CFO/PAT ≥1.5)
        // has its profit spike validated by real cash, so MARGIN-SPIKE would be a
        // false positive. Suppress the flag here too so the card and the verdict
        // agree (both suppress) instead of showing a red flag the verdict ignored.
        const _cashConfirmed = typeof cfoR === 'number' && cfoR >= 1.5 && cfoR <= 5 && !cbIsFinancial(entry);  // zzz372 — same band as cbComputeQuality (>5 = artifact, not confirmation)
        if (typeof sales === 'number' && typeof pat === 'number' && sales > 5 && pat > 5 * sales && !_cashConfirmed) {
          flags.push({icon:'⚠️', label:'MARGIN-SPIKE', tip:`PAT +${pat.toFixed(0)}% vs Sales +${sales.toFixed(0)}% (${(pat/sales).toFixed(1)}× ratio). Big margin expansion — check if driven by one-off / low base / other income. Rarely sustains.`});
        }
        if (typeof eps === 'number' && typeof pat === 'number' && Math.abs(pat) > 10 && Math.abs(eps - pat) > 30) {
          flags.push({icon:'⚠️', label:'EPS≠PAT', tip:`EPS ${eps.toFixed(0)}% vs PAT ${pat.toFixed(0)}%. Wide gap suggests share-count change (buyback/dilution/split). Verify EPS number.`});
        }
        if (typeof opmD === 'number' && opmD < -3) {
          flags.push({icon:'🔴', label:'OPM-DROP', tip:`OPM contracted ${opmD.toFixed(1)}pp YoY. Margin deterioration — pricing pressure, cost inflation, or mix shift.`});
        }
        if (typeof drift === 'number' && drift < -5 && ['BLOCKBUSTER','ELITE','STRONG'].includes(String(entry.tier || '').toUpperCase())) {
          flags.push({icon:'📉', label:'MKT-DOUBT', tip:`Stock is ${drift.toFixed(1)}% below filing-day price despite ${entry.tier} print. Market is fading the beat — sustainability suspicion or forward-guidance concern.`});
        }
        if (flags.length === 0) return null;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingTop: 3, marginTop: 2, borderTop: '1px dashed rgba(239,68,68,0.20)' }}>
            {flags.map((f, i) => (
              <span key={i} title={f.tip} style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 3, cursor: 'help',
                background: 'rgba(239,68,68,0.10)', color: '#F87171', fontWeight: 700,
                border: '1px solid rgba(239,68,68,0.25)', letterSpacing: '0.3px'
              }}>{f.icon} {f.label}</span>
            ))}
          </div>
        );
      })()}
      {/* zzz251 — Peer strip: median PEAD + DRIFT of same-sector bench entries.
          Reads window.__cbAllEntries which we populate once per render pass. */}
      {(() => {
        const mySec = resolveSector(entry);
        if (!mySec) return null;
        const all: any[] = (typeof window !== 'undefined' && (window as any).__cbAllEntries) || [];
        const peers = all.filter((p) => resolveSector(p) === mySec && p.ticker !== entry.ticker);
        if (peers.length < 2) return null;
        const peerPeads = peers.map((p) => peadScore(p).score).filter((n) => Number.isFinite(n));
        const peerDrifts = peers.map((p: any) => p.move_pct).filter((n: any) => typeof n === 'number' && Number.isFinite(n));
        const median = (arr: number[]) => {
          if (arr.length === 0) return null;
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        const medPead = median(peerPeads);
        const medDrift = median(peerDrifts);
        const myPead = peadScore(entry).score;
        const myDrift = typeof (entry as any).move_pct === 'number' ? (entry as any).move_pct : null;
        const peadDelta = medPead != null ? myPead - medPead : null;
        const driftDelta = medDrift != null && myDrift != null ? myDrift - medDrift : null;
        return (
          <div title={`Sector peers (${peers.length} in bench): median PEAD ${medPead?.toFixed(0) ?? '—'}, median DRIFT ${medDrift != null ? (medDrift >= 0 ? '+' : '') + medDrift.toFixed(1) + '%' : '—'}. Positive delta = you're beating sector.`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>
            <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: sectorColor(mySec) }} />
            <span style={{ fontWeight: 700, marginRight: 4 }}>vs {peers.length} {mySec.slice(0, 18)} peer{peers.length === 1 ? '' : 's'}:</span>
            {peadDelta != null && (<span style={{ marginRight: 6 }}>PEAD <strong style={{ color: peadDelta >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{peadDelta >= 0 ? '+' : ''}{peadDelta.toFixed(0)}</strong></span>)}
            {driftDelta != null && (<span>DRIFT <strong style={{ color: driftDelta >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{driftDelta >= 0 ? '+' : ''}{driftDelta.toFixed(1)}%</strong></span>)}
          </div>
        );
      })()}
      {/* zzz251 — DRIFT PATH mini-chart. zzz253 — show pending placeholder for fresh filings. */}
      {(() => {
        const pts = ['gap_pct','d1_pct','d2_pct','move_pct'].filter(k => typeof (entry as any)[k] === 'number' && Number.isFinite((entry as any)[k])).length;
        if (pts >= 2) {
          return (
            <div style={{ marginTop: 4, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
              <DriftPath entry={entry} width={130} height={26} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 9, color: 'var(--mc-text-4)', letterSpacing: '0.3px', fontWeight: 700 }}>DRIFT PATH</span>
                <span style={{ fontSize: 8, color: 'var(--mc-text-4)', letterSpacing: '0.2px' }}>Gap · D1 · D2 · Now</span>
              </div>
            </div>
          );
        }
        // zzz253 — placeholder for cards without any price data yet (bhavcopy lag)
        return (
          <div title="Bhavcopy for this filing date hasn't published yet. NSE typically publishes daily bhavcopy by 18:00 IST. Chart will populate on next enrichment." style={{ marginTop: 2, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>
            <span>⏳</span>
            <span style={{ fontWeight: 700 }}>DRIFT PATH</span>
            <span style={{ opacity: 0.7 }}>awaiting price data (bhavcopy lag)</span>
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
      {/* zzz245 — Filing link moved to ticker; bottom-of-card link removed for
          institutional cleanliness. */}
    </div>
  );
}
