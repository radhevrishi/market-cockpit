// zzz804 — the US earnings grade reads fundamentals only.
//
// The owner's complaint, in his words: "BB earnings is good and other bad but
// our system classifies differently." Two live cards, reproduced here with
// GENERIC inputs (no ticker is special-cased anywhere in the engine):
//
//   • a software company: revenue +26% with a 12% beat on the street, operating
//     margin 8.9% → 20.6%, EPS $0.02 → $0.05, CFO/NI 0.86, positive FCF — was
//     MIXED and typed "F · PROFIT JUMP · FORENSICS", with a summary that said
//     "blockbuster" under the MIXED badge;
//   • a thin-margin distributor: revenue +38%, OPM 2.45% → 2.98%, EPS +89%,
//     and −$917m of operating cash in the quarter — was STRONG and typed
//     "A · OPERATING INFLECTION", with "cash flow arrives with the 10-Q" beside
//     a −$975.6m free-cash-flow tile.
//
// Root causes pinned here: price (reaction, 52-week high, P/E, chart methods)
// moved the tier; the forensics gate fired on the EPS ratio alone; a PRELIM row
// never read the release's own cash-flow statement; and the verdict sentence
// was composed before the last tier move.
// Run: npx tsx --test src/lib/__tests__/zzz804-us-grade.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeUsRow, applySetupGates, assignSetupScores, composeUsNarrative, usNarrativeHead,
  type UsFundamentals, type UsGradeInput, type UsGradedRow,
} from '../us-earnings-core';
import { classifyGradedRow, classifyAbfg, forensicsCheck } from '../earnings/pattern-abfg';
import { financialsFromReleaseHtml, releaseAttributesCashToWorkingCapital } from '../us-pr-financials';

const M = 1e6;
const ORDER = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
const atLeast = (t: string, floor: string) => ORDER.indexOf(t) <= ORDER.indexOf(floor);

const fund = (o: Partial<UsFundamentals>): UsFundamentals => ({
  q_end: '2026-08-31', q_end_prev: '2025-08-31', q_filed: null,
  revenue: null, revenue_prev: null, operating_income: null, operating_income_prev: null,
  net_income: null, net_income_prev: null, eps: null, eps_prev: null,
  cfo: null, cfo_prev: null, capex: null, capex_prev: null, tags: {},
  quarters_revenue: null, quarters_eps: null, quarters_opm: null, ...o,
});

type Px = NonNullable<UsGradeInput['price']>;
const px = (o: Partial<Px> = {}): Px => ({
  price: 10, d1_pct: 1, gap_pct: 0.5, move_pct: 1, pct_from_52w_high: -8, stage: 2, rs_rating: 60,
  addv_musd: 50, vol_ratio_20d: 1.5, ...o,
});

/** Grade, then run the cohort pass exactly as the route does. */
function grade(input: UsGradeInput): UsGradedRow {
  const r = gradeUsRow(input)!;
  assert.ok(r, 'row graded');
  const rows: any[] = [r];
  assignSetupScores(rows);
  applySetupGates(rows);
  (r as any).narrative = composeUsNarrative(r.narrative_stem, r.caveat_tags, r.methodology_tags,
    r.tier, r.company, r.quarter, r.market_context);
  return r;
}

// A software company: large beat, operating leverage, cash-backed profit.
const softwareCo = (price: Partial<Px> = {}): UsGradeInput => ({
  ticker: 'SWCO', company: 'Software Co', filing_date: '2026-09-24', form: '10-Q',
  fundamentals: fund({
    revenue: 163.1 * M, revenue_prev: 129.6 * M,
    operating_income: 33.6 * M, operating_income_prev: 11.5 * M,   // OPM 8.9% → 20.6%, +192%
    net_income: 34.1 * M, net_income_prev: 13.4 * M,
    eps: 0.05, eps_prev: 0.02,
    cfo: 29.3 * M, capex: 1.2 * M,                                  // CFO/NI 0.86, FCF +$28.1m
  }),
  price: px({ d1_pct: 4.2, pct_from_52w_high: -32, stage: 3, rs_rating: 35, ...price }),
  revenue_beat_pct: 12.2,
});

// A thin-margin distributor with a large operating-cash outflow in the quarter.
const distributor = (o: { cfo?: number | null; capex?: number | null; price?: Partial<Px>; wc?: boolean } = {}): UsGradeInput => ({
  ticker: 'DIST', company: 'Distributor Co', filing_date: '2026-09-24', form: '8-K',
  fundamentals: fund({
    revenue: 21558.4 * M, revenue_prev: 15650.9 * M,
    operating_income: 642.9 * M, operating_income_prev: 383.7 * M,  // OPM 2.45% → 2.98%
    net_income: 416.2 * M, net_income_prev: 226.8 * M,
    eps: 5.18, eps_prev: 2.74,
    cfo: o.cfo === undefined ? -916.7 * M : o.cfo,
    capex: o.capex === undefined ? 58.9 * M : o.capex,
  }),
  price: px({ d1_pct: -9.9, gap_pct: -8, pct_from_52w_high: -11, stage: 2, rs_rating: 70, ...(o.price || {}) }),
  adj_eps: 5.68, adj_eps_prev: 3.58, consensus_beat_pct: 20.9,
  cash_explained_by_working_capital: o.wc,
});

describe('zzz804 — the two live cards, from generic inputs', () => {
  test('large beat + margin expansion + cash-backed profit grades STRONG or better, and forensics passes', () => {
    const r = grade(softwareCo());
    assert.ok(atLeast(r.tier, 'STRONG'), `tier ${r.tier}`);
    const ab = classifyGradedRow(r);
    assert.ok(ab, 'classified');
    assert.notEqual(ab!.pattern, 'F', 'the profit jump is explained by operations and cash — not a forensics case');
    assert.equal(ab!.forensics, 'passed');
    assert.ok((ab!.notes || []).some((n) => /small base/.test(n)), 'the low base is a note');
    assert.ok(r.methodology_tags.includes('revenue beat'), 'the 12% revenue beat counts');
    assert.ok(!r.caveat_tags.some((t) => /well off|52-week|sold off/.test(t)), 'no price in the caveats');
  });

  test('thin-margin distributor with large negative operating cash is NOT STRONG, and the cash caveat shows', () => {
    const r = grade(distributor());
    assert.ok(!atLeast(r.tier, 'STRONG'), `tier ${r.tier}`);
    assert.ok(r.caveat_tags.includes('profit without operating cash'));
    assert.match(r.narrative, /profit without operating cash/);
    const ab = classifyGradedRow(r);
    assert.notEqual(ab?.pattern, 'A', 'no operating inflection while the cash contradicts the profit');
  });

  test('caveats are not repeated: one sold-off line, in context, never twice', () => {
    const r = grade(distributor());
    const all = [...r.caveat_tags, ...(r.market_context || [])];
    assert.equal(all.filter((t) => /sold off/.test(t)).length, 1);
    assert.ok(!r.caveat_tags.some((t) => /sold off/.test(t)), 'the sell-off is context, not a caveat');
    // The sentence does not say the same cash problem twice.
    assert.equal((r.narrative.match(/operating cash|ocf divergence/g) || []).length, 1);
  });
});

describe('zzz804 — price context changes nothing', () => {
  const variants: Array<Partial<Px>> = [
    { d1_pct: 15, gap_pct: 12, pct_from_52w_high: 0, stage: 2, rs_rating: 99, vol_ratio_20d: 5 },
    { d1_pct: -25, gap_pct: -20, pct_from_52w_high: -70, stage: 4, rs_rating: 1, vol_ratio_20d: 0.3 },
    { d1_pct: null, gap_pct: null, pct_from_52w_high: null, stage: null, rs_rating: null, vol_ratio_20d: null, addv_musd: 0.5 },
  ];
  for (const [name, make] of [['software co', (p: Partial<Px>) => softwareCo(p)], ['distributor', (p: Partial<Px>) => distributor({ price: p })]] as const) {
    test(`${name}: tier, fundamental caveats and the price-free composite are identical under any tape`, () => {
      const base = grade(make({}));
      for (const v of variants) {
        const r = grade(make(v));
        assert.equal(r.tier, base.tier, JSON.stringify(v));
        assert.deepEqual(r.caveat_tags, base.caveat_tags, JSON.stringify(v));
        assert.equal(r.fund_composite, base.fund_composite, JSON.stringify(v));
        assert.equal(classifyGradedRow(r)?.pattern ?? null, classifyGradedRow(base)?.pattern ?? null);
      }
    });
  }
  test('a P/E far above the cohort (valuation) does not demote a top-tier quarter', () => {
    const rows: any[] = [];
    for (let i = 0; i < 6; i++) {
      const r: any = gradeUsRow({ ...softwareCo(), ticker: `P${i}` })!;
      r.pe = i === 0 ? 400 : 12;                 // one row priced far above the cohort
      rows.push(r);
    }
    const before = rows.map((r) => r.tier);
    assignSetupScores(rows);
    applySetupGates(rows);
    assert.deepEqual(rows.map((r) => r.tier), before);
  });
  test('price context is shown, labelled as outside the grade', () => {
    const r = grade(softwareCo());
    assert.ok((r.market_context || []).some((t) => /52-week high/.test(t)));
    assert.match(r.narrative, /Market context \(not part of the grade\)/);
  });
});

describe('zzz804 — forensics and cash rules', () => {
  test('low-base EPS jump with NO cash backing still flags F', () => {
    const base = { salesY: 26, epsY: 150, opmPct: 20.6, opmPrevPct: 8.9, opIncomeY: 192, d1Reaction: 4 };
    assert.equal(classifyAbfg({ ...base, cfoToPat: 0.3, fcf: -5 })?.pattern, 'F');
    assert.equal(classifyAbfg({ ...base, cfoToPat: 0.86, fcf: -5 })?.pattern, 'F', 'positive FCF is required');
    assert.equal(classifyAbfg({ ...base, cfoToPat: null, fcf: null })?.pattern, 'F', 'unknown cash cannot clear forensics');
    assert.equal(forensicsCheck({ ...base, cfoToPat: 0.86, fcf: 28 }), 'passed');
  });
  test('a jump the operating line does not explain still flags, even with cash', () => {
    // margin flat, EPS +150% on revenue +26% — something below the line
    assert.equal(classifyAbfg({ salesY: 26, epsY: 150, opmPct: 10, opmPrevPct: 10, opIncomeY: 27, cfoToPat: 1.2, fcf: 10 })?.pattern, 'F');
  });
  test('rows without the operating/cash fields (the India shape) classify exactly as before', () => {
    assert.equal(classifyGradedRow({ sales_yoy_pct: 26, eps_yoy_pct: 150, cfo_to_pat_ratio: 0.86, opm_pct: 20.6, opm_prev_pct: 8.9 })?.pattern, 'F');
    assert.equal(classifyGradedRow({ sales_yoy_pct: 38, eps_yoy_pct: 89, cfo_to_pat_ratio: -2.2 })?.pattern, 'A');
  });
  test('unknown cash flow does not downgrade', () => {
    const known = grade(distributor({ cfo: 500 * M, capex: 58.9 * M }));
    const unknown = grade(distributor({ cfo: null, capex: null }));
    assert.ok(atLeast(unknown.tier, known.tier), `unknown ${unknown.tier} vs cash-positive ${known.tier}`);
    assert.ok(!unknown.caveat_tags.some((t) => /cash/.test(t)), 'no cash caveat is invented');
    assert.ok(atLeast(unknown.tier, 'STRONG'));
  });
  test('the release explaining a working-capital build softens the cash cap to STRONG but keeps a caveat', () => {
    const r = grade(distributor({ wc: true }));
    assert.equal(r.tier === 'BLOCKBUSTER', false);
    assert.ok(r.caveat_tags.some((t) => /working capital/.test(t)));
  });
});

describe('zzz804 — the sentence follows the verdict', () => {
  test('the summary adjective matches the tier on both cards', () => {
    for (const r of [grade(softwareCo()), grade(distributor())]) {
      assert.ok(r.narrative.startsWith(usNarrativeHead(r.tier, r.company, r.quarter)), `${r.tier}: ${r.narrative}`);
      if (r.tier !== 'BLOCKBUSTER') assert.doesNotMatch(r.narrative, /blockbuster/i);
    }
  });
  test('a tier moved after grading is re-stated when the sentence is recomposed', () => {
    const r = gradeUsRow(softwareCo())!;
    const n = composeUsNarrative(r.narrative_stem, r.caveat_tags, r.methodology_tags, 'MIXED', r.company, r.quarter, r.market_context);
    assert.match(n, /is a mixed print/);
    assert.doesNotMatch(n, /blockbuster/);
  });
});

describe('zzz804 — release cash flow is read only for the quarter', () => {
  const table = (head: string, cols: string[]) => `<html><body>
    <p>For the three months ended August 31, 2026</p>
    <table>
      <tr><td></td>${head}</tr>
      <tr><td>Revenue</td>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>
    </table>
    <table>
      <tr><td></td>${head}</tr>
      <tr><td>Net cash (used in) provided by operating activities</td><td>(916,717)</td><td>246,141</td><td>(2,078,194)</td><td>71,326</td></tr>
      <tr><td>Purchases of property and equipment</td><td>(58,884)</td><td>(32,221)</td><td>(158,853)</td><td>(103,989)</td></tr>
    </table></body></html>`;
  const qHead = '<td>Three Months Ended August 31, 2026</td><td>Three Months Ended August 31, 2025</td><td>Nine Months Ended August 31, 2026</td><td>Nine Months Ended August 31, 2025</td>';
  const ya = { revenue: 15650924e3, operating_income: null, net_income: null, eps: null, cfo: 246141e3, capex: 32221e3 };
  test('three-month column bound by the header, validated against the year-ago quarter', () => {
    const r = financialsFromReleaseHtml(table(qHead, ['21,558,406', '15,650,924', '58,294,417', '45,128,946']), ya, { reportedPeriodEnd: '2026-08-31' });
    assert.equal(r.cfo, -916717e3);
    assert.equal(r.capex, 58884e3);
  });
  test('a year-to-date-only statement is never read as the quarter', () => {
    const ytdHead = '<td>Nine Months Ended August 31, 2026</td><td>Nine Months Ended August 31, 2025</td><td>Six Months Ended May 31, 2026</td><td>Six Months Ended May 31, 2025</td>';
    const r = financialsFromReleaseHtml(table(ytdHead, ['58,294,417', '45,128,946', '1', '1']), ya, { reportedPeriodEnd: '2026-08-31' });
    assert.equal(r.cfo ?? null, null);
  });
  test('a working-capital explanation is read only from the filer\'s own sentence', () => {
    assert.equal(releaseAttributesCashToWorkingCapital('<p>Operating cash flow was negative, reflecting an investment in working capital to support growth.</p>'), true);
    assert.equal(releaseAttributesCashToWorkingCapital('<p>Free cash flow, which is cash flow from operating activities reduced by purchases of property.</p>'), false);
  });
});
