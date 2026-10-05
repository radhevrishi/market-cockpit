// zzz843 — Guidance Upgrades UI/route structural invariants + pure formatter tests (synthetic tickers only).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fmtBeforeAfter, fmtDelta, showsDecision, applyFilters, gapNote, metricFamilies, UNAVAILABLE } from '../guidance-upgrades-format';
import { overlayBook } from '../guidance-upgrades-book';
import { parseWindow, parseMarket, gradedRowToCandidate, dedupeCandidates } from '../guidance-upgrades-candidates';
import { isProtectedApi } from '../site-auth';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const compDir = join(SRC, 'components', 'guidance-upgrades');
const compFiles = readdirSync(compDir).map((f) => `components/guidance-upgrades/${f}`);
const uiFiles = [...compFiles, 'app/(dashboard)/guidance-upgrades/page.tsx', 'lib/guidance-upgrades-format.ts', 'lib/guidance-upgrades-book.ts'];

const pt = (o: any) => ({ metric: 'REVENUE', period: 'FY27', low: null, high: null, midpoint: null, isGrowthRate: false, ...o });
const ev = (o: any = {}): any => ({
  guidance_event_id: 'x1', ticker: 'AAAA', company: 'Alpha Test', market: 'US', verification: 'VERIFIED', primaryAvailable: true, decision: 'WATCHLIST',
  changes: [], flags: [], history: [], links: {}, duration: 'MULTI_YEAR', materiality: 'HIGH', expectationGap: 'UNKNOWN', ...o,
});

describe('structure', () => {
  test('page has a default export and no named exports', () => {
    const s = read('app/(dashboard)/guidance-upgrades/page.tsx');
    assert.match(s, /export default function/);
    assert.deepEqual(s.split('\n').filter((l) => /^export\s+(?!default)/.test(l)), []);
  });
  test('UI never imports price or quote modules', () => {
    for (const f of uiFiles) assert.ok(!/from '[^']*(quote|price|market-data|us-nasdaq)[^']*'/i.test(read(f)), f);
  });
  test('BUY / SELL appear only as IMMEDIATE BUY; no visible /100 score', () => {
    for (const f of uiFiles) {
      const s = read(f);
      for (const m of s.matchAll(/\b(BUY|SELL)\b/g)) assert.equal(s.slice(m.index! - 10, m.index! + 3), 'IMMEDIATE BUY', `${f}: ${m[0]}`);
      assert.ok(!/\/\s?100\b/.test(s), `${f} shows a /100 score`);
      assert.ok(!/rankKey/.test(s.replace(/\/\/.*$/gm, '')), `${f} renders rankKey`);
    }
  });
  test('route: no AI imports, no secrets, window defaults 7D and clamps', () => {
    const r = read('app/api/v1/guidance-upgrades/route.ts');
    assert.ok(!/anthropic|openai|haiku|process\.env/i.test(r.replace(/\/\/.*$/gm, '')));
    assert.match(r, /parseWindow\(sp\.get\('window'\)\)/);
    assert.equal(parseWindow(null), '7D'); assert.equal(parseWindow('nonsense'), '7D'); assert.equal(parseWindow('30d'), '30D'); assert.equal(parseWindow('1Y'), '7D');
    assert.equal(parseMarket('us'), 'US'); assert.equal(parseMarket('zz'), 'ALL');
  });
  test('route is public company data: not under a protected prefix', () => {
    assert.equal(isProtectedApi('/api/v1/guidance-upgrades'), false);
  });
  test('nav, favourites and home chip contain /guidance-upgrades', () => {
    const nav = read('app/(dashboard)/DashboardClient.tsx');
    assert.equal(nav.split("href: '/guidance-upgrades'").length - 1, 2, 'both nav arrays');
    const fav = read('lib/nav-favourites.ts');
    assert.ok(fav.includes("'/guidance-upgrades'"));
    assert.match(fav, /const OFFER: readonly string\[\] = \['\/portfolio-catalysts', '\/exit-radar', '\/ai-gainers', '\/concall-intel\?tab=radar',/);
    assert.match(fav, /OFFER_ALL[^\n]*'\/guidance-upgrades'/);
    assert.match(read('app/(dashboard)/page.tsx'), /href: '\/guidance-upgrades'/);
  });
  test('unverified cards render no decision', () => {
    const bits = read('components/guidance-upgrades/GuBits.tsx');
    assert.match(bits, /if \(!showsDecision\(e\)\) return <Chip[^>]*>UNVERIFIED<\/Chip>/);
    assert.match(read('components/guidance-upgrades/GuCard.tsx'), /!verified && <UnverifiedBanner/);
    assert.equal(showsDecision(ev({ verification: 'UNVERIFIED' })), false);
    assert.equal(showsDecision(ev({ primaryAvailable: false })), false);
    assert.equal(showsDecision(ev({ decision: 'UNVERIFIED' })), false);
    assert.equal(showsDecision(ev()), true);
  });
  test('detail has all 15 sections and the 9-stage chain', () => {
    const d = read('components/guidance-upgrades/GuDetail.tsx');
    for (let i = 1; i <= 15; i++) assert.ok(d.includes(`<Section n={${i}} `), `section ${i}`);
    for (const st of ['EVENT', 'EVIDENCE', 'DRIVER', 'EARNINGS', 'GAP', 'VALUATION', 'DURABILITY', 'RISK', 'ACTION']) assert.ok(d.includes(`'${st}'`), st);
  });
});

describe('formatters', () => {
  test('growth rates show pp, amounts show %, never mixed', () => {
    const rate = { metric: 'REVENUE_GROWTH', before: pt({ metric: 'REVENUE_GROWTH', low: 5, high: 7, midpoint: 6, isGrowthRate: true }), after: pt({ metric: 'REVENUE_GROWTH', low: 8, high: 10, midpoint: 9, isGrowthRate: true }),
      absoluteChange: 3, percentageChange: 50, percentagePointChange: 3, direction: 'UP' } as any;
    assert.equal(fmtDelta(rate), '+3 pp');
    const amt = { metric: 'REVENUE', before: pt({ low: 100, high: 100, midpoint: 100, currency: '$' }), after: pt({ low: 110, high: 110, midpoint: 110, currency: '$' }),
      absoluteChange: 10, percentageChange: 10, percentagePointChange: null, direction: 'UP' } as any;
    assert.equal(fmtDelta(amt), '+10%');
    assert.ok(!fmtDelta(rate)!.includes('%'));
    assert.ok(!/pp/.test(fmtDelta(amt)!));
  });
  test('missing before or delta prints DATA UNAVAILABLE / null, never zero', () => {
    const c = { metric: 'EPS', before: null, after: pt({ metric: 'EPS', low: 2, high: 2, midpoint: 2 }), absoluteChange: null, percentageChange: null, percentagePointChange: null, direction: 'UNKNOWN' } as any;
    const b = fmtBeforeAfter(c);
    assert.equal(b.before, UNAVAILABLE); assert.equal(b.delta, null);
  });
  test('gap note never calls a missing consensus negative', () => {
    assert.equal(gapNote('NEGATIVE', -4.2), 'Guidance up · Guidance vs consensus: -4.2%');
    assert.ok(!/negative/i.test(gapNote('UNKNOWN')));
  });
  test('filters: scope and metric', () => {
    const list = [
      ev({ guidance_event_id: 'a', market: 'IN', materiality: 'LOW', changes: [{ after: pt({ metric: 'EPS' }) }] }),
      ev({ guidance_event_id: 'b', market: 'US', links: { inBook: true }, changes: [{ after: pt({ metric: 'REVENUE' }) }, { after: pt({ metric: 'FCF' }) }] }),
    ];
    assert.deepEqual(applyFilters(list, 'INDIA', 'ALL').map((e) => e.guidance_event_id), ['a']);
    assert.deepEqual(applyFilters(list, 'MY_BOOK', 'ALL').map((e) => e.guidance_event_id), ['b']);
    assert.deepEqual(applyFilters(list, 'HIGH', 'ALL').map((e) => e.guidance_event_id), ['b']);
    assert.deepEqual(applyFilters(list, 'ALL', 'MULTI_METRIC').map((e) => e.guidance_event_id), ['b']);
    assert.deepEqual(applyFilters(list, 'ALL', 'EPS').map((e) => e.guidance_event_id), ['a']);
    assert.ok(metricFamilies(list[1]).includes('FCF'));
  });
});

describe('book overlay and candidates', () => {
  test('overlay marks only held names and never sets a decision', () => {
    const out = overlayBook([ev({ ticker: 'AAAA.NS' }), ev({ ticker: 'BBBB' })], ['aaaa'], { AAAA: 'A' });
    assert.equal(out[0].links.inBook, true); assert.equal(out[0].links.bookThesisLabel, 'A'); assert.ok(['SUPPORTS', 'NEUTRAL', 'WEAKENS', 'BROKEN'].includes(out[0].links.portfolioImpact!));
    assert.equal(out[1].links.inBook, false); assert.equal(out[1].links.portfolioImpact, undefined);
    assert.equal(out[0].decision, 'WATCHLIST');
  });
  test('graded row without guidance text is not a candidate; duplicates collapse', () => {
    assert.equal(gradedRowToCandidate({ symbol: 'ZZZZ' }, '2026-09-29'), null);
    const c = gradedRowToCandidate({ symbol: 'ZZZZ', company: 'Zed Test', guidance_text: 'raises FY27 revenue guidance to 10%', filing_date: '2026-09-29' }, '2026-09-29')!;
    assert.equal(c.market, 'IN'); assert.equal(c.kind, 'FILING');
    assert.equal(dedupeCandidates([c, { ...c, id: 'other' }]).length, 1);
  });
});
