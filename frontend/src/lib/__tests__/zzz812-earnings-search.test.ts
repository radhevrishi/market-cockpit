// zzz812 — Earnings Opportunities search (India + US).
// Run: npx tsx --test src/lib/__tests__/zzz812-earnings-search.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeTicker, parseQuery, scoreRow, rankMatches, resolveSearch,
  hiddenNote, hiddenCountNote, notFoundMessage, historyNote,
  readSearchParam, withSearchParam, SCORE_TICKER_EXACT,
} from '../earnings-search';

type Row = { ticker: string; company: string; filing_date: string; tier: string; market_cap_cr?: number; bse_code?: string };
const row = (ticker: string, company: string, filing_date = '2026-08-14', tier = 'STRONG', extra: Partial<Row> = {}): Row =>
  ({ ticker, company, filing_date, tier, ...extra });

// A synthetic India window. FCL is the target; the others are near-misses.
const WINDOW: Row[] = [
  row('FCLTD', 'Fcl Trading Ltd', '2026-08-14', 'MIXED'),
  row('IFCL', 'Indo Fabric Chemicals Ltd', '2026-08-14', 'STRONG'),
  row('FCL', 'Fineotex Chemical Ltd', '2026-08-14', 'MIXED', { market_cap_cr: 3900 }),
  row('FINEORG', 'Fine Organic Industries Ltd', '2026-08-14', 'STRONG'),
  row('ASIANPAINT', 'Asian Paints Ltd', '2026-08-14', 'AVOID'),
];

describe('zzz812 ticker normalisation', () => {
  test('case, whitespace, exchange prefixes and suffixes all collapse to one form', () => {
    for (const s of ['FCL', 'fcl', '  Fcl ', 'NSE:FCL', 'nse:fcl', 'NSE: FCL', 'FCL.NS', 'fcl.bo', 'FCL-EQ', 'BSE:FCL.BO']) {
      assert.equal(normalizeTicker(s), 'FCL', s);
    }
    assert.equal(normalizeTicker('NASDAQ:nvda'), 'NVDA');
    assert.equal(normalizeTicker('BRK.B'), 'BRK.B');      // a real class suffix survives
    assert.equal(normalizeTicker('M&M'), 'M&M');
    assert.equal(normalizeTicker('BAJAJ-AUTO'), 'BAJAJ-AUTO');
    assert.equal(normalizeTicker('541557'), '541557');    // BSE code kept as-is
    assert.equal(normalizeTicker(''), '');
    assert.equal(normalizeTicker(null), '');
  });

  test('a row stored with a suffix still matches the bare ticker exactly', () => {
    const pq = parseQuery('fcl')!;
    assert.equal(scoreRow(pq, row('NSE:FCL', 'Fineotex Chemical Ltd')), SCORE_TICKER_EXACT);
    assert.equal(scoreRow(pq, row('FCL.NS', 'Fineotex Chemical Ltd')), SCORE_TICKER_EXACT);
  });

  test('a BSE scrip code matches when the row carries it', () => {
    const pq = parseQuery('533333')!;
    assert.equal(scoreRow(pq, row('FCL', 'Fineotex Chemical Ltd', '2026-08-14', 'MIXED', { bse_code: '533333' })), SCORE_TICKER_EXACT);
  });
});

describe('zzz812 ranking', () => {
  test('"FCL": exact ticker first, prefix next, a mid-ticker substring never', () => {
    const hits = rankMatches(WINDOW, 'FCL');
    assert.deepEqual(hits.map((h) => h.row.ticker), ['FCL', 'FCLTD']);
    assert.ok(!hits.some((h) => h.row.ticker === 'IFCL'), 'IFCL merely contains FCL');
  });

  test('case-insensitive and whitespace-tolerant', () => {
    for (const q of ['fcl', 'Fcl', '  FCL  ', 'nse:fcl', 'FCL.NS']) {
      assert.equal(rankMatches(WINDOW, q)[0]?.row.ticker, 'FCL', q);
    }
  });

  test('company name words match, case-insensitive ("Fineotex", "fineotex chem")', () => {
    assert.equal(rankMatches(WINDOW, 'Fineotex')[0]?.row.ticker, 'FCL');
    assert.equal(rankMatches(WINDOW, 'fineotex chem')[0]?.row.ticker, 'FCL');
    // "fine" prefixes two company names — both come back, neither is FCL-only noise.
    const fine = rankMatches(WINDOW, 'fine').map((h) => h.row.ticker).sort();
    assert.deepEqual(fine, ['FCL', 'FINEORG']);
  });

  test('an exact ticker outranks a company whose NAME starts with the query', () => {
    const rows = [row('XYZ', 'FCL Holdings Ltd'), row('FCL', 'Fineotex Chemical Ltd')];
    assert.equal(rankMatches(rows, 'FCL')[0].row.ticker, 'FCL');
  });

  test('ties go to the newest filing', () => {
    const rows = [row('FCL', 'Fineotex', '2026-05-20'), row('FCL', 'Fineotex', '2026-08-14'), row('FCL', 'Fineotex', '2026-02-11')];
    assert.deepEqual(rankMatches(rows, 'FCL').map((h) => h.row.filing_date), ['2026-08-14', '2026-05-20', '2026-02-11']);
  });

  test('empty / blank query returns nothing', () => {
    assert.deepEqual(rankMatches(WINDOW, ''), []);
    assert.deepEqual(rankMatches(WINDOW, '   '), []);
  });
});

describe('zzz812 filter-hidden matches are reported, never dropped', () => {
  test('a match hidden by the cap filter is returned with the reason', async () => {
    const hiddenReasons = (r: Row) => (r.ticker === 'FCL' ? ['tier MIXED collapsed', 'cap filter: large'] : []);
    const o = await resolveSearch({ q: 'FCL', windowRows: WINDOW, hiddenReasons, lookbackDays: 168 });
    assert.equal(o.kind, 'window');
    if (o.kind !== 'window') return;
    assert.equal(o.hits[0].row.ticker, 'FCL');
    assert.deepEqual(o.hits[0].hiddenBy, ['tier MIXED collapsed', 'cap filter: large']);
    assert.equal(o.hiddenCount, 1);
    assert.equal(o.visibleCount, 1);          // FCLTD is visible
    assert.equal(o.note, '1 match hidden by filters');
    assert.equal(hiddenNote(o.hits[0].hiddenBy), 'shown despite your filters (tier MIXED collapsed / cap filter: large)');
  });

  test('count wording', () => {
    assert.equal(hiddenCountNote(0), '');
    assert.equal(hiddenCountNote(1), '1 match hidden by filters');
    assert.equal(hiddenCountNote(3), '3 matches hidden by filters');
    assert.equal(hiddenNote([]), '');
  });
});

describe('zzz812 history fallback (mocked)', () => {
  test('no match in the window → graded history, newest first, labelled outside the window', async () => {
    let calls = 0;
    const o = await resolveSearch({
      q: 'fcl',
      windowRows: WINDOW.filter((r) => r.ticker !== 'FCL' && r.ticker !== 'FCLTD'),
      lookbackDays: 168,
      fetchHistory: async (pq) => {
        calls++;
        assert.equal(pq.ticker, 'FCL');
        return [
          row('FCL', 'Fineotex Chemical Ltd', '2026-05-22', 'STRONG'),
          row('FCL', 'Fineotex Chemical Ltd', '2026-08-14', 'MIXED'),
          row('IFCL', 'Indo Fabric Chemicals Ltd', '2026-08-20', 'STRONG'),
        ];
      },
    });
    assert.equal(calls, 1);
    assert.equal(o.kind, 'history');
    if (o.kind !== 'history') return;
    assert.deepEqual(o.hits.map((h) => h.row.filing_date), ['2026-08-14', '2026-05-22']);
    assert.ok(!o.hits.some((h) => h.row.ticker === 'IFCL'));
    assert.equal(o.note, 'Found in 14 Aug 2026 results (outside your current window)');
    assert.equal(historyNote('2026-08-14'), o.note);
  });

  test('history is NOT consulted when the window already has the match', async () => {
    let calls = 0;
    const o = await resolveSearch({ q: 'FCL', windowRows: WINDOW, lookbackDays: 5, fetchHistory: async () => { calls++; return []; } });
    assert.equal(o.kind, 'window');
    assert.equal(calls, 0);
  });

  test('history may return {rows, lookbackDays, reason}', async () => {
    const o = await resolveSearch({
      q: 'Fineotex', windowRows: [], lookbackDays: 5,
      fetchHistory: async () => ({ rows: [row('FCL', 'Fineotex Chemical Ltd', '2026-08-14')], lookbackDays: 90 }),
    });
    assert.equal(o.kind, 'history');
  });
});

describe('zzz812 honest not-found', () => {
  test('exact wording, with the lookback', async () => {
    const o = await resolveSearch({ q: 'fcl', windowRows: [], lookbackDays: 168, fetchHistory: async () => [] });
    assert.equal(o.kind, 'none');
    if (o.kind !== 'none') return;
    assert.equal(o.message, "FCL: no graded result on file for the last 168 days — it may not have reported in the window, or its filing wasn't graded.");
  });

  test('a reason and a longer lookback from the history source are used', async () => {
    const o = await resolveSearch({
      q: 'FCL', windowRows: [], lookbackDays: 5,
      fetchHistory: async () => ({ rows: [], lookbackDays: 120, reason: 'no graded US sessions are cached in this browser yet' }),
    });
    assert.equal(o.kind, 'none');
    if (o.kind !== 'none') return;
    assert.equal(o.message, "FCL: no graded result on file for the last 120 days — it may not have reported in the window, or its filing wasn't graded (no graded US sessions are cached in this browser yet).");
  });

  test('a failing history lookup still produces a message, never a silent empty', async () => {
    const o = await resolveSearch({ q: 'FCL', windowRows: [], lookbackDays: 30, fetchHistory: async () => { throw new Error('boom'); } });
    assert.equal(o.kind, 'none');
    if (o.kind !== 'none') return;
    assert.match(o.message, /history lookup failed/);
    assert.equal(o.historyError, 'boom');
  });

  test('notFoundMessage normalises the ticker', () => {
    assert.match(notFoundMessage(' nse:fcl ', 10), /^FCL: no graded result on file for the last 10 days/);
  });

  test('an empty query is "empty", not "none"', async () => {
    assert.equal((await resolveSearch({ q: '  ', windowRows: WINDOW, lookbackDays: 5 })).kind, 'empty');
  });
});

describe('zzz812 URL ?q= param', () => {
  test('read', () => {
    assert.equal(readSearchParam('?q=FCL&date=2026-08-14'), 'FCL');
    assert.equal(readSearchParam('?q=Fineotex%20Chemical'), 'Fineotex Chemical');
    assert.equal(readSearchParam(''), '');
    assert.equal(readSearchParam('?date=2026-08-14'), '');
  });

  test('write keeps every other param and the hash; empty removes it', () => {
    assert.equal(withSearchParam('/earnings-opportunities', 'fcl'), '/earnings-opportunities?q=fcl');
    assert.equal(withSearchParam('/earnings-opportunities?date=2026-08-14#eo-card-FCL', 'FCL'), '/earnings-opportunities?date=2026-08-14&q=FCL#eo-card-FCL');
    assert.equal(withSearchParam('/us-earnings-opportunities?q=NVDA&x=1', 'nvidia corp'), '/us-earnings-opportunities?q=nvidia+corp&x=1');
    assert.equal(withSearchParam('/earnings-opportunities?q=FCL&x=1', ''), '/earnings-opportunities?x=1');
    assert.equal(withSearchParam('/earnings-opportunities?q=FCL', '   '), '/earnings-opportunities');
    // round trip
    assert.equal(readSearchParam(withSearchParam('/p', 'Fineotex Chemical').split('?')[1] ? '?' + withSearchParam('/p', 'Fineotex Chemical').split('?')[1] : ''), 'Fineotex Chemical');
  });
});

describe('zzz812 India server index reads the live graded namespace', () => {
  test('search route no longer hard-codes graded:v10 and uses the shared key list', () => {
    const src = readFileSync(join(__dirname, '../../app/api/v1/earnings/search/route.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/['"`]graded:v10:/.test(src), 'dead namespace graded:v10 is back');
    assert.match(src, /gradedKeyCandidates\(/);
    assert.match(src, /rankMatches\(/);
  });
});
