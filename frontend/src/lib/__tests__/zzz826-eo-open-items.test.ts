// ═══════════════════════════════════════════════════════════════════════════
// zzz826 — India Earnings Opportunities, open items. Every figure is
// SYNTHETIC. No rule reads a ticker.
//
//   1 liquidity at source: one day's turnover is never the average
//   2 same-year cash ratios above 8x are real (limit now ±50x)
//   3 stored rows with pre-fix cash are re-fetched by the prewarm re-check
//   4 UNCONFIRMED rows: the re-check RE-FETCHES (not re-reads) and regrades
//   5 unknown guidance is recorded as unknown; it blocks, never demotes
//   6 size / trading caps leave the tier; they are plain flags beside it
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gradeIndiaRow, indiaBlockbusterGate } from '../india-grade';
import { sameFyCash, CASH_RATIO_MAX, CASH_RULE_V } from '../india-cash';
import {
  liquidityView, realAdtv, cashTileView, needsCashRefetch, cashRefetchRows, refetchTickers,
  yearAgoUnverified, unconfirmedRows, holdUnconfirmedPayload, yoyFromDatedSeries, YOY_RULE_V,
} from '../india-eo-card-data';
import { regradeIndiaCard, regradeIndiaDayPayload, INDIA_REGRADABLE_FROM } from '../india-regrade';
import { GRADED_CACHE_VERSION, GRADED_CACHE_LEGACY } from '../graded-cache-key';

const SRC = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

function row(over: Record<string, any>): any {
  return {
    symbol: 'SYNTH', company: 'Synthetic Industries Ltd', filing_date: '2026-09-20', quarter: 'Q1 FY27',
    hub_quality: 'Great', market_cap_cr: 5000, ...over,
  };
}
const CASH_OK = { cash_fy: 'Mar 2026', cash_basis: 'FY26 full year', ocf_annual_cr: 440, pat_annual_cr: 400, ocf_to_pat_ratio: 1.1, cash_rule_v: CASH_RULE_V };
const CLEAN = {
  sales_yoy_pct: 40, sales_curr_cr: 1400, sales_prev_cr: 1000,
  pat_yoy_pct: 120, pat_curr_cr: 110, pat_prev_cr: 50,
  eps_yoy_pct: 120, eps_curr: 11, eps_prev: 5,
  opm_pct: 22, opm_prev_pct: 18, ...CASH_OK,
};
/** A quarter whose ONLY top-tier path is the one that needs guidance. */
const NEEDS_GUIDANCE = {
  sales_yoy_pct: 30, sales_curr_cr: 1300, sales_prev_cr: 1000,
  pat_yoy_pct: 50, pat_curr_cr: 150, pat_prev_cr: 100,
  eps_yoy_pct: 50, eps_curr: 15, eps_prev: 10,
  opm_pct: 22, opm_prev_pct: 20, ...CASH_OK,
};

describe('1 · liquidity at source: one day is not an average', () => {
  const enrich = read('app', 'api', 'v1', 'earnings', 'enrich', 'route.ts');
  test('the bhavcopy fallback stores turnover_1d_cr, never adtv_cr', () => {
    assert.match(enrich, /out\.turnover_1d_cr = \(px\.volume \* _p\) \/ 1e7;/);
    assert.ok(!/out\.adtv_cr = \(px\.volume/.test(enrich), 'one-day turnover still written as the average');
  });
  test('adtv_cr survives only with the days it covers; Yahoo gives a 20-session median', () => {
    assert.match(enrich, /const _tv20 = _tv\.slice\(0, 20\);/);
    assert.match(enrich, /adtv_cr, adtv_days, rvol, atr_pct/);
    assert.match(enrich, /if \(!\(typeof out\.adtv_days === 'number' && out\.adtv_days >= 10\)\) \{ out\.adtv_cr = null; out\.adtv_days = null; \}/);
  });
  test('the enrich cache key is bumped (v18) and the CFO cache with it (v7)', () => {
    assert.match(enrich, /enrich:v18:\$\{symbol\}/);
    assert.ok(!/enrich:v17:\$\{symbol\}/.test(enrich));
    assert.match(enrich, /cfo:v7:\$\{sym\}/);
  });
  test('both graded row builders carry adtv_days and turnover_1d_cr', () => {
    const g = read('app', 'api', 'v1', 'earnings', 'graded', 'route.ts');
    assert.equal((g.match(/adtv_days: e\.adtv_days \?\? null, turnover_1d_cr: e\.turnover_1d_cr \?\? null/g) || []).length, 2);
  });
  test('realAdtv: a stored adtv_cr without days is unknown (it may be one day)', () => {
    assert.deepEqual(realAdtv({ adtv_cr: 0.05 }), { cr: null, days: null });
    assert.deepEqual(realAdtv({ adtv_cr: 0.05, adtv_days: 5 }), { cr: null, days: null });
    assert.deepEqual(realAdtv({ adtv_cr: 0.05, adtv_days: 20 }), { cr: 0.05, days: 20 });
  });
  test('unknown liquidity: no "thin float", no "barely trades"; real thin average: both, as context', () => {
    const unknown = gradeIndiaRow(row({ ...CLEAN, market_cap_cr: 300, adtv_cr: 0.05, turnover_1d_cr: 0.05 }))!;
    assert.ok(!unknown.market_context.includes('thin float'));
    assert.equal(unknown.size_flags, null);
    assert.equal(unknown.adtv_cr, null);
    assert.equal(unknown.turnover_1d_cr, 0.05);
    const thin = gradeIndiaRow(row({ ...CLEAN, market_cap_cr: 300, adtv_cr: 0.05, adtv_days: 20 }))!;
    assert.ok(thin.market_context.includes('thin float'));
    assert.deepEqual(thin.size_flags, ['barely trades']);
    assert.equal(thin.adtv_days, 20);
    assert.equal(thin.tier, unknown.tier, 'liquidity must not move the tier');
    assert.ok(!thin.is_elite);
  });
  test('the chip: "avg (20d)" when real, "—" otherwise; one day named in the tooltip', () => {
    const real = liquidityView({ adtv_cr: 2.4, adtv_days: 20, market_cap_cr: 900 });
    assert.equal(real.cr, 2.4);
    assert.equal(real.label, 'avg (20d)');
    const oneDay = liquidityView({ adtv_cr: 40, turnover_1d_cr: 40, market_cap_cr: 900 });
    assert.equal(oneDay.cr, null);
    assert.equal(oneDay.label, null);
    assert.match(oneDay.title, /one day is not an average/i);
    const page = read('app', '(dashboard)', 'earnings-opportunities', 'page.tsx');
    assert.match(page, /💧 \{lv\.cr == null \? '—'/);
  });
});

describe('2 · real same-year cash ratios above 8x', () => {
  const t = (labels: string[], rows: Record<string, (number | null)[]>) => ({ labels, rows });
  test('a 12x same-year ratio is kept; beyond ±50x it is unknown; the 2%-of-sales guard stays', () => {
    const pl = t(['Mar 2025', 'Mar 2026', 'TTM'], { 'Sales +': [300, 400, 420], 'Net Profit +': [9, 10, 11] });
    assert.equal(sameFyCash(t(['Mar 2025', 'Mar 2026'], { 'Cash from Operating Activity +': [50, 120] }), pl).ocf_to_pat_ratio, 12);
    assert.equal(sameFyCash(t(['Mar 2025', 'Mar 2026'], { 'Cash from Operating Activity +': [50, 600] }), pl).ocf_to_pat_ratio, null);
    assert.equal(CASH_RATIO_MAX, 50);
    const tiny = t(['Mar 2025', 'Mar 2026', 'TTM'], { 'Sales +': [3000, 4000, 4200], 'Net Profit +': [9, 10, 11] });   // profit 0.25% of sales
    const r = sameFyCash(t(['Mar 2025', 'Mar 2026'], { 'Cash from Operating Activity +': [50, 120] }), tiny);
    assert.equal(r.ocf_to_pat_ratio, null);
    assert.equal(r.cash_fy, 'Mar 2026');   // the figures stay; only the ratio is withheld
  });
  test('the tile says "profit small vs cash" for a very high ratio', () => {
    const v = cashTileView({ ocf_to_pat_ratio: 12, cash_basis: 'FY26 full year' });
    assert.equal(v.text, '12.00x');
    assert.equal(v.note, 'profit small vs cash');
    assert.equal(v.color, 'good');
    assert.equal(cashTileView({ ocf_to_pat_ratio: 1.3 }).note, 'earnings are cash-backed');
  });
  test('the cash gate still passes a high ratio', () => {
    const r = indiaBlockbusterGate({
      salesY: 40, patY: 120, opmPct: 22, opmPrevPct: 18, salesCurCr: 1400, salesPrevCr: 1000,
      patCurCr: 110, patPrevCr: 50, epsPrev: 5, cfoToPat: 12, ocfAnnualCr: 4800, patAnnualCr: 400,
      isLender: false, caveatTags: [],
    });
    assert.equal(r.tier, 'BLOCKBUSTER');
    assert.ok(!r.problems.includes('cash'));
    const g = gradeIndiaRow(row({ ...CLEAN, ocf_annual_cr: 4800, pat_annual_cr: 400, ocf_to_pat_ratio: 12 }))!;
    assert.equal(g.ocf_to_pat_ratio, 12);
    assert.equal(g.tier, 'BLOCKBUSTER');
  });
});

describe('3 · stored rows with pre-fix cash are re-fetched, bounded', () => {
  const graded = gradeIndiaRow(row({ ...CLEAN }))!;
  test('a row from before the cash fix (no basis, no rule version) needs a re-fetch', () => {
    const old = { ...graded, cash_basis: null, cash_fy: null, cash_rule_v: null, grade_input: { ...graded.grade_input } };
    delete old.grade_input.cash_rule_v;
    assert.equal(needsCashRefetch(old), true);
  });
  test('a same-year pair hidden by the old ±8x limit needs a re-fetch', () => {
    const old = { ...graded, ocf_to_pat_ratio: null, cfo_to_pat_ratio: null, cash_rule_v: null,
      grade_input: { ...graded.grade_input, ocf_annual_cr: 4800, pat_annual_cr: 400, ocf_to_pat_ratio: null, cash_rule_v: 2 } };
    assert.equal(needsCashRefetch(old), true);
  });
  test('never for current-rule rows, lenders, or preview cards', () => {
    assert.equal(needsCashRefetch(graded), false);
    assert.equal(needsCashRefetch({ ...graded, cash_rule_v: null, cash_basis: null, grade_input: {}, cash_note: 'not meaningful for lenders' }), false);
    assert.equal(needsCashRefetch({ ticker: 'X', tier: 'MIXED' }), false);
    const noCashOnScreener = { ...graded, cash_basis: null, ocf_to_pat_ratio: null, cash_rule_v: CASH_RULE_V };
    assert.equal(needsCashRefetch(noCashOnScreener), false, 'a fresh fetch already ran — unknown stays unknown, no loop');
  });
  test('the prewarm re-checks such dates (last 60 days, same budget and lock) with a re-fetch', () => {
    const cron = read('app', 'api', 'v1', 'cron', 'prewarm-earnings', 'route.ts');
    assert.match(cron, /cashStale = cashRefetchRows\(j\);/);
    assert.match(cron, /unconfirmed > 0 \|\| noPrice > 0 \|\| cashStale > 0\) && i <= RECHECK_MAX_AGE_DAYS && rechecksUsed < recheckBudgetMax/);
    assert.match(cron, /graded\?date=\$\{date\}&force=1&refetch=1/);
    assert.match(cron, /const RECHECK_MAX_AGE_DAYS = 60;/);
    const day = { by_tier: { BLOCKBUSTER: [graded], STRONG: [{ ...graded, ticker: 'OLDC', cash_basis: null, cash_rule_v: null, grade_input: {} }], MIXED: [], AVOID: [] } };
    assert.equal(cashRefetchRows(day), 1);
  });
});

describe('4 · UNCONFIRMED rows: the re-check re-fetches and regrades (synthetic stored day)', () => {
  // The stored row: the Screener table had a gap, and the OLD positional
  // look-back compared Jun 2026 with Mar 2025 (not Jun 2025): +80% sales.
  const series = { quarters_sales: [100, 120, 150, 180], quarters_dates: ['Mar 2025', 'Jun 2025', 'Mar 2026', 'Jun 2026'] };
  const wrong = gradeIndiaRow(row({
    symbol: 'GAPPY', financials_source: 'screener-worker',
    sales_yoy_pct: 80, sales_curr_cr: 180, sales_prev_cr: 100,
    pat_curr_cr: 20, pat_prev_cr: null, eps_curr: 4, eps_prev: 2, eps_yoy_pct: 100,
    opm_pct: 20, opm_prev_pct: 15, ...CASH_OK,
    cash_rule_v: undefined, yoy_rule_v: undefined,
  }))!;
  const storedDay = { filing_date: '2026-08-11', by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] } as Record<string, any[]> };
  storedDay.by_tier[wrong.tier].push(wrong);

  test('the stored day is flagged, held, and its ticker is on the re-fetch list', () => {
    assert.equal(yearAgoUnverified(wrong), true);
    assert.equal(unconfirmedRows(storedDay), 1);
    const held = holdUnconfirmedPayload(storedDay);
    assert.ok(!held.by_tier.BLOCKBUSTER.length && !held.by_tier.STRONG.length);
    assert.deepEqual(refetchTickers(storedDay), ['GAPPY']);
  });
  test('an in-process regrade only RE-READS the stored figures — it cannot fix them', () => {
    const re = regradeIndiaDayPayload(storedDay, 'v25')!;
    const r = Object.values(re.by_tier).flat()[0] as any;
    assert.equal(r.sales_yoy_pct, 80);
    assert.equal(yearAgoUnverified(r), true, 'still unconfirmed after a regrade');
  });
  test('so the re-check fetches those tickers with the enrichment cache bypassed', () => {
    const g = read('app', 'api', 'v1', 'earnings', 'graded', 'route.ts');
    assert.match(g, /const recheck = force && searchParams\.get\('refetch'\) === '1';/);   // zzz1146: the prior day is read on every rebuild
    assert.match(g, /if \(recheck\) for \(const t of refetchTickers\(prior\)\) if \(symbols\.includes\(t\)\) refetchSet\.add\(t\);/);
    assert.match(g, /const r = await _enrichCall\(freshSyms\.slice\(i, i \+ REFETCH_CHUNK\), true\);/);
    assert.match(g, /\$\{nocache \? '&nocache=1' : ''\}/);
    const cron = read('app', 'api', 'v1', 'cron', 'prewarm-earnings', 'route.ts');
    assert.match(cron, /const g = await recheckGraded\(date\);/);
  });
  test('the fresh fetch matches the year-ago quarter BY DATE, and the regrade stands', () => {
    const ya = yoyFromDatedSeries(series.quarters_sales, series.quarters_dates)!;
    assert.deepEqual(ya, { curr: 180, prev: 120 });                   // Jun 2025, not Mar 2025
    const freshRow = row({
      symbol: 'GAPPY', financials_source: 'screener-worker',
      sales_curr_cr: 180, sales_prev_cr: ya.prev, sales_yoy_pct: 50,
      pat_curr_cr: 20, pat_prev_cr: null, eps_curr: 4, eps_prev: 3, eps_yoy_pct: 33.3,
      opm_pct: 20, opm_prev_pct: 15, ...CASH_OK, yoy_rule_v: YOY_RULE_V,
    });
    const fresh = gradeIndiaRow(freshRow)!;
    assert.equal(fresh.sales_yoy_pct, 50);
    assert.equal(fresh.yoy_rule_v, YOY_RULE_V);
    assert.equal(yearAgoUnverified(fresh), false, 'date-matched figures are not UNCONFIRMED');
    const newDay = { by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] } as Record<string, any[]> };
    newDay.by_tier[fresh.tier].push(fresh);
    assert.equal(unconfirmedRows(newDay), 0);
    assert.deepEqual(refetchTickers(newDay), []);
    // …and it stays confirmed through a later regrade (the rule version is in its stored input).
    assert.equal(yearAgoUnverified(regradeIndiaCard(fresh, 'v26')), false);
  });
  test('enrich stamps the year-ago and cash rule versions', () => {
    const enrich = read('app', 'api', 'v1', 'earnings', 'enrich', 'route.ts');
    assert.match(enrich, /out\.yoy_rule_v = YOY_RULE_V;/);
    assert.match(enrich, /out\.cash_rule_v = CASH_RULE_V;/);
  });
});

describe('5 · unknown guidance: recorded as unknown, blocks, never demotes', () => {
  test('status: unknown with no evidence; "not raised" only with evidence', () => {
    assert.equal(gradeIndiaRow(row(NEEDS_GUIDANCE))!.guidance_status, 'unknown');
    assert.equal(gradeIndiaRow(row({ ...NEEDS_GUIDANCE, guidance_raised: false }))!.guidance_status, 'not raised');
    assert.equal(gradeIndiaRow(row({ ...NEEDS_GUIDANCE, guidance_raised: true }))!.guidance_status, 'raised');
    assert.equal(gradeIndiaRow(row({ ...NEEDS_GUIDANCE, guidance_lowered: true }))!.guidance_status, 'cut');
    assert.equal(gradeIndiaRow(row({ ...NEEDS_GUIDANCE, announcement_text: 'Board meeting outcome' }))!.guidance_status, 'not raised');
  });
  test('a fresh grade: unknown guidance blocks only the path that needs it, and says so', () => {
    const unknown = gradeIndiaRow(row(NEEDS_GUIDANCE))!;
    const raised = gradeIndiaRow(row({ ...NEEDS_GUIDANCE, guidance_raised: true }))!;
    const notRaised = gradeIndiaRow(row({ ...NEEDS_GUIDANCE, guidance_raised: false }))!;
    assert.equal(raised.tier, 'BLOCKBUSTER');
    assert.equal(unknown.tier, 'STRONG');
    assert.equal(unknown.tier, notRaised.tier, 'unknown is never worse than a known "not raised"');
    assert.match(unknown.guidance_note, /could not confirm BLOCKBUSTER; it does not lower the grade/);
    assert.ok(!/not raised/i.test(unknown.narrative));
    assert.equal(notRaised.guidance_note, null);
  });
  test('unknown guidance never demotes a quarter whose numbers do not need it', () => {
    const g = gradeIndiaRow(row(CLEAN))!;
    assert.equal(g.guidance_status, 'unknown');
    assert.equal(g.tier, gradeIndiaRow(row({ ...CLEAN, guidance_raised: true }))!.tier);
    assert.equal(g.guidance_note, null);
  });
  test('a card-figure regrade keeps the tier its guidance evidence earned', () => {
    // A v23 card: output only, no grade_input, graded when guidance was known.
    const g = gradeIndiaRow(row({ ...NEEDS_GUIDANCE, guidance_raised: true }))!;
    const { grade_input: _gi, guidance_status: _gs, guidance_note: _gn, ...card } = g;
    void _gi; void _gs; void _gn;
    const re = regradeIndiaCard({ ...card, ticker: 'SYNTH' }, 'v23')!;
    assert.equal(re.regrade_basis, 'card');
    assert.equal(re.guidance_status, 'unknown');
    assert.equal(re.tier, 'BLOCKBUSTER');
    assert.match(re.guidance_note, /original grade had it/);
    // …and the next regrade (from the stored input) keeps it too.
    assert.equal(regradeIndiaCard(re, 'v26')!.tier, 'BLOCKBUSTER');
  });
  test('a card whose old tier may have come from a chart method is not kept on that basis', () => {
    const g = gradeIndiaRow(row({ ...NEEDS_GUIDANCE, guidance_raised: true }))!;
    const { grade_input: _gi, ...card } = g; void _gi;
    const re = regradeIndiaCard({ ...card, ticker: 'SYNTH', methodology_tags: ['trend template', 'sepa'] }, 'v23')!;
    assert.equal(re.tier, 'STRONG');
  });
});

describe('6 · size and trading caps leave the tier', () => {
  test('a very small company keeps its tier and carries a plain flag', () => {
    const big = gradeIndiaRow(row({ ...CLEAN }))!;
    const tiny = gradeIndiaRow(row({ ...CLEAN, market_cap_cr: 80 }))!;
    assert.equal(tiny.tier, big.tier);
    assert.deepEqual(tiny.size_flags, ['very small company']);
    assert.ok(!tiny.caveat_tags.includes('below investable size'));
    assert.ok(!tiny.market_context.includes('very small company'));
    assert.match(tiny.narrative, /Size context \(not part of the grade\): very small company\./);
    assert.equal(big.size_flags, null);
  });
  test('"barely trades" needs a small cap AND a real thin average', () => {
    assert.deepEqual(gradeIndiaRow(row({ ...CLEAN, market_cap_cr: 300, adtv_cr: 0.05, adtv_days: 20 }))!.size_flags, ['barely trades']);
    assert.equal(gradeIndiaRow(row({ ...CLEAN, market_cap_cr: 900, adtv_cr: 0.05, adtv_days: 20 }))!.size_flags, null);
    assert.ok(!gradeIndiaRow(row({ ...CLEAN, market_cap_cr: 300, adtv_cr: 0.05, adtv_days: 20 }))!.caveat_tags.includes('barely trades'));
  });
  test('the page shows the chips and explains them; the MIXED text no longer lists size', () => {
    const page = read('app', '(dashboard)', 'earnings-opportunities', 'page.tsx');
    assert.match(page, /'Very small company'/);
    assert.match(page, /'Barely trades'/);
    assert.match(page, /use the <em>Mkt Cap<\/em> filter/);
    assert.ok(!/a company too small to invest in/.test(page));
  });
  test('engine v26; v25 days regrade in-process from their stored input', () => {
    assert.equal(GRADED_CACHE_VERSION, 'v26');
    assert.equal(GRADED_CACHE_LEGACY[0], 'v25');
    assert.ok(INDIA_REGRADABLE_FROM.includes('v25'));
    const v25 = gradeIndiaRow(row({ ...CLEAN, market_cap_cr: 80 }))!;
    const stored = { ...v25, tier: 'MIXED', caveat_tags: [...v25.caveat_tags, 'below investable size'] };
    const re = regradeIndiaCard(stored, 'v25')!;
    assert.equal(re.tier, v25.tier);
    assert.ok(!re.caveat_tags.includes('below investable size'));
    assert.deepEqual(re.size_flags, ['very small company']);
  });
});
