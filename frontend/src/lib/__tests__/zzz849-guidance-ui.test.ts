// zzz849 — Guidance Upgrades page fixes: one high-growth set, legend, period-unclear, event tags, company detail, unresolved, failed reasons, mobile collapse.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildHighGrowth, highGrowthLines, unlistedActiveLine, universeNoticeLine, eventTags, isPeriodUnclear, isReiteration, unresolvedCount, unresolvedLine,
  sourceFailedText, VERIFICATION_LEGEND, ZERO_RECORDS_TEXT, qualifiesHighGrowth,
} from '../guidance-upgrades-format';

const pt = (o: any = {}) => ({ metric: 'REVENUE', kind: 'MANAGEMENT_GUIDANCE', growthLow: 60, growthHigh: 60, growthOrigin: 'STATED', period: 'FY27', periodKind: 'FY', ...o });
const rec = (company: string, o: any = {}): any => {
  const { primary, others = [], market = 'IN', validity = 'ACTIVE', history = [], ...rest } = o;
  return {
    origin: 'LIVE', display: '+60%', metric: 'REVENUE', alsoDisplay: [], mediaOnly: false, revision: 'NONE', atRisk: false, ...rest,
    record: { id: company, company, ticker: company.toUpperCase(), market, validity, primary: primary || pt(), others, verification: 'VERIFIED', quality: 'HIGH', history, sources: [] },
  };
};
const data = (records: any[], summary: any = {}): any => ({ records, summary: { threshold: 30, india: {}, usa: {}, all: {}, ...summary } });

describe('one set for headline and list', () => {
  const recs = [
    rec('Big', { primary: pt({ growthLow: 80, growthHigh: 80 }) }),
    rec('Low', { primary: pt({ growthLow: 15, growthHigh: 15 }) }),
    rec('NoPct', { primary: pt({ growthLow: null, growthHigh: null, absoluteTarget: { value: 1500, unit: 'Cr' } }) }),
    rec('PatOnly', { primary: pt({ metric: 'EBITDA', growthLow: 10, growthHigh: 10 }), others: [pt({ metric: 'PAT', growthLow: 70, growthHigh: 70 })] }),
    rec('Expired', { validity: 'EXPIRED' }),
    rec('Analyst', { primary: pt({ kind: 'ANALYST_ESTIMATE' }) }),
    rec('ImpliedNoBase', { primary: pt({ growthOrigin: 'IMPLIED' }) }),
    rec('UsName', { market: 'US' }),
  ];
  test('client-side filter drops sub-30, no-%, expired, analyst, implied without base', () => {
    const v = buildHighGrowth(data(recs), 'ALL');
    assert.deepEqual(v.rows.map((r) => r.company).sort(), ['Big', 'PatOnly', 'UsName']);
    assert.equal(highGrowthLines(v, 'ALL')[0].label.startsWith(`${v.rows.length} companies currently identified`), true);
  });
  test('headline equals list length per market, counts agree', () => {
    const v = buildHighGrowth(data(recs), 'IN');
    assert.equal(v.rows.length, 2);
    const l = highGrowthLines(v, 'IN');
    assert.equal(l[0].label, '2 companies currently identified');
    assert.equal(l.find((x) => /^Revenue ≥/.test(x.label))!.value, '1');
    assert.equal(l.find((x) => /^PAT ≥/.test(x.label))!.value, '1');
  });
  test('quiet line counts unlisted active records', () => {
    const v = buildHighGrowth(data(recs), 'IN');
    assert.match(unlistedActiveLine(v)!, /^\d+ more active records? below 30% or without a % /);
    assert.equal(unlistedActiveLine({ rows: v.rows, activeInMarket: v.rows.length, from: 'records' }), null);
  });
  test('backend summary.highGrowth is used when present, and a sub-30 record is still refused', () => {
    const v = buildHighGrowth(data(recs, { highGrowth: [{ id: 'Big' }, { id: 'Low' }, { company: 'Compact Co', market: 'IN', guidance: '+60% Revenue / +70% PAT', period: 'Q2 (year not stated)' }] }), 'IN');
    assert.equal(v.from, 'backend');
    assert.deepEqual(v.rows.map((r) => r.company), ['Big', 'Compact Co']);
    assert.equal(v.rows[1].periodUnclear, true);
    assert.equal(highGrowthLines(v, 'IN')[0].label, '2 companies currently identified');
  });
  test('qualifies helper', () => { assert.equal(qualifiesHighGrowth(recs[0]), true); assert.equal(qualifiesHighGrowth(recs[1]), false); });
});

describe('legend, period unclear, notices', () => {
  test('legend explains all three marks', () => { for (const g of ['✓', '◐', '○']) assert.ok(VERIFICATION_LEGEND.includes(g)); assert.match(VERIFICATION_LEGEND, /company's own document/); });
  test('period unclear', () => {
    assert.equal(isPeriodUnclear('Q2 (year not stated)'), true); assert.equal(isPeriodUnclear('Period not stated'), true); assert.equal(isPeriodUnclear(''), true);
    assert.equal(isPeriodUnclear('FY27'), false); assert.equal(isPeriodUnclear('Q2 FY27'), false);
  });
  test('expired / unclear line comes from the summary only', () => {
    assert.equal(universeNoticeLine({ expiredCount: 4, unknownPeriodCount: 2 } as any), '4 expired and hidden, 2 with unclear period');
    assert.equal(universeNoticeLine({} as any), null);
  });
});

describe('event tags', () => {
  test('no RAISED / CUT without a prior value', () => {
    assert.deepEqual(eventTags(rec('A', { revision: 'RAISED' })), []);
    assert.deepEqual(eventTags(rec('A', { revision: 'LOWERED' })), []);
  });
  test('tooltip shows before and after', () => {
    const t = eventTags(rec('A', { revision: 'RAISED', history: [{ date: '2026-08-01', period: 'FY27', metric: 'REVENUE', old: '+40%', next: '+60%', revision: 'RAISED', source: 's', reason: '', status: 'ACTIVE' }] }));
    assert.equal(t[0].label, 'RAISED'); assert.match(t[0].tip, /Before: \+40%\. After: \+60%/);
    const c = eventTags(rec('B', { revision: 'LOWERED', primary: pt({ prior: { low: 50, high: 50, unit: '%' } }) }));
    assert.equal(c[0].label, 'CUT'); assert.match(c[0].tip, /Before: 50%/);
  });
  test('at risk keeps showing', () => assert.equal(eventTags(rec('A', { atRisk: true }))[0].label, 'AT RISK'));
  test('reiteration is detected from the range class', () => {
    assert.equal(isReiteration({ v2: { ranges: [{ klass: 'REITERATION' }] }, changes: [] } as any), true);
    assert.equal(isReiteration({ v2: { ranges: [{ klass: 'CLEAN_RAISE' }] }, changes: [] } as any), false);
  });
});

describe('coverage helpers', () => {
  test('unresolved count and line', () => {
    assert.equal(unresolvedCount(3), 3); assert.equal(unresolvedCount([1, 2]), 2); assert.equal(unresolvedCount(undefined), 0);
    assert.equal(unresolvedLine(5), '5 unresolved discoveries held back - not shown as events');
  });
  test('failed source shows the real reason', () => {
    assert.equal(sourceFailedText({ state: 'FAILED', detail: 'HTTP 403 from exchange' }), 'HTTP 403 from exchange');
    assert.equal(sourceFailedText({ state: 'COMPLETE', detail: 'ok' }), null);
    assert.ok(sourceFailedText({ state: 'FAILED', detail: '' }));
  });
  test('zero text', () => assert.equal(ZERO_RECORDS_TEXT, '0 verified active guidance records.'));
});

describe('source-level checks', () => {
  const SRC = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
  const G = (f: string) => read(`components/guidance-upgrades/${f}`);
  test('page keeps the owner order', () => {
    const s = read('app/(dashboard)/guidance-upgrades/page.tsx');
    const at = (k: string) => s.indexOf(k);
    assert.ok(at('<GuTitle') < at('<GuUniverseSummary') && at('<GuUniverseSummary') < at('<GuUniverseBrowser') && at('<GuUniverseBrowser') < at('<GuTopBar') && at('<GuTopBar') < at('<GuCoverage'));
    assert.match(s, /unresolved=\{unresolvedCount\(data\?\.unresolved\)\}/);
  });
  test('summary shows legend, quiet line, zero text and the real error with Retry', () => {
    const s = G('GuUniverseSummary.tsx');
    for (const k of ['VERIFICATION_LEGEND', 'unlistedActiveLine', 'ZERO_RECORDS_TEXT', 'buildHighGrowth', 'GuHighGrowthList', '{error ||', 'Retry']) assert.ok(s.includes(k), k);
    assert.ok(!/UNIVERSE_UNAVAILABLE\}\. Reading/.test(s));
  });
  test('no loading wording once the response arrived', () => {
    const f = read('lib/guidance-upgrades-format.ts');
    assert.ok(!/Universe loading/.test(f));
    for (const n of ['GuUniverseSummary.tsx', 'GuUniverseBrowser.tsx']) { const s = G(n); assert.ok(/state === 'loading' && !data/.test(s), n); }
  });
  test('universe browser: notice line above list, window note, 25-row collapse', () => {
    const b = G('GuUniverseBrowser.tsx'); assert.ok(b.includes('universeNoticeLine')); assert.match(b, /only filters events/);
    const l = G('GuUniverseList.tsx'); assert.match(l, /MOBILE_LIMIT = 25/); assert.match(l, /Show all \$\{records\.length\}/);
    assert.match(G('GuTopBar.tsx'), /only filters these events/);
  });
  test('company detail has the six sections', () => {
    const d = G('GuCompanyDetail.tsx');
    for (const k of ['CURRENT GUIDANCE', 'GUIDANCE HISTORY', 'WHY', 'NEXT PROOF', 'SOURCE', 'Not independently verified', 'Primary source available', 'Primary source read', 'Latest update', 'Issued', 'Base:']) assert.ok(d.includes(k), k);
    assert.ok(G('GuUniverseList.tsx').includes('GuCompanyDetail'));
  });
  test('card shows REITERATED in a neutral colour; coverage shows unresolved and failed reasons', () => {
    assert.match(G('GuCard.tsx'), /color=\{R\.grey\}[^>]*>REITERATED/);
    const c = G('GuCoverage.tsx'); assert.ok(c.includes('unresolvedLine') && c.includes('sourceFailedText'));
  });
  test('rules: no scores, no BUY/SELL, no dark fills in the new files', () => {
    for (const f of ['GuCompanyDetail.tsx', 'GuHighGrowthList.tsx', 'GuUniverseSummary.tsx', 'GuUniverseList.tsx']) {
      const t = G(f);
      assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(t), f); assert.ok(!/\b(BUY|SELL)\b/.test(t), f); assert.ok(!/background:\s*'#(0|1)[0-9a-f]{5}'/i.test(t), f);
    }
  });
});
