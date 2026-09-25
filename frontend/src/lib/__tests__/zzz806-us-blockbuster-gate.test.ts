// zzz806 — BLOCKBUSTER needs more than one magnified percentage.
//
// A micro-cap connector maker graded BLOCKBUSTER on EPS $0.04 → $0.12 (+200%)
// with revenue +21%, a 7.3% operating margin, $1.4m of quarterly profit, no
// street estimate, no raised guide, a backlog stated without a prior figure —
// and a type tag that itself said PROFIT JUMP · FORENSICS. Generic inputs only.
// Run: npx tsx --test src/lib/__tests__/zzz806-us-blockbuster-gate.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gradeUsRow, blockbusterGate, type UsFundamentals, type UsGradeInput } from '../us-earnings-core';
import { classifyGradedRow } from '../earnings/pattern-abfg';

const M = 1e6;
const fund = (o: Partial<UsFundamentals>): UsFundamentals => ({
  q_end: '2026-07-31', q_end_prev: '2025-07-31', q_filed: null,
  revenue: null, revenue_prev: null, operating_income: null, operating_income_prev: null,
  net_income: null, net_income_prev: null, eps: null, eps_prev: null,
  cfo: null, cfo_prev: null, capex: null, capex_prev: null, tags: {},
  quarters_revenue: null, quarters_eps: null, quarters_opm: null, ...o,
});
const px = { price: 5, d1_pct: 1, gap_pct: 0, move_pct: 1, pct_from_52w_high: -5, stage: 2 as const, rs_rating: 80, addv_musd: 50, vol_ratio_20d: 1.5 };
const capOf = (tags: string[]) => tags.find((t) => /^capped at /.test(t)) || '';

const microJump = (o: Partial<UsGradeInput> = {}): UsGradeInput => ({
  ticker: 'MCRO', company: 'Connector Co', filing_date: '2026-09-10', form: '10-Q',
  fundamentals: fund({
    revenue: 24.0 * M, revenue_prev: 19.8 * M,
    operating_income: 1.76 * M, operating_income_prev: 0.72 * M,     // OPM 3.6% → 7.3%
    net_income: 1.44 * M, net_income_prev: 0.39 * M,
    eps: 0.12, eps_prev: 0.04,
    cfo: 1.6 * M, capex: 0.1 * M,                                      // CFO/NI 1.11, FCF +$1.5m
  }),
  price: px,
  ...o,
});

describe('zzz806 — a small-base micro-cap profit jump is not a BLOCKBUSTER', () => {
  test('the RFIL-like quarter is not BLOCKBUSTER and names every reason', () => {
    const r = gradeUsRow(microJump())!;
    assert.notEqual(r.tier, 'BLOCKBUSTER');
    const why = capOf(r.caveat_tags);
    assert.match(why, /small base/);
    assert.match(why, /thin margin/);
    assert.match(why, /no independent confirmation/);
    assert.match(why, /micro-scale/);
    assert.match(why, /forensics unresolved/);
    assert.match(r.narrative, /capped at/, 'the sentence says why');
    assert.equal(classifyGradedRow(r)?.forensics, 'flagged');
  });

  test('a flagged forensics type can never sit under a BLOCKBUSTER badge, whatever the tape', () => {
    for (const d1 of [25, -25]) {
      const r = gradeUsRow(microJump({ price: { ...px, d1_pct: d1 } }))!;
      const ab = classifyGradedRow(r);
      if (ab?.forensics === 'flagged') assert.notEqual(r.tier, 'BLOCKBUSTER');
    }
  });
});

describe('zzz806 — what still earns BLOCKBUSTER', () => {
  test('a large, cash-backed beat with confirmation is BLOCKBUSTER', () => {
    const r = gradeUsRow({
      ticker: 'BIGC', company: 'Large Co', filing_date: '2026-09-10', form: '10-Q',
      fundamentals: fund({
        revenue: 800 * M, revenue_prev: 600 * M,                         // +33%
        operating_income: 160 * M, operating_income_prev: 90 * M,       // OPM 15% → 20%
        net_income: 124 * M, net_income_prev: 68 * M,
        eps: 1.24, eps_prev: 0.68,
        cfo: 150 * M, capex: 30 * M,
      }),
      price: px, consensus_beat_pct: 12, positive_guidance: true,
    })!;
    assert.equal(r.tier, 'BLOCKBUSTER', capOf(r.caveat_tags));
    assert.ok(r.methodology_tags.includes('independently confirmed'));
  });

  test('the software-like quarter (small base, but revenue +26% with a 12% beat, OPM 8.9% → 20.6%, cash-backed) stays BLOCKBUSTER', () => {
    const r = gradeUsRow({
      ticker: 'SWCO', company: 'Software Co', filing_date: '2026-09-24', form: '10-Q',
      fundamentals: fund({
        revenue: 163.1 * M, revenue_prev: 129.6 * M, operating_income: 33.6 * M, operating_income_prev: 11.5 * M,
        net_income: 34.1 * M, net_income_prev: 13.4 * M, eps: 0.05, eps_prev: 0.02, cfo: 29.3 * M, capex: 1.2 * M,
      }),
      price: px, revenue_beat_pct: 12.2,
    })!;
    assert.equal(r.tier, 'BLOCKBUSTER', capOf(r.caveat_tags));
  });

  test('small base alone, with an independent confirmation and a healthy margin, can still be STRONG', () => {
    // Small base (prior EPS $0.06), revenue +22%, OPM 10% → 16.4% (operating
    // income doubles, which explains the profit), cash-backed, raised guidance
    // — but on a small base revenue under +25% is not top-tier growth: STRONG.
    const r = gradeUsRow({
      ticker: 'SMLB', company: 'Small Base Co', filing_date: '2026-09-10', form: '10-Q',
      fundamentals: fund({
        revenue: 300 * M, revenue_prev: 246 * M,
        operating_income: 49.2 * M, operating_income_prev: 24.6 * M,
        net_income: 26 * M, net_income_prev: 12 * M,
        eps: 0.13, eps_prev: 0.06,
        cfo: 30 * M, capex: 6 * M,
      }),
      price: px, positive_guidance: true,
    })!;
    assert.equal(r.tier, 'STRONG', `${r.tier} ${capOf(r.caveat_tags)}`);
    assert.match(capOf(r.caveat_tags), /^capped at STRONG: small base/);
  });

  test('gate arithmetic: one or two misses cap at STRONG, three at MIXED; unknown cash is a miss, never a pass', () => {
    const base = {
      salesY: 30, opm: 20, opmPrev: 15, epsPrev: 1, revC: 500e6, revP: 385e6, niC: 60e6, niP: 40e6,
      oiC: 100e6, oiP: 58e6, cfoToNi: 1.1, fcf: 30e6, cashKnown: true, confirmations: ['guidance raised'], forensicsFlagged: false,
    };
    assert.equal(blockbusterGate(base).tier, 'BLOCKBUSTER');
    assert.equal(blockbusterGate({ ...base, confirmations: [] }).tier, 'STRONG');
    assert.equal(blockbusterGate({ ...base, cashKnown: false, cfoToNi: null, fcf: null }).tier, 'STRONG');
    assert.equal(blockbusterGate({ ...base, confirmations: [], opm: 8, opmPrev: 7, cashKnown: false }).tier, 'MIXED');
    assert.equal(blockbusterGate({ ...base, isFinancial: true, cashKnown: false }).tier, 'BLOCKBUSTER', 'CFO/NI is not asked of a bank');
  });
});
