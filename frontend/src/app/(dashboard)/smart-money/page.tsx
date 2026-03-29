'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, Search } from 'lucide-react';

interface Deal {
  symbol: string;
  clientName: string;
  dealDate: string;
  quantity: number;
  tradePrice: number;
  buyOrSell: string;
  tradeType: 'Bulk' | 'Block';
  quality: 'Institutional' | 'Retail';
}

interface Summary {
  total: number;
  bulk: number;
  block: number;
  institutional: number;
  retail: number;
}

interface ApiResponse {
  deals: Deal[];
  summary: Summary;
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

type TradeTypeFilter = 'All' | 'Bulk' | 'Block';
type SideFilter = 'All' | 'Buy' | 'Sell';
type QualityFilter = 'All' | 'Institutional' | 'Retail';

export default function SmartMoneyPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Filters
  const [tradeTypeFilter, setTradeTypeFilter] = useState<TradeTypeFilter>('All');
  const [sideFilter, setSideFilter] = useState<SideFilter>('All');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = async () => {
    try {
      setError(null);
      setIsRefreshing(true);
      const response = await fetch('/api/market/smart-money');

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const json = await response.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const filteredDeals = React.useMemo(() => {
    if (!data) return [];

    return data.deals.filter((deal) => {
      // Filter by trade type
      if (tradeTypeFilter !== 'All' && deal.tradeType !== tradeTypeFilter) {
        return false;
      }

      // Filter by side
      if (sideFilter !== 'All') {
        const dealSide = deal.buyOrSell.toUpperCase();
        if (sideFilter === 'Buy' && dealSide !== 'BUY') return false;
        if (sideFilter === 'Sell' && dealSide !== 'SELL') return false;
      }

      // Filter by quality
      if (qualityFilter !== 'All' && deal.quality !== qualityFilter) {
        return false;
      }

      // Filter by search query (symbol or client name)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const symbolMatch = deal.symbol.toLowerCase().includes(query);
        const clientMatch = deal.clientName.toLowerCase().includes(query);
        if (!symbolMatch && !clientMatch) return false;
      }

      return true;
    });
  }, [data, tradeTypeFilter, sideFilter, qualityFilter, searchQuery]);

  const formatNumber = (num: number) => {
    if (num >= 1e7) return (num / 1e7).toFixed(2) + 'Cr';
    if (num >= 1e5) return (num / 1e5).toFixed(2) + 'L';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  };

  const formatTime = (date: Date | null) => {
    if (!date) return 'Never';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  const getSideColor = (side: string): string => {
    const upper = side.toUpperCase();
    return upper === 'BUY' ? THEME.green : THEME.red;
  };

  const getSideLabel = (side: string): string => {
    const upper = side.toUpperCase();
    return upper === 'BUY' ? 'Buy' : 'Sell';
  };

  return (
    <div style={{ backgroundColor: THEME.background, color: THEME.textPrimary, minHeight: '100vh', padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>Smart Money Radar</h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
              Refresh
            </button>

            {/* Last Updated */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: THEME.textSecondary }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: THEME.green,
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                }}
              />
              Last: {formatTime(lastUpdated)}
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        {data && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div
              style={{
                backgroundColor: THEME.card,
                border: `1px solid ${THEME.border}`,
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Total Deals</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.textPrimary }}>{data.summary.total}</div>
            </div>
            <div
              style={{
                backgroundColor: THEME.card,
                border: `1px solid ${THEME.border}`,
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Bulk Deals</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.accent }}>{data.summary.bulk}</div>
            </div>
            <div
              style={{
                backgroundColor: THEME.card,
                border: `1px solid ${THEME.border}`,
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Block Deals</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.accent }}>{data.summary.block}</div>
            </div>
            <div
              style={{
                backgroundColor: THEME.card,
                border: `1px solid ${THEME.border}`,
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Institutional</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.green }}>{data.summary.institutional}</div>
            </div>
            <div
              style={{
                backgroundColor: THEME.card,
                border: `1px solid ${THEME.border}`,
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Retail</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.red }}>{data.summary.retail}</div>
            </div>
          </div>
        )}
      </div>

      {/* Filters Section */}
      {!loading && (
        <div style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Search Box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              borderRadius: '8px',
              padding: '8px 12px',
              gap: '8px',
              width: '100%',
              maxWidth: '400px',
            }}
          >
            <Search size={16} color={THEME.textSecondary} />
            <input
              type="text"
              placeholder="Search symbol or client..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                backgroundColor: 'transparent',
                border: 'none',
                color: THEME.textPrimary,
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          {/* Filter Buttons */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {/* Trade Type Filter */}
            <div style={{ display: 'flex', gap: '6px', backgroundColor: THEME.card, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
              {(['All', 'Bulk', 'Block'] as TradeTypeFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTradeTypeFilter(filter)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: tradeTypeFilter === filter ? THEME.accent : 'transparent',
                    color: tradeTypeFilter === filter ? '#FFFFFF' : THEME.textSecondary,
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Side Filter */}
            <div style={{ display: 'flex', gap: '6px', backgroundColor: THEME.card, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
              {(['All', 'Buy', 'Sell'] as SideFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setSideFilter(filter)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: sideFilter === filter ? THEME.accent : 'transparent',
                    color: sideFilter === filter ? '#FFFFFF' : THEME.textSecondary,
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Quality Filter */}
            <div style={{ display: 'flex', gap: '6px', backgroundColor: THEME.card, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
              {(['All', 'Institutional', 'Retail'] as QualityFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setQualityFilter(filter)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: qualityFilter === filter ? THEME.accent : 'transparent',
                    color: qualityFilter === filter ? '#FFFFFF' : THEME.textSecondary,
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '400px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              border: `3px solid ${THEME.border}`,
              borderTop: `3px solid ${THEME.accent}`,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${THEME.red}`,
            borderRadius: '12px',
            padding: '16px',
            color: THEME.red,
            marginBottom: '24px',
          }}
        >
          Error loading data: {error}
        </div>
      )}

      {/* Deals Table */}
      {data && !loading && (
        <div
          style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px',
              borderBottom: `1px solid ${THEME.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>Deals</h3>
            <div
              style={{
                display: 'inline-flex',
                backgroundColor: THEME.accent,
                color: '#FFFFFF',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 'bold',
              }}
            >
              {filteredDeals.length}
            </div>
          </div>

          {filteredDeals.length === 0 ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: THEME.textSecondary,
              }}
            >
              No deals found matching your filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px',
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: THEME.background, borderBottom: `1px solid ${THEME.border}` }}>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Date</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Symbol</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Client</th>
                    <th style={{ padding: '12px', textAlign: 'center', color: THEME.textSecondary, fontWeight: '500' }}>Type</th>
                    <th style={{ padding: '12px', textAlign: 'center', color: THEME.textSecondary, fontWeight: '500' }}>Side</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Qty</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Price</th>
                    <th style={{ padding: '12px', textAlign: 'center', color: THEME.textSecondary, fontWeight: '500' }}>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((deal, idx) => (
                    <tr
                      key={`${deal.symbol}-${deal.dealDate}-${idx}`}
                      style={{
                        borderBottom: `1px solid ${THEME.border}`,
                        backgroundColor: THEME.card,
                        transition: 'all 0.2s ease',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = THEME.cardHover;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = THEME.card;
                      }}
                    >
                      <td style={{ padding: '12px', color: THEME.textSecondary, fontSize: '12px' }}>{deal.dealDate}</td>
                      <td style={{ padding: '12px', color: THEME.accent, fontWeight: '600' }}>{deal.symbol}</td>
                      <td style={{ padding: '12px', color: THEME.textPrimary, maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {deal.clientName}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', color: THEME.textSecondary, fontSize: '12px', fontWeight: '500' }}>
                        {deal.tradeType}
                      </td>
                      <td
                        style={{
                          padding: '12px',
                          textAlign: 'center',
                          color: getSideColor(deal.buyOrSell),
                          fontWeight: '600',
                        }}
                      >
                        {getSideLabel(deal.buyOrSell)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', color: THEME.textPrimary }}>{formatNumber(deal.quantity)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: THEME.textPrimary }}>₹{deal.tradePrice.toFixed(2)}</td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: '600',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            backgroundColor: deal.quality === 'Institutional' ? '#10B98120' : '#EF444420',
                            color: deal.quality === 'Institutional' ? THEME.green : THEME.red,
                          }}
                        >
                          {deal.quality}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
