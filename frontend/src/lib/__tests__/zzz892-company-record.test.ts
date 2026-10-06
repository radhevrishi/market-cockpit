// zzz892 — one shared record per company. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCompanyRecord, normTicker } from '../company-record';

const NOW = new Date('2026-10-06T10:00:00Z');
test('ticker normalised; every store merged with its source; missing sections say why', () => {
  assert.equal(normTicker('nse:cupid.ns'), 'CUPID');
  const r = mergeCompanyRecord('CUPID', {
    benchIN: { entries: [{ ticker: 'CUPID', company: 'Cupid Limited', tier: 'STRONG', quarter: 'Q1 FY27', filing_date: '2026-09-22' }], updated_at: '2026-10-05T00:00:00Z' },
    universe: [{ entityKey: 'IN|CUPID', tickers: ['CUPID'], display: '+85–92%', metric: 'REVENUE', record: { ticker: 'CUPID', company: 'Cupid Limited', market: 'IN', primary: { period: 'FY27' }, verification: 'VERIFIED' } }, { tickers: ['OTHER'], record: { ticker: 'OTHER' } }],
    events: [{ ticker: 'CUPID', event_date: '2026-09-22', status: 'VERIFIED_UPGRADE', last_seen: '2026-10-06T09:00:00Z' }],
    extractions: [], tech: { symbols: {} },
  }, NOW);
  assert.equal(r.market, 'IN'); assert.equal(r.company, 'Cupid Limited');
  assert.equal(r.results.state, 'OK'); assert.equal(r.guidance.data!.length, 1); assert.equal(r.events.state, 'OK');
  assert.equal(r.extractions.state, 'NOT_FOUND'); assert.match(r.extractions.note!, /No company document/);
  assert.match(r.summary.join(' '), /STRONG \(Q1 FY27\)/);
});
test('a store that failed is UNAVAILABLE with its error, never shown as empty', () => {
  const r = mergeCompanyRecord('X', { errors: { events: 'Postgres timed out', extractions: 'Postgres timed out' } }, NOW);
  assert.equal(r.events.state, 'UNAVAILABLE'); assert.equal(r.events.note, 'Postgres timed out');
  assert.deepEqual(r.summary, ['Nothing on file for this company in any store.']);
});
