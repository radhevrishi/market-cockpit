// zzz794 — India Portfolio Catalysts: a provisional nearest-fit thesis type
// for every name with ANY figures. 30 names on the live harness read
// "◇ THESIS NOT SET" although each had a full quarter of figures on file.
//
// Run: npx tsx --test src/lib/__tests__/zzz794-in-thesis-type.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assessBookRow } from '../thesis/use-book';
import { provisionalType, orderGrowthYoY, noTypeReason, isProvisionalFallback, PROVISIONAL_LABEL } from '../thesis/provisional-type';
import { PROVISIONAL_BLOCKED, STATUS_META } from '../thesis/status';
import { universeCounts } from '../thesis/evidence-counts';
import { classifyOrNearest, manualPattern } from '../earnings/pattern-abfg';

const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz794-in-thesis-type-untyped.json'), 'utf8'));
const ROOT = join(__dirname, '..', '..', '..');

function row(symbol: string, graded: any | null, summary: any | null = null, pattern: any = undefined): any {
  return assessBookRow({
    symbol, origin: 'book', market: 'IN', graded, tier: null,
    pattern: pattern === undefined ? (graded ? classifyOrNearest(graded) : null) : pattern,
    radarScore: null, summary, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null,
    dataSource: graded ? graded.source : null,
  } as any);
}
const AFFIRMATIVE = new Set(['STRENGTHENING', 'ON_TRACK', 'POSITIVE_EXPECTATION_GAP']);

describe('zzz794 · the rules, one per type', () => {
  test('loss to profit → F', () => {
    const p = provisionalType({ sales_yoy_pct: 107, pat_curr_cr: 55, pat_prev_cr: -17, opm_pct: 51, opm_prev_pct: 66 }, null)!;
    assert.equal(p.pattern, 'F'); assert.equal(p.fit, 'nearest'); assert.equal(p.weak, false);
    assert.match(p.because, /^Nearest fit \(auto, provisional\) — F · profit jump/);
    assert.match(p.because, /from a loss a year earlier to a profit/);
  });
  test('order intake growing faster than revenue → B', () => {
    const p = provisionalType({ sales_yoy_pct: 72, eps_yoy_pct: 72.5, opm_pct: 19, opm_prev_pct: 19, period: 'Q1 FY27' }, { demand: { order_intake_growth: '87% YoY in Q1' } })!;
    assert.equal(p.pattern, 'B');
    assert.match(p.because, /\+87% year on year against revenue \+72%/);
  });
  test('margin up with revenue not falling → A (operating leverage)', () => {
    const p = provisionalType({ sales_yoy_pct: 20.6, eps_yoy_pct: 22.2, opm_pct: 15, opm_prev_pct: 14 }, null)!;
    assert.equal(p.pattern, 'A');
    assert.match(p.because, /operating margin \+1 point year on year/);
  });
  test('revenue ≥ 15% with lagging earnings → A, provisional (the test is whether margins follow)', () => {
    const p = provisionalType({ sales_yoy_pct: 33.8, eps_yoy_pct: 6, opm_pct: 16, opm_prev_pct: 16 }, null)!;
    assert.equal(p.pattern, 'A');
    assert.match(p.because, /whether margins follow is the test/);
  });
  test('steady and cash-backed (cash conversion / ROCE) → G', () => {
    assert.equal(provisionalType({ sales_yoy_pct: 8, eps_yoy_pct: 4, pat_curr_cr: 30, opm_pct: 18, opm_prev_pct: 18.5, cfo_to_pat_ratio: 1.2 }, null)!.pattern, 'G');
    assert.equal(provisionalType({ pat_curr_cr: 66, opm_pct: 20, roce_pct: 44 }, null)!.pattern, 'G');
  });
  test('capacity coming on stream → A', () => {
    const p = provisionalType({ pat_curr_cr: 6597, opm_pct: 48 }, { capex_projects: [{ name: 'Smelter', capacity_added: '435 KTPA (commissioning initiated)' }] })!;
    assert.equal(p.pattern, 'A'); assert.equal(p.weak, false);
    assert.match(p.because, /435 KTPA/);
  });
  test('figures do not discriminate → weak fit from the business words, labelled so', () => {
    const b = provisionalType({ sales_yoy_pct: 8.3, eps_yoy_pct: -28.7, opm_pct: 36, opm_prev_pct: 42, cfo_to_pat_ratio: 0.84 },
      { verdict_line: 'Q1 FY27 confirms order‑book visibility but flags H2 revenue dip as three rigs undergo dehire.' })!;
    assert.equal(b.pattern, 'B'); assert.equal(b.weak, true);
    assert.match(b.because, /A weak fit — nothing in the figures points clearly at one type/);
    const a = provisionalType({ sales_yoy_pct: 2, eps_yoy_pct: -20, opm_pct: 10, opm_prev_pct: 11 }, null)!;
    assert.equal(a.pattern, 'A'); assert.equal(a.weak, true);
    assert.match(a.because, /no industry is on file/);
  });
  test('no figures at all → no type, and a plain reason', () => {
    assert.equal(provisionalType(null, null), null);
    assert.equal(provisionalType({ ticker: 'X', source: 'screener' }, null), null);
    assert.match(noTypeReason(null, null), /^no quarterly figures on file for this company yet/);
  });
  test('order growth is read only when the text ties it to a year', () => {
    assert.equal(orderGrowthYoY('87% YoY in Q1'), 87);
    assert.equal(orderGrowthYoY('23.4% YoY'), 23.4);
    assert.equal(orderGrowthYoY('Tritium bookings ~2x QoQ'), null);
    assert.equal(orderGrowthYoY('up 30% since Mar 2026', 'Jun 2026'), null);
    assert.equal(orderGrowthYoY('up 30% since Mar 2026 and up 195% since Jun 2025 (as reported)', 'Jun 2026'), 195);
    assert.equal(orderGrowthYoY('approx. 81.19 % as on 1 July 2026 vs prior year'), 81.19);
    assert.equal(orderGrowthYoY('Increased by INR1,832 million QoQ'), null);
    assert.equal(orderGrowthYoY(''), null);
  });
});

describe('zzz794 · through the page\'s own row builder', () => {
  test('a provisional type is never affirmative, never ranked, and says it is provisional', () => {
    const r = row('TEST', { ticker: 'TEST', source: 'screener-live', sales_yoy_pct: 155.7, eps_yoy_pct: -72, opm_pct: 16, opm_prev_pct: 23 });
    assert.ok(isProvisionalFallback(r.pattern));
    assert.equal(r.pattern.fit, 'nearest');
    assert.notEqual(r.assessment.status, 'THESIS_NOT_SET');
    assert.ok(!PROVISIONAL_BLOCKED.has(r.assessment.status), r.assessment.status);
    assert.equal(r.assessment.catalystRank, null);
    assert.ok(STATUS_META[r.assessment.status as keyof typeof STATUS_META]);
  });
  test('no evidence read → EVIDENCE INCOMPLETE (unknown, not negative)', () => {
    const r = row('TEST', { ticker: 'TEST', source: 'screener-live', sales_yoy_pct: 20, eps_yoy_pct: 25, opm_pct: 15, opm_prev_pct: 14 });
    assert.equal(r.assessment.status, 'EVIDENCE_INCOMPLETE');
  });
  test('the owner\'s type and an exact classification always win over the provisional fallback', () => {
    const g = { ticker: 'TEST', source: 'graded', sales_yoy_pct: 30, eps_yoy_pct: 60, opm_pct: 20, opm_prev_pct: 15 };
    const exact = row('TEST', g);
    assert.equal(exact.pattern.fit, 'exact');
    assert.ok(!isProvisionalFallback(exact.pattern));
    const manual = row('TEST', { ...g, eps_yoy_pct: 5 }, null, manualPattern('G'));
    assert.equal(manual.pattern.fit, 'manual'); assert.equal(manual.pattern.pattern, 'G');
  });
  test('a provisional fallback is re-derived when the figures change (never frozen on old figures)', () => {
    const first = row('TEST', { ticker: 'TEST', source: 'screener', sales_yoy_pct: 2, eps_yoy_pct: -20, opm_pct: 10, opm_prev_pct: 11 });
    assert.equal(first.pattern.weak, true);
    const next: any = assessBookRow({ ...first, graded: { ticker: 'TEST', source: 'screener-live', sales_yoy_pct: 10, pat_curr_cr: 50, pat_prev_cr: -5 } });
    assert.equal(next.pattern.pattern, 'F');
    assert.equal(next.pattern.weak, false);
  });
  test('THESIS NOT SET only with no figures at all — and the card says why in plain words', () => {
    const r = row('NOFIG', null);
    assert.equal(r.pattern, null);
    assert.equal(r.assessment.status, 'THESIS_NOT_SET');
    assert.match(r.assessment.because, /^THESIS NOT SET — no quarterly figures on file for this company yet/);
    assert.doesNotMatch(`${r.assessment.because} ${r.assessment.actionLine}`, /\b(BUY|SELL)\b|target price|stop[- ]loss/);
  });
});

describe('zzz794 · the 30 names that read THESIS NOT SET on the live harness', () => {
  const names = Object.keys(FX.rows);
  const rows = names.map((t) => row(t, FX.rows[t].graded, FX.rows[t].summary));
  test('fixture is the 30 names', () => assert.equal(names.length, 30));
  test('every one now carries a provisional nearest-fit type', () => {
    const none = rows.filter((r) => !r.pattern).map((r) => r.symbol);
    assert.deepEqual(none, []);
    for (const r of rows) {
      assert.equal(r.pattern.fit, 'nearest', r.symbol);
      assert.match(r.pattern.because, /^Nearest fit \(auto, provisional\)/, r.symbol);
    }
  });
  test('by type: 23 A · 3 B (1 weak) · 4 F · 0 G', () => {
    const by: Record<string, string[]> = {};
    for (const r of rows) (by[`${r.pattern.pattern}${r.pattern.weak ? ' weak' : ''}`] ||= []).push(r.symbol);
    assert.deepEqual(by['F']?.sort(), ['CLEANMAX', 'E2E', 'KOLTEPATIL', 'MOLBIO']);
    assert.deepEqual(by['B']?.sort(), ['LCL', 'TDPOWERSYS']);
    assert.deepEqual(by['B weak'], ['JINDRILL']);
    assert.equal(by['A']?.length, 23);
    assert.equal(by['A weak'], undefined);
  });
  test('status is at most CONFIRMATION REQUIRED — never an affirmative verdict, never THESIS NOT SET', () => {
    for (const r of rows) {
      const s = r.assessment.status;
      assert.ok(!AFFIRMATIVE.has(s) && !PROVISIONAL_BLOCKED.has(s) && s !== 'THESIS_NOT_SET', `${r.symbol} ${s}`);
      assert.equal(r.assessment.catalystRank, null, r.symbol);
      assert.doesNotMatch(`${r.assessment.because}`, /\b(BUY|SELL)\b|target price|stop[- ]loss|share price/, r.symbol);
    }
  });
  test('the header line counts them as provisional and reconciles', () => {
    const uc = universeCounts(rows, rows, ['STRENGTHENING', 'ON_TRACK', 'CONFIRMATION_REQUIRED', 'POSITIVE_EXPECTATION_GAP']);
    assert.equal(uc.thesisNotSet, 0);
    assert.equal(uc.provisional, 30);
    assert.equal(uc.provisionalWeak, 1);
    assert.equal(uc.statusSum + uc.notAssessed, uc.shown);
    assert.match(uc.line, /0 thesis not set · 30 provisional \(nearest-fit, 1 of them a weak fit\)/);
  });
});

describe('zzz794 · wording and page rules', () => {
  test('the label is the owner\'s words', () => assert.equal(PROVISIONAL_LABEL, 'nearest fit (auto, provisional)'));
  test('page.tsx still has only its default export', () => {
    const page = readFileSync(join(ROOT, 'src/app/(dashboard)/portfolio-catalysts/page.tsx'), 'utf8');
    const named = page.split('\n').filter((l) => /^export\s/.test(l) && !/^export\s+default\b/.test(l));
    assert.deepEqual(named, []);
  });
  test('the card shows the weak-fit mark and the plain no-figures reason', () => {
    const card = readFileSync(join(ROOT, 'src/components/thesis-card.tsx'), 'utf8');
    assert.match(card, /weak fit/);
    assert.match(card, /No figures on file for this company yet/);
  });
});
