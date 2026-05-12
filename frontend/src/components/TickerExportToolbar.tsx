'use client';

// ═══════════════════════════════════════════════════════════════════════════
// TICKER EXPORT TOOLBAR (PATCH 0196)
//
// Reusable export bar with multiple modes:
//   - Copy CSV (plain ticker list, comma-separated)
//   - Copy TradingView (NSE: prefix, paste-ready)
//   - Download .txt
//   - Open in TradingView chart (first ticker)
//   - Optional tier-grouped quick-copies (e.g. Copy BLOCKBUSTER, Copy STRONG)
//
// Used in:
//   - /watchlists → Conviction Beats tab
//   - /earnings → Earnings Hub Scan
// ═══════════════════════════════════════════════════════════════════════════

import toast from 'react-hot-toast';
import { Copy, Download, ExternalLink } from 'lucide-react';

interface GroupedTickers {
  label: string;        // 'BLOCKBUSTER', 'STRONG', etc.
  emoji?: string;
  tickers: string[];
  color?: string;
}

interface Props {
  /** Currently visible / filtered tickers (after filter chain) */
  tickers: string[];
  /** Optional groups for tier-specific copy buttons */
  groups?: GroupedTickers[];
  /** Exchange prefix for TradingView (default NSE) */
  exchange?: 'NSE' | 'BSE' | 'NYSE' | 'NASDAQ';
  /** Optional filename hint for .txt export */
  filenameHint?: string;
  /** Compact mode: smaller buttons, fewer labels */
  compact?: boolean;
}

export default function TickerExportToolbar({
  tickers,
  groups,
  exchange = 'NSE',
  filenameHint = 'tickers',
  compact = false,
}: Props) {
  const safeTickers = tickers.map((t) => t.toUpperCase().trim()).filter(Boolean);
  const n = safeTickers.length;

  const copyCsv = async (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to copy`); return; }
    const csv = subset.join(',');
    try {
      await navigator.clipboard.writeText(csv);
      toast.success(`Copied ${subset.length} ${label} ticker${subset.length === 1 ? '' : 's'} (CSV)`);
    } catch {
      toast.error('Clipboard write failed — check browser permission');
    }
  };

  const copyTradingView = async (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to copy`); return; }
    const tv = subset.map((t) => `${exchange}:${t}`).join(',');
    try {
      await navigator.clipboard.writeText(tv);
      toast.success(`Copied ${subset.length} ${label} ticker${subset.length === 1 ? '' : 's'} for TradingView`);
    } catch {
      toast.error('Clipboard write failed — check browser permission');
    }
  };

  const downloadTxt = (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to download`); return; }
    const txt = subset.map((t) => `${exchange}:${t}`).join('\n');
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameHint}_${label}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${subset.length} ${label} ticker${subset.length === 1 ? '' : 's'}`);
  };

  const openInTradingView = (subset: string[]) => {
    if (subset.length === 0) { toast.error(`No tickers to open`); return; }
    // Open single-ticker chart for the first one; copy the full list so user
    // can paste into their TradingView watchlist after.
    const first = `${exchange}:${subset[0]}`;
    const tv = subset.map((t) => `${exchange}:${t}`).join(',');
    navigator.clipboard.writeText(tv).catch(() => {});
    window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(first)}`, '_blank', 'noopener,noreferrer');
    toast.success(`Opened ${first} · ${subset.length} tickers copied for paste`);
  };

  const btnBase = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: compact ? '4px 10px' : '6px 12px',
    fontSize: compact ? 10.5 : 11.5,
    fontWeight: 700,
    borderRadius: 6,
    cursor: n > 0 ? 'pointer' as const : 'not-allowed' as const,
    opacity: n > 0 ? 1 : 0.4,
  } as const;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: compact ? '6px 10px' : '8px 12px',
      backgroundColor: '#0A1422',
      border: '1px solid #1A2840',
      borderRadius: 8,
    }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: '#6B7A8D', letterSpacing: '0.5px', marginRight: 4 }}>
        EXPORT · {n}
      </span>

      <button
        onClick={() => copyCsv(safeTickers, 'All')}
        disabled={n === 0}
        title={`Copy ${n} tickers as plain comma-separated list (Excel, sheets)`}
        style={{ ...btnBase, border: '1px solid #1A2840', background: '#0D1623', color: '#C9D4E0' }}
      >
        <Copy style={{ width: 11, height: 11 }} />
        Copy CSV
      </button>

      <button
        onClick={() => copyTradingView(safeTickers, 'All')}
        disabled={n === 0}
        title={`Copy ${n} tickers with ${exchange}: prefix — paste into TradingView watchlist`}
        style={{ ...btnBase, border: '1px solid #22D3EE60', background: '#22D3EE15', color: '#22D3EE' }}
      >
        <Copy style={{ width: 11, height: 11 }} />
        Copy TradingView
      </button>

      <button
        onClick={() => downloadTxt(safeTickers, 'All')}
        disabled={n === 0}
        title={`Download ${n} tickers as .txt file (with ${exchange}: prefix)`}
        style={{ ...btnBase, border: '1px solid #1A2840', background: '#0D1623', color: '#C9D4E0' }}
      >
        <Download style={{ width: 11, height: 11 }} />
        .txt
      </button>

      <button
        onClick={() => openInTradingView(safeTickers)}
        disabled={n === 0}
        title="Open first ticker in TradingView chart + copy full list for paste into a new watchlist"
        style={{ ...btnBase, border: '1px solid #10B98160', background: '#10B98115', color: '#10B981' }}
      >
        <ExternalLink style={{ width: 11, height: 11 }} />
        Open in TradingView
      </button>

      {/* Tier-grouped quick copy chips */}
      {groups && groups.length > 0 && (
        <>
          <span style={{ fontSize: 9, color: '#6B7A8D', marginLeft: 6, marginRight: 2 }}>by tier:</span>
          {groups.map((g) => {
            const count = g.tickers.length;
            const color = g.color || '#94A3B8';
            return (
              <button key={g.label}
                onClick={() => copyTradingView(g.tickers.map((t) => t.toUpperCase()), g.label)}
                disabled={count === 0}
                title={`Copy ${count} ${g.label} ticker${count === 1 ? '' : 's'} in TradingView format`}
                style={{
                  ...btnBase,
                  padding: compact ? '3px 8px' : '4px 9px',
                  border: `1px solid ${color}50`,
                  background: `${color}15`,
                  color,
                }}
              >
                {g.emoji && <span>{g.emoji}</span>}
                {g.label}
                <span style={{ fontSize: 9, opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
