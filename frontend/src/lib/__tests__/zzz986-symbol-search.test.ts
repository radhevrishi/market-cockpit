import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSymbolIndex, croreToUsdM, fromTuple, searchSymbols, toTuple, type SymbolItem } from '../symbol-search';

const LIST: SymbolItem[] = [
  { t: 'UNIONBANK', n: 'Union Bank of India', m: 'IN', x: 'NSE', c: croreToUsdM(110_000) },
  { t: 'UNIVCABLES', n: 'Universal Cables Limited', m: 'IN', x: 'NSE', c: croreToUsdM(2_500) },
  { t: 'UNIPARTS', n: 'Uniparts India Limited', m: 'IN', x: 'NSE', c: croreToUsdM(2_000) },
  { t: 'UNICOMMERCE', n: 'Unicommerce Esolutions Limited', m: 'IN', x: 'NSE', c: croreToUsdM(1_400) },
  { t: 'BAJAJCON', n: 'Bajaj Consumer Care Limited', m: 'IN', x: 'NSE', c: croreToUsdM(3_000) },
  { t: 'RELIANCE', n: 'Reliance Industries Limited', m: 'IN', x: 'NSE', c: croreToUsdM(1_900_000) },
  { t: 'UNH', n: 'UnitedHealth Group Incorporated', m: 'US', x: 'NYSE', c: 480_000 },
  { t: 'NVDA', n: 'NVIDIA Corporation', m: 'US', x: 'NASDAQ', c: 4_000_000 },
  { t: 'NVTS', n: 'Navitas Semiconductor Corporation', m: 'US', x: 'NASDAQ', c: 1_200 },
  { t: 'ENVX', n: 'Enovix Corporation', m: 'US', x: 'NASDAQ', c: 1_500 },
  { t: 'INVE', n: 'Identiv Inc', m: 'US', x: 'NASDAQ', c: 80 },
  { t: 'SMCI', n: 'Super Micro Computer Inc', m: 'US', x: 'NASDAQ', c: 25_000 },
];
const IX = buildSymbolIndex(LIST);
const tickers = (q: string, prefer?: 'US' | 'IN') => searchSymbols(IX, q, 15, prefer).map((s) => s.t);

test('uni finds Unicommerce, Uniparts and Universal Cables', () => {
  const r = tickers('uni');
  for (const t of ['UNICOMMERCE', 'UNIPARTS', 'UNIVCABLES']) assert.ok(r.includes(t), `${t} missing from ${r.join(',')}`);
  // ticker-prefix tier, bigger company first: Universal Cables > Uniparts > Unicommerce
  assert.ok(r.indexOf('UNIVCABLES') < r.indexOf('UNIPARTS') && r.indexOf('UNIPARTS') < r.indexOf('UNICOMMERCE'), r.join(','));
  assert.ok(!r.includes('NVDA') && !r.includes('BAJAJCON'));
});

test('upper-case input (the box upper-cases) behaves the same', () => {
  assert.deepEqual(tickers('UNI'), tickers('uni'));
});

test('nvi finds NVDA by the company name', () => {
  const r = tickers('nvi');
  assert.equal(r[0], 'NVDA');
  assert.ok(!r.includes('NVTS'));   // "Navitas" does not contain "nvi"
});

test('any word of the name matches', () => {
  assert.ok(tickers('cables').includes('UNIVCABLES'));
  assert.ok(tickers('micro')[0] === 'SMCI');
  assert.deepEqual(tickers('consumer care'), ['BAJAJCON']);
});

test('exact ticker comes first, in either market', () => {
  assert.equal(tickers('RELIANCE', 'US')[0], 'RELIANCE');
  assert.equal(tickers('unh')[0], 'UNH');
  assert.equal(tickers('NSE:UNIPARTS')[0], 'UNIPARTS');
});

test('the picked market leads within a tier, never above a better tier', () => {
  const r = tickers('un', 'US');
  assert.equal(r[0], 'UNH');
  assert.equal(tickers('nvi', 'IN')[0], 'NVDA');   // no Indian name starts with "nvi"
});

test('limit and empty input', () => {
  assert.equal(searchSymbols(IX, 'u', 3).length, 3);
  assert.deepEqual(searchSymbols(IX, '   '), []);
});

test('wire tuples round-trip', () => {
  for (const s of LIST) assert.deepEqual(fromTuple(JSON.parse(JSON.stringify(toTuple(s)))), s);
  assert.deepEqual(fromTuple(['ABC', 'Abc Ltd', 'IN']), { t: 'ABC', n: 'Abc Ltd', m: 'IN', x: undefined, c: undefined });
  assert.equal(fromTuple(['ABC', 'x', 'EU']), null);
});
