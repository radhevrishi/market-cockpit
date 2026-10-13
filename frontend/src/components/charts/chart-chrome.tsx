'use client';
// zzz1013 — the chart page's chrome: the session badge, the line icons used by the toolbar and the drawing rail, the "?" shortcuts
// overlay and a small media-query hook. Pure display: nothing here reads or writes chart data, drawings or saved state.
import { useEffect, useMemo, useRef, useState } from 'react';
import { isIndianMarketOpen, isNseHolidayDate, istNow, istToday, isUSMarketOpen } from '@/lib/market-hours';
import { usExtendedSession } from '@/lib/watchlist-display';
import type { Market } from '@/lib/chart-math';

// ── session state ────────────────────────────────────────────────────────────────
export type SessionId = 'open' | 'pre' | 'post' | 'closed';
export interface SessionState { id: SessionId; label: string; hint: string }

/** The trading session the exchange is in right now, from its regular hours (NSE 09:15–15:30 IST with the NSE holiday list;
 *  US 09:30–16:00 ET, pre-market 04:00 and after-hours to 20:00 ET — US holidays are not known here). */
export function sessionState(market: Market, now: Date = new Date()): SessionState {
  if (market === 'IN') {
    if (isIndianMarketOpen(now)) return { id: 'open', label: 'Market open', hint: 'NSE regular session, 09:15–15:30 IST' };
    const t = istNow(now);
    const dow = t.getUTCDay();
    const m = t.getUTCHours() * 60 + t.getUTCMinutes();
    if (dow !== 0 && dow !== 6 && !isNseHolidayDate(istToday(now)) && m >= 9 * 60 && m < 9 * 60 + 15) return { id: 'pre', label: 'Pre-open', hint: 'NSE pre-open call auction, 09:00–09:15 IST' };
    return { id: 'closed', label: 'Market closed', hint: 'NSE regular session is 09:15–15:30 IST, Monday to Friday' };
  }
  if (isUSMarketOpen(now)) return { id: 'open', label: 'Market open', hint: 'US regular session, 09:30–16:00 ET (exchange holidays are not checked)' };
  const ext = usExtendedSession(now);
  if (ext === 'pre') return { id: 'pre', label: 'Pre-market', hint: 'US pre-market, 04:00–09:30 ET' };
  if (ext === 'post') return { id: 'post', label: 'After hours', hint: 'US after-hours, 16:00–20:00 ET' };
  return { id: 'closed', label: 'Market closed', hint: 'US regular session is 09:30–16:00 ET, Monday to Friday' };
}

/** Re-reads the session once a minute. */
export function useSession(market: Market): SessionState {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => { void tick; return sessionState(market); }, [market, tick]);
}

export function SessionBadge({ market }: { market: Market }) {
  const s = useSession(market);
  return <span className={`ct-session ${s.id}`} title={s.hint} data-testid="session-badge"><i aria-hidden />{s.label}</span>;
}

// ── keyboard shortcuts ───────────────────────────────────────────────────────────
/** Every shortcut the chart page answers, as shown in the "?" overlay (the handlers live in ChartWorkspace / WatchlistPanel). */
export const CHART_SHORTCUTS: ReadonlyArray<{ group: string; items: ReadonlyArray<{ keys: string[]; what: string }> }> = [
  { group: 'Symbols', items: [
    { keys: ['↓'], what: 'Next symbol in the watchlist (or in the screener review)' },
    { keys: ['↑'], what: 'Previous symbol' },
    { keys: ['Home', 'End'], what: 'First / last row, while the watchlist has focus' },
    { keys: ['Enter'], what: 'Open the focused watchlist row' },
    { keys: ['/'], what: 'Search for a ticker or company' },
  ] },
  { group: 'Chart', items: [
    { keys: ['Alt', 'R'], what: 'Reset chart: chosen range, latest bar, price axis refitted' },
    { keys: ['Shift', 'F'], what: 'Focus mode on / off' },
    { keys: ['Esc'], what: 'Cancel a drawing, then leave focus mode' },
    { keys: ['Delete'], what: 'Delete the selected drawing' },
    { keys: ['Double-click axis'], what: 'Turn auto-fit back on' },
  ] },
  { group: 'Help', items: [{ keys: ['?'], what: 'Show or hide this list' }] },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); back?.focus?.(); };
  }, [onClose]);
  return (
    <div className="ct-help-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ct-help" role="dialog" aria-modal="true" aria-labelledby="ct-help-title" data-testid="chart-shortcuts">
        <div className="ct-help-head">
          <h2 id="ct-help-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="ct-icon" aria-label="Close shortcuts" onClick={onClose}><Icon name="close" /></button>
        </div>
        {CHART_SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3>{g.group}</h3>
            <dl>
              {g.items.map((it) => (
                <div key={it.what}>
                  <dt>{it.keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</dt>
                  <dd>{it.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/** true while the media query matches (false on the server and before mounting). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, [query]);
  return on;
}

// ── icons (16 px line icons, currentColor) ───────────────────────────────────────
const PATHS: Record<string, string> = {
  cursor: 'M4 2.5l8.5 5-3.6 1 2.3 4-1.4.8-2.3-4-2.7 2.6z',
  hline: 'M1.5 8h13M3 8a1 1 0 100 .01M13 8a1 1 0 100 .01',
  trend: 'M2.5 13.5l11-11M2.5 13.5a1.2 1.2 0 100 .01M13.5 2.5a1.2 1.2 0 100 .01',
  ray: 'M2.5 13.5L14 2M2.5 13.5a1.2 1.2 0 100 .01M10.5 2H14v3.5',
  rect: 'M2.5 4h11v8h-11z',
  channel: 'M1.5 10.5l9-8M5.5 14l9-8',
  fib: 'M2 3h12M2 6.5h12M2 9.5h12M2 13h12M3.5 3l9 10',
  text: 'M3 3.5h10M8 3.5V13M6 13h4',
  measure: 'M2 13.5V9.5M2 11.5h12M14 13.5V9.5M4 6l4-3.5L12 6M8 2.5v6',
  erase: 'M6 13.5h8M2.8 9.6l6.3-6.3a1 1 0 011.4 0l2.2 2.2a1 1 0 010 1.4L7.4 12.2a1 1 0 01-.7.3H5a1 1 0 01-.7-.3L2.8 11a1 1 0 010-1.4zM5.5 7l3.5 3.5',
  trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5',
  reset: 'M2.5 8a5.5 5.5 0 109.6-3.6M12.5 1.8v2.9H9.6',
  refresh: 'M13.5 8A5.5 5.5 0 113.9 4.4M3.5 1.8v2.9h2.9',
  sun: 'M8 5a3 3 0 100 6 3 3 0 000-6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  moon: 'M13.5 9.5A5.8 5.8 0 016.5 2.5a5.8 5.8 0 107 7z',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  focus: 'M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5',
  unfocus: 'M5.5 2v3.5H2M14 5.5h-3.5V2M10.5 14v-3.5H14M2 10.5h3.5V14',
  help: 'M8 15A7 7 0 108 1a7 7 0 000 14zM6.2 6.2A1.9 1.9 0 0110 6.5c0 1.4-2 1.7-2 3M8 11.6v.01',
  chevron: 'M4 6l4 4 4-4',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  fx: 'M6.5 2.5c-1.6 0-2 1-2.3 2.6L3 13.5M2.5 6h4M9 7l4.5 6M13.5 7L9 13',
  search: 'M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11 11l3.5 3.5',
  plus: 'M8 3v10M3 8h10',
};
export type IconName = keyof typeof PATHS;
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
