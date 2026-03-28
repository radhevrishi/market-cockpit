'use client';

import { useState } from 'react';

interface Stock {
  rank: number;
  ticker: string;
  company: string;
  price: number;
  change: number;
  volume: string;
  sector: string;
}

const GAINERS: Stock[] = [
  { rank: 1, ticker: 'NVDA', company: 'NVIDIA Corp', price: 875.43, change: 8.24, volume: '45.2M', sector: 'Technology' },
  { rank: 2, ticker: 'TSLA', company: 'Tesla Inc', price: 242.65, change: 7.89, volume: '120.5M', sector: 'Automotive' },
  { rank: 3, ticker: 'META', company: 'Meta Platforms', price: 512.34, change: 6.54, volume: '18.3M', sector: 'Technology' },
  { rank: 4, ticker: 'AVGO', company: 'Broadcom Inc', price: 168.92, change: 5.98, volume: '22.1M', sector: 'Semiconductor' },
  { rank: 5, ticker: 'ADBE', company: 'Adobe Inc', price: 587.15, change: 5.67, volume: '8.9M', sector: 'Software' },
  { rank: 6, ticker: 'CRM', company: 'Salesforce Inc', price: 289.47, change: 5.43, volume: '12.4M', sector: 'Software' },
  { rank: 7, ticker: 'AMD', company: 'Advanced Micro Devices', price: 198.76, change: 5.21, volume: '34.2M', sector: 'Semiconductor' },
  { rank: 8, ticker: 'GOOGL', company: 'Alphabet Inc', price: 156.89, change: 4.98, volume: '28.7M', sector: 'Technology' },
  { rank: 9, ticker: 'AMZN', company: 'Amazon.com Inc', price: 189.23, change: 4.76, volume: '52.1M', sector: 'Retail' },
  { rank: 10, ticker: 'MSFT', company: 'Microsoft Corp', price: 429.34, change: 4.52, volume: '19.3M', sector: 'Technology' },
  { rank: 11, ticker: 'NFLX', company: 'Netflix Inc', price: 456.78, change: 4.34, volume: '5.6M', sector: 'Entertainment' },
  { rank: 12, ticker: 'ASML', company: 'ASML Holdings', price: 678.45, change: 4.12, volume: '3.2M', sector: 'Semiconductor' },
  { rank: 13, ticker: 'PYPL', company: 'PayPal Holdings', price: 67.89, change: 3.98, volume: '15.7M', sector: 'FinTech' },
  { rank: 14, ticker: 'INTU', company: 'Intuit Inc', price: 523.21, change: 3.76, volume: '4.3M', sector: 'Software' },
  { rank: 15, ticker: 'COIN', company: 'Coinbase Global', price: 112.34, change: 3.54, volume: '8.9M', sector: 'Crypto' },
  { rank: 16, ticker: 'SQ', company: 'Block Inc', price: 89.45, change: 3.32, volume: '11.2M', sector: 'FinTech' },
  { rank: 17, ticker: 'MSTR', company: 'MicroStrategy Inc', price: 425.67, change: 3.11, volume: '6.7M', sector: 'Software' },
  { rank: 18, ticker: 'SHOP', company: 'Shopify Inc', price: 78.92, change: 2.98, volume: '9.5M', sector: 'Retail' },
  { rank: 19, ticker: 'SPOTIFY', company: 'Spotify Technology', price: 245.56, change: 2.76, volume: '3.1M', sector: 'Entertainment' },
  { rank: 20, ticker: 'AFRM', company: 'Affirm Holdings', price: 34.21, change: 2.54, volume: '12.8M', sector: 'FinTech' },
];

const LOSERS: Stock[] = [
  { rank: 1, ticker: 'F', company: 'Ford Motor', price: 11.23, change: -6.87, volume: '52.3M', sector: 'Automotive' },
  { rank: 2, ticker: 'GM', company: 'General Motors', price: 41.56, change: -6.45, volume: '18.9M', sector: 'Automotive' },
  { rank: 3, ticker: 'TM', company: 'Toyota Motor', price: 189.34, change: -5.98, volume: '8.2M', sector: 'Automotive' },
  { rank: 4, ticker: 'BAC', company: 'Bank of America', price: 38.92, change: -5.67, volume: '45.6M', sector: 'Finance' },
  { rank: 5, ticker: 'JPM', company: 'JPMorgan Chase', price: 197.45, change: -5.34, volume: '12.3M', sector: 'Finance' },
  { rank: 6, ticker: 'GS', company: 'Goldman Sachs', price: 428.76, change: -5.12, volume: '3.4M', sector: 'Finance' },
  { rank: 7, ticker: 'WFC', company: 'Wells Fargo', price: 78.23, change: -4.98, volume: '22.1M', sector: 'Finance' },
  { rank: 8, ticker: 'XOM', company: 'Exxon Mobil', price: 118.45, change: -4.76, volume: '15.7M', sector: 'Energy' },
  { rank: 9, ticker: 'CVX', company: 'Chevron Corp', price: 156.78, change: -4.54, volume: '11.2M', sector: 'Energy' },
  { rank: 10, ticker: 'MPC', company: 'Marathon Petroleum', price: 89.34, change: -4.32, volume: '8.9M', sector: 'Energy' },
  { rank: 11, ticker: 'PFE', company: 'Pfizer Inc', price: 29.87, change: -4.11, volume: '34.5M', sector: 'Healthcare' },
  { rank: 12, ticker: 'JNJ', company: 'Johnson & Johnson', price: 153.45, change: -3.98, volume: '9.8M', sector: 'Healthcare' },
  { rank: 13, ticker: 'MRK', company: 'Merck & Co', price: 76.23, change: -3.76, volume: '12.3M', sector: 'Healthcare' },
  { rank: 14, ticker: 'ABT', company: 'Abbott Laboratories', price: 101.56, change: -3.54, volume: '7.6M', sector: 'Healthcare' },
  { rank: 15, ticker: 'UNH', company: 'UnitedHealth Group', price: 498.76, change: -3.32, volume: '5.4M', sector: 'Healthcare' },
  { rank: 16, ticker: 'IBM', company: 'IBM Corp', price: 187.34, change: -3.11, volume: '4.2M', sector: 'Technology' },
  { rank: 17, ticker: 'INTC', company: 'Intel Corp', price: 45.67, change: -2.98, volume: '28.7M', sector: 'Semiconductor' },
  { rank: 18, ticker: 'CSCO', company: 'Cisco Systems', price: 52.34, change: -2.76, volume: '15.6M', sector: 'Technology' },
  { rank: 19, ticker: 'HPE', company: 'HPE Inc', price: 23.45, change: -2.54, volume: '9.3M', sector: 'Technology' },
  { rank: 20, ticker: 'AXP', company: 'American Express', price: 234.56, change: -2.32, volume: '6.7M', sector: 'Finance' },
];

const HEATMAP_STOCKS = [
  { ticker: 'NVDA', change: 8.24, sector: 'Technology' },
  { ticker: 'TSLA', change: 7.89, sector: 'Automotive' },
  { ticker: 'META', change: 6.54, sector: 'Technology' },
  { ticker: 'MSFT', change: 4.52, sector: 'Technology' },
  { ticker: 'GOOGL', change: 4.98, sector: 'Technology' },
  { ticker: 'AMZN', change: 4.76, sector: 'Retail' },
  { ticker: 'AMD', change: 5.21, sector: 'Semiconductor' },
  { ticker: 'AVGO', change: 5.98, sector: 'Semiconductor' },
  { ticker: 'ADBE', change: 5.67, sector: 'Software' },
  { ticker: 'CRM', change: 5.43, sector: 'Software' },
  { ticker: 'F', change: -6.87, sector: 'Automotive' },
  { ticker: 'GM', change: -6.45, sector: 'Automotive' },
  { ticker: 'BAC', change: -5.67, sector: 'Finance' },
  { ticker: 'JPM', change: -5.34, sector: 'Finance' },
  { ticker: 'XOM', change: -4.76, sector: 'Energy' },
  { ticker: 'CVX', change: -4.54, sector: 'Energy' },
  { ticker: 'PFE', change: -4.11, sector: 'Healthcare' },
  { ticker: 'JNJ', change: -3.98, sector: 'Healthcare' },
  { ticker: 'INTC', change: -2.98, sector: 'Semiconductor' },
  { ticker: 'IBM', change: -3.11, sector: 'Technology' },
];

export default function MoversPage() {
  const [capFilter, setCapFilter] = useState<'All' | 'Large' | 'Mid' | 'Small'>('All');
  const [groupBy, setGroupBy] = useState<'Sector' | 'None'>('Sector');
  const [sortBy, setSortBy] = useState<'Change' | 'Volume'>('Change');

  const totalStocks = GAINERS.length + LOSERS.length;
  const gainersCount = GAINERS.length;
  const losersCount = LOSERS.length;
  const avgChange = (GAINERS.reduce((sum, s) => sum + s.change, 0) + LOSERS.reduce((sum, s) => sum + s.change, 0)) / totalStocks;
  const uniqueSectors = new Set([...GAINERS, ...LOSERS].map(s => s.sector)).size;

  const getColorForChange = (change: number): string => {
    if (change > 0) return '#10B981';
    if (change < 0) return '#EF4444';
    return '#8A95A3';
  };

  const groupedHeatmap = HEATMAP_STOCKS.reduce((acc, stock) => {
    if (!acc[stock.sector]) {
      acc[stock.sector] = [];
    }
    acc[stock.sector].push(stock);
    return acc;
  }, {} as Record<string, typeof HEATMAP_STOCKS>);

  return (
    <div style={{ backgroundColor: '#0A0E1A', color: '#F5F7FA', minHeight: '100vh', padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>Market Movers</h1>
        <p style={{ color: '#8A95A3', fontSize: '14px' }}>Track today's top performing and declining stocks</p>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '20px' }}>
          <p style={{ color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Stocks</p>
          <p style={{ fontSize: '28px', fontWeight: '700' }}>{totalStocks}</p>
        </div>
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '20px' }}>
          <p style={{ color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Gainers</p>
          <p style={{ fontSize: '28px', fontWeight: '700', color: '#10B981' }}>{gainersCount}</p>
        </div>
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '20px' }}>
          <p style={{ color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Losers</p>
          <p style={{ fontSize: '28px', fontWeight: '700', color: '#EF4444' }}>{losersCount}</p>
        </div>
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '20px' }}>
          <p style={{ color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg Change</p>
          <p style={{ fontSize: '28px', fontWeight: '700', color: avgChange > 0 ? '#10B981' : '#EF4444' }}>{avgChange.toFixed(2)}%</p>
        </div>
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '20px' }}>
          <p style={{ color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sectors</p>
          <p style={{ fontSize: '28px', fontWeight: '700' }}>{uniqueSectors}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '20px', marginBottom: '32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
          {/* Cap Filter */}
          <div>
            <label style={{ display: 'block', color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Market Cap
            </label>
            <select
              value={capFilter}
              onChange={(e) => setCapFilter(e.target.value as typeof capFilter)}
              style={{
                width: '100%',
                backgroundColor: '#0A0E1A',
                color: '#F5F7FA',
                border: '1px solid #1A2840',
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              <option>All</option>
              <option>Large</option>
              <option>Mid</option>
              <option>Small</option>
            </select>
          </div>

          {/* Group By */}
          <div>
            <label style={{ display: 'block', color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Group By
            </label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
              style={{
                width: '100%',
                backgroundColor: '#0A0E1A',
                color: '#F5F7FA',
                border: '1px solid #1A2840',
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              <option>Sector</option>
              <option>None</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <label style={{ display: 'block', color: '#8A95A3', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{
                width: '100%',
                backgroundColor: '#0A0E1A',
                color: '#F5F7FA',
                border: '1px solid #1A2840',
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              <option value="Change">Change %</option>
              <option value="Volume">Market Cap</option>
            </select>
          </div>
        </div>
      </div>

      {/* Sector Heatmap */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Sector Heatmap</h2>
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '20px' }}>
          {Object.entries(groupedHeatmap).map(([sector, stocks]) => (
            <div key={sector} style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', color: '#8A95A3', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {sector}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' }}>
                {stocks.map((stock) => (
                  <div
                    key={stock.ticker}
                    style={{
                      backgroundColor: getColorForChange(stock.change),
                      borderRadius: '6px',
                      padding: '12px',
                      textAlign: 'center',
                      opacity: 0.85,
                      cursor: 'pointer',
                      transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.85';
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#0A0E1A' }}>{stock.ticker}</div>
                    <div style={{ fontSize: '11px', color: '#0A0E1A', marginTop: '4px' }}>{stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)}%</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Gainers and Losers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
        {/* Top Gainers */}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Top Gainers</h2>
          <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1A2840' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Rank</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Ticker</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Company</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Price</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Change %</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Volume</th>
                </tr>
              </thead>
              <tbody>
                {GAINERS.map((stock) => (
                  <tr key={stock.ticker} style={{ borderBottom: '1px solid #1A2840', transition: 'background-color 0.2s' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#1A2840';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td style={{ padding: '12px', color: '#8A95A3', fontSize: '13px' }}>{stock.rank}</td>
                    <td style={{ padding: '12px', color: '#0F7ABF', fontSize: '13px', fontWeight: '600' }}>{stock.ticker}</td>
                    <td style={{ padding: '12px', color: '#F5F7FA', fontSize: '13px' }}>{stock.company}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#F5F7FA', fontSize: '13px' }}>${stock.price.toFixed(2)}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#10B981', fontSize: '13px', fontWeight: '600' }}>+{stock.change.toFixed(2)}%</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '13px' }}>{stock.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Losers */}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Top Losers</h2>
          <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1A2840' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Rank</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Ticker</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Company</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Price</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Change %</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '12px', fontWeight: '600', backgroundColor: '#0A0E1A' }}>Volume</th>
                </tr>
              </thead>
              <tbody>
                {LOSERS.map((stock) => (
                  <tr key={stock.ticker} style={{ borderBottom: '1px solid #1A2840', transition: 'background-color 0.2s' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#1A2840';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td style={{ padding: '12px', color: '#8A95A3', fontSize: '13px' }}>{stock.rank}</td>
                    <td style={{ padding: '12px', color: '#0F7ABF', fontSize: '13px', fontWeight: '600' }}>{stock.ticker}</td>
                    <td style={{ padding: '12px', color: '#F5F7FA', fontSize: '13px' }}>{stock.company}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#F5F7FA', fontSize: '13px' }}>${stock.price.toFixed(2)}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#EF4444', fontSize: '13px', fontWeight: '600' }}>{stock.change.toFixed(2)}%</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#8A95A3', fontSize: '13px' }}>{stock.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Live Updates Footer */}
      <div style={{ backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
        <p style={{ color: '#8A95A3', fontSize: '13px' }}>
          <span style={{ color: '#10B981', fontWeight: '600' }}>●</span> Updates every 30 seconds
        </p>
      </div>
    </div>
  );
}
