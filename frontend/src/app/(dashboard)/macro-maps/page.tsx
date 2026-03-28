'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface MarketData {
  symbol: string;
  name: string;
  region: string;
  flag: string;
  value: number;
  change: number;
  changePercent: number;
  previousClose: number;
}

interface ApiResponse {
  indices: MarketData[];
  currencies: MarketData[];
  commodities: MarketData[];
  bonds: MarketData[];
  updatedAt: string;
}

type AssetClass = 'indices' | 'currencies' | 'commodities' | 'bonds';

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

const ASSET_CLASSES: { key: AssetClass; label: string }[] = [
  { key: 'indices', label: 'Indices' },
  { key: 'currencies', label: 'Currencies' },
  { key: 'commodities', label: 'Commodities' },
  { key: 'bonds', label: 'Bonds' },
];

export default function MacroMapsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AssetClass>('indices');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setIsFetching(true);
      const response = await fetch('/api/market/macro');
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }
      const jsonData: ApiResponse = await response.json();
      setData(jsonData);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch data';
      setError(errorMessage);
      console.error('Error fetching macro data:', err);
    } finally {
      setIsFetching(false);
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchData]);

  const groupByRegion = (assets: MarketData[]) => {
    const grouped: { [region: string]: MarketData[] } = {};
    assets.forEach((asset) => {
      if (!grouped[asset.region]) {
        grouped[asset.region] = [];
      }
      grouped[asset.region].push(asset);
    });
    return grouped;
  };

  const calculateSummary = () => {
    if (!data) return null;

    const allData = [
      ...data.indices,
      ...data.currencies,
      ...data.commodities,
      ...data.bonds,
    ];

    const positiveCount = allData.filter((item) => item.change > 0).length;
    const totalCount = allData.length;

    return positiveCount > totalCount / 2 ? 'up' : 'down';
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (loading && !data) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: THEME.background,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              border: `3px solid ${THEME.border}`,
              borderTop: `3px solid ${THEME.accent}`,
              borderRadius: '50%',
              margin: '0 auto 16px',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ color: THEME.textSecondary, marginTop: '16px' }}>
            Loading market data...
          </p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  const activeData = data ? data[activeTab] : [];
  const groupedData = groupByRegion(activeData);
  const summary = calculateSummary();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: THEME.background }}>
      {/* Header */}
      <div style={{ padding: '32px 24px' }}>
        <h1
          style={{
            margin: '0 0 8px 0',
            fontSize: '32px',
            fontWeight: 700,
            color: THEME.textPrimary,
          }}
        >
          Macro Maps
        </h1>
        <p style={{ margin: 0, color: THEME.textSecondary, fontSize: '14px' }}>
          Global market overview and trends
        </p>
      </div>

      {/* Summary Section */}
      {summary && (
        <div
          style={{
            padding: '0 24px 24px',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: summary === 'up' ? THEME.green : THEME.red,
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }}
            />
            <p
              style={{
                margin: 0,
                color: THEME.textPrimary,
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              Markets are mostly{' '}
              <span style={{ color: summary === 'up' ? THEME.green : THEME.red }}>
                {summary}
              </span>{' '}
              today
            </p>
            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
              }
            `}</style>
          </div>
        </div>
      )}

      {/* Last Update Section */}
      <div
        style={{
          padding: '0 24px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: THEME.green,
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
          />
          <span style={{ color: THEME.textSecondary, fontSize: '12px' }}>
            Live
          </span>
          {lastUpdate && (
            <span style={{ color: THEME.textSecondary, fontSize: '12px' }}>
              Last updated: {formatTime(lastUpdate)}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            fetchData();
          }}
          disabled={isFetching}
          style={{
            padding: '6px 12px',
            backgroundColor: isFetching ? THEME.border : THEME.accent,
            color: THEME.textPrimary,
            border: 'none',
            borderRadius: '4px',
            cursor: isFetching ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            opacity: isFetching ? 0.6 : 1,
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (!isFetching) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#0D6AA8';
            }
          }}
          onMouseLeave={(e) => {
            if (!isFetching) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = THEME.accent;
            }
          }}
        >
          {isFetching ? 'Refreshing...' : 'Refresh Now'}
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          padding: '0 24px 24px',
          display: 'flex',
          gap: '8px',
          borderBottom: `1px solid ${THEME.border}`,
          overflowX: 'auto',
        }}
      >
        {ASSET_CLASSES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '12px 16px',
              backgroundColor: activeTab === key ? 'transparent' : 'transparent',
              color: activeTab === key ? THEME.accent : THEME.textSecondary,
              border: 'none',
              borderBottom: activeTab === key ? `2px solid ${THEME.accent}` : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== key) {
                (e.currentTarget as HTMLButtonElement).style.color = THEME.textPrimary;
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== key) {
                (e.currentTarget as HTMLButtonElement).style.color = THEME.textSecondary;
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '24px' }}>
        {error && (
          <div
            style={{
              padding: '16px',
              backgroundColor: `${THEME.red}20`,
              border: `1px solid ${THEME.red}`,
              borderRadius: '8px',
              color: THEME.red,
              fontSize: '14px',
              marginBottom: '24px',
            }}
          >
            Error loading data: {error}
          </div>
        )}

        {activeData.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: THEME.textSecondary,
            }}
          >
            <p style={{ margin: 0, fontSize: '14px' }}>No data available for this category</p>
          </div>
        ) : (
          Object.entries(groupedData).map(([region, regionAssets]) => (
            <div key={region} style={{ marginBottom: '32px' }}>
              {/* Region Header */}
              <h2
                style={{
                  margin: '0 0 16px 0',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: THEME.textPrimary,
                  paddingBottom: '8px',
                  borderBottom: `1px solid ${THEME.border}`,
                }}
              >
                {region}
              </h2>

              {/* Cards Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '16px',
                }}
              >
                {regionAssets.map((asset) => {
                  const isPositive = asset.change >= 0;
                  const changeColor = isPositive ? THEME.green : THEME.red;
                  const maxChange = Math.max(
                    ...activeData.map((a) => Math.abs(a.change))
                  );
                  const progressPercentage = maxChange > 0 ? (Math.abs(asset.change) / maxChange) * 100 : 0;

                  return (
                    <div
                      key={asset.symbol}
                      style={{
                        padding: '16px',
                        backgroundColor: THEME.card,
                        border: `1px solid ${THEME.border}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget as HTMLDivElement;
                        el.style.backgroundColor = THEME.cardHover;
                        el.style.borderColor = THEME.accent;
                        el.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLDivElement;
                        el.style.backgroundColor = THEME.card;
                        el.style.borderColor = THEME.border;
                        el.style.transform = 'translateY(0)';
                      }}
                    >
                      {/* Top Row: Flag and Name */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          marginBottom: '12px',
                        }}
                      >
                        <span style={{ fontSize: '20px' }}>{asset.flag}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p
                            style={{
                              margin: 0,
                              fontSize: '14px',
                              fontWeight: 500,
                              color: THEME.textPrimary,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {asset.name}
                          </p>
                          <p
                            style={{
                              margin: '2px 0 0 0',
                              fontSize: '11px',
                              color: THEME.textSecondary,
                            }}
                          >
                            {asset.symbol}
                          </p>
                        </div>
                      </div>

                      {/* Current Value */}
                      <div style={{ marginBottom: '12px' }}>
                        <p
                          style={{
                            margin: '0 0 4px 0',
                            fontSize: '12px',
                            color: THEME.textSecondary,
                          }}
                        >
                          Current Value
                        </p>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '20px',
                            fontWeight: 700,
                            color: THEME.textPrimary,
                          }}
                        >
                          {asset.value.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </div>

                      {/* Change Info */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '12px',
                        }}
                      >
                        <div>
                          <p
                            style={{
                              margin: '0 0 4px 0',
                              fontSize: '12px',
                              color: THEME.textSecondary,
                            }}
                          >
                            Change
                          </p>
                          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: changeColor }}>
                            {isPositive ? '+' : ''}{asset.change.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p
                            style={{
                              margin: '0 0 4px 0',
                              fontSize: '12px',
                              color: THEME.textSecondary,
                            }}
                          >
                            Change %
                          </p>
                          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: changeColor }}>
                            {isPositive ? '+' : ''}{asset.changePercent.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}%
                          </p>
                        </div>
                      </div>

                      {/* Previous Close */}
                      <div style={{ marginBottom: '12px' }}>
                        <p
                          style={{
                            margin: '0 0 4px 0',
                            fontSize: '12px',
                            color: THEME.textSecondary,
                          }}
                        >
                          Previous Close
                        </p>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '13px',
                            color: THEME.textPrimary,
                          }}
                        >
                          {asset.previousClose.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </div>

                      {/* Progress Bar */}
                      <div
                        style={{
                          width: '100%',
                          height: '4px',
                          backgroundColor: THEME.border,
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            backgroundColor: changeColor,
                            width: `${progressPercentage}%`,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
