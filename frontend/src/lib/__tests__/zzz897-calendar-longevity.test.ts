// zzz897 — the earnings calendar's date logic must keep working for decades. Every test injects its own clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  istDateIso, istMonth, addDaysIso, addMonthsYm, monthBounds, daysBetween, weekdayOfIso, parseIsoDay,
  fiscalQuarterOf, expectedResultsQuarterOf, indianFiscalYear, fy2, resolveFyYear, parseQuarterLabel, fiscalQuarterEnd,
  lastWeekdayOfMonth, firstWeekdayOfMonth, firstBusinessDayOfMonth, calendarWindow, planCalendarWrites,
  calendarKeyTtlSeconds, recurringIndiaMacroEvents,
} from '../calendar-dates';
import { quarterEndDate, previousQuarter, isAcceptableQuarter } from '../earnings/quarter-window';
import { quarterEndIso } from '../india-eo-card-data';
import { BACKSTOP_JOBS, dueBackstops } from '../backstop-scheduler';

const at = (iso: string) => new Date(iso);

test('IST date: 00:00-05:30 IST is still the previous UTC day', () => {
  assert.equal(istDateIso(at('2026-10-05T19:00:00Z')), '2026-10-06');
  assert.equal(istDateIso(at('2026-10-05T18:29:00Z')), '2026-10-05');
  assert.equal(istMonth(at('2039-12-31T19:00:00Z')), '2040-01');           // New Year in India first
  assert.equal(istDateIso(at('2099-12-31T18:30:00Z')), '2100-01-01');
});

test('month arithmetic never overflows and crosses year and century ends', () => {
  assert.equal(addMonthsYm('2026-01', 1), '2026-02');                     // setMonth on Jan 31 gave March
  assert.equal(addMonthsYm('2026-10', 1), '2026-11');
  assert.equal(addMonthsYm('2039-12', 1), '2040-01');
  assert.equal(addMonthsYm('2056-03', 1), '2056-04');
  assert.equal(addMonthsYm('2099-12', 1), '2100-01');
  assert.equal(addMonthsYm('2100-01', -1), '2099-12');
  assert.equal(addMonthsYm('2056-04', -13), '2055-03');
});

test('month bounds and leap years (2056 leap, 2100 not)', () => {
  assert.deepEqual(monthBounds('2056-02'), { from: '2056-02-01', to: '2056-02-29', days: 29 });
  assert.deepEqual(monthBounds('2100-02'), { from: '2100-02-01', to: '2100-02-28', days: 28 });
  assert.deepEqual(monthBounds('2039-12'), { from: '2039-12-01', to: '2039-12-31', days: 31 });
  assert.equal(parseIsoDay('2100-02-29'), null);
  assert.ok(parseIsoDay('2056-02-29'));
  assert.equal(addDaysIso('2056-02-28', 1), '2056-02-29');
  assert.equal(addDaysIso('2099-12-31', 1), '2100-01-01');
  assert.deepEqual(daysBetween('2099-12-30', '2100-01-02'), ['2099-12-30', '2099-12-31', '2100-01-01', '2100-01-02']);
});

test('weekday is time-zone proof', () => {
  assert.equal(weekdayOfIso('2026-10-06'), 2);   // Tuesday
  assert.equal(weekdayOfIso('2100-01-01'), 5);   // Friday
  assert.equal(weekdayOfIso('2056-03-31'), 5);
});

test('Indian fiscal quarter of a date (Apr-Mar; Q1 = Apr-Jun)', () => {
  assert.equal(fiscalQuarterOf(2026, 10), 'Q3 FY27');
  assert.equal(fiscalQuarterOf(2056, 3), 'Q4 FY56');
  assert.equal(fiscalQuarterOf(2056, 4), 'Q1 FY57');
  assert.equal(fiscalQuarterOf(2099, 12), 'Q3 FY00');                    // FY2100
  assert.equal(fiscalQuarterOf(2100, 1), 'Q4 FY00');
  assert.equal(fiscalQuarterOf(2099, 3), 'Q4 FY99');
  assert.equal(indianFiscalYear(2099, 4), 2100);
  assert.equal(fy2(2100), '00');
  assert.equal(fy2(2009), '09');
});

test('results filed in a month are for the quarter that ended before it', () => {
  assert.equal(expectedResultsQuarterOf(2026, 10), 'Q2 FY27');
  assert.equal(expectedResultsQuarterOf(2026, 5), 'Q4 FY26');
  assert.equal(expectedResultsQuarterOf(2039, 12), 'Q2 FY40');
  assert.equal(expectedResultsQuarterOf(2040, 1), 'Q3 FY40');
  assert.equal(expectedResultsQuarterOf(2056, 3), 'Q3 FY56');
  assert.equal(expectedResultsQuarterOf(2056, 4), 'Q4 FY56');
  assert.equal(expectedResultsQuarterOf(2099, 12), 'Q2 FY00');
  assert.equal(expectedResultsQuarterOf(2100, 1), 'Q3 FY00');
  assert.equal(expectedResultsQuarterOf(2100, 5), 'Q4 FY00');
});

test('two-digit FY resolves to the nearest century', () => {
  assert.equal(resolveFyYear(27, at('2026-10-06T00:00:00Z')), 2027);
  assert.equal(resolveFyYear(50, at('2049-06-01T00:00:00Z')), 2050);      // `yy < 50 ? 20yy : 19yy` said 1950
  assert.equal(resolveFyYear(57, at('2056-04-01T00:00:00Z')), 2057);
  assert.equal(resolveFyYear(0, at('2099-12-15T00:00:00Z')), 2100);
  assert.equal(resolveFyYear(99, at('2100-01-05T00:00:00Z')), 2099);
  assert.deepEqual(parseQuarterLabel('Q1 FY2027'), { q: 1, fy: 2027 });   // four-digit FY was read as "FY20"
  assert.deepEqual(parseQuarterLabel('Q2 FY26E', at('2026-01-01T00:00:00Z')), { q: 2, fy: 2026 });
});

test('quarter end dates across centuries (quarter-window + card helper)', () => {
  assert.equal(quarterEndDate('Q4 FY27', at('2026-10-06T00:00:00Z'))!.toISOString().slice(0, 10), '2027-03-31');
  assert.equal(quarterEndDate('Q3 FY00', at('2099-12-20T00:00:00Z'))!.toISOString().slice(0, 10), '2099-12-31');
  assert.equal(quarterEndDate('Q1 FY57', at('2056-04-10T00:00:00Z'))!.toISOString().slice(0, 10), '2056-06-30');
  assert.equal(fiscalQuarterEnd(4, 2100).toISOString().slice(0, 10), '2100-03-31');
  assert.equal(quarterEndIso('Q1 FY27'), '2026-06-30');
});

test('previous quarter rolls FY00 back to FY99 (was "FY-1")', () => {
  assert.equal(previousQuarter('Q1 FY00'), 'Q4 FY99');
  assert.equal(previousQuarter('Q1 FY40'), 'Q4 FY39');
  assert.equal(previousQuarter('Q3 FY27'), 'Q2 FY27');
});

test('a late filer for the previous quarter is accepted across the 2099→2100 boundary', () => {
  // Q4 FY00 expected in May 2100; a Q3 FY00 (Dec 2099) filing on 10 Jan 2100 is the previous quarter, 10 days late.
  assert.equal(isAcceptableQuarter('Q3 FY00', 'Q4 FY00', at('2100-01-10T00:00:00Z')), true);
  assert.equal(isAcceptableQuarter('Q4 FY99', 'Q1 FY00', at('2099-05-10T00:00:00Z')), true);
  assert.equal(isAcceptableQuarter('Q4 FY99', 'Q1 FY00', at('2099-12-10T00:00:00Z')), false);   // > 120 days
});

test('calendar refresh window is anchored on the IST day', () => {
  assert.deepEqual(calendarWindow(at('2026-10-06T07:07:00Z')), { today: '2026-10-06', from: '2026-09-22', to: '2026-12-05' });
  assert.deepEqual(calendarWindow(at('2099-12-31T20:00:00Z'), 14, 60), { today: '2100-01-01', from: '2099-12-18', to: '2100-03-02' });
  assert.equal(calendarWindow(at('2056-03-31T19:00:00Z')).today, '2056-04-01');
});

test('write plan: both exchanges answered → moved meetings are cleared', () => {
  const win = { from: '2039-12-28', to: '2040-01-03' };
  const plan = planCalendarWrites(
    { '2040-01-02': ['ABC', 'XYZ'] },
    { '2039-12-30': ['ABC'], '2040-01-02': ['XYZ'] },
    win, true,
  );
  assert.deepEqual(plan, { '2039-12-30': [], '2040-01-02': ['ABC', 'XYZ'] });
});

test('write plan: one exchange down → merge, but a company now on another date leaves its old date', () => {
  const win = { from: '2056-03-28', to: '2056-04-05' };
  const plan = planCalendarWrites(
    { '2056-04-02': ['ABC'] },
    { '2056-03-30': ['ABC', 'NSEONLY'], '2056-04-02': ['OTHER'] },
    win, false,
  );
  assert.deepEqual(plan, { '2056-03-30': ['NSEONLY'], '2056-04-02': ['ABC', 'OTHER'] });
});

test('calendar key TTL outlives the look-ahead', () => {
  const now = at('2026-10-06T00:00:00Z');
  assert.equal(calendarKeyTtlSeconds('2026-12-05', now), (60 + 30) * 86400);   // a flat 30 days expired before a 60-day-ahead date
  assert.equal(calendarKeyTtlSeconds('2026-09-30', now), 30 * 86400);
});

test('recurring macro rules keep producing events decades out', () => {
  assert.equal(lastWeekdayOfMonth(2026, 10, 2), 27);
  assert.equal(lastWeekdayOfMonth(2099, 12, 2), 29);
  assert.equal(firstWeekdayOfMonth(2056, 4, 5), 7);
  assert.equal(firstBusinessDayOfMonth(2100, 1), 1);
  assert.equal(firstBusinessDayOfMonth(2039, 10), 3);   // 1 Oct 2039 is a Saturday
  const evs = recurringIndiaMacroEvents('2099-12-15', '2100-01-31');
  const expiry = evs.filter((e) => e.type === 'expiry').map((e) => e.date);
  assert.deepEqual(expiry, ['2099-12-29', '2100-01-26']);
  assert.ok(evs.some((e) => e.type === 'gst_release' && e.date === '2100-01-01' && e.title.includes('Dec 2099')));
  // a listed trading holiday moves the expiry one trading day earlier
  const withHol = recurringIndiaMacroEvents('2026-10-01', '2026-10-31', new Set(['2026-10-27']));
  assert.deepEqual(withHol.filter((e) => e.type === 'expiry').map((e) => e.date), ['2026-10-26']);
});

test('backstop hub ingests use the slot month, not the clock', () => {
  const hub = BACKSTOP_JOBS.find((j) => j.name === 'hub-ingest')!;
  const next = BACKSTOP_JOBS.find((j) => j.name === 'hub-ingest-next')!;
  const due = dueBackstops(at('2099-12-31T20:00:00Z'), [hub, next], {});
  assert.equal(due.length, 2);
  for (const d of due) assert.equal(d.slot.toISOString().slice(0, 10), '2099-12-31');
  assert.match(hub.path(due[0].slot), /month=2099-12$/);
  assert.match(next.path(due[1].slot), /month=2100-01$/);
  assert.match(hub.path(at('2039-12-31T18:07:00Z')), /month=2039-12$/);
  assert.match(next.path(at('2056-03-31T18:15:00Z')), /month=2056-04$/);
});
