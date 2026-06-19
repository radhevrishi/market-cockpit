// PATCH 1101qqq — Shared loader for auto-synced screener.in CSVs.
//
// The GitHub Action workflow `screener-sync.yml` commits CSV exports to
// /data/screener/<filename>.csv daily. This module reads the manifest +
// fetches CSVs, then exposes them in shapes the existing upload handlers
// already understand:
//
//   * Multibagger India `handleFiles(files: FileList | File[])` — wants real
//     File objects so it can call XLSX.read.
//   * Fundamentals `handleText(text: string, name: string)` — wants raw CSV
//     text + the source filename.
//
// Routing config below is the single source of truth for which auto-synced
// file goes into which analyzer scope.

export type SyncManifest = {
  lastSync: string;     // ISO date
  ok: number;
  fail: number;
  files: { name: string; size: number }[];
};

// Per-target file routing. Add/remove entries here when screen list changes.
export const SYNC_ROUTING = {
  // All 12 saved screens flow into Multibagger India as a single merged pool.
  multibaggerIndia: [
    'fii.csv',
    'future-leaders.csv',
    'lowequitycapital.csv',
    'multibagger2-ignoring-trend.csv',
    'stocks-like-bajaj-consumer.csv',
    'rajeev-thakkar-ppfas-screener.csv',
    '100-baggers-sales-and-eps-growth.csv',
    'multibagger-like-acutaasatlantadee-dev.csv',
    'pead-master-screener-rishi-framework.csv',
    'ipobases.csv',
    'great-results-and-pullback.csv',
    'capex.csv',
  ],
  // Latest portfolio — single watchlist.
  portfolioIndia: 'watchlist-10432429.csv',
  // Watchlists go into the Watchlist Fundamentals scope.
  watchlistIndia: [
    'watchlist-10432585.csv',
    'watchlist-8105148.csv',
  ],
} as const;

const MANIFEST_URL = '/data/screener/manifest.json';
const FILE_URL_BASE = '/data/screener/';

export async function fetchManifest(): Promise<SyncManifest | null> {
  try {
    const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as SyncManifest;
  } catch {
    return null;
  }
}

export async function fetchCsvText(filename: string): Promise<string | null> {
  try {
    const r = await fetch(FILE_URL_BASE + filename, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// Materialize the chosen CSVs as File objects so they can be passed straight
// into Multibagger's existing handleFiles() upload pipeline.
export async function fetchCsvsAsFiles(filenames: readonly string[]): Promise<File[]> {
  const out: File[] = [];
  for (const fname of filenames) {
    const text = await fetchCsvText(fname);
    if (!text) continue;
    const blob = new Blob([text], { type: 'text/csv' });
    out.push(new File([blob], fname, { type: 'text/csv' }));
  }
  return out;
}

// Convenience helper for tabs that just need to know whether the sync exists
// and how fresh it is.
export type SyncStatus = {
  hasManifest: boolean;
  lastSync: Date | null;
  hoursOld: number | null;
  isStale: boolean;       // > 36h
  okCount: number;
  failCount: number;
  files: string[];
};

export async function getSyncStatus(): Promise<SyncStatus> {
  const m = await fetchManifest();
  if (!m) {
    return { hasManifest: false, lastSync: null, hoursOld: null, isStale: true, okCount: 0, failCount: 0, files: [] };
  }
  const lastSync = new Date(m.lastSync);
  const hoursOld = (Date.now() - lastSync.getTime()) / 3_600_000;
  return {
    hasManifest: true,
    lastSync,
    hoursOld,
    isStale: hoursOld > 36,
    okCount: m.ok,
    failCount: m.fail,
    files: m.files.map(f => f.name),
  };
}

// localStorage flag so we only auto-load ONCE per scope per browser. User can
// always force a re-sync via the visible "Sync from screener.in" button.
export function autoLoadKey(scope: string): string {
  return 'mc:sync:autoload:' + scope + ':v1';
}

export function shouldAutoLoad(scope: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return !localStorage.getItem(autoLoadKey(scope)); } catch { return false; }
}

export function markAutoLoaded(scope: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(autoLoadKey(scope), new Date().toISOString()); } catch {}
}

export function resetAutoLoadFlag(scope: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(autoLoadKey(scope)); } catch {}
}
