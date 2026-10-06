'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { SAVED_VIEWS_KEY } from './constants';
import { loadSavedViews, autoNameSavedView, persistSavedViews } from './helpers';
import { type SavedView } from './types';

export function SavedViewsControl() {
  const router = useRouter();
  const pathname = usePathname();
  const [views, setViews] = useState<SavedView[]>(() => loadSavedViews());
  const [open, setOpen] = useState(false);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVED_VIEWS_KEY) setViews(loadSavedViews());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const currentQuery = typeof window !== 'undefined' ? window.location.search : '';
  const isDefault = !currentQuery || currentQuery === '?' || currentQuery === '';
  const alreadySaved = views.find(v => v.query === currentQuery);

  const onSave = () => {
    if (isDefault) {
      alert('No filters are active. Set at least one filter before saving the view.');
      return;
    }
    if (alreadySaved) {
      alert(`This filter combo is already saved as "${alreadySaved.name}".`);
      return;
    }
    // PATCH 0569 (UX #1) — One-click save. Auto-name from active filters
    // (e.g. "BOTTLENECK · India · May 21"). User can rename via ✎ later.
    const name = autoNameSavedView(currentQuery).slice(0, 60);
    const next: SavedView = { id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name, query: currentQuery, createdAt: Date.now() };
    const updated = [next, ...views];
    setViews(updated);
    persistSavedViews(updated);
  };

  const onApply = (v: SavedView) => {
    router.replace(pathname + v.query, { scroll: false });
    setOpen(false);
  };

  const onRename = (v: SavedView) => {
    const name = window.prompt('Rename view:', v.name);
    if (!name?.trim()) return;
    const updated = views.map(x => x.id === v.id ? { ...x, name: name.trim().slice(0, 60) } : x);
    setViews(updated);
    persistSavedViews(updated);
  };

  const onDelete = (v: SavedView) => {
    if (!window.confirm(`Delete saved view "${v.name}"?`)) return;
    const updated = views.filter(x => x.id !== v.id);
    setViews(updated);
    persistSavedViews(updated);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
      <button
        onClick={onSave}
        title={alreadySaved ? `Already saved as "${alreadySaved.name}"` : isDefault ? 'Apply filters first, then save the view' : 'Save the current filter combination as a named view'}
        style={{
          backgroundColor: alreadySaved ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
          border: `1px solid ${alreadySaved ? 'var(--mc-cyan)' : 'var(--mc-border-1)'}`,
          color: alreadySaved ? 'var(--mc-cyan)' : '#6B7B8C',
          borderRadius: 5, padding: '4px 8px', cursor: isDefault ? 'not-allowed' : 'pointer',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
          opacity: isDefault ? 0.5 : 1,
        }}
      >{alreadySaved ? '★ SAVED' : '☆ SAVE VIEW'}</button>
      <button
        onClick={() => setOpen(v => !v)}
        title={`${views.length} saved view${views.length === 1 ? '' : 's'}`}
        style={{
          backgroundColor: open ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
          border: `1px solid ${open ? 'var(--mc-cyan)' : 'var(--mc-border-1)'}`,
          color: open ? 'var(--mc-cyan)' : '#6B7B8C',
          borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
        }}
      >VIEWS ({views.length}) {open ? '▴' : '▾'}</button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50,
            backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 8,
            padding: 6, minWidth: 280, maxWidth: 360, maxHeight: 320, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {views.length === 0 ? (
            <div style={{ padding: '12px 10px', fontSize: 11, color: '#6B7B8C' }}>
              No saved views yet. Apply some filters and click ☆ SAVE VIEW.
            </div>
          ) : (
            views.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 4, borderRadius: 5 }}>
                <button
                  onClick={() => onApply(v)}
                  style={{
                    flex: 1, textAlign: 'left',
                    backgroundColor: 'transparent', border: 'none',
                    color: 'var(--mc-text-0)', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', padding: '4px 6px',
                  }}
                  title={`Apply view\n${v.query || '(default)'}`}
                >
                  <div>{v.name}</div>
                  <div style={{ fontSize: 9, color: '#6B7B8C', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                    {v.query.length > 50 ? v.query.slice(0, 48) + '…' : v.query || '(default)'}
                  </div>
                </button>
                <button onClick={() => onRename(v)} title="Rename" style={{ background: 'none', border: 'none', color: '#6B7B8C', fontSize: 11, cursor: 'pointer', padding: '2px 4px' }}>✎</button>
                <button onClick={() => onDelete(v)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--mc-bearish)', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}>✕</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
