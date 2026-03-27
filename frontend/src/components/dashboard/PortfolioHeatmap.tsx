'use client';

import { useMemo } from 'react';

interface HeatmapTile {
  ticker: string;
  name: string;
  changePercent: number;
  weight: number; // 0-1
  value: number;
}

interface Props {
  tiles: HeatmapTile[];
  onTileClick?: (ticker: string) => void;
}

function getColor(pct: number): string {
  if (pct >= 4) return '#16A34A';
  if (pct >= 2) return '#22C55E';
  if (pct >= 0.5) return '#4ADE80';
  if (pct >= -0.5) return '#6B7280';
  if (pct >= -2) return '#F87171';
  if (pct >= -4) return '#EF4444';
  return '#DC2626';
}

function getTextColor(pct: number): string {
  return Math.abs(pct) < 0.5 ? '#D1D5DB' : '#FFFFFF';
}

export default function PortfolioHeatmap({ tiles, onTileClick }: Props) {
  const sorted = useMemo(() => [...tiles].sort((a, b) => b.weight - a.weight), [tiles]);

  if (!sorted.length) {
    return (
      <div className="flex items-center justify-center h-40 text-[#4A5B6C] text-sm">
        No positions — add to a portfolio to see heatmap
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
      {sorted.map(tile => {
        const bg = getColor(tile.changePercent);
        const fg = getTextColor(tile.changePercent);
        // Scale tile height by weight: min 60px, max 100px
        const h = Math.round(60 + tile.weight * 300);
        return (
          <button
            key={tile.ticker}
            onClick={() => onTileClick?.(tile.ticker)}
            style={{ backgroundColor: bg, minHeight: `${Math.min(h, 100)}px` }}
            className="rounded-lg p-2 flex flex-col justify-between transition-opacity hover:opacity-80 cursor-pointer text-left"
            title={`${tile.name}: ${tile.changePercent >= 0 ? '+' : ''}${tile.changePercent.toFixed(2)}%`}
          >
            <span style={{ color: fg }} className="text-[11px] font-bold leading-tight">{tile.ticker}</span>
            <span
              style={{ color: fg }}
              className="text-[11px] font-semibold"
            >
              {tile.changePercent >= 0 ? '+' : ''}{tile.changePercent.toFixed(2)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}
