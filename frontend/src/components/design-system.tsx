'use client';

// ─────────────────────────────────────────────────────────────────────────
// DESIGN SYSTEM PRIMITIVES — PATCH 1061 (HANDOFF4)
//
// Single entry-point for the four primitives DESIGN_AUDIT.md ranked top:
//   • Toast / useToast      (audit #2 + #7)
//   • EmptyState            (audit #5)
//   • Tooltip               (audit #4)
//   • CommandPalette (⌘K)   (audit #1)
//
// All four are dependency-free: only React + the styles in
// styles/design-system.css. They render on the client (no SSR-required state)
// and are safe to mount inside the existing Providers tree at the root layout.
//
// USAGE
// ─────
// 1. layout.tsx (already in PATCH 1061 layout-update commit):
//      import { ToastProvider, CommandPalette } from '@/components/design-system';
//      <ToastProvider>
//        <CommandPalette />
//        {children}
//      </ToastProvider>
//
// 2. Any client component:
//      import { useToast } from '@/components/design-system';
//      const { toast } = useToast();
//      toast({ title: 'Copied 42 tickers', tone: 'ok' });
//
// 3. EmptyState / Tooltip:
//      import { EmptyState, Tooltip } from '@/components/design-system';
//      <EmptyState icon="📭" title="No earnings filings" hint="Try a wider date range" />
//      <Tooltip label="Return on Capital Employed">ROCE</Tooltip>
// ─────────────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

// ═════════════════════════════════════════════════════════════════════════
// TOAST
// ═════════════════════════════════════════════════════════════════════════

export type ToastTone = 'ok' | 'warn' | 'err' | 'info';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastRecord extends ToastInput {
  id: number;
  tone: ToastTone;
  durationMs: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let __toastSeq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const tm = timersRef.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++__toastSeq;
      const rec: ToastRecord = {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? 'info',
        durationMs: input.durationMs ?? 4500,
      };
      setToasts((prev) => [...prev, rec]);
      const tm = setTimeout(() => dismiss(id), rec.durationMs);
      timersRef.current.set(id, tm);
      return id;
    },
    [dismiss],
  );

  // Clean up timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((tm) => clearTimeout(tm));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="mc-toast-region"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`mc-toast mc-toast--${t.tone}`}
            role={t.tone === 'err' ? 'alert' : 'status'}
            onClick={() => dismiss(t.id)}
          >
            <div style={{ fontWeight: 600, marginBottom: t.description ? 4 : 0 }}>
              {t.title}
            </div>
            {t.description ? (
              <div style={{ color: 'var(--mc-text-3)' }}>{t.description}</div>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // Safe no-op when ToastProvider isn't mounted (e.g., login screen)
  return {
    toast: () => -1,
    dismiss: () => {},
  };
}

// ═════════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ═════════════════════════════════════════════════════════════════════════

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  hint?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  /** Vertical padding multiplier. Default 6 = comfy. Use 3 for inline panels. */
  pad?: number;
}

export function EmptyState({ icon = '📭', title, hint, action, pad = 6 }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--mc-space-3)',
        padding: `calc(var(--mc-space-4) * ${pad}) var(--mc-space-4)`,
        color: 'var(--mc-text-3)',
        textAlign: 'center',
      }}
      role="status"
    >
      <div style={{ fontSize: 36, lineHeight: 1, opacity: 0.85 }} aria-hidden>
        {icon}
      </div>
      <div
        style={{
          color: 'var(--mc-text-1)',
          fontSize: 'var(--mc-text-h3)',
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {hint ? (
        <div style={{ fontSize: 'var(--mc-text-sm)', maxWidth: 420 }}>{hint}</div>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mc-tap"
          style={{
            marginTop: 'var(--mc-space-2)',
            padding: '6px 14px',
            background: 'var(--mc-accent)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--mc-radius)',
            fontSize: 'var(--mc-text-sm)',
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// TOOLTIP
// ═════════════════════════════════════════════════════════════════════════

export interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Tooltip side relative to trigger. Default: 'top'. */
  side?: 'top' | 'bottom';
}

export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    cursor: 'help',
  };
  const bubbleStyle: React.CSSProperties = {
    [side === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
    left: '50%',
    transform: 'translateX(-50%)',
  };
  return (
    <span
      style={triggerStyle}
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      <span className="mc-tooltip-trigger">{children}</span>
      {open ? (
        <span id={id} role="tooltip" className="mc-tooltip-bubble" style={bubbleStyle}>
          {label}
        </span>
      ) : null}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// COMMAND PALETTE (⌘K)
// ═════════════════════════════════════════════════════════════════════════

export interface CommandItem {
  label: string;
  hint?: string;
  url?: string;
  onSelect?: () => void;
  keywords?: string;
}

const DEFAULT_PAGES: CommandItem[] = [
  { label: 'Home',                 url: '/' },
  { label: 'News',                 url: '/news' },
  { label: 'In-Play',              url: '/in-play' },
  { label: 'News Alerts',          url: '/news-alerts' },
  { label: 'Bottleneck Intel',     url: '/bottleneck-intel' },
  { label: 'Critical Themes',      url: '/critical-themes' },
  { label: 'Earnings Hub',         url: '/earnings-hub' },
  { label: 'Earnings Opportunities', url: '/earnings-opportunities' },
  { label: 'Earnings Calendar',    url: '/calendars' },
  { label: 'Earnings Analysis',    url: '/earnings-analysis' },
  { label: 'Earnings Trigger',     url: '/earnings-trigger' },
  { label: 'Guidance Extractor',   url: '/guidance-extractor' },
  { label: 'Concall Intel',        url: '/concall-intel' },
  { label: 'Company Intel',        url: '/company-intel' },
  { label: 'Capex Tracker',        url: '/capex-tracker' },
  { label: 'Multibagger',          url: '/multibagger' },
  { label: 'Playbook',             url: '/playbook' },
  { label: 'Special Situations',   url: '/special-situations' },
  { label: 'Movers',               url: '/movers' },
  { label: 'Heatmap',              url: '/heatmap' },
  { label: 'Breadth',              url: '/breadth' },
  { label: 'Portfolio',            url: '/portfolio' },
  { label: 'Watchlists',           url: '/watchlists' },
  { label: 'Decisions',            url: '/decisions' },
  { label: 'Alerts',               url: '/alerts' },
  { label: 'Buy Strategy',         url: '/buy-strategy' },
  { label: 'Investing OS',         url: '/investing-os' },
  { label: 'System Status',        url: '/system-status' },
  { label: 'Activity Log',         url: '/activity-log' },
  { label: 'IPOs',                 url: '/ipos' },
  { label: 'Smart Money',          url: '/smart-money' },
  { label: 'Super Investors',      url: '/super-investors' },
  { label: 'Market Snapshot',      url: '/market-snapshot' },
  { label: 'Stock Sheet',          url: '/stock-sheet' },
  { label: 'Auto Valuation',       url: '/auto-valuation' },
  { label: 'Valuations',           url: '/valuations' },
  { label: 'Themes',               url: '/themes' },
  { label: 'AI Desk',              url: '/ai-desk' },
];

function score(query: string, item: CommandItem): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const hay = `${item.label} ${item.hint || ''} ${item.keywords || ''} ${item.url || ''}`.toLowerCase();
  if (hay.startsWith(q)) return 100;
  if (hay.includes(q)) return 50;
  // Loose substring per query char
  let qi = 0;
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] === q[qi]) qi++;
  }
  return qi === q.length ? 10 : 0;
}

export interface CommandPaletteProps {
  /** Additional items beyond the default page list. */
  extraItems?: CommandItem[];
}

export function CommandPalette({ extraItems }: CommandPaletteProps = {}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<CommandItem[]>(
    () => (extraItems ? [...DEFAULT_PAGES, ...extraItems] : DEFAULT_PAGES),
    [extraItems],
  );

  const matches = useMemo<CommandItem[]>(() => {
    if (!q) return items.slice(0, 20);
    return items
      .map((i) => [score(q, i), i] as const)
      .filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i)
      .slice(0, 20);
  }, [items, q]);

  // Global hotkey
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      // focus next paint
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  function selectIdx(i: number) {
    const it = matches[i];
    if (!it) return;
    setOpen(false);
    if (it.onSelect) it.onSelect();
    else if (it.url) {
      // Use full-page navigation so the dashboard layout reloads cleanly.
      // (Next.js router would also work but this primitive is router-agnostic.)
      window.location.href = it.url;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectIdx(idx);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          background: 'var(--mc-bg-2)',
          border: '1px solid var(--mc-border-2)',
          borderRadius: 'var(--mc-radius-lg)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          animation: 'mc-fade-in var(--mc-dur-base) ease-out',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Jump to page…"
          aria-label="Search pages"
          style={{
            width: '100%',
            padding: '14px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--mc-border-0)',
            color: 'var(--mc-text-0)',
            fontSize: 16,
            outline: 'none',
          }}
        />
        <ul
          role="listbox"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 4,
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          {matches.length === 0 ? (
            <li
              style={{
                padding: '12px 14px',
                color: 'var(--mc-text-4)',
                fontSize: 'var(--mc-text-sm)',
              }}
            >
              No matches.
            </li>
          ) : (
            matches.map((it, i) => (
              <li
                key={(it.url || '') + it.label}
                role="option"
                aria-selected={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => selectIdx(i)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--mc-radius)',
                  background: i === idx ? 'var(--mc-bg-4)' : 'transparent',
                  color: 'var(--mc-text-1)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 'var(--mc-text-body)',
                }}
              >
                <span>{it.label}</span>
                {it.url ? (
                  <span
                    style={{
                      color: 'var(--mc-text-4)',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 'var(--mc-text-xs)',
                    }}
                  >
                    {it.url}
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--mc-border-0)',
            color: 'var(--mc-text-4)',
            fontSize: 'var(--mc-text-xs)',
            display: 'flex',
            gap: 14,
            justifyContent: 'flex-end',
          }}
        >
          <span>↑↓ Navigate</span>
          <span>↵ Go</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}

// Default export for convenience: <DesignSystem /> renders the global pieces.
export default function DesignSystem({ children }: { children?: React.ReactNode }) {
  return (
    <ToastProvider>
      <CommandPalette />
      {children}
    </ToastProvider>
  );
}
