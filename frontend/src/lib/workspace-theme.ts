'use client';
// zzz954 — one white/dark choice shared by Charts, the Watchlists page and the Stock Screener (TradingView's white view by default).
// Kept in this browser only (a display preference). The older Charts-only key (zzz943) is read once so an existing choice is kept.
import { useCallback, useEffect, useState } from 'react';

export const WORKSPACE_LIGHT_KEY = 'mc:workspace-light:v1';
const LEGACY_CHART_KEY = 'mc:chart-light:v1';
const EVENT = 'mc:workspace-theme';

/** true = white. No saved choice → white. */
export function readWorkspaceLight(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const v = storage?.getItem(WORKSPACE_LIGHT_KEY) ?? storage?.getItem(LEGACY_CHART_KEY) ?? null;
    return v !== '0';
  } catch { return true; }
}

/** ssrSafe: for a page rendered on the server too — start white (what the server drew) and read the saved choice after mounting. */
export function useWorkspaceLight(ssrSafe = false): [boolean, () => void] {
  const [light, setLight] = useState(() => (ssrSafe || typeof window === 'undefined' ? true : readWorkspaceLight(window.localStorage)));
  useEffect(() => {
    const sync = () => setLight(readWorkspaceLight(window.localStorage));
    if (ssrSafe) sync();
    const onStorage = (e: StorageEvent) => { if (e.key === WORKSPACE_LIGHT_KEY || e.key === null) sync(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, sync);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(EVENT, sync); };
  }, [ssrSafe]);
  const toggle = useCallback(() => {
    const next = !readWorkspaceLight(window.localStorage);
    try { window.localStorage.setItem(WORKSPACE_LIGHT_KEY, next ? '1' : '0'); } catch { /* storage blocked: this visit only */ }
    setLight(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [light, toggle];
}

/** Class names for a page root: the white token set, plus the overrides for older pages that still use dark hex colours inline. */
export const workspaceThemeClass = (light: boolean, legacyInline = false) => (light ? `mc-chart-light${legacyInline ? ' mc-light-legacy' : ''}` : 'mc-workspace-dark');
