// zzz1112–1122 — Guidance Upgrades audit (19 Oct 2026): G01 detail crash, G02 segment growth, G03 "double by FY31", G04 one quarantine for
// every ranking, G05 measure labels / next-results date / timing effects, G06 stated fiscal-year end, G07 load states, G08 market-qualified
// book, G09 layout + exact "displayed" counts, and the extra page issues (FY25-28 = 3 years, implied wording, cut note, range digits).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeFullEvent } from '../../components/guidance-upgrades/GuDetailShell';
import { universeStatusLine } from '../../components/guidance-upgrades/useGuUniverse';
import { verificationBlockLine } from '../../components/guidance-upgrades/GuStatusStrip';
import { universeShownLine } from '../../components/guidance-upgrades/GuUniverseBrowser';
import { scopeConflictOf, fcfIssueOf } from '../guidance-horizon';
import { itemsFromExtracted, buildUniverse, displayOf, periodStatusOf, statedFiscalYearEnd, cleanCoName, selectHighGrowthGroups, type GuUniverseRecordX } from '../guidance-universe';
import { applyQuarantine, quarantineCounts } from '../gu-quarantine';
import { withoutHeld } from '../gu-held-store';
import { keyOf, buildFocusList } from '../gu-focus';
import { nextResultsDateIn, timingEffectsOf, nextResultsWindow } from '../guidance-upgrades';
import { metricLabelOf, fmtRangeSide } from '../guidance-upgrades-format';
import { overlayBook, bookKey, heldKeySet } from '../guidance-upgrades-book';
import { sourceDisplayName } from '../../components/guidance-upgrades/gu-ui';
import type { ExtractedGuidance, GuidanceExtractResult } from '../guidance-docs-types';

const NOW = new Date('2026-10-19T09:00:00Z');
const row = (o: Partial<ExtractedGuidance>): ExtractedGuidance => ({ metric: 'REVENUE_GROWTH', metricLabel: 'revenue growth', period: 'FY27', periodKind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: '%', low: null, high: null,
  growthPctLow: null, growthPctHigh: null, status: 'NEW', prior: null, priorActual: null, quote: '', speaker: null, confidence: 0.9, ...o } as ExtractedGuidance);
const xres = (ticker: string, company: string, rows: ExtractedGuidance[], market: 'IN' | 'US' = 'IN', filedAt = '2026-08-13T00:00:00.000Z'): GuidanceExtractResult => ({
  docId: createHash('sha1').update(ticker + filedAt).digest('hex').slice(0, 20), market, ticker, company, docUrl: `https://www.bseindia.com/x/${ticker.toLowerCase()}.pdf`,
  docKind: 'TRANSCRIPT', filedAt, extractedAt: '2026-10-05T00:00:00Z', model: 'test', status: 'ok', rows, dropped: 0 } as GuidanceExtractResult);

describe('G01 — the detail panel renders only a full, matching record', () => {
  test('lean rows and other companies are refused; missing lists become empty lists (no invented facts)', () => {
    assert.equal(normalizeFullEvent({ guidance_event_id: 'a', lean: true }), null);
    assert.equal(normalizeFullEvent(null), null);
    assert.equal(normalizeFullEvent({ guidance_event_id: 'b' }, 'a'), null, 'an answer for another company never shows');
    const e: any = normalizeFullEvent({ guidance_event_id: 'a', company: 'Maxcyte, Inc.' }, 'a');
    assert.deepEqual([e.risks, e.evidenceGaps, e.nextEvidence, e.decisionReason, e.changes, e.history], [[], [], [], [], [], []]);
    assert.deepEqual(e.chain, {}); assert.equal(e.chain.durability, undefined);
  });
  test('the page renders the shell (loading / error / Retry), never GuDetail from a lean row', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/guidance-upgrades/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /<GuDetailShell lean=\{openLean\}/);
    assert.doesNotMatch(page, /<GuDetail e=\{open\}/);
    assert.match(page, /no answer within 20 seconds/);
    const shell = readFileSync(new URL('../../components/guidance-upgrades/GuDetailShell.tsx', import.meta.url), 'utf8');
    assert.match(shell, /getDerivedStateFromError/); assert.match(shell, /Retry/);
  });
});

describe('G07 — loading, stale and failed states are told apart', () => {
  const at = (ms: number) => `${Math.round(ms / 60000)}m`;
  test('lines for each state', () => {
    assert.match(universeStatusLine({ state: 'error', error: 'HTTP 504', refreshing: false, refreshError: null, savedAgeMs: null, data: null }, at)!.text, /could not be loaded: HTTP 504/);
    assert.equal(universeStatusLine({ state: 'loading', error: null, refreshing: true, refreshError: null, savedAgeMs: null, data: null }, at)!.tone, 'info');
    const stale = universeStatusLine({ state: 'ok', error: null, refreshing: false, refreshError: 'No answer within 60 seconds', savedAgeMs: 3 * 3600_000, data: {} as any }, at)!;
    assert.equal(stale.tone, 'warn'); assert.match(stale.text, /saved copy from 180m — the refresh failed/);
    assert.equal(universeStatusLine({ state: 'ok', error: null, refreshing: false, refreshError: null, savedAgeMs: null, data: {} as any }, at), null);
  });
  test('the Focus list no longer says "Reading…" after a failure; Coverage Check does not call every name "not read"', () => {
    const f = readFileSync(new URL('../../components/guidance-upgrades/GuFocusList.tsx', import.meta.url), 'utf8');
    assert.match(f, /universeStatusLine\(uni, ageText\)/); assert.match(f, /uni\.state === 'loading' \? 'Reading the guidance data…'/);
    const n = readFileSync(new URL('../../components/guidance-upgrades/GuNameCheck.tsx', import.meta.url), 'utf8');
    assert.match(n, /ready \? checkCoverage\(/);
  });
  test('budget block shown near the top, without raising the cap', () => {
    const t = verificationBlockLine({ available: false, unavailableReason: 'Monthly AI cap reached ($40.13 of $40) — raise AI_MONTHLY_CAP_USD in Railway to continue', queueSize: 738 }, NOW)!;
    assert.match(t, /Verification paused: Monthly AI cap reached \(\$40\.13 of \$40\)\./); assert.match(t, /738 documents are waiting/); assert.match(t, /resets on 2026-11-01/);
    assert.doesNotMatch(t, /raise AI_MONTHLY_CAP_USD/);
    assert.equal(verificationBlockLine({ available: true }), null);
  });
});

describe('G02 — a segment growth is not company growth', () => {
  const overall = { metricFamily: 'REVENUE', statement: 'maintaining 15% plus growth overall this year.', low: 15, high: null, sourceDate: '2026-08-12', cohort: 'ANNUAL' };
  const thf = { metricFamily: 'REVENUE', statement: "business can grow at 50-60% year-on-year for next 3-4 Years. That's the plan we have as of now.", low: 50, high: 60, sourceDate: '2026-08-12', cohort: 'MULTI_YEAR_CAGR' };
  test('Bikaji: the 50–60% next to "15% overall" from the same call is held, both statements kept', () => {
    assert.match(scopeConflictOf(thf, [overall, thf])!, /15% for the company as a whole; 50% is most likely one business/);
    assert.equal(scopeConflictOf(overall, [overall, thf]), null, 'the company-wide 15% is never held');
  });
  test('negative controls: company words, another document, a close figure', () => {
    assert.equal(scopeConflictOf({ ...thf, statement: 'consolidated revenue can grow 50-60% for 3 years' }, [overall]), null);
    assert.equal(scopeConflictOf(thf, [{ ...overall, sourceDate: '2026-05-10', sourceName: 'other' }]), null);
    assert.equal(scopeConflictOf({ ...thf, low: 25, high: 28 }, [overall]), null, 'under twice the company figure');
  });
  test('the ranking leaves it out (scopeHeld lists it with the reason)', () => {
    const u = buildUniverse([], [], [], NOW, { extracted: { results: [xres('BIKAJI', 'Bikaji Foods International Ltd', [
      row({ quote: overall.statement, growthPctLow: 15, period: 'FY27' }),
      row({ quote: thf.statement, growthPctLow: 50, growthPctHigh: 60, period: 'NEXT 4 YEARS', periodKind: 'MULTI_YEAR' }),
    ])], actuals: null } }) as any;
    const recs = [...u.defaultRecords, ...u.reviewQueue] as GuUniverseRecordX[];
    const pts = recs.filter((x) => x.record.ticker === 'BIKAJI').flatMap((x) => x.points);
    assert.ok(pts.some((p) => (p.low ?? 0) >= 50), 'the THF figure is still in the universe');
    // the fixture's "next 4 years" has no run state in a test build: mark it running, as the live build does
    const live = (u.defaultRecords as GuUniverseRecordX[]).map((x) => ({ ...x, points: x.points.map((p) => ({ ...p, periodRunState: 'ACTIVE' as const })) }));
    const g = selectHighGrowthGroups(live, 30);
    const control = selectHighGrowthGroups(live.map((x) => ({ ...x, points: x.points.filter((p) => (p.low ?? 0) >= 50) })), 30);
    assert.ok(Object.values(control.cohorts).flat().some((r) => r.ticker === 'BIKAJI'), 'without the company-wide line it would rank — the rule is what holds it');
    const ranked = Object.values(g.cohorts).flat();
    assert.ok(!ranked.some((r) => r.ticker === 'BIKAJI'), 'not ranked as company growth');
    assert.ok((g.scopeHeld || []).some((h) => h.ticker === 'BIKAJI' && /one business or segment/.test(h.reason)));
  });
});

describe('G03 — "more than double by FY31" is a multi-year total, not +100% in one year; "cash flows" is not FCF', () => {
  const ADANI = 'We remain firmly on track to more than double revenue, EBITDA and cash flows by FY31.';
  test('FY31 single-year +100% becomes FY26-31 at about 14.9% a year, open-ended', () => {
    const [it] = itemsFromExtracted([xres('ADANIPORTS', 'Adani Ports and Special Economic Zone Ltd', [row({ quote: ADANI, growthPctLow: 100, growthPctHigh: 100, period: 'FY31' })], 'IN', '2026-08-03T00:00:00.000Z')], null, NOW);
    assert.equal(it.pkind, 'MULTI_YEAR_CAGR'); assert.equal(it.period, 'FY26-31');
    assert.equal(it.low, 14.9); assert.equal(it.open, true);
    assert.ok(!(it.low === 100), 'never +100% for one year');
  });
  test('a doubling NEXT year stays a one-year figure; generic "cash flows" is not free cash flow', () => {
    const [it] = itemsFromExtracted([xres('XYZ', 'Xyz Ltd', [row({ quote: 'We expect FY28 revenue to double.', growthPctLow: 100, growthPctHigh: 100, period: 'FY28' })], 'IN', '2026-08-03T00:00:00.000Z')], null, NOW);
    assert.equal(it.pkind, 'MULTI_YEAR_CAGR', 'FY28 is two years after FY26 — a total over two years');
    const [one] = itemsFromExtracted([xres('XYZ2', 'Xyz2 Ltd', [row({ quote: 'We expect FY27 revenue to double.', growthPctLow: 100, growthPctHigh: 100, period: 'FY27' })], 'IN', '2026-08-03T00:00:00.000Z')], null, NOW);
    assert.equal(one.pkind, 'FY'); assert.equal(one.low, 100);
    assert.match(fcfIssueOf(ADANI, 'cash flows')!, /not free cash flow/);
    assert.equal(fcfIssueOf('free cash flow of $120M', null), null);
  });
});

describe('G04 — one quarantine for every ranking, counted three ways', () => {
  const r = (entityKey: string, metric: string, v: number, extra: any = {}) => ({ id: entityKey, rank: 1, entityKey, company: entityKey, ticker: entityKey, market: 'IN', cohort: 'ANNUAL', trust: 'derived', metrics: [{ metric, compareValue: v, short: `+${v}%`, display: `+${v}%` }], text: `Revenue +${v}%`, headline: { metric, compareValue: v }, sourceName: 's', sourceDate: null, sourceUrl: null, ...extra });
  const groups: any = { threshold: 30, cohorts: { ANNUAL: [r('CUPID', 'REVENUE', 85), r('DHANUKA', 'REVENUE', 30), r('OK', 'REVENUE', 40)], MULTI_YEAR_CAGR: [], QUARTERLY: [] }, trust: { derived: { ANNUAL: [r('CUPID', 'REVENUE', 85)], MULTI_YEAR_CAGR: [], QUARTERLY: [] } }, counts: { rows: 3 } };
  const viol = [{ code: 'DERIVED_WITHOUT_PRIMARY_NUMBERS', entityKey: 'CUPID', company: 'Cupid', metric: 'REVENUE', message: 'x' }, { code: 'X2', entityKey: 'CUPID', company: 'Cupid', metric: 'REVENUE', message: 'y' }, 'count line'];
  test('failed points leave the cohort AND trust lists; counts reconcile', () => {
    const q = applyQuarantine(groups, viol as any);
    assert.deepEqual(q.cohorts.ANNUAL.map((x: any) => x.entityKey), ['DHANUKA', 'OK']);
    assert.deepEqual(q.trust.derived.ANNUAL, []);
    assert.equal(q.counts.rows, 2); assert.equal(q.quarantined!.length, 1);
    assert.deepEqual(quarantineCounts(viol as any), { checks: 3, points: 1, companies: 1 });
  });
  test('the Focus list\'s held-back growth (Dhanuka) leaves the other rankings too', () => {
    const held = new Set([keyOf('IN', 'DHANUKA', 'DHANUKA')]);
    const g2 = withoutHeld(groups, held)!;
    assert.ok(!g2.cohorts.ANNUAL.some((x) => x.entityKey === 'DHANUKA'));
    assert.ok(g2.cohorts.ANNUAL.some((x) => x.entityKey === 'CUPID'));
  });
});

describe('G05 — measure labels, the stated next-results date, timing effects', () => {
  const MAXCYTE = 'MaxCyte now expects total revenue of approximately $34 million and core revenue of $31 million. Results benefited from instrument orders pulled forward from the fourth quarter and a milestone payment. MaxCyte will report third quarter 2026 results on November 10, 2026.';
  test('date given by the company wins over the ~3-month estimate', () => {
    assert.equal(nextResultsDateIn(MAXCYTE, '2026-10-14'), '2026-11-10');
    assert.equal(nextResultsDateIn('Results were reported on October 1, 2026.', '2026-10-14'), null, 'a past date is not the next one');
    const c: any = { after: { period: 'FY26', metric: 'REVENUE' } };
    assert.match(nextResultsWindow({ announcement_date: '2026-10-14', nextResultsDate: '2026-11-10' }, c), /10 Nov 2026, date given by the company/);
    assert.match(nextResultsWindow({ announcement_date: '2026-10-14' }, c), /^Next quarterly results \(~Jan 2027\)$/);
  });
  test('pull-forward and milestone are named; total and core stay apart', () => {
    const t = timingEffectsOf(MAXCYTE)!;
    assert.ok(t.some((x) => /pulled forward/.test(x))); assert.ok(t.some((x) => /milestone payment/.test(x)));
    assert.equal(metricLabelOf({ metric: 'REVENUE', raw: 'total revenue of approximately $34 million' }), 'Total revenue');
    assert.equal(metricLabelOf({ metric: 'REVENUE', raw: 'core revenue of $31 million' }), 'Core revenue');
    assert.equal(metricLabelOf({ metric: 'REVENUE', raw: 'revenue of $31 million' }), 'Revenue');
    assert.equal(metricLabelOf({ metric: 'OTHER', raw: 'adjusted operating income of $500 million to $700 million' }), 'Adjusted operating income');
  });
});

describe('G06 — a stated fiscal-year end beats the "until next March" estimate', () => {
  const AEHR = 'For the fiscal year ending June 25, 2027, Aehr expects total company revenue to be between $130 million and $150 million, representing approximately 160%-200% year-over-year growth.';
  test('AEHR FY27 ends 25 Jun 2027 (not 1 Mar 2028)', () => {
    assert.equal(statedFiscalYearEnd(AEHR, 'FY27')!.toISOString().slice(0, 10), '2027-06-25');
    const ps = periodStatusOf('FY27', 'FY', 'US', '2026-07-14', NOW, AEHR);
    assert.equal(ps.end!.toISOString().slice(0, 10), '2027-06-25'); assert.match(ps.note!, /stated by the company/);
    const est = periodStatusOf('FY27', 'FY', 'US', '2026-07-14', NOW, 'Full year revenue expected to be $34 million');
    assert.match(est.note!, /an estimate, not a confirmed date/);
    assert.equal(statedFiscalYearEnd(AEHR, 'FY30'), null, 'a date for another year is not used');
  });
});

describe('G08 — a holding is market + ticker', () => {
  const ev = (market: string, ticker: string): any => ({ guidance_event_id: `${market}${ticker}`, ticker, company: ticker, market, verification: 'VERIFIED', decision: 'WATCHLIST', changes: [], flags: [], links: {}, duration: 'UNKNOWN', materiality: 'HIGH' });
  test('India HAL never marks Halliburton, and the other way round', () => {
    const [inHal, usHal] = overlayBook([ev('IN', 'HAL'), ev('US', 'HAL')], ['IN:HAL']);
    assert.equal(inHal.links.inBook, true); assert.equal(usHal.links.inBook, false);
    const [a, b] = overlayBook([ev('IN', 'HAL'), ev('US', 'HAL')], ['US:HAL']);
    assert.equal(a.links.inBook, false); assert.equal(b.links.inBook, true);
  });
  test('legacy bare / .NS entries are India only; US BRK-B = BRK.B', () => {
    assert.ok(heldKeySet(['HAL.NS']).has('IN:HAL')); assert.ok(!heldKeySet(['HAL']).has('US:HAL'));
    assert.equal(bookKey('US', 'BRK-B'), 'US:BRK.B');
  });
});

describe('G09 + extras', () => {
  test('page uses the width; exact "displayed" wording', () => {
    const t = readFileSync(new URL('../../components/guidance-upgrades/gu-tokens.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(t, /max-width:1180px/); assert.match(t, /\.gu-scroll/);
    assert.equal(universeShownLine(978, 25), '25 of 978 matching companies displayed');
    assert.equal(universeShownLine(12, 12), 'All 12 matching companies displayed');
  });
  test('"CAGR over FY25 to FY28" said in 2026 is a 3-year CAGR; "FY27-29" said in 2026 stays 3 years', () => {
    assert.equal(displayOf({ metric: 'REVENUE', low: 70, high: 75, open: false, origin: 'STATED', periodKind: 'MULTI_YEAR_CAGR', period: 'FY25-28', abs: null, asOf: '2026-08-17' }), '3-yr revenue CAGR +70–75%');
    assert.equal(displayOf({ metric: 'REVENUE', low: 30, high: 35, open: false, origin: 'STATED', periodKind: 'MULTI_YEAR_CAGR', period: 'FY27-29', abs: null, asOf: '2026-08-17' }), '3-yr revenue CAGR +30–35%');
  });
  test('range digits never print two different values the same; BSE group marker removed', () => {
    assert.equal(fmtRangeSide(1.638, 1.643, 1.648, ''), 'low 1.638 / mid 1.643 / high 1.648');
    assert.equal(fmtRangeSide(10, 11, 12, ''), 'low 10 / mid 11 / high 12');
    assert.equal(cleanCoName('Cupid Ltd-$'), 'Cupid Ltd'); assert.equal(sourceDisplayName('Results press release (Cupid Ltd-$)'), 'Results press release (Cupid Ltd)');
  });
  test('a worked-out growth says "Implied", a cut says so', () => {
    const g: any = { threshold: 30, cohorts: { ANNUAL: [
      { id: 'a', rank: 1, entityKey: 'S', company: 'Sahasra', ticker: 'SAHASRA', market: 'IN', cohort: 'ANNUAL', trust: 'derived', metrics: [], text: 'Revenue +134.1% (derived)', headline: { metric: 'REVENUE', compareValue: 134.1, growthType: 'DERIVED', period: 'FY27' }, sourceName: 's', sourceDate: '2026-09-19', sourceUrl: null },
      { id: 'b', rank: 2, entityKey: 'P', company: 'Piccadily', ticker: 'PICCADIL', market: 'IN', cohort: 'ANNUAL', trust: 'verified', metrics: [], text: 'Revenue +60%', headline: { metric: 'REVENUE', compareValue: 60, period: 'FY27', revisionVsPriorGuidance: '-5 pp vs prior guidance' }, sourceName: 's', sourceDate: '2026-08-17', sourceUrl: null },
    ], MULTI_YEAR_CAGR: [], QUARTERLY: [] }, trust: {}, counts: {} };
    const rows = buildFocusList(g, [], NOW, 10);
    assert.match(rows.find((x) => x.ticker === 'SAHASRA')!.why, /^Implied 134\.1% growth — worked out from the company’s own numbers, not a stated target/);
    assert.match(rows.find((x) => x.ticker === 'PICCADIL')!.why, /lower than its earlier guidance \(-5 pp\)/);
  });
});
