// ═══════════════════════════════════════════════════════════════════════════
// zzz819 — the India BLOCKBUSTER confirmation gate, a price-free India grade,
// the quadrant label that read as a verdict, and the in-process regrade of
// stored days after the v23 → v24 bump.
//
// Every fixture is SYNTHETIC. The shapes are modelled on cards the owner saw
// on the live page (revenue +5% with profit +500% off a tiny base; revenue
// flat; a lender with operating cash −34× profit; a 2%-margin distributor with
// a cash divergence; a 5%-margin chemicals name), but no real figure and no
// ticker is used, and no rule reads a ticker.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gradeIndiaRow, indiaBlockbusterGate } from '../india-grade';
import { QUADRANT_META } from '../earnings-grade-shared';
import { GRADED_CACHE_VERSION, GRADED_CACHE_LEGACY, gradedKeyCandidates } from '../graded-cache-key';
import {
  regradeIndiaCard, regradeIndiaDayPayload, withCurrentIndiaRules, stripGradeInput, versionOfGradedKey,
} from '../india-regrade';

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** A row as the graded route builds it — neutral chart unless a test says otherwise. */
function row(over: Record<string, any>): any {
  return {
    symbol: 'SYNTH', company: 'Synthetic Industries Ltd', filing_date: istToday(), quarter: 'Q1 FY27',
    hub_quality: 'Great', market_cap_cr: 5000, adtv_cr: 10,
    rs_rating: 70, stage: 2, pct_from_52w_high: -8,
    ...over,
  };
}

/** A clean quarter every rule should call BLOCKBUSTER. */
const CLEAN = {
  sales_yoy_pct: 40, sales_curr_cr: 1400, sales_prev_cr: 1000,
  pat_yoy_pct: 120, pat_curr_cr: 110, pat_prev_cr: 50,
  eps_yoy_pct: 120, eps_curr: 11, eps_prev: 5,
  opm_pct: 22, opm_prev_pct: 18,
  ocf_to_pat_ratio: 1.1, ocf_annual_cr: 440, pat_annual_cr: 400,
};

const NO_SCORE_TEXT = /SCORE\s*\d|\bQ\d{1,3}\s*·\s*I\d{1,3}\b/;
const NO_TRADE_WORDS = /\b(BUY|SELL)\b/;

describe('the gate lets a genuinely clean quarter through', () => {
  const g = gradeIndiaRow(row(CLEAN))!;
  test('BLOCKBUSTER with no cap reason', () => {
    assert.equal(g.tier, 'BLOCKBUSTER');
    assert.equal(g.tier_cap_reason, null);
    assert.equal(g.bb_gate_misses, null);
  });
});

describe('BLOCKBUSTER on weak fundamentals is capped, with one plain reason', () => {
  test('revenue +5%, profit +500% off a tiny base → MIXED (both legs of growth are weak)', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 5, sales_curr_cr: 105, sales_prev_cr: 100,
      pat_yoy_pct: 500, pat_curr_cr: 3, pat_prev_cr: 0.5,
      eps_yoy_pct: 500, eps_curr: 0.3, eps_prev: 0.05,
      opm_pct: 11, opm_prev_pct: 9,
    }))!;
    assert.equal(g.tier, 'MIXED');
    assert.match(g.tier_cap_reason, /^Capped at MIXED: revenue grew only 5%/);
    assert.ok(g.bb_gate_misses.some((m: string) => /small year-ago profit/.test(m)), g.bb_gate_misses.join(' | '));
    // zzz821 — stated once, in tier_cap_reason; never repeated in the caveats or the summary.
    assert.ok(!g.caveat_tags.includes(g.tier_cap_reason));
    assert.ok(!g.narrative.includes('Capped at'));
  });
  test('revenue flat (−0%), profit +120% → MIXED, "revenue was flat"', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: -0.2, sales_curr_cr: 998, sales_prev_cr: 1000,
      pat_yoy_pct: 120, pat_curr_cr: 110, pat_prev_cr: 50, eps_yoy_pct: 120, eps_curr: 11, eps_prev: 5,
      opm_pct: 20, opm_prev_pct: 15,
    }))!;
    assert.equal(g.tier, 'MIXED');
    assert.match(g.tier_cap_reason, /^Capped at MIXED: revenue was flat/);
  });
  test('revenue +1% at a large company, profit +140% → MIXED', () => {
    const g = gradeIndiaRow(row({
      market_cap_cr: 60000,
      sales_yoy_pct: 1, sales_curr_cr: 25250, sales_prev_cr: 25000,
      pat_yoy_pct: 140, pat_curr_cr: 1200, pat_prev_cr: 500, eps_yoy_pct: 140, eps_curr: 2.9, eps_prev: 1.2,
      opm_pct: 12, opm_prev_pct: 10,
    }))!;
    assert.equal(g.tier, 'MIXED');
    assert.match(g.tier_cap_reason, /revenue grew only 1%/);
  });
  test('revenue +9%, profit +90% on a healthy margin → STRONG ("Capped at STRONG: revenue grew only 9%")', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 9, sales_curr_cr: 1090, sales_prev_cr: 1000,
      pat_yoy_pct: 90, pat_curr_cr: 95, pat_prev_cr: 50, eps_yoy_pct: 90, eps_curr: 9.5, eps_prev: 5,
      opm_pct: 16, opm_prev_pct: 14,
    }))!;
    assert.equal(g.tier, 'STRONG');
    assert.equal(g.tier_cap_reason, 'Capped at STRONG: revenue grew only 9%');
  });
  // zzz821 — a 2% operating margin is below the STRONG floor (5%), so this
  // is MIXED now; the cash figures carry no fiscal-year label, so cash is
  // unknown and is not named.
  test('a 2%-margin distributor → MIXED (below the STRONG margin floor)', () => {
    const g = gradeIndiaRow(row({
      company: 'Synthetic Distribution Ltd',
      sales_yoy_pct: 20, sales_curr_cr: 24000, sales_prev_cr: 20000,
      pat_yoy_pct: 90, pat_curr_cr: 380, pat_prev_cr: 200, eps_yoy_pct: 90, eps_curr: 4.9, eps_prev: 2.58,
      opm_pct: 2, opm_prev_pct: 1.8,
      ocf_to_pat_ratio: 0.3, ocf_annual_cr: 350, pat_annual_cr: 1200,
    }))!;
    assert.equal(g.tier, 'MIXED');
    const why = g.tier_cap_reason as string;
    assert.match(why, /thin operating margin \(2%\)/);
    assert.equal(g.ocf_to_pat_ratio, null);
  });
  test('a 5%-margin quarter the engine flagged (optical eps) → not BLOCKBUSTER', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 30, sales_curr_cr: 1300, sales_prev_cr: 1000,
      pat_yoy_pct: 200, pat_curr_cr: 60, pat_prev_cr: 20, eps_yoy_pct: 200, eps_curr: 6, eps_prev: 2,
      opm_pct: 6, opm_prev_pct: 5,
    }))!;
    assert.notEqual(g.tier, 'BLOCKBUSTER');
    assert.ok(g.caveat_tags.includes('optical eps'));
  });
});

describe('lenders: no operating-margin or cash test, but no pass on missing data', () => {
  test('a lender with revenue +4% and operating cash −34× profit → never BLOCKBUSTER', () => {
    const g = gradeIndiaRow(row({
      company: 'Synthetic Finance Ltd',
      sales_yoy_pct: 4, sales_curr_cr: 2600, sales_prev_cr: 2500,
      pat_yoy_pct: 125, pat_curr_cr: 450, pat_prev_cr: 200, eps_yoy_pct: 125, eps_curr: 5.3, eps_prev: 2.36,
      ocf_to_pat_ratio: -34, ocf_annual_cr: -6800, pat_annual_cr: 1500,
    }))!;
    assert.equal(g.tier, 'MIXED');
    assert.equal(g.cash_note, 'not meaningful for lenders');   // zzz821
  });
  test('unit: for a lender the gate judges growth, not cash (loan growth IS operating outflow)', () => {
    const r = indiaBlockbusterGate({
      salesY: 4, patY: 125, opmPct: null, opmPrevPct: null, salesCurCr: 2600, salesPrevCr: 2500,
      patCurCr: 450, patPrevCr: 200, epsPrev: 2.36, cfoToPat: -34, ocfAnnualCr: -6800, patAnnualCr: 1500,
      isLender: true, caveatTags: [],
    });
    assert.equal(r.tier, 'MIXED');
    assert.equal(r.reason, 'Capped at MIXED: revenue grew only 4%');
  });
  test('a bank with revenue +3% and a thin net margin → MIXED', () => {
    const g = gradeIndiaRow(row({
      company: 'Synthetic Bank Ltd',
      sales_yoy_pct: 3, sales_curr_cr: 30900, sales_prev_cr: 30000,
      pat_yoy_pct: 80, pat_curr_cr: 1800, pat_prev_cr: 1000, eps_yoy_pct: 80, eps_curr: 1.6, eps_prev: 0.9,
    }))!;
    assert.equal(g.tier, 'MIXED');
    assert.match(g.tier_cap_reason, /thin net margin for a lender/);
  });
  test('unit: a lender with no net-margin figures cannot confirm the top tier, but is held at STRONG, not lower', () => {
    const r = indiaBlockbusterGate({
      salesY: 30, patY: 60, opmPct: null, opmPrevPct: null, salesCurCr: null, salesPrevCr: null,
      patCurCr: null, patPrevCr: 100, epsPrev: 3, cfoToPat: null, ocfAnnualCr: null, patAnnualCr: null,
      isLender: true, caveatTags: [],
    });
    assert.equal(r.tier, 'STRONG');
    assert.match(r.reason!, /net margin not measurable/);
  });
});

describe('unknown is not negative', () => {
  test('no cash-flow figures at all → a clean quarter is still BLOCKBUSTER', () => {
    const { ocf_to_pat_ratio: _a, ocf_annual_cr: _b, pat_annual_cr: _c, ...noCash } = CLEAN;
    void _a; void _b; void _c;
    const g = gradeIndiaRow(row(noCash))!;
    assert.equal(g.tier, 'BLOCKBUSTER');
  });
  test('no operating margin → cannot confirm BLOCKBUSTER, held at STRONG (not MIXED)', () => {
    const { opm_pct: _a, opm_prev_pct: _b, ...noOpm } = CLEAN;
    void _a; void _b;
    const g = gradeIndiaRow(row(noOpm))!;
    assert.equal(g.tier, 'STRONG');
    assert.match(g.tier_cap_reason, /operating margin not reported/);
  });
  test('unit: any open quality flag blocks, and says which', () => {
    const r = indiaBlockbusterGate({
      salesY: 40, patY: 120, opmPct: 22, opmPrevPct: 18, salesCurCr: 1400, salesPrevCr: 1000,
      patCurCr: 110, patPrevCr: 50, epsPrev: 5, cfoToPat: 1.1, ocfAnnualCr: 440, patAnnualCr: 400,
      isLender: false, caveatTags: ['low quality'],
    });
    assert.equal(r.tier, 'STRONG');
    assert.equal(r.reason, 'Capped at STRONG: open flag: low quality');
  });
});

describe('price is context, never a grade input', () => {
  const calm = gradeIndiaRow(row(CLEAN))!;
  const ugly = gradeIndiaRow(row({
    ...CLEAN, stage: 4, rs_rating: 5, pct_from_52w_high: -45, d1_pct: -12, gap_pct: 4, adtv_cr: 0.4, adtv_days: 20,  // zzz826 — a real 20-day average
  }))!;
  test('a Stage-4, 45%-off-high, −12% D1, thin-float chart does not change the tier', () => {
    assert.equal(ugly.tier, calm.tier);
    assert.equal(ugly.tier, 'BLOCKBUSTER');
  });
  test('the chart no longer stamps "low quality"', () => {
    assert.ok(!ugly.caveat_tags.includes('low quality'));
  });
  test('the facts are still shown, as context', () => {
    for (const t of ['stage 4 downtrend', 'thin float', 'sold off post-results']) {
      assert.ok(ugly.market_context.includes(t), `${t} missing from ${ugly.market_context}`);
      assert.ok(!ugly.caveat_tags.includes(t), `${t} leaked into caveats`);
    }
    assert.match(ugly.narrative, /Share price \(not part of the grade\): chart in a downtrend \(stage 4\), few shares trade freely\./);   // zzz1150
    assert.match(ugly.market_reaction.note, /does not change the grade/);
    assert.ok(!/cost the top tier/.test(ugly.narrative));
  });
});

describe('text on the row: no scores, no trade words', () => {
  const rows = [
    gradeIndiaRow(row(CLEAN))!,
    gradeIndiaRow(row({ ...CLEAN, sales_yoy_pct: 9, sales_curr_cr: 1090 }))!,
    gradeIndiaRow(row({ ...CLEAN, stage: 4, d1_pct: -9 }))!,
  ];
  test('narrative / cap reason / reaction note carry no numeric score and no BUY/SELL', () => {
    for (const g of rows) {
      for (const s of [g.narrative, g.tier_cap_reason, g.market_reaction?.note].filter(Boolean)) {
        assert.ok(!NO_SCORE_TEXT.test(s), s);
        assert.ok(!NO_TRADE_WORDS.test(s), s);
      }
    }
  });
});

describe('the quadrant label no longer reads as a verdict', () => {
  test("'REJECT' key kept for stored rows; its label and tagline say what it measures", () => {
    const m = QUADRANT_META.REJECT;
    assert.notEqual(m.label, 'REJECT');
    assert.ok(!/reject/i.test(m.label));
    assert.match(m.tagline, /not a verdict/);
    assert.ok(!NO_TRADE_WORDS.test(m.label + ' ' + m.tagline));
  });
});

describe('v23 → v24 (now v25, zzz821), and stored days regrade in-process', () => {
  test('the key is current and v23 is still a legacy namespace', () => {
    assert.equal(GRADED_CACHE_VERSION, 'v26');   // zzz826
    assert.ok(GRADED_CACHE_LEGACY.includes('v23'));
    assert.deepEqual(gradedKeyCandidates('2026-09-01').slice(0, 3), ['graded:v26:2026-09-01', 'graded:v25:2026-09-01', 'graded:v24:2026-09-01']);
    assert.equal(versionOfGradedKey('graded:v23:2026-09-01'), 'v23');
  });

  test('every new card stores its own input, and regrading from it reproduces the grade', () => {
    const g = gradeIndiaRow(row({ ...CLEAN, sales_yoy_pct: 9, sales_curr_cr: 1090 }))!;
    assert.equal(g.grade_input.v, 1);
    assert.equal(g.grade_input.sales_yoy_pct, 9);
    const re = regradeIndiaCard(g, 'v24')!;
    assert.equal(re.regrade_basis, 'stored_input');
    assert.equal(re.tier, g.tier);
    assert.equal(re.tier_cap_reason, g.tier_cap_reason);
    assert.equal(re.narrative, g.narrative);
  });

  /** What a v23 day looked like: output only, price-demoted, no grade_input. */
  function v23Card(over: Record<string, any>, stored: Record<string, any>): any {
    const g = gradeIndiaRow(row(over))!;
    const { grade_input: _g, tier_cap_reason: _t, bb_gate_misses: _m, market_context: _c, ...card } = g;
    void _g; void _t; void _m; void _c;
    return { ...card, ...stored };
  }

  test('a v23 BLOCKBUSTER on revenue +9% is regraded from its card figures → STRONG with a reason', () => {
    const old = v23Card(
      { sales_yoy_pct: 9, sales_curr_cr: 1090, sales_prev_cr: 1000, pat_yoy_pct: 90, pat_curr_cr: 95, pat_prev_cr: 50,
        eps_yoy_pct: 90, eps_curr: 9.5, eps_prev: 5, opm_pct: 16, opm_prev_pct: 14 },
      { tier: 'BLOCKBUSTER', filing_date: '2026-08-20', filing_time_iso: '2026-08-20T15:31:00+05:30' },
    );
    const re = regradeIndiaCard(old, 'v23')!;
    assert.equal(re.regrade_basis, 'card');
    assert.equal(re.tier, 'STRONG');
    assert.equal(re.tier_cap_reason, 'Capped at STRONG: revenue grew only 9%');
    // Route-added fields survive; the stored filing date is not re-guarded.
    assert.equal(re.filing_time_iso, '2026-08-20T15:31:00+05:30');
    assert.equal(re.filing_date, '2026-08-20');
  });

  test('a v23 STRONG that the price had demoted from BLOCKBUSTER is restored — the tape no longer grades', () => {
    const old = v23Card({ ...CLEAN, d1_pct: -5 }, {
      tier: 'STRONG', caveat_tags: ['market rejected print'],
    });
    const re = regradeIndiaCard(old, 'v23')!;
    assert.equal(re.tier, 'BLOCKBUSTER');
    assert.ok(!re.caveat_tags.includes('market rejected print'));
  });

  test('filing flags a card cannot re-derive are carried, never dropped', () => {
    // Annual cash flow is not on a card; the flag it raised is.
    const old = v23Card(CLEAN, {
      tier: 'MIXED', caveat_tags: ['profit without operating cash'],
      ocf_to_pat_ratio: null, cfo_to_pat_ratio: null,
    });
    const re = regradeIndiaCard(old, 'v23')!;
    assert.notEqual(re.tier, 'BLOCKBUSTER');
    assert.ok(re.caveat_tags.includes('profit without operating cash'));
    // …and they travel into the stored input for the next regrade.
    assert.deepEqual(re.grade_input._carried_caveats, ['profit without operating cash']);
    const again = regradeIndiaCard(re, 'v24')!;
    assert.equal(again.tier, re.tier);
  });

  test('a whole day regrades, regroups by tier and is stamped with the engine', () => {
    const a = v23Card(CLEAN, { tier: 'STRONG', ticker: 'AAA' });
    const b = v23Card({ ...CLEAN, sales_yoy_pct: 5, sales_curr_cr: 1050 }, { tier: 'BLOCKBUSTER', ticker: 'BBB' });
    const day = { filing_date: '2026-08-20', generated_at: '2026-08-20T18:00:00Z',
      by_tier: { BLOCKBUSTER: [b], STRONG: [a], MIXED: [], AVOID: [] }, engine_stale: true };
    const re = regradeIndiaDayPayload(day, 'v23')!;
    assert.ok(re);
    assert.equal(re.grade_engine, 'v26');
    assert.equal(re.regraded_from, 'v23');
    assert.equal(re.generated_at, '2026-08-20T18:00:00Z');
    assert.equal(re.engine_stale, undefined);
    assert.deepEqual(re.by_tier.BLOCKBUSTER.map((r: any) => r.ticker), ['AAA']);
    assert.ok(!re.by_tier.BLOCKBUSTER.some((r: any) => r.ticker === 'BBB'));
    // withCurrentIndiaRules does the same from a key, and leaves a current day alone.
    assert.equal(withCurrentIndiaRules(day, 'graded:v23:2026-08-20').grade_engine, 'v26');
    assert.equal(withCurrentIndiaRules(re, 'graded:v26:2026-08-20'), re);
    // The page never gets the stored input.
    const stripped = stripGradeInput(re);
    assert.ok(stripped.by_tier.BLOCKBUSTER.every((r: any) => !('grade_input' in r)));
  });

  test('a day too old to regrade from its card stays as it was (keeps its "previous rules" label)', () => {
    const old = v23Card(CLEAN, { tier: 'BLOCKBUSTER' });
    const day = { by_tier: { BLOCKBUSTER: [old], STRONG: [], MIXED: [], AVOID: [] } };
    assert.equal(regradeIndiaDayPayload(day, 'v19'), null);
    assert.equal(withCurrentIndiaRules(day, 'graded:v19:2026-06-01'), day);
  });

  test('preview (no year-ago) cards ride along unchanged', () => {
    const preview = { ticker: 'NEW', company: 'New Listing Ltd', tier: 'MIXED', composite_score: 58,
      sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
      sales_prev_cr: null, pat_prev_cr: null, eps_prev: null, sales_curr_cr: 290, caveat_tags: ['newly listed'] };
    const re = regradeIndiaDayPayload({ by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [preview], AVOID: [] } }, 'v23')!;
    assert.ok(re);
    assert.deepEqual(re.by_tier.MIXED[0], preview);
  });
});
