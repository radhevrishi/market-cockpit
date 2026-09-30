// zzz844 — Guidance Upgrades V2 UI: labels, wording rules, count formatting. Pure string/format level, no DOM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  RANGE_CLASS_LABEL, DURABILITY_LEVEL_LABEL, STAGE_LABEL, STAGE_ORDER, RATING_LABEL, BASIS_LABEL, FLAG_LABEL, SCAN_STATE_LABEL,
  SCAN_INCOMPLETE_EMPTY, SCAN_INCOMPLETE, SCAN_COMPLETE, CONSENSUS_ABSENT, WHY_NOW_UNRESOLVED, AWAITING_PRIMARY, UNAVAILABLE,
  fmtMarketCounts, fmtConsensusAvail, stageOf, stageNote, splitToday, isToday, scanHeadline, scanIncompleteWords, fmtDaysCovered, fmtRangeLine,
} from '../guidance-upgrades-format';
import { crossLinks } from '../../components/guidance-upgrades/GuBits';

const SRC = join(__dirname, '..', '..');
const compDir = join(SRC, 'components', 'guidance-upgrades');
const files = [...readdirSync(compDir).map((f) => `components/guidance-upgrades/${f}`), 'app/(dashboard)/guidance-upgrades/page.tsx', 'lib/guidance-upgrades-format.ts'];

describe('labels', () => {
  test('range classes use plain words', () => {
    assert.equal(RANGE_CLASS_LABEL.CLEAN_RAISE, 'Clean raise');
    assert.equal(RANGE_CLASS_LABEL.MIDPOINT_RAISE_RANGE_NARROWING, 'Midpoint up but range narrowed');
    assert.equal(RANGE_CLASS_LABEL.RANGE_SHIFT_UP, 'Range shifted up');
    assert.equal(RANGE_CLASS_LABEL.RANGE_WIDENING, 'Range widened');
    assert.equal(RANGE_CLASS_LABEL.REITERATION, 'Reiteration');
    assert.equal(RANGE_CLASS_LABEL.DOWNGRADE, 'Downgrade');
    assert.equal(RANGE_CLASS_LABEL.UNKNOWN, UNAVAILABLE);
  });
  test('stage order and labels', () => {
    assert.deepEqual(STAGE_ORDER.map((s) => STAGE_LABEL[s]), ['CANDIDATE', 'PRIMARY SOURCE', 'PRIOR GUIDANCE', 'CALCULATED', 'VERIFIED', 'MATERIALITY', 'DECISION']);
  });
  test('ratings are text, durability and basis labelled, flag map complete', () => {
    assert.deepEqual(Object.values(RATING_LABEL), ['STRONG', 'OK', 'WEAK', 'UNKNOWN']);
    for (const v of Object.values(DURABILITY_LEVEL_LABEL)) assert.ok(v.length > 3 && !/\d{2,}/.test(v));
    assert.equal(Object.keys(DURABILITY_LEVEL_LABEL).length, 6);
    assert.equal(BASIS_LABEL.GAAP, 'GAAP');
    assert.deepEqual(Object.keys(FLAG_LABEL).sort(), ['GUIDANCE_PLUS_BOTTLENECK', 'GUIDANCE_PLUS_GAP', 'REPEATED_UPGRADER', 'SECOND_UPGRADE_IN_WINDOW', 'SMALL_MID_CAP_INFLECTION']);
    assert.equal(SCAN_STATE_LABEL.NOT_RUN, 'NOT RUN');
  });
  test('news-only event is CANDIDATE, awaiting primary source', () => {
    const e: any = { primaryAvailable: false, verification: 'UNVERIFIED', v2: { stage: 'DECISION' } };
    assert.equal(stageOf(e), 'CANDIDATE'); assert.equal(stageNote(e), AWAITING_PRIMARY);
    assert.equal(stageOf({ primaryAvailable: true, verification: 'VERIFIED' } as any), 'VERIFIED');
    assert.equal(stageOf({ primaryAvailable: true, verification: 'VERIFIED', v2: { stage: 'CALCULATED' } } as any), 'CALCULATED');
    assert.equal(stageNote({ primaryAvailable: true, verification: 'VERIFIED' } as any), null);
  });
});

describe('counts and consensus', () => {
  const bm: any = { IN: { detected: 3, verified: 2, material: 1, expectationPositive: 0 }, US: { detected: 2, verified: 2, material: 2, expectationPositive: 1 } };
  test('India N | USA N', () => {
    assert.equal(fmtMarketCounts(bm, 'detected'), 'India 3 | USA 2');
    assert.equal(fmtMarketCounts(bm, 'expectationPositive'), 'India 0 | USA 1');
    assert.equal(fmtMarketCounts(undefined, 'detected'), null);
  });
  test('consensus x/y, never required', () => {
    assert.equal(fmtConsensusAvail({ have: 3, of: 5 }), 'Consensus available 3/5');
    assert.equal(fmtConsensusAvail(undefined), null);
    assert.match(CONSENSUS_ABSENT, /not needed to detect this upgrade/);
    assert.ok(CONSENSUS_ABSENT.startsWith(UNAVAILABLE));
  });
  test('today split keeps order and puts today first', () => {
    const now = new Date('2026-09-30T10:00:00Z');
    const list: any[] = [{ announcement_date: '2026-09-29' }, { announcement_date: '2026-09-30' }, { announcement_date: '2026-09-28' }];
    const r = splitToday(list, now);
    assert.equal(r.today.length, 1); assert.equal(r.rest.length, 2); assert.equal(isToday(list[1], now), true);
  });
  test('range line and unavailable values', () => {
    const r: any = { beforeLow: 10, beforeMid: 11, beforeHigh: 12, afterLow: 11, afterMid: 12, afterHigh: 13 };
    assert.equal(fmtRangeLine(r), 'low 10 / mid 11 / high 12 → low 11 / mid 12 / high 13');
    assert.equal(fmtRangeLine({ beforeLow: null, beforeMid: null, beforeHigh: null, afterLow: 1, afterMid: 1, afterHigh: 1 } as any).startsWith(UNAVAILABLE), true);
  });
});

describe('scan wording', () => {
  const s = (o: any = {}): any => ({ market: 'IN', complete: false, daysCovered: 5, daysRequested: 7, sources: [{ name: 'Exchange filings', state: 'PARTIAL', scanned: 40, detail: 'x' }, { name: 'News', state: 'COMPLETE', scanned: 9, detail: '' }], ...o });
  test('headline', () => {
    assert.equal(scanHeadline(s()), SCAN_INCOMPLETE); assert.equal(scanHeadline(s({ complete: true })), SCAN_COMPLETE);
    assert.equal(fmtDaysCovered(s()), '5/7');
  });
  test('incomplete wording never reassures with "0 events"', () => {
    for (const t of [SCAN_INCOMPLETE_EMPTY, scanIncompleteWords(s()), scanIncompleteWords(s({ sources: [] }))]) assert.ok(!/\b0 events\b/i.test(t.replace('no events shown does NOT mean no upgrades', '')), t);
    assert.match(SCAN_INCOMPLETE_EMPTY, /^Scan incomplete — no events shown does NOT mean no upgrades/);
    assert.match(scanIncompleteWords(s()), /Exchange filings \(partial\)/);
    assert.ok(!/News \(/.test(scanIncompleteWords(s())));
  });
});

describe('house rules', () => {
  test('WHY NOW unresolved text', () => assert.equal(WHY_NOW_UNRESOLVED, 'Driver unresolved after primary-source + recent-event research'));
  test('BUY / SELL only as IMMEDIATE BUY; no /100; no dark fills', () => {
    for (const f of files) {
      const s = readFileSync(join(SRC, f), 'utf8');
      for (const m of s.matchAll(/\b(BUY|SELL)\b/g)) assert.equal(s.slice(m.index! - 10, m.index! + 3), 'IMMEDIATE BUY', `${f}: ${m[0]}`);
      assert.ok(!/\/\s?100\b/.test(s), f);
    }
  });
  test('cross-links only when data exists', () => {
    assert.deepEqual(crossLinks({ links: {}, sources: [] } as any), []);
    const l = crossLinks({ links: { newsIds: ['n1'], bottleneckThemes: ['t'], inBook: true }, sources: [{ type: 'Transcript' }], market: 'IN' } as any).map((x) => x.label);
    assert.deepEqual(l, ['News & Signals', 'Bottleneck', 'Concall / Event-Driven', 'Research', 'My Book']);
  });
});
