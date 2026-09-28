// ═══════════════════════════════════════════════════════════════════════════
// THE QUALITY PRESET, WHERE THE SERVER CAN REACH IT.               (zzz675)
//
// The India preset was a constant inside the Conviction Beats PAGE, which is a
// client component. That was fine while the only thing that needed to know
// what "preset-passing" means was the browser rendering a chip.
//
// It stopped being fine the moment the answer had to be delivered somewhere
// the browser is not: an alert that has to fire while nobody has the tab open.
// A preset defined in a React component cannot be evaluated by a cron, so the
// alternative was to write the thresholds out a fourth time inside the alert
// path — and this codebase has a long, expensive history of exactly that (see
// the header of graded-cache-key.ts, and zzz672, where the applier and the
// detector of THIS preset disagreed for weeks and the chip simply never lit).
//
// So it lives here, in a pure module both sides import. The page applies it;
// the alert path tests rows against it; neither can drift from the other.
//
// PURE: no React, no fetch, no KV, no process.env.
// ═══════════════════════════════════════════════════════════════════════════

export const INDIA_PRESET = {
  sales: 20,
  eps: 25,
  pead: 40,        // zzz659 — was 60. PEAD is a drift proxy, not a quality score.
  opmDelta: 0,
  cfoPatMin: 0.5,
  mktCapMin: 3000, // ₹ Cr
  pledgedMax: 0,   // zzz360 — a null pledge passes; this gates KNOWN pledges.
  verdicts: ['STRONG BUY', 'BUY', 'WATCH'] as string[],
};

/**
 * Does one graded India row pass the preset?
 *
 * ABSENT DATA PASSES, DELIBERATELY. A null is not a failure — it is the
 * absence of evidence, and treating it as a failure would silently drop every
 * company whose cash-flow line or pledge disclosure has not been parsed yet.
 * That is the opposite of what an alert is for: the whole point is to surface
 * a name the moment its filing lands, when enrichment is at its thinnest.
 *
 * The two gates that do NOT get this latitude are market cap and the verdict,
 * because both are present on essentially every row — so a null there means
 * something is wrong with the row, not with the disclosure.
 */
export function passesIndiaPreset(r: any): boolean {
  return indiaPresetCheck(r).pass;
}

/**
 * zzz811 — the same preset, with the REASONS it failed, in plain words.
 * passesIndiaPreset is this function's `pass`, so the label on a Portfolio
 * Catalysts bench card and the alert path can never disagree. Every gate
 * that fails is listed (not just the first), so the card can say why.
 * No row at all is `pass: false` with the reason "no graded row" — callers
 * that need "unknown ≠ fail" test for a row first (see presetLabelIndia).
 */
export function indiaPresetCheck(r: any): { pass: boolean; reasons: string[] } {
  if (!r) return { pass: false, reasons: ['no graded row'] };
  const reasons: string[] = [];
  const fmt = (n: number) => `${Math.round(n * 10) / 10}`;

  const mcap = typeof r.market_cap_cr === 'number' ? r.market_cap_cr : null;
  if (mcap == null) reasons.push('market cap not known');
  else if (mcap < INDIA_PRESET.mktCapMin) reasons.push(`market cap \u20B9${fmt(mcap)} Cr is below \u20B9${INDIA_PRESET.mktCapMin} Cr`);

  const sales = r.sales_yoy_pct;
  if (typeof sales === 'number' && sales < INDIA_PRESET.sales) reasons.push(`sales growth ${fmt(sales)}% is below ${INDIA_PRESET.sales}%`);

  const eps = r.eps_yoy_pct;
  if (typeof eps === 'number' && eps < INDIA_PRESET.eps) reasons.push(`EPS growth ${fmt(eps)}% is below ${INDIA_PRESET.eps}%`);

  const pead = r.pead_score;
  if (typeof pead === 'number' && pead < INDIA_PRESET.pead) reasons.push('post-results drift reading below the preset');

  // Operating-margin direction, expressed the way the grader expresses it.
  if (typeof r.opm_pct === 'number' && typeof r.opm_prev_pct === 'number') {
    const d = r.opm_pct - r.opm_prev_pct;
    if (d < INDIA_PRESET.opmDelta) reasons.push(`operating margin fell ${fmt(Math.abs(d))} points`);
  }

  const cfo = r.cfo_to_pat_ratio;
  if (typeof cfo === 'number' && cfo < INDIA_PRESET.cfoPatMin) reasons.push(`cash from operations is ${fmt(cfo)}x profit (needs ${INDIA_PRESET.cfoPatMin}x)`);

  // Pledge: only a KNOWN pledge above the ceiling fails. Null passes.
  const pl = r.pledged_pct;
  if (typeof pl === 'number' && pl > INDIA_PRESET.pledgedMax) reasons.push(`promoter pledge ${fmt(pl)}%`);

  const v = r.verdict ?? r.tier_verdict ?? null;
  if (typeof v === 'string' && !INDIA_PRESET.verdicts.includes(v.toUpperCase())) reasons.push('grader verdict is outside the preset');

  return { pass: reasons.length === 0, reasons };
}

/** The tiers an alert is allowed to carry. Nothing below STRONG is worth a
 *  push — the whole value of an alert is that it is rare enough to read. */
export const ALERTABLE_TIERS = new Set(['BLOCKBUSTER', 'STRONG']);

export function isAlertable(r: any): boolean {
  return !!r && ALERTABLE_TIERS.has(String(r.tier || '').toUpperCase()) && passesIndiaPreset(r);
}
