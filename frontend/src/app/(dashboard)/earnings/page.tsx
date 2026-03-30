'use client';

import { useState, useEffect, useCallback } from 'react';

// ══════════════════════════════════════════════
// EARNINGS CARDS PAGE — EarningsPulse-style UI
// Consumes 2-Layer Schema from /api/market/earnings-cards
//   Layer 1: Event Intelligence (always present)
//   Layer 2: Fundamentals (future-fillable slots)
// Data confidence badge: FULL / PARTIAL / NONE
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

// ── Types matching API v4 2-layer schema ──

interface PriceReaction {
  cmp: number;
  prevClose: number | null;
  edp: number | null;
  changePct: number;
  excessReturn: number | null;
  indexReturn: number | null;
}

interface QuarterData {
  period: string;
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
}

interface Financials {
  revenue: number | null;
  operatingProfit: number | null;
  opm: number | null;
  pat: number | null;
  npm: number | null;
  eps: number | null;
  revenueYoY: number | null;
  opProfitYoY: number | null;
  patYoY: number | null;
  epsYoY: number | null;
  marginTrendYoY: number | null;
  revenueQoQ: number | null;
  opProfitQoQ: number | null;
  patQoQ: number | null;
  epsQoQ: number | null;
  prevQ: QuarterData | null;
  yoyQ: QuarterData | null;
}

type DataQuality = 'FULL' | 'PARTIAL' | 'NONE';

interface EarningsCard {
  symbol: string;
  company: string;
  period: string;
  resultDate: string;
  reportType: string;
  sector: string;
  industry: string;
  marketCap: string;
  qualityScore: number;
  grade: 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  price: PriceReaction;
  financials: Financials;
  dataQuality: DataQuality;
  source: string;
  pe: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  mcap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  resultLink: string | null;
  nseLink: string;
}

// ══════════════════════════════════════════════
// HELPER COMPONENTS
// ══════════════════════════════════════════════

function GrowthBadge({ value, fontSize = 13 }: { value: number | null | undefined; fontSize?: number }) {
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

function DataQualityBadge({ quality }: { quality: DataQuality }) {
  const config = {
    FULL:    { emoji: '🟢', label: 'Full Data',       color: GREEN,  bg: `${GREEN}15` },
    PARTIAL: { emoji: '🟡', label: 'Partial',         color: YELLOW, bg: `${YELLOW}15` },
    NONE:    { emoji: '🔴', label: 'Price Only',      color: RED,    bg: `${RED}15` },
  }[quality];

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '1px 7px', borderRadius: 3, fontSize: 10, fontWeight: 600,
      background: config.bg, color: config.color,
      border: `1px solid ${config.color}30`,
    }}>
      {config.emoji} {config.label}
    </span>
  );
}

function ExcessReturnBadge({ excessReturn, indexReturn }: { excessReturn: number | null; indexReturn: number | null }) {
  if (excessReturn === null) return null;
  const color = excessReturn > 0 ? GREEN : excessReturn < 0 ? RED : YELLOW;
  const label = excessReturn > 0 ? `+${excessReturn.toFixed(1)}%` : `${excessReturn.toFixed(1)}%`;
  return (
    <span
      title={`Excess return vs Nifty 50 (${indexReturn !== null ? (indexReturn > 0 ? '+' : '') + indexReturn.toFixed(1) + '%' : '—'})`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '1px 7px', borderRadius: 3, fontSize: 10, fontWeight: 600,
        background: `${color}15`, color,
        border: `1px solid ${color}30`,
        cursor: 'help',
      }}
    >
      vs Nifty: {label}
    </span>
  );
}

function formatCr(val: number | null): string {
  if (val === null || val === 0) return '—';
  if (Math.abs(val) >= 1000) return `${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return val.toFixed(1);
}

// ══════════════════════════════════════════════
// SINGLE EARNINGS CARD
// ══════════════════════════════════════════════

function EarningsCardComponent({ card, onClick }: { card: EarningsCard; onClick: () => void }) {
  const { financials: fin, price } = card;
  const hasFin = card.dataQuality !== 'NONE';

  // Build rows — show financials if available, otherwise show price reaction card
  const rows = hasFin ? [
    {
      label: 'Revenue', unit: 'Cr',
      yoy: fin.revenueYoY, qoq: fin.revenueQoQ,
      current: fin.revenue, prevQ: fin.prevQ?.revenue ?? null, yoyQ: fin.yoyQ?.revenue ?? null,
      highlight: true,
    },
    {
      label: 'Operating Profit', unit: 'Cr',
      yoy: fin.opProfitYoY, qoq: fin.opProfitQoQ,
      current: fin.operatingProfit, prevQ: fin.prevQ?.operatingProfit ?? null, yoyQ: fin.yoyQ?.operatingProfit ?? null,
      highlight: false,
    },
    {
      label: 'OPM', unit: '%',
      yoy: null, qoq: null,
      current: fin.opm, prevQ: fin.prevQ?.opm ?? null, yoyQ: fin.yoyQ?.opm ?? null,
      highlight: false, isPercent: true,
    },
    {
      label: 'PAT', unit: 'Cr',
      yoy: fin.patYoY, qoq: fin.patQoQ,
      current: fin.pat, prevQ: fin.prevQ?.pat ?? null, yoyQ: fin.yoyQ?.pat ?? null,
      highlight: true,
    },
    {
      label: 'NPM', unit: '%',
      yoy: null, qoq: null,
      current: fin.npm, prevQ: fin.prevQ?.npm ?? null, yoyQ: fin.yoyQ?.npm ?? null,
      highlight: false, isPercent: true,
    },
    {
      label: 'EPS', unit: '₹',
      yoy: fin.epsYoY, qoq: fin.epsQoQ,
      current: fin.eps, prevQ: fin.prevQ?.eps ?? null, yoyQ: fin.yoyQ?.eps ?? null,
      highlight: true,
    },
  ] : null;

  const currentPeriod = fin.prevQ?.period ? card.period : 'Current';
  const prevPeriod = fin.prevQ?.period || 'Prev Q';
  const yoyPeriod = fin.yoyQ?.period || 'Year Ago';

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
            <DataQualityBadge quality={card.dataQuality} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              padding: '1px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600,
              background: ACCENT + '20', color: ACCENT, border: `1px solid ${ACCENT}40`,
            }}>{card.reportType}</span>
            {card.sector && (
              <span style={{ fontSize: 11, color: TEXT_DIM }}>{card.sector}</span>
            )}
            <ExcessReturnBadge excessReturn={price.excessReturn} indexReturn={price.indexReturn} />
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>{card.resultDate}</div>
          <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600 }}>{card.period}</div>
          <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 2 }}>
            Score: <span style={{ color: card.gradeColor, fontWeight: 700 }}>{card.qualityScore}</span>/100
          </div>
        </div>
      </div>

      {/* Financial Table (when we have financials) */}
      {rows && (
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
                    {row.current !== undefined && row.current !== null && row.current !== 0
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
      )}

      {/* Price Reaction Card (when no financials) */}
      {!rows && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10,
          }}>
            <div style={{
              background: HEADER_BG, borderRadius: 8, padding: '10px 12px',
              border: `1px solid ${CARD_BORDER}`,
            }}>
              <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 3 }}>Price Move</div>
              <div style={{
                fontSize: 18, fontWeight: 700, fontFamily: 'monospace',
                color: price.changePct > 0 ? GREEN : price.changePct < 0 ? RED : TEXT,
              }}>
                {price.changePct > 0 ? '+' : ''}{price.changePct.toFixed(1)}%
              </div>
            </div>
            <div style={{
              background: HEADER_BG, borderRadius: 8, padding: '10px 12px',
              border: `1px solid ${CARD_BORDER}`,
            }}>
              <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 3 }}>vs Nifty 50</div>
              <div style={{
                fontSize: 18, fontWeight: 700, fontFamily: 'monospace',
                color: (price.excessReturn ?? 0) > 0 ? GREEN : (price.excessReturn ?? 0) < 0 ? RED : TEXT,
              }}>
                {(price.excessReturn ?? 0) > 0 ? '+' : ''}{(price.excessReturn ?? 0).toFixed(1)}%
              </div>
            </div>
            <div style={{
              background: HEADER_BG, borderRadius: 8, padding: '10px 12px',
              border: `1px solid ${CARD_BORDER}`,
            }}>
              <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 3 }}>CMP</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: TEXT }}>
                ₹{price.cmp.toLocaleString('en-IN')}
              </div>
            </div>
          </div>
          <div style={{
            marginTop: 8, padding: '6px 10px', borderRadius: 6,
            background: `${YELLOW}10`, border: `1px solid ${YELLOW}20`,
            fontSize: 11, color: TEXT_DIM, textAlign: 'center',
          }}>
            Fundamentals unavailable — grade based on market reaction relative to Nifty 50
          </div>
        </div>
      )}

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
          <a href={card.nseLink} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: TEXT_DIM, fontSize: 12, textDecoration: 'none' }}>
            NSE
          </a>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: TEXT_DIM }}>
          {card.mcap && (
            <span>MCap: <span style={{ color: TEXT, fontWeight: 600 }}>₹{card.mcap.toLocaleString('en-IN')} Cr</span></span>
          )}
          {card.pe && (
            <span>PE: <span style={{ color: TEXT, fontWeight: 600 }}>{card.pe}</span></span>
          )}
          {card.price.cmp > 0 && (
            <span>CMP: <span style={{ color: TEXT, fontWeight: 600 }}>₹{card.price.cmp.toLocaleString('en-IN')}</span></span>
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
  const { financials: fin, price } = card;
  const hasFin = card.dataQuality !== 'NONE';

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

      <div style={{ padding: '16px 20px' }}>
        {/* Badges row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <GradeBadge grade={card.grade} color={card.gradeColor} />
          <DataQualityBadge quality={card.dataQuality} />
          <span style={{ fontSize: 12, color: TEXT_DIM, padding: '3px 8px', background: `${ACCENT}15`, borderRadius: 4 }}>
            Score: {card.qualityScore}/100
          </span>
          <span style={{ fontSize: 12, color: TEXT_DIM, padding: '3px 8px', background: `${ACCENT}15`, borderRadius: 4 }}>
            {card.reportType}
          </span>
        </div>

        {/* Market Reaction (always shown) */}
        <h3 style={{ color: TEXT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 8 }}>
          Market Reaction
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Price Move', val: `${price.changePct > 0 ? '+' : ''}${price.changePct.toFixed(1)}%`, color: price.changePct > 0 ? GREEN : price.changePct < 0 ? RED : TEXT },
            { label: 'vs Nifty 50', val: price.excessReturn !== null ? `${price.excessReturn > 0 ? '+' : ''}${price.excessReturn.toFixed(1)}%` : '—', color: (price.excessReturn ?? 0) > 0 ? GREEN : (price.excessReturn ?? 0) < 0 ? RED : TEXT },
            { label: 'Nifty Return', val: price.indexReturn !== null ? `${price.indexReturn > 0 ? '+' : ''}${price.indexReturn.toFixed(1)}%` : '—', color: TEXT_DIM },
          ].map(m => (
            <div key={m.label} style={{
              background: HEADER_BG, borderRadius: 8, padding: '10px 14px',
              border: `1px solid ${CARD_BORDER}`,
            }}>
              <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: 'monospace' }}>
                {m.val}
              </div>
            </div>
          ))}
        </div>

        {/* Financial Summary (when available) */}
        {hasFin && (
          <>
            <h3 style={{ color: TEXT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 8 }}>
              Financial Summary — {card.period}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Revenue', val: fin.revenue, yoy: fin.revenueYoY, unit: 'Cr' },
                { label: 'Op. Profit', val: fin.operatingProfit, yoy: fin.opProfitYoY, unit: 'Cr' },
                { label: 'PAT', val: fin.pat, yoy: fin.patYoY, unit: 'Cr' },
                { label: 'EPS', val: fin.eps, yoy: fin.epsYoY, unit: '₹' },
                { label: 'OPM', val: fin.opm, yoy: null, unit: '%' },
                { label: 'NPM', val: fin.npm, yoy: null, unit: '%' },
              ].map(m => (
                <div key={m.label} style={{
                  background: HEADER_BG, borderRadius: 8, padding: '10px 14px',
                  border: `1px solid ${CARD_BORDER}`,
                }}>
                  <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: 'monospace' }}>
                    {m.val !== null && m.val !== 0
                      ? (m.unit === '%' ? `${m.val.toFixed(1)}%` :
                        m.unit === '₹' ? `₹${m.val.toFixed(2)}` :
                          `₹${formatCr(m.val)} Cr`)
                      : '—'}
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
          </>
        )}

        {/* No Fundamentals notice */}
        {!hasFin && (
          <div style={{
            padding: '14px 16px', borderRadius: 8, marginBottom: 20,
            background: `${YELLOW}10`, border: `1px solid ${YELLOW}20`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: YELLOW, marginBottom: 4 }}>
              Fundamentals Not Yet Available
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.5 }}>
              P&amp;L data (Revenue, PAT, EPS) will be populated when available from XBRL filings.
              Grade is currently based on market reaction relative to Nifty 50 index.
            </div>
          </div>
        )}

        {/* Stock Info */}
        <h3 style={{ color: TEXT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 8 }}>
          Stock Info
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'CMP', val: price.cmp ? `₹${price.cmp.toLocaleString('en-IN')}` : '—' },
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
          Links
        </h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {card.resultLink && (
            <a href={card.resultLink} target="_blank" rel="noopener noreferrer" style={{
              padding: '6px 14px', borderRadius: 6, background: `${ACCENT}20`, color: ACCENT,
              fontSize: 13, fontWeight: 600, textDecoration: 'none', border: `1px solid ${ACCENT}40`,
            }}>Result</a>
          )}
          <a href={card.nseLink} target="_blank" rel="noopener noreferrer" style={{
            padding: '6px 14px', borderRadius: 6, background: `${ACCENT}20`, color: ACCENT,
            fontSize: 13, fontWeight: 600, textDecoration: 'none', border: `1px solid ${ACCENT}40`,
          }}>NSE Quote</a>
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

  const changeMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const filteredCards = gradeFilter === 'ALL' ? cards :
    cards.filter(c => c.grade === gradeFilter);

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
              Quarterly financial results with market reaction analysis
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
          <span style={{ fontSize: 13, color: GREEN }}>Strong: {summary.strong}</span>
          <span style={{ fontSize: 13, color: LIGHT_GREEN }}>Good: {summary.good}</span>
          <span style={{ fontSize: 13, color: YELLOW }}>OK: {summary.ok}</span>
          <span style={{ fontSize: 13, color: RED }}>Bad: {summary.bad}</span>
          <span style={{ color: CARD_BORDER }}>|</span>
          <span style={{ fontSize: 13, color: TEXT_DIM }}>Avg Score: {summary.avgScore}</span>
          {summary.dataQualityBreakdown && (
            <>
              <span style={{ color: CARD_BORDER }}>|</span>
              <span style={{ fontSize: 12, color: GREEN }}>Full: {summary.dataQualityBreakdown.full}</span>
              <span style={{ fontSize: 12, color: YELLOW }}>Partial: {summary.dataQualityBreakdown.partial}</span>
              <span style={{ fontSize: 12, color: RED }}>Price-only: {summary.dataQualityBreakdown.none}</span>
            </>
          )}
          {summary.niftyReturn !== undefined && summary.niftyReturn !== 0 && (
            <>
              <span style={{ color: CARD_BORDER }}>|</span>
              <span style={{ fontSize: 12, color: TEXT_DIM }}>
                Nifty: <span style={{ color: summary.niftyReturn > 0 ? GREEN : RED }}>
                  {summary.niftyReturn > 0 ? '+' : ''}{summary.niftyReturn.toFixed(1)}%
                </span>
              </span>
            </>
          )}
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
              g === 'STRONG' ? 'Strong' :
              g === 'GOOD' ? 'Good' :
              g === 'OK' ? 'OK' : 'Bad'}
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
        Data from NSE India (Live) • {filteredCards.length} results shown • Schema v2
      </div>
    </div>
  );
}
