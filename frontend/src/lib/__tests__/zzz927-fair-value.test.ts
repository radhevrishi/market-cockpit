// zzz927 — Guidance Upgrades focus list: the "Reported" date sort and the fair-value estimate (auto-valuation method, no AI).
// Made-up companies and figures only; no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sortByReported, reportedLabel } from '../gu-focus-sort';
import { fairValue, fvTooltip, bandsFor, sectorOf, isFinancialText, growthClass, GROWTH_CAP_PCT, UPSIDE_MAX_PCT, type FvFacts } from '../gu-fair-value';
import { usFactsFromRow, emptyFacts } from '../gu-skygold-facts';
import { nasdaqQuoteFields, dollarNum } from '../gu-skygold-lookup';

const F = (o: Partial<FvFacts> = {}): FvFacts => ({
  market: 'IN', price: 100, mcap: 1000, salesBase: 500, opFy: 100, patFy: 50, borrowings: 100, salesGrowthFy: 25, salesCagr3y: 20, sector: null, industry: null, ...o,
});
const G = (o: Record<string, unknown> = {}) => ({ growthPct: 20, growthTrust: 'verified', growthType: 'EXPLICIT', growthMetric: 'REVENUE', growthCohort: 'ANNUAL', ...o });

describe('Reported date sort', () => {
  const rows = [
    { n: 'a', d: '2026-09-10' }, { n: 'b', d: '2026-09-30' }, { n: 'c', d: null }, { n: 'd', d: '2026-09-10' }, { n: 'e', d: '2026-08-01' },
  ];
  test('newest first, oldest first; no date last in both; same date keeps the focus order', () => {
    assert.deepEqual(sortByReported(rows, (r) => r.d, 'new').map((r) => r.n), ['b', 'a', 'd', 'e', 'c']);
    assert.deepEqual(sortByReported(rows, (r) => r.d, 'old').map((r) => r.n), ['e', 'a', 'd', 'b', 'c']);
  });
  test('does not change the input order (default order unchanged)', () => {
    const before = rows.map((r) => r.n).join('');
    sortByReported(rows, (r) => r.d, 'new');
    assert.equal(rows.map((r) => r.n).join(''), before);
  });
  test('label', () => {
    assert.equal(reportedLabel('2026-09-18'), '18 Sep 2026');
    assert.equal(reportedLabel(null), '—');
    assert.equal(reportedLabel('not a date'), 'not a date');
  });
  test('the page wires the column, both tables, and the date source (raiseDate for A, growthDate for B)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'guidance-upgrades', 'GuFocusList.tsx'), 'utf8');
    assert.match(src, /sortByReported\(raisedAll, \(r\) => r\.raiseDate/);
    assert.match(src, /sortByReported\(growthAll, \(r\) => r\.growthDate/);
    assert.equal((src.match(/<DateHead /g) || []).length, 2);
    assert.match(src, /<ScoreHead /);   // the Sky Gold score sort is still there
  });
});

describe('fair value — worked example (generic sector band)', () => {
  // sales 500, op profit 100, net profit 50, borrowings 100, market value 1000 at ₹100. Guided revenue growth 20% for one year.
  // forward: sales 600, EBITDA 120, PAT 60.   Generic band (sector not known): P/E 18/25/35, P/S 2/3.5/6, EV/EBITDA 10/14/20.
  // base equity: P/S 600×3.5 = 2100 · P/E 60×25 = 1500 · EV 120×14 − 100 = 1580.
  // confidence (revenue guided; generic band one notch down): P/S MED 0.7, P/E LOW 0.3, EV LOW 0.3 → weights .45×.7, .35×.3, .2×.3.
  test('base / bear / bull and the upside', () => {
    const r = fairValue(F(), G());
    assert.equal(r.ok, true);
    const w = { ps: 0.45 * 0.7, pe: 0.35 * 0.3, ev: 0.2 * 0.3 };
    const eq = (s: number, p: number, e: number) => (w.ps * s + w.pe * p + w.ev * e) / (w.ps + w.pe + w.ev);
    const base = eq(600 * 3.5, 60 * 25, 120 * 14 - 100);
    assert.equal(r.base!.fair, Math.round(100 * (base / 1000) * 100) / 100);
    assert.equal(r.base!.upsidePct, Math.round((base / 1000 - 1) * 1000) / 10);
    // bear: growth 10% (half of 20), bear multiples; bull: growth 23%, bull multiples
    const bear = eq(550 * 2, 55 * 18, 110 * 10 - 100), bull = eq(615 * 6, 61.5 * 35, 123 * 20 - 100);
    assert.equal(r.bear!.fair, Math.round(100 * (bear / 1000) * 100) / 100);
    assert.equal(r.bull!.fair, Math.round(100 * (bull / 1000) * 100) / 100);
    assert.deepEqual(r.growth, { bear: 10, base: 20, bull: 23 });
    assert.equal(r.basis, 'guided');
    assert.ok(r.bear!.fair < r.base!.fair && r.base!.fair < r.bull!.fair);
    assert.deepEqual(r.methods.map((m) => m.label).sort(), ['EV/EBITDA', 'P/E', 'P/S']);
    assert.ok(r.checks.some((c) => /no sector band/.test(c)));
  });
  test('tooltip carries bear / base / bull, the methods and the inputs, and no trade words', () => {
    const t = fvTooltip(fairValue(F(), G()));
    assert.match(t, /Bear ₹.*Base ₹.*Bull ₹/);
    assert.match(t, /P\/S .*P\/E .*EV\/EBITDA/);
    assert.match(t, /price ₹100 · market value ₹1,000 Cr/);
    assert.doesNotMatch(t, /\b(BUY|SELL)\b|\bbest\b|top stocks?|\d\s*\/\s*100/i);
  });
  test('USA is in dollars, has no EV/EBITDA, and uses the latest quarter × 4', () => {
    const r = fairValue(F({ market: 'US', price: 50, mcap: 5000, salesBase: 2000, patFy: 200, opFy: null, borrowings: null, industry: 'Prepackaged Software' }), G({ growthPct: 25 }));
    assert.equal(r.ok, true);
    assert.equal(r.currency, '$');
    assert.deepEqual(r.methods.map((m) => m.label).sort(), ['P/E', 'P/S']);
    assert.ok(r.inputs.some((i) => /latest quarter × 4/.test(i)));
  });
});

describe('fair value — sector bands (the auto-valuation bands)', () => {
  test('a preferred-multiple sector uses its own range and the engine\'s derived secondary bands', () => {
    const b = bandsFor('Defence', false);   // PE 30-50x → mid 40
    assert.deepEqual(b.PE, { bear: 30, base: 40, bull: 50 });
    assert.deepEqual(b.EV_EBITDA, { bear: 20, base: 28, bull: 38 });
    assert.deepEqual(b.PS, { bear: 6.16, base: 8.8, bull: 14.08 });
    const c = bandsFor('Cement', false);    // EV/EBITDA 10-15x → mid 13 (rounded)
    assert.deepEqual(c.EV_EBITDA, { bear: 10, base: 13, bull: 15 });
    assert.deepEqual(c.PE, { bear: 13, base: 18.2, bull: 24.7 });
  });
  test('generic and declining generic bands', () => {
    assert.deepEqual(bandsFor(null, false).PS, { bear: 2, base: 3.5, bull: 6 });
    assert.deepEqual(bandsFor(null, true).PS, { bear: 0.8, base: 1.5, bull: 2.5 });
  });
  test('industry words map to a sector band; banks / lenders / insurers are financial', () => {
    assert.equal(sectorOf('Gems, Jewellery And Watches', 'Consumer Durables').key, 'Consumer Durables / FMCG');
    assert.equal(sectorOf('Cement & Cement Products', null).key, 'Cement');
    assert.equal(sectorOf('Aerospace & Defense', null).key, 'Defence');
    assert.equal(sectorOf('Unheard-of widgets', null).key, null);
    for (const t of ['Private Sector Bank', 'Non Banking Financial Company (NBFC)', 'Life Insurance', 'Housing Finance Company', 'Savings Institutions']) assert.ok(isFinancialText(t), t);
    for (const t of ['Capital Goods', 'Cement', 'Software']) assert.ok(!isFinancialText(t), t);
  });
  test('growth class of a guided metric', () => {
    assert.equal(growthClass('REVENUE'), 'revenue'); assert.equal(growthClass('PAT'), 'profit'); assert.equal(growthClass('FCF'), 'other'); assert.equal(growthClass(null), 'other');
  });
});

describe('fair value — missing or implausible inputs give a dash and a reason, never a guess', () => {
  test('no price / no market value / no sales', () => {
    assert.match(fairValue(F({ price: null }), G()).reason!, /price/);
    assert.match(fairValue(F({ mcap: null }), G()).reason!, /market value/);
    assert.match(fairValue(F({ salesBase: null }), G()).reason!, /sales/);
    assert.match(fairValue(null, G()).reason!, /not read yet/);
    for (const r of [fairValue(F({ price: null }), G()), fairValue(null, G())]) { assert.equal(r.ok, false); assert.equal(r.base, null); }
  });
  test('banks, lenders and insurers show no fair value (book value is not read)', () => {
    const r = fairValue(F({ industry: 'Private Sector Bank' }), G());
    assert.equal(r.ok, false); assert.match(r.reason!, /book value/); assert.equal(r.base, null);
    assert.equal(fairValue(F({ industry: 'Life Insurance' }), G()).ok, false);
  });
  test('only one method can be worked → no number', () => {
    // US, loss-making: no P/E, no EV/EBITDA → P/S alone
    const r = fairValue(F({ market: 'US', patFy: -40, opFy: null, borrowings: null }), G());
    assert.equal(r.ok, false); assert.match(r.reason!, /only 1 valuation method/);
  });
  test('profit above operating profit (other income) drops the P/E', () => {
    const r = fairValue(F({ patFy: 150, opFy: 100 }), G());
    assert.equal(r.ok, true);
    assert.ok(!r.methods.some((m) => m.label === 'P/E'));
    assert.ok(r.inputs.some((i) => /other income/.test(i)));
  });
  test('borrowings not read drops EV/EBITDA (never counted as zero debt)', () => {
    const r = fairValue(F({ borrowings: null }), G());
    assert.ok(!r.methods.some((m) => m.label === 'EV/EBITDA'));
  });
  test('no growth guided and no sales history → no number', () => {
    const r = fairValue(F({ salesGrowthFy: null, salesCagr3y: null }), { growthPct: null, growthTrust: null });
    assert.equal(r.ok, false); assert.match(r.reason!, /no growth rate guided/);
  });
  test('an upside beyond +250% is not shown (model artifact), with the reason', () => {
    const r = fairValue(F({ mcap: 150 }), G());   // the same business at a market value of 150 → far above +250%
    assert.equal(r.ok, false); assert.match(r.reason!, new RegExp(`more than \\+${UPSIDE_MAX_PCT}%`)); assert.equal(r.base, null);
  });
  test('a figure far below −90% is not shown', () => {
    const r = fairValue(F({ mcap: 100000 }), G());
    assert.equal(r.ok, false); assert.match(r.reason!, /below -90%/);
  });
});

describe('fair value — guided growth guards (the auto-valuation plausibility gate and declining-sales guard)', () => {
  test('a one-year growth above the cap is capped and flagged', () => {
    const r = fairValue(F({ mcap: 3000 }), G({ growthPct: 250 }));
    assert.equal(r.ok, true);
    assert.equal(r.growth!.base, GROWTH_CAP_PCT);
    assert.ok(r.growth!.bull <= GROWTH_CAP_PCT);
    assert.ok(r.checks.some((c) => /capped at 100%/.test(c)));
  });
  test('no guided growth + falling sales → bear = decline, base = flat, bull = mild recovery, and the compressed P/S band', () => {
    const r = fairValue(F({ salesGrowthFy: -10, salesCagr3y: -5, mcap: 600 }), { growthPct: null, growthTrust: null });
    assert.equal(r.ok, true);
    assert.deepEqual(r.growth, { bear: -7.5, base: 0, bull: 5 });
    assert.equal(r.basis, 'history');
    assert.deepEqual(r.methods.find((m) => m.label === 'P/S')!.band, { bear: 0.8, base: 1.5, bull: 2.5 });
    assert.ok(r.checks.some((c) => /sales are falling/.test(c)));
  });
  test('a raise-only row (no growth rate) falls back to past sales growth, labelled as such with lower confidence', () => {
    const r = fairValue(F({ salesGrowthFy: 30, salesCagr3y: 20 }), { growthPct: null, growthTrust: null });
    assert.equal(r.ok, true); assert.equal(r.basis, 'history');
    assert.equal(r.growth!.base, 25);
    assert.ok(r.checks.some((c) => /past sales growth, not company guidance/.test(c)));
    assert.equal(r.methods.find((m) => m.label === 'P/S')!.conf, 'LOW');   // history + generic band
  });
  test('guided profit growth is applied to profit; P/S (a sales multiple) is not used', () => {
    const r = fairValue(F(), G({ growthMetric: 'PAT', growthPct: 30 }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.methods.map((m) => m.label).sort(), ['EV/EBITDA', 'P/E']);
    assert.equal(r.methods.find((m) => m.label === 'P/E')!.baseFair, Math.round(100 * ((50 * 1.3 * 25) / 1000) * 100) / 100);
  });
  test('a guided measure that is not sales or profit growth (cash flow) is not used; past pace is', () => {
    const r = fairValue(F(), G({ growthMetric: 'FCF', growthPct: 80 }));
    assert.equal(r.basis, 'history');
    assert.ok(r.inputs.some((i) => /not a sales or profit growth rate/.test(i)));
  });
  test('worked-out growth (not stated by the company) is accepted but one confidence notch below stated', () => {
    const a = fairValue(F({ sector: 'Cement' }), G()), b = fairValue(F({ sector: 'Cement' }), G({ growthType: 'DERIVED', growthTrust: 'derived' }));
    assert.equal(a.ok && b.ok, true);
    assert.ok(b.inputs.some((i) => /worked out from company numbers/.test(i)));
    assert.ok(a.inputs.some((i) => /stated by the company/.test(i)));
  });
  test('methods that disagree by more than 2.5× are flagged "check"', () => {
    const r = fairValue(F({ patFy: 5 }), G());   // tiny profit: P/E value far below the sales-multiple value
    assert.equal(r.ok, true);
    assert.ok(r.checks.some((c) => /methods disagree/.test(c)));
  });
  test('sales that fell last year are flagged even when growth is guided', () => {
    const r = fairValue(F({ salesGrowthFy: -8 }), G());
    assert.ok(r.checks.some((c) => /sales fell last year/.test(c)));
  });
  test('upside between +150% and +250% is shown with a "check"', () => {
    // the worked example is +90% at a market value of 1000; at 640 it is about +197%
    const r = fairValue(F({ mcap: 640 }), G());
    assert.equal(r.ok, true);
    assert.ok(r.base!.upsidePct > 150 && r.base!.upsidePct <= 250, String(r.base!.upsidePct));
    assert.ok(r.checks.some((c) => /upside above \+150%/.test(c)));
  });
});

describe('fair value — the figures the route now carries', () => {
  test('USA row: net profit and sales are the latest quarter × 4', () => {
    const f = usFactsFromRow('ZZZ', { source: 'sec-xbrl', revenue_curr_musd: 100, net_income_curr_musd: 10, opm_pct: 12 }, null)!;
    assert.equal(f.salesBase, 400); assert.equal(f.patFy, 40);
    assert.equal(emptyFacts('IN', 'X', 's').price, null);
  });
  test('Nasdaq: last sale wins over the previous close; sector and industry come through; N/A is dropped', () => {
    const summary = { data: { summaryData: { PreviousClose: { value: '$552.29' }, Sector: { value: 'Technology' }, Industry: { value: 'N/A' } } } };
    const info = { data: { primaryData: { lastSalePrice: '$574.19' } } };
    assert.deepEqual(nasdaqQuoteFields(summary, info), { price: 574.19, sector: 'Technology', industry: null });
    assert.deepEqual(nasdaqQuoteFields(summary, null), { price: 552.29, sector: 'Technology', industry: null });
    assert.deepEqual(nasdaqQuoteFields(null, null), { price: null, sector: null, industry: null });
    assert.equal(dollarNum('N/A'), null);
  });
  test('the fair-value lib stays out of lib/thesis and the thesis engine does not import it', () => {
    const src = readFileSync(join(__dirname, '..', 'gu-fair-value.ts'), 'utf8');
    assert.ok(!/from '\.\/thesis\//.test(src));
    assert.ok(!/anthropic|openai|fetch\(/i.test(src.replace(/\/\/.*$/gm, '')), 'no model call, no network');
  });
});
