// zzz853 — Guidance Universe DATA INTEGRITY. Synthetic tickers only (ZZ...). The seed JSON is data; no company logic is tested by name.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUniverse, summarize, buildRegression, type GuSeedRow, type GuUniverseBuild } from '../guidance-universe';
import { checkUniverseInvariants } from '../guidance-invariants';
import { HIGH_GROWTH_THRESHOLD, classifySourceTier, canVerify, UNIVERSE_LASTGOOD_KEY } from '../guidance-config';
import { getUniverseBundle, buildUniverseResponse, getSeedRows } from '../guidance-universe-service';
import { DEFAULT_THRESHOLD } from '../growth-guidance-format';

const NOW = new Date('2026-10-01T09:00:00Z');
const mk = (o: Partial<GuSeedRow> = {}): GuSeedRow => ({
  company: 'ZZ Alpha Ltd', ticker: 'ZZALPHA', market: 'IN', metric: 'REVENUE', growthLow: 40, growthHigh: 40, growthOrigin: 'STATED', absoluteTarget: null, period: 'FY27', periodKind: 'FY', kind: 'MANAGEMENT_GUIDANCE', organic: 'ORGANIC',
  statement: 'Management guides revenue growth of 40% for the year.', driver: null, mechanisms: [], sourceName: 'Q4 call', sourceType: 'Concall', sourceUrl: 'https://example.com/a', sourceDate: '2026-08-10', sourceRank: 7, verification: 'VERIFIED',
  priorGuidance: [], supersededBy: null, notes: '', ownerListText: null, ...o,
});
const co = (n: string, o: Partial<GuSeedRow> = {}) => mk({ company: `ZZ ${n} Ltd`, ticker: `ZZ${n.toUpperCase()}`, ...o });
const bld = (rows: GuSeedRow[]) => buildUniverse([], [], rows, NOW);
const pt = (b: GuUniverseBuild, name: string) => b.records.find((r) => r.record.company === `ZZ ${name} Ltd`)!.points[0];
const RAW = JSON.parse(readFileSync(join(process.cwd(), 'src/data/growth-guidance-seed.json'), 'utf8'));

describe('growth basis', () => {
  const b = bld([
    co('Derived', { growthLow: 60, growthHigh: 60, growthOrigin: 'IMPLIED', absoluteTarget: { value: 160, unit: '₹ Cr' }, impliedBase: { value: 100, unit: '₹ Cr', period: 'FY26' }, statement: 'Targets revenue of Rs 160 crore in FY27.', sourceRank: 3, sourceType: 'Earnings release' }),
    co('Explicit'),
  ]);
  test('100 -> 160 is DERIVED +60% with its basis stored and shown; never a bare (implied)', () => {
    const p = pt(b, 'Derived');
    assert.equal(p.growthType, 'DERIVED'); assert.equal(p.verificationState, 'DERIVED');
    const d = p.growthDerivation!; assert.equal(d.previousValue, 100); assert.equal(d.currentLow, 160); assert.equal(Math.round(d.growthMid), 60); assert.equal(d.basis, 'absolute_vs_prior_year_actual');
    assert.match(p.display, /\+60% vs FY26 actual \(derived: ₹160 Cr vs ₹100 Cr\)/); assert.doesNotMatch(p.display, /\(implied\)/);
    assert.equal(p.guidanceType, 'ABSOLUTE_TARGET');
  });
  test('a stated % is EXPLICIT', () => { const p = pt(b, 'Explicit'); assert.equal(p.growthType, 'EXPLICIT'); assert.equal(p.guidanceType, 'GROWTH_RATE'); });
});

describe('period integrity', () => {
  const b = bld([co('Q4', { period: 'Q4', periodKind: 'QUARTER', growthLow: 60, growthHigh: 60, statement: 'Revenue growth of 60% in Q4.' }), co('Ok')]);
  test('a Q4 record with no year stays UNCLEAR (never taken from today) and is out of the default view', () => {
    const p = pt(b, 'Q4'); assert.equal(p.periodStatus, 'UNCLEAR'); assert.equal(p.verificationState, 'PERIOD_UNCLEAR'); assert.equal(p.fiscalYear, null);
    assert.ok(!b.defaultRecords.some((r) => r.record.company === 'ZZ Q4 Ltd'));
    const q = b.reviewQueue.find((r) => r.record.company === 'ZZ Q4 Ltd')!; assert.ok(q.reviewReasons.length > 0);
  });
  test('a confirmed FY record is in the default view', () => { assert.ok(b.defaultRecords.some((r) => r.record.company === 'ZZ Ok Ltd')); assert.equal(pt(b, 'Ok').periodStatus, 'CONFIRMED'); });
});

describe('cohorts and claim types', () => {
  const b = bld([co('Cagr', { period: 'FY27-30', periodKind: 'MULTI_YEAR_CAGR', growthLow: 40, growthHigh: 40, statement: 'Revenue CAGR of 40% over three years.' }), co('One', { growthLow: 40, growthHigh: 40 }),
    co('Analyst', { kind: 'ANALYST_ESTIMATE', statement: 'Analysts estimate revenue growth of 35%.' })]);
  const s = summarize(b.defaultRecords, NOW, 30, b.inactive, b.reviewQueue);
  test('CAGR is in its own cohort, never the single-year one', () => {
    const g = s.highGrowthGroups.cohorts;
    assert.ok(g.MULTI_YEAR_CAGR.some((r) => r.company === 'ZZ Cagr Ltd')); assert.ok(!g.ANNUAL.some((r) => r.company === 'ZZ Cagr Ltd')); assert.ok(g.ANNUAL.some((r) => r.company === 'ZZ One Ltd'));
  });
  test('an analyst estimate is excluded with a reason and is not in the universe', () => {
    assert.ok(!b.records.some((r) => r.record.company === 'ZZ Analyst Ltd'));
    const x = b.excluded.find((e) => e.company === 'ZZ Analyst Ltd')!; assert.ok(x && /analyst/i.test(x.reason)); assert.notEqual(x.claimType, 'MANAGEMENT_GUIDANCE');
  });
});

describe('strict verified section', () => {
  const b = bld([
    co('Ver', { sourceRank: 3, sourceType: 'Earnings release', sourceName: 'Release' }),
    co('Media', { sourceRank: 10, sourceType: 'Media', sourceName: 'Some Blog', verification: 'SECONDARY_ONLY', growthLow: 45, growthHigh: 45, statement: 'Revenue growth of 45% expected.' }),
    co('Der', { growthLow: 60, growthHigh: 60, growthOrigin: 'IMPLIED', absoluteTarget: { value: 160, unit: '₹ Cr' }, impliedBase: { value: 100, unit: '₹ Cr', period: 'FY26' }, statement: 'Targets revenue of Rs 160 crore in FY27.', sourceRank: 3, sourceType: 'Earnings release' }),
    co('Unc', { period: 'Q2', periodKind: 'QUARTER', growthLow: 50, growthHigh: 50, statement: 'Revenue growth of 50% in Q2.', sourceRank: 3, sourceType: 'Earnings release' }),
  ]);
  const s = summarize(b.defaultRecords, NOW, 30, b.inactive, b.reviewQueue, b.claimsAwaiting);   // zzz854: claims come from their own list
  test('verified section holds only strictly verified rows (no media, derived or unclear)', () => {
    const names = Object.values(s.highGrowthGroups.trust.verified).flat().map((r) => r.company);
    assert.deepEqual(names, ['ZZ Ver Ltd']);
    const der = Object.values(s.highGrowthGroups.trust.derived).flat().map((r) => r.company); assert.ok(der.includes('ZZ Der Ltd'));
    const aw = Object.values(s.highGrowthGroups.trust.claimsAwaiting).flat().map((r) => r.company); assert.ok(aw.includes('ZZ Media Ltd')); assert.ok(!aw.includes('ZZ Unc Ltd'));
  });
  test('no media-only, unclear or derived-with-review record is VERIFIED; counts come from the same set', () => {
    assert.notEqual(pt(b, 'Media').verificationState, 'VERIFIED'); assert.equal(pt(b, 'Unc').verificationState, 'PERIOD_UNCLEAR');
    assert.equal(s.counts.activeRecords, b.defaultRecords.length); assert.equal(s.counts.verified, 1); assert.equal(s.counts.derived, 1);
  });
});

describe('sources and tiers', () => {
  test('a source conflict stores both values and never averages them', () => {
    const b = bld([co('Cf', { growthLow: 50, growthHigh: 50, statement: 'Revenue growth of 50%.', sourceDate: '2026-09-20', sourceRank: 10, sourceType: 'Media', sourceName: 'Some Blog', verification: 'SECONDARY_ONLY' }),
      co('Cf', { growthLow: 30, growthHigh: 30, statement: 'Revenue growth of 30%.', sourceDate: '2026-09-21', sourceRank: 3, sourceType: 'Earnings release', sourceName: 'Release' })]);
    const p = pt(b, 'Cf'); assert.equal(p.sourceConflict, true); assert.equal(p.sources.length, 2); assert.equal(p.low, 30); assert.equal(p.primaryValue?.low, 30); assert.equal(p.mediaClaim?.low, 50);
    assert.ok(!b.defaultRecords.some((r) => r.record.company === 'ZZ Cf Ltd')); assert.ok(b.reviewQueue.some((r) => r.record.company === 'ZZ Cf Ltd'));
  });
  test('a TIER3 source can never VERIFY', () => {
    assert.equal(classifySourceTier({ rank: 8, type: 'Media' }).tier, 3); assert.equal(canVerify(3), false); assert.equal(canVerify(1), true);
    const b = bld([co('T3', { sourceRank: 8, sourceType: 'Media', sourceName: 'Business Standard', verification: 'VERIFIED' })]);
    const p = pt(b, 'T3'); assert.notEqual(p.verificationState, 'VERIFIED'); assert.equal(p.primarySourceFound, false); assert.match(p.primarySourceText, /primary source not found/i);
  });
});

describe('history and lifecycle', () => {
  const b = bld([co('H', { growthLow: 20, growthHigh: 20, statement: 'Revenue growth of 20%.', sourceDate: '2026-05-01' }), co('H', { growthLow: 30, growthHigh: 30, statement: 'Revenue growth of 30%.', sourceDate: '2026-06-20' }),
    co('H', { growthLow: 40, growthHigh: 40, statement: 'Revenue growth of 40%.', sourceDate: '2026-08-20' })]);
  test('A -> B -> C is a consecutive chain; only C is active; A and B are superseded', () => {
    const p = pt(b, 'H'); assert.equal(p.low, 40);
    assert.deepEqual(p.history.map((h) => h.status), ['SUPERSEDED', 'SUPERSEDED', 'ACTIVE']); assert.deepEqual(p.history.map((h) => h.step), [1, 2, 3]);
    assert.equal(p.history[2].to.low, 40);
  });
  test('superseded versions are not active records and carry an expiryReason', () => {
    assert.equal(b.records.filter((r) => r.record.company === 'ZZ H Ltd').length, 1);
    const sup = b.inactive.filter((x) => x.company === 'ZZ H Ltd'); assert.equal(sup.length, 2); for (const x of sup) { assert.equal(x.status, 'SUPERSEDED'); assert.equal(x.current, false); assert.ok(x.expiryReason); }
  });
  // zzz854 decision: 60-90 days = caveat, stays Active; more than 90 days = moved to Needs review (STALE_VERIFICATION). It is still ACTIVE guidance (not expired).
  test('stale verification: 60-90 days warns and stays active; over 90 days moves to needs review', () => {
    const w = bld([co('Warm', { sourceDate: '2026-07-20', lastVerified: '2026-07-20' })]); const pw = pt(w, 'Warm');
    assert.ok((pw.lastVerifiedDaysAgo ?? 0) > 60 && (pw.lastVerifiedDaysAgo ?? 0) <= 90); assert.equal(pw.status, 'ACTIVE'); assert.ok(w.defaultRecords.length === 1); assert.ok(w.defaultRecords[0].caveats.some((c) => /Last verified more than/.test(c)));
    const o = bld([co('Old', { sourceDate: '2026-05-01', lastVerified: '2026-05-01' })]); const p = pt(o, 'Old');
    assert.ok((p.lastVerifiedDaysAgo ?? 0) > 90); assert.equal(p.status, 'ACTIVE'); assert.equal(o.defaultRecords.length, 0);
    assert.ok(o.reviewQueue[0].reviewReasonCodes.includes('STALE_VERIFICATION'));
  });
});

describe('central config', () => {
  test('one threshold constant: 30, shared by every consumer', () => {
    assert.equal(HIGH_GROWTH_THRESHOLD, 30); assert.equal(DEFAULT_THRESHOLD, HIGH_GROWTH_THRESHOLD);
    const b = bld([co('A')]); assert.equal(summarize(b.defaultRecords, NOW).highGrowthGroups.threshold, HIGH_GROWTH_THRESHOLD);
    for (const f of ['guidance-universe.ts', 'growth-guidance.ts', 'growth-guidance-format.ts']) assert.doesNotMatch(readFileSync(join(process.cwd(), 'src/lib', f), 'utf8'), /(?:threshold|THRESHOLD)\s*(?:=|\?\?)\s*30\b/);
  });
});

describe('invariants', () => {
  test('the seed run has no violations', () => {
    const seed = getSeedRows(RAW); const b = bld(seed.rows);
    assert.deepEqual(checkUniverseInvariants({ defaultRecords: b.defaultRecords, reviewQueue: b.reviewQueue, inactive: b.inactive, excluded: b.excluded }), []);
  });
  test('a deliberately broken bundle is flagged', () => {
    const b = bld([co('Br', { sourceRank: 10, sourceType: 'Media', sourceName: 'Some Blog', verification: 'SECONDARY_ONLY' }), co('Ok')]);
    const broken = JSON.parse(JSON.stringify([...b.defaultRecords, ...(b.claimsAwaiting ?? [])])) as typeof b.defaultRecords;   // zzz854: a media row is a claim, never Active; put it in Active by hand
    const br = broken.find((r) => r.record.company === 'ZZ Br Ltd')!; br.points[0].verificationState = 'VERIFIED'; br.points[0].periodStatus = 'UNCLEAR'; br.points[0].display = '+40% (implied)';
    const codes = checkUniverseInvariants({ defaultRecords: broken }).map((v) => v.code);
    for (const c of ['VERIFIED_BY_SECONDARY_SOURCE', 'DEFAULT_PERIOD_NOT_CONFIRMED', 'BARE_IMPLIED', 'TIER3_VERIFIED']) assert.ok(codes.includes(c), c);
  });
});

describe('persistence and fallback', () => {
  const store = new Map<string, any>();
  const baseDeps = { kvGet: async (k: string) => store.get(k) ?? null, kvSet: async (k: string, v: any) => { store.set(k, JSON.parse(JSON.stringify(v))); }, readStored: async () => null, writeStored: async () => true, now: () => NOW, seed: { rows: [co('Seed')] } };
  test('a live build serves live, writes the last-good copy; a failing live source still serves seed rows', async () => {
    const live = await getUniverseBundle(0, true, { ...baseDeps, getLive: async () => { throw new Error('news cache down'); } });
    assert.equal(live.servedFrom, 'live'); assert.ok(live.build.defaultRecords.some((r) => r.record.company === 'ZZ Seed Ltd')); assert.match(live.liveError || '', /news cache down/);
    assert.ok(store.get(UNIVERSE_LASTGOOD_KEY)); assert.ok(live.builtAt);
  });
  test('when the build throws, the last-good copy is served; with none, the seed', async () => {
    const boom = { ...baseDeps, seed: { rows: [] as GuSeedRow[] }, getLive: async () => { throw new Error('x'); }, readStored: async () => { throw new Error('kv down'); } };
    const lg = await getUniverseBundle(0, true, boom);
    assert.equal(lg.servedFrom, 'last_good'); assert.ok(lg.build.defaultRecords.some((r) => r.record.company === 'ZZ Seed Ltd'));
    store.clear();
    const sd = await getUniverseBundle(0, true, { ...boom, seed: { rows: [co('Seed2')] } });
    assert.ok(['seed', 'live'].includes(sd.servedFrom)); assert.ok(Array.isArray(sd.build.defaultRecords));
    store.clear();
    const e = await getUniverseBundle(0, true, { ...boom, seed: { rows: [] as GuSeedRow[] } });
    assert.equal(e.servedFrom, 'seed'); assert.equal(e.build.records.length, 0);
  });
});

describe('window independence', () => {
  test('an event window does not change the universe', () => {
    const rows = [co('A'), co('B', { growthLow: 55, growthHigh: 55, statement: 'Revenue growth of 55%.' })];
    const a = buildUniverse([], [], rows, NOW, { eventWindow: '24H' } as any); const c = buildUniverse([], [], rows, NOW, { eventWindow: '30D' } as any); const d = buildUniverse([], [], rows, NOW);
    assert.deepEqual(JSON.stringify(a.defaultRecords), JSON.stringify(c.defaultRecords)); assert.deepEqual(JSON.stringify(a.defaultRecords), JSON.stringify(d.defaultRecords));
  });
});

describe('route response and regression (seed)', () => {
  test('response carries views, counts, servedFrom, builtAt and empty invariantViolations', async () => {
    const b = await getUniverseBundle(0, true, { kvGet: async () => null, kvSet: async () => {}, readStored: async () => null, writeStored: async () => true, now: () => NOW, seed: RAW, getLive: async () => { throw new Error('down'); } });
    const r = buildUniverseResponse(b, { view: 'history' }) as any;
    assert.deepEqual(r.invariantViolations, []); assert.equal(r.servedFrom, 'live'); assert.ok(r.builtAt); assert.equal(r.viewCounts.default, b.build.defaultRecords.length);
    assert.ok(Array.isArray(r.inactive) && Array.isArray(r.excluded)); assert.equal(r.filters.view, 'history');
    const rv = buildUniverseResponse(b, { view: 'review' }) as any; assert.equal(rv.records.length, b.build.reviewQueue.length);
    assert.ok(rv.records.every((x: any) => x.reviewReasons.length > 0));
  });
  test('regression has the owner columns and nothing is forced to PASS', () => {
    const b = bld(getSeedRows(RAW).rows); const reg = buildRegression(getSeedRows(RAW).rows, b, NOW) as any;
    assert.ok(reg.rows.length >= 20); for (const c of ['company', 'resolved', 'growthType', 'verificationState', 'active']) assert.ok(reg.columns.includes(c), c);
    assert.ok(reg.rows.some((x: any) => x.status !== 'VERIFIED'));
  });
});
