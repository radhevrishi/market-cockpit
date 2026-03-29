'use client';

import { useEffect, useState } from 'react';

interface EarningsResult {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Good' | 'Weak' | 'Upcoming' | 'Preview';
  sector: string;
  industry: string;
  marketCap: string;
  edp: number | null;
  cmp: number | null;
  priceMove: number | null;
  timing: string;
  source: string;
}

interface EarningsResponse {
  results: EarningsResult[];
  summary: { total: number; good: number; weak: number; upcoming: number };
  quarter: string;
  dateRange: { from: string; to: string };
  stockUniverse: number;
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
  Upcoming: '#6366F1',
};

export default function CalendarPage() {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);
  const [qualityFilter, setQualityFilter] = useState<string>('All');
  const [indexFilter, setIndexFilter] = useState<string>('All');
  const [view, setView] = useState<'calendar' | 'list'>('calendar');

  const now = new Date();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}`;
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const fetchData = async () => {
    try {
      setLoading(true);
      const indexParam = indexFilter !== 'All' ? `&index=${indexFilter}` : '';
      const res = await fetch(`/api/market/earnings?market=india&month=${monthStr}${indexParam}`);
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
  const filteredResults = data?.results.filter(r => qualityFilter === 'All' || r.quality === qualityFilter) || [];

  for (const r of filteredResults) {
    const d = r.resultDate?.split('T')[0] || '';
    if (!resultsByDate[d]) resultsByDate[d] = [];
    resultsByDate[d].push(r);
  }

  // Calendar cells
  const cells: { date: number | null; dateStr: string }[] = [];
  for (let i = 0; i < startDayOfWeek; i++) cells.push({ date: null, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    cells.push({ date: d, dateStr });
  }

  const todayStr = now.toISOString().split('T')[0];

  // Format date like earningspulse: "5 Mar", "14 Mar"
  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
  };

  return (
    <div style={{ backgroundColor: THEME.background, minHeight: '100vh', padding: '24px', color: THEME.textPrimary, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0' }}>
          Earnings Calendar
        </h1>
        <p style={{ color: THEME.textSecondary, margin: 0, fontSize: '13px' }}>
          Indian quarterly results with AI quality ratings
          {data ? ` • 1 ${viewMonth.toLocaleDateString('en-US', { month: 'short' })} — ${daysInMonth} ${viewMonth.toLocaleDateString('en-US', { month: 'short' })} (${data.summary.total} results)` : ''}
        </p>
      </div>

      {/* Summary Bar — matching earningspulse layout */}
      {data && !loading && (
        <div style={{
          display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'center',
          backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '10px', padding: '14px 20px',
        }}>
          <div style={{ fontWeight: '700', fontSize: '18px' }}>
            {data.summary.total} <span style={{ fontSize: '12px', color: THEME.textSecondary, fontWeight: '500' }}>RESULTS</span>
          </div>
          <div style={{ width: '1px', height: '24px', backgroundColor: THEME.border }} />
          <div style={{ fontSize: '13px' }}>
            <span style={{ color: THEME.green, fontWeight: '600' }}>Good: {data.summary.good}</span>
          </div>
          <div style={{ fontSize: '13px' }}>
            <span style={{ color: THEME.red, fontWeight: '600' }}>Weak: {data.summary.weak}</span>
          </div>
          <div style={{ fontSize: '13px' }}>
            <span style={{ color: '#6366F1', fontWeight: '600' }}>Upcoming: {data.summary.upcoming}</span>
          </div>
          <div style={{ width: '1px', height: '24px', backgroundColor: THEME.border }} />
          <div style={{ fontSize: '13px', color: THEME.purple, fontWeight: '600' }}>{data.quarter}</div>

          {/* Quality bar */}
          <div style={{ flex: 1, height: '6px', backgroundColor: THEME.border, borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
            {data.summary.good > 0 && (
              <div style={{ width: `${(data.summary.good / data.summary.total) * 100}%`, backgroundColor: THEME.green, height: '100%' }} />
            )}
            {data.summary.weak > 0 && (
              <div style={{ width: `${(data.summary.weak / data.summary.total) * 100}%`, backgroundColor: THEME.red, height: '100%' }} />
            )}
          </div>
        </div>
      )}

      {/* Controls Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* View Toggle */}
          <div style={{ display: 'flex', gap: '2px', backgroundColor: THEME.card, padding: '3px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {[
              { label: 'Calendar', value: 'calendar' as const },
              { label: 'List', value: 'list' as const },
            ].map(opt => (
              <button key={opt.value} onClick={() => setView(opt.value)} style={{
                padding: '6px 14px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: view === opt.value ? THEME.accent : 'transparent',
                color: view === opt.value ? '#fff' : THEME.textSecondary,
              }}>{opt.label}</button>
            ))}
          </div>

          {/* Month Navigation */}
          <button onClick={() => setMonthOffset(monthOffset - 1)} style={{ padding: '8px 14px', backgroundColor: THEME.card, color: THEME.textPrimary, border: `1px solid ${THEME.border}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>←</button>
          <span style={{ fontSize: '16px', fontWeight: '700', minWidth: '150px', textAlign: 'center' }}>{monthLabel}</span>
          <button onClick={() => setMonthOffset(monthOffset + 1)} style={{ padding: '8px 14px', backgroundColor: THEME.card, color: THEME.textPrimary, border: `1px solid ${THEME.border}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>→</button>
          <button onClick={() => setMonthOffset(0)} style={{ padding: '8px 14px', backgroundColor: THEME.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>Today</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* Quality Filter */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {['All', 'Good', 'Weak', 'Upcoming'].map(q => (
              <button key={q} onClick={() => setQualityFilter(q)} style={{
                padding: '6px 12px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: qualityFilter === q ? (qualityColors[q] || THEME.accent) : 'transparent',
                color: qualityFilter === q ? '#fff' : THEME.textSecondary,
              }}>{q}</button>
            ))}
          </div>

          {/* Index Filter */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {[
              { label: 'All', value: 'All' },
              { label: 'NIFTY 50', value: 'NIFTY50' },
              { label: 'NIFTY 500', value: 'NIFTY500' },
              { label: 'Midcap', value: 'MIDCAP' },
              { label: 'Smallcap', value: 'SMALLCAP' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setIndexFilter(opt.value)} style={{
                padding: '6px 10px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: indexFilter === opt.value ? THEME.accent : 'transparent',
                color: indexFilter === opt.value ? '#fff' : THEME.textSecondary,
              }}>{opt.label}</button>
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
          {/* CALENDAR VIEW */}
          {view === 'calendar' && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '16px', marginBottom: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '6px' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '700', color: THEME.textSecondary, padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{d}</div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
                {cells.map((cell, idx) => {
                  if (cell.date === null) return <div key={idx} />;

                  const dayResults = resultsByDate[cell.dateStr] || [];
                  const isToday = cell.dateStr === todayStr;
                  const hasResults = dayResults.length > 0;
                  const goodCount = dayResults.filter(r => r.quality === 'Good').length;
                  const weakCount = dayResults.filter(r => r.quality === 'Weak').length;
                  const upCount = dayResults.filter(r => r.quality === 'Upcoming').length;

                  return (
                    <div key={idx} style={{
                      backgroundColor: isToday ? '#0F7ABF10' : THEME.background,
                      border: isToday ? `2px solid ${THEME.accent}` : `1px solid ${THEME.border}`,
                      borderRadius: '6px',
                      padding: '6px',
                      minHeight: '80px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: isToday ? THEME.accent : THEME.textSecondary }}>
                          {cell.date}
                        </span>
                        {hasResults && (
                          <div style={{ display: 'flex', gap: '2px' }}>
                            {goodCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `${THEME.green}30`, color: THEME.green, padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{goodCount}</span>}
                            {weakCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `${THEME.red}30`, color: THEME.red, padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{weakCount}</span>}
                            {upCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `#6366F130`, color: '#6366F1', padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{upCount}</span>}
                          </div>
                        )}
                      </div>
                      {hasResults && (
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
                            </div>
                          ))}
                          {dayResults.length > 4 && (
                            <span style={{ fontSize: '9px', color: THEME.textSecondary }}>+{dayResults.length - 4} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LIST VIEW — earningspulse-style table */}
          {view === 'list' && filteredResults.length > 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${THEME.border}` }}>
                      {['DATE', 'SYMBOL', 'SECTOR', 'QUALITY', 'QUARTER', 'CAP', 'EDP', 'CMP', 'MOVE', 'TIMING'].map(h => (
                        <th key={h} style={{ padding: '12px 10px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.border}30` }}>
                        <td style={{ padding: '12px 10px', whiteSpace: 'nowrap', color: THEME.textSecondary, fontSize: '12px' }}>
                          {formatShortDate(r.resultDate)}
                        </td>
                        <td style={{ padding: '12px 10px' }}>
                          <div style={{ fontWeight: '700', fontSize: '13px' }}>{r.ticker}</div>
                          <div style={{ fontSize: '11px', color: THEME.textSecondary, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</div>
                        </td>
                        <td style={{ padding: '12px 10px', color: THEME.textSecondary, fontSize: '12px' }}>{r.sector}</td>
                        <td style={{ padding: '12px 10px' }}>
                          <span style={{
                            padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
                            backgroundColor: `${qualityColors[r.quality]}20`,
                            color: qualityColors[r.quality],
                          }}>{r.quality}</span>
                        </td>
                        <td style={{ padding: '12px 10px', color: THEME.textSecondary, fontSize: '12px' }}>{r.quarter}</td>
                        <td style={{ padding: '12px 10px', color: THEME.textSecondary, fontSize: '12px' }}>{r.marketCap || '—'}</td>
                        <td style={{ padding: '12px 10px', fontSize: '12px' }}>
                          {r.edp !== null ? `₹${r.edp.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', fontSize: '12px' }}>
                          {r.cmp !== null ? `₹${r.cmp.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', fontWeight: '700', fontSize: '12px', color: r.priceMove !== null ? (r.priceMove >= 0 ? THEME.green : THEME.red) : THEME.textSecondary }}>
                          {r.priceMove !== null ? `${r.priceMove >= 0 ? '+' : ''}${r.priceMove.toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', fontSize: '14px', textAlign: 'center' }}>
                          {r.timing === 'pre' ? '🌙' : r.timing === 'post' ? '☀️' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CALENDAR VIEW: Results table below */}
          {view === 'calendar' && filteredResults.length > 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${THEME.border}` }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', margin: 0 }}>
                  Results ({filteredResults.length})
                </h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${THEME.border}` }}>
                      {['Date', 'Symbol', 'Company', 'Quality', 'Quarter', 'Sector', 'Cap', 'CMP'].map(h => (
                        <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.border}22` }}>
                        <td style={{ padding: '8px', whiteSpace: 'nowrap', color: THEME.textSecondary, fontSize: '11px' }}>{formatShortDate(r.resultDate)}</td>
                        <td style={{ padding: '8px', fontWeight: '700' }}>{r.ticker}</td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '700',
                            backgroundColor: `${qualityColors[r.quality]}18`,
                            color: qualityColors[r.quality],
                          }}>{r.quality}</span>
                        </td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, fontSize: '11px' }}>{r.quarter}</td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, fontSize: '11px' }}>{r.sector}</td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, fontSize: '11px' }}>{r.marketCap || '—'}</td>
                        <td style={{ padding: '8px', fontSize: '11px' }}>{r.cmp !== null ? `₹${r.cmp.toLocaleString('en-IN')}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filteredResults.length === 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '16px', color: THEME.textSecondary, marginBottom: '8px' }}>No earnings results found for {monthLabel}</div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary }}>
                Try a different month or adjust filters
              </div>
            </div>
          )}

          {/* Source Info */}
          {data && (
            <div style={{ marginTop: '16px', fontSize: '11px', color: THEME.textSecondary, display: 'flex', justifyContent: 'space-between' }}>
              <span>Source: {data.source} • Updated: {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'N/A'}</span>
              <span>Universe: {data.stockUniverse} stocks</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
