'use client';
// zzz1006 — searchable screen picker: favourites, my screens, built-in USA / India, each with its market label. Picking a screen goes
// through the page's own switch (which asks first when the open screen has unsaved filters). Saved definitions are not touched.
// zzz1069 — shows ONLY the open market's screens (India → India screens, USA → USA screens); the other market is one click away.
import { useMemo, useRef, useState } from 'react';
import type { Screen } from '@/lib/screener/filters';
import { otherMarketScreenCount, pickerGroups, readFavScreens, toggleFav, writeFavScreens } from '@/lib/screener/screen-picker';
import { listKeys, usePopover } from './screener-ui';

export default function ScreenPicker({ screens, builtInIds, currentId, currentName, currentMarket, dirty, onPick, hidden = [], onRemove, onRestore, onSwitchMarket }: {
  screens: readonly Screen[]; builtInIds: ReadonlySet<string>; currentId: string; currentName: string; currentMarket: 'US' | 'IN'; dirty: boolean; onPick: (id: string) => void;
  /** zzz1043 — built-in screens taken off the list; `onRemove` deletes a screen the owner made / hides a built-in one; `onRestore` brings a hidden one back */
  hidden?: readonly string[]; onRemove?: (id: string) => void; onRestore?: (id: string) => void;
  /** zzz1069 — open the other market (the page's own market switch) */
  onSwitchMarket?: (m: 'US' | 'IN') => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readFavScreens()));
  const groups = useMemo(() => pickerGroups(screens, builtInIds, favs, q, hidden, currentMarket), [screens, builtInIds, favs, q, hidden, currentMarket]);
  const other: 'US' | 'IN' = currentMarket === 'US' ? 'IN' : 'US';
  const mkName = (m: 'US' | 'IN') => (m === 'US' ? 'USA' : 'India');
  const otherCount = useMemo(() => otherMarketScreenCount(screens, currentMarket, hidden), [screens, currentMarket, hidden]);
  const [showHidden, setShowHidden] = useState(false);
  const hiddenScreens = useMemo(() => screens.filter((s) => hidden.includes(s.id) && s.market === currentMarket), [screens, hidden, currentMarket]);
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
          <input autoFocus className="mcss-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder={`Find a ${mkName(currentMarket)} screen`} aria-label="Find a screen" value={q}
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
                    {onRemove ? (
                      <button type="button" className="mcss-btn ghost sm" data-remove={s.id} aria-label={`${builtInIds.has(s.id) ? 'Hide' : 'Delete'} “${s.name}”`}
                        title={builtInIds.has(s.id) ? 'Remove this built-in screen from the list (bring it back from “Hidden screens” below)' : 'Delete this screen'}
                        onClick={() => onRemove(s.id)} style={{ color: 'var(--mc-text-4)', padding: '0 6px' }}>🗑</button>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
            {!total ? <div className="mcss-dim" style={{ padding: 10 }}>{q ? <>No {mkName(currentMarket)} screen matches “{q}”.</> : <>No {mkName(currentMarket)} screens yet.</>}</div> : null}
            {hiddenScreens.length && onRestore ? (
              <div role="group" aria-label="Hidden screens" style={{ borderTop: '1px solid var(--mc-border, rgba(127,127,127,.25))', marginTop: 4, paddingTop: 4 }}>
                <button type="button" className="mcss-item" aria-expanded={showHidden} data-hidden-toggle onClick={() => setShowHidden((v) => !v)}>
                  <span className="mcss-dim">{showHidden ? '▾' : '▸'} Hidden screens · {hiddenScreens.length}</span>
                </button>
                {showHidden ? hiddenScreens.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="mcss-item" style={{ opacity: 0.6, cursor: 'default' }}>
                      <span className="mcss-mk">{s.market === 'US' ? 'US' : 'IN'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    </span>
                    <button type="button" className="mcss-btn ghost sm" data-restore={s.id} onClick={() => onRestore(s.id)} title="Put this screen back in the list" style={{ padding: '0 8px' }}>Restore</button>
                  </div>
                )) : null}
              </div>
            ) : null}
          </div>
          {otherCount && onSwitchMarket ? (
            <div className="mcss-dim" data-other-market style={{ borderTop: '1px solid var(--mc-border, rgba(127,127,127,.25))', marginTop: 4, paddingTop: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Showing {mkName(currentMarket)} screens only · {otherCount} {mkName(other)} screen{otherCount === 1 ? '' : 's'}</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="mcss-btn ghost sm" onClick={() => { setOpen(false); setQ(''); onSwitchMarket(other); }}>{other === 'US' ? '🇺🇸 Open USA' : '🇮🇳 Open India'}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
