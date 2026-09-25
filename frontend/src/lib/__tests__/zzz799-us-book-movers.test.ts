// zzz799 — US Portfolio Book → Analytics: "show top 10 here, not 5".
// Who moved the P&L and Today's movers list up to 10 each way; a Frankfurt
// euro line (K3R-style) is marked "(FWB, EUR)" and its $ figures use the
// live EUR/USD rate; the movers caption reads in full. India's P&L lists
// go to 10 too. Fixtures use MADE-UP tickers and amounts.
// Run: npx tsx --test src/lib/__tests__/zzz799-us-book-movers.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUsBookView, usBookAnalytics, MOVERS_TOP_N, nonUsTag, type FxDetail } from '../us-book/analytics';
import { parseUsBookImport } from '../us-book/import';
import { applyImport, emptyUsBook } from '../us-book/model';
import type { UsQuote } from '../us-book/valuation';

const NOW = Date.parse('2026-09-24T18:00:00Z');
const T = '2026-09-24T16:00:00Z';
const q = (symbol: string, price: number, prevClose: number, currency = 'USD'): UsQuote =>
  ({ symbol, price, currency, source: 'Yahoo Finance', marketTime: T, asOf: T, prevClose });

// 14 US names up, 13 down, plus one Frankfurt euro line.
const UP = Array.from({ length: 14 }, (_, i) => `UA${String.fromCharCode(65 + i)}`);
const DN = Array.from({ length: 13 }, (_, i) => `DA${String.fromCharCode(65 + i)}`);
const CSV = ['ticker,exchange,currency,quantity,avg_price',
  ...UP.map((t) => `${t},NASDAQ,USD,10,100`),
  ...DN.map((t) => `${t},NYSE,USD,10,100`),
  'KZZ,FWB2,EUR,100,10',
].join('\n');
const book = applyImport(emptyUsBook('t'), parseUsBookImport(CSV), 'replace', '2026-09-21T10:00:00Z');
const QUOTES: Record<string, UsQuote> = {};
UP.forEach((t, i) => { QUOTES[t] = q(t, 110 + i, 100 + i); });           // P&L > 0, day up
DN.forEach((t, i) => { QUOTES[t] = q(t, 90 - i, 95 - i); });              // P&L < 0, day down
QUOTES['KZZ.F'] = q('KZZ.F', 12, 10, 'EUR');                              // +20 % on the day, in euros
const FX: Record<string, FxDetail> = { EUR: { rate: 1.1, at: T, source: 'Yahoo Finance', symbol: 'EURUSD=X' } };

describe('zzz799 — top 10, not 5', () => {
  const v = buildUsBookView({ book, quotes: QUOTES, fx: FX, now: NOW });
  const a = usBookAnalytics(v);
  test('the constant is 10', () => assert.equal(MOVERS_TOP_N, 10));
  test('biggest gains / losses ($): 10 each when there are more', () => {
    assert.equal(a.contributors.length, 10);
    assert.equal(a.drags.length, 10);
    assert.ok(a.contributors.every((r) => (r.pnlUsd as number) > 0));
    assert.ok(a.drags.every((r) => (r.pnlUsd as number) < 0));
  });
  test('up most / down most: 10 each, sorted', () => {
    assert.equal(a.dayUp.length, 10);
    assert.equal(a.dayDown.length, 10);
    const up = a.dayUp.map((r) => r.dayChangePct as number);
    assert.deepEqual(up, [...up].sort((x, y) => y - x));
  });
  test('fewer than 10 → shows what there is', () => {
    const small = applyImport(emptyUsBook('t'), parseUsBookImport(['ticker,exchange,currency,quantity,avg_price', 'UAA,NASDAQ,USD,10,100', 'DAA,NYSE,USD,10,100'].join('\n')), 'replace', '2026-09-21T10:00:00Z');
    const a2 = usBookAnalytics(buildUsBookView({ book: small, quotes: QUOTES, fx: FX, now: NOW }));
    assert.equal(a2.dayUp.length, 1);
    assert.equal(a2.dayDown.length, 1);
  });
});

describe('zzz799 — a Frankfurt euro line among US movers', () => {
  const v = buildUsBookView({ book, quotes: QUOTES, fx: FX, now: NOW });
  const a = usBookAnalytics(v);
  const k = v.rows.find((r) => r.ticker === 'KZZ')!;
  test('kept in Today’s movers (it moved most)', () => assert.equal(a.dayUp[0].ticker, 'KZZ'));
  test('marked "(FWB, EUR)"; US lines carry no tag', () => {
    assert.equal(nonUsTag(k), 'FWB, EUR');
    assert.equal(nonUsTag(v.rows.find((r) => r.ticker === 'UAA')!), null);
  });
  test('its $ figures are the euro move × the live EUR/USD rate', () => {
    assert.equal(k.dayChangeUsd, 220, '(12 − 10) × 100 shares × 1.1');
    assert.equal(k.pnlUsd, 220, '(12 − 10) × 100 × 1.1 against the euro cost');
  });
  test('no FX rate → no $ figure (never an assumed rate)', () => {
    const v2 = buildUsBookView({ book, quotes: QUOTES, fx: {}, now: NOW });
    const k2 = v2.rows.find((r) => r.ticker === 'KZZ')!;
    assert.equal(k2.dayChangeUsd, null);
    assert.equal(k2.pnlUsd, null);
  });
});

describe('zzz799 — the page reads in full', () => {
  const tabs = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'us-portfolio-book', 'tabs.tsx'), 'utf8');
  test('the movers caption is the full sentence and is allowed to wrap', () => {
    assert.match(tabs, /only holdings with a previous close are ranked\./);
    assert.match(tabs, /capStyle[^\n]*whiteSpace: 'normal'/);
    assert.match(tabs, /data-testid="us-movers-caption"/);
  });
  test('the lists say "up to 10" and tag non-US lines', () => {
    assert.match(tabs, /Up to \{MOVERS_TOP_N\} each way/);
    assert.match(tabs, /nonUsTag\(r\)/);
  });
  test('India Portfolio analytics: top contributors / loser drag go to 10', () => {
    const india = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'portfolio', 'page.tsx'), 'utf8');
    assert.match(india, /const topContribs = attrSorted\.filter\(r => \(r\.pnl \|\| 0\) > 0\)\.slice\(0, 10\)/);
    assert.match(india, /const worstDrags = \[\.\.\.attrSorted\]\.reverse\(\)\.filter\(r => \(r\.pnl \|\| 0\) < 0\)\.slice\(0, 10\)/);
    assert.doesNotMatch(india, /Top 5 drove/);
  });
});
