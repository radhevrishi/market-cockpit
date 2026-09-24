// Theme Rotation — design tokens (zzz795). Every colour is a CSS variable so
// the dark, light and professional themes all read correctly.
import type { LayerState, Tier } from '@/lib/theme-rotation/types';

export const T = {
  bg: 'var(--mc-bg-0)',
  card: 'var(--mc-bg-1)',
  card2: 'var(--mc-bg-2)',
  border: 'var(--mc-border-1)',
  border2: 'var(--mc-border-2)',
  text: 'var(--tc-text)',
  dim: 'var(--tc-dim)',
  faint: 'var(--tc-faint)',
  accent: 'var(--tc-accent)',
  up: 'var(--mc-verdict-up)',
  down: 'var(--mc-verdict-down)',
  warn: 'var(--mc-verdict-warn)',
  flat: 'var(--mc-verdict-flat)',
  absent: 'var(--mc-verdict-absent)',
  alarm: 'var(--mc-verdict-alarm)',
  info: 'var(--mc-info)',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/** A translucent wash of a CSS colour, theme-safe. */
export const tint = (c: string, pct = 12) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export const VERDICT_TONE: Record<string, string> = {
  BUY: T.up, 'EARLY BUY': T.accent, HOLD: T.warn, WATCH: T.flat, TRIM: T.down, AVOID: T.alarm,
};
export const VERDICT_ORDER: Record<string, number> = { BUY: 0, 'EARLY BUY': 1, HOLD: 2, WATCH: 3, TRIM: 4, AVOID: 5 };

export const STATE_META: Record<LayerState, { glyph: string; color: string; word: string; order: number }> = {
  improving: { glyph: '▲', color: T.up, word: 'improving', order: 0 },
  steady: { glyph: '●', color: T.flat, word: 'steady', order: 1 },
  // zzz797 — data for now, but no earlier period on file: a level, not a trend.
  level: { glyph: '◆', color: T.info, word: 'level only', order: 2 },
  unknown: { glyph: '○', color: T.absent, word: 'no data', order: 3 },
  weakening: { glyph: '▼', color: T.down, word: 'weakening', order: 4 },
};

export const TIER_TONE: Record<Tier, string> = { top: T.accent, look: T.up, monitor: T.flat, low: T.absent };

export const QUAD_TONE: Record<string, string> = { Leading: T.up, Improving: T.info, Weakening: T.warn, Lagging: T.down };

export const fmtPct = (v?: number | null, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`);
