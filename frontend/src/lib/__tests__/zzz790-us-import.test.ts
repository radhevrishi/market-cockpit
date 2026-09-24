// zzz790 — US Portfolio Book import parsing: the book CSV, an IBKR positions
// paste, an IBKR activity statement; MOG A / MOG.A → MOG-A; FWB2 kept but
// NON_US; CASH rows go to cash, never to holdings. Synthetic tickers and
// amounts only — the owner's real book is never committed. When the owner's
// scratch seed file is present on this machine it is parsed too (read at
// test time, not copied into the repo).
// Run: npx tsx --test src/lib/__tests__/zzz790-us-import.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseUsBookImport, normalizeUsTicker, classifyListing, parseNum, splitInstrument } from '../us-book/import';

const CSV = [
  'ticker,exchange,currency,quantity,avg_price',
  'AAPL,NASDAQ,USD,10,150.25',
  'MOG A,NYSE,USD,4,300.00',
  'BRK.B,NYSE,USD,2,410',
  'XYZ9,FWB2,EUR,20,25.50',
  'ESPX,AMEX,USD,"1,200",12.10',
  'CASH,,USD,1000.50,',
  'CASH,,EUR,250,',
  'CASH,,BASE,1300,',
  'BAD TICKER WITH SPACES,NYSE,USD,1,1',
  'ZERO,NYSE,USD,0,5',
].join('\n');

describe('tickers', () => {
  test('class shares normalise to the SEC spelling', () => {
    assert.equal(normalizeUsTicker('MOG A'), 'MOG-A');
    assert.equal(normalizeUsTicker('MOG.A'), 'MOG-A');
    assert.equal(normalizeUsTicker('mog/a'), 'MOG-A');
    assert.equal(normalizeUsTicker('MOG-A'), 'MOG-A');
    assert.equal(normalizeUsTicker('BRK B'), 'BRK-B');
    assert.equal(normalizeUsTicker(' akam '), 'AKAM');
    assert.equal(normalizeUsTicker('0ZQ'), '0ZQ', 'digit-leading tickers are tickers');
    assert.equal(normalizeUsTicker('NOT A TICKER AT ALL'), '');
  });
  test('instrument strings split into symbol + venue', () => {
    assert.deepEqual(splitInstrument('AKAM NASDAQ.NMS'), { symbol: 'AKAM', exchange: 'NASDAQ.NMS' });
    assert.deepEqual(splitInstrument('MOG A'), { symbol: 'MOG A', exchange: '' });
    assert.deepEqual(splitInstrument('ABC1 FWB2'), { symbol: 'ABC1', exchange: 'FWB2' });
  });
  test('numbers: thousands commas yes, ambiguous decimal commas no', () => {
    assert.equal(parseNum('1,343.50'), 1343.5);
    assert.equal(parseNum('$106.83'), 106.83);
    assert.equal(parseNum('(12.5)'), -12.5);
    assert.equal(parseNum('26,06'), null);
  });
});

describe('listings', () => {
  test('FWB2 is a non-US listing with a reason, never silent', () => {
    const c = classifyListing('FWB2', 'EUR');
    assert.equal(c.listing, 'NON_US');
    assert.match(c.note, /Frankfurt/);
    assert.match(c.note, /no SEC filer/);
  });
  test('US venues and a bare USD line are US', () => {
    for (const x of ['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'NASDAQ.NMS']) assert.equal(classifyListing(x, 'USD').listing, 'US', x);
    const bare = classifyListing('', 'USD');
    assert.equal(bare.listing, 'US');
    assert.match(bare.note, /not stated/);
    assert.equal(classifyListing('', 'EUR').listing, 'NON_US');
  });
});

describe('book CSV', () => {
  const r = parseUsBookImport(CSV);
  test('format and holdings', () => {
    assert.equal(r.format, 'book-csv');
    assert.deepEqual(r.holdings.map((h) => h.ticker), ['AAPL', 'MOG-A', 'BRK-B', 'XYZ9', 'ESPX']);
    const mog = r.holdings.find((h) => h.ticker === 'MOG-A')!;
    assert.equal(mog.rawTicker, 'MOG A');
    assert.equal(mog.quantity, 4);
    assert.equal(mog.avgPrice, 300);
    assert.equal(r.holdings.find((h) => h.ticker === 'ESPX')!.quantity, 1200);
  });
  test('FWB2 kept, marked NON_US', () => {
    const x = r.holdings.find((h) => h.ticker === 'XYZ9')!;
    assert.equal(x.listing, 'NON_US');
    assert.equal(x.currency, 'EUR');
    assert.equal(x.exchange, 'FWB2');
  });
  test('CASH rows are cash per currency, never holdings', () => {
    assert.deepEqual(r.cash, { USD: 1000.5, EUR: 250, BASE: 1300 });
    assert.ok(!r.holdings.some((h) => /CASH/.test(h.ticker)));
  });
  test('bad lines are rejected with a reason', () => {
    assert.equal(r.rejected.length, 2);
    assert.ok(r.rejected.some((x) => /not a ticker/.test(x.reason)));
    assert.ok(r.rejected.some((x) => /quantity/.test(x.reason)));
  });
});

describe('IBKR positions paste (tab-separated)', () => {
  const PASTE = [
    'Financial Instrument\tPosition\tAvg Price\tCurrency\tMarket Value',
    'AAPL NASDAQ.NMS\t10\t150.25\tUSD\t2,100.00',
    'MOG A\t4\t300\tUSD\t1,400',
    'XYZ9 FWB2\t20\t25.5\tEUR\t600',
    'USD.CASH\t500\t\tUSD\t500',
  ].join('\n');
  const r = parseUsBookImport(PASTE);
  test('parsed as IBKR positions', () => {
    assert.equal(r.format, 'ibkr-positions');
    assert.deepEqual(r.holdings.map((h) => [h.ticker, h.exchange, h.listing]), [['AAPL', 'NASDAQ.NMS', 'US'], ['MOG-A', '', 'US'], ['XYZ9', 'FWB2', 'NON_US']]);
    assert.deepEqual(r.cash, { USD: 500 });
  });
});

describe('IBKR activity statement', () => {
  const STMT = [
    'Statement,Header,Field Name,Field Value',
    'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code',
    'Open Positions,Data,Summary,Stocks,USD,AAPL,10,1,150.25,1502.5,210,2100,597.5,',
    'Open Positions,Data,Lot,Stocks,USD,AAPL,10,1,150.25,1502.5,210,2100,597.5,',
    'Open Positions,Data,Summary,Stocks,USD,MOG A,4,1,300,1200,350,1400,200,',
    'Open Positions,Data,Summary,Equity and Index Options,USD,AAPL 20DEC26 200 C,1,100,5,500,6,600,100,',
    'Open Positions,Data,Summary,Stocks,EUR,XYZ9,20,1,25.5,510,30,600,90,',
    'Cash Report,Header,Currency Summary,Currency,Total,Securities,Futures',
    'Cash Report,Data,Starting Cash,USD,900,900,0',
    'Cash Report,Data,Ending Cash,USD,1000.5,1000.5,0',
    'Cash Report,Data,Ending Cash,EUR,250,250,0',
    'Cash Report,Data,Ending Cash,Base Currency Summary,1300,1300,0',
  ].join('\n');
  const r = parseUsBookImport(STMT);
  test('summary lines only, stocks only, cash from Ending Cash', () => {
    assert.equal(r.format, 'ibkr-activity');
    assert.deepEqual(r.holdings.map((h) => h.ticker), ['AAPL', 'MOG-A', 'XYZ9']);
    assert.equal(r.holdings[0].quantity, 10, 'the Lot line is not double-counted');
    assert.deepEqual(r.cash, { USD: 1000.5, EUR: 250, BASE: 1300 });
    assert.ok(r.warnings.some((w) => /Options/.test(w)), 'a skipped option is said, not silent');
  });
  test('a EUR line with no venue is NON_US', () => {
    assert.equal(r.holdings.find((h) => h.ticker === 'XYZ9')!.listing, 'NON_US');
  });
});

describe('the owner\'s seed file (scratch only, when present)', () => {
  const SEED = '/tmp/claude-0/-home-claude/2a0c2ebb-646f-5f80-9739-6dea50423a8e/scratchpad/us_book_seed.csv';
  test('parses with MOG.A normalised, FWB2 non-US and CASH apart', { skip: !existsSync(SEED) }, () => {
    const r = parseUsBookImport(readFileSync(SEED, 'utf8'));
    assert.equal(r.format, 'book-csv');
    assert.equal(r.rejected.length, 0, JSON.stringify(r.rejected));
    assert.ok(r.holdings.some((h) => h.ticker === 'MOG-A' && ['MOG.A', 'MOG A', 'MOG-A'].includes(h.rawTicker)));
    const fwb = r.holdings.filter((h) => h.exchange === 'FWB2');
    assert.ok(fwb.length >= 1 && fwb.every((h) => h.listing === 'NON_US' && h.currency === 'EUR'));
    assert.ok(Object.keys(r.cash).length >= 1);
    assert.ok(!r.holdings.some((h) => h.ticker === 'CASH'));
  });
});
