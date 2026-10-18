'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState } from 'react';
import { Trash2, TrendingUp, TrendingDown, ArrowUpDown, AlertTriangle, Download } from 'lucide-react';
import { defaultExportScope, type ExportScope } from '@/lib/watchlist-export';
import { isPriceSuspect } from '@/lib/nse';
import { OPTIONAL_COLS } from './constants';
import { loadColPrefs, saveColPrefs } from './helpers';
import { type WatchlistItem, type SortField, type SortOrder, type OptionalCol } from './types';
import { type ListOp, type FailedListOp } from '@/lib/watchlist-sync';
import { describeListOp } from './watchlist-save';
import { quoteTimeOf, formatTradedValue } from '@/lib/watchlist-review';

/** zzz1045d — a quote time as HH:MM today, or "15 Oct HH:MM" on another day (the viewer's own clock). */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}`;
}
const FLAG_NAME: Record<string, string> = { '🟢': 'green', '🟠': 'orange', '🔴': 'red' };

// ── zzz1044c (F10) — changes still saving / not saved ─────────────────────────

export function SaveStatusStrip({ pending, failed, onRetry, onDismiss }: {
  pending: ListOp[];
  failed: FailedListOp[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (pending.length === 0 && failed.length === 0) return null;
  return (
    <div className="wlp-save" role="status" aria-live="polite">
      {pending.length > 0 && <span>Saving {pending.length} change{pending.length > 1 ? 's' : ''}…</span>}
      {failed.map((f) => (
        <span key={f.id} className="err">
          Not saved: {describeListOp(f)} ({f.error}) — undone.
          <button type="button" onClick={() => onRetry(f.id)}>Retry</button>
          <button type="button" onClick={() => onDismiss(f.id)} aria-label={`Dismiss: ${describeListOp(f)}`}>Dismiss</button>
        </span>
      ))}
    </div>
  );
}

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

  // zzz1013 — one figures strip (was four cards); unknown changes stay out of every count, as before
  return (
    <dl className="wlp-figs" aria-label="Watchlist figures">
      <div><dt>Stocks</dt><dd>{items.length}</dd></div>
      <div><dt>Average change</dt><dd style={{ color: valid.length === 0 ? 'var(--mc-text-4)' : avgChange >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{valid.length === 0 ? '—' : `${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%`}</dd></div>
      <div><dt>Gainers</dt><dd style={{ color: 'var(--mc-bullish)' }}>{gainers}</dd></div>
      <div><dt>Losers</dt><dd style={{ color: 'var(--mc-bearish)' }}>{losers}</dd></div>
    </dl>
  );
}

// ── Empty State Component ──────────────────────────────────────────────────────

export function EmptyState() {
  return (
    <div className="wlp-empty">
      <h2>Your watchlist is empty</h2>
      <p>Add stock tickers with the search box above to start tracking them. Popular tickers: RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK</p>
      {/* PATCH 0303 — Cross-link the institutional channels users can populate
          the watchlist from, so the empty state never feels like a dead end. */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <a href="/earnings-opportunities" className="wlp-btn">Auto-populate from Conviction Beats</a>
        <a href="/screener" className="wlp-btn accent">Find tickers in Screener</a>
      </div>
      <p style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>Your watchlist syncs with @mc_watchlist_pulse_bot</p>
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
  onRetryFlag,
}: {
  items: WatchlistItem[];
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  onRemove: (ticker: string) => void;
  onToggleFlag?: (ticker: string) => void;
  onRetryFlag?: (ticker: string) => void;
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

  // zzz1044 — Day High / Day Low only when the quote source gave them for at least one row (an audit found both blank on every row);
  // a missing value is never shown as 0
  const showHigh = items.some((i) => i.dayHigh != null && i.dayHigh > 0);
  const showLow = items.some((i) => i.dayLow != null && i.dayLow > 0);
  // zzz1013 — a dense terminal table: sticky header, aria-sort on sortable columns (Enter / Space sorts), zebra + hover rows
  const ariaSort = (f: SortField): 'ascending' | 'descending' | 'none' => (sortField === f ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none');
  // a plain function (not a component), so a header keeps keyboard focus across the re-render a sort causes
  const th = ({ field, label, num = false, width }: { field: SortField; label: string; num?: boolean; width?: number }) => (
    <th key={field} className={num ? 'num' : undefined} aria-sort={ariaSort(field)} tabIndex={0} style={width ? { width } : undefined}
      onClick={() => onSort(field)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(field); } }}>
      <span className="wlp-th">{label} <SortIcon field={field} /></span>
    </th>
  );
  return (
    <div className="wlp-tablewrap">
      <table className="wlp-table">
        <thead>
          <tr>
            {th({ field: 'flag', label: 'Flag', width: 56 })}
            {th({ field: 'ticker', label: 'Ticker' })}
            {th({ field: 'company', label: 'Company' })}
            {th({ field: 'sector', label: 'Sector' })}
            {th({ field: 'price', label: 'CMP (₹)', num: true })}
            {th({ field: 'changePercent', label: 'Change%', num: true })}
            {showHigh ? th({ field: 'dayHigh', label: 'Day High', num: true }) : null}
            {showLow ? th({ field: 'dayLow', label: 'Day Low', num: true }) : null}
            {/* zzz1045d — when the price is from (separate from "Last refreshed", when this page read it) */}
            <th className="num" title="When the quote source says the price is from. “last close” = the last NSE closing price; “time not given” = the source gave no time.">Quote time</th>
            {/* PATCH 0442 BUG-020 — Optional columns rendered based on chooser state */}
            {OPTIONAL_COLS.filter(c => activeCols.has(c.id)).map(c => th({ field: c.id as SortField, label: c.label, num: true }))}
            <th className="num" style={{ position: 'relative' }}>
              {/* PATCH 0442 BUG-027 — Working column chooser. Click to toggle
                  popover; select Volume / 52W / Mcap / PE / Avg Vol columns. */}
              <button type="button" className="wlp-btn" style={{ height: 26, padding: '0 9px', fontSize: 11.5 }} aria-expanded={chooserOpen} aria-haspopup="dialog"
                onClick={() => setChooserOpen(o => !o)} title="Configure columns">Columns ({activeCols.size})</button>
              {chooserOpen && (
                <div className="wlp-pop" role="dialog" aria-label="Show columns">
                  <div style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)', padding: '2px 6px 4px' }}>Show columns</div>
                  {OPTIONAL_COLS.map(c => (
                    <label key={c.id}>
                      <input type="checkbox" checked={activeCols.has(c.id)} onChange={() => toggleCol(c.id)} />
                      {c.label}
                    </label>
                  ))}
                  <div style={{ fontSize: 11, color: 'var(--mc-text-4)', padding: '6px 6px 2px', fontWeight: 500, whiteSpace: 'normal' }}>
                    A column shows — when the source doesn&apos;t return that field. % from the 50-day / 200-day average is not offered: the quote feed does not return those averages.
                  </div>
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isPositive = (item.changePercent ?? 0) >= 0;
            const price = item.price != null && item.price > 0 ? item.price : null;   // zzz1000 (CW-01)
            const qt = quoteTimeOf({ price, quoteTime: item.quoteTime, priceSource: item.priceSource, staleEOD: item.staleEOD }, fmtClock);
            return (
              <tr key={item.ticker} data-watchlist-ticker={item.ticker} data-flag={item.flag ? FLAG_NAME[item.flag] || 'on' : undefined}
                data-review={item.reviewPct != null ? (item.reviewPct >= 0 ? 'up' : 'down') : undefined}>
                <td style={{ textAlign: 'center', width: 56 }}>
                  <button type="button" className={`wlp-flag${item.flagStatus === 'saving' ? ' saving' : ''}`} onClick={() => onToggleFlag?.(item.ticker)}
                    title={item.flagStatus === 'saving' ? `Flag: ${item.flag || 'None'} — saving…` : `Flag: ${item.flag || 'None'} (click to cycle)`}
                    aria-label={`Flag for ${item.ticker}: ${item.flag || 'none'}${item.flagStatus === 'saving' ? ', saving' : ''}`} aria-busy={item.flagStatus === 'saving'}>
                    {item.flag || '⚪'}
                  </button>
                  {/* zzz1044c (F09) — a failed save is shown as not saved: the saved flag stays, ⚠ retries the failed one */}
                  {item.flagStatus === 'error' && (
                    <button type="button" className="wlp-flagerr" onClick={() => onRetryFlag?.(item.ticker)}
                      title={`${item.flagFailed || 'No flag'} was not saved — click to retry`} aria-label={`Flag for ${item.ticker} not saved, retry`}>⚠</button>
                  )}
                </td>
                {/* zzz967 (WL-02) — the ticker opens the same instrument on Charts (India list → NSE) */}
                <td>
                  <a className="wlp-tk" href={`/charts?m=${item.market === 'US' ? 'US' : 'IN'}&t=${encodeURIComponent(item.ticker.replace(/^(US|NSE|BSE|BOM|NYSE|NASDAQ|AMEX):/, ''))}`} title={`Open ${item.ticker} on Charts`} aria-label={`Open ${item.ticker} chart`}>{item.ticker}<span aria-hidden className="go">↗</span></a>
                  {(item as any).marketAmbiguous && (
                    /* zzz1076 (B01) — the same symbol trades in India and the USA; the India quote is shown */
                    <span className="wlp-mkt-q" title={`${item.ticker} is listed in India and the USA (different companies). The India quote is shown. To use the USA one, remove it and add US:${item.ticker}; to keep India, add NSE:${item.ticker}.`}
                      style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--mc-warn)', border: '1px solid currentColor', borderRadius: 4, padding: '0 4px' }}>India or USA?</span>
                  )}
                  {item.reviewPct != null && (
                    <span className={`wlp-rv ${item.reviewPct >= 0 ? 'up' : 'down'}`} title="Price change since you last pressed “Mark reviewed”">
                      {item.reviewPct >= 0 ? '+' : ''}{item.reviewPct.toFixed(1)}% since review
                    </span>
                  )}
                </td>
                <td style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--mc-text-1)' }} title={item.company}>
                  {item.company}
                </td>
                <td style={{ color: 'var(--mc-text-3)', fontSize: '12px' }}>{item.sector}</td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {/* PATCH 0559 — BUG-AUDIT-4: when quote came back null/0 render
                      a muted em-dash with a tooltip instead of ₹0.00. */}
                  {price == null ? (
                    <span className="wlp-noq" title="No quote — the data source returned no price for this symbol. Check the symbol (old or demerged?)">no quote</span>
                  ) : isPriceSuspect(item.ticker, price) ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--mc-warn)' }} title="Suspect price - may be incorrect or stale">
                      <AlertTriangle style={{ width: '12px', height: '12px' }} />
                      ₹{price.toFixed(2)}
                    </span>
                  ) : (
                    `₹${price.toFixed(2)}`
                  )}
                </td>
                <td className="num">
                  {/* PATCH 0559 — also blank pct chip when no live price. */}
                  {price == null || item.changePercent == null ? (
                    <span className="wlp-dim" title="Change unavailable">—</span>
                  ) : (
                    <span className={`wlp-chg ${isPositive ? 'up' : 'down'}`}>
                      {isPositive ? <TrendingUp style={{ width: '11px', height: '11px' }} /> : <TrendingDown style={{ width: '11px', height: '11px' }} />}
                      {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                    </span>
                  )}
                </td>
                {showHigh ? <td className="num" style={{ fontSize: '12.5px' }}>
                  {item.dayHigh != null && item.dayHigh > 0 ? `₹${item.dayHigh.toFixed(2)}` : <span className="wlp-dim" title="Day high not given by the quote source">—</span>}
                </td> : null}
                {showLow ? <td className="num" style={{ fontSize: '12.5px' }}>
                  {item.dayLow != null && item.dayLow > 0 ? `₹${item.dayLow.toFixed(2)}` : <span className="wlp-dim" title="Day low not given by the quote source">—</span>}
                </td> : null}
                <td className="num" style={{ fontSize: '12px' }}>
                  <span className={qt.kind === 'time' ? undefined : 'wlp-dim'} title={qt.title}>{qt.kind === 'none' ? '—' : qt.label}</span>
                </td>
                {/* PATCH 0442 BUG-020 — Optional column cells */}
                {OPTIONAL_COLS.filter(c => activeCols.has(c.id)).map(c => {
                  const val = (item as any)[c.id] as number | null | undefined;
                  let txt = '—';
                  if (val != null && Number.isFinite(val)) {
                    if (c.id === 'volume' || c.id === 'avgVolume') txt = formatVolume(val);
                    else if (c.id === 'marketCap') txt = formatMcap(val);
                    else if (c.id === 'peRatio') txt = val.toFixed(1) + 'x';
                    else if (c.id === 'tradedValue') txt = formatTradedValue(val, item.market);
                    else if (c.id === 'pct50' || c.id === 'pct200') txt = `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
                    else txt = `₹${val.toFixed(2)}`;
                  }
                  return (
                    <td key={c.id} className={`num${txt === '—' ? ' wlp-dim' : ''}`} style={{ fontSize: '12.5px' }}>
                      {txt}
                    </td>
                  );
                })}
                <td className="num">
                  <button type="button" className="wlp-x" onClick={() => onRemove(item.ticker)} title="Remove from watchlist" aria-label={`Remove ${item.ticker} from the watchlist`}>
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
        className="wlp-btn" style={{ color: main ? 'var(--mc-text-1)' : 'var(--mc-text-3)', fontWeight: main ? 680 : 600, fontVariantNumeric: 'tabular-nums' }}>
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
