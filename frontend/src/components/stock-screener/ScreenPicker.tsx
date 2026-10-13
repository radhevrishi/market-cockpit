'use client';
// zzz1006 — searchable screen picker: favourites, my screens, built-in USA / India, each with its market label. Picking a screen goes
// through the page's own switch (which asks first when the open screen has unsaved filters). Saved definitions are not touched.
import { useMemo, useRef, useState } from 'react';
import type { Screen } from '@/lib/screener/filters';
import { pickerGroups, readFavScreens, toggleFav, writeFavScreens } from '@/lib/screener/screen-picker';
import { listKeys, usePopover } from './screener-ui';

export default function ScreenPicker({ screens, builtInIds, currentId, currentName, currentMarket, dirty, onPick }: {
  screens: readonly Screen[]; builtInIds: ReadonlySet<string>; currentId: string; currentName: string; currentMarket: 'US' | 'IN'; dirty: boolean; onPick: (id: string) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readFavScreens()));
  const groups = useMemo(() => pickerGroups(screens, builtInIds, favs, q), [screens, builtInIds, favs, q]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const star = (id: string) => setFavs((cur) => { const next = toggleFav(cur, id); writeFavScreens(next); return next; });
  const pick = (id: string) => { setOpen(false); setQ(''); onPick(id); };
  const total = groups.reduce((n, g) => n + g.screens.length, 0);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="mcss-btn" aria-label="Screens" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        title={builtInIds.has(currentId) ? 'Built-in screen (your TradingView screen)' : 'A screen you saved here'} style={{ maxWidth: 'min(420px, 62vw)' }}>
        <span className="mcss-mk">{currentMarket === 'US' ? 'US' : 'IN'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 650 }}>{currentName}</span>
        {dirty ? <span className="mcss-dim" title="Unsaved filter changes">•</span> : null}
        <span className="mcss-dim" aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="mcss-pop" role="dialog" aria-label="Choose a screen" style={{ width: 'min(420px, 92vw)' }}>
          <input autoFocus className="mcss-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Find a screen — name, “usa”, “india”" aria-label="Find a screen" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.querySelector<HTMLElement>('.mcss-item')?.focus(); }
              if (e.key === 'Enter') { const first = groups[0]?.screens[0]; if (first) pick(first.id); }
            }} />
          <div ref={listRef} role="listbox" aria-label="Screens" onKeyDown={(e) => listKeys(e)} style={{ marginTop: 4 }}>
            {groups.map((g) => (
              <div key={g.id} role="group" aria-label={g.label}>
                <div className="mcss-grp">{g.label} <span style={{ fontWeight: 400 }}>· {g.screens.length}</span></div>
                {g.screens.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                    <button type="button" role="option" aria-selected={s.id === currentId} className={`mcss-item${s.id === currentId ? ' cur' : ''}`} data-screen={s.id} onClick={() => pick(s.id)}>
                      <span className="mcss-mk">{s.market === 'US' ? 'US' : 'IN'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      <span className="end">{s.filters.length} filter{s.filters.length === 1 ? '' : 's'}</span>
                    </button>
                    <button type="button" className="mcss-btn ghost sm" aria-pressed={favs.includes(s.id)} aria-label={`${favs.includes(s.id) ? 'Remove' : 'Add'} “${s.name}” ${favs.includes(s.id) ? 'from' : 'to'} favourites`}
                      title={favs.includes(s.id) ? 'Remove from favourites' : 'Add to favourites'} onClick={() => star(s.id)}
                      style={{ color: favs.includes(s.id) ? 'var(--ss-warn)' : 'var(--mc-text-4)', padding: '0 6px' }}>{favs.includes(s.id) ? '★' : '☆'}</button>
                  </div>
                ))}
              </div>
            ))}
            {!total ? <div className="mcss-dim" style={{ padding: 10 }}>No screen matches “{q}”.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
