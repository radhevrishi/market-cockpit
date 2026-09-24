// zzz790 — US book store: round trip through an in-memory KV, its own key
// (`us-book:v1:*`), separation from every India key, replace / merge
// imports, and the price-free projection the catalyst engine reads.
// Run: npx tsx --test src/lib/__tests__/zzz790-us-store.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setUsBookKvForTests, readUsBook, writeUsBook, US_BOOK_KEY } from '../us-book-store';
import { applyImport, upsertHolding, removeHolding, setCash, addBench, removeBench, sanitizeHolding, sanitizeBenchEntry, thesisUniverse, emptyUsBook } from '../us-book/model';
import { parseUsBookImport } from '../us-book/import';
import { valueBook, quoteSymbolFor } from '../us-book/valuation';
import { setUsEvidenceKvForTests, persistUsEvidenceRun, loadUsLedger, US_LEDGER_KEY } from '../us-thesis/evidence-store';
import { setUsFocusKvForTests, upsertUsDetections, US_PERSIST_KEY } from '../us-thesis/special-focus-store';

const fakeKv = () => {
  const m = new Map<string, string>();
  return { map: m, get: async <T = any>(k: string): Promise<T | null> => (m.has(k) ? JSON.parse(m.get(k)!) as T : null), set: async (k: string, v: any) => { m.set(k, JSON.stringify(v)); } };
};
const CSV = 'ticker,exchange,currency,quantity,avg_price\nAAPL,NASDAQ,USD,10,150\nMOG A,NYSE,USD,4,300\nXYZ9,FWB2,EUR,20,25\nCASH,,USD,1000,\nCASH,,EUR,50,';
const INDIA_KEY = /^(book:v1:|portfolio:|evidence:ledger:v1:|evidence:batch|persist:v1:all|pc-thesis-types)/;

describe('US book store', () => {
  test('write → read round trip under us-book:v1:<owner>, nothing under an India key', async () => {
    const kv = fakeKv(); setUsBookKvForTests(kv);
    try {
      const book = applyImport(emptyUsBook('owner1'), parseUsBookImport(CSV), 'replace', '2026-09-24T00:00:00.000Z');
      const w = await writeUsBook(book);
      assert.equal(w.ok, true, String(w.error));
      assert.deepEqual([...kv.map.keys()], [US_BOOK_KEY('owner1')]);
      assert.match(US_BOOK_KEY('owner1'), /^us-book:v1:/);
      assert.ok(![...kv.map.keys()].some((k) => INDIA_KEY.test(k)));
      const back = await readUsBook('owner1');
      assert.equal(back.exists, true);
      assert.deepEqual(back.book.holdings.map((h) => h.ticker), ['AAPL', 'MOG-A', 'XYZ9']);
      assert.deepEqual(back.book.cash, { USD: 1000, EUR: 50 });
      assert.equal(back.book.lastImport?.mode, 'replace');
    } finally { setUsBookKvForTests(null); }
  });
  test('a missing book reads as empty with exists=false (not an error)', async () => {
    setUsBookKvForTests(fakeKv());
    try { const r = await readUsBook('nobody'); assert.equal(r.exists, false); assert.equal(r.error, null); assert.equal(r.book.holdings.length, 0); }
    finally { setUsBookKvForTests(null); }
  });
  test('a KV failure is reported, never an empty book written over the real one', async () => {
    setUsBookKvForTests({ get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); } });
    try {
      const r = await readUsBook('x');
      assert.match(String(r.error), /quota/);
      const w = await writeUsBook(emptyUsBook('x'));
      assert.equal(w.ok, false);
    } finally { setUsBookKvForTests(null); }
  });
});

describe('book edits', () => {
  const base = applyImport(emptyUsBook('o'), parseUsBookImport(CSV), 'replace', '2026-09-01T00:00:00.000Z');
  test('merge upserts by ticker + venue and keeps other cash', () => {
    const m = applyImport(base, parseUsBookImport('ticker,exchange,currency,quantity,avg_price\nAAPL,NASDAQ,USD,12,155\nNVDA,NASDAQ,USD,1,100\nCASH,,USD,2000,'), 'merge');
    assert.equal(m.holdings.find((h) => h.ticker === 'AAPL')!.quantity, 12);
    assert.equal(m.holdings.find((h) => h.ticker === 'AAPL')!.addedAt, '2026-09-01T00:00:00.000Z', 'first-added date kept');
    assert.ok(m.holdings.some((h) => h.ticker === 'NVDA'));
    assert.ok(m.holdings.some((h) => h.ticker === 'XYZ9'), 'merge does not drop what the import did not mention');
    assert.deepEqual(m.cash, { USD: 2000, EUR: 50 });
  });
  test('replace swaps positions and cash', () => {
    const r = applyImport(base, parseUsBookImport('ticker,exchange,currency,quantity,avg_price\nNVDA,NASDAQ,USD,1,100'), 'replace');
    assert.deepEqual(r.holdings.map((h) => h.ticker), ['NVDA']);
    assert.deepEqual(r.cash, {});
  });
  test('manual upsert / remove / cash / bench', () => {
    let b = upsertHolding(base, sanitizeHolding({ ticker: 'brk.b', exchange: 'nyse', currency: 'usd', quantity: 3, avgPrice: 400 })!);
    assert.ok(b.holdings.some((h) => h.ticker === 'BRK-B' && h.exchange === 'NYSE' && h.listing === 'US'));
    b = removeHolding(b, 'MOG.A');
    assert.ok(!b.holdings.some((h) => h.ticker === 'MOG-A'));
    b = setCash(b, 'BASE', 1234.567);
    assert.equal(b.cash.BASE, 1234.57);
    b = setCash(b, 'EUR', null);
    assert.equal(b.cash.EUR, undefined);
    b = addBench(b, sanitizeBenchEntry({ ticker: 'TXN', exchange: 'NASDAQ' })!);
    b = addBench(b, sanitizeBenchEntry({ ticker: 'AAPL' })!);
    assert.equal(b.bench.length, 2);
    b = removeBench(b, 'TXN');
    assert.deepEqual(b.bench.map((x) => x.ticker), ['AAPL']);
    assert.equal(sanitizeHolding({ ticker: 'X', quantity: 0 }), null, 'zero quantity is not a holding');
  });
});

describe('the engine sees a projection with no price', () => {
  const b = addBench(applyImport(emptyUsBook('o'), parseUsBookImport(CSV), 'replace'), sanitizeBenchEntry({ ticker: 'TXN', exchange: 'NASDAQ' })!);
  const uni = thesisUniverse(b);
  test('ticker / origin / listing only', () => {
    for (const u of uni) assert.deepEqual(Object.keys(u).sort(), ['exchange', 'excludedReason', 'listing', 'origin', 'ticker']);
    const s = JSON.stringify(uni);
    assert.ok(!/avgPrice|quantity|price|cost/i.test(s.replace(/excludedReason/g, '')), 'no quantity, cost or price reaches the engine');
  });
  test('FWB2 excluded with a reason; bench counted as bench', () => {
    const x = uni.find((u) => u.ticker === 'XYZ9')!;
    assert.equal(x.listing, 'NON_US');
    assert.match(String(x.excludedReason), /Frankfurt/);
    assert.equal(uni.find((u) => u.ticker === 'TXN')!.origin, 'bench');
    assert.equal(uni.find((u) => u.ticker === 'AAPL')!.origin, 'book');
  });
});

describe('book page values (never the engine)', () => {
  const b = applyImport(emptyUsBook('o'), parseUsBookImport(CSV), 'replace');
  test('market value and P&L per currency; cash apart; FX only when given', () => {
    assert.equal(quoteSymbolFor(b.holdings.find((h) => h.ticker === 'XYZ9')!), 'XYZ9.F');
    assert.equal(quoteSymbolFor(b.holdings.find((h) => h.ticker === 'MOG-A')!), 'MOG-A');
    const v = valueBook(b, { AAPL: { symbol: 'AAPL', price: 200, currency: 'USD', source: 't' }, 'XYZ9.F': { symbol: 'XYZ9.F', price: 30, currency: 'EUR', source: 't' } });
    const aapl = v.rows.find((r) => r.ticker === 'AAPL')!;
    assert.equal(aapl.marketValue, 2000); assert.equal(aapl.pnl, 500); assert.equal(aapl.pnlPct, 33.33);
    assert.equal(v.rows.find((r) => r.ticker === 'MOG-A')!.note, 'no live quote');
    assert.deepEqual(v.byCurrency.USD, { cost: 1500, marketValue: 2000, pnl: 500, priced: 1, unpriced: 1 });
    assert.equal(v.byCurrency.EUR.marketValue, 600);
    assert.deepEqual(v.cash, { USD: 1000, EUR: 50 });
    assert.equal(v.usdEquivalent, null, 'no FX, no USD total');
    const v2 = valueBook(b, { AAPL: { symbol: 'AAPL', price: 200, currency: 'USD', source: 't' } }, { EUR: 1.1 });
    assert.equal(v2.usdEquivalent!.cash, 1055);
  });
  test('a quote in the wrong currency is not used', () => {
    const v = valueBook(b, { AAPL: { symbol: 'AAPL', price: 200, currency: 'EUR', source: 't' } });
    assert.equal(v.rows.find((r) => r.ticker === 'AAPL')!.marketValue, null);
  });
});

describe('US evidence + Special Focus live on US keys only', () => {
  test('a persisted US read writes us-evidence:ledger:v1:<T> and nothing India', async () => {
    const kv = fakeKv(); setUsEvidenceKvForTests(kv);
    try {
      const url = 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/0000000001-26-000001-index.htm';
      const r = await persistUsEvidenceRun({
        ticker: 'MOG-A', runId: 'r1', startedAt: '2026-08-10T00:00:00.000Z',
        documents: [{ id: 'doc_x', url, label: 'Form 10-Q', kind: 'results', source: 'SEC EDGAR', tier: 1, period: '2026-06-27', date_iso: '2026-08-07', outcome: 'read', chars: 5000 }],
        events: [{ variable: 'order_book', value_type: 'ACTUAL', before: '$2.1 billion', after: '$2.4 billion', unit: null, period: null, direction: 'up', evidence_text: 'Backlog was $2.4 billion at June 27, 2026 compared with $2.1 billion a year earlier.', source: 'Form 10-Q', confidence: 'HIGH' } as any],
        summary: { verdict_line: 'read', positives: [] }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [], promptVersion: 'us-thesis-read-v1', model: 'm', rawExtraction: null, pipeline: null,
      });
      assert.equal(r.persisted, true, String(r.error));
      assert.equal(r.period, 'Q1 FY27', 'the shared calendar key');
      assert.deepEqual([...kv.map.keys()], [US_LEDGER_KEY('MOG-A')]);
      assert.match(US_LEDGER_KEY('MOG.A'), /^us-evidence:ledger:v1:MOG-A$/);
      assert.ok(![...kv.map.keys()].some((k) => INDIA_KEY.test(k)));
      const l = await loadUsLedger('MOG-A');
      assert.equal(l!.market, 'US');
      assert.equal(l!.periods['Q1 FY27'].facts.length, 1);
    } finally { setUsEvidenceKvForTests(null); }
  });
  test('Special Focus detections go to us-persist:v1:all', async () => {
    const kv = fakeKv(); setUsFocusKvForTests(kv);
    try {
      await upsertUsDetections([{ id: 'ACME:ORDER_VISIBILITY', ticker: 'ACME', kind: 'ORDER_VISIBILITY', label: 'Order visibility', specialFocus: true, confidence: 'HIGH', state: 'VALIDATED', mechanism: 'backlog', latestEvidenceDate: '2026-08-07', origins: ['portfolio'], hardCount: 2, evidence: [], forward: [], beforeAfter: [], why: [], runway: { text: '' } } as any]);
      assert.deepEqual([...kv.map.keys()], [US_PERSIST_KEY]);
      assert.equal(US_PERSIST_KEY, 'us-persist:v1:all');
    } finally { setUsFocusKvForTests(null); }
  });
  test('the India book store is untouched by this work (its key is book:v1:)', () => {
    const src = readFileSync(join(__dirname, '..', 'book-store.ts'), 'utf8');
    assert.match(src, /const BOOK_KEY = \(chatId: string\) => `book:v1:\$\{chatId\}`;/);
    assert.ok(!/us-book/.test(src), 'no US key in the India store');
  });
});
