// zzz850 - radar evidence honesty: reported results are not "unproven", deal / investment amounts are not earnings,
// event evidence and economic evidence are separate lines, and stage labels never say "Validated" without a primary source.
// Synthetic company names only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyseRadarItem, type RadarInput } from '../multibagger-radar';
import { STAGE_LABEL, type RadarItem } from '../multibagger-radar-types';
import { RadarCard } from '../../components/special-situations/RadarCard';
import { progressionText, statusBadges, evidenceLines, collapseChain, MATURITY_LABEL } from '../../components/special-situations/radar-tokens';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const card = (item: RadarItem) => renderToStaticMarkup(React.createElement(RadarCard as any, { item, held: false, ledgerIds: new Set<string>(), onSaveLedger: () => {}, now: '2026-09-30T00:00:00Z' }));
const mk = (o: Partial<RadarInput> & { title: string }): RadarInput => ({ id: o.id || 'x', ticker: null, company: o.company || 'Alphacorp', region: 'IN', sourceLabel: 'Economic Times', ...o } as RadarInput);
const run = (o: Partial<RadarInput> & { title: string }) => analyseRadarItem(mk(o));
const blob = (r: RadarItem) => JSON.stringify(r);

const RESULT = 'Alphacorp Aluminium profit surges three-fold in June quarter on record revenue';
const ACQ = 'Betaworks Green Energy to acquire 500 MW wind assets for Rs 2,400 crore';
const ACQ_D = 'The company will acquire the operating wind assets. The acquisition adds capacity of 500 MW to its portfolio.';
const BET = "Gammafoods' Rs 900 cr brand bet";
const BET_D = 'Gammafoods will invest Rs 900 crore in the snack brand across 4 outlets. Rs 645 crore is planned for distribution and Rs 452 crore for marketing.';

describe('zzz850 already-reported earnings result', () => {
  const r = run({ title: RESULT });
  test('classified as an earnings result, not an operating inflection', () => {
    assert.equal(r.kind, 'EARNINGS_RESULT');
    assert.equal(r.eventConfirmation, 'REPORTED_RESULT');
    assert.equal(r.earningsImpactStatus, 'REPORTED_RESULT');
  });
  test('badges say it is the earnings result, not "not yet in the numbers"', () => {
    const b = statusBadges(r);
    assert.equal(b[0].label, 'Already reported earnings result (secondary-reported, filing not read)');
    assert.equal(b[2].label, 'Reported - this is the earnings result');
    assert.ok(!/not yet in the numbers/i.test(JSON.stringify(b)));
  });
  test('no "not yet visible in reported earnings" text anywhere on a reported result', () => {
    assert.ok(!/not yet visible in reported earnings/i.test(blob(r)));
  });
  test('weakest link and next proof are durability and the driver; cause unknown unless stated', () => {
    assert.match(r.weakestUnprovenLink || '', /next quarter/i);
    assert.match(r.weakestUnprovenLink || '', /price, volume or cost/i);
    assert.notEqual(r.weakestUnprovenLink, 'revenue');
    assert.match(r.proof.what, /second and third quarter/i);
    assert.match(r.proof.what, /price, volume or cost/i);
    assert.match(r.resultDriverNote || '', /not stated/i);
    const stated = run({ title: 'Alphacorp profit triples in June quarter, driven by higher realisations' });
    assert.match(stated.resultDriverNote || '', /gives a cause/i);
  });
  test('stays media-only: stage 1 Reported, hypothesis evidence, never Validated', () => {
    assert.equal(r.eventEvidence, 'SECONDARY_REPORTED');
    assert.equal(r.stageNumber, 1);
    assert.equal(r.stageLabel, 'Reported');
    assert.ok(!/validated/i.test(blob(r)));
    // zzz854: a secondary-only result headline is 'Earnings result (unverified)': no earnings link until the filing is read
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.equal(r.resultLabel, 'Earnings result (unverified)');
  });
  test('a price reaction stays context only', () => {
    const p = run({ title: `${RESULT}; shares jump 6% today` });
    assert.ok(p.priceResponse);
    assert.ok(!/6%/.test(p.financialImpact));
    assert.ok(!/6%/.test(JSON.stringify(p.impacts)));
    assert.match(strip(card(p)), /Price response \(not evidence\)/);
  });
  test('a US result reads the same way', () => {
    const u = analyseRadarItem({ id: 'u', ticker: 'OMEG', company: 'Omegatech', region: 'US', title: 'Omegatech reports Q2 net income up 40% on record revenue', sourceLabel: 'Reuters' } as RadarInput);
    assert.equal(u.kind, 'EARNINGS_RESULT');
    assert.ok(!/not yet visible in reported earnings/i.test(blob(u)));
  });
  test('a preview of a result is not a reported result', () => {
    const v = run({ title: 'Alphacorp expected to report profit growth in June quarter results' });
    assert.notEqual(v.eventConfirmation, 'REPORTED_RESULT');
  });
});

describe('zzz850 acquisition: deal value and capacity are not earnings', () => {
  const r = run({ title: ACQ, description: ACQ_D });
  test('earnings link not established, not near-direct', () => {
    assert.equal(r.kind, 'SPECIAL_SITUATION');
    assert.equal(r.subKind, 'ACQUISITION');
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.equal(r.financialTransmission, 'NOT_ESTABLISHED');
    assert.notEqual(r.quantificationStatus, 'PARTIALLY_QUANTIFIED');
    assert.notEqual(r.quantificationStatus, 'QUANTIFIED');
    assert.ok(!/Near-direct/.test(strip(card(r))));
  });
  test('amounts are labelled as deal facts, never as "The source states"', () => {
    assert.match(r.financialImpact, /Deal value Rs 2,400 cr/);
    assert.match(r.financialImpact, /Capacity acquired 500 MW/);
    assert.ok(!/The source states/.test(r.financialImpact));
    assert.deepEqual(r.dealFacts, ['Deal value Rs 2,400 cr', 'Capacity acquired 500 MW']);
    assert.equal(r.economicEvidence, 'NOT_ESTABLISHED');
  });
  test('capacity acquired does not move the chain', () => {
    assert.ok(r.provenThrough <= 0, String(r.provenThrough));
    const cap = (r.catalystChain || []).find((l) => l.link === 'CAPACITY');
    assert.ok(!cap || cap.status !== 'PROVEN');
    assert.ok(!(r.catalystChain || []).some((l) => ['DRIVER', 'COMPANY_ADVANTAGE', 'VOLUME', 'REVENUE', 'EBITDA', 'EARNINGS'].includes(l.link) && (l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN')));
    assert.ok(!/proven through step [2-9]/i.test(strip(card(r))));
  });
  test('ledger blocks it: earnings link not established', () => {
    assert.equal(r.ledgerEligible, false);
    assert.ok((r.ledgerBlockers || []).includes('Earnings link not established'));
  });
  test('a confirmed event (primary source) still has no earnings link', () => {
    const p = run({ title: ACQ, description: ACQ_D, sourceLabel: 'NSE filing', primarySource: true });
    assert.equal(p.eventEvidence, 'PRIMARY_CONFIRMED');
    assert.equal(p.economicEvidence, 'NOT_ESTABLISHED');
    assert.equal(p.link, 'NOT_ESTABLISHED');
    assert.equal(p.stageNumber, 3);
    assert.equal(p.stageLabel, 'Confirmed by company or filing');
    assert.ok((p.ledgerBlockers || []).includes('Earnings link not established'));
  });
  test('zzz852: the acquired business revenue / EBITDA is the TARGET\'s figure; it is shown with its owner and does not lift the acquirer link', () => {
    // changed assertion: zzz850 expected the block to lift. Number ownership now says a target or acquired-asset figure is never the parent's earnings.
    const q = run({ title: ACQ, description: `${ACQ_D} The acquired assets reported revenue of Rs 300 crore and EBITDA of Rs 240 crore last year.` });
    assert.equal(q.link, 'NOT_ESTABLISHED');
    assert.ok((q.ledgerBlockers || []).includes('Earnings link not established'));
    assert.ok((q.numberLines || []).some((l) => /Rs 300 cr.*, not /.test(l)), JSON.stringify(q.numberLines));
  });
  test('US deal in dollars behaves the same', () => {
    const u = analyseRadarItem({ id: 'u', ticker: 'OMEG', company: 'Omegatech', region: 'US', title: 'Omegatech to acquire 300 MW solar assets for $450 million', sourceLabel: 'Reuters' } as RadarInput);
    assert.equal(u.link, 'NOT_ESTABLISHED');
    assert.match(u.financialImpact, /Deal value \$450 million/);
    assert.match(u.financialImpact, /Capacity acquired 300 MW/);
  });
});

describe('zzz850 investment / brand bet: an investment number is not company revenue', () => {
  const outlets = ['Daily Alpha', 'Beta Times', 'Gamma Post', 'Delta Wire'].map((l, i) => ({
    label: l, url: `https://${l.toLowerCase().replace(/ /g, '')}.example/a${i}`, title: i === 0 ? BET : `${BET} on the snack label, ${['', 'by Rs 900 crore', 'for 4 outlets', 'news'][i]}`,
  }));
  const r = run({ title: BET, description: BET_D, sources: outlets, sourceLabel: 'Daily Alpha' });
  test('not near-direct, not quantified', () => {
    assert.notEqual(r.link, 'NEAR_DIRECT');
    assert.notEqual(r.link, 'DIRECT');
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.equal(r.quantificationStatus, 'NO_FINANCIAL_LINK');
    const t = strip(card(r));
    assert.ok(!/Near-direct/.test(t));
    assert.ok(!/partly quantified/i.test(t));
    assert.match(r.financialImpact, /Investment Rs 900 cr/);
  });
  test('four outlets repeating one story are one independent source, not "Strong"', () => {
    assert.equal(r.evidence.independentSources, 1);
    assert.equal(r.evidence.sourceCount, 4);
    assert.notEqual(r.evidence.status, 'STRONG');
    assert.notEqual(r.evidence.status, 'CONFIRMED');
    assert.equal(r.eventEvidence, 'SECONDARY_REPORTED');
  });
  test('two truly different media reports can reach Strong, a primary can confirm', () => {
    const two = run({ title: 'Zetacorp wins long-term supply contract', sourceLabel: 'Daily Alpha', sources: [
      { label: 'Daily Alpha', url: 'https://dailyalpha.example/1', title: 'Zetacorp wins long-term supply contract' },
      { label: 'Beta Times', url: 'https://betatimes.example/9', title: 'Plant maker bags offtake deal from refiner, says management' },
    ] });
    assert.equal(two.evidence.independentSources, 2);
  });
});

describe('zzz850 a real operating statement still counts', () => {
  const r = run({ title: 'Deltaworks commissions new plant', description: 'Deltaworks reported revenue of Rs 300 crore from the new plant.' });
  test('revenue of Rs 300 crore from the new plant is near-direct or direct', () => {
    assert.ok(r.link === 'DIRECT' || r.link === 'NEAR_DIRECT', r.link);
    assert.notEqual(r.quantificationStatus, 'NO_FINANCIAL_LINK');
    assert.match(r.impacts?.revenue || '', /300 crore/);
    assert.deepEqual(r.dealFacts, []);
    assert.notEqual(r.economicEvidence, 'NOT_ESTABLISHED');
  });
});

describe('zzz850 event evidence and economic evidence are separate lines', () => {
  test('lines and labels', () => {
    assert.deepEqual(evidenceLines(run({ title: ACQ, description: ACQ_D })), { event: 'Secondary-reported', economic: 'Not established' });
    assert.deepEqual(evidenceLines(run({ title: ACQ, description: ACQ_D, sourceLabel: 'NSE filing', primarySource: true })), { event: 'Primary-confirmed', economic: 'Not established' });
    assert.equal(evidenceLines(run({ title: 'Epsilonic wins order worth Rs 400 crore', sourceLabel: 'NSE filing', primarySource: true })).economic !== 'Not established', true);
  });
  test('the card prints both lines', () => {
    const t = strip(card(run({ title: ACQ, description: ACQ_D })));
    assert.match(t, /Event evidence/);
    assert.match(t, /Secondary-reported/);
    assert.match(t, /Economic evidence/);
    assert.match(t, /Not established/);
  });
});

describe('zzz850 stage wording', () => {
  test('ladder labels', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => STAGE_LABEL[n]), [
      'Reported', 'Reported by several outlets (unconfirmed)', 'Confirmed by company or filing', 'Quantified', 'Delivering in results', 'Repeated', 'Proven over several periods']);
  });
  test('media-only is never labelled Validated; several independent outlets read stage 2', () => {
    const one = run({ title: 'Zetacorp wins supply contract worth Rs 400 crore' });
    assert.equal(one.stageNumber, 1);
    const two = run({ title: 'Zetacorp wins supply contract worth Rs 400 crore', sources: [
      { label: 'Daily Alpha', url: 'https://dailyalpha.example/1', title: 'Zetacorp wins supply contract worth Rs 400 crore' },
      { label: 'Beta Times', url: 'https://betatimes.example/9', title: 'Plant maker bags offtake deal from refiner, says management' },
    ] });
    assert.equal(two.stageNumber, 2);
    assert.equal(two.stageLabel, 'Reported by several outlets (unconfirmed)');
    for (const r of [one, two]) assert.ok(!/validated/i.test(strip(card(r))));
    assert.ok(!/validated/i.test(MATURITY_LABEL.VALIDATED));
  });
  test('a primary source lifts to stage 3; text reads Stage N of 7 (label)', () => {
    const p = run({ title: 'Zetacorp wins supply contract', sourceLabel: 'NSE filing', primarySource: true });
    assert.equal(p.stageNumber, 3);
    assert.equal(progressionText(p), 'Stage 3 of 7 (Confirmed by company or filing)');
  });
  test('the numeric progression field is kept for consumers', () => {
    const r = run({ title: 'Zetacorp wins supply contract', sourceLabel: 'NSE filing', primarySource: true });
    assert.equal(typeof r.catalystProgression, 'number');
    assert.ok(r.catalystMaturity);
  });
});

describe('zzz850 no empty or N/A chain rows', () => {
  test('N/A links collapse into one line', () => {
    const c = collapseChain([{ status: 'PROVEN', k: 'a' }, { status: 'NOT_APPLICABLE', k: 'b' }, { status: 'NOT_APPLICABLE', k: 'c' }], (l) => l.k);
    assert.equal(c.shown.length, 1);
    assert.equal(c.notApplicable, 'Not applicable: b, c');
    assert.equal(collapseChain([{ status: 'PROVEN', k: 'a' }], (l) => l.k).notApplicable, null);
  });
  test('rendered card has one Not applicable line and no "N/A" chips', () => {
    const t = strip(card(run({ title: RESULT })));
    assert.equal((t.match(/Not applicable:/g) || []).length, 1);
    assert.ok(!/N\/A/.test(t));
  });
});

describe('zzz850 rules still hold', () => {
  test('no buy / sell / score wording and no price in the fundamentals', () => {
    for (const r of [run({ title: RESULT }), run({ title: ACQ, description: ACQ_D }), run({ title: BET, description: BET_D })]) {
      const t = strip(card(r));
      assert.ok(!/\b(BUY|SELL)\b/.test(t));
      assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(t));
    }
  });
});
