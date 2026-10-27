// zzz1192 — Conviction Analytics: themes are read from breadth, earnings, margins, quality, value and the tape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseBench, pegOf, scoreCompany, shortlist, median, type CaRow } from '../conviction-analytics';

const row = (o: Partial<CaRow>): CaRow => ({
  ticker: 'A', company: 'A Ltd', market: 'IN', themeId: 'defence', themeName: 'Defence', themeEmoji: '🛡', tracked: true, industry: 'Aerospace',
  tier: 'STRONG', engineScore: 70, salesYoY: 30, profitYoY: 45, epsYoY: 45, opm: 18, opmPrev: 14, pe: 30, roce: 22, de: 0.2, cashToProfit: 0.9,
  mcap: 3000, filingDate: '2026-10-20', sincePrint: 12, day1: 4, tape: 'BUY', mark: null, ...o,
});

test('median and PEG', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(pegOf({ pe: 30, profitYoY: 60, epsYoY: null, salesYoY: 20 }), 0.5);
  assert.equal(pegOf({ pe: -5, profitYoY: 60, epsYoY: null, salesYoY: 20 }), null);
});

test('a clean, cheap, confirmed name outscores a chased, levered, cash-poor one', () => {
  const good = scoreCompany(row({}));
  const bad = scoreCompany(row({ ticker: 'B', sincePrint: 140, de: 2.5, cashToProfit: 0.3, pe: 120, tape: 'AVOID', opmPrev: 22 }));
  assert.ok(good.score > 70, String(good.score));
  assert.ok(bad.score < 35, String(bad.score));
  assert.ok(bad.minus.some((m) => /chasing/.test(m)));
});

test('three confirming names make a leading theme; one name is a company story; crowded is flagged', () => {
  const rows: CaRow[] = [
    row({ ticker: 'A' }), row({ ticker: 'B', tier: 'BLOCKBUSTER' }), row({ ticker: 'C', salesYoY: 40 }),
    row({ ticker: 'S', themeId: 'solar', themeName: 'Solar', tape: null }),
    row({ ticker: 'X', themeId: 'ems', themeName: 'EMS', sincePrint: 90, pe: 95 }), row({ ticker: 'Y', themeId: 'ems', themeName: 'EMS', sincePrint: 70, pe: 90 }),
  ];
  const a = analyseBench(rows, '2026-10-27');
  const by = Object.fromEntries(a.themes.map((t) => [t.name, t]));
  assert.equal(by.Defence.stance, 'LEAD');
  assert.equal(by.Solar.stance, 'SINGLE');
  assert.equal(by.EMS.stance, 'CROWDED');
  assert.equal(a.themes[0].name, 'Defence');
  const sl = shortlist(a.themes);
  assert.equal(sl[0].theme.name, 'Defence');
  assert.ok(sl[0].picks.length >= 2);
  assert.ok(a.summary.risks.some((r) => /run more than 80%/.test(r)));
});

test('rejected names stay out of the shortlist', () => {
  const rows = [row({ ticker: 'A', mark: 'REJECTED' }), row({ ticker: 'B' }), row({ ticker: 'C' })];
  const sl = shortlist(analyseBench(rows, '2026-10-27').themes);
  assert.ok(!sl.flatMap((x) => x.picks).some((c) => c.ticker === 'A'));
});
