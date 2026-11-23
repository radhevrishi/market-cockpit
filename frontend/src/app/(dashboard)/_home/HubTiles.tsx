'use client';
// zzz1294 — home favourites are the seven main hubs. Each tile opens its hub and lists the sub-tabs; the old 57
// shortcut chips stay one click away under "All shortcuts" (nothing removed).
import NavLink from '@/components/NavLink';
import { HUBS } from '@/lib/nav-hubs';

export function HubTiles() {
  return (
    <div data-testid="home-hubs" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
      {HUBS.map((h) => (
        <div key={h.id} style={{ border: '1px solid var(--mc-border-2)', borderRadius: 10, padding: '8px 10px', background: 'var(--mc-bg-1)' }}>
          <NavLink href={h.home} style={{ fontSize: 15, fontWeight: 900, color: 'var(--mc-text-1)', textDecoration: 'none' }}>{h.icon} {h.label} →</NavLink>
          <div style={{ fontSize: 12, color: 'var(--mc-text-3)', margin: '2px 0 6px' }}>{h.blurb}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', fontSize: 12.5 }}>
            {h.tabs.map((t) => t.ext
              ? <a key={t.href} href={t.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>{t.label} ↗</a>
              : <span key={t.href} style={{ whiteSpace: 'nowrap' }}><NavLink href={t.href} style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>{t.label}</NavLink>{t.us ? <> <NavLink href={t.us} title="USA" style={{ color: 'var(--mc-text-3)', textDecoration: 'none', fontSize: 11.5 }}>🇺🇸</NavLink></> : null}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}
