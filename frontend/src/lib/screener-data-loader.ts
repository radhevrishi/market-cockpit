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
  // zzz207 — Volume Pockets screens surface in the INDIA TECHNICALS tab
  // (VolumePocketsPanel) as a cross-referenced watch strip, NOT in the
  // Multibagger India fundamental pool. Files may land as .csv or .xlsx —
  // consumers should match by slug prefix against the manifest.
  volumePocketsIndia: [
    'weekly-volume-pockets',
    'monthly-volume-pockets',
  ],
  // zzz215 — Turnarounds tab auto-sync: two dedicated screens pooled into
  // the TurnaroundCompare analyzer.
  turnaroundsIndia: [
    'turnarounds.csv',
    'debt-reduction.csv',
  ],
  // Watchlists go into the Watchlist Fundamentals scope.
  watchlistIndia: [
    'watchlist-10432585.csv',
    'watchlist-8105148.csv',
  ],
  // zzz162 — USA Multibagger auto-sync from TradingView screener exports.
  // These CSVs land in /data/tradingview/ (not /data/screener/) via
  // .github/workflows/tradingview-sync.yml. Callers should use
  // fetchTradingviewCsvsAsFiles() to load them.
  // zzz165 — User cleaned the Bonde TradingView screener to USA-only stocks,
  // so restoring it to USA Multibagger routing. (zzz163 exchange filter stays
  // as a defensive backstop in case any drift back in future.)
  multibaggerUsa: [
    'sales-eps-growth-bonde.csv',
    'future-nvda-alab-app-pltr.csv',
    'usa-multibagger-3.csv',
    'future-super-scalers-nbis.csv',
    // zzz493 — SwBe8R8b returns USA-exchange stocks, so it belongs here (was
    // mis-routed into India). USA-exchange filter keeps it clean regardless.
    'usa-multibagger-tv-1.csv',
  ],
  // zzz479 — India Multibagger screeners that live on TradingView (not
  // screener.in). These CSVs land in /data/tradingview/ (like multibaggerUsa),
  // so they must be loaded with fetchTradingviewCsvsAsFiles() and are MERGED into
  // the India fundamental pool alongside the screener.in screens (handleFiles is
  // additive — it never replaces an existing screener.in row for the same ticker).
  multibaggerIndiaTV: [
    // zzz493 — only the genuinely India-exchange screener (I0y51g1p). The other
    // TradingView screener (SwBe8R8b) was USA stocks → moved to multibaggerUsa.
    'india-multibagger-tv-1.csv',
  ],
  portfolioUsa: 'watchlist-usa-339270482.csv',
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
  isStale: boolean;       // > 36h since last successful sync
  syncBroken: boolean;    // zzz269 — sync ran but 0 files landed (auth failure most common)
  okCount: number;
  failCount: number;
  files: string[];
  /** zzz687 — scheduled runs whose grace window has passed without landing. */
  missedRuns: number;
  /** zzz687 — at least one scheduled run is genuinely late, not merely due. */
  overdue: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════
// "15h ago" IS NOT AN ANSWER.                                        (zzz687)
//
// The chip printed the age of the manifest and left the reader to work out
// whether that was fine. It is not a question anyone can answer from a number,
// because the honest answer depends entirely on the schedule:
//
//   · the sync fires at 04:00, 05:30, 08:00 and 12:00 UTC — four times, all
//     inside Indian market hours, because screener.in does not change while
//     the market is shut;
//   · so the gap from the last run of one day to the first of the next is
//     SIXTEEN HOURS by design, and a perfectly healthy sync reads "15h ago"
//     every morning;
//   · but 15h at 06:30 UTC means the 04:00 AND 05:30 runs did not land, which
//     is a different thing entirely, and the old chip rendered both identically.
//
// `syncBroken` did not help: it fires only when the workflow RAN and fetched
// zero files (the expired-cookie case). A workflow that does not run at all —
// GitHub cron starvation, which this repo's own workflow documents as "30min-4hr,
// sometimes skips days" — set no flag whatsoever until the 36-hour staleness
// threshold, by which point a day of data is gone.
//
// So the status is computed against the SCHEDULE instead of against the clock.
// A run is only overdue once its scheduled time has passed by more than the
// starvation window the workflow itself budgets for. That turns a number the
// owner had to interpret into a statement: on time, or this many runs missed.
// ═══════════════════════════════════════════════════════════════════════════

/** UTC hours at which screener-sync.yml is scheduled. Keep in step with it. */
const SYNC_CRON_UTC_HOURS = [4, 5.5, 8, 12] as const;
/** GitHub's own scheduling delay, per the workflow's comments. */
const STARVATION_GRACE_H = 4;

/**
 * How many scheduled runs should have landed since `lastSync` but did not.
 *
 * Counts only fires that are already past their grace window, so a run that is
 * merely late — the normal case on GitHub — is never reported as missed.
 */
export function missedSyncRuns(lastSync: Date, now: Date = new Date()): number {
  let missed = 0;
  // Walk back over the last three days of scheduled fires; anything older than
  // that is comfortably covered by the staleness threshold.
  for (let dayOffset = 0; dayOffset <= 3; dayOffset++) {
    const day = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset,
    ));
    for (const h of SYNC_CRON_UTC_HOURS) {
      const fire = new Date(day.getTime() + h * 3_600_000);
      if (fire <= lastSync) continue;               // already covered by that sync
      if (fire.getTime() + STARVATION_GRACE_H * 3_600_000 > now.getTime()) continue; // still within grace
      missed++;
    }
  }
  return missed;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const m = await fetchManifest();
  if (!m) {
    return {
      hasManifest: false, lastSync: null, hoursOld: null, isStale: true, syncBroken: true,
      okCount: 0, failCount: 0, files: [], missedRuns: 0, overdue: false,
    };
  }
  const lastSync = new Date(m.lastSync);
  const hoursOld = (Date.now() - lastSync.getTime()) / 3_600_000;
  // zzz269 — a "broken" sync = manifest updated but zero files succeeded and at
  // least one attempted. Symptom of expired SCREENER_SESSION secret: workflow
  // runs, all POST /api/export requests return HTTP 403 HTML, IS_HTML guard
  // refuses to overwrite good CSVs, files rot in place while lastSync ticks.
  const syncBroken = m.ok === 0 && m.fail > 0;
  const missedRuns = missedSyncRuns(lastSync);
  return {
    hasManifest: true,
    lastSync,
    hoursOld,
    isStale: hoursOld > 36 || syncBroken || missedRuns > 0,
    syncBroken,
    okCount: m.ok,
    failCount: m.fail,
    files: m.files.map(f => f.name),
    missedRuns,
    overdue: missedRuns > 0,
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
    return { hasManifest: false, lastSync: null, hoursOld: null, isStale: true, syncBroken: true, okCount: 0, failCount: 0, files: [], missedRuns: 0, overdue: false };
  }
  const lastSync = new Date(m.lastSync);
  const hoursOld = (Date.now() - lastSync.getTime()) / 3_600_000;
  const syncBroken = m.ok === 0 && m.fail > 0;
  return {
    hasManifest: true,
    lastSync,
    hoursOld,
    // The TradingView sync runs on its own cadence, so no schedule check here —
    // the fields exist to satisfy one shared type, and claiming a missed run
    // against a schedule this loader does not know would be a guess.
    isStale: hoursOld > 36 || syncBroken,
    syncBroken,
    missedRuns: 0,
    overdue: false,
    okCount: m.ok,
    failCount: m.fail,
    files: m.files.map(f => f.name),
  };
}
