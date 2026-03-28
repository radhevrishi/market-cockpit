'use client';

import React, { useState, useEffect } from 'react';
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

export default function MoversPage() {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setError(null);
      setIsRefreshing(true);
      const response = await fetch(`/api/market/quotes?market=${market}`);

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
  }, [market]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 60000);

    return () => clearInterval(interval);
  }, [market]);

  const getSectorData = () => {
    if (!data) return {};

    const sectorMap: { [key: string]: { stocks: Stock[]; totalChange: number } } = {};

    data.stocks.forEach((stock) => {
      if (!sectorMap[stock.sector]) {
        sectorMap[stock.sector] = { stocks: [], totalChange: 0 };
      }
      sectorMap[stock.sector].stocks.push(stock);
      sectorMap[stock.sector].totalChange += stock.changePercent;
    });

    Object.keys(sectorMap).forEach((sector) => {
      sectorMap[sector].totalChange =
        sectorMap[sector].totalChange / sectorMap[sector].stocks.length;
    });

    return sectorMap;
  };

  const getSectorColor = (changePercent: number) => {
    if (changePercent > 1) return THEME.green;
    if (changePercent > 0.5) return '#1EA76D';
    if (changePercent > 0) return '#2DB888';
    if (changePercent > -0.5) return '#F97316';
    if (changePercent > -1) return '#EF5350';
    return THEME.red;
  };

  const sectorData = getSectorData();
  const gainers = data?.gainers?.slice(0, 20) || [];
  const losers = data?.losers?.slice(0, 20) || [];

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

  return (
    <div style={{ backgroundColor: THEME.background, color: THEME.textPrimary, minHeight: '100vh', padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>Market Movers</h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Market Toggle */}
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
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: THEME.green,
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }} />
              Last: {formatTime(lastUpdated)}
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        {data && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
            <div style={{
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              borderRadius: '12px',
              padding: '16px',
            }}>
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Total Stocks</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.textPrimary }}>{data.summary.total}</div>
            </div>
            <div style={{
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              borderRadius: '12px',
              padding: '16px',
            }}>
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Gainers</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.green }}>{data.summary.gainersCount}</div>
            </div>
            <div style={{
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              borderRadius: '12px',
              padding: '16px',
            }}>
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Losers</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.red }}>{data.summary.losersCount}</div>
            </div>
            <div style={{
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              borderRadius: '12px',
              padding: '16px',
            }}>
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Avg Change</div>
              <div style={{
                fontSize: '28px',
                fontWeight: 'bold',
                color: data.summary.avgChange > 0 ? THEME.green : THEME.red,
              }}>
                {data.summary.avgChange > 0 ? '+' : ''}{data.summary.avgChange.toFixed(2)}%
              </div>
            </div>
            <div style={{
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              borderRadius: '12px',
              padding: '16px',
            }}>
              <div style={{ color: THEME.textSecondary, fontSize: '12px', marginBottom: '8px' }}>Sectors</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME.textPrimary }}>{data.summary.sectors}</div>
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

      {/* Sector Heatmap */}
      {data && !loading && Object.keys(sectorData).length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>Sector Performance</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '12px',
          }}>
            {Object.entries(sectorData)
              .sort((a, b) => b[1].totalChange - a[1].totalChange)
              .map(([sector, info]) => (
                <div
                  key={sector}
                  style={{
                    backgroundColor: getSectorColor(info.totalChange),
                    borderRadius: '12px',
                    padding: '16px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    opacity: 0.8,
                    transform: 'scale(1)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.opacity = '1';
                    (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.opacity = '0.8';
                    (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sector}
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#FFFFFF' }}>
                    {info.totalChange > 0 ? '+' : ''}{info.totalChange.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', marginTop: '8px' }}>
                    {info.stocks.length} stocks
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tables Container */}
      {data && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Top Gainers Table */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '16px',
              borderBottom: `1px solid ${THEME.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>Top Gainers</h3>
              <div style={{
                display: 'inline-flex',
                backgroundColor: THEME.green,
                color: '#FFFFFF',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 'bold',
              }}>
                LIVE
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
              }}>
                <thead>
                  <tr style={{ backgroundColor: THEME.background, borderBottom: `1px solid ${THEME.border}` }}>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Rank</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Ticker</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Company</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Price</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Change</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>%</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {gainers.map((stock, idx) => (
                    <tr
                      key={stock.ticker}
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
                      <td style={{ padding: '12px', color: THEME.textSecondary }}>{idx + 1}</td>
                      <td style={{ padding: '12px', color: THEME.accent, fontWeight: '600' }}>{stock.ticker}</td>
                      <td style={{ padding: '12px', color: THEME.textPrimary }}>{stock.company}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: THEME.textPrimary }}>₹{stock.price.toFixed(2)}</td>
                      <td style={{
                        padding: '12px',
                        textAlign: 'right',
                        color: stock.change > 0 ? THEME.green : THEME.red,
                        fontWeight: '500',
                      }}>
                        {stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)}
                      </td>
                      <td style={{
                        padding: '12px',
                        textAlign: 'right',
                        color: stock.changePercent > 0 ? THEME.green : THEME.red,
                        fontWeight: '600',
                      }}>
                        {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary }}>{formatNumber(stock.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Losers Table */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '16px',
              borderBottom: `1px solid ${THEME.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>Top Losers</h3>
              <div style={{
                display: 'inline-flex',
                backgroundColor: THEME.red,
                color: '#FFFFFF',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 'bold',
              }}>
                LIVE
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
              }}>
                <thead>
                  <tr style={{ backgroundColor: THEME.background, borderBottom: `1px solid ${THEME.border}` }}>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Rank</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Ticker</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '500' }}>Company</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Price</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Change</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>%</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary, fontWeight: '500' }}>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {losers.map((stock, idx) => (
                    <tr
                      key={stock.ticker}
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
                      <td style={{ padding: '12px', color: THEME.textSecondary }}>{idx + 1}</td>
                      <td style={{ padding: '12px', color: THEME.accent, fontWeight: '600' }}>{stock.ticker}</td>
                      <td style={{ padding: '12px', color: THEME.textPrimary }}>{stock.company}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: THEME.textPrimary }}>₹{stock.price.toFixed(2)}</td>
                      <td style={{
                        padding: '12px',
                        textAlign: 'right',
                        color: stock.change > 0 ? THEME.green : THEME.red,
                        fontWeight: '500',
                      }}>
                        {stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)}
                      </td>
                      <td style={{
                        padding: '12px',
                        textAlign: 'right',
                        color: stock.changePercent > 0 ? THEME.green : THEME.red,
                        fontWeight: '600',
                      }}>
                        {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', color: THEME.textSecondary }}>{formatNumber(stock.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
