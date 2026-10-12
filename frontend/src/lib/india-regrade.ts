// ═══════════════════════════════════════════════════════════════════════════
// A RULES CHANGE IS NOT A DATA CHANGE — REGRADE STORED INDIA DAYS.  (zzz819)
//
// The India mirror of lib/us-regrade.ts (zzz807). Bumping the India engine
// (lib/graded-cache-key.ts) abandons every stored day on purpose, and until
// now the only way back was to re-enrich each company from Screener, one day
// at a time — the owner's 60-day window went back into the queue and sat
// labelled "graded under the previous rules" for hours. Nothing about the
// FILINGS had changed; only the rules had.
//
// Two ways back, both pure (no fetch, no KV — callers do the I/O):
//
//   1. STORED INPUT. Every card graded since zzz819 carries `grade_input`, the
//      exact fields the grader read. Feeding it back in reproduces the grade
//      under the new rules exactly.
//   2. CARD FIGURES (days stored by v20–v23, before `grade_input` existed).
//      The card shows every reported figure the grade reads — revenue, PAT,
//      EPS and their year-ago values, margins, cash conversion, market cap,
//      liquidity. Three filing facts are NOT on the card (the annual cash-flow
//      lines, the exceptional-item share, operating-profit growth); the flags
//      those produced ('ocf divergence', 'profit without operating cash',
//      'exceptional item', 'headline leans on a one-off', 'tax distortion')
//      are carried forward exactly as the original grade raised them. Nothing
//      is invented: a figure we do not hold is passed as absent, never guessed.
//      What a card cannot tell us is whether guidance was raised, so a
//      card-basis regrade treats guidance as unknown (it never counts as bad).
//
// A day is regraded whole or not at all: a half-regraded day would show some
// rows under new rules and some under old with nothing to tell them apart.
// A day that cannot be regraded keeps its "graded under the previous rules"
// label, exactly as before.
// ═══════════════════════════════════════════════════════════════════════════

import { gradeIndiaRow, INDIA_GRADE_INPUT_V } from './india-grade';
import { GRADED_CACHE_VERSION } from './graded-cache-key';

const TIERS = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const;
type Tier = typeof TIERS[number];

/** Engines whose CARDS carry every figure a card-basis regrade needs. */
export const INDIA_REGRADABLE_FROM: readonly string[] = ['v25', 'v24', 'v23', 'v22', 'v21', 'v20'];

/** Filing-derived flags a stored card holds but cannot re-derive. */
const CARRYABLE = [
  'ocf divergence', 'exceptional item', 'tax distortion',
  'profit without operating cash', 'headline leans on a one-off',
  'lender — operating cash flow is loan growth',
];

/** Cash flags that survive a regrade whose stored input predates same-FY cash. */
const CASH_CARRY = ['ocf divergence', 'profit without operating cash'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A card that never had year-ago figures — the preview / newly-listed path.
 *  Its tier comes from the hub's quality stamp, which zzz819 did not change. */
function isPreviewCard(c: any): boolean {
  const noYoy = c?.sales_yoy_pct == null && c?.net_profit_yoy_pct == null && c?.eps_yoy_pct == null;
  const lossBase = (num(c?.pat_prev_cr) ?? 0) < 0 || (num(c?.eps_prev) ?? 0) < 0;
  return noYoy && !lossBase && c?.pat_prev_cr == null && c?.sales_prev_cr == null && c?.eps_prev == null;
}

/**
 * The grader's input for a stored card. `basis` says where it came from.
 * Null when the card holds neither a stored input nor, for an allowed engine,
 * the figures to rebuild one.
 */
export function indiaInputFromCard(c: any, fromVersion: string | null):
  { row: any; basis: 'stored_input' | 'card' } | null {
  if (!c || typeof c !== 'object' || !c.ticker) return null;
  const gi = c.grade_input;
  if (gi && typeof gi === 'object' && gi.v === INDIA_GRADE_INPUT_V) {
    // zzz821 — an input stored before the cash fix has no fiscal-year label,
    // so its cash figures are now "unknown". The cash FLAGS the old grade
    // raised are still true (a ratio that was inflated 4× and STILL fell
    // below 0.6, or cash negative against a profit, is only worse at the
    // right scale), so they are carried rather than silently dropped.
    if (!gi.cash_fy) {
      const cav: string[] = Array.isArray(c.caveat_tags) ? c.caveat_tags.map(String) : [];
      const carried = Array.from(new Set([...(Array.isArray(gi._carried_caveats) ? gi._carried_caveats : []),
        ...CASH_CARRY.filter((t) => cav.includes(t))]));
      const gi2 = carried.length ? { ...gi, _carried_caveats: carried } : gi;
      return { row: { ...gi2, _regrade: true, _stored_input: gi2 }, basis: 'stored_input' };
    }
    return { row: { ...gi, _regrade: true, _stored_input: gi }, basis: 'stored_input' };
  }
  if (!fromVersion || !INDIA_REGRADABLE_FROM.includes(fromVersion)) return null;
  const cav: string[] = Array.isArray(c.caveat_tags) ? c.caveat_tags.map(String) : [];
  const carried = CARRYABLE.filter((t) => cav.includes(t));
  const meth: string[] = Array.isArray(c.methodology_tags) ? c.methodology_tags.map(String) : [];
  const row: any = {
    _regrade: true,
    symbol: c.ticker, company: c.company, sector: c.sector, filing_date: c.filing_date,
    quarter: c.quarter, market_cap_bucket: c.market_cap_bucket,
    // zzz826 — liquidity counts only with the days it covers (a v20–v25 card
    // never carries them, so its stored figure — possibly one day's turnover —
    // is unknown, not thin).
    market_cap_cr: num(c.market_cap_cr), adtv_cr: num(c.adtv_cr), adtv_days: num(c.adtv_days), pe: num(c.pe), current_price: num(c.price),
    sales_yoy_pct: num(c.sales_yoy_pct), pat_yoy_pct: num(c.net_profit_yoy_pct), eps_yoy_pct: num(c.eps_yoy_pct),
    sales_curr_cr: num(c.sales_curr_cr), sales_prev_cr: num(c.sales_prev_cr),
    pat_curr_cr: num(c.pat_curr_cr), pat_prev_cr: num(c.pat_prev_cr),
    eps_curr: num(c.eps_curr), eps_prev: num(c.eps_prev),
    opm_pct: num(c.opm_pct), opm_prev_pct: num(c.opm_prev_pct),
    ocf_to_pat_ratio: num(c.ocf_to_pat_ratio ?? c.cfo_to_pat_ratio),
    // zzz965 — the cash tile needs the year and the two annual figures too, or it reads '—'
    ocf_annual_cr: num(c.ocf_annual_cr), pat_annual_cr: num(c.pat_annual_cr),
    cash_fy: typeof c.cash_fy === 'string' ? c.cash_fy : null, cash_basis: typeof c.cash_basis === 'string' ? c.cash_basis : null,
    roce: num(c.roce),
    gap_pct: num(c.gap_pct), d1_pct: num(c.d1_pct), move_pct: num(c.move_pct),
    rs_rating: num(c.rs_rating), stage: num(c.stage), pct_from_52w_high: num(c.pct_from_52w_high),
    // A chart fact, recovered from the tag it produced; context only now.
    trend_template_passes: meth.includes('trend template'),
    quarters_sales: c.quarters_sales ?? null, quarters_eps: c.quarters_eps ?? null, quarters_pat: c.quarters_pat ?? null,
    source_url: c.filing_url, financials_source: c.source,
    industry: c.industry ?? null, broad_industry: c.broad_industry ?? null,
    _carried_caveats: carried,
    // zzz826 — a card does not hold the guidance evidence its grade used.
    // The tier that evidence produced is carried, so a missing figure can
    // block a promotion but never demote the stored grade (see india-grade).
    // Only when the old tier cannot have come from a chart method instead
    // (the price-free rules removed those; guidance was the other way in).
    _guidance_prior_tier: typeof c.tier === 'string' && !c._tier_unconfirmed
      && !meth.some((m) => /trend template|sepa|canslim/i.test(m)) ? c.tier : null,
  };
  if (carried.includes('headline leans on a one-off')) {
    // ≥ 50% of pre-tax profit capped at MIXED, 25–50% at STRONG. A stored
    // STRONG therefore means the milder case; anything lower is held at the
    // stricter cap rather than guessed upward.
    row._carried_oneoff_cap = c.tier === 'STRONG' ? 'STRONG' : 'MIXED';
  }
  return { row, basis: 'card' };
}

/** One card under the current rules, or null when it cannot be regraded. */
export function regradeIndiaCard(old: any, fromVersion: string | null): any | null {
  const inp = indiaInputFromCard(old, fromVersion);
  if (!inp) return null;
  const fresh = gradeIndiaRow(inp.row);
  if (!fresh) return null;
  const out: any = { ...old, ...fresh };
  // Keys the new grade no longer emits must not linger from the old card.
  if (fresh.tier_cap_reason == null) out.tier_cap_reason = null;
  if (!fresh._tier_unconfirmed) delete out._tier_unconfirmed;
  for (const k of ['growth_basis_note', 'figures_conflict', 'forensic_check', 'market_driven', 'problem_kinds', 'bb_gate_misses', 'cash_note', 'cash_basis', 'cash_fy']) if (!(k in fresh)) delete out[k];
  if (inp.basis === 'card') {
    // The drift score reads the volume ratio, which a card does not hold; the
    // stored score was computed from the real one, so it is kept.
    if (typeof old.pead_score === 'number') out.pead_score = old.pead_score;
    out.regrade_basis = 'card';
  } else {
    out.regrade_basis = 'stored_input';
  }
  return out;
}

function rowsOf(p: any): any[] {
  const out: any[] = [];
  for (const t of TIERS) for (const r of (p?.by_tier?.[t] || [])) out.push(r);
  return out;
}

/**
 * A whole stored day under the current rules. `fromVersion` is the engine
 * namespace it was read from ('v23' …). Null when the payload is not a graded
 * day, or when any graded row in it cannot be regraded.
 */
export function regradeIndiaDayPayload(p: any, fromVersion: string | null): any | null {
  if (!p || typeof p !== 'object' || !p.by_tier) return null;
  const rows = rowsOf(p);
  const next: any[] = [];
  for (const r of rows) {
    const re = regradeIndiaCard(r, fromVersion);
    if (re) { next.push(re); continue; }
    // A preview card's tier comes from the hub stamp, which did not change.
    if (isPreviewCard(r)) { next.push(r); continue; }
    return null;
  }
  const by_tier: Record<Tier, any[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const r of next) (by_tier[(TIERS as readonly string[]).includes(r.tier) ? (r.tier as Tier) : 'MIXED']).push(r);
  for (const t of TIERS) by_tier[t].sort((a, b) => (num(b.composite_score) ?? 0) - (num(a.composite_score) ?? 0));
  const { engine_stale: _a, engine_stale_key: _b, engine_current: _c, engine_stale_note: _d, _cache: _e, ...rest } = p;
  void _a; void _b; void _c; void _d; void _e;
  return {
    ...rest,
    by_tier,
    candidates_total: next.length,
    grade_engine: GRADED_CACHE_VERSION,
    regraded_from: fromVersion,
    regraded_at: new Date().toISOString(),
    // generated_at is KEPT: it is when the filings were read. A regrade reads none.
  };
}

/** The engine namespace in a graded key ("graded:v23:2026-09-01" → "v23"). */
export function versionOfGradedKey(key: string): string | null {
  const m = /^graded:(v\d+):/.exec(key);
  return m ? m[1] : null;
}

/**
 * For readers that fall back through legacy namespaces (bench, search, alerts,
 * book-watch): the payload they found, under the CURRENT rules when that is
 * possible. Returns the payload unchanged when it is already current or cannot
 * be regraded. In-memory only — the page's read path is what stores it.
 */
export function withCurrentIndiaRules(payload: any, key: string): any {
  const v = versionOfGradedKey(key);
  if (!payload?.by_tier || !v || v === GRADED_CACHE_VERSION) return payload;
  try { return regradeIndiaDayPayload(payload, v) ?? payload; } catch { return payload; }
}

/** Drop the stored grader input from a payload before sending it to a page. */
export function stripGradeInput(p: any): any {
  if (!p?.by_tier) return p;
  const by_tier: Record<string, any[]> = {};
  for (const t of Object.keys(p.by_tier)) {
    by_tier[t] = (Array.isArray(p.by_tier[t]) ? p.by_tier[t] : []).map((r: any) => {
      if (!r || typeof r !== 'object' || !('grade_input' in r)) return r;
      const { grade_input: _g, ...rest } = r; void _g; return rest;
    });
  }
  return { ...p, by_tier };
}
