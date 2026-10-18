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
import { runCriteriaCheck, type CriteriaCheck } from '@/lib/criteria-check';
import { decodeHTMLEntities } from '@/lib/html-decode';
import { US_ENGINE_VERSION } from '@/lib/us-engine-version';
import { passesDeMax } from '@/lib/cb-metric-view';   // zzz1068

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
  /** zzz661 — distance from the 50- and 200-day averages, in percent. */
  pct_vs_ma50?: number | null;
  pct_vs_ma200?: number | null;
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

  /** zzz828 — the US grading engine (lib/us-engine-version) that produced the
   *  tier and figures on this record. Missing = graded before the stamp. */
  engine_version?: string | null;
  /** zzz828 — the SAME filing re-graded under the current engine fell below
   *  STRONG. The record stays on the bench (never silently removed), labelled
   *  "now MIXED under current rules". Cleared when it grades STRONG again. */
  now_tier?: 'MIXED' | 'AVOID' | null;
  /** zzz828 — a bounded re-grade attempt for an engine version: how many
   *  times it was asked and got no answer (stops at US_ENGINE_RESYNC_TRIES). */
  engine_check?: { version: string; attempts: number; at: string } | null;

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
    // zzz828: "Johnson &amp; Johnson" → "Johnson & Johnson", once, on write.
    company: (str(r.company) ? decodeHTMLEntities(str(r.company)) : null) ?? String(r.ticker || '').toUpperCase(),
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
    pct_vs_ma50: num(r.pct_vs_ma50),
    pct_vs_ma200: num(r.pct_vs_ma200),
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

// ═══ WHERE THE BENCH ACTUALLY LIVES  (zzz608) ══════════════════════════════
//
// THE BUG THIS FIXES, precisely.
//
// A graded bench record is about 13 KB — guidance figures, the guide
// comparison, the setup factor list, sixteen quarters of series, thirty daily
// closes. Three hundred names is therefore ~3.8 MB, and localStorage caps the
// WHOLE ORIGIN at about 5 MB — an origin that also holds the Multibagger
// uploads, the technicals rows, the India bench and the day caches.
//
// So the write threw QuotaExceededError, the escalation ladder below threw at
// every rung, and the last rung gave up SILENTLY. The sweep had graded all 63
// sessions correctly and collected 305 names; the disk kept eleven. Pressing
// "Reload bench" or "Clear + reload" did the same work and hit the same wall,
// which is exactly what "still missing many companies" looks like from the
// outside: no error, no warning, just a short bench.
//
// A cap you keep hitting is not a tuning problem. IndexedDB has hundreds of
// megabytes, so the bench lives there now, with an in-memory map as the
// synchronous surface every caller already expects and localStorage kept only
// as a best-effort mirror so the first paint after a cold start is not blank.
// If the mirror does not fit, nothing is lost any more — and the failure is
// recorded instead of swallowed.
const IDB_NAME = 'mc-us-bench';
const IDB_STORE = 'bench';
const IDB_DOC = 'map';

let _mem: Record<string, UsConvictionEntry> | null = null;
let _idbBroken = false;
/** True when the bench could not be persisted anywhere. Surfaced in the UI —
 *  silent data loss is the one outcome this module must never produce. */
export let usBenchPersistError: string | null = null;

function idbOpen(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const rq = indexedDB.open(IDB_NAME, 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore(IDB_STORE); } catch { /* exists */ } };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      // zzz828: a database blocked by another tab never answers — the bench
      // falls back to the localStorage mirror instead of "loading…" for ever.
      rq.onblocked = () => res(null);
      setTimeout(() => res(null), 6_000);
    } catch { res(null); }
  });
}

function migrateMap(o: any): Record<string, UsConvictionEntry> {
  const out: Record<string, UsConvictionEntry> = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const k of Object.keys(o)) {
    const e = migrateEntry(o[k]);
    if (e && typeof e === 'object' && typeof e.ticker === 'string') out[k] = e;
  }
  return out;
}

function readLocalBench(): Record<string, UsConvictionEntry> {
  try {
    const rawText = localStorage.getItem(LS_KEY);
    return migrateMap(rawText ? JSON.parse(rawText) : {});
  } catch { return {}; }
}

/**
 * Load the bench from IndexedDB into memory. Call once, early, before a sweep.
 * Until it resolves, reads fall back to whatever localStorage still holds, so
 * the page is never blank — it is simply short until the real store arrives.
 * Whichever side has MORE names wins: that makes the one-way migration off
 * localStorage automatic and makes it impossible for an empty or truncated
 * store to overwrite a good one.
 */
export async function hydrateUsConviction(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const local = readLocalBench();
  const db = await idbOpen();
  if (!db) { _idbBroken = true; _mem = local; return Object.keys(local).length; }
  const stored: any = await new Promise((res) => {
    try {
      const rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_DOC);
      rq.onsuccess = () => res(rq.result ?? null);
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
  const fromIdb = migrateMap(stored);
  _mem = Object.keys(fromIdb).length >= Object.keys(local).length ? fromIdb : local;
  // First run after the upgrade: the bench is still only in localStorage.
  if (Object.keys(fromIdb).length < Object.keys(local).length) writeUsConviction(local);
  emit();
  return Object.keys(_mem).length;
}

/** Read the raw map, migrating each record forward in memory. */
export function readUsConviction(): Record<string, UsConvictionEntry> {
  if (typeof window === 'undefined') return {};
  // A shallow copy: callers mutate the map they are handed (delete a demoted
  // ticker, patch a record) and then write it back, and the in-memory store
  // must not change under them before that write lands.
  if (!_mem) _mem = readLocalBench();
  return { ..._mem };
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
  // MEMORY IS THE SOURCE OF TRUTH, and it is updated first and unconditionally
  // — no storage limit can take names off the bench in front of the user.
  _mem = clean;

  // IndexedDB is the real store. Hundreds of megabytes, so the whole bench
  // fits with room to spare.
  if (!_idbBroken) {
    void (async () => {
      const db = await idbOpen();
      if (!db) { _idbBroken = true; return; }
      try {
        await new Promise<void>((res, rej) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(clean, IDB_DOC);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        usBenchPersistError = null;
      } catch (e: any) {
        usBenchPersistError = `The bench could not be saved to this browser's database (${String(e?.name || e)}). It is correct on screen but may be short after a reload.`;
      }
    })();
  }

  // localStorage is now only a MIRROR, so the first paint after a cold start
  // is not blank while IndexedDB opens. It is allowed to be incomplete: the
  // freshest MAX_BENCH names are the ones worth having early, and hydrate
  // replaces them with the full set a moment later. What must never happen
  // again is a failure here costing the user names — it cannot, because the
  // real copy is already in memory and on its way to IndexedDB.
  try { localStorage.setItem(LS_KEY, JSON.stringify(clean)); return; } catch { /* full */ }
  try { evictStaleGradedCaches(30); localStorage.setItem(LS_KEY, JSON.stringify(clean)); return; } catch { /* still full */ }
  try { localStorage.setItem(LS_KEY, JSON.stringify(pruneBench(clean, MAX_BENCH))); return; } catch { /* still full */ }
  try {
    evictStaleGradedCaches(0);
    localStorage.setItem(LS_KEY, JSON.stringify(pruneBench(clean, Math.floor(MAX_BENCH * 0.75))));
  } catch {
    // The mirror does not fit. Harmless now — but if IndexedDB is ALSO gone
    // (private window, blocked site data) the bench really is memory-only and
    // the user has to be told rather than left to discover it after a reload.
    if (_idbBroken) {
      usBenchPersistError = 'This browser is out of storage for the bench and its database is unavailable, so the bench is held in memory only and will be short after a reload.';
    }
  }
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

export type UsSyncEntry = Record<string, any> & {
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
  const r = syncUsConvictionMap(readUsConviction(), entries);
  if (r.binned.length) binPush(r.binned);
  if (r.count > 0) { writeUsConviction(r.map); emit(); }
  return r.count;
}

/**
 * zzz828 — the upsert, PURE (no window, no storage) so it can be tested.
 * Every record it writes is stamped with the current engine version.
 *
 * THE ONE CHANGE IN BEHAVIOUR: the SAME filing re-graded MIXED / AVOID (an
 * engine change re-reading a quarter it already benched) no longer deletes
 * the record. It stays, with its figures refreshed and `now_tier` set, so the
 * page can say "now MIXED under current rules" — never silently removed. A
 * NEWER filing that grades MIXED / AVOID still demotes (recoverably, via the
 * bin), exactly as before: that is a new quarter, not a rule change.
 */
export function syncUsConvictionMap(
  mapIn: Record<string, UsConvictionEntry>, entries: UsSyncEntry[], engineVersion: string = US_ENGINE_VERSION,
): { map: Record<string, UsConvictionEntry>; count: number; binned: UsConvictionEntry[]; nowMixed: string[] } {
  const map: Record<string, UsConvictionEntry> = { ...mapIn };
  const binned: UsConvictionEntry[] = [];
  const nowMixed: string[] = [];
  let count = 0;

  for (const raw of entries) {
    const ticker = String(raw?.ticker || '').toUpperCase();
    if (!ticker) continue;
    const tier = raw.tier;
    const existing = map[ticker];

    if (tier === 'MIXED' || tier === 'AVOID') {
      const fd = String(raw.filing_date || '').slice(0, 10);
      if (existing && fd && fd === existing.filing_date) {
        // Same filing, lower tier under today's rules: keep, refresh, label.
        const e = usBenchFields(raw) as any;
        const next: any = { ...existing };
        for (const k of Object.keys(e)) {
          if (k === 'ticker' || k === 'added_at' || k === 'tier') continue;
          if (e[k] != null) next[k] = e[k];
        }
        next.now_tier = tier;
        next.engine_version = engineVersion;
        next.engine_check = null;
        if (JSON.stringify(next) !== JSON.stringify(existing)) { map[ticker] = next; count++; }
        nowMixed.push(ticker);
        continue;
      }
      if (existing && fd >= existing.filing_date) {
        binned.push(existing); delete map[ticker]; count++;
      }
      if (raw.quarter && raw.fiscal_year) {
        const cKey = `${ticker}@${raw.quarter}-${raw.fiscal_year}`;
        if (map[cKey]) { binned.push(map[cKey]); delete map[cKey]; count++; }
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
            const rec: any = { ...e, ticker, added_at: new Date().toISOString(), schema_v: US_BENCH_SCHEMA_V, engine_version: engineVersion };
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
        if (cur.engine_version !== engineVersion) patch.engine_version = engineVersion;
        if (cur.now_tier) patch.now_tier = null;
        if (cur.engine_check) patch.engine_check = null;
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

    const rec: any = { ...e, ticker, added_at: existing?.added_at || new Date().toISOString(), schema_v: US_BENCH_SCHEMA_V, engine_version: engineVersion, now_tier: null, engine_check: null };
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

  return { map, count, binned, nowMixed };
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
  // Clear every copy, or a "Clear + reload" would be silently undone by
  // hydrate handing back the old IndexedDB map on the next visit.
  _mem = {};
  try { localStorage.removeItem(LS_KEY); } catch {}
  void (async () => {
    const db = await idbOpen();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_DOC);
    } catch { /* nothing stored */ }
  })();
  emit();
}

/** Newest filing first, BLOCKBUSTER ahead of STRONG on the same date.
 *  Every entry is stamped with the map key it lives under (`bench_key`). */
export function getUsConvictionList(): UsConvictionEntry[] {
  const map = readUsConviction();
  const out: UsConvictionEntry[] = [];
  // zzz828: a record saved before the write-time decode still reads cleanly.
  for (const k of Object.keys(map)) {
    const e = map[k];
    const co = typeof e.company === 'string' && e.company.includes('&') ? decodeHTMLEntities(e.company) : e.company;
    out.push({ ...e, company: co, bench_key: k });
  }
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
// Everything else is identical: Sales ≥20 · EPS ≥25 · PEAD ≥40 · OPM Δ ≥0 ·
// CFO/PAT ≥0.5 (skipped for financials) · verdict ∈ {STRONG BUY, BUY, WATCH}.
//
// ═══ WHY PEAD MOVED FROM 60 TO 40  (zzz659) ══════════════════════════════
//
// PEAD is not a quality score and was being used as one. It is a Bernard–Thomas
// DRIFT proxy: 35% of it is the one-day reaction, 15% the gap, 25% the volume
// confirmation, 25% the surprise. It answers "is the market set up to keep
// paying for this print", which is a question about the TAPE, not about the
// business.
//
// At 60 the gate therefore threw away every good quarter the market happened to
// sell on the day. Fastly is the case: revenue +23%, adjusted EPS from a loss to
// $0.15 against a $0.07 estimate, operating margin +17pp, own outlook raised —
// and a -9.1% reaction, which scores ZERO on the one-day leg and drags the whole
// figure to 21. The engine correctly tagged it "market rejected print". A
// preset that exists to find good businesses should not be silently filtering
// on whether the market liked them that afternoon, because the entire premise
// of this bench is buying quality the tape has mispriced.
//
// 40 keeps the gate doing its real job — excluding prints with no drift setup
// AND nothing else going for them — while letting a sold-off quality print onto
// the bench, where the drift state is shown on the card as its own chip and the
// reader can judge it. The other five gates are unchanged and still strict.
export const US_PRESET = {
  sales: 20,
  eps: 25,
  pead: 40,
  opmDelta: 0,
  cfoPatMin: 0.5,
  mktCapMinMusd: 300,
  // ═══ THE TREND GATE  (zzz661) ═════════════════════════════════════════
  // A great quarter in a downtrend is a great quarter you will hold through
  // a drawdown. Above BOTH averages is the classic definition of a stock the
  // market is still paying for: the 50-day says the recent trend is intact,
  // the 200-day says the primary one is. Requiring both is stricter than
  // either and much stricter than "not stage 4", which was the only trend
  // test anywhere in the preset before this.
  //
  // Deliberately NOT the Weinstein stage. Stage 2 additionally demands the
  // 50 above the 200 and the 200 rising, which is a different and later
  // condition — a stock reclaiming both averages after a base is exactly
  // what this bench exists to catch, and stage 2 would not see it for weeks.
  requireAboveMa50: true,
  requireAboveMa200: true,
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
  // zzz828: cash and income on one period (usCashRatio), never a stored ratio of unknown period.
  const c = usCashRatio(e).ratio;
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
  /** zzz1068 — max debt ÷ equity (stock-screener snapshot, `de_ratio`). Financials and an unknown D/E pass. */
  deMax?: number | null;
  score: number | null;
  /** zzz661 — trend gates: price above its 50- / 200-day average. */
  aboveMa50?: boolean;
  aboveMa200?: boolean;
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
  aboveMa50: false, aboveMa200: false,
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
    opmDelta: US_PRESET.opmDelta, cfoPatMin: US_PRESET.cfoPatMin, opmMin: 0,   // zzz893 — positive operating margin
    mktCapMin: US_PRESET.mktCapMinMusd, verdicts: [...US_PRESET.verdicts],
    aboveMa50: US_PRESET.requireAboveMa50, aboveMa200: US_PRESET.requireAboveMa200,
  };
}

export function isUsPresetActive(f: UsConvFilters): boolean {
  return f.sales === US_PRESET.sales && f.eps === US_PRESET.eps && f.pead === US_PRESET.pead
    && f.opmDelta === US_PRESET.opmDelta && f.cfoPatMin === US_PRESET.cfoPatMin && f.opmMin === 0
    && f.mktCapMin === US_PRESET.mktCapMinMusd
    && !!f.aboveMa50 === US_PRESET.requireAboveMa50 && !!f.aboveMa200 === US_PRESET.requireAboveMa200
    && JSON.stringify((f.verdicts || []).slice().sort()) === JSON.stringify(['BUY', 'STRONG BUY', 'WATCH']);
}

function capMatch(musd: number | null | undefined, filter: string | null | undefined): boolean {
  if (!filter || filter === 'all') return true;
  if (musd == null || !Number.isFinite(musd)) return false;
  const b = musd >= 200_000 ? 'mega' : musd >= 10_000 ? 'large' : musd >= 2_000 ? 'mid' : musd >= 300 ? 'small' : 'micro';
  if (filter === 'smid') return b === 'small' || b === 'mid';
  if (filter === 'u30') return musd < US_CB_U30_MUSD;   // zzz879 — Rishi's default: everything under $30B
  return b === filter;
}

/** zzz879 — the "Under $30B" cap band (market cap in $M). */
export const US_CB_U30_MUSD = 30_000;
/** zzz879 — an entry whose filing is older than this many days is shown greyed
 *  out: still on the bench (its history matters), but no longer a fresh idea. */
export const US_BENCH_AGED_DAYS = 60;
export function isUsBenchAged(e: { filing_date?: string | null }, days = US_BENCH_AGED_DAYS): boolean {
  const a = usFilingAgeDays(e?.filing_date);
  return a != null && a > days;
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
    if (!(d !== null && d >= 0 && d <= w)) return false;
    // zzz1039 — NEW combines with the quality gates below (preset on → new AND passing; preset off → every new name)
  }

  // ── quality gates ───────────────────────────────────────────────────────
  const sales = num(e.sales_yoy_pct) ?? 0;
  const pat = num(e.net_profit_yoy_pct) ?? 0;
  const eps = num(e.eps_yoy_pct) ?? 0;
  if (f.sales != null && sales < f.sales) return false;
  // zzz828: a loss → profit turn has no growth percentage and is not a miss —
  // it clears a growth gate (the turn itself is the growth). A loss that
  // narrowed or widened is still no percentage and still fails.
  if (f.pat != null && pat < f.pat && !(num(e.net_profit_yoy_pct) == null && e.net_income_swing === 'loss-to-profit')) return false;
  if (f.eps != null && eps < f.eps && !(num(e.eps_yoy_pct) == null && e.eps_swing === 'loss-to-profit')) return false;
  if (f.score != null && (num(e.composite_score) ?? 0) < f.score) return false;
  if (f.opLev != null) {
    // Skipped when revenue growth is not positive — the ratio is meaningless
    // against a flat or shrinking top line.
    if (sales > 0 && !(pat / sales >= f.opLev)) return false;
  }
  if (f.opmMin != null) {
    // zzz893: '≥0%' lets an unknown margin through (unknown is not a loss); higher levels need a number
    if (num(e.opm_pct) == null) { if (f.opmMin > 0) return false; }
    else if ((e.opm_pct as number) < f.opmMin) return false;
  }
  if (f.opmDelta != null) {
    if (num(e.opm_pct) == null || num(e.opm_prev_pct) == null) return false;
    const d = (e.opm_pct as number) - (e.opm_prev_pct as number);
    if (f.opmDelta >= 0 ? d < f.opmDelta : d > f.opmDelta) return false;
  }
  if (f.cfoPatMin != null && !e.is_financial) {
    // zzz828 — ONE PERIOD ON BOTH SIDES. `usCashRatio` reads the trailing
    // twelve months of BOTH from the filing's own quarterly series, else this
    // quarter's cash against this quarter's income, and says which. A loss is
    // "no earnings to convert" (a fail, zzz662); a ratio that cannot be built
    // on one period FAILS HERE — and usCbCriteriaCheck reports that as
    // "not checked: cash ratio missing", never as a miss.
    const cr = usCashRatio(e);
    if (cr.lossMaking) return false;
    if (cr.ratio == null) return false;
    if (cr.ratio < f.cfoPatMin) return false;
  }
  if (f.mktCapMin != null) {
    if (num(e.market_cap_musd) == null || (e.market_cap_musd as number) < f.mktCapMin) return false;
  }
  if (f.deMax != null && !passesDeMax((e as any).de_ratio, !!(e as any).is_financial, f.deMax)) return false;   // zzz1068
  if (f.peMax != null) {
    const p = num(e.pe);
    if (p == null || p <= 0 || p > f.peMax) return false;
  }
  if (f.pead != null && (num(e.pead_score) ?? 0) < f.pead) return false;
  // ── ABOVE THE 50- AND 200-DAY AVERAGES  (zzz661) ────────────────────────
  //
  // The distance is used where the grader captured it. Where it did not — an
  // entry benched before this field existed — the STAGE is the fallback, and
  // only for the 200-day leg, because the stage is defined by the 200: stages
  // 2 and 3 are above it, 1 and 4 below. That covers every existing entry
  // exactly, with no re-grade and no guessing.
  //
  // A 50-day test has no such fallback, so an entry that carries neither the
  // figure nor a way to derive it is NOT silently failed: it would empty the
  // bench of every name graded before today, which is a filter lying about
  // its universe rather than filtering it. Those names pass this leg and the
  // page reports how many were unverified, so the gap is visible rather than
  // hidden. Each sweep re-prices older entries, so the count falls to zero on
  // its own.
  if (f.aboveMa50) {
    const d50 = num(e.pct_vs_ma50);
    if (d50 != null && d50 <= 0) return false;
  }
  if (f.aboveMa200) {
    const d200 = num(e.pct_vs_ma200);
    if (d200 != null) { if (d200 <= 0) return false; }
    else { const st = num(e.stage); if (st != null && st !== 2 && st !== 3) return false; }
  }
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
    if (!normalizeUsVerdictKeys(f.verdicts).includes(usVerdict(e).verdictLabel)) return false;
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

// ═══════════════════════════════════════════════════════════════════════════
// THE SERVER BENCH, MERGED IN.  (zzz665)
//
// Until now the US bench existed in exactly one place: this browser. India's
// bench has been server-side since zzz427, whose own header records the reason
// — "previously the bench only updated when a human opened the Earnings tab" —
// and that fix was never carried across. So the US bench did not accumulate
// while the tab was shut, did not follow the owner to a second machine, and
// could not remember a name that graded BLOCKBUSTER further back than the
// client sweep's 21/42/63-session window reaches.
//
// /api/v1/cron/refresh-us-bench now keeps a server copy, swept over 130
// sessions. This merges it in.
//
// ADDITIVE ONLY — AND THAT IS THE WHOLE DESIGN.
//
// A cron must not overrule a decision. When the owner removes a name from the
// bench that is a judgement about a company, and a nightly job that quietly
// puts it back would be worse than useless: it would make the remove button
// look broken and teach him not to trust the page. So anything sitting in the
// recycle bin is filtered out BEFORE the merge, and the local entry always
// wins on conflict — `syncUsConviction` already prefers the newer filing date,
// which is the correct rule for the same ticker reporting twice.
//
// The bin is capped at 200 entries, so a tombstone can in principle age out
// after a great many removals and let a long-forgotten name return. That is a
// real limit and is written down here rather than hidden: the alternative, an
// uncapped tombstone list in localStorage, trades a rare surprise for a
// storage leak on a bench that is already fighting the 5 MB quota.
//
// A bench built by an OLDER ENGINE IS IGNORED. Grades change when the rules
// change (see lib/us-engine-version.ts), and merging yesterday's verdicts into
// today's engine would silently reintroduce exactly the bugs a version bump
// exists to flush out.
// ═══════════════════════════════════════════════════════════════════════════
export async function mergeServerUsBench(): Promise<{
  merged: number; skipped_removed: number; server_count: number;
  updatedAt: string | null; stale_engine: boolean;
}> {
  const empty = { merged: 0, skipped_removed: 0, server_count: 0, updatedAt: null, stale_engine: false };
  if (typeof window === 'undefined') return empty;

  let payload: any = null;
  try {
    // zzz828: a server that never answers must not hold the page on "loading".
    const res = await fetch('/api/v1/bench-us', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return empty;
    payload = await res.json();
  } catch { return empty; }

  const entries: any[] = Array.isArray(payload?.entries) ? payload.entries : [];
  if (!entries.length) return { ...empty, updatedAt: payload?.updatedAt ?? null };

  // Refuse a bench graded by an engine that is no longer the current one.
  if (payload?.engine_version && payload?.current_engine_version
      && payload.engine_version !== payload.current_engine_version) {
    return {
      merged: 0, skipped_removed: 0, server_count: entries.length,
      updatedAt: payload?.updatedAt ?? null, stale_engine: true,
    };
  }

  const removed = new Set(
    readUsConvictionBin()
      .map((e: any) => String(e?.ticker || '').toUpperCase())
      .filter(Boolean),
  );

  const fresh = entries.filter((e) => !removed.has(String(e?.ticker || '').toUpperCase()));
  const merged = syncUsConviction(fresh as any);

  return {
    merged,
    skipped_removed: entries.length - fresh.length,
    server_count: entries.length,
    updatedAt: payload?.updatedAt ?? null,
    stale_engine: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz811 — THE OWNER'S US CONVICTION BEATS CRITERIA, FOR OTHER PAGES.
// US Portfolio Catalysts selects its bench with the SAME criteria the US
// Conviction Beats page opens with: his saved filters (mc:us-cb:filters:v1,
// brought up to date exactly as the page's initializer does), else the
// preset (+ Small/Mid) unless he switched it off, applied by the SAME
// passesUsConvictionFilter over the SAME list (this browser's bench after
// the server merge). Only per-session chips (funnel stage, bucket,
// confidence, pattern) are not stored and so not applied.
// ═══════════════════════════════════════════════════════════════════════════
export const US_CB_FILTERS_KEY = 'mc:us-cb:filters:v1';
export const US_CB_OPTOUT_KEY = 'mc:us-cb:preset:v1:optout';
export const US_CB_SMID_FLAG_KEY = 'mc:us-cb:smid-default:v1';
/** zzz879 — one-time move of the default cap band to "Under $30B". */
export const US_CB_U30_FLAG_KEY = 'mc:us-cb:u30-default:v1';
/** zzz879 — the move itself: a cap still on the old automatic default
 *  (Small+Mid or All) becomes Under $30B. Any other band was a deliberate
 *  choice and is kept. */
export function usCbMigrateU30(f: UsConvFilters): UsConvFilters {
  return (!f.cap || f.cap === 'all' || f.cap === 'smid') ? { ...f, cap: 'u30' } : f;
}

/** zzz1068 — the owner (17 Oct 2026): the preset accepts ANY SIZE. One-time move of a cap band
 *  that is still on an automatic default (Under $30B or Small+Mid) back to All. Any other band
 *  (small / mid / large / micro picked by hand) is kept. */
export const US_CB_ALL_SIZE_FLAG_KEY = 'mc:us-cb:all-size-default:v1';
export function usCbMigrateAllSize(f: UsConvFilters): UsConvFilters {
  return (f.cap === 'u30' || f.cap === 'smid') ? { ...f, cap: 'all' } : f;
}
/** The cap band the preset carries (zzz1068: all sizes; was Under $30B). */
export const US_PRESET_CAP = 'all';

/** The page's useState initializer, verbatim: a saved set, migrated when it
 *  is an older edition of the preset (zzz662). Null when nothing is saved. */
export function usCbSavedFilters(raw: string | null | undefined): UsConvFilters | null {
  if (!raw) return null;
  let saved: UsConvFilters;
  try { saved = { ...US_FILTER_DEFAULT, ...JSON.parse(raw) } as UsConvFilters; } catch { return null; }
  // zzz828: a saved verdict list written with display words (or odd spelling)
  // is read back as the engine's keys, so the preset keeps matching.
  if (Array.isArray(saved.verdicts)) saved.verdicts = normalizeUsVerdictKeys(saved.verdicts);
  const legacyMatchesPreset =
    saved.sales === US_PRESET.sales
    && saved.eps === US_PRESET.eps
    && saved.opmDelta === US_PRESET.opmDelta
    && saved.cfoPatMin === US_PRESET.cfoPatMin
    && saved.mktCapMin === US_PRESET.mktCapMinMusd
    && JSON.stringify((saved.verdicts || []).slice().sort()) === JSON.stringify(['BUY', 'STRONG BUY', 'WATCH']);
  if (legacyMatchesPreset) return { ...saved, ...usPresetFilters(), cap: saved.cap, sector: saved.sector, q: saved.q };
  return saved;
}

/** What the US Conviction Beats page ends up applying on open: initializer,
 *  then the preset auto-apply (unless opted out), then the one-time Small/Mid
 *  migration — read-only here (the page itself records its flags). */
export function usCbFiltersForOwner(get: (key: string) => string | null): UsConvFilters {
  let f = usCbSavedFilters(get(US_CB_FILTERS_KEY)) || { ...US_FILTER_DEFAULT };
  if (get(US_CB_OPTOUT_KEY) !== '1') {
    if (f.sales == null && f.eps == null && f.pead == null && f.opmDelta == null && f.cfoPatMin == null && f.mktCapMin == null && f.verdicts == null) {
      f = { ...usPresetFilters(), cap: US_PRESET_CAP };
    }
  }
  // zzz1068 — the old Small+Mid (zzz811) and Under $30B (zzz879) moves are retired; one move back to All instead
  if (get(US_CB_ALL_SIZE_FLAG_KEY) !== '1') f = usCbMigrateAllSize(f);
  return f;
}

const usFmt = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 10) / 10}` : 'not known');

/** Which active criteria a US name misses — each probed ALONE through
 *  passesUsConvictionFilter. No BUY/SELL words, no 0–100 scores. */
export function usCbFailReasons(e: UsConvictionEntry, f: UsConvFilters, win?: NewWindow): string[] {
  if (passesUsConvictionFilter(e, f, win)) return [];
  const x: any = e;
  const W: Record<string, () => string> = {
    sales: () => `revenue growth ${usFmt(x.sales_yoy_pct)}% (needs ${f.sales}%)`,
    eps: () => `EPS growth ${usFmt(x.eps_yoy_pct)}% (needs ${f.eps}%)`,
    pat: () => `net income growth ${usFmt(x.net_profit_yoy_pct)}% (needs ${f.pat}%)`,
    pead: () => 'post-results drift reading below your threshold',
    opmDelta: () => 'operating margin did not widen as your criteria require (or not known)',
    opmMin: () => `operating margin below ${f.opmMin}%`,
    cfoPatMin: () => { const cr = usCashRatio(e); return cr.lossMaking ? `a net loss${cr.basis === 'ttm' ? ' over the last twelve months' : ' this quarter'} — no earnings to turn into cash` : `operating cash ${usFmt(cr.ratio)}x net income, ${cr.basis === 'ttm' ? 'last twelve months' : 'this quarter'} (needs ${f.cfoPatMin}x)`; },
    mktCapMin: () => `market cap $${usFmt(x.market_cap_musd)}M (needs $${f.mktCapMin}M)`,
    peMax: () => `P/E above ${f.peMax}`, deMax: () => `debt ÷ equity ${usFmt((e as any).de_ratio)}× (needs ${f.deMax}× or less)`, score: () => 'composite below your threshold', opLev: () => `income growth not ${f.opLev}x revenue growth`,
    winMin: () => 'scorecard below your threshold', aboveMa50: () => 'price not above its 50-day average', aboveMa200: () => 'price not above its 200-day average',
    d1Bucket: () => 'day-one move outside your chip', driftBucket: () => 'move since results outside your chip',
    guidance: () => `guidance is not ${f.guidance}`, guideBeatOnly: () => 'did not beat its own prior guide', marginSlopeUp: () => 'margin not still widening',
    shareShrinkOnly: () => 'share count not falling', thesis: () => `thesis not ${f.thesis}`, cap: () => `market-cap band not ${f.cap === 'smid' ? 'small/mid' : f.cap === 'u30' ? 'under $30B' : f.cap}`,
    tiers: () => 'tier outside your list', verdicts: () => `quality read "${usVerdictWord(usVerdict(e).verdictLabel)}" is outside your chosen list (${(f.verdicts || []).map((v) => usVerdictWord(v)).join(' / ')})`, elite: () => 'not marked elite', multibagger: () => 'no multibagger setup',
    rule40: () => 'Rule of 40 not met (or not computable)', roce20: () => 'return on capital below 20% (or not known)', turnaround: () => 'not a turnaround', compounder: () => 'not a compounder',
    prelimOnly: () => 'not a preliminary release', sector: () => `sector not ${f.sector}`, quarter: () => 'another fiscal quarter', fy: () => 'another fiscal year', fromDate: () => 'filed outside your dates', toDate: () => 'filed outside your dates',
  };
  const out: string[] = [];
  for (const k of Object.keys(W)) {
    const v: any = (f as any)[k];
    const active = k === 'cap' ? !!v && v !== 'all' : Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' ? v : v != null && v !== '';
    if (!active) continue;
    if (!passesUsConvictionFilter(e, { ...US_FILTER_DEFAULT, [k]: v } as UsConvFilters, win)) out.push(W[k]());
  }
  return out.length ? Array.from(new Set(out)) : ['another active criterion'];
}

// ── zzz823: pass / fail / NOT CHECKED (US) ──────────────────────────────────
// Same rule as India (lib/conviction-filter-india cbCriteriaCheck): the
// preset's growth, drift, margin and size criteria read a MISSING figure as a
// fail (`sales ?? 0`, a missing market cap outside every band). A name whose
// only misses are criteria it had no data for is 'unknown' — shown, labelled
// "not checked: <field> missing", never failed. Hand-set chips stay strict.
const US_LENIENT = new Set(['sales', 'eps', 'pat', 'pead', 'opmDelta', 'mktCapMin', 'cap', 'cfoPatMin']);

function usMissingFor(e: UsConvictionEntry, k: string): string[] {
  const x: any = e;
  const need = (pairs: Array<[string, string]>) => pairs.filter(([field]) => num(x[field]) == null).map(([, w]) => w);
  switch (k) {
    case 'sales': return need([['sales_yoy_pct', 'revenue growth']]);
    // A loss→profit swing has no percentage, and a loss is not a missing figure.
    case 'eps': return x.eps_swing ? [] : need([['eps_yoy_pct', 'EPS growth']]);
    case 'pat': return x.net_income_swing ? [] : need([['net_profit_yoy_pct', 'net income growth']]);
    // zzz828: no same-period cash ratio (and not a loss) → not checked.
    case 'cfoPatMin': { const cr = usCashRatio(e); return x.is_financial || cr.lossMaking || cr.ratio != null ? [] : [`cash ratio (${cr.why})`]; }
    case 'pead': return need([['pead_score', 'post-results drift reading']]);
    case 'opmDelta': return need([['opm_pct', 'operating margin'], ['opm_prev_pct', 'last year’s operating margin']]);
    case 'mktCapMin': case 'cap': return need([['market_cap_musd', 'market cap']]);
    default: return [];
  }
}

/** Pass / fail / not checked, from passesUsConvictionFilter's own probes. */
export function usCbCriteriaCheck(e: UsConvictionEntry, f: UsConvFilters, win?: NewWindow): CriteriaCheck {
  const keys = Object.keys(f).filter((k) => {
    const v: any = (f as any)[k];
    if (k === 'q') return !!v;
    return k === 'cap' ? !!v && v !== 'all' : Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' ? v : v != null && v !== '';
  });
  const probeF = (k: string) => ({ ...US_FILTER_DEFAULT, [k]: (f as any)[k] } as UsConvFilters);
  return runCriteriaCheck(
    keys,
    passesUsConvictionFilter(e, f, win),
    (k) => passesUsConvictionFilter(e, probeF(k), win),
    (k) => (US_LENIENT.has(k) ? usMissingFor(e, k) : []),
    (k) => { const r = usCbFailReasons(e, probeF(k), win); return r[0] === 'another active criterion' ? `${k} criterion` : r.join('; '); },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz828 — THE "MISSING STOCKS" AUDIT, US SIDE.
//
// The owner's report (India, "fix in USA and India always both"): the
// Conviction Beats list with the preset on was missing many names, Portfolio
// Catalysts' Conviction Beats view did not match it, and the page said little
// about why. On the US side the same audit found:
//   · the cash gate read ONE quarter's operating cash — a single working-
//     capital swing failed a name whose trailing year converts fine — and a
//     missing ratio passed SILENTLY instead of being said. It now reads the
//     last twelve months of cash AND income (same period, both sides) where
//     the filing's series has four quarters, else the same quarter of both;
//     missing = "not checked";
//   · a loss → profit turn failed the EPS / net-income growth gates (it has no
//     percentage — the turn is the growth);
//   · a verdict list saved with other spellings stopped matching the preset;
//   · a same-filing re-grade under a new engine DELETED the name.
// Everything below is PURE (no window) so it is tested directly.
// ═══════════════════════════════════════════════════════════════════════════

export interface UsCashRatio {
  /** Operating cash ÷ net income, both over `basis`. Null when not buildable. */
  ratio: number | null;
  basis: 'ttm' | 'quarter' | null;
  /** Net income is a loss over `basis` — "no earnings to convert", a real fail. */
  lossMaking: boolean;
  /** Plain words: which period, or why there is no ratio. */
  why: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Cash conversion on ONE period for both sides: the last twelve months of
 * operating cash against the last twelve months of net income, from the
 * filing's own quarterly series (four consecutive quarters of both); else this
 * quarter's operating cash against this quarter's net income (both taken from
 * the same graded quarter, or the engine's stored same-quarter ratio). Never
 * a twelve-month cash figure over one quarter's income, or the reverse.
 */
export function usCashRatio(e: UsConvictionEntry): UsCashRatio {
  const s = e.series;
  if (s && Array.isArray(s.ends) && Array.isArray(s.cfo) && Array.isArray(s.net_income)) {
    const last = Math.min(s.ends.length, s.cfo.length, s.net_income.length) - 1;
    const cfo = last >= 3 ? ttmAt(s.cfo, last) : null;
    const ni = last >= 3 ? ttmAt(s.net_income, last) : null;
    if (cfo != null && ni != null) {
      if (ni <= 0) return { ratio: null, basis: 'ttm', lossMaking: true, why: 'net loss over the last twelve months' };
      const rev = Array.isArray(s.revenue) && last >= 3 ? ttmAt(s.revenue, last) : null;
      if (rev != null && rev > 0 && ni < rev * 0.01) return { ratio: null, basis: 'ttm', lossMaking: false, why: 'net income under 1% of revenue — too small to divide by' };
      return { ratio: r2(cfo / ni), basis: 'ttm', lossMaking: false, why: `last twelve months to ${s.ends[last]}, cash and income both` };
    }
  }
  const cq = num(e.cfo_curr_musd), nq = num(e.net_income_curr_musd);
  if (cq != null && nq != null) {
    if (nq <= 0) return { ratio: null, basis: 'quarter', lossMaking: true, why: 'net loss this quarter' };
    const rq = num(e.revenue_curr_musd);
    if (rq != null && rq > 0 && nq < rq * 0.01) return { ratio: null, basis: 'quarter', lossMaking: false, why: 'net income under 1% of revenue — too small to divide by' };
    return { ratio: r2(cq / nq), basis: 'quarter', lossMaking: false, why: `this quarter${e.quarter ? ` (${e.quarter})` : ''}, cash and income both` };
  }
  // No same-period figures. A loss is still a loss (zzz662).
  const epsNow = num(e.eps_curr);
  if ((epsNow != null && epsNow < 0) || e.eps_swing === 'loss-widened' || e.eps_swing === 'loss-narrowed' || (nq != null && nq <= 0)) {
    return { ratio: null, basis: null, lossMaking: true, why: 'a net loss' };
  }
  // The engine's own ratio (gradeUsRow) divides the quarter's operating cash
  // by the SAME quarter's net income (both de-cumulated from EDGAR), and it
  // refuses a loss or a near-zero income — so a stored ratio with no figures
  // beside it is still one period on both sides.
  const stored = num(e.cfo_to_pat_ratio);
  if (stored != null) return { ratio: stored, basis: 'quarter', lossMaking: false, why: 'this quarter, as graded (cash and income both)' };
  return { ratio: null, basis: null, lossMaking: false, why: 'operating cash or net income not in the filing data' };
}

// ── verdict words (no BUY / SELL on screen) ────────────────────────────────
// The engine's keys stay exactly as they are — saved presets store them — and
// only what is PRINTED changes. Every surface (cards, table, chips, CSV, copy)
// goes through usVerdictWord.
export const US_VERDICT_WORDS: Record<UsVerdict, string> = {
  'STRONG BUY': 'Top setup', BUY: 'Good setup', WATCH: 'Watch', AVOID: 'High risk',
};

export function usVerdictWord(key: string | null | undefined): string {
  const k = normalizeUsVerdictKeys([String(key ?? '')])[0];
  return k ? US_VERDICT_WORDS[k as UsVerdict] : String(key ?? '');
}

/** Any spelling of a verdict — the engine key, a display word, underscores,
 *  lower case, "HIGH RISK" — back to the engine key. Unknown words dropped. */
export function normalizeUsVerdictKeys(list: readonly string[] | null | undefined): UsVerdict[] {
  const out: UsVerdict[] = [];
  for (const v0 of list || []) {
    const v = String(v0 || '').trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const k: UsVerdict | null = v === 'STRONG BUY' || v === 'TOP SETUP' || v === 'STRONGBUY' ? 'STRONG BUY'
      : v === 'BUY' || v === 'GOOD SETUP' ? 'BUY'
      : v === 'WATCH' ? 'WATCH'
      : v === 'AVOID' || v === 'HIGH RISK' || v === 'SELL' ? 'AVOID' : null;
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** "now MIXED under current rules", or null. */
export function usNowTierText(e: Pick<UsConvictionEntry, 'now_tier' | 'tier'>): string | null {
  return e.now_tier ? `now ${e.now_tier} under current rules (was ${e.tier})` : null;
}

// ── engine re-sync (stale tiers) ───────────────────────────────────────────
/** At most this many names are re-graded per page open; each is asked at
 *  most this many times per engine version. Bounded by design. */
export const US_ENGINE_RESYNC_CAP = 100;
export const US_ENGINE_RESYNC_TRIES = 2;
export const US_ENGINE_RESYNC_BATCH = 25;

/** A live entry graded by an engine that is not the current one. */
export function usEngineStale(e: UsConvictionEntry, version: string = US_ENGINE_VERSION): boolean {
  const live = !String(e.bench_key || '').includes('@');
  return live && (e.engine_version || null) !== version;
}

/** The tickers to re-grade this time: stale, not yet given up on, newest first. */
export function usEngineResyncQueue(list: UsConvictionEntry[], version: string = US_ENGINE_VERSION, cap = US_ENGINE_RESYNC_CAP): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...list].sort((a, b) => String(b.filing_date || '').localeCompare(String(a.filing_date || '')))) {
    if (!usEngineStale(e, version)) continue;
    if (e.engine_check && e.engine_check.version === version && e.engine_check.attempts >= US_ENGINE_RESYNC_TRIES) continue;
    const t = String(e.ticker || '').toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** Names still on an older engine after a pass: one more attempt recorded. */
export function markUsEngineChecked(map: Record<string, UsConvictionEntry>, asked: string[], version: string = US_ENGINE_VERSION, at = new Date().toISOString()): Record<string, UsConvictionEntry> {
  const out = { ...map };
  for (const t0 of asked) {
    const t = String(t0).toUpperCase();
    const e = out[t];
    if (!e || e.engine_version === version) continue;
    const prev = e.engine_check && e.engine_check.version === version ? e.engine_check.attempts : 0;
    out[t] = { ...e, engine_check: { version, attempts: prev + 1, at } };
  }
  return out;
}

/** One re-grade pass over `rows` (graded-us rows for the asked tickers). */
export function applyUsEngineResync(map: Record<string, UsConvictionEntry>, asked: string[], rows: UsSyncEntry[], version: string = US_ENGINE_VERSION): {
  map: Record<string, UsConvictionEntry>; binned: UsConvictionEntry[]; regraded: string[]; nowMixed: string[]; unanswered: string[];
} {
  const r = syncUsConvictionMap(map, rows, version);
  const marked = markUsEngineChecked(r.map, asked, version);
  const regraded = asked.filter((t) => marked[t.toUpperCase()]?.engine_version === version);
  const unanswered = asked.filter((t) => marked[t.toUpperCase()] && marked[t.toUpperCase()].engine_version !== version);
  return { map: marked, binned: r.binned, regraded, nowMixed: r.nowMixed, unanswered };
}

/**
 * Browser: re-grade the stale part of the bench under the current engine —
 * `US_ENGINE_RESYNC_CAP` names at most, `US_ENGINE_RESYNC_BATCH` per request,
 * one request at a time. `fetchRows` must end (it is given a deadline).
 */
export async function resyncUsBenchToEngine(fetchRows: (tickers: string[]) => Promise<UsSyncEntry[] | null>, onProgress?: (done: number, total: number) => void): Promise<{
  asked: number; regraded: number; nowMixed: string[]; unanswered: number; failedBatches: number;
}> {
  const res = { asked: 0, regraded: 0, nowMixed: [] as string[], unanswered: 0, failedBatches: 0 };
  if (typeof window === 'undefined') return res;
  const queue = usEngineResyncQueue(getUsConvictionList());
  res.asked = queue.length;
  for (let i = 0; i < queue.length; i += US_ENGINE_RESYNC_BATCH) {
    const slice = queue.slice(i, i + US_ENGINE_RESYNC_BATCH);
    let rows: UsSyncEntry[] | null = null;
    try { rows = await fetchRows(slice); } catch { rows = null; }
    if (rows == null) res.failedBatches++;
    const r = applyUsEngineResync(readUsConviction(), slice, rows || []);
    if (r.binned.length) binPush(r.binned);
    writeUsConviction(r.map);
    emit();
    res.regraded += r.regraded.length;
    res.unanswered += r.unanswered.length;
    res.nowMixed.push(...r.nowMixed);
    onProgress?.(Math.min(queue.length, i + slice.length), queue.length);
  }
  return res;
}

// ── why names are hidden ───────────────────────────────────────────────────
const US_CRITERION_WORDS: Record<string, string> = {
  sales: 'Revenue growth', eps: 'EPS growth', pat: 'Net income growth', pead: 'Post-results drift',
  opmDelta: 'Operating margin widening', opmMin: 'Operating margin level', cfoPatMin: 'Cash conversion',
  mktCapMin: 'Market cap', cap: 'Size band', peMax: 'P/E ceiling', deMax: 'Debt / equity ceiling', score: 'Engine rank', opLev: 'Operating leverage',
  winMin: 'Winners scorecard', aboveMa50: 'Above 50-day average', aboveMa200: 'Above 200-day average',
  d1Bucket: 'Day-one move', driftBucket: 'Move since results', guidance: 'Guidance', guideBeatOnly: 'Beat own guide',
  marginSlopeUp: 'Margin still widening', shareShrinkOnly: 'Share count falling', thesis: 'Thesis check',
  tiers: 'Tier', verdicts: 'Quality read', elite: 'Elite', multibagger: 'Multibagger setup', rule40: 'Rule of 40',
  roce20: 'Return on capital', turnaround: 'Turnaround', compounder: 'Compounder', prelimOnly: 'Preliminary only',
  sector: 'Sector', quarter: 'Fiscal quarter', fy: 'Fiscal year', fromDate: 'Filed from', toDate: 'Filed to', q: 'Search text', newOnly: 'New only',
};
export function usCriterionWord(k: string): string { return US_CRITERION_WORDS[k] || k; }

export interface UsCbHiddenReport {
  /** Unique names on the list (archived quarters fold into their ticker). */
  total: number;
  /** Names shown: pass + not checked. */
  shown: number;
  hidden: Array<{ ticker: string; company: string; reasons: string[] }>;
  notChecked: Array<{ ticker: string; company: string; missing: string[] }>;
  byCriterion: Array<{ key: string; label: string; count: number; names: Array<{ ticker: string; text: string }> }>;
}

function activeKeys(f: UsConvFilters): string[] {
  return Object.keys(f).filter((k) => {
    const v: any = (f as any)[k];
    if (k === 'q') return !!v;
    return k === 'cap' ? !!v && v !== 'all' : Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' ? v : v != null && v !== '';
  });
}

/**
 * Per ticker the BEST of its entries (pass > not checked > fail — what the
 * Conviction Beats page shows), then: which criterion hides each hidden name,
 * with its failing figure against the threshold, and the "not checked" names
 * listed separately with the figure that is missing.
 */
export function usCbHiddenReport(list: UsConvictionEntry[], f: UsConvFilters, win?: NewWindow): UsCbHiddenReport {
  const RANK = { pass: 2, unknown: 1, fail: 0 } as const;
  const by = new Map<string, { e: UsConvictionEntry; c: CriteriaCheck }>();
  for (const e of list) {
    const t = String(e?.ticker || '').split('@')[0].toUpperCase();
    if (!t) continue;
    const c = usCbCriteriaCheck(e, f, win);
    const had = by.get(t);
    if (had && RANK[had.c.state] >= RANK[c.state]) continue;
    by.set(t, { e, c });
  }
  const keys = activeKeys(f);
  const hidden: UsCbHiddenReport['hidden'] = [];
  const notChecked: UsCbHiddenReport['notChecked'] = [];
  const crit = new Map<string, Array<{ ticker: string; text: string }>>();
  for (const t of Array.from(by.keys()).sort()) {
    const { e, c } = by.get(t)!;
    const company = e.company || t;
    if (c.state === 'unknown') { notChecked.push({ ticker: t, company, missing: c.missing }); continue; }
    if (c.state !== 'fail') continue;
    const reasons: string[] = [];
    for (const k of keys) {
      const probe = { ...US_FILTER_DEFAULT, [k]: (f as any)[k] } as UsConvFilters;
      if (passesUsConvictionFilter(e, probe, win)) continue;
      if (US_LENIENT.has(k) && usMissingFor(e, k).length) continue;   // not checked, not a miss
      const r = usCbFailReasons(e, probe, win);
      const text = r[0] === 'another active criterion' ? `${usCriterionWord(k)} not met` : r.join('; ');
      reasons.push(text);
      const arr = crit.get(k) || [];
      arr.push({ ticker: t, text });
      crit.set(k, arr);
    }
    const nt = usNowTierText(e);
    hidden.push({ ticker: t, company, reasons: [...(reasons.length ? reasons : c.failed), ...(nt ? [nt] : [])] });
  }
  const byCriterion = Array.from(crit.entries())
    .map(([key, names]) => ({ key, label: usCriterionWord(key), count: names.length, names }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: by.size, shown: by.size - hidden.length, hidden, notChecked, byCriterion };
}

/** Name-for-name: the Conviction Beats page's names against another view's. */
export function usCbReconcile(cbNames: Iterable<string>, viewNames: Iterable<string>, whyMissing: (t: string) => string, whyExtra: (t: string) => string = () => 'not on the Conviction Beats list under your criteria'): {
  onlyCb: Array<{ ticker: string; why: string }>; onlyView: Array<{ ticker: string; why: string }>; matches: boolean; line: string;
} {
  const a = new Set(Array.from(cbNames, (t) => String(t).toUpperCase()));
  const b = new Set(Array.from(viewNames, (t) => String(t).toUpperCase()));
  const onlyCb = Array.from(a).filter((t) => !b.has(t)).sort().map((t) => ({ ticker: t, why: whyMissing(t) }));
  const onlyView = Array.from(b).filter((t) => !a.has(t)).sort().map((t) => ({ ticker: t, why: whyExtra(t) }));
  const matches = !onlyCb.length && !onlyView.length;
  const line = matches
    ? `Reconciliation: all ${a.size} names match the US Conviction Beats page, name for name.`
    : `Reconciliation: ${[...onlyCb.map((x) => `${x.ticker} on Conviction Beats but not here (${x.why})`), ...onlyView.map((x) => `${x.ticker} here but not on Conviction Beats (${x.why})`)].join('; ')}.`;
  return { onlyCb, onlyView, matches, line };
}

// ── words, not 0–100 numbers, on screen and in exports (zzz828) ────────────
/** An engine 0–100 read as a word. */
export function usScoreWord(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'not known';
  return n >= 80 ? 'very strong' : n >= 65 ? 'strong' : n >= 50 ? 'fair' : 'weak';
}
/** Post-results drift reading as a word (same bands as the bench table). */
export function usPeadWord(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'not known';
  return n >= 70 ? 'strong' : n >= 50 ? 'moderate' : 'weak';
}
/** Relative strength (1–99) as a word. */
export function usRsWord(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'not known';
  return n >= 80 ? 'leading' : n >= 50 ? 'average' : 'lagging';
}
