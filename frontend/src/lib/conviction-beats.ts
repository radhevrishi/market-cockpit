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
  // zzz230 — cumulative % close move from filing date to most recent close.
  // Server-computed in /api/v1/earnings/graded via priceMove (Yahoo daily bars).
  // Displayed on Conviction Beats cards as "Since filing +X%".
  move_pct?: number | null;
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
  // zzz242 — trailing P/E (from graded route / enrich Screener path) so
  // CB cards can render a valuation chip alongside OPM + YoY numbers.
  pe?: number | null;
  // zzz257 — institutional quality fields (Yahoo fundamentals / Screener).
  roce?: number | null;
  roe?: number | null;
  debtToEquity?: number | null;
  // zzz248 — 30-day close series for sparkline. Yahoo blocked on Railway
  // so this is often null; DriftPath component falls back gracefully.
  close_30d?: number[] | null;
  // zzz356 — Phase 2B backend enrichment. Quarterly history (last 4 Q),
  // annual EBITDA margin, working-capital YoY, 52W distance + volume
  // confirmation. All optional; null on pre-zzz356 bench entries.
  quarters_sales?: (number | null)[] | null;
  quarters_eps?: (number | null)[] | null;
  quarters_opm?: (number | null)[] | null;
  ebitda_margin_pct?: number | null;
  receivables_yoy_pct?: number | null;
  inventory_yoy_pct?: number | null;
  avg_vol_20d?: number | null;
  vol_ratio_20d?: number | null;
  dist_52w_pct_yahoo?: number | null;
  // zzz360 — Phase 2C P&L-quality + balance-sheet enrichment carried from
  // the enrich API. All optional; null on pre-zzz360 bench entries.
  other_income_pct_sales_curr?: number | null;   // zzz360
  other_income_pct_sales_prev?: number | null;   // zzz360
  effective_tax_rate_curr?: number | null;        // zzz360
  effective_tax_rate_prev?: number | null;        // zzz360
  dep_yoy_pct?: number | null;                     // zzz360
  finance_cost_curr_cr?: number | null;            // zzz360
  ebit_curr_cr?: number | null;                    // zzz360
  ebit_yoy_pct?: number | null;                    // zzz360
  ebitda_curr_cr?: number | null;                  // zzz360
  ebitda_yoy_pct?: number | null;                  // zzz360
  pat_margin_curr?: number | null;                 // zzz360
  pat_margin_prev?: number | null;                 // zzz360
  quarters_material_cost_pct?: number[] | null;    // zzz360
  quarters_other_income_pct?: number[] | null;     // zzz360
  quarters_tax_pct?: number[] | null;              // zzz360
  annual_cfo_pat?: number[] | null;                // zzz360
  pledged_pct?: number | null;                     // zzz360
  debtor_days?: number | null;                     // zzz360
  inventory_days?: number | null;                  // zzz360
  wc_days?: number | null;                         // zzz360
  roic?: number | null;                            // zzz360
  int_coverage?: number | null;                    // zzz360
  exceptional_curr_cr?: number | null;             // zzz363
  exceptional_pct_pbt?: number | null;             // zzz363 — signed % of PBT
  // zzz361 — version marker stamped when the full enrich field set is merged
  // onto the bench, so the one-time client re-enrich fires exactly once.
  cb_enrich_v?: number | null;                     // zzz361
  cb_trend_attempts?: number | null;               // zzz369 — bounded trend re-fetch counter
  _trends_status?: string | null;                  // zzz376 — 'ok' | 'no-table' | 'fetch-failed'
}

const LS_KEY = 'mc:conviction-beats:v1';
// zzz229 — recycle bin. Every delete path (demotion sync, manual x, Clear All)
// snapshots the removed entries here first, so a rule-change-driven mass prune
// (thin-float gate, stricter BLOCKBUSTER, re-validate) can be undone instead of
// silently draining the bench. Capped to the most recent 300 removals.
const BIN_KEY = 'mc:conviction-beats:bin:v1';
const BIN_CAP = 300;

export function readConvictionBin(): ConvictionEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BIN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function binPush(entries: ConvictionEntry[]) {
  if (typeof window === 'undefined' || entries.length === 0) return;
  try {
    const bin = readConvictionBin();
    const stamped = entries.map((e) => ({ ...e, removed_at: new Date().toISOString() } as any));
    const next = [...stamped, ...bin].slice(0, BIN_CAP);
    localStorage.setItem(BIN_KEY, JSON.stringify(next));
  } catch {}
}

/** zzz229 — Restore every binned entry that isn't already on the bench.
 *  Returns the number restored. Clears the bin afterwards. */
export function restoreConvictionBin(): number {
  const bin = readConvictionBin();
  if (bin.length === 0) return 0;
  const map = readConvictionBeats();
  let restored = 0;
  for (const e of bin) {
    if (!e || typeof (e as any).ticker !== 'string') continue;
    const t = (e as any).ticker.toUpperCase();
    const q = (e as any).quarter, fy = (e as any).fiscal_year;
    const bareTaken = map[t] != null;
    const key = bareTaken && q && fy ? `${t}@${q}-${fy}` : t;
    if (map[key]) continue;
    const { removed_at, ...rest } = e as any;
    map[key] = { ...rest, ticker: t };
    restored++;
  }
  writeConvictionBeats(map);
  try { localStorage.removeItem(BIN_KEY); } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
  }
  return restored;
}

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
        binPush([existing]);  // zzz229 — recoverable
        delete map[bareKey];
        count++;
      }
      // Remove same-quarter composite entry for this ticker too.
      if (incQ && incFY) {
        const cKey = `${ticker}@${incQ}-${incFY}`;
        if (map[cKey]) { binPush([map[cKey]]); delete map[cKey]; count++; }
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
          // zzz428 — the three YoY growth fields drive the "Results Pending" badge
          // (all-null → badge). They were NEVER in this backfill list, so a lean
          // bench entry added with null YoY (server-bench merge) could never light
          // up even after a later enrich delivered the numbers: the card showed
          // "Results Pending" forever. Backfill them like every other optional field.
          fill('sales_yoy_pct' as any); fill('net_profit_yoy_pct' as any); fill('eps_yoy_pct' as any);
          fill('d1_pct'); fill('gap_pct'); fill('move_pct'); fill('d2_pct' as any);   // zzz230/231
          fill('pead_score'); fill('market_cap_cr'); fill('pe');  // zzz242
          fill('cfo_to_pat_ratio' as any);  // zzz306 — earnings quality (CFO/PAT ratio)
          // zzz257 — institutional-quality fields + 30d sparkline series.
          // Previously the sync payload carried them but this fill() list didn't,
          // so backfills silently dropped them and the ROCE/ROE row never rendered.
          fill('roce' as any); fill('roe' as any); fill('debtToEquity' as any);
          fill('close_30d' as any);
          // zzz356 — Phase 2B backend enrichment fields.
          fill('quarters_sales' as any); fill('quarters_eps' as any); fill('quarters_opm' as any);
          fill('ebitda_margin_pct' as any);
          fill('receivables_yoy_pct' as any); fill('inventory_yoy_pct' as any);
          fill('avg_vol_20d' as any); fill('vol_ratio_20d' as any); fill('dist_52w_pct_yahoo' as any);
          // zzz360 — Phase 2C P&L-quality + balance-sheet enrichment fields.
          fill('other_income_pct_sales_curr' as any); fill('other_income_pct_sales_prev' as any);
          fill('effective_tax_rate_curr' as any); fill('effective_tax_rate_prev' as any);
          fill('dep_yoy_pct' as any); fill('finance_cost_curr_cr' as any);
          fill('ebit_curr_cr' as any); fill('ebit_yoy_pct' as any);
          fill('ebitda_curr_cr' as any); fill('ebitda_yoy_pct' as any);
          fill('pat_margin_curr' as any); fill('pat_margin_prev' as any);
          fill('quarters_material_cost_pct' as any); fill('quarters_other_income_pct' as any); fill('quarters_tax_pct' as any);
          fill('annual_cfo_pat' as any); fill('pledged_pct' as any);
          fill('debtor_days' as any); fill('inventory_days' as any); fill('wc_days' as any);
          fill('roic' as any); fill('int_coverage' as any);
          fill('exceptional_curr_cr' as any); fill('exceptional_pct_pbt' as any);  // zzz363
          fill('cb_enrich_v' as any);  // zzz361 — stamp version marker so re-enrich fires once
          // zzz366 — the version marker + the fields a re-enrich EXISTS to refresh
          // must OVERWRITE, not null-fill. fill() only writes when cur is null, so an
          // entry already stamped at an older cb_enrich_v (e.g. 363) could never
          // advance to 366 — the re-enrich gate stayed permanently true (re-fetching
          // every load) and stale trend/pledge/one-off values could never refresh.
          // For these specific fields, take the incoming value whenever present.
          const forceRefresh = (k: keyof ConvictionEntry) => {
            if ((e as any)[k] != null && (e as any)[k] !== (cur as any)[k]) (patch as any)[k] = (e as any)[k];
          };
          forceRefresh('cb_enrich_v' as any);
          forceRefresh('quarters_material_cost_pct' as any); forceRefresh('quarters_other_income_pct' as any);
          forceRefresh('quarters_tax_pct' as any); forceRefresh('annual_cfo_pat' as any);
          forceRefresh('quarters_opm' as any); forceRefresh('quarters_sales' as any); forceRefresh('quarters_eps' as any); // zzz369
          forceRefresh('pledged_pct' as any);
          forceRefresh('exceptional_curr_cr' as any); forceRefresh('exceptional_pct_pbt' as any);
          forceRefresh('cb_trend_attempts' as any); // zzz369 — bounded retry counter must advance
          forceRefresh('_trends_status' as any); // zzz376 — reason for missing trends must update each pass
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
    // zzz372 — when the incoming record replaces an existing one for the SAME
    // filing (tier upgrade STRONG→BLOCKBUSTER) or a newer filing, carry over any
    // enrichment field the incoming record doesn't supply. Graded/EO payloads
    // never carry P/E, ROCE, drift, trend series or the cb_enrich_v marker, so a
    // plain overwrite blanked P/E + DRIFT on the card until the next re-enrich
    // walk (and left it blank for good if that walk's chunk timed out).
    // Price/drift fields are only carried for the SAME filing_date (a new
    // quarter's drift must be re-anchored, so those start null and re-enrich).
    let carried: Record<string, any> = {};
    if (existing) {
      const sameFiling = existing.filing_date === e.filing_date;
      const SLOW = ['roce', 'roe', 'debtToEquity', 'debt_to_equity', 'rs_rating', 'sector', 'market_cap_cr',
        'pledged_pct', 'roic', 'int_coverage', 'debtor_days', 'inventory_days', 'wc_days',
        'quarters_sales', 'quarters_eps', 'quarters_opm', 'quarters_material_cost_pct',
        'quarters_other_income_pct', 'quarters_tax_pct', 'annual_cfo_pat',
        'other_income_pct_sales_curr', 'other_income_pct_sales_prev',
        'effective_tax_rate_curr', 'effective_tax_rate_prev', 'exceptional_curr_cr', 'exceptional_pct_pbt',
        'ebitda_margin_pct', 'receivables_yoy_pct', 'inventory_yoy_pct', 'dep_yoy_pct',
        'finance_cost_curr_cr', 'ebit_curr_cr', 'ebit_yoy_pct', 'ebitda_curr_cr', 'ebitda_yoy_pct',
        'pat_margin_curr', 'pat_margin_prev', 'avg_vol_20d', 'vol_ratio_20d', 'dist_52w_pct_yahoo', 'cfo_to_pat_ratio', 'ocf_to_pat_ratio'];
      const PRICE = ['pe', 'move_pct', 'd2_pct', 'd1_pct', 'gap_pct', 'close_30d', 'opm_pct', 'opm_prev_pct', 'pead_score', 'cb_enrich_v', 'cb_trend_attempts', 'guidance', 'guidance_score'];
      const keys = sameFiling ? [...SLOW, ...PRICE] : SLOW;
      for (const k of keys) {
        if ((e as any)[k] == null && (existing as any)[k] != null) carried[k] = (existing as any)[k];
      }
    }
    const merged: any = { ...(e as any), ticker, added_at: existing?.added_at || new Date().toISOString() };
    for (const k of Object.keys(carried)) { if (merged[k] == null) merged[k] = carried[k]; }  // incoming explicit nulls don't beat carried values
    map[bareKey] = merged;
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
  const binned: ConvictionEntry[] = [];  // zzz229
  if (upper.includes('@')) {
    if (map[upper]) binned.push(map[upper]);
    delete map[upper];
  } else {
    if (map[upper]) binned.push(map[upper]);
    delete map[upper];
    // Also remove every composite key for this ticker
    for (const k of Object.keys(map)) {
      if (k.startsWith(upper + '@')) { binned.push(map[k]); delete map[k]; }
    }
  }
  binPush(binned);
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

/** zzz372 — OVERWRITE specific fields on existing bare-ticker entries.
 *  syncFromEarningsOps() deliberately null-fills (fill only when current is null)
 *  so a stale cached graded payload can never clobber fresher data. But the
 *  watchlists re-enrich walk fetches LIVE values (drift, P/E, CFO/PAT, ROCE) and
 *  those must replace what is on the bench — e.g. the zzz371 CFO/PAT alignment
 *  fix (KMEW 1.17 → 0.62) could never land through fill(). Only non-null incoming
 *  values are written; unknown tickers are ignored. One write + one event. */
export function patchConvictionEntries(patches: Array<Record<string, any> & { ticker: string }>): number {
  if (typeof window === 'undefined') return 0;
  const map = readConvictionBeats();
  let count = 0;
  for (const p of patches) {
    const key = String(p.ticker || '').toUpperCase();
    const cur = map[key];
    if (!cur) continue;
    let changed = false;
    for (const k of Object.keys(p)) {
      if (k === 'ticker') continue;
      const v = (p as any)[k];
      if (v == null) continue;
      if ((cur as any)[k] !== v) { (cur as any)[k] = v; changed = true; }
    }
    if (changed) { map[key] = { ...cur }; count++; }
  }
  if (count > 0) {
    writeConvictionBeats(map);
    window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
  }
  return count;
}

/** Clear all entries (rarely used — admin reset) */
export function clearConvictionBeats() {
  if (typeof window === 'undefined') return;
  try { binPush(Object.values(readConvictionBeats())); } catch {}  // zzz229
  try { localStorage.removeItem(LS_KEY); } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conviction-beats:updated'));
  }
}
