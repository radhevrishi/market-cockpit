'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

interface Stock {
  ticker: string;
  company: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  previousClose: number;
}

interface ApiResponse {
  stocks: Stock[];
  gainers: Stock[];
  losers: Stock[];
  summary: {
    total: number;
    gainersCount: number;
    losersCount: number;
    avgChange: number;
    sectors: number;
  };
  updatedAt: string;
}

interface TreeNode {
  stock?: Stock;
  sector?: string;
  children?: TreeNode[];
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Squarified Treemap Algorithm ────────────────────────────────────────
function squarify(
  items: { value: number; data: any }[],
  x: number, y: number, w: number, h: number
): { x: number; y: number; w: number; h: number; data: any }[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ x, y, w, h, data: items[0].data }];
  }

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  if (totalValue <= 0) return [];

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const results: { x: number; y: number; w: number; h: number; data: any }[] = [];

  let remaining = [...sorted];
  let cx = x, cy = y, cw = w, ch = h;

  while (remaining.length > 0) {
    const remTotal = remaining.reduce((s, i) => s + i.value, 0);
    const isWide = cw >= ch;
    const side = isWide ? ch : cw;

    if (remaining.length === 1) {
      results.push({ x: cx, y: cy, w: cw, h: ch, data: remaining[0].data });
      break;
    }

    // Find best row
    let row: typeof remaining = [remaining[0]];
    let bestRatio = Infinity;

    for (let i = 1; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]];
      const rowSum = candidate.reduce((s, it) => s + it.value, 0);
      const rowFraction = rowSum / remTotal;
      const rowLength = isWide ? cw * rowFraction : ch * rowFraction;

      let worstRatio = 0;
      for (const item of candidate) {
        const itemFraction = item.value / rowSum;
        const itemW = isWide ? rowLength : side * itemFraction;
        const itemH = isWide ? side * itemFraction : rowLength;
        const ratio = Math.max(itemW / itemH, itemH / itemW);
        worstRatio = Math.max(worstRatio, ratio);
      }

      // Check previous row's ratio
      const prevRowSum = row.reduce((s, it) => s + it.value, 0);
      const prevFraction = prevRowSum / remTotal;
      const prevLength = isWide ? cw * prevFraction : ch * prevFraction;
      let prevWorst = 0;
      for (const item of row) {
        const itemFraction = item.value / prevRowSum;
        const itemW = isWide ? prevLength : side * itemFraction;
        const itemH = isWide ? side * itemFraction : prevLength;
        const ratio = Math.max(itemW / itemH, itemH / itemW);
        prevWorst = Math.max(prevWorst, ratio);
      }

      if (worstRatio <= prevWorst) {
        row = candidate;
        bestRatio = worstRatio;
      } else {
        break;
      }
    }

    // Layout the row
    const rowSum = row.reduce((s, it) => s + it.value, 0);
    const rowFraction = rowSum / remTotal;
    const rowLength = isWide ? cw * rowFraction : ch * rowFraction;

    let rx = cx, ry = cy;
    for (const item of row) {
      const itemFraction = item.value / rowSum;
      if (isWide) {
        const itemH = ch * itemFraction;
        results.push({ x: rx, y: ry, w: rowLength, h: itemH, data: item.data });
        ry += itemH;
      } else {
        const itemW = cw * itemFraction;
        results.push({ x: rx, y: ry, w: itemW, h: rowLength, data: item.data });
        rx += itemW;
      }
    }

    // Update remaining area
    if (isWide) {
      cx += rowLength;
      cw -= rowLength;
    } else {
      cy += rowLength;
      ch -= rowLength;
    }

    remaining = remaining.slice(row.length);
  }

  return results;
}

// ── Color Helpers ──────────────────────────────────────────────────────
function getChangeColor(pct: number): string {
  if (pct >= 4)  return '#00897B';
  if (pct >= 2)  return '#26A69A';
  if (pct >= 0.5) return '#4DB6AC';
  if (pct >= 0)  return '#263238';
  if (pct >= -0.5) return '#37474F';
  if (pct >= -2) return '#E57373';
  if (pct >= -4) return '#EF5350';
  return '#D32F2F';
}

function getTextColor(pct: number): string {
  if (Math.abs(pct) < 0.5) return '#90A4AE';
  return '#FFFFFF';
}

export default function HeatmapPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 1200, h: 700 });
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      setIsRefreshing(true);
      const response = await fetch('/api/market/quotes?market=india&index=smallcap150');
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const json = await response.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Responsive container
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ w: rect.width, h: Math.max(500, window.innerHeight - 260) });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loading]);

  // Build sector-grouped treemap data
  const treemapRects = useMemo((): { rects: { x: number; y: number; w: number; h: number; stock: Stock; sector: string }[]; sectorRects: { x: number; y: number; w: number; h: number; data: any }[] } | null => {
    if (!data || !data.stocks.length) return null;

    // Group by sector
    const sectorMap = new Map<string, Stock[]>();
    for (const s of data.stocks) {
      const arr = sectorMap.get(s.sector) || [];
      arr.push(s);
      sectorMap.set(s.sector, arr);
    }

    // Build sector items for outer treemap
    const sectorItems = [...sectorMap.entries()].map(([sector, stocks]) => ({
      value: stocks.reduce((s, st) => s + Math.max(st.marketCap, 1000), 0),
      data: { sector, stocks },
    }));

    // Layout sectors
    const { w, h } = containerSize;
    const sectorRects = squarify(sectorItems, 0, 0, w, h);

    // Now layout stocks within each sector
    const allRects: { x: number; y: number; w: number; h: number; stock: Stock; sector: string }[] = [];

    for (const sr of sectorRects) {
      const { sector, stocks } = sr.data;
      const pad = 1; // gap between sectors
      const stockItems = stocks.map((st: Stock) => ({
        value: Math.max(st.marketCap, 1000),
        data: st,
      }));

      const innerRects = squarify(
        stockItems,
        sr.x + pad, sr.y + pad,
        sr.w - pad * 2, sr.h - pad * 2
      );

      for (const ir of innerRects) {
        allRects.push({ ...ir, stock: ir.data, sector });
      }
    }

    return { rects: allRects, sectorRects };
  }, [data, containerSize]);

  const formatTime = (date: Date | null) => {
    if (!date) return '--:--';
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const hoveredStock = hoveredTicker && data ? data.stocks.find(s => s.ticker === hoveredTicker) : null;

  return (
    <div style={{ backgroundColor: '#0A0E1A', color: '#F5F7FA', minHeight: '100vh', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0, letterSpacing: '-0.3px' }}>
            Smallcap 150 Heatmap
          </h1>
          <span style={{ fontSize: '11px', color: '#4A5B6C', padding: '3px 8px', backgroundColor: '#111B35', borderRadius: '4px', border: '1px solid #1A2840' }}>
            NIFTY Smallcap 50 + 100
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {data && (
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#8A95A3' }}>
              <span>{data.summary.total} stocks</span>
              <span style={{ color: '#10B981' }}>{data.summary.gainersCount} up</span>
              <span style={{ color: '#EF4444' }}>{data.summary.losersCount} down</span>
            </div>
          )}
          <button
            onClick={fetchData}
            disabled={isRefreshing}
            style={{
              padding: '6px 12px', borderRadius: '6px', border: '1px solid #1A2840',
              backgroundColor: '#111B35', color: '#0F7ABF', cursor: isRefreshing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '500',
              opacity: isRefreshing ? 0.5 : 1, transition: 'all 0.2s',
            }}
          >
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#4A5B6C' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981', animation: 'pulse 2s ease infinite' }} />
            {formatTime(lastUpdated)}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '500px' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #1A2840', borderTop: '3px solid #0F7ABF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '14px', color: '#EF4444', fontSize: '13px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {/* Treemap */}
      {data && !loading && treemapRects !== null && (
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            width: '100%',
            height: `${containerSize.h}px`,
            backgroundColor: '#080C16',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #1A2840',
          }}
        >
          <svg
            width={containerSize.w}
            height={containerSize.h}
            viewBox={`0 0 ${containerSize.w} ${containerSize.h}`}
            style={{ display: 'block', width: '100%', height: '100%' }}
          >
            {/* Stock cells */}
            {treemapRects.rects.map((r: any) => {
              const isHovered = hoveredTicker === r.stock.ticker;
              const pct = r.stock.changePercent;
              const minDim = Math.min(r.w, r.h);
              const showTicker = minDim > 28;
              const showPct = minDim > 40;
              const fontSize = Math.min(12, Math.max(8, minDim / 5));

              return (
                <g key={r.stock.ticker}>
                  <rect
                    x={r.x + 0.5}
                    y={r.y + 0.5}
                    width={Math.max(0, r.w - 1)}
                    height={Math.max(0, r.h - 1)}
                    fill={getChangeColor(pct)}
                    opacity={isHovered ? 1 : 0.88}
                    rx={2}
                    style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                    onMouseEnter={() => setHoveredTicker(r.stock.ticker)}
                    onMouseLeave={() => setHoveredTicker(null)}
                  />
                  {showTicker && (
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + (showPct ? -fontSize * 0.35 : fontSize * 0.35)}
                      textAnchor="middle"
                      fill={getTextColor(pct)}
                      fontSize={fontSize}
                      fontWeight="700"
                      fontFamily="system-ui, -apple-system, sans-serif"
                      pointerEvents="none"
                    >
                      {r.stock.ticker}
                    </text>
                  )}
                  {showPct && (
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + fontSize * 0.9}
                      textAnchor="middle"
                      fill={getTextColor(pct)}
                      fontSize={fontSize * 0.85}
                      fontWeight="500"
                      fontFamily="system-ui, -apple-system, sans-serif"
                      opacity={0.85}
                      pointerEvents="none"
                    >
                      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}

            {/* Sector borders */}
            {treemapRects.sectorRects.map((sr: any) => (
              <g key={sr.data.sector}>
                <rect
                  x={sr.x}
                  y={sr.y}
                  width={sr.w}
                  height={sr.h}
                  fill="none"
                  stroke="#0A0E1A"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                {sr.w > 80 && sr.h > 20 && (
                  <text
                    x={sr.x + 5}
                    y={sr.y + 13}
                    fill="rgba(255,255,255,0.5)"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="system-ui, -apple-system, sans-serif"
                    pointerEvents="none"
                  >
                    {sr.data.sector}
                  </text>
                )}
              </g>
            ))}
          </svg>

          {/* Hover Tooltip */}
          {hoveredStock && (
            <div style={{
              position: 'absolute', top: '12px', right: '12px',
              backgroundColor: 'rgba(13,22,35,0.96)', backdropFilter: 'blur(8px)',
              border: '1px solid #1A2840', borderRadius: '8px', padding: '12px 16px',
              minWidth: '200px', zIndex: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: '700', fontSize: '14px', color: '#0F7ABF' }}>{hoveredStock.ticker}</span>
                <span style={{
                  fontSize: '13px', fontWeight: '700',
                  color: hoveredStock.changePercent >= 0 ? '#10B981' : '#EF4444',
                }}>
                  {hoveredStock.changePercent > 0 ? '+' : ''}{hoveredStock.changePercent.toFixed(2)}%
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#8A95A3', marginBottom: '8px', lineHeight: '1.3' }}>{hoveredStock.company}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '11px' }}>
                <span style={{ color: '#4A5B6C' }}>Price</span>
                <span style={{ color: '#F5F7FA', textAlign: 'right' }}>{'\u20B9'}{hoveredStock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                <span style={{ color: '#4A5B6C' }}>Change</span>
                <span style={{ color: hoveredStock.change >= 0 ? '#10B981' : '#EF4444', textAlign: 'right' }}>
                  {hoveredStock.change > 0 ? '+' : ''}{hoveredStock.change.toFixed(2)}
                </span>
                <span style={{ color: '#4A5B6C' }}>Sector</span>
                <span style={{ color: '#C9D4E0', textAlign: 'right' }}>{hoveredStock.sector}</span>
                <span style={{ color: '#4A5B6C' }}>Volume</span>
                <span style={{ color: '#C9D4E0', textAlign: 'right' }}>{(hoveredStock.volume / 1e5).toFixed(1)}L</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Color Legend */}
      {!loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
          marginTop: '10px', padding: '8px 0',
        }}>
          {[
            { label: '<-4%', color: '#D32F2F' },
            { label: '-2%', color: '#EF5350' },
            { label: '-0.5%', color: '#E57373' },
            { label: '0%', color: '#37474F' },
            { label: '+0.5%', color: '#4DB6AC' },
            { label: '+2%', color: '#26A69A' },
            { label: '>+4%', color: '#00897B' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '28px', height: '10px', backgroundColor: item.color, borderRadius: '2px' }} />
              <span style={{ fontSize: '10px', color: '#4A5B6C', minWidth: '32px' }}>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
