// ═══════════════════════════════════════════════════════════════════════════
// CONVICTION BEATS — institutional earnings-beat conviction pipeline.
//
// Auto-populated from /earnings-opportunities whenever a stock lands in the
// BLOCKBUSTER or STRONG tier. Persisted client-side (localStorage) so the
// user's bench survives across sessions without server state.
//
// Surface points:
//   - /watchlists  → "Conviction Beats" sub-tab shows full pipeline
//   - /earnings-hub → Scan sub-tab gets a "Conviction Beats only" filter
//   - /earnings-opportunities  → useSyncConvictionBeats() pushes graded
//     entries here on every successful payload
// ═══════════════════════════════════════════════════════════════════════════

export type ConvictionTier = 'BLOCKBUSTER' | 'STRONG';

// USER-REQ — Guidance in Conviction tab. Mirrors the Earnings Hub Scan
// GuidanceBadge — `guidance` is the label, `guidance_score` is the signed
// sentiment in [-1, +1] derived from positive vs negative regex matches
// over narrative / guidance_text / announcement_text. Optional so existing
// pre-Patch-0538 localStorage entries (no guidance fields) keep working.
export type GuidanceLabel = 'Positive' | 'Neutral' | 'Negative';

export interface ConvictionEntry {
  ticker: string;
  company: string;
  tier: ConvictionTier;
  composite_score: number;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  filing_date: string;        // YYYY-MM-DD
  sector?: string;
  market_cap_bucket?: string;
  added_at: string;           // ISO timestamp when first added
  source_url?: string;
  // USER-REQ — Guidance in Conviction tab (optional; missing on pre-0538 entries)
  guidance?: GuidanceLabel;
  guidance_score?: number;    // signed [-1, +1]
  // PATCH 0911 — Explicit quarter + fiscal year (Indian FY convention).
  // When syncing from EO graded payload, the route already returns a
  // `quarter` string like "Q4 FY26" — we preserve it here so filters
  // don't have to GUESS from filing_date (which is fragile for late
  // filings or filings that span multiple quarters).
  //   quarter — 'Q1' | 'Q2' | 'Q3' | 'Q4'
  //   fiscal_year — 4-digit (e.g. 2026 for FY26, the year that contains Mar)
  // Both optional — old entries fall through to deriveQuarterFY heuristic.
  quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  fiscal_year?: number;
}

const LS_KEY = 'mc:conviction-beats:v1';

/** Read all conviction entries from localStorage */
export function readConvictionBeats(): Record<string, ConvictionEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Persist the full map */
function writeConvictionBeats(map: Record<string, ConvictionEntry>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
}

/** Add or update a single entry — newer filing_date wins */
export function upsertConviction(entry: ConvictionEntry): boolean {
  const map = readConvictionBeats();
  const key = entry.ticker.toUpperCase();
  const existing = map[key];
  // Only overwrite if new entry has a fresher filing_date or higher tier
  if (existing) {
    const newerDate = entry.filing_date > existing.filing_date;
    const tierUpgrade = entry.tier === 'BLOCKBUSTER' && existing.tier === 'STRONG';
    if (!newerDate && !tierUpgrade) return false;
  }
  map[key] = { ...entry, ticker: key, added_at: existing?.added_at || new Date().toISOString() };
  writeConvictionBeats(map);
  // Notify listeners (Watchlist tab refresh)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
  }
  return true;
}

/** Batch upsert — used by Earnings Ops on every render */
export function syncFromEarningsOps(entries: Array<Omit<ConvictionEntry, 'added_at'>>): number {
  let count = 0;
  const map = readConvictionBeats();
  for (const e of entries) {
    const key = e.ticker.toUpperCase();
    const existing = map[key];
    if (existing) {
      const newerDate = e.filing_date > existing.filing_date;
      const tierUpgrade = e.tier === 'BLOCKBUSTER' && existing.tier === 'STRONG';
      if (!newerDate && !tierUpgrade) {
        // USER-REQ — Guidance in Conviction tab. Backfill guidance fields
        // onto existing same-filing entries so previously-stored entries
        // (pre-Patch 0538 or just lacking guidance) light up on the next
        // sync without forcing the user to prune-and-readd.
        if (existing.guidance == null && e.guidance != null) {
          map[key] = { ...existing, guidance: e.guidance, guidance_score: e.guidance_score };
          count++;
        }
        continue;
      }
    }
    map[key] = { ...e, ticker: key, added_at: existing?.added_at || new Date().toISOString() };
    count++;
  }
  if (count > 0) {
    writeConvictionBeats(map);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
    }
  }
  return count;
}

/** Remove a single ticker (user manually pruning) */
export function removeConviction(ticker: string) {
  const map = readConvictionBeats();
  delete map[ticker.toUpperCase()];
  writeConvictionBeats(map);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
  }
}

/** Quick membership check — used for filtering Scan / Watchlist */
export function isConviction(ticker: string): boolean {
  const map = readConvictionBeats();
  return !!map[ticker.toUpperCase()];
}

// AUDIT_100 #96 — module-scope cache of the parsed Set so 17+ pages calling
// getConvictionTickers() on every mount don't re-parse localStorage each time.
// Bust on 'conviction-beats:updated' (in-tab writes) and 'storage' (cross-tab).
let _cachedSet: Set<string> | null = null;
if (typeof window !== 'undefined') {
  const invalidate = () => { _cachedSet = null; };
  window.addEventListener('conviction-beats:updated', invalidate);
  window.addEventListener('storage', (e) => { if (e.key === LS_KEY) invalidate(); });
}
/** Get just the set of tickers (for filter performance) */
export function getConvictionTickers(): Set<string> {
  if (_cachedSet) return _cachedSet;
  const map = readConvictionBeats();
  _cachedSet = new Set(Object.keys(map));
  return _cachedSet;
}

/** Sorted list, newest filing first */
export function getConvictionList(): ConvictionEntry[] {
  const map = readConvictionBeats();
  return Object.values(map).sort((a, b) => {
    // Sort by filing_date desc, then by tier (BLOCKBUSTER first), then by score
    if (a.filing_date !== b.filing_date) return b.filing_date.localeCompare(a.filing_date);
    if (a.tier !== b.tier) return a.tier === 'BLOCKBUSTER' ? -1 : 1;
    return b.composite_score - a.composite_score;
  });
}

/** Clear all entries (rarely used — admin reset) */
export function clearConvictionBeats() {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(LS_KEY); } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
  }
}
