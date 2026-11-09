// zzz1211 — margin quality ceiling (India + USA), gross-margin rule with the operating-margin offset, results PDFs read 2 h
// after the filing (not 2 days), bhavcopy misses remembered, Railway health check, Company Lab bars above the checklist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { marginQualityCap } from '../earnings-grade-shared';
import { applyGrossMargin } from '../us-gross-margin';
import { dueItems } from '../india-results-pdf';
import { bhavMissTtlMs } from '../nse-bhavcopy';

test('Mold-Tek: sales +31%, OPM 19% → 18%, profit +40% → at most MIXED', () => {
  const c = marginQualityCap({ opmExp: -1, salesY: 30.5, patY: 40, opProfitYoy: null });
  assert.equal(c?.max, 'MIXED');
  assert.match(c!.why, /operating margin fell −?-?1\.0 pts/);
  // huge growth carries a small margin dip: STRONG at most
  assert.equal(marginQualityCap({ opmExp: -1.2, salesY: 35, patY: 71 })?.max, 'STRONG');
  // operating profit kept up with sales: a whole-point rounding dip is not a real fall
  assert.equal(marginQualityCap({ opmExp: -1, salesY: 30, patY: 40, opProfitYoy: 29 }), null);
  assert.equal(marginQualityCap({ opmExp: -0.5, salesY: 30, patY: 40 }), null);
  assert.equal(marginQualityCap({ opmExp: 2, salesY: 30, patY: 40 }), null);
});

test('gross margin: −3 pts caps; −1.5 pts caps unless the operating margin rose ≥ 1 pt (nVent stays)', () => {
  assert.equal(marginQualityCap({ opmExp: 2.8, gmDelta: -1.6, salesY: 44, patY: 67 }), null);
  assert.equal(marginQualityCap({ opmExp: 0.2, gmDelta: -1.6, salesY: 44, patY: 67 })?.max, 'MIXED');
  assert.equal(marginQualityCap({ opmExp: 3, gmDelta: -3.4, salesY: 44, patY: 67 })?.max, 'MIXED');
  const ser = (gpNow: number) => ({ ends: ['2025-06-28', '2025-09-27', '2025-12-31', '2026-03-28', '2026-06-27', '2026-09-26'], revenue: [100, 1050, 100, 100, 100, 1510], gross_profit: [37, 392.7, 37, 37, 37, gpNow] });
  const nvt: any = { tier: 'STRONG', opm_pct: 18.6, opm_prev_pct: 15.8, sales_yoy_pct: 44, pat_yoy_pct: 67, caveat_tags: [], series: ser(540.6) };
  assert.equal(applyGrossMargin(nvt), false);
  assert.equal(nvt.tier, 'STRONG');
  assert.match(nvt.gross_margin.offset, /operating margin \+2\.8 pts/);
  const flat: any = { tier: 'STRONG', opm_pct: 15.9, opm_prev_pct: 15.8, sales_yoy_pct: 44, pat_yoy_pct: 67, caveat_tags: [], series: ser(540.6) };
  assert.equal(applyGrossMargin(flat), true);
  assert.equal(flat.tier, 'MIXED');
  assert.equal(flat.tier_before_margin_cap, 'STRONG');
  assert.ok(flat.caveat_tags.some((t: string) => /gross margin fell/.test(t)));
});

test('results PDF read 20 minutes after the filing is seen (zzz1221; was 2 h, before that 2 days)', () => {
  const now = Date.parse('2026-11-02T15:00:00Z');
  const q = (added: string) => ({ ticker: 'ITC', filed: '2026-11-02', want: '2026-09-30', added_at: added });
  assert.equal(dueItems([q('2026-11-02T12:30:00Z')], new Set(), new Map(), now).length, 1);
  assert.equal(dueItems([q('2026-11-02T14:50:00Z')], new Set(), new Map(), now).length, 0);
  assert.equal(dueItems([q('2026-11-02T14:30:00Z')], new Set(), new Map(), now).length, 1);
});

test('bhavcopy: a missing day file is remembered (10 min recent, 6 h old)', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(bhavMissTtlMs('2026-11-02', now), 10 * 60_000);
  assert.equal(bhavMissTtlMs('2026-10-01', now), 6 * 3600_000);
});

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
test('engines bumped; health check; results-pdf slots; Company Lab bars first', () => {
  assert.match(read('lib/graded-cache-key.ts'), /GRADED_CACHE_VERSION = 'v27'/);
  assert.match(read('lib/india-regrade.ts'), /INDIA_REGRADABLE_FROM: readonly string\[\] = \['v26'/);
  const us = read('lib/us-engine-version.ts');
  assert.match(us, /US_ENGINE_VERSION = '2026\.11\.02-a'/);
  assert.match(us, /PREVIOUS_VERSIONS: readonly string\[\] = \[\n  '2026\.10\.26-b'/);
  assert.match(read('app/api/healthz/route.ts'), /ok: true/);
  // zzz1221 (intentional change): every 20 min while companies file
  assert.match(read('lib/app-scheduler.ts'), /name: 'results-pdf', crons: \['20 \* \* \* \*', '0,40 4-17 \* \* 1-6'\]/);
  const pg = read('app/(dashboard)/company-lab/page.tsx');
  assert.ok(pg.indexOf('<YearBars title="FCF growth vs sales growth"') < pg.indexOf('CHECKLIST ·'), 'plots above the checklist');
  assert.match(pg, /clipR=\{150\}/);
  assert.match(read('lib/india-grade.ts'), /marginQualityCap\(\{ opmExp/);
  assert.match(read('lib/us-earnings-core.ts'), /marginQualityCap\(\{ opmExp, opProfitYoy: _opY/);
});

test('Upstash: batched queue scan, "who has a PDF record" list, enrich + extraction process copies', async () => {
  const { runResultsPdf } = await import('../india-results-pdf-run');
  const store = new Map<string, any>([['results-pdf:v1:queue', [{ ticker: 'AAA', filed: '2026-10-01', want: '2026-09-30', added_at: '2026-10-01T10:00:00Z' }]]]);
  let gets = 0, mgets = 0;
  const kv = {
    get: async (k: string) => { gets++; return store.get(k) ?? null; },
    set: async (k: string, v: unknown) => { store.set(k, v); },
    setNX: async (k: string, v: unknown) => { if (store.has(k)) return false; store.set(k, v); return true; },
    del: async (k: string) => { store.delete(k); },
    mget: async (ks: string[]) => { mgets++; return ks.map((k) => store.get(k) ?? null); },
  };
  const r = await runResultsPdf({ kv: kv as any, screenerQuarter: async () => '2026-09-30', findDocs: async () => [], readPdf: async () => ({ text: '' }), callModel: async () => ({ ok: false, kind: 'x', message: 'x' }), regrade: async () => {}, now: () => new Date('2026-11-02T12:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(mgets, 1);
  assert.ok(Array.isArray(store.get('results-pdf:v1:have')), 'the list is always written');
  assert.match(read('app/api/v1/earnings/enrich/route.ts'), /const have = fresh \? null : await resultsPdfHave\(\)/);
  assert.match(read('app/api/v1/earnings/enrich/route.ts'), /_enrichMem\.get\(cacheKey\)/);
  assert.match(read('lib/guidance-extract-reader.ts'), /__MC_EXTRACT_MEMO__/);
  assert.match(read('lib/kv.ts'), /forgetExtractCopy\(key\)/);
  void gets;
});

test('India: whole-percent OPM rounding is not a margin fall (Mold-Tek: 19% → 18% shown, operating profit +30.8% on sales +30.5%)', async () => {
  const { gradeIndiaRow } = await import('../india-grade');
  const { marginView } = await import('../india-eo-card-data');
  const base = { ticker: 'MOLDTKPAC', company: 'Mold-Tek Packaging Limited', filing_date: '2026-11-02', announce_date_iso: '2026-11-02', quarter: 'Q2 FY27', sales_curr_cr: 274, sales_prev_cr: 210, sales_yoy_pct: 30.5,
    pat_curr_cr: 21, pat_prev_cr: 15, eps_curr: 3.17, eps_prev: 2.33, eps_yoy_pct: 36.1, opm_pct: 18, opm_prev_pct: 19, op_profit_yoy_pct: 30.8, ocf_to_pat_ratio: 1.71, market_cap_cr: 1941 };
  const g: any = gradeIndiaRow(base);
  assert.ok(g);
  assert.ok(!g.caveat_tags.includes('segment mix shift'), 'no mix-shift caveat from a rounding dip');
  assert.ok(!g.caveat_tags.some((t: string) => /operating margin fell/.test(t)));
  assert.equal(g.opm_exp_pp, 0);
  assert.match(marginView(g).note, /exact from operating profit/);
  const weak: any = gradeIndiaRow({ ...base, op_profit_yoy_pct: 22 });
  assert.equal(weak.tier, 'MIXED');
  assert.ok(weak.caveat_tags.some((t: string) => /operating margin fell 1\.2 pts — operating profit \+22\.0% vs sales \+30\.5%/.test(t)));
});

test('nVent: an AI web check without a quoted cut does not move the grade', async () => {
  const { guideLine } = await import('../us-guide-line');
  const { applyGuideCheck } = await import('../us-guide-check');
  const gc = { source: 'ai-web', direction: 'mixed', lowered: true, what: 'Raised full-year reported sales to 48–49% and adjusted EPS to $5.36–$5.39; EBITDA guidance was reportedly trimmed in follow-up reporting.',
    quote: 'The company now estimates reported sales growth for full-year 2026 of 48 to 49 percent…expects full-year 2026 EPS of $4.54 to $4.57 and adjusted EPS of $5.36 to $5.39.' };
  assert.equal(guideLine({ guide_check: gc }).lowered, false);
  const row: any = { tier: 'STRONG', caveat_tags: [], methodology_tags: [] };
  assert.equal(applyGuideCheck(row, gc as any), false);
  assert.equal(row.tier, 'STRONG');
  // with the cut in its own quote it still counts
  const cut = { ...gc, quote: 'We now expect full-year adjusted EBITDA below our prior range, lowered to $1.1 billion.' };
  assert.equal(guideLine({ guide_check: cut }).lowered, true);
});
