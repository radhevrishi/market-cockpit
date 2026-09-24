// zzz785 — AI Daily Gainers audit, workstream A (India): read the filed
// document, not the exchange subject. Fixtures are the text layers of the
// real BSE attachments for the owner's QA names (fixtures/zzz785/*.txt).
// Run: npx tsx --test src/lib/__tests__/zzz785-india.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  extractIndiaFacts, moneyCr, readIndiaDocuments, relatedFilings, chooseDocuments, evidenceBreadthOf, textHash,
  type IndiaFacts, type DocRead,
} from '../ai-gainers/india-extract';
import { quoteIsInDocument, isGenericSubject, docSeqOf } from '../ai-gainers/announcement-reader';
import { buildFinding, classifyAnnouncement, isTaxMatter, RULES_VERSION, rescoreFromInputs, compactInputs, type AnnouncementLite } from '../ai-gainers/catalyst-research';
import { pressFacts, buildNewsContext } from '../ai-gainers/news-context';
import { parseNseAnnouncements, nseDateIso } from '../ai-gainers/screener-company';

const FX = join(__dirname, 'fixtures', 'zzz785');
const txt = (f: string) => readFileSync(join(FX, f), 'utf8');
const B = (id: string) => `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=${id}.pdf`;
const one = (file: string, issuer: string, date = '2026-09-23', ctx = {}): IndiaFacts => {
  const x = extractIndiaFacts({ text: txt(file), issuer, date, url: B('0000aaaa-1111-2222-3333-444455556666'), title: file }, ctx);
  assert.equal(x.facts.length, 1, `${file}: one event`);
  return x.facts[0];
};
const NOW = new Date('2026-09-24T12:00:00+05:30');
const docsFrom = async (issuer: string, map: Record<string, string>, anns: AnnouncementLite[], relation: 'current' | 'history' = 'current') =>
  readIndiaDocuments(issuer, anns.filter((a) => map[a.url]), async (u) => (map[u] ? txt(map[u]) : ''), { relation });
const find = (ticker: string, anns: AnnouncementLite[], docs: DocRead[] | null, extra: Partial<Parameters<typeof buildFinding>[0]> = {}) =>
  buildFinding({ ticker, company: ticker, market: 'IN', movePct: 6, marketCap: 2000, turnover: 40, announcements: anns, returns: null, holding: false, sources: ['BSE corporate announcements'], sourceFailed: false, windowDays: 21, now: NOW, sessionCloseIso: '2026-09-24T15:30:00+05:30', docs, ...extra });

// zzz789 (intentional change): favourable legal outcomes (appeal allowed / demand reduced) re-classify stored findings.
test('rules version bumped (zzz789 supersedes zzz785 / zzz787)', () => { assert.equal(RULES_VERSION, '2026-09-24.zzz789'); });

describe('money and tax words in a PDF text layer (the ₹ sign is usually lost)', () => {
  test('crore / full-rupee / lakh forms; counts are not money', () => {
    assert.equal(moneyCr('secured a new order aggregating approximately 153.76 Crore exclusive of GST'), 153.76);
    assert.equal(moneyCr('Tax demand raised - Rs. 5,34,45,785/- Penalty'), 5.344579);
    assert.equal(moneyCr('a total fine of Rs. 96,760 per exchange'), 0.009676);
    assert.equal(moneyCr('Rs.177.35 Crores (Incl. Taxes)'), 177.35);
    assert.equal(moneyCr('up to 37 crore equity shares'), null);
    assert.equal(moneyCr('for up to 20 lakh users'), null);
    assert.equal(moneyCr('Vikran Engineering secures Rs 153-cr order from POWERGRID'), 153);
  });
  test('"exclusive of GST" on an order is not a tax matter; a GST show-cause notice is', () => {
    assert.equal(isTaxMatter('secured a new order aggregating 153.76 Crore exclusive of GST from POWERGRID'), false);
    assert.equal(isTaxMatter('received a Demand Cum Show Cause Notice in Form GST DRC-01'), true);
  });
});

describe('VIKRAN — a GST notice and a ₹153.76 Cr POWERGRID order in the same window: both extracted, neither hides the other', () => {
  const ORDER = B('ceee1a58-fb2d-4d45-aca0-8adb6ff98ec3'), GST = B('98ef3f2b-0b54-4f40-9384-6724175b304c'), ITAT = B('2a09f38c-24c9-4218-a2c9-81186389a1d0');
  const anns: AnnouncementLite[] = [
    { subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Vikran won ₹153.76 crore POWERGRID order for Tumkur-II 400 kV AIS substation extension, executable in 21 months.', url: ORDER, dateIso: '2026-09-23T18:10:00+05:30', ageDays: null },
    { subject: 'Disclosure Of Information Under Regulation 30 Of The SEBI (LODR) Regulations, 2015', summary: 'Vikran Engineering received GST SCN for FY23, demanding Rs. 5.34 crore tax and Rs. 53.44 lakh penalty.', url: GST, dateIso: '2026-09-23T16:59:59+05:30', ageDays: null },
    { subject: 'Disclosure Of Information Under Regulation 30 Of The SEBI(LODR) Regulations, 2015', summary: 'ITAT Mumbai rules for Vikran Engineering, deleting ₹3.97 crore demand and ₹6.80 crore addition for AY 2016-17.', url: ITAT, dateIso: '2026-09-22T19:00:00+05:30', ageDays: null },
    { subject: 'Announcement under Regulation 30 (LODR)-Amendments to Memorandum & Articles of Association', summary: 'Members approved MOA object clause expansion.', url: B('9a1e00f4-bb70-4266-92a9-b5c1c4bbcf9b'), dateIso: '2026-09-19T12:00:00+05:30', ageDays: null },
  ];
  test('order: value, customer, package, execution period, verified quotes', () => {
    const f = one('vikran-order.txt', 'VIKRAN');
    assert.equal(f.event.kind, 'order');
    assert.equal(f.polarity, 'positive');
    assert.equal(f.economics.valueNative, 153.76);
    assert.match(f.event.counterparty || '', /Power Grid Corporation of India Limited/);
    assert.match(f.event.product || '', /400 kV AIS Extension Substation Package SS-136T/);
    assert.match(f.time.executionPeriod || '', /^21 months/);
    assert.ok(f.quotes.length >= 1);
    for (const q of f.quotes) assert.ok(quoteIsInDocument(txt('vikran-order.txt'), q), q);
  });
  test('GST notice: negative tax matter with the stated ₹ amount; the ITAT ruling is in the company\'s favour', () => {
    const g = one('vikran-gst.txt', 'VIKRAN');
    assert.equal(g.event.kind, 'tax_litigation');
    assert.equal(g.polarity, 'negative');
    assert.equal(Math.round(g.economics.valueNative! * 100) / 100, 5.34);
    const i = one('vikran-itat.txt', 'VIKRAN');
    assert.equal(i.event.kind, 'tax_litigation');
    assert.equal(i.polarity, 'positive');
    assert.equal(i.event.stage, 'COMPLETED');
  });
  test('the finding leads with the order; the GST notice is a note and a negative structured fact', async () => {
    const docs = await docsFrom('VIKRAN', { [ORDER]: 'vikran-order.txt', [GST]: 'vikran-gst.txt', [ITAT]: 'vikran-itat.txt' }, anns);
    const f = find('VIKRAN', anns, docs);
    assert.equal(f.status, 'catalyst');
    assert.equal(f.category, 'order_win');
    assert.equal(f.valueStated, 153.76);
    assert.ok(f.evidenceQuote && quoteIsInDocument(txt('vikran-order.txt'), f.evidenceQuote));
    assert.equal(f.evidenceGap, null);
    const sf = (f.structuredFacts || []) as IndiaFacts[];
    assert.ok(sf.some((x) => x.event.kind === 'order' && x.polarity === 'positive' && x.economics.valueNative === 153.76));
    assert.ok(sf.some((x) => x.event.kind === 'tax_litigation' && x.polarity === 'negative' && Math.round(x.economics.valueNative! * 100) === 534));
    assert.ok(f.notes.some((n) => /Also filed in the window \(negative/.test(n) && /GST/.test(n)));
    // the favourable ITAT ruling is not listed as bad news
    assert.ok(!f.notes.some((n) => /Also filed[^:]*: ITAT/.test(n)));
    assert.deepEqual(f.evidenceBreadth, { documents: 3, sourceKinds: 1, eventKinds: 2 });
  });
  test('even with no document read, a tax notice no longer hides an order filed beside it', () => {
    const f = find('VIKRAN', anns, null);
    assert.equal(f.status, 'catalyst');
    assert.equal(f.category, 'order_win');
    assert.equal(f.evidenceGap, 'EVIDENCE_INCOMPLETE');
  });
});

describe('RAYMOND — aerospace chain: subsidiary attribution + the older related filing, nothing invented', () => {
  const NEW = B('583c6b13-f125-445c-abec-f5dc23e7105f'), OLD = B('6ccfd83b-184a-4a5a-9be3-2e6eddaf4f11');
  test('23 Sep press release: order won by the subsidiary JK Maini Global Aerospace; value, duration not stated', () => {
    const f = one('raymond-2026-09-23.txt', 'RAYMOND');
    assert.equal(f.event.kind, 'order');
    assert.equal(f.source.kind, 'SUBSIDIARY_FILING');
    assert.equal(f.source.issuer, 'RAYMOND');
    assert.equal(f.attribution?.entity, 'JK Maini Global Aerospace Limited');
    assert.match(f.event.product || '', /wing structures and centre fuselage structures/);
    assert.match(f.event.counterparty || '', /not named/);
    assert.equal(f.economics.valueNative, null);
    assert.equal(f.time.executionPeriod, null);
    assert.ok(f.unknowns.some((u) => /Order value not stated/.test(u)));
    assert.ok(f.unknowns.some((u) => /Execution period not stated/.test(u)));
    // the ₹52,000 Cr GDV in the "About Raymond Realty" paragraph is not the order
    assert.notEqual(f.economics.valueNative, 52000);
  });
  test('11 Sep press release: ~₹33 Cr is an annual business POTENTIAL, not an order value; scope and production timing as stated', () => {
    const f = one('raymond-2026-09-11.txt', 'RAYMOND', '2026-09-11');
    assert.equal(f.event.kind, 'order');
    assert.equal(f.economics.valueNative, null);
    assert.equal(f.statedPotentialNative, 33);
    assert.match(f.event.product || '', /precision machining, aerospace castings, structural components and complex assemblies/);
    assert.ok(f.time.milestones.some((m) => /Production commences progressively across 2026 and 2027/.test(m)));
    assert.ok(f.unknowns.some((u) => /business potential of about ₹33 Cr/.test(u)));
  });
  test('the older filing is found in a 365-day list by the programme words and threaded as history', async () => {
    const later = new Date('2026-10-20T12:00:00+05:30');
    const cur: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond subsidiary wins tender for wing and fuselage structures in fighter aircraft programme.', url: NEW, dateIso: '2026-10-19T17:00:00+05:30', ageDays: null }];
    const docs = await docsFrom('RAYMOND', { [NEW]: 'raymond-2026-09-23.txt' }, cur);
    const wide = [
      { subject: 'Announcement Under Regulation 30 (LODR)-Analyst / Investor Meet - Intimation', summary: 'Raymond will participate in Anand Rathi G-200 Summit.', url: B('4b07cdc5-fad0-413a-b6df-71beea110f02'), dateIso: '2026-09-16T10:00:00+05:30' },
      { subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond aerospace subsidiary wins multi-programme orders worth about ₹33 crore annually; production starts in 2026-27.', url: OLD, dateIso: '2026-09-11T17:50:13+05:30' },
      { subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond Lifestyle festive collection launch.', url: B('77777777-1111-2222-3333-444455556666'), dateIso: '2026-08-01T10:00:00+05:30' },
    ];
    const rel = relatedFilings(docs.flatMap((d) => d.facts), wide, { excludeUrls: new Set([NEW]), issuerName: 'Raymond Limited' });
    assert.deepEqual(rel.map((r) => r.url), [OLD]);
    const hist = await docsFrom('RAYMOND', { [OLD]: 'raymond-2026-09-11.txt' }, rel as AnnouncementLite[], 'history');
    const f = buildFinding({ ticker: 'RAYMOND', company: 'Raymond', market: 'IN', movePct: 6, marketCap: 12000, turnover: 40, announcements: cur, returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now: later, docs: [...docs, ...hist] });
    assert.equal(f.status, 'catalyst');
    const sf = (f.structuredFacts || []) as IndiaFacts[];
    const h = sf.find((x) => x.relation === 'history');
    assert.ok(h, 'history fact present');
    assert.equal(h!.statedPotentialNative, 33);
    assert.equal(h!.economics.valueNative, null);
    assert.ok(sf.some((x) => x.relation === 'current' && x.attribution?.entity === 'JK Maini Global Aerospace Limited'));
    assert.ok(f.notes.some((n) => /^Continues earlier filings: 2026-09-11/.test(n)));
    assert.ok((f.sourceRefs || []).some((r) => /Earlier related filing/.test(r.title) && r.access === 'DOCUMENT_READ'));
    assert.equal(f.valueStated, null, 'no invented contract value');
  });
  test('a summary\'s "₹33 crore annually" is dropped once the document calls it a potential', async () => {
    const anns: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', summary: 'Raymond aerospace subsidiary wins multi-programme orders worth about ₹33 crore annually; production starts in 2026-27.', url: OLD, dateIso: '2026-09-11T17:50:13+05:30', ageDays: null }];
    assert.equal(find('RAYMOND', anns, null).valueStated, 33);
    const f = find('RAYMOND', anns, await docsFrom('RAYMOND', { [OLD]: 'raymond-2026-09-11.txt' }, anns));
    assert.equal(f.valueStated, null);
    assert.ok(f.notes.some((n) => /POTENTIAL/.test(n)));
  });
});

describe('ZIMLAB / GLOTTIS — a subsidiary filing under a generic subject is read and attributed to the listed parent', () => {
  test('ZIMLAB "Updates on Acquisition" is a new Chile subsidiary for LATAM — new geography, enabling, no invented size', async () => {
    const url = B('031cc190-d325-4294-8481-5b829da70d34');
    const anns: AnnouncementLite[] = [{ subject: 'Announcement under Regulation 30 (LODR)-Updates on Acquisition', summary: 'ZIM Laboratories SpA incorporated in Chile on 9 September 2026 as a wholly owned subsidiary for LATAM expansion.', url, dateIso: '2026-09-18T16:00:00+05:30', ageDays: null }];
    // zzz787 (intentional change): subject + summary alone already read as a new subsidiary / geography — a strategic expansion, not 'acquisition'.
    assert.equal(find('ZIMLAB', anns, null).category, 'new_geography');
    const f = find('ZIMLAB', anns, await docsFrom('ZIMLAB', { [url]: 'zimlab-chile.txt' }, anns));
    assert.equal(f.category, 'new_geography');
    assert.equal(f.stage, 'enabling');
    assert.equal(f.valueStated, null);
    const sf = (f.structuredFacts || []) as IndiaFacts[];
    assert.equal(sf[0].source.kind, 'SUBSIDIARY_FILING');
    assert.equal(sf[0].source.issuer, 'ZIMLAB');
    assert.equal(sf[0].attribution?.entity, 'ZIM Laboratories SpA');
    assert.match(sf[0].event.geography || '', /Chile/);
    assert.ok((f.sourceRefs || []).some((r) => r.kind === 'SUBSIDIARY_FILING'));
  });
  test('GLOTTIS Malaysia subsidiary: continues an earlier disclosure', () => {
    const f = one('glottis-sub.txt', 'GLOTTIS');
    assert.equal(f.attribution?.entity, 'Glottis Logistics SDN. BHD');
    assert.equal(f.event.geography, 'Malaysia');
    assert.match(f.continues || '', /March 19, 2026/);
  });
});

describe('fundraising — materiality stays Unknown until amount, dilution, price and allottees are known', () => {
  test('KABRAEXTRU preferential: ₹141 Cr, 37,60,000 shares at ₹375, 12 allottees; dilution missing', () => {
    const f = one('kabra-pref.txt', 'KABRAEXTRU');
    assert.equal(f.event.kind, 'fundraising');
    assert.equal(f.event.stage, 'PROPOSED');
    assert.equal(f.economics.valueNative, 141);
    assert.equal(f.economics.sharesIssued, 3760000);
    assert.equal(f.economics.issuePrice, 375);
    assert.equal(f.economics.allottees.length, 12);
    assert.ok(f.economics.allottees.includes('Singularity Large Value Fund III'));
    assert.equal(f.economics.dilutionPct, null);
    assert.deepEqual(f.fundMateriality, { state: 'UNKNOWN', missing: ['dilution'] });
  });
  test('dilution is computed only from a stated share count, with its formula', () => {
    const f = one('kabra-pref.txt', 'KABRAEXTRU', '2026-09-08', { sharesOutstanding: 34_987_000 });
    assert.equal(f.economics.dilutionPct, 9.7);
    assert.match(f.economics.ratios.find((r) => r.label === 'Dilution')!.formula, /37,60,000 new shares ÷ \(/);
    assert.equal(f.fundMateriality?.state, 'KNOWN');
  });
});

describe('other QA names read from the body', () => {
  test('JAGSNPHARM: consideration cap ₹46.7 Cr vs FY26 turnover ₹24.6 Cr, ratio with formula; completion date', () => {
    const f = one('jagsn-bta.txt', 'JAGSNPHARM');
    assert.equal(f.event.kind, 'acquisition');
    assert.equal(f.event.stage, 'SIGNED');
    assert.equal(f.economics.considerationNative, 46.7);
    assert.equal(f.economics.targetRevenueNative, 24.6);
    assert.deepEqual(f.economics.ratios[0], { label: 'Consideration ÷ target turnover', value: 1.9, formula: '₹46.7 Cr ÷ ₹24.6 Cr' });
    assert.match(f.time.expectedCompletion || '', /01 November, 2026/);
  });
  test('JAMNAAUTO: the confirmed demand (₹3.53 Cr), not the original one; company will appeal', () => {
    const f = one('jamna-gst.txt', 'JAMNAAUTO');
    assert.equal(f.polarity, 'negative');
    assert.equal(Math.round(f.economics.valueNative! * 100) / 100, 3.53);
    assert.ok(f.time.milestones.some((m) => /appeal/.test(m)));
  });
  test('AVANTEL: ₹177.35 Cr Zetwerk PO incl. taxes, by March 2027; a letterhead "AS 9100D" is not an approval', () => {
    const f = one('avantel-po.txt', 'AVANTEL');
    assert.equal(f.event.kind, 'order');
    assert.equal(f.economics.valueNative, 177.35);
    assert.equal(f.event.counterparty, 'Zetwerk Manufacturing Businesses Limited');
    assert.equal(f.time.executionPeriod, 'March 2027');
    assert.match(f.continues || '', /March 25, 2026/);
    assert.ok(f.unknowns.some((u) => /includes taxes/.test(u)));
  });
  test('ABDL: ₹115 Cr malt distillery via subsidiary MAILLP, ~3 MN BL/year by Q3 FY2028; licence for ~4.4 million BL', () => {
    const c = one('abdl-capex.txt', 'ABDL');
    assert.equal(c.event.kind, 'capacity');
    assert.equal(c.economics.capex, 115);
    assert.match(c.economics.capacityAfter || '', /3 MN BL per year/);
    assert.equal(c.time.expectedCompletion, 'Q3 FY 2028');
    assert.equal(c.attribution?.entity, 'Minakshi Agro Industries LLP');
    const l = one('abdl-licence.txt', 'ABDL');
    assert.equal(l.event.kind, 'qualification');
    assert.match(l.economics.capacityAfter || '', /4\.4 million BL per annum/);
    assert.equal(l.event.geography, 'Telangana');
  });
  test('KABRAEXTRU: BESS commissioned (10 MW/20 MWh); the board plan is approved, not built', () => {
    const b = one('kabra-bess.txt', 'KABRAEXTRU');
    assert.equal(b.event.stage, 'COMMISSIONED');
    assert.equal(b.economics.capacityAfter, '10 MW/20 MWh');
    const p = one('kabra-board.txt', 'KABRAEXTRU');
    assert.equal(p.event.kind, 'capacity');
    assert.equal(p.economics.capex, 500);
    assert.notEqual(p.event.stage, 'COMMISSIONED');
  });
});

describe('the unclassified names: classified from the body; three evidence gaps kept apart', () => {
  test('DCMSIL "Board comments on fine levied" → a ₹96,760 exchange fine, paid and closed', async () => {
    const url = B('c88726a2-5c33-4328-9e68-df9d1ac39777');
    const anns: AnnouncementLite[] = [{ subject: 'Board Comments On Fine Levied By The Exchanges', summary: 'Board noted 41-day delay under Regulation 17(1A); Rs. 96,760 fine per exchange paid and matter closed.', url, dateIso: '2026-09-12T22:57:59+05:30', ageDays: null }];
    const before = find('DCMSIL', anns, null);
    assert.equal(before.status, 'routine_only');
    assert.equal(before.evidenceGap, 'EVIDENCE_INCOMPLETE');
    const f = find('DCMSIL', anns, await docsFrom('DCMSIL', { [url]: 'dcmsil-fine.txt' }, anns));
    assert.equal(f.status, 'negative');
    assert.equal(f.valueStated, 0.009676);
    assert.equal(f.evidenceGap, null);
  });
  test('CRIZAC "Update to earlier disclosure" → Edument stake revised to ₹1.24 Cr / 36.8%', async () => {
    const url = B('6ee566a4-21aa-4729-a060-552b19205771');
    const anns: AnnouncementLite[] = [{ subject: 'Intimation Under Regulation 30 Of SEBI (LODR) Regulations, 2015 - Update To Earlier Disclosure', summary: 'On 17 Sep 2026, Crizac revised Edument investment to ₹1.237 crore after 107 CCPS withdrawal.', url, dateIso: '2026-09-17T15:19:45+05:30', ageDays: null }];
    const f = find('CRIZAC', anns, await docsFrom('CRIZAC', { [url]: 'crizac-edument.txt' }, anns));
    assert.equal(f.status, 'catalyst');
    const x = (f.structuredFacts as IndiaFacts[])[0];
    assert.equal(x.economics.stakePct, 36.8);
    assert.equal(Math.round(x.economics.considerationNative! * 1000) / 1000, 1.237);
    assert.match(x.continues || '', /June 15, 2026/);
  });
  test('SOUTHBANK branch openings read as routine → NO_CATALYST, not UNCLASSIFIED', async () => {
    const url = B('d43c3834-5e61-493f-87d5-35435ab6f8de');
    const anns: AnnouncementLite[] = [{ subject: 'Opening Of New Branch - Intimation Under Regulation 30 Of SEBI (LODR) Regulations, 2015', summary: 'South Indian Bank opens Vridhachalam branch in Tamil Nadu on 23 September 2026.', url, dateIso: '2026-09-23T12:45:01+05:30', ageDays: null }];
    assert.equal(find('SOUTHBANK', anns, null).evidenceGap, 'EVIDENCE_INCOMPLETE');
    const f = find('SOUTHBANK', anns, await docsFrom('SOUTHBANK', { [url]: 'southbank-branch.txt' }, anns));
    assert.equal(f.status, 'routine_only');
    assert.equal(f.evidenceGap, 'NO_CATALYST');
  });
  test('a filing read in full that names no known event stays UNCLASSIFIED (never "nothing")', async () => {
    const url = B('abababab-1111-2222-3333-444455556666');
    const body = 'Dear Sir/Madam, pursuant to Regulation 30 we enclose the information. '.repeat(3) + 'The Company wishes to inform stakeholders about a matter described in the enclosed annexure which has no quantified effect at this stage and is placed on record for completeness of disclosure.';
    const anns: AnnouncementLite[] = [{ subject: 'General Updates', summary: null, url, dateIso: '2026-09-22T10:00:00+05:30', ageDays: null }];
    const docs = await readIndiaDocuments('XYZ', anns, async () => body);
    const f = find('XYZ', anns, docs);
    assert.equal(f.status, 'routine_only');
    assert.equal(f.evidenceGap, 'UNCLASSIFIED');
    assert.match(f.headline || '', /could not be classified even after reading/);
    assert.equal(find('XYZ', [], null).evidenceGap, 'NO_CATALYST');
  });
});

describe('documents: chosen within a budget, each read once, never double counted', () => {
  test('choose: top candidate, then generic / unclassified, then other substantive — at most 3', () => {
    const mk = (u: string, subject: string, summary: string | null) => classifyAnnouncement({ subject, summary, url: u, dateIso: '2026-09-22T10:00:00+05:30', ageDays: 2 }, 'IN');
    const list = [mk(B('a1a1a1a1a1a1a1a1a1'), 'Newspaper Publication', 'ad'), mk(B('b2b2b2b2b2b2b2b2b2'), 'General Updates', null), mk(B('c3c3c3c3c3c3c3c3c3'), 'Receipt of order', 'Received ₹50 crore order from NTPC'), mk(B('d4d4d4d4d4d4d4d4d4'), 'Press Release', 'Plant commissioned at Pune'), mk(B('e5e5e5e5e5e5e5e5e5'), 'Updates', null)];
    const picks = chooseDocuments(list, B('c3c3c3c3c3c3c3c3c3'));
    assert.equal(picks.length, 3);
    assert.equal(picks[0].url, B('c3c3c3c3c3c3c3c3c3'));
    assert.ok(!picks.some((p) => /a1a1/.test(p.url)));
    assert.ok(isGenericSubject('Announcement under Regulation 30 (LODR)-General Updates'));
    assert.ok(isGenericSubject('Disclosure Of Information Under Regulation 30 Of The SEBI (LODR) Regulations, 2015'));
    assert.equal(docSeqOf(B('ceee1a58-fb2d-4d45-aca0-8adb6ff98ec3')), 'ceee1a58-fb2d-4d45-aca0-8adb6ff98ec3');
  });
  test('cache: the same document is fetched once; the same text under two URLs counts once', async () => {
    let calls = 0;
    const u1 = B('11112222333344445555aaaa'), u2 = 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/99998888777766665555.pdf';
    const fetch = async () => { calls++; return txt('avantel-po.txt'); };
    const anns = [{ url: u1, subject: 'Receipt of order', dateIso: '2026-09-23' }, { url: u2, subject: 'Receipt of order', dateIso: '2026-09-23' }];
    const a = await readIndiaDocuments('AVANTELX', anns, fetch);
    const b = await readIndiaDocuments('AVANTELX', anns, fetch);
    assert.equal(calls, 2, 'each URL fetched once across both sweeps (memory cache)');
    assert.equal(a.length, 1);
    assert.deepEqual(a[0].sameAs, [u2]);
    assert.equal(b.length, 1);
    assert.equal(a[0].hash, textHash(txt('avantel-po.txt')));
    const br = evidenceBreadthOf(a[0].facts, [{ kind: 'EXCHANGE_FILING', access: 'DOCUMENT_READ', issuer: 'X', date: null, url: u1, title: 't', hash: a[0].hash }, { kind: 'EXCHANGE_FILING', access: 'DOCUMENT_READ', issuer: 'X', date: null, url: u2, title: 't', hash: a[0].hash }]);
    assert.deepEqual(br, { documents: 1, sourceKinds: 1, eventKinds: 1 });
  });
  test('a failed fetch is not cached and not a document', async () => {
    const r = await readIndiaDocuments('FAILX', [{ url: B('f0f0f0f0f0f0f0f0f0f0'), subject: 'General Updates', dateIso: '2026-09-20' }], async () => '');
    assert.equal(r[0].access, 'SOURCE_UNAVAILABLE');
    const f = find('FAILX', [{ subject: 'General Updates', summary: null, url: B('f0f0f0f0f0f0f0f0f0f0'), dateIso: '2026-09-20T10:00:00+05:30', ageDays: null }], r);
    assert.equal(f.evidenceGap, 'EVIDENCE_INCOMPLETE');
    assert.ok(f.notes.some((n) => /could not be opened/.test(n)));
  });
  test('stored inputs keep the read documents: a re-score rebuilds the same finding with no fetch', async () => {
    const ORDER = B('ceee1a58-fb2d-4d45-aca0-8adb6ff98ec3');
    const anns: AnnouncementLite[] = [{ subject: 'Press Release / Media Release', summary: 'Vikran won ₹153.76 crore POWERGRID order.', url: ORDER, dateIso: '2026-09-23T18:10:00+05:30', ageDays: null }];
    const docs = await docsFrom('VIKRAN', { [ORDER]: 'vikran-order.txt' }, anns);
    const stored = compactInputs({ announcements: anns, returns: null, marketCap: 2000, turnover: 40, sources: ['x'], sourceFailed: false, fetchedAt: NOW.toISOString(), docs }, 21, NOW);
    const f = rescoreFromInputs(JSON.parse(JSON.stringify(stored)), { ticker: 'VIKRAN', company: 'Vikran', market: 'IN', movePct: 6, holding: false, windowDays: 21 });
    assert.equal(f.status, 'catalyst');
    assert.ok(f.evidenceQuote);
    assert.ok((f.structuredFacts || []).length >= 1);
  });
});

describe('press is secondary; an official filing of the same event confirms it', () => {
  test('VIKRAN headlines: order and GST items confirmed by the read filings; all verification-required', () => {
    const news = buildNewsContext([
      { title: 'Vikran Engineering Secures INR 153.76 Crore POWERGRID Order - Business Standard', url: 'https://example.com/1', published_at: '2026-09-23T20:00:00Z' },
      { title: 'Vikran Engineering receives ₹5.34 Cr GST demand notice for FY23 - Moneycontrol', url: 'https://example.com/2', published_at: '2026-09-23T21:00:00Z' },
      { title: 'Vikran Engineering to set up a new plant in Odisha - Some Blog', url: 'https://example.com/3', published_at: '2026-09-10T21:00:00Z' },
    ], { ticker: 'VIKRAN', company: 'Vikran Engineering', now: NOW });
    const official = [one('vikran-order.txt', 'VIKRAN'), one('vikran-gst.txt', 'VIKRAN')];
    const p = pressFacts(news, 'VIKRAN', official);
    assert.ok(p.facts.every((f) => f.source.kind === 'PRESS' && f.verificationRequired && f.secondary));
    const order = p.facts.find((f) => f.event.kind === 'order')!;
    assert.equal(order.economics.valueNative, 153.76);
    assert.ok(order.confirmedBy, 'order press confirmed by the filing');
    const gst = p.facts.find((f) => f.event.kind === 'tax_litigation')!;
    assert.ok(gst.confirmedBy);
    assert.equal(gst.polarity, 'negative');
    const plant = p.facts.find((f) => f.event.kind === 'capacity')!;
    assert.equal(plant.confirmedBy, null);
    assert.ok(p.news.items.every((i) => i.secondary === true));
  });
  test('ZIMLAB: a press story of the Chile subsidiary is confirmed by the read filing', () => {
    const news = buildNewsContext([{ title: 'Zim Laboratories incorporates Chile subsidiary for LATAM expansion - ET Pharma', url: 'https://example.com/z', published_at: '2026-09-19T06:00:00Z' }], { ticker: 'ZIMLAB', company: 'Zim Laboratories', now: NOW });
    const p = pressFacts(news, 'ZIMLAB', [one('zimlab-chile.txt', 'ZIMLAB', '2026-09-18')]);
    assert.equal(p.facts[0].event.kind, 'strategic_expansion');   // zzz787: a new subsidiary is a strategic expansion (was 'other')
    assert.ok(p.facts[0].confirmedBy);
    // press adds a source kind, never an event kind
    assert.deepEqual(evidenceBreadthOf([one('zimlab-chile.txt', 'ZIMLAB', '2026-09-18'), ...p.facts], p.refs), { documents: 1, sourceKinds: 2, eventKinds: 1 });
  });
});

describe('Screener is secondary: failure never breaks research', () => {
  test('NSE fallback rows parse; IST dates carry +05:30', () => {
    assert.equal(nseDateIso('24-Sep-2026 17:52:39'), '2026-09-24T17:52:39+05:30');
    const rows = parseNseAnnouncements([
      { desc: 'Award of Order / Receipt of Order', attchmntText: 'Received order worth Rs 25 crore from BHEL', an_dt: '23-Sep-2026 10:00:00', attchmntFile: 'https://nsearchives.nseindia.com/corporate/X_23092026.pdf' },
      { desc: 'Old', attchmntText: '', an_dt: '01-Jan-2026 10:00:00', attchmntFile: 'https://nsearchives.nseindia.com/corporate/old.pdf' },
      { desc: 'No file', an_dt: '23-Sep-2026 10:00:00' },
    ], 22, NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].summary, 'Received order worth Rs 25 crore from BHEL');
  });
  test('a finding built with the exchange list labels screener "secondary source unavailable"', () => {
    const anns: AnnouncementLite[] = [{ subject: 'Receipt of order', summary: 'Received ₹25 crore order from BHEL', url: B('12121212121212121212'), dateIso: '2026-09-23T10:00:00+05:30', ageDays: null }];
    const f = find('NSEONLY', anns, null, { secondaryUnavailable: 'screener.in company page (HTTP 429)', sources: ['BSE corporate announcements'] });
    assert.equal(f.status, 'catalyst');
    assert.ok((f.sourceRefs || []).some((r) => r.access === 'SECONDARY_UNAVAILABLE'));
    assert.ok(f.notes.some((n) => /^Secondary source unavailable/.test(n)));
    assert.ok(!f.notes.some((n) => /^The filing source could not be reached/.test(n)));
  });
});
