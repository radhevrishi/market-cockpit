'use client';

import { useEffect, useState } from 'react';
// PATCH 0275 — Shared freshness chip helper.
import { PanelFreshness } from '@/components/PanelFreshness';

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
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number>(0); // PATCH 0275
  const [isFetchingState, setIsFetchingState] = useState<boolean>(false); // PATCH 0275
  const [dataSource, setDataSource] = useState<string>('');
  const [error, setError] = useState<string>('');

  const fetchIPOs = async () => {
    try {
      setLoading(true);
      setIsFetchingState(true);
      const response = await fetch('/api/market/ipos');

      if (!response.ok) {
        throw new Error('Failed to fetch IPOs');
      }

      const data: IPOResponse = await response.json();
      // PATCH 0460 — defend against malformed payload (data.ipos can be
      // undefined when upstream NSE/BSE scraper is down).
      setIpos(Array.isArray(data?.ipos) ? data.ipos : []);
      setLastUpdated(data?.updatedAt || '');
      setLastUpdatedMs(Date.now()); // PATCH 0275 — stamp success time for freshness chip
      setDataSource(data?.source || '');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching IPOs:', err);
    } finally {
      setLoading(false);
      setIsFetchingState(false);
    }
  };

  useEffect(() => {
    fetchIPOs();
    // AUDIT_100 #7 — skip poll when tab is hidden
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchIPOs();
    }, 5 * 60 * 1000);
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
    // PATCH 0271 — defend against undefined status
    if (!status || typeof status !== 'string') return 'Unknown';
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            margin: 0,
          }}>
            IPO Market
          </h1>
          {/* PATCH 0275 — Shared freshness chip; amber once the 5-min interval slips. */}
          <PanelFreshness dataUpdatedAt={lastUpdatedMs} isFetching={isFetchingState} staleAfterMs={10 * 60_000} />
        </div>
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
              Data from {dataSource}. For comprehensive IPO info, visit{' '}
              <a href="https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
                 target="_blank" rel="noopener noreferrer"
                 style={{ color: '#22D3EE', textDecoration: 'underline' }}>
                NSE
              </a>
              {' / '}
              <a href="https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx"
                 target="_blank" rel="noopener noreferrer"
                 style={{ color: '#22D3EE', textDecoration: 'underline' }}>
                BSE
              </a>
              {' '}directly.
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
                {typeof ipo.gmp === 'number' && ipo.gmp !== 0 && (
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

              {/* PATCH 0288 — Detect missing fields so we can surface a single
                  'Check NSE/BSE →' deeplink instead of repeating TBA / em-dash. */}
              {(() => {
                const missing = (v: any) => !v || v === '-' || v === '—' || v === 'TBA' || v === 'tba' || v === 'N/A';
                const hasMissing = missing(ipo.priceBand) || missing(ipo.lotSize) || missing(ipo.issueSize);
                return hasMissing ? (
                  <div style={{
                    marginBottom: '12px', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid rgba(245,158,11,0.30)',
                    backgroundColor: 'rgba(245,158,11,0.08)',
                    color: '#F59E0B', fontSize: 12, lineHeight: 1.5,
                  }}>
                    ⚠ Some fields are still TBA — RHP often lists them late. <a
                      href={`https://www.nseindia.com/market-data/all-upcoming-issues-ipo`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: '#F59E0B', textDecoration: 'underline', fontWeight: 700 }}
                    >Check NSE →</a> · <a
                      href={`https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: '#F59E0B', textDecoration: 'underline', fontWeight: 700 }}
                    >BSE →</a>
                  </div>
                ) : null;
              })()}

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
                    {ipo.priceBand && ipo.priceBand !== 'TBA' && ipo.priceBand !== 'tba' ? ipo.priceBand : <span style={{ color: THEME.textSecondary }}>—</span>}
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
                    {ipo.lotSize && ipo.lotSize !== '-' && ipo.lotSize !== '—' ? ipo.lotSize : <span style={{ color: THEME.textSecondary }}>—</span>}
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
                    {ipo.issueSize && ipo.issueSize !== '-' && ipo.issueSize !== '—' ? ipo.issueSize : <span style={{ color: THEME.textSecondary }}>—</span>}
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

      {/* Empty State — PATCH 0445 BUG-010: prominent NSE + BSE CTA buttons
          so the user has a one-click path off the dead-end empty screen. */}
      {!loading && !error && ipos.length === 0 && (
        <div style={{
          backgroundColor: THEME.card,
          border: `1px solid ${THEME.border}`,
          borderRadius: '8px',
          padding: '40px',
          textAlign: 'center',
          color: THEME.textSecondary,
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
          <p style={{ margin: 0, marginBottom: '8px', fontSize: 16, fontWeight: 600, color: THEME.textPrimary }}>
            No IPO data available at the moment
          </p>
          <p style={{ margin: 0, fontSize: '12px', marginBottom: 18 }}>
            Data from {dataSource || 'API'}. Check the exchange calendars directly:
          </p>
          <div style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a
              href="https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 18px', borderRadius: 8,
                background: '#22D3EE', color: '#000', fontWeight: 700, fontSize: 13,
                textDecoration: 'none', letterSpacing: '0.4px',
              }}
            >🏦 NSE IPO Calendar →</a>
            <a
              href="https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 18px', borderRadius: 8,
                background: '#F59E0B', color: '#000', fontWeight: 700, fontSize: 13,
                textDecoration: 'none', letterSpacing: '0.4px',
              }}
            >🏛 BSE IPO Calendar →</a>
            <a
              href="https://www.chittorgarh.com/report/ipo-list-in-india-bse-nse/83/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 18px', borderRadius: 8,
                background: 'transparent', border: `1px solid ${THEME.border}`,
                color: THEME.textPrimary, fontWeight: 600, fontSize: 13,
                textDecoration: 'none', letterSpacing: '0.4px',
              }}
            >📊 Chittorgarh IPO Tracker →</a>
          </div>
        </div>
      )}
    </div>
  );
}
