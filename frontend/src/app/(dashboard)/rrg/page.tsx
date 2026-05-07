'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Activity, Loader } from 'lucide-react';

interface TrailPoint {
  x: number;
  y: number;
}

interface Sector {
  name: string;
  color: string;
  rsRatio: number;
  rsMomentum: number;
  quadrant: 'Leading' | 'Weakening' | 'Lagging' | 'Improving';
  changePercent: number;
  trail?: TrailPoint[];
}

interface Benchmark {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
}

interface RRGData {
  sectors: Sector[];
  benchmark: Benchmark;
  market: string;
  timeframe: string;
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
  yellow: '#F59E0B',
  blue: '#0F7ABF',
};

const QUADRANT_COLORS = {
  Leading: { bg: '#10B98118', border: '#10B981', label: 'Leading', description: 'Strong & gaining' },
  Weakening: { bg: '#F59E0B18', border: '#F59E0B', label: 'Weakening', description: 'Strong but slowing' },
  Lagging: { bg: '#EF444418', border: '#EF4444', label: 'Lagging', description: 'Weak & losing' },
  Improving: { bg: '#0F7ABF18', border: '#0F7ABF', label: 'Improving', description: 'Weak but gaining' },
};

export default function RRGPage() {
  const [market, setMarket] = useState<'india' | 'global'>('india');
  const [timeframe, setTimeframe] = useState<'1m' | '3m' | '6m' | '1y'>('3m');
  const [data, setData] = useState<RRGData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; sector: Sector } | null>(null);
  const [showTrails, setShowTrails] = useState(true);
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

  // Auto-scale the chart to fit data with padding
  const { minX, maxX, minY, maxY } = useMemo(() => {
    if (!data?.sectors.length) return { minX: 95, maxX: 105, minY: 95, maxY: 105 };

    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;

    for (const s of data.sectors) {
      mnX = Math.min(mnX, s.rsRatio);
      mxX = Math.max(mxX, s.rsRatio);
      mnY = Math.min(mnY, s.rsMomentum);
      mxY = Math.max(mxY, s.rsMomentum);

      // Include trail points in bounds
      if (s.trail) {
        for (const p of s.trail) {
          mnX = Math.min(mnX, p.x);
          mxX = Math.max(mxX, p.x);
          mnY = Math.min(mnY, p.y);
          mxY = Math.max(mxY, p.y);
        }
      }
    }

    // Ensure 100 is always visible (center point)
    mnX = Math.min(mnX, 99);
    mxX = Math.max(mxX, 101);
    mnY = Math.min(mnY, 99);
    mxY = Math.max(mxY, 101);

    // Add 15% padding
    const padX = Math.max((mxX - mnX) * 0.15, 0.5);
    const padY = Math.max((mxY - mnY) * 0.15, 0.5);

    // Make symmetrical around 100 for better visual balance
    const extentX = Math.max(mxX - 100, 100 - mnX) + padX;
    const extentY = Math.max(mxY - 100, 100 - mnY) + padY;

    return {
      minX: parseFloat((100 - extentX).toFixed(1)),
      maxX: parseFloat((100 + extentX).toFixed(1)),
      minY: parseFloat((100 - extentY).toFixed(1)),
      maxY: parseFloat((100 + extentY).toFixed(1)),
    };
  }, [data]);

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

  const chartWidth = 560;
  const chartHeight = 560;
  const padding = 50;
  const plotWidth = chartWidth - 2 * padding;
  const plotHeight = chartHeight - 2 * padding;

  const getPlotX = (rsRatio: number) => padding + ((rsRatio - minX) / (maxX - minX)) * plotWidth;
  const getPlotY = (rsMomentum: number) => padding + plotHeight - ((rsMomentum - minY) / (maxY - minY)) * plotHeight;

  // Grid lines
  const gridLinesX = useMemo(() => {
    const lines: number[] = [];
    const step = (maxX - minX) / 6;
    for (let v = minX; v <= maxX; v += step) {
      lines.push(parseFloat(v.toFixed(1)));
    }
    return lines;
  }, [minX, maxX]);

  const gridLinesY = useMemo(() => {
    const lines: number[] = [];
    const step = (maxY - minY) / 6;
    for (let v = minY; v <= maxY; v += step) {
      lines.push(parseFloat(v.toFixed(1)));
    }
    return lines;
  }, [minY, maxY]);

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
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Market Toggle */}
            <div style={{ display: 'flex', gap: '4px', background: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
              {(['india', 'global'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMarket(m)}
                  style={{
                    padding: '8px 16px',
                    background: market === m ? THEME.accent : 'transparent',
                    color: market === m ? '#fff' : THEME.textSecondary,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                >
                  {m === 'global' ? 'Global (US)' : 'India'}
                </button>
              ))}
            </div>

            {/* Timeframe Buttons */}
            <div style={{ display: 'flex', gap: '4px', background: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
              {(['1m', '3m', '6m', '1y'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  style={{
                    padding: '8px 14px',
                    background: timeframe === tf ? THEME.accent : 'transparent',
                    color: timeframe === tf ? '#fff' : THEME.textSecondary,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                >
                  {tf === '1m' ? '1M' : tf === '3m' ? '3M' : tf === '6m' ? '6M' : '1Y'}
                </button>
              ))}
            </div>

            {/* Trails toggle */}
            <button
              onClick={() => setShowTrails(!showTrails)}
              style={{
                padding: '8px 14px',
                background: showTrails ? `${THEME.accent}33` : THEME.card,
                color: showTrails ? THEME.accent : THEME.textSecondary,
                border: `1px solid ${showTrails ? THEME.accent : THEME.border}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '600',
              }}
            >
              Trails {showTrails ? 'ON' : 'OFF'}
            </button>

            {/* Source & Live indicator */}
            {data && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '11px', color: THEME.textSecondary }}>{data.source}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: `${THEME.green}22`, padding: '4px 10px', borderRadius: '4px', color: THEME.green, fontSize: '12px', fontWeight: '600' }}>
                  <span style={{ width: '6px', height: '6px', background: THEME.green, borderRadius: '50%', animation: 'pulse 2s infinite' }}></span>
                  Live
                </span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: '16px', background: `${THEME.red}22`, border: `1px solid ${THEME.red}`, borderRadius: '8px', color: THEME.red, marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <span>⚠ {error} — check that the backend is running or try again.</span>
            <button onClick={fetchData} style={{ padding: '6px 14px', borderRadius: '6px', border: `1px solid ${THEME.red}`, backgroundColor: `${THEME.red}18`, color: THEME.red, cursor: 'pointer', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>
              ↻ Retry
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
            <Loader size={40} color={THEME.accent} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : data ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px' }}>
            {/* RRG Chart */}
            <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ color: THEME.textPrimary, fontSize: '16px', fontWeight: '600', margin: 0 }}>
                  Sector Rotation Map
                </h2>
                <div style={{ fontSize: '11px', color: THEME.textSecondary }}>
                  Range: {minX.toFixed(1)} - {maxX.toFixed(1)}
                </div>
              </div>

              <div style={{ overflowX: 'auto', display: 'flex', justifyContent: 'center', WebkitOverflowScrolling: 'touch' }}>
                <svg
                  ref={svgRef}
                  width={chartWidth}
                  height={chartHeight}
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  style={{ background: 'transparent', maxWidth: '100%', height: 'auto', minWidth: '320px' }}
                >
                  {/* Quadrant backgrounds */}
                  <rect x={getPlotX(100)} y={padding} width={getPlotX(maxX) - getPlotX(100)} height={getPlotY(100) - padding} fill={QUADRANT_COLORS.Leading.bg} />
                  <rect x={padding} y={padding} width={getPlotX(100) - padding} height={getPlotY(100) - padding} fill={QUADRANT_COLORS.Improving.bg} />
                  <rect x={padding} y={getPlotY(100)} width={getPlotX(100) - padding} height={padding + plotHeight - getPlotY(100)} fill={QUADRANT_COLORS.Lagging.bg} />
                  <rect x={getPlotX(100)} y={getPlotY(100)} width={getPlotX(maxX) - getPlotX(100)} height={padding + plotHeight - getPlotY(100)} fill={QUADRANT_COLORS.Weakening.bg} />

                  {/* Grid lines */}
                  {gridLinesX.map((v, i) => (
                    <line key={`gx-${i}`} x1={getPlotX(v)} y1={padding} x2={getPlotX(v)} y2={padding + plotHeight} stroke={THEME.border} strokeWidth={0.5} opacity={0.3} />
                  ))}
                  {gridLinesY.map((v, i) => (
                    <line key={`gy-${i}`} x1={padding} y1={getPlotY(v)} x2={padding + plotWidth} y2={getPlotY(v)} stroke={THEME.border} strokeWidth={0.5} opacity={0.3} />
                  ))}

                  {/* Center crosshair at 100,100 */}
                  <line x1={getPlotX(100)} y1={padding} x2={getPlotX(100)} y2={padding + plotHeight} stroke={THEME.textSecondary} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.5} />
                  <line x1={padding} y1={getPlotY(100)} x2={padding + plotWidth} y2={getPlotY(100)} stroke={THEME.textSecondary} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.5} />

                  {/* Axis labels */}
                  <text x={padding + plotWidth / 2} y={chartHeight - 8} textAnchor="middle" fill={THEME.textSecondary} fontSize="11" fontWeight="600">
                    JdK RS-Ratio →
                  </text>
                  <text x={12} y={padding + plotHeight / 2} textAnchor="middle" fill={THEME.textSecondary} fontSize="11" fontWeight="600" transform={`rotate(-90, 12, ${padding + plotHeight / 2})`}>
                    JdK RS-Momentum →
                  </text>

                  {/* Scale labels on axes */}
                  <text x={getPlotX(minX)} y={padding + plotHeight + 16} textAnchor="middle" fill={THEME.textSecondary} fontSize="10">{minX.toFixed(1)}</text>
                  <text x={getPlotX(100)} y={padding + plotHeight + 16} textAnchor="middle" fill={THEME.textSecondary} fontSize="10" fontWeight="600">100</text>
                  <text x={getPlotX(maxX)} y={padding + plotHeight + 16} textAnchor="middle" fill={THEME.textSecondary} fontSize="10">{maxX.toFixed(1)}</text>
                  <text x={padding - 8} y={getPlotY(minY) + 4} textAnchor="end" fill={THEME.textSecondary} fontSize="10">{minY.toFixed(1)}</text>
                  <text x={padding - 8} y={getPlotY(100) + 4} textAnchor="end" fill={THEME.textSecondary} fontSize="10" fontWeight="600">100</text>
                  <text x={padding - 8} y={getPlotY(maxY) + 4} textAnchor="end" fill={THEME.textSecondary} fontSize="10">{maxY.toFixed(1)}</text>

                  {/* Quadrant labels */}
                  <text x={getPlotX(100) + (getPlotX(maxX) - getPlotX(100)) / 2} y={padding + 18} textAnchor="middle" fill={THEME.green} fontSize="11" fontWeight="700" opacity={0.7}>
                    LEADING
                  </text>
                  <text x={padding + (getPlotX(100) - padding) / 2} y={padding + 18} textAnchor="middle" fill={THEME.blue} fontSize="11" fontWeight="700" opacity={0.7}>
                    IMPROVING
                  </text>
                  <text x={padding + (getPlotX(100) - padding) / 2} y={padding + plotHeight - 8} textAnchor="middle" fill={THEME.red} fontSize="11" fontWeight="700" opacity={0.7}>
                    LAGGING
                  </text>
                  <text x={getPlotX(100) + (getPlotX(maxX) - getPlotX(100)) / 2} y={padding + plotHeight - 8} textAnchor="middle" fill={THEME.yellow} fontSize="11" fontWeight="700" opacity={0.7}>
                    WEAKENING
                  </text>

                  {/* Sector trails */}
                  {showTrails && data.sectors.map((sector) => {
                    if (!sector.trail || sector.trail.length < 2) return null;
                    const points = sector.trail.map(p => `${getPlotX(p.x)},${getPlotY(p.y)}`).join(' ');
                    return (
                      <g key={`trail-${sector.name}`}>
                        <polyline
                          points={points}
                          fill="none"
                          stroke={sector.color}
                          strokeWidth={hoveredSector === sector.name ? 2.5 : 1.5}
                          opacity={hoveredSector === sector.name ? 0.9 : 0.4}
                          strokeLinejoin="round"
                        />
                        {/* Trail dots */}
                        {sector.trail.map((p, i) => (
                          <circle
                            key={`td-${sector.name}-${i}`}
                            cx={getPlotX(p.x)}
                            cy={getPlotY(p.y)}
                            r={i === sector.trail!.length - 1 ? 0 : 2}
                            fill={sector.color}
                            opacity={0.3 + (i / sector.trail!.length) * 0.5}
                          />
                        ))}
                        {/* Arrowhead on last segment */}
                        {sector.trail.length >= 2 && (() => {
                          const last = sector.trail![sector.trail!.length - 1];
                          const prev = sector.trail![sector.trail!.length - 2];
                          const dx = getPlotX(last.x) - getPlotX(prev.x);
                          const dy = getPlotY(last.y) - getPlotY(prev.y);
                          const len = Math.sqrt(dx * dx + dy * dy);
                          if (len < 2) return null;
                          const nx = dx / len;
                          const ny = dy / len;
                          const ax = getPlotX(last.x) - nx * 2;
                          const ay = getPlotY(last.y) - ny * 2;
                          return (
                            <polygon
                              points={`${ax + ny * 4},${ay - nx * 4} ${getPlotX(last.x)},${getPlotY(last.y)} ${ax - ny * 4},${ay + nx * 4}`}
                              fill={sector.color}
                              opacity={0.6}
                            />
                          );
                        })()}
                      </g>
                    );
                  })}

                  {/* Sector points */}
                  {data.sectors.map((sector) => {
                    const isHovered = hoveredSector === sector.name;
                    const cx = getPlotX(sector.rsRatio);
                    const cy = getPlotY(sector.rsMomentum);
                    return (
                      <g key={sector.name}>
                        {/* Glow effect on hover */}
                        {isHovered && (
                          <circle cx={cx} cy={cy} r={16} fill={sector.color} opacity={0.15} />
                        )}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isHovered ? 9 : 7}
                          fill={sector.color}
                          stroke="#fff"
                          strokeWidth={isHovered ? 2 : 1}
                          opacity={isHovered ? 1 : 0.85}
                          style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                          onMouseEnter={(e) => handleSvgHover(sector, e)}
                          onMouseLeave={() => {
                            setHoveredSector(null);
                            setTooltip(null);
                          }}
                        />
                        <text
                          x={cx}
                          y={cy - 12}
                          textAnchor="middle"
                          fill={THEME.textPrimary}
                          fontSize="10"
                          fontWeight="600"
                          pointerEvents="none"
                          opacity={isHovered ? 1 : 0.8}
                        >
                          {sector.name}
                        </text>
                      </g>
                    );
                  })}

                  {/* Tooltip */}
                  {tooltip && (() => {
                    const tw = 180;
                    const th = 75;
                    let tx = tooltip.x + 15;
                    let ty = tooltip.y - th - 10;
                    if (tx + tw > chartWidth) tx = tooltip.x - tw - 15;
                    if (ty < 0) ty = tooltip.y + 15;
                    return (
                      <g>
                        <rect x={tx} y={ty} width={tw} height={th} fill={THEME.card} stroke={tooltip.sector.color} strokeWidth={1} rx={8} filter="url(#shadow)" />
                        <text x={tx + 12} y={ty + 20} fill={tooltip.sector.color} fontSize="13" fontWeight="700">{tooltip.sector.name}</text>
                        <text x={tx + 12} y={ty + 38} fill={THEME.textSecondary} fontSize="11">
                          RS-Ratio: <tspan fill={THEME.textPrimary} fontWeight="600">{tooltip.sector.rsRatio.toFixed(2)}</tspan>
                        </text>
                        <text x={tx + 12} y={ty + 54} fill={THEME.textSecondary} fontSize="11">
                          RS-Mom: <tspan fill={THEME.textPrimary} fontWeight="600">{tooltip.sector.rsMomentum.toFixed(2)}</tspan>
                        </text>
                        <text x={tx + 12} y={ty + 68} fill={tooltip.sector.changePercent >= 0 ? THEME.green : THEME.red} fontSize="10" fontWeight="600">
                          {tooltip.sector.changePercent >= 0 ? '+' : ''}{tooltip.sector.changePercent.toFixed(2)}% today
                        </text>
                      </g>
                    );
                  })()}

                  {/* Shadow filter */}
                  <defs>
                    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                      <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.3" />
                    </filter>
                  </defs>
                </svg>
              </div>

              {/* Chart info bar */}
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${THEME.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div style={{ fontSize: '11px' }}>
                    <span style={{ color: THEME.textSecondary }}>X: </span>
                    <span style={{ color: THEME.textPrimary, fontWeight: '600' }}>JdK RS-Ratio</span>
                    <span style={{ color: THEME.textSecondary }}> (relative strength)</span>
                  </div>
                  <div style={{ fontSize: '11px' }}>
                    <span style={{ color: THEME.textSecondary }}>Y: </span>
                    <span style={{ color: THEME.textPrimary, fontWeight: '600' }}>JdK RS-Momentum</span>
                    <span style={{ color: THEME.textSecondary }}> (rate of change)</span>
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: THEME.textSecondary }}>
                  {data.sectors.length} sectors
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Benchmark */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', padding: '16px' }}>
                <h3 style={{ color: THEME.textSecondary, fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', margin: '0 0 10px 0' }}>
                  Benchmark
                </h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: THEME.textPrimary, fontSize: '16px', fontWeight: '700' }}>
                    {data.benchmark.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '700', color: THEME.textPrimary }}>
                    {data.benchmark.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                  <span
                    style={{
                      padding: '3px 8px',
                      background: data.benchmark.changePercent >= 0 ? `${THEME.green}22` : `${THEME.red}22`,
                      color: data.benchmark.changePercent >= 0 ? THEME.green : THEME.red,
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '700',
                    }}
                  >
                    {data.benchmark.changePercent >= 0 ? '+' : ''}
                    {data.benchmark.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Quadrant summaries */}
              {(['Leading', 'Weakening', 'Lagging', 'Improving'] as const).map((quadrant) => {
                const sectors = getQuadrantSectors(quadrant);
                const qInfo = QUADRANT_COLORS[quadrant];
                return (
                  <div
                    key={quadrant}
                    style={{
                      background: THEME.card,
                      border: `1px solid ${THEME.border}`,
                      borderLeft: `3px solid ${qInfo.border}`,
                      borderRadius: '8px',
                      padding: '14px',
                      opacity: sectors.length === 0 ? 0.4 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h3 style={{ color: qInfo.border, fontSize: '12px', fontWeight: '700', margin: 0 }}>
                        {quadrant}
                      </h3>
                      <span style={{ color: THEME.textSecondary, fontSize: '10px' }}>{qInfo.description}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {sectors.length === 0 ? (
                        <div style={{ color: THEME.textSecondary, fontSize: '11px', fontStyle: 'italic' }}>No sectors</div>
                      ) : (
                        sectors.map((sector) => (
                          <div
                            key={sector.name}
                            style={{
                              padding: '6px 8px',
                              background: hoveredSector === sector.name ? `${sector.color}15` : THEME.background,
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                              border: hoveredSector === sector.name ? `1px solid ${sector.color}44` : `1px solid transparent`,
                            }}
                            onMouseEnter={() => setHoveredSector(sector.name)}
                            onMouseLeave={() => setHoveredSector(null)}
                          >
                            <div style={{ width: '8px', height: '8px', background: sector.color, borderRadius: '50%', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: THEME.textPrimary, fontSize: '12px', fontWeight: '600' }}>
                                {sector.name}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
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

              {/* Legend */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '8px', padding: '12px' }}>
                <h3 style={{ color: THEME.textSecondary, fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px 0' }}>
                  How to Read
                </h3>
                <div style={{ fontSize: '11px', color: THEME.textSecondary, lineHeight: '1.5' }}>
                  Sectors rotate clockwise: Improving → Leading → Weakening → Lagging. Trails show recent movement direction.
                </div>
              </div>
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
