'use client';
// zzz954 — one white/dark choice shared by Charts, the Watchlists page and the Stock Screener (TradingView's white view by default).
// Kept in this browser only (a display preference). The older Charts-only key (zzz943) is read once so an existing choice is kept.
import { useCallback, useEffect, useState } from 'react';

export const WORKSPACE_LIGHT_KEY = 'mc:workspace-light:v1';
const LEGACY_CHART_KEY = 'mc:chart-light:v1';
const EVENT = 'mc:workspace-theme';
const SITE_THEME_KEY = 'mc:screen-theme:v1';   // must equal SCREEN_THEME_KEY in lib/theme.ts (checked by zzz997 test)

// zzz957: the choice made in this visit, used when the browser refuses to store it (private mode, full or blocked storage) —
// otherwise the switch flipped back at once, because the re-read found the old saved value.
let memChoice: boolean | null = null;

/** true = white. No saved choice → white. A choice made this visit that storage would not keep wins over storage. */
export function readWorkspaceLight(storage: Pick<Storage, 'getItem'> | null): boolean {
  if (memChoice != null) return memChoice;
  try {
    const v = storage?.getItem(WORKSPACE_LIGHT_KEY) ?? storage?.getItem(LEGACY_CHART_KEY) ?? null;
    if (v == null) return storage?.getItem(SITE_THEME_KEY) !== 'dark';   // zzz997: no own choice yet → follow the site's ☀/🌙
    return v !== '0';
  } catch { return true; }
}
/** Store the choice; returns false when the browser would not keep it (the choice still holds for this visit). */
export function writeWorkspaceLight(storage: Pick<Storage, 'setItem' | 'getItem'> | null, light: boolean): boolean {
  try {
    storage?.setItem(WORKSPACE_LIGHT_KEY, light ? '1' : '0');
    if (storage?.getItem(WORKSPACE_LIGHT_KEY) === (light ? '1' : '0')) { memChoice = null; return true; }
  } catch { /* blocked */ }
  memChoice = light;
  return false;
}
/** zzz997 — set the workspace choice from outside (the site header's ☀/🌙) and tell every open workspace page. */
export function setWorkspaceLight(light: boolean): void {
  if (typeof window === 'undefined') return;
  let store: Storage | null = null;
  try { store = window.localStorage; } catch { /* blocked */ }
  writeWorkspaceLight(store, light);
  window.dispatchEvent(new Event(EVENT));
}
/** Test helper. */
export function _resetWorkspaceThemeMemory(): void { memChoice = null; }

/** ssrSafe: for a page rendered on the server too — start white (what the server drew) and read the saved choice after mounting. */
export function useWorkspaceLight(ssrSafe = false): [boolean, () => void] {
  const [light, setLight] = useState(() => { if (ssrSafe || typeof window === 'undefined') return true; try { return readWorkspaceLight(window.localStorage); } catch { return readWorkspaceLight(null); } });
  useEffect(() => {
    const sync = () => { let store: Storage | null = null; try { store = window.localStorage; } catch { /* blocked */ } setLight(readWorkspaceLight(store)); };
    if (ssrSafe) sync();
    const onStorage = (e: StorageEvent) => { if (e.key === WORKSPACE_LIGHT_KEY || e.key === null) sync(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, sync);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(EVENT, sync); };
  }, [ssrSafe]);
  const toggle = useCallback(() => {
    let store: Storage | null = null;
    try { store = window.localStorage; } catch { /* blocked */ }
    const next = !readWorkspaceLight(store);
    writeWorkspaceLight(store, next);
    setLight(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [light, toggle];
}

/** Class names for a page root: the white token set, plus the overrides for older pages that still use dark hex colours inline. */
export const workspaceThemeClass = (light: boolean, legacyInline = false) => (light ? `mc-chart-light${legacyInline ? ' mc-light-legacy' : ''}` : 'mc-workspace-dark');
