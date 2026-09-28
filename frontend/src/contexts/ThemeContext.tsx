'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, SCREEN_THEME_KEY, type ThemeName, type ThemePalette } from '@/lib/theme';

interface ThemeContextValue {
  theme: ThemeName;
  palette: ThemePalette;
  setTheme: (theme: ThemeName) => void;
  themes: ThemeName[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Hydrate from localStorage on mount; default to dark before mount.
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    try {
      // zzz825: the header's ☀/🌙 toggle — light (ink-friendly, white) or the default dark. Stored under its
      // own key so an old 'light'/'professional' choice from the removed three-way switcher never comes back.
      const saved = window.localStorage.getItem(SCREEN_THEME_KEY);
      if (saved === 'light' || saved === 'dark') setThemeState(saved);
    } catch {
      // ignore localStorage failures
    }
  }, []);

  // Apply theme as data-theme attribute on <html> so global CSS variables
  // can also pick it up (for elements that don't read the React context).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme !== 'light');
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    const palette = THEMES[theme];
    const root = document.documentElement;
    // Expose palette as CSS variables — components can use var(--mc-bg) etc.
    root.style.setProperty('--mc-bg', palette.BG);
    root.style.setProperty('--mc-bg2', palette.BG2);
    root.style.setProperty('--mc-panel', palette.PANEL);
    root.style.setProperty('--mc-panel2', palette.PANEL2);
    root.style.setProperty('--mc-border', palette.BORDER);
    root.style.setProperty('--mc-border2', palette.BORDER2);
    root.style.setProperty('--mc-text', palette.TEXT);
    root.style.setProperty('--mc-muted', palette.MUTED);
    root.style.setProperty('--mc-faint', palette.FAINT);
    root.style.setProperty('--mc-accent', palette.ACCENT);
    root.style.setProperty('--mc-saffron', palette.SAFFRON);
    root.style.setProperty('--mc-green', palette.GREEN);
    root.style.setProperty('--mc-red', palette.RED);
    root.style.setProperty('--mc-orange', palette.ORANGE);
  }, [theme]);

  const setTheme = (next: ThemeName) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      if (next === 'light' || next === 'dark') window.localStorage.setItem(SCREEN_THEME_KEY, next);
    } catch {
      // ignore
    }
  };

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    palette: THEMES[theme],
    setTheme,
    themes: Object.keys(THEMES) as ThemeName[],
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback to default palette so components don't crash when used
    // outside the provider (e.g. in tests or pre-hydration).
    return {
      theme: DEFAULT_THEME,
      palette: THEMES[DEFAULT_THEME],
      setTheme: () => {},
      themes: Object.keys(THEMES) as ThemeName[],
    };
  }
  return ctx;
}
