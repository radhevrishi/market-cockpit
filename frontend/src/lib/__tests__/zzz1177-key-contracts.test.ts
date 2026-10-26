// zzz1177 — Transformational Contracts shows only key contracts again (owner: "earlier it showed only key information").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showableContract, normName } from '../news/transformational-dedup';

const sv = (v: number | null) => ({ qualifies: true, contract_value_usd_m: v, flags: [] });
const listed = new Set(['NIBE', 'NHPC', 'RIOT', 'COALINDIA']);
const isL = (t: string) => listed.has(t);
const names = new Map([[normName('Riot Platforms, Inc.'), 'RIOT']]);
const caps = (t: string) => ({ NIBE: 180, COALINDIA: 28000, RIOT: 5000 } as Record<string, number>)[t] ?? null;
const it = (title: string, tickers: string[] = [], v: number | null = null) => ({ title, ticker_symbols: tickers, primary_ticker: tickers[0] ?? null, strategic_visibility: sv(v) });

test('general news is not a contract', () => {
  assert.equal(showableContract(it('Changing Flows: Nepal floods expose vulnerabilities and serve as a caution for India’s hydro projects', [], 167800), isL), null);
  assert.equal(showableContract(it('Cabinet nod sought to extend power fund for 5 years', [], 14000), isL), null);
  assert.equal(showableContract(it('Coal India bets ₹50,000 crore on life beyond coal', ['COALINDIA'], 6024), isL), null);
});

test('a real listed company is required; unit words are not tickers; the name finds the company', () => {
  assert.equal(showableContract(it('Power Grid emerges as successful bidder for 7.5 GW project', ['GW'], 3000), isL), null);
  const r: any = showableContract(it('Anthropic signs $9.1 billion, 20-year AI cloud deal with Bitcoin miner Riot Platforms', [], 9100), isL, names, caps);
  assert.deepEqual(r.ticker_symbols, ['RIOT']); assert.equal(r.contract_to_mcap_pct, 182);
});

test('a value is shown only when the headline states money; a contract under 2% of the company is left out', () => {
  const p: any = showableContract(it('NHPC and CSPDCL ink PPA for 1.72 GW Kamala hydro project', ['NHPC'], 5000), isL, undefined, caps);
  assert.equal(p.strategic_visibility.contract_value_usd_m, null); assert.equal(p.strategic_visibility.value_not_stated, true);
  assert.equal(showableContract(it('Coal India wins Rs 2,831 crore solar project order', ['COALINDIA'], 341), isL, undefined, caps), null);
  assert.ok(showableContract(it('Tata Advanced Systems, NIBE Bag Rs 1,577-Crore Defence Order', ['NIBE'], 190), isL, undefined, caps));
});
