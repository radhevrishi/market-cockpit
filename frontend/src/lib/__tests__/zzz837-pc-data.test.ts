// zzz837 — Portfolio Catalysts (India + US) data-correctness and wording.
// Run: npx tsx --test src/lib/__tests__/zzz837-pc-data.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { assessThesis } from '../thesis/status';
import { evidenceLineOf, dedupedCountRows, histSignature, dedupeLabels } from '../thesis/evidence-line';
import { noPlantBusinessOf, isServicesBusiness } from '../thesis/taxonomy';
import { isGarbledText, capacityUnitIssue, currencyNotStated, croreFrom, orderBookImplausible } from '../thesis/figure-guards';
import { validateReading } from '../thesis/fact-model';
import { valueFitsVariable } from '../thesis/evidence-extract';
import { normalizeEvent } from '../thesis/fact-normalize';
import { orderBookScaleGuard } from '../thesis/variables';
import { productOfCapacity } from '../thesis/transcript-evidence';
import { compareSpecialFocus, orderSpecialFocus, specialFocusLabels } from '../catalyst/persistence';
import { pcCountsReconciled } from '../thesis/evidence-counts';

const V = (key: string, verdict: string, o: { after?: string; before?: string; delta?: string; source?: 'grader' | 'filing' } = {}) => ({
  key, label: key, before: o.before ?? null, after: o.after ?? null, delta: o.delta ?? null, quote: null,
  verdict, evidence: `${key} evidence`, source: o.source ?? 'filing', kind: 'fact', statement: 'ACTUAL',
}) as any;
// The note's page: revenue up, earnings up slower than revenue, no mechanism figure read.
const OUT = [V('revenue_growth', 'improving', { delta: '+18%', after: '+18%', source: 'grader' }),
  V('earnings_growth', 'flat', { delta: '+9%', after: '+9%', source: 'grader' }),
  V('operating_leverage', 'deteriorating', { before: 'revenue +18%', after: 'earnings +9%', delta: '0.5×', source: 'grader' })];
const base = { pattern: 'A' as const, evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: OUT };

describe('zzz837 item 1 · structural evidence line', () => {
  test('operating leverage down with zero structural contradicted: NOT "contradicted"', () => {
    const a = assessThesis(base as any) as any;
    assert.notEqual(a.verdict.evidence, 'CONTRADICTED');
    const line = a.verdict.evidenceLine!;
    assert.match(line, /^not confirmed \(0\/\d+ structural\)/);
    assert.doesNotMatch(line.split(' · output check')[0], /contradicted/);
    assert.match(line, /missing: /);
    assert.deepEqual(a.verdict.coverage.contradicted, []);
  });
  test('the output check is shown separately', () => {
    const a = assessThesis({ ...base, priorVerdicts: { operating_leverage: 'deteriorating' } } as any) as any;
    assert.notEqual(a.verdict.evidence, 'CONTRADICTED');
    assert.deepEqual(a.verdict.coverage.contradicted, []);
    assert.ok((a.verdict.coverage.outputContradicted || []).length >= 1, JSON.stringify(a.verdict.coverage));
    assert.match(a.verdict.evidenceLine!, /output check \(separate from the structural count\)/);
  });
  test('a real structural contradiction still says contradicted', () => {
    const line = evidenceLineOf({ evidence: 'CONTRADICTED', coverage: { confirmed: 1, applicable: 4, contradicted: ['Utilisation'], missing: ['Volume'] } });
    assert.match(line, /^contradicted \(1\/4 structural\): Utilisation/);
    assert.match(line, /missing: Volume/);
  });
  test('labels are deduplicated and "Pending" lists are not triplicated across STRUCTURAL / MECHANISM / OUTPUT', () => {
    assert.deepEqual(dedupeLabels(['Volume', 'volume', ' Volume ', 'Capacity']), ['Volume', 'Capacity']);
    const t = (pending: string[]) => ({ confirmed: 0, pending: pending.length, contradicted: 0, total: pending.length, named: { pending } });
    const rows = dedupedCountRows({ structural: t(['Volume', 'Capacity added']), mechanism: t(['Volume', 'Capacity added', 'Guidance']), output: t(['Volume']) });
    const listed = rows.flatMap((r) => r.parts.flatMap((p) => p.names)).map((x) => x.toLowerCase());
    assert.equal(new Set(listed).size, listed.length, 'each name listed once');
    assert.equal(rows[1].parts[0].sameAsAbove, 2);
    assert.deepEqual(rows[1].parts[0].names, ['Guidance']);
  });
});

describe('zzz837 item 2 · "two consecutive quarters" needs two quarters', () => {
  test('one quarter compared: not fired, watch, status unchanged, no "would read THESIS WEAKENING"', () => {
    const a = assessThesis(base as any) as any;
    const ol = a.checked.find((c: any) => c.key === 'operating_leverage')!;
    assert.equal(ol.invalidation, null);
    assert.equal(ol.secondReading, 'not_on_file');
    assert.equal(ol.watch, true);
    assert.equal(a.verdict.breakTrigger.fired, false);
    assert.match(a.verdict.breakTrigger.text, /watch — one quarter \(needs a second\)/);
    assert.match(a.verdict.breakTrigger.text, /second quarter not on file/);
    assert.notEqual(a.status, 'WEAKENING');
    const prov = assessThesis({ ...base, patternFit: 'nearest' } as any) as any;
    assert.doesNotMatch(prov.because, /this would read THESIS WEAKENING/);
    assert.equal(prov.status, 'CONFIRMATION_REQUIRED');
  });
  test('prior quarter did not read down: still watch', () => {
    const a = assessThesis({ ...base, priorVerdicts: { operating_leverage: 'improving' } } as any) as any;
    assert.equal(a.checked.find((c: any) => c.key === 'operating_leverage')!.secondReading, 'not_repeated');
    assert.equal(a.verdict.breakTrigger.fired, false);
  });
  test('two consecutive quarters down: fires', () => {
    const a = assessThesis({ ...base, priorVerdicts: { operating_leverage: 'deteriorating' } } as any) as any;
    const ol = a.checked.find((c: any) => c.key === 'operating_leverage')!;
    assert.ok(ol.invalidation, 'fired');
    assert.equal(ol.secondReading, null);
    assert.equal(a.verdict.breakTrigger.fired, true);
  });
});

describe('zzz837 item 3 · no capacity demanded from a business with no plant', () => {
  const cases: Array<[string, string]> = [
    ['exchange', 'Exchange and Data Platform'], ['it', 'IT - Software'], ['it2', 'IT Services & Consulting'], ['retail', 'Retailing'],
    ['media', 'Media & Entertainment'], ['leisure', 'Amusement Parks / Leisure'], ['ports', 'Port & Port services'], ['ins', 'Insurance'],
  ];
  for (const [k, industry] of cases) {
    test(`${k}: "${industry}" is n/a with a reason and alternates`, () => {
      const b = { industry, sector: null, text: null };
      const n = noPlantBusinessOf(b)!;
      assert.ok(n, industry);
      assert.match(n.reason, /no physical capacity/);
      assert.ok(n.alternates.length > 10);
      assert.ok(isServicesBusiness(b));
    });
  }
  test('a manufacturer is never classified', () => {
    assert.equal(noPlantBusinessOf({ industry: 'Specialty Chemicals plant', sector: null }), null);
    assert.equal(noPlantBusinessOf({ industry: 'Auto Components & Equipments', sector: null }), null);
  });
  test('assess: A on an IT-services business marks capacity variables NOT_APPLICABLE with the reason', () => {
    const a = assessThesis({ ...base, business: { industry: 'IT Services & Consulting', sector: null, text: null } } as any) as any;
    for (const k of ['utilisation', 'capacity', 'capacity_addition']) {
      const c = a.checked.find((x: any) => x.key === k)!;
      assert.equal(c.state, 'NOT_APPLICABLE', k);
      assert.match(String(c.stateReason), /no physical capacity/);
      assert.match(c.evidence, /Read instead: /);
    }
    assert.ok(!a.verdict.coverage.missing.some((m: string) => /capacity|utilisation/i.test(m)), a.verdict.coverage.missing.join());
  });
});

describe('zzz837 item 4 · garbage and ambiguous extractions', () => {
  test('run-together OCR string is rejected everywhere it could become a fact', () => {
    const s = 'ExpandedMfg.capacityatthe Texasfacilityby70,000MTPA';
    assert.ok(isGarbledText(s));
    assert.ok(!isGarbledText('Expanded manufacturing capacity at the Texas facility by 70,000 MTPA'));
    assert.equal(validateReading('capacity_addition', s).state, 'UNCLEAR');
    assert.equal(valueFitsVariable({ variable: 'capacity_addition', before: null, after: s, unit: null, evidence_text: 'We ' + s }), false);
    assert.equal(valueFitsVariable({ variable: 'capacity_addition', before: null, after: '9,600+MTPA', unit: null, evidence_text: 'Capacityexpandedfrom5000MTPAto9,600+MTPA,withphasedramp-upunderwaytillFY27end.' }), true, 'a clean value from a space-less sentence is still a clean value');
    assert.equal(valueFitsVariable({ variable: 'capacity_addition', before: null, after: '70,000 MTPA', unit: null, evidence_text: 'We expanded manufacturing capacity at the Texas facility by 70,000 MTPA this quarter.' }), true);
  });
  test('stray label: a money word is never a product ("Installed capacity — crores")', () => {
    assert.equal(productOfCapacity('Installed crores capacity of 450 KL', '450 KL'), null);
  });
  test('units that do not fit the metric', () => {
    for (const bad of ['12 riders', '6 units', 'over 125+ locations']) {
      assert.ok(capacityUnitIssue(bad), bad);
      assert.equal(valueFitsVariable({ variable: 'capacity', before: null, after: bad, unit: null, evidence_text: `Installed capacity is ${bad} across the park network today` }), false, bad);
      assert.equal(validateReading('capacity', bad).state, 'UNCLEAR', bad);
    }
    assert.equal(capacityUnitIssue('1,20,000 units per month'), null);
    assert.equal(capacityUnitIssue('450 KL'), null);
    assert.equal(capacityUnitIssue('70,000 MTPA'), null);
  });
  test('money metrics need a currency: "order intake 2.1 billion" is "currency not stated"', () => {
    assert.ok(currencyNotStated('order_intake', '2.1 billion'));
    assert.ok(!currencyNotStated('order_intake', 'USD 2.1 billion'));
    assert.ok(!currencyNotStated('order_intake', '2.1 billion', 'order intake of USD in the quarter was 2.1 billion'));
    assert.ok(!currencyNotStated('order_intake', 'INR 250 crores'));
    const v = validateReading('order_intake', '2.1 billion', 'Order intake was 2.1 billion in the quarter');
    assert.equal(v.state, 'UNCLEAR');
    assert.match(v.reason!, /currency not stated/);
  });
  test('order book far below the capex programme or quarter revenue: unit/scope unclear', () => {
    assert.equal(croreFrom('INR25 crores'), 25);
    assert.match(orderBookImplausible(25, { capexProgrammeCr: 250 })!, /unit\/scope unclear — validation required/);
    assert.match(orderBookImplausible(25, { quarterRevenueCr: 300 })!, /unit\/scope unclear/);
    assert.equal(orderBookImplausible(900, { capexProgrammeCr: 250, quarterRevenueCr: 300 }), null);
    const ob = V('order_book', 'improving', { after: 'INR25 crores', before: 'INR20 crores' });
    const capex = V('capex', 'stated', { after: 'Rs 250 crore' });
    const g = orderBookScaleGuard(ob, [ob, capex], { sales_curr_cr: 320 });
    assert.equal(g.verdict, 'stated');
    assert.match(String(g.unjudged), /unit\/scope unclear — validation required/);
    assert.equal(g.delta, null);
    assert.equal(orderBookScaleGuard(V('order_book', 'improving', { after: 'INR2,500 crores' }), [], { sales_curr_cr: 320 }).verdict, 'improving');
  });
  test('utilisation from a guidance / target value is typed guidance / target, not a level', () => {
    const g = normalizeEvent({ variable: 'utilisation', before: null, after: 'guidance: 60%', unit: '%', value_type: 'ACTUAL', evidence_text: 'Utilisation guidance: 60% for the year.' } as any, 'Q1 FY27');
    assert.equal(g.value_type, 'GUIDANCE');
    const t = normalizeEvent({ variable: 'utilisation', before: null, after: 'target 80%', unit: '%', value_type: 'ACTUAL', evidence_text: 'Our utilisation target 80% for next year.' } as any, 'Q1 FY27');
    assert.notEqual(t.value_type, 'ACTUAL', 'a target is never a level');
  });
  test('historical context rows: same metric + period + value listed once (30 KL vs 30 KLPD too)', () => {
    assert.equal(histSignature('utilisation', 'earlier years', '80% capacity'), histSignature('utilisation', 'Earlier years', '80% capacity'));
    assert.equal(histSignature('capacity', 'earlier years', '30 KL'), histSignature('capacity', 'earlier years', '30 KLPD'));
    assert.notEqual(histSignature('capacity', 'earlier years', '30 KL'), histSignature('capacity', 'earlier years', '40 KL'));
    const dup = (id: string) => V('utilisation', 'stated', { after: '80% capacity' });
    const a = assessThesis({ ...base, variables: [...OUT, { ...dup('a'), statement: 'HISTORICAL', asOf: 'earlier years' }, { ...dup('b'), statement: 'HISTORICAL', asOf: 'earlier years' }],
      currentPeriod: 'Q1 FY27' } as any);
    const rows = (a.historicalContext || []).filter((h: any) => h.key === 'utilisation');
    assert.ok(rows.length <= 1, `got ${rows.length}`);
  });
});

describe('zzz837 item 5 · Special Focus order and its number', () => {
  const pc = (ticker: string, confidence: any, hardCount: number) => ({ ticker, confidence, state: 'RAMPING', hardCount, distinctMetrics: 2, freshness: 'CURRENT' }) as any;
  const e = (ticker: string, sfId: number, confidence: any, hard: number, o: any = {}) => ({ pc: pc(ticker, confidence, hard), decayed: false, st: { sfId, user: null }, ...o });
  test('displayed order is the rank order; registry ids may be in any order', () => {
    const list = orderSpecialFocus([e('INNOVACAP', 12, 'MEDIUM', 2), e('HAPPYFORGE', 9, 'HIGH', 5), e('C', 10, 'HIGH', 3), e('D', 27, 'MEDIUM', 4), e('E', 17, 'EARLY', 1)]);
    assert.deepEqual(list.map((x) => x.pc.ticker), ['HAPPYFORGE', 'C', 'D', 'INNOVACAP', 'E']);
    for (let i = 1; i < list.length; i++) assert.ok(compareSpecialFocus(list[i - 1], list[i]) <= 0);
  });
  test('confirmed first, decayed last, deterministic tie-break', () => {
    const list = orderSpecialFocus([e('A', 5, 'HIGH', 3, { decayed: true }), e('B', 8, 'MEDIUM', 1, { st: { sfId: 8, user: { state: 'confirmed' } } }), e('Z', 3, 'HIGH', 3), e('Y', 3, 'HIGH', 3)]);
    assert.deepEqual(list.map((x) => x.pc.ticker), ['B', 'Y', 'Z', 'A']);
  });
  test('the label: position is "#N"; the registry number is named as an ID, not a rank', () => {
    const l = specialFocusLabels(1, 12);
    assert.equal(l.position, '#1');
    assert.equal(l.registry, 'Special Focus ID 12');
    assert.match(l.title, /not a rank/);
    assert.match(specialFocusLabels(2, null).title, /New this run/);
  });
  test('rank uses no price', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'catalyst', 'persistence.ts'), 'utf8');
    const fn = /export function rankOf[\s\S]*?\n}\n/.exec(src)![0];
    assert.doesNotMatch(fn, /price|return|pct|ltp/i.source === '' ? /x^/ : /\bprice\b|\bltp\b|\bcmp\b/i);
  });
});

describe('zzz837 item 6 · counts reconcile', () => {
  const c = pcCountsReconciled({ heldMeet: 15, heldMiss: 16, benchMeet: 65, benchMiss: 190, usMeet: 159, cardsBook: 81 });
  test('the note\'s numbers each have one labelled meaning', () => {
    assert.equal(c.byId.list.n, 286);
    assert.equal(c.byId.meet.n, 80);
    assert.equal(c.byId.miss.n, 206);
    assert.equal(c.byId.benchAll.n, 255);
    assert.equal(c.byId.bench.n, 65);
    assert.equal(c.byId.benchMiss.n, 190);
    assert.equal(c.byId.cbBoth.n, 239);
    assert.equal(c.byId.cards.n, 146);
    assert.equal(c.cbChip, 'CB 239 = India 80 + US 159');
    assert.ok(c.consistent);
  });
  test('the sentence\'s parts sum', () => {
    assert.match(c.sentence, /^List 286 = 80 meet your criteria \(15 held \+ 65 bench\) \+ 206 miss them \(16 held \+ 190 bench\)\./);
    const m = /^List (\d+) = (\d+) meet your criteria \((\d+) held \+ (\d+) bench\) \+ (\d+) miss them \((\d+) held \+ (\d+) bench\)/.exec(c.sentence)!.slice(1).map(Number);
    assert.equal(m[1] + m[4], m[0]);
    assert.equal(m[2] + m[3], m[1]);
    assert.equal(m[5] + m[6], m[4]);
    const all = /all (\d+) names you do not hold = (\d+) meeting \+ (\d+) failing/.exec(c.sentence)!.slice(1).map(Number);
    assert.equal(all[1] + all[2], all[0]);
    assert.match(c.sentence, /Cards on the board: 146 = 81 book \+ 65 bench/);
  });
  test('any inputs sum by construction', () => {
    for (const i of [[0, 0, 0, 0], [3, 1, 7, 2], [10, 20, 30, 40]]) {
      const r = pcCountsReconciled({ heldMeet: i[0], heldMiss: i[1], benchMeet: i[2], benchMiss: i[3] });
      assert.ok(r.consistent);
      assert.equal(r.byId.list.n, r.byId.meet.n + r.byId.miss.n);
    }
  });
});
