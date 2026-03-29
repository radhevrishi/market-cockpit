'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';

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
}

interface EarningsEvent {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Good' | 'Weak' | 'Upcoming' | 'Preview';
  sector: string;
  industry: string;
  marketCap: string;
  edp: number | null;
  cmp: number | null;
  priceMove: number | null;
  timing: string;
  source: string;
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

interface EarningsResponse {
  results: EarningsEvent[];
  summary: {
    total: number;
    good: number;
    weak: number;
    upcoming: number;
  };
  quarter: string;
  dateRange: { from: string; to: string };
  updatedAt: string;
}

const THEME = {
  background: '#0A0E1A',
  card: '#111B35',
  cardHover: '#162040',
  border: '#1A2840',
  textPrimary: '#F5F7FA',
  textSecondary: '#8A95A3',
  accent: '#0F7ABF',
  green: '#10B981',
  red: '#EF4444',
};

interface TreemapRect {
  stock: Stock;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

type ColorBy = 'changePercent' | 'marketCap';
type GroupBy = 'sector' | 'none';
type SizeBy = 'marketCap' | 'equal';
type SortBy = 'changePercent' | 'alphabetical';

interface Filters {
  colorBy: ColorBy;
  groupBy: GroupBy;
  sizeBy: SizeBy;
  sortBy: SortBy;
}

export default function HeatmapPage() {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [mode, setMode] = useState<'daily' | 'earnings'>('daily');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [earningsData, setEarningsData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    colorBy: 'changePercent',
    groupBy: 'sector',
    sizeBy: 'marketCap',
    sortBy: 'changePercent',
  });

  const fetchData = async () => {
    try {
      setError(null);
      setIsRefreshing(true);

      if (mode === 'earnings') {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const monthStr = `${year}-${month}`;

        const response = await fetch(`/api/market/earnings?month=${monthStr}`);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const json = await response.json();
        setEarningsData(json);
        setLastUpdated(new Date());
      } else {
        const response = await fetch(`/api/market/quotes?market=${market}`);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const json = await response.json();
        setData(json);
        setLastUpdated(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [mode, market]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 60000);

    return () => clearInterval(interval);
  }, [mode, market]);

  const getColor = (stock: Stock): string => {
    const change = stock.changePercent;
    if (change >= 5) return '#0D9488';
    if (change >= 3) return '#10B981';
    if (change >= 1) return '#34D399';
    if (change >= 0) return '#6EE7B7';
    if (change >= -1) return '#FB923C';
    if (change >= -3) return '#F97316';
    if (change >= -5) return '#EF4444';
    return '#DC2626';
  };

  const getEarningsColor = (priceMove: number | null): string => {
    if (priceMove === null) return '#4B5563';
    if (priceMove >= 10) return '#0D9488';
    if (priceMove >= 5) return '#10B981';
    if (priceMove >= 2) return '#34D399';
    if (priceMove >= 0) return '#6EE7B7';
    if (priceMove >= -2) return '#FB923C';
    if (priceMove >= -5) return '#F97316';
    if (priceMove >= -10) return '#EF4444';
    return '#DC2626';
  };

  const processStocks = useMemo(() => {
    if (!data) return { grouped: {}, all: [] };

    let stocks = [...data.stocks];

    if (filters.sortBy === 'alphabetical') {
      stocks.sort((a, b) => a.ticker.localeCompare(b.ticker));
    } else {
      stocks.sort((a, b) => b.changePercent - a.changePercent);
    }

    if (filters.groupBy === 'sector') {
      const grouped: { [key: string]: Stock[] } = {};
      stocks.forEach((stock) => {
        if (!grouped[stock.sector]) {
          grouped[stock.sector] = [];
        }
        grouped[stock.sector].push(stock);
      });
      return { grouped, all: stocks };
    }

    return { grouped: { 'All Stocks': stocks }, all: stocks };
  }, [data, filters.sortBy, filters.groupBy]);

  const processEarnings = useMemo(() => {
    if (!earningsData) return { grouped: {}, all: [] };

    let events = [...earningsData.results];

    // Filter to only reported results (not upcoming)
    events = events.filter(e => e.quality !== 'Upcoming');

    // Sort by price move
    events.sort((a, b) => (b.priceMove ?? 0) - (a.priceMove ?? 0));

    if (filters.groupBy === 'sector') {
      const grouped: { [key: string]: EarningsEvent[] } = {};
      events.forEach((event) => {
        if (!grouped[event.sector]) {
          grouped[event.sector] = [];
        }
        grouped[event.sector].push(event);
      });
      return { grouped, all: events };
    }

    return { grouped: { 'All Results': events }, all: events };
  }, [earningsData, filters.groupBy]);

  const calculateTreemap = (stocks: Stock[], width: number, height: number): TreemapRect[] => {
    if (stocks.length === 0) return [];

    const areas = stocks.map((stock) => {
      if (filters.sizeBy === 'marketCap') {
        // Use market cap if available, otherwise use volume as proxy, otherwise equal
        return Math.max(stock.marketCap || stock.volume || 10000, 10000);
      }
      return 100;
    });

    const totalArea = areas.reduce((a, b) => a + b, 0);
    const rects: TreemapRect[] = stocks.map((stock, idx) => ({
      stock,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      area: (areas[idx] / totalArea) * (width * height),
    }));

    let x = 0;
    let y = 0;
    let rowWidth = width;
    let currentRowRects: TreemapRect[] = [];
    let currentRowHeight = 0;

    rects.forEach((rect) => {
      const rectWidth = (rect.area / currentRowHeight || rowWidth);

      if (x + rectWidth > width && currentRowRects.length > 0) {
        let currentX = 0;
        currentRowRects.forEach((r) => {
          r.x = currentX;
          r.y = y;
          r.width = (r.area / currentRowHeight);
          r.height = currentRowHeight;
          currentX += r.width;
        });
        y += currentRowHeight;
        x = 0;
        currentRowRects = [];
        currentRowHeight = 0;
      }

      currentRowHeight = Math.max(currentRowHeight, rect.area / rowWidth);
      currentRowRects.push(rect);
      x += rectWidth;
    });

    if (currentRowRects.length > 0) {
      let currentX = 0;
      currentRowRects.forEach((r) => {
        r.x = currentX;
        r.y = y;
        r.width = (r.area / currentRowHeight);
        r.height = currentRowHeight;
        currentX += r.width;
      });
    }

    return rects;
  };

  const formatTime = (date: Date | null) => {
    if (!date) return 'Never';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  return (
    <div style={{ backgroundColor: THEME.background, color: THEME.textPrimary, minHeight: '100vh', padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>Market Heatmap</h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Mode Toggle */}
            <div style={{ display: 'flex', gap: '8px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
              {[
                { value: 'daily', label: 'Daily Changes' },
                { value: 'earnings', label: 'Earnings Moves' },
              ].map((m) => (
                <button
                  key={m.value}
                  onClick={() => {
                    setMode(m.value as 'daily' | 'earnings');
                    setLoading(true);
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: mode === m.value ? THEME.accent : 'transparent',
                    color: mode === m.value ? '#FFFFFF' : THEME.textSecondary,
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Market Toggle (only show for daily mode) */}
            {mode === 'daily' && (
              <div style={{ display: 'flex', gap: '8px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
                {(['india', 'us'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarket(m)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: market === m ? THEME.accent : 'transparent',
                      color: market === m ? '#FFFFFF' : THEME.textSecondary,
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            {/* Refresh Button */}
            <button
              onClick={fetchData}
              disabled={isRefreshing}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: `1px solid ${THEME.border}`,
                backgroundColor: THEME.card,
                color: THEME.accent,
                cursor: isRefreshing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'all 0.3s ease',
                opacity: isRefreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>

            {/* Last Updated */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: THEME.textSecondary }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: THEME.green,
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }} />
              {formatTime(lastUpdated)}
            </div>
          </div>
        </div>

        {/* Summary Stats - Daily Mode */}
        {mode === 'daily' && data && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Total</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.accent }}>{data.summary.total}</div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Gainers</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.green }}>{data.summary.gainersCount}</div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Losers</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.red }}>{data.summary.losersCount}</div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Best</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.green }}>
                {(() => {
                  const best = data?.stocks?.length ? [...data.stocks].sort((a, b) => b.changePercent - a.changePercent)[0] : null;
                  return best ? best.ticker : 'N/A';
                })()}
              </div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Worst</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.red }}>
                {(() => {
                  const worst = data?.stocks?.length ? [...data.stocks].sort((a, b) => a.changePercent - b.changePercent)[0] : null;
                  return worst ? worst.ticker : 'N/A';
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Summary Stats - Earnings Mode */}
        {mode === 'earnings' && earningsData && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Results</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.accent }}>{earningsData.summary.total}</div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Gainers</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.green }}>
                {processEarnings.all.filter(e => (e.priceMove ?? 0) > 0).length}
              </div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Losers</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.red }}>
                {processEarnings.all.filter(e => (e.priceMove ?? 0) < 0).length}
              </div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Avg Move</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.textPrimary }}>
                {(() => {
                  const avg = processEarnings.all.length > 0
                    ? processEarnings.all.reduce((sum, e) => sum + (e.priceMove ?? 0), 0) / processEarnings.all.length
                    : 0;
                  return `${avg > 0 ? '+' : ''}${avg.toFixed(2)}%`;
                })()}
              </div>
            </div>
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Best Move</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: THEME.green }}>
                {(() => {
                  const best = processEarnings.all.length > 0
                    ? processEarnings.all.reduce((max, e) => (e.priceMove ?? 0) > (max.priceMove ?? 0) ? e : max)
                    : null;
                  return best ? `${best.ticker} +${(best.priceMove ?? 0).toFixed(2)}%` : 'N/A';
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '400px',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            border: `3px solid ${THEME.border}`,
            borderTop: `3px solid ${THEME.accent}`,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${THEME.red}`,
          borderRadius: '12px',
          padding: '16px',
          color: THEME.red,
          marginBottom: '24px',
        }}>
          Error loading data: {error}
        </div>
      )}

      {/* Controls - Only for Daily Mode */}
      {mode === 'daily' && data && !loading && (
        <div style={{
          backgroundColor: THEME.card,
          border: `1px solid ${THEME.border}`,
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}>
          <div>
            <label style={{ color: THEME.textSecondary, fontSize: '12px', display: 'block', marginBottom: '6px' }}>Color by</label>
            <select
              value={filters.colorBy}
              onChange={(e) => setFilters({ ...filters, colorBy: e.target.value as ColorBy })}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: THEME.background,
                color: THEME.textPrimary,
                border: `1px solid ${THEME.border}`,
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              <option value="changePercent">Change %</option>
              <option value="marketCap">Market Cap</option>
            </select>
          </div>

          <div>
            <label style={{ color: THEME.textSecondary, fontSize: '12px', display: 'block', marginBottom: '6px' }}>Group by</label>
            <select
              value={filters.groupBy}
              onChange={(e) => setFilters({ ...filters, groupBy: e.target.value as GroupBy })}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: THEME.background,
                color: THEME.textPrimary,
                border: `1px solid ${THEME.border}`,
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              <option value="sector">Sector</option>
              <option value="none">None</option>
            </select>
          </div>

          <div>
            <label style={{ color: THEME.textSecondary, fontSize: '12px', display: 'block', marginBottom: '6px' }}>Size by</label>
            <select
              value={filters.sizeBy}
              onChange={(e) => setFilters({ ...filters, sizeBy: e.target.value as SizeBy })}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: THEME.background,
                color: THEME.textPrimary,
                border: `1px solid ${THEME.border}`,
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              <option value="marketCap">Market Cap</option>
              <option value="equal">Equal</option>
            </select>
          </div>

          <div>
            <label style={{ color: THEME.textSecondary, fontSize: '12px', display: 'block', marginBottom: '6px' }}>Sort by</label>
            <select
              value={filters.sortBy}
              onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as SortBy })}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: THEME.background,
                color: THEME.textPrimary,
                border: `1px solid ${THEME.border}`,
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              <option value="changePercent">Change %</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
          </div>
        </div>
      )}

      {/* Earnings Grid */}
      {mode === 'earnings' && earningsData && !loading && (
        <div>
          {Object.entries(processEarnings.grouped).map(([groupName, events]) => (
            <div key={groupName} style={{ marginBottom: '32px' }}>
              {filters.groupBy === 'sector' && (
                <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: THEME.textSecondary }}>
                  {groupName}
                </h2>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: '12px',
                  marginBottom: '24px',
                }}
              >
                {events.map((event) => (
                  <div
                    key={event.ticker}
                    onMouseEnter={() => setHoveredTicker(event.ticker)}
                    onMouseLeave={() => setHoveredTicker(null)}
                    style={{
                      backgroundColor: getEarningsColor(event.priceMove),
                      border: hoveredTicker === event.ticker ? `2px solid ${THEME.accent}` : `1px solid ${THEME.border}`,
                      borderRadius: '8px',
                      padding: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      opacity: hoveredTicker === event.ticker ? 1 : 0.85,
                      transform: hoveredTicker === event.ticker ? 'scale(1.05)' : 'scale(1)',
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#FFFFFF', marginBottom: '4px' }}>
                      {event.ticker}
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.8)', marginBottom: '6px' }}>
                      {event.company.substring(0, 18)}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#FFFFFF', marginBottom: '4px' }}>
                      {(event.priceMove ?? 0) > 0 ? '+' : ''}{(event.priceMove ?? 0).toFixed(2)}%
                    </div>
                    <div style={{ fontSize: '9px', color: 'rgba(255, 255, 255, 0.7)' }}>
                      {event.quality}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Treemap - Daily Mode */}
      {mode === 'daily' && data && !loading && (
        <div>
          {Object.entries(processStocks.grouped).map(([groupName, groupStocks]) => {
            const rects = calculateTreemap(groupStocks, 1200, 400);

            return (
              <div key={groupName} style={{ marginBottom: '32px' }}>
                {filters.groupBy === 'sector' && (
                  <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: THEME.textSecondary }}>
                    {groupName}
                  </h2>
                )}

                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '400px',
                    backgroundColor: THEME.card,
                    border: `1px solid ${THEME.border}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
                    {rects.map((rect) => (
                      <g key={rect.stock.ticker}>
                        <rect
                          x={rect.x}
                          y={rect.y}
                          width={rect.width}
                          height={rect.height}
                          fill={getColor(rect.stock)}
                          opacity={hoveredTicker === rect.stock.ticker ? 1 : 0.8}
                          style={{
                            stroke: THEME.border,
                            strokeWidth: 1,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                          onMouseEnter={() => setHoveredTicker(rect.stock.ticker)}
                          onMouseLeave={() => setHoveredTicker(null)}
                        />
                        <text
                          x={rect.x + rect.width / 2}
                          y={rect.y + rect.height / 2 - 6}
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize={Math.min(14, rect.width / 4)}
                          fontWeight="bold"
                          pointerEvents="none"
                        >
                          {rect.stock.ticker}
                        </text>
                        <text
                          x={rect.x + rect.width / 2}
                          y={rect.y + rect.height / 2 + 10}
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize={Math.min(12, rect.width / 6)}
                          pointerEvents="none"
                        >
                          {rect.stock.changePercent > 0 ? '+' : ''}{rect.stock.changePercent.toFixed(2)}%
                        </text>
                      </g>
                    ))}
                  </svg>

                  {/* Tooltip */}
                  {hoveredTicker && processStocks.all.find((s) => s.ticker === hoveredTicker) && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        backgroundColor: THEME.background,
                        border: `1px solid ${THEME.accent}`,
                        borderRadius: '8px',
                        padding: '12px',
                        maxWidth: '280px',
                        zIndex: 10,
                        fontSize: '12px',
                      }}
                    >
                      {(() => {
                        const stock = processStocks.all.find((s) => s.ticker === hoveredTicker);
                        if (!stock) return null;
                        return (
                          <>
                            <div style={{ fontWeight: 'bold', color: THEME.accent, marginBottom: '6px' }}>
                              {stock.ticker}
                            </div>
                            <div style={{ color: THEME.textSecondary, marginBottom: '4px' }}>
                              {stock.company}
                            </div>
                            <div style={{ color: THEME.textSecondary, marginBottom: '4px' }}>
                              Sector: {stock.sector}
                            </div>
                            <div style={{ color: THEME.textPrimary, marginBottom: '4px' }}>
                              Price: ₹{stock.price.toFixed(2)}
                            </div>
                            <div
                              style={{
                                color: stock.changePercent > 0 ? THEME.green : THEME.red,
                                fontWeight: 'bold',
                              }}
                            >
                              {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Color Legend */}
      {!loading && (
        <div style={{ marginTop: '32px', padding: '16px', backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: THEME.textSecondary }}>
            {mode === 'daily' ? 'Daily Change' : 'Price Move'} Color Scale
          </h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {mode === 'daily' ? [
              { label: '>5%', color: '#0D9488' },
              { label: '3-5%', color: '#10B981' },
              { label: '1-3%', color: '#34D399' },
              { label: '0-1%', color: '#6EE7B7' },
              { label: '-1-0%', color: '#FB923C' },
              { label: '-3 to -1%', color: '#F97316' },
              { label: '-5 to -3%', color: '#EF4444' },
              { label: '<-5%', color: '#DC2626' },
            ] : [
              { label: '>10%', color: '#0D9488' },
              { label: '5-10%', color: '#10B981' },
              { label: '2-5%', color: '#34D399' },
              { label: '0-2%', color: '#6EE7B7' },
              { label: '-2-0%', color: '#FB923C' },
              { label: '-5 to -2%', color: '#F97316' },
              { label: '-10 to -5%', color: '#EF4444' },
              { label: '<-10%', color: '#DC2626' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    backgroundColor: item.color,
                    borderRadius: '4px',
                    border: `1px solid ${THEME.border}`,
                  }}
                />
                <span style={{ fontSize: '12px', color: THEME.textSecondary }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
