// zzz848 — Guidance Upgrades LAYER B: real 120D window, persisted events, honest coverage wording, false-positive tightening.
// Part 1 is a SNAPSHOT of the pre-120D behaviour of 24H/3D/7D/14D/30D (fixtures below). It was generated BEFORE any change and must never move.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processCandidates, withinWindow, windowDays, mergeCandidates } from '../guidance-upgrades';
import {
  parseWindow, lookbackDays, processRaiseCandidates, dateList, istDateList, usSessionDates, noUpgradesMessage, noUpgradesNote, coverageLabel, computeCoverage,
  newsToCandidate, filingToCandidate, isRaiseCandidate, looksLikeGuidanceRaise, nonGuidanceRaiseSentence, sanitizeRaiseCandidate, collectSubjectOnly,
  buildCompanyIndex, loadUsSessions, withProvenance, tagOrigin, scanSummaryLine, LIVE_SCAN_MAX_DAYS,
} from '../guidance-upgrades-candidates';
import { scanIndia, scanUs, finaliseScan, type DayFetcher } from '../guidance-upgrades-scan';
import { mergeIntoStore, writeEventStore, readEventStore, storedCandidates, storeCoveredDays, eventsKey, emptyStore, sourceHash, EVENTS_MAX, STORE_MAX_CHARS, type SkeletonLike } from '../guidance-upgrades-ledger';
import type { GuCandidate, GuWindow } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-30T06:30:00Z');   // 12:00 IST
const day = (ago: number, h = 6): string => new Date(NOW.getTime() - ago * 86_400_000 - (6.5 - h) * 3_600_000).toISOString();
const dOnly = (ago: number): string => new Date(NOW.getTime() - ago * 86_400_000).toISOString().slice(0, 10);

const inRaise = (ago: number, name: string, ticker: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `news:${ticker}-${ago}`, ticker, company: `${name} Limited`, market: 'IN',
  title: `${name} raises FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore`,
  text: `${name} Limited now expects FY27 revenue of Rs 725-750 crore, up from Rs 600 crore earlier, driven by higher volumes.`,
  url: `https://www.livemint.com/companies/${ticker.toLowerCase()}-${ago}.html`, sourceName: 'Livemint Companies', publishedAt: day(ago), kind: 'NEWS', ...o,
});
const usRaise = (ago: number, name: string, ticker: string): GuCandidate => ({
  id: `usgraded:${ticker}:${dOnly(ago)}`, ticker, company: name, market: 'US',
  title: `${name} raises FY26 guidance`, text: `The company raised FY26 revenue guidance to $5.2 billion to $5.3 billion from $5.0 billion to $5.1 billion.`,
  url: `https://www.sec.gov/Archives/edgar/data/1/${ticker}-${ago}.htm`, sourceName: 'Company earnings release (SEC 8-K exhibit)', publishedAt: dOnly(ago), kind: 'RELEASE',
});
const OFFSETS = [0, 1, 2, 3, 5, 7, 8, 10, 14, 15, 20, 30, 31, 60, 80];
const inFix = OFFSETS.map((a, i) => inRaise(a, `Zed${String.fromCharCode(65 + i)}`, `ZZ${String.fromCharCode(65 + i)}IN`));
const usFix = OFFSETS.map((a, i) => usRaise(a, `Usco ${String.fromCharCode(65 + i)}`, `UU${String.fromCharCode(65 + i)}`));
const OLD_WINDOWS: GuWindow[] = ['24H', '3D', '7D', '14D', '30D'];
const tickers = (list: { ticker: string }[]) => list.map((e) => e.ticker).sort();
const noCtx = () => ({});

describe('1. existing windows are unchanged (snapshot)', () => {
  const SNAP_IN: Record<string, string[]> = {"24H": ["ZZAIN"], "3D": ["ZZAIN", "ZZBIN", "ZZCIN"], "7D": ["ZZAIN", "ZZBIN", "ZZCIN", "ZZDIN", "ZZEIN"], "14D": ["ZZAIN", "ZZBIN", "ZZCIN", "ZZDIN", "ZZEIN", "ZZFIN", "ZZGIN", "ZZHIN"], "30D": ["ZZAIN", "ZZBIN", "ZZCIN", "ZZDIN", "ZZEIN", "ZZFIN", "ZZGIN", "ZZHIN", "ZZIIN", "ZZJIN", "ZZKIN"]};
  const SNAP_US: Record<string, string[]> = {"24H": ["UUA", "UUB"], "3D": ["UUA", "UUB", "UUC", "UUD"], "7D": ["UUA", "UUB", "UUC", "UUD", "UUE", "UUF"], "14D": ["UUA", "UUB", "UUC", "UUD", "UUE", "UUF", "UUG", "UUH", "UUI"], "30D": ["UUA", "UUB", "UUC", "UUD", "UUE", "UUF", "UUG", "UUH", "UUI", "UUJ", "UUK", "UUL"]};
  for (const w of OLD_WINDOWS) {
    test(`${w}: India events (by event date) equal the pre-120D snapshot`, () => {
      assert.deepEqual(tickers(processRaiseCandidates(inFix, noCtx, NOW, w)), SNAP_IN[w]);
    });
    test(`${w}: US events equal the pre-120D snapshot`, () => {
      assert.deepEqual(tickers(processCandidates(usFix, noCtx, NOW, w)), SNAP_US[w]);
    });
  }
  test('lookback / windowDays / date-list lengths for the old windows are unchanged', () => {
    assert.deepEqual(OLD_WINDOWS.map(lookbackDays), [1, 3, 7, 14, 30]);
    assert.deepEqual(OLD_WINDOWS.map(windowDays), [1, 3, 7, 14, 30]);
    assert.deepEqual([1, 2, 3, 7, 14, 30].map((d) => [dateList(NOW, d).length, istDateList(NOW, d).length, usSessionDates(NOW, d).length]), [[1, 1, 3], [2, 2, 3], [3, 3, 3], [7, 7, 7], [14, 14, 12], [30, 30, 23]]);
    assert.equal(parseWindow(null), '7D'); assert.equal(parseWindow('bogus'), '7D'); assert.equal(parseWindow('30d'), '30D');
  });
  test('withinWindow table for the old windows is unchanged', () => {
    const t = OLD_WINDOWS.map((w) => [0, 1, 3, 7, 8, 14, 15, 30, 31, 80].map((a) => withinWindow(dOnly(a), w, NOW)));
    assert.deepEqual(t, [[true, true, false, false, false, false, false, false, false, false], [true, true, true, false, false, false, false, false, false, false], [true, true, true, true, false, false, false, false, false, false], [true, true, true, true, true, true, false, false, false, false], [true, true, true, true, true, true, true, true, false, false]]);
  });
  const okFetch: DayFetcher = async () => ({ ok: true, filings: [] });
  test('scanIndia / scanUs status numbers for the old windows are unchanged', async () => {
    const rows: any[] = [];
    for (const w of OLD_WINDOWS) {
      const d = lookbackDays(w);
      const a = await scanIndia({ now: NOW, days: d, fetchNse: okFetch, fetchBse: okFetch });
      const b = await scanUs({ now: NOW, days: d, warmSessions: 3, totalSessions: usSessionDates(NOW, d).length, fetchEdgar: async () => [] });
      rows.push([w, a.status.daysCovered, a.status.daysRequested, a.status.complete, a.status.sources.map((s) => `${s.name}:${s.state}`), b.status.daysCovered, b.status.daysRequested, b.status.complete, b.status.sources.map((s) => `${s.name}:${s.state}`)]);
    }
    assert.deepEqual(rows, [["24H", 2, 2, true, ["NSE announcements:COMPLETE", "BSE announcements:COMPLETE", "Scraped filings blob:NOT_RUN"], 3, 3, true, ["Graded results cache:COMPLETE", "SEC EDGAR 8-K (items 2.02/7.01):COMPLETE"]], ["3D", 3, 3, true, ["NSE announcements:COMPLETE", "BSE announcements:COMPLETE", "Scraped filings blob:NOT_RUN"], 3, 3, true, ["Graded results cache:COMPLETE", "SEC EDGAR 8-K (items 2.02/7.01):COMPLETE"]], ["7D", 7, 7, true, ["NSE announcements:COMPLETE", "BSE announcements:COMPLETE", "Scraped filings blob:NOT_RUN"], 3, 7, false, ["Graded results cache:PARTIAL", "SEC EDGAR 8-K (items 2.02/7.01):COMPLETE"]], ["14D", 14, 14, true, ["NSE announcements:COMPLETE", "BSE announcements:COMPLETE", "Scraped filings blob:NOT_RUN"], 3, 12, false, ["Graded results cache:PARTIAL", "SEC EDGAR 8-K (items 2.02/7.01):COMPLETE"]], ["30D", 30, 30, true, ["NSE announcements:COMPLETE", "BSE announcements:COMPLETE", "Scraped filings blob:NOT_RUN"], 3, 23, false, ["Graded results cache:PARTIAL", "SEC EDGAR 8-K (items 2.02/7.01):COMPLETE"]]]);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const ALL_WINDOWS: GuWindow[] = ['24H', '3D', '7D', '14D', '30D', '120D'];
const SRC = join(__dirname, '..', '..');
const readSrc = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('2. window membership is by EVENT date, and 120D is a real window', () => {
  test('parseWindow / lookbackDays / windowDays know 120D', () => {
    assert.equal(parseWindow('120D'), '120D'); assert.equal(parseWindow(' 120d '), '120D');
    assert.equal(lookbackDays('120D'), 120); assert.equal(windowDays('120D'), 120);
  });
  test('an event 80 days old is in 120D only; an event from today is in every window', () => {
    const old = [inRaise(80, 'Oldco', 'OLDIN')]; const today = [inRaise(0, 'Todayco', 'TODIN')];
    for (const w of ALL_WINDOWS) {
      assert.equal(processRaiseCandidates(old, noCtx, NOW, w).length, w === '120D' ? 1 : 0, `old ${w}`);
      assert.equal(processRaiseCandidates(today, noCtx, NOW, w).length, 1, `today ${w}`);
    }
  });
  test('the same holds for US events', () => {
    for (const w of ALL_WINDOWS) {
      assert.equal(processCandidates([usRaise(80, 'Oldus', 'OLDU')], noCtx, NOW, w).length, w === '120D' ? 1 : 0, `old ${w}`);
      assert.equal(processCandidates([usRaise(0, 'Todayus', 'TODU')], noCtx, NOW, w).length, 1, `today ${w}`);
    }
  });
  test('membership grows monotonically with the window and uses the source date, not the insertion date', () => {
    const counts = ALL_WINDOWS.map((w) => processRaiseCandidates(inFix, noCtx, NOW, w).length);
    assert.deepEqual(counts, [1, 3, 5, 8, 11, 15]);
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1]);
    const e = processRaiseCandidates([inRaise(80, 'Oldco', 'OLDIN')], noCtx, NOW, '120D')[0];
    assert.equal(e.announcement_date, dOnly(80));                       // the source date, even though the event is first seen today
    assert.ok(!withinWindow(dOnly(121), '120D', NOW) && withinWindow(dOnly(120), '120D', NOW));
  });
  test('date lists reach 120 days for a long window and keep their old length for 30 days', () => {
    assert.equal(istDateList(NOW, 120).length, 120); assert.equal(dateList(NOW, 120).length, 120); assert.equal(istDateList(NOW, 121).length, 121);
    assert.ok(usSessionDates(NOW, 120).length >= 84 && usSessionDates(NOW, 120).length <= 90);
    assert.equal(istDateList(NOW, 500).length, 210);                    // hard bound (zzz874: MAX_LIST_DAYS 210)
  });
});

describe('3. persisted raise events: served for 120D after the live caches are gone', () => {
  const skel = (list: GuCandidate[]) => mergeCandidates(list);
  const oldRaise = inRaise(80, 'Oldco', 'OLDIN');
  test('write, read back, and the SAME engine rebuilds the 80-day-old event (120D only)', async () => {
    const r = mergeIntoStore(null, skel([oldRaise]), [dOnly(80)], NOW);
    assert.equal(r.added, 1); assert.equal(r.changed, true);
    assert.equal(await writeEventStore(r.store), true);
    const back = await readEventStore('IN');
    assert.ok(back && back.events.length === 1 && eventsKey('IN') === 'guidance-upgrades:events:v1:IN');
    const fromStore = storedCandidates(back);
    // the live caches are empty now: only the store feeds the engine
    assert.equal(processRaiseCandidates(fromStore, noCtx, NOW, '120D').length, 1);
    assert.equal(processRaiseCandidates(fromStore, noCtx, NOW, '30D').length, 0);
    assert.equal(processRaiseCandidates(fromStore, noCtx, NOW, '120D')[0].announcement_date, dOnly(80));
    assert.ok(storeCoveredDays(back).has(dOnly(80)));
  });
  test('idempotent: the same run again changes nothing and needs no write', () => {
    const a = mergeIntoStore(null, skel([oldRaise]), [dOnly(80)], NOW);
    const b = mergeIntoStore(a.store, skel([oldRaise]), [dOnly(80)], new Date(NOW.getTime() + 3_600_000));
    assert.equal(b.changed, false); assert.equal(b.added, 0); assert.equal(b.updated, 0);
    assert.equal(b.store.events.length, 1); assert.equal(b.store.updatedAt, a.store.updatedAt);
  });
  test('Reuters / Business Standard / Moneycontrol / NSE reports of one raise are ONE record with several sources and unique hashes', () => {
    const base = { ticker: 'CUPID', company: 'Cupid Limited', market: 'IN' as const, kind: 'NEWS' as const, publishedAt: day(2) };
    const t = 'Cupid raises FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore';
    const x = 'Cupid Limited now expects FY27 revenue of Rs 725-750 crore, up from Rs 600 crore earlier.';
    const list: GuCandidate[] = [
      { ...base, id: 'news:r1', title: t, text: x, sourceName: 'Reuters', url: 'https://www.reuters.com/markets/cupid-1' },
      { ...base, id: 'news:b1', title: `${t} - BS`, text: x, sourceName: 'Business Standard', url: 'https://www.business-standard.com/cupid-2' },
      { ...base, id: 'news:m1', title: `${t} | Moneycontrol`, text: x, sourceName: 'Moneycontrol', url: 'https://www.moneycontrol.com/cupid-3' },
      { ...base, id: 'filing:h1', title: 'Outcome of AGM and investor presentation', text: x, sourceName: 'NSE filing', url: 'https://nsearchives.nseindia.com/cupid.pdf', kind: 'FILING' },
      { ...base, id: 'news:r1b', title: t, text: x, sourceName: 'Reuters', url: 'https://www.reuters.com/markets/cupid-1' },   // the same link again
    ];
    const ev = processRaiseCandidates(list, noCtx, NOW, '7D');
    assert.equal(ev.length, 1, 'one canonical event');
    assert.ok(ev[0].sources.length >= 4, `sources: ${ev[0].sources.map((s) => s.name).join(',')}`);
    const r = mergeIntoStore(null, skel(list), [], NOW);
    assert.equal(r.store.events.length, 1);
    const hashes = r.store.events[0].sources.map((s) => s.hash);
    assert.equal(new Set(hashes).size, hashes.length);
    assert.equal(sourceHash({ url: 'https://www.reuters.com/markets/cupid-1?x=1' }), sourceHash({ url: 'https://www.reuters.com/markets/cupid-1' }));
    // a later run adds only the NEW source
    const again = mergeIntoStore(r.store, skel([...list, { ...base, id: 'news:et1', title: t, text: x, sourceName: 'Economic Times', url: 'https://economictimes.indiatimes.com/cupid-4' }]), [], NOW);
    assert.equal(again.updated, 1); assert.equal(again.store.events.length, 1); assert.equal(again.store.events[0].sources.length, hashes.length + 1);
  });
  test('bounded: newest EVENTS_MAX events, and a size guard that drops the oldest first', () => {
    const fake = (i: number, pad = ''): SkeletonLike => ({ guidance_event_id: `gu_${i}`, canonical_key: `k${i}`, ticker: `T${i}`, company: `C${i}`, market: 'IN',
      announcement_date: new Date(NOW.getTime() - (i % 300) * 86_400_000).toISOString().slice(0, 10), sources: [],
      candidates: [{ id: `c${i}`, market: 'IN', title: 'x', text: pad, sourceName: 's', publishedAt: dOnly(i % 300) }] });
    const many = Array.from({ length: EVENTS_MAX + 40 }, (_, i) => fake(i));
    assert.equal(mergeIntoStore(null, many, [], NOW).store.events.length, EVENTS_MAX);
    const fat = Array.from({ length: 500 }, (_, i) => ({ ...fake(i, 'y'.repeat(1200)), candidates: Array.from({ length: 8 }, (_, j) => ({ id: `c${i}-${j}`, market: 'IN' as const, title: 't', text: 'y'.repeat(2000), sourceName: 's', publishedAt: dOnly(i % 300) })) }));
    const r = mergeIntoStore(null, fat, [], NOW);
    assert.ok(JSON.stringify(r.store).length <= STORE_MAX_CHARS); assert.ok(r.store.events.length < 500 && r.store.events.length > 0);
    assert.ok(r.store.events.every((e) => e.cands.every((c) => c.text.length <= 1200)));
  });
  test('a day is only recorded as processed when the caller says so, and old days expire', () => {
    const r = mergeIntoStore(emptyStore('IN', NOW), [], [dOnly(3), dOnly(500), 'junk'], NOW);
    assert.deepEqual(Object.keys(r.store.covered), [dOnly(3)]);
  });
  test('storage keys and retention in the route: candidates kept >= 130 days, cap 600, events store key, no 120-day scrape', () => {
    const r = readSrc('app/api/v1/guidance-upgrades/route.ts').replace(/\/\/.*$/gm, '');
    assert.match(r, /RETAINED_DAYS = 130/); assert.match(r, /RETAINED_MAX = 600/); assert.match(r, /guidance-upgrades:in-candidates:v1/);
    for (const k of ['readEventStore(', 'mergeIntoStore(', 'writeEventStore(', 'storedCandidates(', 'storeCoveredDays(', 'noUpgradesNote(', 'loadUsSessions(usDates']) assert.ok(r.includes(k), k);
    assert.ok(!/No upgrades found/i.test(r));
    assert.match(readSrc('lib/guidance-upgrades-ledger.ts'), /guidance-upgrades:events:v1:\$\{m\}/);
  });
});

describe('4. honest coverage: x/120 days, bounded live scan', () => {
  const okFetch = (calls: string[]): DayFetcher => async (d) => { calls.push(d); return { ok: true, filings: [] }; };
  test('120D India: the live scan reads at most 30 days, reports 30/120 and says incomplete', async () => {
    const nse: string[] = []; const bse: string[] = [];
    const r = await scanIndia({ now: NOW, days: 120, window: '120D', fetchNse: okFetch(nse), fetchBse: okFetch(bse) });
    assert.ok(nse.length <= LIVE_SCAN_MAX_DAYS && bse.length <= LIVE_SCAN_MAX_DAYS, `nse calls ${nse.length}`);
    assert.equal(r.status.daysRequested, 120); assert.equal(r.status.daysCovered, 30); assert.equal(r.status.missingDaysCount, 90);
    assert.equal(r.status.complete, false); assert.equal(r.status.status, 'PARTIAL');
    assert.equal(r.status.coverageLabel, 'Coverage: 30/120 days — 120D coverage incomplete');
    assert.match(r.status.note, /SCAN INCOMPLETE/); assert.match(r.status.note, /Coverage: 30\/120 days — 120D coverage incomplete/); assert.match(r.status.note, /NOT a confirmation of no upgrades/);
    assert.ok(r.status.sources.some((x) => x.name === 'Persisted event store' && x.state === 'NOT_AVAILABLE'));
    assert.equal(r.status.windowDays, 120); assert.ok((r.status.sourcesCount ?? 0) >= 2);
    assert.ok((r.liveDays || []).length === 30);
  });
  test('days the store already processed are not scanned again and do count as covered; all 120 covered only when nothing is missing', async () => {
    const all = istDateList(NOW, 120);
    const nse: string[] = [];
    const r = await scanIndia({ now: NOW, days: 120, window: '120D', fetchNse: okFetch(nse), fetchBse: okFetch([]), storeCovered: new Set(all.slice(3)) });
    assert.equal(nse.length, 3);                                        // only the newest days are read again
    assert.equal(r.status.daysCovered, 120); assert.equal(r.status.missingDaysCount, 0); assert.equal(r.status.coverageLabel, 'Coverage: 120/120 days');
    assert.equal(r.status.complete, true); assert.equal(r.status.status, 'COMPLETE');
    // ...but still never COMPLETE while filings wait to be read
    const fin = finaliseScan(r.status, { found: 0, processed: 0, verified: 0, unprocessed: 102 });
    assert.equal(fin.complete, false); assert.equal(fin.status, 'PARTIAL'); assert.equal(fin.awaitingGrading, 102); assert.equal(fin.unprocessed, 102);
    assert.match(fin.note, /102 filings awaiting grading/);
  });
  test('a weekday without a graded results session is MISSING, a weekend is not; one failed source fails the scan', async () => {
    const all = istDateList(NOW, 120);
    const graded = new Set(all.filter((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; }).slice(1));   // newest weekday not graded
    const r = await scanIndia({ now: NOW, days: 120, window: '120D', fetchNse: okFetch([]), fetchBse: okFetch([]), storeCovered: new Set(all.slice(3)), gradedDays: graded });
    assert.equal(r.status.daysCovered, 119);
    assert.equal(r.status.missingDaysCount, 1);
    const bad: DayFetcher = async () => ({ ok: false, filings: [], reason: 'blocked' });
    const f = await scanIndia({ now: NOW, days: 120, window: '120D', fetchNse: bad, fetchBse: okFetch([]) });
    assert.equal(f.status.complete, false); assert.ok(f.status.sources.some((x) => x.state === 'FAILED'));
  });
  test('a missing day is reported as missing, never as zero events', () => {
    const c = computeCoverage({ days: ['2026-09-30', '2026-09-29', '2026-09-28'], live: new Set(['2026-09-30']), store: new Set(['2026-09-28']) });
    assert.deepEqual([c.covered, c.missing], [['2026-09-30', '2026-09-28'], ['2026-09-29']]);
    assert.equal(coverageLabel(74, 120, '120D'), 'Coverage: 74/120 days — 120D coverage incomplete');
    assert.equal(coverageLabel(120, 120, '120D'), 'Coverage: 120/120 days');
    assert.equal(coverageLabel(5, 7, '7D'), 'Coverage: 5/7 days — 7D coverage incomplete');
  });
  test('120D US: sessions counted in calendar days (weekends need nothing), EDGAR read bounded, store supplies the rest', async () => {
    const sessions = usSessionDates(NOW, 120); const edgar: string[] = [];
    const warm = new Set(sessions.slice(0, 40));
    const r = await scanUs({ now: NOW, days: 120, window: '120D', warmSessions: warm.size, totalSessions: sessions.length, warmDates: warm, fetchEdgar: async (d) => { edgar.push(d); return []; } });
    assert.ok(edgar.length <= 24, `edgar calls ${edgar.length}`);
    assert.equal(r.status.daysRequested, 120); assert.ok(r.status.daysCovered < 120 && r.status.missingDaysCount! > 0);
    assert.equal(r.status.complete, false); assert.match(r.status.coverageLabel!, /^Coverage: \d+\/120 days — 120D coverage incomplete$/);
    assert.ok(r.status.sources.some((x) => x.state === 'PARTIAL'));
    const all = await scanUs({ now: NOW, days: 120, window: '120D', warmSessions: sessions.length, totalSessions: sessions.length, warmDates: new Set(sessions), fetchEdgar: async () => [], storeCovered: new Set(sessions) });
    assert.equal(all.status.daysCovered, 120); assert.equal(all.status.complete, true);
  });
  test('US 8-K filers with no graded row are counted as unprocessed and keep the scan incomplete', async () => {
    const sessions = usSessionDates(NOW, 7); const warm = new Set(sessions);
    const r = await scanUs({ now: NOW, days: 7, warmSessions: sessions.length, totalSessions: sessions.length, warmDates: warm, gradedTickers: new Set(['AAA']),
      fetchEdgar: async () => [{ form: '8-K', items: ['2.02'], ticker: 'AAA', company: 'A', filed: '', filing_url: '' }, { form: '8-K', items: ['2.02'], ticker: null, company: 'B', filed: '', filing_url: '' }] });
    assert.equal(r.status.complete, false); assert.equal(r.status.unprocessed, sessions.length); assert.equal(r.status.awaitingGrading, sessions.length);
  });
  test('loadUsSessions reads ~85 sessions in mget chunks of 15, four at a time, and reports the rest as cold when the budget ends', async () => {
    const dates = usSessionDates(NOW, 120); let inflight = 0; let peak = 0; const sizes: number[] = [];
    const mget = async (keys: string[]) => { inflight++; peak = Math.max(peak, inflight); sizes.push(keys.length); await new Promise((r) => setTimeout(r, 5)); inflight--; return keys.map(() => ({ by_tier: { STRONG: [] } })); };
    const r = await loadUsSessions(dates, ['v1'], mget, 15, { concurrency: 4, budgetMs: 5_000 });
    assert.equal(r.warm, dates.length); assert.equal(r.total, dates.length); assert.ok(peak <= 4 && Math.max(...sizes) <= 15, `peak ${peak}`);
    const slow = async (keys: string[]) => { await new Promise((x) => setTimeout(x, 40)); return keys.map(() => ({ by_tier: { STRONG: [] } })); };
    const cut = await loadUsSessions(dates, ['v1'], slow, 10, { concurrency: 1, budgetMs: 60 });
    assert.ok(cut.warm > 0 && cut.warm < dates.length, `warm ${cut.warm}`);      // honest: warm vs total
    assert.equal(cut.total, dates.length);
  });
});

describe('5. mandatory wording', () => {
  test('incomplete and zero: uses the real awaiting count; generic when unknown', () => {
    assert.equal(noUpgradesMessage({ window: '120D', complete: false, awaiting: 102 }), 'No additional verified upgrades found in currently processed sources. 102 filings remain awaiting grading.');
    assert.equal(noUpgradesMessage({ window: '7D', complete: false, awaiting: 1 }), 'No additional verified upgrades found in currently processed sources. 1 filing remains awaiting grading.');
    assert.equal(noUpgradesMessage({ window: '7D', complete: false }), 'No additional verified upgrades found in currently processed sources. Some filings may remain awaiting grading.');
    assert.equal(noUpgradesMessage({ window: '7D', complete: false, awaiting: null }), 'No additional verified upgrades found in currently processed sources. Some filings may remain awaiting grading.');
  });
  test('complete and zero is window specific', () => {
    assert.equal(noUpgradesMessage({ window: '120D', complete: true }), 'No verified upgrades found in the fully processed 120D source universe.');
    assert.equal(noUpgradesMessage({ window: '7D', complete: true }), 'No verified upgrades found in the fully processed 7D source universe.');
  });
  test('incomplete keeps the not-a-confirmation line; nothing ever says the bare phrase', () => {
    assert.match(noUpgradesNote({ window: '30D', complete: false, awaiting: 3 }), /Zero events shown is NOT a confirmation of no upgrades\.$/);
    assert.ok(!/NOT a confirmation/.test(noUpgradesNote({ window: '30D', complete: true })));
    for (const w of ALL_WINDOWS) for (const c of [true, false]) for (const a of [undefined, 0, 5]) assert.ok(!/(^|\s)No upgrades found/i.test(noUpgradesNote({ window: w, complete: c, awaiting: a })));
    for (const f of ['lib/guidance-upgrades-candidates.ts', 'lib/guidance-upgrades-scan.ts', 'lib/guidance-upgrades-ledger.ts', 'app/api/v1/guidance-upgrades/route.ts'])
      assert.ok(!/['"`]No upgrades found/i.test(readSrc(f)), f);
  });
  test('scan lines for a long window lead with the coverage label', () => {
    const line = scanSummaryLine({ market: 'IN', windowFrom: '', windowTo: '', complete: false, lastScanAt: '', sources: [{ name: 'NSE', state: 'COMPLETE', scanned: 1, detail: '' }], daysCovered: 30, daysRequested: 120, candidatesFound: 0, processed: 0, awaitingGrading: 0, unprocessed: 102, verified: 0, newestItemAt: null, note: '', windowDays: 120, coverageLabel: 'Coverage: 30/120 days — 120D coverage incomplete' }, { candidates: 0, verified: 0, events: 0, withConsensus: 0 });
    assert.match(line, /Coverage: 30\/120 days — 120D coverage incomplete/); assert.match(line, /102 filings awaiting grading/); assert.match(line, /NOT a confirmation of no upgrades/);
  });
});

describe('6. false positives: a company "raises" many things that are not its guidance', () => {
  const idx = buildCompanyIndex([{ symbol: 'RELIANCE', name: 'Reliance Industries Limited' }, { symbol: 'CUPID', name: 'Cupid Limited' }, { symbol: 'RENTOMOJO', name: 'Rentomojo Limited' }]);
  const news = (title: string, summary = '', src = 'BizStd Markets') => newsToCandidate({ id: `t-${title.slice(0, 12)}`, title, summary, source_name: src, source_url: 'https://www.business-standard.com/markets/x', published_at: '2026-09-30T05:00:00Z', region: 'IN' }, idx)!;
  const NOT_GUIDANCE: Array<[string, string]> = [
    ['Reliance Industries raises Rs 5,000 crore via NCDs', 'Reliance Industries Ltd raised Rs 5,000 crore through non-convertible debentures, with a positive outlook from rating agencies.'],
    ['Reliance Industries raises $3 billion loan from banks', ''],
    ['Reliance Industries raises funds through QIP', ''],
    ['Reliance Industries raises stake in Network18 to 75%', 'Reliance Industries has raised its stake in Network18. The deal closes in Q3.'],
    ['Reliance Industries raises fuel prices at its petrol pumps', 'Reliance lifts petrol and diesel prices in select cities.'],
    ['Reliance lifts fuel prices, eyes better margin outlook', 'Reliance Industries lifts petrol and diesel prices in select cities.'],
    ['Reliance raises capex guidance for new energy', 'Reliance Industries now expects capex of Rs 75,000 crore in FY27, up from Rs 60,000 crore earlier.'],
    ['Reliance Industries hikes dividend to Rs 10', 'Reliance Industries Board recommended a dividend of Rs 10, raising payout from Rs 9. Management sees strong outlook.'],
    ['Reliance Industries raises its bid for assets', 'Reliance Industries raises its offer, valuing the asset at higher revenue target multiples.'],
    ['Reliance Industries raises target for Jio IPO', 'Reliance Industries raises target for the Jio listing, management said.'],
    ['Brokerage raises Reliance target to Rs 3,300', 'Jefferies raises FY27 earnings forecast for Reliance Industries; sees upside.'],
    ['Reliance Industries stock: Jefferies raises target to Rs 3,300', 'Jefferies raises FY27 earnings forecast for Reliance Industries; sees upside.'],
    ['Sensex, Nifty end higher as Reliance Industries raises outlook for refining', 'Markets rose as Reliance Industries and HDFC Bank led gains. Nifty raised its outlook for next week.'],
    ['Market wrap: Nifty ends higher as Reliance, HDFC Bank lift indices', 'Sensex gained 400 points as Reliance lifted the index.'],
  ];
  for (const [title, summary] of NOT_GUIDANCE) {
    test(`dropped: ${title}`, () => {
      const c = news(title, summary);
      assert.equal(isRaiseCandidate(c), false);
      assert.equal(processRaiseCandidates([c], noCtx, NOW, '7D').length, 0);
    });
  }
  test('the headline-level guard names the object, not the company', () => {
    for (const t of ['Reliance raises Rs 5,000 crore via bonds', 'Reliance raises stake in Network18', 'Reliance raises fuel prices', 'Reliance hikes capex plan', 'Reliance raises target for Jio IPO', 'Reliance raises dividend', 'Jefferies raises FY27 EBITDA forecast for Reliance', 'Sensex, Nifty rise as Reliance raises outlook'])
      assert.equal(nonGuidanceRaiseSentence(t), true, t);
    for (const t of ['Reliance raises FY27 revenue guidance to Rs 10 lakh crore from Rs 9 lakh crore', 'Cupid lifts FY27 guidance: revenue target now Rs 725-750 crore', 'Company raises full-year outlook', 'Reliance raises its FY27 EBITDA target', 'Reliance now expects FY27 revenue of Rs 10.5 lakh crore, up from Rs 9.8 lakh crore'])
      assert.equal(nonGuidanceRaiseSentence(t), false, t);
    assert.equal(looksLikeGuidanceRaise('Reliance raises target for Jio IPO'), false);
    assert.equal(looksLikeGuidanceRaise('Reliance raises FY27 revenue guidance'), true);
  });
  test('real company raises are kept and come back as the SAME object', () => {
    for (const [t, s] of [['Cupid raises FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore', 'Cupid Ltd now expects FY27 revenue of Rs 725-750 crore, up from Rs 600 crore earlier.'], ['Reliance Industries raises FY27 revenue guidance', 'Reliance Industries now expects FY27 revenue of Rs 10.5 lakh crore, up from Rs 9.8 lakh crore.'], ['Stocks to watch: Reliance raises FY27 outlook', '']] as const) {
      const c = news(t, s); assert.equal(isRaiseCandidate(c), true, t); assert.equal(sanitizeRaiseCandidate(c), c);
    }
    assert.equal(processRaiseCandidates([news('Cupid raises FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore', 'Cupid Ltd now expects FY27 revenue of Rs 725-750 crore, up from Rs 600 crore earlier.')], noCtx, NOW, '7D').length, 1);
  });
  test('a headline about funds but a body with a real raise keeps the real raise (title replaced)', () => {
    const c = news('Reliance raises Rs 2,000 crore via bonds', 'Reliance Industries now expects FY27 revenue of Rs 10.5 lakh crore, up from Rs 9.8 lakh crore.');
    const s = sanitizeRaiseCandidate(c)!; assert.ok(s && !/bonds/i.test(s.title) && /FY27/.test(s.title));
    assert.equal(processRaiseCandidates([c], noCtx, NOW, '7D').length, 1);
  });
  test('an exchange filing with only a subject line is "filing seen, raise text not read", not an event', () => {
    const f = (o: any = {}) => filingToCandidate({ exchange: 'NSE', symbol: 'RENTOMOJO', company_name: 'Rentomojo Limited', subject: 'Update on guidance and business outlook', category: 'Company Update', filing_datetime: '2026-09-30T04:00:00.000Z', attachment_urls: ['https://nsearchives.nseindia.com/x.pdf'], content_hash: 'h-rento', ...o }, idx)!;
    assert.equal(isRaiseCandidate(f()), false);
    assert.equal(processRaiseCandidates([f()], noCtx, NOW, '7D').length, 0);
    const so = collectSubjectOnly([f()]);                               // listed on the scan line instead
    assert.equal(so.length, 1); assert.equal(so[0].ticker, 'RENTOMOJO');
    // a subject that merely says "raising of funds" / "target" is administrative too
    assert.equal(isRaiseCandidate(f({ subject: 'Outcome of board meeting - raising of funds and revised targets', content_hash: 'h2' })), false);
    // with text that really says it, the same filing IS a raise candidate
    assert.equal(isRaiseCandidate(f({ detail: 'The company now expects FY27 revenue of Rs 725-750 crore, up from Rs 600 crore earlier.', content_hash: 'h3' })), true);
  });
});

describe('7. provenance: detected via / verified by', () => {
  test('verifiedBy names the primary source that confirmed the raise; unverified events have none; detectedVia is kept', () => {
    const us = processCandidates([usRaise(1, 'Usco P', 'UUP')], noCtx, NOW, '7D');
    assert.equal(us[0].verification, 'VERIFIED');
    const out = withProvenance(us);
    assert.match(out[0].v2!.verifiedBy!, /SEC/); assert.ok(out[0].v2!.detectedVia.length >= 1);
    const media = processRaiseCandidates([inRaise(1, 'Mediaco', 'MEDIN')], noCtx, NOW, '7D');
    assert.equal(withProvenance(media)[0].v2!.verifiedBy, undefined);
    assert.equal(withProvenance(us)[0].guidance_event_id, us[0].guidance_event_id);   // nothing else changes
  });
  test('origin says whether an event came from live sources, the store, or both', () => {
    const live = inRaise(2, 'Liveco', 'LIVIN'); const old = inRaise(80, 'Oldco', 'OLDIN');
    const ev = processRaiseCandidates([live, old], noCtx, NOW, '120D');
    const tagged = tagOrigin(ev, [live], [old, { ...live, id: 'news:stored-copy' }]);
    const by = Object.fromEntries(tagged.map((e) => [e.ticker, e.v2!.origin]));
    assert.deepEqual(by, { LIVIN: 'LIVE+STORE', OLDIN: 'STORE' });
  });
});
