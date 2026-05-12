/**
 * Design tokens — single source of truth for color semantics.
 *
 * PATCH 0214 — Created during the institutional readiness pass.
 *
 * Rationale: the codebase has many inline hex values where the same red
 * signals "bearish", "stale", "bad-grade", and "missing data". That collision
 * makes the UI ambiguous. Tokens are split into three orthogonal palettes:
 *
 *   1) semantic  — direction of move (bullish / bearish / neutral)
 *   2) state     — lifecycle state of a signal (live / warm / stale / persistent)
 *   3) severity  — magnitude of an event (high / medium / low)
 *
 * Each carries `solid`, `bg` (low-opacity fill), and `border` so the same
 * triple can be applied to chips, pills, dots, and outlined cards.
 *
 * Migration policy: new components MUST use tokens. Old inline hex is being
 * migrated incrementally; this file documents the canonical mapping so
 * reviewers can swap matched colors in one pass without breaking the UI.
 */

export const TOKENS = {
  // ── Semantic (direction) ─────────────────────────────────────────────
  semantic: {
    bullish:  { solid: '#10B981', bg: '#10B98115', border: '#10B98140', label: 'bullish' },
    bearish:  { solid: '#EF4444', bg: '#EF444415', border: '#EF444440', label: 'bearish' },
    neutral:  { solid: '#94A3B8', bg: '#94A3B815', border: '#94A3B840', label: 'neutral' },
  },

  // ── State (lifecycle) ────────────────────────────────────────────────
  // NOTE: state.stale is amber so it's NOT confused with semantic.bearish.
  // state.persistent is violet — distinct from both bearish and stale.
  state: {
    live:       { solid: '#22D3EE', bg: '#22D3EE15', border: '#22D3EE40', label: 'LIVE' },
    warm:       { solid: '#5EEAD4', bg: '#5EEAD415', border: '#5EEAD440', label: 'WARM' },
    stale:      { solid: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40', label: 'STALE' },
    persistent: { solid: '#A78BFA', bg: '#A78BFA15', border: '#A78BFA40', label: 'PERSISTENT' },
    archived:   { solid: '#475569', bg: '#47556915', border: '#47556940', label: 'ARCHIVED' },
  },

  // ── Severity (magnitude) ─────────────────────────────────────────────
  // NOTE: severity.high is orange (NOT red) so a "HIGH severity bearish"
  // signal is rendered as orange-severity + red-direction, not redundant red.
  severity: {
    high:   { solid: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40', label: 'HIGH' },
    medium: { solid: '#60A5FA', bg: '#60A5FA15', border: '#60A5FA40', label: 'MEDIUM' },
    low:    { solid: '#64748B', bg: '#64748B15', border: '#64748B40', label: 'LOW' },
  },

  // ── Surface (cards / backgrounds) ────────────────────────────────────
  surface: {
    canvas:     '#0A0E17',
    card:       '#0D1B2E',
    cardElev:   '#111B35',
    cardBorder: '#1E2D45',
    text:       '#F5F7FA',
    textDim:    '#8A95A3',
    textMuted:  '#4A5B6C',
    accent:     '#22D3EE',  // institutional cyan — primary actions only
  },
} as const;

/** Helper: pick a token by string key, with safe fallback. */
export function tone(scope: 'semantic'|'state'|'severity', key: string) {
  const palette = (TOKENS as any)[scope];
  return palette?.[key.toLowerCase()] ?? palette?.neutral ?? TOKENS.semantic.neutral;
}

/** Helper: build inline style for a chip given a token triple. */
export function chipStyle(t: { solid: string; bg: string; border: string }, opts?: { mono?: boolean }) {
  return {
    backgroundColor: t.bg,
    border: `1px solid ${t.border}`,
    color: t.solid,
    padding: '3px 8px',
    borderRadius: 5,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.3px',
    fontFamily: opts?.mono ? 'ui-monospace, monospace' : undefined,
  };
}
