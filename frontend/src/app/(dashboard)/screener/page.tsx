'use client';

import { useState } from 'react';

const EarningsScreenerPage = () => {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [sector, setSector] = useState('all');
  const [quality, setQuality] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [currentPage, setCurrentPage] = useState(1);

  const earningsData = [
    { company: 'TCS', ticker: 'TCS.NS', sector: 'IT', resultDate: '2024-01-15', revenueYoY: 8.5, profitYoY: 12.3, qualityScore: 92, move: 2.1 },
    { company: 'Infosys', ticker: 'INFY.NS', sector: 'IT', resultDate: '2024-01-12', revenueYoY: 6.2, profitYoY: 9.8, qualityScore: 88, move: 1.5 },
    { company: 'HDFC Bank', ticker: 'HDFCBANK.NS', sector: 'Finance', resultDate: '2024-01-18', revenueYoY: 15.3, profitYoY: 18.7, qualityScore: 95, move: 3.2 },
    { company: 'ICICI Bank', ticker: 'ICICIBANK.NS', sector: 'Finance', resultDate: '2024-01-20', revenueYoY: 12.1, profitYoY: 16.5, qualityScore: 91, move: 2.8 },
    { company: 'Reliance', ticker: 'RELIANCE.NS', sector: 'Energy', resultDate: '2024-01-10', revenueYoY: -2.3, profitYoY: -5.6, qualityScore: 72, move: -1.8 },
    { company: 'Bajaj Finance', ticker: 'BAJAJFINSV.NS', sector: 'Finance', resultDate: '2024-01-22', revenueYoY: 18.4, profitYoY: 22.1, qualityScore: 93, move: 4.2 },
    { company: 'Maruti Suzuki', ticker: 'MARUTI.NS', sector: 'Auto', resultDate: '2024-01-16', revenueYoY: 5.8, profitYoY: 3.2, qualityScore: 68, move: -0.5 },
    { company: 'Nestlé', ticker: 'NESTLEIND.NS', sector: 'FMCG', resultDate: '2024-01-17', revenueYoY: 7.1, profitYoY: 8.9, qualityScore: 85, move: 1.3 },
    { company: 'HUL', ticker: 'HINDUNILVR.NS', sector: 'FMCG', resultDate: '2024-01-14', revenueYoY: 3.5, profitYoY: 4.2, qualityScore: 79, move: 0.8 },
    { company: 'Wipro', ticker: 'WIPRO.NS', sector: 'IT', resultDate: '2024-01-19', revenueYoY: 4.1, profitYoY: 6.7, qualityScore: 76, move: 0.2 },
    { company: 'Asian Paints', ticker: 'ASIANPAINT.NS', sector: 'Chemicals', resultDate: '2024-01-13', revenueYoY: 9.2, profitYoY: 11.5, qualityScore: 87, move: 2.4 },
    { company: 'ITC', ticker: 'ITC.NS', sector: 'FMCG', resultDate: '2024-01-21', revenueYoY: 5.4, profitYoY: 7.1, qualityScore: 81, move: 1.1 },
    { company: 'Bharti Airtel', ticker: 'BHARTIARTL.NS', sector: 'Telecom', resultDate: '2024-01-11', revenueYoY: 8.9, profitYoY: 14.2, qualityScore: 89, move: 3.5 },
    { company: 'SBI', ticker: 'SBIN.NS', sector: 'Finance', resultDate: '2024-01-23', revenueYoY: 14.5, profitYoY: 19.3, qualityScore: 92, move: 2.9 },
    { company: 'Axis Bank', ticker: 'AXISBANK.NS', sector: 'Finance', resultDate: '2024-01-09', revenueYoY: 13.2, profitYoY: 17.8, qualityScore: 90, move: 3.1 },
  ];

  const itemsPerPage = 10;
  const totalPages = Math.ceil(earningsData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const displayedData = earningsData.slice(startIndex, startIndex + itemsPerPage);

  const getQualityColor = (score: number) => {
    if (score >= 85) return '#10B981';
    if (score >= 70) return '#8A95A3';
    return '#EF4444';
  };

  const getMoveColor = (move: number) => {
    return move >= 0 ? '#10B981' : '#EF4444';
  };

  const theme = {
    background: '#0A0E1A',
    cards: '#111B35',
    border: '#1A2840',
    textPrimary: '#F5F7FA',
    textSecondary: '#8A95A3',
    green: '#10B981',
    red: '#EF4444',
    accent: '#0F7ABF',
  };

  return (
    <div style={{ background: theme.background, minHeight: '100vh', padding: '2rem', color: theme.textPrimary, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>Earnings Screener</h1>

      {/* Filters Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem', background: theme.cards, padding: '1.5rem', borderRadius: '0.75rem', border: `1px solid ${theme.border}` }}>
        {/* Market Toggle */}
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: theme.textSecondary }}>Market</label>
          <div style={{ display: 'flex', gap: '0.5rem', background: theme.background, padding: '0.5rem', borderRadius: '0.5rem', border: `1px solid ${theme.border}` }}>
            {['india', 'us'].map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m as 'india' | 'us')}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '0.375rem',
                  border: 'none',
                  background: market === m ? theme.accent : 'transparent',
                  color: market === m ? '#fff' : theme.textSecondary,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                }}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Sector Dropdown */}
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: theme.textSecondary }}>Sector</label>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              background: theme.background,
              color: theme.textPrimary,
              border: `1px solid ${theme.border}`,
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            <option value="all">All Sectors</option>
            <option value="it">IT</option>
            <option value="finance">Finance</option>
            <option value="energy">Energy</option>
            <option value="auto">Auto</option>
            <option value="fmcg">FMCG</option>
            <option value="chemicals">Chemicals</option>
            <option value="telecom">Telecom</option>
          </select>
        </div>

        {/* Quality Filter */}
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: theme.textSecondary }}>Quality</label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              background: theme.background,
              color: theme.textPrimary,
              border: `1px solid ${theme.border}`,
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            <option value="all">All Quality</option>
            <option value="good">Good (70+)</option>
            <option value="great">Great (85+)</option>
          </select>
        </div>

        {/* Sort By */}
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: theme.textSecondary }}>Sort By</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              background: theme.background,
              color: theme.textPrimary,
              border: `1px solid ${theme.border}`,
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            <option value="date">Date</option>
            <option value="move">Move %</option>
            <option value="mcap">MCap</option>
          </select>
        </div>
      </div>

      {/* Results Table */}
      <div style={{ background: theme.cards, borderRadius: '0.75rem', border: `1px solid ${theme.border}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: theme.background, borderBottom: `1px solid ${theme.border}` }}>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Company</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Ticker</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Sector</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Result Date</th>
                <th style={{ padding: '1rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Revenue YoY%</th>
                <th style={{ padding: '1rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Profit YoY%</th>
                <th style={{ padding: '1rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Quality Score</th>
                <th style={{ padding: '1rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: theme.textSecondary }}>Post-Earnings Move%</th>
              </tr>
            </thead>
            <tbody>
              {displayedData.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: `1px solid ${theme.border}`, transition: 'background 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.background = theme.background)} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', fontWeight: 500 }}>{row.company}</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', color: theme.textSecondary }}>{row.ticker}</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', color: theme.textSecondary }}>{row.sector}</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', color: theme.textSecondary }}>{row.resultDate}</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', textAlign: 'right', color: row.revenueYoY >= 0 ? theme.green : theme.red }}>{row.revenueYoY > 0 ? '+' : ''}{row.revenueYoY}%</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', textAlign: 'right', color: row.profitYoY >= 0 ? theme.green : theme.red }}>{row.profitYoY > 0 ? '+' : ''}{row.profitYoY}%</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', textAlign: 'center', color: getQualityColor(row.qualityScore), fontWeight: 600 }}>{row.qualityScore}</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', textAlign: 'right', color: getMoveColor(row.move), fontWeight: 500 }}>{row.move > 0 ? '+' : ''}{row.move}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '2rem' }}>
        <button
          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          style={{
            padding: '0.5rem 1rem',
            background: currentPage === 1 ? theme.border : theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
            opacity: currentPage === 1 ? 0.5 : 1,
          }}
        >
          Previous
        </button>

        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            onClick={() => setCurrentPage(page)}
            style={{
              padding: '0.5rem 0.75rem',
              background: currentPage === page ? theme.accent : theme.cards,
              color: currentPage === page ? '#fff' : theme.textSecondary,
              border: `1px solid ${theme.border}`,
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: currentPage === page ? 600 : 400,
            }}
          >
            {page}
          </button>
        ))}

        <button
          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          style={{
            padding: '0.5rem 1rem',
            background: currentPage === totalPages ? theme.border : theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
            opacity: currentPage === totalPages ? 0.5 : 1,
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default EarningsScreenerPage;
