// zzz1007 — the Rule of 40 back on the Pine Screener (owner: "Rule of 40 should also be in the Pine Screener and should work with
// different combinations"): a Rule of 40 control (off / ≥ 40 / ≥ 60 / custom) that combines AND-style with the pattern part, the
// timeframes and the company list; strict on missing figures; guard-blanked values never pass; the active query summary and the
// CSV columns carry it; growth / quality / valuation rules in the rule editor again; three built-in Rule of 40 + chart-setup screens;
// the old Pine id 'tv-rule-of-40' opens a Pine screen again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN_META, type PatternId } from '../chart-patterns';
import {
  runPineFull, cleanQuery, cleanPineScreens, onList, pineFilters, pineShownCols, r40Guarded, r40Text, ruleState, pineRuleMenu, pineRuleGroup,
  PINE_RULE_GROUPS, DEFAULT_QUERY, LEAN_KEYS, PINE_GROUPS, leanRows, type PineQuery, type ScreenPatternTag,
} from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { BUILT_IN_SCREENS, fieldOf, filterKeys } from '../screener/filters';
import { querySummary, setupCounts, cardQuery, SETUP_CARDS, withCarriedR40, r40AfterScreen, whyNotListed } from '../screener/pine-view';
import type { ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const T = (id: PatternId, s: 'f' | 'b' | 'x', c: number, d: number | null, extra: Partial<ScreenPatternTag> = {}): ScreenPatternTag =>
  ({ id, b: PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s, c, p: 100, d, ...extra });
const ready = { st: 'ready', v: 6, px: 97, asOf: '2026-10-12', session: 'completed' } as any;
const readyW = { st: 'ready', v: 6, px: 97, asOf: '2026-10-09' } as any;
const row = (t: string, o: Partial<ScreenRow> = {}): ScreenRow =>
  ({ t, n: `${t} Inc`, px: 100, mc: 1000, avgVol30: 300_000, tvSec: 'Technology Services', scan: { st: 'no-pattern', v: 6, px: 100, asOf: '2026-10-12' }, patAt: '2026-10-12', ...o } as ScreenRow);

// GOOD: R40 55, daily cup forming near the pivot · WEAK: R40 20 with the same pattern · NOR40: pattern, no Rule of 40 figure
// ART: tiny-base artefact (growth 900% + FCF −60% = 840 stored) · WK: R40 70, weekly base only · DOWN: R40 80, bearish pattern only
// FLAT: R40 65, no pattern at all
const ROWS: ScreenRow[] = [
  row('GOOD', { r40: 55, revQYoY: 35, fcfmTTM: 20, pat: [T('cup', 'f', 70, -3)], scan: ready }),
  row('WEAK', { r40: 20, revQYoY: 10, fcfmTTM: 10, pat: [T('cup', 'f', 70, -3)], scan: ready }),
  row('NOR40', { pat: [T('cup', 'f', 70, -3)], scan: ready }),
  row('ART', { r40: 840, revQYoY: 900, fcfmTTM: -60, pat: [T('cup', 'f', 70, -3)], scan: ready }),
  row('WK', { r40: 70, revQYoY: 50, fcfmTTM: 20, patW: [T('flat_base', 'f', 68, -4, { tf: 'W', l: 8, lu: 'w' })], scanW: readyW } as any),
  row('DOWN', { r40: 80, revQYoY: 60, fcfmTTM: 20, pat: [T('double_top', 'f', 70, -3)], scan: ready }),
  row('FLAT', { r40: 65, revQYoY: 45, fcfmTTM: 20 }),
];
const Q = (o: Partial<PineQuery>): PineQuery => cleanQuery({ ...DEFAULT_QUERY, ...o });
const strict = (q: PineQuery, rows = ROWS) => runPineFull(rows, q, 'US').strict.map((h) => h.row.t).sort();

test('zzz1007 the Rule of 40 control combines with the pattern part, direction and timeframe', () => {
  const bull = Q({ bias: 'U' });
  assert.deepEqual(strict(bull), ['ART', 'GOOD', 'NOR40', 'WEAK'], 'without the control: every daily bullish pattern');
  assert.deepEqual(strict({ ...bull, r40Min: 40 }), ['GOOD'], '≥ 40: the weak one, the one with no figure and the artefact drop out');
  assert.deepEqual(strict({ ...bull, r40Min: 60 }), [], '≥ 60');
  assert.deepEqual(strict({ ...bull, r40Min: 15 }), ['GOOD', 'WEAK'], 'custom level');
  // timeframe: the weekly base only shows on W
  assert.deepEqual(strict({ ...bull, tfs: ['W'], r40Min: 40 }), ['WK']);
  assert.deepEqual(strict({ ...bull, tfs: ['D', 'W'], tfMode: 'any', r40Min: 40 }), ['GOOD', 'WK']);
  // direction: bearish + Rule of 40
  assert.deepEqual(strict({ ...Q({ bias: 'D' }), r40Min: 40 }), ['DOWN']);
  // pattern types ticked
  assert.deepEqual(strict({ ...bull, ids: ['flat_base'], tfs: ['W'], r40Min: 40 }), ['WK']);
  assert.deepEqual(strict({ ...bull, ids: ['flat_base'], tfs: ['D'], r40Min: 40 }), []);
  // rules decide (no pattern needed): every company with a Rule of 40 ≥ 40
  assert.deepEqual(strict({ ...Q({ bias: 'both', need: 'any' }), r40Min: 40 }), ['DOWN', 'FLAT', 'GOOD', 'WK']);
  // and with other rules: the control is ANDed with them
  assert.deepEqual(strict({ ...Q({ bias: 'both', need: 'any', filters: [{ kind: 'num', key: 'fcfmTTM', op: 'ge', v: 20 }] }), r40Min: 60 }), ['DOWN', 'FLAT', 'WK']);
});

test('zzz1007 company list (portfolio / watchlist / Stock screen) narrows the Rule of 40 result', () => {
  const q = { ...Q({ bias: 'U', tfs: ['D', 'W'], tfMode: 'any' }), r40Min: 40 };
  const run = runPineFull(ROWS, q, 'US');
  assert.deepEqual(onList(run.strict, new Set(['WK', 'WEAK'])).map((h) => h.row.t), ['WK'], 'a portfolio / watchlist');
  assert.deepEqual(onList(run.strict, null).map((h) => h.row.t).sort(), ['GOOD', 'WK'], 'every company');
  // the Stock Screener's own Rule of 40 copies stay (the Pine list can still be one of them)
  assert.ok(BUILT_IN_SCREENS.some((s) => s.id === 'tv-rule-of-40') && BUILT_IN_SCREENS.some((s) => s.id === 'tv-rule-of-40-in'));
  // setup-card counts include the control (it is carried onto every card)
  const n = setupCounts(ROWS, 'US', null, null, new Date(), { r40Min: 40 });
  for (const c of SETUP_CARDS) if (c.presetId) assert.equal(n[c.id], runPineFull(ROWS, withCarriedR40(cardQuery(c)!, { r40Min: 40 }), 'US').strict.length, c.id);
  const ready = setupCounts(ROWS, 'US', null, null), readyR40 = setupCounts(ROWS, 'US', null, null, new Date(), { r40Min: 40 });
  assert.ok((readyR40.ready ?? 0) < (ready.ready ?? 0), 'the Rule of 40 narrows the card counts');
});

test('zzz1007 strict figures: missing Rule of 40 fails; provisional only while no company has it; guard-blanked values fail', () => {
  const q = { ...Q({ bias: 'U' }), r40Min: 40 };
  const r = runPineFull(ROWS, q, 'US');
  assert.ok(!r.provisional.some((h) => h.row.t === 'NOR40'), 'others have the figure: NOR40 fails, it is not provisional');
  // nobody has the figure yet (a build pending): provisional, never a match
  const none = ROWS.filter((x) => x.t === 'NOR40');
  const rn = runPineFull(none, q, 'US');
  assert.equal(rn.strict.length, 0); assert.equal(rn.provisional.length, 1);
  assert.match(rn.provisional[0].missing!.join(';'), /Rule of 40/);
  // the artefact: stored 840 from growth 900% + FCF −60% — never passes, whichever source the row came from
  const art = ROWS.find((x) => x.t === 'ART')!;
  assert.equal(r40Guarded(art), true);
  assert.equal(ruleState(art, { kind: 'num', key: 'r40', op: 'ge', v: 40 }, 'US'), 'fail');
  assert.ok(!r.strict.some((h) => h.row.t === 'ART'));
  // an extra rule on r40 (not only the control) gets the same guard
  assert.deepEqual(strict(Q({ bias: 'U', filters: [{ kind: 'num', key: 'r40', op: 'ge', v: 40 }] })), ['GOOD']);
  // lean rows blank it before the page sees it
  const lean = leanRows([{ ...art }] as ScreenRow[]).rows[0];
  assert.equal(lean.r40 ?? null, null);
  // FCF margin outside −100…+100 too
  assert.equal(r40Guarded({ r40: 60, revQYoY: 20, fcfmTTM: 140 }), true);
  assert.equal(r40Guarded({ r40: 60, revQYoY: 40, fcfmTTM: 20 }), false);
  // why-not names the control
  const w = whyNotListed('WEAK', { rows: ROWS, q, market: 'US', list: null });
  assert.equal(w.verdict, 'excluded');
  assert.match(w.headline, /Rule of 40/);
});

test('zzz1007 the active query summary and the CSV columns include the Rule of 40', () => {
  const q = { ...Q({ bias: 'U' }), r40Min: 40 };
  assert.match(querySummary(q, 'My portfolio'), /Rule of 40 ≥ 40/);
  assert.match(querySummary(q, ''), /Bullish · Daily · All companies/);
  assert.doesNotMatch(querySummary(Q({ bias: 'U' }), ''), /Rule of 40/);
  assert.equal(r40Text({ r40Min: 60 }), 'Rule of 40 ≥ 60'); assert.equal(r40Text({ r40Min: null }), '');
  // shown / exported columns: the Rule of 40 and both inputs while on (no duplicates), the chosen ones otherwise
  assert.deepEqual(pineShownCols(q), ['r40', 'revQYoY', 'fcfmTTM']);
  assert.deepEqual(pineShownCols({ cols: ['rsR', 'r40'], r40Min: 60 }), ['r40', 'revQYoY', 'fcfmTTM', 'rsR']);
  assert.deepEqual(pineShownCols({ cols: ['rsR'], r40Min: null }), ['rsR']);
  for (const k of pineShownCols(q)) assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${k} reaches the page`);
  assert.ok(fieldOf('r40')!.approxNote?.US, 'the Rule of 40 carries its ≈ approximation note');
  // the page wires them: summary heading, CSV header + body from the same column list, the control in the panel
  const page = read('components/pine-screener/PineScreener.tsx');
  assert.match(page, /\.\.\.shownCols\.map\(\(k\) => \{ const d = fieldOf\(k\);/, 'CSV header uses the shown columns');
  assert.match(page, /\.\.\.shownCols\.map\(\(k\) => \(r as any\)\[k\] \?\? ''\)/, 'CSV body uses the shown columns');
  assert.match(page, /data-testid="r40-control"/);
  assert.match(page, /\['off', 'Off'\], \['40', '≥ 40'\], \['60', '≥ 60'\], \['custom', 'Custom'\]/);
  assert.match(page, /ruleCoverage\(rows, activeRules, market\)/, 'coverage notices see the control');
  assert.doesNotMatch(page, /MOVED_PINE_SCREENS/);
  assert.match(read('components/pine-screener/HitDetail.tsx'), /pineFilters\(q\)/);
});

test('zzz1007 saved queries keep the control; legacy queries without it load with it off', () => {
  assert.equal(cleanQuery({ r40Min: 60 }).r40Min, 60);
  assert.equal(cleanQuery({ r40Min: 'x' }).r40Min, null);
  assert.equal(cleanQuery({}).r40Min, null);
  assert.equal(cleanQuery({ r40Min: 1e9 }).r40Min, null);
  const saved = cleanPineScreens([{ id: 'my-1', name: 'Mine', q: { qv: 2, bias: 'U', stages: ['f'], r40Min: 45 } }]);
  assert.equal(saved[0].q.r40Min, 45);
  // carried across a screen change like the company list; a screen with its own setting keeps it.
  // zzz1016 — only a value the OWNER set in the control is carried (r40AfterScreen); a Rule of 40 screen's own ≥ 40 is not
  assert.equal(withCarriedR40(Q({}), { r40Min: 40 }).r40Min, 40);
  assert.equal(withCarriedR40(Q({}), r40AfterScreen({ r40Min: 40 }, true)).r40Min, 40, 'set by the owner: carried');
  assert.equal(withCarriedR40(Q({}), r40AfterScreen({ r40Min: 40 }, false)).r40Min, null, 'set by a Rule of 40 screen: not carried');
  assert.equal(withCarriedR40({ ...Q({}), r40Min: 60 }, { r40Min: 40 }).r40Min, 60);
  assert.equal(withCarriedR40(Q({}), { r40Min: null }).r40Min, null);
  assert.deepEqual(pineFilters(Q({})), []);
  assert.deepEqual(pineFilters({ filters: [], r40Min: 40 }), [{ kind: 'num', key: 'r40', op: 'ge', v: 40 }]);
});

test('zzz1007 built-in Rule of 40 screens (stable ids) and the legacy id', () => {
  const byId = new Map(BUILT_IN_PINE_SCREENS.map((s) => [s.id, s]));
  assert.equal(new Set(BUILT_IN_PINE_SCREENS.map((s) => s.id)).size, BUILT_IN_PINE_SCREENS.length, 'ids unique');
  assert.ok(PINE_GROUPS.some((g) => g.id === 'r40'));
  const bull = byId.get('r40-bullish')!, ready = byId.get('r40-ready')!, wk = byId.get('r40-weekly-bases')!;
  assert.equal(bull.name, 'Rule of 40 · bullish patterns'); assert.equal(ready.name, 'Rule of 40 · ready to break out'); assert.equal(wk.name, 'Rule of 40 · Weekly bases');
  for (const s of [bull, ready, wk]) { assert.equal(s.q.r40Min, 40); assert.equal(s.q.bias, 'U'); assert.equal(s.q.need, 'pattern'); assert.equal(s.group, 'r40'); assert.deepEqual(cleanQuery(s.q), s.q); }
  assert.deepEqual(bull.q.tfs, ['D', 'W', 'M']); assert.equal(bull.q.tfMode, 'any'); assert.ok(bull.q.minConf >= 55);
  assert.deepEqual(ready.q.stages, ['f']); assert.deepEqual(ready.q.dist, { on: true, lo: -5, hi: 0 });
  assert.deepEqual(wk.q.tfs, ['W']); assert.ok(wk.q.ids.includes('vcp') && wk.q.ids.includes('flat_base'));
  assert.deepEqual(strict(bull.q), ['GOOD', 'WK']);
  assert.deepEqual(strict(ready.q), ['GOOD']);
  assert.deepEqual(strict(wk.q), ['WK']);
  // the old Pine id opens a Pine screen again (a last-screen pointing to it loads it): rules decide, Rule of 40 ≥ 40
  const legacy = byId.get('tv-rule-of-40')!;
  assert.equal(legacy.q.r40Min, 40); assert.equal(legacy.q.need, 'any');
  assert.deepEqual(strict(legacy.q), ['DOWN', 'FLAT', 'GOOD', 'WK']);
  // every built-in's rules and columns reach the page
  for (const s of BUILT_IN_PINE_SCREENS) for (const f of pineFilters(s.q)) for (const k of filterKeys(f)) assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${s.id}: ${k}`);
});

test('zzz1007 rule editor: growth / quality / valuation figures the page receives, grouped', () => {
  assert.deepEqual([...PINE_RULE_GROUPS], ['Price & volume', 'Averages', 'Momentum', 'Growth & quality', 'Valuation']);
  for (const m of ['US', 'IN'] as const) {
    const menu = pineRuleMenu(m);
    const keys = new Map(menu.flatMap((g) => g.fields.map((f) => [f.key, g.group] as const)));
    for (const k of ['r40', 'revQYoY', 'fcfmTTM', 'revAYoY', 'epsQYoY', 'epsTTMYoY', 'revTTMYoY', 'gpQYoY', 'gmFY', 'opmTTM', 'nmTTM', 'roeTTM', 'roceTTM', 'de', 'cash'])
      assert.equal(keys.get(k as any), 'Growth & quality', `${m} ${k}`);
    for (const k of ['ps', 'evRev', 'pe']) if (fieldOf(k)?.markets.includes(m)) assert.equal(keys.get(k as any), 'Valuation', `${m} ${k}`);
    for (const k of ['px', 'rvol']) assert.equal(keys.get(k as any), 'Price & volume');
    assert.equal(keys.get('sma50' as any), 'Averages'); assert.equal(keys.get('rsi' as any), 'Momentum');
    // only figures the page receives
    for (const [k] of keys) assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${k} is delivered`);
    assert.deepEqual(menu.map((g) => g.group), PINE_RULE_GROUPS.filter((g) => menu.some((x) => x.group === g)));
  }
  assert.equal(pineRuleGroup({ key: 'emp', group: 'Company' }), null, 'figures the page does not get are not offered');
  const page = read('components/pine-screener/PineScreener.tsx');
  assert.match(page, /\+ Add a rule/); assert.doesNotMatch(page, /TECH_GROUPS/);
});
