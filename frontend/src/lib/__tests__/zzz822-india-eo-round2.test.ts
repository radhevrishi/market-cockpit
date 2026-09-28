// zzz822 — India Earnings Opportunities, round 2 (owner's live 60d page):
// entities, liquidity, one size-band table, lender detection + cash tile,
// cap reason once, refill threshold, stale-rule rebuild, window badges.
// Run: npx tsx --test src/lib/__tests__/zzz822-india-eo-round2.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeEntities, decodeRowText, prepareDisplayPayload, capReasonOf, caveatTagsForDisplay, narrativeForDisplay,
  stripCapReasonFromText, liquidityView, MAX_PLAUSIBLE_DAILY_TURNOVER_PCT, CAP_BUCKETS, capBucket, capInBand,
  financialKind, financialKindOfRow, marginView, cashTileView, missingDetailCounts, orderStaleRebuilds, pickStaleRebuild,
} from '../india-eo-card-data';
import { windowEntries, windowCsv } from '../india-earnings-window';

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');
const PAGE = () => read('(dashboard)', 'earnings-opportunities', 'page.tsx');

describe('D1 · HTML entities decoded everywhere', () => {
  test('names from the live page', () => {
    assert.equal(decodeEntities('Knowledge Marine &amp; Engineering Works Ltd'), 'Knowledge Marine & Engineering Works Ltd');
    assert.equal(decodeEntities('B&amp;B Triplewall Containers Ltd'), 'B&B Triplewall Containers Ltd');
    assert.equal(decodeEntities('IL&amp;FS Transportation'), 'IL&FS Transportation');
    assert.equal(decodeEntities('Amines &amp;amp; Plasticizers'), 'Amines & Plasticizers');   // double-encoded
    assert.equal(decodeEntities('A &#38; B &#x26; C'), 'A & B & C');
    assert.equal(decodeEntities('Prince Pipes & Fittings Ltd'), 'Prince Pipes & Fittings Ltd');   // untouched
    assert.equal(decodeEntities('R&D &unknown; ok'), 'R&D &unknown; ok');
  });
  test('rows, window entries and the CSV carry decoded text', () => {
    const r = { ticker: 'BBTCL', company: 'B&amp;B Triplewall Containers Ltd', tier: 'STRONG', narrative: 'B&amp;B Triplewall delivers strong Q1 FY27.', caveat_tags: ['x &amp; y'] };
    const d = decodeRowText(r);
    assert.equal(d.company, 'B&B Triplewall Containers Ltd');
    assert.equal(d.caveat_tags[0], 'x & y');
    const p = prepareDisplayPayload({ by_tier: { STRONG: [r] } });
    assert.equal(p.by_tier.STRONG[0].company, 'B&B Triplewall Containers Ltd');
    const { entries } = windowEntries([{ date: '2026-08-14', by_tier: { STRONG: [r as any] } }]);
    assert.equal(entries[0].company, 'B&B Triplewall Containers Ltd');
    const csv = windowCsv([{ ...r, _window_date: '2026-08-14', _also_reported: [] }]);
    assert.ok(!csv.includes('&amp;'));
    assert.ok(csv.includes('B&B Triplewall'));
  });
});

describe('D2 · liquidity: a believable daily average or —', () => {
  test('the five impossible figures are not shown (results-day turnover)', () => {
    for (const [adtv, mcap] of [[1415, 12242], [1611, 15269], [1652, 21227], [532, 2864], [382, 2846]]) {
      const v = liquidityView({ adtv_cr: adtv, adtv_days: 20, market_cap_cr: mcap });
      assert.equal(v.cr, null, `${adtv}/${mcap}`);
      assert.equal(v.note, 'not a daily average');
    }
    assert.equal(MAX_PLAUSIBLE_DAILY_TURNOVER_PCT, 5);
  });
  test('plausible averages are kept; an explicit multi-day average wins; unknown is —', () => {
    assert.equal(liquidityView({ adtv_cr: 779, adtv_days: 20, market_cap_cr: 127810 }).cr, 779);
    assert.equal(liquidityView({ adtv_cr: 1415, adtv_20d_cr: 60, market_cap_cr: 12242 }).cr, 60);
    assert.equal(liquidityView({}).cr, null);
    assert.equal(liquidityView({}).note, 'not in source');
  });
});

describe('D3 · one size-band table for labels and the filter', () => {
  test('bands (the Mkt Cap filter\'s own thresholds)', () => {
    assert.deepEqual(CAP_BUCKETS.map((b) => [b.key, b.min]), [['MEGA', 200000], ['LARGE', 20000], ['MID', 5000], ['SMALL', 500], ['MICRO', 0]]);
    assert.equal(capBucket(127810), 'LARGE');   // Apollo
    assert.equal(capBucket(217159), 'MEGA');    // Grasim
    assert.equal(capBucket(41891), 'LARGE');    // BDL
    assert.equal(capBucket(12153), 'MID');      // NSLNISP
    assert.equal(capBucket(115), 'MICRO');
    assert.equal(capBucket(null), null);
  });
  test('the filter and the label agree for every band', () => {
    for (const cr of [100, 499, 500, 4999, 5000, 19999, 20000, 199999, 200000, 900000]) {
      const b = capBucket(cr)!;
      assert.ok(capInBand(cr, b.toLowerCase()), `${cr} in ${b}`);
      for (const o of CAP_BUCKETS) if (o.key !== b) assert.ok(!capInBand(cr, o.key.toLowerCase()));
    }
    assert.ok(capInBand(12000, 'sweet')); assert.ok(!capInBand(60000, 'sweet'));
    assert.ok(capInBand(null, 'all')); assert.ok(!capInBand(null, 'mid'));
  });
  test('page: every card with a cap gets the label (outside the opt-in badges); filter options come from the table', () => {
    const page = PAGE();
    assert.ok(page.includes('{capBucket(stock.market_cap_cr)}'));
    assert.ok(page.includes('{CAP_BUCKETS.map((b) => ('));
    assert.ok(!page.includes('stock.market_cap_bucket && stock.market_cap_bucket !== \'UNKNOWN\''));
    assert.ok(page.includes('return capInBand(cr, f);'));
  });
});

describe('D4 · lenders / insurers (never tickers) and the cash tile', () => {
  test('Financial Holdings, insurers, engine lender tag', () => {
    assert.equal(financialKind({ company: 'Cholamandalam Financial Holdings Ltd' }), 'lender');
    assert.equal(financialKind({ company: 'Max Financial Services Ltd', industry: 'Life Insurance' }), 'insurer');
    assert.equal(financialKind({ company: 'X Ltd', broad_industry: 'Insurance' }), 'insurer');
    assert.equal(financialKindOfRow({ company: 'Some Holding Ltd', caveat_tags: ['lender — operating cash flow is loan growth'] }), 'lender');
    assert.equal(financialKindOfRow({ company: 'Some Co', financial_kind: 'insurer' }), 'insurer');
    assert.equal(financialKind({ company: 'Aksh Optifibre Ltd' }), null);
    assert.equal(financialKind({ company: 'Automotive Stampings &amp; Assemblies Ltd' }), null);
  });
  test('Cholamandalam: net margin, not OPM 16.1%; cash tile not meaningful', () => {
    const r = { company: 'Cholamandalam Financial Holdings Ltd', opm_pct: 16.1, ocf_to_pat_ratio: -16.79, sales_curr_cr: 9000, pat_curr_cr: 1300 };
    assert.equal(marginView(r).mode, 'net');
    const c = cashTileView(r);
    assert.equal(c.text, '—'); assert.equal(c.note, 'not meaningful for lenders');
  });
});

describe('D5 · cash tile', () => {
  test('0.00x is missing data; the engine basis shows when present', () => {
    assert.deepEqual(cashTileView({ company: 'Aksh Optifibre Ltd', ocf_to_pat_ratio: 0 }), { text: '—', note: 'not in source', color: 'none', basis: null });
    const v = cashTileView({ company: 'Foo Ltd', ocf_to_pat_ratio: 1.23, cash_basis: 'FY26 full year' });
    assert.equal(v.text, '1.23x'); assert.equal(v.basis, 'FY26 full year'); assert.equal(v.color, 'good');
    assert.equal(cashTileView({ company: 'Foo Ltd', ocf_to_pat_ratio: 0.4, cash_fy: 'Mar 2026' }).basis, 'Mar 2026 full year');
    assert.equal(cashTileView({ company: 'Foo Ltd', ocf_to_pat_ratio: -2.67 }).note, 'operations burned cash');
  });
  test('page renders the basis line', () => {
    const page = PAGE();
    assert.ok(page.includes('<CashTile v={cashTileView(stock)} />'));
    assert.ok(page.includes('{v.basis && ('));
  });
});

describe('D6 · the cap reason appears once (under the badge)', () => {
  const r = {
    tier_cap_reason: 'Capped at STRONG: open flag: optical eps',
    caveat_tags: ['optical eps', 'Capped at STRONG: open flag: optical eps'],
    narrative: 'Sterlite Technologies Ltd delivers strong Q1 FY27 (revenue +87% YoY) with caveats: optical eps + Capped at STRONG: open flag: optical eps.',
  };
  test('stripped from chips and the summary', () => {
    assert.equal(capReasonOf(r), 'Capped at STRONG: open flag: optical eps');
    assert.deepEqual(caveatTagsForDisplay(r), ['optical eps']);
    assert.equal(narrativeForDisplay(r), 'Sterlite Technologies Ltd delivers strong Q1 FY27 (revenue +87% YoY) with caveat: optical eps.');
  });
  test('only clause → "with caveat:" goes too; old rows without the field are cleaned by pattern', () => {
    assert.equal(stripCapReasonFromText('Apar delivers strong Q1 FY27 (revenue +29% YoY) with caveat: Capped at STRONG: thin operating margin (11%).', 'Capped at STRONG: thin operating margin (11%)'),
      'Apar delivers strong Q1 FY27 (revenue +29% YoY).');
    assert.equal(stripCapReasonFromText('X delivers strong Q1 FY27 with caveats: optical eps + Capped at STRONG: profit jump is off a tiny year-ago profit (₹12 Cr), so the % is arithmetic, not growth; open flag: optical eps.', null),
      'X delivers strong Q1 FY27 with caveat: optical eps.');
    assert.equal(stripCapReasonFromText('Y delivers strong Q1 FY27 with caveats: optical eps + Capped at STRONG: cash does not back the profit (operating cash 0.45× profit) + low quality.', 'Capped at STRONG: cash does not back the profit (operating cash 0.45× profit)'),
      'Y delivers strong Q1 FY27 with caveats: optical eps + low quality.');
    assert.deepEqual(caveatTagsForDisplay({ caveat_tags: ['Capped at MIXED: revenue fell 3%', 'ocf divergence'] }), ['ocf divergence']);
  });
  test('page: chips read caveatTagsForDisplay, the line reads capReasonOf', () => {
    const page = PAGE();
    assert.ok(page.includes('{_cavs.map((t) => {'));
    assert.ok(page.includes('{capReasonOf(stock)}'));
    assert.ok(!page.includes('{stock.caveat_tags.map('));
  });
});

describe('D7 / D8 · refill and stale-rule rebuild are scheduled and bounded', () => {
  test('missing-detail counts', () => {
    assert.deepEqual(missingDetailCounts({ by_tier: {
      STRONG: [{ sales_yoy_pct: 10, price: 5 }, { price: 0 }],
      MIXED: [{ eps_curr: 1, current_price: 10 }, { sales_curr_cr: null }],
    } }), { noData: 2, noPrice: 2 });
  });
  test('oldest rules first, then oldest date; locked dates skipped', async () => {
    const legacy = ['v24', 'v23', 'v14', 'v10'];
    const stale = [{ date: '2026-07-25', version: 'v14' }, { date: '2026-07-20', version: 'v14' }, { date: '2026-07-28', version: 'v10' }];
    assert.deepEqual(orderStaleRebuilds(stale, legacy).map((x) => x.date), ['2026-07-28', '2026-07-20', '2026-07-25']);
    assert.deepEqual(await pickStaleRebuild(stale, legacy, async (d) => d === '2026-07-28'), { date: '2026-07-20', version: 'v14' });
    assert.equal(await pickStaleRebuild(stale, legacy, async () => true), null);
    assert.equal(await pickStaleRebuild(null, legacy, async () => false), null);
  });
  test('cron: fill at ≥1 card with a per-date lock, 60-day window, stale rebuild budget + lock + EXISTS-only scan', () => {
    const cron = read('api', 'v1', 'cron', 'prewarm-earnings', 'route.ts');
    assert.match(cron, /const FILL_THRESHOLD = 1;/);
    assert.match(cron, /graded:fill-lock:\$\{date\}/);
    assert.match(cron, /const WINDOW_DAYS = 60;/);
    assert.match(cron, /const STALE_BUDGET = 1;/);
    assert.match(cron, /graded:stale-rebuild-lock:/);
    assert.match(cron, /\['EXISTS', k\]/);
    assert.match(cron, /INDIA_REGRADABLE_FROM/);
    assert.match(cron, /noPrice > 0/);
  });
  test('header says the old-rule dates are being rebuilt automatically', () => {
    assert.ok(PAGE().includes('being rebuilt automatically under the current rules, oldest rules first'));
  });
});

describe('D9 · no single-date badges in window mode', () => {
  test('enriched chip and sources-polled line are single-date only', () => {
    const page = PAGE();
    assert.ok(page.includes('{resolvedDateForGrading && !windowOn && (() => {'));
    assert.ok(page.includes("'Market closed · window shows stored grades'"));
  });
  test('page.tsx still has no named exports', () => {
    assert.deepEqual(PAGE().split('\n').filter((l) => /^export\s+(?!default\b)/.test(l)), []);
  });
});
