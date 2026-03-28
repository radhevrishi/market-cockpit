'use client';

import { useState } from 'react';

const EarningsCalendarPage = () => {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [weekOffset, setWeekOffset] = useState(0);

  // Sample earnings data for a full week
  const earningsDataByDay = {
    india: {
      Monday: [
        { company: 'TCS', ticker: 'TCS.NS', time: 'BMO', estimatedEPS: '₹4.25' },
        { company: 'Infosys', ticker: 'INFY.NS', time: 'BMO', estimatedEPS: '₹5.12' },
        { company: 'Wipro', ticker: 'WIPRO.NS', time: 'AMC', estimatedEPS: '₹2.87' },
      ],
      Tuesday: [
        { company: 'HDFC Bank', ticker: 'HDFCBANK.NS', time: 'BMO', estimatedEPS: '₹45.36' },
        { company: 'ICICI Bank', ticker: 'ICICIBANK.NS', time: 'AMC', estimatedEPS: '₹38.92' },
        { company: 'Axis Bank', ticker: 'AXISBANK.NS', time: 'BMO', estimatedEPS: '₹32.45' },
        { company: 'Kotak Bank', ticker: 'KOTAKBANK.NS', time: 'AMC', estimatedEPS: '₹48.75' },
      ],
      Wednesday: [
        { company: 'Reliance', ticker: 'RELIANCE.NS', time: 'BMO', estimatedEPS: '₹56.23' },
        { company: 'Bharti Airtel', ticker: 'BHARTIARTL.NS', time: 'AMC', estimatedEPS: '₹3.42' },
        { company: 'SBI', ticker: 'SBIN.NS', time: 'BMO', estimatedEPS: '₹35.67' },
      ],
      Thursday: [
        { company: 'Bajaj Finance', ticker: 'BAJAJFINSV.NS', time: 'AMC', estimatedEPS: '₹92.34' },
        { company: 'Maruti Suzuki', ticker: 'MARUTI.NS', time: 'BMO', estimatedEPS: '₹15.45' },
        { company: 'Asian Paints', ticker: 'ASIANPAINT.NS', time: 'BMO', estimatedEPS: '₹8.23' },
        { company: 'HUL', ticker: 'HINDUNILVR.NS', time: 'AMC', estimatedEPS: '₹9.87' },
      ],
      Friday: [
        { company: 'ITC', ticker: 'ITC.NS', time: 'BMO', estimatedEPS: '₹5.67' },
        { company: 'Nestlé', ticker: 'NESTLEIND.NS', time: 'AMC', estimatedEPS: '₹45.23' },
        { company: 'Sunpharma', ticker: 'SUNPHARMA.NS', time: 'BMO', estimatedEPS: '₹3.12' },
      ],
    },
    us: {
      Monday: [
        { company: 'Apple', ticker: 'AAPL', time: 'AMC', estimatedEPS: '$1.68' },
        { company: 'Microsoft', ticker: 'MSFT', time: 'AMC', estimatedEPS: '$2.93' },
        { company: 'Google', ticker: 'GOOGL', time: 'AMC', estimatedEPS: '$1.64' },
      ],
      Tuesday: [
        { company: 'Amazon', ticker: 'AMZN', time: 'AMC', estimatedEPS: '$0.94' },
        { company: 'Tesla', ticker: 'TSLA', time: 'AMC', estimatedEPS: '$0.75' },
        { company: 'Meta', ticker: 'META', time: 'AMC', estimatedEPS: '$5.42' },
        { company: 'Nvidia', ticker: 'NVDA', time: 'AMC', estimatedEPS: '$5.32' },
      ],
      Wednesday: [
        { company: 'JPMorgan', ticker: 'JPM', time: 'BMO', estimatedEPS: '$4.02' },
        { company: 'Goldman Sachs', ticker: 'GS', time: 'BMO', estimatedEPS: '$8.13' },
        { company: 'Berkshire', ticker: 'BRK.B', time: 'AMC', estimatedEPS: '$6.78' },
      ],
      Thursday: [
        { company: 'Coca-Cola', ticker: 'KO', time: 'BMO', estimatedEPS: '$0.65' },
        { company: 'Chevron', ticker: 'CVX', time: 'BMO', estimatedEPS: '$7.23' },
        { company: 'Walmart', ticker: 'WMT', time: 'BMO', estimatedEPS: '$1.89' },
        { company: 'McDonald', ticker: 'MCD', time: 'AMC', estimatedEPS: '$2.34' },
      ],
      Friday: [
        { company: 'Intel', ticker: 'INTC', time: 'BMO', estimatedEPS: '$0.18' },
        { company: 'Pfizer', ticker: 'PFE', time: 'AMC', estimatedEPS: '$0.76' },
        { company: 'Johnson & Johnson', ticker: 'JNJ', time: 'BMO', estimatedEPS: '$2.54' },
      ],
    },
  };

  const weekHighlights = {
    india: [
      'HDFC Bank Q3 Results: Expecting strong loan growth and improved NIM',
      'TCS Q3 FY25: IT sector outlook to guide market expectations',
      'Reliance Industries: Focus on refining margins and energy transition',
      'Banking sector: Multiple banks announcing results this week',
    ],
    us: [
      'Tech Earnings Season: Major companies reporting AI investments',
      'Apple Q1 FY2024: iPhone sales momentum and services growth',
      'Amazon AWS: Cloud revenue growth expectations remain high',
      'Magnificent Seven: Combined performance to impact market sentiment',
    ],
  };

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

  const getEarningsForDay = (dayName: string) => {
    return earningsDataByDay[market][dayName as keyof typeof earningsDataByDay['india']] || [];
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
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>Earnings Calendar</h1>

      {/* Market Toggle */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem', background: theme.cards, padding: '0.5rem', borderRadius: '0.5rem', border: `1px solid ${theme.border}` }}>
          {['india', 'us'].map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m as 'india' | 'us')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                border: 'none',
                background: market === m ? theme.accent : 'transparent',
                color: market === m ? '#fff' : theme.textSecondary,
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 600,
                transition: 'all 0.2s',
              }}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Week Navigator */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', background: theme.cards, padding: '1.5rem', borderRadius: '0.75rem', border: `1px solid ${theme.border}` }}>
        <button
          onClick={() => setWeekOffset(weekOffset - 1)}
          style={{
            padding: '0.5rem 1rem',
            background: theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.875rem',
          }}
        >
          ← Previous Week
        </button>

        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '0.875rem', color: theme.textSecondary, marginBottom: '0.5rem' }}>Week of</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700 }}>
            {weekDays[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDays[4].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>

        <button
          onClick={() => setWeekOffset(weekOffset + 1)}
          style={{
            padding: '0.5rem 1rem',
            background: theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.875rem',
          }}
        >
          Next Week →
        </button>
      </div>

      {/* Calendar Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {weekDays.map(({ day, date }) => {
          const isToday = isCurrentWeek && day === currentDayName;
          const earnings = getEarningsForDay(day);

          return (
            <div
              key={day}
              style={{
                background: theme.cards,
                borderRadius: '0.75rem',
                border: isToday ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                padding: '1.5rem',
                minHeight: '400px',
                position: 'relative',
              }}
            >
              {/* Day Header */}
              <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: `1px solid ${theme.border}` }}>
                <p style={{ fontSize: '0.875rem', color: theme.textSecondary, marginBottom: '0.25rem' }}>{day}</p>
                <p style={{ fontSize: '1.25rem', fontWeight: 700 }}>{date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</p>
                {isToday && <span style={{ display: 'inline-block', background: theme.accent, color: '#fff', padding: '0.25rem 0.625rem', borderRadius: '0.25rem', fontSize: '0.7rem', fontWeight: 600, marginTop: '0.5rem' }}>TODAY</span>}
              </div>

              {/* Earnings List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {earnings.length > 0 ? (
                  earnings.map((earning, idx) => (
                    <div key={idx} style={{ padding: '0.75rem', background: theme.background, borderRadius: '0.5rem', border: `1px solid ${theme.border}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>{earning.company}</p>
                          <p style={{ fontSize: '0.75rem', color: theme.textSecondary }}>{earning.ticker}</p>
                        </div>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            background: earning.time === 'BMO' ? theme.green : theme.accent,
                            color: '#fff',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '0.25rem',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {earning.time}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: theme.green, fontWeight: 600 }}>EPS: {earning.estimatedEPS}</p>
                    </div>
                  ))
                ) : (
                  <p style={{ color: theme.textSecondary, fontSize: '0.875rem', textAlign: 'center', paddingTop: '2rem' }}>No earnings scheduled</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Week Highlights */}
      <div style={{ background: theme.cards, borderRadius: '0.75rem', border: `1px solid ${theme.border}`, padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', color: theme.accent }}>This Week's Highlights</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          {weekHighlights[market].map((highlight, idx) => (
            <div
              key={idx}
              style={{
                padding: '1rem',
                background: theme.background,
                borderRadius: '0.5rem',
                border: `1px solid ${theme.border}`,
                borderLeft: `3px solid ${theme.accent}`,
              }}
            >
              <p style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>{highlight}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default EarningsCalendarPage;
