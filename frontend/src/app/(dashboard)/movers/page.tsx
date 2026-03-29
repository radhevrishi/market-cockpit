'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  indexGroup?: string;
}

interface ApiResponse {
  stocks: Stock[];
  gainers: Stock[];
  losers: Stock[];
  summary: {
    total: number;
    gainersCount: number;
    losersCount: number;
    avgChange: number;
    sectors: number;
  };
  updatedAt: string;
}

type CapFilter = 'All' | 'Large' | 'Mid' | 'Small';
type MoveFilter = 'All' | '2%+' | '4%+' | '6%+';

export default function MoversPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [capFilter, setCapFilter] = useState<CapFilter>('All');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [moveFilter, setMoveFilter] = useState<MoveFilter>('All');

  const fetchData = async () => {
    try {
      setError(null);
      setIsRefreshing(true);
      // Fetch full Indian market data (NIFTY 500 + Midcap 250 + Smallcap 250)
      const res = await fetch('/api/market/quotes?market=india');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();

      const allStocks: Stock[] = (json.stocks || []).map((s: any) => {
        // Tag by market cap (values in raw rupees from NSE ffmc field)
        // Large: >₹50,000 Cr (5×10¹¹), Mid: ₹10,000-50,000 Cr, Small: <₹10,000 Cr
        const mcap = s.marketCap || 0;
        let cap = 'Small';
        if (mcap > 500000000000) cap = 'Large';
        else if (mcap > 100000000000) cap = 'Mid';
        return { ...s, indexGroup: cap };
      });

      const gainers = [...allStocks].sort((a, b) => b.changePercent - a.changePercent).filter(s => s.changePercent > 0);
      const losers = [...allStocks].sort((a, b) => a.changePercent - b.changePercent).filter(s => s.changePercent < 0);

      setData({
        stocks: allStocks, gainers, losers,
        summary: {
          total: allStocks.length,
          gainersCount: gainers.length,
          losersCount: losers.length,
          avgChange: allStocks.length > 0 ? allStocks.reduce((s, st) => s + st.changePercent, 0) / allStocks.length : 0,
          sectors: [...new Set(allStocks.map(s => s.sector))].length,
        },
        updatedAt: new Date().toISOString(),
      });
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { const i = setInterval(fetchData, 60000); return () => clearInterval(i); }, []);

  const sectors = useMemo(() => {
    if (!data) return [];
    return ['All', ...[...new Set(data.stocks.map(s => s.sector))].sort()];
  }, [data]);

  const applyFilters = (stocks: Stock[]) => stocks.filter(s => {
    if (capFilter !== 'All' && s.indexGroup !== capFilter) return false;
    if (sectorFilter !== 'All' && s.sector !== sectorFilter) return false;
    const a = Math.abs(s.changePercent);
    if (moveFilter === '2%+' && a < 2) return false;
    if (moveFilter === '4%+' && a < 4) return false;
    if (moveFilter === '6%+' && a < 6) return false;
    return true;
  });

  const filteredGainers = useMemo(() => data ? applyFilters(data.gainers).slice(0, 25) : [], [data, capFilter, sectorFilter, moveFilter]);
  const filteredLosers = useMemo(() => data ? applyFilters(data.losers).slice(0, 25) : [], [data, capFilter, sectorFilter, moveFilter]);

  const sectorPerf = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { total: number; count: number }>();
    for (const s of data.stocks) {
      const e = map.get(s.sector) || { total: 0, count: 0 };
      e.total += s.changePercent; e.count += 1; map.set(s.sector, e);
    }
    return [...map.entries()].map(([sector, { total, count }]) => ({ sector, avg: total / count, count })).sort((a, b) => b.avg - a.avg);
  }, [data]);

  const formatTime = (d: Date | null) => d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--';
  const formatVol = (v: number) => v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v);

  const BG = '#0A0E1A', CARD = '#0D1623', BORDER = '#1A2840', ACCENT = '#0F7ABF';
  const GREEN = '#10B981', RED = '#EF4444', TEXT1 = '#F5F7FA', TEXT2 = '#8A95A3', TEXT3 = '#4A5B6C';

  const Pill = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button onClick={onClick} style={{
      padding: '5px 12px', borderRadius: '6px', border: 'none', fontSize: '11px', fontWeight: '500',
      backgroundColor: active ? ACCENT : 'transparent', color: active ? '#fff' : TEXT2,
      cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
    }}>{label}</button>
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
          backgroundColor: stock.indexGroup === 'Large' ? 'rgba(99,102,241,0.15)' : stock.indexGroup === 'Mid' ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
          color: stock.indexGroup === 'Large' ? '#818CF8' : stock.indexGroup === 'Mid' ? '#60A5FA' : '#FBBF24',
        }}>{stock.indexGroup === 'Large' ? 'LRG' : stock.indexGroup === 'Mid' ? 'MID' : 'SML'}</span>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0, letterSpacing: '-0.3px' }}>Market Movers</h1>
          <p style={{ fontSize: '11px', color: TEXT3, margin: '2px 0 0' }}>NIFTY 500 + Midcap 250 + Smallcap 250 — Live from NSE</p>
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

      {data && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
          {[
            { l: 'Total', v: data.summary.total, c: TEXT1 },
            { l: 'Gainers', v: data.summary.gainersCount, c: GREEN },
            { l: 'Losers', v: data.summary.losersCount, c: RED },
            { l: 'Avg Change', v: `${data.summary.avgChange > 0 ? '+' : ''}${data.summary.avgChange.toFixed(2)}%`, c: data.summary.avgChange >= 0 ? GREEN : RED },
            { l: 'Sectors', v: data.summary.sectors, c: ACCENT },
          ].map((card, i) => (
            <div key={i} style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: TEXT3, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.l}</div>
              <div style={{ fontSize: '22px', fontWeight: '700', color: card.c, fontVariantNumeric: 'tabular-nums' }}>{card.v}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '2px', backgroundColor: CARD, padding: '3px', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
            {(['All', 'Large', 'Mid', 'Small'] as CapFilter[]).map(f => <Pill key={f} label={f} active={capFilter === f} onClick={() => setCapFilter(f)} />)}
          </div>
          <div style={{ display: 'flex', gap: '2px', backgroundColor: CARD, padding: '3px', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
            {(['All', '2%+', '4%+', '6%+'] as MoveFilter[]).map(f => <Pill key={f} label={f} active={moveFilter === f} onClick={() => setMoveFilter(f)} />)}
          </div>
          <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} style={{
            padding: '5px 10px', backgroundColor: CARD, color: TEXT2, border: `1px solid ${BORDER}`, borderRadius: '8px', fontSize: '11px', outline: 'none', cursor: 'pointer',
          }}>
            {sectors.map(s => <option key={s} value={s}>{s === 'All' ? 'All Sectors' : s}</option>)}
          </select>
        </div>
      )}

      {data && !loading && sectorPerf.length > 0 && (
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

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #1A2840', borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {error && !loading && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '14px', color: RED, fontSize: '13px', marginBottom: '16px' }}>{error}</div>
      )}

      {data && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Gainers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={16} color={GREEN} />
              <span style={{ fontSize: '14px', fontWeight: '600' }}>Top Gainers</span>
              <span style={{ fontSize: '10px', color: GREEN, backgroundColor: 'rgba(16,185,129,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{filteredGainers.length}</span>
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
                  {filteredGainers.map((s, i) => <Row key={s.ticker} stock={s} rank={i + 1} up={true} />)}
                  {filteredGainers.length === 0 && <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No gainers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {/* Losers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingDown size={16} color={RED} />
              <span style={{ fontSize: '14px', fontWeight: '600' }}>Top Losers</span>
              <span style={{ fontSize: '10px', color: RED, backgroundColor: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{filteredLosers.length}</span>
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
                  {filteredLosers.map((s, i) => <Row key={s.ticker} stock={s} rank={i + 1} up={false} />)}
                  {filteredLosers.length === 0 && <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No losers match filters</td></tr>}
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
