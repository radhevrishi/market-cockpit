// zzz911 — India earnings alerts run by the app: selection uses the site's preset, messages are plain and honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  selectIndiaAlertHits, formatHourlyAlert, formatEodDigest, istDate, utcDatesBack, longDate, n1, setupText, rankHits,
  type GradedDay,
} from '../india-earnings-alert';
import { INDIA_PRESET } from '../quality-preset';
import { APP_JOBS, parseCron } from '../app-scheduler';

const good = (over: Record<string, unknown> = {}) => ({
  ticker: 'ABC', company: 'Abc Ltd', tier: 'STRONG', verdict: 'WATCH', filing_date: '2026-10-05', quarter: 'Q2 FY27',
  market_cap_cr: 8000, sales_yoy_pct: 30, net_profit_yoy_pct: 40, eps_yoy_pct: 40, opm_pct: 18, opm_prev_pct: 16,
  cfo_to_pat_ratio: 1.1, pead_score: 45, composite_score: 80, fund_composite: 82, setup_grade: 'B', caveat_tags: [],
  pe: 32.456, source_url: 'https://nsearchives.nseindia.com/x.pdf', ...over,
});
const day = (date: string, rows: any[], extra: Record<string, unknown> = {}): GradedDay => ({ date, key: `graded:${date}`, payload: { by_tier: { ALL: rows }, ...extra } });

test('selection is the site preset: PEAD 45 passes (site floor 40, the old intraday task wrongly used 60)', () => {
  assert.equal(INDIA_PRESET.pead, 40);
  const { hits } = selectIndiaAlertHits([day('2026-10-05', [good()])]);
  assert.deepEqual(hits.map((h) => h.alert_id), ['ABC:2026-10-05']);
});

test('selection drops weak tiers, failing preset rows and (small & mid) large caps; unknown pledge passes', () => {
  const rows = [
    good({ ticker: 'TIER', tier: 'GOOD' }),
    good({ ticker: 'SLOW', sales_yoy_pct: 10 }),
    good({ ticker: 'TINY', market_cap_cr: 900 }),
    good({ ticker: 'BIG', market_cap_cr: 45_000 }),
    good({ ticker: 'PLEDGE', pledged_pct: 4 }),
    good({ ticker: 'NOPLEDGE', pledged_pct: null }),
  ];
  const sm = selectIndiaAlertHits([day('2026-10-05', rows)], { smallMidOnly: true });
  assert.deepEqual(sm.hits.map((h) => h.ticker), ['NOPLEDGE']);
  const all = selectIndiaAlertHits([day('2026-10-05', rows)]);
  assert.deepEqual(all.hits.map((h) => h.ticker).sort(), ['BIG', 'NOPLEDGE']);   // the digest route keeps its old size rule
  assert.equal(sm.scanned[0].rows, 6);
  assert.equal(sm.scanned[0].alertable, 1);
});

test('one event per company + filing date across days; a missing day is reported, not fatal', () => {
  const { hits, scanned } = selectIndiaAlertHits([
    day('2026-10-06', [good()]), day('2026-10-05', [good()]),
    { date: '2026-10-04', key: null, payload: null },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(scanned[2].rows, 0);
  assert.equal(scanned[2].key, null);
});

test('ranking: Blockbuster first, then the business score', () => {
  const r = rankHits([
    { tier: 'STRONG', fund_composite: 95, composite_score: 0 },
    { tier: 'BLOCKBUSTER', fund_composite: 70, composite_score: 0 },
    { tier: 'STRONG', fund_composite: null, composite_score: 99 },
  ]);
  assert.deepEqual(r.map((x) => x.fund_composite ?? x.composite_score), [70, 99, 95]);
});

test('hourly message: subject, numbers as graded, dashes for gaps, no setup ≠ D, P/E and filing link carried over', () => {
  const { hits } = selectIndiaAlertHits([day('2026-10-05', [
    good(),
    good({ ticker: 'XYZ', company: 'X <&> Co', tier: 'BLOCKBUSTER', setup_grade: null, cfo_to_pat_ratio: null, pe: null, source_url: 'javascript:alert(1)', caveat_tags: ['one-off gain'] }),
  ])]);
  const m = formatHourlyAlert(hits);
  assert.equal(m.subject, 'MC Earnings Alert — 2 new (XYZ, ABC)');
  assert.ok(m.subject.startsWith('MC Earnings Alert'));
  assert.match(m.text, /1\. XYZ — X <&> Co \(Blockbuster\)/);
  assert.match(m.text, /Chart setup no setup data/);
  assert.match(m.text, /Cash from operations \/ profit -x/);
  assert.match(m.text, /P\/E 32\.5/);
  assert.match(m.text, /Caveats: one-off gain/);
  assert.match(m.text, /Filing: https:\/\/nsearchives/);
  assert.ok(!m.text.includes('javascript:'));
  assert.match(m.text, /Full detail: https:\/\/market-cockpit-production\.up\.railway\.app\/watchlists/);
  assert.ok(m.html.includes('X &lt;&amp;&gt; Co'));
  assert.ok(!/#000|background:\s*#[0-3]/i.test(m.html), 'light background only');
});

test('no advice words in either message (verdict is never printed)', () => {
  const { hits } = selectIndiaAlertHits([day('2026-10-05', [good({ verdict: 'STRONG BUY' }), good({ ticker: 'B2', verdict: 'BUY' })])]);
  assert.equal(hits.length, 2);
  for (const m of [formatHourlyAlert(hits), formatEodDigest({ dateIst: '2026-10-05', graded: true, candidatesTotal: 40, hits })]) {
    assert.ok(!/\b(BUY|SELL)\b/.test(m.text), m.text);
    assert.ok(!/\b(BUY|SELL)\b/.test(m.html));
  }
});

test('evening message always has a health line, quiet day included', () => {
  const quiet = formatEodDigest({ dateIst: '2026-10-06', graded: true, candidatesTotal: 37, hits: [] });
  assert.equal(quiet.subject, '✅ Earnings Watch — EOD 06 Oct 2026');
  assert.ok(quiet.text.startsWith('Watch healthy · graded 37 India filings today · 0 cleared your preset.'));
  assert.match(quiet.text, /quiet day/);
  assert.match(quiet.text, /9:15 pm IST/);
  const none = formatEodDigest({ dateIst: '2026-10-06', graded: false, candidatesTotal: null, hits: [] });
  assert.match(none.text, /no graded India filings were found for today yet/);
  const { hits } = selectIndiaAlertHits([day('2026-10-06', [good({ filing_date: '2026-10-06' })])]);
  const busy = formatEodDigest({ dateIst: '2026-10-06', graded: true, candidatesTotal: 12, hits });
  assert.match(busy.text, /1 cleared your preset/);
  assert.match(busy.text, /1\. ABC — Abc Ltd \(Strong\)/);
});

test('dates: India date rolls at 18:30 UTC; UTC window newest first; long date', () => {
  assert.equal(istDate(new Date('2026-10-06T18:29:00Z')), '2026-10-06');
  assert.equal(istDate(new Date('2026-10-06T18:31:00Z')), '2026-10-07');
  assert.deepEqual(utcDatesBack(3, new Date('2026-10-01T05:00:00Z')), ['2026-10-01', '2026-09-30', '2026-09-29']);
  assert.equal(longDate('2026-01-09'), '09 Jan 2026');
  assert.equal(n1(null), '-');
  assert.equal(n1(12.345), '12.3');
  assert.equal(setupText(null), 'no setup data');
});

test('scheduler: both jobs registered on odd minutes (never :00), valid crons, manual button in book-watch.yml', () => {
  const alert = APP_JOBS.find((j) => j.name === 'in-earnings-alert')!;
  const eod = APP_JOBS.find((j) => j.name === 'in-earnings-eod')!;
  assert.deepEqual(alert.crons, ['27 4-16 * * 1-6']);
  assert.deepEqual(eod.crons, ['37 15 * * 1-5']);
  for (const j of [alert, eod]) {
    for (const c of j.crons) {
      assert.ok(parseCron(c));
      const minute = Number(c.split(' ')[0]);
      assert.ok(minute % 2 === 1, `${j.name} odd minute`);
    }
    assert.equal(j.workflow, 'book-watch.yml');
  }
  const wf = readFileSync(join(__dirname, '../../../../.github/workflows/book-watch.yml'), 'utf8');
  assert.match(wf, /india-earnings-alert\)\s+echo "path=\/api\/v1\/cron\/india-earnings-alert"/);
  assert.match(wf, /label=in-earnings-eod/);
});

test('routes: one shared selection, secret-gated, dedup via owner-notify', () => {
  const read = (p: string) => readFileSync(join(__dirname, '../../app/api', p), 'utf8');
  const digest = read('v1/earnings/alerts-digest/route.ts');
  assert.ok(digest.includes('collectIndiaAlertHits'));
  assert.ok(!digest.includes('isAlertable('), 'no second copy of the selection');
  for (const p of ['v1/cron/india-earnings-alert/route.ts', 'v1/cron/india-earnings-eod/route.ts']) {
    const s = read(p);
    assert.ok(s.includes('verifyCronSecret(req, { requireSecret: true })'), p);
    assert.ok(/notifyOwnerOnce(Many)?\(/.test(s), p);
    assert.ok(s.includes("smallMidOnly: true"), p);
  }
});
