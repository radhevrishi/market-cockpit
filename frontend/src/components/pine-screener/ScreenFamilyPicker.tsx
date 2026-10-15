'use client';
// zzz1045a — browse the Pine screens by family, with a search box and ☆ favourites (favourites first). Picking a screen goes through
// the page's own loadScreen (which asks first when the open screen has unsaved changes). Screen definitions are never touched.
import { useMemo, useState } from 'react';
import type { PineScreen } from '@/lib/screener/pine';
import { pineFamilyGroups, PINE_FAMILIES } from '@/lib/screener/pine-families';
import { C } from './pine-ui';

export function ScreenFamilyPicker({ screens, builtInIds, currentId, favs, onToggleFav, onPick }: {
  screens: readonly PineScreen[]; builtInIds: ReadonlySet<string>; currentId: string; favs: readonly string[];
  onToggleFav: (id: string) => void; onPick: (id: string) => boolean | void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const groups = useMemo(() => pineFamilyGroups(screens, builtInIds, favs, q), [screens, builtInIds, favs, q]);
  const total = groups.reduce((n, g) => n + g.screens.length, 0);
  const hint = (id: string) => PINE_FAMILIES.find((f) => f.id === id)?.hint || '';
  const pick = (id: string) => { if (onPick(id) !== false) { setOpen(false); setQ(''); } };
  return (
    <div data-testid="pine-family-picker" style={{ display: 'grid', gap: 6 }}>
      <button type="button" className="pnx-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ justifySelf: 'start', padding: '3px 9px', fontSize: 12 }}
        title="Browse the screens by family, search them and mark favourites">{open ? '▾' : '▸'} Browse screens by family{favs.length ? ` · ★ ${favs.length}` : ''}</button>
      {open ? (
        <div style={{ display: 'grid', gap: 6, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, maxHeight: 420, overflowY: 'auto' }}>
          <input autoFocus className="pnx-in" placeholder="Find a screen — name or family" aria-label="Find a Pine screen" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { const first = groups[0]?.screens[0]; if (first) pick(first.id); } if (e.key === 'Escape') setOpen(false); }} />
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.label} data-family={g.id} style={{ display: 'grid', gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: g.id === 'fav' ? C.amber : C.dim }} title={hint(g.id)}>{g.id === 'fav' ? '★ ' : ''}{g.label} <span style={{ fontWeight: 400 }}>· {g.screens.length}</span></span>
              {g.screens.map((s) => {
                const fav = favs.includes(s.id);
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button type="button" data-pick={s.id} aria-current={s.id === currentId} onClick={() => pick(s.id)} title={s.note || s.name}
                      style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0, padding: '3px 6px', borderRadius: 6, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontWeight: s.id === currentId ? 700 : 500, color: s.id === currentId ? C.accent : C.text1 }}>
                      {s.market ? (s.market === 'IN' ? '🇮🇳 ' : '🇺🇸 ') : ''}{s.name}
                    </button>
                    <button type="button" data-fav={s.id} aria-pressed={fav} aria-label={`${fav ? 'Remove' : 'Add'} “${s.name}” ${fav ? 'from' : 'to'} favourites`}
                      title={fav ? 'Remove from favourites' : 'Add to favourites'} onClick={() => onToggleFav(s.id)}
                      style={{ all: 'unset', cursor: 'pointer', padding: '0 6px', color: fav ? C.amber : C.dim }}>{fav ? '★' : '☆'}</button>
                  </div>
                );
              })}
            </div>
          ))}
          {!total ? <div style={{ fontSize: 12.5, color: C.dim, padding: 4 }}>No screen matches “{q}”.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
