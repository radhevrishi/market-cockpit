// zzz894 — Transformational Contracts: duplicates and non-contracts. Titles are the ones on the owner's screen (Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyCr, capacityMw, sameContract, dedupeContracts, isNotAContract } from '../news/transformational-dedup';

const it = (title: string, d: string, t?: string) => ({ title, published_at: `${d}T08:00:00Z`, primary_ticker: t ?? null, ticker_symbols: t ? [t] : [] });
test('money and capacity normalised', () => {
  assert.equal(moneyCr('Bondada Engineering secures Rs 13.38 billion contract'), 1338);
  assert.equal(moneyCr('Bondada Engineering gains after securing Rs 1,338 crore NTPC'), 1338);
  assert.equal(moneyCr('Cabinet Approves ₹1.86 Lakh Crore Green Energy Corridor'), 186000);
  assert.equal(capacityMw('NHPC and CSPDCL ink PPA for 1.72 GW Kamala hydro project'), 1720);
});
test('the same deal worded differently, or on either side of a day boundary, is one row', () => {
  assert.ok(sameContract(it('Bondada Engineering secures Rs 13.38 billion contract for solar-plus-storage project from NTPC', '2026-06-17'), it('Bondada Engineering gains after securing Rs 1,338 crore NTPC Renewable solar and BESS project', '2026-06-16')));
  assert.ok(sameContract(it('NHPC and CSPDCL ink PPA for 1.72 GW Kamala hydro project in Arunachal Pradesh', '2026-07-21'), it('NHPC and CSPDCL ink PPA for 1.72 GW Kamala hydro project in Arunachal Pradesh', '2026-07-20')));
});
test('different deals stay separate', () => {
  assert.ok(!sameContract(it('NHPC and TSECL sign PPA for 1,720 MW Kamala hydro project', '2026-07-15'), it('NHPC and UPPCL sign PPA for 260 MW Dulhasti Stage-II hydro project', '2026-06-29')));
  assert.ok(!sameContract(it('Applied Digital announces $7.5B 15-year hyperscaler AI lease — Delta Forge 1', '2026-04-23'), it('Applied Digital secures $5B Polaris Forge 2 hyperscaler AI lease', '2025-10-22')));
});
test('tenders, talks, forecasts and financing are not contracts', () => {
  for (const t of ['POWERGRID invites bids for 265 MW/530 MWh BESS in Haryana', 'NTPC REL floats 600 MW wind turbine supply tender', 'HAL Advances GE-414 Engine Talks As India Speeds Up AMCA Fighter Project', "US' Holtec eyes tie-ups with NTPC, Vedanta to build nuclear reactors", 'AI Data Center Boom Could Drive Fuel Cell Market to $30 Billion by 2030', 'ACME Solar secures Rs 2,646 crore project financing from REC Ltd', 'NHPC J&K project may get ₹18,700 cr subordinated debt', 'U.S. to lend $4.2 billion to Vistra to boost nuclear power output'])
    assert.ok(isNotAContract(t), t);
  for (const t of ['Hut 8 secures $9.8B 15-year AI data-center lease', 'Mazagon Dock secures ₹70,000 crore P75-Alpha submarine framework agreement', 'NHPC and CSPDCL ink PPA for 1.72 GW Kamala hydro project'])
    assert.ok(!isNotAContract(t), t);
  const r = dedupeContracts([it('NHPC and CSPDCL ink PPA for 1.72 GW Kamala hydro project', '2026-07-21'), it('NHPC and CSPDCL ink PPA for 1.72 GW Kamala hydro project', '2026-07-20'), it('POWERGRID invites bids for 265 MW BESS', '2026-08-28')], () => 1);
  assert.equal(r.items.length, 1); assert.equal(r.duplicates, 1); assert.equal(r.notContracts, 1);
});
