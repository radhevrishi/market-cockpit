'use client';

import { useEffect, useState } from 'react';

interface EarningsResult {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Good' | 'Weak' | 'Upcoming';
  revenue: number | null;
  operatingProfit: number | null;
  opm: string | null;
  netProfit: number | null;
  eps: number | null;
  sector: string;
  marketCap: string;
  currentPrice: number | null;
  priceAtResult: number | null;
  priceChange: number | null;
}

interface EarningsResponse {
  results: EarningsResult[];
  summary: { total: number; good: number; weak: number; upcoming: number };
  quarter: string;
  dateRange: { from: string; to: string };
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
  Good: THEME.green,
  Weak: THEME.red,
  Upcoming: THEME.orange,
};

export default function CalendarPage() {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);
  const [qualityFilter, setQualityFilter] = useState<string>('All');

  const now = new Date();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}`;
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/market/earnings?market=india&month=${monthStr}&includeMovement=true`);
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

  useEffect(() => { fetchData(); }, [monthOffset]);

  // Build calendar grid
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const lastDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
  const startDayOfWeek = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();

  // Group results by date
  const resultsByDate: Record<string, EarningsResult[]> = {};
  if (data) {
    for (const r of data.results) {
      if (qualityFilter !== 'All' && r.quality !== qualityFilter) continue;
      const d = r.resultDate?.split('T')[0] || '';
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
        <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          Earnings Calendar
        </h1>
        <p style={{ color: THEME.textSecondary, margin: 0, fontSize: '14px' }}>
          Indian quarterly results with live NSE data
          {data ? ` • ${data.dateRange.from} — ${data.dateRange.to} (${data.summary.total} results)` : ''}
        </p>
      </div>

      {/* Summary Bar */}
      {data && !loading && (
        <div style={{
          display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap',
        }}>
          <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '16px 24px', minWidth: '100px' }}>
            <div style={{ fontSize: '12px', color: THEME.textSecondary, marginBottom: '4px' }}>Results</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{data.summary.total}</div>
          </div>
          <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '16px 24px', minWidth: '100px' }}>
            <div style={{ fontSize: '12px', color: THEME.green, marginBottom: '4px' }}>Good</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: THEME.green }}>{data.summary.good}</div>
          </div>
          <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '16px 24px', minWidth: '100px' }}>
            <div style={{ fontSize: '12px', color: THEME.red, marginBottom: '4px' }}>Weak</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: THEME.red }}>{data.summary.weak}</div>
          </div>
          <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '16px 24px', minWidth: '100px' }}>
            <div style={{ fontSize: '12px', color: THEME.orange, marginBottom: '4px' }}>Upcoming</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: THEME.orange }}>{data.summary.upcoming}</div>
          </div>
          <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '16px 24px', minWidth: '100px' }}>
            <div style={{ fontSize: '12px', color: THEME.purple, marginBottom: '4px' }}>Quarter</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: THEME.purple }}>{data.quarter}</div>
          </div>
        </div>
      )}

      {/* Controls: Month Nav + Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => setMonthOffset(monthOffset - 1)} style={{ padding: '8px 16px', backgroundColor: THEME.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>←</button>
          <span style={{ fontSize: '20px', fontWeight: 'bold', minWidth: '180px', textAlign: 'center' }}>{monthLabel}</span>
          <button onClick={() => setMonthOffset(monthOffset + 1)} style={{ padding: '8px 16px', backgroundColor: THEME.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>→</button>
        </div>

        {/* Quality Filter */}
        <div style={{ display: 'flex', gap: '8px', backgroundColor: THEME.card, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
          {['All', 'Good', 'Weak', 'Upcoming'].map(q => (
            <button key={q} onClick={() => setQualityFilter(q)} style={{
              padding: '6px 14px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '500',
              backgroundColor: qualityFilter === q ? (qualityColors[q] || THEME.accent) : 'transparent',
              color: qualityFilter === q ? '#fff' : THEME.textSecondary,
              transition: 'all 0.2s',
            }}>{q}</button>
          ))}
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
          <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '20px', marginBottom: '24px' }}>
            {/* Day Headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '8px' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, padding: '8px 0', textTransform: 'uppercase' }}>{d}</div>
              ))}
            </div>

            {/* Calendar Cells */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
              {cells.map((cell, idx) => {
                if (cell.date === null) return <div key={idx} />;

                const dayResults = resultsByDate[cell.dateStr] || [];
                const isToday = cell.dateStr === todayStr;
                const hasResults = dayResults.length > 0;

                return (
                  <div key={idx} style={{
                    backgroundColor: isToday ? '#0F7ABF15' : THEME.background,
                    border: isToday ? `2px solid ${THEME.accent}` : `1px solid ${THEME.border}`,
                    borderRadius: '8px',
                    padding: '8px',
                    minHeight: '90px',
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: isToday ? THEME.accent : THEME.textSecondary }}>
                        {cell.date}
                      </span>
                      {hasResults && (
                        <span style={{ fontSize: '10px', backgroundColor: THEME.accent, color: '#fff', padding: '1px 5px', borderRadius: '8px', fontWeight: '600' }}>
                          {dayResults.length}
                        </span>
                      )}
                    </div>
                    {hasResults ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {dayResults.slice(0, 4).map((r, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{
                              width: '6px', height: '6px', borderRadius: '50%',
                              backgroundColor: qualityColors[r.quality] || THEME.textSecondary,
                              flexShrink: 0,
                            }} />
                            <span style={{ fontSize: '11px', fontWeight: '600', color: THEME.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.ticker}
                            </span>
                          </div>
                        ))}
                        {dayResults.length > 4 && (
                          <span style={{ fontSize: '10px', color: THEME.textSecondary }}>+{dayResults.length - 4} more</span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: '10px', color: THEME.textSecondary }}>No Earnings</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results List Table */}
          {filteredResults.length > 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
                Earnings Results ({filteredResults.length})
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${THEME.border}` }}>
                      {['Date', 'Symbol', 'Company', 'Quality', 'Quarter', 'Revenue (Cr)', 'Net Profit (Cr)', 'EPS', 'OPM %', 'Price', 'Move %'].map(h => (
                        <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.border}22` }}>
                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap', color: THEME.textSecondary }}>{r.resultDate}</td>
                        <td style={{ padding: '10px 8px', fontWeight: '700' }}>{r.ticker}</td>
                        <td style={{ padding: '10px 8px', color: THEME.textSecondary, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
                            backgroundColor: `${qualityColors[r.quality]}20`,
                            color: qualityColors[r.quality],
                          }}>{r.quality}</span>
                        </td>
                        <td style={{ padding: '10px 8px', color: THEME.textSecondary }}>{r.quarter}</td>
                        <td style={{ padding: '10px 8px' }}>{r.revenue ? `₹${r.revenue.toLocaleString()}` : '—'}</td>
                        <td style={{ padding: '10px 8px', color: r.netProfit && r.netProfit > 0 ? THEME.green : r.netProfit && r.netProfit < 0 ? THEME.red : THEME.textSecondary }}>
                          {r.netProfit !== null ? `₹${r.netProfit.toLocaleString()}` : '—'}
                        </td>
                        <td style={{ padding: '10px 8px' }}>{r.eps !== null ? `₹${r.eps}` : '—'}</td>
                        <td style={{ padding: '10px 8px' }}>{r.opm ? `${r.opm}%` : '—'}</td>
                        <td style={{ padding: '10px 8px' }}>{r.currentPrice ? `₹${r.currentPrice.toLocaleString()}` : '—'}</td>
                        <td style={{ padding: '10px 8px', fontWeight: '600', color: r.priceChange && r.priceChange > 0 ? THEME.green : r.priceChange && r.priceChange < 0 ? THEME.red : THEME.textSecondary }}>
                          {r.priceChange !== null ? `${r.priceChange > 0 ? '+' : ''}${r.priceChange}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Source */}
          {data?.source && (
            <div style={{ marginTop: '16px', fontSize: '11px', color: THEME.textSecondary }}>
              Source: {data.source} • Updated: {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'N/A'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
