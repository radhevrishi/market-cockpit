import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeToday, exchangeClock, buildIcs, CURRENCY } from '../catalyst/exchange-time';

test('exchangeToday uses the exchange calendar day, not the browser day', () => {
  const t = new Date('2026-09-28T02:00:00Z'); // 22:00 on 27 Sep in New York, 07:30 on 28 Sep in Kolkata
  assert.equal(exchangeToday('US', t), '2026-09-27');
  assert.equal(exchangeToday('IN', t), '2026-09-28');
});
test('exchangeClock names the zone', () => {
  const t = new Date('2026-09-28T18:32:00Z');
  assert.match(exchangeClock('US', t), /ET|EDT|EST/);
  assert.match(exchangeClock('IN', t), /IST/);
});
test('currency badges are distinct', () => {
  assert.equal(CURRENCY.US.code, 'USD');
  assert.equal(CURRENCY.IN.code, 'INR');
});
test('buildIcs emits all-day events with CRLF and escaping', () => {
  const ics = buildIcs([{ date: '2026-10-05', ticker: 'ABC', summary: 'Results, Q2; call' }], new Date('2026-09-28T00:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261005'));
  assert.ok(ics.includes('Results\\, Q2\; call'));
  assert.ok(ics.includes('\r\n'));
  assert.ok(ics.trim().endsWith('END:VCALENDAR'));
});
