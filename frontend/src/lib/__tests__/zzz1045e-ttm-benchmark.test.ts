import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestFacts, quartersFromFacts, ttmSum, fcfTtm, cfDue, r40TtmDiff, r40TtmDiffNote, parseCompanyConcept, trimQuarters, FCF_TTM_VERSION, type SecFact } from '../screener/fcf-ttm';
import { usFigures, framePeriods, quarterLabelForEnd, type FrameData } from '../screener/sec-assemble';
import { ruleOf40, LEAN_KEYS, r40Explain } from '../screener/pine';
import { fieldOf } from '../screener/filters';
import { runBenchmark, benchTable, barsFromCloses, truncateAt, synthBars, seedLoader, SEED_EXAMPLES, type BenchExample } from '../pattern-benchmark';

const f = (start: string, end: string, val: number, filed = '2026-01-01', form = '10-Q'): SecFact => ({ start, end, val, filed, form });

// a June fiscal year (FY ends 30 June): year-to-date chains starting 1 July
const JUNE_FY: SecFact[] = [
  // FY2025 (Jul 2024 – Jun 2025)
  f('2024-07-01', '2024-09-30', 100, '2024-11-01'), f('2024-07-01', '2024-12-31', 210, '2025-02-01'), f('2024-07-01', '2025-03-31', 330, '2025-05-01'), f('2024-07-01', '2025-06-30', 460, '2025-08-20', '10-K'),
  // FY2026 (Jul 2025 – Jun 2026)
  f('2025-07-01', '2025-09-30', 140, '2025-11-01'), f('2025-07-01', '2025-12-31', 290, '2026-02-01'), f('2025-07-01', '2026-03-31', 450, '2026-05-01'),
  // comparatives repeated in a later report (same span, same value) — must not double count
  f('2024-07-01', '2024-09-30', 100, '2025-11-01'),
];

test('zzz1045e YTD → quarters: Q2 = H1 − Q1, Q3 = 9 months − H1, Q4 = year − 9 months, on a June fiscal year', () => {
  const qs = quartersFromFacts(JUNE_FY);
  const by = Object.fromEntries(qs.map((q) => [q.e, q]));
  assert.equal(by['2024-09-30'].v, 100); assert.equal(by['2024-09-30'].d, 0);
  assert.equal(by['2024-12-31'].v, 110); assert.equal(by['2024-12-31'].s, '2024-10-01'); assert.equal(by['2024-12-31'].d, 1);
  assert.equal(by['2025-03-31'].v, 120);
  assert.equal(by['2025-06-30'].v, 130); assert.equal(by['2025-06-30'].s, '2025-04-01');   // Q4 from the 10-K
  assert.equal(by['2025-12-31'].v, 150); assert.equal(by['2026-03-31'].v, 160);
  // TTM to 31 Mar 2026 = Q4 FY25 + Q1–Q3 FY26 = 130 + 140 + 150 + 160
  const t = ttmSum(qs)!;
  assert.equal(t.v, 580); assert.equal(t.s, '2025-04-01'); assert.equal(t.e, '2026-03-31');
  // TTM to a given end
  assert.equal(ttmSum(qs, '2025-06-30')!.v, 460);
});

test('zzz1045e amendments: the latest filed fact of a span wins; non-10-Q/K forms are ignored', () => {
  const facts = [f('2025-01-01', '2025-03-31', 50, '2025-05-01'), f('2025-01-01', '2025-03-31', 55, '2025-07-01', '10-Q/A'), f('2025-01-01', '2025-03-31', 999, '2025-08-01', '8-K')];
  const l = latestFacts(facts);
  assert.equal(l.length, 1); assert.equal(l[0].val, 55);
});

test('zzz1045e a missing quarter (no 6-month figure) → unknown, never 0', () => {
  const gap = JUNE_FY.filter((x) => !(x.start === '2025-07-01' && x.end === '2025-12-31'));
  const qs = quartersFromFacts(gap);
  assert.ok(!qs.some((q) => q.e === '2025-12-31'));
  assert.equal(ttmSum(qs, '2026-03-31'), null);
  assert.equal(ttmSum([], null), null);
});

test('zzz1045e FCF TTM needs all four quarters of BOTH lines; a negative capex quarter is unknown', () => {
  const cfo = quartersFromFacts(JUNE_FY);
  const capex = quartersFromFacts(JUNE_FY.map((x) => ({ ...x, val: x.val / 10 })));
  const t = fcfTtm(cfo, capex)!;
  assert.equal(t.cfo, 580); assert.equal(Math.round(t.capex * 10) / 10, 58); assert.equal(Math.round(t.fcf * 10) / 10, 522); assert.equal(t.e, '2026-03-31');
  // capex with only three quarters
  assert.equal(fcfTtm(cfo, capex.filter((q) => q.e !== '2025-06-30')), null);
  // no capex at all
  assert.equal(fcfTtm(cfo, []), null);
  // a capex year-to-date total that went DOWN → negative quarter → unknown
  const bad = quartersFromFacts([...JUNE_FY.filter((x) => x.start !== '2025-07-01'), f('2025-07-01', '2025-09-30', 20), f('2025-07-01', '2025-12-31', 10), f('2025-07-01', '2026-03-31', 30)]);
  assert.equal(fcfTtm(cfo, bad), null);
});

test('zzz1045e company-concept parse + trim + cfDue', () => {
  const facts = parseCompanyConcept({ units: { USD: [{ start: '2025-01-01', end: '2025-03-31', val: 7, form: '10-Q', filed: '2025-05-01' }, { end: '2025-03-31', val: 1 }, { val: 'x' }] } });
  assert.equal(facts.length, 2);
  assert.deepEqual(parseCompanyConcept(null), []);
  assert.equal(trimQuarters(quartersFromFacts(JUNE_FY), 3).length, 3);
  const stored = { ver: FCF_TTM_VERSION, read: '2026-10-01T00:00:00Z', cfo: [{ s: '2026-04-01', e: '2026-06-30', v: 1 }], cx: [] };
  const now = Date.parse('2026-10-05T00:00:00Z');
  assert.equal(cfDue(undefined, 'CY2026Q2', quarterLabelForEnd, now), true);
  assert.equal(cfDue({ ...stored, ver: 0 }, 'CY2026Q2', quarterLabelForEnd, now), true);
  assert.equal(cfDue(stored, 'CY2026Q2', quarterLabelForEnd, now), false, 'same quarter, read recently');
  assert.equal(cfDue(stored, 'CY2026Q3', quarterLabelForEnd, now), true, 'SEC has a newer quarter');
  assert.equal(cfDue(stored, 'CY2026Q2', quarterLabelForEnd, Date.parse('2026-12-01')), true, 'older than 45 days');
});

test('zzz1045e usFigures: fcfmT from the same four quarters as revenue; fcfmFY untouched; r40T = growth + fcfmT', () => {
  const periods = framePeriods(new Date('2026-10-07T00:00:00Z'));   // last quarter CY2026Q3
  const cik = 42;
  const fd: FrameData = { Revenues: {} };
  const qEnds: Array<[string, string, string, number]> = [
    ['CY2025Q3', '2025-07-01', '2025-09-30', 800], ['CY2025Q4', '2025-10-01', '2025-12-31', 900], ['CY2026Q1', '2026-01-01', '2026-03-31', 950],
    ['CY2026Q2', '2026-04-01', '2026-06-30', 1000], ['CY2026Q3', '2026-07-01', '2026-09-30', 1150],
  ];
  for (const [p, s, e, v] of qEnds) fd.Revenues[p] = { [cik]: { v, s, e } };
  // calendar fiscal year: cash flow YTD from 1 Jan 2026, plus FY2025
  const cfo = quartersFromFacts([
    f('2025-01-01', '2025-09-30', 900), f('2025-01-01', '2025-12-31', 1300, '2026-02-20', '10-K'),
    f('2026-01-01', '2026-03-31', 300), f('2026-01-01', '2026-06-30', 650), f('2026-01-01', '2026-09-30', 1000),
  ]);
  const cx = quartersFromFacts([
    f('2025-01-01', '2025-09-30', 90), f('2025-01-01', '2025-12-31', 130, '2026-02-20', '10-K'),
    f('2026-01-01', '2026-03-31', 30), f('2026-01-01', '2026-06-30', 65), f('2026-01-01', '2026-09-30', 100),
  ]);
  const out = usFigures(fd, cik, periods, { cfo, cx });
  // TTM: CFO 400 + 1000 = 1400, capex 40 + 100 = 140 → FCF 1260 on revenue 900 + 950 + 1000 + 1150 = 4000 → 31.5%
  assert.equal(out.fcfmT, 31.5);
  assert.equal(out.fcfmTAt, '2026-09-30');
  assert.equal(out.revQYoY, 43.8);
  assert.equal(ruleOf40(out.revQYoY, out.fcfmT), 75.3);
  // without cash-flow quarters: no trailing figure at all
  const plain = usFigures(fd, cik, periods);
  assert.equal(plain.fcfmT, undefined);
  // cash flow that stops a quarter early (the Q3 10-Q not read yet) → unknown, not an older TTM mixed with newer revenue
  const early = usFigures(fd, cik, periods, { cfo: cfo.filter((q) => q.e !== '2026-09-30'), cx });
  assert.equal(early.fcfmT, null);
});

test('zzz1045e field definitions, lean keys and the Rule of 40 explanation', () => {
  const ft = fieldOf('fcfmT')!, rt = fieldOf('r40T')!;
  assert.deepEqual(ft.markets, ['US']); assert.deepEqual(rt.markets, ['US']);
  assert.match(ft.label, /trailing 12 months \(USA\)/);
  assert.match(ft.approxNote!.US!, /India has no trailing figure: screener\.in prints no quarterly cash flow/);
  for (const k of ['fcfmT', 'fcfmTAt', 'r40T']) assert.ok((LEAN_KEYS as readonly string[]).includes(k), k);
  // existing meaning kept: r40 uses fcfmTTM (full year); the trailing figure is only mentioned
  const x = r40Explain({ revQYoY: 30, fcfmTTM: 15, fcfmAt: '2025-12-31', fcfmT: 22, fcfmTAt: '2026-09-30', r40T: 52 }, 40);
  assert.equal(x.value, 45);
  assert.match(x.text, /on trailing-12-month FCF \(22% to 2026-09-30\) it would be 52 — a separate field, not used by this rule/);
});

test('zzz1045e before / after report: who joins and who leaves a Rule of 40 ≥ 40 screen', () => {
  const d = r40TtmDiff([
    { t: 'AAA', r40: 35, r40T: 48 },     // gains
    { t: 'BBB', r40: 50, r40T: 30 },     // loses
    { t: 'CCC', r40: 60, r40T: 61 },     // passes both
    { t: 'DDD', r40: 45, r40T: null },   // loses (TTM unknown)
    { t: 'EEE', r40: null, r40T: 41 },   // gains (FY unknown)
    { t: 'FFF', r40: null, r40T: null },
  ]);
  assert.deepEqual(d.gained.map((c) => c.t), ['AAA', 'EEE']);
  assert.deepEqual(d.lost.map((c) => c.t), ['BBB', 'DDD']);
  assert.equal(d.comparable, 3); assert.equal(d.fyOnly, 1); assert.equal(d.ttmOnly, 1);
  const note = r40TtmDiffNote(d);
  assert.match(note, /2 would newly pass — AAA \(35 → 48\), EEE \(— → 41\)/);
  assert.match(note, /Saved screens still use the full-year figure/);
});

// ── pattern benchmark ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz1045e benchmark: seed set runs, scores precision / recall, and says it is synthetic', () => {
  const r = runBenchmark(SEED_EXAMPLES, seedLoader);
  assert.equal(r.synthetic, true);
  assert.equal(r.totals.tp + r.totals.fn, SEED_EXAMPLES.filter((e) => e.label === 'positive').length);
  assert.equal(r.totals.fp + r.totals.tn, SEED_EXAMPLES.filter((e) => e.label === 'negative').length);
  assert.ok(r.totals.recall! >= 0.66, JSON.stringify(r.totals));
  assert.equal(r.totals.fp, 0, 'textbook hard negatives are not reported');
  assert.match(benchTable(r), /SYNTHETIC/);
});

test('zzz1045e benchmark metrics: FP / miss / disputed / stale / no bars, and truncation at asOf', () => {
  const cup = SEED_EXAMPLES.find((e) => e.ticker === 'SYN-CUPH')!;
  const down = SEED_EXAMPLES.find((e) => e.ticker === 'SYN-DOWN')!;
  const ex: BenchExample[] = [
    cup,                                                                      // TP
    { ...cup, ticker: 'SYN-CUPH-NEG', label: 'negative' },                    // the same shape labelled negative → engine says yes → FP
    { ...down, ticker: 'SYN-DOWN-POS', pattern: 'flat_base', label: 'positive' },   // a downtrend labelled flat base → miss
    { ...cup, ticker: 'SYN-DISPUTE' }, { ...cup, ticker: 'SYN-DISPUTE', label: 'negative' },   // labelled both ways → left out
    { ...cup, ticker: 'SYN-EMPTY', bars: { ohlcv: [] } },                     // no bars
  ];
  const r = runBenchmark(ex, seedLoader);
  const c = r.cells.find((x) => x.pattern === 'cup_handle')!;
  assert.equal(c.tp, 1); assert.equal(c.fp, 1); assert.equal(c.precision, 0.5); assert.equal(c.recall, 1);
  const fb = r.cells.find((x) => x.pattern === 'flat_base')!;
  assert.equal(fb.fn, 1); assert.equal(fb.recall, 0);
  assert.equal(r.disputed.length, 1); assert.match(r.disputed[0], /SYN-DISPUTE/);
  assert.equal(r.noBars.length, 1);
  // stale: with a 0-bar window every detection whose structure ended before the last bar counts as stale
  const rs = runBenchmark([cup], seedLoader, { staleBars: -1 });
  assert.equal(rs.cells[0].stale, 1);
  // truncation: the engine never sees bars after asOf
  const bars = synthBars({ legs: [[10, 100], [10, 120]], history: 0 });
  const cut = truncateAt(bars, new Date(bars[5].t).toISOString().slice(0, 10));
  assert.equal(cut.length, 6);
});

test('zzz1045e benchmark: closes-only fixture (HAL) loads as daily bars', () => {
  const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'stage-daily-hal-avav.json'), 'utf8'));
  const bars = barsFromCloses(fx.tickers.HAL);
  assert.equal(bars.length, fx.tickers.HAL.c.length);
  assert.equal(bars[0].t, fx.tickers.HAL.d0 * 86_400_000);
  assert.ok(bars.every((b, i) => i === 0 || b.t > bars[i - 1].t));
  assert.ok(bars.every((b) => b.h >= b.c && b.l <= b.c));
});
