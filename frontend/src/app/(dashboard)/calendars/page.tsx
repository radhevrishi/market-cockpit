'use client';

import { useEffect, useState } from 'react';

interface EarningsResult {
  ticker: string;
  company: string;
  eventType: 'BOARD_MEETING' | 'RESULTS_DECLARED';
  eventDate: string;
  announcedDate: string | null;
  quarter: string;
  quality: string;
  revenue: number | null;
  operatingProfit: number | null;
  opm: string | null;
  netProfit: number | null;
  eps: number | null;
  sector: string;
  marketCap: string;
  indexMembership: string[];
  currentPrice: number | null;
  priceChange: number | null;
  volume: number | null;
  source: string;
}

interface EarningsResponse {
  results: EarningsResult[];
  summary: { total: number; excellent: number; great: number; good: number; ok: number; weak: number; upcoming: number };
  quarter: string;
  dateRange: { from: string; to: string };
  sources: { boardMeetings: number; financialResults: number; announcements: number; bseMeetings: number };
  stockUniverse: { nifty50: number; nifty500: number; midcap250: number; smallcap250: number; totalWithPrices: number };
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
  orange: '#F59E0B',
  purple: '#8B5CF6',
};

const qualityColors: Record<string, string> = {
  Excellent: '#22C55E',
  Great: '#10B981',
  Good: THEME.green,
  Ok: THEME.orange,
  Weak: THEME.red,
  Upcoming: '#6366F1',
};

export default function CalendarPage() {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);
  const [qualityFilter, setQualityFilter] = useState<string>('All');
  const [indexFilter, setIndexFilter] = useState<string>('All');

  const now = new Date();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}`;
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const fetchData = async () => {
    try {
      setLoading(true);
      const indexParam = indexFilter !== 'All' ? `&index=${indexFilter}` : '';
      const res = await fetch(`/api/market/earnings?market=india&month=${monthStr}&includeMovement=true${indexParam}`);
      if (!res.ok) throw new Error('Failed to fetch earnings data');
      const json: EarningsResponse = await res.json();
      setData(json);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [monthOffset, indexFilter]);

  // Build calendar grid
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const lastDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // Group results by date
  const resultsByDate: Record<string, EarningsResult[]> = {};
  if (data) {
    for (const r of data.results) {
      if (qualityFilter !== 'All' && r.quality !== qualityFilter) continue;
      const d = r.eventDate?.split('T')[0] || '';
      if (!resultsByDate[d]) resultsByDate[d] = [];
      resultsByDate[d].push(r);
    }
  }

  const filteredResults = data?.results.filter(r => qualityFilter === 'All' || r.quality === qualityFilter) || [];

  // Calendar cells
  const cells: { date: number | null; dateStr: string }[] = [];
  for (let i = 0; i < startDayOfWeek; i++) cells.push({ date: null, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    cells.push({ date: d, dateStr });
  }

  const todayStr = now.toISOString().split('T')[0];

  return (
    <div style={{ backgroundColor: THEME.background, minHeight: '100vh', padding: '24px', color: THEME.textPrimary, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0' }}>
          Earnings Calendar
        </h1>
        <p style={{ color: THEME.textSecondary, margin: 0, fontSize: '13px' }}>
          Indian quarterly results from NSE/BSE board meeting disclosures
          {data && data.stockUniverse ? ` • Universe: ${data.stockUniverse.totalWithPrices} stocks` : ''}
        </p>
      </div>

      {/* Summary Cards */}
      {data && !loading && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {[
            { label: 'Total', value: data.summary.total, color: THEME.textPrimary },
            { label: 'Excellent', value: data.summary.excellent || 0, color: '#22C55E' },
            { label: 'Great', value: data.summary.great || 0, color: '#10B981' },
            { label: 'Good', value: data.summary.good, color: THEME.green },
            { label: 'Ok', value: data.summary.ok || 0, color: THEME.orange },
            { label: 'Weak', value: data.summary.weak, color: THEME.red },
            { label: 'Upcoming', value: data.summary.upcoming, color: '#6366F1' },
            { label: 'Quarter', value: data.quarter, color: THEME.purple, isText: true },
          ].map(item => (
            <div key={item.label} style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px 20px', minWidth: '90px' }}>
              <div style={{ fontSize: '10px', color: item.color, marginBottom: '2px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{item.label}</div>
              <div style={{ fontSize: item.isText ? '16px' : '22px', fontWeight: '700', color: item.color }}>{item.value}</div>
            </div>
          ))}

          {/* Data sources info */}
          {data.sources && (
            <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px 20px', marginLeft: 'auto' }}>
              <div style={{ fontSize: '10px', color: THEME.textSecondary, marginBottom: '2px', fontWeight: '600', textTransform: 'uppercase' }}>Sources</div>
              <div style={{ fontSize: '11px', color: THEME.textSecondary, lineHeight: '1.4' }}>
                NSE: {(data.sources.boardMeetings || 0) + (data.sources.financialResults || 0)} • BSE: {((data.sources as any).bseBoardMeetings || 0) + ((data.sources as any).bseResults || 0)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        {/* Month Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setMonthOffset(monthOffset - 1)} style={{ padding: '8px 14px', backgroundColor: THEME.card, color: THEME.textPrimary, border: `1px solid ${THEME.border}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>←</button>
          <span style={{ fontSize: '18px', fontWeight: '700', minWidth: '170px', textAlign: 'center' }}>{monthLabel}</span>
          <button onClick={() => setMonthOffset(monthOffset + 1)} style={{ padding: '8px 14px', backgroundColor: THEME.card, color: THEME.textPrimary, border: `1px solid ${THEME.border}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>→</button>
          <button onClick={() => setMonthOffset(0)} style={{ padding: '8px 14px', backgroundColor: THEME.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '12px', marginLeft: '4px' }}>Today</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* Index Filter */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {[
              { label: 'All', value: 'All' },
              { label: 'NIFTY 50', value: 'NIFTY50' },
              { label: 'NIFTY 500', value: 'NIFTY500' },
              { label: 'Midcap', value: 'MIDCAP250' },
              { label: 'Smallcap', value: 'SMALLCAP250' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setIndexFilter(opt.value)} style={{
                padding: '6px 10px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: indexFilter === opt.value ? THEME.accent : 'transparent',
                color: indexFilter === opt.value ? '#fff' : THEME.textSecondary,
                transition: 'all 0.2s',
              }}>{opt.label}</button>
            ))}
          </div>

          {/* Quality Filter */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {['All', 'Excellent', 'Great', 'Good', 'Ok', 'Weak', 'Upcoming'].map(q => (
              <button key={q} onClick={() => setQualityFilter(q)} style={{
                padding: '6px 12px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: qualityFilter === q ? (qualityColors[q] || THEME.accent) : 'transparent',
                color: qualityFilter === q ? '#fff' : THEME.textSecondary,
                transition: 'all 0.2s',
              }}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <div style={{ width: '40px', height: '40px', border: `3px solid ${THEME.border}`, borderTop: `3px solid ${THEME.accent}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && !loading && (
        <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.red}`, borderRadius: '8px', padding: '16px', color: THEME.red, marginBottom: '24px' }}>
          Error: {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Monthly Calendar Grid */}
          <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '16px', marginBottom: '24px' }}>
            {/* Day Headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '6px' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '700', color: THEME.textSecondary, padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{d}</div>
              ))}
            </div>

            {/* Calendar Cells */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
              {cells.map((cell, idx) => {
                if (cell.date === null) return <div key={idx} />;

                const dayResults = resultsByDate[cell.dateStr] || [];
                const isToday = cell.dateStr === todayStr;
                const hasResults = dayResults.length > 0;
                const positiveCount = dayResults.filter(r => ['Excellent', 'Great', 'Good'].includes(r.quality)).length;
                const negativeCount = dayResults.filter(r => ['Ok', 'Weak'].includes(r.quality)).length;
                const upcomingCount = dayResults.filter(r => r.quality === 'Upcoming').length;

                return (
                  <div key={idx} style={{
                    backgroundColor: isToday ? '#0F7ABF10' : THEME.background,
                    border: isToday ? `2px solid ${THEME.accent}` : `1px solid ${THEME.border}`,
                    borderRadius: '6px',
                    padding: '6px',
                    minHeight: '80px',
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: isToday ? THEME.accent : THEME.textSecondary }}>
                        {cell.date}
                      </span>
                      {hasResults && (
                        <div style={{ display: 'flex', gap: '2px' }}>
                          {positiveCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `${THEME.green}30`, color: THEME.green, padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{positiveCount}</span>}
                          {negativeCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `${THEME.red}30`, color: THEME.red, padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{negativeCount}</span>}
                          {upcomingCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `#6366F130`, color: '#6366F1', padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{upcomingCount}</span>}
                        </div>
                      )}
                    </div>
                    {hasResults ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {dayResults.slice(0, 4).map((r, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <span style={{
                              width: '5px', height: '5px', borderRadius: '50%',
                              backgroundColor: qualityColors[r.quality] || THEME.textSecondary,
                              flexShrink: 0,
                            }} />
                            <span style={{ fontSize: '10px', fontWeight: '600', color: THEME.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.ticker}
                            </span>
                            {r.priceChange !== null && (
                              <span style={{ fontSize: '9px', color: r.priceChange >= 0 ? THEME.green : THEME.red, marginLeft: 'auto', flexShrink: 0 }}>
                                {r.priceChange >= 0 ? '+' : ''}{r.priceChange}%
                              </span>
                            )}
                          </div>
                        ))}
                        {dayResults.length > 4 && (
                          <span style={{ fontSize: '9px', color: THEME.textSecondary }}>+{dayResults.length - 4} more</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results Table */}
          {filteredResults.length > 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: '700', margin: 0 }}>
                  Earnings Events ({filteredResults.length})
                </h2>
                <span style={{ fontSize: '11px', color: THEME.textSecondary }}>
                  Sorted by date (newest first)
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${THEME.border}` }}>
                      {['Date', 'Type', 'Symbol', 'Company', 'Quality', 'Quarter', 'Sector', 'Revenue', 'Net Profit', 'EPS', 'OPM%', 'Price', 'Move%', 'Index'].map(h => (
                        <th key={h} style={{ padding: '8px 6px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.border}22`, transition: 'background 0.1s' }}>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap', color: THEME.textSecondary, fontSize: '11px' }}>{r.eventDate}</td>
                        <td style={{ padding: '8px 6px' }}>
                          <span style={{
                            padding: '2px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: '700',
                            backgroundColor: r.eventType === 'RESULTS_DECLARED' ? `${THEME.green}15` : `${THEME.orange}15`,
                            color: r.eventType === 'RESULTS_DECLARED' ? THEME.green : THEME.orange,
                          }}>
                            {r.eventType === 'RESULTS_DECLARED' ? 'Result' : 'Meeting'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 6px', fontWeight: '700', fontSize: '12px' }}>{r.ticker}</td>
                        <td style={{ padding: '8px 6px', color: THEME.textSecondary, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                        <td style={{ padding: '8px 6px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '700',
                            backgroundColor: `${qualityColors[r.quality]}18`,
                            color: qualityColors[r.quality],
                          }}>{r.quality}</span>
                        </td>
                        <td style={{ padding: '8px 6px', color: THEME.purple, fontWeight: '600', fontSize: '11px' }}>{r.quarter}</td>
                        <td style={{ padding: '8px 6px', color: THEME.textSecondary, fontSize: '11px' }}>{r.sector}</td>
                        <td style={{ padding: '8px 6px', fontSize: '11px' }}>{r.revenue ? `₹${r.revenue.toLocaleString('en-IN')}` : '—'}</td>
                        <td style={{ padding: '8px 6px', color: r.netProfit && r.netProfit > 0 ? THEME.green : r.netProfit && r.netProfit < 0 ? THEME.red : THEME.textSecondary, fontSize: '11px' }}>
                          {r.netProfit !== null ? `₹${r.netProfit.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '11px' }}>{r.eps !== null ? `₹${r.eps.toFixed(1)}` : '—'}</td>
                        <td style={{ padding: '8px 6px', fontSize: '11px' }}>{r.opm ? `${r.opm}%` : '—'}</td>
                        <td style={{ padding: '8px 6px', fontSize: '11px' }}>{r.currentPrice ? `₹${r.currentPrice.toLocaleString('en-IN')}` : '—'}</td>
                        <td style={{ padding: '8px 6px', fontWeight: '600', fontSize: '11px', color: r.priceChange && r.priceChange > 0 ? THEME.green : r.priceChange && r.priceChange < 0 ? THEME.red : THEME.textSecondary }}>
                          {r.priceChange !== null ? `${r.priceChange > 0 ? '+' : ''}${r.priceChange}%` : '—'}
                        </td>
                        <td style={{ padding: '8px 6px', fontSize: '9px', color: THEME.textSecondary }}>
                          {r.indexMembership?.join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filteredResults.length === 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '16px', color: THEME.textSecondary, marginBottom: '8px' }}>No earnings events found for {monthLabel}</div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary }}>
                Try a different month or check if NSE data is available for this period
              </div>
            </div>
          )}

          {/* Source Info */}
          {data && (
            <div style={{ marginTop: '16px', fontSize: '11px', color: THEME.textSecondary, display: 'flex', justifyContent: 'space-between' }}>
              <span>Source: {data.source} • Updated: {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'N/A'}</span>
              <span>
                {data.stockUniverse && `N50: ${data.stockUniverse.nifty50} • N500: ${data.stockUniverse.nifty500} • Mid: ${data.stockUniverse.midcap250} • Small: ${data.stockUniverse.smallcap250}`}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
