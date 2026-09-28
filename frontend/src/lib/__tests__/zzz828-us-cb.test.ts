// zzz828 — US Conviction Beats: the "missing stocks" audit (false fails from
// missing / mismatched figures → not checked), the whole CB list as a view on
// US Portfolio Catalysts with a name-for-name reconciliation, stale tiers
// re-synced under the current engine (never silently removed), neutral labels
// in place of BUY/SELL words, words in place of 0–100 scores, decoded company
// names, and reads that end. Synthetic tickers only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  usCashRatio, usCbCriteriaCheck, passesUsConvictionFilter, usPresetFilters, isUsPresetActive, usCbSavedFilters,
  usVerdictWord, normalizeUsVerdictKeys, US_VERDICT_WORDS, usNowTierText,
  syncUsConvictionMap, usEngineStale, usEngineResyncQueue, applyUsEngineResync, markUsEngineChecked,
  US_ENGINE_RESYNC_TRIES, US_ENGINE_RESYNC_CAP, usCbHiddenReport, usCbReconcile, usBenchFields,
  usScoreWord, usPeadWord, usRsWord, US_FILTER_DEFAULT,
  type UsConvictionEntry,
} from '../conviction-beats-us';
import { US_ENGINE_VERSION } from '../us-engine-version';
import { usPcView } from '../us-thesis/page-words';
import { emptyCbSelection } from '../us-thesis/use-us-book';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

/** A synthetic US bench entry that meets the whole preset on real figures. */
const good = (ticker: string, over: Record<string, any> = {}): UsConvictionEntry => ({
  ticker, company: `${ticker} Synthetic Corp`, tier: 'STRONG', composite_score: 80,
  sales_yoy_pct: 40, net_profit_yoy_pct: 60, eps_yoy_pct: 60, opm_pct: 20, opm_prev_pct: 15,
  revenue_curr_musd: 500, net_income_curr_musd: 50, cfo_curr_musd: 60,
  market_cap_musd: 1500, pead_score: 70, pct_vs_ma50: 5, pct_vs_ma200: 12,
  filing_date: '2026-08-10', quarter: 'Q2', fiscal_year: 2026, added_at: '2026-08-10T00:00:00Z',
  engine_version: US_ENGINE_VERSION,
  ...over,
}) as any;

/** Eight quarters of cash and income, $M. */
const series = (cfo: number[], ni: number[], rev = [100, 100, 100, 100, 100, 100, 100, 100]) => ({
  ends: ['2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'],
  revenue: rev, gross_profit: rev.map(() => null), operating_income: rev.map(() => null),
  net_income: ni, eps: rev.map(() => null), cfo, fcf: rev.map(() => null),
});

const preset = { ...usPresetFilters(), cap: 'smid' } as any;

describe('zzz828 — cash ratio: one period on both sides', () => {
  test('trailing twelve months of cash AND income when the series has four quarters', () => {
    // Latest quarter's cash is a working-capital dip (5 vs income 10) — the
    // one-quarter ratio 0.5 would fail a 0.8 gate; the trailing year is 1.2.
    const e = good('ZZTTM', { cfo_curr_musd: 5, net_income_curr_musd: 10, series: series([12, 12, 12, 12, 14, 14, 15, 5], [10, 10, 10, 10, 10, 10, 10, 10]) });
    const cr = usCashRatio(e);
    assert.equal(cr.basis, 'ttm');
    assert.equal(cr.ratio, 1.2);
    assert.equal(passesUsConvictionFilter(e, { ...preset, cfoPatMin: 0.8 }), true);
  });
  test('a net loss over the period is a real fail, not "not checked"', () => {
    const e = good('ZZLOSS', { series: series([5, 5, 5, 5, 5, 5, 5, 5], [-3, -3, -3, -3, -2, -2, -2, 1]) });
    assert.equal(usCashRatio(e).lossMaking, true);
    const c = usCbCriteriaCheck(e, preset);
    assert.equal(c.state, 'fail');
    assert.match(c.failed.join(' '), /net loss/);
  });
  test('same quarter of both when there is no usable series', () => {
    const cr = usCashRatio(good('ZZQTR'));
    assert.deepEqual([cr.basis, cr.ratio], ['quarter', 1.2]);
  });
  test('no cash figure at all → NOT CHECKED (shown, labelled), never a fail', () => {
    const e = good('ZZNOCASH', { cfo_curr_musd: null, cfo_to_pat_ratio: null });
    const c = usCbCriteriaCheck(e, preset);
    assert.equal(c.state, 'unknown');
    assert.match(c.missing.join(' '), /cash ratio/);
  });
  test('a too-small income is refused, not divided', () => {
    const cr = usCashRatio(good('ZZTINY', { net_income_curr_musd: 2, revenue_curr_musd: 500 }));
    assert.equal(cr.ratio, null);
    assert.match(cr.why, /too small/);
  });
});

describe('zzz828 — growth gates: missing → not checked, a loss → profit turn is not a miss', () => {
  test('EPS / net income swung from a loss to a profit clears the growth gate', () => {
    const e = good('ZZTURN', { eps_yoy_pct: null, eps_swing: 'loss-to-profit' });
    assert.equal(usCbCriteriaCheck(e, preset).state, 'pass');
    const p = good('ZZTURN2', { net_profit_yoy_pct: null, net_income_swing: 'loss-to-profit' });
    assert.equal(passesUsConvictionFilter(p, { ...US_FILTER_DEFAULT, pat: 25 } as any), true);
  });
  test('a loss that narrowed is a real miss; a missing EPS growth is not checked', () => {
    assert.equal(usCbCriteriaCheck(good('ZZNARROW', { eps_yoy_pct: null, eps_swing: 'loss-narrowed' }), preset).state, 'fail');
    const u = usCbCriteriaCheck(good('ZZNOEPS', { eps_yoy_pct: null }), preset);
    assert.deepEqual([u.state, u.missing], ['unknown', ['EPS growth']]);
  });
  test('missing margin / market cap / drift → not checked', () => {
    for (const over of [{ opm_prev_pct: null }, { market_cap_musd: null }, { pead_score: null }]) {
      assert.equal(usCbCriteriaCheck(good('ZZMISS', over), preset).state, 'unknown', JSON.stringify(over));
    }
  });
});

describe('zzz828 — verdict keys and neutral labels', () => {
  test('display words map back to the engine keys; the preset keeps matching', () => {
    assert.deepEqual(normalizeUsVerdictKeys(['Top setup', 'good_setup', 'watch', 'HIGH RISK', 'nonsense']), ['STRONG BUY', 'BUY', 'WATCH', 'AVOID']);
    const saved = JSON.stringify({ ...usPresetFilters(), verdicts: ['Top setup', 'Good setup', 'Watch'] });
    const f = usCbSavedFilters(saved)!;
    assert.deepEqual(f.verdicts!.slice().sort(), ['BUY', 'STRONG BUY', 'WATCH']);
    assert.equal(isUsPresetActive(f), true);
  });
  test('no BUY / SELL words in the labels', () => {
    for (const k of Object.keys(US_VERDICT_WORDS)) {
      const w = usVerdictWord(k);
      assert.doesNotMatch(w, /\bBUY\b|\bSELL\b|STRONG BUY/i);
    }
    assert.deepEqual(['STRONG BUY', 'BUY', 'WATCH', 'AVOID'].map(usVerdictWord), ['Top setup', 'Good setup', 'Watch', 'High risk']);
  });
  test('scores as words', () => {
    assert.deepEqual([usScoreWord(85), usScoreWord(70), usScoreWord(55), usScoreWord(10), usScoreWord(null)], ['very strong', 'strong', 'fair', 'weak', 'not known']);
    assert.deepEqual([usPeadWord(75), usPeadWord(55), usPeadWord(20)], ['strong', 'moderate', 'weak']);
    assert.deepEqual([usRsWord(90), usRsWord(60), usRsWord(10)], ['leading', 'average', 'lagging']);
  });
});

describe('zzz828 — stale tiers: re-sync under the current engine, never silently removed', () => {
  const graded = (ticker: string, tier: string, over: Record<string, any> = {}) => ({ ...good(ticker), tier, ...over }) as any;
  test('same filing re-graded MIXED stays on the bench, labelled; figures refreshed', () => {
    const map = { ZZOLD: good('ZZOLD', { engine_version: '2026.01.01-a' }) };
    const r = syncUsConvictionMap(map, [graded('ZZOLD', 'MIXED', { sales_yoy_pct: 12 })]);
    assert.ok(r.map.ZZOLD, 'kept');
    assert.equal(r.map.ZZOLD.now_tier, 'MIXED');
    assert.equal(r.map.ZZOLD.tier, 'STRONG');
    assert.equal(r.map.ZZOLD.sales_yoy_pct, 12);
    assert.equal(r.map.ZZOLD.engine_version, US_ENGINE_VERSION);
    assert.equal(r.binned.length, 0);
    assert.deepEqual(r.nowMixed, ['ZZOLD']);
    assert.equal(usNowTierText(r.map.ZZOLD), 'now MIXED under current rules (was STRONG)');
  });
  test('grading STRONG again on the same filing clears the label', () => {
    const map = { ZZBACK: good('ZZBACK', { now_tier: 'MIXED' }) };
    const r = syncUsConvictionMap(map, [graded('ZZBACK', 'STRONG', { pead_score: 72 })]);
    assert.equal(r.map.ZZBACK.now_tier, null);
  });
  test('a NEWER filing that grades MIXED still demotes (recoverably, to the bin)', () => {
    const map = { ZZNEW: good('ZZNEW') };
    const r = syncUsConvictionMap(map, [graded('ZZNEW', 'MIXED', { filing_date: '2026-11-10', quarter: 'Q3' })]);
    assert.equal(r.map.ZZNEW, undefined);
    assert.equal(r.binned.length, 1);
  });
  test('every write is stamped with the engine version', () => {
    const r = syncUsConvictionMap({}, [graded('ZZSTAMP', 'BLOCKBUSTER')]);
    assert.equal(r.map.ZZSTAMP.engine_version, US_ENGINE_VERSION);
    assert.equal(usEngineStale({ ...r.map.ZZSTAMP, bench_key: 'ZZSTAMP' }), false);
  });
  test('the re-grade queue is bounded, newest first, live entries only, two tries per version', () => {
    const list: UsConvictionEntry[] = [];
    for (let i = 0; i < US_ENGINE_RESYNC_CAP + 30; i++) {
      const t = `ZZQ${String(i).padStart(3, '0')}`;
      list.push({ ...good(t, { engine_version: 'old', filing_date: `2026-0${1 + (i % 8)}-10` }), bench_key: t });
    }
    list.push({ ...good('ZZARC', { engine_version: 'old' }), bench_key: 'ZZARC@Q1-2026' });
    list.push({ ...good('ZZCUR'), bench_key: 'ZZCUR' });
    list.push({ ...good('ZZGAVEUP', { engine_version: 'old', filing_date: '2026-09-01', engine_check: { version: US_ENGINE_VERSION, attempts: US_ENGINE_RESYNC_TRIES, at: 'x' } }), bench_key: 'ZZGAVEUP' });
    const q = usEngineResyncQueue(list);
    assert.equal(q.length, US_ENGINE_RESYNC_CAP);
    assert.ok(!q.includes('ZZARC') && !q.includes('ZZCUR') && !q.includes('ZZGAVEUP'));
  });
  test('unanswered names get one attempt recorded; answered ones are re-graded', () => {
    const map = { ZZA1: good('ZZA1', { engine_version: 'old' }), ZZA2: good('ZZA2', { engine_version: 'old' }) };
    const r = applyUsEngineResync(map, ['ZZA1', 'ZZA2'], [graded('ZZA1', 'STRONG')]);
    assert.deepEqual(r.regraded, ['ZZA1']);
    assert.deepEqual(r.unanswered, ['ZZA2']);
    assert.equal(r.map.ZZA2.engine_check!.attempts, 1);
    const again = markUsEngineChecked(r.map, ['ZZA2']);
    assert.equal(again.ZZA2.engine_check!.attempts, 2);
  });
});

describe('zzz828 — why names are hidden', () => {
  test('per criterion counts with the figure against the threshold; not checked listed apart; archives fold', () => {
    const list = [
      good('ZZPASS'),
      { ...good('ZZPASS', { quarter: 'Q1' }), bench_key: 'ZZPASS@Q1-2026' } as any,
      good('ZZSLOW', { sales_yoy_pct: 5 }),
      good('ZZSLOW2', { sales_yoy_pct: 8, eps_yoy_pct: 10 }),
      good('ZZNOCAP', { market_cap_musd: null }),
    ];
    const r = usCbHiddenReport(list, preset);
    assert.equal(r.total, 4);
    assert.equal(r.shown, 2);
    assert.deepEqual(r.hidden.map((h) => h.ticker), ['ZZSLOW', 'ZZSLOW2']);
    const sales = r.byCriterion.find((c) => c.key === 'sales')!;
    assert.equal(sales.count, 2);
    assert.match(sales.names[0].text, /revenue growth 5% \(needs 20%\)/);
    assert.equal(r.byCriterion.find((c) => c.key === 'eps')!.count, 1);
    assert.deepEqual(r.notChecked.map((n) => [n.ticker, n.missing]), [['ZZNOCAP', ['market cap']]]);
  });
});

describe('zzz828 — US Portfolio Catalysts shows the whole Conviction Beats list', () => {
  const ORDER = ['ON_TRACK', 'NEUTRAL'];
  const rows = [
    { symbol: 'ZZHELD', origin: 'book', preset: { state: 'pass' } },
    { symbol: 'ZZBENCH', origin: 'bench', preset: { state: 'pass' } },
    { symbol: 'ZZUNK', origin: 'bench', preset: { state: 'unknown' } },
    { symbol: 'ZZFAIL', origin: 'bench', preset: { state: 'fail' } },
    { symbol: 'ZZOWN', origin: 'book', preset: null },
  ];
  test('the 🏆 view = held + not held names on the list, whatever the failing chip says', () => {
    const cbKeys = new Set(['ZZHELD', 'ZZBENCH', 'ZZUNK']);
    const v = usPcView(rows, { source: 'cb', showFailing: false, filter: null, order: ORDER, cbKeys });
    assert.deepEqual(v.inSource.map((r) => r.symbol).sort(), ['ZZBENCH', 'ZZHELD', 'ZZUNK']);
    // the other views are unchanged
    assert.equal(usPcView(rows, { source: 'bench', showFailing: false, filter: null, order: ORDER }).inSource.length, 2);
  });
  test('reconciliation names every difference with its reason (and says so when there is none)', () => {
    const ok = usCbReconcile(['ZZA', 'ZZB'], ['ZZB', 'ZZA'], () => 'x');
    assert.equal(ok.matches, true);
    assert.match(ok.line, /all 2 names match/);
    const bad = usCbReconcile(['ZZA', 'ZZB'], ['ZZA'], () => 'saved in your book on a non-US venue');
    assert.equal(bad.matches, false);
    assert.match(bad.line, /ZZB on Conviction Beats but not here \(saved in your book on a non-US venue\)/);
  });
  test('an empty selection exists for the "not available" path (the list never loads for ever)', () => {
    const e = emptyCbSelection();
    assert.deepEqual([e.listTotal, e.passing.length, e.failing.length], [0, 0, 0]);
  });
});

describe('zzz828 — display', () => {
  test('HTML entities in company names are decoded on write', () => {
    assert.equal(usBenchFields({ ticker: 'zzamp', company: 'ZZ Procter &amp;amp; Synthetic &#39;Co&#39;' }).company, "ZZ Procter & Synthetic 'Co'");
  });
  test('wiring: pages use the words, the checks and the new views', () => {
    const pc = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    assert.match(pc, /🏆 Conviction Beats \(/);
    assert.match(pc, /📗 also in My book/);
    assert.match(pc, /data-testid="us-cb-reconciliation"/);
    assert.match(pc, /decodeHTMLEntities/);
    const cb = read('app/(dashboard)/us-conviction-beats/page.tsx');
    assert.match(cb, /data-testid="us-cb-hidden-panel"/);
    assert.match(cb, /Why \{hiddenReport\.hidden\.length\} name/);
    assert.match(cb, /resyncUsBenchToEngine/);
    assert.match(cb, /now \{e\.now_tier\}|NOW \$\{e\.now_tier\} under current rules/);
    // verdicts reach the screen and the CSV only as words
    assert.doesNotMatch(cb, /\{v\.verdictLabel\}|\{v\}\s*\(\{countWith/);
    assert.doesNotMatch(cb, /'Verdict', 'Score'/);
    assert.match(cb, /usVerdictWord\(usVerdict\(e\)\.verdictLabel\)/);
    // counts on chips use the same pass / not-checked / fail check as the list
    assert.match(cb, /usCbCriteriaCheck\(e, f, newWindow\)\.state !== 'fail'/);
    // reads end
    assert.match(cb, /AbortSignal\.timeout\(90_000\)/);
    const hook = read('lib/us-thesis/use-us-book.ts');
    assert.match(hook, /US_CB_SELECTION_DEADLINE_MS/);
  });
});
