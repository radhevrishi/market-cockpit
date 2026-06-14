'use client';

import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { Palette } from 'lucide-react';

/**
 * Three-way theme switcher — Dark / Light / Professional.
 * Renders as a compact pill row that fits the sidebar and adapts colour
 * to whichever theme is active.
 */
export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, themes, palette } = useTheme();

  if (compact) {
    // Single icon button that cycles dark → light → professional → dark
    const cycle = () => {
      const order = themes;
      const idx = order.indexOf(theme);
      setTheme(order[(idx + 1) % order.length]);
    };
    return (
      <button
        onClick={cycle}
        title={`Theme: ${palette.label} (click to cycle)`}
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          padding: '10px 4px',
          background: 'none',
          border: 'none',
          color: 'var(--mc-text-4)',
          cursor: 'pointer',
          fontSize: 9,
        }}
      >
        <Palette className="w-4 h-4" />
        <span>{palette.label}</span>
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        background: palette.PANEL2,
        border: `1px solid ${palette.BORDER}`,
        borderRadius: 6,
      }}
    >
      {themes.map((t) => {
        const active = t === theme;
        const label = t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'Pro';
        return (
          <button
            key={t}
            onClick={() => setTheme(t)}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: active ? palette.ACCENT : 'transparent',
              color: active ? palette.BG : palette.MUTED,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
