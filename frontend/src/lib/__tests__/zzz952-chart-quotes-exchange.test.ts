import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/v1/chart-quotes/route';

test('quote endpoint keeps NSE/BSE prices distinct and never fills a missing BSE quote with NSE', async () => {
  const original = globalThis.fetch;
  let omitBse = false;
  globalThis.fetch = (async (url: string) => {
    const symbols = new URL(url).searchParams.get('symbols')!.split(',');
    return { ok: true, json: async () => ({ spark: { result: symbols.filter((s) => !(omitBse && s.endsWith('.BO'))).map((symbol) => ({ symbol, response: [{ meta: { regularMarketPrice: symbol.endsWith('.BO') ? 200 : 100, previousClose: 90, regularMarketTime: 1791360000 } }] })) } }) };
  }) as any;
  try {
    const both = await (await GET(new NextRequest('http://localhost/api/v1/chart-quotes?s=IN:EXCHTEST,IN:BSE:EXCHTEST'))).json();
    assert.equal(both.quotes['IN:EXCHTEST'].last, 100);
    assert.equal(both.quotes['IN:BSE:EXCHTEST'].last, 200);
    assert.equal(both.quotes['IN:BSE:EXCHTEST'].marketTime, 1791360000000);
    assert.equal(typeof both.quotes['IN:BSE:EXCHTEST'].at, 'number');
    omitBse = true;
    const missing = await (await GET(new NextRequest('http://localhost/api/v1/chart-quotes?s=IN:EXCHMISS,IN:BSE:EXCHMISS'))).json();
    assert.equal(missing.quotes['IN:EXCHMISS'].last, 100);
    assert.equal(missing.quotes['IN:BSE:EXCHMISS'], undefined);
  } finally { globalThis.fetch = original; }
});
