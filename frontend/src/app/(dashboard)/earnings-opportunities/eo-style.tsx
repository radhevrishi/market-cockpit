// zzz981 — ONE LOOK FOR BOTH EARNINGS OPPORTUNITIES PAGES.
//
// The owner: "the USA Earnings Opportunities format/size is so good; make the
// India one the same". The US page keeps its buttons, chips and figure tiles in
// `us-earnings-opportunities/page.tsx` (btn / panel) and
// `components/us-earnings-card.tsx` (Tile / TILE_SCALE / Chip). Those helpers are
// private to the US files, so their numbers are mirrored here, in one place, and
// every India surface reads them from here. Keep these values in step with the
// US files — they are a copy on purpose, not a new design.
import type { CSSProperties, ReactNode } from 'react';

/** US page `btn()` — pill button; `active` tints it with `color`. */
export function btn(active = false, color = 'var(--mc-cyan)'): CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '6px 10px',
    borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`,
    color: active ? color : 'var(--mc-text-2)',
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--mc-bg-2)',
  };
}

/** US page `panel()` — the bordered box the controls and notes sit in. */
export function panel(): CSSProperties {
  return {
    padding: 16, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)',
    border: '1px solid var(--mc-bg-4)', marginBottom: 16,
  };
}

/** The US title-row pill badge ("NYSE · NASDAQ"). */
export function pillBadge(color = 'var(--mc-cyan)'): CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 10px', borderRadius: 999,
    border: `1px solid ${color}`, color, textDecoration: 'none',
    display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  };
}

/** US card `Chip` styling, for India chips whose content is richer than a string. */
export function chipStyle(color?: string, dashed = false): CSSProperties {
  const c = color || 'var(--mc-text-3)';
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
    border: `1px ${dashed ? 'dashed' : 'solid'} ${color ? c : 'var(--mc-bg-4)'}`, color: c,
    backgroundColor: color ? `color-mix(in srgb, ${c} 10%, transparent)` : 'transparent',
    whiteSpace: 'nowrap',
  };
}

/** US tier filter chip (tier colour mixed with the theme text so MIXED stays readable on white). */
export function tierChip(color: string, on: boolean): CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 800, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
    border: `${on ? 2 : 1}px solid ${color}`, color: `color-mix(in srgb, ${color} 60%, var(--mc-text-1))`,
    backgroundColor: `color-mix(in srgb, ${color} ${on ? 28 : 10}%, transparent)`,
  };
}

/** The compact tier tag on a US card header. */
export function tierTag(color: string): CSSProperties {
  return {
    fontSize: 9, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1,
    padding: '3px 5px', borderRadius: 3, whiteSpace: 'nowrap',
    color: `color-mix(in srgb, ${color} 60%, var(--mc-text-1))`, border: `1px solid ${color}`,
    background: `${color}14`, alignSelf: 'center',
    WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
  } as CSSProperties;
}

/** The US card shell. */
export function cardShell(tierColor: string): CSSProperties {
  return {
    backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
    borderRadius: 'var(--mc-radius)', padding: 12, borderTop: `3px solid ${tierColor}`,
    minWidth: 0, position: 'relative',
  };
}

/** US tier-section box and its card grid (`min(380px, 100%)`: 3 cards a row in the 1500px frame). */
export function tierSection(color: string): CSSProperties {
  return {
    borderRadius: 'var(--mc-radius)', overflow: 'hidden',
    backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
    borderLeft: `4px solid ${color}`,
  };
}
export const CARD_GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))', gap: 12,
};

// ── FIGURE TILES — the US `TILE_SCALE`, numbers copied exactly ─────────────
export type TileSize = 'lead' | 'normal' | 'compact';
export const TILE_SCALE: Record<TileSize, { pad: string; val: number; lab: number; sub: number }> = {
  lead:    { pad: '11px 13px', val: 25, lab: 10.5, sub: 10.5 },
  normal:  { pad: '7px 9px',   val: 15, lab: 10,   sub: 10 },
  compact: { pad: '5px 8px',   val: 12.5, lab: 8.5, sub: 8.5 },
};
/** US `TILE_FR` as flex grow, plus a minimum width so the row WRAPS on a narrow card instead of crushing. */
const TILE_FLEX: Record<TileSize, string> = { lead: '1.55 1 96px', normal: '1 1 62px', compact: '0.78 1 52px' };

/** One row of tiles (wraps on a narrow card). */
export const TILE_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' };

/** US `Tile`, with an optional title and extra lines (India's "why this is —" notes). */
export function Tile({ label, value, sub, color, size = 'normal', title, extra, valueTitle }: {
  label: string; value: ReactNode; sub?: ReactNode; color?: string; size?: TileSize;
  title?: string; extra?: ReactNode; valueTitle?: string;
}) {
  const s = TILE_SCALE[size];
  const lead = size === 'lead';
  return (
    <div title={title} style={{
      flex: TILE_FLEX[size],
      backgroundColor: lead ? 'var(--mc-bg-2)' : 'var(--mc-bg-1)',
      border: '1px solid var(--mc-bg-4)',
      borderLeft: lead ? `3px solid ${color || 'var(--mc-text-1)'}` : '1px solid var(--mc-bg-4)',
      borderRadius: 6, padding: s.pad, minWidth: 0,
    }}>
      <div style={{ fontSize: s.lab, color: lead ? 'var(--mc-text-2)' : 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div title={valueTitle} style={{ fontSize: s.val, fontWeight: lead ? 900 : 800, color: color || 'var(--mc-text-0)', lineHeight: 1.2, letterSpacing: lead ? -0.5 : 0 }}>{value}</div>
      {sub && <div style={{ fontSize: s.sub, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      {extra}
    </div>
  );
}

/** Tier text colour — mixed with the theme text so a yellow MIXED stays readable on the light theme. */
export function tierText(color: string): string {
  return `color-mix(in srgb, ${color} 60%, var(--mc-text-1))`;
}
/** The US section header's "N companies" pill. */
export function tierCountPill(color: string): CSSProperties {
  return {
    fontWeight: 800, fontSize: 'var(--mc-text-xs)', padding: '2px 8px', borderRadius: 999,
    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color: tierText(color),
  };
}
/** The US collapsible section header button. */
export const TIER_HEAD_BTN: CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', flexWrap: 'wrap',
  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit',
};
