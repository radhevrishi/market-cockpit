'use client';
// zzz1065 — the long A–Z list of tool links on the home page now sits in a closed "All tools" drawer with a search box.
// Before: ~60 chips filled the screen between the daily panels. The links themselves are unchanged (they are the
// children, NavLinks with intent prefetch); the search only hides the ones whose text does not match.
// Typing in the search box opens the drawer. The open / closed choice is remembered on this browser.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toolMatches } from '@/lib/home-tools';

const OPEN_KEY = 'mc:home-tools-open:v1';

export function ToolsDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<{ shown: number; total: number }>({ shown: 0, total: 0 });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true); } catch { /* closed */ } }, []);
  const setOpenSaved = (v: boolean) => { setOpen(v); try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

  useEffect(() => {
    const box = listRef.current;
    if (!box) return;
    const links = Array.from(box.querySelectorAll<HTMLAnchorElement>('a[href]'));
    let shown = 0;
    for (const el of links) {
      if (toolMatches(el.textContent || '', q)) { shown++; el.style.removeProperty('display'); }
      else el.style.display = 'none';
    }
    setCounts({ shown, total: links.length });
  }, [q, open, children]);

  return (
    <section data-home-section="all-tools" aria-label="All tools" style={{ border: '1px solid var(--mc-border-1)', borderRadius: 10, background: 'var(--mc-bg-1)', padding: '8px 10px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpenSaved(!open)} aria-expanded={open} aria-controls="home-all-tools"
          className="mc-tap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-2)', color: 'var(--mc-text-1)', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
          🧰 All tools {counts.total ? `(${q ? `${counts.shown} of ` : ''}${counts.total})` : ''} <span aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
        <input type="search" value={q} placeholder="Find a tool…" aria-label="Find a tool"
          onChange={(e) => { setQ(e.target.value); if (e.target.value && !open) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
          style={{ flex: '1 1 180px', minWidth: 0, maxWidth: 360, minHeight: 40, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', fontSize: 14 }} />
      </div>
      <div id="home-all-tools" ref={listRef} hidden={!open} style={{ marginTop: 10 }}>
        {children}
        {open && q && counts.shown === 0 && (
          <div style={{ fontSize: 13, color: 'var(--mc-text-3)', padding: '6px 2px' }}>No tool matches “{q}”. The side menu and ⌘K search list every page.</div>
        )}
      </div>
    </section>
  );
}
