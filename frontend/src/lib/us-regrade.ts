// ═══════════════════════════════════════════════════════════════════════════
// A RULES CHANGE IS NOT A DATA CHANGE — REGRADE CACHED DAYS IN-PROCESS. (zzz807)
//
// The zzz806 engine bump sent all sixty sessions of the owner's window back
// into the one-at-a-time SEC queue, oldest first. Every cached card stayed on
// screen with its OLD grade — R F Industries still BLOCKBUSTER — until its
// day's turn came, hours away. Nothing about the FILINGS had changed; only the
// rules had. Re-reading SEC to apply a new rule to numbers we already hold is
// the wrong tool.
//
// A graded row already carries every figure the grade reads (revenue, operating
// income, net income, EPS, cash flow, prior-year values, the adjusted basis and
// its beat, guidance, key metrics, price context). This module rebuilds the
// grade's input from the row — or uses the exact input the engine stored on the
// row since zzz807 (`grade_input`) — runs the SAME pure `gradeUsRow`, re-applies
// the route's post-grade steps (PRELIM cap, setup floor, guide-down, sentence),
// and returns the day under the current engine version. Milliseconds per day,
// no network.
// ═══════════════════════════════════════════════════════════════════════════

import {
  gradeUsRow, assignSetupScores, applySetupGates, composeUsNarrative, US_TIER_ORDER,
  type UsGradeInput, type UsGradedRow, type UsFundamentals, type EarningsTier,
} from './us-earnings-core';
import { US_ENGINE_VERSION } from './us-engine-version';

export const GRADE_INPUT_V = 1;

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const usd = (musd: unknown): number | null => { const v = n(musd); return v == null ? null : v * 1e6; };

/** Methodology / caveat tags the ROUTE adds after grading. A regrade keeps
 *  them, because the facts behind them (the release, the consensus, the
 *  PRELIM status) have not changed. */
const ROUTE_METHODS = new Set([
  'guidance raised', 'consensus beat', 'consensus not on a comparable basis', 'no analyst coverage',
  'quarter read from the release', 'balance sheet from the release',
]);
const ROUTE_CAVEAT = (t: string) =>
  t === 'guidance cut' || t === 'missed consensus' || t === 'prelim · 10-Q pending'
  || /^guides .* below this quarter$/.test(t);

/**
 * The grade's input, rebuilt from a graded row. Uses the exact stored input
 * when the row carries one (every row graded since zzz807), and otherwise
 * reconstructs it from the figures the card shows. Returns null when the row
 * carries no gradeable figures at all.
 */
export function gradeInputFromRow(r: any): UsGradeInput | null {
  if (!r || typeof r !== 'object' || !r.ticker) return null;
  const price: UsGradeInput['price'] = {
    price: n(r.price), d1_pct: n(r.d1_pct), gap_pct: n(r.gap_pct), move_pct: n(r.move_pct),
    pct_from_52w_high: n(r.pct_from_52w_high), pct_vs_ma50: n(r.pct_vs_ma50), pct_vs_ma200: n(r.pct_vs_ma200),
    stage: (n(r.stage) as any) ?? null, rs_rating: n(r.rs_rating), addv_musd: n(r.addv_musd), vol_ratio_20d: n(r.vol_ratio_20d),
  };
  const stored = r.grade_input;
  if (stored && stored.v === GRADE_INPUT_V && stored.fundamentals) {
    const { v: _v, ...rest } = stored;
    void _v;
    return { ...rest, price, close_30d: r.close_30d ?? rest.close_30d ?? null } as UsGradeInput;
  }

  // ── reconstruction for rows cached before zzz807 ──
  const cfo = usd(r.cfo_curr_musd);
  const fcf = usd(r.fcf_curr_musd);
  const fcfPrev = usd(r.fcf_prev_musd);
  const f: UsFundamentals = {
    q_end: r.period_end ?? null, q_end_prev: null, q_filed: null,
    revenue: usd(r.revenue_curr_musd), revenue_prev: usd(r.revenue_prev_musd),
    operating_income: usd(r.operating_income_curr_musd), operating_income_prev: usd(r.operating_income_prev_musd),
    net_income: usd(r.net_income_curr_musd), net_income_prev: usd(r.net_income_prev_musd),
    eps: n(r.eps_curr), eps_prev: n(r.eps_prev), eps_derived: !!r.eps_derived,
    eps_compare_blocked: !!r.eps_compare_blocked || undefined,
    cfo, cfo_prev: fcfPrev,
    // FCF = CFO − capex, so capex is what separates the two published figures.
    capex: (cfo != null && fcf != null) ? Math.max(0, cfo - fcf) : null,
    capex_prev: fcfPrev != null ? 0 : null,
    tags: r.tags_used || {},
    operating_income_basis: r.opm_basis,
    quarters_revenue: r.quarters_revenue ?? null, quarters_eps: r.quarters_eps ?? null, quarters_opm: r.quarters_opm ?? null,
    quarters_ends: r.quarters_ends,
  };
  const cav: string[] = Array.isArray(r.caveat_tags) ? r.caveat_tags : [];
  const vsStreetM = cav.map((t) => /^next-quarter guide (\d+)% below street$/.exec(t)).find(Boolean);
  const implied = cav.includes('guide implies a decline next quarter') ? -1
    : cav.includes('guide implies growth stops next quarter') ? 2 : null;
  const marginM = cav.map((t) => /^guides next quarter's margin ([\d.]+)pp below/.exec(t)).find(Boolean);
  const revSig = Array.isArray(r.signals) ? r.signals.find((s: any) => s?.label === 'Revenue' && s?.basis === 'est') : null;
  const vis = (Array.isArray(r.key_metrics) ? r.key_metrics : [])
    .filter((m: any) => ['backlog', 'rpo', 'crpo', 'arr', 'net_new_arr', 'bookings'].includes(String(m?.id)) && n(m?.yoy_pct) != null)
    .sort((a: any, b: any) => b.yoy_pct - a.yoy_pct)[0] || null;
  const est = n(r.eps_estimate);
  const surprisePct = r.eps_basis_note ? null : n(r.eps_surprise_pct);
  const shares = (n(r.market_cap_musd) != null && n(r.price)) ? (r.market_cap_musd * 1e6) / r.price : null;
  return {
    ticker: r.ticker, company: r.company, sector: r.sector ?? null,
    filing_date: r.filing_date, form: r.form, items: r.items, filing_url: r.filing_url,
    fundamentals: f, price,
    shares_outstanding: shares,
    positive_guidance: r.guidance === 'RAISED' && !vsStreetM,
    adj_eps: n(r.eps_adj_curr ?? r.eps_adj), adj_eps_prev: n(r.eps_adj_prev),
    prelim_surprise_pct: r.prelim ? surprisePct : null,
    fiscal_label: r.quarter ?? null, fiscal_year_own: n(r.fiscal_year),
    consensus_beat_pct: (est != null && est >= 0.10) ? surprisePct : null,
    consensus_beat_abs: r.eps_basis_note ? null : n(r.eps_surprise_abs),
    revenue_beat_pct: revSig ? n(revSig.surprise_pct) : null,
    close_30d: r.close_30d ?? null,
    guide_next_vs_street_pct: vsStreetM ? -Number(vsStreetM[1]) : null,
    guide_next_implied_growth_pct: implied,
    guide_next_margin_delta_pp: marginM ? -Number(marginM[1]) : null,
    one_offs: r.one_offs ?? null, adj_eps_ex_oneoff: n(r.eps_adj_ex_oneoff),
    one_off_total_per_share: n(r.one_off_total_per_share), abs_one_offs: r.abs_one_offs ?? null,
    cash_explained_by_working_capital: cav.includes('negative operating cash — the release attributes it to working capital'),
    visibility_growth_pct: vis ? vis.yoy_pct : null, visibility_label: vis ? (vis.label || vis.id) : null,
    is_financial: !!r.is_financial,
  };
}

/** The PRELIM sentence tail the route appends, recovered from an old row. */
function narrativeTail(r: any): string {
  if (typeof r.narrative_tail === 'string') return r.narrative_tail;
  const s = String(r.narrative || '');
  const i = s.indexOf(' Read from the earnings release');
  return i >= 0 ? s.slice(i) : '';
}

/** One row under the current rules. Returns the old row unchanged if it cannot be regraded. */
export function regradeRow(old: any): any {
  const input = gradeInputFromRow(old);
  if (!input) return old;
  const fresh = gradeUsRow(input) as any;
  if (!fresh) return old;
  const out: any = { ...old, ...fresh };
  // The quadrant was recomputed by the route with ROCE; keep that one.
  for (const k of ['quality_score', 'inflection_score', 'quadrant', 'quadrant_parts']) if (old[k] !== undefined) out[k] = old[k];
  out.methodology_tags = Array.from(new Set([...(fresh.methodology_tags || []), ...((old.methodology_tags || []) as string[]).filter((t) => ROUTE_METHODS.has(t))]));
  out.caveat_tags = Array.from(new Set([...(fresh.caveat_tags || []), ...((old.caveat_tags || []) as string[]).filter(ROUTE_CAVEAT)]));
  if (old.prelim && out.tier === 'BLOCKBUSTER') out.tier = 'STRONG';        // PRELIM never outranks a full grade
  out.narrative_tail = narrativeTail(old);
  delete out.setup_gate;
  return out;
}

/**
 * A whole cached day under the current engine: every row regraded, the
 * cohort-level setup floor and the guide-down cap re-applied, tiers regrouped,
 * the sentence rebuilt. Null when the payload is not a graded day.
 */
export function regradeDayPayload(p: any): any | null {
  if (!p || typeof p !== 'object' || !p.by_tier) return null;
  const rows: any[] = [];
  for (const t of US_TIER_ORDER) for (const r of (p.by_tier[t] || [])) rows.push(regradeRow(r));
  assignSetupScores(rows);
  applySetupGates(rows);
  for (const r of rows) {
    if (r.tier === 'BLOCKBUSTER' && (r.caveat_tags || []).some((t: string) => /^guides .* below this quarter$/.test(t))) r.tier = 'STRONG';
    if (r.narrative_stem) {
      r.narrative = composeUsNarrative(r.narrative_stem, r.caveat_tags || [], r.methodology_tags || [],
        r.tier, r.company || r.ticker, r.quarter, r.market_context || []) + (r.narrative_tail || '');
    }
  }
  const by_tier: Record<EarningsTier, UsGradedRow[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const r of rows) (by_tier[r.tier as EarningsTier] || by_tier.MIXED).push(r);
  for (const t of US_TIER_ORDER) {
    by_tier[t].sort((a: any, b: any) =>
      ((b.composite_score ?? 0) - (a.composite_score ?? 0)) || ((b.pead_score ?? 0) - (a.pead_score ?? 0))
      || String(b.filing_date).localeCompare(String(a.filing_date)));
  }
  const { _stale_engine: _s, ...rest } = p;
  void _s;
  return {
    ...rest,
    by_tier,
    candidates_total: rows.length,
    engine_version: US_ENGINE_VERSION,
    regraded_from: p.engine_version ?? null,
    regraded_at: new Date().toISOString(),
    // generated_at is KEPT: it is when the filings were read, which is what
    // decides whether a day is final. A regrade reads no filing.
  };
}

/** Is this cached day stale only in its RULES (so regradable in-process)? */
export function regradable(p: any): boolean {
  return !!p?.by_tier && p.engine_version !== US_ENGINE_VERSION;
}
