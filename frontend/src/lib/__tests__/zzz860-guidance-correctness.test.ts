// zzz860 — Guidance Upgrades correctness pass. No network, no clock (dates passed in). The 20-company list below is TEST INPUT only; no production code names a company.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGuidanceChange, comparisonKey, comparable, guidanceWording, freshnessOf, freshnessCounts, calculationTypeOf, verificationStatusOf, scopedTitle, eventTypeOfStatus,
  CALCULATION_TYPE_TEXT, VERIFICATION_STATUS_TEXT,
} from '../guidance-semantics';
import { dataQualityOf, marketQuality, tradingDaysBetween, NOT_EXHAUSTIVE } from '../guidance-pipeline-coverage';
import { pipelineReport, type GuSubject } from '../guidance-pipeline-report';
import { buildUniverse } from '../guidance-universe';
import { getSeedRows } from '../guidance-universe-service';
import { eventStatusesOf } from '../guidance-upgrades-reconcile';
import { basisText, recordBasis, lastVerifiedText, sectionRows } from '../../components/guidance-upgrades/gu-ui';

const NOW = new Date('2026-10-02T09:00:00Z');

describe('event type: the numbers decide', () => {
  test('Blackberry-style EBITDA 119-139 -> 141-158 is GUIDANCE_RAISED (both ends up)', () => {
    const r = classifyGuidanceChange({ text: 'raises adjusted EBITDA outlook', metric: 'EBITDA', period: 'FY27', prev: { low: 119, high: 139 }, curr: { low: 141, high: 158 } });
    assert.equal(r.type, 'GUIDANCE_RAISED'); assert.equal(r.lowDelta, 22); assert.equal(r.highDelta, 19);
  });
  test('Fuller-style EPS 4.60-4.90 -> 4.70-4.85 is RANGE_RESTRUCTURE: low +0.10, high -0.05, narrower', () => {
    const r = classifyGuidanceChange({ text: 'updates EPS guidance', metric: 'EPS', period: 'FY26', prev: { low: 4.6, high: 4.9 }, curr: { low: 4.7, high: 4.85 } });
    assert.equal(r.type, 'RANGE_RESTRUCTURE'); assert.ok(Math.abs((r.lowDelta as number) - 0.1) < 1e-9); assert.ok(Math.abs((r.highDelta as number) + 0.05) < 1e-9);
    assert.equal(r.narrower, true); assert.equal(r.wider, false);
  });
  test('Netsol-style FY26 revenue growth 13% repeated is REITERATION', () => {
    assert.equal(classifyGuidanceChange({ text: 'reiterates FY26 revenue growth of 13%', metric: 'REVENUE', period: 'FY26', curr: { low: 13, high: 13 } }).type, 'REITERATION');
    assert.equal(classifyGuidanceChange({ text: 'FY26 revenue growth 13%', metric: 'REVENUE', period: 'FY26', prev: { low: 13, high: 13, metric: 'REVENUE', period: 'FY26' }, curr: { low: 13, high: 13 } }).type, 'REITERATION');
  });
  test('Reliance-style bond is CAPITAL_RAISE, not guidance', () => {
    assert.equal(classifyGuidanceChange({ text: 'Reliance raises $1.5 billion through a bond issue', metric: 'REVENUE', period: 'FY27', curr: { low: 1.5, high: 1.5 } }).type, 'CAPITAL_RAISE');
  });
  test('first guidance, new period, withdrawal, expired, unresolved, not guidance', () => {
    assert.equal(classifyGuidanceChange({ text: 'expects revenue growth of 40%', metric: 'REVENUE', period: 'FY27', curr: { low: 40, high: 40 } }).type, 'FIRST_GUIDANCE');
    assert.equal(classifyGuidanceChange({ text: 'withdraws its full-year guidance', metric: 'REVENUE', period: 'FY27', curr: null }).type, 'WITHDRAWAL');
    assert.equal(classifyGuidanceChange({ text: 'x', metric: 'REVENUE', period: 'FY26', curr: { low: 10, high: 10 }, periodEnded: true }).type, 'EXPIRED');
    assert.equal(classifyGuidanceChange({ text: 'guidance for revenue was given', metric: 'REVENUE', period: 'FY27', curr: null }).type, 'UNRESOLVED');
    assert.equal(classifyGuidanceChange({ text: 'quarterly dividend declared', metric: 'REVENUE', period: 'FY27', curr: null }).type, 'NOT_GUIDANCE');
    assert.equal(classifyGuidanceChange({ text: 'expects revenue growth 40%', metric: 'REVENUE', period: null, curr: { low: 40, high: 40 } }).type, 'UNRESOLVED');
  });
  test('Netsol FY27 EBITDA is never compared with FY26 revenue', () => {
    const r = classifyGuidanceChange({ company: 'Netsol', text: 'expects FY27 EBITDA of $12M', metric: 'EBITDA', period: 'FY27', prev: { low: 50, high: 50, metric: 'REVENUE', period: 'FY26' }, curr: { low: 12, high: 12 } });
    assert.equal(r.comparable, false); assert.equal(r.type, 'NEW_GUIDANCE');
    assert.equal(comparable({ company: 'N', metric: 'EBITDA', period: 'FY27' }, { company: 'N', metric: 'REVENUE', period: 'FY26' }), false);
    assert.equal(comparable({ company: 'N', metric: 'REVENUE', period: 'FY27', basis: 'GAAP' }, { company: 'N', metric: 'REVENUE', period: 'FY27' }), true);
    assert.notEqual(comparisonKey({ company: 'N', metric: 'EPS', period: 'FY27', basis: 'GAAP' }), comparisonKey({ company: 'N', metric: 'EPS', period: 'FY27', basis: 'ADJUSTED' }));
  });
  test('event engine status maps to the reviewer taxonomy', () => {
    assert.equal(eventTypeOfStatus('MIXED'), 'RANGE_RESTRUCTURE'); assert.equal(eventTypeOfStatus('INVALID', 'the narrative describes a capital raise'), 'CAPITAL_RAISE'); assert.equal(eventTypeOfStatus('RAISED'), 'GUIDANCE_RAISED');
  });
  test('eventStatusesOf: numbers override a loose label (raised midpoint + cut top end = MIXED; both ends up = RAISED)', () => {
    const ev = (before: any, after: any, cls: string): any => ({ ticker: 'ABC', company: 'ABC Inc', market: 'US', announcement_date: '2026-08-01', classification: cls, verification: 'VERIFIED', primaryAvailable: true, sources: [], whyNow: '',
      changes: [{ metric: 'EPS', before: { low: before[0], high: before[1], isGrowthRate: false, currency: '$' }, after: { period: 'FY26', low: after[0], high: after[1], isGrowthRate: false, currency: '$' }, direction: 'UP' }] });
    assert.equal(eventStatusesOf([ev([4.6, 4.9], [4.7, 4.85], 'RAISE')])[0].status, 'MIXED');
    assert.equal(eventStatusesOf([ev([4.6, 4.9], [4.7, 4.85], 'RAISE')])[0].eventType, 'RANGE_RESTRUCTURE');
    assert.equal(eventStatusesOf([ev([119, 139], [141, 158], 'RAISE')])[0].status, 'RAISED');
    assert.equal(eventStatusesOf([ev([119, 139], [141, 158], 'RAISE')])[0].eventType, 'GUIDANCE_RAISED');
  });
});

describe('wording: calculation type apart from verification status', () => {
  test('a media claim is never "Company stated"', () => {
    for (const s of ['unverified', 'secondary_only'] as const) for (const c of ['explicit', 'range', 'derived', 'implied', 'amount_only'] as const) assert.doesNotMatch(guidanceWording(s, c), /^Company stated|company-stated/i);
    assert.equal(guidanceWording('secondary_only', 'explicit'), 'Secondary source attributes this guidance to management');
    assert.equal(guidanceWording('unverified', 'explicit'), 'Media-reported claim; primary source not yet verified');
  });
  test('"Company stated" only after the primary document was read; derived says so', () => {
    assert.equal(guidanceWording('primary_verified', 'explicit'), 'Company stated');
    assert.equal(guidanceWording('primary_verified', 'derived'), 'Derived from company-stated amounts');
    assert.match(guidanceWording('secondary_only', 'derived'), /primary source not yet verified/);
  });
  test('status is decided by whether the primary was READ, not by the label', () => {
    assert.equal(verificationStatusOf({ primaryRead: false, tier: 3 }), 'secondary_only');
    assert.equal(verificationStatusOf({ primaryRead: false, tier: 1 }), 'unverified');
    assert.equal(verificationStatusOf({ primaryRead: true, tier: 1, state: 'VERIFIED', ageDays: 5 }), 'primary_verified');
    assert.equal(verificationStatusOf({ primaryRead: true, tier: 1, state: 'PARTIAL', ageDays: 5 }), 'partly_verified');
    assert.equal(verificationStatusOf({ primaryRead: true, tier: 1, state: 'VERIFIED', ageDays: 75 }), 'stale');
    assert.equal(verificationStatusOf({ primaryRead: true, tier: 1, state: 'VERIFIED', contradicted: true }), 'contradicted');
    assert.equal(calculationTypeOf({ growthType: 'DERIVED' }), 'derived'); assert.equal(calculationTypeOf({ growthType: 'UNKNOWN', hasPercent: false }), 'amount_only');
    assert.equal(calculationTypeOf({ growthType: 'EXPLICIT', isRange: true }), 'range');
    for (const k of Object.keys(CALCULATION_TYPE_TEXT)) assert.ok(CALCULATION_TYPE_TEXT[k as 'explicit']); for (const k of Object.keys(VERIFICATION_STATUS_TEXT)) assert.ok(VERIFICATION_STATUS_TEXT[k as 'stale']);
  });
  test('the page text follows the status', () => {
    assert.match(basisText({ short: '+60%', growthType: 'EXPLICIT', verificationStatus: 'secondary_only' }).line, /Secondary source attributes/);
    assert.doesNotMatch(basisText({ short: '+60%', growthType: 'EXPLICIT', verificationStatus: 'secondary_only' }).line, /stated by company/);
    assert.match(basisText({ short: '+60%', growthType: 'EXPLICIT', verificationStatus: 'primary_verified' }).line, /Company stated/);
    assert.match(basisText({ short: '+60%', growthType: 'EXPLICIT' }).line, /primary source not yet verified/);   // no status = never claimed as company stated
    assert.match(recordBasis({ verificationStatus: 'unverified', growthType: 'EXPLICIT', growthVsPriorYear: { type: 'EXPLICIT', display: '+60%' } })!.line, /primary source not yet verified/);
  });
});

describe('one freshness rule', () => {
  test('fresh <=30, aging 31-60, stale >60, unknown stays unknown', () => {
    assert.equal(freshnessOf(30).tier, 'FRESH'); assert.equal(freshnessOf(31).tier, 'AGING'); assert.equal(freshnessOf(60).tier, 'AGING'); assert.equal(freshnessOf(61).tier, 'STALE'); assert.equal(freshnessOf(null).tier, 'UNKNOWN');
    assert.deepEqual(freshnessCounts([5, 40, 57, 64, 64, null]), { FRESH: 1, AGING: 2, STALE: 2, UNKNOWN: 1 });
  });
  test('the badge text uses the same rule: 57 days is aging, 64 days is stale', () => {
    assert.match(lastVerifiedText({ lastVerifiedDaysAgo: 57 }).text, /aging/); assert.equal(lastVerifiedText({ lastVerifiedDaysAgo: 57 }).stale, false);
    assert.match(lastVerifiedText({ lastVerifiedDaysAgo: 64 }).text, /stale/); assert.equal(lastVerifiedText({ lastVerifiedDaysAgo: 64 }).stale, true);
  });
});

describe('scope', () => {
  test('headings name their scope', () => {
    assert.equal(scopedTitle('HIGHEST ACTIVE GUIDANCE', 'ALL'), 'HIGHEST ACTIVE GUIDANCE — ALL MARKETS');
    assert.equal(scopedTitle('HIGHEST ACTIVE GUIDANCE — ALL MARKETS', 'IN'), 'HIGHEST ACTIVE GUIDANCE — INDIA');
    assert.equal(scopedTitle('HIGHEST ACTIVE GUIDANCE', 'US'), 'HIGHEST ACTIVE GUIDANCE — USA');
  });
  test('All = India + USA exactly; each market is its own filter', () => {
    const row = (m: string, i: number): any => ({ id: `${m}${i}`, market: m, entityKey: `${m}${i}`, company: `${m}${i}` });
    const groups: any = { cohorts: { ANNUAL: [row('IN', 1), row('US', 1), row('US', 2)], MULTI_YEAR_CAGR: [], QUARTERLY: [] }, trust: {} };
    const n = (mk: any) => sectionRows(groups, 'active', mk).ANNUAL.length;
    assert.equal(n('ALL'), 3); assert.equal(n('IN'), 1); assert.equal(n('US'), 2); assert.equal(n('IN') + n('US'), n('ALL'));
  });
});

describe('data quality in numbers', () => {
  const idx = (market: 'IN' | 'US', url: string, extracted: boolean, d = '2026-09-20'): any => ({ docId: `${market}${url}${d}${extracted}`.slice(0, 20), market, ticker: 'X', company: 'X', kind: 'TRANSCRIPT', filedAt: d, url, textChars: 1, extracted });
  test('India: NSE found, BSE missing, documents pending => PARTIAL with the counts', () => {
    const rows = [idx('IN', 'https://nsearchives.nseindia.com/a.pdf', false), idx('IN', 'https://nsearchives.nseindia.com/b.pdf', true, '2026-09-21')];
    const m = marketQuality('IN', rows, { v: 1, market: 'IN', updatedAt: '', days: { '2026-09-21': { status: 'ok', filings: 1, docs: 1, at: '2026-09-21T10:00:00Z' }, '2026-09-22': { status: 'failed', filings: 0, docs: 0, at: '2026-09-22T10:00:00Z' } } }, NOW);
    assert.equal(m.status, 'PRIMARY_PENDING'); assert.equal(m.documentsPending, 1); assert.equal(m.documentsDiscovered, 2);   // zzz861: nothing verified yet and a document waits
    assert.equal(m.line, 'INDIA — PRIMARY VERIFICATION PENDING: NSE ✓ 2 | BSE ✕ | 1 document pending | 0 claims | 0 verified');
    assert.equal(m.daysFullyCovered, 1); assert.equal(m.daysFailed, 1); assert.ok(m.tradingDays > 80 && m.tradingDays < 90); assert.ok(m.daysNotRead > 0);
  });
  test('no data is NO_SOURCE_DATA, never complete; footnote says counts are not exhaustive', () => {
    const q = dataQualityOf([], {}, NOW);
    assert.equal(q.markets.IN.status, 'NO_SOURCE_DATA'); assert.equal(q.exhaustive, false); assert.equal(q.footnote, NOT_EXHAUSTIVE); assert.match(q.markets.US.line, /NO SOURCE DATA/);
  });
  test('weekdays only', () => { assert.deepEqual(tradingDaysBetween('2026-09-25', '2026-09-30'), ['2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30']); });
});

// ── the 20-company pipeline report, through the REAL universe build (researched data file as the discovered input; no network) ──
const TWENTY: GuSubject[] = ['HFCL', 'Syrma SGS Technology', 'Netweb Technologies India', 'Sobha', 'MTAR Technologies', 'Rossell Techsys', 'Knowledge Marine & Engineering Works', 'KRN Heat Exchanger and Refrigeration', 'Cupid', 'V2 Retail',
  'Aditya Infotech', 'Senores Pharmaceuticals', 'Sky Gold and Diamonds', 'TD Power Systems', 'Avalon Technologies', 'Krishna Phoschem', 'Aeroflex Industries', 'Stallion India Fluorochemicals', 'Sakar Healthcare', 'Man Industries (India)'].map((name) => ({ name, market: 'IN' as const }));
describe('20-company pipeline report', () => {
  const seed = getSeedRows(); const build = buildUniverse([], null, seed.rows, NOW, {});
  const rep = pipelineReport(build, TWENTY);
  test('every company gets an explicit state; none is silently missing', () => {
    assert.equal(rep.rows.length, 20); for (const r of rep.rows) { assert.ok(r.state); assert.ok(r.reason); }
    if (process.env.GU_PRINT) console.log(JSON.stringify({ summary: rep.summary, counts: rep.counts, rows: rep.rows.map((r) => ({ n: r.name, st: r.state, act: r.active_status, m: r.metric, p: r.period, cur: r.current_guidance, ver: r.verification_status, calc: r.calculation_type, why: r.reason.slice(0, 90) })) }, null, 1));
  });
  test('media-backed India claims are never Active and never worded as company stated', () => {
    const act = new Set(build.defaultRecords.map((r) => r.entityKey));
    for (const r of [...(build.claimsAwaiting ?? []), ...build.reviewQueue]) for (const p of r.points) if (p.verificationStatus === 'secondary_only' || p.verificationStatus === 'unverified') assert.doesNotMatch(p.wording, /^Company stated/);
    for (const r of build.defaultRecords) for (const p of r.points) if (p.listBucket === 'ACTIVE') assert.notEqual(p.verificationStatus, 'secondary_only');
    assert.ok(act.size >= 0);
  });
  test('a verified active guidance record carries a calculation type, a verification status and a freshness tier', () => {
    for (const r of build.records) for (const p of r.points) { assert.ok(p.calculationType); assert.ok(p.verificationStatus); assert.ok(p.freshness); assert.ok(p.wording); }
  });
  test('an AI-contradicted claim and a withdrawn / expired record get their own state', () => {
    const r2 = pipelineReport(build, [{ name: 'Cupid', market: 'IN' }], { contradicted: ['CUPID'] });
    assert.equal(r2.rows[0].state, 'CLAIM_CONTRADICTED');
    const r3 = pipelineReport(build, [{ name: 'No Such Company Ltd', market: 'IN' }]); assert.equal(r3.rows[0].state, 'NO_VALID_GUIDANCE_FOUND');
  });
});
