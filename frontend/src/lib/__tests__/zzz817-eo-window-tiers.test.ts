// zzz817 — India Earnings Opportunities window: tier chips as filters, a tier
// badge on every card, per-day MIXED/AVOID expanders, a dedupe that never
// loses a company, error rows counted, and the header arithmetic.
// Run: npx tsx --test src/lib/__tests__/zzz817-eo-window-tiers.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  windowEntries, dedupeWindowEntries, mergeWindowDays, normTier,
  parseTierParam, withTierParam, toggleTier, passesTier, countByTier,
  dayGroups, windowIssues, windowTotals, shownElsewhereByDate, hasNoFinancialData,
  withWindowParams, sortByDate,
  type WindowDay, type WindowEntry,
} from '../india-earnings-window';

type Row = {
  ticker: string; company: string; tier: string; composite_score: number;
  filing_date?: string; sales_yoy_pct?: number | null; market_cap_cr?: number | null; price?: number | null;
};
const r = (ticker: string, tier: string, extra: Partial<Row> = {}): Row =>
  ({ ticker, company: ticker + ' Ltd', tier, composite_score: 60, sales_yoy_pct: 20, market_cap_cr: 1000, price: 100, ...extra });
const day = (date: string, rows: Row[], extra: Partial<WindowDay<Row>> = {}): WindowDay<Row> => {
  const by_tier: Record<string, Row[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const x of rows) (by_tier[x.tier] ||= []).push({ ...x, filing_date: date });
  return { date, by_tier, ...extra };
};

// Fri 14 Aug + Thu 13 Aug. DUAL reported on both; RENEW re-filed on 14 Aug
// without numbers; CAPLESS re-filed on 14 Aug without a market cap.
const DAYS: WindowDay<Row>[] = [
  day('2026-08-14', [
    r('BB1', 'BLOCKBUSTER'), r('ST1', 'STRONG'), r('MX1', 'MIXED'), r('MX2', 'MIXED'), r('AV1', 'AVOID'),
    r('DUAL', 'AVOID'),
    r('RENEW', 'AVOID', { sales_yoy_pct: null }),
    r('CAPLESS', 'STRONG', { market_cap_cr: null }),
  ], { dropped: [{ ticker: 'GHOST', reason: 'ghost-filing guard: not on hub' }, { ticker: 'ST1', reason: 'whatever' }] }),
  day('2026-08-13', [
    r('DUAL', 'STRONG'), r('RENEW', 'BLOCKBUSTER'), r('CAPLESS', 'STRONG'), r('MX3', 'MIXED', { price: null }),
  ], { dropped: [{ ticker: 'LATE', reason: "Screener's latest quarter 2026-03-31 is 135d before the filing (new quarter not on Screener yet)" }] }),
];
const { entries, bad } = windowEntries(DAYS);
const find = (rows: any[], t: string) => rows.find((x) => x.ticker === t);

describe('tier filter — multi-select, URL round-trip', () => {
  test('?tier= parses case-insensitively, in the fixed order, invalid names ignored', () => {
    assert.deepEqual(parseTierParam('strong,BLOCKBUSTER,junk'), ['BLOCKBUSTER', 'STRONG']);
    assert.deepEqual(parseTierParam(''), []);
    assert.deepEqual(parseTierParam(null), []);
    assert.deepEqual(parseTierParam('BLOCKBUSTER,STRONG,MIXED,AVOID'), [], 'all four = no filter');
  });
  test('toggle adds and removes (multi-select); "All" is the empty selection', () => {
    let sel = toggleTier([], 'STRONG');
    assert.deepEqual(sel, ['STRONG']);
    sel = toggleTier(sel, 'BLOCKBUSTER');
    assert.deepEqual(sel, ['BLOCKBUSTER', 'STRONG']);
    sel = toggleTier(sel, 'STRONG');
    assert.deepEqual(sel, ['BLOCKBUSTER']);
    assert.deepEqual(toggleTier(['BLOCKBUSTER', 'STRONG', 'MIXED'], 'AVOID'), []);
  });
  test('URL round-trip keeps ?q=, ?w=, ?wv= and the hash', () => {
    const href = withTierParam(withWindowParams('/earnings-opportunities?q=kaynes#x', 60, 'tier'), ['STRONG', 'BLOCKBUSTER']);
    assert.equal(href, '/earnings-opportunities?q=kaynes&w=60&wv=tier&tier=BLOCKBUSTER,STRONG#x');
    const sp = new URL(href, 'http://x').searchParams;
    assert.deepEqual(parseTierParam(sp.get('tier')), ['BLOCKBUSTER', 'STRONG']);
    assert.equal(sp.get('q'), 'kaynes');
    // clearing removes the param and nothing else
    assert.equal(withTierParam(href, []), '/earnings-opportunities?q=kaynes&w=60&wv=tier#x');
    // the window writer leaves ?tier= alone
    assert.ok(withWindowParams(href, 1).includes('tier=BLOCKBUSTER'));
  });
  test('passesTier: empty = everything', () => {
    assert.ok(passesTier({ tier: 'AVOID' }, []));
    assert.ok(passesTier({ tier: 'STRONG' }, ['BLOCKBUSTER', 'STRONG']));
    assert.ok(!passesTier({ tier: 'MIXED' }, ['BLOCKBUSTER', 'STRONG']));
  });
});

describe('tier counts respect the other filters', () => {
  test('no filter: counts add up to the companies listed', () => {
    const rows = dedupeWindowEntries(entries);
    const c = countByTier(rows);
    assert.equal(c.BLOCKBUSTER + c.STRONG + c.MIXED + c.AVOID, rows.length);
  });
  test('with a market-cap filter the counts shrink, and a chip count = what clicking it shows', () => {
    const pass = (e: WindowEntry<Row>) => typeof e.market_cap_cr === 'number' && e.market_cap_cr > 0;
    const rows = dedupeWindowEntries(entries, pass);
    const c = countByTier(rows);
    for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const) {
      assert.equal(rows.filter((x) => passesTier(x, [t])).length, c[t]);
    }
    const multi = rows.filter((x) => passesTier(x, ['BLOCKBUSTER', 'STRONG']));
    assert.equal(multi.length, c.BLOCKBUSTER + c.STRONG);
  });
});

describe('dedupe never loses a company', () => {
  test('latest result wins by default; the older one is listed with its tier', () => {
    const rows = dedupeWindowEntries(entries);
    const d = find(rows, 'DUAL');
    assert.equal(d._window_date, '2026-08-14');
    assert.equal(d.tier, 'AVOID');
    assert.deepEqual(d._earlier, [{ date: '2026-08-13', tier: 'STRONG' }]);
    assert.deepEqual(d._also_reported, ['2026-08-13']);
  });
  test('a newer re-filing WITHOUT financial numbers never hides the graded result', () => {
    const rn = find(dedupeWindowEntries(entries), 'RENEW');
    assert.equal(rn._window_date, '2026-08-13');
    assert.equal(rn.tier, 'BLOCKBUSTER');
    assert.deepEqual(rn._newer, [{ date: '2026-08-14', tier: 'AVOID', why: 'no-data' }]);
  });
  test('when the newest entry fails a filter, the older passing entry is shown (the company stays)', () => {
    const pass = (e: WindowEntry<Row>) => typeof e.market_cap_cr === 'number';
    const cl = find(dedupeWindowEntries(entries, pass), 'CAPLESS');
    assert.ok(cl, 'CAPLESS must not disappear');
    assert.equal(cl._window_date, '2026-08-13');
    assert.deepEqual(cl._newer, [{ date: '2026-08-14', tier: 'STRONG', why: 'filtered' }]);
  });
  test('every company that passes some filter on some date is present, whatever the filter', () => {
    const filters: Array<(e: WindowEntry<Row>) => boolean> = [
      () => true,
      (e) => typeof e.market_cap_cr === 'number',
      (e) => e._window_date === '2026-08-13',
      (e) => e.tier !== 'AVOID',
      (e) => (e.sales_yoy_pct ?? 0) > 0,
    ];
    for (const f of filters) {
      const want = new Set(entries.filter(f).map((e) => e.ticker));
      const got = new Set(dedupeWindowEntries(entries, f).map((e) => e.ticker));
      assert.deepEqual([...got].sort(), [...want].sort());
    }
  });
  test('mergeWindowDays (the unfiltered view) is the same as the dedupe with no filter', () => {
    assert.deepEqual(mergeWindowDays(DAYS).map((x) => x.ticker).sort(), dedupeWindowEntries(entries).map((x) => x.ticker).sort());
  });
});

describe('rows that cannot be a card are counted, not dropped', () => {
  test('lower-case tier names are repaired; symbol-only rows are repaired; unknown tiers and ticker-less rows are counted', () => {
    const legacy: WindowDay<any> = {
      date: '2026-08-12',
      by_tier: {
        strong: [{ symbol: 'OLDSYM', company: 'Old Sym Ltd', tier: 'strong', composite_score: 70 }],
        WATCH: [{ ticker: 'ODD', company: 'Odd Ltd', tier: 'WATCH' }],
        MIXED: [{ company: 'No Ticker Ltd', tier: 'MIXED' }],
      },
      engine_stale: true, engine: 'v22',
    };
    const w = windowEntries([legacy]);
    assert.deepEqual(w.entries.map((e) => `${e.ticker}:${e.tier}`), ['OLDSYM:STRONG']);
    assert.equal(w.bad.length, 2);
    assert.ok(w.bad.some((b) => b.ticker === 'ODD' && /unrecognised tier/.test(b.reason)));
    assert.ok(w.bad.some((b) => /no ticker/.test(b.reason)));
    assert.equal(normTier('blockbuster'), 'BLOCKBUSTER');
    assert.equal(normTier('WATCH'), null);
  });
  test('windowIssues counts not-graded filings (minus ones graded elsewhere), no-data cards, no-price cards and bad rows', () => {
    const rows = dedupeWindowEntries(entries);
    const iss = windowIssues(DAYS, entries, [{ date: '2026-08-14', ticker: 'ODD', reason: 'unrecognised tier "WATCH"' }], rows);
    assert.deepEqual(iss.notGraded.map((x) => x.ticker).sort(), ['GHOST', 'LATE'], 'ST1 was graded, so it is not "missing"');
    assert.equal(iss.notGraded.find((x) => x.ticker === 'LATE')!.reason, 'new quarter not on Screener yet');
    assert.equal(iss.notGraded.find((x) => x.ticker === 'GHOST')!.reason, 'no confirmed filing');
    assert.equal(iss.badRows.length, 1);
    assert.equal(iss.noData.length, 0, 'RENEW shows its graded 13 Aug result, which has numbers');
    assert.equal(iss.noPrice, 1);                 // MX3
    assert.equal(iss.total, 2 + 1 + 0);
    assert.equal(iss.byDate['2026-08-14'], 2);    // GHOST + ODD
    assert.equal(iss.byDate['2026-08-13'], 1);    // LATE
  });
  test('a lone no-data card is shown AND counted', () => {
    const w = windowEntries([day('2026-08-14', [r('NODATA', 'AVOID', { sales_yoy_pct: null })])]);
    const rows = dedupeWindowEntries(w.entries);
    assert.equal(rows.length, 1);
    assert.ok(hasNoFinancialData(rows[0]));
    assert.equal(windowIssues([], w.entries, [], rows).noData.length, 1);
  });
  test('a day built while the results feed was down is flagged partial', () => {
    const iss = windowIssues([day('2026-08-10', [r('A', 'STRONG')], { hub_fail: 'hub timeout' })], [], [], []);
    assert.deepEqual(iss.partialDays, ['2026-08-10']);
  });
});

describe('per-day expanders', () => {
  const rows = dedupeWindowEntries(entries);
  test('with no filter each day shows BLOCKBUSTER/STRONG and folds its own MIXED/AVOID', () => {
    const g = dayGroups(rows);
    const d14 = g.find((x) => x.date === '2026-08-14')!;
    // 14 Aug rows: BB1, ST1, MX1, MX2, AV1, DUAL(AVOID), CAPLESS(STRONG)  — RENEW moved to 13 Aug
    assert.equal(d14.rows.length, 7);
    assert.deepEqual(d14.counts, { BLOCKBUSTER: 1, STRONG: 2, MIXED: 2, AVOID: 2 });
    assert.deepEqual(d14.folded, { MIXED: 2, AVOID: 2 });
    assert.deepEqual(d14.visible.map((x) => x.ticker).sort(), ['BB1', 'CAPLESS', 'ST1']);
    assert.equal(d14.visible[0].ticker, 'BB1');
    assert.ok(d14.visible.every((x) => x.tier === 'BLOCKBUSTER' || x.tier === 'STRONG'));
    assert.equal(d14.visible.length + d14.folded.MIXED + d14.folded.AVOID, d14.rows.length);
  });
  test('opening one day unfolds only that day', () => {
    const g = dayGroups(rows, { openDays: new Set(['2026-08-14']) });
    assert.deepEqual(g.find((x) => x.date === '2026-08-14')!.folded, { MIXED: 0, AVOID: 0 });
    assert.deepEqual(g.find((x) => x.date === '2026-08-13')!.folded, { MIXED: 1, AVOID: 0 });
  });
  test('a tier filter (showAll) shows everything it selects', () => {
    const sel = rows.filter((x) => passesTier(x, ['MIXED']));
    const g = dayGroups(sel, { showAll: true });
    assert.equal(g.reduce((n, x) => n + x.visible.length, 0), sel.length);
    assert.ok(g.every((x) => x.folded.MIXED === 0 && x.folded.AVOID === 0));
  });
  test('the searched-for card is never folded', () => {
    const g = dayGroups(rows, { keep: (x) => x.ticker === 'MX1' });
    assert.ok(g.find((x) => x.date === '2026-08-14')!.visible.some((x) => x.ticker === 'MX1'));
  });
  test('order: newest date first, BLOCKBUSTER → STRONG → MIXED → AVOID inside a day', () => {
    const g = dayGroups(rows, { showAll: true });
    assert.deepEqual(g.map((x) => x.date), ['2026-08-14', '2026-08-13']);
    const rank: Record<string, number> = { BLOCKBUSTER: 0, STRONG: 1, MIXED: 2, AVOID: 3 };
    for (const x of g) for (let i = 1; i < x.visible.length; i++) assert.ok(rank[x.visible[i - 1].tier] <= rank[x.visible[i].tier]);
  });
  test('companies listed under another date are counted on the date they are not shown', () => {
    const other = shownElsewhereByDate(rows);
    assert.equal(other['2026-08-13'], 2);   // DUAL, CAPLESS — shown on 14 Aug
    assert.equal(other['2026-08-14'], 1);   // RENEW — its 14 Aug re-filing had no numbers, shown on 13 Aug
  });
});

describe('header arithmetic', () => {
  test('results − repeats = companies, stated plainly', () => {
    const rows = dedupeWindowEntries(entries);
    const t = windowTotals(DAYS, entries, rows);
    assert.equal(t.results, 12);      // 8 + 4
    assert.equal(t.daysLoaded, 2);
    assert.equal(t.companies, 9);     // DUAL, RENEW, CAPLESS counted once each
    assert.equal(t.repeated, 3);
    assert.equal(t.results - t.companies, 3);
    assert.equal(t.line, '12 results across 2 days = 9 companies (3 reported on more than one date — latest shown)');
    // per-day counts + "shown on a later date" add back up to the results
    const g = sortByDate(rows);
    const later = shownElsewhereByDate(rows);
    const sum = g.reduce((n, x) => n + x.rows.length + (later[x.date] || 0), 0);
    assert.equal(sum, t.results);
  });
  test('same-day NSE/BSE duplicates are named separately', () => {
    const w = windowEntries([day('2026-08-14', [
      { ...r('DJML', 'STRONG'), company: 'DJ Mediaprint & Logistics Ltd' },
      { ...r('543193', 'STRONG'), company: 'DJ Mediaprint & Logistics Limited' },
    ])]);
    const t = windowTotals([], w.entries, dedupeWindowEntries(w.entries));
    assert.equal(t.companies, 1);
    assert.equal(t.sameDayDupes, 1);
    assert.match(t.line, /1 NSE\/BSE duplicate merged/);
  });
  test('no repeats says so', () => {
    const w = windowEntries([day('2026-08-14', [r('A', 'STRONG'), r('B', 'MIXED')])]);
    assert.equal(windowTotals([day('2026-08-14', [])], w.entries, dedupeWindowEntries(w.entries)).line,
      '2 results across 1 day = 2 companies (no company reported twice)');
  });
});

describe('page wiring (source checks)', () => {
  const page = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities', 'page.tsx'), 'utf8');
  const hook = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities', 'useIndiaEarningsWindow.ts'), 'utf8');
  test('every card carries a tier badge (one card component, used by every view)', () => {
    const card = page.slice(page.indexOf('function EarningsCard('));
    assert.ok(card.includes('<TierBadge tier={stock.tier} />'));
    assert.ok(page.includes('function TierBadge('));
    for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) assert.ok(page.includes(`label: '${t}'`));
    // every card render site goes through EarningsCard
    assert.equal((page.match(/<EarningsCard /g) || []).length, 4);   // zzz1158: + the card graded on another day
  });
  test('tier chips are buttons that filter, with an All reset, kept in the URL', () => {
    assert.ok(page.includes('setTierSel((sel) => toggleTier(sel, c.tier))'));
    assert.ok(page.includes('onClick={() => setTierSel([])}'));
    assert.ok(page.includes('withTierParam(withWindowParams(cur, windowDays, windowView), tierSel)'));
    assert.ok(page.includes("setTierSel(parseTierParam(sp.get('tier')))"));
    assert.ok(page.includes('if (!passesTier({ tier }, tierSel)) stocks = [];'), 'single-date view filters too');
  });
  test('exports respect the tier filter', () => {
    assert.ok(page.includes('windowFiltered.filter((r) => passesTier(r, tierSel))'));
  });
  test('no global MIXED/AVOID collapse in the window; each day has its own expander', () => {
    assert.ok(!page.includes('hiddenByTier'));
    assert.ok(page.includes('eo-day-expander'));
  });
  test('the hook keeps the dropped list and never leaves a date stuck on "loading"', () => {
    assert.ok(hook.includes('_dropped'));
    assert.ok(hook.includes("the graded store did not answer for this date"));
    assert.ok(!/store\.delete\(d\);\n\s*\}\n\s*\} catch/.test(hook));
  });
  test('page.tsx still has only the default export', () => {
    assert.deepEqual(page.split('\n').filter((l) => /^export\s/.test(l) && !/^export default function/.test(l)), []);
  });
});
