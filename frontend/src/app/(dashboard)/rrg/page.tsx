'use client';

import { useState } from 'react';
import { ChevronDown, Play } from 'lucide-react';

interface SectorData {
  id: string;
  name: string;
  rsRatio: number;
  rsMomentum: number;
  color: string;
  quadrant: 'leading' | 'weakening' | 'lagging' | 'improving';
  previousQuadrant?: 'leading' | 'weakening' | 'lagging' | 'improving';
  tail?: { dx: number; dy: number };
}

const SAMPLE_SECTORS: SectorData[] = [
  {
    id: 'defence',
    name: 'Defence',
    rsRatio: 115,
    rsMomentum: 120,
    color: '#10B981',
    quadrant: 'leading',
    previousQuadrant: 'improving',
    tail: { dx: -8, dy: -12 },
  },
  {
    id: 'capital-mkts',
    name: 'Capital Mkts',
    rsRatio: 105,
    rsMomentum: 95,
    color: '#F59E0B',
    quadrant: 'weakening',
    previousQuadrant: 'leading',
    tail: { dx: 5, dy: -8 },
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    rsRatio: 92,
    rsMomentum: 88,
    color: '#EF4444',
    quadrant: 'lagging',
    previousQuadrant: 'weakening',
    tail: { dx: 3, dy: -5 },
  },
  {
    id: 'digital',
    name: 'Digital',
    rsRatio: 110,
    rsMomentum: 115,
    color: '#10B981',
    quadrant: 'leading',
    previousQuadrant: 'leading',
    tail: { dx: 2, dy: 3 },
  },
  {
    id: 'tourism',
    name: 'Tourism',
    rsRatio: 88,
    rsMomentum: 105,
    color: '#3B82F6',
    quadrant: 'improving',
    previousQuadrant: 'lagging',
    tail: { dx: -5, dy: 8 },
  },
  {
    id: 'ev-auto',
    name: 'EV & Auto',
    rsRatio: 120,
    rsMomentum: 125,
    color: '#10B981',
    quadrant: 'leading',
    previousQuadrant: 'improving',
    tail: { dx: -3, dy: 4 },
  },
  {
    id: 'mnc',
    name: 'MNC',
    rsRatio: 98,
    rsMomentum: 92,
    color: '#EF4444',
    quadrant: 'lagging',
    previousQuadrant: 'lagging',
    tail: { dx: -1, dy: -2 },
  },
  {
    id: 'consumption',
    name: 'Consumption',
    rsRatio: 102,
    rsMomentum: 108,
    color: '#10B981',
    quadrant: 'leading',
    previousQuadrant: 'improving',
    tail: { dx: -4, dy: 6 },
  },
  {
    id: 'cpse',
    name: 'CPSE',
    rsRatio: 85,
    rsMomentum: 110,
    color: '#3B82F6',
    quadrant: 'improving',
    previousQuadrant: 'lagging',
    tail: { dx: -8, dy: 10 },
  },
  {
    id: 'pse',
    name: 'PSE',
    rsRatio: 95,
    rsMomentum: 87,
    color: '#F59E0B',
    quadrant: 'weakening',
    previousQuadrant: 'improving',
    tail: { dx: 6, dy: -8 },
  },
];

interface Tooltip {
  x: number;
  y: number;
  name: string;
  rsRatio: number;
  rsMomentum: number;
  visible: boolean;
}

export default function RRGPage() {
  const [market, setMarket] = useState<'india' | 'global'>('india');
  const [preset, setPreset] = useState('nifty-thematic');
  const [timeframe, setTimeframe] = useState('6m');
  const [isAnimating, setIsAnimating] = useState(false);
  const [tooltip, setTooltip] = useState<Tooltip>({
    x: 0,
    y: 0,
    name: '',
    rsRatio: 0,
    rsMomentum: 0,
    visible: false,
  });

  const chartWidth = 600;
  const chartHeight = 600;
  const padding = 60;
  const centerX = padding + (chartWidth - 2 * padding) / 2;
  const centerY = padding + (chartHeight - 2 * padding) / 2;
  const plotWidth = chartWidth - 2 * padding;
  const plotHeight = chartHeight - 2 * padding;

  const scaleRatio = (value: number) => {
    return padding + ((value - 50) / 50) * (plotWidth / 2);
  };

  const scaleMomentum = (value: number) => {
    return chartHeight - padding - ((value - 50) / 50) * (plotHeight / 2);
  };

  const handleDotHover = (
    sector: SectorData,
    mouseX: number,
    mouseY: number
  ) => {
    const x = scaleRatio(sector.rsRatio);
    const y = scaleMomentum(sector.rsMomentum);

    setTooltip({
      x: mouseX,
      y: mouseY,
      name: sector.name,
      rsRatio: sector.rsRatio,
      rsMomentum: sector.rsMomentum,
      visible: true,
    });
  };

  const handleDotLeave = () => {
    setTooltip({ ...tooltip, visible: false });
  };

  const getQuadrantTransitions = () => {
    return SAMPLE_SECTORS
      .filter((s) => s.previousQuadrant && s.previousQuadrant !== s.quadrant)
      .map((s) => ({
        name: s.name,
        from: s.previousQuadrant!,
        to: s.quadrant,
      }));
  };

  const quadrantLabels = {
    leading: 'Leading',
    weakening: 'Weakening',
    lagging: 'Lagging',
    improving: 'Improving',
  };

  const quadrantColors = {
    leading: '#10B981',
    weakening: '#F59E0B',
    lagging: '#EF4444',
    improving: '#3B82F6',
  };

  return (
    <div
      style={{
        backgroundColor: '#0A0E1A',
        color: '#F5F7FA',
        minHeight: '100vh',
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>
            Relative Rotation Graph
          </h1>
          <p style={{ color: '#8A95A3', fontSize: '14px' }}>
            Visualize sector momentum and relative strength rotation
          </p>
        </div>

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '24px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {/* Market Toggle */}
          <div
            style={{
              display: 'flex',
              backgroundColor: '#111B35',
              borderRadius: '8px',
              padding: '4px',
              border: '1px solid #1A2840',
            }}
          >
            {['india', 'global'].map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m as 'india' | 'global')}
                style={{
                  padding: '8px 16px',
                  backgroundColor:
                    market === m ? '#1A2840' : 'transparent',
                  color: '#F5F7FA',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'all 0.2s',
                  textTransform: 'capitalize',
                }}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Preset Dropdown */}
          <div style={{ position: 'relative' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#111B35',
                border: '1px solid #1A2840',
                borderRadius: '8px',
                padding: '8px 12px',
                cursor: 'pointer',
                minWidth: '220px',
              }}
            >
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                style={{
                  backgroundColor: 'transparent',
                  color: '#F5F7FA',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  flex: 1,
                  outline: 'none',
                }}
              >
                <option value="nifty-thematic">Nifty Thematic Indices</option>
                <option value="nifty-sectoral">Nifty Sectoral</option>
                <option value="sp500">S&P 500 Sectors</option>
              </select>
              <ChevronDown size={16} color="#8A95A3" />
            </div>
          </div>

          {/* Timeframe Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {['1m', '3m', '6m', '1y'].map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                style={{
                  padding: '8px 12px',
                  backgroundColor:
                    timeframe === tf ? '#1A2840' : '#111B35',
                  color: '#F5F7FA',
                  border: '1px solid #1A2840',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  transition: 'all 0.2s',
                }}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Animate Button */}
          <button
            onClick={() => setIsAnimating(!isAnimating)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: isAnimating ? '#10B981' : '#111B35',
              color: '#F5F7FA',
              border: '1px solid #1A2840',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'all 0.2s',
            }}
          >
            <Play size={16} />
            Animate
          </button>
        </div>

        {/* Main Content */}
        <div style={{ display: 'flex', gap: '24px' }}>
          {/* Chart Area */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#111B35',
              border: '1px solid #1A2840',
              borderRadius: '12px',
              padding: '24px',
              position: 'relative',
            }}
          >
            <svg
              width={chartWidth}
              height={chartHeight}
              style={{ display: 'block' }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                // Update tooltip position
              }}
            >
              {/* Grid Background */}
              <rect
                x={padding}
                y={padding}
                width={plotWidth}
                height={plotHeight}
                fill="#0A0E1A"
                stroke="#1A2840"
                strokeWidth={1}
              />

              {/* Quadrant Backgrounds */}
              {/* Leading (top-right, green) */}
              <rect
                x={centerX}
                y={padding}
                width={(plotWidth / 2)}
                height={(plotHeight / 2)}
                fill="#10B981"
                opacity={0.05}
              />

              {/* Improving (top-left, blue) */}
              <rect
                x={padding}
                y={padding}
                width={(plotWidth / 2)}
                height={(plotHeight / 2)}
                fill="#3B82F6"
                opacity={0.05}
              />

              {/* Lagging (bottom-left, red) */}
              <rect
                x={padding}
                y={centerY}
                width={(plotWidth / 2)}
                height={(plotHeight / 2)}
                fill="#EF4444"
                opacity={0.05}
              />

              {/* Weakening (bottom-right, yellow) */}
              <rect
                x={centerX}
                y={centerY}
                width={(plotWidth / 2)}
                height={(plotHeight / 2)}
                fill="#F59E0B"
                opacity={0.05}
              />

              {/* Axes */}
              {/* X-axis (RS-Ratio) */}
              <line
                x1={padding}
                y1={centerY}
                x2={chartWidth - padding}
                y2={centerY}
                stroke="#1A2840"
                strokeWidth={2}
              />

              {/* Y-axis (RS-Momentum) */}
              <line
                x1={centerX}
                y1={padding}
                x2={centerX}
                y2={chartHeight - padding}
                stroke="#1A2840"
                strokeWidth={2}
              />

              {/* Axis Labels and Ticks */}
              {/* X-axis labels */}
              <text
                x={padding}
                y={centerY + 24}
                fontSize="12"
                fill="#8A95A3"
                textAnchor="middle"
              >
                50
              </text>
              <text
                x={centerX}
                y={centerY + 24}
                fontSize="12"
                fill="#8A95A3"
                textAnchor="middle"
              >
                100
              </text>
              <text
                x={chartWidth - padding}
                y={centerY + 24}
                fontSize="12"
                fill="#8A95A3"
                textAnchor="middle"
              >
                150
              </text>

              {/* Y-axis labels */}
              <text
                x={centerX - 12}
                y={chartHeight - padding + 4}
                fontSize="12"
                fill="#8A95A3"
                textAnchor="end"
              >
                50
              </text>
              <text
                x={centerX - 12}
                y={centerY + 4}
                fontSize="12"
                fill="#8A95A3"
                textAnchor="end"
              >
                100
              </text>
              <text
                x={centerX - 12}
                y={padding + 4}
                fontSize="12"
                fill="#8A95A3"
                textAnchor="end"
              >
                150
              </text>

              {/* Axis titles */}
              <text
                x={chartWidth - padding + 8}
                y={centerY - 8}
                fontSize="12"
                fill="#8A95A3"
                fontWeight="500"
              >
                JdK RS-Ratio
              </text>
              <text
                x={centerX - 12}
                y={padding - 8}
                fontSize="12"
                fill="#8A95A3"
                fontWeight="500"
                textAnchor="end"
              >
                JdK RS-Momentum
              </text>

              {/* Center point */}
              <circle cx={centerX} cy={centerY} r={4} fill="#3B82F6" opacity={0.3} />

              {/* Tail lines and dots */}
              {SAMPLE_SECTORS.map((sector) => {
                const x = scaleRatio(sector.rsRatio);
                const y = scaleMomentum(sector.rsMomentum);
                const tailStartX = x - (sector.tail?.dx || 0);
                const tailStartY = y - (sector.tail?.dy || 0);

                return (
                  <g key={sector.id}>
                    {/* Tail line */}
                    {sector.tail && (
                      <line
                        x1={tailStartX}
                        y1={tailStartY}
                        x2={x}
                        y2={y}
                        stroke={sector.color}
                        strokeWidth={2}
                        opacity={0.4}
                        strokeLinecap="round"
                      />
                    )}

                    {/* Dot */}
                    <circle
                      cx={x}
                      cy={y}
                      r={7}
                      fill={sector.color}
                      opacity={0.9}
                      cursor="pointer"
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                        const clientX = e.clientX;
                        const clientY = e.clientY;
                        handleDotHover(sector, clientX - rect.left, clientY - rect.top);
                      }}
                      onMouseLeave={handleDotLeave}
                      style={{
                        transition: 'r 0.2s',
                      }}
                    />
                  </g>
                );
              })}

              {/* Tooltip */}
              {tooltip.visible && (
                <g>
                  <rect
                    x={tooltip.x + 8}
                    y={tooltip.y - 60}
                    width={160}
                    height={50}
                    rx={6}
                    fill="#1A2840"
                    stroke="#3B82F6"
                    strokeWidth={1}
                  />
                  <text
                    x={tooltip.x + 16}
                    y={tooltip.y - 42}
                    fontSize="12"
                    fill="#F5F7FA"
                    fontWeight="600"
                  >
                    {tooltip.name}
                  </text>
                  <text
                    x={tooltip.x + 16}
                    y={tooltip.y - 26}
                    fontSize="11"
                    fill="#8A95A3"
                  >
                    RS-Ratio: {tooltip.rsRatio.toFixed(1)}
                  </text>
                  <text
                    x={tooltip.x + 16}
                    y={tooltip.y - 14}
                    fontSize="11"
                    fill="#8A95A3"
                  >
                    RS-Momentum: {tooltip.rsMomentum.toFixed(1)}
                  </text>
                </g>
              )}
            </svg>

            {/* Quadrant Labels */}
            <div
              style={{
                position: 'absolute',
                top: '40px',
                right: '40px',
                fontSize: '12px',
                fontWeight: '600',
                color: '#10B981',
              }}
            >
              Leading
            </div>
            <div
              style={{
                position: 'absolute',
                top: '40px',
                left: '40px',
                fontSize: '12px',
                fontWeight: '600',
                color: '#3B82F6',
              }}
            >
              Improving
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: '40px',
                right: '40px',
                fontSize: '12px',
                fontWeight: '600',
                color: '#F59E0B',
              }}
            >
              Weakening
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: '40px',
                left: '40px',
                fontSize: '12px',
                fontWeight: '600',
                color: '#EF4444',
              }}
            >
              Lagging
            </div>
          </div>

          {/* Right Sidebar */}
          <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Tickers List */}
            <div
              style={{
                backgroundColor: '#111B35',
                border: '1px solid #1A2840',
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
                Sectors
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {SAMPLE_SECTORS.map((sector) => (
                  <div
                    key={sector.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        '#0A0E1A';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        'transparent';
                    }}
                  >
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: sector.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: '13px', flex: 1 }}>
                      {sector.name}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: '#8A95A3',
                      }}
                    >
                      {sector.rsRatio}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Transitions Section */}
            <div
              style={{
                backgroundColor: '#111B35',
                border: '1px solid #1A2840',
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
                Transitions
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {getQuadrantTransitions().length > 0 ? (
                  getQuadrantTransitions().map((transition, idx) => (
                    <div
                      key={idx}
                      style={{
                        fontSize: '12px',
                        padding: '8px 10px',
                        backgroundColor: '#0A0E1A',
                        borderRadius: '6px',
                        color: '#F5F7FA',
                      }}
                    >
                      <span style={{ fontWeight: '600' }}>
                        {transition.name}:
                      </span>{' '}
                      <span style={{ color: quadrantColors[transition.from] }}>
                        {quadrantLabels[transition.from]}
                      </span>
                      {' → '}
                      <span style={{ color: quadrantColors[transition.to] }}>
                        {quadrantLabels[transition.to]}
                      </span>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: '12px', color: '#8A95A3' }}>
                    No sector transitions
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
