// zzz1210 — Company Lab done like the owner's scripts: one chart per script with its own colours, per-year FCF growth /
// yield / capex÷FCF / debt÷FCF / SBC series, the checklist's CapEx-to-FCF rule and 5-year averages, Stage2.py's relative
// strength vs the index and "meets all criteria", the other market tried for a ticker typed under the wrong one.
// Plus: NVT gross-margin tile on the US card; GitHub collectors check their key first (one failure a day).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fcfReport, yearPoints, rsCumulative, stage2Verdict, maSeries, type AnnualRow } from '../company-lab/core';
import { checkServiceKey } from '../../../../.github/scripts/check-service-key.mjs';

const row = (y: number, rev: number, fcf: number, capex: number, o: Partial<AnnualRow> = {}): AnnualRow => ({ end: `${y}-12-31`, label: `FY${y}`, revenue: rev, netIncome: rev * 0.1, eps: rev / 100, cfo: fcf + capex, capex: -capex, fcf, debt: 60, shares: 10, sbc: rev * 0.02, ...o });

test('per-year series: FCF growth, yield at the year-end price, capex÷FCF, debt÷FCF, SBC %', () => {
  const rows = [row(2023, 100, 10, 4), row(2024, 120, 15, 6), row(2025, 150, 20, 12)];
  const yp = yearPoints(rows, null, (end) => (end.startsWith('2025') ? 40 : 20));
  assert.equal(yp[2].fcfG, 33.3);
  assert.equal(yp[2].fcfYield, 5);          // 20 ÷ (40 × 10)
  assert.equal(yp[1].fcfYield, 7.5);        // 15 ÷ (20 × 10)
  assert.equal(yp[2].capexToFcf, 60);
  assert.equal(yp[2].debtToFcf, 3);
  assert.equal(yp[2].sbcPct, 2);
  assert.equal(yp[0].fcfG, null);
  const r = fcfReport(rows, 400, 'test', yp);
  const cx = r.checks.find((c) => c.id === 'capex')!;
  assert.equal(cx.state, 'fail');           // capex 60% of FCF: the script's rule is < 50%
  assert.match(cx.value, /60% of FCF/);
  assert.ok(r.metrics.some((m) => /Capex ÷ FCF, average/.test(m.label)));
  assert.ok(r.metrics.some((m) => /Debt ÷ FCF, average/.test(m.label) && m.value === '4.3×'));   // (6+4+3)/3
});

test('Stage2.py relative strength: stock cumulative return ÷ index cumulative return', () => {
  const days = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const st = { t: days, c: days.map((_, i) => 100 * (1 + i / 299)) };        // doubles
  const ix = { t: days.filter((_, i) => i % 7 !== 3), c: [] as number[] };   // index misses some days: the close before is used
  ix.c = ix.t.map((d) => 100 * (1 + days.indexOf(d) / 598));                 // +50%
  const rs = rsCumulative(st, ix, 252);
  assert.ok(rs.ratio! > 1.2 && rs.ratio! < 1.4, String(rs.ratio));
  assert.equal(rs.ok, true);
  assert.ok(rs.line.length > 40);
  const tt = Array.from({ length: 6 }, () => ({ label: 'x', ok: true, value: '' }));
  assert.equal(stage2Verdict(tt, rs, { ok: false }).trendAndRs, true);
  assert.equal(stage2Verdict(tt, rs, { ok: false }).all, false);
  assert.equal(stage2Verdict(tt, rs, { ok: true }).all, true);
  assert.equal(stage2Verdict(tt, { ...rs, ok: false }, { ok: true }).all, false);
  const ma = maSeries(days, st.c, 10);
  assert.ok(ma.length >= 10 && ma[ma.length - 1].m200 != null);
});

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
test('page: one chart per script, distinct colours, multi-company view, market fallback', () => {
  const pg = read('app/(dashboard)/company-lab/page.tsx');
  for (const t of ['Share price vs revenue growth"', 'Share price vs revenue and EPS growth', 'Share price vs revenue growth and FCF margin', 'free cash flow per share', 'FCF growth vs revenue growth', 'FCF margin and FCF yield', 'Capex ÷ FCF and debt ÷ FCF', 'Share-based pay % of revenue', 'Relative strength vs', '50 / 150 / 200-day averages'])
    assert.ok(pg.includes(t), t);
  assert.doesNotMatch(pg, /function DualChart/);
  assert.match(pg, /function MultiFcf/);
  assert.match(pg, /Log scale for price/);
  assert.match(pg, /c\.market !== m/);
  const srv = read('lib/company-lab/server.ts');
  assert.match(srv, /movedFrom: m/);
  assert.match(srv, /'10y'/);
});

test('NVT: gross margin has its own tile on the US card', () => {
  const card = read('components/us-earnings-card.tsx');
  assert.match(card, /key="gm" label=\{gmv\.delta <= -1\.5 \? 'GROSS MARGIN ⚠' : 'GROSS MARGIN'\}/);
});

test('collectors check their key first: first refusal of the day fails, later ones skip quietly', async () => {
  const logs: string[] = [];
  const mk = (status: number, body: any) => (async () => ({ status, json: async () => body })) as any;
  const env = { CRON_SECRET: 'x'.repeat(20), CRON_BASE_URL: 'https://example.test', JOB_NAME: 'scrape-fii-dii' } as any;
  assert.deepEqual(await checkServiceKey({ env, fetch: mk(200, { ok: true }), log: (m: string) => logs.push(m) }), { ok: true, fail: false });
  assert.deepEqual(await checkServiceKey({ env, fetch: mk(401, { ok: false, firstToday: true }), log: (m: string) => logs.push(m) }), { ok: false, fail: true });
  assert.deepEqual(await checkServiceKey({ env, fetch: mk(401, { ok: false, firstToday: false }), log: (m: string) => logs.push(m) }), { ok: false, fail: false });
  assert.deepEqual(await checkServiceKey({ env, fetch: (async () => { throw new Error('down'); }) as any, log: () => {} }), { ok: true, fail: false });
  assert.ok(logs.every((l) => !l.includes('x'.repeat(20))));
  for (const f of ['scrape-fii-dii.yml', 'scrape-nse-results.yml', 'scrape-guidance-docs.yml', 'edgar-guidance-backfill.yml']) {
    const y = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '.github', 'workflows', f), 'utf8');
    assert.match(y, /check-service-key\.mjs/, f);
    assert.match(y, /id: main\n\s+if: steps\.key\.outputs\.key_ok != '0'/, f);
  }
});

test('foreign filer (20-F, IFRS in EUR): read from ifrs-full and converted to US dollars', async () => {
  const { usAnnualRows, reportingBasis } = await import('../company-lab/annual');
  const fy = (y: number, val: number, form = '20-F') => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, filed: `${y + 1}-02-05`, form, fp: 'FY' });
  const facts = { facts: { 'ifrs-full': {
    Revenue: { units: { EUR: [fy(2024, 15_673e6), fy(2025, 17_186e6)] } },
    CashFlowsFromUsedInOperatingActivities: { units: { EUR: [fy(2024, 2_301e6), fy(2025, 2_933e6)] } },
    PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities: { units: { EUR: [fy(2024, 17e6), fy(2025, 61e6)] } },
    DilutedEarningsLossPerShare: { units: { 'EUR/shares': [fy(2025, 10.51)] } },
    WeightedAverageShares: { units: { shares: [fy(2025, 205_412_951)] } },
  } } };
  assert.deepEqual(reportingBasis(facts), { tax: 'ifrs-full', cur: 'EUR' });
  const rows = usAnnualRows(facts, 10, 1.1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].revenue, 18904.6);    // 17,186 € M × 1.1
  assert.equal(rows[1].fcf, 3159.2);         // (2,933 − 61) × 1.1
  assert.equal(rows[1].eps, 11.56);
  assert.equal(rows[1].shares, 205.41);
});
