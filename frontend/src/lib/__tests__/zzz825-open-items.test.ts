// zzz825 — the open items after zzz824: company names on the 10-day tab, US SEC chains and typing, no
// restructuring from deck marketing text, lazy document reads (§34), BSE code ↔ NSE symbol in the book,
// the fundamentals page on the canonical saved holdings, and the ☀/🌙 light screens.
// Synthetic tickers only (ZZALPHA …). Run: npx tsx --test src/lib/__tests__/zzz825-open-items.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildRecentCatalysts, usSubjectClass, usItemsIn, nameMapOf, restructuringAllowed, subjectClass, normUrl,
  type RawEvent, type FilingRead, type ThesisCtx,
} from '../catalyst/recent-events';
import { buildCard, chainSpec } from '../catalyst/event-card';
import { readFilingText, toFilingRead, restructuringApproved, restructuringStated } from '../catalyst/filing-read';
import { rawFromUsFilings, accessionOf, usSubjectPlain } from '../catalyst/us-filings';
import { resolveIndiaBook, buildBookCheck, bookWhy, isBseCode } from '../thesis/book-membership';
import { nseSymbolFromScreenerPage, matchFromIndex } from '../thesis/bse-nse-lookup';
import { isProtectedApi } from '../site-auth';
import NewCatalystsTab from '../../components/catalyst/new-catalysts-tab';

(globalThis as any).React = React;   // the tab is compiled with the classic JSX runtime under tsx
const TODAY = '2026-09-28';
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
let n = 0;
const inFiling = (o: Partial<RawEvent>): RawEvent => ({ ticker: 'ZZALPHA', date: '2026-09-26', title: 'x', origin: 'ledger-doc', source: 'BSE corporate announcements', url: `https://www.bseindia.com/xml-data/corpfiling/AttachLive/q${++n}.pdf`, ...o });
const usFiling = (o: Partial<RawEvent>): RawEvent => ({ ticker: 'ZZUS', date: '2026-09-25', title: 'x', origin: 'feed', source: 'SEC EDGAR', badge: 'filed', url: `https://www.sec.gov/Archives/edgar/data/111/0000000000260${String(++n).padStart(5, '0')}/d8k.htm`, ...o });
const B: ThesisCtx = { pattern: 'B', fit: 'exact', assessment: null };
const PAD = ' This is for your information and records. The same shall also be available on the website of the Company for the information of shareholders and investors at large.';

// ── 1. company names ────────────────────────────────────────────────────────
describe('1 · company names on the 10-day tab come from the page\'s name map', () => {
  test('a row with no filing name takes the page\'s name; a ticker-as-name is ignored; unknown stays null', () => {
    const names = nameMapOf(
      [{ ticker: 'ZZALPHA', company: 'Zz Alpha Industries Limited' }, { ticker: 'ZZBETA', company: 'ZZBETA' }],
      [{ ticker: 'ZZGAMMA-BE', company: 'Zz Gamma Chemicals Ltd' }],
    );
    assert.equal(names.ZZALPHA, 'Zz Alpha Industries Limited');
    assert.equal(names.ZZBETA, undefined, 'a name equal to the ticker is not a name');
    assert.equal(names.ZZGAMMA, 'Zz Gamma Chemicals Ltd', 'series suffix is folded');
    const r = buildRecentCatalysts([
      inFiling({ ticker: 'ZZALPHA', title: 'Bagging/Receiving of orders/contracts' }),
      inFiling({ ticker: 'ZZGAMMA', title: 'Bagging/Receiving of orders/contracts' }),
      inFiling({ ticker: 'ZZDELTA', title: 'Bagging/Receiving of orders/contracts' }),
    ], TODAY, { names });
    const by = (t: string) => [...r.items, ...r.minor].find((e) => e.ticker === t)!;
    assert.equal(by('ZZALPHA').company, 'Zz Alpha Industries Limited');
    assert.equal(by('ZZGAMMA').company, 'Zz Gamma Chemicals Ltd');
    assert.equal(by('ZZDELTA').company, null, 'truly unknown → omitted, never the ticker');
  });
  test('the card shows the name when known and nothing when not', () => {
    const r = buildRecentCatalysts([
      inFiling({ ticker: 'ZZALPHA', title: 'Bagging/Receiving of orders/contracts', ctx: B }),
      inFiling({ ticker: 'ZZDELTA', title: 'Bagging/Receiving of orders/contracts', ctx: B }),
    ], TODAY, { names: { ZZALPHA: 'Zz Alpha Industries Limited' } });
    const html = renderToStaticMarkup(React.createElement(NewCatalystsTab, { result: r, loading: false, names: 2, sourceNotes: [], market: 'IN' }));
    assert.match(html, /data-testid="nc-company"[^>]*>Zz Alpha Industries Limited</);
    assert.equal((html.match(/data-testid="nc-company"/g) || []).length, 1);
  });
  test('both Portfolio Catalysts pages pass their name map', () => {
    assert.match(read('app/(dashboard)/portfolio-catalysts/page.tsx'), /names: nameMap/);
    assert.match(read('app/(dashboard)/us-portfolio-catalysts/page.tsx'), /names: nameMap/);
  });
});

// ── 2. US SEC typing and chains ──────────────────────────────────────────────
describe('2 · US filings: 8-K items type the event, US evidence chains', () => {
  test('8-K items and offering forms', () => {
    assert.deepEqual(usItemsIn('8-K: Material agreement signed; also Regulation FD disclosure [Item 1.01, Item 7.01, Item 9.01]'), ['1.01', '7.01', '9.01']);
    assert.deepEqual(usItemsIn('Press release — 8-K Item 1.01 / 7.01 (material agreement, Regulation FD disclosure), filed 2026-09-20'), ['1.01', '7.01']);
    assert.equal(usSubjectClass('8-K: Results of operations [Item 2.02, Item 9.01]')!.type, 'Results');
    const c101 = usSubjectClass('8-K: Material agreement signed [Item 1.01, Item 9.01]')!;
    assert.equal(c101.type, 'Order win'); assert.equal(c101.generic, true, 'the document can still decide (credit line, ATM)');
    assert.equal(usSubjectClass('8-K: Acquisition or disposition completed [Item 2.01, Item 9.01]')!.type, 'Acquisition');
    assert.equal(usSubjectClass('8-K: Completed sale of business [Item 2.01]')!.type, 'Divestment');
    const c502 = usSubjectClass('8-K: Director / officer change [Item 5.02]')!;
    assert.equal(c502.type, 'Management change'); assert.equal(c502.senior, true);
    assert.equal(usSubjectClass('8-K: Unregistered sale of equity [Item 3.02]')!.type, 'Fund raise');
    assert.equal(usSubjectClass('424B5: Prospectus supplement')!.type, 'Fund raise');
    assert.equal(usSubjectClass('S-3: Shelf registration')!.type, 'Fund raise');
    const c801 = usSubjectClass('8-K: Other events [Item 8.01, Item 9.01]')!;
    assert.equal(c801.type, 'Other filing'); assert.equal(c801.generic, true);
    assert.match(String(usSubjectClass('8-K: Shareholder vote [Item 5.07]')!.routine), /governance/);
    assert.equal(usSubjectClass('Form 10-Q — quarter ended 2026-06-30 (MD&A)'), null);
    // India subjects are untouched, and the shared classifier keeps its old answer
    assert.equal(usSubjectClass('Bagging/Receiving of orders/contracts'), null);
    assert.equal(subjectClass('Press release — 8-K Item 7.01 (Regulation FD disclosure), filed 2026-09-20').type, 'Concall / business update');
  });
  test('chains: contract, approval → commercialization, offering = dilution; results unchanged', () => {
    assert.deepEqual(chainSpec('Order win', 'US')!.links.map((l) => l[0]), ['CONTRACT', 'EXECUTION', 'REVENUE', 'MARGIN', 'CASH']);
    assert.deepEqual(chainSpec('Regulatory approval', 'US')!.links.map((l) => l[0]), ['APPROVAL', 'COMMERCIALIZATION', 'VOLUME', 'REVENUE']);
    assert.deepEqual(chainSpec('Results', 'US')!.links.map((l) => l[0]), ['SALES', 'PROFIT', 'MARGIN', 'CASH', 'GUIDANCE']);
    assert.deepEqual(chainSpec('Order win', 'IN')!.links.map((l) => l[0]), ['ORDER', 'EXECUTION', 'REVENUE', 'MARGIN', 'CASH'], 'India unchanged');
    assert.equal(chainSpec('Fund raise', 'US')!.links[0][0], 'OFFERING');
  });
  test('US tab: 5.02 needs attention, 3.02 / 424B is dilution and never read, 1.01 is a contract', () => {
    const f502 = usFiling({ title: '8-K: Director / officer change [Item 5.02]', ctx: B });
    const f424 = usFiling({ ticker: 'ZZUS2', title: '424B5: Prospectus supplement', ctx: B, url: 'https://www.sec.gov/Archives/edgar/data/222/000000000026099999/d424b5.htm' });
    const f101 = usFiling({ ticker: 'ZZUS3', title: '8-K: Material agreement signed [Item 1.01, Item 9.01]', ctx: B });
    const r = buildRecentCatalysts([f502, f424, f101], TODAY, { market: 'US' });
    const all = [...r.items, ...r.minor];
    const e502 = all.find((e) => e.ticker === 'ZZUS')!;
    assert.equal(e502.type, 'Management change');
    assert.equal(e502.card!.attention, 'senior management change');
    const e424 = all.find((e) => e.ticker === 'ZZUS2')!;
    assert.equal(e424.type, 'Fund raise');
    assert.match(e424.card!.evidence, /dilution/);
    assert.equal(e424.card!.impact, 'Neutral');
    assert.ok(!r.toRead.some((q) => q.url === f424.url), 'a prospectus is never opened');
    const e101 = all.find((e) => e.ticker === 'ZZUS3')!;
    assert.equal(e101.type, 'Order win');
    assert.equal(e101.card!.chain![0].label, 'CONTRACT');
  });
  test('an 8-K 8.01 read as an FDA approval gets APPROVAL → COMMERCIALIZATION → VOLUME → REVENUE', () => {
    const f = usFiling({ ticker: 'ZZBIO', title: '8-K: Other events [Item 8.01, Item 9.01]', ctx: { pattern: 'G', fit: 'exact', assessment: null } });
    const rd: FilingRead = { url: f.url!, status: 'read', kind: 'Regulatory approval', line: 'FDA approval: The U.S. Food and Drug Administration approved the company\'s new drug application for Zzumab.', figures: [], touches: [], version: 'r3' };
    const r = buildRecentCatalysts([f], TODAY, { market: 'US', reads: { [f.url!]: rd } });
    const e = [...r.items, ...r.minor][0];
    assert.equal(e.type, 'Regulatory approval');
    assert.deepEqual(e.card!.chain!.map((l) => l.label), ['APPROVAL', 'COMMERCIALIZATION', 'VOLUME', 'REVENUE']);
    assert.equal(e.card!.chain![0].ok, true);
    assert.match(String(e.card!.next), /^commercialization → volume → revenue$/);
  });
  test('SEC list adapter: plain subject, skips ownership forms, periodic reports and ledger duplicates', () => {
    assert.equal(usSubjectPlain('8-K: Director / officer change [Item 5.02] · filed 16:05 ET after the close'), '8-K: Director / officer change [Item 5.02]');
    assert.equal(accessionOf('https://www.sec.gov/Archives/edgar/data/1653558/000121390026060470/0001213900-26-060470-index.htm'), '000121390026060470');
    const ledgerUrl = 'https://www.sec.gov/Archives/edgar/data/9/000000000026000001/0000000000-26-000001-index.htm';
    const raws = rawFromUsFilings([
      { ticker: 'zzus', subject: '8-K: Director / officer change [Item 5.02] · filed 16:05 ET', url: 'https://www.sec.gov/Archives/edgar/data/9/000000000026000002/d.htm', date: '2026-09-25T16:05:00-04:00' },
      { ticker: 'ZZUS', subject: '8-K: Results of operations [Item 2.02]', url: 'https://www.sec.gov/Archives/edgar/data/9/000000000026000001/d.htm', date: '2026-09-24' },
      { ticker: 'ZZUS', subject: '4: Statement of changes in beneficial ownership', url: 'https://www.sec.gov/x/4.xml', date: '2026-09-24' },
      { ticker: 'ZZUS', subject: 'SC 13G: passive holder', url: null, date: '2026-09-24' },
      { ticker: 'ZZUS', subject: '10-Q: Quarterly report', url: null, date: '2026-09-24' },
    ], { companyOf: () => 'Zz United Corp.', knownUrls: [ledgerUrl] });
    assert.equal(raws.length, 1);
    assert.equal(raws[0].ticker, 'ZZUS');
    assert.equal(raws[0].title, '8-K: Director / officer change [Item 5.02]');
    assert.equal(raws[0].company, 'Zz United Corp.');
  });
  test('the US page lists SEC filings through a protected route and passes them to the tab', () => {
    const page = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    assert.match(page, /\/api\/v1\/catalyst\/us-filings/);
    assert.match(page, /rawFromUsFilings\(/);
    assert.equal(isProtectedApi('/api/v1/catalyst/us-filings'), true);
    assert.equal(isProtectedApi('/api/v1/book/bse-map'), true);
    const route = read('app/api/v1/catalyst/us-filings/route.ts');
    assert.match(route, /readOwnership: false/);
    assert.doesNotMatch(route, /fetchEdgarDocuments|readFilingText/, 'metadata only — no document read in the list route');
  });
});

// ── 3. restructuring only when stated ───────────────────────────────────────
describe('3 · "Demerger" in a deck is not a restructuring', () => {
  const DECK = 'Investor Presentation Q1 FY27. Zz Alpha at a glance. Strategic priorities: Demerger of the specialty chemicals business to unlock value for shareholders. Scheme of arrangement journey 2019 to 2026. Revenue growth across segments with new customers added in Europe and the US. Capacity utilisation improved in the quarter.' + PAD;
  test('reader: a deck mentioning demerger / scheme is not typed as a restructuring', () => {
    const r = readFilingText({ subject: 'Investor Presentation', text: DECK, market: 'IN', date: '2026-09-25' });
    assert.notEqual(r.kind, 'Corporate restructuring');
    assert.equal(r.restructuringStated, false);
    const g = readFilingText({ subject: 'Press Release', text: DECK, market: 'IN', date: '2026-09-25' });
    assert.notEqual(g.kind, 'Corporate restructuring');
  });
  test('reader: an explicit board-approval sentence or the subject does make it one', () => {
    const BOARD = 'Outcome of the board meeting. The Board of Directors of the Company at its meeting held today has approved the Composite Scheme of Arrangement for the demerger of the specialty chemicals undertaking of Zz Alpha Limited (Demerged Company) into Zz Beta Limited (Resulting Company), subject to approval of the NCLT.' + PAD;
    assert.equal(restructuringApproved(BOARD), true);
    assert.equal(restructuringApproved(DECK), false);
    assert.equal(restructuringStated('Scheme of Arrangement', ''), true);
    const r = readFilingText({ subject: 'Outcome of Board Meeting', text: BOARD, market: 'IN', date: '2026-09-25' });
    assert.equal(r.kind, 'Corporate restructuring');
    assert.equal(r.restructuringStated, true);
  });
  test('tab: an old cached deck read that said restructuring is not trusted; a subject-typed scheme is', () => {
    assert.equal(restructuringAllowed({ kind: 'Corporate restructuring', docType: 'Investor presentation' }, { type: 'Other filing' }), false);
    assert.equal(restructuringAllowed({ kind: 'Corporate restructuring', docType: 'Board meeting outcome' }, { type: 'Other filing' }), true);
    assert.equal(restructuringAllowed({ kind: 'Corporate restructuring', docType: 'Investor presentation', restructuringStated: true }, { type: 'Other filing' }), true);
    const f = inFiling({ title: 'Press Release', ctx: B });
    const old: FilingRead = { url: f.url!, status: 'read', kind: 'Corporate restructuring', line: 'Scheme of arrangement (demerger) — parties not legible in the filing', docType: 'Investor presentation', figures: [], touches: [], version: 'r3' };
    const r = buildRecentCatalysts([f], TODAY, { reads: { [f.url!]: old } });
    assert.notEqual([...r.items, ...r.minor, ...r.hidden][0].type, 'Corporate restructuring');
  });
});

// ── 4. lazy reads (§34) ──────────────────────────────────────────────────────
describe('4 · first render from metadata; Material + Notable read first; Minor only on demand', () => {
  const raws = [
    inFiling({ ticker: 'ZZMIN', title: 'Appointment of Independent Director', date: '2026-09-27' }),
    inFiling({ ticker: 'ZZORD', title: 'Bagging/Receiving of orders/contracts', date: '2026-09-20' }),
    inFiling({ ticker: 'ZZGEN', title: 'Press Release', date: '2026-09-26' }),
    inFiling({ ticker: 'ZZRTN', title: 'Trading Window Closure', date: '2026-09-27' }),
  ];
  test('the queue is ordered first → open → minor; routine is never queued', () => {
    const r = buildRecentCatalysts(raws, TODAY);
    assert.deepEqual(r.toRead.map((q) => `${q.ticker}:${q.tier}`), ['ZZORD:first', 'ZZGEN:open', 'ZZMIN:minor']);
    assert.ok(!r.toRead.some((q) => q.ticker === 'ZZRTN'));
    assert.equal(r.reading.lazy, 1);
    // the tab renders now, from metadata, with every document still unread
    assert.equal(r.reading.read, 0);
    assert.ok([...r.items, ...r.minor].length >= 3);
    const min = r.minor.find((e) => e.ticker === 'ZZMIN')!;
    assert.equal(min.readTier, 'minor');
  });
  test('the pages queue a minor document only once it is wanted', () => {
    for (const p of ['app/(dashboard)/portfolio-catalysts/page.tsx', 'app/(dashboard)/us-portfolio-catalysts/page.tsx']) {
      assert.match(read(p), /\.filter\(\(q\) => q\.tier !== 'minor' \|\| wantedReads\.has\(normUrl\(q\.url\)\)\)/, p);
      assert.match(read(p), /onRead=\{addWanted\} wanted=\{wantedReads\}/, p);
    }
  });
  test('the tab: Minor collapsed → no read asked; opening Minor asks for exactly the minor unread documents', () => {
    const r = buildRecentCatalysts(raws, TODAY);
    const asked: string[][] = [];
    const html = renderToStaticMarkup(React.createElement(NewCatalystsTab, { result: r, loading: false, names: 4, sourceNotes: [], market: 'IN', onRead: (u: string[]) => asked.push(u), wanted: new Set<string>() }));
    assert.equal(asked.length, 0, 'rendering never asks for a read');
    assert.doesNotMatch(html, /nc-read-now/, 'collapsed Minor shows no rows');
    assert.match(html, /minor — read when you open Minor/);
    const tab = read('components/catalyst/new-catalysts-tab.tsx');
    assert.match(tab, /if \(open && onRead\) \{ const us = minor\.map\(lazyUrl\)/);
    assert.equal(normUrl(r.minor.find((e) => e.ticker === 'ZZMIN')!.url), normUrl(r.toRead.find((q) => q.tier === 'minor')!.url));
  });
});

// ── 5. BSE code ↔ NSE symbol ─────────────────────────────────────────────────
describe('5 · a holding saved as a BSE code matches its NSE symbol', () => {
  test('matched code → NSE symbol row, merged, and the bench no longer shows it twice', () => {
    const r = resolveIndiaBook({ server: { ok: true, symbols: ['999001', 'ZZBETA'] }, browser: ['999002'], bseMap: {
      '999001': { symbol: 'ZZALPHA', company: 'Zz Alpha Ltd', via: 'earnings index' },
      '999002': { symbol: null, company: null, via: 'screener.in — BSE-only scrip' },
    } });
    const syms = r.names.map((x) => x.symbol).sort();
    assert.deepEqual(syms, ['999002', 'ZZALPHA', 'ZZBETA']);
    const a = r.names.find((x) => x.symbol === 'ZZALPHA')!;
    assert.deepEqual(a.merged, ['999001']);
    assert.match(bookWhy(a), /saved as BSE code 999001, matched to NSE ZZALPHA \(earnings index\)/);
    assert.equal(r.bseUnmatched!.length, 1);
    assert.match(r.bseUnmatched![0].reason, /no NSE symbol found/);
    const chk = buildBookCheck({ saved: r.names, rows: [{ symbol: 'ZZALPHA', origin: 'book' }, { symbol: 'ZZBETA', origin: 'book' }, { symbol: '999002', origin: 'book' }], sources: r.sources, rule: r.rule, bseUnmatched: r.bseUnmatched });
    assert.equal(chk.notSaved.length, 0);
    assert.equal(chk.bseUnmatched.length, 1);
    assert.match(chk.line, /1 saved BSE code with no NSE match ⚠/);
  });
  test('a code not looked up yet is flagged as such, never silently dropped', () => {
    const r = resolveIndiaBook({ server: null, browser: ['999003'] });
    assert.deepEqual(r.names.map((x) => x.symbol), ['999003']);
    assert.match(r.bseUnmatched![0].reason, /still being looked up/);
    assert.equal(isBseCode('999003'), true); assert.equal(isBseCode('ZZ999'), false);
  });
  test('in-app sources: the earnings index row, the screener.in page — no hard-coded map', () => {
    assert.deepEqual(matchFromIndex('999001', [{ t: 'ZZALPHA', c: 'Zz Alpha Ltd', bse: '999001' }]), { symbol: 'ZZALPHA', company: 'Zz Alpha Ltd', via: 'earnings index' });
    assert.equal(matchFromIndex('999001', [{ t: '999001', bse: '999001' }]), null);
    assert.equal(nseSymbolFromScreenerPage('<a href="https://www.nseindia.com/get-quotes/equity?symbol=ZZALPHA" target="_blank">NSE: ZZALPHA</a>'), 'ZZALPHA');
    assert.equal(nseSymbolFromScreenerPage('<link rel="canonical" href="https://www.screener.in/company/ZZALPHA/consolidated/">'), 'ZZALPHA');
    assert.equal(nseSymbolFromScreenerPage('<link rel="canonical" href="https://www.screener.in/company/999002/">'), null, 'a BSE-only scrip has no NSE symbol');
    const route = read('app/api/v1/book/bse-map/route.ts');
    assert.match(route, /search:idx:v3/); assert.match(route, /screener\.in\/company/);
    assert.match(read('lib/thesis/use-book.ts'), /lookupBseCodes\(codes\)/);
  });
});

// ── 6. fundamentals on the canonical saved holdings ────────────────────────
describe('6 · Portfolio Fundamentals reads the canonical saved holdings', () => {
  test('load-universe uses loadIndiaBookInput + resolveIndiaBook, never the old browser lists', () => {
    const src = read('lib/fundamentals/load-universe.ts');
    assert.match(src, /loadIndiaBookInput\(\)/);
    assert.match(src, /resolveIndiaBook\(input\)/);
    assert.doesNotMatch(src, /readHoldingSymbols/);
  });
});

// ── 7. light screens ─────────────────────────────────────────────────────────
describe('7 · ☀/🌙 light screens', () => {
  test('a persisted header toggle drives data-theme on <html>; default dark; storage wrapped', () => {
    const ctx = read('contexts/ThemeContext.tsx');
    assert.match(ctx, /SCREEN_THEME_KEY/);
    assert.match(ctx, /saved === 'light' \|\| saved === 'dark'/);
    assert.match(ctx, /try \{[\s\S]*localStorage\.getItem\(SCREEN_THEME_KEY\)[\s\S]*\} catch/);
    assert.match(ctx, /document\.documentElement\.dataset\.theme = theme/);
    assert.match(read('lib/theme.ts'), /DEFAULT_THEME: ThemeName = 'dark'/);
    assert.match(read('app/(dashboard)/DashboardClient.tsx'), /<ScreenThemeToggle \/>/);
    assert.match(read('components/ScreenThemeToggle.tsx'), /setTheme\(light \? 'dark' : 'light'\)/);
    assert.match(read('app/layout.tsx'), /SCREEN_THEME_EARLY/);
  });
  test('the light --mc-* / --tc-* set applies on screen, not only in print, and is readable', () => {
    const css = read('styles/design-system.css');
    const i = css.indexOf('html:root[data-theme="light"] {');
    assert.ok(i > 0);
    const block = css.slice(i, css.indexOf('}', i));
    for (const v of ['--mc-bg-0: #ffffff', '--mc-bg-1: #ffffff', '--mc-text-0: #0b1220', '--tc-text: #0b1220', '--tc-faint: #334155', '--mc-verdict-warn: #b45309', '--tc-accent: #0e7490']) assert.ok(block.includes(v), v);
    // top level (column 0), after the print block has closed — so it applies on screen
    assert.ok(css.includes('\nhtml:root[data-theme="light"] {'));
    const lastPrint = css.lastIndexOf('@media print {');
    assert.ok(lastPrint < i && css.slice(lastPrint, i).includes('\n}\n'), 'the print block is closed before the screen set');
    // the old var-based light hacks that forced border colours are gone (vars swap now)
    assert.doesNotMatch(read('app/globals.css'), /html\[data-theme="light"\] \[style\*="var\(--mc-/);
    // and the old invert() filter is gone — on top of swapped variables it turned white back to black
    assert.doesNotMatch(read('app/globals.css'), /html\[data-theme="light"\] (?:main|aside|header) \{\s*filter: invert/);
  });
  test('the tab, PC cards and EO cards paint with the swapped variables', () => {
    const tab = read('components/catalyst/new-catalysts-tab.tsx');
    assert.match(tab, /bg: 'var\(--mc-bg-1\)'/);
    assert.match(tab, /text: 'var\(--tc-text/);
    assert.match(tab, /amber: 'var\(--mc-verdict-warn/);
  });
});
