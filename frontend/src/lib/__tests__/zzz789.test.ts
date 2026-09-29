// zzz789 — final hardening / QA of AI Daily Gainers. Four concepts stay
// independent everywhere: Event stage / duration → Economic persistence →
// Evidence strength → Research priority. Event type alone never implies
// persistence or duration.
//
// Fixture names are the owner's QA list: CDNA, KOS, FRVO, CRML, RNIT, VIKRAN,
// RAYMOND, MILKYMIST, ABDL, ZIMLAB, MAXESTATES, GNA, PRIORITY, ARVIND. Texts
// are the real BSE attachment text layers in fixtures/zzz785 where one exists;
// otherwise short, realistic snippets written for these tests (the US filers'
// counterparties are fictional).
// Run: npx tsx --test src/lib/__tests__/zzz789.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildFinding, classifyAnnouncement, taxFavourable, type AnnouncementLite, type Finding } from '../ai-gainers/catalyst-research';
import { extractIndiaFacts, readIndiaDocuments } from '../ai-gainers/india-extract';
import { extractUsFacts, describeUsFact } from '../ai-gainers/us-extract';
import { emptyEconomics, emptyTime, favourableLegalOutcome, debtActionOf, type EventKind, type SourceRef, type StructuredFacts } from '../ai-gainers/structured-facts';
import { buildResearchView, persistenceEvidenceOf, potentialDurationOf, valueLabelOf, type ResearchItem, type ResearchViewInput } from '../ai-gainers/research-view';
import { persistenceTestOf } from '../ai-gainers/persistence-test';
import { buildCatalystRecords } from '../ai-gainers/catalyst-timeline';
import { buildNewsContext, entityMatch, newsQueryFor, pressFacts, themesOf } from '../ai-gainers/news-context';
import { ResearchCard } from '../../components/ai-gainers/ResearchCard';
import { ResearchTriage } from '../../components/ai-gainers/ResearchTriage';
import { FactLine } from '../../components/ai-gainers/Badges';

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
const usView = (findings: Record<string, Finding>, extra: Partial<ResearchViewInput> = {}) => view(findings, { market: 'US', ...extra });
const all = (v: ReturnType<typeof view>): ResearchItem[] => {
  const m = new Map<string, ResearchItem>();
  for (const i of [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || []), ...(v.needsReading || [])]) m.set(i.ticker, i);
  return Array.from(m.values());
};
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
function fact(kind: EventKind, s: Partial<SourceRef> & { title: string }, o: { counterparty?: string | null; value?: number | null; stage?: any; unknowns?: string[]; quotes?: string[]; targetRevenue?: number | null } = {}): StructuredFacts {
  return {
    source: { kind: 'EXCHANGE_FILING', access: 'DOCUMENT_READ', issuer: 'X', date: '2026-09-23', url: null, ...s },
    event: { kind, counterparty: o.counterparty ?? null, product: null, geography: null, stage: o.stage ?? null },
    economics: { ...emptyEconomics(), valueNative: o.value ?? null, currency: o.value != null ? 'INR_CR' : null, targetRevenueNative: o.targetRevenue ?? null },
    time: emptyTime(), quotes: o.quotes || [], unknowns: o.unknowns || [], verificationRequired: s.kind === 'PRESS',
  };
}
const card = (it: ResearchItem, rank = 1, section?: string) => strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank, onOpen: () => {}, section })));
const factLine = (it: ResearchItem) => strip(renderToStaticMarkup(React.createElement(FactLine, { it })));
/** A trade instruction — never generated. ("what will the entity sell" is not a trade.) */
const TRADE = /\b(BUY|SELL|EXIT|STOP)\b|\b(buy|sell) (rating|signal|now|the stock|the shares)\b|\bstop[- ]loss\b|\btarget price\b/;
const generated = (i: ResearchItem) => [i.whyResearch, i.whyRank || '', i.impact || '', i.whatChanged || '', ...i.researchNext, ...i.unknowns, i.persistenceTest?.why || '', i.potentialDuration?.text || '', i.persistenceEvidence?.text || ''].join(' | ');

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CDNA / CRML — an acquisition is not "years" by type
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 1 CDNA / CRML — acquisition duration only from stated transaction / business economics', () => {
  const cdna = mk({ ticker: 'CDNA', market: 'US', company: 'CareDx, Inc.', status: 'catalyst', category: 'acquisition', stage: 'executed', sourceTier: 'primary', docExtract: true, marketCap: 1100,
    headline: 'CareDx to acquire Sequencing Biosciences for $62 million in cash', evidenceQuote: 'CareDx, Inc. entered into a definitive agreement to acquire Sequencing Biosciences, Inc. for $62 million in cash.',
    sourceUrl: 'https://www.sec.gov/cdna-8k', sourceDate: '2026-09-22', ageDays: 2, valueStated: 62 } as any);
  const crml = mk({ ticker: 'CRML', market: 'US', company: 'Critical Metals Corp.', status: 'catalyst', category: 'acquisition', stage: 'executed', sourceTier: 'primary', docExtract: true, marketCap: 900,
    headline: 'Critical Metals completes acquisition of a further 42% of Tanbreez Mining Greenland', evidenceQuote: 'The Company completed the acquisition of an additional 42% interest in Tanbreez Mining Greenland A/S for total consideration of $116 million.',
    sourceUrl: 'https://www.sec.gov/crml-8k', sourceDate: '2026-09-22', ageDays: 2, valueStated: 116 } as any);
  for (const [name, f] of [['CDNA', cdna], ['CRML', crml]] as const) {
    test(`${name}: potential duration "Not established" (was YEARS by type); FactLine says NOT ESTABLISHED, never MULTI-YEAR`, () => {
      const it = item(usView({ [name]: f }), name);
      assert.equal(it.eventType, 'Acquisition');
      assert.equal(it.persistence, 'UNKNOWN');
      assert.equal(it.potentialDuration!.basis, 'NONE');
      assert.match(it.potentialDuration!.text, /^Not established — the documents state no target revenue \/ profit/);
      const fl = factLine(it);
      assert.ok(fl.includes('POTENTIAL ECONOMIC DURATION NOT ESTABLISHED'), fl);
      assert.ok(!/MULTI-YEAR|YEARS/.test(fl), fl);
      // the figure is the consideration, never an "order value"
      assert.match(it.whatChanged || '', /^Purchase consideration \$\d+M ÷ \$[\d,.]+[MB]? market cap = [\d.]+% \(document-verified\)$/);
      assert.ok(!/order value/i.test(JSON.stringify(it)));
      // Research next: Purchase price → target revenue / EBITDA → funding → contribution → integration
      assert.deepEqual(it.researchNext.map((q) => q.split(':')[0]), ['1. Purchase price / swap ratio', '2. Target revenue / EBITDA', '3. Funding', '4. Contribution', '5. Integration']);
      assert.match(it.researchNext[0], /^1\. Purchase price \/ swap ratio: ✓ \$\d+M/);
      assert.match(it.whyResearch, /target's economics/);
      assert.ok(!/size is not disclosed/.test(it.whyResearch));
      assert.ok(!/multi-period runway/.test(it.whyRank || ''));
    });
  }
  test('with the target\'s revenue stated in the document, the duration comes from the FACTS', () => {
    const f = { ...cdna, evidenceQuote: `${cdna.evidenceQuote} Sequencing Biosciences generated revenue of $18 million in 2025.` } as Finding;
    const it = item(usView({ CDNA: f }), 'CDNA');
    assert.equal(it.persistence, 'YEARS');
    assert.equal(it.potentialDuration!.basis, 'FACTS');
    assert.match(it.researchNext[1], /^2\. Target revenue \/ EBITDA: ✓ revenue of \$18 million/);
    // potential is not evidence: one deal on file stays Early / unproven
    assert.notEqual(it.persistenceTest!.grade, 'HIGH');
  });
  test('the pure rule: acquisition without target economics → Not established; type alone never sets YEARS', () => {
    const p = potentialDurationOf('Acquisition', 'CONFIRMED_MATERIAL', 'completed the acquisition of X for ₹150 crore');
    assert.equal(p.value, 'UNKNOWN'); assert.equal(p.basis, 'NONE');
    for (const t of ['Capacity expansion', 'New product', 'Regulatory approval', 'Order win', 'Strategic expansion', 'Buyback'] as const)
      assert.notEqual(potentialDurationOf(t, 'CONFIRMED_MATERIAL', 'event on file').basis, 'TYPE', t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 + 7 · KOS — $25M notes redeemed: the fact is WHAT CHANGED; impact separate; not TEMPORARY
// ═══════════════════════════════════════════════════════════════════════════
const KOS_8K = 'UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 8-K CURRENT REPORT Item 8.01 Other Events. '
  + 'On September 22, 2026, Kosmos Energy Ltd. (the “Company”) redeemed $25.0 million aggregate principal amount of its 7.125% Senior Notes due 2026 at a redemption price equal to 100% of the principal amount, plus accrued and unpaid interest. '
  + 'Following the redemption, the notes remain outstanding in part.';
describe('zzz789 · 2 / 7 KOS — debt redemption', () => {
  const src: SourceRef = { kind: 'SEC_FILING', access: 'DOCUMENT_READ', issuer: 'KOS', date: '2026-09-22', url: 'https://www.sec.gov/kos-8k', title: '8-K — Item 8.01 Other Events', secItems: ['8.01'] };
  const facts = extractUsFacts({ text: KOS_8K, source: src, form: '8-K', items: ['8.01'] });
  const kos = mk({ ticker: 'KOS', market: 'US', company: 'Kosmos Energy Ltd.', status: 'catalyst', category: 'debt_reduction', stage: 'executed', sourceTier: 'primary', docExtract: true, marketCap: 3000,
    headline: 'Kosmos Energy redeems $25 million of its 7.125% Senior Notes due 2026', evidenceQuote: 'redeemed $25.0 million aggregate principal amount of its 7.125% Senior Notes due 2026',
    sourceUrl: src.url, sourceDate: '2026-09-22', ageDays: 2, valueStated: 25, structuredFacts: facts } as any);
  test('the extractor reads the redemption: debt fact, $25M, action "redeemed"', () => {
    const d = facts.find((x) => x.event.kind === 'debt');
    assert.ok(d, JSON.stringify(facts.map((x) => x.event.kind)));
    assert.equal(d!.economics.valueNative, 25);
    assert.ok(d!.terms.some((t) => t.label === 'Action' && t.value === 'redeemed'));
    assert.match(describeUsFact(d!).line, /^\$25(?:\.0)?M of debt redeemed/);
    assert.equal(debtActionOf('the Company redeemed its notes'), 'redeemed');
  });
  test('WHAT CHANGED = "$25M notes redeemed" (the verified fact); IMPACT is the separate unknown; persistence EARLY, never TEMPORARY', () => {
    const it = item(usView({ KOS: kos }), 'KOS');
    assert.equal(it.eventType, 'Debt / refinancing');
    assert.equal(it.whatChanged, '$25M notes redeemed (document-verified)');
    assert.match(it.impact || '', /^Not established — .*cash-flow effect/);
    assert.ok(!/impact not established/i.test(it.whatChanged || ''));
    assert.equal(it.persistenceTest!.grade, 'EARLY');
    assert.match(it.persistenceTest!.why, /not established yet \(not shown to be one-off either\)/);
    assert.match(it.whyResearch, /balance-sheet effect: interest saved, maturity and leverage/);
    // Debt checklist: Amount → rate → maturity → cash-flow effect → leverage; stated items answered
    assert.deepEqual(it.researchNext.map((q) => q.split(':')[0]), ['1. Amount', '2. Rate', '3. Maturity', '4. Cash-flow effect', '5. Leverage']);
    assert.match(it.researchNext[0], /✓ \$25M/);
    assert.match(it.researchNext[1], /✓ 7\.125%/);
    assert.match(it.researchNext[2], /✓ .*2026/);
    assert.ok(!/✓/.test(it.researchNext[3]) && !/✓/.test(it.researchNext[4]));
    const c = card(it);
    assert.ok(c.includes('WHAT CHANGED $25M notes redeemed'), c);
    assert.ok(c.includes('IMPACT Not established'), c);
    assert.ok(c.includes('PERSISTENCE: EARLY / UNPROVEN') && !c.includes('PERSISTENCE: TEMPORARY'), c);
  });
  test('TEMPORARY needs evidence of a one-off / finite effect (a stated demand, a resale, "one-time")', () => {
    const rec = (f: StructuredFacts[]) => buildCatalystRecords('T', 'IN', f)[0];
    const run = (f: StructuredFacts[]) => persistenceTestOf({ kind: f[0].event.kind, facts: f, record: rec(f), potential: 'UNKNOWN', evidenceLevel: 'UNPROVEN', evidenceText: '', hay: '', market: 'IN' });
    assert.equal(run([fact('debt', { title: 'Redemption of NCDs' }, { value: 50 })]).grade, 'EARLY');
    assert.equal(run([fact('tax_litigation', { title: 'GST demand' }, { value: 2.1 })]).grade, 'TEMPORARY');
    assert.equal(run([fact('debt', { title: 'One-time settlement with lenders paid' }, { value: 50 })]).grade, 'TEMPORARY');
  });
  test('press: an institutional share purchase is an ownership change, never an M&A running story', () => {
    const now = new Date('2026-09-24T09:00:00Z');
    const raw = [
      { title: 'Geode Capital Management LLC Acquires New Stake in Kosmos Energy Ltd. $KOS - MarketBeat', url: 'k1', published_at: '2026-09-22T10:00:00Z' },
      { title: 'Kosmos Energy Ltd. (NYSE:KOS) Shares Bought by Vanguard Group Inc. - MarketBeat', url: 'k2', published_at: '2026-09-20T10:00:00Z' },
      { title: 'Kosmos Energy Ltd. (NYSE:KOS) Stake Raised by Invesco Ltd. - MarketBeat', url: 'k3', published_at: '2026-09-18T10:00:00Z' },
    ];
    const ctx = buildNewsContext(raw, { ticker: 'KOS', company: 'Kosmos Energy', now });
    assert.equal(ctx.items.length, 3);
    for (const i of ctx.items) assert.deepEqual(i.themes, ['institutional_holding'], i.title);
    assert.equal(ctx.narrative, null, 'routine holding reports are not a running story — and never "M&A"');
    assert.deepEqual(pressFacts(ctx, 'KOS', []).facts, [], 'no event fact (no acquisition) from a holding report');
    // a real M&A headline still reads as M&A
    assert.ok(themesOf('Kosmos Energy agrees to acquire Tullow Oil in all-share deal').includes('acquisition'));
    const ma = buildNewsContext([
      { title: 'Kosmos Energy agrees to acquire Tullow Oil in all-share deal - Reuters', url: 'm1', published_at: '2026-09-22T10:00:00Z' },
      { title: 'Kosmos Energy takeover of Tullow Oil wins board backing - FT', url: 'm2', published_at: '2026-09-20T10:00:00Z' },
    ], { ticker: 'KOS', company: 'Kosmos Energy', now });
    assert.equal(ma.narrative?.theme, 'acquisition');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · FRVO — "first power" from a secondary source: potential wording only
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 3 FRVO — secondary / unverified first power: no multi-year catalyst', () => {
  const f = mk({ ticker: 'FRVO', market: 'US', company: 'Fervo Energy Co.', status: 'none', marketCap: 4000,
    structuredFacts: [fact('capacity', { kind: 'PRESS', access: 'SUMMARY_ONLY', issuer: 'FRVO', title: 'Fervo Energy delivers first power from 100 MW Cape Station geothermal plant in Utah — Reuters', url: 'https://news.example/frvo', date: '2026-09-22' })] } as any);
  test('potential Not established · verification required; capacity potential not multi-year; persistence EARLY; nothing marked answered', () => {
    const it = item(usView({ FRVO: f }), 'FRVO');
    assert.equal(it.eventClass, 'POTENTIAL_UNVERIFIED');
    assert.equal(it.eventType, 'Capacity expansion');
    assert.equal(it.sourceConfidence, 'SECONDARY_SUMMARY');
    assert.equal(it.persistence, 'UNKNOWN');
    assert.match(it.potentialDuration!.text, /secondary source only\. A multi-period effect is only a potential until plant operation, utilisation, offtake \/ revenue and economics are verified in an official filing \(verification required\)/);
    assert.match(it.durations!.capacity!.text, /^Capacity potential: not established \(verification required\)/);
    assert.equal(it.persistenceTest!.grade, 'EARLY');
    assert.equal(it.verification, 'Secondary · verification required');
    assert.ok(it.researchNext.every((q) => !/✓/.test(q)), 'press is not a verified fact — nothing is marked answered');
    assert.deepEqual(it.researchNext.map((q) => q.split(':')[0]), ['1. Capex', '2. Commissioning', '3. Utilisation', '4. Demand / offtake', '5. Revenue', '6. EBITDA']);
    assert.match(it.whyResearch, /^Only a secondary source so far — confirm it in an official filing\. Capex \/ capacity on file — the open question is utilisation/);
    assert.ok(!/multi-period runway/.test(it.whyRank || ''));
    assert.match(it.whyRank || '', /secondary source — verification required/);
    const fl = factLine(it);
    assert.ok(!/MULTI-YEAR/.test(fl), fl);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 / 5 · RAYMOND / RNIT — contractual runway ≠ persistence; general rule
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 4 RAYMOND / 5 RNIT — persistence above Early needs quantified economics + repeat evidence', () => {
  const NEW = B('583c6b13-f125-445c-abec-f5dc23e7105f'), OLD = B('6ccfd83b-184a-4a5a-9be3-2e6eddaf4f11');
  const cur: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond subsidiary wins tender for wing and fuselage structures in fighter aircraft programme.', url: NEW, dateIso: '2026-09-23T17:00:00+05:30', ageDays: null }];
  const rel: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond aerospace subsidiary wins multi-programme orders worth about ₹33 crore annually; production starts in 2026-27.', url: OLD, dateIso: '2026-09-11T17:50:13+05:30', ageDays: null }];
  const raymond = async () => {
    const docs = await docsFrom('RAYMOND', { [NEW]: 'raymond-2026-09-23.txt' }, cur);
    const hist = await docsFrom('RAYMOND', { [OLD]: 'raymond-2026-09-11.txt' }, rel, 'history');
    return find('RAYMOND', cur, [...docs, ...hist], { marketCap: 12000 });
  };
  test('RAYMOND: PERSISTENCE MEDIUM → EARLY / UNPROVEN while order value and execution economics are unknown', async () => {
    const it = item(view({ RAYMOND: await raymond() }), 'RAYMOND');
    assert.equal(it.persistenceTest!.grade, 'EARLY');
    assert.equal(it.persistenceEvidence!.level, 'EARLY');
    assert.match(it.persistenceEvidence!.text, /programme duration and build rate are not established/);
    // the programme potential is kept, labelled as potential (FACTS), and the ₹33 Cr is not an answer
    assert.equal(it.persistence, 'YEARS'); assert.equal(it.potentialDuration!.basis, 'FACTS');
    assert.match(it.researchNext[0], /^1\. Order value: is the order value stated/);
    // the two official aerospace filings are the repeat evidence on file — still no firm value, so still Early
    assert.match(it.researchNext[5], /^6\. Repeatability: /);
    assert.match(it.durations!.revenueVisibility || '', /POTENTIAL, not a firm value/);
    const c = card(it);
    assert.ok(c.includes('PERSISTENCE: EARLY / UNPROVEN') && !c.includes('PERSISTENCE: MEDIUM'), c);
  });
  const rnitAnn: AnnouncementLite = { subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'RNIT signs five-year services agreement with a global logistics customer for managed IT services.', url: B('11110000-2222-3333-4444-555566667777'), dateIso: '2026-09-23T17:00:00+05:30', ageDays: null };
  test('RNIT: contractual runway 5 years shown separately; persistence Early / unproven (not Medium)', () => {
    const it = item(view({ RNIT: find('RNIT', [rnitAnn], null) }), 'RNIT');
    assert.equal(it.durations!.contractual, 'Contract runway: 5 years (as stated). Economic contribution still unquantified.');
    assert.equal(it.persistenceEvidence!.level, 'EARLY');
    assert.match(it.persistenceEvidence!.text, /^Contract runway 5 years \(as stated\) is contractual, not persistence evidence — value, billing, renewal and customer economics are not on file/);
    assert.equal(it.persistenceTest!.grade, 'EARLY');
    assert.match(it.whyResearch, /runway, not proven revenue/);
    assert.match(it.researchNext[2], /^3\. Execution period: ✓ 5-year term \(contract runway, as stated\)/);
    assert.match(it.researchNext[0], /^1\. Contract value: /, 'a services contract\'s figure is a contract value');
    assert.match(it.researchNext[5], /recurring across the stated term/);
    const fl = factLine(it);
    assert.ok(fl.includes('CONTRACTUAL DURATION 5 YEARS') && fl.includes('PERSISTENCE EVIDENCE EARLY'), fl);
  });
  test('general rule: quantified + repeat official filings lifts the grade; either alone does not', () => {
    const ord = (date: string, url: string, value: number | null) => fact('order', { date, url, title: 'Order from NHAI' }, { counterparty: 'NHAI', value });
    const t = (facts: StructuredFacts[]) => persistenceTestOf({ kind: 'order', facts, record: buildCatalystRecords('T', 'IN', facts)[0], potential: 'UNKNOWN', evidenceLevel: 'EARLY', evidenceText: '', hay: '', market: 'IN' }).grade;
    assert.equal(t([ord('2026-09-01', 'a', 120)]), 'EARLY', 'quantified once');
    assert.equal(t([ord('2026-09-01', 'a', null), ord('2026-09-20', 'b', null)]), 'EARLY', 'repeated, not quantified');
    assert.equal(t([ord('2026-09-01', 'a', 120), ord('2026-09-20', 'b', 140)]), 'MEDIUM', 'quantified + repeated');
    assert.equal(persistenceEvidenceOf('Contract', 'POTENTIAL_UNVERIFIED', 'SIGNED', 'contract_term', 'five-year services agreement', null, { contractYears: 5 }).level, 'EARLY');
    assert.equal(persistenceEvidenceOf('Order win', 'CONFIRMED_MATERIAL', 'AWARDED', 'order', 'order ₹120 crore', null, { quantified: true, officialFilings: 2 }).level, 'EVIDENCE');
    assert.equal(persistenceEvidenceOf('Order win', 'CONFIRMED_MATERIAL', 'AWARDED', 'order', 'order', null, { quantified: false, officialPeriods: 2 }).level, 'EARLY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · MILKYMIST — ₹40 Cr is CAPEX, never "order value"
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 8 MILKYMIST — event-specific field labels', () => {
  const ann: AnnouncementLite = { subject: 'Announcement under Regulation 30 (LODR)-Commissioning of new plant', summary: 'Milky Mist commissions new cheese plant at Perundurai with a capex of ₹40 crore.', url: B('4e0f0000-1111-2222-3333-444455556666'), dateIso: '2026-09-22T16:00:00+05:30', ageDays: null };
  test('stated capex: "Stated capex: ₹40 Cr" — never "Stated order value"; research asks utilisation / offtake / revenue', () => {
    const f = find('MILKYMIST', [ann], null, { marketCap: 6000 });
    assert.equal(f.valueStated, 40);
    const it = item(view({ MILKYMIST: f }), 'MILKYMIST');
    assert.ok(['Capacity expansion', 'Production ramp'].includes(it.eventType), it.eventType);
    assert.equal(it.whatChanged, 'Stated capex: ₹40 Cr · Source: filing metadata/summary · Document verification: pending');
    assert.ok(!/order value/i.test(JSON.stringify(it)), 'no "order value" anywhere on a capex item');
    assert.match(it.materiality.explanation, /Stated capex: ₹40 Cr/);
    assert.deepEqual(it.researchNext.map((q) => q.split(':')[0]), ['1. Capex', '2. Commissioning', '3. Utilisation', '4. Demand / offtake', '5. Revenue', '6. EBITDA']);
    assert.match(it.researchNext[0], /✓ ₹40 Cr stated · document verification pending/);
    for (const i of [2, 3, 4]) assert.ok(!/✓/.test(it.researchNext[i]), it.researchNext[i]);
    assert.match(it.whyResearch, /utilisation/);
  });
  test('labels by event kind', () => {
    const L = (t: any, h = '') => valueLabelOf(t, h).label;
    assert.equal(L('Order win'), 'order value');
    assert.equal(L('Capacity expansion'), 'capex'); assert.equal(L('Production ramp'), 'capex');
    assert.equal(L('Acquisition'), 'purchase consideration');
    assert.equal(L('Fundraising'), 'issue size');
    assert.equal(L('Debt / refinancing', 'redeemed notes'), 'amount redeemed');
    assert.equal(L('Debt / refinancing', 'issued NCDs'), 'amount raised');
    assert.equal(L('Strategic investment'), 'stake value');
    assert.equal(L('Contract', 'five-year services agreement'), 'contract value');
    assert.equal(L('Regulatory approval', 'licence for the new distillery plant'), 'capex');
    const v = view({ FR: mk({ ticker: 'FR', status: 'catalyst', category: 'fundraising', stage: 'executed', sourceTier: 'primary', headline: 'Allotment of equity shares on preferential basis raising ₹50 crore', sourceUrl: 'f', sourceDate: '2026-09-23', ageDays: 1, valueStated: 50 }) });
    assert.match(item(v, 'FR').materiality.explanation, /issue size ₹50 Cr/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · WHY RESEARCH — event-aware (ABDL demand, ZIMLAB expansion)
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 6 ABDL / ZIMLAB — event-aware WHY RESEARCH and checklists', () => {
  test('ABDL licence: demand / customer evidence; licence ≠ orders (kept)', async () => {
    const URL = B('abd10000-1111-2222-3333-444455556666');
    const anns: AnnouncementLite[] = [{ subject: 'Disclosure under Regulation 30 - Grant of Licence for Manufacture of Malt Spirits for Potable Purpose', summary: 'ABDL received licence from Telangana excise to manufacture ~4.4 million BL of malt spirits per annum at Rangapur.', url: URL, dateIso: '2026-09-15T12:00:00+05:30', ageDays: null }];
    const it = item(view({ ABDL: find('ABDL', anns, await docsFrom('ABDL', { [URL]: 'abdl-licence.txt' }, anns), { marketCap: 9000 }) }), 'ABDL');
    assert.match(it.whyResearch, /capability, not demand/);
    assert.equal(it.persistenceEvidence!.level, 'UNPROVEN');
    assert.deepEqual(it.researchNext.map((q) => q.split(':')[0]), ['1. Qualified capacity', '2. Customer', '3. Commercial order', '4. Production']);
    assert.match(it.researchNext[0], /✓ .*4\.4 million BL/i);
    assert.match(it.researchNext[1], /^2\. Customer: Demand: orders, offtake agreements or named customers/);
    assert.ok(!/✓/.test(it.researchNext[2]), 'a licence is not a commercial order');
  });
  test('an approval with unknown size asks about demand — never the generic "size is not disclosed"', () => {
    const f = mk({ ticker: 'APPR', status: 'catalyst', category: 'regulatory_approval', stage: 'executed', sourceTier: 'primary', headline: 'Receipt of USFDA approval for generic tablets', sourceUrl: 'a', sourceDate: '2026-09-23', ageDays: 1 });
    const it = item(view({ APPR: f }), 'APPR');
    assert.equal(it.eventClass, 'POTENTIAL_UNVERIFIED');
    assert.match(it.whyResearch, /^Approval on file — the open question is demand: which customer buys under it/);
    assert.ok(!/size is not disclosed/.test(it.whyResearch));
  });
  test('ZIMLAB Chile: strategic expansion checklist — Investment → setup → customers → revenue (kept: "new entity / geography sell")', async () => {
    const url = B('031cc190-d325-4294-8481-5b829da70d34');
    const anns: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Updates on Acquisition', summary: 'ZIM Laboratories SpA incorporated in Chile on 9 September 2026 as a wholly owned subsidiary for LATAM expansion.', url, dateIso: '2026-09-18T16:00:00+05:30', ageDays: null }];
    const it = item(view({ ZIMLAB: find('ZIMLAB', anns, await docsFrom('ZIMLAB', { [url]: 'zimlab-chile.txt' }, anns)) }), 'ZIMLAB');
    assert.equal(it.eventType, 'Strategic expansion');
    assert.deepEqual(it.researchNext.map((q) => q.split(':')[0]), ['1. Investment', '2. Regulatory / commercial setup', '3. Customers', '4. Revenue']);
    assert.ok(it.researchNext.some((q) => /new entity \/ geography sell/.test(q)));
    assert.equal(it.persistenceEvidence!.level, 'UNPROVEN');
    assert.equal(it.persistence, 'UNKNOWN', 'a new subsidiary has no stated duration');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · Research Next — ordered, event-aware checklists; answered steps marked
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 12 Research Next checklists', () => {
  const labels = (it: ResearchItem) => it.researchNext.map((q) => q.replace(/^\d+\. /, '').split(':')[0]);
  test('order win: value → margin → execution period → customer → working capital → repeatability; verified facts are answered, not re-asked', () => {
    const f = mk({ ticker: 'ORD', status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', modelRead: true, marketCap: 3000,
      headline: 'Order from NHAI ₹900 Cr over 36 months', evidenceQuote: 'order of ₹900 crore to be executed over 36 months', sourceUrl: 'https://x/ord', sourceDate: '2026-09-23', ageDays: 1, valueStated: 900,
      facts: { counterparty: 'NHAI', execution_period: '36 months' } });
    const it = item(view({ ORD: f }), 'ORD');
    assert.deepEqual(labels(it), ['Order value', 'Margin', 'Execution period', 'Customer', 'Working capital', 'Repeatability']);
    assert.match(it.researchNext[0], /^1\. Order value: ✓ ₹900 Cr .*\(per the filing\)$/);
    assert.match(it.researchNext[2], /^3\. Execution period: ✓ 36 months/);
    assert.match(it.researchNext[3], /^4\. Customer: ✓ NHAI/);
    assert.match(it.researchNext[1], /^2\. Margin: margin on this order/);
    assert.match(it.impact || '', /^Not established — margin, working capital, repeatability still open$/);
  });
  test('stake, fundraising and merger follow their own order', () => {
    const beta = mk({ ticker: 'BETA', market: 'US', status: 'none', marketCap: 5000,
      structuredFacts: [fact('stake_by_strategic', { kind: 'SEC_FILING', issuer: 'BETA', title: 'SCHEDULE 13G — Amazon.com, Inc. 5.3%', url: 'https://www.sec.gov/beta-13g', date: '2026-09-22' }, { counterparty: 'Amazon.com, Inc.' })] } as any);
    assert.deepEqual(labels(item(usView({ BETA: beta }), 'BETA')), ['Buyer', 'Stake', 'Price', 'Rationale', 'Governance / strategic relationship']);
    assert.match(item(usView({ BETA: beta }), 'BETA').researchNext[0], /✓ Amazon\.com, Inc\./);
    const fr = mk({ ticker: 'KABRA', status: 'catalyst', category: 'fundraising', stage: 'executed', sourceTier: 'primary', marketCap: 800, headline: 'Allotment of equity shares on preferential basis raising ₹50 crore', sourceUrl: 'k', sourceDate: '2026-09-23', ageDays: 1, valueStated: 50 });
    assert.deepEqual(labels(item(view({ KABRA: fr }), 'KABRA')), ['Size', 'Price', 'Dilution', 'Use of proceeds', 'Funding gap']);
    const mrg = mk({ ticker: 'MRG', status: 'catalyst', category: 'acquisition', stage: 'executed', sourceTier: 'primary', headline: 'Board approves merger of Alpha Components with the Company', sourceUrl: 'm', sourceDate: '2026-09-23', ageDays: 1 });
    assert.deepEqual(labels(item(view({ MRG: mrg }), 'MRG')), ['Consideration', 'Ownership', 'Financial contribution', 'Synergies / integration']);
    const np = mk({ ticker: 'NEWP', status: 'catalyst', category: 'new_product', stage: 'executed', sourceTier: 'primary', headline: 'Launch of new range of premium adhesives', sourceUrl: 'n', sourceDate: '2026-09-23', ageDays: 1 });
    assert.deepEqual(labels(item(view({ NEWP: np }), 'NEWP')), ['Customers', 'Commercial availability', 'Pricing', 'Revenue', 'Repeatability']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · PRIORITY — an appeal that REDUCED a tax demand is never negative
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 9 PRIORITY — favourable regulatory / legal outcomes', () => {
  const ann: AnnouncementLite = { subject: 'Disclosure under Regulation 30 - Order passed by Joint Commissioner (Appeals)', summary: 'The Joint Commissioner (Appeals) has passed an order in the appeal filed by the Company, reducing the GST demand from ₹8.62 crore to ₹0.94 crore.', url: B('77770000-1111-2222-3333-444455556666'), dateIso: '2026-09-23T16:00:00+05:30', ageDays: null };
  test('India: classified favourable → not in NEGATIVE EVIDENCE; labelled a resolved outcome', () => {
    assert.equal(favourableLegalOutcome(ann.summary!), true);
    assert.equal(taxFavourable(ann.summary!), true);
    assert.notEqual(classifyAnnouncement({ ...ann, ageDays: 1 }, 'IN').kind, 'negative');
    const f = find('PRIORITY', [ann], null);
    assert.notEqual(f.status, 'negative');
    const v = view({ PRIORITY: f });
    assert.ok(!v.negative.some((i) => i.ticker === 'PRIORITY'), 'never under NEGATIVE EVIDENCE');
    assert.ok(!(v.immaterialNegative || []).some((i) => i.ticker === 'PRIORITY'));
    const it = item(v, 'PRIORITY');
    assert.notEqual(it.eventClass, 'NEGATIVE');
    assert.match(it.eventLabel || '', /Favourable tax \/ legal outcome — resolved \(not negative\)/);
    assert.match(it.whyResearch, /^A favourable tax \/ legal outcome .* a resolved matter, not negative evidence/);
    assert.match(it.headline, /^Favourable tax \/ legal outcome — /);
    const html = strip(renderToStaticMarkup(React.createElement(ResearchTriage, { view: v, market: 'IN' } as any)));
    assert.ok(!html.includes('NEGATIVE EVIDENCE PRIORITY'), html);
  });
  test('document read: a favourable order is a positive (resolved) fact and its card is not "▼ Negative"', () => {
    const doc = 'To BSE Limited. Sub: Disclosure under Regulation 30. '.repeat(3) + 'We wish to inform that the Joint Commissioner (Appeals), CGST, has passed an order partly allowing the appeal filed by the Company and has reduced the GST demand from Rs. 8.62 crore to Rs. 0.94 crore, along with proportionate interest and penalty.';
    const x = extractIndiaFacts({ text: doc, issuer: 'PRIORITY', date: '2026-09-23', url: 'u', title: 'Order of Commissioner (Appeals)' }).facts[0] as any;
    assert.equal(x.event.kind, 'tax_litigation'); assert.equal(x.polarity, 'positive');
    const rec = buildCatalystRecords('PRIORITY', 'IN', [x])[0];
    assert.equal(rec.polarity, 'positive');
    // VIKRAN ITAT: "deciding the appeal in favor of the Company" (real fixture) — also favourable
    const it2 = extractIndiaFacts({ text: txt('vikran-itat.txt'), issuer: 'VIKRAN', date: '2026-09-22', url: 'v', title: 'ITAT order' }).facts[0] as any;
    assert.equal(it2.polarity, 'positive');
  });
  test('US and press classifiers: appeal allowed / penalty vacated / demand quashed are not negative; a dismissed appeal is', () => {
    assert.notEqual(classifyAnnouncement({ subject: '8-K', summary: 'The Court of Appeals vacated the $4.2 million penalty imposed on the Company by the agency.', url: 'u', dateIso: '2026-09-22T10:00:00-04:00', ageDays: 1 }, 'US').kind, 'negative');
    assert.ok(!themesOf('ITAT quashes ₹12 crore tax demand on Priority Jewels').includes('negative'));
    assert.ok(themesOf('GST demand notice of ₹12 crore on Priority Jewels').includes('negative'));
    assert.equal(favourableLegalOutcome('The appeal was dismissed and the demand confirmed.'), false);
    assert.equal(favourableLegalOutcome('The Tribunal partly allowed the appeal; the demand was reduced to ₹1 crore.'), true);
    assert.equal(favourableLegalOutcome('Relief granted by the High Court; the demand has been set aside.'), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · ARVIND / KOS — running story needs strong entity identity
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 10 ARVIND — a politician\'s name is not the company', () => {
  const now = new Date('2026-09-24T09:00:00Z');
  const raw = [
    { title: 'Arvind Kejriwal slams Centre over Delhi water crisis - NDTV', url: 'a1', published_at: '2026-09-23T10:00:00Z' },
    { title: 'Arvind Kejriwal gets bail in excise policy case - The Hindu', url: 'a2', published_at: '2026-09-21T10:00:00Z' },
    { title: 'AAP chief Arvind addresses rally in Punjab - ANI', url: 'a3', published_at: '2026-09-20T10:00:00Z' },
    { title: 'Arvind Ltd shares jump 6% after textile export order - Economic Times', url: 'a4', published_at: '2026-09-22T10:00:00Z' },
    { title: 'Arvind share price hits 52-week high on strong Q1 - Mint', url: 'a5', published_at: '2026-09-18T10:00:00Z' },
  ];
  test('Kejriwal / AAP headlines are rejected; Arvind Ltd headlines kept; the running story is the company\'s', () => {
    const ctx = buildNewsContext(raw, { ticker: 'ARVIND', company: 'Arvind', now });
    assert.deepEqual(ctx.items.map((i) => i.url).sort(), ['a4', 'a5']);
    assert.ok(ctx.items.every((i) => !/kejriwal|aap/i.test(i.title)));
    assert.ok(!ctx.narrative || !/kejriwal/i.test(ctx.narrative.lead));
  });
  test('entity identity rules', () => {
    assert.equal(entityMatch('Arvind Kejriwal slams Centre', 'ARVIND', 'Arvind Ltd').ok, false);
    assert.equal(entityMatch('Arvind Ltd bags export order', 'ARVIND', 'Arvind Ltd').ok, true);
    assert.equal(entityMatch('Stocks to watch: NSE: ARVIND, TCS', 'ARVIND', 'Arvind Ltd').ok, true);
    assert.equal(entityMatch('Raymond James upgrades bank stocks', 'RAYMOND', 'Raymond Ltd').ok, false, 'a surname-like follower is another entity');
    assert.equal(entityMatch('Raymond shares rally on aerospace order', 'RAYMOND', 'Raymond Ltd').ok, true);
    assert.equal(entityMatch('GNA Axles promoter raises stake', 'GNA', 'GNA Axles Ltd').ok, true);
    assert.equal(entityMatch('Kosovo energy grid upgrade', 'KOS', 'Kosmos Energy Ltd.').ok, false);
    assert.equal(newsQueryFor('ARVIND', 'Arvind Ltd', 'IN'), '"Arvind" share when:45d', 'a one-word name is searched with a stock word');
    assert.equal(newsQueryFor('KOS', 'Kosmos Energy Ltd.', 'US'), '"Kosmos Energy" when:45d');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · GNA — one canonical event, referenced from each view, never counted twice
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 11 GNA — one canonical event across Watch and Unknown — needs reading', () => {
  const ann: AnnouncementLite = { subject: 'Disclosure under Regulation 29(1) of SEBI (SAST) Regulations, 2011', summary: 'Promoter GNA Holdings acquired 1.16% stake in GNA Axles through open market purchase.', url: B('9aa00000-1111-2222-3333-444455556666'), dateIso: '2026-09-22T16:00:00+05:30', ageDays: null };
  test('the same item object sits in both lists with one canonical id; the page renders it once and says "also in"', () => {
    const v = view({ GNA: find('GNA', [ann], null) });
    const inWatch = v.watch.find((i) => i.ticker === 'GNA') || v.queue.find((i) => i.ticker === 'GNA');
    const inNeeds = (v.needsReading || []).find((i) => i.ticker === 'GNA');
    assert.ok(inWatch && inNeeds, 'surfaced in two views');
    assert.equal(inWatch, inNeeds, 'one canonical record, referenced — not a copy');
    assert.equal(inWatch!.canonicalId, inNeeds!.canonicalId);
    assert.ok(inWatch!.canonicalId && /^GNA:/.test(inWatch!.canonicalId));
    assert.ok(inWatch!.surfacedIn!.includes('Unknown — needs reading'));
    // not an operating mechanism, not shown one-off: Early / unproven — never TEMPORARY / "not persistent"
    assert.equal(inWatch!.persistenceTest!.grade, 'EARLY'); assert.equal(inWatch!.persistenceEvidence!.level, 'UNPROVEN');
    assert.match(inWatch!.whatChanged || '', /1\.16% stake/);
    const html = renderToStaticMarkup(React.createElement(ResearchTriage, { view: v, market: 'IN' } as any));
    const t = strip(html);
    // needs-reading header counts only rows not already shown; GNA is referenced there, not repeated
    // zzz836: an empty section is hidden (one line instead), and a bucket name is never printed as "also in"
    assert.ok(!/UNKNOWN — NEEDS READING · 0/.test(t), t);
    assert.ok(t.includes('Events with unknown size are all shown above (1)'), t);
    assert.ok(!t.includes('SAME EVENT · ALSO IN'), t);
    // one row / card for GNA with an OPEN button in the ranked sections — never two
    const rows = (html.match(/Promoter GNA Holdings acquired 1\.16% stake/g) || []).length;
    assert.equal(rows, 1, `GNA rendered ${rows} times`);
  });
  test('counts: no event counted twice across queue / watch / needs reading', () => {
    const v = view({ GNA: find('GNA', [ann], null), KABRA: mk({ ticker: 'KABRA', status: 'catalyst', category: 'fundraising', stage: 'executed', sourceTier: 'primary', marketCap: 800, headline: 'Allotment of equity shares on preferential basis raising ₹50 crore', sourceUrl: 'k', sourceDate: '2026-09-23', ageDays: 1, valueStated: 50 }) });
    const ids = [...v.queue, ...v.watch].map((i) => i.canonicalId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(v.summary.queue + v.summary.watch!, v.queue.length + v.watch.length);
    assert.equal(v.summary.confirmed + v.summary.potential + v.summary.negative + v.summary.noCatalyst + v.summary.dataUnavailable + (v.summary.listings || 0), v.summary.scanned);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13 · Ranking — structured dimensions; unknown fields never raise rank
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · 13 ranking — evidence × mechanism × persistence × materiality × researchability', () => {
  const base = { status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', modelRead: true, marketCap: 3000, sourceUrl: 'https://x/o', sourceDate: '2026-09-23', ageDays: 1, valueStated: 100 } as const;
  const full = mk({ ticker: 'FULL', ...base, headline: 'Order ₹100 Cr from NHAI', evidenceQuote: 'order of ₹100 crore from NHAI at a 14% EBITDA margin, to be executed over 18 months, with a 10% mobilisation advance', facts: { counterparty: 'NHAI', execution_period: '18 months', margin: '14% EBITDA margin' } } as any);
  const bare = mk({ ticker: 'BARE', ...base, headline: 'Order ₹100 Cr', evidenceQuote: 'order of ₹100 crore' } as any);
  test('adding unknown fields does NOT raise an item\'s rank', () => {
    const a = item(view({ FULL: full }), 'FULL'), b = item(view({ BARE: bare }), 'BARE');
    assert.ok(b.unknowns.length > a.unknowns.length, 'BARE has more unknown fields');
    assert.ok((b.economicsUnknown?.missing.length ?? 0) >= (a.economicsUnknown?.missing.length ?? 0));
    assert.ok(b.priority <= a.priority, `more unknowns must not rank higher: ${b.priority} > ${a.priority}`);
    // Extra unknown lines on the facts change nothing at all.
    const withUnknowns = { ...full, structuredFacts: [fact('order', { issuer: 'FULL', url: 'https://x/o', title: 'Order from NHAI' }, { counterparty: 'NHAI', value: 100, unknowns: ['Margin not stated.', 'Customer concentration not stated.', 'Billing schedule not stated.', 'Advance not stated.', 'Renewal not stated.', 'Penalty terms not stated.'] })] } as any;
    const c = item(view({ FULL: withUnknowns }), 'FULL');
    assert.ok(c.priority <= a.priority, `${c.priority} vs ${a.priority}`);
  });
  test('a plain "Why #N:" line in words — no visible score', () => {
    const v = view({ FULL: full, BARE: bare, NOCAT: mk({ ticker: 'NOCAT', status: 'none', movePct: 30 }) });
    const top = v.queue[0];
    assert.equal(top.ticker, 'FULL');
    assert.match(top.whyRank || '', /^verified event \(document read\) \+ quantified economic mechanism \+ multi-period runway \+ (material vs size|small vs company size|unresolved economic significance)/);
    const c = card(top, 1, 'Research queue');
    assert.ok(c.includes('WHY #1: verified event (document read) + quantified economic mechanism'), c);
    assert.ok(!/\/100|RESEARCH PRIORITY \d/.test(c), 'no numeric score on the card');
    // score details are words too
    const withDetails = strip(renderToStaticMarkup(React.createElement(require('../../components/ai-gainers/ResearchCard').ScoreDetails, { it: top })));
    assert.ok(withDetails.includes('HOW THE RANK WAS BUILT') && !/\b\d{1,3}\/100\b/.test(withDetails), withDetails);
  });
  test('price is never an input: the move changes neither rank nor the words', () => {
    const a = item(view({ FULL: { ...full, movePct: 2 } as Finding }), 'FULL'), b = item(view({ FULL: { ...full, movePct: 19 } as Finding }), 'FULL');
    assert.equal(a.whyRank, b.whyRank);
    assert.equal(a.persistenceTest!.grade, b.persistenceTest!.grade);
    assert.equal(a.persistence, b.persistence);
    assert.equal(a.scoreDetails!.mechanism, b.scoreDetails!.mechanism);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// kept behaviour — VIKRAN / MAXESTATES / India + US + Your Book on one builder
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz789 · kept: VIKRAN pending verification, MAXESTATES chain, one builder for India / US / Your Book', () => {
  const ORDER = B('ceee1a58-fb2d-4d45-aca0-8adb6ff98ec3'), GST = B('98ef3f2b-0b54-4f40-9384-6724175b304c');
  const anns: AnnouncementLite[] = [
    { subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Vikran won ₹153.76 crore POWERGRID order for Tumkur-II 400 kV AIS substation extension, executable in 21 months.', url: ORDER, dateIso: '2026-09-23T18:10:00+05:30', ageDays: null },
    { subject: 'Disclosure Of Information Under Regulation 30 Of The SEBI (LODR) Regulations, 2015', summary: 'Vikran Engineering received GST SCN for FY23, demanding Rs. 5.34 crore tax and Rs. 53.44 lakh penalty.', url: GST, dateIso: '2026-09-23T16:59:59+05:30', ageDays: null },
  ];
  test('VIKRAN before reading: "Stated order value … Document verification: pending", no ratio; the checklist marks the stated value pending', () => {
    const it = item(view({ VIKRAN: find('VIKRAN', anns, null) }), 'VIKRAN');
    assert.equal(it.whatChanged, 'Stated order value: ₹153.76 Cr · Source: filing metadata/summary · Document verification: pending');
    assert.equal(it.materiality.ratios.length, 0);
    assert.match(it.researchNext[0], /^1\. Order value: ✓ ₹153\.76 Cr stated · document verification pending \(no % computed\)/);
    assert.match(it.whyResearch, /^Order value is stated but not yet verified in the document/);
  });
  test('VIKRAN after reading: the order is document-verified, the GST notice stays a separate negative record', async () => {
    const docs = await docsFrom('VIKRAN', { [ORDER]: 'vikran-order.txt', [GST]: 'vikran-gst.txt' }, anns);
    const it = item(view({ VIKRAN: find('VIKRAN', anns, docs) }), 'VIKRAN');
    assert.equal(it.whatChanged, 'Order ₹153.76 Cr ÷ ₹2,000 Cr market cap = 7.7% (document-verified)');
    assert.equal(it.persistenceTest!.grade, 'EARLY', 'one order, quantified once — early');
    for (const s of [generated(it), card(it)]) assert.ok(!TRADE.test(s), s);
  });
  test('MAXESTATES enabling chain kept; potential duration not established (enabling step, no term)', () => {
    const f = mk({ ticker: 'MAXESTATES', status: 'catalyst', category: 'joint_venture', stage: 'enabling', sourceTier: 'primary', marketCap: 9000,
      headline: 'Max Estates signs binding MoU for Ghaziabad JDA; 9.76-acre project may unlock INR 2,500-3,000 crore GDV.', sourceUrl: 'https://x/max', sourceDate: '2026-09-23', ageDays: 1 });
    const it = item(view({ MAXESTATES: f }), 'MAXESTATES');
    assert.ok(it.researchNext.some((q) => /MoU \/ JDA → definitive agreement → approvals → execution → launch → bookings → collections → revenue → profit/.test(q)));
    assert.equal(it.persistenceEvidence!.level, 'UNPROVEN');
    assert.equal(it.persistence, 'UNKNOWN');
  });
  test('India, USA and Your Book read the same canonical item from the same builder', () => {
    const f = mk({ ticker: 'ORD', status: 'catalyst', category: 'order_win', stage: 'executed', sourceTier: 'primary', modelRead: true, marketCap: 3000,
      headline: 'Order from NHAI ₹900 Cr over 36 months', evidenceQuote: 'order of ₹900 crore to be executed over 36 months', sourceUrl: 'https://x/ord', sourceDate: '2026-09-23', ageDays: 1, valueStated: 900, facts: { counterparty: 'NHAI', execution_period: '36 months' } });
    const vin = view({ ORD: f }, { holdings: ['ORD'] });
    const book = vin.portfolio.find((i) => i.ticker === 'ORD')!;
    const ranked = [...vin.queue, ...vin.watch].find((i) => i.ticker === 'ORD')!;
    assert.equal(book, ranked, 'Your Book references the same item, not a rebuilt copy');
    assert.ok(book.surfacedIn!.includes('Your book'));
    const vus = usView({ ORD: { ...f, market: 'US' } as Finding });
    const us = item(vus, 'ORD'), inn = item(view({ ORD: f }), 'ORD');
    for (const k of ['canonicalId', 'whyRank', 'impact', 'persistenceTest', 'persistenceEvidence', 'potentialDuration', 'durations'] as const) {
      assert.ok(us[k] !== undefined && inn[k] !== undefined, `${k} present on both markets`);
    }
    assert.equal(us.persistenceTest!.grade, inn.persistenceTest!.grade);
    assert.equal(us.whyRank, inn.whyRank);
    // persistence never changes the thesis / portfolio note wording into an action
    assert.ok(!TRADE.test(book.portfolio.note || ''));
  });
  test('no trade words anywhere in generated text for the whole QA set', () => {
    const v = view({
      RNIT: find('RNIT', [{ subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'RNIT signs five-year services agreement with a global logistics customer.', url: B('11110000-2222-3333-4444-555566667777'), dateIso: '2026-09-23T17:00:00+05:30', ageDays: null }], null),
      GNA: find('GNA', [{ subject: 'Disclosure under Regulation 29(1) of SEBI (SAST) Regulations, 2011', summary: 'Promoter GNA Holdings acquired 1.16% stake in GNA Axles through open market purchase.', url: B('9aa00000-1111-2222-3333-444455556666'), dateIso: '2026-09-22T16:00:00+05:30', ageDays: null }], null),
    });
    for (const i of all(v)) assert.ok(!TRADE.test(generated(i)), `${i.ticker}: ${generated(i)}`);
  });
});
