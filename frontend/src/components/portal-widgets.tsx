'use client';

// ─────────────────────────────────────────────────────────────────────────
// PORTAL WIDGETS — PATCH 1071
//
// Bundle of small dependency-free React widgets that close five of the
// HANDOFF6 "next-tier" items in a single drop-in file:
//
//   • TickerTape               — slow-scrolling top tape (Nifty + user list)
//   • PDFExportButton          — one-click "Save as PDF" via window.print()
//   • WatchlistAlertsComposer  — UI to write rules into /api/v1/alerts/*
//   • FIIDIIFlowTile           — daily institutional-flow tile
//   • MacroCalendarTile        — next 5 macro events with surprise badges
//
// Plus a hook + entry-list for the Cmd-K ticker addon:
//   • useWatchlistTickers()    — read tickers from localStorage
//   • watchlistCommandItems()  — pre-built CommandItem[] for <CommandPalette>
//
// Every widget styles itself with the CSS variables shipped in PATCH 1060,
// so a future theme switch automatically rebrands them. None of these
// widgets are wired into layout.tsx by default — see USAGE comments below
// each export for the one-line drop-in.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/design-system';

// ═════════════════════════════════════════════════════════════════════════
// TICKER TAPE
// ═════════════════════════════════════════════════════════════════════════

interface QuoteRow {
  ticker: string;
  name?: string;
  price?: number;
  changePct?: number;
}

const DEFAULT_TAPE_TICKERS = [
  'NIFTY 50', 'NIFTY BANK', 'NIFTY IT', 'NIFTY PHARMA', 'INDIA VIX',
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SHAILY', 'XPROINDIA',
];

function fmt(n: number | undefined, dp = 2): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export interface TickerTapeProps {
  /** Override the default list of symbols. */
  tickers?: string[];
  /** Poll interval in ms; default 60_000 (60s). 0 disables polling. */
  pollMs?: number;
}

/**
 * USAGE — in layout.tsx, just under the existing top nav:
 *   import { TickerTape } from '@/components/portal-widgets';
 *   <TickerTape />
 */
export function TickerTape({ tickers = DEFAULT_TAPE_TICKERS, pollMs = 60_000 }: TickerTapeProps) {
  const [rows, setRows] = useState<QuoteRow[]>(() => tickers.map((t) => ({ ticker: t })));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/market/quotes?market=india', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const all: QuoteRow[] = (j.stocks || j.gainers || []).map((s: any) => ({
        ticker: String(s.ticker || s.symbol || ''),
        name: s.company || s.name,
        price: typeof s.price === 'number' ? s.price : Number(s.cmp || s.lastPrice),
        changePct: typeof s.changePct === 'number' ? s.changePct : Number(s.pChange || s.change),
      }));
      // Prefer the requested order; fill missing with the API payload.
      const byTicker = new Map(all.map((r) => [r.ticker.toUpperCase(), r]));
      const ordered = tickers.map((t) => byTicker.get(t.toUpperCase()) || { ticker: t });
      setRows(ordered);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, [tickers]);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  // Render twice in a row so the marquee loops seamlessly.
  const items = useMemo(() => [...rows, ...rows], [rows]);

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderTop: '1px solid var(--mc-border-0)',
        borderBottom: '1px solid var(--mc-border-0)',
        background: 'var(--mc-bg-1)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
      }}
      role="status"
      aria-label="Live ticker tape"
      data-mc-no-print
    >
      <div
        style={{
          display: 'inline-flex',
          gap: 28,
          padding: '6px 0',
          whiteSpace: 'nowrap',
          animation: 'mc-tape-scroll 70s linear infinite',
        }}
      >
        {items.map((r, i) => {
          const up = (r.changePct ?? 0) >= 0;
          const c = error
            ? 'var(--mc-text-4)'
            : up
              ? 'var(--mc-bullish)'
              : 'var(--mc-bearish)';
          return (
            <span key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--mc-text-2)' }}>{r.ticker}</span>
              <span style={{ color: 'var(--mc-text-0)' }}>{fmt(r.price)}</span>
              {r.changePct != null && (
                <span style={{ color: c }}>
                  {up ? '+' : ''}
                  {fmt(r.changePct, 2)}%
                </span>
              )}
            </span>
          );
        })}
      </div>
      <style jsx>{`
        @keyframes mc-tape-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// PDF EXPORT BUTTON
// ═════════════════════════════════════════════════════════════════════════

export interface PDFExportButtonProps {
  /** Visible label; defaults to "📄 Export PDF". */
  label?: string;
  /** Optional CSS class to override the default chip styling. */
  className?: string;
}

/**
 * USAGE — drop into any page header:
 *   import { PDFExportButton } from '@/components/portal-widgets';
 *   <PDFExportButton />
 *
 * Pairs with the print stylesheet shipped in design-system.css (PATCH 1060)
 * to hide nav/sidebar and render tables clean on A4.
 */
export function PDFExportButton({ label = '📄 Export PDF', className }: PDFExportButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={className}
      data-mc-no-print
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 800,
        border: '1px solid var(--mc-border-2)',
        borderRadius: 'var(--mc-radius-sm)',
        background: 'var(--mc-bg-3)',
        color: 'var(--mc-text-1)',
        cursor: 'pointer',
        letterSpacing: 0.3,
      }}
      title="Open the OS print dialog; choose 'Save as PDF' for a clean A4 export"
    >
      {label}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// WATCHLIST ALERTS COMPOSER
// ═════════════════════════════════════════════════════════════════════════

export interface AlertRule {
  id: string;
  name: string;
  ticker: string;
  /** Plain-English condition; the dispatcher just echoes it. */
  condition: string;
  enabled: boolean;
  createdAt: string;
}

const RULES_KEY = 'mc:alert-rules:v1';

function loadRules(): AlertRule[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(RULES_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((r) => r && r.id && r.ticker);
  } catch {}
  return [];
}
function saveRules(rules: AlertRule[]) {
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {}
}

/**
 * USAGE — paste into any "/alerts" or "/watchlists" page:
 *   import { WatchlistAlertsComposer } from '@/components/portal-widgets';
 *   <WatchlistAlertsComposer />
 *
 * "Test fire" POSTs to /api/v1/alerts/dispatch with the configured CRON_SECRET
 * from window.prompt — your existing Telegram dispatcher delivers the message.
 */
export function WatchlistAlertsComposer() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [ticker, setTicker] = useState('');
  const [condition, setCondition] = useState('');
  const [name, setName] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    setRules(loadRules());
  }, []);

  const add = () => {
    if (!ticker.trim() || !condition.trim()) {
      toast({ title: 'Need ticker + condition', tone: 'warn' });
      return;
    }
    const rule: AlertRule = {
      id: `r${Date.now()}`,
      name: name.trim() || `${ticker.toUpperCase()}: ${condition}`.slice(0, 60),
      ticker: ticker.toUpperCase(),
      condition: condition.trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const next = [rule, ...rules];
    setRules(next);
    saveRules(next);
    setTicker('');
    setCondition('');
    setName('');
    toast({ title: `Saved "${rule.name}"`, tone: 'ok' });
  };

  const remove = (id: string) => {
    const next = rules.filter((r) => r.id !== id);
    setRules(next);
    saveRules(next);
  };

  const toggle = (id: string) => {
    const next = rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    setRules(next);
    saveRules(next);
  };

  const testFire = async (rule: AlertRule) => {
    const secret = window.prompt('Paste CRON_SECRET to test-fire this rule:');
    if (!secret) return;
    try {
      const r = await fetch(`/api/v1/alerts/dispatch?secret=${encodeURIComponent(secret)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rule: { id: rule.id, name: rule.name },
          article: {
            title: `${rule.ticker}: ${rule.condition}`,
            source: 'Composer test',
            published_at: new Date().toISOString(),
            ticker_symbols: [rule.ticker],
          },
          triggeredAt: new Date().toISOString(),
        }),
      });
      const j = await r.json();
      toast({
        title: r.ok ? `Dispatched: ${JSON.stringify(j).slice(0, 100)}` : `Failed: ${r.status}`,
        tone: r.ok ? 'ok' : 'err',
      });
    } catch (e: any) {
      toast({ title: 'Network error', description: String(e?.message || e), tone: 'err' });
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: 'var(--mc-bg-3)',
    border: '1px solid var(--mc-border-0)',
    borderRadius: 'var(--mc-radius-sm)',
    padding: '6px 8px',
    color: 'var(--mc-text-0)',
    fontSize: 12,
  };

  return (
    <div
      style={{
        background: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-0)',
        borderRadius: 'var(--mc-radius-lg)',
        padding: 14,
      }}
    >
      <h3 style={{ margin: 0, color: 'var(--mc-text-0)', fontSize: 'var(--mc-text-h3)' }}>
        🔔 Watchlist alert rules
      </h3>
      <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', marginTop: 4 }}>
        Compose plain-English rules; "Test fire" sends to Telegram via the dispatcher.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          placeholder="Ticker (e.g. SHAILY)"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          style={{ ...inputStyle, maxWidth: 140 }}
        />
        <input
          placeholder="Condition (e.g. close < 50DMA for 3 days)"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          style={inputStyle}
        />
        <input
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, maxWidth: 200 }}
        />
        <button
          onClick={add}
          style={{
            background: 'var(--mc-accent)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--mc-radius-sm)',
            padding: '6px 14px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Add rule
        </button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, marginTop: 12 }}>
        {rules.length === 0 ? (
          <li style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-sm)', padding: '6px 0' }}>
            No rules yet. Add one above.
          </li>
        ) : (
          rules.map((r) => (
            <li
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderBottom: '1px solid var(--mc-border-0)',
                fontSize: 12,
                color: r.enabled ? 'var(--mc-text-1)' : 'var(--mc-text-4)',
              }}
            >
              <span style={{ fontFamily: 'ui-monospace, monospace', minWidth: 80 }}>{r.ticker}</span>
              <span style={{ flex: 1 }}>{r.condition}</span>
              <button
                onClick={() => toggle(r.id)}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  background: r.enabled ? 'var(--mc-bullish)' : 'var(--mc-text-4)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--mc-radius-sm)',
                  cursor: 'pointer',
                }}
                title={r.enabled ? 'Click to disable' : 'Click to enable'}
              >
                {r.enabled ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => testFire(r)}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  background: 'transparent',
                  color: 'var(--mc-cyan)',
                  border: '1px solid var(--mc-cyan)',
                  borderRadius: 'var(--mc-radius-sm)',
                  cursor: 'pointer',
                }}
              >
                Test fire
              </button>
              <button
                onClick={() => remove(r.id)}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  background: 'transparent',
                  color: 'var(--mc-bearish)',
                  border: '1px solid var(--mc-bearish)',
                  borderRadius: 'var(--mc-radius-sm)',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// FII / DII FLOW TILE
// ═════════════════════════════════════════════════════════════════════════

interface FlowRow { day: string; fii: number; dii: number }

/**
 * USAGE — drop on the dashboard home or breadth page:
 *   import { FIIDIIFlowTile } from '@/components/portal-widgets';
 *   <FIIDIIFlowTile />
 *
 * Tries `/api/v1/fii-dii` first; falls back to `/api/market/fii-dii`. Both
 * endpoints are optional — if neither exists, the tile shows a "not yet
 * wired" empty state instead of crashing.
 */
export function FIIDIIFlowTile() {
  const [rows, setRows] = useState<FlowRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      for (const url of ['/api/v1/fii-dii', '/api/market/fii-dii']) {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) continue;
          const j = await r.json();
          const list = (j?.rows || j?.data || j?.flows || []).map((x: any) => ({
            day: String(x.day || x.date),
            fii: Number(x.fii ?? x.fiiNet ?? 0),
            dii: Number(x.dii ?? x.diiNet ?? 0),
          }));
          if (list.length > 0) {
            setRows(list);
            return;
          }
        } catch {}
      }
      setErr('no data endpoint wired');
    })();
  }, []);

  const total = useMemo(() => {
    if (!rows) return null;
    return rows.reduce(
      (acc, r) => ({ fii: acc.fii + r.fii, dii: acc.dii + r.dii }),
      { fii: 0, dii: 0 },
    );
  }, [rows]);

  return (
    <div
      style={{
        background: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-0)',
        borderRadius: 'var(--mc-radius-lg)',
        padding: 14,
        minWidth: 260,
      }}
    >
      <h3 style={{ margin: 0, color: 'var(--mc-text-0)', fontSize: 'var(--mc-text-h3)' }}>
        🏛 FII / DII Net Flow
      </h3>
      {err ? (
        <p style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-sm)', marginTop: 6 }}>
          {err} — see HANDOFF7 for the route stub.
        </p>
      ) : !rows ? (
        <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', marginTop: 6 }}>loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
            <Stat label="FII (Cr)" value={total!.fii} />
            <Stat label="DII (Cr)" value={total!.dii} />
            <Stat label="Net (Cr)" value={total!.fii + total!.dii} highlight />
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, marginTop: 10 }}>
            {rows.slice(0, 5).map((r, i) => (
              <li
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 1fr',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, monospace',
                  color: 'var(--mc-text-2)',
                  borderTop: '1px solid var(--mc-border-0)',
                  padding: '4px 0',
                }}
              >
                <span>{r.day}</span>
                <span style={{ textAlign: 'right', color: r.fii >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
                  {fmt(r.fii, 0)}
                </span>
                <span style={{ textAlign: 'right', color: r.dii >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
                  {fmt(r.dii, 0)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const col = value >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  return (
    <div style={{ flex: 1 }}>
      <div style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-xs)' }}>{label}</div>
      <div
        style={{
          fontSize: highlight ? 16 : 14,
          fontWeight: 800,
          color: col,
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        {value >= 0 ? '+' : ''}
        {fmt(value, 0)}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// MACRO CALENDAR TILE
// ═════════════════════════════════════════════════════════════════════════

interface MacroEvent {
  day: string;
  name: string;
  source: string;
  /** Optional "actual vs consensus" payload. */
  actual?: number;
  consensus?: number;
}

/**
 * USAGE — paste into a sidebar:
 *   import { MacroCalendarTile } from '@/components/portal-widgets';
 *   <MacroCalendarTile />
 *
 * Pulls from `/api/v1/calendar` (the existing endpoint already returns
 * counts but not events; this widget tolerates an empty payload).
 */
export function MacroCalendarTile() {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/v1/calendar', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const evs: MacroEvent[] = (j.events || j.macro || []).map((x: any) => ({
          day: String(x.day || x.date),
          name: String(x.name || x.event),
          source: String(x.source || 'macro'),
          actual: typeof x.actual === 'number' ? x.actual : undefined,
          consensus: typeof x.consensus === 'number' ? x.consensus : undefined,
        }));
        setEvents(evs.slice(0, 5));
      } catch (e: any) {
        setErr(String(e?.message || e));
      }
    })();
  }, []);

  const surprise = useMemo(() => {
    const printed = events.filter((e) => e.actual != null && e.consensus != null);
    if (printed.length === 0) return null;
    const score = printed.reduce(
      (acc, e) => acc + Math.sign(e.actual! - e.consensus!),
      0,
    );
    return { score, count: printed.length };
  }, [events]);

  return (
    <div
      style={{
        background: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-0)',
        borderRadius: 'var(--mc-radius-lg)',
        padding: 14,
        minWidth: 260,
      }}
    >
      <h3 style={{ margin: 0, color: 'var(--mc-text-0)', fontSize: 'var(--mc-text-h3)' }}>
        🗓 Macro Calendar
      </h3>
      {surprise && (
        <div style={{ marginTop: 6, color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)' }}>
          3-event surprise score:{' '}
          <strong style={{ color: surprise.score >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
            {surprise.score >= 0 ? '+' : ''}{surprise.score}
          </strong>{' '}
          / {surprise.count}
        </div>
      )}
      {err && (
        <p style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-sm)' }}>{err}</p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, marginTop: 8 }}>
        {events.length === 0 && !err ? (
          <li style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-sm)' }}>
            No upcoming events.
          </li>
        ) : (
          events.map((e, i) => (
            <li
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 1fr',
                fontSize: 12,
                color: 'var(--mc-text-1)',
                padding: '4px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--mc-border-0)',
              }}
            >
              <span style={{ color: 'var(--mc-cyan)', fontFamily: 'ui-monospace, monospace' }}>
                {e.day}
              </span>
              <span>{e.name}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// CMD-K TICKER ADDON
// ═════════════════════════════════════════════════════════════════════════

/**
 * Reads the user's watchlist tickers from localStorage so the existing
 * CommandPalette can offer them as quick-jump items.
 *
 * USAGE — in layout.tsx (or wherever CommandPalette is mounted):
 *   import { watchlistCommandItems } from '@/components/portal-widgets';
 *   <CommandPalette extraItems={watchlistCommandItems()} />
 *
 * Each item navigates to /stock-sheet?ticker=<TICKER>.
 */
export function useWatchlistTickers(): string[] {
  const [tickers, setTickers] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('mc:watchlist:v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const list: string[] = Array.isArray(parsed)
        ? parsed.map((x: any) => String(x.ticker || x).toUpperCase()).filter(Boolean)
        : [];
      setTickers(list.slice(0, 50));
    } catch {}
  }, []);
  return tickers;
}

export function watchlistCommandItems(extra: string[] = []) {
  // Server-rendered callers can't read localStorage; they pass an empty list.
  const raw =
    typeof window !== 'undefined'
      ? (() => {
          try {
            const r = window.localStorage.getItem('mc:watchlist:v1');
            if (!r) return [] as string[];
            const p = JSON.parse(r);
            return Array.isArray(p) ? p.map((x: any) => String(x.ticker || x).toUpperCase()) : [];
          } catch {
            return [] as string[];
          }
        })()
      : ([] as string[]);
  const all = Array.from(new Set([...raw, ...extra.map((x) => x.toUpperCase())])).filter(Boolean);
  return all.map((t) => ({
    label: t,
    hint: 'open Stock Sheet',
    url: `/stock-sheet?ticker=${encodeURIComponent(t)}`,
    keywords: 'ticker stock',
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// END portal-widgets.tsx
// ═════════════════════════════════════════════════════════════════════════
