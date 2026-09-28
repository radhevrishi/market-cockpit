// zzz814 — India Earnings Opportunities multi-day window.
// Run: npx tsx --test src/lib/__tests__/zzz814-india-earnings-window.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IN_WINDOWS, parseWindowParam, parseWindowViewParam, withWindowParams,
  windowSessions, windowDates, isWeekend,
  mergeWindowDays, rowsByTier, sortByDate, sortByTier,
  windowProgress, nextToGrade, windowCsv, tradingViewList, companyKey,
  type WindowDay, type DayState,
} from '../india-earnings-window';
import { withSearchParam } from '../earnings-search';

type Row = { ticker: string; company: string; tier: string; composite_score: number; filing_date?: string; sales_yoy_pct?: number };
const r = (ticker: string, tier: string, score: number, company = ticker + ' Ltd'): Row => ({ ticker, company, tier, composite_score: score });
const day = (date: string, rows: Row[], extra: Partial<WindowDay<Row>> = {}): WindowDay<Row> => {
  const by_tier: Record<string, Row[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const x of rows) by_tier[x.tier].push({ ...x, filing_date: date });
  return { date, by_tier, ...extra };
};

describe('window date maths — IST trading sessions, weekends in between included', () => {
  test('the choices match the US page up to 60d', () => {
    assert.deepEqual([...IN_WINDOWS], [1, 3, 5, 10, 30, 60]);
  });

  test('sessions are Mon–Fri, counted back from the anchor (same meaning as the US window)', () => {
    // 2026-09-17 is a Thursday.
    assert.deepEqual(windowSessions('2026-09-17', 5), ['2026-09-17', '2026-09-16', '2026-09-15', '2026-09-14', '2026-09-11']);
    assert.equal(windowSessions('2026-09-17', 60).length, 60);
    assert.ok(windowSessions('2026-09-17', 60).every((d) => !isWeekend(d)));
  });

  test('mid-week window reads only the sessions', () => {
    assert.deepEqual(windowDates('2026-09-17', 3), ['2026-09-17', '2026-09-16', '2026-09-15']);
  });

  test('a window that spans a weekend also reads Saturday and Sunday (Indian companies file on them) — they do not count towards N', () => {
    // Mon 14 Sep, 3 sessions = Mon 14, Fri 11, Thu 10 → + Sun 13, Sat 12.
    assert.deepEqual(windowDates('2026-09-14', 3), ['2026-09-14', '2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10']);
  });

  test('1d is exactly the date the page is on — weekend or not (today\'s behaviour unchanged)', () => {
    assert.deepEqual(windowDates('2026-09-13', 1), ['2026-09-13']);
    assert.deepEqual(windowDates('2026-09-17', 1), ['2026-09-17']);
  });

  test('a weekend anchor keeps itself, then counts sessions back', () => {
    // Sun 13 Sep, 3d → sessions Fri 11, Thu 10, Wed 9; dates Sun 13 … Wed 9.
    assert.deepEqual(windowDates('2026-09-13', 3), ['2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10', '2026-09-09']);
  });

  test('60d ≈ three calendar months: 60 sessions + every weekend between them', () => {
    const d = windowDates('2026-09-25', 60);   // a Friday
    assert.equal(d.filter((x) => !isWeekend(x)).length, 60);
    assert.equal(d.length, 82);                  // Mon 6 Jul → Fri 25 Sep: 60 sessions + 11 weekends
    assert.equal(d[0], '2026-09-25');
    assert.equal(d[d.length - 1], '2026-07-06');  // a Monday
    // newest first, no gaps, no duplicates
    for (let i = 1; i < d.length; i++) assert.equal(Date.parse(d[i - 1]) - Date.parse(d[i]), 86_400_000);
  });

  test('dates after today are dropped (nothing is filed there yet)', () => {
    assert.deepEqual(windowDates('2026-09-30', 3, '2026-09-28'), ['2026-09-28']);
  });

  test('a bad anchor gives an empty window rather than throwing', () => {
    assert.deepEqual(windowDates('', 5), []);
    assert.deepEqual(windowDates('26-09-2026', 5), []);
  });
});

describe('?w= / ?wv= in the URL, alongside ?q=', () => {
  test('parse: anything unsupported falls back to 1d (the owner\'s current view)', () => {
    assert.equal(parseWindowParam('60'), 60);
    assert.equal(parseWindowParam('7'), 1);
    assert.equal(parseWindowParam(null), 1);
    assert.equal(parseWindowParam('abc'), 1);
    assert.equal(parseWindowViewParam('tier'), 'tier');
    assert.equal(parseWindowViewParam('x'), 'date');
  });

  test('set/remove keeps ?q= and the hash; 1d and the default view keep the URL plain', () => {
    assert.equal(withWindowParams('/earnings-opportunities?q=fcl#eo-card-X', 30), '/earnings-opportunities?q=fcl&w=30#eo-card-X');
    assert.equal(withWindowParams('/earnings-opportunities?q=fcl&w=30', 30, 'tier'), '/earnings-opportunities?q=fcl&w=30&wv=tier');
    assert.equal(withWindowParams('/earnings-opportunities?q=fcl&w=30&wv=tier', 1, 'tier'), '/earnings-opportunities?q=fcl');
    // and the search writer leaves ?w= alone
    assert.equal(withSearchParam('/earnings-opportunities?w=60&wv=tier', 'kaynes'), '/earnings-opportunities?w=60&wv=tier&q=kaynes');
  });
});

describe('merge across days + dedupe', () => {
  const days = [
    day('2026-09-25', [r('KAYNES', 'STRONG', 74), r('ALPHA', 'BLOCKBUSTER', 88)]),
    day('2026-09-24', [r('KAYNES', 'BLOCKBUSTER', 90), r('BETA', 'MIXED', 50)]),
    day('2026-09-20', [r('KAYNES', 'MIXED', 40), r('GAMMA', 'AVOID', 20)]),
  ];

  test('one row per company — the LATEST result wins, even when an earlier one graded higher', () => {
    const m = mergeWindowDays(days);
    assert.equal(m.length, 4);
    const k = m.find((x) => x.ticker === 'KAYNES')!;
    assert.equal(k._window_date, '2026-09-25');
    assert.equal(k.tier, 'STRONG');
    assert.equal(k.composite_score, 74);
  });

  test('says it also reported earlier (newest first)', () => {
    const k = mergeWindowDays(days).find((x) => x.ticker === 'KAYNES')!;
    assert.deepEqual(k._also_reported, ['2026-09-24', '2026-09-20']);
    assert.deepEqual(mergeWindowDays(days).find((x) => x.ticker === 'ALPHA')!._also_reported, []);
  });

  test('the order days arrive in does not matter (days land progressively)', () => {
    const a = mergeWindowDays(days).map((x) => `${x.ticker}@${x._window_date}`).sort();
    const b = mergeWindowDays([days[2], days[0], days[1]]).map((x) => `${x.ticker}@${x._window_date}`).sort();
    assert.deepEqual(a, b);
  });

  test('cross-exchange duplicate (NSE ticker vs BSE scrip code, same company) collapses to the NSE ticker', () => {
    const m = mergeWindowDays([
      day('2026-09-25', [r('543193', 'BLOCKBUSTER', 80, 'DJ Mediaprint & Logistics Ltd'), r('DJML', 'STRONG', 70, 'DJ Mediaprint & Logistics Limited')]),
    ]);
    assert.equal(m.length, 1);
    assert.equal(m[0].ticker, 'DJML');
    assert.equal(companyKey({ ticker: 'X', company: 'The Foo Co. Ltd' }), companyKey({ ticker: 'Y', company: 'foo' }));
  });

  test('a day graded under the previous rules is kept and labelled, not dropped', () => {
    const m = mergeWindowDays([day('2026-09-25', [r('OLD', 'STRONG', 70)], { engine_stale: true, engine: 'v22' })]);
    assert.equal(m[0]._engine_stale, true);
    assert.equal(m[0]._engine, 'v22');
  });

  test('empty / missing days are fine', () => {
    assert.deepEqual(mergeWindowDays([day('2026-09-27', []), { date: '2026-09-26', by_tier: null }]), []);
  });

  test('rowsByTier regroups for the counts and chips', () => {
    const t = rowsByTier(mergeWindowDays(days));
    assert.deepEqual(t.BLOCKBUSTER.map((x) => x.ticker), ['ALPHA']);
    assert.deepEqual(t.STRONG.map((x) => x.ticker), ['KAYNES']);
    assert.equal(t.MIXED.length + t.AVOID.length, 2);
  });
});

describe('sort orders', () => {
  const merged = mergeWindowDays([
    day('2026-09-25', [r('S1', 'STRONG', 70), r('B1', 'BLOCKBUSTER', 80), r('M1', 'MIXED', 60), r('B2', 'BLOCKBUSTER', 95)]),
    day('2026-09-26', [r('A1', 'AVOID', 10), r('B3', 'BLOCKBUSTER', 85)]),
    day('2026-09-22', [r('B4', 'BLOCKBUSTER', 99), r('S2', 'STRONG', 90)]),
  ]);

  test('by date: newest date first; inside a day BLOCKBUSTER → STRONG → MIXED → AVOID, best score first', () => {
    const g = sortByDate(merged);
    assert.deepEqual(g.map((x) => x.date), ['2026-09-26', '2026-09-25', '2026-09-22']);
    assert.deepEqual(g[0].rows.map((x) => x.ticker), ['B3', 'A1']);
    assert.deepEqual(g[1].rows.map((x) => x.ticker), ['B2', 'B1', 'S1', 'M1']);
  });

  test('by tier: every BLOCKBUSTER first, newest first within the tier', () => {
    const g = sortByTier(merged);
    assert.deepEqual(g.map((x) => x.tier), ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']);
    assert.deepEqual(g[0].rows.map((x) => x.ticker), ['B3', 'B2', 'B1', 'B4']);
    assert.deepEqual(g[1].rows.map((x) => x.ticker), ['S1', 'S2']);
  });

  test('a filter\'s own order (e.g. cheapest P/E first) is used inside a tier', () => {
    const lowFirst = (a: any, b: any) => a.composite_score - b.composite_score;
    assert.deepEqual(sortByDate(merged, lowFirst)[1].rows.map((x) => x.ticker), ['B1', 'B2', 'S1', 'M1']);
  });
});

describe('progress state', () => {
  const dates = ['2026-09-26', '2026-09-25', '2026-09-24', '2026-08-12', '2026-08-11'];

  test('reading from the store', () => {
    const p = windowProgress(dates, {});
    assert.equal(p.loading, 5);
    assert.equal(p.done, false);
    assert.match(p.line, /^0 of 5 days ready · reading 5 from the graded store/);
  });

  test('honest line while grading, newest first', () => {
    const s: Record<string, DayState> = {
      '2026-09-26': 'ready', '2026-09-25': 'stale', '2026-09-24': 'ready',
      '2026-08-12': 'grading', '2026-08-11': 'queued',
    };
    const p = windowProgress(dates, s);
    assert.equal(p.ready, 3);
    assert.equal(p.grading, '2026-08-12');
    assert.equal(p.line, '3 of 5 days ready · grading 12 Aug… · 1 waiting to be graded · 1 graded under the previous rules');
    assert.equal(p.done, false);
  });

  test('the queue picks the newest date still waiting; nothing already graded is picked', () => {
    const s: Record<string, DayState> = {
      '2026-09-26': 'ready', '2026-09-25': 'queued', '2026-09-24': 'stale', '2026-08-12': 'queued', '2026-08-11': 'failed',
    };
    assert.equal(nextToGrade(dates, s), '2026-09-25');
    assert.equal(nextToGrade(dates, { ...s, '2026-09-25': 'ready', '2026-08-12': 'ready' }), null);
  });

  test('done, with a failure named', () => {
    const s: Record<string, DayState> = { '2026-09-26': 'ready', '2026-09-25': 'ready', '2026-09-24': 'ready', '2026-08-12': 'ready', '2026-08-11': 'failed' };
    const p = windowProgress(dates, s);
    assert.equal(p.done, true);
    assert.equal(p.line, '4 of 5 days ready · 1 failed');
  });
});

describe('exports', () => {
  const merged = mergeWindowDays([
    day('2026-09-25', [{ ...r('KAYNES', 'STRONG', 74, 'Kaynes Technology, India'), sales_yoy_pct: 31.5 }]),
    day('2026-09-24', [r('KAYNES', 'BLOCKBUSTER', 90, 'Kaynes Technology, India'), r('543193', 'STRONG', 70, 'Some BSE Co')]),
  ]);

  test('CSV carries the date, the real company/YoY fields, and "also reported"', () => {
    const csv = windowCsv(sortByDate(merged).flatMap((g) => g.rows)).split('\n');
    assert.equal(csv[0].split(',')[0], 'Date');
    assert.equal(csv.length, 3);
    assert.ok(csv[1].startsWith('2026-09-25,STRONG,KAYNES,"Kaynes Technology, India",'));
    assert.ok(!csv[0].includes('Score'));   // zzz820b — no 0–100 score columns
    assert.ok(csv[1].includes(',31.5,'));
    assert.ok(csv[1].includes(',2026-09-24,current,'));
  });

  test('TradingView list: NSE: prefix, BSE: for scrip codes, unique, in order', () => {
    assert.equal(tradingViewList([...sortByDate(merged).flatMap((g) => g.rows), { ticker: 'kaynes' }]), 'NSE:KAYNES,BSE:543193');
  });
});

describe('page wiring (source checks)', () => {
  const page = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities', 'page.tsx'), 'utf8');
  test('page.tsx still has only the default export (Next.js page rule)', () => {
    const named = page.split('\n').filter((l) => /^export\s/.test(l) && !/^export default function/.test(l));
    assert.deepEqual(named, []);
  });
  test('the search is still wired and the window defaults to 1d', () => {
    assert.ok(page.includes('<EarningsSearch'));
    assert.ok(page.includes('useState<number>(1)'));
    assert.ok(page.includes('useIndiaEarningsWindow'));
  });
  test('the batched store read never grades', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'earnings', 'graded-window', 'route.ts'), 'utf8');
    assert.ok(route.includes('kvMGet'));
    assert.ok(!/gradeIndiaRow|\/enrich|kvSet/.test(route));
  });
});

// zzz815 — "by default, fresh should be at the top".
import { freshestFirst, filingTimeMs } from '../india-earnings-window';

describe('freshest first (default order everywhere)', () => {
  const t = (ticker: string, tier: string, score: number, date: string, time?: string) =>
    ({ ticker, company: ticker, tier, composite_score: score, filing_date: date, ...(time ? { filing_time_iso: time } : {}) });

  test('within a tier: latest filing time first, not score or alphabet', () => {
    const rows = [
      t('AAA', 'STRONG', 95, '2026-09-25', '2026-09-25T10:05:00+05:30'),
      t('ZZZ', 'STRONG', 60, '2026-09-25', '2026-09-25T17:40:00+05:30'),
      t('MMM', 'STRONG', 80, '2026-09-25', '2026-09-25T13:00:00+05:30'),
    ];
    assert.deepEqual(rows.slice().sort(freshestFirst).map((r) => r.ticker), ['ZZZ', 'MMM', 'AAA']);
  });

  test('no filing time → its filing date, and last within that date', () => {
    const rows = [
      t('NOTIME', 'STRONG', 99, '2026-09-25'),
      t('EARLY', 'STRONG', 10, '2026-09-25', '2026-09-25T09:20:00+05:30'),
      t('OLDER', 'STRONG', 99, '2026-09-24', '2026-09-24T23:00:00+05:30'),
      t('NEWDAY', 'STRONG', 5, '2026-09-26'),
    ];
    assert.deepEqual(rows.slice().sort(freshestFirst).map((r) => r.ticker), ['NEWDAY', 'EARLY', 'NOTIME', 'OLDER']);
  });

  test('a date-only string is not a time', () => {
    assert.equal(filingTimeMs({ filing_time_iso: '2026-09-25' }), null);
    assert.equal(filingTimeMs({ filing_iso: '2026-09-25T12:30:00Z' }), Date.parse('2026-09-25T12:30:00Z'));
  });

  test('window By date: newest date first, newest filing time first inside each tier of a day', () => {
    const merged = mergeWindowDays([
      { date: '2026-09-25', by_tier: { BLOCKBUSTER: [t('B_LATE', 'BLOCKBUSTER', 70, '2026-09-25', '2026-09-25T18:00:00+05:30'), t('B_EARLY', 'BLOCKBUSTER', 99, '2026-09-25', '2026-09-25T09:30:00+05:30')], STRONG: [t('S_NT', 'STRONG', 99, '2026-09-25'), t('S_T', 'STRONG', 50, '2026-09-25', '2026-09-25T11:00:00+05:30')] } },
      { date: '2026-09-26', by_tier: { MIXED: [t('M1', 'MIXED', 40, '2026-09-26')] } },
    ]);
    const g = sortByDate(merged);
    assert.deepEqual(g.map((x) => x.date), ['2026-09-26', '2026-09-25']);
    assert.deepEqual(g[1].rows.map((x) => x.ticker), ['B_LATE', 'B_EARLY', 'S_T', 'S_NT']);
  });

  test('window By tier: newest first within each tier (date, then time)', () => {
    const merged = mergeWindowDays([
      { date: '2026-09-24', by_tier: { BLOCKBUSTER: [t('OLD', 'BLOCKBUSTER', 99, '2026-09-24', '2026-09-24T20:00:00+05:30')] } },
      { date: '2026-09-25', by_tier: { BLOCKBUSTER: [t('NEW_AM', 'BLOCKBUSTER', 90, '2026-09-25', '2026-09-25T09:00:00+05:30'), t('NEW_PM', 'BLOCKBUSTER', 60, '2026-09-25', '2026-09-25T16:00:00+05:30')] } },
    ]);
    assert.deepEqual(sortByTier(merged)[0].rows.map((x) => x.ticker), ['NEW_PM', 'NEW_AM', 'OLD']);
    assert.deepEqual(rowsByTier(merged).BLOCKBUSTER.map((x) => x.ticker), ['NEW_PM', 'NEW_AM', 'OLD']);
  });

  test('single-date India tiers and the US page both sort freshest first by default', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities', 'page.tsx'), 'utf8');
    assert.ok(page.includes('applyRowFilters(view.by_tier[tier] || []).slice().sort(withinTierOrder)'));
    assert.ok(/: freshestFirst\(a, b\);/.test(page));
    const us = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'us-earnings-opportunities', 'page.tsx'), 'utf8');
    assert.ok(us.includes('out[t] = rows.slice().sort(freshestFirst);'));
    assert.ok(us.includes('resolveSearch'));   // zzz808 search untouched
  });
});
