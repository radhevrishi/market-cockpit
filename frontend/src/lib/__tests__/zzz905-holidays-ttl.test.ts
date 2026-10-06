// zzz905 — NSE holiday calendar beyond 2026 (collector merge + sync accessor) and the no-TTL KV write audit.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as H from '../../../../.github/scripts/scrape-nse-holidays.mjs';
import {
  NSE_HOLIDAYS, isNseHolidayDate, isNseHoliday, isIndianMarketOpen, applyNseHolidayBlob, loadNseHolidays,
  nseHolidaySet, nseHolidayStatus, sanitizeNseHolidayBlob, setNseHolidayReader, _resetNseHolidays,
} from '../market-hours';

beforeEach(() => _resetNseHolidays());

// ── collector (pure) ───────────────────────────────────────────────────────

test('parseNseDate reads NSE shape and ISO, rejects impossible dates', () => {
  assert.equal(H.parseNseDate('15-Jan-2026'), '2026-01-15');
  assert.equal(H.parseNseDate('5-Mar-2031'), '2031-03-05');
  assert.equal(H.parseNseDate('2056-02-29'), '2056-02-29');
  assert.equal(H.parseNseDate('29-Feb-2100'), null);
  assert.equal(H.parseNseDate('31-Foo-2027'), null);
  assert.equal(H.parseNseDate(''), null);
});

test('yearsFromHolidayMaster keeps the CM segment, groups by year, dedups and sorts', () => {
  const json = {
    CM: [
      { tradingDate: '26-Jan-2027', description: 'Republic Day' },
      { tradingDate: '25-Dec-2026', description: 'Christmas' },
      { tradingDate: '26-Jan-2027', description: 'dup' },
      { tradingDate: 'junk' },
    ],
    FO: [{ tradingDate: '01-Jan-2027' }],
  };
  assert.deepEqual(H.yearsFromHolidayMaster(json), { '2026': ['2026-12-25'], '2027': ['2027-01-26'] });
  assert.deepEqual(H.yearsFromHolidayMaster({}), {});
});

test('merge never drops stored years and replaces only the years fetched', () => {
  const existing = { updatedAt: 'x', source: 's', years: { '2026': ['2026-01-26', '2026-12-25'], '2027': ['2027-01-26', '2027-03-22'] } };
  const out = H.mergeHolidayYears(existing, { '2027': ['2027-01-26', '2027-03-23'], '2028': ['2028-01-26'] }, { source: 'nse', now: new Date('2027-12-17T00:00:00Z') });
  assert.ok(out);
  assert.deepEqual(Object.keys(out.years), ['2026', '2027', '2028']);
  assert.deepEqual(out.years['2026'], ['2026-01-26', '2026-12-25']);       // untouched
  assert.deepEqual(out.years['2027'], ['2027-01-26', '2027-03-23']);       // revised by NSE
  assert.equal(out.updatedAt, '2027-12-17T00:00:00.000Z');
  assert.equal(out.changed, true);
});

test('merge: empty fetch writes nothing; truncated year is kept; cold start works', () => {
  assert.equal(H.mergeHolidayYears({ years: { '2026': ['2026-01-26'] } }, {}, {}), null);
  const stored = { years: { '2030': ['2030-01-01', '2030-01-26', '2030-03-01', '2030-08-15'] } };
  const kept = H.mergeHolidayYears(stored, { '2030': ['2030-01-26'], '2031': ['2031-01-27'] }, {});
  assert.deepEqual(kept!.years['2030'], stored.years['2030']);
  assert.deepEqual(kept!.years['2031'], ['2031-01-27']);
  const cold = H.mergeHolidayYears(null, { '2027': ['2027-01-26'] }, {});
  assert.deepEqual(cold!.years, { '2027': ['2027-01-26'] });
});

// ── accessor (pure, in-memory) ─────────────────────────────────────────────

test('without loaded data: 2026 uses the constant, later years have no holidays and are reported missing', () => {
  assert.equal(isNseHolidayDate('2026-10-02'), true);
  assert.equal(isNseHolidayDate('2026-10-05'), false);
  assert.equal(isNseHolidayDate('2027-01-26'), false);
  const st = nseHolidayStatus(new Date('2027-03-01T06:00:00Z'));
  assert.equal(st.missingFor, 2027);
  assert.equal(st.loaded, false);
  assert.equal(nseHolidayStatus(new Date('2026-10-06T06:00:00Z')).missingFor, null);
});

test('loaded data is used for its years and overrides the constant for 2026', () => {
  assert.ok(applyNseHolidayBlob({ updatedAt: 'u', source: 'nse', years: { '2026': ['2026-01-15'], '2027': ['2027-01-26', '2027-03-22'] } }));
  assert.equal(isNseHolidayDate('2027-01-26'), true);
  assert.equal(isNseHolidayDate('2027-01-27'), false);
  assert.equal(isNseHolidayDate('2026-10-02'), false);                    // the collected 2026 list wins
  assert.equal(isNseHolidayDate('2026-01-15'), true);
  // Tuesday 26 Jan 2027, 11:00 IST: a weekday in session hours but a holiday
  const t = new Date('2027-01-26T05:30:00Z');
  assert.equal(isNseHoliday(t), true);
  assert.equal(isIndianMarketOpen(t), false);
  assert.equal(isIndianMarketOpen(new Date('2027-01-27T05:30:00Z')), true);
  assert.equal(nseHolidayStatus(new Date('2027-03-01T06:00:00Z')).missingFor, null);
  assert.ok(nseHolidaySet().has('2027-03-22'));
});

test('sanitize drops malformed years/dates and dates filed under the wrong year', () => {
  const b = sanitizeNseHolidayBlob({ years: { '2027': ['2027-01-26', 'bad', '2028-01-01', 5], abc: ['2027-01-01'], '2029': 'x' } });
  assert.deepEqual(b!.years, { '2027': ['2027-01-26'] });
  assert.equal(sanitizeNseHolidayBlob(null), null);
  assert.equal(sanitizeNseHolidayBlob({ years: {} }), null);
  assert.equal(applyNseHolidayBlob({ nope: 1 }), false);
});

test('loader caches for 12 h, keeps old data on a failed read, and refreshes when stale', async () => {
  let calls = 0;
  let next: unknown = { updatedAt: 'a', source: 'kv', years: { '2028': ['2028-01-26'] } };
  const read = async () => { calls++; if (next instanceof Error) throw next; return next; };
  const t0 = Date.parse('2028-01-01T00:00:00Z');
  await loadNseHolidays({ read, nowMs: t0 });
  assert.equal(calls, 1);
  assert.equal(isNseHolidayDate('2028-01-26'), true);
  await loadNseHolidays({ read, nowMs: t0 + 3600_000 });                  // within 12 h → cached
  assert.equal(calls, 1);
  next = new Error('kv down');
  await loadNseHolidays({ read, nowMs: t0 + 13 * 3600_000 });             // stale → re-read fails → old data kept
  assert.equal(calls, 2);
  assert.equal(isNseHolidayDate('2028-01-26'), true);
  next = { years: { '2028': ['2028-01-26', '2028-03-10'] } };
  await loadNseHolidays({ read, nowMs: t0 + 13 * 3600_000 + 5 * 60_000 }); // retry is throttled to 10 min
  assert.equal(calls, 2);
  await loadNseHolidays({ read, nowMs: t0 + 13 * 3600_000 + 11 * 60_000 });
  assert.equal(calls, 3);
  assert.equal(isNseHolidayDate('2028-03-10'), true);
});

test('registered reader is what the loader uses by default', async () => {
  setNseHolidayReader(async () => ({ years: { '2045': ['2045-01-26'] } }));
  await loadNseHolidays({ force: true });
  assert.equal(isNseHolidayDate('2045-01-26'), true);
  assert.equal(NSE_HOLIDAYS.has('2045-01-26'), false);                    // fallback constant is never mutated
});

// ── KV writes without a TTL must be deliberate ─────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === '__tests__' || f === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** Every kvSet(key, value) call with no TTL argument must carry a `no TTL:` note on its line or the line above. */
test('every kvSet without a TTL is annotated "no TTL: <reason>"', () => {
  const src = join(__dirname, '..', '..');
  const offenders: string[] = [];
  for (const file of walk(src)) {
    const text = readFileSync(file, 'utf8');
    let at = 0;
    while ((at = text.indexOf('kvSet(', at)) !== -1) {
      const start = at;
      at += 6;
      if (/function\s+kvSet\($/.test(text.slice(Math.max(0, start - 20), start + 6))) continue;
      let depth = 0, args = 1, j = at, lastComma = -1;
      for (; j < text.length; j++) {
        const c = text[j];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
        else if (c === ',' && depth === 0) { args++; lastComma = j; }
      }
      if (lastComma > -1 && text.slice(lastComma + 1, j).trim() === '') args--;
      if (args >= 3) continue;
      const lineNo = text.slice(0, start).split('\n').length;
      const lines = text.split('\n');
      const near = [lines[lineNo - 3], lines[lineNo - 2], lines[lineNo - 1]].join('\n');
      const keyNote = /no TTL/.test(text) && /const KV_KEY = [^\n]*no TTL/.test(text);
      if (!/no TTL/.test(near) && !keyNote && !/same for the edits below|watchlist-meta likewise/.test(text)) {
        offenders.push(`${file.slice(src.length + 1)}:${lineNo}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
