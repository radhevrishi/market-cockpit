'use client';

import { useState, useEffect, useCallback } from 'react';

// ══════════════════════════════════════════════
// EARNINGS CARDS PAGE — EarningsPulse-style UI
// Shows financial results with Revenue, OP, PAT, EPS
// with YoY/QoQ growth and color-coded grades
// ══════════════════════════════════════════════

// Theme constants (matches existing dark theme)
const BG = '#0A0E1A';
const CARD = '#0D1623';
const CARD_BORDER = '#1A2540';
const ACCENT = '#0F7ABF';
const TEXT = '#E8ECF1';
const TEXT_DIM = '#8899AA';
const GREEN = '#00C853';
const LIGHT_GREEN = '#4CAF50';
const YELLOW = '#FFD600';
const RED = '#F44336';
const HEADER_BG = '#0A1628';

interface FinancialQuarter {
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
  period: string;
}

interface EarningsCard {
  symbol: string;
  company: string;
  resultDate: string;
  quarter: string;
  reportType: string;
  current: FinancialQuarter;
  prevQ: FinancialQuarter | null;
  yoyQ: FinancialQuarter | null;
  revenueYoY: number | null;
  revenueQoQ: number | null;
  opProfitYoY: number | null;
  opProfitQoQ: number | null;
  patYoY: number | null;
  patQoQ: number | null;
  epsYoY: number | null;
  epsQoQ: number | null;
  mcap: number | null;
  pe: number | null;
  cmp: number | null;
  priceChange: number | null;
  sector: string;
  industry: string;
  marketCap: string;
  grade: 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  signalScore: number;
  resultLink: string | null;
  xbrlLink: string | null;
}

// ══════════════════════════════════════════════
// HELPER COMPONENTS
// ══════════════════════════════════════════════

function GrowthBadge({ value, fontSize = 13 }: { value: number | null; fontSize?: number }) {
  if (value === null || value === undefined) return <span style={{ color: TEXT_DIM, fontSize }}>—</span>;
  const color = value > 0 ? GREEN : value < 0 ? RED : YELLOW;
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return (
    <span style={{ color, fontSize, fontWeight: 600, fontFamily: 'monospace' }}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}%{arrow ? ` ${arrow}` : ''}
    </span>
  );
}

function GradeBadge({ grade, color }: { grade: string; color: string }) {
  const emoji = grade === 'STRONG' ? '🟢' : grade === 'GOOD' ? '🟢' : grade === 'OK' ? '🟡' : '🔴';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 10px', borderRadius: 4,
      background: `${color}18`, color, fontSize: 12, fontWeight: 700,
      border: `1px solid ${color}40`,
    }}>
      {emoji} {grade}
    </span>
  );
}

function formatCr(val: number): string {
  if (val === 0) return '—';
  if (Math.abs(val) >= 1000) return `${(val / 1).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return val.toFixed(1);
}

// ══════════════════════════════════════════════
// SINGLE EARNINGS CARD
// ══════════════════════════════════════════════

function EarningsCardComponent({ card, onClick }: { card: EarningsCard; onClick: () => void }) {
  const { current, prevQ, yoyQ } = card;

  const rows = [
    {
      label: 'Revenue', unit: 'Cr',
      yoy: card.revenueYoY, qoq: card.revenueQoQ,
      current: current.revenue, prevQ: prevQ?.revenue, yoyQ: yoyQ?.revenue,
      highlight: true,
    },
    {
      label: 'Operating Profit', unit: 'Cr',
      yoy: card.opProfitYoY, qoq: card.opProfitQoQ,
      current: current.operatingProfit, prevQ: prevQ?.operatingProfit, yoyQ: yoyQ?.operatingProfit,
      highlight: false,
    },
    {
      label: 'OPM', unit: '%',
      yoy: null, qoq: null,
      current: current.opm, prevQ: prevQ?.opm, yoyQ: yoyQ?.opm,
      highlight: false, isPercent: true,
    },
    {
      label: 'PAT', unit: 'Cr',
      yoy: card.patYoY, qoq: card.patQoQ,
      current: current.pat, prevQ: prevQ?.pat, yoyQ: yoyQ?.pat,
      highlight: true,
    },
    {
      label: 'NPM', unit: '%',
      yoy: null, qoq: null,
      current: current.npm, prevQ: prevQ?.npm, yoyQ: yoyQ?.npm,
      highlight: false, isPercent: true,
    },
    {
      label: 'EPS', unit: '₹',
      yoy: card.epsYoY, qoq: card.epsQoQ,
      current: current.eps, prevQ: prevQ?.eps, yoyQ: yoyQ?.eps,
      highlight: true,
    },
  ];

  // Column headers
  const currentPeriod = current.period || 'Current';
  const prevPeriod = prevQ?.period || 'Prev Q';
  const yoyPeriod = yoyQ?.period || 'Year Ago';

  return (
    <div
      onClick={onClick}
      style={{
        background: CARD,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.2s, transform 0.15s',
        minWidth: 0,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = card.gradeColor;
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = CARD_BORDER;
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: '14px 16px 10px', borderBottom: `1px solid ${CARD_BORDER}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{card.company}</span>
            <GradeBadge grade={card.grade} color={card.gradeColor} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{
              padding: '1px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600,
              background: ACCENT + '20', color: ACCENT, border: `1px solid ${ACCENT}40`,
            }}>{card.reportType}</span>
            {card.sector && (
              <span style={{ fontSize: 11, color: TEXT_DIM }}>{card.sector}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>{card.resultDate}</div>
          <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600 }}>{card.quarter}</div>
        </div>
      </div>

      {/* Financial Table */}
      <div style={{ padding: '0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: HEADER_BG }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: TEXT_DIM, fontWeight: 500, fontSize: 12 }}></th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: TEXT_DIM, fontWeight: 500, fontSize: 11, width: '15%' }}>YoY</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: TEXT_DIM, fontWeight: 500, fontSize: 11, width: '15%' }}>QoQ</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: TEXT_DIM, fontWeight: 500, fontSize: 11, width: '16%' }}>{currentPeriod}</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: TEXT_DIM, fontWeight: 500, fontSize: 11, width: '16%' }}>{prevPeriod}</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: TEXT_DIM, fontWeight: 500, fontSize: 11, width: '16%' }}>{yoyPeriod}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.label} style={{
                borderTop: `1px solid ${CARD_BORDER}`,
                background: i % 2 === 0 ? 'transparent' : `${HEADER_BG}40`,
              }}>
                <td style={{
                  padding: '7px 12px', color: row.highlight ? TEXT : TEXT_DIM,
                  fontWeight: row.highlight ? 600 : 400, fontSize: 13,
                  whiteSpace: 'nowrap',
                }}>
                  {row.label} <span style={{ fontSize: 10, color: TEXT_DIM }}>{row.unit}</span>
                </td>
                <td style={{ textAlign: 'right', padding: '7px 6px' }}>
                  {row.yoy !== null && row.yoy !== undefined ? (
                    <GrowthBadge value={row.yoy} fontSize={12} />
                  ) : (
                    <span style={{ color: TEXT_DIM, fontSize: 12 }}></span>
                  )}
                </td>
                <td style={{ textAlign: 'right', padding: '7px 6px' }}>
                  {row.qoq !== null && row.qoq !== undefined ? (
                    <GrowthBadge value={row.qoq} fontSize={12} />
                  ) : (
                    <span style={{ color: TEXT_DIM, fontSize: 12 }}></span>
                  )}
                </td>
                <td style={{
                  textAlign: 'right', padding: '7px 6px',
                  color: TEXT, fontWeight: 600, fontFamily: 'monospace', fontSize: 13,
                }}>
                  {row.current !== undefined && row.current !== 0
                    ? (row.isPercent ? row.current.toFixed(1) : formatCr(row.current))
                    : '—'}
                </td>
                <td style={{
                  textAlign: 'right', padding: '7px 6px',
                  color: TEXT_DIM, fontFamily: 'monospace', fontSize: 12,
                }}>
                  {row.prevQ !== undefined && row.prevQ !== null && row.prevQ !== 0
                    ? (row.isPercent ? row.prevQ.toFixed(1) : formatCr(row.prevQ))
                    : '—'}
                </td>
                <td style={{
                  textAlign: 'right', padding: '7px 12px',
                  color: TEXT_DIM, fontFamily: 'monospace', fontSize: 12,
                }}>
                  {row.yoyQ !== undefined && row.yoyQ !== null && row.yoyQ !== 0
                    ? (row.isPercent ? row.yoyQ.toFixed(1) : formatCr(row.yoyQ))
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 14px', borderTop: `1px solid ${CARD_BORDER}`,
        background: HEADER_BG,
      }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {card.resultLink && (
            <a href={card.resultLink} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ color: ACCENT, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
              Result
            </a>
          )}
          <span style={{ color: TEXT_DIM, fontSize: 12, cursor: 'pointer' }}>PPT</span>
          <span style={{ color: TEXT_DIM, fontSize: 12, cursor: 'pointer' }}>Transcript</span>
          <span style={{ color: TEXT_DIM, fontSize: 12, cursor: 'pointer' }}>Transcript (Notes)</span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: TEXT_DIM }}>
          {card.mcap && (
            <span>MCap: <span style={{ color: TEXT, fontWeight: 600 }}>₹{card.mcap.toLocaleString('en-IN')} Cr</span></span>
          )}
          {card.pe && (
            <span>PE: <span style={{ color: TEXT, fontWeight: 600 }}>{card.pe}</span></span>
          )}
          {card.cmp && (
            <span>CMP: <span style={{ color: TEXT, fontWeight: 600 }}>₹{card.cmp.toLocaleString('en-IN')}</span></span>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// DETAIL DRAWER
// ══════════════════════════════════════════════

function DetailDrawer({ card, onClose }: { card: EarningsCard; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: '480px', maxWidth: '90vw',
      background: CARD, borderLeft: `2px solid ${card.gradeColor}`,
      zIndex: 1000, overflowY: 'auto', boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
    }}>
      {/* Close */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 20px', borderBottom: `1px solid ${CARD_BORDER}`,
        position: 'sticky', top: 0, background: CARD, zIndex: 1,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>{card.symbol}</div>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>{card.company}</div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: `1px solid ${CARD_BORDER}`, borderRadius: 6,
          color: TEXT_DIM, padding: '4px 12px', cursor: 'pointer', fontSize: 14,
        }}>✕</button>
      </div>

      {/* P&L Snapshot */}
      <div style={{ padding: '16px 20px' }}>
        <h3 style={{ color: TEXT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 8 }}>
          Financial Summary — {card.quarter}
        </h3>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <GradeBadge grade={card.grade} color={card.gradeColor} />
          <span style={{ fontSize: 12, color: TEXT_DIM, padding: '3px 8px', background: `${ACCENT}15`, borderRadius: 4 }}>
            Score: {card.signalScore}/100
          </span>
          <span style={{ fontSize: 12, color: TEXT_DIM, padding: '3px 8px', background: `${ACCENT}15`, borderRadius: 4 }}>
            {card.reportType}
          </span>
        </div>

        {/* Key metrics grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Revenue', val: card.current.revenue, yoy: card.revenueYoY, unit: 'Cr' },
            { label: 'Op. Profit', val: card.current.operatingProfit, yoy: card.opProfitYoY, unit: 'Cr' },
            { label: 'PAT', val: card.current.pat, yoy: card.patYoY, unit: 'Cr' },
            { label: 'EPS', val: card.current.eps, yoy: card.epsYoY, unit: '₹' },
            { label: 'OPM', val: card.current.opm, yoy: null, unit: '%' },
            { label: 'NPM', val: card.current.npm, yoy: null, unit: '%' },
          ].map(m => (
            <div key={m.label} style={{
              background: HEADER_BG, borderRadius: 8, padding: '10px 14px',
              border: `1px solid ${CARD_BORDER}`,
            }}>
              <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: 'monospace' }}>
                {m.unit === '%' ? `${m.val.toFixed(1)}%` :
                  m.unit === '₹' ? `₹${m.val.toFixed(2)}` :
                    `₹${formatCr(m.val)} Cr`}
              </div>
              {m.yoy !== null && (
                <div style={{ marginTop: 2 }}>
                  <span style={{ fontSize: 11, color: TEXT_DIM }}>YoY: </span>
                  <GrowthBadge value={m.yoy} fontSize={12} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Trend chart placeholder */}
        <h3 style={{ color: TEXT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 8 }}>
          YoY / QoQ Trends
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Revenue YoY', val: card.revenueYoY },
            { label: 'Revenue QoQ', val: card.revenueQoQ },
            { label: 'PAT YoY', val: card.patYoY },
            { label: 'PAT QoQ', val: card.patQoQ },
            { label: 'EPS YoY', val: card.epsYoY },
            { label: 'EPS QoQ', val: card.epsQoQ },
          ].map(m => (
            <div key={m.label} style={{
              background: HEADER_BG, borderRadius: 6, padding: '8px 12px',
              border: `1px solid ${CARD_BORDER}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: TEXT_DIM }}>{m.label}</span>
              <GrowthBadge value={m.val} fontSize={14} />
            </div>
          ))}
        </div>

        {/* Stock Info */}
        <h3 style={{ color: TEXT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 8 }}>
          Stock Info
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'CMP', val: card.cmp ? `₹${card.cmp.toLocaleString('en-IN')}` : '—' },
            { label: 'MCap', val: card.mcap ? `₹${card.mcap.toLocaleString('en-IN')} Cr` : '—' },
            { label: 'P/E', val: card.pe ? card.pe.toFixed(1) : '—' },
            { label: 'Sector', val: card.sector || '—' },
            { label: 'Cap', val: card.marketCap || '—' },
            { label: 'Filed', val: card.resultDate },
          ].map(m => (
            <div key={m.label} style={{
              background: HEADER_BG, borderRadius: 6, padding: '8px 12px',
              border: `1px solid ${CARD_BORDER}`,
            }}>
              <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{m.val}</div>
            </div>
          ))}
        </div>

        {/* Links */}
        <h3 style={{ color: TEXT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 8 }}>
          Filing Links
        </h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {card.resultLink && (
            <a href={card.resultLink} target="_blank" rel="noopener noreferrer" style={{
              padding: '6px 14px', borderRadius: 6, background: `${ACCENT}20`, color: ACCENT,
              fontSize: 13, fontWeight: 600, textDecoration: 'none', border: `1px solid ${ACCENT}40`,
            }}>📄 Result</a>
          )}
          <span style={{
            padding: '6px 14px', borderRadius: 6, background: `${TEXT_DIM}10`, color: TEXT_DIM,
            fontSize: 13, border: `1px solid ${CARD_BORDER}`, cursor: 'not-allowed',
          }}>📊 PPT</span>
          <span style={{
            padding: '6px 14px', borderRadius: 6, background: `${TEXT_DIM}10`, color: TEXT_DIM,
            fontSize: 13, border: `1px solid ${CARD_BORDER}`, cursor: 'not-allowed',
          }}>🎤 Transcript</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════

export default function EarningsPage() {
  const [cards, setCards] = useState<EarningsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCard, setSelectedCard] = useState<EarningsCard | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');
  const [indexFilter, setIndexFilter] = useState<string>('');
  const [summary, setSummary] = useState<any>(null);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ month });
      if (indexFilter) params.set('index', indexFilter);
      const res = await fetch(`/api/market/earnings-cards?${params}`);
      const data = await res.json();
      setCards(data.cards || []);
      setSummary(data.summary || null);
    } catch (e) {
      setError(String(e));
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [month, indexFilter]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  // Month navigation
  const changeMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // Grade filter
  const filteredCards = gradeFilter === 'ALL' ? cards :
    cards.filter(c => c.grade === gradeFilter);

  // Month label
  const [my, mm] = month.split('-').map(Number);
  const monthLabel = new Date(my, mm - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, padding: '20px 24px' }}>
      {/* Overlay for drawer */}
      {selectedCard && (
        <div
          onClick={() => setSelectedCard(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 999,
          }}
        />
      )}
      {selectedCard && <DetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: TEXT }}>
              Earnings Results
            </h1>
            <p style={{ fontSize: 13, color: TEXT_DIM, margin: '4px 0 0' }}>
              Quarterly financial results with YoY/QoQ analysis
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => changeMonth(-1)} style={{
              background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 6,
              color: TEXT, padding: '6px 12px', cursor: 'pointer', fontSize: 16,
            }}>←</button>
            <span style={{ fontSize: 16, fontWeight: 600, color: TEXT, minWidth: 160, textAlign: 'center' }}>
              {monthLabel}
            </span>
            <button onClick={() => changeMonth(1)} style={{
              background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 6,
              color: TEXT, padding: '6px 12px', cursor: 'pointer', fontSize: 16,
            }}>→</button>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      {summary && (
        <div style={{
          display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
          padding: '10px 16px', background: CARD, borderRadius: 8, border: `1px solid ${CARD_BORDER}`,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>
            {summary.total} Results
          </span>
          <span style={{ color: CARD_BORDER }}>|</span>
          <span style={{ fontSize: 13, color: GREEN }}>🟢 Strong: {summary.strong}</span>
          <span style={{ fontSize: 13, color: LIGHT_GREEN }}>🟢 Good: {summary.good}</span>
          <span style={{ fontSize: 13, color: YELLOW }}>🟡 OK: {summary.ok}</span>
          <span style={{ fontSize: 13, color: RED }}>🔴 Bad: {summary.bad}</span>
          <span style={{ color: CARD_BORDER }}>|</span>
          <span style={{ fontSize: 13, color: TEXT_DIM }}>Avg Score: {summary.avgScore}</span>
        </div>
      )}

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap',
      }}>
        {['ALL', 'STRONG', 'GOOD', 'OK', 'BAD'].map(g => (
          <button key={g} onClick={() => setGradeFilter(g)} style={{
            padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: gradeFilter === g ? ACCENT : CARD,
            color: gradeFilter === g ? '#fff' : TEXT_DIM,
            border: `1px solid ${gradeFilter === g ? ACCENT : CARD_BORDER}`,
          }}>
            {g === 'ALL' ? 'All' :
              g === 'STRONG' ? '🟢 Strong' :
              g === 'GOOD' ? '🟢 Good' :
              g === 'OK' ? '🟡 OK' : '🔴 Bad'}
          </button>
        ))}
        <span style={{ width: 1, background: CARD_BORDER, margin: '0 4px' }} />
        {[
          { label: 'All', value: '' },
          { label: 'Nifty 50', value: 'NIFTY50' },
          { label: 'Nifty 500', value: 'NIFTY500' },
          { label: 'Midcap', value: 'MIDCAP' },
          { label: 'Smallcap', value: 'SMALLCAP' },
        ].map(idx => (
          <button key={idx.value} onClick={() => setIndexFilter(idx.value)} style={{
            padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: indexFilter === idx.value ? ACCENT : CARD,
            color: indexFilter === idx.value ? '#fff' : TEXT_DIM,
            border: `1px solid ${indexFilter === idx.value ? ACCENT : CARD_BORDER}`,
          }}>
            {idx.label}
          </button>
        ))}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: TEXT_DIM }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>⏳</div>
          <div>Loading earnings data...</div>
        </div>
      )}

      {error && (
        <div style={{
          padding: 16, background: `${RED}15`, border: `1px solid ${RED}40`, borderRadius: 8,
          color: RED, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Cards grid */}
      {!loading && filteredCards.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: TEXT_DIM }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📊</div>
          <div style={{ fontSize: 16, marginBottom: 6 }}>No earnings results for {monthLabel}</div>
          <div style={{ fontSize: 13 }}>Try a different month or check back later</div>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))',
        gap: 16,
      }}>
        {filteredCards.map(card => (
          <EarningsCardComponent
            key={card.symbol}
            card={card}
            onClick={() => setSelectedCard(card)}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        textAlign: 'center', padding: '24px 0 8px', color: TEXT_DIM, fontSize: 11,
      }}>
        Data from NSE India • Auto-refresh every 5 minutes • {filteredCards.length} results shown
      </div>
    </div>
  );
}
