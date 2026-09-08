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
//
// THE FIELD-MAPPING RULE (added with schema v2)
// ─────────────────────────────────────────────
// Cards used to differ from each other for no visible reason. The cause was
// two different write paths with two different field lists: the Opportunities
// page hand-picked ~40 fields at add time, while this page's sweep spread the
// whole graded row at refresh time. A name that only ever came through one
// path carried a different set of fields from a name that came through the
// other, and the card rendered whatever happened to be there.
//
// So there is now exactly ONE mapping — `usBenchFields()` — and every write
// path goes through it. A field that is not in that function is not on the
// bench, and a field that IS in it is written by every path. When a new field
// is added it goes in one place and every card gets it on the next sweep.
// ═══════════════════════════════════════════════════════════════════════════

import { rule40From, roceFrom, type SwingKind } from '@/lib/us-earnings-core';
import type { EarningsQuadrant } from '@/lib/earnings-grade-shared';

export type ConvictionTier = 'BLOCKBUSTER' | 'STRONG';

// ─── shapes carried straight through from the graded-us payload ────────────
// Declared structurally (not imported) on purpose: these are the wire contract
// documented in lib/us-expand-contract.md, and the bench must keep parsing an
// entry saved months ago even if the producing module's types move.

export interface UsSeries {
  ends: string[];
  revenue: (number | null)[];
  gross_profit: (number | null)[];
  operating_income: (number | null)[];
  net_income: (number | null)[];
  eps: (number | null)[];
  cfo: (number | null)[];
  fcf: (number | null)[];
}

export interface UsContext {
  cash_musd: number | null;
  cash_incl_st_inv: boolean;
  debt_musd: number | null;
  sbc_musd: number | null;
  buyback_musd: number | null;
  dividends_musd: number | null;
  diluted_shares_m: number | null;
  diluted_shares_yoy_pct: number | null;
  as_of: string | null;
  /** The two halves of capital employed. Present only for a filer that presents
   *  a CLASSIFIED balance sheet — a bank's "current liabilities" are its
   *  deposits, and ROCE off that arithmetic is not a return on capital by any
   *  definition, so those filers tag neither and get no ROCE. */
  total_assets_musd?: number | null;
  current_liabilities_musd?: number | null;
}

/** Rule of 40 as the owner defines it: revenue YoY growth % + FCF margin %.
 *  Computed by `rule40From` in us-earnings-core; carried verbatim. */
export interface UsRule40 {
  score: number | null;
  growth_pct: number | null;
  fcf_margin_pct: number | null;
  basis: 'ttm' | 'quarter';
  passes: boolean | null;
}

/** EBIT (TTM) ÷ capital employed. `unavailable` says WHY it is null. */
export interface UsRoce {
  pct: number | null;
  ebit_ttm_musd: number | null;
  capital_employed_musd: number | null;
  basis: 'ttm' | null;
  unavailable?: string;
}

/** The post-earnings setup score (`assignSetupScores`) — what surrounds the
 *  beat. Cohort-relative, so it is computed server-side and never re-derived
 *  here: the bench is not the cohort the name reported with. */
export interface UsSetup {
  score: number | null;
  verdict: string | null;
  factors_scored: number;
  factors_total: number;
  factors: Array<{ id: string; label: string; score: number | null; input: string; unavailable?: string | null }>;
}

/** What a tile's figure was measured against — the company's own guide, or the
 *  street's estimate. `verdict` is three-state: a guided range that BRACKETS
 *  the estimate is 'in-line', never 'below'. */
export interface UsTileRef {
  low: number | null; high: number | null; unit: string;
  basis: 'gaap' | 'adjusted' | null;
  source: 'guide' | 'estimate';
  verdict: 'above' | 'below' | 'in-line' | null;
  actual: number | null;
}

export interface UsGuidedItem {
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period: 'quarter' | 'year';
  guide_low: number | null;
  guide_high: number | null;
  guide_mid: number | null;
  unit: string;
  actual: number | null;
  guided_on: string;
  guided_for_label: string | null;
  source_url: string | null;
  compare: {
    verdict: 'beat' | 'missed' | 'in-line' | null;
    delta_pct: number | null;
    delta_abs: number | null;
    text: string | null;
  } | null;
}

export interface UsVsGuide {
  prior_filing_date: string | null;
  prior_filing_url: string | null;
  for_quarter: UsGuidedItem[];
  for_year: UsGuidedItem[];
}

export interface UsGuideChange {
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period_label: string | null;
  prev_low: number | null; prev_high: number | null;
  new_low: number | null; new_high: number | null;
  direction: 'raised' | 'lowered' | 'reiterated' | 'narrowed' | 'widened';
  delta_pct: number | null;
  unit: string;
}

export interface UsKeyMetric {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  yoy_pct: number | null;
  source?: string | null;
}

export interface UsGuidanceFigure {
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period: 'quarter' | 'year';
  period_label: string | null;
  low: number | null;
  high: number | null;
  unit: string;
  prior_low?: number | null;
  prior_high?: number | null;
  raised?: boolean | null;
  est?: number | null;         // the street's number for that same period
  source?: string | null;
}

// ─── the thesis anchor ─────────────────────────────────────────────────────
/**
 * WHY the name was benched, frozen at the moment it was benched.
 *
 * A conviction bench is about what happened AFTER the beat, which is a
 * statement you cannot make without knowing what the beat looked like. Every
 * later quarter is compared against this, so it is captured once and carried
 * across quarter rollovers untouched.
 *
 * `reconstructed` marks an anchor rebuilt by the schema-v2 migration from a
 * record saved before anchors existed. It is the entry's own numbers, so it is
 * honest, but it is the CURRENT quarter's numbers, not the ones that earned
 * the name its place — the card says so rather than implying a comparison it
 * cannot make.
 */
export interface UsBenchAnchor {
  filing_date: string;
  quarter: string | null;
  tier: ConvictionTier;
  composite_score: number;
  verdict: UsVerdict;
  sales_yoy_pct: number | null;
  eps_growth_pct: number | null;
  eps_basis: 'gaap' | 'adjusted' | null;
  eps_swing: SwingKind;
  opm_delta_pp: number | null;
  cfo_to_pat_ratio: number | null;
  guidance: string | null;
  price: number | null;
  captured_at: string;
  reconstructed?: boolean;
}

/** One observed quarter's verdict against the company's OWN prior guide. */
export interface UsGuideBeatRecord {
  period_end: string;
  quarter: string | null;
  filing_date: string;
  verdict: 'beat' | 'missed' | 'in-line' | null;
  metric: string | null;
  basis: 'gaap' | 'adjusted' | null;
  text: string | null;
  /** 'mixed' where the revision raised some lines and cut others — see
   *  `usGuideChangeSummary`. */
  guide_direction: UsGuideChange['direction'] | 'mixed' | null;
}

export const US_BENCH_SCHEMA_V = 2;
const BEAT_HISTORY_CAP = 12;

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
  quarter?: string | null;          // "Q2 CY26" / "Q3 FY27"
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
  net_income_prev_musd?: number | null;
  eps_curr?: number | null;
  eps_prev?: number | null;
  cfo_curr_musd?: number | null;
  fcf_curr_musd?: number | null;
  fcf_prev_musd?: number | null;
  fcf_yoy_pct?: number | null;

  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  cfo_to_pat_ratio?: number | null;

  d1_pct?: number | null;
  gap_pct?: number | null;
  move_pct?: number | null;
  reaction_date?: string | null;
  rs_rating?: number | null;
  stage?: number | null;
  pct_from_52w_high?: number | null;
  addv_musd?: number | null;
  vol_ratio_20d?: number | null;

  /** Legacy 4-quarter arrays with no dates. `series` supersedes them; both are
   *  kept because entries benched before `series` existed only have these. */
  quarters_revenue?: number[] | null;
  quarters_eps?: number[] | null;
  quarters_opm?: number[] | null;
  close_30d?: number[] | null;

  is_elite?: boolean;
  pead_score?: number | null;
  multibagger_setup?: boolean;
  /** The second axis — what the business IS (quality) against what it is
   *  BECOMING (inflection), and the quadrant they define. Carried verbatim from
   *  the graded payload; null on an entry benched before the axis existed, and
   *  a null is a genuine absence that no filter treats as a pass. */
  quality_score?: number | null;
  inflection_score?: number | null;
  quadrant?: EarningsQuadrant | null;
  quadrant_parts?: {
    quality: Array<{ label: string; points: number; of: number }>;
    inflection: Array<{ label: string; points: number; of: number }>;
  } | null;
  is_financial?: boolean;
  /** Graded on street-basis EPS + consensus + reaction before the 10-Q posted;
   *  flips false (and revenue/margins/cash fill in) when the full grade lands. */
  prelim?: boolean;
  prelim_matched?: string[] | null;
  release_url?: string | null;

  eps_estimate?: number | null;
  /** Set by the engine when the consensus on file is not on the same basis as
   *  the EPS beside it (a GAAP-basis estimate against an adjusted actual, or
   *  the reverse). While it is set, no factor here may subtract one from the
   *  other — see `epsEstimateBasisConflict` in lib/us-pr-adjusted.ts. */
  eps_basis_note?: string | null;
  eps_adj?: number | null;
  eps_adj_curr?: number | null;
  eps_adj_prev?: number | null;
  eps_adj_yoy_pct?: number | null;
  eps_adj_swing?: SwingKind;
  eps_surprise_pct?: number | null;
  /** Which basis the GRADE's growth axis used. The old `eps_basis` field was
   *  only ever set on PRELIM rows, which is why the street line appeared on
   *  some cards and not others; both are read, this one is written. */
  eps_basis_used?: 'gaap' | 'adjusted' | null;
  /** GAAP EPS growth only — `eps_yoy_pct` silently falls back to the adjusted
   *  basis when GAAP has a loss base, so a tile labelled GAAP reads this. */
  eps_gaap_yoy_pct?: number | null;
  eps_swing?: SwingKind;
  net_income_swing?: SwingKind;
  fcf_swing?: SwingKind;

  guidance?: 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'PROVIDED' | 'WITHDRAWN' | null;
  guidance_score?: number | null;
  guidance_snippets?: string[] | null;
  guidance_url?: string | null;
  guidance_figures?: UsGuidanceFigure[] | null;
  key_metrics?: UsKeyMetric[] | null;

  series?: UsSeries | null;
  context?: UsContext | null;
  vs_guide?: UsVsGuide | null;
  guide_change?: UsGuideChange[] | null;
  rule40?: UsRule40 | null;
  roce?: UsRoce | null;
  setup?: UsSetup | null;
  tile_refs?: Record<string, UsTileRef> | null;
  /** Which XBRL concept each number was read from. */
  tags_used?: Record<string, string | null> | null;

  /** Listing venue as SEC's `company_tickers_exchange.json` states it ("NYSE",
   *  "Nasdaq", "NYSE American", "Cboe"). Never guessed from the ticker — see
   *  `tvSymbol` in lib/us-tradingview.ts for how it becomes a TradingView
   *  prefix, and what happens when it is genuinely unknown. */
  exchange?: string | null;

  caveat_tags?: string[];
  methodology_tags?: string[];
  narrative?: string;

  /** Thesis tracking — see UsBenchAnchor. */
  anchor?: UsBenchAnchor | null;
  beat_history?: UsGuideBeatRecord[] | null;

  schema_v?: number;
  added_at: string;
  source_url?: string;

  /** DERIVED at read time, never persisted: the localStorage map key this
   *  entry lives under. An archived quarter shares its ticker with the live
   *  entry, so `ticker` alone cannot address a row — removing by ticker used
   *  to delete the whole history from one × click. */
  bench_key?: string;
}

const LS_KEY = 'mc:conviction-beats-us:v1';
const BIN_KEY = 'mc:conviction-beats-us:bin:v1';
const BIN_CAP = 200;
const MAX_BENCH = 420;

// ─── tiny guards used everywhere ───────────────────────────────────────────
export const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const str = (v: unknown): string | null =>
  (typeof v === 'string' && v.length > 0) ? v : null;
const arr = <T,>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null);
/** A plain object, or null. Arrays are refused: every caller below wants a
 *  record, and an array reaching one of those slots is a payload change we
 *  would rather drop than half-render. */
const obj = <T,>(v: unknown): T | null =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? (v as T) : null;
const numArr = (v: unknown): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return out.length ? out : null;
};

export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Percentage change, refused when the base is zero or negative.
 *
 * Mirrors `yoyPct` in us-earnings-core so the bench can never print a growth
 * rate the grader itself declined to compute. Callers pair it with a swing
 * descriptor and print words instead of a number.
 */
export function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ONE FIELD MAPPING
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Map a graded-us row (or an older bench record) onto the bench field set.
 *
 * Every write path calls this. Whatever a caller hands in — the Opportunities
 * page's hand-picked object, this page's whole-row spread, a record read back
 * from an older schema — comes out with exactly the same keys, so two cards
 * can only differ where the DATA differs.
 *
 * Fields absent from the input come out `null`, never `undefined`: an explicit
 * null is a value the backfill can recognise as missing, whereas `undefined`
 * disappears through JSON.stringify and leaves the key unset.
 */
export function usBenchFields(rawIn: Record<string, any>): Record<string, any> {
  const r = rawIn || {};
  // The graded row names some fields differently from the older bench records.
  // Read both, write the canonical one.
  const epsBasis = str(r.eps_basis_used) ?? str(r.eps_basis);
  const adjCurr = num(r.eps_adj_curr) ?? num(r.eps_adj);
  return {
    ticker: String(r.ticker || '').toUpperCase(),
    company: str(r.company) ?? String(r.ticker || '').toUpperCase(),
    tier: r.tier,
    composite_score: num(r.composite_score) ?? 0,

    sales_yoy_pct: num(r.sales_yoy_pct),
    net_profit_yoy_pct: num(r.net_profit_yoy_pct),
    eps_yoy_pct: num(r.eps_yoy_pct),
    eps_gaap_yoy_pct: num(r.eps_gaap_yoy_pct),

    filing_date: String(r.filing_date || '').slice(0, 10),
    period_end: str(r.period_end),
    quarter: str(r.quarter),
    fiscal_year: num(r.fiscal_year),
    sector: str(r.sector),
    form: str(r.form),

    market_cap_musd: num(r.market_cap_musd),
    market_cap_bucket: str(r.market_cap_bucket),
    price: num(r.price),
    pe: num(r.pe),

    revenue_curr_musd: num(r.revenue_curr_musd),
    revenue_prev_musd: num(r.revenue_prev_musd),
    net_income_curr_musd: num(r.net_income_curr_musd),
    net_income_prev_musd: num(r.net_income_prev_musd),
    eps_curr: num(r.eps_curr),
    eps_prev: num(r.eps_prev),
    cfo_curr_musd: num(r.cfo_curr_musd),
    fcf_curr_musd: num(r.fcf_curr_musd),
    fcf_prev_musd: num(r.fcf_prev_musd),
    fcf_yoy_pct: num(r.fcf_yoy_pct),

    opm_pct: num(r.opm_pct),
    opm_prev_pct: num(r.opm_prev_pct),
    cfo_to_pat_ratio: num(r.cfo_to_pat_ratio),

    d1_pct: num(r.d1_pct),
    gap_pct: num(r.gap_pct),
    move_pct: num(r.move_pct),
    reaction_date: str(r.reaction_date),
    rs_rating: num(r.rs_rating),
    stage: num(r.stage),
    pct_from_52w_high: num(r.pct_from_52w_high),
    addv_musd: num(r.addv_musd),
    vol_ratio_20d: num(r.vol_ratio_20d),

    quarters_revenue: numArr(r.quarters_revenue),
    quarters_eps: numArr(r.quarters_eps),
    quarters_opm: numArr(r.quarters_opm),
    close_30d: numArr(r.close_30d),

    is_elite: r.is_elite === true,
    pead_score: num(r.pead_score),
    multibagger_setup: r.multibagger_setup === true,
    // Carried verbatim, never recomputed on write: the quadrant is finalised by
    // the graded-us route once ROCE is known, and a bench-side re-derivation off
    // a truncated series would disagree with the same name on the other tab.
    quality_score: num(r.quality_score),
    inflection_score: num(r.inflection_score),
    quadrant: (typeof r.quadrant === 'string' ? r.quadrant : null) as EarningsQuadrant | null,
    quadrant_parts: obj<UsConvictionEntry['quadrant_parts']>(r.quadrant_parts) ?? null,
    is_financial: r.is_financial === true,
    prelim: r.prelim === true,
    prelim_matched: arr<string>(r.prelim_matched),
    release_url: str(r.release_url),

    eps_estimate: num(r.eps_estimate),
    eps_basis_note: typeof r.eps_basis_note === 'string' ? r.eps_basis_note : null,
    eps_adj: adjCurr,
    eps_adj_curr: adjCurr,
    eps_adj_prev: num(r.eps_adj_prev),
    eps_adj_yoy_pct: num(r.eps_adj_yoy_pct),
    eps_adj_swing: (r.eps_adj_swing ?? null) as SwingKind,
    eps_surprise_pct: num(r.eps_surprise_pct),
    eps_basis_used: (epsBasis === 'gaap' || epsBasis === 'adjusted') ? epsBasis : null,
    eps_swing: (r.eps_swing ?? null) as SwingKind,
    net_income_swing: (r.net_income_swing ?? null) as SwingKind,
    fcf_swing: (r.fcf_swing ?? null) as SwingKind,

    guidance: str(r.guidance) as UsConvictionEntry['guidance'],
    guidance_score: num(r.guidance_score),
    guidance_snippets: arr<string>(r.guidance_snippets),
    guidance_url: str(r.guidance_url),
    guidance_figures: arr<UsGuidanceFigure>(r.guidance_figures),
    key_metrics: arr<UsKeyMetric>(r.key_metrics),

    series: normSeries(r.series),
    context: (r.context && typeof r.context === 'object') ? (r.context as UsContext) : null,
    vs_guide: normVsGuide(r.vs_guide),
    guide_change: arr<UsGuideChange>(r.guide_change),
    // Carried verbatim from the payload. Never recomputed on write: the engine
    // that produced them had the whole cohort and the full companyfacts set,
    // and a bench-side re-derivation off a truncated series would silently
    // disagree with the same name on the Opportunities tab.
    rule40: obj<UsRule40>(r.rule40),
    roce: obj<UsRoce>(r.roce),
    setup: obj<UsSetup>(r.setup),
    tile_refs: obj<Record<string, UsTileRef>>(r.tile_refs),
    tags_used: obj<Record<string, string | null>>(r.tags_used),
    exchange: str(r.exchange),

    caveat_tags: arr<string>(r.caveat_tags) ?? [],
    methodology_tags: arr<string>(r.methodology_tags) ?? [],
    narrative: str(r.narrative) ?? '',
    source_url: str(r.source_url) ?? str(r.filing_url),
  };
}

/** Only accept a series that is actually usable — a non-empty date spine. */
export function normSeries(s: unknown): UsSeries | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const ends = Array.isArray(o.ends) ? o.ends.filter((x): x is string => typeof x === 'string') : [];
  if (!ends.length) return null;
  const line = (k: string): (number | null)[] =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).map((x) => num(x)) : ends.map(() => null);
  return {
    ends,
    revenue: line('revenue'),
    gross_profit: line('gross_profit'),
    operating_income: line('operating_income'),
    net_income: line('net_income'),
    eps: line('eps'),
    cfo: line('cfo'),
    fcf: line('fcf'),
  };
}

function normVsGuide(v: unknown): UsVsGuide | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const fq = arr<UsGuidedItem>(o.for_quarter) ?? [];
  const fy = arr<UsGuidedItem>(o.for_year) ?? [];
  if (!fq.length && !fy.length) return null;
  return {
    prior_filing_date: str(o.prior_filing_date),
    prior_filing_url: str(o.prior_filing_url),
    for_quarter: fq,
    for_year: fy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════════════════

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

/**
 * Migrate one stored record forward.
 *
 * Additive only: unknown keys survive untouched, and nothing the owner saved
 * is ever dropped. A pre-v2 record gains (a) the canonical field names, so a
 * card reads the same key regardless of which write path created it, and
 * (b) a RECONSTRUCTED thesis anchor — the entry's own current numbers, marked
 * as reconstructed so the card never claims to compare against a quarter it
 * never saw.
 */
function migrateEntry(raw: any): UsConvictionEntry {
  if (!raw || typeof raw !== 'object') return raw;
  if (num(raw.schema_v) === US_BENCH_SCHEMA_V) return raw as UsConvictionEntry;
  const mapped = usBenchFields(raw);
  const merged: any = { ...raw };
  // Only write mapped values that ADD something — a migration must not blank a
  // field the old record had under a name the mapper does not know about.
  for (const k of Object.keys(mapped)) {
    if (mapped[k] == null) continue;
    if (Array.isArray(mapped[k]) && mapped[k].length === 0 && Array.isArray(merged[k])) continue;
    merged[k] = mapped[k];
  }
  merged.tier = raw.tier;
  merged.added_at = str(raw.added_at) ?? new Date().toISOString();
  if (!merged.anchor) merged.anchor = { ...anchorFrom(merged as UsConvictionEntry), reconstructed: true };
  if (!Array.isArray(merged.beat_history)) merged.beat_history = [];
  merged.schema_v = US_BENCH_SCHEMA_V;
  return merged as UsConvictionEntry;
}

/** Read the raw map, migrating each record forward in memory. */
export function readUsConviction(): Record<string, UsConvictionEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const rawText = localStorage.getItem(LS_KEY);
    const o = rawText ? JSON.parse(rawText) : {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, UsConvictionEntry> = {};
    for (const k of Object.keys(o)) {
      const e = migrateEntry(o[k]);
      if (e && typeof e === 'object' && typeof e.ticker === 'string') out[k] = e;
    }
    return out;
  } catch { return {}; }
}

/**
 * Persist the migration once, so the cost is paid on one load rather than on
 * every read. Returns how many records were upgraded. Safe to call repeatedly.
 */
export function migrateUsBench(): number {
  if (typeof window === 'undefined') return 0;
  let stale = 0;
  try {
    const rawText = localStorage.getItem(LS_KEY);
    if (!rawText) return 0;
    const o = JSON.parse(rawText);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return 0;
    for (const k of Object.keys(o)) {
      if (num(o[k]?.schema_v) !== US_BENCH_SCHEMA_V) stale++;
    }
  } catch { return 0; }
  if (!stale) return 0;
  writeUsConviction(readUsConviction());
  emit();
  return stale;
}

/** Persist the bench. Quota-resilient — see the header note; do not simplify
 *  this back into a bare try/catch. */
function writeUsConviction(map: Record<string, UsConvictionEntry>) {
  if (typeof window === 'undefined') return;
  // `bench_key` is derived at read time; never let it round-trip to disk.
  const clean: Record<string, UsConvictionEntry> = {};
  for (const k of Object.keys(map)) {
    const { bench_key, ...rest } = map[k] as any;
    clean[k] = rest;
  }
  try { localStorage.setItem(LS_KEY, JSON.stringify(clean)); return; } catch { /* full */ }
  try { evictStaleGradedCaches(30); localStorage.setItem(LS_KEY, JSON.stringify(clean)); return; } catch { /* still full */ }
  try { localStorage.setItem(LS_KEY, JSON.stringify(pruneBench(clean, MAX_BENCH))); return; } catch { /* still full */ }
  try {
    evictStaleGradedCaches(0);
    localStorage.setItem(LS_KEY, JSON.stringify(pruneBench(clean, Math.floor(MAX_BENCH * 0.75))));
  } catch { /* give up: the caller's data is unchanged on disk, never corrupted */ }
}

export function readUsConvictionBin(): UsConvictionEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const rawText = localStorage.getItem(BIN_KEY);
    const a = rawText ? JSON.parse(rawText) : [];
    return Array.isArray(a) ? a : [];
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
    const { removed_at, bench_key, ...rest } = e as any;
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

type UsSyncEntry = Record<string, any> & {
  ticker: string;
  filing_date: string;
  tier: 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
};

/** The thesis anchor for an entry as it stands right now. */
function anchorFrom(e: UsConvictionEntry): UsBenchAnchor {
  const od = (num(e.opm_pct) != null && num(e.opm_prev_pct) != null)
    ? (e.opm_pct as number) - (e.opm_prev_pct as number) : null;
  return {
    filing_date: e.filing_date,
    quarter: e.quarter ?? null,
    tier: e.tier,
    composite_score: num(e.composite_score) ?? 0,
    verdict: usVerdict(e).verdictLabel,
    sales_yoy_pct: num(e.sales_yoy_pct),
    eps_growth_pct: num(e.eps_yoy_pct),
    eps_basis: e.eps_basis_used ?? null,
    eps_swing: e.eps_swing ?? null,
    opm_delta_pp: od,
    cfo_to_pat_ratio: num(e.cfo_to_pat_ratio),
    guidance: e.guidance ?? null,
    price: num(e.price),
    captured_at: new Date().toISOString(),
  };
}

/** The own-guide record for the quarter an entry currently holds. */
function beatRecordFrom(e: UsConvictionEntry): UsGuideBeatRecord | null {
  const og = usOwnGuideVerdict(e);
  const gc = usGuideChangeSummary(e);
  if (!og && !gc) return null;
  return {
    period_end: e.period_end || e.filing_date,
    quarter: e.quarter ?? null,
    filing_date: e.filing_date,
    verdict: og?.verdict ?? null,
    metric: og?.metric ?? null,
    basis: og?.basis ?? null,
    text: og?.text ?? null,
    guide_direction: gc?.direction ?? null,
  };
}

function pushBeatHistory(history: UsGuideBeatRecord[] | null | undefined, rec: UsGuideBeatRecord | null): UsGuideBeatRecord[] {
  const base = Array.isArray(history) ? history.slice() : [];
  if (!rec) return base.slice(0, BEAT_HISTORY_CAP);
  const i = base.findIndex((h) => h.period_end === rec.period_end);
  if (i >= 0) base[i] = rec; else base.unshift(rec);
  base.sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)));
  return base.slice(0, BEAT_HISTORY_CAP);
}

/**
 * Batch upsert from a graded-us payload.
 *
 *  • MIXED / AVOID are DEMOTION signals — a newer filing that drops out of the
 *    top two tiers REMOVES the bench entry (recoverably, via the bin) rather
 *    than leaving a stale BLOCKBUSTER card sitting there.
 *  • An older filing for a DIFFERENT quarter is archived under a composite key
 *    `TICKER@Q-FY` so browsing back through history accretes quarters instead
 *    of overwriting the newest one.
 *  • Same-filing re-syncs BACKFILL newly-added fields onto existing entries;
 *    without that, an entry stored before a field existed could never pick it
 *    up, because the same-filing path skips the overwrite branch.
 *  • The thesis anchor and the own-guide history survive every path: an anchor
 *    is captured once, on first bench, and carried across quarter rollovers.
 */
export function syncUsConviction(entries: UsSyncEntry[]): number {
  if (typeof window === 'undefined') return 0;
  const map = readUsConviction();
  let count = 0;

  for (const raw of entries) {
    const ticker = String(raw?.ticker || '').toUpperCase();
    if (!ticker) continue;
    const tier = raw.tier;
    const existing = map[ticker];

    if (tier === 'MIXED' || tier === 'AVOID') {
      const fd = String(raw.filing_date || '').slice(0, 10);
      if (existing && fd >= existing.filing_date) {
        binPush([existing]); delete map[ticker]; count++;
      }
      if (raw.quarter && raw.fiscal_year) {
        const cKey = `${ticker}@${raw.quarter}-${raw.fiscal_year}`;
        if (map[cKey]) { binPush([map[cKey]]); delete map[cKey]; count++; }
      }
      continue;
    }
    if (tier !== 'BLOCKBUSTER' && tier !== 'STRONG') continue;

    // ONE mapping for every path — see the header note.
    const e = usBenchFields(raw) as any;
    e.tier = tier;
    if (!e.filing_date) continue;

    if (existing) {
      const newerDate = e.filing_date > existing.filing_date;
      const tierUpgrade = tier === 'BLOCKBUSTER' && existing.tier === 'STRONG';
      if (!newerDate && !tierUpgrade) {
        const samePeriod = !!(e.quarter && existing.quarter && e.quarter === existing.quarter
          && e.fiscal_year && existing.fiscal_year && e.fiscal_year === existing.fiscal_year);
        if (e.quarter && e.fiscal_year && !samePeriod) {
          const cKey = compositeKey(ticker, e.quarter, e.fiscal_year);
          if (!map[cKey]) {
            const rec: any = { ...e, ticker, added_at: new Date().toISOString(), schema_v: US_BENCH_SCHEMA_V };
            rec.anchor = anchorFrom(rec);
            rec.beat_history = pushBeatHistory([], beatRecordFrom(rec));
            map[cKey] = rec;
            count++;
          }
          continue;
        }
        // Same filing. Two rules, and the split between them is the whole
        // reason cards used to drift apart:
        //   • BACKFILL — a field the stored record does not have. Anything the
        //     incoming row carries and the record lacks is written.
        //   • REFRESH — a field whose value legitimately changes for the SAME
        //     filing: prices and everything derived from them, and every grade
        //     output, because a PRELIM row is replaced by the GAAP grade of the
        //     same print. Refresh is the whole mapped field set minus the two
        //     things that must never be rewritten (identity and first-added).
        const cur = map[ticker] as any;
        const patch: Record<string, any> = {};
        for (const k of Object.keys(e)) {
          if (k === 'ticker' || k === 'added_at') continue;
          const inc = e[k];
          if (inc == null) continue;
          const now = cur[k];
          if (now == null) { patch[k] = inc; continue; }
          // Arrays and objects are compared by content so an unchanged sweep
          // does not report a change on every pass.
          if (typeof inc === 'object') {
            if (JSON.stringify(inc) !== JSON.stringify(now)) patch[k] = inc;
          } else if (inc !== now) {
            patch[k] = inc;
          }
        }
        if (cur.schema_v !== US_BENCH_SCHEMA_V) patch.schema_v = US_BENCH_SCHEMA_V;
        if (Object.keys(patch).length) {
          const next = { ...cur, ...patch };
          if (!next.anchor) next.anchor = anchorFrom(next);
          next.beat_history = pushBeatHistory(next.beat_history, beatRecordFrom(next));
          map[ticker] = next;
          count++;
        }
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

    const rec: any = { ...e, ticker, added_at: existing?.added_at || new Date().toISOString(), schema_v: US_BENCH_SCHEMA_V };
    // The anchor is WHY the name is on the bench — it survives every later
    // quarter. Only a name that was never benched before gets a fresh one.
    rec.anchor = existing?.anchor || anchorFrom(rec);
    rec.beat_history = pushBeatHistory(
      pushBeatHistory(existing?.beat_history, existing ? beatRecordFrom(existing) : null),
      beatRecordFrom(rec),
    );
    map[ticker] = rec;
    count++;
  }

  if (count > 0) { writeUsConviction(map); emit(); }
  return count;
}

/** Remove one entry. Pass the entry's `bench_key` — passing a bare ticker also
 *  removes every archived quarter for it, which is what the × on the live card
 *  means but NOT what the × on an archived card means. */
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

/** Newest filing first, BLOCKBUSTER ahead of STRONG on the same date.
 *  Every entry is stamped with the map key it lives under (`bench_key`). */
export function getUsConvictionList(): UsConvictionEntry[] {
  const map = readUsConviction();
  const out: UsConvictionEntry[] = [];
  for (const k of Object.keys(map)) out.push({ ...map[k], bench_key: k });
  return out.sort((a, b) => {
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

/** Fiscal quarter number out of whatever label the filer used ("Q3 FY27"). */
export function usQuarterNum(e: { quarter?: string | null }): 1 | 2 | 3 | 4 | null {
  const m = /Q\s?([1-4])/i.exec(String(e?.quarter || ''));
  return m ? (Number(m[1]) as 1 | 2 | 3 | 4) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// THESIS TRACKING — what happened AFTER the beat
// ═══════════════════════════════════════════════════════════════════════════

/** Sum of four consecutive values ending at `i`; null if any is missing. */
function ttmAt(a: (number | null)[], i: number): number | null {
  if (i < 3) return null;
  let s = 0;
  for (let k = i - 3; k <= i; k++) {
    const v = num(a[k]);
    if (v == null) return null;
    s += v;
  }
  return s;
}

export interface UsMarginTrend {
  metric: 'operating' | 'gross';
  basis: 'ttm' | 'yoy-quarter';
  now_pct: number;
  then_pct: number;
  delta_pp: number;
  quarters_used: number;
  series_pct: number[];      // per-quarter margin, oldest → newest, up to 8
  label: string;             // what the two numbers are, in words
}

/**
 * Margin SLOPE, not level — the framework's point.
 *
 * Computed from `series` so it is seasonality-free: with 8+ quarters it
 * compares the trailing-twelve-month margin against the TTM a year earlier;
 * with 5-7 it compares the latest quarter against the same quarter a year ago.
 * Anything shorter is refused. Always in pp, never %.
 */
export function usMarginTrend(e: UsConvictionEntry, which: 'operating' | 'gross' = 'operating'): UsMarginTrend | null {
  const s = e.series;
  if (!s || !s.ends?.length) return null;
  const line = which === 'operating' ? s.operating_income : s.gross_profit;
  const rev = s.revenue;
  const n = Math.min(s.ends.length, line.length, rev.length);
  if (n < 5) return null;

  const pctSeries: number[] = [];
  for (let i = Math.max(0, n - 8); i < n; i++) {
    const r = num(rev[i]), p = num(line[i]);
    if (r != null && r > 0 && p != null) pctSeries.push((p / r) * 100);
  }

  const last = n - 1;
  const ttmNow = ttmAt(line, last), ttmRevNow = ttmAt(rev, last);
  const ttmThen = last - 4 >= 3 ? ttmAt(line, last - 4) : null;
  const ttmRevThen = last - 4 >= 3 ? ttmAt(rev, last - 4) : null;
  if (ttmNow != null && ttmRevNow != null && ttmRevNow > 0 && ttmThen != null && ttmRevThen != null && ttmRevThen > 0) {
    const now = (ttmNow / ttmRevNow) * 100, then = (ttmThen / ttmRevThen) * 100;
    return {
      metric: which, basis: 'ttm', now_pct: now, then_pct: then, delta_pp: now - then,
      quarters_used: 8, series_pct: pctSeries,
      label: 'trailing-twelve-month margin vs the TTM a year earlier',
    };
  }
  const rNow = num(rev[last]), pNow = num(line[last]);
  const rThen = num(rev[last - 4]), pThen = num(line[last - 4]);
  if (rNow != null && rNow > 0 && pNow != null && rThen != null && rThen > 0 && pThen != null) {
    const now = (pNow / rNow) * 100, then = (pThen / rThen) * 100;
    return {
      metric: which, basis: 'yoy-quarter', now_pct: now, then_pct: then, delta_pp: now - then,
      quarters_used: 5, series_pct: pctSeries,
      label: 'this quarter vs the same quarter a year ago',
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE OF 40 AND ROCE, READ OFF A BENCH ENTRY
//
// Both are produced server-side by `rule40From` / `roceFrom` and stored on the
// entry. These two readers exist for ONE case: an entry benched before the
// payload carried those fields. Rather than leave such a name chip-less until
// its next sweep, the SAME two functions are re-run over the SAME two stored
// inputs (`series` and `context`) — identical code, identical arithmetic, so a
// derived figure and a stored one can never disagree.
//
// What is never done: substituting an adjacent input. No quarter's FCF standing
// in for a missing trailing year, no total liabilities standing in for current
// liabilities. When the inputs are not there the reader returns null and the
// card shows no chip at all — which is the correct rendering of "the filing
// does not say".
// ═══════════════════════════════════════════════════════════════════════════

/** The stored Rule of 40, or the same computation over the stored series. */
export function usRule40(e: UsConvictionEntry): UsRule40 | null {
  const stored = e.rule40;
  if (stored && num(stored.score) != null) return stored;
  const s = e.series;
  if (!s) return null;
  const r = rule40From(s as any, num(e.sales_yoy_pct), num(e.revenue_curr_musd), num(e.fcf_curr_musd));
  return num(r.score) == null ? null : (r as UsRule40);
}

/** The stored ROCE, or the same computation over the stored series + context. */
export function usRoce(e: UsConvictionEntry): UsRoce | null {
  const stored = e.roce;
  if (stored && num(stored.pct) != null) return stored;
  const s = e.series, c = e.context;
  if (!s || !c) return null;
  const r = roceFrom(s as any, c as any);
  return num(r.pct) == null ? null : (r as UsRoce);
}

export interface UsCashTrend {
  metric: 'cfo' | 'fcf';
  ttm_now_musd: number;
  ttm_prev_musd: number;
  delta_pct: number | null;    // null when the prior TTM was zero or negative
  swing: SwingKind;
  label: string;
}

/** TTM cash-flow improvement out of `series`. Refuses a percentage off a
 *  non-positive base and names the swing instead. */
export function usCashTrend(e: UsConvictionEntry, which: 'cfo' | 'fcf' = 'cfo'): UsCashTrend | null {
  const s = e.series;
  if (!s || !s.ends?.length) return null;
  const line = which === 'cfo' ? s.cfo : s.fcf;
  const last = Math.min(s.ends.length, line.length) - 1;
  if (last < 7) return null;
  const now = ttmAt(line, last), prev = ttmAt(line, last - 4);
  if (now == null || prev == null) return null;
  const delta = pctChange(now, prev);
  let swing: SwingKind = null;
  if (delta == null) {
    if (prev <= 0 && now > 0) swing = 'loss-to-profit';
    else if (prev <= 0 && now <= 0) swing = Math.abs(now) < Math.abs(prev) ? 'loss-narrowed' : 'loss-widened';
  } else if (now <= 0 && prev > 0) swing = 'profit-to-loss';
  return {
    metric: which, ttm_now_musd: now, ttm_prev_musd: prev, delta_pct: delta, swing,
    label: 'trailing-twelve-month, vs the TTM a year earlier',
  };
}

export interface UsOwnGuideVerdict {
  verdict: 'beat' | 'missed' | 'in-line' | null;
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  text: string | null;
  guided_for: string | null;
  guided_on: string | null;
  source_url: string | null;
}

/** How the quarter landed against the company's OWN guide from last quarter.
 *  Revenue first (least adjustable), then EPS. Never blends bases. */
export function usOwnGuideVerdict(e: UsConvictionEntry): UsOwnGuideVerdict | null {
  const items = e.vs_guide?.for_quarter;
  if (!Array.isArray(items) || !items.length) return null;
  const usable = items.filter((g) => g && g.compare && g.compare.verdict);
  if (!usable.length) return null;
  const pick = usable.find((g) => g.metric === 'revenue')
    ?? usable.find((g) => g.metric === 'eps' && g.basis === 'adjusted')
    ?? usable.find((g) => g.metric === 'eps')
    ?? usable[0];
  return {
    verdict: pick.compare?.verdict ?? null,
    metric: pick.metric,
    basis: pick.basis ?? null,
    text: pick.compare?.text ?? null,
    guided_for: pick.guided_for_label ?? null,
    guided_on: pick.guided_on ?? null,
    source_url: pick.source_url ?? null,
  };
}

export interface UsGuideChangeSummary {
  /** 'mixed' is a verdict in its own right, not a tie to be broken — see
   *  `usGuideChangeSummary`. */
  direction: UsGuideChange['direction'] | 'mixed';
  raised: number; lowered: number; other: number;
  period_label: string | null;
  text: string;
}

/** How the FY outlook moved versus last quarter's, summarised across metrics. */
export function usGuideChangeSummary(e: UsConvictionEntry): UsGuideChangeSummary | null {
  const list = Array.isArray(e.guide_change) ? e.guide_change.filter(Boolean) : [];
  if (!list.length) return null;
  let raised = 0, lowered = 0, other = 0;
  for (const g of list) {
    if (g.direction === 'raised') raised++;
    else if (g.direction === 'lowered') lowered++;
    else other++;
  }
  // A REVISION THAT WENT BOTH WAYS IS NOT A VOTE TO BE WON.
  //
  // This used to be `raised > lowered ? 'raised' : …`, which turns SentinelOne's
  // Q2 FY27 revision — FY27 revenue and operating income up, FY27 adjusted EPS
  // cut 11.4% — into an unqualified "FY27 outlook raised" on the bench card,
  // while the graded card's own guidance block called the same revision mixed.
  // Same rule as `ownGuideVerdict` in lib/us-guide-verdict.ts, which the card's
  // chip and guidance block both read.
  const direction: UsGuideChangeSummary['direction'] =
    raised && lowered ? 'mixed'
      : raised ? 'raised' : lowered ? 'lowered' : (list[0]?.direction ?? 'reiterated');
  // On a mixed revision, name ONE line from each side. Naming the two biggest
  // movers of the same sign would describe half the revision and read as a
  // one-way move again.
  const picked = direction === 'mixed'
    ? [list.find((g) => g.direction === 'raised'), list.find((g) => g.direction === 'lowered')]
      .filter((g): g is UsGuideChange => !!g)
    : list.filter((g) => g.direction === direction).slice(0, 2);
  const named = picked
    .map((g) => {
      const basis = g.basis ? ` (${g.basis === 'gaap' ? 'GAAP' : 'adjusted'})` : '';
      const d = num(g.delta_pct);
      const delta = d == null ? '' : ` ${d >= 0 ? '+' : ''}${d.toFixed(1)}% at the midpoint`;
      return `${g.metric.replace(/_/g, ' ')}${basis}${delta}`;
    });
  const period = list.find((g) => g.period_label)?.period_label ?? null;
  return {
    direction, raised, lowered, other, period_label: period,
    text: `${period ? period + ' ' : ''}outlook ${direction}${named.length ? ' — ' + named.join(', ') : ''}`,
  };
}

export interface UsGuideStreak {
  beats: number; misses: number; inline: number; observed: number;
  streak: number;                     // consecutive most-recent beats
  quarters: UsGuideBeatRecord[];
}

/** Has it kept beating its own guide, quarter after quarter? Only quarters the
 *  bench has actually observed are counted — never inferred. */
export function usGuideStreak(e: UsConvictionEntry): UsGuideStreak | null {
  const hist = pushBeatHistory(e.beat_history, beatRecordFrom(e));
  const scored = hist.filter((h) => h.verdict);
  if (!scored.length) return null;
  let beats = 0, misses = 0, inline = 0, streak = 0, streakOpen = true;
  for (const h of scored) {
    if (h.verdict === 'beat') { beats++; if (streakOpen) streak++; }
    else { streakOpen = false; if (h.verdict === 'missed') misses++; else inline++; }
  }
  return { beats, misses, inline, observed: scored.length, streak, quarters: scored };
}

export interface UsShareCount {
  diluted_shares_m: number | null;
  yoy_pct: number | null;
  buyback_musd: number | null;
  dividends_musd: number | null;
  shrinking: boolean | null;
  as_of: string | null;
}

/** Is the share count shrinking? Straight off `context`, never derived. */
export function usShareCount(e: UsConvictionEntry): UsShareCount | null {
  const c = e.context;
  if (!c) return null;
  const y = num(c.diluted_shares_yoy_pct);
  const anything = y != null || num(c.diluted_shares_m) != null || num(c.buyback_musd) != null;
  if (!anything) return null;
  return {
    diluted_shares_m: num(c.diluted_shares_m),
    yoy_pct: y,
    buyback_musd: num(c.buyback_musd),
    dividends_musd: num(c.dividends_musd),
    shrinking: y == null ? null : y < 0,
    as_of: str(c.as_of),
  };
}

export interface UsSincePrint {
  gap_pct: number | null;
  d1_pct: number | null;
  move_pct: number | null;
  days: number | null;
  state: 'DRIFTING' | 'FADING' | 'HOLDING' | 'RUNNING' | null;
  reaction_date: string | null;
}

/** Performance since the print — the sell half of the PEAD workflow. */
export function usSincePrint(e: UsConvictionEntry): UsSincePrint {
  const m = num(e.move_pct);
  const state: UsSincePrint['state'] = m == null ? null
    : m <= -12 ? 'DRIFTING' : m <= -5 ? 'FADING' : m >= 8 ? 'RUNNING' : 'HOLDING';
  return {
    gap_pct: num(e.gap_pct), d1_pct: num(e.d1_pct), move_pct: m,
    days: usFilingAgeDays(e.filing_date), state, reaction_date: str(e.reaction_date),
  };
}

export type UsThesisState = 'CONFIRMED' | 'INTACT' | 'WEAKENED' | 'BROKEN' | 'SAME-QUARTER' | 'NO-ANCHOR';
export interface UsThesisCheck {
  state: UsThesisState;
  kept: string[];
  lost: string[];
  anchor: UsBenchAnchor | null;
  note: string;
}

/**
 * Did the latest quarter confirm or break the reason the name was benched?
 *
 * Compared against the anchor captured when the name first joined the bench.
 * Only tests where BOTH sides exist are run — a missing field is never scored
 * as a failure, it is simply not one of the tests.
 */
export function usThesisCheck(e: UsConvictionEntry): UsThesisCheck {
  const a = e.anchor ?? null;
  if (!a) return { state: 'NO-ANCHOR', kept: [], lost: [], anchor: null, note: 'No add-time snapshot stored for this name.' };
  if (a.reconstructed && a.filing_date === e.filing_date) {
    return {
      state: 'SAME-QUARTER', kept: [], lost: [], anchor: a,
      note: 'Snapshot rebuilt from this record when the bench schema was upgraded, so it describes this same quarter — the first new quarter will give it something to compare against.',
    };
  }
  if (a.filing_date === e.filing_date) {
    return {
      state: 'SAME-QUARTER', kept: [], lost: [], anchor: a,
      note: 'Still the quarter this name was benched on — nothing to confirm or break yet.',
    };
  }
  const kept: string[] = [], lost: string[] = [];
  const nowRev = num(e.sales_yoy_pct), wasRev = num(a.sales_yoy_pct);
  if (nowRev != null && wasRev != null) {
    if (nowRev >= 0 && nowRev >= wasRev * 0.6) kept.push(`revenue growth held (${wasRev.toFixed(0)}% → ${nowRev.toFixed(0)}%)`);
    else lost.push(`revenue growth faded (${wasRev.toFixed(0)}% → ${nowRev.toFixed(0)}%)`);
  }
  const nowOd = (num(e.opm_pct) != null && num(e.opm_prev_pct) != null) ? (e.opm_pct as number) - (e.opm_prev_pct as number) : null;
  if (nowOd != null && a.opm_delta_pp != null) {
    if (nowOd >= 0) kept.push(`margins still expanding (${nowOd >= 0 ? '+' : ''}${nowOd.toFixed(1)}pp YoY)`);
    else lost.push(`margins turned down (${nowOd.toFixed(1)}pp YoY, was ${a.opm_delta_pp >= 0 ? '+' : ''}${a.opm_delta_pp.toFixed(1)}pp)`);
  }
  if (e.guidance && a.guidance) {
    if (e.guidance === 'LOWERED' || e.guidance === 'WITHDRAWN') lost.push(`guidance ${e.guidance.toLowerCase()} (was ${a.guidance.toLowerCase()})`);
    else kept.push(`guidance ${e.guidance.toLowerCase()}`);
  }
  const nowV = usVerdict(e).verdictLabel;
  if (nowV === 'AVOID' && a.verdict !== 'AVOID') lost.push(`verdict fell to AVOID (was ${a.verdict})`);
  else if (nowV !== 'AVOID') kept.push(`verdict still ${nowV}`);
  if (e.tier === 'STRONG' && a.tier === 'BLOCKBUSTER') lost.push('tier slipped from BLOCKBUSTER to STRONG');
  if (e.tier === 'BLOCKBUSTER' && a.tier === 'STRONG') kept.push('tier upgraded from STRONG to BLOCKBUSTER');

  const state: UsThesisState = (kept.length + lost.length) === 0 ? 'NO-ANCHOR'
    : lost.length === 0 ? 'CONFIRMED'
      : lost.length >= 3 || (lost.length >= 2 && kept.length <= 1) ? 'BROKEN'
        : kept.length > lost.length ? 'INTACT' : 'WEAKENED';
  const note = state === 'NO-ANCHOR'
    ? 'The stored snapshot and this quarter have no field in common to compare.'
    : `Against the ${a.quarter || a.filing_date} print this name was benched on.`;
  return { state, kept, lost, anchor: a, note };
}

// ═══════════════════════════════════════════════════════════════════════════
// COHORT — every "vs peers" number on this page is computed from the bench
// itself, so it is reproducible and never a number from somewhere unnamed.
// ═══════════════════════════════════════════════════════════════════════════

export interface UsCohort {
  peMedianAll: number | null;
  peCountAll: number;
  peBySector: Record<string, { median: number; n: number }>;
  driftBySector: Record<string, { median: number; n: number }>;
  countBySector: Record<string, number>;
}

export function usCohort(list: ReadonlyArray<UsConvictionEntry>): UsCohort {
  const pes: number[] = [];
  const bySecPe = new Map<string, number[]>();
  const bySecDrift = new Map<string, number[]>();
  const bySecN = new Map<string, number>();
  for (const e of list) {
    const sec = str(e.sector);
    if (sec) bySecN.set(sec, (bySecN.get(sec) || 0) + 1);
    const p = num(e.pe);
    if (p != null && p > 0) {
      pes.push(p);
      if (sec) bySecPe.set(sec, [...(bySecPe.get(sec) || []), p]);
    }
    const m = num(e.move_pct);
    if (m != null && sec) bySecDrift.set(sec, [...(bySecDrift.get(sec) || []), m]);
  }
  const peBySector: UsCohort['peBySector'] = {};
  for (const [k, v] of bySecPe) { const m = median(v); if (m != null) peBySector[k] = { median: m, n: v.length }; }
  const driftBySector: UsCohort['driftBySector'] = {};
  for (const [k, v] of bySecDrift) { const m = median(v); if (m != null) driftBySector[k] = { median: m, n: v.length }; }
  const countBySector: UsCohort['countBySector'] = {};
  for (const [k, v] of bySecN) countBySector[k] = v;
  return { peMedianAll: median(pes), peCountAll: pes.length, peBySector, driftBySector, countBySector };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE WINNERS-VS-LOSERS SCORECARD
//
// Rishi's framework, applied per name and shown with its inputs. Its central
// claim: great earnings only produce great returns when they meet a hungry
// institutional buyer — the market prices the GAP between the beat and what
// was expected. The ten separators below are its own, in its own order of
// stated importance; the weights follow that order and nothing else.
//
// TWO RULES MAKE THIS HONEST
//   1. Nothing is proxied. Institutional accumulation cannot be sourced from
//      free US data at this cadence, so it is shown UNAVAILABLE — not replaced
//      by volume, not replaced by RS, not quietly dropped from the denominator
//      without saying so.
//   2. The composite REFUSES to score when too few factors are available. A
//      number built from two of ten inputs looks exactly like a number built
//      from nine, and that is how a scorecard starts lying.
// ═══════════════════════════════════════════════════════════════════════════

export type FactorState = 'strong' | 'ok' | 'weak' | 'unavailable';

export interface WinnerFactor {
  id: string;
  rank: number;               // the framework's own order of importance
  label: string;
  weight: number;
  state: FactorState;
  score: number | null;       // 0-100, null when unavailable
  input: string;              // the literal figure(s) behind the score
  why: string;                // what the score means, in one line
}

export interface WinnersScorecard {
  factors: WinnerFactor[];
  available: number;
  total: number;
  composite: number | null;
  band: 'WINNER SETUP' | 'MIXED' | 'LOSER PATTERN' | null;
  losing: Array<{ label: string; detail: string }>;
  stacked: number;            // how many separators scored strong
  note: string;
}

/** Below this many available factors the composite refuses to score. */
export const WINNERS_MIN_FACTORS = 5;

const SCORE_BY_STATE: Record<Exclude<FactorState, 'unavailable'>, number> = { strong: 100, ok: 60, weak: 20 };

function factor(
  id: string, rank: number, label: string, weight: number,
  state: FactorState, input: string, why: string,
): WinnerFactor {
  return {
    id, rank, label, weight, state,
    score: state === 'unavailable' ? null : SCORE_BY_STATE[state],
    input, why,
  };
}

/**
 * Score one bench name against the framework.
 *
 * `cohort` is the bench itself — the valuation and sector-tailwind factors are
 * relative measures and are computed across the names actually on the bench,
 * so the comparison set is visible and reproducible rather than a number from
 * an unnamed universe.
 */
export function usWinnersScorecard(e: UsConvictionEntry, cohort: UsCohort): WinnersScorecard {
  const F: WinnerFactor[] = [];

  // 1 — EARNINGS SURPRISE VS EXPECTATIONS (the framework's first separator).
  {
    const s = num(e.eps_surprise_pct);
    // THE ESTIMATE IS UNUSABLE WHEN IT IS NOT ON THE ACTUAL'S BASIS. The
    // cents branch below subtracts the two directly, so leaving the estimate
    // in place here would have reinstated SentinelOne's fabricated
    // thirty-one-cent "beat" on the conviction scorecard after the card itself
    // stopped showing it. No consensus is the honest state, and this factor
    // already knows how to say so.
    const est = e.eps_basis_note ? null : num(e.eps_estimate);
    const act = num(e.eps_adj_curr) ?? num(e.eps_adj) ?? num(e.eps_curr);
    if (s == null && !(est != null && act != null)) {
      F.push(factor('surprise', 1, 'Earnings surprise vs consensus', 20, 'unavailable',
        e.eps_basis_note
          ? 'the consensus on file is not on the same basis as this quarter\u2019s EPS'
          : 'no published consensus estimate for this quarter',
        e.eps_basis_note
          ? 'A gap measured across two different bases is not a gap. The estimate is shown on the card with the reason; it is not scored here.'
          : 'Without a street number there is no gap to price. Not substituted with YoY growth — that is a different question.'));
    } else if (est != null && act != null && Math.abs(est) < 0.1) {
      // A percentage off a near-zero estimate is arithmetic noise — cents instead.
      const d = act - est;
      const state: FactorState = d >= 0.05 ? 'strong' : d >= 0 ? 'ok' : 'weak';
      F.push(factor('surprise', 1, 'Earnings surprise vs consensus', 20, state,
        `adj EPS $${act.toFixed(2)} vs est $${est.toFixed(2)} — ${d >= 0 ? 'beat' : 'missed'} by $${Math.abs(d).toFixed(2)}`,
        'Estimate is within a dime of zero, so the gap is stated in cents; a percentage there is arithmetic noise.'));
    } else {
      const v = s as number;
      const state: FactorState = v >= 10 ? 'strong' : v >= 2 ? 'ok' : 'weak';
      F.push(factor('surprise', 1, 'Earnings surprise vs consensus', 20, state,
        `${v >= 0 ? '+' : ''}${v.toFixed(1)}% vs street${est != null && act != null ? ` ($${act.toFixed(2)} vs $${est.toFixed(2)})` : ''}`,
        v >= 10 ? 'A double-digit surprise is the gap the framework says gets paid for.'
          : v >= 2 ? 'Beat, but a small one — a modest gap to consensus.'
            : 'At or below consensus: there is no positive gap for the market to price.'));
    }
  }

  // 2 — GUIDANCE UPGRADE / FORWARD COMMENTARY.
  {
    const gc = usGuideChangeSummary(e);
    if (gc) {
      // 'mixed' scores as 'ok', not 'strong': a revision that cut a line is not
      // a guidance upgrade, whatever the other lines did.
      const state: FactorState = gc.direction === 'raised' ? 'strong'
        : gc.direction === 'lowered' ? 'weak' : 'ok';
      F.push(factor('guide', 2, 'Guidance upgrade / forward commentary', 18, state,
        gc.text, 'Measured against the company\'s own prior outlook for the same period, not against an estimate.'));
    } else if (e.guidance) {
      const g = e.guidance;
      const state: FactorState = g === 'RAISED' ? 'strong'
        : (g === 'LOWERED' || g === 'WITHDRAWN') ? 'weak' : 'ok';
      F.push(factor('guide', 2, 'Guidance upgrade / forward commentary', 18, state,
        `press release reads ${g.toLowerCase()}`,
        'No prior-quarter outlook on file to difference against, so this is the release\'s own label.'));
    } else {
      F.push(factor('guide', 2, 'Guidance upgrade / forward commentary', 18, 'unavailable',
        'the filer gave no outlook in this release',
        'Many small caps guide nothing at all. Silence is not a downgrade, so it is not scored as one.'));
    }
  }

  // 3 — INSTITUTIONAL ACCUMULATION. Deliberately not sourced.
  F.push(factor('institutional', 3, 'Institutional accumulation', 15, 'unavailable',
    'not sourceable from free US data',
    '13F holdings are quarterly and land 45 days late, which cannot show accumulation into this print. Volume and RS are NOT used as a stand-in — they are already factors 4 and 5.'));

  // 4 — BREAKOUT FROM A MULTI-MONTH BASE.
  {
    const st = num(e.stage), d52 = num(e.pct_from_52w_high), rs = num(e.rs_rating);
    if (st == null && d52 == null && rs == null) {
      F.push(factor('breakout', 4, 'Breakout from a multi-month base', 12, 'unavailable',
        'no price history for this name yet',
        'Stage, RS and the 52-week distance all come from the daily bars; none had loaded.'));
    } else {
      const bits: string[] = [];
      if (st != null) bits.push(`stage ${st}`);
      if (rs != null) bits.push(`RS ${rs.toFixed(0)}`);
      if (d52 != null) bits.push(`${d52.toFixed(1)}% from the 52-week high`);
      const near = d52 != null && d52 >= -8;
      const state: FactorState = st === 4 ? 'weak'
        : (st === 2 && near) || (st === 2 && rs != null && rs >= 80) ? 'strong'
          : st === 2 || near ? 'ok' : 'weak';
      F.push(factor('breakout', 4, 'Breakout from a multi-month base', 12, state,
        bits.join(' · '),
        st === 4 ? 'A stage-4 downtrend is the opposite of a base breakout.'
          : state === 'strong' ? 'Advancing stage and pressed against the high — the base is behind it.'
            : 'Neither clearly basing-out nor clearly broken down.'));
    }
  }

  // 5 — VOLUME EXPANSION.
  {
    const v = num(e.vol_ratio_20d);
    if (v == null) {
      F.push(factor('volume', 5, 'Volume expansion', 10, 'unavailable',
        'no 20-day volume ratio for this name', 'Needs 20 sessions of history to state a ratio.'));
    } else {
      const state: FactorState = v >= 1.5 ? 'strong' : v >= 1.05 ? 'ok' : 'weak';
      F.push(factor('volume', 5, 'Volume expansion', 10, state,
        `${v.toFixed(2)}× the 20-day average`,
        state === 'strong' ? 'Volume expanded sharply into the print — someone had to buy it.'
          : state === 'ok' ? 'Volume a shade above normal.'
            : 'Volume did not expand; the move had no participation behind it.'));
    }
  }

  // 6 — OPERATING CASH-FLOW IMPROVEMENT.
  {
    const trend = usCashTrend(e, 'cfo');
    const ratio = num(e.cfo_to_pat_ratio);
    if (e.is_financial) {
      F.push(factor('cash', 6, 'Operating cash-flow improvement', 10, 'unavailable',
        'lender / insurer — cash from operations is a funding artefact',
        'For a bank the cash-flow statement is dominated by deposit and lending flows, so CFO/NI says nothing about earnings quality.'));
    } else if (trend == null && ratio == null) {
      F.push(factor('cash', 6, 'Operating cash-flow improvement', 10, 'unavailable',
        'no cash-flow statement on this filing',
        'A preliminary print or a filer that tags no CFO line leaves nothing to read.'));
    } else if (trend != null) {
      const d = trend.delta_pct;
      const state: FactorState = trend.swing === 'loss-to-profit' ? 'strong'
        : trend.swing === 'profit-to-loss' || trend.swing === 'loss-widened' ? 'weak'
          : d == null ? 'ok' : d >= 15 ? 'strong' : d >= 0 ? 'ok' : 'weak';
      const change = d != null ? `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`
        : trend.swing ? (trend.swing === 'loss-to-profit' ? 'turned positive' : trend.swing.replace(/-/g, ' ')) : 'n/m';
      F.push(factor('cash', 6, 'Operating cash-flow improvement', 10, state,
        `TTM CFO $${trend.ttm_now_musd.toFixed(0)}M vs $${trend.ttm_prev_musd.toFixed(0)}M a year ago (${change})${ratio != null ? ` · CFO/NI ${ratio.toFixed(2)}×` : ''}`,
        'Trailing twelve months on both sides, so a seasonal quarter cannot flatter it.'));
    } else {
      const r = ratio as number;
      const state: FactorState = r >= 1 ? 'strong' : r >= 0.7 ? 'ok' : 'weak';
      F.push(factor('cash', 6, 'Operating cash-flow improvement', 10, state,
        `CFO/NI ${r.toFixed(2)}× this quarter`,
        'Only one quarter of cash flow is on file, so this is the conversion level, not the trend.'));
    }
  }

  // 7 — ORDER BOOK / FORWARD VISIBILITY.
  {
    const ms = (Array.isArray(e.key_metrics) ? e.key_metrics : [])
      .filter((m) => m && /rpo|backlog|arr|bookings|remaining_performance/i.test(`${m.id} ${m.label}`));
    const withGrowth = ms.filter((m) => num(m.yoy_pct) != null);
    if (!ms.length) {
      F.push(factor('visibility', 7, 'Order book / forward visibility', 6, 'unavailable',
        'the release names no backlog, RPO or ARR',
        'Only companies that disclose one have one to read; its absence is not a negative.'));
    } else if (!withGrowth.length) {
      const m = ms[0];
      F.push(factor('visibility', 7, 'Order book / forward visibility', 6, 'ok',
        `${m.label} disclosed, no growth rate given`,
        'A level with no prior-period figure cannot be turned into a trend.'));
    } else {
      const best = withGrowth.reduce((a, b) => ((num(b.yoy_pct) as number) > (num(a.yoy_pct) as number) ? b : a));
      const g = num(best.yoy_pct) as number;
      const state: FactorState = g >= 25 ? 'strong' : g >= 10 ? 'ok' : 'weak';
      F.push(factor('visibility', 7, 'Order book / forward visibility', 6, state,
        `${best.label} ${g >= 0 ? '+' : ''}${g.toFixed(0)}% YoY`,
        'Contracted future revenue growing faster than reported revenue is the cleanest forward signal a release gives.'));
    }
  }

  // 8 — SECTOR TAILWIND. Computed across the bench, so the comparison set is
  // the names on the page and nothing else.
  {
    const sec = str(e.sector);
    const peers = sec ? (cohort.countBySector[sec] || 0) - 1 : 0;
    const drift = sec ? cohort.driftBySector[sec] : undefined;
    if (!sec || peers < 2 || !drift || drift.n < 3) {
      F.push(factor('sector', 8, 'Sector tailwind', 5, 'unavailable',
        sec ? `only ${Math.max(0, peers)} other ${sec} name${peers === 1 ? '' : 's'} on the bench` : 'no sector on this filing',
        'Needs at least three same-sector names with a price move before a median means anything.'));
    } else {
      const m = drift.median;
      const state: FactorState = m >= 5 ? 'strong' : m >= -2 ? 'ok' : 'weak';
      F.push(factor('sector', 8, 'Sector tailwind', 5, state,
        `${sec}: median ${m >= 0 ? '+' : ''}${m.toFixed(1)}% since print across ${drift.n} benched names`,
        'Measured on this bench only — it says how the sector\'s other beats have been treated, not how the sector index did.'));
    }
  }

  // 9 — VALUATION VS GROWTH.
  {
    const p = num(e.pe);
    const sec = str(e.sector);
    const secMed = sec ? cohort.peBySector[sec] : undefined;
    const ref = (secMed && secMed.n >= 3) ? secMed.median : cohort.peMedianAll;
    const refLabel = (secMed && secMed.n >= 3) ? `${sec} median ${secMed.median.toFixed(1)}× (${secMed.n} names)`
      : cohort.peMedianAll != null ? `bench median ${cohort.peMedianAll.toFixed(1)}× (${cohort.peCountAll} names)` : null;
    const g = num(e.eps_yoy_pct) ?? num(e.eps_adj_yoy_pct);
    if (p == null || p <= 0) {
      F.push(factor('valuation', 9, 'Valuation vs growth', 8, 'unavailable',
        'no positive trailing P/E (loss-making on the trailing basis)',
        'A negative multiple is not a cheap one; it is refused rather than shown.'));
    } else if (ref == null) {
      F.push(factor('valuation', 9, 'Valuation vs growth', 8, 'unavailable',
        `P/E ${p.toFixed(1)}× with no comparison set on the bench`,
        'The framework asks how the multiple sits against the sector; with no peers there is nothing to sit against.'));
    } else {
      const rel = p / ref;
      let state: FactorState = rel <= 0.85 ? 'strong' : rel <= 1.15 ? 'ok' : 'weak';
      let why = rel <= 0.85 ? 'Below the comparison median — the beat is less likely already in the price.'
        : rel <= 1.15 ? 'Around the comparison median.'
          : 'At or above the comparison median — the framework\'s "already priced in" pattern.';
      if (g != null && g > 0) {
        const peg = p / Math.min(g, 100);
        if (peg <= 1 && state !== 'strong') { state = 'ok'; }
        why += ` P/E ÷ EPS growth = ${peg.toFixed(2)}${g > 100 ? ' (growth capped at 100% for the ratio)' : ''}.`;
      }
      F.push(factor('valuation', 9, 'Valuation vs growth', 8, state,
        `P/E ${p.toFixed(1)}× vs ${refLabel}`, why));
    }
  }

  // 10 — FLOAT DYNAMICS. Liquidity plus whether the share count is shrinking.
  {
    const addv = num(e.addv_musd);
    const sc = usShareCount(e);
    const y = sc?.yoy_pct ?? null;
    if (addv == null && y == null) {
      F.push(factor('float', 10, 'Float dynamics', 6, 'unavailable',
        'no dollar volume and no diluted share count on file',
        'Needs either 20 sessions of trading or a tagged share count.'));
    } else {
      const bits: string[] = [];
      if (addv != null) bits.push(`$${addv.toFixed(1)}M traded per day`);
      if (y != null) bits.push(`diluted shares ${y >= 0 ? '+' : ''}${y.toFixed(1)}% YoY`);
      if (sc?.buyback_musd != null) bits.push(`$${sc.buyback_musd.toFixed(0)}M repurchased this quarter`);
      const shrinking = y != null && y < -0.5;
      const diluting = y != null && y > 3;
      const thin = addv != null && addv < 2;
      const state: FactorState = diluting || thin ? 'weak' : shrinking ? 'strong' : 'ok';
      F.push(factor('float', 10, 'Float dynamics', 6, state, bits.join(' · '),
        thin ? 'Under $2M a day, a position of any size moves the price itself.'
          : diluting ? 'The share count is growing — every holder\'s claim is being diluted.'
            : shrinking ? 'The share count is shrinking, which tightens the float behind the same earnings.'
              : 'Liquid enough to trade, share count roughly flat.'));
    }
  }

  F.sort((a, b) => a.rank - b.rank);
  const avail = F.filter((f) => f.state !== 'unavailable');
  const wSum = avail.reduce((s, f) => s + f.weight, 0);
  const composite = (avail.length >= WINNERS_MIN_FACTORS && wSum > 0)
    ? Math.round(avail.reduce((s, f) => s + (f.score as number) * f.weight, 0) / wSum)
    : null;
  const stacked = F.filter((f) => f.state === 'strong').length;
  const band: WinnersScorecard['band'] = composite == null ? null
    : composite >= 70 ? 'WINNER SETUP' : composite >= 45 ? 'MIXED' : 'LOSER PATTERN';

  // ── the framework's losing patterns ──────────────────────────────────────
  const losing: WinnersScorecard['losing'] = [];
  {
    const val = F.find((f) => f.id === 'valuation');
    if (val && val.state === 'weak') {
      losing.push({
        label: 'beat may already be priced in',
        detail: `${val.input}. The other half of this pattern — crowded institutional ownership — is not sourceable from free US data and is not guessed at.`,
      });
    }
  }
  {
    const cyc = usCyclicality(e);
    if (cyc && cyc.cyclical) {
      losing.push({
        label: 'cyclical earnings pattern',
        detail: `Net income has flipped between year-on-year growth and decline ${cyc.flips} times in the last ${cyc.quarters} quarters — the profit line is not compounding, it is oscillating.`,
      });
    }
  }
  {
    const b = str(e.market_cap_bucket) ?? '';
    if (b === 'mega' || b === 'large') {
      const mc = num(e.market_cap_musd);
      losing.push({
        label: 'mature large-base business',
        detail: `${b === 'mega' ? 'Mega' : 'Large'} cap${mc != null ? ` at ${mc >= 1000 ? `$${(mc / 1000).toFixed(1)}B` : `$${mc.toFixed(0)}M`}` : ''} — the same dollar of incremental profit moves a far smaller percentage of the base.`,
      });
    }
  }
  {
    const mt = usMarginTrend(e, 'operating');
    if (mt && Math.abs(mt.delta_pp) < 0.5 && mt.now_pct >= 10) {
      losing.push({
        label: 'margins good in level, flat in slope',
        detail: `Operating margin ${mt.now_pct.toFixed(1)}% versus ${mt.then_pct.toFixed(1)}% (${mt.delta_pp >= 0 ? '+' : ''}${mt.delta_pp.toFixed(1)}pp, ${mt.label}). A high margin that is not still widening has nothing left to re-rate on.`,
      });
    }
  }
  if (composite != null && stacked <= 1) {
    losing.push({
      label: 'single catalyst, not stacked',
      detail: `Only ${stacked} of the ${avail.length} readable separators scored strong. The framework's winners stack several at once.`,
    });
  }

  const note = composite == null
    ? `Scored on ${avail.length} of ${F.length} factors — below the ${WINNERS_MIN_FACTORS} needed for a composite, so no overall number is shown.`
    : `Scored on ${avail.length} of ${F.length} factors, weighted by the framework's own order of importance.`;

  return { factors: F, available: avail.length, total: F.length, composite, band, losing, stacked, note };
}

export interface UsCyclicality { cyclical: boolean; flips: number; quarters: number }

/**
 * Is the profit line compounding or oscillating?
 *
 * Derived from the filer's own net-income series — the number of times the
 * year-on-year direction flips sign. No sector list, no industry mapping, no
 * ticker branch: a business whose earnings swing between growth and decline
 * behaves cyclically whatever its SIC code says.
 */
export function usCyclicality(e: UsConvictionEntry): UsCyclicality | null {
  const s = e.series;
  if (!s) return null;
  const ni = s.net_income;
  const n = Math.min(s.ends.length, ni.length);
  if (n < 9) return null;
  const dirs: number[] = [];
  for (let i = 4; i < n; i++) {
    const cur = num(ni[i]), prev = num(ni[i - 4]);
    if (cur == null || prev == null) continue;
    dirs.push(cur >= prev ? 1 : -1);
  }
  if (dirs.length < 5) return null;
  let flips = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) flips++;
  return { cyclical: flips >= 2, flips, quarters: dirs.length };
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
 *
 * This is the EARNINGS-QUALITY verdict — what the print itself was worth. The
 * winners scorecard is a separate question (whether the market is set up to
 * pay for it) and the two are deliberately not merged.
 */
export function usVerdict(e: UsConvictionEntry): { score: number; verdictLabel: UsVerdict; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;
  const s = num(e.sales_yoy_pct), p = num(e.net_profit_yoy_pct), ep = num(e.eps_yoy_pct);
  if (s != null) { score += s >= 40 ? 12 : s >= 25 ? 9 : s >= 15 ? 5 : s >= 5 ? 1 : -8; if (s >= 25) reasons.push(`revenue +${Math.round(s)}%`); }
  if (p != null) { score += p >= 50 ? 12 : p >= 25 ? 8 : p >= 10 ? 4 : p >= 0 ? 0 : -10; }
  if (ep != null) { score += ep >= 50 ? 10 : ep >= 25 ? 7 : ep >= 10 ? 3 : ep >= 0 ? 0 : -8; if (ep >= 25) reasons.push(`EPS +${Math.round(ep)}%`); }
  // A loss→profit turn carries no percentage; credit the turn itself so a
  // genuine turnaround is not scored as a missing number.
  if (ep == null && e.eps_swing === 'loss-to-profit') { score += 8; reasons.push('swung from a loss to a profit'); }
  if (ep == null && e.eps_swing === 'loss-widened') { score -= 8; reasons.push('loss widened'); }
  const od = (num(e.opm_pct) != null && num(e.opm_prev_pct) != null) ? (e.opm_pct as number) - (e.opm_prev_pct as number) : null;
  if (od != null) { score += od >= 3 ? 10 : od >= 1 ? 6 : od >= 0 ? 2 : od >= -1.5 ? -5 : -12; if (od >= 1) reasons.push(`margins +${od.toFixed(1)}pp`); }
  const c = num(e.cfo_to_pat_ratio);
  if (!e.is_financial && c != null) { score += c >= 1 ? 8 : c >= 0.7 ? 4 : c >= 0.5 ? 0 : -12; if (c < 0.5) reasons.push('earnings not cash-backed'); }
  if (e.tier === 'BLOCKBUSTER') score += 6;
  if (e.guidance === 'RAISED') { score += 8; reasons.push('guidance raised'); }
  else if (e.guidance === 'LOWERED' || e.guidance === 'WITHDRAWN') { score -= 12; reasons.push('guidance cut'); }
  else if (!e.guidance) {
    // No press-release label. The FY guide movement is the same fact stated a
    // different way, so it fills the gap — it never double-counts.
    const gc = usGuideChangeSummary(e);
    if (gc?.direction === 'raised') { score += 8; reasons.push('FY outlook raised'); }
    else if (gc?.direction === 'lowered') { score -= 12; reasons.push('FY outlook lowered'); }
  }
  const og = usOwnGuideVerdict(e);
  if (og?.verdict === 'beat') { score += 4; reasons.push('beat its own guide'); }
  else if (og?.verdict === 'missed') { score -= 6; reasons.push('missed its own guide'); }
  if (num(e.eps_surprise_pct) != null) {
    const v = e.eps_surprise_pct as number;
    score += v >= 10 ? 5 : v >= 0 ? 2 : v <= -10 ? -8 : -3;
  }
  if (num(e.pead_score) != null) {
    const v = e.pead_score as number;
    score += v >= 75 ? 6 : v >= 60 ? 3 : v >= 40 ? 0 : -4;
  }
  if (e.stage === 4) { score -= 12; reasons.push('stage 4 downtrend'); }
  if ((e.caveat_tags || []).includes('ocf divergence')) reasons.push('CFO/PAT divergence');
  if ((e.caveat_tags || []).includes('optical eps')) reasons.push('optical EPS');
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdictLabel: UsVerdict = score >= 78 ? 'STRONG BUY' : score >= 65 ? 'BUY' : score >= 50 ? 'WATCH' : 'AVOID';
  return { score, verdictLabel, reasons };
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════════════════════

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
  /** Net-income growth ÷ revenue growth — the India bench's op-leverage gate. */
  opLev: number | null;
  /** Minimum winners-scorecard composite. Names the scorecard refused to score
   *  never pass this gate — a refusal is not a zero. */
  winMin: number | null;
  /** Signed thresholds, exactly as India: positive = "at least", negative =
   *  "at most". */
  d1Bucket: number | null;
  driftBucket: number | null;
  guidance: string | null;       // RAISED / MAINTAINED / LOWERED / PROVIDED / WITHDRAWN / NONE
  guideBeatOnly: boolean;        // beat its own prior-quarter guide
  marginSlopeUp: boolean;        // margin still widening
  shareShrinkOnly: boolean;      // diluted share count falling
  thesis: string | null;         // CONFIRMED / INTACT / WEAKENED / BROKEN
  quarter: number | null;        // 1-4, the filer's own fiscal quarter
  fy: number | null;             // full 4-digit fiscal year
  fromDate: string | null;       // YYYY-MM-DD
  toDate: string | null;
  cap: string | null;            // 'all' | 'smid' | bucket
  tiers: string[] | null;
  verdicts: string[] | null;
  elite: boolean;
  multibagger: boolean;
  /** Rule of 40 — revenue growth % + FCF margin % at or above 40. A row whose
   *  score could not be computed is EXCLUDED rather than assumed to pass: the
   *  filter is a claim about the company and we cannot make it without the
   *  numbers. Same rule the Opportunities page applies. */
  rule40: boolean;
  /** Trailing-twelve-month EBIT ÷ capital employed at or above 20%. */
  roce20: boolean;
  /** The second axis. Same refusal rule as `rule40`/`roce20`: an entry with no
   *  quadrant on it is CUT, not assumed to qualify. */
  turnaround: boolean;
  compounder: boolean;
  prelimOnly: boolean;
  newOnly: boolean;
  sector: string | null;
  q: string;                     // free-text ticker/company search
}

export const US_FILTER_DEFAULT: UsConvFilters = {
  sales: null, eps: null, pat: null, pead: null, opmDelta: null, opmMin: null,
  cfoPatMin: null, mktCapMin: null, peMax: null, score: null, opLev: null, winMin: null,
  d1Bucket: null, driftBucket: null, guidance: null, guideBeatOnly: false,
  marginSlopeUp: false, shareShrinkOnly: false, thesis: null,
  quarter: null, fy: null, fromDate: null, toDate: null,
  cap: 'all', tiers: null, verdicts: null, elite: false, multibagger: false,
  rule40: false, roce20: false, turnaround: false, compounder: false,
  prelimOnly: false, newOnly: false, sector: null, q: '',
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every gate, composed AND-style.
 *
 * NEW is a RECENCY lens: it bypasses the QUALITY gates (that is deliberate and
 * matches India — the point is to see this week's cohort before the preset
 * crushes it to three names) but it no longer bypasses the SCOPE filters. The
 * old version returned early, so typing a ticker in the search box with NEW on
 * returned the whole bench, and every chip count collapsed to the same number.
 */
export function passesUsConvictionFilter(e: UsConvictionEntry, f: UsConvFilters, win?: NewWindow): boolean {
  // ── scope: always enforced ──────────────────────────────────────────────
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!`${e.ticker} ${e.company}`.toLowerCase().includes(q)) return false;
  }
  if (f.cap && !capMatch(e.market_cap_musd, f.cap)) return false;
  if (f.sector && (e.sector || '') !== f.sector) return false;
  if (f.tiers && f.tiers.length && !f.tiers.includes(e.tier)) return false;
  if (f.prelimOnly && !e.prelim) return false;
  if (f.quarter != null && usQuarterNum(e) !== f.quarter) return false;
  if (f.fy != null && num(e.fiscal_year) !== f.fy) return false;
  {
    const fromOk = !!f.fromDate && DATE_RE.test(f.fromDate);
    const toOk = !!f.toDate && DATE_RE.test(f.toDate);
    if (fromOk || toOk) {
      const fd = (e.filing_date || '').slice(0, 10);
      // A partially-typed date is ignored rather than treated as a real bound —
      // otherwise the string comparison silently empties the page.
      if (DATE_RE.test(fd)) {
        if (fromOk && fd < (f.fromDate as string)) return false;
        if (toOk && fd > (f.toDate as string)) return false;
      }
    }
  }

  // ── recency lens ────────────────────────────────────────────────────────
  if (f.newOnly) {
    const d = usFilingAgeDays(e.filing_date);
    const w = win?.days ?? 10;
    return d !== null && d >= 0 && d <= w;
  }

  // ── quality gates ───────────────────────────────────────────────────────
  const sales = num(e.sales_yoy_pct) ?? 0;
  const pat = num(e.net_profit_yoy_pct) ?? 0;
  const eps = num(e.eps_yoy_pct) ?? 0;
  if (f.sales != null && sales < f.sales) return false;
  if (f.pat != null && pat < f.pat) return false;
  if (f.eps != null && eps < f.eps) return false;
  if (f.score != null && (num(e.composite_score) ?? 0) < f.score) return false;
  if (f.opLev != null) {
    // Skipped when revenue growth is not positive — the ratio is meaningless
    // against a flat or shrinking top line.
    if (sales > 0 && !(pat / sales >= f.opLev)) return false;
  }
  if (f.opmMin != null) {
    if (num(e.opm_pct) == null || (e.opm_pct as number) < f.opmMin) return false;
  }
  if (f.opmDelta != null) {
    if (num(e.opm_pct) == null || num(e.opm_prev_pct) == null) return false;
    const d = (e.opm_pct as number) - (e.opm_prev_pct as number);
    if (f.opmDelta >= 0 ? d < f.opmDelta : d > f.opmDelta) return false;
  }
  if (f.cfoPatMin != null && !e.is_financial) {
    // A null ratio PASSES (a data gap is not evidence of poor quality) —
    // identical to the India rule.
    const c = num(e.cfo_to_pat_ratio);
    if (c != null && c < f.cfoPatMin) return false;
  }
  if (f.mktCapMin != null) {
    if (num(e.market_cap_musd) == null || (e.market_cap_musd as number) < f.mktCapMin) return false;
  }
  if (f.peMax != null) {
    const p = num(e.pe);
    if (p == null || p <= 0 || p > f.peMax) return false;
  }
  if (f.pead != null && (num(e.pead_score) ?? 0) < f.pead) return false;
  if (f.elite && !e.is_elite) return false;
  if (f.multibagger && !e.multibagger_setup) return false;
  // A refusal is not a zero and is not a pass: a name whose Rule of 40 or ROCE
  // could not be derived from its filing does not satisfy a filter that asserts
  // one, so it is cut. See `usRule40` / `usRoce`.
  if (f.rule40 && usRule40(e)?.passes !== true) return false;
  if (f.roce20) {
    const rc = usRoce(e);
    if (rc == null || rc.pct == null || rc.pct < 20) return false;
  }
  if (f.turnaround && e.quadrant !== 'TURNAROUND ACCELERATOR') return false;
  if (f.compounder && e.quadrant !== 'COMPOUNDER') return false;
  if (f.d1Bucket != null) {
    const d1 = num(e.d1_pct);
    if (d1 == null) return false;
    if (f.d1Bucket >= 0 ? d1 < f.d1Bucket : d1 > f.d1Bucket) return false;
  }
  if (f.driftBucket != null) {
    const m = num(e.move_pct);
    if (m == null) return false;
    if (f.driftBucket >= 0 ? m < f.driftBucket : m > f.driftBucket) return false;
  }
  if (f.guidance != null) {
    const g = e.guidance ?? null;
    if (f.guidance === 'NONE') { if (g) return false; }
    else if (g !== f.guidance) return false;
  }
  if (f.guideBeatOnly && usOwnGuideVerdict(e)?.verdict !== 'beat') return false;
  if (f.marginSlopeUp) {
    const mt = usMarginTrend(e, 'operating');
    if (!mt || mt.delta_pp <= 0) return false;
  }
  if (f.shareShrinkOnly) {
    const sc = usShareCount(e);
    if (!sc || sc.shrinking !== true) return false;
  }
  if (f.thesis != null && usThesisCheck(e).state !== f.thesis) return false;
  if (f.winMin != null) {
    // Set by the caller through `usFilterWithCohort`; without a cohort the
    // scorecard cannot be computed, so the gate is skipped rather than guessed.
    const c = _cohortForFilter;
    if (!c) return true;
    const sc = usWinnersScorecard(e, c);
    if (sc.composite == null || sc.composite < f.winMin) return false;
  }
  if (f.verdicts && f.verdicts.length) {
    if (!f.verdicts.includes(usVerdict(e).verdictLabel)) return false;
  }
  return true;
}

// The winners gate needs the cohort, which is a property of the whole list and
// not of one entry. Rather than change every call site's signature, the caller
// installs the cohort for the duration of one filtering pass.
let _cohortForFilter: UsCohort | null = null;
export function withUsCohort<T>(cohort: UsCohort | null, run: () => T): T {
  const prev = _cohortForFilter;
  _cohortForFilter = cohort;
  try { return run(); } finally { _cohortForFilter = prev; }
}
