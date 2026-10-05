import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { slimForStore, isUsableLastGood, lastGoodKey, LASTGOOD_MAX_CHARS } from '../guidance-lastgood';
import { parseNames, nameMatches, checkCoverage, coverageSummary } from '../guidance-coverage-check';
import { consensusGapText, consensusFormulaText, gapNote } from '../guidance-upgrades-format';
import { auditDerived } from '../guidance-derived-audit';
import { cleanRequestedNames, withRequested, emptyWatch } from '../guidance-watch';

describe('zzz865 saved copy', () => {
  test('small body is kept as is, big body is trimmed but counts stay', () => {
    const small = { events: [1, 2], reviewQueue: [], unresolved: [], summary: { n: 5 } };
    assert.equal(slimForStore(small)!.slimmed, false);
    const big = { events: Array.from({ length: 900 }, (_, i) => ({ i, t: 'x'.repeat(1500) })), reviewQueue: Array.from({ length: 500 }, (_, i) => ({ i, t: 'y'.repeat(1500) })), unresolved: [], summary: { n: 5 } };
    const r = slimForStore(big)!;
    assert.equal(r.slimmed, true); assert.ok(JSON.stringify(r.body).length <= LASTGOOD_MAX_CHARS); assert.deepEqual(r.body.summary, { n: 5 });
  });
  test('usable check and key', () => {
    assert.equal(isUsableLastGood({ savedAt: 1, body: { events: [] } }), true);
    assert.equal(isUsableLastGood({ savedAt: 1, body: {} }), false);
    assert.equal(isUsableLastGood(null), false);
    assert.equal(lastGoodKey('7D', 'ALL'), 'guidance-upgrades:lastgood:v1:7D:ALL');
  });
});

describe('zzz865 coverage check', () => {
  test('parses a pasted numbered list with notes', () => {
    const t = '1. Cupid\n2. Sterlite tech\n3. Mtar hinted ( actually they didnt raise bloom raised ) 😀\n13. Credit access( hinted)\n15. Ujjivan sfb';
    assert.deepEqual(parseNames(t), ['Cupid', 'Sterlite tech', 'Mtar', 'Credit access', 'Ujjivan sfb']);
  });
  test('matches shortened, joined and ticker spellings', () => {
    const c = (company: string, ticker?: string) => ({ company, ticker });
    assert.ok(nameMatches('Sterlite tech', c('Sterlite Technologies Ltd')));
    assert.ok(nameMatches('Rate gain', c('RateGain Travel Technologies Ltd')));
    assert.ok(nameMatches('Mac Power CNC', c('Macpower CNC Machines Ltd')));
    assert.ok(nameMatches('Yasho Ind', c('Yasho Industries Ltd')));
    assert.ok(nameMatches('concor', c('Container Corporation of India Ltd', 'CONCOR')));
    assert.ok(!nameMatches('Sky Gold', c('Sky Industries Ltd')));
    assert.ok(!nameMatches('ab', c('ABC Ltd')));
  });
  test('active / claim / not seen, and never "no guidance" for a missing name', () => {
    const rows = checkCoverage(['Cupid', 'Gland Pharma', 'Radico'], [{ company: 'Cupid Ltd', ticker: 'CUPID', market: 'IN', display: '+85–92% (derived)', metric: 'REVENUE', period: 'FY27' }],
      [{ company: 'Gland Pharma Ltd', ticker: 'GLAND', market: 'IN', claim: 'REVENUE +15% · FY27', status: 'PRIMARY_NOT_READ', nextAction: 'Document queued.' }]);
    assert.deepEqual(rows.map((r) => r.status), ['ACTIVE', 'CLAIM_WAITING', 'NOT_SEEN']);
    assert.ok(/NOT a statement that the company gave no guidance/.test(rows[2].line));
    assert.deepEqual(coverageSummary(rows), { total: 3, active: 1, waiting: 1, notSeen: 1 });
  });
  test('requested names are cleaned and joined to the watch set', () => {
    assert.deepEqual(cleanRequestedNames(['  Kei Industries Ltd ', 'KEI industries', '<script>', 'ab', 5]), ['kei industries']);
    const w = withRequested(emptyWatch(), ['kei industries']);
    assert.ok(w.IN.names.includes('kei industries') && w.US.names.includes('kei industries'));
  });
});

describe('zzz865 guidance vs consensus wording', () => {
  test('signed percentage or not available, never a vague word', () => {
    assert.equal(consensusGapText('POSITIVE', 3.04), '+3.0%');
    assert.equal(consensusGapText('NEGATIVE', -4.2), '-4.2%');
    assert.ok(/not available/.test(consensusGapText('UNKNOWN', null)));
    assert.equal(gapNote('POSITIVE', 3), 'Guidance up · Guidance vs consensus: +3.0%');
  });
  test('formula text shows guidance, consensus, formula and result', () => {
    const t = consensusFormulaText({ gapPct: 3, expectationGap: 'POSITIVE', consensus: { metric: 'REVENUE' as any, period: 'FY27', value: 100, unit: '$M', source: 'vendor' }, changes: [{ metric: 'REVENUE', after: { midpoint: 103, unit: '$M' } }] });
    assert.ok(/103/.test(t) && /100/.test(t) && /− 1/.test(t) && /\+3\.0%/.test(t) && /vendor/.test(t));
    assert.equal(consensusFormulaText({ gapPct: null, expectationGap: 'UNKNOWN' }), '');
  });
});

describe('zzz865 derived audit', () => {
  const rec = (d: any, exact: any) => ({ record: { company: 'Test Co', ticker: 'TST', market: 'IN' }, points: [{ metric: 'REVENUE', period: 'FY27', growthType: 'DERIVED', growthDerivation: d, growthExact: exact, primarySource: true, primarySourceRead: true, sourceName: 'Company presentation', sourceUrl: null, sourceDate: '2026-08-01', verificationState: 'DERIVED' }] });
  test('recalculates and lists the formula', () => {
    const a = auditDerived([rec({ previousValue: 108.23, currentLow: 200, currentHigh: 208, unit: '₹ Cr', basePeriod: 'FY26', basis: 'absolute_vs_prior_year_actual' }, { low: 84.8, high: 92.2 })]);
    assert.equal(a.total, 1); assert.equal(a.recalcOk, 1); assert.ok(/÷ ₹ Cr 108\.23 − 1/.test(a.rows[0].formula)); assert.ok(/\+84\.8% to \+92\.2%/.test(a.rows[0].growth));
  });
  test('a stored growth that disagrees with its own numbers is flagged, not hidden', () => {
    const a = auditDerived([rec({ previousValue: 100, currentLow: 150, currentHigh: 150, unit: '₹ Cr', basePeriod: 'FY26', basis: 'absolute_vs_prior_year_actual' }, { low: 110, high: 110 })]);
    assert.equal(a.withIssues, 1); assert.ok(/does not match/.test(a.rows[0].issues[0]));
  });
  test('same base and target period is flagged', () => {
    const a = auditDerived([rec({ previousValue: 100, currentLow: 120, currentHigh: 120, unit: '₹ Cr', basePeriod: 'FY27', basis: 'absolute_vs_prior_year_actual' }, { low: 20, high: 20 })]);
    assert.ok(a.rows[0].issues.some((x) => /same as the target/.test(x)));
  });
});
