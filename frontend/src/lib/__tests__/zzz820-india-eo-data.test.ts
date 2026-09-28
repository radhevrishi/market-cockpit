// zzz820 — India Earnings Opportunities: is the data on the card correct?
// Quarter labels, year-ago matching, margins for lenders and "0.0%" unknowns,
// words instead of 0–100 scores, honest drop reasons and the re-check budget.
// Run: npx tsx --test src/lib/__tests__/zzz820-india-eo-data.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resultsQuarterFor, quarterEndIso, checkQuarterLabel, withHonestQuarter,
  financialKind, marginView, yearAgoUnverified, growthView, narrativeForDisplay,
  axisWord, driftWord, partWord, notRecordedNote,
  isQuarterEndStale, yoyFromDatedSeries, sameFigure, recheckableDrops,
  holdUnconfirmed, holdUnconfirmedPayload, unconfirmedRows, stripGradeInputForStorage, UNCONFIRMED_LABEL,
} from '../india-eo-card-data';
import { countByTier, dedupeWindowEntries } from '../india-earnings-window';
import {
  windowEntries, windowIssues, shortDropReason, isUnconfirmedDrop, dropReasonWithCheck, windowCsv,
  type WindowDay,
} from '../india-earnings-window';
import { fetchWorkerStock } from '../proxy-fetch';

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

// Rows shaped like the live store (window Aug–Sep 2026).
const AETHER = { ticker: 'AETHER', company: 'Aether Industries Ltd', tier: 'STRONG', quarter: 'Q1 FY28', filing_date: '2026-07-31',
  narrative: 'Aether Industries Ltd delivers strong Q1 FY28 (revenue +27% YoY, PAT +34% YoY, EPS +33% YoY) with caveat: segment mix shift.',
  source: 'screener-worker', sales_curr_cr: 327, pat_curr_cr: 63, eps_curr: 4.73 };
const FOSECO = { ticker: 'FOSECOIND', company: 'Foseco India Ltd', tier: 'STRONG', quarter: 'Q1 FY27', filing_date: '2026-08-11', source: 'screener-worker',
  sales_yoy_pct: 55, net_profit_yoy_pct: null, eps_yoy_pct: 31.9, sales_curr_cr: 231, sales_prev_cr: 149, pat_curr_cr: 36, pat_prev_cr: null, eps_curr: 44.74, eps_prev: 33.93,
  opm_pct: 23, opm_prev_pct: 18,
  narrative: 'Foseco India Ltd delivers strong Q1 FY27 (revenue +55% YoY, EPS +32% YoY) and sepa/canslim/bonde ep all passing.' };
const CPCAP = { ticker: 'CPCAP', company: 'CP Capital Limited', tier: 'STRONG', quarter: 'Q1 FY27', filing_date: '2026-08-14', source: 'screener-worker',
  sales_yoy_pct: 46.7, net_profit_yoy_pct: 18.2, eps_yoy_pct: 23.5, sales_curr_cr: 22, sales_prev_cr: 15, pat_curr_cr: 13, pat_prev_cr: 11, eps_curr: 7.31, eps_prev: 5.92,
  opm_pct: 0, opm_prev_pct: 0 };
const SURYODAY = { ticker: 'SURYODAY', company: 'Suryoday Small Finance Bank Ltd', tier: 'STRONG', source: 'screener',
  sales_curr_cr: 622, sales_prev_cr: 495, pat_curr_cr: 75, pat_prev_cr: 35, opm_pct: -7, opm_prev_pct: -12 };
const DHAN = { ticker: 'DHANBANK', company: 'Dhanlaxmi Bank Ltd', sales_curr_cr: 449, sales_prev_cr: 368, pat_curr_cr: 25, pat_prev_cr: 12, opm_pct: 0.2227, opm_prev_pct: -7 };
const NIIT = { ticker: 'NIITLTD', company: 'NIIT Ltd', opm_pct: -3.85, opm_prev_pct: -11.7, sales_curr_cr: 95.65, pat_curr_cr: 7.52 };

describe('1 · quarter label (Indian FY Apr–Mar)', () => {
  test('filing month → results quarter', () => {
    assert.equal(resultsQuarterFor('2026-08-12'), 'Q1 FY27');
    assert.equal(resultsQuarterFor('2026-07-31'), 'Q1 FY27');
    assert.equal(resultsQuarterFor('2026-05-20'), 'Q4 FY26');
    assert.equal(resultsQuarterFor('2026-11-10'), 'Q2 FY27');
    assert.equal(resultsQuarterFor('2027-02-05'), 'Q3 FY27');
    assert.equal(resultsQuarterFor('nope'), null);
    assert.equal(quarterEndIso('Q1 FY27'), '2026-06-30');
    assert.equal(quarterEndIso('Q4 FY26'), '2026-03-31');
  });
  test('Aether "Q1 FY28" on a 31 Jul 2026 filing is impossible → Q1 FY27', () => {
    const c = checkQuarterLabel('Q1 FY28', '2026-07-31');
    assert.equal(c.label, 'Q1 FY27');
    assert.equal(c.corrected, true);
    assert.match(c.reason!, /had not ended/);
  });
  test('a late filer / new listing keeps the previous quarter (within 200 days)', () => {
    assert.deepEqual(checkQuarterLabel('Q4 FY26', '2026-07-20'), { label: 'Q4 FY26', corrected: false });
  });
  test('a years-old label is replaced; bare "Q1" gains its year; spacing normalised', () => {
    assert.equal(checkQuarterLabel('Q1 FY24', '2026-08-10').label, 'Q1 FY27');
    assert.deepEqual(checkQuarterLabel('Q1', '2026-08-10'), { label: 'Q1 FY27', corrected: false });
    assert.equal(checkQuarterLabel('Q1FY27', '2026-08-10').label, 'Q1 FY27');
    assert.equal(checkQuarterLabel(null, '2026-08-10').label, 'Q1 FY27');
  });
  test('every window row gets the honest label (and the narrative follows)', () => {
    const { entries } = windowEntries([{ date: '2026-07-31', by_tier: { STRONG: [AETHER as any] } }]);
    assert.equal(entries[0].quarter, 'Q1 FY27');
    assert.match(narrativeForDisplay(entries[0]), /strong Q1 FY27 /);
    assert.doesNotMatch(narrativeForDisplay(entries[0]), /FY28/);
    const w = withHonestQuarter({ ...AETHER });
    assert.equal((w as any)._quarter_stored, 'Q1 FY28');
  });
});

describe('2 · year-ago base (never a positional guess)', () => {
  test('FOSECOIND: profit year-ago missing while sales/EPS year-ago present → growth withheld', () => {
    assert.equal(yearAgoUnverified(FOSECO), true);
    const g = growthView(FOSECO);
    assert.equal(g.sales, null); assert.equal(g.eps, null); assert.equal(g.pat, null);
    assert.equal(g.salesPrev, null);
    assert.match(g.withheld!, /could not be matched/);
    const n = narrativeForDisplay(FOSECO);
    assert.doesNotMatch(n, /\+55%|\+32%/);
    assert.match(n, /withheld/);
  });
  test('a normal row keeps all three growth figures', () => {
    assert.equal(yearAgoUnverified(CPCAP), false);
    const g = growthView(CPCAP);
    assert.equal(g.sales, 46.7); assert.equal(g.pat, 18.2); assert.equal(g.eps, 23.5);
    assert.equal(g.withheld, null);
  });
  test('profit year-ago genuinely absent (not the gappy signature) → says why, never back-computes', () => {
    const r = { ...CPCAP, source: 'screener', net_profit_yoy_pct: null, pat_prev_cr: null };
    const g = growthView(r);
    assert.equal(g.pat, null);
    assert.equal(g.patNote, 'year-ago profit not in source');
    assert.equal(g.sales, 46.7);
  });
  test('dated series: FOSECOIND has no Jun 2025 column → no YoY; MODIS has one → exact', () => {
    const fDates = ['Dec 2024', 'Mar 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'];
    assert.equal(yoyFromDatedSeries([136, 149, 151, 189, 202, 231], fDates), null);   // was 231 vs 149 (Mar 2025)
    const mDates = ['Mar 2025', 'Jun 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'];
    assert.deepEqual(yoyFromDatedSeries([1.51, 6.79, 12.77, 4.41, 8.58], mDates), { curr: 8.58, prev: 6.79 });
    assert.equal(yoyFromDatedSeries([1, 2, 3], mDates), null);          // lengths disagree
    assert.equal(yoyFromDatedSeries([1, 2, 3, 4, 5], null), null);      // no dates → nothing
  });
  test('worker: a misaligned year-ago block is re-read BY DATE from its own table', async () => {
    const body = {
      symbol: 'MODIS', name: 'Modis Navnirman Ltd',
      quarters: { dates: ['Mar 2025', 'Jun 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'],
        sales: [19.94, 30.1, 40, 45, 58.26], netProfit: [1.51, 6.79, 12.77, 4.41, 8.58], eps: [0.77, 3.47, 6.5, 2.25, 4.38], opm: [15.7, 22.11, 26.99, 9.26, 19.16] },
      latest: { date: 'Jun 2026', revenue: 58.26, netProfit: 8.58, eps: 4.38, opm: 19.16 },
      yoy: { date: 'Mar 2025', revenue: 19.94, netProfit: 1.51, eps: 0.77, opm: 15.7 },
    };
    const orig = globalThis.fetch;
    (globalThis as any).fetch = async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
      const w = await fetchWorkerStock('MODIS');
      assert.ok(w);
      assert.equal(w!.sales_prev_cr, 30.1);          // Jun 2025, not Mar 2025 (19.94)
      assert.equal(w!.pat_prev_cr, 6.79);
      assert.equal(w!.eps_prev, 3.47);
      assert.deepEqual(w!.quarters_dates, body.quarters.dates);
      assert.deepEqual(w!.quarters_pat, body.quarters.netProfit);
    } finally { (globalThis as any).fetch = orig; }
  });
  test('two sources are mixed only when they describe the same figure', () => {
    assert.equal(sameFigure(231, 231.4), true);
    assert.equal(sameFigure(231, 202), false);
    assert.equal(sameFigure(null, 5), false);
  });
  test('a Screener page whose newest quarter is months old is stale', () => {
    const now = Date.parse('2026-09-28T00:00:00Z');
    assert.equal(isQuarterEndStale('2026-06-30', now), false);
    assert.equal(isQuarterEndStale('2025-03-31', now), true);
    assert.equal(isQuarterEndStale(null, now), true);
  });
});

describe('3 · margin: 0.0% is unknown; lenders get net margin, not OPM', () => {
  test('CPCAP 0.0% / 0.0% → unknown, not "0.0% +0.0pp"', () => {
    const m = marginView(CPCAP);
    assert.equal(m.mode, 'opm');
    assert.equal(m.value, null); assert.equal(m.prev, null);
    assert.equal(m.note, 'not in source');
  });
  test('banks → NET MARGIN from the same row (Suryoday 12.1% vs 7.1%, Dhanlaxmi)', () => {
    const s = marginView(SURYODAY);
    assert.equal(s.mode, 'net'); assert.equal(s.label, 'NET MARGIN');
    assert.equal(s.value, 12.1); assert.equal(s.prev, 7.1);
    assert.match(s.title, /not a meaningful figure/);
    assert.equal(marginView(DHAN).value, 5.6);
  });
  test('a real negative OPM on a non-lender stays (NIIT −3.85%)', () => {
    const m = marginView(NIIT);
    assert.equal(m.mode, 'opm'); assert.equal(m.value, -3.85); assert.equal(m.prev, -11.7);
  });
  test('lender detection reads sector/industry or the registered name, never tickers', () => {
    assert.equal(financialKind({ company: 'Jana Small Finance Bank Ltd' }), 'lender');
    assert.equal(financialKind({ company: 'Aavas Financiers Ltd' }), 'lender');
    assert.equal(financialKind({ company: 'Some Co', sector: 'NBFC' }), 'lender');
    assert.equal(financialKind({ company: 'Star Health and Allied Insurance Co Ltd' }), 'insurer');
    assert.equal(financialKind({ company: 'CP Capital Limited' }), null);   // education co.
    assert.equal(financialKind({ company: 'NIIT Ltd' }), null);
    assert.equal(financialKind({ ticker: 'HDFCBANK' } as any), null);
  });
});

describe('5 · no visible 0–100 numbers', () => {
  test('axis, drift and component words carry no digits', () => {
    for (const w of [axisWord(90, 'quality'), axisWord(56, 'inflection'), axisWord(10, 'quality'), driftWord(34), driftWord(75),
      partWord({ label: 'cash conversion', points: 20, of: 20 }), partWord({ label: 'operating margin', points: 9, of: 15 })]) {
      assert.ok(w && !/\d/.test(w), String(w));
    }
    assert.equal(axisWord(null, 'quality'), null);
  });
  test('the card no longer prints SCORE / Q90·I56 / PEAD nn / Radar T-nn', () => {
    const page = read('(dashboard)', 'earnings-opportunities', 'page.tsx');
    assert.ok(!/>SCORE</.test(page));
    assert.ok(!page.includes('{stock.composite_score}'));
    assert.ok(!page.includes('Q{qual}·I{infl}'));
    assert.ok(!page.includes('PEAD {p}'));
    assert.ok(!page.includes('Radar T-{'));
    assert.ok(page.includes('<MarginTile m={_margin} />'));
  });
  test('page.tsx has no named exports (Next.js page rule)', () => {
    const page = read('(dashboard)', 'earnings-opportunities', 'page.tsx');
    const named = page.split('\n').filter((l) => /^export\s+(?!default\b)/.test(l));
    assert.deepEqual(named, []);
  });
});

describe('6 · header describes the window when a window is selected', () => {
  test('window line replaces the single-date "filed & graded · scanned" line', () => {
    const page = read('(dashboard)', 'earnings-opportunities', 'page.tsx');
    assert.ok(page.includes('{windowOn ? (() => {'));
    assert.ok(page.includes('`Window: ${win.rows.length'));
    assert.ok(page.includes('{!windowOn && coverageStats &&'));
  });
});

describe('7 · coverage: honest reasons, last-checked, bounded re-check', () => {
  test('short reasons', () => {
    assert.equal(shortDropReason('scheduled (Upcoming) — no filing confirmed and no fresh quarter on Screener'), 'board meeting only — filing not confirmed');
    assert.equal(shortDropReason("Screener's latest quarter 2016-03-31 is 3788d before the filing (new quarter not on Screener yet)"), 'Screener page years out of date');
    assert.equal(shortDropReason("Screener's latest quarter 2026-03-31 is 135d before the filing (new quarter not on Screener yet)"), 'new quarter not on Screener yet');
    assert.equal(isUnconfirmedDrop('board meeting only — filing not confirmed'), true);
    assert.equal(isUnconfirmedDrop('new quarter not on Screener yet'), false);
    assert.equal(dropReasonWithCheck('new quarter not on Screener yet', '2026-09-27T10:36:09.088Z'), 'new quarter not on Screener yet — last checked 27 Sep');
    assert.equal(dropReasonWithCheck('x', null), 'x');
  });
  test('windowIssues separates "filing not confirmed" from "filed but not graded" and carries the check date', () => {
    const days: WindowDay[] = [{
      date: '2026-08-13', checked_at: '2026-09-27T09:08:44.497Z',
      by_tier: { STRONG: [{ ticker: 'A', company: 'A Ltd', tier: 'STRONG' } as any] },
      dropped: [
        { ticker: 'LATE', reason: "Screener's latest quarter 2026-03-31 is 135d before the filing (new quarter not on Screener yet)" },
        { ticker: 'SCHED', reason: 'scheduled (Upcoming) — no filing confirmed and no fresh quarter on Screener' },
      ],
    }];
    const { entries, bad } = windowEntries(days);
    const iss = windowIssues(days, entries, bad, []);
    const late = iss.notGraded.find((x) => x.ticker === 'LATE')!;
    const sched = iss.notGraded.find((x) => x.ticker === 'SCHED')!;
    assert.equal(late.unconfirmed, false); assert.equal(late.checked, '2026-09-27T09:08:44.497Z');
    assert.equal(sched.unconfirmed, true);
  });
  test('recheckable drops: data that can still arrive, one per ticker', () => {
    assert.equal(recheckableDrops([
      { ticker: 'A', reason: "Screener's latest quarter 2026-03-31 is 135d before the filing (new quarter not on Screener yet)" },
      { ticker: 'A', reason: "Screener's latest quarter 2026-03-31 is 135d before the filing (new quarter not on Screener yet)" },
      { ticker: 'B', reason: 'scheduled (Upcoming) — no filing confirmed and no fresh quarter on Screener' },
      { ticker: 'C', reason: 'no announce date, older than 7d, not hub-confirmed, no fresh quarter (stale-data guard)' },
      { ticker: 'D', reason: 'unknown' },
    ]), 3);
    assert.equal(recheckableDrops(undefined), 0);
  });
  test('the cron re-checks dropped companies, bounded and locked per date', () => {
    const cron = read('api', 'v1', 'cron', 'prewarm-earnings', 'route.ts');
    assert.match(cron, /RECHECK_BUDGET = 2/);
    assert.match(cron, /graded:recheck-lock:/);
    assert.match(cron, /recheckableDrops\(j\?\._dropped\)/);
    assert.match(cron, /Date\.now\(\) - start > DEADLINE_MS/);
  });
  test('stale (previous-rules) rows say RS / Stage were not recorded', () => {
    assert.equal(notRecordedNote({ _engine_stale: true, rs_rating: null, stage: null }), 'RS & Stage not recorded (older grading rules)');
    assert.equal(notRecordedNote({ _engine_stale: true, rs_rating: 80, stage: null }), 'Stage not recorded (older grading rules)');
    assert.equal(notRecordedNote({ _engine_stale: false, rs_rating: null }), null);
  });
});

describe('8 · feed and export', () => {
  test('CSV exports the same honest growth as the card', () => {
    const csv = windowCsv([{ ...FOSECO, _window_date: '2026-08-11', _also_reported: [] }]).split('\n')[1];
    assert.ok(!csv.includes(',55,'));
    assert.ok(!csv.includes(',31.9,'));
  });
  test('enrich: date-matched YoY, fresher page wins, same-basis cherry-pick, cache bumped, no stray exports', () => {
    const src = read('api', 'v1', 'earnings', 'enrich', 'route.ts');
    assert.match(src, /yoyFromDatedSeries\(\(out as any\)\.quarters_pat, dates\)/);
    assert.ok(!/arr\[arr\.length - 5\]/.test(src), 'positional year-ago removed');
    assert.match(src, /isQuarterEndStale\(worker\.latest_quarter_end_iso\)/);
    assert.match(src, /_scSameBasis && out\.sales_yoy_pct == null/);
    assert.match(src, /enrich:v17:/);   // zzz821 — bumped for same-FY cash (cash_fy)
    const named = src.split('\n').filter((l) => /^export\s+(?!(async\s+)?function\s+(GET|POST)\b|const\s+(runtime|dynamic|maxDuration)\b)/.test(l));
    assert.deepEqual(named, []);
  });
  test('hub: a parsed period is believed only if it had ended by the meeting date', () => {
    const hub = read('api', 'market', 'earnings', 'route.ts');
    assert.match(hub, /quarterEndDate\(q\)/);
    assert.match(hub, /lagDays >= -1 && lagDays <= 200/);
  });
});

describe('zzz820b · engine v24 follow-ups', () => {
  test('an unverified top tier is held out of BLOCKBUSTER / STRONG, old tier kept', () => {
    const h = holdUnconfirmed({ ...FOSECO });
    assert.equal(h.tier, 'MIXED');
    assert.equal(h._tier_unconfirmed, 'STRONG');
    assert.equal(holdUnconfirmed(h), h);                       // idempotent
    assert.equal(holdUnconfirmed({ ...CPCAP }).tier, 'STRONG'); // a normal row untouched
    const avoid = holdUnconfirmed({ ...FOSECO, tier: 'AVOID' });
    assert.equal(avoid.tier, 'AVOID'); assert.equal(avoid._tier_unconfirmed, 'AVOID');
    assert.match(UNCONFIRMED_LABEL, /UNCONFIRMED — figures being re-checked/);
  });
  test('single-date payload and window entries both exclude it from the top-tier counts', () => {
    const p = holdUnconfirmedPayload({ by_tier: { BLOCKBUSTER: [], STRONG: [{ ...FOSECO }, { ...CPCAP }], MIXED: [], AVOID: [] } });
    assert.deepEqual(p.by_tier.STRONG.map((r: any) => r.ticker), ['CPCAP']);
    assert.deepEqual(p.by_tier.MIXED.map((r: any) => r.ticker), ['FOSECOIND']);
    const { entries } = windowEntries([{ date: '2026-08-11', by_tier: { STRONG: [{ ...FOSECO } as any, { ...CPCAP } as any] } }]);
    const c = countByTier(dedupeWindowEntries(entries));
    assert.equal(c.STRONG, 1); assert.equal(c.MIXED, 1);
    assert.equal(unconfirmedRows({ by_tier: { STRONG: [FOSECO, CPCAP] } }), 1);
  });
  test('grade_input never reaches browser storage', () => {
    const p = stripGradeInputForStorage({ by_tier: { STRONG: [{ ticker: 'A', grade_input: { big: 1 }, _stored_input: {} }] } } as any);
    assert.ok(!('grade_input' in p.by_tier.STRONG[0]));
    assert.ok(!('_stored_input' in p.by_tier.STRONG[0]));
    const page = read('(dashboard)', 'earnings-opportunities', 'page.tsx');
    assert.match(page, /JSON\.stringify\(\{ \.\.\.stripGradeInputForStorage\(data\)/);
  });
  test('CSV has no score columns; an unconfirmed row says so', () => {
    const lines = windowCsv([{ ...holdUnconfirmed({ ...FOSECO }), _window_date: '2026-08-11', _also_reported: [] }]).split('\n');
    assert.ok(!/Score/.test(lines[0]));
    assert.match(lines[1], /UNCONFIRMED \(stored STRONG\)/);
  });
  test('card shows the cap reason, price-context chips, the unconfirmed badge; bench skips unconfirmed', () => {
    const page = read('(dashboard)', 'earnings-opportunities', 'page.tsx');
    assert.ok(page.includes('{capReasonOf(stock)}'));   // zzz822 — via the shared helper
    assert.ok(page.includes('Price context — not part of the grade:'));
    assert.ok(page.includes('{UNCONFIRMED_LABEL}'));
    assert.ok(page.includes('if ((c as any)._tier_unconfirmed || yearAgoUnverified(c)) continue;'));
    assert.ok(page.includes('Price is not part of the grade.'));
    assert.ok(!page.includes('Score = Magnitude'));
  });
  test('prewarm re-check also picks dates holding unconfirmed rows', () => {
    const cron = read('api', 'v1', 'cron', 'prewarm-earnings', 'route.ts');
    assert.match(cron, /\(waiting >= RECHECK_MIN \|\| unconfirmed > 0/);
    assert.match(cron, /unconfirmedRows\(j\)/);
  });
});
