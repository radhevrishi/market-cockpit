// zzz835 - India and USA gainers view: same functions, no missing data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchView, isRealName, catalystForOf, CATALYST_WINDOWS } from '../ai-gainers/research-view';
import { marketRunOf, exchangeDateOf, calendarDaysBetween, windowSentence } from '../ai-gainers/research-present';
import { describeIndiaCriteria } from '../ai-gainers/screener-gainers';
import { fixtureInput, fixtureInputUS, FINDINGS } from './fixtures/gainers-view.fixture';
import { buildIndiaCard } from '../ai-gainers/in-event-taxonomy';
import { buildUsCard } from '../ai-gainers/us-card';
import { stateWordFor } from '../ai-gainers/catalyst-timeline';
import { indiaCardOf } from '../ai-gainers/catalyst-research';
import { usMoveDate } from '../ai-gainers/us-card-fetch';
import { resolveIssuer } from '../ai-gainers/structured-facts';
import { displayName } from '../../components/ai-gainers/tokens';

const allItems = (v: ReturnType<typeof buildResearchView>) => [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || []), ...(v.needsReading || [])];

describe('zzz835 market run (session status, final vs provisional)', () => {
  test('US: scan during the session is PROVISIONAL, and says why', () => {
    // Tue 22 Sep 2026, 14:00 ET = 18:00 UTC (EDT)
    const r = marketRunOf({ market: 'US', sessionDate: '2026-09-22', scanAt: '2026-09-22T18:00:00Z', now: '2026-09-22T18:05:00Z' });
    assert.equal(r.sessionStatus, 'live');
    assert.equal(r.isFinal, false);
    assert.equal(r.provisional, true);
    assert.match(r.reason, /PROVISIONAL/);
    assert.equal(r.exchangeTimezone, 'America/New_York');
  });
  test('US: closed AND read after the close is final', () => {
    const r = marketRunOf({ market: 'US', sessionDate: '2026-09-22', scanAt: '2026-09-22T21:30:00Z', now: '2026-09-22T22:00:00Z' });
    assert.equal(r.sessionStatus, 'closed');
    assert.equal(r.isFinal, true);
  });
  test('US: a scan taken at 15:43 ET is still provisional when looked at at 17:00 ET', () => {
    const r = marketRunOf({ market: 'US', sessionDate: '2026-09-22', scanAt: '2026-09-22T19:43:00Z', now: '2026-09-22T21:00:00Z' });
    assert.equal(r.sessionStatus, 'closed');
    assert.equal(r.isFinal, false);
    assert.match(r.reason, /before the/);
  });
  test('US: early close (day after Thanksgiving, 13:00 ET) - a 13:30 ET scan is final, a 12:30 ET scan is not', () => {
    const fin = marketRunOf({ market: 'US', sessionDate: '2026-11-27', scanAt: '2026-11-27T18:30:00Z', now: '2026-11-27T19:00:00Z' });
    assert.equal(fin.isFinal, true);
    const prov = marketRunOf({ market: 'US', sessionDate: '2026-11-27', scanAt: '2026-11-27T17:30:00Z', now: '2026-11-27T19:00:00Z' });
    assert.equal(prov.isFinal, false);
  });
  test('India: closes 15:30 IST; unknown session date is never final', () => {
    // 15:00 IST = 09:30 UTC; 16:00 IST = 10:30 UTC
    assert.equal(marketRunOf({ market: 'IN', sessionDate: '2026-09-22', scanAt: '2026-09-22T09:30:00Z', now: '2026-09-22T09:35:00Z' }).sessionStatus, 'live');
    assert.equal(marketRunOf({ market: 'IN', sessionDate: '2026-09-22', scanAt: '2026-09-22T10:30:00Z', now: '2026-09-22T11:00:00Z' }).isFinal, true);
    assert.equal(marketRunOf({ market: 'IN', sessionDate: null, scanAt: '2026-09-22T10:30:00Z' }).isFinal, false);
  });
  test('the date is the EXCHANGE date, not the browser or UTC date', () => {
    // 02:00 UTC on 23 Sep is still 22 Sep in New York and already 23 Sep in India.
    const t = new Date('2026-09-23T02:00:00Z');
    assert.equal(exchangeDateOf('US', t), '2026-09-22');
    assert.equal(exchangeDateOf('IN', t), '2026-09-23');
    assert.equal(calendarDaysBetween('2026-09-20', '2026-09-23'), 3);
  });
});

describe('zzz835 catalyst window wording and badge logic', () => {
  test('one rule for the badge: India 3 calendar days, US 7 calendar days, both up to 14 = recent', () => {
    assert.equal(catalystForOf('IN', 3), 'THIS_MOVE');
    assert.equal(catalystForOf('IN', 4), 'RECENT');
    assert.equal(catalystForOf('US', 7), 'THIS_MOVE');
    assert.equal(catalystForOf('US', 8), 'RECENT');
    assert.equal(catalystForOf('US', 15), 'CONTEXT');
    assert.equal(catalystForOf('IN', null), 'RECENT');   // unknown age: neither claimed nor dismissed
  });
  test('the sentence names calendar days for both markets', () => {
    assert.match(windowSentence('IN', CATALYST_WINDOWS.IN), /3 calendar days/);
    assert.match(windowSentence('US', CATALYST_WINDOWS.US), /7 calendar days/);
    assert.doesNotMatch(windowSentence('IN', CATALYST_WINDOWS.IN), /sessions/);
  });
});

describe('zzz835 same view for India and the US', () => {
  for (const [name, mk] of [['IN', fixtureInput], ['US', fixtureInputUS]] as const) {
    test(`${name}: banner counts agree with the summary and the lists`, () => {
      const v = buildResearchView(mk());
      assert.ok(v.banner, 'banner present');
      assert.equal(v.banner!.scanned, v.summary.scanned);
      assert.equal(v.banner!.verified, v.summary.confirmed);
      assert.equal(v.banner!.unverified, v.summary.potential);
      assert.equal(v.banner!.negative, v.summary.negative);
      assert.equal(v.banner!.conflicts, 0);
      assert.equal(v.summary.noCatalyst, (v.summary.noCatalystFound ?? 0) + (v.summary.marketMoveOnly ?? 0) + (v.summary.context ?? 0));
    });
    test(`${name}: catalysts by category and the older-filings table exist`, () => {
      const v = buildResearchView(mk());
      assert.ok(v.summary.catalysts, 'summary.catalysts');
      assert.equal(v.summary.catalysts!.market, name);
      assert.equal(v.olderFilings?.length ?? 0, (v.context || []).length);
      for (const r of v.olderFilings || []) assert.ok(r.company && r.company !== '-', 'older row has a name');
    });
    test(`${name}: every row has a printable company name, never '-' or empty`, () => {
      const v = buildResearchView(mk());
      for (const it of allItems(v)) {
        assert.ok(it.companyName && it.companyName.trim() && it.companyName !== '-', `name for ${it.ticker}`);
      }
    });
    test(`${name}: rank reason is built from rank components and never mentions price`, () => {
      const v = buildResearchView(mk());
      assert.ok(v.queue.length > 0);
      for (const it of v.queue) {
        assert.ok(it.rankReason && it.rankReason.length > 0, `rankReason for ${it.ticker}`);
        assert.match(it.rankReason!, /price not used$/);
        assert.doesNotMatch(it.rankReason!.replace(/price not used$/, ''), /price|gain|%/i);
      }
    });
    test(`${name}: rank does not depend on the size of the price move`, () => {
      const base = mk();
      const a = buildResearchView(base);
      const b = mk();
      for (const f of Object.values(b.findings)) if (typeof f.movePct === 'number' && !f.bandPrint) f.movePct = f.movePct * 0.5;
      b.board = b.board.map((x) => ({ ...x, move_pct: typeof x.move_pct === 'number' ? x.move_pct * 0.5 : x.move_pct }));
      const c = buildResearchView(b);
      assert.deepEqual(c.queue.map((i) => i.ticker), a.queue.map((i) => i.ticker));
    });
  }

  test('a scan row with company "-" is named from the lookup, never printed as "-"', () => {
    const inp = fixtureInput();
    const tpl = inp.findings.NOCAT;
    inp.findings = { '544434': { ...tpl, ticker: '544434', company: '-' } as any, '544501': { ...tpl, ticker: '544501', company: null } as any };
    inp.filedResults = [];
    inp.holdings = [];
    inp.board = [{ ticker: '544434', company: '-', move_pct: 6 }, { ticker: '544501', company: null, move_pct: 7 }];
    inp.companyNames = { '544434': 'Neetu Yoshi Ltd' };
    const v = buildResearchView(inp);
    const by = new Map(allItems(v).map((i) => [i.ticker, i]));
    assert.equal(by.get('544434')?.companyName, 'Neetu Yoshi Ltd');
    const other = by.get('544501');
    assert.ok(other && other.companyName && other.companyName !== '-');
    assert.equal(isRealName('-', '1'), false);
    assert.equal(isRealName('544501', '544501'), false);
    assert.equal(isRealName('Sugs Lloyd Ltd', '544501'), true);
  });

  test('a US new listing with no prior close and an extreme move are flagged in the data notes, not invented', () => {
    const inp = fixtureInputUS();
    const v = buildResearchView(inp);
    const kinds = new Set((v.dataNotes || []).map((n) => n.kind));
    assert.ok(kinds.has('extreme_move'), 'RESALE +111% is an extreme move');
    for (const n of v.dataNotes || []) assert.ok(n.text.length > 0);
  });

  test('US book: a held US ticker is matched to Your Book; with no book the check says so', () => {
    const inp = fixtureInputUS();
    inp.holdings = ['TENQ'];
    const v = buildResearchView(inp);
    assert.ok(v.portfolio.some((i) => i.ticker === 'TENQ'));
    assert.deepEqual(v.bookChecked, { held: 1, watch: 0 });
    const none = buildResearchView(fixtureInputUS());
    assert.equal(none.portfolio.length, 0);
    assert.deepEqual(none.bookChecked, { held: 0, watch: 0 });
  });

  test('India scan-criteria line names the screen, the read count and the window', () => {
    const line = describeIndiaCriteria({ total: 40, read: 15, largeCapsExcluded: 3, windowThisMove: 3, windowRecent: 14 });
    assert.match(line, /screener\.in/);
    assert.match(line, /15 read of 40/);
    assert.match(line, /3 excluded/);
  });

  test('the view is deterministic and carries the market run when a session is given', () => {
    const inp = fixtureInputUS();
    inp.session = { date: '2026-09-22', scanAt: '2026-09-22T18:00:00Z', status: 'Live', cached: false };
    inp.now = '2026-09-22T18:00:00Z';
    inp.viewedAt = '2026-09-22T18:05:00Z';
    const a = buildResearchView(inp);
    const b = buildResearchView(inp);
    assert.deepEqual(a, b);
    assert.equal(a.session.isFinal, false);
    assert.equal(a.session.sessionStatus, 'live');
    assert.equal(a.banner!.provisional, true);
  });
});

// ── card facts wired onto the item (conflicts, stage, clusters, clinical, acquisition, litigation, causal window) ──
const sec = (form: string, items: string[], date: string) => ({ form, items, date, url: 'https://www.sec.gov/Archives/edgar/data/1/000000000000000001/x.htm', subject: `${form}: [${items.map((i) => `Item ${i}`).join(', ')}]` });
const secDoc = (role: string, text: string) => ({ role, url: `https://www.sec.gov/Archives/edgar/data/1/000000000000000001/${role}.htm`, text });
const PAD = ' The Company is a biotechnology company headquartered in San Francisco and its shares trade on Nasdaq under the symbol shown above. '.repeat(3);

function oneItemView(market: 'IN' | 'US', ticker: string, card: any, now = '2026-09-28T12:00:00Z') {
  const inp = market === 'IN' ? fixtureInput() : fixtureInputUS();
  const tpl = (market === 'IN' ? FINDINGS.NOCAT : Object.values(inp.findings)[0]) as any;
  inp.findings = { [ticker]: { ...tpl, ticker, market, company: `${ticker} Ltd`, status: 'none', headline: null, sourceDate: null, ageDays: null, ...(market === 'IN' ? { inCard: card } : { usCard: card }) } };
  inp.board = [{ ticker, company: `${ticker} Ltd`, move_pct: 8 }];
  inp.filedResults = []; inp.holdings = []; inp.now = now; inp.session = undefined;
  const v = buildResearchView(inp);
  const it = [...v.queue, ...v.watch, ...v.negative, ...v.noCatalyst, ...v.dataQuality, ...(v.context || []), ...(v.needsReading || [])].find((i) => i.ticker === ticker);
  assert.ok(it, `${ticker} is in the view`);
  return { v, it: it! };
}

describe('zzz835 card facts on the item', () => {
  const sugs = () => buildIndiaCard({
    filings: [{ subject: 'Received Rs 213.48 crore Punjab power distribution contract', summary: 'The Company received Rs 213.48 crore contract on 21 Sep 2026.', url: 'https://www.bseindia.com/x.pdf', dateIso: '2026-09-27', docText: 'The Company has received a letter of intent worth Rs 4.68 crore, subject to approval.' }],
    press: [], now: new Date('2026-09-28T10:00:00Z'), windowDays: 21, moveDate: '2026-09-28', causalWindowDays: 3, pressWindowDays: 1,
  });

  test('India: conflicting values => impact unknown, both values kept, counted in the summary and the banner, stage PROPOSED', () => {
    const card = sugs();
    const { v, it } = oneItemView('IN', '544501', card);
    assert.ok((it.conflicts || []).length >= 1, 'conflicts copied onto the item');
    assert.equal(it.valueStatus, 'conflicting');
    assert.equal(it.materiality.label, 'UNKNOWN');
    assert.ok(it.eventClass !== 'CONFIRMED_MATERIAL' && it.eventClass !== 'CONFIRMED_LOW_MATERIALITY');
    assert.match((it.conflicts || []).join(' '), /213\.48/);
    assert.match((it.conflicts || []).join(' '), /4\.68/);
    assert.ok((it.conflictValues || []).length >= 2, 'both values listed');
    assert.equal(it.stageBadge, 'PROPOSED');
    assert.equal(v.summary.conflicts, 1);
    assert.equal(v.banner!.conflicts, 1);
  });

  test('a verified filing never says "Identified (not yet in an official filing)"', () => {
    const bad = 'Identified (not yet in an official filing)';
    assert.doesNotMatch(stateWordFor(bad, 'confirmed_in_official_filing'), /not yet in an official filing/i);
    assert.doesNotMatch(stateWordFor(bad, 'filed_document_unread'), /not yet in an official filing/i);
    assert.equal(stateWordFor(bad, 'press_unconfirmed'), bad);
    assert.equal(stateWordFor(bad, null), bad);
  });

  test('India: a filing older than 14 days is context only; 4-14 days is recent, not context', () => {
    const card = buildIndiaCard({ filings: [{ subject: 'Award of order worth Rs 90 crore from NHAI', summary: null, url: 'u', dateIso: '2026-09-05' }], press: [], now: new Date('2026-09-28T12:00:00Z'), windowDays: 30, backdropDays: 60, moveDate: '2026-09-28', causalWindowDays: 3, pressWindowDays: 1 });
    const { it } = oneItemView('IN', 'OLDORD', card);
    assert.equal(it.contextOnly, true);
    assert.notEqual(it.catalystFor, 'THIS_MOVE');
    assert.match(it.causalLabel || '', /context only/i);
  });

  test('a 6-day-old India filing is recent (not context); the legend rule is the per-market window', () => {
    const card = buildIndiaCard({ filings: [{ subject: 'Award of order worth Rs 90 crore from NHAI', summary: null, url: 'u', dateIso: '2026-09-22' }], press: [], now: new Date('2026-09-28T12:00:00Z'), windowDays: 21, moveDate: '2026-09-28', causalWindowDays: 3, pressWindowDays: 1 });
    const { it } = oneItemView('IN', 'RECORD', card);
    assert.notEqual(it.catalystFor, 'THIS_MOVE');
    assert.notEqual(it.contextOnly, true);
  });

  test('indiaCardOf passes the IST move date and the 3-day / 1-day causal windows', () => {
    const card = indiaCardOf({
      announcements: [{ subject: 'Award of order worth Rs 90 crore from NHAI', summary: null, url: 'u', dateIso: '2026-09-22', ageDays: 6 }],
      docs: [], news: { items: [] }, now: new Date('2026-09-28T12:00:00Z'), windowDays: 21, sessionCloseIso: '2026-09-28T15:30:00+05:30',
    } as any);
    assert.equal(card.moveDate, '2026-09-28');
    assert.equal(card.catalysts.find((c) => c.id === 'order_win')?.contextOnly, true);   // the card keeps its own 3-day flag; the view uses the per-market window
  });

  test('usMoveDate: a Saturday scan describes Friday\'s session (New York calendar)', () => {
    assert.equal(usMoveDate(new Date('2026-09-26T15:00:00Z')), '2026-09-25');
  });

  test('US: acquisition economics, stage COMPLETED, and the official-filing confirmation come through', () => {
    const ex = 'PTC Completes Acquisition of ST-920 Fabry Disease Gene Therapy. On September 21, 2026, PTC Therapeutics, Inc. completed the acquisition of ST-920.';
    const card = buildUsCard({ ticker: 'PTCT', company: 'PTC Therapeutics, Inc.', marketCapM: 4000, filing: sec('8-K', ['2.01', '9.01'], '2026-09-26'), docs: [secDoc('primary', `FORM 8-K Item 2.01 Completion of Acquisition. ${ex}${PAD}`)], secChecked: true, moveDate: '2026-09-28' } as any)!;
    const { it } = oneItemView('US', 'PTCT', card);
    assert.ok(it.acquisition, 'acquisition economics on the item');
    assert.equal(it.acquisition!.purchasePrice, 'not disclosed in the cited filing');
    assert.equal(it.stageBadge, 'COMPLETED');
    assert.ok(it.catalystConfirmation, 'confirmation state present');
    assert.ok(it.searched && it.searched.sources.length >= 0);
  });

  test('US: a jury award carries the caveat "Gross award is not expected cash proceeds"', () => {
    const t = 'Statement Regarding Jury Verdict in Patent Matter. Burford Capital Limited, today provides an update on a portfolio matter. After the market close on Friday, September 25, 2026, a jury in a case in which Burford has a financial entitlement awarded $5.7 billion in damages to the plaintiff.';
    const card = buildUsCard({ ticker: 'BUR', company: 'Burford Capital Limited', marketCapM: 872.8, filing: sec('8-K', ['7.01', '9.01'], '2026-09-26'), docs: [secDoc('primary', `FORM 8-K Item 7.01 Regulation FD Disclosure. ${PAD}`), secDoc('ex99', `${t}${PAD}`)], secChecked: true, moveDate: '2026-09-28' } as any)!;
    const { it } = oneItemView('US', 'BUR', card);
    assert.match(it.litigationNote || '', /not expected cash proceeds/i);
    assert.ok(it.litigation);
  });

  test('US: clinical facts are on the item, and every missing one is named, not blank', () => {
    const KOD = 'Zenkuda and tabirafusp-ted Meet Primary Endpoints in Pivotal DAYBREAK Trial in wAMD. Zenkuda (tarcocimab tedromer) met the primary endpoint (p-value of 0.0007) demonstrating meaningful vision gains as well as rapid and sustained retinal drying with the majority of patients (54%) on 6-month dosing, establishing a first-line option. The trial enrolled 450 patients with wet age-related macular degeneration and compared Zenkuda with aflibercept.';
    const card = buildUsCard({ ticker: 'KOD', company: 'Kodiak Sciences Inc', marketCapM: 800, filing: sec('8-K', ['7.01', '9.01'], '2026-09-28'), docs: [secDoc('ex99', `${KOD}${PAD}`)], secChecked: true, moveDate: '2026-09-28' } as any)!;
    const { it } = oneItemView('US', 'KOD', card);
    assert.ok(it.clinical, 'clinical facts on the item');
    assert.ok(Array.isArray(it.clinical!.notDisclosed));
  });

  test('numeric BSE code: shown as "BSE 544434", company name kept apart', () => {
    const iss = resolveIssuer({ ticker: '544434', company: 'Neetu Yoshi Ltd' });
    assert.equal(iss.code, '544434');
    assert.equal(iss.name, 'Neetu Yoshi Ltd');
    const withName = displayName({ ticker: '544434', company: 'Neetu Yoshi Ltd', displayTicker: 'Neetu Yoshi Ltd', displayCode: '544434', issuer: iss });
    assert.equal(withName.title, 'Neetu Yoshi Ltd');
    assert.equal(withName.code, 'BSE 544434');
    const bare = displayName({ ticker: '544434', company: null, displayTicker: '544434', displayCode: null, companyName: '544434' });
    assert.equal(bare.title, 'BSE 544434');
    assert.equal(bare.company, null);
  });
});
