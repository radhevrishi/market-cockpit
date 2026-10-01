// zzz847 — Guidance Upgrades, India end to end. The owner saw "India: 0 raise candidates ... No announcement in this window" while a
// same-day Indian raise (Cupid Ltd, AGM, FY27 revenue 600 -> 725-750 crore, net profit 180 -> 210-225 crore) was in every Indian outlet.
// Fixtures are synthetic but shaped like the REAL cache rows (news:articles:v39 article, scraped-india-news:v1:latest entry,
// concall-feed:v26 / corp-filings:v1:latest filing, graded:v14 by_tier row). What the live caches hold cannot be known from here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processCandidates, withinWindow } from '../guidance-upgrades';
import {
  newsToCandidate, scrapedNewsToCandidate, filingToCandidate, gradedRowToCandidate, parseWhen, istDate, istDateList, buildCompanyIndex,
  buildIndiaCandidates, resolveCompany, companyFromHeadline, propagateTickers, isRaiseCandidate, processRaiseCandidates, isRaiseBearingSubject,
  collectSubjectOnly, corroborateWithFilings, labelUnresolved, nameKeyOf, splitByMarket, coverageLine, dedupeCandidates, normCompanyName,
  type MarketCoverage, type IndiaRead,
} from '../guidance-upgrades-candidates';
import { scanIndia, makeRealIndiaFetchers, type DayFetcher } from '../guidance-upgrades-scan';
import { kvSet } from '../kv';
import type { GuCandidate } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-22T12:00:00Z');   // 17:30 IST, the day of the AGM
const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const noCtx = () => ({});

// ── REAL-SHAPED ROWS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A news:articles:v39 article. ticker_symbols comes from extractTickers(): ALL-CAPS words of the headline, so it holds 'AGM' and misses the company. */
const article = (o: any = {}) => ({
  id: 'mint-1', title: 'Cupid raises FY27 revenue, profit guidance at 33rd AGM', headline: 'Cupid raises FY27 revenue, profit guidance at 33rd AGM',
  summary: 'Cupid Ltd now expects FY27 revenue of Rs 725-750 crore and net profit of Rs 210-225 crore, up from Rs 600 crore and Rs 180 crore earlier.',
  source_name: 'Livemint Companies', source: 'Livemint Companies', source_tier: 'secondary', source_url: 'https://www.livemint.com/companies/cupid-guidance-11.html',
  published_at: '2026-09-22T08:40:00.000Z', region: 'IN', article_type: 'CORPORATE', investment_tier: 2,
  ticker_symbols: ['AGM'], tickers: ['AGM'], primary_ticker: 'AGM', ...o,
});
const bsArticle = () => article({ id: 'bs-1', title: 'Cupid Ltd lifts FY27 guidance: revenue target now Rs 725-750 crore', headline: 'Cupid Ltd lifts FY27 guidance: revenue target now Rs 725-750 crore',
  summary: 'The company raised its FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore and net profit guidance to Rs 210-225 crore from Rs 180 crore.',
  source_name: 'Business Standard', source_url: 'https://www.business-standard.com/companies/news/cupid-guidance-22.html', published_at: '2026-09-22T09:05:00.000Z', ticker_symbols: [], tickers: [], primary_ticker: null });
/** A scraped-india-news:v1:latest entry: no ticker, RFC 822 date. */
const scrapedEntry = (o: any = {}) => ({ title: 'Cupid raises FY27 guidance: revenue Rs 725-750 crore, profit Rs 210-225 crore', url: 'https://www.whalesbook.com/news/cupid-33rd-agm', source: 'Whalesbook',
  publishedAt: 'Tue, 22 Sep 2026 14:05:00 +0530', snippet: 'Cupid Ltd raised FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore and net profit guidance to Rs 210-225 crore from Rs 180 crore.', ...o });
/** An NSE announcement row as nseRowToFiling / the GitHub scraper emit it: subject + attachment only. */
const nseFiling = (o: any = {}) => ({ exchange: 'NSE', symbol: 'CUPID', company_name: 'Cupid Limited', subject: 'Outcome of 33rd Annual General Meeting / Investor Presentation',
  category: 'Company Update', subcategory: null, filing_datetime: '2026-09-22T09:30:00.000Z', attachment_urls: ['https://nsearchives.nseindia.com/corporate/CUPID_22092026.pdf'],
  source_url: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=CUPID', content_hash: 'h-cupid-agm', ...o });
const bseFiling = (o: any = {}) => ({ exchange: 'BSE', symbol: '530843', company_name: 'CUPID LTD', subject: 'Investor Presentation', category: 'Company Update', subcategory: 'Investor Presentation',
  filing_datetime: '2026-09-22T09:40:00.000Z', attachment_urls: ['https://www.bseindia.com/xml-data/corpfiling/AttachLive/x.pdf'], source_url: 'https://www.bseindia.com/stock-share-price/_/_/530843/', content_hash: 'h-cupid-bse', ...o });
const noiseFiling = (o: any = {}) => ({ exchange: 'NSE', symbol: 'ZZIN9', company_name: 'Zed Nine Limited', subject: 'Trading Window closure', category: 'Insider Trading', filing_datetime: '2026-09-22T04:00:00.000Z', attachment_urls: [], source_url: 'x', content_hash: 'h-noise', ...o });
/** graded:v14 payload: { by_tier: { TIER: row[] } }. Guidance fields come from the india-guidance overlay (subject) and the grader's text fields. */
const gradedPayload = (rows: any[]) => ({ generated_at: '2026-09-22T11:00:00Z', by_tier: { STRONG: rows } });
const gradedRow = (o: any = {}) => ({ symbol: 'ZZIN1', company: 'Zed One Industries', filing_date: '2026-09-22', quarter: 'Q2 FY27', pe: 38.2,
  guidance_text: 'Management guides FY27 revenue of Rs 900-950 crore, raised from Rs 800 crore earlier.', narrative_text: null, announcement_text: 'Outcome of Board Meeting - Financial Results',
  guidance_raised: true, guidance_lowered: false, has_concrete_guidance: true, source_url: 'https://www.nseindia.com/x', ...o });

const idxFromFilings = () => buildCompanyIndex([{ symbol: 'CUPID', name: 'Cupid Limited' }, { symbol: 'ZZIN1', name: 'Zed One Industries Limited' }, { symbol: 'ZZIN2', name: 'Zed Two Limited' }]);
const emptyInputs = (o: any = {}) => ({ news: null, scraped: null, feed: null, graded: null, gradedDates: [], scanCandidates: [] as GuCandidate[], ...o });

describe('1. news path: Indian articles with no usable ticker_symbols', () => {
  test('headline-only company resolves to an NSE symbol through the index, and the garbage ticker AGM is ignored', () => {
    const c = newsToCandidate(article(), idxFromFilings())!;
    assert.equal(c.ticker, 'CUPID'); assert.equal(c.market, 'IN'); assert.equal(c.kind, 'NEWS');
    assert.equal(newsToCandidate(bsArticle(), idxFromFilings())!.ticker, 'CUPID');
  });
  test('without an index the old behaviour is unchanged (article ticker or nothing)', () => {
    assert.equal(newsToCandidate(article())!.ticker, 'AGM');
    assert.equal(newsToCandidate(bsArticle())!.ticker, undefined);
  });
  test('company names learned from the filing feed resolve a company the curated map does not know', () => {
    const b = buildIndiaCandidates(emptyInputs({ news: [article()], feed: { filings: [nseFiling()] } }), {});
    assert.equal(b.candidates.find((c) => c.id === 'news:mint-1')!.ticker, 'CUPID');
    assert.ok(b.index.known.has('CUPID'));
  });
  test('the curated NSE_TICKER_NAMES map is reused, not duplicated', () => {
    const b = buildIndiaCandidates(emptyInputs({ news: [article()] }), { CUPID: 'Cupid' });
    assert.equal(b.candidates[0].ticker, 'CUPID');
  });
  test('unresolved: company name kept, ticker undefined, still shown and labelled "ticker not resolved"', () => {
    const c = newsToCandidate(article(), buildCompanyIndex([{ symbol: 'ZZIN2', name: 'Zed Two Limited' }]))!;
    assert.equal(c.ticker, undefined); assert.equal(c.company, 'Cupid');
    assert.ok(isRaiseCandidate(c), 'engine accepts the raise wording even without a symbol');
    const ev = labelUnresolved(processRaiseCandidates([c], noCtx, NOW, '7D'), new Set([nameKeyOf(c)]));
    assert.equal(ev.length, 1);
    assert.match(ev[0].company, /ticker not resolved/);
    assert.ok(ev[0].evidenceGaps.some((g) => /Ticker not resolved/.test(g)));
    assert.equal(ev[0].verification, 'UNVERIFIED'); assert.equal(ev[0].v2!.stage, 'CANDIDATE'); assert.equal(ev[0].decision, 'UNVERIFIED');
  });
  test('an index that knows nothing never invents a symbol', () => {
    assert.deepEqual(resolveCompany('Cupid raises FY27 guidance', '', ['AGM'], buildCompanyIndex([])).ticker, undefined);
    assert.equal(resolveCompany('Some Co raises guidance', '', [], undefined).ticker, undefined);
  });
  test('an ambiguous company name resolves to nothing rather than a guess', () => {
    const idx = buildCompanyIndex([{ symbol: 'ZZAA1', name: 'Zeta Works Limited' }, { symbol: 'ZZAA2', name: 'Zeta Works Ltd' }]);
    assert.equal(resolveCompany('Zeta Works raises FY27 guidance', '', [], idx).ticker, undefined);
  });
  test('macro and broker headlines are not companies', () => {
    assert.equal(companyFromHeadline('RBI raises FY27 growth forecast to 7%'), undefined);
    assert.equal(companyFromHeadline('Stocks to watch: Cupid raises FY27 guidance'), 'Cupid');
    const c = newsToCandidate({ ...article({ id: 'rbi', title: 'RBI raises FY27 GDP forecast to 7%', summary: 'The central bank now expects growth of 7%.', ticker_symbols: [], primary_ticker: null }) }, idxFromFilings())!;
    assert.equal(c.ticker, undefined); assert.equal(c.company, undefined, 'macro headline gets no company, so the route drops it as noCompany');
  });
  test('GLOBAL-region article from an Indian outlet with a resolved company becomes an India item', () => {
    const c = newsToCandidate(article({ region: 'GLOBAL' }), idxFromFilings())!;
    assert.equal(c.market, 'IN');
  });
  test('timestamps: RFC 822 with +0530 and IST, NSE-style zone-less IST, ISO Z', () => {
    assert.equal(parseWhen('Tue, 22 Sep 2026 14:05:00 +0530'), '2026-09-22T08:35:00.000Z');
    assert.equal(parseWhen('Tue, 22 Sep 2026 14:05:00 IST'), '2026-09-22T08:35:00.000Z');
    assert.equal(parseWhen('22-Sep-2026 14:05:00'), '2026-09-22T08:35:00.000Z');
    assert.equal(parseWhen('2026-09-22 14:05:00'), '2026-09-22T08:35:00.000Z');
    assert.equal(parseWhen('2026-09-22T08:35:00.000Z'), '2026-09-22T08:35:00.000Z');
    assert.equal(parseWhen('not a date'), null);
    const s = scrapedNewsToCandidate(scrapedEntry(), idxFromFilings())!;
    assert.equal(s.publishedAt, '2026-09-22T08:35:00.000Z'); assert.equal(s.ticker, 'CUPID'); assert.equal(s.market, 'IN');
  });
  test('an undated article (route stamps a 400-day-old sentinel) stays out of every window', () => {
    const c = newsToCandidate(article({ published_at: new Date(Date.now() - 400 * 86400000).toISOString() }), idxFromFilings())!;
    for (const w of ['24H', '3D', '7D', '14D', '30D'] as const) assert.equal(withinWindow(c.publishedAt, w, new Date()), false);
  });
});

describe('dedupe: one company + period + metric = one event, however many outlets', () => {
  test('Mint, Business Standard and Whalesbook (cache + scraped blob) merge into ONE event with three sources', () => {
    const b = buildIndiaCandidates(emptyInputs({ news: [article(), bsArticle()], scraped: { entries: [scrapedEntry()] }, feed: { filings: [nseFiling()] } }), {});
    const ev = processRaiseCandidates(b.candidates.filter((c) => c.market === 'IN'), noCtx, NOW, '7D');
    assert.equal(ev.length, 1, 'syndication must not inflate the count');
    assert.equal(ev[0].ticker, 'CUPID');
    assert.ok(ev[0].sources.length >= 3);
    assert.equal(ev[0].verification, 'UNVERIFIED'); assert.equal(ev[0].primaryAvailable, false);
    assert.ok(ev[0].changes.length >= 1);
  });
  test('an outlet that cannot be resolved still folds into the resolved event (same company name)', () => {
    const idx = idxFromFilings();
    const a = newsToCandidate(article(), idx)!;                       // resolved: CUPID
    const b = { ...newsToCandidate(bsArticle(), idx)!, ticker: undefined, company: 'Cupid Limited' };   // unresolved copy
    const list = propagateTickers([a, b]);
    assert.equal(list[1].ticker, 'CUPID');
    assert.equal(processRaiseCandidates(list, noCtx, NOW, '7D').length, 1);
  });
  test('the same article seen in the news cache and the retained store is one candidate', () => {
    const fresh = newsToCandidate(article(), idxFromFilings())!;
    const b = buildIndiaCandidates(emptyInputs({ news: [article()], retained: [fresh] }), {});
    assert.equal(b.candidates.filter((c) => c.id === fresh.id).length, 1);
    assert.equal(dedupeCandidates([fresh, { ...fresh, id: 'other' }]).length, 1);
  });
});

describe('2. exchange filings: subject-only rows', () => {
  test('subject recognition: AGM outcome / presentation / press release / call / results', () => {
    for (const s of ['Outcome of 33rd Annual General Meeting', 'Investor Presentation', 'Press Release - Q2 FY27', 'Earnings Call Transcript', 'Financial Results for the quarter ended 30 September 2026', 'Outcome of AGM'])
      assert.equal(isRaiseBearingSubject(s), true, s);
    for (const s of ['Trading Window closure', 'Change in Director', 'Loss of Share Certificate']) assert.equal(isRaiseBearingSubject(s), false, s);
  });
  test('a subject-only filing is NOT a raise and never becomes an event on its own', () => {
    const c = filingToCandidate(nseFiling())!;
    assert.equal(c.kind, 'FILING'); assert.equal(c.ticker, 'CUPID'); assert.equal(isRaiseCandidate(c), false);
    assert.equal(processRaiseCandidates([c], noCtx, NOW, '7D').length, 0);
    const so = collectSubjectOnly([c, filingToCandidate(noiseFiling())!]);
    assert.equal(so.length, 1); assert.equal(so[0].ticker, 'CUPID');
  });
  test('BSE scrip code is not an NSE symbol: resolved by company name, else ticker stays empty', () => {
    assert.equal(filingToCandidate(bseFiling())!.ticker, undefined);
    assert.equal(filingToCandidate(bseFiling(), idxFromFilings())!.ticker, 'CUPID');
    assert.equal(filingToCandidate(bseFiling())!.company, 'CUPID LTD');
  });
  test('corroboration attaches the filing as a source + evidence gap, and does NOT raise verification', () => {
    const b = buildIndiaCandidates(emptyInputs({ news: [article(), bsArticle()], feed: { filings: [nseFiling(), bseFiling(), noiseFiling()] } }), {});
    const inIn = b.candidates.filter((c) => c.market === 'IN');
    const events = processRaiseCandidates(inIn, noCtx, NOW, '7D');
    assert.equal(events.length, 1);
    const subjectOnly = collectSubjectOnly(inIn.filter((c) => !isRaiseCandidate(c)));
    const corr = corroborateWithFilings(events, subjectOnly);
    assert.equal(corr.matched, 1);
    const e = corr.events[0];
    assert.equal(e.verification, 'UNVERIFIED'); assert.equal(e.primaryAvailable, false); assert.equal(e.v2!.stage, 'CANDIDATE'); assert.equal(e.decision, 'UNVERIFIED');
    assert.ok(e.sources.some((s) => /subject only/.test(s.name) && s.tier === 'SECONDARY'));
    assert.ok(e.evidenceGaps.some((g) => /document not read/.test(g)));
    assert.ok(e.v2!.detectedVia.includes('exchange filing (subject only)'));
    assert.equal(corr.unmatched.length, 0, 'both the NSE and the BSE row belong to the same company');
  });
  test('a filing for a company with no raise item is listed as "seen, raise text not read", not as a raise', () => {
    const b = buildIndiaCandidates(emptyInputs({ feed: { filings: [nseFiling({ symbol: 'ZZIN2', company_name: 'Zed Two Limited', subject: 'Investor Presentation', content_hash: 'h2' })] } }), {});
    const corr = corroborateWithFilings([], collectSubjectOnly(b.candidates));
    assert.equal(corr.events.length, 0); assert.equal(corr.unmatched.length, 1); assert.equal(corr.unmatched[0].company, 'Zed Two Limited');
  });
  test('a filing whose own text carries the raise numbers IS a primary source (VERIFIED)', () => {
    const f = filingToCandidate(nseFiling({ detail: 'At the 33rd AGM the company further raised FY27 guidance: revenue target raised to Rs 725-750 crore from Rs 600 crore, and net profit guidance raised to Rs 210-225 crore from Rs 180 crore.' }))!;
    const ev = processRaiseCandidates([f], noCtx, NOW, '7D');
    assert.equal(ev.length, 1); assert.equal(ev[0].verification, 'VERIFIED');
  });
  test('filing text includes scored concall-feed excerpts (bullish evidence, evidence_excerpts), not only the subject', () => {
    const row = nseFiling({ bullish: { evidence: [{ text: 'We have raised our FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore.', tag: 'Guidance', polarity: 'BULL', negated: false }, { text: 'Demand is weak.', tag: 'x', polarity: 'BEAR', negated: false }], bullish_phrases: ['raised guidance'] }, evidence: { numeric_examples: ['revenue Rs 725-750 crore'] } });
    const c = filingToCandidate(row)!;
    assert.match(c.text, /raised our FY27 revenue guidance/); assert.doesNotMatch(c.text, /Demand is weak/);
    assert.equal(isRaiseCandidate(c), true);
  });
});

describe('3. graded results rows', () => {
  test('reads the grader\'s own six text fields: "management guides", "targets", "revenue guidance"', () => {
    const a = gradedRowToCandidate(gradedRow(), '2026-09-22')!;
    assert.equal(a.ticker, 'ZZIN1'); assert.match(a.text, /Management guides FY27 revenue/); assert.equal(a.publishedAt, '2026-09-22');
    const b = gradedRowToCandidate(gradedRow({ guidance_text: null, narrative_text: 'Company targets FY27 revenue of Rs 900 crore versus Rs 800 crore earlier.' }), '2026-09-22')!;
    assert.match(b.text, /targets FY27 revenue/);
    const c = gradedRowToCandidate(gradedRow({ guidance_text: null, announcement_text: null, headline: 'Company raised its revenue guidance for FY27 to Rs 900 crore from Rs 800 crore' }), '2026-09-22')!;
    assert.ok(c && isRaiseCandidate(c));
    assert.equal(gradedRowToCandidate({ symbol: 'ZZZZ' }, '2026-09-22'), null);
  });
  test('a row the overlay marked as a CUT is not a raise candidate; the boolean alone never writes "guidance raised" into the headline', () => {
    assert.equal(gradedRowToCandidate(gradedRow({ guidance_raised: false, guidance_lowered: true }), '2026-09-22'), null);
    const loose = gradedRowToCandidate(gradedRow({ guidance_text: 'record order book and record revenue', announcement_text: null }), '2026-09-22')!;
    assert.doesNotMatch(loose.title, /guidance raised/);
    assert.equal(isRaiseCandidate(loose), false);
  });
  test('graded row + media raise for the same company land in one event', () => {
    const idx = buildCompanyIndex([{ symbol: 'ZZIN1', name: 'Zed One Industries Limited' }]);
    const g = gradedRowToCandidate(gradedRow(), '2026-09-22')!;
    const n = newsToCandidate(article({ id: 'z1', title: 'Zed One Industries raises FY27 revenue guidance to Rs 900-950 crore', summary: 'Zed One Industries raised FY27 revenue guidance to Rs 900-950 crore from Rs 800 crore.', ticker_symbols: [], primary_ticker: null }), idx)!;
    assert.equal(n.ticker, 'ZZIN1');
    const ev = processRaiseCandidates([g, n], noCtx, NOW, '7D');
    assert.equal(ev.length, 1);
  });
});

describe('4. windows and IST', () => {
  const cand = (daysAgo: number, o: Partial<GuCandidate> = {}): GuCandidate => ({ id: `c${daysAgo}`, ticker: 'ZZIN1', company: 'Zed One Industries', market: 'IN', title: 'Zed One raises FY27 revenue guidance to Rs 900 crore from Rs 800 crore', text: '',
    sourceName: 'Livemint', publishedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), kind: 'NEWS', ...o });
  test('announced 6 days ago: in 7D and 14D, not in 3D or 24H', () => {
    const c = cand(6);
    for (const [w, n] of [['24H', 0], ['3D', 0], ['7D', 1], ['14D', 1], ['30D', 1]] as const) assert.equal(processRaiseCandidates([c], noCtx, NOW, w).length, n, w);
  });
  test('announced today (2 hours ago) is in 24H', () => {
    assert.equal(processRaiseCandidates([cand(0, { publishedAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString() })], noCtx, NOW, '24H').length, 1);
  });
  test('a date-only India results row filed today or yesterday is in 24H, one from 6 days ago is not', () => {
    assert.equal(processRaiseCandidates([cand(0, { publishedAt: '2026-09-22' })], noCtx, NOW, '24H').length, 1);
    assert.equal(processRaiseCandidates([cand(1, { publishedAt: '2026-09-21' })], noCtx, NOW, '24H').length, 1);
    assert.equal(processRaiseCandidates([cand(6, { publishedAt: '2026-09-16' })], noCtx, NOW, '24H').length, 0);
  });
  test('IST day: after 18:30 UTC the Indian date is already tomorrow, and the date list starts there', () => {
    const late = new Date('2026-09-22T20:00:00Z');
    assert.equal(istDate(late), '2026-09-23');
    assert.deepEqual(istDateList(late, 3), ['2026-09-23', '2026-09-22', '2026-09-21']);
    assert.equal(istDate(new Date('2026-09-22T12:00:00Z')), '2026-09-22');
  });
  test('the India scan walks IST days (today first), so an evening filing is requested under the right date', async () => {
    const seen: string[] = [];
    const nse: DayFetcher = async (d) => { seen.push(d); return { ok: true, filings: [] }; };
    await scanIndia({ now: new Date('2026-09-22T20:00:00Z'), days: 3, fetchNse: nse, fetchBse: async () => ({ ok: true, filings: [] }) });
    assert.ok(seen.includes('2026-09-23'), 'IST today'); assert.ok(seen.includes('2026-09-21'));
  });
  test('scan blob reader reads the blob the GitHub scraper really writes (corp-filings:v1:latest) and filters it by IST day', async () => {
    await kvSet('corp-filings:v1:latest', { generatedAt: '2026-09-22T11:00:00Z', filings: [nseFiling(), nseFiling({ content_hash: 'old', filing_datetime: '2026-09-19T05:00:00.000Z' })] });
    const { blob } = makeRealIndiaFetchers();
    const today = await blob('2026-09-22');
    assert.equal(today!.length, 1); assert.equal(today![0].symbol, 'CUPID');
    assert.equal((await blob('2026-09-19'))!.length, 1);
    assert.equal((await blob('2026-09-21'))!.length, 0);
    const r = await scanIndia({ now: NOW, days: 7, fetchNse: async () => ({ ok: true, filings: [] }), fetchBse: async () => ({ ok: true, filings: [] }), readBlob: blob });
    const src = r.status.sources.find((s) => s.name === 'Scraped filings blob')!;
    assert.notEqual(src.state, 'NOT_RUN'); assert.ok(src.scanned >= 2);
    assert.equal(r.candidates.filter((c) => c.ticker === 'CUPID').length >= 1, true);
  });
  test('retained raise-worded news outlives the feeds: a 6-day-old item returns in 7D, and ages out of 3D', () => {
    const kept = newsToCandidate(article({ published_at: '2026-09-16T08:40:00.000Z' }), idxFromFilings())!;
    const b = buildIndiaCandidates(emptyInputs({ retained: [kept] }), {});
    assert.equal(b.counts.retained, 1);
    assert.equal(processRaiseCandidates(b.candidates, noCtx, NOW, '7D').length, 1);
    assert.equal(processRaiseCandidates(b.candidates, noCtx, NOW, '3D').length, 0);
  });
});

describe('5. India is not starved by US items; 6. candidates stay visible and count as Detected, not Verified', () => {
  const usCand = (i: number): GuCandidate => ({ id: `us${i}`, ticker: `ZZU${i}`, company: `Zed US ${i}`, market: 'US', title: `Zed US ${i} raises FY27 revenue guidance to $10 billion from $9 billion`, text: '', sourceName: 'Business Wire', publishedAt: '2026-09-22T11:00:00.000Z', kind: 'NEWS' });
  test('a mixed cache with 400 US raise items still delivers the India raise', () => {
    const news = [...Array.from({ length: 400 }, (_, i) => article({ id: `us-${i}`, title: `Zed US ${i} raises FY27 revenue guidance to $10 billion from $9 billion`, summary: '', region: 'US', ticker_symbols: [`ZZU${i}`], primary_ticker: `ZZU${i}`, source_name: 'CNBC Top News', source_url: `https://www.cnbc.com/${i}`, published_at: '2026-09-22T11:30:00.000Z' })), article(), bsArticle()];
    const b = buildIndiaCandidates(emptyInputs({ news, feed: { filings: [nseFiling()] } }), {});
    const inWin = b.candidates.filter((c) => withinWindow(c.publishedAt, '7D', NOW));
    const picked = inWin.filter((c) => (c.market === 'US' ? true : isRaiseCandidate(c)));
    const split = splitByMarket(picked, 300);
    assert.equal(split.US.length, 300, 'US is capped on its own');
    assert.ok(split.IN.length >= 2, 'India keeps its own cap');
    const ev = processRaiseCandidates([...split.IN, ...split.GLOBAL], noCtx, NOW, '7D');
    assert.equal(ev.length, 1); assert.equal(ev[0].market, 'IN'); assert.equal(ev[0].ticker, 'CUPID');
    const us = processCandidates(split.US.slice(0, 5), noCtx, NOW, '7D'); assert.ok(us.length >= 1);
  });
  test('a media-only raise with no prior figures is a visible CANDIDATE: counted as Detected, not Verified', () => {
    const c: GuCandidate = { id: 'n-x', ticker: 'ZZIN1', company: 'Zed One Industries', market: 'IN', title: 'Zed One Industries raises FY27 profit guidance', text: 'Management lifted its profit outlook for the year.', sourceName: 'Whalesbook', publishedAt: NOW.toISOString(), kind: 'NEWS' };
    const ev = processRaiseCandidates([c], noCtx, NOW, '7D');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].v2!.stage, 'CANDIDATE'); assert.equal(ev[0].verification, 'UNVERIFIED'); assert.equal(ev[0].decision, 'UNVERIFIED');
    assert.ok(ev[0].evidenceGaps.some((g) => /Primary source not found/.test(g)));
    assert.equal(ev.filter((e) => e.verification === 'VERIFIED').length, 0, 'detected is not verified');
  });
  test('wording-only India candidates keep the engine\'s exclusions (analyst action, cut, reiteration)', () => {
    const base = { id: 'x', ticker: 'ZZIN1', company: 'Zed One', market: 'IN' as const, text: '', sourceName: 'Mint', publishedAt: NOW.toISOString(), kind: 'NEWS' as const };
    for (const title of ['Brokerage raises Zed One target price to Rs 900', 'Zed One cuts FY27 revenue guidance', 'Zed One maintains FY27 guidance'])
      assert.equal(isRaiseCandidate({ ...base, title }), false, title);
  });
});

describe('5. coverage text: per-source counts, never consensus as the reason', () => {
  const read: IndiaRead = { news: 0, newsScraped: 0, retained: 0, filings: 312, graded: 57, subjectOnly: 2, unresolved: 0, noCompany: 1 };
  const cov = (o: Partial<MarketCoverage> = {}): MarketCoverage => ({ market: 'IN', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null, read, ...o });
  test('zero events: lists what each source returned and names the empty key', () => {
    const l = coverageLine(cov({ cacheEmpty: ['India news cache (news:articles:v39 missing or empty; it expires after 5 minutes and is refreshed hourly)', 'scraped India news (scraped-india-news:v1:latest missing or empty)'] }), NOW);
    assert.match(l, /Empty: India news cache \(news:articles:v39 missing or empty/);
    assert.match(l, /scraped-india-news:v1:latest missing or empty/);
    assert.match(l, /Read: 0 India news items \(cache\), 0 from the scraped news feed, 312 exchange announcements, 57 results rows/);
    assert.match(l, /2 announcements seen with raise text not read/);
    assert.match(l, /1 raise-worded item dropped because no company could be identified/);
    assert.doesNotMatch(l, /consensus/i);
    assert.doesNotMatch(l, /raise candidates|\b0 events\b|No announcement in this window/);
  });
  test('with events the consensus label stays, and ticker-not-resolved is counted', () => {
    const l = coverageLine(cov({ events: 2, withConsensus: 0, candidates: { graded: 0, filings: 0, news: 3 }, read: { ...read, unresolved: 1, noCompany: 0, news: 120, newsScraped: 190 } }), NOW);
    assert.match(l, /3 from news/); assert.match(l, /Consensus available 0 of 2/); assert.match(l, /1 candidate shown with ticker not resolved/);
    assert.match(l, /120 India news items \(cache\), 190 from the scraped news feed/);
  });
  test('name normaliser', () => { assert.equal(normCompanyName('Cupid Limited'), 'cupid'); assert.equal(normCompanyName('CUPID LTD.'), 'cupid'); assert.equal(normCompanyName('Dixon Technologies (India) Ltd'), 'dixon technologies'); });
});

describe('route wiring', () => {
  const r = read('app/api/v1/guidance-upgrades/route.ts').replace(/\/\/.*$/gm, '');
  test('every India input path is read and reported', () => {
    for (const k of ["'news:articles:v39'", "'scraped-india-news:v1:latest'", 'concall-feed:v26:days:', 'gradedKey(', 'loadCatalog(', 'NSE_TICKER_NAMES', 'buildIndiaCandidates(', 'processRaiseCandidates(', 'corroborateWithFilings(', 'labelUnresolved(', 'collectSubjectOnly(', 'istDateList('])
      assert.ok(r.includes(k), k);
    assert.match(r, /Announcements with subject only/); assert.match(r, /Scraped India news/);
    assert.ok(!/dateList\(now, days \+ 1\)/.test(r.replace(/istDateList\(now, days \+ 1\)/g, '')), 'no UTC date list for India');
  });
  test('public, no document fetching, no AI, no secrets', () => {
    assert.ok(!/fetch\(|anthropic|openai|haiku|process\.env|pdf/i.test(r));
    assert.ok(!/from '[^']*(quote|price|yahoo)[^']*'/i.test(r));
  });
  test('growth-guidance shares the India builder and IST dates', () => {
    const g = read('lib/growth-guidance-live.ts');   // pipeline extracted from the route (zzz848); the route calls getLiveGuidance
    assert.match(g, /buildIndiaCandidates\(/); assert.match(g, /istDateList\(/); assert.match(g, /scraped-india-news:v1:latest/);
  });
});
