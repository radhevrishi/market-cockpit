'use client';
// zzz1294 — the hub bar above every page: the seven main hubs, the current hub's sub-tabs, an IN / US switch where the
// tool has a USA twin, and the extra pages / saved presets of the current sub-tab as small links. Pure navigation:
// every page keeps its own address.
import { useEffect, useState } from 'react';
import NavLink from '@/components/NavLink';
import { HUBS, hubFor, linkMatch, type HubTab } from '@/lib/nav-hubs';

const chip = (on: boolean): React.CSSProperties => ({
  fontSize: 12.5, fontWeight: on ? 900 : 700, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap', textDecoration: 'none',
  border: `1px solid ${on ? 'var(--mc-cyan)' : 'var(--mc-border-2)'}`, color: on ? 'var(--mc-cyan)' : 'var(--mc-text-2)',
  background: on ? 'color-mix(in srgb, var(--mc-cyan) 12%, transparent)' : 'transparent',
});

export default function HubTabs({ pathname, search }: { pathname: string; search: string }) {
  const [hash, setHash] = useState('');
  useEffect(() => { const f = () => setHash(window.location.hash || ''); f(); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, [pathname]);
  const at = hubFor(pathname, search, hash);
  const isOn = (t: HubTab) => at?.tab === t;
  const linkOn = (l: string) => linkMatch(l, pathname, search, hash) >= 0 && at?.link === l;
  return (
    <nav aria-label="Main hubs" data-testid="hub-tabs" style={{ borderBottom: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', padding: '6px 12px', display: 'grid', gap: 5 }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', alignItems: 'center' }}>
        {HUBS.map((h) => {
          const on = at?.hub.id === h.id;
          return <NavLink key={h.id} href={h.home} title={h.blurb} style={{ ...chip(on), fontSize: 13, padding: '4px 12px' }}>{h.icon} {h.label}</NavLink>;
        })}
      </div>
      {at && (
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', alignItems: 'center' }}>
          {at.hub.tabs.map((t) => (
            <span key={t.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {t.ext
                ? <a href={t.href} target="_blank" rel="noopener noreferrer" style={chip(false)}>{t.label} ↗</a>
                : <NavLink href={isOn(t) && at.market === 'US' && t.us ? t.us : t.href} style={chip(isOn(t))}>{t.label}</NavLink>}
              {t.us && isOn(t) && (
                <span style={{ display: 'inline-flex', border: '1px solid var(--mc-border-2)', borderRadius: 999, overflow: 'hidden' }}>
                  {([['IN', t.href, '🇮🇳'], ['US', t.us, '🇺🇸']] as const).map(([m, href, flag]) => (
                    <NavLink key={m} href={href} title={m === 'IN' ? 'India' : 'USA'} style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 7px', textDecoration: 'none', color: at.market === m || (at.market == null && m === 'IN') ? 'var(--mc-cyan)' : 'var(--mc-text-3)', background: at.market === m || (at.market == null && m === 'IN') ? 'color-mix(in srgb, var(--mc-cyan) 12%, transparent)' : 'transparent' }}>{flag} {m}</NavLink>
                  ))}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {at?.tab.more?.length ? (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: 'var(--mc-text-4)', fontWeight: 800 }}>{at.tab.label.toUpperCase()} ›</span>
          <NavLink href={at.tab.href} style={{ color: linkOn(at.tab.href) ? 'var(--mc-cyan)' : 'var(--mc-text-3)', fontWeight: linkOn(at.tab.href) ? 900 : 600, textDecoration: 'none' }}>main</NavLink>
          {at.tab.more.map((m) => <NavLink key={m.href} href={m.href} style={{ color: linkOn(m.href) ? 'var(--mc-cyan)' : 'var(--mc-text-3)', fontWeight: linkOn(m.href) ? 900 : 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>{m.label}</NavLink>)}
        </div>
      ) : null}
    </nav>
  );
}
