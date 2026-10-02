// zzz852 - radar LOGIC QA: number ownership, headline hierarchy, direction and inflection, strict link terms, secondary evidence labels,
// transaction vs earnings language, deal terms, why-now, per-kind evidence chains, priority factors, diagnostics, and the automatic QA gate.
// Synthetic company names only. No ticker is hardcoded in any logic these tests exercise.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyseRadarItem, buildRadar, type RadarInput } from '../multibagger-radar';
import { LINK_LABEL, BUCKET_LABEL, BUCKET_ORDER, type RadarItem } from '../multibagger-radar-types';
import { qaErrorsOf, QA_CLASSES } from '../multibagger-radar-qa';
import type { OwnedNumber } from '../radar-owned-types';
import { RadarCard } from '../../components/special-situations/RadarCard';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const card = (item: RadarItem) => renderToStaticMarkup(React.createElement(RadarCard as any, { item, held: false, ledgerIds: new Set<string>(), onSaveLedger: () => {}, now: '2026-09-30T00:00:00Z' }));
const mk = (o: Partial<RadarInput> & { title: string }): RadarInput => ({ id: o.id || 'x', ticker: 'TKR', company: 'Deltacorp', region: 'IN', sourceLabel: 'Economic Times', tickerResolved: true, ...o } as RadarInput);
const run = (o: Partial<RadarInput> & { title: string }) => analyseRadarItem(mk(o));
const blob = (r: RadarItem) => JSON.stringify(r);

const ACQ = { title: 'Deltacorp to acquire Zenbar Foods for Rs 1,900 crore', description: 'Zenbar Foods generated revenue of Rs 452 crore and EBITDA of Rs 60 crore in FY25. The packaged foods market is worth Rs 30,000 crore.' };

describe('1 number ownership', () => {
  const r = run(ACQ);
  test('target and industry numbers carry their owner and never the parent', () => {
    const rev = (r.ownedNumbers || []).find((n) => n.metric === 'revenue');
    assert.equal(rev?.entityRole, 'target');
    assert.match(rev?.entity || '', /Zenbar/);
    assert.equal((r.ownedNumbers || []).find((n) => n.metric === 'ebitda')?.entityRole, 'target');
    assert.equal((r.ownedNumbers || []).find((n) => n.metric === 'market_size')?.entityRole, 'industry');
    assert.equal((r.ownedNumbers || []).filter((n) => n.countsAsParentEarnings).length, 0);
  });
  test('acquirer link is not established; the parent line says so; evidence is secondary; not ledger-ready', () => {
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.equal(r.parentImpactLine, 'Deltacorp incremental revenue / EBITDA / PAT: Not established');
    assert.match(r.evidenceLabel || '', /^Secondary-reported/);
    assert.equal(r.ledgerEligible, false);
  });
  test('the target figures are shown labelled with their owner, and never as the parent impact', () => {
    assert.ok((r.numberLines || []).some((l) => /Zenbar Foods revenue: Rs 452 cr.*not Deltacorp/.test(l)), JSON.stringify(r.numberLines));
    assert.ok((r.numberLines || []).some((l) => /Zenbar Foods EBITDA: Rs 60 cr/.test(l)));
    assert.doesNotMatch(JSON.stringify(r.impacts), /452|\b60 crore/);
    assert.doesNotMatch(r.financialImpact, /452|30,000/);
  });
  test('a parent-owned result figure still counts', () => {
    // zzz854: Direct needs the figure from a primary filing (or two independent origins); a secondary-only headline is 'Earnings result (unverified)'
    const p = run({ title: 'Deltacorp Q1 net profit up 35% to Rs 410 crore', company: 'Deltacorp', sourceLabel: 'BSE filing' });
    assert.ok((p.ownedNumbers || []).some((n) => n.entityRole === 'parent' && n.countsAsParentEarnings));
    assert.equal(p.link, 'DIRECT');
  });
  test('feed hints (ownedNumbers) win over text extraction; the feed numbers are read defensively', () => {
    const hinted: OwnedNumber[] = [{ value: 77, currency: 'INR', unit: 'crore', raw: 'Rs 77 crore', metric: 'revenue', period: 'FY25', entity: 'Quorix Ltd', entityRole: 'target', sentence: 'Quorix Ltd had revenue of Rs 77 crore.', countsAsParentEarnings: false }];
    const h = run({ title: 'Deltacorp to acquire Quorix Ltd for Rs 500 crore', description: 'Quorix Ltd had revenue of Rs 77 crore.', ownedNumbers: hinted } as any);
    assert.equal((h.ownedNumbers || [])[0].entity, 'Quorix Ltd');
    assert.equal(h.link, 'NOT_ESTABLISHED');
  });
});

describe('2 headline hierarchy', () => {
  for (const t of ['Pagecorp Declares Rs 200/Share Dividend, Despite Fall In Q1 Net Profit', 'Pagecorp declares dividend as profit rises']) {
    const r = run({ title: t, company: 'Pagecorp' });
    test(`"${t}" is a corporate action with earnings as context`, () => {
      assert.equal(r.kind, 'CORPORATE_ACTION');
      assert.equal(r.bucket, 'CORPORATE_ACTION');
      assert.equal(r.link, 'NOT_APPLICABLE');
      assert.equal(r.economicPayoff, 'Shareholder cash return');
      assert.ok(r.secondaryEvent && /profit/i.test(r.secondaryEvent.text));
      assert.ok(!/dividend/i.test(r.secondaryEvent!.text), 'the secondary line is the earnings clause only');
      assert.ok((r.contextFacts || []).length > 0);
    });
  }
  test('the direction of the context result is read from the stated words', () => {
    assert.equal(run({ title: 'Pagecorp Declares Rs 200/Share Dividend, Despite Fall In Q1 Net Profit', company: 'Pagecorp' }).catalystDirection, 'negative');
    assert.equal(run({ title: 'Pagecorp declares dividend as profit rises', company: 'Pagecorp' }).catalystDirection, 'positive');
  });
  test('a result headline that also mentions a dividend stays a result', () => {
    const r = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%; board declares dividend', company: 'Epsilon' });
    assert.equal(r.kind, 'EARNINGS_RESULT');
  });
});

describe('3 direction and inflection strength', () => {
  const cases: Array<[string, string, string, RadarItem['bucket']]> = [
    ['Epsilon Q1 net profit jumps 60%, revenue up 30%', 'positive', 'strong', 'EARNINGS_INFLECTION'],
    ['Epsilon Q1 net profit up 3% on flat revenue', 'positive', 'weak', 'RESULT_NO_INFLECTION'],
    ['Epsilon Q1 net profit falls 20%, revenue down 5%', 'negative', 'none', 'RESULT_NO_INFLECTION'],
    ['Epsilon Q1 revenue up 15% but net profit down 10%', 'mixed', 'none', 'RESULT_NO_INFLECTION'],
  ];
  for (const [t, d, s, b] of cases) {
    test(`${t} -> ${d} / ${s} / ${b}`, () => {
      // zzz854: direction is read only from a verified source (primary filing here); a secondary-only headline is 'unknown'
      const r = run({ title: t, company: 'Epsilon', sourceLabel: 'NSE filing' });
      assert.equal(r.kind, 'EARNINGS_RESULT');
      assert.equal(r.catalystDirection, d);
      assert.equal(r.inflectionStrength, s);
      assert.equal(r.bucket, b);
    });
  }
  test('only a materially improving result is called an earnings inflection', () => {
    for (const [t, , , b] of cases) assert.equal(run({ title: t, company: 'Epsilon', sourceLabel: 'NSE filing' }).bucket === 'EARNINGS_INFLECTION', b === 'EARNINGS_INFLECTION');
    for (const [t] of cases) assert.notEqual(run({ title: t, company: 'Epsilon' }).bucket, 'EARNINGS_INFLECTION', 'a secondary-only headline is never an inflection');
  });
  test('results with no numbers at all are not shown as an inflection', () => {
    const r = run({ title: 'Epsilon announces quarterly results', company: 'Epsilon' });
    assert.notEqual(r.bucket, 'EARNINGS_INFLECTION');
    assert.notEqual(r.bucket, 'RESULT_NO_INFLECTION');
  });
  test('the new bucket is labelled and ordered', () => {
    assert.equal(BUCKET_LABEL.RESULT_NO_INFLECTION, 'Earnings results (no inflection)');
    assert.ok(BUCKET_ORDER.indexOf('RESULT_NO_INFLECTION') > BUCKET_ORDER.indexOf('EARNINGS_INFLECTION'));
  });
  test('the card shows the direction chip', () => {
    const t = strip(card(run({ title: 'Epsilon Q1 net profit falls 20%, revenue down 5%', company: 'Epsilon', sourceLabel: 'NSE filing' })));
    assert.match(t, /Direction: negative/);
  });
});

describe('4 secondary evidence label and next step', () => {
  test('media-only evidence is "Secondary-reported (N outlets)", never Strong or Confirmed', () => {
    const one = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon' });
    assert.equal(one.evidenceLabel, 'Secondary-reported (1 outlet)');
    const two = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon', sources: [{ label: 'Mint', title: 'b' }] } as any);
    assert.equal(two.evidenceLabel, `Secondary-reported (${two.evidence.independentSources} outlets)`);
    assert.ok(two.evidence.independentSources >= 2);
    assert.doesNotMatch(strip(card(two)), /Evidence: (Strong|Confirmed)/);
  });
  test('a secondary earnings result gets the next-step line; backlog item is auto-retrieval', () => {
    const r = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon' });
    assert.equal(r.nextStep, 'Next: read the official result filing and extract revenue, EBITDA, margin, PAT, volumes, realisation, cost, cash flow, capex, net debt, guidance');
    assert.match(strip(card(r)), /Next: read the official result filing/);
  });
  test('a primary filing is labelled by its status', () => {
    const r = run({ title: 'Zetacorp wins Rs 400 crore order for power systems', company: 'Zetacorp', primarySource: true, sourceLabel: 'Exchange filing' });
    assert.equal(r.evidenceLabel, 'Confirmed');
    assert.equal(r.nextStep, null);
  });
});

describe('5 transactions never use earnings language', () => {
  const T = { company: 'Kappa Corp', primarySource: true, sourceLabel: 'SEC filing' };
  const tender = run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share', description: 'The offer expires on 15 November 2026. The offer is subject to regulatory approvals.' });
  const cases: Array<[string, RadarItem]> = [
    ['tender', tender],
    ['dividend', run({ title: 'Pagecorp declares Rs 12 per share dividend', company: 'Pagecorp' })],
    ['buyback', run({ title: 'Lambda Ltd board approves buyback of 2 crore shares at Rs 500 per share', company: 'Lambda Ltd' })],
    ['spin', run({ title: 'Omicron Ltd board approves demerger of its chemicals business', company: 'Omicron Ltd' })],
    ['legal', run({ title: 'Court sets aside tax demand on Sigma Ltd', company: 'Sigma Ltd' })],
    ['capital raise', run({ title: 'Tau Ltd raises Rs 500 crore via QIP', company: 'Tau Ltd' })],
  ];
  for (const [n, r] of cases) {
    test(`${n}: link is none or not applicable, payoff is a transaction / shareholder payoff, no earnings sentence`, () => {
      assert.ok(r.link === 'NONE' || r.link === 'NOT_APPLICABLE', `${n} link ${r.link}`);
      assert.match(r.economicPayoff || '', /Transaction \/ shareholder payoff|Shareholder cash return/);
      assert.doesNotMatch(blob(r), /Revenue impact not yet visible in reported earnings/);
    });
  }
  test('the sentence is still allowed for a capacity or order catalyst', () => {
    const r = run({ title: 'Omegatech to add 2 MTPA capacity at a cost of Rs 900 crore', company: 'Omegatech' });
    assert.ok(r.link !== 'NOT_APPLICABLE');
  });
  test('company-specific facts lead; the generic definition sits in the tooltip field', () => {
    assert.match(tender.economicMechanism || '', /Kappa Corp/);
    assert.ok(tender.mechanismHelp && tender.mechanismHelp !== tender.economicMechanism);
    const html = card(tender);
    assert.match(html, /title="[^"]*"/);
  });
});

describe('6 deal terms', () => {
  const T = { company: 'Kappa Corp', primarySource: true, sourceLabel: 'SEC filing' };
  test('every field is a value or Not stated, kind-specific', () => {
    const r = run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share', description: 'The offer expires on 15 November 2026.' });
    const lines = r.dealTermLines || [];
    assert.ok(lines.length >= 6);
    for (const l of lines) assert.ok(l.stated ? l.value.length > 0 : l.value === 'Not stated', l.label);
    assert.equal(lines.find((l) => l.label === 'Expiry')?.stated, true);
    assert.equal(lines.find((l) => l.label === 'Minimum tender')?.value, 'Not stated');
  });
  test('premium is calculated only when both prices are stated, and says calculated', () => {
    const base = { ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share' } as any;
    const only = run(base);
    assert.equal(only.dealTermLines!.find((l) => l.label === 'Premium / discount')?.stated, false);
    const both = run({ ...base, dealTerms: { kind: 'TENDER', fields: { offer_price: 'Rs 120', reference_price: 'Rs 100' }, statedConditions: [], missing: [] } });
    const prem = both.dealTermLines!.find((l) => l.label === 'Premium / discount')!;
    assert.equal(prem.stated, true); assert.equal(prem.calculated, true);
    assert.match(prem.value, /\+20\.0%/);
    assert.match(strip(card(both)), /\(calculated\)/);
  });
  test('acquisition multiple needs both the price and the target revenue', () => {
    const r = run(ACQ);
    const m = r.dealTermLines!.find((l) => l.label === 'Multiple')!;
    assert.equal(m.calculated, true); assert.match(m.value, /^4\.2x/);
    const none = run({ title: 'Deltacorp to acquire Zenbar Foods for Rs 1,900 crore' });
    assert.equal(none.dealTermLines!.find((l) => l.label === 'Multiple')?.stated, false);
  });
});

describe('7 and 8 why now, next proof, break conditions, governance', () => {
  const T = { company: 'Kappa Corp', primarySource: true, sourceLabel: 'SEC filing' };
  test('why now is event-specific (a dated timetable) or Not established; never a definition', () => {
    const dated = run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share', description: 'The offer expires on 15 November 2026.' });
    assert.match(dated.whyNow || '', /timetable|15 November 2026/);
    const bare = run({ title: 'Court sets aside tax demand on Sigma Ltd', company: 'Sigma Ltd' });
    assert.equal(bare.whyNow, 'Not established');
    assert.match(strip(card(bare)), /Why now\s+Not established/);
    assert.doesNotMatch(blob(dated), /taxonomy|is defined as/);
  });
  test('tender next proof comes from stated conditions, else the default line', () => {
    const c = run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share', description: 'The offer is subject to regulatory approvals.' });
    assert.match(c.proof.what, /regulatory approvals/);
    const d = run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share' });
    // zzz854: the default next proof names the concrete fields to record
    assert.equal(d.proof.what, 'Next proof: offer price, expiry and minimum condition in the filing.');
  });
  test('break conditions for deals are stated conditions or the default, never boilerplate', () => {
    const d = run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share' });
    assert.deepEqual(d.breakConditions, ['See stated transaction conditions']);
    const c = run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share', description: 'The offer is subject to regulatory approvals.' });
    assert.ok(c.breakConditions.every((b) => /stated condition|stated transaction/i.test(b)));
    assert.doesNotMatch(blob(c), /antitrust|minority shareholder dissent|inadequate price|governance deterioration/i);
  });
  test('the card says Governance relevance: Not assessed and drops the technical boilerplate', () => {
    const t = strip(card(run({ ...T, title: 'Kappa Corp launches tender offer at Rs 120 per share' })));
    assert.match(t, /Governance relevance: Not assessed/);
    assert.doesNotMatch(t, /No technical data supplied/);
  });
});

describe('9 and 10 evidence chains and fact scope', () => {
  test('each kind has its own chain; steps are confirmed or not established', () => {
    const kinds = new Map<string, RadarItem>([
      ['ACQUISITION', run(ACQ)],
      ['TENDER', run({ title: 'Kappa Corp launches tender offer at Rs 120 per share', company: 'Kappa Corp' })],
      ['SPIN_OFF', run({ title: 'Omicron Ltd board approves demerger of its chemicals business', company: 'Omicron Ltd' })],
      ['LEGAL', run({ title: 'Court sets aside tax demand on Sigma Ltd', company: 'Sigma Ltd' })],
      ['OPERATING', run({ title: 'Zetacorp wins Rs 400 crore order for power systems', company: 'Zetacorp', primarySource: true, sourceLabel: 'Exchange filing' })],
    ]);
    const seen = new Set<string>();
    kinds.forEach((r, k) => {
      assert.equal(r.evidenceChainKind, k);
      assert.ok((r.evidenceChain || []).length >= 3, k);
      for (const s of r.evidenceChain!) assert.ok(s.state === 'confirmed' || s.state === 'not_established');
      seen.add(r.evidenceChain!.map((s) => s.step).join('>'));
    });
    assert.equal(seen.size, kinds.size, 'chains differ by kind');
  });
  test('an acquisition never confirms the acquirer revenue from the target revenue', () => {
    const r = run(ACQ);
    assert.equal(r.evidenceChain!.find((s) => s.step === 'Revenue')?.state, 'not_established');
    assert.match(r.evidenceChain!.find((s) => s.step === 'Revenue')?.detail || '', /target's, not Deltacorp's/);
  });
  test('"Proven through step N" wording is gone from the card; ticks and question marks replace it', () => {
    const t = strip(card(run(ACQ)));
    assert.doesNotMatch(t, /proven through step/i);
    assert.match(t, /Evidence chain \(acquisition\)/);
    assert.match(t, /✓ Target/);
    assert.match(t, /\? Revenue/);
    const r = run(ACQ);
    assert.ok(typeof r.provenThrough === 'number', 'the numeric field stays internally');
  });
  test('confirmed facts carry an owner; model inference and unknowns are separate', () => {
    const r = run(ACQ);
    const f = r.factScope!;
    assert.ok(f.confirmed.length > 0 && f.confirmed.every((c) => c.owner));
    assert.ok(f.confirmed.some((c) => /Zenbar/.test(c.owner)));
    assert.ok(f.unknown.some((u) => /incremental revenue/.test(u)));
    assert.match(r.sourceSubjectLine || '', /Deltacorp \(acquirer\) and Zenbar Foods \(target\)/);
    assert.match(r.financialOwner || '', /Zenbar Foods \(target\), not Deltacorp/);
    const t = strip(card(r));
    assert.match(t, /Confirmed facts:/); assert.match(t, /Unknown:/);
  });
});

describe('11 link terminology', () => {
  test('strict wording', () => {
    assert.match(LINK_LABEL.DIRECT, /already shown in reported company financials/i);
    assert.match(LINK_LABEL.NEAR_DIRECT, /documented operating event.*quantified bridge/i);
    assert.match(LINK_LABEL.INDIRECT, /plausible pathway.*bridge incomplete/i);
    for (const k of ['NOT_ESTABLISHED', 'NONE', 'NOT_APPLICABLE'] as const) assert.ok(LINK_LABEL[k]);
  });
  test('a number alone never makes Near-direct; a foreign number never makes any link', () => {
    const noBridge = run({ title: 'Betaworks announces Rs 300 crore investment in a new market', company: 'Betaworks' });
    assert.ok(noBridge.link !== 'DIRECT' && noBridge.link !== 'NEAR_DIRECT');
    const foreign = run(ACQ);
    assert.ok(foreign.link !== 'DIRECT' && foreign.link !== 'NEAR_DIRECT');
  });
  test('Direct needs a parent reported figure', () => {
    // zzz854: the parent figure must come from a verified source (primary filing); the same headline from one media outlet is unverified
    for (const r of [run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon', sourceLabel: 'NSE filing' })]) assert.equal(r.link, 'DIRECT');
    assert.equal(run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon' }).link, 'NOT_ESTABLISHED');
  });
});

describe('12 research priority', () => {
  test('no link and no dated proof point is Low, never Medium', () => {
    for (const t of ['Court sets aside tax demand on Sigma Ltd', 'Tau Ltd raises Rs 500 crore via QIP']) {
      const r = run({ title: t, company: t.split(' ')[t.startsWith('Court') ? 5 : 0] + ' Ltd' });
      assert.equal(r.priority, 'LOW', t);
    }
    assert.equal(run(ACQ).priority, 'LOW');
  });
  test('priority factors are recorded; materiality is not assessable without a size; portfolio is a tie-break only', () => {
    const f = run({ title: 'Zetacorp wins Rs 400 crore order for power systems', company: 'Zetacorp', primarySource: true, sourceLabel: 'Exchange filing' }).priorityFactors!;
    assert.equal(f.materiality, 'not assessable');
    assert.equal(f.portfolio, 'tie-break only');
    assert.ok(['dated proof point', 'none'].includes(f.proximity));
  });
  test('a result that is not an inflection does not rank above Low', () => {
    assert.equal(run({ title: 'Epsilon Q1 net profit up 3% on flat revenue', company: 'Epsilon' }).priority, 'LOW');
  });
});

describe('13 diagnostics', () => {
  const batch = [
    mk({ id: 'a', title: 'Epsilon Q1 net profit up 3% on flat revenue', company: 'Epsilon' }),
    mk({ id: 'b', title: 'Pagecorp declares dividend as profit rises', company: 'Pagecorp' }),
    mk({ id: 'c', title: 'Court sets aside tax demand on Sigma Ltd', company: 'Sigma Ltd' }),
    mk({ id: 'd', title: 'Gridworks says capacity constrained, lead times stretch to 60 weeks', company: 'Gridworks', description: 'Supply shortage persists across the industry.' }),
    mk({ id: 'e', title: 'Kappa Corp launches tender offer at Rs 120 per share', company: 'Kappa Corp' }),
  ];
  const r = buildRadar(batch, { now: Date.parse('2026-09-30T00:00:00Z') });
  test('buildRadar returns the three audits', () => {
    const d = r.diagnostics;
    assert.ok(d.bottleneck.candidates >= 1);
    assert.match(d.lines.bottleneck, /^Bottleneck \d+ - \d+ candidates? screened: /);
    assert.match(d.lines.structural, /^Multibagger \/ structural \d+ - \d+ screened\. Failed on: /);
    assert.match(d.lines.noLink, /^No earnings link \d+/);
    assert.ok(d.noEarningsLink.total >= 3);
    assert.ok(d.noEarningsLink.byReason['dividend / split'] >= 1);
  });
  test('diagnostics only explain: items are unchanged by them', () => {
    const again = buildRadar(batch, { now: Date.parse('2026-09-30T00:00:00Z') });
    assert.deepEqual(again.items.map((i) => [i.id, i.bucket]), r.items.map((i) => [i.id, i.bucket]));
  });
});

describe('14 automatic QA gate', () => {
  const batch: RadarInput[] = [
    mk({ id: 'q1', ...ACQ }),
    mk({ id: 'q2', title: 'Pagecorp Declares Rs 200/Share Dividend, Despite Fall In Q1 Net Profit', company: 'Pagecorp' }),
    mk({ id: 'q3', title: 'Pagecorp declares dividend as profit rises', company: 'Pagecorp' }),
    mk({ id: 'q4', title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon' }),
    mk({ id: 'q5', title: 'Epsilon Q1 net profit falls 20%, revenue down 5%', company: 'Epsilon' }),
    mk({ id: 'q6', title: 'Kappa Corp launches tender offer at Rs 120 per share', company: 'Kappa Corp', description: 'The offer expires on 15 November 2026. The offer is subject to regulatory approvals.', primarySource: true, sourceLabel: 'SEC filing' }),
    mk({ id: 'q7', title: 'Omicron Ltd board approves demerger of its chemicals business', company: 'Omicron Ltd' }),
    mk({ id: 'q8', title: 'Court sets aside tax demand on Sigma Ltd', company: 'Sigma Ltd' }),
    mk({ id: 'q9', title: 'Tau Ltd raises Rs 500 crore via QIP', company: 'Tau Ltd' }),
    mk({ id: 'q10', title: 'Zetacorp wins Rs 400 crore order for power systems', company: 'Zetacorp', primarySource: true, sourceLabel: 'Exchange filing' }),
    mk({ id: 'q11', title: 'Lambda Ltd board approves buyback of 2 crore shares at Rs 500 per share', company: 'Lambda Ltd' }),
    mk({ id: 'q12', title: 'Gammafoods will invest Rs 900 crore in the snack brand', company: 'Gammafoods', description: 'Rs 645 crore is planned for distribution and Rs 452 crore for marketing.' }),
    mk({ id: 'q13', title: 'Unlisted Holdco Pvt Ltd to acquire Rivermark Foods for Rs 700 crore', company: 'Unlisted Holdco Pvt Ltd', ticker: null, tickerResolved: false, description: 'Rivermark Foods has revenue of Rs 90 crore.' }),
  ];
  const items = buildRadar(batch, { now: Date.parse('2026-09-30T00:00:00Z') }).items;
  const qa = qaErrorsOf(items);
  test('0 errors of each class on the synthetic batch', () => {
    assert.equal(qa.checked, items.length);
    for (const c of QA_CLASSES) assert.equal(qa.counts[c], 0, `${c}: ${JSON.stringify(qa.errors.filter((e) => e.cls === c))}`);
    assert.equal(qa.total, 0);
  });
  test('the report lists counts for every class and at most 20 errors with ids', () => {
    assert.equal(Object.keys(qa.counts).length, QA_CLASSES.length);  // zzz854: 8 -> 13 classes
    assert.ok(qa.top.length <= 20);
  });
  test('the gate does catch a broken item (it is not vacuous)', () => {
    const base = items.find((i) => i.id === 'q1')!;
    const bad: RadarItem = { ...base, id: 'bad', link: 'DIRECT', ticker: null, resolutionAttempt: 'none', evidenceLabel: 'Confirmed', evidence: { ...base.evidence, status: 'CONFIRMED', sourceRank: 10 },
      financialImpact: 'revenue Rs 452 crore', breakConditions: ['antitrust risk'], economicMechanism: 'A dividend changes the share count or cash returned, not what the business earns.' };
    const q = qaErrorsOf([bad]);
    for (const c of ['number-owner mismatch', 'unsupported earnings link', 'secondary-as-confirmed', 'unsupported break condition', 'generic mechanism text', 'no-ticker-without-resolution-attempt'] as const) assert.ok(q.counts[c] > 0, c);
  });
  test('an item with no ticker and a recorded resolution attempt is fine', () => {
    const q13 = items.find((i) => i.id === 'q13')!;
    assert.equal(q13.ticker, null);
    assert.notEqual(q13.resolutionAttempt, 'none');
  });
});

describe('rules that must keep holding', () => {
  test('no BUY / SELL words, no 0-100 scores, no price as evidence on the new fields', () => {
    for (const r of [run(ACQ), run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon' }), run({ title: 'Pagecorp declares dividend as profit rises', company: 'Pagecorp' })]) {
      const t = strip(card(r));
      assert.doesNotMatch(t, /\b(BUY|SELL)\b/);
      assert.doesNotMatch(t, /\b\d{1,3}\s*\/\s*100\b|\bscore\b/i);
      assert.doesNotMatch(t, /undefined|NaN|\bnull\b/);
    }
  });
  test('the engine is deterministic', () => {
    assert.deepEqual(run(ACQ), run(ACQ));
  });
});
