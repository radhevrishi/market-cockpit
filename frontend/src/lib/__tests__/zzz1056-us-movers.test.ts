// zzz1056 — US Top Movers · Top Losers: the universe filter (caps / price / liquidity), the WHY's priority order, Q bounds,
// the session notice (pre-market / live / after the close / holidays), and US tickers kept apart from India ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterUsUniverse, topMovers, usSessionNotice, usMoversTtlMs, attributeUsMover, inMoveWindow, filingWhy, earningsWhyText,
  usMoveQuality, fundamentalsPart, sectorMoves, usBreadth, usWatchKeys, usKey, isPriceTalk, namesOtherTicker, whyCoverage,
  type UsQuoteRow, type FilingClass,
} from '../us-movers';
import { classifyUsFiling } from '../ai-gainers/us-gainers';
import { rowFromScanData, scanBody } from '../us-movers-server';

const here = dirname(fileURLToPath(import.meta.url));
const classify = (f: { subject: string }): FilingClass | null => {
  const c = classifyUsFiling(f);
  return c ? { kind: c.kind as FilingClass['kind'], category: (c.category as string) || null, routineReason: c.routineReason } : null;
};

const row = (o: Partial<UsQuoteRow>): UsQuoteRow => ({
  ticker: 'AAA', company: 'Alpha Corp', exchange: 'NASDAQ', chg: 5, price: 20, mcapM: 1_000, volume: 1e6, avgVol: 1e6, relVol: 2,
  sector: 'Technology Services', hi52: 25, perf1M: 8, sma50: 18, ...o,
});

// ── universe ──────────────────────────────────────────────────────────────
test('universe: small/mid band $300M–$30B, price ≥ $3, avg traded value ≥ $5M; unknowns dropped, not guessed', () => {
  const rows = [
    row({ ticker: 'OK', mcapM: 1_000 }),
    row({ ticker: 'TINY', mcapM: 250 }),
    row({ ticker: 'LARGE', mcapM: 45_000 }),
    row({ ticker: 'PENNY', price: 2.5 }),
    row({ ticker: 'THIN', avgVol: 100_000, price: 20 }),            // $2M a day
    row({ ticker: 'NOVOL', avgVol: null }),
    row({ ticker: 'NOCAP', mcapM: null }),
    row({ ticker: 'NOMOVE', chg: null }),
    row({ ticker: 'EDGE', mcapM: 30_000, price: 3, avgVol: 5e6 / 3 }),  // exactly on every bound → kept
  ];
  const r = filterUsUniverse(rows);
  assert.deepEqual(r.kept.map((x) => x.ticker).sort(), ['EDGE', 'OK']);
  assert.equal(r.dropped.cap, 3);
  assert.equal(r.dropped.price, 1);
  assert.equal(r.dropped.liquidity, 2);
  assert.equal(r.dropped.noMove, 1);
  const all = filterUsUniverse(rows, 'all');
  assert.ok(all.kept.some((x) => x.ticker === 'LARGE'), 'all caps includes large caps');
  assert.ok(!all.kept.some((x) => x.ticker === 'TINY' || x.ticker === 'PENNY' || x.ticker === 'THIN'), 'all caps keeps the junk filters');
});

test('top movers: gainers biggest first, losers biggest fall first, 20 each, a flat name in neither', () => {
  const rows = Array.from({ length: 50 }, (_, i) => row({ ticker: `T${i}`, chg: i - 25 }));
  const { gainers, losers } = topMovers(rows, 20);
  assert.equal(gainers.length, 20); assert.equal(losers.length, 20);
  assert.equal(gainers[0].chg, 24); assert.equal(losers[0].chg, -25);
  assert.ok(!gainers.concat(losers).some((x) => x.chg === 0));
});

// ── session notice ────────────────────────────────────────────────────────
test('session notice: pre-market shows the last close, live during 09:30–16:00 ET, after close = today, holidays + weekends', () => {
  // Thu 2026-10-15 08:00 ET (12:00Z, EDT) — pre-market → Wed 14th
  const pre = usSessionNotice(new Date('2026-10-15T12:00:00Z'));
  assert.equal(pre.phase, 'pre_market'); assert.equal(pre.live, false); assert.equal(pre.session, '2026-10-14');
  assert.match(pre.text, /Pre-market/); assert.match(pre.text, /LAST CLOSE/);
  // 11:00 ET → live, today
  const live = usSessionNotice(new Date('2026-10-15T15:00:00Z'));
  assert.equal(live.phase, 'regular'); assert.equal(live.live, true); assert.equal(live.session, '2026-10-15'); assert.equal(live.prevSession, '2026-10-14');
  assert.match(live.text, /^live/);
  // 17:00 ET → today's completed session
  const after = usSessionNotice(new Date('2026-10-15T21:00:00Z'));
  assert.equal(after.phase, 'after_hours'); assert.equal(after.session, '2026-10-15'); assert.match(after.text, /After the close/);
  // Thanksgiving 2026-11-26 (holiday) → the last close is Wed 25th
  const hol = usSessionNotice(new Date('2026-11-26T16:00:00Z'));
  assert.equal(hol.phase, 'closed_day'); assert.equal(hol.session, '2026-11-25'); assert.match(hol.text, /holiday/);
  // Black Friday 2026-11-27 closes 13:00 ET; 14:00 ET is after the close; prev session skips the holiday
  const bf = usSessionNotice(new Date('2026-11-27T19:00:00Z'));
  assert.equal(bf.phase, 'after_hours'); assert.equal(bf.session, '2026-11-27'); assert.equal(bf.prevSession, '2026-11-25');
  const bfLive = usSessionNotice(new Date('2026-11-27T16:00:00Z'));
  assert.equal(bfLive.closeEt, '13:00'); assert.match(bfLive.text, /13:00 ET close/);
  // Saturday → Friday's close, weekend
  const sat = usSessionNotice(new Date('2026-10-17T15:00:00Z'));
  assert.equal(sat.session, '2026-10-16'); assert.match(sat.text, /weekend/);
  // Monday pre-market → the previous session is Friday
  const mon = usSessionNotice(new Date('2026-10-19T12:00:00Z'));
  assert.equal(mon.session, '2026-10-16'); assert.equal(mon.prevSession, '2026-10-15');
  assert.equal(usMoversTtlMs('regular'), 180_000); assert.equal(usMoversTtlMs('pre_market'), 900_000);
});

// ── WHY priority ──────────────────────────────────────────────────────────
const base = { ticker: 'AAA', chg: 12, session: '2026-10-15', prevSession: '2026-10-14', closeEt: '16:00' };
const earn = { ticker: 'AAA', filing_date: '2026-10-14', quarter: 'Q3 FY26', sales_yoy_pct: 25.4, eps_yoy_pct: 40, tier: 'STRONG' };
const fil8k = { subject: '8-K: Material definitive agreement signed [Item 1.01] · filed 07:05 ET pre-market', url: 'https://www.sec.gov/x', dateIso: '2026-10-15T07:05:00-04:00' };
const offering = { subject: '424B5: Prospectus · filed 21:10 ET after hours', url: 'https://www.sec.gov/y', dateIso: '2026-10-14T21:10:00-04:00' };
const news = { title: 'Alpha Corp wins $200 million Navy contract', url: 'https://example.com/n', date: '2026-10-15', source: 'Reuters' };

test('WHY: earnings first, then SEC filing, then news, then sector, then an honest none', () => {
  const e = attributeUsMover({ ...base, earnings: earn, filings: [fil8k], news: [news], sector: 'Electronic Technology', sectorMovePct: 2 }, classify);
  assert.equal(e.kind, 'EARNINGS'); assert.equal(e.confidence, 'HIGH');
  assert.equal(e.text, 'rose on Q3 FY26 earnings · revenue +25% · EPS +40% · STRONG');
  const f = attributeUsMover({ ...base, filings: [fil8k], news: [news], sector: 'Electronic Technology', sectorMovePct: 2 }, classify);
  assert.equal(f.kind, 'FILING'); assert.match(f.text, /8-K filed/);
  const n = attributeUsMover({ ...base, filings: [], news: [news], sector: 'Electronic Technology', sectorMovePct: 2 }, classify);
  assert.equal(n.kind, 'NEWS'); assert.equal(n.text, news.title);
  const s = attributeUsMover({ ...base, filings: [], news: [], sector: 'Electronic Technology', sectorMovePct: 2 }, classify);
  assert.equal(s.kind, 'SECTOR'); assert.match(s.text, /sector rotation — Electronic Technology \+2\.0%/);
  const none = attributeUsMover({ ...base, filings: [], news: [], sector: 'Electronic Technology', sectorMovePct: -2 }, classify);
  assert.equal(none.kind, 'NONE'); assert.match(none.text, /no confirmed catalyst/); assert.match(none.text, /checked graded results, SEC filings, news/);
  // not looked up ≠ looked up and empty
  const unk = attributeUsMover({ ...base, filings: null, news: null }, classify);
  assert.equal(unk.kind, 'NONE'); assert.match(unk.text, /not checked/);
});

test('WHY: an offering on a fall is a dilution warning; a stale or after-close filing never explains the move', () => {
  const d = attributeUsMover({ ...base, chg: -18, filings: [offering, fil8k], news: [] }, classify);
  assert.equal(d.kind, 'DILUTION'); assert.match(d.text, /dilution/);
  const old = { ...fil8k, dateIso: '2026-10-13T08:00:00-04:00' };
  const afterClose = { ...fil8k, dateIso: '2026-10-15T16:30:00-04:00' };
  const prevDay = { ...fil8k, dateIso: '2026-10-14T10:00:00-04:00' };                 // moved the previous session, not this one
  assert.equal(attributeUsMover({ ...base, filings: [old, afterClose, prevDay], news: [] }, classify).kind, 'NONE');
  assert.equal(inMoveWindow('2026-10-14T16:05:00-04:00', '2026-10-15', '2026-10-14'), true);
  assert.equal(inMoveWindow('2026-10-17T09:00:00-04:00', '2026-10-19', '2026-10-16'), true);   // a weekend filing explains Monday
  assert.equal(inMoveWindow('2026-10-15', '2026-10-15', '2026-10-14'), true);                // date only
  assert.equal(inMoveWindow(null, '2026-10-15', '2026-10-14'), false);
  // routine paperwork is skipped
  assert.equal(filingWhy([{ subject: '8-K: Officer change [Item 5.02]', url: null, dateIso: '2026-10-15T08:00:00-04:00' }], 5, classify, base), null);
  // earnings outside the window do not count
  assert.notEqual(attributeUsMover({ ...base, earnings: { ...earn, filing_date: '2026-10-01' }, filings: [], news: [] }, classify).kind, 'EARNINGS');
});

test('WHY: price-only headlines are not reasons; an EPS swing reads in words', () => {
  assert.ok(isPriceTalk('Why Alpha Corp stock is soaring today'));
  assert.ok(isPriceTalk('Alpha Corp shares jump 15%'));
  assert.ok(!isPriceTalk('Alpha Corp wins $200 million Navy contract'));
  for (const junk of [
    'Form 4 Intapp Inc: Thad Jampol (Chief Product Officer) For: 12 October',
    'Quantum Corporation (QMCO) Stock Price, News, Quote & History',
    'Figure Technology Solutions (NASDAQ:FIGR) Sets New 12-Month Low',
    'Millennium Management Trims Capricor Therapeutics (CAPR) Stake by 43.29%',
    'Eastport Critical Metals Corp. to Present at the Precious Metals & Critical Minerals Virtual Investor Conference',
    'Appian Corporation (APPN) Options Chain',
    'TransUnion rallies 11% amid broad credit-reporting strength (TRU:NYSE)',
    'Not a market sale: Figure (FIGR) withheld 29,088 shares for stock-vesting taxes.',
    'Liberty Energy Inc. (LBRT) Stock Forecasts',
    'Atlas Energy Solutions (NYSE:AESI) Stock Price Down 7%',
    'Okeanis Eco Tankers (NYSE:ECO) Shares Gap Down',
    'Why Is Frontline plc (NYSE:FRO) Worth Examining Against the S&P 500 Benchmark?',
    'A10 Networks, Inc. (NYSE:ATEN) Stock Rated "Hold" by Wall Street Analysts',
  ]) assert.ok(isPriceTalk(junk), junk);
  assert.ok(!isPriceTalk('TDR Capital sells USD 202.40 million of Target Hospitality stock'));
  assert.notEqual(attributeUsMover({ ...base, filings: [], news: [{ ...news, title: 'Eastport Critical Metals Corp' }] }, classify).kind, 'NEWS');
  // another company's ticker tag → not this company's news; this company's own tag is fine
  assert.ok(namesOtherTicker('Why US Critical Metals Corp. (CN:USCM) Has Added an Arizona Copper Project', 'CRML'));
  assert.ok(!namesOtherTicker('Quantinuum in spotlight as Morgan Stanley upgrades (QNT:NASDAQ)', 'QNT'));
  assert.ok(!namesOtherTicker('Digital Turbine resumes coverage with Buy rating (NASDAQ:APPS)', 'APPS'));
  assert.ok(!namesOtherTicker('Alpha Corp wins a Navy contract', 'AAA'));
  for (const real of [
    'Quantinuum in spotlight as Morgan Stanley upgrades, names top quantum play (QNT:NASDAQ)',
    'Beazer Homes Stockholders Overwhelmingly Vote to Approve Dream Finders’ Acquisition of Beazer Homes',
    'FDA approves Verastem combination for ovarian cancer',
  ]) assert.ok(!isPriceTalk(real), real);
  const w = attributeUsMover({ ...base, filings: [], news: [{ ...news, title: 'Alpha Corp stock soars 12% today' }] }, classify);
  assert.notEqual(w.kind, 'NEWS');
  assert.equal(earningsWhyText({ ...earn, eps_yoy_pct: null, eps_swing: 'loss-to-profit', sales_yoy_pct: null }, -3), 'fell on Q3 FY26 earnings · EPS turned profitable · STRONG');
});

// ── Q ─────────────────────────────────────────────────────────────────────
test('Q: always an integer 0–100 with a label, whatever the inputs', () => {
  const extremes = [
    { chg: 50, relVol: 50, price: 100, hi52: 100, perf1M: 200, sma50: 50, sectorMovePct: 9, confidence: 'HIGH' as const, fund: { revQYoY: 300, opmTTM: 60, fcfm: 50, r40: 200, accG: 'A' } },
    { chg: -50, relVol: 0, price: 1, hi52: 100, perf1M: -90, sma50: 10, sectorMovePct: 9, confidence: 'LOW' as const, fund: { revQYoY: -90, opmTTM: -500, fcfm: -300, r40: -400, accG: 'E' } },
    { chg: 3, confidence: 'MEDIUM' as const },
    { chg: NaN, relVol: NaN, price: NaN, hi52: 0, perf1M: NaN, sma50: 0, sectorMovePct: NaN, confidence: 'LOW' as const, fund: {} },
  ];
  for (const x of extremes) {
    const q = usMoveQuality(x);
    assert.ok(Number.isInteger(q.q) && q.q >= 0 && q.q <= 100, `q=${q.q}`);
    assert.ok(['EXCELLENT', 'GOOD', 'WEAK', 'POOR'].includes(q.label));
  }
  assert.ok(usMoveQuality(extremes[0]).q > usMoveQuality(extremes[1]).q);
  assert.equal(usMoveQuality(extremes[0]).trend, 'up'); assert.equal(usMoveQuality(extremes[1]).trend, 'down');
  assert.equal(usMoveQuality(extremes[2]).trend, null);
  assert.equal(fundamentalsPart(null), 40); assert.equal(fundamentalsPart({}), 40);
  // a confirmed trigger scores higher than none, all else equal
  const a = usMoveQuality({ chg: 8, confidence: 'HIGH' }), b = usMoveQuality({ chg: 8, confidence: 'LOW' });
  assert.ok(a.q > b.q);
});

// ── breadth ───────────────────────────────────────────────────────────────
test('sector breadth: average move per sector (≥3 names), top / bottom, leaders and laggards', () => {
  const rows = [
    row({ ticker: 'A1', sector: 'Energy Minerals', chg: 4 }), row({ ticker: 'A2', sector: 'Energy Minerals', chg: 2 }), row({ ticker: 'A3', sector: 'Energy Minerals', chg: 3 }),
    row({ ticker: 'B1', sector: 'Health Technology', chg: -3 }), row({ ticker: 'B2', sector: 'Health Technology', chg: -1 }), row({ ticker: 'B3', sector: 'Health Technology', chg: -2 }),
    row({ ticker: 'C1', sector: 'Utilities', chg: 9 }),   // one name: not a sector reading
  ];
  const mv = sectorMoves(rows);
  assert.deepEqual(mv.map((m) => m.sector), ['Energy Minerals', 'Health Technology']);
  assert.equal(mv[0].avg, 3); assert.equal(mv[1].avg, -2);
  const br = usBreadth(mv, topMovers(rows).gainers, topMovers(rows).losers);
  assert.equal(br.top?.sector, 'Energy Minerals'); assert.deepEqual(br.leaders, ['A1', 'A3', 'A2']);
  assert.deepEqual(br.laggards, ['B1', 'B3', 'B2']);
});

// ── market-qualified tickers ──────────────────────────────────────────────
test('watchlist keys: only US items from the chart watchlists + the US bench; India rows never mark a US name', () => {
  const store = { lists: [{ id: 'l', name: 'x', sections: [{ id: 's', name: 'y', collapsed: false, items: [
    { m: 'IN', t: 'ABB' }, { m: 'US', t: 'nvda' }, { m: 'IN', t: 'TATVA' }, { m: 'US', t: 'AKAM' },
  ] }] }], activeId: 'l' };
  const keys = usWatchKeys(store, { 'PAYS@2026-08-01': {}, CRDO: {} });
  assert.ok(keys.has('US:NVDA') && keys.has('US:AKAM') && keys.has('US:PAYS') && keys.has('US:CRDO'));
  assert.ok(!keys.has('US:ABB') && !keys.has('US:TATVA') && !keys.has('ABB'));
  assert.equal(usKey('abb'), 'US:ABB');
  assert.equal(usWatchKeys('junk', [1, 2]).size, 0);
  assert.equal(usWatchKeys(null, null).size, 0);
});

test('the US panel never reads India stores; the scan is US exchange-listed common stock only', () => {
  const comp = readFileSync(join(here, '..', '..', 'app', '(dashboard)', '_home', 'UsMovers.tsx'), 'utf8');
  assert.ok(!/mc_watchlist_tickers|portfolioHoldings|getConvictionTickers\(/.test(comp), 'no India watchlist / portfolio / India CB reads');
  assert.match(comp, /\/api\/v1\/us-movers/);
  const body = scanBody();
  const ex = body.filter.find((f: any) => f.left === 'exchange') as any;
  assert.deepEqual(ex.right, ['NASDAQ', 'NYSE', 'AMEX']);
  const r = rowFromScanData(['vstm', 'Verastem, Inc.', 'NASDAQ', 19.7, 9.23, 835900541, 16912354, 4090714, 2.76, 'Health Technology', 10.82, 23.4, 7.56]);
  assert.equal(r?.ticker, 'VSTM'); assert.equal(Math.round(r!.mcapM!), 836); assert.equal(r?.sector, 'Health Technology');
  assert.equal(rowFromScanData('nope'), null);
  const page = readFileSync(join(here, '..', '..', 'app', '(dashboard)', 'page.tsx'), 'utf8');
  assert.equal((page.match(/<UsMovers \/>/g) || []).length, 1, 'mounted once on the home page');
});

test('coverage counts every kind', () => {
  const c = whyCoverage([{ why: { kind: 'NEWS' } }, { why: { kind: 'NONE' } }, { why: { kind: 'NEWS' } }] as any);
  assert.equal(c.NEWS, 2); assert.equal(c.NONE, 1); assert.equal(c.EARNINGS, 0);
});
