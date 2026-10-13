'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState } from 'react';
import { Trash2, TrendingUp, TrendingDown, ArrowUpDown, AlertTriangle, Download } from 'lucide-react';
import { defaultExportScope, type ExportScope } from '@/lib/watchlist-export';
import { isPriceSuspect } from '@/lib/nse';
import { OPTIONAL_COLS } from './constants';
import { loadColPrefs, saveColPrefs } from './helpers';
import { type WatchlistItem, type SortField, type SortOrder, type OptionalCol } from './types';

// ── Summary Component ──────────────────────────────────────────────────────────

export function SummaryBar({ items }: { items: WatchlistItem[] }) {
  if (items.length === 0) return null;

  // zzz1000 (CW-01) — an unknown change (null) is neither a gainer, a loser nor flat
  const gainers = items.filter(item => (item.changePercent ?? 0) > 0).length;
  const losers = items.filter(item => (item.changePercent ?? 0) < 0).length;
  // AUDIT_100 #22 — exclude items with price=0 (fallback / pre-market /
  // missing quote) before averaging. Otherwise the headline "Avg Change"
  // is dragged toward 0 even when 5 of 6 real stocks are solidly up.
  const valid = items.filter(item => (item.price ?? 0) > 0 && item.changePercent != null && Number.isFinite(item.changePercent));
  const avgChange = valid.length > 0
    ? valid.reduce((sum, item) => sum + (item.changePercent as number), 0) / valid.length
    : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>TOTAL STOCKS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-text-0)' }}>{items.length}</div>
      </div>
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>AVG. CHANGE</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: avgChange >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
          {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
        </div>
      </div>
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>GAINERS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-bullish)' }}>{gainers}</div>
      </div>
      <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>LOSERS</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-bearish)' }}>{losers}</div>
      </div>
    </div>
  );
}

// ── Empty State Component ──────────────────────────────────────────────────────

export function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
      <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 8px' }}>Your watchlist is empty</h2>
      <p style={{ fontSize: '14px', color: 'var(--mc-text-3)', margin: '0 0 24px' }}>Add stock tickers to start tracking them. Popular tickers: RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK</p>
      {/* PATCH 0303 — Cross-link the institutional channels users can populate
          the watchlist from, so the empty state never feels like a dead end. */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <a
          href="/earnings-opportunities"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid rgba(245,158,11,0.4)',
            backgroundColor: 'rgba(245,158,11,0.10)',
            color: 'var(--mc-warn)', fontSize: 12, fontWeight: 700,
            textDecoration: 'none',
          }}
        >🏆 Auto-populate from Conviction Beats →</a>
        <a
          href="/screener"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid rgba(15,122,191,0.4)',
            backgroundColor: 'rgba(15,122,191,0.10)',
            color: 'var(--mc-accent)', fontSize: 12, fontWeight: 700,
            textDecoration: 'none',
          }}
        >🔍 Find tickers in Screener →</a>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: 0 }}>💬 Your watchlist syncs with @mc_watchlist_pulse_bot</p>
    </div>
  );
}

// ── Table Component ────────────────────────────────────────────────────────────

export function WatchlistTable({
  items,
  sortField,
  sortOrder,
  onSort,
  onRemove,
  onToggleFlag,
}: {
  items: WatchlistItem[];
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  onRemove: (ticker: string) => void;
  onToggleFlag?: (ticker: string) => void;
}) {
  // PATCH 0442 BUG-020/027 — column chooser
  const [activeCols, setActiveCols] = useState<Set<OptionalCol>>(() => loadColPrefs());
  const [chooserOpen, setChooserOpen] = useState(false);
  const toggleCol = (id: OptionalCol) => {
    setActiveCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveColPrefs(next);
      return next;
    });
  };
  const formatVolume = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(0);
  };
  const formatMcap = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v >= 1e12) return `₹${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `₹${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(0)} Cr`;
    return `₹${v.toFixed(0)}`;
  };
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown style={{ width: '12px', height: '12px', opacity: 0.4 }} />;
    return sortOrder === 'asc' ? (
      <TrendingUp style={{ width: '12px', height: '12px' }} />
    ) : (
      <TrendingDown style={{ width: '12px', height: '12px' }} />
    );
  };

  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--mc-border-2)', borderRadius: '12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--mc-border-2)', backgroundColor: 'var(--mc-bg-1)' }}>
            <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer', width: '40px' }} onClick={() => onSort('flag')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                Flag <SortIcon field="flag" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('ticker')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Ticker <SortIcon field="ticker" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('company')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Company <SortIcon field="company" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('sector')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Sector <SortIcon field="sector" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('price')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                CMP (₹) <SortIcon field="price" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('changePercent')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Change% <SortIcon field="changePercent" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('dayHigh')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Day High <SortIcon field="dayHigh" />
              </div>
            </th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort('dayLow')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                Day Low <SortIcon field="dayLow" />
              </div>
            </th>
            {/* PATCH 0442 BUG-020 — Optional columns rendered based on chooser state */}
            {OPTIONAL_COLS.filter(c => activeCols.has(c.id)).map(c => (
              <th key={c.id} style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => onSort(c.id as SortField)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                  {c.label} <SortIcon field={c.id as SortField} />
                </div>
              </th>
            ))}
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-3)', letterSpacing: '0.5px', position: 'relative' }}>
              {/* PATCH 0442 BUG-027 — Working column chooser. Click to toggle
                  popover; select Volume / 52W / Mcap / PE / Avg Vol columns. */}
              <button
                onClick={() => setChooserOpen(o => !o)}
                title="Configure columns"
                style={{
                  background: chooserOpen ? 'color-mix(in srgb, var(--mc-accent) 19%, transparent)' : 'transparent',
                  border: `1px solid ${chooserOpen ? 'var(--mc-cyan)' : 'var(--mc-border-2)'}`,
                  borderRadius: 6, color: chooserOpen ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
                  cursor: 'pointer', padding: '4px 9px', fontSize: '10px', fontWeight: 700,
                }}
              >⚙ Columns ({activeCols.size})</button>
              {chooserOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 8, marginTop: 4, zIndex: 50,
                  minWidth: 200, padding: 8, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
                  borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6, letterSpacing: '0.4px' }}>SHOW COLUMNS</div>
                  {OPTIONAL_COLS.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 4 }}>
                      <input type="checkbox" checked={activeCols.has(c.id)} onChange={() => toggleCol(c.id)} />
                      <span style={{ fontSize: 11, color: 'var(--mc-text-0)' }}>{c.label}</span>
                    </label>
                  ))}
                  <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 6, fontStyle: 'italic' }}>
                    Data may be — when source doesn&apos;t return the field
                  </div>
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const isPositive = (item.changePercent ?? 0) >= 0;
            const price = item.price != null && item.price > 0 ? item.price : null;   // zzz1000 (CW-01)
            return (
              <tr key={item.ticker} data-watchlist-ticker={item.ticker} style={{ borderBottom: idx < items.length - 1 ? '1px solid var(--mc-bg-2)' : 'none', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '8px 8px', textAlign: 'center', width: '40px' }}>
                  <button
                    onClick={() => onToggleFlag?.(item.ticker)}
                    title={`Flag: ${item.flag || 'None'} (click to cycle)`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 4px', borderRadius: '4px', lineHeight: 1 }}
                  >
                    {item.flag || '⚪'}
                  </button>
                </td>
                {/* zzz967 (WL-02) — the ticker opens the same instrument on Charts (India list → NSE) */}
                <td style={{ padding: '12px 16px', fontWeight: '700' }}>
                  <a href={`/charts?m=${item.market === 'US' ? 'US' : 'IN'}&t=${encodeURIComponent(item.ticker)}`} title={`Open ${item.ticker} on Charts`} aria-label={`Open ${item.ticker} chart`}
                    style={{ color: 'var(--mc-info)', textDecoration: 'none' }}>{item.ticker} <span aria-hidden style={{ fontSize: 11, opacity: 0.7 }}>↗</span></a>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--mc-text-0)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.company}
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--mc-text-3)', fontSize: '12px' }}>{item.sector}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>
                  {/* PATCH 0559 — BUG-AUDIT-4: when quote came back null/0 render
                      a muted em-dash with a tooltip instead of ₹0.00. */}
                  {price == null ? (
                    <span style={{ color: 'var(--mc-text-4)' }} title="Price unavailable — quote not returned by data source">—</span>
                  ) : isPriceSuspect(item.ticker, price) ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--mc-warn)' }} title="Suspect price - may be incorrect or stale">
                      <AlertTriangle style={{ width: '12px', height: '12px' }} />
                      ₹{price.toFixed(2)}
                    </span>
                  ) : (
                    `₹${price.toFixed(2)}`
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {/* PATCH 0559 — also blank pct chip when no live price. */}
                  {price == null || item.changePercent == null ? (
                    <span style={{ color: 'var(--mc-text-4)' }} title="Change unavailable">—</span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '6px', backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: isPositive ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: '600', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                      {isPositive ? <TrendingUp style={{ width: '11px', height: '11px' }} /> : <TrendingDown style={{ width: '11px', height: '11px' }} />}
                      {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  {item.dayHigh != null && item.dayHigh > 0 ? `₹${item.dayHigh.toFixed(2)}` : <span style={{ color: 'var(--mc-text-4)' }} title="Day high not given by the quote source">—</span>}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                  {item.dayLow != null && item.dayLow > 0 ? `₹${item.dayLow.toFixed(2)}` : <span style={{ color: 'var(--mc-text-4)' }} title="Day low not given by the quote source">—</span>}
                </td>
                {/* PATCH 0442 BUG-020 — Optional column cells */}
                {OPTIONAL_COLS.filter(c => activeCols.has(c.id)).map(c => {
                  const val = (item as any)[c.id] as number | null | undefined;
                  let txt = '—';
                  if (val != null && Number.isFinite(val)) {
                    if (c.id === 'volume' || c.id === 'avgVolume') txt = formatVolume(val);
                    else if (c.id === 'marketCap') txt = formatMcap(val);
                    else if (c.id === 'peRatio') txt = val.toFixed(1) + 'x';
                    else txt = `₹${val.toFixed(2)}`;
                  }
                  return (
                    <td key={c.id} style={{ padding: '12px 16px', textAlign: 'right', color: txt === '—' ? 'var(--mc-text-4)' : 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                      {txt}
                    </td>
                  );
                })}
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button
                    onClick={() => onRemove(item.ticker)}
                    title="Remove from watchlist"
                    style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.color = '#EF4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#4A5B6C'; }}
                  >
                    <Trash2 style={{ width: '14px', height: '14px' }} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Export control (zzz1000 CW-04) ─────────────────────────────────────────────
/** Export with an explicit population. With a search on: "Export filtered (n)" is the main button and "Export all (N)" the
 *  second one; without a search a single "Export all (N)". The page decides nothing implicitly. */
export function WatchlistExportControl({ filterActive, filteredCount, totalCount, onExport }: {
  filterActive: boolean; filteredCount: number; totalCount: number; onExport: (scope: ExportScope) => void;
}) {
  const primary = defaultExportScope(filterActive);
  const btn = (scope: ExportScope, main: boolean) => {
    const n = scope === 'filtered' ? filteredCount : totalCount;
    return (
      <button key={scope} type="button" onClick={() => onExport(scope)} disabled={n === 0} data-export-scope={scope}
        aria-label={scope === 'filtered' ? `Export the ${n} filtered rows to Excel` : `Export all ${n} rows to Excel`}
        title={scope === 'filtered' ? `Export the ${n} rows matching the search (of ${totalCount})` : `Export the whole list (${totalCount} rows)${filterActive ? ', ignoring the search' : ''}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: main ? 'var(--mc-bg-2)' : 'transparent', border: '1px solid var(--mc-border-2)', borderRadius: '10px', padding: '10px 14px', color: main ? 'var(--mc-text-1)' : 'var(--mc-text-3)', cursor: n === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: main ? 700 : 600, opacity: n === 0 ? 0.4 : 1, fontVariantNumeric: 'tabular-nums' }}>
        {main && <Download style={{ width: '14px', height: '14px' }} />}
        {scope === 'filtered' ? `Export filtered (${n})` : `Export all (${n})`}
      </button>
    );
  };
  return (
    <span role="group" aria-label="Export to Excel" style={{ display: 'inline-flex', gap: 6 }}>
      {filterActive ? [btn('filtered', primary === 'filtered'), btn('all', primary === 'all')] : btn('all', true)}
    </span>
  );
}
