'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Loader } from 'lucide-react';

interface Sector {
  name: string;
  color: string;
  rsRatio: number;
  rsMomentum: number;
  quadrant: 'Leading' | 'Weakening' | 'Lagging' | 'Improving';
  changePercent: number;
}

interface Benchmark {
  symbol: string;
  price: number;
  changePercent: number;
}

interface RRGData {
  sectors: Sector[];
  benchmark: Benchmark;
  market: string;
  timeframe: string;
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

const QUADRANT_INFO = {
  Leading: { bg: '#10B98133', border: '#10B981', label: 'Leading' },
  Weakening: { bg: '#F59E0B33', border: '#F59E0B', label: 'Weakening' },
  Lagging: { bg: '#EF444433', border: '#EF4444', label: 'Lagging' },
  Improving: { bg: '#0F7ABF33', border: '#0F7ABF', label: 'Improving' },
};

export default function RRGPage() {
  const [market, setMarket] = useState<'india' | 'global'>('india');
  const [timeframe, setTimeframe] = useState<'1m' | '3m' | '6m' | '1y'>('3m');
  const [data, setData] = useState<RRGData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; sector: Sector } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const marketParam = market === 'global' ? 'us' : 'india';
      const response = await fetch(`/api/market/rrg?market=${marketParam}&timeframe=${timeframe}`);
      if (!response.ok) throw new Error('Failed to fetch RRG data');
      const result: RRGData = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [market, timeframe]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getQuadrantSectors = (quadrant: string) => {
    return data?.sectors.filter((s) => s.quadrant === quadrant) || [];
  };

  const handleSvgHover = (sector: Sector, event: React.MouseEvent<SVGCircleElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setTooltip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      sector,
    });
    setHoveredSector(sector.name);
  };

  const chartWidth = 500;
  const chartHeight = 500;
  const padding = 40;
  const plotWidth = chartWidth - 2 * padding;
  const plotHeight = chartHeight - 2 * padding;

  const getPlotX = (rsRatio: number) => padding + ((rsRatio - 80) / 40) * plotWidth;
  const getPlotY = (rsMomentum: number) => padding + plotHeight - ((rsMomentum - 80) / 40) * plotHeight;

  return (
    <div style={{ background: THEME.background, minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ width: '32px', height: '32px', background: THEME.accent, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={20} color={THEME.background} />
            </div>
            <h1 style={{ color: THEME.textPrimary, fontSize: '28px', fontWeight: '700', margin: 0 }}>
              Relative Rotation Graph
            </h1>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Market Toggle */}
            <div style={{ display: 'flex', gap: '8px', background: THEME.card, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
              {(['india', 'global'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMarket(m)}
                  style={{
                    padding: '8px 16px',
                    background: market === m ? THEME.accent : 'transparent',
                    color: market === m ? THEME.background : THEME.textSecondary,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                    textTransform: 'capitalize',
                  }}
                >
                  {m === 'global' ? 'Global (US)' : 'India'}
                </button>
              ))}
            </div>

            {/* Timeframe Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['1m', '3m', '6m', '1y'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  style={{
                    padding: '8px 16px',
                    background: timeframe === tf ? THEME.accent : THEME.card,
                    color: timeframe === tf ? THEME.background : THEME.textSecondary,
                    border: `1px solid ${timeframe === tf ? THEME.accent : THEME.border}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                >
                  {tf === '1m' ? '1 Month' : tf === '3m' ? '3 Months' : tf === '6m' ? '6 Months' : '1 Year'}
                </button>
              ))}
            </div>

            {/* Last Updated */}
            {data && (
              <div style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textSecondary }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: `${THEME.green}22`, padding: '4px 8px', borderRadius: '4px', color: THEME.green }}>
                  <span style={{ width: '6px', height: '6px', background: THEME.green, borderRadius: '50%', animation: 'pulse 2s infinite' }}></span>
                  Live
                </span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: '16px', background: `${THEME.red}22`, border: `1px solid ${THEME.red}`, borderRadius: '8px', color: THEME.red, marginBottom: '24px' }}>
            Error: {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
            <Loader size={40} color={THEME.accent} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : data ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px' }}>
            {/* RRG Chart */}
            <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', padding: '24px' }}>
              <h2 style={{ color: THEME.textPrimary, fontSize: '16px', fontWeight: '600', marginBottom: '20px', margin: '0 0 20px 0' }}>
                Sector Rotation Map
              </h2>
              <div style={{ overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
                <svg
                  ref={svgRef}
                  width={chartWidth}
                  height={chartHeight}
                  style={{ background: 'transparent', position: 'relative' }}
                >
                  {/* Quadrant backgrounds */}
                  <rect x={padding} y={padding} width={plotWidth / 2} height={plotHeight / 2} fill={QUADRANT_INFO.Leading.bg} opacity={0.3} />
                  <rect x={padding + plotWidth / 2} y={padding} width={plotWidth / 2} height={plotHeight / 2} fill={QUADRANT_INFO.Weakening.bg} opacity={0.3} />
                  <rect x={padding} y={padding + plotHeight / 2} width={plotWidth / 2} height={plotHeight / 2} fill={QUADRANT_INFO.Improving.bg} opacity={0.3} />
                  <rect x={padding + plotWidth / 2} y={padding + plotHeight / 2} width={plotWidth / 2} height={plotHeight / 2} fill={QUADRANT_INFO.Lagging.bg} opacity={0.3} />

                  {/* Crosshair lines */}
                  <line x1={getPlotX(100)} y1={padding} x2={getPlotX(100)} y2={padding + plotHeight} stroke={THEME.border} strokeWidth={2} strokeDasharray="4" />
                  <line x1={padding} y1={getPlotY(100)} x2={padding + plotWidth} y2={getPlotY(100)} stroke={THEME.border} strokeWidth={2} strokeDasharray="4" />

                  {/* Quadrant labels */}
                  <text x={padding + (plotWidth * 3) / 4} y={padding + 20} textAnchor="middle" fill={THEME.green} fontSize="12" fontWeight="600">
                    LEADING
                  </text>
                  <text x={padding + plotWidth / 4} y={padding + 20} textAnchor="middle" fill={THEME.accent} fontSize="12" fontWeight="600">
                    IMPROVING
                  </text>
                  <text x={padding + plotWidth / 4} y={padding + plotHeight - 10} textAnchor="middle" fill={THEME.red} fontSize="12" fontWeight="600">
                    LAGGING
                  </text>
                  <text x={padding + (plotWidth * 3) / 4} y={padding + plotHeight - 10} textAnchor="middle" fill="#F59E0B" fontSize="12" fontWeight="600">
                    WEAKENING
                  </text>

                  {/* Axis labels */}
                  <text x={padding - 10} y={padding - 10} fill={THEME.textSecondary} fontSize="11">
                    110
                  </text>
                  <text x={padding + plotWidth - 10} y={padding - 10} fill={THEME.textSecondary} fontSize="11">
                    130
                  </text>
                  <text x={padding - 10} y={padding + plotHeight + 5} fill={THEME.textSecondary} fontSize="11">
                    80
                  </text>
                  <text x={padding - 25} y={padding + 15} fill={THEME.textSecondary} fontSize="11">
                    130
                  </text>

                  {/* Sector points */}
                  {data.sectors.map((sector) => (
                    <g key={sector.name}>
                      <circle
                        cx={getPlotX(sector.rsRatio)}
                        cy={getPlotY(sector.rsMomentum)}
                        r={hoveredSector === sector.name ? 10 : 8}
                        fill={sector.color}
                        opacity={hoveredSector === sector.name ? 1 : 0.8}
                        style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={(e) => handleSvgHover(sector, e)}
                        onMouseLeave={() => {
                          setHoveredSector(null);
                          setTooltip(null);
                        }}
                      />
                      <text
                        x={getPlotX(sector.rsRatio)}
                        y={getPlotY(sector.rsMomentum) + 18}
                        textAnchor="middle"
                        fill={THEME.textPrimary}
                        fontSize="12"
                        fontWeight="600"
                        pointerEvents="none"
                      >
                        {sector.name}
                      </text>
                    </g>
                  ))}

                  {/* Tooltip */}
                  {tooltip && (
                    <g>
                      <rect
                        x={tooltip.x + 10}
                        y={tooltip.y - 60}
                        width={160}
                        height={55}
                        fill={THEME.card}
                        stroke={THEME.border}
                        strokeWidth={1}
                        rx={6}
                      />
                      <text x={tooltip.x + 20} y={tooltip.y - 40} fill={tooltip.sector.color} fontSize="13" fontWeight="600">
                        {tooltip.sector.name}
                      </text>
                      <text x={tooltip.x + 20} y={tooltip.y - 25} fill={THEME.textSecondary} fontSize="11">
                        RS-Ratio: {tooltip.sector.rsRatio.toFixed(1)}
                      </text>
                      <text x={tooltip.x + 20} y={tooltip.y - 12} fill={THEME.textSecondary} fontSize="11">
                        RS-Mom: {tooltip.sector.rsMomentum.toFixed(1)}
                      </text>
                    </g>
                  )}
                </svg>
              </div>

              {/* Chart info */}
              <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${THEME.border}`, fontSize: '12px', color: THEME.textSecondary }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>X-Axis</div>
                    <div style={{ color: THEME.textPrimary, fontWeight: '600' }}>RS-Ratio (Relative Strength)</div>
                  </div>
                  <div>
                    <div style={{ color: THEME.textSecondary, fontSize: '11px', marginBottom: '4px' }}>Y-Axis</div>
                    <div style={{ color: THEME.textPrimary, fontWeight: '600' }}>RS-Momentum (Rate of Change)</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Benchmark */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', padding: '16px' }}>
                <h3 style={{ color: THEME.textSecondary, fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '12px', margin: '0 0 12px 0' }}>
                  Benchmark
                </h3>
                <div>
                  <div style={{ color: THEME.textPrimary, fontSize: '18px', fontWeight: '700', marginBottom: '4px' }}>
                    {data.benchmark.symbol}
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: data.benchmark.changePercent > 0 ? THEME.green : THEME.red, marginBottom: '8px' }}>
                    {data.benchmark.price.toLocaleString()}
                  </div>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      background: data.benchmark.changePercent > 0 ? `${THEME.green}22` : `${THEME.red}22`,
                      color: data.benchmark.changePercent > 0 ? THEME.green : THEME.red,
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600',
                    }}
                  >
                    {data.benchmark.changePercent > 0 ? '+' : ''}
                    {data.benchmark.changePercent.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Quadrants */}
              {(['Leading', 'Weakening', 'Lagging', 'Improving'] as const).map((quadrant) => {
                const sectors = getQuadrantSectors(quadrant);
                const quadrantInfo = QUADRANT_INFO[quadrant];
                return (
                  <div
                    key={quadrant}
                    style={{
                      background: THEME.card,
                      border: `1px solid ${THEME.border}`,
                      borderRadius: '12px',
                      padding: '16px',
                      opacity: sectors.length === 0 ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                      <div
                        style={{
                          width: '4px',
                          height: '4px',
                          background: quadrantInfo.border,
                          borderRadius: '50%',
                        }}
                      />
                      <h3 style={{ color: THEME.textPrimary, fontSize: '12px', fontWeight: '600', margin: 0 }}>
                        {quadrant}
                      </h3>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {sectors.length === 0 ? (
                        <div style={{ color: THEME.textSecondary, fontSize: '12px' }}>No sectors</div>
                      ) : (
                        sectors.map((sector) => (
                          <div
                            key={sector.name}
                            style={{
                              padding: '8px',
                              background: THEME.background,
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              border: hoveredSector === sector.name ? `1px solid ${sector.color}` : `1px solid transparent`,
                            }}
                            onMouseEnter={() => setHoveredSector(sector.name)}
                            onMouseLeave={() => setHoveredSector(null)}
                          >
                            <div
                              style={{
                                width: '6px',
                                height: '6px',
                                background: sector.color,
                                borderRadius: '50%',
                                flexShrink: 0,
                              }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: THEME.textPrimary, fontSize: '12px', fontWeight: '600' }}>
                                {sector.name}
                              </div>
                              <div style={{ color: THEME.textSecondary, fontSize: '10px' }}>
                                {sector.rsRatio.toFixed(1)} / {sector.rsMomentum.toFixed(1)}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
