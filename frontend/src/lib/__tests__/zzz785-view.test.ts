// zzz785 C — timeline / dedup / persistence / UI for AI Daily Gainers.
//   RAYMOND timeline merge (older related filing + current + press), VIKRAN
//   negative + positive on one card, fundraising unknowns, BETA strategic
//   stake from press = Potential · verification required, USDE resale
//   wording, dedup by catalyst id, persistence-test grades, the three gap
//   labels, cross-day state memory, evidence breadth, card render.
// Run: npx tsx --test src/lib/__tests__/zzz785-view.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Finding } from '../ai-gainers/catalyst-research';
import { emptyEconomics, emptyTime, type StructuredFacts, type SourceRef, type EventKind } from '../ai-gainers/structured-facts';
import { buildCatalystRecords, threadTimeline, evidenceBreadthOf, factsForFinding } from '../ai-gainers/catalyst-timeline';
import { persistenceTestOf } from '../ai-gainers/persistence-test';
import { buildResearchView, type ResearchItem, type ResearchViewInput } from '../ai-gainers/research-view';
import { mergeCatalystFindings } from '../catalyst/persistence-store';
import { ResearchCard } from '../../components/ai-gainers/ResearchCard';
import { ResearchTriage } from '../../components/ai-gainers/ResearchTriage';

const NOW = '2026-09-24T10:00:00.000Z';

function src(p: Partial<SourceRef> & { title: string }): SourceRef {
  return { kind: 'EXCHANGE_FILING', access: 'DOCUMENT_READ', issuer: 'X', date: '2026-09-23', url: null, ...p };
}
function fact(kind: EventKind, s: SourceRef, o: { counterparty?: string | null; product?: string | null; stage?: any; value?: number | null; period?: string | null; quotes?: string[]; issuePrice?: number | null; dilutionPct?: number | null; allottees?: string[] } = {}): StructuredFacts {
  return {
    source: s,
    event: { kind, counterparty: o.counterparty ?? null, product: o.product ?? null, geography: null, stage: o.stage ?? null },
    economics: { ...emptyEconomics(), valueNative: o.value ?? null, currency: o.value != null ? 'INR_CR' : null, issuePrice: o.issuePrice ?? null, dilutionPct: o.dilutionPct ?? null, allottees: o.allottees ?? [] },
    time: { ...emptyTime(), executionPeriod: o.period ?? null },
    quotes: o.quotes ?? [], unknowns: [], verificationRequired: s.kind === 'PRESS',
  };
}
function mk(p: Partial<Finding> & { ticker: string }): Finding {
  return {
    company: `${p.ticker} Ltd`, market: 'IN', movePct: 6, marketCap: 5000, turnover: 20,
    status: 'none', category: null, stage: null, headline: null, evidenceQuote: null, sourceUrl: null, sourceDate: null,
    sourceTier: 'unsourced', ageDays: null, valueStated: null, valuePctMcap: null, net: null, components: null, verdict: null,
    returns: { m1: 6, m3: 10, m6: 15, y1: 30, history: 250 }, bandPrint: false, bandLevel: null, listingDays: null,
    routine: [], filingsInWindow: 0, windowDays: 21, holding: false, notes: [], modelRead: false,
    researchedAt: NOW, sources: ['bse'], ...p,
  } as Finding;
}
const view = (findings: Record<string, Finding>, extra: Partial<ResearchViewInput> = {}) => buildResearchView({
  market: 'IN', findings, board: Object.values(findings).map((f) => ({ ticker: f.ticker, company: f.company, move_pct: f.movePct, market_cap: f.marketCap })),
  filedResults: [], holdings: [], now: NOW, ...extra,
});
const all = (v: ReturnType<typeof view>): ResearchItem[] => [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || [])];
const item = (v: ReturnType<typeof view>, t: string) => { const i = all(v).find((x) => x.ticker === t); assert.ok(i, t); return i!; };
(globalThis as any).React = React;
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');

// ── RAYMOND (fixtures/zzz785/raymond-2026-09-11.txt, raymond-2026-09-23.txt) ──
const R_URL_11 = 'https://www.bseindia.com/raymond-2026-09-11.pdf';
const R_URL_23 = 'https://www.bseindia.com/raymond-2026-09-23.pdf';
const rFact11 = fact('order', src({ issuer: 'RAYMOND', date: '2026-09-11', url: R_URL_11, title: 'Raymond Limited\'s Aerospace Subsidiary Wins Multi-Programme Aerospace Orders from a Leading Indian Aerospace and Defence Major' }),
  { counterparty: 'Leading Indian Aerospace and Defence Major', product: 'precision machining, castings, structural components', quotes: ['with an annual business potential of approximately 33 crore'] });
const rFact23 = fact('order', src({ issuer: 'RAYMOND', date: '2026-09-23', url: R_URL_23, title: 'Raymond Expands Its Aerospace Capabilities with Entry into Aircraft Structures' }),
  { counterparty: 'Leading Indian Aerospace and Defence OEM', product: 'wing and centre fuselage structures', stage: 'AWARDED', quotes: ['JK Maini Global Aerospace Limited has emerged as successful in the tender process'] });
const rPress = fact('order', src({ kind: 'PRESS', access: 'SUMMARY_ONLY', issuer: 'RAYMOND', date: '2026-09-23', url: 'https://news.example/raymond-fuselage', title: 'Raymond arm wins fighter jet fuselage assembly work' }));
const rPressRepeat = fact('order', src({ kind: 'PRESS', access: 'SUMMARY_ONLY', issuer: 'RAYMOND', date: '2026-09-24', url: 'https://other.example/raymond', title: 'Raymond arm wins fighter jet fuselage assembly work' }));
const raymond = (facts: StructuredFacts[]) => mk({ ticker: 'RAYMOND', status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', modelRead: true,
  headline: 'Raymond aerospace subsidiary successful in tender for wing and centre fuselage structures', evidenceQuote: 'JK Maini Global Aerospace Limited has emerged as successful in the tender process',
  sourceUrl: R_URL_23, sourceDate: '2026-09-23', ageDays: 1, marketCap: 9000, facts: facts as any });

describe('zzz785 · RAYMOND — older related filing + current filing + press in ONE timeline', () => {
  test('before: a legacy finding (no structured facts) → one record, one entry; after: the thread, oldest → newest, press merged into the filing', () => {
    const before = item(view({ RAYMOND: raymond(null as any) }), 'RAYMOND');
    assert.equal(before.timeline?.length, 1, 'legacy path: one filing, nothing more is invented');
    const it = item(view({ RAYMOND: raymond([rPressRepeat, rFact23, rPress, rFact11]) }), 'RAYMOND');
    const tl = it.timeline!;
    assert.deepEqual(tl.map((t) => t.date), ['2026-09-11', '2026-09-23', '2026-09-23'], 'oldest → newest; the repeated press headline merged away');
    assert.match(tl[0].title, /Multi-Programme Aerospace Orders/);
    assert.equal(tl.filter((t) => t.kind === 'PRESS').length, 1);
    assert.equal(tl.find((t) => t.kind === 'PRESS')!.status, 'secondary · confirmed by filing');
    assert.equal(it.catalysts![0].id, 'RAYMOND:order:leading-indian-aerospace-and-defence-oem', 'the current filing is the primary record');
    assert.equal(it.catalysts![0].duplicatesMerged, 1);
    assert.equal(it.catalysts![0].state, 'DOCUMENTED');
    assert.match(it.catalysts![0].nextMilestone!, /execution or billing update/);
  });

  test('cross-day memory: day 1 stores the 11-Sep order; day 2 (only today\'s filing on the finding) still shows it in the timeline', () => {
    const day1 = mergeCatalystFindings({}, { RAYMOND: raymond([rFact11]) }, '2026-09-11');
    assert.equal(day1.changed, 1);
    const rec = Object.values(day1.records)[0];
    assert.equal(rec.state, 'DOCUMENTED'); assert.equal(rec.firstSeen, '2026-09-11');
    const it = item(view({ RAYMOND: raymond([rFact23]) }, { priorCatalysts: day1.records }), 'RAYMOND');
    assert.deepEqual(it.timeline!.map((t) => t.date), ['2026-09-11', '2026-09-23']);
    // Same catalyst seen again with a follow-up official filing → EXECUTING, previous state kept.
    const again = fact('order', src({ issuer: 'RAYMOND', date: '2026-10-20', url: 'https://www.bseindia.com/raymond-2026-10-20.pdf', title: 'Raymond aerospace: first deliveries under the multi-programme orders' }), { counterparty: 'Leading Indian Aerospace and Defence Major' });
    const day3 = mergeCatalystFindings(day1.records, { RAYMOND: raymond([again]) }, '2026-10-20');
    const r3 = day3.records[rec.id];
    assert.equal(r3.state, 'EXECUTING'); assert.equal(r3.previousState, 'DOCUMENTED'); assert.equal(r3.firstSeen, '2026-09-11');
    assert.equal(r3.sources.length, 2);
    // Re-scanning the same filing changes nothing.
    assert.equal(mergeCatalystFindings(day3.records, { RAYMOND: raymond([again]) }, '2026-10-21').changed, 0);
  });
});

describe('zzz785 · dedup by catalyst id', () => {
  test('same URL twice, a repeated press headline and "POWERGRID" / "Power Grid Corporation of India Ltd" → one record', () => {
    const u = 'https://www.bseindia.com/v.pdf';
    const recs = buildCatalystRecords('VIKRAN', 'IN', [
      fact('order', src({ url: u, title: 'Order from POWERGRID ₹153.76 Cr', date: '2026-09-23' }), { counterparty: 'POWERGRID', value: 153.76 }),
      fact('order', src({ url: u, title: 'Order from POWERGRID ₹153.76 Cr', date: '2026-09-23' }), { counterparty: 'Power Grid Corporation of India Ltd', value: 153.76 }),
      fact('order', src({ kind: 'PRESS', access: 'SUMMARY_ONLY', url: 'https://a.example/1', title: 'Vikran bags POWERGRID order', date: '2026-09-23' })),
      fact('order', src({ kind: 'PRESS', access: 'SUMMARY_ONLY', url: 'https://b.example/2', title: 'Vikran bags POWERGRID order', date: '2026-09-24' })),
    ]);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].sources.length, 2, 'one filing + one press item');
    assert.equal(recs[0].duplicatesMerged, 2);
    assert.equal(recs[0].verification, 'Official filing on file · press merged into it');
    const b = evidenceBreadthOf({}, recs)!;
    assert.deepEqual([b.documents, b.sourceKinds, b.eventKinds], [2, 2, 1]);
    assert.equal(b.text, '2 documents · 2 source kinds · 1 event kind');
  });

  test('press alone stays IDENTIFIED and says "secondary · verification required"; a later cancellation filing → DISPROVED', () => {
    const p = buildCatalystRecords('X', 'IN', [fact('order', src({ kind: 'PRESS', access: 'SUMMARY_ONLY', title: 'X said to win big order' }), { counterparty: 'Acme' })]);
    assert.equal(p[0].state, 'IDENTIFIED'); assert.equal(p[0].timeline[0].status, 'secondary · verification required');
    const d = buildCatalystRecords('X', 'IN', [
      fact('order', src({ date: '2026-08-01', url: 'u1', title: 'Order from Acme' }), { counterparty: 'Acme' }),
      fact('order', src({ date: '2026-09-01', url: 'u2', title: 'Order from Acme cancelled by the customer' }), { counterparty: 'Acme' }),
    ]);
    assert.equal(d[0].state, 'DISPROVED');
  });
});

describe('zzz785 · VIKRAN — a negative and a positive coexist on one card', () => {
  const GST_URL = 'https://www.bseindia.com/vikran-gst.pdf';
  const f = mk({ ticker: 'VIKRAN', status: 'negative', category: 'tax_litigation', sourceTier: 'primary', modelRead: true, marketCap: 2400,
    headline: 'GST demand cum show cause notice (DRC-01) of ₹2.10 crore under Section 73', evidenceQuote: 'received a Demand Cum Show Cause Notice ( SCN ) in Form GST DRC-01',
    sourceUrl: GST_URL, sourceDate: '2026-09-23', ageDays: 1,
    facts: [
      fact('tax_litigation', src({ issuer: 'VIKRAN', url: GST_URL, title: 'GST demand cum show cause notice (DRC-01)' }), { counterparty: 'CGST & CX Patna-I', value: 2.1 }),
      fact('order', src({ issuer: 'VIKRAN', url: 'https://www.bseindia.com/vikran-order.pdf', title: 'Vikran Engineering Secures ₹153.76 Crore Order from POWERGRID' }), { counterparty: 'POWERGRID', value: 153.76, stage: 'AWARDED' }),
    ] as any });
  test('both records on the item; negative sized against market cap; the card shows ALSO ON FILE', () => {
    const it = item(view({ VIKRAN: f }), 'VIKRAN');
    assert.equal(it.eventClass, 'NEGATIVE');
    const [neg, pos] = it.catalysts!;
    assert.equal(neg.polarity, 'negative'); assert.equal(pos.polarity, 'positive');
    assert.equal(neg.materialityText, '₹2.1 Cr ÷ ₹2,400 Cr market cap = 0.09%');
    assert.equal(pos.materialityText, '₹153.76 Cr ÷ ₹2,400 Cr market cap = 6.4%');   // zzz787: the stated value exactly, not rounded to ₹154 Cr
    const t = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {} })));
    assert.ok(t.includes('ALSO ON FILE FOR THIS COMPANY') && t.includes('POWERGRID') && t.includes('▲ Positive'), t);
    assert.equal(it.persistenceTest!.grade, 'TEMPORARY');
  });
});

describe('zzz785 · fundraising — materiality Unknown until amount / price / allottees / dilution are known', () => {
  test('only the amount stated → Unknown, says which are missing, stays visible under "Unknown — needs reading"', () => {
    const v = view({ KABRA: mk({ ticker: 'KABRA', status: 'catalyst', category: 'fundraising', stage: 'executed', sourceTier: 'primary', marketCap: 800,
      headline: 'Allotment of equity shares on preferential basis raising ₹50 crore', sourceUrl: 'k', sourceDate: '2026-09-23', ageDays: 1, valueStated: 50 }) });
    const it = item(v, 'KABRA');
    assert.equal(it.materiality.label, 'UNKNOWN');
    assert.match(it.materiality.explanation, /missing: issue price, allottees, dilution/);
    assert.equal(it.economicsUnknown!.label, 'Unknown — needs reading');
    assert.deepEqual(it.economicsUnknown!.missing, ['issue price', 'allottees', 'dilution']);
    assert.ok(v.needsReading!.some((x) => x.ticker === 'KABRA'));
    assert.ok(it.priorityReasons.some((r) => r.startsWith('Unknown — needs reading')));
    assert.ok(it.researchNext.some((q) => /Dilution: new shares ÷ existing shares/.test(q)));
    const html = renderToStaticMarkup(React.createElement(ResearchTriage, { view: v, market: 'IN' } as any));
    assert.ok(strip(html).includes('NEEDS READING'));   // zzz836: the empty section is hidden; the row / chip still says it
  });
  test('all four known (structured facts) → a sized label', () => {
    const it = item(view({ KABRA: mk({ ticker: 'KABRA', status: 'catalyst', category: 'fundraising', stage: 'executed', sourceTier: 'primary', marketCap: 800,
      headline: 'Allotment of 40 lakh shares to Alpha Growth Fund', sourceUrl: 'k', sourceDate: '2026-09-23', ageDays: 1, valueStated: 50,
      facts: [fact('fundraising', src({ title: 'Allotment' }), { value: 50, issuePrice: 125, dilutionPct: 6.2, allottees: ['Alpha Growth Fund'] })] as any }) }), 'KABRA');
    assert.notEqual(it.materiality.label, 'UNKNOWN');
    assert.equal(it.economicsUnknown, null);
    // zzz789 (intentional change): TEMPORARY only on evidence of a one-off / finite effect; a raise persists
    // through its use of proceeds, which is not established → EARLY.
    assert.equal(it.persistenceTest!.grade, 'EARLY');
  });
});

describe('zzz785 · BETA — a strategic stake seen only in the press is Potential · verification required', () => {
  test('never "no catalyst"; label, verification chip and research questions say so', () => {
    const v = view({ BETA: mk({ ticker: 'BETA', status: 'none', facts: [fact('stake_by_strategic', src({ kind: 'PRESS', access: 'SUMMARY_ONLY', issuer: 'BETA', title: 'Strategic investor picks up 9.9% stake in Beta Drugs', url: 'https://news.example/beta' }), { counterparty: 'Strategic Investor' })] as any }) });
    const it = item(v, 'BETA');
    assert.equal(it.eventClass, 'POTENTIAL_UNVERIFIED');
    assert.equal(it.eventLabel, 'Strategic investment — Potential · verification required');   // zzz787: its own type (was "Strategic stake", typed Acquisition)
    assert.equal(it.eventType, 'Strategic investment');
    assert.equal(it.verification, 'Secondary · verification required');
    assert.ok(!v.noCatalyst.some((x) => x.ticker === 'BETA'));
    assert.ok(it.researchNext.some((q) => /official filing \(SAST \/ 13D/.test(q)));
    assert.equal(it.catalysts![0].state, 'IDENTIFIED');
    assert.equal(it.persistenceTest!.grade, 'EARLY');
    const t = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {} })));
    assert.ok(t.includes('SOURCE: PRESS ONLY') && t.includes('EVIDENCE: SECONDARY ONLY'));   // zzz836: source existence and verification are two chips
  });
});

describe('zzz785 · USDE — resale registration wording', () => {
  test('"resale overhang — does not by itself mean the price must fall"; resale questions, not raise questions', () => {
    const f = mk({ ticker: 'USDE', market: 'US', status: 'negative', category: 'dilution', sourceTier: 'primary', marketCap: 300,
      headline: '424B3: Prospectus — resale by selling stockholders', notes: ['Registration: resale / shelf registration — supply overhang, no new raise'], sourceUrl: 'https://www.sec.gov/usde', sourceDate: '2026-09-20', ageDays: 3 });
    const v = buildResearchView({ market: 'US', findings: { USDE: f }, board: [{ ticker: 'USDE', company: 'USDE Inc', move_pct: 12, market_cap: 300 }], filedResults: [], holdings: [], now: NOW });
    const it = item(v, 'USDE');
    assert.equal(it.eventClass, 'NO_CATALYST');
    assert.match(it.whyResearch, /resale overhang does not by itself mean the price must fall/);
    assert.ok(it.researchNext.some((q) => /registered for resale/.test(q)));
    assert.equal(it.evidenceGap, null, 'a resale is its own answer, not "no catalyst found"');
  });
});

describe('zzz785 · the three gap labels are distinct', () => {
  test('No catalyst / Unclassified / Evidence incomplete; an explicit evidenceGap from the finding wins', () => {
    const v = view({
      NONE1: mk({ ticker: 'NONE1', status: 'none' }),
      UNCL: mk({ ticker: 'UNCL', status: 'routine_only', headline: 'Filing not classifiable from its subject', filingsInWindow: 1 }),
      INCOMP: mk({ ticker: 'INCOMP', status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', headline: 'Receipt of order', sourceUrl: 'i', sourceDate: '2026-09-23', ageDays: 1 }),
      GIVEN: mk({ ticker: 'GIVEN', status: 'none', evidenceGap: 'EVIDENCE_INCOMPLETE' } as any),
    });
    assert.equal(item(v, 'NONE1').evidenceGap!.label, 'No catalyst');
    assert.equal(item(v, 'UNCL').evidenceGap!.label, 'Unclassified');
    assert.equal(item(v, 'INCOMP').evidenceGap!.label, 'Evidence incomplete');
    assert.equal(item(v, 'GIVEN').evidenceGap!.label, 'Evidence incomplete');
    assert.equal(new Set(['NONE1', 'UNCL', 'INCOMP'].map((t) => item(v, t).evidenceGap!.text)).size, 3);
  });
});

describe('zzz785 · persistence test — small explicit rules', () => {
  const order = (facts: StructuredFacts[]) => buildCatalystRecords('T', 'IN', facts)[0];
  const run = (facts: StructuredFacts[], o: Partial<Parameters<typeof persistenceTestOf>[0]> = {}) => persistenceTestOf({
    kind: facts[0]?.event.kind ?? null, facts, record: facts.length ? order(facts) : null, potential: 'QUARTER', evidenceLevel: 'EVIDENCE', evidenceText: 'Commercial order on file.', hay: '', market: 'IN', ...o,
  });
  test('HIGH: filed, runway disclosed, repeat business on file', () => {
    const t = run([
      fact('order', src({ date: '2026-05-01', url: 'a', title: 'Order from Acme' }), { counterparty: 'Acme', value: 120 }),
      fact('order', src({ date: '2026-09-01', url: 'b', title: 'Repeat order from Acme' }), { counterparty: 'Acme', value: 140, period: '24 months' }),
    ]);
    assert.equal(t.grade, 'HIGH'); assert.equal(t.duration, '24 months'); assert.equal(t.expectedDuration, '24 months (as disclosed)');
    assert.match(t.mechanism!, /Order from Acme of ₹140 Cr/);
  });
  test('EARLY: one filing with a stated period (zzz789); EARLY: press only; EARLY: fundraising (zzz789)', () => {
    // zzz789 (intentional change): a stated period with no quantified value and no repeat filing is a runway,
    // not evidence → EARLY (was MEDIUM). MEDIUM needs quantified economics AND repeat / continuation evidence.
    const m = run([fact('order', src({ url: 'a', title: 'Order from Acme' }), { counterparty: 'Acme', period: '18 months' })]);
    assert.equal(m.grade, 'EARLY'); assert.equal(m.repeatability, null);
    const q = run([fact('order', src({ date: '2026-09-01', url: 'a', title: 'Order from Acme' }), { counterparty: 'Acme', value: 50 }), fact('order', src({ date: '2026-09-20', url: 'b', title: 'Repeat order from Acme' }), { counterparty: 'Acme', value: 60 })]);
    assert.equal(q.grade, 'MEDIUM', q.why);
    const e = run([fact('order', src({ kind: 'PRESS', access: 'SUMMARY_ONLY', title: 'Acme order reported' }), { counterparty: 'Acme' })]);
    assert.equal(e.grade, 'EARLY'); assert.match(e.why, /official filing/);
    const f = run([fact('fundraising', src({ title: 'QIP' }))], { evidenceLevel: 'NOT_PERSISTENT' });
    assert.equal(f.grade, 'EARLY');
  });
  test('duration is never invented: no disclosed period → "Not disclosed"; potential and evidence kept separate', () => {
    const t = run([fact('order', src({ url: 'a', title: 'Order from Acme' }), { counterparty: 'Acme' })], { potential: 'YEARS' });
    assert.equal(t.duration, null); assert.equal(t.expectedDuration, 'Not disclosed');
    assert.match(t.potential, /Could last years/); assert.equal(t.evidenceSupported, 'Commercial order on file.');
    for (const s of [t.why, t.mechanism || '', t.potential]) assert.ok(!/\b(buy|sell|exit|stop)\b/i.test(s));
  });
});

describe('zzz785 · legacy findings keep today\'s behaviour', () => {
  test('a finding with the old facts map (Record) still answers research questions and builds one legacy fact', () => {
    const f = mk({ ticker: 'OLD', status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', modelRead: true, headline: 'Order from NHAI ₹200 Cr', evidenceQuote: 'order of ₹200 crore', sourceUrl: 'o', sourceDate: '2026-09-23', ageDays: 1, valueStated: 200, facts: { counterparty: 'NHAI', execution_period: '24 months' } });
    assert.equal(factsForFinding(f).length, 1);
    const it = item(view({ OLD: f }), 'OLD');
    assert.ok(it.researchNext.some((q) => /✓ 24 months/.test(q)));
    assert.equal(it.catalysts![0].id, 'OLD:order:nhai');
    assert.equal(it.persistenceTest!.duration, '24 months');
  });
  test('card render: six section toggles, no undefined / NaN / null, no trade words', () => {
    const v = view({ RAYMOND: raymond([rFact11, rFact23, rPress]) });
    const it = item(v, 'RAYMOND');
    const t = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {} })));
    for (const s of ['EVIDENCE', 'ECONOMIC MECHANISM', 'CATALYST TIMELINE (3)', 'PERSISTENCE', 'RESEARCH NEXT', 'SOURCE DETAILS']) assert.ok(t.includes(s), s);
    assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b/.test(t));
    assert.ok(!/\b(buy|sell)\b/i.test(t));
  });
});

describe('zzz785 · thread timeline is display-only', () => {
  test('related anchors join the timeline but stay separate records', () => {
    const recs = buildCatalystRecords('RAYMOND', 'IN', [rFact11, rFact23]);
    assert.equal(recs.length, 2);
    assert.equal(threadTimeline(recs, recs[0]).length, 2);
  });
});
