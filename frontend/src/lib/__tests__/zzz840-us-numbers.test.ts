import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUsEarnings, reconcileEarnings, statedRevenueGrowth, readUsOther, buildUsCard, sentencesOf } from '../ai-gainers/us-card';
import { classifyUsEvents } from '../ai-gainers/us-event-taxonomy';
import { repairSplitText, parseAmountsM, parseRangeM, guidanceRaiseAmountM, pickPrimaryCatalyst } from '../ai-gainers/us-text-guards';

// ── 1. earnings: stated growth / prior beats a mis-read table pair ──
const RELEASE = 'Zorvex Holdings Reports Third Quarter Results. Total net revenues rose 19.5% to $7.9 billion for the quarter ended June 30, 2026. Net earnings per diluted share of $1.16 versus $0.64 in the prior year period, an increase of 81.3%.';
const TABLE = '<p>(in millions, except per share)</p><table><tr><td></td><td>Three Months Ended June 30, 2026</td><td>Three Months Ended June 30, 2025</td></tr>'
  + '<tr><td>Total net revenues</td><td>7,878.0</td><td>100.0</td></tr><tr><td>Net earnings</td><td>165.3</td><td>2.1</td></tr>'
  + '<tr><td>Diluted earnings per share</td><td>1.16</td><td>0.64</td></tr></table>';

test('stated revenue growth is read from the sentence', () => {
  assert.equal(statedRevenueGrowth(RELEASE), 19.5);
  assert.equal(statedRevenueGrowth('Net sales decreased 4.2% to $310 million.'), -4.2);
});

test('implausible table pair is dropped: stated % shown, comparison conflicting, EPS pair used', () => {
  const e = readUsEarnings({ text: RELEASE, html: TABLE })!;
  assert.ok(e);
  assert.equal(e.revenueGrowthPct, 19.5);
  assert.equal(e.comparison, 'conflicting');
  assert.equal(e.revenue?.prev ?? null, null);
  assert.ok(!/7777|78\.7/.test(JSON.stringify(e)), 'no 7777.9% / 78.7x anywhere');
  assert.equal(e.netIncome?.prev ?? null, null);
  assert.ok(!/small base/.test(e.profitChange || ''));
  assert.equal(e.eps?.cur, 1.16);
  assert.equal(e.eps?.prev, 0.64);
});

test('reconcile: computed growth >1000% with no stated % is dropped', () => {
  const r = reconcileEarnings({ revenue: { cur: 500, prev: 20 }, netIncome: { cur: 10, prev: 1 }, eps: null }, 'Synthetic Corp announced results.');
  assert.equal(r.comparison, 'conflicting');
  assert.equal(r.revenueGrowthPct, null);
  assert.equal(r.base.revenue?.prev, null);
});

test('reconcile: pair that agrees with the stated % is kept', () => {
  const r = reconcileEarnings({ revenue: { cur: 120, prev: 100 }, netIncome: null, eps: null }, 'Revenue increased 20.0% to $120 million.');
  assert.equal(r.comparison, 'computed');
  assert.equal(r.base.revenue?.prev, 100);
  assert.equal(r.revenueGrowthPct, 20);
});

// ── 2. negation guards ──
test('"did not repurchase" is not a buyback catalyst', () => {
  const t = 'During the quarter we did not repurchase any shares of our common stock pursuant to our share repurchase program, which has $50 million remaining.';
  assert.ok(!classifyUsEvents(t).some((h) => h.id === 'buyback'));
  assert.equal(readUsOther(t), null);
  assert.ok(!classifyUsEvents('The Company had no shares repurchased under the share repurchase program during the period.').some((h) => h.id === 'buyback'));
  assert.ok(classifyUsEvents('The Board authorized a new share repurchase program of up to $50 million.').some((h) => h.id === 'buyback'));
});

test('other negated triggers do not fire', () => {
  assert.ok(!classifyUsEvents('The Company did not raise its full-year guidance and has not entered into any material acquisition agreement.').some((h) => h.id === 'guidance_raise' || h.id === 'acquisition'));
  assert.ok(classifyUsEvents('The Company entered into a definitive agreement to acquire Kelmar Systems for $40 million in cash.').some((h) => h.id === 'acquisition'));
});

// ── 3. amounts ──
test('full-dollar and scaled amounts parse to $ millions', () => {
  assert.equal(parseAmountsM('a licence fee of $12,000,000')[0].m, 12);
  assert.equal(parseAmountsM('authorized up to US$2,000,000')[0].m, 2);
  assert.equal(parseAmountsM('$50.0 million convertible notes')[0].m, 50);
  assert.equal(parseAmountsM('$1.2 billion')[0].m, 1200);
  assert.equal(parseAmountsM('a dividend of $58,350,533')[0].m, 58.350533);
  assert.equal(parseAmountsM('EPS of $0.64').length, 0);
  assert.equal(parseRangeM('guidance of $410 to $420 Million')!.midM, 415);
  assert.equal(parseRangeM('$1.2 billion to $800 million'), null);
  assert.equal(guidanceRaiseAmountM('The company raised guidance by $55 million at the midpoint.')!.m, 55);
});

function mk(text: string, mcap = 400) {
  return buildUsCard({
    ticker: 'ZZZ', company: 'Zorvex Holdings', marketCapM: mcap,
    filing: { form: '8-K', items: ['7.01', '8.01'], date: '2026-09-28', url: 'https://example.test/f', subject: 'x' },
    docs: [{ role: 'ex99', url: 'https://example.test/ex99', text: `${text} ${'The Company is headquartered in a synthetic city and serves customers worldwide. '.repeat(3)}` }], secChecked: true,
  });
}

test('materiality is computed for full-dollar amounts (licence, buyback, notes, dividend)', () => {
  const lic = mk('Zorvex Holdings announced today that it entered into a licensing agreement with Kelmar Bio under which Kelmar will pay an upfront licence fee of $12,000,000 for exclusive rights.')!;
  assert.notEqual(lic.material.label, 'UNKNOWN');
  assert.ok(/12/.test(lic.material.how) && /400/.test(lic.material.how) && /3%/.test(lic.material.how), lic.material.how);
  const bb = mk('Zorvex Holdings announced today that its Board authorized a share repurchase program of up to US$2,000,000 of its common stock.')!;
  assert.notEqual(bb.material.label, 'UNKNOWN');
  assert.ok(/0\.5%/.test(bb.material.how), bb.material.how);
  const cv = mk('Zorvex Holdings announced today the pricing of $50.0 million aggregate principal amount of convertible senior notes due 2031.')!;
  assert.notEqual(cv.material.label, 'UNKNOWN');
  const dv = mk('Zorvex Holdings announced today that it increased its quarterly cash dividend, for an aggregate payment of $58,350,533 to stockholders of record.')!;
  assert.notEqual(dv.material.label, 'UNKNOWN');
  assert.ok(/58\.4|58\.35/.test(dv.material.how), dv.material.how);
});

test('UNKNOWN stays when no amount is stated', () => {
  const c = mk('Zorvex Holdings announced today a licensing agreement with Kelmar Bio for exclusive rights in Europe. The agreement covers development, manufacturing and commercialisation of the product across all member states of the European Union.')!;
  assert.equal(c.material.label, 'UNKNOWN');
});

// ── 4. split text ──
test('split month names and years are repaired', () => {
  assert.equal(repairSplitText('On Septemb er 28, 2 026, the Company signed'), 'On September 28, 2026, the Company signed');
  assert.equal(repairSplitText('effective Octob er 1, 20 26.'), 'effective October 1, 2026.');
  assert.equal(repairSplitText('fiscal 20 27 outlook'), 'fiscal 2027 outlook');
  assert.equal(repairSplitText('We sold 20 26 units and 5 000 cases'), 'We sold 20 26 units and 5 000 cases');
  assert.equal(repairSplitText('The Board met on the 12 members list'), 'The Board met on the 12 members list');
  assert.ok(sentencesOf('On Septemb er 28, 2 026 the Company entered into an agreement with Kelmar.')[0].includes('September 28, 2026'));
});

// ── 5. boilerplate vs news ──
const BG = 'Zorvex Holdings today announced updated guidance. Voxel-9 is the first FDA-approved therapy for the condition and is now approved in three markets. The Company raised its full-year 2026 revenue guidance to $410 million to $420 million, from the prior range of $350 million to $370 million, an increase of $55 million at the midpoint.';
test('background approval is not an FDA event; guidance raise is the headline', () => {
  const hits = classifyUsEvents(BG);
  assert.ok(!hits.some((h) => h.id === 'fda_approval'));
  assert.ok(hits.some((h) => h.id === 'guidance_raise'));
  const r = readUsOther(BG)!;
  assert.equal(r.kind, 'guidance');
  assert.ok(/410/.test(r.line) && /420/.test(r.line) && /350/.test(r.line) && /55/.test(r.line), r.line);
  const c = mk(BG)!;
  assert.ok(!/FDA/.test(c.kindWord), c.kindWord);
  assert.ok(/guidance/i.test(c.kindWord));
});

test('a current-period FDA approval still counts', () => {
  const t = 'Zorvex Holdings announced today that the U.S. Food and Drug Administration approved Voxel-9 for adults with plaque psoriasis.';
  assert.ok(classifyUsEvents(t).some((h) => h.id === 'fda_approval'));
  assert.equal(readUsOther(t)!.kind, 'fda');
});

test('pickPrimaryCatalyst ranks quantified guidance above an unquantified background mention', () => {
  const p = pickPrimaryCatalyst([
    { id: 'partnership', sentence: 'Voxel-9 is the first approved therapy, now approved in three markets.' },
    { id: 'guidance_raise', sentence: 'The Company raised guidance to $410 million to $420 million.', figures: ['$410 million'] },
  ]);
  assert.equal(p!.id, 'guidance_raise');
});
