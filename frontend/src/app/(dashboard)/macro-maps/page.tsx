'use client';

import { useState } from 'react';

const MacroMapsPage = () => {
  const [timeframe, setTimeframe] = useState('1D');
  const [assetClass, setAssetClass] = useState('indices');

  const indicesData = [
    // Americas
    { region: 'Americas', name: 'S&P 500', flag: '🇺🇸', value: 4783.45, change: 1.23 },
    { region: 'Americas', name: 'NASDAQ', flag: '🇺🇸', value: 15312.50, change: 2.15 },
    { region: 'Americas', name: 'Dow Jones', flag: '🇺🇸', value: 37490.27, change: 0.85 },
    { region: 'Americas', name: 'TSX', flag: '🇨🇦', value: 22145.63, change: -0.42 },
    { region: 'Americas', name: 'Bovespa', flag: '🇧🇷', value: 131256.87, change: 1.87 },
    { region: 'Americas', name: 'IPC', flag: '🇲🇽', value: 56892.34, change: 0.56 },
    { region: 'Americas', name: 'MERVAL', flag: '🇦🇷', value: 2156789.45, change: 3.42 },

    // Europe
    { region: 'Europe', name: 'FTSE 100', flag: '🇬🇧', value: 7856.42, change: 0.34 },
    { region: 'Europe', name: 'DAX', flag: '🇩🇪', value: 18234.56, change: 1.56 },
    { region: 'Europe', name: 'CAC 40', flag: '🇫🇷', value: 7612.89, change: 0.92 },
    { region: 'Europe', name: 'EURO STOXX', flag: '🇪🇺', value: 4523.17, change: 1.04 },
    { region: 'Europe', name: 'IBEX 35', flag: '🇪🇸', value: 11234.45, change: 0.67 },
    { region: 'Europe', name: 'SMI', flag: '🇨🇭', value: 11892.34, change: -0.23 },

    // Asia-Pacific
    { region: 'Asia-Pacific', name: 'Nikkei 225', flag: '🇯🇵', value: 33512.45, change: 2.34 },
    { region: 'Asia-Pacific', name: 'Hang Seng', flag: '🇭🇰', value: 17234.56, change: 1.12 },
    { region: 'Asia-Pacific', name: 'Nifty 50', flag: '🇮🇳', value: 21456.78, change: 0.89 },
    { region: 'Asia-Pacific', name: 'SENSEX', flag: '🇮🇳', value: 72145.34, change: 0.92 },
    { region: 'Asia-Pacific', name: 'ASX 200', flag: '🇦🇺', value: 7856.23, change: 0.45 },
    { region: 'Asia-Pacific', name: 'STI', flag: '🇸🇬', value: 3345.67, change: -0.12 },
    { region: 'Asia-Pacific', name: 'KOSPI', flag: '🇰🇷', value: 2712.45, change: 1.23 },
  ];

  const currenciesData = [
    { region: 'Global', name: 'EUR/USD', flag: '🇪🇺', value: 1.0856, change: 0.34 },
    { region: 'Global', name: 'GBP/USD', flag: '🇬🇧', value: 1.2734, change: 0.56 },
    { region: 'Global', name: 'USD/JPY', flag: '🇯🇵', value: 148.56, change: -0.42 },
    { region: 'Global', name: 'USD/INR', flag: '🇮🇳', value: 83.45, change: 0.12 },
    { region: 'Global', name: 'USD/CHF', flag: '🇨🇭', value: 0.8912, change: -0.18 },
    { region: 'Global', name: 'AUD/USD', flag: '🇦🇺', value: 0.6534, change: 0.23 },
    { region: 'Global', name: 'USD/CAD', flag: '🇨🇦', value: 1.3567, change: 0.34 },
  ];

  const commoditiesData = [
    { region: 'Global', name: 'Gold (USD/oz)', flag: '⭐', value: 2045.50, change: 1.23 },
    { region: 'Global', name: 'Silver (USD/oz)', flag: '⭐', value: 24.35, change: 2.15 },
    { region: 'Global', name: 'Crude Oil ($/bbl)', flag: '⭐', value: 82.45, change: -1.32 },
    { region: 'Global', name: 'Natural Gas ($/MMBtu)', flag: '⭐', value: 2.456, change: 0.45 },
    { region: 'Global', name: 'Copper (USD/lb)', flag: '⭐', value: 3.87, change: 1.45 },
    { region: 'Global', name: 'Wheat (USD/bu)', flag: '⭐', value: 5.32, change: -0.67 },
    { region: 'Global', name: 'Coffee (¢/lb)', flag: '⭐', value: 234.50, change: 3.21 },
  ];

  const bondsData = [
    { region: 'Global', name: 'US 10Y Yield', flag: '🇺🇸', value: 4.25, change: 0.12 },
    { region: 'Global', name: 'US 2Y Yield', flag: '🇺🇸', value: 5.12, change: 0.08 },
    { region: 'Global', name: 'Germany 10Y', flag: '🇩🇪', value: 2.45, change: 0.05 },
    { region: 'Global', name: 'UK 10Y', flag: '🇬🇧', value: 3.98, change: 0.14 },
    { region: 'Global', name: 'Japan 10Y', flag: '🇯🇵', value: 0.98, change: 0.02 },
    { region: 'Global', name: 'India 10Y', flag: '🇮🇳', value: 6.85, change: 0.18 },
    { region: 'Global', name: 'Australia 10Y', flag: '🇦🇺', value: 3.92, change: 0.09 },
  ];

  const getDataByAssetClass = () => {
    switch (assetClass) {
      case 'currencies':
        return currenciesData;
      case 'commodities':
        return commoditiesData;
      case 'bonds':
        return bondsData;
      default:
        return indicesData;
    }
  };

  const data = getDataByAssetClass();

  const getChangeColor = (change: number) => {
    return change >= 0 ? '#10B981' : '#EF4444';
  };

  const groupByRegion = (data: typeof indicesData) => {
    const grouped: { [key: string]: typeof indicesData } = {};
    data.forEach((item) => {
      if (!grouped[item.region]) {
        grouped[item.region] = [];
      }
      grouped[item.region].push(item);
    });
    return grouped;
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

  const regions = groupByRegion(data);

  return (
    <div style={{ background: theme.background, minHeight: '100vh', padding: '2rem', color: theme.textPrimary, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Macro Maps</h1>
      <p style={{ fontSize: '1rem', color: theme.textSecondary, marginBottom: '2rem' }}>Global Market Performance</p>

      {/* Timeframe Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD'].map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            style={{
              padding: '0.625rem 1.25rem',
              background: timeframe === tf ? theme.accent : theme.cards,
              color: timeframe === tf ? '#fff' : theme.textSecondary,
              border: `1px solid ${timeframe === tf ? theme.accent : theme.border}`,
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Asset Class Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {['indices', 'currencies', 'commodities', 'bonds'].map((asset) => (
          <button
            key={asset}
            onClick={() => setAssetClass(asset)}
            style={{
              padding: '0.625rem 1.25rem',
              background: assetClass === asset ? theme.accent : theme.cards,
              color: assetClass === asset ? '#fff' : theme.textSecondary,
              border: `1px solid ${assetClass === asset ? theme.accent : theme.border}`,
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            {asset.charAt(0).toUpperCase() + asset.slice(1)}
          </button>
        ))}
      </div>

      {/* Market Cards Grid by Region */}
      {Object.entries(regions).map(([region, items]) => (
        <div key={region}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '1rem', color: theme.accent }}>{region}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            {items.map((item, idx) => (
              <div
                key={idx}
                style={{
                  background: theme.cards,
                  borderRadius: '0.75rem',
                  border: `1px solid ${theme.border}`,
                  padding: '1.5rem',
                  transition: 'all 0.3s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = theme.accent;
                  e.currentTarget.style.boxShadow = `0 0 15px rgba(15, 122, 191, 0.1)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = theme.border;
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>{item.flag}</span>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, flex: 1 }}>{item.name}</h3>
                </div>

                {/* Value */}
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ color: theme.textSecondary, fontSize: '0.75rem', marginBottom: '0.25rem' }}>Current Value</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                    {typeof item.value === 'number' && item.value > 100 ? item.value.toFixed(0) : item.value.toFixed(2)}
                  </p>
                </div>

                {/* Change */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div
                    style={{
                      height: '2.5rem',
                      flex: 1,
                      background: getChangeColor(item.change) === theme.green ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      borderRadius: '0.375rem',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        height: '100%',
                        width: `${Math.min(Math.abs(item.change) * 15, 100)}%`,
                        background: getChangeColor(item.change),
                        opacity: 0.3,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '0.95rem', fontWeight: 600, color: getChangeColor(item.change), minWidth: '50px', textAlign: 'right' }}>
                    {item.change > 0 ? '+' : ''}{item.change.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default MacroMapsPage;
