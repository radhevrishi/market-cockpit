// zzz787 — owner QA of AI Daily Gainers: verified-only materiality (VIKRAN),
// four separate duration concepts (RNIT / RAYMOND / ABDL), distinct ownership
// event types (ZIMLAB / BETA / GNA / merger), Special Focus stricter than a
// persistent catalyst candidate (MILKYMIST), the MAXESTATES milestone chain,
// one catalyst across three views, and thesis status untouched by any of it.
// Fixtures: the real BSE attachment text layers in fixtures/zzz785 where the
// owner's names have one; small constructed findings elsewhere.
// Run: npx tsx --test src/lib/__tests__/zzz787.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildFinding, classifyAnnouncement, type AnnouncementLite, type Finding } from '../ai-gainers/catalyst-research';
import { extractIndiaFacts, readIndiaDocuments } from '../ai-gainers/india-extract';
import { emptyEconomics, emptyTime, contractTermYears, type EventKind, type SourceRef, type StructuredFacts } from '../ai-gainers/structured-facts';
import { buildResearchView, guardPotential, persistenceEvidenceOf, type ResearchItem, type ResearchViewInput } from '../ai-gainers/research-view';
import { detectPersistentCatalysts, summarizePersistence, trackPotentialFromFinding, type PersistentCatalyst } from '../catalyst/persistence';
import { mergeDetections, type PersistBlob } from '../catalyst/persistence-store';
import { specialFocusQueue, persistentIdOfEvent } from '../catalyst/cross-view';
import { extractVariables } from '../thesis/variables';
import { assessThesis } from '../thesis/status';
import { classifyGradedRow } from '../earnings/pattern-abfg';
import { PersistenceSection, ResearchCard } from '../../components/ai-gainers/ResearchCard';

(globalThis as any).React = React;
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const FX = join(__dirname, 'fixtures', 'zzz785');
const txt = (f: string) => readFileSync(join(FX, f), 'utf8');
const B = (id: string) => `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=${id}.pdf`;
const NOW = new Date('2026-09-24T12:00:00+05:30');
const NOW_ISO = '2026-09-24T06:30:00.000Z';
const docsFrom = (issuer: string, map: Record<string, string>, anns: AnnouncementLite[], relation: 'current' | 'history' = 'current') =>
  readIndiaDocuments(issuer, anns.filter((a) => map[a.url]), async (u) => (map[u] ? txt(map[u]) : ''), { relation });
const find = (ticker: string, anns: AnnouncementLite[], docs: any[] | null, extra: Partial<Parameters<typeof buildFinding>[0]> = {}) =>
  buildFinding({ ticker, company: ticker, market: 'IN', movePct: 6, marketCap: 2000, turnover: 40, announcements: anns, returns: null, holding: false, sources: ['BSE corporate announcements'], sourceFailed: false, windowDays: 21, now: NOW, sessionCloseIso: '2026-09-24T15:30:00+05:30', docs, ...extra });
const view = (findings: Record<string, Finding>, extra: Partial<ResearchViewInput> = {}) => buildResearchView({
  market: 'IN', findings, board: Object.values(findings).map((f) => ({ ticker: f.ticker, company: f.company, move_pct: f.movePct, market_cap: f.marketCap })),
  filedResults: [], holdings: [], now: NOW_ISO, ...extra,
});
const all = (v: ReturnType<typeof view>): ResearchItem[] => [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || [])];
const item = (v: ReturnType<typeof view>, t: string) => { const i = all(v).find((x) => x.ticker === t); assert.ok(i, t); return i!; };
function mk(p: Partial<Finding> & { ticker: string }): Finding {
  return {
    company: `${p.ticker} Ltd`, market: 'IN', movePct: 6, marketCap: 5000, turnover: 20,
    status: 'none', category: null, stage: null, headline: null, evidenceQuote: null, sourceUrl: null, sourceDate: null,
    sourceTier: 'unsourced', ageDays: null, valueStated: null, valuePctMcap: null, net: null, components: null, verdict: null,
    returns: { m1: 6, m3: 10, m6: 15, y1: 30, history: 250 }, bandPrint: false, bandLevel: null, listingDays: null,
    routine: [], filingsInWindow: 0, windowDays: 21, holding: false, notes: [], modelRead: false,
    researchedAt: NOW_ISO, sources: ['bse'], ...p,
  } as Finding;
}
function fact(kind: EventKind, s: Partial<SourceRef> & { title: string }, o: { counterparty?: string | null; value?: number | null; stage?: any } = {}): StructuredFacts {
  return {
    source: { kind: 'EXCHANGE_FILING', access: 'DOCUMENT_READ', issuer: 'X', date: '2026-09-23', url: null, ...s },
    event: { kind, counterparty: o.counterparty ?? null, product: null, geography: null, stage: o.stage ?? null },
    economics: { ...emptyEconomics(), valueNative: o.value ?? null, currency: o.value != null ? 'INR_CR' : null },
    time: emptyTime(), quotes: [], unknowns: [], verificationRequired: s.kind === 'PRESS',
  };
}
const NO_TRADE = /\b(buy|sell|exit|stop[- ]loss)\b/i;

// ═══════════════════════════════════════════════════════════════════════════
// 1 · VIKRAN — never a materiality % from a figure the read document has not confirmed
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · VIKRAN — stated (unverified) vs document-verified order value', () => {
  const ORDER = B('ceee1a58-fb2d-4d45-aca0-8adb6ff98ec3'), GST = B('98ef3f2b-0b54-4f40-9384-6724175b304c');
  const anns: AnnouncementLite[] = [
    { subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Vikran won ₹153.76 crore POWERGRID order for Tumkur-II 400 kV AIS substation extension, executable in 21 months.', url: ORDER, dateIso: '2026-09-23T18:10:00+05:30', ageDays: null },
    { subject: 'Disclosure Of Information Under Regulation 30 Of The SEBI (LODR) Regulations, 2015', summary: 'Vikran Engineering received GST SCN for FY23, demanding Rs. 5.34 crore tax and Rs. 53.44 lakh penalty.', url: GST, dateIso: '2026-09-23T16:59:59+05:30', ageDays: null },
  ];

  test('BEFORE the document is read: "Stated order value: ₹153.76 Cr · Source: filing metadata/summary · Document verification: pending", materiality UNKNOWN, no ratio anywhere', () => {
    const f = find('VIKRAN', anns, null);
    assert.equal(f.status, 'catalyst'); assert.equal(f.category, 'order_win');
    assert.equal(f.valueStated, 153.76);
    assert.equal(f.valuePctMcap, null, 'the sweep computes no % from an unverified figure');
    const it = item(view({ VIKRAN: f }), 'VIKRAN');
    assert.equal(it.whatChanged, 'Stated order value: ₹153.76 Cr · Source: filing metadata/summary · Document verification: pending');
    assert.equal(it.materiality.label, 'UNKNOWN');
    assert.equal(it.materiality.verification, 'PENDING');
    assert.equal(it.materiality.ratios.length, 0);
    assert.match(it.materiality.explanation, /^UNKNOWN — pending document verification/);
    // Nowhere on the item does a % of market cap sit beside "not verified".
    const blob = JSON.stringify(it);
    assert.ok(!/9\.8%|7\.7%|of market cap = /.test(blob), 'no ratio from the stated figure');
    assert.ok(!/figure not verified in the document/.test(blob), 'the contradictory old wording is gone');
    assert.ok(it.researchNext.every((q) => !/% of market cap/.test(q)));
    // Unverified materiality does not feed ranking: it is the neutral UNKNOWN factor.
    assert.equal(it.scoreDetails!.materiality, 0.5);
    assert.ok(!it.priorityReasons.some((r) => /vs market cap|vs revenue/.test(r)));
  });

  test('AFTER the document is read: "₹153.76 Cr ÷ market cap = X%", evidence confidence 1.0', async () => {
    const docs = await docsFrom('VIKRAN', { [ORDER]: 'vikran-order.txt', [GST]: 'vikran-gst.txt' }, anns);
    const f = find('VIKRAN', anns, docs);
    assert.equal(f.docExtract, true);
    assert.equal(f.valuePctMcap, 7.69);
    const it = item(view({ VIKRAN: f }), 'VIKRAN');
    assert.equal(it.materiality.verification, 'DOCUMENT_VERIFIED');
    assert.equal(it.materiality.confidence, 1);
    assert.equal(it.materiality.ratios[0].text, '₹153.76 Cr ÷ ₹2,000 Cr market cap = 7.7%');
    assert.equal(it.whatChanged, 'Order ₹153.76 Cr ÷ ₹2,000 Cr market cap = 7.7% (document-verified)');
    assert.match(it.materiality.explanation, /evidence confidence 1\.0/);
    // The contractual duration is the stated 21-month execution period, never revenue.
    assert.match(it.durations!.contractual || '', /^Execution period: 21 months/);
  });

  test('a stated value on a press / summary-only structured fact is sized "pending", a DOCUMENT_READ one is sized', () => {
    const f = mk({ ticker: 'VIKRAN', status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', marketCap: 2400, headline: 'Order from POWERGRID', sourceUrl: 'https://x/o', sourceDate: '2026-09-23', ageDays: 1, valueStated: 153.76,
      structuredFacts: [
        fact('order', { issuer: 'VIKRAN', url: 'https://x/o', title: 'Order from POWERGRID', access: 'SUMMARY_ONLY' }, { counterparty: 'POWERGRID', value: 153.76 }),
      ] } as any);
    const it = item(view({ VIKRAN: f }), 'VIKRAN');
    assert.equal(it.catalysts![0].materialityText, '₹153.76 Cr stated · document verification pending (no ratio)');
    assert.equal(it.materiality.verification, 'PENDING');
    const g = { ...f, structuredFacts: [fact('order', { issuer: 'VIKRAN', url: 'https://x/o', title: 'Order from POWERGRID' }, { counterparty: 'POWERGRID', value: 153.76 })] } as any;
    const it2 = item(view({ VIKRAN: g }), 'VIKRAN');
    assert.equal(it2.materiality.verification, 'DOCUMENT_VERIFIED', 'a read document stating the same value verifies it');
    assert.equal(it2.catalysts![0].materialityText, '₹153.76 Cr ÷ ₹2,400 Cr market cap = 6.4%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · RNIT — a contract term is a runway, never revenue
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · RNIT — five-year services agreement', () => {
  const ann: AnnouncementLite = { subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'RNIT signs five-year services agreement with a global logistics customer for managed IT services.', url: B('11110000-2222-3333-4444-555566667777'), dateIso: '2026-09-23T17:00:00+05:30', ageDays: null };
  test('classified as a contract; contract term read in words', () => {
    assert.equal(classifyAnnouncement({ ...ann, ageDays: 1 }, 'IN').category, 'order_win');
    assert.equal(contractTermYears(ann.summary), 5);
    assert.equal(contractTermYears('The company has been in business for 5 years.'), null, 'a company age is not a contract term');
    assert.equal(contractTermYears('entered into an agreement for a period of 3 years'), 3);
  });
  test('Contractual duration 5 years · revenue visibility not yet quantified · persistence evidence Medium · one contract · next evidence order value / recurring revenue / renewal / execution', () => {
    const f = find('RNIT', [ann], null);
    const it = item(view({ RNIT: f }), 'RNIT');
    assert.equal(it.eventType, 'Contract');
    const d = it.durations!;
    assert.equal(d.contractual, 'Contract runway: 5 years (as stated). Economic contribution still unquantified.');
    assert.equal(d.revenueVisibility, 'Revenue visibility not yet quantified');
    assert.equal(d.evidence.word, 'Medium');
    assert.equal(it.persistenceEvidence!.level, 'EVIDENCE');
    assert.match(d.currentEvidence || '', /^One contract/);
    assert.deepEqual(d.nextEvidence, ['order value', 'recurring revenue', 'renewal', 'execution']);
    assert.equal(it.potentialDuration!.basis, 'FACTS');
    assert.equal(it.persistence, 'YEARS');
    // never phrased as proven revenue
    assert.ok(!/revenue of|proven|will earn|guaranteed/i.test(d.contractual!));
    assert.ok(it.researchNext.some((q) => /recurring across the stated term/.test(q)));
    assert.match(it.whyResearch, /runway, not proven revenue/);
    for (const s of [it.whyResearch, d.contractual!, d.evidence.text]) assert.ok(!NO_TRADE.test(s));
  });
  test('the persistent-catalyst candidate stays separate from the event score (Research Priority unchanged by it)', () => {
    const f = find('RNIT', [ann], null);
    const pcs = detectPersistentCatalysts({ ticker: 'RNIT', finding: f, origin: 'gainers', today: '2026-09-24' });
    const pc = pcs.find((p) => p.kind === 'ORDER_VISIBILITY');
    assert.ok(!pc || !pc.specialFocus, 'one contract is never Special Focus');
    const a = item(view({ RNIT: f }), 'RNIT');
    const b = item(view({ RNIT: { ...f, persistence: pc ? summarizePersistence(pc, false) : null } as Finding }), 'RNIT');
    assert.equal(a.priority, b.priority, 'the persistence layer never changes the research priority');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · RAYMOND — potential and evidence derived from the facts, consistently
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · RAYMOND — multi-year programme potential, Medium evidence, no contradiction', () => {
  const NEW = B('583c6b13-f125-445c-abec-f5dc23e7105f'), OLD = B('6ccfd83b-184a-4a5a-9be3-2e6eddaf4f11');
  const cur: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond subsidiary wins tender for wing and fuselage structures in fighter aircraft programme.', url: NEW, dateIso: '2026-09-23T17:00:00+05:30', ageDays: null }];
  const rel: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond aerospace subsidiary wins multi-programme orders worth about ₹33 crore annually; production starts in 2026-27.', url: OLD, dateIso: '2026-09-11T17:50:13+05:30', ageDays: null }];
  const build = async () => {
    const docs = await docsFrom('RAYMOND', { [NEW]: 'raymond-2026-09-23.txt' }, cur);
    const hist = await docsFrom('RAYMOND', { [OLD]: 'raymond-2026-09-11.txt' }, rel, 'history');
    return find('RAYMOND', cur, [...docs, ...hist], { marketCap: 12000 });
  };
  test('potential = multi-year programme (from the facts); evidence = Medium (one evidence period), never "A QUARTER" + "STRONG"', async () => {
    const it = item(view({ RAYMOND: await build() }), 'RAYMOND');
    assert.equal(it.persistence, 'YEARS');
    assert.equal(it.potentialDuration!.basis, 'FACTS');
    assert.match(it.potentialDuration!.text, /Multi-year programme/);
    assert.equal(it.persistenceEvidence!.level, 'EVIDENCE');
    assert.equal(it.durations!.evidence.word, 'Medium');
    const pair: [string, string] = [it.persistence, it.persistenceEvidence!.level];
    assert.ok(!(pair[0] === 'QUARTER' && pair[1] === 'STRONG'), 'never "a quarter" beside "strong"');
    assert.match(it.durations!.catalystState || '', /^Identified → validating/);
    const miss = it.durations!.missing.join(' | ');
    for (const m of [/disclosed annual value/, /programme duration/, /production-rate linkage/]) assert.match(miss, m);
    assert.match(it.durations!.revenueVisibility || '', /POTENTIAL, not a firm value/);
    const card = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {} })));
    assert.ok(card.includes('POTENTIAL ECONOMIC DURATION') && card.includes('MULTI-YEAR') && card.includes('PERSISTENCE EVIDENCE') && card.includes('MEDIUM'), card);
    assert.ok(!card.includes('A QUARTER'));
  });
  test('Strong only with ≥2 independent official evidence periods', () => {
    const hay = 'multi-programme orders worth about ₹33 crore annually';
    assert.equal(persistenceEvidenceOf('Order win', 'CONFIRMED_LOW_MATERIALITY', 'AWARDED', 'order_recurring', hay, null, { officialPeriods: 1 }).level, 'EVIDENCE');
    assert.equal(persistenceEvidenceOf('Order win', 'CONFIRMED_LOW_MATERIALITY', 'AWARDED', 'order_recurring', hay, null, { officialPeriods: 2 }).level, 'STRONG');
    // A ledger mechanism marked HIGH but filed in one period is Medium, not Strong.
    assert.equal(persistenceEvidenceOf('Order win', 'CONFIRMED_MATERIAL', 'AWARDED', 'order', 'order', { confidence: 'HIGH', specialFocus: true, label: 'Order book', periods: 1 }).level, 'EVIDENCE');
  });
  test('consistency guard: a potential can never be shorter than the evidence / contract term claims — and says why when raised', () => {
    const g = guardPotential({ value: 'QUARTER', text: 'About a quarter / one execution period (by type of event only)', basis: 'TYPE' }, { level: 'STRONG', text: 'two periods' }, null);
    assert.equal(g.pot.value, 'YEARS'); assert.match(g.note || '', /raised .* to multi-year/);
    const h = guardPotential({ value: 'QUARTER', text: 'x', basis: 'TYPE' }, { level: 'EVIDENCE', text: 'one contract' }, 5);
    assert.equal(h.pot.value, 'YEARS'); assert.match(h.note || '', /contract term \(5 years\)/);
    const k = guardPotential({ value: 'YEARS', text: 'x', basis: 'FACTS' }, { level: 'STRONG', text: 'x' }, null);
    assert.equal(k.note, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · ABDL — a licence to manufacture is capability, not demand
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · ABDL — ~4.4 million BL licence: capacity potential multi-year, demand absent, commercial persistence unproven', () => {
  const URL = B('abd10000-1111-2222-3333-444455556666');
  const anns: AnnouncementLite[] = [{ subject: 'Disclosure under Regulation 30 - Grant of Licence for Manufacture of Malt Spirits for Potable Purpose', summary: 'ABDL received licence from Telangana excise to manufacture ~4.4 million BL of malt spirits per annum at Rangapur.', url: URL, dateIso: '2026-09-15T12:00:00+05:30', ageDays: null }];
  test('the card says capability, not demand', async () => {
    const f = find('ABDL', anns, await docsFrom('ABDL', { [URL]: 'abdl-licence.txt' }, anns), { marketCap: 9000 });
    assert.equal(f.status, 'catalyst');
    const it = item(view({ ABDL: f }), 'ABDL');
    assert.equal(it.eventType, 'Regulatory approval');
    assert.equal(it.durations!.capacity!.text, 'Capacity potential: multi-year · Demand evidence: absent · Commercial persistence: unproven');
    assert.equal(it.persistenceEvidence!.level, 'UNPROVEN');
    assert.match(it.persistenceEvidence!.text, /not demand/);
    assert.equal(it.persistence, 'YEARS');
    assert.match(it.whyResearch, /capability, not demand/);
    assert.ok(it.researchNext.some((q) => /^Demand: orders, offtake/.test(q)));
    assert.ok(it.durations!.missing.some((m) => /demand evidence/.test(m)));
  });
  test('generic rule: capacity / commissioning / licence with demand evidence is supported; without it, unproven', () => {
    assert.equal(persistenceEvidenceOf('Capacity expansion', 'CONFIRMED_MATERIAL', 'OPERATIONAL', 'capacity', 'plant commissioned at 3 MN BL per year', null).level, 'UNPROVEN');
    assert.equal(persistenceEvidenceOf('Capacity expansion', 'CONFIRMED_MATERIAL', 'OPERATIONAL', 'capacity', 'plant commissioned; offtake agreement signed with the customer', null).level, 'EVIDENCE');
    assert.equal(persistenceEvidenceOf('Regulatory approval', 'CONFIRMED_MATERIAL', 'EXECUTED', 'licence_capacity', 'licence to manufacture 4.4 million BL per annum; received an order from the Commissioner', null).level, 'UNPROVEN', 'an order FROM the regulator is not demand');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Event taxonomy — ownership events are not all "Acquisition"
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · taxonomy — strategic expansion (ZIMLAB), strategic investment (BETA), promoter buying (GNA), merger, capital allocation', () => {
  test('ZIMLAB Chile subsidiary → Strategic expansion (summary alone and document read)', async () => {
    const url = B('031cc190-d325-4294-8481-5b829da70d34');
    const anns: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Updates on Acquisition', summary: 'ZIM Laboratories SpA incorporated in Chile on 9 September 2026 as a wholly owned subsidiary for LATAM expansion.', url, dateIso: '2026-09-18T16:00:00+05:30', ageDays: null }];
    assert.equal(find('ZIMLAB', anns, null).category, 'new_geography');
    const f = find('ZIMLAB', anns, await docsFrom('ZIMLAB', { [url]: 'zimlab-chile.txt' }, anns));
    assert.equal((f.structuredFacts || [])[0].event.kind, 'strategic_expansion');
    const it = item(view({ ZIMLAB: f }), 'ZIMLAB');
    assert.equal(it.eventType, 'Strategic expansion');
    assert.notEqual(it.eventType, 'Acquisition');
    assert.ok(it.researchNext.some((q) => /new entity \/ geography sell/.test(q)));
    assert.equal(it.persistenceEvidence!.level, 'UNPROVEN');
    assert.equal(extractIndiaFacts({ text: txt('zimlab-chile.txt'), issuer: 'ZIMLAB', date: '2026-09-18', url, title: 'z' }).facts[0].event.kind, 'strategic_expansion');
  });
  test('BETA — Amazon 5.3% stake → Strategic investment: capital-allocation research, not a portfolio action', () => {
    const f = mk({ ticker: 'BETA', market: 'US', status: 'none', marketCap: 5000,
      structuredFacts: [fact('stake_by_strategic', { kind: 'SEC_FILING', issuer: 'BETA', title: 'SCHEDULE 13G — Amazon.com, Inc. 5.3%', url: 'https://www.sec.gov/beta-13g', date: '2026-09-22' }, { counterparty: 'Amazon.com, Inc.' })] } as any);
    const v = buildResearchView({ market: 'US', findings: { BETA: f }, board: [{ ticker: 'BETA', company: 'BETA Technologies', move_pct: 12, market_cap: 5000 }], filedResults: [], holdings: ['BETA'], now: NOW_ISO });
    const it = item(v as any, 'BETA');
    assert.equal(it.eventType, 'Strategic investment');
    assert.equal(it.eventClass, 'POTENTIAL_UNVERIFIED');
    assert.notEqual(it.action, 'Thesis evidence');
    assert.match(it.portfolio.note || '', /Capital-allocation research, not a portfolio action — the thesis status is unchanged/);
    assert.match(it.whyResearch, /capital-allocation research, not a portfolio action/);
    assert.equal(it.persistenceEvidence!.level, 'UNPROVEN');
  });
  test('GNA — promoter acquires 1.16% → Promoter buying (insider buying), even under a SAST subject', () => {
    const ann: AnnouncementLite = { subject: 'Disclosure under Regulation 29(1) of SEBI (SAST) Regulations, 2011', summary: 'Promoter GNA Holdings acquired 1.16% stake in GNA Axles through open market purchase.', url: B('9aa00000-1111-2222-3333-444455556666'), dateIso: '2026-09-22T16:00:00+05:30', ageDays: null };
    const c = classifyAnnouncement({ ...ann, ageDays: 1 }, 'IN');
    assert.equal(c.kind, 'catalyst'); assert.equal(c.category, 'promoter_purchase');
    const it = item(view({ GNA: find('GNA', [ann], null) }), 'GNA');
    assert.equal(it.eventType, 'Promoter buying');
    assert.equal(it.eventLabel, 'Promoter stake purchase (insider buying)');
    assert.equal(it.persistenceEvidence!.level, 'NOT_PERSISTENT');
    assert.equal(it.persistenceTest!.grade, 'TEMPORARY');
    assert.ok(it.researchNext.some((q) => /Promoter holding before and after/.test(q)));
    const doc = 'To BSE Limited. Sub: Disclosure under Regulation 29(1). '.repeat(3) + 'We wish to inform you that the promoter of the Company, GNA Holdings Private Limited, has acquired 5,00,000 equity shares representing 1.16% of the paid-up share capital of the Company through open market purchase on September 20, 2026.';
    const x = extractIndiaFacts({ text: doc, issuer: 'GNA', date: '2026-09-22', url: 'u', title: 't' }).facts[0];
    assert.equal(x.event.kind, 'promoter_buying'); assert.equal(x.economics.stakePct, 1.16);
    // a buyback the promoter does NOT join is not promoter buying
    assert.notEqual(classifyAnnouncement({ subject: 'Buyback', summary: 'Promoters will not participate in the buyback of 10 lakh shares', url: 'b', dateIso: '2026-09-22T10:00:00+05:30', ageDays: 1 }, 'IN').category, 'promoter_purchase');
  });
  test('merger is not an acquisition; a buyback is capital allocation', () => {
    const doc = 'Sub: Outcome of Board Meeting. '.repeat(4) + 'The Board approved the Scheme of Amalgamation of Alpha Components Private Limited with the Company under sections 230 to 232 of the Companies Act, subject to NCLT approval.';
    assert.equal(extractIndiaFacts({ text: doc, issuer: 'MRG', date: '2026-09-22', url: 'u', title: 't' }).facts[0].event.kind, 'merger');
    const m = item(view({ MRG: mk({ ticker: 'MRG', status: 'catalyst', category: 'acquisition', stage: 'executed', sourceTier: 'primary', headline: 'Board approves merger of Alpha Components with the Company', sourceUrl: 'm', sourceDate: '2026-09-23', ageDays: 1 }) }), 'MRG');
    assert.equal(m.eventType, 'Merger');
    const bb = item(view({ BB: mk({ ticker: 'BB', status: 'catalyst', category: 'buyback', stage: 'executed', sourceTier: 'primary', headline: 'Board approves buyback of shares via tender offer', sourceUrl: 'b', sourceDate: '2026-09-23', ageDays: 1 }) }), 'BB');
    assert.equal(bb.eventType, 'Capital allocation');
    assert.ok(bb.researchNext.some((q) => /free cash flow or from borrowing/.test(q)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · MILKYMIST — commissioning alone never creates Special Focus
// ═══════════════════════════════════════════════════════════════════════════
let n = 0;
const lf = (period: string, metric: string, after: string, o: Partial<{ before: string; stmt: string; date: string; quote: string }> = {}) => ({
  id: `m${n++}`, ticker: 'MILKYMIST', reporting_period: period, evidence_type: 'mechanism', metric_name: metric, metric_label: metric, value: after, before_value: o.before ?? null, after_value: after,
  unit: null, delta: null, direction: 'up', source_document_id: null, source_name: `Concall ${period}`, source_date: o.date || '2026-08-01', source_type: 'transcript', source_quote: o.quote || `we ${metric} ${after}`,
  fact_or_management_statement: o.stmt || 'FACT', confidence: 'HIGH', evidence_quality: 'sentence', extracted_at: '', updated_at: '', record_status: 'ACTIVE',
});
const ledger = (periods: Record<string, any[]>) => ({ latest_period: Object.keys(periods).pop(), latest_document_date: '2026-08-01', periods: Object.fromEntries(Object.entries(periods).map(([p, facts]) => [p, { reporting_period: p, facts, summary: null }])) });
const capOf = (l: any) => detectPersistentCatalysts({ ticker: 'MILKYMIST', ledger: l, origin: 'portfolio', today: '2026-09-24' }).find((p) => p.kind === 'CAPACITY_RAMP')!;

describe('zzz787 · MILKYMIST — Special Focus stricter than a persistent catalyst candidate', () => {
  const commissioned = [
    lf('Q1 FY27', 'capacity', '192 MT per day', { before: '72 MT per day', quote: 'CAPACITY EXPANSION COMMISSIONED & PUT TO USE: capacity increased from 72 MT per day to 192 MT per day' }),
    lf('Q1 FY27', 'capex_status', 'new plant commissioned and put to use', { quote: 'the new plant was commissioned and put to use in the quarter' }),
  ];
  test('commissioned plant alone → persistent catalyst candidate, NOT Special Focus (changed in zzz787)', () => {
    const pc = capOf(ledger({ 'Q1 FY27': commissioned }));
    // zzz788 (intentional change): no continuation evidence → EARLY, said as "Persistence: candidate".
    assert.equal(pc.confidence, 'EARLY', 'a candidate: headroom is not runway');
    assert.equal(pc.specialFocus, false);
    assert.equal(pc.sfBasis, null);
    assert.ok(pc.why.some((w) => /persistent catalyst candidate, not Special Focus yet/.test(w)), pc.why.join(' | '));
    assert.ok(pc.toQualify.some((q) => /demand evidence \(orders \/ offtake\) or a utilisation \/ revenue figure/.test(q)));
  });
  test('commissioned + utilisation → Special Focus; commissioned + demand → Special Focus; two evidence periods → Special Focus', () => {
    // zzz788 (intentional change): commissioned + current utilisation is
    // headroom, not runway — it needs continuation (volume growing, a growing
    // order book, repeat orders, contracted demand) to be Special Focus.
    const util0 = capOf(ledger({ 'Q1 FY27': [...commissioned, lf('Q1 FY27', 'utilisation', '58%', { quote: 'capacity utilisation on the new plant was 58%' })] }));
    assert.equal(util0.specialFocus, false, util0.why.join(' | '));
    const util = capOf(ledger({ 'Q1 FY27': [...commissioned, lf('Q1 FY27', 'utilisation', '58%', { quote: 'capacity utilisation on the new plant was 58%' }), lf('Q1 FY27', 'volume', 'volume grew 30% YoY')] }));
    assert.ok(util.specialFocus, util.why.join(' | ')); assert.match(util.sfBasis || '', /utilisation/);
    const demand = capOf(ledger({ 'Q1 FY27': [...commissioned, lf('Q1 FY27', 'order_book', 'INR 400 crores', { before: 'INR 300 crores', quote: 'order book grew from INR 300 crores to INR 400 crores for the new capacity' })] }));
    assert.ok(demand.specialFocus, demand.why.join(' | ')); assert.match(demand.sfBasis || '', /demand/);
    const two = capOf(ledger({
      'Q4 FY26': [lf('Q4 FY26', 'capacity', '120 MT per day', { before: '72 MT per day', date: '2026-05-01', quote: 'capacity increased from 72 MT per day to 120 MT per day, commissioned' })],
      'Q1 FY27': [...commissioned, lf('Q1 FY27', 'volume', 'volume grew 30% YoY')],
    }));
    assert.ok(two.specialFocus, two.why.join(' | ')); assert.match(two.sfBasis || '', /independent periods/); assert.equal(two.evidencePeriods, 2);
  });
  test('the Daily Gainers path: a commissioned-plant filing is never Special Focus on its own', () => {
    const f = { ticker: 'MILKYMIST', status: 'catalyst', category: 'production_ramp', stage: 'executed', headline: 'Milky Mist commissions new plant, capacity 72 → 192 MT per day', sourceDate: '2026-09-22', sourceUrl: 'x', modelRead: true, facts: { capacity: '192 MT per day' } };
    const list = detectPersistentCatalysts({ ticker: 'MILKYMIST', finding: f, origin: 'gainers', today: '2026-09-24' });
    assert.ok(list.every((p) => !p.specialFocus));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · MAXESTATES — the milestone chain still renders
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · MAXESTATES — MoU/JDA milestone chain regression', () => {
  test('the card shows the full chain and "Nothing booked yet — an enabling step."', () => {
    const f = mk({ ticker: 'MAXESTATES', status: 'catalyst', category: 'joint_venture', stage: 'enabling', sourceTier: 'primary', marketCap: 9000,
      headline: 'Max Estates signs binding MoU for Ghaziabad JDA; 9.76-acre project may unlock INR 2,500-3,000 crore GDV.', sourceUrl: 'https://x/max', sourceDate: '2026-09-23', ageDays: 1 });
    const tp = trackPotentialFromFinding(f)!;
    assert.ok(tp && !tp.specialFocus);
    const it = item(view({ MAXESTATES: { ...f, persistence: summarizePersistence(tp, false) } as Finding }), 'MAXESTATES');
    const html = strip(renderToStaticMarkup(React.createElement(PersistenceSection, { it })));
    assert.ok(html.includes('Tracked potential catalyst — enabling step'), html);
    assert.ok(html.includes('✓ MoU / JDA signed → Definitive agreement executed → Approvals received → Execution / construction start → Project launch → Bookings (pre-sales) → Collections → Revenue recognised → Profit'), html);
    assert.ok(html.includes('Nothing booked yet — an enabling step.'), html);
    assert.ok(html.includes('Next milestone: Definitive agreement executed'), html);
    assert.equal(it.persistenceEvidence!.level, 'UNPROVEN');
    assert.ok(it.researchNext.some((q) => /MoU \/ JDA → definitive agreement → approvals → execution → launch → bookings → collections → revenue → profit/.test(q)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · one catalyst across Daily Gainers → Portfolio Catalysts → Special Focus
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · dedup — one underlying catalyst id, cross-links not duplicates, three views never merged', () => {
  const f = mk({ ticker: 'ORD', status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', modelRead: true, marketCap: 3000,
    headline: 'Order from NHAI ₹900 Cr over 36 months', evidenceQuote: 'order of ₹900 crore to be executed over 36 months', sourceUrl: 'https://x/ord', sourceDate: '2026-09-23', ageDays: 1, valueStated: 900,
    facts: { counterparty: 'NHAI', execution_period: '36 months' } });
  test('the gainer card, the persistent mechanism and memory share ids', () => {
    const pcs = detectPersistentCatalysts({ ticker: 'ORD', finding: f, origin: 'gainers', today: '2026-09-24' });
    const pc = pcs.find((p) => p.kind === 'ORDER_VISIBILITY')!;
    assert.ok(pc);
    assert.equal(pc.id, persistentIdOfEvent('ORD', 'order'));
    const it = item(view({ ORD: { ...f, persistence: summarizePersistence(pc, false) } as Finding }), 'ORD');
    const eventId = it.catalysts![0].id;
    assert.equal(eventId, 'ORD:order:nhai');
    assert.deepEqual(pc.eventIds, [eventId], 'the mechanism remembers the SAME event id');
    assert.equal(it.links!.catalystId, eventId); assert.equal(it.links!.persistentId, pc.id);
    assert.equal(it.links!.specialFocus, null, 'not Special Focus → no Special Focus link');
    // the stated 36-month execution period is the contractual duration and a FACTS-based potential
    assert.match(it.durations!.contractual || '', /^Execution period: 36 months/);
    assert.equal(it.potentialDuration!.basis, 'FACTS'); assert.equal(it.persistence, 'YEARS');
    // portfolio + gainers detections of the same mechanism are ONE record, the event id kept.
    const blob: PersistBlob = { version: 1, seq: 0, records: {} };
    const portfolioPc: PersistentCatalyst = { ...pc, origins: ['portfolio'], eventIds: [], hardCount: 5 };
    mergeDetections(blob, [{ ...pc, confidence: 'MEDIUM' }], 'gainers', '2026-09-23T00:00:00Z');
    mergeDetections(blob, [{ ...portfolioPc, confidence: 'MEDIUM' }], 'portfolio', '2026-09-24T00:00:00Z');
    assert.deepEqual(Object.keys(blob.records), [pc.id]);
    assert.deepEqual(blob.records[pc.id].origins.sort(), ['gainers', 'portfolio']);
    assert.deepEqual(blob.records[pc.id].latest.eventIds, [eventId]);
  });
  test('Special Focus queue: one entry per mechanism; a tracked enabling step of a company already in the queue is a link, not a second item', () => {
    const base = detectPersistentCatalysts({ ticker: 'SFX', ledger: ledger({
      'Q4 FY26': [lf('Q4 FY26', 'order_book', 'INR 3,000 crores', { before: 'INR 2,000 crores', date: '2026-02-01' }), lf('Q4 FY26', 'order_intake', 'INR 900 crores', { date: '2026-02-01' })],
      'Q1 FY27': [lf('Q1 FY27', 'order_book', 'INR 4,500 crores', { date: '2026-08-01' }), lf('Q1 FY27', 'order_intake', 'INR 1,400 crores', { date: '2026-08-01' })],
    }), origin: 'portfolio', today: '2026-09-24', quarterRevenueCr: 425 }).find((p) => p.kind === 'ORDER_VISIBILITY')!;
    assert.ok(base.specialFocus, base.why.join(' | '));
    const tracked = trackPotentialFromFinding({ status: 'catalyst', stage: 'enabling', ticker: 'SFX', headline: 'SFX signs MoU with a state utility', sourceDate: '2026-09-20' })!;
    const trackedOther = trackPotentialFromFinding({ status: 'catalyst', stage: 'enabling', ticker: 'OTHER', headline: 'OTHER signs MoU for a JDA', sourceDate: '2026-09-20' })!;
    const live = new Map([[base.id, { pc: base, row: { symbol: 'SFX' } }]]);
    const stored: any = {
      [base.id]: { id: base.id, latest: { ...base, eventIds: ['SFX:order:state-utility'] }, user: null, focus: { inQueue: true, decayed: false, note: null } },
      [tracked.id]: { id: tracked.id, latest: tracked, user: null, focus: { inQueue: false, decayed: false, note: null } },
      [trackedOther.id]: { id: trackedOther.id, latest: trackedOther, user: null, focus: { inQueue: false, decayed: false, note: null } },
    };
    const q = specialFocusQueue(live, stored, () => null);
    assert.equal(q.entries.length, 1, 'live + stored of the same id = one card');
    assert.equal(q.entries[0].linkedTracked.length, 1);
    assert.deepEqual(q.entries[0].eventIds, ['SFX:order:state-utility']);
    assert.deepEqual(q.tracked.map((t) => t.latest.ticker), ['OTHER'], 'SFX is not listed again under tracked potential');
  });
  test('the three views stay separate: priority, persistence and Special Focus are never one score', () => {
    const it = item(view({ ORD: f }), 'ORD');
    assert.ok(typeof it.priority === 'number');
    assert.ok(!('specialFocus' in (it.scoreDetails || {})), 'Special Focus is not a component of Research Priority');
    assert.ok(!Object.keys(it.scoreDetails || {}).some((k) => /persistentCatalyst|special/i.test(k)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · thesis status never changes because of persistent catalysts
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · Portfolio Catalysts thesis status is independent of the persistence layer', () => {
  const benchRows: any[] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'bench-rows.json'), 'utf8'));
  const assess = (g: any) => assessThesis({ pattern: classifyGradedRow(g)?.pattern ?? null, variables: extractVariables(g, null), promiseGap: null, evidenceReviewed: true });
  test('the same inputs give the same status whether or not persistent catalysts / Special Focus exist for the name', () => {
    for (const g of benchRows.slice(0, 12)) {
      const before = assess(g);
      // Build and remember persistent catalysts (incl. Special Focus) for the same ticker.
      const l = ledger({
        'Q4 FY26': [lf('Q4 FY26', 'order_book', 'INR 3,000 crores', { before: 'INR 2,000 crores', date: '2026-02-01' })],
        'Q1 FY27': [lf('Q1 FY27', 'order_book', 'INR 4,500 crores', { date: '2026-08-01' }), lf('Q1 FY27', 'order_intake', 'INR 1,400 crores', { date: '2026-08-01' })],
      });
      const pcs = detectPersistentCatalysts({ ticker: g.ticker, ledger: l, origin: 'portfolio', today: '2026-09-24', quarterRevenueCr: 425, assessment: before });
      const blob: PersistBlob = { version: 1, seq: 0, records: {} };
      mergeDetections(blob, pcs, 'portfolio');
      const after = assess(g);
      assert.equal(after.status, before.status, `${g.ticker}: thesis status changed`);
      assert.equal(after.because, before.because, `${g.ticker}: reason changed`);
      assert.deepEqual(after.coverage, before.coverage);
    }
  });
  test('the thesis modules do not read the persistence layer at all', () => {
    for (const f of ['../thesis/status.ts', '../thesis/use-book.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      assert.ok(!/catalyst\/persistence|persistence-store|cross-view|specialFocus/.test(src), `${f} must not depend on persistent catalysts`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// kept behaviour — PRTH potential vs evidence, price separation
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz787 · kept: PRTH multi-year potential with early evidence; price is context only', () => {
  const prth = mk({ ticker: 'PRTH', market: 'US', status: 'catalyst', category: 'acquisition', stage: 'executed', sourceTier: 'primary', docExtract: true, marketCap: 643,
    headline: 'Business combination agreement signed — take-private at $9.50 per share', evidenceQuote: 'The transaction is valued at approximately $1.3 billion, including net debt.', sourceUrl: 'https://www.sec.gov/prth', sourceDate: '2026-09-22', ageDays: 2, valueStated: 1300 } as any);
  const us = (f: Finding, move: number) => buildResearchView({ market: 'US', findings: { PRTH: { ...f, movePct: move } as Finding }, board: [{ ticker: 'PRTH', company: 'Priority Technology', move_pct: move, market_cap: 643 }], filedResults: [], holdings: [], now: NOW_ISO });
  test('PRTH: potential multi-year (labelled, not evidence); evidence early; the stated value is document-verified', () => {
    const it = item(us(prth, 31) as any, 'PRTH');
    assert.equal(it.persistence, 'YEARS');
    assert.match(it.durations!.potential.note, /NOT evidence/);
    assert.equal(it.persistenceEvidence!.level, 'EARLY');
    assert.equal(it.materiality.verification, 'DOCUMENT_VERIFIED');
  });
  test('the size of the move never changes priority, persistence or Special Focus', () => {
    const a = item(us(prth, 31) as any, 'PRTH'), b = item(us(prth, 2) as any, 'PRTH');
    assert.equal(a.persistenceEvidence!.level, b.persistenceEvidence!.level);
    assert.equal(a.persistence, b.persistence);
    assert.deepEqual(a.durations, b.durations);
    assert.equal(a.scoreDetails!.materiality, b.scoreDetails!.materiality);
  });
});
