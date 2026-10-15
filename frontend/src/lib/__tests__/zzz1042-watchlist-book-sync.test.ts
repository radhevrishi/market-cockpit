// zzz1042 — My Book → /charts watchlist (owner: "sync India Portfolio and USA Portfolio to my portfolio watchlist").
// One way: held names are added to the linked section, names no longer held leave THAT section only; order and flags kept;
// a book that cannot be read or reads empty never takes anything out; unlink keeps the rows; first run links by section name.
// Made-up tickers only (no real holdings in source).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importTvBundle, sanitizeStore, dissolveSection, type WlStore } from '../chart-watchlist';
import {
  autoLinkSections, bookSectionMenu, createLinkedSection, findBookSection, indiaBookHoldings, linkSection, linkTooltip, linkedSection,
  previewLinkRemovals, syncBookSection, syncSummary, unlinkSection, usBookHoldings, usExchangeOf, type BookRead,
} from '../watchlist-book-sync';

const store = (): WlStore => sanitizeStore({
  activeId: 'L1',
  lists: [
    { id: 'L1', name: 'INDIA PORTFOLIO', sections: [
      { id: 'S1', name: 'SELL OR HOLD', items: [{ m: 'IN', t: 'AAA', x: 'NSE' }] },
      { id: 'S2', name: 'INDIA PORTFOLIO', items: [{ m: 'IN', t: 'BBB', x: 'NSE', flag: 'red' }, { m: 'IN', t: 'CCC', x: 'NSE' }, { m: 'IN', t: 'DDD', x: 'NSE', flag: 'green' }, { m: 'US', t: 'ZZUS', x: 'NASDAQ' }] },
      { id: 'S3', name: 'PRIMARY WATCHLIST', items: [{ m: 'IN', t: 'EEE', x: 'NSE' }] },
    ] },
    { id: 'L2', name: 'india and usa themes', sections: [
      { id: 'U1', name: 'USA PORTFOLIO', items: [{ m: 'US', t: 'QQA', x: 'NASDAQ' }, { m: 'US', t: 'QQB', x: 'NYSE', flag: 'blue' }] },
      { id: 'U2', name: 'AI', items: [{ m: 'US', t: 'QQC', x: 'NASDAQ' }] },
    ] },
  ],
});
const linked = (): WlStore => autoLinkSections(store()).store;
const sec = (s: WlStore, l: string, id: string) => s.lists.find((x) => x.id === l)!.sections.find((x) => x.id === id)!;
const syms = (s: WlStore, l: string, id: string) => sec(s, l, id).items.map((it) => it.t);
const IN = (...ts: string[]): BookRead => indiaBookHoldings(ts.map((symbol) => ({ symbol, quantity: 1 })));

test('first run links "India Portfolio" / "USA Portfolio" by section name, once', () => {
  const r = autoLinkSections(store());
  assert.deepEqual(r.linked, ['IN', 'US']);
  assert.equal(sec(r.store, 'L1', 'S2').book, 'IN');
  assert.equal(sec(r.store, 'L2', 'U1').book, 'US');
  assert.deepEqual(r.store.bookAuto, ['IN', 'US']);
  // no such sections: nothing linked, nothing remembered
  const none = autoLinkSections(sanitizeStore({ lists: [{ id: 'X', name: 'W', sections: [{ id: 'a', name: 'Leaders', items: [] }] }] }));
  assert.deepEqual(none.linked, []);
  assert.equal(none.store.bookAuto, undefined);
  // the list whose name says India wins over another list's same-named section
  const two = sanitizeStore({ lists: [
    { id: 'A', name: 'Misc', sections: [{ id: 'a1', name: 'India Portfolio', items: [{ m: 'IN', t: 'X1' }, { m: 'IN', t: 'X2' }, { m: 'IN', t: 'X3' }] }] },
    { id: 'B', name: 'INDIA PORTFOLIO', sections: [{ id: 'b1', name: 'india_portfolio', items: [] }] },
  ] });
  assert.equal(findBookSection(two, 'IN')!.section.id, 'b1');
});

test('unlink keeps the rows and the first-run link never comes back', () => {
  const s = linked();
  const u = unlinkSection(s, 'L1', 'S2');
  assert.equal(sec(u, 'L1', 'S2').book, undefined);
  assert.deepEqual(syms(u, 'L1', 'S2'), syms(s, 'L1', 'S2'));
  assert.equal(autoLinkSections(u).store, u, 'stays unlinked');
  assert.equal(syncBookSection(u, 'IN', IN('BBB')).skipped?.includes('No section'), true);
  // survives a storage round trip (synced to other devices)
  const back = sanitizeStore(JSON.parse(JSON.stringify(u)));
  assert.deepEqual(back.bookAuto, ['IN', 'US']);
  assert.equal(sec(back, 'L2', 'U1').book, 'US');
});

test('adds missing holdings at the end, keeps order and flags, removes sold names only from the linked section', () => {
  const s = linked();
  // held: BBB, DDD, NEW1 (NSE), 543210 (BSE code), AAA (sits in "Sell or Hold"); CCC sold, EEE never held
  const r = syncBookSection(s, 'IN', IN('BBB', 'DDD', 'NEW1.NS', '543210', 'AAA'));
  assert.deepEqual(r.removed, ['CCC']);
  assert.deepEqual(r.added, ['543210', 'NEW1']);
  assert.deepEqual(r.elsewhere, ['AAA']);
  const items = sec(r.store, 'L1', 'S2').items;
  assert.deepEqual(items, [
    { m: 'IN', t: 'BBB', x: 'NSE', flag: 'red' }, { m: 'IN', t: 'DDD', x: 'NSE', flag: 'green' }, { m: 'US', t: 'ZZUS', x: 'NASDAQ' },
    { m: 'IN', t: '543210', x: 'BSE' }, { m: 'IN', t: 'NEW1', x: 'NSE' },
  ], 'order + flags kept, the other market untouched, BSE code on BSE');
  assert.deepEqual(syms(r.store, 'L1', 'S1'), ['AAA'], 'held name in another section stays there (a list holds a symbol once)');
  assert.deepEqual(syms(r.store, 'L1', 'S3'), ['EEE'], 'other sections never lose names');
  assert.deepEqual(syms(r.store, 'L2', 'U1'), ['QQA', 'QQB'], 'other lists untouched');
  // idempotent: a second run changes nothing and returns the same store object (nothing to save)
  const again = syncBookSection(r.store, 'IN', IN('BBB', 'DDD', 'NEW1.NS', '543210', 'AAA'));
  assert.equal(again.store, r.store);
  assert.deepEqual([again.added, again.removed], [[], []]);
  assert.equal(syncSummary('IN', again, false), null, 'automatic run with no change says nothing');
  assert.match(syncSummary('IN', r, true)!, /2 added .*1 no longer held/);
});

test('a book that failed or reads empty never removes anything', () => {
  const s = linked();
  const failed = syncBookSection(s, 'IN', indiaBookHoldings(null));
  assert.equal(failed.store, s);
  assert.ok(failed.skipped);
  assert.equal(syncBookSection(s, 'IN', indiaBookHoldings('garbage')).store, s);
  const emptyIn = syncBookSection(s, 'IN', IN());
  assert.equal(emptyIn.store, s);
  assert.deepEqual(emptyIn.removed, []);
  assert.equal(syncBookSection(s, 'US', usBookHoldings({ ok: false, error: 'kv down' })).store, s);
  assert.equal(syncBookSection(s, 'US', usBookHoldings({ ok: true, universe: [] })).store, s);
  assert.equal(syncBookSection(s, 'US', usBookHoldings(null)).store, s);
});

test('automatic run holds back an unusually large removal; Sync now applies it', () => {
  const s = sanitizeStore({ lists: [{ id: 'L', name: 'P', sections: [{ id: 'S', name: 'India Portfolio', book: 'IN',
    items: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((t) => ({ m: 'IN', t })) }] }] });
  const auto = syncBookSection(s, 'IN', IN('A1'), { auto: true });
  assert.deepEqual(auto.removed, []);
  assert.equal(auto.heldBack.length, 5);
  assert.equal(auto.store, s);
  assert.match(syncSummary('IN', auto, false)!, /Sync now/);
  const manual = syncBookSection(s, 'IN', IN('A1'), { auto: false });
  assert.deepEqual(syms(manual.store, 'L', 'S'), ['A1']);
  // small drops go through automatically
  assert.deepEqual(syncBookSection(s, 'IN', IN('A1', 'A2', 'A3', 'A4', 'A5'), { auto: true }).removed, ['A6']);
});

test('US book: holdings only (no bench, no non-US listing), exchanges mapped, BRK-B matches BRK.B', () => {
  const read = usBookHoldings({ ok: true, universe: [
    { ticker: 'QQA', origin: 'book', listing: 'US', exchange: 'NASDAQ' },
    { ticker: 'NEWU', origin: 'both', listing: 'US', exchange: 'NYSE' },
    { ticker: 'BRK-B', origin: 'book', listing: 'US', exchange: 'NYSE' },
    { ticker: 'BENCHY', origin: 'bench', listing: 'US', exchange: 'NASDAQ' },
    { ticker: 'FRANK', origin: 'book', listing: 'NON_US', exchange: 'FWB' },
  ] });
  assert.ok(read.ok);
  assert.deepEqual(read.ok && read.items, [{ t: 'QQA', x: 'NASDAQ' }, { t: 'NEWU', x: 'NYSE' }, { t: 'BRK.B', x: 'NYSE' }]);
  const s = linked();
  const r = syncBookSection(s, 'US', read);
  assert.deepEqual(r.removed, ['QQB']);
  assert.deepEqual(r.added, ['BRK.B', 'NEWU']);
  assert.deepEqual(sec(r.store, 'L2', 'U1').items, [{ m: 'US', t: 'QQA', x: 'NASDAQ' }, { m: 'US', t: 'BRK.B', x: 'NYSE' }, { m: 'US', t: 'NEWU', x: 'NYSE' }]);
  assert.deepEqual(syms(r.store, 'L2', 'U2'), ['QQC']);
  assert.equal(syncBookSection(r.store, 'US', usBookHoldings({ ok: true, universe: [{ ticker: 'BRK.B', origin: 'book', listing: 'US', exchange: 'NYSE' }, { ticker: 'QQA', origin: 'book', listing: 'US' }, { ticker: 'NEWU', origin: 'book', listing: 'US' }] })).store, r.store);
  assert.deepEqual(['NASDAQ.NMS', 'SMART/NYSE', 'NYSE ARCA', 'NYSE AMERICAN', 'BATS', 'XETRA'].map(usExchangeOf), ['NASDAQ', 'NYSE', 'NYSEARCA', 'AMEX', 'BATS', undefined]);
});

test('India book reading: exchange from the symbol, suffixes and prefixes stripped, repeats dropped', () => {
  const r = indiaBookHoldings([{ symbol: 'abc.ns' }, { symbol: 'NSE:ABC' }, { symbol: 'xyz.BO' }, { symbol: '500123' }, { symbol: 'M&M' }, { symbol: '' }, null, { symbol: 'bad sym!' }]);
  assert.deepEqual(r.ok && r.items, [{ t: 'ABC', x: 'NSE' }, { t: 'XYZ', x: 'NSE' }, { t: '500123', x: 'BSE' }, { t: 'M&M', x: 'NSE' }]);
});

test('manual link / create, one section per book, menus and wording', () => {
  let s = linked();
  // moving the India link to another section unlinks the first one (rows kept)
  const moved = linkSection(s, 'L1', 'S3', 'IN');
  assert.equal(sec(moved, 'L1', 'S3').book, 'IN');
  assert.equal(sec(moved, 'L1', 'S2').book, undefined);
  assert.deepEqual(syms(moved, 'L1', 'S2'), syms(s, 'L1', 'S2'));
  assert.equal(sanitizeStore({ lists: [{ id: 'a', name: 'a', sections: [{ id: '1', name: 'x', book: 'IN', items: [] }, { id: '2', name: 'y', book: 'IN', items: [] }] }] }).lists[0].sections[1].book, undefined, 'storage keeps one link per book');
  assert.deepEqual(previewLinkRemovals(moved, 'L1', 'S3', 'IN', IN('BBB')), ['EEE']);
  // create in the open list when no section is linked
  s = sanitizeStore({ activeId: 'W', lists: [{ id: 'W', name: 'Mine', sections: [{ id: 'w1', name: '', items: [] }] }] });
  const c = createLinkedSection(s, 'US');
  assert.equal(linkedSection(c, 'US')!.section.name, 'USA Portfolio');
  assert.deepEqual(syms(syncBookSection(c, 'US', usBookHoldings({ ok: true, universe: [{ ticker: 'QQZ', origin: 'book', listing: 'US', exchange: 'NASDAQ' }] })).store, 'W', linkedSection(c, 'US')!.section.id), ['QQZ']);
  // menus
  const L = linked();
  assert.deepEqual(bookSectionMenu(L, sec(L, 'L1', 'S2')).map((i) => i.id), ['book-info', 'book-sync', 'book-unlink']);
  assert.deepEqual(bookSectionMenu(L, sec(L, 'L1', 'S3'))[0].children!.map((i) => i.id), ['book-link:IN', 'book-link:US']);
  const tip = linkTooltip('IN', new Date(2026, 9, 15, 11, 58).getTime());
  assert.match(tip, /^Kept in sync with My Book \(India\) — last synced 11:58/);
  const words = [tip, linkTooltip('US', null), ...bookSectionMenu(L, sec(L, 'L1', 'S3'))[0].children!.map((i) => i.label), syncSummary('IN', syncBookSection(L, 'IN', IN('BBB', 'ZZ1')), true)!].join(' ');
  assert.doesNotMatch(words, /\bbest\b|\bbuy\b|\bsell\b/i);
});

test('links survive a TradingView bundle re-import of the same list, and dissolving a linked section drops its link', () => {
  const s = linked();
  const r = importTvBundle(s, { lists: [{ name: 'INDIA PORTFOLIO', text: '###INDIA PORTFOLIO,NSE:BBB,###OTHER,NSE:QWE' }], flags: {} });
  assert.equal(linkedSection(r.store, 'IN')!.section.name, 'INDIA PORTFOLIO');
  assert.deepEqual(r.store.bookAuto, ['IN', 'US']);
  const solo = sanitizeStore({ lists: [{ id: 'a', name: 'a', sections: [{ id: '1', name: 'India Portfolio', book: 'IN', items: [{ m: 'IN', t: 'Q1' }] }] }] });
  assert.equal(dissolveSection(solo.lists[0], '1').sections[0].book, undefined);
});

test('panel wiring: 🔗 on linked headers, Sync now in the list menu and the section menu, sync on load / book change / poll', () => {
  const root = join(__dirname, '..', '..');
  const panel = readFileSync(join(root, 'components/charts/WatchlistPanel.tsx'), 'utf8');
  const hook = readFileSync(join(root, 'components/charts/useBookWatchlistSync.ts'), 'utf8');
  assert.match(panel, /useBookWatchlistSync\(store, update, say\)/);
  assert.match(panel, /section-book-link/);
  assert.match(panel, /Sync with My Book now/);
  assert.match(panel, /book-unlink/);
  assert.match(hook, /mc_portfolio_holdings/);
  assert.match(hook, /\/api\/v1\/us-book\?view=universe/);
  assert.match(hook, /pollWhenVisible\(/);
  assert.match(hook, /mc:vault:restored/);
});
