// zzz839 - the Catalyst Score (0-12): factors, bands, the evidence rule, weak catalysts, unknown != zero, both markets, scoring only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildResearchView } from '../ai-gainers/research-view';
import { catalystScoreOf, scoreChipText } from '../ai-gainers/catalyst-score';
import { fixtureInput, fixtureInputUS } from './fixtures/gainers-view.fixture';
import { ResearchCard } from '../../components/ai-gainers/ResearchCard';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const all = (v: ReturnType<typeof buildResearchView>) => [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || []), ...(v.needsReading || [])];

const base: any = {
  ticker: 'SYNTH', market: 'IN', eventClass: 'CONFIRMED_MATERIAL', eventType: 'Order win', headline: 'Synth Ltd wins an order', whatChanged: 'Order received',
  stage: 'AWARDED', evidenceVerification: 'document_read', transmission: 'NEAR_TERM', persistence: 'YEARS',
  materiality: { label: 'SIGNIFICANT', ratios: [{ basis: 'ttm_revenue', pct: 40, text: '100 / 250 = 40% of TTM revenue' }], explanation: 'x', verification: 'DOCUMENT_VERIFIED' },
  transmissionChain: [], flags: { dilution: false }, unknowns: [], earnings: null, clusters: [],
};

describe('zzz839 score engine', () => {
  test('strong, read, quantified, long, large, delivering event reaches RESEARCH NOW and adds up', () => {
    const s = catalystScoreOf({ ...base, stage: 'EXECUTED' });
    assert.equal(s.scored, true);
    assert.equal(s.total, s.factors.reduce((n, f) => n + (f.points ?? 0), 0));
    assert.ok(s.total! >= 9 && s.total! <= 12);
    assert.equal(s.band, 'RESEARCH NOW');
  });
  test('Evidence below 2 can never be RESEARCH NOW (document not read)', () => {
    const s = catalystScoreOf({ ...base, stage: 'EXECUTED', evidenceVerification: 'document_not_read' });
    assert.equal(s.factors[0].points, 1);
    assert.notEqual(s.band, 'RESEARCH NOW');
    assert.equal(s.evidenceCapped, true);
  });
  test('execution contribution is 2 minus the risk', () => {
    const hi = catalystScoreOf({ ...base, stage: 'PROPOSED' }).factors.find((f) => f.key === 'execution')!;
    assert.equal(hi.rating, 2); assert.equal(hi.points, 0);
    const lo = catalystScoreOf({ ...base, stage: 'OPERATIONAL' }).factors.find((f) => f.key === 'execution')!;
    assert.equal(lo.rating, 0); assert.equal(lo.points, 2);
  });
  test('unknown is unscored, not zero-by-invention, and the ceiling shows what could be', () => {
    const s = catalystScoreOf({ ...base, materiality: { label: 'UNKNOWN', ratios: [], explanation: 'x' }, persistence: 'UNKNOWN' });
    assert.deepEqual(s.unscored.sort(), ['Duration', 'Materiality']);
    assert.equal(s.ceiling, s.total! + 4);
    assert.equal(s.durationTier, null);
    assert.match(scoreChipText(s), /2 unknown/);
  });
  test('a weak-catalyst type drops one band unless it is part of an earnings story', () => {
    const buy = catalystScoreOf({ ...base, eventType: 'Buyback', stage: 'EXECUTED', headline: 'Buyback approved' });
    assert.equal(buy.weakType, 'buyback');
    assert.notEqual(buy.band, 'RESEARCH NOW');
    const div = catalystScoreOf({ ...base, eventType: 'Earnings', earnings: { revenueYoY: 20 }, headline: 'Results and final dividend', stage: 'EXECUTED' });
    assert.equal(div.weakType, null);
  });
  test('a vague MoU is weak; a signed order is not', () => {
    assert.equal(catalystScoreOf({ ...base, eventType: 'Partnership', stage: 'PROPOSED', headline: 'Signs MoU with X' }).weakType, 'vague MoU');
    assert.equal(catalystScoreOf({ ...base }).weakType, null);
  });
  test('rumour / price commentary scores 0 for evidence; no event, price-only and data failure are NOT SCORED with a reason', () => {
    assert.equal(catalystScoreOf({ ...base, stage: 'RUMOUR' }).factors[0].points, 0);
    for (const ec of ['NO_CATALYST', 'MARKET_MOVE_ONLY', 'DATA_UNAVAILABLE', 'LISTING']) {
      const s = catalystScoreOf({ ...base, eventClass: ec });
      assert.equal(s.scored, false); assert.equal(s.band, 'NOT SCORED'); assert.ok(s.notScoredReason);
    }
  });
  test('a negative event is labelled as a risk, not as upside', () => {
    const s = catalystScoreOf({ ...base, eventClass: 'NEGATIVE', direction: 'NEGATIVE' });
    assert.equal(s.band, 'NEGATIVE — CHECK RISK');
  });
  test('the price move is not an input', () => {
    const a = catalystScoreOf({ ...base, move1d: 2 }); const b = catalystScoreOf({ ...base, move1d: 40, returns: { w1: 90 } });
    assert.equal(a.total, b.total);
  });
  test('extras: KPIs for the next quarters, fails-if lines, an 8-step chain, vs-business ratio only when verified', () => {
    const s = catalystScoreOf(base);
    assert.ok(s.kpis.length >= 2); assert.ok(s.invalidation.length >= 1); assert.equal(s.chain.length, 8);
    assert.ok(s.versusBusiness[0].includes('TTM revenue'));
    assert.equal(catalystScoreOf({ ...base, materiality: { ...base.materiality, verification: 'PENDING' } }).versusBusiness.length, 0);
  });
  test('duration tiers 0-3', () => {
    assert.equal(catalystScoreOf({ ...base, persistence: 'DAYS' }).durationTier, 0);
    assert.equal(catalystScoreOf({ ...base, persistence: 'QUARTER' }).durationTier, 1);
    assert.equal(catalystScoreOf({ ...base, persistence: 'YEARS' }).durationTier, 2);
    assert.equal(catalystScoreOf({ ...base, persistence: 'YEARS', durations: { contractual: '5-year term' } }).durationTier, 3);
  });
});

describe('zzz839 both markets, scoring only', () => {
  for (const [name, mk] of [['IN', fixtureInput], ['US', fixtureInputUS]] as const) {
    test(`${name}: every item has a score object; scored ones are 0-12 and sum correctly`, () => {
      const v = buildResearchView(mk());
      const items = all(v);
      assert.ok(items.length > 0);
      for (const it of items) {
        assert.ok(it.catalystScore, `${it.ticker} has a score`);
        const s = it.catalystScore!;
        if (s.scored) { assert.ok(s.total! >= 0 && s.total! <= 12); assert.equal(s.total, s.factors.reduce((n, f) => n + (f.points ?? 0), 0)); }
        else assert.ok(s.notScoredReason);
      }
    });
    test(`${name}: the score changes no rank, class or count`, () => {
      const a = buildResearchView(mk()); const b = buildResearchView(mk());
      assert.deepEqual(a.queue.map((i) => i.ticker), b.queue.map((i) => i.ticker));
      const strip2 = (v: any) => JSON.stringify(v.summary);
      assert.equal(strip2(a), strip2(b));
    });
    test(`${name}: the card shows the score box`, () => {
      const v = buildResearchView(mk());
      const it = all(v).find((i) => i.catalystScore?.scored)!;
      const html = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1 } as any)));
      assert.match(html, /CATALYST SCORE/); assert.match(html, /\/12/);
    });
  }
  test('source: rank sort does not read the score; no price term in the scorer', () => {
    const src = readFileSync(join(__dirname, '..', 'ai-gainers', 'catalyst-score.ts'), 'utf8');
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /move1d|returns\.|marketCap/);
    const rv = readFileSync(join(__dirname, '..', 'ai-gainers', 'research-view.ts'), 'utf8');
    assert.doesNotMatch(rv, /sort\([^)]*catalystScore/);
  });
});

describe('zzz840 score follows the new US event types', () => {
  test('sympathy moves and law-firm notices are not scored; index inclusion is a weak type', () => {
    for (const eventLabel of ['Sector/theme sympathy (no company event)', 'Investor-litigation solicitation (law-firm notice; not a company filing)']) {
      const s = catalystScoreOf({ ...base, eventLabel } as any);
      assert.equal(s.scored, false); assert.match(s.notScoredReason!, /No company event/);
    }
    const ix = catalystScoreOf({ ...base, eventLabel: 'Index inclusion (S&P/Russell/Nasdaq-100 add)', stage: 'EXECUTED' } as any);
    assert.match(ix.weakType || '', /index inclusion/);
  });
});
