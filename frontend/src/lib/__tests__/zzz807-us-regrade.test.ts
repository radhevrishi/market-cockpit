// zzz807 — a rules-only engine change regrades cached days in-process.
//
// The zzz806 bump sent a 60-session window back into the one-at-a-time SEC
// queue, oldest first; the old BLOCKBUSTER for a small-base micro-cap stayed on
// screen for hours. Generic inputs only.
// Run: npx tsx --test src/lib/__tests__/zzz807-us-regrade.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gradeUsRow, type UsFundamentals } from '../us-earnings-core';
import { regradeDayPayload, gradeInputFromRow } from '../us-regrade';
import { US_ENGINE_VERSION } from '../us-engine-version';
import { GradeQueue, rescanNoteText, windowStatusLine, planDayRequest } from '../us-rescan';

const M = 1e6;
const fund = (o: Partial<UsFundamentals>): UsFundamentals => ({
  q_end: '2026-07-31', q_end_prev: '2025-07-31', q_filed: null,
  revenue: null, revenue_prev: null, operating_income: null, operating_income_prev: null,
  net_income: null, net_income_prev: null, eps: null, eps_prev: null,
  cfo: null, cfo_prev: null, capex: null, capex_prev: null, tags: {},
  quarters_revenue: null, quarters_eps: null, quarters_opm: null, ...o,
});
const px = { price: 5, d1_pct: -20.4, gap_pct: -15, move_pct: -20, pct_from_52w_high: -61, stage: 4 as const, rs_rating: 32, addv_musd: 1, vol_ratio_20d: 3 };

/** A day cached by an OLDER engine: the micro-cap graded BLOCKBUSTER, with the
 *  row shaped as old engines stored it (no `grade_input`). */
function staleDay(): any {
  const row: any = gradeUsRow({
    ticker: 'MCRO', company: 'Connector Co', filing_date: '2026-09-10', form: '10-Q',
    fundamentals: fund({
      revenue: 24.0 * M, revenue_prev: 19.8 * M, operating_income: 1.76 * M, operating_income_prev: 0.72 * M,
      net_income: 1.44 * M, net_income_prev: 0.39 * M, eps: 0.12, eps_prev: 0.04, cfo: 1.6 * M, capex: 0.1 * M,
    }),
    price: px,
  })!;
  delete row.grade_input;
  row.tier = 'BLOCKBUSTER';
  row.caveat_tags = ['small base — prior-year EPS under $0.10, so the per-share growth rate is magnified'];
  row.narrative = 'Connector Co prints a blockbuster Q3 CY26 (…).';
  row.guidance = null;
  row.key_metrics = [{ id: 'backlog', label: 'Backlog', value: 18.6e6, unit: 'usd', yoy_pct: null, source: '' }];
  return {
    filing_date: '2026-09-10', window_days: 1, window_start: '2026-09-10',
    candidates_total: 1, raw_items_total: 1, pending_xbrl_total: 0, no_price_total: 0,
    by_tier: { BLOCKBUSTER: [row], STRONG: [], MIXED: [], AVOID: [] },
    pending: [], scheduled: [], generated_at: '2026-09-10T22:00:00Z', engine_version: '2026.09.17-c',
    sources_polled: 3, truncated: false, notes: [],
  };
}

describe('zzz807 — a stale-version day regrades in-process, with no SEC call', () => {
  test('the micro-cap flips BLOCKBUSTER → MIXED instantly, and nothing touches the network', () => {
    const realFetch = (globalThis as any).fetch;
    let calls = 0;
    (globalThis as any).fetch = () => { calls++; throw new Error('network used'); };
    try {
      const t = Date.now();
      const re = regradeDayPayload(staleDay());
      const ms = Date.now() - t;
      assert.ok(re);
      assert.equal(calls, 0, 'no fetch');
      assert.ok(ms < 200, `regrade took ${ms}ms`);
      assert.equal(re.engine_version, US_ENGINE_VERSION);
      assert.equal(re.regraded_from, '2026.09.17-c');
      assert.equal(re.generated_at, '2026-09-10T22:00:00Z', 'when the filings were read is kept');
      assert.equal(re.by_tier.BLOCKBUSTER.length, 0);
      const r = re.by_tier.MIXED[0];
      assert.equal(r?.ticker, 'MCRO');
      assert.match(r.caveat_tags.find((t: string) => /^capped at /.test(t)) || '', /small base/);
      assert.match(r.narrative, /is a mixed print/);
      assert.ok(r.grade_input, 'the regraded row now stores its exact input for next time');
    } finally { (globalThis as any).fetch = realFetch; }
  });

  test('a row carrying its stored input regrades from that input exactly', () => {
    const row: any = gradeUsRow({
      ticker: 'BIGC', company: 'Large Co', filing_date: '2026-09-10', form: '10-Q',
      fundamentals: fund({
        revenue: 800 * M, revenue_prev: 600 * M, operating_income: 160 * M, operating_income_prev: 90 * M,
        net_income: 124 * M, net_income_prev: 68 * M, eps: 1.24, eps_prev: 0.68, cfo: 150 * M, capex: 30 * M,
      }),
      price: { ...px, d1_pct: 3, stage: 2, pct_from_52w_high: -3, addv_musd: 200 }, consensus_beat_pct: 12, positive_guidance: true,
    })!;
    const inp = gradeInputFromRow(row)!;
    assert.equal(inp.consensus_beat_pct, 12);
    assert.equal(inp.positive_guidance, true);
    const re = regradeDayPayload({ by_tier: { BLOCKBUSTER: [row], STRONG: [], MIXED: [], AVOID: [] }, engine_version: 'old', generated_at: 'x' });
    assert.equal(re.by_tier.BLOCKBUSTER[0]?.ticker, 'BIGC');
  });
});

describe('zzz807 — the queue runs newest day first, the page\'s window ahead of sweeps', () => {
  test('newest first, never oldest first; a higher priority jumps the line; nothing queued twice', async () => {
    let release!: () => void;
    const order: string[] = [];
    const q = new GradeQueue(async (key) => {
      order.push(key);
      if (key === 'blocker|1') await new Promise<void>((r) => { release = r; });
      return { ok: true };
    });
    q.enqueue('blocker|1');
    await new Promise((r) => setTimeout(r, 0));        // the blocker is now running
    for (const d of ['2026-08-04', '2026-08-05', '2026-09-18', '2026-09-22']) q.enqueue(`${d}|1`);
    assert.deepEqual(q.pendingKeys(), ['2026-09-22|1', '2026-09-18|1', '2026-08-05|1', '2026-08-04|1']);
    const len = q.length();
    q.enqueue('2026-09-18|1');                         // a second press: no duplicate
    assert.equal(q.length(), len);
    q.enqueue('2026-08-05|1', false, 1);               // the page's own window outranks the sweep
    assert.equal(q.pendingKeys()[0], '2026-08-05|1');
    release();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(order, ['blocker|1', '2026-08-05|1', '2026-09-22|1', '2026-09-18|1', '2026-08-04|1']);
  });
});

describe('zzz807 — Hard re-scan is never silent', () => {
  test('pressed while days are grading, it reports the state, newest first', () => {
    const t = rescanNoteText(['2026-08-04', '2026-09-22', '2026-09-18'], ['2026-09-24']);
    assert.match(t, /^Already re-scanning — 3 days left, newest first \(2026-09-22, 2026-09-18, 2026-08-04\)/);
    assert.match(t, /Nothing was queued twice/);
  });
  test('pressed on an idle window, it re-reads the newest day and regrades the rest from stored filings', () => {
    const t = rescanNoteText([], ['2026-09-24', '2026-09-23', '2026-09-22']);
    assert.match(t, /Re-scanning 2026-09-24 from SEC EDGAR now; the other 2 days are re-graded from their stored filings/);
    // the page plan: a stored older day is served from (regraded) cache, the newest is forced once
    assert.deepEqual(planDayRequest({ cached: { stale: false }, rescanRequested: false, forceAlreadySent: false, awaitingServer: false }), { action: 'use-cache' });
    assert.deepEqual(planDayRequest({ cached: { stale: false }, rescanRequested: true, forceAlreadySent: false, awaitingServer: false }),
      { action: 'ask-server', force: true, keepShowing: true });
  });
  test('the status line says what is shown and what is refreshing', () => {
    assert.equal(windowStatusLine({ companies: 1117, days: 60, upToDate: 58, refreshing: 2, failed: 0, notAsked: 0 }),
      '1117 companies shown · 60 days: 58 up to date, 2 refreshing (newest first)');
  });
});
