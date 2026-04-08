'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown } from 'lucide-react';

interface Stock {
  ticker: string;
  company: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  previousClose: number;
  cap: string; // 'Large' | 'Mid' | 'Small'
}

type CapFilter = 'All' | 'Large' | 'Mid' | 'Small' | 'Mid & Small';
type MoveToken = '+2%' | '+4%' | '+6%' | '-2%' | '-4%' | '-6%';
type SortKey = 'ticker' | 'sector' | 'cap' | 'price' | 'changePercent' | 'volume';
type SortDir = 'asc' | 'desc';
interface SortState { key: SortKey; dir: SortDir }

const BG = '#0A0E1A', CARD = '#0D1623', BORDER = '#1A2840', ACCENT = '#0F7ABF';
const GREEN = '#10B981', RED = '#EF4444', TEXT1 = '#F5F7FA', TEXT2 = '#8A95A3', TEXT3 = '#4A5B6C';

function formatVol(v: number): string {
  if (v >= 1e7) return (v / 1e7).toFixed(1) + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v || 0);
}

function formatTime(d: Date | null): string {
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--';
}

function classifyCap(s: { indexGroup?: string; marketCap?: number }): string {
  if (s.indexGroup === 'Large' || s.indexGroup === 'Mid' || s.indexGroup === 'Small') return s.indexGroup;
  const mcap = s.marketCap || 0;
  if (mcap > 500_000_000_000) return 'Large';
  if (mcap > 100_000_000_000) return 'Mid';
  return 'Small';
}

function isValidStock(s: { ticker?: string; price?: number }): boolean {
  const t = s.ticker || '';
  if (t.includes(' ') || t.startsWith('NIFTY') || t.startsWith('NIFTY_')) return false;
  if (!t || (s.price || 0) <= 0) return false;
  return true;
}

function passesMoveFiler(pct: number, active: Set<MoveToken>): boolean {
  if (active.size === 0) return true;
  for (const token of active) {
    switch (token) {
      case '+2%': if (pct >= 2) return true; break;
      case '+4%': if (pct >= 4) return true; break;
      case '+6%': if (pct >= 6) return true; break;
      case '-2%': if (pct <= -2) return true; break;
      case '-4%': if (pct <= -4) return true; break;
      case '-6%': if (pct <= -6) return true; break;
    }
  }
  return false;
}

// ── Responsive hook ──────────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

export default function MoversPage() {
  const [allStocks, setAllStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [capFilter, setCapFilter] = useState<CapFilter>('All');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [moveTokens, setMoveTokens] = useState<Set<MoveToken>>(new Set());
  const [gainerSort, setGainerSort] = useState<SortState>({ key: 'changePercent', dir: 'desc' });
  const [loserSort, setLoserSort] = useState<SortState>({ key: 'changePercent', dir: 'asc' });

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;
  const isTablet = windowWidth >= 640 && windowWidth < 1024;

  const toggleSort = useCallback((table: 'gainer' | 'loser', key: SortKey) => {
    const setter = table === 'gainer' ? setGainerSort : setLoserSort;
    const defaultDir = table === 'gainer' ? 'desc' : 'asc';
    setter(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      const dir = key === 'ticker' || key === 'sector' || key === 'cap' ? 'asc' : defaultDir;
      return { key, dir };
    });
  }, []);

  const toggleMove = useCallback((token: MoveToken) => {
    setMoveTokens(prev => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setCapFilter('All');
    setSectorFilter('All');
    setMoveTokens(new Set());
  }, []);

  const hasActiveFilters = capFilter !== 'All' || sectorFilter !== 'All' || moveTokens.size > 0;

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      setIsRefreshing(true);
      const res = await fetch('/api/market/quotes?market=india');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();

      const stocks: Stock[] = (json.stocks || [])
        .filter(isValidStock)
        .map((s: Record<string, unknown>) => ({
          ticker: s.ticker as string,
          company: (s.company as string) || (s.ticker as string),
          sector: (s.sector as string) || 'Other',
          price: (s.price as number) || 0,
          change: (s.change as number) || 0,
          changePercent: (s.changePercent as number) || 0,
          volume: (s.volume as number) || 0,
          marketCap: (s.marketCap as number) || 0,
          previousClose: (s.previousClose as number) || 0,
          cap: classifyCap({ indexGroup: s.indexGroup as string, marketCap: s.marketCap as number }),
        }));

      setAllStocks(stocks);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const i = setInterval(fetchData, 60000); return () => clearInterval(i); }, [fetchData]);

  const filtered = useMemo(() => {
    return allStocks.filter(s => {
      if (capFilter === 'Mid & Small' && s.cap === 'Large') return false;
      if (capFilter !== 'All' && capFilter !== 'Mid & Small' && s.cap !== capFilter) return false;
      if (sectorFilter !== 'All' && s.sector !== sectorFilter) return false;
      if (!passesMoveFiler(s.changePercent, moveTokens)) return false;
      return true;
    });
  }, [allStocks, capFilter, sectorFilter, moveTokens]);

  const sortStocks = useCallback((stocks: Stock[], sort: SortState): Stock[] => {
    const mult = sort.dir === 'asc' ? 1 : -1;
    return [...stocks].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'ticker': cmp = a.ticker.localeCompare(b.ticker); break;
        case 'sector': cmp = a.sector.localeCompare(b.sector); break;
        case 'cap': {
          const order: Record<string, number> = { Large: 0, Mid: 1, Small: 2 };
          cmp = (order[a.cap] ?? 3) - (order[b.cap] ?? 3);
          break;
        }
        case 'price': cmp = a.price - b.price; break;
        case 'changePercent': cmp = a.changePercent - b.changePercent; break;
        case 'volume': cmp = a.volume - b.volume; break;
      }
      return cmp * mult;
    });
  }, []);

  const gainers = useMemo(() => {
    const base = filtered.filter(s => s.changePercent > 0);
    return sortStocks(base, gainerSort).slice(0, 25);
  }, [filtered, gainerSort, sortStocks]);

  const losers = useMemo(() => {
    const base = filtered.filter(s => s.changePercent < 0);
    return sortStocks(base, loserSort).slice(0, 25);
  }, [filtered, loserSort, sortStocks]);

  const sectors = useMemo(() => {
    const sectorSet = new Set(allStocks.map(s => s.sector));
    return ['All', ...[...sectorSet].sort()];
  }, [allStocks]);

  const sectorPerf = useMemo(() => {
    const base = capFilter === 'All' ? allStocks
      : capFilter === 'Mid & Small' ? allStocks.filter(s => s.cap !== 'Large')
      : allStocks.filter(s => s.cap === capFilter);
    const map = new Map<string, { total: number; count: number }>();
    for (const s of base) {
      const e = map.get(s.sector) || { total: 0, count: 0 };
      e.total += s.changePercent;
      e.count += 1;
      map.set(s.sector, e);
    }
    return [...map.entries()]
      .map(([sector, { total, count }]) => ({ sector, avg: total / count, count }))
      .sort((a, b) => b.avg - a.avg);
  }, [allStocks, capFilter]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const gCount = filtered.filter(s => s.changePercent > 0).length;
    const lCount = filtered.filter(s => s.changePercent < 0).length;
    const avg = total > 0 ? filtered.reduce((sum, s) => sum + s.changePercent, 0) / total : 0;
    const sectorCount = new Set(filtered.map(s => s.sector)).size;
    return { total, gainersCount: gCount, losersCount: lCount, avgChange: avg, sectors: sectorCount };
  }, [filtered]);

  const capCounts = useMemo(() => {
    const large = allStocks.filter(s => s.cap === 'Large').length;
    const mid = allStocks.filter(s => s.cap === 'Mid').length;
    const small = allStocks.filter(s => s.cap === 'Small').length;
    return { large, mid, small };
  }, [allStocks]);

  // --- UI Components ---

  const CapPill = ({ label, value, count }: { label: string; value: CapFilter; count: number }) => (
    <button onClick={() => setCapFilter(value)} style={{
      padding: isMobile ? '5px 9px' : '5px 12px',
      borderRadius: '6px', border: 'none',
      fontSize: isMobile ? '10px' : '11px', fontWeight: '500',
      backgroundColor: capFilter === value ? ACCENT : 'transparent',
      color: capFilter === value ? '#fff' : TEXT2,
      cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
      display: 'flex', alignItems: 'center', gap: '3px',
    }}>
      {label}
      {!isMobile && <span style={{ fontSize: '9px', opacity: 0.7 }}>({count})</span>}
    </button>
  );

  const MoveChip = ({ token, label, color }: { token: MoveToken; label: string; color: string }) => {
    const active = moveTokens.has(token);
    return (
      <button onClick={() => toggleMove(token)} style={{
        padding: '4px 9px', borderRadius: '5px', fontSize: '11px', fontWeight: '600',
        border: active ? `1.5px solid ${color}` : `1px solid ${BORDER}`,
        backgroundColor: active ? `${color}18` : 'transparent',
        color: active ? color : TEXT3,
        cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
        letterSpacing: '0.3px',
      }}>
        {label}
      </button>
    );
  };

  // Mobile card row — compact, no Sector/Vol columns
  const MobileRow = ({ stock, rank, up }: { stock: Stock; rank: number; up: boolean }) => (
    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
      <td style={{ padding: '8px 6px', color: TEXT3, fontSize: '11px', width: '24px' }}>{rank}</td>
      <td style={{ padding: '8px 4px' }}>
        <div style={{ fontWeight: '700', fontSize: '12px', color: ACCENT }}>{stock.ticker}</div>
        <div style={{ fontSize: '9px', color: TEXT3, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stock.company}</div>
      </td>
      <td style={{ padding: '8px 4px', textAlign: 'right', fontSize: '12px', color: TEXT1, fontWeight: '500', fontVariantNumeric: 'tabular-nums' }}>
        ₹{stock.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </td>
      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: '700', color: up ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
          {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
        </div>
        <div style={{ fontSize: '9px', color: TEXT3, textAlign: 'right', marginTop: '1px' }}>
          <span style={{
            fontSize: '8px', fontWeight: '600', padding: '1px 4px', borderRadius: '2px',
            backgroundColor: stock.cap === 'Large' ? 'rgba(99,102,241,0.15)' : stock.cap === 'Mid' ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
            color: stock.cap === 'Large' ? '#818CF8' : stock.cap === 'Mid' ? '#60A5FA' : '#FBBF24',
          }}>{stock.cap === 'Large' ? 'LRG' : stock.cap === 'Mid' ? 'MID' : 'SML'}</span>
        </div>
      </td>
    </tr>
  );

  // Desktop full row
  const Row = ({ stock, rank, up }: { stock: Stock; rank: number; up: boolean }) => (
    <tr style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#111B35')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
      <td style={{ padding: '10px 12px', color: TEXT3, fontSize: '12px', width: '36px' }}>{rank}</td>
      <td style={{ padding: '10px 8px' }}>
        <div style={{ fontWeight: '600', fontSize: '13px', color: ACCENT }}>{stock.ticker}</div>
        <div style={{ fontSize: '10px', color: TEXT3, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stock.company}</div>
      </td>
      {!isTablet && <td style={{ padding: '10px 8px', fontSize: '12px', color: TEXT2 }}>{stock.sector}</td>}
      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
        <span style={{
          fontSize: '9px', fontWeight: '600', padding: '2px 6px', borderRadius: '3px',
          backgroundColor: stock.cap === 'Large' ? 'rgba(99,102,241,0.15)' : stock.cap === 'Mid' ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
          color: stock.cap === 'Large' ? '#818CF8' : stock.cap === 'Mid' ? '#60A5FA' : '#FBBF24',
        }}>{stock.cap === 'Large' ? 'LRG' : stock.cap === 'Mid' ? 'MID' : 'SML'}</span>
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: '13px', color: TEXT1, fontWeight: '500', fontVariantNumeric: 'tabular-nums' }}>
        ₹{stock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '13px', fontWeight: '700', color: up ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </div>
      </td>
      {!isTablet && <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: '12px', color: TEXT3, fontVariantNumeric: 'tabular-nums' }}>{formatVol(stock.volume)}</td>}
    </tr>
  );

  // Desktop column definitions
  const desktopColumns: { label: string; key: SortKey | null; align: 'left' | 'center' | 'right' }[] = [
    { label: '#', key: null, align: 'left' },
    { label: 'Stock', key: 'ticker', align: 'left' },
    ...(!isTablet ? [{ label: 'Sector', key: 'sector' as SortKey, align: 'left' as const }] : []),
    { label: 'Cap', key: 'cap', align: 'center' },
    { label: 'Price', key: 'price', align: 'right' },
    { label: 'Change', key: 'changePercent', align: 'right' },
    ...(!isTablet ? [{ label: 'Vol', key: 'volume' as SortKey, align: 'right' as const }] : []),
  ];

  // Mobile column definitions (no sector/vol)
  const mobileColumns: { label: string; key: SortKey | null; align: 'left' | 'center' | 'right' }[] = [
    { label: '#', key: null, align: 'left' },
    { label: 'Stock', key: 'ticker', align: 'left' },
    { label: 'Price', key: 'price', align: 'right' },
    { label: 'Chg%', key: 'changePercent', align: 'right' },
  ];

  const columns = isMobile ? mobileColumns : desktopColumns;

  const SortableHeader = ({ col, sort, table }: { col: typeof columns[0]; sort: SortState; table: 'gainer' | 'loser' }) => {
    const active = col.key !== null && sort.key === col.key;
    return (
      <th
        onClick={col.key ? () => toggleSort(table, col.key!) : undefined}
        style={{
          padding: isMobile ? '6px 4px' : '8px',
          textAlign: col.align,
          fontSize: isMobile ? '9px' : '10px',
          color: active ? ACCENT : TEXT3,
          fontWeight: active ? '700' : '500', textTransform: 'uppercase', letterSpacing: '0.5px',
          position: 'sticky', top: 0, backgroundColor: BG, zIndex: 1,
          cursor: col.key ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          {col.label}
          {active && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
        </span>
      </th>
    );
  };

  const px = isMobile ? '10px 12px' : '16px 20px';

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: px }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        gap: isMobile ? '8px' : '0',
        marginBottom: '14px',
      }}>
        <div>
          <h1 style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: '700', margin: 0, letterSpacing: '-0.3px' }}>
            Market Movers
          </h1>
          <p style={{ fontSize: '11px', color: TEXT3, margin: '2px 0 0' }}>
            NIFTY 500 + Midcap 250 + Smallcap 250 — Live from NSE
            {!isMobile && allStocks.length > 0 && (
              <span style={{ marginLeft: '8px', color: TEXT2 }}>
                ({capCounts.large} Large · {capCounts.mid} Mid · {capCounts.small} Small)
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {isMobile && allStocks.length > 0 && (
            <span style={{ fontSize: '10px', color: TEXT3 }}>
              {capCounts.large}L · {capCounts.mid}M · {capCounts.small}S
            </span>
          )}
          <button onClick={fetchData} disabled={isRefreshing} style={{
            padding: '6px 12px', borderRadius: '6px', border: `1px solid ${BORDER}`, backgroundColor: CARD, color: ACCENT,
            cursor: isRefreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
            opacity: isRefreshing ? 0.5 : 1, transition: 'all 0.2s',
          }}>
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {!isMobile && 'Refresh'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: TEXT3 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: GREEN, animation: 'pulse 2s ease infinite' }} />
            {formatTime(lastUpdated)}
          </div>
        </div>
      </div>

      {/* Summary Cards — 3 cols on mobile, 5 on desktop */}
      {!loading && allStocks.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)',
          gap: isMobile ? '6px' : '10px',
          marginBottom: '14px',
        }}>
          {[
            { l: 'Total', v: summary.total, c: TEXT1 },
            { l: 'Gainers', v: summary.gainersCount, c: GREEN },
            { l: 'Losers', v: summary.losersCount, c: RED },
            { l: 'Avg', v: `${summary.avgChange > 0 ? '+' : ''}${summary.avgChange.toFixed(2)}%`, c: summary.avgChange >= 0 ? GREEN : RED },
            { l: 'Sectors', v: summary.sectors, c: ACCENT },
          ].map((card, i) => (
            <div key={i} style={{
              backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px',
              padding: isMobile ? '8px 10px' : '12px',
              // On mobile, last card wraps to next row spanning full width? No — just show all 5 in 3+2 layout
              // Actually we'll let the last two flow naturally at 3-col
            }}>
              <div style={{ fontSize: isMobile ? '9px' : '10px', color: TEXT3, marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.l}</div>
              <div style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: '700', color: card.c, fontVariantNumeric: 'tabular-nums' }}>{card.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters — scrollable row on mobile */}
      {!loading && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            display: 'flex', gap: '8px', alignItems: 'center',
            overflowX: 'auto', paddingBottom: '4px',
            // Hide scrollbar visually
            msOverflowStyle: 'none', scrollbarWidth: 'none',
          }} className="scrollbar-hide">
            {/* Cap filter */}
            <div style={{
              display: 'flex', gap: '2px', backgroundColor: CARD, padding: '3px',
              borderRadius: '8px', border: `1px solid ${BORDER}`, flexShrink: 0,
            }}>
              <CapPill label="All" value="All" count={allStocks.length} />
              <CapPill label="Large" value="Large" count={capCounts.large} />
              <CapPill label="Mid" value="Mid" count={capCounts.mid} />
              <CapPill label="Small" value="Small" count={capCounts.small} />
              {!isMobile && <CapPill label="Mid & Small" value="Mid & Small" count={capCounts.mid + capCounts.small} />}
            </div>

            <div style={{ width: '1px', height: '24px', backgroundColor: BORDER, flexShrink: 0 }} />

            {/* Move filters */}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '9px', color: TEXT3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Up</span>
              <MoveChip token="+2%" label="+2%" color={GREEN} />
              <MoveChip token="+4%" label="+4%" color={GREEN} />
              {!isMobile && <MoveChip token="+6%" label="+6%" color={GREEN} />}
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '9px', color: TEXT3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dn</span>
              <MoveChip token="-2%" label="-2%" color={RED} />
              <MoveChip token="-4%" label="-4%" color={RED} />
              {!isMobile && <MoveChip token="-6%" label="-6%" color={RED} />}
            </div>

            {/* Sector dropdown */}
            <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} style={{
              padding: '5px 8px', backgroundColor: CARD, color: TEXT2, border: `1px solid ${BORDER}`,
              borderRadius: '8px', fontSize: '11px', outline: 'none', cursor: 'pointer', flexShrink: 0,
              maxWidth: isMobile ? '130px' : 'none',
            }}>
              {sectors.map(s => <option key={s} value={s}>{s === 'All' ? 'All Sectors' : s}</option>)}
            </select>

            {/* Clear button */}
            {hasActiveFilters && (
              <button onClick={clearAllFilters} style={{
                padding: '5px 10px', borderRadius: '6px', border: `1px solid ${BORDER}`,
                backgroundColor: 'rgba(239,68,68,0.08)', color: RED, fontSize: '11px',
                cursor: 'pointer', fontWeight: '500', flexShrink: 0, whiteSpace: 'nowrap',
              }}>Clear</button>
            )}
          </div>
        </div>
      )}

      {/* Sector Heatbar */}
      {!loading && sectorPerf.length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }} className="scrollbar-hide">
            {sectorPerf.map(sp => (
              <button key={sp.sector} onClick={() => setSectorFilter(sectorFilter === sp.sector ? 'All' : sp.sector)} style={{
                flexShrink: 0,
                padding: isMobile ? '6px 10px' : '8px 14px',
                borderRadius: '8px', border: 'none',
                backgroundColor: sp.avg >= 0
                  ? `rgba(16,185,129,${Math.min(0.35, Math.abs(sp.avg) * 0.06 + 0.08)})`
                  : `rgba(239,68,68,${Math.min(0.35, Math.abs(sp.avg) * 0.06 + 0.08)})`,
                cursor: 'pointer', transition: 'all 0.15s',
                outline: sectorFilter === sp.sector ? `2px solid ${ACCENT}` : 'none', outlineOffset: '1px',
              }}>
                <div style={{ fontSize: isMobile ? '10px' : '11px', fontWeight: '600', color: TEXT1, whiteSpace: 'nowrap', marginBottom: '2px' }}>{sp.sector}</div>
                <div style={{ fontSize: isMobile ? '11px' : '13px', fontWeight: '700', color: sp.avg >= 0 ? GREEN : RED }}>{sp.avg > 0 ? '+' : ''}{sp.avg.toFixed(1)}%</div>
                {!isMobile && <div style={{ fontSize: '9px', color: TEXT3 }}>{sp.count} stocks</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
          <div style={{ width: '36px', height: '36px', border: '3px solid #1A2840', borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px', color: RED, fontSize: '13px', marginBottom: '14px' }}>{error}</div>
      )}

      {/* Gainers / Losers tables */}
      {!loading && allStocks.length > 0 && (
        <div style={{
          display: 'grid',
          // Stack vertically on mobile and tablet
          gridTemplateColumns: isMobile ? '1fr' : isTablet ? '1fr' : '1fr 1fr',
          gap: '14px',
        }}>
          {/* Gainers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={15} color={GREEN} />
              <span style={{ fontSize: isMobile ? '13px' : '14px', fontWeight: '600' }}>Top Gainers</span>
              <span style={{ fontSize: '10px', color: GREEN, backgroundColor: 'rgba(16,185,129,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{gainers.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: '9px', color: GREEN, fontWeight: '700', backgroundColor: 'rgba(16,185,129,0.15)', padding: '2px 8px', borderRadius: '3px' }}>LIVE</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: isMobile ? '400px' : '550px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: BG }}>
                    {columns.map(col => <SortableHeader key={col.label} col={col} sort={gainerSort} table="gainer" />)}
                  </tr>
                </thead>
                <tbody>
                  {gainers.map((s, i) => isMobile
                    ? <MobileRow key={s.ticker} stock={s} rank={i + 1} up={true} />
                    : <Row key={s.ticker} stock={s} rank={i + 1} up={true} />
                  )}
                  {gainers.length === 0 && <tr><td colSpan={columns.length} style={{ padding: '28px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No gainers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Losers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingDown size={15} color={RED} />
              <span style={{ fontSize: isMobile ? '13px' : '14px', fontWeight: '600' }}>Top Losers</span>
              <span style={{ fontSize: '10px', color: RED, backgroundColor: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{losers.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: '9px', color: RED, fontWeight: '700', backgroundColor: 'rgba(239,68,68,0.15)', padding: '2px 8px', borderRadius: '3px' }}>LIVE</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: isMobile ? '400px' : '550px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: BG }}>
                    {columns.map(col => <SortableHeader key={col.label} col={col} sort={loserSort} table="loser" />)}
                  </tr>
                </thead>
                <tbody>
                  {losers.map((s, i) => isMobile
                    ? <MobileRow key={s.ticker} stock={s} rank={i + 1} up={false} />
                    : <Row key={s.ticker} stock={s} rank={i + 1} up={false} />
                  )}
                  {losers.length === 0 && <tr><td colSpan={columns.length} style={{ padding: '28px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No losers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
