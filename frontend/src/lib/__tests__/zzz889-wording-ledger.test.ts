// zzz889 — management wording ledger. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toneOf, wordingLedger } from '../thesis/wording-ledger';

test('tone words', () => {
  assert.ok(toneOf('Demand remains robust and we see strong momentum').tone > 1);
  assert.ok(toneOf('We are seeing some softness and pricing pressure').tone < 0);
  assert.ok(toneOf('Demand is not robust at this point').tone < toneOf('Demand is robust').tone);
  assert.deepEqual(toneOf('Demand is stable, we will monitor').hedges, ['stable', 'monitor']);
});
const fact = (per: string, metric: string, quote: string, kind = 'MANAGEMENT_CLAIM') => ({ id: per + metric + quote.length, ticker: 'X', reporting_period: per, metric_name: metric, source_quote: quote, fact_or_management_statement: kind, source_name: `Concall ${per}`, source_date: null } as any);
const led = (periods: Record<string, any[]>) => ({ periods: Object.fromEntries(Object.entries(periods).map(([k, f]) => [k, { facts: f }])) } as any);
test('a cooling in demand wording is flagged with both quotes', () => {
  const w = wordingLedger(led({
    'Q4 FY26': [fact('Q4 FY26', 'volume', 'Demand remains very robust across all our segments with record volumes')],
    'Q1 FY27': [fact('Q1 FY27', 'volume', 'Demand has been soft this quarter and we see a slowdown in orders from customers')],
  }));
  assert.equal(w.periods, 2); assert.equal(w.shifts.length, 1);
  assert.equal(w.shifts[0].kind, 'COOLER'); assert.match(w.shifts[0].from.quote, /very robust/); assert.match(w.shifts[0].to.quote, /soft/);
  assert.match(w.summary, /Q1 FY27.*cooler/);
});
test('reported facts are not wording; one call only records', () => {
  const w = wordingLedger(led({ 'Q1 FY27': [fact('Q1 FY27', 'volume', 'Volumes grew 20% year on year to a record', 'FACT'), fact('Q1 FY27', 'margin', 'We are confident margins will expand further')] }));
  assert.deepEqual(w.topics.map((t) => t.topic), ['margin']);
  assert.match(w.summary, /Only one call on file/);
});
test('a confident word that disappears is flagged even when the average tone barely moves', () => {
  const w = wordingLedger(led({
    'Q4 FY26': [fact('Q4 FY26', 'guidance', 'We are confident of good growth in the coming year')],
    'Q1 FY27': [fact('Q1 FY27', 'guidance', 'We expect good growth in the coming year with healthy visibility')],
  }));
  assert.equal(w.shifts[0]?.kind, 'CONFIDENCE_DROPPED');
});
