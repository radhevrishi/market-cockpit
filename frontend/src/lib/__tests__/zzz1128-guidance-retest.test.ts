// zzz1128–1137 — Guidance retest 19 Oct (R1–R8): the request lifecycle is executed with controlled fetches (request counts and final
// states, not just "a component exists"), the universe store keeps each address's own rows, counts follow the listed rows, a failed
// period never removes another period, the document's own text reaches the event, "Nov. 10" parses, points vs percent stay apart.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DetailLoader } from '../../components/guidance-upgrades/detail-loader';
import { UniverseStore } from '../../components/guidance-upgrades/useGuUniverse';
import { applyQuarantine, recountGroups } from '../gu-quarantine';
import { withoutHeld } from '../gu-held-store';
import { keyOf } from '../gu-focus';
import { highestActiveFinal } from '../../components/guidance-upgrades/gu-ui';
import { buildExtractedEvents, nextResultsDateIn, whatItMeans } from '../guidance-upgrades';
import { docFactsOf } from '../gu-doc-facts';
import { measureLabel } from '../guidance-metric-label';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
function pendingFetch() {
  const calls: Array<{ url: string; signal: AbortSignal; resolve: (b: any) => void; reject: (e: any) => void }> = [];
  const fetcher = (url: string, signal: AbortSignal) => new Promise<any>((resolve, reject) => {
    const c = { url, signal, resolve: (b: any) => resolve({ status: 200, ok: true, json: async () => b }), reject };
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    calls.push(c);
  });
  return { calls, fetcher };
}
const full = (id: string) => ({ event: { guidance_event_id: id, company: id, changes: [], risks: [], evidenceGaps: [], nextEvidence: [], history: [], sources: [], decisionReason: [], flags: [], chain: {}, links: {} } });

describe('R1 — detail request lifecycle', () => {
  test('pending → close → reopen starts a NEW request and ends ok', async () => {
    const f = pendingFetch(); let n = 0;
    const L = new DetailLoader({ fetcher: f.fetcher, urlFor: (id) => `/x?id=${id}`, onChange: () => { n++; } });
    L.open('A', { guidance_event_id: 'A', lean: true }, true);
    assert.equal(L.state('A')!.status, 'loading'); assert.equal(L.requests, 1);
    L.cancel(); await tick();
    assert.equal(L.state('A'), undefined, 'no stale "loading" left behind');
    L.open('A', { guidance_event_id: 'A', lean: true }, true);
    assert.equal(L.requests, 2, 'reopen makes a second request');
    f.calls[1].resolve(full('A')); await tick(); await tick();
    assert.equal(L.state('A')!.status, 'ok');
    L.open('A', {}, true); assert.equal(L.requests, 2, 'a completed record is reused');
    assert.ok(n > 0);
  });
  test('A → B → A, and a late answer from an aborted attempt cannot overwrite the newer state', async () => {
    const f = pendingFetch();
    const L = new DetailLoader({ fetcher: f.fetcher, urlFor: (id) => `/x?id=${id}`, onChange: () => {} });
    L.open('A', {}, true); L.open('B', {}, true);
    assert.ok(f.calls[0].signal.aborted, 'A aborted when B opened');
    L.open('A', {}, true); assert.equal(L.requests, 3);
    f.calls[2].reject(new Error('HTTP 500')); await tick(); await tick();
    assert.equal(L.state('A')!.status, 'error');
    L.retry('A', {}); assert.equal(L.state('A')!.status, 'loading'); assert.equal(L.requests, 4);
    f.calls[3].resolve(full('A')); await tick(); await tick();
    assert.equal(L.state('A')!.status, 'ok');
    assert.equal(L.state('B'), undefined, 'B was cancelled, not left loading');
  });
  test('deadline: a hung request becomes an error with its reason', async () => {
    const f = pendingFetch();
    const L = new DetailLoader({ fetcher: f.fetcher, urlFor: (id) => `/x?id=${id}`, onChange: () => {}, deadlineMs: 5 });
    L.open('A', {}, true);
    await new Promise((r) => setTimeout(r, 20)); await tick();
    assert.deepEqual(L.state('A'), { status: 'error', text: 'no answer within 20 seconds' });
  });
});

describe('R2 — one copy per address, never another address\'s rows', () => {
  const uni = (tag: string): any => ({ records: [{ tag }], summary: { india: {}, usa: {}, all: {} } });
  test('a failed view change shows an error for the NEW view, not the old rows; same-address failure keeps its rows labelled', async () => {
    let fail = new Set<string>(); let t = 1_000_000;
    const S = new UniverseStore({ fetch: async (u) => { if (fail.has(u)) throw new Error('HTTP 504'); return uni(u); }, readCache: async () => null, writeCache: () => {}, now: () => t });
    await S.ensure('/u?view=active');
    assert.equal(S.view('/u?view=active').state, 'ok');
    fail = new Set(['/u?view=review']);
    await S.ensure('/u?view=review');
    const v = S.view('/u?view=review');
    assert.equal(v.state, 'error'); assert.equal(v.data, null, 'no Active rows under the Review label');
    fail = new Set(['/u?view=active']); t += 200_000;
    await S.ensure('/u?view=active', true);
    const a = S.view('/u?view=active');
    assert.equal(a.state, 'ok'); assert.equal((a.data as any).records[0].tag, '/u?view=active'); assert.equal(a.refreshError, 'HTTP 504');
  });
  test('five sections asking at once: one saved-copy read, one network call', async () => {
    let calls = 0, reads = 0;
    const S = new UniverseStore({ fetch: async (u) => { calls++; return uni(u); }, readCache: async () => { reads++; return null; }, writeCache: () => {} });
    await Promise.all([1, 2, 3, 4, 5].map(() => S.ensure('/u?view=active')));
    assert.equal(calls, 1); assert.equal(reads, 1);
    await S.ensure('/u?view=active'); assert.equal(calls, 1, 'fresh copy reused, not fetched again');
  });
});

describe('R3 / R4 — counts from the listed rows; a failed period removes only itself', () => {
  const row = (e: string, metric: string, period: string, cohort = 'ANNUAL', v = 50): any => ({ id: `${e}${period}`, rank: 1, entityKey: e, company: e, ticker: e, market: 'IN', cohort, trust: 'derived', metrics: [{ metric, period, periodNormalized: period, compareValue: v, short: `+${v}%`, display: `+${v}%` }], text: `Revenue +${v}%`, headline: { metric, period, periodNormalized: period, compareValue: v }, sourceName: 's', sourceDate: null, sourceUrl: null });
  const groups: any = { threshold: 30, cohorts: { ANNUAL: [row('CUPID', 'REVENUE', 'FY27'), row('DHANUKA', 'REVENUE', 'FY27'), row('OK', 'REVENUE', 'FY27')], MULTI_YEAR_CAGR: [row('CUPID', 'REVENUE', 'FY26-28', 'MULTI_YEAR_CAGR')], QUARTERLY: [] }, trust: {}, counts: { rows: 4 } };
  test('only the failing FY26-28 point leaves; FY27 of the same company stays', () => {
    const q = applyQuarantine(groups, [{ code: 'X', entityKey: 'CUPID', company: 'Cupid', metric: 'REVENUE', period: 'FY26-28', message: 'm' }]);
    assert.ok(q.cohorts.ANNUAL.some((r) => r.entityKey === 'CUPID'));
    assert.equal(q.cohorts.MULTI_YEAR_CAGR.length, 0);
    assert.equal(q.counts.rows, 3); assert.equal(q.rawRows, 4);
  });
  test('a client hold updates every count and the heading chain together', () => {
    const q = applyQuarantine(groups, [{ code: 'X', entityKey: 'CUPID', company: 'Cupid', metric: 'REVENUE', period: 'FY26-28', message: 'm' }]);
    const h = withoutHeld(q, new Set([keyOf('IN', 'DHANUKA', 'DHANUKA')]))!;
    assert.equal(h.counts.rows, 2); assert.equal(h.heldOut, 1);
    const head = highestActiveFinal(h as any, 900, 30);
    assert.match(head.title, /\(2\)$/);
    assert.match(head.note, /2 rows = 4 ranked − 1 that failed a data check − 1 held back for review in the Focus list/);
    assert.equal(recountGroups(h).counts.rows, 2);
  });
});

describe('R5 / R7 / R8 — document facts reach the event; dates; units', () => {
  const MAX = 'MaxCyte now expects total revenue of approximately $34 million. Results reflect accelerated instrument purchasing originally anticipated in the fourth quarter and a milestone payment. MaxCyte will host its third quarter 2026 earnings call on Nov. 10, 2026.';
  test('"Nov. 10, 2026" and "November 10, 2026" both parse; a date in an unrelated sentence does not', () => {
    assert.equal(nextResultsDateIn(MAX, '2026-10-14'), '2026-11-10');
    assert.equal(nextResultsDateIn(MAX.replace('Nov.', 'November'), '2026-10-14'), '2026-11-10');
    assert.equal(nextResultsDateIn('The plant opened on Nov. 10, 2026.', '2026-10-14'), null);
  });
  test('an AI-read event (quotes only) gets the date and timing from its document facts; no "several quarters"', () => {
    const facts = docFactsOf(MAX, '2026-10-14');
    assert.equal(facts.nextResultsDate, '2026-11-10'); assert.ok(facts.timing && facts.timing.length >= 1);
    const res: any = { docId: createHash('sha1').update('mxct').digest('hex').slice(0, 20), market: 'US', ticker: 'MXCT', company: 'Maxcyte, Inc.', docUrl: 'https://x/mxct', docKind: 'PRESS_RELEASE', filedAt: '2026-10-14T00:00:00Z', status: 'ok',
      rows: [{ metric: 'REVENUE', period: 'FY26', periodKind: 'ANNUAL', basis: 'UNSTATED', currency: '$', unit: 'M', low: 34, high: 34, status: 'RAISED', prior: { low: 30, high: 32, statedIn: null }, quote: 'Full year total revenue expected to be approximately $34 million, compared to prior guidance of $30 million to $32 million' }],
      docFacts: { nextResultsDate: facts.nextResultsDate, timing: facts.timing } };
    const [ev] = buildExtractedEvents([res], () => ({}), new Date('2026-10-19T09:00:00Z'), '30D');
    assert.ok(ev, 'event built');
    assert.equal(ev.nextResultsDate, '2026-11-10');
    assert.ok(ev.nextEvidence.some((x) => /10 Nov 2026, date given by the company/.test(x)), ev.nextEvidence.join(' | '));
    assert.notEqual(ev.duration, 'MULTI_QUARTER'); assert.match(ev.guidance_driver, /accelerated|milestone/i);
    const without = buildExtractedEvents([{ ...res, docFacts: undefined }], () => ({}), new Date('2026-10-19T09:00:00Z'), '30D')[0];
    assert.equal(without.nextResultsDate, undefined, 'the quotes alone do not hold the date');
  });
  test('a growth RATE raise is in points; the % is labelled as the implied revenue effect', () => {
    const e: any = { company: 'JNJ', changes: [{ metric: 'REVENUE_GROWTH', direction: 'UP', before: { metric: 'REVENUE_GROWTH', period: 'FY26', low: 6.2, high: 6.8, midpoint: 6.5, isGrowthRate: true }, after: { metric: 'REVENUE_GROWTH', period: 'FY26', low: 6.4, high: 6.8, midpoint: 6.6, isGrowthRate: true }, percentagePointChange: 0.1 }] };
    const t = whatItMeans(e);
    assert.match(t, /growth guidance is up 0\.1 points/); assert.doesNotMatch(t, /guidance is up 0\.1%\./);
  });
  test('history rows keep total / core', () => {
    assert.equal(measureLabel('REVENUE', 'core revenue of $31 million', 'Revenue'), 'Core revenue');
  });
  test('page dump: an OTHER measure keeps its own name (SG&A), no leading "a"', () => {
    assert.equal(measureLabel('OTHER', 'SG&A operating expenses of $4,625 million', 'other measure'), 'SG&A operating expenses');
    assert.equal(measureLabel('OTHER', 'SG A operating expenses $4,625M', 'other measure'), 'SG&A operating expenses');
    assert.equal(measureLabel('OTHER', 'expects as a percentage net sales growth of 9%', 'other measure'), 'Percentage net sales growth');
  });
});

describe('zzz1139 — smaller lean universe list', async () => {
  const { leanUniverseRow, dropNullFalse } = await import('../gu-lean');
  const { readFileSync, readdirSync } = await import('node:fs');
  test('nulls and false leave the list row; zero, text, arrays and primarySourceRead=false stay; record keeps one source', () => {
    const row: any = { entityKey: 'X', mediaOnly: false, primarySourceRead: false, n: 0, t: '', a: [], history: [1], sources: [1],
      points: [{ high: null, low: 5, needsReview: false, priors: [1], notes: [] }],
      record: { history: [1, 2], nextProof: 'x', verification: 'VERIFIED', sources: [{ name: 'B', date: '2026-01-01', url: 'u2' }, { name: 'A', date: null, url: 'u', primary: true }] } };
    const l: any = leanUniverseRow(row);
    assert.equal('mediaOnly' in l, false); assert.equal(l.primarySourceRead, false); assert.equal(l.n, 0); assert.equal(l.t, ''); assert.deepEqual(l.a, []);
    assert.deepEqual(l.points[0], { low: 5, notes: [] });
    assert.deepEqual(l.record.history, []); assert.equal(l.record.nextProof, undefined);
    const h: any = leanUniverseRow({ record: { history: [{ date: '2026-01-01', old: '10%', next: '12%', period: 'FY26', revision: 'RAISED', text: 'long' }, { date: '2026-03-01', old: '', next: '15%' }, { date: '2025-06-01', old: '5%', next: '6%', revision: 'RAISED' }] } } as any);
    assert.deepEqual(h.record.history, [{ date: '2026-01-01', old: '10%', next: '12%', period: 'FY26', revision: 'RAISED' }]);
    assert.deepEqual(l.record.sources, [{ name: 'A', primary: true }]);
    assert.equal(l.lean, true);
    assert.deepEqual(dropNullFalse([{ a: null, b: [null, { c: false, d: 1 }] }]), [{ b: [null, { d: 1 }] }]);
  });
  test('fields left out of the list are read by no page', () => {
    const walk = (d: URL): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e: any) => e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : /\.tsx$/.test(e.name) ? [readFileSync(new URL(e.name, d), 'utf8')] : []);
    const all = [...walk(new URL('../../components/', import.meta.url)), ...walk(new URL('../../app/', import.meta.url))].join('\n');
    for (const k of ['periodNote', 'verificationReason', 'activeNote', 'sourceMetricLabel']) assert.doesNotMatch(all, new RegExp(`\\b${k}\\b`), k);
  });
  test('the list code never tells a missing value from null / false with === (so dropping them is safe)', () => {
    const dir = new URL('../../components/guidance-upgrades/', import.meta.url);
    const bad: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = readFileSync(new URL(f, dir), 'utf8');
      for (const line of src.split('\n')) if (/(===|!==)\s*(null|undefined)\b/.test(line) && !/(available|holds)\s*(===|!==)/.test(line)) bad.push(`${f}: ${line.trim().slice(0, 120)}`);
    }
    assert.deepEqual(bad, []);
  });
});
