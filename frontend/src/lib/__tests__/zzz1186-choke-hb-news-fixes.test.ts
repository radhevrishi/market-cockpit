// zzz1186 — Choke-Point per-country research, stable theme diff, 100-bagger hard gates + figure-checked scores, news fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sameTheme, diffRuns, chokeToolFor, cleanChoke, CHOKE_CHECKLIST } from '../choke-themes/core';
import { isStrictSchema, toStrictSchema } from '../ai-schemas';
import { hbGateFails, type Cand } from '../screener/ai-candidates';
import { hbFactCaps, hbApplyCaps, hbHundredXMath, HB_FACTORS, type HbFactor } from '../hundred-baggers/core';
import { detectOrderBook } from '../thewrap-detectors';
import { tagTickers } from '../company-alias';
import { generateInstitutionalImpactLabel } from '../news/institutional-engine';

const cand = (o: Partial<Cand>): Cand => ({ t: 'X', n: 'X Ltd', ind: null, mc: 2000, revQ: 30, revA: 25, epsQ: 40, opm: 20, gm: null, roce: 22, roe: null, de: 0.1, pe: 30, ps: 4, fcfm: 10, p1y: 20, p5y: 100, bb: 0, fs: null, ...o });

test('a reworded theme (comma, plural) is the same theme — no ADDED / DROPPED pair', () => {
  assert.ok(sameTheme('High-density, point-of-load power conversion for advanced processors', 'High-density point-of-load power conversion for advanced processors'));
  assert.ok(sameTheme('Complex, regulated active pharmaceutical ingredients and custom synthesis', 'Complex regulated active pharmaceutical ingredient and custom synthesis'));
  assert.ok(!sameTheme('Optical transceivers for AI clusters', 'Rare-earth magnets for defence'));
  const th = (name: string) => ({ name, emoji: '', keywords: [], why: 'w', candidates: [], reference: [] }) as any;
  const pb = { strongest: [], confirm: [], milestones: [], disconfirming: [], valuation: [] };
  const prev = { regions: [{ region: 'US', themes: [th('High-density, point-of-load power conversion')], playbook: pb }] } as any;
  const next = { regions: [{ region: 'US', themes: [th('High-density point-of-load power conversion')], playbook: pb }] } as any;
  assert.equal(diffRuns(prev, next).length, 0);
});

test('each country gets its own strict one-region tool and checklist; a missing country is empty, not a failed run', () => {
  for (const r of ['US', 'IN'] as const) {
    const t = chokeToolFor(r);
    assert.ok(isStrictSchema(toStrictSchema(t.input_schema as any) as any));
    assert.deepEqual(t.input_schema.properties.regions.items.properties.region.enum, [r]);
    assert.ok(CHOKE_CHECKLIST[r].length > 200);
  }
  const d = { regions: [{ region: 'IN', themes: [{ name: 'Forgings for European defence', emoji: '', keywords: [], why: 'w', candidates: [], reference: [] }], playbook: {} }] };
  const c = cleanChoke(d);
  assert.ok(c);
  assert.equal(c!.regions.find((g) => g.region === 'US')!.themes.length, 0);
  assert.equal(c!.regions.find((g) => g.region === 'IN')!.themes.length, 1);
});

test('100-bagger hard gates: cash burn, debt, dilution, already-ran and slow growth fail', () => {
  assert.deepEqual(hbGateFails(cand({}), 'US'), []);
  assert.ok(hbGateFails(cand({ fcfm: -14, de: 1.0 }), 'IN').length >= 1);   // GENUSPOWER-like
  assert.ok(hbGateFails(cand({ mc: 9000, fcfm: -55 }), 'IN').some((x) => /burns cash/.test(x)));   // RATEGAIN-like
  assert.ok(hbGateFails(cand({ p5y: 350 }), 'US').some((x) => /already up/.test(x)));
  assert.ok(hbGateFails(cand({ revA: 8, revQ: 9 }), 'US').some((x) => /sales growth/.test(x)));
  assert.ok(hbGateFails(cand({ bb: -6 }), 'US').some((x) => /share count/.test(x)));
});

test('a score the figures contradict is capped and the total recomputed', () => {
  const all10 = Object.fromEntries(HB_FACTORS.map(([k]) => [k, 9])) as Record<HbFactor, number>;
  const c = cand({ fcfm: -3, pe: 70, roce: 12 });
  const { caps } = hbFactCaps(c);
  assert.equal(caps.capital, 5);
  assert.equal(caps.valuation, 4);
  const r = hbApplyCaps({ scores: all10, data: c });
  assert.equal(r.aiTotal, 135);
  assert.ok(r.total < r.aiTotal);
  assert.ok(r.caps.length >= 3);
  assert.match(hbHundredXMath(cand({ mc: 2500 }), 'US'), /\$250 billion/);
});

test('an MoU is not an order; a lower-case "power grid orders" is not Power Grid Corp', () => {
  assert.equal(detectOrderBook('SECI and MHA sign MoU for rooftop solar installations under PM Surya Ghar Yojana')?.label, 'MOU · not an order');
  assert.match(detectOrderBook('Company bags EPC contract worth ₹949 crore from Power Grid')!.label, /^ORDER/);
  assert.deepEqual(tagTickers('Jyoti Structures share price jumps 14% on ₹949-crore power grid orders'), []);
  assert.deepEqual(tagTickers('Power Grid shares rise'), ['POWERGRID']);
});

test('a bottleneck impact label needs the article to be about that theme', () => {
  const lab = (text: string) => generateInstitutionalImpactLabel({ bottleneck_category: 'COMPUTE_CONSTRAINT', bottleneck_resolution: 'PERSISTENT', article_type: 'BOTTLENECK', text });
  assert.equal(lab('SAMSUNG SDI to supply 1GWh of US-made ESS to Alpha Omega Power'), '');
  assert.equal(lab('AMD Buys World Labs For $8.2 Billion To Get AI Model Cred'), '');
  assert.match(lab('CoWoS packaging shortage keeps GPU supply tight'), /packaging/);
});
