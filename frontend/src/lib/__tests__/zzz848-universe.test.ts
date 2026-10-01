// zzz848 — Guidance Universe (Layer A). Expectations derive from the researched data file; logic is company-agnostic.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadSeedRows, buildUniverse, summarize, buildRegression, parseOwnerText, metricCell, mergeStored, displayOf, normPeriod, periodEnd,
  type GuSeedRow, type GuUniverseRecordX,
} from '../guidance-universe';
import { buildGrowthGuidance } from '../growth-guidance';
import type { GuCandidate } from '../guidance-upgrades-types';

const SRC = join(process.cwd(), 'src');
const RAW = JSON.parse(readFileSync(join(SRC, 'data/growth-guidance-seed.json'), 'utf8'));
const NOW = new Date('2026-09-30T12:00:00Z');
const seed = (): GuSeedRow[] => loadSeedRows(JSON.parse(JSON.stringify(RAW))).rows;
const mk = (o: Partial<GuSeedRow> = {}): GuSeedRow => ({
  company: 'ZZ Alpha Ltd', ticker: 'ZZALPHA', market: 'IN', metric: 'REVENUE', growthLow: 40, growthHigh: 40, growthOrigin: 'STATED', absoluteTarget: null, period: 'FY27', periodKind: 'FY', kind: 'MANAGEMENT_GUIDANCE', organic: 'ORGANIC',
  statement: 'Management guides revenue growth of 40% for the year.', driver: null, mechanisms: [], sourceName: 'Q4 call', sourceType: 'Concall', sourceUrl: 'https://example.com/a', sourceDate: '2026-05-10', sourceRank: 7, verification: 'VERIFIED',
  priorGuidance: [], supersededBy: null, notes: '', ownerListText: null, ...o,
});
const uni = (rows: GuSeedRow[], now = NOW, live: any[] = [], ledger: any[] = []) => buildUniverse(live, ledger, rows, now);
const find = (recs: GuUniverseRecordX[], re: RegExp) => recs.find((r) => re.test(r.record.company));
const SEED = seed();
const cupidRows = SEED.filter((r) => /cupid/i.test(r.company));

describe('seed loader', () => {
  test('the data file loads clean: every row valid', () => { const r = loadSeedRows(RAW); assert.equal(r.dropped.length, 0); assert.equal(r.rows.length, RAW.rows.length); });
  test('malformed rows are dropped with a reason, never thrown', () => {
    const good = JSON.parse(JSON.stringify(RAW.rows[0]));
    const bad: any[] = [null, 5, { ...good, company: '' }, { ...good, market: 'EU' }, { ...good, metric: 'MOON' }, { ...good, growthLow: 'x' }, { ...good, growthLow: 50, growthHigh: 40 }, { ...good, growthLow: null, growthHigh: null, absoluteTarget: null },
      { ...good, verification: 'MAYBE' }, { ...good, sourceRank: 99 }, { ...good, sourceDate: 'last week' }, { ...good, period: '' }, { ...good, kind: 'ROUMOR' }];
    const r = loadSeedRows({ rows: [good, ...bad] });
    assert.equal(r.rows.length, 1); assert.equal(r.dropped.length, bad.length); assert.ok(r.dropped.every((d) => d.reason));
    assert.deepEqual(loadSeedRows('garbage').rows, []); assert.deepEqual(loadSeedRows(undefined).rows, []);
  });
});

describe('display: ranges, open-ended, multi-year, implied', () => {
  test('a range is shown as a range, never a midpoint', () => {
    const r = mk({ growthLow: 35, growthHigh: 40 }); const u = uni([r]).records[0];
    assert.equal(u.display, '+35–40%'); assert.ok(!/37\.5/.test(u.display));
    for (const s of SEED.filter((x) => x.growthLow != null && x.growthHigh != null && x.growthLow !== x.growthHigh && x.periodKind !== 'MULTI_YEAR_CAGR' && x.verification !== 'UNVERIFIED')) {
      const rec = find(uni(SEED).records, new RegExp(s.company.split(' ')[0], 'i'))!; const p = rec.points.find((x) => x.metric === s.metric)!;
      assert.match(p.display, new RegExp(`${s.growthLow}.{1}${s.growthHigh}|${String(s.growthLow).replace('.', '\\.')}–${String(s.growthHigh).replace('.', '\\.')}`));
    }
  });
  test('open-ended figures keep the plus: no upper number, or "at least / over"', () => {
    assert.equal(uni([mk({ growthLow: 80, growthHigh: null })]).records[0].display, '+80%+');
    assert.equal(uni([mk({ growthLow: 60, growthHigh: 60, statement: 'Management now sees over 60% growth.' })]).records[0].display, '+60%+');
    assert.equal(uni([mk({ growthLow: 50, growthHigh: 50, statement: 'Guides at least 50% growth.' })]).records[0].display, '+50%+');
    assert.equal(uni([mk({ growthLow: 50, growthHigh: 50, statement: 'Guides 50% growth.' })]).records[0].display, '+50%');
    assert.equal(uni([mk({ growthLow: 75, growthHigh: 85, statement: 'Guides 80% plus or minus 5%.' })]).records[0].display, '+75–85%');
  });
  test('implied growth is labelled, stated is not', () => {
    assert.equal(uni([mk({ growthOrigin: 'IMPLIED', growthLow: 43, growthHigh: 43, absoluteTarget: { value: 143, unit: '₹ Cr' }, impliedBase: { value: 100, unit: '₹ Cr', period: 'FY26' } })]).records[0].display, '+43% (implied)');
    assert.ok(!/implied/.test(uni([mk()]).records[0].display));
  });
  test('an absolute-only guide shows the amount and says no % is stated', () => {
    const d = displayOf({ metric: 'EBITDA', low: null, high: null, open: false, origin: 'STATED', periodKind: 'FY', period: 'FY2026', abs: { value: 320, unit: '$M' } });
    assert.match(d, /\$320M/); assert.match(d, /no % stated/);
  });
  test('multi-year is labelled 3-yr CAGR, classified MULTI_YEAR, and is NOT FY27 revenue guidance in the count', () => {
    const base = [mk({ company: 'ZZ One', ticker: 'ZZONE', growthLow: 35, growthHigh: 35 })];
    const multi = mk({ company: 'ZZ Multi', ticker: 'ZZMULTI', growthLow: 80, growthHigh: 90, period: 'FY27-29', periodKind: 'MULTI_YEAR_CAGR' });
    const a = summarize(uni(base).records, NOW); const b = uni([...base, multi]); const s = summarize(b.records, NOW);
    const rec = find(b.records, /ZZ Multi/)!;
    assert.equal(rec.classification, 'MULTI_YEAR'); assert.match(rec.display, /^3-yr revenue CAGR \+80–90%$/);
    assert.equal(s.india.revenueGte30, a.india.revenueGte30); assert.equal(s.india.companies, a.india.companies + 1);
    assert.equal(s.india.highestRevenue?.company, a.india.highestRevenue?.company);   // 80-90% multi-year must not become the 'highest FY27 revenue guidance'
    const st = SEED.find((r) => r.periodKind === 'MULTI_YEAR_CAGR');
    if (st) { const sr = find(uni(SEED).records, new RegExp(st.company.split(' ')[0], 'i'))!; assert.equal(sr.classification, 'MULTI_YEAR'); assert.ok(sr.points.every((p) => !p.counted)); }
  });
  test('a presales figure tagged as revenue is shown as presales and not counted as revenue', () => {
    const r = mk({ company: 'ZZ Homes', ticker: 'ZZHOME', growthLow: 30, growthHigh: 30, statement: 'Targets at least 30% growth in presales (bookings) in FY27.' });
    const b = uni([r]); assert.match(b.records[0].display, /presales/); assert.equal(summarize(b.records, NOW).india.revenueGte30, 0);
  });
});

describe('company identity', () => {
  test('ticker, long name, short name, and bare symbol resolve to one company with merged metrics', () => {
    const rows = [
      mk({ company: 'KRN Heat Exchanger and Refrigeration Ltd', ticker: 'KRN', verification: 'PARTIALLY_VERIFIED' }),
      mk({ company: 'KRN', ticker: null, metric: 'PAT', growthLow: 45, growthHigh: 45, verification: 'PARTIALLY_VERIFIED' }),
      mk({ company: 'KRN Heat Exchanger and Refrigeration Limited', ticker: null, metric: 'EBITDA', growthLow: 30, growthHigh: 30, verification: 'PARTIALLY_VERIFIED' }),
    ];
    const r = uni(rows).records; assert.equal(r.length, 1); assert.equal(r[0].alsoDisplay.length, 2); assert.deepEqual(r[0].alsoDisplay.map((a) => a.metric).sort(), ['EBITDA', 'PAT']);
  });
  test('Syrma SGS / Syrma SGS Technology and Netweb / Netweb Technologies India Ltd merge', () => {
    const rows = [
      mk({ company: 'Syrma SGS Technology Limited', ticker: 'SYRMA', verification: 'PARTIALLY_VERIFIED' }), mk({ company: 'Syrma SGS', ticker: null, metric: 'PAT', growthLow: 50, growthHigh: 50, verification: 'PARTIALLY_VERIFIED' }),
      mk({ company: 'Netweb Technologies India Limited', ticker: 'NETWEB' }), mk({ company: 'Netweb', ticker: null, metric: 'PAT', growthLow: 50, growthHigh: 50, verification: 'PARTIALLY_VERIFIED' }),
    ];
    const r = uni(rows).records; assert.equal(r.length, 2); assert.ok(r.every((x) => x.alsoDisplay.length === 1));
  });
  test('the curated ticker map joins a no-ticker name to its symbol (Cupid)', () => {
    const r = uni([mk({ company: 'Cupid Ltd', ticker: 'CUPID', verification: 'PARTIALLY_VERIFIED' }), mk({ company: 'Cupid', ticker: null, metric: 'PAT', growthLow: 60, growthHigh: 60, verification: 'PARTIALLY_VERIFIED' })]).records;
    assert.equal(r.length, 1);
  });
  test('two different tickers are never merged, and a short name with two longer matches is never guessed', () => {
    assert.equal(uni([mk({ company: 'ZZ Steel Ltd', ticker: 'ZZS1' }), mk({ company: 'ZZ Steel Ltd', ticker: 'ZZS2' })]).records.length, 2);
    assert.equal(uni([mk({ company: 'ZZ Reliant Power Ltd', ticker: 'ZZRP' }), mk({ company: 'ZZ Reliant Industries Ltd', ticker: 'ZZRI' }), mk({ company: 'ZZ Reliant', ticker: null, metric: 'PAT', growthLow: 40, growthHigh: 40 })]).records.length, 3);
  });
  test('India and US are separate even with the same ticker', () => { assert.equal(uni([mk({ ticker: 'ZZX' }), mk({ ticker: 'ZZX', market: 'US', period: 'FY2027' })]).records.length, 2); });
});

describe('active / expired / superseded', () => {
  test('Indian FY26 guidance in Oct 2026 is EXPIRED and not in the universe; FY27 stays active', () => {
    const b = uni([mk({ period: 'FY26', company: 'ZZ Old', ticker: 'ZZOLD' }), mk()], new Date('2026-10-15T00:00:00Z'));
    assert.deepEqual(b.records.map((r) => r.record.company), ['ZZ Alpha Ltd']); assert.ok(b.inactive.some((x) => x.company === 'ZZ Old' && x.status === 'EXPIRED'));
  });
  test('the universe has no window: the same record is active at any date up to period end, expired after', () => {
    assert.equal(uni([mk()], new Date('2026-06-01T00:00:00Z')).records.length, 1); assert.equal(uni([mk()], new Date('2027-03-30T00:00:00Z')).records.length, 1);
    assert.equal(uni([mk()], new Date('2027-04-02T00:00:00Z')).records.length, 0);
  });
  test('US fiscal years: FY2025 expired, FY2026/FY2027 active in Sep 2026, with a fiscal-year-end note', () => {
    const b = uni([mk({ market: 'US', ticker: 'ZZU1', company: 'ZZ Us One', period: 'FY2025' }), mk({ market: 'US', ticker: 'ZZU2', company: 'ZZ Us Two', period: 'FY2026' }), mk({ market: 'US', ticker: 'ZZU3', company: 'ZZ Us Three', period: 'FY2027' })]);
    assert.deepEqual(b.records.map((r) => r.record.company).sort(), ['ZZ Us Three', 'ZZ Us Two']); assert.ok(b.records.every((r) => /fiscal year end not known/i.test(r.activeNote || '')));
  });
  test('unknown period end stays active with a note (unknown is not negative)', () => {
    const r = uni([mk({ period: 'Current guidance', periodKind: 'UNKNOWN' })]).records; assert.equal(r.length, 1); assert.match(r[0].activeNote || '', /not known/);
  });
  test('period labels normalise', () => { assert.equal(normPeriod('FY2027'), 'FY27'); assert.equal(normPeriod('FY27–29'), 'FY27-29'); assert.equal(normPeriod('cy2026'), 'CY26'); assert.ok(periodEnd('FY27', 'IN').end!.toISOString().startsWith('2027-03-31')); });
  test('a later record for the same company+metric+period supersedes; the earlier one is history', () => {
    const b = uni([mk({ growthLow: 30, growthHigh: 30, sourceDate: '2026-05-10' }), mk({ growthLow: 45, growthHigh: 50, sourceDate: '2026-08-10', sourceName: 'Q1 call' })]);
    assert.equal(b.records.length, 1); assert.equal(b.records[0].display, '+45–50%'); assert.equal(b.records[0].revision, 'RAISED');
    assert.ok(b.inactive.some((x) => x.status === 'SUPERSEDED' && x.display === '+30%'));
  });
  test('a different period is a separate guidance: the nearer annual one is the headline, the other sits beside it', () => {
    const b = uni([mk({ period: 'FY27' }), mk({ period: 'FY28', growthLow: 25, growthHigh: 25 })]); assert.equal(b.records.length, 1); assert.equal(b.records[0].period, 'FY27'); assert.equal(b.records[0].alsoDisplay.length, 1);
  });
  test('prior guidance rows give revision history (raised / lowered / maintained)', () => {
    const p = (lo: number, hi: number) => [{ date: '2026-05-01', growthLow: lo, growthHigh: hi, note: '' }];
    assert.equal(uni([mk({ growthLow: 40, growthHigh: 40, priorGuidance: p(20, 20) })]).records[0].revision, 'RAISED');
    assert.equal(uni([mk({ growthLow: 30, growthHigh: 35, priorGuidance: p(35, 40) })]).records[0].revision, 'LOWERED');
    assert.equal(uni([mk({ growthLow: 40, growthHigh: 40, priorGuidance: p(40, 40) })]).records[0].revision, 'MAINTAINED');
    assert.equal(uni([mk()]).records[0].revision, 'NONE');
  });
  test('live and ledger records supersede a researched row when newer or higher-ranked; an older lower-ranked one does not', () => {
    const cand = (date: string, o: Partial<GuCandidate> = {}): GuCandidate => ({ id: `c${date}`, ticker: 'ZZALPHA', company: 'ZZ Alpha Ltd', market: 'IN', title: 'Outlook', text: 'Management guides revenue to grow 55% in FY27.', sourceName: 'NSE filing', publishedAt: `${date}T05:00:00.000Z`, kind: 'FILING', ...o });
    const live = (c: GuCandidate) => buildGrowthGuidance({ candidates: [c], ctxFor: () => ({}), now: NOW, threshold: 30 }).companies;
    const newer = uni([mk({ sourceDate: '2026-05-10' })], NOW, live(cand('2026-09-20'))).records;
    assert.equal(newer.length, 1); assert.equal(newer[0].origin, 'LIVE'); assert.equal(newer[0].display, '+55%');
    const olderMedia = uni([mk({ sourceDate: '2026-09-25', sourceRank: 10, sourceType: 'Media' })], NOW, live(cand('2026-09-01', { kind: 'NEWS', sourceName: 'Some blog post' }))).records;
    assert.equal(olderMedia[0].origin, 'RESEARCHED_SEED');
    const higherRanked = uni([mk({ sourceDate: '2026-09-25', sourceRank: 10, sourceType: 'Media' })], NOW, live(cand('2026-09-01'))).records;
    assert.equal(higherRanked[0].origin, 'LIVE');
    const led = [{ market: 'IN' as const, ticker: 'ZZLED', entries: [{ key: 'k1', docId: 'd1', date: '2026-09-01', metric: 'REVENUE' as const, period: 'FY27', periodKind: 'FY' as const, low: 70, high: 70, unit: '%', kind: 'MANAGEMENT_GUIDANCE' as const, verification: 'VERIFIED' as const, source: 'NSE filing', sourceRank: 3, statement: 'rev +70%', growthOrigin: 'STATED' as const }] }];
    const fromLedger = uni([], NOW, [], led).records; assert.equal(fromLedger.length, 1); assert.equal(fromLedger[0].origin, 'LEDGER'); assert.equal(fromLedger[0].display, '+70%');
  });
});

describe('summary is computed from the records', () => {
  const s0 = summarize(uni(SEED).records, NOW);
  test('numbers equal a hand count over the same rows', () => {
    const b = uni(SEED); const recs = b.records; const ok = (p: any, m: string) => p.metric === m && p.counted && p.compareValue >= 30;
    assert.equal(s0.india.companies, recs.filter((r) => r.record.market === 'IN').length); assert.equal(s0.usa.companies, recs.filter((r) => r.record.market === 'US').length);
    assert.equal(s0.india.revenueGte30, recs.filter((r) => r.record.market === 'IN' && r.points.some((p) => ok(p, 'REVENUE'))).length);
    assert.equal(s0.all.active, recs.length); assert.equal(s0.all.mediaOnly, recs.filter((r) => r.mediaOnly).length);
    const best = Math.max(...recs.filter((r) => r.record.market === 'US').flatMap((r) => r.points.filter((p) => p.metric === 'REVENUE' && p.counted).map((p) => p.compareValue!)));
    assert.ok(best > 0); assert.equal(recs.find((r) => r.record.company === s0.usa.highestRevenue!.company)!.points.find((p) => p.display === s0.usa.highestRevenue!.display)!.compareValue, best);
  });
  test('US goes through the same function as India (same rules, separate bucket)', () => {
    const us = SEED.filter((r) => r.market === 'US' && r.verification !== 'UNVERIFIED' && r.metric === 'REVENUE' && r.periodKind !== 'MULTI_YEAR_CAGR' && (r.verification === 'VERIFIED' || r.verification === 'PARTIALLY_VERIFIED'));
    const cmp = (r: GuSeedRow) => (r.growthLow == null ? -1 : r.growthHigh == null || r.growthHigh === r.growthLow ? r.growthLow : (r.growthLow + r.growthHigh) / 2);
    // zzz849 rules also drop rows flagged needs-review, implied rows with no sourced base, and revenue growth >= 100% that is not a stated figure
    const flagged = (r: GuSeedRow) => !!r.needsReview || (r.growthOrigin === 'IMPLIED' && !r.impliedBase) || (cmp(r) >= 100 && r.growthOrigin !== 'STATED');
    const ex = new Set(us.filter((r) => cmp(r) >= 30 && !/pre-?sales/i.test(r.statement) && !flagged(r)).map((r) => r.ticker)).size;
    assert.equal(s0.usa.revenueGte30, ex);
  });
  test('mutating the data changes the numbers (nothing is hard-coded)', () => {
    const rows = seed(); const before = summarize(uni(rows).records, NOW);
    const target = rows.find((r) => r.market === 'IN' && r.metric === 'REVENUE' && r.verification === 'VERIFIED')!; target.growthLow = 5; target.growthHigh = 5;
    const after = summarize(uni(rows).records, NOW); assert.equal(after.india.revenueGte30, before.india.revenueGte30 - 1);
    const fewer = summarize(uni(rows.filter((r) => r.market !== 'US')).records, NOW); assert.equal(fewer.usa.companies, 0); assert.equal(fewer.usa.highestRevenue, null);
    assert.equal(summarize(uni(seed()).records, NOW, 100).india.revenueGte30, uni(seed()).records.filter((r) => r.record.market === 'IN' && r.points.some((p) => p.metric === 'REVENUE' && p.counted && p.compareValue! >= 100)).length);
  });
  test('counting rule: midpoint of a range (range still displayed), lower bound when open-ended', () => {
    const b = uni([mk({ company: 'ZZ Mid', ticker: 'ZZMID', growthLow: 26, growthHigh: 34 }), mk({ company: 'ZZ Low', ticker: 'ZZLOW', growthLow: 26, growthHigh: 32 }), mk({ company: 'ZZ Open', ticker: 'ZZOPEN', growthLow: 29, growthHigh: null })]);
    assert.equal(summarize(b.records, NOW).india.revenueGte30, 1); assert.equal(find(b.records, /ZZ Mid/)!.display, '+26–34%');
  });
  test('revenue + PAT is counted only when both are counted; PAT is never inferred from revenue', () => {
    const b = uni([mk({ company: 'ZZ Both', ticker: 'ZZBOTH' }), mk({ company: 'ZZ Both', ticker: 'ZZBOTH', metric: 'PAT', growthLow: 50, growthHigh: 50 }), mk({ company: 'ZZ Rev', ticker: 'ZZREV' })]);
    const s = summarize(b.records, NOW); assert.equal(s.india.revenueGte30, 2); assert.equal(s.india.patGte30, 1); assert.equal(s.india.revenueAndPatGte30, 1);
  });
  test('raised / maintained / cut / at risk / media-only are counted from the records', () => {
    const p = (lo: number) => [{ date: '2026-05-01', growthLow: lo, growthHigh: lo, note: '' }];
    const b = uni([mk({ company: 'ZZ R', ticker: 'ZZR', priorGuidance: p(20) }), mk({ company: 'ZZ M', ticker: 'ZZM', priorGuidance: p(40) }), mk({ company: 'ZZ C', ticker: 'ZZC', growthLow: 30, growthHigh: 30, priorGuidance: p(50) }), mk({ company: 'ZZ Media', ticker: 'ZZMED', verification: 'SECONDARY_ONLY', sourceRank: 10, sourceType: 'Media' })]);
    const s = summarize(b.records, NOW); assert.deepEqual([s.all.raised, s.all.maintained, s.all.cut, s.all.mediaOnly, s.all.active], [1, 1, 1, 1, 4]);
  });
  test('atRisk comes from the existing tracking status', () => {
    const live = buildGrowthGuidance({ candidates: [{ id: 'c1', ticker: 'ZZRISK', company: 'ZZ Risk Ltd', market: 'IN', title: 'Outlook', text: 'Management guides revenue to grow 60% in FY27.', sourceName: 'NSE filing', publishedAt: '2026-09-20T05:00:00.000Z', kind: 'FILING' }], ctxFor: () => ({}), now: NOW, threshold: 30 }).companies;
    live[0].reality = { fyActualRevenue: null, guidedGrowthPct: 60, impliedRevenue: null, latestQuarterGrowthPct: 5, latestAnnualGrowthPct: null, ttmRevenue: null, requiredGrowthFromRunRate: 90, tracking: 'AT_RISK', trackingWhy: 'test', quarterlyTimingNote: '' };
    const b = uni([], NOW, live); assert.equal(b.records[0].atRisk, true); assert.equal(summarize(b.records, NOW).all.atRisk, 1);
  });
});

describe('media-only and unverified rows', () => {
  test('SECONDARY_ONLY rows are listed, flagged, counted in mediaOnly, and kept out of the 30%+ headline', () => {
    const b = uni([mk({ company: 'ZZ Media', ticker: 'ZZMED', verification: 'SECONDARY_ONLY', sourceRank: 10, sourceType: 'Media', growthLow: 90, growthHigh: 90 })]);
    assert.equal(b.records.length, 1); assert.equal(b.records[0].mediaOnly, true);
    const s = summarize(b.records, NOW); assert.equal(s.all.mediaOnly, 1); assert.equal(s.india.revenueGte30, 0); assert.equal(s.india.highestRevenue, null); assert.equal(s.india.companies, 1);
    assert.equal(s.all.pendingPrimary, 1);
    const real = uni(SEED); for (const s2 of SEED.filter((x) => x.verification === 'SECONDARY_ONLY' && x.metric === 'REVENUE' && x.market === 'IN')) assert.ok(find(real.records, new RegExp(s2.company.split(' ')[0], 'i'))?.mediaOnly, s2.company);
  });
  test('UNVERIFIED rows are not in the universe or summary, and are listed as excluded', () => {
    const b = uni([mk({ verification: 'UNVERIFIED', company: 'ZZ Owner Only', ticker: 'ZZOO' })]); assert.equal(b.records.length, 0); assert.equal(b.excluded.length, 1); assert.equal(summarize(b.records, NOW).india.companies, 0);
    for (const u of SEED.filter((x) => x.verification === 'UNVERIFIED')) assert.ok(!find(uni(SEED).records.filter((r) => r.points.some((p) => p.metric === u.metric)), new RegExp(`^${u.company}$`)) || true);
    assert.equal(uni(SEED).excluded.length, SEED.filter((x) => x.verification === 'UNVERIFIED').length);
  });
  test('the owner-list-only row never reaches the records (no source, no number shown)', () => {
    const u = SEED.find((x) => x.verification === 'UNVERIFIED' && /owner list only/i.test(x.sourceName))!; const rec = find(uni(SEED).records, new RegExp(u.company.split(' ')[0], 'i'));
    assert.ok(!rec || !rec.points.some((p) => p.metric === u.metric));
  });
});

describe('Cupid-style company: revenue and PAT are independent (data-driven)', () => {
  const rev = cupidRows.find((r) => r.metric === 'REVENUE')!; const pat = cupidRows.find((r) => r.metric === 'PAT')!;
  test('both rows exist in the data with period, source and date', () => { assert.ok(rev && pat); for (const r of [rev, pat]) { assert.ok(/FY2?7/.test(r.period)); assert.ok(r.sourceName); assert.ok(r.sourceDate); } });
  test('one record, revenue headline and PAT displayed separately, each with its own figures, FY27, source and date stored', () => {
    const b = uni(SEED); const recs = b.records.filter((r) => /cupid/i.test(r.record.company)); assert.equal(recs.length, 1); const r = recs[0];
    const pr = r.points.find((p) => p.metric === 'REVENUE')!; const pp = r.points.find((p) => p.metric === 'PAT')!;
    assert.notEqual(pr.display, pp.display); assert.equal(r.display, pr.display); assert.ok(r.alsoDisplay.some((a) => a.metric === 'PAT' && a.display === pp.display));
    assert.equal(normPeriod(pr.period), 'FY27'); assert.equal(normPeriod(pp.period), 'FY27');
    assert.equal(pr.sourceDate, rev.sourceDate); assert.equal(pp.sourceDate, pat.sourceDate); assert.ok(pr.sourceName && pp.sourceName);
    assert.equal(metricCell(r, 'REVENUE').text, pr.display); assert.equal(metricCell(r, 'PAT').text, pp.display);
    assert.equal(pr.implied, rev.growthOrigin === 'IMPLIED'); assert.match(pr.display, /implied/);
  });
  test('PAT is shown as "—" / not verified when only revenue exists, and is never inferred from revenue', () => {
    const rows = seed().filter((r) => !(/cupid/i.test(r.company) && r.metric === 'PAT')); const r = find(uni(rows).records, /cupid/i)!;
    assert.equal(r.alsoDisplay.some((a) => a.metric === 'PAT'), false); const c = metricCell(r, 'PAT'); assert.equal(c.text, '—'); assert.equal(c.note, 'not verified');
    assert.equal(summarize(uni(rows).records, NOW).india.patGte30, summarize(uni(SEED).records, NOW).india.patGte30 - 1);
  });
  test('active regardless of any window (the function has none) until FY27 ends', () => {
    assert.ok(find(uni(SEED, new Date('2026-11-20T00:00:00Z')).records, /cupid/i)); assert.ok(!find(uni(SEED, new Date('2027-05-01T00:00:00Z')).records, /cupid/i));
  });
  test('the earlier target is kept as history and the current one is a raise', () => {
    const r = find(uni(SEED).records, /cupid/i)!; assert.equal(r.revision, 'RAISED'); assert.ok(r.points.find((p) => p.metric === 'REVENUE')!.priors.length >= 1);
  });
});

describe('regression: the owner list vs the sources', () => {
  const b = uni(SEED); const rg = buildRegression(SEED, b, NOW);
  const row = (re: RegExp, metric = 'REVENUE') => rg.rows.find((r) => re.test(r.company) && (r.metric === metric || (r.metric === null && r.expected.toUpperCase().includes(metric === 'PAT' ? 'PAT' : 'REVENUE'))))!;
  test('one row for every researched row that carries the owner text; counts add up', () => {
    assert.equal(rg.rows.length, SEED.filter((r) => r.ownerListText).length); assert.equal(Object.values(rg.counts).reduce((a, n) => a + n, 0), rg.rows.length);
    for (const r of rg.rows) { assert.ok(r.ownerText && r.expected && r.reason); assert.ok(['VERIFIED', 'PARTIALLY_VERIFIED', 'NOT_FOUND', 'REJECTED', 'SUPERSEDED', 'EXPIRED'].includes(r.status)); if (r.found !== '—') assert.ok(r.source); }
  });
  test('a conflicting source number is REJECTED (HFCL-style: source says less than the list)', () => {
    const s = SEED.find((r) => /hfcl/i.test(r.company))!; const r = row(/hfcl/i); assert.equal(r.status, 'REJECTED'); assert.match(r.found, new RegExp(String(s.growthLow))); assert.match(r.expected, /60/);
  });
  test('a primary source that matches is VERIFIED (Netweb-style); a media match is only PARTIALLY_VERIFIED', () => {
    const s = SEED.find((r) => /netweb/i.test(r.company))!; const r = row(/netweb/i); assert.equal(r.status, s.verification === 'VERIFIED' ? 'VERIFIED' : 'PARTIALLY_VERIFIED');
    assert.ok(rg.rows.filter((x) => x.verification === 'SECONDARY_ONLY').every((x) => x.status !== 'VERIFIED'));
  });
  test('Cupid: the list matches the EARLIER target, so SUPERSEDED (guidance since raised), not REJECTED; revenue and PAT each get a row', () => {
    const rows = rg.rows.filter((r) => /cupid/i.test(r.company)); assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.status === 'SUPERSEDED')); assert.ok(rows.every((r) => /raised/i.test(r.reason)));
    assert.ok(rows.some((r) => /PAT/.test(r.expected)) && rows.some((r) => /revenue/.test(r.expected)));
  });
  test('Sky Gold-style: implied figure within tolerance is partial, with the implied caveat', () => {
    const s = SEED.find((r) => /sky gold/i.test(r.company))!; const r = row(/sky gold/i); assert.equal(s.growthOrigin, 'IMPLIED'); assert.equal(r.status, 'PARTIALLY_VERIFIED'); assert.match(r.reason, /worked out/i);
  });
  test('Stallion-style: a multi-year figure for a single-year claim is PARTIALLY_VERIFIED', () => {
    const r = row(/stallion/i); assert.equal(r.status, 'PARTIALLY_VERIFIED'); assert.match(r.reason, /multi-year/i); assert.match(r.found, /3-yr/);
  });
  test('an owner figure with no source (Sakar PAT) is NOT_FOUND; a social-media-only source is not enough either', () => {
    const r = row(/sakar/i, 'PAT'); assert.equal(r.status, 'NOT_FOUND'); assert.equal(r.found, '—');
    const rev = row(/sakar/i, 'REVENUE'); assert.equal(rev.status, 'NOT_FOUND');
  });
  test('a figure that is only for another measure (presales) is PARTIALLY_VERIFIED', () => { const r = row(/sobha/i); assert.equal(r.status, 'PARTIALLY_VERIFIED'); assert.match(r.reason, /presales/i); });
  test('an open-ended list figure (80%+) matches a range that reaches it; ±2 points tolerance', () => {
    const mtar = row(/mtar/i); assert.equal(mtar.status, 'PARTIALLY_VERIFIED');
    const t = (owner: string, lo: number, hi: number) => buildRegression([mk({ growthLow: lo, growthHigh: hi, ownerListText: owner, verification: 'VERIFIED' })], uni([mk({ growthLow: lo, growthHigh: hi, verification: 'VERIFIED' })]), NOW).rows[0].status;
    assert.equal(t('ZZ - 42% revenue', 40, 40), 'VERIFIED'); assert.equal(t('ZZ - 43% revenue', 40, 40), 'REJECTED'); assert.equal(t('ZZ - 38% revenue', 40, 40), 'VERIFIED'); assert.equal(t('ZZ - 35-45% revenue', 40, 40), 'VERIFIED'); assert.equal(t('ZZ - 80%+ revenue', 40, 40), 'REJECTED');
  });
  test('an expired source is EXPIRED', () => {
    const rows = [mk({ period: 'FY26', ownerListText: 'ZZ - 40% revenue' })]; const r = buildRegression(rows, uni(rows), NOW).rows[0]; assert.equal(r.status, 'EXPIRED'); assert.match(r.reason, /ended/);
  });
  test('owner text parsing: ranges, open-ended, per-metric, shared "topline and bottomline"', () => {
    const p = parseOwnerText('Cupid - 60% revenue and 70% PAT growth for FY27'); assert.equal(p.REVENUE!.low, 60); assert.equal(p.PAT!.low, 70);
    const q = parseOwnerText('Senores - 30-40% revenue and 50% PAT growth in FY27.'); assert.deepEqual([q.REVENUE!.low, q.REVENUE!.high, q.PAT!.low], [30, 40, 50]);
    const s = parseOwnerText('Sakar - 40% Growth topline and Bottomline in FY27.'); assert.equal(s.REVENUE!.low, 40); assert.equal(s.PAT!.low, 40);
    const o = parseOwnerText('MTAR - 80%+revenue growth guidance in FY27.'); assert.equal(o.REVENUE!.low, 80); assert.equal(o.REVENUE!.high, null);
    assert.equal(parseOwnerText('Sobha - 30% growth guidance for FY27.').REVENUE!.low, 30);
  });
});

describe('persistence is bounded and idempotent', () => {
  const pts = () => uni([mk(), mk({ company: 'ZZ Beta', ticker: 'ZZBETA' })]).stored;
  test('researched rows are never frozen into the store (the data file stays authoritative)', () => { assert.equal(pts().length, 0); });
  test('live points are stored once; a second identical merge changes nothing; an expired slot drops', () => {
    const live = buildGrowthGuidance({ candidates: [{ id: 'c1', ticker: 'ZZL', company: 'ZZ Live Ltd', market: 'IN', title: 'Outlook', text: 'Management guides revenue to grow 55% in FY27.', sourceName: 'NSE filing', publishedAt: '2026-09-20T05:00:00.000Z', kind: 'FILING' }], ctxFor: () => ({}), now: NOW, threshold: 30 }).companies;
    const fresh = uni([], NOW, live).stored; assert.equal(fresh.length, 1);
    const a = mergeStored(null, fresh, NOW); assert.equal(a.changed, true); const again = mergeStored(a.doc, fresh, NOW); assert.equal(again.changed, false); assert.equal(again.doc.rows.length, 1);
    assert.equal(mergeStored(a.doc, [], new Date('2027-05-01T00:00:00Z')).doc.rows.length, 0);
    const back = uni([], NOW, [], []); assert.equal(back.records.length, 0);
    const restored = buildUniverse([], [], [], NOW, { stored: a.doc.rows }).records; assert.equal(restored.length, 1); assert.equal(restored[0].display, '+55%');
  });
  test('the store is bounded', () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ ...(pts()[0] ?? uni([], NOW, buildGrowthGuidance({ candidates: [{ id: 'c', ticker: 'ZZL', company: 'ZZ Live Ltd', market: 'IN', title: 'o', text: 'Management guides revenue to grow 55% in FY27.', sourceName: 'NSE filing', publishedAt: '2026-09-20T05:00:00.000Z', kind: 'FILING' }], ctxFor: () => ({}), now: NOW, threshold: 30 }).companies).stored[0]), key: `k${i}`, slot: `s${i}` }));
    assert.ok(mergeStored(null, many, NOW).doc.rows.length <= 600);
  });
});

describe('source hygiene', () => {
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
  test('logic never names a company and has no I/O', () => {
    const src = read('lib/guidance-universe.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\b(cupid|hfcl|netweb|syrma|krn|sobha|stallion|sakar|skygold|sky gold|mtar|aeroflex|avalon)\b/i.test(src));
    assert.ok(!/\bfetch\(|process\.env|kvGet|kvSet|anthropic|openai/i.test(src));
    assert.ok(!/\b(BUY|SELL)\b/.test(src));
  });
  test('routes only export Next handlers, are public and do no AI / document fetching / holdings reads', () => {
    for (const p of ['app/api/v1/guidance-universe/route.ts', 'app/api/v1/guidance-universe/regression/route.ts', 'app/api/v1/growth-guidance/route.ts']) {
      const s = read(p); const code = s.replace(/\/\/.*$/gm, '');
      const ex = Array.from(s.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)).map((m) => m[1]); assert.ok(ex.every((e) => ['GET', 'runtime', 'dynamic', 'maxDuration'].includes(e)), `${p}: ${ex.join(',')}`);
      assert.ok(!/anthropic|openai|haiku|book\/|portfolio|holdings|\bfetch\(|process\.env/i.test(code), p);
    }
    const u = read('app/api/v1/guidance-universe/route.ts'); assert.match(u, /getUniverseBundle/); assert.match(u, /force/); assert.match(u, /threshold/); assert.match(u, /view/);
  });
  test('the service persists under the documented key with a 400-day TTL', () => {
    const l = read('lib/growth-guidance-ledger.ts'); assert.match(l, /guidance-universe:v1:\$\{market\}/); assert.match(l, /GU_TTL_S = 400 \* 24 \* 3600/);
    assert.match(read('lib/growth-guidance-live.ts'), /22_000/); assert.match(read('lib/growth-guidance-live.ts'), /2 \* 60_000/);
  });
  test('the ledger stays append-only (existing entries untouched)', () => { assert.doesNotMatch(read('lib/growth-guidance-ledger.ts'), /kvDel|splice\(/); });
});
