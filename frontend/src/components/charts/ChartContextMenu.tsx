'use client';
// zzz1022b — right-click menu on the chart, as in TradingView: reset / fit / auto-scale / log / total return, a price line or a
// copy of the price under the mouse, drawings and indicators. Closes on Escape, a click outside, scrolling or a window resize.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChartDisplay } from '@/lib/chart-display';

export interface ChartMenuItem {
  id: string;
  label: string;
  kbd?: string;
  /** a tick in front of the label (on / off settings) */
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** a line above this item */
  sepBefore?: boolean;
}

export interface ChartMenuState {
  /** opened on the price axis (scale items only) */
  axis: boolean;
  /** the price under the mouse (null outside the price pane) */
  price: number | null;
  cur: string; decimals: number;
  auto: boolean; log: boolean; tr: boolean;
  patterns: boolean; stage: boolean; setups: boolean; volume: boolean;
  /** zzz1025 — Auto trendlines & levels */
  autoLines?: boolean;
  selected: boolean; light: boolean;
  /** zzz1029 — Clean / Research labels (shown when given) */
  display?: ChartDisplay;
}
/** The menu: chart view and price scale first (as in TradingView), then the price under the mouse, indicators, drawings, theme.
 *  On the price axis only the scale items. */
export function chartMenuItems(s: ChartMenuState): ChartMenuItem[] {
  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: s.decimals, maximumFractionDigits: s.decimals });
  const items: ChartMenuItem[] = [
    { id: 'reset', label: 'Reset chart view', kbd: 'Alt+R' },
    { id: 'fit', label: 'Fit the whole history' },
    { id: 'auto', label: 'Auto (fit the price axis to the candles on screen)', checked: s.auto, sepBefore: true },
    { id: 'log', label: 'Logarithmic scale', checked: s.log },
    { id: 'tr', label: 'Total return (dividends added back)', checked: s.tr },
  ];
  if (s.axis) return items;
  if (s.price != null) {
    items.push(
      { id: 'hline', label: `Horizontal line at ${s.cur}${fmt(s.price)}`, sepBefore: true },
      { id: 'copy', label: `Copy price ${fmt(s.price)}` },
    );
  }
  items.push(
    { id: 'patterns', label: 'Automate chart patterns', checked: s.patterns, sepBefore: true },
    { id: 'stage', label: 'Stage Analysis', checked: s.stage },
    { id: 'setups', label: 'Trader setups', checked: s.setups },
    { id: 'alines', label: 'Auto trendlines & levels', checked: !!s.autoLines },
    { id: 'volume', label: 'Volume', checked: s.volume },
  );
  if (s.display) {
    items.push(
      { id: 'view-clean', label: 'Clean labels (fewer on the chart)', checked: s.display === 'clean', sepBefore: true },
      { id: 'view-research', label: 'Research labels (every label)', checked: s.display === 'research' },
    );
  }
  items.push(
    { id: 'del1', label: 'Remove selected drawing', kbd: 'Delete', disabled: !s.selected, sepBefore: true },
    { id: 'delall', label: 'Remove all drawings…', danger: true },
    { id: 'theme', label: s.light ? 'Dark chart' : 'White chart', sepBefore: true },
  );
  return items;
}

/** Keep the menu inside the box: open left / up of the mouse when it would overflow. */
export function placeMenu(x: number, y: number, w: number, h: number, boxW: number, boxH: number): { left: number; top: number } {
  const left = x + w > boxW - 4 ? Math.max(4, x - w) : x;
  const top = y + h > boxH - 4 ? Math.max(4, boxH - h - 4) : y;
  return { left, top };
}

export function ChartContextMenu({ x, y, items, onSelect, onClose, title }: { x: number; y: number; items: ChartMenuItem[]; onSelect: (id: string) => void; onClose: () => void; title?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current, box = el?.offsetParent as HTMLElement | null;
    if (!el || !box) return;
    setPos(placeMenu(x, y, el.offsetWidth, el.offsetHeight, box.clientWidth, box.clientHeight));
  }, [x, y, items.length]);
  useEffect(() => {
    const doc = ref.current?.ownerDocument || document;
    const down = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const away = () => onClose();
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('keydown', key, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    doc.addEventListener('wheel', away, { capture: true, passive: true });
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      doc.removeEventListener('pointerdown', down, true);
      doc.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
      doc.removeEventListener('wheel', away, true);
    };
  }, [onClose]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const bs = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || []);
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
  };
  return (
    <div ref={ref} className="ct-menu ct-ctx" role="menu" aria-label={title || 'Chart menu'} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', left: pos.left, top: pos.top, right: 'auto', zIndex: 60 }} data-testid="chart-context-menu">
      {title && <div className="ct-ctx-title">{title}</div>}
      {items.map((it) => (
        <div key={it.id}>
          {it.sepBefore && <div className="ct-ctx-sep" role="separator" />}
          <button type="button" role={it.checked != null ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked != null ? it.checked : undefined}
            disabled={it.disabled} data-id={it.id} className={it.danger ? 'danger' : undefined}
            onClick={() => { onClose(); onSelect(it.id); }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden style={{ width: 12, display: 'inline-block', color: 'var(--mc-accent)' }}>{it.checked ? '✓' : ''}</span>
              {it.label}
            </span>
            {it.kbd && <kbd>{it.kbd}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}
