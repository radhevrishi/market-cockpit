// zzz856 — Special Situations verification: primary-document locator, throughput (tier / recency order, dedupe, time budget),
// primary-verified without AI (company wire releases, exchange announcements with terms), verification block (next run, queue,
// located vs none).
// Run: npx tsx --test src/lib/__tests__/zzz856-ss-verify.test.ts
// No network: KV, the locator I/O, the document fetcher and the model are injected fakes. Company names are synthetic.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  sameCompany, nameInText, subjectScore, kindFamily, secIndexUrl, locateIndia, locateUsFromSubmissions, locateDocs, filingCompanyMatch, edgarFormScore,
  type ExchangeFiling, type EdgarCompany, type LocateIo,
} from '../ai-verify-locator';
import {
  specSitToClaim, isSpecSitPrimaryVerified, hasStatedTerms, partitionByVerification, isLocatedPrimaryVerified, specSitSecIndexUrl, tierRankOf, isCompanyReleaseItem,
} from '../ai-verify-gate';
import {
  runVerification, mergeQueue, dedupeQueueItems, compareQueueItems, priorityOf, QUEUE_KEY, QUEUE_META_KEY, verdictKey, locatedKey, readQueue, clearVerdictMemo, clearLocatedMemo,
  nextCronRun, AI_VERIFY_SCHEDULE, runMaxClaims, runMaxUsd, gateList, gateSpecialSituations, type KvIo, type VerifyDeps, type QueueItem,
} from '../ai-verify';
import type { LocatedDoc, VerifyClaim } from '../ai-verify-types';

// ── fakes ───────────────────────────────────────────────────────────────────

function fakeKv(): KvIo & { store: Map<string, { v: any; ttl?: number }> } {
  const store = new Map<string, { v: any; ttl?: number }>();
  const clone = (v: any) => JSON.parse(JSON.stringify(v));
  return {
    store,
    get: async (k) => (store.has(k) ? clone(store.get(k)!.v) : null),
    set: async (k, v, ttl) => { store.set(k, { v: clone(v), ttl }); },
    mget: async (keys) => keys.map((k) => (store.has(k) ? clone(store.get(k)!.v) : null)),
    setNX: async (k, v, ttl) => { if (store.has(k)) return false; store.set(k, { v, ttl }); return true; },
    del: async (k) => { store.delete(k); },
  };
}

const NOW = new Date('2026-10-01T12:00:00Z');
const LATER = new Date('2026-10-06T12:00:00Z');
const EV_DATE = '2026-09-29T06:00:00.000Z';

/** India media story about a synthetic company (no company document attached). */
const inEvent = (id: string, o: Record<string, any> = {}) => ({
  event_id: id, event_type: o.event_type || 'ACQUISITION_PUBLIC', region: 'IN', tier: o.tier || 'TIER_2', tickers: o.tickers ?? ['ZEPHYRCHEM'],
  target_name: o.target_name ?? 'Zephyr Chemicals',
  primary_filing: { title: o.title || 'Zephyr Chemicals to acquire Orbit Polymers for ₹420 crore', link: 'https://economictimes.indiatimes.com/x.cms', source: 'ET Markets', pub_date: o.pub_date || EV_DATE, description: o.description || '' },
  filings: [],
});
const usEvent = (id: string, o: Record<string, any> = {}) => ({
  event_id: id, event_type: o.event_type || 'TENDER_OFFER', region: 'US', tier: o.tier || 'TIER_2', tickers: o.tickers ?? ['QSYN'],
  target_name: o.target_name ?? 'Quasar Synthetics',
  primary_filing: { title: o.title || 'Quasar Synthetics (NASDAQ: QSYN) receives tender offer', link: 'https://www.marketwatch.com/story/x', source: 'MarketWatch Top', pub_date: o.pub_date || EV_DATE, description: o.description || '' },
  filings: [],
});
const filing = (o: Partial<ExchangeFiling> = {}): ExchangeFiling => ({
  exchange: 'NSE', symbol: 'ZEPHYRCHEM', company_name: 'Zephyr Chemicals Limited', subject: 'Acquisition', detail: 'Acquisition of 100% stake in Orbit Polymers Private Limited for a consideration of Rs 420 crore',
  filing_datetime: '2026-09-29T10:00:00.000Z', attachment_urls: ['https://nsearchives.nseindia.com/corporate/ZEPHYR_29092026.pdf'], ...o,
});
const SPREAD: ExchangeFiling[] = [   // coverage: 2026-09-20 .. 2026-10-01
  filing({ symbol: 'OTHERCO', company_name: 'Other Co Ltd', subject: 'Trading Window', filing_datetime: '2026-09-20T05:00:00Z' }),
  filing({ symbol: 'OTHERCO', company_name: 'Other Co Ltd', subject: 'Trading Window', filing_datetime: '2026-10-01T05:00:00Z' }),
];

beforeEach(() => { clearVerdictMemo(); clearLocatedMemo(); });

// ── 1. company matching: never a different company ─────────────────────────
describe('1 company matching', () => {
  test('same company only when names differ by corporate / group / sector words', () => {
    assert.ok(sameCompany('Zephyr', 'Zephyr Limited'));
    assert.ok(sameCompany('Zephyr Chemicals', 'ZEPHYR CHEMICALS LTD.'));
    assert.ok(sameCompany('Orbit', 'Orbit India Limited'), 'a sector / country word may differ');
    assert.equal(sameCompany('Zephyr', 'Zephyr Hotels Ltd'), false, 'a different listed company of the same group');
    assert.equal(sameCompany('Zephyr Hotels', 'Zephyr Ltd'), false);
    assert.equal(sameCompany('Tata', 'Tata Motors'), false, 'a group word alone never matches');
    assert.equal(sameCompany('Tata Motors', 'Tata Steel'), false);
    assert.equal(sameCompany('', 'Zephyr'), false);
  });
  test('a name the event gives must be in the event text', () => {
    assert.ok(nameInText('Zephyr Chemicals', 'Zephyr Chemicals to acquire Orbit Polymers'));
    assert.equal(nameInText('Orbit Polymers Ltd', 'Zephyr Chemicals to acquire a rival'), false);
  });
  test('filing belongs to the event only by its symbol or its own name', () => {
    const h = { tickers: ['ZEPHYRCHEM'], names: ['Zephyr Chemicals'], text: 'Zephyr Chemicals to acquire Orbit Polymers', eventType: 'ACQUISITION_PUBLIC', region: 'IN' as const };
    assert.match(filingCompanyMatch(filing(), h)!, /NSE symbol ZEPHYRCHEM/);
    assert.match(filingCompanyMatch(filing({ exchange: 'BSE', symbol: '543210' }), h)!, /company name/);
    assert.equal(filingCompanyMatch(filing({ symbol: 'ZEPHYRHOT', company_name: 'Zephyr Hotels Limited' }), h), null);
    assert.equal(filingCompanyMatch(filing({ exchange: 'BSE', symbol: '500001', company_name: 'Zephyr Hotels Limited' }), h), null);
  });
  test('subject relevance: kind-matching subject scores 3, generic Regulation 30 scores 1, routine filings 0', () => {
    assert.equal(subjectScore('Acquisition of stake', 'ACQUISITION_PUBLIC'), 3);
    assert.equal(subjectScore('Buyback of equity shares', 'BUYBACK_TENDER'), 3);
    assert.equal(subjectScore('Press Release', 'ACQUISITION_PUBLIC'), 1);
    assert.equal(subjectScore('Closure of Trading Window', 'ACQUISITION_PUBLIC'), 0);
    assert.equal(subjectScore('Analysts/Institutional Investor Meet/Con. Call Updates', 'ACQUISITION_PUBLIC'), 0);
    assert.equal(kindFamily('DEMERGER_INDIA'), 'SPIN');
  });
});

// ── 2. India: exchange announcement by symbol / name + date window ─────────
describe('2 India locator', () => {
  test('matched by NSE symbol within ±3 days, with the PDF attachment', () => {
    const c = specSitToClaim(inEvent('i1'))!;
    const r = locateIndia(c, [...SPREAD, filing()], NOW)!;
    assert.equal(r.found, true);
    assert.equal(r.how, 'exchange_announcement');
    assert.equal(r.url, 'https://nsearchives.nseindia.com/corporate/ZEPHYR_29092026.pdf');
    assert.match(r.detail, /matched on NSE symbol ZEPHYRCHEM/);
    assert.equal(r.kindMatch, true);
  });
  test('a filing of a different company on the same day is never attached', () => {
    const c = specSitToClaim(inEvent('i2'))!;
    // (a week later: the ±3-day window is closed, so "none" is final rather than "search again")
    const r = locateIndia(c, [...SPREAD, filing({ symbol: 'ZEPHYRHOT', company_name: 'Zephyr Hotels Limited' })], LATER)!;
    assert.equal(r.found, false);
    assert.match(r.detail, /Searched 3 NSE \/ BSE announcements/);
  });
  test('outside the ±3-day window, without an attachment, or a routine subject → not attached', () => {
    const c = specSitToClaim(inEvent('i3'))!;
    for (const f of [filing({ filing_datetime: '2026-09-24T10:00:00Z' }), filing({ attachment_urls: [] }), filing({ attachment_urls: ['https://evil.example.com/a.pdf'] }), filing({ subject: 'Closure of Trading Window', detail: '' })]) {
      assert.equal(locateIndia(c, [...SPREAD, f], LATER)!.found, false, JSON.stringify(f).slice(0, 80));
    }
  });
  test('filing data that does not reach the event yet → null (search again later, not "none")', () => {
    const recent = { ...inEvent('i4', { pub_date: '2026-10-01T06:00:00Z' }) };
    const c = specSitToClaim(recent)!;
    assert.equal(locateIndia(c, [filing({ symbol: 'X', filing_datetime: '2026-09-25T00:00:00Z' })], NOW), null);
  });
  test('event older than the filings we hold → none, with the reason', () => {
    const c = specSitToClaim(inEvent('i5', { pub_date: '2026-08-01T06:00:00Z' }))!;
    const r = locateIndia(c, SPREAD, NOW)!;
    assert.equal(r.found, false);
    assert.match(r.detail, /start 2026-09-20, after this event/);
  });
});

// ── 3. US: EDGAR filings by CIK ────────────────────────────────────────────
const edgarCo = (o: Partial<EdgarCompany> = {}): EdgarCompany => ({
  cik: 1234567, name: 'Quasar Synthetics Inc', tickers: ['QSYN'],
  recent: [
    { form: '8-K', filingDate: '2026-09-29', items: ['5.02'], accession: '0001234567-26-000010' },
    { form: 'SC 14D9', filingDate: '2026-09-30', items: [], accession: '0001234567-26-000011' },
    { form: '10-Q', filingDate: '2026-08-05', items: [], accession: '0001234567-26-000005' },
  ], ...o,
});
describe('3 US locator', () => {
  test('SEC filing index built from accession + CIK only when both are well formed', () => {
    assert.equal(secIndexUrl('0001234567', '0001234567-26-000011'), 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/0001234567-26-000011-index.htm');
    assert.equal(secIndexUrl(null, '0001234567-26-000011'), null);
    assert.equal(secIndexUrl('123', 'bad'), null);
  });
  test('company named in the event + fitting form within the window → that filing', () => {
    const c = specSitToClaim(usEvent('u1'))!;
    const r = locateUsFromSubmissions(c, edgarCo(), 'QSYN', NOW);
    assert.equal(r.found, true);
    assert.equal(r.how, 'edgar_by_cik');
    assert.match(r.url!, /edgar\/data\/1234567\/000123456726000011\//);
    assert.match(r.detail, /SC 14D9 filed 2026-09-30/);
  });
  test('8-K with only a director item is not an event document; a 5.02-only company has none', () => {
    assert.equal(edgarFormScore('8-K', ['5.02'], 'TENDER_OFFER'), 0);
    assert.equal(edgarFormScore('8-K', ['8.01'], 'TENDER_OFFER'), 2);
    const c = specSitToClaim(usEvent('u2'))!;
    const r = locateUsFromSubmissions(c, edgarCo({ recent: [edgarCo().recent[0]] }), 'QSYN', NOW);
    assert.equal(r.found, false);
    assert.match(r.detail, /none of a fitting form/);
  });
  test('ticker maps to a company the event does not name → not used', () => {
    const c = specSitToClaim(usEvent('u3', { title: 'ON the move: chip stocks rally', target_name: '', tickers: ['ON'] }))!;
    const r = locateUsFromSubmissions(c, edgarCo({ name: 'Onward Semiconductor Corp' }), 'ON', NOW);
    assert.equal(r.found, false);
    assert.match(r.detail, /does not name that company/);
  });
  test('locateDocs: unknown SEC map / submissions → not recorded (retried); no ticker → recorded as none', async () => {
    const io = (o: Partial<LocateIo>): LocateIo => ({ indiaFilings: async () => null, cikForTicker: async () => 1234567, submissions: async () => edgarCo(), now: () => NOW, ...o });
    const a = specSitToClaim(usEvent('u4'))!; const b = specSitToClaim(usEvent('u5', { tickers: [], target_name: 'Plain Words Co', title: 'Plain Words Co gets an offer' }))!;
    const ok = await locateDocs([a, b], io({}), { deadline: Date.now() + 5_000 });
    assert.equal(ok.get(a.claimId)?.found, true);
    assert.equal(ok.get(b.claimId)?.found, false);
    assert.match(ok.get(b.claimId)!.detail, /names no US ticker/);
    const down = await locateDocs([a], io({ cikForTicker: async () => { throw new Error('SEC ticker map unavailable'); } }), { deadline: Date.now() + 5_000 });
    assert.equal(down.has(a.claimId), false, 'unknown is not "none"');
    const india = await locateDocs([specSitToClaim(inEvent('i6'))!], io({ indiaFilings: async () => null }), { deadline: Date.now() + 5_000 });
    assert.equal(india.size, 0, 'India filings not readable → not recorded');
  });
});

// ── 4. claims: SEC accession, locate hints, tier, date ─────────────────────
describe('4 claim builder', () => {
  test('SEC row link is used as is; a row without a sec.gov link gets the index from accession + CIK in its own text', () => {
    const sec = { event_id: 's1', event_type: 'TENDER_OFFER', region: 'US', tier: 'TIER_1', tickers: [], primary_filing: { title: 'SC TO-T - QUASAR SYNTHETICS INC (0001234567) (Subject)', source: 'SEC SC TO-T', link: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/0001234567-26-000011-index.htm', pub_date: EV_DATE, description: 'Filed: 2026-09-30 AccNo: 0001234567-26-000011 Size: 120 KB' }, filings: [] };
    const c1 = specSitToClaim(sec)!;
    assert.equal(c1.primaryHow, 'feed_link');
    assert.equal(c1.priorityTier, 3);
    assert.equal(c1.locateHints, null);
    const noLink = { ...sec, event_id: 's2', primary_filing: { ...sec.primary_filing, link: 'https://feeds.example.com/r/123' } };
    const c2 = specSitToClaim(noLink)!;
    assert.equal(c2.primaryHow, 'sec_accession');
    assert.equal(c2.primaryUrl, 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/0001234567-26-000011-index.htm');
    assert.equal(specSitSecIndexUrl({ primary_filing: { title: 'Acme wins order', link: 'https://x.example.com', description: 'AccNo: 0001234567-26-000011' } }), null, 'only SEC form rows');
  });
  test('media story → locate hints from the event itself; tier rank; event date', () => {
    const c = specSitToClaim(inEvent('m1', { tier: 'WATCHLIST' }))!;
    assert.equal(c.primaryUrl, null);
    assert.deepEqual(c.locateHints!.tickers, ['ZEPHYRCHEM']);
    assert.ok(c.locateHints!.names.includes('Zephyr Chemicals'));
    assert.equal(c.locateHints!.region, 'IN');
    assert.equal(c.priorityTier, 1);
    assert.equal(c.eventDate, EV_DATE);
    assert.equal(tierRankOf({ tier: 'NOISE', tier_before_hold: 'TIER_1' }), 3);
  });
});

// ── 5. primary-verified without AI ─────────────────────────────────────────
describe('5 primary-verified without AI', () => {
  test('stated terms: per-share (hyphen), "a share", stake %, crore; a clock time is not a ratio; a bonus ratio is', () => {
    assert.ok(hasStatedTerms('Offer of 42.50 per-share in cash'));
    assert.ok(hasStatedTerms('to buy 51% stake in Orbit'));
    assert.ok(hasStatedTerms('USD 45 a share'));
    assert.ok(hasStatedTerms('Rs 420 crore'));
    assert.ok(hasStatedTerms('Bonus issue in the ratio 1:1'));
    assert.equal(hasStatedTerms('Board meeting at 12:30 IST'), false);
    assert.equal(hasStatedTerms('SC TO-I - ACME INC (0000123456) (Subject)'), false);
  });
  test('a company wire release republished on another host (dateline) with terms is primary-verified; a media story is not', () => {
    const pr = { event_id: 'p1', region: 'US', primary_filing: { title: 'Quasar Synthetics announces tender offer at $18.75 per share', link: 'https://finance.yahoo.com/news/quasar-123.html', description: 'SAN JOSE, Calif., Sept. 29, 2026 (GLOBE NEWSWIRE) -- Quasar Synthetics today announced ...' }, filings: [] };
    assert.ok(isCompanyReleaseItem(pr.primary_filing));
    assert.ok(isSpecSitPrimaryVerified(pr));
    assert.equal(specSitToClaim(pr), null);
    const media = { ...pr, event_id: 'p2', primary_filing: { ...pr.primary_filing, description: 'Shares jumped after the offer, analysts said.' } };
    assert.equal(isSpecSitPrimaryVerified(media), false);
    const bare = { ...pr, event_id: 'p3', primary_filing: { ...pr.primary_filing, title: 'Quasar Synthetics announces tender offer' } };
    assert.equal(isSpecSitPrimaryVerified(bare), false, 'a release without terms still needs the AI');
  });
  test('NSE / BSE announcement items and other wire hosts count as the company document', () => {
    const nse = { event_id: 'n1', region: 'IN', primary_filing: { title: 'Acquisition of 100% stake in Orbit Polymers for Rs 420 crore', link: 'https://nsearchives.nseindia.com/corporate/Z.pdf' }, filings: [] };
    assert.ok(isSpecSitPrimaryVerified(nse));
    const nf = { event_id: 'n2', region: 'US', primary_filing: { title: 'Quasar to buy back shares at $12 per share', link: 'https://www.newsfilecorp.com/release/1/quasar' }, filings: [] };
    assert.ok(isSpecSitPrimaryVerified(nf));
  });
  test('located exchange announcement naming the event kind, stating the terms and the claimed figures → primary-verified', () => {
    const c = specSitToClaim(inEvent('l1'))!;
    const loc = locateIndia(c, [...SPREAD, filing()], NOW)!;
    assert.deepEqual(c.numbers.new, [420]);
    assert.ok(isLocatedPrimaryVerified(c, loc));
    assert.equal(isLocatedPrimaryVerified(c, { ...loc, text: 'Acquisition of 100% stake in Orbit Polymers for Rs 380 crore' }), false, 'different figure');
    assert.equal(isLocatedPrimaryVerified(c, { ...loc, text: 'Press release', kindMatch: false }), false, 'no terms / generic subject');
    assert.equal(isLocatedPrimaryVerified(c, { ...loc, how: 'edgar_by_cik' }), false, 'EDGAR index text is not read here');
  });
});

// ── 6. gate with located documents ─────────────────────────────────────────
describe('6 gate', () => {
  const ev = [inEvent('g1'), inEvent('g2', { title: 'Zephyr Chemicals to acquire Orbit Polymers', tickers: ['ZEPHYRCHEM'] }), inEvent('g3', { tickers: ['NEWCO'], target_name: 'Newco Industries', title: 'Newco Industries to merge arms' }), inEvent('g4', { tickers: ['ANOTHER'], target_name: 'Another Pharma', title: 'Another Pharma demerger plan' })];
  test('located with terms → kept (primary); located without terms → queued with a document; none → no_primary with the search; not searched → toLocate', () => {
    const cl = ev.map((e) => specSitToClaim(e)!);
    const withTerms = locateIndia(cl[0], [...SPREAD, filing()], NOW)!;
    const docNoTerms: LocatedDoc = { ...withTerms, claimId: cl[1].claimId, text: 'Acquisition', kindMatch: true };
    const none: LocatedDoc = { claimId: cl[2].claimId, found: false, url: null, how: null, detail: 'Searched 300 NSE / BSE announcements dated 2026-09-01 to 2026-10-01: none from NEWCO.', matchedName: null, filingDate: null, text: null, kindMatch: false, checkedAt: NOW.toISOString() };
    const located = new Map<string, LocatedDoc>([[cl[0].claimId, withTerms], [cl[1].claimId, docNoTerms], [cl[2].claimId, none]]);
    const g = partitionByVerification(ev, { claimOf: specSitToClaim, verdicts: new Map(), available: true, located });
    assert.deepEqual(g.kept.map((e: any) => e.event_id), ['g1']);
    assert.equal(g.stats.primaryVerified, 1);
    assert.ok(g.locatedByRef.has('g1'));
    const by = new Map(g.awaiting.map((a) => [a.refId, a]));
    assert.equal(by.get('g2')!.reason, 'queued');
    assert.equal(by.get('g2')!.primaryUrl, withTerms.url);
    assert.equal(by.get('g3')!.reason, 'no_primary');
    assert.match(by.get('g3')!.reasonText, /Searched 300 NSE/);
    assert.equal(by.get('g4')!.reason, 'queued');
    assert.match(by.get('g4')!.reasonText, /look up the company's own document/);
    assert.deepEqual(g.pending.map((c) => c.refId), ['g2'], 'located → AI queue');
    assert.deepEqual(g.toLocate.map((c) => c.refId), ['g4'], 'never searched → search queue');
    assert.deepEqual(g.stats.primaryDocument, { located: 1, none: 1, notSearchedYet: 1, byHow: { exchange_announcement: 1 } });
  });
  test('without a located map (older callers) a claim with no document stays no_primary, not queued', () => {
    const g = partitionByVerification([inEvent('g5')], { claimOf: specSitToClaim, verdicts: new Map(), available: true });
    assert.equal(g.awaiting[0].reason, 'no_primary');
    assert.equal(g.toLocate.length, 0);
  });
  test('gateList: verification block carries next run, queue size and located / none counts; to-locate claims are queued', async () => {
    const kv = fakeKv();
    await kv.set(QUEUE_META_KEY, { length: 7, withPrimary: 3, toLocate: 4, byTier: {}, updatedAt: NOW.toISOString() });
    const r = await gateSpecialSituations([inEvent('g6'), inEvent('g7', { tickers: ['ZZ'], target_name: 'Zeta Works', title: 'Zeta Works open offer' })], { kv, availability: async () => ({ available: true, reason: null, provider: 'openai', model: 'm' }), now: NOW });
    assert.equal(r.verification.queueSize, 7);
    assert.equal(r.verification.schedule, AI_VERIFY_SCHEDULE);
    assert.equal(r.verification.nextRunEta, '2026-10-01T12:35:00.000Z');
    assert.equal(r.verification.primaryDocument!.notSearchedYet, 2);
    const q = await readQueue(kv);
    assert.equal(q.items.length, 2, 'both queued for a document search');
    assert.ok(q.items.every((x) => x.claim.locateHints));
  });
});

// ── 7. queue: tier → recency, one item per event, bounded ──────────────────
describe('7 queue order', () => {
  const mk = (id: string, tier: number, date: string, refId = id): VerifyClaim => ({
    claimId: id, kind: 'special_situation', market: 'US', company: id, ticker: null, claimText: id, metric: null, numbers: { old: [], new: [] }, unit: null, period: null, basis: null,
    primaryUrl: `https://www.sec.gov/${id}`, sourceUrl: null, refId, priorityTier: tier, eventDate: date,
  });
  test('Tier 1 first, then Tier 2 (guidance counts as Tier 2), then Watchlist; newer events first within a tier', () => {
    const q = mergeQueue({ items: [], updatedAt: null }, [mk('w-new', 1, '2026-09-30'), mk('t2-old', 2, '2026-09-01'), mk('t1', 3, '2026-08-01'), mk('t2-new', 2, '2026-09-29')], NOW).queue;
    assert.deepEqual(q.items.map((x) => x.claim.claimId), ['t1', 't2-new', 't2-old', 'w-new']);
    assert.equal(priorityOf({ ...mk('g', 0, ''), priorityTier: undefined, kind: 'guidance' }), 2);
  });
  test('a re-built event (new claim id, same event) replaces its old queue item', () => {
    const q1 = mergeQueue({ items: [], updatedAt: null }, [mk('old', 2, '2026-09-29', 'ev1')], new Date('2026-10-01T10:00:00Z')).queue;
    const q2 = mergeQueue(q1, [mk('new', 2, '2026-09-29', 'ev1')], NOW).queue;
    assert.deepEqual(q2.items.map((x) => x.claim.claimId), ['new']);
    const items: QueueItem[] = [{ claim: mk('a', 2, '', 'e'), addedAt: '2026-10-01T01:00:00Z', priority: 2 }, { claim: mk('a', 2, '', 'e'), addedAt: '2026-10-01T02:00:00Z', priority: 2 }];
    assert.equal(dedupeQueueItems(items).length, 1);
    assert.ok(compareQueueItems({ claim: mk('x', 3, ''), addedAt: '', priority: 3 }, { claim: mk('y', 1, ''), addedAt: '', priority: 1 }) < 0);
  });
});

// ── 8. the run: search, verify, priority, time budget ──────────────────────
const DOC = 'Quasar Synthetics Inc. Offer to Purchase for cash all outstanding shares of common stock at $18.75 per share. The offer will expire at midnight on November 20, 2026. '.repeat(3);
function deps(kv: KvIo, o: { locate?: VerifyDeps['locate']; delayMs?: number; seen?: string[] } = {}): VerifyDeps & { calls: number } {
  const d: any = {
    calls: 0, kv,
    fetchDoc: async () => ({ text: DOC, failure: null }),
    callModel: async (req: any) => {
      d.calls++;
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      const claim = JSON.parse(req.user.split('\n')[1]);
      o.seen?.push(claim.company);
      return { ok: true, raw: { verdict: 'confirmed', old_values: [], new_values: claim.claimed_values, period: null, basis: null, quote: 'all outstanding shares of common stock at $18.75 per share', confidence: 0.9 }, costUsd: 0.002, model: 'fake' };
    },
    availability: async () => ({ available: true, reason: null, provider: 'openai', model: 'fake' }),
    now: () => NOW, nonce: () => 'n0nce', locate: o.locate,
  };
  return d;
}
describe('8 run', () => {
  test('a claim with no document gets one located, then verified; none-found leaves the queue with the search recorded; unsearched stays', async () => {
    const kv = fakeKv();
    const found = specSitToClaim(usEvent('r1', { title: 'Quasar Synthetics (NASDAQ: QSYN) receives tender offer at $18.75 per share' }))!;
    const none = specSitToClaim(usEvent('r2', { tickers: ['NOPE'], target_name: 'Nope Corp', title: 'Nope Corp tender offer' }))!;
    const later = specSitToClaim(usEvent('r3', { tickers: ['LATR'], target_name: 'Later Inc', title: 'Later Inc tender offer' }))!;
    await kv.set(QUEUE_KEY, mergeQueue({ items: [], updatedAt: null }, [found, none, later], NOW).queue);
    const locate: VerifyDeps['locate'] = async (claims) => {
      const m = new Map<string, LocatedDoc>();
      for (const c of claims) {
        if (c.claimId === found.claimId) m.set(c.claimId, locateUsFromSubmissions(c, edgarCo(), 'QSYN', NOW));
        if (c.claimId === none.claimId) m.set(c.claimId, { claimId: c.claimId, found: false, url: null, how: null, detail: 'No SEC filer for NOPE.', matchedName: null, filingDate: null, text: null, kindMatch: false, checkedAt: NOW.toISOString() });
      }
      return m;   // 'later' not searched (out of time)
    };
    const d = deps(kv, { locate });
    const run = await runVerification(d, { limit: 10 });
    assert.equal(run.located, 1);
    assert.equal(run.locateNone, 1);
    assert.equal(run.locateDeferred, 1);
    assert.equal(run.confirmed, 1, run.unavailableReason || '');
    assert.equal(d.calls, 1);
    const v = (await kv.get<any>(verdictKey(found.claimId)))!;
    assert.match(v.documentUrl, /edgar\/data\/1234567\//);
    assert.equal((await kv.get<any>(locatedKey(none.claimId)))!.found, false);
    assert.equal(kv.store.get(locatedKey(found.claimId))!.ttl! > kv.store.get(locatedKey(none.claimId))!.ttl!, true, 'none-found is retried sooner');
    const q = await readQueue(kv);
    assert.deepEqual(q.items.map((x) => x.claim.claimId), [later.claimId], 'only the unsearched claim stays queued');
    const meta = await kv.get<any>(QUEUE_META_KEY);
    assert.equal(meta.length, 1);
    assert.equal(meta.toLocate, 1);
  });
  test('higher tier is checked first; the run stops on its time budget and the rest stays queued for the next run', async () => {
    const kv = fakeKv();
    const mk = (id: string, tier: string) => specSitToClaim({ event_id: id, event_type: 'TENDER_OFFER', region: 'US', tier, tickers: [], primary_filing: { title: `SC TO-T - CO ${id} INC (0001234567) (Subject)`, source: 'SEC SC TO-T', link: `https://www.sec.gov/Archives/edgar/data/1234567/${id}.txt`, pub_date: EV_DATE }, filings: [] })!;
    const claims = [mk('w1', 'WATCHLIST'), mk('t2', 'TIER_2'), mk('t1', 'TIER_1'), mk('w2', 'WATCHLIST')];
    await kv.set(QUEUE_KEY, mergeQueue({ items: [], updatedAt: null }, claims, NOW).queue);
    const seen: string[] = [];
    const d = deps(kv, { delayMs: 300, seen });
    const run = await runVerification(d, { limit: 10, budgetMs: 1_000, concurrency: 1 });
    assert.equal(run.stoppedBy, 'time');
    assert.ok(seen.length >= 1 && seen.length < 4);
    assert.match(seen[0], /CO t1 INC/, 'Tier 1 first');
    assert.equal((await readQueue(kv)).items.length, 4 - run.checked, 'unchecked claims continue next run');
  });
  test('concurrency checks several claims at once, still under the claim limit', async () => {
    const kv = fakeKv();
    const mk = (id: string) => specSitToClaim({ event_id: id, event_type: 'TENDER_OFFER', region: 'US', tier: 'TIER_2', tickers: [], primary_filing: { title: `SC TO-T - CO ${id} INC (0001234567) (Subject)`, link: `https://www.sec.gov/Archives/edgar/data/1234567/${id}.txt`, pub_date: EV_DATE }, filings: [] })!;
    await kv.set(QUEUE_KEY, mergeQueue({ items: [], updatedAt: null }, ['a', 'b', 'c', 'd', 'e'].map(mk), NOW).queue);
    const d = deps(kv, { delayMs: 50 });
    const t = Date.now();
    const run = await runVerification(d, { limit: 4, concurrency: 4 });
    assert.equal(run.checked, 4);
    assert.equal(run.stoppedBy, 'limit');
    assert.ok(Date.now() - t < 1_000);
  });
});

// ── 9. schedule + defaults ─────────────────────────────────────────────────
describe('9 schedule and defaults', () => {
  test('per-run defaults raised to 40 claims / $0.60', () => {
    const save = { ...process.env };
    delete process.env.AI_VERIFY_RUN_MAX_CLAIMS; delete process.env.AI_VERIFY_RUN_MAX_USD;
    assert.equal(runMaxClaims(), 40);
    assert.equal(runMaxUsd(), 0.6);
    Object.assign(process.env, save);
  });
  test('next run from the cron schedule', () => {
    assert.equal(nextCronRun('35 * * * *', new Date('2026-10-01T10:40:00Z'))!.toISOString(), '2026-10-01T11:35:00.000Z');
    assert.equal(nextCronRun('35 * * * *', new Date('2026-10-01T10:34:30Z'))!.toISOString(), '2026-10-01T10:35:00.000Z');
    assert.equal(nextCronRun('0 */6 * * *', new Date('2026-10-01T07:00:00Z'))!.toISOString(), '2026-10-01T12:00:00.000Z');
    assert.equal(nextCronRun('bad', NOW), null);
  });
  test('workflow runs hourly on the schedule the pages report, repeats rounds that stopped on time, keeps the key in a header', () => {
    const wf = readFileSync(join(__dirname, '../../../../.github/workflows/ai-verify.yml'), 'utf8');
    // zzz907: the schedule runs in the app now (lib/app-scheduler.ts); the workflow stays for hand runs
    assert.ok(readFileSync(join(__dirname, '../app-scheduler.ts'), 'utf8').includes(`name: 'ai-verify', crons: ['${AI_VERIFY_SCHEDULE}']`), 'schedule in sync with AI_VERIFY_SCHEDULE');
    assert.match(AI_VERIFY_SCHEDULE, /^\d+ \* \* \* \*$/, 'hourly');
    assert.ok(wf.includes("stoppedBy') == 'time'"));
    assert.ok(wf.includes('x-cron-secret: ${CRON_SECRET}'));
    assert.ok(!/\?secret=/.test(wf));
  });
});

// ── 10. adapter: the matched company document reaches the card ─────────────
describe('10 adapter', () => {
  test('primaryDocument is passed through and counts as the primary source', async () => {
    const { eventToRadarInput } = await import('../multibagger-radar-adapter');
    const ev: any = { ...inEvent('a1'), primaryDocument: { url: 'https://nsearchives.nseindia.com/corporate/Z.pdf', how: 'exchange_announcement', detail: 'NSE announcement', filedAt: EV_DATE, primaryVerifiedFrom: 'EXCHANGE_ANNOUNCEMENT_TERMS' } };
    const inp: any = eventToRadarInput(ev);
    assert.equal(inp.primarySource, true);
    assert.equal(inp.primaryDocument.how, 'exchange_announcement');
    const plain: any = eventToRadarInput(inEvent('a2') as any);
    assert.equal(plain.primarySource, false);
    assert.equal(plain.primaryDocument, undefined);
  });
});
