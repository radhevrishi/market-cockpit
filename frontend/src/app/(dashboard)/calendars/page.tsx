'use client';

import { useEffect, useState } from 'react';

interface Company {
  company: string;
  ticker: string;
  sector: string;
}

interface CalendarEvent {
  [date: string]: Company[];
}

interface CalendarResponse {
  india?: Company[];
  us?: Company[];
  companies?: Company[];
  events?: any[];
  calendar: CalendarEvent;
  weekStart: string;
  note: string;
  source?: string;
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

export default function CalendarPage() {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [error, setError] = useState<string>('');

  const fetchCalendarData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/market/calendar?market=india');

      if (!response.ok) {
        throw new Error('Failed to fetch calendar data');
      }

      const calendarData: CalendarResponse = await response.json();
      setData(calendarData);
      setLastUpdated(calendarData.updatedAt);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching calendar:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendarData();
    const interval = setInterval(fetchCalendarData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const today = new Date();
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
  const weekStart = new Date(currentWeekStart);
  weekStart.setDate(currentWeekStart.getDate() + weekOffset * 7);

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const weekDays = days.map((day, idx) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + idx);
    return { day, date };
  });

  const isCurrentWeek = weekOffset === 0;
  const todayDayOfWeek = today.getDay();
  const currentDayName = days[todayDayOfWeek === 0 ? 4 : todayDayOfWeek - 1];

  const getCompaniesForDay = (date: Date) => {
    if (!data) return [];
    const dateStr = date.toISOString().split('T')[0];
    return data.calendar[dateStr] || [];
  };

  const getSectorColor = (sector: string) => {
    const sectorLower = sector.toLowerCase();
    if (sectorLower.includes('tech') || sectorLower.includes('it')) return THEME.accent;
    if (sectorLower.includes('bank') || sectorLower.includes('finance')) return THEME.green;
    if (sectorLower.includes('energy') || sectorLower.includes('oil')) return THEME.red;
    return THEME.textSecondary;
  };

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

  const quarterCompanies = market === 'india'
    ? (data?.india || data?.companies || [])
    : (data?.us || []);

  return (
    <div style={{
      backgroundColor: THEME.background,
      minHeight: '100vh',
      padding: '24px',
      color: THEME.textPrimary,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 'bold',
          margin: '0 0 8px 0',
        }}>
          Earnings Calendar
        </h1>
        <p style={{
          color: THEME.textSecondary,
          margin: 0,
          fontSize: '14px',
        }}>
          Track major company earnings announcements and results
        </p>
      </div>

      {/* Last Updated */}
      {lastUpdated && !loading && (
        <div style={{
          marginBottom: '24px',
          fontSize: '12px',
          color: THEME.textSecondary,
        }}>
          Last updated: {formatDate(lastUpdated)}
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
          Error loading calendar: {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Market Toggle */}
          <div style={{
            marginBottom: '24px',
            display: 'flex',
            gap: '8px',
            backgroundColor: THEME.card,
            padding: '8px',
            borderRadius: '8px',
            border: `1px solid ${THEME.border}`,
            width: 'fit-content',
          }}>
            {(['india', 'us'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: market === m ? THEME.accent : 'transparent',
                  color: market === m ? '#fff' : THEME.textSecondary,
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                }}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Week Navigator */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
            backgroundColor: THEME.card,
            padding: '16px',
            borderRadius: '8px',
            border: `1px solid ${THEME.border}`,
          }}>
            <button
              onClick={() => setWeekOffset(weekOffset - 1)}
              style={{
                padding: '8px 16px',
                backgroundColor: THEME.accent,
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '13px',
              }}
            >
              Previous Week
            </button>

            <div style={{ textAlign: 'center' }}>
              <p style={{
                fontSize: '12px',
                color: THEME.textSecondary,
                margin: '0 0 4px 0',
              }}>
                Week of
              </p>
              <p style={{
                fontSize: '18px',
                fontWeight: 'bold',
                margin: 0,
              }}>
                {weekDays[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDays[4].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>

            <button
              onClick={() => setWeekOffset(weekOffset + 1)}
              style={{
                padding: '8px 16px',
                backgroundColor: THEME.accent,
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '13px',
              }}
            >
              Next Week
            </button>
          </div>

          {/* Calendar Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}>
            {weekDays.map(({ day, date }) => {
              const isToday = isCurrentWeek && day === currentDayName;
              const companies = getCompaniesForDay(date);

              return (
                <div
                  key={day}
                  style={{
                    backgroundColor: THEME.card,
                    borderRadius: '8px',
                    border: isToday ? `2px solid ${THEME.accent}` : `1px solid ${THEME.border}`,
                    padding: '16px',
                    minHeight: '300px',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isToday) {
                      e.currentTarget.style.backgroundColor = THEME.cardHover;
                      e.currentTarget.style.borderColor = THEME.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isToday) {
                      e.currentTarget.style.backgroundColor = THEME.card;
                      e.currentTarget.style.borderColor = THEME.border;
                    }
                  }}
                >
                  {/* Day Header */}
                  <div style={{
                    marginBottom: '12px',
                    paddingBottom: '12px',
                    borderBottom: `1px solid ${THEME.border}`,
                  }}>
                    <p style={{
                      fontSize: '12px',
                      color: THEME.textSecondary,
                      margin: '0 0 4px 0',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      {day}
                    </p>
                    <p style={{
                      fontSize: '18px',
                      fontWeight: 'bold',
                      margin: 0,
                    }}>
                      {date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                    </p>
                    {isToday && (
                      <span style={{
                        display: 'inline-block',
                        backgroundColor: THEME.accent,
                        color: '#fff',
                        padding: '3px 8px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontWeight: '600',
                        marginTop: '6px',
                      }}>
                        TODAY
                      </span>
                    )}
                  </div>

                  {/* Companies List */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}>
                    {companies.length > 0 ? (
                      companies.map((company, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '8px',
                            backgroundColor: THEME.background,
                            borderRadius: '4px',
                            border: `1px solid ${THEME.border}`,
                          }}
                        >
                          <p style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            margin: '0 0 2px 0',
                          }}>
                            {company.company}
                          </p>
                          <p style={{
                            fontSize: '11px',
                            color: THEME.textSecondary,
                            margin: '0 0 4px 0',
                          }}>
                            {company.ticker}
                          </p>
                          <span style={{
                            display: 'inline-block',
                            backgroundColor: getSectorColor(company.sector),
                            color: THEME.background,
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '10px',
                            fontWeight: '600',
                          }}>
                            {company.sector}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p style={{
                        color: THEME.textSecondary,
                        fontSize: '12px',
                        textAlign: 'center',
                        paddingTop: '40px',
                        margin: 0,
                      }}>
                        No earnings scheduled
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Major Companies This Quarter */}
          {quarterCompanies && quarterCompanies.length > 0 && (
            <div style={{
              backgroundColor: THEME.card,
              borderRadius: '8px',
              border: `1px solid ${THEME.border}`,
              padding: '20px',
            }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                margin: '0 0 16px 0',
                color: THEME.accent,
              }}>
                Major Companies This Quarter
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '12px',
              }}>
                {quarterCompanies.map((company, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '12px',
                      backgroundColor: THEME.background,
                      borderRadius: '6px',
                      border: `1px solid ${THEME.border}`,
                    }}
                  >
                    <p style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      margin: '0 0 4px 0',
                    }}>
                      {company.company}
                    </p>
                    <p style={{
                      fontSize: '12px',
                      color: THEME.textSecondary,
                      margin: '0 0 6px 0',
                    }}>
                      {company.ticker}
                    </p>
                    <span style={{
                      display: 'inline-block',
                      backgroundColor: getSectorColor(company.sector),
                      color: THEME.background,
                      padding: '3px 8px',
                      borderRadius: '3px',
                      fontSize: '11px',
                      fontWeight: '600',
                    }}>
                      {company.sector}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Note/Disclaimer */}
          {data?.note && (
            <div style={{
              marginTop: '24px',
              backgroundColor: THEME.background,
              borderRadius: '8px',
              border: `1px solid ${THEME.border}`,
              padding: '16px',
              fontSize: '12px',
              color: THEME.textSecondary,
              lineHeight: '1.6',
            }}>
              <strong style={{ color: THEME.textPrimary }}>Note:</strong> {data.note}
            </div>
          )}
        </>
      )}
    </div>
  );
}
