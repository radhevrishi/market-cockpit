'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Loader } from 'lucide-react';

interface Quote {
  ticker: string;
  company: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

interface Earning {
  symbol: string;
  company: string;
  quality: string;
  quarter: string;
  revenue: number;
  netProfit: number;
  eps: number;
  price: number;
  movePercent: number;
}

interface QuotesData {
  stocks: Quote[];
  source: string;
  updatedAt: string;
}

interface EarningsData {
  earnings: Earning[];
  source: string;
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

const SECTORS = ['All', 'IT', 'Banking', 'Energy', 'Auto', 'FMCG', 'Pharma', 'Telecom', 'Healthcare', 'Financial Services', 'Metals', 'Consumer Durables', 'Capital Goods', 'Power', 'Cement', 'Insurance', 'Infrastructure', 'Diversified', 'Mining', 'Retail', 'Real Estate', 'Chemicals', 'Defence', 'Logistics', 'Hospitality', 'Consumer Services', 'Transportation', 'Textiles', 'Other'];
const SORT_OPTIONS = ['Name', 'Change%', 'Price', 'Volume'];

export default function ScreenerPage() {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [screenerMode, setScreenerMode] = useState<'stocks' | 'earnings'>('stocks');
  const [data, setData] = useState<QuotesData | null>(null);
  const [earningsData, setEarningsData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('All');
  const [sortBy, setSortBy] = useState('Name');
  const [sortAscending, setSortAscending] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const itemsPerPage = 20;

  const fetchQuotesData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const marketParam = market === 'us' ? 'us' : 'india';
      const response = await fetch(`/api/market/quotes?market=${marketParam}`);
      if (!response.ok) throw new Error('Failed to fetch quotes');
      const result: QuotesData = await response.json();
      setData(result);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [market]);

  const fetchEarningsData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const response = await fetch(`/api/market/earnings?month=${monthStr}`);
      if (!response.ok) throw new Error('Failed to fetch earnings');
      const result = await response.json();
      // Map earnings API results to the Earning interface
      const mapped: EarningsData = {
        earnings: (result.results || []).map((r: any) => ({
          symbol: r.ticker, company: r.company, quality: r.quality, quarter: r.quarter,
          revenue: 0, netProfit: 0, eps: 0, price: r.cmp || 0, movePercent: r.priceMove || 0,
        })),
        source: result.source || 'NSE', updatedAt: result.updatedAt || new Date().toISOString(),
      };
      setEarningsData(mapped);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screenerMode === 'stocks') {
      fetchQuotesData();
      const interval = setInterval(fetchQuotesData, 60000);
      return () => clearInterval(interval);
    } else {
      fetchEarningsData();
      const interval = setInterval(fetchEarningsData, 300000); // 5 minutes for earnings
      return () => clearInterval(interval);
    }
  }, [screenerMode, fetchQuotesData, fetchEarningsData]);

  const filteredQuotes = React.useMemo(() => {
    if (!data) return [];

    let filtered = (data.stocks || []).filter((quote) => {
      const matchesSearch = quote.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.company.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSector = selectedSector === 'All' || quote.sector === selectedSector;
      return matchesSearch && matchesSector;
    });

    filtered.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      switch (sortBy) {
        case 'Price':
          aVal = a.price;
          bVal = b.price;
          break;
        case 'Change%':
          aVal = a.changePercent;
          bVal = b.changePercent;
          break;
        case 'Volume':
          aVal = a.volume;
          bVal = b.volume;
          break;
        default:
          aVal = a.company;
          bVal = b.company;
      }

      if (typeof aVal === 'string') {
        return sortAscending ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }
      return sortAscending ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return filtered;
  }, [data, searchTerm, selectedSector, sortBy, sortAscending]);

  const filteredEarnings = React.useMemo(() => {
    if (!earningsData) return [];

    let filtered = (earningsData.earnings || []).filter((earning) => {
      const matchesSearch = earning.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        earning.company.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });

    // Basic sort by company name or symbol
    if (sortBy === 'Name') {
      filtered.sort((a, b) => sortAscending ? a.company.localeCompare(b.company) : b.company.localeCompare(a.company));
    } else if (sortBy === 'Change%') {
      filtered.sort((a, b) => sortAscending ? a.movePercent - b.movePercent : b.movePercent - a.movePercent);
    } else if (sortBy === 'Price') {
      filtered.sort((a, b) => sortAscending ? a.price - b.price : b.price - a.price);
    }

    return filtered;
  }, [earningsData, searchTerm, sortBy, sortAscending]);

  const totalPages = Math.ceil((screenerMode === 'stocks' ? filteredQuotes : filteredEarnings).length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const displayedQuotes = filteredQuotes.slice(startIndex, startIndex + itemsPerPage);
  const displayedEarnings = filteredEarnings.slice(startIndex, startIndex + itemsPerPage);

  const handleSortClick = (column: string) => {
    if (sortBy === column) {
      setSortAscending(!sortAscending);
    } else {
      setSortBy(column);
      setSortAscending(true);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1e7) return (num / 1e7).toFixed(2) + 'Cr';
    if (num >= 1e5) return (num / 1e5).toFixed(2) + 'L';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  };

  return (
    <div style={{ background: THEME.background, minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ color: THEME.textPrimary, fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0' }}>
            Market Screener
          </h1>
          <p style={{ color: THEME.textSecondary, fontSize: '14px', margin: 0 }}>
            Real-time stock data powered by NSE India
          </p>
        </div>

        {error && (
          <div style={{ padding: '16px', background: `${THEME.red}22`, border: `1px solid ${THEME.red}`, borderRadius: '8px', color: THEME.red, marginBottom: '24px' }}>
            Error: {error}
          </div>
        )}

        {/* Controls Section */}
        <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
          {/* Screener Mode Toggle */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
              Mode
            </label>
            <div style={{ display: 'flex', gap: '8px', background: THEME.background, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}`, width: 'fit-content' }}>
              {(['stocks', 'earnings'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setScreenerMode(mode);
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: screenerMode === mode ? THEME.accent : 'transparent',
                    color: screenerMode === mode ? THEME.background : THEME.textSecondary,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                >
                  {mode === 'stocks' ? 'Stock Screener' : 'Earnings Screener'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {/* Market Toggle - Only for Stock Screener */}
            {screenerMode === 'stocks' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                  Market
                </label>
                <div style={{ display: 'flex', gap: '8px', background: THEME.background, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
                  {(['india', 'us'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMarket(m)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: market === m ? THEME.accent : 'transparent',
                        color: market === m ? THEME.background : THEME.textSecondary,
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                        transition: 'all 0.2s',
                      }}
                    >
                      {m === 'us' ? 'US' : 'India'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sector Filter - Only for Stock Screener */}
            {screenerMode === 'stocks' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                  Sector
                </label>
                <select
                  value={selectedSector}
                  onChange={(e) => {
                    setSelectedSector(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: THEME.background,
                    color: THEME.textPrimary,
                    border: `1px solid ${THEME.border}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  {SECTORS.map((sector) => (
                    <option key={sector} value={sector}>
                      {sector}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort By */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: THEME.background,
                  color: THEME.textPrimary,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                Search
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: THEME.background, border: `1px solid ${THEME.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <Search size={16} color={THEME.textSecondary} />
                <input
                  type="text"
                  placeholder={screenerMode === 'stocks' ? 'Ticker or company name' : 'Symbol or company'}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    color: THEME.textPrimary,
                    fontSize: '12px',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Results Count */}
          <div style={{ marginTop: '16px', fontSize: '12px', color: THEME.textSecondary }}>
            Showing {screenerMode === 'stocks' ? (displayedQuotes.length > 0 ? startIndex + 1 : 0) : (displayedEarnings.length > 0 ? startIndex + 1 : 0)} - {Math.min(startIndex + itemsPerPage, screenerMode === 'stocks' ? filteredQuotes.length : filteredEarnings.length)} of {screenerMode === 'stocks' ? filteredQuotes.length : filteredEarnings.length} results
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
            <Loader size={40} color={THEME.accent} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : screenerMode === 'stocks' && data ? (
          <>
            {/* Stock Screener Table */}
            <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: THEME.background, borderBottom: `1px solid ${THEME.border}` }}>
                      <th
                        onClick={() => handleSortClick('Name')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Name' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Company {sortBy === 'Name' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: THEME.textSecondary,
                        }}
                      >
                        Ticker
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: THEME.textSecondary,
                        }}
                      >
                        Sector
                      </th>
                      <th
                        onClick={() => handleSortClick('Price')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Price' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Price {sortBy === 'Price' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: THEME.textSecondary,
                        }}
                      >
                        Change
                      </th>
                      <th
                        onClick={() => handleSortClick('Change%')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Change%' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Change% {sortBy === 'Change%' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSortClick('Volume')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Volume' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Volume {sortBy === 'Volume' && (sortAscending ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedQuotes.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center', color: THEME.textSecondary }}>
                          No results found
                        </td>
                      </tr>
                    ) : (
                      displayedQuotes.map((quote) => (
                        <tr
                          key={quote.ticker}
                          style={{
                            borderBottom: `1px solid ${THEME.border}`,
                            transition: 'background 0.2s',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = THEME.cardHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                          }}
                        >
                          <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '600', color: THEME.textPrimary }}>
                            {quote.company}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.accent, fontWeight: '600' }}>
                            {quote.ticker}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.textSecondary }}>
                            {quote.sector}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textPrimary, fontWeight: '500' }}>
                            {quote.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td
                            style={{
                              padding: '12px 16px',
                              fontSize: '12px',
                              textAlign: 'right',
                              color: quote.change >= 0 ? THEME.green : THEME.red,
                              fontWeight: '500',
                            }}
                          >
                            {quote.change > 0 ? '+' : ''}
                            {quote.change.toFixed(2)}
                          </td>
                          <td
                            style={{
                              padding: '12px 16px',
                              fontSize: '12px',
                              textAlign: 'right',
                              color: quote.changePercent >= 0 ? THEME.green : THEME.red,
                              fontWeight: '600',
                            }}
                          >
                            {quote.changePercent > 0 ? '+' : ''}
                            {quote.changePercent.toFixed(2)}%
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textSecondary }}>
                            {(quote.volume / 1000000).toFixed(1)}M
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : screenerMode === 'earnings' && earningsData ? (
          <>
            {/* Earnings Screener Table */}
            <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: THEME.background, borderBottom: `1px solid ${THEME.border}` }}>
                      <th
                        onClick={() => handleSortClick('Name')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Name' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Company {sortBy === 'Name' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Symbol
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Quality
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Quarter
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Revenue
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Net Profit
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        EPS
                      </th>
                      <th
                        onClick={() => handleSortClick('Price')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Price' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Price {sortBy === 'Price' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSortClick('Change%')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Change%' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Move% {sortBy === 'Change%' && (sortAscending ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedEarnings.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: '32px 16px', textAlign: 'center', color: THEME.textSecondary }}>
                          No earnings data found
                        </td>
                      </tr>
                    ) : (
                      displayedEarnings.map((earning) => (
                        <tr
                          key={earning.symbol}
                          style={{
                            borderBottom: `1px solid ${THEME.border}`,
                            transition: 'background 0.2s',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = THEME.cardHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                          }}
                        >
                          <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '600', color: THEME.textPrimary }}>
                            {earning.company}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.accent, fontWeight: '600' }}>
                            {earning.symbol}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.textSecondary }}>
                            {earning.quality}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.textSecondary }}>
                            {earning.quarter}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textPrimary }}>
                            {formatNumber(earning.revenue)}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textPrimary }}>
                            {formatNumber(earning.netProfit)}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textPrimary, fontWeight: '500' }}>
                            {earning.eps.toFixed(2)}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textPrimary, fontWeight: '500' }}>
                            {earning.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td
                            style={{
                              padding: '12px 16px',
                              fontSize: '12px',
                              textAlign: 'right',
                              color: earning.movePercent >= 0 ? THEME.green : THEME.red,
                              fontWeight: '600',
                            }}
                          >
                            {earning.movePercent > 0 ? '+' : ''}
                            {earning.movePercent.toFixed(2)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              style={{
                padding: '8px 12px',
                background: currentPage === 1 ? THEME.border : THEME.accent,
                color: THEME.background,
                border: 'none',
                borderRadius: '6px',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                opacity: currentPage === 1 ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
            >
              Previous
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pageNum = currentPage <= 3 ? i + 1 : currentPage - 2 + i;
              if (pageNum > totalPages) return null;
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  style={{
                    padding: '8px 12px',
                    background: currentPage === pageNum ? THEME.accent : THEME.card,
                    color: currentPage === pageNum ? THEME.background : THEME.textSecondary,
                    border: `1px solid ${THEME.border}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: currentPage === pageNum ? '600' : '400',
                    transition: 'all 0.2s',
                  }}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              style={{
                padding: '8px 12px',
                background: currentPage === totalPages ? THEME.border : THEME.accent,
                color: THEME.background,
                border: 'none',
                borderRadius: '6px',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                opacity: currentPage === totalPages ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
            >
              Next
            </button>
          </div>
        )}

        {/* Last Updated */}
        {(data || earningsData) && (
          <div style={{ textAlign: 'center', fontSize: '11px', color: THEME.textSecondary }}>
            Last updated: {new Date(screenerMode === 'stocks' ? (data?.updatedAt || '') : (earningsData?.updatedAt || '')).toLocaleTimeString()}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
