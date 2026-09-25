// zzz802 — India Portfolio Catalysts: junk figures shown as evidence, the
// persistent strip above the wrong card, Special Focus listing a name that
// "no longer meets the gate", and a visible numeric Score column.
//
// Run: npx tsx --test src/lib/__tests__/zzz802-india-pc-figures.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { capexFigureOk, isBareRupeeAmount, isSubjectlessPercent, hasMoneyWithUnit } from '../thesis/figure-guards';
import { parseOneOff, oneOffLine } from '../thesis/one-offs';
import { assessThesis, croreOf, UNSCALED_AMOUNT_WORDS, statesNoOneOff } from '../thesis/status';
import { buildCapexChain } from '../thesis/capex-chain';
import { researchWhyLine } from '../thesis/evidence-counts';
import { splitDroppedOut } from '../catalyst/cross-view';
import { PersistentStrip } from '../../components/special-focus-panel';

(globalThis as any).React = React;
const ROOT = join(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, 'src', p), 'utf8');

const V = (key: string, verdict: string, o: { after?: string; delta?: string; source?: 'grader' | 'filing'; kind?: string; quote?: string } = {}) => ({
  key, label: key, before: null, after: o.after ?? null, delta: o.delta ?? null, quote: o.quote ?? null,
  verdict, evidence: `${key} evidence`, source: o.source ?? 'filing', kind: o.kind ?? 'fact', statement: 'ACTUAL',
}) as any;

describe('zzz802 · figure guards', () => {
  test('a capex figure needs money with a crore / lakh / mn / bn unit', () => {
    for (const ok of ['₹1,200 crore', 'INR 100-odd crores', 'Rs. 96.92* crores', '₹480+ Cr', 'INR1,500-2,000 crores', '1,200 crore', '₹13,000.00 Lakhs', 'INR 1.2 bn', 'USD 50 million'])
      assert.ok(capexFigureOk(ok), ok);
  });
  test('"announced 2% to 3%", "announced 25%": a percentage with no subject is rejected; one naming its subject in capex context passes', () => {
    for (const bad of ['2% to 3%', '25%', '~8-10%', '+2.5 pp']) { assert.ok(isSubjectlessPercent(bad), bad); assert.ok(!capexFigureOk(bad), bad); }
    assert.ok(capexFigureOk('capex of 2-3% of revenue'));
    assert.ok(!capexFigureOk('2-3% of revenue', null), 'a percentage of revenue with no capex context is not a capex figure');
  });
  test('an unscaled rupee amount looks like a per-share / price value — never money, never scaled', () => {
    for (const bad of ['Rs. 1,113.51', 'INR 25,804', '₹ 56', 'Rs 398.51']) {
      assert.ok(isBareRupeeAmount(bad), bad); assert.ok(!hasMoneyWithUnit(bad), bad); assert.ok(!capexFigureOk(bad), bad);
    }
    assert.equal(croreOf('Rs. 1,113.51'), null, 'no magnitude word → no crore figure invented');
    assert.equal(croreOf('INR22 crores'), 22);
    assert.equal(croreOf('Rs 250 lakh'), 2.5);
    assert.ok(!capexFigureOk('Rs3,00,000/- (Rupees Three Lakhs only) per annum as fees for cost audit'));
    assert.ok(!capexFigureOk('Phase II expansion'), 'words are not a figure');
  });
  test('parseOneOff drops an unscaled rupee amount; scaled amounts and bare counts are unchanged', () => {
    const d = parseOneOff('recorded the financial impact of Rs. 1,113.51 on employee benefit obligations — Exceptional item', 'Rs. 1,113.51');
    assert.equal(d.amount_raw, null); assert.equal(d.amount_cr, null);
    assert.doesNotMatch(oneOffLine(d), /1,113/);
    assert.equal(parseOneOff('VRS cost', 'Rs 250 lakh').amount_cr, 2.5);
    assert.equal(parseOneOff('Impairment of goodwill', '56').amount_raw, '56');
  });
});

describe('zzz802 · junk figures never reach the card', () => {
  const OUT = [V('revenue_growth', 'improving', { delta: '+6.6%', source: 'grader' }), V('earnings_growth', 'improving', { delta: '+6.5%', source: 'grader', after: '₹120 Cr' })];

  test('a one-off that is only "Rs. 1,113.51" is dropped (UNKNOWN), never sized or called larger than profit', () => {
    const a = assessThesis({ pattern: 'F', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true,
      variables: [...OUT, V('one_offs', 'stated', { after: 'Rs. 1,113.51' })] });
    const text = `${a.because} ${(a.qualification || []).join(' ')}`;
    assert.doesNotMatch(text, /1,113/);
    assert.doesNotMatch(text, /larger than the reported profit/);
    const oo = a.checked.find((c) => c.key === 'one_offs')!;
    assert.ok(oo.verdict === 'unknown' || oo.silence, 'dropped → unknown / silent (zero readings), never a reading');
    assert.equal(oo.after, null);
    assert.notEqual(a.status, 'STRENGTHENING', 'F: silence on one-offs never clears the forensic check');
  });

  test('with the company\'s own words the item is kept in words — the figure is not printed', () => {
    const a = assessThesis({ pattern: 'G', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true,
      variables: [...OUT, V('one_offs', 'stated', { after: 'Rs. 1,113.51', quote: 'The Company has recorded the financial impact of Rs. 1,113.51 of the New Labour Codes and disclosed it as an Exceptional item.' })] });
    const q = (a.qualification || []).join(' ');
    assert.match(q, new RegExp(UNSCALED_AMOUNT_WORDS));
    assert.match(q, /exceptional item/);
    assert.doesNotMatch(q.replace(/“[^”]*”/g, ''), /1,113/, 'the figure appears only inside the quoted source sentence');
    assert.doesNotMatch(q, /one-off benefit/, 'an item of unknown direction is not a benefit');
  });

  test('"no explicit … one-off gains disclosed" is a statement of none — never a one-off benefit', () => {
    assert.ok(statesNoOneOff('no explicit raw material one-off gains disclosed.'));
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true,
      variables: [...OUT, V('margin_driver', 'improving', { after: 'Higher mix of value-added products; no explicit raw material one-off gains disclosed.' })] });
    assert.doesNotMatch((a.qualification || []).join(' '), /one-off benefit/);
  });

  test('capex chain: "2% to 3%" is never printed as an announced capex figure; money with a unit still is', () => {
    const junk = buildCapexChain(null, [V('capex', 'stated', { after: '2% to 3%' }), V('utilisation', 'stated', { after: '80%' })], null);
    assert.doesNotMatch(JSON.stringify(junk), /announced 2% to 3%|announced 25%/);
    const pct = buildCapexChain(null, [V('capex', 'stated', { after: '25%' })], null);
    assert.doesNotMatch(JSON.stringify(pct), /announced 25%|capex on file: 25%/);
    const real = buildCapexChain({ capex_projects: [{ name: 'Phase II plant', amount: '₹450 crore', status: 'announced' }] }, [], null);
    assert.match(JSON.stringify(real), /₹450 crore/);
  });
});

describe('zzz802 · research priority says WHY, never a score', () => {
  test('the Why line is words and filed figures only', () => {
    const w = researchWhyLine({ output: { revenue: 26.8, earnings: 37.9, marginPp: 2 }, drivers: [
      { group: 'Capacity', text: 'capacity added 4,000 tons', quantified: true }, { group: 'Volume', text: 'volumes +23.1% YoY', quantified: true }] } as any);
    assert.equal(w, 'Why: capacity — capacity added 4,000 tons; volume — volumes +23.1% YoY; filed results: revenue +26.8%, earnings +37.9%, margin +2 points.');
    assert.equal(researchWhyLine(null), 'Why: no evidenced catalyst on file.');
  });
  test('the India page has no Score column and prints the Why line', () => {
    const p = src('app/(dashboard)/portfolio-catalysts/page.tsx');
    assert.doesNotMatch(p, />Score<\/th>/);
    assert.doesNotMatch(p, /\{cr\.score\}/);
    assert.doesNotMatch(p, /Score = output/);
    assert.match(p, /researchWhyLine\(cr\)/);
    assert.ok(!/^\s*export (?!default)/m.test(p), 'no named exports from page.tsx');
  });
});

describe('zzz802 · the persistent strip is bound to its own ticker', () => {
  const pc = (ticker: string, label: string) => ({ id: `${ticker}:ORDER_VISIBILITY`, ticker, kind: 'ORDER_VISIBILITY', label, mechanism: `${label} mechanism`, state: 'EXECUTING',
    confidence: 'HIGH', specialFocus: true, runway: { ok: true, text: '2 years' }, evidence: [], forward: [], beforeAfter: [], happened: [], notYet: [],
    nextMilestone: null, confirmWith: '', invalidateIf: '', duration: 'Duration: Unknown', firstEvidenceDate: null, latestEvidenceDate: null,
    freshness: 'CURRENT', periods: [], hardCount: 2, distinctMetrics: 1, temporarySignals: [], origins: ['portfolio'], why: [] }) as any;
  test('AVALON\'s slot never shows BDL\'s order book', () => {
    assert.equal(renderToStaticMarkup(React.createElement(PersistentStrip, { ticker: 'AVALON', pcs: [pc('BDL', 'Order book')] })), '');
    const own = renderToStaticMarkup(React.createElement(PersistentStrip, { ticker: 'AVALON', pcs: [pc('BDL', 'Order book'), pc('AVALON', 'Customer ramp')] }));
    assert.match(own, /data-testid="persistent-strip-ticker"[^>]*>AVALON · </);
    assert.match(own, /Customer ramp/);
    assert.doesNotMatch(own, /Order book/);
  });
  test('the India page passes the ticker (same fix as the US page)', () => {
    assert.match(src('app/(dashboard)/portfolio-catalysts/page.tsx'), /<PersistentStrip ticker=\{r\.symbol\}/);
  });
});

describe('zzz802 · Special Focus — in the list means it meets the gate', () => {
  const e = (id: string, decayed: boolean, user: string | null = null, dismissed = false) => ({ id, dismissed, decayed, st: user ? { user: { state: user } } : { user: null } });
  test('a decayed record goes to "dropped out" with its reason; one the owner keeps stays; dismissed is neither', () => {
    const { inFocus, droppedOut } = splitDroppedOut([e('CYIENTDLM:ORDER_VISIBILITY', true), e('A:X', false), e('B:X', true, 'watch'), e('C:X', true, 'confirmed'), e('D:X', true, null, true)]);
    assert.deepEqual(inFocus.map((x) => x.id), ['A:X', 'B:X', 'C:X']);
    assert.deepEqual(droppedOut.map((x) => x.id), ['CYIENTDLM:ORDER_VISIBILITY']);
  });
  test('the panel renders the split: header count from the in-focus list, a separate dropped-out section', () => {
    const p = src('components/special-focus-panel.tsx');
    assert.match(p, /const \{ inFocus: shown, droppedOut \} = splitDroppedOut\(entries\)/);
    assert.match(p, /data-testid="sf-dropped"/);
    assert.match(p, /dropped out of Special Focus \(reason shown\)/);
  });
});
