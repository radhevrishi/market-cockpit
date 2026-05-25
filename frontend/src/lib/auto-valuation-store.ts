// ═══════════════════════════════════════════════════════════════════════════
// AUTO-VALUATION PERSISTENCE (PATCH 0649)
//
// Saves auto-valuation reports keyed by ticker in localStorage so users can
// upload reports once and revisit the same company anytime without re-uploading.
//
// Storage layout: single object map keyed by ticker. Keeps the page light
// and lets us atomically read/write all saved companies via one event.
//
// User workflow:
//   1. Upload Excel + PDFs for AEROFLEX → page auto-saves report on success.
//   2. Close tab, come back next week → opening Auto-Valuation shows AEROFLEX
//      in the saved-companies list. Click to view; no re-upload needed.
//   3. Next quarter results drop → user clicks "Add docs" to append Q4 PDFs,
//      or "Clear" to wipe and start fresh.
//
// Document snapshots: we persist file names + sizes + parsed guidance items
// (NOT raw PDF text — too large for localStorage). On reload, the saved
// report renders directly; user only needs to re-attach if they want to
// re-extract guidance from raw text.
// ═══════════════════════════════════════════════════════════════════════════

const STORE_KEY = 'mc:auto-val:v1';
const MAX_SAVED = 50;          // cap to keep localStorage small

export interface SavedDocSnapshot {
  name: string;
  size: number;
  type: 'excel' | 'pdf' | 'unknown';
  message?: string;
  guidanceCount?: number;
  uploadedAt: string;          // ISO timestamp
}

export interface SavedAutoValuation {
  ticker: string;              // canonical key (uppercase)
  company?: string;
  sector?: string;
  savedAt: string;             // ISO timestamp
  forwardYear?: string;
  forwardRevenue?: number;
  forwardEBITDA?: number;
  forwardPAT?: number;
  inferredMargin?: number;
  recommendation: 'BUY' | 'WATCH' | 'WAIT' | 'AVOID' | 'NEED_MORE_DATA';
  rationale: string[];
  docSnapshots: SavedDocSnapshot[];
  // Inputs preserved so user can click 'Recompute' and re-run live API + calculators
  excelSummary?: {
    latestSales?: number;
    latestPAT?: number;
    latestEBITDA?: number;
    opmAvg?: number;
    salesCagr5y?: number;
    patCagr5y?: number;
    sharesOutstandingCr?: number;
    currentPriceFromSheet?: number;
    currentMarketCapCrFromSheet?: number;
  };
  // PATCH 0855 — Snapshot of live price at save time for the stale-price flag.
  // When cmp later moves >15% from this anchor, the saved-bench row surfaces
  // a ⚠ "stale valuation · cmp moved Xpct since save" chip.
  priceAtSave?: number;
  // Persisted full guidance list so we don't lose context
  guidance: Array<{
    fiscalYear: string;
    metric: string;
    unit: string;
    low?: number;
    high?: number;
    point?: number;
    rawPhrase: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  // Calculator results (rendered cards) so we can re-display without re-running
  peResult?: any;
  psResult?: any;
  evResult?: any;
  // PATCH 0657 — Year-2 projections (FY28-style)
  forwardYearY2?: string;
  forwardRevenueY2?: number;
  forwardEBITDAY2?: number;
  forwardPATY2?: number;
  peResultY2?: any;
  psResultY2?: any;
  evResultY2?: any;
}

function readAll(): Record<string, SavedAutoValuation> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch { return {}; }
}

function writeAll(map: Record<string, SavedAutoValuation>): void {
  if (typeof window === 'undefined') return;
  // Cap at MAX_SAVED entries, evicting oldest by savedAt
  const entries = Object.entries(map).sort(([, a], [, b]) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  const kept = entries.slice(0, MAX_SAVED);
  const trimmed = Object.fromEntries(kept);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('mc:auto-val:updated'));
  } catch (e) {
    // QuotaExceeded — drop the largest entry and retry once
    console.warn('Auto-Val storage quota exceeded; evicting oldest', e);
    const halved = Object.fromEntries(kept.slice(0, Math.floor(kept.length / 2)));
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(halved));
      window.dispatchEvent(new CustomEvent('mc:auto-val:updated'));
    } catch {}
  }
}

export function saveAutoValuation(report: Omit<SavedAutoValuation, 'savedAt'> & { savedAt?: string }): SavedAutoValuation {
  const ticker = (report.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  if (!ticker) throw new Error('Cannot save auto-valuation: no ticker');
  const all = readAll();
  const full: SavedAutoValuation = {
    ...report,
    ticker,
    savedAt: report.savedAt || new Date().toISOString(),
  };
  all[ticker] = full;
  writeAll(all);
  return full;
}

export function loadAutoValuation(ticker: string): SavedAutoValuation | undefined {
  const k = (ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  return readAll()[k];
}

export function deleteAutoValuation(ticker: string): void {
  const k = (ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  const all = readAll();
  delete all[k];
  writeAll(all);
}

/** List all saved valuations, sorted by savedAt desc. */
export function listAutoValuations(): SavedAutoValuation[] {
  const all = readAll();
  return Object.values(all).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

/** Append new document snapshots to an existing saved valuation without
 *  replacing the rest of the report. Useful for "Add docs" workflow when
 *  new quarter PDFs drop. */
export function appendDocsToSaved(ticker: string, newSnaps: SavedDocSnapshot[]): SavedAutoValuation | undefined {
  const k = (ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  const all = readAll();
  const existing = all[k];
  if (!existing) return undefined;
  existing.docSnapshots = [...(existing.docSnapshots || []), ...newSnaps];
  existing.savedAt = new Date().toISOString();
  all[k] = existing;
  writeAll(all);
  return existing;
}
