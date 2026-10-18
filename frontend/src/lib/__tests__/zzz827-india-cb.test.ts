// zzz827 — India Conviction Beats: the whole list on Portfolio Catalysts,
// no false fails (same-year cash, ROCE / ROE, Q-TRENDS, pledge, PEAD, verdict
// keys), the "Why N names are hidden" report, stale tiers re-synced, words
// instead of scores / buy-sell labels, and "&amp;" decoded. Synthetic tickers.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cbCashView, passesConvictionFilter, cbCriteriaCheck, cbFiltersForOwner, FILTER_DEFAULT, mergeCbEntries,
  serverBenchToCbEntries, normalizeVerdictKey, cbVerdictLabel, isIndiaPresetActive, indiaPresetFilters,
  cbComputeQuality, cbFailReasons, cbCriterionResults, CB_VERDICT_KEYS, cbTurn,
} from '../conviction-filter-india';
import {
  qTrendsState, buildHiddenReport, hiddenReportLine, cbResyncPatch, tierNowLabel, needsCbResync, resyncSummary,
  reconcileCbLists, filtersMatchSaved, cbGrowthText, cbStrengthWord, cbQualityWord, cbPeadWord, cbQualityBitWord,
  cbCompany, cbExportWords, presetBarText,
} from '../india-cb-view';
import { selectIndiaCb, cbViewRows, cbViewTag, cbViewLine, CB_VIEW_ALSO_HELD } from '../thesis/pc-bench';
import { INDIA_PRESET } from '../quality-preset';
import { driftWord } from '../india-eo-card-data';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const readWatchlists = () => ['page.tsx', 'ConvictionBeatsPanel.tsx', 'ConvictionTable.tsx', 'HubFilterRail.tsx', 'EIEliteTab.tsx', 'components.tsx', 'useEnrichedConvictionCards.ts', 'helpers.ts', 'constants.ts', 'types.ts'].map((f) => read(`app/(dashboard)/watchlists/${f}`)).join('\n'); // zzz900 — page split into sibling modules
const preset = { ...cbFiltersForOwner(false), mktCapMin: 3000 };   // zzz1068: the size floor defaults to Any size now; these tests pick ₹3k Cr

/** A synthetic entry that meets the whole preset on real, same-year data. */
const good = (ticker: string, over: Record<string, any> = {}) => ({
  ticker, company: `${ticker} Synthetic Ltd`, tier: 'STRONG', composite_score: 80,
  sales_yoy_pct: 40, net_profit_yoy_pct: 50, eps_yoy_pct: 50, opm_pct: 20, opm_prev_pct: 15,
  cash_fy: 'Mar 2026', cash_basis: 'FY26 full year', ocf_annual_cr: 120, pat_annual_cr: 100,
  ocf_to_pat_ratio: 1.2, cfo_to_pat_ratio: 1.2,
  roce: 30, roe: 22, market_cap_cr: 5000, pledged_pct: 0, d1_pct: 5, gap_pct: 2, pe: 20, move_pct: 4,
  filing_date: '2026-08-10', sector: 'Capital Goods',
  ...over,
}) as any;

describe('zzz827 — cash is the same-year ratio, or not checked', () => {
  test('same fiscal year CFO ÷ PAT, labelled with its year', () => {
    const v = cbCashView(good('ZZCASH'));
    assert.deepEqual([v.state, v.ratio, v.basis], ['ok', 1.2, 'FY26 full year']);
    assert.match(v.text, /1\.20x profit \(FY26 full year\)/);
  });
  test('an old ratio (annual cash ÷ one quarter) with no year label is NOT used — not checked', () => {
    const old = good('ZZOLD', { cash_fy: null, cash_basis: null, ocf_annual_cr: null, pat_annual_cr: null, cfo_to_pat_ratio: 2.66, ocf_to_pat_ratio: null });
    const v = cbCashView(old);
    assert.equal(v.state, 'unknown');
    assert.equal(v.ratio, null);
    // …and the preset does not fail on it, nor pass on the inflated figure.
    assert.equal(passesConvictionFilter(good('ZZLOWOLD', { cash_fy: null, ocf_annual_cr: null, pat_annual_cr: null, cfo_to_pat_ratio: 0.2 }), preset), true);
  });
  test('a stored ratio that disagrees with its own two figures is not used', () => {
    assert.equal(cbCashView(good('ZZMIS', { cfo_to_pat_ratio: 2.66, ocf_to_pat_ratio: 2.66 })).state, 'unknown');
  });
  test('a real same-year miss fails with the figure, its year and the threshold', () => {
    const e = good('ZZWEAK', { ocf_annual_cr: 42, pat_annual_cr: 100, cfo_to_pat_ratio: 0.42, ocf_to_pat_ratio: 0.42 });
    assert.equal(passesConvictionFilter(e, preset), false);
    const c = cbCriteriaCheck(e, preset);
    assert.equal(c.state, 'fail');
    assert.match(c.failed.join(' '), /cash from operations 0\.42x profit, FY26 full year \(needs 0\.5x\)/);
  });
  test('lenders: not meaningful, skipped (never a fail)', () => {
    const bank = good('ZZFIN', { company: 'ZZ Small Finance Bank Ltd', sector: 'Banks', cfo_to_pat_ratio: -3, ocf_to_pat_ratio: -3, ocf_annual_cr: -300 });
    assert.equal(cbCashView(bank).state, 'na');
    assert.equal(cbCriterionResults(bank, preset).find((r) => r.key === 'cfoPatMin')?.state, 'pass');
  });
  test('the verdict reads the same-year ratio too (an inflated old ratio no longer lifts quality)', () => {
    const withOld = good('ZZQ', { cash_fy: null, ocf_annual_cr: null, pat_annual_cr: null, cfo_to_pat_ratio: 2.66 });
    assert.ok(!cbComputeQuality(withOld).bits.some((b) => /CFO\/PAT/.test(b)));
    assert.ok(cbComputeQuality(good('ZZQ2')).bits.some((b) => /CFO\/PAT 1\.20/.test(b)));
  });
});

describe('zzz827 — missing figures are not checked, never a fail', () => {
  test('ROCE / ROE missing: the verdict criterion is not checked when it is the only reason', () => {
    // Quality falls to a weak verdict only because ROCE and the margin pair are missing.
    const e = good('ZZNOROCE', { roce: null, roe: null, opm_pct: null, opm_prev_pct: null, cash_fy: null, ocf_annual_cr: null, pat_annual_cr: null, pe: null, eps_yoy_pct: 30, net_profit_yoy_pct: 90 });
    const c = cbCriteriaCheck(e, { ...FILTER_DEFAULT, verdicts: [...INDIA_PRESET.verdicts] });
    assert.equal(c.state, 'unknown');
    assert.ok(c.missing.some((m) => /ROCE/.test(m)));
  });
  test('pledge: unknown passes; a known pledge fails with its figure', () => {
    assert.equal(passesConvictionFilter(good('ZZNP', { pledged_pct: null }), preset), true);
    const c = cbCriteriaCheck(good('ZZPL', { pledged_pct: 4.5 }), preset);
    assert.equal(c.state, 'fail');
    assert.match(c.failed.join(' '), /promoter pledge 4\.5%/);
  });
  test('PEAD: missing growth figures → not checked; the fail text is words, never the number', () => {
    const u = cbCriteriaCheck(good('ZZNOG', { sales_yoy_pct: null }), preset);
    assert.equal(u.state, 'unknown');
    const lowDrift = good('ZZLD', { sales_yoy_pct: 21, eps_yoy_pct: 26, net_profit_yoy_pct: 26, move_pct: -9, d1_pct: -6, gap_pct: -3, tier: 'STRONG', filing_date: '2026-03-01' });
    const words = cbFailReasons(lowDrift, { ...FILTER_DEFAULT, pead: 40 }).join(' ');
    if (!passesConvictionFilter(lowDrift, { ...FILTER_DEFAULT, pead: 40 })) {
      assert.match(words, /post-results drift reading (weak|moderate|strong) \(needs PEAD 40 or more\)/);
    }
  });
  test('market cap missing → not checked; below the owner\'s setting → counted as excluded', () => {
    const r = buildHiddenReport([good('ZZA'), good('ZZNOCAP', { market_cap_cr: null }), good('ZZSMALL', { market_cap_cr: 900 }), good('ZZSMALL2', { market_cap_cr: 1200, sales_yoy_pct: 5 })], preset);
    assert.equal(r.total, 4);
    assert.equal(r.hidden, 2);
    assert.equal(r.mktCapExcluded, 2);
    assert.deepEqual(r.notChecked.map((n) => n.ticker), ['ZZNOCAP']);
    const s2 = r.names.find((n) => n.ticker === 'ZZSMALL2')!;
    assert.ok(s2.fails.some((f) => /Market cap \(your setting\): market cap ₹1200 Cr \(needs ₹3000 Cr\)/.test(f)));
    assert.ok(s2.fails.some((f) => /Sales growth: sales growth 5% \(needs 20%\)/.test(f)), 'a name can miss several');
    assert.deepEqual(r.byCriterion.find((c) => c.key === 'mktCapMin')?.count, 2);
    assert.deepEqual(r.byCriterion.find((c) => c.key === 'sales')?.count, 1);
    assert.match(hiddenReportLine(r), /^2 of 4 hidden\. By criterion \(a name can miss several\): Market cap \(your setting\) 2 · Sales growth 1/);
  });
});

describe('zzz827 — verdict keys vs labels (the gate never silently drops names)', () => {
  test('keys stay; labels are neutral; a label in the filter maps back to its key', () => {
    assert.deepEqual([...CB_VERDICT_KEYS], ['STRONG BUY', 'BUY', 'WATCH', 'AVOID', 'HIGH RISK']);
    assert.equal(cbVerdictLabel('STRONG BUY'), 'Top setup');
    assert.equal(cbVerdictLabel('BUY'), 'Good setup');
    assert.equal(cbVerdictLabel('WATCH'), 'Watch');
    assert.equal(cbVerdictLabel('HIGH RISK'), 'High risk');
    for (const k of CB_VERDICT_KEYS) assert.doesNotMatch(cbVerdictLabel(k), /\b(BUY|SELL)\b/i);
    assert.equal(normalizeVerdictKey('Top setup'), 'STRONG BUY');
    assert.equal(normalizeVerdictKey('strong buy'), 'STRONG BUY');
    assert.equal(normalizeVerdictKey('🚀 STRONG BUY'), 'STRONG BUY');
    const e = good('ZZV');
    const key = cbComputeQuality(e).verdictLabel;
    assert.ok(INDIA_PRESET.verdicts.includes(key));
    assert.equal(passesConvictionFilter(e, { ...FILTER_DEFAULT, verdicts: ['Top setup', 'Good setup', 'Watch'] }), true);
    assert.equal(isIndiaPresetActive({ ...FILTER_DEFAULT, ...indiaPresetFilters(), verdicts: ['Top setup', 'Good setup', 'Watch'] }), true);
  });
  test('the quality tips carry no score and no buy / sell words', () => {
    for (const e of [good('ZZT1'), good('ZZT2', { move_pct: -20 }), good('ZZT3', { roce: 5, pe: 300 })]) {
      const q = cbComputeQuality(e);
      assert.doesNotMatch(q.verdictTip, /\b(BUY|SELL)\b|\/100|\(\d+\)/);
    }
  });
});

describe('zzz827 — one list: fields merged, grade from the current rules', () => {
  const local = { ...good('ZZMRG', { tier: 'BLOCKBUSTER', composite_score: 91, cfo_to_pat_ratio: 2.66, cash_fy: null, ocf_annual_cr: null, pat_annual_cr: null }),
    quarters_opm: [10, 11, 12, 13], cb_enrich_v: 377, company: 'Knowledge ZZ &amp; Engineering Works' };
  const server = serverBenchToCbEntries([{ ...good('ZZMRG', { tier: 'STRONG', composite_score: 74, roce: null, roe: null, pledged_pct: null }), tier_cap_reason: 'Capped at STRONG: thin operating margin' }]);
  test('same filing: the server row supplies tier / figures; this browser keeps ROCE, trends, fill markers', () => {
    const [m] = mergeCbEntries([local], server) as any[];
    assert.equal(m.tier, 'STRONG');
    assert.equal(m.composite_score, 74);
    assert.equal(m.roce, 30);
    assert.deepEqual(m.quarters_opm, [10, 11, 12, 13]);
    assert.equal(m.cb_enrich_v, 377);
    assert.equal(cbCashView(m).state, 'ok', 'server same-year cash wins over the old ratio');
    assert.equal(m.company, 'ZZMRG Synthetic Ltd');
    assert.equal(qTrendsState(m, false), 'present');
    const [onlyLocal] = mergeCbEntries([local], []) as any[];
    assert.equal(onlyLocal.company, 'Knowledge ZZ & Engineering Works');
  });
  test('a newer server filing keeps only slow fields (ROCE, trends) — never the old grade or cash', () => {
    const newer = serverBenchToCbEntries([{ ...good('ZZMRG', { filing_date: '2026-09-20', tier: 'BLOCKBUSTER', roce: null, cash_fy: null, ocf_annual_cr: null, pat_annual_cr: null, cfo_to_pat_ratio: null }) }]);
    const [m] = mergeCbEntries([local], newer) as any[];
    assert.equal(m.filing_date, '2026-09-20');
    assert.equal(m.roce, 30);
    assert.deepEqual(m.quarters_opm, [10, 11, 12, 13]);
    assert.equal(m.cfo_to_pat_ratio, null);
  });
  test('"&amp;" is decoded on the list, in exports and on the company helper', () => {
    const srv = serverBenchToCbEntries([{ ...good('ZZIOL'), company: 'IOL ZZ Chemicals &amp; Pharmaceuticals' }]);
    assert.equal(srv[0].company, 'IOL ZZ Chemicals & Pharmaceuticals');
    assert.equal(cbCompany({ company: 'Gujarat ZZ Fertilizers &amp;amp; Chemicals' }), 'Gujarat ZZ Fertilizers & Chemicals');
  });
});

describe('zzz827 — Q-TRENDS never "loading" for ever', () => {
  test('loading only while a fill pass runs; otherwise "not available"', () => {
    const bare = good('ZZQT', { cb_enrich_v: null, cb_trend_attempts: 0 });
    assert.equal(qTrendsState(bare, true), 'loading');
    assert.equal(qTrendsState(bare, false), 'not-available');
    assert.equal(qTrendsState({ ...bare, _trends_status: 'no-table' }, false), 'no-table');
    assert.equal(qTrendsState({ ...bare, company: 'ZZ Housing Finance Ltd', sector: 'NBFC' }, true), 'financial');
    assert.equal(qTrendsState({ ...bare, cb_enrich_v: 377 }, true), 'not-available');
  });
  test('the card uses the rule and the fill flag clears', () => {
    const wl = readWatchlists();
    assert.match(wl, /qTrendsState\(e, __cbFillRunning\)/);
    assert.doesNotMatch(wl, /Q-TRENDS loading… \(auto-filling from Screener\)/);
    assert.match(wl, /finally \{ fillRunningRef\.current = false; __cbFillRunning = false; \}/);
  });
});

describe('zzz827 — stale tiers re-synced from the current grading', () => {
  test('BLOCKBUSTER → STRONG: tier and figures replaced', () => {
    const e = good('ZZWEL', { tier: 'BLOCKBUSTER', composite_score: 89, sales_yoy_pct: 2810 });
    const p = cbResyncPatch(e, { ticker: 'ZZWEL', tier: 'STRONG', filing_date: '2026-08-10', composite_score: 72, sales_yoy_pct: 30, cash_fy: 'Mar 2026', cfo_to_pat_ratio: null, tier_cap_reason: 'Capped at STRONG: thin operating margin' })!;
    assert.equal(p.change, 'tier');
    assert.equal(p.patch.tier, 'STRONG');
    assert.equal(p.patch.sales_yoy_pct, 30);
    assert.equal(p.patch.cfo_to_pat_ratio, null, 'an old ratio is cleared, not kept');
    assert.equal(p.patch._tier_now, null);
  });
  test('now MIXED: kept, labelled, never deleted', () => {
    const e = good('ZZMIX', { tier: 'STRONG' });
    const p = cbResyncPatch(e, { ticker: 'ZZMIX', tier: 'MIXED', filing_date: '2026-08-10' })!;
    assert.equal(p.change, 'mixed');
    assert.equal(p.patch._tier_now, 'MIXED');
    assert.equal(p.patch.tier, undefined, 'the stored tier stays; the entry stays on the bench');
    assert.equal(tierNowLabel({ ...e, ...p.patch }), 'now MIXED under current rules');
  });
  test('another filing date is not this entry\'s grade; unchanged rows produce no change', () => {
    assert.equal(cbResyncPatch(good('ZZD'), { ticker: 'ZZD', tier: 'MIXED', filing_date: '2026-05-01' }), null);
    const same = good('ZZS');
    assert.equal(cbResyncPatch(same, { ticker: 'ZZS', tier: 'STRONG', filing_date: '2026-08-10' })!.change, 'none');
  });
  test('runs automatically when the stored engine version is older (bounded), never deletes', () => {
    assert.equal(needsCbResync(null, 'v26'), true);
    assert.equal(needsCbResync('v25', 'v26'), true);
    assert.equal(needsCbResync('v26', 'v26'), false);
    assert.match(resyncSummary([{ ticker: 'A', patch: {}, change: 'tier', from: 'BLOCKBUSTER', to: 'STRONG' }, { ticker: 'B', patch: {}, change: 'mixed', from: 'STRONG', to: 'MIXED' }], 'v26', 3, 5),
      /current grading \(v26\) \(3 of 5 filing dates read — the rest next visit\): 1 changed tier, 1 now below STRONG \(kept, labelled\)/);
    const wl = readWatchlists();
    assert.match(wl, /needsCbResync\(stored, GRADED_CACHE_VERSION\)/);
    assert.match(wl, /CB_RESYNC_MAX_DATES/);
    assert.match(wl, /replaceConvictionFields\(patches/);
  });
  test('growth is shown the EO way', () => {
    assert.equal(cbGrowthText(2810), '>500% (low base)');
    assert.equal(cbGrowthText(42.4), '+42%');
    assert.equal(cbGrowthText(-8), '-8%');
    assert.equal(cbGrowthText(null), '—');
  });
});

describe('zzz827 — Portfolio Catalysts shows the whole Conviction Beats list', () => {
  // 84 names pass: 15 held + 69 not held (synthetic).
  const list = Array.from({ length: 100 }, (_, i) => good(`ZZ${String(i).padStart(3, '0')}`, i >= 84 ? { sales_yoy_pct: 3 } : {}));
  const held = Array.from({ length: 15 }, (_, i) => `ZZ${String(i).padStart(3, '0')}`).concat(['ZZHELDONLY']);
  const sel = selectIndiaCb({ held, list, criteriaOff: false, check: (e) => cbCriteriaCheck(e as any, preset) });
  test('Conviction Beats view = every passing name, held ones included and tagged', () => {
    assert.equal(sel.passing.length, 84);
    assert.equal(sel.bench.length, 69);
    assert.equal(sel.heldPassing.length, 15);
    const rows = [
      ...held.map((s) => ({ symbol: s, origin: 'book' })),
      ...sel.bench.map((s) => ({ symbol: s, origin: 'bench' })),
      ...sel.benchFailing.map((s) => ({ symbol: s, origin: 'bench' })),
    ];
    const view = cbViewRows(rows, sel.passing);
    assert.equal(view.length, 84);
    assert.equal(view.filter((r) => cbViewTag(r.origin) === CB_VIEW_ALSO_HELD).length, 15);
    assert.equal(cbViewLine(view), 'Conviction Beats 84 = 15 you hold (📗 also in My book) + 69 on the bench');
    assert.equal(cbViewTag('bench'), null);
  });
  test('reconciliation: none when the lists match; each difference named with its reason', () => {
    const tab = { tickers: sel.passing, savedCriteria: true, at: '2026-09-28T10:00:00Z' };
    const ok = reconcileCbLists(tab, sel.passing, () => null);
    assert.deepEqual([ok.onlyTab.length, ok.onlyPc.length], [0, 0]);
    assert.match(ok.line, /^Matches the Conviction Beats tab name for name: 84 names/);
    const off = reconcileCbLists({ ...tab, tickers: [...sel.passing, 'ZZ090'] }, sel.passing.slice(1), (t) => (t === 'ZZ090' ? { state: 'fail', text: 'misses your Conviction Beats criteria — sales growth 3% (needs 20%)' } : null));
    assert.deepEqual(off.onlyTab.map((x) => x.ticker).sort(), ['ZZ000', 'ZZ090']);
    assert.match(off.onlyTab.find((x) => x.ticker === 'ZZ090')!.reason, /misses your saved criteria here — .*sales growth 3%/);
    assert.match(off.line, /⚠ Differs from the Conviction Beats tab/);
    const chips = reconcileCbLists({ ...tab, savedCriteria: false, tickers: ['ZZ001'] }, ['ZZ002'], () => null);
    assert.match(chips.onlyTab[0].reason, /your own chips, not your saved criteria/);
    assert.match(reconcileCbLists(null, [], () => null).line, /open that tab once in this browser/);
  });
  test('the tab saves what it lists; "saved criteria" = the preset (or all off)', () => {
    assert.equal(filtersMatchSaved({ ...FILTER_DEFAULT, ...indiaPresetFilters() }, false), true);
    assert.equal(filtersMatchSaved({ ...FILTER_DEFAULT, ...indiaPresetFilters(), d1Bucket: 2 }, false), false);
    assert.equal(filtersMatchSaved({ ...FILTER_DEFAULT }, true), true);
    const wl = readWatchlists();
    assert.match(wl, /writeCbTabSnapshot\(\{ tickers, savedCriteria: filtersMatchSaved\(filters, readCbPresetOptOut\(\)\)/);
    const pc = read('app/(dashboard)/portfolio-catalysts/page.tsx');
    assert.match(pc, /\['cb', `\\uD83C\\uDFC6 Conviction Beats \$\{cbRows\.length\}`/);
    assert.match(pc, /\['bench', `Bench \$\{pcc \? pcc\.byId\.bench\.n : uc\.bench\}`/);
    assert.match(pc, /data-testid="cb-reconciliation"/);
    assert.match(pc, /data-testid="cb-also-held"/);
  });
});

describe('zzz827 — words, never a 0–100 number; no buy / sell wording', () => {
  test('word helpers', () => {
    assert.equal(cbStrengthWord(89), 'very high');
    assert.equal(cbStrengthWord(72), 'high');
    assert.equal(cbQualityWord(80), 'high');
    assert.equal(cbQualityWord(50), 'fair');
    // One banding with EO (driftBand): the same stock reads the same word on both pages.
    for (const v of [20, 47, 55, 75]) assert.equal(`${cbPeadWord(v)} drift signal`, driftWord(v));
    assert.equal(cbPeadWord(47), 'weak');
    assert.equal(cbPeadWord(55), 'moderate');
    assert.match(presetBarText(), /PEAD 40 or more/);
    assert.equal(cbQualityBitWord('CFO/PAT 1.20→30'), 'CFO/PAT 1.20');
    assert.equal(cbQualityBitWord('ROCE/ROE cap→55'), 'ROCE/ROE caps quality');
    assert.doesNotMatch(presetBarText(), /PEAD≥|STRONG BUY|\bBUY\b|WATCH/);
    const w = cbExportWords(good('ZZX'), 'STRONG BUY', 47);
    assert.deepEqual([w.strength, w.drift, w.setup, w.cash], ['very high', 'weak', 'Top setup', '1.20x (FY26 full year)']);
  });
  test('the Conviction Beats tab shows no score numbers and no buy / sell labels', () => {
    const wl = readWatchlists();
    // The two numbers next to the tier, the QUALITY number, the table / Excel score columns.
    assert.doesNotMatch(wl, /\{entry\.composite_score\}<\/span>/);
    assert.doesNotMatch(wl, /\{pead\.score\}<\/span>/);
    assert.doesNotMatch(wl, /\{qScore\}<\/strong>/);
    assert.doesNotMatch(wl, /\{e\.composite_score\}<\/td>/);
    assert.doesNotMatch(wl, /'Composite','PEAD'/);
    assert.doesNotMatch(wl, /Verdict: STRONG BUY·BUY·WATCH/);
    assert.doesNotMatch(wl, /\{verdictIcon\} \{verdictLabel\}/);
    assert.match(wl, /cbVerdictLabel\(verdictLabel\)/);
    assert.match(wl, /\{cbVerdictLabel\(o\.label\)/);
    assert.doesNotMatch(wl, /lbl: '≥60' \}, \{ v: 65/);
    assert.doesNotMatch(wl, /T-\$\{tscore\}/);
    // The verdict tips no longer carry buy / sell words.
    const src = read('lib/conviction-filter-india.ts');
    assert.doesNotMatch(src, /icon: '🚀'|icon: '📈'|icon: '👁'|icon: '⚠️'/);
  });
});

describe('zzz827 — a turn from loss to profit meets the growth gate; a narrower loss does not', () => {
  const f = { ...FILTER_DEFAULT, eps: 25, pat: 20 };
  test('EPS and PAT: loss a year ago, profit now → passes (no % exists)', () => {
    const e = good('ZZTURN', { eps_prev: -2.1, eps_curr: 3.4, eps_yoy_pct: null, pat_prev_cr: -12, pat_curr_cr: 18, net_profit_yoy_pct: null });
    assert.equal(cbTurn(3.4, -2.1), 'turned');
    assert.equal(passesConvictionFilter(e, f), true);
    assert.equal(cbCriteriaCheck(e, f).state, 'pass');
    // even when the feed printed a meaningless negative %
    assert.equal(passesConvictionFilter(good('ZZTURN2', { eps_prev: -1, eps_curr: 1, eps_yoy_pct: -200 }), { ...FILTER_DEFAULT, eps: 25 }), true);
  });
  test('a loss that only narrowed fails, whatever % the feed computed', () => {
    const e = good('ZZNARROW', { eps_prev: -10, eps_curr: -4, eps_yoy_pct: 60, pat_prev_cr: -50, pat_curr_cr: -20, net_profit_yoy_pct: 60 });
    assert.equal(cbTurn(-4, -10), 'stillLoss');
    assert.equal(passesConvictionFilter(e, f), false);
    const c = cbCriteriaCheck(e, f);
    assert.equal(c.state, 'fail');
    assert.match(c.failed.join(' '), /EPS still a loss \(-4 vs -10 a year ago — a narrower loss is not growth\)/);
    assert.match(c.failed.join(' '), /profit still a loss/);
  });
  test('missing figures → not checked, never a fail', () => {
    const e = good('ZZNOEPS', { eps_yoy_pct: null, eps_curr: null, eps_prev: null, net_profit_yoy_pct: null, pat_curr_cr: null, pat_prev_cr: null });
    const c = cbCriteriaCheck(e, f);
    assert.equal(c.state, 'unknown');
    assert.ok(c.missing.includes('EPS growth') && c.missing.includes('profit growth'));
  });
  test('ordinary growth is unchanged', () => {
    assert.equal(passesConvictionFilter(good('ZZG', { eps_prev: 2, eps_curr: 3 }), f), true);
    assert.equal(passesConvictionFilter(good('ZZG2', { eps_yoy_pct: 10, eps_prev: 2, eps_curr: 2.2 }), f), false);
  });
});
