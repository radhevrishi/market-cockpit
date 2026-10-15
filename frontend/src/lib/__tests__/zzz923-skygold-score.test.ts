// zzz923 — the "Next Sky Gold" score on the Guidance Upgrades focus list. Made-up tickers; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inFactsFromHtml, usFactsFromRow, emptyFacts, compounded, type SkyFacts } from '../gu-skygold-facts';
import { skyGoldScore, guidanceOfRow, bandOf, MUST_CAPS, type SkyGuidance } from '../gu-skygold-score';
import { buildFocusList } from '../gu-focus';

const G = (o: Partial<SkyGuidance> = {}): SkyGuidance => ({ growthPct: 40, growthTrust: 'verified', growthMetric: 'REVENUE', growthMetrics: ['REVENUE'], multiYear: false, raised: false, smallRaise: false, cutInWindow: false, ...o });
/** every must-have met with real figures */
const strongFacts = (o: Partial<SkyFacts> = {}): SkyFacts => ({
  ...emptyFacts('IN', 'ALPHAX', 'test'), period: 'Jun 2026', salesYoyQ: 35, patYoyQ: 50, salesCagr3y: 30, profitCagr3y: 40, salesGrowthFy: 32, opGrowthFy: 45,
  opmNow: 18, opmYearAgo: 16, roce: 28, cfoToPat: 0.95, cfoYear: 'Mar 2026', lossMaking: false, cfo: 120, fcf: 40, debtToEquity: 0.2, debtGrowthX: 1.1,
  shareCountChange2y: 0, promoterNow: 62, promoterYearAgo: 62, debtorDaysNow: 60, debtorDaysPrev: 62, otherIncomePctOfPbt: 5, salesBase: 900, pe: 35, mcap: 4000, ...o,
});

test('a company meeting every main check with real figures reaches the top band', () => {
  const s = skyGoldScore(G({ raised: true, growthMetrics: ['REVENUE', 'EBITDA'] }), strongFacts());
  assert.equal(s.mustMet, 7); assert.ok(s.score! >= 80, String(s.score)); assert.equal(s.band, 'STRONG'); assert.equal(s.capNote, null);
});

test('only supporting checks met: never the top band, whatever the supporting score', () => {
  // every main check fails or is half met, every supporting check passes
  const f = strongFacts({ salesYoyQ: 5, salesCagr3y: 4, salesGrowthFy: 6, patYoyQ: 8, opGrowthFy: 9, profitCagr3y: 5, opmNow: 10, opmYearAgo: 16, roce: 9, cfoToPat: 0.3, debtToEquity: 1.6,
    fcf: 50, backlogGrowth: 40, estimateChange: 10, pe: 5, salesBase: 300 });
  const s = skyGoldScore(G({ growthTrust: 'derived', raised: false, multiYear: true }), f);
  assert.equal(s.mustMet, 0);
  assert.ok(s.score! <= MUST_CAPS[0] && s.score! < 50, String(s.score)); assert.notEqual(s.band, 'STRONG'); assert.notEqual(s.band, 'GOOD');
});

test('each missed main check holds the score down: 5 of 7 can never be STRONG', () => {
  const s = skyGoldScore(G({ raised: true, growthMetrics: ['REVENUE', 'PAT'] }), strongFacts({ roce: 12, cfoToPat: 0.4 }));
  assert.equal(s.mustMet, 5); assert.ok(s.score! <= 79); assert.notEqual(s.band, 'STRONG'); assert.match(s.capNote!, /5 of 7 main checks met/);
});

test('a figure not known is never a pass; too few known gives no number', () => {
  const none = skyGoldScore(G(), null);
  assert.equal(none.score, null); assert.equal(none.band, null); assert.match(none.capNote!, /only 1 of 7/);
  assert.ok(none.checks.filter((c) => c.status === 'unknown').every((c) => /not known|no growth|not collected|no order/.test(c.detail)));
  // US: debt is not collected, so it is "not known" — 6 of 7 at most
  const us = skyGoldScore(G(), { ...strongFacts(), market: 'US', debtToEquity: null, debtGrowthX: null });
  assert.equal(us.checks.find((c) => c.id === 'debt')!.status, 'unknown'); assert.equal(us.mustMet, 6); assert.ok(us.score! <= MUST_CAPS[6]);
});

test('red flags take points off and 10+ points of flags caps at 79', () => {
  const clean = skyGoldScore(G({ raised: true, growthMetrics: ['REVENUE', 'PAT'] }), strongFacts());
  const flagged = skyGoldScore(G({ raised: true, growthMetrics: ['REVENUE', 'PAT'], cutInWindow: true }), strongFacts({ promoterNow: 50, promoterYearAgo: 60 }));
  assert.deepEqual(flagged.flags.map((f) => f.id).sort(), ['cut', 'promoter']);
  assert.ok(flagged.score! <= 79 && flagged.score! < clean.score!); assert.match(flagged.capNote!, /red flags/);
});

test('a plan far ahead of the current pace fails "reachable"; profit guidance is compared with profit growth', () => {
  const far = skyGoldScore(G({ growthPct: 150 }), strongFacts({ salesYoyQ: 20, salesCagr3y: 15, salesGrowthFy: 18 }));
  assert.equal(far.checks.find((c) => c.id === 'reachable')!.status, 'fail');
  const pat = skyGoldScore(G({ growthPct: 60, growthMetric: 'PAT' }), strongFacts({ salesYoyQ: 12, salesCagr3y: 10, salesGrowthFy: 11, patYoyQ: 55, profitCagr3y: 40, opGrowthFy: 30 }));
  assert.equal(pat.checks.find((c) => c.id === 'reachable')!.status, 'pass');
  const loss = skyGoldScore(G(), strongFacts({ lossMaking: true }));
  assert.equal(loss.checks.find((c) => c.id === 'cash')!.status, 'fail');
});

test('bands and caps', () => {
  assert.equal(bandOf(80), 'STRONG'); assert.equal(bandOf(79), 'GOOD'); assert.equal(bandOf(65), 'GOOD'); assert.equal(bandOf(64), 'MIXED'); assert.equal(bandOf(49), 'WEAK');
  assert.ok(MUST_CAPS[5] < 80 && MUST_CAPS[6] >= 80);
});

test('India facts from the screener.in company page (fixture)', () => {
  const html = readFileSync(join(__dirname, 'fixtures', 'screener-company-kmew.html'), 'utf8');
  const f = inFactsFromHtml('ZETAQ', html, 'consolidated', 'https://www.screener.in/company/ZETAQ/consolidated/')!;
  assert.equal(f.ticker, 'ZETAQ'); assert.equal(f.period, 'Jun 2026');
  assert.equal(f.salesCagr3y, 5); assert.equal(f.profitCagr3y, 19); assert.equal(compounded(html, 'Sales', '5 Years'), 54);
  assert.equal(f.salesBase, 225); assert.equal(f.salesGrowthFy, 51);          // Mar 2026 vs Mar 2025, never the TTM column
  assert.equal(f.debtToEquity, 0.41); assert.equal(f.debtGrowthX, 2.36);      // 222 / (12 + 533); 222 / 94
  assert.equal(f.cfo, 48); assert.equal(f.fcf, -111);
  assert.equal(f.debtorDaysNow, 93); assert.equal(f.debtorDaysPrev, 118);
  assert.equal(f.promoterNow, 49.99); assert.equal(f.otherIncomePctOfPbt, 16.2);
  assert.equal(f.opmNow, 61); assert.equal(f.opmYearAgo, 40); assert.equal(f.roce, 17);
  const s = skyGoldScore(G(), f);
  assert.equal(s.checks.find((c) => c.id === 'debt')!.status, 'partial', 'debt more than doubled in a year');
});

test('US facts from the SEC row; a tiny-profit cash ratio is not known', () => {
  const row = { source: 'sec-xbrl', fiscal_label: 'Q2 FY26', sales_yoy_pct: 42, net_profit_yoy_pct: 60, opm_pct: 12, opm_prev_pct: 10, roce_pct: 22, cfo_to_pat_ratio: 1.2,
    net_income_curr_musd: 20, cfo_curr_musd: 24, capex_curr_musd: 6, revenue_curr_musd: 150, rpo_growth_pct: 30 };
  const f = usFactsFromRow('OMEGAQ', row, [{ period: '+1y', current: 2.2, d90: 2.0 }])!;
  assert.equal(f.fcf, 18); assert.equal(f.salesBase, 600); assert.equal(f.backlogGrowth, 30); assert.equal(f.estimateChange, 10); assert.equal(f.debtToEquity, null);
  assert.equal(usFactsFromRow('OMEGAQ', { ...row, cfo_to_pat_note: 'profit small vs cash' })!.cfoToPat, null);
  assert.equal(usFactsFromRow('OMEGAQ', { source: 'none' }), null);
});

test('focus rows carry the guided metrics, cohort and a verified cut for the score', () => {
  const g = { threshold: 30, label: '', rule: '', trust: {} as any, counts: {} as any, cohorts: { ANNUAL: [], QUARTERLY: [], MULTI_YEAR_CAGR: [
    { id: 'a', entityKey: 'IN:BETAQ', company: 'Betaq Ltd', ticker: 'BETAQ', market: 'IN', cohort: 'MULTI_YEAR_CAGR', trust: 'verified', text: 'Revenue +35% CAGR', sourceName: 's', sourceDate: null, sourceUrl: null,
      headline: { metric: 'REVENUE', compareValue: 35, period: 'FY26-29' }, metrics: [{ metric: 'REVENUE' }, { metric: 'PAT' }] }] } } as any;
  const cut = { guidance_event_id: 'c', ticker: 'BETAQ', company: 'Betaq Ltd', market: 'IN', announcement_date: '2026-10-01', verification: 'VERIFIED', taxonomy: 'downgrade', changes: [] } as any;
  const [r] = buildFocusList(g, [cut], new Date('2026-10-05T00:00:00Z'), Infinity);
  assert.equal(r.ticker, 'BETAQ'); assert.equal(r.growthCohort, 'MULTI_YEAR_CAGR'); assert.deepEqual(r.growthMetrics, ['REVENUE', 'PAT']); assert.equal(r.cutDate, '2026-10-01');
  const gu = guidanceOfRow(r);
  assert.equal(gu.multiYear, true); assert.equal(gu.cutInWindow, true);
  assert.equal(skyGoldScore(gu, null).checks.find((c) => c.id === 'specific')!.status, 'pass');
  assert.equal(buildFocusList(null, [cut], new Date(), Infinity).length, 0, 'a cut alone never adds a row');
});

test('UI: score column in both focus tables, plain number and band word, no "/100", score kept out of lib/thesis', () => {
  const ui = readFileSync(join(__dirname, '..', '..', 'components', 'guidance-upgrades', 'GuFocusList.tsx'), 'utf8');
  const cell = readFileSync(join(__dirname, '..', '..', 'components', 'guidance-upgrades', 'GuSkyGold.tsx'), 'utf8');
  assert.equal((ui.match(/<ScoreHead /g) || []).length, 2); assert.equal((ui.match(/\{skyCell\(r\)\}/g) || []).length, 1); assert.equal((ui.match(/\{figuresCells\(r\)\}/g) || []).length, 2);   // zzz1047f
  assert.match(cell, /not enough data/); assert.ok(!/\/100/.test(ui + cell));
  assert.match(cell, /\/api\/v1\/guidance-upgrades\/skygold\?in=/, 'one batched call for the listed names');
  const thesisDir = join(__dirname, '..', 'thesis');
  for (const fl of readdirSync(thesisDir)) assert.ok(!/gu-skygold/.test(readFileSync(join(thesisDir, fl), 'utf8')), fl);
});
