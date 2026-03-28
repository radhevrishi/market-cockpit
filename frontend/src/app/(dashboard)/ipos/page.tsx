'use client';

import { useState } from 'react';

const IPOTrackerPage = () => {
  const [expandedIPO, setExpandedIPO] = useState<string | null>(null);

  const ipoData = [
    {
      id: 'scinvest',
      company: 'SC Invest & Trade Ltd',
      exchange: 'MAINBOARD',
      status: 'open',
      priceBand: '₹120-130',
      lotSize: 100,
      gmp: '+15%',
      subscription: 2.5,
      openDate: '2024-01-22',
      closeDate: '2024-01-25',
      listingDate: '2024-02-01',
      sector: 'Finance',
      description: 'Leading investment and trading firm offering comprehensive financial services and advisory.',
    },
    {
      id: 'nextech',
      company: 'NexTech Solutions Ltd',
      exchange: 'MAINBOARD',
      status: 'open',
      priceBand: '₹85-95',
      lotSize: 150,
      gmp: '+22%',
      subscription: 3.2,
      openDate: '2024-01-20',
      closeDate: '2024-01-26',
      listingDate: '2024-02-02',
      sector: 'IT',
      description: 'Cloud computing and enterprise software solutions provider for businesses.',
    },
    {
      id: 'greenpower',
      company: 'GreenPower Energy Ltd',
      exchange: 'MAINBOARD',
      status: 'closed',
      priceBand: '₹95-105',
      lotSize: 120,
      gmp: '+18%',
      subscription: 2.8,
      openDate: '2024-01-15',
      closeDate: '2024-01-19',
      listingDate: '2024-01-31',
      sector: 'Energy',
      description: 'Renewable energy producer specializing in solar and wind power generation projects.',
    },
    {
      id: 'medcare',
      company: 'MedCare Pharma Ltd',
      exchange: 'MAINBOARD',
      status: 'closed',
      priceBand: '₹75-82',
      lotSize: 180,
      gmp: '+12%',
      subscription: 2.1,
      openDate: '2024-01-10',
      closeDate: '2024-01-13',
      listingDate: '2024-01-29',
      sector: 'Pharma',
      description: 'Pharmaceutical company focusing on generic medicines and biosimilar development.',
    },
    {
      id: 'smartlogistics',
      company: 'SmartLogistics Ltd',
      exchange: 'SME',
      status: 'upcoming',
      priceBand: '₹35-40',
      lotSize: 300,
      gmp: '-',
      subscription: 0,
      openDate: '2024-02-05',
      closeDate: '2024-02-08',
      listingDate: '2024-02-20',
      sector: 'Logistics',
      description: 'Supply chain and logistics solutions using AI-driven route optimization.',
    },
    {
      id: 'craftbrew',
      company: 'CraftBrew Beverages Ltd',
      exchange: 'MAINBOARD',
      status: 'listed',
      priceBand: '₹155-165',
      lotSize: 75,
      gmp: '+35%',
      subscription: 4.1,
      openDate: '2024-01-08',
      closeDate: '2024-01-12',
      listingDate: '2024-01-25',
      sector: 'FMCG',
      description: 'Premium craft beverage manufacturer with focus on organic and natural products.',
    },
    {
      id: 'edutech',
      company: 'EduTech Innovations Ltd',
      exchange: 'SME',
      status: 'upcoming',
      priceBand: '₹45-50',
      lotSize: 200,
      gmp: '-',
      subscription: 0,
      openDate: '2024-02-10',
      closeDate: '2024-02-13',
      listingDate: '2024-02-28',
      sector: 'EdTech',
      description: 'Online learning platform providing courses in technology and professional skills.',
    },
    {
      id: 'autoparts',
      company: 'AutoParts Tech Ltd',
      exchange: 'MAINBOARD',
      status: 'listed',
      priceBand: '₹115-125',
      lotSize: 100,
      gmp: '+28%',
      subscription: 3.5,
      openDate: '2024-01-05',
      closeDate: '2024-01-09',
      listingDate: '2024-01-22',
      sector: 'Auto',
      description: 'Automotive parts and components manufacturer for electric vehicle segment.',
    },
  ];

  const statusCounts = {
    open: ipoData.filter((x) => x.status === 'open').length,
    closed: ipoData.filter((x) => x.status === 'closed').length,
    upcoming: ipoData.filter((x) => x.status === 'upcoming').length,
    listed: ipoData.filter((x) => x.status === 'listed').length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return '#10B981';
      case 'closed':
        return '#8A95A3';
      case 'upcoming':
        return '#0F7ABF';
      case 'listed':
        return '#10B981';
      default:
        return '#8A95A3';
    }
  };

  const getExchangeColor = (exchange: string) => {
    return exchange === 'MAINBOARD' ? '#0F7ABF' : '#8A95A3';
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
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>IPO Tracker 🚀</h1>
      <p style={{ color: theme.textSecondary, marginBottom: '2rem' }}>Track upcoming, open, closed, and listed IPOs with real-time data</p>

      {/* Status Sections */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Open', count: statusCounts.open, color: theme.green },
          { label: 'Closed', count: statusCounts.closed, color: theme.textSecondary },
          { label: 'Upcoming', count: statusCounts.upcoming, color: theme.accent },
          { label: 'Listed', count: statusCounts.listed, color: theme.green },
        ].map((item) => (
          <div key={item.label} style={{ background: theme.cards, padding: '1.5rem', borderRadius: '0.75rem', border: `1px solid ${theme.border}`, textAlign: 'center' }}>
            <p style={{ color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '0.5rem' }}>{item.label}</p>
            <p style={{ color: item.color, fontSize: '2rem', fontWeight: 700 }}>{item.count}</p>
          </div>
        ))}
      </div>

      {/* IPO Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '1.5rem' }}>
        {ipoData.map((ipo) => (
          <div
            key={ipo.id}
            style={{
              background: theme.cards,
              borderRadius: '0.75rem',
              border: `1px solid ${theme.border}`,
              padding: '1.5rem',
              transition: 'all 0.3s',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = theme.accent;
              e.currentTarget.style.boxShadow = `0 0 20px rgba(15, 122, 191, 0.1)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = theme.border;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>{ipo.company}</h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.25rem 0.75rem',
                      background: getExchangeColor(ipo.exchange),
                      color: '#fff',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}
                  >
                    {ipo.exchange}
                  </span>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.25rem 0.75rem',
                      background: getStatusColor(ipo.status),
                      color: '#fff',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}
                  >
                    {ipo.status.charAt(0).toUpperCase() + ipo.status.slice(1)}
                  </span>
                </div>
              </div>
              <span style={{ fontSize: '0.75rem', background: theme.background, padding: '0.5rem', borderRadius: '0.375rem', color: theme.accent, fontWeight: 600 }}>{ipo.sector}</span>
            </div>

            {/* Details Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: `1px solid ${theme.border}` }}>
              <div>
                <p style={{ color: theme.textSecondary, fontSize: '0.75rem', marginBottom: '0.25rem' }}>Price Band</p>
                <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>{ipo.priceBand}</p>
              </div>
              <div>
                <p style={{ color: theme.textSecondary, fontSize: '0.75rem', marginBottom: '0.25rem' }}>Lot Size</p>
                <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>{ipo.lotSize} shares</p>
              </div>
              <div>
                <p style={{ color: theme.textSecondary, fontSize: '0.75rem', marginBottom: '0.25rem' }}>GMP</p>
                <p style={{ fontSize: '0.95rem', fontWeight: 600, color: ipo.gmp === '-' ? theme.textSecondary : theme.green }}>{ipo.gmp}</p>
              </div>
              <div>
                <p style={{ color: theme.textSecondary, fontSize: '0.75rem', marginBottom: '0.25rem' }}>Subscription</p>
                <p style={{ fontSize: '0.95rem', fontWeight: 600, color: ipo.subscription > 2 ? theme.green : theme.textSecondary }}>
                  {ipo.subscription > 0 ? `${ipo.subscription}x` : 'N/A'}
                </p>
              </div>
            </div>

            {/* Dates */}
            <div style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: theme.textSecondary }}>Opens:</span>
                <span>{ipo.openDate}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: theme.textSecondary }}>Closes:</span>
                <span>{ipo.closeDate}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: theme.textSecondary }}>Lists:</span>
                <span>{ipo.listingDate}</span>
              </div>
            </div>

            {/* Description */}
            <p style={{ color: theme.textSecondary, fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.5 }}>{ipo.description}</p>

            {/* Show More Link */}
            <button
              onClick={() => setExpandedIPO(expandedIPO === ipo.id ? null : ipo.id)}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'transparent',
                color: theme.accent,
                border: `1px solid ${theme.accent}`,
                borderRadius: '0.375rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 600,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme.accent;
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = theme.accent;
              }}
            >
              {expandedIPO === ipo.id ? 'Show Less' : 'Show More'}
            </button>

            {/* Expanded Content */}
            {expandedIPO === ipo.id && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.border}`, fontSize: '0.85rem', color: theme.textSecondary }}>
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ color: theme.textPrimary }}>About:</strong> {ipo.description}
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ color: theme.textPrimary }}>Market Cap (Est):</strong> Based on price band and shares offered
                </div>
                <div>
                  <strong style={{ color: theme.textPrimary }}>Key Highlights:</strong> Strong sector fundamentals, experienced management team
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default IPOTrackerPage;
