'use client';
// zzz796 — phone navigation (≤768px): a bottom tab bar with Home, Favourites,
// Search and Menu. Favourites opens a sheet with every ★ page; Menu opens the
// full sidebar as a drawer (with the ★ toggles, Settings, Install and Sign out).
// The desktop sidebar is hidden on phones; this replaces it there.
import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import NavLink from '@/components/NavLink';   // zzz1052 — prefetch on hover / focus / press, not on scroll-into-view
import { Home, Star, Search, Menu as MenuIcon, Settings, LogOut, Smartphone } from 'lucide-react';
import { useInstallState } from './pwa-state';
import s from './pwa.module.css';
import { navPrefetch } from '@/lib/shell-fetch';
import { filterMenuGroups } from '@/lib/home-tools';   // zzz1065 — phone Menu filter

export interface MobileNavItem { href: string; label: string; icon: ReactNode }
export interface MobileNavGroup { id: string; label: string; items: MobileNavItem[] }

interface Props {
  groups: MobileNavGroup[];
  favs: string[];
  pathname: string | null;
  isActive: (href: string) => boolean;
  onToggleFav: (href: string) => void;
  onSearch: () => void;
  onSignOut: () => void;
}

/** A readable name for a starred page that is not in the menu any more. */
export function prettyHref(href: string): string {
  const path = href.split('?')[0].replace(/^\/+|\/+$/g, '');
  if (!path) return 'Home';
  const words = path.split('/').pop()!.split('-').filter(Boolean);
  return words.map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

/** Every starred page, in the same order as the sidebar; unknown ones last. */
export function favouriteEntries(groups: MobileNavGroup[], favs: string[]): Array<{ href: string; label: string; icon: ReactNode | null }> {
  const all: MobileNavItem[] = [];
  const seen = new Set<string>();
  for (const g of groups) for (const it of g.items) if (!seen.has(it.href)) { seen.add(it.href); all.push(it); }
  const out: Array<{ href: string; label: string; icon: ReactNode | null }> = all
    .filter((i) => favs.includes(i.href))
    .map((i) => ({ href: i.href, label: i.label, icon: i.icon }));
  for (const h of favs) if (!seen.has(h)) out.push({ href: h, label: prettyHref(h), icon: null });
  return out;
}

export default function MobileNav({ groups, favs, pathname, isActive, onToggleFav, onSearch, onSignOut }: Props) {
  const [open, setOpen] = useState<null | 'favs' | 'menu'>(null);
  const [menuQuery, setMenuQuery] = useState('');   // zzz1065 — filter box in the phone Menu
  const install = useInstallState();

  useEffect(() => { setOpen(null); }, [pathname]);
  useEffect(() => { if (open !== 'menu') setMenuQuery(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const favList = useMemo(() => favouriteEntries(groups, favs), [groups, favs]);
  const menuGroups = useMemo(() => filterMenuGroups(groups, menuQuery), [groups, menuQuery]);
  const homeActive = pathname === '/';
  const closeOnLink = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('a')) setOpen(null); };

  return (
    <>
      <nav className={s.tabBar} aria-label="App navigation">
        <NavLink href="/" className={`${s.tab} ${homeActive && !open ? s.tabActive : ''}`} aria-current={homeActive ? 'page' : undefined}>
          <Home size={22} aria-hidden />
          <span>Home</span>
        </NavLink>
        <button type="button" className={`${s.tab} ${open === 'favs' ? s.tabActive : ''}`} aria-haspopup="dialog" aria-expanded={open === 'favs'}
          onClick={() => setOpen((o) => (o === 'favs' ? null : 'favs'))}>
          <Star size={22} aria-hidden className={s.tabStar} fill={open === 'favs' ? 'currentColor' : 'none'} />
          <span>Favourites</span>
        </button>
        <button type="button" className={s.tab} onClick={() => { setOpen(null); onSearch(); }}>
          <Search size={22} aria-hidden />
          <span>Search</span>
        </button>
        <button type="button" className={`${s.tab} ${open === 'menu' ? s.tabActive : ''}`} aria-haspopup="dialog" aria-expanded={open === 'menu'}
          onClick={() => setOpen((o) => (o === 'menu' ? null : 'menu'))}>
          <MenuIcon size={22} aria-hidden />
          <span>Menu</span>
        </button>
      </nav>

      {open && <div className={s.backdrop} onClick={() => setOpen(null)} aria-hidden />}

      {open === 'favs' && (
        <div className={s.sheet} role="dialog" aria-modal="true" aria-label="Favourites" onClick={closeOnLink}>
          <div className={s.sheetHandle} aria-hidden />
          <div className={s.sheetHead}>
            <h2 className={s.sheetTitle}>★ Favourites</h2>
            <button type="button" className={s.closeBtn} aria-label="Close" onClick={() => setOpen(null)}>✕</button>
          </div>
          <div className={s.sheetBody}>
            {favList.length === 0 ? (
              <div className={s.emptyNote}>
                No favourites yet. Open <b>Menu</b> and tap the ☆ next to any page to pin it here.
              </div>
            ) : (
              <div className={s.favGrid}>
                {favList.map((f, fi) => (
                  <NavLink key={f.href} href={f.href} prefetch={navPrefetch(f.href, fi)} className={`${s.favItem} ${isActive(f.href.split('?')[0]) && !f.href.includes('?') ? s.favItemActive : ''}`}>
                    <span className={s.favIcon} aria-hidden>{f.icon ?? <Star size={16} />}</span>
                    <span>{f.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {open === 'menu' && (
        <div className={s.drawer} role="dialog" aria-modal="true" aria-label="Menu" onClick={closeOnLink}>
          <div className={s.sheetHead}>
            <h2 className={s.sheetTitle}>Menu</h2>
            <button type="button" className={s.closeBtn} aria-label="Close" onClick={() => setOpen(null)}>✕</button>
          </div>
          <div className={s.sheetBody}>
            <div className={s.menuFilter}>
              <input type="search" className={s.menuFilterInput} value={menuQuery} onChange={(e) => setMenuQuery(e.target.value)}
                placeholder="Find a page…" aria-label="Find a page in the menu" autoComplete="off" />
            </div>
            {menuGroups.length === 0 && (
              <div className={s.emptyNote}>No page matches “{menuQuery}”. Try the Search tab for companies.</div>
            )}
            {menuGroups.map((g) => (
              <div key={g.id}>
                <div className={s.groupLabel}>{g.label}</div>
                {g.items.map((it) => {
                  const starred = favs.includes(it.href);
                  const active = !it.href.includes('?') && isActive(it.href);
                  return (
                    <div key={`${g.id}-${it.href}`} className={s.menuRow}>
                      <NavLink href={it.href} prefetch={navPrefetch(it.href, null)} className={`${s.menuLink} ${active ? s.menuLinkActive : ''}`} aria-current={active ? 'page' : undefined}>
                        <span aria-hidden>{it.icon}</span>
                        <span className={s.menuLabel}>{it.label}</span>
                      </NavLink>
                      <button type="button" className={`${s.starBtn} ${starred ? s.starOn : ''}`} aria-pressed={starred}
                        aria-label={starred ? `Remove ${it.label} from favourites` : `Add ${it.label} to favourites`}
                        onClick={() => onToggleFav(it.href)}>{starred ? '★' : '☆'}</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={s.menuFooter}>
            <NavLink href="/settings" prefetch={false} className={s.menuLink}><Settings size={18} aria-hidden /> Settings</NavLink>
            {!install.standalone && (
              <NavLink href="/settings#install-app" prefetch={false} className={s.menuLink}><Smartphone size={18} aria-hidden /> Install app</NavLink>
            )}
            <button type="button" className={s.signOut} onClick={onSignOut}><LogOut size={18} aria-hidden /> Sign out</button>
          </div>
        </div>
      )}
    </>
  );
}
