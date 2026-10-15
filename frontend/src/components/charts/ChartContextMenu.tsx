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
  /** zzz1038 — a one-level submenu (▸): the item opens it instead of being selected; its items go to the same onSelect */
  children?: ChartMenuItem[];
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
  /** zzz1046b — Volume & accumulation (institutional footprint) */
  acc?: boolean;
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
    { id: 'acc', label: 'Volume & accumulation', checked: !!s.acc },
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

/** zzz1038 — a submenu next to its item: on the right when it fits, else on the left (whichever side has more room when neither
 *  fits); `top` is its offset from the item's top, moved up so it stays inside the box. */
export function placeSubmenu(item: { left: number; right: number; top: number }, w: number, h: number,
  box: { left: number; top: number; right: number; bottom: number }): { side: 'right' | 'left'; top: number } {
  const roomR = box.right - 4 - item.right, roomL = item.left - (box.left + 4);
  const side: 'right' | 'left' = w <= roomR ? 'right' : w <= roomL ? 'left' : roomR >= roomL ? 'right' : 'left';
  let top = Math.min(-4, box.bottom - 4 - h - item.top);
  top = Math.max(top, box.top + 4 - item.top);
  return { side, top };
}

type Box = { left: number; top: number; right: number; bottom: number };
const winBox = (): Box => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
/** The items of one menu level (the top menu or an open submenu), in order. */
const levelButtons = (menu: Element | null | undefined, all = false): HTMLButtonElement[] =>
  Array.from(menu?.children || []).flatMap((d) => Array.from(d.children)).filter((b): b is HTMLButtonElement => b.tagName === 'BUTTON' && (all || !(b as HTMLButtonElement).disabled));

function MenuButton({ it, open, onClick, onEnter }: { it: ChartMenuItem; open?: boolean; onClick: (e: React.MouseEvent) => void; onEnter?: () => void }) {
  const sub = !!it.children;
  return (
    <button type="button" role={sub ? 'menuitem' : it.checked != null ? 'menuitemcheckbox' : 'menuitem'} aria-checked={!sub && it.checked != null ? it.checked : undefined}
      aria-haspopup={sub ? 'menu' : undefined} aria-expanded={sub ? !!open : undefined}
      disabled={it.disabled} data-id={it.id} className={it.danger ? 'danger' : undefined} onClick={onClick} onPointerEnter={(e) => { if (e.pointerType === 'mouse') onEnter?.(); }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 12, display: 'inline-block', color: 'var(--mc-accent)' }}>{it.checked ? '✓' : ''}</span>
        {it.label}
      </span>
      {sub ? <span aria-hidden style={{ color: 'var(--mc-text-3)' }}>▸</span> : it.kbd ? <kbd>{it.kbd}</kbd> : null}
    </button>
  );
}

/** The right-click menu. `fixed` places it against the window (for menus opened outside the chart canvas, e.g. the watchlist).
 *  Items with `children` open a submenu: click / tap / hover / → opens it, ← or Esc closes it (Esc again closes the menu). */
export function ChartContextMenu({ x, y, items, onSelect, onClose, title, fixed, testId }: {
  x: number; y: number; items: ChartMenuItem[]; onSelect: (id: string) => void; onClose: () => void; title?: string;
  fixed?: boolean; testId?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subFocus, setSubFocus] = useState(false);
  const [subPos, setSubPos] = useState<{ side: 'right' | 'left'; top: number }>({ side: 'right', top: -4 });
  const openSubRef = useRef<string | null>(null);
  useEffect(() => { openSubRef.current = openSub; }, [openSub]);
  const boxOf = (): Box | null => {
    if (fixed) return winBox();
    const p = ref.current?.offsetParent as HTMLElement | null;
    return p ? p.getBoundingClientRect() : null;
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (fixed) { setPos(placeMenu(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight)); return; }
    const box = el.offsetParent as HTMLElement | null;
    if (!box) return;
    setPos(placeMenu(x, y, el.offsetWidth, el.offsetHeight, box.clientWidth, box.clientHeight));
  }, [x, y, items.length, fixed]);
  useLayoutEffect(() => {
    const sub = subRef.current, btn = sub?.previousElementSibling as HTMLElement | null | undefined;
    const box = boxOf();
    if (!sub || !btn || !box) return;
    setSubPos(placeSubmenu(btn.getBoundingClientRect(), sub.offsetWidth, sub.offsetHeight, box));
    if (subFocus) { levelButtons(sub)[0]?.focus(); setSubFocus(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSub, subFocus]);
  useEffect(() => {
    const doc = ref.current?.ownerDocument || document;
    const down = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      const sub = openSubRef.current;
      if (sub) { setOpenSub(null); levelButtons(ref.current, true).find((b) => b.getAttribute('data-id') === sub)?.focus(); return; }
      onClose();
    };
    const away = () => onClose();
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('keydown', key, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    doc.addEventListener('wheel', away, { capture: true, passive: true });
    return () => {
      doc.removeEventListener('pointerdown', down, true);
      doc.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
      doc.removeEventListener('wheel', away, true);
    };
  }, [onClose]);
  // the first item takes the focus once, when the menu opens (not on every re-render of the page behind it)
  useEffect(() => { levelButtons(ref.current)[0]?.focus(); }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    const level = active?.closest('[role="menu"]');
    const inSub = !!level && level !== ref.current;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const bs = levelButtons(level || ref.current);
      const i = bs.indexOf(active as HTMLButtonElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
      return;
    }
    if (e.key === 'ArrowRight' && !inSub && active?.getAttribute('aria-haspopup') === 'menu') {
      e.preventDefault(); e.stopPropagation();
      setOpenSub(active.getAttribute('data-id')); setSubFocus(true);
      return;
    }
    if (e.key === 'ArrowLeft' && inSub) {
      e.preventDefault(); e.stopPropagation();
      const parent = level?.previousElementSibling as HTMLElement | null | undefined;
      setOpenSub(null); parent?.focus();
    }
  };
  const pick = (id: string) => { onClose(); onSelect(id); };
  return (
    <div ref={ref} className="ct-menu ct-ctx" role="menu" aria-label={title || 'Chart menu'} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}
      style={{ position: fixed ? 'fixed' : 'absolute', left: pos.left, top: pos.top, right: 'auto', zIndex: fixed ? 80 : 60 }} data-testid={testId || 'chart-context-menu'}>
      {title && <div className="ct-ctx-title">{title}</div>}
      {items.map((it) => (
        <div key={it.id} style={it.children ? { position: 'relative' } : undefined}>
          {it.sepBefore && <div className="ct-ctx-sep" role="separator" />}
          <MenuButton it={it} open={openSub === it.id}
            onEnter={() => setOpenSub(it.children && !it.disabled ? it.id : null)}
            onClick={(e) => {
              if (!it.children) { pick(it.id); return; }
              const opening = openSub !== it.id || e.detail === 0;
              setOpenSub(opening ? it.id : null);
              if (opening && e.detail === 0) setSubFocus(true);   // Enter / Space: into the submenu
            }} />
          {it.children && openSub === it.id && (
            <div ref={subRef} className="ct-menu ct-ctx ct-sub" role="menu" aria-label={it.label} data-testid={`submenu-${it.id}`}
              style={{ position: 'absolute', top: subPos.top, ...(subPos.side === 'right' ? { left: '100%', right: 'auto', marginLeft: 2 } : { right: '100%', left: 'auto', marginRight: 2 }), minWidth: 190, zIndex: 1 }}>
              {it.children.map((c) => (
                <div key={c.id}>
                  {c.sepBefore && <div className="ct-ctx-sep" role="separator" />}
                  <MenuButton it={{ ...c, children: undefined }} onClick={() => pick(c.id)} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
