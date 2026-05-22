// ═══════════════════════════════════════════════════════════════════════════
// CONCALL AI SNAPSHOT PERSISTENCE (PATCH 0650)
//
// Mirrors the auto-valuation persistence pattern for the Concall AI tab in
// Earnings Hub. Saves each successful concall analysis snapshot keyed by
// ticker so reopening the same company shows the prior result instantly
// without re-uploading PDFs.
//
// Workflow:
//   1. User uploads AEROFLEX concall PDF → analysis renders → auto-saved.
//   2. Next visit: same ticker auto-loads the saved snapshot.
//   3. Q4 results drop → '+ DOCS' appends new file → snapshot re-runs +
//      saves with new period.
//   4. Want a clean slate → '× CLEAR' wipes the saved entry.
//
// Storage layout: object map keyed by ticker in 'mc:concall-snap:v1'.
// 50-entry cap with oldest-first eviction.
// ═══════════════════════════════════════════════════════════════════════════

const STORE_KEY = 'mc:concall-snap:v1';
const MAX_SAVED = 50;

export interface ConcallDocSnapshot {
  name: string;
  size: number;
  uploadedAt: string;
  guidanceCount?: number;
}

export interface ConcallSnapshot {
  ticker: string;                  // canonical (uppercase, no .NS/.BO)
  company?: string;
  sector?: string;
  period?: string;                 // 'Q4 FY26' etc
  savedAt: string;                 // ISO timestamp
  // Snapshot of the analysis output (whatever the page produced)
  concallScore?: number;
  concallGrade?: string;
  toneSignals?: string[];
  topQuotes?: string[];
  guidanceDirection?: string;
  guidanceCommentary?: string[];
  forwardOutlook?: string;
  rationale?: string[];
  // For institutional reports
  resultBuy?: string;              // BUY / HOLD / WATCH / WAIT label
  resultPe?: string;
  // Document inputs persisted lightweight (no raw PDF text)
  docSnapshots: ConcallDocSnapshot[];
  // Free-form notes user can attach
  notes?: string;
}

function readAll(): Record<string, ConcallSnapshot> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function writeAll(map: Record<string, ConcallSnapshot>): void {
  if (typeof window === 'undefined') return;
  const entries = Object.entries(map).sort(([, a], [, b]) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  const trimmed = Object.fromEntries(entries.slice(0, MAX_SAVED));
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('mc:concall-snap:updated'));
  } catch (e) {
    // Quota exceeded — drop oldest half
    const half = Object.fromEntries(entries.slice(0, Math.floor(MAX_SAVED / 2)));
    try { localStorage.setItem(STORE_KEY, JSON.stringify(half)); } catch {}
    window.dispatchEvent(new CustomEvent('mc:concall-snap:updated'));
  }
}

export function saveConcallSnapshot(snap: Omit<ConcallSnapshot, 'savedAt'> & { savedAt?: string }): ConcallSnapshot {
  const ticker = (snap.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  if (!ticker) throw new Error('Cannot save concall snapshot: no ticker');
  const all = readAll();
  const full: ConcallSnapshot = { ...snap, ticker, savedAt: snap.savedAt || new Date().toISOString() };
  all[ticker] = full;
  writeAll(all);
  return full;
}

export function loadConcallSnapshot(ticker: string): ConcallSnapshot | undefined {
  const k = (ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  return readAll()[k];
}

export function deleteConcallSnapshot(ticker: string): void {
  const k = (ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  const all = readAll();
  delete all[k];
  writeAll(all);
}

export function listConcallSnapshots(): ConcallSnapshot[] {
  return Object.values(readAll()).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}
