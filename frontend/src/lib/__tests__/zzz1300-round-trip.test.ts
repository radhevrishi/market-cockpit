import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTripDealKeys, dealPartyKey } from '../deal-round-trip';

test('zzz1300 — same party buys and sells ~same quantity the same day = round trip (dropped)', () => {
  const d = [
    { symbol: 'APLAPOLLO', clientName: 'GRAVITON RESEARCH CAPITAL LLP', dealDate: '23-Nov-2026', type: 'Bulk', buySell: 'BUY', quantity: 1_700_000 },
    { symbol: 'APLAPOLLO', clientName: 'Graviton Research Capital LLP', dealDate: '23-Nov-2026', type: 'Bulk', buySell: 'SELL', quantity: 1_690_000 },
    { symbol: 'XYZ', clientName: 'SBI MUTUAL FUND', dealDate: '23-Nov-2026', type: 'Bulk', buySell: 'BUY', quantity: 500_000 },
    { symbol: 'XYZ', clientName: 'SBI MUTUAL FUND', dealDate: '23-Nov-2026', type: 'Bulk', buySell: 'SELL', quantity: 100_000 },
  ];
  const k = roundTripDealKeys(d);
  assert.ok(k.has(dealPartyKey(d[0])) && k.has(dealPartyKey(d[1])));
  assert.ok(!k.has(dealPartyKey(d[2])));   // a real net buy stays
});
