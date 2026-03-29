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
  summary: {
    total: number;
    gainersCount: number;
    losersCount: number;
    avgChange: number;
  };
}

// ── Squarified Treemap ─────────────────────────────────────────────────
function squarify(
  items: { value: number; data: any }[],
  x: number, y: number, w: number, h: number
): { x: number; y: number; w: number; h: number; data: any }[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ x, y, w, h, data: items[0].data }];

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

    let row: typeof remaining = [remaining[0]];

    for (let i = 1; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]];
      const rowSum = candidate.reduce((s, it) => s + it.value, 0);
      const rowFrac = rowSum / remTotal;
      const rowLen = isWide ? cw * rowFrac : ch * rowFrac;

      let worstNew = 0;
      for (const item of candidate) {
        const f = item.value / rowSum;
        const iw = isWide ? rowLen : side * f;
        const ih = isWide ? side * f : rowLen;
        worstNew = Math.max(worstNew, Math.max(iw / ih, ih / iw));
      }

      const prevSum = row.reduce((s, it) => s + it.value, 0);
      const prevFrac = prevSum / remTotal;
      const prevLen = isWide ? cw * prevFrac : ch * prevFrac;
      let worstPrev = 0;
      for (const item of row) {
        const f = item.value / prevSum;
        const iw = isWide ? prevLen : side * f;
        const ih = isWide ? side * f : prevLen;
        worstPrev = Math.max(worstPrev, Math.max(iw / ih, ih / iw));
      }

      if (worstNew <= worstPrev) row = candidate;
      else break;
    }

    const rowSum = row.reduce((s, it) => s + it.value, 0);
    const rowFrac = rowSum / remTotal;
    const rowLen = isWide ? cw * rowFrac : ch * rowFrac;
    let rx = cx, ry = cy;

    for (const item of row) {
      const f = item.value / rowSum;
      if (isWide) {
        const ih = ch * f;
        results.push({ x: rx, y: ry, w: rowLen, h: ih, data: item.data });
        ry += ih;
      } else {
        const iw = cw * f;
        results.push({ x: rx, y: ry, w: iw, h: rowLen, data: item.data });
        rx += iw;
      }
    }

    if (isWide) { cx += rowLen; cw -= rowLen; }
    else { cy += rowLen; ch -= rowLen; }
    remaining = remaining.slice(row.length);
  }

  return results;
}

// ── Premium Color Palette ──────────────────────────────────────────────
function getChangeColor(pct: number): string {
  // Smooth gradient: deep red → muted → deep green
  if (pct >= 5)   return '#00695C'; // teal 800
  if (pct >= 3)   return '#00897B'; // teal 600
  if (pct >= 1.5) return '#26A69A'; // teal 400
  if (pct >= 0.5) return '#4DB6AC'; // teal 300
  if (pct >= 0.1) return '#1B3A34'; // dark teal hint
  if (pct >= -0.1) return '#1A2332'; // neutral dark
  if (pct >= -0.5) return '#3E2023'; // dark red hint
  if (pct >= -1.5) return '#C62828'; // red 800
  if (pct >= -3)  return '#B71C1C'; // red 900
  if (pct >= -5)  return '#D32F2F'; // red 700
  return '#E53935'; // red 600
}

function getTextColor(pct: number): string {
  if (Math.abs(pct) < 0.1) return '#607D8B';
  return '#FFFFFF';
}

function getSubTextOpacity(pct: number): number {
  if (Math.abs(pct) < 0.1) return 0.5;
  return 0.75;
}

type HeatmapTab = 'midcap150' | 'smallcap150';

export default function HeatmapPage() {
  const [tab, setTab] = useState<HeatmapTab>('midcap150');
  const [dataMap, setDataMap] = useState<Record<string, ApiResponse>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 1200, h: 680 });
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchBoth = useCallback(async () => {
    try {
      setError(null);
      setIsRefreshing(true);
      const [mcRes, scRes] = await Promise.all([
        fetch('/api/market/quotes?market=india&index=midcap150'),
        fetch('/api/market/quotes?market=india&index=smallcap150'),
      ]);
      if (!mcRes.ok) throw new Error(`Midcap API: ${mcRes.status}`);
      if (!scRes.ok) throw new Error(`Smallcap API: ${scRes.status}`);
      const [mcJson, scJson] = await Promise.all([mcRes.json(), scRes.json()]);
      setDataMap({ midcap150: mcJson, smallcap150: scJson });
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchBoth(); }, [fetchBoth]);
  useEffect(() => { const i = setInterval(fetchBoth, 60000); return () => clearInterval(i); }, [fetchBoth]);

  // Responsive
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        setContainerSize({ w: r.width, h: Math.max(480, window.innerHeight - 230) });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loading]);

  const data = dataMap[tab] || null;

  // Build treemap
  const treemap = useMemo((): {
    rects: { x: number; y: number; w: number; h: number; stock: Stock; sector: string }[];
    sectorRects: { x: number; y: number; w: number; h: number; data: any }[];
  } | null => {
    if (!data || !data.stocks.length) return null;

    const sectorMap = new Map<string, Stock[]>();
    for (const s of data.stocks) {
      const arr = sectorMap.get(s.sector) || [];
      arr.push(s);
      sectorMap.set(s.sector, arr);
    }

    const sectorItems = [...sectorMap.entries()].map(([sector, stocks]) => ({
      value: stocks.reduce((s, st) => s + Math.max(st.marketCap, 1000), 0),
      data: { sector, stocks },
    }));

    const { w, h } = containerSize;
    const sectorRects = squarify(sectorItems, 0, 0, w, h);
    const allRects: { x: number; y: number; w: number; h: number; stock: Stock; sector: string }[] = [];

    for (const sr of sectorRects) {
      const { sector, stocks } = sr.data;
      const stockItems = stocks.map((st: Stock) => ({
        value: Math.max(st.marketCap, 1000),
        data: st,
      }));
      const gap = 1;
      const innerRects = squarify(stockItems, sr.x + gap, sr.y + gap, sr.w - gap * 2, sr.h - gap * 2);
      for (const ir of innerRects) {
        allRects.push({ ...ir, stock: ir.data, sector });
      }
    }

    return { rects: allRects, sectorRects };
  }, [data, containerSize]);

  const formatTime = (d: Date | null) => d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--';

  const hoveredStock = hoveredTicker && data ? data.stocks.find(s => s.ticker === hoveredTicker) : null;

  const BG = '#0A0E1A';
  const CARD = '#0D1623';
  const BORDER = '#1A2840';
  const ACCENT = '#0F7ABF';
  const GREEN = '#10B981';
  const RED = '#EF4444';
  const TEXT1 = '#F5F7FA';
  const TEXT3 = '#4A5B6C';

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0, letterSpacing: '-0.3px' }}>Market Heatmap</h1>

          {/* Tab Toggle */}
          <div style={{ display: 'flex', backgroundColor: CARD, borderRadius: '8px', border: `1px solid ${BORDER}`, padding: '3px' }}>
            {([
              { key: 'midcap150' as HeatmapTab, label: 'Midcap 150' },
              { key: 'smallcap150' as HeatmapTab, label: 'Smallcap 150' },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '6px 16px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: '600',
                  backgroundColor: tab === t.key ? ACCENT : 'transparent',
                  color: tab === t.key ? '#fff' : TEXT3,
                  cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {data && (
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
              <span style={{ color: TEXT3 }}>{data.summary.total} stocks</span>
              <span style={{ color: GREEN, fontWeight: '600' }}>{data.summary.gainersCount} up</span>
              <span style={{ color: RED, fontWeight: '600' }}>{data.summary.losersCount} down</span>
              <span style={{ color: (data.summary.avgChange || 0) >= 0 ? GREEN : RED, fontWeight: '600' }}>
                avg {(data.summary.avgChange || 0) > 0 ? '+' : ''}{(data.summary.avgChange || 0).toFixed(1)}%
              </span>
            </div>
          )}
          <button onClick={fetchBoth} disabled={isRefreshing} style={{
            padding: '6px 10px', borderRadius: '6px', border: `1px solid ${BORDER}`, backgroundColor: CARD,
            color: ACCENT, cursor: isRefreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
            opacity: isRefreshing ? 0.5 : 1, transition: 'all 0.2s',
          }}>
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: TEXT3 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: GREEN, animation: 'pulse 2s ease infinite' }} />
            {formatTime(lastUpdated)}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '500px' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #1A2840', borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '14px', color: RED, fontSize: '13px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      {/* Treemap */}
      {data && !loading && treemap !== null && (
        <div
          ref={containerRef}
          style={{
            position: 'relative', width: '100%', height: `${containerSize.h}px`,
            backgroundColor: '#060A14', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${BORDER}`,
          }}
        >
          <svg
            width={containerSize.w}
            height={containerSize.h}
            viewBox={`0 0 ${containerSize.w} ${containerSize.h}`}
            style={{ display: 'block', width: '100%', height: '100%' }}
          >
            {/* Stock cells */}
            {treemap.rects.map((r) => {
              const isHov = hoveredTicker === r.stock.ticker;
              const pct = r.stock.changePercent;
              const minD = Math.min(r.w, r.h);
              const showTicker = minD > 26;
              const showPct = minD > 38;
              const showPrice = r.w > 70 && r.h > 55;
              const fs = Math.min(13, Math.max(8, minD / 4.5));

              return (
                <g key={r.stock.ticker}>
                  <rect
                    x={r.x + 0.5} y={r.y + 0.5}
                    width={Math.max(0, r.w - 1)} height={Math.max(0, r.h - 1)}
                    fill={getChangeColor(pct)}
                    opacity={isHov ? 1 : 0.9}
                    rx={1.5}
                    style={{ cursor: 'pointer', transition: 'opacity 0.12s' }}
                    onMouseEnter={() => setHoveredTicker(r.stock.ticker)}
                    onMouseLeave={() => setHoveredTicker(null)}
                  />
                  {showTicker && (
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + (showPct ? -fs * 0.4 : fs * 0.35) + (showPrice ? -fs * 0.25 : 0)}
                      textAnchor="middle" fill={getTextColor(pct)} fontSize={fs} fontWeight="700"
                      fontFamily="'Inter',system-ui,-apple-system,sans-serif" pointerEvents="none"
                    >
                      {r.stock.ticker}
                    </text>
                  )}
                  {showPct && (
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + fs * 0.7 + (showPrice ? -fs * 0.2 : 0)}
                      textAnchor="middle" fill={getTextColor(pct)} fontSize={fs * 0.8} fontWeight="500"
                      fontFamily="'Inter',system-ui,-apple-system,sans-serif"
                      opacity={getSubTextOpacity(pct)} pointerEvents="none"
                    >
                      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                    </text>
                  )}
                  {showPrice && (
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + fs * 1.6}
                      textAnchor="middle" fill={getTextColor(pct)} fontSize={fs * 0.65} fontWeight="400"
                      fontFamily="'Inter',system-ui,-apple-system,sans-serif"
                      opacity={0.55} pointerEvents="none"
                    >
                      {'\u20B9'}{r.stock.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Sector borders + labels */}
            {treemap.sectorRects.map((sr: any) => (
              <g key={sr.data.sector}>
                <rect x={sr.x} y={sr.y} width={sr.w} height={sr.h}
                  fill="none" stroke="#0A0E1A" strokeWidth={2.5} pointerEvents="none" />
                {sr.w > 70 && sr.h > 18 && (
                  <text x={sr.x + 6} y={sr.y + 14}
                    fill="rgba(255,255,255,0.45)" fontSize="10" fontWeight="600"
                    fontFamily="'Inter',system-ui,-apple-system,sans-serif" pointerEvents="none"
                  >
                    {sr.data.sector}
                  </text>
                )}
              </g>
            ))}
          </svg>

          {/* Tooltip */}
          {hoveredStock && (
            <div style={{
              position: 'absolute', top: '10px', right: '10px',
              backgroundColor: 'rgba(10,14,26,0.95)', backdropFilter: 'blur(12px)',
              border: `1px solid ${BORDER}`, borderRadius: '10px', padding: '14px 18px',
              minWidth: '220px', zIndex: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: '700', fontSize: '15px', color: ACCENT }}>{hoveredStock.ticker}</span>
                <span style={{
                  fontSize: '14px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px',
                  color: hoveredStock.changePercent >= 0 ? GREEN : RED,
                  backgroundColor: hoveredStock.changePercent >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                }}>
                  {hoveredStock.changePercent > 0 ? '+' : ''}{hoveredStock.changePercent.toFixed(2)}%
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#8A95A3', marginBottom: '10px', lineHeight: '1.3' }}>{hoveredStock.company}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 16px', fontSize: '11px' }}>
                <span style={{ color: TEXT3 }}>Price</span>
                <span style={{ color: TEXT1, textAlign: 'right', fontWeight: '600' }}>{'\u20B9'}{hoveredStock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                <span style={{ color: TEXT3 }}>Change</span>
                <span style={{ color: hoveredStock.change >= 0 ? GREEN : RED, textAlign: 'right', fontWeight: '600' }}>
                  {hoveredStock.change > 0 ? '+' : ''}{hoveredStock.change.toFixed(2)}
                </span>
                <span style={{ color: TEXT3 }}>Sector</span>
                <span style={{ color: '#C9D4E0', textAlign: 'right' }}>{hoveredStock.sector}</span>
                <span style={{ color: TEXT3 }}>Volume</span>
                <span style={{ color: '#C9D4E0', textAlign: 'right' }}>
                  {hoveredStock.volume >= 1e7 ? (hoveredStock.volume / 1e7).toFixed(1) + 'Cr'
                    : hoveredStock.volume >= 1e5 ? (hoveredStock.volume / 1e5).toFixed(1) + 'L'
                    : hoveredStock.volume.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Color Legend */}
      {!loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', marginTop: '8px' }}>
          {[
            { label: '-5%+', color: '#E53935' },
            { label: '-3%', color: '#D32F2F' },
            { label: '-1.5%', color: '#C62828' },
            { label: '-0.5%', color: '#3E2023' },
            { label: '0', color: '#1A2332' },
            { label: '+0.5%', color: '#1B3A34' },
            { label: '+1.5%', color: '#26A69A' },
            { label: '+3%', color: '#00897B' },
            { label: '+5%+', color: '#00695C' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <div style={{ width: '32px', height: '8px', backgroundColor: item.color, borderRadius: i === 0 ? '3px 0 0 3px' : i === 8 ? '0 3px 3px 0' : '0' }} />
              {(i === 0 || i === 4 || i === 8) && (
                <span style={{ fontSize: '9px', color: TEXT3, minWidth: '24px' }}>{item.label}</span>
              )}
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
