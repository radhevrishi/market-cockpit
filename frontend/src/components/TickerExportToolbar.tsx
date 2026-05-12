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
    gap: 6,
    padding: compact ? '6px 12px' : '9px 16px',
    fontSize: compact ? 11.5 : 13,
    fontWeight: 800,
    borderRadius: 8,
    cursor: n > 0 ? 'pointer' as const : 'not-allowed' as const,
    opacity: n > 0 ? 1 : 0.4,
    transition: 'all 0.15s',
  } as const;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: compact ? '10px 14px' : '14px 18px',
      backgroundColor: '#0D1623',
      border: '2px solid #22D3EE40',
      borderRadius: 12,
      boxShadow: '0 0 0 1px #22D3EE15',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 6,
          backgroundColor: '#22D3EE22', border: '1px solid #22D3EE60',
        }}>
          <Copy style={{ width: 13, height: 13, color: '#22D3EE' }} />
          <span style={{ fontSize: 12, fontWeight: 900, color: '#22D3EE', letterSpacing: '0.6px' }}>
            EXPORT {n} TICKER{n === 1 ? '' : 'S'}
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#8BA3C1', flex: 1 }}>
          Copy/download the current filtered list — paste into TradingView, Excel, or anywhere
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => copyTradingView(safeTickers, 'All')}
          disabled={n === 0}
          title={`Copy all ${n} tickers with ${exchange}: prefix — paste directly into TradingView watchlist`}
          style={{ ...btnBase, border: '1px solid #22D3EE', background: '#22D3EE', color: '#0A0E1A' }}
        >
          <Copy style={{ width: 14, height: 14 }} />
          Copy for TradingView
        </button>

        <button
          onClick={() => copyCsv(safeTickers, 'All')}
          disabled={n === 0}
          title={`Copy ${n} tickers as plain comma-separated list (no prefix) — for Excel, sheets, or other tools`}
          style={{ ...btnBase, border: '1px solid #1A2840', background: '#0A1422', color: '#C9D4E0' }}
        >
          <Copy style={{ width: 14, height: 14 }} />
          Copy CSV
        </button>

        <button
          onClick={() => downloadTxt(safeTickers, 'All')}
          disabled={n === 0}
          title={`Download ${n} tickers as .txt file (with ${exchange}: prefix)`}
          style={{ ...btnBase, border: '1px solid #1A2840', background: '#0A1422', color: '#C9D4E0' }}
        >
          <Download style={{ width: 14, height: 14 }} />
          Download .txt
        </button>

        <button
          onClick={() => openInTradingView(safeTickers)}
          disabled={n === 0}
          title="Open first ticker in TradingView chart + copy full list for paste into a new watchlist"
          style={{ ...btnBase, border: '1px solid #10B981', background: '#10B98120', color: '#10B981' }}
        >
          <ExternalLink style={{ width: 14, height: 14 }} />
          Open in TradingView
        </button>
      </div>

      {/* Tier-grouped quick copy chips */}
      {groups && groups.length > 0 && groups.some((g) => g.tickers.length > 0) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          paddingTop: 6, borderTop: '1px dashed #1A2840',
        }}>
          <span style={{ fontSize: 10, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px', marginRight: 2 }}>
            COPY BY TIER (TradingView fmt):
          </span>
          {groups.map((g) => {
            const count = g.tickers.length;
            if (count === 0) return null;
            const color = g.color || '#94A3B8';
            return (
              <button key={g.label}
                onClick={() => copyTradingView(g.tickers.map((t) => t.toUpperCase()), g.label)}
                title={`Copy ${count} ${g.label} ticker${count === 1 ? '' : 's'} in TradingView format`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 11px',
                  fontSize: 11.5, fontWeight: 800,
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: `1px solid ${color}80`,
                  background: `${color}20`,
                  color,
                }}
              >
                {g.emoji && <span>{g.emoji}</span>}
                Copy {g.label}
                <span style={{ fontSize: 10, opacity: 0.85, fontFamily: 'ui-monospace, monospace' }}>{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
