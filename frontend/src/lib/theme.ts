// ─────────────────────────────────────────────────────────────────────────
// Theme palettes — light / dark / professional
//
// Components import this via the useTheme() hook (contexts/ThemeContext.tsx)
// which returns the active palette object. Existing components that still
// reference hardcoded color constants will continue to render in dark mode
// — they can be migrated to useTheme() incrementally.
// ─────────────────────────────────────────────────────────────────────────

export type ThemeName = 'dark' | 'light' | 'professional';

export interface ThemePalette {
  name: ThemeName;
  label: string;
  // Surfaces
  BG: string;        // page background
  BG2: string;       // secondary background (cards, sections)
  PANEL: string;     // panel background
  PANEL2: string;    // panel header / row hover
  BORDER: string;    // panel border
  BORDER2: string;   // strong border
  // Text
  TEXT: string;      // primary text
  MUTED: string;     // secondary text
  FAINT: string;     // tertiary text / dividers
  // Accents
  ACCENT: string;    // primary accent (buttons, links, highlights)
  SAFFRON: string;   // saffron / India accent
  GREEN: string;     // positive / good
  GREEN2: string;    // secondary green
  RED: string;       // negative / bad
  ORANGE: string;    // warning / caution
  YELLOW: string;    // attention
  TEAL: string;      // info
  // Typography
  FONT: string;      // sans
  MONO: string;      // mono
}

export const THEMES: Record<ThemeName, ThemePalette> = {
  dark: {
    name: 'dark',
    label: 'Dark',
    BG: '#0d1117',
    BG2: '#0a0e14',
    PANEL: '#161b22',
    PANEL2: '#1c232c',
    BORDER: 'rgba(255,255,255,0.06)',
    BORDER2: 'rgba(255,255,255,0.10)',
    TEXT: '#e6edf3',
    MUTED: '#7d8590',
    FAINT: '#484f58',
    ACCENT: '#fbbf24',
    SAFFRON: '#ff9933',
    GREEN: '#10b981',
    GREEN2: '#22c55e',
    RED: '#ef4444',
    ORANGE: '#fb923c',
    YELLOW: '#facc15',
    TEAL: '#14b8a6',
    FONT: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    MONO: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", monospace',
  },

  light: {
    name: 'light',
    label: 'Light',
    BG: '#ffffff',
    BG2: '#f7f8fa',
    PANEL: '#ffffff',
    PANEL2: '#f0f3f7',
    BORDER: 'rgba(0,0,0,0.08)',
    BORDER2: 'rgba(0,0,0,0.14)',
    TEXT: '#0f172a',
    MUTED: '#64748b',
    FAINT: '#94a3b8',
    ACCENT: '#d97706',
    SAFFRON: '#ea580c',
    GREEN: '#059669',
    GREEN2: '#16a34a',
    RED: '#dc2626',
    ORANGE: '#ea580c',
    YELLOW: '#ca8a04',
    TEAL: '#0d9488',
    FONT: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    MONO: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", monospace',
  },

  professional: {
    // Bloomberg-terminal inspired: black bg, orange highlights, no chrome
    name: 'professional',
    label: 'Professional',
    BG: '#000000',
    BG2: '#0a0a0a',
    PANEL: '#0f0f0f',
    PANEL2: '#161616',
    BORDER: 'rgba(255,165,0,0.10)',
    BORDER2: 'rgba(255,165,0,0.20)',
    TEXT: '#e8e8e8',
    MUTED: '#888888',
    FAINT: '#555555',
    ACCENT: '#ffa500',
    SAFFRON: '#ff6600',
    GREEN: '#00ff88',
    GREEN2: '#00cc66',
    RED: '#ff3333',
    ORANGE: '#ff8800',
    YELLOW: '#ffcc00',
    TEAL: '#00ccff',
    FONT: '"Roboto Mono", "SF Mono", Monaco, Consolas, monospace',
    MONO: '"Roboto Mono", "SF Mono", Monaco, Consolas, monospace',
  },
};

export const DEFAULT_THEME: ThemeName = 'dark';
export const THEME_STORAGE_KEY = 'mc-theme';
