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
import { Copy, Download, ExternalLink, FileSpreadsheet } from 'lucide-react';
// PATCH 1050 — One-click Excel (.xlsx) export of the full conviction bench.
// SheetJS is already a dependency (used by /portfolio + screener imports).
import * as XLSX from 'xlsx';

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
  /** PATCH 0366 — Optional mapping ticker -> company name. Used by the
   *  Screener.in export buttons to copy human-readable names (which
   *  Screener matches better than NSE tickers like 'EBGNG' or '360ONE'). */
  tickerCompanyMap?: Record<string, string>;
}

export default function TickerExportToolbar({
  tickers,
  groups,
  exchange = 'NSE',
  filenameHint = 'tickers',
  compact = false,
  tickerCompanyMap,
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

  // PATCH 0436 — Auto-prefix exchange per ticker. User reported pasting
  // a mixed list (BSE numeric codes 523850/524717 + named NSE symbols like
  // LUMAXTECH) into TradingView fails because we naively prefix all with
  // 'NSE:'. TradingView accepts 'BSE:523850' but rejects 'NSE:523850'.
  // Heuristic: 6-digit numeric ticker → BSE: prefix; alphabetic → NSE: prefix.
  // Caller-supplied `exchange` prop still wins when set explicitly.
  const tvSymbolFor = (raw: string): string => {
    const t = raw.toUpperCase().trim();
    // Strip any existing exchange prefix
    const bare = t.replace(/^(NSE|BSE|NYSE|NASDAQ):/i, '');
    // If caller pinned a non-default exchange, honor it
    if (exchange !== 'NSE') return `${exchange}:${bare}`;
    // 6-digit pure-numeric → BSE scrip code
    if (/^\d{6}$/.test(bare)) return `BSE:${bare}`;
    // Default: NSE
    return `NSE:${bare}`;
  };

  const copyTradingView = async (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to copy`); return; }
    const tv = subset.map(tvSymbolFor).join(',');
    try {
      await navigator.clipboard.writeText(tv);
      const bseCount = subset.filter(t => /^\d{6}$/.test(t.toUpperCase().trim().replace(/^(NSE|BSE):/i, ''))).length;
      const msg = bseCount > 0
        ? `Copied ${subset.length} tickers (${bseCount} BSE numeric, ${subset.length - bseCount} NSE) for TradingView`
        : `Copied ${subset.length} ${label} ticker${subset.length === 1 ? '' : 's'} for TradingView`;
      toast.success(msg);
    } catch {
      toast.error('Clipboard write failed — check browser permission');
    }
  };

  const downloadTxt = (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to download`); return; }
    // PATCH 0436 — per-ticker BSE/NSE auto-prefix
    const txt = subset.map(tvSymbolFor).join('\n');
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
    // PATCH 0436 — per-ticker BSE/NSE auto-prefix
    const first = tvSymbolFor(subset[0]);
    const tv = subset.map(tvSymbolFor).join(',');
    navigator.clipboard.writeText(tv).catch(() => {});
    window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(first)}`, '_blank', 'noopener,noreferrer');
    toast.success(`Opened ${first} · ${subset.length} tickers copied for paste`);
  };

  // PATCH 0364 / 0365 / 0366 / 0368 — Screener.in export.
  //
  // CRITICAL FORMAT: Screener.in's "Add stocks" bulk-import field treats
  // each LINE as one entry. A comma-separated string is interpreted as a
  // single name → "Found automatically: 0, Unmatched: 1".
  //
  // PATCH 0366 — Use COMPANY NAMES (when available) not raw NSE tickers.
  // Screener's fuzzy matcher is built around company-name matching.
  //
  // PATCH 0368 — Two fixes from user import-failure report:
  //   (A) Decode HTML entities. Company names scraped from HTML pages
  //       retain encoded ampersands etc. ('Lloyds Metals &amp; Energy').
  //       Screener doesn't decode them, the match fails. Decode at the
  //       boundary so the output is clean text.
  //   (B) Detect ticker-as-company fallback. When the enrich path can't
  //       find a real company name it defaults to ticker (so
  //       tickerCompanyMap['KRISHANA'] === 'KRISHANA'). Emitting that
  //       sends a bare ticker to Screener which its fuzzy matcher rejects
  //       for many small-caps. Trim the suffixes anyway but if we get
  //       just the ticker back, still emit it — at least the user can
  //       manually pick from Screener's unmatched list.

  const decodeHtmlEntities = (s: string): string => {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  };
  const normalizeForScreener = (name: string): string => {
    return decodeHtmlEntities(name)
      .replace(/\s+(Limited|Ltd\.?|Inc\.?|Corporation|Corp\.?|Company|Co\.?|PLC)$/i, '')
      .replace(/[\.,]/g, '')
      .trim();
  };
  const screenerLine = (ticker: string): string => {
    const co = tickerCompanyMap?.[ticker.toUpperCase()];
    const upTicker = ticker.toUpperCase();
    // (B) when company name equals the ticker (or is empty), there's no
    // real name to send — emit the bare ticker so user can manually
    // match it in Screener's unmatched panel.
    if (!co || !co.trim() || co.trim().toUpperCase() === upTicker) {
      return upTicker;
    }
    return normalizeForScreener(co);
  };

  const copyForScreener = async (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to copy`); return; }
    // Newline-separated, one entry per line — Screener.in's expected format.
    // Use company names when we have them (much better Screener match rate).
    const text = subset.map(screenerLine).join('\n');
    const havingNames = subset.filter(t => tickerCompanyMap?.[t.toUpperCase()]).length;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        havingNames > 0
          ? `Copied ${subset.length} names (${havingNames} as company names, ${subset.length - havingNames} as tickers) — paste into Screener.in`
          : `Copied ${subset.length} tickers (one per line) — paste into Screener.in`
      );
    } catch {
      toast.error('Clipboard write failed — check browser permission');
    }
  };

  const openInScreener = (subset: string[]) => {
    if (subset.length === 0) { toast.error(`No tickers to open`); return; }
    // For a single ticker, jump straight to its Screener page using the
    // bare ticker — Screener's URL format expects the symbol, not the name.
    if (subset.length === 1) {
      const url = `https://www.screener.in/company/${encodeURIComponent(subset[0])}/consolidated/`;
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success(`Opened ${subset[0]} on Screener.in`);
      return;
    }
    // For multiple: copy as company names (newline-separated!), open watchlist.
    const text = subset.map(screenerLine).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    window.open('https://www.screener.in/watchlist/', '_blank', 'noopener,noreferrer');
    toast.success(`${subset.length} entries copied (one per line) · paste into your Screener.in watchlist`);
  };

  // PATCH 0371 — Download a Screener-friendly CSV. User reported Screener.in
  // serving 502 Bad Gateway on bulk-import; this gives them a portable file
  // they can keep, open in Excel, re-upload later, or paste anywhere.
  //
  // PATCH 0871 — Original output was rejected by Screener.in import with
  // "We couldn't find any ISIN codes in the given file". Root cause: header
  // was a generic `Ticker` and the column mixed 6-digit BSE numeric scrip
  // codes (`538897`) with alphabetic NSE symbols (`KDDL`). Screener.in's
  // importer is column-header-aware: it accepts a column literally headed
  // `BSE Code`, `NSE Code`, or `ISIN`, but won't recognise heterogeneous
  // values under a generic header.
  //
  // Fix: route each ticker into the correct column based on its shape and
  // emit BOTH columns (one will be empty per row). Screener.in then picks
  // the matching code automatically. `Name` column stays for human use in
  // Excel — Screener.in ignores unknown columns.
  //
  // Format:
  //   Header row:  Name,NSE Code,BSE Code
  //   Data rows:   "KDDL",KDDL,
  //                "Shri Niwas Leasing & Finance",,538897
  //                "Lloyds Metals & Energy",LLOYDSME,    ← entities decoded, suffix stripped
  const downloadScreenerCsv = (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to download`); return; }
    const rows: string[] = ['Name,NSE Code,BSE Code'];
    let nameCount = 0;
    let bseCount = 0;
    let nseCount = 0;
    for (const t of subset) {
      const upT = t.toUpperCase().trim();
      const co = tickerCompanyMap?.[upT];
      let name: string;
      if (co && co.trim() && co.trim().toUpperCase() !== upT) {
        name = normalizeForScreener(co);
        nameCount++;
      } else {
        name = upT;
      }
      // 6-digit pure-numeric → BSE scrip code. Anything else → NSE symbol.
      const isBse = /^\d{6}$/.test(upT);
      const nseCol = isBse ? '' : upT;
      const bseCol = isBse ? upT : '';
      if (isBse) bseCount++; else nseCount++;
      // CSV-quote any value containing commas, quotes, or newlines
      const csvQuote = (s: string) => {
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      rows.push(`${csvQuote(name)},${csvQuote(nseCol)},${csvQuote(bseCol)}`);
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameHint}_screener_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${subset.length} rows (${nseCount} NSE + ${bseCount} BSE, ${nameCount} with names) — ready for Screener.in import`);
  };

  // PATCH 1050 — One-click Excel (.xlsx) export of the full bench.
  //
  // Unlike the CSV/txt exports (ticker-only), this produces a rich, formatted
  // workbook with every piece of content we have for the current filtered list:
  //   #, Ticker, Company, NSE Code, BSE Code, Tier, Conviction, Exchange
  // Tier + Conviction are derived from the `groups` prop (tier groupings such
  // as BLOCKBUSTER/STRONG/EXCELLENT plus the 'Conviction' overlay group), so
  // the sheet reflects exactly what the user sees on screen. Built fully
  // client-side via SheetJS and downloaded immediately on click.
  const tierForTicker = (up: string): string => {
    if (!groups) return '';
    for (const g of groups) {
      if (/conviction/i.test(g.label)) continue; // conviction handled as its own column
      if (g.tickers.some((x) => x.toUpperCase().trim() === up)) return g.label;
    }
    return '';
  };

  const downloadXlsx = (subset: string[], label: string) => {
    if (subset.length === 0) { toast.error(`No ${label} tickers to export`); return; }
    const convictionSet = new Set<string>(
      (groups || [])
        .filter((g) => /conviction/i.test(g.label))
        .flatMap((g) => g.tickers.map((t) => t.toUpperCase().trim()))
    );
    const header = ['#', 'Ticker', 'Company', 'NSE Code', 'BSE Code', 'Tier', 'Conviction', 'Exchange'];
    const aoa: (string | number)[][] = [header];
    subset.forEach((t, i) => {
      const up = t.toUpperCase().trim();
      const bare = up.replace(/^(NSE|BSE|NYSE|NASDAQ):/i, '');
      const isBse = /^\d{6}$/.test(bare);
      const co = tickerCompanyMap?.[up];
      const name = co && co.trim() && co.trim().toUpperCase() !== bare ? decodeHtmlEntities(co.trim()) : '';
      aoa.push([
        i + 1,
        bare,
        name,
        isBse ? '' : bare,
        isBse ? bare : '',
        tierForTicker(up),
        convictionSet.has(up) ? 'Yes' : 'No',
        isBse ? 'BSE' : 'NSE',
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Column widths for a clean, readable sheet.
    ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 11 }, { wch: 10 }];
    // Auto-filter across the whole table + freeze the header row.
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: header.length - 1 } }) };
    (ws as any)['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Conviction Beats');
    const fname = `${filenameHint}_${label}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success(`Downloaded ${subset.length} rows as Excel (.xlsx)`);
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
      backgroundColor: 'var(--mc-bg-1)',
      border: '2px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)',
      borderRadius: 12,
      boxShadow: '0 0 0 1px color-mix(in srgb, var(--mc-cyan) 8%, transparent)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 6,
          backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)',
        }}>
          <Copy style={{ width: 13, height: 13, color: 'var(--mc-cyan)' }} />
          <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-cyan)', letterSpacing: '0.6px' }}>
            EXPORT {n} TICKER{n === 1 ? '' : 'S'}
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--mc-text-3)', flex: 1 }}>
          Copy/download the current filtered list — paste into TradingView, Excel, or anywhere
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* PATCH 1050 — One-click Excel export. Most prominent button: builds a
            formatted .xlsx of the full bench (ticker, company, NSE/BSE code,
            tier, conviction) and downloads it immediately. */}
        <button
          onClick={() => downloadXlsx(safeTickers, 'All')}
          disabled={n === 0}
          title={`Download all ${n} rows as a formatted Excel (.xlsx) — columns: Ticker, Company, NSE/BSE Code, Tier, Conviction. Opens in Excel/Sheets.`}
          style={{ ...btnBase, border: '1px solid #1D6F42', background: '#1D6F42', color: '#FFFFFF' }}
        >
          <FileSpreadsheet style={{ width: 14, height: 14 }} />
          Download Excel (.xlsx)
        </button>

        <button
          onClick={() => copyTradingView(safeTickers, 'All')}
          disabled={n === 0}
          title={`Copy all ${n} tickers with ${exchange}: prefix — paste directly into TradingView watchlist`}
          style={{ ...btnBase, border: '1px solid var(--mc-cyan)', background: 'var(--mc-cyan)', color: 'var(--mc-bg-0)' }}
        >
          <Copy style={{ width: 14, height: 14 }} />
          Copy for TradingView
        </button>

        <button
          onClick={() => copyCsv(safeTickers, 'All')}
          disabled={n === 0}
          title={`Copy ${n} tickers as plain comma-separated list (no prefix) — for Excel, sheets, or other tools`}
          style={{ ...btnBase, border: '1px solid var(--mc-bg-4)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-2)' }}
        >
          <Copy style={{ width: 14, height: 14 }} />
          Copy CSV
        </button>

        <button
          onClick={() => downloadTxt(safeTickers, 'All')}
          disabled={n === 0}
          title={`Download ${n} tickers as .txt file (with ${exchange}: prefix)`}
          style={{ ...btnBase, border: '1px solid var(--mc-bg-4)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-2)' }}
        >
          <Download style={{ width: 14, height: 14 }} />
          Download .txt
        </button>

        <button
          onClick={() => openInTradingView(safeTickers)}
          disabled={n === 0}
          title="Open first ticker in TradingView chart + copy full list for paste into a new watchlist"
          style={{ ...btnBase, border: '1px solid var(--mc-bullish)', background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)' }}
        >
          <ExternalLink style={{ width: 14, height: 14 }} />
          Open in TradingView
        </button>

        {/* PATCH 0364 — Screener.in export. Two buttons mirroring the
            TradingView pair: 'Copy for Screener' (bare symbols, paste-ready)
            and 'Open in Screener.in' (one ticker → company page, many tickers
            → opens watchlist page with list copied). */}
        <button
          onClick={() => copyForScreener(safeTickers, 'All')}
          disabled={n === 0}
          title={`Copy ${n} tickers as bare comma-separated symbols — paste into a Screener.in watchlist`}
          style={{ ...btnBase, border: '1px solid var(--mc-state-persistent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)' }}
        >
          <Copy style={{ width: 14, height: 14 }} />
          Copy for Screener
        </button>
        <button
          onClick={() => openInScreener(safeTickers)}
          disabled={n === 0}
          title={n === 1
            ? `Open ${safeTickers[0]} on Screener.in`
            : `Copy ${n} tickers + open Screener.in watchlist page`}
          style={{ ...btnBase, border: '1px solid var(--mc-state-persistent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)' }}
        >
          <ExternalLink style={{ width: 14, height: 14 }} />
          {n === 1 ? 'Open on Screener' : 'Open in Screener.in'}
        </button>
        {/* PATCH 0371 — Portable CSV for Screener. Useful when Screener.in
            web import is down (502/timeout) or for offline backup. Two
            columns: Name (resolved + decoded + suffix-stripped), Ticker. */}
        <button
          onClick={() => downloadScreenerCsv(safeTickers, 'All')}
          disabled={n === 0}
          title={`Download ${n} rows as CSV — columns: Name, Ticker. Use as backup when Screener.in is slow or as portable list.`}
          style={{ ...btnBase, border: '1px solid var(--mc-state-persistent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 6%, transparent)', color: 'var(--mc-state-persistent)' }}
        >
          <Download style={{ width: 14, height: 14 }} />
          Download Screener CSV
        </button>
      </div>

      {/* Tier-grouped quick copy chips */}
      {groups && groups.length > 0 && groups.some((g) => g.tickers.length > 0) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          paddingTop: 6, borderTop: '1px dashed var(--mc-bg-4)',
        }}>
          <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px', marginRight: 2 }}>
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
