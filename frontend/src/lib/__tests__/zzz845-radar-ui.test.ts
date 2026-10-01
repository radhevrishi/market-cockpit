// zzz845 - radar UI helpers and rendered card: blank-section suppression, fallbacks, wording. Synthetic names only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RadarItem } from '../multibagger-radar-types';
import { buildRadar } from '../multibagger-radar';
import { RadarCard, RadarRow } from '../../components/special-situations/RadarCard';
import {
  NOT_YET, PRICE_BLOCK_LABEL, QUARANTINE_BUCKETS, PRIMARY_BUCKETS, durationLine, forbiddenWording, isOneLine, oneLineRow, orNotYet, populatedSections, progressionText,
  sourcesLine, statusBadges,
} from '../../components/special-situations/radar-tokens';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

function base(over: Partial<RadarItem> = {}): RadarItem {
  return {
    id: 'x1', ticker: 'ZETA', company: 'Zetacorp', region: 'US', bucket: 'EARNINGS_INFLECTION', kind: 'CONTRACT_ORDER', event: 'Zetacorp signs a supply agreement', whyItMatters: 'Adds booked revenue.',
    changes: ['revenue'], mechanism: '', financialImpact: '', duration: { code: null, label: '', basis: 'none', evidence: '' },
    evidence: { status: 'DEVELOPING', sourceRank: 1, sourceLabel: 'Exchange filing', why: 'Filing states the order.', independentSources: 1 },
    link: 'NOT_ESTABLISHED', inflection: 'NOT_ASSESSED', chain: [], provenThrough: -1, bottleneckQuestion: null,
    proof: { what: '', when: null, kind: 'result' }, breakConditions: [], expectations: { state: 'NOT_ASSESSED', note: 'Not assessed' }, valuationContext: 'Not assessed',
    technical: { note: null }, governance: { status: 'NOT_CHECKED', flags: [], note: '' }, drivers: [], priority: 'MEDIUM', priorityReason: 'Needs homework.', lowSignal: false,
    sourceUrl: null, publishedAt: null, feedEventId: null, ...over,
  } as RadarItem;
}
const card = (item: RadarItem, held = false) => renderToStaticMarkup(React.createElement(RadarCard as any, { item, held, ledgerIds: new Set<string>(), onSaveLedger: () => {}, now: '2026-09-30T00:00:00Z' }));

describe('zzz845 blank-section suppression', () => {
  test('empty item: only core sections, optional ones are absent', () => {
    const s = populatedSections(base());
    for (const k of ['catalyst', 'whyNow', 'evidence', 'earnings', 'duration', 'nextProof', 'priority', 'portfolio']) assert.ok(s.includes(k as any), k);
    for (const k of ['expectations', 'valuation', 'price', 'chain', 'scope', 'maturity', 'materiality', 'breaks', 'mechanism']) assert.ok(!s.includes(k as any), k);
    const t = strip(card(base()));
    assert.ok(!/Price response/.test(t));
    assert.ok(!/Expectations/.test(t) && !/Valuation context/.test(t));
  });
  test('populated fields appear', () => {
    const it = base({
      expectations: { state: 'EARLY_STAGE', note: 'Early stage.' }, valuationContext: 'Needs 20% growth.', priceResponse: { text: 'Up 8% on the day.', pct: 8, direction: 'UP', note: '' },
      evidence: { status: 'STRONG', sourceRank: 1, sourceLabel: 'Filing', why: 'w', independentSources: 2, sourceCount: 5, duplicatesRemoved: 3 },
      evidenceScope: { confirmed: ['order signed'], notConfirmed: ['margin'] }, catalystMateriality: 'HIGH', catalystProgression: 3, catalystMaturity: 'DEVELOPING',
    });
    const s = populatedSections(it);
    for (const k of ['expectations', 'valuation', 'price', 'scope', 'materiality', 'maturity', 'sources']) assert.ok(s.includes(k as any), k);
    const t = strip(card(it));
    assert.match(t, /Confirmed: order signed/);
    assert.match(t, /Not confirmed: margin/);
    assert.match(t, /Stage 3 of 7 \(Developing\)/);
  });
  test('Not yet established fallback for core fields', () => {
    assert.equal(orNotYet(''), NOT_YET);
    assert.equal(orNotYet('   '), NOT_YET);
    assert.equal(orNotYet(null), NOT_YET);
    assert.equal(orNotYet(' a '), 'a');
    const t = strip(card(base({ proof: { what: '', when: null, kind: 'result' } })));
    assert.ok(t.includes(NOT_YET));
  });
});

describe('zzz845 wording and separation', () => {
  test('sources wording never says sources agree', () => {
    const l = sourcesLine({ independentSources: 2, sourceCount: 5, duplicatesRemoved: 3 });
    assert.match(l, /^5 sources · 2 independent · 3 syndicated copies removed/);
    assert.ok(!/agree/i.test(l));
    assert.match(sourcesLine({ independentSources: 1 }), /^1 source · 1 independent/);
  });
  test('price response sits in its own block with the not-evidence label', () => {
    assert.equal(PRICE_BLOCK_LABEL, 'Price response (not evidence)');
    const h = card(base({ priceResponse: { text: 'Up 8%.', pct: 8, direction: 'UP', note: '' } }));
    assert.ok(h.includes('data-radar-price'));
    const block = h.slice(h.indexOf('data-radar-price'));
    assert.ok(strip(block.slice(0, block.indexOf('</div></div>') + 12)).includes(PRICE_BLOCK_LABEL));
    // price text is not in any fundamental field
    assert.ok(!h.slice(0, h.indexOf('data-radar-price')).includes('Up 8%'));
  });
  test('three separate badges; a missing status is not a confirmed', () => {
    const b = statusBadges({ eventConfirmation: 'CONFIRMED', mechanismStatus: 'ASSUMED', earningsImpactStatus: 'UNPROVEN' });
    assert.deepEqual(b.map((x) => x.heading), ['Event', 'Mechanism', 'Earnings impact']);
    assert.equal(new Set(b.map((x) => x.label)).size, 3);
    const none = statusBadges({});
    assert.ok(none.every((x) => x.label === NOT_YET));
    const t = strip(card(base({ eventConfirmation: 'CONFIRMED', mechanismStatus: 'ASSUMED', earningsImpactStatus: 'NOT_ESTABLISHED' })));
    assert.match(t, /Event: Confirmed/);
    assert.match(t, /Mechanism: Assumed/);
    assert.match(t, /Earnings impact: Not established/);
  });
  test('duration: inferred is explicit, NOT ESTABLISHED otherwise', () => {
    assert.equal(durationLine({ code: null, label: '', basis: 'none', evidence: '' }), 'NOT ESTABLISHED');
    const d = durationLine({ code: 3, label: '4-8 quarters', basis: 'stated', evidence: 'Two-year contract.', duration_source: 'contract-stated', durationConfidence: 'HIGH', inferred: false });
    assert.match(d, /source: contract stated/); assert.match(d, /confidence: high/); assert.ok(!/inferred/.test(d));
    assert.match(durationLine({ code: 4, label: '2-5 years', basis: 'type', evidence: '', duration_source: 'structural-inference', inferred: true }), /inferred/);
  });
  test('progression text and ledger gating', () => {
    assert.equal(progressionText({}), null);
    assert.equal(progressionText({ catalystProgression: 9 }), 'Stage 7 of 7');
    assert.match(strip(card(base())), /Add to thesis ledger/);
    const blocked = strip(card(base({ ledgerEligible: false, ledgerBlockers: ['No next proof'] })));
    assert.ok(!/Add to thesis ledger/.test(blocked));
    assert.match(blocked, /No next proof/);
  });
  test('forbidden wording scan: helper and a fully populated card are clean', () => {
    assert.deepEqual(forbiddenWording('Ranked by research value.'), []);
    for (const bad of ['BUY now', 'a score of 7', '80/100', 'price target', '3 independent sources agree', 'undefined']) assert.ok(forbiddenWording(bad).length > 0, bad);
    const full = base({
      eventConfirmation: 'REPORTED', mechanismStatus: 'PARTIALLY_STATED', earningsImpactStatus: 'UNPROVEN', financialTransmission: 'INDIRECT', quantificationStatus: 'NOT_QUANTIFIED',
      catalystChain: [{ link: 'EVENT', status: 'PROVEN', evidence: 'e', source: 's', date: null, confidence: 'HIGH' }, { link: 'REVENUE', status: 'ASSUMED', evidence: null, source: null, date: null, confidence: 'LOW' },
        { link: 'FCF', status: 'NOT_APPLICABLE', evidence: null, source: null, date: null, confidence: 'UNKNOWN' }, { link: 'MARGIN', status: 'CONTRADICTED', evidence: null, source: null, date: null, confidence: 'LOW' },
        { link: 'CAPACITY', status: 'PARTIALLY_PROVEN', evidence: null, source: null, date: null, confidence: 'MEDIUM' }],
      oneSentenceMechanism: 'If the order ships, revenue should rise because volume is booked.', indicator: { type: 'LEADING', label: 'x' }, evidenceDelta: 'NEW_EVIDENCE',
      whyNotHigher: ['No numbers yet'], upgradeTrigger: 'First shipment', downgradeTrigger: 'Order cancelled', breakConditions: ['Order cancelled'],
      evidence: { status: 'DEVELOPING', sourceRank: 1, sourceLabel: 'Filing', why: 'w', independentSources: 2, sourceCount: 4, duplicatesRemoved: 2 },
    });
    const t = strip(card(full, true));
    assert.deepEqual(forbiddenWording(t), []);
    for (const w of ['PARTIALLY PROVEN', 'ASSUMED', 'CONTRADICTED', 'Not applicable: Free cash flow', 'PROVEN', 'Why not higher?', 'What would upgrade?', 'What would downgrade?', 'Leading indicator']) assert.ok(t.includes(w), w);
  });
});

describe('zzz845 one-line rows and tiers', () => {
  test('corporate-action row is one line with a false-positive tag', () => {
    const it = base({ bucket: 'CORPORATE_ACTION', kind: 'CORPORATE_ACTION', event: 'Zetacorp declares dividend', falsePositiveReason: 'CORPORATE_ACTION_ONLY', priority: 'EXCLUDE' });
    assert.ok(isOneLine(it));
    const r = oneLineRow(it);
    assert.equal(r.tag, 'corporate action only');
    assert.ok(!r.text.includes('\n'));
    assert.ok(r.text.length < 200);
    assert.ok(oneLineRow({ ...it, event: 'x'.repeat(500) }).what.length <= 110);
    const h = renderToStaticMarkup(React.createElement(RadarRow as any, { item: it }));
    assert.ok(!h.includes('<details') && !h.includes('Add to thesis ledger'));
    assert.match(strip(h), /Zetacorp declares dividend/);
    assert.ok(isOneLine(base({ bucket: 'NOISE' })) && !isOneLine(base()));
  });
  test('tiers: primary and quarantine do not overlap', () => {
    assert.deepEqual(PRIMARY_BUCKETS, ['MULTIBAGGER', 'EARNINGS_INFLECTION', 'BOTTLENECK']);
    assert.ok(QUARANTINE_BUCKETS.includes('CORPORATE_ACTION') && QUARANTINE_BUCKETS.includes('NOISE'));
    assert.ok(!QUARANTINE_BUCKETS.some((b) => PRIMARY_BUCKETS.includes(b)));
    void buildRadar;
  });
});
