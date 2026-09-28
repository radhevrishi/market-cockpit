// zzz815 — US Portfolio Catalysts showed almost no data: "Loading XBRL
// figures…" never ended, every book name said "no SEC filer found" (AKAM,
// ITW, TXN), every figure NOT DISCLOSED, and the bench looked empty. Covered:
// a loading state never says "no filer"; a failed ticker-map download is a
// retrieval failure, never cached as empty; class-share tickers map; bench
// cards are shown; the automatic type fit runs once figures land; evidence
// read without AI is labelled; a failed name says so honestly.
// Uses the committed EDGAR fixture (zzz793) and synthetic data; no network.
// Run: npx tsx --test src/lib/__tests__/zzz815-us-pc-data.test.ts
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTickerFiles, tickerSpellings, cikForTicker, SecTickerMapError, _resetTickerMapForTests,
} from '../us-edgar';
import { usFactsResult } from '../us-thesis/facts-row';
import { newUsRow, assessUsRow, usFiguresSettled, type UsRow } from '../us-thesis/assess';
import { usNoTypeReason } from '../us-thesis/us-type';
import { usFactsBatch, fetchUsFactsRow, usFactsFailure, US_FACTS_KEY, type UsFactsDeps } from '../us-thesis/facts-server';
import { usFactsToRow, usFiguresFailNote } from '../us-thesis/use-us-book';
import { usCardFiguresWords, usFiguresCounts, usFiguresLine, usPcView } from '../us-thesis/page-words';
import { buildUsDetEvidence, withUsDetEvidence, usInventoryEvent, usDetQueue, usDetNeedsRun, US_DET_LABEL } from '../us-thesis/det-evidence';
import { instantYoY } from '../us-thesis/xbrl';
import { extractVariables } from '../thesis/variables';

const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz793-us-pc-edgar.json'), 'utf8'));
const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const NO_FILER = /no SEC filer/i;

/** A row as the page creates it before anything is read. */
const loadingRow = (t: string, origin: 'book' | 'bench' = 'book'): UsRow =>
  ({ ...newUsRow(t, origin, null, null, 'NYSE'), assessment: null, figures: { state: 'loading', note: null, attempts: 0 } });
/** The /facts answer for a fixture company, as the server builds it. */
const factsAnswer = (t: string) => {
  const c = FX.companies[t];
  const r = usFactsResult(t, c.facts, { cik: c.cik, company: c.entityName, sic: c.sic, sicDescription: c.sicDescription, forms: c.forms });
  return r.row ? { ...r.row, us_profile: r.profile } : { ticker: t, source: 'none', why: r.why, us_profile: r.profile };
};
const memKv = () => { const m = new Map<string, any>(); return { m, kvGet: async (k: string) => m.get(k) ?? null, kvSet: async (k: string, v: any) => { m.set(k, v); } }; };
const tickerMap = (rows: Array<[number, string, string]>) => parseTickerFiles({ fields: ['cik', 'name', 'ticker', 'exchange'], data: rows.map(([c, t, x]) => [c, 'Co', t, x]) }, null)!;

describe('a loading state never says "no SEC filer"', () => {
  test('the no-type reason while figures load says loading, not no filer', () => {
    assert.equal(usNoTypeReason(undefined, null), 'loading SEC figures…');
    assert.doesNotMatch(usNoTypeReason(null, null), NO_FILER, 'a profile that failed to load is a retrieval failure');
  });
  test('a fresh row is not assessed and its card line says loading', () => {
    const r = loadingRow('AKAM');
    assert.equal(r.assessment, null, 'no THESIS NOT SET / NOT DISCLOSED before anything is read');
    assert.equal(usFiguresSettled(r), false);
    assert.equal(usCardFiguresWords(r), 'loading SEC figures…');
    assert.doesNotMatch(usCardFiguresWords(r), NO_FILER);
    assert.doesNotMatch(usCardFiguresWords(r), /not loaded yet/);
  });
  test('the page renders a pending block (no ThesisCard, no NOT DISCLOSED) until figures settle', () => {
    const page = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    assert.match(page, /!usFiguresSettled\(r0\) \? \(/);
    assert.match(page, /data-testid="us-card-pending"/);
    assert.doesNotMatch(page, /'not loaded yet'/, 'the contradictory "not loaded yet" fallback is gone');
    // "Thesis not set" lists only names whose figures are in.
    assert.match(page, /!r\.pattern && usFiguresSettled\(r\)/);
  });
  test('"no SEC filer" only when the LOADED map lacks every spelling', async () => {
    const kv = memKv();
    const deps: UsFactsDeps = { cik: async () => ({ cik: null, tried: ['ZZZZQ'] }), submissions: async () => null, companyFacts: async () => null, companyFactsFresh: async () => null, ...kv };
    const r = await fetchUsFactsRow('ZZZZQ', deps);
    assert.match(r.why, NO_FILER);
    assert.equal(r.no_filer, true);
    const row = usFactsToRow(loadingRow('ZZZZQ'), r, {}, false);
    assert.equal(row.figures?.state, 'none');
    assert.equal(row.figures?.noFiler, true);
    assert.equal(row.assessment?.status, 'THESIS_NOT_SET', 'a genuine absence is thesis-not-set, said as such');
  });
});

describe('a failed ticker-map download is not cached as empty', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => _resetTickerMapForTests(null));
  afterEach(() => { globalThis.fetch = realFetch; _resetTickerMapForTests(null); });

  test('an empty or malformed file is a failure (null), not an empty market', () => {
    assert.equal(parseTickerFiles(null, null), null);
    assert.equal(parseTickerFiles({ fields: ['cik', 'ticker'], data: [] }, {}), null);
    const viaPlain = parseTickerFiles({ unexpected: true }, { 0: { cik_str: 67887, ticker: 'MOG-A' } });
    assert.equal(viaPlain?.byTicker.get('MOG-A')?.cik, 67887, 'the plain file is the fallback');
  });

  test('SEC down → SecTickerMapError (never "not found"); SEC back → the map loads', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('busy', { status: 503 }); }) as any;
    await assert.rejects(() => cikForTicker('AKAM'), (e: any) => e instanceof SecTickerMapError);
    const afterFirst = calls;
    // Within the short failure memo a burst fails fast — no new downloads.
    await assert.rejects(() => cikForTicker('ITW'), (e: any) => e instanceof SecTickerMapError);
    assert.equal(calls, afterFirst, 'a burst of callers does not re-download');
    // Nothing was cached as an empty map: once SEC answers, the lookup works.
    _resetTickerMapForTests(null);                  // the memo expires (20 s in production)
    globalThis.fetch = (async () => new Response(JSON.stringify({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1086222, 'AKAMAI', 'AKAM', 'Nasdaq']] }), { status: 200 })) as any;
    assert.deepEqual((await cikForTicker('AKAM')).cik, 1086222);
  });

  test('a map failure becomes "SEC request failed — retrying" and is NOT written to the cache', async () => {
    const kv = memKv();
    const deps: UsFactsDeps = { cik: async () => { throw new SecTickerMapError(); }, submissions: async () => null, companyFacts: async () => null, companyFactsFresh: async () => null, ...kv };
    const r = await fetchUsFactsRow('AKAM', deps);
    assert.equal(r.retrieval_failed, true);
    assert.match(r.why, /^SEC request failed — retrying/);
    assert.doesNotMatch(r.why, NO_FILER);
    assert.equal(kv.m.has(US_FACTS_KEY('AKAM')), false, 'a retrieval failure is never cached');
    // …and a cached failure from an older build is not served either.
    kv.m.set(US_FACTS_KEY('ITW'), { ticker: 'ITW', source: 'none', retrieval_failed: true, why: 'x' });
    const b = await usFactsBatch(['ITW'], {}, { ...deps, cik: async () => ({ cik: null, tried: ['ITW'] }) });
    assert.equal(b.cached, 0);
  });

  test('the read route never turns a map failure into "not an SEC filer"', () => {
    const route = read('app/api/v1/us-thesis/read/route.ts');
    assert.match(route, /cikForTicker\(ticker\)\.catch\(\(\) => \{ mapFailed = true/);
    assert.match(route, /if \(mapFailed\)[\s\S]{0,400}RETRIEVAL_FAILED/);
  });
});

describe('class-share tickers map to SEC', () => {
  test('spellings: MOG-A / MOG.A / "MOG A" / MOGA', () => {
    for (const x of ['MOG-A', 'MOG.A', 'MOG A', 'mog-a']) assert.equal(tickerSpellings(x)[0], 'MOG-A', x);
    assert.ok(tickerSpellings('MOGA').includes('MOG-A'));
    assert.ok(tickerSpellings('BRK.B').includes('BRK-B'));
  });
  test('lookup resolves every spelling, and ALB stays ALB', async () => {
    _resetTickerMapForTests(tickerMap([[67887, 'MOG-A', 'NYSE'], [67887, 'MOG-B', 'NYSE'], [915913, 'ALB', 'NYSE'], [1067983, 'BRK-B', 'NYSE']]));
    try {
      for (const x of ['MOG-A', 'MOG.A', 'MOG A', 'MOGA']) assert.equal((await cikForTicker(x)).cik, 67887, x);
      assert.equal((await cikForTicker('BRK.B')).cik, 1067983);
      const alb = await cikForTicker('ALB');
      assert.equal(alb.cik, 915913);
      assert.equal(alb.matched, 'ALB');
      const none = await cikForTicker('ZZZZQ');
      assert.equal(none.cik, null, 'loaded map, ticker absent → null (the only "no filer" case)');
    } finally { _resetTickerMapForTests(null); }
  });
});

describe('bench cards render', () => {
  const ORDER = ['BROKEN', 'WEAKENING', 'NEGATIVE_EXPECTATION_GAP', 'POSITIVE_EXPECTATION_GAP', 'EVIDENCE_INCOMPLETE', 'CONFIRMATION_REQUIRED', 'ON_TRACK', 'STRENGTHENING', 'NEUTRAL', 'THESIS_NOT_SET'];
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({ ...loadingRow(`BK${i}`, 'book') })),
    ...Array.from({ length: 86 }, (_, i) => ({ ...loadingRow(`BN${i}`, 'bench'), preset: { state: 'pass' as const, reasons: [], text: 'meets' } })),
    ...Array.from({ length: 3 }, (_, i) => ({ ...loadingRow(`BF${i}`, 'bench'), preset: { state: 'fail' as const, reasons: ['sales'], text: 'misses' } })),
  ];
  test('All shows book + bench (116), loading bench names included', () => {
    const v = usPcView(rows, { source: 'all', showFailing: false, filter: null, order: ORDER });
    assert.equal(v.inSource.length, 116);
    assert.equal(v.list.filter((r) => r.origin === 'bench').length, 86);
    assert.equal(v.list.slice(0, 30 + 86).length, 116);
  });
  test('the bench view shows the 86 bench names; failing ones only with the chip', () => {
    assert.equal(usPcView(rows, { source: 'bench', showFailing: false, filter: null, order: ORDER }).list.length, 86);
    assert.equal(usPcView(rows, { source: 'bench', showFailing: true, filter: null, order: ORDER }).list.length, 89);
    assert.equal(usPcView(rows, { source: 'book', showFailing: false, filter: null, order: ORDER }).list.length, 30);
  });
  test('the page uses the shared view, shows "N of M cards", and names a narrowed view', () => {
    const page = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    assert.match(page, /usPcView\(all0, \{ source, showFailing, filter, order: ORDER \}\)/);
    assert.match(page, /\{visible\.length\} of \{list\.length\} card/);
    assert.match(page, /data-testid="us-view-note"/);
    assert.match(page, /Show \{Math\.min\(PC_PAGE_STEP, list\.length - visible\.length\)\} more/);
  });
});

describe('the automatic type fit runs once the figures land', () => {
  test('book and bench names get a type (exact or provisional) and a status', () => {
    for (const [t, origin] of [['ITW', 'book'], ['MOG-A', 'book'], ['ALB', 'bench'], ['NTNX', 'bench']] as const) {
      const r = usFactsToRow(loadingRow(t, origin), factsAnswer(t), {}, false);
      assert.equal(r.figures?.state, 'ok', t);
      assert.ok(r.pattern?.pattern, `${t} has a thesis type`);
      assert.ok(r.assessment?.status, `${t} is assessed`);
      assert.notEqual(r.assessment?.status, 'THESIS_NOT_SET', `${t} has figures, so it is not thesis-not-set`);
      if (r.pattern?.fit === 'nearest') assert.ok(!['STRENGTHENING', 'ON_TRACK'].includes(String(r.assessment?.status)), 'a provisional fit is never affirmative');
    }
  });
  test('the owner\'s saved type wins', () => {
    const r = usFactsToRow(loadingRow('ITW'), factsAnswer('ITW'), { ITW: 'G' }, false);
    assert.equal(r.pattern?.pattern, 'G');
  });
  test('a read in flight is not ended by the figures landing', () => {
    const r = usFactsToRow({ ...loadingRow('ITW'), state: 'loading' }, factsAnswer('ITW'), {}, false);
    assert.equal(r.state, 'loading');
  });
});

describe('evidence read without AI is labelled and never replaces the AI read', () => {
  const release = 'Powell Industries reported results. Backlog was $2.4 billion at June 30, 2026, compared to $1.4 billion a year earlier. New orders were $934 million in the quarter. The company raised its full-year revenue guidance.';
  const det = buildUsDetEvidence('POWL', [{ label: 'Earnings release — 8-K Item 2.02 (EX-99.1), filed 2026-08-03', url: 'https://www.sec.gov/x', outcome: 'read', text: release }], { period: 'Q1 FY27', filed: '2026-08-03', now: new Date('2026-09-28T00:00:00Z') });
  test('every event names its source as read without AI', () => {
    assert.equal(det.state, 'EVIDENCE_FOUND');
    assert.equal(det.source, 'deterministic');
    assert.equal(det.label, US_DET_LABEL);
    assert.ok(det.events.length >= 2);
    for (const e of det.events) assert.match(String(e.source), /read without AI$/);
    const ob = det.events.find((e) => e.variable === 'order_book');
    assert.equal(ob?.after, '$2.4 billion');
    assert.equal(ob?.before, '$1.4 billion');
    assert.match(det.note, /read without AI/);
    assert.equal((det.documents[0] as any).text, undefined, 'document text is not persisted');
  });
  test('with no AI read the rows fill the card; the row still counts as not read (AI button stays)', () => {
    const base = usFactsToRow(loadingRow('POWL'), factsAnswer('ITW'), {}, false);   // any fixture figures
    const withDet = assessUsRow({ ...base, det }, {});
    assert.equal(withDet.summary, null, 'the row\'s own summary is untouched');
    const s = withUsDetEvidence(null, det);
    assert.equal(s.read_without_ai, true);
    const vars = extractVariables(withDet.graded, s, null, {});
    const ob = vars.find((v) => v.key === 'order_book');
    assert.ok(ob, 'the order book row is filled');
    assert.match(String((ob as any).evidence || ''), /Backlog was \$2\.4 billion/);
  });
  test('an AI summary wins: the no-AI events are not merged into it', () => {
    const ai = { events: [{ variable: 'order_book', value_type: 'ACTUAL', before: null, after: '$2.5 billion', unit: null, period: null, direction: 'unknown', evidence_text: 'Backlog was $2.5 billion.', source: '10-Q', confidence: 'HIGH' }] };
    const s = withUsDetEvidence(ai, det);
    assert.equal(s.events.length, 1);
    assert.equal(s.read_without_ai, undefined);
  });
  test('filed inventories become an amount row (not judged), labelled', () => {
    const facts = { facts: { 'us-gaap': { InventoryNet: { units: { USD: [
      { end: '2025-06-30', val: 80_000_000, filed: '2025-08-01', form: '10-Q' },
      { end: '2026-06-30', val: 95_371_000, filed: '2026-08-04', form: '10-Q' },
    ] } } } } };
    const inv = instantYoY(facts, ['InventoryNet'], '2026-06-30');
    assert.equal(inv?.pct, 19.2);
    const e = usInventoryEvent(inv);
    assert.equal(e?.variable, 'working_capital');
    assert.match(String(e?.source), /SEC XBRL — read without AI/);
    assert.equal(instantYoY(facts, ['InventoryNet'], '2026-12-31'), null, 'no figure at that quarter end → nothing');
  });
  test('the queue: book first, then bench; AI-read, loading and no-filer names skipped; a day-old record re-run', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    const ok = { state: 'ok', note: null, attempts: 1 } as const;
    const rows = [
      { symbol: 'ZB', origin: 'bench', figures: ok }, { symbol: 'AB', origin: 'book', figures: ok },
      { symbol: 'READ', origin: 'book', figures: ok, summary: { x: 1 } }, { symbol: 'LOAD', origin: 'book', figures: { state: 'loading' } },
      { symbol: 'NF', origin: 'book', figures: { state: 'none', noFiler: true } },
      { symbol: 'FRESH', origin: 'book', figures: ok, det: { ...det, read_at: '2026-09-28T06:00:00Z' } },
      { symbol: 'OLD', origin: 'bench', figures: ok, det: { ...det, read_at: '2026-09-26T06:00:00Z' } },
    ];
    assert.deepEqual(usDetQueue(rows as any, now), ['AB', 'OLD', 'ZB']);
    assert.equal(usDetNeedsRun({ ...det, state: 'RETRIEVAL_FAILED', read_at: '2026-09-28T11:55:00Z' }, now), false, 'a failure is retried after a pause, not in a loop');
  });
  test('the no-AI route calls no model and reads no price', () => {
    const route = read('app/api/v1/us-thesis/det-evidence/route.ts') + read('lib/us-thesis/det-evidence-server.ts') + read('lib/us-thesis/det-evidence.ts');
    const imports = route.split('\n').filter((l) => /^import /.test(l)).join('\n');
    assert.doesNotMatch(imports, /anthropic|model|openai/i);
    assert.doesNotMatch(imports, /quote|price|yahoo/i);
  });
});

describe('an honest per-name failure message', () => {
  test('a name SEC does not answer for times out alone; the batch answers for every name', async () => {
    const kv = memKv();
    const deps: UsFactsDeps = {
      cik: async (t) => (t === 'HANG' ? new Promise(() => { /* never answers */ }) : { cik: 1, tried: [t] }) as any,
      submissions: async () => ({ name: 'Co', recent: [] }), companyFacts: async () => null, companyFactsFresh: async () => null, ...kv,
    };
    const t0 = Date.now();
    const b = await usFactsBatch(['HANG', 'OK1'], { perNameMs: 300, deadlineMs: 5_000 }, deps);
    assert.ok(Date.now() - t0 < 3_000, 'bounded by the per-name limit');
    assert.deepEqual(Object.keys(b.rows).sort(), ['HANG', 'OK1']);
    assert.equal(b.rows.HANG.retrieval_failed, true);
    assert.match(b.rows.HANG.why, /^SEC request failed — retrying \(SEC did not answer within/);
    assert.doesNotMatch(b.rows.HANG.why, NO_FILER);
  });
  test('the card: retrying first, then failed with a Retry — never a finding, never assessed', () => {
    const f = usFactsFailure('AKAM', 'SEC EDGAR did not answer');
    const r1 = usFactsToRow(loadingRow('AKAM'), f, {}, false);
    assert.equal(r1.figures?.state, 'retrying');
    assert.equal(r1.assessment, null);
    assert.equal(usCardFiguresWords(r1), 'SEC request failed (SEC EDGAR did not answer) — retrying');
    const r2 = usFactsToRow(r1, f, {}, true);
    assert.equal(r2.figures?.state, 'failed');
    assert.equal(r2.figures?.attempts, 2);
    assert.match(usCardFiguresWords(r2), /^SEC request failed \(SEC EDGAR did not answer\) — not a finding about the company/);
    const noAnswer = usFactsToRow(loadingRow('ITW'), undefined, {}, false);
    assert.equal(usCardFiguresWords(noAnswer), 'SEC request failed (no answer from the server) — retrying');
    assert.equal(usFiguresFailNote(null, false), 'SEC request failed — retrying');
  });
  test('the progress line adds up and names failures as failures', () => {
    const ok = usFactsToRow(loadingRow('ITW'), factsAnswer('ITW'), {}, false);
    const rows = [ok, loadingRow('A'), usFactsToRow(loadingRow('B'), usFactsFailure('B', 'x'), {}, false), usFactsToRow(loadingRow('C'), usFactsFailure('C', 'x'), {}, true)];
    const c = usFiguresCounts(rows);
    assert.deepEqual(c, { total: 4, loading: 1, ok: 1, none: 0, retrying: 1, failed: 1 });
    assert.equal(usFiguresLine(c, false), 'SEC XBRL figures: 1 of 4 in (1 with quarterly figures · 1 loading · 1 SEC request failed — retrying · 1 SEC request failed (not a finding about the company)).');
  });
});
