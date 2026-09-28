'use client';

// zzz825 — ☀/🌙 in the header: the owner's white, ink-friendly screens on demand.
// Default stays the current dark. The choice is saved in this browser
// (mc:screen-theme:v1, via ThemeContext) and applied as data-theme="light" on
// <html>, which swaps the --mc-* / --tc-* variables (styles/design-system.css).

import { useTheme } from '@/contexts/ThemeContext';

export default function ScreenThemeToggle() {
  const { theme, setTheme } = useTheme();
  const light = theme === 'light';
  return (
    <button
      type="button"
      data-testid="screen-theme-toggle"
      onClick={() => setTheme(light ? 'dark' : 'light')}
      aria-label={light ? 'Switch to dark screens' : 'Switch to light (white) screens'}
      title={light ? 'Light screens — click for dark' : 'Dark screens — click for light (white, ink-friendly)'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 30,
        borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-2)',
        color: 'var(--mc-text-1)', fontSize: 15, cursor: 'pointer', flex: '0 0 auto',
      }}
    >{light ? '🌙' : '☀'}</button>
  );
}
