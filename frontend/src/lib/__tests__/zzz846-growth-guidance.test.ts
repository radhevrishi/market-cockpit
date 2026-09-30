// zzz846 — Growth Guidance engine. Synthetic tickers only (ZZ*); no real holdings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractGrowthPoints, buildGrowthGuidance, filterCompanies, sortCompanies, trendOf, credibilityOf, outcomeOf, capBandOf, validityOf, mid,
  QUARTERLY_TIMING_DEFAULT, DRIVER_NOT_STATED, type GgTickerCtx, type GgStoredEntry,
} from '../growth-guidance';
import { appendEntries } from '../growth-guidance-ledger';
import type { GuCandidate } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-30T12:00:00Z');
let n = 0;
const cand = (text: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `c${++n}`, ticker: 'ZZALPHA', company: 'ZZ Alpha Ltd', market: 'IN', title: 'Results and outlook', text, sourceName: 'NSE filing', publishedAt: '2026-09-29T05:00:00.000Z', kind: 'FILING', ...o,
});
const build = (cs: GuCandidate[], ctx: GgTickerCtx = {}) => buildGrowthGuidance({ candidates: cs, ctxFor: () => ctx, now: NOW, threshold: 30 });
const one = (cs: GuCandidate[], ctx: GgTickerCtx = {}) => build(cs, ctx).companies.find((c) => c.primary.metric === 'REVENUE')!;
const F = (over: Partial<Parameters<typeof filterCompanies>[1]> = {}) => ({ threshold: 30, metric: 'REVENUE' as const, market: 'ALL' as const, cap: 'ALL' as const, kind: 'MGMT' as const, ...over });

describe('extraction', () => {
  test("'to double' = +100, 'triple' = +200, 'double-digit' is not a number", () => {
    const d = extractGrowthPoints('We expect revenue to double in FY27.', { now: NOW });
    assert.equal(d[0].growthLow, 100); assert.equal(d[0].growthHigh, 100);
    assert.equal(extractGrowthPoints('Management should double revenue in FY27.', { now: NOW })[0].growthHigh, 100);
    assert.equal(extractGrowthPoints('We expect PAT to triple in FY27.', { now: NOW })[0].growthHigh, 200);
    assert.equal(extractGrowthPoints('We expect double-digit revenue growth in FY27.', { now: NOW }).length, 0);
  });
  test('35-40% range and plain point', () => {
    const p = extractGrowthPoints('Management guides revenue to grow 35–40% in FY27.', { now: NOW });
    assert.equal(p.length, 1); assert.equal(p[0].growthLow, 35); assert.equal(p[0].growthHigh, 40); assert.equal(p[0].metric, 'REVENUE'); assert.equal(p[0].period, 'FY27');
    assert.equal(extractGrowthPoints('The company expects revenue will grow 30% in FY27.', { now: NOW })[0].growthLow, 30);
  });
  test("'strong growth' never becomes a number", () => {
    assert.equal(extractGrowthPoints('We expect strong revenue growth in FY27.', { now: NOW }).length, 0);
    const q = extractGrowthPoints('We expect strong revenue growth in FY27.', { now: NOW, includeQualitative: true });
    assert.equal(q.length, 1); assert.equal(q[0].growthLow, null); assert.equal(q[0].qualitative, true);
    const c = one([cand('We expect strong revenue growth in FY27.')]);
    assert.equal(c, undefined);   // nothing numeric: not a company row
  });
  test('CAGR, multi-year, and rolling 12 months is never shown as FY27', () => {
    const c = extractGrowthPoints('We target a 30% CAGR over FY27–29 in revenue.', { now: NOW })[0];
    assert.equal(c.periodKind, 'MULTI_YEAR_CAGR'); assert.equal(c.growthLow, 30); assert.equal(c.period, 'FY27–29');
    const r = extractGrowthPoints('Revenue is expected to grow 40% over the next 12 months, versus FY27 plan.', { now: NOW })[0];
    assert.equal(r.periodKind, 'ROLLING_12M'); assert.equal(r.period, 'Next 12 months'); assert.ok(!/FY27/.test(r.period));
  });
  test('Indian units normalised; absolute target gives NO growth without a base', () => {
    const p = extractGrowthPoints('Management targets revenue of ₹10,000 crore in FY27.', { now: NOW })[0];
    assert.equal(p.growthLow, null); assert.equal(p.absoluteTarget?.value, 10000); assert.equal(p.absoluteTarget?.unit, '₹ Cr');
    const l = extractGrowthPoints('Management targets revenue of ₹1 lakh crore in FY27.', { now: NOW })[0];
    assert.equal(l.absoluteTarget?.value, 100000);
  });
  test('implied growth only with a base, labelled IMPLIED; stated stays STATED', () => {
    const base = { REVENUE: { value: 6000, period: 'FY26', unit: '₹ Cr' } };
    const p = extractGrowthPoints('Management targets revenue of ₹9,000 crore in FY27.', { now: NOW, base })[0];
    assert.equal(p.growthOrigin, 'IMPLIED'); assert.equal(p.growthLow, 50); assert.equal(p.base?.value, 6000);
    assert.equal(extractGrowthPoints('Management guides revenue to grow 30% in FY27.', { now: NOW })[0].growthOrigin, 'STATED');
  });
  test('Cupid-style sentence: revenue 725-750 cr vs 600 earlier, PAT 210-225 vs 180', () => {
    const t = 'At the AGM the company further raised FY27 guidance: revenue target raised to Rs 725-750 crore from Rs 600 crore, and net profit guidance raised to Rs 210-225 crore from Rs 180 crore.';
    const ps = extractGrowthPoints(t, { now: NOW });
    const rev = ps.find((p) => p.metric === 'REVENUE')!; const pat = ps.find((p) => p.metric === 'PAT')!;
    assert.equal(rev.growthLow, null); assert.equal(rev.absoluteTarget?.value, 725); assert.equal(rev.prior?.low, 600);
    assert.equal(pat.absoluteTarget?.value, 210); assert.equal(pat.prior?.low, 180);
    const withBase = extractGrowthPoints(t, { now: NOW, base: { REVENUE: { value: 500, period: 'FY26', unit: '₹ Cr' } } }).find((p) => p.metric === 'REVENUE')!;
    assert.equal(withBase.growthOrigin, 'IMPLIED'); assert.equal(withBase.growthLow, 45); assert.equal(withBase.growthHigh, 50);
  });
  test('margin statements and past growth are not guidance', () => {
    assert.equal(extractGrowthPoints('EBITDA margin expected to expand by 30% in FY27.', { now: NOW }).length, 0);
    const h = extractGrowthPoints('Revenue grew 45% in FY25.', { now: NOW });
    assert.ok(h.every((p) => p.kind === 'HISTORICAL_TRAJECTORY'));
  });
});

describe('kind, verification, sources', () => {
  test('analyst wording is an analyst kind and never in the management default universe', () => {
    const a = cand('Analysts expect revenue to grow 45% in FY27, brokerages say.', { ticker: 'ZZANA', sourceName: 'Broker research note', kind: 'NEWS' });
    const m = cand('Management guides revenue to grow 35% in FY27.', { ticker: 'ZZMGT' });
    const all = build([a, m]).companies;
    assert.ok(all.find((c) => c.ticker === 'ZZANA')!.primary.kind.startsWith('ANALYST'));
    const dflt = filterCompanies(all, F({ kind: 'MGMT' }));
    assert.ok(![...dflt.companies, ...dflt.discovery].some((c) => c.ticker === 'ZZANA'));
    const incl = filterCompanies(all, F({ kind: 'ALL' }));
    assert.ok([...incl.companies, ...incl.discovery].some((c) => c.ticker === 'ZZANA'));
  });
  test('media-only goes to discovery, not companies', () => {
    const c = cand('ZZ Media says management expects revenue to grow 50% in FY27.', { ticker: 'ZZMED', sourceName: 'Reuters', kind: 'NEWS' });
    const f = filterCompanies(build([c]).companies, F());
    assert.equal(f.companies.length, 0); assert.equal(f.discovery.length, 1); assert.equal(f.discovery[0].verification, 'SECONDARY_ONLY');
    const soc = cand('Management expects revenue to grow 60% in FY27!!', { ticker: 'ZZSOC', sourceName: 'Twitter', kind: 'NEWS' });
    assert.equal(build([soc]).companies[0].verification, 'SECONDARY_ONLY');
  });
  test('primary guidance with exact number is VERIFIED; commentary only PARTIALLY', () => {
    assert.equal(one([cand('Management guidance: revenue to grow 35% in FY27.')]).verification, 'VERIFIED');
    assert.equal(one([cand('We believe revenue will grow 35% in FY27.')]).verification, 'PARTIALLY_VERIFIED');
  });
  test('syndicated copies do not upgrade verification', () => {
    const copies = [1, 2, 3, 4].map((i) => cand('Management expects revenue to grow 45% in FY27.', { ticker: 'ZZSYN', sourceName: ['Reuters', 'Moneycontrol', 'Economic Times', 'Mint'][i - 1], kind: 'NEWS' }));
    const c = build(copies).companies[0];
    assert.equal(c.verification, 'SECONDARY_ONLY');
    assert.equal(c.evidence!.independentSources, 1); assert.ok(c.evidence!.syndicatedCopies >= 2);
  });
  test('source conflict: primary +30% vs media +40%, primary wins, conflict object', () => {
    const p = cand('Management guides revenue to grow 30% in FY27.', { ticker: 'ZZCON' });
    const m = cand('Management expects revenue to grow 40% in FY27, sources say.', { ticker: 'ZZCON', sourceName: 'Reuters', kind: 'NEWS', publishedAt: '2026-09-30T02:00:00.000Z' });
    const c = build([p, m]).companies.find((x) => x.primary.metric === 'REVENUE')!;
    assert.equal(mid(c.primary), 30); assert.ok(c.conflict); assert.match(c.conflict!.note, /primary source/i); assert.equal(c.verification, 'VERIFIED');
  });
});

describe('organic, quality, validity', () => {
  test('organic vs acquisition wording and corporate action flag', () => {
    assert.equal(one([cand('Management guides organic revenue growth of 35% in FY27.')]).primary.organic, 'ORGANIC');
    const a = one([cand('Management guides revenue to grow 60% in FY27 driven by the consolidation of the acquired subsidiary.')]);
    assert.equal(a.primary.organic, 'ACQUISITION_LED'); assert.equal(a.corporateActionGrowth, true);
    const u = one([cand('Management guides revenue to grow 35% in FY27.')]);
    assert.equal(u.primary.organic, 'UNKNOWN'); assert.match(u.organicNote, /Organic component: unknown/);
  });
  test('formal + primary + clear period + measurable = HIGH; weak evidence LOW', () => {
    assert.equal(one([cand('Management guidance: revenue to grow 35% in FY27.')]).quality, 'HIGH');
    assert.equal(one([cand('Management expects revenue to grow 80% sometime soon.', { ticker: 'ZZW', sourceName: 'Twitter', kind: 'NEWS' })]).quality, 'LOW');
  });
  test('FY26 guidance is EXPIRED in FY27, FY27 guidance ACTIVE', () => {
    const old = one([cand('Management guides revenue to grow 35% in FY26.', { publishedAt: '2025-06-01T05:00:00.000Z' })]);
    assert.equal(old.validity, 'EXPIRED');
    assert.equal(one([cand('Management guides revenue to grow 35% in FY27.')]).validity, 'ACTIVE');
    assert.equal(validityOf(null, NOW, { withdrawn: true }), 'WITHDRAWN');
  });
  test('cap band: India / US thresholds, UNKNOWN when absent', () => {
    assert.equal(capBandOf('IN', 400), 'MICRO'); assert.equal(capBandOf('IN', 3000), 'SMALL'); assert.equal(capBandOf('IN', 8000), 'MID'); assert.equal(capBandOf('IN', 50000), 'LARGE');
    assert.equal(capBandOf('US', 250), 'MICRO'); assert.equal(capBandOf('US', 1500), 'SMALL'); assert.equal(capBandOf('US', 50000), 'LARGE');
    assert.equal(capBandOf('IN', null), 'UNKNOWN');
  });
});

describe('WHY, reality, earnings', () => {
  test('driver stated vs not stated', () => {
    const a = one([cand('Management guides revenue to grow 40% in FY27 on the back of capacity expansion and a strong order book.')]);
    assert.ok(a.mechanisms.includes('capacity expansion') && a.mechanisms.includes('order book'));
    assert.ok(a.catalysts.includes('B_CAPACITY_EXPANSION')); assert.ok(!/management expects/i.test(a.driverText));
    const b = one([cand('Management guides revenue to grow 40% in FY27.')]);
    assert.equal(b.driverText, DRIVER_NOT_STATED); assert.deepEqual(b.mechanisms, []);
  });
  test('reality: never assumes linear quarters; implied revenue; tracking', () => {
    const ctx: GgTickerCtx = { reported: { unit: '₹ Cr', priorFyRevenue: 1000, ttmRevenue: 1100, latestQuarterYoyPct: 10, quartersReportedInPeriod: 1, opmFrom: 14, opmTo: 16, patYoyPct: 40 } };
    const c = one([cand('Management guides revenue to grow 35% in FY27.')], ctx);
    assert.equal(c.reality!.quarterlyTimingNote, QUARTERLY_TIMING_DEFAULT);
    assert.equal(c.reality!.impliedRevenue, 1350); assert.equal(c.reality!.requiredGrowthFromRunRate, 22.7);
    assert.equal(c.reality!.tracking, 'AT_RISK');
    assert.equal(one([cand('Management guides revenue to grow 35% in FY27.')]).reality!.tracking, 'NOT_ASSESSED');
  });
  test('no data = NO_EVIDENCE_YET; leverage classification', () => {
    const c = one([cand('Management guides revenue to grow 35% in FY27.')]);
    assert.equal(c.earnings, null);
    const ol = one([cand('Management guides revenue to grow 35% in FY27.')], { reported: { latestQuarterYoyPct: 25, patYoyPct: 60, ebitdaYoyPct: 50 } });
    assert.equal(ol.earnings!.leverage, 'OPERATING_LEVERAGE');
    const md = one([cand('Management guides revenue to grow 35% in FY27.')], { reported: { latestQuarterYoyPct: 25, patYoyPct: 5 } });
    assert.equal(md.earnings!.leverage, 'MARGIN_DILUTION'); assert.equal(md.earnings!.inflection, 'EARLY_INFLECTION');
    assert.equal(one([cand('Management guides revenue to grow 35% in FY27.')], { reported: { latestQuarterYoyPct: 5 } }).earnings!.inflection, 'NO_EVIDENCE_YET');
  });
  test('expectations gap UNKNOWN without consensus/prior; valuation DATA UNAVAILABLE', () => {
    const c = one([cand('Management guides revenue to grow 35% in FY27.')], { valuation: { pe: 20 } });
    assert.equal(c.expectations, 'UNKNOWN'); assert.match(c.expectationsWhy, /Not inferred from P\/E/);
    assert.equal(c.valuation!.ifAchievedNote, 'DATA UNAVAILABLE'); assert.equal(c.valuation!.embeddedGrowthNote, 'DATA UNAVAILABLE');
    assert.equal(one([cand('Management guides revenue to grow 35% in FY27.')], { consensusGrowthPct: 25 }).expectations, 'MODERATE');
  });
  test('next proof is specific, breakers follow the mechanism', () => {
    const c = one([cand('Management guides revenue to grow 40% in FY27 on the back of capacity expansion.')]);
    assert.ok(!/^monitor/i.test(c.nextProof)); assert.match(c.nextProof, /capacity|commission/i);
    assert.ok(c.breakers.some((b) => /commissioning/i.test(b)));
  });
});

describe('ledger, revision, trend, credibility', () => {
  const mk = (date: string, lo: number, rev?: any): GgStoredEntry => ({ key: `d${date}|REVENUE|FY27`, docId: `d${date}`, date, metric: 'REVENUE', period: 'FY27', periodKind: 'FY', low: lo, high: lo, unit: '%', kind: 'MANAGEMENT_GUIDANCE',
    verification: 'VERIFIED', source: 'NSE filing', sourceRank: 1, statement: `revenue to grow ${lo}%`, growthOrigin: 'STATED', revision: rev });
  test('trend ACCELERATION 40→50→60 and DETERIORATION', () => {
    const t = trendOf([40, 50, 60]); assert.equal(t.trend, 'ACCELERATION'); assert.match(t.text!, /40% → 50% → 60%/);
    assert.equal(trendOf([60, 45, 30]).trend, 'DETERIORATION');
    const ledger = [mk('2026-01-10', 40, 'INITIAL'), mk('2026-04-10', 50, 'RAISED')];
    const c = one([cand('Management guidance: revenue to grow 60% in FY27.', { publishedAt: '2026-09-29T05:00:00.000Z' })], { ledger });
    assert.equal(c.trend, 'ACCELERATION'); assert.equal(c.revision, 'RAISED'); assert.equal(c.revisionPp, 10);
    assert.equal(c.history.length, 3); assert.equal(c.history[2].old, '+50%');
    assert.equal(c.alert!.kind, 'GUIDANCE_RAISED'); assert.equal(c.alert!.level, 'HIGH'); assert.equal(c.isNewToday, false);
  });
  test('credibility sentence is factual, never a judgement', () => {
    const es: GgStoredEntry[] = [
      { ...mk('2025-01-01', 30, 'INITIAL'), period: 'FY25', key: 'a|REVENUE|FY25', outcome: 'ACHIEVED' }, { ...mk('2025-06-01', 30, 'INITIAL'), period: 'FY26', key: 'b|REVENUE|FY26', outcome: 'MISSED', actualPct: 20 },
      { ...mk('2026-01-01', 35, 'LOWERED'), period: 'FY26', key: 'c|REVENUE|FY26' },
    ];
    const cr = credibilityOf(es)!;
    assert.match(cr.line, /^Last 2 guidance cycles: 1 achieved\/exceeded/); assert.ok(!/good|bad|reliable|trustworthy/i.test(cr.line));
    assert.equal(cr.missed, 1); assert.equal(cr.avgMissPct, 10);
  });
  test('outcomes at period end', () => {
    const end = new Date('2026-03-31'); const e = (a: number | null) => outcomeOf({ low: 30, high: 35 }, end, NOW, a, false);
    assert.equal(e(40), 'EXCEEDED'); assert.equal(e(32), 'ACHIEVED'); assert.equal(e(20), 'MISSED'); assert.equal(e(null), 'NOT_COMPARABLE');
    assert.equal(outcomeOf({ low: 30, high: 35 }, new Date('2027-03-31'), NOW, 50, false), 'PENDING'); assert.equal(outcomeOf({ low: 30, high: 35 }, end, NOW, 50, true), 'WITHDRAWN');
  });
  test('withdrawal marks guidance WITHDRAWN and BROKEN', () => {
    const c = build([cand('Management guides revenue to grow 35% in FY27.', { publishedAt: '2026-08-01T05:00:00.000Z' }), cand('The company has withdrawn its FY27 guidance.', { publishedAt: '2026-09-29T05:00:00.000Z' })])
      .companies.find((x) => x.primary.metric === 'REVENUE')!;
    assert.equal(c.validity, 'WITHDRAWN'); assert.equal(c.reality!.tracking, 'BROKEN'); assert.equal(c.alert!.kind, 'GUIDANCE_BROKEN');
  });
  test('ledger append never overwrites history', () => {
    const a = mk('2026-01-10', 40); const a2 = { ...a, low: 99, high: 99, statement: 'CHANGED' };
    const first = appendEntries(null, [a])!; assert.equal(first.entries.length, 1);
    assert.equal(appendEntries(first, [a2]), null);                       // same key: nothing new, nothing replaced
    const second = appendEntries(first, [a2, mk('2026-04-10', 50)])!;
    assert.equal(second.entries[0].low, 40); assert.equal(second.entries[0].statement, a.statement); assert.equal(second.entries.length, 2);
  });
  test('new guidance produces idempotent ledger entries (same doc never re-added)', () => {
    const c1 = cand('Management guidance: revenue to grow 35% in FY27.');
    const r1 = build([c1]); const e1 = r1.newEntries.get('IN:ZZALPHA')!; assert.equal(e1.length, 1);
    const r2 = buildGrowthGuidance({ candidates: [c1], ctxFor: () => ({ ledger: e1 }), now: NOW }); assert.equal(r2.newEntries.size, 0);
  });
});

describe('alerts, sorting, filters, radar', () => {
  test('default sort: 35% strong evidence above 80% weak evidence; no score anywhere', () => {
    const strong = cand('Management guidance: revenue to grow 35% in FY27 on the back of capacity expansion.', { ticker: 'ZZSTRONG' });
    const weak = cand('Management expects revenue to grow 80% sometime soon.', { ticker: 'ZZWEAK', sourceName: 'Reuters', kind: 'NEWS' });
    const all = build([strong, weak]).companies;
    const sorted = sortCompanies(all, 'DEFAULT');
    assert.deepEqual(sorted.map((c) => c.ticker), ['ZZSTRONG', 'ZZWEAK']);
    assert.equal(sortCompanies(all, 'HIGHEST_REVENUE')[0].ticker, 'ZZWEAK');
    assert.ok(!/score/i.test(JSON.stringify(all)));
  });
  test('threshold filter and metric filter', () => {
    const all = build([cand('Management guidance: revenue to grow 25% in FY27.', { ticker: 'ZZLOW' }), cand('Management guidance: revenue to grow 45% and PAT to grow 60% in FY27.', { ticker: 'ZZHIGH' })]).companies;
    assert.deepEqual(filterCompanies(all, F({ threshold: 30 })).companies.map((c) => c.ticker), ['ZZHIGH']);
    assert.equal(filterCompanies(all, F({ threshold: 20 })).companies.length, 2);
    assert.deepEqual(filterCompanies(all, F({ threshold: 50, metric: 'PAT' })).companies.map((c) => c.ticker), ['ZZHIGH']);
    assert.deepEqual(filterCompanies(all, F({ threshold: 30 })).companies[0].others.map((o) => o.metric), ['PAT']);
  });
  test('cap filter: default SMALL_MICRO excludes large and unknown; ALL keeps unknown labelled', () => {
    const cs = [cand('Management guidance: revenue to grow 40% in FY27.', { ticker: 'ZZSM' }), cand('Management guidance: revenue to grow 40% in FY27.', { ticker: 'ZZBIG' }), cand('Management guidance: revenue to grow 40% in FY27.', { ticker: 'ZZUNK' })];
    const res = buildGrowthGuidance({ candidates: cs, now: NOW, ctxFor: (t) => (t === 'ZZSM' ? { marketCap: 1200 } : t === 'ZZBIG' ? { marketCap: 90000 } : {}) }).companies;
    assert.deepEqual(filterCompanies(res, F({ cap: 'SMALL_MICRO' })).companies.map((c) => c.ticker), ['ZZSM']);
    const all = filterCompanies(res, F({ cap: 'ALL' })).companies; assert.equal(all.length, 3); assert.equal(all.find((c) => c.ticker === 'ZZUNK')!.capBand, 'UNKNOWN');
  });
  test('radar eligibility is not automatic for every >=30%', () => {
    const plain = one([cand('Management guidance: revenue to grow 90% in FY27.')]);
    assert.equal(plain.links.radarEligible, false); assert.match(plain.links.radarWhy, /Not eligible/);
    const good = one([cand('Management guidance: revenue to grow 40% in FY27 on the back of capacity expansion and a record order book.')]);
    assert.equal(good.links.radarEligible, true);
  });
  test('bottleneck link from themes; held flag always false; newToday list', () => {
    const c = one([cand('Management guidance: revenue to grow 40% in FY27.', { publishedAt: '2026-09-30T04:00:00.000Z' })], { themes: ['HBM supply'] });
    assert.equal(c.links.bottleneck, true); assert.ok(c.catalysts.includes('J_BOTTLENECK')); assert.equal(c.portfolio.held, false);
    assert.equal(c.alert!.kind, 'NEW_GUIDANCE'); assert.equal(c.isNewToday, true);
  });
  test('US and India tickers with the same letters stay separate', () => {
    const r = build([cand('Management guidance: revenue to grow 35% in FY27.', { ticker: 'ZZX', market: 'IN' }), cand('Management guidance: revenue to grow 55% in FY27.', { ticker: 'ZZX', market: 'US' })]).companies;
    assert.equal(r.length, 2); assert.deepEqual(r.map((c) => c.market).sort(), ['IN', 'US']);
  });
});

describe('route safety', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/v1/growth-guidance/route.ts'), 'utf8');
  test('no AI, no document fetch, no holdings read', () => {
    assert.ok(!/anthropic|openai|haiku|book\/|portfolio|\bfetch\(/i.test(src.replace(/\/\/.*$/gm, '')));
  });
  test('route file only exports Next handlers', () => {
    const ex = Array.from(src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)).map((m) => m[1]);
    assert.ok(ex.every((e) => ['GET', 'runtime', 'dynamic', 'maxDuration'].includes(e)), ex.join(','));
  });
});

describe('zzz847 candidates without a resolved ticker', () => {
  test('kept with company name, ticker empty, tickerResolved false', () => {
    const r = build([cand('Management guides revenue to grow 35–40% in FY27.', { ticker: undefined, company: 'ZZ NoTicker Industries' })]);
    const c = r.companies.find((x) => x.primary.metric === 'REVENUE')!;
    assert.ok(c); assert.equal(c.ticker, ''); assert.equal(c.tickerResolved, false); assert.equal(c.company, 'ZZ NoTicker Industries');
    assert.equal(r.newEntries.size, 0);
  });
  test('no ticker and no company is still dropped', () => {
    assert.equal(build([cand('Management guides revenue to grow 35–40% in FY27.', { ticker: undefined, company: undefined })]).companies.length, 0);
  });
});
