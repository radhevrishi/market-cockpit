'use client';

import React, { useState, useMemo } from 'react';

interface Stock {
  id: string;
  ticker: string;
  company: string;
  sector: string;
  movePercent: number;
  quality: number;
  marketCap: number;
}

const mockStocks: Stock[] = [
  // IT Sector
  { id: '1', ticker: 'TCS', company: 'Tata Consultancy Services', sector: 'IT', movePercent: 8.5, quality: 92, marketCap: 15000 },
  { id: '2', ticker: 'INFY', company: 'Infosys Limited', sector: 'IT', movePercent: 5.2, quality: 88, marketCap: 12000 },
  { id: '3', ticker: 'WIPRO', company: 'Wipro Limited', sector: 'IT', movePercent: -2.3, quality: 85, marketCap: 8000 },
  { id: '4', ticker: 'HCLTECH', company: 'HCL Technologies', sector: 'IT', movePercent: 6.7, quality: 86, marketCap: 9500 },

  // Banking Sector
  { id: '5', ticker: 'HDFC', company: 'HDFC Bank', sector: 'Banking', movePercent: 3.1, quality: 90, marketCap: 14000 },
  { id: '6', ticker: 'ICICIBANK', company: 'ICICI Bank', sector: 'Banking', movePercent: -1.5, quality: 87, marketCap: 11000 },
  { id: '7', ticker: 'SBIN', company: 'State Bank of India', sector: 'Banking', movePercent: 4.2, quality: 84, marketCap: 10500 },
  { id: '8', ticker: 'KOTAK', company: 'Kotak Mahindra Bank', sector: 'Banking', movePercent: 2.8, quality: 88, marketCap: 9000 },

  // Auto Sector
  { id: '9', ticker: 'MARUTI', company: 'Maruti Suzuki India', sector: 'Auto', movePercent: -3.2, quality: 80, marketCap: 7500 },
  { id: '10', ticker: 'BAJAJFINSV', company: 'Bajaj Finserv', sector: 'Auto', movePercent: 5.6, quality: 82, marketCap: 6800 },
  { id: '11', ticker: 'HEROMOTOCO', company: 'Hero MotoCorp', sector: 'Auto', movePercent: -1.8, quality: 78, marketCap: 5200 },
  { id: '12', ticker: 'TATAMOTORS', company: 'Tata Motors', sector: 'Auto', movePercent: 7.3, quality: 81, marketCap: 6500 },

  // Pharma Sector
  { id: '13', ticker: 'SUNPHARMA', company: 'Sun Pharmaceutical', sector: 'Pharma', movePercent: 12.4, quality: 85, marketCap: 7200 },
  { id: '14', ticker: 'CIPLA', company: 'Cipla Limited', sector: 'Pharma', movePercent: -4.1, quality: 83, marketCap: 5800 },
  { id: '15', ticker: 'LUPIN', company: 'Lupin Limited', sector: 'Pharma', movePercent: 6.8, quality: 84, marketCap: 5500 },
  { id: '16', ticker: 'DRREDDY', company: 'Dr. Reddy\'s Laboratories', sector: 'Pharma', movePercent: 9.2, quality: 87, marketCap: 6900 },

  // FMCG Sector
  { id: '17', ticker: 'NESTLEIND', company: 'Nestle India', sector: 'FMCG', movePercent: 1.5, quality: 91, marketCap: 8500 },
  { id: '18', ticker: 'UNILEVER', company: 'Hindustan Unilever', sector: 'FMCG', movePercent: 0.8, quality: 89, marketCap: 9200 },
  { id: '19', ticker: 'BRITANNIA', company: 'Britannia Industries', sector: 'FMCG', movePercent: -2.6, quality: 88, marketCap: 7800 },
  { id: '20', ticker: 'MARICO', company: 'Marico Limited', sector: 'FMCG', movePercent: 3.4, quality: 86, marketCap: 5600 },

  // Energy Sector
  { id: '21', ticker: 'RELIANCE', company: 'Reliance Industries', sector: 'Energy', movePercent: -5.2, quality: 86, marketCap: 18000 },
  { id: '22', ticker: 'NTPC', company: 'NTPC Limited', sector: 'Energy', movePercent: 4.7, quality: 82, marketCap: 7500 },
  { id: '23', ticker: 'POWERGRID', company: 'Power Grid Corporation', sector: 'Energy', movePercent: 2.3, quality: 83, marketCap: 6800 },
  { id: '24', ticker: 'IOC', company: 'Indian Oil Corporation', sector: 'Energy', movePercent: -1.9, quality: 81, marketCap: 7200 },

  // Real Estate & Construction
  { id: '25', ticker: 'DLF', company: 'DLF Limited', sector: 'Real Estate', movePercent: 14.2, quality: 79, marketCap: 6500 },
  { id: '26', ticker: 'INDIABULLS', company: 'Indiabulls Real Estate', sector: 'Real Estate', movePercent: -6.8, quality: 75, marketCap: 4200 },

  // Finance Sector
  { id: '27', ticker: 'BAJAJFINSV', company: 'Bajaj Finance', sector: 'Finance', movePercent: 8.9, quality: 89, marketCap: 8500 },
  { id: '28', ticker: 'HDFCAMC', company: 'HDFC Asset Management', sector: 'Finance', movePercent: 6.3, quality: 87, marketCap: 5900 },

  // Utilities
  { id: '29', ticker: 'EICHERMOT', company: 'Eicher Motors', sector: 'Auto', movePercent: 11.5, quality: 84, marketCap: 6200 },
  { id: '30', ticker: 'BAJAJHOLAND', company: 'Bajaj Holdings', sector: 'Finance', movePercent: -3.4, quality: 85, marketCap: 5100 },
];

const mockStocksUS: Stock[] = [
  { id: 'us1', ticker: 'AAPL', company: 'Apple Inc.', sector: 'Technology', movePercent: 7.2, quality: 94, marketCap: 3200000 },
  { id: 'us2', ticker: 'MSFT', company: 'Microsoft Corporation', sector: 'Technology', movePercent: 5.8, quality: 93, marketCap: 3100000 },
  { id: 'us3', ticker: 'GOOGL', company: 'Alphabet Inc.', sector: 'Technology', movePercent: 4.3, quality: 91, marketCap: 2800000 },
  { id: 'us4', ticker: 'AMZN', company: 'Amazon.com Inc.', sector: 'Consumer', movePercent: -2.1, quality: 89, marketCap: 2500000 },
  { id: 'us5', ticker: 'NVDA', company: 'NVIDIA Corporation', sector: 'Technology', movePercent: 12.5, quality: 92, marketCap: 2200000 },
  { id: 'us6', ticker: 'TSLA', company: 'Tesla Inc.', sector: 'Automotive', movePercent: -8.4, quality: 78, marketCap: 1800000 },
  { id: 'us7', ticker: 'META', company: 'Meta Platforms', sector: 'Technology', movePercent: 9.7, quality: 85, marketCap: 1600000 },
  { id: 'us8', ticker: 'JPM', company: 'JPMorgan Chase', sector: 'Financials', movePercent: 3.2, quality: 90, marketCap: 550000 },
  { id: 'us9', ticker: 'BA', company: 'Boeing Company', sector: 'Industrials', movePercent: -5.6, quality: 72, marketCap: 220000 },
  { id: 'us10', ticker: 'JNJ', company: 'Johnson & Johnson', sector: 'Healthcare', movePercent: 1.8, quality: 92, marketCap: 450000 },
];

type ColorBy = 'movePercent' | 'quality';
type GroupBy = 'sector' | 'none';
type SizeBy = 'movePercent' | 'marketCap' | 'quality';
type SortBy = 'movePercent' | 'marketCap' | 'quality';

interface Filters {
  colorBy: ColorBy;
  groupBy: GroupBy;
  sizeBy: SizeBy;
  sortBy: SortBy;
}

export default function HeatmapPage() {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [filters, setFilters] = useState<Filters>({
    colorBy: 'movePercent',
    groupBy: 'sector',
    sizeBy: 'movePercent',
    sortBy: 'movePercent',
  });

  const stocks = market === 'india' ? mockStocks : mockStocksUS;

  // Calculate summary stats
  const stats = useMemo(() => {
    const gainers = stocks.filter(s => s.movePercent > 0).length;
    const losers = stocks.filter(s => s.movePercent < 0).length;
    const avgMove = (stocks.reduce((sum, s) => sum + s.movePercent, 0) / stocks.length).toFixed(2);
    const sectorsCount = new Set(stocks.map(s => s.sector)).size;

    return {
      total: stocks.length,
      gainers,
      losers,
      avgMove: parseFloat(avgMove),
      sectors: sectorsCount,
    };
  }, [stocks]);

  // Group and sort stocks
  const groupedStocks = useMemo(() => {
    let processed = [...stocks];

    // Sort
    processed.sort((a, b) => {
      const aVal = a[filters.sortBy];
      const bVal = b[filters.sortBy];
      return bVal - aVal;
    });

    // Group
    if (filters.groupBy === 'sector') {
      const grouped: { [key: string]: Stock[] } = {};
      processed.forEach(stock => {
        if (!grouped[stock.sector]) {
          grouped[stock.sector] = [];
        }
        grouped[stock.sector].push(stock);
      });
      return grouped;
    }

    return { 'All Stocks': processed };
  }, [stocks, filters.sortBy, filters.groupBy]);

  // Get color for stock
  const getColor = (stock: Stock): string => {
    if (filters.colorBy === 'movePercent') {
      const move = stock.movePercent;
      if (move >= 10) return '#10B981';
      if (move >= 5) return '#31C48D';
      if (move >= 0) return '#6EE7B7';
      if (move >= -5) return '#F87171';
      if (move >= -10) return '#EF4444';
      return '#DC2626';
    } else {
      // Quality based coloring
      if (stock.quality >= 90) return '#10B981';
      if (stock.quality >= 80) return '#6EE7B7';
      if (stock.quality >= 70) return '#FCD34D';
      return '#F87171';
    }
  };

  // Get size multiplier for stock
  const getSizeMultiplier = (stock: Stock): number => {
    if (filters.sizeBy === 'movePercent') {
      return Math.abs(stock.movePercent) + 2;
    } else if (filters.sizeBy === 'marketCap') {
      return Math.sqrt(stock.marketCap) / 100;
    } else {
      return stock.quality / 70;
    }
  };

  return (
    <div style={{ backgroundColor: '#0A0E1A', minHeight: '100vh', padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ color: '#F5F7FA', fontSize: '28px', fontWeight: 'bold', marginBottom: '24px' }}>
          Earnings Heatmap
        </h1>

        {/* Market Toggle */}
        <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
          <button
            onClick={() => setMarket('india')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: market === 'india' ? '#0F7ABF' : '#111B35',
              color: '#F5F7FA',
              cursor: 'pointer',
              fontWeight: market === 'india' ? '600' : '400',
              fontSize: '14px',
              transition: 'all 0.2s',
            }}
          >
            India Market
          </button>
          <button
            onClick={() => setMarket('us')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: market === 'us' ? '#0F7ABF' : '#111B35',
              color: '#F5F7FA',
              cursor: 'pointer',
              fontWeight: market === 'us' ? '600' : '400',
              fontSize: '14px',
              transition: 'all 0.2s',
            }}
          >
            US Market
          </button>
        </div>

        {/* Summary Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <StatCard label="RESULTS" value={stats.total.toString()} color="#0F7ABF" />
          <StatCard label="GAINERS" value={stats.gainers.toString()} color="#10B981" />
          <StatCard label="LOSERS" value={stats.losers.toString()} color="#EF4444" />
          <StatCard label="AVG MOVE" value={`${stats.avgMove > 0 ? '+' : ''}${stats.avgMove.toFixed(2)}%`} color={stats.avgMove > 0 ? '#10B981' : '#EF4444'} />
          <StatCard label="SECTORS" value={stats.sectors.toString()} color="#0F7ABF" />
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          backgroundColor: '#111B35',
          border: '1px solid #1A2840',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '20px',
          }}
        >
          <FilterGroup
            label="Color by"
            value={filters.colorBy}
            options={[
              { label: 'Move %', value: 'movePercent' },
              { label: 'Quality', value: 'quality' },
            ]}
            onChange={(value) => setFilters({ ...filters, colorBy: value as ColorBy })}
          />
          <FilterGroup
            label="Group by"
            value={filters.groupBy}
            options={[
              { label: 'Sector', value: 'sector' },
              { label: 'None', value: 'none' },
            ]}
            onChange={(value) => setFilters({ ...filters, groupBy: value as GroupBy })}
          />
          <FilterGroup
            label="Size by"
            value={filters.sizeBy}
            options={[
              { label: 'Move %', value: 'movePercent' },
              { label: 'Market Cap', value: 'marketCap' },
              { label: 'Quality', value: 'quality' },
            ]}
            onChange={(value) => setFilters({ ...filters, sizeBy: value as SizeBy })}
          />
          <FilterGroup
            label="Sort by"
            value={filters.sortBy}
            options={[
              { label: 'Move %', value: 'movePercent' },
              { label: 'Market Cap', value: 'marketCap' },
              { label: 'Quality', value: 'quality' },
            ]}
            onChange={(value) => setFilters({ ...filters, sortBy: value as SortBy })}
          />
        </div>
      </div>

      {/* Heatmap Visualization */}
      <div>
        {Object.entries(groupedStocks).map(([groupName, groupStocks]) => (
          <div key={groupName} style={{ marginBottom: '32px' }}>
            {filters.groupBy === 'sector' && (
              <h2 style={{ color: '#F5F7FA', fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
                {groupName}
              </h2>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: '12px',
              }}
            >
              {groupStocks.map((stock) => {
                const sizeMultiplier = getSizeMultiplier(stock);
                const color = getColor(stock);
                const isGain = stock.movePercent >= 0;

                return (
                  <div
                    key={stock.id}
                    style={{
                      backgroundColor: color,
                      borderRadius: '8px',
                      padding: '16px',
                      cursor: 'pointer',
                      transform: `scale(${Math.min(1 + sizeMultiplier * 0.15, 1.4)})`,
                      transformOrigin: 'center',
                      transition: 'all 0.3s ease',
                      opacity: 0.9,
                      minHeight: `${80 + sizeMultiplier * 10}px`,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      textAlign: 'center',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = `scale(${Math.min(1 + sizeMultiplier * 0.15, 1.4) + 0.1})`;
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = `scale(${Math.min(1 + sizeMultiplier * 0.15, 1.4)})`;
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
                    }}
                  >
                    {/* Ticker */}
                    <div style={{ color: '#FFF', fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>
                      {stock.ticker}
                    </div>

                    {/* Move % */}
                    <div style={{ color: '#FFF', fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
                      {isGain ? '+' : ''}{stock.movePercent.toFixed(1)}%
                    </div>

                    {/* Company Name */}
                    <div
                      style={{
                        color: 'rgba(255, 255, 255, 0.85)',
                        fontSize: '11px',
                        lineHeight: '1.3',
                        maxWidth: '100%',
                      }}
                    >
                      {stock.company.split(' ').slice(0, 2).join(' ')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Color Scale Legend */}
      <div
        style={{
          backgroundColor: '#111B35',
          border: '1px solid #1A2840',
          borderRadius: '12px',
          padding: '20px',
          marginTop: '32px',
        }}
      >
        <h3 style={{ color: '#F5F7FA', fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
          Color Scale
        </h3>
        {filters.colorBy === 'movePercent' ? (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#DC2626', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>-20%</span>
            </div>
            <div style={{ width: '2px', height: '16px', backgroundColor: '#1A2840' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#F87171', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>-5%</span>
            </div>
            <div style={{ width: '2px', height: '16px', backgroundColor: '#1A2840' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#6EE7B7', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>0%</span>
            </div>
            <div style={{ width: '2px', height: '16px', backgroundColor: '#1A2840' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#31C48D', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>+5%</span>
            </div>
            <div style={{ width: '2px', height: '16px', backgroundColor: '#1A2840' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#10B981', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>+20%</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#F87171', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>Low Quality</span>
            </div>
            <div style={{ width: '2px', height: '16px', backgroundColor: '#1A2840' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#FCD34D', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>Medium</span>
            </div>
            <div style={{ width: '2px', height: '16px', backgroundColor: '#1A2840' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#10B981', borderRadius: '4px' }} />
              <span style={{ color: '#8A95A3', fontSize: '12px' }}>High Quality</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper Components

interface StatCardProps {
  label: string;
  value: string;
  color: string;
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div
      style={{
        backgroundColor: '#111B35',
        border: `1px solid #1A2840`,
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '8px',
      }}
    >
      <div style={{ color: '#8A95A3', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ color: color, fontSize: '28px', fontWeight: 'bold' }}>
        {value}
      </div>
    </div>
  );
}

interface FilterGroupProps {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}

function FilterGroup({ label, value, options, onChange }: FilterGroupProps) {
  return (
    <div>
      <label style={{ color: '#8A95A3', fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '10px 12px',
          backgroundColor: '#0A0E1A',
          border: '1px solid #1A2840',
          borderRadius: '6px',
          color: '#F5F7FA',
          fontSize: '14px',
          cursor: 'pointer',
          transition: 'border-color 0.2s',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
