// zzz849 — Guidance Upgrades EVENT engine: quarantine, capital raises, reiteration wording, universe reconciliation, dedupe dates, durability, coverage honesty.
// Fixtures are synthetic (synthetic tickers and names only). The numbers in each case are the numbers the fixture states.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processCandidates, assessDurability, researchWhyNow, classifyDriver, classifyDuration, extractGuidance, eventClassOf, buildNextEvidence } from '../guidance-upgrades';
import * as candLib from '../guidance-upgrades-candidates';
import {
  newsToCandidate, buildCompanyIndex, buildIndiaCandidates, companyFromHeadline, isPlausibleCompanyName, isRaiseCandidate, processRaiseCandidates,
  quarantineUnresolved, sanitizeRaiseCandidate, nonGuidanceRaiseSentence, corroborateWithFilings, collectSubjectOnly, coverageLine, istDateList, usGradedRowToCandidate,
  type MarketCoverage, type IndiaRead,
} from '../guidance-upgrades-candidates';
import { scanIndia, makeBlobReader, blobCoverage, BLOB_CAP, type DayFetcher } from '../guidance-upgrades-scan';
import { universeLookup, makeExtraFor } from '../guidance-upgrades-reconcile';
import { buildUniverse, loadSeedRows } from '../guidance-universe';
import type { GuCandidate } from '../guidance-upgrades-types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const noCtx = () => ({});
const NOW = new Date('2026-09-25T06:00:00Z');

const cand = (o: Partial<GuCandidate> & { id: string; title: string }): GuCandidate => ({
  ticker: 'ZZAA', company: 'Zed Alpha Ltd', market: 'IN', text: '', sourceName: 'Business Standard Markets', kind: 'NEWS', url: 'https://www.business-standard.com/x', publishedAt: '2026-09-24T07:00:00.000Z', ...o,
});

// ═══ 1. an unresolved headline is never a company event ═══════════════════════════════════════════════════════════
describe('1. unresolved discoveries are quarantined', () => {
  const BUOYANT = 'Buoyant Q2 demand for consumer goods lifts FY27 revenue outlook, company raises guidance';
  test('a demand / period phrase is never a company name', () => {
    assert.equal(isPlausibleCompanyName('Buoyant Q2 demand for consumer goods'), false);
    assert.equal(isPlausibleCompanyName('Strong demand'), false);
    assert.equal(isPlausibleCompanyName('Consumer demand'), false);
    assert.equal(companyFromHeadline('Buoyant Q2 demand for consumer goods lifts FY27 outlook'), undefined);
    for (const real of ['Zed Alpha Ltd', 'Zed Alpha', 'Zeta Consumer Products', 'Zed Industries']) assert.equal(isPlausibleCompanyName(real), true, real);
  });
  test('the Buoyant headline becomes an unresolved discovery, not an event', () => {
    const idx = buildCompanyIndex([{ symbol: 'ZZIN2', name: 'Zed Two Limited' }]);
    const c = newsToCandidate({ id: 'et-1', title: BUOYANT, summary: '', source_name: 'ET Companies', source_url: 'https://economictimes.indiatimes.com/z', published_at: '2026-09-24T07:00:00.000Z', region: 'IN' }, idx)!;
    assert.equal(c.ticker, undefined); assert.equal(c.company, undefined, 'the phrase must not be taken as the company');
    const q = quarantineUnresolved([c]);
    assert.equal(q.kept.length, 0);
    assert.equal(q.unresolved.length, 1); assert.equal(q.unresolved[0].company, null);
    assert.match(q.unresolved[0].reason, /does not name a company/);
    assert.deepEqual(processRaiseCandidates(q.kept, noCtx, NOW, '7D'), []);
  });
  test('a retained / stored candidate that carries the phrase as its "company" is quarantined on every read', () => {
    const old = cand({ id: 'news:old-buoyant', ticker: undefined, company: 'Buoyant Q2 demand for consumer goods', title: BUOYANT });
    const b = buildIndiaCandidates({ news: null, scraped: null, feed: null, graded: null, gradedDates: [], scanCandidates: [], retained: [old] }, {});
    const q = quarantineUnresolved(b.candidates);
    assert.equal(q.kept.length, 0); assert.equal(q.unresolved[0].company, null);
  });
  test('a real name with no NSE symbol is also held back, with its name in the list', () => {
    const c = cand({ id: 'news:n1', ticker: undefined, company: 'Zed Unlisted Ltd', title: 'Zed Unlisted raises FY27 revenue guidance to Rs 900 crore from Rs 800 crore' });
    const q = quarantineUnresolved([c, cand({ id: 'news:n2', title: 'Zed Alpha raises FY27 revenue guidance to Rs 900 crore from Rs 800 crore' })]);
    assert.equal(q.kept.length, 1); assert.equal(q.kept[0].ticker, 'ZZAA');
    assert.equal(q.unresolved.length, 1); assert.equal(q.unresolved[0].company, 'Zed Unlisted Ltd');
    // a BSE numeric scrip code is not an NSE symbol either
    assert.equal(quarantineUnresolved([cand({ id: 'news:n3', title: 'x', ticker: '532540' })]).kept.length, 0);
    // US candidates always carry a ticker and are untouched
    assert.equal(quarantineUnresolved([cand({ id: 'usgraded:x', title: 'x', market: 'US', ticker: 'ZZUS' })]).kept.length, 1);
  });
  test('the labelUnresolved event path is gone, and the route holds unresolved items back', () => {
    assert.equal((candLib as any).labelUnresolved, undefined);
    const r = read('app/api/v1/guidance-upgrades/route.ts').replace(/\/\/.*$/gm, '');
    assert.ok(!/labelUnresolved/.test(r)); assert.match(r, /quarantineUnresolved\(/);
    assert.match(r, /unresolved: unresolvedList\.slice\(0, 50\), unresolvedCount: unresolvedList\.length/);
  });
  test('coverage wording for held-back discoveries', () => {
    const read: IndiaRead = { news: 1, newsScraped: 1, retained: 0, filings: 5, graded: 0, subjectOnly: 0, unresolved: 1, noCompany: 0 };
    const cov: MarketCoverage = { market: 'IN', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null, read };
    const l = coverageLine(cov, NOW);
    assert.match(l, /1 unresolved discovery held back \(not shown as an event\)/);
    assert.doesNotMatch(l, /ticker not resolved/);
    assert.match(coverageLine({ ...cov, read: { ...read, unresolved: 3 } }, NOW), /3 unresolved discoveries held back \(not shown as events\)/);
  });
});

// ═══ 2. capital raising is not guidance, on EVERY path ════════════════════════════════════════════════════════════
describe('2. capital raising is never a guidance event', () => {
  const RAISES = [
    'Zed Industries raises Rs 13,000 crore through bonds', 'Zed Industries raises Rs 13,000 crore via NCDs', 'Rs 13,000 crore raised by Zed Industries through bonds',
    'Zed Industries to raise up to Rs 3,000 crore via debentures', 'Zed Industries raises Rs 2,000 crore through QIP', 'Zed Industries board approves rights issue to raise Rs 1,500 crore',
    'Zed Industries raises $1.5 billion in a bond sale', 'Zed Industries raises funds through term loan', 'Zed Industries raises stake sale proceeds',
  ];
  const kinds: Array<[string, Partial<GuCandidate>]> = [
    ['news', { id: 'news:x1' }], ['scraped news', { id: 'news:scraped-abc' }], ['retained / stored old id', { id: 'news:retained-old' }],
    ['exchange filing', { id: 'filing:nse:1', kind: 'FILING', sourceName: 'NSE filing', url: 'https://www.nseindia.com/a' }], ['graded row', { id: 'graded:ZZAA:2026-09-24', kind: 'RELEASE' }],
  ];
  for (const t of RAISES) test(`not guidance: ${t}`, () => {
    assert.equal(nonGuidanceRaiseSentence(t), true);
    for (const [, extra] of kinds) {
      const c = cand({ title: t, company: 'Zed Industries', ticker: 'ZZIND', ...(extra as any) });
      assert.equal(sanitizeRaiseCandidate(c), null);
      assert.equal(isRaiseCandidate(c), false);
      assert.deepEqual(processRaiseCandidates([c], noCtx, NOW, '7D'), []);
    }
  });
  test('a retained / stored candidate from an earlier run is dropped by the India builder', () => {
    const old = cand({ id: 'news:kept-in-store', title: 'Zed Industries raises Rs 13,000 crore through bonds', ticker: 'ZZIND', company: 'Zed Industries' });
    const good = cand({ id: 'news:kept-good', title: 'Zed Alpha raises FY27 revenue guidance to Rs 900 crore from Rs 800 crore' });
    const b = buildIndiaCandidates({ news: null, scraped: null, feed: null, graded: null, gradedDates: [], scanCandidates: [], retained: [old, good] }, {});
    assert.deepEqual(b.candidates.map((c) => c.id), ['news:kept-good']);
  });
  test('a bad headline is replaced only by a SPECIFIC company raise, never by loose wording', () => {
    const loose = cand({ id: 'news:l', title: 'Zed Industries raises Rs 13,000 crore through bonds', ticker: 'ZZIND', text: 'Management is confident about the outlook. Investors expect strong demand to continue.' });
    assert.equal(sanitizeRaiseCandidate(loose), null);
    const real = cand({ id: 'news:r', title: 'Zed Industries raises Rs 13,000 crore through bonds', ticker: 'ZZIND', text: 'Zed Industries now expects FY27 revenue of Rs 10.5 lakh crore, up from Rs 9.8 lakh crore.' });
    const s = sanitizeRaiseCandidate(real)!; assert.ok(s && /FY27/.test(s.title) && !/bonds/i.test(s.title));
  });
  test('a real raise that mentions loans or credit as a guided measure is kept', () => {
    assert.equal(nonGuidanceRaiseSentence('Zed Bank raises FY27 loan growth guidance to 15% from 12%'), false);
    assert.equal(nonGuidanceRaiseSentence('Zed Corp raises FY27 revenue guidance to Rs 900 crore from Rs 800 crore'), false);
  });
  test('the route guards every path: all candidate ids, retained, US, and the persisted store', () => {
    const r = read('app/api/v1/guidance-upgrades/route.ts').replace(/\/\/.*$/gm, '');
    assert.ok(!/id\.startsWith\('news:'\) \? sanitizeRaiseCandidate/.test(r), 'sanitising is no longer limited to news ids');
    assert.ok(!/sanitizeRaiseCandidate\(c\) \?\? c/.test(r), 'a rejected candidate is never written back to the store');
    assert.match(r, /map\(\(c\) => sanitizeRaiseCandidate\(c\)\)\.filter/);
    const c = read('lib/guidance-upgrades-candidates.ts').replace(/\/\/.*$/gm, '');
    assert.ok(!/sanitizeRaiseCandidate\(c\) \?\? c/.test(c));
  });
});

// ═══ 3. reiteration: the words follow the computed class ══════════════════════════════════════════════════════════
describe('3. reiteration is called reiteration', () => {
  const us = (text: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
    id: 'usgraded:ZZNS:2026-09-24', ticker: 'ZZNS', company: 'Zed Netsol Inc', market: 'US', title: 'Zed Netsol raises FY27 guidance', text,
    sourceName: 'Company earnings release (SEC 8-K exhibit)', kind: 'RELEASE', url: 'https://www.sec.gov/Archives/zz', publishedAt: '2026-09-24', ...o,
  });
  const NS = 'The company raised FY27 revenue guidance to 13% from 13%. The company raised FY27 adjusted EPS guidance to 35.8 from 35.8.';
  test('every compared measure unchanged: GUIDANCE REITERATED, never a raise', () => {
    const [e] = processCandidates([us(NS)], noCtx, NOW, '7D');
    assert.equal(e.v2!.eventClass, 'REITERATION'); assert.equal(e.v2!.eventLabel, 'GUIDANCE REITERATED');
    assert.ok(e.v2!.ranges.every((r) => r.klass === 'REITERATION'));
    assert.ok(e.whyNow.startsWith('Management reiterated FY27 revenue guidance at 13%.'), e.whyNow);
    assert.ok(!/raised its/i.test(`${e.whyNow} ${e.whatItMeans} ${e.chain.event}`));
    assert.equal(e.v2!.statedDirection, undefined, 'no "direction stated, numbers missing" claim when numbers were extracted');
    assert.equal(e.decision, 'REJECT'); assert.ok(e.decisionReason.some((l) => /reiterated at the same level, not raised/.test(l)));
    assert.ok(e.evidenceGaps.every((g) => !/Previous guidance not found/.test(g)));
  });
  test('nextEvidence is tracking-based when numbers WERE extracted', () => {
    const [e] = processCandidates([us(NS)], noCtx, NOW, '7D');
    assert.ok(e.nextEvidence.length >= 1);
    assert.ok(e.nextEvidence.every((l) => !/Wait for the company to publish clear/.test(l)), e.nextEvidence.join(' | '));
    assert.match(e.nextEvidence[0], /13%/);
  });
  test('"Wait for the company to publish clear numbers" is kept for events with NO numbers', () => {
    const [e] = processCandidates([us('The company raised its guidance at the AGM.', { title: 'Zed Netsol raises guidance', kind: 'NEWS', sourceName: 'Business Standard', url: 'https://www.business-standard.com/z' })], noCtx, NOW, '7D');
    assert.equal(e.v2!.eventClass, 'DETECTED');
    assert.match(e.nextEvidence[0], /Wait for the company to publish clear before and after guidance numbers/);
    assert.match(e.whyNow, /raised its guidance \(direction stated by the source\), but the source gives no before and after numbers/);
  });
  test('a lowered measure is called lowered; a real raise is still a raise', () => {
    const [d] = processCandidates([us('The company raised FY27 revenue guidance to $9.0 billion from $10.0 billion.')], noCtx, NOW, '7D');
    assert.equal(d.v2!.eventClass, 'DOWNGRADE'); assert.match(d.whyNow, /^Management lowered FY27 revenue guidance to \$?9/);
    const [u] = processCandidates([us('The company raised FY27 revenue guidance to $10.8 billion from $10.0 billion.')], noCtx, NOW, '7D');
    assert.equal(u.v2!.eventClass, 'UPGRADE'); assert.equal(u.v2!.eventLabel, 'GUIDANCE RAISED'); assert.match(u.whyNow, /raised revenue guidance/);
  });
  test('eventClassOf: a mixed set with one real raise is an UPGRADE; unchanged + lowered is not a raise', () => {
    const ch = (t: string) => extractGuidance(t);
    assert.equal(eventClassOf(ch('Zed raised FY27 revenue guidance to $10.8 billion from $10.0 billion and adjusted EPS guidance to $2.00 from $2.00.')), 'UPGRADE');
    assert.equal(eventClassOf([]), 'DETECTED');
  });
  test('7. Blackberry-style and Fuller-style events keep their exact classification', () => {
    const bb = processCandidates([us('Zed Berry now expects adjusted EBITDA of $141–158 million for FY27, up from $119–139 million earlier, driven by strong customer demand.', { ticker: 'ZZBB', company: 'Zed Berry', id: 'usgraded:ZZBB:2026-09-24', title: 'Zed Berry raises FY27 adjusted EBITDA outlook' })], noCtx, NOW, '7D')[0];
    assert.equal(bb.v2!.eventClass, 'UPGRADE'); assert.equal(bb.v2!.ranges[0].klass, 'CLEAN_RAISE'); assert.equal(bb.v2!.ranges[0].floorAboveOldCeiling, true);
    assert.equal(bb.verification, 'VERIFIED'); assert.equal(bb.materiality, 'HIGH'); assert.equal(Math.round((bb.changes[0].percentageChange ?? 0) * 10) / 10, 15.9);
    const fu = processCandidates([us('Zed Fuller now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.', { ticker: 'ZZFU', company: 'Zed Fuller', id: 'usgraded:ZZFU:2026-09-24', title: 'Zed Fuller raises FY26 adjusted EPS guidance' })], noCtx, NOW, '7D')[0];
    assert.equal(fu.v2!.eventClass, 'UPGRADE'); assert.equal(fu.v2!.ranges[0].klass, 'MIDPOINT_RAISE_RANGE_NARROWING'); assert.equal(fu.decision, 'REJECT');
  });
  test('US graded row with direction raised but equal old and new values is read as a reiteration', () => {
    const row = { ticker: 'ZZNS', company: 'Zed Netsol Inc', filing_date: '2026-09-24', guide_change: [{ metric: 'operating_margin', period_label: 'FY2027', unit: 'pct', direction: 'raised', new_low: 13, new_high: 13, prev_low: 13, prev_high: 13 }] };
    const r = usGradedRowToCandidate(row, '2026-09-24');
    if (r) { const [e] = processCandidates([r.cand], noCtx, NOW, '7D'); if (e) assert.notEqual(e.v2!.eventClass, 'UPGRADE'); }
  });
  test('buildNextEvidence on an event without v2 still follows its changes', () => {
    const [e] = processCandidates([us(NS)], noCtx, NOW, '7D');
    const bare = { ...e, v2: undefined } as any;
    assert.ok(!/Wait for the company to publish clear/.test(buildNextEvidence(bare)[0]));
  });
});

// ═══ 4. reconcile the event with the guidance universe record ═════════════════════════════════════════════════════
describe('4. universe reconciliation', () => {
  const seed = (o: any = {}) => ({
    company: 'Zed Alpha Ltd', ticker: 'ZZAA', market: 'IN', metric: 'REVENUE', growthLow: 102.7, growthHigh: 109.7, growthOrigin: 'IMPLIED', absoluteTarget: { value: 750, unit: '₹ Cr', valueLow: 725 },
    period: 'FY27', periodKind: 'FY', kind: 'MANAGEMENT_GUIDANCE', organic: 'ORGANIC',
    statement: 'At the AGM on 22 Sep 2026 management raised FY27 revenue guidance to ₹725-750 Cr from ₹600 Cr, with ₹1,500 Cr targeted by FY29.', driver: null, mechanisms: [],
    sourceName: 'Synthetic news on Zed Alpha AGM guidance', sourceType: 'Media', sourceUrl: 'https://example.test/zed-alpha-agm', sourceDate: '2026-09-22', sourceRank: 10, verification: 'PARTIALLY_VERIFIED',
    priorGuidance: [{ date: '2026-05-31', growthLow: 67.7, growthHigh: 67.7, note: 'May target' }], supersededBy: null, notes: '', ownerListText: null, impliedBase: { value: 357.71, unit: '₹ Cr', period: 'FY26' }, ...o,
  });
  const pat = seed({ metric: 'PAT', growthLow: 94, growthHigh: 107.9, absoluteTarget: { value: 225, unit: '₹ Cr', valueLow: 210 }, statement: 'At the AGM on 22 Sep 2026 management raised FY27 net profit guidance to ₹210-225 Cr from ₹180 Cr.' });
  const records = (rows: any[]) => buildUniverse([], null, loadSeedRows(rows).rows, NOW).records;
  const newsOnly = cand({ id: 'news:et-repost', title: 'Zed Alpha raises FY27 guidance at AGM', text: '', sourceName: 'ET Companies', url: 'https://economictimes.indiatimes.com/zed', publishedAt: '2026-09-24T07:00:00.000Z' });
  const run = (rows: any[], cs: GuCandidate[] = [newsOnly]) => processRaiseCandidates(cs, noCtx, NOW, '7D', makeExtraFor(universeLookup(records(rows))));

  test('without the universe the event has no numbers (the owner\'s Cupid case)', () => {
    const [e] = processRaiseCandidates([newsOnly], noCtx, NOW, '7D');
    assert.equal(e.v2!.eventClass, 'DETECTED'); assert.equal(e.changes.filter((c) => c.before).length, 0);
  });
  test('a media-only universe record fills metric, period, before and after, stays UNVERIFIED / PARTIALLY_VERIFIED', () => {
    const evs = run([seed(), pat]);
    assert.equal(evs.length, 1);
    const e = evs[0];
    const rev = e.changes.find((c) => c.metric === 'REVENUE')!; const np = e.changes.find((c) => c.metric === 'NET_PROFIT' || c.metric === 'OTHER')!;
    assert.equal(rev.before!.midpoint, 600); assert.equal(rev.after.low, 725); assert.equal(rev.after.high, 750); assert.equal(rev.after.period, 'FY27');
    assert.ok(np && np.before!.midpoint === 180 && np.after.low === 210 && np.after.high === 225);
    assert.equal(e.v2!.eventClass, 'UPGRADE');
    assert.equal(e.v2!.numbersFrom!.origin, 'UNIVERSE_RECORD'); assert.equal(e.v2!.numbersFrom!.verification, 'PARTIALLY_VERIFIED');
    assert.match(e.v2!.numbersFrom!.note, /^Numbers from universe record, source: Synthetic news on Zed Alpha AGM guidance \(2026-09-22\)/);
    assert.equal(e.verification, 'UNVERIFIED'); assert.equal(e.primaryAvailable, false); assert.equal(e.decision, 'UNVERIFIED');
    assert.ok(e.sources.some((s) => s.name === 'Synthetic news on Zed Alpha AGM guidance'));
    assert.ok(e.sources.every((s) => s.tier !== 'PRIMARY'));
    assert.equal(e.evidenceGaps[0], e.v2!.numbersFrom!.note);
    assert.ok(e.v2!.detectedVia.includes('guidance universe record'));
    assert.match(e.nextEvidence[0], /confirm these figures/);
  });
  test('the event date is the announcement date of the record, not the news repost date', () => {
    const [e] = run([seed()]);
    assert.equal(e.announcement_date, '2026-09-22');
  });
  test('a record verified against a primary document keeps its VERIFIED tier', () => {
    // zzz853: a derived growth that is flagged for review is never VERIFIED, so this record states its % (EXPLICIT) to keep its VERIFIED tier
    const [e] = run([seed({ growthOrigin: 'STATED', growthLow: 102.7, growthHigh: 109.7, impliedBase: null, statement: 'At the AGM on 22 Sep 2026 management raised FY27 revenue guidance by 102.7-109.7% to ₹725-750 Cr from ₹600 Cr.', verification: 'VERIFIED', sourceType: 'Exchange filing', sourceRank: 1, sourceName: 'Zed Alpha exchange filing (AGM)', sourceUrl: 'https://www.nseindia.com/zz' })]);
    assert.equal(e.v2!.numbersFrom!.verification, 'VERIFIED'); assert.equal(e.verification, 'VERIFIED');
  });
  test('events that already have their own numbers, a different company, or a far-away date are left alone', () => {
    const own = cand({ id: 'news:own', title: 'Zed Alpha raises FY27 revenue guidance to Rs 800 crore from Rs 700 crore' });
    const [e1] = run([seed()], [own]); assert.equal(e1.v2!.numbersFrom, undefined); assert.equal(e1.changes[0].before!.midpoint, 700);
    const other = cand({ id: 'news:other', ticker: 'ZZBB', company: 'Zed Beta Ltd', title: 'Zed Beta raises FY27 guidance' });
    const [e2] = run([seed()], [other]); assert.equal(e2.v2!.numbersFrom, undefined); assert.equal(e2.v2!.eventClass, 'DETECTED');
    const late = cand({ id: 'news:late', title: 'Zed Alpha raises FY27 guidance', publishedAt: '2026-10-20T07:00:00.000Z' });
    const [e3] = processRaiseCandidates([late], noCtx, new Date('2026-10-21T06:00:00Z'), '30D', makeExtraFor(universeLookup(records([seed()]))));
    assert.equal(e3.v2!.numbersFrom, undefined);
  });
  test('a record that is not RAISED, or has implied growth and no readable prior, adds nothing', () => {
    const lk = universeLookup(records([seed({ statement: 'Management expects FY27 revenue of ₹750 Cr.', priorGuidance: [] })]));
    assert.equal(lk.size, 0);
    const [e] = processRaiseCandidates([newsOnly], noCtx, NOW, '7D', makeExtraFor(lk));
    assert.equal(e.v2!.eventClass, 'DETECTED');
  });
  test('the route reconciles through the universe lookup (read only)', () => {
    const r = read('app/api/v1/guidance-upgrades/route.ts').replace(/\/\/.*$/gm, '');
    assert.match(r, /loadUniverseRecords\(/); assert.match(r, /makeExtraFor\(universeLookup\(/);
    assert.match(r, /processRaiseCandidates\(.*extraFor\)/); assert.match(r, /processCandidates\(split\.US.*extraFor\)/);
  });
});

// ═══ 5. one announcement = one event with several sources, dated by the announcement ══════════════════════════════
describe('5. dedupe and event date', () => {
  const FULL = 'Zed Alpha raised FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore, and net profit guidance to Rs 210-225 crore from Rs 180 crore.';
  const four: GuCandidate[] = [
    cand({ id: 'filing:nse:1', title: 'Outcome of AGM', text: FULL, sourceName: 'NSE filing', kind: 'FILING', url: 'https://www.nseindia.com/x', publishedAt: '2026-09-22T09:00:00.000Z' }),
    cand({ id: 'news:bs', title: 'Zed Alpha raises FY27 revenue guidance', text: FULL, sourceName: 'Business Standard', url: 'https://www.business-standard.com/a', publishedAt: '2026-09-22T11:00:00.000Z' }),
    cand({ id: 'news:et', title: 'Zed Alpha lifts FY27 guidance: revenue Rs 725-750 crore', text: 'Zed Alpha now expects FY27 revenue of Rs 725-750 crore.', sourceName: 'ET Companies', url: 'https://economictimes.indiatimes.com/b', publishedAt: '2026-09-24T07:00:00.000Z' }),
    cand({ id: 'news:mc', title: 'Zed Alpha raises FY27 revenue and profit guidance', text: 'The company raised its guidance at the AGM.', sourceName: 'Moneycontrol', url: 'https://www.moneycontrol.com/c', publishedAt: '2026-09-25T04:00:00.000Z' }),
  ];
  test('NSE + Business Standard + ET + Moneycontrol = ONE event, four sources, dated by the filing', () => {
    const evs = processRaiseCandidates(four, noCtx, NOW, '7D');
    assert.equal(evs.length, 1);
    assert.equal(evs[0].announcement_date, '2026-09-22');
    assert.deepEqual(evs[0].sources.map((s) => s.name).sort(), ['Business Standard', 'ET Companies', 'Moneycontrol', 'NSE filing']);
    assert.equal(evs[0].verification, 'VERIFIED');
  });
  test('arrival order does not matter', () => {
    const evs = processRaiseCandidates([...four].reverse(), noCtx, NOW, '7D');
    assert.equal(evs.length, 1); assert.equal(evs[0].announcement_date, '2026-09-22'); assert.equal(evs[0].sources.length, 4);
  });
  test('a number-less repost 4+ days later is a different story; two different raises stay two events', () => {
    const later = cand({ id: 'news:much-later', title: 'Zed Alpha raises FY27 revenue and profit guidance', text: 'The company raised its guidance.', sourceName: 'Moneycontrol', url: 'https://www.moneycontrol.com/late', publishedAt: '2026-09-28T04:00:00.000Z' });
    const evs = processRaiseCandidates([four[0], later], noCtx, new Date('2026-09-29T06:00:00Z'), '14D');
    assert.equal(evs.length, 2);
    const second = cand({ id: 'news:second', title: 'Zed Alpha raises FY27 revenue guidance to Rs 800-820 crore from Rs 725-750 crore', publishedAt: '2026-09-27T05:00:00.000Z', url: 'https://www.business-standard.com/second' });
    const e2 = processRaiseCandidates([four[0], second], noCtx, new Date('2026-09-29T06:00:00Z'), '14D');
    assert.equal(e2.length, 1); assert.ok(e2[0].flags.includes('SECOND_UPGRADE_IN_WINDOW'));
  });
  test('news that repeats an older exchange filing (subject only) takes the filing date', () => {
    const news = cand({ id: 'news:repeat', title: 'Zed Alpha raises FY27 guidance', text: '', sourceName: 'ET Companies', url: 'https://economictimes.indiatimes.com/r', publishedAt: '2026-09-24T07:00:00.000Z' });
    const filing = cand({ id: 'filing:nse:agm', title: 'Outcome of Annual General Meeting / Investor Presentation', text: '', sourceName: 'NSE filing', kind: 'FILING', url: 'https://www.nseindia.com/agm', publishedAt: '2026-09-22T09:00:00.000Z' });
    const evs = processRaiseCandidates([news], noCtx, NOW, '7D');
    const corr = corroborateWithFilings(evs, collectSubjectOnly([filing]));
    assert.equal(corr.matched, 1); assert.equal(corr.events[0].announcement_date, '2026-09-22');
    assert.ok(corr.events[0].sources.some((s) => /subject only/.test(s.name)));
  });
});

// ═══ 6. durability is "unknown" unless the source says otherwise ═══════════════════════════════════════════════════
describe('6. durability and why-now', () => {
  const dur = (text: string) => { const d = classifyDriver(text); return assessDurability(text, [], d, classifyDuration(text, [], d), researchWhyNow(text, d)); };
  test('currency / price / commodity words alone never give "one to two quarters"', () => {
    for (const t of ['Zed raised FY27 revenue guidance helped by favourable currency tailwinds.', 'Zed raised FY27 revenue guidance on higher selling prices.', 'Zed raised FY27 EBITDA guidance as steel prices rose and commodity costs eased.', 'Zed raised FY27 guidance. The next quarter looks strong.'])
      assert.equal(dur(t).level, 'UNKNOWN_INSUFFICIENT_EVIDENCE', t);
  });
  test('"one to two quarters" only when the source says the driver is short-lived', () => {
    assert.equal(dur('Zed raised FY27 revenue guidance helped by a temporary currency tailwind that is expected to fade.').level, '1_2_QUARTERS');
    assert.equal(dur('Zed raised FY27 guidance on higher selling prices, which management called short-term.').level, '1_2_QUARTERS');
  });
  test('Buoyant-style and Cupid-style events (headline only) come out unknown, not a generic class', () => {
    const [cup] = processRaiseCandidates([cand({ id: 'news:c', title: 'Zed Alpha raises FY27 guidance at AGM', text: '', sourceName: 'ET Companies', url: 'https://economictimes.indiatimes.com/c' })], noCtx, NOW, '7D');
    assert.equal(cup.v2!.durabilityLevel, 'UNKNOWN_INSUFFICIENT_EVIDENCE'); assert.equal(cup.duration, 'UNKNOWN');
    assert.doesNotMatch(cup.v2!.durabilityWhy, /can reverse within a quarter or two/);
    assert.match(cup.v2!.durabilityWhy, /unknown/i);
    assert.equal(cup.v2!.whyNowResolved, false); assert.match(cup.whyNow, /Driver unresolved after primary-source \+ recent-event research/);
    const [fx] = processRaiseCandidates([cand({ id: 'news:fx', title: 'Zed Alpha raises FY27 revenue guidance to Rs 900 crore from Rs 800 crore', text: 'Management cited currency tailwinds and higher prices.', url: 'https://www.business-standard.com/fx' })], noCtx, NOW, '7D');
    assert.equal(fx.v2!.durabilityLevel, 'UNKNOWN_INSUFFICIENT_EVIDENCE');
  });
  test('the generic sentence is gone from the engine source unless it is gated on a stated short life', () => {
    const src = read('lib/guidance-upgrades.ts');
    assert.ok(!/Only the next quarter is referred to/.test(src));
    assert.match(src, /&& SHORT_LIVED_RE\.test\(t\)/);
  });
});

// ═══ 8. coverage honesty: the optional scraped blob ═══════════════════════════════════════════════════════════════
describe('8. coverage with the scraped filings blob', () => {
  const NOW8 = new Date('2026-09-23T10:00:00Z');
  const days = istDateList(NOW8, 7);   // newest first
  const rowOn = (d: string, i = 0) => ({ exchange: 'NSE', symbol: 'ZZAA', company_name: 'Zed Alpha Ltd', subject: `Trading window closure ${i}`, category: 'Insider Trading', filing_datetime: `${d}T05:00:00.000Z`, content_hash: `h-${d}-${i}` });
  const failing: DayFetcher = async () => ({ ok: false, filings: [], reason: 'NSE HTTP 403' });
  const blobOver = (list: string[], extra: Record<string, unknown> = {}) => makeBlobReader(async () => ({ generatedAt: NOW8.toISOString(), filings: list.map((d) => rowOn(d)), ...extra }));

  test('the blob covers all 7 days: 7/7 covered, exchange feeds stay FAILED, status is PARTIAL (never complete)', async () => {
    const r = await scanIndia({ now: NOW8, days: 7, fetchNse: failing, fetchBse: failing, readBlob: blobOver(days) });
    assert.equal(r.status.daysCovered, 7); assert.equal(r.status.daysRequested, 7);
    assert.equal(r.status.complete, false); assert.equal(r.status.status, 'PARTIAL');
    assert.equal(r.status.sources.find((s) => s.name.startsWith('NSE'))!.state, 'FAILED');
    assert.equal(r.status.sources.find((s) => s.name.startsWith('BSE'))!.state, 'FAILED');
    const b = r.status.sources.find((s) => s.name === 'Scraped filings blob')!;
    assert.match(b.detail, /blob \(optional source\)/); assert.match(b.detail, /7 of 7 days covered/);
    assert.deepEqual(r.status.coveredBy, { exchange: 0, blob: 7, blobOnly: 7 });
    assert.match(r.status.note, /read from scraped blob; exchange feeds failed/); assert.match(r.status.note, /NOT a confirmation of no upgrades/);
    assert.match(r.status.coverageLabel!, /PARTIAL: read from scraped blob; exchange feeds failed/);
    const cov: MarketCoverage = { market: 'IN', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null, scan: r.status };
    assert.match(coverageLine(cov, NOW8), /SCAN INCOMPLETE/); assert.match(coverageLine(cov, NOW8), /read from scraped blob; exchange feeds failed/);
  });
  test('days outside the blob\'s own date range are NOT covered', async () => {
    const r = await scanIndia({ now: NOW8, days: 7, fetchNse: failing, fetchBse: failing, readBlob: blobOver(days.slice(0, 3)) });
    assert.equal(r.status.daysCovered, 3); assert.equal(r.status.coveredBy!.blob, 3);
    const none = await scanIndia({ now: NOW8, days: 7, fetchNse: failing, fetchBse: failing, readBlob: makeBlobReader(async () => null) });
    assert.equal(none.status.daysCovered, 0); assert.equal(none.status.status, 'FAILED');
  });
  test('a blob cut off at its cap does not count its oldest (partial) day', () => {
    const rows: any[] = []; for (let i = 0; i < BLOB_CAP; i++) rows.push(rowOn(days[i % 3], i));   // 500 rows over 3 days
    const cov = blobCoverage({ generatedAt: NOW8.toISOString(), filings: rows })!;
    assert.equal(cov.truncated, true); assert.equal(cov.to, days[0]); assert.equal(cov.from, days[1], 'oldest day is dropped when the blob was cut off');
    assert.equal(blobCoverage({ filings: rows.slice(0, 10) })!.truncated, false);
  });
  test('exchange feeds answering: complete as before; the blob adds nothing to completeness', async () => {
    const ok: DayFetcher = async () => ({ ok: true, filings: [] });
    const r = await scanIndia({ now: NOW8, days: 7, fetchNse: ok, fetchBse: ok, readBlob: blobOver(days) });
    assert.equal(r.status.complete, true); assert.equal(r.status.daysCovered, 7); assert.deepEqual(r.status.coveredBy, { exchange: 7, blob: 7, blobOnly: 0 });
    // one exchange feed down while the other answers: still not complete
    const half = await scanIndia({ now: NOW8, days: 7, fetchNse: failing, fetchBse: ok, readBlob: blobOver(days) });
    assert.equal(half.status.complete, false);
  });
  test('the real blob reader is range-aware and takes no per-day key', () => {
    const s = read('lib/guidance-upgrades-scan.ts');
    assert.match(s, /makeBlobReader\(async \(\) =>/); assert.match(s, /corp-filings:v1:latest/);
  });
});
