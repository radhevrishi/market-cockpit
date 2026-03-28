'use client';

import { useEffect, useState } from 'react';

interface Subscription {
  retail?: number;
  hni?: number;
  institutional?: number;
  employee?: number;
}

interface IPO {
  id: number;
  company: string;
  exchange: string;
  status: 'open' | 'upcoming' | 'listed' | 'info' | string;
  priceBand: string;
  dates: string | { open?: string; close?: string; listing?: string };
  issueSize: string;
  sector: string;
  lotSize: number | string;
  subscription?: Subscription;
  gmp: number;
  symbol?: string;
  listingPrice?: number;
  listingGain?: number;
  description?: string;
}

interface IPOResponse {
  ipos: IPO[];
  summary?: { open: number; upcoming: number; listed: number; total: number };
  updatedAt: string;
  source: string;
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

export default function IPOsPage() {
  const [ipos, setIpos] = useState<IPO[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [dataSource, setDataSource] = useState<string>('');
  const [error, setError] = useState<string>('');

  const fetchIPOs = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/market/ipos');

      if (!response.ok) {
        throw new Error('Failed to fetch IPOs');
      }

      const data: IPOResponse = await response.json();
      setIpos(data.ipos);
      setLastUpdated(data.updatedAt);
      setDataSource(data.source);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching IPOs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIPOs();
    const interval = setInterval(fetchIPOs, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return THEME.green;
      case 'upcoming':
        return THEME.accent;
      case 'listed':
        return THEME.textSecondary;
      default:
        return THEME.textSecondary;
    }
  };

  const getStatusLabel = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const openCount = ipos.filter(i => i.status === 'open').length;
  const upcomingCount = ipos.filter(i => i.status === 'upcoming').length;
  const listedCount = ipos.filter(i => i.status === 'listed').length;

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div style={{
      backgroundColor: THEME.background,
      minHeight: '100vh',
      padding: '24px',
      color: THEME.textPrimary,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 'bold',
          margin: '0 0 8px 0',
        }}>
          IPO Market
        </h1>
        <p style={{
          color: THEME.textSecondary,
          margin: 0,
          fontSize: '14px',
        }}>
          Monitor upcoming and active Initial Public Offerings
        </p>
      </div>

      {/* Last Updated & Source */}
      {lastUpdated && !loading && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          fontSize: '12px',
          color: THEME.textSecondary,
        }}>
          <span>
            Last updated: {formatDate(lastUpdated)}
          </span>
          {dataSource && (
            <span>
              Data from {dataSource}. For comprehensive IPO info, visit NSE/BSE.
            </span>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '400px',
        }}>
          <div style={{
            display: 'inline-block',
            width: '40px',
            height: '40px',
            border: `3px solid ${THEME.border}`,
            borderTop: `3px solid ${THEME.accent}`,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div style={{
          backgroundColor: THEME.card,
          border: `1px solid ${THEME.red}`,
          borderRadius: '8px',
          padding: '16px',
          color: THEME.red,
          marginBottom: '24px',
        }}>
          Error loading IPOs: {error}
        </div>
      )}

      {/* Status Summary Cards */}
      {!loading && !error && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}>
          {/* Open IPOs Card */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '8px',
            padding: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = THEME.cardHover;
            e.currentTarget.style.borderColor = THEME.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = THEME.card;
            e.currentTarget.style.borderColor = THEME.border;
          }}>
            <div style={{
              fontSize: '12px',
              color: THEME.textSecondary,
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Open IPOs
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: THEME.green,
            }}>
              {openCount}
            </div>
          </div>

          {/* Upcoming IPOs Card */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '8px',
            padding: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = THEME.cardHover;
            e.currentTarget.style.borderColor = THEME.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = THEME.card;
            e.currentTarget.style.borderColor = THEME.border;
          }}>
            <div style={{
              fontSize: '12px',
              color: THEME.textSecondary,
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Upcoming IPOs
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: THEME.accent,
            }}>
              {upcomingCount}
            </div>
          </div>

          {/* Recently Listed Card */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '8px',
            padding: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = THEME.cardHover;
            e.currentTarget.style.borderColor = THEME.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = THEME.card;
            e.currentTarget.style.borderColor = THEME.border;
          }}>
            <div style={{
              fontSize: '12px',
              color: THEME.textSecondary,
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Recently Listed
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: THEME.textSecondary,
            }}>
              {listedCount}
            </div>
          </div>
        </div>
      )}

      {/* IPO Grid */}
      {!loading && !error && ipos.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
          gap: '20px',
        }}>
          {ipos.map((ipo) => (
            <div
              key={ipo.id}
              style={{
                backgroundColor: THEME.card,
                border: `1px solid ${THEME.border}`,
                borderRadius: '8px',
                padding: '20px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = THEME.cardHover;
                e.currentTarget.style.borderColor = THEME.accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = THEME.card;
                e.currentTarget.style.borderColor = THEME.border;
              }}>
              {/* Header: Company Name */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '16px',
              }}>
                <div>
                  <h3 style={{
                    margin: '0 0 4px 0',
                    fontSize: '18px',
                    fontWeight: 'bold',
                  }}>
                    {ipo.company}
                  </h3>
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                  }}>
                    {/* Exchange Badge */}
                    <span style={{
                      display: 'inline-block',
                      backgroundColor: THEME.border,
                      color: THEME.textSecondary,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '500',
                    }}>
                      {ipo.exchange}
                    </span>
                    {/* Status Badge */}
                    <span style={{
                      display: 'inline-block',
                      backgroundColor: getStatusColor(ipo.status),
                      color: ipo.status === 'listed' ? THEME.card : THEME.background,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '500',
                    }}>
                      {getStatusLabel(ipo.status)}
                    </span>
                  </div>
                </div>
                {ipo.gmp !== 0 && (
                  <div style={{
                    backgroundColor: ipo.gmp > 0 ? THEME.green : THEME.red,
                    color: THEME.background,
                    padding: '6px 10px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                  }}>
                    GMP<br />{ipo.gmp > 0 ? '+' : ''}{ipo.gmp}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div style={{
                height: '1px',
                backgroundColor: THEME.border,
                marginBottom: '16px',
              }} />

              {/* Details Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
                marginBottom: '16px',
              }}>
                {/* Price Band */}
                <div>
                  <div style={{
                    fontSize: '11px',
                    color: THEME.textSecondary,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                    letterSpacing: '0.5px',
                  }}>
                    Price Band
                  </div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                  }}>
                    {ipo.priceBand}
                  </div>
                </div>

                {/* Lot Size */}
                <div>
                  <div style={{
                    fontSize: '11px',
                    color: THEME.textSecondary,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                    letterSpacing: '0.5px',
                  }}>
                    Lot Size
                  </div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                  }}>
                    {ipo.lotSize}
                  </div>
                </div>

                {/* Issue Size */}
                <div>
                  <div style={{
                    fontSize: '11px',
                    color: THEME.textSecondary,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                    letterSpacing: '0.5px',
                  }}>
                    Issue Size
                  </div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                  }}>
                    {ipo.issueSize}
                  </div>
                </div>

                {/* Sector */}
                <div>
                  <div style={{
                    fontSize: '11px',
                    color: THEME.textSecondary,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                    letterSpacing: '0.5px',
                  }}>
                    Sector
                  </div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                  }}>
                    {ipo.sector}
                  </div>
                </div>
              </div>

              {/* Dates */}
              <div style={{
                backgroundColor: THEME.background,
                padding: '12px',
                borderRadius: '4px',
                fontSize: '12px',
                color: THEME.textSecondary,
              }}>
                <strong>Timeline:</strong>{' '}
                {typeof ipo.dates === 'string'
                  ? ipo.dates
                  : ipo.dates && typeof ipo.dates === 'object'
                    ? `Open: ${ipo.dates.open || '-'} | Close: ${ipo.dates.close || '-'} | Listing: ${ipo.dates.listing || '-'}`
                    : '-'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && ipos.length === 0 && (
        <div style={{
          backgroundColor: THEME.card,
          border: `1px solid ${THEME.border}`,
          borderRadius: '8px',
          padding: '40px',
          textAlign: 'center',
          color: THEME.textSecondary,
        }}>
          <p style={{ margin: 0, marginBottom: '8px' }}>
            No IPO data available at the moment
          </p>
          <p style={{ margin: 0, fontSize: '12px' }}>
            Data from {dataSource || 'API'}. For comprehensive IPO info, visit NSE/BSE.
          </p>
        </div>
      )}
    </div>
  );
}
