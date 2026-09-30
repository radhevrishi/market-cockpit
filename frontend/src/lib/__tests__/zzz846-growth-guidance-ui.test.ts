// zzz846 — Growth Guidance UI: pure helper tests + structural invariants. Synthetic names only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as T from '../growth-guidance-types';
import * as F from '../growth-guidance-format';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const compDir = join(SRC, 'components', 'growth-guidance');
const compFiles = readdirSync(compDir).map((f) => `components/growth-guidance/${f}`);
const uiFiles = [...compFiles, 'app/(dashboard)/growth-guidance/page.tsx', 'lib/growth-guidance-format.ts'];

const keys = (o: object) => Object.keys(o).sort();
const point = (o: any = {}): any => ({ metric: 'REVENUE', kind: 'MANAGEMENT_GUIDANCE', growthLow: 50, growthHigh: 50, growthOrigin: 'STATED', period: 'FY27', periodKind: 'FY', organic: 'UNKNOWN', originalStatement: '', unit: '%', ...o });
const co = (o: any = {}): any => ({
  id: 'a1', ticker: 'AAAA', company: 'Alpha Test', market: 'IN', capBand: 'SMALL', marketCap: null, primary: point(), others: [], verification: 'VERIFIED', quality: 'HIGH', validity: 'ACTIVE',
  sources: [], conflict: null, driverText: '', mechanisms: [], catalysts: [], chain: [], guidanceDuration: '', structuralDuration: '', history: [], revision: 'INITIAL', trend: 'NONE', trendText: null,
  credibility: null, surprise: null, reality: null, earnings: null, map2x2: 'LOW_PRIORITY', expectations: 'UNKNOWN', expectationsWhy: '', valuation: null, nextProof: '', breakers: [],
  links: { radarEligible: false, radarWhy: '' }, organicNote: '', corporateActionGrowth: false, portfolio: { held: false }, announcedAt: null, lastEvidenceAt: null, isNewToday: false, alert: null, ...o,
});

describe('label maps cover every enum in the types file', () => {
  test('one entry per enum value', () => {
    assert.deepEqual(keys(F.MARKET_LABEL), ['GLOBAL', 'IN', 'US']);
    assert.deepEqual(keys(F.METRIC_LABEL), ['EBITDA', 'EPS', 'FCF', 'PAT', 'REVENUE']);
    assert.equal(keys(T.KIND_LABEL).length, 7);
    assert.equal(keys(F.PERIOD_KIND_LABEL).length, 7);
    assert.deepEqual(keys(F.GROWTH_ORIGIN_LABEL), ['IMPLIED', 'STATED']);
    assert.equal(keys(F.ORGANIC_LABEL).length, 4);
    assert.deepEqual(keys(F.QUALITY_LABEL), ['HIGH', 'LOW', 'MEDIUM']);
    assert.equal(keys(F.VALIDITY_LABEL).length, 6);
    assert.equal(keys(F.TRACKING_LABEL).length, 6);
    assert.equal(keys(F.REVISION_LABEL).length, 7);
    assert.equal(keys(F.OUTCOME_LABEL).length, 6);
    assert.equal(keys(F.EXPECTATIONS_LABEL).length, 4);
    assert.equal(keys(F.EXPECTATIONS_PLAIN).length, 4);
    assert.equal(keys(F.INFLECTION_LABEL).length, 4);
    assert.equal(keys(F.MAP2X2_LABEL).length, 4);
    assert.equal(keys(F.CAP_LABEL).length, 5);
    assert.equal(keys(T.CATALYST_LABEL).length, 13);
    assert.equal(keys(F.LEVERAGE_LABEL).length, 4);
    assert.equal(keys(F.RERATING_LABEL).length, 6);
    assert.equal(keys(F.ALERT_KIND_LABEL).length, 8);
    assert.equal(keys(F.ALERT_LEVEL_LABEL).length, 3);
    assert.equal(keys(F.CHAIN_STEP_LABEL).length, 7);
    assert.equal(keys(F.CHAIN_STATUS_LABEL).length, 4);
    assert.equal(keys(F.TREND_LABEL).length, 4);
    assert.equal(keys(F.SCAN_STATE_LABEL).length, 4);
    assert.equal(keys(T.VERIFICATION_LABEL).length, 4);
  });
  test('label maps do not contain empty strings', () => {
    for (const m of [F.VALIDITY_LABEL, F.TRACKING_LABEL, F.REVISION_LABEL, F.OUTCOME_LABEL, F.MAP2X2_LABEL, F.LEVERAGE_LABEL, F.RERATING_LABEL, F.ALERT_KIND_LABEL]) {
      for (const v of Object.values(m)) assert.ok(String(v).trim().length > 0);
    }
  });
});

describe('title, thresholds, sort, query', () => {
  test('threshold title reflects the threshold', () => {
    assert.equal(F.thresholdTitle(30, 'REVENUE', 'FY27'), 'FY27 30%+ growth guidance — verified management guidance / targets');
    assert.equal(F.thresholdTitle(50, 'REVENUE', null), '50%+ growth guidance — verified management guidance / targets');
    assert.match(F.thresholdTitle(75, 'PAT', 'FY28'), /^FY28 PAT 75%\+ growth guidance/);
  });
  test('threshold chips are the requested seven, default 30', () => {
    assert.deepEqual([...T.THRESHOLDS], [20, 25, 30, 40, 50, 75, 100]);
    assert.equal(F.DEFAULT_FILTERS.threshold, 30);
    assert.equal(F.DEFAULT_FILTERS.metric, 'REVENUE');
    assert.equal(F.DEFAULT_FILTERS.cap, 'SMALL_MICRO');
    assert.equal(F.DEFAULT_FILTERS.kind, 'MANAGEMENT');
  });
  test('sort list has the 10 lenses plus default', () => {
    assert.equal(F.SORT_LENSES.length, 10);
    assert.equal(F.SORT_OPTIONS.length, 11);
    assert.equal(F.SORT_OPTIONS[0].value, 'DEFAULT');
    const labels = F.SORT_LENSES.map((s) => s.label);
    for (const l of ['Highest revenue guidance', 'Highest PAT guidance', 'Highest combined growth', 'Biggest guidance increase', 'Strongest earnings confirmation', 'Longest catalyst duration', 'Strongest guidance evidence', 'Earliest inflection', 'Largest expectations gap', 'Portfolio catalyst change']) {
      assert.ok(labels.includes(l), l);
    }
    assert.equal(new Set(F.SORT_OPTIONS.map((s) => s.value)).size, 11);
  });
  test('buildQuery maps every filter', () => {
    const q = new URLSearchParams(F.buildQuery({ threshold: 40, metric: 'PAT', market: 'IN', cap: 'ALL', kind: 'ALL', sort: 'HIGHEST_PAT' }));
    assert.equal(q.get('threshold'), '40'); assert.equal(q.get('metric'), 'PAT'); assert.equal(q.get('market'), 'IN');
    assert.equal(q.get('cap'), 'ALL'); assert.equal(q.get('kind'), 'ALL'); assert.equal(q.get('sort'), 'HIGHEST_PAT');
  });
});

describe('status dot and text', () => {
  test('every tracking maps to a dot and a text label', () => {
    const want: Record<string, [string, string]> = { ON_TRACK: ['🟢', 'ON TRACK'], EARLY: ['🔵', 'EARLY'], ACCELERATION_REQUIRED: ['🟡', 'ACCELERATION REQUIRED'], AT_RISK: ['🟠', 'AT RISK'], BROKEN: ['🔴', 'BROKEN'] };
    for (const [k, [dot, label]] of Object.entries(want)) {
      const s = F.statusOf(co({ reality: { tracking: k } }));
      assert.equal(s.dot, dot); assert.equal(s.label, label);
    }
  });
  test('unknown tracking is neutral, never red', () => {
    const s = F.statusOf(co({ reality: null }));
    assert.equal(s.key, 'NOT_ASSESSED'); assert.equal(s.colorKey, 'grey'); assert.notEqual(s.dot, '🔴');
  });
});

describe('analyst, validity, growth text', () => {
  test('analyst kinds are marked apart from management', () => {
    assert.ok(F.isAnalyst('ANALYST_CONSENSUS')); assert.ok(F.isAnalyst('ANALYST_ESTIMATE'));
    assert.ok(!F.isAnalyst('MANAGEMENT_GUIDANCE')); assert.ok(F.isManagementKind('MANAGEMENT_TARGET'));
    assert.match(F.ANALYST_MARKER, /Not management guidance/);
    const g = read('components/growth-guidance/GgList.tsx');
    assert.match(g, /ANALYST/); assert.match(g, /dashed/);
  });
  test('muted validity', () => {
    assert.ok(!F.isMuted('ACTIVE'));
    for (const v of ['SUPERSEDED', 'ACHIEVED', 'MISSED', 'WITHDRAWN', 'EXPIRED'] as const) assert.ok(F.isMuted(v));
  });
  test('growth formatting: point, range, implied, missing', () => {
    assert.equal(F.fmtGrowth(point()), '50%');
    assert.equal(F.fmtGrowth(point({ growthLow: 40, growthHigh: 60 })), '40–60%');
    assert.match(F.fmtGrowth(point({ growthOrigin: 'IMPLIED' })), /worked out/);
    assert.equal(F.fmtGrowth(point({ growthLow: null, growthHigh: null })), '—');
    assert.equal(F.fmtGrowth(null), '—');
  });
  test('missing numbers read DATA UNAVAILABLE, not zero', () => {
    assert.equal(F.fmtNum(null), 'DATA UNAVAILABLE'); assert.equal(F.fmtMult(undefined), 'DATA UNAVAILABLE');
  });
});

describe('blank sections are suppressed', () => {
  test('bare company shows only snapshot and links', () => {
    assert.deepEqual(F.visibleSections(co()).map((s) => s.key), ['snapshot', 'links']);
  });
  test('numbering has no gaps and follows spec order', () => {
    const c = co({ driverText: 'New plant', nextProof: 'Q2 margin', breakers: ['Order delay'], expectations: 'HIGH', guidanceDuration: 'FY27' });
    const s = F.visibleSections(c);
    assert.deepEqual(s.map((x) => x.key), ['snapshot', 'why', 'expectations', 'duration', 'next', 'breakers', 'links']);
    assert.deepEqual(s.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7]);
  });
  test('Not yet established text counts as blank', () => {
    assert.ok(!F.hasSection('next', co({ nextProof: 'Not yet established' })));
    assert.ok(!F.hasSection('valuation', co({ valuation: { marketCap: null, pe: null, evEbitda: null, priceToSales: null, fcfYield: null, peg: null, embeddedGrowthNote: '', ifAchievedNote: '', rerating: 'UNKNOWN' } })));
    assert.ok(F.hasSection('valuation', co({ valuation: { marketCap: null, pe: 20, evEbitda: null, priceToSales: null, fcfYield: null, peg: null, embeddedGrowthNote: '', ifAchievedNote: '', rerating: 'UNKNOWN' } })));
  });
  test('acceleration trend alone opens the history section', () => {
    assert.ok(F.hasSection('history', co({ trend: 'ACCELERATION' })));
  });
  test('links include bottleneck and special situation only when flagged', () => {
    const k = (c: any) => F.linksFor(c).map((l) => l.key);
    assert.ok(!k(co()).includes('bottleneck'));
    assert.ok(k(co({ links: { bottleneck: true, specialSituation: true, radarEligible: true, radarWhy: 'x', concall: true } })).includes('bottleneck'));
    assert.ok(k(co()).includes('upgrades')); assert.ok(k(co()).includes('news'));
  });
});

describe('portfolio overlay and list text', () => {
  test('held overlay sets portfolio.held, not held stays neutral', () => {
    const r = F.overlayHeld([co({ ticker: 'NSE:AAAA' }), co({ id: 'b', ticker: 'BBBB' })], ['aaaa']);
    assert.equal(r[0].portfolio.held, true); assert.equal(r[1].portfolio.held, false);
  });
  test('copy list is the plain simple table', () => {
    const t = F.listAsText([co()], 'T');
    assert.match(t, /#\tCompany\tRevenue growth\tPAT growth\tGuidance period\tStatus/);
    assert.match(t, /1\tAlpha Test\t50%\t—\tFY27\tNOT ASSESSED/);
  });
});

describe('forbidden wording and structure', () => {
  test('no buy/sell call, composite score, or 0-100 wording in visible UI code', () => {
    for (const f of uiFiles) {
      const s = read(f);
      assert.ok(!/\bBUY\b|\bSELL\b|\bIMMEDIATE_BUY\b/.test(s), `${f} has buy/sell wording`);
      assert.ok(!/\bscore\b|\bscores\b|composite/i.test(s), `${f} has score wording`);
      assert.ok(!/\/\s?100\b|out of 100|0[–-]100/.test(s), `${f} has 0-100 wording`);
    }
  });
  test('page has a default export and no named exports', () => {
    const s = read('app/(dashboard)/growth-guidance/page.tsx');
    assert.match(s, /export default function/);
    assert.deepEqual(s.split('\n').filter((l) => /^export\s+(?!default)/.test(l)), []);
  });
  test('UI never imports price or quote modules, and fetches with an AbortController', () => {
    for (const f of uiFiles) assert.ok(!/from '[^'\n]*(quote|price|market-data|us-nasdaq)[^']*'/i.test(read(f)), f);
    const p = read('app/(dashboard)/growth-guidance/page.tsx');
    assert.match(p, /AbortController/); assert.match(p, /NEW TODAY/); assert.match(p, /DISCOVER/); assert.match(read('lib/growth-guidance-format.ts'), /SCAN INCOMPLETE/);
  });
  test('scan headline never claims no guidance when incomplete', () => {
    assert.match(F.scanHeadline({ complete: false }), /not a confirmation of no guidance/);
    assert.equal(F.scanHeadline({ complete: true }), 'SCAN COMPLETE');
  });
});

describe('nav wiring', () => {
  test('OFFER_ALL contains /growth-guidance and OFFER is untouched', () => {
    const fav = read('lib/nav-favourites.ts');
    assert.match(fav, /OFFER_ALL[^\n]*'\/growth-guidance'/);
    assert.match(fav, /const OFFER: readonly string\[\] = \['\/portfolio-catalysts', '\/exit-radar', '\/ai-gainers', '\/concall-intel\?tab=radar',/);
    assert.match(fav, /'\/us-portfolio-book', '\/us-portfolio-catalysts'\]/);
    const offerLine = fav.split('\n').find((l) => l.startsWith('const OFFER:')) || '';
    assert.ok(!offerLine.includes('growth-guidance'));
  });
  test('sidebar, bottom nav and home chip list the page', () => {
    const nav = read('app/(dashboard)/DashboardClient.tsx');
    assert.equal(nav.split("href: '/growth-guidance'").length - 1, 2);
    assert.ok(read('app/(dashboard)/page.tsx').includes("href: '/growth-guidance'"));
  });
});
