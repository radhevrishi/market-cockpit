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
  // PATCH 1022 — actual market cap in ₹ Cr (from worker/Screener) so the
  // bench can render the figure + filter by cap range. Null for legacy entries.
  market_cap_cr?: number | null;
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
  // PATCH 0945 — Post-earnings price action carried over from EO graded
  // payload so the Conviction Beats tab can render + filter on D1 close
  // (same UX as /earnings Hub). Both nullable for legacy entries.
  d1_pct?: number | null;       // Day-1 close % vs prior day
  gap_pct?: number | null;      // Open gap % (open vs prior close)
  // zzz223 — OPM margin carried from the EO graded payload (latest-quarter
  // OPM % and prior-year OPM %) so Conviction Beats can render + filter the
  // margin expansion/squeeze signal exactly like Earnings Opportunities.
  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  // PATCH 1018 — institutional quality flags carried from EO graded payload
  // so the Conviction Beats tab can filter ⭐ELITE / 🔥PEAD / 💎MULTIBAGGER.
  is_elite?: boolean;
  pead_score?: number | null;
  multibagger_setup?: boolean;
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

// PATCH 0920 — Composite key support for multi-quarter bench history.
// User feedback: visiting EO Jan 29 2026 shows 24 graded BLOCKBUSTER/STRONG
// entries but the bench Q3 chip shows (0) — because syncFromEarningsOps used
// to key by TICKER only. When MTAR filed Q4 FY26 on May 22 2026, that entry
// OVERWROTE the older Q3 FY26 entry from Jan 29 (newer filing wins). Result:
// the bench was 99% Q4-FY26 even though the user had been browsing multiple
// quarters in EO.
//
// Fix: when an incoming filing is OLDER than what's already on the bench
// AND has a different quarter or FY, store it under a composite key
//   TICKER@Q-FY  (e.g. "MTAR@Q3-2026")
// so both versions coexist. The bare "TICKER" key is reserved for the
// most-recent filing (used by getConvictionTickers() for membership checks).
//
// Backward-compatible: existing bare-ticker entries are untouched; only NEW
// out-of-order syncs go to composite keys.
function compositeKey(ticker: string, q?: string, fy?: number): string {
  if (!q || !fy) return ticker.toUpperCase();
  return `${ticker.toUpperCase()}@${q}-${fy}`;
}

/** Batch upsert — used by Earnings Ops on every render.
 *  PATCH 0997 — Accepts ALL tiers (BB/ST/MX/AV). MX/AV entries act as
 *  DEMOTION signals: if a newer filing for an already-benched ticker
 *  arrives graded MX or AV, the bare-ticker bench entry is REMOVED.
 *  Composite-key historical entries (TICKER@Q3-2026) are preserved.
 */
type SyncEntry = Omit<ConvictionEntry, 'added_at' | 'tier'> & {
  tier: 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
};
export function syncFromEarningsOps(entries: Array<SyncEntry>): number {
  let count = 0;
  const map = readConvictionBeats();
  for (const e of entries) {
    const ticker = e.ticker.toUpperCase();
    const bareKey = ticker;
    const existing = map[bareKey];
    // PATCH 0997 — demotion path: incoming MIXED/AVOID with newer filing date
    // means the stock dropped out of BB/ST. Remove the bare-ticker entry.
    // PATCH 1018b — ALSO remove the matching composite key (TICKER@Q-FY) for
    // the SAME quarter being demoted. User report: a stock re-graded from
    // BLOCKBUSTER → MIXED (e.g. ADSL after the turnaround gate) must vanish
    // from the bench entirely, not linger under a composite history key.
    if (e.tier === 'MIXED' || e.tier === 'AVOID') {
      const incQ = (e as any).quarter;
      const incFY = (e as any).fiscal_year;
      if (existing && e.filing_date >= existing.filing_date) {
        delete map[bareKey];
        count++;
      }
      // Remove same-quarter composite entry for this ticker too.
      if (incQ && incFY) {
        const cKey = `${ticker}@${incQ}-${incFY}`;
        if (map[cKey]) { delete map[cKey]; count++; }
      }
      continue;  // never ADD MX/AV to the bench
    }
    if (existing) {
      const newerDate = e.filing_date > existing.filing_date;
      const tierUpgrade = e.tier === 'BLOCKBUSTER' && existing.tier === 'STRONG';
      if (!newerDate && !tierUpgrade) {
        // PATCH 0920 — If the incoming filing reports a DIFFERENT quarter
        // (or FY) than what's currently stored, archive it under composite
        // key so historical quarters survive instead of getting dropped.
        // Same-quarter older filings still get the guidance-backfill path.
        const sameQ = (e as any).quarter && existing.quarter && (e as any).quarter === existing.quarter;
        const sameFY = (e as any).fiscal_year && existing.fiscal_year && (e as any).fiscal_year === existing.fiscal_year;
        const isHistorical = (e as any).quarter && (e as any).fiscal_year && !(sameQ && sameFY);
        if (isHistorical) {
          const cKey = compositeKey(ticker, (e as any).quarter, (e as any).fiscal_year);
          if (!map[cKey]) {
            map[cKey] = { ...(e as any), ticker, added_at: new Date().toISOString() };
            count++;
          } else if (map[cKey].guidance == null && e.guidance != null) {
            map[cKey] = { ...map[cKey], guidance: e.guidance, guidance_score: e.guidance_score };
            count++;
          }
          continue;
        }
        // USER-REQ — Guidance in Conviction tab. Backfill guidance fields
        // onto existing same-filing entries so previously-stored entries
        // (pre-Patch 0538 or just lacking guidance) light up on the next
        // sync without forcing the user to prune-and-readd.
        if (existing.guidance == null && e.guidance != null) {
          map[bareKey] = { ...existing, guidance: e.guidance, guidance_score: e.guidance_score };
          count++;
        }
        // zzz223d — same backfill idea for every optional field added AFTER
        // the entry was stored (OPM margin, D1/gap, PEAD, quality flags,
        // market cap). Without this, existing bench entries could NEVER pick
        // up new fields because same-filing syncs skip the overwrite path.
        {
          const cur = map[bareKey] || existing;
          const patch: Partial<ConvictionEntry> = {};
          const fill = (k: keyof ConvictionEntry) => {
            if ((cur as any)[k] == null && (e as any)[k] != null) (patch as any)[k] = (e as any)[k];
          };
          fill('opm_pct'); fill('opm_prev_pct');
          fill('d1_pct'); fill('gap_pct');
          fill('pead_score'); fill('market_cap_cr');
          if ((cur as any).is_elite == null && (e as any).is_elite != null) (patch as any).is_elite = (e as any).is_elite;
          if ((cur as any).multibagger_setup == null && (e as any).multibagger_setup != null) (patch as any).multibagger_setup = (e as any).multibagger_setup;
          if (Object.keys(patch).length > 0) {
            map[bareKey] = { ...cur, ...patch };
            count++;
          }
        }
        continue;
      }
      // PATCH 0920 — incoming is NEWER or tier-upgrade. Before overwriting,
      // archive the current entry under its composite key SO LONG AS the
      // existing Q/FY DIFFERS from incoming. Same-quarter tier upgrades
      // (e.g. STRONG → BLOCKBUSTER for same Q4 FY26) should NOT archive —
      // we just replace in place. Distinct-quarter replacements (Q3 →
      // Q4, FY25 → FY26) DO archive so historical quarters survive.
      if (existing.quarter && existing.fiscal_year) {
        const sameQAsIncoming = (e as any).quarter && existing.quarter === (e as any).quarter;
        const sameFYAsIncoming = (e as any).fiscal_year && existing.fiscal_year === (e as any).fiscal_year;
        const distinctPeriod = !(sameQAsIncoming && sameFYAsIncoming);
        if (distinctPeriod) {
          const archiveKey = compositeKey(ticker, existing.quarter, existing.fiscal_year);
          if (!map[archiveKey]) {
            map[archiveKey] = { ...existing };
            count++;
          }
        }
      }
    }
    map[bareKey] = { ...(e as any), ticker, added_at: existing?.added_at || new Date().toISOString() };
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

/** Remove a single entry (user manually pruning).
 *  PATCH 0920 — supports both bare ticker and composite key "TICKER@Q-FY".
 *  If only the bare ticker is given, ALL composite keys for that ticker
 *  are also removed (so a single × click prunes the entire history). */
export function removeConviction(key: string) {
  const map = readConvictionBeats();
  const upper = key.toUpperCase();
  if (upper.includes('@')) {
    delete map[upper];
  } else {
    delete map[upper];
    // Also remove every composite key for this ticker
    for (const k of Object.keys(map)) {
      if (k.startsWith(upper + '@')) delete map[k];
    }
  }
  writeConvictionBeats(map);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
  }
}

/** Quick membership check — used for filtering Scan / Watchlist.
 *  PATCH 0920 — also returns true when ANY composite "TICKER@Q-FY"
 *  entry exists for this ticker (historical quarter archive). */
export function isConviction(ticker: string): boolean {
  const map = readConvictionBeats();
  const upper = ticker.toUpperCase();
  if (map[upper]) return true;
  for (const k of Object.keys(map)) {
    if (k.startsWith(upper + '@')) return true;
  }
  return false;
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
/** Get just the set of BARE tickers (for filter performance).
 *  PATCH 0920 — strips composite-key suffixes ("MTAR@Q3-2026" → "MTAR")
 *  so consumers (home chips, screener overlays, multibagger, etc.) still
 *  see exactly one entry per ticker regardless of how many quarter-history
 *  archives we hold. The bench tab itself uses getConvictionList()
 *  which returns the full per-quarter list. */
export function getConvictionTickers(): Set<string> {
  if (_cachedSet) return _cachedSet;
  const map = readConvictionBeats();
  const out = new Set<string>();
  for (const k of Object.keys(map)) {
    const at = k.indexOf('@');
    out.add(at >= 0 ? k.slice(0, at) : k);
  }
  _cachedSet = out;
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
