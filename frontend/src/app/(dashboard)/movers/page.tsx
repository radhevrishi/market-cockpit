'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';

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

type CapFilter = 'All' | 'Large' | 'Mid' | 'Small';
type MoveFilter = 'All' | '2%+' | '4%+' | '6%+';

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
  // Prefer server-side classification from index membership
  if (s.indexGroup === 'Large' || s.indexGroup === 'Mid' || s.indexGroup === 'Small') return s.indexGroup;
  // Fallback: market cap thresholds (raw rupees from NSE ffmc)
  const mcap = s.marketCap || 0;
  if (mcap > 500_000_000_000) return 'Large';
  if (mcap > 100_000_000_000) return 'Mid';
  return 'Small';
}

function isValidStock(s: { ticker?: string; price?: number }): boolean {
  const t = s.ticker || '';
  // Filter out index rows (NIFTY 500, NIFTY MIDCAP 250, etc.)
  if (t.includes(' ') || t.startsWith('NIFTY') || t.startsWith('NIFTY_')) return false;
  if (!t || (s.price || 0) <= 0) return false;
  return true;
}

export default function MoversPage() {
  const [allStocks, setAllStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [capFilter, setCapFilter] = useState<CapFilter>('All');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [moveFilter, setMoveFilter] = useState<MoveFilter>('All');

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

  // Derived data — all memos depend on filters
  const filtered = useMemo(() => {
    return allStocks.filter(s => {
      if (capFilter !== 'All' && s.cap !== capFilter) return false;
      if (sectorFilter !== 'All' && s.sector !== sectorFilter) return false;
      const a = Math.abs(s.changePercent);
      if (moveFilter === '2%+' && a < 2) return false;
      if (moveFilter === '4%+' && a < 4) return false;
      if (moveFilter === '6%+' && a < 6) return false;
      return true;
    });
  }, [allStocks, capFilter, sectorFilter, moveFilter]);

  const gainers = useMemo(() =>
    [...filtered].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 25),
    [filtered]
  );

  const losers = useMemo(() =>
    [...filtered].filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 25),
    [filtered]
  );

  const sectors = useMemo(() => {
    const sectorSet = new Set(allStocks.map(s => s.sector));
    return ['All', ...[...sectorSet].sort()];
  }, [allStocks]);

  // Sector performance — responds to cap filter only (not sector filter)
  const sectorPerf = useMemo(() => {
    const base = capFilter === 'All' ? allStocks : allStocks.filter(s => s.cap === capFilter);
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

  // Summary stats — reflect current filters
  const summary = useMemo(() => {
    const total = filtered.length;
    const gCount = filtered.filter(s => s.changePercent > 0).length;
    const lCount = filtered.filter(s => s.changePercent < 0).length;
    const avg = total > 0 ? filtered.reduce((sum, s) => sum + s.changePercent, 0) / total : 0;
    const sectorCount = new Set(filtered.map(s => s.sector)).size;
    return { total, gainersCount: gCount, losersCount: lCount, avgChange: avg, sectors: sectorCount };
  }, [filtered]);

  // Cap distribution for info
  const capCounts = useMemo(() => {
    const large = allStocks.filter(s => s.cap === 'Large').length;
    const mid = allStocks.filter(s => s.cap === 'Mid').length;
    const small = allStocks.filter(s => s.cap === 'Small').length;
    return { large, mid, small };
  }, [allStocks]);

  const Pill = ({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) => (
    <button onClick={onClick} style={{
      padding: '5px 12px', borderRadius: '6px', border: 'none', fontSize: '11px', fontWeight: '500',
      backgroundColor: active ? ACCENT : 'transparent', color: active ? '#fff' : TEXT2,
      cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
      display: 'flex', alignItems: 'center', gap: '4px',
    }}>
      {label}
      {count !== undefined && <span style={{ fontSize: '9px', opacity: 0.7 }}>({count})</span>}
    </button>
  );

  const Row = ({ stock, rank, up }: { stock: Stock; rank: number; up: boolean }) => (
    <tr style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#111B35')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
      <td style={{ padding: '10px 12px', color: TEXT3, fontSize: '12px', width: '36px' }}>{rank}</td>
      <td style={{ padding: '10px 8px' }}>
        <div style={{ fontWeight: '600', fontSize: '13px', color: ACCENT }}>{stock.ticker}</div>
        <div style={{ fontSize: '10px', color: TEXT3, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stock.company}</div>
      </td>
      <td style={{ padding: '10px 8px', fontSize: '12px', color: TEXT2 }}>{stock.sector}</td>
      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
        <span style={{
          fontSize: '9px', fontWeight: '600', padding: '2px 6px', borderRadius: '3px',
          backgroundColor: stock.cap === 'Large' ? 'rgba(99,102,241,0.15)' : stock.cap === 'Mid' ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
          color: stock.cap === 'Large' ? '#818CF8' : stock.cap === 'Mid' ? '#60A5FA' : '#FBBF24',
        }}>{stock.cap === 'Large' ? 'LRG' : stock.cap === 'Mid' ? 'MID' : 'SML'}</span>
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: '13px', color: TEXT1, fontWeight: '500', fontVariantNumeric: 'tabular-nums' }}>
        {'\u20B9'}{stock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '13px', fontWeight: '700', color: up ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </div>
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: '12px', color: TEXT3, fontVariantNumeric: 'tabular-nums' }}>{formatVol(stock.volume)}</td>
    </tr>
  );

  const TH = ['#', 'Stock', 'Sector', 'Cap', 'Price', 'Change', 'Vol'];
  const thAlign = (h: string) => h === 'Price' || h === 'Change' || h === 'Vol' ? 'right' as const : h === 'Cap' ? 'center' as const : 'left' as const;

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0, letterSpacing: '-0.3px' }}>Market Movers</h1>
          <p style={{ fontSize: '11px', color: TEXT3, margin: '2px 0 0' }}>
            NIFTY 500 + Midcap 250 + Smallcap 250 — Live from NSE
            {allStocks.length > 0 && <span style={{ marginLeft: '8px', color: TEXT2 }}>
              ({capCounts.large} Large · {capCounts.mid} Mid · {capCounts.small} Small)
            </span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={fetchData} disabled={isRefreshing} style={{
            padding: '6px 12px', borderRadius: '6px', border: `1px solid ${BORDER}`, backgroundColor: CARD, color: ACCENT,
            cursor: isRefreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
            opacity: isRefreshing ? 0.5 : 1, transition: 'all 0.2s',
          }}>
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: TEXT3 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: GREEN, animation: 'pulse 2s ease infinite' }} />
            {formatTime(lastUpdated)}
          </div>
        </div>
      </div>

      {/* Summary Cards — reflect active filters */}
      {!loading && allStocks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
          {[
            { l: 'Total', v: summary.total, c: TEXT1 },
            { l: 'Gainers', v: summary.gainersCount, c: GREEN },
            { l: 'Losers', v: summary.losersCount, c: RED },
            { l: 'Avg Change', v: `${summary.avgChange > 0 ? '+' : ''}${summary.avgChange.toFixed(2)}%`, c: summary.avgChange >= 0 ? GREEN : RED },
            { l: 'Sectors', v: summary.sectors, c: ACCENT },
          ].map((card, i) => (
            <div key={i} style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: TEXT3, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.l}</div>
              <div style={{ fontSize: '22px', fontWeight: '700', color: card.c, fontVariantNumeric: 'tabular-nums' }}>{card.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {!loading && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '2px', backgroundColor: CARD, padding: '3px', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
            <Pill label="All" active={capFilter === 'All'} onClick={() => setCapFilter('All')} count={allStocks.length} />
            <Pill label="Large" active={capFilter === 'Large'} onClick={() => setCapFilter('Large')} count={capCounts.large} />
            <Pill label="Mid" active={capFilter === 'Mid'} onClick={() => setCapFilter('Mid')} count={capCounts.mid} />
            <Pill label="Small" active={capFilter === 'Small'} onClick={() => setCapFilter('Small')} count={capCounts.small} />
          </div>
          <div style={{ display: 'flex', gap: '2px', backgroundColor: CARD, padding: '3px', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
            {(['All', '2%+', '4%+', '6%+'] as MoveFilter[]).map(f => <Pill key={f} label={f} active={moveFilter === f} onClick={() => setMoveFilter(f)} />)}
          </div>
          <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} style={{
            padding: '5px 10px', backgroundColor: CARD, color: TEXT2, border: `1px solid ${BORDER}`, borderRadius: '8px', fontSize: '11px', outline: 'none', cursor: 'pointer',
          }}>
            {sectors.map(s => <option key={s} value={s}>{s === 'All' ? 'All Sectors' : s}</option>)}
          </select>
          {(capFilter !== 'All' || sectorFilter !== 'All' || moveFilter !== 'All') && (
            <button onClick={() => { setCapFilter('All'); setSectorFilter('All'); setMoveFilter('All'); }} style={{
              padding: '5px 12px', borderRadius: '6px', border: `1px solid ${BORDER}`, backgroundColor: 'rgba(239,68,68,0.08)',
              color: RED, fontSize: '11px', cursor: 'pointer',
            }}>Clear Filters</button>
          )}
        </div>
      )}

      {/* Sector Heatbar — responds to cap filter */}
      {!loading && sectorPerf.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }} className="scrollbar-hide">
            {sectorPerf.map(sp => (
              <button key={sp.sector} onClick={() => setSectorFilter(sectorFilter === sp.sector ? 'All' : sp.sector)} style={{
                flexShrink: 0, padding: '8px 14px', borderRadius: '8px', border: 'none',
                backgroundColor: sp.avg >= 0
                  ? `rgba(16,185,129,${Math.min(0.35, Math.abs(sp.avg) * 0.06 + 0.08)})`
                  : `rgba(239,68,68,${Math.min(0.35, Math.abs(sp.avg) * 0.06 + 0.08)})`,
                cursor: 'pointer', transition: 'all 0.15s',
                outline: sectorFilter === sp.sector ? `2px solid ${ACCENT}` : 'none', outlineOffset: '1px',
              }}>
                <div style={{ fontSize: '11px', fontWeight: '600', color: TEXT1, whiteSpace: 'nowrap', marginBottom: '2px' }}>{sp.sector}</div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: sp.avg >= 0 ? GREEN : RED }}>{sp.avg > 0 ? '+' : ''}{sp.avg.toFixed(1)}%</div>
                <div style={{ fontSize: '9px', color: TEXT3 }}>{sp.count} stocks</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #1A2840', borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '14px', color: RED, fontSize: '13px', marginBottom: '16px' }}>{error}</div>
      )}

      {/* Tables */}
      {!loading && allStocks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Gainers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={16} color={GREEN} />
              <span style={{ fontSize: '14px', fontWeight: '600' }}>Top Gainers</span>
              <span style={{ fontSize: '10px', color: GREEN, backgroundColor: 'rgba(16,185,129,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{gainers.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: '9px', color: GREEN, fontWeight: '700', backgroundColor: 'rgba(16,185,129,0.15)', padding: '2px 8px', borderRadius: '3px' }}>LIVE</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: BG }}>
                    {TH.map(h => <th key={h} style={{ padding: '8px', textAlign: thAlign(h), fontSize: '10px', color: TEXT3, fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.5px', position: 'sticky', top: 0, backgroundColor: BG, zIndex: 1 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {gainers.map((s, i) => <Row key={s.ticker} stock={s} rank={i + 1} up={true} />)}
                  {gainers.length === 0 && <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No gainers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {/* Losers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingDown size={16} color={RED} />
              <span style={{ fontSize: '14px', fontWeight: '600' }}>Top Losers</span>
              <span style={{ fontSize: '10px', color: RED, backgroundColor: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{losers.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: '9px', color: RED, fontWeight: '700', backgroundColor: 'rgba(239,68,68,0.15)', padding: '2px 8px', borderRadius: '3px' }}>LIVE</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: BG }}>
                    {TH.map(h => <th key={h} style={{ padding: '8px', textAlign: thAlign(h), fontSize: '10px', color: TEXT3, fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.5px', position: 'sticky', top: 0, backgroundColor: BG, zIndex: 1 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {losers.map((s, i) => <Row key={s.ticker} stock={s} rank={i + 1} up={false} />)}
                  {losers.length === 0 && <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No losers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
