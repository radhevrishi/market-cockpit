// zzz848 — Guidance Upgrades restructure: universe summary, display strings, sort, zero-event wording, 120D, independence from window, wording.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  GU_WINDOWS, fmtUniverseCounts, fmtGrowthDisplay, universeRowText, numberedRows, sortUniverse, universeUrl, zeroEventWording, coverage120, coverageState,
  COVERAGE_120_INCOMPLETE, universeSummaryLines, verificationMark, filterUniverse, isUniverseUsable, investigatedCount, cagrLabel, UNIVERSE_HEADER, SCAN_STATE_LABEL,
} from '../guidance-upgrades-format';

const pt = (o: any = {}) => ({ metric: 'REVENUE', kind: 'MANAGEMENT_GUIDANCE', growthLow: 60, growthHigh: 60, growthOrigin: 'STATED', period: 'FY27', periodKind: 'FY', ...o });
const rec = (company: string, o: any = {}): any => {
  const { primary, verification = 'VERIFIED', display, also = [], quality = 'HIGH', mediaOnly = false, market = 'IN', others = [], ...rest } = o;
  return {
    origin: 'LIVE', display: display ?? '+60%', metric: 'REVENUE', alsoDisplay: also, mediaOnly, revision: 'NONE', atRisk: false, ...rest,
    record: { id: company, company, ticker: company.slice(0, 4).toUpperCase(), market, primary: primary || pt(), others, verification, quality, sources: [{ name: 'Filing', rank: 1, type: 'Exchange filing', date: '2026-09-01', primary: true }] },
  };
};
const scan = (o: any = {}): any => ({ market: 'IN', complete: false, daysCovered: 90, daysRequested: 120, candidatesFound: 50, processed: 40, awaitingGrading: 7, verified: 3, sources: [{ name: 'Exchange filings', state: 'PARTIAL', scanned: 40, detail: '' }], ...o });

describe('summary numbers', () => {
  test('India | USA format', () => assert.equal(fmtUniverseCounts(20, 14), 'India 20 | USA 14'));
  test('lines come from the summary only', () => {
    const s: any = { asOf: 'x', threshold: 30, india: { companies: 23, revenueGte30: 20, patGte30: 11, revenueAndPatGte30: 9, highestRevenue: { company: 'MTAR', display: '+80%+' } }, usa: { companies: 5, revenueGte30: 4, patGte30: 3, revenueAndPatGte30: 2, highestRevenue: null }, all: { active: 28, raised: 6, maintained: 15, cut: 2, atRisk: 3, mediaOnly: 4 } };
    const inl = universeSummaryLines(s, 'IN').map((l) => `${l.label} ${l.value}`).join(' | ');
    assert.match(inl, /23 companies currently identified/); assert.match(inl, /MTAR \+80%\+/);
    assert.match(universeSummaryLines(s, 'US').map((l) => l.value).join(' '), /—/);
    const all = universeSummaryLines(s, 'ALL');
    assert.ok(all.some((l) => /Media-only, primary pending/.test(l.label) && l.value === '4'));
    assert.ok(all.some((l) => /Active high-growth/.test(l.label) && /India 23 \| USA 5/.test(l.value)));
  });
});

describe('display strings', () => {
  test('ranges kept, never midpoint', () => assert.equal(fmtGrowthDisplay(pt({ growthLow: 35, growthHigh: 40 }) as any), '+35–40%'));
  test('point', () => assert.equal(fmtGrowthDisplay(pt() as any), '+60%'));
  test('open-ended', () => assert.equal(fmtGrowthDisplay(pt({ growthLow: 80, growthHigh: null }) as any), '+80%+'));
  test('implied', () => assert.match(fmtGrowthDisplay(pt({ growthOrigin: 'IMPLIED' }) as any), /\(implied\)/));
  test('multi-year', () => { assert.match(fmtGrowthDisplay(pt({ periodKind: 'MULTI_YEAR_CAGR', period: '3 years' }) as any), /3-yr CAGR/); assert.equal(cagrLabel('FY26–29'), '3-yr CAGR'); });
  test('rows with secondary metric', () => {
    assert.equal(universeRowText(rec('MTAR', { display: '+80%+' })), 'MTAR — +80%+ Revenue');
    assert.equal(universeRowText(rec('Cupid', { display: '+60%', also: [{ metric: 'PAT', display: '+70%', verification: 'VERIFIED' }] })), 'Cupid — +60% Revenue / +70% PAT');
    assert.equal(numberedRows([rec('A'), rec('B')])[1], '2. B — +60% Revenue');
  });
  test('implied and multi-year labels added over a bare server display', () => {
    assert.match(universeRowText(rec('X', { display: '+45%', primary: pt({ growthOrigin: 'IMPLIED' }) })), /implied/);
    assert.match(universeRowText(rec('Y', { display: '+25%', primary: pt({ periodKind: 'MULTI_YEAR_CAGR', period: 'FY26–29' }) })), /3-yr CAGR/);
  });
  test('verification marks', () => {
    assert.equal(verificationMark(rec('a')).glyph, '✓'); assert.equal(verificationMark(rec('a', { verification: 'PARTIALLY_VERIFIED' })).glyph, '◐');
    assert.equal(verificationMark(rec('a', { mediaOnly: true })).glyph, '○'); assert.equal(verificationMark(rec('a', { verification: 'SECONDARY_ONLY' })).label, 'media-only');
  });
});

describe('sort order', () => {
  const names = (l: any[]) => l.map((r) => r.record.company);
  test('verified revenue floor first, then ceiling, then evidence', () => {
    const l = sortUniverse([
      rec('Low', { primary: pt({ growthLow: 40, growthHigh: 40 }) }),
      rec('MediaHigh', { primary: pt({ growthLow: 90, growthHigh: 90 }), verification: 'SECONDARY_ONLY', mediaOnly: true }),
      rec('Top', { primary: pt({ growthLow: 80, growthHigh: 80 }) }),
      rec('WideRange', { primary: pt({ growthLow: 60, growthHigh: 80 }) }),
      rec('PointSixty', { primary: pt({ growthLow: 60, growthHigh: 60 }), quality: 'MEDIUM' }),
      rec('PointSixtyHi', { primary: pt({ growthLow: 60, growthHigh: 60 }), quality: 'HIGH' }),
    ]);
    assert.deepEqual(names(l), ['Top', 'WideRange', 'PointSixtyHi', 'PointSixty', 'Low', 'MediaHigh']);
  });
  test('does not mutate input', () => { const a = [rec('B', { primary: pt({ growthLow: 10, growthHigh: 10 }) }), rec('A')]; sortUniverse(a); assert.equal(a[0].record.company, 'B'); });
});

describe('zero-event wording', () => {
  test('incomplete', () => {
    const t = zeroEventWording('30D', { IN: scan(), US: scan({ market: 'US', awaitingGrading: 5 }) });
    assert.match(t, /^No additional verified upgrades found in currently processed sources\. 12 filings remain awaiting grading\./);
    assert.match(t, /Zero events shown is NOT a confirmation of no upgrades/);
  });
  test('complete', () => assert.equal(zeroEventWording('7D', { IN: scan({ complete: true }) }), 'No verified upgrades found in the fully processed 7D source universe.'));
  test('never the bare phrase', () => {
    for (const t of [zeroEventWording('7D', undefined), zeroEventWording('7D', { IN: scan() }), zeroEventWording('120D', { IN: scan({ complete: true }) })]) assert.ok(!/No upgrades found/i.test(t));
  });
});

describe('120D chips and coverage', () => {
  test('window chip list order', () => assert.deepEqual(GU_WINDOWS, ['24H', '3D', '7D', '14D', '30D', '120D']));
  test('coverage incomplete phrase', () => {
    const c = coverage120(scan());
    assert.deepEqual([c.days, c.sources, c.unprocessed, c.missing, c.incomplete, c.state], ['90/120', 1, 7, 30, true, 'PARTIAL']);
    assert.equal(COVERAGE_120_INCOMPLETE, '120D coverage incomplete');
    assert.equal(coverage120(scan({ daysCovered: 120, complete: true, sources: [{ name: 'a', state: 'COMPLETE', scanned: 1, detail: '' }] })).incomplete, false);
    assert.equal(coverage120(scan({ daysCovered: 120, complete: false })).incomplete, true);
  });
  test('state chips', () => {
    assert.equal(coverageState(scan({ sources: [] })), 'NOT_AVAILABLE');
    assert.equal(coverageState(scan({ sources: [{ name: 'a', state: 'NOT_AVAILABLE' }] })), 'NOT_AVAILABLE');
    assert.equal(coverageState(scan({ sources: [{ name: 'a', state: 'FAILED' }] })), 'FAILED');
    assert.equal(coverageState(scan({ complete: true, sources: [{ name: 'a', state: 'COMPLETE' }] })), 'COMPLETE');
    assert.equal(SCAN_STATE_LABEL.NOT_AVAILABLE, 'NOT AVAILABLE');
  });
});

describe('universe is independent of the event window', () => {
  test('url has no window parameter', () => {
    for (const u of [universeUrl(), universeUrl({ market: 'IN', metric: 'PAT', view: 'all', threshold: 40 })]) { assert.ok(!/window/i.test(u), u); assert.match(u, /^\/api\/v1\/guidance-universe\?/); }
    assert.match(universeUrl({ market: 'US' }), /market=US/); assert.match(universeUrl(), /threshold=30/); assert.match(universeUrl(), /view=active/);
  });
  const SRC = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
  test('universe components and hook never touch the window state', () => {
    for (const f of ['useGuUniverse.ts', 'GuUniverseSummary.tsx', 'GuUniverseBrowser.tsx', 'GuUniverseList.tsx']) {
      const s = read(`components/guidance-upgrades/${f}`);
      assert.ok(!/window_|GuWindow|[?&]window=/.test(s), f);
    }
  });
  test('page passes no window to the universe sections and does not refetch them on window change', () => {
    const s = read('app/(dashboard)/guidance-upgrades/page.tsx');
    assert.ok(/<GuUniverseSummary [^>]*\/>/.test(s) && !/<GuUniverseSummary [^>]*window/.test(s));
    assert.ok(/<GuUniverseBrowser [^>]*\/>/.test(s) && !/<GuUniverseBrowser [^>]*window/.test(s));
    assert.ok(s.indexOf('GuUniverseSummary') < s.indexOf('<GuUniverseBrowser') && s.indexOf('<GuUniverseBrowser') < s.indexOf('<GuTopBar') && s.indexOf('<GuTopBar') < s.indexOf('<GuCoverage'));
    assert.ok(s.indexOf('<GuTitle') < s.indexOf('<GuUniverseSummary'));
  });
  test('filters and unusable answers', () => {
    const l = [rec('A', { market: 'IN' }), rec('B', { market: 'US', others: [pt({ metric: 'PAT' })] }), rec('C', { market: 'IN', primary: pt({ periodKind: 'MULTI_YEAR_CAGR' }) })];
    assert.equal(filterUniverse(l, 'USA', 'ALL').length, 1); assert.equal(filterUniverse(l, 'ALL', 'MULTI_METRIC').length, 1);
    assert.equal(filterUniverse(l, 'ALL', 'MULTI_YEAR').length, 1); assert.equal(filterUniverse(l, 'ALL', 'NET_PROFIT').length, 1);
    assert.equal(filterUniverse(l, 'MY_BOOK', 'ALL', (t) => t === 'A').length, 1);
    assert.equal(isUniverseUsable(null), false); assert.equal(isUniverseUsable({ records: [], summary: {} }), false);
  });
  test('diagnostics count header', () => assert.equal(investigatedCount({ VERIFIED: 12, NOT_FOUND: 8 }, 20), '20/20 investigated'));
});

describe('wording', () => {
  const dir = join(__dirname, '..', '..', 'components', 'guidance-upgrades');
  const files = [...readdirSync(dir).map((f) => join(dir, f)), join(__dirname, '..', 'guidance-upgrades-format.ts'), join(__dirname, '..', '..', 'app', '(dashboard)', 'guidance-upgrades', 'page.tsx'), join(__dirname, '..', '..', 'app', '(dashboard)', 'guidance-diagnostics', 'page.tsx')];
  test('header says Highest verified guidance', () => assert.equal(UNIVERSE_HEADER, 'Highest verified guidance'));
  test('no best / top stocks, no BUY/SELL beyond IMMEDIATE BUY, no /100', () => {
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      assert.ok(!/\bbest\b/i.test(t), `${f}: best`); assert.ok(!/top stocks?/i.test(t), `${f}: top stocks`);
      for (const m of t.matchAll(/\b(BUY|SELL|STRONG BUY|ACCUMULATE|REDUCE)\b/g)) assert.equal(t.slice(m.index! - 10, m.index! + 3), 'IMMEDIATE BUY', `${f}: ${m[0]}`);
      assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(t), f);
      assert.ok(!/No upgrades found/i.test(t), f);
    }
  });
  test('no dark fills', () => { for (const f of files) assert.ok(!/background:\s*'#(0|1)[0-9a-f]{5}'/i.test(readFileSync(f, 'utf8')), f); });
});
