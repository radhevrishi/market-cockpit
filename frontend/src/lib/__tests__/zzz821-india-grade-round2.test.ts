// ═══════════════════════════════════════════════════════════════════════════
// zzz821 — India grading, round 2. Every figure is SYNTHETIC; shapes follow
// cards the owner flagged on the live 60-day page. No rule reads a ticker.
//
//   E1 cash = same-fiscal-year CFO ÷ PAT, or unknown
//   E2 a first profit after a loss is not BLOCKBUSTER
//   E3 investment / trading companies are not BLOCKBUSTER
//   E4 the F ("profit jump · forensics") check runs on India data
//   E5 problems counted by kind; two or more → MIXED
//   E6 the STRONG floor; PAT vs EPS disagreement
//   E7 one financial-company detection for engine and card
//   E8 the cap reason is stated once
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  gradeIndiaRow, indiaCashView, indiaFinancialKind, marketDrivenKind, indiaForensicCheck,
  indiaStrongFloor, indiaBlockbusterGate, type IndiaStrongFloorInput,
} from '../india-grade';
import { sameFyCash } from '../india-cash';
import { financialKind } from '../india-eo-card-data';
import { regradeIndiaCard } from '../india-regrade';
import { GRADED_CACHE_VERSION, GRADED_CACHE_LEGACY } from '../graded-cache-key';

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
function row(over: Record<string, any>): any {
  return {
    symbol: 'SYNTH', company: 'Synthetic Industries Ltd', filing_date: istToday(), quarter: 'Q1 FY27',
    hub_quality: 'Great', market_cap_cr: 5000, adtv_cr: 10, rs_rating: 70, stage: 2, pct_from_52w_high: -8,
    ...over,
  };
}
const CLEAN = {
  sales_yoy_pct: 40, sales_curr_cr: 1400, sales_prev_cr: 1000,
  pat_yoy_pct: 120, pat_curr_cr: 110, pat_prev_cr: 50,
  eps_yoy_pct: 120, eps_curr: 11, eps_prev: 5,
  opm_pct: 22, opm_prev_pct: 18,
};
const CASH_OK = { cash_fy: 'Mar 2026', cash_basis: 'FY26 full year', ocf_annual_cr: 440, pat_annual_cr: 400, ocf_to_pat_ratio: 1.1 };

describe('E1 — cash is same-fiscal-year CFO ÷ PAT, or unknown', () => {
  const t = (labels: string[], rows: Record<string, (number | null)[]>) => ({ labels, rows });
  test('sameFyCash pairs columns by fiscal-year LABEL, skipping the P&L TTM column', () => {
    const cf = t(['Mar 2024', 'Mar 2025', 'Mar 2026'], { 'Cash from Operating Activity +': [47, 11, 300] });
    const pl = t(['Mar 2024', 'Mar 2025', 'Mar 2026', 'TTM'], { 'Sales +': [400, 406, 3560, 3920], 'Net Profit +': [43, 38, 250, 140] });
    const r = sameFyCash(cf, pl);
    assert.equal(r.cash_fy, 'Mar 2026');
    assert.equal(r.cash_basis, 'FY26 full year');
    assert.equal(r.pat_annual_cr, 250);           // the FY26 column, not TTM and never a quarter
    assert.equal(r.ocf_to_pat_ratio, 1.2);
  });
  test('a latest-year CFO of exactly 0 (Screener "no figure") is unknown, not 0.00x', () => {
    const cf = t(['Mar 2025', 'Mar 2026'], { 'Cash from Operating Activity +': [-19, 0] });
    const pl = t(['Mar 2025', 'Mar 2026', 'TTM'], { 'Net Profit +': [10, 13, 2] });
    const r = sameFyCash(cf, pl);
    assert.equal(r.ocf_to_pat_ratio, null);
    assert.equal(r.cash_fy, null);
  });
  test('the grader ignores a ratio that carries no fiscal year (annual CFO ÷ one quarter)', () => {
    const g = gradeIndiaRow(row({ ...CLEAN, ocf_annual_cr: 616, pat_annual_cr: 24, ocf_to_pat_ratio: 25.7 }))!;
    assert.equal(g.ocf_to_pat_ratio, null);
    assert.equal(g.cash_basis, null);
  });
  test('…and a ratio that disagrees with its own two figures', () => {
    const v = indiaCashView({ cash_fy: 'Mar 2026', ocf_annual_cr: 616, pat_annual_cr: 71, ocf_to_pat_ratio: 25.7, company: 'X Ltd' });
    assert.equal(v.ratio, null);
    assert.equal(v.ocf, 616);
  });
  test('a same-year ratio is shown with its year and drives the cash test', () => {
    const good = gradeIndiaRow(row({ ...CLEAN, ...CASH_OK }))!;
    assert.equal(good.ocf_to_pat_ratio, 1.1);
    assert.equal(good.cash_basis, 'FY26 full year');
    assert.equal(good.tier, 'BLOCKBUSTER');
    const weak = gradeIndiaRow(row({ ...CLEAN, ...CASH_OK, ocf_annual_cr: 160, ocf_to_pat_ratio: 0.4 }))!;
    assert.notEqual(weak.tier, 'BLOCKBUSTER');
    assert.match(weak.tier_cap_reason, /cash does not back the profit \(operating cash 0\.4× profit\)/);
  });
  test('lenders: not meaningful, skipped, and said so', () => {
    const g = gradeIndiaRow(row({ ...CLEAN, company: 'Synthetic Finance Ltd', ...CASH_OK, ocf_annual_cr: -6800, ocf_to_pat_ratio: null }))!;
    assert.equal(g.ocf_to_pat_ratio, null);
    assert.equal(g.cash_note, 'not meaningful for lenders');
    assert.ok(!/cash/.test(String(g.tier_cap_reason || '')), String(g.tier_cap_reason));
  });
});

describe('E2 — a first profit after a loss needs another quarter', () => {
  test('Path-F turnaround (loss → profit, revenue +40%, margin +12 pts) is capped at STRONG', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 40, sales_curr_cr: 1400, sales_prev_cr: 1000,
      pat_curr_cr: 110, pat_prev_cr: -20, eps_curr: 11, eps_prev: -2, pat_yoy_pct: 650, eps_yoy_pct: 650,
      opm_pct: 22, opm_prev_pct: 10,
    }))!;
    assert.equal(g.tier, 'STRONG');
    assert.equal(g.tier_cap_reason, 'Capped at STRONG: first profit after a loss — needs another quarter to confirm');
  });
});

describe('E3 — market-driven earners (investment / trading) stop at STRONG', () => {
  test('detected from industry text or registered name — never a ticker', () => {
    assert.equal(marketDrivenKind({ industry: 'Investment Company', company: 'Alpha Holdings Ltd' }), 'investment company');
    assert.equal(marketDrivenKind({ industry: 'Stockbroking & Allied', company: 'Beta Ltd' }), 'broking / trading');
    assert.equal(marketDrivenKind({ company: 'Gamma Algotech Ltd' }), 'algorithmic trading');
    assert.equal(marketDrivenKind({ company: 'Delta Investments Ltd' }), 'investment company');
    assert.equal(marketDrivenKind({ company: 'Epsilon Investment and Finance Ltd', industry: 'Non Banking Financial Company (NBFC)' }), null);
    assert.equal(marketDrivenKind({ company: 'Zeta Pumps Ltd', industry: 'Pumps' }), null);
  });
  test('a clean-looking quarter from an investment company is STRONG with a plain reason', () => {
    const g = gradeIndiaRow(row({ ...CLEAN, ...CASH_OK, company: 'Delta Investments Ltd' }))!;
    assert.equal(g.tier, 'STRONG');
    assert.match(g.tier_cap_reason, /market-driven earnings \(investment company\)/);
    assert.equal(g.market_driven, 'investment company');
  });
});

describe('E4 — the F forensic check runs on India figures', () => {
  test('fires only on the F shape (EPS > 100% and > 3× revenue growth)', () => {
    assert.equal(indiaForensicCheck({ salesY: 40, epsY: 120, patY: 120, opmPct: 22, opmPrevPct: 18, cfoToPat: 1, isFinancial: false }), null);
  });
  test('explained by the margin and backed by same-year cash → passed → BLOCKBUSTER allowed', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 30, sales_curr_cr: 1300, sales_prev_cr: 1000,
      pat_yoy_pct: 120, pat_curr_cr: 110, pat_prev_cr: 50, eps_yoy_pct: 120, eps_curr: 11, eps_prev: 5,
      opm_pct: 25, opm_prev_pct: 10, ...CASH_OK,
    }))!;
    assert.equal(g.forensic_check.status, 'passed');
    assert.equal(g.tier, 'BLOCKBUSTER');
  });
  test('same quarter without same-year cash → unverified → held at STRONG, reason says why', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 30, sales_curr_cr: 1300, sales_prev_cr: 1000,
      pat_yoy_pct: 120, pat_curr_cr: 110, pat_prev_cr: 50, eps_yoy_pct: 120, eps_curr: 11, eps_prev: 5,
      opm_pct: 25, opm_prev_pct: 10,
    }))!;
    assert.equal(g.forensic_check.status, 'unverified');
    assert.equal(g.tier, 'STRONG');
    assert.match(g.tier_cap_reason, /forensic check not yet possible/);
  });
  test('a jump the margin cannot explain → not_passed (a growth-quality problem)', () => {
    const f = indiaForensicCheck({ salesY: 20, epsY: 200, patY: 200, opmPct: 12, opmPrevPct: 11, cfoToPat: 1.2, isFinancial: false })!;
    assert.equal(f.status, 'not_passed');
  });
});

const base: IndiaStrongFloorInput = {
  salesY: 20, patY: 30, epsY: 30, opmPct: 15, opmPrevPct: 13,
  salesCurCr: 1200, salesPrevCr: 1000, patCurCr: 130, patPrevCr: 100, epsPrev: 10,
  cfoToPat: null, ocfAnnualCr: null, patAnnualCr: null,
  isLender: false, caveatTags: [],
};

describe('E5 — problems counted by kind; two or more → MIXED', () => {
  test('one problem (thin margin) keeps STRONG; thin margin + weak cash → MIXED', () => {
    assert.equal(indiaStrongFloor({ ...base, opmPct: 8, opmPrevPct: 7 }).tier, 'STRONG');
    const two = indiaStrongFloor({ ...base, opmPct: 8, opmPrevPct: 7, cfoToPat: 0.3, ocfAnnualCr: 30, patAnnualCr: 100 });
    assert.equal(two.tier, 'MIXED');
    assert.deepEqual(two.problems.sort(), ['cash', 'thin margin']);
    assert.match(two.misses.join(' '), /2 separate problems/);
  });
  test('a BLOCKBUSTER candidate with three kinds of problem is MIXED, not STRONG', () => {
    const g = indiaBlockbusterGate({ ...base, salesY: 20, opmPct: 8, opmPrevPct: 7, cfoToPat: 0.3, ocfAnnualCr: 30, patAnnualCr: 100, caveatTags: ['tax distortion'] });
    assert.equal(g.tier, 'MIXED');
    assert.equal(g.problems.length, 3);
  });
  test('small-base wording names the figure and its share of sales', () => {
    const g = indiaBlockbusterGate({ ...base, salesY: 20, patPrevCr: 13, salesPrevCr: 800, opmPct: 15, opmPrevPct: 14 });
    assert.match(g.reason!, /small year-ago profit \(₹13 Cr, 1\.6% of sales\)/);
    assert.ok(!/tiny/.test(g.reason!));
  });
});

describe('E6 — the STRONG floor', () => {
  test('(a) negative operating margin', () => {
    assert.match(indiaStrongFloor({ ...base, opmPct: -35.6, opmPrevPct: -30 }).misses.join(), /operating margin is negative \(-35\.6%\)/);
  });
  test('(b) falling profit', () => {
    const r = indiaStrongFloor({ ...base, patY: -66 });
    assert.equal(r.tier, 'MIXED');
    assert.match(r.misses.join(), /profit fell 66% year on year/);
  });
  test('(c) a loss large against revenue', () => {
    const r = indiaStrongFloor({ ...base, patY: null, patCurCr: -59, salesCurCr: 24 });
    assert.match(r.misses.join(), /a loss of ₹59 Cr on ₹24 Cr of revenue/);
  });
  test('(e) operating margin under 5%', () => {
    assert.match(indiaStrongFloor({ ...base, opmPct: 1.6, opmPrevPct: 1.5 }).misses.join(), /very thin operating margin \(1\.6%\)/);
  });
  test('(f) revenue under +10% needs OPM ≥ 10% AND a 2-pt step-up', () => {
    assert.equal(indiaStrongFloor({ ...base, salesY: 5, opmPct: 14, opmPrevPct: 13.5 }).tier, 'MIXED');
    assert.equal(indiaStrongFloor({ ...base, salesY: 8, opmPct: 9, opmPrevPct: 6 }).tier, 'MIXED');
    assert.equal(indiaStrongFloor({ ...base, salesY: 8, opmPct: 16, opmPrevPct: 13 }).tier, 'STRONG');
  });
  test('unknown figures never demote', () => {
    assert.equal(indiaStrongFloor({ ...base, opmPct: null, opmPrevPct: null, salesY: 6, patY: null }).tier, 'STRONG');
  });
  test('an OPM of 1.6% cannot be graded STRONG or better', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 20, sales_curr_cr: 1200, sales_prev_cr: 1000,
      pat_yoy_pct: 60, pat_curr_cr: 16, pat_prev_cr: 10, eps_yoy_pct: 60, eps_curr: 1.6, eps_prev: 1,
      opm_pct: 1.6, opm_prev_pct: 1.5,
    }))!;
    assert.ok(g.tier === 'MIXED' || g.tier === 'AVOID', g.tier);
  });
  test('(d) PAT and EPS far apart → graded on the lower, card keeps both, and says so', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 30, sales_curr_cr: 1300, sales_prev_cr: 1000,
      pat_yoy_pct: 274, pat_curr_cr: 187, pat_prev_cr: 50, eps_yoy_pct: 64, eps_curr: 8.2, eps_prev: 5,
      opm_pct: 20, opm_prev_pct: 18,
    }))!;
    assert.equal(g.net_profit_yoy_pct, 274);
    assert.equal(g.eps_yoy_pct, 64);
    assert.match(g.growth_basis_note, /lower of PAT \(\+274%\) and EPS \(\+64%\)/);
    assert.notEqual(g.tier, 'BLOCKBUSTER');   // +64% on both legs opens no BLOCKBUSTER path
  });
  test('(d) PAT and EPS in opposite directions → figures_conflict, never a top tier', () => {
    const g = gradeIndiaRow(row({
      sales_yoy_pct: 30, sales_curr_cr: 1300, sales_prev_cr: 1000,
      pat_yoy_pct: 60, pat_curr_cr: 80, pat_prev_cr: 50, eps_yoy_pct: -12, eps_curr: 4.4, eps_prev: 5,
      opm_pct: 20, opm_prev_pct: 18,
    }))!;
    assert.match(g.figures_conflict, /opposite directions \(PAT \+60%, EPS -12%\)/);
    assert.ok(g.tier !== 'BLOCKBUSTER' && g.tier !== 'STRONG', g.tier);
  });
});

describe('E7 — one financial-company detection', () => {
  test('the engine uses the card helper, fed the industry chain', () => {
    const r = { company: 'Synthetic Financial Holdings Ltd', industry: 'Investment Company', broad_industry: 'Finance' };
    assert.equal(indiaFinancialKind(r), financialKind({ company: r.company, industry: r.industry, sub_sector: r.broad_industry }));
    assert.equal(indiaFinancialKind({ company: 'Synthetic Life Ltd', industry: 'Life Insurance', broad_industry: 'Insurance' }), 'insurer');
    const g = gradeIndiaRow(row({ ...CLEAN, company: 'Synthetic Financial Holdings Ltd', industry: 'Investment Company', broad_industry: 'Finance' }))!;
    assert.equal(g.fin_kind, 'lender');
  });
  test("a lender's summary speaks of net margin, never operating margin", () => {
    const g = gradeIndiaRow(row({
      company: 'Synthetic Finance Ltd',
      sales_yoy_pct: 20, sales_curr_cr: 120, sales_prev_cr: 100,
      pat_curr_cr: 10, pat_prev_cr: -5, eps_curr: 1, eps_prev: -0.5,
      opm_pct: 30, opm_prev_pct: -10,
    }))!;
    assert.match(g.narrative, /net margin -5% → 8\.3%/);
    assert.ok(!/operating margin/.test(g.narrative), g.narrative);
  });
});

describe('E8 — the cap reason is stated once', () => {
  test('in tier_cap_reason only — not in the caveats, not in the summary', () => {
    const g = gradeIndiaRow(row({ ...CLEAN, sales_yoy_pct: 9, sales_curr_cr: 1090, pat_yoy_pct: 90, pat_curr_cr: 95, eps_yoy_pct: 90, eps_curr: 9.5, opm_pct: 16, opm_prev_pct: 14 }))!;
    assert.ok(g.tier_cap_reason);
    assert.ok(!g.caveat_tags.some((t: string) => /Capped at/.test(t)));
    assert.ok(!/Capped at/.test(g.narrative));
  });
});

describe('v24 → v25 regrade', () => {
  test('the key moved and v24 is the first legacy namespace', () => {
    assert.equal(GRADED_CACHE_VERSION, 'v26');   // zzz826
    assert.equal(GRADED_CACHE_LEGACY[0], 'v25');
    assert.ok(GRADED_CACHE_LEGACY.includes('v24'));
  });
  test('a v24 card (stored input, no cash year) regrades: cash unknown, its cash flag carried', () => {
    const v24 = gradeIndiaRow(row({ ...CLEAN, ocf_annual_cr: 616, pat_annual_cr: 24, ocf_to_pat_ratio: 0.3 }))!;
    const stored = { ...v24, caveat_tags: [...v24.caveat_tags, 'ocf divergence'], tier: 'BLOCKBUSTER' };
    delete stored.grade_input.cash_fy;
    const re = regradeIndiaCard(stored, 'v24')!;
    assert.equal(re.ocf_to_pat_ratio, null);
    assert.ok(re.caveat_tags.includes('ocf divergence'));
    assert.notEqual(re.tier, 'BLOCKBUSTER');
  });
});
