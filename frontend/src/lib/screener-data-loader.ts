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
  // PATCH 1101rrr — displayName is screener.in's actual name for the
  // watchlist/screen (from page <title>) so the UI labels stay friendly.
  files: { name: string; size: number; displayName?: string }[];
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
  // zzz162 — USA Multibagger auto-sync from TradingView screener exports.
  // These CSVs land in /data/tradingview/ (not /data/screener/) via
  // .github/workflows/tradingview-sync.yml. Callers should use
  // fetchTradingviewCsvsAsFiles() to load them.
  // zzz164 — Dropped 'sales-eps-growth-bonde.csv' from USA Multibagger. The
  // Bonde screener has 26 NSE (India) tickers mixed in that leak through even
  // with zzz163's exchange filter (they were the actual source of TITAN,
  // BAJAJCON, WEBELSOLAR, etc. showing on the USA Multibagger tab). The 3
  // remaining screeners are 100% USA-market (~200 rows).
  multibaggerUsa: [
    'future-nvda-alab-app-pltr.csv',
    'usa-multibagger-3.csv',
    'future-super-scalers-nbis.csv',
  ],
} as const;

const MANIFEST_URL = '/data/screener/manifest.json';
const FILE_URL_BASE = '/data/screener/';
// zzz162 — TradingView CSVs live in a separate folder + manifest.
const TV_MANIFEST_URL = '/data/tradingview/manifest.json';
const TV_FILE_URL_BASE = '/data/tradingview/';

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
// PATCH 1101rrr — when the manifest carries a displayName, use it as the
// File's name. That string flows through to Multibagger's _screeners
// membership labels so the UI shows friendly names everywhere.
export async function fetchCsvsAsFiles(filenames: readonly string[]): Promise<File[]> {
  const manifest = await fetchManifest();
  const displayMap = new Map<string, string>();
  if (manifest) {
    for (const f of manifest.files) displayMap.set(f.name, f.displayName || f.name);
  }
  const out: File[] = [];
  for (const fname of filenames) {
    const text = await fetchCsvText(fname);
    if (!text) continue;
    const displayName = displayMap.get(fname) || fname;
    const blob = new Blob([text], { type: 'text/csv' });
    out.push(new File([blob], displayName, { type: 'text/csv' }));
  }
  return out;
}

// PATCH 1101rrr — single-file display-name lookup used by Fundamentals so
// the `Loaded: ...` chip shows the user's chosen watchlist name from
// screener.in instead of the raw filename.
export async function getDisplayName(filename: string): Promise<string> {
  const m = await fetchManifest();
  if (!m) return filename;
  const entry = m.files.find((f) => f.name === filename);
  return entry?.displayName || filename;
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

// ═══════════════════════════════════════════════════════════════════════════
// zzz162 — TradingView CSV helpers (parallel to Screener.in ones above).
// TradingView CSVs live in /data/tradingview/ and are populated by the
// tradingview-sync.yml GitHub Action. Same shape as Screener.in manifest.
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchTradingviewManifest(): Promise<SyncManifest | null> {
  try {
    const r = await fetch(TV_MANIFEST_URL, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as SyncManifest;
  } catch {
    return null;
  }
}

export async function fetchTradingviewCsvText(filename: string): Promise<string | null> {
  try {
    const r = await fetch(TV_FILE_URL_BASE + filename, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

export async function fetchTradingviewCsvsAsFiles(filenames: readonly string[]): Promise<File[]> {
  const manifest = await fetchTradingviewManifest();
  const displayMap = new Map<string, string>();
  if (manifest) {
    for (const f of manifest.files) displayMap.set(f.name, f.displayName || f.name);
  }
  const out: File[] = [];
  for (const fname of filenames) {
    const text = await fetchTradingviewCsvText(fname);
    if (!text) continue;
    const displayName = displayMap.get(fname) || fname;
    const blob = new Blob([text], { type: 'text/csv' });
    out.push(new File([blob], displayName, { type: 'text/csv' }));
  }
  return out;
}

export async function getTradingviewSyncStatus(): Promise<SyncStatus> {
  const m = await fetchTradingviewManifest();
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
