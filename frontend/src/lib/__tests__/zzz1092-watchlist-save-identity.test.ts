// zzz1092 (evening retest R1) — the REAL /api/watchlist route keeps NSE:/US:/dotted symbols, refuses an invalid entry
// atomically (nothing saved, the entry named), and the client only reports "saved" when every requested symbol was kept.
// Runs the route against the in-memory KV (no Redis env in tests) — never production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkListSymbol, indiaListSymbols, sameListSymbol } from '../instrument-id';
import { interpretWriteResponse } from '../watchlist-sync';

const CHAT = `test-${Date.now()}`;   // a disposable list id (not the owner's)
// a test-only secret; the route runs on the in-memory KV (this file refuses to run against a real Redis)
process.env.MC_BOT_SECRET = 'test-secret-zzz1092';
const realKv = !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
const routeP = import('../../app/api/watchlist/route');
const post = async (body: any) => (await routeP).POST(new Request('http://x/api/watchlist', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ chatId: CHAT, secret: 'test-secret-zzz1092', ...body }) }));
const get = async () => (await (await (await routeP).GET(new Request(`http://x/api/watchlist?chatId=${CHAT}`))).json()).watchlist as string[];

test('validator: qualified and dotted symbols are valid and kept as written; junk is refused with a reason', () => {
  for (const s of ['INFY', 'US:HAL', 'NSE:HAL', 'NYSE:HAL', 'BRK.B', 'BSE:532067', '532067', 'M&M', 'BAJAJ-AUTO', 'HAL.NS']) assert.equal(checkListSymbol(s).ok, true, s);
  assert.equal(checkListSymbol(' us:hal ').value, 'US:HAL');
  for (const s of ['', 'HAL HAL', 'LSE:VOD', 'US:', '$$$']) assert.equal(checkListSymbol(s).ok, false, s);
  assert.ok(sameListSymbol('NSE:HAL', 'HAL.NS') && sameListSymbol('US:HAL', 'NYSE:HAL') && !sameListSymbol('HAL', 'US:HAL'));
  assert.deepEqual(indiaListSymbols(['INFY', 'US:HAL', 'NSE:HAL', 'BRK.B', 'BSE:532067', 'bad thing']), ['INFY', 'HAL', 'BRK.B', '532067']);
});

test('full replace → GET keeps every valid instrument (NSE:HAL, US:HAL, NYSE:HAL, BRK.B)', { skip: realKv }, async () => {
  const want = ['INFY', 'US:HAL', 'NSE:HAL', 'NYSE:HAL', 'BRK.B'];
  const r = await post({ watchlist: want });
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.ok, true);
  assert.deepEqual(j.watchlist, want);
  assert.deepEqual(await get(), want);
  assert.equal(interpretWriteResponse(true, 200, j, want).ok, true);
});

test('a mixed list with one invalid entry is refused whole — nothing changes, the bad entry is named', { skip: realKv }, async () => {
  const before = await get();
  const r = await post({ watchlist: ['TCS', 'US:NVDA', 'LSE:VOD'] });
  const j = await r.json();
  assert.equal(r.status, 400); assert.equal(j.ok, false);
  assert.deepEqual(j.rejected.map((x: any) => x.symbol), ['LSE:VOD']);
  assert.deepEqual(await get(), before, 'nothing written');
  assert.match(interpretWriteResponse(false, 400, j, ['TCS', 'US:NVDA', 'LSE:VOD']).error || '', /not saved — invalid: LSE:VOD/);
});

test('incremental add / remove keep qualified identities; a server that drops one is not "saved"', { skip: realKv }, async () => {
  let j = await (await post({ action: 'add', symbols: ['NASDAQ:NVDA', 'nse:tcs'] })).json();
  assert.equal(j.ok, true);
  assert.ok(j.watchlist.includes('NASDAQ:NVDA') && j.watchlist.includes('NSE:TCS'));
  j = await (await post({ action: 'add', symbols: ['US:NVDA'] })).json();   // same instrument as NASDAQ:NVDA — not added twice
  assert.equal(j.watchlist.filter((s: string) => /NVDA/.test(s)).length, 1);
  j = await (await post({ action: 'remove', symbols: ['NYSE:HAL'] })).json();
  assert.ok(!j.watchlist.includes('US:HAL') && !j.watchlist.includes('NYSE:HAL'), 'US:HAL and NYSE:HAL are the same US company');
  assert.ok(j.watchlist.includes('NSE:HAL'), 'the NSE listing stays');
  // client check: a reply that lost a requested symbol is a failure
  assert.match(interpretWriteResponse(true, 200, { ok: true, watchlist: ['INFY'] }, ['INFY', 'US:HAL']).error || '', /did not keep US:HAL/);
});
