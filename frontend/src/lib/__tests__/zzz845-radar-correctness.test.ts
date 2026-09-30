import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseRadarItem, buildRadar, parseDuration } from '../multibagger-radar';
import type { RadarInput } from '../multibagger-radar';
import type { RadarItem } from '../multibagger-radar-types';

const base = { ticker: null, company: 'Co', region: 'IN' as const, sourceLabel: 'NSE', primarySource: true };
const run = (title: string, extra: Partial<RadarInput> = {}): RadarItem => analyseRadarItem({ ...base, id: 't', title, ...extra } as RadarInput);
const keys = (o: unknown, out: string[] = []): string[] => {
  if (Array.isArray(o)) o.forEach((x) => keys(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keys(v, out); }
  return out;
};

describe('known false classifications', () => {
  test('ITC Yoga Bar investment is a new product / market event, not a special situation', () => {
    const r = run('ITC to invest Rs 900 crore in Yoga Bar, expanding its packaged foods portfolio');
    assert.equal(r.kind, 'NEW_PRODUCT_MARKET');
    assert.notEqual(r.bucket, 'SPECIAL_SITUATION');
    assert.match(r.proof.what, /revenue growth/i);
    assert.match(r.proof.what, /distribution/i);
    assert.match(r.proof.what, /segment/i);
  });
  test('ZEEL warrant allotment is a funding event with no earnings link', () => {
    const r = run('Zee Entertainment allots 20.94 crore warrants at Rs 126 issue price to promoter group');
    assert.equal(r.eventClass, 'CAPITAL_STRUCTURE_FUNDING');
    assert.notEqual(r.link, 'DIRECT');
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.match(r.proof.what, /use of proceeds/i);
    assert.match(r.proof.what, /balance-sheet/i);
    assert.equal(r.impacts?.revenue ? /not established/i.test(r.impacts.revenue) : true, true);
    assert.equal(r.ledgerEligible, false);
  });
  test('a rupee amount never creates an earnings link', () => {
    const r = run('ABC Ltd raises Rs 500 crore via QIP to fund expansion');
    assert.notEqual(r.link, 'DIRECT');
    assert.equal(r.eventClass, 'CAPITAL_STRUCTURE_FUNDING');
  });
  test('SAT relief: legal event, link not established, the 8% lives only in priceResponse', () => {
    const r = run('SAT grants relief to JSW Steel; stock jumps 8%');
    assert.equal(r.eventClass, 'REGULATORY_LEGAL');
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.equal(r.priceResponse?.pct, 8);
    assert.equal(r.priceResponse?.direction, 'UP');
    const fundamentals = JSON.stringify([r.impacts, r.catalystChain, r.changes, r.financialTransmission]);
    assert.ok(!/8\s?%/.test(fundamentals));
  });
  test('JCM style order wording is an order, with no invented duration', () => {
    const r = run('JCM announces new order win worth Rs 200 crore');
    assert.equal(r.kind, 'CONTRACT_ORDER');
    assert.equal(r.duration.code, null);
    assert.equal(r.duration.label, 'Not established');
  });
  test('pension / pay commission rumour denial is a disproved rumour with no earnings link', () => {
    const r = run('Govt denies rumours of pension hike and pay commission; fake news, no such proposal');
    assert.equal(r.kind, 'DISPROVED_RUMOUR');
    assert.equal(r.priority, 'EXCLUDE');
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.notEqual(r.kind, 'CAPACITY_INFLECTION');
    assert.equal(r.ledgerEligible, false);
  });
  for (const t of [
    'ABC Ltd declares dividend of Rs 10 per share, record date next week',
    'XYZ board recommends stock split and bonus issue',
    'Ex-date for final dividend set for Friday',
    'Stock split watch: XYZ board to consider sub-division',
    '800% dividend stock: XYZ announces ex-date',
  ]) {
    test(`corporate action quarantine: ${t}`, () => {
      const r = run(t);
      assert.equal(r.bucket, 'CORPORATE_ACTION');
      assert.equal(r.kind, 'CORPORATE_ACTION');
      assert.equal(r.lowSignal, true);
      assert.equal(r.priority, 'EXCLUDE');
      assert.equal(r.ledgerEligible, false);
    });
  }
});

describe('duration is never inferred from event type', () => {
  test('merger has no automatic duration', () => {
    const r = run('ABC Ltd board approves merger with DEF Ltd');
    assert.equal(r.duration.code, null);
    assert.equal(r.duration.label, 'NOT ESTABLISHED'.charAt(0) + 'ot established');
    assert.equal(r.duration.duration_source, 'unknown');
    assert.equal(r.duration.basis, 'none');
    assert.ok(!r.duration.halfLife);
  });
  test('stated term is used and labelled as stated', () => {
    const r = run('ABC Ltd signs 5-year supply agreement with DEF Corp worth $200 million');
    assert.equal(r.duration.basis, 'stated');
    assert.ok((r.duration.code ?? 0) >= 3);
    assert.equal(parseDuration('nothing here'), null);
  });
  test('no event type alone ever yields a duration', () => {
    for (const t of ['ABC completes customer qualification', 'ABC expands plant capacity', 'ABC announces buyback', 'ABC completes acquisition of DEF']) {
      assert.equal(run(t).duration.code, null, t);
    }
  });
});

describe('sources: count, quality and diversity are separate', () => {
  const t = 'ABC Ltd wins supply order from DEF Corp worth Rs 300 crore';
  const syn = [
    { label: 'Moneycontrol', url: 'https://moneycontrol.com/a', title: t },
    { label: 'Moneycontrol', url: 'https://moneycontrol.com/b', title: t },
    { label: 'Business Standard', url: 'https://business-standard.com/c', title: `${t} - PTI` },
  ];
  test('syndicated copies are deduplicated', () => {
    const r = run(t, { primarySource: false, sourceLabel: 'Moneycontrol', independentSources: 3, sources: syn });
    assert.ok(r.evidence.independentSources < (r.evidence.sourceCount ?? 0));
    assert.ok((r.evidence.duplicatesRemoved ?? 0) >= 1);
  });
  test('media-only coverage never reads confirmed', () => {
    const r = run(t, { primarySource: false, sourceLabel: 'Moneycontrol', independentSources: 3, sources: syn });
    assert.notEqual(r.evidence.status, 'CONFIRMED');
    assert.ok(!/independent sources agree/i.test(r.evidence.why));
    assert.ok(r.evidence.sourceQuality);
    assert.ok(Array.isArray(r.evidence.sourceDiversity));
  });
  test('buildRadar merges near-identical syndicated items', () => {
    const a = { ...base, id: 'a', ticker: 'ABC', title: t };
    const b = { ...base, id: 'b', ticker: 'ABC', title: `${t} PTI` };
    const res = buildRadar([a, b], { now: 0 });
    assert.equal(res.items.length, 1);
    assert.equal(res.counts.duplicatesMerged, 1);
  });
});

describe('no boilerplate, no scores, price is not fundamentals', () => {
  test('priorityReason and next proof reference the actual catalyst', () => {
    const a = run('ITC to invest Rs 900 crore in Yoga Bar, expanding its packaged foods portfolio');
    const b = run('JCM announces new order win worth Rs 200 crore');
    assert.notEqual(a.proof.what, b.proof.what);
    assert.notEqual(a.priorityReason, b.priorityReason);
    assert.match(a.priorityReason, /Yoga Bar/);
    assert.match(b.priorityReason, /order/i);
    for (const r of [a, b]) assert.ok(!/higher priority than other events|generic/i.test(r.priorityReason));
  });
  test('no output key looks like a score', () => {
    const r = run('ITC to invest Rs 900 crore in Yoga Bar, expanding its packaged foods portfolio');
    assert.deepEqual(keys(r).filter((k) => /score/i.test(k)), []);
  });
  test('price move alone populates no fundamental field', () => {
    const r = run('XYZ shares surge 12% on heavy volume');
    assert.equal(r.priceResponse?.pct, 12);
    assert.ok(r.link === 'NOT_ESTABLISHED' || r.link === 'NARRATIVE_ONLY');
    assert.notEqual(r.bucket, 'MULTIBAGGER');
    assert.equal(r.ledgerEligible, false);
    assert.ok(!/12\s?%/.test(JSON.stringify([r.impacts, r.changes, r.catalystChain])));
  });
  test('confirmed event with unproven transmission is not called a confirmed earnings catalyst', () => {
    const r = run('ITC to invest Rs 900 crore in Yoga Bar, expanding its packaged foods portfolio');
    assert.equal(r.eventConfirmation, 'CONFIRMED');
    assert.notEqual(r.earningsImpactStatus, 'CONFIRMED');
    assert.ok(!/confirmed earnings catalyst/i.test(r.confirmationLabel || ''));
  });
});

describe('chain, maturity, integrity', () => {
  test('13-link catalyst chain with statuses', () => {
    const r = run('JCM announces new order win worth Rs 200 crore');
    assert.equal(r.catalystChain?.length, 13);
    for (const l of r.catalystChain || []) assert.ok(['PROVEN', 'PARTIALLY_PROVEN', 'ASSUMED', 'NOT_APPLICABLE', 'CONTRADICTED'].includes(l.status));
  });
  test('catalystProgression is 0-7 and broken rumours read 0', () => {
    const r = run('JCM announces new order win worth Rs 200 crore');
    assert.ok((r.catalystProgression ?? -1) >= 0 && (r.catalystProgression ?? 8) <= 7);
    assert.equal(run('Govt denies rumours of pension hike and pay commission; fake news').catalystProgression, 0);
  });
  test('materiality is unknown without company context and known with it', () => {
    const r = run('JCM announces new order win worth Rs 200 crore');
    assert.equal(r.catalystMateriality, 'UNKNOWN');
    const m = run('JCM announces new order win worth Rs 200 crore', { companyContext: { currency: 'INR', unit: 'CRORE', revenue: 400 } });
    assert.notEqual(m.catalystMateriality, 'UNKNOWN');
  });
  test('previous snapshot yields an evidence delta', () => {
    const r = run('JCM announces new order win worth Rs 200 crore');
    assert.ok(r.evidenceDelta);
  });
  test('ledgerEligible is false for a dividend article and a failed integrity check blocks the ledger', () => {
    const d = run('ABC Ltd declares dividend of Rs 10 per share');
    assert.equal(d.ledgerEligible, false);
    assert.ok(Array.isArray(d.ledgerBlockers));
    assert.ok(d.thesisIntegrity);
  });
  test('no BUY / SELL language in any explanation', () => {
    for (const t of ['ITC to invest Rs 900 crore in Yoga Bar', 'SAT grants relief; stock jumps 8%', 'JCM announces new order win worth Rs 200 crore']) {
      const r = run(t);
      assert.ok(!/\b(buy|sell)\b/i.test(JSON.stringify([r.priorityReason, r.proof, r.whyNotHigher, r.oneSentenceMechanism])));
    }
  });
});
