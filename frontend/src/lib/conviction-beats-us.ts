// ═══════════════════════════════════════════════════════════════════════════
// US CONVICTION BEATS — the US bench.
//
// A deliberate SIBLING of lib/conviction-beats.ts, not a fork of it, for two
// reasons that are not cosmetic:
//
//  1. KEY COLLISION. The India bench keys entries by bare TICKER. Ticker
//     symbols are not globally unique — MMM, ITC, TTM and dozens of others
//     exist on both NSE and a US exchange — so a US bench sharing that store
//     would silently overwrite India entries and vice versa. US lives in its
//     own localStorage namespace, `mc:conviction-beats-us:v1`.
//  2. DIFFERENT FIELD SET. The India entry carries ~50 Screener-specific
//     fields (pledged_pct, ₹Cr absolutes, promoter holding, debtor days). None
//     of those exist for a US filer, and half of them are meaningless here.
//     Cloning that type would leave a wide surface of permanently-null fields.
//
// WHAT IS COPIED EXACTLY, AND MUST STAY COPIED
// ─────────────────────────────────────────────
// The QUOTA-RESILIENT WRITE. localStorage is per-ORIGIN, so the US bench
// shares the same ~5 MB budget as the India bench and every `mc:graded:*`
// cache. The original India bug was a bare `try { setItem } catch {}` that
// swallowed QuotaExceededError — new graded names stopped saving with no
// error anywhere, and the bench simply appeared to stop updating. Adding a
// second bench to the same origin makes that failure MORE likely, not less.
// So `writeUsConviction` escalates on failure: evict regenerable graded
// caches (both markets') → prune to the freshest MAX_BENCH → prune harder.
// ═══════════════════════════════════════════════════════════════════════════

export type ConvictionTier = 'BLOCKBUSTER' | 'STRONG';

export interface UsConvictionEntry {
  ticker: string;
  company: string;
  tier: ConvictionTier;
  composite_score: number;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  filing_date: string;              // YYYY-MM-DD
  period_end?: string | null;
  quarter?: string | null;          // "Q2 CY26"
  fiscal_year?: number | null;
  sector?: string | null;
  form?: string | null;

  market_cap_musd?: number | null;
  market_cap_bucket?: string | null;
  price?: number | null;
  pe?: number | null;

  revenue_curr_musd?: number | null;
  revenue_prev_musd?: number | null;
  net_income_curr_musd?: number | null;
  eps_curr?: number | null;
  eps_prev?: number | null;
  cfo_curr_musd?: number | null;

  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  cfo_to_pat_ratio?: number | null;

  d1_pct?: number | null;
  gap_pct?: number | null;
  move_pct?: number | null;
  rs_rating?: number | null;
  stage?: number | null;
  pct_from_52w_high?: number | null;
  addv_musd?: number | null;
  vol_ratio_20d?: number | null;

  quarters_revenue?: number[] | null;
  quarters_eps?: number[] | null;
  quarters_opm?: number[] | null;
  close_30d?: number[] | null;

  is_elite?: boolean;
  pead_score?: number | null;
  multibagger_setup?: boolean;
  is_financial?: boolean;
  /** Graded on street-basis EPS + consensus + reaction before the 10-Q posted;
   *  flips false (and revenue/margins/cash fill in) when the full grade lands. */
  prelim?: boolean;
  eps_estimate?: number | null;
  eps_adj?: number | null;
  eps_surprise_pct?: number | null;
  eps_basis?: string | null;
  guidance?: 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'PROVIDED' | 'WITHDRAWN' | null;
  guidance_score?: number | null;
  guidance_snippets?: string[] | null;
  guidance_url?: string | null;
  caveat_tags?: string[];
  methodology_tags?: string[];
  narrative?: string;

  added_at: string;
  source_url?: string;
}

const LS_KEY = 'mc:conviction-beats-us:v1';
const BIN_KEY = 'mc:conviction-beats-us:bin:v1';
const BIN_CAP = 200;
const MAX_BENCH = 420;

/** Drop regenerable per-date graded caches — BOTH markets, since the quota is
 *  shared across the whole origin and either market's stale cache is safe to
 *  reclaim (they rebuild on demand). */
function evictStaleGradedCaches(olderThanDays = 30): number {
  if (typeof window === 'undefined') return 0;
  let freed = 0;
  const cutoff = Date.now() - olderThanDays * 86400000;
  try {
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const m = k.match(/^mc:graded(?:-us)?:v\d+:(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;
      const t = Date.parse(m[1] + 'T00:00:00Z');
      if (Number.isFinite(t) && t < cutoff) kill.push(k);
    }
    for (const k of kill) {
      const v = localStorage.getItem(k);
      if (v) freed += v.length;
      localStorage.removeItem(k);
    }
  } catch { /* storage unavailable — nothing to reclaim */ }
  return freed;
}

function pruneBench(map: Record<string, UsConvictionEntry>, keep = MAX_BENCH): Record<string, UsConvictionEntry> {
  const keys = Object.keys(map);
  if (keys.length <= keep) return map;
  keys.sort((a, b) => String(map[b]?.filing_date || '').localeCompare(String(map[a]?.filing_date || '')));
  const out: Record<string, UsConvictionEntry> = {};
  for (const k of keys.slice(0, keep)) out[k] = map[k];
  return out;
}

export function readUsConviction(): Record<string, UsConvictionEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch { return {}; }
}

/** Persist the bench. Quota-resilient — see the header note; do not simplify
 *  this back into a bare try/catch. */
function writeUsConviction(map: Record<string, UsConvictionEntry>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); return; } catch { /* full */ }
  try { evictStaleGradedCaches(30); localStorage.setItem(LS_KEY, JSON.stringify(map)); return; } catch { /* still full */ }
  try { localStorage.setItem(LS_KEY, JSON.stringify(pruneBench(map, MAX_BENCH))); return; } catch { /* still full */ }
  try {
    evictStaleGradedCaches(0);
    localStorage.setItem(LS_KEY, JSON.stringify(pruneBench(map, Math.floor(MAX_BENCH * 0.75))));
  } catch { /* give up: the caller's data is unchanged on disk, never corrupted */ }
}

export function readUsConvictionBin(): UsConvictionEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BIN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function binPush(entries: UsConvictionEntry[]) {
  if (typeof window === 'undefined' || !entries.length) return;
  try {
    const stamped = entries.map((e) => ({ ...e, removed_at: new Date().toISOString() } as any));
    localStorage.setItem(BIN_KEY, JSON.stringify([...stamped, ...readUsConvictionBin()].slice(0, BIN_CAP)));
  } catch { /* the bin is a convenience, never load-bearing */ }
}

/** Restore everything in the recycle bin that isn't already benched. */
export function restoreUsConvictionBin(): number {
  const bin = readUsConvictionBin();
  if (!bin.length) return 0;
  const map = readUsConviction();
  let restored = 0;
  for (const e of bin) {
    const t = String((e as any)?.ticker || '').toUpperCase();
    if (!t) continue;
    const q = (e as any).quarter, fy = (e as any).fiscal_year;
    const key = map[t] && q && fy ? `${t}@${q}-${fy}` : t;
    if (map[key]) continue;
    const { removed_at, ...rest } = e as any;
    map[key] = { ...rest, ticker: t };
    restored++;
  }
  writeUsConviction(map);
  try { localStorage.removeItem(BIN_KEY); } catch {}
  emit();
  return restored;
}

function emit() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conviction-beats-us:updated'));
  }
}

const compositeKey = (ticker: string, q?: string | null, fy?: number | null) =>
  (!q || !fy) ? ticker.toUpperCase() : `${ticker.toUpperCase()}@${q}-${fy}`;

type UsSyncEntry = Omit<UsConvictionEntry, 'added_at' | 'tier'> & {
  tier: 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
};

/**
 * Batch upsert from a graded-us payload.
 *
 * Mirrors the India semantics that were arrived at the hard way:
 *  • MIXED / AVOID are DEMOTION signals — a newer filing that drops out of the
 *    top two tiers REMOVES the bench entry (recoverably, via the bin) rather
 *    than leaving a stale BLOCKBUSTER card sitting there.
 *  • An older filing for a DIFFERENT quarter is archived under a composite key
 *    `TICKER@Q-FY` so browsing back through history accretes quarters instead
 *    of overwriting the newest one.
 *  • Same-filing re-syncs BACKFILL newly-added fields onto existing entries;
 *    without that, an entry stored before a field existed could never pick it
 *    up, because the same-filing path skips the overwrite branch.
 */
export function syncUsConviction(entries: UsSyncEntry[]): number {
  if (typeof window === 'undefined') return 0;
  const map = readUsConviction();
  let count = 0;

  for (const e of entries) {
    const ticker = String(e.ticker || '').toUpperCase();
    if (!ticker) continue;
    const existing = map[ticker];

    if (e.tier === 'MIXED' || e.tier === 'AVOID') {
      if (existing && e.filing_date >= existing.filing_date) {
        binPush([existing]); delete map[ticker]; count++;
      }
      if (e.quarter && e.fiscal_year) {
        const cKey = `${ticker}@${e.quarter}-${e.fiscal_year}`;
        if (map[cKey]) { binPush([map[cKey]]); delete map[cKey]; count++; }
      }
      continue;
    }

    if (existing) {
      const newerDate = e.filing_date > existing.filing_date;
      const tierUpgrade = e.tier === 'BLOCKBUSTER' && existing.tier === 'STRONG';
      if (!newerDate && !tierUpgrade) {
        const samePeriod = e.quarter && existing.quarter && e.quarter === existing.quarter
          && e.fiscal_year && existing.fiscal_year && e.fiscal_year === existing.fiscal_year;
        if (e.quarter && e.fiscal_year && !samePeriod) {
          const cKey = compositeKey(ticker, e.quarter, e.fiscal_year);
          if (!map[cKey]) {
            map[cKey] = { ...(e as any), ticker, added_at: new Date().toISOString() };
            count++;
          }
          continue;
        }
        // Same filing — backfill any field the stored entry is missing.
        const cur = map[ticker];
        const patch: Record<string, any> = {};
        for (const k of Object.keys(e)) {
          if (k === 'ticker' || k === 'tier') continue;
          if ((cur as any)[k] == null && (e as any)[k] != null) patch[k] = (e as any)[k];
        }
        // Price-derived fields must REFRESH, not merely fill — they move daily.
        for (const k of ['price', 'move_pct', 'pead_score', 'rs_rating', 'stage', 'pct_from_52w_high', 'pe', 'market_cap_musd', 'close_30d',
          // a PRELIM entry must be fully overwritten by the GAAP grade of the same filing
          'prelim', 'tier', 'composite_score', 'sales_yoy_pct', 'net_profit_yoy_pct', 'eps_yoy_pct', 'eps_curr', 'eps_prev', 'eps_basis',
          'opm_pct', 'opm_prev_pct', 'cfo_to_pat_ratio', 'caveat_tags', 'methodology_tags', 'narrative', 'quarters_revenue', 'quarters_eps', 'quarters_opm',
          'guidance', 'guidance_score', 'guidance_snippets', 'guidance_url', 'eps_adj', 'eps_estimate', 'eps_surprise_pct',
          // the quarter LABEL can change without the quarter changing: an entry
          // benched before we read fiscal labels off the release says "Q3 CY26"
          // where the filer says "Q2 FY27". Same filing, better name.
          'quarter', 'revenue_curr_musd', 'revenue_prev_musd', 'net_income_curr_musd', 'net_income_prev_musd', 'prelim_matched', 'release_url']) {
          if ((e as any)[k] != null && (e as any)[k] !== (cur as any)[k]) patch[k] = (e as any)[k];
        }
        if (Object.keys(patch).length) { map[ticker] = { ...cur, ...patch }; count++; }
        continue;
      }
      // Newer filing (or a tier upgrade): archive the outgoing quarter first.
      if (existing.quarter && existing.fiscal_year) {
        const samePeriod = e.quarter === existing.quarter && e.fiscal_year === existing.fiscal_year;
        if (!samePeriod) {
          const aKey = compositeKey(ticker, existing.quarter, existing.fiscal_year);
          if (!map[aKey]) { map[aKey] = { ...existing }; count++; }
        }
      }
    }

    map[ticker] = { ...(e as any), ticker, added_at: existing?.added_at || new Date().toISOString() };
    count++;
  }

  if (count > 0) { writeUsConviction(map); emit(); }
  return count;
}

export function removeUsConviction(key: string) {
  const map = readUsConviction();
  const upper = String(key || '').toUpperCase();
  const binned: UsConvictionEntry[] = [];
  if (upper.includes('@')) {
    if (map[upper]) binned.push(map[upper]);
    delete map[upper];
  } else {
    if (map[upper]) binned.push(map[upper]);
    delete map[upper];
    for (const k of Object.keys(map)) {
      if (k.startsWith(upper + '@')) { binned.push(map[k]); delete map[k]; }
    }
  }
  binPush(binned);
  writeUsConviction(map);
  emit();
}

export function clearUsConviction() {
  if (typeof window === 'undefined') return;
  try { binPush(Object.values(readUsConviction())); } catch {}
  try { localStorage.removeItem(LS_KEY); } catch {}
  emit();
}

/** Newest filing first, BLOCKBUSTER ahead of STRONG on the same date. */
export function getUsConvictionList(): UsConvictionEntry[] {
  const map = readUsConviction();
  return Object.values(map).sort((a, b) => {
    if (a.filing_date !== b.filing_date) return b.filing_date.localeCompare(a.filing_date);
    if (a.tier !== b.tier) return a.tier === 'BLOCKBUSTER' ? -1 : 1;
    return (b.composite_score ?? 0) - (a.composite_score ?? 0);
  });
}

let _cachedSet: Set<string> | null = null;
if (typeof window !== 'undefined') {
  const invalidate = () => { _cachedSet = null; };
  window.addEventListener('conviction-beats-us:updated', invalidate);
  window.addEventListener('storage', (e) => { if (e.key === LS_KEY) invalidate(); });
}

export function getUsConvictionTickers(): Set<string> {
  if (_cachedSet) return _cachedSet;
  const out = new Set<string>();
  for (const k of Object.keys(readUsConviction())) {
    const at = k.indexOf('@');
    out.add(at >= 0 ? k.slice(0, at) : k);
  }
  _cachedSet = out;
  return out;
}

// ─── freshness ─────────────────────────────────────────────────────────────
// ONE formula for both the "·Nd" badge and the NEW filter. The India engine
// shipped two different ones (floor+UTC-midnight vs round+market-open) and a
// name could badge "31d" while still passing a 30-day filter. Anchored to the
// US market open (09:30 ET) and rounded, so what you SEE is what gets filtered.
export function usFilingAgeDays(fd?: string | null): number | null {
  if (!fd) return null;
  const s = String(fd).slice(0, 10);
  // -04:00 = EDT. The one-hour error during the winter months cannot change a
  // rounded day count except for a filing timestamped within an hour of the
  // boundary, which no filter cares about.
  const ms = Date.parse(s + 'T09:30:00-04:00');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 86400000));
}

/**
 * ADAPTIVE "NEW" window. Target 10 days, but US earnings season is bursty —
 * for weeks between seasons nothing files inside 10 days and a hard filter
 * renders a blank page. So: if 10d is empty, widen to the smallest step that
 * captures the freshest cohort and report that it widened, so the chip can
 * say "10d→21d" instead of lying. Returned, never module-level mutable state
 * (the India version is a module `let`, which two panels would race on).
 */
export interface NewWindow { days: number; widened: boolean; count: number }
export function computeUsNewWindow(list: ReadonlyArray<{ filing_date?: string | null }>): NewWindow {
  const BASE = 10;
  const STEPS = [10, 14, 21, 30, 45, 60, 90];
  const ages: number[] = [];
  for (const e of list) {
    const a = usFilingAgeDays(e?.filing_date);
    if (a !== null && a >= 0) ages.push(a);
  }
  const countLE = (w: number) => ages.reduce((n, a) => (a <= w ? n + 1 : n), 0);
  const base = countLE(BASE);
  if (base > 0) return { days: BASE, widened: false, count: base };
  for (const w of STEPS) {
    const c = countLE(w);
    if (c > 0) return { days: w, widened: w > BASE, count: c };
  }
  return { days: BASE, widened: false, count: 0 };
}

// ─── the US Quality Preset ─────────────────────────────────────────────────
// Rishi's India preset, ported with two deliberate changes:
//   • NO promoter-pledge gate — the concept does not exist in US markets.
//   • Market-cap floor is $300M, not ₹3,000 Cr — which is the same bar, since
//     ₹3,000 Cr ≈ $360M, and $300M is the conventional US small-cap floor.
//     Keeping it low is deliberate: the point of this bench is small/mid-cap
//     names, and a higher floor would have cut PRO DEX ($235M) and TWIN DISC
//     ($347M) out of the first live run. Tradeability is enforced separately
//     and better by the $2M/day dollar-volume gate in the grader.
// Everything else is identical: Sales ≥20 · EPS ≥25 · PEAD ≥60 · OPM Δ ≥0 ·
// CFO/PAT ≥0.5 (skipped for financials) · verdict ∈ {STRONG BUY, BUY, WATCH}.
export const US_PRESET = {
  sales: 20,
  eps: 25,
  pead: 60,
  opmDelta: 0,
  cfoPatMin: 0.5,
  mktCapMinMusd: 300,
  verdicts: ['STRONG BUY', 'BUY', 'WATCH'] as string[],
};

export type UsVerdict = 'STRONG BUY' | 'BUY' | 'WATCH' | 'AVOID';

/**
 * Verdict + a 0-100 quality read for one bench entry. Same shape as the India
 * bench's verdict chip so the two pages read identically.
 */
export function usVerdict(e: UsConvictionEntry): { score: number; verdictLabel: UsVerdict; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;
  const s = e.sales_yoy_pct, p = e.net_profit_yoy_pct, ep = e.eps_yoy_pct;
  if (s != null) { score += s >= 40 ? 12 : s >= 25 ? 9 : s >= 15 ? 5 : s >= 5 ? 1 : -8; if (s >= 25) reasons.push(`revenue +${Math.round(s)}%`); }
  if (p != null) { score += p >= 50 ? 12 : p >= 25 ? 8 : p >= 10 ? 4 : p >= 0 ? 0 : -10; }
  if (ep != null) { score += ep >= 50 ? 10 : ep >= 25 ? 7 : ep >= 10 ? 3 : ep >= 0 ? 0 : -8; if (ep >= 25) reasons.push(`EPS +${Math.round(ep)}%`); }
  const od = (e.opm_pct != null && e.opm_prev_pct != null) ? e.opm_pct - e.opm_prev_pct : null;
  if (od != null) { score += od >= 3 ? 10 : od >= 1 ? 6 : od >= 0 ? 2 : od >= -1.5 ? -5 : -12; if (od >= 1) reasons.push(`margins +${od.toFixed(1)}pp`); }
  const c = e.cfo_to_pat_ratio;
  if (!e.is_financial && c != null) { score += c >= 1 ? 8 : c >= 0.7 ? 4 : c >= 0.5 ? 0 : -12; if (c < 0.5) reasons.push('earnings not cash-backed'); }
  if (e.tier === 'BLOCKBUSTER') score += 6;
  if (e.guidance === 'RAISED') { score += 8; reasons.push('guidance raised'); }
  else if (e.guidance === 'LOWERED' || e.guidance === 'WITHDRAWN') { score -= 12; reasons.push('guidance cut'); }
  if (e.eps_surprise_pct != null) { score += e.eps_surprise_pct >= 10 ? 5 : e.eps_surprise_pct >= 0 ? 2 : e.eps_surprise_pct <= -10 ? -8 : -3; }
  if (e.pead_score != null) score += e.pead_score >= 75 ? 6 : e.pead_score >= 60 ? 3 : e.pead_score >= 40 ? 0 : -4;
  if (e.stage === 4) { score -= 12; reasons.push('stage 4 downtrend'); }
  if ((e.caveat_tags || []).includes('ocf divergence')) reasons.push('CFO/PAT divergence');
  if ((e.caveat_tags || []).includes('optical eps')) reasons.push('optical EPS');
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdictLabel: UsVerdict = score >= 78 ? 'STRONG BUY' : score >= 65 ? 'BUY' : score >= 50 ? 'WATCH' : 'AVOID';
  return { score, verdictLabel, reasons };
}

export interface UsConvFilters {
  sales: number | null;
  eps: number | null;
  pat: number | null;
  pead: number | null;
  opmDelta: number | null;
  opmMin: number | null;
  cfoPatMin: number | null;
  mktCapMin: number | null;      // $M
  peMax: number | null;
  score: number | null;
  cap: string | null;            // 'all' | 'smid' | bucket
  tiers: string[] | null;
  verdicts: string[] | null;
  elite: boolean;
  multibagger: boolean;
  newOnly: boolean;
  sector: string | null;
  q: string;                     // free-text ticker/company search
}

export const US_FILTER_DEFAULT: UsConvFilters = {
  sales: null, eps: null, pat: null, pead: null, opmDelta: null, opmMin: null,
  cfoPatMin: null, mktCapMin: null, peMax: null, score: null, cap: 'all',
  tiers: null, verdicts: null, elite: false, multibagger: false, newOnly: false,
  sector: null, q: '',
};

export function usPresetFilters(): UsConvFilters {
  return {
    ...US_FILTER_DEFAULT,
    sales: US_PRESET.sales, eps: US_PRESET.eps, pead: US_PRESET.pead,
    opmDelta: US_PRESET.opmDelta, cfoPatMin: US_PRESET.cfoPatMin,
    mktCapMin: US_PRESET.mktCapMinMusd, verdicts: [...US_PRESET.verdicts],
  };
}

export function isUsPresetActive(f: UsConvFilters): boolean {
  return f.sales === US_PRESET.sales && f.eps === US_PRESET.eps && f.pead === US_PRESET.pead
    && f.opmDelta === US_PRESET.opmDelta && f.cfoPatMin === US_PRESET.cfoPatMin
    && f.mktCapMin === US_PRESET.mktCapMinMusd
    && JSON.stringify((f.verdicts || []).slice().sort()) === JSON.stringify(['BUY', 'STRONG BUY', 'WATCH']);
}

function capMatch(musd: number | null | undefined, filter: string | null | undefined): boolean {
  if (!filter || filter === 'all') return true;
  if (musd == null || !Number.isFinite(musd)) return false;
  const b = musd >= 200_000 ? 'mega' : musd >= 10_000 ? 'large' : musd >= 2_000 ? 'mid' : musd >= 300 ? 'small' : 'micro';
  if (filter === 'smid') return b === 'small' || b === 'mid';
  return b === filter;
}

export function passesUsConvictionFilter(e: UsConvictionEntry, f: UsConvFilters, win?: NewWindow): boolean {
  if (f.newOnly) {
    const d = usFilingAgeDays(e.filing_date);
    const w = win?.days ?? 10;
    return d !== null && d >= 0 && d <= w;
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!`${e.ticker} ${e.company}`.toLowerCase().includes(q)) return false;
  }
  const sales = e.sales_yoy_pct ?? 0;
  const pat = e.net_profit_yoy_pct ?? 0;
  const eps = e.eps_yoy_pct ?? 0;
  if (f.sales != null && sales < f.sales) return false;
  if (f.pat != null && pat < f.pat) return false;
  if (f.eps != null && eps < f.eps) return false;
  if (f.score != null && (e.composite_score ?? 0) < f.score) return false;
  if (f.opmMin != null) {
    if (e.opm_pct == null || e.opm_pct < f.opmMin) return false;
  }
  if (f.opmDelta != null) {
    if (e.opm_pct == null || e.opm_prev_pct == null) return false;
    const d = e.opm_pct - e.opm_prev_pct;
    if (f.opmDelta >= 0 ? d < f.opmDelta : d > f.opmDelta) return false;
  }
  if (f.cfoPatMin != null && !e.is_financial) {
    // A null ratio PASSES (a data gap is not evidence of poor quality) —
    // identical to the India rule.
    if (e.cfo_to_pat_ratio != null && e.cfo_to_pat_ratio < f.cfoPatMin) return false;
  }
  if (f.mktCapMin != null) {
    if (e.market_cap_musd == null || e.market_cap_musd < f.mktCapMin) return false;
  }
  if (f.peMax != null) {
    if (e.pe == null || e.pe <= 0 || e.pe > f.peMax) return false;
  }
  if (f.pead != null && (e.pead_score ?? 0) < f.pead) return false;
  if (f.elite && !e.is_elite) return false;
  if (f.multibagger && !e.multibagger_setup) return false;
  if (f.cap && !capMatch(e.market_cap_musd, f.cap)) return false;
  if (f.sector && (e.sector || '') !== f.sector) return false;
  if (f.tiers && f.tiers.length && !f.tiers.includes(e.tier)) return false;
  if (f.verdicts && f.verdicts.length) {
    if (!f.verdicts.includes(usVerdict(e).verdictLabel)) return false;
  }
  return true;
}
