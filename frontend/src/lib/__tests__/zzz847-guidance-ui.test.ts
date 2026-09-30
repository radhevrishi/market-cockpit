// zzz847 — Guidance Upgrades UI wording: range classes, neutral markers, headline-only cards, Net profit, forbidden words.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  METRIC_LABEL, rangeClassLabel, changeMarker, isHeadlineOnly, hasRealRaise, hasTopEndCut, guidanceMarkerWord, decisionChipText, tickerText,
  metricFamilies, applyFilters, stageOf, stageNote, marketIncompleteNote, coverageCounts, HEADLINE_ONLY_BANNER, HEADLINE_ONLY_DECISION, FLOOR_ABOVE_OLD_CEILING,
  AWAITING_PRIMARY, CONSENSUS_ABSENT, TICKER_NOT_RESOLVED,
} from '../guidance-upgrades-format';

const pt = (lo: number, hi: number, metric = 'EPS') => ({ metric, period: 'FY26', low: lo, high: hi, midpoint: (lo + hi) / 2, isGrowthRate: false, currency: '$' });
const rng = (klass: string, extra: any = {}) => ({ klass, beforeLow: null, beforeMid: null, beforeHigh: null, afterLow: null, afterMid: null, afterHigh: null, widthBefore: null, widthAfter: null, lowChangePct: null, midChangePct: null, highChangePct: null, ...extra });
const ev = (klass: string, extra: any = {}): any => ({
  market: 'IN', ticker: 'ZZ', company: 'ZZ Ltd', primaryAvailable: true, verification: 'VERIFIED', decision: 'WATCHLIST', links: {}, flags: [],
  changes: [{ metric: 'EPS', before: pt(4.6, 4.9), after: pt(4.7, 4.85), direction: 'UP', percentageChange: 1.3, percentagePointChange: null }],
  v2: { stage: 'CALCULATED', ranges: [rng(klass, extra)], statedMetrics: [] }, ...extra.ev,
});
const headline = (): any => ({
  market: 'IN', ticker: '', company: 'No Ticker Ltd', primaryAvailable: true, verification: 'UNVERIFIED', decision: 'UNVERIFIED', links: {}, flags: [], changes: [],
  v2: { stage: 'PRIMARY_SOURCE_FOUND', ranges: [], statedDirection: 'RAISED', statedMetrics: ['Revenue', 'Net profit'] },
});

describe('range class wording', () => {
  test('plain words for every class', () => {
    assert.equal(rangeClassLabel({ klass: 'CLEAN_RAISE' }), 'Clean raise');
    assert.equal(rangeClassLabel({ klass: 'RANGE_SHIFT_UP' }), 'Range shifted up');
    assert.equal(rangeClassLabel({ klass: 'MIDPOINT_RAISE_RANGE_NARROWING' }), 'Midpoint up but range narrowed');
    assert.equal(rangeClassLabel({ klass: 'RANGE_WIDENING' }), 'Range widened');
    assert.equal(rangeClassLabel({ klass: 'REITERATION' }), 'Reiteration');
    assert.equal(rangeClassLabel({ klass: 'DOWNGRADE' }), 'Downgrade');
  });
  test('floorAboveOldCeiling wins over a plain raise label only', () => {
    assert.equal(rangeClassLabel({ klass: 'CLEAN_RAISE', floorAboveOldCeiling: true }), FLOOR_ABOVE_OLD_CEILING);
    assert.equal(FLOOR_ABOVE_OLD_CEILING, 'Floor above old ceiling');
    assert.equal(rangeClassLabel({ klass: 'RANGE_WIDENING', floorAboveOldCeiling: true }), 'Range widened');
  });
});

describe('neutral marker for narrowed ranges (Fuller EPS 4.60-4.90 to 4.70-4.85)', () => {
  test('narrowed is not an up arrow and is not a real raise', () => {
    const e = ev('MIDPOINT_RAISE_RANGE_NARROWING');
    assert.equal(changeMarker(e, 0).glyph, '↔'); assert.equal(changeMarker(e, 0).kind, 'NEUTRAL');
    assert.equal(hasRealRaise(e), false); assert.equal(hasTopEndCut(e), true);
    assert.ok(!guidanceMarkerWord(e).includes('↑'));
  });
  test('widened is neutral, clean raise and shift are up, downgrade is down', () => {
    assert.equal(changeMarker(ev('RANGE_WIDENING'), 0).kind, 'NEUTRAL');
    assert.equal(changeMarker(ev('CLEAN_RAISE'), 0).glyph, '↑');
    assert.equal(changeMarker(ev('RANGE_SHIFT_UP'), 0).kind, 'UP');
    assert.equal(changeMarker(ev('DOWNGRADE'), 0).glyph, '↓');
    assert.equal(guidanceMarkerWord(ev('CLEAN_RAISE')), 'Guidance ↑');
  });
  test('unknown before gives no marker', () => {
    const e = ev('UNKNOWN'); e.changes[0].before = null;
    assert.equal(changeMarker(e, 0).kind, 'NONE'); assert.equal(changeMarker(e, 0).glyph, '');
  });
});

describe('headline-only candidate', () => {
  test('wording, decision chip, stage', () => {
    const e = headline();
    assert.equal(isHeadlineOnly(e), true);
    assert.equal(HEADLINE_ONLY_BANNER, 'DETECTED — raise stated by source; old and new numbers not read yet');
    assert.equal(decisionChipText(e), 'UNVERIFIED — no decision yet'); assert.equal(HEADLINE_ONLY_DECISION, decisionChipText(e));
    assert.equal(stageOf(e), 'CANDIDATE'); assert.equal(stageNote(e), AWAITING_PRIMARY);
    assert.equal(guidanceMarkerWord(e), 'Guidance');
    assert.ok(!hasRealRaise(e));
  });
  test('a normal raise is not headline-only', () => assert.equal(isHeadlineOnly(ev('CLEAN_RAISE')), false));
  test('no ticker: company shown, ticker not resolved', () => {
    assert.equal(tickerText(headline()), 'ticker not resolved'); assert.equal(TICKER_NOT_RESOLVED, 'ticker not resolved');
    assert.equal(tickerText({ ticker: 'ABC' }), 'ABC');
  });
  test('consensus absent wording kept', () => assert.match(CONSENSUS_ABSENT, /DATA UNAVAILABLE — not needed to detect this upgrade/));
});

describe('Net profit', () => {
  test('label and filter', () => {
    assert.equal(METRIC_LABEL.NET_PROFIT, 'Net profit');
    const e = ev('CLEAN_RAISE'); e.changes[0].after.metric = 'NET_PROFIT';
    assert.ok(metricFamilies(e).includes('NET_PROFIT'));
    assert.equal(applyFilters([e], 'ALL', 'NET_PROFIT').length, 1);
    assert.equal(applyFilters([ev('CLEAN_RAISE')], 'ALL', 'NET_PROFIT').length, 0);
    assert.equal(applyFilters([headline()], 'ALL', 'NET_PROFIT').length, 1);
  });
  test('chip exists in the top bar', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'guidance-upgrades', 'GuTopBar.tsx'), 'utf8');
    assert.match(src, /\['NET_PROFIT', 'Net profit'\]/);
  });
});

describe('India coverage', () => {
  const s: any = { market: 'IN', complete: false, candidatesFound: 4, sources: [{ name: 'NSE filings', state: 'COMPLETE', scanned: 10, detail: '' }, { name: 'Scraped news', state: 'PARTIAL', scanned: 0, detail: '' }] };
  test('zero events with incomplete sources never reads as no upgrades', () => {
    const w = marketIncompleteNote('IN', 0, s)!;
    assert.match(w, /^India: scan incomplete/); assert.match(w, /Scraped news/); assert.match(w, /Not a confirmation of no upgrades\.$/);
    assert.equal(marketIncompleteNote('IN', 2, s), null);
  });
  test('per-source counts', () => {
    const c = coverageCounts({ candidates: { graded: 7, filings: 5, news: 9 } }, s);
    assert.deepEqual(c, ['9 news scanned', '5 filings scanned', '7 graded rows', '4 candidates found']);
  });
});

describe('forbidden wording', () => {
  const dir = join(__dirname, '..', '..', 'components', 'guidance-upgrades');
  const files = [...readdirSync(dir).map((f) => join(dir, f)), join(__dirname, '..', 'guidance-upgrades-format.ts')];
  test('no BUY/SELL beyond IMMEDIATE BUY, no 0-100 scores', () => {
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      const hits = (t.match(/\b(?:STRONG BUY|SELL|STRONG SELL|ACCUMULATE|REDUCE)\b/g) || []);
      assert.equal(hits.length, 0, `${f}: ${hits.join(',')}`);
      assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(t), f);
    }
  });
});
