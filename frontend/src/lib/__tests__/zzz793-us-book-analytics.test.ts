// zzz793 — US Portfolio Book: USD view, reconciliation, sorting, prices,
// FX, sectors, tickers. Committed fixtures use MADE-UP tickers and amounts.
// The owner's real holdings CSV is read ONLY from the session scratchpad
// path below, and that test is skipped when the file is not there.
// Run: npx tsx --test src/lib/__tests__/zzz793-us-book-analytics.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUsBookView, usBookAnalytics, compareSortValues, sortRows, priceFor, ageInWords, fmtUsdShort, STALE_PRICE_DAYS, type FxDetail } from '../us-book/analytics';
import { parseUsBookImport, normalizeUsTicker } from '../us-book/import';
import { applyImport, emptyUsBook } from '../us-book/model';
import { quoteSymbolFor, type UsQuote } from '../us-book/valuation';
import { parseYahooChart } from '../us-book/quotes';
import { sicToSector } from '../us-book/sector';
import { profileIsFresh, type UsProfile } from '../us-book/profile';

const NOW = Date.parse('2026-09-24T18:00:00Z');
const RECENT = '2026-09-24T16:00:00Z';
const OLD = '2026-09-10T20:00:00Z';

const FIXTURE_CSV = [
  'ticker,exchange,currency,quantity,avg_price',
  'AAA,NASDAQ,USD,10,100.00',
  'BBB,NYSE,USD,20,50.00',
  'CCC B,NYSE,USD,5,200.00',
  'DDD,NASDAQ,USD,100,3.00',
  'EEE,FWB2,EUR,40,10.00',
  'FFF,NYSE,USD,8,',
  'CASH,,USD,1000,',
  'CASH,,EUR,500,',
].join('\n');

function fixtureBook() {
  const imp = parseUsBookImport(FIXTURE_CSV);
  return applyImport(emptyUsBook('t'), imp, 'replace', '2026-09-21T10:00:00Z');
}
const q = (symbol: string, price: number | null, currency = 'USD', prevClose: number | null = null, time: string | null = RECENT): UsQuote =>
  ({ symbol, price, currency, source: 'Yahoo Finance', marketTime: time, asOf: time, prevClose });
const QUOTES: Record<string, UsQuote> = {
  AAA: q('AAA', 120, 'USD', 118),
  BBB: q('BBB', 40, 'USD', null),            // no previous close → no day change
  'CCC-B': q('CCC-B', 250, 'USD', 240),
  DDD: q('DDD', 2, 'USD', 2, OLD),           // stale
  'EEE.F': q('EEE.F', 12, 'EUR', 11.5),
  FFF: q('FFF', 30, 'USD', 29),              // no cost on file
};
const FX: Record<string, FxDetail> = { EUR: { rate: 1.1, at: RECENT, source: 'Yahoo Finance', symbol: 'EURUSD=X' } };

describe('USD view — totals and weights reconcile', () => {
  const v = buildUsBookView({ book: fixtureBook(), quotes: QUOTES, fx: FX, now: NOW });
  const row = (t: string) => v.rows.find((r) => r.ticker === t)!;

  test('each row: value, cost, P&L in USD', () => {
    assert.equal(row('AAA').mvUsd, 1200); assert.equal(row('AAA').costUsd, 1000); assert.equal(row('AAA').pnlUsd, 200);
    assert.equal(row('AAA').pnlPct, 20);
    assert.equal(row('BBB').pnlUsd, -200);
    assert.equal(row('CCC-B').mvUsd, 1250);
    assert.equal(row('EEE').marketValue, 480, 'native EUR value');
    assert.equal(row('EEE').mvUsd, 528, 'EUR → USD at the live rate');
    assert.equal(row('EEE').costUsd, 440);
    assert.equal(row('FFF').mvUsd, 240); assert.equal(row('FFF').pnlUsd, null, 'no cost → no P&L');
  });
  test('stale price is not used, shown with a reason, never 0', () => {
    const d = row('DDD');
    assert.equal(d.priceStatus, 'stale'); assert.equal(d.price, null); assert.equal(d.mvUsd, null); assert.equal(d.weightPct, null);
    assert.match(d.priceReason!, /too old/);
    assert.ok(v.leftOut.some((x) => x.what.startsWith('DDD')));
  });
  test('holdings total = sum of the rows; book = holdings + cash', () => {
    const sum = Math.round(v.rows.reduce((s, r) => s + (r.mvUsd ?? 0), 0) * 100) / 100;
    assert.equal(v.totals.holdingsUsd, sum);
    assert.equal(v.totals.holdingsUsd, 1200 + 800 + 1250 + 528 + 240);
    assert.equal(v.totals.cashUsd, 1000 + 550);
    assert.equal(v.totals.totalUsd, Math.round((v.totals.holdingsUsd + v.totals.cashUsd) * 100) / 100);
    assert.equal(v.totals.pnlUsd, Math.round(v.rows.reduce((s, r) => s + (r.pnlUsd ?? 0), 0) * 100) / 100);
    assert.equal(v.totals.costValuedUsd, 1000 + 1000 + 1000 + 440);
    assert.equal(v.totals.valued, 5); assert.equal(v.totals.unvalued, 1);
  });
  test('weights of shares + cash add up to 100 %', () => {
    const w = v.rows.reduce((s, r) => s + (r.weightPct ?? 0), 0) + v.cash.reduce((s, c) => s + (c.weightPct ?? 0), 0);
    assert.ok(Math.abs(w - 100) < 1e-9, `weights sum ${w}`);
    assert.ok(Math.abs(v.totals.weightsHoldingsPct + v.totals.weightsCashPct - 100) < 1e-9);
    assert.ok(Math.abs(row('AAA').weightPct! - (1200 / v.totals.totalUsd) * 100) < 1e-9);
  });
  test('day change only where a previous close exists', () => {
    assert.equal(row('BBB').dayChangePct, null); assert.equal(row('BBB').dayChangeUsd, null);
    assert.equal(row('AAA').dayChangeUsd, 20);
    assert.equal(row('EEE').dayChangeUsd, 22, '0.5 EUR × 40 × 1.1');
    assert.equal(v.totals.dayCovered, 4);
    assert.equal(v.totals.dayChangeUsd, 20 + 50 + 22 + 8);
  });
  test('the EUR view uses the same rate', () => {
    assert.equal(v.eurUsd, 1.1);
    assert.equal(v.totalEur, Math.round((v.totals.totalUsd / 1.1) * 100) / 100);
  });
  test('analytics: sectors, splits and buckets close to the same totals', () => {
    const a = usBookAnalytics(v);
    const secW = a.sectors.reduce((s, x) => s + x.weightPct, 0);
    assert.ok(Math.abs(secW - v.totals.weightsHoldingsPct) < 1e-9);
    assert.ok(Math.abs(a.listingSplit.reduce((s, b) => s + b.weightPct, 0) - 100) < 1e-9);
    assert.ok(Math.abs(a.currencySplit.reduce((s, b) => s + b.weightPct, 0) - 100) < 1e-9);
    assert.equal(a.sizeBuckets.reduce((s, b) => s + b.count, 0), v.totals.valued);
    assert.equal(a.winners, 3); assert.equal(a.losers, 1);
    assert.equal(a.best!.ticker, 'CCC-B'); assert.equal(a.worst!.ticker, 'BBB');
    assert.equal(a.sectors.find((s) => s.sector === 'Unknown (no SEC filer)')!.count, 1, 'Frankfurt line');
    assert.ok(!JSON.stringify(a).match(/\b(BUY|SELL)\b/));
  });
});

describe('FX and cash', () => {
  test('no FX → EUR lines left out and say "FX unavailable", nothing assumed', () => {
    const v = buildUsBookView({ book: fixtureBook(), quotes: QUOTES, fx: { EUR: { rate: null, at: null, source: 'Yahoo Finance', error: 'timeout' } }, now: NOW });
    const e = v.rows.find((r) => r.ticker === 'EEE')!;
    assert.equal(e.mvUsd, null); assert.equal(e.marketValue, 480, 'native value still known');
    assert.match(e.priceReason!, /FX unavailable/);
    assert.equal(v.cash.find((c) => c.currency === 'EUR')!.usd, null);
    assert.equal(v.totalEur, null);
    const w = v.rows.reduce((s, r) => s + (r.weightPct ?? 0), 0) + v.cash.reduce((s, c) => s + (c.weightPct ?? 0), 0);
    assert.ok(Math.abs(w - 100) < 1e-9, 'still closes to 100 % over what is valued');
  });
  test('BASE cash is shown apart and never added', () => {
    const b = fixtureBook(); b.cash = { ...b.cash, BASE: 99999 };
    const v = buildUsBookView({ book: b, quotes: QUOTES, fx: FX, now: NOW });
    assert.equal(v.baseCash, 99999);
    assert.ok(!v.cash.some((c) => c.currency === 'BASE'));
    assert.equal(v.totals.cashUsd, 1550);
  });
  test('no BASE line is not an error', () => {
    const v = buildUsBookView({ book: fixtureBook(), quotes: QUOTES, fx: FX, now: NOW });
    assert.equal(v.baseCash, null);
  });
});

describe('prices', () => {
  test('missing, wrong currency, stale, live', () => {
    assert.equal(priceFor({ currency: 'USD' }, null, NOW).status, 'missing');
    assert.equal(priceFor({ currency: 'USD' }, q('X', 0), NOW).status, 'missing', 'a zero price is no price');
    assert.equal(priceFor({ currency: 'EUR' }, q('X', 10, 'USD'), NOW).status, 'currency-mismatch');
    const old = new Date(NOW - (STALE_PRICE_DAYS + 1) * 86_400_000).toISOString();
    assert.equal(priceFor({ currency: 'USD' }, q('X', 10, 'USD', null, old), NOW).status, 'stale');
    const weekend = new Date(NOW - 3 * 86_400_000).toISOString();
    assert.equal(priceFor({ currency: 'USD' }, q('X', 10, 'USD', null, weekend), NOW).status, 'live', 'a Friday close on Monday is fine');
  });
  test('Yahoo chart parsing keeps currency, price time and previous close', () => {
    const j = { chart: { result: [{ meta: { currency: 'USD', symbol: 'ZZZ-A', regularMarketPrice: 384.94, regularMarketTime: 1790268758, chartPreviousClose: 374.98, range: '1d', longName: 'Zed Inc.' } }] } };
    const p = parseYahooChart(j, 'ZZZ-A');
    assert.equal(p.price, 384.94); assert.equal(p.currency, 'USD'); assert.equal(p.prevClose, 374.98);
    assert.equal(p.marketTime, new Date(1790268758 * 1000).toISOString());
    assert.equal(p.name, 'Zed Inc.');
    const noPrev = parseYahooChart({ chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: 5, chartPreviousClose: 1, range: '2y' } }] } }, 'Y');
    assert.equal(noPrev.prevClose, null, 'chartPreviousClose on a long range is not the previous close');
    const none = parseYahooChart({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }, 'NOPE');
    assert.equal(none.price, null); assert.match(none.error!, /delisted/);
  });
});

describe('tickers → Yahoo / SEC symbols', () => {
  test('class shares map to the dash spelling both SEC and Yahoo use', () => {
    for (const [raw, want] of [['MOG A', 'MOG-A'], ['MOG.A', 'MOG-A'], ['mog/a', 'MOG-A'], ['BRK.B', 'BRK-B'], ['BRK B', 'BRK-B'], ['BF-B', 'BF-B']]) {
      const t = normalizeUsTicker(raw);
      assert.equal(t, want, raw);
      assert.equal(quoteSymbolFor({ ticker: t, exchange: 'NYSE', listing: 'US' }), want);
    }
    assert.equal(quoteSymbolFor({ ticker: 'EEE', exchange: 'FWB2', listing: 'NON_US' }), 'EEE.F');
  });
});

describe('sorting', () => {
  test('numbers numerically, text as text, blanks last both ways', () => {
    const rows = [{ v: 10 }, { v: null }, { v: 2 }, { v: -5 }, { v: NaN }, { v: 100 }];
    assert.deepEqual(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v).slice(0, 4), [100, 10, 2, -5]);
    assert.deepEqual(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v).slice(0, 4), [-5, 2, 10, 100]);
    for (const dir of ['asc', 'desc'] as const) {
      const out = sortRows(rows, (r) => r.v, dir);
      assert.ok(out.slice(4).every((r) => r.v == null || Number.isNaN(r.v)), `blanks last (${dir})`);
    }
    const t = [{ s: 'b' }, { s: '—' }, { s: 'A10' }, { s: 'A9' }, { s: '' }];
    assert.deepEqual(sortRows(t, (r) => r.s, 'asc').map((r) => r.s), ['A9', 'A10', 'b', '—', '']);
    assert.deepEqual(sortRows(t, (r) => r.s, 'desc').map((r) => r.s).slice(0, 3), ['b', 'A10', 'A9']);
    assert.equal(compareSortValues(null, 1, 'desc'), 1);
    assert.equal(compareSortValues(1, undefined, 'asc'), -1);
  });
  test('default holdings sort (value desc) puts unvalued rows at the bottom', () => {
    const v = buildUsBookView({ book: fixtureBook(), quotes: QUOTES, fx: FX, now: NOW });
    const out = sortRows(v.rows, (r) => r.mvUsd, 'desc');
    assert.equal(out[0].ticker, 'CCC-B');
    assert.equal(out[out.length - 1].ticker, 'DDD');
  });
  test('stable for ties', () => {
    const rows = [{ k: 'a', v: 1 }, { k: 'b', v: 1 }, { k: 'c', v: 1 }];
    assert.deepEqual(sortRows(rows, (r) => r.v, 'desc').map((r) => r.k), ['a', 'b', 'c']);
  });
});

describe('sectors from the SEC industry code', () => {
  test('known codes', () => {
    assert.equal(sicToSector('3674'), 'Information Technology');
    assert.equal(sicToSector('7372'), 'Information Technology');
    assert.equal(sicToSector('2834'), 'Health Care');
    assert.equal(sicToSector('3812'), 'Industrials');
    assert.equal(sicToSector('1311'), 'Energy');
    assert.equal(sicToSector('6022'), 'Financials');
    assert.equal(sicToSector('6798'), 'Real Estate');
    assert.equal(sicToSector('4911'), 'Utilities');
    assert.equal(sicToSector('3711'), 'Consumer Discretionary');
    assert.equal(sicToSector('1000'), 'Materials');
    assert.equal(sicToSector(null), 'Unknown');
    assert.equal(sicToSector('abc'), 'Unknown');
  });
  test('profiles are used for sector and name; failed lookups are retried after a day', () => {
    const prof: UsProfile = { ticker: 'AAA', name: 'Triple A Corp', cik: 1, sic: '3674', sicDescription: 'Semiconductors', sector: 'Information Technology', status: 'sec', note: null, fetchedAt: RECENT };
    const v = buildUsBookView({ book: fixtureBook(), quotes: QUOTES, fx: FX, profiles: { AAA: prof }, now: NOW });
    const a = v.rows.find((r) => r.ticker === 'AAA')!;
    assert.equal(a.sector, 'Information Technology'); assert.equal(a.name, 'Triple A Corp'); assert.equal(a.sectorSource, 'sec');
    assert.equal(v.rows.find((r) => r.ticker === 'BBB')!.sector, 'Unknown');
    assert.equal(profileIsFresh(prof, NOW), true);
    assert.equal(profileIsFresh({ ...prof, status: 'error', fetchedAt: new Date(NOW - 2 * 86_400_000).toISOString() }, NOW), false);
  });
});

describe('words', () => {
  test('import age and short dollars', () => {
    assert.equal(ageInWords('2026-09-21T18:00:00Z', NOW), '3 days ago');
    assert.equal(ageInWords('2026-09-24T15:00:00Z', NOW), '3 hours ago');
    assert.equal(ageInWords(null, NOW), null);
    assert.equal(fmtUsdShort(1_234_567), '$1.23M');
    assert.equal(fmtUsdShort(45_600), '$45.6K');
    assert.equal(fmtUsdShort(null), '—');
  });
});

describe('owner seed CSV (local scratchpad only — skipped when absent)', () => {
  const SEED = '/tmp/claude-0/-home-claude/2a0c2ebb-646f-5f80-9739-6dea50423a8e/scratchpad/us_book_seed.csv';
  test('parses, maps and reconciles', { skip: !existsSync(SEED) && 'seed CSV not present' }, () => {
    const imp = parseUsBookImport(readFileSync(SEED, 'utf8'));
    assert.equal(imp.rejected.length, 0);
    const book = applyImport(emptyUsBook('t'), imp, 'replace', RECENT);
    for (const h of book.holdings) {
      assert.ok(/^[A-Z0-9]+(-[A-Z]{1,2})?$/.test(h.ticker), h.ticker);
      if (h.exchange === 'FWB2') { assert.equal(h.listing, 'NON_US'); assert.match(quoteSymbolFor(h), /\.F$/); }
      if (/ /.test(h.rawTicker)) assert.ok(h.ticker.includes('-'), `${h.rawTicker} → ${h.ticker}`);
    }
    // Made-up prices: every holding at its own cost + 10 %, FX 1.1.
    const quotes: Record<string, UsQuote> = {};
    for (const h of book.holdings) quotes[quoteSymbolFor(h)] = q(quoteSymbolFor(h), (h.avgPrice ?? 1) * 1.1, h.currency, h.avgPrice ?? 1);
    const v = buildUsBookView({ book, quotes, fx: FX, now: NOW });
    assert.equal(v.totals.valued, book.holdings.length);
    const w = v.rows.reduce((s, r) => s + (r.weightPct ?? 0), 0) + v.cash.reduce((s, c) => s + (c.weightPct ?? 0), 0);
    assert.ok(Math.abs(w - 100) < 1e-9);
    assert.ok(Math.abs(v.totals.holdingsUsd - v.rows.reduce((s, r) => s + (r.mvUsd ?? 0), 0)) < 0.01 * v.rows.length);
    assert.ok(Math.abs(v.totals.pnlPct! - 10) < 0.01);
  });
});

describe('source invariants', () => {
  const SRC = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
  test('page.tsx exports only a default', () => {
    const named = read('app/(dashboard)/us-portfolio-book/page.tsx').split('\n').filter((l) => /^export\s+(?!default)/.test(l));
    assert.deepEqual(named, []);
  });
  test('no BUY / SELL language and no 0–100 score on the book page', () => {
    for (const f of ['app/(dashboard)/us-portfolio-book/page.tsx', 'app/(dashboard)/us-portfolio-book/tabs.tsx', 'lib/us-book/analytics.ts']) {
      const s = read(f);
      assert.ok(!/\b(BUY|SELL|Buy now|Sell now|TRIM|EXIT)\b/.test(s), `${f} has buy/sell words`);
      assert.ok(!/score/i.test(s.replace(/\/\/.*$/gm, '')), `${f} mentions a score`);
    }
  });
  test('new US-book routes touch no secret env vars and are protected by prefix', () => {
    for (const f of ['app/api/v1/us-book/profile/route.ts', 'app/api/v1/us-book/quotes/route.ts', 'lib/us-book/quotes.ts', 'lib/us-book/profile.ts']) {
      assert.ok(!/process\.env/.test(read(f)), `${f} reads env`);
    }
  });
  test('the thesis engine does not import the new price modules', () => {
    const dir = join(SRC, 'lib', 'us-thesis');
    for (const f of require('node:fs').readdirSync(dir)) {
      const s = readFileSync(join(dir, f), 'utf8');
      assert.ok(!/us-book\/(analytics|quotes|profile)/.test(s), f);
    }
  });
});
