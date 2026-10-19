// ═══════════════════════════════════════════════════════════════════════════
// zzz800 — loss-base growth, loss-narrowing turnarounds, the price-reaction
// floor, and the silent-drop fixes for recent listings.
//
// The motivating card: KABRAEXTRU Q1 FY27 — revenue ₹86.0 → ₹124 Cr (+45%),
// OPM −3.5% → +5.0%, net loss ₹7.61 → ₹1.74 Cr, D1 −6% after a +75% run.
// It was published "a mixed print (… PAT +77% YoY, EPS +77% YoY) with caveats:
// low quality + market rejected print". Every number in these fixtures is
// either that card's reported figure or a plainly synthetic control.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gradeIndiaRow, gradeIndiaRowExplained } from '../india-grade';
import {
  profitTrajectory, reactionFloor, decideTier, MARKET_REACTION_CAVEATS, caveatPenaltyFor,
} from '../earnings-grade-shared';
import { isAcceptableQuarter, previousQuarter, quarterEndDate } from '../earnings/quarter-window';
import { resolveTicker } from '../bse-nse-mapping';

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** A row as the graded route builds it. Filing dated today (IST) so no staleness guard applies. */
function row(over: Record<string, any>): any {
  return {
    symbol: 'TEST', company: 'Test Co Ltd', filing_date: istToday(), quarter: 'Q1 FY27',
    hub_quality: 'Great', market_cap_cr: 1500, adtv_cr: 5,
    rs_rating: 80, stage: 2, pct_from_52w_high: -5,
    ...over,
  };
}

const KABRA = row({
  symbol: 'KABRAEXTRU', company: 'Kabra Extrusion Technik Ltd',
  // What enrichment emits today: (curr − prev)/|prev| on a loss base.
  sales_yoy_pct: 44.2, pat_yoy_pct: 77.1, eps_yoy_pct: 77.1,
  sales_curr_cr: 124, sales_prev_cr: 86.0,
  pat_curr_cr: -1.74, pat_prev_cr: -7.61,
  eps_curr: -0.5, eps_prev: -2.18,
  opm_pct: 5.0, opm_prev_pct: -3.5,
  d1_pct: -6, gap_pct: -1, move_pct: 75, rs_rating: 97, stage: 2, pct_from_52w_high: -3,
});

describe('profitTrajectory — no growth % off a loss', () => {
  test('loss narrowed is described with both absolutes', () => {
    const t = profitTrajectory(-1.74, -7.61, 'cr')!;
    assert.equal(t.kind, 'loss narrowed');
    assert.equal(t.label, 'loss narrowed ₹7.61 Cr → ₹1.74 Cr');
    assert.equal(t.improving, true);
    assert.equal(t.lossReductionPct, 77);
  });
  test('turned profitable / swung to loss / loss widened', () => {
    assert.equal(profitTrajectory(5.2, -3, 'cr')!.kind, 'turned profitable');
    assert.equal(profitTrajectory(-2, 10, 'cr')!.kind, 'swung to loss');
    const w = profitTrajectory(-9, -4, 'cr')!;
    assert.equal(w.kind, 'loss widened');
    assert.equal(w.improving, false);
  });
  test('two profits → null (an ordinary YoY % is meaningful)', () => {
    assert.equal(profitTrajectory(12, 10, 'cr'), null);
    assert.equal(profitTrajectory(null, -3, 'cr'), null);
  });
});

describe('KABRAEXTRU — a loss-narrowing operating turnaround', () => {
  const g = gradeIndiaRow(KABRA);
  test('grades STRONG, not MIXED', () => {
    assert.ok(g);
    assert.equal(g.tier, 'STRONG');
    assert.ok(g.methodology_tags.includes('operating turnaround'));
  });
  test('refuses the +77% growth rate on a loss base', () => {
    assert.equal(g.net_profit_yoy_pct, null);
    assert.equal(g.eps_yoy_pct, null);
    assert.equal(g.pat_trajectory, 'loss narrowed ₹7.61 Cr → ₹1.74 Cr');
    assert.ok(!/\+77%/.test(g.narrative), g.narrative);
    assert.ok(g.narrative.includes('loss narrowed ₹7.61 Cr → ₹1.74 Cr'), g.narrative);
  });
  test('EPS-growth methods no longer fire off a loss (CANSLIM/SEPA/Bonde EP mean EPS growth)', () => {
    for (const m of ['sepa', 'canslim', 'bonde ep']) assert.ok(!g.methodology_tags.includes(m), m);
  });
  test('"still loss-making", not "low quality"', () => {
    assert.ok(!g.caveat_tags.includes('low quality'));
    assert.ok(g.caveat_tags.includes('still loss-making'));
    assert.ok(caveatPenaltyFor('still loss-making') < caveatPenaltyFor('low quality'));
  });
  test('the D1 reaction is a separate, labelled note — not a fundamental caveat', () => {
    // zzz819 — price is context: the reaction lives in market_context /
    // market_reaction, never in the caveat list, and never changes the grade.
    assert.ok(!g.caveat_tags.includes('market rejected print'));
    assert.ok(g.market_context.includes('market rejected print'));
    assert.ok(g.market_reaction);
    assert.equal(g.market_reaction.demoted_from, null);
    assert.match(g.market_reaction.note, /^The share price fell 6% the day after the results; that does not change the grade\./);   // zzz1150 plain words
    assert.ok(!/is a mixed print/.test(g.narrative));
    assert.match(g.narrative, /strong operating turnaround/);
    // "with caveat(s): …" must list only fundamental caveats
    const withCaveats = g.narrative.match(/with caveats?: ([^.]*)\./)?.[1] || '';
    for (const t of MARKET_REACTION_CAVEATS) assert.ok(!withCaveats.includes(t), withCaveats);
  });
});

describe('genuinely weak prints stay flagged', () => {
  test('a loss that WIDENED is still low quality and not STRONG', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 30, sales_curr_cr: 130, sales_prev_cr: 100,
      pat_curr_cr: -9, pat_prev_cr: -4, eps_curr: -2, eps_prev: -0.9,
      pat_yoy_pct: -125, eps_yoy_pct: -122, opm_pct: -4, opm_prev_pct: -1,
    }))!;
    assert.ok(g.caveat_tags.includes('low quality'));
    assert.notEqual(g.tier, 'STRONG');
    assert.notEqual(g.tier, 'BLOCKBUSTER');
    assert.equal(g.pat_trajectory, 'loss widened ₹4 Cr → ₹9 Cr');
  });
  test('loss narrowed but revenue FELL and margin contracted → no turnaround credit', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: -12, sales_curr_cr: 88, sales_prev_cr: 100,
      pat_curr_cr: -2, pat_prev_cr: -6, eps_curr: -0.4, eps_prev: -1.2,
      pat_yoy_pct: 66.7, eps_yoy_pct: 66.7, opm_pct: 2, opm_prev_pct: 4,
    }))!;
    // zzz819 — it was MIXED only because its Stage-2 chart lifted the blended
    // composite; on the filing alone (revenue −12%, still a loss, margin
    // down) it fails the bar.
    assert.ok(g.tier === 'MIXED' || g.tier === 'AVOID', g.tier);
    assert.ok(!g.methodology_tags.includes('operating turnaround'));
    assert.ok(g.caveat_tags.includes('segment mix shift'));
  });
  test('a profit that swung to a loss is low quality and described, not given a %', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: -5, sales_curr_cr: 95, sales_prev_cr: 100,
      pat_curr_cr: -3, pat_prev_cr: 8, eps_curr: -0.6, eps_prev: 1.6,
      pat_yoy_pct: -137.5, eps_yoy_pct: -137.5, opm_pct: 1, opm_prev_pct: 9,
    }))!;
    assert.ok(g.caveat_tags.includes('low quality'));
    assert.match(g.narrative, /swung to a loss/);
    assert.ok(g.tier === 'MIXED' || g.tier === 'AVOID');
  });
  test('turnaround credit needs the loss at least halved', () => {
    const g = gradeIndiaRow(row({
      ...KABRA, pat_curr_cr: -5.5, pat_prev_cr: -7.61, eps_curr: -1.6, eps_prev: -2.18,
      pat_yoy_pct: 27.7, eps_yoy_pct: 26.6,
    }))!;
    assert.ok(!g.methodology_tags.includes('operating turnaround'));
    assert.notEqual(g.tier, 'STRONG');
  });
});

describe('a Day-1 sell-off does not change the grade at all (zzz819 — price-free)', () => {
  const strongPrint = {
    sales_yoy_pct: 30, sales_curr_cr: 130, sales_prev_cr: 100,
    pat_yoy_pct: 40, pat_curr_cr: 14, pat_prev_cr: 10,
    eps_yoy_pct: 40, eps_curr: 2.8, eps_prev: 2.0,
    opm_pct: 16, opm_prev_pct: 14,
  };
  test('the same print with and without a −9% D1', () => {
    const calm = gradeIndiaRow(row({ ...strongPrint, d1_pct: 1 }))!;
    const sold = gradeIndiaRow(row({ ...strongPrint, d1_pct: -9 }))!;
    assert.ok(calm.tier === 'STRONG' || calm.tier === 'BLOCKBUSTER', calm.tier);
    assert.equal(sold.tier, calm.tier, `sold-off print was ${sold.tier}, calm was ${calm.tier}`);
    assert.ok(!sold.caveat_tags.includes('sold off post-results'));
    assert.ok(sold.market_context.includes('sold off post-results'));
    assert.ok(sold.market_reaction && /fell 9% the day after the results/.test(sold.market_reaction.note));   // zzz1150
    assert.ok(!/cost the top tier/.test(sold.narrative), sold.narrative);
  });
  // The shared helper is kept for older callers; the India grader no longer uses it.
  test('reactionFloor: may cost the top tier, never more', () => {
    assert.equal(reactionFloor('BLOCKBUSTER', 'MIXED'), 'STRONG');
    assert.equal(reactionFloor('BLOCKBUSTER', 'STRONG'), 'STRONG');
    assert.equal(reactionFloor('STRONG', 'MIXED'), 'STRONG');
    assert.equal(reactionFloor('MIXED', 'MIXED'), 'MIXED');
    assert.equal(reactionFloor('MIXED', 'AVOID'), 'MIXED');
    assert.equal(reactionFloor('AVOID', 'AVOID'), 'AVOID');
  });
});

describe('decideTier — the loss-turnaround path is opt-in and capped at STRONG', () => {
  const base = {
    composite: 60, broken: false, stillLossMaking: true, turnaroundBase: true,
    marginContracting: false, marginSevereContraction: false, caveatCount: 1, mCount: 0,
    stage: 2, salesY: 45, patY: null, epsY: null, opmExp: 8.5,
    cleanMag: false, exceptMag: false, megaMag: false, marginInflection: false, marginInflectionLoose: false,
    tier1MethodCount: 0, positiveGuidance: false, chartOk: true,
  };
  test('without the flag a still-loss row is MIXED (unchanged behaviour)', () => {
    assert.equal(decideTier(base).tier, 'MIXED');
  });
  test('with it, STRONG — and never BLOCKBUSTER even if a gate opened', () => {
    assert.equal(decideTier({ ...base, lossTurnaround: true }).tier, 'STRONG');
    assert.equal(decideTier({ ...base, lossTurnaround: true, megaMag: true, patY: 80, epsY: 80 }).tier, 'STRONG');
  });
  test('a stage-4 chart or too many caveats withholds it', () => {
    assert.equal(decideTier({ ...base, lossTurnaround: true, stage: 4 }).tier, 'MIXED');
    assert.equal(decideTier({ ...base, lossTurnaround: true, caveatCount: 3 }).tier, 'MIXED');
  });
});

describe('recent listings are not dropped', () => {
  const newListing = row({
    symbol: 'NEWIPO', company: 'New Listing Ltd', hub_quality: 'Confirmed',
    sales_curr_cr: 290, pat_curr_cr: 31, eps_curr: 4.1, opm_pct: 19,
    sales_prev_cr: null, pat_prev_cr: null, eps_prev: null,
    newly_listed: true, num_quarters: 3, stage: null, rs_rating: null,
  });
  test("a live-feed filing ('Confirmed') with no year-ago quarter is MIXED + flagged, not AVOID", () => {
    const g = gradeIndiaRow(newListing)!;
    assert.ok(g);
    assert.equal(g.tier, 'MIXED');
    assert.ok(g.caveat_tags.includes('newly listed'));
    assert.match(g.narrative, /Newly listed/);
  });
  test('a hub-Upcoming row whose fresh quarter is already on Screener is graded', () => {
    const d = new Date(Date.now() + 330 * 60_000); d.setUTCDate(d.getUTCDate() - 40);
    const g = gradeIndiaRowExplained({ ...newListing, hub_quality: 'Upcoming', latest_quarter_end_iso: d.toISOString().slice(0, 10) });
    assert.ok(g.card, String(g.dropReason));
  });
  test('an Upcoming row with no corroboration is dropped WITH a reason', () => {
    const g = gradeIndiaRowExplained({ ...newListing, hub_quality: 'Upcoming' });
    assert.equal(g.card, null);
    assert.match(String(g.dropReason), /Upcoming/);
  });
  test('a filing dated today in IST is never "in the future"', () => {
    const g = gradeIndiaRowExplained({ ...KABRA, filing_date: istToday() });
    assert.ok(g.card, String(g.dropReason));
  });
  test('a genuinely future filing says why it was dropped', () => {
    const g = gradeIndiaRowExplained({ ...KABRA, filing_date: '2099-01-01' });
    assert.equal(g.card, null);
    assert.match(String(g.dropReason), /future/);
  });
});

describe('results-quarter window (universe builder)', () => {
  test('previous quarter and quarter ends', () => {
    assert.equal(previousQuarter('Q1 FY27'), 'Q4 FY26');
    assert.equal(previousQuarter('Q3 FY27'), 'Q2 FY27');
    assert.equal(quarterEndDate('Q4 FY26')!.toISOString().slice(0, 10), '2026-03-31');
    assert.equal(quarterEndDate('Q1 FY27')!.toISOString().slice(0, 10), '2026-06-30');
  });
  test('the expected quarter is always accepted', () => {
    assert.ok(isAcceptableQuarter('Q1 FY27', 'Q1 FY27', new Date('2026-08-10T00:00:00Z')));
  });
  test('a new listing filing the previous quarter within 120 days is accepted', () => {
    assert.ok(isAcceptableQuarter('Q4 FY26', 'Q1 FY27', new Date('2026-07-14T00:00:00Z')));
  });
  test('an old or two-back quarter is still rejected', () => {
    assert.ok(!isAcceptableQuarter('Q4 FY26', 'Q1 FY27', new Date('2026-08-20T00:00:00Z')));  // 142 days
    assert.ok(!isAcceptableQuarter('Q3 FY26', 'Q1 FY27', new Date('2026-07-10T00:00:00Z')));
  });
});

describe('BSE → NSE mapping', () => {
  test('526612 is Blue Dart (a duplicate row had re-pointed it at Stylam)', () => {
    assert.equal(resolveTicker('526612').nseSymbol, 'BLUEDART');
  });
});
